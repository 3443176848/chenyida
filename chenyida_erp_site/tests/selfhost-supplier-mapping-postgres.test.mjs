import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementSourcingApi } from "../app/lib/procurement-sourcing-selfhost/handler.ts";
import { SupplierMappingRepository } from "../app/lib/supplier-mapping-selfhost/repository.ts";
import { SupplierMappingService } from "../app/lib/supplier-mapping-selfhost/service.ts";
import { canonicalDigest } from "../app/lib/supplier-mapping-selfhost/validation.ts";
import { handleSupplierMappingApi } from "../app/lib/supplier-mapping-selfhost/handler.ts";

const databaseUrl = process.env.TEST_SUPPLIER_MAPPING_DATABASE_URL;
if (!databaseUrl || !/supplier_mapping_test/i.test(databaseUrl) || /migration_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_SUPPLIER_MAPPING_DATABASE_URL containing supplier_mapping_test is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 10, application_name: "supplier-mapping-postgres-test" });
const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const APPROVAL_COMMENT = "UAT审核通过：供应商、正式物料、PCS单位及1:1换算核对一致。";
const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const migrationSources = new Map(await Promise.all(migrationNames.map(async (name) => [name, await readFile(new URL(name, migrationDirectory), "utf8")])));

const actor = (role, username = `${role}01`) => ({
  username, display_name: username, role, is_active: true, must_change_password: false,
  version: 1, last_login_at: null, permissions: permissionsForRole(role),
});

async function migrateFresh() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
  for (const name of migrationNames) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migrationSources.get(name));
      const checksum = createHash("sha256").update(migrationSources.get(name)).digest("hex");
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
}

async function mappingApi(path, {
  method = "GET", role = "purchase", username, key = randomUUID(), body, csrf = true,
} = {}) {
  const requestId = randomUUID();
  const headers = new Headers({ "X-Request-ID": requestId });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, {
    method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await handleSupplierMappingApi(request, {
    pool, actor: actor(role, username), requestId,
    requireCsrf: () => {
      if (headers.get("X-CSRF-Token") !== "test-csrf") {
        throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 });
      }
    },
  });
  assert.ok(response);
  return { response, payload: await response.json(), requestId };
}

async function sourcingApi(path, { method = "GET", key = randomUUID(), body } = {}) {
  const requestId = randomUUID();
  const headers = new Headers({ "X-Request-ID": requestId, "X-CSRF-Token": "test-csrf" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  const request = new Request(`http://local.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleProcurementSourcingApi(request, {
    pool, actor: actor("purchase"), requestId,
    requireCsrf: () => {
      if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 });
    },
  });
  assert.ok(response);
  return { response, payload: await response.json(), requestId };
}

async function seed() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','管理员','admin','test-only'),('manager01','经理','manager','test-only'),
    ('purchase01','采购一','purchase','test-only'),('purchase02','采购二','purchase','test-only'),
    ('operations01','运营一','operations','test-only'),('operations02','运营二','operations','test-only'),
    ('engineering01','工程','engineering','test-only'),('planning01','计划','planning','test-only')`);
  const units = (await pool.query(`insert into units(code,name,symbol,unit_type,enabled) values
    ('T20PCS','件','PCS','COUNT',true),('T20BOX','箱','BOX','COUNT',true),('T20OFF','停用单位','OFF','COUNT',false)
    returning id,code`)).rows;
  const unit = (code) => Number(units.find((row) => row.code === code).id);
  const category = (await pool.query(`insert into material_categories(
      category_code,category_name_cn,category_level,status,created_by,updated_by,request_id
    ) values('FIX20','映射治理测试',4,'ACTIVE','admin01','admin01',$1) returning id`, [randomUUID()])).rows[0];
  const materials = (await pool.query(`insert into material_master(
      internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,
      inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id
    ) values
      ('CYD-T20-000001','合成物料一',$1,'T20PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','ROHS','MANUAL','admin01','admin01','admin01',$3),
      ('CYD-T20-000002','合成物料二',$1,'T20PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','ROHS','MANUAL','admin01','admin01','admin01',$4),
      ('CYD-T20-000003','合成物料三',$1,'T20PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','ROHS','MANUAL','admin01','admin01','admin01',$5),
      ('CYD-T20-000004','合成物料四',$1,'T20PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','ROHS','MANUAL','admin01','admin01','admin01',$6)
    returning id,internal_material_code`, [category.id, unit("T20PCS"), randomUUID(), randomUUID(), randomUUID(), randomUUID()])).rows;
  const suppliers = (await pool.query(`insert into suppliers(
      supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id
    ) values
      ('SUP-T20-A','合成供应商 A','合成供应商 A','ACTIVE','admin01','admin01',$1),
      ('SUP-T20-B','合成供应商 B','合成供应商 B','ACTIVE','admin01','admin01',$2),
      ('SUP-T20-OFF','停用供应商','停用供应商','INACTIVE','admin01','admin01',$3)
    returning id,supplier_code`, [randomUUID(), randomUUID(), randomUUID()])).rows;
  return {
    unitId: unit("T20PCS"), boxUnitId: unit("T20BOX"), disabledUnitId: unit("T20OFF"),
    materialIds: materials.map((row) => Number(row.id)),
    materialCodes: materials.map((row) => row.internal_material_code),
    supplierA: Number(suppliers.find((row) => row.supplier_code === "SUP-T20-A").id),
    supplierB: Number(suppliers.find((row) => row.supplier_code === "SUP-T20-B").id),
    inactiveSupplier: Number(suppliers.find((row) => row.supplier_code === "SUP-T20-OFF").id),
  };
}

function mappingBody(refs, supplierId, materialIndex, part, overrides = {}) {
  return {
    supplier_id: supplierId,
    material_id: refs.materialIds[materialIndex],
    supplier_item_code: part,
    supplier_item_name: `供应商物料 ${part}`,
    supplier_specification: "受控合成规格",
    manufacturer: "合成制造商",
    mpn: `MPN-${part}`,
    revision: "A",
    purchase_unit_id: refs.unitId,
    conversion_numerator: 1,
    conversion_denominator: 1,
    valid_from: "2026-08-01",
    valid_to: "",
    ...overrides,
  };
}

async function createSubmitApprove(refs, supplierId, materialIndex, part, options = {}) {
  const body = mappingBody(refs, supplierId, materialIndex, part, options.body || {});
  const created = await mappingApi("/api/supplier-mappings", {
    method: "POST", role: options.createRole || "purchase", username: options.createUsername,
    key: options.createKey || randomUUID(), body,
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const submitted = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/submit`, {
    method: "POST", role: options.createRole || "purchase", username: options.createUsername,
    body: { expected_version: created.payload.expected_version },
  });
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.payload));
  const approved = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/approve`, {
    method: "POST", role: options.reviewRole || "operations", username: options.reviewUsername,
    body: { expected_version: submitted.payload.expected_version, review_comment: APPROVAL_COMMENT },
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
  return { body, created, submitted, approved };
}

async function seedAcceptedPurchaseRequest(refs) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true)");
    const customer = (await client.query(`insert into customers(
      customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id
    ) values('CUS-T20','合成客户','合成客户','ACTIVE','admin01','admin01',$1) returning id`, [randomUUID()])).rows[0];
    const project = (await client.query(`insert into business_projects(
      project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,
      current_requirement_version_no,version,request_id,created_by
    ) values('PRJ-00002000',$1,'Mapping RFQ 合成项目','只验证隔离流程','admin01','engineering01','ACCEPTED',
      '2026-12-20',1,4,$2,'admin01') returning id`, [customer.id, randomUUID()])).rows[0];
    const requirement = (await client.query(`insert into project_requirement_versions(
      project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by
    ) values($1,1,'四项采购申请',40,'T20PCS',$2,'admin01') returning id`, [project.id, "a".repeat(64)])).rows[0];
    const packageDigest = "b".repeat(64);
    const planningPackage = (await client.query(`insert into project_planning_packages(
      project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,
      submitted_by,submitted_at,accepted_by,accepted_at,version,request_id
    ) values($1,1,$2,'ACCEPTED','2026-12-20',$3,'engineering01','engineering01',now(),'planning01',now(),3,$4) returning id`,
    [project.id, requirement.id, packageDigest, randomUUID()])).rows[0];
    const plan = (await client.query(`insert into planning_material_requirement_plans(
      project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,
      calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
    ) values($1,$2,1,'2026-12-20','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
    [project.id, planningPackage.id, packageDigest, "c".repeat(64), randomUUID()])).rows[0];
    const planLineIds = [];
    for (let index = 0; index < refs.materialIds.length; index += 1) {
      const line = (await client.query(`insert into planning_material_requirement_lines(
        plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,
        eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
      ) values($1,$2,$3,$4,$5,$6,10,0,0,0,0,10,$7) returning id`, [
        plan.id, index + 1, refs.materialIds[index], refs.unitId,
        { internal_material_code: refs.materialCodes[index], standard_name: `合成物料${index + 1}` },
        String(index + 1).repeat(64), String(index + 5).repeat(64),
      ])).rows[0];
      planLineIds.push(Number(line.id));
    }
    const purchaseRequest = (await client.query(`insert into planning_purchase_requests(
      request_code,plan_id,status,submitted_by,submitted_at,version,request_id
    ) values('PRQ-00002000',$1,'SUBMITTED','planning01',now(),1,$2) returning id`, [plan.id, randomUUID()])).rows[0];
    for (let index = 0; index < refs.materialIds.length; index += 1) {
      await client.query(`insert into planning_purchase_request_lines(
        purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
      ) values($1,$2,$3,$4,$5,10)`, [purchaseRequest.id, planLineIds[index], index + 1, refs.materialIds[index], refs.unitId]);
    }
    await client.query(`update planning_material_requirement_plans set status='ACCEPTED',accepted_by='purchase01',
      accepted_at=now(),version=version+1,updated_at=now() where id=$1`, [plan.id]);
    await client.query(`update planning_purchase_requests set status='ACCEPTED',accepted_by='purchase01',
      accepted_at=now(),updated_at=now() where id=$1`, [purchaseRequest.id]);
    await client.query("commit");
    return Number(purchaseRequest.id);
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

function serviceMeta(role, username, action, body, marker) {
  const requestId = randomUUID();
  return {
    actor: actor(role, username), requestId, operationId: randomUUID(),
    keyDigest: createHash("sha256").update(`key:${marker}`).digest("hex"),
    requestDigest: canonicalDigest(body), method: "POST", route: `/isolated/${marker}`, action,
  };
}

test.before(async () => migrateFresh());
test.beforeEach(async () => {
  await pool.query("truncate app_users,units,material_categories,customers,suppliers,business_code_sequences,idempotency_keys,identity_write_rate_limit_buckets,audit_log restart identity cascade");
});
test.after(async () => pool.end());

test("purchase submits eight mappings; operations preview is zero-write and approval persists a complete receipt", async () => {
  const refs = await seed();
  const pending = [];
  for (const supplierId of [refs.supplierA, refs.supplierB]) {
    for (let index = 0; index < 4; index += 1) {
      const part = `T20-${supplierId}-${index + 1}`;
      const created = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, supplierId, index, part, { conversion_numerator: 2, conversion_denominator: 2 }) });
      assert.equal(created.response.status, 201, JSON.stringify(created.payload));
      let expected = created.payload.expected_version;
      if (!pending.length) {
        const editedBody = mappingBody(refs, supplierId, index, part, { supplier_item_name: "采购修订后的草稿名称", conversion_numerator: 4, conversion_denominator: 4 });
        const edited = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/draft`, { method: "PATCH", body: { expected_version: expected, ...editedBody } });
        assert.equal(edited.response.status, 200, JSON.stringify(edited.payload));
        expected = edited.payload.expected_version;
        const identityChange = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/draft`, {
          method: "PATCH", body: { expected_version: expected, ...editedBody, supplier_item_code: `${part}-CHANGED` },
        });
        assert.equal(identityChange.response.status, 409);
        assert.equal(identityChange.payload.code, "MAPPING_IDENTITY_IMMUTABLE");
      }
      const submitted = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: expected } });
      assert.equal(submitted.response.status, 200, JSON.stringify(submitted.payload));
      pending.push(submitted.payload);
    }
  }
  const purchaseQueue = await mappingApi("/api/supplier-mappings/review-queue", { role: "purchase" });
  assert.equal(purchaseQueue.response.status, 403);
  const queue = await mappingApi("/api/supplier-mappings/review-queue?page_size=100", { role: "operations" });
  assert.equal(queue.response.status, 200);
  assert.equal(queue.payload.data.length, 8);
  assert.ok(queue.payload.data.every((row) => row.status === "PENDING_REVIEW" && row.submitted_by === "purchase01" && !row.reviewed_by));
  const previewTarget = pending[0];
  const beforePreview = (await pool.query(`select
    (select count(*)::integer from supplier_mapping_events) events,
    (select count(*)::integer from audit_log) audits,
    (select count(*)::integer from idempotency_keys) idempotency`)).rows[0];
  const preview = await mappingApi(`/api/supplier-mappings/${previewTarget.mapping_id}/review-preview?expected_version=${previewTarget.expected_version}`, { role: "operations" });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.mapping.mapping_id, previewTarget.mapping_id);
  assert.deepEqual({
    version: preview.payload.mapping.mapping_version,
    cas: preview.payload.mapping.expected_version,
    status: preview.payload.mapping.status,
    supplierStatus: preview.payload.mapping.supplier.status,
    materialStatus: preview.payload.mapping.material.status,
    active: preview.payload.conflicts.active_mapping_count,
    activeConflicts: preview.payload.conflicts.active_conflict_count,
    partConflicts: preview.payload.conflicts.supplier_part_conflict_count,
    canApprove: preview.payload.approval_conditions.can_approve,
    nextVersion: preview.payload.approval_projection.after.mapping_version,
    nextCas: preview.payload.approval_projection.after.cas,
    rfq: preview.payload.approval_projection.creates_downstream.rfq,
  }, {
    version: 1, cas: previewTarget.expected_version, status: "PENDING_REVIEW",
    supplierStatus: "ACTIVE", materialStatus: "ACTIVE", active: 0, activeConflicts: 0, partConflicts: 0,
    canApprove: true, nextVersion: 1, nextCas: previewTarget.expected_version + 1, rfq: false,
  });
  assert.deepEqual([
    preview.payload.lifecycle.created.result,
    preview.payload.lifecycle.submitted.result,
  ], ["SUCCESS", "SUCCESS"]);
  assert.ok(preview.payload.lifecycle.created.actor && preview.payload.lifecycle.created.request_id);
  assert.ok(preview.payload.lifecycle.submitted.actor && preview.payload.lifecycle.submitted.request_id);
  const stalePreview = await mappingApi(`/api/supplier-mappings/${previewTarget.mapping_id}/review-preview?expected_version=1`, { role: "operations" });
  assert.equal(stalePreview.response.status, 200);
  assert.equal(stalePreview.payload.approval_conditions.can_approve, false);
  assert.ok(stalePreview.payload.approval_conditions.issues.some((item) => item.code === "VERSION_CONFLICT"));
  assert.deepEqual((await pool.query(`select
    (select count(*)::integer from supplier_mapping_events) events,
    (select count(*)::integer from audit_log) audits,
    (select count(*)::integer from idempotency_keys) idempotency`)).rows[0], beforePreview);
  for (const item of pending) {
    const approved = await mappingApi(`/api/supplier-mappings/${item.mapping_id}/approve`, {
      method: "POST", role: "operations", body: { expected_version: item.expected_version, review_comment: APPROVAL_COMMENT },
    });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
    assert.equal(approved.payload.status, "ACTIVE");
    assert.equal(approved.payload.actor, "operations01");
    assert.equal(approved.payload.result, "SUCCESS");
    assert.deepEqual({
      decision: approved.payload.approval_receipt.decision,
      result: approved.payload.approval_receipt.result,
      comment: approved.payload.approval_receipt.review_comment,
      beforeVersion: approved.payload.approval_receipt.before.mapping_version,
      beforeCas: approved.payload.approval_receipt.before.cas,
      afterVersion: approved.payload.approval_receipt.after.mapping_version,
      afterCas: approved.payload.approval_receipt.after.cas,
      finalStatus: approved.payload.approval_receipt.final_status,
    }, {
      decision: "APPROVE", result: "SUCCESS", comment: APPROVAL_COMMENT,
      beforeVersion: 1, beforeCas: item.expected_version, afterVersion: 1, afterCas: item.expected_version + 1, finalStatus: "ACTIVE",
    });
  }
  const active = await mappingApi(`/api/supplier-mappings?status=ACTIVE&supplier=${refs.supplierA}&material=CYD-T20&supplier_part_number=T20&mapping_id=${pending[0].mapping_id}&page_size=100`);
  assert.equal(active.response.status, 200);
  assert.equal(active.payload.data.length, 1);
  assert.deepEqual({ supplier: active.payload.data[0].supplier_status, material: active.payload.data[0].material_status }, { supplier: "ACTIVE", material: "ACTIVE" });
  const suffix = await mappingApi(`/api/supplier-mappings/review-queue?status=ACTIVE&supplier_part_number=-1&page_size=100`, { role: "operations" });
  assert.equal(suffix.response.status, 200);
  assert.ok(suffix.payload.data.length >= 2);
  const history = await mappingApi(`/api/supplier-mappings/${pending[0].mapping_id}/review-preview?expected_version=${pending[0].expected_version + 1}`, { role: "operations" });
  assert.equal(history.response.status, 200, JSON.stringify(history.payload));
  assert.equal(history.payload.approval_receipt.review_comment, APPROVAL_COMMENT);
  assert.equal(history.payload.approval_receipt.historical_comment_missing, false);
  assert.equal(history.payload.approval_receipt.request_id.length, 36);
  const counts = (await pool.query(`select
    (select count(*)::integer from supplier_mappings where status='ACTIVE') mappings,
    (select count(*)::integer from supplier_mapping_supplier_part_keys) claims,
    (select count(*)::integer from supplier_mapping_events) events,
    (select count(*)::integer from audit_log where route_code='SUPPLIER_MAPPING' and result='success') successful_audits`)).rows[0];
  assert.deepEqual(counts, { mappings: 8, claims: 8, events: 25, successful_audits: 25 });
  const facts = await pool.query(`select conversion_numerator::integer,conversion_denominator::integer,created_by,submitted_by,reviewed_by,
    content_digest ~ '^[0-9a-f]{64}$' digest_ok,review_outcome from supplier_mappings order by id`);
  assert.ok(facts.rows.every((row) => row.conversion_numerator === 1 && row.conversion_denominator === 1
    && row.created_by === "purchase01" && row.submitted_by === "purchase01" && row.reviewed_by === "operations01"
    && row.digest_ok && row.review_outcome === "APPROVED"));
  assert.equal((await pool.query("select count(*)::integer count from supplier_mapping_events where event_type='APPROVED' and reason=$1", [APPROVAL_COMMENT])).rows[0].count, 8);
  assert.deepEqual((await pool.query(`select
    (select count(*)::integer from procurement_rfqs) rfqs,
    (select count(*)::integer from procurement_supplier_quotes) quotes,
    (select count(*)::integer from procurement_sourcing_awards) awards,
    (select count(*)::integer from purchase_orders) purchase_orders`)).rows[0], { rfqs: 0, quotes: 0, awards: 0, purchase_orders: 0 });
});

test("role boundaries, self-review separation, mandatory rejection reason and immutable returned history are enforced", async () => {
  const refs = await seed();
  const purchasePermissions = permissionsForRole("purchase");
  const operationsPermissions = permissionsForRole("operations");
  const engineeringPermissions = permissionsForRole("engineering");
  assert.ok(["supplier_mapping.read", "supplier_mapping.create", "supplier_mapping.edit_draft", "supplier_mapping.submit"].every((permission) => purchasePermissions.includes(permission)));
  assert.ok(!purchasePermissions.some((permission) => ["supplier_mapping.approve", "supplier_mapping.reject", "supplier_mapping.review_queue", "master.supplier_mapping.manage"].includes(permission)));
  assert.ok(["supplier_mapping.read", "supplier_mapping.review_queue", "supplier_mapping.approve", "supplier_mapping.reject"].every((permission) => operationsPermissions.includes(permission)));
  assert.ok(!operationsPermissions.some((permission) => ["supplier_mapping.create", "supplier_mapping.edit_draft", "supplier_mapping.submit"].includes(permission)));
  assert.ok(engineeringPermissions.includes("supplier_mapping.read"));
  assert.ok(!engineeringPermissions.some((permission) => permission.startsWith("supplier_mapping.") && permission !== "supplier_mapping.read"));

  const created = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 0, "ROLE-001") });
  const operationsEdit = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/draft`, { method: "PATCH", role: "operations", body: { expected_version: 1, ...mappingBody(refs, refs.supplierA, 0, "ROLE-001") } });
  assert.equal(operationsEdit.response.status, 403);
  const engineeringCreate = await mappingApi("/api/supplier-mappings", { method: "POST", role: "engineering", body: mappingBody(refs, refs.supplierA, 1, "ROLE-ENG") });
  assert.equal(engineeringCreate.response.status, 403);
  const submitted = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const purchasePreview = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/review-preview?expected_version=2`, { role: "purchase" });
  assert.equal(purchasePreview.response.status, 403);
  const purchaseApprove = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/approve`, { method: "POST", body: { expected_version: 2, review_comment: APPROVAL_COMMENT } });
  assert.equal(purchaseApprove.response.status, 403);
  const noApprovalComment = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/approve`, { method: "POST", role: "operations", body: { expected_version: 2, review_comment: "" } });
  assert.equal(noApprovalComment.response.status, 400);
  assert.equal(noApprovalComment.payload.code, "REQUEST_VALIDATION_FAILED");
  const reusedRejectReason = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/approve`, { method: "POST", role: "operations", body: { expected_version: 2, reason: "不能复用退回原因" } });
  assert.equal(reusedRejectReason.response.status, 400);
  const noReason = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/reject`, { method: "POST", role: "operations", body: { expected_version: 2, reason: "" } });
  assert.equal(noReason.response.status, 400);
  const rejected = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/reject`, { method: "POST", role: "operations", body: { expected_version: submitted.payload.expected_version, reason: "供应商料号证明不足，请采购补充" } });
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.payload));
  assert.equal(rejected.payload.status, "REJECTED");
  const editRejected = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/draft`, { method: "PATCH", body: { expected_version: rejected.payload.expected_version, ...mappingBody(refs, refs.supplierA, 0, "ROLE-001") } });
  assert.equal(editRejected.response.status, 409);
  await assert.rejects(pool.query("update supplier_mappings set review_reason='直接改写' where mapping_uid=$1", [created.payload.mapping_id]), /SupplierMappingService/);
  await assert.rejects(pool.query("delete from supplier_mappings where mapping_uid=$1", [created.payload.mapping_id]), /cannot be deleted/);
  const next = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/versions`, { method: "POST", body: { expected_version: rejected.payload.expected_version } });
  assert.equal(next.response.status, 201, JSON.stringify(next.payload));
  assert.equal(next.payload.mapping_version, 2);
  assert.equal(next.payload.status, "DRAFT");

  const adminCreated = await mappingApi("/api/supplier-mappings", { method: "POST", role: "admin", body: mappingBody(refs, refs.supplierB, 0, "ADMIN-SELF") });
  const adminSubmitted = await mappingApi(`/api/supplier-mappings/${adminCreated.payload.mapping_id}/submit`, { method: "POST", role: "admin", body: { expected_version: 1 } });
  const selfReview = await mappingApi(`/api/supplier-mappings/${adminCreated.payload.mapping_id}/approve`, { method: "POST", role: "admin", body: { expected_version: adminSubmitted.payload.expected_version, review_comment: APPROVAL_COMMENT } });
  assert.equal(selfReview.response.status, 403);
  assert.equal(selfReview.payload.code, "SELF_REVIEW_FORBIDDEN");
  const otherAdminReview = await mappingApi(`/api/supplier-mappings/${adminCreated.payload.mapping_id}/approve`, { method: "POST", role: "admin", username: "manager01", body: { expected_version: adminSubmitted.payload.expected_version, review_comment: APPROVAL_COMMENT } });
  assert.equal(otherAdminReview.response.status, 200, JSON.stringify(otherAdminReview.payload));
});

test("idempotency, different-body conflict, CAS and concurrent review produce one immutable winner", async () => {
  const refs = await seed();
  const createKey = "mapping-create-idempotency-001";
  const body = mappingBody(refs, refs.supplierA, 0, "IDEM-001");
  const first = await mappingApi("/api/supplier-mappings", { method: "POST", key: createKey, body });
  const replay = await mappingApi("/api/supplier-mappings", { method: "POST", key: createKey, body });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(replay.payload.mapping_id, first.payload.mapping_id);
  const different = await mappingApi("/api/supplier-mappings", { method: "POST", key: createKey, body: { ...body, supplier_item_name: "不同正文" } });
  assert.equal(different.response.status, 409);
  assert.equal(different.payload.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await pool.query("select count(*)::integer count from supplier_mapping_events where event_type='CREATED'")).rows[0].count, 1);

  const stale = await mappingApi(`/api/supplier-mappings/${first.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 2 } });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, "VERSION_CONFLICT");
  const submitted = await mappingApi(`/api/supplier-mappings/${first.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const concurrent = await Promise.all(["approve-concurrent-1", "approve-concurrent-2"].map((key) => mappingApi(
    `/api/supplier-mappings/${first.payload.mapping_id}/approve`,
    { method: "POST", role: "operations", key, body: { expected_version: submitted.payload.expected_version, review_comment: APPROVAL_COMMENT } },
  )));
  assert.deepEqual(concurrent.map((result) => result.response.status).sort(), [200, 409]);
  const winner = concurrent.find((result) => result.response.status === 200);
  const winnerKey = winner === concurrent[0] ? "approve-concurrent-1" : "approve-concurrent-2";
  const winnerReplay = await mappingApi(`/api/supplier-mappings/${first.payload.mapping_id}/approve`, {
    method: "POST", role: "operations", key: winnerKey, body: { expected_version: submitted.payload.expected_version, review_comment: APPROVAL_COMMENT },
  });
  assert.equal(winnerReplay.response.headers.get("Idempotency-Replayed"), "true");
  const conflictingReplay = await mappingApi(`/api/supplier-mappings/${first.payload.mapping_id}/approve`, {
    method: "POST", role: "operations", key: winnerKey,
    body: { expected_version: submitted.payload.expected_version, review_comment: `${APPROVAL_COMMENT}异正文` },
  });
  assert.equal(conflictingReplay.response.status, 409);
  assert.equal(conflictingReplay.payload.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await pool.query("select count(*)::integer count from supplier_mapping_events where event_type='APPROVED'")).rows[0].count, 1);
  assert.deepEqual((await pool.query("select status,version,reviewed_by from supplier_mappings where mapping_uid=$1", [first.payload.mapping_id])).rows, [{ status: "ACTIVE", version: 3, reviewed_by: "operations01" }]);
});

test("supplier-part, active-period, unit, validity and controlled replacement constraints fail closed", async () => {
  const refs = await seed();
  const normalized = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 0, "  normalize   me  ", { conversion_numerator: 2, conversion_denominator: 2 }) });
  assert.equal(normalized.response.status, 201);
  assert.deepEqual((await pool.query("select supplier_item_code_normalized,conversion_numerator::integer,conversion_denominator::integer from supplier_mappings where mapping_uid=$1", [normalized.payload.mapping_id])).rows[0], {
    supplier_item_code_normalized: "NORMALIZE ME", conversion_numerator: 1, conversion_denominator: 1,
  });
  const duplicatePart = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 1, "NORMALIZE ME") });
  assert.equal(duplicatePart.response.status, 409);
  assert.equal(duplicatePart.payload.code, "SUPPLIER_PART_NUMBER_CONFLICT");
  const crossSupplier = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierB, 1, "NORMALIZE ME") });
  assert.equal(crossSupplier.response.status, 201);

  const invalidPeriod = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 2, "BAD-DATE", { valid_from: "2026-08-02", valid_to: "2026-08-02" }) });
  assert.equal(invalidPeriod.response.status, 400);
  const disabledUnit = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 2, "BAD-UNIT", { purchase_unit_id: refs.disabledUnitId }) });
  assert.equal(disabledUnit.response.status, 422);
  assert.equal(disabledUnit.payload.code, "SUPPLIER_UNIT_NOT_ACTIVE");
  const inactiveSupplier = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.inactiveSupplier, 2, "BAD-SUPPLIER") });
  assert.equal(inactiveSupplier.response.status, 422);
  assert.equal(inactiveSupplier.payload.code, "SUPPLIER_NOT_ACTIVE");

  const active = await createSubmitApprove(refs, refs.supplierA, 2, "PERIOD-A");
  const overlapCreated = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 2, "PERIOD-B") });
  const overlapSubmitted = await mappingApi(`/api/supplier-mappings/${overlapCreated.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const overlapPreview = await mappingApi(`/api/supplier-mappings/${overlapCreated.payload.mapping_id}/review-preview?expected_version=${overlapSubmitted.payload.expected_version}`, { role: "operations" });
  assert.equal(overlapPreview.response.status, 200);
  assert.equal(overlapPreview.payload.approval_conditions.can_approve, false);
  assert.equal(overlapPreview.payload.conflicts.active_conflict_count, 1);
  assert.ok(overlapPreview.payload.approval_conditions.issues.some((item) => item.code === "SUPPLIER_MAPPING_ACTIVE_CONFLICT"));
  const overlapReview = await mappingApi(`/api/supplier-mappings/${overlapCreated.payload.mapping_id}/approve`, { method: "POST", role: "operations", body: { expected_version: overlapSubmitted.payload.expected_version, review_comment: APPROVAL_COMMENT } });
  assert.equal(overlapReview.response.status, 409);
  assert.equal(overlapReview.payload.code, "SUPPLIER_MAPPING_ACTIVE_CONFLICT");
  assert.equal((await pool.query("select status from supplier_mappings where mapping_uid=$1", [overlapCreated.payload.mapping_id])).rows[0].status, "PENDING_REVIEW");

  const next = await mappingApi(`/api/supplier-mappings/${active.created.payload.mapping_id}/versions`, { method: "POST", body: { expected_version: active.approved.payload.expected_version } });
  assert.equal(next.response.status, 201);
  const nextBody = mappingBody(refs, refs.supplierA, 2, "PERIOD-A", { supplier_item_name: "受控替代版本" });
  const nextEdit = await mappingApi(`/api/supplier-mappings/${next.payload.mapping_id}/draft`, { method: "PATCH", body: { expected_version: next.payload.expected_version, ...nextBody } });
  const nextSubmit = await mappingApi(`/api/supplier-mappings/${next.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: nextEdit.payload.expected_version } });
  const nextApprove = await mappingApi(`/api/supplier-mappings/${next.payload.mapping_id}/approve`, { method: "POST", role: "operations", username: "operations02", body: { expected_version: nextSubmit.payload.expected_version, review_comment: APPROVAL_COMMENT } });
  assert.equal(nextApprove.response.status, 200, JSON.stringify(nextApprove.payload));
  assert.deepEqual((await pool.query("select mapping_version_no,status,superseded_by_mapping_version_id is not null superseded from supplier_mappings where mapping_uid=$1 order by mapping_version_no", [active.created.payload.mapping_id])).rows, [
    { mapping_version_no: 1, status: "INACTIVE", superseded: true },
    { mapping_version_no: 2, status: "ACTIVE", superseded: false },
  ]);
});

test("approval preview and transaction both fail closed when Supplier or Material becomes inactive", async () => {
  const refs = await seed();
  const created = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 0, "SOURCE-STATUS") });
  const submitted = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const path = `/api/supplier-mappings/${created.payload.mapping_id}/review-preview?expected_version=${submitted.payload.expected_version}`;

  await pool.query("update suppliers set status='INACTIVE' where id=$1", [refs.supplierA]);
  const supplierPreview = await mappingApi(path, { role: "operations" });
  assert.equal(supplierPreview.payload.approval_conditions.can_approve, false);
  assert.ok(supplierPreview.payload.approval_conditions.issues.some((item) => item.code === "SUPPLIER_NOT_ACTIVE"));
  const supplierApproval = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/approve`, {
    method: "POST", role: "operations", body: { expected_version: submitted.payload.expected_version, review_comment: APPROVAL_COMMENT },
  });
  assert.equal(supplierApproval.response.status, 422);
  assert.equal(supplierApproval.payload.code, "SUPPLIER_NOT_ACTIVE");

  await pool.query("update suppliers set status='ACTIVE' where id=$1", [refs.supplierA]);
  await pool.query("update material_master set material_status='INACTIVE' where id=$1", [refs.materialIds[0]]);
  const materialPreview = await mappingApi(path, { role: "operations" });
  assert.equal(materialPreview.payload.approval_conditions.can_approve, false);
  assert.ok(materialPreview.payload.approval_conditions.issues.some((item) => item.code === "MATERIAL_NOT_FORMAL_ACTIVE"));
  const materialApproval = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/approve`, {
    method: "POST", role: "operations", body: { expected_version: submitted.payload.expected_version, review_comment: APPROVAL_COMMENT },
  });
  assert.equal(materialApproval.response.status, 422);
  assert.equal(materialApproval.payload.code, "MATERIAL_NOT_FORMAL_ACTIVE");
  assert.equal((await pool.query("select count(*)::integer count from supplier_mapping_events where mapping_uid=$1 and event_type='APPROVED'", [created.payload.mapping_id])).rows[0].count, 0);
  assert.equal((await pool.query("select status from supplier_mappings where mapping_uid=$1", [created.payload.mapping_id])).rows[0].status, "PENDING_REVIEW");
});

test("an existing APPROVED event without a comment remains truthful and reopens as historical comment missing", async () => {
  const refs = await seed();
  const created = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 0, "HISTORICAL-NO-COMMENT") });
  const submitted = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const requestId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.supplier_mapping_service_write','allowed',true)");
    const row = (await client.query(`update supplier_mappings set
      status='ACTIVE',reviewed_by='operations01',reviewed_at=now(),reviewed_request_id=$2,
      review_outcome='APPROVED',review_reason='',version=version+1,updated_by='operations01',updated_at=now(),request_id=$2
      where mapping_uid=$1 and version=$3 returning id,mapping_version_no`,
    [created.payload.mapping_id, requestId, submitted.payload.expected_version])).rows[0];
    await client.query(`insert into supplier_mapping_events(
      mapping_uid,mapping_version_id,mapping_version_no,event_type,from_status,to_status,actor,result,reason,request_id
    ) values($1,$2,$3,'APPROVED','PENDING_REVIEW','ACTIVE','operations01','SUCCESS','',$4)`,
    [created.payload.mapping_id, row.id, row.mapping_version_no, requestId]);
    await client.query(`insert into audit_log(
      username,action,detail,request_id,result,route_code,old_version,new_version,retention_until
    ) values('operations01','SUPPLIER_MAPPING_APPROVED',$1,$2,'success','SUPPLIER_MAPPING',$3,$4,now()+interval '1095 days')`,
    [{ mapping_id: created.payload.mapping_id, mapping_version_id: Number(row.id) }, requestId, submitted.payload.expected_version, submitted.payload.expected_version + 1]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }

  const preview = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/review-preview?expected_version=${submitted.payload.expected_version + 1}`, { role: "operations" });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.approval_receipt.review_comment, null);
  assert.equal(preview.payload.approval_receipt.review_comment_display, "历史批准未采集审核意见");
  assert.equal(preview.payload.approval_receipt.historical_comment_missing, true);
  assert.deepEqual(preview.payload.approval_receipt.before, { mapping_version: 1, cas: submitted.payload.expected_version });
  assert.deepEqual(preview.payload.approval_receipt.after, { mapping_version: 1, cas: submitted.payload.expected_version + 1 });
  assert.equal((await pool.query("select reason from supplier_mapping_events where request_id=$1", [requestId])).rows[0].reason, "");
});

test("legacy formal material base_uom resolves to one enabled stable Unit for mapping and RFQ coverage", async () => {
  const refs = await seed();
  await pool.query("update material_master set base_unit_id=null where id=$1", [refs.materialIds[0]]);
  await pool.query("update material_master set base_unit_id=null,base_uom='NO_SUCH_UNIT' where id=$1", [refs.materialIds[1]]);

  const options = await mappingApi(`/api/supplier-mappings/options?type=material&limit=20&q=${refs.materialCodes[0]}`);
  assert.equal(options.response.status, 200);
  assert.deepEqual(options.payload.data.map((row) => ({ id: row.id, base_unit_id: row.base_unit_id, base_unit: row.base_unit })), [
    { id: refs.materialIds[0], base_unit_id: refs.unitId, base_unit: "T20PCS" },
  ]);
  const invalidOptions = await mappingApi(`/api/supplier-mappings/options?type=material&limit=20&q=${refs.materialCodes[1]}`);
  assert.deepEqual(invalidOptions.payload.data, []);
  const invalidCreate = await mappingApi("/api/supplier-mappings", {
    method: "POST", body: mappingBody(refs, refs.supplierA, 1, "LEGACY-INVALID-UNIT"),
  });
  assert.equal(invalidCreate.response.status, 422);
  assert.equal(invalidCreate.payload.code, "MATERIAL_BASE_UNIT_INVALID");

  await createSubmitApprove(refs, refs.supplierA, 0, "LEGACY-BASE-UOM");
  const purchaseRequestId = await seedAcceptedPurchaseRequest(refs);
  const coverage = await sourcingApi(`/api/procurement/rfqs/coverage?purchase_request_id=${purchaseRequestId}`);
  assert.equal(coverage.response.status, 200);
  const supplier = coverage.payload.data.find((row) => row.supplier_id === refs.supplierA);
  assert.deepEqual({ covered: supplier.covered_count, required: supplier.required_count, selectable: supplier.selectable }, {
    covered: 1, required: 4, selectable: false,
  });
  assert.deepEqual(supplier.missing.map((row) => row.material_id), refs.materialIds.slice(1));
});

test("fault injection rolls back mapping, claim, lifecycle event, audit and idempotency atomically", async () => {
  const refs = await seed();
  const body = mappingBody(refs, refs.supplierA, 0, "FAULT-CREATE");
  const createMeta = serviceMeta("purchase", "purchase01", "SUPPLIER_MAPPING_CREATED", body, "fault-create");
  const createService = new SupplierMappingService(new SupplierMappingRepository(pool), (checkpoint) => {
    if (checkpoint === "after_mapping_draft_created") throw new Error("forced create failure");
  });
  await assert.rejects(createService.create(createMeta, body), (error) => error.code === "INTERNAL_ERROR");
  assert.deepEqual((await pool.query(`select
    (select count(*)::integer from supplier_mappings) mappings,
    (select count(*)::integer from supplier_mapping_supplier_part_keys) claims,
    (select count(*)::integer from supplier_mapping_events) events,
    (select count(*)::integer from audit_log where request_id=$1) audits,
    (select count(*)::integer from idempotency_keys where key_digest=$2) idempotency`, [createMeta.requestId, createMeta.keyDigest])).rows[0], {
    mappings: 0, claims: 0, events: 0, audits: 0, idempotency: 0,
  });

  const created = await mappingApi("/api/supplier-mappings", { method: "POST", body: mappingBody(refs, refs.supplierA, 0, "FAULT-REVIEW") });
  const submitted = await mappingApi(`/api/supplier-mappings/${created.payload.mapping_id}/submit`, { method: "POST", body: { expected_version: 1 } });
  const reviewBody = { expected_version: submitted.payload.expected_version, review_comment: APPROVAL_COMMENT };
  const reviewMeta = serviceMeta("operations", "operations01", "SUPPLIER_MAPPING_APPROVED", reviewBody, "fault-review");
  const reviewService = new SupplierMappingService(new SupplierMappingRepository(pool), (checkpoint) => {
    if (checkpoint === "after_mapping_reviewed") throw new Error("forced review failure");
  });
  await assert.rejects(reviewService.review(created.payload.mapping_id, "APPROVE", reviewMeta, reviewBody), (error) => error.code === "INTERNAL_ERROR");
  assert.deepEqual((await pool.query("select status,version,reviewed_by from supplier_mappings where mapping_uid=$1", [created.payload.mapping_id])).rows[0], {
    status: "PENDING_REVIEW", version: 2, reviewed_by: null,
  });
  assert.equal((await pool.query("select count(*)::integer count from supplier_mapping_events where mapping_uid=$1", [created.payload.mapping_id])).rows[0].count, 2);
  assert.equal((await pool.query("select count(*)::integer count from audit_log where request_id=$1", [reviewMeta.requestId])).rows[0].count, 0);
  assert.equal((await pool.query("select count(*)::integer count from idempotency_keys where key_digest=$1", [reviewMeta.keyDigest])).rows[0].count, 0);
});

test("RFQ coverage is 0/4 then 3/4 then 4/4; only complete supplier can create a draft without quote, award or PO", async () => {
  const refs = await seed();
  const purchaseRequestId = await seedAcceptedPurchaseRequest(refs);
  const zero = await sourcingApi(`/api/procurement/rfqs/coverage?purchase_request_id=${purchaseRequestId}`);
  assert.equal(zero.response.status, 200, JSON.stringify(zero.payload));
  const zeroA = zero.payload.data.find((row) => row.supplier_id === refs.supplierA);
  const zeroB = zero.payload.data.find((row) => row.supplier_id === refs.supplierB);
  assert.deepEqual([zeroA.covered_count, zeroA.required_count, zeroA.selectable], [0, 4, false]);
  assert.deepEqual([zeroB.covered_count, zeroB.required_count, zeroB.selectable], [0, 4, false]);
  assert.deepEqual(zeroA.missing.map((item) => [item.material_id, item.internal_material_code]), refs.materialIds.map((id, index) => [id, refs.materialCodes[index]]));
  assert.ok(!("mapping_snapshots" in zeroA));

  await createSubmitApprove(refs, refs.supplierB, 0, "NOT-ONE-TO-ONE", { body: { conversion_numerator: 2, conversion_denominator: 1 } });
  for (let index = 0; index < 3; index += 1) await createSubmitApprove(refs, refs.supplierA, index, `COVER-A-${index + 1}`);
  const partial = await sourcingApi(`/api/procurement/rfqs/coverage?purchase_request_id=${purchaseRequestId}`);
  const partialA = partial.payload.data.find((row) => row.supplier_id === refs.supplierA);
  const partialB = partial.payload.data.find((row) => row.supplier_id === refs.supplierB);
  assert.deepEqual([partialA.covered_count, partialA.required_count, partialA.selectable], [3, 4, false]);
  assert.deepEqual([partialB.covered_count, partialB.required_count, partialB.selectable], [0, 4, false]);
  assert.deepEqual(partialA.missing.map((item) => [item.material_id, item.internal_material_code]), [[refs.materialIds[3], refs.materialCodes[3]]]);
  const blocked = await sourcingApi("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: purchaseRequestId, supplier_ids: [refs.supplierA], response_deadline: "2026-12-01", expected_version: 1,
  } });
  assert.equal(blocked.response.status, 422);
  assert.equal(blocked.payload.code, "SUPPLIER_MAPPING_INCOMPLETE");
  assert.match(blocked.payload.message, new RegExp(`Supplier ${refs.supplierA} / SUP-T20-A 缺少：`));
  assert.match(blocked.payload.message, new RegExp(`Material ${refs.materialIds[3]} / ${refs.materialCodes[3]}`));
  assert.equal((await pool.query("select count(*)::integer count from procurement_rfqs")).rows[0].count, 0);

  await createSubmitApprove(refs, refs.supplierA, 3, "COVER-A-4");
  const complete = await sourcingApi(`/api/procurement/rfqs/coverage?purchase_request_id=${purchaseRequestId}`);
  const completeA = complete.payload.data.find((row) => row.supplier_id === refs.supplierA);
  assert.deepEqual([completeA.covered_count, completeA.required_count, completeA.selectable, completeA.missing.length], [4, 4, true, 0]);
  const created = await sourcingApi("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: purchaseRequestId, supplier_ids: [refs.supplierA], response_deadline: "2026-12-01", expected_version: 1,
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, "DRAFT");
  const counts = (await pool.query(`select
    (select count(*)::integer from procurement_rfqs) rfqs,
    (select count(*)::integer from procurement_rfq_lines) rfq_lines,
    (select count(*)::integer from procurement_rfq_suppliers) rfq_suppliers,
    (select count(*)::integer from procurement_supplier_quotes) quotes,
    (select count(*)::integer from procurement_sourcing_awards) awards,
    (select count(*)::integer from purchase_orders) purchase_orders`)).rows[0];
  assert.deepEqual(counts, { rfqs: 1, rfq_lines: 4, rfq_suppliers: 1, quotes: 0, awards: 0, purchase_orders: 0 });
});

test("CSRF, body size and server-owned fields are rejected without a mapping write", async () => {
  const refs = await seed();
  const noCsrf = await mappingApi("/api/supplier-mappings", { method: "POST", csrf: false, body: mappingBody(refs, refs.supplierA, 0, "NO-CSRF") });
  assert.equal(noCsrf.response.status, 403);
  assert.equal(noCsrf.payload.code, "CSRF_INVALID");
  const serverField = await mappingApi("/api/supplier-mappings", { method: "POST", body: { ...mappingBody(refs, refs.supplierA, 0, "SERVER-FIELD"), status: "ACTIVE" } });
  assert.equal(serverField.response.status, 400);
  const tooLarge = await mappingApi("/api/supplier-mappings", { method: "POST", body: JSON.stringify({ padding: "x".repeat(70 * 1024) }) });
  assert.equal(tooLarge.response.status, 400);
  assert.equal((await pool.query("select count(*)::integer count from supplier_mappings")).rows[0].count, 0);
});
