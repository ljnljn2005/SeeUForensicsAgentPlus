# Locate then deep-query (keyword clues in huge trees)

Use this when the user hangs a **shallow aggregate / large table** forensic anchor and asks about a **searchable clue** (group name, account, phone, quoted phrase, proper noun). Clues often live in **deep message/log leaves**; a thin stratified/prefetch sample alone will miss them.

**Do not** treat this file as analysis by itself — `Read` it only when useful, then **call** `fl_search` / `fl_query_rows` / `fl_list_children` as you decide. This is a suggested path, not a fixed script — skip steps that do not fit the ask.

## When to use

**Useful when all are true:**

1. Anchor is a forensics directory / app hub / multi-child node, **or** a large table (`medium`+ volume).
2. The user question contains a searchable term (name, id, short phrase).

**Skip this recipe when:**

- The ask is vague overview-only (e.g. “what can we extract?”, “summarize this node”) with **no** concrete keyword — overview tools / thin samples may be enough.
- The sandbox is evidence-files or timeline-only without `fl_*` row tools.

## Model choice vs stratified prefetch

| User ask | Suggested path | Prefetch / stratified sample |
|----------|----------------|------------------------------|
| Has keyword / entity | **Locate → deep query** (you pick tools) | Optional context only |
| No keyword | You choose overview tools | Optional context only |

Never conclude “keyword covered” from prefetch/stratified rows alone if you have not searched.

## Procedure (shortest path that yields citable rows)

1. **Locate** — `fl_search` with the hard keyword (`q`). Stay inside the attached sandbox.  
   - On hits: note `nodeId` and `treePath` (for tools only; never write them in the user-visible answer).  
   - On empty: try one synonym / shorter token; if still empty, go to step 2b.

2. **Lock the chain**  
   - Prefer the hit leaf or the nearest queryable ancestor on `treePath` (account / group / session / message table).  
   - **Do not** blindly fan out from the aggregate root across every sibling app unless search gave no path.

3. **Deep query** — `fl_query_rows` with that `nodeId` + `search=<keyword>`.  
   - Directories / non-tables: the tool may deep-drill with a budget; still prefer starting from the **locked** node, not the root.  
   - If search was empty (2b): `fl_list_children` on known app containers under the anchor, then `fl_query_rows(search=)` on promising hubs (chat/mail/browser). Stop when you have enough citable rows or you judge the budget spent.

4. **Close**  
   - Rows found → answer with business labels + `[[c:n]]` when harvest supports it.  
   - No rows after locate+deep → say **not found under this anchor** and state the boundary.  
   - **Forbidden:** claim you “drilled every platform / full table” if you did not.

## Tool notes

- `fl_search` filters to the anchor subtree after index search — empty scoped result is authoritative for “not here”.
- `fl_query_rows` on a folder deep-drills toward leaves with rows (budgeted). Empty chat-named shells should not stop you; continue or pick another hub.
- Never PRAGMA / guess columns / open DBs outside the sandbox.

## Output discipline

- User-visible prose: no `fl_*`, `nodeId`, table/column names, `*.mfs`, or `"..."`.
- Prefer interim honesty over invented coverage.
