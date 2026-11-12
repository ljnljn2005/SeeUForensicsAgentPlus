#Requires -Version 5.1
<#
.SYNOPSIS
  Locate IDA Pro >= 9.0 and run INP.py batch export into QikoAgent work/ (not beside evidence).

.NOTES
  STATIC ONLY: This script must never execute the sample binary as a process.
  IDA -A loads the file for disassembly/decompilation only. Do not Start-Process
  / Invoke-Item / cmd /c the -Binary path (malware infection risk).

.EXAMPLE
  .\ida_batch_export.ps1 -Binary D:\case\evidence\sample.exe -Workspace D:\case\workspace
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Binary,

  [string] $Workspace,
  [string] $IdaPath,
  [string] $InpPath,
  [string] $SkillRoot,
  [string] $ExportDir,
  [string] $LogPath,
  [string] $IdbPath,
  [switch] $SkipIfExists,
  [switch] $AllowBesideBinary
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string] $p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  return [System.IO.Path]::GetFullPath($p)
}

function Get-SkillRoot {
  if ($SkillRoot) { return (Resolve-FullPath $SkillRoot) }
  return (Resolve-FullPath (Join-Path $PSScriptRoot '..'))
}

function Get-SafeStem([string] $fileName) {
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
  if ([string]::IsNullOrWhiteSpace($stem)) { $stem = 'sample' }
  $safe = ($stem -replace '[<>:"/\\|?*]', '_').Trim()
  if ($safe.Length -gt 80) { $safe = $safe.Substring(0, 80) }
  return $safe
}

function Find-IdaExe {
  if ($IdaPath) {
    $p = Resolve-FullPath $IdaPath
    if (-not (Test-Path -LiteralPath $p)) {
      throw "IDA path not found: $p"
    }
    return $p
  }

  $roots = @(
    ${env:ProgramFiles},
    ${env:ProgramFiles(x86)},
    'D:\',
    'E:\',
    'C:\IDA',
    'D:\IDA'
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  $candidates = @()
  foreach ($root in $roots) {
    try {
      $hits = Get-ChildItem -LiteralPath $root -Filter 'ida.exe' -File -Recurse -Depth 4 -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'IDA' }
      if ($hits) { $candidates += @($hits) }
    } catch {}
  }

  if (-not $candidates -or $candidates.Count -eq 0) {
    throw 'IDA Pro (ida.exe) not found. Install IDA Pro >= 9.0 with Hex-Rays, or pass -IdaPath.'
  }

  $scored = foreach ($c in $candidates) {
    $ver = 0.0
    if ($c.FullName -match 'IDA(?:\s+Professional)?\s+(\d+(?:\.\d+)?)') {
      [void][double]::TryParse($Matches[1], [ref]$ver)
    }
    [pscustomobject]@{ Path = $c.FullName; Ver = $ver }
  }

  $best = $scored | Sort-Object -Property @{ Expression = 'Ver'; Descending = $true }, @{ Expression = 'Path'; Descending = $true } | Select-Object -First 1
  if ($best.Ver -gt 0 -and $best.Ver -lt 9.0) {
    Write-Warning "Best IDA appears to be $($best.Ver) at $($best.Path). Hex-Rays export needs >= 9.0."
  }
  return $best.Path
}

function Find-InpPy([string] $root, [string] $idaExe) {
  if ($InpPath) {
    $p = Resolve-FullPath $InpPath
    if (-not (Test-Path -LiteralPath $p)) { throw "INP.py not found: $p" }
    return $p
  }

  $bundled = Join-Path $root 'INP.py'
  if (Test-Path -LiteralPath $bundled) { return (Resolve-FullPath $bundled) }

  $idaDir = Split-Path -Parent $idaExe
  $pluginHit = Get-ChildItem -LiteralPath $idaDir -Filter 'INP.py' -File -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pluginHit) { return $pluginHit.FullName }

  throw @"
INP.py not found. Place it at:
  1) $bundled
  2) <IDA>/plugins/INP.py
Or pass -InpPath.
"@
}

$binaryFull = Resolve-FullPath $Binary
if (-not (Test-Path -LiteralPath $binaryFull)) {
  throw "Binary not found: $binaryFull"
}

if (-not $Workspace) {
  if ($env:QIKO_WORKSPACE) {
    $Workspace = $env:QIKO_WORKSPACE
  } else {
    $Workspace = (Get-Location).Path
  }
}
$workspaceFull = Resolve-FullPath $Workspace
if (-not (Test-Path -LiteralPath $workspaceFull)) {
  throw "Workspace not found: $workspaceFull"
}

$stem = Get-SafeStem ([System.IO.Path]::GetFileName($binaryFull))
$workCase = Join-Path $workspaceFull (Join-Path 'work' $stem)
New-Item -ItemType Directory -Force -Path $workCase | Out-Null

$skill = Get-SkillRoot
$ida = Find-IdaExe
$inp = Find-InpPy -root $skill -idaExe $ida
$binDir = Split-Path -Parent $binaryFull

if (-not $ExportDir) {
  $ExportDir = Join-Path $workCase 'export-for-ai'
} else {
  $ExportDir = Resolve-FullPath $ExportDir
}

if (-not $LogPath) {
  $LogPath = Join-Path $workCase 'ida_batch.log'
} else {
  $LogPath = Resolve-FullPath $LogPath
}

if (-not $IdbPath) {
  $IdbPath = Join-Path $workCase ($stem + '.i64')
} else {
  $IdbPath = Resolve-FullPath $IdbPath
}

# Refuse writing export/log next to evidence unless explicitly allowed
if (-not $AllowBesideBinary) {
  $binDirFull = Resolve-FullPath $binDir
  foreach ($p in @($ExportDir, $LogPath, $IdbPath)) {
    if ($p.StartsWith($binDirFull, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $p.StartsWith($workCase, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to write under binary directory (evidence): $p. Use -Workspace or pass -AllowBesideBinary."
    }
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ExportDir) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $IdbPath) | Out-Null

if ($SkipIfExists) {
  $marker = Join-Path $ExportDir 'strings.txt'
  $decomp = Join-Path $ExportDir 'decompile'
  if ((Test-Path -LiteralPath $marker) -and (Test-Path -LiteralPath $decomp)) {
    if (Test-Path -LiteralPath $LogPath) {
      $logText = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
      if ($logText -and $logText -match 'Export completed!') {
        Write-Host "[skip] Existing export looks complete: $ExportDir"
        Write-Host "IDA=$ida"
        Write-Host "INP=$inp"
        Write-Host "LOG=$LogPath"
        Write-Host "EXPORT=$ExportDir"
        exit 0
      }
    }
  }
}

Write-Host "IDA=$ida"
Write-Host "INP=$inp"
Write-Host "BIN=$binaryFull"
Write-Host "WORKSPACE=$workspaceFull"
Write-Host "WORK=$workCase"
Write-Host "LOG=$LogPath"
Write-Host "EXPORT=$ExportDir"
Write-Host "IDB=$IdbPath"

# Prefer env for export dir (spaces/CJK-safe). Also pass ARGV[1] when path has no spaces.
$env:QIKO_IDA_EXPORT_DIR = $ExportDir
$sArg = if ($ExportDir -match '\s') { "-S$inp" } else { "-S$inp $ExportDir" }
$lArg = "-L$LogPath"
$oArg = "-o$IdbPath"

$argList = @('-A', $oArg, $sArg, $lArg, $binaryFull)
Write-Host "RUN: `"$ida`" $($argList -join ' ')"
Write-Host "QIKO_IDA_EXPORT_DIR=$ExportDir"

$p = Start-Process -FilePath $ida -ArgumentList $argList -Wait -PassThru -NoNewWindow
$code = $p.ExitCode
Write-Host "IDA exit code: $code"

if (-not (Test-Path -LiteralPath $LogPath)) {
  throw "ida_batch.log missing after run: $LogPath"
}

$log = Get-Content -LiteralPath $LogPath -Raw -ErrorAction Stop
$ok = $log -match 'Export completed!'
$hexrays = $log -match 'Hex-Rays'
$failed = [regex]::Match($log, 'Failed:\s*(\d+)')

Write-Host "---- log summary ----"
if ($ok) { Write-Host '[OK] Export completed!' } else { Write-Host '[FAIL] Export completed! not found' }
if ($hexrays) { Write-Host '[OK] Hex-Rays mentioned in log' } else { Write-Warning 'Hex-Rays not clearly loaded in log' }
if ($failed.Success) { Write-Host "Failed functions: $($failed.Groups[1].Value)" }

if (Test-Path -LiteralPath $ExportDir) {
  Write-Host "EXPORT_DIR=$ExportDir"
} else {
  Write-Warning "export-for-ai directory not found: $ExportDir"
}

if (-not $ok) {
  exit 2
}
exit 0
