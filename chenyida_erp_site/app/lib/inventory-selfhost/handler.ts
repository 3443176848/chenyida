import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { InventoryError, mapInventoryError } from "./errors.ts";
import { PostgresInventoryRepository } from "./repository.ts";
import { parseInventoryId } from "./rules.ts";
import { InventoryService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new InventoryError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new InventoryError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };

async function readBody(request: Request) {
  const raw = await request.text();
  if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new InventoryError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new InventoryError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["username", "role", "permissions", "created_by", "request_id", "on_hand_delta", "frozen_delta"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new InventoryError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") };
}

function mutationMeta(request: Request, dependencies: Dependencies, route: string, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || "";
  if (key.length < 8 || key.length > 200) throw new InventoryError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handleInventoryApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const detailMatch = path.match(/^\/api\/inventory-adjustments\/([1-9]\d*)$/);
  const reversalMatch = path.match(/^\/api\/inventory-adjustments\/([1-9]\d*)\/reversal$/);
  const recognized = ["/api/inventory", "/api/inventory-transactions", "/api/inventory/ledger", "/api/inventory/reconciliation", "/api/inventory-adjustments"].includes(path) || Boolean(detailMatch) || Boolean(reversalMatch);
  if (!recognized) return null;
  const repository = new PostgresInventoryRepository(dependencies.pool); const service = new InventoryService(repository); let action = "INVENTORY_REQUEST";
  try {
    if (request.method === "GET") {
      requirePermission(dependencies.actor, "inventory.read");
      const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const pageSize = pageValue(url.searchParams.get("page_size"), "page_size", 50, 100); const offset = (page - 1) * pageSize;
      if (path === "/api/inventory") { const result = await service.listBalances(pageSize, offset); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: pageSize }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (path === "/api/inventory-transactions" || path === "/api/inventory/ledger") { const material = url.searchParams.get("material_id"); const result = await service.listLedger(pageSize, offset, material ? parseInventoryId(material, "material_id") : undefined); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: pageSize }, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (path === "/api/inventory/reconciliation") { const result = await service.reconcile(); const mismatches = result.rows.filter((row) => !row.consistent); return response({ rows: result.rows, consistent: mismatches.length === 0, mismatch_count: mismatches.length, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (detailMatch) { const data = await service.getAdjustment(Number(detailMatch[1])); return response({ data, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      const result = await service.listAdjustments(pageSize, offset); return response({ rows: result.rows, data: result.rows, pagination: { page, page_size: pageSize }, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (request.method !== "POST") throw new InventoryError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await readBody(request);
    if (path === "/api/inventory-adjustments") {
      action = "INVENTORY_ADJUSTMENT_POSTED"; requirePermission(dependencies.actor, "inventory.adjust");
      const result = await service.post(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value);
      return response(result.body, result.status, dependencies.requestId, result.replayed);
    }
    if (reversalMatch) {
      action = "INVENTORY_ADJUSTMENT_REVERSED"; requirePermission(dependencies.actor, "inventory.reverse");
      const result = await service.reverse(Number(reversalMatch[1]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value);
      return response(result.body, result.status, dependencies.requestId, result.replayed);
    }
    throw new InventoryError("NOT_FOUND", "接口不存在", 404);
  } catch (error) {
    const known = mapInventoryError(error);
    if (UUID.test(dependencies.requestId)) await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "inventory_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
