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
      list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflow: 'auto', fontSize: 13 },
      item: { padding: '4px 6px', borderRadius: 4, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline' },
      crumb: { padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, currentColor 10%, transparent)', cursor: 'pointer', fontSize: 12 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      err: { color: '#d9534f', fontSize: 12 },
    };

    const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : n > 1024 ? `${(n / 1024).toFixed(0)} KiB` : `${n} B`);

    function Panel() {
      const [dir, setDir] = useState(() => localStorage.getItem('seeu.indexDir') ?? '');
      const [indexes, setIndexes] = useState([]);
      const [db, setDb] = useState(null);
      const [node, setNode] = useState('root');
      const [view, setView] = useState(null);
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
        if (!db) return;
        setBusy('cite');
        try { setDetail(await api('/cite', { db, id: recordId })); }
        catch (e) { setError(String(e.message ?? e)); }
        finally { setBusy(''); }
      }, [db]);

      const totals = view?.totals ?? null;
      const children = view?.children ?? null;

      return h('div', { style: S.wrap },
        h('div', null,
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, '取证案件索引'),
          h('div', { style: S.muted }, '把火眼案件的全解析结果建成只读索引库（SQLite），之后在会话里或本页用树状导航与关键词检索，引用可回查 Goldeneyes 句柄。')),

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
            : h('div', { style: S.muted }, '还没有索引：填案件目录后点「建库 / 更新」。')),
        error ? h('div', { style: S.err }, error) : null,

        h('div', { style: S.panel },
          h('div', { style: S.row },
            h('input', {
              style: S.input, value: query, placeholder: '关键词（≥3 字走 FTS5，2 字自动 LIKE）',
              onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') doSearch(); },
              spellCheck: false, disabled: !db,
            }),
            h('button', { style: S.btn, onClick: doSearch, disabled: !db || busy === 'search' }, '检索')),
          result ? h('div', null,
            h('div', { style: S.muted }, `引擎 ${result.engine} · ${result.returned} 命中`),
            h('div', { style: S.list },
              (result.rows ?? []).map((r) => h('div', { key: r.id, style: S.item, onClick: () => showCite(r.id) },
                h('span', { style: { ...S.muted, minWidth: 96 } }, `${r.eid}·${r.app}`),
                h('span', { style: { ...S.muted, minWidth: 120 } }, r.ts ?? ''),
                h('span', { style: { flex: 1 } }, r.snip)))),
            h('div', { style: { ...S.muted, marginTop: 6 } }, '点一条看引用句柄。')) :
            h('div', { style: S.muted }, '输入关键词后回车或点「检索」。'),
          detail ? h('div', { style: { borderTop: '1px dashed color-mix(in srgb, currentColor 20%, transparent)', paddingTop: 8 } },
            h('div', { style: S.mono }, detail.citation ?? '（无溯源句柄：只能作为导航，不能作为证据引用）'),
            h('div', { style: S.muted }, `${detail.path ?? ''} · 第 ${detail.line ?? '?'} 行 · ${detail.ts ?? ''}`),
            h('div', { style: S.mono }, detail.text ?? '')) : null),

        view ? h('div', { style: S.panel },
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
            h('div', { style: S.muted }, `回查命令：${view.verifyCmd}`)) : null) : null);
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
