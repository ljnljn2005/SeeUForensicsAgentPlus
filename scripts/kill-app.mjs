#!/usr/bin/env node
// 清理残留的 SeeUForensicsAgentPlus 进程（打包/验证前必须执行）。
//
// 为什么需要：应用是单实例的（Electron requestSingleInstanceLock）。只要还有一个
// 残留实例（错误页卡住、CDP 验证没回收干净、portable 解包实例仍在跑），新实例就会
// 立刻 exit 0，verify-launch.mjs 会报「应用提前退出（exit 0）」。
//
// 用法：node scripts/kill-app.mjs

import { execFileSync } from "node:child_process";

const IMAGE_PREFIX = "seeuforensicsagentplus";

function listPids() {
  // tasklist 输出是本地化文本；只解析包含进程名的行，取第二列 PID。
  const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const pids = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split('","');
    if (cols.length < 2) continue;
    const image = cols[0].replace(/^"/, "").toLowerCase();
    if (!image.startsWith(IMAGE_PREFIX)) continue;
    const pid = Number(cols[1]);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

const pids = listPids();
if (pids.length === 0) {
  console.log("[kill-app] no leftover SeeUForensicsAgentPlus process.");
  process.exit(0);
}

console.log(`[kill-app] killing ${pids.length} process(es): ${pids.join(", ")}`);
for (const pid of pids) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // 进程可能刚好自己退出，忽略。
  }
}

// 等它们真正消失，避免紧接着的打包被文件锁卡住。
for (let i = 0; i < 20; i++) {
  if (listPids().length === 0) break;
  await new Promise((r) => setTimeout(r, 250));
}
const left = listPids();
if (left.length > 0) {
  console.error(`[kill-app] still alive: ${left.join(", ")}`);
  process.exit(1);
}
console.log("[kill-app] done, none left.");
