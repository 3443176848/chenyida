import type { MaterialMasterD1Database, MaterialMasterD1Statement } from "../material-master/index.ts";
import {
  MaterialImportMappingMetadataSnapshotService,
  canonicalJson,
} from "./mapping-target-registry.ts";
import {
  MATERIAL_IMPORT_NORMALIZATION_LIMITS,
  MaterialImportRowNormalizer,
  type MaterialImportNormalizationIssue,
  type MaterialImportNormalizationMappingItem,
} from "./normalization-model.ts";
import type { MaterialImportRawRow } from "./parser-model.ts";
import { classifyAdaptiveDataRow } from "./adaptive-import.ts";
import type { MaterialImportTask, MaterialImportTaskDisposition, MaterialImportTaskHandler } from "./task-scheduler.ts";

const LEASE_SECONDS = 120;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const RETENTION_SECONDS = 30 * 86_400;

type BatchRow = {
  id: number;
  status: string;
  created_by: string;
  current_version: number;
  current_parse_run_id: number | null;
  current_normalization_run_id: number | null;
};

type MappingRow = {
  id: number;
  batch_id: number;
  parse_run_id: number;
  selected_sheet_index: number;
  header_mode: "SINGLE_ROW" | "NO_HEADER";
  header_row_number: number | null;
  mapping_status: string;
  mapping_version: number;
  metadata_digest: string;
  supplier_profile_id?: number | null;
};

type RunRow = {
  id: number;
  batch_id: number;
  parse_run_id: number;
  mapping_id: number;
  mapping_version: number;
  mapping_digest: string;
  processor_version: string;
  payload_schema_version: number;
  metadata_digest: string;
  batch_version_at_start: number;
  run_status: string;
  attempt_no: number;
  lease_token_digest: string | null;
  lease_expires_at: number | null;
  current_stage: string;
  total_rows: number;
  processed_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  normalized_json_bytes: number;
  issue_count: number;
  warning_count: number;
  error_count: number;
  result_digest: string | null;
  failure_code: string | null;
  safe_failure_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type MappingItemRow = {
  source_column_index: number | null;
  target_namespace: MaterialImportNormalizationMappingItem["target_namespace"];
  target_code: string;
  mapping_mode: MaterialImportNormalizationMappingItem["mapping_mode"];
  default_value_json: string | null;
  required: number;
  display_order: number;
  source_column_indexes_json?: string | null;
  source_headers_json?: string | null;
  combination_strategy?: MaterialImportNormalizationMappingItem["combination_strategy"];
  combination_separator?: string;
  mapping_confidence?: number;
  adaptive_mapping_status?: MaterialImportNormalizationMappingItem["adaptive_mapping_status"];
  mapping_evidence_json?: string;
};

export type MaterialImportNormalizationServiceResult = Readonly<{ status: number; payload: Record<string, unknown>; replayed?: boolean }>;

export class MaterialImportNormalizationServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expectedVersion?: number;
  constructor(code: string, message: string, status: number, expectedVersion?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.expectedVersion = expectedVersion;
  }
}

async function sha256(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function seconds(date: Date): number { return Math.floor(date.getTime() / 1000); }

function assertProcessorVersion(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_NOT_ALLOWED", "processor_version 无效", 400);
}

function assertIdempotencyKey(value: string): void {
  if (value.length < 16 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw new MaterialImportNormalizationServiceError("IDEMPOTENCY_KEY_REQUIRED", "需要有效的幂等键", 400);
}

function visibleBatch(row: BatchRow | null, username: string, canReadAny: boolean): BatchRow {
  if (!row || (!canReadAny && row.created_by !== username)) throw new MaterialImportNormalizationServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return row;
}

async function getVisibleBatch(database: MaterialMasterD1Database, batchId: number, username: string, canReadAny: boolean): Promise<BatchRow> {
  const row = await database.prepare("SELECT id,status,created_by,current_version,current_parse_run_id,current_normalization_run_id FROM material_import_batches WHERE id=?").bind(batchId).first<BatchRow>();
  return visibleBatch(row, username, canReadAny);
}

function summary(run: RunRow | null): Record<string, unknown> | null {
  if (!run) return null;
  return {
    id: run.id,
    parse_run_id: run.parse_run_id,
    mapping_id: run.mapping_id,
    mapping_version: run.mapping_version,
    mapping_digest: run.mapping_digest,
    processor_version: run.processor_version,
    payload_schema_version: run.payload_schema_version,
    metadata_digest: run.metadata_digest,
    run_status: run.run_status,
    current_stage: run.current_stage,
    total_rows: run.total_rows,
    processed_rows: run.processed_rows,
    valid_rows: run.valid_rows,
    warning_rows: run.warning_rows,
    error_rows: run.error_rows,
    issue_count: run.issue_count,
    warning_count: run.warning_count,
    error_count: run.error_count,
    normalized_json_bytes: run.normalized_json_bytes,
    result_digest: run.result_digest,
    failure_code: run.failure_code,
    safe_failure_message: run.safe_failure_message,
    started_at: run.started_at,
    completed_at: run.completed_at,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

async function currentMapping(database: MaterialMasterD1Database, batch: BatchRow): Promise<MappingRow> {
  const mapping = await database.prepare("SELECT id,batch_id,parse_run_id,selected_sheet_index,header_mode,header_row_number,mapping_status,mapping_version,metadata_digest FROM material_import_mappings WHERE batch_id=? AND parse_run_id=? AND mapping_status='CONFIRMED' ORDER BY id DESC LIMIT 1").bind(batch.id, batch.current_parse_run_id).first<MappingRow>();
  if (!mapping) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_MAPPING_STALE", "当前已确认 Mapping 不可用", 409);
  return mapping;
}

export async function startMaterialImportNormalization(
  database: MaterialMasterD1Database,
  input: Readonly<{
    batchId: number;
    username: string;
    canReadAny: boolean;
    canNormalize: boolean;
    expectedVersion: number;
    processorVersion: string;
    rerunReason?: string | null;
    idempotencyKey: string;
    requestId: string;
    consumeRateLimit?: () => Promise<void>;
  }>,
  clock: () => Date = () => new Date(),
): Promise<MaterialImportNormalizationServiceResult> {
  assertIdempotencyKey(input.idempotencyKey);
  assertProcessorVersion(input.processorVersion);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "批次版本无效", 409);
  const batch = await getVisibleBatch(database, input.batchId, input.username, input.canReadAny);
  if (!input.canNormalize) throw new MaterialImportNormalizationServiceError("FORBIDDEN", "没有执行规范化的权限", 403);
  const reason = input.rerunReason?.trim() || null;
  const route = `material-import:${input.batchId}:normalize`;
  const keyDigest = await sha256(input.idempotencyKey);
  const requestDigest = await sha256(canonicalJson({ expected_version: input.expectedVersion, processor_version: input.processorVersion, rerun_reason: reason }));
  const existing = await database.prepare("SELECT request_digest,state,status_code,response_json FROM material_import_idempotency WHERE username=? AND method='POST' AND route_scope=? AND key_digest=?").bind(input.username, route, keyDigest).first<{ request_digest: string; state: string; status_code: number | null; response_json: string | null }>();
  if (existing) {
    if (existing.request_digest !== requestDigest) throw new MaterialImportNormalizationServiceError("IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求", 409);
    if (existing.state === "COMPLETED" && existing.status_code && existing.response_json) return { status: existing.status_code, payload: JSON.parse(existing.response_json) as Record<string, unknown>, replayed: true };
    throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_ALREADY_RUNNING", "规范化启动请求正在处理", 409);
  }
  await input.consumeRateLimit?.();
  if (!["MAPPING_CONFIRMED", "NORMALIZED"].includes(batch.status)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_NOT_ALLOWED", "当前批次状态不允许规范化", 409, batch.current_version);
  if (batch.current_version !== input.expectedVersion) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "批次版本已变化", 409, batch.current_version);
  const rerun = batch.status === "NORMALIZED";
  if (rerun && (!reason || reason.length > 500)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_NOT_ALLOWED", "重新运行必须提供原因", 400);
  if (!rerun && reason) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_NOT_ALLOWED", "首次规范化不得提供重新运行原因", 400);

  const active = await database.prepare("SELECT id FROM material_import_normalization_runs WHERE batch_id=? AND run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING') LIMIT 1").bind(input.batchId).first<{ id: number }>();
  if (active) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_ALREADY_RUNNING", "已有规范化任务正在运行", 409);
  const mapping = await currentMapping(database, batch);
  const snapshot = await new MaterialImportMappingMetadataSnapshotService(database).current();
  if (mapping.metadata_digest !== snapshot.metadataDigest) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_METADATA_CHANGED", "Mapping 目标元数据已变化", 409);
  const mappingDigest = await sha256(canonicalJson(await normalizationMappingItems(database, mapping.id)));
  if (rerun && batch.current_normalization_run_id) {
    const current = await database.prepare("SELECT processor_version FROM material_import_normalization_runs WHERE id=? AND batch_id=? AND run_status='SUCCEEDED'").bind(batch.current_normalization_run_id, batch.id).first<{ processor_version: string }>();
    if (!current) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_FAILED", "当前规范化结果不完整", 409);
    if (current.processor_version === input.processorVersion) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_NOT_ALLOWED", "相同 processor_version 不创建重复运行", 409);
  }
  const headerRow = mapping.header_mode === "SINGLE_ROW" ? mapping.header_row_number : null;
  const count = await database.prepare("SELECT COUNT(*) AS total FROM material_import_rows WHERE parse_run_id=? AND sheet_index=? AND (? IS NULL OR row_number>?)").bind(mapping.parse_run_id, mapping.selected_sheet_index, headerRow, headerRow).first<{ total: number }>();
  const totalRows = Number(count?.total ?? 0);
  if (totalRows > MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxRows) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "规范化源行数超过限制", 409);

  const now = clock();
  const timestamp = now.toISOString();
  const operationId = crypto.randomUUID();
  const leaseDigest = await sha256(crypto.randomUUID());
  const jobId = crypto.randomUUID();
  const responseExpression = `json_object('operation_id',?,'batch_id',?,'normalization_run_id',(SELECT id FROM material_import_normalization_runs WHERE batch_id=? AND run_status='QUEUED' ORDER BY id DESC LIMIT 1),'batch_status','QUEUED_FOR_NORMALIZATION','run_status','QUEUED','processor_version',?,'current_version',?)`;
  await database.batch([
    database.prepare("INSERT INTO material_import_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until) VALUES(?,'POST',?,?,?,?,'PENDING',?,?,?,?,?,?)").bind(input.username, route, keyDigest, requestDigest, operationId, input.batchId, leaseDigest, seconds(now) + LEASE_SECONDS, timestamp, timestamp, seconds(now) + 604_800),
    database.prepare(`INSERT INTO material_import_normalization_runs(batch_id,parse_run_id,mapping_id,mapping_version,mapping_digest,processor_version,payload_schema_version,metadata_digest,batch_version_at_start,run_status,attempt_no,current_stage,total_rows,processed_rows,valid_rows,warning_rows,error_rows,normalized_json_bytes,issue_count,warning_count,error_count,requested_by,rerun_reason,created_at,updated_at)
      SELECT id,?,?,?,?,?,1,?,?, 'QUEUED',1,'LOAD_MAPPING',?,0,0,0,0,0,0,0,0,?,?,?,? FROM material_import_batches WHERE id=? AND current_version=? AND status=?`).bind(mapping.parse_run_id, mapping.id, mapping.mapping_version, mappingDigest, input.processorVersion, snapshot.metadataDigest, batch.current_version, totalRows, input.username, reason, timestamp, timestamp, batch.id, batch.current_version, batch.status),
    database.prepare(`INSERT INTO material_import_job_outbox(id,batch_id,parse_run_id,normalization_run_id,job_type,payload_version,payload_json,dispatch_status,dispatch_version,attempt_count,available_at,created_at)
      SELECT ?,batch_id,NULL,id,'START_NORMALIZATION',1,json_object('normalization_run_id',id),'PENDING',1,0,?,? FROM material_import_normalization_runs WHERE batch_id=? AND run_status='QUEUED' ORDER BY id DESC LIMIT 1`).bind(jobId, seconds(now), timestamp, batch.id),
    database.prepare("UPDATE material_import_batches SET status='QUEUED_FOR_NORMALIZATION',current_version=current_version+1,updated_at=? WHERE id=? AND current_version=? AND status=?").bind(timestamp, batch.id, batch.current_version, batch.status),
    database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES((SELECT CASE WHEN status='QUEUED_FOR_NORMALIZATION' AND current_version=? THEN id ELSE NULL END FROM material_import_batches WHERE id=?),'NORMALIZATION_QUEUED','USER',?,?,?,?,json_object('processor_version',?),?)").bind(batch.current_version + 1, batch.id, input.username, batch.status, "QUEUED_FOR_NORMALIZATION", input.requestId, input.processorVersion, timestamp),
    database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES(?,'MATERIAL_IMPORT_NORMALIZATION_QUEUED',?,?,'success','MATERIAL_IMPORT_NORMALIZATION_START',?,?)").bind(input.username, String(batch.id), input.requestId, seconds(now) + 1_095 * 86_400, timestamp),
    database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=202,response_json=${responseExpression},updated_at=?,expires_at=? WHERE username=? AND method='POST' AND route_scope=? AND key_digest=? AND request_digest=? AND state='PENDING'`).bind(operationId, batch.id, batch.id, input.processorVersion, batch.current_version + 1, timestamp, seconds(now) + IDEMPOTENCY_TTL_SECONDS, input.username, route, keyDigest, requestDigest),
  ]);
  const created = await database.prepare("SELECT id FROM material_import_normalization_runs WHERE batch_id=? AND run_status='QUEUED' ORDER BY id DESC LIMIT 1").bind(batch.id).first<{ id: number }>();
  if (!created) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "批次版本已变化", 409);
  return {
    status: 202,
    payload: {
      operation_id: operationId,
      batch_id: batch.id,
      normalization_run_id: created.id,
      batch_status: "QUEUED_FOR_NORMALIZATION",
      run_status: "QUEUED",
      processor_version: input.processorVersion,
      current_version: batch.current_version + 1,
    },
  };
}

export async function getMaterialImportNormalization(
  database: MaterialMasterD1Database,
  batchId: number,
  context: Readonly<{ username: string; canReadAny: boolean; consumeRateLimit?: () => Promise<void> }>,
): Promise<MaterialImportNormalizationServiceResult> {
  const batch = await getVisibleBatch(database, batchId, context.username, context.canReadAny);
  await context.consumeRateLimit?.();
  const currentRun = batch.current_normalization_run_id
    ? await database.prepare("SELECT * FROM material_import_normalization_runs WHERE id=? AND batch_id=? AND run_status='SUCCEEDED'").bind(batch.current_normalization_run_id, batch.id).first<RunRow>()
    : null;
  const latest = await database.prepare("SELECT * FROM material_import_normalization_runs WHERE batch_id=? ORDER BY id DESC LIMIT 1").bind(batch.id).first<RunRow>();
  return { status: 200, payload: { batch_id: batch.id, batch_status: batch.status, current_version: batch.current_version, current_run: summary(currentRun), latest_attempt: summary(latest) } };
}

type CursorPayload = Readonly<{ v: 1; run: number; after: number; filter: string; digest: string }>;

async function encodeCursor(run: number, after: number, filter: string): Promise<string> {
  const base = { v: 1 as const, run, after, filter };
  const payload: CursorPayload = { ...base, digest: await sha256(canonicalJson(base)) };
  return btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function decodeCursor(value: string | undefined, run: number, filter: string): Promise<number> {
  if (!value) return 0;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as CursorPayload;
    const base = { v: parsed.v, run: parsed.run, after: parsed.after, filter: parsed.filter };
    if (parsed.v !== 1 || parsed.run !== run || parsed.filter !== filter || !Number.isSafeInteger(parsed.after) || parsed.after < 0 || parsed.digest !== await sha256(canonicalJson(base))) throw new Error("bad");
    return parsed.after;
  } catch {
    throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "cursor 无效或已失效", 400);
  }
}

async function publishedRun(database: MaterialMasterD1Database, batch: BatchRow): Promise<RunRow> {
  if (!batch.current_normalization_run_id) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_NOT_ALLOWED", "尚无已发布的规范化结果", 409);
  const run = await database.prepare("SELECT * FROM material_import_normalization_runs WHERE id=? AND batch_id=? AND run_status='SUCCEEDED'").bind(batch.current_normalization_run_id, batch.id).first<RunRow>();
  if (!run) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_FAILED", "已发布规范化结果不完整", 409);
  return run;
}

export async function listMaterialImportNormalizedRows(
  database: MaterialMasterD1Database,
  batchId: number,
  context: Readonly<{ username: string; canReadAny: boolean; rowStatus?: string; limit: number; cursor?: string; consumeRateLimit?: () => Promise<void> }>,
): Promise<MaterialImportNormalizationServiceResult> {
  const batch = await getVisibleBatch(database, batchId, context.username, context.canReadAny);
  await context.consumeRateLimit?.();
  const run = await publishedRun(database, batch);
  if (context.rowStatus && !["VALID", "WARNING", "ERROR"].includes(context.rowStatus)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "row_status 无效", 400);
  if (!Number.isSafeInteger(context.limit) || context.limit < 1 || context.limit > 100) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "limit 必须在 1 到 100 之间", 400);
  const filter = context.rowStatus ?? "";
  const after = await decodeCursor(context.cursor, run.id, filter);
  const params: unknown[] = [run.id, after];
  let where = "normalization_run_id=? AND id>?";
  if (context.rowStatus) { where += " AND row_status=?"; params.push(context.rowStatus); }
  params.push(context.limit + 1);
  const rows = (await database.prepare(`SELECT id,source_sheet_index,source_row_number,source_raw_row_hash,normalized_payload_hash,row_status,error_count,warning_count,created_at FROM material_import_normalized_rows WHERE ${where} ORDER BY id LIMIT ?`).bind(...params).all<Record<string, unknown>>()).results ?? [];
  const page = rows.slice(0, context.limit);
  const last = page.at(-1);
  return { status: 200, payload: { batch_id: batch.id, normalization_run_id: run.id, items: page, next_cursor: rows.length > context.limit && last ? await encodeCursor(run.id, Number(last.id), filter) : null } };
}

export async function getMaterialImportNormalizedRow(
  database: MaterialMasterD1Database,
  batchId: number,
  rowId: number,
  context: Readonly<{ username: string; canReadAny: boolean; consumeRateLimit?: () => Promise<void> }>,
): Promise<MaterialImportNormalizationServiceResult> {
  const batch = await getVisibleBatch(database, batchId, context.username, context.canReadAny);
  await context.consumeRateLimit?.();
  const run = await publishedRun(database, batch);
  const row = await database.prepare("SELECT id,source_sheet_index,source_row_number,source_raw_row_hash,normalized_payload_hash,row_status,error_count,warning_count,created_at,normalized_payload_json FROM material_import_normalized_rows WHERE id=? AND normalization_run_id=?").bind(rowId, run.id).first<Record<string, unknown> & { normalized_payload_json: string }>();
  if (!row) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZED_ROW_NOT_FOUND", "规范化行不存在", 404);
  const { normalized_payload_json: payloadJson, ...summaryRow } = row;
  return { status: 200, payload: { batch_id: batch.id, normalization_run_id: run.id, row: summaryRow, normalized_payload: JSON.parse(payloadJson) } };
}

export async function listMaterialImportNormalizationIssues(
  database: MaterialMasterD1Database,
  batchId: number,
  context: Readonly<{ username: string; canReadAny: boolean; issueLevel?: string; issueCode?: string; targetCode?: string; sourceRowNumber?: number; limit: number; cursor?: string; consumeRateLimit?: () => Promise<void> }>,
): Promise<MaterialImportNormalizationServiceResult> {
  const batch = await getVisibleBatch(database, batchId, context.username, context.canReadAny);
  await context.consumeRateLimit?.();
  const run = await publishedRun(database, batch);
  if (context.issueLevel && !["ERROR", "WARNING"].includes(context.issueLevel)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "issue_level 无效", 400);
  if (context.issueCode && !/^[A-Z][A-Z0-9_]{2,99}$/.test(context.issueCode)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "issue_code 无效", 400);
  if (context.targetCode && (context.targetCode.length < 3 || context.targetCode.length > 160)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "target_code 无效", 400);
  if (context.sourceRowNumber !== undefined && (!Number.isSafeInteger(context.sourceRowNumber) || context.sourceRowNumber < 1)) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "source_row_number 无效", 400);
  if (!Number.isSafeInteger(context.limit) || context.limit < 1 || context.limit > 100) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "limit 必须在 1 到 100 之间", 400);
  const filter = canonicalJson({ level: context.issueLevel ?? null, code: context.issueCode ?? null, target: context.targetCode ?? null, row: context.sourceRowNumber ?? null });
  const after = await decodeCursor(context.cursor, run.id, filter);
  const clauses = ["normalization_run_id=?", "id>?"];
  const params: unknown[] = [run.id, after];
  if (context.issueLevel) { clauses.push("issue_level=?"); params.push(context.issueLevel); }
  if (context.issueCode) { clauses.push("issue_code=?"); params.push(context.issueCode); }
  if (context.targetCode) { clauses.push("target_code=?"); params.push(context.targetCode); }
  if (context.sourceRowNumber !== undefined) { clauses.push("source_row_number=?"); params.push(context.sourceRowNumber); }
  params.push(context.limit + 1);
  const rows = (await database.prepare(`SELECT id,normalized_row_id,issue_level,issue_code,target_code,source_sheet_index,source_row_number,source_column_index,safe_message,safe_details_json,created_at FROM material_import_normalization_issues WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`).bind(...params).all<Record<string, unknown> & { safe_details_json: string }>()).results ?? [];
  const page = rows.slice(0, context.limit).map(({ safe_details_json: details, ...row }) => ({ ...row, safe_details: JSON.parse(details) }));
  const last = page.at(-1);
  return { status: 200, payload: { batch_id: batch.id, normalization_run_id: run.id, items: page, next_cursor: rows.length > context.limit && last ? await encodeCursor(run.id, Number(last.id), filter) : null } };
}

async function loadRun(database: MaterialMasterD1Database, task: MaterialImportTask): Promise<RunRow | null> {
  if (!task.normalizationRunId) return null;
  return database.prepare("SELECT * FROM material_import_normalization_runs WHERE id=? AND batch_id=?").bind(task.normalizationRunId, task.batchId).first<RunRow>();
}

async function claimLease(database: MaterialMasterD1Database, run: RunRow, clock: () => Date): Promise<string | null> {
  const token = crypto.randomUUID();
  const digest = await sha256(token);
  const now = clock();
  const claimed = await database.prepare(`UPDATE material_import_normalization_runs
    SET lease_token_digest=?,lease_expires_at=?,heartbeat_at=?,attempt_no=attempt_no+CASE WHEN lease_token_digest IS NULL THEN 0 ELSE 1 END,started_at=COALESCE(started_at,?),updated_at=?
    WHERE id=? AND run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING') AND (lease_token_digest IS NULL OR lease_expires_at<?)`)
    .bind(digest, seconds(now) + LEASE_SECONDS, now.toISOString(), now.toISOString(), now.toISOString(), run.id, seconds(now)).run();
  return (claimed.meta?.changes ?? 0) === 1 ? digest : null;
}

async function normalizationMappingItems(database: MaterialMasterD1Database, mappingId: number): Promise<readonly MaterialImportNormalizationMappingItem[]> {
  const rows = (await database.prepare("SELECT * FROM material_import_mapping_items WHERE mapping_id=? ORDER BY display_order,id").bind(mappingId).all<MappingItemRow>()).results ?? [];
  return rows.map((row) => {
    const adaptive = row.source_column_indexes_json !== undefined && (row.source_column_indexes_json !== null || row.adaptive_mapping_status !== "UNMAPPED");
    return {
    source_column_index: row.source_column_index,
    ...(adaptive ? { source_column_indexes: row.source_column_indexes_json ? JSON.parse(row.source_column_indexes_json) : row.source_column_index === null ? [] : [row.source_column_index] } : {}),
    ...(adaptive ? { source_headers: row.source_headers_json ? JSON.parse(row.source_headers_json) : [] } : {}),
    target_namespace: row.target_namespace,
    target_code: row.target_code,
    mapping_mode: row.mapping_mode,
    default_value: row.default_value_json === null ? null : JSON.parse(row.default_value_json),
    required: row.required === 1,
    display_order: row.display_order,
    ...(adaptive ? {
      combination_strategy: row.combination_strategy ?? "FIRST_NON_EMPTY",
      combination_separator: row.combination_separator ?? " ",
      mapping_confidence: row.mapping_confidence ?? 0,
      adaptive_mapping_status: row.adaptive_mapping_status ?? "UNMAPPED",
      mapping_evidence: row.mapping_evidence_json ? JSON.parse(row.mapping_evidence_json) : [],
    } : {}),
  };
  });
}

async function adaptiveNormalizationSchemaAvailable(database: MaterialMasterD1Database): Promise<boolean> {
  const row = await database.prepare("SELECT 1 AS present FROM pragma_table_info('material_import_normalized_rows') WHERE name='mapped_values_json'").first<{ present: number }>();
  return row?.present === 1;
}

function adaptiveRowProjection(result: Awaited<ReturnType<MaterialImportRowNormalizer["normalize"]>>): Readonly<{
  mappedValuesJson: string;
  mappingConfidence: number;
  specificationConfidence: number;
  mappingStatus: "EXACT" | "HIGH_CONFIDENCE" | "SUGGESTED" | "UNMAPPED" | "CONFLICT";
  reviewStatus: "AUTO_ACCEPTABLE" | "NEEDS_REVIEW" | "REJECTED";
}> {
  const payload = result.normalized_payload as { row_disposition?: string; basic?: unknown; attributes?: unknown; category_hint?: unknown; supplier_reference?: Record<string, { candidate?: unknown; status?: string }>; adaptive_mapping?: Record<string, { confidence?: number; mapping_status?: string }> };
  if (payload.row_disposition === "SKIPPED") {
    return {
      mappedValuesJson: canonicalJson({}),
      mappingConfidence: 0,
      specificationConfidence: 0,
      mappingStatus: "UNMAPPED",
      reviewStatus: "REJECTED",
    };
  }
  const mappings = Object.values(payload.adaptive_mapping ?? {});
  const statuses = mappings.map((item) => String(item.mapping_status ?? "UNMAPPED"));
  const mappingStatus = statuses.includes("CONFLICT") ? "CONFLICT"
    : statuses.includes("UNMAPPED") || !statuses.length ? "UNMAPPED"
      : statuses.includes("SUGGESTED") ? "SUGGESTED"
        : statuses.includes("HIGH_CONFIDENCE") ? "HIGH_CONFIDENCE" : "EXACT";
  const confidence = mappings.length ? mappings.reduce((sum, item) => sum + Number(item.confidence ?? 0), 0) / mappings.length : 0;
  const specification = payload.supplier_reference?.SUPPLIER_SPECIFICATION;
  const specificationMapping = payload.adaptive_mapping?.["supplier_reference.SUPPLIER_SPECIFICATION"];
  const specificationConfidence = specification?.candidate ? Number(specificationMapping?.confidence ?? 0) : 0;
  const needsReview = result.row_status === "ERROR" || !specification?.candidate || !["EXACT", "CONFIRMED"].includes(String(specificationMapping?.mapping_status ?? ""));
  return {
    mappedValuesJson: canonicalJson({ basic: payload.basic ?? {}, attributes: payload.attributes ?? {}, category_hint: payload.category_hint ?? null, supplier_reference: payload.supplier_reference ?? {} }),
    mappingConfidence: Math.max(0, Math.min(1, confidence)),
    specificationConfidence: Math.max(0, Math.min(1, specificationConfidence)),
    mappingStatus,
    reviewStatus: needsReview ? "NEEDS_REVIEW" : "AUTO_ACCEPTABLE",
  };
}

async function boundFacts(database: MaterialMasterD1Database, run: RunRow): Promise<Readonly<{ batch: BatchRow; mapping: MappingRow }>> {
  const batch = await database.prepare("SELECT id,status,created_by,current_version,current_parse_run_id,current_normalization_run_id FROM material_import_batches WHERE id=?").bind(run.batch_id).first<BatchRow>();
  const mapping = await database.prepare("SELECT * FROM material_import_mappings WHERE id=? AND batch_id=?").bind(run.mapping_id, run.batch_id).first<MappingRow>();
  if (!batch || !mapping || batch.current_parse_run_id !== run.parse_run_id || mapping.parse_run_id !== run.parse_run_id || mapping.mapping_status !== "CONFIRMED" || mapping.mapping_version !== run.mapping_version || mapping.metadata_digest !== run.metadata_digest) {
    throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_MAPPING_STALE", "规范化绑定事实已变化", 409);
  }
  const snapshot = await new MaterialImportMappingMetadataSnapshotService(database).current();
  if (snapshot.metadataDigest !== run.metadata_digest) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_METADATA_CHANGED", "规范化目标元数据已变化", 409);
  const mappingDigest = await sha256(canonicalJson(await normalizationMappingItems(database, mapping.id)));
  if (mappingDigest !== run.mapping_digest) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_MAPPING_STALE", "规范化 Mapping 内容已变化", 409);
  return { batch, mapping };
}

function nextOutboxStatement(
  database: MaterialMasterD1Database,
  run: RunRow,
  jobType: "NORMALIZE_ROW_CHUNK" | "VERIFY_NORMALIZATION" | "PUBLISH_NORMALIZATION",
  clock: () => Date,
  afterRowNumber?: number,
): MaterialMasterD1Statement {
  const now = clock();
  const payload = afterRowNumber === undefined
    ? JSON.stringify({ normalization_run_id: run.id })
    : JSON.stringify({ normalization_run_id: run.id, after_row_number: afterRowNumber });
  return database.prepare(`INSERT OR IGNORE INTO material_import_job_outbox(id,batch_id,parse_run_id,normalization_run_id,job_type,payload_version,payload_json,dispatch_status,dispatch_version,attempt_count,available_at,created_at)
    VALUES(?,?,NULL,?,?,1,?,'PENDING',1,0,?,?)`).bind(crypto.randomUUID(), run.batch_id, run.id, jobType, payload, seconds(now), now.toISOString());
}

async function failRun(database: MaterialMasterD1Database, run: RunRow, leaseDigest: string, error: MaterialImportNormalizationServiceError, clock: () => Date): Promise<void> {
  const now = clock();
  const timestamp = now.toISOString();
  const failureRequestId = crypto.randomUUID();
  const current = await database.prepare("SELECT current_normalization_run_id FROM material_import_batches WHERE id=?").bind(run.batch_id).first<{ current_normalization_run_id: number | null }>();
  const restore = current?.current_normalization_run_id ? "NORMALIZED" : "MAPPING_CONFIRMED";
  await database.batch([
    database.prepare("DELETE FROM material_import_normalization_issues WHERE normalization_run_id=? AND EXISTS(SELECT 1 FROM material_import_normalization_runs r WHERE r.id=? AND r.lease_token_digest=? AND r.run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING'))").bind(run.id, run.id, leaseDigest),
    database.prepare("DELETE FROM material_import_normalized_rows WHERE normalization_run_id=? AND EXISTS(SELECT 1 FROM material_import_normalization_runs r WHERE r.id=? AND r.lease_token_digest=? AND r.run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING'))").bind(run.id, run.id, leaseDigest),
    database.prepare("UPDATE material_import_batches SET status=?,current_version=current_version+1,updated_at=? WHERE id=? AND status IN ('QUEUED_FOR_NORMALIZATION','NORMALIZING') AND EXISTS(SELECT 1 FROM material_import_normalization_runs r WHERE r.id=? AND r.lease_token_digest=? AND r.run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING'))").bind(restore, timestamp, run.batch_id, run.id, leaseDigest),
    database.prepare("UPDATE material_import_normalization_runs SET run_status='FAILED',failure_code=?,safe_failure_message=?,completed_at=?,worker_request_id=?,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING') AND lease_token_digest=?").bind(error.code, error.message.slice(0, 500), timestamp, failureRequestId, timestamp, run.id, leaseDigest),
    database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details_json,created_at) SELECT ?,'NORMALIZATION_FAILED','SYSTEM',NULL,?,?,json_object('normalization_run_id',?,'code',?),? FROM material_import_normalization_runs WHERE id=? AND run_status='FAILED' AND worker_request_id=?").bind(run.batch_id, restore, failureRequestId, run.id, error.code, timestamp, run.id, failureRequestId),
    database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until,created_at) SELECT 'system','MATERIAL_IMPORT_NORMALIZATION_FAILED',?,?,'failed','MATERIAL_IMPORT_NORMALIZATION',?,?,? FROM material_import_normalization_runs WHERE id=? AND run_status='FAILED' AND worker_request_id=?").bind(String(run.id), failureRequestId, error.code, seconds(now) + 1_095 * 86_400, timestamp, run.id, failureRequestId),
  ]);
}

export class MaterialImportNormalizationTaskHandler implements MaterialImportTaskHandler {
  readonly #database: MaterialMasterD1Database;
  readonly #normalizer: MaterialImportRowNormalizer;
  readonly #clock: () => Date;
  constructor(database: MaterialMasterD1Database, normalizer = new MaterialImportRowNormalizer(), clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#normalizer = normalizer;
    this.#clock = clock;
  }

  async handle(task: MaterialImportTask): Promise<MaterialImportTaskDisposition> {
    if (!task.normalizationRunId || !["START_NORMALIZATION", "NORMALIZE_ROW_CHUNK", "VERIFY_NORMALIZATION", "PUBLISH_NORMALIZATION"].includes(task.jobType)) return "ACK";
    const run = await loadRun(this.#database, task);
    if (!run || ["SUCCEEDED", "FAILED", "CANCELLED", "SUPERSEDED"].includes(run.run_status)) return "ACK";
    if (task.jobType === "START_NORMALIZATION" && (run.run_status !== "QUEUED" || run.current_stage !== "LOAD_MAPPING")) return "ACK";
    if (task.jobType === "NORMALIZE_ROW_CHUNK" && (run.run_status !== "RUNNING" || !["READ_SOURCE_ROWS", "NORMALIZE_ROWS"].includes(run.current_stage))) return "ACK";
    if (task.jobType === "VERIFY_NORMALIZATION" && (run.run_status !== "RUNNING" || run.current_stage !== "VERIFY_RESULT")) return "ACK";
    if (task.jobType === "PUBLISH_NORMALIZATION" && (run.run_status !== "STAGED" || run.current_stage !== "PUBLISH_RESULT")) return "ACK";
    const leaseDigest = await claimLease(this.#database, run, this.#clock);
    if (!leaseDigest) return "RETRY";
    try {
      if (task.jobType === "START_NORMALIZATION") await this.#start(run, leaseDigest);
      else if (task.jobType === "NORMALIZE_ROW_CHUNK") await this.#chunk(run, leaseDigest, task.afterRowNumber ?? 0);
      else if (task.jobType === "VERIFY_NORMALIZATION") await this.#verify(run, leaseDigest);
      else await this.#publish(run, leaseDigest);
      return "ACK";
    } catch (error) {
      const failure = error instanceof MaterialImportNormalizationServiceError
        ? error
        : new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_FAILED", "规范化任务处理失败", 500);
      await failRun(this.#database, run, leaseDigest, failure, this.#clock);
      return failure.status >= 500 ? "DEAD" : "ACK";
    }
  }

  async #start(run: RunRow, leaseDigest: string): Promise<void> {
    const { batch } = await boundFacts(this.#database, run);
    if (run.current_stage !== "LOAD_MAPPING" || run.run_status !== "QUEUED") return;
    if (batch.status !== "QUEUED_FOR_NORMALIZATION" || batch.current_version !== run.batch_version_at_start + 1) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "批次版本已变化", 409);
    const timestamp = this.#clock().toISOString();
    await this.#database.batch([
      this.#database.prepare("UPDATE material_import_normalization_runs SET run_status='RUNNING',current_stage='READ_SOURCE_ROWS',lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND run_status='QUEUED' AND lease_token_digest=?").bind(timestamp, run.id, leaseDigest),
      this.#database.prepare("UPDATE material_import_batches SET status='NORMALIZING',updated_at=? WHERE id=? AND status='QUEUED_FOR_NORMALIZATION' AND current_version=?").bind(timestamp, run.batch_id, run.batch_version_at_start + 1),
      this.#database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,'NORMALIZATION_STARTED','SYSTEM','QUEUED_FOR_NORMALIZATION','NORMALIZING',?,json_object('normalization_run_id',?),?)").bind(run.batch_id, crypto.randomUUID(), run.id, timestamp),
      nextOutboxStatement(this.#database, run, "NORMALIZE_ROW_CHUNK", this.#clock, 0),
    ]);
  }

  async #chunk(run: RunRow, leaseDigest: string, afterRowNumber: number): Promise<void> {
    const { batch, mapping } = await boundFacts(this.#database, run);
    if (batch.status !== "NORMALIZING" || batch.current_version !== run.batch_version_at_start + 1) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "批次版本已变化", 409);
    if (!["READ_SOURCE_ROWS", "NORMALIZE_ROWS"].includes(run.current_stage)) return;
    const snapshot = await new MaterialImportMappingMetadataSnapshotService(this.#database).current();
    const items = await normalizationMappingItems(this.#database, mapping.id);
    const adaptive = await adaptiveNormalizationSchemaAvailable(this.#database);
    const adaptiveItems = items.some((item) => item.adaptive_mapping_status !== undefined || item.combination_strategy !== undefined || item.source_column_indexes !== undefined);
    const canonicalContext = adaptive && adaptiveItems
      ? await this.#database.prepare(`SELECT
          (SELECT id FROM material_import_files WHERE batch_id=? ORDER BY id LIMIT 1) source_file_id,
          (SELECT sheet_name FROM material_import_parse_sheets WHERE parse_run_id=? AND sheet_index=?) source_sheet_name,
          (SELECT supplier_key FROM material_import_supplier_profiles WHERE id=?) supplier_id`)
        .bind(run.batch_id, run.parse_run_id, mapping.selected_sheet_index, mapping.supplier_profile_id ?? null)
        .first<{ source_file_id: number | null; source_sheet_name: string | null; supplier_id: string | null }>()
      : null;
    const rows = (await this.#database.prepare(`SELECT row_number,raw_values_json,raw_row_hash,created_at FROM material_import_rows
      WHERE parse_run_id=? AND sheet_index=? AND row_number>? AND (? IS NULL OR row_number>?) ORDER BY row_number LIMIT ?`)
      .bind(run.parse_run_id, mapping.selected_sheet_index, afterRowNumber, mapping.header_row_number, mapping.header_row_number, MATERIAL_IMPORT_NORMALIZATION_LIMITS.logicalRowsPerChunk)
      .all<{ row_number: number; raw_values_json: string; raw_row_hash: string; created_at: string }>()).results ?? [];
    let chunkBytes = 0;
    for (const row of rows) {
      const raw = JSON.parse(row.raw_values_json) as MaterialImportRawRow;
      const classification = adaptive && adaptiveItems
        ? classifyAdaptiveDataRow(raw, items.map((item) => ({
          sourceColumnIndexes: item.source_column_indexes ?? (item.source_column_index === null ? [] : [item.source_column_index]),
          sourceHeaders: item.source_headers ?? [],
        })))
        : undefined;
      const result = await this.#normalizer.normalize({
        lineage: {
          batch_id: run.batch_id,
          parse_run_id: run.parse_run_id,
          normalization_run_id: run.id,
          mapping_id: run.mapping_id,
          mapping_version: run.mapping_version,
          mapping_digest: run.mapping_digest,
          metadata_digest: run.metadata_digest,
          processor_version: run.processor_version,
          sheet_index: mapping.selected_sheet_index,
          row_number: row.row_number,
          source_row_number: row.row_number,
          raw_row_hash: row.raw_row_hash,
        },
        rawRow: raw,
        mappingItems: items,
        metadataSnapshot: snapshot,
        rowClassification: classification,
        canonicalContext: adaptive && adaptiveItems && canonicalContext?.source_file_id && canonicalContext.source_sheet_name ? {
          source_file_id: canonicalContext.source_file_id,
          source_sheet_name: canonicalContext.source_sheet_name,
          supplier_id: canonicalContext.supplier_id,
          supplier_profile_id: mapping.supplier_profile_id ?? null,
          created_at: row.created_at,
        } : undefined,
      });
      chunkBytes += result.normalized_payload_bytes;
      if (chunkBytes > MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxChunkBytes) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "规范化逻辑分块超过字节预算", 409);
      const existing = await this.#database.prepare("SELECT normalized_payload_hash FROM material_import_normalized_rows WHERE normalization_run_id=? AND source_sheet_index=? AND source_row_number=?").bind(run.id, mapping.selected_sheet_index, row.row_number).first<{ normalized_payload_hash: string }>();
      if (existing && existing.normalized_payload_hash !== result.normalized_payload_hash) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "重复行规范化结果不一致", 409);
      if (existing) continue;
      const now = this.#clock().toISOString();
      const adaptiveProjection = adaptiveRowProjection(result);
      const rowInsert = adaptive
        ? this.#database.prepare(`INSERT INTO material_import_normalized_rows(batch_id,normalization_run_id,parse_run_id,source_sheet_index,source_row_number,source_raw_row_hash,normalized_payload_json,normalized_payload_hash,row_status,error_count,warning_count,created_at,updated_at,mapped_values_json,mapping_confidence,specification_confidence,adaptive_mapping_status,review_status)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM material_import_normalization_runs WHERE id=? AND lease_token_digest=? AND run_status='RUNNING')`)
          .bind(run.batch_id, run.id, run.parse_run_id, mapping.selected_sheet_index, row.row_number, row.raw_row_hash, result.normalized_payload_json, result.normalized_payload_hash, result.row_status, result.error_count, result.warning_count, now, now, adaptiveProjection.mappedValuesJson, adaptiveProjection.mappingConfidence, adaptiveProjection.specificationConfidence, adaptiveProjection.mappingStatus, adaptiveProjection.reviewStatus, run.id, leaseDigest)
        : this.#database.prepare(`INSERT INTO material_import_normalized_rows(batch_id,normalization_run_id,parse_run_id,source_sheet_index,source_row_number,source_raw_row_hash,normalized_payload_json,normalized_payload_hash,row_status,error_count,warning_count,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM material_import_normalization_runs WHERE id=? AND lease_token_digest=? AND run_status='RUNNING')`)
          .bind(run.batch_id, run.id, run.parse_run_id, mapping.selected_sheet_index, row.row_number, row.raw_row_hash, result.normalized_payload_json, result.normalized_payload_hash, result.row_status, result.error_count, result.warning_count, now, now, run.id, leaseDigest);
      const statements: MaterialMasterD1Statement[] = [rowInsert];
      for (const entry of result.issues) statements.push(this.#issueStatement(run, mapping.selected_sheet_index, row.row_number, entry, now, leaseDigest));
      statements.push(this.#database.prepare("UPDATE material_import_normalization_runs SET heartbeat_at=?,lease_expires_at=?,updated_at=? WHERE id=? AND lease_token_digest=? AND run_status='RUNNING'").bind(now, seconds(this.#clock()) + LEASE_SECONDS, now, run.id, leaseDigest));
      if (statements.length > MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxStatementsPerBatch) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "规范化单行写入超过 D1 batch 预算", 409);
      await this.#database.batch(statements);
      const written = await this.#database.prepare("SELECT normalized_payload_hash FROM material_import_normalized_rows WHERE normalization_run_id=? AND source_sheet_index=? AND source_row_number=?").bind(run.id, mapping.selected_sheet_index, row.row_number).first<{ normalized_payload_hash: string }>();
      if (!written || written.normalized_payload_hash !== result.normalized_payload_hash) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "规范化租约已失效", 409);
    }
    const totals = await this.#aggregate(run.id);
    if (totals.normalized_json_bytes > MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxBatchPayloadBytes || totals.issue_count > MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxIssuesPerBatch) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "规范化批次超过资源限制", 409);
    const lastRow = rows.at(-1)?.row_number ?? afterRowNumber;
    const finished = rows.length < MATERIAL_IMPORT_NORMALIZATION_LIMITS.logicalRowsPerChunk;
    const timestamp = this.#clock().toISOString();
    await this.#database.batch([
      this.#database.prepare(`UPDATE material_import_normalization_runs SET current_stage=?,processed_rows=?,valid_rows=?,warning_rows=?,error_rows=?,normalized_json_bytes=?,issue_count=?,warning_count=?,error_count=?,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND lease_token_digest=? AND run_status='RUNNING'`)
        .bind(finished ? "VERIFY_RESULT" : "NORMALIZE_ROWS", totals.processed_rows, totals.valid_rows, totals.warning_rows, totals.error_rows, totals.normalized_json_bytes, totals.issue_count, totals.warning_count, totals.error_count, timestamp, run.id, leaseDigest),
      nextOutboxStatement(this.#database, run, finished ? "VERIFY_NORMALIZATION" : "NORMALIZE_ROW_CHUNK", this.#clock, finished ? undefined : lastRow),
    ]);
  }

  #issueStatement(run: RunRow, sheetIndex: number, rowNumber: number, entry: MaterialImportNormalizationIssue, timestamp: string, leaseDigest: string): MaterialMasterD1Statement {
    return this.#database.prepare(`INSERT OR IGNORE INTO material_import_normalization_issues(normalization_run_id,normalized_row_id,issue_level,issue_code,target_code,source_sheet_index,source_row_number,source_column_index,safe_message,safe_details_json,created_at)
      SELECT ?,r.id,?,?,?,?,?,?,?,?,? FROM material_import_normalized_rows r
      WHERE r.normalization_run_id=? AND r.source_sheet_index=? AND r.source_row_number=? AND EXISTS(SELECT 1 FROM material_import_normalization_runs n WHERE n.id=? AND n.lease_token_digest=? AND n.run_status='RUNNING')`)
      .bind(run.id, entry.issue_level, entry.issue_code, entry.target_code, sheetIndex, rowNumber, entry.source_column_index, entry.safe_message.slice(0, 500), canonicalJson(entry.safe_details), timestamp, run.id, sheetIndex, rowNumber, run.id, leaseDigest);
  }

  async #aggregate(runId: number): Promise<Readonly<{ processed_rows: number; valid_rows: number; warning_rows: number; error_rows: number; normalized_json_bytes: number; issue_count: number; warning_count: number; error_count: number }>> {
    const row = await this.#database.prepare(`SELECT COUNT(*) processed_rows,
      SUM(CASE WHEN row_status='VALID' THEN 1 ELSE 0 END) valid_rows,
      SUM(CASE WHEN row_status='WARNING' THEN 1 ELSE 0 END) warning_rows,
      SUM(CASE WHEN row_status='ERROR' THEN 1 ELSE 0 END) error_rows,
      COALESCE(SUM(length(CAST(normalized_payload_json AS BLOB))),0) normalized_json_bytes,
      COALESCE(SUM(warning_count),0) warning_count,COALESCE(SUM(error_count),0) error_count
      FROM material_import_normalized_rows WHERE normalization_run_id=?`).bind(runId).first<Record<string, number>>();
    const issue = await this.#database.prepare("SELECT COUNT(*) issue_count FROM material_import_normalization_issues WHERE normalization_run_id=?").bind(runId).first<{ issue_count: number }>();
    return {
      processed_rows: Number(row?.processed_rows ?? 0), valid_rows: Number(row?.valid_rows ?? 0), warning_rows: Number(row?.warning_rows ?? 0), error_rows: Number(row?.error_rows ?? 0),
      normalized_json_bytes: Number(row?.normalized_json_bytes ?? 0), issue_count: Number(issue?.issue_count ?? 0), warning_count: Number(row?.warning_count ?? 0), error_count: Number(row?.error_count ?? 0),
    };
  }

  async #verify(run: RunRow, leaseDigest: string): Promise<void> {
    const { batch, mapping } = await boundFacts(this.#database, run);
    if (batch.status !== "NORMALIZING" || batch.current_version !== run.batch_version_at_start + 1 || run.current_stage !== "VERIFY_RESULT") throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "发布前批次事实已变化", 409);
    const totals = await this.#aggregate(run.id);
    if (totals.processed_rows !== run.total_rows || totals.valid_rows + totals.warning_rows + totals.error_rows !== totals.processed_rows || totals.issue_count !== totals.warning_count + totals.error_count) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_FAILED", "规范化结果完整性核验失败", 409);
    const rowProjection = (await this.#database.prepare("SELECT source_sheet_index,source_row_number,normalized_payload_hash,row_status,error_count,warning_count FROM material_import_normalized_rows WHERE normalization_run_id=? ORDER BY source_sheet_index,source_row_number").bind(run.id).all<Record<string, unknown>>()).results ?? [];
    const issueProjection = (await this.#database.prepare("SELECT source_sheet_index,source_row_number,source_column_index,target_code,issue_level,issue_code FROM material_import_normalization_issues WHERE normalization_run_id=? ORDER BY source_sheet_index,source_row_number,id").bind(run.id).all<Record<string, unknown>>()).results ?? [];
    const resultDigest = await sha256(canonicalJson({ mapping_id: mapping.id, metadata_digest: run.metadata_digest, rows: rowProjection, issues: issueProjection }));
    const timestamp = this.#clock().toISOString();
    await this.#database.batch([
      this.#database.prepare(`UPDATE material_import_normalization_runs SET run_status='STAGED',current_stage='PUBLISH_RESULT',processed_rows=?,valid_rows=?,warning_rows=?,error_rows=?,normalized_json_bytes=?,issue_count=?,warning_count=?,error_count=?,result_digest=?,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND run_status='RUNNING' AND lease_token_digest=?`).bind(totals.processed_rows, totals.valid_rows, totals.warning_rows, totals.error_rows, totals.normalized_json_bytes, totals.issue_count, totals.warning_count, totals.error_count, resultDigest, timestamp, run.id, leaseDigest),
      nextOutboxStatement(this.#database, run, "PUBLISH_NORMALIZATION", this.#clock),
    ]);
  }

  async #publish(run: RunRow, leaseDigest: string): Promise<void> {
    const fresh = await this.#database.prepare("SELECT * FROM material_import_normalization_runs WHERE id=?").bind(run.id).first<RunRow>();
    if (!fresh || fresh.run_status !== "STAGED" || fresh.current_stage !== "PUBLISH_RESULT" || !fresh.result_digest) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_FAILED", "规范化结果尚未完成核验", 409);
    const { batch } = await boundFacts(this.#database, fresh);
    if (batch.status !== "NORMALIZING" || batch.current_version !== fresh.batch_version_at_start + 1 || fresh.processed_rows !== fresh.total_rows) throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "发布前批次版本已变化", 409);
    const previousRunId = batch.current_normalization_run_id;
    const timestamp = this.#clock().toISOString();
    const statements: MaterialMasterD1Statement[] = [
      this.#database.prepare("UPDATE material_import_normalization_runs SET run_status='SUCCEEDED',current_stage='COMPLETE',completed_at=?,detail_retention_until=NULL,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND run_status='STAGED' AND lease_token_digest=? AND result_digest IS NOT NULL").bind(timestamp, timestamp, fresh.id, leaseDigest),
      this.#database.prepare("UPDATE material_import_batches SET current_normalization_run_id=?,status='NORMALIZED',current_version=current_version+1,updated_at=? WHERE id=? AND status='NORMALIZING' AND current_version=? AND current_parse_run_id=?").bind(fresh.id, timestamp, fresh.batch_id, fresh.batch_version_at_start + 1, fresh.parse_run_id),
    ];
    if (previousRunId && previousRunId !== fresh.id) statements.push(this.#database.prepare("UPDATE material_import_normalization_runs SET run_status='SUPERSEDED',detail_retention_until=?,updated_at=? WHERE id=? AND batch_id=? AND run_status='SUCCEEDED'").bind(seconds(this.#clock()) + RETENTION_SECONDS, timestamp, previousRunId, fresh.batch_id));
    statements.push(
      this.#database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details_json,created_at) VALUES((SELECT CASE WHEN current_normalization_run_id=? AND status='NORMALIZED' THEN id ELSE NULL END FROM material_import_batches WHERE id=?),'NORMALIZATION_PUBLISHED','SYSTEM','NORMALIZING','NORMALIZED',?,json_object('normalization_run_id',?,'result_digest',?),?)").bind(fresh.id, fresh.batch_id, crypto.randomUUID(), fresh.id, fresh.result_digest, timestamp),
      this.#database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES('system','MATERIAL_IMPORT_NORMALIZATION_PUBLISHED',?,?,'success','MATERIAL_IMPORT_NORMALIZATION',?,?)").bind(String(fresh.id), crypto.randomUUID(), seconds(this.#clock()) + 1_095 * 86_400, timestamp),
    );
    await this.#database.batch(statements);
    const published = await this.#database.prepare("SELECT current_normalization_run_id,status FROM material_import_batches WHERE id=?").bind(fresh.batch_id).first<{ current_normalization_run_id: number | null; status: string }>();
    if (published?.current_normalization_run_id !== fresh.id || published.status !== "NORMALIZED") throw new MaterialImportNormalizationServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "规范化发布竞争失败", 409);
  }
}
