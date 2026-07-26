import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { SalesError, mapSalesError } from "./errors.ts";
import { id } from "./rules.ts";
import { SalesRepository } from "./repository.ts";
import { SalesService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new SalesError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new SalesError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new SalesError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new SalesError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SalesError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["username", "role", "permissions", "created_by", "createdBy", "request_id", "quotation_code", "quote_code", "sales_order_code", "shipment_code", "status", "quote_status", "sales_status", "total_amount", "line_amount", "shipped_qty", "inventory_adjustment_id", "inventory_ledger_entry_id", "financial_source_id", "source_id"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new SalesError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") };
}

function mutationMeta(request: Request, dependencies: Dependencies, route: string, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new SalesError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handleSalesApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const quotation = path.match(/^\/api\/quotations\/([1-9]\d*)$/); const quotationVersion = path.match(/^\/api\/quotations\/([1-9]\d*)\/versions\/([1-9]\d*)$/); const quotationVersions = path.match(/^\/api\/quotations\/([1-9]\d*)\/versions$/); const quotationAction = path.match(/^\/api\/quotations\/([1-9]\d*)\/(publish|accept|reject|expire|cancel|convert)$/);
  const order = path.match(/^\/api\/sales-orders\/([1-9]\d*)$/); const orderAction = path.match(/^\/api\/sales-orders\/([1-9]\d*)\/(close|cancel)$/); const orderAvailability = path.match(/^\/api\/sales-orders\/([1-9]\d*)\/(available-to-ship|progress)$/);
  const delivery = path.match(/^\/api\/delivery-instructions\/([1-9]\d*)$/); const deliveryAction=path.match(/^\/api\/delivery-instructions\/([1-9]\d*)\/(submit|accept|return|cancel|execute)$/);
  const shipment = path.match(/^\/api\/shipments\/([1-9]\d*)$/); const shipmentReversal = path.match(/^\/api\/shipments\/([1-9]\d*)\/reversal$/);
  const fixed = ["/api/quotations", "/api/quotations/to-sales-order", "/api/sales-orders", "/api/delivery-instructions", "/api/shipments", "/api/shipments/from-order", "/api/sales/financial-sources"];
  if (!fixed.includes(path) && !quotation && !quotationVersion && !quotationVersions && !quotationAction && !order && !orderAction && !orderAvailability && !delivery && !deliveryAction && !shipment && !shipmentReversal) return null;
  const repository = new SalesRepository(dependencies.pool); const service = new SalesService(repository); let action = "SALES_REQUEST";
  try {
    if (request.method === "GET") {
      if (path === "/api/sales/financial-sources") { requirePermission(dependencies.actor, "sales.finance_source.read"); const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100); const result = await service.listFinancialSources(size, (page - 1) * size); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if(path==="/api/delivery-instructions"||delivery){requirePermission(dependencies.actor,"sales.delivery.read");if(delivery)return response({data:await service.getDeliveryInstruction(Number(delivery[1])),request_id:dependencies.requestId},200,dependencies.requestId);const page=pageValue(url.searchParams.get("page"),"page",1,1_000_000),size=pageValue(url.searchParams.get("page_size"),"page_size",50,100),result=await service.listDeliveryInstructions(size,(page-1)*size,url.searchParams.get("status")||undefined);return response({rows:result.rows,data:result.rows,pagination:{page,page_size:size},request_id:dependencies.requestId},200,dependencies.requestId);}
      requirePermission(dependencies.actor, "sales.read");
      if (quotationVersion) return response({ data: await service.getQuotationVersion(Number(quotationVersion[1]), Number(quotationVersion[2])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (quotation) return response({ data: await service.getQuotation(Number(quotation[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (orderAvailability) { const salesOrderId = Number(orderAvailability[1]); if (orderAvailability[2] === "progress") return response({ data: await service.getOrder(salesOrderId), request_id: dependencies.requestId }, 200, dependencies.requestId); const result = await service.availableToShip(salesOrderId); return response({ rows: result.rows, data: result.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (order) return response({ data: await service.getOrder(Number(order[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      if (shipment) return response({ data: await service.getShipment(Number(shipment[1])), request_id: dependencies.requestId }, 200, dependencies.requestId);
      const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100); const offset = (page - 1) * size; let result;
      if (path === "/api/quotations") result = await service.listQuotations(size, offset);
      else if (path === "/api/sales-orders") result = await service.listOrders(size, offset);
      else { const orderId = url.searchParams.get("sales_order_id"); result = await service.listShipments(size, offset, orderId ? id(orderId, "sales_order_id") : undefined); }
      return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: size }, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (!["POST", "PATCH"].includes(request.method)) throw new SalesError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405); dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (path === "/api/quotations" && request.method === "POST") { action = "SALES_QUOTATION_CREATED"; requirePermission(dependencies.actor, "sales.quote"); result = await service.createQuotation(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (quotation && request.method === "PATCH") { action = "SALES_QUOTATION_UPDATED"; requirePermission(dependencies.actor, "sales.quote"); result = await service.updateQuotation(Number(quotation[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (quotationVersions && request.method === "POST") { action = "SALES_QUOTATION_REVISION_CREATED"; requirePermission(dependencies.actor, "sales.quote"); result = await service.createQuotationVersion(Number(quotationVersions[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (quotationAction && quotationAction[2] !== "convert") { const targets = { publish: "PUBLISHED", accept: "ACCEPTED", reject: "REJECTED", expire: "EXPIRED", cancel: "CANCELLED" } as const; action = `SALES_QUOTATION_${targets[quotationAction[2] as keyof typeof targets]}`; requirePermission(dependencies.actor, "sales.quote"); result = await service.transitionQuotation(Number(quotationAction[1]), targets[quotationAction[2] as keyof typeof targets], mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (quotationAction?.[2] === "convert") { action = "SALES_QUOTATION_CONVERTED"; requirePermission(dependencies.actor, "sales.order"); result = await service.convertQuotation(Number(quotationAction[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/quotations/to-sales-order") { action = "SALES_QUOTATION_CONVERTED"; requirePermission(dependencies.actor, "sales.order"); result = await service.convertQuotation(id(parsed.value.quote_id, "quote_id"), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/sales-orders" && request.method === "POST") { action = "SALES_ORDER_CREATED"; requirePermission(dependencies.actor, "sales.order"); result = await service.createOrder(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (orderAction) { const target = orderAction[2] === "close" ? "CLOSED" : "CANCELLED"; action = `SALES_ORDER_${target}`; requirePermission(dependencies.actor, "sales.order"); result = await service.transitionOrder(Number(orderAction[1]), target, mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if(path==="/api/delivery-instructions"){action="SALES_DELIVERY_INSTRUCTION_CREATED";requirePermission(dependencies.actor,"sales.delivery.create");result=await service.createDeliveryInstruction(mutationMeta(request,dependencies,path,action,parsed.digest),parsed.value);}
    else if(deliveryAction){const verb=deliveryAction[2],permissions={submit:"sales.delivery.submit",accept:"sales.delivery.accept",return:"sales.delivery.return",cancel:"sales.delivery.cancel",execute:"sales.delivery.execute"} as const;action=verb==="execute"?"SALES_SHIPMENT_POSTED":`SALES_DELIVERY_INSTRUCTION_${verb.toUpperCase()}`;requirePermission(dependencies.actor,permissions[verb as keyof typeof permissions]);result=verb==="execute"?await service.executeDeliveryInstruction(Number(deliveryAction[1]),mutationMeta(request,dependencies,path,action,parsed.digest),parsed.value):await service.transitionDeliveryInstruction(Number(deliveryAction[1]),({submit:"SUBMITTED",accept:"ACCEPTED",return:"RETURNED",cancel:"CANCELLED"} as const)[verb as "submit"|"accept"|"return"|"cancel"],mutationMeta(request,dependencies,path,action,parsed.digest),parsed.value);}
    else if (path === "/api/shipments") { action = "SALES_SHIPMENT_POSTED"; requirePermission(dependencies.actor, "sales.delivery.execute"); result = await service.createShipment(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/shipments/from-order") { action = "SALES_SHIPMENT_POSTED"; requirePermission(dependencies.actor, "sales.ship"); result = await service.createLegacyShipment(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (shipmentReversal) { action = "SALES_SHIPMENT_REVERSED"; requirePermission(dependencies.actor, "sales.delivery.reverse"); result = await service.reverseShipment(Number(shipmentReversal[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else throw new SalesError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapSalesError(error); if (UUID.test(dependencies.requestId)) await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "sales_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
