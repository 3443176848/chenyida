import type { MaterialImportBatch, MaterialImportView } from "./material-import";

export const MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION = "material-import-normalizer-v1";
export const NORMALIZATION_ROW_PAGE_MARKER = "normalization-row-page";
export const NORMALIZATION_ISSUE_PAGE_MARKER = "normalization-issue-page";
export const NORMALIZATION_ROW_DRAWER_MARKER = "normalization-row-drawer";

export const NORMALIZATION_RUN_STATUSES = ["QUEUED", "RUNNING", "STAGED", "PUBLISHING", "SUCCEEDED", "FAILED", "CANCELLED", "SUPERSEDED"] as const;
export type NormalizationRunStatus = typeof NORMALIZATION_RUN_STATUSES[number];
export type NormalizationRowStatus = "VALID" | "WARNING" | "ERROR";
export type NormalizationIssueLevel = "WARNING" | "ERROR";

export type NormalizationRun = {
  id: number; parse_run_id: number; mapping_id: number; mapping_version: number; mapping_digest: string;
  processor_version: string; payload_schema_version: number; metadata_digest: string; run_status: NormalizationRunStatus;
  current_stage: string; total_rows: number; processed_rows: number; valid_rows: number; warning_rows: number; error_rows: number;
  normalized_json_bytes?: number; issue_count: number; warning_count: number; error_count: number; result_digest?: string | null;
  failure_code?: string | null; safe_failure_message?: string | null; started_at?: string | null; completed_at?: string | null;
  created_at: string; updated_at: string;
};

export type NormalizationSummary = {
  batch_id: number; batch_status: MaterialImportBatch["status"]; current_version: number;
  current_run: NormalizationRun | null; latest_attempt: NormalizationRun | null; request_id: string;
};

export type NormalizedRow = {
  id: number; source_sheet_index: number; source_row_number: number; source_raw_row_hash: string; normalized_payload_hash: string;
  row_status: NormalizationRowStatus; error_count: number; warning_count: number; created_at: string;
};

export type SourceLineage = {
  kind: string; column_index: number | null; cell_type: string | null; value_state: string; blank_kind?: string | null; raw_value: unknown;
};
export type FieldCandidate = { target_code: string; source: SourceLineage; candidate: unknown; status: NormalizationRowStatus };
export type NormalizedPayload = {
  schema_version: number;
  lineage: Record<string, unknown> & { batch_id: number; parse_run_id: number; normalization_run_id: number; mapping_id: number; mapping_version: number; mapping_digest: string; metadata_digest: string; processor_version: string; sheet_index: number; row_number: number; source_row_number: number; raw_row_hash: string };
  basic: Record<string, FieldCandidate>; attributes: Record<string, FieldCandidate>; category_hint: FieldCandidate | null;
  supplier_reference: Record<string, FieldCandidate>; deferred_validation: string[]; row_status: NormalizationRowStatus;
  issue_summary: { issue_count: number; error_count: number; warning_count: number };
};
export type NormalizedRowDetail = { batch_id: number; normalization_run_id: number; row: NormalizedRow; normalized_payload: NormalizedPayload; request_id: string };
export type NormalizationIssue = {
  id: number; normalized_row_id: number; issue_level: NormalizationIssueLevel; issue_code: string; target_code: string;
  source_sheet_index: number; source_row_number: number; source_column_index: number | null; safe_message: string;
  safe_details: Record<string, unknown>; created_at: string;
};
export type NormalizedRowsResponse = { batch_id: number; normalization_run_id: number; items: NormalizedRow[]; next_cursor: string | null; request_id: string };
export type NormalizationIssuesResponse = { batch_id: number; normalization_run_id: number; items: NormalizationIssue[]; next_cursor: string | null; request_id: string };

export type NormalizationQuery = {
  view: Extract<MaterialImportView, "normalize" | "normalized" | "issues" | "confirmed">;
  row_status: "" | NormalizationRowStatus; row_limit: 50 | 100; row_cursor: string; row: number | null;
  issue_level: "" | NormalizationIssueLevel; issue_code: string; issue_target: string; issue_row: number | null; issue_limit: 50 | 100; issue_cursor: string;
};

const ISSUE_CODE = /^[A-Z][A-Z0-9_]{2,99}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const ROW_STATUSES = new Set(["VALID", "WARNING", "ERROR"]);
const ISSUE_LEVELS = new Set(["WARNING", "ERROR"]);

export function strictPositiveInteger(value: string | null): number | null {
  if (!value || !POSITIVE_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function normalizationDefaultView(batch: MaterialImportBatch, currentRun: NormalizationRun | null): NormalizationQuery["view"] {
  return batch.status === "NORMALIZED" && currentRun ? "normalized" : "normalize";
}

export function parseNormalizationQuery(input: string | URLSearchParams, batch: MaterialImportBatch, currentRun: NormalizationRun | null): NormalizationQuery {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const defaultView = normalizationDefaultView(batch, currentRun);
  const requested = params.get("view");
  const view = (["normalize", "normalized", "issues", "confirmed"].includes(String(requested)) ? requested : defaultView) as NormalizationQuery["view"];
  const resultView = !currentRun && ["normalized", "issues"].includes(view) ? "normalize" : view;
  const rowStatus = String(params.get("row_status") || "");
  const issueLevel = String(params.get("issue_level") || "");
  const issueCode = String(params.get("issue_code") || "");
  const issueTarget = String(params.get("issue_target") || "");
  return {
    view: resultView,
    row_status: ROW_STATUSES.has(rowStatus) ? rowStatus as NormalizationRowStatus : "",
    row_limit: params.get("row_limit") === "100" ? 100 : 50,
    row_cursor: String(params.get("row_cursor") || "").slice(0, 2048),
    row: resultView === "normalize" ? null : strictPositiveInteger(params.get("row")),
    issue_level: ISSUE_LEVELS.has(issueLevel) ? issueLevel as NormalizationIssueLevel : "",
    issue_code: ISSUE_CODE.test(issueCode) ? issueCode : "",
    issue_target: issueTarget.length >= 3 && issueTarget.length <= 160 ? issueTarget : "",
    issue_row: strictPositiveInteger(params.get("issue_row")),
    issue_limit: params.get("issue_limit") === "100" ? 100 : 50,
    issue_cursor: String(params.get("issue_cursor") || "").slice(0, 2048),
  };
}

export function serializeNormalizationQuery(query: NormalizationQuery): string {
  const params = new URLSearchParams({ view: query.view });
  if (query.row_status) params.set("row_status", query.row_status);
  params.set("row_limit", String(query.row_limit));
  if (query.row_cursor) params.set("row_cursor", query.row_cursor);
  if (query.row !== null) params.set("row", String(query.row));
  if (query.issue_level) params.set("issue_level", query.issue_level);
  if (query.issue_code) params.set("issue_code", query.issue_code);
  if (query.issue_target) params.set("issue_target", query.issue_target);
  if (query.issue_row !== null) params.set("issue_row", String(query.issue_row));
  params.set("issue_limit", String(query.issue_limit));
  if (query.issue_cursor) params.set("issue_cursor", query.issue_cursor);
  return params.toString();
}

export function normalizedRowsEndpoint(batchId: number, query: NormalizationQuery): string {
  const params = new URLSearchParams({ limit: String(query.row_limit) });
  if (query.row_status) params.set("row_status", query.row_status);
  if (query.row_cursor) params.set("cursor", query.row_cursor);
  return `/api/material-master/import-batches/${batchId}/normalized-rows?${params}`;
}

export function normalizationIssuesEndpoint(batchId: number, query: NormalizationQuery): string {
  const params = new URLSearchParams({ limit: String(query.issue_limit) });
  if (query.issue_level) params.set("issue_level", query.issue_level);
  if (ISSUE_CODE.test(query.issue_code)) params.set("issue_code", query.issue_code);
  if (query.issue_target.length >= 3 && query.issue_target.length <= 160) params.set("target_code", query.issue_target);
  if (query.issue_row !== null && Number.isSafeInteger(query.issue_row) && query.issue_row > 0) params.set("source_row_number", String(query.issue_row));
  if (query.issue_cursor) params.set("cursor", query.issue_cursor);
  return `/api/material-master/import-batches/${batchId}/normalization-issues?${params}`;
}

export function activeNormalizationRun(run: NormalizationRun | null): boolean {
  return Boolean(run && ["QUEUED", "RUNNING", "STAGED", "PUBLISHING"].includes(run.run_status));
}

export function validRunCounts(run: NormalizationRun): boolean {
  const values = [run.total_rows, run.processed_rows, run.valid_rows, run.warning_rows, run.error_rows, run.issue_count, run.warning_count, run.error_count];
  return values.every((value) => Number.isSafeInteger(value) && value >= 0)
    && run.processed_rows <= run.total_rows
    && (!run.result_digest || run.valid_rows + run.warning_rows + run.error_rows === run.total_rows)
    && run.warning_count + run.error_count <= run.issue_count;
}

export function normalizationStageLabel(stage: unknown): string {
  const labels: Record<string, string> = {
    LOAD_MAPPING: "正在读取并核对已确认映射", READ_SOURCE_ROWS: "正在读取源数据行", NORMALIZE_ROWS: "正在生成规范化候选",
    VERIFY_RESULT: "正在核对结果完整性", PUBLISH_RESULT: "正在原子发布规范化结果", COMPLETE: "数据归一化处理已结束",
  };
  return labels[String(stage)] || "正在处理规范化任务";
}

export function rowProgress(run: NormalizationRun): { percent: number; label: string } | null {
  if (!validRunCounts(run) || run.total_rows <= 0 || !["RUNNING", "STAGED", "PUBLISHING"].includes(run.run_status)) return null;
  const percent = Math.floor(run.processed_rows / run.total_rows * 100);
  const label = percent === 100 && run.current_stage === "VERIFY_RESULT" ? "行处理已完成，正在核对" : percent === 100 && run.current_stage === "PUBLISH_RESULT" ? "行处理已完成，正在发布" : "行处理进度";
  return { percent, label };
}

export function shortDigest(value: unknown): string {
  const text = String(value || "");
  return text.length > 20 ? `${text.slice(0, 8)}…${text.slice(-8)}` : text;
}

export const NORMALIZATION_ISSUE_LABELS: Record<string, string> = {
  NORMALIZATION_REQUIRED_VALUE_MISSING: "必填值缺失", NORMALIZATION_BLANK_VALUE: "空白值", NORMALIZATION_TYPE_MISMATCH: "类型不匹配",
  NORMALIZATION_ENUM_INVALID: "枚举值非法", NORMALIZATION_NUMBER_INVALID: "数字格式非法", NORMALIZATION_INTEGER_REQUIRED: "需要安全整数",
  NORMALIZATION_BOOLEAN_INVALID: "布尔值非法", NORMALIZATION_DATE_INVALID: "日期非法", NORMALIZATION_FORMULA_NOT_EXECUTED: "公式未执行",
  NORMALIZATION_SOURCE_ERROR_CELL: "来源单元格错误", NORMALIZATION_TEXT_TOO_LONG: "文本过长", NORMALIZATION_DEFAULT_INVALID: "默认值无效",
  NORMALIZATION_BRAND_UNKNOWN: "品牌占位值需确认", NORMALIZATION_ATTRIBUTE_DISABLED: "属性不可用", NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED: "属性单位缺失",
  NORMALIZATION_ATTRIBUTE_UNIT_INVALID: "属性单位非法", NORMALIZATION_ROW_TOO_LARGE: "单行结果过大", NORMALIZATION_ISSUE_LIMIT_EXCEEDED: "单行问题达到上限",
};

export function issueLabel(code: unknown): string { return NORMALIZATION_ISSUE_LABELS[String(code)] || "规范化问题"; }

export function safeIssueDetails(value: unknown): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const allowed = new Set(["expected_type", "allowed_values", "decimal_scale", "max_length", "max_bytes"]);
  return Object.entries(value as Record<string, unknown>).filter(([key, item]) => {
    if (!allowed.has(key)) return false;
    if (["decimal_scale", "max_length", "max_bytes"].includes(key)) return Number.isSafeInteger(item) && Number(item) >= 0;
    if (key === "allowed_values") return Array.isArray(item) && item.length <= 200 && item.every((entry) => typeof entry === "string" && entry.length <= 160);
    return typeof item === "string" || typeof item === "number" || typeof item === "boolean";
  });
}

export type BoundedValue = { type: "string" | "number" | "boolean" | "null" | "array" | "object"; text?: string; children?: [string, BoundedValue][]; truncated: boolean };
export function boundedValue(value: unknown, limits = { depth: 4, nodes: 120, string: 500, array: 50, object: 50, chars: 4000 }): BoundedValue {
  let nodes = 0; let chars = 0; let cut = false;
  const visit = (item: unknown, depth: number): BoundedValue => {
    nodes += 1;
    if (nodes > limits.nodes || depth > limits.depth || chars >= limits.chars) { cut = true; return { type: "string", text: "内容过大，已进行有界展示", truncated: true }; }
    if (item === null) return { type: "null", text: "Null", truncated: false };
    if (typeof item === "string") { const text = item.slice(0, Math.min(limits.string, limits.chars - chars)); chars += text.length; const truncated = text.length < item.length; cut ||= truncated; return { type: "string", text, truncated }; }
    if (typeof item === "number") return { type: "number", text: Number.isFinite(item) ? String(item) : "非有限数字", truncated: !Number.isFinite(item) };
    if (typeof item === "boolean") return { type: "boolean", text: item ? "True" : "False", truncated: false };
    if (Array.isArray(item)) { const children = item.slice(0, limits.array).map((entry, index) => [String(index), visit(entry, depth + 1)] as [string, BoundedValue]); const truncated = item.length > limits.array || children.some(([, child]) => child.truncated); cut ||= truncated; return { type: "array", children, truncated }; }
    if (typeof item === "object") { const entries = Object.entries(item as Record<string, unknown>).slice(0, limits.object); const children = entries.map(([key, entry]) => [key.slice(0, 160), visit(entry, depth + 1)] as [string, BoundedValue]); const truncated = Object.keys(item as object).length > limits.object || children.some(([, child]) => child.truncated); cut ||= truncated; return { type: "object", children, truncated }; }
    return { type: "string", text: "不支持的值类型", truncated: true };
  };
  const result = visit(value, 0); return cut ? { ...result, truncated: true } : result;
}

export function validateComposite(batch: MaterialImportBatch, summary: NormalizationSummary, batchId: number): boolean {
  return batch.id === batchId && summary.batch_id === batchId && summary.batch_status === batch.status && summary.current_version === batch.current_version
    && (!summary.current_run || summary.current_run.run_status === "SUCCEEDED")
    && !(batch.status === "NORMALIZED" && !summary.current_run)
    && !(["QUEUED_FOR_NORMALIZATION", "NORMALIZING"].includes(batch.status) && !activeNormalizationRun(summary.latest_attempt));
}

export function validateRowsResponse(response: NormalizedRowsResponse, batchId: number, runId: number): boolean {
  return response.batch_id === batchId && response.normalization_run_id === runId && response.items.every((row) => Number.isSafeInteger(row.id) && row.id > 0);
}

export function validateIssuesResponse(response: NormalizationIssuesResponse, batchId: number, runId: number): boolean {
  return response.batch_id === batchId && response.normalization_run_id === runId && response.items.every((issue) => Number.isSafeInteger(issue.normalized_row_id) && issue.normalized_row_id > 0);
}

export function validateRowDetail(detail: NormalizedRowDetail, batchId: number, runId: number, rowId: number): boolean {
  const lineage = detail.normalized_payload.lineage;
  return detail.batch_id === batchId && detail.normalization_run_id === runId && detail.row.id === rowId
    && lineage.batch_id === batchId && lineage.normalization_run_id === runId
    && lineage.sheet_index === detail.row.source_sheet_index && lineage.row_number === detail.row.source_row_number
    && lineage.source_row_number === detail.row.source_row_number && lineage.raw_row_hash === detail.row.source_raw_row_hash;
}
