import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
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

const pbkdf2 = promisify(pbkdf2Callback); const SESSION_COOKIE = "CYD_ERP_SESSION"; const CSRF_COOKIE = "CYD_ERP_CSRF"; const SESSION_HOURS = 8;
const reviewEditorPermissions = [
  "material.import.review.create", "material.import.review.history", "material.import.review.edit",
  "material.import.review.decide", "material.import.review.issue", "material.import.review.search_material",
  "material.import.review.bind", "material.import.review.create_draft",
];
const reviewManagerPermissions = [...reviewEditorPermissions, "material.import.review.bulk", "material.import.review.finalize", "material.import.review.retry"];
const permissions: Record<string, string[]> = {
  admin: ["*", "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.read_any", "material.import.cancel", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit", ...reviewManagerPermissions],
  manager: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.read_any", "material.import.cancel", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit", ...reviewManagerPermissions],
  purchase: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map", ...reviewEditorPermissions],
  engineering: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map", ...reviewEditorPermissions],
};
type SessionUser = { username: string; display_name: string; role: string; must_change_password: boolean; version: number; last_login_at: string | null; permissions: string[] };
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
async function passwordHash(password: string) { const salt = randomBytes(16).toString("hex"); const iterations = 310_000; const value = await pbkdf2(password, salt, iterations, 32, "sha256"); return `pbkdf2_sha256$${iterations}$${salt}$${value.toString("hex")}`; }
async function verifyPassword(password: string, stored: string) { const [kind, iterationsText, salt, expected] = stored.split("$"); if (kind !== "pbkdf2_sha256" || !salt || !expected) return false; const iterations = Number(iterationsText); if (!Number.isSafeInteger(iterations) || iterations < 100_000) return false; const actual = (await pbkdf2(password, salt, iterations, 32, "sha256")).toString("hex"); return constantEqual(actual, expected); }
function publicUser(row: Record<string, unknown>): SessionUser { const role = String(row.role); return { username: String(row.username), display_name: String(row.display_name), role, must_change_password: Boolean(row.must_change_password), version: Number(row.version), last_login_at: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null, permissions: [...(permissions[role] || ["material.read"])].sort() }; }
async function audit(client: PoolClient, input: { username?: string; action: string; requestId: string; result?: string; routeCode?: string; materialId?: number; details?: Record<string, unknown>; errorCode?: string }) {
  await client.query(`insert into audit_log (username,action,detail,request_id,result,route_code,material_id,error_code,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [input.username || "", input.action, input.details || {}, input.requestId, input.result || "success", input.routeCode || "", input.materialId || null, input.errorCode || null]);
}

export async function initializeAdmin(client: PoolClient, input: { username: string; displayName: string; password: string; requestId?: string }) {
  const username = input.username.toLowerCase(); if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new ApiError("USERNAME_INVALID", "管理员账号格式不正确");
  if (input.password.length < 12) throw new ApiError("PASSWORD_WEAK", "管理员密码至少 12 位");
  const count = await client.query<{ count: string }>("select count(*) count from app_users"); if (Number(count.rows[0].count) > 0) throw new ApiError("SETUP_COMPLETE", "系统已经完成初始化", 409);
  const requestId = input.requestId || randomUUID(); await client.query(`insert into app_users (username,display_name,role,password_hash,is_active,must_change_password,version) values ($1,$2,'admin',$3,true,false,1)`, [username, input.displayName, await passwordHash(input.password)]);
  await client.query(`insert into app_meta (key,value) values ('setup_completed','1') on conflict (key) do update set value=excluded.value,updated_at=now()`);
  await audit(client, { username, action: "SYSTEM_INITIALIZED", requestId, details: { username } }); return username;
}

async function currentUser(request: Request): Promise<SessionUser | null> {
  const token = cookies(request)[SESSION_COOKIE]; if (!token) return null; const pool = getPool();
  const found = await pool.query(`select u.username,u.display_name,u.role,u.must_change_password,u.version,u.last_login_at from app_sessions s join app_users u on u.username=s.username
    where s.token_hash=$1 and s.expires_at>now() and u.is_active=true`, [digest(token)]); if (!found.rows[0]) return null;
  await pool.query("update app_sessions set expires_at=now()+interval '8 hours' where token_hash=$1", [digest(token)]); return publicUser(found.rows[0]);
}
function requirePermission(user: SessionUser | null, permission: string): asserts user is SessionUser { if (!user) throw new ApiError("AUTH_REQUIRED", "请先登录", 401); if (!user.permissions.includes("*") && !user.permissions.includes(permission)) throw new ApiError("PERMISSION_DENIED", "没有权限执行此操作", 403); }
function requireCsrf(request: Request) { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError("CSRF_INVALID", "请求来源校验失败", 403); const token = request.headers.get("x-csrf-token") || ""; const cookie = cookies(request)[CSRF_COOKIE] || ""; if (!token || !cookie || !constantEqual(token, cookie)) throw new ApiError("CSRF_INVALID", "CSRF Token 无效", 403); }
function authCookies(request: Request, token: string, csrf: string) { const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""; const headers = new Headers(); headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`); headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`); return headers; }
async function loginResponse(request: Request, user: SessionUser, requestId: string, status: number) { const token = randomBytes(32).toString("base64url"); const csrf = randomBytes(32).toString("base64url"); await withTransaction(async (client) => { await client.query("delete from app_sessions where username=$1 or expires_at<=now()", [user.username]); await client.query("insert into app_sessions (token_hash,username,expires_at) values ($1,$2,now()+interval '8 hours')", [digest(token), user.username]); await client.query("update app_users set last_login_at=now(),updated_at=now() where username=$1", [user.username]); await audit(client, { username: user.username, action: "LOGIN", requestId }); }); return json({ ok: true, user, setup_required: false, csrf_token: csrf }, status, requestId, authCookies(request, token, csrf)); }

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
    if (path === "/api/setup" && request.method === "POST") { const input = await body(request); const config = runtimeConfig(); if (!config.setupToken || !constantEqual(String(input.setup_token || ""), config.setupToken)) throw new ApiError("SETUP_TOKEN_INVALID", "初始化凭证不正确", 403); const username = await withTransaction((client) => initializeAdmin(client, { username: String(input.username || "admin"), displayName: String(input.display_name || "系统管理员"), password: String(input.password || ""), requestId })); const found = await pool.query("select username,display_name,role,must_change_password,version,last_login_at from app_users where username=$1", [username]); return loginResponse(request, publicUser(found.rows[0]), requestId, 201); }
    if (path === "/api/login" && request.method === "POST") { const input = await body(request); const username = String(input.username || "").toLowerCase(); const found = await pool.query("select * from app_users where username=$1 and is_active=true", [username]); if (!found.rows[0] || !(await verifyPassword(String(input.password || ""), found.rows[0].password_hash))) { await withTransaction((client) => audit(client, { action: "LOGIN_FAILED", requestId, result: "failed", details: { username } })); throw new ApiError("LOGIN_FAILED", "账号或密码不正确", 401); } return loginResponse(request, publicUser(found.rows[0]), requestId, 200); }
    if (path === "/api/logout" && request.method === "POST") { const token = cookies(request)[SESSION_COOKIE]; if (token) await pool.query("delete from app_sessions where token_hash=$1", [digest(token)]); const headers = new Headers(); headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); headers.append("Set-Cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`); return json({ ok: true }, 200, requestId, headers); }
    if (path === "/api/session") { const count = await pool.query<{ count: string }>("select count(*) count from app_users"); const user = await currentUser(request); if (!user) return json({ authenticated: false, user: null, setup_required: Number(count.rows[0].count) === 0 }, 200, requestId); let csrf = cookies(request)[CSRF_COOKIE]; const headers = new Headers(); if (!csrf) { csrf = randomBytes(32).toString("base64url"); headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`); } return json({ authenticated: true, user, setup_required: false, csrf_token: csrf }, 200, requestId, headers); }

    const user = await currentUser(request); requirePermission(user, "material.read");
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
