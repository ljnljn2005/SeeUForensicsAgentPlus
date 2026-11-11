// 火眼 GES CLI 访问层：定位 ges.exe、执行子命令、JSON 解析、分页读取。
// 只读：本模块只调用 ls/status/case/glob/read/help，不写案件数据。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  process.env.SEEU_GES_EXE,
  'D:\\Programs\\Honglian\\GoldenEyesV4\\skills\\ges-case-analysis\\bin\\ges.exe',
  'D:\\Programs\\Honglian\\GoldenEyesV4\\skills\\ges-case-management\\bin\\ges.exe',
].filter(Boolean);

let cached = null;
export function gesExe() {
  if (cached) return cached;
  for (const c of CANDIDATES) if (existsSync(c)) return (cached = c);
  if (process.env.PATH) {
    for (const dir of process.env.PATH.split(';')) {
      for (const name of ['ges.exe', 'ges.cmd']) {
        const p = `${dir}\\${name}`;
        if (existsSync(p)) return (cached = p);
      }
    }
  }
  throw new Error('找不到 ges.exe，请设置 SEEU_GES_EXE=<ges.exe 绝对路径>');
}

export async function ges(args, { timeout = 180_000 } = {}) {
  const { stdout } = await execFileAsync(gesExe(), args, {
    timeout,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    encoding: 'utf8',
  });
  return stdout;
}

export async function gesJson(args, opts) {
  const out = await ges(args, opts);
  const text = out.trim();
  try {
    return JSON.parse(text);
  } catch {
    const i = text.indexOf('{');
    const j = text.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(text.slice(i, j + 1));
    throw new Error(`ges 输出不是 JSON：${text.slice(0, 200)}`);
  }
}

export async function listCases() {
  const j = await gesJson(['case', 'ls', '--json']);
  return j.cases ?? j.entries ?? j ?? [];
}

export async function status() {
  return gesJson(['status', '--json']);
}

export async function openCase(caseNumber) {
  return ges(['case', 'open', caseNumber]);
}

/** 枚举：glob 分页拿全量路径。 */
export async function globAll(pattern, basePath) {
  const out = [];
  let offset = 0;
  for (let guard = 0; guard < 500; guard++) {
    const j = await gesJson(['glob', '--pattern', pattern, '--path', basePath, '--json', '--offset', String(offset), '--limit', '500']);
    const ents = j.entries ?? j.matches ?? [];
    for (const e of ents) out.push(typeof e === 'string' ? e : e.path ?? e.virtual_path);
    const next = j.next_offset;
    if (next == null || ents.length === 0) break;
    offset = next;
  }
  return out;
}

const BASE_RE = /Goldeneyes:\/\/[^\s〕]+/;
const LINE_RE = /^\s*(\d+)\s\s(.*)$/;
const TOTAL_RE = /\((\d+) lines total/;

/** 分页读一个叶子：返回 { baseHandle, total, lines:[{no,content}] }。 */
export async function readLeaf(path, { pageSize = 200 } = {}) {
  const lines = [];
  let baseHandle = null;
  let total = null;
  let offset = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const out = await ges(['read', path, '--offset', String(offset), '--limit', String(pageSize)]);
    const mt = out.match(TOTAL_RE);
    if (mt) total = Number(mt[1]);
    let got = 0;
    for (const raw of out.split(/\r?\n/)) {
      if (raw.startsWith('〔本文件溯源基址')) {
        const m = raw.match(BASE_RE);
        if (m) baseHandle = m[0];
        continue;
      }
      const m = raw.match(LINE_RE);
      if (!m) continue;
      lines.push({ no: Number(m[1]), content: m[2] });
      got++;
    }
    if (total !== null ? offset + got >= total : got < pageSize) break;
    if (got === 0) break;
    offset += got;
  }
  return { baseHandle, total, lines };
}

/**
 * 读火眼案件配置文件 `<caseDir>/<案件名>.gec`（SQLite）里的检材元数据。
 * 这是火眼界面上「检材名称 / 持有人 / 备注」的真实来源；CLI `ges evidence ls` 只能给文件名。
 * 只读打开，失败时返回空表（老版本/.gec 缺失都不影响建库）。
 */
export function readCaseConfig(caseDir) {
  const evidences = new Map();
  let file = null;
  try {
    if (!caseDir || !existsSync(caseDir)) return { file, evidences };
    file = readdirSync(caseDir)
      .filter((n) => n.toLowerCase().endsWith('.gec'))
      .map((n) => join(caseDir, n))
      .find((p) => {
        try { return statSync(p).isFile(); } catch { return false; }
      }) ?? null;
    if (!file) return { file, evidences };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare(
        `select id, name, person_name, remark, platform, type, record_count, evidence_number from evidence`,
      ).all();
      for (const r of rows) evidences.set(Number(r.id), r);
    } finally {
      db.close();
    }
    return { file, evidences };
  } catch (e) {
    return { file, evidences, error: String(e?.message ?? e) };
  }
}
