import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { MaterialRequirementError, mapMaterialRequirementError } from "./errors.ts";
import { MaterialRequirementRepository } from "./repository.ts";
import { MaterialRequirementService } from "./service.ts";
import { canonicalDigest, positiveId } from "./validation.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new MaterialRequirementError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 64 * 1024) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 64 KiB"); let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["status", "plan_version_no", "calculation_digest", "source_package_digest", "gross_requirement", "stock_allocated", "inbound_allocated", "net_purchase_requirement", "request_code", "submitted_by", "accepted_by", "returned_by", "request_id"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`); return { value: value as Record<string, unknown>, digest: canonicalDigest(value) };
}

function mutationMeta(request: Request, dependencies: Dependencies, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) throw new MaterialRequirementError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key"); const route = new URL(request.url).pathname; const rawKeyDigest = createHash("sha256").update(key).digest("hex");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(JSON.stringify([dependencies.actor.username, request.method, route, rawKeyDigest])).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handleMaterialRequirementApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const packagePlans = path.match(/^\/api\/planning-packages\/([1-9]\d*)\/material-requirement-plans$/);
  const planDetail = path.match(/^\/api\/material-requirement-plans\/([1-9]\d*)$/);
  const planSubmit = path.match(/^\/api\/material-requirement-plans\/([1-9]\d*)\/submit$/);
  const requestDetail = path.match(/^\/api\/purchase-requests\/([1-9]\d*)$/);
  const requestAction = path.match(/^\/api\/purchase-requests\/([1-9]\d*)\/(accept|return)$/);
  if (!packagePlans && !planDetail && !planSubmit && !requestDetail && !requestAction && path !== "/api/purchase-requests") return null;
  const repository = new MaterialRequirementRepository(dependencies.pool); const service = new MaterialRequirementService(repository); let action = "MATERIAL_REQUIREMENT_REQUEST";
  try {
    if (request.method === "GET") {
      if (packagePlans) { requirePermission(dependencies.actor, "planning.requirement.read"); return response({ data: await service.packagePlans(dependencies.actor, positiveId(packagePlans[1], "packageId")), request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (planDetail) { requirePermission(dependencies.actor, "planning.requirement.read"); return response({ data: await service.planDetail(dependencies.actor, positiveId(planDetail[1], "planId")), request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (requestDetail) { requirePermission(dependencies.actor, "planning.purchase_request.read"); return response({ data: await service.requestDetail(dependencies.actor, positiveId(requestDetail[1], "purchaseRequestId")), request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (path === "/api/purchase-requests") { requirePermission(dependencies.actor, "planning.purchase_request.read"); const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const pageSize = pageValue(url.searchParams.get("page_size"), "page_size", 20, 100); const result = await service.requestQueue(dependencies.actor, page, pageSize, url.searchParams.get("status") || undefined); return response({ data: result.rows, rows: result.rows, pagination: result.pagination, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      throw new MaterialRequirementError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    }
    if (request.method !== "POST") throw new MaterialRequirementError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405); dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (packagePlans) { action = "MATERIAL_REQUIREMENT_GENERATED"; requirePermission(dependencies.actor, "planning.requirement.prepare"); result = await service.generate(positiveId(packagePlans[1], "packageId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (planSubmit) { action = "MATERIAL_REQUIREMENT_SUBMITTED"; requirePermission(dependencies.actor, "planning.requirement.submit"); result = await service.submit(positiveId(planSubmit[1], "planId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (requestAction?.[2] === "accept") { action = "PURCHASE_REQUEST_ACCEPTED"; requirePermission(dependencies.actor, "planning.purchase_request.decide"); result = await service.accept(positiveId(requestAction[1], "purchaseRequestId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (requestAction?.[2] === "return") { action = "PURCHASE_REQUEST_RETURNED"; requirePermission(dependencies.actor, "planning.purchase_request.decide"); result = await service.returnToPlanning(positiveId(requestAction[1], "purchaseRequestId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else throw new MaterialRequirementError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapMaterialRequirementError(error); await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code); console.error(JSON.stringify({ level: "error", event: "material_requirement_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
