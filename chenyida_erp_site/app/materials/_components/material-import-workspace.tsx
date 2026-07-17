"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { formatShanghaiDate } from "../_lib/material-ui";
import {
  createImportWriteOperation, normalizeImportUiError, parseImportWorkspaceQuery,
  serializeImportWorkspaceQuery, stableImportStringify, type ImportMappingItem, type ImportMappingTarget, type ImportUiError,
  type ImportWorkspaceQuery, type ImportWriteOperation, type MaterialImportBatch, type MaterialImportFileSummary, type MaterialImportView,
} from "../_lib/material-import";
import { MaterialImportPollingController } from "../_lib/material-import-polling";
import { redirectToExistingLogin, useMaterialSession } from "./material-shell";
import { MaterialImportUploadFlow } from "./material-import-create-page";
import { MaterialImportMappingEditor, MaterialImportMappingPreview } from "./material-import-mapping-editor";
import { MaterialImportNormalizationReview } from "./material-import-normalization-review";
import { MaterialImportRowPreview, MaterialImportSheetSelector, type MaterialImportRow, type MaterialImportSheet } from "./material-import-row-preview";
import { MaterialImportDialog, MaterialImportErrorState, MaterialImportStatusBadge, MaterialImportStepper, useMaterialImportUnsavedGuard } from "./material-import-primitives";

type DetailResponse = { request_id?: string; data: { batch: MaterialImportBatch; file: MaterialImportFileSummary | null } };
type SheetsResponse = { request_id?: string; batch_id: number; batch_status: string; current_version: number; parse_run_id: number; parser_version: string; mapping_preparation_status: string; workbook_summary: Record<string, number>; sheets: MaterialImportSheet[] };
type RowsResponse = { request_id?: string; batch_id: number; parse_run_id: number; sheet_index: number; rows: MaterialImportRow[]; page: number; page_size: number; total_rows: number };
type MappingAggregate = { id: number; batch_id: number; parse_run_id: number; selected_sheet_index: number; header_mode: "SINGLE_ROW" | "NO_HEADER"; header_row_number: number | null; mapping_status: string; mapping_version: number; metadata_digest: string; items: ImportMappingItem[] };
type MappingResponse = { request_id?: string; batch_id: number; batch_status: string; current_version: number; mapping: MappingAggregate };
type CatalogResponse = { request_id?: string; batch_id: number; parse_run_id: number; metadata_digest: string; items: ImportMappingTarget[]; next_cursor: string | null };
type PreviewResponse = { request_id?: string; batch_id: number; parse_run_id: number; sampled_row_count: number; rows: { row_number: number; values: { target_namespace: string; target_code: string; source_column_index: number | null; status: string; raw_value: unknown; candidate_value: unknown; issues: { code: string; message: string }[] }[] }[] };
type PreviewBinding = { batchId: number; parseRunId: number; batchVersion: number; mappingId: number; mappingVersion: number; payloadDigest: string; metadataDigest: string; response: PreviewResponse };

const CANCEL_STATES = new Set(["CREATED", "UPLOAD_PENDING", "FILE_READY", "QUEUED_FOR_PARSING", "PARSING"]);

export function MaterialImportWorkspace({ batchId }: { batchId: number }) {
  const session = useMaterialSession(); const permissions = session.user?.permissions || [];
  const canRead = permissions.includes("material.import.read") || permissions.includes("material.import.read_any"); const canMap = permissions.includes("material.import.map"); const canParse = permissions.includes("material.import.parse"); const canCancel = permissions.includes("material.import.cancel");
  const [batch, setBatch] = useState<MaterialImportBatch | null>(null); const [file, setFile] = useState<MaterialImportFileSummary | null>(null);
  const [query, setQuery] = useState<ImportWorkspaceQuery>({ view: "file", sheet: null, row_page: 1, row_page_size: 50 });
  const [sheetsData, setSheetsData] = useState<SheetsResponse | null>(null); const [rowsData, setRowsData] = useState<RowsResponse | null>(null); const [mapping, setMapping] = useState<MappingAggregate | null>(null);
  const [items, setItems] = useState<ImportMappingItem[]>([]); const [headerMode, setHeaderMode] = useState<"SINGLE_ROW" | "NO_HEADER">("NO_HEADER"); const [headerRow, setHeaderRow] = useState<number | null>(null); const [formalSheet, setFormalSheet] = useState<number | null>(null);
  const [targets, setTargets] = useState<ImportMappingTarget[]>([]); const [catalogQuery, setCatalogQuery] = useState(""); const [catalogCursor, setCatalogCursor] = useState<string | null>(null); const [catalogDigest, setCatalogDigest] = useState("");
  const [preview, setPreview] = useState<PreviewBinding | null>(null); const [loading, setLoading] = useState(true); const [rowsLoading, setRowsLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImportUiError | null>(null); const [notice, setNotice] = useState(""); const [dialog, setDialog] = useState<"PARSE" | "CANCEL" | "CONFIRM" | null>(null);
  const [polling] = useState(() => new MaterialImportPollingController()); const [operations, setOperations] = useState<Record<string, ImportWriteOperation>>({});
  const [mappingBaseline, setMappingBaseline] = useState(""); const loadSequence = useRef(0);
  const dirty = mapping ? stableImportStringify({ selected_sheet_index: formalSheet, header_mode: headerMode, header_row_number: headerRow, items }) !== mappingBaseline : false;
  const resultUnknown = Object.values(operations).some((operation) => operation.state === "RESULT_UNKNOWN");
  useMaterialImportUnsavedGuard(dirty || resultUnknown || Boolean(file && batch?.status === "CREATED"));

  const clearProtected = useCallback(() => { setBatch(null); setFile(null); setSheetsData(null); setRowsData(null); setMapping(null); setItems([]); setTargets([]); setPreview(null); setOperations({}); polling.stop(); }, [polling]);
  const handleError = useCallback((reason: unknown, protectedRead = false) => {
    const normalized = normalizeImportUiError(reason);
    if (normalized.status === 401) { polling.stop(); redirectToExistingLogin(); return; }
    if ([403, 404].includes(normalized.status) && protectedRead) clearProtected();
    setError(normalized);
  }, [clearProtected, polling]);

  const readDetail = useCallback(async (signal?: AbortSignal) => {
    const response = await api<DetailResponse>(`/api/material-master/import-batches/${batchId}`, { cache: "no-store", signal });
    return response.data;
  }, [batchId]);
  const readSheets = useCallback(async (signal?: AbortSignal) => api<SheetsResponse>(`/api/material-master/import-batches/${batchId}/sheets`, { cache: "no-store", signal }), [batchId]);

  const applyBatch = useCallback((detail: DetailResponse["data"], sheets?: SheetsResponse | null) => {
    setBatch(detail.batch); setFile(detail.file); setError(null); if (sheets) setSheetsData(sheets);
    const parsed = parseImportWorkspaceQuery(window.location.search, detail.batch.status);
    if (sheets) {
      const visible = sheets.sheets.filter((item) => item.visibility === "VISIBLE" && item.parse_disposition === "PARSED");
      if (parsed.sheet === null || !visible.some((item) => item.sheet_index === parsed.sheet)) parsed.sheet = visible[0]?.sheet_index ?? null;
    }
    const normalizationView = ["normalize", "normalized", "issues"].includes(parsed.view);
    const canonical = `/materials/imports/${batchId}?${serializeImportWorkspaceQuery(parsed)}`;
    if (!normalizationView && `${window.location.pathname}${window.location.search}` !== canonical) window.history.replaceState({}, "", canonical);
    setQuery(parsed);
  }, [batchId]);

  const initialLoad = useCallback(async () => {
    if (!canRead) return; const sequence = ++loadSequence.current; setLoading(true);
    try {
      const detail = await readDetail(); let sheets: SheetsResponse | null = null;
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (["PARSED", "AWAITING_MAPPING"].includes(detail.batch.status) || (detail.batch.status === "MAPPING_CONFIRMED" && ["sheet", "mapping", "confirmed"].includes(requestedView || "")) || (["QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED"].includes(detail.batch.status) && requestedView === "confirmed")) sheets = await readSheets();
      if (sequence === loadSequence.current) applyBatch(detail, sheets);
    } catch (reason) { if (sequence === loadSequence.current) handleError(reason, true); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [applyBatch, canRead, handleError, readDetail, readSheets]);

  useEffect(() => { const timer = window.setTimeout(() => void initialLoad(), 0); return () => window.clearTimeout(timer); }, [initialLoad]);
  useEffect(() => {
    if (!canRead) return;
    polling.start(batchId, async (_id, signal) => {
      const detail = await readDetail(signal); let sheets: SheetsResponse | null = null;
      if (detail.batch.status === "PARSED") sheets = await readSheets(signal);
      return { batch: detail.batch, preparation: sheets?.mapping_preparation_status, detail, sheets } as never;
    }, { onData: (value) => { const result = value as unknown as { detail: DetailResponse["data"]; sheets: SheetsResponse | null }; applyBatch(result.detail, result.sheets); }, onError: (reason) => handleError(reason, true) });
    return () => polling.stop();
  }, [applyBatch, batchId, canRead, handleError, polling, readDetail, readSheets]);

  const navigate = useCallback((patch: Partial<ImportWorkspaceQuery>, mode: "push" | "replace" = "push") => {
    if (!batch) return; const next = { ...query, ...patch }; const url = `/materials/imports/${batchId}?${serializeImportWorkspaceQuery(next)}`;
    window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url); setQuery(next);
  }, [batch, batchId, query]);
  useEffect(() => { const pop = () => batch && setQuery(parseImportWorkspaceQuery(window.location.search, batch.status)); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, [batch]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!batch || !sheetsData || query.sheet === null) { setRowsData(null); return; }
      const selected = sheetsData.sheets.find((item) => item.sheet_index === query.sheet); if (!selected || selected.visibility !== "VISIBLE") return;
      setRowsLoading(true);
      api<RowsResponse>(`/api/material-master/import-batches/${batchId}/rows?sheet_index=${query.sheet}&page=${query.row_page}&page_size=${query.row_page_size}`, { cache: "no-store", signal: controller.signal })
        .then(setRowsData).catch((reason) => { if ((reason as { name?: string })?.name !== "AbortError") handleError(reason, true); }).finally(() => setRowsLoading(false));
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [batch, batchId, handleError, query.row_page, query.row_page_size, query.sheet, sheetsData]);

  const loadMapping = useCallback(async () => {
    if (!batch || !["AWAITING_MAPPING", "MAPPING_CONFIRMED", "QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED"].includes(batch.status) || (batch.status === "MAPPING_CONFIRMED" && query.view === "normalize") || (!["AWAITING_MAPPING", "MAPPING_CONFIRMED"].includes(batch.status) && query.view !== "confirmed")) return;
    try {
      const response = await api<MappingResponse>(`/api/material-master/import-batches/${batchId}/mapping`, { cache: "no-store" }); const value = response.mapping;
      setMapping(value); setItems(value.items); setFormalSheet(value.selected_sheet_index); setHeaderMode(value.header_mode); setHeaderRow(value.header_row_number);
      setMappingBaseline(stableImportStringify({ selected_sheet_index: value.selected_sheet_index, header_mode: value.header_mode, header_row_number: value.header_row_number, items: value.items })); setPreview(null);
      if (query.sheet === null) navigate({ sheet: value.selected_sheet_index, row_page: 1 }, "replace");
    } catch (reason) { handleError(reason, true); }
  }, [batch, batchId, handleError, navigate, query.sheet, query.view]);
  useEffect(() => { const timer = window.setTimeout(() => void loadMapping(), 0); return () => window.clearTimeout(timer); }, [loadMapping]);

  const loadCatalog = useCallback(async (append = false) => {
    if (!batch || batch.status !== "AWAITING_MAPPING" || !canMap) return;
    const params = new URLSearchParams({ limit: "50" }); if (catalogQuery.trim()) params.set("q", catalogQuery.trim()); if (append && catalogCursor) params.set("cursor", catalogCursor);
    try {
      const response = await api<CatalogResponse>(`/api/material-master/import-batches/${batchId}/mapping-targets?${params}`, { cache: "no-store" });
      setTargets((current) => append ? [...current, ...response.items] : response.items); setCatalogCursor(response.next_cursor); setCatalogDigest(response.metadata_digest);
      if (mapping && response.metadata_digest !== mapping.metadata_digest) setPreview(null);
    } catch (reason) { handleError(reason, true); }
  }, [batch, batchId, canMap, catalogCursor, catalogQuery, handleError, mapping]);
  useEffect(() => { const timer = setTimeout(() => void loadCatalog(false), 250); return () => clearTimeout(timer); }, [catalogQuery, batch?.status, canMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const write = async <T,>(type: ImportWriteOperation["type"], endpoint: string, method: "POST" | "PUT", payload: Record<string, unknown>): Promise<T> => {
    let operation = operations[type];
    if (!operation || operation.payloadDigest !== stableImportStringify(payload) || operation.endpoint !== endpoint) operation = createImportWriteOperation({ type, key: crypto.randomUUID(), method, endpoint, payload });
    setOperations((current) => ({ ...current, [type]: { ...operation, state: "PENDING" } }));
    try {
      const response = await api<T>(endpoint, { method, body: JSON.stringify(operation.payload), protectedWrite: { idempotencyKey: operation.key, csrfToken: session.csrf_token || "" } }); setOperations((current) => ({ ...current, [type]: { ...operation, state: "COMPLETED" } })); return response;
    } catch (reason) {
      const normalized = normalizeImportUiError(reason); setOperations((current) => ({ ...current, [type]: { ...operation, state: normalized.resultUnknown ? "RESULT_UNKNOWN" : "FAILED" } }));
      if (normalized.resultUnknown) setNotice(`${type} 操作结果尚未确认；依赖操作已锁定，只能用原 Key 与载荷恢复。`); throw reason;
    }
  };

  const startParse = async () => {
    if (!batch || !canParse || busy || resultUnknown) return; setBusy(true); setNotice("");
    try { const latest = await readDetail(); if (latest.batch.status !== "FILE_READY" || latest.file?.security_check_status !== "BASIC_CHECK_PASSED") throw new Error("STALE"); applyBatch(latest); setDialog("PARSE"); }
    catch (reason) { handleError(reason); } finally { setBusy(false); }
  };
  const confirmParse = async () => {
    if (!batch) return; setBusy(true);
    try { await write("PARSE", `/api/material-master/import-batches/${batchId}/parse`, "POST", { expected_version: batch.current_version, parser_version: "material-import-parser-v1" }); setDialog(null); await initialLoad(); }
    catch (reason) { handleError(reason); } finally { setBusy(false); }
  };
  const cancelBatch = async () => {
    if (!batch) return; setBusy(true);
    try { const latest = await readDetail(); await write("CANCEL", `/api/material-master/import-batches/${batchId}/cancel`, "POST", { expected_version: latest.batch.current_version, reason_code: "USER_CANCELLED" }); setDialog(null); await initialLoad(); }
    catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  const draftPayload = useCallback(() => ({ selected_sheet_index: formalSheet, header_mode: headerMode, header_row_number: headerMode === "SINGLE_ROW" ? headerRow : null, items }), [formalSheet, headerMode, headerRow, items]);
  const saveMapping = async () => {
    if (!batch || !mapping || formalSheet === null || busy || resultUnknown) return; setBusy(true);
    const payload = { expected_version: batch.current_version, parse_run_id: mapping.parse_run_id, expected_mapping_version: mapping.mapping_version, ...draftPayload() };
    try { const response = await write<MappingResponse>("SAVE", `/api/material-master/import-batches/${batchId}/mapping`, "PUT", payload); const value = response.mapping; setMapping(value); setItems(value.items); setFormalSheet(value.selected_sheet_index); setHeaderMode(value.header_mode); setHeaderRow(value.header_row_number); setMappingBaseline(stableImportStringify({ selected_sheet_index: value.selected_sheet_index, header_mode: value.header_mode, header_row_number: value.header_row_number, items: value.items })); setPreview(null); setNotice("Mapping 已保存；请重新预览后再确认。"); await loadMapping(); }
    catch (reason) { handleError(reason); } finally { setBusy(false); }
  };
  const previewMapping = async () => {
    if (!batch || !mapping || dirty || busy || resultUnknown) return; setBusy(true); const draft = draftPayload();
    const payload = { expected_version: batch.current_version, parse_run_id: mapping.parse_run_id, mapping: draft, start_row: headerMode === "SINGLE_ROW" && headerRow ? headerRow + 1 : 1, row_limit: 20 };
    try { const response = await write<PreviewResponse>("PREVIEW", `/api/material-master/import-batches/${batchId}/mapping/preview`, "POST", payload); setPreview({ batchId, parseRunId: mapping.parse_run_id, batchVersion: batch.current_version, mappingId: mapping.id, mappingVersion: mapping.mapping_version, payloadDigest: stableImportStringify(draft), metadataDigest: catalogDigest || mapping.metadata_digest, response }); setNotice("已建立当前页面会话的最新有界预览。"); }
    catch (reason) { handleError(reason); } finally { setBusy(false); }
  };
  const prepareConfirm = async () => {
    if (!batch || !mapping || !preview || dirty || busy) return; setBusy(true);
    try {
      const [latest, latestMapping, latestSheets] = await Promise.all([readDetail(), api<MappingResponse>(`/api/material-master/import-batches/${batchId}/mapping`, { cache: "no-store" }), readSheets()]);
      const catalog = await api<CatalogResponse>(`/api/material-master/import-batches/${batchId}/mapping-targets?limit=50`, { cache: "no-store" });
      const valid = latest.batch.status === "AWAITING_MAPPING" && latest.batch.current_version === preview.batchVersion && latestMapping.mapping.mapping_version === preview.mappingVersion && latestMapping.mapping.parse_run_id === preview.parseRunId && latestSheets.parse_run_id === preview.parseRunId && catalog.metadata_digest === preview.metadataDigest && preview.payloadDigest === stableImportStringify(draftPayload());
      if (!valid) { setPreview(null); throw new ErpApiError("服务端版本、parse run 或 Catalog 已变化，请重新保存和预览", { status: 409, code: "IMPORT_MAPPING_VERSION_CONFLICT" }); }
      setDialog("CONFIRM");
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  };
  const confirmMapping = async () => {
    if (!batch || !mapping || !preview) return; setBusy(true);
    try { await write("CONFIRM", `/api/material-master/import-batches/${batchId}/mapping/confirm`, "POST", { expected_version: batch.current_version, parse_run_id: mapping.parse_run_id, mapping_id: mapping.id, expected_mapping_version: mapping.mapping_version, metadata_digest: preview.metadataDigest }); setDialog(null); setPreview(null); await initialLoad(); }
    catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  if (!canRead) return <MaterialImportErrorState title="没有导入读取权限" message="当前账号没有 material.import.read，页面不会请求批次正文。" />;
  if (loading && !batch) return <div className="mm-shell-loading" role="status">正在加载导入工作区…</div>;
  if (error && !batch) return <MaterialImportErrorState message={error.status === 404 ? "导入批次不存在或无权查看" : error.status === 403 ? "当前账号无权继续查看该导入批次" : "暂时无法加载导入工作区"} requestId={error.requestId} clearProtected={[403,404].includes(error.status)} onRetry={() => void initialLoad()} />;
  if (!batch) return null;
  const selectedSheet = sheetsData?.sheets.find((item) => item.sheet_index === query.sheet) || null; const mappingReadOnly = batch.status !== "AWAITING_MAPPING" || !canMap;
  const previewValid = Boolean(preview && mapping && preview.batchVersion === batch.current_version && preview.mappingVersion === mapping.mapping_version && preview.payloadDigest === stableImportStringify(draftPayload()) && preview.metadataDigest === (catalogDigest || mapping.metadata_digest));
  const statusPage = ["FAILED", "CANCELLED", "RECONCILIATION_REQUIRED"].includes(batch.status);
  return <section className="mi-workspace"><div className="mm-breadcrumb"><Link href="/materials">物料主数据</Link><span>/</span><Link href="/materials/imports">导入批次</Link><span>/</span><span>{batch.batch_no}</span></div>
    <header className="mi-workspace-head"><div><h2>{batch.batch_no}</h2><p>{batch.source_kind} · 创建人 {batch.created_by} · 最近更新 {formatShanghaiDate(batch.updated_at, true)}</p></div><div><MaterialImportStatusBadge value={batch.status} /><button disabled={busy} onClick={() => void initialLoad()}>手动刷新</button>{canCancel && CANCEL_STATES.has(batch.status) && !resultUnknown ? <button className="danger" disabled={busy} onClick={() => setDialog("CANCEL")}>取消批次</button> : null}</div></header>
    <MaterialImportStepper status={batch.status} view={query.view} canMap={canMap} onView={(view: MaterialImportView) => navigate({ view })} />
    {notice ? <div className="mi-notice" role="status">{notice}</div> : null}{error && batch ? <div className="mi-inline-error" role="alert">{error.message}{error.requestId ? `（请求编号：${error.requestId}）` : ""}</div> : null}
    {statusPage ? <section className="mi-disposition"><h3>{batch.status === "FAILED" ? "导入批次失败" : batch.status === "CANCELLED" ? "批次已取消" : "当前批次需要后台协调"}</h3><p>{batch.failure_message || (batch.status === "RECONCILIATION_REQUIRED" ? "普通用户暂时不能继续上传或解析，请刷新或联系管理员。" : "该批次不能继续执行后续写操作。")}</p>{batch.failure_code ? <p>安全错误代码：{batch.failure_code}</p> : null}</section> : null}
    {!statusPage && ["CREATED", "UPLOAD_PENDING"].includes(batch.status) ? <section><h3>文件</h3>{batch.status === "CREATED" ? <><p>重新打开的 CREATED 批次不会恢复浏览器 File；请重新选择、预检并计算 SHA。</p><MaterialImportUploadFlow existingBatch={batch} /></> : <p>文件上传或服务端处理正在进行。若此前上传结果未知，只能在原页面使用原操作标识恢复。</p>}</section> : null}
    {!statusPage && ["FILE_READY", "QUEUED_FOR_PARSING", "PARSING"].includes(batch.status) ? <section className="mi-parse-panel"><h3>解析</h3><p>{batch.status === "FILE_READY" ? "文件已通过服务端基础安全检查，可启动解析。" : batch.status === "QUEUED_FOR_PARSING" ? "解析请求排队中；不提供 Queue 位置或预计完成时间。" : "服务端正在解析；当前 API 不公开百分比、阶段、行数或 ETA。"}</p><p>最近更新时间：{formatShanghaiDate(batch.updated_at, true)}</p>{batch.status === "FILE_READY" && canParse ? <button className="mi-primary" disabled={busy || file?.security_check_status !== "BASIC_CHECK_PASSED" || resultUnknown} onClick={() => void startParse()}>启动解析</button> : null}</section> : null}
    {!statusPage && (["PARSED", "AWAITING_MAPPING", "MAPPING_CONFIRMED"].includes(batch.status) || (["QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED"].includes(batch.status) && query.view === "confirmed")) && sheetsData ? <>
      {batch.status === "PARSED" ? <div className={`mi-preparation mi-preparation-${sheetsData.mapping_preparation_status.toLowerCase()}`}>{sheetsData.mapping_preparation_status === "FAILED" ? "解析结果已发布，但字段映射准备失败" : `解析结果已发布，字段映射准备状态：${sheetsData.mapping_preparation_status}`}</div> : null}
      <section className="mi-sheet-workspace"><MaterialImportSheetSelector sheets={sheetsData.sheets} selected={query.sheet} onSelect={(sheet) => navigate({ sheet: sheet.sheet_index, row_page: 1, view: "sheet" })} />
        {selectedSheet && rowsData ? <MaterialImportRowPreview rows={rowsData.rows} columnCount={selectedSheet.source_column_max} page={query.row_page} pageSize={query.row_page_size} totalRows={rowsData.total_rows} loading={rowsLoading} onPage={(row_page) => navigate({ row_page })} onPageSize={(row_page_size) => navigate({ row_page_size, row_page: 1 })} /> : null}
      </section>
      {batch.status === "AWAITING_MAPPING" && mapping ? <section className="mi-header-panel"><h3>正式 Sheet 与表头</h3><label>来源 Sheet<select value={formalSheet ?? ""} disabled={!canMap || busy} onChange={(e) => { if (dirty && !window.confirm("切换 Sheet 会清除当前未保存 Mapping，是否继续？")) return; setFormalSheet(Number(e.target.value)); setItems([]); setPreview(null); navigate({ sheet: Number(e.target.value), row_page: 1 }); }}><option value="" disabled>请选择</option>{sheetsData.sheets.filter((item) => item.visibility === "VISIBLE" && item.parse_disposition === "PARSED").map((item) => <option value={item.sheet_index} key={item.sheet_index}>{item.sheet_index} · {item.sheet_name}</option>)}</select></label><fieldset disabled={!canMap || busy}><legend>表头模式</legend><label><input type="radio" checked={headerMode === "SINGLE_ROW"} onChange={() => { if (dirty && !window.confirm("切换表头会使当前 Mapping 编辑失效，是否继续？")) return; setHeaderMode("SINGLE_ROW"); setHeaderRow(selectedSheet?.header_suggestions[0]?.row_number || 1); setItems([]); setPreview(null); }} /> SINGLE_ROW</label><label><input type="radio" checked={headerMode === "NO_HEADER"} onChange={() => { if (dirty && !window.confirm("切换表头会使当前 Mapping 编辑失效，是否继续？")) return; setHeaderMode("NO_HEADER"); setHeaderRow(null); setItems([]); setPreview(null); }} /> NO_HEADER</label>{headerMode === "SINGLE_ROW" ? <label>表头行<input type="number" min="1" max={selectedSheet?.parsed_row_count || 1} value={headerRow || 1} onChange={(e) => { setHeaderRow(Number(e.target.value)); setPreview(null); }} /></label> : <p>将使用 COLUMN_A…COLUMN_IV 稳定展示标签；不会冒充数据库字段名。</p>}</fieldset></section> : null}
      {mapping && formalSheet !== null && (query.view === "mapping" || query.view === "confirmed") ? <MaterialImportMappingEditor columnCount={sheetsData.sheets.find((item) => item.sheet_index === formalSheet)?.source_column_max || 0} rows={rowsData?.sheet_index === formalSheet ? rowsData.rows : []} headerMode={headerMode} headerRow={headerRow} targets={targets} catalogQuery={catalogQuery} catalogHasMore={Boolean(catalogCursor)} items={items} dirty={dirty} readOnly={mappingReadOnly} busy={busy || resultUnknown} previewValid={previewValid} onCatalogQuery={(value) => { setCatalogQuery(value); setCatalogCursor(null); }} onCatalogMore={() => void loadCatalog(true)} onItems={(value) => { setItems(value); setPreview(null); }} onReset={() => { setItems(mapping.items); setFormalSheet(mapping.selected_sheet_index); setHeaderMode(mapping.header_mode); setHeaderRow(mapping.header_row_number); setPreview(null); }} onSave={() => void saveMapping()} onPreview={() => void previewMapping()} onConfirm={() => void prepareConfirm()} /> : null}
      {preview?.response && query.view === "mapping" ? <MaterialImportMappingPreview rows={preview.response.rows} /> : null}
      {batch.status === "MAPPING_CONFIRMED" && query.view === "confirmed" ? <section className="mi-confirmed"><h3>字段映射已确认</h3><p>这里只表示字段对应关系已确认，不代表物料已创建。页面不显示 API 未提供的确认人或确认时间，也不提供“开始正式导入”。</p></section> : null}
    </> : null}
    {["MAPPING_CONFIRMED", "QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED"].includes(batch.status) && ["normalize", "normalized", "issues"].includes(query.view) ? <MaterialImportNormalizationReview batchId={batchId} batch={batch} permissions={permissions} csrfToken={session.csrf_token || ""} onBatch={setBatch} /> : null}
    {dialog === "PARSE" ? <MaterialImportDialog title="启动文件解析" busy={busy} primaryLabel="确认启动解析" onClose={() => setDialog(null)} onPrimary={() => void confirmParse()}><ul><li>公式不会执行。</li><li>隐藏 Sheet 不用于业务行或 Mapping。</li><li>不会创建 Material Draft 或正式编码。</li><li>解析可能需要一定时间，页面只显示服务端真实粗粒度状态。</li></ul></MaterialImportDialog> : null}
    {dialog === "CANCEL" ? <MaterialImportDialog title="取消导入批次" danger busy={busy} primaryLabel="确认取消" onClose={() => setDialog(null)} onPrimary={() => void cancelBatch()}><p>{batch.status === "PARSING" ? "这是协作式取消，后台可短暂继续计算，但成功后旧任务不得发布。" : batch.status === "QUEUED_FOR_PARSING" ? "取消不承诺物理删除 Queue 消息，只阻止尚未完成的结果发布。" : batch.status === "UPLOAD_PENDING" ? "取消不表示对象立即删除，服务端会按协调和清理策略处理。" : "服务端将使用最新版本决定是否仍可取消。"}</p></MaterialImportDialog> : null}
    {dialog === "CONFIRM" ? <MaterialImportDialog title="最终确认字段 Mapping" busy={busy} primaryLabel="确认 Mapping" onClose={() => setDialog(null)} onPrimary={() => void confirmMapping()}><p>本操作只确认字段对应关系，不创建 Material Draft、正式物料或编码，不执行清洗、分类、匹配、去重或 AI。服务端仍会重新核对状态、版本、parse run 与 metadata。</p></MaterialImportDialog> : null}
  </section>;
}
