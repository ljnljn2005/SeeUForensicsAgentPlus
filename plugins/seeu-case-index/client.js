window.__ModuleLoader__.load({
  id: '@seeu/case-index',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    const api = async (path, params) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      const res = await fetch(`/seeu-index${path}?${qs.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    };
    const post = async (path, payload) => {
      const res = await fetch(`/seeu-index${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    };

    // ---------- 主题 token（全部来自 seeu-theme，只在缺 token 时用暗色兜底；不硬编码主色） ----------
    const C_FG = 'var(--dsw-alias-label-primary, #E6EDF7)';
    const C_FG2 = 'var(--dsw-alias-label-secondary, #A9BBD1)';
    const C_FG3 = 'var(--dsw-alias-label-tertiary, #8397B0)';
    const C_BG0 = 'var(--dsw-alias-bg-base, #0A111E)';
    const C_BG1 = 'var(--dsw-alias-bg-layer-1, #0E1728)';
    const C_BG2 = 'var(--dsw-alias-bg-layer-2, #131E33)';
    const C_BG3 = 'var(--dsw-alias-bg-layer-3, #18253D)';
    const C_L1 = 'var(--dsw-alias-border-l1, rgba(34, 211, 238, 0.10))';
    const C_L2 = 'var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.18))';
    const C_ACC = 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE)';
    const C_ACC_SOFT = 'color-mix(in srgb, ' + C_ACC + ' 15%, transparent)';
    const C_ACC_LINE = 'color-mix(in srgb, ' + C_ACC + ' 55%, transparent)';
    const C_HOVER = 'var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09))';
    const C_ACTIVE = 'var(--dsw-alias-interactive-bg-active, rgba(34, 211, 238, 0.16))';
    const C_OK = 'var(--dsw-alias-state-success-primary, #34D399)';
    const C_WARN = 'var(--dsw-alias-state-warning-primary, #FBBF24)';
    const C_ERR = 'var(--dsw-alias-state-error-primary, #F87171)';
    const FONT_CODE = 'var(--dsh-font-family-code-default, ui-monospace, Consolas, monospace)';
    const R_SM = 6;
    const R_MD = 8;
    const R_LG = 10;

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 14, minHeight: 320, color: C_FG, fontSize: 13 },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      input: { flex: '1 1 260px', minWidth: 0, padding: '6px 9px', borderRadius: R_SM, border: '1px solid ' + C_L2, background: C_BG0, color: 'inherit', fontSize: 12.5, outline: 'none' },
      btn: { padding: '5px 11px', borderRadius: R_SM, border: '1px solid ' + C_L2, background: 'transparent', color: C_FG2, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
      btnPrimary: { padding: '5px 12px', borderRadius: R_SM, border: '1px solid transparent', background: C_ACC, color: C_BG0, cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
      muted: { color: C_FG3, fontSize: 11.5 },
      panel: { border: '1px solid ' + C_L1, borderRadius: R_LG, background: C_BG1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 },
      card: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
      list: { display: 'flex', flexDirection: 'column', maxHeight: 320, overflow: 'auto' },
      item: { padding: '5px 8px', borderRadius: R_SM, display: 'flex', gap: 8, alignItems: 'baseline', borderBottom: '1px solid ' + C_L1 },
      crumb: { padding: '3px 8px', borderRadius: 999, border: '1px solid transparent', fontSize: 11.5, color: C_FG2, cursor: 'pointer' },
      mono: { fontFamily: FONT_CODE, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: C_FG2 },
      err: { color: C_ERR, fontSize: 12 },
      ellipsis: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      seg: { display: 'flex', gap: 3, flexWrap: 'wrap', padding: 3, borderRadius: R_LG, border: '1px solid ' + C_L1, background: C_BG1 },
      segOn: { padding: '5px 11px', borderRadius: R_SM, border: '1px solid ' + C_ACC_LINE, background: C_ACC_SOFT, color: C_FG, cursor: 'pointer', fontSize: 12, fontWeight: 600 },
      segOff: { padding: '5px 11px', borderRadius: R_SM, border: '1px solid transparent', background: 'transparent', color: C_FG2, cursor: 'pointer', fontSize: 12 },
      filter: { width: 108, padding: '5px 7px', borderRadius: R_SM, border: '1px solid ' + C_L2, background: C_BG0, color: 'inherit', fontSize: 12, outline: 'none' },
      tag: { padding: '0 6px', borderRadius: 999, background: 'color-mix(in srgb, currentColor 12%, transparent)', color: C_FG2, fontSize: 10.5, lineHeight: '16px', whiteSpace: 'nowrap' },
      tableWrap: { overflow: 'auto', maxHeight: 320, border: '1px solid ' + C_L1, borderRadius: R_MD },
      table: { borderCollapse: 'separate', borderSpacing: 0, fontSize: 11.5, width: '100%' },
      th: { position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid ' + C_L2, whiteSpace: 'nowrap', fontWeight: 600, color: C_FG2, background: C_BG2 },
      td: { padding: '4px 8px', borderBottom: '1px solid ' + C_L1, whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'top' },
      trClick: { cursor: 'pointer' },
      barTrack: { flex: 1, minWidth: 60, height: 8, borderRadius: 999, background: 'color-mix(in srgb, currentColor 10%, transparent)', overflow: 'hidden' },
      barFill: { height: 8, borderRadius: 999, background: C_ACC },
      statRow: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' },
      statItem: { display: 'inline-flex', alignItems: 'baseline', gap: 4 },
      statNum: { fontSize: 16, fontWeight: 650, fontVariantNumeric: 'tabular-nums' },
      tabs: { display: 'flex', gap: 3, flexWrap: 'wrap', padding: 3, borderRadius: R_LG, border: '1px solid ' + C_L1, background: C_BG1 },
      tab: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', border: '1px solid transparent', borderRadius: R_SM, background: 'transparent', cursor: 'pointer', fontSize: 12, lineHeight: 1.35, color: C_FG2 },
      tabOn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', border: '1px solid ' + C_ACC_LINE, borderRadius: R_SM, background: C_ACC_SOFT, cursor: 'pointer', fontSize: 12, lineHeight: 1.35, color: C_FG, fontWeight: 600 },
      tabBadge: { padding: '0 5px', borderRadius: 999, fontSize: 10, lineHeight: '15px', fontVariantNumeric: 'tabular-nums', color: C_FG3, background: 'color-mix(in srgb, currentColor 12%, transparent)' },
      kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 8 },
      kpi: { minWidth: 0, padding: '8px 10px', borderRadius: R_MD, border: '1px solid ' + C_L1, background: C_BG2 },
      kpiLabel: { fontSize: 10.5, letterSpacing: '0.04em', color: C_FG3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiValue: { marginTop: 2, fontSize: 17, fontWeight: 650, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_CODE, color: C_FG, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      kpiText: { fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' },
      title: { fontSize: 13, fontWeight: 600, color: C_FG, display: 'inline-flex', alignItems: 'center', gap: 6 },
      noticeOk: { padding: '6px 10px', borderRadius: R_SM, border: '1px solid color-mix(in srgb, ' + C_OK + ' 35%, transparent)', background: 'color-mix(in srgb, ' + C_OK + ' 10%, transparent)', color: C_OK, fontSize: 11.5 },
      noticeErr: { padding: '6px 10px', borderRadius: R_SM, border: '1px solid color-mix(in srgb, ' + C_ERR + ' 35%, transparent)', background: 'color-mix(in srgb, ' + C_ERR + ' 10%, transparent)', color: C_ERR, fontSize: 11.5 },
      noticeInfo: { padding: '6px 10px', borderRadius: R_SM, border: '1px solid ' + C_L1, background: 'color-mix(in srgb, ' + C_BG3 + ' 60%, transparent)', color: C_FG2, fontSize: 11.5 },
      noticeWarn: { padding: '6px 10px', borderRadius: R_SM, border: '1px solid color-mix(in srgb, #FBBF24 40%, transparent)', background: 'color-mix(in srgb, #FBBF24 12%, transparent)', color: '#FBBF24', fontSize: 11.5 },
      rowTime: { flex: 'none', color: C_FG3, fontFamily: FONT_CODE, fontSize: 11, whiteSpace: 'nowrap' },
      crumbOn: { padding: '3px 8px', borderRadius: 999, border: '1px solid ' + C_ACC_LINE, borderLeft: '3px solid ' + C_ACC, background: C_ACC_SOFT, color: C_FG, fontSize: 11.5, fontWeight: 600 },
    };

    // hover / 焦点 / 骨架 / 吸顶表头这些必须走 CSS（内联样式表达不了伪类）。
    const STYLE_ID = 'seeu-case-index-style';
    const CSS_TEXT = `
.seeu-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px; }
.seeu-kpi { min-width: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md, 8px); border: 1px solid var(--dsw-alias-border-l1, rgba(34, 211, 238, 0.10)); background: var(--dsw-alias-bg-layer-2, #131E33); }
.seeu-kpi-label { font-size: 10.5px; letter-spacing: .04em; color: var(--dsw-alias-label-tertiary, #8397B0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seeu-kpi-value { margin-top: 2px; font-size: 17px; font-weight: 650; line-height: 1.25; font-variant-numeric: tabular-nums; font-family: var(--dsh-font-family-code-default, ui-monospace, Consolas, monospace); color: var(--dsw-alias-label-primary, #E6EDF7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seeu-kpi-value.is-text { font-size: 12.5px; font-weight: 600; font-family: inherit; }
.seeu-tabs { display: flex; gap: 3px; flex-wrap: wrap; padding: 3px; border-radius: var(--dsw-radius-lg, 10px); background: var(--dsw-alias-bg-layer-1, #0E1728); border: 1px solid var(--dsw-alias-border-l1, rgba(34, 211, 238, 0.10)); }
.seeu-tab { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border: 1px solid transparent; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-secondary, #A9BBD1); font-size: 12px; line-height: 1.35; cursor: pointer; transition: background .12s ease, color .12s ease, border-color .12s ease; }
.seeu-tab:hover { color: var(--dsw-alias-label-primary, #E6EDF7); background: var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09)); }
.seeu-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary, #E6EDF7); font-weight: 600; border-color: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 15%, transparent); }
.seeu-tab-badge { padding: 0 5px; border-radius: 999px; font-size: 10px; line-height: 15px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary, #8397B0); background: color-mix(in srgb, currentColor 12%, transparent); }
.seeu-tab[aria-selected='true'] .seeu-tab-badge { color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE); background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 16%, transparent); }
.seeu-tree { display: flex; flex-direction: column; gap: 1px; }
.seeu-tree-row { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 3px 8px; border-left: 2px solid transparent; border-radius: var(--dsw-radius-sm, 6px); cursor: pointer; font-size: 12.5px; color: var(--dsw-alias-label-primary, #E6EDF7); }
.seeu-tree-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09)); }
.seeu-tree-row.is-active { border-left-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE); background: var(--dsw-alias-interactive-bg-active, rgba(34, 211, 238, 0.16)); }
.seeu-tree-guide { flex: none; width: 1px; align-self: stretch; margin: 1px 2px; background: linear-gradient(180deg, var(--dsw-alias-border-l3, rgba(148, 163, 184, 0.28)), transparent); }
.seeu-tree-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seeu-tree-meta { flex: none; color: var(--dsw-alias-label-tertiary, #8397B0); font-size: 11px; white-space: nowrap; }
.seeu-tree-remark { flex: 1 1 0; min-width: 0; color: var(--dsw-alias-label-tertiary, #8397B0); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seeu-tree-count { flex: none; color: var(--dsw-alias-label-tertiary, #8397B0); font-size: 11px; font-variant-numeric: tabular-nums; }
.seeu-rows { display: flex; flex-direction: column; }
.seeu-row { display: flex; align-items: baseline; gap: 8px; min-height: 30px; padding: 5px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(34, 211, 238, 0.10)); border-radius: var(--dsw-radius-sm, 6px); font-size: 12.5px; }
.seeu-row.is-clickable { cursor: pointer; }
.seeu-row.is-clickable:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09)); }
.seeu-hl { background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 26%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.seeu-row-time { flex: none; color: var(--dsw-alias-label-tertiary, #8397B0); font-family: var(--dsh-font-family-code-default, ui-monospace, Consolas, monospace); font-size: 11px; white-space: nowrap; }
.seeu-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 12px; border: 1px dashed var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.18)); border-radius: var(--dsw-radius-md, 8px); background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #131E33) 60%, transparent); color: var(--dsw-alias-label-tertiary, #8397B0); font-size: 12px; text-align: center; }
.seeu-empty-title { color: var(--dsw-alias-label-secondary, #A9BBD1); font-size: 12.5px; font-weight: 600; }
.seeu-empty-text { line-height: 1.6; max-width: 460px; }
.seeu-skel-row { height: 26px; border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-skeleton, rgba(148, 163, 184, 0.10)); animation: seeu-ci-pulse 1.1s ease-in-out infinite; }
@keyframes seeu-ci-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
.seeu-spin { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-tertiary, #8397B0) 35%, transparent); border-top-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE); animation: seeu-ci-spin 0.8s linear infinite; vertical-align: -2px; }
@keyframes seeu-ci-spin { to { transform: rotate(360deg); } }
.seeu-btn { border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.18)); background: transparent; color: var(--dsw-alias-label-secondary, #A9BBD1); border-radius: var(--dsw-radius-sm, 6px); padding: 5px 11px; font-size: 12px; cursor: pointer; transition: background .12s ease, color .12s ease, border-color .12s ease; }
.seeu-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary, #E6EDF7); border-color: var(--dsw-alias-border-l3, rgba(148, 163, 184, 0.28)); background: var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09)); }
.seeu-btn:disabled { opacity: 0.5; cursor: default; }
.seeu-btn.is-primary { border: 1px solid transparent; background: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE); color: var(--dsw-alias-bg-base, #0A111E); font-weight: 600; }
.seeu-btn.is-primary:hover:not(:disabled) { filter: brightness(1.08); }
.seeu-table-wrap { overflow: auto; max-height: 360px; border: 1px solid var(--dsw-alias-border-l1, rgba(34, 211, 238, 0.10)); border-radius: var(--dsw-radius-md, 8px); }
.seeu-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 11.5px; }
.seeu-table thead th { position: sticky; top: 0; z-index: 1; text-align: left; padding: 6px 8px; white-space: nowrap; font-weight: 600; color: var(--dsw-alias-label-secondary, #A9BBD1); background: var(--dsw-alias-bg-layer-2, #131E33); border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.18)); }
.seeu-table tbody td { padding: 4px 8px; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary, #E6EDF7); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(34, 211, 238, 0.10)); }
.seeu-table tbody tr:last-child td { border-bottom-color: transparent; }
.seeu-table tbody tr.is-clickable { cursor: pointer; }
.seeu-table tbody tr.is-clickable:hover td { background: var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09)); }
.seeu-crumb { padding: 3px 8px; border: 1px solid transparent; border-radius: 999px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #A9BBD1); cursor: pointer; }
.seeu-crumb:hover { color: var(--dsw-alias-label-primary, #E6EDF7); background: var(--dsw-alias-interactive-bg-hover, rgba(34, 211, 238, 0.09)); }
.seeu-crumb.is-active { color: var(--dsw-alias-label-primary, #E6EDF7); font-weight: 600; border-color: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 45%, transparent); border-left: 3px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE); background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color, #22D3EE) 12%, transparent); }
.seeu-scroll { scrollbar-width: thin; }
`;

    /** 样式只注入一次（唯一 id）；主题 token 由 seeu-theme 提供，深浅色自动适配。 */
    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      const tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.textContent = CSS_TEXT;
      document.head.appendChild(tag);
    }

    // 工厂加载时就把样式挂上，避免首帧无样式闪烁。
    ensureStyle();

    const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : n > 1024 ? `${(n / 1024).toFixed(0)} KiB` : `${n} B`);

    const PAGE = 30;
    const TABLE_PAGE = 20;
    const TABS = [
      ['tree', '树'],
      ['search', '检索'],
      ['records', '记录'],
      ['entity', '实体'],
      ['timeline', '时间线'],
      ['tables', '表'],
      ['cross', '跨案'],
    ];
    const BUCKETS = [
      ['hour', '按小时'],
      ['day', '按天'],
      ['month', '按月'],
    ];

    /** 统一的剪贴板出口：Electron 走 preload 桥，纯 web 预览退回 navigator.clipboard。 */
    const clipboardWrite = async (text) => {
      const value = String(text ?? '');
      if (!value) throw new Error('没有可复制的内容');
      if (window.seeu?.writeClipboard) await window.seeu.writeClipboard(value);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error('当前环境不支持剪贴板');
      return value.length;
    };

    /** 把筛选条件拼成一行中文，供清单抬头使用。 */
    // CSV 文本落盘：Electron 桥（见 src/preload.ts 的 saveExport）优先，web 预览回退成浏览器下载。
    async function saveCsvText(name, text) {
      const bridge = window.seeu && typeof window.seeu.saveExport === 'function' ? window.seeu : null;
      if (bridge) {
        const saved = await bridge.saveExport(name, text);
        return saved ?? { ok: false, error: '保存失败' };
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, path: name, downloaded: true };
    }

    const describeFilters = (obj, labels = {}) => {
      const parts = [];
      for (const [key, label] of Object.entries(labels)) {
        const v = obj?.[key];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        parts.push(`${label} ${String(v).trim()}`);
      }
      if (obj?.from || obj?.to) parts.push(`时间 ${obj.from || '…'} ~ ${obj.to || '…'}`);
      return parts.length ? parts.join(' · ') : '无';
    };

    /** 关键词命中高亮：把 snippet 按查询词切开，命中片段包 <mark class="seeu-hl">（样式跟主题强调色走）。 */
    const escapeRe = (text) => String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlight = (text, query) => {
      const value = String(text ?? '');
      const q = String(query ?? '').trim();
      if (!q) return value;
      let re = null;
      try { re = new RegExp('(' + escapeRe(q) + ')', 'gi'); } catch { return value; }
      const parts = value.split(re);
      if (parts.length <= 1) return value;
      return parts.map((part, i) => (i % 2 === 1 ? h('mark', { key: i, className: 'seeu-hl' }, part) : part));
    };

    /** 逐条回查 /cite，拼成可粘贴进报告的 Markdown 引用清单（只返回文本，不写剪贴板）。 */
    const citationListMarkdown = async ({ db, title, items, metaLines = [] }) => {
      const lines = [`# ${title}`, ...metaLines, `索引库：${db}`, `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`, ''];
      let count = 0;
      let missing = 0;
      for (const item of items ?? []) {
        if (item?.id === null || item?.id === undefined) continue;
        count += 1;
        let c = null;
        try { c = await api('/cite', { db, id: item.id }); } catch { c = null; }
        const head = [c?.ev ?? item.fallback, c?.app, c?.ts, c?.line != null ? `第 ${c.line} 行` : ''].filter(Boolean).join(' · ');
        lines.push(`${count}. ${head}`);
        if (c?.citation) {
          const m = String(c.citation).match(/\(([^)]+)\)/);
          lines.push(`   引用：${m ? m[1] : c.citation}`);
        } else {
          missing += 1;
          lines.push('   引用：（该行无溯源句柄，只能作为导航线索）');
        }
        if (c?.verifyCmd) lines.push(`   回查：${c.verifyCmd}`);
        const snippet = String(c?.text ?? item.text ?? '').replace(/\s+/g, ' ').trim();
        if (snippet) lines.push(`   摘要：${snippet.slice(0, 240)}`);
        lines.push('');
      }
      if (missing) lines.push(`（其中 ${missing} 条无溯源句柄，已在清单里标注。）`);
      return { markdown: lines.join('\n'), count, missing };
    };

    // ---------- 通用小组件：空态 / 骨架 / 加载 / KPI 卡 ----------
    const EmptyState = ({ title, text, action }) => h('div', { className: 'seeu-empty', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 12px', border: '1px dashed ' + C_L2, borderRadius: R_MD, color: C_FG3, fontSize: 12, textAlign: 'center' } },
      title ? h('div', { className: 'seeu-empty-title', style: { color: C_FG2, fontSize: 12.5, fontWeight: 600 } }, title) : null,
      text ? h('div', { className: 'seeu-empty-text', style: { lineHeight: 1.6, maxWidth: 460 } }, text) : null,
      action ? h('div', { style: { marginTop: 2 } }, action) : null);

    const emptyHint = (text) => h(EmptyState, { text });

    const Spin = () => h('span', { className: 'seeu-spin', style: { display: 'inline-block', width: 11, height: 11, borderRadius: '50%', border: '2px solid ' + 'color-mix(in srgb, ' + C_FG3 + ' 35%, transparent)', borderTopColor: C_ACC, animation: 'seeu-ci-spin .8s linear infinite', verticalAlign: -2 } });
    // 兼容两种调用：h(LoadingLine, {text}) / LoadingLine('text')。
    const LoadingLine = (props) => {
      const text = typeof props === 'string' ? props : (props?.text ?? props?.children ?? '');
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: C_FG3, fontSize: 11.5 } }, h(Spin), text);
    };
    // 兼容 h(Skeleton, {n}) 与 Skeleton(n)。
    const Skeleton = (props) => {
      const n = typeof props === 'number' ? props : (props?.n ?? 3);
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        Array.from({ length: n }, (_, i) => h('div', { key: i, className: 'seeu-skel-row', style: { height: 26, borderRadius: R_SM, background: 'var(--dsw-alias-bg-skeleton, rgba(148, 163, 184, 0.10))' } })));
    };

    const KpiStrip = ({ items }) => h('div', { className: 'seeu-kpis', style: S.kpis }, items.map((it) => h('div', { key: it.label, className: 'seeu-kpi', style: S.kpi },
      h('div', { className: 'seeu-kpi-label', style: S.kpiLabel }, it.label),
      h('div', {
        className: 'seeu-kpi-value' + (it.text ? ' is-text' : ''),
        style: { ...S.kpiValue, ...(it.text ? S.kpiText : null) },
        title: String(it.value ?? ''),
      }, it.value ?? '—'))));

    const buttonClass = (primary) => (primary ? 'seeu-btn is-primary' : 'seeu-btn');

    const cellText = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

    /** 从 dbPath 里取出案件目录名（…/<案件>/.seeu-index/case-index.db）。 */
    function caseNameOf(p) {
      const parts = String(p ?? '').split(/[\\/]/).filter(Boolean);
      if (!parts.length) return '';
      if (parts.length >= 3 && parts[parts.length - 2] === '.seeu-index') return parts[parts.length - 3];
      return parts[parts.length - 1];
    }

    function actionButton(label, onClick, opts) {
      const o = opts ?? {};
      return h('button', {
        type: 'button',
        className: buttonClass(o.primary) + (o.className ? ` ${o.className}` : ''),
        style: { ...(o.primary ? S.btnPrimary : S.btn), ...(o.danger ? { color: '#F5A524' } : {}), ...(o.style ?? {}) },
        onClick,
        disabled: !!o.disabled,
        title: o.title,
        ...(o.attrs ?? {}),
      }, label);
    }

    function narrowInput(value, onChange, placeholder, opts) {
      const o = opts ?? {};
      return h('input', {
        style: { ...S.filter, ...(o.width ? { width: o.width } : {}) },
        value,
        placeholder,
        spellCheck: false,
        disabled: !!o.disabled,
        onChange: (e) => onChange(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter' && o.onEnter) o.onEnter(); },
      });
    }

    /** 统一的小请求状态机：加载 / 错误 / 数据，带竞态守卫。 */
    function useLoad(loader, deps) {
      const [state, setState] = useState({ loading: true, error: '', data: null });
      const seq = useRef(0);
      const run = useCallback(async () => {
        const mine = ++seq.current;
        setState((s) => ({ loading: true, error: '', data: s.data }));
        let data = null;
        try {
          data = await loader();
          if (mine === seq.current) setState({ loading: false, error: '', data });
        } catch (e) {
          data = null;
          if (mine === seq.current) setState({ loading: false, error: String(e.message ?? e), data: null });
        }
        // 返回值给调用方（如“同步后刷新并对比案件数”）用；旧调用方忽略即可。
        return mine === seq.current ? data : null;
      }, deps);
      useEffect(() => { void run(); }, [run]);
      return { loading: state.loading, error: state.error, data: state.data, reload: run };
    }

    /** pill 式分段控件；右侧数量 badge 形如「记录 22777」「跨案 3999」。 */
    function Tabs({ tab, onChange, counts }) {
      return h('div', { style: S.tabs, className: 'seeu-tabs', role: 'tablist' }, TABS.map(([key, label]) => {
        const on = tab === key;
        const n = counts ? counts[key] : null;
        return h('button', {
          key,
          type: 'button',
          role: 'tab',
          'aria-selected': on ? 'true' : 'false',
          className: 'seeu-tab' + (on ? ' is-active' : ''),
          style: on ? S.tabOn : S.tab,
          title: n != null ? `${label}：${n}` : label,
          onClick: () => onChange(key),
        }, label, n != null ? h('span', { className: 'seeu-tab-badge', style: S.tabBadge }, String(n)) : null);
      }));
    }

    const MetaRow = ({ label, children, mono }) => h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 } },
      h('span', { style: { flex: 'none', width: 40, color: C_FG3, fontSize: 11 } }, label),
      h('div', { style: { minWidth: 0, flex: 1, ...(mono ? { ...S.mono, fontSize: 11 } : { color: C_FG, fontSize: 12.5, wordBreak: 'break-word' }) } }, children));

    function CiteDetail({ detail }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h(MetaRow, { label: '句柄', mono: true },
          h('span', { style: { color: detail.citation ? C_ACC : C_FG3 } }, detail.citation ?? '（无溯源句柄：只能作为导航，不能作为证据引用）')),
        h(MetaRow, { label: '位置' }, `${detail.path ?? ''} · 第 ${detail.line ?? '?'} 行`),
        detail.ts ? h(MetaRow, { label: '时间' }, h('span', { style: { color: C_FG2 } }, String(detail.ts))) : null,
        detail.verifyCmd ? h(MetaRow, { label: '回查', mono: true }, detail.verifyCmd) : null,
        detail.text ? h('div', {
          className: 'seeu-scroll',
          style: { maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: FONT_CODE, fontSize: 11.5, lineHeight: 1.6, color: C_FG, background: C_BG0, border: '1px solid ' + C_L1, borderRadius: R_SM, padding: '8px 10px' },
        }, detail.text) : null);
    }

    // ---------- 视图：记录（分页 + 筛选 + 点行看引用） ----------
    function RecordsView({ db, seed, onCite }) {
      const base = useMemo(() => ({
        eid: seed?.eid != null ? String(seed.eid) : '',
        app: seed?.app ?? '',
        category: seed?.category ?? '',
        q: seed?.q ?? '',
        from: seed?.from ?? '',
        to: seed?.to ?? '',
      }), [seed]);
      const [draft, setDraft] = useState(base);
      const [applied, setApplied] = useState(base);
      const [offset, setOffset] = useState(0);
      const [copying, setCopying] = useState(false);
      const [note, setNote] = useState('');
      const [exporting, setExporting] = useState(false);
      const [exportNote, setExportNote] = useState('');
      // 检材下拉（名称来自 /evidences），用户不用记 eid
      const [evList, setEvList] = useState([]);
      // 应用/类别下拉：来自 /facets（按当前库的 record 统计）
      const [facets, setFacets] = useState(null);
      useEffect(() => {
        let alive = true;
        if (!db) { setEvList([]); setFacets(null); return undefined; }
        (async () => {
          try {
            const body = await api('/evidences', { db });
            if (alive) setEvList(body?.evidences ?? []);
          } catch {
            if (alive) setEvList([]);
          }
          try {
            const f = await api('/facets', { db });
            if (alive) setFacets(f?.apps?.length ? f : null);
          } catch {
            if (alive) setFacets(null);
          }
        })();
        return () => { alive = false; };
      }, [db]);
      const evName = (eid) => {
        const hit = evList.find((ev) => Number(ev.eid) === Number(eid));
        return hit && hit.name ? hit.name : '检材 ' + eid;
      };
      useEffect(() => { setDraft(base); setApplied(base); setOffset(0); }, [base]);
      // 短词（<3 字）逐行扫描受时间预算限制；结果可能不全时允许「继续扫描」追加预算。
      const [scanMore, setScanMore] = useState(0);
      const recParams = () => ({ db, ...applied, limit: PAGE, offset, ...(scanMore > 0 ? { scanBudgetMs: scanMore } : {}) });
      const { data, error, loading } = useLoad(() => api('/records', recParams()), [db, applied, offset, scanMore]);
      const scanMoreRecords = async () => {
        let base = 2500;
        try { base = Number((await api('/scan-budget'))?.scanBudgetMs) || 2500; } catch { /* 用默认预算 */ }
        setScanMore(Math.min(30000, Math.max(base, scanMore) + 2500));
      };
      const apply = () => { setOffset(0); setApplied({ ...draft }); };
      const clear = () => {
        const next = { eid: '', app: '', category: '', q: '', from: '', to: '' };
        setDraft(next);
        setApplied(next);
        setOffset(0);
      };
      const hasFilter = !!(applied.eid || applied.app || applied.category || applied.q || applied.from || applied.to);
      const total = data?.total ?? 0;
      const rows = data?.rows ?? [];
      // 把当前页记录导出成带 Goldeneyes 句柄的清单（逐条 /cite 回查）
      const copyPage = async () => {
        if (copying || !rows.length) return;
        setCopying(true);
        setNote('');
        try {
          const { markdown, count, missing } = await citationListMarkdown({
            db,
            title: 'SeeU 取证索引 · 记录引用清单',
            metaLines: [
              `筛选：${describeFilters(applied, { eid: '检材', app: '应用', category: '类别', q: '关键词' })}`,
              `共 ${total} 条，导出当前页 ${rows.length} 条`,
            ],
            items: rows.map((r) => ({
              id: r.id,
              fallback: [`检材 ${r.eid}`, r.app, r.ts, r.line != null ? `第 ${r.line} 行` : ''].filter(Boolean).join(' · '),
            })),
          });
          const chars = await clipboardWrite(markdown);
          setNote(`已复制 ${count} 条记录引用清单（${chars} 字符）${missing ? `，其中 ${missing} 条无句柄` : ''}`);
        } catch (e) {
          setNote(`复制失败：${String(e.message ?? e)}`);
        } finally {
          setCopying(false);
        }
      };
      // 把当前筛选的整批记录导出成 CSV 文件（Excel 可直接打开；web 预览回退为浏览器下载）
      const exportCsv = async () => {
        if (exporting || !db) return;
        setExporting(true);
        setExportNote('');
        try {
          const qs = new URLSearchParams({ db });
          for (const [k, v] of Object.entries(applied)) if (v !== '' && v != null) qs.set(k, String(v));
          qs.set('max', '20000');
          const res = await fetch('/seeu-index/export/records.csv?' + qs.toString());
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const raw = await res.text();
          // 注意：fetch 的 Response.text() 会吃掉 BOM，而 Excel 需要 BOM 才不乱码，所以这里补回去
          const text = raw.startsWith('\uFEFF') ? raw : '\uFEFF' + raw;
          const rowsOut = Number(res.headers.get('x-seeu-rows') ?? 0);
          const totalOut = Number(res.headers.get('x-seeu-total') ?? rowsOut);
          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const name = '记录导出-' + stamp + '.csv';
          const saved = window.seeu && typeof window.seeu.saveExport === 'function'
            ? await window.seeu.saveExport(name, text)
            : null;
          if (saved && saved.ok) {
            setExportNote('已导出 ' + rowsOut + ' 行' + (totalOut > rowsOut ? '（共 ' + totalOut + ' 条，单次最多 20000 行）' : '') + '到 ' + saved.path);
          } else if (saved && !saved.ok) {
            setExportNote('导出失败：' + (saved.error ?? '未知错误'));
          } else {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setExportNote('已下载 ' + rowsOut + ' 行' + (totalOut > rowsOut ? '（共 ' + totalOut + ' 条）' : '') + '：' + name);
          }
        } catch (e) {
          setExportNote('导出失败：' + String(e.message ?? e));
        } finally {
          setExporting(false);
        }
      };
      return h('div', { style: S.card },
        h('div', { style: { ...S.row, gap: 6 } },
          h('select', {
            style: { ...S.input, flex: 'none', width: 200 },
            value: draft.eid ?? '',
            disabled: !db,
            title: '按检材筛选：下拉里就是火眼的检材名称',
            onChange: (e) => setDraft((d) => ({ ...d, eid: e.target.value })),
            onKeyDown: (e) => { if (e.key === 'Enter') apply(); },
          },
            h('option', { value: '' }, '全部检材'),
            ...evList.map((ev) => h('option', { key: ev.eid, value: String(ev.eid) }, '检材 ' + ev.eid + (ev.name ? ' · ' + ev.name : '') + (ev.platform ? ' · ' + ev.platform : '')))),
          h('select', {
            style: { ...S.input, flex: 'none', width: 150 },
            value: draft.app ?? '',
            disabled: !db,
            title: '按应用筛选：下拉里是索引里出现过的应用（带记录数）',
            onChange: (e) => setDraft((d) => ({ ...d, app: e.target.value })),
            onKeyDown: (e) => { if (e.key === 'Enter') apply(); },
          },
            h('option', { value: '' }, '全部应用'),
            ...((facets?.apps ?? []).map((a) => h('option', { key: a.app, value: a.app }, a.app + '（' + a.n + '）')))),
          h('select', {
            style: { ...S.input, flex: 'none', width: 150 },
            value: draft.category ?? '',
            disabled: !db,
            title: '按类别筛选：下拉里是索引里出现过的类别（带记录数）',
            onChange: (e) => setDraft((d) => ({ ...d, category: e.target.value })),
            onKeyDown: (e) => { if (e.key === 'Enter') apply(); },
          },
            h('option', { value: '' }, '全部类别'),
            ...((facets?.categories ?? []).map((a) => h('option', { key: a.category, value: a.category }, a.category + '（' + a.n + '）')))),
          narrowInput(draft.q, (v) => setDraft((d) => ({ ...d, q: v })), '关键词 q', { width: 140, onEnter: apply }),
          narrowInput(draft.from, (v) => setDraft((d) => ({ ...d, from: v })), '起 2025-04-01', { width: 108, onEnter: apply }),
          narrowInput(draft.to, (v) => setDraft((d) => ({ ...d, to: v })), '止 2025-04-30', { width: 108, onEnter: apply }),
          actionButton('查询', apply, { primary: true }),
          hasFilter ? actionButton('清空', clear) : null),
        applied.from || applied.to ? h('div', { style: { ...S.noticeInfo, padding: '4px 8px' } }, `时间范围 ${applied.from || '…'} ~ ${applied.to || '…'}（由时间线钻取带入）`) : null,
        error ? h('div', { style: S.noticeErr }, `记录读取失败：${error}`) : null,
        loading && !data ? h(Skeleton, { n: 4 }) : null,
        !loading && !error && data && total === 0
          ? h(EmptyState, { title: '没有匹配记录', text: '清空关键词或换筛选条件再试；也可以点「清空」回到全部记录。', action: hasFilter ? actionButton('清空筛选', clear) : null })
          : null,
        data && total > 0 ? h('div', null,
          h('div', { style: { ...S.row, marginBottom: 4 } },
            h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, `记录 ${data.totalApprox ? '≥ ' : ''}${total} 条`),
            h('span', { style: S.muted }, `当前 ${data.offset + 1}-${data.offset + data.returned}`),
            data.hint ? h('span', { style: { ...S.muted, maxWidth: 460 } }, data.hint) : null,
            data.totalApprox || data.partialScan
              ? h('span', { style: { ...S.noticeWarn, padding: '2px 8px', maxWidth: 780 } },
                '结果可能不全（预算内没扫完）',
                actionButton('继续扫描 +2.5 秒', scanMoreRecords, { disabled: loading || scanMore >= 30000, title: '追加扫描预算后重跑本次关键词', attrs: { 'data-continue-scan': 'records' } }))
              : null,
            loading ? h('span', { style: S.muted }, '更新中…') : null,
            h('span', { style: { marginLeft: 'auto' } },
              actionButton(copying ? '复制中…' : '复制本页引用清单', copyPage, { disabled: copying }),
              actionButton(exporting ? '导出中…' : '导出 CSV', exportCsv, { disabled: exporting }))),
          note ? h('div', { style: S.noticeInfo }, note) : null,
          exportNote ? h('div', { style: S.noticeInfo }, exportNote) : null,
          h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 420, overflow: 'auto' } },
            rows.map((r) => h('div', {
              key: r.id,
              className: 'seeu-row is-clickable',
              style: { display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5 },
              title: `第 ${r.line} 行，点一下看引用句柄`,
              onClick: () => onCite(r.id),
            },
              h('span', { style: { ...S.tag, flex: 'none' }, title: '检材 ' + r.eid }, `${evName(r.eid)} · ${r.app}`),
              h('span', { className: 'seeu-row-time', style: S.rowTime }, r.ts ?? ''),
              h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, r.cat ?? ''),
              h('span', { style: S.ellipsis }, highlight(`${r.actor ? `${r.actor}：` : ''}${r.text ?? ''}`, applied.q)),
              h('span', { style: { flex: 'none', color: C_ACC, fontSize: 11 } }, '引用 ›')))),
          h('div', { style: { ...S.row, marginTop: 8 } },
            data.offset > 0 ? actionButton('上一页', () => setOffset(Math.max(0, data.offset - PAGE))) : null,
            data.next != null ? actionButton('下一页', () => setOffset(data.next)) : null,
            h('span', { style: S.muted }, `第 ${Math.floor(data.offset / PAGE) + 1} 页 · 点一条看引用句柄`)))
          : null);
    }

    // ---------- 视图：实体（聚合 → 唯一命中下钻提及） ----------
    function EntityView({ db, onCite }) {
      const [draft, setDraft] = useState({ kind: '', q: '', eid: '' });
      const [applied, setApplied] = useState(draft);
      const [offset, setOffset] = useState(0);
      const [copying, setCopying] = useState(false);
      const [exporting, setExporting] = useState(false);
      const [note, setNote] = useState('');
      const [evList, setEvList] = useState([]);
      useEffect(() => {
        let alive = true;
        if (!db) { setEvList([]); return undefined; }
        api('/evidences', { db })
          .then((body) => { if (alive) setEvList(body?.evidences ?? []); })
          .catch(() => { if (alive) setEvList([]); });
        return () => { alive = false; };
      }, [db]);
      const { data, error, loading } = useLoad(() => api('/entity', { db, ...applied, limit: PAGE, offset }), [db, applied, offset]);
      const apply = () => { setOffset(0); setApplied({ ...draft }); };
      const clear = () => {
        const next = { kind: '', q: '', eid: '' };
        setOffset(0);
        setDraft(next);
        setApplied(next);
      };
      const drill = (row) => {
        const next = { kind: row.kind, q: row.value, eid: applied.eid };
        setOffset(0);
        setDraft(next);
        setApplied(next);
      };
      const pickKind = (kind) => {
        const next = { ...draft, kind: draft.kind === kind ? '' : kind };
        setOffset(0);
        setDraft(next);
        setApplied(next);
      };
      const rows = data?.rows ?? [];
      const kinds = data?.kinds ?? [];
      const mention = data?.matched === 'mention';
      const hasFilter = !!(applied.kind || applied.q || applied.eid);
      // 实体聚合没有单条 record_id，导出的是"实体 → 出现次数 / 检材"清单，供直接粘进报告
      const copyEntities = async () => {
        if (copying || !rows.length) return;
        setCopying(true);
        setNote('');
        try {
          const lines = [
            '# SeeU 取证索引 · 实体清单',
            `筛选：${describeFilters(applied, { kind: '类型', q: '关键词', eid: '检材' })}`,
            `返回 ${data.returned} 条聚合 · 跨检材 ${data.crossEvidence ?? '-'} 条`,
            `索引库：${db}`,
            `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            '',
          ];
          rows.forEach((r, i) => {
            lines.push(`${i + 1}. [${r.kind}] ${r.value} — ${r.count} 次 · ${r.evidences} 检材`);
            if (Array.isArray(r.eids) && r.eids.length) lines.push(`   检材：${r.eids.join(', ')}`);
          });
          const chars = await clipboardWrite(lines.join('\n'));
          setNote(`已复制 ${rows.length} 条实体清单（${chars} 字符）`);
        } catch (e) {
          setNote(`复制失败：${String(e.message ?? e)}`);
        } finally {
          setCopying(false);
        }
      };
      const exportCsv = async () => {
        if (exporting || !db) return;
        setExporting(true);
        setNote('');
        try {
          const qs = new URLSearchParams({ db, max: '20000' });
          for (const key of ['kind', 'q', 'eid']) if (applied[key]) qs.set(key, applied[key]);
          const resp = await fetch('/seeu-index/export/entities.csv?' + qs.toString());
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const text = await resp.text();
          const rows = Number(resp.headers.get('x-seeu-rows') ?? 0);
          const total = Number(resp.headers.get('x-seeu-total') ?? rows);
          const truncated = resp.headers.get('x-seeu-truncated') === '1';
          const name = '实体导出-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.csv';
          await saveCsvText(name, '﻿' + text);
          setNote(`已导出 ${rows} 条实体${truncated ? `（共 ${total} 条，单次最多 20000 条）` : ''}（UTF-8 BOM，Excel 可直接打开）`);
        } catch (e) {
          setNote(`导出失败：${String(e.message ?? e)}`);
        } finally {
          setExporting(false);
        }
      };
      return h('div', { style: S.card },
        h('div', { style: { ...S.row, gap: 6 } },
          narrowInput(draft.kind, (v) => setDraft((d) => ({ ...d, kind: v })), '实体类型 kind', { width: 110, onEnter: apply }),
          narrowInput(draft.q, (v) => setDraft((d) => ({ ...d, q: v })), '值 / 关键词 q', { width: 150, onEnter: apply }),
          h('select', {
            style: { ...S.input, flex: 'none', width: 190 },
            value: draft.eid ?? '',
            disabled: !db,
            title: '按检材筛选：下拉里就是火眼的检材名称',
            onChange: (e) => { setDraft((d) => ({ ...d, eid: e.target.value })); setOffset(0); setApplied((a) => ({ ...a, eid: e.target.value })); },
            onKeyDown: (e) => { if (e.key === 'Enter') apply(); },
          },
            h('option', { value: '' }, '全部检材'),
            ...evList.map((ev) => h('option', { key: ev.eid, value: String(ev.eid) }, '检材 ' + ev.eid + (ev.name ? ' · ' + ev.name : '')))),
          actionButton('查询', apply, { primary: true }),
          hasFilter ? actionButton('清空', clear) : null,
          h('span', { style: { marginLeft: 'auto' } },
            actionButton(copying ? '复制中…' : '复制实体清单', copyEntities, { disabled: copying || !rows.length }),
            actionButton(exporting ? '导出中…' : '导出 CSV', exportCsv, { disabled: exporting || !db }))),
        note ? h('div', { style: S.noticeInfo }, note) : null,
        data && data.total != null
          ? h('div', { style: { ...S.row, gap: 6 } },
            h('span', { style: S.muted }, `共 ${data.total} 条聚合 · 当前 ${data.offset + 1}-${data.offset + data.returned}`),
            data.offset > 0 ? actionButton('上一页', () => setOffset(Math.max(0, data.offset - PAGE))) : null,
            data.next != null ? actionButton('下一页', () => setOffset(data.next)) : null,
            h('span', { style: S.muted }, `第 ${Math.floor(data.offset / PAGE) + 1} 页 · 点类别可下钻`))
          : null,
        kinds.length ? h('div', { style: { ...S.row, gap: 5 } },
          h('span', { style: S.muted }, '实体类别'),
          kinds.slice(0, 14).map((k) => {
            const on = applied.kind === k.kind;
            return h('span', {
              key: k.kind,
              role: 'button',
              title: '按该类别过滤',
              style: {
                ...S.tag, cursor: 'pointer', padding: '0 7px', lineHeight: '18px',
                border: '1px solid ' + (on ? C_ACC_LINE : 'transparent'),
                background: on ? C_ACC_SOFT : 'color-mix(in srgb, currentColor 10%, transparent)',
                color: on ? C_ACC : C_FG2,
              },
              onClick: () => pickKind(k.kind),
            }, `${k.kind} ${k.n}`);
          })) : null,
        error ? h('div', { style: S.noticeErr }, `实体读取失败：${error}`) : null,
        loading && !data ? h(Skeleton, { n: 4 }) : null,
        !loading && !error && data && data.returned === 0
          ? h(EmptyState, {
              title: hasFilter ? '没有匹配实体' : '该库没有实体数据',
              text: hasFilter ? '换个关键词或点「清空」；实体值按归一化后的精确值匹配。' : 'entity 表为空：先点「建库 / 更新」重建索引，再回来查看。',
              action: hasFilter ? actionButton('清空筛选', clear) : null,
            })
          : null,
        mention ? h('div', { style: S.card },
          h('div', { style: S.noticeInfo }, `精确命中 ${data.kind} = ${data.value} · ${data.returned} 条提及（跨 ${data.evidences ?? '-'} 个检材）`),
          (data.mentions ?? []).length
            ? h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 420, overflow: 'auto' } },
              data.mentions.map((m) => h('div', {
                key: m.record,
                className: 'seeu-row is-clickable',
                style: { display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5 },
                title: '点一下看引用句柄',
                onClick: () => onCite(m.record),
              },
                h('span', { style: { ...S.tag, flex: 'none' } }, `${m.eid}·${m.app}`),
                h('span', { style: S.rowTime }, m.ts ?? ''),
                h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, m.cat ?? ''),
                h('span', { style: S.ellipsis }, `第 ${m.line} 行`),
                h('span', { style: { flex: 'none', color: C_ACC, fontSize: 11 } }, '引用 ›'))))
            : h(EmptyState, { title: '没有提及记录', text: '该实体命中了聚合，但明细查询没有返回记录；换一个实体值再试。' }))
        : rows.length ? h('div', { style: S.card },
          h('div', { style: S.row },
            h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, `返回 ${data.returned} 条聚合`),
            h('span', { style: S.muted }, `跨检材 ${data.crossEvidence ?? '-'} 条 · 点一行下钻提及`)),
          h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 420, overflow: 'auto' } },
            rows.map((r) => h('div', {
              key: `${r.kind}|${r.value}`,
              className: 'seeu-row is-clickable',
              style: { display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5 },
              title: '点一下下钻到提及记录',
              onClick: () => drill(r),
            },
              h('span', { style: { ...S.tag, flex: 'none' } }, r.kind),
              h('span', { style: S.ellipsis }, r.value),
              h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, `${r.count} 次`),
              h('span', { style: { flex: 'none', color: r.evidences > 1 ? C_WARN : C_FG3, fontSize: 11 } }, r.evidences > 1 ? `跨 ${r.evidences} 检材` : `${r.evidences} 检材`)))))
          : null);
    }

    // ---------- 视图：时间线（小时/天/月分桶，点柱条钻取记录） ----------
    function TimelineView({ db, onDrill }) {
      const [draft, setDraft] = useState({ eid: '', app: '', from: '', to: '', bucket: 'day' });
      // 筛选下拉的数据源：检材名称（/evidences）+ 应用/类别（/facets），避免手输
      const [evList, setEvList] = useState([]);
      const [facets, setFacets] = useState(null);
      useEffect(() => {
        let alive = true;
        if (!db) { setEvList([]); setFacets(null); return undefined; }
        (async () => {
          try {
            const body = await api('/evidences', { db });
            if (alive) setEvList(body?.evidences ?? []);
          } catch {
            if (alive) setEvList([]);
          }
          try {
            const f = await api('/facets', { db });
            if (alive) setFacets(f?.apps?.length ? f : null);
          } catch {
            if (alive) setFacets(null);
          }
        })();
        return () => { alive = false; };
      }, [db]);
      const [copying, setCopying] = useState(false);
      const [note, setNote] = useState('');
      const [applied, setApplied] = useState(draft);
      const { data, error, loading } = useLoad(() => api('/timeline', { db, ...applied, limit: 200 }), [db, applied]);
      const apply = () => setApplied({ ...draft });
      const clear = () => {
        const next = { eid: '', app: '', from: '', to: '', bucket: draft.bucket };
        setDraft(next);
        setApplied(next);
      };
      const pickBucket = (bucket) => {
        setDraft((d) => ({ ...d, bucket }));
        setApplied((a) => ({ ...a, bucket }));
      };
      const rows = data?.rows ?? [];
      const max = rows.reduce((m, r) => Math.max(m, r.n ?? 0), 0) || 1;
      const bucketLabel = (BUCKETS.find(([key]) => key === applied.bucket) ?? BUCKETS[1])[1];
      const hasFilter = !!(applied.eid || applied.app || applied.from || applied.to);
      const total = rows.reduce((s, r) => s + (r.n ?? 0), 0);
      // 导出时间线清单：每个时间段一行，带记录数/检材数/应用数，可直接贴进报告
      const copyTimeline = async () => {
        if (copying || !rows.length) return;
        setCopying(true);
        setNote('');
        try {
          const lines = [
            '# SeeU 取证索引 · 时间线清单',
            `分桶：${bucketLabel}`,
            `筛选：${describeFilters(applied, { eid: '检材', app: '应用' })}`,
            `共 ${data.returned} 个时间段 · 合计 ${total} 条记录`,
            `索引库：${db}`,
            `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            '',
          ];
          rows.forEach((r, i) => {
            lines.push(`${i + 1}. ${r.bucket} — ${r.n} 条 · ${r.eids} 检材 · ${r.apps} 应用`);
          });
          const chars = await clipboardWrite(lines.join('\n'));
          setNote(`已复制 ${rows.length} 个时间段的清单（${chars} 字符）`);
        } catch (e) {
          setNote(`复制失败：${String(e.message ?? e)}`);
        } finally {
          setCopying(false);
        }
      };
      return h('div', { style: S.card },
        h('div', { style: { ...S.row, gap: 6 } },
          h('div', { style: S.seg }, BUCKETS.map(([key, label]) => h('button', {
            key,
            type: 'button',
            className: 'seeu-btn' + (applied.bucket === key ? ' is-primary' : ''),
            style: applied.bucket === key ? S.segOn : S.segOff,
            onClick: () => pickBucket(key),
          }, label))),
          h('select', {
            style: { ...S.input, flex: 'none', width: 190 },
            value: draft.eid ?? '',
            disabled: !db,
            title: '按检材筛选：下拉里就是火眼的检材名称',
            onChange: (e) => setDraft((d) => ({ ...d, eid: e.target.value })),
            onKeyDown: (e) => { if (e.key === 'Enter') apply(); },
          },
            h('option', { value: '' }, '全部检材'),
            ...evList.map((ev) => h('option', { key: ev.eid, value: String(ev.eid) }, '检材 ' + ev.eid + (ev.name ? ' · ' + ev.name : '')))),
          h('select', {
            style: { ...S.input, flex: 'none', width: 150 },
            value: draft.app ?? '',
            disabled: !db,
            title: '按应用筛选：下拉里是索引里出现过的应用（带记录数）',
            onChange: (e) => setDraft((d) => ({ ...d, app: e.target.value })),
            onKeyDown: (e) => { if (e.key === 'Enter') apply(); },
          },
            h('option', { value: '' }, '全部应用'),
            ...((facets?.apps ?? []).map((a) => h('option', { key: a.app, value: a.app }, a.app + '（' + a.n + '）')))),
          narrowInput(draft.from, (v) => setDraft((d) => ({ ...d, from: v })), '起始 2025-04-01', { width: 112, onEnter: apply }),
          narrowInput(draft.to, (v) => setDraft((d) => ({ ...d, to: v })), '结束 2025-04-30', { width: 112, onEnter: apply }),
          actionButton('查询', apply, { primary: true }),
          hasFilter ? actionButton('清空', clear) : null),
        error ? h('div', { style: S.noticeErr }, `时间线读取失败：${error}`) : null,
        loading && !data ? h(Skeleton, { n: 4 }) : null,
        !loading && !error && data && data.returned === 0
          ? h(EmptyState, {
              title: hasFilter ? '该时间范围内没有记录' : '该库没有可统计的时间戳',
              text: hasFilter ? '放宽起止时间或清空筛选；时间格式示例 2025-04-01。' : 'record.ts 为空：先点「建库 / 更新」重建索引，再回来查看时间线。',
              action: hasFilter ? actionButton('清空筛选', clear) : null,
            })
          : null,
        data && data.returned > 0 ? h('div', { style: S.card },
          h('div', { style: S.row },
            h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, `${bucketLabel}分桶`),
            h('span', { style: S.muted }, `${data.returned} 个时间段`),
            (rows.length ? actionButton(copying ? '复制中…' : '复制时间线清单', copyTimeline, { disabled: copying }) : null),
            h('span', { style: { ...S.muted, marginLeft: 'auto' } }, `合计 ${total} 条记录 · 点柱条钻取该时段`)),
          note ? h('div', { style: S.noticeInfo }, note) : null,
          h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 460, overflow: 'auto' } },
            rows.map((r) => h('div', {
              key: r.bucket,
              className: 'seeu-row is-clickable',
              style: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5 },
              title: '点一下查看该时间段的记录',
              onClick: () => onDrill({ eid: applied.eid, app: applied.app, from: r.bucket, to: `${r.bucket}~` }),
            },
              h('span', { style: { flex: 'none', minWidth: 104, color: C_FG2, fontFamily: FONT_CODE, fontSize: 11 } }, r.bucket),
              h('div', { style: S.barTrack }, h('div', { style: { ...S.barFill, width: `${Math.max(2, Math.round((r.n / max) * 100))}%` } })),
              h('span', { style: { flex: 'none', minWidth: 58, textAlign: 'right', color: C_FG, fontSize: 11, fontVariantNumeric: 'tabular-nums' } }, `${r.n} 记录`),
              h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, `${r.eids} 检材 · ${r.apps} 应用`)))))
          : null);
    }

    // ---------- 视图：typed 表（清单 + 宽表 + 分页） ----------
    function TablesView({ db, onCite }) {
      const list = useLoad(() => api('/tables', { db }), [db]);
      const tables = list.data?.tables ?? [];
      const [name, setName] = useState('');
      useEffect(() => {
        if (!tables.length) return;
        if (!name || !tables.some((t) => t.table === name)) setName(tables[0].table);
      }, [tables, name]);
      const [draft, setDraft] = useState({ q: '', eid: '' });
      const [applied, setApplied] = useState(draft);
      const [offset, setOffset] = useState(0);
      const [copying, setCopying] = useState(false);
      const [note, setNote] = useState('');
      const [exporting, setExporting] = useState(false);
      const [exportNote, setExportNote] = useState('');
      const detail = useLoad(() => (name ? api('/table', { db, name, ...applied, limit: TABLE_PAGE, offset }) : Promise.resolve(null)), [db, name, applied, offset]);
      const pick = (table) => { setName(table); setOffset(0); };
      const apply = () => { setApplied({ ...draft }); setOffset(0); };
      const clear = () => {
        const next = { q: '', eid: '' };
        setDraft(next);
        setApplied(next);
        setOffset(0);
      };
      // 当前页里能引用的行（record_id 非空）导出成清单
      const copyPage = async () => {
        if (copying || !detail.data) return;
        const pageRows = detail.data.rows ?? [];
        const items = pageRows.filter((r) => r.record_id != null).map((r) => ({ id: r.record_id }));
        if (!items.length) { setNote('当前页没有可引用的行（record_id 全为空）：这些行来自汇总统计，不能落到原文。'); return; }
        setCopying(true);
        setNote('');
        try {
          const { markdown, count, missing } = await citationListMarkdown({
            db,
            title: `SeeU 取证索引 · ${detail.data.label || name} 表引用清单`,
            metaLines: [
              `表：${name}`,
              `筛选：${describeFilters(applied, { eid: '检材', q: '关键词' })}`,
              `共 ${detail.data.total} 行，导出当前页可引用 ${items.length} 行（本页 ${pageRows.length} 行）`,
            ],
            items,
          });
          const chars = await clipboardWrite(markdown);
          setNote(`已复制 ${count} 行表记录引用清单（${chars} 字符）${missing ? `，其中 ${missing} 条无句柄` : ''}`);
        } catch (e) {
          setNote(`复制失败：${String(e.message ?? e)}`);
        } finally {
          setCopying(false);
        }
      };
      // 把当前筛选的整张 typed 表导出成 CSV（含表头；Excel 直接打开）
      const exportCsv = async () => {
        if (exporting || !db || !name) return;
        setExporting(true);
        setExportNote('');
        try {
          const qs = new URLSearchParams({ db, name });
          for (const [k, v] of Object.entries(applied)) if (v !== '' && v != null) qs.set(k, String(v));
          qs.set('max', '20000');
          const res = await fetch('/seeu-index/export/table.csv?' + qs.toString());
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const raw = await res.text();
          const text = raw.startsWith('\uFEFF') ? raw : '\uFEFF' + raw;
          const rowsOut = Number(res.headers.get('x-seeu-rows') ?? 0);
          const totalOut = Number(res.headers.get('x-seeu-total') ?? rowsOut);
          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const saved = await saveCsvText('表导出-' + (detail.data?.label || name) + '-' + stamp + '.csv', text);
          if (saved.ok) {
            setExportNote('已导出 ' + rowsOut + ' 行' + (totalOut > rowsOut ? '（共 ' + totalOut + ' 行，单次最多 20000 行）' : '') + (saved.downloaded ? '：' + saved.path : '到 ' + saved.path));
          } else {
            setExportNote('导出失败：' + (saved.error ?? '未知错误'));
          }
        } catch (e) {
          setExportNote('导出失败：' + String(e.message ?? e));
        } finally {
          setExporting(false);
        }
      };
      if (list.error) return h('div', { style: S.card }, h('div', { style: S.noticeErr }, `表清单读取失败：${list.error}`));
      if (list.loading && !list.data) return h('div', { style: S.card }, h(Skeleton, { n: 5 }));
      if (!tables.length) return h('div', { style: S.card }, h(EmptyState, { title: '该库没有 typed 数据', text: 'table 清单为空：先点「建库 / 更新」重建索引，再回来查看联系人、短信、账号等结构化表。' }));
      const data = detail.data;
      const cols = data?.columns ?? [];
      const rows = data?.rows ?? [];
      return h('div', { style: S.card },
        h('div', { style: { ...S.row, gap: 6 } },
          h('span', { style: S.muted }, '表'),
          h('select', {
            style: { ...S.filter, width: 'auto', minWidth: 150, maxWidth: 240, cursor: 'pointer' },
            value: name,
            onChange: (e) => pick(e.target.value),
          }, tables.map((t) => h('option', { key: t.table, value: t.table }, `${t.label || t.table}（${t.rows}）`))),
          narrowInput(draft.eid, (v) => setDraft((d) => ({ ...d, eid: v })), '检材号 eid', { width: 84, onEnter: apply }),
          narrowInput(draft.q, (v) => setDraft((d) => ({ ...d, q: v })), '关键词 q', { width: 140, onEnter: apply }),
          actionButton('查询', apply, { primary: true }),
          applied.q || applied.eid ? actionButton('清空', clear) : null),
        detail.error ? h('div', { style: S.noticeErr }, `表数据读取失败：${detail.error}`) : null,
        detail.loading && !data ? h(Skeleton, { n: 5 }) : null,
        data && data.total === 0
          ? h(EmptyState, { title: '该表没有匹配行', text: '清空关键词或换 eid 再试；也可以切换到别的表。', action: applied.q || applied.eid ? actionButton('清空筛选', clear) : null })
          : null,
        data && data.total > 0 ? h('div', { style: S.card },
          h('div', { style: S.row },
            h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, data.label || name),
            h('span', { style: S.muted }, `共 ${data.total} 行`),
            h('span', { style: S.muted }, `当前 ${data.offset + 1}-${data.offset + data.returned}`),
            detail.loading ? h('span', { style: S.muted }, '更新中…') : null,
            h('span', { style: { ...S.muted, marginLeft: 'auto' } }, '点一行看引用句柄（record_id 为空的行不可引用）'),
            actionButton(copying ? '复制中…' : '复制本页引用清单', copyPage, { disabled: copying }),
            actionButton(exporting ? '导出中…' : '导出 CSV', exportCsv, { disabled: exporting })),
          note ? h('div', { style: S.noticeInfo }, note) : null,
          exportNote ? h('div', { style: S.noticeInfo }, exportNote) : null,
          h('div', { className: 'seeu-table-wrap seeu-scroll', style: S.tableWrap }, h('table', { className: 'seeu-table', style: S.table },
            h('thead', null, h('tr', null, cols.map((c) => h('th', { key: c, style: S.th }, c)))),
            h('tbody', null, rows.map((r, i) => h('tr', {
              key: r.id != null ? `r${r.id}` : `i${i}`,
              className: r.record_id != null ? 'is-clickable' : undefined,
              style: r.record_id != null ? S.trClick : undefined,
              title: r.record_id != null ? '点一下看引用句柄' : '该行没有对应原文记录，不能引用',
              onClick: r.record_id != null ? () => onCite(r.record_id) : undefined,
            }, cols.map((c) => h('td', { key: c, style: S.td }, cellText(r[c])))))))),
          h('div', { style: { ...S.row, marginTop: 8 } },
            data.offset > 0 ? actionButton('上一页', () => setOffset(Math.max(0, data.offset - TABLE_PAGE))) : null,
            data.next != null ? actionButton('下一页', () => setOffset(data.next)) : null,
            h('span', { style: S.muted }, `第 ${Math.floor(data.offset / TABLE_PAGE) + 1} 页 · 列宽可横向滚动`)))
          : null);
    }

    // ---------- 视图：跨案（中央库概览 / 同步 / 重合实体 Top / 实体值查询） ----------
    const CROSS_KINDS = [
      ['', '全部'],
      ['phone', 'phone'],
      ['email', 'email'],
      ['url', 'url'],
    ];
    const fmtTime = (v) => {
      if (!v) return '—';
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
    };

    function CrossCaseView({ onCite, onDetail }) {
      const list = useLoad(() => api('/cross/list', {}), []);
      const [minDraft, setMinDraft] = useState('2');
      const [minCases, setMinCases] = useState('2');
      const [kind, setKind] = useState('');
      const top = useLoad(() => api('/cross/top', { minCases, kind, limit: 30 }), [minCases, kind]);
      const [syncing, setSyncing] = useState(false);
      const [note, setNote] = useState('');
      const [syncError, setSyncError] = useState('');
      const [valueInput, setValueInput] = useState('');
      const [hit, setHit] = useState({ value: '', kind: '' });
      const found = useLoad(() => (hit.value ? api('/cross/entity', { value: hit.value, kind: hit.kind, minCases: 1, limit: 30 }) : Promise.resolve(null)), [hit]);

      const stats = list.data?.stats ?? null;
      const cases = list.data?.cases ?? [];
      const kindOptions = useMemo(() => {
        const extra = (stats?.kinds ?? [])
          .map((k) => String(k.kind ?? ''))
          .filter((k) => k && !CROSS_KINDS.some(([v]) => v === k));
        return [...CROSS_KINDS, ...extra.map((k) => [k, k])];
      }, [stats]);
      const dbByCase = useMemo(() => {
        const m = new Map();
        for (const c of cases) if (c.caseNumber && c.dbPath) m.set(c.caseNumber, c.dbPath);
        return m;
      }, [cases]);

      const doSync = useCallback(async () => {
        if (syncing) return;
        setSyncing(true);
        setNote('');
        setSyncError('');
        const before = stats?.cases ?? 0;
        try {
          const res = await post('/cross/sync', {});
          const processed = (res.cases ?? []).length;
          const fresh = await list.reload();
          const after = fresh?.stats?.cases ?? before;
          const added = Math.max(0, after - before);
          const updated = Math.max(0, processed - added);
          setNote(processed
            ? `同步完成：扫描索引 ${res.indexes ?? '?'} 个，处理 ${processed} 案（新增 ${added}、更新 ${updated}）；现共 ${after} 案。`
            : `同步完成：扫描索引 ${res.indexes ?? 0} 个，没有可同步的案件索引（先建库）。`);
        } catch (e) {
          setSyncError(String(e.message ?? e));
          // 同步会改跨案库内容：Top 与已查实体一起重拉，避免界面上还是同步前的空列表
          if (typeof top?.reload === 'function') await top.reload();
          if (hit.value && typeof found?.reload === 'function') await found.reload();
        } finally {
          setSyncing(false);
        }
      }, [syncing, stats, list, top, found, hit]);

      const query = () => {
        const v = valueInput.trim();
        setHit(v ? { value: v, kind: '' } : { value: '', kind: '' });
      };
      const openMention = useCallback((caseNumber, m) => {
        const target = dbByCase.get(caseNumber);
        if (target && m.recordId !== null && m.recordId !== undefined) { onCite(m.recordId, target); return; }
        // 该案索引不在本机：用跨案库里的 base_handle / snippet 直接渲染引用详情样式。
        onDetail({
          citation: m.baseHandle || null,
          path: `${caseNumber ?? ''}${m.app ? ` / ${m.app}` : ''}`,
          line: m.lineNo,
          ts: m.ts,
          text: m.snippet ?? '',
        });
      }, [dbByCase, onCite, onDetail]);

      const topRows = top.data?.rows ?? [];
      const foundRows = found.data?.rows ?? [];
      // 导出重合实体清单（跨案比较结果，供报告直接引用）
      const copyTop = async () => {
        if (!topRows.length) return;
        try {
          const lines = [
            '# SeeU 跨案 · 重合实体清单',
            `筛选：最少 ${top.data?.minCases ?? minCases} 案 · 类型 ${kind || '全部'}`,
            `共 ${topRows.length} 条 · 跨案库：${list.data?.crossPath ?? ''}`,
            `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            '',
          ];
          topRows.forEach((r, i) => {
            lines.push(`${i + 1}. [${r.kind}] ${r.value} — ${r.caseCount ?? '?'} 案 · ${r.evidenceCount ?? '-'} 检材 · 提及 ${r.hits ?? 0} 次`);
            const caseNumbers = Array.isArray(r.cases) && r.cases.length
              ? r.cases.map((c) => c.caseNumber ?? '').filter(Boolean)
              : String(r.caseNumbers ?? '').split(',').filter(Boolean);
            if (caseNumbers.length) lines.push(`   案件：${caseNumbers.join(', ')}`);
          });
          const chars = await clipboardWrite(lines.join('\n'));
          setNote(`已复制 ${topRows.length} 条重合实体清单（${chars} 字符）`);
        } catch (e) {
          setSyncError(String(e.message ?? e));
        }
      };
      return h('div', { style: S.card },
        // ---- 概览 + 同步 ----
        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('span', { style: S.title }, '跨案概览'),
            h('span', { style: { ...S.muted, marginLeft: 'auto', maxWidth: '52%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: list.data?.crossPath ?? '' }, `跨案库：${list.data?.crossPath ?? '…'}`),
            actionButton(syncing ? '同步中…' : '同步全部案件', doSync, { primary: true, disabled: syncing, title: '扫描本机索引并汇总到跨案库' })),
          list.error ? h('div', { style: S.noticeErr }, `跨案库读取失败：${list.error}（检查跨案库路径，或先给一个案件建库）`) : null,
          syncError ? h('div', { style: S.noticeErr }, `同步失败：${syncError}`) : null,
          note ? h('div', { style: S.noticeOk }, note) : null,
          list.loading && !list.data ? h(Skeleton, { n: 2 }) : null,
          stats ? h('div', { style: S.card },
            h(KpiStrip, { items: [
              { label: '案件', value: String(stats.cases ?? 0) },
              { label: '实体', value: String(stats.entities ?? 0) },
              { label: '跨案重合实体', value: String(stats.sharedEntities ?? 0) },
              { label: '镜像', value: String(stats.images ?? 0) },
              { label: '最近同步', value: fmtTime(stats.lastSync), text: true },
            ] }),
            h('div', { style: S.muted }, `跨案库版本 v${stats.crossVersion ?? '?'} · 案件列表按同步时间倒序`)) : null,
          !list.loading && !list.error && !cases.length
            ? h(EmptyState, { title: '跨案库还没有案件', text: '先给至少一个案件建库，再点「同步全部案件」把本机索引汇总进来。' })
            : null,
          cases.length ? h('div', { style: S.card },
            h('div', { style: S.row },
              h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, `案件 ${cases.length} 个`),
              h('span', { style: S.muted }, '案名 / 案号 / 记录数 / 同步时间')),
            h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 240, overflow: 'auto' } },
              cases.map((c) => h('div', {
                key: c.caseNumber,
                className: 'seeu-row',
                style: { display: 'flex', gap: 8, alignItems: 'baseline', minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, fontSize: 12.5 },
                title: c.caseDir ?? '',
              },
                h('span', { style: { color: C_FG, fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.caseName || c.caseNumber || '(未命名案件)'),
                h('span', { style: { ...S.tag, flex: 'none' } }, c.caseNumber ?? ''),
                h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, `${c.records ?? 0} 记录`),
                h('span', { style: { marginLeft: 'auto', ...S.rowTime } }, fmtTime(c.syncedAt)))))) : null),
        // ---- 重合实体 Top ----
        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('span', { style: S.title }, '重合实体 Top'),
            h('span', { style: S.muted }, 'minCases'),
            narrowInput(minDraft, setMinDraft, '≥ 案数', { width: 56, onEnter: () => setMinCases(minDraft.trim() || '2') }),
            actionButton('刷新', () => setMinCases(minDraft.trim() || '2')),
            h('span', { style: S.muted }, '类型'),
            h('select', {
              style: { ...S.filter, width: 'auto', minWidth: 88, cursor: 'pointer' },
              value: kind,
              onChange: (e) => setKind(e.target.value),
            }, kindOptions.map(([v, l]) => h('option', { key: v || 'all', value: v }, l))),
            topRows.length ? actionButton('复制重合实体清单', copyTop) : null),
          top.error ? h('div', { style: S.noticeErr }, `重合实体读取失败：${top.error}`) : null,
          top.loading && !top.data ? h(Skeleton, { n: 4 }) : null,
          top.data && !topRows.length
            ? h(EmptyState, {
                title: stats && stats.entities === 0 ? '跨案库还没有实体数据' : `没有跨 ≥${top.data.minCases ?? minCases} 案的实体`,
                text: stats && stats.entities === 0
                  ? '点「同步全部案件」先汇总本机案件索引，再回来看跨案重合实体。'
                  : '把 minCases 调低或换类型再试；重合实体越少，说明跨案件关联越弱。',
              })
            : null,
          topRows.length ? h('div', { style: S.card },
            h('div', { style: S.muted }, `共 ${top.data?.returned ?? topRows.length} 条 · 点一行看各案提及（base_handle / recordId）`),
            h('div', { className: 'seeu-table-wrap seeu-scroll', style: S.tableWrap }, h('table', { className: 'seeu-table', style: S.table },
              h('thead', null, h('tr', null,
                ['类型', '值', '案件数', '提及次数'].map((c) => h('th', { key: c, style: S.th }, c)))),
              h('tbody', null, topRows.map((r) => h('tr', {
                key: `${r.kind}|${r.valueNorm}`,
                className: 'is-clickable',
                style: S.trClick,
                title: '点一下查该实体在不同案件的提及',
                onClick: () => { setValueInput(r.valueNorm); setHit({ value: r.valueNorm, kind: r.kind }); },
              },
                h('td', { style: S.td }, h('span', { style: S.tag }, r.kind)),
                h('td', { style: { ...S.td, maxWidth: 260 } }, r.valueText || r.valueNorm),
                h('td', { style: { ...S.td, color: C_ACC, fontVariantNumeric: 'tabular-nums' } }, String(r.caseCount ?? '')),
                h('td', { style: { ...S.td, fontVariantNumeric: 'tabular-nums' } }, String(r.hits ?? '')))))))) : null),
        // ---- 实体值查询 ----
        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('span', { style: S.title }, '实体值查询'),
            narrowInput(valueInput, setValueInput, '实体值，如 85254877240（回车查询）', { width: 220, onEnter: query }),
            actionButton('查询', query, { primary: true }),
            hit.value ? actionButton('清空', () => { setValueInput(''); setHit({ value: '', kind: '' }); }) : null),
          found.error ? h('div', { style: S.noticeErr }, `实体查询失败：${found.error}`) : null,
          found.loading && !found.data ? h(LoadingLine, { text: '查询中…' }) : null,
          !hit.value ? h(EmptyState, { title: '查一个实体值', text: '输入手机号 / 邮箱 / URL 等归一化后的值后回车或点「查询」；也可点上面 Top 表的一行下钻。' }) : null,
          hit.value && found.data && !foundRows.length ? h(EmptyState, { title: `没有命中实体「${hit.value}」`, text: '值是归一化后精确匹配，检查是否完整（如手机号不含 +86）；也可用 Top 表下钻。' }) : null,
          foundRows.length ? h('div', { style: S.card }, foundRows.map((row) => h('div', { key: `${row.kind}|${row.value}`, style: { ...S.card, gap: 8 } },
            h('div', { style: { ...S.row, padding: '2px 0' } },
              h('span', { style: { ...S.tag, flex: 'none' } }, row.kind),
              h('span', { style: { ...S.mono, color: C_FG, wordBreak: 'break-all', fontSize: 12.5 } }, row.value),
              h('span', { style: S.muted }, `跨 ${row.caseCount} 案 · ${row.evidenceCount ?? '-'} 检材 · 提及 ${row.hits ?? 0} 次`),
              row.lastTs ? h('span', { style: { ...S.rowTime, marginLeft: 'auto' } }, `最近 ${row.lastTs}`) : null),
            (row.cases ?? []).map((g) => h('div', { key: `${row.kind}|${g.caseNumber}`, style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderLeft: '2px solid ' + C_ACC_LINE, borderRadius: '0 ' + R_MD + 'px ' + R_MD + 'px 0', background: C_BG2 } },
              h('div', { style: S.row },
                h('span', { style: { fontWeight: 600, color: C_FG } }, g.caseName || g.caseNumber),
                h('span', { style: { ...S.tag, flex: 'none' } }, g.caseNumber ?? ''),
                (g.eids ?? []).length ? h('span', { style: S.muted }, `eid ${g.eids.join(', ')}`) : null,
                dbByCase.get(g.caseNumber) ? h('span', { style: { ...S.tag, color: C_OK, background: 'color-mix(in srgb, ' + C_OK + ' 14%, transparent)' } }, '可回查引用') : h('span', { style: { ...S.tag, color: C_FG3 } }, '索引不在本机')),
              (g.mentions ?? []).length
                ? h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 200, overflow: 'auto' } }, (g.mentions ?? []).map((m, i) => h('div', {
                  key: `${m.recordId ?? 'x'}|${m.lineNo ?? i}|${i}`,
                  className: 'seeu-row is-clickable',
                  style: { display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5, background: 'transparent' },
                  title: `${m.citable === 0 ? '不可引用：' : ''}点一下看引用句柄（base_handle）`,
                  onClick: () => openMention(g.caseNumber, m),
                },
                  h('span', { style: { ...S.tag, flex: 'none' } }, `E${m.eid ?? '?'}${m.app ? `·${m.app}` : ''}`),
                  h('span', { style: S.rowTime }, m.ts ?? ''),
                  h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, m.lineNo != null ? `第 ${m.lineNo} 行` : ''),
                  h('span', { style: S.ellipsis }, m.snippet ?? ''),
                  m.recordId != null ? h('span', { style: { ...S.tag, flex: 'none' } }, `#${m.recordId}`) : null,
                  m.baseHandle ? h('span', { style: { flex: 'none', fontFamily: FONT_CODE, fontSize: 10, color: C_FG3 } }, m.baseHandle) : null)))
                : h('div', { style: S.muted }, '（该案提及只保留最近 8 条，可能被截断）')))))) : null));
    }

    // 「从 MYOS 导入」对话框：列案件 → 检材 → 结果库表 → 导入为 SeeU 索引。
    function MyosDialog({ initialDir, onClose, onImported }) {
      const [cases, setCases] = useState([]);
      const [caseId, setCaseId] = useState('');
      const [materials, setMaterials] = useState([]);
      const [materialId, setMaterialId] = useState('');
      const [dbPath, setDbPath] = useState('');
      const [dbs, setDbs] = useState([]);
      const [tables, setTables] = useState([]);
      const [tableName, setTableName] = useState('');
      const [sql, setSql] = useState('');
      const [outDir, setOutDir] = useState(initialDir || '');
      const [caseName, setCaseName] = useState('');
      const [evidenceName, setEvidenceName] = useState('');
      const [busy, setBusy] = useState('');
      const [error, setError] = useState('');
      const [result, setResult] = useState(null);
      // 追加模式：同一案件导多个检材/多张表时不要互相覆盖（取消勾选=整库重建）。
      const [appendMode, setAppendMode] = useState(true);
      // 批量导入：勾选多张表一次入库（每张表算一个检材，eid 递增）。
      const [pickedTables, setPickedTables] = useState([]);
      const [tableQuery, setTableQuery] = useState('');
      const [batchJob, setBatchJob] = useState(null);
      // 预估行数：导入前先看每张表有多少行（空表可跳过）。
      const [counts, setCounts] = useState({});

      useEffect(() => {
        let alive = true;
        (async () => {
          setBusy('cases');
          try {
            const body = await api('/myos/cases');
            if (!alive) return;
            const list = body.cases ?? [];
            setCases(list);
            if (list.length === 1) pickCase(list[0].caseId, list);
          } catch (e) { if (alive) setError(String(e.message ?? e)); }
          finally { if (alive) setBusy(''); }
        })();
        return () => { alive = false; };
      }, []);

      const pickCase = async (id, known) => {
        const list = known ?? cases;
        setCaseId(id);
        setMaterials([]);
        setMaterialId('');
        const hit = list.find((c) => c.caseId === id);
        if (hit) setCaseName(hit.caseName || hit.displayName || '');
        setBusy('materials');
        setError('');
        try {
          const body = await api('/myos/materials', { caseId: id });
          setMaterials(body.materials ?? []);
        } catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
        void loadDbs(id, '');
      };

      const loadDbs = async (cid, mid) => {
        setDbs([]);
        if (!cid && !mid) return;
        try {
          const body = await api('/myos/dbs', { caseId: cid || '', materialId: mid || '' });
          setDbs(body.dbs ?? []);
        } catch {
          // 结果概览拿不到就算了，用户仍可手填路径。
        }
      };

      const pickDb = (path) => {
        setDbPath(path);
        setPickedTables([]);
        const hit = dbs.find((item) => item.path === path);
        if (hit?.tables?.length) {
          setTables(hit.tables);
          setTableName(hit.tables[0]);
          setSql('select * from "' + hit.tables[0] + '" limit 2000');
        }
      };

      const pickMaterial = (id) => {
        setMaterialId(id);
        const hit = materials.find((m) => m.materialId === id);
        if (hit && !evidenceName) setEvidenceName(hit.name || '');
        void loadDbs(caseId, id);
      };

      const loadTables = async () => {
        if (!dbPath.trim()) { setError('先填结果库路径（MYOS 结果目录里的 .mfs，例如 …/data/MApps.mfs）'); return; }
        setBusy('tables');
        setError('');
        try {
          const body = await api('/myos/tables', { db: dbPath.trim() });
          const list = body.tables ?? [];
          setTables(list);
          if (list.length === 1) { setTableName(list[0]); setSql('select * from "' + list[0] + '" limit 2000'); }
        } catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      };

      const pickTable = (name) => {
        setTableName(name);
        setSql('select * from "' + name + '" limit 2000');
      };

      const toggleTable = (name) => {
        setPickedTables((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));
      };

      const doImportBatch = async () => {
        if (!pickedTables.length) { setError('先勾选要批量导入的表'); return; }
        if (!outDir.trim()) { setError('先填输出案件目录（索引会写到 <目录>/.seeu-index/case-index.db）'); return; }
        setBusy('batch');
        setError('');
        setResult(null);
        setBatchJob(null);
        try {
          await post('/myos/import-batch', {
            caseId: caseId.trim(), db: dbPath.trim(), tables: pickedTables, outDir: outDir.trim(),
            caseName: caseName.trim(), evidenceName: evidenceName.trim(), maxRows: 2000,
          });
          // 批量导入跑在插件侧，面板轮询进度。
          for (;;) {
            const { job } = await api('/myos/import-batch');
            if (!job) throw new Error('批量导入任务丢失，请重试');
            setBatchJob(job);
            if (job.status === 'done') { setResult(job.result); break; }
            if (job.status === 'failed') { throw new Error(job.error || '批量导入失败'); }
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        } catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      };

      const doCountTables = async () => {
        const list = pickedTables.length ? pickedTables : filteredTables;
        if (!list.length) { setError('先勾选表或输入表名过滤'); return; }
        if (!dbPath.trim()) { setError('先填结果库路径'); return; }
        setBusy('counts');
        setError('');
        try {
          const body = await post('/myos/row-counts', { caseId: caseId.trim(), db: dbPath.trim(), tables: list });
          const next = {};
          for (const item of body.tables ?? []) next[item.table] = item;
          setCounts(next);
        } catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      };

      const doImport = async () => {
        if (!sql.trim()) { setError('先填要执行的 SQL（选表后会自动生成 select * from … limit 2000）'); return; }
        if (!outDir.trim()) { setError('先填输出案件目录（索引会写到 <目录>/.seeu-index/case-index.db）'); return; }
        setBusy('import');
        setError('');
        setResult(null);
        try {
          const body = await post('/myos/import', {
            caseId: caseId.trim(), db: dbPath.trim(), sql: sql.trim(), outDir: outDir.trim(),
            caseName: caseName.trim(), evidenceName: evidenceName.trim(),
            mode: appendMode ? 'append' : 'rebuild',
          });
          setResult(body);
        } catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      };

      const tableFilter = tableQuery.trim().toLowerCase();
      const filteredTables = tableFilter ? tables.filter((t) => String(t).toLowerCase().includes(tableFilter)) : tables;

      const row = (label, node) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { ...S.muted, width: 92, flex: 'none', fontSize: 11.5 } }, label), node);
      const select = (value, onChange, items, placeholder) => h('select', {
        style: { ...S.input, flex: 1 }, value, onChange: (e) => onChange(e.target.value),
      },
        h('option', { value: '' }, placeholder),
        ...items.map((item) => h('option', { key: item.value, value: item.value }, item.label)));

      const resultNode = result
        ? h('div', { style: S.noticeOk },
            result.tables
              ? `批量导入 ${result.tables.length} 张表：${result.tables.reduce((sum, item) => sum + item.records, 0)} 条记录 · ` +
                `${result.tables.reduce((sum, item) => sum + item.entities, 0)} 个实体` +
                (result.totals ? `（索引现有 ${result.totals.records} 条记录 / ${result.totals.evidences} 个检材）` : '')
              : `已导入 ${result.records} 条记录 · ${result.entities} 个实体` +
                (result.totals ? `（索引现有 ${result.totals.records} 条记录 / ${result.totals.evidences} 个检材）` : '') +
                ` → ${result.dbFile}`,
            result.tables
              ? h('div', { style: { ...S.muted, fontSize: 11, marginTop: 4 } },
                  result.tables.map((item) => `${item.table}: ${item.records} 条`).join(' · '))
              : result.truncated ? '（查询结果被截断，可调大 SQL 的 limit 后重导）' : null,
            result.tables && result.skipped && result.skipped.length
              ? h('div', { style: { ...S.muted, fontSize: 11 } },
                  '跳过：' + result.skipped.map((item) => `${item.table}（${item.reason}）`).join('；'))
              : null,
            h('div', { style: { ...S.row, marginTop: 6 } },
              actionButton('完成并查看索引', () => onImported(result), { primary: true })))
        : null;
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(3, 8, 20, .62)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        },
        onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
      },
        h('div', { className: 'seeu-scroll', style: { ...S.card, width: 'min(680px, 94vw)', maxHeight: '86vh', overflow: 'auto', gap: 8, background: C_BG1, border: '1px solid ' + C_L2 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('span', { style: { color: C_FG, fontSize: 13.5, fontWeight: 650 } }, '从超级取证大师（MYOS）导入'),
            actionButton('关闭', onClose, {})),
          h('div', { style: { ...S.muted, fontSize: 11.5 } }, '先启动「超级取证大师」。导入会把 MYOS 结果库里一张表的数据写进 SeeU 索引（record + 全文索引 + 实体），之后面板与 AI 都只查这份索引。'),
          row('案件', select(caseId, (id) => pickCase(id), cases.map((c) => ({ value: c.caseId, label: (c.caseName || c.displayName || c.caseId) + (c.casePath ? ' · ' + c.casePath : '') })), busy === 'cases' ? '读取案件…' : '选择 MYOS 案件')),
          materials.length ? row('检材', select(materialId, pickMaterial, materials.map((m) => ({ value: m.materialId, label: (m.name || m.materialId) + (m.status ? ' · ' + m.status : '') })), '选择检材（可选）')) : null,
          dbs.length ? row('结果库', select(dbPath, pickDb, dbs.map((item) => {
            const name = String(item.path).split(/[\\/]/).pop();
            const parts = [name];
            if (item.source === 'root') parts.push('根库');
            if (item.tables?.length) parts.push(item.tables.length + ' 张表');
            return { value: item.path, label: parts.join(' · ') + ' · ' + item.path };
          }), '选择 MYOS 发现的结果库')) : null,
          row('结果库', h('input', { style: { ...S.input, flex: 1 }, value: dbPath, placeholder: 'D:/Programs/MYOS/Case/<案件>/dev/<检材>/data/MApps.mfs', onChange: (e) => setDbPath(e.target.value), spellCheck: false })),
          h('div', { style: { ...S.row, paddingLeft: 100 } }, actionButton(busy === 'tables' ? '读取中…' : '列出表', loadTables, { disabled: busy === 'tables' })),
          tables.length ? row('表', select(tableName, pickTable, tables.map((t) => ({ value: t, label: t })), '选择表')) : null,
          tables.length > 1 ? row('批量', h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { ...S.row, gap: 8, fontSize: 11.5 } },
              h('span', { style: S.muted }, `勾选多张表一次导入（每张表一个检材，共 ${tables.length} 张）`),
              h('input', { style: { ...S.input, width: 150, fontSize: 11.5 }, value: tableQuery, placeholder: '按表名过滤，如 TBL_PR_', onChange: (e) => setTableQuery(e.target.value), spellCheck: false }),
              actionButton('全选', () => setPickedTables([...new Set([...pickedTables, ...filteredTables])]), {}),
              actionButton('清空', () => setPickedTables([]), {}),
              actionButton(busy === 'counts' ? '预估中…' : '预估条数', doCountTables, { disabled: busy === 'counts' }),
              actionButton('只选非空', () => setPickedTables(filteredTables.filter((t) => counts[t] && counts[t].count > 0)), {})),
            h('div', { className: 'seeu-scroll', style: { maxHeight: 120, overflow: 'auto', border: '1px solid ' + C_L2, borderRadius: 6, padding: '4px 8px' } },
              ...(filteredTables.length ? filteredTables.map((t) => h('label', { key: t, style: { ...S.row, gap: 6, fontSize: 11.5, color: C_FG2, padding: '2px 0' } },
                h('input', { type: 'checkbox', checked: pickedTables.includes(t), onChange: () => toggleTable(t) }),
                h('span', null, t),
                counts[t] ? h('span', { style: { ...S.muted, fontSize: 10.5, color: counts[t].count === 0 ? '#F5A524' : C_FG3 } },
                  counts[t].count === null ? '预估失败' : `${counts[t].count} 行`) : null)) : [h('span', { key: 'none', style: { ...S.muted, fontSize: 11.5 } }, '没有匹配的表名')])),
            Object.keys(counts).length && pickedTables.some((t) => counts[t])
              ? h('div', { style: { ...S.muted, fontSize: 11 } },
                  `预估：选中表合计 ${pickedTables.reduce((sum, t) => sum + (counts[t] && Number.isFinite(counts[t].count) ? counts[t].count : 0), 0)} 行` +
                  '（每张表最多导入 2000 行；空表会自动跳过）')
              : null,
            batchJob && batchJob.status === 'running' ? h('div', { style: { ...S.muted, fontSize: 11 } },
              `批量导入：第 ${Math.max(batchJob.index, 1)}/${batchJob.total} 张表${batchJob.table ? ' · ' + batchJob.table : ''} · 已收集 ${batchJob.records} 条记录` +
              (batchJob.phase === 'start' ? ' · 正在准备…' : '')) : null,
            h('div', { style: { ...S.row, gap: 8 } },
              actionButton(busy === 'batch' ? '批量导入中…' : `批量导入选中 ${pickedTables.length} 张表`, doImportBatch, { disabled: busy === 'batch' || !pickedTables.length })))) : null,
          row('SQL', h('textarea', { style: { ...S.input, flex: 1, minHeight: 54, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }, value: sql, onChange: (e) => setSql(e.target.value), spellCheck: false })),
          row('输出目录', h('input', { style: { ...S.input, flex: 1 }, value: outDir, placeholder: '案件目录（索引写到 .seeu-index/case-index.db）', onChange: (e) => setOutDir(e.target.value), spellCheck: false })),
          row('案件名', h('input', { style: { ...S.input, flex: 1 }, value: caseName, onChange: (e) => setCaseName(e.target.value), spellCheck: false })),
          row('检材名', h('input', { style: { ...S.input, flex: 1 }, value: evidenceName, onChange: (e) => setEvidenceName(e.target.value), spellCheck: false })),
          row('写入方式', h('label', { style: { ...S.row, gap: 6, fontSize: 11.5, color: C_FG2 } },
            h('input', { type: 'checkbox', checked: appendMode, onChange: (e) => setAppendMode(e.target.checked) }),
            h('span', null, appendMode ? '追加到已有索引（同一案件多个检材/多张表）' : '整库重建（会清掉这个索引目录里已导入的内容）'))),
          h('div', { style: S.row },
            actionButton(busy === 'import' ? '导入中…' : '导入为 SeeU 索引', doImport, { primary: true, disabled: busy === 'import' }),
            h('span', { style: { ...S.muted, fontSize: 11 } }, '只读 MYOS 结果库，不改 MYOS 数据；默认追加，取消勾选可整库重建。')),
          error ? h('div', { style: S.noticeErr }, error) : null,
          resultNode));
    }

    function Panel() {
      const [dir, setDir] = useState(() => localStorage.getItem('seeu.indexDir') ?? '')
      const [buildConc, setBuildConc] = useState(() => {
        const raw = Number(localStorage.getItem('seeu.buildConcurrency'))
        return [3, 6, 8].includes(raw) ? raw : 3
      });
      // 短词（<3 字）检索的逐行扫描预算：大库上越大越完整、越慢。
      const [scanBudget, setScanBudget] = useState(null);
      const [exportsInfo, setExportsInfo] = useState(null);
      const [exportsNote, setExportsNote] = useState('');
      const [scanNote, setScanNote] = useState('');
      useEffect(() => {
        let alive = true;
        api('/scan-budget').then((data) => { if (alive && data) setScanBudget(Number(data.scanBudgetMs) || 2500) }).catch(() => {});
        api('/exports?limit=8').then((data) => { if (alive && data) setExportsInfo(data) }).catch(() => {});
        return () => { alive = false };
      }, []);
      const saveScanBudget = async (ms) => {
        setScanBudget(ms);
        setScanNote('保存中…');
        try {
          const data = await post('/scan-budget', { scanBudgetMs: ms });
          setScanBudget(Number(data?.scanBudgetMs) || ms);
          setScanNote(`已保存：${Number(data?.scanBudgetMs) || ms} ms`);
          setTimeout(() => setScanNote(''), 2500);
        } catch (e) {
          setScanNote(`保存失败：${String(e.message ?? e)}`);
        }
      };
      const [indexes, setIndexes] = useState([]);
      const buildingCase = useMemo(() => {
        const norm = (value) => { let t = String(value ?? '').split(String.fromCharCode(92)).join('/'); while (t.endsWith('/')) t = t.slice(0, -1); return t.toLowerCase() }
        const target = norm(dir)
        if (!target) return null
        return (indexes ?? []).find((ix) => ix.building && norm(ix.caseDir) === target) ?? null
      }, [indexes, dir])
      const [srcFilter, setSrcFilter] = useState('all');
      const [chain, setChain] = useState(null);
      const [db, setDb] = useState(null);
      const [node, setNode] = useState('root');
      const [view, setView] = useState(null);
      // 记住上次停留的标签页，重启/刷新面板不用每次重选
      const [tab, setTab] = useState(() => {
        const saved = localStorage.getItem('seeu.panelTab');
        return TABS.some(([key]) => key === saved) ? saved : 'tree';
      });
      const runChain = async (ix, images = 0) => {
        if (!ix) return;
        setChain({ dbPath: ix.dbPath, caseNumber: ix.caseNumber || undefined, running: true, result: null, error: '' });
        try {
          const res = await api('/chain-check', { images: images ? 1 : 0, caseNumber: ix.caseNumber || undefined, db: ix.dbPath });
          setChain({ dbPath: ix.dbPath, caseNumber: ix.caseNumber || undefined, running: false, result: res, error: '' });
        } catch (err) {
          setChain({ dbPath: ix.dbPath, caseNumber: ix.caseNumber || undefined, running: false, result: null, error: String((err && err.message) || err) });
        }
      };
      const [recordSeed, setRecordSeed] = useState(null);
      const [query, setQuery] = useState('');
      // 检索筛选：检材 / 应用 / 起止日期（后端 search() 原生支持，空值不传）
      const [filters, setFilters] = useState({ eid: '', app: '', from: '', to: '' });
      // 检索筛选用的检材下拉：从 /evidences 拿「eid + 名称 + 平台」，用户不用记 eid
      const [evList, setEvList] = useState([]);
      // 应用/类别下拉：来自 /facets（按当前库的 record 统计），省得手输应用名
      const [facets, setFacets] = useState(null);
      // 会话上下文（<DSH_HOME>/AGENTS.md）里案件概览的注入状态：让「模型已经知道检材」可见
      const [briefInfo, setBriefInfo] = useState(null);
      const [briefNote, setBriefNote] = useState('');
      // 树视图：本层节点的快速过滤（分类/文件多的时候按名字找）
      const [treeFilter, setTreeFilter] = useState('');
      // 最近活动（建库 / MYOS 导入），来自插件 /activity
      const [activity, setActivity] = useState([]);
      const [activitySummary, setActivitySummary] = useState('');
      const [activityBuckets, setActivityBuckets] = useState([]);
      const [activityDay, setActivityDay] = useState('');
      const [activityQuery, setActivityQuery] = useState('');
      const [activityNote, setActivityNote] = useState('');

      // 移除单条活动：失败时给提示，成功后同步刷新统计与条形。
      // 活动文本筛选（案件名/表名/类型），空串放行。
      const matchesActivity = (item) => {
        const q = activityQuery.trim().toLowerCase();
        if (!q) return true;
        return `${item?.title ?? ''} ${item?.detail ?? ''} ${item?.kind ?? ''}`.toLowerCase().includes(q);
      };
      const activityShown = (activityDay
        ? activity.filter((item) => {
            const t = Date.parse(String(item.at ?? ''));
            if (!Number.isFinite(t)) return false;
            const dt = new Date(t);
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` === activityDay;
          })
        : activity).filter(matchesActivity);

      const dropActivity = async (item) => {
        try {
          const body = await post('/activity/remove', { at: item?.at ?? '', title: item?.title ?? '' });
          if (Array.isArray(body?.entries)) setActivity(body.entries);
          setActivitySummary(typeof body?.summaryText === 'string' ? body.summaryText : '');
          if (Array.isArray(body?.summary?.buckets)) setActivityBuckets(body.summary.buckets);
          setActivityNote('');
        } catch (error) {
          setActivityNote('移除活动失败：' + (error && error.message ? error.message : error));
        }
      };
      useEffect(() => {
        let alive = true;
        if (!db) { setEvList([]); return undefined; }
        (async () => {
          try {
            const body = await api('/evidences', { db });
            if (alive) setEvList(body?.evidences ?? []);
          } catch {
            if (alive) setEvList([]);
          }
          try {
            const f = await api('/facets', { db });
            if (alive) setFacets(f?.apps?.length ? f : null);
          } catch {
            if (alive) setFacets(null);
          }
        })();
        return () => { alive = false; };
      }, [db]);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const body = await api('/activity');
            if (alive) {
              setActivity(Array.isArray(body?.entries) ? body.entries : []);
              setActivitySummary(typeof body?.summaryText === 'string' ? body.summaryText : '');
              setActivityBuckets(Array.isArray(body?.summary?.buckets) ? body.summary.buckets : []);
            }
          } catch {
            if (alive) setActivity([]);
          }
        })();
        return () => { alive = false; };
      }, [db]);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const body = await api('/brief', { db });
            if (alive) setBriefInfo(body);
          } catch {
            if (alive) setBriefInfo(null);
          }
        })();
        return () => { alive = false; };
      }, [db]);

      const refreshExports = async () => {
        try {
          const data = await api('/exports?limit=8');
          setExportsInfo(data ?? null);
          setExportsNote('');
        } catch (error) {
          setExportsNote(`读取导出目录失败：${String(error?.message ?? error)}`);
        }
      };

      const refreshBrief = async () => {
        setBriefNote('刷新中…');
        try {
          const body = await post('/brief', {});
          setBriefInfo({ state: body.state, current: briefInfo?.current ?? null });
          setBriefNote('已刷新');
        } catch (e) {
          setBriefNote(`刷新失败：${String(e.message ?? e)}`);
        }
      };

      const briefText = () => {
        const st = briefInfo?.state;
        if (!st) return '会话语境：读取注入状态失败（不影响检索）';
        if (st.ok === null) return '会话语境：尚未注入（启动后会自动写入 AGENTS.md）';
        if (!st.ok) return `会话语境：注入失败 —— ${st.error ?? '未知错误'}`;
        const when = st.at ? new Date(st.at).toLocaleTimeString('zh-CN', { hour12: false }) : '';
        const inside = briefInfo?.current ? (briefInfo.current.included ? '含本库' : '不含本库') : '';
        return `会话语境：已注入 ${st.cases} 个案件概览${inside ? `（${inside}）` : ''} · ${when} · 新会话会自动带上检材清单`;
      };

      // 检索结果行显示检材名称（而不是只有 eid）：研判时看到的是文件名，不是数字
      const evLabel = (eid) => {
        const hit = evList.find((ev) => Number(ev.eid) === Number(eid));
        if (hit && hit.name) return hit.name;
        return '检材 ' + eid;
      };      const [copyNote, setCopyNote] = useState('');
      const [overviewNote, setOverviewNote] = useState('');
      const [result, setResult] = useState(null);
      const [detail, setDetail] = useState(null);
      const [busy, setBusy] = useState('');
      const [progress, setProgress] = useState(null);
      const [error, setError] = useState('');
      const [crumbs, setCrumbs] = useState([]);
      const [myosOpen, setMyosOpen] = useState(false);

      // 跨案 badge 需要提前知道数量；失败静默（badge 不显示），不影响主流程。
      const crossInfo = useLoad(() => api('/cross/list', {}), []);
      useEffect(() => { ensureStyle(); }, []);

      const scan = useCallback(async (target) => {
        setError('');
        try {
          const body = await api('/list', target ? { dir: target } : {});
          setIndexes(body.indexes ?? []);
          const list = body.indexes ?? [];
          const keep = list.some((ix) => ix.dbPath === db);
          if (list.length && !keep) {
            const savedDb = localStorage.getItem('seeu.panelDb');
            const first = list.find((ix) => ix.dbPath === savedDb) ?? list[0];
            setDb(first.dbPath);
            if (first.caseDir) setDir(first.caseDir);
            loadNodeRef.current?.(first.dbPath, 'root');
          }
        } catch (e) { setError(String(e.message ?? e)); }
      }, [db]);

      useEffect(() => {
        if (dir) localStorage.setItem('seeu.indexDir', dir);
      }, [dir]);

      // 标签页与索引库都记住：下次打开面板直接回到上次的位置
      useEffect(() => { localStorage.setItem('seeu.panelTab', tab); }, [tab]);
      useEffect(() => { if (db) localStorage.setItem('seeu.panelDb', db); }, [db]);

      const loadNode = useCallback(async (targetDb, targetNode) => {
        if (!targetDb) return;
        setBusy('tree');
        setError('');
        try {
          const body = await api('/tree', { db: targetDb, node: targetNode });
          if (targetNode === 'root') rootTotalsRef.current = body.totals ?? null;
          setView(body);
          setNode(targetNode);
        } catch (e) { setError(String(e.message ?? e)); } finally { setBusy(''); }
      }, []);

      const loadNodeRef = useRef(null);
      loadNodeRef.current = loadNode;
      const rootTotalsRef = useRef(null);

      // 挂载时自动扫描默认目录（工作区 + 上次会话的案件目录），不用手点。
      const firstScan = useRef(false);
      useEffect(() => {
        if (firstScan.current) return;
        firstScan.current = true;
        void scan(dir.trim() || undefined);
      }, [scan, dir]);

      const openIndex = useCallback((index) => {
        setDb(index.dbPath);
        setDir(index.caseDir);
        setCrumbs([]);
        setResult(null);
        setDetail(null);
        setRecordSeed(null);
        loadNode(index.dbPath, 'root');
      }, [loadNode]);

      const startBuild = useCallback(async (resume = false) => {
        const target = dir.trim();
        if (!target) { setError('先填案件目录（ 例如：E:\\forensics\\案件目录）'); return; }
        setError('');
        setBusy('build');
        setProgress({ phase: 'probe', percent: 0, message: '提交建库任务…' });
        try {
          const { jobId } = await post('/build', { dir: target, concurrency: buildConc, rebuild: !resume });
          const poll = async () => {
            const job = await api('/build', { job: jobId });
            setProgress(job);
            if (job.status === 'running') { setTimeout(poll, 700); return; }
            setBusy('');
            if (job.status === 'done') {
              await scan(target);
              if (job.result?.db) { setDb(job.result.db); loadNode(job.result.db, 'root'); }
            } else if (job.status === 'cancelled') setError('');
            else setError(`${job.code ?? 'E_UNKNOWN'}：${job.error ?? '建库失败'}`);
          };
          poll();
        } catch (e) {
          setBusy('');
          setProgress(null);
          setError(String(e.message ?? e));
        }
      }, [dir, buildConc, scan, loadNode]);

      // 短词逐行扫描的追加预算（0 = 用设置里的默认预算）
      const [searchBudget, setSearchBudget] = useState(0);
      // 并发检索的应答序号：慢的旧请求（例如大库 2 字扫描 + 继续扫描）不能覆盖后来的结果。
      const searchSeq = useRef(0);
      // 续扫游标：上次扫描停下的 record.id；点「继续扫描」从这里接着扫，不重复扫已扫区间。
      const scanCursor = useRef(0);
      const scanSeen = useRef(0);
      const doSearch = useCallback(async (nextOffset, budgetOverride, resumeFrom = 0) => {
        if (!db || !query.trim()) return;
        // 事件对象也会传进来（onClick），Number.isFinite 过滤后按第 0 页处理
        const wantOffset = Number.isFinite(Number(nextOffset)) && Number(nextOffset) > 0 ? Math.floor(Number(nextOffset)) : 0;
        setBusy('search');
        setError('');
        setDetail(null);
        setCopyNote('');
        const extra = {};
        const eid = String(filters.eid ?? '').trim();
        if (eid) extra.eid = Number(eid);
        if (String(filters.app ?? '').trim()) extra.app = String(filters.app).trim();
        if (String(filters.from ?? '').trim()) extra.from = String(filters.from).trim();
        if (String(filters.to ?? '').trim()) extra.to = String(filters.to).trim();
        const mine = ++searchSeq.current;
        try {
          const params = { db, q: query.trim(), limit: 20, ...extra };
          const budget = Number(budgetOverride) > 0 ? Number(budgetOverride) : searchBudget;
          if (budget > 0) params.scanBudgetMs = Math.min(30000, budget);
          if (wantOffset > 0) params.offset = wantOffset;
          if (Number(resumeFrom) > 0) params.scanFromId = Math.floor(Number(resumeFrom));
          const data = await api('/search', params);
          if (mine === searchSeq.current) {
            if (Number(resumeFrom) > 0) scanSeen.current += Number(data.scanned) || 0;
            else scanSeen.current = Number(data.scanned) || 0;
            scanCursor.current = Number(data.scanNextId) || 0;
            setResult(data);
          }
        }
        catch (e) {
          if (mine === searchSeq.current) setError(String(e.message ?? e));
        }
        finally { setBusy(''); }
      }, [db, query, filters, searchBudget]);

      // 新条件（关键词/筛选）开始检索时，重置续扫进度。
      useEffect(() => {
        scanCursor.current = 0;
        scanSeen.current = 0;
      }, [db, query, filters.eid, filters.app, filters.from, filters.to]);

      const resetFilters = useCallback(() => {
        setFilters({ eid: '', app: '', from: '', to: '' });
      }, []);

      /** 把当前检索结果（含筛选）整批导出 CSV，Excel 可直接打开。 */
      const exportSearchCsv = async () => {
        const q = String(result?.query ?? query ?? '');
        if (!db || !q.trim()) return;
        setBusy('csv');
        setError('');
        setCopyNote('');
        const qs = new URLSearchParams({ db, q, max: '20000' });
        if (String(filters.eid ?? '').trim()) qs.set('eid', String(filters.eid).trim());
        if (String(filters.app ?? '').trim()) qs.set('app', String(filters.app).trim());
        if (String(filters.from ?? '').trim()) qs.set('from', String(filters.from).trim());
        if (String(filters.to ?? '').trim()) qs.set('to', String(filters.to).trim());
        try {
          const res = await fetch('/seeu-index/export/search.csv?' + qs.toString());
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const raw = await res.text();
          // fetch 的 text() 会吃掉 BOM，补回来（Excel 需要）
          const text = raw.startsWith('\uFEFF') ? raw : '\uFEFF' + raw;
          const rowsOut = Number(res.headers.get('x-seeu-rows') ?? 0);
          const totalOut = Number(res.headers.get('x-seeu-total') ?? rowsOut);
          const partial = res.headers.get('x-seeu-partial') === '1';
          const timedOut = res.headers.get('x-seeu-timed-out') === '1';
          const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const saved = await saveCsvText('检索导出-' + stamp + '.csv', text);
          if (saved && saved.ok === false) throw new Error(saved.error || '保存失败');
          const trunc = totalOut > rowsOut ? '（共 ' + totalOut + ' 条，单次最多 20000 行）' : '';
          const tail = timedOut
            ? '（超时保护：还有更多，建议加检材/时间筛选或改用 ≥3 字关键词）'
            : partial ? '，短词未扫完可先继续扫描再导出' : '';
          setCopyNote('已导出 ' + rowsOut + ' 行' + trunc + tail + (saved?.path ? '：' + saved.path : '') + '（UTF-8 BOM，Excel 可直接打开）');
        } catch (e) {
          setError('导出 CSV 失败：' + String(e.message ?? e));
        } finally {
          setBusy('');
        }
      };

      /** 统一的复制出口：Electron 走 preload 桥，纯 web 预览退回 navigator.clipboard。 */
      const copyText = useCallback(async (text) => {
        const value = String(text ?? '');
        if (!value) throw new Error('没有可复制的内容');
        if (window.seeu?.writeClipboard) {
          await window.seeu.writeClipboard(value);
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          throw new Error('当前环境不支持剪贴板');
        }
        return value.length;
      }, []);

      /** 把当前检索结果导出成可粘贴进报告的引用清单（逐条回查句柄）。 */
      const exportCitations = useCallback(async (all) => {
        const wantAll = all === true;
        let rows = result?.rows ?? [];
        if (!rows.length) return;
        // all=true 时翻完分页再导出（上限 200 条，避免一次回查过多句柄）
        const total = Number(result?.total ?? rows.length);
        if (wantAll && total > rows.length) {
          const extra = {};
          if (String(filters.eid ?? '').trim()) extra.eid = Number(filters.eid);
          if (String(filters.app ?? '').trim()) extra.app = String(filters.app).trim();
          if (String(filters.from ?? '').trim()) extra.from = String(filters.from).trim();
          if (String(filters.to ?? '').trim()) extra.to = String(filters.to).trim();
          const collected = [...rows];
          let offset = rows.length;
          try {
            while (collected.length < Math.min(total, 200) && offset < total) {
              const page = await api('/search', { db, q: result?.query ?? query, limit: 100, offset, ...extra });
              if (!page?.rows?.length) break;
              collected.push(...page.rows);
              offset += page.rows.length;
            }
          } catch { /* 拿不满就按已取到的导出 */ }
          rows = collected.slice(0, 200);
        }
        setBusy('copy');
        setError('');
        try {
          const parts = [];
          parts.push('# SeeU 取证索引 · 检索引用清单');
          parts.push(`关键词：${result.query ?? query}`);
          parts.push(`引擎：${result.engine ?? 'like'} · ${result.returned ?? rows.length} 条（导出 ${rows.length} 条${wantAll && total > rows.length ? `，总计 ${total} 条，最多导出 200 条` : ''}）`);
          const fl = [];
          if (filters.eid) fl.push(`检材 ${filters.eid}`);
          if (filters.app) fl.push(`应用 ${filters.app}`);
          if (filters.from) fl.push(`起始 ${filters.from}`);
          if (filters.to) fl.push(`结束 ${filters.to}`);
          if (fl.length) parts.push(`筛选：${fl.join(' · ')}`);
          parts.push(`索引库：${db}`);
          parts.push(`导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
          parts.push('');
          let idx = 0;
          let missing = 0;
          for (const r of rows) {
            idx += 1;
            let c = null;
            try { c = await api('/cite', { db, id: r.id }); } catch { c = null; }
            const head = [c?.ev ?? `检材 ${r.eid}`, c?.app ?? r.app, c?.ts ?? r.ts, c?.line != null ? `第 ${c.line} 行` : ''].filter(Boolean).join(' · ');
            parts.push(`${idx}. ${head}`);
            if (c?.citation) {
              const recheck = c.citation.match(/\(([^)]+)\)/);
              parts.push(`   引用：${recheck ? recheck[1] : c.citation}`);
            } else {
              missing += 1;
              parts.push('   引用：（该行无溯源句柄，只能作为导航线索）');
            }
            if (c?.verifyCmd) parts.push(`   回查：${c.verifyCmd}`);
            parts.push(`   摘要：${String(c?.text ?? r.snip ?? '').replace(/\s+/g, ' ').trim()}`);
            parts.push('');
          }
          if (missing) parts.push(`（其中 ${missing} 条无溯源句柄，已在清单里标注。）`);
          const n = await copyText(parts.join('\n'));
          setCopyNote(`已复制 ${rows.length} 条引用清单（${n} 字符）${missing ? `，其中 ${missing} 条无句柄` : ''}`);
        } catch (e) {
          setError(`复制引用清单失败：${String(e.message ?? e)}`);
        } finally { setBusy(''); }
      }, [db, result, query, filters, copyText]);

      const drill = useCallback((nextNode, label) => {
        setTreeFilter('');
        setCrumbs((c) => [...c, { node, label: label ?? nodeLabel(view, node) }]);
        loadNode(db, nextNode);
      }, [db, node, view, loadNode]);

      const goCrumb = useCallback((idx) => {
        setTreeFilter('');
        const target = idx < 0 ? 'root' : crumbs[idx].node;
        setCrumbs((c) => (idx < 0 ? [] : c.slice(0, idx)));
        loadNode(db, target);
      }, [crumbs, db, loadNode]);

      const showCite = useCallback(async (recordId, targetDb) => {
        const useDb = targetDb ?? db;
        if (!useDb || recordId === null || recordId === undefined) return;
        setBusy('cite');
        try { setDetail(await api('/cite', { db: useDb, id: recordId })); }
        catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      }, [db]);

      // 跨案视图在“该案索引不在本机”时，直接用跨案库字段拼出同样式的引用详情。
      const showDetail = useCallback((next) => setDetail(next ?? null), []);

      const openRecords = useCallback((seed) => {
        setRecordSeed(seed ?? null);
        setTab('records');
      }, []);

      const switchTab = useCallback((next) => {
        if (next === 'records' && tab !== 'records') setRecordSeed(null);
        setTab(next);
      }, [tab]);

      const totals = view?.totals ?? null;
      const children = view?.children ?? null;
      const treeQuery = treeFilter.trim().toLowerCase();
      const shownChildren = children
        ? (treeQuery
          ? children.filter((c) => String(labelOf(c) ?? c.name ?? c.id ?? '').toLowerCase().includes(treeQuery))
          : children)
        : null;
      const activeIndex = db ? (indexes.find((ix) => ix.dbPath === db) ?? null) : null;
      const crossStats = crossInfo.data?.stats ?? null;
      const tabCounts = {};
      if (rootTotalsRef.current?.records != null) tabCounts.records = rootTotalsRef.current.records;
      if (crossStats) tabCounts.cross = crossStats.sharedEntities ?? crossStats.cases;
      const rootTotals = rootTotalsRef.current;
      const rangeText = view?.timeRange
        ? String(view.timeRange.f ?? '…').slice(0, 10) + ' ~ ' + String(view.timeRange.t ?? '…').slice(0, 10)
        : '';
      const kpiItems = db ? [
        { label: '案件', value: activeIndex?.caseName ?? view?.name ?? caseNameOf(db), text: true },
        { label: '检材', value: String(rootTotals?.evidences ?? '—') },
        { label: '记录', value: String(rootTotals?.records ?? '—') },
        { label: '实体', value: String(rootTotals?.entities ?? '—') },
        { label: '库大小', value: activeIndex ? fmtBytes(activeIndex.sizeBytes ?? 0) : '—' },
        { label: '生成时间', value: activeIndex?.builtAt ? fmtTime(activeIndex.builtAt) : '—', text: true },
        ...(rangeText ? [{ label: '时间范围', value: rangeText, text: true }] : []),
      ] : null;
      // 案件概览：给研判报告/交接用的 Markdown 抬头（检材清单 + 规模 + 索引信息）
      const copyOverview = async () => {
        if (!db) return
        setBusy('overview')
        setError('')
        try {
          const body = await api('/evidences', { db })
          const evs = body.evidences ?? []
          const caseName = activeIndex?.caseName ?? view?.name ?? caseNameOf(db)
          const lines = []
          lines.push('# 案件概览')
          lines.push('')
          lines.push(`- 案件：${caseName}`)
          if (activeIndex?.caseNumber) lines.push(`- 案件编号：${activeIndex.caseNumber}`)
          if (activeIndex?.caseDir) lines.push(`- 案件目录：${activeIndex.caseDir}`)
          lines.push(`- 索引库：${db}`)
          lines.push(`- 生成时间：${activeIndex?.builtAt ? fmtTime(activeIndex.builtAt) : '—'}（schema v${view?.schemaVersion ?? '?'}）`)
          lines.push(`- 规模：检材 ${rootTotals?.evidences ?? evs.length} 个 · 记录 ${rootTotals?.records ?? '—'} 条 · 实体 ${rootTotals?.entities ?? '—'} 个 · 库 ${activeIndex ? fmtBytes(activeIndex.sizeBytes ?? 0) : '—'}`)
          if (rangeText) lines.push(`- 数据时间范围：${rangeText}`)
          lines.push('')
          lines.push('| 检材 | 名称 | 持有人 | 平台 | 记录数 | 备注 |')
          lines.push('| --- | --- | --- | --- | --- | --- |')
          for (const ev of evs) {
            const remark = String(ev.remark ?? '').replace(/\|/g, '\\|')
            lines.push(`| ${ev.eid} | ${ev.name ?? ''} | ${ev.holder ?? ''} | ${ev.platform ?? ''} | ${ev.recordCount ?? ''} | ${remark} |`)
          }
          lines.push('')
          lines.push('> 由 SeeU 取证索引生成；具体记录用「检索 / 记录」视图并导出引用清单。')
          const chars = await clipboardWrite(lines.join('\n'))
          setOverviewNote(`已复制案件概览（${chars} 字符，含 ${evs.length} 个检材）`)
        } catch (e) {
          setError(`复制案件概览失败：${String(e.message ?? e)}`)
        } finally { setBusy('') }
      }
      // 首次使用引导：还没有任何索引库时，把「火眼跑完 → 建库 → 查询」三步写在面板里
      const onboarding = !db && indexes.length === 0 ? h('div', { style: { ...S.card, gap: 8 } },
        h('div', { style: { fontSize: 12.5, fontWeight: 650, color: C_FG } }, '三步开始'),
        h('ol', { style: { margin: '2px 0 0 18px', padding: 0, color: C_FG2, fontSize: 12, lineHeight: '1.85' } },
          h('li', null, '先在火眼（GoldenEyes）里跑完检材解析，记下案件目录（含 .gec 与「检材分析数据」的那个文件夹）。'),
          h('li', null, '把目录粘到上面的输入框，点「建库 / 更新」（首次约 3–5 分钟；只写 .seeu-index，不动原始证据）。'),
          h('li', null, '建库完成后用 树 / 检索 / 记录 / 实体 / 时间线 / 表 查；每条结论都能用「引用」回查 Goldeneyes 句柄。')),
        h('div', { style: { ...S.muted, fontSize: 11.5 } }, '已有索引库？点「扫描已有索引」会向下找两层，也会自动发现你在面板里选过的上次案件目录。')) : null;
      const noDbHint = h(EmptyState, {
        title: '未选择索引库',
        text: '在顶部填写案件目录后点「扫描已有索引」或「建库 / 更新」，也可以在索引列表里点一个已有库。',
      });
      const detailPanel = detail ? h('div', { style: S.panel },
        h('div', { style: S.row },
          h('span', { style: S.title }, '引用详情'),
          busy === 'cite' ? h(LoadingLine, { text: '回查中…' }) : null,
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            detail.citation
              ? actionButton('复制引用', async () => {
                  try {
                    const n = await copyText(`${detail.citation}\n回查：${detail.verifyCmd ?? ''}`);
                    setCopyNote(`已复制该引用（${n} 字符）`);
                  } catch (e) { setError(`复制失败：${String(e.message ?? e)}`); }
                })
              : null,
            actionButton('关闭', () => setDetail(null)))),
        copyNote ? h('div', { style: S.noticeInfo }, copyNote) : null,
        h(CiteDetail, { detail })) : null;

      return h('div', { style: S.wrap },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 15, fontWeight: 650, color: C_FG, letterSpacing: '.2px' } }, '取证案件索引'),
          h('span', { style: { ...S.muted, fontSize: 11 } }, '只读 SQLite 索引 · 树导航 / 检索 / 记录 / 实体 / 时间线 / 表 / 跨案碰撞 · 引用可回查 Goldeneyes 句柄')),
        kpiItems
          ? h(KpiStrip, { items: kpiItems })
          : h('div', { style: S.noticeInfo }, '选择索引库后，这里显示案件名、检材数、记录数、实体数、库大小与生成时间。'),
        db
          ? h('div', { style: S.row },
            actionButton(busy === 'overview' ? '导出中…' : '复制案件概览', copyOverview, { disabled: busy === 'overview' }),
            h('span', { style: S.muted }, '给研判报告/交接用的 Markdown：案件信息 + 检材清单（名称/持有人/平台/记录数/备注）'),
            overviewNote ? h('span', { style: { color: C_ACC, fontSize: 11.5 } }, overviewNote) : null)
          : null,
        db
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5 } },
            h('span', { style: { color: briefInfo?.state?.ok ? '#34D399' : briefInfo?.state?.ok === false ? '#F87171' : '#FBBF24', fontSize: 10 } }, '●'),
            h('span', { style: { color: C_FG3 } }, briefText()),
            actionButton('刷新会话概览', refreshBrief, {}),
            briefNote ? h('span', { style: { color: C_ACC } }, briefNote) : null)
          : null,

        h('div', { style: { ...S.card, gap: 6 } },
          h('div', { style: S.row },
            h('span', { style: { ...S.tag, color: C_ACC } }, '最近导出'),
            h('span', { style: { ...S.muted, fontSize: 11 } }, exportsInfo?.dir ?? '（导出目录读取中）'),
            actionButton('刷新', () => { refreshExports() }, {}),
            window.seeu && window.seeu.exportsDir
              ? actionButton('打开导出目录', async () => {
                const result = await window.seeu.exportsDir.open();
                setExportsNote(result?.ok ? '已打开导出目录' : `打开失败：${result?.error ?? '未知错误'}`);
              }, {})
              : null,
            exportsNote ? h('span', { style: { color: C_ACC, fontSize: 11.5 } }, exportsNote) : null),
          exportsInfo && exportsInfo.count
            ? h('div', { style: { display: 'grid', gap: 2, fontSize: 11.5 } },
              exportsInfo.files.map((file) => h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' }, key: file.path },
                h('span', {
                  style: { color: C_ACC, fontFamily: 'ui-monospace,Consolas,monospace', cursor: 'pointer' },
                  title: '点击打开这个文件',
                  'data-export-open': file.name,
                  onClick: async () => {
                    if (!(window.seeu && window.seeu.exportsDir && window.seeu.exportsDir.openFile)) {
                      setExportsNote('网页预览不能直接打开文件，请在桌面版里点击');
                      return;
                    }
                    const result = await window.seeu.exportsDir.openFile(file.name);
                    setExportsNote(result?.ok ? `已打开 ${file.name}` : `打开失败：${result?.error ?? '未知错误'}`);
                  },
                }, file.name),
                h('span', { style: S.muted }, `${(file.sizeBytes / 1024).toFixed(0)} KB`),
                h('span', { style: S.muted }, new Date(file.mtime).toLocaleString()),
                h('span', {
                  style: { color: C_FG3, cursor: 'pointer', padding: '0 4px', fontSize: 13 },
                  title: '删除这个导出文件（不可恢复）',
                  'data-export-remove': file.name,
                  onClick: async () => {
                    if (!(window.seeu && window.seeu.exportsDir && window.seeu.exportsDir.remove)) {
                      setExportsNote('网页预览不能删除文件，请在桌面版里操作');
                      return;
                    }
                    const result = await window.seeu.exportsDir.remove(file.name);
                    if (result?.ok) {
                      setExportsNote(`已删除 ${file.name}`);
                      await refreshExports();
                    } else {
                      setExportsNote(`删除失败：${result?.error ?? '未知错误'}`);
                    }
                  },
                }, '×'))))
            : h('div', { style: S.muted }, '还没有导出文件：面板导出 CSV 或让模型用 MCP 导出后，这里会列出最近 8 个。')),
        view && view.needsRebuild
          ? h('div', { style: S.noticeWarn }, `索引库 schema v${view.schemaVersion ?? '?'} 与当前工具 v${view.currentSchemaVersion ?? '?'} 不一致：建议点「建库 / 更新」重建，旧库可能缺字段或查不到新类别。`)
          : null,

        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('input', {
              style: S.input, value: dir, placeholder: '案件目录，例如 E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5',
              onChange: (e) => setDir(e.target.value), spellCheck: false,
            }),
            actionButton('扫描已有索引', () => scan(dir.trim() || undefined), { disabled: busy === 'build' }),
            h('select', {
              value: String(buildConc),
              title: '建库并发：并发越高越快，但对火眼后端压力也越大（大案件建议 6）',
              'data-build-concurrency': String(buildConc),
              onChange: (e) => {
                const value = Number(e.target.value) === 8 ? 8 : Number(e.target.value) === 6 ? 6 : 3
                setBuildConc(value)
                localStorage.setItem('seeu.buildConcurrency', String(value))
              },
              style: { ...S.input, width: 96, flex: 'none' },
            }, h('option', { value: '3' }, '并发 3'), h('option', { value: '6' }, '并发 6'), h('option', { value: '8' }, '并发 8')),
            actionButton(busy === 'build' ? '建库中…' : '建库 / 更新', startBuild, { primary: true, disabled: busy === 'build' }),
            buildingCase
              ? actionButton('继续上次建库', () => startBuild(true), {
                disabled: busy === 'build',
                title: `上次建库中断（半成品 ${Math.round((buildingCase.sizeBytes ?? 0) / 1048576)} MB），从已完成处继续、不重跑`,
                attrs: { 'data-build-resume': String(Math.round((buildingCase.sizeBytes ?? 0) / 1048576)) },
              })
              : null,
            h('select', {
              value: String(scanBudget ?? 2500),
              'data-scan-budget': String(scanBudget ?? 2500),
              title: '短词扫描预算：2 字关键词只能逐行扫描，扫到预算上限就先返回已找到的结果（越大越完整、越慢）',
              onChange: (e) => saveScanBudget(Number(e.target.value)),
              style: { ...S.input, width: 132, flex: 'none' },
            }, h('option', { value: '1500' }, '短词 1.5 秒'), h('option', { value: '2500' }, '短词 2.5 秒'), h('option', { value: '5000' }, '短词 5 秒'), h('option', { value: '10000' }, '短词 10 秒')),
            scanNote ? h('span', { style: S.muted }, scanNote) : null,
            actionButton('从 MYOS 导入…', () => setMyosOpen(true), { disabled: busy === 'build', title: '从超级取证大师（MYOS）的结果库导入为 SeeU 索引' })),
          progress ? (() => {
            const bp = progress.progress ?? null;
            const tag = bp?.phaseLabel ?? progress.phase ?? '建库';
            const percent = bp?.percent ?? progress.percent ?? 0;
            const detail = bp
              ? `${bp.detail}${bp.running ? ` · 已用 ${bp.elapsedText}${bp.etaText ? ` · 剩余约 ${bp.etaText}` : ''}` : ''}`
              : `${progress.total ? `${progress.completed}/${progress.total}` : ''} ${progress.percent ?? 0}%${progress.message ? ` · ${progress.message}` : ''}`;
            return h('div', { style: { ...S.card, gap: 6 } },
              h('div', { style: S.row },
                h('span', { style: { ...S.tag, flex: 'none', color: C_ACC } }, tag),
                h('span', { style: S.muted }, detail)),
              h('div', { style: { height: 6, borderRadius: 3, background: C_L2, overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: `${percent}%`, borderRadius: 3, background: C_ACC, transition: 'width .3s' } })),
              bp?.hint ? h('div', { style: { ...S.muted, fontSize: 11 } }, bp.hint) : null,
              bp?.summary ? h('div', { style: { ...S.muted, fontSize: 11, color: C_ACC } }, bp.summary) : null,
              bp?.cancellable ? h('div', { style: S.row },
                actionButton('取消建库', async () => {
                  try {
                    await post('/build/cancel', { job: progress.id });
                    setProgress({ ...progress, message: '正在取消…' });
                  } catch (e) { setError(String(e.message ?? e)); }
                }, { danger: true })) : null);
          })() : null,
          indexes.length
            ? h('div', { style: { ...S.card, gap: 4 } },
              h('div', { style: S.row },
                h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, `索引库 ${indexes.length} 个`),
                h('span', { style: S.muted }, '点一行切换当前库')),
              (() => {
                const counts = { all: indexes.length, ges: 0, myos: 0, external: 0 };
                for (const ix of indexes) if (counts[ix.source] != null) counts[ix.source] += 1;
                const items = [['all', '全部'], ['ges', '火眼建库'], ['myos', 'MYOS 导入'], ['external', '外部目录']];
                const visible = srcFilter === 'all' ? indexes : indexes.filter((ix) => ix.source === srcFilter);
                const emptyText = '没有来源为「' + (items.find(([k]) => k === srcFilter)?.[1] ?? srcFilter) + '」的索引';
                return [
                  h('div', { style: { ...S.row, gap: 4, flexWrap: 'wrap' } }, items.map(([value, label]) => h('span', {
                    key: value,
                    'data-index-src': value,
                    role: 'button',
                    className: 'seeu-chip' + (srcFilter === value ? ' is-on' : ''),
                    style: {
                      fontSize: 11, padding: '1px 7px', borderRadius: 9, cursor: 'pointer',
                      color: srcFilter === value ? C_FG : C_FG3,
                      background: srcFilter === value ? C_ACTIVE : 'transparent',
                      border: '1px solid ' + (srcFilter === value ? C_ACC : C_L2),
                    },
                    onClick: () => setSrcFilter(value),
                  }, `${label} ${counts[value] ?? 0}`))),
                  visible.length
                    ? h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 180, overflow: 'auto' } },
                      visible.map((ix) => {
                        const on = !!ix.dbPath && ix.dbPath === db;
                        const meta = ix.meta ?? null;
                        return h('div', {
                          key: ix.dbPath ?? ix.caseDir,
                          className: 'seeu-row is-clickable' + (on ? ' is-active' : ''),
                          style: {
                            display: 'flex', flexDirection: 'column', gap: 2, minHeight: 34, padding: '5px 8px',
                            borderBottom: '1px solid ' + C_L1, borderLeft: '2px solid ' + (on ? C_ACC : 'transparent'),
                            background: on ? C_ACTIVE : 'transparent', cursor: 'pointer', fontSize: 12.5,
                          },
                          onClick: () => (ix.dbPath ? openIndex(ix) : setDir(ix.caseDir ?? '')),
                        },
                          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                            h('span', { style: { color: C_FG, fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ix.caseName ?? ix.caseNumber ?? basename(ix.caseDir)),
                            ix.caseNumber ? h('span', { style: { ...S.tag, flex: 'none' } }, ix.caseNumber) : null,
                            ix.sourceLabel ? h('span', {
                              style: {
                                ...S.tag, flex: 'none',
                                color: ix.source === 'ges' ? C_FG3 : C_ACC,
                                borderColor: ix.source === 'ges' ? C_L2 : C_ACC,
                              },
                              title: ix.tool ? '索引由 ' + ix.tool + ' 生成' : '',
                            }, ix.sourceLabel) : null,
                            h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, fmtBytes(ix.sizeBytes ?? 0)),
                            ix.building
                              ? h('span', {
                                  title: '上次建库中断，只剩 case-index.db.building；点「建库 / 更新」会重新建（已默认 rebuild）',
                                  style: { flex: 'none', color: '#F5A524', fontSize: 11, padding: '0 4px' },
                                }, '⚠ 上次建库未完成')
                              : h('span', {
                                  role: 'button',
                                  'data-chain-check': ix.dbPath,
                                  title: '检查索引 / 检索 / 火眼挂载 / 镜像解析',
                                  style: { flex: 'none', color: C_ACC, fontSize: 11, cursor: 'pointer', padding: '0 4px' },
                                  onClick: async (e) => {
                                    if (e && e.stopPropagation) e.stopPropagation();
                                    await runChain(ix);
                                  },
                                }, chain && chain.dbPath === ix.dbPath && chain.running ? '体检中…' : '体检'),
                            ix.extra ? h('span', {
                              role: 'button',
                              title: '从面板的额外目录列表移除（不删除索引文件）',
                              style: { flex: 'none', color: C_FG3, fontSize: 11, cursor: 'pointer', padding: '0 4px' },
                              onClick: async (e) => {
                                if (e && e.stopPropagation) e.stopPropagation();
                                try {
                                  await post('/extra-dirs/remove', { dir: ix.caseDir });
                                  await scan();
                                } catch (err) { setError(String(err.message ?? err)); }
                              },
                            }, '移除') : null,
                            h('span', { style: { marginLeft: 'auto', ...S.rowTime } }, ix.builtAt ? fmtTime(ix.builtAt) : '')),
                          ix.building
                            ? h('div', { style: { color: '#F5A524', fontSize: 11 } }, '半成品 ' + fmtBytes(ix.sizeBytes ?? 0) + ' · 重新建库会丢弃它')
                            : null,
                          meta?.text ? h('div', { style: { color: C_FG3, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: meta.text }, meta.text) : null,
                          meta?.warn ? h('div', { style: { color: '#F5A524', fontSize: 11 } }, '⚠ ' + meta.warn) : null);
                      }))
                    : h('div', { style: { ...S.muted, padding: '6px 2px' } }, emptyText),
                  chain
                    ? h('div', {
                        'data-chain-result': chain.dbPath,
                        style: { ...S.card, gap: 4, marginTop: 6, border: '1px solid ' + (chain.result && chain.result.ok ? C_ACC : C_L2) },
                      },
                        h('div', { style: S.row },
                          h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, '链路体检'),
                          h('span', { style: S.muted }, chain.running ? '检查中…' : (chain.result && chain.result.ok ? '✅ 全部通过' : (chain.error ? '❌ ' + chain.error : '❌ 有环节失败')))),
                        chain.result && chain.result.report
                          ? h('div', { style: { ...S.muted, fontSize: 11.5, lineHeight: 1.6 } },
                              '案件：' + ((chain.result.report.case && chain.result.report.case.name) || '-') + ' · ' + ((chain.result.report.case && chain.result.report.case.number) || '-'),
                              chain.result.report.index && chain.result.report.index.counts
                                ? ' · ' + chain.result.report.index.counts.records + ' 条记录 / ' + chain.result.report.index.counts.entities + ' 个实体'
                                : '',
                              chain.result.report.query ? ' · 检索「' + chain.result.report.query.q + '」' + (chain.result.report.query.total ?? 0) + ' 命中' : '',
                              chain.result.report.mounts ? ' · 火眼挂载 ' + (chain.result.report.mounts.items || []).filter((i) => i.readable).length + '/' + (chain.result.report.mounts.items || []).length + ' 可读' : '')
                          : null,
                        chain.result && chain.result.report
                          ? (() => {
                              const rep = chain.result.report;
                              const rows = [];
                              if (rep.index) rows.push(['索引', !!rep.index.ok, rep.index.ok ? (rep.index.counts ? (rep.index.counts.records + ' 条记录 / ' + rep.index.counts.entities + ' 个实体') : '可打开') : (rep.index.error || '失败')]);
                              if (rep.query) rows.push(['检索', !!rep.query.ok, rep.query.ok ? ('「' + (rep.query.q || '') + '」' + (rep.query.engine ? (rep.query.engine + ' · ') : '') + (rep.query.total ?? 0) + ' 命中 · ' + (rep.query.ms ?? 0) + ' ms') : (rep.query.error || '失败')]);
                              if (rep.mounts) {
                                const items = rep.mounts.items || [];
                                rows.push(['火眼挂载', !!rep.mounts.ok, items.filter((i) => i.readable).length + '/' + items.length + ' 可读']);
                              }
                              if (rep.images && rep.images.length) {
                                rows.push(['镜像解析', rep.images.filter((i) => i.inspectOk).length === rep.images.length, rep.images.filter((i) => i.inspectOk).length + '/' + rep.images.length + ' 可解析']);
                              }
                              return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 } },
                                rows.map((row) => h('div', { 'data-chain-step': row[0], style: { ...S.row, gap: 6, fontSize: 11.5 } },
                                  h('span', { style: { color: row[1] ? C_ACC : '#F5A524', width: 12, flex: 'none' } }, row[1] ? '✓' : '×'),
                                  h('span', { style: { color: C_FG2, width: 62, flex: 'none' } }, row[0]),
                                  h('span', { style: { color: C_FG3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(row[2])))));
                            })()
                          : null,
                        chain.result && chain.result.report && (chain.result.report.fails || chain.result.summary && chain.result.summary.fails || []).length
                          ? h('div', { style: { color: '#F5A524', fontSize: 11.5 } }, '⚠ ' + ((chain.result.summary && chain.result.summary.fails) || []).join('；'))
                          : null,
                        h('div', { style: S.row },
                          actionButton('复制报告', async () => {
                            try {
                              await window.seeu.writeClipboard(String((chain.result && chain.result.text) || ''));
                            } catch (err) { setError(String((err && err.message) || err)); }
                          }),
                          actionButton('含镜像解析', () => { void runChain({ caseNumber: chain.caseNumber, dbPath: chain.dbPath }, 1); }, { attrs: { 'data-chain-deep': '1' }, disabled: chain.running || !!(chain.result && chain.result.report && chain.result.report.images && chain.result.report.images.length), title: '额外调用 LovelyCarve 解析镜像分区（约 200ms/个）' }),
                          actionButton('关闭', () => setChain(null))))
                    : null,
                ];
              })(),
            )
            : h(EmptyState, { title: '还没有索引库', text: '在顶部填入案件目录（火眼全解析结果目录），点「建库 / 更新」；已有索引库时可点「扫描已有索引」。' })),
        h('div', { style: { ...S.card, gap: 6 } },
          h('div', { style: { ...S.row, gap: 8 } },
            h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, '最近活动'),
            h('span', { 'data-activity-count': '1', style: S.muted }, activity.length ? (activityDay ? `当天 ${activity.filter((item) => { const t = Date.parse(String(item.at ?? '')); if (!Number.isFinite(t)) return false; const dt = new Date(t); const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; return key === activityDay; }).length} 条 · 共 ${activity.length} 条` : `共 ${activity.length} 条 · 点一行打开对应索引`) : '还没有活动记录'),
            h('span', { 'data-activity-summary': '1', title: activitySummary || '', style: { ...S.muted, marginLeft: 6 } }, activitySummary),
            h('input', {
              'data-activity-search': '1',
              value: activityQuery,
              placeholder: '筛选活动（案件名 / 表名 / 类型）',
              'aria-label': '筛选最近活动',
              style: { width: 200, fontSize: 11, padding: '2px 6px' },
              onChange: (event) => setActivityQuery(event.target.value),
            }),
            activityQuery.trim() ? h('span', { 'data-activity-search-count': '1', style: S.muted }, activityShown.length ? `${activityShown.length} 条匹配` : '没有匹配的活动') : null,
            activityDay ? h('span', {
              'data-activity-filter': '1',
              style: { fontSize: 11, color: C_ACC, marginLeft: 6 },
            }, `只看 ${activityDay} · 点条形取消` ) : null,
            activityBuckets.length ? h('div', {
              'data-activity-bars': '1',
              title: '最近 ' + activityBuckets.length + ' 天活动分布（按天）',
              style: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 16, marginLeft: 8 },
            }, activityBuckets.map((bucket, index) => {
              const peak = Math.max(1, ...activityBuckets.map((item) => Number(item.total) || 0));
              const height = bucket.total ? Math.max(3, Math.round((Number(bucket.total) / peak) * 16)) : 2;
              const color = bucket.builds && bucket.imports ? C_OK : (bucket.builds ? C_ACC : (bucket.imports ? C_WARN : C_L2));
              const active = activityDay === bucket.date;
              return h('div', {
                key: bucket.date || index,
                'data-activity-day': bucket.date || '',
                role: 'button',
                title: `${bucket.date}：建库 ${bucket.builds || 0} 次 · MYOS 导入 ${bucket.imports || 0} 次（点击只看当天）`,
                onClick: () => setActivityDay(active ? '' : (bucket.date || '')),
                style: {
                  width: 5,
                  height,
                  borderRadius: 1,
                  background: color,
                  opacity: active ? 1 : (bucket.total ? 0.9 : 0.35),
                  outline: active ? '1px solid ' + C_ACC : 'none',
                  cursor: 'pointer',
                },
              });
            })) : null,
            h('div', { style: { flex: 1 } }),
            activity.length ? h('button', {
              type: 'button',
              className: 'seeu-btn',
              style: { fontSize: 11, padding: '3px 8px' },
              onClick: async () => {
                try { await post('/activity/clear', {}); setActivity([]); setActivitySummary(''); setActivityBuckets([]); } catch { /* 忽略 */ }
              },
            }, '清空') : null),
          activityShown.length ? activityShown.slice(0, 6).map((item) => h('div', {
              key: `${item.at ?? ''}-${item.title ?? ''}`,
              className: 'seeu-activity-row',
              'data-activity-kind': item.kind ?? '',
              style: { ...S.row, gap: 8, padding: '4px 2px', borderTop: '1px solid rgba(148,163,184,0.18)', cursor: item.caseDir ? 'pointer' : 'default' },
              onClick: async () => {
                if (!item.caseDir) return;
                setActivityNote('');
                try {
                  const body = await api('/list', {});
                  const list = (body && body.indexes) || [];
                  const wantedDir = item.caseDir ? String(item.caseDir).split('\\').join('/').toLowerCase() : '';
                  const target = list.find((ix) => {
                    if (item.dbFile && ix.dbPath === item.dbFile) return true;
                    const dir = ix.caseDir ? String(ix.caseDir).split('\\').join('/').toLowerCase() : '';
                    return Boolean(wantedDir) && dir === wantedDir;
                  });
                  if (!target) {
                    setActivityNote('打不开该活动：索引已不存在（' + (item.dbFile || item.caseDir) + '），可能被删除或移动。');
                    return;
                  }
                  setIndexes(list);
                  setDb(target.dbPath);
                  if (target.caseDir) setDir(target.caseDir);
                  loadNode(target.dbPath, 'root');
                } catch (error) {
                  setActivityNote('打不开该活动：' + (error && error.message ? error.message : error));
                }
              },
            },
            h('span', { style: { fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: item.kind === 'build' ? 'rgba(34,211,238,0.14)' : 'rgba(168,85,247,0.14)', color: item.kind === 'build' ? '#67E8F9' : '#C4B5FD' } }, item.kind === 'build' ? '建库' : 'MYOS'),
            h('span', { style: { fontSize: 12, color: C_FG } }, item.title ?? ''),
            h('span', { style: S.muted }, item.detail ?? ''),
            h('div', { style: { flex: 1 } }),
            h('span', { style: S.muted }, item.at ? new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''),
            h('button', {
              type: 'button',
              'data-activity-remove': '1',
              title: '移除这条活动记录（不删除索引文件）',
              className: 'seeu-btn',
              style: { fontSize: 10.5, padding: '1px 6px', opacity: 0.75 },
              onClick: (event) => { event.stopPropagation(); void dropActivity(item); },
            }, '移除')))
            : h('div', { 'data-activity-empty': '1', style: S.muted }, activityQuery.trim() ? '没有匹配的活动' : '建库或从 MYOS 导入后，这里会按时间列出最近的工作，点一行可直接打开对应索引。'),
          activityNote ? h('div', {
            'data-activity-note': '1',
            style: { ...S.muted, color: C_WARN, fontSize: 12 },
          }, activityNote) : null),
        onboarding,
        myosOpen ? h(MyosDialog, {
          initialDir: dir.trim(),
          onClose: () => setMyosOpen(false),
          onImported: async (info) => {
            setMyosOpen(false);
            await scan(info.caseDir);
            if (info.dbFile) { setDb(info.dbFile); loadNode(info.dbFile, 'root'); }
          },
        }) : null,
        error ? h('div', { style: S.noticeErr }, error) : null,

        h('div', { style: S.panel },
          h('div', { style: { ...S.row, gap: 8 } },
            h(Tabs, { tab, onChange: switchTab, counts: tabCounts }),
            h('span', {
              style: { ...S.muted, marginLeft: 'auto', maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              title: db ?? '',
            }, db ? `当前库：${caseNameOf(db)}` : '未选择索引库')),

          tab === 'tree' ? (view ? h('div', { style: S.card },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', paddingBottom: 6, borderBottom: '1px solid ' + C_L1 } },
              h('span', { style: S.crumb, onClick: () => goCrumb(-1), title: '回到根节点' }, '案件'),
              crumbs.map((c, i) => h('span', {
                key: `${c.node}-${i}`,
                className: 'seeu-crumb' + (i === crumbs.length - 1 ? ' is-active' : ''),
                style: i === crumbs.length - 1 ? S.crumbOn : S.crumb,
                onClick: () => goCrumb(i),
              }, '› ', c.label)),
              busy === 'tree' ? h(LoadingLine, { text: '加载中…' }) : null,
              h('span', { style: { marginLeft: 'auto', ...S.muted } }, node === 'root' ? '根节点' : node)),
            h('div', { style: { ...S.row, gap: 10 } },
              h('span', { style: { color: C_FG, fontSize: 12.5, fontWeight: 600 } }, view.name || view.case || '案件'),
              view.case ? h('span', { style: { ...S.tag, flex: 'none' } }, view.case) : null,
              view.timeRange ? h('span', { style: S.muted }, `${view.timeRange.f ?? '…'} ~ ${view.timeRange.t ?? '…'}`) : null,
              view.evidence ? h('span', { style: S.muted }, [view.evidence.name, view.evidence.platform].filter(Boolean).join(' · ')) : null,
              h('span', { style: { marginLeft: 'auto', ...S.muted } }, totals
                ? `检材 ${totals.evidences ?? '-'} · 文件 ${totals.artifacts ?? '-'} · 记录 ${totals.records ?? '-'}`
                : '')),
            view.artifact ? h('div', {
              style: {
                fontFamily: FONT_CODE, fontSize: 11, color: C_FG2, background: C_BG2,
                border: '1px solid ' + C_L1, borderRadius: R_MD + 'px', padding: '6px 8px', margin: '6px 0',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              },
            }, `${view.artifact.app} / ${view.artifact.cat} / ${view.artifact.sub}\n${view.artifact.path}（${view.artifact.lines} 行，${view.artifact.citable ? '可引用' : '不可引用'}）`) : null,
            children
              ? h('div', {},
                children.length > 1 ? h('div', { style: { ...S.row, gap: 6, margin: '2px 0 4px' } },
                  h('input', {
                    style: { ...S.input, flex: '1 1 0', minWidth: 120 },
                    value: treeFilter,
                    placeholder: '过滤本层节点（应用 / 分类 / 文件名）',
                    'data-seeu-tree-filter': '1',
                    spellCheck: false,
                    onChange: (e) => setTreeFilter(e.target.value),
                  }),
                  h('span', { style: { ...S.muted, flex: 'none' } }, treeQuery
                    ? '显示 ' + shownChildren.length + '/' + children.length
                    : '本层 ' + children.length + ' 项'),
                  treeQuery ? actionButton('清空', () => setTreeFilter('')) : null,
                ) : null,
                shownChildren.length
                  ? h('div', { className: 'seeu-tree seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 460, overflow: 'auto' } },
                    shownChildren.map((c) => treeChildRow(c, drill)))
                  : emptyHint('本层没有匹配的节点'),
              )
              : null,
            view.records ? h('div', { style: S.card },
              h('div', { style: S.row },
                h('span', { style: S.muted }, `${view.records.offset + 1}-${view.records.offset + view.records.returned} / ${view.records.total}`),
                h('span', { style: { ...S.muted, marginLeft: 'auto' } }, '点一条看引用句柄。')),
              h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 380, overflow: 'auto' } },
                (view.records.rows ?? []).map((r) => h('div', {
                  key: r.id,
                  className: 'seeu-row is-clickable',
                  style: { display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5 },
                  onClick: () => showCite(r.id),
                },
                  h('span', { style: { ...S.tag, flex: 'none' } }, `#${r.line}`),
                  h('span', { style: S.rowTime }, r.ts ?? ''),
                  h('span', { style: S.ellipsis }, r.text)))),
              view.records.next ? h('div', { style: { marginTop: 8 } }, actionButton('下一页', () => drill(view.records.next, '下一页'))) : null) : null,
            view.citation ? h('div', { style: { ...S.card, marginTop: 8 } },
              h('div', { style: { fontFamily: FONT_CODE, fontSize: 11.5, color: C_ACC, wordBreak: 'break-all' } }, view.citation),
              h('div', { style: S.muted }, `回查命令：${view.verifyCmd}`)) : null)
            : emptyHint('建库或选中索引库后，这里按 检材 → 应用 → 分类 → 文件 → 记录 导航。')) : null,

          tab === 'search' ? h('div', { style: S.card },
            h('div', { style: { ...S.row, gap: 6 } },
              h('input', {
                style: S.input, value: query, placeholder: '关键词（≥3 字走 FTS5，2 字自动 LIKE）',
                onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
                spellCheck: false, disabled: !db,
              }),
              actionButton('检索', doSearch, { primary: true, disabled: !db || busy === 'search' }),
              busy === 'search' ? h(LoadingLine, { text: '检索中…' }) : null),
            h('div', { style: { ...S.row, gap: 6, marginTop: 6 } },
              h('select', {
                style: { ...S.input, flex: 'none', width: 200, cursor: db ? 'pointer' : 'default' },
                value: filters.eid,
                disabled: !db,
                title: '按检材筛选：下拉里就是火眼的检材名称，不用记 eid',
                onChange: (e) => setFilters((f) => ({ ...f, eid: e.target.value })),
                onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
              },
                h('option', { value: '' }, '全部检材'),
                ...evList.map((ev) => h('option', { key: ev.eid, value: String(ev.eid) },
                  '检材 ' + ev.eid + (ev.name ? ' · ' + ev.name : '') + (ev.platform ? ' · ' + ev.platform : '')))),
              h('select', {
                style: { ...S.input, flex: 'none', width: 160 },
                value: filters.app,
                disabled: !db,
                title: '按应用筛选：下拉里是索引里出现过的应用（带记录数）',
                onChange: (e) => setFilters((f) => ({ ...f, app: e.target.value })),
                onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
              },
                h('option', { value: '' }, '全部应用'),
                ...((facets?.apps ?? []).map((a) => h('option', { key: a.app, value: a.app }, a.app + '（' + a.n + '）')))),
              narrowInput(filters.from, (v) => setFilters((f) => ({ ...f, from: v })), '起始 2025-04-01', { width: 112, disabled: !db, onEnter: doSearch }),
              narrowInput(filters.to, (v) => setFilters((f) => ({ ...f, to: v })), '结束 2025-04-30', { width: 112, disabled: !db, onEnter: doSearch }),
              actionButton('按筛选检索', doSearch, { disabled: !db || !query.trim() || busy === 'search' }),
              (filters.eid || filters.app || filters.from || filters.to) ? actionButton('清空筛选', resetFilters) : null),
            !db ? noDbHint : null,
            result ? h('div', { style: S.card },
              h('div', { style: S.row },
                h('span', { style: { color: C_FG, fontSize: 12, fontWeight: 600 } }, `引擎 ${result.engine} · ${result.totalApprox ? '≥ ' : ''}${result.returned} 命中`),
                result.hint ? h('span', { style: { ...S.muted, maxWidth: 460 } }, scanSeen.current > (Number(result.scanned) || 0) ? `${result.hint}（累计已扫 ${scanSeen.current} 行）` : result.hint) : null,
                result.partialScan
                  ? actionButton('继续扫描 +2.5 秒', async () => {
                    let base = 2500;
                    try { base = Number((await api('/scan-budget'))?.scanBudgetMs) || 2500; } catch { /* 默认预算 */ }
                    const next = Math.min(30000, Math.max(base, searchBudget) + 2500);
                    setSearchBudget(next);
                    const from = scanCursor.current;
                    doSearch(0, next, from);
                  }, { disabled: busy === 'search' || searchBudget >= 30000 || !scanCursor.current, title: scanCursor.current ? `从第 ${scanCursor.current + 1} 行继续扫（不重复已扫区间，最多 30 秒）` : '已扫到库尾，无需继续', attrs: { 'data-continue-scan': 'search' } })
                  : null,
                (result.total ?? result.returned) > result.returned
                  ? h('span', { style: S.muted }, `共 ${result.total} 条 · 第 ${(result.offset ?? 0) + 1}–${(result.offset ?? 0) + result.returned} 条`)
                  : null,
                (result.offset ?? 0) > 0
                  ? actionButton('上一页', () => doSearch(Math.max(0, (result.offset ?? 0) - (result.limit ?? 20))), { disabled: busy === 'search' })
                  : null,
                result.next != null
                  ? actionButton('下一页', () => doSearch(result.next), { disabled: busy === 'search' })
                  : null,
                (result.rows ?? []).length
                  ? actionButton(busy === 'copy' ? '复制中…' : '复制引用清单', exportCitations, { disabled: busy === 'copy' })
                  : null,
                (result.total ?? 0) > (result.rows ?? []).length
                  ? actionButton(busy === 'copy' ? '复制中…' : `导出全部 ${Math.min(result.total, 200)} 条`, () => exportCitations(true), { disabled: busy === 'copy' })
                  : null,
                (result.rows ?? []).length
                  ? actionButton(busy === 'csv' ? '导出中…' : '导出 CSV', exportSearchCsv, { disabled: busy === 'csv' })
                  : null,
                h('span', { style: { ...S.muted, marginLeft: 'auto' } }, '点一条看引用句柄。')),
              copyNote ? h('div', { style: S.noticeInfo }, copyNote) : null,
              (result.rows ?? []).length
                ? h('div', { className: 'seeu-rows seeu-scroll', style: { display: 'flex', flexDirection: 'column', maxHeight: 460, overflow: 'auto' } },
                  (result.rows ?? []).map((r) => h('div', {
                    key: r.id,
                    className: 'seeu-row is-clickable',
                    style: { display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30, padding: '5px 8px', borderBottom: '1px solid ' + C_L1, cursor: 'pointer', fontSize: 12.5 },
                    onClick: () => showCite(r.id),
                  },
                    h('span', { style: { ...S.tag, flex: 'none' }, title: '检材 ' + r.eid }, `${evLabel(r.eid)} · ${r.app}`),
                    h('span', { style: S.rowTime }, r.ts ?? ''),
                    h('span', { style: S.ellipsis }, highlight(r.snip, result.query)))))
                : h(EmptyState, { title: '没有命中', text: '换个关键词再试；≥3 字走 FTS5 全文索引，2 字自动退化为 LIKE。' }))
              : (db ? h(EmptyState, { title: '还没有检索', text: '输入关键词后回车或点「检索」；结果行可点开引用句柄。' }) : null)) : null,

          tab === 'records' ? (db ? h(RecordsView, { db, seed: recordSeed, onCite: showCite }) : noDbHint) : null,
          tab === 'entity' ? (db ? h(EntityView, { db, onCite: showCite }) : noDbHint) : null,
          tab === 'timeline' ? (db ? h(TimelineView, { db, onDrill: openRecords }) : noDbHint) : null,
          tab === 'tables' ? (db ? h(TablesView, { db, onCite: showCite }) : noDbHint) : null,
          tab === 'cross' ? h(CrossCaseView, { onCite: showCite, onDetail: showDetail }) : null),

        detailPanel);
    }

    function basename(p) { return String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''; }
    function labelOf(c) {
      const id = String(c.id ?? '');
      // 检材节点带火眼里的真实名称（eid 只是序号，模型/用户判断「分析哪个检材」靠 name）
      if (id.startsWith('ev:')) return [`检材 ${id.slice(3)}`, c.name, c.person, c.platform].filter(Boolean).join(' · ');
      if (id.startsWith('app:') && c.app) return c.app;
      if (id.startsWith('acc:')) return c.account || c.name || id;
      return c.name ?? c.app ?? c.cat ?? c.account ?? id;
    }
    function nodeLabel(view, node) {
      if (!view) return node;
      if (node.startsWith('ev:')) return [`检材 ${node.slice(3)}`, view.evidence?.name, view.evidence?.platform].filter(Boolean).join(' · ');
      if (view.artifact) return `${view.artifact.cat}`;
      return node;
    }

    /** 树节点行：检材显示「检材 N · 名称 · 平台」+ 备注截断行，应用/分类/文件显示计数。 */
    function treeChildRow(c, onDrill) {
      const id = String(c.id ?? '');
      const evIndex = id.startsWith('ev:') ? id.slice(3) : null;
      const name = evIndex ? (c.name || `检材 ${evIndex}`) : (labelOf(c) || id);
      const counts = [];
      if (c.artifacts !== undefined) counts.push(`${c.artifacts} 文件`);
      if (c.records !== undefined) counts.push(`${c.records} 记录`);
      if (c.accounts) counts.push(`${c.accounts} 账号`);
      if (c.lines !== undefined) counts.push(`${c.lines} 行`);
      if (c.kind) counts.push(c.kind);
      return h('div', {
        key: c.id,
        className: 'seeu-tree-row',
        style: {
          display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '3px 8px',
          borderLeft: '2px solid transparent', borderRadius: R_SM, cursor: 'pointer', fontSize: 12.5, color: C_FG,
        },
        title: evIndex ? `检材 ${evIndex}${c.platform ? ' · ' + c.platform : ''}${c.person ? ' · ' + c.person : ''}` : name,
        onClick: () => onDrill(c.id, labelOf(c)),
      },
        h('span', {
          className: 'seeu-tree-guide',
          style: { flex: 'none', width: 1, alignSelf: 'stretch', margin: '1px 2px', background: 'linear-gradient(180deg, ' + C_L2 + ', transparent)' },
        }),
        evIndex ? h('span', { style: { ...S.tag, flex: 'none' } }, `检材 ${evIndex}`) : null,
        h('span', {
          className: 'seeu-tree-name',
          style: { flex: 'none', maxWidth: '54%', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, name),
        evIndex && c.person ? h('span', { style: { flex: 'none', color: C_FG3, fontSize: 11 } }, c.person) : null,
        evIndex && c.platform ? h('span', { style: { flex: 'none', color: C_FG2, fontSize: 11 } }, c.platform) : null,
        c.remark ? h('span', {
          className: 'seeu-tree-remark',
          style: { flex: '1 1 0', minWidth: 0, color: C_FG3, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, `备注：${String(c.remark).slice(0, 40)}`) : null,
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 8, flex: 'none' } },
          counts.map((t) => h('span', {
            key: t,
            className: 'seeu-tree-count',
            style: { color: C_FG3, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
          }, t))));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 设置页里也放一份（方便与其它设置项并列）
        try {
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section', id: 'seeu-case-index', order: 20,
            label: () => '取证索引',
          }, Panel))
        } catch (e) { /* 设置页槽位不可用时忽略 */ }
        // 侧栏图标 + 主面板（点图标切到面板）
        try {
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist', id: 'seeu-case-index', order: 55,
            label: () => '取证索引',
          }, () => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' },
            h('path', { d: 'M2 3.2h4.2v1.8H3.6v6h2.6v1.8H2V3.2zm12 0H9.8v1.8h2.6v6H9.8v1.8H14V3.2zM6.3 7.1h3.4v1.8H6.3V7.1z' }))))
        } catch (e) { /* 侧栏槽位不可用时忽略 */ }
        try {
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'seeu-case-index' }, Panel))
        } catch (e) { /* 主面板槽位不可用时忽略 */ }
      },
    };
  },
});
