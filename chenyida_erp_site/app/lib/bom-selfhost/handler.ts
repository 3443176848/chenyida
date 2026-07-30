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
const boundedCandidateLimit = (value: string | null) => { const parsed = Number(value || 20); return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 20; };
const candidateSearch = (value: string | null) => { const result = String(value || "").normalize("NFKC").trim(); if (result.length > 100 || /[\u0000-\u001f\u007f]/.test(result)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "物料检索词无效"); return result; };
const candidateDto = (row: Record<string, unknown>) => ({ material_id: Number(row.material_id), internal_code: row.internal_code, name: row.name, unit_id: Number(row.unit_id), unit: row.unit, status: row.status, version: Number(row.version) });
async function body(request: Request) { const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB"); let value: unknown; try { value = JSON.parse(raw); } catch { throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象"); return { value: value as Record<string, unknown>, digest: createHash("sha256").update(JSON.stringify(stable(value))).digest("hex") }; }
function meta(request: Request, dependencies: Dependencies, action: string, digest: string) { const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200) throw new MasterDataError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key"); return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${new URL(request.url).pathname}:${key}`).digest("hex"), requestDigest: digest, method: request.method, route: new URL(request.url).pathname, action }; }

export async function handleBomApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  if (!["/api/boms", "/api/bom-lines", "/api/bom-readiness", "/api/bom-material-candidates"].includes(path) && !/^\/api\/boms\/[1-9]\d*\/(versions|versions\/[1-9]\d*\/release)$/.test(path)) return null;
  const repository = new PostgresMasterDataRepository(dependencies.pool); const service = new BomService(repository); let action = "BOM_REQUEST";
  try {
    if (!allowed(dependencies.actor, request.method === "GET" ? "master.bom.read" : "master.bom.manage")) throw new MasterDataError("PERMISSION_DENIED", "没有权限执行此操作", 403);
    if (request.method === "GET") {
      if (path === "/api/bom-material-candidates") {
        const query = candidateSearch(url.searchParams.get("q")); const limit = boundedCandidateLimit(url.searchParams.get("limit"));
        if (!query) return response({ rows: [], data: [], limit, request_id: dependencies.requestId }, 200, dependencies.requestId);
        const projection = `select m.id material_id,m.internal_material_code internal_code,m.standard_name name,u.id unit_id,u.code unit,m.material_status status,m.version
          from material_master m join units u on u.enabled=true and ((m.base_unit_id is not null and u.id=m.base_unit_id) or (m.base_unit_id is null and upper(u.code)=upper(btrim(m.base_uom))))
          where m.material_status='ACTIVE' and m.internal_material_code is not null and nullif(btrim(m.internal_material_code),'') is not null`;
        const exactCode = await dependencies.pool.query("select 1 from material_master where internal_material_code is not null and lower(internal_material_code)=lower($1) limit 1", [query]);
        const result = exactCode.rows.length
          ? await dependencies.pool.query(`${projection} and lower(m.internal_material_code)=lower($1) order by m.id limit 1`, [query])
          : await dependencies.pool.query(`${projection} and (left(lower(m.internal_material_code),char_length(lower($1)))=lower($1) or position(lower($1) in lower(m.standard_name))>0) order by m.internal_material_code,m.id limit $2`, [query, limit]);
        const rows = result.rows.map(candidateDto); return response({ rows, data: rows, limit, request_id: dependencies.requestId }, 200, dependencies.requestId);
      }
      if (path === "/api/boms") { const result = await dependencies.pool.query(`select h.*,p.product_code,p.product_name,p.status product_status,c.customer_name,v.id bom_version_id,v.version_code bom_version,v.status bom_status,v.released_by,v.released_at,pv.id product_version_id,pv.version_code product_version,pv.status product_version_status,pv.lifecycle_status product_lifecycle_status from bom_headers h join products p on p.id=h.product_id left join customers c on c.id=p.customer_id join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no join product_versions pv on pv.id=v.product_version_id order by h.updated_at desc,h.id desc`); return response({ rows: result.rows, data: result.rows, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      const headerId = Number(url.searchParams.get("bom_id")); if (!Number.isSafeInteger(headerId) || headerId < 1) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "bom_id 必须是正整数");
      const lines = await dependencies.pool.query(`select l.*,m.internal_material_code,m.standard_name,m.material_status,m.base_unit_id,u.code uom,v.status bom_version_status,
        coalesce(ib.on_hand_qty,0)::text on_hand_qty,coalesce(ib.reserved_qty,0)::text reserved_qty,coalesce(ib.frozen_qty,0)::text frozen_qty,
        (coalesce(ib.on_hand_qty,0)-coalesce(ib.reserved_qty,0)-coalesce(ib.frozen_qty,0))::text available_qty,coalesce(ib.version,0) balance_version
        from bom_headers h join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no
        join bom_lines l on l.bom_version_id=v.id join material_master m on m.id=l.material_id join units u on u.id=l.unit_id
        left join inventory_stock_balances ib on ib.material_id=l.material_id and ib.location_code='MAIN' and ib.lot_code=''
        where h.id=$1 order by l.line_no`, [headerId]);
      if (path === "/api/bom-lines") return response({ rows: lines.rows, data: lines.rows, request_id: dependencies.requestId }, 200, dependencies.requestId);
      const order = String(url.searchParams.get("order_qty") || "1"); if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(order) || Number(order) <= 0) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "order_qty 必须是正数");
      const readiness = await dependencies.pool.query(`select l.id,(l.quantity_per*$2::numeric*(1+l.loss_rate))::numeric(24,6)::text required_qty,
        (coalesce(ib.on_hand_qty,0)-coalesce(ib.reserved_qty,0)-coalesce(ib.frozen_qty,0))::numeric(24,6)::text available_qty,
        greatest((l.quantity_per*$2::numeric*(1+l.loss_rate))-(coalesce(ib.on_hand_qty,0)-coalesce(ib.reserved_qty,0)-coalesce(ib.frozen_qty,0)),0)::numeric(24,6)::text shortage_qty,
        case when m.material_status<>'ACTIVE' or nullif(btrim(m.internal_material_code),'') is null then 'STRUCTURE_INVALID'
          when u.enabled is distinct from true or not ((m.base_unit_id is not null and l.unit_id=m.base_unit_id) or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(u.code)=upper(btrim(m.base_uom)))) then 'UNIT_CONVERSION_REQUIRED'
          when coalesce(ib.on_hand_qty,0)-coalesce(ib.reserved_qty,0)-coalesce(ib.frozen_qty,0) >= l.quantity_per*$2::numeric*(1+l.loss_rate) then 'READY' else 'SHORTAGE' end readiness_status
        from bom_headers h join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no join bom_lines l on l.bom_version_id=v.id
        join material_master m on m.id=l.material_id join units u on u.id=l.unit_id left join inventory_stock_balances ib on ib.material_id=l.material_id and ib.location_code='MAIN' and ib.lot_code=''
        where h.id=$1 order by l.line_no`, [headerId, order]);
      const byId = new Map(readiness.rows.map((row) => [Number(row.id), row])); const rows = lines.rows.map((line) => ({ ...line, ...byId.get(Number(line.id)), inventory_evaluated: true }));
      const structureReady = rows.length > 0 && rows.every((line) => !["STRUCTURE_INVALID", "UNIT_CONVERSION_REQUIRED"].includes(line.readiness_status));
      return response({ all_ready: structureReady && rows.every((line) => line.readiness_status === "READY"), structure_ready: structureReady, inventory_evaluated: true, message: "库存可用量按现有量减预留量和冻结量计算", order_qty: order, rows, request_id: dependencies.requestId }, 200, dependencies.requestId);
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
