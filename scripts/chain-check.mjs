#!/usr/bin/env node
/**
 * SeeU 链路体检：给定案件（caseNumber 或 --db），检查
 *   1) 索引是否可打开、规模与检材覆盖（解析内容 / 仅元数据）
 *   2) 检索链路（FTS5 长关键词 / LIKE 短关键词）
 *   3) 火眼只读挂载目录是否可读
 *   4) 原始镜像能否被 LovelyCarve 解析（分区表）
 * 退出码：0 全通；1 有环节失败；2 参数错误 / 找不到索引。
 *
 * 用法：
 *   node scripts/chain-check.mjs --caseNumber 2919d298-... [--probe Investors] [--json]
 *   node scripts/chain-check.mjs --db "E:/forensics/x/.seeu-index/case-index.db"
 *   node scripts/chain-check.mjs --caseNumber ... --no-images
 */
import { runChainCheck } from '../tools/chain-check-run.mjs';

function parseArgs(argv) {
  const args = { probe: 'Investors', images: true, json: false, out: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--json') args.json = true;
    else if (item === '--no-images') args.images = false;
    else if (item === '--caseNumber' || item === '--case') args.caseNumber = argv[++i];
    else if (item === '--db') args.db = argv[++i];
    else if (item === '--probe') args.probe = argv[++i] ?? args.probe;
    else if (item === '--out') args.out = argv[++i] ?? '';
    else if (item === '--help' || item === '-h') args.help = true;
    else if (item.startsWith('-')) throw new Error(`未知参数：${item}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      '用法：node scripts/chain-check.mjs --caseNumber <案号> [--probe 关键词] [--no-images] [--json] [--out 文件]\n',
    );
    return 0;
  }

  const { exitCode, report, summary, text } = await runChainCheck({
    caseNumber: args.caseNumber,
    db: args.db,
    probe: args.probe,
    images: args.images,
    env: process.env,
  });

  if (exitCode === 2) {
    process.stderr.write(text + '\n');
    return 2;
  }

  if (args.out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.out, text + '\n', 'utf8');
  }
  process.stdout.write(args.json ? JSON.stringify({ ...report, summary }, null, 2) + '\n' : text + '\n');
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`链路体检失败：${error?.stack ?? error}\n`);
    process.exit(1);
  });
