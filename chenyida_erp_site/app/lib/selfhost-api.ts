import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "../../db/index.ts";
import { runtimeConfig } from "./infrastructure/config.ts";
import { LocalFileStorage } from "./infrastructure/file-storage.ts";
import { PostgresBackgroundJobQueue } from "./infrastructure/background-jobs.ts";
import { systemClock, uuidGenerator } from "./infrastructure/primitives.ts";
import { handleSelfhostMaterialApi } from "./material-selfhost/handler.ts";
import { handleSelfhostMaterialImportMappingApi } from "./material-import-selfhost/handler.ts";
import { handleSelfhostMaterialImportNormalizationApi } from "./material-import-normalization-selfhost/handler.ts";
import { handleSelfhostMaterialImportReviewApi } from "./material-import-review-selfhost/handler.ts";
import { handleMasterDataApi } from "./master-data-selfhost/handler.ts";
import { handleBomApi } from "./bom-selfhost/handler.ts";
import { handleInventoryApi } from "./inventory-selfhost/handler.ts";
import { handleProcurementApi } from "./procurement-selfhost/handler.ts";
import { handleProductionApi } from "./production-selfhost/handler.ts";
import { handleSalesApi } from "./sales-selfhost/handler.ts";
import { handleQualityApi } from "./quality-selfhost/handler.ts";
import { handleFinanceApi } from "./finance-selfhost/handler.ts";
import {
  assertProtectedIdentityGate,
  CSRF_COOKIE,
  handleSelfhostIdentityApi,
  identityFailureResponse,
  resolveIdentitySession,
} from "./identity-selfhost/handler.ts";
import { PostgresIdentityRepository } from "./identity-selfhost/repository.ts";
import type { IdentityActor } from "./identity-selfhost/types.ts";

export { initializeAdmin } from "./identity-selfhost/service.ts";

class ApiError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function constantEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function cookies(request: Request) { return Object.fromEntries((request.headers.get("cookie") || "").split(";").map((item) => item.trim().split(/=(.*)/s, 2)).filter(([key]) => key)); }
function json(data: unknown, status = 200, requestId: string = randomUUID(), headers?: HeadersInit) {
  const responseHeaders = new Headers(headers); responseHeaders.set("Cache-Control", "no-store"); responseHeaders.set("X-Request-ID", requestId);
  return Response.json(data, { status, headers: responseHeaders });
}
function failure(error: unknown, requestId: string) { const known = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500); return json({ error: { code: known.code, message: known.message, request_id: requestId }, code: known.code, message: known.message, request_id: requestId }, known.status, requestId); }
async function body(request: Request) { try { const value = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new ApiError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); } }
async function audit(client: PoolClient, input: { username?: string; action: string; requestId: string; result?: string; routeCode?: string; materialId?: number; details?: Record<string, unknown>; errorCode?: string }) {
  await client.query(`insert into audit_log (username,action,detail,request_id,result,route_code,material_id,error_code,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [input.username || "", input.action, input.details || {}, input.requestId, input.result || "success", input.routeCode || "", input.materialId || null, input.errorCode || null]);
}

function requirePermission(user: IdentityActor, permission: string) { if (!user.permissions.includes("*") && !user.permissions.includes(permission)) throw new ApiError("PERMISSION_DENIED", "没有权限执行此操作", 403); }
function requireCsrf(request: Request) { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError("CSRF_INVALID", "请求来源校验失败", 403); const token = request.headers.get("x-csrf-token") || ""; const cookie = cookies(request)[CSRF_COOKIE] || ""; if (!token || !cookie || !constantEqual(token, cookie)) throw new ApiError("CSRF_INVALID", "CSRF Token 无效", 403); }

function batchDto(row: Record<string, unknown>) { return { id: Number(row.id), batch_no: row.batch_no, source_kind: row.source_kind, status: row.status, retry_of_batch_id: row.retry_of_batch_id ? Number(row.retry_of_batch_id) : null, created_by: row.created_by, current_version: Number(row.current_version), file_count: Number(row.file_count), total_rows: Number(row.total_rows), accepted_rows: Number(row.accepted_rows), rejected_rows: Number(row.rejected_rows), failure_stage: row.failure_stage, failure_code: row.failure_code, failure_message: row.failure_message, created_at: new Date(String(row.created_at)).toISOString(), updated_at: new Date(String(row.updated_at)).toISOString() }; }
function fileDto(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const extension = String(row.original_filename || "").match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase() || null;
  return {
    id: Number(row.id),
    original_filename: row.original_filename,
    filename_extension: extension,
    declared_mime_type: row.mime_type || null,
    declared_sha256: row.sha256,
    declared_size_bytes: Number(row.size_bytes),
    detected_file_type: extension === ".csv" ? "CSV" : extension === ".xls" ? "XLS" : extension === ".xlsx" ? "XLSX" : null,
    actual_sha256: row.sha256,
    actual_size_bytes: Number(row.size_bytes),
    storage_status: row.storage_status,
    security_check_status: "BASIC_CHECK_PASSED",
    security_failure_code: null,
    security_failure_message: null,
  };
}

export async function handleSelfhostApi(request: Request): Promise<Response> {
  const suppliedRequestId = request.headers.get("x-request-id") || ""; const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId) ? suppliedRequestId : randomUUID(); const url = new URL(request.url); const path = url.pathname; const pool = getPool();
  try {
    if (path === "/api/health") { await pool.query("select 1"); return json({ ok: true, database: "postgresql", storage: "local", worker: "postgresql-jobs", time: new Date().toISOString() }, 200, requestId); }
    const identityResponse = await handleSelfhostIdentityApi(request, { pool, requestId });
    if (identityResponse) return identityResponse;
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityContext = await resolveIdentitySession(request, identityRepository);
    let user: IdentityActor;
    try { user = assertProtectedIdentityGate(identityContext); } catch (error) { return identityFailureResponse(error, requestId); }
    requirePermission(user, "material.read");
    const financeResponse = await handleFinanceApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (financeResponse) return financeResponse;
    const qualityResponse = await handleQualityApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (qualityResponse) return qualityResponse;
    const salesResponse = await handleSalesApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (salesResponse) return salesResponse;
    const productionResponse = await handleProductionApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (productionResponse) return productionResponse;
    const procurementResponse = await handleProcurementApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (procurementResponse) return procurementResponse;
    const inventoryResponse = await handleInventoryApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (inventoryResponse) return inventoryResponse;
    const masterDataResponse = await handleMasterDataApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (masterDataResponse) return masterDataResponse;
    const bomResponse = await handleBomApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (bomResponse) return bomResponse;
    const materialResponse = await handleSelfhostMaterialApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (materialResponse) return materialResponse;
    const mappingResponse = await handleSelfhostMaterialImportMappingApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (mappingResponse) return mappingResponse;
    const normalizationResponse = await handleSelfhostMaterialImportNormalizationApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (normalizationResponse) return normalizationResponse;
    const reviewQueue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, runtimeConfig().workerLeaseSeconds);
    const reviewResponse = await handleSelfhostMaterialImportReviewApi(request, { pool, queue: reviewQueue, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (reviewResponse) return reviewResponse;
    if (path === "/api/material-master/import-batches" && request.method === "GET") {
      requirePermission(user, "material.import.read");
      const conditions: string[] = []; const values: unknown[] = [];
      if (!user.permissions.includes("*") && !user.permissions.includes("material.import.read_any") || url.searchParams.get("created_by_me") !== "false") { values.push(user.username); conditions.push(`b.created_by=$${values.length}`); }
      const status = url.searchParams.get("status"); if (status) { values.push(status); conditions.push(`b.status=$${values.length}`); }
      const source = url.searchParams.get("source_kind"); if (source) { values.push(source); conditions.push(`b.source_kind=$${values.length}`); }
      const limit = url.searchParams.get("limit") === "20" ? 20 : 50; values.push(limit + 1);
      const rows = await pool.query(`select b.* from material_import_batches b ${conditions.length ? `where ${conditions.join(" and ")}` : ""} order by b.created_at ${url.searchParams.get("sort") === "created_at_asc" ? "asc" : "desc"},b.id desc limit $${values.length}`, values);
      const visible = rows.rows.slice(0, limit).map(batchDto);
      return json({ items: visible, next_cursor: rows.rows.length > limit ? String(visible.at(-1)?.id || "") : null, request_id: requestId }, 200, requestId);
    }
    if (path === "/api/material-master/import-batches" && request.method === "POST") { requirePermission(user, "material.import.create"); requireCsrf(request); const input = await body(request); const source = String(input.source_kind); if (!["CSV", "XLSX"].includes(source)) throw new ApiError("IMPORT_SOURCE_INVALID", "导入类型无效"); const result = await withTransaction(async (client) => { const batchNo = `IMP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`; const created = await client.query(`insert into material_import_batches (batch_no,source_kind,status,retry_of_batch_id,created_by) values ($1,$2,'CREATED',$3,$4) returning *`, [batchNo, source, input.retry_of_batch_id || null, user.username]); await audit(client, { username: user.username, action: "IMPORT_BATCH_CREATED", requestId, details: { batch_id: Number(created.rows[0].id) } }); return created.rows[0]; }); return json({ data: batchDto(result), request_id: requestId }, 201, requestId); }
    const batchDetail = path.match(/^\/api\/material-master\/import-batches\/(\d+)$/); if (batchDetail && request.method === "GET") { const found = await pool.query("select * from material_import_batches where id=$1", [Number(batchDetail[1])]); if (!found.rows[0] || (!user.permissions.includes("*") && !user.permissions.includes("material.import.read_any") && found.rows[0].created_by !== user.username)) throw new ApiError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404); const file = await pool.query("select * from material_import_files where batch_id=$1", [Number(batchDetail[1])]); return json({ data: { batch: batchDto(found.rows[0]), file: fileDto(file.rows[0]) } }, 200, requestId); }
    const upload = path.match(/^\/api\/material-master\/import-batches\/(\d+)\/file$/); if (upload && request.method === "POST") { requirePermission(user, "material.import.create"); requireCsrf(request); const batchId = Number(upload[1]); const form = await request.formData(); const file = form.get("file"); if (!(file instanceof File) || file.size <= 0 || file.size > runtimeConfig().maxUploadBytes) throw new ApiError("IMPORT_FILE_INVALID", "文件为空或超过大小限制"); const stored = await new LocalFileStorage(runtimeConfig().uploadRoot).write({ body: file.stream(), originalFilename: file.name, mimeType: file.type }); const result = await withTransaction(async (client) => { const updated = await client.query("update material_import_batches set status='FILE_READY',file_count=1,current_version=current_version+1,updated_at=now() where id=$1 and created_by=$2 returning *", [batchId, user.username]); if (!updated.rows[0]) throw new ApiError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404); const saved = await client.query(`insert into material_import_files (batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [batchId, stored.storageName, stored.relativePath, stored.originalFilename, stored.mimeType, stored.sha256, stored.sizeBytes]); await audit(client, { username: user.username, action: "IMPORT_FILE_STORED", requestId, details: { batch_id: batchId, sha256: stored.sha256, size_bytes: stored.sizeBytes } }); return { batch: updated.rows[0], file: saved.rows[0] }; }); return json({ data: { batch: batchDto(result.batch), file: fileDto(result.file) }, request_id: requestId }, 201, requestId); }
    const jobSubmit = path.match(/^\/api\/material-master\/import-batches\/(\d+)\/(parse|normalize)$/); if (jobSubmit && request.method === "POST") { const kind = jobSubmit[2]; requirePermission(user, kind === "parse" ? "material.import.parse" : "material.import.normalize"); requireCsrf(request); const batchId = Number(jobSubmit[1]); const input = await body(request); const idem = request.headers.get("idempotency-key") || ""; if (!idem) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key"); const queue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, runtimeConfig().workerLeaseSeconds); const jobId = await withTransaction(async (client) => { const found = await client.query("select b.*,f.relative_path from material_import_batches b join material_import_files f on f.batch_id=b.id where b.id=$1 for update of b", [batchId]); if (!found.rows[0] || !found.rows[0].relative_path || (!user.permissions.includes("*") && !user.permissions.includes("material.import.read_any") && found.rows[0].created_by !== user.username)) throw new ApiError("IMPORT_FILE_NOT_READY", "导入文件尚未就绪", 409); if (Number(input.expected_version) !== Number(found.rows[0].current_version)) throw new ApiError("IMPORT_VERSION_CONFLICT", "导入批次版本冲突", 409); if (kind === "parse" && found.rows[0].status !== "FILE_READY") throw new ApiError("IMPORT_STATUS_CONFLICT", "当前批次不能启动解析", 409); const id = await queue.enqueue(client, { type: `material.import.${kind}`, payload: { batch_id: batchId, relative_path: found.rows[0].relative_path }, idempotencyKey: digest(`${user.username}:${kind}:${idem}`), aggregateType: "material_import_batch", aggregateId: String(batchId) }); await client.query("update material_import_batches set status=$2,current_version=current_version+1,updated_at=now() where id=$1", [batchId, kind === "parse" ? "QUEUED_FOR_PARSING" : "QUEUED_FOR_NORMALIZATION"]); await audit(client, { username: user.username, action: `IMPORT_${kind.toUpperCase()}_QUEUED`, requestId, details: { batch_id: batchId, job_id: id } }); return id; }); return json({ data: { job_id: jobId, batch_id: batchId, status: "QUEUED" }, request_id: requestId }, 202, requestId); }
    const jobStatus = path.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i); if (jobStatus && request.method === "GET") { const found = await pool.query("select id,type,status,attempt_count,max_attempts,result,last_error_code,created_at,started_at,completed_at from background_jobs where id=$1", [jobStatus[1]]); if (!found.rows[0]) throw new ApiError("JOB_NOT_FOUND", "后台任务不存在", 404); return json({ data: found.rows[0] }, 200, requestId); }
    throw new ApiError("NOT_FOUND", "接口不存在", 404);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "api_request_failed", request_id: requestId, code: error instanceof ApiError ? error.code : "INTERNAL_ERROR", message: error instanceof Error ? error.message : "unknown" }));
    return failure(error, requestId);
  }
}
