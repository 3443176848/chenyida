export const MATERIAL_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const MATERIAL_IMPORT_PARSER_VERSION = "material-import-parser-v1";

export const IMPORT_BATCH_STATUSES = [
  "CREATED", "UPLOAD_PENDING", "FILE_READY", "QUEUED_FOR_PARSING", "PARSING", "PARSED",
  "AWAITING_MAPPING", "MAPPING_CONFIRMED", "QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED",
  "RECONCILIATION_REQUIRED", "FAILED", "CANCELLED",
] as const;
export type MaterialImportBatchStatus = typeof IMPORT_BATCH_STATUSES[number];
export type MaterialImportView = "file" | "parse" | "sheet" | "mapping" | "confirmed" | "normalize" | "normalized" | "issues" | "review";

export type MaterialImportFileSummary = {
  id: number; original_filename: string; filename_extension: string | null; declared_mime_type: string | null;
  declared_sha256: string; declared_size_bytes: number | null; detected_file_type: string | null;
  actual_sha256: string | null; actual_size_bytes: number | null; storage_status: string;
  security_check_status: string; security_failure_code: string | null; security_failure_message: string | null;
};

export type MaterialImportBatch = {
  id: number; batch_no: string; source_kind: "XLSX" | "CSV"; status: MaterialImportBatchStatus;
  retry_of_batch_id: number | null; created_by: string; current_version: number; file_count: number;
  total_rows: number; accepted_rows: number; rejected_rows: number; failure_stage: string | null;
  failure_code: string | null; failure_message: string | null; created_at: string; updated_at: string;
  file?: MaterialImportFileSummary | null;
};

export type ImportListQuery = {
  status: string; source_kind: string; created_by_me: "true" | "false"; sort: "created_at_desc" | "created_at_asc";
  limit: 20 | 50; cursor: string;
};

export const DEFAULT_IMPORT_LIST_QUERY: ImportListQuery = {
  status: "", source_kind: "", created_by_me: "true", sort: "created_at_desc", limit: 50, cursor: "",
};

const STATUS_SET = new Set<string>(IMPORT_BATCH_STATUSES);
const VIEW_SET = new Set<MaterialImportView>(["file", "parse", "sheet", "mapping", "confirmed", "normalize", "normalized", "issues", "review"]);

function positiveInteger(value: string | null, fallback: number): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function parseImportListQuery(input: string | URLSearchParams): ImportListQuery {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const status = String(params.get("status") || "");
  const source = String(params.get("source_kind") || "");
  const mine = String(params.get("created_by_me") || "true");
  const sort = String(params.get("sort") || "created_at_desc");
  const limit = positiveInteger(params.get("limit"), 50);
  return {
    status: STATUS_SET.has(status) ? status : "",
    source_kind: source === "XLSX" || source === "CSV" ? source : "",
    created_by_me: mine === "false" ? "false" : "true",
    sort: sort === "created_at_asc" ? "created_at_asc" : "created_at_desc",
    limit: limit === 20 ? 20 : 50,
    cursor: String(params.get("cursor") || "").slice(0, 2048),
  };
}

export function serializeImportListQuery(query: ImportListQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.source_kind) params.set("source_kind", query.source_kind);
  params.set("created_by_me", query.created_by_me);
  params.set("sort", query.sort);
  params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

export function importListApiQuery(query: ImportListQuery): string {
  return `/api/material-master/import-batches?${serializeImportListQuery(query)}`;
}

export function changeImportListQuery(current: ImportListQuery, patch: Partial<ImportListQuery>): ImportListQuery {
  const next = { ...current, ...patch };
  const changed = ["status", "source_kind", "created_by_me", "sort", "limit"].some((key) => current[key as keyof ImportListQuery] !== next[key as keyof ImportListQuery]);
  return changed ? { ...next, cursor: "" } : next;
}

export type ImportWorkspaceQuery = { view: MaterialImportView; sheet: number | null; row_page: number; row_page_size: 20 | 50 };

export function defaultViewForStatus(status: MaterialImportBatchStatus): MaterialImportView {
  if (["CREATED", "UPLOAD_PENDING"].includes(status)) return "file";
  if (["FILE_READY", "QUEUED_FOR_PARSING", "PARSING"].includes(status)) return "parse";
  if (status === "AWAITING_MAPPING") return "sheet";
  if (["MAPPING_CONFIRMED", "QUEUED_FOR_NORMALIZATION", "NORMALIZING"].includes(status)) return "normalize";
  if (status === "NORMALIZED") return "normalized";
  return "sheet";
}

export function legalImportView(status: MaterialImportBatchStatus, requested: string | null): MaterialImportView {
  const view = VIEW_SET.has(requested as MaterialImportView) ? requested as MaterialImportView : defaultViewForStatus(status);
  if (["FAILED", "CANCELLED", "RECONCILIATION_REQUIRED"].includes(status)) return defaultViewForStatus(status);
  if (["CREATED", "UPLOAD_PENDING"].includes(status)) return view === "file" ? view : "file";
  if (["FILE_READY", "QUEUED_FOR_PARSING", "PARSING"].includes(status)) return view === "parse" ? view : "parse";
  if (status === "PARSED") return "sheet";
  if (status === "AWAITING_MAPPING") return view === "mapping" ? "mapping" : "sheet";
  if (status === "MAPPING_CONFIRMED") return ["sheet", "confirmed", "normalize"].includes(view) ? view : "normalize";
  if (["QUEUED_FOR_NORMALIZATION", "NORMALIZING"].includes(status)) return ["normalize", "normalized", "issues", "confirmed"].includes(view) ? view : "normalize";
  if (status === "NORMALIZED") return ["normalize", "normalized", "issues", "review", "confirmed"].includes(view) ? view : "normalized";
  return defaultViewForStatus(status);
}

export function parseImportWorkspaceQuery(input: string | URLSearchParams, status: MaterialImportBatchStatus): ImportWorkspaceQuery {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const sheetText = params.get("sheet");
  const sheet = sheetText !== null && /^(0|[1-9][0-9]*)$/.test(sheetText) && Number(sheetText) <= 31 ? Number(sheetText) : null;
  return {
    view: legalImportView(status, params.get("view")),
    sheet,
    row_page: positiveInteger(params.get("row_page"), 1),
    row_page_size: positiveInteger(params.get("row_page_size"), 50) === 20 ? 20 : 50,
  };
}

export function serializeImportWorkspaceQuery(query: ImportWorkspaceQuery): string {
  const params = new URLSearchParams();
  params.set("view", query.view);
  if (query.sheet !== null) params.set("sheet", String(query.sheet));
  params.set("row_page", String(query.row_page));
  params.set("row_page_size", String(query.row_page_size));
  return params.toString();
}

export function importStatusLabel(value: unknown): string {
  const labels: Record<string, string> = {
    CREATED: "待上传", UPLOAD_PENDING: "上传处理中", FILE_READY: "文件已就绪", QUEUED_FOR_PARSING: "解析排队中",
    PARSING: "解析中", PARSED: "解析结果已发布", AWAITING_MAPPING: "等待字段映射", MAPPING_CONFIRMED: "字段映射已确认",
    QUEUED_FOR_NORMALIZATION: "数据归一化排队中", NORMALIZING: "数据归一化中", NORMALIZED: "规范化结果已发布",
    RECONCILIATION_REQUIRED: "需要后台协调", FAILED: "失败", CANCELLED: "已取消",
  };
  return labels[String(value)] || "未知状态";
}

export function safeImportFilename(value: unknown): string {
  const normalized = String(value || "").normalize("NFKC").replaceAll("\\", "/");
  const basename = normalized.split("/").pop() || "未命名文件";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._()\- ]/gu, "_").trim().slice(0, 255) || "未命名文件";
}

export type ImportFileLike = { name: string; size: number; type: string; lastModified: number };
export type ImportPreflight = { ok: boolean; filename: string; sourceKind: "XLSX" | "CSV" | null; errors: string[] };

export function preflightImportFile(file: ImportFileLike | null): ImportPreflight {
  if (!file) return { ok: false, filename: "", sourceKind: null, errors: ["请选择一个 .xlsx、.xls 或 .csv 文件"] };
  const filename = safeImportFilename(file.name);
  const extension = filename.toLowerCase().endsWith(".xlsx") ? ".xlsx" : filename.toLowerCase().endsWith(".xls") ? ".xls" : filename.toLowerCase().endsWith(".csv") ? ".csv" : "";
  const errors: string[] = [];
  if (!extension) errors.push("仅支持 .xlsx、.xls 或 .csv 文件");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) errors.push("文件不能为空");
  if (file.size > MATERIAL_IMPORT_MAX_BYTES) errors.push("文件不能超过 10 MiB");
  const mime = String(file.type || "").toLowerCase();
  const xlsxMimes = new Set(["", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"]);
  const xlsMimes = new Set(["", "application/vnd.ms-excel", "application/octet-stream"]);
  const csvMimes = new Set(["", "text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"]);
  if (extension === ".xlsx" && !xlsxMimes.has(mime)) errors.push("文件扩展名与浏览器报告的 MIME 类型明显不一致");
  if (extension === ".xls" && !xlsMimes.has(mime)) errors.push("文件扩展名与浏览器报告的 MIME 类型明显不一致");
  if (extension === ".csv" && !csvMimes.has(mime)) errors.push("文件扩展名与浏览器报告的 MIME 类型明显不一致");
  return { ok: errors.length === 0, filename, sourceKind: extension === ".csv" ? "CSV" : extension ? "XLSX" : null, errors };
}

export function importFileIdentity(file: ImportFileLike): string {
  return `${safeImportFilename(file.name)}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, nested]) => [key, canonical(nested)]));
  return value;
}

export function stableImportStringify(value: unknown): string { return JSON.stringify(canonical(value)); }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

export type ImportOperationState = "READY" | "PENDING" | "COMPLETED" | "FAILED" | "RESULT_UNKNOWN";
export type ImportWriteOperation<T = unknown> = Readonly<{
  type: "CREATE" | "UPLOAD" | "PARSE" | "NORMALIZE" | "CANCEL" | "SAVE" | "PREVIEW" | "CONFIRM" | "REUSE" | "NEW_VERSION";
  key: string; method: "POST" | "PUT"; endpoint: string; payload: T; payloadDigest: string; state: ImportOperationState;
}>;

export function createImportWriteOperation<T>(input: Omit<ImportWriteOperation<T>, "payloadDigest" | "state">): ImportWriteOperation<T> {
  const payload = structuredClone(input.payload);
  return deepFreeze({ ...input, payload, payloadDigest: stableImportStringify(payload), state: "READY" as const });
}

export function sameImportWriteRequest(operation: ImportWriteOperation, method: string, endpoint: string, payload: unknown): boolean {
  return operation.method === method && operation.endpoint === endpoint && operation.payloadDigest === stableImportStringify(payload);
}

export function retryAfterMilliseconds(value: string, now = Date.now()): number | null {
  if (/^[0-9]+$/.test(value.trim())) return Math.min(Number(value.trim()) * 1000, 24 * 60 * 60 * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - now, 24 * 60 * 60 * 1000)) : null;
}

export function pollingDelay(elapsedMs: number, networkFailures = 0): number {
  if (networkFailures > 0) return [5_000, 10_000, 30_000][Math.min(networkFailures - 1, 2)];
  if (elapsedMs < 10_000) return 2_000;
  if (elapsedMs < 60_000) return 5_000;
  return 10_000;
}

export function importStatusNeedsPolling(status: MaterialImportBatchStatus, preparation?: string): boolean {
  if (["UPLOAD_PENDING", "QUEUED_FOR_PARSING", "PARSING"].includes(status)) return true;
  return status === "PARSED" && ["NOT_STARTED", "QUEUED", "RUNNING", "READY"].includes(String(preparation || ""));
}

export function importColumnReference(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 255) return "?";
  let value = index + 1; let output = "";
  while (value > 0) { value -= 1; output = String.fromCharCode(65 + (value % 26)) + output; value = Math.floor(value / 26); }
  return output;
}

export type ImportRawCell = {
  column_index: number; column_ref?: string; type: "EMPTY" | "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "FORMULA" | "ERROR";
  raw_value: string | null; display?: string | null; source_type?: string; formula?: string; cached_value?: string | null;
  date_system?: "1900" | "1904"; format_code?: string | null; interpreted_iso_value?: string | null; interpretation_status?: "INTERPRETED" | "FAILED";
};

export function importCellText(cell: ImportRawCell | undefined): string {
  if (!cell) return "未提供";
  if (cell.type === "EMPTY") return "空单元格";
  if (cell.type === "TEXT" && cell.raw_value === "") return "空文本";
  if (cell.type === "BOOLEAN") return cell.raw_value === "1" || cell.raw_value === "true" ? "是" : "否";
  if (cell.type === "FORMULA") return "公式，未执行";
  if (cell.type === "ERROR") return `错误 ${cell.raw_value || "未知"}`;
  if (cell.type === "DATE") return cell.interpretation_status === "INTERPRETED" && cell.interpreted_iso_value ? cell.interpreted_iso_value : `日期解释失败：${cell.raw_value ?? ""}`;
  return cell.display ?? cell.raw_value ?? "";
}

export type ImportMappingTarget = {
  group_code: "BASIC" | "ATTRIBUTE" | "SPECIAL"; target_namespace: "basic" | "attribute" | "category_hint" | "supplier_reference" | "ignore";
  target_code: string; display_name: string; description: string; value_type: string; required_for_confirm: boolean;
  mapping_modes: readonly ("SOURCE" | "SOURCE_WITH_DEFAULT" | "DEFAULT" | "IGNORE")[];
  default_value_policy: { allowed: boolean; allowed_json_types: string[] }; enabled: boolean; selectable: boolean;
};

export type ImportMappingItem = {
  source_column_index: number | null; source_column_indexes?: number[]; source_header?: string | null; source_headers?: string[]; target_namespace: ImportMappingTarget["target_namespace"];
  target_code: string; mapping_mode: "SOURCE" | "SOURCE_WITH_DEFAULT" | "DEFAULT" | "IGNORE";
  default_value_json?: string | number | boolean | null; required: boolean; display_order: number;
  combination_strategy?: "FIRST_NON_EMPTY" | "JOIN_NON_EMPTY" | "SPECIFICATION_EXTRACT"; combination_separator?: string;
  mapping_confidence?: number; adaptive_mapping_status?: "EXACT" | "HIGH_CONFIDENCE" | "SUGGESTED" | "UNMAPPED" | "CONFLICT" | "CONFIRMED"; mapping_evidence?: string[];
};

export function duplicateMappingSources(items: readonly ImportMappingItem[]): number[] {
  const byTarget = new Map<string, number[]>();
  for (const item of items) {
    if (item.target_namespace === "ignore" || item.source_column_index === null) continue;
    const key = `${item.target_namespace}.${item.target_code}`;
    byTarget.set(key, [...(byTarget.get(key) || []), item.source_column_index]);
  }
  return [...byTarget.values()].filter((values) => values.length > 1).flat().sort((a, b) => a - b);
}

export function requiredMappingTargetsMissing(items: readonly ImportMappingItem[]): string[] {
  const mapped = new Set(items.filter((item) => item.target_namespace !== "ignore").map((item) => `${item.target_namespace}.${item.target_code}`));
  return ["basic.STANDARD_NAME", "basic.UNIT"].filter((target) => !mapped.has(target));
}

export type ImportUiError = { status: number; code: string; message: string; requestId: string; details: unknown[]; retryAfter: string; resultUnknown: boolean };

export function normalizeImportUiError(reason: unknown): ImportUiError {
  const error = reason as Partial<ImportUiError> & { request_id?: string; requestId?: string; retryAfter?: string };
  return {
    status: Number(error?.status || 0), code: String(error?.code || "NETWORK_ERROR"), message: String(error?.message || "网络连接失败"),
    requestId: String(error?.requestId || error?.request_id || ""), details: Array.isArray(error?.details) ? error.details : [],
    retryAfter: String(error?.retryAfter || ""), resultUnknown: error?.resultUnknown === true || error?.code === "RESULT_UNKNOWN",
  };
}
