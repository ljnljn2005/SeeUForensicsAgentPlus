/**
 * SeeU 取证主题 —— 客户端 half（Web UI）。
 *
 * 职责（都不碰业务逻辑）：
 *   1. 占品牌槽位：侧栏 logo/名称、欢迎页大 logo（官方 brand-official 已由 overlay 关掉，
 *      避免同一个槽位叠加两份）。
 *   2. 标题与语言：把「DeepSeek Harness」改成产品名；html lang=zh-CN。
 *   3. 兜底样式：正常路径是宿主 half 在首屏 index.html 里注入 <style id="seeu-theme">；
 *      这里只在没注入到时补一条 <link>，保证「最差也有皮肤」。
 *
 * 兼容性：官方会重写 <title>（切会话、切面板），所以用 MutationObserver 跟随修正。
 */

const PRODUCT_TITLE = 'SeeU 取证智能体增强版'
const STYLE_ID = 'seeu-theme'
const FALLBACK_HREF = '/seeu-theme/theme.css'

window.__ModuleLoader__.load({
  id: '@seeu/theme',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ── 3. 样式兜底 ────────────────────────────────────────────────────────
    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = FALLBACK_HREF
      link.dataset.seeuTheme = 'fallback'
      document.head.appendChild(link)
    }

    // ── 2. 标题 / 语言 ─────────────────────────────────────────────────────
    function takeTitle() {
      const fix = () => {
        const current = document.title
        if (current === '' || current === 'DeepSeek Harness' || current === 'DSH') {
          document.title = PRODUCT_TITLE
        }
      }
      fix()
      const titleEl = document.querySelector('title')
      if (titleEl === null) return
      const observer = new MutationObserver(fix)
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
    }

    // ── 1. 品牌槽位 ────────────────────────────────────────────────────────
    // 盾牌 + 放大镜：取证语义（保护证据 / 检索线索），描边风格跟随文字色。
    function Mark({ size }) {
      const s = typeof size === 'number' && size > 0 ? size : 18
      return h(
        'svg',
        {
          width: s,
          height: s,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M12 3.2 18.8 6v5.6c0 4.1-2.9 7.6-6.8 8.8-3.9-1.2-6.8-4.7-6.8-8.8V6L12 3.2Z' }),
        h('circle', { cx: 10.9, cy: 11, r: 2.7 }),
        h('path', { d: 'm13 13.1 3.9 3.9' }),
      )
    }

    function Wordmark() {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: '4px',
            fontWeight: 650,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          },
        },
        'SeeU',
        h('span', { style: { fontWeight: 500, opacity: 0.72, fontSize: '0.92em' } }, '取证'),
      )
    }

    // 欢迎页 logo：比侧栏大一档，带一点光晕，和"证据可信"的冷静感一致。
    function HeroMark({ size }) {
      const s = typeof size === 'number' && size > 0 ? size : 56
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: `${s}px`,
            height: `${s}px`,
            borderRadius: `${Math.round(s * 0.26)}px`,
            color: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE)',
            background:
              'radial-gradient(120% 120% at 30% 20%, rgba(34,211,238,0.18), rgba(34,211,238,0.04) 60%, transparent 70%)',
            boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.22)',
          },
        },
        h(Mark, { size: Math.round(s * 0.56) }),
      )
    }

    // ── 注册 ───────────────────────────────────────────────────────────────
    const inject = ['slots']

    function apply(ctx) {
      ensureStyles()
      try {
        document.documentElement.lang = 'zh-CN'
      } catch {
        // 非浏览器环境忽略
      }
      takeTitle()

      const own = (slot, component) => {
        try {
          ctx.slots.inject(slot, () => ctx.slots.register({ name: slot }, component))
        } catch (error) {
          // 槽位不存在/被别的插件占用时不影响其余功能
          console.warn(`[seeu-theme] 无法注册槽位 ${slot}`, error)
        }
      }
      own('sidebar.brand.mark', Mark)
      own('sidebar.brand.name', Wordmark)
      own('conversation.hero.brand.mark', HeroMark)
    }

    return { apply, inject }
  },
})
