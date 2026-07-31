import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProjectApi } from "../app/lib/project-selfhost/handler.ts";
import { ProjectRepository } from "../app/lib/project-selfhost/repository.ts";
import { ProjectService } from "../app/lib/project-selfhost/service.ts";

const databaseUrl = process.env.TEST_PROJECT_DATABASE_URL;
if (!databaseUrl || !/project_test/i.test(databaseUrl)) throw new Error("isolated TEST_PROJECT_DATABASE_URL containing project_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 20, application_name: "project-integration-test" });
const actor = (role, username = `${role}01`) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });

async function api(path, { method = "GET", role = "sales", username, body, key = randomUUID(), csrf = true } = {}) {
  const requestId = randomUUID(); const headers = new Headers({ "X-Request-ID": requestId }); if (body !== undefined) headers.set("Content-Type", "application/json"); if (key) headers.set("Idempotency-Key", key); if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await handleProjectApi(request, { pool, actor: actor(role, username), requestId, requireCsrf: () => { if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 }); } });
  assert.ok(result); return { response: result, payload: await result.json(), requestId };
}

async function seed() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','管理员','admin','test-only'),('sales01','市场甲','sales','test-only'),('sales02','市场乙','sales','test-only'),
    ('engineering01','项目甲','engineering','test-only'),('engineering02','项目乙','engineering','test-only'),('warehouse01','仓库','warehouse','test-only')`);
  const customer = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PROJECT-1','项目测试客户','项目测试客户','ACTIVE','sales01','sales01',$1) returning id", [randomUUID()]);
  const inactive = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PROJECT-2','停用客户','停用客户','INACTIVE','sales01','sales01',$1) returning id", [randomUUID()]);
  const unit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id");
  const batch = await pool.query("insert into material_import_batches(batch_no,source_kind,created_by) values('PROJECT-FILE-BATCH','PROJECT_REFERENCE','sales01') returning id");
  const file = await pool.query("insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes,storage_status) values($1,$2,'controlled/project/test.pdf','drawing.pdf','application/pdf',$3,1234,'STORED') returning id", [batch.rows[0].id, randomUUID(), "a".repeat(64)]);
  return { customerId: Number(customer.rows[0].id), inactiveCustomerId: Number(inactive.rows[0].id), unitId: Number(unit.rows[0].id), fileId: Number(file.rows[0].id) };
}

const body = (refs, suffix = "A") => ({ customer_id: refs.customerId, project_name: `客户项目 ${suffix}`, project_goal: "形成稳定项目记录", target_delivery_date: "2026-10-31", customer_requirement_summary: `需求摘要 ${suffix}`, quantity_requirement: "12.500000", quantity_unit: "套", delivery_requirement: "分两批交付", commercial_terms: "含税，条款待确认", technical_requirements: "依据受控图纸评审", items: [{ provisional_name: `控制组件 ${suffix}`, quantity: "12.5", unit_pending: true, specification_requirement: "尺寸待工程确认" }] });
const declaredUnitBody = (refs, suffix = "UNIT") => ({ ...body(refs, suffix), items: [{ provisional_name: `明确单位组件 ${suffix}`, quantity: "12.5", unit_pending: false, unit_id: refs.unitId, specification_requirement: "销售来源已明确单位" }] });

test.beforeEach(async () => {
  await pool.query(`truncate project_handoff_events,project_document_links,project_handoffs,project_requirement_items,project_requirement_versions,business_projects,
    material_import_files,material_import_batches,customers,units,business_code_sequences,identity_write_rate_limit_buckets,idempotency_keys,audit_log,app_users restart identity cascade`);
});
test.after(async () => pool.end());

test("market creates, versions, submits and engineering accepts with idempotent audited facts", async () => {
  const refs = await seed(); const key = "project-create-idem-0001"; const created = await api("/api/projects", { method: "POST", key, body: body(refs) }); assert.equal(created.response.status, 201); const projectId = Number(created.payload.project_id); assert.match(created.payload.project_code, /^PRJ-\d{8}$/);
  const replay = await api("/api/projects", { method: "POST", key, body: body(refs) }); assert.equal(replay.response.status, 201); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const idemConflict = await api("/api/projects", { method: "POST", key, body: body(refs, "DIFFERENT") }); assert.equal(idemConflict.response.status, 409); assert.equal(idemConflict.payload.code, "IDEMPOTENCY_CONFLICT");
  const revised = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { ...body(refs, "R2"), expected_version: 1 } }); assert.equal(revised.response.status, 200); assert.equal(revised.payload.data.current_requirement.version_no, 2);
  const submitted = await api(`/api/projects/${projectId}/submit`, { method: "POST", body: { expected_version: 2 } }); assert.equal(submitted.response.status, 200); assert.equal(submitted.payload.data.project.status, "SUBMITTED");
  const immutable = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { ...body(refs, "ILLEGAL"), expected_version: 3 } }); assert.equal(immutable.response.status, 409); assert.equal(immutable.payload.code, "PROJECT_IMMUTABLE_AFTER_SUBMIT");
  const queue = await api("/api/project-handoffs?status=SUBMITTED&page_size=10", { role: "engineering", username: "engineering01" }); assert.equal(queue.response.status, 200); assert.equal(queue.payload.data.length, 1); assert.equal(Number(queue.payload.data[0].project_id), projectId);
  const forbidden = await api(`/api/projects/${projectId}/accept`, { method: "POST", role: "sales", body: { expected_version: 3 } }); assert.equal(forbidden.response.status, 403);
  const selfAccept = await api(`/api/projects/${projectId}/accept`, { method: "POST", role: "engineering", username: "sales01", body: { expected_version: 3 } }); assert.equal(selfAccept.response.status, 403); assert.equal(selfAccept.payload.code, "HANDOFF_SELF_ACCEPT_FORBIDDEN");
  const accepted = await api(`/api/projects/${projectId}/accept`, { method: "POST", role: "engineering", username: "engineering01", body: { expected_version: 3 } }); assert.equal(accepted.response.status, 200); assert.equal(accepted.payload.data.project.status, "ACCEPTED");
  const facts = await pool.query("select p.status,p.project_owner,p.version,count(distinct v.id)::int versions,count(distinct e.id)::int events from business_projects p join project_requirement_versions v on v.project_id=p.id join project_handoff_events e on e.project_id=p.id where p.id=$1 group by p.id", [projectId]); assert.deepEqual(facts.rows[0], { status: "ACCEPTED", project_owner: "engineering01", version: 4, versions: 2, events: 2 });
  const audit = await pool.query("select action,request_id,operation_id,idempotency_key_digest from audit_log where route_code='PROJECT_HANDOFF' and result='success' order by id"); assert.ok(audit.rows.length >= 4); assert.ok(audit.rows.every((row) => row.request_id && row.operation_id && /^[0-9a-f]{64}$/.test(row.idempotency_key_digest)));
});

test("return, immutable revision, resubmit and concurrent final accept form one closed handoff", async () => {
  const refs = await seed(); const created = await api("/api/projects", { method: "POST", body: body(refs, "RETURN") }); const projectId = Number(created.payload.project_id); await api(`/api/projects/${projectId}/submit`, { method: "POST", body: { expected_version: 1 } });
  const returned = await api(`/api/projects/${projectId}/return`, { method: "POST", role: "engineering", username: "engineering01", body: { expected_version: 2, reason: "缺少接口尺寸与交期确认" } }); assert.equal(returned.response.status, 200); assert.equal(returned.payload.data.project.status, "RETURNED");
  const revised = await api(`/api/projects/${projectId}`, { method: "PATCH", body: { ...body(refs, "REVISED"), expected_version: 3 } }); assert.equal(revised.response.status, 200); assert.equal(revised.payload.data.current_requirement.version_no, 2);
  const resubmitted = await api(`/api/projects/${projectId}/submit`, { method: "POST", body: { expected_version: 4 } }); assert.equal(resubmitted.response.status, 200);
  const outcomes = await Promise.all(["engineering01", "engineering02"].map((username) => api(`/api/projects/${projectId}/accept`, { method: "POST", role: "engineering", username, key: `parallel-accept-${username}`, body: { expected_version: 5 } }))); assert.deepEqual(outcomes.map((item) => item.response.status).sort(), [200, 409]);
  const events = await pool.query("select event_type,reason,request_id from project_handoff_events where project_id=$1 order by id", [projectId]); assert.deepEqual(events.rows.map((row) => row.event_type), ["SUBMITTED", "RETURNED", "RESUBMITTED", "ACCEPTED"]); assert.equal(events.rows[1].reason, "缺少接口尺寸与交期确认"); assert.ok(events.rows.every((row) => row.request_id));
  await assert.rejects(pool.query("update project_requirement_versions set customer_requirement_summary='tamper' where project_id=$1", [projectId]), /require ProjectService/); await assert.rejects(pool.query("delete from project_handoff_events where project_id=$1", [projectId]), /require ProjectService/);
});

test("roles, CSRF, controlled document metadata, CAS and transaction faults fail closed", async () => {
  const refs = await seed(); const denied = await api("/api/projects", { method: "POST", role: "warehouse", username: "warehouse01", body: body(refs) }); assert.equal(denied.response.status, 403); const adminDenied = await api("/api/projects", { method: "POST", role: "admin", username: "admin01", body: body(refs) }); assert.equal(adminDenied.response.status, 403);
  const csrf = await api("/api/projects", { method: "POST", csrf: false, body: body(refs) }); assert.equal(csrf.response.status, 403); assert.equal(csrf.payload.code, "CSRF_INVALID");
  const inactive = await api("/api/projects", { method: "POST", body: { ...body(refs), customer_id: refs.inactiveCustomerId } }); assert.equal(inactive.response.status, 422); assert.equal(inactive.payload.code, "CUSTOMER_NOT_ACTIVE");
  const created = await api("/api/projects", { method: "POST", body: body(refs, "DOC") }); const projectId = Number(created.payload.project_id);
  const unsafe = await api(`/api/projects/${projectId}/documents`, { method: "POST", body: { file_id: refs.fileId, document_type: "DRAWING", display_name: "受控图纸", relative_path: "/etc/secret", expected_version: 1 } }); assert.equal(unsafe.response.status, 400); assert.equal(unsafe.payload.code, "REQUEST_VALIDATION_FAILED");
  const linked = await api(`/api/projects/${projectId}/documents`, { method: "POST", body: { file_id: refs.fileId, document_type: "DRAWING", display_name: "受控图纸", expected_version: 1 } }); assert.equal(linked.response.status, 201);
  const detail = await api(`/api/projects/${projectId}`); assert.equal(detail.payload.data.documents[0].original_filename, "drawing.pdf"); assert.equal(detail.payload.data.documents[0].sha256, "a".repeat(64)); assert.ok(!("relative_path" in detail.payload.data.documents[0])); assert.ok(!("storage_name" in detail.payload.data.documents[0]));
  const results = await Promise.all(["A", "B"].map((suffix) => api(`/api/projects/${projectId}`, { method: "PATCH", key: `project-cas-${suffix}`, body: { ...body(refs, suffix), expected_version: 2 } }))); assert.deepEqual(results.map((item) => item.response.status).sort(), [200, 409]); assert.equal(Number((await pool.query("select count(*) count from project_requirement_versions where project_id=$1", [projectId])).rows[0].count), 2);
  const fault = new ProjectService(new ProjectRepository(pool), (checkpoint) => { if (checkpoint === "after_project_requirement") throw new Error("forced rollback"); }); const meta = { actor: actor("sales", "sales01"), requestId: randomUUID(), operationId: randomUUID(), keyDigest: "f".repeat(64), requestDigest: "e".repeat(64), method: "POST", route: "/api/projects", action: "PROJECT_CREATED" };
  await assert.rejects(fault.create(meta, body(refs, "FAULT")), /服务器暂时无法处理项目请求/); assert.equal(Number((await pool.query("select count(*) count from business_projects where project_name='客户项目 FAULT'")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from project_requirement_versions v left join business_projects p on p.id=v.project_id where p.id is null")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [meta.keyDigest])).rows[0].count), 0);
});

test("an explicitly declared source unit creates traceable provenance without engineering confirmation", async () => {
  const refs = await seed(); const created = await api("/api/projects", { method: "POST", body: declaredUnitBody(refs) }); assert.equal(created.response.status, 201);
  const facts = await pool.query(`select ri.unit_id,ri.unit_pending,ur.source_type,ur.resolution_version_no,ur.unit_id resolution_unit_id,uh.version head_version,uh.current_resolution_id=ur.id head_matches
    from business_projects p join project_requirement_versions rv on rv.project_id=p.id and rv.version_no=p.current_requirement_version_no
    join project_requirement_items ri on ri.requirement_version_id=rv.id
    join project_requirement_unit_resolution_heads uh on uh.requirement_item_id=ri.id
    join project_requirement_unit_resolution_versions ur on ur.id=uh.current_resolution_id
    where p.id=$1`, [Number(created.payload.project_id)]);
  assert.deepEqual(facts.rows[0], { unit_id: String(refs.unitId), unit_pending: false, source_type: "REQUIREMENT_DECLARED", resolution_version_no: 1, resolution_unit_id: String(refs.unitId), head_version: 1, head_matches: true });
  await assert.rejects(pool.query("update project_requirement_unit_resolution_versions set source_type='ENGINEERING_CONFIRMED' where requirement_item_id=(select id from project_requirement_items order by id desc limit 1)"), /immutable|PlanningHandoffService/i);
});

test("an explicit source Unit is locked against a concurrent disable before provenance is created", async () => {
  const refs = await seed();
  const blocker = await pool.connect();
  try {
    await blocker.query("begin");
    await blocker.query("update units set enabled=false where id=$1", [refs.unitId]);
    const creation = api("/api/projects", { method: "POST", body: declaredUnitBody(refs, "DISABLE-RACE") });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await blocker.query("commit");
    const rejected = await creation;
    assert.equal(rejected.response.status, 422);
    assert.equal(rejected.payload.code, "UNIT_NOT_ACTIVE");
    assert.equal(Number((await pool.query("select count(*) count from business_projects where project_name='客户项目 DISABLE-RACE'")).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_versions")).rows[0].count), 0);
  } catch (error) {
    await blocker.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    blocker.release();
  }
});
