import type { Pool } from "pg";

import type { BackgroundJobQueue } from "../infrastructure/background-jobs.ts";
import { readSingleFilePart, validateSingleFileMultipartHeaders, MaterialImportMultipartError } from "../material-import/multipart.ts";
import { LocalMaterialImportFileStore } from "./local-file-store.ts";
import { MaterialImportTransactionOutcomeUnknownError, PostgresMaterialImportFallbackRepository } from "./repository.ts";
import {
  MaterialImportFallbackService,
  UploadLeaseHeartbeat,
  materialImportFallbackDigest,
  normalizeMaterialImportUploadHeaders,
} from "./service.ts";
import type {
  MaterialImportFallbackActor,
  MaterialImportFallbackPreparedUpload,
  MaterialImportFallbackResult,
} from "./types.ts";
import { MaterialImportFallbackError } from "./types.ts";

const JSON_BODY_BYTES = 16 * 1024;
const IMPORT_STATUSES = new Set([
  "CREATED", "UPLOAD_PENDING", "FILE_READY", "QUEUED_FOR_PARSING", "PARSING", "PARSED",
  "AWAITING_MAPPING", "MAPPING_CONFIRMED", "QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED",
  "RECONCILIATION_REQUIRED", "FAILED", "CANCELLED",
]);

type MaterialImportFallbackServicePort = Pick<MaterialImportFallbackService,
  | "createBatch"
  | "listBatches"
  | "batchDetail"
  | "cancelBatch"
  | "prepareUpload"
  | "heartbeatUpload"
  | "executeUpload"
  | "failPreparedUpload"
  | "queueParse"
  | "job"
  | "failureAudit"
>;

export type MaterialImportFallbackApiDependencies = Readonly<{
  pool: Pool;
  queue: BackgroundJobQueue;
  actor: MaterialImportFallbackActor;
  requestId: string;
  requireCsrf: () => void;
  uploadRoot: string;
  maximumBytes: number;
  leaseSeconds: number;
  service?: MaterialImportFallbackServicePort;
  readFilePart?: typeof readSingleFilePart;
}>;

type Route = Readonly<{
  code: string;
  action: "list" | "create" | "detail" | "upload" | "parse" | "cancel" | "job";
  methods: readonly string[];
  batchId?: number;
  jobId?: string;
}>;

function routeFor(path: string): Route | null {
  if (path === "/api/material-master/import-batches") {
    return { code: "IMPORT_BATCH_COLLECTION", action: "list", methods: ["GET", "POST"] };
  }
  const batch = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]{0,14})(?:\/(file|parse|cancel))?$/);
  if (batch) {
    const batchId = Number(batch[1]);
    if (!Number.isSafeInteger(batchId)) return null;
    if (batch[2] === "file") return { code: "IMPORT_FILE_UPLOAD", action: "upload", methods: ["POST"], batchId };
    if (batch[2] === "parse") return { code: "IMPORT_PARSE_CREATE", action: "parse", methods: ["POST"], batchId };
    if (batch[2] === "cancel") return { code: "IMPORT_BATCH_CANCEL", action: "cancel", methods: ["POST"], batchId };
    return { code: "IMPORT_BATCH_DETAIL", action: "detail", methods: ["GET"], batchId };
  }
  const job = path.match(/^\/api\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (job) return { code: "IMPORT_JOB_DETAIL", action: "job", methods: ["GET"], jobId: job[1].toLowerCase() };
  return null;
}

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const values = new Headers(headers);
  values.set("Cache-Control", "private, no-store");
  values.set("Pragma", "no-cache");
  values.set("X-Content-Type-Options", "nosniff");
  values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function requirePermission(actor: MaterialImportFallbackActor, permission: string): void {
  if (!actor.permissions.includes("*") && !actor.permissions.includes(permission)) {
    throw new MaterialImportFallbackError("PERMISSION_DENIED", "没有权限执行此操作", 403);
  }
  if (actor.must_change_password) {
    throw new MaterialImportFallbackError("PASSWORD_CHANGE_REQUIRED", "请先修改密码", 403);
  }
}

function enforceCsrf(check: () => void): void {
  try {
    check();
  } catch {
    throw new MaterialImportFallbackError("CSRF_INVALID", "CSRF Token 无效", 403);
  }
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("Idempotency-Key") ?? "";
  if (!value) throw new MaterialImportFallbackError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
  if (!/^[\x21-\x7e]{8,200}$/.test(value)) {
    throw new MaterialImportFallbackError("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 必须为 8 到 200 个安全字符", 400);
  }
  return value;
}

function assertQuery(url: URL, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  const unknown = [...url.searchParams.keys()].find((key) => !keys.has(key));
  if (unknown) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > JSON_BODY_BYTES)) {
    throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求正文超过 16 KiB", 400);
  }
  if (!request.body) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求正文为空", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > JSON_BODY_BYTES) {
        await reader.cancel("REQUEST_BODY_TOO_LARGE").catch(() => undefined);
        throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求正文超过 16 KiB", 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求正文为空", 400);
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")); }
  catch { throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON 对象", 400); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "请求正文必须是 JSON 对象", 400);
  }
  return parsed as Record<string, unknown>;
}

function assertFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  const fields = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", `未知字段：${unknown}`, 400);
}

function decodeFilenameHeader(value: string | null): string {
  if (value === null || value.length === 0 || value.length > 2_048) {
    throw new MaterialImportFallbackError("IMPORT_FILE_NAME_REQUIRED", "缺少 X-File-Name", 400);
  }
  try { return decodeURIComponent(value); }
  catch { throw new MaterialImportFallbackError("IMPORT_FILE_NAME_INVALID", "X-File-Name 编码无效", 400); }
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (value === null || value === "") throw new MaterialImportFallbackError("IMPORT_UPLOAD_HEADER_REQUIRED", `缺少 ${name}`, 400);
  if (value.length > 512) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", `${name} 过长`, 400);
  return value;
}

function uploadHeaders(request: Request, maximumBytes: number) {
  const mime = request.headers.get("X-File-Mime");
  if (mime === null) throw new MaterialImportFallbackError("IMPORT_UPLOAD_HEADER_REQUIRED", "缺少 X-File-Mime", 400);
  return normalizeMaterialImportUploadHeaders({
    expectedVersion: requiredHeader(request, "X-Expected-Version"),
    declaredFilename: decodeFilenameHeader(request.headers.get("X-File-Name")),
    declaredMimeType: mime,
    declaredSha256: requiredHeader(request, "X-File-SHA256"),
    declaredSizeBytes: requiredHeader(request, "X-File-Size"),
    duplicateAction: requiredHeader(request, "X-Duplicate-Action").toUpperCase(),
  }, maximumBytes);
}

function cursorScope(input: Readonly<{
  actor: string;
  status: string | null;
  sourceKind: string | null;
  createdByMe: boolean;
  sort: string;
  limit: number;
}>): Record<string, unknown> {
  return {
    actor: input.actor,
    status: input.status,
    source_kind: input.sourceKind,
    created_by_me: input.createdByMe,
    sort: input.sort,
    limit: input.limit,
  };
}

export function encodeMaterialImportFallbackCursor(
  facts: Readonly<{ createdAt: string; id: number }>,
  scope: Record<string, unknown>,
): string {
  const base = { v: 1, created_at: facts.createdAt, id: facts.id, scope };
  return Buffer.from(JSON.stringify({ ...base, digest: materialImportFallbackDigest(base) })).toString("base64url");
}

export function decodeMaterialImportFallbackCursor(
  value: string | null,
  scope: Record<string, unknown>,
): Readonly<{ createdAt: string; id: number }> | null {
  if (!value) return null;
  if (value.length > 2_048) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "cursor 无效", 400);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const base = { v: parsed.v, created_at: parsed.created_at, id: parsed.id, scope: parsed.scope };
    const createdAt = String(parsed.created_at);
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.id) || Number(parsed.id) <= 0
      || new Date(createdAt).toISOString() !== createdAt
      || materialImportFallbackDigest(parsed.scope) !== materialImportFallbackDigest(scope)
      || parsed.digest !== materialImportFallbackDigest(base)) throw new Error("invalid");
    return { createdAt, id: Number(parsed.id) };
  } catch {
    throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "cursor 无效或已失效", 400);
  }
}

function resultResponse(result: MaterialImportFallbackResult, requestId: string): Response {
  const headers = new Headers();
  if (result.replayed) headers.set("Idempotency-Replayed", "true");
  if (result.operationId) headers.set("X-Operation-ID", result.operationId);
  return response({ data: result.data, operation_id: result.operationId, request_id: requestId }, result.statusCode, requestId, headers);
}

function knownError(error: unknown): MaterialImportFallbackError {
  if (error instanceof MaterialImportFallbackError) return error;
  if (error instanceof MaterialImportTransactionOutcomeUnknownError) {
    return new MaterialImportFallbackError("RESULT_UNKNOWN", "操作结果尚未确认，请使用原操作标识安全恢复", 503, { retryAfterSeconds: 5 });
  }
  if (error instanceof MaterialImportMultipartError) {
    return new MaterialImportFallbackError(error.code, error.message, error.status);
  }
  return new MaterialImportFallbackError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
}

export async function handleSelfhostMaterialImportFallbackApi(
  request: Request,
  dependencies: MaterialImportFallbackApiDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  const service = dependencies.service ?? new MaterialImportFallbackService(
    new PostgresMaterialImportFallbackRepository(dependencies.pool),
    new LocalMaterialImportFileStore(dependencies.uploadRoot),
    dependencies.queue,
    { maximumBytes: dependencies.maximumBytes, leaseSeconds: dependencies.leaseSeconds },
  );
  try {
    if (!route.methods.includes(request.method)) {
      return response({
        error: { code: "METHOD_NOT_ALLOWED", message: "接口不支持该请求方法", request_id: dependencies.requestId },
        code: "METHOD_NOT_ALLOWED", message: "接口不支持该请求方法", request_id: dependencies.requestId,
      }, 405, dependencies.requestId, { Allow: route.methods.join(", ") });
    }

    if (route.action === "list") {
      if (request.method === "POST") {
        requirePermission(dependencies.actor, "material.import.create");
        enforceCsrf(dependencies.requireCsrf);
        const key = idempotencyKey(request);
        const value = await readJsonObject(request);
        assertFields(value, ["source_kind", "retry_of_batch_id"]);
        const result = await service.createBatch({
          actor: dependencies.actor,
          requestId: dependencies.requestId,
          idempotencyKey: key,
          sourceKind: String(value.source_kind ?? ""),
          retryOfBatchId: value.retry_of_batch_id == null ? null : Number(value.retry_of_batch_id),
        });
        return resultResponse(result, dependencies.requestId);
      }
      assertQuery(url, ["status", "source_kind", "created_by_me", "sort", "limit", "cursor"]);
      const status = url.searchParams.get("status") || null;
      const sourceKind = url.searchParams.get("source_kind") || null;
      const createdByValue = url.searchParams.get("created_by_me") ?? "true";
      const sortValue = url.searchParams.get("sort") ?? "created_at_desc";
      const limitValue = url.searchParams.get("limit") ?? "50";
      if (status && !IMPORT_STATUSES.has(status)) throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "status 无效", 400);
      if (sourceKind && sourceKind !== "CSV" && sourceKind !== "XLSX") throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "source_kind 无效", 400);
      if (createdByValue !== "true" && createdByValue !== "false") throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "created_by_me 无效", 400);
      if (sortValue !== "created_at_asc" && sortValue !== "created_at_desc") throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "sort 无效", 400);
      if (limitValue !== "20" && limitValue !== "50") throw new MaterialImportFallbackError("REQUEST_VALIDATION_FAILED", "limit 无效", 400);
      const createdByMe = createdByValue === "true";
      const limit = Number(limitValue) as 20 | 50;
      const scope = cursorScope({ actor: dependencies.actor.username, status, sourceKind, createdByMe, sort: sortValue, limit });
      const data = await service.listBatches({
        actor: dependencies.actor,
        status,
        sourceKind,
        createdByMe,
        sort: sortValue,
        limit,
        cursor: decodeMaterialImportFallbackCursor(url.searchParams.get("cursor"), scope),
      });
      return response({
        data: data.data,
        total: data.total,
        page: {
          has_more: data.page.has_more,
          next_cursor: data.page.next_cursor_facts
            ? encodeMaterialImportFallbackCursor(data.page.next_cursor_facts, scope)
            : null,
        },
        request_id: dependencies.requestId,
      }, 200, dependencies.requestId);
    }

    if (route.action === "detail") {
      assertQuery(url, []);
      const data = await service.batchDetail(route.batchId!, dependencies.actor);
      return response({ data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }

    if (route.action === "upload") {
      assertQuery(url, []);
      requirePermission(dependencies.actor, "material.import.create");
      enforceCsrf(dependencies.requireCsrf);
      const key = idempotencyKey(request);
      const headers = uploadHeaders(request, dependencies.maximumBytes);
      validateSingleFileMultipartHeaders(request, dependencies.maximumBytes);
      const prepared = await service.prepareUpload({
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        idempotencyKey: key,
        batchId: route.batchId!,
        headers,
      });
      if (!("kind" in prepared)) {
        await request.body?.cancel("IDEMPOTENT_REPLAY").catch(() => undefined);
        return resultResponse(prepared, dependencies.requestId);
      }
      const heartbeat = new UploadLeaseHeartbeat(
        () => service.heartbeatUpload(prepared),
        Math.max(1_000, Math.floor(dependencies.leaseSeconds * 1_000 / 3)),
      );
      let part: Awaited<ReturnType<typeof readSingleFilePart>> | undefined;
      try {
        await heartbeat.renew();
        try {
          part = await (dependencies.readFilePart ?? readSingleFilePart)(request, dependencies.maximumBytes);
        } catch (error) {
          const known = error instanceof MaterialImportMultipartError
            ? error
            : new MaterialImportMultipartError("INVALID_REQUEST", "multipart 文件无效", 400);
          return await service.failPreparedUpload({
            preparation: prepared as MaterialImportFallbackPreparedUpload,
            actor: dependencies.actor,
            requestId: dependencies.requestId,
            code: known.code,
            message: known.message,
            status: known.status,
          });
        }
        await heartbeat.renew();
      } catch (error) {
        if (error instanceof Error && error.message === "IMPORT_UPLOAD_LEASE_LOST") {
          await part?.stream.cancel(error).catch(() => undefined);
          await part?.completion.catch(() => undefined);
          throw new MaterialImportFallbackError("IDEMPOTENCY_IN_PROGRESS", "同一上传已由恢复协调器接管", 409, {
            operationId: prepared.operationId,
            retryAfterSeconds: Math.max(1, Math.ceil(dependencies.leaseSeconds / 3)),
          });
        }
        throw error;
      } finally {
        await heartbeat.stop();
      }
      return resultResponse(await service.executeUpload({
        preparation: prepared,
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        part,
      }), dependencies.requestId);
    }

    if (route.action === "cancel") {
      assertQuery(url, []);
      requirePermission(dependencies.actor, "material.import.cancel");
      enforceCsrf(dependencies.requireCsrf);
      const key = idempotencyKey(request);
      const value = await readJsonObject(request);
      assertFields(value, ["expected_version", "reason_code"]);
      return resultResponse(await service.cancelBatch({
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        idempotencyKey: key,
        batchId: route.batchId!,
        expectedVersion: Number(value.expected_version),
        reasonCode: String(value.reason_code ?? ""),
      }), dependencies.requestId);
    }

    if (route.action === "parse") {
      assertQuery(url, []);
      requirePermission(dependencies.actor, "material.import.parse");
      enforceCsrf(dependencies.requireCsrf);
      const key = idempotencyKey(request);
      const value = await readJsonObject(request);
      assertFields(value, ["expected_version", "parser_version"]);
      return resultResponse(await service.queueParse({
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        idempotencyKey: key,
        batchId: route.batchId!,
        expectedVersion: Number(value.expected_version),
        parserVersion: String(value.parser_version ?? ""),
      }), dependencies.requestId);
    }

    assertQuery(url, []);
    const data = await service.job(route.jobId!, dependencies.actor);
    return response({ data, request_id: dependencies.requestId }, 200, dependencies.requestId);
  } catch (error) {
    const known = knownError(error);
    if (route.action === "upload") await request.body?.cancel(known.code).catch(() => undefined);
    await service.failureAudit({
      actor: dependencies.actor.username,
      action: "IMPORT_FALLBACK_REQUEST_FAILED",
      requestId: dependencies.requestId,
      routeCode: route.code,
      errorCode: known.code,
      batchId: route.batchId,
    }).catch(() => undefined);
    console.error(JSON.stringify({
      level: "error",
      event: "material_import_fallback_api_failed",
      request_id: dependencies.requestId,
      route_code: route.code,
      code: known.code,
    }));
    const current = known.currentVersion === undefined ? {} : { current_version: known.currentVersion };
    const operation = known.operationId === undefined ? {} : { operation_id: known.operationId };
    const headers = new Headers();
    if (known.retryAfterSeconds !== undefined) headers.set("Retry-After", String(known.retryAfterSeconds));
    if (known.replayed) headers.set("Idempotency-Replayed", "true");
    if (known.operationId) headers.set("X-Operation-ID", known.operationId);
    return response({
      error: { code: known.code, message: known.message, request_id: dependencies.requestId, ...current, ...operation },
      code: known.code,
      message: known.message,
      request_id: dependencies.requestId,
      ...current,
      ...operation,
    }, known.status, dependencies.requestId, headers);
  }
}
