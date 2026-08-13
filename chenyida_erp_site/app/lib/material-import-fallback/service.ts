import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import type { BackgroundJobEnqueuer } from "../infrastructure/background-job-enqueuer.ts";
import {
  detectMaterialImportFileType,
  MaterialImportFileSecurityError,
  runMaterialImportBasicSecurityCheck,
} from "../material-import/file-security.ts";
import { MaterialImportMultipartError } from "../material-import/multipart.ts";
import type { LocalMaterialImportFileFacts } from "./local-file-store.ts";
import { LocalMaterialImportFileStore } from "./local-file-store.ts";
import { PostgresMaterialImportFallbackRepository } from "./repository.ts";
import type {
  MaterialImportFallbackActor,
  MaterialImportFallbackBatchRow,
  MaterialImportFallbackFileRow,
  MaterialImportFallbackIdempotencyRow,
  MaterialImportFallbackPreparedUpload,
  MaterialImportFallbackResult,
  MaterialImportFallbackStoredResponse,
  MaterialImportFallbackUploadOperationRow,
} from "./types.ts";
import { MaterialImportFallbackError } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_SECONDS = 24 * 60 * 60;
const RECOVERY_SECONDS = 7 * 24 * 60 * 60;
const MAX_ERROR_MESSAGE = 500;
const MAX_SCHEMA_FILE_BYTES = 10 * 1024 * 1024;

export type MaterialImportFallbackUploadHeaders = Readonly<{
  expectedVersion: number;
  declaredFilename: string;
  filenameExtension: ".csv" | ".xls" | ".xlsx";
  declaredMimeType: string;
  declaredSha256: string;
  declaredSizeBytes: number;
  duplicateAction: "REJECT" | "ALLOW_DUPLICATE";
}>;

export type MaterialImportUploadPart = Readonly<{
  filename: string;
  declaredMimeType: string;
  stream: ReadableStream<Uint8Array>;
  completion: Promise<Readonly<{ actualSizeBytes: number; actualSha256: string; prefix: Uint8Array }>>;
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

export function materialImportFallbackDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function keyDigest(key: string): string {
  if (!/^[\x21-\x7e]{8,200}$/.test(key)) {
    throw new MaterialImportFallbackError("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 必须为 8 到 200 个安全字符", 400);
  }
  return createHash("sha256").update(key).digest("hex");
}

function positive(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`, 400);
  }
  return parsed;
}

const PUBLIC_IMPORT_CODES = new Set([
  "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_PROGRESS", "IDEMPOTENCY_KEY_INVALID", "IDEMPOTENCY_RESPONSE_INVALID",
  "IMPORT_BATCH_NOT_FOUND", "IMPORT_DUPLICATE_ACTION_INVALID", "IMPORT_DUPLICATE_OVERRIDE_INVALID", "IMPORT_FILE_DUPLICATE",
  "IMPORT_FILE_EMPTY", "IMPORT_FILE_FACTS_MISMATCH", "IMPORT_FILE_MIME_INVALID", "IMPORT_FILE_NAME_INVALID", "IMPORT_FILE_NOT_READY",
  "IMPORT_FILE_SECURITY_CHECK_FAILED", "IMPORT_FILE_SHA256_INVALID", "IMPORT_FILE_TOO_LARGE", "IMPORT_FILE_TYPE_UNSUPPORTED",
  "IMPORT_MULTIPART_METADATA_MISMATCH", "IMPORT_OPERATION_FAILED", "IMPORT_PARSER_VERSION_UNSUPPORTED", "IMPORT_RECONCILIATION_REQUIRED",
  "IMPORT_RECOVERY_FILE_FACTS_MISMATCH", "IMPORT_RECOVERY_FILE_MISSING", "IMPORT_RETRY_NOT_ALLOWED", "IMPORT_SOURCE_INVALID",
  "IMPORT_SOURCE_MISMATCH", "IMPORT_STATUS_CONFLICT", "IMPORT_UPLOAD_BODY_MISSING", "IMPORT_UPLOAD_CANCELLED", "IMPORT_VERSION_CONFLICT",
  "PASSWORD_CHANGE_REQUIRED", "PERMISSION_DENIED", "RATE_LIMITED", "REQUEST_VALIDATION_FAILED", "RESULT_UNKNOWN",
]);

function safeErrorCode(value: string): string {
  return PUBLIC_IMPORT_CODES.has(value) ? value : "IMPORT_OPERATION_FAILED";
}

function safeFailureMessage(value: string): string {
  const message = String(value || "").trim().slice(0, MAX_ERROR_MESSAGE);
  return message || "操作失败";
}

function safeWarningCodes(values: readonly string[]): string[] {
  if (values.some((value) => !/^[A-Z][A-Z0-9_]{0,99}$/.test(value))) {
    throw new Error("IMPORT_SECURITY_WARNINGS_INVALID");
  }
  const selected = [...new Set(values)].slice(0, 32);
  if (JSON.stringify(selected).length > 3_500) throw new Error("IMPORT_SECURITY_WARNINGS_INVALID");
  return selected;
}

function sameStoredFacts(facts: LocalMaterialImportFileFacts, expectedSha256: string, expectedSizeBytes: number): boolean {
  return facts.sha256 === expectedSha256 && facts.sizeBytes === expectedSizeBytes;
}

function hasPermission(actor: MaterialImportFallbackActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function requirePermission(actor: MaterialImportFallbackActor, permission: string): void {
  if (!hasPermission(actor, permission)) throw new MaterialImportFallbackError("PERMISSION_DENIED", "没有权限执行此操作", 403);
  if (actor.must_change_password) throw new MaterialImportFallbackError("PASSWORD_CHANGE_REQUIRED", "请先修改密码", 403);
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function safeDtoCode(value: unknown): string | null {
  const code = String(value ?? "");
  return value == null ? null : safeErrorCode(code);
}

function safeDtoMessage(codeValue: unknown, messageValue: unknown): string | null {
  if (codeValue == null && messageValue == null) return null;
  const messages = new Map<string, string>([
    ["IMPORT_FILE_DUPLICATE", "相同内容的导入文件已存在"],
    ["IMPORT_FILE_FACTS_MISMATCH", "文件摘要或大小与声明不一致"],
    ["IMPORT_FILE_SECURITY_CHECK_FAILED", "文件基础安全检查失败"],
    ["IMPORT_FILE_TYPE_UNSUPPORTED", "文件类型不受支持"],
    ["IMPORT_UPLOAD_BODY_MISSING", "上传正文未完成"],
    ["IMPORT_RECONCILIATION_REQUIRED", "文件与数据库状态需要后台协调"],
  ]);
  return messages.get(String(codeValue ?? "")) ?? "操作失败，请凭请求编号联系管理员";
}

export function materialImportFallbackBatchDto(row: MaterialImportFallbackBatchRow | Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(row.id),
    batch_no: row.batch_no,
    source_kind: row.source_kind,
    status: row.status,
    retry_of_batch_id: row.retry_of_batch_id == null ? null : Number(row.retry_of_batch_id),
    created_by: row.created_by,
    current_version: Number(row.current_version),
    file_count: Number(row.file_count),
    total_rows: Number(row.total_rows),
    accepted_rows: Number(row.accepted_rows),
    rejected_rows: Number(row.rejected_rows),
    failure_stage: row.failure_stage,
    failure_code: safeDtoCode(row.failure_code),
    failure_message: safeDtoMessage(row.failure_code, row.failure_message),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function materialImportFallbackFileDto(row: MaterialImportFallbackFileRow | Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    original_filename: row.original_filename,
    filename_extension: row.filename_extension ?? null,
    declared_mime_type: row.declared_mime_type ?? null,
    declared_sha256: row.declared_sha256 ?? null,
    declared_size_bytes: row.declared_size_bytes == null ? null : Number(row.declared_size_bytes),
    detected_file_type: row.detected_file_type ?? null,
    actual_sha256: row.actual_sha256 ?? null,
    actual_size_bytes: row.actual_size_bytes == null ? null : Number(row.actual_size_bytes),
    storage_status: row.storage_status,
    security_check_status: row.security_check_status ?? "NOT_APPLICABLE",
    security_failure_code: safeDtoCode(row.security_failure_code),
    security_failure_message: safeDtoMessage(row.security_failure_code, row.security_failure_message),
    security_warning_codes: Array.isArray(row.security_warning_codes)
      ? row.security_warning_codes.filter((value) => /^[A-Z][A-Z0-9_]{0,99}$/.test(String(value))).slice(0, 32)
      : [],
    uploaded_at: row.uploaded_at == null ? null : iso(row.uploaded_at),
    promoted_at: row.promoted_at == null ? null : iso(row.promoted_at),
  };
}

function storedSuccess(data: Record<string, unknown>): MaterialImportFallbackStoredResponse {
  return { ok: true, data };
}

function storedFailure(code: string, message: string, currentVersion?: number): MaterialImportFallbackStoredResponse {
  return { ok: false, error: { code, message: message.slice(0, MAX_ERROR_MESSAGE), ...(currentVersion === undefined ? {} : { current_version: currentVersion }) } };
}

function completedResponse(row: MaterialImportFallbackIdempotencyRow | Record<string, unknown>): MaterialImportFallbackStoredResponse {
  if (row.state !== "COMPLETED" || !row.response || typeof row.response !== "object") {
    throw new MaterialImportFallbackError("IDEMPOTENCY_IN_PROGRESS", "同一操作仍在处理中", 409, {
      operationId: String(row.operation_id), retryAfterSeconds: 5,
    });
  }
  const response = row.response as MaterialImportFallbackStoredResponse;
  if (response.ok === true || (response.ok === false && response.error && typeof response.error === "object")) return response;
  throw new MaterialImportFallbackError("IDEMPOTENCY_RESPONSE_INVALID", "历史操作响应无效，需要人工协调", 500, {
    operationId: String(row.operation_id),
  });
}

function replayAuthoritative(
  row: MaterialImportFallbackIdempotencyRow | Record<string, unknown>,
  data: Record<string, unknown>,
  successStatus: number,
): MaterialImportFallbackResult {
  const response = completedResponse(row);
  const statusCode = Number(row.status_code);
  if (response.ok === true) {
    if (statusCode !== successStatus) {
      throw new MaterialImportFallbackError("IDEMPOTENCY_RESPONSE_INVALID", "历史操作响应无效，需要人工协调", 500, {
        operationId: String(row.operation_id),
      });
    }
    return { data, statusCode, operationId: String(row.operation_id), replayed: true };
  }
  if (response.ok === false && response.error) {
    const code = safeDtoCode(response.error.code) ?? "IMPORT_OPERATION_FAILED";
    const failureStatus = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
    const currentVersion = response.error.current_version === undefined
      ? undefined
      : Number.isSafeInteger(response.error.current_version) && Number(response.error.current_version) > 0
        ? Number(response.error.current_version)
        : undefined;
    throw new MaterialImportFallbackError(code, safeDtoMessage(code, response.error.message) ?? "操作失败，请凭请求编号联系管理员", failureStatus, {
      currentVersion,
      operationId: String(row.operation_id),
      replayed: true,
    });
  }
  throw new MaterialImportFallbackError("IDEMPOTENCY_RESPONSE_INVALID", "历史操作响应无效，需要人工协调", 500, {
    operationId: String(row.operation_id),
  });
}

function asIdempotency(row: Record<string, unknown>): MaterialImportFallbackIdempotencyRow {
  return row as MaterialImportFallbackIdempotencyRow;
}

function asUploadOperation(row: Record<string, unknown>): MaterialImportFallbackUploadOperationRow {
  return row as MaterialImportFallbackUploadOperationRow;
}

function uploadPreparation(
  operation: MaterialImportFallbackUploadOperationRow,
  leaseToken: string,
  resumed: boolean,
): MaterialImportFallbackPreparedUpload {
  return {
    kind: "PREPARED",
    operationId: operation.operation_id,
    leaseToken,
    batchId: Number(operation.batch_id),
    expectedBatchVersion: Number(operation.expected_batch_version),
    declaredFilename: operation.declared_filename,
    filenameExtension: operation.filename_extension,
    declaredMimeType: operation.declared_mime_type,
    declaredSha256: operation.declared_sha256,
    declaredSizeBytes: Number(operation.declared_size_bytes),
    duplicateAction: operation.duplicate_action,
    stagingRelativePath: operation.staging_relative_path,
    finalRelativePath: operation.final_relative_path,
    resumed,
  };
}

function expectedUploadBatchVersion(preparation: MaterialImportFallbackPreparedUpload, status: unknown): number {
  if (status === "UPLOAD_PENDING") return preparation.expectedBatchVersion + 1;
  if (status === "RECONCILIATION_REQUIRED") return preparation.expectedBatchVersion + 2;
  return -1;
}

type ClaimedMaterialImportUpload = Readonly<{
  preparation: MaterialImportFallbackPreparedUpload;
  actor: MaterialImportFallbackActor;
  phase: MaterialImportFallbackUploadOperationRow["phase"];
  requestId: string;
}>;

function extensionFor(filename: string): ".csv" | ".xls" | ".xlsx" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return ".xlsx";
  if (lower.endsWith(".xls")) return ".xls";
  if (lower.endsWith(".csv")) return ".csv";
  throw new MaterialImportFallbackError("IMPORT_FILE_TYPE_UNSUPPORTED", "仅支持 .xlsx、.xls 或 .csv 文件", 422);
}

export function normalizeMaterialImportFilename(value: string): string {
  const filename = String(value || "").normalize("NFKC").trim();
  if (!filename || filename.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(filename)) {
    throw new MaterialImportFallbackError("IMPORT_FILE_NAME_INVALID", "文件名无效", 400);
  }
  extensionFor(filename);
  return filename;
}

export function normalizeMaterialImportMime(value: string): string {
  const mime = String(value || "").trim().toLowerCase();
  if (mime.length > 255 || /[\u0000-\u001f\u007f]/.test(mime)) {
    throw new MaterialImportFallbackError("IMPORT_FILE_MIME_INVALID", "文件 MIME 无效", 400);
  }
  return mime;
}

export function normalizeMaterialImportUploadHeaders(
  value: Readonly<{
    expectedVersion: unknown;
    declaredFilename: unknown;
    filenameExtension?: unknown;
    declaredMimeType: unknown;
    declaredSha256: unknown;
    declaredSizeBytes: unknown;
    duplicateAction: unknown;
  }>,
  maximumBytes = MAX_SCHEMA_FILE_BYTES,
): MaterialImportFallbackUploadHeaders {
  const expectedVersion = positive(value.expectedVersion, "X-Expected-Version");
  const declaredFilename = normalizeMaterialImportFilename(String(value.declaredFilename ?? ""));
  const filenameExtension = extensionFor(declaredFilename);
  if (value.filenameExtension !== undefined && value.filenameExtension !== filenameExtension) {
    throw new MaterialImportFallbackError("IMPORT_FILE_NAME_INVALID", "文件扩展名与声明不一致", 400);
  }
  const declaredMimeType = normalizeMaterialImportMime(String(value.declaredMimeType ?? ""));
  const declaredSha256 = String(value.declaredSha256 ?? "").trim().toLowerCase();
  if (!SHA256.test(declaredSha256)) {
    throw new MaterialImportFallbackError("IMPORT_FILE_SHA256_INVALID", "X-File-SHA256 必须是 SHA-256", 400);
  }
  const declaredSizeBytes = positive(value.declaredSizeBytes, "X-File-Size");
  const allowedMaximum = Math.min(positive(maximumBytes, "IMPORT_FILE_MAXIMUM"), MAX_SCHEMA_FILE_BYTES);
  if (declaredSizeBytes > allowedMaximum) {
    throw new MaterialImportFallbackError("IMPORT_FILE_TOO_LARGE", "文件超过大小上限", 413);
  }
  if (value.duplicateAction !== "REJECT" && value.duplicateAction !== "ALLOW_DUPLICATE") {
    throw new MaterialImportFallbackError("IMPORT_DUPLICATE_ACTION_INVALID", "重复文件处理方式无效", 400);
  }
  return {
    expectedVersion,
    declaredFilename,
    filenameExtension,
    declaredMimeType,
    declaredSha256,
    declaredSizeBytes,
    duplicateAction: value.duplicateAction,
  };
}

export class UploadLeaseHeartbeat {
  private readonly callback: () => Promise<boolean>;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  private lost = false;

  constructor(callback: () => Promise<boolean>, intervalMs: number) {
    this.callback = callback;
    this.intervalMs = intervalMs;
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.lost) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private tick(): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.stopped || this.lost) return;
      try { if (!(await this.callback())) this.lost = true; }
      catch { this.lost = true; }
    });
    return this.chain;
  }

  async renew(): Promise<void> {
    await this.tick();
    if (this.lost) throw new Error("IMPORT_UPLOAD_LEASE_LOST");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.chain.catch(() => undefined);
  }
}

export class MaterialImportFallbackService {
  readonly repository: PostgresMaterialImportFallbackRepository;
  readonly store: LocalMaterialImportFileStore;
  readonly queue: BackgroundJobEnqueuer;
  readonly maximumBytes: number;
  readonly leaseSeconds: number;

  constructor(
    repository: PostgresMaterialImportFallbackRepository,
    store: LocalMaterialImportFileStore,
    queue: BackgroundJobEnqueuer,
    options: Readonly<{ maximumBytes?: number; leaseSeconds?: number }> = {},
  ) {
    this.repository = repository;
    this.store = store;
    this.queue = queue;
    this.maximumBytes = Math.min(positive(options.maximumBytes ?? MAX_SCHEMA_FILE_BYTES, "IMPORT_FILE_MAXIMUM"), MAX_SCHEMA_FILE_BYTES);
    this.leaseSeconds = Math.max(15, Math.min(300, options.leaseSeconds ?? 60));
  }

  private async consumeWriteRate(actor: string, route: string, digest: string): Promise<void> {
    try { await this.repository.consumeWriteRate(actor, route, digest); }
    catch (error) {
      if (error instanceof Error && error.message === "MATERIAL_IMPORT_RATE_LIMITED") {
        throw new MaterialImportFallbackError("RATE_LIMITED", "导入写操作过于频繁，请稍后重试", 429, {
          retryAfterSeconds: Math.max(1, Number((error as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60)),
        });
      }
      throw error;
    }
  }

  async createBatch(input: Readonly<{
    actor: MaterialImportFallbackActor;
    requestId: string;
    idempotencyKey: string;
    sourceKind: string;
    retryOfBatchId: number | null;
  }>): Promise<MaterialImportFallbackResult> {
    requirePermission(input.actor, "material.import.create");
    if (!UUID.test(input.requestId)) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求编号无效", 400);
    if (input.sourceKind !== "CSV" && input.sourceKind !== "XLSX") {
      throw new MaterialImportFallbackError("IMPORT_SOURCE_INVALID", "导入类型无效", 400);
    }
    const retryOfBatchId = input.retryOfBatchId == null ? null : positive(input.retryOfBatchId, "retry_of_batch_id");
    const route = "/api/material-master/import-batches";
    const key = keyDigest(input.idempotencyKey);
    const requestDigest = materialImportFallbackDigest({ source_kind: input.sourceKind, retry_of_batch_id: retryOfBatchId });
    await this.consumeWriteRate(input.actor.username, route, key);
    return this.repository.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [input.actor.username, `${route}:${key}`]);
      const existing = await client.query(`
        select * from material_import_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3 for update
      `, [input.actor.username, route, key]);
      if (existing.rows[0]) {
        const row = asIdempotency(existing.rows[0]);
        if (row.request_digest !== requestDigest) throw new MaterialImportFallbackError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
        const completed = completedResponse(row);
        if (completed.ok === false) return replayAuthoritative(row, {}, 201);
        const created = await client.query(`
          select * from material_import_batches
          where id=$1 and created_by=$2 and source_kind in ('CSV','XLSX')
        `, [row.batch_id, input.actor.username]);
        if (!created.rows[0]) {
          throw new MaterialImportFallbackError("IDEMPOTENCY_RESPONSE_INVALID", "历史操作响应无效，需要人工协调", 500, {
            operationId: row.operation_id,
          });
        }
        return replayAuthoritative(row, materialImportFallbackBatchDto(created.rows[0]), 201);
      }
      if (retryOfBatchId !== null) {
        const parent = await client.query(`
          select id,source_kind,status,failure_code,created_by from material_import_batches
          where id=$1 and created_by=$2 for update
        `, [retryOfBatchId, input.actor.username]);
        const row = parent.rows[0];
        if (!row) throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
        if (row.status !== "FAILED" || row.failure_code !== "IMPORT_FILE_DUPLICATE" || row.source_kind !== input.sourceKind) {
          throw new MaterialImportFallbackError("IMPORT_RETRY_NOT_ALLOWED", "只有同来源的重复文件失败批次可以建立重试批次", 409);
        }
      }
      const operationId = randomUUID();
      const leaseToken = randomUUID();
      await client.query(`
        insert into material_import_idempotency(
          username,method,route_scope,key_digest,request_digest,operation_id,state,
          lease_token,lease_expires_at,expires_at,recovery_until
        ) values($1,'POST',$2,$3,$4,$5,'PENDING',$6,now()+make_interval(secs=>$7),
          now()+make_interval(secs=>$8),now()+make_interval(secs=>$9))
      `, [input.actor.username, route, key, requestDigest, operationId, leaseToken, this.leaseSeconds, IDEMPOTENCY_SECONDS, RECOVERY_SECONDS]);
      const batchNo = `IMP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${operationId.slice(0, 8).toUpperCase()}`;
      const created = await client.query(`
        insert into material_import_batches(batch_no,source_kind,status,retry_of_batch_id,created_by)
        values($1,$2,'CREATED',$3,$4) returning *
      `, [batchNo, input.sourceKind, retryOfBatchId, input.actor.username]);
      const batch = created.rows[0];
      const data = materialImportFallbackBatchDto(batch);
      const response = storedSuccess(data);
      const completed = await client.query(`
        update material_import_idempotency set state='COMPLETED',batch_id=$2,response=$3,status_code=201,
          lease_token=null,lease_expires_at=null,updated_at=now()
        where operation_id=$1 and state='PENDING'
      `, [operationId, batch.id, response]);
      if (completed.rowCount !== 1) throw new Error("IMPORT_BATCH_IDEMPOTENCY_STATE_INVALID");
      await this.repository.event(client, {
        batchId: Number(batch.id), eventType: "IMPORT_BATCH_CREATED", actorType: "USER",
        actorIdentifier: input.actor.username, previousStatus: null, newStatus: "CREATED", requestId: input.requestId,
        safeDetails: { retry_of_batch_id: retryOfBatchId },
      });
      await this.repository.audit(client, {
        actor: input.actor.username, action: "IMPORT_BATCH_CREATED", requestId: input.requestId,
        routeCode: "IMPORT_BATCH_CREATE", details: { batch_id: Number(batch.id), retry_of_batch_id: retryOfBatchId },
      });
      return { data, statusCode: 201, operationId, replayed: false };
    });
  }

  async listBatches(input: Readonly<{
    actor: MaterialImportFallbackActor;
    status: string | null;
    sourceKind: string | null;
    createdByMe: boolean;
    sort: "created_at_asc" | "created_at_desc";
    limit: 20 | 50;
    cursor: Readonly<{ createdAt: string; id: number }> | null;
  }>): Promise<Readonly<{ data: Record<string, unknown>[]; total: number; page: { has_more: boolean; next_cursor_facts: { createdAt: string; id: number } | null } }>> {
    requirePermission(input.actor, "material.import.read");
    const values: unknown[] = [];
    const filters: string[] = ["b.source_kind in ('CSV','XLSX')"];
    if (!hasPermission(input.actor, "material.import.read_any") || input.createdByMe) {
      values.push(input.actor.username); filters.push(`b.created_by=$${values.length}`);
    }
    if (input.status) { values.push(input.status); filters.push(`b.status=$${values.length}`); }
    if (input.sourceKind) { values.push(input.sourceKind); filters.push(`b.source_kind=$${values.length}`); }
    const where = filters.length ? `where ${filters.join(" and ")}` : "";
    const total = await this.repository.query(`select count(*)::int count from material_import_batches b ${where}`, values);
    const pageFilters = [...filters];
    const pageValues = [...values];
    if (input.cursor) {
      pageValues.push(input.cursor.createdAt, input.cursor.id);
      const comparison = input.sort === "created_at_asc" ? ">" : "<";
      pageFilters.push(`(b.created_at,b.id) ${comparison} ($${pageValues.length - 1}::timestamptz,$${pageValues.length}::bigint)`);
    }
    pageValues.push(input.limit + 1);
    const direction = input.sort === "created_at_asc" ? "asc" : "desc";
    const rows = await this.repository.query(`
      select b.* from material_import_batches b
      ${pageFilters.length ? `where ${pageFilters.join(" and ")}` : ""}
      order by b.created_at ${direction},b.id ${direction} limit $${pageValues.length}
    `, pageValues);
    const selected = rows.rows.slice(0, input.limit);
    const last = selected.at(-1);
    return {
      data: selected.map(materialImportFallbackBatchDto),
      total: Number(total.rows[0]?.count ?? 0),
      page: {
        has_more: rows.rows.length > input.limit,
        next_cursor_facts: rows.rows.length > input.limit && last
          ? { createdAt: iso(last.created_at), id: Number(last.id) }
          : null,
      },
    };
  }

  async batchDetail(batchIdValue: number, actor: MaterialImportFallbackActor): Promise<Record<string, unknown>> {
    requirePermission(actor, "material.import.read");
    const batchId = positive(batchIdValue, "batch_id");
    const canReadAny = hasPermission(actor, "material.import.read_any");
    const result = await this.repository.query(`
      select b.*,row_to_json(f.*) file
      from material_import_batches b left join material_import_files f on f.batch_id=b.id
      where b.id=$1 and b.source_kind in ('CSV','XLSX') and (b.created_by=$2 or $3::boolean)
    `, [batchId, actor.username, canReadAny]);
    if (!result.rows[0]) throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
    return {
      batch: materialImportFallbackBatchDto(result.rows[0]),
      file: materialImportFallbackFileDto(result.rows[0].file as Record<string, unknown> | undefined),
    };
  }

  async cancelBatch(input: Readonly<{
    actor: MaterialImportFallbackActor;
    requestId: string;
    idempotencyKey: string;
    batchId: number;
    expectedVersion: number;
    reasonCode: string;
  }>): Promise<MaterialImportFallbackResult> {
    requirePermission(input.actor, "material.import.cancel");
    const batchId = positive(input.batchId, "batch_id");
    const expectedVersion = positive(input.expectedVersion, "expected_version");
    if (!UUID.test(input.requestId)) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求编号无效", 400);
    if (input.reasonCode !== "USER_CANCELLED") {
      throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "reason_code 无效", 400);
    }
    const route = `/api/material-master/import-batches/${batchId}/cancel`;
    const key = keyDigest(input.idempotencyKey);
    const requestDigest = materialImportFallbackDigest({ expected_version: expectedVersion, reason_code: input.reasonCode });
    await this.consumeWriteRate(input.actor.username, route, key);
    const outcome = await this.repository.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [input.actor.username, `${route}:${key}`]);
      const existing = await client.query(`
        select * from material_import_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3 for update
      `, [input.actor.username, route, key]);
      if (existing.rows[0]) {
        const row = asIdempotency(existing.rows[0]);
        if (row.request_digest !== requestDigest) {
          throw new MaterialImportFallbackError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
        }
        const visible = await client.query(`
          select * from material_import_batches
          where id=$1 and source_kind in ('CSV','XLSX') and (created_by=$2 or $3::boolean)
        `, [batchId, input.actor.username, hasPermission(input.actor, "material.import.read_any")]);
        if (!visible.rows[0] || Number(row.batch_id) !== batchId) {
          throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
        }
        return { result: replayAuthoritative(row, materialImportFallbackBatchDto(visible.rows[0]), 200) };
      }

      const selected = await client.query(`
        select * from material_import_batches
        where id=$1 and source_kind in ('CSV','XLSX') and (created_by=$2 or $3::boolean)
        for update
      `, [batchId, input.actor.username, hasPermission(input.actor, "material.import.read_any")]);
      const batch = selected.rows[0];
      if (!batch) throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
      if (Number(batch.current_version) !== expectedVersion) {
        throw new MaterialImportFallbackError("IMPORT_VERSION_CONFLICT", "导入批次版本冲突", 409, {
          currentVersion: Number(batch.current_version),
        });
      }
      if (!["CREATED", "UPLOAD_PENDING", "FILE_READY", "QUEUED_FOR_PARSING", "PARSING"].includes(String(batch.status))) {
        throw new MaterialImportFallbackError("IMPORT_STATUS_CONFLICT", "当前批次不能取消", 409, {
          currentVersion: Number(batch.current_version),
        });
      }

      let uploadCleanup: Readonly<{
        preparation: MaterialImportFallbackPreparedUpload;
        fileId: number | null;
        previousLeaseToken: string | null;
      }> | undefined;
      let pendingUpload: Record<string, unknown> | undefined;
      if (batch.status === "UPLOAD_PENDING") {
        const upload = await client.query(`
          select i.username,i.method,i.route_scope,i.state,i.batch_id idempotency_batch_id,i.lease_token,
                 i.lease_expires_at>now() lease_active,o.*,
                 row_to_json(f.*) file
          from material_import_upload_operations o
          join material_import_idempotency i on i.operation_id=o.operation_id and i.batch_id=o.batch_id
          left join material_import_files f on f.batch_id=o.batch_id
          where o.batch_id=$1 for update of i,o
        `, [batchId]);
        pendingUpload = upload.rows[0];
        if (!pendingUpload || pendingUpload.state !== "PENDING"
          || pendingUpload.username !== String(batch.created_by) || pendingUpload.method !== "POST"
          || pendingUpload.route_scope !== `/api/material-master/import-batches/${batchId}/file`
          || Number(pendingUpload.idempotency_batch_id) !== batchId
          || !["PREPARED", "STAGED", "SECURITY_PASSED", "PROMOTED", "RECONCILIATION_REQUIRED"].includes(String(pendingUpload.phase))) {
          throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传状态缺少可恢复证据，需要人工协调", 409);
        }
        if (pendingUpload.lease_active === true) {
          throw new MaterialImportFallbackError("IDEMPOTENCY_IN_PROGRESS", "上传仍在处理中，请稍后重试取消", 409, {
            operationId: String(pendingUpload.operation_id), retryAfterSeconds: Math.max(1, Math.ceil(this.leaseSeconds / 3)),
          });
        }
        const preparation = uploadPreparation(asUploadOperation(pendingUpload), String(pendingUpload.lease_token ?? randomUUID()), true);
        const canonical = this.store.paths(batchId, preparation.operationId, preparation.filenameExtension);
        if (preparation.stagingRelativePath !== canonical.stagingRelativePath || preparation.finalRelativePath !== canonical.finalRelativePath) {
          throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传文件身份需要人工协调", 409);
        }
        const [staging, final] = await Promise.all([
          this.store.inspectOptional(preparation.stagingRelativePath, this.maximumBytes),
          this.store.inspectOptional(preparation.finalRelativePath, this.maximumBytes),
        ]);
        for (const facts of [staging, final]) {
          if (facts && !sameStoredFacts(facts, preparation.declaredSha256, preparation.declaredSizeBytes)) {
            throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传文件事实需要人工协调", 409);
          }
        }
        const facts = final ?? staging;
        const existingFile = pendingUpload.file && typeof pendingUpload.file === "object"
          ? pendingUpload.file as Record<string, unknown>
          : null;
        let fileId: number | null = existingFile ? Number(existingFile.id) : null;
        if (existingFile && (existingFile.storage_name !== preparation.operationId
          || existingFile.relative_path !== preparation.finalRelativePath
          || existingFile.staging_relative_path !== preparation.stagingRelativePath
          || existingFile.actual_sha256 !== preparation.declaredSha256
          || Number(existingFile.actual_size_bytes) !== preparation.declaredSizeBytes)) {
          throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传文件记录需要人工协调", 409);
        }
        if (!existingFile && facts) {
          const inserted = await client.query(`
            insert into material_import_files(
              batch_id,storage_name,relative_path,staging_relative_path,original_filename,filename_extension,
              mime_type,declared_mime_type,sha256,declared_sha256,size_bytes,declared_size_bytes,
              actual_sha256,actual_size_bytes,storage_status,security_check_status,security_failure_code,
              security_failure_message,uploaded_at,promoted_at
            ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10,$9,$10,'DELETE_PENDING','REJECTED',
              'IMPORT_UPLOAD_CANCELLED','上传已由用户取消',now(),case when $11::boolean then now() else null end) returning id
          `, [batchId, preparation.operationId, preparation.finalRelativePath, preparation.stagingRelativePath,
            preparation.declaredFilename, preparation.filenameExtension, preparation.declaredMimeType || "application/octet-stream",
            preparation.declaredMimeType || null, preparation.declaredSha256, preparation.declaredSizeBytes, Boolean(final)]);
          fileId = Number(inserted.rows[0].id);
        } else if (fileId !== null) {
          const marked = await client.query(`
            update material_import_files set storage_status='DELETE_PENDING',security_check_status='REJECTED',
              security_failure_code='IMPORT_UPLOAD_CANCELLED',security_failure_message='上传已由用户取消',updated_at=now()
            where id=$1 and batch_id=$2
          `, [fileId, batchId]);
          if (marked.rowCount !== 1) throw new Error("IMPORT_CANCEL_FILE_CAS_FAILED");
        }
        uploadCleanup = { preparation, fileId, previousLeaseToken: pendingUpload.lease_token == null ? null : String(pendingUpload.lease_token) };
      }

      const operationId = randomUUID();
      await client.query(`
        insert into material_import_idempotency(
          username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
          lease_token,lease_expires_at,expires_at,recovery_until
        ) values($1,'POST',$2,$3,$4,$5,'PENDING',$6,$7,now()+make_interval(secs=>$8),
          now()+make_interval(secs=>$9),now()+make_interval(secs=>$10))
      `, [input.actor.username, route, key, requestDigest, operationId, batchId, randomUUID(),
        this.leaseSeconds, IDEMPOTENCY_SECONDS, RECOVERY_SECONDS]);
      const updated = await client.query(`
        update material_import_batches set status='CANCELLED',failure_stage=null,failure_code=null,failure_message=null,
          current_version=current_version+1,updated_at=now()
        where id=$1 and current_version=$2 and status=$3 returning *
      `, [batchId, expectedVersion, batch.status]);
      if (updated.rowCount !== 1) {
        throw new MaterialImportFallbackError("IMPORT_VERSION_CONFLICT", "导入批次已变化", 409);
      }

      if (pendingUpload && uploadCleanup) {
        const uploadResponse = storedFailure("IMPORT_UPLOAD_CANCELLED", "上传已由用户取消", Number(updated.rows[0].current_version));
        const operation = await client.query(`
          update material_import_upload_operations set phase='FAILED',failure_code='IMPORT_UPLOAD_CANCELLED',
            failure_message='上传已由用户取消',completed_at=now(),updated_at=now()
          where operation_id=$1 and phase in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED')
        `, [pendingUpload.operation_id]);
        const idempotency = await client.query(`
          update material_import_idempotency set state='COMPLETED',file_id=$2,response=$3,status_code=409,
            lease_token=null,lease_expires_at=null,updated_at=now()
          where operation_id=$1 and state='PENDING'
        `, [pendingUpload.operation_id, uploadCleanup.fileId, uploadResponse]);
        if (operation.rowCount !== 1 || idempotency.rowCount !== 1) throw new Error("IMPORT_CANCEL_UPLOAD_CAS_FAILED");
      }

      if (["QUEUED_FOR_PARSING", "PARSING"].includes(String(batch.status))) {
        await client.query(`
          update material_import_job_outbox set status='CANCELLED',last_error_code='IMPORT_PARSE_CANCELLED',updated_at=now()
          where aggregate_type='material_import_batch' and aggregate_id=$1 and job_type='material.import.parse'
            and status in ('PENDING','PUBLISHED')
        `, [String(batchId)]);
        await client.query(`
          update background_jobs set status='CANCELLED',last_error_code='IMPORT_PARSE_CANCELLED',
            last_error_message='解析任务已由用户取消',lease_owner=null,lease_token=null,lease_expires_at=null,
            heartbeat_at=null,completed_at=now(),version=version+1,updated_at=now()
          where id in (
            select id from material_import_job_outbox
            where aggregate_type='material_import_batch' and aggregate_id=$1 and job_type='material.import.parse'
          ) and status in ('QUEUED','RUNNING','FAILED')
        `, [String(batchId)]);
        await client.query(`
          update material_import_parse_runs set run_status='CANCELLED',current_stage='COMPLETE',
            failure_code='IMPORT_PARSE_CANCELLED',safe_failure_message='解析任务已由用户取消',
            lease_token=null,lease_expires_at=null,heartbeat_at=null,completed_at=now(),updated_at=now()
          where batch_id=$1 and run_status in ('QUEUED','RUNNING','STAGED','PUBLISHING')
        `, [batchId]);
      }

      const data = materialImportFallbackBatchDto(updated.rows[0]);
      const completed = await client.query(`
        update material_import_idempotency set state='COMPLETED',response=$2,status_code=200,
          lease_token=null,lease_expires_at=null,updated_at=now()
        where operation_id=$1 and state='PENDING'
      `, [operationId, storedSuccess(data)]);
      if (completed.rowCount !== 1) throw new Error("IMPORT_CANCEL_IDEMPOTENCY_STATE_INVALID");
      await this.repository.event(client, {
        batchId, eventType: "IMPORT_BATCH_CANCELLED", actorType: "USER", actorIdentifier: input.actor.username,
        previousStatus: String(batch.status), newStatus: "CANCELLED", requestId: input.requestId,
        safeDetails: { reason_code: input.reasonCode, operation_id: operationId },
      });
      await this.repository.audit(client, {
        actor: input.actor.username, action: "IMPORT_BATCH_CANCELLED", requestId: input.requestId,
        routeCode: "IMPORT_BATCH_CANCEL", details: { batch_id: batchId, reason_code: input.reasonCode, operation_id: operationId },
      });
      return { result: { data, statusCode: 200, operationId, replayed: false }, uploadCleanup };
    });
    if (outcome.uploadCleanup) {
      if (outcome.uploadCleanup.fileId !== null) {
        await this.cleanupTerminalFile(outcome.uploadCleanup.preparation, outcome.uploadCleanup.fileId).catch(() => false);
      }
      if (outcome.uploadCleanup.previousLeaseToken) {
        await this.store.cleanupOperationTemp(
          outcome.uploadCleanup.preparation.operationId,
          outcome.uploadCleanup.previousLeaseToken,
        ).catch(() => false);
      }
    }
    return outcome.result;
  }

  async prepareUpload(input: Readonly<{
    actor: MaterialImportFallbackActor;
    requestId: string;
    idempotencyKey: string;
    batchId: number;
    headers: MaterialImportFallbackUploadHeaders;
  }>): Promise<MaterialImportFallbackPreparedUpload | MaterialImportFallbackResult> {
    requirePermission(input.actor, "material.import.create");
    const batchId = positive(input.batchId, "batch_id");
    if (!UUID.test(input.requestId)) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求编号无效", 400);
    const headers = normalizeMaterialImportUploadHeaders(input.headers, this.maximumBytes);
    const route = `/api/material-master/import-batches/${batchId}/file`;
    const key = keyDigest(input.idempotencyKey);
    const requestDigest = materialImportFallbackDigest({ batch_id: batchId, ...headers });
    await this.consumeWriteRate(input.actor.username, route, key);
    return this.repository.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('material-import-active-upload'),hashtext($1))", [input.actor.username]);
      await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [input.actor.username, `${route}:${key}`]);
      const existing = await client.query(`
        select i.*,i.lease_expires_at>now() lease_active,i.recovery_until>now() recovery_active
        from material_import_idempotency i
        where i.username=$1 and i.method='POST' and i.route_scope=$2 and i.key_digest=$3 for update
      `, [input.actor.username, route, key]);
      if (existing.rows[0]) {
        const idem = asIdempotency(existing.rows[0]);
        if (idem.request_digest !== requestDigest) throw new MaterialImportFallbackError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
        if (idem.state === "COMPLETED") {
          const visible = await client.query(`
            select b.*,row_to_json(f.*) file,o.phase
            from material_import_batches b
            left join material_import_files f on f.batch_id=b.id
            left join material_import_upload_operations o on o.operation_id=$3 and o.batch_id=b.id
            where b.id=$1 and b.created_by=$2 and b.source_kind in ('CSV','XLSX')
          `, [batchId, input.actor.username, idem.operation_id]);
          if (!visible.rows[0] || Number(idem.batch_id) !== batchId) {
            throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
          }
          const completed = completedResponse(idem);
          if (completed.ok === true && (visible.rows[0].phase !== "PUBLISHED" || !visible.rows[0].file
            || Number(idem.file_id) !== Number(visible.rows[0].file.id))) {
            throw new MaterialImportFallbackError("IDEMPOTENCY_RESPONSE_INVALID", "历史操作响应无效，需要人工协调", 500, {
              operationId: idem.operation_id,
            });
          }
          return replayAuthoritative(idem, {
            batch: materialImportFallbackBatchDto(visible.rows[0]),
            file: materialImportFallbackFileDto(visible.rows[0].file as Record<string, unknown> | undefined),
          }, 201);
        }
        if (existing.rows[0].recovery_active !== true) {
          throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传恢复期限已过，需要人工协调", 409, {
            operationId: idem.operation_id,
          });
        }
        if (existing.rows[0].lease_active === true) {
          throw new MaterialImportFallbackError("IDEMPOTENCY_IN_PROGRESS", "同一上传仍在处理中", 409, {
            operationId: idem.operation_id, retryAfterSeconds: Math.max(1, Math.ceil(this.leaseSeconds / 3)),
          });
        }
        const operationResult = await client.query("select * from material_import_upload_operations where operation_id=$1 for update", [idem.operation_id]);
        const operation = operationResult.rows[0] ? asUploadOperation(operationResult.rows[0]) : null;
        const batch = await client.query("select * from material_import_batches where id=$1 and created_by=$2 and source_kind in ('CSV','XLSX') for update", [batchId, input.actor.username]);
        if (!operation || !batch.rows[0] || Number(operation.batch_id) !== batchId
          || !["PREPARED", "STAGED", "SECURITY_PASSED"].includes(operation.phase)
          || batch.rows[0].status !== "UPLOAD_PENDING") {
          throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传状态缺少可恢复证据，需要人工协调", 409, { operationId: idem.operation_id });
        }
        const leaseToken = randomUUID();
        if (idem.lease_token) await this.store.cleanupOperationTemp(idem.operation_id, idem.lease_token);
        const reclaimed = await client.query(`
          update material_import_idempotency set lease_token=$2,lease_expires_at=now()+make_interval(secs=>$3),updated_at=now()
          where operation_id=$1 and state='PENDING' and lease_expires_at<=now()
        `, [idem.operation_id, leaseToken, this.leaseSeconds]);
        if (reclaimed.rowCount !== 1) throw new MaterialImportFallbackError("IDEMPOTENCY_IN_PROGRESS", "同一上传仍在处理中", 409, { operationId: idem.operation_id, retryAfterSeconds: 5 });
        return uploadPreparation(operation, leaseToken, true);
      }

      const activeUploads = await client.query(`
        select count(*)::int count from material_import_idempotency
        where username=$1 and state='PENDING' and route_scope like '/api/material-master/import-batches/%/file'
          and lease_expires_at>now()
      `, [input.actor.username]);
      if (Number(activeUploads.rows[0]?.count ?? 0) >= 2) {
        throw new MaterialImportFallbackError("RATE_LIMITED", "并发上传数量已达上限，请稍后重试", 429, {
          retryAfterSeconds: Math.max(1, Math.ceil(this.leaseSeconds / 3)),
        });
      }
      const batchResult = await client.query("select * from material_import_batches where id=$1 and created_by=$2 and source_kind in ('CSV','XLSX') for update", [batchId, input.actor.username]);
      const batch = batchResult.rows[0];
      if (!batch) throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
      if (Number(batch.current_version) !== headers.expectedVersion) {
        throw new MaterialImportFallbackError("IMPORT_VERSION_CONFLICT", "导入批次版本冲突", 409, { currentVersion: Number(batch.current_version) });
      }
      if (batch.status !== "CREATED" || Number(batch.file_count) !== 0) {
        throw new MaterialImportFallbackError("IMPORT_STATUS_CONFLICT", "当前批次不能上传文件", 409, { currentVersion: Number(batch.current_version) });
      }
      const expectedSource = headers.filenameExtension === ".csv" ? "CSV" : "XLSX";
      if (batch.source_kind !== expectedSource) throw new MaterialImportFallbackError("IMPORT_SOURCE_MISMATCH", "文件类型与批次来源不一致", 409);
      if (headers.duplicateAction === "ALLOW_DUPLICATE") {
        const parent = await client.query(`
          select parent.id from material_import_batches parent
          where parent.id=$1 and parent.created_by=$2 and parent.source_kind=$3
            and parent.status='FAILED' and parent.failure_code='IMPORT_FILE_DUPLICATE'
          for update
        `, [batch.retry_of_batch_id, input.actor.username, batch.source_kind]);
        if (!batch.retry_of_batch_id || !parent.rows[0]) {
          throw new MaterialImportFallbackError("IMPORT_DUPLICATE_OVERRIDE_INVALID", "允许重复只适用于关联的重复文件失败重试批次", 409);
        }
      }
      const operationId = randomUUID();
      const leaseToken = randomUUID();
      const paths = this.store.paths(batchId, operationId, headers.filenameExtension);
      await client.query(`
        insert into material_import_idempotency(
          username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
          lease_token,lease_expires_at,expires_at,recovery_until
        ) values($1,'POST',$2,$3,$4,$5,'PENDING',$6,$7,now()+make_interval(secs=>$8),
          now()+make_interval(secs=>$9),now()+make_interval(secs=>$10))
      `, [input.actor.username, route, key, requestDigest, operationId, batchId, leaseToken, this.leaseSeconds, IDEMPOTENCY_SECONDS, RECOVERY_SECONDS]);
      await client.query(`
        insert into material_import_upload_operations(
          operation_id,batch_id,expected_batch_version,declared_filename,filename_extension,declared_mime_type,
          declared_sha256,declared_size_bytes,duplicate_action,staging_relative_path,final_relative_path,request_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [operationId, batchId, headers.expectedVersion, headers.declaredFilename, headers.filenameExtension,
        headers.declaredMimeType, headers.declaredSha256, headers.declaredSizeBytes,
        headers.duplicateAction, paths.stagingRelativePath, paths.finalRelativePath, input.requestId]);
      const updated = await client.query(`
        update material_import_batches set status='UPLOAD_PENDING',current_version=current_version+1,updated_at=now()
        where id=$1 and created_by=$2 and status='CREATED' and current_version=$3 and file_count=0 returning *
      `, [batchId, input.actor.username, headers.expectedVersion]);
      if (updated.rowCount !== 1) throw new MaterialImportFallbackError("IMPORT_VERSION_CONFLICT", "导入批次已变化", 409);
      await this.repository.event(client, {
        batchId, eventType: "IMPORT_UPLOAD_PREPARED", actorType: "USER", actorIdentifier: input.actor.username,
        previousStatus: "CREATED", newStatus: "UPLOAD_PENDING", requestId: input.requestId,
        safeDetails: { operation_id: operationId, expected_version: headers.expectedVersion, declared_size_bytes: headers.declaredSizeBytes },
      });
      await this.repository.audit(client, {
        actor: input.actor.username, action: "IMPORT_UPLOAD_PREPARED", requestId: input.requestId,
        routeCode: "IMPORT_FILE_UPLOAD", details: { batch_id: batchId, operation_id: operationId, declared_size_bytes: headers.declaredSizeBytes },
      });
      return {
        kind: "PREPARED", operationId, leaseToken, batchId,
        expectedBatchVersion: headers.expectedVersion,
        declaredFilename: headers.declaredFilename, filenameExtension: headers.filenameExtension,
        declaredMimeType: headers.declaredMimeType, declaredSha256: headers.declaredSha256,
        declaredSizeBytes: headers.declaredSizeBytes, duplicateAction: headers.duplicateAction,
        ...paths, resumed: false,
      };
    });
  }

  async heartbeatUpload(preparation: MaterialImportFallbackPreparedUpload): Promise<boolean> {
    const result = await this.repository.query(`
      update material_import_idempotency set lease_expires_at=now()+make_interval(secs=>$3),updated_at=now()
      where operation_id=$1 and state='PENDING' and lease_token=$2 and lease_expires_at>now()
    `, [preparation.operationId, preparation.leaseToken, this.leaseSeconds]);
    return result.rowCount === 1;
  }

  private async claimExpiredUpload(workerId: string): Promise<ClaimedMaterialImportUpload | null> {
    if (!workerId || workerId.length > 200 || /[\u0000-\u001f\u007f]/.test(workerId)) {
      throw new Error("IMPORT_RECONCILER_ID_INVALID");
    }
    void workerId;
    return this.repository.transaction(async (client) => {
      const selected = await client.query(`
        select i.username,i.batch_id idempotency_batch_id,i.method,i.route_scope,i.file_id idempotency_file_id,
          i.recovery_until,i.lease_token previous_lease_token,o.*,b.created_by,b.status batch_status
        from material_import_idempotency i
        join material_import_upload_operations o on o.operation_id=i.operation_id
        join material_import_batches b on b.id=o.batch_id
        where i.state='PENDING' and i.username=b.created_by and i.batch_id=o.batch_id and i.method='POST'
          and i.route_scope='/api/material-master/import-batches/'||o.batch_id::text||'/file'
          and i.recovery_until>now()
          and (i.lease_expires_at is null or i.lease_expires_at<=now())
          and o.phase in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED')
          and b.status in ('UPLOAD_PENDING','RECONCILIATION_REQUIRED')
          and (o.phase not in ('PREPARED','RECONCILIATION_REQUIRED') or o.updated_at<=now()-interval '5 minutes')
        order by case o.phase when 'PROMOTED' then 0 when 'SECURITY_PASSED' then 1
          when 'STAGED' then 2 when 'PREPARED' then 3 else 4 end,o.updated_at,o.operation_id
        for update of i,o,b skip locked limit 1
      `);
      const row = selected.rows[0];
      if (!row) return null;
      const leaseToken = randomUUID();
      if (row.previous_lease_token) await this.store.cleanupOperationTemp(String(row.operation_id), String(row.previous_lease_token));
      const claimed = await client.query(`
        update material_import_idempotency set lease_token=$2,
          lease_expires_at=now()+make_interval(secs=>$3),updated_at=now()
        where operation_id=$1 and state='PENDING'
          and (lease_expires_at is null or lease_expires_at<=now())
      `, [row.operation_id, leaseToken, this.leaseSeconds]);
      if (claimed.rowCount !== 1) return null;
      const operation = asUploadOperation(row);
      return {
        preparation: uploadPreparation(operation, leaseToken, true),
        actor: { username: String(row.username), permissions: ["material.import.create"] },
        phase: operation.phase,
        requestId: randomUUID(),
      };
    });
  }

  private async cleanupTerminalFile(
    preparation: MaterialImportFallbackPreparedUpload,
    fileId: number,
  ): Promise<boolean> {
    const evidence = await this.repository.query(`
      select actual_sha256,actual_size_bytes from material_import_files
      where id=$1 and batch_id=$2 and storage_name=$3 and relative_path=$4
        and staging_relative_path=$5 and storage_status='DELETE_PENDING'
    `, [fileId, preparation.batchId, preparation.operationId,
      preparation.finalRelativePath, preparation.stagingRelativePath]);
    const row = evidence.rows[0];
    const expectedSha256 = String(row?.actual_sha256 ?? "");
    const expectedSizeBytes = Number(row?.actual_size_bytes);
    if (!SHA256.test(expectedSha256) || !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0) {
      await this.repository.query(`
        update material_import_files set storage_status='RECONCILIATION_REQUIRED',updated_at=now()
        where id=$1 and storage_status='DELETE_PENDING'
      `, [fileId]);
      return false;
    }
    const before = await Promise.all([
      this.store.inspectOptional(preparation.stagingRelativePath, this.maximumBytes),
      this.store.inspectOptional(preparation.finalRelativePath, this.maximumBytes),
    ]);
    if (before.some((facts) => facts && !sameStoredFacts(facts, expectedSha256, expectedSizeBytes))) {
      await this.repository.query(`
        update material_import_files set storage_status='RECONCILIATION_REQUIRED',updated_at=now()
        where id=$1 and storage_status='DELETE_PENDING'
      `, [fileId]);
      return false;
    }
    await this.store.delete(preparation.stagingRelativePath);
    await this.store.delete(preparation.finalRelativePath);
    const [staging, final] = await Promise.all([
      this.store.inspectOptional(preparation.stagingRelativePath, this.maximumBytes),
      this.store.inspectOptional(preparation.finalRelativePath, this.maximumBytes),
    ]);
    if (staging || final) return false;
    const deleted = await this.repository.query(`
      update material_import_files set storage_status='DELETED',updated_at=now()
      where id=$1 and batch_id=$2 and storage_name=$3 and relative_path=$4
        and staging_relative_path=$5 and storage_status='DELETE_PENDING'
    `, [fileId, preparation.batchId, preparation.operationId,
      preparation.finalRelativePath, preparation.stagingRelativePath]);
    return deleted.rowCount === 1;
  }

  private async reconcileOneDeletePending(workerId: string): Promise<boolean> {
    if (!workerId || workerId.length > 200 || /[\u0000-\u001f\u007f]/.test(workerId)) {
      throw new Error("IMPORT_RECONCILER_ID_INVALID");
    }
    const selected = await this.repository.transaction(async (client) => {
      const result = await client.query(`
        select f.id file_id,f.batch_id,f.storage_name,f.relative_path,f.staging_relative_path,
               f.filename_extension,o.operation_id,o.expected_batch_version,o.declared_filename,
               o.declared_mime_type,o.declared_sha256,o.declared_size_bytes,o.duplicate_action,
               o.staging_relative_path operation_staging_path,o.final_relative_path operation_final_path
        from material_import_files f
        join material_import_upload_operations o
          on o.operation_id=f.storage_name and o.batch_id=f.batch_id
        join material_import_idempotency i
          on i.operation_id=o.operation_id and i.batch_id=f.batch_id and i.file_id=f.id
        join material_import_batches b on b.id=f.batch_id
        where f.storage_status='DELETE_PENDING' and f.security_check_status='REJECTED'
          and o.phase='FAILED' and i.state='COMPLETED' and b.status in ('FAILED','CANCELLED')
          and f.updated_at<=now()-interval '5 seconds'
        order by f.updated_at,f.id for update of f skip locked limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      let canonical: ReturnType<LocalMaterialImportFileStore["paths"]> | null = null;
      try {
        canonical = this.store.paths(Number(row.batch_id), String(row.operation_id), String(row.filename_extension));
      } catch { /* Invalid durable identity is isolated below. */ }
      const valid = canonical
        && row.storage_name === row.operation_id
        && row.relative_path === row.operation_final_path
        && row.staging_relative_path === row.operation_staging_path
        && row.relative_path === canonical.finalRelativePath
        && row.staging_relative_path === canonical.stagingRelativePath;
      if (!valid) {
        const isolated = await client.query(`
          update material_import_files set storage_status='RECONCILIATION_REQUIRED',updated_at=now()
          where id=$1 and storage_status='DELETE_PENDING'
        `, [row.file_id]);
        if (isolated.rowCount !== 1) throw new Error("IMPORT_DELETE_ISOLATION_CAS_FAILED");
        await this.repository.audit(client, {
          actor: workerId, action: "IMPORT_DELETE_IDENTITY_REJECTED", requestId: randomUUID(),
          routeCode: "IMPORT_FILE_DELETE_RECONCILER", result: "failed", errorCode: "IMPORT_FILE_DELETE_IDENTITY_MISMATCH",
          details: { batch_id: Number(row.batch_id), operation_id: String(row.operation_id), file_id: Number(row.file_id) },
        });
        return { isolated: true as const };
      }
      const operation = asUploadOperation({
        ...row,
        staging_relative_path: row.operation_staging_path,
        final_relative_path: row.operation_final_path,
        filename_extension: row.filename_extension,
        phase: "FAILED",
      });
      return {
        isolated: false as const,
        fileId: Number(row.file_id),
        preparation: uploadPreparation(operation, randomUUID(), true),
      };
    });
    if (!selected) return false;
    if (selected.isolated) return true;
    try {
      if (!(await this.cleanupTerminalFile(selected.preparation, selected.fileId))) {
        await this.repository.query(
          "update material_import_files set updated_at=now() where id=$1 and storage_status='DELETE_PENDING'",
          [selected.fileId],
        );
      }
    } catch {
      await this.repository.query(
        "update material_import_files set updated_at=now() where id=$1 and storage_status='DELETE_PENDING'",
        [selected.fileId],
      ).catch(() => undefined);
    }
    return true;
  }

  private async expireOneUploadRecovery(workerId: string): Promise<boolean> {
    if (!workerId || workerId.length > 200 || /[\u0000-\u001f\u007f]/.test(workerId)) {
      throw new Error("IMPORT_RECONCILER_ID_INVALID");
    }
    return this.repository.transaction(async (client) => {
      const selected = await client.query(`
        select i.operation_id,i.username,i.batch_id,o.phase,b.status batch_status,b.current_version,b.created_by
        from material_import_idempotency i
        join material_import_upload_operations o on o.operation_id=i.operation_id and o.batch_id=i.batch_id
        join material_import_batches b on b.id=i.batch_id and b.created_by=i.username
        where i.state='PENDING' and i.method='POST'
          and i.route_scope='/api/material-master/import-batches/'||i.batch_id::text||'/file'
          and i.recovery_until<=now()
          and o.phase in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED')
          and b.status in ('UPLOAD_PENDING','RECONCILIATION_REQUIRED')
        order by i.recovery_until,i.operation_id for update of i,o,b skip locked limit 1
      `);
      const row = selected.rows[0];
      if (!row) return false;
      const requestId = randomUUID();
      const wasReconciliation = row.batch_status === "RECONCILIATION_REQUIRED";
      const operation = await client.query(`
        update material_import_upload_operations set phase='RECONCILIATION_REQUIRED',
          failure_code='IMPORT_RECONCILIATION_REQUIRED',failure_message='上传恢复期限已过，需要人工协调',updated_at=now()
        where operation_id=$1 and phase in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED')
      `, [row.operation_id]);
      if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_RECOVERY_EXPIRY_CAS_FAILED");
      await client.query(`
        update material_import_files set storage_status='RECONCILIATION_REQUIRED',updated_at=now()
        where batch_id=$1 and storage_name=$2
          and storage_status in ('STAGING','STAGED','STORED','RECONCILIATION_REQUIRED')
          and security_check_status<>'BASIC_CHECK_PASSED'
      `, [row.batch_id, row.operation_id]);
      let currentVersion = Number(row.current_version);
      if (!wasReconciliation) {
        const batch = await client.query(`
          update material_import_batches set status='RECONCILIATION_REQUIRED',failure_stage='STORAGE_COORDINATION',
            failure_code='IMPORT_RECONCILIATION_REQUIRED',failure_message='上传恢复期限已过，需要人工协调',
            current_version=current_version+1,updated_at=now()
          where id=$1 and status='UPLOAD_PENDING' returning current_version
        `, [row.batch_id]);
        if (batch.rowCount !== 1) throw new Error("IMPORT_UPLOAD_RECOVERY_EXPIRY_CAS_FAILED");
        currentVersion = Number(batch.rows[0].current_version);
        await this.repository.event(client, {
          batchId: Number(row.batch_id), eventType: "IMPORT_UPLOAD_RECOVERY_EXPIRED", actorType: "WORKER",
          actorIdentifier: workerId, previousStatus: "UPLOAD_PENDING", newStatus: "RECONCILIATION_REQUIRED",
          requestId, safeDetails: { operation_id: String(row.operation_id) },
        });
      }
      const idempotency = await client.query(`
        update material_import_idempotency set state='COMPLETED',response=$2,status_code=409,
          lease_token=null,lease_expires_at=null,updated_at=now()
        where operation_id=$1 and state='PENDING'
      `, [row.operation_id, storedFailure("IMPORT_RECONCILIATION_REQUIRED", "上传恢复期限已过，需要人工协调", currentVersion)]);
      if (idempotency.rowCount !== 1) throw new Error("IMPORT_UPLOAD_RECOVERY_EXPIRY_CAS_FAILED");
      await this.repository.audit(client, {
        actor: workerId, action: "IMPORT_UPLOAD_RECOVERY_EXPIRED", requestId,
        routeCode: "IMPORT_FILE_UPLOAD_RECONCILER", result: "failed", errorCode: "IMPORT_RECONCILIATION_REQUIRED",
        details: { batch_id: Number(row.batch_id), operation_id: String(row.operation_id), initiator: String(row.username) },
      });
      return true;
    });
  }

  async reconcileOneUpload(workerId: string): Promise<boolean> {
    if (await this.reconcileOneDeletePending(workerId)) return true;
    if (await this.expireOneUploadRecovery(workerId)) return true;
    const claimed = await this.claimExpiredUpload(workerId);
    if (!claimed) return false;
    const { preparation, actor, requestId } = claimed;
    const heartbeat = new UploadLeaseHeartbeat(
      () => this.heartbeatUpload(preparation),
      Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3)),
    );
    try {
      await heartbeat.renew();
      const staging = await this.store.inspectOptional(preparation.stagingRelativePath, this.maximumBytes);
      const final = await this.store.inspectOptional(preparation.finalRelativePath, this.maximumBytes);
      for (const facts of [staging, final]) {
        if (facts && (facts.sha256 !== preparation.declaredSha256 || facts.sizeBytes !== preparation.declaredSizeBytes)) {
          throw new Error("IMPORT_RECOVERY_FILE_FACTS_MISMATCH");
        }
      }
      await heartbeat.renew();
      if (staging) {
        const opened = await this.store.open(preparation.stagingRelativePath);
        if (!opened) throw new Error("IMPORT_RECOVERY_FILE_MISSING");
        try { await heartbeat.renew(); }
        catch (error) { await opened.cancel(error).catch(() => undefined); throw error; }
        await heartbeat.stop();
        await this.executeUpload({
          preparation,
          actor,
          requestId,
          part: {
            filename: preparation.declaredFilename,
            declaredMimeType: preparation.declaredMimeType,
            stream: opened,
            completion: Promise.resolve({
              actualSizeBytes: staging.sizeBytes,
              actualSha256: staging.sha256,
              prefix: staging.prefix,
            }),
          },
        });
        return true;
      }
      if (final) {
          let detected: "CSV" | "XLS" | "XLSX";
          try {
            const basic = detectMaterialImportFileType(final.prefix);
            detected = preparation.filenameExtension === ".xls" ? "XLS" : basic;
          } catch (error) {
            const known = error instanceof MaterialImportFileSecurityError ? error : null;
            return await this.rejectOrReconcile({
              preparation,
              actor,
              requestId,
              code: known?.code ?? "IMPORT_FILE_TYPE_UNSUPPORTED",
              message: known?.message ?? "文件类型不受支持",
              status: 422,
              cleanupRelativePath: preparation.finalRelativePath,
            });
          }
          const fileId = await this.recordStaged(preparation, actor, final, detected, "FINAL");
          let security;
          try {
            security = await runMaterialImportBasicSecurityCheck({
              store: this.store,
              objectKey: preparation.finalRelativePath,
              actualSizeBytes: final.sizeBytes,
              detectedType: detected === "XLS" ? "XLSX" : detected,
              filenameExtension: preparation.filenameExtension,
              declaredMimeType: preparation.declaredMimeType,
            });
          } catch (error) {
            const known = error instanceof MaterialImportFileSecurityError ? error : null;
            return await this.rejectOrReconcile({
              preparation,
              actor,
              requestId,
              code: known?.code ?? "IMPORT_FILE_SECURITY_CHECK_FAILED",
              message: known?.message ?? "文件基础安全检查失败",
              status: 422,
              cleanupRelativePath: preparation.finalRelativePath,
            });
          }
          await this.checkDuplicateAndMarkSecurity({
            preparation,
            actor,
            requestId,
            fileId,
            warningCodes: security.warningCodes,
            cleanupRelativePath: preparation.finalRelativePath,
          });
          await heartbeat.renew();
          await this.recordPromoted({ preparation, actor, fileId, facts: final });
          await heartbeat.renew();
          await this.publishUpload({ preparation, actor, requestId, fileId, facts: final });
          return true;
      }
      if (claimed.phase === "PREPARED") {
        const file = await this.repository.query("select id from material_import_files where batch_id=$1", [preparation.batchId]);
        if (!file.rows[0]) {
          return await this.failPreparedUpload({
            preparation,
            actor,
            requestId,
            code: "IMPORT_UPLOAD_BODY_MISSING",
            message: "上传正文未完成，请重新创建导入批次",
            status: 422,
          });
        }
      }
      await this.markReconciliation(preparation, actor, requestId, "IMPORT_RECOVERY_FILE_MISSING");
      return true;
    } catch (error) {
      if (error instanceof MaterialImportFallbackError) return true;
      const candidate = error instanceof Error ? error.message : "IMPORT_UPLOAD_RESULT_UNKNOWN";
      await this.markReconciliation(preparation, actor, requestId, safeErrorCode(candidate)).catch(() => undefined);
      return true;
    } finally {
      await heartbeat.stop();
    }
  }

  private async lockUpload(
    client: PoolClient,
    preparation: MaterialImportFallbackPreparedUpload,
    actor: MaterialImportFallbackActor,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(`
      select i.state,i.username,i.method,i.route_scope,i.batch_id idempotency_batch_id,i.file_id idempotency_file_id,
             i.lease_token,i.lease_expires_at>now() lease_active,i.response,i.status_code,
             o.*,b.status batch_status,b.current_version,b.created_by,b.retry_of_batch_id,b.source_kind
      from material_import_idempotency i
      join material_import_upload_operations o on o.operation_id=i.operation_id
      join material_import_batches b on b.id=o.batch_id
      where i.operation_id=$1 for update of i,o,b
    `, [preparation.operationId]);
    const row = result.rows[0];
    if (!row || row.state !== "PENDING" || row.lease_token !== preparation.leaseToken || row.lease_active !== true) {
      throw new Error("IMPORT_UPLOAD_LEASE_LOST");
    }
    if (row.created_by !== actor.username
      || row.username !== actor.username
      || row.method !== "POST"
      || row.route_scope !== `/api/material-master/import-batches/${preparation.batchId}/file`
      || Number(row.idempotency_batch_id) !== preparation.batchId
      || Number(row.batch_id) !== preparation.batchId
      || Number(row.expected_batch_version) !== preparation.expectedBatchVersion
      || row.declared_filename !== preparation.declaredFilename
      || row.filename_extension !== preparation.filenameExtension
      || row.declared_mime_type !== preparation.declaredMimeType
      || row.staging_relative_path !== preparation.stagingRelativePath
      || row.final_relative_path !== preparation.finalRelativePath
      || row.declared_sha256 !== preparation.declaredSha256
      || Number(row.declared_size_bytes) !== preparation.declaredSizeBytes
      || row.duplicate_action !== preparation.duplicateAction) {
      throw new Error("IMPORT_UPLOAD_EVIDENCE_MISMATCH");
    }
    if (Number(row.current_version) !== expectedUploadBatchVersion(preparation, row.batch_status)) {
      throw new Error("IMPORT_UPLOAD_VERSION_DRIFT");
    }
    return row;
  }

  private async recordStaged(
    preparation: MaterialImportFallbackPreparedUpload,
    actor: MaterialImportFallbackActor,
    facts: LocalMaterialImportFileFacts,
    detectedFileType: "CSV" | "XLS" | "XLSX" | null,
    factsLocation: "STAGING" | "FINAL" = "STAGING",
  ): Promise<number> {
    return this.repository.transaction(async (client) => {
      const expectedFactsPath = factsLocation === "FINAL" ? preparation.finalRelativePath : preparation.stagingRelativePath;
      if (facts.relativePath !== expectedFactsPath) throw new Error("IMPORT_FILE_STORAGE_PATH_MISMATCH");
      const locked = await this.lockUpload(client, preparation, actor);
      if (!["UPLOAD_PENDING", "RECONCILIATION_REQUIRED"].includes(String(locked.batch_status))) {
        throw new Error("IMPORT_UPLOAD_STAGE_STATE_INVALID");
      }
      const existing = await client.query("select * from material_import_files where batch_id=$1 for update", [preparation.batchId]);
      let fileId: number;
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.storage_name !== preparation.operationId || row.relative_path !== preparation.finalRelativePath
          || row.staging_relative_path !== preparation.stagingRelativePath || row.actual_sha256 !== facts.sha256
          || Number(row.actual_size_bytes) !== facts.sizeBytes
          || row.original_filename !== preparation.declaredFilename
          || row.filename_extension !== preparation.filenameExtension
          || String(row.declared_mime_type ?? "") !== preparation.declaredMimeType
          || row.declared_sha256 !== preparation.declaredSha256
          || Number(row.declared_size_bytes) !== preparation.declaredSizeBytes) {
          throw new Error("IMPORT_FILE_DATABASE_FACTS_MISMATCH");
        }
        fileId = Number(row.id);
      } else {
        const inserted = await client.query(`
          insert into material_import_files(
            batch_id,storage_name,relative_path,staging_relative_path,original_filename,filename_extension,
            mime_type,declared_mime_type,sha256,declared_sha256,size_bytes,declared_size_bytes,
            detected_file_type,actual_sha256,actual_size_bytes,storage_status,security_check_status,uploaded_at
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'STAGED','PENDING',now()) returning id
        `, [preparation.batchId, preparation.operationId, preparation.finalRelativePath, preparation.stagingRelativePath,
          preparation.declaredFilename, preparation.filenameExtension, preparation.declaredMimeType || "application/octet-stream",
          preparation.declaredMimeType || null, facts.sha256, preparation.declaredSha256, facts.sizeBytes,
          preparation.declaredSizeBytes, detectedFileType, facts.sha256, facts.sizeBytes]);
        fileId = Number(inserted.rows[0].id);
      }
      const savedFile = await client.query(`
        update material_import_files set detected_file_type=$2,storage_status='STAGED',security_check_status='PENDING',
          security_failure_code=null,security_failure_message=null,security_warning_codes='[]'::jsonb,
          promoted_at=case when $4::text='FINAL' then coalesce(promoted_at,now()) else null end,updated_at=now()
        where id=$1 and batch_id=$3
      `, [fileId, detectedFileType, preparation.batchId, factsLocation]);
      if (savedFile.rowCount !== 1) throw new Error("IMPORT_FILE_STAGE_UPDATE_FAILED");
      const operation = await client.query(`
        update material_import_upload_operations set phase='STAGED',failure_code=null,failure_message=null,
          staged_at=coalesce(staged_at,now()),checked_at=null,promoted_at=null,completed_at=null,updated_at=now()
        where operation_id=$1 and phase in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED')
      `, [preparation.operationId]);
      if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_STAGE_STATE_INVALID");
      return fileId;
    });
  }

  private async completeFailureTx(client: PoolClient, input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    code: string;
    message: string;
    status: number;
    failureStage: string;
  }>): Promise<Readonly<{ fileId: number | null; currentVersion: number }>> {
    const code = safeErrorCode(input.code);
    const message = safeFailureMessage(input.message);
    const row = await this.lockUpload(client, input.preparation, input.actor);
    if (!["UPLOAD_PENDING", "RECONCILIATION_REQUIRED"].includes(String(row.batch_status))) {
      throw new Error("IMPORT_UPLOAD_FAILURE_STATE_INVALID");
    }
    const file = await client.query("select id from material_import_files where batch_id=$1 for update", [input.preparation.batchId]);
    const fileId = file.rows[0] ? Number(file.rows[0].id) : null;
    if (fileId !== null) {
      const deleted = await client.query(`
        update material_import_files set storage_status='DELETE_PENDING',security_check_status='REJECTED',
          security_failure_code=$2,security_failure_message=$3,updated_at=now() where id=$1
      `, [fileId, code, message]);
      if (deleted.rowCount !== 1) throw new Error("IMPORT_FILE_FAILURE_UPDATE_FAILED");
    }
    const batch = await client.query(`
      update material_import_batches set status='FAILED',failure_stage=$2,failure_code=$3,failure_message=$4,
        current_version=current_version+1,updated_at=now()
      where id=$1 and created_by=$5 and status in ('UPLOAD_PENDING','RECONCILIATION_REQUIRED')
        and current_version=$6 returning *
    `, [input.preparation.batchId, input.failureStage, code, message, input.actor.username, Number(row.current_version)]);
    if (batch.rowCount !== 1) throw new Error("IMPORT_UPLOAD_FAILURE_STATE_INVALID");
    const currentVersion = Number(batch.rows[0].current_version);
    const response = storedFailure(code, message, currentVersion);
    const operation = await client.query(`
      update material_import_upload_operations set phase='FAILED',failure_code=$2,failure_message=$3,
        completed_at=now(),updated_at=now()
      where operation_id=$1 and phase in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED')
    `, [input.preparation.operationId, code, message]);
    if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_FAILURE_STATE_INVALID");
    const idempotency = await client.query(`
      update material_import_idempotency set state='COMPLETED',file_id=$2,response=$3,status_code=$4,
        lease_token=null,lease_expires_at=null,updated_at=now() where operation_id=$1 and state='PENDING'
    `, [input.preparation.operationId, fileId, response, input.status]);
    if (idempotency.rowCount !== 1) throw new Error("IMPORT_UPLOAD_FAILURE_STATE_INVALID");
    await this.repository.event(client, {
      batchId: input.preparation.batchId, eventType: "IMPORT_UPLOAD_FAILED", actorType: "USER",
      actorIdentifier: input.actor.username, previousStatus: String(row.batch_status), newStatus: "FAILED",
      requestId: input.requestId, safeDetails: { operation_id: input.preparation.operationId, failure_code: code },
    });
    await this.repository.audit(client, {
      actor: input.actor.username, action: "IMPORT_UPLOAD_FAILED", requestId: input.requestId,
      routeCode: "IMPORT_FILE_UPLOAD", result: "failed", errorCode: code,
      details: { batch_id: input.preparation.batchId, operation_id: input.preparation.operationId },
    });
    return { fileId, currentVersion };
  }

  private async rejectUpload(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    code: string;
    message: string;
    status: number;
    failureStage?: string;
    cleanupRelativePath?: string;
  }>): Promise<never> {
    const code = safeErrorCode(input.code);
    const message = safeFailureMessage(input.message);
    const completed = await this.repository.transaction((client) => this.completeFailureTx(client, {
      ...input, code, message, failureStage: input.failureStage ?? "FILE_SECURITY",
    }));
    if (completed.fileId !== null) {
      try {
        await this.cleanupTerminalFile(input.preparation, completed.fileId);
      } catch { /* DELETE_PENDING is durable recovery evidence. */ }
    }
    throw new MaterialImportFallbackError(code, message, input.status, {
      currentVersion: completed.currentVersion,
      operationId: input.preparation.operationId,
    });
  }

  private async rejectOrReconcile(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    code: string;
    message: string;
    status: number;
    failureStage?: string;
    cleanupRelativePath?: string;
  }>): Promise<never> {
    try {
      return await this.rejectUpload(input);
    } catch (error) {
      if (error instanceof MaterialImportFallbackError) throw error;
      await this.markReconciliation(
        input.preparation,
        input.actor,
        input.requestId,
        "IMPORT_TERMINAL_RESULT_UNKNOWN",
      ).catch(() => undefined);
      throw new MaterialImportFallbackError("RESULT_UNKNOWN", "上传结果尚未确认，请使用原操作标识恢复", 503, {
        operationId: input.preparation.operationId,
        retryAfterSeconds: 5,
      });
    }
  }

  private async markReconciliation(
    preparation: MaterialImportFallbackPreparedUpload,
    actor: MaterialImportFallbackActor,
    requestId: string,
    code: string,
  ): Promise<void> {
    const failureCode = safeErrorCode(code);
    await this.repository.transaction(async (client) => {
      const result = await client.query(`
        select i.state,i.username,i.lease_token,o.*,b.status batch_status,b.current_version,b.created_by
        from material_import_idempotency i
        join material_import_upload_operations o on o.operation_id=i.operation_id
        join material_import_batches b on b.id=o.batch_id
        where i.operation_id=$1 for update of i,o,b
      `, [preparation.operationId]);
      const row = result.rows[0];
      if (!row || row.state !== "PENDING" || row.lease_token !== preparation.leaseToken) return;
      if (row.username !== actor.username || row.created_by !== actor.username
        || Number(row.batch_id) !== preparation.batchId
        || Number(row.expected_batch_version) !== preparation.expectedBatchVersion
        || row.declared_filename !== preparation.declaredFilename
        || row.filename_extension !== preparation.filenameExtension
        || row.declared_mime_type !== preparation.declaredMimeType
        || row.declared_sha256 !== preparation.declaredSha256
        || Number(row.declared_size_bytes) !== preparation.declaredSizeBytes
        || row.duplicate_action !== preparation.duplicateAction
        || row.staging_relative_path !== preparation.stagingRelativePath
        || row.final_relative_path !== preparation.finalRelativePath) {
        throw new Error("IMPORT_UPLOAD_EVIDENCE_MISMATCH");
      }
      if (!["PREPARED", "STAGED", "SECURITY_PASSED", "PROMOTED", "RECONCILIATION_REQUIRED"].includes(String(row.phase))
        || !["UPLOAD_PENDING", "RECONCILIATION_REQUIRED"].includes(String(row.batch_status))) return;
      const wasReconciliation = row.batch_status === "RECONCILIATION_REQUIRED";
      const operation = await client.query(`
        update material_import_upload_operations set phase='RECONCILIATION_REQUIRED',failure_code=$2,
          failure_message='文件与数据库状态需要后台协调',updated_at=now() where operation_id=$1
      `, [preparation.operationId, failureCode]);
      if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_RECONCILIATION_UPDATE_FAILED");
      await client.query(`
        update material_import_files set storage_status='RECONCILIATION_REQUIRED',updated_at=now()
        where batch_id=$1 and storage_name=$2 and storage_status in ('STAGED','STAGING')
      `, [preparation.batchId, preparation.operationId]);
      if (!wasReconciliation) {
        const batch = await client.query(`
          update material_import_batches set status='RECONCILIATION_REQUIRED',failure_stage='STORAGE_COORDINATION',
            failure_code=$2,failure_message='文件与数据库状态需要后台协调',current_version=current_version+1,updated_at=now()
          where id=$1 and created_by=$3 and status='UPLOAD_PENDING'
        `, [preparation.batchId, failureCode, actor.username]);
        if (batch.rowCount !== 1) throw new Error("IMPORT_UPLOAD_RECONCILIATION_UPDATE_FAILED");
        await this.repository.event(client, {
          batchId: preparation.batchId, eventType: "IMPORT_UPLOAD_RECONCILIATION_REQUIRED", actorType: "SYSTEM",
          actorIdentifier: "material-import-upload-coordinator", previousStatus: String(row.batch_status), newStatus: "RECONCILIATION_REQUIRED",
          requestId, safeDetails: { operation_id: preparation.operationId, failure_code: failureCode },
        });
      }
      const released = await client.query(`
        update material_import_idempotency set lease_expires_at=now()+interval '5 seconds',updated_at=now()
        where operation_id=$1 and state='PENDING' and lease_token=$2
      `, [preparation.operationId, preparation.leaseToken]);
      if (released.rowCount !== 1) throw new Error("IMPORT_UPLOAD_RECONCILIATION_LEASE_LOST");
      await this.repository.audit(client, {
        actor: actor.username, action: "IMPORT_UPLOAD_RECONCILIATION_REQUIRED", requestId,
        routeCode: "IMPORT_FILE_UPLOAD", result: "failed", errorCode: failureCode,
        details: { batch_id: preparation.batchId, operation_id: preparation.operationId },
      });
    });
  }

  private async checkDuplicateAndMarkSecurity(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    fileId: number;
    warningCodes: readonly string[];
    cleanupRelativePath?: string;
  }>): Promise<void> {
    const warningCodes = safeWarningCodes(input.warningCodes);
    const failure = await this.repository.transaction(async (client) => {
      await this.lockUpload(client, input.preparation, input.actor);
      const file = await client.query("select * from material_import_files where id=$1 and batch_id=$2 for update", [input.fileId, input.preparation.batchId]);
      const fileRow = file.rows[0];
      const expectedDetectedType = input.preparation.filenameExtension === ".csv"
        ? "CSV"
        : input.preparation.filenameExtension === ".xls" ? "XLS" : "XLSX";
      if (!fileRow || fileRow.storage_name !== input.preparation.operationId
        || fileRow.relative_path !== input.preparation.finalRelativePath
        || fileRow.staging_relative_path !== input.preparation.stagingRelativePath
        || fileRow.declared_sha256 !== input.preparation.declaredSha256
        || Number(fileRow.declared_size_bytes) !== input.preparation.declaredSizeBytes
        || fileRow.actual_sha256 !== input.preparation.declaredSha256
        || Number(fileRow.actual_size_bytes) !== input.preparation.declaredSizeBytes
        || fileRow.detected_file_type !== expectedDetectedType
        || fileRow.security_check_status !== "PENDING"
        || !["STAGED", "RECONCILIATION_REQUIRED"].includes(String(fileRow.storage_status))) {
        throw new Error("IMPORT_FILE_DATABASE_FACTS_MISMATCH");
      }
      const duplicateFailure = await this.duplicateFailure(
        client,
        input.preparation,
        input.actor,
        input.fileId,
        String(fileRow.actual_sha256),
      );
      if (duplicateFailure) {
        const terminal = await this.completeFailureTx(client, {
          preparation: input.preparation, actor: input.actor, requestId: input.requestId,
          code: duplicateFailure.code, message: duplicateFailure.message, status: 409, failureStage: "DUPLICATE_CHECK",
        });
        return { ...duplicateFailure, ...terminal };
      }
      const savedFile = await client.query(`
        update material_import_files set security_warning_codes=$2,security_failure_code=null,
          security_failure_message=null,updated_at=now()
        where id=$1 and security_check_status='PENDING' and storage_status in ('STAGED','RECONCILIATION_REQUIRED')
      `, [input.fileId, JSON.stringify(warningCodes)]);
      if (savedFile.rowCount !== 1) throw new Error("IMPORT_FILE_SECURITY_STATE_INVALID");
      const operation = await client.query(`
        update material_import_upload_operations set phase='SECURITY_PASSED',failure_code=null,failure_message=null,
          staged_at=coalesce(staged_at,now()),checked_at=now(),promoted_at=null,completed_at=null,updated_at=now()
        where operation_id=$1 and phase in ('STAGED','RECONCILIATION_REQUIRED')
      `, [input.preparation.operationId]);
      if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_SECURITY_STATE_INVALID");
      return null;
    });
    if (failure) {
      try {
        if (failure.fileId !== null) await this.cleanupTerminalFile(input.preparation, failure.fileId);
      } catch { /* DELETE_PENDING is durable recovery evidence. */ }
      throw new MaterialImportFallbackError(failure.code, failure.message, 409, {
        currentVersion: failure.currentVersion, operationId: input.preparation.operationId,
      });
    }
  }

  private async duplicateFailure(
    client: PoolClient,
    preparation: MaterialImportFallbackPreparedUpload,
    actor: MaterialImportFallbackActor,
    fileId: number,
    actualSha256: string,
  ): Promise<Readonly<{ code: string; message: string }> | null> {
    if (!SHA256.test(actualSha256)) throw new Error("IMPORT_FILE_DATABASE_FACTS_MISMATCH");
    await client.query(
      "select pg_advisory_xact_lock(hashtext('material-import-file-sha256'),hashtext($1))",
      [actualSha256],
    );
    if (preparation.duplicateAction === "REJECT") {
      const duplicate = await client.query(`
        select f.batch_id from material_import_files f
        join material_import_batches b on b.id=f.batch_id
        where f.id<>$1 and f.actual_sha256=$2 and f.security_check_status='BASIC_CHECK_PASSED'
          and b.source_kind in ('CSV','XLSX')
          and (b.created_by=$3 or $4::boolean)
          and f.storage_status in ('STORED','DELETE_PENDING','DELETED') order by f.id limit 1
      `, [fileId, actualSha256, actor.username, hasPermission(actor, "material.import.read_any")]);
      return duplicate.rows[0]
        ? { code: "IMPORT_FILE_DUPLICATE", message: "相同内容的导入文件已存在" }
        : null;
    }
    const allowed = await client.query(`
      select parent.id from material_import_batches child
      join material_import_batches parent on parent.id=child.retry_of_batch_id
      join material_import_files parent_file on parent_file.batch_id=parent.id
      where child.id=$1 and child.created_by=$2 and parent.created_by=$2
        and parent.status='FAILED' and parent.failure_code='IMPORT_FILE_DUPLICATE'
        and parent_file.actual_sha256=$3
    `, [preparation.batchId, actor.username, actualSha256]);
    return allowed.rows[0]
      ? null
      : { code: "IMPORT_DUPLICATE_OVERRIDE_INVALID", message: "允许重复的重试关系或文件摘要不匹配" };
  }

  private async recordPromoted(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    fileId: number;
    facts: LocalMaterialImportFileFacts;
  }>): Promise<void> {
    await this.repository.transaction(async (client) => {
      const locked = await this.lockUpload(client, input.preparation, input.actor);
      if (locked.phase !== "SECURITY_PASSED"
        || !["UPLOAD_PENDING", "RECONCILIATION_REQUIRED"].includes(String(locked.batch_status))) {
        throw new Error("IMPORT_UPLOAD_PROMOTION_STATE_INVALID");
      }
      const expectedDetectedType = input.preparation.filenameExtension === ".csv"
        ? "CSV"
        : input.preparation.filenameExtension === ".xls" ? "XLS" : "XLSX";
      const file = await client.query(`
        select * from material_import_files where id=$1 and batch_id=$2 for update
      `, [input.fileId, input.preparation.batchId]);
      const row = file.rows[0];
      if (!row || row.storage_name !== input.preparation.operationId
        || row.relative_path !== input.preparation.finalRelativePath
        || row.staging_relative_path !== input.preparation.stagingRelativePath
        || row.declared_sha256 !== input.preparation.declaredSha256
        || Number(row.declared_size_bytes) !== input.preparation.declaredSizeBytes
        || row.actual_sha256 !== input.facts.sha256
        || Number(row.actual_size_bytes) !== input.facts.sizeBytes
        || row.detected_file_type !== expectedDetectedType
        || row.security_check_status !== "PENDING"
        || !["STAGED", "RECONCILIATION_REQUIRED"].includes(String(row.storage_status))) {
        throw new Error("IMPORT_FILE_PROMOTION_FACTS_MISMATCH");
      }
      const savedFile = await client.query(`
        update material_import_files set promoted_at=now(),updated_at=now()
        where id=$1 and batch_id=$2 and security_check_status='PENDING'
          and storage_status in ('STAGED','RECONCILIATION_REQUIRED') returning promoted_at
      `, [input.fileId, input.preparation.batchId]);
      if (savedFile.rowCount !== 1) throw new Error("IMPORT_FILE_PROMOTION_STATE_INVALID");
      const operation = await client.query(`
        update material_import_upload_operations set phase='PROMOTED',failure_code=null,failure_message=null,
          promoted_at=$2,completed_at=null,updated_at=now()
        where operation_id=$1 and phase='SECURITY_PASSED' and checked_at is not null
      `, [input.preparation.operationId, savedFile.rows[0].promoted_at]);
      if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_PROMOTION_STATE_INVALID");
    });
  }

  private async publishUpload(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    fileId: number;
    facts: LocalMaterialImportFileFacts;
  }>): Promise<MaterialImportFallbackResult> {
    const outcome = await this.repository.transaction(async (client) => {
      const locked = await this.lockUpload(client, input.preparation, input.actor);
      if (locked.phase !== "PROMOTED"
        || !["UPLOAD_PENDING", "RECONCILIATION_REQUIRED"].includes(String(locked.batch_status))) {
        throw new Error("IMPORT_UPLOAD_PUBLICATION_STATE_INVALID");
      }
      const fileResult = await client.query("select * from material_import_files where id=$1 and batch_id=$2 for update", [input.fileId, input.preparation.batchId]);
      const file = fileResult.rows[0];
      const expectedDetectedType = input.preparation.filenameExtension === ".csv"
        ? "CSV"
        : input.preparation.filenameExtension === ".xls" ? "XLS" : "XLSX";
      if (!file || file.storage_name !== input.preparation.operationId
        || file.actual_sha256 !== input.facts.sha256 || Number(file.actual_size_bytes) !== input.facts.sizeBytes
        || file.declared_sha256 !== input.facts.sha256 || Number(file.declared_size_bytes) !== input.facts.sizeBytes
        || file.relative_path !== input.preparation.finalRelativePath
        || file.staging_relative_path !== input.preparation.stagingRelativePath
        || file.detected_file_type !== expectedDetectedType
        || file.security_check_status !== "PENDING"
        || !["STAGED", "RECONCILIATION_REQUIRED"].includes(String(file.storage_status))
        || file.promoted_at == null || locked.promoted_at == null) {
        throw new Error("IMPORT_FILE_DATABASE_FACTS_MISMATCH");
      }
      const duplicateFailure = await this.duplicateFailure(
        client,
        input.preparation,
        input.actor,
        input.fileId,
        input.facts.sha256,
      );
      if (duplicateFailure) {
        const terminal = await this.completeFailureTx(client, {
          preparation: input.preparation,
          actor: input.actor,
          requestId: input.requestId,
          code: duplicateFailure.code,
          message: duplicateFailure.message,
          status: 409,
          failureStage: "DUPLICATE_CHECK",
        });
        return { kind: "REJECTED" as const, ...duplicateFailure, ...terminal };
      }
      const savedFile = await client.query(`
        update material_import_files set storage_status='STORED',security_check_status='BASIC_CHECK_PASSED',
          security_failure_code=null,security_failure_message=null,updated_at=now()
        where id=$1 and batch_id=$2 and promoted_at is not null and security_check_status='PENDING'
          and storage_status in ('STAGED','RECONCILIATION_REQUIRED') returning *
      `, [input.fileId, input.preparation.batchId]);
      if (savedFile.rowCount !== 1) throw new Error("IMPORT_FILE_PUBLICATION_STATE_INVALID");
      const batch = await client.query(`
        update material_import_batches set status='FILE_READY',file_count=1,failure_stage=null,failure_code=null,
          failure_message=null,current_version=current_version+1,updated_at=now()
        where id=$1 and created_by=$2 and file_count=0 and status in ('UPLOAD_PENDING','RECONCILIATION_REQUIRED')
          and current_version=$3 returning *
      `, [input.preparation.batchId, input.actor.username, Number(locked.current_version)]);
      if (batch.rowCount !== 1) throw new Error("IMPORT_UPLOAD_PUBLICATION_STATE_INVALID");
      const data = { batch: materialImportFallbackBatchDto(batch.rows[0]), file: materialImportFallbackFileDto(savedFile.rows[0]) };
      const response = storedSuccess(data);
      const operation = await client.query(`
        update material_import_upload_operations set phase='PUBLISHED',failure_code=null,failure_message=null,
          completed_at=now(),updated_at=now()
        where operation_id=$1 and phase='PROMOTED' and checked_at is not null and promoted_at is not null
      `, [input.preparation.operationId]);
      if (operation.rowCount !== 1) throw new Error("IMPORT_UPLOAD_PUBLICATION_STATE_INVALID");
      const idempotency = await client.query(`
        update material_import_idempotency set state='COMPLETED',file_id=$2,response=$3,status_code=201,
          lease_token=null,lease_expires_at=null,updated_at=now()
        where operation_id=$1 and state='PENDING' and lease_token=$4
      `, [input.preparation.operationId, input.fileId, response, input.preparation.leaseToken]);
      if (idempotency.rowCount !== 1) throw new Error("IMPORT_UPLOAD_PUBLICATION_STATE_INVALID");
      await this.repository.event(client, {
        batchId: input.preparation.batchId, eventType: "IMPORT_FILE_PUBLISHED", actorType: "USER",
        actorIdentifier: input.actor.username, previousStatus: String(locked.batch_status), newStatus: "FILE_READY",
        requestId: input.requestId, safeDetails: { operation_id: input.preparation.operationId, size_bytes: input.facts.sizeBytes, sha256: input.facts.sha256 },
      });
      await this.repository.audit(client, {
        actor: input.actor.username, action: "IMPORT_FILE_PUBLISHED", requestId: input.requestId,
        routeCode: "IMPORT_FILE_UPLOAD", details: { batch_id: input.preparation.batchId, operation_id: input.preparation.operationId, size_bytes: input.facts.sizeBytes, sha256: input.facts.sha256 },
      });
      return {
        kind: "PUBLISHED" as const,
        result: { data, statusCode: 201, operationId: input.preparation.operationId, replayed: false },
      };
    });
    if (outcome.kind === "REJECTED") {
      if (outcome.fileId !== null) {
        try {
          await this.cleanupTerminalFile(input.preparation, outcome.fileId);
        } catch { /* DELETE_PENDING is durable recovery evidence. */ }
      }
      throw new MaterialImportFallbackError(outcome.code, outcome.message, 409, {
        currentVersion: outcome.currentVersion,
        operationId: input.preparation.operationId,
      });
    }
    return outcome.result;
  }

  async executeUpload(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    part: MaterialImportUploadPart;
  }>): Promise<MaterialImportFallbackResult> {
    const heartbeat = new UploadLeaseHeartbeat(
      () => this.heartbeatUpload(input.preparation),
      Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3)),
    );
    let fileId: number | null = null;
    try {
      await heartbeat.renew();
      if (input.part.filename !== input.preparation.declaredFilename || normalizeMaterialImportMime(input.part.declaredMimeType) !== input.preparation.declaredMimeType) {
        const completion = input.part.completion.catch(() => null);
        await input.part.stream.cancel("IMPORT_MULTIPART_METADATA_MISMATCH").catch(() => undefined);
        await completion;
        return await this.rejectOrReconcile({
          preparation: input.preparation, actor: input.actor, requestId: input.requestId,
          code: "IMPORT_MULTIPART_METADATA_MISMATCH", message: "multipart 文件元数据与预检声明不一致", status: 400, failureStage: "UPLOAD",
        });
      }
      const completion = input.part.completion.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );
      const staged = await this.store.stage({
        relativePath: input.preparation.stagingRelativePath,
        leaseToken: input.preparation.leaseToken,
        body: input.part.stream,
        maximumBytes: this.maximumBytes,
        beforePublish: () => heartbeat.renew(),
      });
      const multipart = await completion;
      if (staged.kind === "stored") {
        if (!multipart.ok) throw multipart.error;
        if (multipart.value.actualSha256 !== staged.facts.sha256 || multipart.value.actualSizeBytes !== staged.facts.sizeBytes) {
          throw new Error("IMPORT_MULTIPART_STORAGE_FACTS_MISMATCH");
        }
      }
      await heartbeat.renew();
      let detected: "CSV" | "XLS" | "XLSX" | null = null;
      let detectionFailure: unknown = null;
      try {
        const basic = detectMaterialImportFileType(staged.facts.prefix);
        detected = input.preparation.filenameExtension === ".xls" ? "XLS" : basic;
      } catch (error) { detectionFailure = error; }
      fileId = await this.recordStaged(input.preparation, input.actor, staged.facts, detected);
      if (staged.facts.sha256 !== input.preparation.declaredSha256 || staged.facts.sizeBytes !== input.preparation.declaredSizeBytes) {
        return await this.rejectOrReconcile({
          preparation: input.preparation, actor: input.actor, requestId: input.requestId,
          code: "IMPORT_FILE_FACTS_MISMATCH", message: "服务端文件摘要或大小与声明不一致", status: 422,
        });
      }
      if (detectionFailure) {
        const known = detectionFailure instanceof MaterialImportFileSecurityError ? detectionFailure : null;
        return await this.rejectOrReconcile({
          preparation: input.preparation, actor: input.actor, requestId: input.requestId,
          code: known?.code ?? "IMPORT_FILE_TYPE_UNSUPPORTED", message: known?.message ?? "文件类型不受支持", status: 422,
        });
      }
      const security = await runMaterialImportBasicSecurityCheck({
        store: this.store,
        objectKey: input.preparation.stagingRelativePath,
        actualSizeBytes: staged.facts.sizeBytes,
        detectedType: detected === "XLS" ? "XLSX" : detected!,
        filenameExtension: input.preparation.filenameExtension,
        declaredMimeType: input.preparation.declaredMimeType,
      });
      await this.checkDuplicateAndMarkSecurity({
        preparation: input.preparation, actor: input.actor, requestId: input.requestId,
        fileId, warningCodes: security.warningCodes,
      });
      await heartbeat.renew();
      const promoted = await this.store.promote({
        stagingRelativePath: input.preparation.stagingRelativePath,
        finalRelativePath: input.preparation.finalRelativePath,
        expectedSha256: staged.facts.sha256,
        expectedSizeBytes: staged.facts.sizeBytes,
        maximumBytes: this.maximumBytes,
        beforePublish: () => heartbeat.renew(),
      });
      await heartbeat.renew();
      await this.recordPromoted({
        preparation: input.preparation,
        actor: input.actor,
        fileId,
        facts: promoted.facts,
      });
      await heartbeat.renew();
      return await this.publishUpload({
        preparation: input.preparation, actor: input.actor, requestId: input.requestId,
        fileId, facts: promoted.facts,
      });
    } catch (error) {
      if (error instanceof MaterialImportFallbackError) throw error;
      if (error instanceof MaterialImportFileSecurityError || error instanceof MaterialImportMultipartError) {
        return await this.rejectOrReconcile({
          preparation: input.preparation, actor: input.actor, requestId: input.requestId,
          code: error.code, message: error.message, status: error instanceof MaterialImportMultipartError ? error.status : 422,
        });
      }
      const candidate = error instanceof Error ? error.message : "IMPORT_UPLOAD_RESULT_UNKNOWN";
      const deterministic = new Map<string, { message: string; status: number }>([
        ["IMPORT_FILE_TOO_LARGE", { message: "文件超过大小上限", status: 413 }],
        ["IMPORT_FILE_EMPTY", { message: "文件不能为空", status: 422 }],
      ]).get(candidate);
      if (deterministic) {
        return await this.rejectOrReconcile({
          preparation: input.preparation, actor: input.actor, requestId: input.requestId,
          code: candidate, message: deterministic.message, status: deterministic.status,
        });
      }
      await this.markReconciliation(input.preparation, input.actor, input.requestId, safeErrorCode(candidate)).catch(() => undefined);
      throw new MaterialImportFallbackError("RESULT_UNKNOWN", "上传结果尚未确认，请使用原操作标识恢复", 503, {
        operationId: input.preparation.operationId, retryAfterSeconds: 5,
      });
    } finally {
      await heartbeat.stop();
    }
  }

  async failPreparedUpload(input: Readonly<{
    preparation: MaterialImportFallbackPreparedUpload;
    actor: MaterialImportFallbackActor;
    requestId: string;
    code: string;
    message: string;
    status: number;
  }>): Promise<never> {
    let staging: LocalMaterialImportFileFacts | null;
    let final: LocalMaterialImportFileFacts | null;
    try {
      [staging, final] = await Promise.all([
        this.store.inspectOptional(input.preparation.stagingRelativePath, this.maximumBytes),
        this.store.inspectOptional(input.preparation.finalRelativePath, this.maximumBytes),
      ]);
    } catch {
      await this.markReconciliation(
        input.preparation, input.actor, input.requestId, "IMPORT_RECONCILIATION_REQUIRED",
      ).catch(() => undefined);
      throw new MaterialImportFallbackError("RESULT_UNKNOWN", "上传文件状态尚未确认，请使用原操作标识恢复", 503, {
        operationId: input.preparation.operationId, retryAfterSeconds: 5,
      });
    }
    for (const facts of [staging, final]) {
      if (facts && !sameStoredFacts(facts, input.preparation.declaredSha256, input.preparation.declaredSizeBytes)) {
        await this.markReconciliation(
          input.preparation, input.actor, input.requestId, "IMPORT_RECOVERY_FILE_FACTS_MISMATCH",
        ).catch(() => undefined);
        throw new MaterialImportFallbackError("IMPORT_RECONCILIATION_REQUIRED", "上传文件事实需要人工协调", 409, {
          operationId: input.preparation.operationId,
        });
      }
    }
    const retained = final ?? staging;
    if (retained) {
      let detected: "CSV" | "XLS" | "XLSX" | null = null;
      try {
        const basic = detectMaterialImportFileType(retained.prefix);
        detected = input.preparation.filenameExtension === ".xls" ? "XLS" : basic;
      } catch { /* A terminal multipart failure still records exact storage facts before cleanup. */ }
      await this.recordStaged(
        input.preparation,
        input.actor,
        retained,
        detected,
        final ? "FINAL" : "STAGING",
      );
    }
    return this.rejectOrReconcile({ ...input, failureStage: "UPLOAD" });
  }

  async queueParse(input: Readonly<{
    actor: MaterialImportFallbackActor;
    requestId: string;
    idempotencyKey: string;
    batchId: number;
    expectedVersion: number;
    parserVersion: string;
  }>): Promise<MaterialImportFallbackResult> {
    requirePermission(input.actor, "material.import.parse");
    const batchId = positive(input.batchId, "batch_id");
    const expectedVersion = positive(input.expectedVersion, "expected_version");
    if (!UUID.test(input.requestId)) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求编号无效", 400);
    if (input.parserVersion !== "material-import-parser-v1") throw new MaterialImportFallbackError("IMPORT_PARSER_VERSION_UNSUPPORTED", "解析器版本不受支持", 400);
    const route = `/api/material-master/import-batches/${batchId}/parse`;
    const key = keyDigest(input.idempotencyKey);
    const requestDigest = materialImportFallbackDigest({ expected_version: expectedVersion, parser_version: input.parserVersion });
    await this.consumeWriteRate(input.actor.username, route, key);
    return this.repository.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [input.actor.username, `${route}:${key}`]);
      const existing = await client.query(`
        select * from material_import_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3 for update
      `, [input.actor.username, route, key]);
      if (existing.rows[0]) {
        const row = asIdempotency(existing.rows[0]);
        if (row.request_digest !== requestDigest) throw new MaterialImportFallbackError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
        const visible = await client.query(`
          select 1 from material_import_batches where id=$1 and source_kind in ('CSV','XLSX')
            and (created_by=$2 or $3::boolean)
        `, [batchId, input.actor.username, hasPermission(input.actor, "material.import.read_any")]);
        if (!visible.rows[0] || Number(row.batch_id) !== batchId) {
          throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
        }
        const completed = completedResponse(row);
        if (completed.ok === false) return replayAuthoritative(row, {}, 202);
        const outbox = await client.query(`
          select id from material_import_job_outbox
          where job_type='material.import.parse' and aggregate_type='material_import_batch'
            and aggregate_id=$1 and idempotency_key=$2
        `, [String(batchId), materialImportFallbackDigest({ kind: "material-import-parse", operation_id: row.operation_id })]);
        const stored = completed.data;
        const currentVersion = Number(stored?.current_version);
        if (!outbox.rows[0] || !stored || Number(stored.batch_id) !== batchId
          || stored.job_id !== outbox.rows[0].id || stored.status !== "QUEUED"
          || !Number.isSafeInteger(currentVersion) || currentVersion <= 0) {
          throw new MaterialImportFallbackError("IDEMPOTENCY_RESPONSE_INVALID", "历史操作响应无效，需要人工协调", 500, {
            operationId: row.operation_id,
          });
        }
        return replayAuthoritative(row, {
          job_id: String(outbox.rows[0].id), batch_id: batchId, status: "QUEUED", current_version: currentVersion,
        }, 202);
      }
      const found = await client.query(`
        select b.*,f.id file_id,f.storage_name,f.relative_path,f.filename_extension,f.detected_file_type,
               f.declared_sha256,f.declared_size_bytes,f.actual_sha256,f.actual_size_bytes,
               f.storage_status,f.security_check_status,f.promoted_at
        from material_import_batches b join material_import_files f on f.batch_id=b.id
        where b.id=$1 and (b.created_by=$2 or $3::boolean)
          and b.source_kind in ('CSV','XLSX') for update of b,f
      `, [batchId, input.actor.username, hasPermission(input.actor, "material.import.read_any")]);
      const batch = found.rows[0];
      if (!batch) throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
      if (Number(batch.current_version) !== expectedVersion) throw new MaterialImportFallbackError("IMPORT_VERSION_CONFLICT", "导入批次版本冲突", 409, { currentVersion: Number(batch.current_version) });
      const actualSizeBytes = Number(batch.actual_size_bytes);
      const extensionMatches = (batch.filename_extension === ".csv" && batch.detected_file_type === "CSV")
        || (batch.filename_extension === ".xls" && batch.detected_file_type === "XLS")
        || (batch.filename_extension === ".xlsx" && batch.detected_file_type === "XLSX");
      if (batch.status !== "FILE_READY" || batch.storage_status !== "STORED" || batch.security_check_status !== "BASIC_CHECK_PASSED"
        || Number(batch.file_count) !== 1 || batch.promoted_at == null || !extensionMatches
        || !UUID.test(String(batch.storage_name))
        || batch.relative_path !== `material-import/${batchId}/${String(batch.storage_name).toLowerCase()}${String(batch.filename_extension)}`
        || !SHA256.test(String(batch.actual_sha256)) || batch.actual_sha256 !== batch.declared_sha256
        || !Number.isSafeInteger(actualSizeBytes) || actualSizeBytes <= 0 || actualSizeBytes > this.maximumBytes
        || actualSizeBytes !== Number(batch.declared_size_bytes)) {
        throw new MaterialImportFallbackError("IMPORT_FILE_NOT_READY", "导入文件尚未通过服务端检查", 409);
      }
      const operationId = randomUUID();
      const leaseToken = randomUUID();
      await client.query(`
        insert into material_import_idempotency(
          username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,file_id,
          lease_token,lease_expires_at,expires_at,recovery_until
        ) values($1,'POST',$2,$3,$4,$5,'PENDING',$6,$7,$8,now()+make_interval(secs=>$9),
          now()+make_interval(secs=>$10),now()+make_interval(secs=>$11))
      `, [input.actor.username, route, key, requestDigest, operationId, batchId, batch.file_id, leaseToken,
        this.leaseSeconds, IDEMPOTENCY_SECONDS, RECOVERY_SECONDS]);
      const jobId = await this.queue.enqueue(client, {
        type: "material.import.parse",
        payload: {
          batch_id: batchId,
          relative_path: batch.relative_path,
          actual_sha256: batch.actual_sha256,
          actual_size_bytes: actualSizeBytes,
        },
        idempotencyKey: materialImportFallbackDigest({ kind: "material-import-parse", operation_id: operationId }),
        aggregateType: "material_import_batch",
        aggregateId: String(batchId),
      });
      const updated = await client.query(`
        update material_import_batches set status='QUEUED_FOR_PARSING',current_version=current_version+1,updated_at=now()
        where id=$1 and created_by=$3 and status='FILE_READY' and current_version=$2 returning *
      `, [batchId, expectedVersion, String(batch.created_by)]);
      if (updated.rowCount !== 1) throw new MaterialImportFallbackError("IMPORT_VERSION_CONFLICT", "导入批次已变化", 409);
      const data = { job_id: jobId, batch_id: batchId, status: "QUEUED", current_version: Number(updated.rows[0].current_version) };
      const response = storedSuccess(data);
      const completed = await client.query(`
        update material_import_idempotency set state='COMPLETED',response=$2,status_code=202,
          lease_token=null,lease_expires_at=null,updated_at=now() where operation_id=$1 and state='PENDING'
      `, [operationId, response]);
      if (completed.rowCount !== 1) throw new Error("IMPORT_PARSE_IDEMPOTENCY_STATE_INVALID");
      await this.repository.event(client, {
        batchId, eventType: "IMPORT_PARSE_QUEUED", actorType: "USER", actorIdentifier: input.actor.username,
        previousStatus: "FILE_READY", newStatus: "QUEUED_FOR_PARSING", requestId: input.requestId,
        safeDetails: { job_id: jobId, operation_id: operationId },
      });
      await this.repository.audit(client, {
        actor: input.actor.username, action: "IMPORT_PARSE_QUEUED", requestId: input.requestId,
        routeCode: "IMPORT_PARSE_CREATE", details: { batch_id: batchId, job_id: jobId, operation_id: operationId },
      });
      return { data, statusCode: 202, operationId, replayed: false };
    });
  }

  async job(jobId: string, actor: MaterialImportFallbackActor): Promise<Record<string, unknown>> {
    requirePermission(actor, "material.import.read");
    if (!UUID.test(jobId)) throw new MaterialImportFallbackError("JOB_NOT_FOUND", "后台任务不存在", 404);
    const result = await this.repository.query(`
      select o.id,o.aggregate_type,o.job_type,o.status outbox_status,o.created_at outbox_created_at,
             j.status,j.attempt_count,j.max_attempts,j.last_error_code,j.created_at,j.started_at,j.completed_at,
             case
               when o.aggregate_type='material_import_batch' then direct_batch.created_by
               when o.aggregate_type='material_import_normalization' then normalization_batch.created_by
               when o.aggregate_type='material_import_review_session' then review_batch.created_by
               else null
             end owner
      from material_import_job_outbox o
      left join background_jobs j on j.id=o.id
      left join material_import_batches direct_batch
        on o.aggregate_type='material_import_batch' and direct_batch.id::text=o.aggregate_id
      left join material_import_normalization_runs normalization
        on o.aggregate_type='material_import_normalization' and normalization.id::text=o.aggregate_id
      left join material_import_batches normalization_batch on normalization_batch.id=normalization.batch_id
      left join material_import_review_sessions review_session
        on o.aggregate_type='material_import_review_session' and review_session.id::text=o.aggregate_id
      left join material_import_batches review_batch on review_batch.id=review_session.batch_id
      where o.id=$1
        and case
          when o.aggregate_type='material_import_batch' then direct_batch.source_kind in ('CSV','XLSX')
          when o.aggregate_type='material_import_normalization' then normalization_batch.source_kind in ('CSV','XLSX')
          when o.aggregate_type='material_import_review_session' then review_batch.source_kind in ('CSV','XLSX')
          else false
        end
    `, [jobId]);
    const row = result.rows[0];
    const visible = row && typeof row.owner === "string"
      && (row.owner === actor.username || hasPermission(actor, "material.import.read_any"));
    if (!visible) throw new MaterialImportFallbackError("JOB_NOT_FOUND", "后台任务不存在", 404);
    const knownStatuses = new Set(["QUEUED", "RUNNING", "SUCCEEDED", "CANCELLED", "FAILED", "DEAD"]);
    const outboxOnlyStatus = ["PENDING", "PUBLISHED"].includes(String(row.outbox_status))
      ? "QUEUED"
      : row.outbox_status === "CANCELLED" ? "CANCELLED" : "FAILED";
    const status = typeof row.status === "string" && knownStatuses.has(row.status)
      ? row.status
      : outboxOnlyStatus;
    const lastErrorCode = typeof row.last_error_code === "string"
      ? safeErrorCode(row.last_error_code)
      : row.outbox_status === "FAILED" ? "JOB_DISPATCH_FAILED" : null;
    return {
      id: row.id,
      type: row.job_type,
      status,
      attempt_count: Number(row.attempt_count ?? 0),
      max_attempts: row.max_attempts == null ? null : Number(row.max_attempts),
      last_error_code: lastErrorCode,
      created_at: iso(row.created_at ?? row.outbox_created_at),
      started_at: row.started_at == null ? null : iso(row.started_at),
      completed_at: row.completed_at == null ? null : iso(row.completed_at),
    };
  }

  failureAudit(input: Parameters<PostgresMaterialImportFallbackRepository["failureAudit"]>[0]): Promise<void> {
    return this.repository.failureAudit(input);
  }
}
