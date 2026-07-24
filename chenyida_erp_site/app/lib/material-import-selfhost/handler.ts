import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { MaterialImportMappingError } from "./errors.ts";
import { canonicalJson } from "./rules.ts";
import { MaterialImportMappingService } from "./service.ts";
import type { MappingActor } from "./types.ts";

type Dependencies = Readonly<{
  pool: Pool;
  actor: MappingActor;
  requestId: string;
  requireCsrf: () => void;
}>;
type Route = Readonly<{
  code: string;
  permission: "material.import.read" | "material.import.map";
  methods: readonly string[];
  batchId: number;
  action: "sheets" | "rows" | "mapping" | "targets" | "preview" | "confirm" | "versions" | "version" | "validity" | "reuse-candidates" | "reuse";
  version?: number;
}>;

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const values = new Headers(headers);
  values.set("Cache-Control", "no-store");
  values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function failure(error: MaterialImportMappingError, requestId: string): Response {
  const details = error.details.length ? { details: error.details } : {};
  const current = error.currentVersion === undefined ? {} : { current_version: error.currentVersion };
  return response({
    error: { code: error.code, message: error.message, request_id: requestId, ...details, ...current },
    code: error.code,
    message: error.message,
    request_id: requestId,
    ...details,
    ...current,
  }, error.status, requestId);
}

function routeFor(path: string): Route | null {
  const match = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/(.+)$/);
  if (!match) return null;
  const batchId = Number(match[1]);
  const suffix = match[2];
  if (suffix === "sheets") return { code: "IMPORT_MAPPING_SHEETS", permission: "material.import.read", methods: ["GET"], batchId, action: "sheets" };
  if (suffix === "rows") return { code: "IMPORT_MAPPING_ROWS", permission: "material.import.read", methods: ["GET"], batchId, action: "rows" };
  if (suffix === "mapping") return { code: "IMPORT_MAPPING_CURRENT", permission: "material.import.read", methods: ["GET", "PUT"], batchId, action: "mapping" };
  if (suffix === "mapping-targets") return { code: "IMPORT_MAPPING_TARGETS", permission: "material.import.read", methods: ["GET"], batchId, action: "targets" };
  if (suffix === "mapping/preview") return { code: "IMPORT_MAPPING_PREVIEW", permission: "material.import.map", methods: ["POST"], batchId, action: "preview" };
  if (suffix === "mapping/confirm") return { code: "IMPORT_MAPPING_CONFIRM", permission: "material.import.map", methods: ["POST"], batchId, action: "confirm" };
  if (suffix === "mapping/versions") return { code: "IMPORT_MAPPING_VERSIONS", permission: "material.import.read", methods: ["GET", "POST"], batchId, action: "versions" };
  const version = suffix.match(/^mapping\/versions\/([1-9][0-9]*)$/);
  if (version) return { code: "IMPORT_MAPPING_VERSION_DETAIL", permission: "material.import.read", methods: ["GET"], batchId, action: "version", version: Number(version[1]) };
  if (suffix === "mapping/validity") return { code: "IMPORT_MAPPING_VALIDITY", permission: "material.import.read", methods: ["GET"], batchId, action: "validity" };
  if (suffix === "mapping/reuse-candidates") return { code: "IMPORT_MAPPING_REUSE_CANDIDATES", permission: "material.import.read", methods: ["GET"], batchId, action: "reuse-candidates" };
  if (suffix === "mapping/reuse") return { code: "IMPORT_MAPPING_REUSE", permission: "material.import.map", methods: ["POST"], batchId, action: "reuse" };
  return null;
}

function allowed(actor: MappingActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission) || (permission === "material.import.read" && actor.permissions.includes("material.import.read_any"));
}

function positiveInteger(value: string | null, field: string, fallback: number, maximum: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new MaterialImportMappingError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`, 400);
  return parsed;
}

function nonNegativeInteger(value: string | null, field: string, fallback = 0, maximum = 1_000_000): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) throw new MaterialImportMappingError("REQUEST_VALIDATION_FAILED", `${field} 必须是非负整数`, 400);
  return parsed;
}

function assertQuery(url: URL, allowedKeys: ReadonlySet<string>): void {
  const unknown = [...url.searchParams.keys()].find((key) => !allowedKeys.has(key));
  if (unknown) throw new MaterialImportMappingError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

async function readBody(request: Request): Promise<Readonly<{ value: Record<string, unknown>; digest: string }>> {
  const text = await request.text();
  if (!text || Buffer.byteLength(text) > 256 * 1024) throw new MaterialImportMappingError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MaterialImportMappingError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MaterialImportMappingError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象", 400);
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return { value: value as Record<string, unknown>, digest };
}

async function failureAudit(dependencies: Dependencies, route: Route, error: MaterialImportMappingError): Promise<void> {
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,'IMPORT_MAPPING_REQUEST_FAILED',$2,$3,'failed',$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, { batch_id: route.batchId }, dependencies.requestId, route.code, error.code]).catch(() => undefined);
}

export async function handleSelfhostMaterialImportMappingApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  try {
    if (!route.methods.includes(request.method)) throw new MaterialImportMappingError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    const write = request.method !== "GET";
    const requiredPermission = write ? "material.import.map" : route.permission;
    if (!allowed(dependencies.actor, requiredPermission)) throw new MaterialImportMappingError("PERMISSION_DENIED", "没有权限执行此操作", 403);
    if (write && dependencies.actor.must_change_password) throw new MaterialImportMappingError("PERMISSION_DENIED", "请先修改密码再执行写操作", 403);
    const service = new MaterialImportMappingService(dependencies.pool);

    if (route.action === "sheets") {
      assertQuery(url, new Set());
      return response({ ...await service.sheets(route.batchId, dependencies.actor), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "rows") {
      assertQuery(url, new Set(["sheet_index", "page", "page_size"]));
      const data = await service.rows(route.batchId, dependencies.actor, {
        sheetIndex: nonNegativeInteger(url.searchParams.get("sheet_index"), "sheet_index", 0, 31),
        page: positiveInteger(url.searchParams.get("page"), "page", 1, 1_000_000),
        pageSize: positiveInteger(url.searchParams.get("page_size"), "page_size", 50, 200),
      });
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "mapping" && request.method === "GET") {
      assertQuery(url, new Set());
      return response({ ...await service.mapping(route.batchId, dependencies.actor), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "targets") {
      assertQuery(url, new Set(["q", "limit", "cursor"]));
      const data = await service.catalog(route.batchId, dependencies.actor, {
        query: (url.searchParams.get("q") || "").slice(0, 100),
        limit: positiveInteger(url.searchParams.get("limit"), "limit", 50, 100),
        cursor: nonNegativeInteger(url.searchParams.get("cursor"), "cursor", 0, 100_000),
      });
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "versions" && request.method === "GET") {
      assertQuery(url, new Set());
      return response({ ...await service.versions(route.batchId, dependencies.actor), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "version") {
      assertQuery(url, new Set());
      return response({ ...await service.version(route.batchId, dependencies.actor, route.version!), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "validity") {
      assertQuery(url, new Set());
      return response({ ...await service.validity(route.batchId, dependencies.actor), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "reuse-candidates") {
      assertQuery(url, new Set());
      return response({ ...await service.reuseCandidates(route.batchId, dependencies.actor), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }

    dependencies.requireCsrf();
    const idempotencyKey = request.headers.get("Idempotency-Key") || "";
    if (!idempotencyKey) throw new MaterialImportMappingError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
    const parsed = await readBody(request);
    const context = {
      actor: dependencies.actor,
      requestId: dependencies.requestId,
      method: request.method as "POST" | "PUT",
      idempotencyKey,
      requestDigest: parsed.digest,
      routeScope: `${route.code}:${route.batchId}`,
    };
    const result = route.action === "mapping"
      ? await service.save(route.batchId, context, parsed.value)
      : route.action === "preview"
        ? await service.preview(route.batchId, context, parsed.value)
        : route.action === "confirm"
          ? await service.confirm(route.batchId, context, parsed.value)
          : route.action === "versions"
            ? await service.createVersion(route.batchId, context, parsed.value)
            : route.action === "reuse"
              ? await service.applyReuse(route.batchId, context, parsed.value)
              : null;
    if (!result) throw new MaterialImportMappingError("NOT_FOUND", "接口不存在", 404);
    return response(
      { ...result.data, operation_id: result.operationId, request_id: dependencies.requestId },
      result.statusCode,
      dependencies.requestId,
      result.replayed ? { "Idempotency-Replayed": "true" } : undefined,
    );
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown };
    const known = error instanceof MaterialImportMappingError ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new MaterialImportMappingError(compatible.code, typeof compatible.message === "string" ? compatible.message : "请求失败", Number(compatible.status), { details: Array.isArray(compatible.details) ? compatible.details as Record<string, unknown>[] : [] })
        : new MaterialImportMappingError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
    await failureAudit(dependencies, route, known);
    console.error(JSON.stringify({ level: "error", event: "material_import_mapping_api_failed", request_id: dependencies.requestId, route_code: route.code, code: known.code }));
    return failure(known, dependencies.requestId);
  }
}
