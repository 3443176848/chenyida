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

// This helper exercises the handler's CSRF callback boundary. Origin rejection is
// enforced one layer above this handler and is covered by the full-stack API suite.
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

async function project(client, { code, customerId, status = "ACCEPTED", owner = "engineering01", quantity = "10.000000", lineCount = 1 }) {
  await client.query("select set_config('cyd.project_service_write','allowed',true)");
  const p = await client.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,'形成计划交接闭环','sales01',$4,$5,'2026-12-31',1,$6,$7,'sales01') returning id", [code, customerId, `项目 ${code}`, status === "ACCEPTED" ? owner : null, status, status === "ACCEPTED" ? 4 : 2, randomUUID()]);
  const v = await client.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,technical_requirements,content_digest,created_by) values($1,1,'受控客户需求',$2,'PCS','按已发布产品和 BOM',$3,'sales01') returning id", [p.rows[0].id, quantity, randomUUID().replaceAll("-", "").padEnd(64, "a")]);
  const itemIds = [];
  for (let lineNo = 1; lineNo <= lineCount; lineNo += 1) {
    const item = await client.query("insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending,specification_requirement) values($1,$2,$3,$4,null,true,'完整零件规格') returning id", [v.rows[0].id, lineNo, `成品组件 ${lineNo}`, quantity]);
    itemIds.push(Number(item.rows[0].id));
  }
  return { projectId: Number(p.rows[0].id), requirementVersionId: Number(v.rows[0].id), itemId: itemIds[0], itemIds, version: status === "ACCEPTED" ? 4 : 2 };
}

async function seed() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','管理员','admin','test-only'),('manager01','经理','manager','test-only'),('sales01','市场','sales','test-only'),('engineering01','项目甲','engineering','test-only'),('engineering02','项目乙','engineering','test-only'),
    ('planning01','计划甲','planning','test-only'),('planning02','计划乙','planning','test-only'),('production01','生产','production','test-only'),('operations01','运营','operations','test-only')`);
  const c1 = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PLAN-1','计划客户甲','计划客户甲','ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const c2 = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PLAN-2','计划客户乙','计划客户乙','ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const unit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id"); const unitId = Number(unit.rows[0].id);
  const alternateUnit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('SET','套','SET','COUNT',true) returning id"); const alternateUnitId = Number(alternateUnit.rows[0].id);
  const disabledUnit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('OLD','停用单位','OLD','COUNT',false) returning id"); const disabledUnitId = Number(disabledUnit.rows[0].id);
  const category = await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('PLAN-COMP','计划零件',1,'ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const materialIds = [];
  for (let index = 1; index <= 4; index += 1) {
    const material = await pool.query("insert into material_master(internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,approved_by,approved_at,created_by,updated_by,request_id) values($1,$2,$3,'ACME','ACME',$4,'PCS',$5,'ACTIVE','PURCHASED','STOCK','IQC','RoHS','MANUAL','admin01','admin01',now(),'admin01','admin01',$6) returning id", [`MAT-PLAN-${String(index).padStart(4, "0")}`, `计划零件 ${index}`, category.rows[0].id, `X-${index}00`, unitId, randomUUID()]);
    materialIds.push(Number(material.rows[0].id));
  }
  async function productFixture(code, customerId, released = true) {
    const p = await pool.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values($1,$2,$3,'ACTIVE','engineering01','engineering01',$4) returning id", [code, `产品 ${code}`, customerId, randomUUID()]);
    const pv = await pool.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,engineering_owner,released_by,released_at,created_by,updated_by,request_id) values($1,1,'V1',$2,'ASSEMBLY','ACTIVE','engineering01',$3,$4,'engineering01','engineering01',$5) returning id", [p.rows[0].id, released ? "RELEASED" : "DRAFT", released ? "engineering01" : "", released ? new Date() : null, randomUUID()]);
    const bh = await pool.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values($1,$2,'ACTIVE','engineering01','engineering01',$3) returning id", [`BOM-${code}`, p.rows[0].id, randomUUID()]);
    const bv = await pool.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,released_by,released_at,created_by,updated_by,request_id) values($1,$2,1,'V1','DRAFT','',null,'engineering01','engineering01',$3) returning id", [bh.rows[0].id, pv.rows[0].id, randomUUID()]);
    for (let index = 0; index < materialIds.length; index += 1) {
      await pool.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,created_by,updated_by,request_id) values($1,$2,$3,'1.000000',$4,'0.00000000','ASSEMBLY','engineering01','engineering01',$5)", [bv.rows[0].id, (index + 1) * 10, materialIds[index], unitId, randomUUID()]);
    }
    if (released) await releaseBom(Number(bh.rows[0].id), Number(bv.rows[0].id));
    return { productId: Number(p.rows[0].id), productVersionId: Number(pv.rows[0].id), bomHeaderId: Number(bh.rows[0].id), bomVersionId: Number(bv.rows[0].id) };
  }
  const valid = await productFixture("PROD-PLAN-1", Number(c1.rows[0].id)); const wrongCustomer = await productFixture("PROD-PLAN-2", Number(c2.rows[0].id)); const draft = await productFixture("PROD-PLAN-3", Number(c1.rows[0].id), false);
  const client = await pool.connect(); try { await client.query("begin"); const accepted = await project(client, { code: "PRJ-00000161", customerId: Number(c1.rows[0].id) }); const pending = await project(client, { code: "PRJ-00000162", customerId: Number(c1.rows[0].id), status: "SUBMITTED" }); const fault = await project(client, { code: "PRJ-00000163", customerId: Number(c1.rows[0].id) });
    const batch = await client.query("insert into material_import_batches(batch_no,source_kind,created_by) values('PLANNING-FILE-BATCH','PROJECT_REFERENCE','sales01') returning id"); const file = await client.query("insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes,storage_status) values($1,$2,'controlled/planning/private.pdf','drawing.pdf','application/pdf',$3,321,'STORED') returning id", [batch.rows[0].id, randomUUID(), "b".repeat(64)]); await client.query("insert into project_document_links(project_id,requirement_version_id,file_id,document_type,display_name,created_by,request_id) values($1,$2,$3,'DRAWING','受控图纸','sales01',$4)", [accepted.projectId, accepted.requirementVersionId, file.rows[0].id, randomUUID()]); await client.query("commit"); return { accepted, pending, fault, valid, wrongCustomer, draft, unitId, alternateUnitId, disabledUnitId, materialIds, customerId: Number(c1.rows[0].id) };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

const resolution = (refs, fixture = refs.valid, target = refs.accepted, itemIds = target.itemIds) => ({ expected_version: target.version, resolutions: itemIds.map((requirementItemId) => ({ requirement_item_id: requirementItemId, product_id: fixture.productId, product_version_id: fixture.productVersionId, bom_header_id: fixture.bomHeaderId, bom_version_id: fixture.bomVersionId })) });
const unitResolution = (refs, target = refs.accepted, requirementItemId = target.itemId, unitId = refs.unitId, expectedHeadVersion = 0) => ({ requirement_item_id: requirementItemId, unit_id: unitId, expected_head_version: expectedHeadVersion });
const saveUnit = (refs, options = {}) => api(`/api/projects/${(options.target || refs.accepted).projectId}/requirement-unit-resolutions`, { method: "POST", body: unitResolution(refs, options.target || refs.accepted, options.itemId || (options.target || refs.accepted).itemId, options.unitId ?? refs.unitId, options.expected ?? 0), key: options.key, role: options.role, username: options.username, csrf: options.csrf });
const saveProductBom = (refs, target = refs.accepted, itemIds = target.itemIds) => api(`/api/projects/${target.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.valid, target, itemIds) });

test.beforeEach(async () => { await pool.query(`truncate project_planning_handoff_events,project_planning_document_links,project_planning_package_bom_lines,project_planning_package_items,project_planning_packages,project_requirement_unit_resolution_heads,project_requirement_unit_resolution_versions,project_requirement_resolutions,
  project_handoff_events,project_document_links,project_handoffs,project_requirement_items,project_requirement_versions,business_projects,bom_lines,bom_versions,bom_headers,product_versions,products,material_attribute_values,material_master,material_categories,material_import_files,material_import_batches,customers,units,identity_write_rate_limit_buckets,idempotency_keys,audit_log,app_users restart identity cascade`); });
test.after(async () => pool.end());

test("pending source unit stays NULL and a released BOM never supplies the requirement unit", async () => {
  const refs = await seed();
  const available = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`);
  assert.equal(available.response.status, 200);
  assert.deepEqual(available.payload.data.enabled_units.map((row) => row.code).sort(), ["PCS", "SET"]);
  assert.equal(available.payload.data.rows[0].source_unit_id, null);
  assert.equal(available.payload.data.rows[0].source_unit_pending, true);
  assert.equal(available.payload.data.rows[0].unit_resolution_id, null);
  assert.ok(available.payload.data.candidates.some((row) => Number(row.bom_version_id) === refs.valid.bomVersionId));
  assert.ok(!available.payload.data.candidates.some((row) => Number(row.bom_version_id) === refs.draft.bomVersionId));
  assert.ok(!available.payload.data.candidates.some((row) => Number(row.bom_version_id) === refs.wrongCustomer.bomVersionId));

  const productSaved = await saveProductBom(refs);
  assert.equal(productSaved.response.status, 200);
  const bomUnits = await pool.query("select distinct u.code from bom_lines bl join units u on u.id=bl.unit_id where bl.bom_version_id=$1", [refs.valid.bomVersionId]);
  assert.deepEqual(bomUnits.rows, [{ code: "PCS" }]);
  const unresolved = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } });
  assert.equal(unresolved.response.status, 422);
  assert.equal(unresolved.payload.code, "REQUIREMENT_UNIT_UNRESOLVED");
  assert.match(unresolved.payload.message, /选择有效单位|确认单位/);
  const source = await pool.query("select unit_id,unit_pending from project_requirement_items where id=$1", [refs.accepted.itemId]);
  assert.deepEqual(source.rows[0], { unit_id: null, unit_pending: true });
  assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_versions")).rows[0].count), 0);
});

test("unit input rejects NULL, malformed, unknown and disabled IDs and CSRF failure", async () => {
  const refs = await seed();
  const path = `/api/projects/${refs.accepted.projectId}/requirement-unit-resolutions`;
  const missing = await api(path, { method: "POST", body: { requirement_item_id: refs.accepted.itemId, unit_id: null, expected_head_version: 0 } });
  assert.equal(missing.response.status, 422); assert.equal(missing.payload.code, "REQUIREMENT_UNIT_UNRESOLVED");
  const malformed = await api(path, { method: "POST", body: { requirement_item_id: refs.accepted.itemId, unit_id: 0, expected_head_version: 0 } });
  assert.equal(malformed.response.status, 422); assert.equal(malformed.payload.code, "REQUIREMENT_UNIT_INVALID");
  const unknown = await api(path, { method: "POST", body: { requirement_item_id: refs.accepted.itemId, unit_id: 999999999, expected_head_version: 0 } });
  assert.equal(unknown.response.status, 422); assert.equal(unknown.payload.code, "REQUIREMENT_UNIT_INVALID");
  const disabled = await saveUnit(refs, { unitId: refs.disabledUnitId });
  assert.equal(disabled.response.status, 422); assert.equal(disabled.payload.code, "REQUIREMENT_UNIT_DISABLED");
  assert.match(disabled.payload.message, new RegExp(disabled.requestId));
  const csrf = await saveUnit(refs, { csrf: false });
  assert.equal(csrf.response.status, 403); assert.equal(csrf.payload.code, "CSRF_INVALID");
  assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_versions")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_heads")).rows[0].count), 0);
});

test("only the engineering owner, manager or admin may confirm a requirement unit", async () => {
  const refs = await seed();
  for (const [role, username] of [["planning", "planning01"], ["sales", "sales01"], ["operations", "operations01"]]) {
    const denied = await saveUnit(refs, { role, username });
    assert.equal(denied.response.status, 403, `${role}: ${JSON.stringify(denied.payload)}`);
    assert.equal(denied.payload.code, "PERMISSION_DENIED");
  }
  const nonOwner = await saveUnit(refs, { role: "engineering", username: "engineering02" });
  assert.equal(nonOwner.response.status, 403); assert.equal(nonOwner.payload.code, "PROJECT_OWNER_REQUIRED");
  const manager = await saveUnit(refs, { role: "manager", username: "manager01" });
  assert.equal(manager.response.status, 201, JSON.stringify(manager.payload));
  const admin = await saveUnit(refs, { role: "admin", username: "admin01", expected: 1, unitId: refs.alternateUnitId });
  assert.equal(admin.response.status, 201, JSON.stringify(admin.payload));
  const owner = await saveUnit(refs, { expected: 2 });
  assert.equal(owner.response.status, 201, JSON.stringify(owner.payload));
  const source = await pool.query("select unit_id,unit_pending from project_requirement_items where id=$1", [refs.accepted.itemId]);
  assert.deepEqual(source.rows[0], { unit_id: null, unit_pending: true });
});

test("unit versions append immutably, idempotency is exact, and head CAS has one winner", async () => {
  const refs = await seed(); const key = "requirement-unit-idem-001";
  const first = await saveUnit(refs, { key });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  const replay = await saveUnit(refs, { key });
  assert.equal(replay.response.status, 201); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(replay.payload.unit_resolution_id, first.payload.unit_resolution_id);
  const conflict = await saveUnit(refs, { key, expected: 1, unitId: refs.alternateUnitId });
  assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");
  const second = await saveUnit(refs, { expected: 1, unitId: refs.alternateUnitId });
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  const versions = await pool.query("select id,resolution_version_no,unit_id,source_type,supersedes_resolution_id from project_requirement_unit_resolution_versions where requirement_item_id=$1 order by resolution_version_no", [refs.accepted.itemId]);
  assert.equal(versions.rowCount, 2);
  assert.deepEqual(versions.rows.map((row) => [row.resolution_version_no, Number(row.unit_id), row.source_type]), [[1, refs.unitId, "ENGINEERING_CONFIRMED"], [2, refs.alternateUnitId, "ENGINEERING_CONFIRMED"]]);
  assert.equal(Number(versions.rows[1].supersedes_resolution_id), Number(versions.rows[0].id));
  const head = await pool.query("select current_resolution_id,version from project_requirement_unit_resolution_heads where requirement_item_id=$1", [refs.accepted.itemId]);
  assert.deepEqual({ current_resolution_id: Number(head.rows[0].current_resolution_id), version: head.rows[0].version }, { current_resolution_id: Number(versions.rows[1].id), version: 2 });
  const successAudits = await pool.query("select detail from audit_log where action='PROJECT_REQUIREMENT_UNIT_RESOLVED' and result='success' order by id");
  assert.equal(successAudits.rowCount, 2);
  assert.deepEqual(successAudits.rows.map((row) => [Number(row.detail.requirement_item_id), Number(row.detail.unit_resolution_id), row.detail.source_type]), [[refs.accepted.itemId, Number(versions.rows[0].id), "ENGINEERING_CONFIRMED"], [refs.accepted.itemId, Number(versions.rows[1].id), "ENGINEERING_CONFIRMED"]]);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where path like '%/requirement-unit-resolutions'")).rows[0].count), 2);
  await assert.rejects(pool.query("update project_requirement_unit_resolution_versions set unit_id=$2 where id=$1", [versions.rows[0].id, refs.alternateUnitId]), /immutable/i);
  await assert.rejects(pool.query("delete from project_requirement_unit_resolution_versions where id=$1", [versions.rows[0].id]), /immutable/i);
  await assert.rejects(pool.query("update project_requirement_unit_resolution_heads set version=version+1 where requirement_item_id=$1", [refs.accepted.itemId]), /PlanningHandoffService|service/i);

  const raced = await Promise.all([
    saveUnit(refs, { target: refs.fault, key: "unit-cas-race-01" }),
    saveUnit(refs, { target: refs.fault, key: "unit-cas-race-02", unitId: refs.alternateUnitId }),
  ]);
  assert.deepEqual(raced.map((entry) => entry.response.status).sort(), [201, 409]);
  assert.equal(raced.find((entry) => entry.response.status === 409).payload.code, "REQUIREMENT_UNIT_VERSION_CONFLICT");
  const faultChain = await pool.query("select count(*)::int versions,max(h.version)::int head_version from project_requirement_unit_resolution_versions v join project_requirement_unit_resolution_heads h on h.requirement_item_id=v.requirement_item_id where v.requirement_item_id=$1", [refs.fault.itemId]);
  assert.deepEqual(faultChain.rows[0], { versions: 1, head_version: 1 });
});

test("every requirement line needs independent Unit and Product/BOM resolution", async () => {
  const refs = await seed(); const client = await pool.connect(); let multiple;
  try {
    await client.query("begin");
    multiple = await project(client, { code: "PRJ-00000164", customerId: refs.customerId, lineCount: 2 });
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }

  const firstUnit = await saveUnit(refs, { target: multiple, itemId: multiple.itemIds[0] }); assert.equal(firstUnit.response.status, 201);
  const firstProduct = await saveProductBom(refs, multiple, [multiple.itemIds[0]]); assert.equal(firstProduct.response.status, 200);
  const missingSecondUnit = await api(`/api/projects/${multiple.projectId}/planning-packages`, { method: "POST", body: { expected_version: multiple.version } });
  assert.equal(missingSecondUnit.response.status, 422); assert.equal(missingSecondUnit.payload.code, "REQUIREMENT_UNIT_UNRESOLVED"); assert.match(missingSecondUnit.payload.message, /第 2 行/);
  const secondUnit = await saveUnit(refs, { target: multiple, itemId: multiple.itemIds[1] }); assert.equal(secondUnit.response.status, 201);
  const missingSecondProduct = await api(`/api/projects/${multiple.projectId}/planning-packages`, { method: "POST", body: { expected_version: multiple.version } });
  assert.equal(missingSecondProduct.response.status, 422); assert.equal(missingSecondProduct.payload.code, "REQUIREMENT_PRODUCT_BOM_UNRESOLVED"); assert.match(missingSecondProduct.payload.message, /第 2 行/);
  const secondProduct = await saveProductBom(refs, multiple, [multiple.itemIds[1]]); assert.equal(secondProduct.response.status, 200);
  const complete = await api(`/api/projects/${multiple.projectId}/planning-packages`, { method: "POST", body: { expected_version: multiple.version } });
  assert.equal(complete.response.status, 201, JSON.stringify(complete.payload)); assert.equal(complete.payload.item_count, 2);
});

test("package pins the exact Unit Resolution and disabled current Unit blocks only new packages", async () => {
  const refs = await seed();
  const unitV1 = await saveUnit(refs); assert.equal(unitV1.response.status, 201);
  assert.equal((await saveProductBom(refs)).response.status, 200);
  const packageV1 = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } });
  assert.equal(packageV1.response.status, 201); const packageV1Id = Number(packageV1.payload.package_id);
  assert.equal((await api(`/api/planning-packages/${packageV1Id}/submit`, { method: "POST", body: { expected_version: 1 } })).response.status, 200);
  assert.equal((await api(`/api/planning-packages/${packageV1Id}/return`, { method: "POST", role: "planning", username: "planning01", body: { expected_version: 2, reason: "验证单位版本快照" } })).response.status, 200);

  const unitV2 = await saveUnit(refs, { expected: 1, unitId: refs.alternateUnitId }); assert.equal(unitV2.response.status, 201);
  const packageV2 = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } });
  assert.equal(packageV2.response.status, 201); const packageV2Id = Number(packageV2.payload.package_id);
  const provenance = await pool.query("select package_id,unit_id,unit_resolution_id from project_planning_package_items where package_id in($1,$2) order by package_id", [packageV1Id, packageV2Id]);
  assert.deepEqual(provenance.rows.map((row) => [Number(row.package_id), Number(row.unit_id), Number(row.unit_resolution_id)]), [[packageV1Id, refs.unitId, Number(unitV1.payload.unit_resolution_id)], [packageV2Id, refs.alternateUnitId, Number(unitV2.payload.unit_resolution_id)]]);
  const oldDetail = await api(`/api/planning-packages/${packageV1Id}`, { role: "planning", username: "planning01" });
  assert.equal(oldDetail.response.status, 200); assert.equal(oldDetail.payload.data.items[0].unit_code, "PCS"); assert.equal(oldDetail.payload.data.items[0].unit_resolution_version_no, 1);

  assert.equal((await api(`/api/planning-packages/${packageV2Id}/submit`, { method: "POST", body: { expected_version: 1 } })).response.status, 200);
  assert.equal((await api(`/api/planning-packages/${packageV2Id}/return`, { method: "POST", role: "planning", username: "planning01", body: { expected_version: 2, reason: "验证停用单位行为" } })).response.status, 200);
  await pool.query("update units set enabled=false where id=$1", [refs.alternateUnitId]);
  const blocked = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } });
  assert.equal(blocked.response.status, 422); assert.equal(blocked.payload.code, "REQUIREMENT_UNIT_DISABLED");
  const historical = await api(`/api/planning-packages/${packageV2Id}`, { role: "planning", username: "planning01" });
  assert.equal(historical.response.status, 200); assert.equal(historical.payload.data.items[0].unit_code, "SET"); assert.equal(historical.payload.data.items[0].unit_resolution_version_no, 2);
});

test("package detail exposes only scoped immutable traceability and separates creation gates from current state", async () => {
  const refs = await seed();
  const unitV1 = await saveUnit(refs); assert.equal(unitV1.response.status, 201);
  assert.equal((await saveProductBom(refs)).response.status, 200);
  const created = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const packageId = Number(created.payload.package_id);

  const planningDraft = await api(`/api/planning-packages/${packageId}`, { role: "planning", username: "planning01" });
  assert.equal(planningDraft.response.status, 403); assert.equal(planningDraft.payload.code, "PLANNING_PACKAGE_FORBIDDEN");
  const otherEngineer = await api(`/api/planning-packages/${packageId}`, { role: "engineering", username: "engineering02" });
  assert.equal(otherEngineer.response.status, 403); assert.equal(otherEngineer.payload.code, "PLANNING_PACKAGE_FORBIDDEN");
  const service = new PlanningHandoffService(new PlanningHandoffRepository(pool));
  await assert.rejects(service.detail({ ...actor("planning", "planning01"), permissions: [] }, packageId), (error) => error?.status === 403 && error?.code === "PERMISSION_DENIED");

  const submitted = await api(`/api/planning-packages/${packageId}/submit`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.payload));
  const lureRequestId = randomUUID();
  await pool.query("insert into audit_log(username,action,detail,request_id,result,route_code,retention_until) values('operations01','PLANNING_PACKAGE_PREPARED',$1,$2,'success','PLANNING_HANDOFF',now()+interval '1 day')", [{ object_id: packageId + 9999 }, lureRequestId]);
  await pool.query("update products set status='INACTIVE' where id=$1", [refs.valid.productId]);
  await pool.query("update bom_headers set status='INACTIVE' where id=$1", [refs.valid.bomHeaderId]);

  const detail = await api(`/api/planning-packages/${packageId}`, { role: "planning", username: "planning01" });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.payload));
  const data = detail.payload.data;
  assert.equal(Number(data.header.id), packageId);
  assert.equal(data.header.package_digest, created.payload.package_digest);
  assert.equal(data.header.package_digest.length, 64);
  assert.deepEqual(data.responsibility, { queue_role: "PLANNING", assignee: null, handling_deadline: null });
  assert.deepEqual(data.traceability, { complete: true, creation_request_source: "PACKAGE_SCOPED_AUDIT", transition_source: "PACKAGE_EVENT", unit_resolution_source: "PACKAGE_ITEM_FIXED_REFERENCE" });
  assert.deepEqual(data.trace_events.map((event) => event.action), ["CREATE", "SUBMIT"]);
  assert.deepEqual(data.trace_events.map((event) => event.actor), ["engineering01", "engineering01"]);
  assert.deepEqual(data.trace_events.map((event) => event.request_id), [created.requestId, submitted.requestId]);
  assert.deepEqual(data.trace_events.map((event) => event.result), ["SUCCESS", "SUCCESS"]);
  assert.ok(data.trace_events.every((event) => event.occurred_at));
  const packageRequest = await pool.query("select request_id::text from project_planning_packages where id=$1", [packageId]);
  assert.equal(packageRequest.rows[0].request_id, submitted.requestId);
  assert.notEqual(packageRequest.rows[0].request_id, data.trace_events[0].request_id);

  const item = data.items[0];
  assert.equal(item.source_unit_id, null); assert.equal(item.source_unit_pending, true);
  assert.equal(Number(item.unit_resolution_id), Number(unitV1.payload.unit_resolution_id));
  assert.equal(item.unit_resolution_version_no, 1); assert.equal(item.unit_resolution_source_type, "ENGINEERING_CONFIRMED");
  assert.equal(Number(item.unit_id), refs.unitId); assert.equal(item.unit_name, "件"); assert.equal(item.unit_code, "PCS");
  assert.equal(Number(item.product_id), refs.valid.productId); assert.equal(Number(item.product_version_id), refs.valid.productVersionId);
  assert.equal(Number(item.bom_header_id), refs.valid.bomHeaderId); assert.equal(Number(item.bom_version_id), refs.valid.bomVersionId);
  assert.equal(item.product_current_status, "INACTIVE"); assert.equal(item.product_version_current_status, "RELEASED");
  assert.equal(item.bom_current_status, "INACTIVE"); assert.equal(item.bom_version_current_status, "RELEASED");
  assert.deepEqual(item.creation_validation, { outcome: "PASSED", evidence_source: "PACKAGE_CREATION_SERVICE_GATE", product_required_status: "ACTIVE", product_version_required_status: "RELEASED", bom_required_status: "ACTIVE", bom_version_required_status: "RELEASED" });
  assert.equal(item.bom_lines.length, 4);
  assert.deepEqual(item.bom_lines.map((line) => Number(line.material_id)), refs.materialIds);
  assert.ok(item.bom_lines.every((line) => line.quantity_per === "1.000000" && line.unit_code === "PCS" && line.calculated_gross_quantity === "10.000000"));
  assert.deepEqual(item.bom_lines.map((line) => line.specification_snapshot.internal_material_code), ["MAT-PLAN-0001", "MAT-PLAN-0002", "MAT-PLAN-0003", "MAT-PLAN-0004"]);
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes(lureRequestId));
  for (const forbidden of ["idempotency_key_digest", "operation_id", "target_username", "session_token"]) assert.ok(!serialized.includes(forbidden));
  assert.ok(!permissionsForRole("planning").includes("system.audit.read"));
});

test("four 1 PCS BOM lines snapshot to four 10 PCS requirements through return, revise, resubmit and accept", async () => {
  const refs = await seed();
  assert.equal((await saveUnit(refs)).response.status, 201);
  assert.equal((await saveProductBom(refs)).response.status, 200);
  const created = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version, target_delivery_date: "2026-12-30" } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload)); const packageId = Number(created.payload.package_id);
  const gross = await pool.query(`select pi.required_quantity::text,bl.quantity_per::text,bl.loss_rate::text,bl.calculated_gross_quantity::text,u.code unit_code
    from project_planning_package_items pi join project_planning_package_bom_lines bl on bl.package_item_id=pi.id join units u on u.id=bl.unit_id
    where pi.package_id=$1 order by bl.line_no`, [packageId]);
  assert.equal(gross.rowCount, 4);
  assert.deepEqual(gross.rows, Array.from({ length: 4 }, () => ({ required_quantity: "10.000000", quantity_per: "1.000000", loss_rate: "0.00000000", calculated_gross_quantity: "10.000000", unit_code: "PCS" })));
  const detail = await api(`/api/planning-packages/${packageId}`, { role: "engineering", username: "engineering01" });
  assert.equal(detail.response.status, 200); assert.equal(detail.payload.data.documents[0].original_filename, "drawing.pdf");
  assert.equal(detail.payload.data.items[0].unit_resolution_version_no, 1); assert.equal(detail.payload.data.items[0].unit_resolution_source_type, "ENGINEERING_CONFIRMED");
  for (const field of ["relative_path", "storage_name", "file_body"]) assert.ok(!(field in detail.payload.data.documents[0]));
  assert.equal((await api(`/api/planning-packages/${packageId}/submit`, { method: "POST", body: { expected_version: 1 } })).response.status, 200);
  const lockedUnit = await saveUnit(refs, { expected: 1 }); assert.equal(lockedUnit.response.status, 409); assert.equal(lockedUnit.payload.code, "PLANNING_PACKAGE_STATE_CONFLICT");
  const lockedProduct = await saveProductBom(refs); assert.equal(lockedProduct.response.status, 409); assert.equal(lockedProduct.payload.code, "PLANNING_PACKAGE_STATE_CONFLICT");
  await assert.rejects(pool.query("update product_versions set version_code='MUTATED' where id=$1", [refs.valid.productVersionId]), /released product version is immutable/i);
  await assert.rejects(pool.query("update bom_lines set quantity_per=2 where bom_version_id=$1", [refs.valid.bomVersionId]), /released bom lines are immutable/i);
  await assert.rejects(pool.query("update project_planning_package_bom_lines set calculated_gross_quantity=1 where package_item_id in(select id from project_planning_package_items where package_id=$1)", [packageId]), /PlanningHandoffService|immutable/i);
  await assert.rejects(pool.query("delete from project_planning_handoff_events where package_id=$1", [packageId]), /PlanningHandoffService|immutable/i);
  const returnReason = "请补充替代规格边界";
  const returned = await api(`/api/planning-packages/${packageId}/return`, { method: "POST", role: "planning", username: "planning01", body: { expected_version: 2, reason: returnReason } }); assert.equal(returned.response.status, 200);
  assert.equal(returned.payload.data.return_reason, returnReason);
  const pendingAfterReturn = await api("/api/planning-handoffs?status=SUBMITTED&page_size=100", { role: "planning", username: "planning01" });
  assert.equal(pendingAfterReturn.response.status, 200); assert.deepEqual(pendingAfterReturn.payload.data, []);
  const processedAfterReturn = await api("/api/planning-handoffs?status=PROCESSED&page_size=100", { role: "planning", username: "planning01" });
  assert.equal(processedAfterReturn.response.status, 200); assert.equal(processedAfterReturn.payload.pagination.total, 1);
  assert.deepEqual(processedAfterReturn.payload.data.map((row) => [Number(row.id), row.package_version_no, row.status, row.return_reason]), [[packageId, 1, "RETURNED", returnReason]]);
  const returnedDetail = await api(`/api/planning-packages/${packageId}`, { role: "planning", username: "planning01" });
  assert.equal(returnedDetail.response.status, 200);
  assert.equal(returnedDetail.payload.data.header.return_reason, returnReason);
  assert.deepEqual(returnedDetail.payload.data.responsibility, { queue_role: "ENGINEERING_PROJECT", assignee: null, handling_deadline: null });
  assert.deepEqual(returnedDetail.payload.data.trace_events.map((event) => event.action), ["CREATE", "SUBMIT", "RETURN"]);
  assert.deepEqual(returnedDetail.payload.data.trace_events.map((event) => event.result), ["SUCCESS", "SUCCESS", "SUCCESS"]);
  const returnTrace = returnedDetail.payload.data.trace_events.at(-1);
  assert.equal(returnTrace.action, "RETURN"); assert.equal(returnTrace.actor, "planning01"); assert.equal(returnTrace.request_id, returned.requestId);
  assert.equal(returnTrace.result, "SUCCESS"); assert.equal(returnTrace.reason, returnReason); assert.ok(returnTrace.occurred_at);
  const revisedUnit = await saveUnit(refs, { expected: 1 }); assert.equal(revisedUnit.response.status, 201);
  const revisedProduct = await saveProductBom(refs); assert.equal(revisedProduct.response.status, 200);
  const v2 = await api(`/api/projects/${refs.accepted.projectId}/planning-packages`, { method: "POST", body: { expected_version: refs.accepted.version } }); assert.equal(v2.response.status, 201); assert.equal(Number(v2.payload.data.package_version_no), 2); const v2Id = Number(v2.payload.package_id);
  const snapshotVersions = await pool.query("select package_id,unit_resolution_id from project_planning_package_items where package_id in($1,$2) order by package_id", [packageId, v2Id]);
  assert.notEqual(Number(snapshotVersions.rows[0].unit_resolution_id), Number(snapshotVersions.rows[1].unit_resolution_id));
  assert.equal((await api(`/api/planning-packages/${v2Id}/submit`, { method: "POST", body: { expected_version: 1 } })).response.status, 200);
  const outcomes = await Promise.all(["planning01", "planning02"].map((username) => api(`/api/planning-packages/${v2Id}/accept`, { method: "POST", role: "planning", username, key: `parallel-planning-${username}`, body: { expected_version: 2 } })));
  assert.deepEqual(outcomes.map((item) => item.response.status).sort(), [200, 409]);
  const processedAfterAccept = await api("/api/planning-handoffs?status=PROCESSED&page_size=100", { role: "planning", username: "planning01" });
  assert.equal(processedAfterAccept.response.status, 200); assert.equal(processedAfterAccept.payload.pagination.total, 2);
  assert.deepEqual(processedAfterAccept.payload.data.map((row) => [row.package_version_no, row.status]), [[2, "ACCEPTED"], [1, "RETURNED"]]);
  const packages = await pool.query("select package_version_no,status,package_digest from project_planning_packages where project_id=$1 order by package_version_no", [refs.accepted.projectId]);
  assert.deepEqual(packages.rows.map((row) => [row.package_version_no, row.status]), [[1, "RETURNED"], [2, "ACCEPTED"]]); assert.notEqual(packages.rows[0].package_digest, packages.rows[1].package_digest);
  const events = await pool.query("select event_type,reason from project_planning_handoff_events where project_id=$1 order by id", [refs.accepted.projectId]);
  assert.deepEqual(events.rows.map((row) => row.event_type), ["SUBMITTED", "RETURNED", "RESUBMITTED", "ACCEPTED"]); assert.equal(events.rows[1].reason, returnReason);
  assert.equal(Number((await pool.query("select count(*) count from purchase_orders")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from production_work_orders")).rows[0].count), 0);
});

test("unit resolution fault checkpoints leave no version, head, audit or idempotency half-record", async () => {
  const refs = await seed(); const repository = new PlanningHandoffRepository(pool);
  for (const [index, checkpoint] of ["after_unit_resolution_version", "after_unit_resolution_head"].entries()) {
    const keyDigest = String(index + 1).repeat(64); const requestId = randomUUID();
    const service = new PlanningHandoffService(repository, current => { if (current === checkpoint) throw new Error(`forced ${checkpoint}`); });
    const meta = { actor: actor("engineering", "engineering01"), requestId, operationId: randomUUID(), keyDigest, requestDigest: String(index + 7).repeat(64), method: "POST", route: `/api/projects/${refs.fault.projectId}/requirement-unit-resolutions`, action: "PROJECT_REQUIREMENT_UNIT_RESOLVED" };
    await assert.rejects(service.saveUnitResolution(refs.fault.projectId, meta, unitResolution(refs, refs.fault)), /服务器暂时无法处理计划交接请求/);
    assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_versions where project_id=$1", [refs.fault.projectId])).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_heads where project_id=$1", [refs.fault.projectId])).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [keyDigest])).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from audit_log where request_id=$1", [requestId])).rows[0].count), 0);
  }
});

test("package fault injection rolls back header, snapshots, audit and idempotency", async () => {
  const refs = await seed();
  assert.equal((await saveUnit(refs, { target: refs.fault })).response.status, 201);
  assert.equal((await saveProductBom(refs, refs.fault)).response.status, 200);
  const repository = new PlanningHandoffRepository(pool); const service = new PlanningHandoffService(repository, checkpoint => { if (checkpoint === "after_package_header") throw new Error("forced rollback"); }); const keyDigest = "f".repeat(64);
  const meta = { actor: actor("engineering", "engineering01"), requestId: randomUUID(), operationId: randomUUID(), keyDigest, requestDigest: "e".repeat(64), method: "POST", route: `/api/projects/${refs.fault.projectId}/planning-packages`, action: "PLANNING_PACKAGE_PREPARED" };
  await assert.rejects(service.createPackage(refs.fault.projectId, meta, { expected_version: refs.fault.version }), /服务器暂时无法处理计划交接请求/);
  assert.equal(Number((await pool.query("select count(*) count from project_planning_packages where project_id=$1", [refs.fault.projectId])).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from project_planning_package_items pi left join project_planning_packages pp on pp.id=pi.package_id where pp.id is null")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [keyDigest])).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from audit_log where request_id=$1", [meta.requestId])).rows[0].count), 0);
});

test("Product/BOM preparation still validates acceptance, ownership, customer and release state", async () => {
  const refs = await seed();
  const notAccepted = await api(`/api/projects/${refs.pending.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.valid, refs.pending) }); assert.equal(notAccepted.response.status, 409); assert.equal(notAccepted.payload.code, "PROJECT_NOT_ACCEPTED");
  const wrongOwner = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", username: "engineering02", body: resolution(refs) }); assert.equal(wrongOwner.response.status, 403); assert.equal(wrongOwner.payload.code, "PROJECT_OWNER_REQUIRED");
  const planPrepare = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", role: "planning", username: "planning01", body: resolution(refs) }); assert.equal(planPrepare.response.status, 403);
  const production = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { role: "production", username: "production01" }); assert.equal(production.response.status, 200); assert.ok(!permissionsForRole("production").includes("planning.accept")); assert.ok(!permissionsForRole("production").includes("planning.submit"));
  const customer = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.wrongCustomer) }); assert.equal(customer.response.status, 422); assert.equal(customer.payload.code, "RESOLUTION_REFERENCE_INVALID");
  const draft = await api(`/api/projects/${refs.accepted.projectId}/requirement-resolutions`, { method: "POST", body: resolution(refs, refs.draft) }); assert.equal(draft.response.status, 422); assert.equal(draft.payload.code, "RESOLUTION_REFERENCE_INVALID");
});
