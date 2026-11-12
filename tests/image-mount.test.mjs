import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createMountManager,
  defaultMountPoint,
  mountErrorHint,
  mountCaseDir,
  mountsFile,
  resolveLovelyCarveCli,
} from '../tools/image-mount.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fakeCli = join(here, 'fixtures', 'fake-lovelycarve-cli.mjs')

function tempHome() {
  const root = mkdtempSync(join(tmpdir(), 'seeu-mount-'))
  const home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  return { root, home }
}

test('mountsFile / mountCaseDir 跟随 SEEU_DSH_HOME 与显式覆盖', () => {
  const { home } = tempHome()
  assert.equal(mountsFile({ SEEU_DSH_HOME: home }), join(home, 'mounts.json'))
  assert.equal(mountsFile({ SEEU_DSH_HOME: home, SEEU_MOUNTS_FILE: join(home, 'custom.json') }), join(home, 'custom.json'))
  assert.equal(mountCaseDir({ SEEU_DSH_HOME: home }), join(home, 'mount-case'))
})

test('resolveLovelyCarveCli：环境变量 / 配置文件 / 未配置', () => {
  const { root, home } = tempHome()
  const viaEnv = resolveLovelyCarveCli({ SEEU_DSH_HOME: home, SEEU_LOVELYCARVE_CLI: fakeCli })
  assert.equal(viaEnv.path, fakeCli)
  assert.equal(viaEnv.source, 'env')

  const missing = resolveLovelyCarveCli({ SEEU_DSH_HOME: home, SEEU_LOVELYCARVE_CLI: join(root, 'nope.exe') })
  assert.equal(missing.path, null)
  assert.match(String(missing.error), /不存在/)

  const configFile = join(home, 'lovely-cli.json')
  writeFileSync(configFile, JSON.stringify({ lovelycarve: fakeCli }))
  const viaConfig = resolveLovelyCarveCli({ SEEU_DSH_HOME: home })
  assert.equal(viaConfig.path, fakeCli)
  assert.equal(viaConfig.source, 'config')

  writeFileSync(configFile, JSON.stringify({ lovelycarve: join(root, 'gone.exe') }))
  const stale = resolveLovelyCarveCli({ SEEU_DSH_HOME: home })
  assert.equal(stale.path, null)
  assert.match(String(stale.error), /配置的 LovelyCarve CLI 路径不存在/)

  writeFileSync(configFile, '{}')
  const unset = resolveLovelyCarveCli({ SEEU_DSH_HOME: home })
  // 本机装了 LovelyCarve（D:/Programs/LovelyCarve/lovelycarve-cli.exe）时走内置候选；
  // 没装才返回未配置提示。
  if (unset.source === 'auto') {
    assert.ok(unset.path && existsSync(unset.path), 'auto 来源必须有可用路径')
    assert.match(String(unset.path), /lovelycarve-cli\.exe$/)
  } else {
    assert.equal(unset.path, null)
    assert.equal(unset.source, 'unset')
    assert.match(String(unset.error), /未配置 LovelyCarve CLI/)
  }
})

test('defaultMountPoint 跳过已占用盘符', () => {
  const taken = ['X:', 'Y:']
  const point = defaultMountPoint({}, taken)
  assert.equal(taken.includes(point), false)
  assert.match(point, /^[A-Z]:$/)
})

test('MountManager：inspect → mount（写 mounts.json） → unmount', async () => {
  const { root, home } = tempHome()
  const imagePath = join(root, 'disk.E01')
  writeFileSync(imagePath, 'fake-image')
  const env = {
    ...process.env,
    SEEU_DSH_HOME: home,
    SEEU_LOVELYCARVE_CLI: fakeCli,
    SEEU_MOUNT_NODE: process.execPath,
    SEEU_MOUNTS_FILE: join(home, 'mounts.json'),
    SEEU_MOUNT_CASE_DIR: join(home, 'mount-case'),
  }
  const manager = createMountManager({ env: () => env })

  const status = await manager.status()
  assert.equal(status.ok, true)
  assert.equal(status.cli.source, 'env')
  assert.equal(status.hostRunning, false)
  assert.deepEqual(status.mounts, [])
  assert.equal(manager.hostEnv().SEEU_MOUNTS_FILE, join(home, 'mounts.json'))

  const inspected = await manager.inspect(imagePath)
  assert.equal(inspected.ok, true)
  assert.equal(inspected.image.name, 'disk.E01')
  assert.equal(inspected.image.partitions.length, 2)
  assert.equal(inspected.image.partitions[0].fileSystem, 'NTFS')

  const bad = await manager.inspect(join(root, 'missing.E01'))
  assert.equal(bad.ok, false)
  assert.match(String(bad.error), /不存在/)
  assert.match(String(bad.hint), /重新选择镜像/)
  assert.equal(Number(bad.ms) >= 0, true)

  const mounted = await manager.mount({ imagePath, partition: 0 })
  assert.equal(mounted.ok, true, mounted.error)
  assert.equal(Number(mounted.ms) > 0, true, 'mount 应返回耗时')
  assert.match(String(mounted.mount.point ?? mounted.mount.mountPoint), /^[A-Z]:$/)
  const stateFile = join(home, 'mounts.json')
  assert.equal(existsSync(stateFile), true)
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(state.mounts.length, 1)
  assert.equal(state.mounts[0].imagePath, imagePath)
  assert.equal(state.mounts[0].partition, 0)
  assert.match(String(state.note), /关闭外壳即释放/)
  // 第 41 轮：lastMount 记录最近一次挂载（运行中 releasedAt 为空）。
  assert.equal(state.lastMount.imagePath, imagePath)
  assert.equal(state.lastMount.mountPoint, state.mounts[0].mountPoint)
  assert.equal(state.lastMount.releasedAt, undefined)

  const afterMount = await manager.status()
  assert.equal(afterMount.mounts.length, 1)
  assert.equal(afterMount.hostRunning, true)

  const unmounted = await manager.unmount(mounted.mount.id)
  assert.equal(unmounted.ok, true, unmounted.error)
  assert.equal(Number(unmounted.ms) > 0, true, 'unmount 应返回耗时')
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')).mounts, [])
  const releasedState = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(releasedState.mounts.length, 0)
  assert.equal(releasedState.lastMount.imagePath, imagePath)
  assert.equal(typeof releasedState.lastMount.releasedAt, 'string')
  assert.equal((await manager.status()).lastMount.imagePath, imagePath)

  const missingMount = await manager.unmount(mounted.mount.id)
  assert.equal(missingMount.ok, false)

  await manager.dispose()
  assert.equal(manager.debugHost().running, false)
})

test('mountErrorHint 把常见失败翻译成可操作提示', () => {
  assert.match(String(mountErrorHint('Dokan driver not installed')), /管理员权限与 Dokan/)
  assert.match(String(mountErrorHint('Access is denied')), /管理员权限与 Dokan/)
  assert.match(String(mountErrorHint('directory already contains a case: X')), /案件锁/)
  assert.match(String(mountErrorHint('image is already open')), /已经.*打开/)
  assert.match(String(mountErrorHint('ENOENT: no such file')), /重新选择镜像/)
  assert.match(String(mountErrorHint('盘符 X: 已被占用')), /换一个盘符/)
  assert.equal(mountErrorHint('something odd happened'), undefined)
})
