import type { Pool } from "pg";
import type { MappingActor } from "../material-import-selfhost/types.ts";
import { MaterialStandardizationError } from "./errors.ts";
import { MaterialStandardizationService } from "./service.ts";

type StandardizationReader = Pick<MaterialStandardizationService, "preview" | "exportCsv">;
type Dependencies = Readonly<{
  pool: Pool;
  actor: MappingActor;
  requestId: string;
  service?: StandardizationReader;
}>;
type Route = Readonly<{ batchId: number; action: "preview" | "export"; code: string }>;

function routeFor(path: string): Route | null {
  const match = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/(standardization-preview|standardization-export\.csv)$/);
  if (!match) return null;
  return {
    batchId: Number(match[1]),
    action: match[2] === "standardization-preview" ? "preview" : "export",
    code: match[2] === "standardization-preview" ? "IMPORT_STANDARDIZATION_PREVIEW" : "IMPORT_STANDARDIZATION_EXPORT",
  };
}

function allowed(actor: MappingActor): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes("material.import.read") || actor.permissions.includes("material.import.read_any");
}

function privateHeaders(requestId: string, source?: HeadersInit): Headers {
  const headers = new Headers(source);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Cookie");
  headers.set("X-Request-ID", requestId);
  return headers;
}

function json(payload: unknown, status: number, requestId: string): Response {
  return Response.json(payload, { status, headers: privateHeaders(requestId) });
}

function failure(error: MaterialStandardizationError, requestId: string): Response {
  return json({
    error: { code: error.code, message: error.message, request_id: requestId },
    code: error.code,
    message: error.message,
    request_id: requestId,
  }, error.status, requestId);
}

function assertKnownQuery(url: URL, allowedKeys: ReadonlySet<string>): void {
  const unknown = [...url.searchParams.keys()].find((key) => !allowedKeys.has(key));
  if (unknown) throw new MaterialStandardizationError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

function pageNumber(value: string | null): number {
  if (value === null || value === "") return 1;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 1_000_000) throw new MaterialStandardizationError("REQUEST_VALIDATION_FAILED", "page 必须是正整数", 400);
  return Number(value);
}

function pageSize(value: string | null): 20 | 50 {
  if (value === null || value === "" || value === "50") return 50;
  if (value === "20") return 20;
  throw new MaterialStandardizationError("REQUEST_VALIDATION_FAILED", "page_size 只允许 20 或 50", 400);
}

function encodedFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function failureAudit(dependencies: Dependencies, route: Route, error: MaterialStandardizationError): Promise<void> {
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,'IMPORT_STANDARDIZATION_REQUEST_FAILED',$2,$3,'failed',$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, { batch_id: route.batchId }, dependencies.requestId, route.code, error.code]).catch(() => undefined);
}

export async function handleSelfhostMaterialStandardizationApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  try {
    if (request.method !== "GET") throw new MaterialStandardizationError("METHOD_NOT_ALLOWED", "接口只支持 GET 请求", 405);
    if (!allowed(dependencies.actor)) throw new MaterialStandardizationError("PERMISSION_DENIED", "没有权限查看供应商导入整理结果", 403);
    const service = dependencies.service ?? new MaterialStandardizationService(dependencies.pool);
    if (route.action === "preview") {
      assertKnownQuery(url, new Set(["page", "page_size"]));
      const data = await service.preview(route.batchId, dependencies.actor, { page: pageNumber(url.searchParams.get("page")), pageSize: pageSize(url.searchParams.get("page_size")) });
      return json({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    assertKnownQuery(url, new Set());
    const exported = await service.exportCsv(route.batchId, dependencies.actor, dependencies.requestId);
    const headers = privateHeaders(dependencies.requestId, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="material-standardization-${route.batchId}.csv"; filename*=UTF-8''${encodedFilename(exported.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "X-Standardized-Row-Count": String(exported.rowCount),
    });
    return new Response(exported.csv, { status: 200, headers });
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown };
    const known = error instanceof MaterialStandardizationError
      ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new MaterialStandardizationError(compatible.code, typeof compatible.message === "string" ? compatible.message : "请求失败", Number(compatible.status))
        : new MaterialStandardizationError("INTERNAL_ERROR", "服务器暂时无法生成标准整理结果", 500);
    await failureAudit(dependencies, route, known);
    console.error(JSON.stringify({ level: "error", event: "material_standardization_api_failed", request_id: dependencies.requestId, route_code: route.code, code: known.code }));
    return failure(known, dependencies.requestId);
  }
}
