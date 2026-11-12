import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BUNDLED_DSH_PLUGINS,
  PLUGIN_PACKAGES_MARKER,
  collectPluginClosure,
  ensurePluginPackages,
  mergePluginBundles,
  installBundledPluginBundles,
  resolveDependencyDir,
} from '../tools/dsh-plugins.mjs'

const tempdirs = []
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'seeu-dsh-plugins-'))
  tempdirs.push(dir)
  return dir
}

/** 在临时目录里造一个「工程根」，带指定插件的 node_modules/<name>/package.json。 */
function fakeProject(plugins) {
  const root = tempRoot()
  for (const name of plugins) {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  return root
}

test('mergePluginBundles：只追加缺的，保持顺序且不重复', () => {
  const manifest = {
    dependencies: { foo: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'custom-a'] } },
  }
  const { manifest: next, added } = mergePluginBundles(manifest, [
    '@deepseek-ai/dsh-base',
    'p1',
    'custom-a',
    'p2',
  ])
  assert.deepEqual(added, ['p1', 'p2'])
  assert.deepEqual(next.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'custom-a', 'p1', 'p2'])
  assert.deepEqual(next.dependencies, { foo: '1.0.0' })
})

test('mergePluginBundles：没有 dsh 字段时创建；已齐全时 added 为空', () => {
  const first = mergePluginBundles({}, ['a', 'b'])
  assert.deepEqual(first.added, ['a', 'b'])
  assert.deepEqual(first.manifest.dsh.profile.bundles, ['a', 'b'])

  const again = mergePluginBundles(first.manifest, ['a', 'b'])
  assert.deepEqual(again.added, [])
})

test('installBundledPluginBundles：首次创建 web profile 清单（基础 bundle + 随包插件）', () => {
  const home = tempRoot()
  const root = fakeProject(['billion-context', 'dsh-context'])
  const result = installBundledPluginBundles({
    homeDir: home,
    pluginsDir: root,
    pluginBundles: ['billion-context', 'dsh-context', 'dsh-better-sidebar'],
  })
  assert.equal(result.changed, true)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.added, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'billion-context',
    'dsh-context',
  ])
  // dsh-better-sidebar 不在假工程里 → 计入 missing 且不写进 bundles
  assert.deepEqual(result.missing, ['dsh-better-sidebar'])

  const saved = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
  assert.deepEqual(saved.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'billion-context',
    'dsh-context',
  ])
})

test('installBundledPluginBundles：保留用户已有 bundles/dependencies，只追加缺的', () => {
  const home = tempRoot()
  const root = fakeProject(['billion-context', 'dsh-context'])
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-profile-web',
        private: true,
        dependencies: { keep: '^1.2.3' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'user-bundle'] } },
      },
      null,
      2,
    ),
  )

  const result = installBundledPluginBundles({
    homeDir: home,
    pluginsDir: root,
    pluginBundles: ['billion-context', 'dsh-context'],
  })
  assert.equal(result.changed, true)
  assert.deepEqual(result.added, ['@deepseek-ai/dsh-web-app', 'billion-context', 'dsh-context'])

  const saved = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
  assert.deepEqual(saved.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    'user-bundle',
    '@deepseek-ai/dsh-web-app',
    'billion-context',
    'dsh-context',
  ])
  assert.deepEqual(saved.dependencies, { keep: '^1.2.3' })
})

test('installBundledPluginBundles：第二次运行不再改写（幂等）', () => {
  const home = tempRoot()
  const root = fakeProject(['billion-context'])
  const first = installBundledPluginBundles({ homeDir: home, pluginsDir: root, pluginBundles: ['billion-context'] })
  const before = readFileSync(first.manifestPath, 'utf8')
  const second = installBundledPluginBundles({ homeDir: home, pluginsDir: root, pluginBundles: ['billion-context'] })
  assert.equal(second.changed, false)
  assert.deepEqual(second.added, [])
  assert.equal(readFileSync(second.manifestPath, 'utf8'), before)
})

test('installBundledPluginBundles：坏清单不覆盖、返回错误', () => {
  const home = tempRoot()
  const root = fakeProject([])
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), '{ 不是 JSON')
  const result = installBundledPluginBundles({ homeDir: home, pluginsDir: root, pluginBundles: [] })
  assert.equal(result.changed, false)
  assert.match(result.error ?? '', /JSON/)
  assert.equal(readFileSync(join(profileDir, 'package.json'), 'utf8'), '{ 不是 JSON')
})

test('随包插件清单包含四个约定插件', () => {
  assert.deepEqual(BUNDLED_DSH_PLUGINS, [
    'billion-context',
    'dsh-context',
    'dsh-better-sidebar',
    'dsh-gitbash-shell',
  ])
})

test('ensurePluginPackages：复制插件与非 @deepseek-ai 依赖闭包到 profile/node_modules', () => {
  const root = tempRoot()
  const pkg = (name, deps = {}) => {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies: deps }))
  }
  pkg('p1', { 'dep-b': '1.0.0', '@deepseek-ai/dsh-session': '0.2.2-rc.1' })
  pkg('dep-b', { 'dep-c': '1.0.0' })
  pkg('dep-c', {})
  const home = tempRoot()

  const first = ensurePluginPackages({ homeDir: home, pluginsDir: root, pluginNames: ['p1'], version: '0.3.3' })
  assert.equal(first.error, undefined)
  assert.equal(first.changed, true)
  assert.deepEqual([...first.packages].sort(), ['dep-b', 'dep-c', 'p1'])
  const profileNodeModules = join(home, 'profiles', 'web', 'node_modules')
  for (const name of ['p1', 'dep-b', 'dep-c']) {
    assert.ok(readFileSync(join(profileNodeModules, name, 'package.json'), 'utf8').includes(name))
  }
  // 安装目录已经提供的 @deepseek-ai/* 不复制
  assert.equal(requireExists(join(profileNodeModules, '@deepseek-ai', 'dsh-session')), false)
  const marker = JSON.parse(readFileSync(join(home, 'profiles', 'web', PLUGIN_PACKAGES_MARKER), 'utf8'))
  assert.equal(marker.version, '0.3.3')
  assert.equal(marker.packages.length, 3)

  const second = ensurePluginPackages({ homeDir: home, pluginsDir: root, pluginNames: ['p1'], version: '0.3.3' })
  assert.equal(second.changed, false)
  assert.equal(second.copied, 0)

  const third = ensurePluginPackages({ homeDir: home, pluginsDir: root, pluginNames: ['p1'], version: '0.3.4' })
  assert.equal(third.changed, true)
  assert.equal(third.copied, 3)
})

test('collectPluginClosure：硬依赖缺失进 missing，软依赖缺失进 optionalMissing', () => {
  const root = tempRoot()
  mkdirSync(join(root, 'node_modules', 'ok'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules', 'ok', 'package.json'),
    JSON.stringify({ name: 'ok', dependencies: { gone: '1.0.0' }, peerDependencies: { 'peer-x': '1.0.0' } }),
  )
  const { packages, missing, optionalMissing } = collectPluginClosure(['ok', 'absent'], root)
  assert.deepEqual([...packages.keys()], ['ok'])
  assert.deepEqual([...missing].sort(), ['absent', 'gone'])
  assert.deepEqual(optionalMissing, ['peer-x'])
})

test('resolveDependencyDir：向上查找 hoisted 依赖', () => {
  const root = tempRoot()
  mkdirSync(join(root, 'node_modules', 'hoisted'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'hoisted', 'package.json'), JSON.stringify({ name: 'hoisted' }))
  mkdirSync(join(root, 'node_modules', 'a', 'b'), { recursive: true })
  assert.equal(resolveDependencyDir('hoisted', join(root, 'node_modules', 'a', 'b')), join(root, 'node_modules', 'hoisted'))
  assert.equal(resolveDependencyDir('nope', join(root, 'node_modules', 'a')), undefined)
})

function requireExists(path) {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

test.after(() => {
  for (const dir of tempdirs) rmSync(dir, { recursive: true, force: true })
})

