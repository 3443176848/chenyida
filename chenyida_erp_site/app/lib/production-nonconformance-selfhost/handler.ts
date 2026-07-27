import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { QualityError, mapQualityError } from "../quality-selfhost/errors.ts";
import { QualityRepository } from "../quality-selfhost/repository.ts";
import { ProductionNonconformanceService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new QualityError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new QualityError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new QualityError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new QualityError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QualityError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["username", "role", "permissions", "created_by", "request_id", "operation_id", "ncr_code", "request_code", "status", "canonical_digest", "work_order_id", "snapshot_operation_id", "work_center_id", "material_id", "unit_id", "failed_qty", "active_rework_qty", "final_scrap_qty", "unresolved_qty"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new QualityError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") };
}

function mutationMeta(request: Request, dependencies: Dependencies, route: string, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new QualityError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handleProductionNonconformanceApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  const ncrDetail = path.match(/^\/api\/quality\/nonconformances\/([1-9]\d*)$/);
  const targetOptions = path.match(/^\/api\/quality\/nonconformances\/([1-9]\d*)\/target-operations$/);
  const createNcr = path.match(/^\/api\/quality\/inspections\/([1-9]\d*)\/nonconformance$/);
  const createDraft = path.match(/^\/api\/quality\/nonconformances\/([1-9]\d*)\/rework-requests$/);
  const scrap = path.match(/^\/api\/quality\/nonconformances\/([1-9]\d*)\/scrap-dispositions$/);
  const qualityRequest = path.match(/^\/api\/quality\/rework-requests\/([1-9]\d*)$/);
  const submit = path.match(/^\/api\/quality\/rework-requests\/([1-9]\d*)\/submit$/);
  const cancel = path.match(/^\/api\/quality\/rework-requests\/([1-9]\d*)\/cancel$/);
  const decision = path.match(/^\/api\/production\/rework-requests\/([1-9]\d*)\/(accept|return)$/);
  const fixed = ["/api/quality/nonconformances", "/api/quality/rework-requests", "/api/production/rework-requests"];
  if (!fixed.includes(path) && !ncrDetail && !targetOptions && !createNcr && !createDraft && !scrap && !qualityRequest && !submit && !cancel && !decision) return null;
  const repository = new QualityRepository(dependencies.pool), service = new ProductionNonconformanceService(dependencies.pool, repository); let action = "NONCONFORMANCE_REQUEST";
  try {
    if (request.method === "GET") {
      const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000), size = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100), offset = (page - 1) * size;
      if (path === "/api/production/rework-requests") { requirePermission(dependencies.actor, "production.rework_request.read"); const result = await service.listRequests(size, offset, url.searchParams.get("status") || undefined); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      requirePermission(dependencies.actor, path.includes("rework-requests") ? "quality.rework_request.read" : "quality.nonconformance.read");
      if (ncrDetail) return response({ data: await service.get(Number(ncrDetail[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (targetOptions) { const result = await service.targetOptions(Number(targetOptions[1])); return response({ rows: result.rows, data: result.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      const result = path === "/api/quality/rework-requests" ? await service.listRequests(size, offset, url.searchParams.get("status") || undefined) : await service.list(size, offset, url.searchParams.get("status") || undefined);
      return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (!(["POST", "PATCH"].includes(request.method))) throw new QualityError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (createNcr && request.method === "POST") { action = "PRODUCTION_NONCONFORMANCE_CREATED"; requirePermission(dependencies.actor, "quality.nonconformance.create"); result = await service.createNcr(Number(createNcr[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (createDraft && request.method === "POST") { action = "PRODUCTION_REWORK_REQUEST_CREATED"; requirePermission(dependencies.actor, "quality.rework_request.create"); result = await service.createDraft(Number(createDraft[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (qualityRequest && request.method === "PATCH") { action = "PRODUCTION_REWORK_REQUEST_UPDATED"; requirePermission(dependencies.actor, "quality.rework_request.create"); result = await service.updateDraft(Number(qualityRequest[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (submit && request.method === "POST") { action = "PRODUCTION_REWORK_REQUEST_SUBMITTED"; requirePermission(dependencies.actor, "quality.rework_request.submit"); result = await service.submit(Number(submit[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (cancel && request.method === "POST") { action = "PRODUCTION_REWORK_REQUEST_CANCELLED"; requirePermission(dependencies.actor, "quality.rework_request.create"); result = await service.cancelDraft(Number(cancel[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (decision && request.method === "POST") { action = decision[2] === "accept" ? "PRODUCTION_REWORK_REQUEST_ACCEPTED" : "PRODUCTION_REWORK_REQUEST_RETURNED"; requirePermission(dependencies.actor, "production.rework_request.decide"); result = await service.decide(Number(decision[1]), decision[2] === "accept" ? "ACCEPT" : "RETURN", mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (scrap && request.method === "POST") { action = "PRODUCTION_NONCONFORMANCE_SCRAPPED"; requirePermission(dependencies.actor, "quality.nonconformance.scrap"); result = await service.scrap(Number(scrap[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else throw new QualityError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapQualityError(error); if (UUID.test(dependencies.requestId)) await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "production_nonconformance_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
