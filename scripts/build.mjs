#!/usr/bin/env node
/**
 * 构建脚本：用 esbuild 把 TS 主进程/预加载打成 CJS，并复制静态页面到 dist/。
 * 无 tsc 类型检查（esbuild 只剥离类型），保持构建秒级；类型问题靠编辑器/CI 另行检查。
 */

import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'dist')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Electron 注入的模块：运行时由 Electron 提供，不打进 bundle。
  external: ['electron'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  absWorkingDir: root,
}

await build({ ...common, entryPoints: [join(root, 'src', 'main.ts')], outfile: join(outDir, 'main.cjs') })
await build({ ...common, entryPoints: [join(root, 'src', 'preload.ts')], outfile: join(outDir, 'preload.cjs') })

const rendererSrc = join(root, 'renderer')
if (existsSync(rendererSrc)) {
  await cp(rendererSrc, join(outDir, 'renderer'), { recursive: true })
}

console.log('[build] dist/main.cjs, dist/preload.cjs, dist/renderer/')
