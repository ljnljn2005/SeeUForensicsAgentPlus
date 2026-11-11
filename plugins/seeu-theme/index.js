/**
 * SeeU 取证主题 —— 宿主端 half。
 *
 * 做两件事：
 *   1. 首屏注入主题 CSS（`webserver/index-inject`），避免先闪一下官方灰蓝再变深海的 FOUC；
 *   2. 注册 `/seeu-theme/theme.css` 路由，供客户端 half 兜底注入与人工排查。
 *
 * 注册方式：resources/forensics/cordis.patch.yml 末尾
 *   - insert:
 *       - id: seeu-theme
 *         name: ../../plugins/seeu-theme/index.js
 * （相对路径基准是 patch 文件所在目录；开发态=仓库根，打包态=asar 根，两态同形。）
 */

import { readFileSync } from 'node:fs'

export const name = 'seeu-theme'

const CSS_URL = new URL('./theme.css', import.meta.url)
const STYLE_ID = 'seeu-theme'
const ROUTE = '/seeu-theme/theme.css'

function readThemeCss() {
  try {
    return readFileSync(CSS_URL, 'utf8')
  } catch {
    return ''
  }
}

export function apply(ctx) {
  const css = readThemeCss()

  // 首屏注入：index.html 的 <head> 里直接带上 <style id="seeu-theme">，
  // 浏览器解析到 body 时 token 就已经是取证配色了。
  if (css !== '') {
    ctx.on(
      'webserver/index-inject',
      (table) => {
        table.push({
          kind: 'html',
          placement: 'head',
          html: `<style id="${STYLE_ID}">\n${css}\n</style>`,
        })
      },
      { prepend: true },
    )
  }

  // 兜底路由：客户端 half 发现 <style> 不在（例如首屏注入被别的插件挤掉）时，
  // 用 <link rel="stylesheet" href="/seeu-theme/theme.css"> 补上；也方便 curl 检查。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: ROUTE,
          handler: (_req, res) => {
            res.writeHead(200, {
              'content-type': 'text/css; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(readThemeCss())
          },
        }),
      'seeu-theme: /seeu-theme/theme.css 路由',
    )
  })
}
