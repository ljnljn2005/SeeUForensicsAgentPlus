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

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 320 },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      input: { flex: '1 1 260px', padding: '6px 8px', borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'transparent', color: 'inherit', fontSize: 13 },
      btn: { padding: '6px 12px', borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'color-mix(in srgb, currentColor 8%, transparent)', color: 'inherit', cursor: 'pointer', fontSize: 13 },
      btnPrimary: { padding: '6px 12px', borderRadius: 6, border: 'none', background: '#247bbf', color: '#fff', cursor: 'pointer', fontSize: 13 },
      muted: { opacity: 0.65, fontSize: 12 },
      panel: { border: '1px solid color-mix(in srgb, currentColor 15%, transparent)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
      card: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
      list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflow: 'auto', fontSize: 13 },
      item: { padding: '4px 6px', borderRadius: 4, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline' },
      crumb: { padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, currentColor 10%, transparent)', cursor: 'pointer', fontSize: 12 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      err: { color: '#d9534f', fontSize: 12 },
      ellipsis: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      seg: { display: 'flex', gap: 4, flexWrap: 'wrap' },
      segOn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #247bbf', background: '#247bbf', color: '#fff', cursor: 'pointer', fontSize: 12 },
      segOff: { padding: '4px 10px', borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      filter: { width: 108, padding: '4px 6px', borderRadius: 5, border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', background: 'transparent', color: 'inherit', fontSize: 12 },
      tag: { padding: '0 6px', borderRadius: 9, background: 'color-mix(in srgb, currentColor 12%, transparent)', fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap' },
      tableWrap: { overflow: 'auto', maxHeight: 320, border: '1px solid color-mix(in srgb, currentColor 15%, transparent)', borderRadius: 6 },
      table: { borderCollapse: 'collapse', fontSize: 11, width: '100%' },
      th: { textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid color-mix(in srgb, currentColor 20%, transparent)', whiteSpace: 'nowrap', fontWeight: 600 },
      td: { padding: '2px 6px', borderBottom: '1px solid color-mix(in srgb, currentColor 8%, transparent)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'top' },
      trClick: { cursor: 'pointer' },
      barTrack: { flex: 1, minWidth: 60, height: 10, borderRadius: 5, background: 'color-mix(in srgb, currentColor 12%, transparent)' },
      barFill: { height: 10, borderRadius: 5, background: '#247bbf' },
    };

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
    ];
    const BUCKETS = [
      ['hour', '按小时'],
      ['day', '按天'],
      ['month', '按月'],
    ];

    const emptyHint = (text) => h('div', { style: S.muted }, text);
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
        style: o.primary ? S.btnPrimary : { ...S.btn, ...(o.style ?? {}) },
        onClick,
        disabled: !!o.disabled,
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
        try {
          const data = await loader();
          if (mine === seq.current) setState({ loading: false, error: '', data });
        } catch (e) {
          if (mine === seq.current) setState({ loading: false, error: String(e.message ?? e), data: null });
        }
      }, deps);
      useEffect(() => { void run(); }, [run]);
      return { loading: state.loading, error: state.error, data: state.data, reload: run };
    }

    function Tabs({ tab, onChange }) {
      return h('div', { style: S.seg }, TABS.map(([key, label]) => h('button', {
        key,
        type: 'button',
        style: tab === key ? S.segOn : S.segOff,
        onClick: () => onChange(key),
      }, label)));
    }

    function CiteDetail({ detail }) {
      return h('div', { style: S.card },
        h('div', { style: S.mono }, detail.citation ?? '（无溯源句柄：只能作为导航，不能作为证据引用）'),
        h('div', { style: S.muted }, `${detail.path ?? ''} · 第 ${detail.line ?? '?'} 行 · ${detail.ts ?? ''}`),
        detail.verifyCmd ? h('div', { style: S.muted }, `回查：${detail.verifyCmd}`) : null,
        h('div', { style: S.mono }, detail.text ?? ''));
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
      useEffect(() => { setDraft(base); setApplied(base); setOffset(0); }, [base]);
      const { data, error, loading } = useLoad(() => api('/records', { db, ...applied, limit: PAGE, offset }), [db, applied, offset]);
      const apply = () => { setOffset(0); setApplied({ ...draft }); };
      const clear = () => {
        const next = { eid: '', app: '', category: '', q: '', from: '', to: '' };
        setDraft(next);
        setApplied(next);
        setOffset(0);
      };
      const hasFilter = !!(applied.eid || applied.app || applied.category || applied.q || applied.from || applied.to);
      return h('div', { style: S.card },
        h('div', { style: S.row },
          narrowInput(draft.eid, (v) => setDraft((d) => ({ ...d, eid: v })), '检材号 eid', { width: 84, onEnter: apply }),
          narrowInput(draft.app, (v) => setDraft((d) => ({ ...d, app: v })), '应用 app', { width: 96, onEnter: apply }),
          narrowInput(draft.category, (v) => setDraft((d) => ({ ...d, category: v })), '类别 category', { width: 104, onEnter: apply }),
          narrowInput(draft.q, (v) => setDraft((d) => ({ ...d, q: v })), '关键词 q', { width: 140, onEnter: apply }),
          actionButton('查询', apply),
          hasFilter ? actionButton('清空', clear) : null),
        applied.from || applied.to ? h('div', { style: S.muted }, `时间范围 ${applied.from || '…'} ~ ${applied.to || '…'}（由时间线钻取带入）`) : null,
        error ? h('div', { style: S.err }, error) : null,
        loading && !data ? emptyHint('加载中…') : null,
        !loading && !error && data && data.total === 0 ? emptyHint('没有匹配记录：清空关键词或换筛选条件再试。') : null,
        data && data.total > 0 ? h('div', null,
          h('div', { style: S.muted }, `记录 ${data.total} 条 · 当前 ${data.offset + 1}-${data.offset + data.returned}`),
          h('div', { style: S.list }, data.rows.map((r) => h('div', {
            key: r.id,
            style: S.item,
            title: `第 ${r.line} 行，点一下看引用句柄`,
            onClick: () => onCite(r.id),
          },
            h('span', { style: { ...S.muted, minWidth: 78 } }, `${r.eid}·${r.app}`),
            h('span', { style: { ...S.muted, minWidth: 130 } }, r.ts ?? ''),
            h('span', { style: { ...S.muted, minWidth: 68 } }, r.cat ?? ''),
            h('span', { style: S.ellipsis }, `${r.actor ? `${r.actor}：` : ''}${r.text ?? ''}`)))),
          h('div', { style: { ...S.row, marginTop: 6 } },
            data.offset > 0 ? actionButton('上一页', () => setOffset(Math.max(0, data.offset - PAGE))) : null,
            data.next != null ? actionButton('下一页', () => setOffset(data.next)) : null,
            h('span', { style: S.muted }, '点一条看引用句柄。'))) : null);
    }

    // ---------- 视图：实体（聚合 → 唯一命中下钻提及） ----------
    function EntityView({ db, onCite }) {
      const [draft, setDraft] = useState({ kind: '', q: '', eid: '' });
      const [applied, setApplied] = useState(draft);
      const { data, error, loading } = useLoad(() => api('/entity', { db, ...applied, limit: PAGE }), [db, applied]);
      const apply = () => setApplied({ ...draft });
      const clear = () => {
        const next = { kind: '', q: '', eid: '' };
        setDraft(next);
        setApplied(next);
      };
      const drill = (row) => {
        const next = { kind: row.kind, q: row.value, eid: applied.eid };
        setDraft(next);
        setApplied(next);
      };
      const pickKind = (kind) => {
        const next = { ...draft, kind: draft.kind === kind ? '' : kind };
        setDraft(next);
        setApplied(next);
      };
      const rows = data?.rows ?? [];
      const kinds = data?.kinds ?? [];
      const mention = data?.matched === 'mention';
      const hasFilter = !!(applied.kind || applied.q || applied.eid);
      return h('div', { style: S.card },
        h('div', { style: S.row },
          narrowInput(draft.kind, (v) => setDraft((d) => ({ ...d, kind: v })), '实体类型 kind', { width: 110, onEnter: apply }),
          narrowInput(draft.q, (v) => setDraft((d) => ({ ...d, q: v })), '值 / 关键词 q', { width: 150, onEnter: apply }),
          narrowInput(draft.eid, (v) => setDraft((d) => ({ ...d, eid: v })), '检材号 eid', { width: 84, onEnter: apply }),
          actionButton('查询', apply),
          hasFilter ? actionButton('清空', clear) : null),
        kinds.length ? h('div', { style: { ...S.row, gap: 4 } },
          h('span', { style: S.muted }, '实体类别：'),
          kinds.slice(0, 12).map((k) => h('span', {
            key: k.kind,
            role: 'button',
            title: '按该类别过滤',
            style: { ...S.tag, cursor: 'pointer', border: applied.kind === k.kind ? '1px solid #247bbf' : '1px solid transparent' },
            onClick: () => pickKind(k.kind),
          }, `${k.kind} ${k.n}`))) : null,
        error ? h('div', { style: S.err }, error) : null,
        loading && !data ? emptyHint('加载中…') : null,
        !loading && !error && data && data.returned === 0
          ? emptyHint(hasFilter ? '没有匹配实体：换个关键词或点「清空」。' : '该库没有实体数据（entity 表为空），先重建索引。')
          : null,
        mention ? h('div', null,
          h('div', { style: S.muted }, `精确命中 ${data.kind} = ${data.value} · ${data.returned} 条提及（跨 ${data.evidences ?? '-'} 个检材）`),
          (data.mentions ?? []).length
            ? h('div', { style: S.list }, data.mentions.map((m) => h('div', {
                key: m.record,
                style: S.item,
                title: '点一下看引用句柄',
                onClick: () => onCite(m.record),
              },
                h('span', { style: { ...S.muted, minWidth: 78 } }, `${m.eid}·${m.app}`),
                h('span', { style: { ...S.muted, minWidth: 130 } }, m.ts ?? ''),
                h('span', { style: { ...S.muted, minWidth: 60 } }, m.cat ?? ''),
                h('span', { style: S.ellipsis }, `第 ${m.line} 行`))))
            : emptyHint('没有提及记录。'))
        : rows.length ? h('div', null,
            h('div', { style: S.muted }, `返回 ${data.returned} 条聚合 · 跨检材 ${data.crossEvidence ?? '-'} 条（点一行下钻提及）`),
            h('div', { style: S.list }, rows.map((r) => h('div', {
              key: `${r.kind}|${r.value}`,
              style: S.item,
              title: '点一下下钻到提及记录',
              onClick: () => drill(r),
            },
              h('span', { style: S.tag }, r.kind),
              h('span', { style: S.ellipsis }, r.value),
              h('span', { style: S.muted }, `${r.count} 次`),
              h('span', { style: { ...S.muted, color: r.evidences > 1 ? '#c47f17' : undefined } }, r.evidences > 1 ? `跨 ${r.evidences} 检材` : `${r.evidences} 检材`)))))
          : null);
    }

    // ---------- 视图：时间线（小时/天/月分桶，点柱条钻取记录） ----------
    function TimelineView({ db, onDrill }) {
      const [draft, setDraft] = useState({ eid: '', app: '', from: '', to: '', bucket: 'day' });
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
      return h('div', { style: S.card },
        h('div', { style: S.row },
          h('div', { style: S.seg }, BUCKETS.map(([key, label]) => h('button', {
            key,
            type: 'button',
            style: applied.bucket === key ? S.segOn : S.segOff,
            onClick: () => pickBucket(key),
          }, label))),
          narrowInput(draft.eid, (v) => setDraft((d) => ({ ...d, eid: v })), '检材号 eid', { width: 84, onEnter: apply }),
          narrowInput(draft.app, (v) => setDraft((d) => ({ ...d, app: v })), '应用 app', { width: 96, onEnter: apply }),
          narrowInput(draft.from, (v) => setDraft((d) => ({ ...d, from: v })), '起始 2025-04-01', { width: 112, onEnter: apply }),
          narrowInput(draft.to, (v) => setDraft((d) => ({ ...d, to: v })), '结束 2025-04-30', { width: 112, onEnter: apply }),
          actionButton('查询', apply),
          hasFilter ? actionButton('清空', clear) : null),
        error ? h('div', { style: S.err }, error) : null,
        loading && !data ? emptyHint('加载中…') : null,
        !loading && !error && data && data.returned === 0
          ? emptyHint(hasFilter ? '该时间范围内没有带时间戳的记录。' : '该库没有可统计的时间戳（record.ts 为空），先重建索引。')
          : null,
        data && data.returned > 0 ? h('div', null,
          h('div', { style: S.muted }, `${bucketLabel}分桶 · ${data.returned} 个时间段 · 点柱条钻取该时段记录`),
          h('div', { style: S.list }, rows.map((r) => h('div', {
            key: r.bucket,
            style: S.item,
            title: '点一下查看该时间段的记录',
            onClick: () => onDrill({ eid: applied.eid, app: applied.app, from: r.bucket, to: `${r.bucket}~` }),
          },
            h('span', { style: { ...S.mono, minWidth: 112 } }, r.bucket),
            h('div', { style: S.barTrack }, h('div', { style: { ...S.barFill, width: `${Math.max(2, Math.round((r.n / max) * 100))}%` } })),
            h('span', { style: { ...S.muted, minWidth: 64, textAlign: 'right' } }, `${r.n} 记录`),
            h('span', { style: S.muted }, `${r.eids} 检材 · ${r.apps} 应用`))))) : null);
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
      const detail = useLoad(() => (name ? api('/table', { db, name, ...applied, limit: TABLE_PAGE, offset }) : Promise.resolve(null)), [db, name, applied, offset]);
      const pick = (table) => { setName(table); setOffset(0); };
      const apply = () => { setApplied({ ...draft }); setOffset(0); };
      const clear = () => {
        const next = { q: '', eid: '' };
        setDraft(next);
        setApplied(next);
        setOffset(0);
      };
      if (list.error) return h('div', { style: S.card }, h('div', { style: S.err }, list.error));
      if (list.loading && !list.data) return h('div', { style: S.card }, emptyHint('加载表清单…'));
      if (!tables.length) return h('div', { style: S.card }, emptyHint('该库没有 typed 数据（table 清单为空）：先点「建库 / 更新」重建索引。'));
      const data = detail.data;
      const cols = data?.columns ?? [];
      const rows = data?.rows ?? [];
      return h('div', { style: S.card },
        h('div', { style: S.row },
          h('span', { style: S.muted }, '表'),
          h('select', {
            style: { ...S.filter, width: 'auto', minWidth: 140, maxWidth: 220, cursor: 'pointer' },
            value: name,
            onChange: (e) => pick(e.target.value),
          }, tables.map((t) => h('option', { key: t.table, value: t.table }, `${t.label || t.table}（${t.rows}）`))),
          narrowInput(draft.eid, (v) => setDraft((d) => ({ ...d, eid: v })), '检材号 eid', { width: 84, onEnter: apply }),
          narrowInput(draft.q, (v) => setDraft((d) => ({ ...d, q: v })), '关键词 q', { width: 140, onEnter: apply }),
          actionButton('查询', apply),
          applied.q || applied.eid ? actionButton('清空', clear) : null),
        detail.error ? h('div', { style: S.err }, detail.error) : null,
        detail.loading && !data ? emptyHint('加载中…') : null,
        data && data.total === 0 ? emptyHint('该表没有匹配行：清空关键词或换 eid 再试。') : null,
        data && data.total > 0 ? h('div', null,
          h('div', { style: S.muted }, `${data.label || name} · 共 ${data.total} 行 · 当前 ${data.offset + 1}-${data.offset + data.returned}`),
          h('div', { style: S.tableWrap }, h('table', { style: S.table },
            h('thead', null, h('tr', null, cols.map((c) => h('th', { key: c, style: S.th }, c)))),
            h('tbody', null, rows.map((r, i) => h('tr', {
              key: r.id != null ? `r${r.id}` : `i${i}`,
              style: r.record_id != null ? S.trClick : undefined,
              title: r.record_id != null ? '点一下看引用句柄' : '该行没有对应原文记录，不能引用',
              onClick: r.record_id != null ? () => onCite(r.record_id) : undefined,
            }, cols.map((c) => h('td', { key: c, style: S.td }, cellText(r[c])))))))),
          h('div', { style: { ...S.row, marginTop: 6 } },
            data.offset > 0 ? actionButton('上一页', () => setOffset(Math.max(0, data.offset - TABLE_PAGE))) : null,
            data.next != null ? actionButton('下一页', () => setOffset(data.next)) : null,
            h('span', { style: S.muted }, '点一行看引用句柄（record_id 为空的行不可引用）。'))) : null);
    }

    function Panel() {
      const [dir, setDir] = useState(() => localStorage.getItem('seeu.indexDir') ?? '');
      const [indexes, setIndexes] = useState([]);
      const [db, setDb] = useState(null);
      const [node, setNode] = useState('root');
      const [view, setView] = useState(null);
      const [tab, setTab] = useState('tree');
      const [recordSeed, setRecordSeed] = useState(null);
      const [query, setQuery] = useState('');
      const [result, setResult] = useState(null);
      const [detail, setDetail] = useState(null);
      const [busy, setBusy] = useState('');
      const [progress, setProgress] = useState(null);
      const [error, setError] = useState('');
      const [crumbs, setCrumbs] = useState([]);

      const scan = useCallback(async (target) => {
        setError('');
        try {
          const body = await api('/list', target ? { dir: target } : {});
          setIndexes(body.indexes ?? []);
          const list = body.indexes ?? [];
          const keep = list.some((ix) => ix.dbPath === db);
          if (list.length && !keep) {
            const first = list[0];
            setDb(first.dbPath);
            if (first.caseDir) setDir(first.caseDir);
            loadNodeRef.current?.(first.dbPath, 'root');
          }
        } catch (e) { setError(String(e.message ?? e)); }
      }, [db]);

      useEffect(() => {
        if (dir) localStorage.setItem('seeu.indexDir', dir);
      }, [dir]);

      const loadNode = useCallback(async (targetDb, targetNode) => {
        if (!targetDb) return;
        setBusy('tree');
        setError('');
        try {
          const body = await api('/tree', { db: targetDb, node: targetNode });
          setView(body);
          setNode(targetNode);
        } catch (e) { setError(String(e.message ?? e)); } finally { setBusy(''); }
      }, []);

      const loadNodeRef = useRef(null);
      loadNodeRef.current = loadNode;

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

      const startBuild = useCallback(async () => {
        const target = dir.trim();
        if (!target) { setError('先填案件目录（ 例如：E:\\forensics\\案件目录）'); return; }
        setError('');
        setBusy('build');
        setProgress({ phase: 'probe', percent: 0, message: '提交建库任务…' });
        try {
          const { jobId } = await post('/build', { dir: target });
          const poll = async () => {
            const job = await api('/build', { job: jobId });
            setProgress(job);
            if (job.status === 'running') { setTimeout(poll, 700); return; }
            setBusy('');
            if (job.status === 'done') {
              await scan(target);
              if (job.result?.db) { setDb(job.result.db); loadNode(job.result.db, 'root'); }
            } else setError(`${job.code ?? 'E_UNKNOWN'}：${job.error ?? '建库失败'}`);
          };
          poll();
        } catch (e) {
          setBusy('');
          setProgress(null);
          setError(String(e.message ?? e));
        }
      }, [dir, scan, loadNode]);

      const doSearch = useCallback(async () => {
        if (!db || !query.trim()) return;
        setBusy('search');
        setError('');
        setDetail(null);
        try { setResult(await api('/search', { db, q: query.trim(), limit: 20 })); }
        catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      }, [db, query]);

      const drill = useCallback((nextNode, label) => {
        setCrumbs((c) => [...c, { node, label: label ?? nodeLabel(view, node) }]);
        loadNode(db, nextNode);
      }, [db, node, view, loadNode]);

      const goCrumb = useCallback((idx) => {
        const target = idx < 0 ? 'root' : crumbs[idx].node;
        setCrumbs((c) => (idx < 0 ? [] : c.slice(0, idx)));
        loadNode(db, target);
      }, [crumbs, db, loadNode]);

      const showCite = useCallback(async (recordId) => {
        if (!db || recordId === null || recordId === undefined) return;
        setBusy('cite');
        try { setDetail(await api('/cite', { db, id: recordId })); }
        catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      }, [db]);

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
      const noDbHint = emptyHint('先在「索引库」列表里点一个库，或填写案件目录后点「建库 / 更新」。');
      const detailPanel = detail ? h('div', { style: S.panel },
        h('div', { style: S.row },
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, '引用详情'),
          h('span', { style: { ...S.muted, marginLeft: 'auto' } }, busy === 'cite' ? '加载中…' : ''),
          actionButton('关闭', () => setDetail(null))),
        h(CiteDetail, { detail })) : null;

      return h('div', { style: S.wrap },
        h('div', null,
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, '取证案件索引'),
          h('div', { style: S.muted }, '把火眼案件的全解析结果建成只读索引库（SQLite），支持树导航、关键词检索、记录 / 实体 / 时间线 / 表视图；引用可回查 Goldeneyes 句柄。')),

        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('input', {
              style: S.input, value: dir, placeholder: '案件目录，例如 E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5',
              onChange: (e) => setDir(e.target.value), spellCheck: false,
            }),
            h('button', { style: S.btn, onClick: () => scan(dir.trim() || undefined), disabled: busy === 'build' }, '扫描已有索引'),
            h('button', { style: S.btnPrimary, onClick: startBuild, disabled: busy === 'build' }, busy === 'build' ? '建库中…' : '建库 / 更新')),
          progress ? h('div', null,
            h('div', { style: { ...S.muted, marginBottom: 4 } },
              `${progress.phase ?? ''} ${progress.total ? `${progress.completed}/${progress.total}` : ''} ${progress.percent ?? 0}%${progress.message ? ` · ${progress.message}` : ''}`),
            h('div', { style: { height: 6, borderRadius: 3, background: 'color-mix(in srgb, currentColor 12%, transparent)' } },
              h('div', { style: { height: 6, width: `${progress.percent ?? 0}%`, borderRadius: 3, background: '#247bbf', transition: 'width .3s' } }))) : null,
          indexes.length
            ? h('div', { style: S.list },
              indexes.map((ix) => h('div', {
                key: ix.dbPath, style: { ...S.item, background: ix.dbPath === db ? 'color-mix(in srgb, #247bbf 16%, transparent)' : 'transparent' },
                onClick: () => openIndex(ix),
              },
                h('span', { style: { fontWeight: 600 } }, ix.caseName ?? ix.caseNumber ?? basename(ix.caseDir)),
                h('span', { style: S.muted }, ix.caseNumber ?? ''),
                h('span', { style: S.muted }, fmtBytes(ix.sizeBytes ?? 0)),
                h('span', { ...{ style: { ...S.muted, marginLeft: 'auto' } } }, ix.builtAt ? new Date(ix.builtAt).toLocaleString() : ''))))
            : emptyHint('还没有索引：填案件目录后点「建库 / 更新」。')),
        error ? h('div', { style: S.err }, error) : null,

        h('div', { style: S.panel },
          h('div', { style: S.row },
            h(Tabs, { tab, onChange: switchTab }),
            h('span', { style: { ...S.muted, marginLeft: 'auto' } }, db ? `当前库：${caseNameOf(db)}` : '未选择索引库')),

          tab === 'tree' ? (view ? h('div', { style: S.card },
            h('div', { style: S.row },
              h('span', { style: S.crumb, onClick: () => goCrumb(-1) }, '案件'),
              crumbs.map((c, i) => h('span', { key: `${c.node}-${i}`, style: S.crumb, onClick: () => goCrumb(i) }, c.label)),
              h('span', { style: { ...S.muted, marginLeft: 'auto' } }, busy === 'tree' ? '加载中…' : '')),
            totals ? h('div', { style: S.muted },
              `检材 ${totals.evidences ?? '-'} · 文件 ${totals.artifacts ?? '-'} · 记录 ${totals.records ?? '-'} · 消息 ${totals.messages ?? '-'} · 实体 ${totals.entities ?? '-'}`) : null,
            view.artifact ? h('div', { style: { ...S.mono, marginBottom: 6 } }, `${view.artifact.app} / ${view.artifact.cat} / ${view.artifact.sub}\n${view.artifact.path}（${view.artifact.lines} 行，${view.artifact.citable ? '可引用' : '不可引用'}）`) : null,
            children
              ? h('div', { style: S.list },
                children.map((c) => h('div', { key: c.id, style: S.item, onClick: () => drill(c.id, labelOf(c)) },
                  h('span', { style: { flex: 1 } }, labelOf(c)),
                  c.artifacts !== undefined ? h('span', { style: S.muted }, `${c.artifacts} 文件`) : null,
                  c.records !== undefined ? h('span', { style: S.muted }, `${c.records} 记录`) : null,
                  c.accounts ? h('span', { style: S.muted }, `${c.accounts} 账号`) : null,
                  c.lines !== undefined ? h('span', { style: S.muted }, `${c.lines} 行`) : null,
                  c.kind ? h('span', { style: S.muted }, c.kind) : null)))
              : null,
            view.records ? h('div', null,
              h('div', { style: S.muted }, `${view.records.offset + 1}-${view.records.offset + view.records.returned} / ${view.records.total}`),
              h('div', { style: S.list },
                (view.records.rows ?? []).map((r) => h('div', { key: r.id, style: S.item, onClick: () => showCite(r.id) },
                  h('span', { style: { ...S.muted, minWidth: 44 } }, `#${r.line}`),
                  h('span', { style: { ...S.muted, minWidth: 132 } }, r.ts ?? ''),
                  h('span', { style: { flex: 1 } }, r.text)))),
              view.records.next ? h('button', { style: { ...S.btn, marginTop: 6 }, onClick: () => drill(view.records.next, '下一页') }, '下一页') : null,
              h('div', { style: { ...S.muted, marginTop: 6 } }, '点一条看引用句柄。')) : null,
            view.citation ? h('div', null,
              h('div', { style: S.mono }, view.citation),
              h('div', { style: S.muted }, `回查命令：${view.verifyCmd}`)) : null)
            : emptyHint('建库或选中索引库后，这里按 检材 → 应用 → 分类 → 文件 → 记录 导航。')) : null,

          tab === 'search' ? h('div', { style: S.card },
            h('div', { style: S.row },
              h('input', {
                style: S.input, value: query, placeholder: '关键词（≥3 字走 FTS5，2 字自动 LIKE）',
                onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
                spellCheck: false, disabled: !db,
              }),
              actionButton('检索', doSearch, { disabled: !db || busy === 'search' })),
            result ? h('div', null,
              h('div', { style: S.muted }, `引擎 ${result.engine} · ${result.returned} 命中`),
              h('div', { style: S.list },
                (result.rows ?? []).map((r) => h('div', { key: r.id, style: S.item, onClick: () => showCite(r.id) },
                  h('span', { style: { ...S.muted, minWidth: 96 } }, `${r.eid}·${r.app}`),
                  h('span', { style: { ...S.muted, minWidth: 120 } }, r.ts ?? ''),
                  h('span', { style: { flex: 1 } }, r.snip)))),
              h('div', { style: { ...S.muted, marginTop: 6 } }, '点一条看引用句柄。'))
              : emptyHint('输入关键词后回车或点「检索」。')) : null,

          tab === 'records' ? (db ? h(RecordsView, { db, seed: recordSeed, onCite: showCite }) : noDbHint) : null,
          tab === 'entity' ? (db ? h(EntityView, { db, onCite: showCite }) : noDbHint) : null,
          tab === 'timeline' ? (db ? h(TimelineView, { db, onDrill: openRecords }) : noDbHint) : null,
          tab === 'tables' ? (db ? h(TablesView, { db, onCite: showCite }) : noDbHint) : null),

        detailPanel);
    }

    function basename(p) { return String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''; }
    function labelOf(c) {
      const id = String(c.id ?? '');
      if (id.startsWith('ev:')) return `检材 ${id.slice(3)}`;
      if (id.startsWith('app:') && c.app) return c.app;
      if (id.startsWith('acc:')) return c.account || c.name || id;
      return c.name ?? c.app ?? c.cat ?? c.account ?? id;
    }
    function nodeLabel(view, node) {
      if (!view) return node;
      if (node.startsWith('ev:')) return `检材 ${node.slice(3)}`;
      if (view.artifact) return `${view.artifact.cat}`;
      return node;
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
