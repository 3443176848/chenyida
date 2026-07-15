"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { flattenCategories, formatShanghaiDate, sourceLabel, type CategoryOption } from "../_lib/material-ui";
import {
  DEFAULT_REVIEW_QUERY, hasReviewFilters, parseReviewQueueQuery, reviewCapabilities,
  reviewQueueApiQuery, serializeReviewQueueQuery, type ReviewQueueQuery,
} from "../_lib/material-review";
import { redirectToExistingLogin, useMaterialSession } from "./material-shell";
import { LoadingRows, MaterialErrorState, MaterialPagination, type PaginationValue } from "./material-primitives";

type QueueIssue = { code?: string; severity?: string; field?: string; attribute_code?: string; message?: string };
type QueueRow = {
  material_id: number;
  standard_name: string;
  category_path: string;
  creator: string;
  last_modified_by: string;
  submitted_by: string;
  submitted_at: string;
  current_version: number;
  source_type: string;
  validation_summary: { basis?: string; valid?: boolean; error_count: number; warning_count: number; top_issues: QueueIssue[] };
};
type QueueResponse = { data: QueueRow[]; pagination: PaginationValue; request_id?: string };
type UiError = { status?: number; code?: string; requestId?: string };
type ReviewResultMessage = { kind: "approve" | "reject"; message: string };

function asUiError(reason: unknown): UiError { return reason instanceof ErpApiError ? reason : {}; }

export function MaterialReviewQueuePage() {
  const session = useMaterialSession();
  const capabilities = useMemo(() => reviewCapabilities(session.user?.permissions || []), [session.user?.permissions]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState<ReviewQueueQuery>(DEFAULT_REVIEW_QUERY);
  const [draft, setDraft] = useState<ReviewQueueQuery>(DEFAULT_REVIEW_QUERY);
  const [result, setResult] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(capabilities.queue);
  const [error, setError] = useState<UiError | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [resultMessage, setResultMessage] = useState<ReviewResultMessage | null>(null);
  const requestSequence = useRef(0);

  const applyLocation = useCallback(() => {
    const parsed = parseReviewQueueQuery(window.location.search);
    const canonical = `/materials/review?${serializeReviewQueueQuery(parsed)}`;
    const state = window.history.state as { materialReviewResult?: ReviewResultMessage } | null;
    if (state?.materialReviewResult) {
      setResultMessage(state.materialReviewResult);
      window.history.replaceState({ ...state, materialReviewResult: undefined }, "", canonical);
    } else if (`${window.location.pathname}${window.location.search}` !== canonical) {
      window.history.replaceState(state || {}, "", canonical);
    }
    setQuery(parsed);
    setDraft(parsed);
    setReady(true);
    document.title = "物料审核队列 - 晨亿达 ERP";
  }, []);

  useEffect(() => {
    if (!capabilities.queue) return;
    const timer = window.setTimeout(applyLocation, 0);
    window.addEventListener("popstate", applyLocation);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", applyLocation); };
  }, [applyLocation, capabilities.queue]);

  const navigate = useCallback((next: ReviewQueueQuery, mode: "push" | "replace" = "push") => {
    const canonical = `/materials/review?${serializeReviewQueueQuery(next)}`;
    window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", canonical);
    setQuery(next);
    setDraft(next);
    setResultMessage(null);
  }, []);

  useEffect(() => {
    if (!ready || draft.keyword === query.keyword) return;
    const timer = window.setTimeout(() => navigate({ ...query, keyword: draft.keyword.trim().slice(0, 100), page: 1 }, "replace"), 300);
    return () => window.clearTimeout(timer);
  }, [draft.keyword, navigate, query, ready]);

  const load = useCallback(async (current: ReviewQueueQuery, signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(null);
    try {
      const response = await api<QueueResponse>(reviewQueueApiQuery(current), { signal });
      if (sequence !== requestSequence.current) return;
      if (response.pagination.total_pages > 0 && current.page > response.pagination.total_pages) {
        navigate({ ...current, page: response.pagination.total_pages }, "replace");
        return;
      }
      setResult(response);
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError" || sequence !== requestSequence.current) return;
      if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
      setError(asUiError(reason));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!ready || !capabilities.queue) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(query, controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [capabilities.queue, load, query, ready]);

  useEffect(() => {
    if (!ready || !capabilities.queue) return;
    const controller = new AbortController();
    api<{ data?: Parameters<typeof flattenCategories>[0] }>("/api/material-master/categories?view=tree", { signal: controller.signal })
      .then((response) => { setCategories(flattenCategories(Array.isArray(response.data) ? response.data : []).filter((node) => node.is_leaf)); setCategoryError(false); })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name === "AbortError") return;
        if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
        setCategoryError(true);
      });
    return () => controller.abort();
  }, [capabilities.queue, ready]);

  const activeFilters = useMemo(() => hasReviewFilters(query), [query]);
  const returnTo = ready ? `/materials/review?${serializeReviewQueueQuery(query)}` : "/materials/review?page=1&page_size=20&sort=submitted_at_desc";
  const reset = () => navigate({ ...DEFAULT_REVIEW_QUERY });
  const applyDraft = (event: FormEvent) => {
    event.preventDefault();
    navigate({ ...draft, keyword: draft.keyword.trim().slice(0, 100), creator: draft.creator.trim().slice(0, 64), page: 1 });
  };

  if (!capabilities.queue) return <MaterialErrorState error={{ status: 403, code: "FORBIDDEN" }} />;

  return <section className="mm-page mm-review-queue-page" aria-labelledby="review-queue-title">
    <nav className="mm-breadcrumb" aria-label="面包屑"><Link href="/">首页</Link><span>/</span><Link href="/materials">物料主数据</Link><span>/</span><span>审核队列</span></nav>
    <header className="mm-page-head"><div><h2 id="review-queue-title">物料审核队列</h2><p>仅显示待审核 PENDING_REVIEW；最终审核以工作台重新加载的详情为准。</p></div><span className="mm-readonly">服务端分页</span></header>
    {resultMessage ? <div className={`mm-review-result mm-review-result-${resultMessage.kind}`} role="status" aria-live="polite"><strong>审核结果</strong><span>{resultMessage.message}</span></div> : null}

    <form className="mm-filter-bar mm-review-filter-bar" onSubmit={applyDraft} aria-label="审核队列筛选">
      <label>关键词<input value={draft.keyword} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} placeholder="名称 / 制造商 / MPN" /></label>
      <label>分类<select value={query.category_id} disabled={categoryError} onChange={(event) => navigate({ ...query, category_id: event.target.value, page: 1 })}><option value="">{categoryError ? "分类暂时不可用" : "全部四级叶子"}</option>{categories.map((node) => <option key={node.category_id} value={node.category_id}>{node.full_path || node.name}</option>)}</select></label>
      <label>来源<select value={query.source_type} onChange={(event) => navigate({ ...query, source_type: event.target.value, page: 1 })}><option value="">全部</option><option value="MANUAL">人工</option><option value="LEGACY_D1">旧版在线系统</option><option value="LEGACY_SQLITE">本地旧版系统</option><option value="GOVERNANCE_TEMPLATE">治理模板</option><option value="API">API</option></select></label>
      <label>创建人<input value={draft.creator} onChange={(event) => setDraft({ ...draft, creator: event.target.value })} /></label>
      <label>提交日期<span className="mm-date-range"><input type="date" value={draft.submitted_from} onChange={(event) => setDraft({ ...draft, submitted_from: event.target.value })} /><span>至</span><input type="date" value={draft.submitted_to} onChange={(event) => setDraft({ ...draft, submitted_to: event.target.value })} /></span></label>
      <label>排序<select value={query.sort} onChange={(event) => navigate({ ...query, sort: event.target.value, page: 1 })}><option value="submitted_at_desc">提交时间：新到旧</option><option value="submitted_at_asc">提交时间：旧到新</option><option value="standard_name_asc">标准名称：升序</option><option value="standard_name_desc">标准名称：降序</option></select></label>
      <div className="mm-filter-actions"><button type="submit">查询</button><button type="button" onClick={reset}>重置</button></div>
    </form>
    <div className="mm-filter-summary" aria-live="polite">{activeFilters ? "已应用筛选条件；筛选变化后回到第一页。" : "当前显示全部待审核物料。"}<span>提交日期按 UTC 日期筛选；不提供提交人筛选</span></div>

    {error ? <MaterialErrorState error={error} onRetry={() => load(query)} onReset={reset} /> : <>
      <div className="mm-table-wrap mm-review-table-wrap" aria-busy={loading}>
        {loading && result ? <div className="mm-updating" role="status">正在更新结果…</div> : null}
        <table className="mm-review-table"><caption>待审核物料队列</caption><thead><tr><th className="mm-review-sticky-name" scope="col">标准名称</th><th scope="col">分类路径</th><th scope="col">创建人</th><th scope="col">最后修改人</th><th scope="col">提交人</th><th scope="col">提交时间</th><th scope="col">版本</th><th scope="col">来源</th><th scope="col">Validation</th><th scope="col">问题摘要</th><th scope="col">操作</th></tr></thead><tbody>
          {loading && !result ? <LoadingRows columns={11} /> : null}
          {result?.data.map((row) => <tr key={row.material_id}>
            <td className="mm-review-sticky-name"><span className="mm-truncate" tabIndex={0} data-full-text={row.standard_name}>{row.standard_name}</span></td>
            <td><span className="mm-truncate mm-category-path" tabIndex={0} data-full-text={row.category_path}>{row.category_path || "—"}</span></td><td>{row.creator || "—"}</td><td>{row.last_modified_by || "—"}</td><td>{row.submitted_by || "—"}</td><td>{formatShanghaiDate(row.submitted_at)}</td><td>V{row.current_version}</td><td>{sourceLabel(row.source_type)}</td>
            <td><span className="mm-review-validation-count"><b>错误 ERROR {row.validation_summary.error_count}</b><b>警告 WARNING {row.validation_summary.warning_count}</b><small>{row.validation_summary.basis || "CURRENT_METADATA"}</small></span></td>
            <td><ul className="mm-review-issues">{(row.validation_summary.top_issues || []).slice(0, 5).map((issue, index) => <li key={`${issue.code}-${index}`}><b>{issue.severity}</b> {issue.code}<small>{issue.attribute_code || issue.field || "通用问题"} · {issue.message || "—"}</small></li>)}</ul></td>
            <td><Link className="mm-detail-link" href={`/materials/${row.material_id}/review?return_to=${encodeURIComponent(returnTo)}`}>进入审核</Link></td>
          </tr>)}
        </tbody></table>
        {!loading && result?.data.length === 0 ? <div className="mm-empty-state"><p>{activeFilters ? "没有符合当前筛选条件的待审核物料" : "当前没有待审核物料"}</p>{activeFilters ? <button onClick={reset}>清除全部筛选</button> : <span>新提交的物料会出现在此队列。</span>}</div> : null}
      </div>
      {result ? <MaterialPagination value={result.pagination} pageSizes={[20, 50, 100]} disabled={loading} onChange={(page, pageSize) => navigate({ ...query, page, page_size: pageSize as 20 | 50 | 100 })} /> : null}
    </>}
  </section>;
}
