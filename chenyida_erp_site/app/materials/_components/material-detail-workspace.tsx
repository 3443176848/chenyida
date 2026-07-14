"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ErpApiError, safeMaterialReturnTo } from "../../../public/erp/api-client.js";
import {
  actionLabel, attributeDisplay, boundedPreview, compactTrackingId, displayValue, formatShanghaiDate,
  parseHistoryQuery, sourceLabel, statusLabel,
} from "../_lib/material-ui";
import { redirectToExistingLogin } from "./material-shell";
import { MaterialErrorState, MaterialPagination, MaterialStatusBadge, type PaginationValue } from "./material-primitives";

type View = "detail" | "versions" | "change-logs";
type MaterialCore = Record<string, unknown> & { material_id: number; material_code?: string | null; standard_name: string; material_status: string; current_version: number };
type Attribute = { attribute_code: string; name: string; data_type: string; value: unknown; unit?: string; source_type?: string };
type Issue = { code?: string; severity?: string; field?: string; message?: string; attribute_code?: string };
type HistorySummary = {
  versions: { items: VersionItem[]; total: number; has_more: boolean };
  change_logs: { items: ChangeItem[]; total: number; has_more: boolean };
};
type MaterialDetail = {
  material: MaterialCore;
  category_path: { category_id: number; category_code: string; category_name: string; level: number }[];
  attributes: Attribute[];
  validation: { basis?: string; validated_at?: string; valid: boolean; errors: Issue[]; warnings: Issue[] };
  history_summary: HistorySummary;
};
type VersionItem = { version: number; event_type: string; change_reason?: string; changed_fields?: string[]; snapshot?: Record<string, unknown>; changed_by?: string; reviewed_by?: string; created_at?: string; operation_id?: string };
type ChangeItem = { change_type: string; field_name?: string; change_reason?: string; old_value?: unknown; new_value?: unknown; changed_by?: string; created_at?: string; operation_id?: string };
type HistoryResponse<T> = { data: T[]; pagination: PaginationValue; request_id?: string };
type UiError = { status?: number; code?: string; requestId?: string };

function asError(reason: unknown): UiError { return reason instanceof ErpApiError ? reason : {}; }
function routeFor(view: View, id: number): string { return view === "detail" ? `/materials/${id}` : `/materials/${id}/${view}`; }
function actor(value: unknown): string { return displayValue(value); }
function valueVersion(value: unknown): string { return Number.isInteger(value) && Number(value) > 0 ? `V${value}` : "—"; }
function summaryText(item: ChangeItem): string {
  const field = item.field_name ? `${item.field_name}：` : "";
  if (item.old_value !== undefined || item.new_value !== undefined) return `${field}${displayValue(item.old_value)} → ${displayValue(item.new_value)}`;
  return item.change_reason || item.change_type || "—";
}

export function MaterialDetailWorkspace({ materialId, view }: { materialId: number; view: View }) {
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [detailError, setDetailError] = useState<UiError | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [history, setHistory] = useState<HistoryResponse<VersionItem | ChangeItem> | null>(null);
  const [historyError, setHistoryError] = useState<UiError | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(view !== "detail");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [historyQuery, setHistoryQuery] = useState({ page: 1, page_size: 20 as 20 | 50 });
  const [returnTo, setReturnTo] = useState("/materials");
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState("");

  const readLocation = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const safeReturn = safeMaterialReturnTo(params.get("return_to"));
    setReturnTo(safeReturn);
    if (view !== "detail") {
      const parsed = parseHistoryQuery(params);
      const canonical = `${routeFor(view, materialId)}?page=${parsed.page}&page_size=${parsed.page_size}&return_to=${encodeURIComponent(safeReturn)}`;
      if (`${window.location.pathname}${window.location.search}` !== canonical) window.history.replaceState({}, "", canonical);
      setHistoryQuery(parsed);
    }
    setReady(true);
  }, [materialId, view]);

  useEffect(() => {
    const timer = window.setTimeout(readLocation, 0);
    window.addEventListener("popstate", readLocation);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", readLocation); };
  }, [readLocation]);

  const loadDetail = useCallback(async (signal?: AbortSignal) => {
    setLoadingDetail(true); setDetailError(null);
    try {
      const response = await api(`/api/material-master/materials/${materialId}`, { signal }) as { data: MaterialDetail };
      setDetail(response.data);
      document.title = `${response.data.material.standard_name} - ${view === "detail" ? "物料详情" : view === "versions" ? "版本历史" : "变更日志"} - 晨亿达 ERP`;
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return;
      if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
      setDetailError(asError(reason));
    } finally { setLoadingDetail(false); }
  }, [materialId, view]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadDetail(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadDetail, ready]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    if (view === "detail") return;
    setLoadingHistory(true); setHistoryError(null);
    try {
      const response = await api(`/api/material-master/materials/${materialId}/${view}?page=${historyQuery.page}&page_size=${historyQuery.page_size}`, { signal }) as HistoryResponse<VersionItem | ChangeItem>;
      setHistory(response);
      if (response.pagination.total_pages > 0 && historyQuery.page > response.pagination.total_pages) {
        const next = { ...historyQuery, page: response.pagination.total_pages };
        window.history.replaceState({}, "", `${routeFor(view, materialId)}?page=${next.page}&page_size=${next.page_size}&return_to=${encodeURIComponent(returnTo)}`);
        setHistoryQuery(next);
      }
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return;
      if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
      setHistoryError(asError(reason));
    } finally { setLoadingHistory(false); }
  }, [historyQuery, materialId, returnTo, view]);

  useEffect(() => {
    if (!ready || view === "detail") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadHistory(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadHistory, ready, view]);

  const navigateHistory = (page: number, pageSize: number) => {
    const next = { page, page_size: pageSize as 20 | 50 };
    window.history.pushState({}, "", `${routeFor(view, materialId)}?page=${next.page}&page_size=${next.page_size}&return_to=${encodeURIComponent(returnTo)}`);
    setHistoryQuery(next);
    setExpanded(null);
  };
  const returnParam = `return_to=${encodeURIComponent(returnTo)}`;
  const versionsTotal = detail?.history_summary.versions.total ?? 0;
  const logsTotal = detail?.history_summary.change_logs.total ?? 0;

  if (loadingDetail && !detail) return <section className="mm-detail-loading" role="status"><div className="mm-skeleton-title" /><div className="mm-card-skeletons">正在加载物料详情…</div></section>;
  if (detailError || !detail) return <MaterialErrorState error={detailError} onRetry={detailError?.status === 404 ? undefined : () => loadDetail()} />;

  return (
    <section className="mm-page mm-detail-page">
      <nav className="mm-breadcrumb" aria-label="面包屑"><Link href="/materials">物料主数据</Link><span>/</span><span>{detail.material.material_code || detail.material.standard_name}</span></nav>
      <header className="mm-detail-head">
        <div><Link className="mm-back-link" href={returnTo}>← 返回列表</Link><div className="mm-detail-title"><h2>{detail.material.standard_name}</h2><MaterialStatusBadge value={detail.material.material_status} /></div></div>
        <span className="mm-material-code">{detail.material.material_code || "尚无正式编码"}</span>
      </header>
      <nav className="mm-history-tabs" aria-label="物料详情工作区">
        <Link href={`${routeFor("detail", materialId)}?${returnParam}`} aria-current={view === "detail" ? "page" : undefined}>详情</Link>
        <Link href={`${routeFor("versions", materialId)}?page=1&page_size=20&${returnParam}`} aria-current={view === "versions" ? "page" : undefined}>版本历史（{versionsTotal}）</Link>
        <Link href={`${routeFor("change-logs", materialId)}?page=1&page_size=20&${returnParam}`} aria-current={view === "change-logs" ? "page" : undefined}>变更日志（{logsTotal}）</Link>
      </nav>

      {view === "detail" ? <MaterialDetailCards detail={detail} materialId={materialId} returnParam={returnParam} /> : null}
      {view !== "detail" && historyError ? <MaterialErrorState error={historyError} onRetry={() => loadHistory()} /> : null}
      {view === "versions" && !historyError ? <VersionHistory data={(history?.data || []) as VersionItem[]} loading={loadingHistory} expanded={expanded} onExpand={setExpanded} /> : null}
      {view === "change-logs" && !historyError ? <ChangeHistory data={(history?.data || []) as ChangeItem[]} loading={loadingHistory} expanded={expanded} onExpand={setExpanded} copied={copied} onCopy={(id) => { navigator.clipboard?.writeText(id); setCopied(id); }} /> : null}
      {view !== "detail" && history && !historyError ? <MaterialPagination value={history.pagination} pageSizes={[20, 50]} disabled={loadingHistory} onChange={navigateHistory} /> : null}
    </section>
  );
}

function FieldGrid({ fields }: { fields: [string, unknown][] }) {
  return <dl className="mm-field-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{displayValue(value)}</dd></div>)}</dl>;
}

function MaterialDetailCards({ detail, materialId, returnParam }: { detail: MaterialDetail; materialId: number; returnParam: string }) {
  const material = detail.material;
  const categoryPath = detail.category_path.map((node) => node.category_name).join(" / ");
  const validation = detail.validation;
  return <div className="mm-detail-grid">
    <section className="mm-card mm-card-basic"><h3>基本信息</h3><FieldGrid fields={[
      ["正式物料编码", material.material_code], ["标准名称", material.standard_name], ["状态", statusLabel(material.material_status)],
      ["分类路径", categoryPath], ["基本单位", material.unit], ["来源", sourceLabel(material.source_type)],
      ["来源引用", material.source_ref], ["当前版本", `V${material.current_version}`], ["品牌", material.brand],
      ["制造商", material.manufacturer], ["制造商型号", material.manufacturer_part_number], ["采购类型", material.procurement_type],
      ["库存类型", material.inventory_type], ["批次控制", material.lot_control_required === true ? "是" : material.lot_control_required === false ? "否" : "—"],
      ["保质期（天）", material.shelf_life_days], ["检验类型", material.inspection_type], ["环保要求", material.environmental_requirement],
    ]} /></section>
    <ValidationPanel validation={validation} />
    <section className="mm-card"><h3>职责信息</h3><FieldGrid fields={[
      ["创建人", material.created_by], ["最后修改人", material.last_modified_by], ["提交人", material.submitted_by],
      ["提交时间", formatShanghaiDate(material.submitted_at, true)], ["批准人", material.approved_by], ["批准时间", formatShanghaiDate(material.approved_at, true)],
      ["创建时间", formatShanghaiDate(material.created_at, true)], ["更新时间", formatShanghaiDate(material.updated_at, true)],
    ]} /></section>
    <HistoryCard title="最近版本" total={detail.history_summary.versions.total} href={`/materials/${materialId}/versions?page=1&page_size=20&${returnParam}`}>
      {detail.history_summary.versions.items.slice(0, 5).map((item) => <li key={`${item.version}-${item.created_at}`}><b>V{item.version} {actionLabel(item.event_type)}</b><span>{actor(item.changed_by)} · {formatShanghaiDate(item.created_at, true)}</span></li>)}
    </HistoryCard>
    <section className="mm-card mm-attributes"><h3>类型化属性</h3>{detail.attributes.length ? <div className="mm-attribute-grid">{detail.attributes.map((attribute) => <div key={attribute.attribute_code} className="mm-attribute"><span>{attribute.name}</span><small>{attribute.attribute_code}</small><strong>{attributeDisplay(attribute)}</strong></div>)}</div> : <p className="mm-muted">暂无类型化属性</p>}</section>
    <HistoryCard title="最近变更" total={detail.history_summary.change_logs.total} href={`/materials/${materialId}/change-logs?page=1&page_size=20&${returnParam}`}>
      {detail.history_summary.change_logs.items.slice(0, 5).map((item, index) => <li key={`${item.created_at}-${index}`}><b>{actionLabel(item.change_type)} · {displayValue(item.field_name)}</b><span>{actor(item.changed_by)} · {formatShanghaiDate(item.created_at, true)}</span></li>)}
    </HistoryCard>
  </div>;
}

function ValidationPanel({ validation }: { validation: MaterialDetail["validation"] }) {
  const issues = [...(validation.errors || []), ...(validation.warnings || [])];
  return <section className="mm-card mm-validation"><h3>当前校验结果</h3><div className="mm-validation-summary"><strong>{validation.valid ? "校验通过" : "校验未通过"}</strong><span>错误 {validation.errors?.length || 0}</span><span>警告 {validation.warnings?.length || 0}</span></div><p className="mm-validation-basis">依据：{displayValue(validation.basis)} · {formatShanghaiDate(validation.validated_at, true)}</p>{issues.length ? <ul>{issues.map((issue, index) => <li className={`mm-issue mm-issue-${String(issue.severity).toLowerCase()}`} key={`${issue.code}-${index}`}><b>{issue.severity === "ERROR" ? "错误 ERROR" : "警告 WARNING"}</b><span>{displayValue(issue.code)} · {displayValue(issue.field || issue.attribute_code)}</span><p>{displayValue(issue.message)}</p></li>)}</ul> : <p className="mm-muted">没有错误或警告。</p>}</section>;
}

function HistoryCard({ title, total, href, children }: { title: string; total: number; href: string; children: React.ReactNode }) {
  return <section className="mm-card mm-history-card"><h3>{title}（最多 5 条）</h3><ul>{children}</ul><Link href={href}>查看完整{title.replace("最近", "")}（共 {total} 条）</Link></section>;
}

function Comment({ text }: { text?: string }) {
  const safe = String(text || "");
  if (!safe) return <>—</>;
  if (safe.length <= 36) return <>{safe}</>;
  return <details className="mm-comment"><summary>{safe.slice(0, 36)}…</summary><p>{safe.slice(0, 4096)}{safe.length > 4096 ? "…（已截断）" : ""}</p></details>;
}

function VersionHistory({ data, loading, expanded, onExpand }: { data: VersionItem[]; loading: boolean; expanded: number | null; onExpand: (value: number | null) => void }) {
  if (!loading && data.length === 0) return <div className="mm-empty-state"><p>暂无版本历史</p></div>;
  return <div className="mm-table-wrap mm-history-table-wrap" aria-busy={loading}>{loading ? <div className="mm-updating" role="status">正在加载版本历史…</div> : null}<table className="mm-history-table"><caption>物料版本历史</caption><thead><tr><th>版本</th><th>动作</th><th>操作者</th><th>状态变化</th><th>时间</th><th>comment 摘要</th><th>快照</th></tr></thead><tbody>{data.map((item, index) => {
    const snapshotStatus = item.changed_fields?.includes("material_status") ? item.snapshot?.material_status : null;
    return <tr className="mm-history-row" key={`${item.version}-${index}`}><td>V{item.version}</td><td>{actionLabel(item.event_type)}<small>{item.event_type}</small></td><td>{actor(item.changed_by)}</td><td>{snapshotStatus ? `变更后：${statusLabel(snapshotStatus)}` : "—"}</td><td>{formatShanghaiDate(item.created_at, true)}</td><td><Comment text={item.change_reason} /></td><td><button onClick={() => onExpand(expanded === index ? null : index)} aria-expanded={expanded === index}>{expanded === index ? "收起" : "查看"}</button></td></tr>;
  })}</tbody></table>{expanded !== null && data[expanded] ? <section className="mm-inline-detail"><h3>V{data[expanded].version} 快照（只读）</h3><pre>{boundedPreview(data[expanded].snapshot)}</pre><p>内容最多展示 4 层、4KB；本页不提供版本恢复。</p></section> : null}</div>;
}

function ChangeHistory({ data, loading, expanded, onExpand, copied, onCopy }: { data: ChangeItem[]; loading: boolean; expanded: number | null; onExpand: (value: number | null) => void; copied: string; onCopy: (id: string) => void }) {
  if (!loading && data.length === 0) return <div className="mm-empty-state"><p>暂无变更日志</p></div>;
  return <div className="mm-table-wrap mm-history-table-wrap" aria-busy={loading}>{loading ? <div className="mm-updating" role="status">正在加载变更日志…</div> : null}<table className="mm-history-table mm-change-table"><caption>物料变更日志</caption><thead><tr><th>动作</th><th>操作者</th><th>发生时间</th><th>原版本</th><th>新版本</th><th>安全变更摘要</th><th>追踪信息</th><th>详情</th></tr></thead><tbody>{data.map((item, index) => <tr className="mm-history-row" key={`${item.created_at}-${index}`}><td>{actionLabel(item.change_type)}<small>{item.change_type}</small></td><td>{actor(item.changed_by)}</td><td>{formatShanghaiDate(item.created_at, true)}</td><td>{item.field_name === "version" ? valueVersion(item.old_value) : "—"}</td><td>{item.field_name === "version" ? valueVersion(item.new_value) : "—"}</td><td><span className="mm-change-summary">{summaryText(item).slice(0, 180)}</span></td><td><span className="mm-tracking">{compactTrackingId(item.operation_id)}</span>{item.operation_id ? <button className="mm-copy" onClick={() => onCopy(item.operation_id || "")}>{copied === item.operation_id ? "已复制" : "复制"}</button> : null}</td><td><button onClick={() => onExpand(expanded === index ? null : index)} aria-expanded={expanded === index}>{expanded === index ? "收起" : "查看"}</button></td></tr>)}</tbody></table>{expanded !== null && data[expanded] ? <section className="mm-inline-detail"><h3>变更详情（只读）</h3><div className="mm-diff"><div><h4>变更前</h4><pre>{boundedPreview(data[expanded].old_value)}</pre></div><div><h4>变更后</h4><pre>{boundedPreview(data[expanded].new_value)}</pre></div></div><p>内容最多展示 4 层、4KB，数组最多 100 项。</p></section> : null}</div>;
}
