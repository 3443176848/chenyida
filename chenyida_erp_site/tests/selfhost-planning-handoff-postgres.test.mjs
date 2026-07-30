import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { handleBomApi } from "../app/lib/bom-selfhost/handler.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handlePlanningHandoffApi } from "../app/lib/planning-handoff-selfhost/handler.ts";
import { PlanningHandoffRepository } from "../app/lib/planning-handoff-selfhost/repository.ts";
import { PlanningHandoffService } from "../app/lib/planning-handoff-selfhost/service.ts";

const databaseUrl = process.env.TEST_PLANNING_DATABASE_URL;
if (!databaseUrl || !/planning_test/i.test(databaseUrl)) throw new Error("isolated TEST_PLANNING_DATABASE_URL containing planning_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 20, application_name: "planning-handoff-integration-test" });
const actor = (role, username = `${role}01`) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });

async function api(path, { method = "GET", role = "engineering", username, body, key = randomUUID(), csrf = true } = {}) {
  const requestId = randomUUID(); const headers = new Headers({ "X-Request-ID": requestId }); if (body !== undefined) headers.set("Content-Type", "application/json"); if (key) headers.set("Idempotency-Key", key); if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await handlePlanningHandoffApi(request, { pool, actor: actor(role, username), requestId, requireCsrf: () => { if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 }); } });
  assert.ok(result); return { response: result, payload: await result.json(), requestId };
}

async function releaseBom(bomHeaderId, bomVersionId) {
  const requestId = randomUUID();
  const request = new Request(`http://local.test/api/boms/${bomHeaderId}/versions/${bomVersionId}/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), "X-CSRF-Token": "test-csrf", "X-Request-ID": requestId },
    body: JSON.stringify({ expected_version: 1 }),
  });
  const response = await handleBomApi(request, { pool, actor: actor("engineering"), requestId, requireCsrf: () => {} });
  assert.ok(response); const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
}

async function project(client, { code, customerId, status = "ACCEPTED", owner = "engineering01", quantity = "10.000000" }) {
  await client.query("select set_config('cyd.project_service_write','allowed',true)");
  const p = await client.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,'形成计划交接闭环','sales01',$4,$5,'2026-12-31',1,$6,$7,'sales01') returning id", [code, customerId, `项目 ${code}`, status === "ACCEPTED" ? owner : null, status, status === "ACCEPTED" ? 4 : 2, randomUUID()]);
  const v = await client.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,technical_requirements,content_digest,created_by) values($1,1,'受控客户需求',$2,'PCS','按已发布产品和 BOM',$3,'sales01') returning id", [p.rows[0].id, quantity, randomUUID().replaceAll("-", "").padEnd(64, "a")]);
  const i = await client.query("insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending,specification_requirement) values($1,1,'成品组件',$2,$3,false,'完整零件规格') returning id", [v.rows[0].id, quantity, client.unitId]);
  return { projectId: Number(p.rows[0].id), requirementVersionId: Number(v.rows[0].id), itemId: Number(i.rows[0].id), version: status === "ACCEPTED" ? 4 : 2 };
}

async function seed() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','管理员','admin','test-only'),('sales01','市场','sales','test-only'),('engineering01','项目甲','engineering','test-only'),('engineering02','项目乙','engineering','test-only'),
    ('planning01','计划甲','planning','test-only'),('planning02','计划乙','planning','test-only'),('production01','生产','production','test-only')`);
  const c1 = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PLAN-1','计划客户甲','计划客户甲','ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const c2 = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PLAN-2','计划客户乙','计划客户乙','ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const unit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id"); const unitId = Number(unit.rows[0].id);
  const category = await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('PLAN-COMP','计划零件',1,'ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const material = await pool.query("insert into material_master(internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,approved_by,approved_at,created_by,updated_by,request_id) values('MAT-PLAN-0001','精密连接器',$1,'ACME','ACME','X-100','PCS',$2,'ACTIVE','PURCHASED','STOCK','IQC','RoHS','MANUAL','admin01','admin01',now(),'admin01','admin01',$3) returning id", [category.rows[0].id, unitId, randomUUID()]);
  async function productFixture(code, customerId, released = true) {
    const p = await pool.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values($1,$2,$3,'ACTIVE','engineering01','engineering01',$4) returning id", [code, `产品 ${code}`, customerId, randomUUID()]);
    const pv = await pool.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,engineering_owner,released_by,released_at,created_by,updated_by,request_id) values($1,1,'V1',$2,'ASSEMBLY','ACTIVE','engineering01',$3,$4,'engineering01','engineering01',$5) returning id", [p.rows[0].id, released ? "RELEASED" : "DRAFT", released ? "engineering01" : "", released ? new Date() : null, randomUUID()]);
    const bh = await pool.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values($1,$2,'ACTIVE','engineering01','engineering01',$3) returning id", [`BOM-${code}`, p.rows[0].id, randomUUID()]);
    const bv = await pool.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,released_by,released_at,created_by,updated_by,request_id) values($1,$2,1,'V1','DRAFT','',null,'engineering01','engineering01',$3) returning id", [bh.rows[0].id, pv.rows[0].id, randomUUID()]);
    await pool.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,created_by,updated_by,request_id) values($1,1,$2,'2.500000',$3,'0.10000000','ASSEMBLY','engineering01','engineering01',$4)", [bv.rows[0].id, material.rows[0].id, unitId, randomUUID()]);
    if (released) await releaseBom(Number(bh.rows[0].id), Number(bv.rows[0].id));
    return { productId: Number(p.rows[0].id), productVersionId: Number(pv.rows[0].id), bomHeaderId: Number(bh.rows[0].id), bomVersionId: Number(bv.rows[0].id) };
  }
  const valid = await productFixture("PROD-PLAN-1", Number(c1.rows[0].id)); const wrongCustomer = await productFixture("PROD-PLAN-2", Number(c2.rows[0].id)); const draft = await productFixture("PROD-PLAN-3", Number(c1.rows[0].id), false);
  const client = await pool.connect(); client.unitId = unitId; try { await client.query("begin"); const accepted = await project(client, { code: "PRJ-00000161", customerId: Number(c1.rows[0].id) }); const pending = await project(client, { code: "PRJ-00000162", customerId: Number(c1.rows[0].id), status: "SUBMITTED" }); const fault = await project(client, { code: "PRJ-00000163", customerId: Number(c1.rows[0].id) });
    const batch = await client.query("insert into material_import_batches(batch_no,source_kind,created_by) values('PLANNING-FILE-BATCH','PROJECT_REFERENCE','sales01') returning id"); const file = await client.query("insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes,storage_status) values($1,$2,'controlled/planning/private.pdf','drawing.pdf','application/pdf',$3,321,'STORED') returning id", [batch.rows[0].id, randomUUID(), "b".repeat(64)]); await client.query("insert into project_document_links(project_id,requirement_version_id,file_id,document_type,display_name,created_by,request_id) values($1,$2,$3,'DRAWING','受控图纸','sales01',$4)", [accepted.projectId, accepted.requirementVersionId, file.rows[0].id, randomUUID()]); await client.query("commit"); return { accepted, pending, fault, valid, wrongCustomer, draft };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

const resolution = (refs, fixture = refs.valid, target = refs.accepted) => ({ expected_version: target.version, resolutions: [{ requirement_item_id: target.itemId, product_id: fixture.productId, product_version_id: fixture.productVersionId, bom_header_id: fixture.bomHeaderId, bom_version_id: fixture.bomVersionId }] });
test.beforeEach(async () => { await pool.query(`truncate project_planning_handoff_events,project_planning_document_links,project_planning_package_bom_lines,project_planning_package_items,project_planning_packages,project_requirement_resolutions,
  project_handoff_events,project_document_links,project_handoffs,project_requirement_items,project_requirement_versions,business_projects,bom_lines,bom_versions,bom_headers,product_versions,products,material_attribute_values,material_master,material_categories,material_import_files,material_import_batches,customers,units,identity_write_rate_limit_buckets,idempotency_keys,audit_log,app_users restart identity cascade`); });
test.after(async () => pool.end());

test("fail-closed preparation validates acceptance, ownership, customer, releases and complete resolution", async () => {
  const refs = await seed();
  const available = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`);
  assert.equal(available.response.status, 200);
  assert.ok(available.payload.data.candidates.some((row) => Number(row.bom_version_id) === refs.valid.bomVersionId));
  assert.ok(!available.payload.data.candidates.some((row) => Number(row.bom_version_id) === refs.draft.bomVersionId));
  assert.ok(!available.payload.data.candidates.some((row) => Number(row.bom_version_id) === refs.wrongCustomer.bomVersionId));
  const notAccepted = await api(`/api/projects/${refs.pending.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.valid, refs.pending) }); assert.equal(notAccepted.response.status, 409); assert.equal(notAccepted.payload.code, "PROJECT_NOT_ACCEPTED");
  const wrongOwner = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", username: "engineering02", body: resolution(refs) }); assert.equal(wrongOwner.response.status, 403); assert.equal(wrongOwner.payload.code, "PROJECT_OWNER_REQUIRED");
  const planPrepare = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", role: "planning", username: "planning01", body: resolution(refs) }); assert.equal(planPrepare.response.status, 403);
  const production = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions` , { role: "production", username: "production01" }); assert.equal(production.response.status, 200); assert.ok(!permissionsForRole("production").includes("planning.accept")); assert.ok(!permissionsForRole("production").includes("planning.submit"));
  const customer = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.wrongCustomer) }); assert.equal(customer.response.status, 422); assert.equal(customer.payload.code, "RESOLUTION_REFERENCE_INVALID");
  const draft = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.draft) }); assert.equal(draft.response.status, 422); assert.equal(draft.payload.code, "RESOLUTION_REFERENCE_INVALID");
  const unresolved = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } }); assert.equal(unresolved.response.status, 422); assert.equal(unresolved.payload.code, "REQUIREMENT_ITEMS_UNRESOLVED");
});

test("immutable numeric snapshot returns, versions, resubmits and accepts exactly once", async () => {
  const refs = await seed(); const key = "planning-resolution-idem-001";
  const saved = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", key, body: resolution(refs) }); assert.equal(saved.response.status, 200);
  const replay = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", key, body: resolution(refs) }); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const conflict = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", key, body: { ...resolution(refs), expected_version: 5 } }); assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");
  const created = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version, target_delivery_date: "2026-12-30" } }); assert.equal(created.response.status, 201); const packageId = Number(created.payload.package_id);
  const gross = await pool.query("select required_quantity::text,quantity_per::text,loss_rate::text,calculated_gross_quantity::text from project_planning_package_items pi join project_planning_package_bom_lines bl on bl.package_item_id=pi.id where pi.package_id=$1", [packageId]); assert.deepEqual(gross.rows[0], { required_quantity: "10.000000", quantity_per: "2.500000", loss_rate: "0.10000000", calculated_gross_quantity: "27.500000" });
  const detail = await api(`/api/planning-packages/${packageId}`, { role: "planning", username: "planning01" }); assert.equal(detail.response.status, 200); assert.equal(detail.payload.data.documents[0].original_filename, "drawing.pdf"); for (const field of ["relative_path", "storage_name", "file_body"]) assert.ok(!(field in detail.payload.data.documents[0]));
  const submitted = await api(`/api/planning-packages/${packageId}/submit`, { method: "POST", body: { expected_version: 1 } }); assert.equal(submitted.response.status, 200);
  const lockedResolution = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs) }); assert.equal(lockedResolution.response.status, 409); assert.equal(lockedResolution.payload.code, "PLANNING_PACKAGE_STATE_CONFLICT");
  await assert.rejects(pool.query("update project_planning_package_bom_lines set calculated_gross_quantity=1 where package_item_id in(select id from project_planning_package_items where package_id=$1)", [packageId]), /PlanningHandoffService|immutable/i);
  await assert.rejects(pool.query("delete from project_planning_handoff_events where package_id=$1", [packageId]), /PlanningHandoffService|immutable/i);
  const returned = await api(`/api/planning-packages/${packageId}/return`, { method: "POST", role: "planning", username: "planning01", body: { expected_version: 2, reason: "请补充替代规格边界" } }); assert.equal(returned.response.status, 200);
  const revisedResolution = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs) }); assert.equal(revisedResolution.response.status, 200);
  const v2 = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } }); assert.equal(v2.response.status, 201); assert.equal(Number(v2.payload.data.package_version_no), 2); const v2Id = Number(v2.payload.package_id);
  await api(`/api/planning-packages/${v2Id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const outcomes = await Promise.all(["planning01", "planning02"].map(username => api(`/api/planning-packages/${v2Id}/accept`, { method: "POST", role: "planning", username, key: `parallel-planning-${username}`, body: { expected_version: 2 } }))); assert.deepEqual(outcomes.map(item=>item.response.status).sort(), [200,409]);
  const packages = await pool.query("select package_version_no,status,package_digest from project_planning_packages where project_id=$1 order by package_version_no", [refs.accepted.projectId]); assert.deepEqual(packages.rows.map(row=>[row.package_version_no,row.status]), [[1,"RETURNED"],[2,"ACCEPTED"]]); assert.notEqual(packages.rows[0].package_digest, packages.rows[1].package_digest);
  const events = await pool.query("select event_type,reason from project_planning_handoff_events where project_id=$1 order by id", [refs.accepted.projectId]); assert.deepEqual(events.rows.map(row=>row.event_type), ["SUBMITTED","RETURNED","RESUBMITTED","ACCEPTED"]); assert.equal(events.rows[1].reason, "请补充替代规格边界");
  assert.equal(Number((await pool.query("select count(*) count from purchase_orders")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from production_work_orders")).rows[0].count), 0);
});

test("fault injection rolls back package header, snapshots, audit and idempotency", async () => {
  const refs = await seed(); await api(`/api/projects/${refs.fault.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.valid, refs.fault) });
  const repository = new PlanningHandoffRepository(pool); const service = new PlanningHandoffService(repository, checkpoint => { if (checkpoint === "after_package_header") throw new Error("forced rollback"); }); const keyDigest = "f".repeat(64);
  const meta = { actor: actor("engineering", "engineering01"), requestId: randomUUID(), operationId: randomUUID(), keyDigest, requestDigest: "e".repeat(64), method: "POST", route: `/api/projects/${refs.fault.projectId}/planning-packages`, action: "PLANNING_PACKAGE_PREPARED" };
  await assert.rejects(service.createPackage(refs.fault.projectId, meta, { expected_version: refs.fault.version }), /服务器暂时无法处理计划交接请求/);
  assert.equal(Number((await pool.query("select count(*) count from project_planning_packages where project_id=$1", [refs.fault.projectId])).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from project_planning_package_items pi left join project_planning_packages pp on pp.id=pi.package_id where pp.id is null")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [keyDigest])).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from audit_log where request_id=$1", [meta.requestId])).rows[0].count), 0);
});
