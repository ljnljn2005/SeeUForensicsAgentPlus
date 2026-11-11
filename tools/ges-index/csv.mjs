// 取证索引 · CSV 导出（记录视图「导出 CSV」与将来的表/时间线导出共用）。
//
// 约定：
//   - UTF-8 带 BOM（Excel 双击打开中文不乱码）；
//   - 行分隔符 CRLF（Excel 兼容最好）；
//   - 单元格内出现逗号/双引号/换行时加引号并双写引号；
//   - 空值写成空字符串，不用 null 字面量。

export const RECORD_CSV_HEADER = [
  '检材号',
  '检材名称',
  '应用',
  '账号',
  '类别',
  '子类',
  '时间',
  '行号',
  '记录ID',
  '摘要',
];

/** 单个 CSV 单元格转义。 */
export function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/** 一行 CSV（不带换行）。 */
export function csvLine(cells) {
  return (cells ?? []).map(csvCell).join(',');
}

/**
 * 记录行 → CSV 文本。
 * @param {Array<Record<string, unknown>>} rows - `records()` 返回的行（id/eid/ev/app/account/cat/sub/ts/line/text）。
 * @param {{ bom?: boolean, header?: string[] }} [opts]
 */
export function recordsCsv(rows, opts = {}) {
  const header = opts.header ?? RECORD_CSV_HEADER;
  const lines = [csvLine(header)];
  for (const r of rows ?? []) {
    lines.push(csvLine([r.eid, r.ev, r.app, r.account, r.cat, r.sub, r.ts, r.line, r.id, r.text]));
  }
  const bom = opts.bom === false ? '' : '\uFEFF';
  return bom + lines.join('\r\n') + '\r\n';
}
