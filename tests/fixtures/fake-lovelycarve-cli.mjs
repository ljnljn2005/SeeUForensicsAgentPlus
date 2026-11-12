#!/usr/bin/env node
/**
 * 测试用假 LovelyCarve CLI：实现 `-q shell` 的 JSONL 协议子集，
 * 让挂载管理器的单测/e2e 不需要真实安装 LovelyCarve 或 Dokan。
 *
 * 支持的命令（与 references/commands.md 对应）：
 *   --image <p> images get
 *   cases create <dir> --name <n>
 *   --case <dir> --image <p> images open <p>
 *   --case <dir> --image <p> mounts create <path> --mount-point <X:>
 *   --case <dir> --image <p> mounts list
 *   --case <dir> --image <p> mounts delete <id> --force
 */

import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'

const mounts = new Map()

function reply(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function handle(line) {
  const text = line.trim()
  if (!text) return
  if (/\bimages\s+get\b/.test(text)) {
    const match = text.match(/--image\s+"([^"]*)"/)
    const imagePath = match ? match[1] : ''
    return reply({
      result: {
        image: {
          path: imagePath,
          sizeBytes: existsSync(imagePath) ? 4_194_304 : 0,
          format: 'E01',
          partitions: [
            { index: 0, label: 'Basic data partition', fileSystem: 'NTFS', sizeBytes: 4_000_000, offsetBytes: 1_048_576 },
            { index: 1, label: 'EFI system partition', fileSystem: 'FAT32', sizeBytes: 100_000, offsetBytes: 512 },
          ],
        },
      },
    })
  }
  if (/\bmounts\s+create\b/.test(text)) {
    const point = text.match(/--mount-point\s+"([^"]*)"/)
    const id = `mnt-${mounts.size + 1}`
    mounts.set(id, point ? point[1] : 'X:')
    return reply({ result: { id, mountPoint: mounts.get(id), readOnly: true } })
  }
  if (/\bmounts\s+list\b/.test(text)) {
    return reply({
      result: {
        mounts: [...mounts.entries()].map(([id, mountPoint]) => ({ id, mountPoint, readOnly: true })),
      },
    })
  }
  if (/\bmounts\s+delete\b/.test(text)) {
    const match = text.match(/mounts\s+delete\s+"([^"]*)"/)
    if (match) mounts.delete(match[1])
    return reply({ result: { ok: true, deleted: match ? match[1] : '' } })
  }
  if (/\bimages\s+open\b/.test(text)) return reply({ result: { ok: true } })
  if (/\bcases\s+create\b/.test(text)) return reply({ result: { ok: true } })
  return reply({ result: { ok: true } })
}

const rl = createInterface({ input: process.stdin })
rl.on('line', handle)
