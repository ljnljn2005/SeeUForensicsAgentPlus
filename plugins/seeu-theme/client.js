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

    // 欢迎页：logo + 一句定位 + 三步上手提示。
    // 槽位是 single/root，官方 brand-official 已被 overlay 关掉，所以这里可以整块自绘。
    const HERO_STEPS = [
      '侧栏「取证索引」选案件目录 → 建库（只写 .seeu-index，不动原始证据）',
      '直接提问：哪个检材、某个号码/账号、某段时间发生了什么',
      '看引用回查：每条结论都带原文件行号，可点到原始记录',
    ]

    function HeroBrand({ size }) {
      const s = typeof size === 'number' && size > 0 ? size : 56
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            maxWidth: '580px',
            textAlign: 'center',
          },
        },
        h(HeroMark, { size: s }),
        h(
          'div',
          {
            style: {
              fontSize: '13px',
              letterSpacing: '0.08em',
              opacity: 0.7,
            },
          },
          '证据链优先 · 只读取证 · 结论可回查',
        ),
        h(
          'ol',
          {
            style: {
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              fontSize: '12px',
              lineHeight: 1.75,
              opacity: 0.55,
            },
          },
          ...HERO_STEPS.map((text, index) => h('li', { key: String(index) }, `${index + 1}. ${text}`)),
        ),
      )
    }

    // 欢迎页快捷入口：把「接下来该干什么」做成按钮，减少第一次使用时的迷路。
    // 注意 conversation.hero.options 是 list 槽（scope: session），只在有会话时渲染。
    function HeroActions() {
      const shell = typeof window !== 'undefined' ? window.seeu : undefined
      // 最近案件：向本地索引 API 要一次列表，挑 builtAt 最新的一条显示在按钮下方
      const [recent, setRecent] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const res = await fetch('/seeu-index/list')
            if (!res.ok) return
            const body = await res.json()
            const list = Array.isArray(body?.indexes) ? body.indexes : []
            if (!alive || !list.length) return
            const sorted = list.slice().sort((a, b) => String(b.builtAt ?? '').localeCompare(String(a.builtAt ?? '')))
            setRecent(sorted[0])
          } catch {
            // 索引 API 不可用（例如纯 web 预览没起插件）时静默隐藏
          }
        }
        void load()
        return () => { alive = false }
      }, [])
      // 默认本地模型：外壳注入的配置 + 启动探测结果，只有配置了才显示
      const [lm, setLm] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            if (!shell || !shell.localModel || typeof shell.localModel.get !== 'function') return
            const view = await shell.localModel.get()
            if (!alive || !view) return
            const cfg = view.config
            if (!cfg || cfg.enabled === false) return
            const list = Array.isArray(cfg.models) ? cfg.models : []
            const first = list[0] || {}
            const name = String(cfg.model || first.name || first.id || '未命名模型')
            const probe = view.probe || null
            setLm({
              name,
              contextWindow: Number(cfg.contextWindow) || 0,
              probe,
              deploy: probe && probe.deploy ? probe.deploy : '',
              latencyMs: probe && Number(probe.latencyMs) > 0 ? Math.round(Number(probe.latencyMs)) : 0,
            })
          } catch {
            // 读不到配置就隐藏，不影响欢迎页其余内容
          }
        }
        void load()
        return () => { alive = false }
      }, [])

      const openLocalModel = () => {
        try {
          if (shell && typeof shell.openLocalModelSettings === 'function') void shell.openLocalModelSettings()
        } catch {
          // 忽略
        }
      }
      const openIndex = () => {
        try {
          const layout = ctxRef.current && ctxRef.current.layout
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('seeu-case-index')
        } catch (error) {
          console.warn('[seeu-theme] 打开取证索引失败', error)
        }
      }
      const actions = [
        {
          key: 'index',
          label: '打开取证索引',
          title: '在侧栏打开「取证索引」面板：选案件目录、建库、检索',
          run: openIndex,
        },
      ]
      if (shell && typeof shell.openLocalModelSettings === 'function') {
        actions.push({
          key: 'model',
          label: '本地模型设置',
          title: '配置 OpenAI 兼容网关（地址 / 模型 / 上下文窗口），并做能力自检',
          run: () => {
            void shell.openLocalModelSettings()
          },
        })
      }
      if (shell && typeof shell.openWorkspace === 'function') {
        actions.push({
          key: 'workspace',
          label: '取证工作区',
          title: '在文件管理器里打开 dsh 工作目录',
          run: () => {
            void shell.openWorkspace()
          },
        })
      }
      if (shell && typeof shell.openMountsWindow === 'function') {
        actions.push({
          key: 'mounts',
          label: '镜像挂载',
          title: '把 E01/DD/VMDK 等取证镜像挂成只读盘符（LovelyCarve CLI，挂载点仅在外壳运行期间有效）',
          run: () => {
            void shell.openMountsWindow()
          },
        })
      }
      if (shell && typeof shell.openSkillsWindow === 'function') {
        actions.push({
          key: 'skills',
          label: '技能管理器',
          title: '查看随包技能，导入 ZIP/文件夹技能包',
          run: () => {
            void shell.openSkillsWindow()
          },
        })
      }
      // 本机工具就绪度：外部工具路径 + 当前挂载数，一次读取即可（挂载窗口里可刷新）
      const [tools, setTools] = React.useState(null)
      const [mcp, setMcp] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            if (!shell || !shell.toolPaths || typeof shell.toolPaths.get !== 'function') return
            const view = await shell.toolPaths.get()
            if (!alive || !view) return
            const rows = Array.isArray(view.tools) ? view.tools : []
            const ready = rows.filter((row) => row && row.found).length
            let mounts = 0
            try {
              if (shell.mounts && typeof shell.mounts.get === 'function') {
                const state = await shell.mounts.get()
                mounts = Array.isArray(state?.mounts) ? state.mounts.length : 0
              }
            } catch {
              mounts = 0
            }
            if (alive) setTools({ ready, total: rows.length, mounts })
            try {
              if (shell && shell.mcp && typeof shell.mcp.info === 'function') {
                const info = await shell.mcp.info()
                if (alive && info) setMcp({ ok: !!(info.ok && info.exists), tools: Number(info.tools ?? 0) })
              }
            } catch {
              // MCP 信息不可用时静默隐藏
            }
          } catch {
            // 外壳 API 不可用时静默隐藏
          }
        }
        void load()
        return () => { alive = false }
      }, [])

      const fmtBytes = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MiB' : n >= 1024 ? Math.round(n / 1024) + ' KiB' : String(n ?? 0) + ' B')
      const fmtTime = (value) => {
        const ts = Date.parse(String(value ?? ''))
        return Number.isNaN(ts) ? '' : new Date(ts).toLocaleString('zh-CN', { hour12: false })
      }
      const caseLabel = recent ? (recent.caseName || String(recent.caseDir ?? '').split(/[\\/]/).filter(Boolean).pop() || '未命名案件') : ''
      const recentChip = recent
        ? h(
            'div',
            {
              key: 'recent',
              'data-seeu-recent': recent.dbPath,
              title: recent.dbPath,
              onClick: openIndex,
              style: {
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: '6px',
                marginTop: '2px',
                padding: '3px 12px',
                borderRadius: '999px',
                fontSize: '11.5px',
                lineHeight: 1.7,
                cursor: 'pointer',
                background: 'color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 32%, transparent)',
              },
            },
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } }, '最近案件：'),
            h('span', { style: { color: 'var(--dsw-alias-label-primary, #E6EDF7)', fontWeight: 600 } }, caseLabel),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } },
              [recent.sizeBytes ? fmtBytes(recent.sizeBytes) : '', fmtTime(recent.builtAt)].filter(Boolean).join(' · ')),
            h('span', { style: { color: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE)' } }, '打开 ›'),
          )
        : null
      const lmChip = lm
        ? h(
            'div',
            {
              key: 'lm',
              'data-seeu-local-model': lm.name,
              'data-seeu-local-model-deploy': lm.deploy || '',
              title: '默认本地模型：' + lm.name + (lm.probe && lm.probe.baseURL ? ' · ' + lm.probe.baseURL : '') + '（点击打开设置）',
              onClick: openLocalModel,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 12px',
                borderRadius: '999px',
                fontSize: '11.5px',
                lineHeight: 1.7,
                cursor: 'pointer',
                color: 'var(--dsw-alias-label-secondary, #A9BBD1)',
                background: 'var(--dsw-alias-bg-layer-2, #131E33)',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
              },
            },
            h('span', {
              style: {
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: lm.probe ? (lm.probe.ok ? '#34D399' : '#FBBF24') : 'var(--dsw-alias-label-caption, #6F839C)',
              },
            }),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } }, '本地模型：'),
            h('span', { style: { color: 'var(--dsw-alias-label-primary, #E6EDF7)', fontWeight: 600 } }, lm.name),
            h(
              'span',
              { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } },
              [
                lm.deploy === 'spark-single' ? 'Spark 单机' : lm.deploy === 'spark-dual' ? 'Spark 双机' : '',
                lm.contextWindow ? Math.round(lm.contextWindow / 1024) + 'k' : '',
                lm.probe ? (lm.probe.ok ? '网关可用' : '网关不可用') : '未探测',
                lm.latencyMs > 0 ? lm.latencyMs + ' ms' : '',
              ].filter(Boolean).join(' · '),
            ),
          )
        : null
      const toolsChip = tools
        ? h(
            'div',
            {
              key: 'tools',
              'data-seeu-tools': tools.ready + '/' + tools.total,
              'data-seeu-mounts': String(tools.mounts),
              title: '本机外部工具路径就绪度与当前镜像挂载数（点击打开设置）',
              onClick: openLocalModel,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 12px',
                borderRadius: '999px',
                fontSize: '11.5px',
                lineHeight: 1.7,
                cursor: 'pointer',
                color: 'var(--dsw-alias-label-secondary, #A9BBD1)',
                background: 'var(--dsw-alias-bg-layer-2, #131E33)',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
              },
            },
            h('span', {
              style: {
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: tools.ready >= tools.total ? '#34D399' : '#FBBF24',
              },
            }),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } }, '本机工具：'),
            h('span', { style: { color: 'var(--dsw-alias-label-primary, #E6EDF7)', fontWeight: 600 } }, tools.ready + '/' + tools.total + ' 就绪'),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } }, '· 镜像挂载 ' + tools.mounts),
          )
        : null
      const mcpChip = mcp
        ? h(
            'div',
            {
              key: 'mcp',
              'data-seeu-mcp': String(mcp.tools),
              title: '随会话启动的内置 SeeU MCP（只读索引工具）',
              onClick: openLocalModel,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 12px',
                borderRadius: '999px',
                fontSize: '11.5px',
                lineHeight: 1.7,
                cursor: 'pointer',
                color: 'var(--dsw-alias-label-secondary, #A9BBD1)',
                background: 'var(--dsw-alias-bg-layer-2, #131E33)',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
              },
            },
            h('span', {
              style: {
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: mcp.ok && mcp.tools > 0 ? '#34D399' : '#FBBF24',
              },
            }),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary, #8397B0)' } }, 'MCP：'),
            h('span', { style: { color: 'var(--dsw-alias-label-primary, #E6EDF7)', fontWeight: 600 } }, mcp.ok ? mcp.tools + ' 工具' : '未就绪'),
          )
        : null
      return h(
        'div',
        { className: 'seeu-hero-wrap', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' } },
        h(
        'div',
        {
          className: 'seeu-hero-actions',
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '8px',
            marginTop: '6px',
          },
        },
        ...actions.map((action) =>
          h(
            'button',
            {
              key: action.key,
              type: 'button',
              title: action.title,
              'data-seeu-action': action.key,
              onClick: action.run,
              style: {
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: '999px',
                fontSize: '12px',
                lineHeight: 1.6,
                color: 'var(--dsw-alias-label-secondary, #A9BBD1)',
                background: 'var(--dsw-alias-bg-layer-2, #131E33)',
                border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))',
              },
            },
            action.label,
          ),
        ),
        ),
        recentChip,
        lmChip,
        toolsChip,
        mcpChip,
      )
    }

    // ── 注册 ───────────────────────────────────────────────────────────────
    const inject = ['slots', 'layout']
    const ctxRef = { current: undefined }

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
      own('conversation.hero.brand.mark', HeroBrand)
      try {
        ctxRef.current = ctx
      } catch {
        // ignore
      }
      try {
        ctx.slots.inject('conversation.hero.options', () =>
          ctx.slots.register({ name: 'conversation.hero.options', id: 'seeu-hero-actions', order: 10 }, HeroActions),
        )
      } catch (error) {
        console.warn('[seeu-theme] 无法注册欢迎页快捷入口', error)
      }
    }

    return { apply, inject }
  },
})
