import type { Pool } from "pg";
import type { BackgroundJobQueue } from "../infrastructure/background-jobs.ts";
import { MaterialImportReviewError } from "./errors.ts";
import { PostgresMaterialImportReviewRepository } from "./repository.ts";
import { MaterialImportReviewService, reviewRequestDigest } from "./service.ts";
import type { ReviewActor } from "./types.ts";

type Dependencies = Readonly<{
  pool: Pool;
  queue: BackgroundJobQueue;
  actor: ReviewActor;
  requestId: string;
  requireCsrf: () => void;
}>;

type Route = Readonly<{
  code: string;
  action: "create" | "current" | "history" | "stats" | "rows" | "row" | "field" | "attribute" | "decision" | "issue" | "bulk" | "validate" | "finalize" | "progress" | "retry" | "materials";
  batchId: number;
  sessionId?: number;
  rowId?: number;
  issueId?: number;
  methods: readonly string[];
}>;

const integer = (value: string | null, field: string, fallback: number, minimum: number, maximum: number): number => {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", `${field} 无效`, 400);
  return number;
};

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const values = new Headers(headers);
  values.set("Cache-Control", "no-store");
  values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function routeFor(path: string): Route | null {
  const root = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/reviews(?:\/(.*))?$/);
  if (!root) return null;
  const batchId = Number(root[1]);
  const suffix = root[2] ?? "";
  if (!suffix) return { code: "IMPORT_REVIEW_CREATE", action: "create", batchId, methods: ["POST"] };
  if (suffix === "current") return { code: "IMPORT_REVIEW_CURRENT", action: "current", batchId, methods: ["GET"] };
  if (suffix === "history") return { code: "IMPORT_REVIEW_HISTORY", action: "history", batchId, methods: ["GET"] };
  if (suffix === "active-materials") return { code: "IMPORT_REVIEW_ACTIVE_MATERIALS", action: "materials", batchId, methods: ["GET"] };
  const match = suffix.match(/^([1-9][0-9]*)(?:\/(.*))?$/);
  if (!match) return null;
  const sessionId = Number(match[1]);
  const child = match[2] ?? "";
  if (child === "statistics") return { code: "IMPORT_REVIEW_STATISTICS", action: "stats", batchId, sessionId, methods: ["GET"] };
  if (child === "rows") return { code: "IMPORT_REVIEW_ROWS", action: "rows", batchId, sessionId, methods: ["GET"] };
  if (child === "bulk-decision") return { code: "IMPORT_REVIEW_BULK_DECISION", action: "bulk", batchId, sessionId, methods: ["POST"] };
  if (child === "validate") return { code: "IMPORT_REVIEW_VALIDATE", action: "validate", batchId, sessionId, methods: ["GET"] };
  if (child === "finalize") return { code: "IMPORT_REVIEW_FINALIZE", action: "finalize", batchId, sessionId, methods: ["POST"] };
  if (child === "finalization") return { code: "IMPORT_REVIEW_PROGRESS", action: "progress", batchId, sessionId, methods: ["GET"] };
  if (child === "finalization/retry") return { code: "IMPORT_REVIEW_RETRY", action: "retry", batchId, sessionId, methods: ["POST"] };
  const row = child.match(/^rows\/([1-9][0-9]*)(?:\/(.*))?$/);
  if (!row) return null;
  const rowId = Number(row[1]);
  if (!row[2]) return { code: "IMPORT_REVIEW_ROW", action: "row", batchId, sessionId, rowId, methods: ["GET"] };
  if (row[2] === "field-overrides") return { code: "IMPORT_REVIEW_FIELD_OVERRIDE", action: "field", batchId, sessionId, rowId, methods: ["POST"] };
  if (row[2] === "attribute-overrides") return { code: "IMPORT_REVIEW_ATTRIBUTE_OVERRIDE", action: "attribute", batchId, sessionId, rowId, methods: ["POST"] };
  if (row[2] === "decision") return { code: "IMPORT_REVIEW_ROW_DECISION", action: "decision", batchId, sessionId, rowId, methods: ["POST"] };
  const issue = row[2].match(/^issues\/([1-9][0-9]*)\/resolution$/);
  if (issue) return { code: "IMPORT_REVIEW_ISSUE_RESOLUTION", action: "issue", batchId, sessionId, rowId, issueId: Number(issue[1]), methods: ["POST"] };
  return null;
}

async function readBody(request: Request): Promise<Readonly<{ value: Record<string, unknown>; digest: string }>> {
  const text = await request.text();
  if (!text || Buffer.byteLength(text) > 256 * 1024) throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { value, digest: reviewRequestDigest(value) };
  } catch {
    throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON 对象", 400);
  }
}

function assertQuery(url: URL, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  const unknown = [...url.searchParams.keys()].find((key) => !keys.has(key));
  if (unknown) throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

async function failureAudit(dependencies: Dependencies, route: Route, error: MaterialImportReviewError): Promise<void> {
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,'IMPORT_REVIEW_REQUEST_FAILED',$2,$3,'failed',$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, { batch_id: route.batchId, review_session_id: route.sessionId ?? null, review_row_id: route.rowId ?? null }, dependencies.requestId, route.code, error.code]).catch(() => undefined);
}

export async function handleSelfhostMaterialImportReviewApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  try {
    if (!route.methods.includes(request.method)) throw new MaterialImportReviewError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    const service = new MaterialImportReviewService(new PostgresMaterialImportReviewRepository(dependencies.pool), dependencies.queue);
    if (request.method === "POST") {
      dependencies.requireCsrf();
      const key = request.headers.get("Idempotency-Key") ?? "";
      if (!key) throw new MaterialImportReviewError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
      const body = await readBody(request);
      const context = {
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        idempotencyKey: key,
        requestDigest: body.digest,
        routeScope: `${route.code}:${route.batchId}:${route.sessionId ?? 0}:${route.rowId ?? 0}:${route.issueId ?? 0}`,
      };
      const result = route.action === "create"
        ? await service.create(route.batchId, context, body.value)
        : route.action === "field"
          ? await service.fieldOverride(route.batchId, route.sessionId!, route.rowId!, context, body.value)
          : route.action === "attribute"
            ? await service.attributeOverride(route.batchId, route.sessionId!, route.rowId!, context, body.value)
            : route.action === "decision"
              ? await service.decide(route.batchId, route.sessionId!, route.rowId!, context, body.value)
              : route.action === "issue"
                ? await service.resolveIssue(route.batchId, route.sessionId!, route.rowId!, route.issueId!, context, body.value)
                : route.action === "bulk"
                  ? await service.bulkDecide(route.batchId, route.sessionId!, context, body.value)
                  : route.action === "finalize"
                    ? await service.finalize(route.batchId, route.sessionId!, context, body.value)
                    : await service.retry(route.batchId, route.sessionId!, context, body.value);
      return response({ ...result.data, operation_id: result.operationId, request_id: dependencies.requestId }, result.statusCode, dependencies.requestId, result.replayed ? { "Idempotency-Replayed": "true" } : undefined);
    }
    if (route.action === "current") {
      assertQuery(url, []);
      return response({ ...(await service.current(route.batchId, dependencies.actor)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "history") {
      assertQuery(url, ["after_version", "limit"]);
      const data = await service.history(route.batchId, dependencies.actor, integer(url.searchParams.get("after_version"), "after_version", 0, 0, Number.MAX_SAFE_INTEGER), integer(url.searchParams.get("limit"), "limit", 20, 1, 50));
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "materials") {
      assertQuery(url, ["q", "page", "page_size"]);
      const data = await service.searchActiveMaterials(dependencies.actor, url.searchParams.get("q") ?? "", integer(url.searchParams.get("page"), "page", 1, 1, 1_000_000), integer(url.searchParams.get("page_size"), "page_size", 20, 1, 50));
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "stats") {
      assertQuery(url, []);
      return response({ ...(await service.statistics(route.batchId, route.sessionId!, dependencies.actor)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "rows") {
      assertQuery(url, ["after_id", "limit", "row_status", "disposition", "issue_level"]);
      const rowStatus = url.searchParams.get("row_status") || undefined;
      const disposition = url.searchParams.get("disposition") || undefined;
      const issueLevel = url.searchParams.get("issue_level") || undefined;
      if (rowStatus && !["PENDING", "REVIEWED", "FINALIZING", "COMPLETED", "FAILED"].includes(rowStatus)) throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", "row_status 无效", 400);
      if (disposition && !["PENDING", "KEEP", "EXCLUDE", "BIND_EXISTING", "CREATE_DRAFT"].includes(disposition)) throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", "disposition 无效", 400);
      if (issueLevel && !["ERROR", "WARNING"].includes(issueLevel)) throw new MaterialImportReviewError("REQUEST_VALIDATION_FAILED", "issue_level 无效", 400);
      const data = await service.rows({ batchId: route.batchId, sessionId: route.sessionId!, actor: dependencies.actor, afterId: integer(url.searchParams.get("after_id"), "after_id", 0, 0, Number.MAX_SAFE_INTEGER), limit: integer(url.searchParams.get("limit"), "limit", 50, 1, 100), rowStatus, disposition, issueLevel });
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "row") {
      assertQuery(url, []);
      return response({ data: await service.row(route.batchId, route.sessionId!, route.rowId!, dependencies.actor), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "validate") {
      assertQuery(url, []);
      return response({ ...(await service.validate(route.batchId, route.sessionId!, dependencies.actor)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    assertQuery(url, []);
    return response({ ...(await service.progress(route.batchId, route.sessionId!, dependencies.actor)), request_id: dependencies.requestId }, 200, dependencies.requestId);
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown; currentVersion?: unknown };
    const known = error instanceof MaterialImportReviewError
      ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new MaterialImportReviewError(String(compatible.code), typeof compatible.message === "string" ? compatible.message : "请求失败", Number(compatible.status), { currentVersion: Number.isSafeInteger(compatible.currentVersion) ? Number(compatible.currentVersion) : undefined })
        : new MaterialImportReviewError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
    await failureAudit(dependencies, route, known);
    console.error(JSON.stringify({ level: "error", event: "material_import_review_api_failed", request_id: dependencies.requestId, route_code: route.code, code: known.code }));
    return response({
      error: { code: known.code, message: known.message, request_id: dependencies.requestId, ...(known.currentVersion == null ? {} : { current_version: known.currentVersion }) },
      code: known.code,
      message: known.message,
      request_id: dependencies.requestId,
      ...(known.currentVersion == null ? {} : { current_version: known.currentVersion }),
    }, known.status, dependencies.requestId);
  }
}
