/**
 * 127.0.0.1 的 cookie 不区分端口：外壳每换一个端口启动，都会多一条 dsh-auth-<hash>。
 * 累积到 16 KB 后 dsh 的 Node HTTP 服务直接回 431，首页白屏 —— 启动时把非当前端口的旧条目清掉。
 * 纯函数放这里，便于单测（主进程通过 src/main.ts → esbuild 打包进 dist/main.cjs）。
 */

/** 从 dsh 的 cookie 值（v1.<base64url JSON>）里解出 authority（host:port）；解不出返回 ''。 */
export function decodeAuthCookieAuthority(value) {
  const raw = String(value ?? '')
  if (raw === '') return ''
  const payload = raw.startsWith('v1.') ? raw.slice(3) : raw
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof parsed?.authority === 'string' ? parsed.authority : ''
  } catch {
    return ''
  }
}

/** 返回应当清掉的旧 dsh-auth cookie 名字（authority 为空或与当前 origin 不同的都算旧）。 */
export function pickStaleAuthCookies(cookies, origin) {
  const stale = []
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    const name = String(cookie?.name ?? '')
    if (!name.startsWith('dsh-auth-')) continue
    if (decodeAuthCookieAuthority(cookie?.value) !== String(origin)) stale.push(name)
  }
  return stale
}
