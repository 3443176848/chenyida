"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { formatShanghaiDate } from "../_lib/material-ui";
import { changeImportListQuery, DEFAULT_IMPORT_LIST_QUERY, importListApiQuery, parseImportListQuery, serializeImportListQuery, type ImportListQuery, type MaterialImportBatch } from "../_lib/material-import";
import { redirectToExistingLogin, useMaterialSession } from "./material-shell";
import { MaterialImportCursorNavigation, MaterialImportErrorState, MaterialImportStatusBadge } from "./material-import-primitives";

type ImportListResponse = { data: MaterialImportBatch[]; total: number; page: { has_more: boolean; next_cursor: string | null }; request_id?: string };

export function MaterialImportListPage() {
  const session = useMaterialSession(); const permissions = session.user?.permissions || [];
  const canRead = permissions.includes("material.import.read"); const canCreate = permissions.includes("material.import.create");
  const [query, setQuery] = useState<ImportListQuery>(DEFAULT_IMPORT_LIST_QUERY); const [draft, setDraft] = useState<ImportListQuery>(DEFAULT_IMPORT_LIST_QUERY);
  const [ready, setReady] = useState(false); const [result, setResult] = useState<ImportListResponse | null>(null); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; requestId: string } | null>(null); const sequence = useRef(0);
  const applyLocation = useCallback(() => {
    const parsed = parseImportListQuery(window.location.search); const canonical = `/materials/imports?${serializeImportListQuery(parsed)}`;
    if (`${window.location.pathname}${window.location.search}` !== canonical) window.history.replaceState({}, "", canonical);
    setQuery(parsed); setDraft(parsed); setReady(true);
  }, []);
  useEffect(() => { const timer = window.setTimeout(applyLocation, 0); window.addEventListener("popstate", applyLocation); return () => { window.clearTimeout(timer); window.removeEventListener("popstate", applyLocation); }; }, [applyLocation]);
  const navigate = useCallback((next: ImportListQuery) => { const url = `/materials/imports?${serializeImportListQuery(next)}`; window.history.pushState({}, "", url); setQuery(next); setDraft(next); }, []);

  const load = useCallback(async () => {
    if (!ready || !canRead) return; const current = ++sequence.current; setLoading(true); setError(null);
    try { const response = await api<ImportListResponse>(importListApiQuery(query), { cache: "no-store" }); if (current === sequence.current) setResult(response); }
    catch (reason) {
      if (current !== sequence.current) return;
      if (reason instanceof ErpApiError && reason.status === 401) redirectToExistingLogin();
      else if (reason instanceof ErpApiError) setError({ message: reason.status === 404 ? "导入批次不存在或无权查看" : reason.status === 403 ? "当前账号无权查看导入批次" : "暂时无法加载导入批次", requestId: reason.requestId });
      else setError({ message: "网络连接失败", requestId: "" });
    } finally { if (current === sequence.current) setLoading(false); }
  }, [canRead, query, ready]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (!canRead) return <MaterialImportErrorState title="没有导入读取权限" message="当前账号没有 material.import.read，页面不会请求批次正文。" />;
  const submit = (event: FormEvent) => { event.preventDefault(); navigate(changeImportListQuery(query, draft)); };
  return <section className="mi-list-page">
    <div className="mm-breadcrumb"><Link href="/materials">物料主数据</Link><span>/</span><span>导入批次</span></div>
    <header className="mm-page-head"><div><h2>物料导入批次</h2><p>解析与字段映射工作区；映射确认不代表正式物料已创建。</p></div>{canCreate ? <Link className="mm-primary-link" href="/materials/imports/new">新建导入批次</Link> : null}</header>
    <form className="mi-filter-bar" onSubmit={submit}>
      <label>状态<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">全部状态</option>{["CREATED","UPLOAD_PENDING","FILE_READY","QUEUED_FOR_PARSING","PARSING","PARSED","AWAITING_MAPPING","MAPPING_CONFIRMED","RECONCILIATION_REQUIRED","FAILED","CANCELLED"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>来源<select value={draft.source_kind} onChange={(e) => setDraft({ ...draft, source_kind: e.target.value })}><option value="">全部</option><option>XLSX</option><option>CSV</option></select></label>
      <label>范围<select value={draft.created_by_me} onChange={(e) => setDraft({ ...draft, created_by_me: e.target.value as "true" | "false" })}><option value="true">仅我创建</option><option value="false">全部可见</option></select></label>
      <label>排序<select value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as ImportListQuery["sort"] })}><option value="created_at_desc">创建时间倒序</option><option value="created_at_asc">创建时间正序</option></select></label>
      <label>每批<select value={draft.limit} onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) as 20 | 50 })}><option value="20">20</option><option value="50">50</option></select></label>
      <button type="submit">应用条件</button>
    </form>
    {error ? <MaterialImportErrorState message={error.message} requestId={error.requestId} onRetry={() => void load()} /> : null}
    {!error ? <div className="mm-table-wrap mi-list-table-wrap" aria-busy={loading}><table className="mi-list-table"><caption>可见导入批次</caption><thead><tr><th>批次号</th><th>状态</th><th>来源</th><th>创建人</th><th>文件数</th><th>解析行</th><th>最近更新</th><th>安全失败摘要</th></tr></thead><tbody>
      {loading && !result ? <tr><td colSpan={8}>正在加载导入批次…</td></tr> : null}
      {result?.data.map((row) => <tr key={row.id}><td><Link href={`/materials/imports/${row.id}`} className="mm-mono">{row.batch_no}</Link></td><td><MaterialImportStatusBadge value={row.status} /></td><td>{row.source_kind}</td><td>{row.created_by}</td><td>{row.file_count}</td><td>{row.total_rows}</td><td>{formatShanghaiDate(row.updated_at, true)}</td><td>{row.failure_message || "—"}</td></tr>)}
      {!loading && result?.data.length === 0 ? <tr><td colSpan={8}>当前没有符合条件的导入批次</td></tr> : null}
    </tbody></table></div> : null}
    {result ? <MaterialImportCursorNavigation total={result.total} hasMore={result.page.has_more} disabled={loading} onNext={() => result.page.next_cursor && navigate({ ...query, cursor: result.page.next_cursor })} /> : null}
  </section>;
}
