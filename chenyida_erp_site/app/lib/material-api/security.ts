import type {
  MaterialApiTransactionCompanion,
  MaterialMasterD1Database,
} from "../material-master/index.ts";

export const MATERIAL_CSRF_COOKIE = "CYD_ERP_CSRF";
export const MATERIAL_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
export const MATERIAL_AUDIT_RETENTION_SECONDS = 1095 * 24 * 60 * 60;
export const DEFAULT_MATERIAL_RATE_LIMITS = Object.freeze({ attemptsPerMinute: 60, newKeysPerMinute: 20 });
export const MATERIAL_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  admin: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.cancel", "material.import.read_any", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit"],
  manager: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.cancel", "material.import.read_any", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit"],
  purchase: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map"],
  engineering: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map"],
  production: ["material.read"],
  warehouse: ["material.read"],
  quality: ["material.read"],
  sales: ["material.read"],
  finance: ["material.read"],
  operations: ["material.read"],
});

export type MaterialApiUser = Readonly<{
  username: string;
  role: string;
  must_change_password: boolean;
}>;

export type MaterialApiRouteCode =
  | "MATERIAL_CATEGORY_LIST"
  | "MATERIAL_CATEGORY_SCHEMA"
  | "MATERIAL_LIST"
  | "MATERIAL_DETAIL"
  | "MATERIAL_VERSIONS"
  | "MATERIAL_CHANGE_LOGS"
  | "MATERIAL_DRAFT_CREATE"
  | "MATERIAL_DRAFT_LIST"
  | "MATERIAL_DRAFT_DETAIL"
  | "MATERIAL_DRAFT_EDIT"
  | "MATERIAL_DRAFT_SUBMIT"
  | "MATERIAL_REVIEW_QUEUE"
  | "MATERIAL_DRAFT_APPROVE"
  | "MATERIAL_DRAFT_REJECT";

export class MaterialApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: readonly unknown[];
  readonly materialId: number | null;

  constructor(
    code: string,
    message: string,
    status: number,
    details: readonly unknown[] = [],
    materialId: number | null = null,
  ) {
    super(message);
    this.name = "MaterialApiFailure";
    this.code = code;
    this.status = status;
    this.details = details;
    this.materialId = materialId;
  }
}

type IdempotencyRow = {
  id: number;
  username: string;
  request_digest: string;
  operation_id: string;
  state: "PENDING" | "COMPLETED";
  lease_token_digest: string;
  lease_expires_at: number | null;
  status_code: number | null;
  response_json: string | null;
  material_id: number | null;
  old_version: number | null;
  new_version: number | null;
};

export type IdempotencyExecution = Readonly<{
  kind: "execute";
  companion: MaterialApiTransactionCompanion;
}>;

export type IdempotencyReplay = Readonly<{
  kind: "replay";
  statusCode: number;
  responseJson: string;
  operationId: string;
}>;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const chunk of (header ?? "").split(";")) {
    const separator = chunk.indexOf("=");
    if (separator < 0) continue;
    result[chunk.slice(0, separator).trim()] = chunk.slice(separator + 1).trim();
  }
  return result;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function assertMaterialCsrf(request: Request): void {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin || origin !== url.origin) {
    throw new MaterialApiFailure("CSRF_INVALID", "请求来源校验失败", 403);
  }
  const header = request.headers.get("X-CSRF-Token") ?? "";
  const cookie = parseCookies(request.headers.get("Cookie"))[MATERIAL_CSRF_COOKIE] ?? "";
  if (!header || !cookie || !constantTimeEqual(header, cookie)) {
    throw new MaterialApiFailure("CSRF_INVALID", "CSRF Token 无效", 403);
  }
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "JSON 数值无效", 400);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "请求正文包含不支持的值", 400);
}

export async function readBoundedJson(request: Request): Promise<{ body: Record<string, unknown>; canonicalJson: string }> {
  const mediaType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new MaterialApiFailure("UNSUPPORTED_MEDIA_TYPE", "写请求必须使用 application/json", 415);
  }
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(length) && length > 65_536) {
    throw new MaterialApiFailure("PAYLOAD_TOO_LARGE", "请求正文超过 64 KiB", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 65_536) {
    throw new MaterialApiFailure("PAYLOAD_TOO_LARGE", "请求正文超过 64 KiB", 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "请求正文必须是 JSON 对象", 400);
  }
  return { body: parsed as Record<string, unknown>, canonicalJson: canonicalValue(parsed) };
}

export function materialJsonResponse(payload: unknown, status: number, requestId: string, replayed = false): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Pragma": "no-cache",
    "X-Request-Id": requestId,
  });
  if (replayed) headers.set("Idempotency-Replayed", "true");
  return new Response(JSON.stringify(payload), { status, headers });
}

export function materialReferenceResponse(
  payload: unknown,
  requestId: string,
  etag: string,
  notModified: boolean,
): Response {
  const headers = new Headers({
    "Cache-Control": "private, max-age=300, must-revalidate",
    "ETag": etag,
    "Vary": "Cookie, Accept-Encoding",
    "X-Request-Id": requestId,
  });
  if (notModified) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export function materialErrorResponse(
  failure: MaterialApiFailure,
  requestId: string,
  operationId?: string,
  replayed = false,
): Response {
  return materialJsonResponse({
    error: {
      code: failure.code,
      message: failure.message,
      request_id: requestId,
      details: [...failure.details],
      ...(operationId ? { operation_id: operationId } : {}),
    },
  }, failure.status, requestId, replayed);
}

export function renderStoredResponse(row: IdempotencyReplay, requestId: string): Response {
  let template: Record<string, unknown>;
  try {
    template = JSON.parse(row.responseJson) as Record<string, unknown>;
  } catch {
    return materialErrorResponse(new MaterialApiFailure("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500), requestId);
  }
  if (template.error && typeof template.error === "object") {
    template = {
      ...template,
      error: { ...(template.error as Record<string, unknown>), request_id: requestId },
    };
  } else {
    template = { ...template, request_id: requestId };
  }
  return materialJsonResponse(template, row.statusCode, requestId, true);
}

export async function readCompletedIdempotency(
  database: MaterialMasterD1Database,
  recordId: number,
): Promise<IdempotencyReplay | null> {
  const row = await database.prepare(`
    SELECT status_code, response_json, operation_id
    FROM material_api_idempotency
    WHERE id = ? AND state = 'COMPLETED' AND status_code IS NOT NULL AND response_json IS NOT NULL
    LIMIT 1
  `).bind(recordId).first<{ status_code: number; response_json: string; operation_id: string }>();
  return row ? {
    kind: "replay",
    statusCode: row.status_code,
    responseJson: row.response_json,
    operationId: row.operation_id,
  } : null;
}

function nowText(nowSeconds: number): string {
  return new Date(nowSeconds * 1000).toISOString();
}

export async function writeMaterialAudit(
  database: MaterialMasterD1Database,
  input: Readonly<{
    username: string;
    routeCode: MaterialApiRouteCode;
    requestId: string;
    result: string;
    errorCode?: string;
    materialId?: number | null;
    operationId?: string;
    keyDigest?: string;
    oldVersion?: number | null;
    newVersion?: number | null;
    detail?: Record<string, unknown>;
    nowSeconds: number;
  }>,
): Promise<void> {
  await database.prepare(`
    INSERT INTO audit_log(
      username, action, detail, request_id, result, route_code, material_id,
      operation_id, idempotency_key_digest, old_version, new_version,
      error_code, retention_until, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.username,
    input.routeCode,
    JSON.stringify(input.detail ?? {}),
    input.requestId,
    input.result,
    input.routeCode,
    input.materialId ?? null,
    input.operationId ?? "",
    input.keyDigest ?? "",
    input.oldVersion ?? null,
    input.newVersion ?? null,
    input.errorCode ?? "",
    input.nowSeconds + MATERIAL_AUDIT_RETENTION_SECONDS,
    nowText(input.nowSeconds),
  ).run();
}

async function rejectRateLimit(
  database: MaterialMasterD1Database,
  username: string,
  bucketStart: number,
  routeCode: MaterialApiRouteCode,
  requestId: string,
  nowSeconds: number,
): Promise<never> {
  const timestamp = nowText(nowSeconds);
  await database.prepare(`
    UPDATE material_api_rate_limit_buckets
    SET rejected_count = CASE WHEN rejected_count < 2147483647 THEN rejected_count + 1 ELSE rejected_count END,
        first_rejected_at = COALESCE(first_rejected_at, ?), last_rejected_at = ?, updated_at = ?
    WHERE username = ? AND bucket_start = ?
  `).bind(timestamp, timestamp, timestamp, username, bucketStart).run();
  const bucket = await database.prepare("SELECT rejected_count FROM material_api_rate_limit_buckets WHERE username = ? AND bucket_start = ?")
    .bind(username, bucketStart).first<{ rejected_count: number }>();
  if (bucket?.rejected_count === 1) {
    await writeMaterialAudit(database, {
      username, routeCode, requestId, result: "rate_limited", errorCode: "RATE_LIMITED",
      detail: { bucket_start: bucketStart }, nowSeconds,
    });
  }
  throw new MaterialApiFailure("RATE_LIMITED", "写请求过于频繁，请稍后重试", 429);
}

function routeCodeFromScope(scope: string, method: string): MaterialApiTransactionCompanion["routeCode"] {
  if (scope.endsWith("/approve")) return "MATERIAL_DRAFT_APPROVE";
  if (scope.endsWith("/reject")) return "MATERIAL_DRAFT_REJECT";
  if (scope.endsWith("/submit")) return "MATERIAL_DRAFT_SUBMIT";
  if (method === "PATCH") return "MATERIAL_DRAFT_EDIT";
  return "MATERIAL_DRAFT_CREATE";
}

async function terminateAbandonedIdempotency(
  database: MaterialMasterD1Database,
  physicalRequestId: string,
  nowSeconds: number,
): Promise<void> {
  const staleBefore = new Date((nowSeconds - MATERIAL_IDEMPOTENCY_TTL_SECONDS) * 1000).toISOString();
  const result = await database.prepare(`
    SELECT id, username, method, route_scope, key_digest, request_digest, operation_id,
           lease_token_digest
    FROM material_api_idempotency
    WHERE state = 'PENDING' AND lease_expires_at <= ? AND updated_at <= ?
    ORDER BY id LIMIT 20
  `).bind(nowSeconds, staleBefore).all<{
    id: number;
    username: string;
    method: string;
    route_scope: string;
    key_digest: string;
    request_digest: string;
    operation_id: string;
    lease_token_digest: string;
  }>();
  for (const row of result.results ?? []) {
    const leaseTokenDigest = await sha256(randomToken());
    const takeover = await database.prepare(`
      UPDATE material_api_idempotency
      SET lease_token_digest = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND state = 'PENDING' AND lease_token_digest = ?
        AND lease_expires_at <= ? AND updated_at <= ?
    `).bind(
      leaseTokenDigest,
      nowSeconds + 120,
      new Date(nowSeconds * 1000).toISOString(),
      row.id,
      row.lease_token_digest,
      nowSeconds,
      staleBefore,
    ).run();
    if (takeover.meta?.changes !== 1) continue;
    await completeIdempotentFailure(database, {
      idempotencyRecordId: row.id,
      username: row.username,
      routeCode: routeCodeFromScope(row.route_scope, row.method),
      physicalRequestId,
      operationId: row.operation_id,
      keyDigest: row.key_digest,
      requestDigest: row.request_digest,
      leaseTokenDigest,
      statusCode: row.route_scope === "/api/material-master/drafts" ? 201 : 200,
      expiresAt: nowSeconds + MATERIAL_IDEMPOTENCY_TTL_SECONDS,
      retentionUntil: nowSeconds + MATERIAL_AUDIT_RETENTION_SECONDS,
    }, new MaterialApiFailure("INTERNAL_ERROR", "先前请求未能完成，请使用新的 Idempotency-Key 重试", 500), nowSeconds, "MATERIAL_IDEMPOTENCY_ABANDONED");
  }
}

export async function reserveIdempotency(
  database: MaterialMasterD1Database,
  input: Readonly<{
    username: string;
    routeCode: MaterialApiTransactionCompanion["routeCode"];
    method: "POST" | "PATCH";
    routeScope: string;
    rawKey: string;
    canonicalJson: string;
    physicalRequestId: string;
    nowSeconds: number;
    attemptsPerMinute: number;
    newKeysPerMinute: number;
  }>,
): Promise<IdempotencyExecution | IdempotencyReplay> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.rawKey)) {
    throw new MaterialApiFailure("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 缺失或格式无效", 400);
  }
  const keyDigest = await sha256(input.rawKey);
  const requestDigest = await sha256(`${input.method}\n${input.routeScope}\n${input.canonicalJson}`);
  const bucketStart = Math.floor(input.nowSeconds / 60) * 60;
  const timestamp = nowText(input.nowSeconds);
  const attemptTokenDigest = await sha256(randomToken());
  const attemptResult = await database.prepare(`
    INSERT INTO material_api_rate_limit_buckets(
      username, bucket_start, attempt_count, new_key_count, rejected_count,
      last_attempt_token_digest, last_new_key_token_digest, created_at, updated_at
    ) VALUES (?, ?, 1, 0, 0, ?, '', ?, ?)
    ON CONFLICT(username, bucket_start) DO UPDATE SET
      attempt_count = attempt_count + 1,
      last_attempt_token_digest = excluded.last_attempt_token_digest,
      updated_at = excluded.updated_at
    WHERE attempt_count < ?
  `).bind(input.username, bucketStart, attemptTokenDigest, timestamp, timestamp, input.attemptsPerMinute).run();
  if (attemptResult.meta?.changes !== 1) {
    await rejectRateLimit(database, input.username, bucketStart, input.routeCode, input.physicalRequestId, input.nowSeconds);
  }

  await database.batch([
    database.prepare(`DELETE FROM material_api_idempotency WHERE id IN (
      SELECT id FROM material_api_idempotency
      WHERE state = 'COMPLETED' AND expires_at <= ? ORDER BY id LIMIT 100
    )`).bind(input.nowSeconds),
    database.prepare(`DELETE FROM material_api_rate_limit_buckets WHERE id IN (
      SELECT id FROM material_api_rate_limit_buckets
      WHERE bucket_start < ? ORDER BY id LIMIT 100
    )`).bind(bucketStart - 24 * 60 * 60),
  ]);
  await terminateAbandonedIdempotency(database, input.physicalRequestId, input.nowSeconds);

  const existing = await database.prepare(`
    SELECT id, username, request_digest, operation_id, state, lease_token_digest,
           lease_expires_at, status_code, response_json, material_id, old_version, new_version
    FROM material_api_idempotency
    WHERE username = ? AND method = ? AND route_scope = ? AND key_digest = ? LIMIT 1
  `).bind(input.username, input.method, input.routeScope, keyDigest).first<IdempotencyRow>();
  if (existing) {
    if (existing.request_digest !== requestDigest) {
      await writeMaterialAudit(database, {
        username: input.username, routeCode: input.routeCode, requestId: input.physicalRequestId,
        result: "conflict", errorCode: "IDEMPOTENCY_CONFLICT", operationId: existing.operation_id,
        keyDigest, materialId: existing.material_id, nowSeconds: input.nowSeconds,
      });
      throw new MaterialApiFailure("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
    }
    if (existing.state === "COMPLETED" && existing.status_code && existing.response_json) {
      await writeMaterialAudit(database, {
        username: input.username, routeCode: input.routeCode, requestId: input.physicalRequestId,
        result: "replayed", operationId: existing.operation_id, keyDigest,
        materialId: existing.material_id, oldVersion: existing.old_version,
        newVersion: existing.new_version, detail: { replayed: true }, nowSeconds: input.nowSeconds,
      });
      return { kind: "replay", statusCode: existing.status_code, responseJson: existing.response_json, operationId: existing.operation_id };
    }
    if ((existing.lease_expires_at ?? 0) > input.nowSeconds) {
      await writeMaterialAudit(database, {
        username: input.username, routeCode: input.routeCode, requestId: input.physicalRequestId,
        result: "in_progress", errorCode: "IDEMPOTENCY_IN_PROGRESS",
        operationId: existing.operation_id, keyDigest, materialId: existing.material_id,
        nowSeconds: input.nowSeconds,
      });
      throw new MaterialApiFailure("IDEMPOTENCY_IN_PROGRESS", "相同请求正在处理中，请稍后重试", 409);
    }
    const leaseTokenDigest = await sha256(randomToken());
    const takeover = await database.prepare(`
      UPDATE material_api_idempotency
      SET lease_token_digest = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND state = 'PENDING' AND request_digest = ?
        AND lease_token_digest = ? AND lease_expires_at <= ?
    `).bind(leaseTokenDigest, input.nowSeconds + 120, timestamp, existing.id, requestDigest, existing.lease_token_digest, input.nowSeconds).run();
    if (takeover.meta?.changes !== 1) {
      await writeMaterialAudit(database, {
        username: input.username, routeCode: input.routeCode, requestId: input.physicalRequestId,
        result: "in_progress", errorCode: "IDEMPOTENCY_IN_PROGRESS",
        operationId: existing.operation_id, keyDigest, materialId: existing.material_id,
        nowSeconds: input.nowSeconds,
      });
      throw new MaterialApiFailure("IDEMPOTENCY_IN_PROGRESS", "相同请求正在处理中，请稍后重试", 409);
    }
    return {
      kind: "execute",
      companion: {
        idempotencyRecordId: existing.id, username: input.username, routeCode: input.routeCode,
        physicalRequestId: input.physicalRequestId, operationId: existing.operation_id,
        keyDigest, requestDigest, leaseTokenDigest, statusCode: input.routeCode === "MATERIAL_DRAFT_CREATE" ? 201 : 200,
        expiresAt: input.nowSeconds + MATERIAL_IDEMPOTENCY_TTL_SECONDS,
        retentionUntil: input.nowSeconds + MATERIAL_AUDIT_RETENTION_SECONDS,
      },
    };
  }

  const operationId = crypto.randomUUID();
  const leaseTokenDigest = await sha256(randomToken());
  const newKeyTokenDigest = await sha256(randomToken());
  try {
    await database.batch([
      database.prepare(`
        UPDATE material_api_rate_limit_buckets
        SET new_key_count = new_key_count + 1, last_new_key_token_digest = ?, updated_at = ?
        WHERE username = ? AND bucket_start = ? AND new_key_count < ?
      `).bind(newKeyTokenDigest, timestamp, input.username, bucketStart, input.newKeysPerMinute),
      database.prepare(`
        INSERT INTO material_api_idempotency(
          username, method, route_scope, key_digest, request_digest, operation_id,
          state, lease_token_digest, lease_expires_at, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM material_api_rate_limit_buckets
          WHERE username = ? AND bucket_start = ? AND last_new_key_token_digest = ?
        )
      `).bind(
        input.username, input.method, input.routeScope, keyDigest, requestDigest, operationId,
        leaseTokenDigest, input.nowSeconds + 120, timestamp, timestamp,
        input.username, bucketStart, newKeyTokenDigest,
      ),
    ]);
  } catch {
    const raced = await database.prepare(`
      SELECT id, username, request_digest, operation_id, state, lease_token_digest,
             lease_expires_at, status_code, response_json, material_id, old_version, new_version
      FROM material_api_idempotency
      WHERE username = ? AND method = ? AND route_scope = ? AND key_digest = ? LIMIT 1
    `).bind(input.username, input.method, input.routeScope, keyDigest).first<IdempotencyRow>();
    if (raced?.request_digest === requestDigest && raced.state === "COMPLETED" && raced.status_code && raced.response_json) {
      return { kind: "replay", statusCode: raced.status_code, responseJson: raced.response_json, operationId: raced.operation_id };
    }
    if (raced?.request_digest !== requestDigest) {
      throw new MaterialApiFailure("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
    }
    throw new MaterialApiFailure("IDEMPOTENCY_IN_PROGRESS", "相同请求正在处理中，请稍后重试", 409);
  }
  const inserted = await database.prepare("SELECT id FROM material_api_idempotency WHERE operation_id = ?")
    .bind(operationId).first<{ id: number }>();
  if (!inserted) {
    await rejectRateLimit(database, input.username, bucketStart, input.routeCode, input.physicalRequestId, input.nowSeconds);
    throw new MaterialApiFailure("RATE_LIMITED", "写请求过于频繁，请稍后重试", 429);
  }
  return {
    kind: "execute",
    companion: {
      idempotencyRecordId: inserted.id, username: input.username, routeCode: input.routeCode,
      physicalRequestId: input.physicalRequestId, operationId, keyDigest, requestDigest,
      leaseTokenDigest, statusCode: input.routeCode === "MATERIAL_DRAFT_CREATE" ? 201 : 200,
      expiresAt: input.nowSeconds + MATERIAL_IDEMPOTENCY_TTL_SECONDS,
      retentionUntil: input.nowSeconds + MATERIAL_AUDIT_RETENTION_SECONDS,
    },
  };
}

export async function completeIdempotentFailure(
  database: MaterialMasterD1Database,
  companion: MaterialApiTransactionCompanion,
  failure: MaterialApiFailure,
  nowSeconds: number,
  auditAction: string = companion.routeCode,
): Promise<void> {
  const responseJson = JSON.stringify({
    error: {
      code: failure.code,
      message: failure.message,
      details: [...failure.details],
      operation_id: companion.operationId,
    },
  });
  const timestamp = nowText(nowSeconds);
  await database.batch([
    database.prepare(`
      UPDATE material_api_idempotency
      SET state = 'COMPLETED', lease_expires_at = NULL, status_code = ?, response_json = ?,
          material_id = ?, updated_at = ?, expires_at = ?
      WHERE id = ? AND username = ? AND state = 'PENDING' AND operation_id = ?
        AND request_digest = ? AND lease_token_digest = ?
    `).bind(
      failure.status, responseJson, failure.materialId, timestamp,
      nowSeconds + MATERIAL_IDEMPOTENCY_TTL_SECONDS, companion.idempotencyRecordId,
      companion.username, companion.operationId, companion.requestDigest, companion.leaseTokenDigest,
    ),
    database.prepare(`
      INSERT INTO audit_log(
        username, action, detail, request_id, result, route_code, material_id,
        operation_id, idempotency_key_digest, old_version, new_version,
        error_code, retention_until, created_at
      ) VALUES (
        (SELECT username FROM material_api_idempotency WHERE id = ? AND state = 'COMPLETED'
          AND operation_id = ? AND response_json = ? AND lease_token_digest = ?),
        ?, '{}', ?, 'failed', ?, ?, ?, ?, NULL, NULL, ?, ?, ?
      )
    `).bind(
      companion.idempotencyRecordId, companion.operationId, responseJson, companion.leaseTokenDigest,
      auditAction, companion.physicalRequestId, companion.routeCode, failure.materialId,
      companion.operationId, companion.keyDigest, failure.code, companion.retentionUntil, timestamp,
    ),
  ]);
}
