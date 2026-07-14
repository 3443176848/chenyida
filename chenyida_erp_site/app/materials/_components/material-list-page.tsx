"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import {
  DEFAULT_LIST_QUERY, flattenCategories, formatShanghaiDate, hasActiveFilters, materialApiQuery,
  parseListQuery, serializeListQuery, sourceLabel, type CategoryOption, type MaterialListQuery,
} from "../_lib/material-ui";
import { redirectToExistingLogin } from "./material-shell";
import { LoadingRows, MaterialErrorState, MaterialPagination, MaterialStatusBadge, type PaginationValue } from "./material-primitives";

type MaterialRow = {
  material_id: number; material_code: string | null; standard_name: string; material_status: string;
  category_path: string; unit: string; source_type: string; current_version: number; created_by: string; updated_at: string;
};
type ListResponse = { data: MaterialRow[]; pagination: PaginationValue; request_id?: string };
type UiError = { status?: number; code?: string; requestId?: string };

function uiError(reason: unknown): UiError {
  return reason instanceof ErpApiError ? reason : {};
}

function sortAria(query: MaterialListQuery, field: string): "ascending" | "descending" | "none" {
  return query.sort === `${field}_asc` ? "ascending" : query.sort === `${field}_desc` ? "descending" : "none";
}

export function MaterialListPage() {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState<MaterialListQuery>(DEFAULT_LIST_QUERY);
  const [draft, setDraft] = useState<MaterialListQuery>(DEFAULT_LIST_QUERY);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const requestSequence = useRef(0);

  const applyLocation = useCallback(() => {
    const parsed = parseListQuery(window.location.search);
    const canonical = `/materials?${serializeListQuery(parsed)}`;
    if (`${window.location.pathname}${window.location.search}` !== canonical) window.history.replaceState({}, "", canonical);
    setQuery(parsed);
    setDraft(parsed);
    setReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(applyLocation, 0);
    window.addEventListener("popstate", applyLocation);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", applyLocation); };
  }, [applyLocation]);

  const navigate = useCallback((next: MaterialListQuery, mode: "push" | "replace" = "push") => {
    const canonical = `/materials?${serializeListQuery(next)}`;
    window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", canonical);
    setQuery(next);
    setDraft(next);
  }, []);

  useEffect(() => {
    if (!ready || draft.keyword === query.keyword) return;
    const timer = window.setTimeout(() => navigate({ ...query, keyword: draft.keyword.trim().slice(0, 100), page: 1 }, "replace"), 300);
    return () => window.clearTimeout(timer);
  }, [draft.keyword, navigate, query, ready]);

  const load = useCallback(async (current: MaterialListQuery, signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api(materialApiQuery(current), { signal }) as ListResponse;
      if (sequence !== requestSequence.current) return;
      if (response.pagination.total_pages > 0 && current.page > response.pagination.total_pages) {
        navigate({ ...current, page: response.pagination.total_pages }, "replace");
        return;
      }
      setResult(response);
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError" || sequence !== requestSequence.current) return;
      if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
      setError(uiError(reason));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(query, controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, query, ready]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    api("/api/material-master/categories?view=tree", { signal: controller.signal })
      .then((response: { data?: Parameters<typeof flattenCategories>[0] }) => {
        setCategories(flattenCategories(Array.isArray(response.data) ? response.data : []));
        setCategoryError(false);
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name === "AbortError") return;
        if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
        setCategoryError(true);
      });
    return () => controller.abort();
  }, [ready]);

  const categoryValue = query.category_id ? `id:${query.category_id}` : query.category_path ? `path:${query.category_path}` : "";
  const activeFilters = useMemo(() => hasActiveFilters(query), [query]);
  const reset = () => navigate({ ...DEFAULT_LIST_QUERY });
  const applyDraft = (event: FormEvent) => {
    event.preventDefault();
    navigate({ ...draft, keyword: draft.keyword.trim().slice(0, 100), page: 1 });
  };
  const selectCategory = (value: string) => {
    const next = { ...query, category_id: "", category_path: "", page: 1 };
    if (value.startsWith("id:")) next.category_id = value.slice(3);
    if (value.startsWith("path:")) next.category_path = value.slice(5);
    navigate(next);
  };
  const changeSort = (field: string) => {
    const next = query.sort === `${field}_asc` ? `${field}_desc` : `${field}_asc`;
    navigate({ ...query, sort: next, page: 1 });
  };
  const returnTo = ready ? `/materials?${serializeListQuery(query)}` : "/materials?page=1&page_size=20&sort=updated_at_desc";

  return (
    <section className="mm-page" aria-labelledby="material-list-title">
      <nav className="mm-breadcrumb" aria-label="面包屑"><Link href="/">首页</Link><span>/</span><span>物料主数据</span></nav>
      <header className="mm-page-head"><div><h2 id="material-list-title">物料主数据</h2><p>按服务端授权范围查询，当前页面仅供查看。</p></div><span className="mm-readonly">只读</span></header>

      <form className="mm-filter-bar" onSubmit={applyDraft} aria-label="物料筛选">
        <label>关键词<input value={draft.keyword} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} placeholder="编码 / 名称 / 制造商 / MPN" /></label>
        <label>状态<select value={query.material_status} onChange={(event) => navigate({ ...query, material_status: event.target.value, page: 1 })}><option value="">全部</option><option value="DRAFT">草稿</option><option value="PENDING_REVIEW">待审核</option><option value="ACTIVE">生效</option><option value="FROZEN">冻结</option><option value="INACTIVE">停用（兼容）</option></select></label>
        <label className="mm-category-filter">分类<select value={categoryValue} disabled={categoryError} onChange={(event) => selectCategory(event.target.value)}><option value="">{categoryError ? "分类暂时不可用" : "全部分类"}</option>{categories.map((node) => <option key={node.category_id} value={node.is_leaf ? `id:${node.category_id}` : `path:${node.code_path}`}>{`${"　".repeat(Math.max(0, node.level - 1))}${node.name}（${node.is_leaf ? "叶子" : "含后代"}）`}</option>)}</select></label>
        <label>来源<select value={query.source_type} onChange={(event) => navigate({ ...query, source_type: event.target.value, page: 1 })}><option value="">全部</option><option value="MANUAL">人工</option><option value="LEGACY_D1">旧版在线系统</option><option value="LEGACY_SQLITE">本地旧版系统</option><option value="GOVERNANCE_TEMPLATE">治理模板</option><option value="API">API</option></select></label>
        <label>创建人<input value={draft.created_by} onChange={(event) => setDraft({ ...draft, created_by: event.target.value })} /></label>
        <label>创建日期<span className="mm-date-range"><input type="date" value={draft.created_from} onChange={(event) => setDraft({ ...draft, created_from: event.target.value })} /><span>至</span><input type="date" value={draft.created_to} onChange={(event) => setDraft({ ...draft, created_to: event.target.value })} /></span></label>
        <label>更新日期<span className="mm-date-range"><input type="date" value={draft.updated_from} onChange={(event) => setDraft({ ...draft, updated_from: event.target.value })} /><span>至</span><input type="date" value={draft.updated_to} onChange={(event) => setDraft({ ...draft, updated_to: event.target.value })} /></span></label>
        <label>排序<select value={query.sort} onChange={(event) => navigate({ ...query, sort: event.target.value, page: 1 })}><option value="updated_at_desc">更新时间降序</option><option value="updated_at_asc">更新时间升序</option><option value="created_at_desc">创建时间降序</option><option value="created_at_asc">创建时间升序</option><option value="standard_name_asc">标准名称升序</option><option value="standard_name_desc">标准名称降序</option><option value="material_code_asc">物料编码升序</option><option value="material_code_desc">物料编码降序</option></select></label>
        <div className="mm-filter-actions"><button type="submit">查询</button><button type="button" onClick={reset}>重置</button></div>
      </form>
      <div className="mm-filter-summary" aria-live="polite">{activeFilters ? "已应用筛选条件；修改筛选后自动回到第一页。" : "当前显示全部可见物料。"}<span>日期范围按 UTC 日期筛选</span></div>

      {error ? <MaterialErrorState error={error} onRetry={() => load(query)} onReset={reset} /> : (
        <>
          <div className="mm-table-wrap" aria-busy={loading}>
            {loading && result ? <div className="mm-updating" role="status">正在更新结果…</div> : null}
            <table className="mm-material-table"><caption>物料主数据查询结果</caption><thead><tr>
              <th className="mm-sticky-code" scope="col" aria-sort={sortAria(query, "material_code")}><button onClick={() => changeSort("material_code")}>物料编码 ↕</button></th>
              <th className="mm-sticky-name" scope="col" aria-sort={sortAria(query, "standard_name")}><button onClick={() => changeSort("standard_name")}>标准名称 ↕</button></th>
              <th scope="col">状态</th><th scope="col">分类路径</th><th scope="col">单位</th><th scope="col">来源</th><th scope="col">当前版本</th><th scope="col">创建人</th>
              <th scope="col" aria-sort={sortAria(query, "updated_at")}><button onClick={() => changeSort("updated_at")}>更新时间 ↕</button></th><th scope="col">操作</th>
            </tr></thead><tbody>
              {loading && !result ? <LoadingRows /> : null}
              {result?.data.map((row) => <tr key={row.material_id}>
                <td className="mm-sticky-code mm-mono">{row.material_code || "—"}</td>
                <td className="mm-sticky-name"><span className="mm-truncate" tabIndex={0} data-full-text={row.standard_name}>{row.standard_name}</span></td>
                <td><MaterialStatusBadge value={row.material_status} /></td>
                <td><span className="mm-truncate mm-category-path" tabIndex={0} data-full-text={row.category_path}>{row.category_path || "—"}</span></td>
                <td>{row.unit || "—"}</td><td>{sourceLabel(row.source_type)}</td><td>V{row.current_version}</td><td>{row.created_by || "—"}</td><td>{formatShanghaiDate(row.updated_at)}</td>
                <td><Link className="mm-detail-link" href={`/materials/${row.material_id}?return_to=${encodeURIComponent(returnTo)}`}>查看详情</Link></td>
              </tr>)}
            </tbody></table>
            {!loading && result?.data.length === 0 ? <div className="mm-empty-state"><p>{activeFilters ? "没有符合当前筛选条件的物料" : "尚无可查看的物料"}</p>{activeFilters ? <button onClick={reset}>清除筛选</button> : null}</div> : null}
          </div>
          {result ? <MaterialPagination value={result.pagination} pageSizes={[20, 50, 100]} disabled={loading} onChange={(page, pageSize) => navigate({ ...query, page, page_size: pageSize as 20 | 50 | 100 })} /> : null}
        </>
      )}
    </section>
  );
}
