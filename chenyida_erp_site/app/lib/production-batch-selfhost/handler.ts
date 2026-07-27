import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { ProductionError, mapProductionError } from "../production-selfhost/errors.ts";
import { ProductionRepository } from "../production-selfhost/repository.ts";
import { ProductionBatchService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const can = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const need = (actor: IdentityActor, permission: string) => { if (!can(actor, permission)) throw new ProductionError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replay = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replay) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
async function body(request: Request) { const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new ProductionError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB"); let value: unknown; try { value = JSON.parse(raw); } catch { throw new ProductionError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductionError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象"); const forbidden = ["batch_code", "batch_set_code", "canonical_digest", "status", "created_by", "released_by", "request_id", "actor", "version"].find((key) => key in (value as Record<string, unknown>)); if (forbidden) throw new ProductionError("SERVER_MANAGED_FIELD_FORBIDDEN", `${forbidden} 由服务端维护`, 422); return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") }; }
function meta(request: Request, deps: Dependencies, action: string, requestDigest: string) { const key = request.headers.get("idempotency-key") || ""; if (key.length < 8 || key.length > 200) throw new ProductionError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key"); const route = new URL(request.url).pathname; return { actor: deps.actor, requestId: deps.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${deps.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest, method: request.method, route, action }; }

export async function handleProductionBatchApi(request: Request, deps: Dependencies): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  const setBatches = path.match(/^\/api\/production\/batch-sets\/([1-9]\d*)\/batches$/), setAction = path.match(/^\/api\/production\/batch-sets\/([1-9]\d*)\/(release|cancel)$/), batchDetail = path.match(/^\/api\/production\/batches\/([1-9]\d*)$/), batchDelete = path.match(/^\/api\/production\/batches\/([1-9]\d*)\/delete$/), batchWip = path.match(/^\/api\/production\/batches\/([1-9]\d*)\/wip$/), genealogy = path.match(/^\/api\/production\/batches\/([1-9]\d*)\/genealogy$/), summary = path.match(/^\/api\/work-orders\/([1-9]\d*)\/batch-summary$/);
  if (!["/api/production/batch-sets", "/api/production/batches"].includes(path) && !setBatches && !setAction && !batchDetail && !batchDelete && !batchWip && !genealogy && !summary) return null;
  const repository = new ProductionRepository(deps.pool), service = new ProductionBatchService(repository); let action = "PRODUCTION_BATCH_REQUEST";
  try {
    if (request.method === "GET") {
      need(deps.actor, "production.batch.read");
      if (path === "/api/production/batch-sets") { const result = await service.listSets(); return response({ rows: result.rows, data: result.rows, request_id: deps.requestId }, 200, deps.requestId); }
      if (path === "/api/production/batches") { const result = await service.list({ code: url.searchParams.get("code") || undefined, workOrderId: url.searchParams.get("work_order_id") ? Number(url.searchParams.get("work_order_id")) : undefined, status: url.searchParams.get("batch_set_status") || undefined }); return response({ rows: result.rows, data: result.rows, request_id: deps.requestId }, 200, deps.requestId); }
      if (batchDetail) return response({ data: await service.detail(Number(batchDetail[1])), request_id: deps.requestId }, 200, deps.requestId);
      if (batchWip) return response({ data: await service.wip(Number(batchWip[1])), request_id: deps.requestId }, 200, deps.requestId);
      if (genealogy) return response({ data: await service.genealogy(Number(genealogy[1])), request_id: deps.requestId }, 200, deps.requestId);
      if (summary) return response({ data: await service.workOrderSummary(Number(summary[1])), request_id: deps.requestId }, 200, deps.requestId);
      throw new ProductionError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    }
    if (!["POST", "PATCH"].includes(request.method)) throw new ProductionError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    deps.requireCsrf(); need(deps.actor, "production.batch.manage"); const parsed = await body(request); let result;
    if (path === "/api/production/batch-sets" && request.method === "POST") { action = "PRODUCTION_BATCH_SET_CREATED"; result = await service.createSet(meta(request, deps, action, parsed.digest), parsed.value); }
    else if (setBatches && request.method === "POST") { action = "PRODUCTION_BATCH_ADDED"; result = await service.addBatch(Number(setBatches[1]), meta(request, deps, action, parsed.digest), parsed.value); }
    else if (batchDetail && request.method === "PATCH") { action = "PRODUCTION_BATCH_UPDATED"; result = await service.updateBatch(Number(batchDetail[1]), meta(request, deps, action, parsed.digest), parsed.value); }
    else if (batchDelete && request.method === "POST") { action = "PRODUCTION_BATCH_DELETED"; result = await service.deleteBatch(Number(batchDelete[1]), meta(request, deps, action, parsed.digest), parsed.value); }
    else if (setAction) { action = `PRODUCTION_BATCH_SET_${setAction[2].toUpperCase()}`; result = setAction[2] === "release" ? await service.release(Number(setAction[1]), meta(request, deps, action, parsed.digest), parsed.value) : await service.cancel(Number(setAction[1]), meta(request, deps, action, parsed.digest), parsed.value); }
    else throw new ProductionError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, deps.requestId, result.replayed);
  } catch (error) { const mapped = mapProductionError(error); await repository.failureAudit(deps.actor.username, deps.requestId, action, mapped.code); return response({ error: { code: mapped.code, message: mapped.message, details: mapped.details, request_id: deps.requestId }, code: mapped.code, message: mapped.message, details: mapped.details, request_id: deps.requestId }, mapped.status, deps.requestId); }
}
