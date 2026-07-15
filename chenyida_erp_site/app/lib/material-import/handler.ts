import type { MaterialMasterD1Database } from "../material-master/index.ts";
import {
  assertMaterialCsrf,
  MaterialApiFailure,
  readBoundedJson,
  type MaterialApiUser,
} from "../material-api/security.ts";
import type { MaterialImportObjectStore } from "./object-store.ts";
import {
  cancelMaterialImportBatch,
  createMaterialImportBatch,
  getMaterialImportBatch,
  listMaterialImportBatches,
  listMaterialImportEvents,
  MaterialImportServiceError,
  uploadMaterialImportFile,
  type MaterialImportServiceResult,
} from "./service.ts";

type ImportPermission =
  | "material.import.create"
  | "material.import.read"
  | "material.import.cancel"
  | "material.import.read_any";

export type MaterialImportApiDependencies = Readonly<{
  database: MaterialMasterD1Database;
  objectStore?: MaterialImportObjectStore;
  objectPrefix?: string;
  currentUser(request: Request): Promise<MaterialApiUser | null>;
  userCan(user: MaterialApiUser, permission: ImportPermission): boolean;
  clock?: () => Date;
}>;

const unavailableStore: MaterialImportObjectStore = {
  async putIfAbsent() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
  async head() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
  async open() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
  async delete() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
};

function response(result: MaterialImportServiceResult, requestId: string): Response {
  const payload = { request_id: requestId, ...result.payload };
  const output = new Response(JSON.stringify(payload), {
    status: result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "X-Request-Id": requestId,
    },
  });
  if (result.replayed) output.headers.set("Idempotency-Replayed", "true");
  return output;
}

function errorResponse(error: MaterialImportServiceError, requestId: string): Response {
  const body: Record<string, unknown> = { code: error.code, message: error.message };
  if (error.expectedVersion !== undefined) body.expected_version = error.expectedVersion;
  return new Response(JSON.stringify({ request_id: requestId, error: body }), {
    status: error.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "X-Request-Id": requestId,
      "X-Error-Code": error.code,
    },
  });
}

function integerPath(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return parsed;
}

function queryLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new MaterialImportServiceError("INVALID_REQUEST", "limit 必须是正整数", 400);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 100) throw new MaterialImportServiceError("INVALID_REQUEST", "limit 最大为 100", 400);
  return parsed;
}

function assertQueryKeys(url: URL, allowed: readonly string[]): void {
  const set = new Set(allowed);
  const unknown = [...url.searchParams.keys()].find((key) => !set.has(key));
  if (unknown) throw new MaterialImportServiceError("INVALID_REQUEST", `未知查询参数：${unknown}`, 400);
}

function assertObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !set.has(key));
  if (unknown) throw new MaterialImportServiceError("INVALID_REQUEST", `请求包含未声明字段：${unknown}`, 400);
}

async function writeFailureAudit(
  dependencies: MaterialImportApiDependencies,
  user: MaterialApiUser | null,
  requestId: string,
  path: string,
  error: MaterialImportServiceError,
): Promise<void> {
  if (!user) return;
  const timestamp = (dependencies.clock ?? (() => new Date()))().toISOString();
  await dependencies.database.prepare(`
    INSERT INTO audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until,created_at)
    VALUES(?,'MATERIAL_IMPORT_API_REJECTED',?,?,'failed','MATERIAL_IMPORT_BATCH',?,?,?)
  `).bind(user.username, path.slice(0, 255), requestId, error.code, Math.floor(new Date(timestamp).getTime() / 1000) + 1095 * 86400, timestamp).run().catch(() => undefined);
}

export function isMaterialImportPath(path: string): boolean {
  return path === "/api/material-master/import-batches" || path.startsWith("/api/material-master/import-batches/");
}

export async function handleMaterialImportApi(request: Request, dependencies: MaterialImportApiDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  let user: MaterialApiUser | null = null;
  try {
    user = await dependencies.currentUser(request);
    if (!user) throw new MaterialImportServiceError("AUTHENTICATION_REQUIRED", "请先登录", 401);
    if (user.must_change_password) throw new MaterialImportServiceError("PERMISSION_DENIED", "请先修改临时密码", 403);
    const root = url.pathname === "/api/material-master/import-batches";
    const detailMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)$/);
    const fileMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/file$/);
    const eventsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/events$/);
    const cancelMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/cancel$/);
    if (!root && !detailMatch && !fileMatch && !eventsMatch && !cancelMatch) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入接口不存在", 404);
    const permission: ImportPermission = root && request.method === "POST"
      ? "material.import.create"
      : fileMatch
        ? "material.import.create"
        : cancelMatch
          ? "material.import.cancel"
          : "material.import.read";
    if (!dependencies.userCan(user, permission)) throw new MaterialImportServiceError("PERMISSION_DENIED", "没有执行此操作的权限", 403);
    const canReadAny = dependencies.userCan(user, "material.import.read_any");
    const serviceDependencies = {
      database: dependencies.database,
      objectStore: dependencies.objectStore ?? unavailableStore,
      objectPrefix: dependencies.objectPrefix,
      clock: dependencies.clock,
    };
    let result: MaterialImportServiceResult;
    if (root && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["source_kind", "retry_of_batch_id"]);
      result = await createMaterialImportBatch(serviceDependencies, {
        user,
        rawKey: request.headers.get("Idempotency-Key") ?? "",
        requestId,
        sourceKind: body.source_kind,
        retryOfBatchId: body.retry_of_batch_id,
        canReadAny,
      });
    } else if (root && request.method === "GET") {
      assertQueryKeys(url, ["status", "source_kind", "created_by_me", "cursor", "limit", "sort"]);
      const status = url.searchParams.get("status") ?? undefined;
      if (status && !new Set(["CREATED", "UPLOAD_PENDING", "FILE_READY", "RECONCILIATION_REQUIRED", "FAILED", "CANCELLED"]).has(status)) throw new MaterialImportServiceError("INVALID_REQUEST", "status 无效", 400);
      const sourceKind = url.searchParams.get("source_kind") ?? undefined;
      if (sourceKind && sourceKind !== "XLSX" && sourceKind !== "CSV") throw new MaterialImportServiceError("INVALID_REQUEST", "source_kind 无效", 400);
      const createdByMe = url.searchParams.get("created_by_me");
      if (createdByMe && createdByMe !== "true" && createdByMe !== "false") throw new MaterialImportServiceError("INVALID_REQUEST", "created_by_me 无效", 400);
      const sort = url.searchParams.get("sort") ?? "created_at_desc";
      if (sort !== "created_at_desc" && sort !== "created_at_asc") throw new MaterialImportServiceError("INVALID_REQUEST", "sort 无效", 400);
      result = await listMaterialImportBatches(serviceDependencies, {
        user,
        canReadAny: canReadAny && createdByMe !== "true",
        status,
        sourceKind,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: queryLimit(url),
        sort,
      });
    } else if (detailMatch && request.method === "GET") {
      assertQueryKeys(url, []);
      result = await getMaterialImportBatch(serviceDependencies, { batchId: integerPath(detailMatch[1]), user, canReadAny });
    } else if (eventsMatch && request.method === "GET") {
      assertQueryKeys(url, ["cursor", "limit"]);
      result = await listMaterialImportEvents(serviceDependencies, { batchId: integerPath(eventsMatch[1]), user, canReadAny, cursor: url.searchParams.get("cursor") ?? undefined, limit: queryLimit(url) });
    } else if (fileMatch && request.method === "POST") {
      if (!dependencies.objectStore) throw new MaterialImportServiceError("IMPORT_FILE_STORAGE_FAILED", "对象存储在当前环境不可用", 503);
      assertMaterialCsrf(request);
      result = await uploadMaterialImportFile(serviceDependencies, { request, batchId: integerPath(fileMatch[1]), user, canReadAny, rawKey: request.headers.get("Idempotency-Key") ?? "", requestId });
    } else if (cancelMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "reason_code"]);
      result = await cancelMaterialImportBatch(serviceDependencies, { batchId: integerPath(cancelMatch[1]), user, canReadAny, rawKey: request.headers.get("Idempotency-Key") ?? "", requestId, expectedVersion: body.expected_version, reasonCode: body.reason_code });
    } else {
      throw new MaterialImportServiceError("METHOD_NOT_ALLOWED", "请求方法不支持", 405);
    }
    return response(result, requestId);
  } catch (error) {
    let failure: MaterialImportServiceError;
    if (error instanceof MaterialImportServiceError) failure = error;
    else if (error instanceof MaterialApiFailure) {
      failure = new MaterialImportServiceError(
        error.code === "CSRF_INVALID" ? "CSRF_VALIDATION_FAILED" : error.code,
        error.code === "CSRF_INVALID" ? "CSRF 校验失败" : error.message,
        error.status,
      );
    } else failure = new MaterialImportServiceError("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500);
    await writeFailureAudit(dependencies, user, requestId, url.pathname, failure);
    const output = errorResponse(failure, requestId);
    if (failure.status === 429) output.headers.set("Retry-After", "60");
    return output;
  }
}
