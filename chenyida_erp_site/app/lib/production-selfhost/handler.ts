import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { ProductionError, mapProductionError } from "./errors.ts";
import { id } from "./rules.ts";
import { ProductionRepository } from "./repository.ts";
import { ProductionService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new ProductionError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };
async function readBody(request: Request) { const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new ProductionError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB"); let value: unknown; try { value = JSON.parse(raw); } catch { throw new ProductionError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductionError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象"); const forbidden = ["username", "role", "permissions", "created_by", "createdBy", "request_id", "status", "work_order_code", "reported_qty_total", "completed_qty", "net_issued_qty", "inventory_adjustment_id", "inventory_ledger_entry_id"].find((key) => key in (value as Record<string, unknown>)); if (forbidden) throw new ProductionError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`); return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") }; }
function mutationMeta(request: Request, dependencies: Dependencies, route: string, action: string, requestDigest: string) { const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new ProductionError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key"); return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest, method: request.method, route, action }; }

export async function handleProductionApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const workOrder = path.match(/^\/api\/work-orders\/([1-9]\d*)$/); const release = path.match(/^\/api\/work-orders\/([1-9]\d*)\/release$/); const close = path.match(/^\/api\/work-orders\/([1-9]\d*)\/close$/); const cancel = path.match(/^\/api\/work-orders\/([1-9]\d*)\/cancel$/); const snapshot = path.match(/^\/api\/work-orders\/([1-9]\d*)\/bom-snapshot$/); const progress = path.match(/^\/api\/work-orders\/([1-9]\d*)\/progress$/);
  const issue = path.match(/^\/api\/production\/material-issues\/([1-9]\d*)$/); const returned = path.match(/^\/api\/production\/material-returns\/([1-9]\d*)$/); const report = path.match(/^\/api\/production\/reports\/([1-9]\d*)$/); const completion = path.match(/^\/api\/production\/completions\/([1-9]\d*)$/);
  const fixed = ["/api/work-orders", "/api/work-orders/from-bom", "/api/work-order-materials", "/api/production-reports", "/api/work-orders/issue-materials", "/api/work-orders/complete", "/api/production/material-requirements", "/api/production/material-issues", "/api/production/material-returns", "/api/production/reports", "/api/production/completions"];
  if (!fixed.includes(path) && !workOrder && !release && !close && !cancel && !snapshot && !progress && !issue && !returned && !report && !completion) return null;
  const repository = new ProductionRepository(dependencies.pool); const service = new ProductionService(repository); let action = "PRODUCTION_REQUEST";
  try {
    if (request.method === "GET") {
      requirePermission(dependencies.actor, "production.read");
      if (workOrder || progress) return response({ data: await service.getWorkOrder(Number((workOrder ?? progress)![1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (snapshot) return response({ data: await service.snapshot(Number(snapshot[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (issue) return response({ data: await service.getIssue(Number(issue[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (returned) return response({ data: await service.getReturn(Number(returned[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (report) return response({ data: await service.getReport(Number(report[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (completion) return response({ data: await service.getCompletion(Number(completion[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100); const offset = (page - 1) * size; const wo = url.searchParams.get("work_order_id"); const workOrderId = wo ? id(wo, "work_order_id") : undefined; let result;
      if (path === "/api/work-orders") result = await service.listWorkOrders(size, offset);
      else if (["/api/work-order-materials", "/api/production/material-requirements"].includes(path)) result = await service.listRequirements(size, offset, workOrderId);
      else if (["/api/production-reports", "/api/production/reports"].includes(path)) result = await service.listReports(size, offset, workOrderId);
      else if (path === "/api/production/material-issues") result = await service.listIssues(size, offset, workOrderId);
      else if (path === "/api/production/material-returns") result = await service.listReturns(size, offset, workOrderId);
      else result = await service.listCompletions(size, offset, workOrderId);
      return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (!["POST", "PATCH"].includes(request.method)) throw new ProductionError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405); dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (path === "/api/work-orders" && request.method === "POST") { action = "WORK_ORDER_CREATED"; requirePermission(dependencies.actor, "production.plan"); result = await service.createWorkOrder(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/work-orders/from-bom" && request.method === "POST") { action = "WORK_ORDER_CREATED_AND_RELEASED"; requirePermission(dependencies.actor, "production.plan"); result = await service.createLegacyFromBom(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (workOrder && request.method === "PATCH") { action = "WORK_ORDER_UPDATED"; requirePermission(dependencies.actor, "production.plan"); result = await service.updateWorkOrder(Number(workOrder[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (release) { action = "WORK_ORDER_RELEASED"; requirePermission(dependencies.actor, "production.plan"); result = await service.releaseWorkOrder(Number(release[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (cancel) { action = "WORK_ORDER_CANCELLED"; requirePermission(dependencies.actor, "production.plan"); result = await service.cancel(Number(cancel[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (close) { action = "WORK_ORDER_CLOSED"; requirePermission(dependencies.actor, "production.close"); result = await service.close(Number(close[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/production/material-issues") { action = "PRODUCTION_MATERIAL_ISSUED"; requirePermission(dependencies.actor, "production.issue"); result = await service.issueMaterials(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/work-orders/issue-materials") { action = "PRODUCTION_MATERIAL_ISSUED"; requirePermission(dependencies.actor, "production.issue"); result = await service.issueLegacy(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/production/material-returns") { action = "PRODUCTION_MATERIAL_RETURNED"; requirePermission(dependencies.actor, "production.issue"); result = await service.returnMaterials(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/production/reports") { action = "PRODUCTION_REPORTED"; requirePermission(dependencies.actor, "production.report"); result = await service.createReport(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/production/completions") { action = "PRODUCTION_COMPLETED"; requirePermission(dependencies.actor, "production.complete"); result = await service.complete(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/work-orders/complete") { action = "PRODUCTION_REPORTED_AND_COMPLETED"; requirePermission(dependencies.actor, "production.report"); requirePermission(dependencies.actor, "production.complete"); result = await service.completeLegacy(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else throw new ProductionError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) { const known = mapProductionError(error); if (UUID.test(dependencies.requestId)) await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code); console.error(JSON.stringify({ level: "error", event: "production_api_failed", request_id: dependencies.requestId, code: known.code })); return response({ error: { code: known.code, message: known.message, details: known.details, request_id: dependencies.requestId }, code: known.code, message: known.message, details: known.details, request_id: dependencies.requestId }, known.status, dependencies.requestId); }
}
