import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { MaterialWorkflowError } from "./errors.ts";
import { PostgresMaterialRepository } from "./repository.ts";
import { MaterialWorkflowService } from "./service.ts";
import type { MaterialActor } from "./types.ts";
import { assertNoIdentityFields } from "./validation.ts";

type Dependencies = Readonly<{
  pool: Pool;
  actor: MaterialActor;
  requestId: string;
  requireCsrf: () => void;
}>;
type Route = Readonly<{
  code: string;
  permission: string;
  methods: readonly string[];
  materialId?: number;
  action?: "detail" | "versions" | "change-logs" | "audit-logs" | "submit" | "approve" | "reject";
}>;

const STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "ACTIVE", "FROZEN", "INACTIVE"]);
const SOURCE_TYPES = new Set(["MANUAL", "LEGACY_D1", "LEGACY_SQLITE", "GOVERNANCE_TEMPLATE", "API"]);
const MATERIAL_SORTS = new Set(["updated_at_desc", "updated_at_asc", "created_at_desc", "created_at_asc", "standard_name_asc", "standard_name_desc", "material_code_asc", "material_code_desc"]);
const REVIEW_SORTS = new Set(["submitted_at_desc", "submitted_at_asc", "standard_name_asc", "standard_name_desc"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit) {
  const values = new Headers(headers); values.set("Cache-Control", "no-store"); values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function failure(error: MaterialWorkflowError, requestId: string) {
  const details = error.details.length ? { details: error.details } : {};
  return response({ error: { code: error.code, message: error.message, request_id: requestId, ...details }, code: error.code, message: error.message, request_id: requestId }, error.status, requestId);
}

function routeFor(path: string): Route | null {
  if (path === "/api/material-master/categories") return { code: "MATERIAL_CATEGORY_LIST", permission: "material.read", methods: ["GET"] };
  const category = path.match(/^\/api\/material-master\/categories\/([1-9][0-9]*)\/schema$/);
  if (category) return { code: "MATERIAL_CATEGORY_SCHEMA", permission: "material.read", methods: ["GET"], materialId: Number(category[1]) };
  if (path === "/api/material-master/materials") return { code: "MATERIAL_LIST", permission: "material.read", methods: ["GET"] };
  const materialHistory = path.match(/^\/api\/material-master\/materials\/([1-9][0-9]*)\/(versions|change-logs|audit-logs)$/);
  if (materialHistory) return { code: `MATERIAL_${materialHistory[2].replace("-", "_").toUpperCase()}`, permission: materialHistory[2] === "audit-logs" ? "material.audit.read" : "material.read", methods: ["GET"], materialId: Number(materialHistory[1]), action: materialHistory[2] as Route["action"] };
  const material = path.match(/^\/api\/material-master\/materials\/([1-9][0-9]*)$/);
  if (material) return { code: "MATERIAL_DETAIL", permission: "material.read", methods: ["GET"], materialId: Number(material[1]), action: "detail" };
  if (path === "/api/material-master/drafts") return { code: "MATERIAL_DRAFT_COLLECTION", permission: "material.read", methods: ["GET", "POST"] };
  const draft = path.match(/^\/api\/material-master\/drafts\/([1-9][0-9]*)$/);
  if (draft) return { code: "MATERIAL_DRAFT_DETAIL", permission: "material.read", methods: ["GET", "PATCH"], materialId: Number(draft[1]), action: "detail" };
  const mutation = path.match(/^\/api\/material-master\/drafts\/([1-9][0-9]*)\/(submit|approve|reject)$/);
  if (mutation) return { code: `MATERIAL_DRAFT_${mutation[2].toUpperCase()}`, permission: mutation[2] === "submit" ? "material.draft.submit" : `material.review.${mutation[2]}`, methods: ["POST"], materialId: Number(mutation[1]), action: mutation[2] as Route["action"] };
  if (path === "/api/material-master/review-queue") return { code: "MATERIAL_REVIEW_QUEUE", permission: "material.review.queue", methods: ["GET"] };
  return null;
}

function allowed(actor: MaterialActor, permission: string) { return actor.permissions.includes("*") || actor.permissions.includes(permission); }
function forbidden(message = "当前账号没有此操作权限") { throw new MaterialWorkflowError("FORBIDDEN", message, 403); }

function positiveInteger(value: string | null, field: string, fallback?: number, maximum = 1_000_000): number {
  if ((value === null || value === "") && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`, 400);
  return parsed;
}

function assertQuery(url: URL, allowedKeys: ReadonlySet<string>) {
  const unknown = [...url.searchParams.keys()].find((key) => !allowedKeys.has(key));
  if (unknown) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

function dateValue(value: string | null, field: string, nextDay = false): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", `${field} 日期格式无效`, 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", `${field} 日期无效`, 400);
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

async function readBody(request: Request): Promise<Readonly<{ value: Record<string, unknown>; digest: string }>> {
  const text = await request.text();
  if (!text || Buffer.byteLength(text) > 256 * 1024) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象", 400);
  assertNoIdentityFields(value);
  const canonical = JSON.stringify(stable(value));
  return { value: value as Record<string, unknown>, digest: createHash("sha256").update(canonical).digest("hex") };
}

function assertKeys(body: Record<string, unknown>, keys: readonly string[]) {
  const allowedKeys = new Set(keys); const unknown = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknown) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", `请求正文包含未知字段：${unknown}`, 400);
}

async function writeFailureAudit(dependencies: Dependencies, route: Route, error: MaterialWorkflowError) {
  if (!UUID.test(dependencies.requestId)) return;
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,material_id,error_code,retention_until)
    values ($1,'MATERIAL_REQUEST_FAILED','{}'::jsonb,$2,'failed',$3,$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, dependencies.requestId, route.code, route.materialId ?? null, error.code]).catch(() => undefined);
}

export async function handleSelfhostMaterialApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const route = routeFor(url.pathname); if (!route) return null;
  try {
    if (!route.methods.includes(request.method)) throw new MaterialWorkflowError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    const permissions = url.pathname === "/api/material-master/drafts" && request.method === "POST" ? ["material.draft.create"]
      : url.pathname.match(/\/drafts\/[1-9][0-9]*$/) && request.method === "PATCH" ? ["material.draft.edit_own", "material.draft.edit_any"] : [route.permission];
    if (!permissions.some((permission) => allowed(dependencies.actor, permission))) forbidden();
    if (request.method !== "GET" && dependencies.actor.must_change_password) forbidden("请先修改密码再执行写操作");
    const repository = new PostgresMaterialRepository(dependencies.pool); const service = new MaterialWorkflowService(repository);

    if (route.code === "MATERIAL_CATEGORY_LIST") {
      assertQuery(url, new Set(["view"])); const view = url.searchParams.get("view") || "tree";
      if (view !== "tree" && view !== "flat") throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "view 只允许 tree 或 flat", 400);
      return response({ data: await repository.categoryTree(view), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.code === "MATERIAL_CATEGORY_SCHEMA") {
      assertQuery(url, new Set()); const data = await repository.categorySchema(route.materialId!);
      if (!data) throw new MaterialWorkflowError("MATERIAL_CATEGORY_NOT_FOUND", "物料分类不存在或未启用", 404);
      return response({ data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.code === "MATERIAL_LIST") {
      const keys = new Set(["page", "page_size", "keyword", "material_status", "category_id", "category_path", "source_type", "created_by", "created_from", "created_to", "updated_from", "updated_to", "sort"]); assertQuery(url, keys);
      const materialStatus = url.searchParams.get("material_status") || undefined; if (materialStatus && !STATUSES.has(materialStatus)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "material_status 无效", 400);
      const sourceType = url.searchParams.get("source_type") || undefined; if (sourceType && !SOURCE_TYPES.has(sourceType)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "source_type 无效", 400);
      const sort = url.searchParams.get("sort") || "updated_at_desc"; if (!MATERIAL_SORTS.has(sort)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "sort 无效", 400);
      const data = await repository.listMaterials(dependencies.actor, {
        page: positiveInteger(url.searchParams.get("page"), "page", 1), pageSize: positiveInteger(url.searchParams.get("page_size"), "page_size", 20, 100),
        materialStatus, categoryId: url.searchParams.has("category_id") ? positiveInteger(url.searchParams.get("category_id"), "category_id") : undefined,
        categoryPath: url.searchParams.get("category_path") || undefined, sourceType,
        keyword: (url.searchParams.get("keyword") || "").trim().slice(0, 100) || undefined,
        createdBy: (url.searchParams.get("created_by") || "").trim().slice(0, 64) || undefined,
        createdFrom: dateValue(url.searchParams.get("created_from"), "created_from"), createdTo: dateValue(url.searchParams.get("created_to"), "created_to", true),
        updatedFrom: dateValue(url.searchParams.get("updated_from"), "updated_from"), updatedTo: dateValue(url.searchParams.get("updated_to"), "updated_to", true), sort,
      });
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "detail" && request.method === "GET") {
      assertQuery(url, new Set()); const data = await repository.detail(dependencies.actor, route.materialId!);
      if (!data || (url.pathname.includes("/drafts/") && !["DRAFT", "PENDING_REVIEW"].includes(String(data.material.material_status)))) throw new MaterialWorkflowError("MATERIAL_NOT_FOUND", "物料不存在或无权查看", 404);
      return response({ data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (["versions", "change-logs", "audit-logs"].includes(String(route.action))) {
      assertQuery(url, new Set(["page", "page_size"]));
      const data = await repository.history(dependencies.actor, route.materialId!, route.action as "versions" | "change-logs" | "audit-logs", { page: positiveInteger(url.searchParams.get("page"), "page", 1), pageSize: positiveInteger(url.searchParams.get("page_size"), "page_size", 20, 50) });
      if (!data) throw new MaterialWorkflowError("MATERIAL_NOT_FOUND", "物料不存在或无权查看", 404);
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (url.pathname === "/api/material-master/drafts" && request.method === "GET") {
      const keys = new Set(["page", "page_size", "material_status", "category_id", "source_type", "keyword", "created_by", "created_from", "created_to"]); assertQuery(url, keys);
      const materialStatus = url.searchParams.get("material_status") || "DRAFT"; if (!new Set(["DRAFT", "PENDING_REVIEW"]).has(materialStatus)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "草稿状态只允许 DRAFT 或 PENDING_REVIEW", 400);
      const sourceType = url.searchParams.get("source_type") || undefined; if (sourceType && !SOURCE_TYPES.has(sourceType)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "source_type 无效", 400);
      const data = await repository.listDrafts(dependencies.actor, { page: positiveInteger(url.searchParams.get("page"), "page", 1), pageSize: positiveInteger(url.searchParams.get("page_size"), "page_size", 20, 100), materialStatus, categoryId: url.searchParams.has("category_id") ? positiveInteger(url.searchParams.get("category_id"), "category_id") : undefined, sourceType, keyword: url.searchParams.get("keyword") || undefined, createdBy: url.searchParams.get("created_by") || undefined, createdFrom: dateValue(url.searchParams.get("created_from"), "created_from"), createdTo: dateValue(url.searchParams.get("created_to"), "created_to", true) });
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.code === "MATERIAL_REVIEW_QUEUE") {
      const keys = new Set(["page", "page_size", "category_id", "source_type", "creator", "submitted_from", "submitted_to", "keyword", "sort"]); assertQuery(url, keys);
      const sourceType = url.searchParams.get("source_type") || undefined; if (sourceType && !SOURCE_TYPES.has(sourceType)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "source_type 无效", 400);
      const sort = url.searchParams.get("sort") || "submitted_at_desc"; if (!REVIEW_SORTS.has(sort)) throw new MaterialWorkflowError("REQUEST_VALIDATION_FAILED", "sort 无效", 400);
      const data = await repository.reviewQueue({ page: positiveInteger(url.searchParams.get("page"), "page", 1), pageSize: positiveInteger(url.searchParams.get("page_size"), "page_size", 20, 100), categoryId: url.searchParams.has("category_id") ? positiveInteger(url.searchParams.get("category_id"), "category_id") : undefined, sourceType, creator: url.searchParams.get("creator") || undefined, submittedFrom: dateValue(url.searchParams.get("submitted_from"), "submitted_from"), submittedTo: dateValue(url.searchParams.get("submitted_to"), "submitted_to", true), keyword: url.searchParams.get("keyword") || undefined, sort });
      return response({ ...data, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }

    dependencies.requireCsrf();
    const idempotencyKey = request.headers.get("Idempotency-Key") || "";
    if (!idempotencyKey) throw new MaterialWorkflowError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
    const parsed = await readBody(request);
    const context = { actor: dependencies.actor, requestId: dependencies.requestId, idempotencyKey, requestDigest: parsed.digest, routeScope: route.code };
    let result;
    if (url.pathname === "/api/material-master/drafts" && request.method === "POST") result = await service.createDraft(context, parsed.value);
    else if (route.code === "MATERIAL_DRAFT_DETAIL" && request.method === "PATCH") result = await service.updateDraft(context, route.materialId!, parsed.value);
    else if (route.action === "submit") { assertKeys(parsed.value, ["expected_version", "submit_comment"]); result = await service.submitDraft(context, route.materialId!, parsed.value); }
    else if (route.action === "approve") { assertKeys(parsed.value, ["expected_version", "review_comment"]); result = await service.approveDraft(context, route.materialId!, parsed.value); }
    else if (route.action === "reject") { assertKeys(parsed.value, ["expected_version", "reason"]); result = await service.rejectDraft(context, route.materialId!, parsed.value); }
    else throw new MaterialWorkflowError("NOT_FOUND", "接口不存在", 404);
    const headers = result.replayed ? { "Idempotency-Replayed": "true" } : undefined;
    return response({ data: result.data, operation_id: result.operationId, request_id: dependencies.requestId }, result.statusCode, dependencies.requestId, headers);
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown };
    const known = error instanceof MaterialWorkflowError ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new MaterialWorkflowError(compatible.code, typeof compatible.message === "string" ? compatible.message : "请求失败", Number(compatible.status))
        : new MaterialWorkflowError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
    await writeFailureAudit(dependencies, route, known);
    console.error(JSON.stringify({ level: "error", event: "material_api_request_failed", request_id: dependencies.requestId, route_code: route.code, code: known.code }));
    return failure(known, dependencies.requestId);
  }
}
