import { createHash } from "node:crypto";

import type { MaterialMasterD1Database } from "../material-master/index.ts";
import {
  detectMaterialImportFileType,
  MaterialImportFileSecurityError,
  runMaterialImportBasicSecurityCheck,
  type MaterialImportDetectedType,
} from "./file-security.ts";
import {
  MATERIAL_IMPORT_MAX_FILE_BYTES,
  MaterialImportMultipartError,
  readSingleFilePart,
} from "./multipart.ts";
import type { MaterialImportObjectStore } from "./object-store.ts";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_RECOVERY_SECONDS = 7 * 24 * 60 * 60;
const IDEMPOTENCY_LEASE_SECONDS = 120;
const RAW_RETENTION_DAYS = 30;
const RECORD_RETENTION_DAYS = 1095;

export type MaterialImportUser = Readonly<{ username: string }>;
export type MaterialImportServiceResult = Readonly<{
  status: number;
  payload: Record<string, unknown>;
  replayed?: boolean;
}>;

export class MaterialImportServiceError extends Error {
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

type BatchRow = {
  id: number;
  batch_no: string;
  source_kind: "XLSX" | "CSV";
  status: "CREATED" | "UPLOAD_PENDING" | "FILE_READY" | "RECONCILIATION_REQUIRED" | "FAILED" | "CANCELLED";
  retry_of_batch_id: number | null;
  created_by: string;
  current_version: number;
  file_count: number;
  total_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  failure_stage: string | null;
  failure_code: string | null;
  failure_message: string | null;
  cancelled_at: string | null;
  terminal_at: string | null;
  raw_data_retention_until: string | null;
  record_retention_until: string | null;
  created_at: string;
  updated_at: string;
};

type FileRow = {
  id: number;
  batch_id: number;
  object_key: string;
  original_filename: string;
  filename_extension: string | null;
  declared_mime_type: string | null;
  declared_sha256: string;
  declared_size_bytes: number | null;
  detected_file_type: MaterialImportDetectedType | null;
  actual_sha256: string | null;
  actual_size_bytes: number | null;
  object_etag: string | null;
  storage_status: "UPLOAD_PENDING" | "STORED" | "RECONCILIATION_REQUIRED" | "STORAGE_FAILED" | "DELETE_PENDING" | "DELETED";
  security_check_status: "NOT_STARTED" | "PENDING" | "BASIC_CHECK_PASSED" | "REJECTED";
  security_failure_code: string | null;
  security_failure_message: string | null;
  uploaded_at: string | null;
  retention_until: string | null;
  created_at: string;
  updated_at: string;
};

type IdempotencyRow = {
  id: number;
  username: string;
  route_scope: string;
  key_digest: string;
  request_digest: string;
  operation_id: string;
  state: "PENDING" | "COMPLETED";
  batch_id: number | null;
  file_id: number | null;
  lease_expires_at: number | null;
  status_code: number | null;
  response_json: string | null;
  recovery_until: number;
};

export type MaterialImportServiceDependencies = Readonly<{
  database: MaterialMasterD1Database;
  objectStore: MaterialImportObjectStore;
  objectPrefix?: string;
  clock?: () => Date;
}>;

function nowText(clock: () => Date): string {
  return clock().toISOString();
}

function nowSeconds(clock: () => Date): number {
  return Math.floor(clock().getTime() / 1000);
}

function retentionFrom(terminalAt: string, days: number): string {
  const date = new Date(terminalAt);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertIdempotencyKey(key: string): void {
  if (key.length < 8 || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 必须为 8 到 200 个安全字符", 400);
  }
}

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function sanitizeFilename(filename: string): string {
  const normalized = filename.normalize("NFKC").replaceAll("\\", "/");
  const basename = normalized.split("/").pop() ?? "";
  const sanitized = basename.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._()\- ]/gu, "_").trim();
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new MaterialImportServiceError("INVALID_REQUEST", "文件名无效", 400);
  }
  return sanitized.slice(0, 255);
}

function filenameExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index < 0 ? "" : filename.slice(index).toLowerCase();
}

function parsePositiveInteger(value: string | null, field: string): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new MaterialImportServiceError("INVALID_REQUEST", `${field} 必须是正整数`, 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new MaterialImportServiceError("INVALID_REQUEST", `${field} 超出允许范围`, 400);
  return parsed;
}

function batchProjection(row: BatchRow): Record<string, unknown> {
  return {
    id: row.id,
    batch_no: row.batch_no,
    source_kind: row.source_kind,
    status: row.status,
    retry_of_batch_id: row.retry_of_batch_id,
    created_by: row.created_by,
    current_version: row.current_version,
    file_count: row.file_count,
    total_rows: row.total_rows,
    accepted_rows: row.accepted_rows,
    rejected_rows: row.rejected_rows,
    failure_stage: row.failure_stage,
    failure_code: row.failure_code,
    failure_message: row.failure_message,
    cancelled_at: row.cancelled_at,
    terminal_at: row.terminal_at,
    raw_data_retention_until: row.raw_data_retention_until,
    record_retention_until: row.record_retention_until,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function fileProjection(row: FileRow | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id,
    original_filename: row.original_filename,
    filename_extension: row.filename_extension,
    declared_mime_type: row.declared_mime_type,
    declared_sha256: row.declared_sha256,
    declared_size_bytes: row.declared_size_bytes,
    detected_file_type: row.detected_file_type,
    actual_sha256: row.actual_sha256,
    actual_size_bytes: row.actual_size_bytes,
    storage_status: row.storage_status,
    security_check_status: row.security_check_status,
    security_failure_code: row.security_failure_code,
    security_failure_message: row.security_failure_message,
    uploaded_at: row.uploaded_at,
    retention_until: row.retention_until,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function batchById(database: MaterialMasterD1Database, batchId: number): Promise<BatchRow | null> {
  return database.prepare("SELECT * FROM material_import_batches WHERE id=?").bind(batchId).first<BatchRow>();
}

async function fileByBatch(database: MaterialMasterD1Database, batchId: number): Promise<FileRow | null> {
  return database.prepare("SELECT * FROM material_import_files WHERE batch_id=?").bind(batchId).first<FileRow>();
}

async function detailPayload(database: MaterialMasterD1Database, batchId: number): Promise<Record<string, unknown>> {
  const batch = await batchById(database, batchId);
  if (!batch) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return { data: { batch: batchProjection(batch), file: fileProjection(await fileByBatch(database, batchId)) } };
}

async function idempotencyRow(
  database: MaterialMasterD1Database,
  username: string,
  routeScope: string,
  keyDigest: string,
): Promise<IdempotencyRow | null> {
  return database.prepare(`
    SELECT * FROM material_import_idempotency
    WHERE username=? AND method='POST' AND route_scope=? AND key_digest=?
  `).bind(username, routeScope, keyDigest).first<IdempotencyRow>();
}

function replay(row: IdempotencyRow): MaterialImportServiceResult {
  if (row.state !== "COMPLETED" || !row.response_json || !row.status_code) {
    throw new MaterialImportServiceError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "相同操作正在处理", 409);
  }
  return { status: row.status_code, payload: JSON.parse(row.response_json) as Record<string, unknown>, replayed: true };
}

async function finalizeIdempotency(
  database: MaterialMasterD1Database,
  id: number,
  status: number,
  payload: Record<string, unknown>,
  clock: () => Date,
): Promise<void> {
  const now = nowSeconds(clock);
  await database.prepare(`
    UPDATE material_import_idempotency
    SET state='COMPLETED',lease_expires_at=NULL,status_code=?,response_json=?,updated_at=?,expires_at=?
    WHERE id=? AND state='PENDING'
  `).bind(status, JSON.stringify(payload), nowText(clock), now + IDEMPOTENCY_TTL_SECONDS, id).run();
}

async function enforceRateLimit(
  database: MaterialMasterD1Database,
  username: string,
  keyDigest: string,
  isNewKey: boolean,
  clock: () => Date,
): Promise<void> {
  const bucket = Math.floor(nowSeconds(clock) / 60) * 60;
  const timestamp = nowText(clock);
  const existing = await database.prepare(`SELECT attempt_count,new_key_count FROM material_api_rate_limit_buckets WHERE username=? AND bucket_start=?`).bind(username, bucket).first<{ attempt_count: number; new_key_count: number }>();
  if ((existing?.attempt_count ?? 0) >= 60 || (isNewKey && (existing?.new_key_count ?? 0) >= 20)) {
    throw new MaterialImportServiceError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
  }
  const token = keyDigest;
  await database.prepare(`
    INSERT INTO material_api_rate_limit_buckets(
      username,bucket_start,attempt_count,new_key_count,rejected_count,
      last_attempt_token_digest,last_new_key_token_digest,created_at,updated_at
    ) VALUES(?,?,1,?,0,?,?,?,?)
    ON CONFLICT(username,bucket_start) DO UPDATE SET
      attempt_count=attempt_count+1,
      new_key_count=new_key_count+excluded.new_key_count,
      last_attempt_token_digest=excluded.last_attempt_token_digest,
      last_new_key_token_digest=CASE WHEN excluded.new_key_count=1 THEN excluded.last_new_key_token_digest ELSE last_new_key_token_digest END,
      updated_at=excluded.updated_at
  `).bind(username, bucket, isNewKey ? 1 : 0, token, isNewKey ? token : "", timestamp, timestamp).run();
}

function auditStatement(
  database: MaterialMasterD1Database,
  input: Readonly<{ username: string; action: string; detail: string; requestId: string; operationId: string; keyDigest: string; result: string; errorCode?: string; timestamp: string }>,
) {
  return database.prepare(`
    INSERT INTO audit_log(username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,error_code,retention_until,created_at)
    VALUES(?,?,?,?,?,'MATERIAL_IMPORT_BATCH',?,?,?,?,?)
  `).bind(
    input.username, input.action, input.detail, input.requestId, input.result,
    input.operationId, input.keyDigest, input.errorCode ?? "",
    Math.floor(new Date(input.timestamp).getTime() / 1000) + RECORD_RETENTION_DAYS * 86400,
    input.timestamp,
  );
}

export async function createMaterialImportBatch(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{
    user: MaterialImportUser;
    rawKey: string;
    requestId: string;
    sourceKind: unknown;
    retryOfBatchId?: unknown;
    canReadAny: boolean;
  }>,
): Promise<MaterialImportServiceResult> {
  const clock = dependencies.clock ?? (() => new Date());
  assertIdempotencyKey(input.rawKey);
  if (input.sourceKind !== "XLSX" && input.sourceKind !== "CSV") {
    throw new MaterialImportServiceError("INVALID_REQUEST", "source_kind 只允许 XLSX 或 CSV", 400);
  }
  const retryOf = input.retryOfBatchId === undefined || input.retryOfBatchId === null
    ? null
    : Number(input.retryOfBatchId);
  if (retryOf !== null && (!Number.isSafeInteger(retryOf) || retryOf <= 0)) {
    throw new MaterialImportServiceError("INVALID_REQUEST", "retry_of_batch_id 无效", 400);
  }
  if (retryOf !== null) {
    const source = await batchById(dependencies.database, retryOf);
    if (!source || (!input.canReadAny && source.created_by !== input.user.username)) {
      throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
    }
    if (source.status !== "FAILED") throw new MaterialImportServiceError("IMPORT_BATCH_STATE_INVALID", "只有失败批次可以作为重试来源", 409);
  }
  const routeScope = "/api/material-master/import-batches";
  const keyDigest = await sha256(input.rawKey);
  const requestDigest = await sha256(canonical({ method: "POST", path: routeScope, retry_of_batch_id: retryOf, source_kind: input.sourceKind }));
  let existing = await idempotencyRow(dependencies.database, input.user.username, routeScope, keyDigest);
  await enforceRateLimit(dependencies.database, input.user.username, keyDigest, !existing, clock);
  if (existing) {
    if (existing.request_digest !== requestDigest) throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key 已用于不同请求", 409);
    if (existing.state === "COMPLETED") return replay(existing);
    if (existing.batch_id) {
      const payload = { data: batchProjection((await batchById(dependencies.database, existing.batch_id))!) };
      await finalizeIdempotency(dependencies.database, existing.id, 201, payload, clock);
      return { status: 201, payload, replayed: true };
    }
    throw new MaterialImportServiceError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "相同操作正在处理", 409);
  }
  const operationId = crypto.randomUUID();
  const batchNo = `MIB-${clock().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${operationId.slice(0, 8).toUpperCase()}`;
  const timestamp = nowText(clock);
  const lease = nowSeconds(clock) + IDEMPOTENCY_LEASE_SECONDS;
  const recovery = nowSeconds(clock) + IDEMPOTENCY_RECOVERY_SECONDS;
  try {
    await dependencies.database.batch([
      dependencies.database.prepare(`
        INSERT INTO material_import_batches(batch_no,source_kind,status,retry_of_batch_id,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at)
        VALUES(?,?,'CREATED',?,?,1,0,0,0,0,?,?)
      `).bind(batchNo, input.sourceKind, retryOf, input.user.username, timestamp, timestamp),
      dependencies.database.prepare(`
        INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at)
        SELECT id,'BATCH_CREATED','USER',?,NULL,'CREATED',?,json_object('source_kind',?),? FROM material_import_batches WHERE batch_no=?
      `).bind(input.user.username, input.requestId, input.sourceKind, timestamp, batchNo),
      dependencies.database.prepare(`
        INSERT INTO material_import_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until)
        SELECT ?,'POST',?,?,?,?,'PENDING',id,?,?,?, ?,? FROM material_import_batches WHERE batch_no=?
      `).bind(input.user.username, routeScope, keyDigest, requestDigest, operationId, await sha256(`${operationId}:lease`), lease, timestamp, timestamp, recovery, batchNo),
      auditStatement(dependencies.database, { username: input.user.username, action: "CREATE_IMPORT_BATCH", detail: batchNo, requestId: input.requestId, operationId, keyDigest, result: "success", timestamp }),
    ]);
  } catch (error) {
    existing = await idempotencyRow(dependencies.database, input.user.username, routeScope, keyDigest);
    if (!existing) throw error;
    if (existing.request_digest !== requestDigest) throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key 已用于不同请求", 409);
    if (existing.state === "COMPLETED") return replay(existing);
  }
  existing = await idempotencyRow(dependencies.database, input.user.username, routeScope, keyDigest);
  if (!existing?.batch_id) throw new MaterialImportServiceError("INTERNAL_ERROR", "批次创建结果无法确认", 500);
  const batch = await batchById(dependencies.database, existing.batch_id);
  if (!batch) throw new MaterialImportServiceError("INTERNAL_ERROR", "批次创建结果无法确认", 500);
  const payload = { data: batchProjection(batch) };
  await finalizeIdempotency(dependencies.database, existing.id, 201, payload, clock);
  return { status: 201, payload };
}

async function hashStoredObject(
  store: MaterialImportObjectStore,
  key: string,
): Promise<{ actualSizeBytes: number; actualSha256: string; prefix: Uint8Array }> {
  const stream = await store.open(key);
  if (!stream) throw new MaterialImportServiceError("IMPORT_FILE_STORAGE_FAILED", "对象存储结果不可确认", 503);
  const reader = stream.getReader();
  const hash = createHash("sha256");
  let size = 0;
  let prefix = new Uint8Array(0);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > MATERIAL_IMPORT_MAX_FILE_BYTES) throw new MaterialImportServiceError("IMPORT_FILE_TOO_LARGE", "文件超过 10 MiB 上限", 413);
      hash.update(value);
      if (prefix.byteLength < 8192) {
        const take = value.slice(0, Math.min(value.byteLength, 8192 - prefix.byteLength));
        const combined = new Uint8Array(prefix.byteLength + take.byteLength);
        combined.set(prefix);
        combined.set(take, prefix.byteLength);
        prefix = combined;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { actualSizeBytes: size, actualSha256: hash.digest("hex"), prefix };
}

async function updateReconciliation(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{ batchId: number; fileId: number; idempotencyId: number; user: string; requestId: string; operationId: string; keyDigest: string; reason: string }>,
): Promise<MaterialImportServiceResult> {
  const clock = dependencies.clock ?? (() => new Date());
  const timestamp = nowText(clock);
  const currentBatch = await batchById(dependencies.database, input.batchId);
  const currentFile = await fileByBatch(dependencies.database, input.batchId);
  if (!currentBatch || !currentFile) throw new MaterialImportServiceError("INTERNAL_ERROR", "协调状态无法记录", 500);
  const projectedBatch = { ...currentBatch, status: "RECONCILIATION_REQUIRED" as const, current_version: currentBatch.current_version + 1, updated_at: timestamp };
  const projectedFile = { ...currentFile, storage_status: "RECONCILIATION_REQUIRED" as const, updated_at: timestamp };
  const payload = {
    code: "IMPORT_BATCH_RECONCILIATION_REQUIRED",
    message: "上传结果需要受控协调，当前不视为成功",
    data: { batch: batchProjection(projectedBatch), file: fileProjection(projectedFile) },
  };
  await dependencies.database.batch([
    dependencies.database.prepare(`UPDATE material_import_batches SET status='RECONCILIATION_REQUIRED',current_version=current_version+1,updated_at=? WHERE id=? AND status='UPLOAD_PENDING'`).bind(timestamp, input.batchId),
    dependencies.database.prepare(`UPDATE material_import_files SET storage_status='RECONCILIATION_REQUIRED',updated_at=? WHERE id=?`).bind(timestamp, input.fileId),
    dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,'RECONCILIATION_REQUIRED','SYSTEM',NULL,'UPLOAD_PENDING','RECONCILIATION_REQUIRED',?,json_object('reason_code',?),?)`).bind(input.batchId, input.requestId, input.reason, timestamp),
    dependencies.database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=202,response_json=?,updated_at=?,expires_at=? WHERE id=? AND state='PENDING'`).bind(JSON.stringify(payload), timestamp, nowSeconds(clock) + IDEMPOTENCY_TTL_SECONDS, input.idempotencyId),
    auditStatement(dependencies.database, { username: input.user, action: "UPLOAD_IMPORT_FILE", detail: `batch:${input.batchId}`, requestId: input.requestId, operationId: input.operationId, keyDigest: input.keyDigest, result: "failed", errorCode: "IMPORT_BATCH_RECONCILIATION_REQUIRED", timestamp }),
  ]);
  return { status: 202, payload };
}

async function updateFailedUpload(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{
    batchId: number;
    fileId: number;
    idempotencyId: number;
    user: string;
    requestId: string;
    operationId: string;
    keyDigest: string;
    failureStage: string;
    code: string;
    message: string;
    status: number;
    storageStatus: FileRow["storage_status"];
    securityStatus?: FileRow["security_check_status"];
  }>,
): Promise<MaterialImportServiceResult> {
  const clock = dependencies.clock ?? (() => new Date());
  const terminal = nowText(clock);
  const rawUntil = retentionFrom(terminal, RAW_RETENTION_DAYS);
  const recordUntil = retentionFrom(terminal, RECORD_RETENTION_DAYS);
  const payload = { error: { code: input.code, message: input.message } };
  const security = input.securityStatus ?? "NOT_STARTED";
  const event = input.failureStage === "FILE_SECURITY" ? "FILE_SECURITY_CHECK_FAILED" : "FILE_UPLOAD_FAILED";
  await dependencies.database.batch([
    dependencies.database.prepare(`
      UPDATE material_import_batches SET status='FAILED',current_version=current_version+1,
        failure_stage=?,failure_code=?,failure_message=?,terminal_at=?,raw_data_retention_until=?,record_retention_until=?,updated_at=?
      WHERE id=? AND status IN ('UPLOAD_PENDING','RECONCILIATION_REQUIRED')
    `).bind(input.failureStage, input.code, input.message, terminal, rawUntil, recordUntil, terminal, input.batchId),
    dependencies.database.prepare(`
      UPDATE material_import_files SET storage_status=?,security_check_status=?,
        security_failure_code=CASE WHEN ?='REJECTED' THEN ? ELSE NULL END,
        security_failure_message=CASE WHEN ?='REJECTED' THEN ? ELSE NULL END,
        retention_until=?,updated_at=? WHERE id=?
    `).bind(input.storageStatus, security, security, input.code, security, input.message, rawUntil, terminal, input.fileId),
    dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,?,'SYSTEM',NULL,'UPLOAD_PENDING','FAILED',?,json_object('failure_stage',?,'failure_code',?),?)`).bind(input.batchId, event, input.requestId, input.failureStage, input.code, terminal),
    dependencies.database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=?,response_json=?,updated_at=?,expires_at=? WHERE id=? AND state='PENDING'`).bind(input.status, JSON.stringify(payload), terminal, nowSeconds(clock) + IDEMPOTENCY_TTL_SECONDS, input.idempotencyId),
    auditStatement(dependencies.database, { username: input.user, action: "UPLOAD_IMPORT_FILE", detail: `batch:${input.batchId}`, requestId: input.requestId, operationId: input.operationId, keyDigest: input.keyDigest, result: "failed", errorCode: input.code, timestamp: terminal }),
  ]);
  return { status: input.status, payload };
}

async function bestEffortDelete(
  dependencies: MaterialImportServiceDependencies,
  batchId: number,
  fileId: number,
  objectKey: string,
  requestId: string,
): Promise<void> {
  const clock = dependencies.clock ?? (() => new Date());
  const timestamp = nowText(clock);
  try {
    await dependencies.objectStore.delete(objectKey);
    await dependencies.database.batch([
      dependencies.database.prepare(`UPDATE material_import_files SET storage_status='DELETED',updated_at=? WHERE id=? AND storage_status='DELETE_PENDING'`).bind(timestamp, fileId),
      dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_DELETED','SYSTEM',?,json_object('file_id',?),?)`).bind(batchId, requestId, fileId, timestamp),
    ]);
  } catch {
    await dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_DELETE_FAILED','SYSTEM',?,json_object('failure_code','OBJECT_DELETE_FAILED'),?)`).bind(batchId, requestId, timestamp).run().catch(() => undefined);
  }
}

export async function uploadMaterialImportFile(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{
    request: Request;
    batchId: number;
    user: MaterialImportUser;
    canReadAny: boolean;
    rawKey: string;
    requestId: string;
  }>,
): Promise<MaterialImportServiceResult> {
  const clock = dependencies.clock ?? (() => new Date());
  assertIdempotencyKey(input.rawKey);
  const expectedVersion = parsePositiveInteger(input.request.headers.get("X-Expected-Version"), "X-Expected-Version");
  const declaredSha256 = (input.request.headers.get("X-File-SHA256") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(declaredSha256)) throw new MaterialImportServiceError("INVALID_REQUEST", "X-File-SHA256 必须是 64 位小写十六进制", 400);
  const sizeHeader = input.request.headers.get("X-File-Size");
  const declaredSize = sizeHeader === null ? null : Number(sizeHeader);
  if (sizeHeader !== null && (!/^\d+$/.test(sizeHeader) || !Number.isSafeInteger(declaredSize) || declaredSize < 0)) {
    throw new MaterialImportServiceError("INVALID_REQUEST", "X-File-Size 必须是非负整数", 400);
  }
  const duplicateAction = (input.request.headers.get("X-Duplicate-Action") ?? "REJECT").toUpperCase();
  if (duplicateAction !== "REJECT" && duplicateAction !== "ALLOW_DUPLICATE") {
    throw new MaterialImportServiceError("INVALID_REQUEST", "X-Duplicate-Action 无效", 400);
  }
  let part;
  try {
    part = await readSingleFilePart(input.request);
  } catch (error) {
    if (error instanceof MaterialImportMultipartError) throw new MaterialImportServiceError(error.code, error.message, error.status);
    throw error;
  }
  void part.completion.catch(() => undefined);
  const sanitizedFilename = sanitizeFilename(part.filename);
  const extension = filenameExtension(sanitizedFilename);
  const routeScope = `/api/material-master/import-batches/${input.batchId}/file`;
  const keyDigest = await sha256(input.rawKey);
  const requestDigest = await sha256(canonical({
    batch_id: input.batchId,
    declared_mime_type: part.declaredMimeType,
    declared_sha256: declaredSha256,
    declared_size: declaredSize,
    duplicate_action: duplicateAction,
    expected_version: expectedVersion,
    method: "POST",
    path: routeScope,
    sanitized_filename: sanitizedFilename,
  }));
  let idem = await idempotencyRow(dependencies.database, input.user.username, routeScope, keyDigest);
  const resumedExistingIdempotency = Boolean(idem);
  await enforceRateLimit(dependencies.database, input.user.username, keyDigest, !idem, clock);
  if (idem?.request_digest !== undefined && idem.request_digest !== requestDigest) {
    await part.stream.cancel().catch(() => undefined);
    throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key 已用于不同请求", 409);
  }
  if (idem?.state === "COMPLETED") {
    await part.stream.cancel().catch(() => undefined);
    return replay(idem);
  }
  const batch = await batchById(dependencies.database, input.batchId);
  if (!batch || (!input.canReadAny && batch.created_by !== input.user.username)) {
    await part.stream.cancel().catch(() => undefined);
    throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  }
  let operationId = idem?.operation_id ?? crypto.randomUUID();
  const objectPrefix = (dependencies.objectPrefix ?? "local").replace(/^\/+|\/+$/g, "");
  const objectKey = `${objectPrefix}/material-import/${input.batchId}/${operationId}`;
  let file = await fileByBatch(dependencies.database, input.batchId);
  if (!idem) {
    if (batch.status !== "CREATED") {
      await part.stream.cancel().catch(() => undefined);
      if (batch.current_version !== expectedVersion) throw new MaterialImportServiceError("IMPORT_BATCH_VERSION_CONFLICT", "批次版本已变化", 409, batch.current_version);
      throw new MaterialImportServiceError("IMPORT_BATCH_STATE_INVALID", "当前批次状态不允许上传", 409);
    }
    if (batch.current_version !== expectedVersion) {
      await part.stream.cancel().catch(() => undefined);
      throw new MaterialImportServiceError("IMPORT_BATCH_VERSION_CONFLICT", "批次版本已变化", 409, batch.current_version);
    }
    if (file) {
      await part.stream.cancel().catch(() => undefined);
      throw new MaterialImportServiceError("IMPORT_FILE_ALREADY_ATTACHED", "批次已绑定文件", 409);
    }
    const pendingCount = await dependencies.database.prepare(`SELECT COUNT(*) AS count FROM material_import_idempotency WHERE username=? AND state='PENDING' AND route_scope LIKE '%/file' AND lease_expires_at>?`).bind(input.user.username, nowSeconds(clock)).first<{ count: number }>();
    if ((pendingCount?.count ?? 0) >= 2) {
      await part.stream.cancel().catch(() => undefined);
      throw new MaterialImportServiceError("RATE_LIMITED", "并发上传数量已达上限", 429);
    }
    const timestamp = nowText(clock);
    try {
      await dependencies.database.batch([
        dependencies.database.prepare(`UPDATE material_import_batches SET status='UPLOAD_PENDING',current_version=current_version+1,file_count=1,updated_at=? WHERE id=? AND status='CREATED' AND current_version=?`).bind(timestamp, input.batchId, expectedVersion),
        dependencies.database.prepare(`
          INSERT INTO material_import_files(batch_id,object_key,original_filename,filename_extension,declared_mime_type,declared_sha256,declared_size_bytes,storage_status,security_check_status,created_at,updated_at)
          SELECT id,?,?,?,?,?,?,'UPLOAD_PENDING','NOT_STARTED',?,? FROM material_import_batches
          WHERE id=? AND status='UPLOAD_PENDING' AND current_version=?
        `).bind(objectKey, sanitizedFilename, extension || null, part.declaredMimeType || null, declaredSha256, declaredSize, timestamp, timestamp, input.batchId, expectedVersion + 1),
        dependencies.database.prepare(`
          INSERT INTO material_import_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,file_id,lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until)
          SELECT ?,'POST',?,?,?,?,'PENDING',?,id,?,?,?, ?,? FROM material_import_files WHERE batch_id=?
        `).bind(input.user.username, routeScope, keyDigest, requestDigest, operationId, input.batchId, await sha256(`${operationId}:lease`), nowSeconds(clock) + IDEMPOTENCY_LEASE_SECONDS, timestamp, timestamp, nowSeconds(clock) + IDEMPOTENCY_RECOVERY_SECONDS, input.batchId),
        dependencies.database.prepare(`
          INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at)
          VALUES((SELECT CASE WHEN status='UPLOAD_PENDING' AND current_version=? THEN id ELSE NULL END FROM material_import_batches WHERE id=?),'FILE_UPLOAD_STARTED','USER',?,'CREATED','UPLOAD_PENDING',?,json_object('filename',?),?)
        `).bind(expectedVersion + 1, input.batchId, input.user.username, input.requestId, sanitizedFilename, timestamp),
      ]);
    } catch {
      const refreshed = await batchById(dependencies.database, input.batchId);
      await part.stream.cancel().catch(() => undefined);
      if (!refreshed || (!input.canReadAny && refreshed.created_by !== input.user.username)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
      if (refreshed.current_version !== expectedVersion) throw new MaterialImportServiceError("IMPORT_BATCH_VERSION_CONFLICT", "批次版本已变化", 409, refreshed.current_version);
      throw new MaterialImportServiceError("IMPORT_FILE_ALREADY_ATTACHED", "批次已绑定文件", 409);
    }
    idem = await idempotencyRow(dependencies.database, input.user.username, routeScope, keyDigest);
    file = await fileByBatch(dependencies.database, input.batchId);
  }
  if (!idem || !file) {
    await part.stream.cancel().catch(() => undefined);
    throw new MaterialImportServiceError("INTERNAL_ERROR", "上传意图无法确认", 500);
  }
  if (resumedExistingIdempotency && idem.lease_expires_at && idem.lease_expires_at > nowSeconds(clock)) {
    await part.stream.cancel().catch(() => undefined);
    throw new MaterialImportServiceError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "相同上传正在处理", 409);
  }
  operationId = idem.operation_id;

  let facts: { actualSizeBytes: number; actualSha256: string; prefix: Uint8Array };
  let etag = "";
  const preexisting = await dependencies.objectStore.head(file.object_key);
  if (preexisting) {
    await part.stream.cancel().catch(() => undefined);
    facts = await hashStoredObject(dependencies.objectStore, file.object_key);
    etag = preexisting.etag;
    if (facts.actualSha256 !== declaredSha256 || (declaredSize !== null && facts.actualSizeBytes !== declaredSize)) {
      return updateReconciliation(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, reason: "OBJECT_METADATA_MISMATCH" });
    }
  } else {
    const putPromise = dependencies.objectStore.putIfAbsent({
      key: file.object_key,
      body: part.stream,
      contentType: part.declaredMimeType || "application/octet-stream",
      customMetadata: { batch_id: String(input.batchId), file_id: String(file.id), operation_id: operationId },
    });
    const settled = await Promise.allSettled([putPromise, part.completion]);
    if (settled[0].status === "rejected" || settled[1].status === "rejected") {
      if (settled[1].status === "rejected" && settled[1].reason instanceof MaterialImportMultipartError) {
        const multipartFailure = settled[1].reason;
        return updateFailedUpload(dependencies, {
          batchId: input.batchId,
          fileId: file.id,
          idempotencyId: idem.id,
          user: input.user.username,
          requestId: input.requestId,
          operationId,
          keyDigest,
          failureStage: "FILE_INTEGRITY",
          code: multipartFailure.code,
          message: multipartFailure.message,
          status: multipartFailure.status,
          storageStatus: "STORAGE_FAILED",
        });
      }
      const after = await dependencies.objectStore.head(file.object_key).catch(() => null);
      if (!after) {
        return updateFailedUpload(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, failureStage: "STORAGE", code: "IMPORT_FILE_STORAGE_FAILED", message: "文件存储失败，请重试", status: 503, storageStatus: "STORAGE_FAILED" });
      }
      try {
        facts = await hashStoredObject(dependencies.objectStore, file.object_key);
        etag = after.etag;
        if (settled[1].status === "fulfilled" && (
          facts.actualSha256 !== settled[1].value.actualSha256
          || facts.actualSizeBytes !== settled[1].value.actualSizeBytes
        )) {
          return updateReconciliation(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, reason: "OBJECT_METADATA_MISMATCH" });
        }
      } catch {
        return updateReconciliation(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, reason: "OBJECT_WRITE_RESULT_UNKNOWN" });
      }
    } else {
      facts = settled[1].value;
      etag = settled[0].value.metadata.etag;
      if (settled[0].value.kind === "exists") facts = await hashStoredObject(dependencies.objectStore, file.object_key);
    }
  }
  if (facts.actualSizeBytes === 0) {
    return updateFailedUpload(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, failureStage: "FILE_INTEGRITY", code: "IMPORT_FILE_EMPTY", message: "文件不能为空", status: 422, storageStatus: "DELETE_PENDING" });
  }
  if (facts.actualSha256 !== declaredSha256) {
    const result = await updateFailedUpload(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, failureStage: "FILE_INTEGRITY", code: "IMPORT_FILE_HASH_MISMATCH", message: "文件 SHA-256 与声明不一致", status: 422, storageStatus: "DELETE_PENDING" });
    await bestEffortDelete(dependencies, input.batchId, file.id, file.object_key, input.requestId);
    return result;
  }
  let detectedType: MaterialImportDetectedType;
  try {
    detectedType = detectMaterialImportFileType(facts.prefix);
  } catch (error) {
    const security = error instanceof MaterialImportFileSecurityError ? error : new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "文件类型不受支持");
    const timestamp = nowText(clock);
    await dependencies.database.prepare(`UPDATE material_import_files SET detected_file_type=NULL,actual_sha256=?,actual_size_bytes=?,object_etag=?,uploaded_at=?,updated_at=? WHERE id=?`).bind(facts.actualSha256, facts.actualSizeBytes, etag, timestamp, timestamp, file.id).run();
    const result = await updateFailedUpload(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, failureStage: "FILE_SECURITY", code: security.code, message: security.message, status: 415, storageStatus: "DELETE_PENDING", securityStatus: "REJECTED" });
    await bestEffortDelete(dependencies, input.batchId, file.id, file.object_key, input.requestId);
    return result;
  }
  const storedAt = nowText(clock);
  try {
    await dependencies.database.batch([
      dependencies.database.prepare(`UPDATE material_import_files SET detected_file_type=?,actual_sha256=?,actual_size_bytes=?,object_etag=?,storage_status='STORED',security_check_status='PENDING',uploaded_at=?,updated_at=? WHERE id=? AND storage_status IN ('UPLOAD_PENDING','RECONCILIATION_REQUIRED')`).bind(detectedType, facts.actualSha256, facts.actualSizeBytes, etag, storedAt, storedAt, file.id),
      dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_STORED','SYSTEM',?,json_object('file_id',?,'actual_size_bytes',?,'detected_file_type',?),?)`).bind(input.batchId, input.requestId, file.id, facts.actualSizeBytes, detectedType, storedAt),
    ]);
  } catch {
    return updateReconciliation(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, reason: "D1_STORED_COMPLETION_FAILED" });
  }
  try {
    await runMaterialImportBasicSecurityCheck({ store: dependencies.objectStore, objectKey: file.object_key, actualSizeBytes: facts.actualSizeBytes, detectedType, filenameExtension: extension, declaredMimeType: part.declaredMimeType });
  } catch (error) {
    const security = error instanceof MaterialImportFileSecurityError
      ? error
      : new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "文件未通过基础安全检查");
    const result = await updateFailedUpload(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, failureStage: "FILE_SECURITY", code: security.code === "IMPORT_FILE_TYPE_UNSUPPORTED" ? security.code : "IMPORT_FILE_SECURITY_CHECK_FAILED", message: security.message, status: security.code === "IMPORT_FILE_TYPE_UNSUPPORTED" ? 415 : 422, storageStatus: "DELETE_PENDING", securityStatus: "REJECTED" });
    await bestEffortDelete(dependencies, input.batchId, file.id, file.object_key, input.requestId);
    return result;
  }
  const duplicate = await dependencies.database.prepare(`
    SELECT f.batch_id FROM material_import_files f JOIN material_import_batches b ON b.id=f.batch_id
    WHERE f.actual_sha256=? AND f.batch_id<>? AND (?=1 OR b.created_by=?) LIMIT 1
  `).bind(facts.actualSha256, input.batchId, input.canReadAny ? 1 : 0, input.user.username).first<{ batch_id: number }>();
  if (duplicate && duplicateAction === "REJECT") {
    const result = await updateFailedUpload(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, failureStage: "DUPLICATE", code: "IMPORT_FILE_DUPLICATE", message: "检测到可见范围内的重复文件；如确需再次导入，请显式允许重复", status: 409, storageStatus: "DELETE_PENDING" });
    await bestEffortDelete(dependencies, input.batchId, file.id, file.object_key, input.requestId);
    return result;
  }
  const latest = await batchById(dependencies.database, input.batchId);
  if (!latest || latest.status === "CANCELLED") {
    await dependencies.database.prepare(`UPDATE material_import_files SET storage_status='DELETE_PENDING',updated_at=? WHERE id=?`).bind(nowText(clock), file.id).run().catch(() => undefined);
    await bestEffortDelete(dependencies, input.batchId, file.id, file.object_key, input.requestId);
    throw new MaterialImportServiceError("IMPORT_BATCH_STATE_INVALID", "批次已取消，上传不能完成", 409);
  }
  const readyBatch = { ...latest, status: "FILE_READY" as const, current_version: latest.current_version + 1, updated_at: nowText(clock) };
  const readyFile = { ...(await fileByBatch(dependencies.database, input.batchId))!, storage_status: "STORED" as const, security_check_status: "BASIC_CHECK_PASSED" as const, updated_at: readyBatch.updated_at };
  const payload = { data: { batch: batchProjection(readyBatch), file: fileProjection(readyFile) } };
  const timestamp = readyBatch.updated_at;
  try {
    await dependencies.database.batch([
      dependencies.database.prepare(`UPDATE material_import_batches SET status='FILE_READY',current_version=current_version+1,updated_at=? WHERE id=? AND status='UPLOAD_PENDING' AND current_version=?`).bind(timestamp, input.batchId, latest.current_version),
      dependencies.database.prepare(`UPDATE material_import_files SET security_check_status='BASIC_CHECK_PASSED',updated_at=? WHERE id=? AND storage_status='STORED' AND security_check_status='PENDING'`).bind(timestamp, file.id),
      dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES((SELECT CASE WHEN status='FILE_READY' AND current_version=? THEN id ELSE NULL END FROM material_import_batches WHERE id=?),'FILE_SECURITY_CHECK_PASSED','SYSTEM',?,json_object('file_id',?),?)`).bind(latest.current_version + 1, input.batchId, input.requestId, file.id, timestamp),
      dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_UPLOAD_COMPLETED','SYSTEM',?,json_object('file_id',?),?)`).bind(input.batchId, input.requestId, file.id, timestamp),
      dependencies.database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=200,response_json=?,updated_at=?,expires_at=? WHERE id=? AND state='PENDING'`).bind(JSON.stringify(payload), timestamp, nowSeconds(clock) + IDEMPOTENCY_TTL_SECONDS, idem.id),
      auditStatement(dependencies.database, { username: input.user.username, action: "UPLOAD_IMPORT_FILE", detail: `batch:${input.batchId}`, requestId: input.requestId, operationId, keyDigest, result: "success", timestamp }),
    ]);
  } catch {
    return updateReconciliation(dependencies, { batchId: input.batchId, fileId: file.id, idempotencyId: idem.id, user: input.user.username, requestId: input.requestId, operationId, keyDigest, reason: "D1_READY_COMPLETION_FAILED" });
  }
  return { status: 200, payload };
}

export async function getMaterialImportBatch(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{ batchId: number; user: MaterialImportUser; canReadAny: boolean }>,
): Promise<MaterialImportServiceResult> {
  const batch = await batchById(dependencies.database, input.batchId);
  if (!batch || (!input.canReadAny && batch.created_by !== input.user.username)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return { status: 200, payload: await detailPayload(dependencies.database, input.batchId) };
}

function encodeCursor(row: { created_at: string; id: number }): string {
  return btoa(JSON.stringify([row.created_at, row.id]));
}

function decodeCursor(value: string): [string, number] {
  try {
    const parsed = JSON.parse(atob(value));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || !Number.isSafeInteger(parsed[1])) throw new Error();
    return [parsed[0], parsed[1]];
  } catch {
    throw new MaterialImportServiceError("INVALID_REQUEST", "cursor 无效", 400);
  }
}

export async function listMaterialImportBatches(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{
    user: MaterialImportUser;
    canReadAny: boolean;
    status?: string;
    sourceKind?: string;
    cursor?: string;
    limit: number;
    sort: "created_at_desc" | "created_at_asc";
  }>,
): Promise<MaterialImportServiceResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!input.canReadAny) { where.push("created_by=?"); params.push(input.user.username); }
  if (input.status) { where.push("status=?"); params.push(input.status); }
  if (input.sourceKind) { where.push("source_kind=?"); params.push(input.sourceKind); }
  const direction = input.sort === "created_at_asc" ? "ASC" : "DESC";
  if (input.cursor) {
    const [createdAt, id] = decodeCursor(input.cursor);
    where.push(`(created_at ${direction === "DESC" ? "<" : ">"} ? OR (created_at=? AND id ${direction === "DESC" ? "<" : ">"} ?))`);
    params.push(createdAt, createdAt, id);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await dependencies.database.prepare(`SELECT * FROM material_import_batches ${clause} ORDER BY created_at ${direction},id ${direction} LIMIT ?`).bind(...params, input.limit + 1).all<BatchRow>();
  const visible = rows.results ?? [];
  const hasMore = visible.length > input.limit;
  const pageRows = visible.slice(0, input.limit);
  const countParams = params.slice(0, params.length - (input.cursor ? 3 : 0));
  const countWhere = input.cursor ? where.slice(0, -1) : where;
  const total = await dependencies.database.prepare(`SELECT COUNT(*) AS total FROM material_import_batches ${countWhere.length ? `WHERE ${countWhere.join(" AND ")}` : ""}`).bind(...countParams).first<{ total: number }>();
  return {
    status: 200,
    payload: {
      data: pageRows.map(batchProjection),
      total: total?.total ?? 0,
      page: { has_more: hasMore, next_cursor: hasMore && pageRows.length ? encodeCursor(pageRows[pageRows.length - 1]) : null },
    },
  };
}

export async function listMaterialImportEvents(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{ batchId: number; user: MaterialImportUser; canReadAny: boolean; cursor?: string; limit: number }>,
): Promise<MaterialImportServiceResult> {
  const batch = await batchById(dependencies.database, input.batchId);
  if (!batch || (!input.canReadAny && batch.created_by !== input.user.username)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  const cursorId = input.cursor ? parsePositiveInteger(input.cursor, "cursor") : 0;
  const result = await dependencies.database.prepare(`SELECT * FROM material_import_events WHERE batch_id=? AND id>? ORDER BY id ASC LIMIT ?`).bind(input.batchId, cursorId, input.limit + 1).all<Record<string, unknown> & { id: number; safe_details_json: string | null }>();
  const rows = result.results ?? [];
  const hasMore = rows.length > input.limit;
  const pageRows = rows.slice(0, input.limit).map((row) => {
    const { safe_details_json: details, ...event } = row;
    return { ...event, safe_details: details ? JSON.parse(details) : null };
  });
  return { status: 200, payload: { data: pageRows, page: { has_more: hasMore, next_cursor: hasMore && pageRows.length ? String(pageRows[pageRows.length - 1].id) : null } } };
}

export async function cancelMaterialImportBatch(
  dependencies: MaterialImportServiceDependencies,
  input: Readonly<{ batchId: number; user: MaterialImportUser; canReadAny: boolean; rawKey: string; requestId: string; expectedVersion: unknown; reasonCode?: unknown }>,
): Promise<MaterialImportServiceResult> {
  const clock = dependencies.clock ?? (() => new Date());
  assertIdempotencyKey(input.rawKey);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) throw new MaterialImportServiceError("INVALID_REQUEST", "expected_version 必须是正整数", 400);
  const reasonCode = input.reasonCode === undefined ? "" : String(input.reasonCode);
  if (reasonCode && !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)) throw new MaterialImportServiceError("INVALID_REQUEST", "reason_code 无效", 400);
  const routeScope = `/api/material-master/import-batches/${input.batchId}/cancel`;
  const keyDigest = await sha256(input.rawKey);
  const requestDigest = await sha256(canonical({ batch_id: input.batchId, expected_version: expectedVersion, method: "POST", path: routeScope, reason_code: reasonCode }));
  const idem = await idempotencyRow(dependencies.database, input.user.username, routeScope, keyDigest);
  await enforceRateLimit(dependencies.database, input.user.username, keyDigest, !idem, clock);
  if (idem) {
    if (idem.request_digest !== requestDigest) throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key 已用于不同请求", 409);
    if (idem.state === "COMPLETED") return replay(idem);
  }
  const batch = await batchById(dependencies.database, input.batchId);
  if (!batch || (!input.canReadAny && batch.created_by !== input.user.username)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  if (batch.current_version !== expectedVersion) throw new MaterialImportServiceError("IMPORT_BATCH_VERSION_CONFLICT", "批次版本已变化", 409, batch.current_version);
  if (!new Set(["CREATED", "UPLOAD_PENDING", "FILE_READY"]).has(batch.status)) throw new MaterialImportServiceError("IMPORT_BATCH_STATE_INVALID", "当前批次状态不允许取消", 409);
  const file = await fileByBatch(dependencies.database, input.batchId);
  const operationId = idem?.operation_id ?? crypto.randomUUID();
  const timestamp = nowText(clock);
  const rawUntil = retentionFrom(timestamp, RAW_RETENTION_DAYS);
  const recordUntil = retentionFrom(timestamp, RECORD_RETENTION_DAYS);
  const cancelled = { ...batch, status: "CANCELLED" as const, current_version: expectedVersion + 1, cancelled_at: timestamp, terminal_at: timestamp, raw_data_retention_until: rawUntil, record_retention_until: recordUntil, updated_at: timestamp };
  const cancelledFile = file ? { ...file, storage_status: file.storage_status === "STORED" ? "DELETE_PENDING" as const : file.storage_status, retention_until: rawUntil, updated_at: timestamp } : null;
  const payload = { data: { batch: batchProjection(cancelled), file: fileProjection(cancelledFile) } };
  const leaseDigest = await sha256(`${operationId}:lease`);
  const statements = [];
  if (!idem) {
    statements.push(dependencies.database.prepare(`INSERT INTO material_import_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,file_id,lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until) VALUES(?,'POST',?,?,?,?,'PENDING',?,?,?,?,?,?,?)`).bind(input.user.username, routeScope, keyDigest, requestDigest, operationId, input.batchId, file?.id ?? null, leaseDigest, nowSeconds(clock) + IDEMPOTENCY_LEASE_SECONDS, timestamp, timestamp, nowSeconds(clock) + IDEMPOTENCY_RECOVERY_SECONDS));
  }
  statements.push(
    dependencies.database.prepare(`UPDATE material_import_batches SET status='CANCELLED',current_version=current_version+1,cancelled_by=?,cancelled_at=?,terminal_at=?,raw_data_retention_until=?,record_retention_until=?,updated_at=? WHERE id=? AND current_version=? AND status IN ('CREATED','UPLOAD_PENDING','FILE_READY')`).bind(input.user.username, timestamp, timestamp, rawUntil, recordUntil, timestamp, input.batchId, expectedVersion),
  );
  if (file) statements.push(dependencies.database.prepare(`UPDATE material_import_files SET storage_status=CASE WHEN storage_status='STORED' THEN 'DELETE_PENDING' ELSE storage_status END,retention_until=?,updated_at=? WHERE id=?`).bind(rawUntil, timestamp, file.id));
  statements.push(
    dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES((SELECT CASE WHEN status='CANCELLED' AND current_version=? THEN id ELSE NULL END FROM material_import_batches WHERE id=?),'BATCH_CANCELLED','USER',?,?, 'CANCELLED',?,json_object('reason_code',?),?)`).bind(expectedVersion + 1, input.batchId, input.user.username, batch.status, input.requestId, reasonCode, timestamp),
  );
  if (file?.storage_status === "STORED") statements.push(dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_DELETE_REQUESTED','SYSTEM',?,json_object('file_id',?),?)`).bind(input.batchId, input.requestId, file.id, timestamp));
  statements.push(
    dependencies.database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=200,response_json=?,updated_at=?,expires_at=? WHERE username=? AND route_scope=? AND key_digest=? AND state='PENDING'`).bind(JSON.stringify(payload), timestamp, nowSeconds(clock) + IDEMPOTENCY_TTL_SECONDS, input.user.username, routeScope, keyDigest),
    auditStatement(dependencies.database, { username: input.user.username, action: "CANCEL_IMPORT_BATCH", detail: `batch:${input.batchId}`, requestId: input.requestId, operationId, keyDigest, result: "success", timestamp }),
  );
  await dependencies.database.batch(statements);
  if (file?.storage_status === "STORED") await bestEffortDelete(dependencies, input.batchId, file.id, file.object_key, input.requestId);
  return { status: 200, payload };
}

export async function cleanupExpiredMaterialImportObjects(
  dependencies: MaterialImportServiceDependencies,
  limit = 100,
): Promise<Readonly<{ examined: number; deleted: number; failed: number }>> {
  const clock = dependencies.clock ?? (() => new Date());
  const timestamp = nowText(clock);
  const rows = await dependencies.database.prepare(`
    SELECT f.* FROM material_import_files f JOIN material_import_batches b ON b.id=f.batch_id
    WHERE b.raw_data_retention_until IS NOT NULL AND b.raw_data_retention_until<=?
      AND f.storage_status IN ('STORED','DELETE_PENDING')
    ORDER BY b.raw_data_retention_until ASC,f.id ASC LIMIT ?
  `).bind(timestamp, limit).all<FileRow>();
  let deleted = 0;
  let failed = 0;
  for (const file of rows.results ?? []) {
    await dependencies.database.prepare(`UPDATE material_import_files SET storage_status='DELETE_PENDING',updated_at=? WHERE id=? AND storage_status IN ('STORED','DELETE_PENDING')`).bind(timestamp, file.id).run();
    try {
      await dependencies.objectStore.delete(file.object_key);
      await dependencies.database.batch([
        dependencies.database.prepare(`UPDATE material_import_files SET storage_status='DELETED',updated_at=? WHERE id=? AND storage_status='DELETE_PENDING'`).bind(timestamp, file.id),
        dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_DELETED','SYSTEM',?,json_object('file_id',?,'cleanup',1),?)`).bind(file.batch_id, crypto.randomUUID(), file.id, timestamp),
      ]);
      deleted += 1;
    } catch {
      failed += 1;
      await dependencies.database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'FILE_DELETE_FAILED','SYSTEM',?,json_object('failure_code','OBJECT_DELETE_FAILED','cleanup',1),?)`).bind(file.batch_id, crypto.randomUUID(), timestamp).run();
    }
  }
  return { examined: (rows.results ?? []).length, deleted, failed };
}
