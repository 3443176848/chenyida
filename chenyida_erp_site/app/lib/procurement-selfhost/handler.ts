import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { ProcurementError, mapProcurementError } from "./errors.ts";
import { ProcurementRepository } from "./repository.ts";
import { currency, id, quantity } from "./rules.ts";
import { ProcurementService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new ProcurementError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new ProcurementError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["username", "role", "permissions", "created_by", "createdBy", "request_id", "received_qty", "po_status", "line_status", "financial_source_id"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") };
}

function mutationMeta(request: Request, dependencies: Dependencies, route: string, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new ProcurementError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handleProcurementApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const orderDetail = path.match(/^\/api\/purchase-orders\/([1-9]\d*)$/); const orderClose = path.match(/^\/api\/purchase-orders\/([1-9]\d*)\/close$/);
  const receiptDetail = path.match(/^\/api\/purchase-receipts\/([1-9]\d*)$/); const receiptReversal = path.match(/^\/api\/purchase-receipts\/([1-9]\d*)\/reversal$/);
  const recognized = ["/api/purchase-suggestions", "/api/purchase-orders", "/api/purchase-orders/from-shortage", "/api/purchase-order-lines", "/api/purchase-order-receivable-lines", "/api/purchase-receipts", "/api/purchase-receive", "/api/procurement/financial-sources"].includes(path) || Boolean(orderDetail) || Boolean(orderClose) || Boolean(receiptDetail) || Boolean(receiptReversal);
  if (!recognized) return null;
  const repository = new ProcurementRepository(dependencies.pool); const service = new ProcurementService(repository); let action = "PROCUREMENT_REQUEST";
  try {
    if (request.method === "GET") {
      if (path === "/api/purchase-suggestions") { requirePermission(dependencies.actor, "procurement.plan"); const bomId = id(url.searchParams.get("bom_id"), "bom_id"); const result = await service.suggestions(bomId, quantity(url.searchParams.get("order_qty") ?? "1", "order_qty"), currency(url.searchParams.get("currency_code") ?? "CNY")); return response({ suggestions: result.rows, rows: result.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (path === "/api/procurement/financial-sources") { requirePermission(dependencies.actor, "procurement.finance_source.read"); const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100); const result = await service.listFinancialSources(size, (page - 1) * size); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      requirePermission(dependencies.actor, "procurement.read");
      if (orderDetail) return response({ data: await service.getOrder(Number(orderDetail[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (receiptDetail) return response({ data: await service.getReceipt(Number(receiptDetail[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100); const offset = (page - 1) * size;
      if (path === "/api/purchase-orders") { const result = await service.listOrders(size, offset); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (path === "/api/purchase-order-lines" || path === "/api/purchase-order-receivable-lines") { const po = url.searchParams.get("po_id") || url.searchParams.get("purchase_order_id"); const result = await service.listLines(size, offset, po ? id(po, "purchase_order_id") : undefined, path.endsWith("receivable-lines")); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      const po = url.searchParams.get("po_id") || url.searchParams.get("purchase_order_id"); const result = await service.listReceipts(size, offset, po ? id(po, "purchase_order_id") : undefined); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (!["POST", "PATCH"].includes(request.method)) throw new ProcurementError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (path === "/api/purchase-orders" && request.method === "POST") { action = "PURCHASE_ORDER_CREATED"; requirePermission(dependencies.actor, "procurement.order"); result = await service.createOrder(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/purchase-orders/from-shortage" && request.method === "POST") { action = "PURCHASE_ORDERS_CREATED_FROM_SHORTAGE"; requirePermission(dependencies.actor, "procurement.order"); result = await service.createFromShortage(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (orderDetail && request.method === "PATCH") { action = "PURCHASE_ORDER_UPDATED"; requirePermission(dependencies.actor, "procurement.order"); result = await service.updateOrder(Number(orderDetail[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (orderClose && request.method === "POST") { action = "PURCHASE_ORDER_CLOSED"; requirePermission(dependencies.actor, "procurement.order"); result = await service.closeOrder(Number(orderClose[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/purchase-receipts" && request.method === "POST") { action = "PURCHASE_RECEIPT_POSTED"; requirePermission(dependencies.actor, "procurement.receive"); result = await service.createReceipt(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/purchase-receive" && request.method === "POST") { action = "PURCHASE_RECEIPT_POSTED"; requirePermission(dependencies.actor, "procurement.receive"); result = await service.createLegacyReceipt(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (receiptReversal && request.method === "POST") { action = "PURCHASE_RECEIPT_REVERSED"; requirePermission(dependencies.actor, "procurement.reverse"); result = await service.reverseReceipt(Number(receiptReversal[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else throw new ProcurementError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapProcurementError(error); if (UUID.test(dependencies.requestId)) await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "procurement_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
