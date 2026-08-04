import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { MasterDataError, mapMasterDataError } from "./errors.ts";
import { PostgresMasterDataRepository } from "./repository.ts";
import { MasterDataService } from "./service.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new MasterDataError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const positive = (value: string | null, field: string, fallback?: number, max = 100) => { if (!value && fallback) return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["username", "role", "permissions", "created_by", "updated_by", "request_id"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `请求正文不能指定身份字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") };
}

function mutationMeta(request: Request, dependencies: Dependencies, route: string, action: string, digest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new MasterDataError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"), requestDigest: digest, method: request.method, route, action };
}

async function list(pool: Pool, kind: "customers" | "suppliers" | "products" | "mappings", url: URL) {
  const page = positive(url.searchParams.get("page"), "page", 1, 1_000_000); const pageSize = positive(url.searchParams.get("page_size"), "page_size", 50, 100); const offset = (page - 1) * pageSize;
  if (kind === "customers") return pool.query(`select * from customers order by updated_at desc,id desc limit $1 offset $2`, [pageSize, offset]);
  if (kind === "suppliers") return pool.query(`select * from suppliers order by updated_at desc,id desc limit $1 offset $2`, [pageSize, offset]);
  if (kind === "products") return pool.query(`select p.*,c.customer_code,c.customer_name,pv.id product_version_id,pv.version_code product_version,pv.status product_version_status,pv.product_type,pv.lifecycle_status,pv.layer_count,pv.board_thickness,pv.min_line_width,pv.min_hole,pv.surface_finish,pv.smt_required,pv.engineering_owner,pv.remark from products p left join customers c on c.id=p.customer_id left join product_versions pv on pv.product_id=p.id and pv.version_no=p.current_version_no order by p.updated_at desc,p.id desc limit $1 offset $2`, [pageSize, offset]);
  return pool.query(`select sm.*,s.supplier_code,m.internal_material_code,m.standard_name,u.code purchase_unit_code from supplier_mappings sm join suppliers s on s.id=sm.supplier_id join material_master m on m.id=sm.material_id join units u on u.id=sm.purchase_unit_id order by sm.updated_at desc,sm.id desc limit $1 offset $2`, [pageSize, offset]);
}

export async function handleMasterDataApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const recognized = ["/api/customers", "/api/suppliers", "/api/products", "/api/mappings", "/api/items"].includes(path)
    || /^\/api\/(customers|suppliers)\/[1-9]\d*\/status$/.test(path)
    || /^\/api\/(products|mappings)\/[1-9]\d*\/status$/.test(path)
    || /^\/api\/products\/[1-9]\d*\/(versions|versions\/[1-9]\d*\/release)$/.test(path)
    || /^\/api\/mappings\/[1-9]\d*\/prices$/.test(path);
  if (!recognized) return null;
  const repository = new PostgresMasterDataRepository(dependencies.pool); const service = new MasterDataService(repository); let action = "MASTER_DATA_REQUEST";
  try {
    if (request.method === "GET") {
      if (path === "/api/items") { requirePermission(dependencies.actor, "material.read"); const result = await dependencies.pool.query(`select m.id,m.internal_material_code,m.standard_name,m.base_uom,m.material_status status,m.version,m.updated_at,c.category_code item_category from material_master m join material_categories c on c.id=m.category_id where m.material_status='ACTIVE' order by m.internal_material_code`); return response({ rows: result.rows, data: result.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (/^\/api\/products\/[1-9]\d*\/versions$/.test(path)) { requirePermission(dependencies.actor, "master.product.read"); const id = Number(path.split("/")[3]); const versions = await dependencies.pool.query("select * from product_versions where product_id=$1 order by version_no desc", [id]); return response({ rows: versions.rows, data: versions.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      const kind = path.slice(5) as "customers" | "suppliers" | "products" | "mappings"; const permission = kind === "customers" ? "master.customer.read" : kind === "suppliers" ? "master.supplier.read" : kind === "products" ? "master.product.read" : "master.supplier_mapping.read"; requirePermission(dependencies.actor, permission);
      const result = await list(dependencies.pool, kind, url); return response({ rows: result.rows, data: result.rows, pagination: { page: positive(url.searchParams.get("page"), "page", 1, 1_000_000), page_size: positive(url.searchParams.get("page_size"), "page_size", 50, 100) }, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (!["POST", "PATCH"].includes(request.method)) throw new MasterDataError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (path === "/api/customers" && request.method === "POST") { action = "CUSTOMER_CREATED"; requirePermission(dependencies.actor, "master.customer.manage"); result = await service.createParty("customer", mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/suppliers" && request.method === "POST") { action = "SUPPLIER_CREATED"; requirePermission(dependencies.actor, "master.supplier.manage"); result = await service.createParty("supplier", mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/products" && request.method === "POST") { action = "PRODUCT_CREATED"; requirePermission(dependencies.actor, "master.product.manage"); result = await service.createProduct(mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (path === "/api/mappings" && request.method === "POST") { action = "SUPPLIER_MAPPING_LEGACY_WRITE_BLOCKED"; throw new MasterDataError("SUPPLIER_MAPPING_GOVERNANCE_REQUIRED", "Supplier Mapping 必须通过草稿、提交和异人审核流程建立", 409); }
    else if (/^\/api\/(customers|suppliers)\/[1-9]\d*\/status$/.test(path) && request.method === "PATCH") { const match = path.match(/^\/api\/(customers|suppliers)\/([1-9]\d*)\/status$/)!; const kind = match[1] === "customers" ? "customer" : "supplier"; action = `${kind.toUpperCase()}_STATUS_CHANGED`; requirePermission(dependencies.actor, `master.${kind}.manage`); result = await service.setPartyStatus(kind, Number(match[2]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (/^\/api\/products\/[1-9]\d*\/status$/.test(path) && request.method === "PATCH") { const id = Number(path.split("/")[3]); action = "PRODUCT_STATUS_CHANGED"; requirePermission(dependencies.actor, "master.product.manage"); result = await service.setProductStatus(id, mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (/^\/api\/mappings\/[1-9]\d*\/status$/.test(path) && request.method === "PATCH") { action = "SUPPLIER_MAPPING_LEGACY_WRITE_BLOCKED"; throw new MasterDataError("SUPPLIER_MAPPING_GOVERNANCE_REQUIRED", "ACTIVE Mapping 不得原地修改；请通过受控新版本流程变更", 409); }
    else if (/^\/api\/products\/[1-9]\d*\/versions$/.test(path) && request.method === "POST") { const id = Number(path.split("/")[3]); action = "PRODUCT_VERSION_CREATED"; requirePermission(dependencies.actor, "master.product.manage"); result = await service.createProductVersion(id, mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (/^\/api\/products\/[1-9]\d*\/versions\/[1-9]\d*\/release$/.test(path) && request.method === "POST") { const parts = path.split("/"); action = "PRODUCT_VERSION_RELEASED"; requirePermission(dependencies.actor, "master.product.manage"); result = await service.releaseProductVersion(Number(parts[3]), Number(parts[5]), mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else if (/^\/api\/mappings\/[1-9]\d*\/prices$/.test(path) && request.method === "POST") { const id = Number(path.split("/")[3]); action = "SUPPLIER_MAPPING_PRICE_ADDED"; requirePermission(dependencies.actor, "master.supplier_mapping.manage"); result = await service.addPrice(id, mutationMeta(request, dependencies, path, action, parsed.digest), parsed.value); }
    else throw new MasterDataError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapMasterDataError(error); if (UUID.test(dependencies.requestId)) await repository.failureAudit(dependencies.actor.username, dependencies.requestId, action, known.code);
    console.error(JSON.stringify({ level: "error", event: "master_data_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
