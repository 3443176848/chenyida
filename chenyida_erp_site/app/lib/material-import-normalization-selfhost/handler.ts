import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { canonicalJson } from "../material-import-selfhost/rules.ts";
import { MaterialImportNormalizationError } from "./errors.ts";
import { PostgresNormalizationRepository } from "./repository.ts";
import { MaterialImportNormalizationService, normalizationRequestDigest } from "./service.ts";
import type { NormalizationActor } from "./types.ts";

type Dependencies = Readonly<{
  pool: Pool;
  actor: NormalizationActor;
  requestId: string;
  requireCsrf: () => void;
}>;

type Route = Readonly<{
  code: string;
  batchId: number;
  action: "create" | "summary" | "runs" | "run" | "retry" | "cancel" | "rows" | "row" | "issues";
  methods: readonly string[];
  runId?: number;
  rowId?: number;
}>;

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const values = new Headers(headers);
  values.set("Cache-Control", "no-store");
  values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function failure(error: MaterialImportNormalizationError, requestId: string): Response {
  const current = error.currentVersion === undefined ? {} : { current_version: error.currentVersion };
  return response({
    error: { code: error.code, message: error.message, request_id: requestId, ...current },
    code: error.code,
    message: error.message,
    request_id: requestId,
    ...current,
  }, error.status, requestId);
}

function routeFor(path: string): Route | null {
  const match = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/(.+)$/);
  if (!match) return null;
  const batchId = Number(match[1]);
  const suffix = match[2];
  if (suffix === "normalize") return { code: "IMPORT_NORMALIZATION_CREATE", batchId, action: "create", methods: ["POST"] };
  if (suffix === "normalization") return { code: "IMPORT_NORMALIZATION_SUMMARY", batchId, action: "summary", methods: ["GET"] };
  if (suffix === "normalization/runs") return { code: "IMPORT_NORMALIZATION_RUNS", batchId, action: "runs", methods: ["GET"] };
  const retry = suffix.match(/^normalization\/runs\/([1-9][0-9]*)\/retry$/);
  if (retry) return { code: "IMPORT_NORMALIZATION_RETRY", batchId, action: "retry", methods: ["POST"], runId: Number(retry[1]) };
  const cancel = suffix.match(/^normalization\/runs\/([1-9][0-9]*)\/cancel$/);
  if (cancel) return { code: "IMPORT_NORMALIZATION_CANCEL", batchId, action: "cancel", methods: ["POST"], runId: Number(cancel[1]) };
  const run = suffix.match(/^normalization\/runs\/([1-9][0-9]*)$/);
  if (run) return { code: "IMPORT_NORMALIZATION_RUN", batchId, action: "run", methods: ["GET"], runId: Number(run[1]) };
  if (suffix === "normalized-rows") return { code: "IMPORT_NORMALIZATION_ROWS", batchId, action: "rows", methods: ["GET"] };
  const row = suffix.match(/^normalized-rows\/([1-9][0-9]*)$/);
  if (row) return { code: "IMPORT_NORMALIZATION_ROW", batchId, action: "row", methods: ["GET"], rowId: Number(row[1]) };
  if (suffix === "normalization-issues") return { code: "IMPORT_NORMALIZATION_ISSUES", batchId, action: "issues", methods: ["GET"] };
  return null;
}

function allowed(actor: NormalizationActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission) || (permission === "material.import.read" && actor.permissions.includes("material.import.read_any"));
}

function assertQuery(url: URL, keys: readonly string[]): void {
  const allowedKeys = new Set(keys);
  const unknown = [...url.searchParams.keys()].find((key) => !allowedKeys.has(key));
  if (unknown) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

function integer(value: string | null, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", `${field} 无效`, 400);
  return parsed;
}

function optionalRunId(url: URL): number | undefined {
  const value = url.searchParams.get("run_id");
  return value === null ? undefined : integer(value, "run_id", 0, 1, Number.MAX_SAFE_INTEGER);
}

async function readBody(request: Request): Promise<Readonly<{ value: Record<string, unknown>; digest: string }>> {
  const text = await request.text();
  if (!text || Buffer.byteLength(text) > 256 * 1024) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象", 400);
  return { value: value as Record<string, unknown>, digest: normalizationRequestDigest(value) };
}

function cursorDigest(payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function encodeCursor(after: number, scope: Record<string, unknown>): string {
  const base = { v: 1, after, scope };
  return Buffer.from(JSON.stringify({ ...base, digest: cursorDigest(base) })).toString("base64url");
}

function decodeCursor(value: string | null, scope: Record<string, unknown>): number {
  if (!value) return 0;
  if (value.length > 2048) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "cursor 无效", 400);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const base = { v: parsed.v, after: parsed.after, scope: parsed.scope };
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.after) || Number(parsed.after) < 0 || canonicalJson(parsed.scope) !== canonicalJson(scope) || parsed.digest !== cursorDigest(base)) throw new Error("invalid");
    return Number(parsed.after);
  } catch {
    throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "cursor 无效或已失效", 400);
  }
}

async function failureAudit(dependencies: Dependencies, route: Route, error: MaterialImportNormalizationError): Promise<void> {
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,'IMPORT_NORMALIZATION_REQUEST_FAILED',$2,$3,'failed',$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, { batch_id: route.batchId, normalization_run_id: route.runId ?? null }, dependencies.requestId, route.code, error.code]).catch(() => undefined);
}

export async function handleSelfhostMaterialImportNormalizationApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  try {
    if (!route.methods.includes(request.method)) throw new MaterialImportNormalizationError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    const permission = route.action === "create" || route.action === "retry"
      ? "material.import.normalize"
      : route.action === "cancel"
        ? "material.import.cancel"
        : "material.import.read";
    if (!allowed(dependencies.actor, permission)) throw new MaterialImportNormalizationError("PERMISSION_DENIED", "没有权限执行此操作", 403);
    const service = new MaterialImportNormalizationService(new PostgresNormalizationRepository(dependencies.pool));
    if (request.method === "POST") {
      dependencies.requireCsrf();
      const key = request.headers.get("Idempotency-Key") || "";
      if (!key) throw new MaterialImportNormalizationError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
      const body = await readBody(request);
      const context = {
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        method: "POST" as const,
        routeScope: `${route.code}:${route.batchId}:${route.runId ?? 0}`,
        idempotencyKey: key,
        requestDigest: body.digest,
      };
      const result = route.action === "create"
        ? await service.create(route.batchId, context, body.value)
        : route.action === "retry"
          ? await service.retry(route.batchId, route.runId!, context, body.value)
          : await service.cancel(route.batchId, route.runId!, context, body.value);
      return response(
        { ...result.data, operation_id: result.operationId, request_id: dependencies.requestId },
        result.statusCode,
        dependencies.requestId,
        result.replayed ? { "Idempotency-Replayed": "true" } : undefined,
      );
    }
    if (route.action === "summary" || route.action === "run") {
      assertQuery(url, route.action === "summary" ? ["run_id"] : []);
      const data = await service.summary(route.batchId, dependencies.actor, route.action === "run" ? route.runId : optionalRunId(url));
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "runs") {
      assertQuery(url, ["cursor", "limit"]);
      const limit = integer(url.searchParams.get("limit"), "limit", 20, 1, 50);
      const scope = { batch_id: route.batchId, kind: "runs" };
      const after = decodeCursor(url.searchParams.get("cursor"), scope);
      const data = await service.runs(route.batchId, dependencies.actor, after, limit);
      const next = data.next_after_version == null ? null : encodeCursor(Number(data.next_after_version), scope);
      return response({ ...data, next_cursor: next, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "rows") {
      assertQuery(url, ["run_id", "cursor", "limit", "row_status", "issue_level"]);
      const runId = optionalRunId(url);
      const rowStatus = url.searchParams.get("row_status") || undefined;
      const issueLevel = url.searchParams.get("issue_level") || undefined;
      if (rowStatus && !["VALID", "WARNING", "ERROR", "SKIPPED"].includes(rowStatus)) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "row_status 无效", 400);
      if (issueLevel && !["ERROR", "WARNING"].includes(issueLevel)) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "issue_level 无效", 400);
      const limit = integer(url.searchParams.get("limit"), "limit", 50, 1, 100);
      const scope = { batch_id: route.batchId, run_id: runId ?? null, row_status: rowStatus ?? null, issue_level: issueLevel ?? null };
      const after = decodeCursor(url.searchParams.get("cursor"), scope);
      const data = await service.rows({ batchId: route.batchId, actor: dependencies.actor, runId, afterId: after, limit, rowStatus, issueLevel });
      const next = data.next_after_id == null ? null : encodeCursor(Number(data.next_after_id), scope);
      return response({ ...data, next_cursor: next, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "row") {
      assertQuery(url, ["run_id"]);
      const data = await service.row(route.batchId, route.rowId!, dependencies.actor, optionalRunId(url));
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    assertQuery(url, ["run_id", "cursor", "limit", "issue_level", "issue_code", "target_code", "source_row_number"]);
    const runId = optionalRunId(url);
    const level = url.searchParams.get("issue_level") || undefined;
    const code = url.searchParams.get("issue_code") || undefined;
    const targetCode = url.searchParams.get("target_code") || undefined;
    if (level && !["ERROR", "WARNING"].includes(level)) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "issue_level 无效", 400);
    if (code && !/^[A-Z][A-Z0-9_]{2,99}$/.test(code)) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "issue_code 无效", 400);
    if (targetCode && (targetCode.length < 3 || targetCode.length > 160)) throw new MaterialImportNormalizationError("REQUEST_VALIDATION_FAILED", "target_code 无效", 400);
    const sourceRowNumber = url.searchParams.has("source_row_number") ? integer(url.searchParams.get("source_row_number"), "source_row_number", 0, 1, 50_000) : undefined;
    const limit = integer(url.searchParams.get("limit"), "limit", 50, 1, 100);
    const scope = { batch_id: route.batchId, run_id: runId ?? null, level: level ?? null, code: code ?? null, target: targetCode ?? null, source_row: sourceRowNumber ?? null };
    const after = decodeCursor(url.searchParams.get("cursor"), scope);
    const data = await service.issues({ batchId: route.batchId, actor: dependencies.actor, runId, afterId: after, limit, level, code, targetCode, sourceRowNumber });
    const next = data.next_after_id == null ? null : encodeCursor(Number(data.next_after_id), scope);
    return response({ ...data, next_cursor: next, request_id: dependencies.requestId }, 200, dependencies.requestId);
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown; currentVersion?: unknown };
    const known = error instanceof MaterialImportNormalizationError
      ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new MaterialImportNormalizationError(
          compatible.code,
          typeof compatible.message === "string" ? compatible.message : "请求失败",
          Number(compatible.status),
          { currentVersion: Number.isSafeInteger(compatible.currentVersion) ? Number(compatible.currentVersion) : undefined },
        )
        : new MaterialImportNormalizationError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
    await failureAudit(dependencies, route, known);
    console.error(JSON.stringify({ level: "error", event: "material_import_normalization_api_failed", request_id: dependencies.requestId, route_code: route.code, code: known.code }));
    return failure(known, dependencies.requestId);
  }
}
