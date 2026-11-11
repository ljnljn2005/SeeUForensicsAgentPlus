/**
 * 界面截图工具（开发态）：拉起 Electron 外壳 → 连 CDP → 截图 + 采样主题 token。
 *
 * 用法：
 *   node scripts/e2e/shot.mjs --out scripts/e2e/shots/dark.png [--theme dark|light] [--wait 30000]
 *
 * 产出：PNG + 一行 JSON（title / dark 属性 / 关键 token 计算值 / 控制台错误数）。
 * 只用于开发验收，不进打包产物。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(repo, 'node_modules', 'electron', 'dist', 'electron.exe')

const argv = process.argv.slice(2)
const get = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const out = get('out', join(repo, '.probe', 'shots', 'shot.png'))
const theme = get('theme', 'dark')
const cdpPort = Number(get('port', '9350'))
const waitMs = Number(get('wait', '45000'))
const delay = Number(get('delay', '2500'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { timeout: 2000 }, (res) => {
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (buf += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
      .on('timeout', () => reject(new Error('timeout')))
  })
}

async function findPage() {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    try {
      const list = await getJson(`http://127.0.0.1:${cdpPort}/json/list`)
      const page = list.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url))
      if (page) return page
    } catch {
      // CDP 还没起来，继续等。
    }
    await sleep(500)
  }
  throw new Error('CDP 页面超时未出现')
}

function killTree(pid) {
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // 忽略
  }
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

mkdirSync(dirname(out), { recursive: true })
const child = spawn(electron, [repo, `--remote-debugging-port=${cdpPort}`], {
  cwd: repo,
  env,
  stdio: 'ignore',
})

let ws
try {
  const page = await findPage()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params?.exceptionDetails?.exception?.description ?? 'exception')
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(delay)

  if (theme === 'light') {
    await send('Runtime.evaluate', {
      expression: `document.body.removeAttribute('data-ds-dark-theme')`,
    })
    await sleep(600)
  }

  const sample = await send('Runtime.evaluate', {
    expression: `(() => {
      const cs = getComputedStyle(document.body)
      const px = (n) => cs.getPropertyValue(n).trim()
      return {
        title: document.title,
        dark: document.body.hasAttribute('data-ds-dark-theme'),
        bgBase: px('--dsw-alias-bg-base'),
        layer1: px('--dsw-alias-bg-layer-1'),
        labelPrimary: px('--dsw-alias-label-primary'),
        accent: px('--dsw-alias-brand-primary-new-colorprimary-new-color'),
        font: px('--dsh-font-family-text-default').slice(0, 60),
        themeStyle: !!document.getElementById('seeu-theme'),
      }
    })()`,
    returnByValue: true,
  })
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(JSON.stringify({ ok: true, out, theme, ...sample.result.value, errors }))
} catch (err) {
  console.log(JSON.stringify({ ok: false, out, theme, error: String(err && err.message ? err.message : err) }))
} finally {
  try {
    ws?.close()
  } catch {
    // 忽略
  }
  killTree(child.pid)
  await sleep(800)
  try {
    child.kill('SIGKILL')
  } catch {
    // 忽略
  }
}
