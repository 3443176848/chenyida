import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { MasterDataError, mapMasterDataError } from "../master-data-selfhost/errors.ts";
import { PostgresMasterDataRepository } from "../master-data-selfhost/repository.ts";
import { BomService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
async function body(request: Request) { const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB"); let value: unknown; try { value = JSON.parse(raw); } catch { throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象"); return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") }; }
function meta(request: Request, dependencies: Dependencies, action: string, digest: string) { const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new MasterDataError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key"); return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${new URL(request.url).pathname}:${key}`).digest("hex"), requestDigest: digest, method: request.method, route: new URL(request.url).pathname, action }; }

export async function handleBomApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  if (!["/api/boms", "/api/bom-lines", "/api/bom-readiness"].includes(path) && !/^\/api\/boms\/[1-9]\d*\/(versions|versions\/[1-9]\d*\/release)$/.test(path)) return null;
  const repository = new PostgresMasterDataRepository(dependencies.pool); const service = new BomService(repository); let action = "BOM_REQUEST";
  try {
    if (!allowed(dependencies.actor, request.method === "GET" ? "master.bom.read" : "master.bom.manage")) throw new MasterDataError("PERMISSION_DENIED", "没有权限执行此操作", 403);
    if (request.method === "GET") {
      if (path === "/api/boms") { const result = await dependencies.pool.query(`select h.*,p.product_code,p.product_name,c.customer_name,v.id bom_version_id,v.version_code bom_version,v.status bom_status,v.released_by,v.released_at from bom_headers h join products p on p.id=h.product_id left join customers c on c.id=p.customer_id join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no order by h.updated_at desc,h.id desc`); return response({ rows: result.rows, data: result.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      const headerId = Number(url.searchParams.get("bom_id")); if (!Number.isSafeInteger(headerId) || headerId < 1) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "bom_id 必须是正整数");
      const lines = await dependencies.pool.query(`select l.*,m.internal_material_code,m.standard_name,m.material_status,u.code uom,v.status bom_version_status from bom_headers h join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no join bom_lines l on l.bom_version_id=v.id join material_master m on m.id=l.material_id join units u on u.id=l.unit_id where h.id=$1 order by l.line_no`, [headerId]);
      if (path === "/api/bom-lines") return response({ rows: lines.rows, data: lines.rows, request_id: dependencies.requestId }, 200, dependencies.requestId);
      const order = String(url.searchParams.get("order_qty") || "1"); if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(order) || Number(order) <= 0) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "order_qty 必须是正数");
      const rows = lines.rows.map((line) => ({ ...line, required_qty: (Number(line.quantity_per) * Number(order) * (1 + Number(line.loss_rate))).toFixed(6), inventory_evaluated: false, readiness_status: line.material_status === "ACTIVE" ? "STRUCTURE_READY" : "STRUCTURE_INVALID" }));
      return response({ all_ready: false, structure_ready: rows.length > 0 && rows.every((line) => line.readiness_status === "STRUCTURE_READY"), inventory_evaluated: false, message: "库存账本尚未迁移，本接口只检查 BOM 结构", order_qty: order, rows, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (request.method !== "POST") throw new MasterDataError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await body(request); let result;
    if (path === "/api/boms") { action = "BOM_CREATED"; result = await service.create(meta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (path === "/api/bom-lines") { action = "BOM_LINE_ADDED"; result = await service.addLine(Number(parsed.value.bom_id), meta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (/^\/api\/boms\/[1-9]\d*\/versions$/.test(path)) { action = "BOM_VERSION_CREATED"; result = await service.revise(Number(path.split("/")[3]), meta(request, dependencies, action, parsed.digest), parsed.value); }
    else if (/^\/api\/boms\/[1-9]\d*\/versions\/[1-9]\d*\/release$/.test(path)) { const parts = path.split("/"); action = "BOM_VERSION_RELEASED"; result = await service.release(Number(parts[3]), Number(parts[5]), meta(request, dependencies, action, parsed.digest), parsed.value); }
    else throw new MasterDataError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapMasterDataError(error); await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "bom_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
