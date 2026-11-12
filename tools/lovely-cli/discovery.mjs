// 按需查找本机 CLI；只读取路径，不启动候选程序，不增加依赖或常驻服务。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

export function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

const ignored = /^(?:Windows|WinSxS|System Volume Information|\$Recycle\.Bin|node_modules|\.git|\.cache|AppData|lovely-runs)$/i;
const preferred = /lovely|program|tools?|apps?|software|forensic|ctf|软件|工具/i;

// 有深度、目录数和时间上限；不跟随目录链接，不扫描文件内容。
export function searchDirectories(roots, names, { maxDepth = 5, maxDirs = 3000, maxMs = 2000 } = {}) {
  const queue = roots.filter(Boolean).map(path => ({ path: resolve(path), depth: 0 }));
  const visited = new Set();
  const started = Date.now();
  for (let index = 0; index < queue.length && visited.size < maxDirs && Date.now() - started < maxMs; index++) {
    const { path, depth } = queue[index];
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (visited.has(key)) continue;
    visited.add(key);
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { continue; }
    for (const name of names) {
      const entry = entries.find(e => e.isFile() && e.name.toLowerCase() === name.toLowerCase());
      if (entry) return join(path, entry.name);
    }
    if (depth >= maxDepth) continue;
    const dirs = entries.filter(e => e.isDirectory() && !e.isSymbolicLink() && !ignored.test(e.name));
    dirs.sort((a, b) => Number(preferred.test(b.name)) - Number(preferred.test(a.name)) || a.name.localeCompare(b.name));
    for (const entry of dirs) queue.push({ path: join(path, entry.name), depth: depth + 1 });
  }
  return null;
}

const locationCache = new Map();
const locationScript = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$files = [System.Collections.Generic.List[object]]::new()
$roots = [System.Collections.Generic.List[string]]::new()
foreach ($hive in @('HKCU:', 'HKLM:')) {
  foreach ($view in @('Software', 'Software\WOW6432Node')) {
    foreach ($name in @('lovelymem.v3.exe', 'lovelyspark.exe')) {
      $key = Get-Item -LiteralPath "$hive\$view\Microsoft\Windows\CurrentVersion\App Paths\$name"
      if ($key) { $files.Add(@{path=([string]$key.GetValue('')).Trim('"');source='registry'}) }
    }
    Get-ItemProperty "$hive\$view\Microsoft\Windows\CurrentVersion\Uninstall\*" | Where-Object { $_.DisplayName -match 'Lovely(Mem|Spark)' } | ForEach-Object {
      if ($_.InstallLocation) { $roots.Add($_.InstallLocation) }
      if ($_.DisplayIcon) { $files.Add(@{path=($_.DisplayIcon -replace ',\s*-?\d+$','').Trim('"');source='registry'}) }
    }
  }
}
Get-Process -Name 'lovelymem.v3','lovelyspark' | ForEach-Object { if ($_.Path) { $files.Add(@{path=$_.Path;source='process'}) } }
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @('Desktop','CommonDesktopDirectory','Programs','CommonPrograms')) {
  $dir = [Environment]::GetFolderPath($folder)
  if ($dir) {
    Get-ChildItem -LiteralPath $dir -Filter '*lovely*.lnk' -File -Recurse -Depth 3 | ForEach-Object {
      $target = $shell.CreateShortcut($_.FullName).TargetPath
      if ($target) { $files.Add(@{path=$target;source='shortcut'}) }
    }
  }
}
$drives = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -in @('Fixed','Removable') -and $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName })
@{files=@($files.ToArray());roots=@($roots.ToArray());drives=$drives} | ConvertTo-Json -Depth 4 -Compress
`;

export function windowsLocations(env) {
  if (process.platform !== 'win32') return { files: [], roots: [], drives: [] };
  const key = [env.SystemRoot, env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA].join('|');
  if (locationCache.has(key)) return locationCache.get(key);
  let result = { files: [], roots: [], drives: [] };
  const ps = join(env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    const query = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(locationScript, 'utf16le').toString('base64')], {
      env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 6000, maxBuffer: 256 * 1024,
    });
    if (query.status === 0) result = JSON.parse(query.stdout.replace(/^\uFEFF/, ''));
  } catch { /* 安装信息不可读时仍查找常见目录。 */ }
  locationCache.set(key, result);
  return result;
}

function readCache(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value.machine === hostname() && value.tools && typeof value.tools === 'object' ? value : { machine: hostname(), tools: {} };
  } catch { return { machine: hostname(), tools: {} }; }
}

export function discoverExecutable(tool, names, env, cacheFile, getLocations = windowsLocations) {
  const valid = file => typeof file === 'string' && isAbsolute(file) && names.some(name => basename(file).toLowerCase() === name.toLowerCase()) && isFile(file);
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  for (const dir of (env[pathKey] || '').split(delimiter).filter(Boolean)) {
    // 不把 PATH 中的相对项解释成当前检材目录。
    const absolute = dir.replace(/^"|"$/g, '');
    if (!isAbsolute(absolute)) continue;
    for (const name of names) {
      const file = join(absolute, name);
      if (valid(file)) return { path: file, source: 'PATH', found: true };
    }
  }
  const cache = readCache(cacheFile);
  if (valid(cache.tools[tool])) return { path: cache.tools[tool], source: 'cache', found: true };
  const remember = (path, source) => {
    cache.tools[tool] = path;
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache) + '\n');
    } catch { /* 只读配置目录不影响发现与调用。 */ }
    return { path, source, found: true };
  };
  const standard = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const subs = tool === 'lovelymem' ? ['Lovelymem/V3', 'Lovelymem/LovelymemV3', 'LovelymemV3', 'Lovelymem'] : ['LovelySpark'];
  for (const root of standard) for (const sub of subs) for (const name of names) {
    const file = resolve(root, sub, name);
    if (valid(file)) return remember(file, 'install');
  }
  const locations = getLocations(env);
  for (const entry of locations.files || []) {
    if (valid(entry.path)) return remember(entry.path, entry.source);
  }
  // 从系统取得盘符，不假设另一台电脑也有 D:\Programs。
  const common = ['Programs', 'Program Files', 'Program Files (x86)', 'Tools', 'CTFTools', 'Apps', 'Software', '软件', '工具'];
  const drives = locations.drives || [];
  const userDirs = env.USERPROFILE ? ['Desktop', 'Downloads', 'Documents'].map(sub => join(env.USERPROFILE, sub)) : [];
  const roots = [...(locations.roots || []), ...drives.flatMap(drive => common.map(sub => join(drive, sub))), ...standard, ...userDirs].filter(existsSync);
  const file = searchDirectories(roots, names) || searchDirectories(drives, names, { maxDepth: 3, maxDirs: 1500, maxMs: 1000 });
  return file ? remember(file, 'search') : { path: null, source: 'missing', found: false };
}
