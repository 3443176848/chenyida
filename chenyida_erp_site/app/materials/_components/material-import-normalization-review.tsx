"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../../public/erp/api-client.js";
import { formatShanghaiDate } from "../_lib/material-ui";
import { normalizeImportUiError, type ImportUiError, type MaterialImportBatch } from "../_lib/material-import";
import { MaterialImportPollingController } from "../_lib/material-import-polling";
import {
  MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, NORMALIZATION_ISSUE_PAGE_MARKER, NORMALIZATION_ROW_DRAWER_MARKER,
  NORMALIZATION_ROW_PAGE_MARKER, activeNormalizationRun, boundedValue, issueLabel, normalizationIssuesEndpoint,
  normalizationStageLabel, normalizedRowsEndpoint, parseNormalizationQuery, rowProgress, safeIssueDetails,
  serializeNormalizationQuery, shortDigest, validRunCounts, validateComposite, validateIssuesResponse, validateRowDetail,
  validateRowsResponse, strictPositiveInteger, type BoundedValue, type FieldCandidate, type NormalizationIssue, type NormalizationIssuesResponse,
  type NormalizationQuery, type NormalizationRun, type NormalizationSummary, type NormalizedRowDetail, type NormalizedRowsResponse,
} from "../_lib/material-import-normalization";
import { MaterialImportDialog } from "./material-import-primitives";
import { redirectToExistingLogin } from "./material-shell";

type DetailResponse = { data: { batch: MaterialImportBatch } };
type MappingResponse = { batch_id: number; batch_status: string; current_version: number; mapping: { mapping_status: string; parse_run_id: number } };
type Operation = Readonly<{ operation_type: "NORMALIZE" | "CANCEL"; key: string; method: "POST"; endpoint: string; frozen_body: string; payload_digest: string; status: "PENDING" | "COMPLETED" | "FAILED" | "RESULT_UNKNOWN"; started_at: string; last_error_code: string }>;
type Dialog = "START" | "CANCEL" | "RERUN" | null;

const BASIC_ORDER = ["STANDARD_NAME", "UNIT", "BRAND", "MODEL", "SPECIFICATION", "DESCRIPTION"];
const DEFERRED_LABELS: Record<string, string> = {
  CATEGORY_ASSIGNMENT_REQUIRED: "仍需确定正式分类", CATEGORY_BOUND_ATTRIBUTE_VALIDATION_REQUIRED: "分类后仍需校验绑定属性", MATERIAL_VALIDATION_NOT_RUN: "尚未执行正式物料校验",
};

function BoundedValueView({ value }: { value: BoundedValue }) {
  if (value.children) return <div className={`min-value min-value-${value.type}`}><span>{value.type === "array" ? "Array" : "Object"}</span><dl>{value.children.map(([key, child], index) => <div key={`${key}-${index}`}><dt>{key}</dt><dd><BoundedValueView value={child} /></dd></div>)}</dl>{value.truncated ? <p>内容过大，已进行有界展示</p> : null}</div>;
  return <span className={`min-value min-value-${value.type}`}>{value.type}: {value.text}{value.truncated ? "（内容过大，已进行有界展示）" : ""}</span>;
}

function CandidateCard({ label, candidate }: { label: string; candidate: FieldCandidate | null | undefined }) {
  if (candidate === undefined) return <article className="min-candidate"><h5>{label}</h5><p>未生成该字段候选</p></article>;
  if (candidate === null) return <article className="min-candidate"><h5>{label}</h5><p>字段对象为 Null</p></article>;
  const source = candidate.source;
  return <article className="min-candidate" id={`min-field-${cryptoSafeId(candidate.target_code)}`}>
    <h5>{label} <code>{candidate.target_code}</code></h5><p><strong>{candidate.status}</strong></p>
    <BoundedValueView value={boundedValue(candidate.candidate)} />
    <dl className="min-inline-facts"><div><dt>来源</dt><dd>{source.kind}</dd></div><div><dt>列</dt><dd>{source.column_index === null ? "无" : source.column_index}</dd></div><div><dt>Cell</dt><dd>{source.cell_type ?? "无"}</dd></div><div><dt>Value State</dt><dd>{source.value_state}</dd></div><div><dt>Blank</dt><dd>{source.blank_kind ?? "无"}</dd></div></dl>
    <details><summary>查看有界原始值</summary><BoundedValueView value={boundedValue(source.raw_value)} /></details>
  </article>;
}

function cryptoSafeId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function FocusTrap({ children, labelledBy, onClose }: { children: ReactNode; labelledBy: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const backdrop = ref.current?.parentElement;
    const background = [...document.querySelectorAll<HTMLElement>(".mi-workspace > *, .min-review > *")].filter((element) => backdrop && !element.contains(backdrop) && !backdrop.contains(element));
    background.forEach((element) => element.setAttribute("inert", ""));
    ref.current?.querySelector<HTMLElement>("button, [tabindex='-1']")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const controls = [...ref.current.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary,[tabindex='-1']")];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); background.forEach((element) => element.removeAttribute("inert")); };
  }, [onClose]);
  return <div className="min-drawer-backdrop"><aside className="min-drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>{children}</aside></div>;
}

function RunProgress({ run }: { run: NormalizationRun }) {
  const progress = rowProgress(run);
  return <section className="min-progress" aria-labelledby="min-progress-title"><h3 id="min-progress-title">{normalizationStageLabel(run.current_stage)}</h3>
    <p>Run 状态：{run.run_status}</p>{progress ? <><label htmlFor="min-row-progress">{progress.label}</label><progress id="min-row-progress" value={progress.percent} max={100}>{progress.percent}%</progress><p>{progress.percent}% · {run.processed_rows} / {run.total_rows} 行</p></> : <p>总行数尚不可用于安全百分比。</p>}
    <p>最近状态更新时间：{formatShanghaiDate(run.updated_at, true)}</p>
  </section>;
}

function SummaryPanel({ run }: { run: NormalizationRun }) {
  if (!validRunCounts(run)) return <section className="min-consistency" role="alert"><h3>结果一致性异常</h3><p>服务端计数无法安全核对，页面未修正或展示这些数字。</p></section>;
  return <section className="min-summary"><h3>{run.error_rows ? `规范化已完成，其中 ${run.error_rows} 行需要处理` : "规范化结果已发布"}</h3>
    <div className="min-metrics"><span>总行 <strong>{run.total_rows}</strong></span><span>VALID <strong>{run.valid_rows}</strong></span><span>WARNING <strong>{run.warning_rows}</strong></span><span>ERROR <strong>{run.error_rows}</strong></span><span>Issues <strong>{run.issue_count}</strong></span><span>Warning Issues <strong>{run.warning_count}</strong></span><span>Error Issues <strong>{run.error_count}</strong></span></div>
    <p>ERROR 行表示该行仍需处理，不表示任务失败；NORMALIZED 不表示分类、匹配、Draft 或正式导入完成。</p>
    <details><summary>运行详情与支持信息</summary><dl className="min-run-facts"><div><dt>Run ID</dt><dd>{run.id}</dd></div><div><dt>Processor</dt><dd>{run.processor_version}</dd></div><div><dt>Payload Schema</dt><dd>{run.payload_schema_version}</dd></div><div><dt>Mapping</dt><dd>{run.mapping_id} / v{run.mapping_version}</dd></div><div><dt>Mapping Digest</dt><dd>{shortDigest(run.mapping_digest)}</dd></div><div><dt>Metadata Digest</dt><dd>{shortDigest(run.metadata_digest)}</dd></div>{run.result_digest ? <div><dt>Result Digest</dt><dd>{shortDigest(run.result_digest)}</dd></div> : null}{Number.isSafeInteger(run.normalized_json_bytes) ? <div><dt>规范化 Payload Bytes</dt><dd>{run.normalized_json_bytes}</dd></div> : null}{run.completed_at ? <div><dt>规范化完成时间</dt><dd>{formatShanghaiDate(run.completed_at, true)}</dd></div> : null}</dl></details>
  </section>;
}

export function MaterialImportNormalizationReview({ batchId, batch, permissions, csrfToken, onBatch }: { batchId: number; batch: MaterialImportBatch; permissions: string[]; csrfToken: string; onBatch: (batch: MaterialImportBatch) => void }) {
  const canNormalize = permissions.includes("material.import.normalize"); const canCancel = permissions.includes("material.import.cancel");
  const [summary, setSummary] = useState<NormalizationSummary | null>(null); const [query, setQuery] = useState<NormalizationQuery | null>(null);
  const [rows, setRows] = useState<NormalizedRowsResponse | null>(null); const [issues, setIssues] = useState<NormalizationIssuesResponse | null>(null); const [detail, setDetail] = useState<NormalizedRowDetail | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<NormalizationIssue | null>(null); const [dialog, setDialog] = useState<Dialog>(null); const [rerunReason, setRerunReason] = useState("");
  const [operations, setOperations] = useState<Partial<Record<Operation["operation_type"], Operation>>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState<ImportUiError | null>(null); const [notice, setNotice] = useState("");
  const [rowPrevious, setRowPrevious] = useState(false); const [issuePrevious, setIssuePrevious] = useState(false); const [polling] = useState(() => new MaterialImportPollingController());
  const focusReturn = useRef<HTMLElement | null>(null); const mainTitle = useRef<HTMLHeadingElement>(null); const runId = summary?.current_run?.id ?? null;
  const rowsUrl = query && runId && query.view === "normalized" ? normalizedRowsEndpoint(batchId, query) : "";
  const issuesUrl = query && runId && query.view === "issues" ? normalizationIssuesEndpoint(batchId, query) : "";
  const detailRowId = query?.row && runId && ["normalized", "issues"].includes(query.view) ? query.row : null;

  const clearProtected = useCallback(() => { polling.stop(); setSummary(null); setRows(null); setIssues(null); setDetail(null); setSelectedIssue(null); setOperations({}); }, [polling]);
  const handleError = useCallback((reason: unknown, protectedRead = false) => {
    if ((reason as { name?: string })?.name === "AbortError") return;
    const next = normalizeImportUiError(reason);
    if (next.status === 401) { clearProtected(); redirectToExistingLogin(); return; }
    if (protectedRead && [403, 404].includes(next.status)) clearProtected();
    setError(next);
  }, [clearProtected]);

  const compositeRead = useCallback(async (signal?: AbortSignal) => {
    const [detailResponse, summaryResponse] = await Promise.all([
      api<DetailResponse>(`/api/material-master/import-batches/${batchId}`, { cache: "no-store", signal }),
      api<NormalizationSummary>(`/api/material-master/import-batches/${batchId}/normalization`, { cache: "no-store", signal }),
    ]);
    if (!validateComposite(detailResponse.data.batch, summaryResponse, batchId)) throw Object.assign(new Error("规范化状态一致性异常"), { code: "NORMALIZATION_CONSISTENCY_ERROR", status: 409 });
    return { batch: detailResponse.data.batch, summary: summaryResponse };
  }, [batchId]);

  const applyComposite = useCallback((result: { batch: MaterialImportBatch; summary: NormalizationSummary }) => {
    const previousRun = summary?.current_run?.id ?? null; const nextRun = result.summary.current_run?.id ?? null;
    onBatch(result.batch); setSummary(result.summary); setError(null);
    const parsed = parseNormalizationQuery(window.location.search, result.batch, result.summary.current_run);
    if (previousRun !== null && previousRun !== nextRun) { parsed.row_cursor = ""; parsed.issue_cursor = ""; parsed.row = null; setRows(null); setIssues(null); setDetail(null); setSelectedIssue(null); }
    const url = `/materials/imports/${batchId}?${serializeNormalizationQuery(parsed)}`;
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState({}, "", url);
    setQuery(parsed);
  }, [batchId, onBatch, summary?.current_run?.id]);

  const refresh = useCallback(async () => { setBusy(true); try { applyComposite(await compositeRead()); } catch (reason) { handleError(reason, true); } finally { setBusy(false); } }, [applyComposite, compositeRead, handleError]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    polling.start(batchId, async (_id, signal) => { const result = await compositeRead(signal); return { ...result, continuePolling: activeNormalizationRun(result.summary.latest_attempt) } as never; }, {
      onData: (value) => applyComposite(value as unknown as { batch: MaterialImportBatch; summary: NormalizationSummary }), onError: (reason) => handleError(reason, true),
    });
    return () => polling.stop();
  }, [applyComposite, batchId, compositeRead, handleError, polling]);

  const navigate = useCallback((patch: Partial<NormalizationQuery>, marker?: string, replace = false) => {
    if (!query) return; const next = { ...query, ...patch };
    const url = `/materials/imports/${batchId}?${serializeNormalizationQuery(next)}`;
    window.history[replace ? "replaceState" : "pushState"](marker ? { marker, batchId, runId } : {}, "", url); setQuery(next);
  }, [batchId, query, runId]);
  useEffect(() => { const pop = () => summary && setQuery(parseNormalizationQuery(window.location.search, batch, summary.current_run)); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, [batch, summary]);

  useEffect(() => {
    const controller = new AbortController();
    if (!rowsUrl || !runId) return () => controller.abort();
    api<NormalizedRowsResponse>(rowsUrl, { cache: "no-store", signal: controller.signal }).then((response) => {
      if (!validateRowsResponse(response, batchId, runId)) throw Object.assign(new Error("规范化行归属不一致"), { status: 409, code: "NORMALIZATION_CONSISTENCY_ERROR" }); setRows(response);
    }).catch((reason) => handleError(reason, true));
    return () => controller.abort();
  }, [batchId, handleError, rowsUrl, runId]);

  useEffect(() => {
    const controller = new AbortController();
    if (!issuesUrl || !runId) return () => controller.abort();
    api<NormalizationIssuesResponse>(issuesUrl, { cache: "no-store", signal: controller.signal }).then((response) => {
      if (!validateIssuesResponse(response, batchId, runId)) throw Object.assign(new Error("规范化问题归属不一致"), { status: 409, code: "NORMALIZATION_CONSISTENCY_ERROR" }); setIssues(response);
    }).catch((reason) => handleError(reason, true));
    return () => controller.abort();
  }, [batchId, handleError, issuesUrl, runId]);

  useEffect(() => {
    const controller = new AbortController();
    if (!detailRowId || !runId) return () => controller.abort();
    api<NormalizedRowDetail>(`/api/material-master/import-batches/${batchId}/normalized-rows/${detailRowId}`, { cache: "no-store", signal: controller.signal }).then((response) => {
      if (!validateRowDetail(response, batchId, runId, detailRowId)) throw Object.assign(new Error("该规范化行不存在或当前不可访问。"), { status: 404, code: "IMPORT_NORMALIZED_ROW_NOT_FOUND" }); setDetail(response);
    }).catch((reason) => { setDetail(null); const normalized = normalizeImportUiError(reason); if (normalized.status === 404) navigate({ row: null }, undefined, true); handleError(reason, false); });
    return () => controller.abort();
  }, [batchId, detailRowId, handleError, navigate, runId]);

  const prepare = async (kind: Exclude<Dialog, null>) => {
    setBusy(true); setError(null);
    try {
      const [result, mapping] = await Promise.all([compositeRead(), api<MappingResponse>(`/api/material-master/import-batches/${batchId}/mapping`, { cache: "no-store" })]);
      if (mapping.batch_id !== batchId || mapping.mapping.mapping_status !== "CONFIRMED" || mapping.mapping.parse_run_id !== result.summary.latest_attempt?.parse_run_id && result.summary.latest_attempt) throw new Error("已确认 Mapping 或 Parse Run 已变化，请刷新。");
      applyComposite(result); setDialog(kind);
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  const execute = async (kind: "NORMALIZE" | "CANCEL", payload?: Record<string, unknown>, replay = false) => {
    const endpoint = kind === "NORMALIZE" ? `/api/material-master/import-batches/${batchId}/normalize` : `/api/material-master/import-batches/${batchId}/cancel`;
    const existing = replay ? operations[kind] ?? null : null;
    const frozen = existing?.frozen_body ?? JSON.stringify(payload); const next: Operation = existing ?? Object.freeze({ operation_type: kind, key: crypto.randomUUID(), method: "POST", endpoint, frozen_body: frozen, payload_digest: frozen, status: "PENDING", started_at: new Date().toISOString(), last_error_code: "" });
    setOperations((current) => ({ ...current, [kind]: { ...next, status: "PENDING" } })); setBusy(true);
    try {
      await api(endpoint, { method: "POST", body: next.frozen_body, protectedWrite: { idempotencyKey: next.key, csrfToken } }); setOperations((current) => ({ ...current, [kind]: { ...next, status: "COMPLETED" } })); setDialog(null); setRerunReason(""); await refresh();
    } catch (reason) {
      const normalized = normalizeImportUiError(reason); setOperations((current) => ({ ...current, [kind]: { ...next, status: normalized.resultUnknown ? "RESULT_UNKNOWN" : "FAILED", last_error_code: normalized.code } })); handleError(reason);
    } finally { setBusy(false); }
  };

  const openRow = (rowId: number, trigger: HTMLElement, issue?: NormalizationIssue) => { focusReturn.current = trigger; setSelectedIssue(issue ?? null); navigate({ row: rowId }, NORMALIZATION_ROW_DRAWER_MARKER); };
  const closeDrawer = useCallback(() => {
    const state = window.history.state as { marker?: string } | null; setDetail(null); setSelectedIssue(null);
    if (state?.marker === NORMALIZATION_ROW_DRAWER_MARKER) window.history.back(); else navigate({ row: null }, undefined, true);
    window.setTimeout(() => { if (focusReturn.current?.isConnected) focusReturn.current.focus(); else { const list = document.querySelector<HTMLElement>(query?.view === "issues" ? "#min-issues" : "#min-rows"); if (list) list.focus(); else mainTitle.current?.focus(); } }, 0);
  }, [navigate, query?.view]);

  const orderedBasic = useMemo(() => detail ? Object.entries(detail.normalized_payload.basic).sort(([left], [right]) => {
    const li = BASIC_ORDER.indexOf(left); const ri = BASIC_ORDER.indexOf(right); return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri) || left.localeCompare(right, "en");
  }) : [], [detail]);

  if (!summary || !query) return error ? <section className="min-consistency" role="alert"><h3>{error.status === 403 ? "当前账号没有访问或继续处理该导入批次的权限。" : error.status === 404 ? "导入批次不存在或无权查看。" : "暂时无法读取规范化状态"}</h3>{error.requestId ? <p>请求编号：{error.requestId}</p> : null}</section> : <section className="min-loading" role="status">正在读取规范化状态…</section>;
  const current = summary.current_run; const latest = summary.latest_attempt; const active = activeNormalizationRun(latest); const unknownOperation = Object.values(operations).find((item) => item?.status === "RESULT_UNKNOWN"); const unknown = Boolean(unknownOperation);
  const canStart = canNormalize && batch.status === "MAPPING_CONFIRMED" && !current && !active && !unknown;
  const canRetry = canNormalize && batch.status === "MAPPING_CONFIRMED" && !current && latest?.run_status === "FAILED" && !unknown;
  const canRerun = canNormalize && batch.status === "NORMALIZED" && current && !active && current.processor_version !== MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION && !unknown;
  const canStop = canCancel && ["QUEUED_FOR_NORMALIZATION", "NORMALIZING"].includes(batch.status) && active && !unknown;
  return <section className="min-review"><h2 ref={mainTitle} tabIndex={-1}>数据归一化与结果审阅</h2>
    <div className="min-live sr-only" aria-live="polite">{latest ? `${latest.run_status}：${normalizationStageLabel(latest.current_stage)}` : "数据归一化尚未启动"}</div>
    <nav className="min-tabs" aria-label="规范化工作区"><button aria-current={query.view === "normalize" ? "page" : undefined} onClick={() => navigate({ view: "normalize", row: null })}>数据归一化</button>{current ? <><button aria-current={query.view === "normalized" ? "page" : undefined} onClick={() => navigate({ view: "normalized", row: null })}>结果行</button><button aria-current={query.view === "issues" ? "page" : undefined} onClick={() => navigate({ view: "issues", row: null })}>Issues</button></> : null}<button onClick={() => window.location.assign(`/materials/imports/${batchId}?view=confirmed`)}>回看已确认 Mapping</button></nav>
    {unknownOperation ? <div className="min-banner min-banner-warning" role="alert"><strong>写入结果待确认</strong><p>请求已发送但未收到权威响应。当前只允许读取状态或用原 Key、Endpoint 与冻结 Body 安全重放。</p><button disabled={busy} onClick={() => void execute(unknownOperation.operation_type, undefined, true)}>使用原请求安全重试</button></div> : null}
    {notice ? <div className="min-banner" role="status">{notice}</div> : null}{error ? <div className="min-banner min-banner-error" role="alert"><strong>{error.status === 404 && query.row ? "该规范化行不存在或当前不可访问。" : error.message}</strong>{error.requestId ? <p>请求编号：{error.requestId}</p> : null}<button onClick={() => void refresh()}>手动刷新</button></div> : null}
    {latest && current && latest.id !== current.id && ["FAILED", "CANCELLED"].includes(latest.run_status) ? <div className="min-banner min-banner-warning"><strong>{latest.run_status === "FAILED" ? "最近一次重新运行未成功" : "最近一次重新运行已取消"}</strong><p>当前仍展示上一次已发布结果。</p></div> : null}
    {query.view === "normalize" ? <section className="min-normalize-panel">
      {latest && active ? <RunProgress run={latest} /> : !current ? <><h3>{latest?.run_status === "FAILED" ? "规范化任务未完成" : latest?.run_status === "CANCELLED" ? "首次数据归一化已取消" : "数据归一化尚未启动"}</h3><p>{latest?.safe_failure_message || "将生成只读候选快照；不会创建物料，结果可以包含 ERROR 行。"}</p></> : <><h3>当前结果已发布</h3><p>{current.processor_version === MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION ? "当前结果已使用本版本处理。" : "页面发布版本已变化，可以提供理由后重新运行。"}</p></>}
      <div className="min-actions"><button onClick={() => void refresh()} disabled={busy}>手动刷新</button>{canStart ? <button className="mi-primary" onClick={() => void prepare("START")} disabled={busy}>启动数据归一化</button> : null}{canRetry ? <button className="mi-primary" onClick={() => void prepare("START")} disabled={busy}>重试规范化</button> : null}{canRerun ? <button className="mi-primary" onClick={() => void prepare("RERUN")} disabled={busy}>重新运行规范化</button> : null}{canStop ? <button className="danger" onClick={() => void prepare("CANCEL")} disabled={busy}>取消任务</button> : null}</div>
    </section> : null}
    {current && query.view === "normalized" ? <><SummaryPanel run={current} /><section id="min-rows" className="min-list" tabIndex={-1}><h3>规范化结果行</h3><div className="min-filters"><label>行状态<select value={query.row_status} onChange={(event) => { setRows(null); setRowPrevious(false); navigate({ row_status: event.target.value as NormalizationQuery["row_status"], row_cursor: "", row: null }); }}><option value="">全部</option><option>VALID</option><option>WARNING</option><option>ERROR</option></select></label><label>每页<select value={query.row_limit} onChange={(event) => { setRows(null); setRowPrevious(false); navigate({ row_limit: Number(event.target.value) as 50 | 100, row_cursor: "", row: null }); }}><option value="50">50</option><option value="100">100</option></select></label></div>
      <div className="min-table-wrap"><table><caption>当前规范化 Run 的结果行</caption><thead><tr><th scope="col">Sheet</th><th scope="col">来源行</th><th scope="col">状态</th><th scope="col">Warning</th><th scope="col">Error</th><th scope="col">Raw Hash</th><th scope="col">操作</th></tr></thead><tbody>{rows?.items.map((row) => <tr key={row.id}><td>{row.source_sheet_index}</td><td>{row.source_row_number}</td><td><span className={`min-level min-level-${row.row_status.toLowerCase()}`}>{row.row_status}</span></td><td>{row.warning_count}</td><td>{row.error_count}</td><td><code>{shortDigest(row.source_raw_row_hash)}</code></td><td><button onClick={(event) => openRow(row.id, event.currentTarget)}>查看详情</button></td></tr>)}</tbody></table></div>{rows?.items.length === 0 ? <p>当前筛选条件下没有结果；这不表示全部校验通过。</p> : null}<div className="min-page-actions"><button disabled={!rowPrevious} onClick={() => window.history.back()}>上一页</button><button disabled={!rows?.next_cursor} onClick={() => { setRowPrevious(true); navigate({ row_cursor: rows!.next_cursor || "", row: null }, NORMALIZATION_ROW_PAGE_MARKER); }}>下一页</button></div></section></> : null}
    {current && query.view === "issues" ? <section id="min-issues" className="min-list" tabIndex={-1}><h3>Normalization Issues</h3><form key={`${query.issue_level}|${query.issue_code}|${query.issue_target}|${query.issue_row}|${query.issue_limit}`} className="min-filters" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const level = String(form.get("issue_level") || ""); const code = String(form.get("issue_code") || "").trim().toUpperCase(); const target = String(form.get("issue_target") || "").trim(); const rowText = String(form.get("issue_row") || "").trim(); const parsedRow = rowText ? strictPositiveInteger(rowText) : null; if ((code && !/^[A-Z][A-Z0-9_]{2,99}$/.test(code)) || (target && (target.length < 3 || target.length > 160)) || (rowText && parsedRow === null)) { setNotice("Issue 筛选值不符合 API 约束，未发送请求。"); return; } setNotice(""); setIssues(null); setIssuePrevious(false); navigate({ issue_level: ["ERROR", "WARNING"].includes(level) ? level as NormalizationQuery["issue_level"] : "", issue_code: code, issue_target: target, issue_row: parsedRow, issue_limit: form.get("issue_limit") === "100" ? 100 : 50, issue_cursor: "", row: null }); }}><label>Level<select name="issue_level" defaultValue={query.issue_level}><option value="">全部</option><option>ERROR</option><option>WARNING</option></select></label><label>Issue Code<input name="issue_code" defaultValue={query.issue_code} maxLength={100} /></label><label>Target Code<input name="issue_target" defaultValue={query.issue_target} maxLength={160} /></label><label>来源行<input name="issue_row" inputMode="numeric" defaultValue={query.issue_row ?? ""} /></label><label>每页<select name="issue_limit" defaultValue={String(query.issue_limit)}><option value="50">50</option><option value="100">100</option></select></label><div className="min-filter-actions"><button type="submit">应用筛选</button><button type="button" onClick={() => { setIssues(null); setIssuePrevious(false); navigate({ issue_level: "", issue_code: "", issue_target: "", issue_row: null, issue_limit: 50, issue_cursor: "", row: null }); }}>清除</button></div></form>
      {query.issue_row ? <p className="min-filter-note">该筛选可能同时包含其他 Sheet 中的相同行号。</p> : null}<div className="min-table-wrap"><table><caption>当前规范化 Run 的问题列表</caption><thead><tr><th scope="col">Level</th><th scope="col">问题</th><th scope="col">Sheet / 行 / 列</th><th scope="col">Target</th><th scope="col">安全说明</th><th scope="col">操作</th></tr></thead><tbody>{issues?.items.map((issue) => <tr key={issue.id}><td><span className={`min-level min-level-${issue.issue_level.toLowerCase()}`}>{issue.issue_level}</span></td><td id={`min-issue-${issue.id}`}><strong>{issueLabel(issue.issue_code)}</strong><br/><code>{issue.issue_code}</code></td><td>{issue.source_sheet_index} / {issue.source_row_number} / {issue.source_column_index ?? "—"}</td><td><code>{issue.target_code}</code></td><td><span className="min-message">{issue.safe_message.slice(0, 180)}</span>{issue.safe_message.length > 180 || safeIssueDetails(issue.safe_details).length ? <details><summary>查看有界详情</summary><p>{issue.safe_message.slice(0, 500)}</p><dl>{safeIssueDetails(issue.safe_details).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><BoundedValueView value={boundedValue(value)} /></dd></div>)}</dl></details> : null}</td><td><button aria-describedby={`min-issue-${issue.id}`} onClick={(event) => openRow(issue.normalized_row_id, event.currentTarget, issue)}>查看行</button></td></tr>)}</tbody></table></div>{issues?.items.length === 0 ? <p>当前筛选条件下没有 Issues；这不表示全部校验通过。</p> : null}<div className="min-page-actions"><button disabled={!issuePrevious} onClick={() => window.history.back()}>上一页</button><button disabled={!issues?.next_cursor} onClick={() => { setIssuePrevious(true); navigate({ issue_cursor: issues!.next_cursor || "", row: null }, NORMALIZATION_ISSUE_PAGE_MARKER); }}>下一页</button></div></section> : null}
    {query.row && detail ? <FocusTrap labelledBy="min-drawer-title" onClose={closeDrawer}><header><h3 id="min-drawer-title" tabIndex={-1}>行详情：Sheet {detail.row.source_sheet_index} / 来源行 {detail.row.source_row_number} / {detail.row.row_status}</h3><button onClick={closeDrawer} aria-label="关闭行详情">关闭</button></header><div className="min-drawer-body"><section><h4>行概览</h4><dl className="min-inline-facts"><div><dt>状态</dt><dd>{detail.row.row_status}</dd></div><div><dt>Warning</dt><dd>{detail.row.warning_count}</dd></div><div><dt>Error</dt><dd>{detail.row.error_count}</dd></div><div><dt>Raw Hash</dt><dd>{shortDigest(detail.row.source_raw_row_hash)}</dd></div></dl></section><section><h4>Basic 字段</h4>{orderedBasic.length ? orderedBasic.map(([code, value]) => <CandidateCard key={code} label={code} candidate={value} />) : <p>未生成 Basic 候选。</p>}</section><section><h4>动态属性</h4><p>当前结果未保存历史显示名称，以下使用稳定 Attribute Code。</p>{Object.entries(detail.normalized_payload.attributes).sort(([a], [b]) => a.localeCompare(b, "en")).map(([code, value]) => <CandidateCard key={code} label={code} candidate={value} />)}</section><section><h4>分类提示（非正式分类）</h4><p>该提示不是 category_id，也未通过分类绑定校验。</p><CandidateCard label="CATEGORY_HINT" candidate={detail.normalized_payload.category_hint} /></section><section><h4>供应商引用候选</h4><p>候选不等于内部 Material ID 或正式 Supplier ID，也不会创建关联。</p>{Object.entries(detail.normalized_payload.supplier_reference).map(([code, value]) => <CandidateCard key={code} label={code} candidate={value} />)}</section><section><h4>延后校验</h4>{detail.normalized_payload.deferred_validation.length ? <ul>{detail.normalized_payload.deferred_validation.map((code) => <li key={code}>{DEFERRED_LABELS[code] || `后续校验提示（${code}）`}</li>)}</ul> : <p>当前结果未列出延后校验；不能据此声称全部校验通过。</p>}</section><section><h4>Issue 上下文</h4><p>{detail.normalized_payload.issue_summary.issue_count} 个问题摘要：{detail.normalized_payload.issue_summary.error_count} ERROR / {detail.normalized_payload.issue_summary.warning_count} WARNING</p>{selectedIssue ? <article><strong>当前选中问题：{issueLabel(selectedIssue.issue_code)}</strong><p>{selectedIssue.safe_message.slice(0, 500)}</p></article> : <p>刷新或直接 URL 不恢复所选 Issue 正文。</p>}<button onClick={() => { closeDrawer(); navigate({ view: "issues", issue_row: detail.row.source_row_number, issue_cursor: "", row: null }); }}>按来源行查看问题</button><p>该筛选可能同时包含其他 Sheet 中的相同行号；V1 不显示“该行全部 Issues”。</p></section><section><h4>Lineage 与支持信息</h4><dl className="min-run-facts">{Object.entries(detail.normalized_payload.lineage).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{key.includes("digest") || key.includes("hash") ? shortDigest(value) : String(value)}</dd></div>)}</dl></section></div></FocusTrap> : null}
    {dialog === "START" ? <MaterialImportDialog title="启动数据归一化" busy={busy} primaryLabel="确认启动" onClose={() => setDialog(null)} onPrimary={() => void execute("NORMALIZE", { expected_version: batch.current_version, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION })}><ul><li>生成规范化候选快照，结果可能包含 ERROR 行。</li><li>不执行公式，不调用 AI，不自动分类或判断重复物料。</li><li>不创建 Material Draft，也不生成正式编码。</li></ul></MaterialImportDialog> : null}
    {dialog === "RERUN" ? <MaterialImportDialog title="重新运行规范化" busy={busy} primaryLabel="确认重新运行" onClose={() => setDialog(null)} onPrimary={() => { const reason = rerunReason.trim(); if (reason && reason.length <= 500 && !/[\u0000-\u001f\u007f]/.test(reason)) void execute("NORMALIZE", { expected_version: batch.current_version, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, rerun_reason: reason }); else setNotice("重跑理由必须为 1–500 个可见字符。"); }}><p>新结果发布前保留旧 Current Run；不修改原始行或 Mapping，不创建 Material Draft。</p><label>重跑理由（必填，1–500）<textarea value={rerunReason} maxLength={500} onChange={(event) => setRerunReason(event.target.value)} /></label></MaterialImportDialog> : null}
    {dialog === "CANCEL" ? <MaterialImportDialog title="取消数据归一化" danger busy={busy} primaryLabel="确认取消" onClose={() => setDialog(null)} onPrimary={() => void execute("CANCEL", { expected_version: batch.current_version, reason_code: "USER_CANCELLED" })}><p>后台任务可能短暂继续，但取消胜出后不会发布该 Attempt 的暂存结果。重跑取消胜出时保留上一次已发布结果。</p></MaterialImportDialog> : null}
  </section>;
}
