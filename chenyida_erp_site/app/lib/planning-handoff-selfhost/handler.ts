import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { PlanningHandoffError, mapPlanningHandoffError } from "./errors.ts";
import { PlanningHandoffRepository } from "./repository.ts";
import { PlanningHandoffService } from "./service.ts";
import { canonicalDigest, positiveId } from "./validation.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["status", "package_digest", "package_version_no", "prepared_by", "submitted_by", "accepted_by", "returned_by", "request_id", "calculated_gross_quantity", "specification_snapshot"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: canonicalDigest(value) };
}

function mutationMeta(request: Request, dependencies: Dependencies, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) throw new PlanningHandoffError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  const route = new URL(request.url).pathname; const rawKeyDigest = createHash("sha256").update(key).digest("hex");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(JSON.stringify([dependencies.actor.username, request.method, route, rawKeyDigest])).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handlePlanningHandoffApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const resolutions = path.match(/^\/api\/projects\/([1-9]\d*)\/requirement-resolutions$/);
  const packages = path.match(/^\/api\/projects\/([1-9]\d*)\/planning-packages$/);
  const packageDetail = path.match(/^\/api\/planning-packages\/([1-9]\d*)$/);
  const packageAction = path.match(/^\/api\/planning-packages\/([1-9]\d*)\/(submit|accept|return)$/);
  if (!resolutions && !packages && !packageDetail && !packageAction && path !== "/api/planning-handoffs") return null;
  const repository = new PlanningHandoffRepository(dependencies.pool); const service = new PlanningHandoffService(repository); let action = "PLANNING_HANDOFF_REQUEST";
  try {
    if (request.method === "GET") {
      requirePermission(dependencies.actor, "planning.read");
      if (resolutions) return response({ data: await service.resolutions(dependencies.actor, positiveId(resolutions[1], "projectId")), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (packages) return response({ data: await service.listPackages(dependencies.actor, positiveId(packages[1], "projectId")), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (packageDetail) return response({ data: await service.detail(dependencies.actor, positiveId(packageDetail[1], "packageId")), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (path === "/api/planning-handoffs") { const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const pageSize = pageValue(url.searchParams.get("page_size"), "page_size", 20, 100); const result = await service.queue(dependencies.actor, page, pageSize, url.searchParams.get("status") || undefined); return response({ data: result.rows, rows: result.rows, pagination: result.pagination, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      throw new PlanningHandoffError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    }
    if (request.method !== "POST") throw new PlanningHandoffError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (resolutions) { action = "PROJECT_REQUIREMENTS_RESOLVED"; requirePermission(dependencies.actor, "planning.prepare"); result = await service.saveResolutions(positiveId(resolutions[1], "projectId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (packages) { action = "PLANNING_PACKAGE_PREPARED"; requirePermission(dependencies.actor, "planning.prepare"); result = await service.createPackage(positiveId(packages[1], "projectId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (packageAction?.[2] === "submit") { action = "PLANNING_PACKAGE_SUBMITTED"; requirePermission(dependencies.actor, "planning.submit"); result = await service.submit(positiveId(packageAction[1], "packageId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (packageAction?.[2] === "accept") { action = "PLANNING_PACKAGE_ACCEPTED"; requirePermission(dependencies.actor, "planning.accept"); result = await service.accept(positiveId(packageAction[1], "packageId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (packageAction?.[2] === "return") { action = "PLANNING_PACKAGE_RETURNED"; requirePermission(dependencies.actor, "planning.accept"); result = await service.returnToProject(positiveId(packageAction[1], "packageId"), mutationMeta(request, dependencies, action, parsed.digest), parsed.value); }
    else throw new PlanningHandoffError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapPlanningHandoffError(error); await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "planning_handoff_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
