import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementSourcingApi } from "../app/lib/procurement-sourcing-selfhost/handler.ts";
import { ProcurementSourcingRepository } from "../app/lib/procurement-sourcing-selfhost/repository.ts";
import { ProcurementSourcingService } from "../app/lib/procurement-sourcing-selfhost/service.ts";
import { canonicalDigest } from "../app/lib/procurement-sourcing-selfhost/validation.ts";
import { withSupplierMappingFixtureTriggersDisabled } from "./helpers/supplier-mapping-fixture.mjs";

const REQUIRED_DATABASE = "procurement_sourcing_test_fix22_20260805";
const REQUIRED_CONFIRMATION = "ISOLATED_FIX22_SYNTHETIC_ONLY";
const databaseUrl = process.env.TEST_PROCUREMENT_SOURCING_DATABASE_URL || "";
let configuredDatabase = "";
try { configuredDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")); } catch { configuredDatabase = ""; }
if (configuredDatabase !== REQUIRED_DATABASE) {
  throw new Error(`TEST_PROCUREMENT_SOURCING_DATABASE_URL must target the exact isolated ${REQUIRED_DATABASE} database`);
}
if (process.env.ERP_PROCUREMENT_SOURCING_TEST_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_PROCUREMENT_SOURCING_TEST_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  application_name: "rfq-binding-fix19-postgres-test",
});
const digest = (value) => createHash("sha256").update(value).digest("hex");
const actor = (role, username = `${role}01`) => ({
  username,
  display_name: role,
  role,
  is_active: true,
  must_change_password: false,
  version: 1,
  last_login_at: null,
  permissions: permissionsForRole(role),
});

async function assertIsolatedDatabase() {
  assert.equal((await pool.query("select current_database() name")).rows[0]?.name, REQUIRED_DATABASE);
}

async function api(path, { method = "GET", role = "purchase", username, key = randomUUID(), body } = {}) {
  const requestId = randomUUID();
  const headers = new Headers({ "X-Request-ID": requestId, "X-CSRF-Token": "fix19-csrf" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  const request = new Request(`http://isolated.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleProcurementSourcingApi(request, {
    pool,
    actor: actor(role, username || `${role}01`),
    requestId,
    requireCsrf: () => {
      if (headers.get("X-CSRF-Token") !== "fix19-csrf") {
        throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 });
      }
    },
  });
  assert.ok(response);
  return { response, payload: await response.json(), requestId };
}

async function createPurchaseRequest(client, fixture, sequence, status = "ACCEPTED") {
  const project = await client.query(
    `insert into business_projects(
      project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,
      target_delivery_date,current_requirement_version_no,version,request_id,created_by
    ) values($1,$2,$3,'FIX-19 隔离采购申请','admin01','engineering01','ACCEPTED',
      '2099-10-30',1,4,$4,'admin01') returning id`,
    [`PRJ-${String(sequence).padStart(8, "0")}`, fixture.customerId, `FIX-19 项目 ${sequence}`, randomUUID()],
  );
  const projectId = Number(project.rows[0].id);
  const requirement = await client.query(
    `insert into project_requirement_versions(
      project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by
    ) values($1,1,'FIX-19 固化需求',40,'PCS',$2,'admin01') returning id`,
    [projectId, digest(`requirement-${sequence}`)],
  );
  const packageRow = await client.query(
    `insert into project_planning_packages(
      project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,
      prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id
    ) values($1,1,$2,'ACCEPTED','2099-10-30',$3,'engineering01','engineering01',now(),
      'planning01',now(),3,$4) returning id`,
    [projectId, requirement.rows[0].id, digest(`package-${sequence}`), randomUUID()],
  );
  const plan = await client.query(
    `insert into planning_material_requirement_plans(
      project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
      source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
    ) values($1,$2,1,'2099-10-30','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
    [projectId, packageRow.rows[0].id, digest(`package-${sequence}`), digest(`calculation-${sequence}`), randomUUID()],
  );
  const planId = Number(plan.rows[0].id);
  const planLineIds = [];
  for (const [index, materialId] of fixture.materialIds.entries()) {
    const line = await client.query(
      `insert into planning_material_requirement_lines(
        plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,
        stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
      ) values($1,$2,$3,$4,$5,$6,10,0,0,0,0,10,$7) returning id`,
      [
        planId,
        index + 1,
        materialId,
        fixture.unitId,
        { internal_material_code: `CYD-FIX19-${String(materialId).padStart(6, "0")}`, standard_name: `FIX-19 物料 ${materialId}` },
        digest(`material-${sequence}-${materialId}`),
        digest(`source-${sequence}-${materialId}`),
      ],
    );
    planLineIds.push(Number(line.rows[0].id));
  }
  const purchaseRequest = await client.query(
    `insert into planning_purchase_requests(
      request_code,plan_id,status,submitted_by,submitted_at,version,request_id
    ) values($1,$2,'SUBMITTED','planning01',now(),1,$3) returning id`,
    [`PRQ-${String(sequence).padStart(8, "0")}`, planId, randomUUID()],
  );
  const purchaseRequestId = Number(purchaseRequest.rows[0].id);
  for (const [index, materialId] of fixture.materialIds.entries()) {
    await client.query(
      `insert into planning_purchase_request_lines(
        purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
      ) values($1,$2,$3,$4,$5,10)`,
      [purchaseRequestId, planLineIds[index], index + 1, materialId, fixture.unitId],
    );
  }
  if (status === "ACCEPTED") {
    await client.query(
      `update planning_material_requirement_plans set
        status='ACCEPTED',accepted_by='purchase01',accepted_at=now(),version=version+1,updated_at=now()
      where id=$1`,
      [planId],
    );
    await client.query(
      `update planning_purchase_requests set
        status='ACCEPTED',accepted_by='purchase01',accepted_at=now(),updated_at=now()
      where id=$1`,
      [purchaseRequestId],
    );
  }
  return purchaseRequestId;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true)",
    );
    await client.query(
      `insert into app_users(username,display_name,role,password_hash) values
        ('admin01','管理员','admin','x'),('planning01','计划','planning','x'),
        ('purchase01','采购','purchase','x'),('engineering01','工程','engineering','x')`,
    );
    const unit = await client.query(
      "insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id",
    );
    const unitId = Number(unit.rows[0].id);
    const category = await client.query(
      `insert into material_categories(
        category_code,category_name_cn,category_level,status,created_by,updated_by,request_id
      ) values('FIX19-COMP','FIX-19 隔离物料',1,'ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    );
    const materialIds = [533, 534, 535, 536];
    for (const materialId of materialIds) {
      await client.query(
        `insert into material_master(
          id,internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,
          procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,
          last_modified_by,created_by,updated_by,request_id
        ) values($1,$2,$3,$4,'PCS',$5,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',
          'admin01','admin01','admin01',$6)`,
        [materialId, `CYD-FIX19-${String(materialId).padStart(6, "0")}`, `FIX-19 物料 ${materialId}`, category.rows[0].id, unitId, randomUUID()],
      );
    }
    await client.query("select setval(pg_get_serial_sequence('material_master','id'),536,true)");
    const customer = await client.query(
      `insert into customers(
        customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id
      ) values('CUS-FIX19','FIX-19 客户','FIX-19 客户','ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    );
    const fixture = { unitId, materialIds, customerId: Number(customer.rows[0].id) };
    const accepted = [];
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      accepted.push(await createPurchaseRequest(client, fixture, sequence));
    }
    const submitted = await createPurchaseRequest(client, fixture, 7, "SUBMITTED");

    const supplierDefinitions = [
      ["SUP-000001", "FIX-19 供应商 A", "ACTIVE"],
      ["SUP-000002", "FIX-19 供应商 B", "ACTIVE"],
      ["SUP-000003", "FIX-19 停用供应商", "INACTIVE"],
      ["SUP-000004", "FIX-19 无映射供应商", "ACTIVE"],
    ];
    const supplierIds = [];
    for (const [supplierCode, supplierName, status] of supplierDefinitions) {
      const supplier = await client.query(
        `insert into suppliers(
          supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id
        ) values($1,$2,$2,$3,'admin01','admin01',$4) returning id`,
        [supplierCode, supplierName, status, randomUUID()],
      );
      supplierIds.push(Number(supplier.rows[0].id));
    }
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      for (const supplierId of supplierIds.slice(0, 3)) {
        for (const materialId of materialIds) {
          await client.query(
            `insert into supplier_mappings(
              material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,
              purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,
              created_by,updated_by,request_id
            ) values($1,$2,$3,$4,$5,'PCS',$6,1,1,'ACTIVE',
              ((statement_timestamp() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai'),
              'admin01','admin01',$7)`,
            [
              materialId,
              supplierId,
              supplierDefinitions[supplierId - 1][1],
              supplierDefinitions[supplierId - 1][0],
              `PART-${supplierId}-${materialId}`,
              unitId,
              randomUUID(),
            ],
          );
        }
      }
    });
    await client.query("commit");
    return {
      accepted,
      submitted,
      supplierA: supplierIds[0],
      supplierB: supplierIds[1],
      inactiveSupplier: supplierIds[2],
      noMappingSupplier: supplierIds[3],
      materialIds,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function structuralCounts() {
  const row = (await pool.query(`select
    (select count(*)::int from procurement_rfqs) rfqs,
    (select count(*)::int from procurement_rfq_lines) rfq_lines,
    (select count(*)::int from procurement_rfq_suppliers) rfq_suppliers,
    (select count(*)::int from procurement_sourcing_events) sourcing_events,
    (select count(*)::int from idempotency_keys) idempotency_records,
    (select count(*)::int from audit_log where result='success' and route_code='PROCUREMENT_SOURCING') success_audits`)).rows[0];
  return row;
}

async function downstreamCounts() {
  return (await pool.query(`select
    (select count(*)::int from procurement_supplier_quotes) quotes,
    (select count(*)::int from procurement_sourcing_awards) awards,
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from purchase_delivery_plans) delivery_plans,
    (select count(*)::int from purchase_receipts) receipts,
    (select count(*)::int from inventory_ledger_entries) ledger_entries,
    (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
    (select count(*)::int from production_work_orders) work_orders`)).rows[0];
}

async function convertToLegacyDraft(rfqId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      await client.query("delete from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId]);
      await client.query("delete from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_CREATED'", [rfqId]);
      await client.query("update procurement_rfqs set traceability_version=1 where id=$1", [rfqId]);
    });
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function createLegacyDraft(fixture, requestIndex = 0, supplierIds = [fixture.supplierA, fixture.supplierB]) {
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[requestIndex], supplier_ids: supplierIds,
    response_deadline: "2099-10-15", expected_version: 1,
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  await convertToLegacyDraft(created.payload.rfq_id);
  return created.payload.rfq_id;
}

async function mappingPreview(rfqId, expectedVersion = 1, options = {}) {
  return api(`/api/procurement/rfqs/${rfqId}/mapping-bindings/preview?expected_version=${expectedVersion}`, options);
}

async function previewWriteCounts(rfqId) {
  return (await pool.query(`select
    (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1) bindings,
    (select count(*)::int from procurement_sourcing_events where rfq_id=$1) events,
    (select count(*)::int from audit_log) audits,
    (select count(*)::int from idempotency_keys) idempotency,
    (select count(*)::int from procurement_supplier_quotes where rfq_id=$1) quotes,
    (select count(*)::int from procurement_sourcing_awards where rfq_id=$1) awards,
    (select count(distinct link.purchase_order_id)::int from procurement_award_po_line_links link
      join procurement_sourcing_awards award on award.id=link.award_id where award.rfq_id=$1) purchase_orders`, [rfqId])).rows[0];
}

async function expectedScopeDigest(rfqId) {
  const rfq = (await pool.query(
    "select id::int,purchase_request_id::int,round_no::int,response_deadline::text,currency_code from procurement_rfqs where id=$1",
    [rfqId],
  )).rows[0];
  const lines = (await pool.query(
    `select id::int,purchase_request_line_id::int,material_id::int,unit_id::int,
      requested_quantity::text,line_no::int from procurement_rfq_lines where rfq_id=$1 order by id`,
    [rfqId],
  )).rows;
  const suppliers = (await pool.query(
    "select id::int,supplier_id::int from procurement_rfq_suppliers where rfq_id=$1 order by id",
    [rfqId],
  )).rows;
  const mappings = (await pool.query(
    `select rfq_supplier_id::int,rfq_line_id::int,mapping_uid::text mapping_id,
      mapping_version_no::int mapping_version,mapping_row_version::int
    from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 order by rfq_supplier_id,rfq_line_id`,
    [rfqId],
  )).rows;
  return canonicalDigest({
    rfq_id: rfq.id,
    purchase_request_id: rfq.purchase_request_id,
    round_no: rfq.round_no,
    response_deadline: rfq.response_deadline,
    currency_code: rfq.currency_code,
    lines: lines.map((line) => ({
      rfq_line_id: line.id,
      purchase_request_line_id: line.purchase_request_line_id,
      material_id: line.material_id,
      unit_id: line.unit_id,
      requested_quantity: line.requested_quantity,
      line_no: line.line_no,
    })),
    suppliers: suppliers.map((supplier) => ({ rfq_supplier_id: supplier.id, supplier_id: supplier.supplier_id })),
    mappings,
  });
}

async function assertMappingExclusionConstraint() {
  assert.equal(Number((await pool.query(`select count(*) count from pg_constraint
    where conrelid='supplier_mappings'::regclass and conname='supplier_mappings_active_material_period_excl'`)).rows[0].count), 1);
}

test.beforeEach(async () => {
  await assertIsolatedDatabase();
  await assertMappingExclusionConstraint();
  await pool.query(
    "truncate app_users,units,material_categories,customers,suppliers,business_code_sequences,idempotency_keys,identity_write_rate_limit_buckets,audit_log restart identity cascade",
  );
});
test.after(async () => {
  await assertIsolatedDatabase();
  await assertMappingExclusionConstraint();
  await pool.end();
});

test("stable Purchase Request ID 1 creates one four-line RFQ and normalized replay returns it", async () => {
  const fixture = await seed();
  assert.equal(fixture.accepted[0], 1);
  assert.deepEqual([fixture.supplierA, fixture.supplierB], [1, 2]);
  const key = "fix19-create-rfq-stable-id";
  const body = {
    purchase_request_id: 1,
    supplier_ids: [2, 1],
    response_deadline: "2099-10-15",
    expected_version: 1,
  };
  const created = await api("/api/procurement/rfqs", { method: "POST", key, body });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, "DRAFT");
  const rfqId = created.payload.rfq_id;

  const header = (await pool.query(
    "select id::int,purchase_request_id::int,status,response_deadline::text,traceability_version::int from procurement_rfqs where id=$1",
    [rfqId],
  )).rows[0];
  assert.deepEqual(header, {
    id: rfqId,
    purchase_request_id: 1,
    status: "DRAFT",
    response_deadline: "2099-10-15",
    traceability_version: 2,
  });
  const lines = (await pool.query(
    `select lines.line_no::int,lines.purchase_request_line_id::int,lines.material_id::int,
      lines.requested_quantity::numeric(24,6)::text,lines.required_date::text
    from procurement_rfq_lines lines where rfq_id=$1 order by line_no`,
    [rfqId],
  )).rows;
  assert.deepEqual(lines.map((line) => line.material_id), fixture.materialIds);
  assert.deepEqual(lines.map((line) => line.requested_quantity), Array(4).fill("10.000000"));
  assert.deepEqual(lines.map((line) => line.required_date), Array(4).fill("2099-10-30"));
  assert.equal(new Set(lines.map((line) => line.purchase_request_line_id)).size, 4);
  const boundSuppliers = (await pool.query(
    "select supplier_id::int from procurement_rfq_suppliers where rfq_id=$1 order by supplier_id",
    [rfqId],
  )).rows.map((row) => row.supplier_id);
  assert.deepEqual(boundSuppliers, [1, 2]);
  const mappingBindings = (await pool.query(
    `select binding.supplier_id::int,binding.material_id::int,binding.mapping_uid::text,
      binding.mapping_version_no::int,binding.mapping_row_version::int,binding.supplier_part_number,
      binding.binding_source,binding.binding_status,binding.conversion_numerator::text,binding.conversion_denominator::text,
      purchase_unit.code purchase_unit_code,base_unit.code base_unit_code,binding.valid_from,binding.valid_to,mapping.status current_status
    from procurement_rfq_supplier_line_mapping_bindings binding
    join units purchase_unit on purchase_unit.id=binding.purchase_unit_id
    join material_master material on material.id=binding.material_id
    left join units base_unit on base_unit.id=material.base_unit_id
    join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
    where binding.rfq_id=$1 order by binding.supplier_id,binding.material_id`,
    [rfqId],
  )).rows;
  assert.equal(mappingBindings.length, 8);
  assert.deepEqual(mappingBindings.map((row) => [row.supplier_id, row.material_id]), [
    [1, 533], [1, 534], [1, 535], [1, 536], [2, 533], [2, 534], [2, 535], [2, 536],
  ]);
  assert.ok(mappingBindings.every((row) => row.mapping_uid && row.mapping_version_no === 1 && row.mapping_row_version > 0
    && row.supplier_part_number === `PART-${row.supplier_id}-${row.material_id}`
    && row.binding_source === "RFQ_CREATE" && row.binding_status === "ACTIVE" && row.current_status === "ACTIVE"
    && row.purchase_unit_code === "PCS" && row.base_unit_code === "PCS"
    && row.conversion_numerator === "1" && row.conversion_denominator === "1"
    && row.valid_from && row.valid_to === null));
  const createdEvent = (await pool.query(
    "select event_type,credential_version,result,old_version,new_version,from_status,to_status,idempotency_key_digest,scope_digest from procurement_sourcing_events where rfq_id=$1",
    [rfqId],
  )).rows;
  assert.equal(createdEvent.length, 1);
  assert.deepEqual(createdEvent[0], {
    event_type: "RFQ_CREATED", credential_version: 2, result: "SUCCESS", old_version: null, new_version: 1,
    from_status: null, to_status: "DRAFT", idempotency_key_digest: createdEvent[0].idempotency_key_digest, scope_digest: createdEvent[0].scope_digest,
  });
  assert.match(createdEvent[0].idempotency_key_digest, /^[0-9a-f]{64}$/);
  assert.match(createdEvent[0].scope_digest, /^[0-9a-f]{64}$/);

  const frozenClient = await pool.connect();
  try {
    await frozenClient.query("begin");
    await frozenClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(frozenClient.query(`insert into procurement_rfq_lines(
      rfq_id,purchase_request_line_id,material_id,unit_id,requested_quantity,required_date,line_no,source_digest
    ) select rfq_id,purchase_request_line_id,material_id,unit_id,requested_quantity,required_date,99,source_digest
      from procurement_rfq_lines where rfq_id=$1 order by id limit 1`, [rfqId]), /scope can only be inserted/i);
    await frozenClient.query("rollback");
    await frozenClient.query("begin");
    await frozenClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(frozenClient.query(`insert into procurement_rfq_suppliers(
      rfq_id,supplier_id,status,invited_by,supplier_mapping_digest
    ) select rfq_id,supplier_id,status,invited_by,supplier_mapping_digest
      from procurement_rfq_suppliers where rfq_id=$1 order by id limit 1`, [rfqId]), /scope can only be inserted/i);
    await frozenClient.query("rollback");
    await frozenClient.query("begin");
    await frozenClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(frozenClient.query(`insert into procurement_rfq_supplier_line_mapping_bindings(
      rfq_id,rfq_supplier_id,rfq_line_id,supplier_id,material_id,supplier_mapping_version_id,mapping_uid,
      mapping_version_no,mapping_row_version,mapping_content_digest,supplier_part_number,purchase_unit_id,
      conversion_numerator,conversion_denominator,valid_from,valid_to,binding_source,binding_status,bound_by,request_id
    ) select rfq_id,rfq_supplier_id,rfq_line_id,supplier_id,material_id,supplier_mapping_version_id,mapping_uid,
      mapping_version_no,mapping_row_version,mapping_content_digest,supplier_part_number,purchase_unit_id,
      conversion_numerator,conversion_denominator,valid_from,valid_to,binding_source,binding_status,bound_by,request_id
      from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 order by id limit 1`, [rfqId]), /scope is already frozen/i);
    await frozenClient.query("rollback");
  } finally { frozenClient.release(); }

  const replay = await api("/api/procurement/rfqs", {
    method: "POST",
    key,
    body: {
      purchase_request_id: "1",
      supplier_ids: ["1", "2"],
      response_deadline: "2099-10-15",
      expected_version: "1",
    },
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(replay.payload.rfq_id, rfqId);
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfqs")).rows[0].count), 1);

  const conflict = await api("/api/procurement/rfqs", {
    method: "POST",
    key,
    body: { ...body, response_deadline: "2099-10-16" },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");
  assert.match(conflict.payload.message, /同一 Idempotency-Key/);
  assert.equal(conflict.payload.request_id, conflict.requestId);
  const bait = await api("/api/procurement/rfqs", { method: "POST", body: { ...body, purchase_request_id: fixture.accepted[4] } });
  assert.equal(bait.response.status, 201, JSON.stringify(bait.payload));
  const beforeDetailReads = await previewWriteCounts(rfqId);
  const detail = await api(`/api/procurement/rfqs/${rfqId}`);
  assert.equal(detail.response.status, 200);
  const refreshedDetail = await api(`/api/procurement/rfqs/${rfqId}`);
  assert.deepEqual(await previewWriteCounts(rfqId), beforeDetailReads);
  assert.equal(detail.payload.data.creation_receipt.authority, "IMMUTABLE_EVENT");
  assert.equal(detail.payload.data.creation_receipt.result, "SUCCESS");
  assert.equal(detail.payload.data.creation_receipt.request_id, created.payload.request_id);
  assert.equal(detail.payload.data.mapping_traceability.mode, "BOUND_AT_CREATE");
  assert.equal(detail.payload.data.mapping_traceability.bindings.length, 8);
  assert.equal(detail.payload.data.mapping_traceability.can_issue, true);
  const projectedBindings = detail.payload.data.mapping_traceability.bindings;
  const bindingIds = projectedBindings.map((row) => row.binding_id);
  assert.ok(bindingIds.every((bindingId) => typeof bindingId === "string" && /^[1-9]\d*$/.test(bindingId)));
  assert.equal(new Set(bindingIds).size, 8);
  assert.deepEqual(refreshedDetail.payload.data.mapping_traceability.bindings.map((row) => row.binding_id), bindingIds);
  assert.ok(projectedBindings.every((row) => Number(row.rfq_id) === rfqId && Number.isSafeInteger(Number(row.rfq_line_id))));
  assert.deepEqual(projectedBindings.map((row) => [row.supplier_code, row.internal_material_code]),
    [...projectedBindings].sort((left, right) => left.supplier_code.localeCompare(right.supplier_code)
      || left.supplier_id - right.supplier_id || left.internal_material_code.localeCompare(right.internal_material_code)
      || left.material_id - right.material_id).map((row) => [row.supplier_code, row.internal_material_code]));
  assert.deepEqual(detail.payload.data.mapping_binding_receipt, {
    ...detail.payload.data.mapping_binding_receipt,
    authority: "IMMUTABLE_EVENT",
    verified: true,
    event_type: "RFQ_CREATED",
    immutable: true,
    result: "SUCCESS",
    binding_count: 8,
    binding_ids: bindingIds,
    issues: [],
  });
  assert.equal(detail.payload.data.mapping_binding_receipt.scope_digest, detail.payload.data.creation_receipt.scope_digest);
  assert.equal(detail.payload.data.mapping_binding_receipt.scope_digest, await expectedScopeDigest(rfqId));
  assert.ok(projectedBindings.every((row) => row.binding_scope_digest === detail.payload.data.mapping_binding_receipt.scope_digest));
  const shanghaiValidity = (await pool.query(
    `select supplier_id::int,material_id::int,
      to_char(valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
      case when valid_to is null then null else to_char(valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to
    from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 order by supplier_id,material_id`,
    [rfqId],
  )).rows;
  const expectedValidity = new Map(shanghaiValidity.map((row) => [`${row.supplier_id}:${row.material_id}`, row]));
  for (const row of [
    ...detail.payload.data.mapping_traceability.bindings,
    ...detail.payload.data.mapping_traceability.current_qualification,
  ]) {
    const expected = expectedValidity.get(`${row.supplier_id}:${row.material_id}`);
    assert.equal(row.valid_from, expected?.valid_from);
    assert.equal(row.valid_to, expected?.valid_to);
  }
  assert.ok(detail.payload.data.mapping_traceability.bindings.every((row) => row.supplier_part_number === `PART-${row.supplier_id}-${row.material_id}`
    && row.purchase_unit_code === "PCS" && row.base_unit_code === "PCS"
    && String(row.conversion_numerator) === "1" && String(row.conversion_denominator) === "1"
    && row.binding_status === "ACTIVE" && row.binding_source === "RFQ_CREATE"
    && row.current_status === "ACTIVE" && row.status_drift === false && row.version_drift === false && row.eligible === true));
  assert.ok(detail.payload.data.events.every((event) => Number(event.rfq_id) === rfqId));
  assert.ok(detail.payload.data.events.every((event) => event.request_id !== bait.payload.request_id));
  assert.ok(projectedBindings.every((row) => Number(row.rfq_id) !== Number(bait.payload.rfq_id)));
  assert.deepEqual(await downstreamCounts(), {
    quotes: 0,
    awards: 0,
    purchase_orders: 0,
    delivery_plans: 0,
    receipts: 0,
    ledger_entries: 0,
    ap_documents: 0,
    work_orders: 0,
  });
});

test("database guards reject generation downgrade, partial lifecycle credentials, and a second RFQ CAS bump", async () => {
  const fixture = await seed();
  const downgradeClient = await pool.connect();
  try {
    await downgradeClient.query("begin");
    await downgradeClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(downgradeClient.query(`insert into procurement_rfqs(
      rfq_code,purchase_request_id,round_no,status,response_deadline,currency_code,
      source_purchase_request_version,source_digest,version,request_id,created_by,traceability_version
    ) select 'RFQ-99999999',id,1,'DRAFT','2099-10-15','CNY',version,$2,1,$3,'purchase01',1
      from planning_purchase_requests where id=$1`, [
      fixture.accepted[0], digest("fix22-generation-downgrade"), randomUUID(),
    ]), /generation-2 DRAFT/i);
    await downgradeClient.query("rollback");
  } finally { downgradeClient.release(); }

  const incompleteRepository = {
    pool,
    async execute(_meta, work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
        const result = await work(client);
        await client.query("commit");
        return { ...result, replayed: false };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
  };
  const beforeIncomplete = await structuralCounts();
  const incompleteService = new ProcurementSourcingService(incompleteRepository);
  await assert.rejects(incompleteService.create({
    actor: actor("purchase"), requestId: randomUUID(), operationId: randomUUID(),
    keyDigest: digest("fix22-incomplete-create-key"), requestDigest: digest("fix22-incomplete-create-body"),
    method: "POST", route: "/api/procurement/rfqs", action: "RFQ_CREATED",
  }, {
    purchase_request_id: fixture.accepted[1], supplier_ids: [fixture.supplierA],
    response_deadline: "2099-10-15", expected_version: 1,
  }), /exact success Audit and Idempotency result/i);
  assert.deepEqual(await structuralCounts(), beforeIncomplete);

  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[2], supplier_ids: [fixture.supplierA],
    response_deadline: "2099-10-15", expected_version: 1,
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const bumpClient = await pool.connect();
  try {
    await bumpClient.query("begin");
    await bumpClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await bumpClient.query("savepoint first_rfq_bump");
    await bumpClient.query(`update procurement_rfqs set status='ISSUED',issued_by='purchase01',
      issued_at=now(),version=version+1,updated_at=now() where id=$1`, [created.payload.rfq_id]);
    await bumpClient.query("release savepoint first_rfq_bump");
    await assert.rejects(bumpClient.query(
      "update procurement_rfqs set version=version+1,updated_at=now() where id=$1",
      [created.payload.rfq_id],
    ), /only once per transaction/i);
    await bumpClient.query("rollback");
  } finally { bumpClient.release(); }
  assert.deepEqual(
    (await pool.query("select status,version,issued_by,issued_at from procurement_rfqs where id=$1", [created.payload.rfq_id])).rows[0],
    { status: "DRAFT", version: 1, issued_by: null, issued_at: null },
  );
});

test("concurrent create has one winner and invalid, stale-label, state and permission inputs are rejected", async () => {
  const fixture = await seed();
  const concurrentBody = {
    purchase_request_id: fixture.accepted[1],
    supplier_ids: [fixture.supplierA, fixture.supplierB],
    response_deadline: "2099-10-15",
    expected_version: 1,
  };
  const concurrent = await Promise.all([
    api("/api/procurement/rfqs", { method: "POST", key: "fix19-concurrent-a", body: concurrentBody }),
    api("/api/procurement/rfqs", { method: "POST", key: "fix19-concurrent-b", body: concurrentBody }),
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [201, 409]);
  assert.equal(Number((await pool.query(
    "select count(*) count from procurement_rfqs where purchase_request_id=$1",
    [fixture.accepted[1]],
  )).rows[0].count), 1);

  const rejected = [
    [
      { purchase_request_id: fixture.submitted, supplier_ids: [1], response_deadline: "2099-10-15", expected_version: 1 },
      409,
      "PURCHASE_REQUEST_NOT_ACCEPTED",
      "purchase",
    ],
    [
      { purchase_request_id: 999999, supplier_ids: [1], response_deadline: "2099-10-15", expected_version: 1 },
      404,
      "PURCHASE_REQUEST_NOT_FOUND",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [1], response_deadline: "2099-10-15", expected_version: 1, project_id: 999 },
      400,
      "REQUEST_VALIDATION_FAILED",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [1], response_deadline: "2099-10-15", expected_version: 1 },
      403,
      "PERMISSION_DENIED",
      "planning",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [1, 1], response_deadline: "2099-10-15", expected_version: 1 },
      400,
      "REQUEST_VALIDATION_FAILED",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [fixture.inactiveSupplier], response_deadline: "2099-10-15", expected_version: 1 },
      422,
      "SUPPLIER_MAPPING_INCOMPLETE",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [fixture.noMappingSupplier], response_deadline: "2099-10-15", expected_version: 1 },
      422,
      "SUPPLIER_MAPPING_INCOMPLETE",
      "purchase",
    ],
  ];
  for (const [body, status, code, role] of rejected) {
    const result = await api("/api/procurement/rfqs", { method: "POST", body, role });
    assert.equal(result.response.status, status, JSON.stringify(result.payload));
    assert.equal(result.payload.code, code);
    assert.equal(result.payload.request_id, result.requestId);
    assert.match(result.payload.message, /[\u3400-\u9fff]/);
  }
  assert.equal(Number((await pool.query(
    "select count(*) count from procurement_rfqs where purchase_request_id=$1",
    [fixture.accepted[2]],
  )).rows[0].count), 0);
});

test("fault after RFQ persistence rolls back header, four lines, suppliers, events, audit and idempotency", async () => {
  const fixture = await seed();
  const repository = new ProcurementSourcingRepository(pool);
  const service = new ProcurementSourcingService(repository, (checkpoint) => {
    if (checkpoint === "after_rfq_saved") throw new Error("FIX19 forced failure");
  });
  const requestId = randomUUID();
  const keyDigest = digest("fix19-fault-key");
  const meta = {
    actor: actor("purchase"),
    requestId,
    operationId: randomUUID(),
    keyDigest,
    requestDigest: digest("the service replaces this with its normalized create body"),
    method: "POST",
    route: "/api/procurement/rfqs",
    action: "RFQ_CREATED",
  };
  const before = await structuralCounts();
  await assert.rejects(
    service.create(meta, {
      purchase_request_id: fixture.accepted[3],
      supplier_ids: [fixture.supplierB, fixture.supplierA],
      response_deadline: "2099-10-15",
      expected_version: 1,
    }),
    (error) => error?.code === "INTERNAL_ERROR" && /服务器暂时无法处理采购询比价/.test(error.message),
  );
  assert.deepEqual(await structuralCounts(), before);
  assert.equal(Number((await pool.query(
    "select count(*) count from idempotency_keys where key_digest=$1",
    [keyDigest],
  )).rows[0].count), 0);
  assert.equal(Number((await pool.query(
    "select count(*) count from audit_log where request_id=$1",
    [requestId],
  )).rows[0].count), 0);
  assert.deepEqual(await downstreamCounts(), {
    quotes: 0,
    awards: 0,
    purchase_orders: 0,
    delivery_plans: 0,
    receipts: 0,
    ledger_entries: 0,
    ap_documents: 0,
    work_orders: 0,
  });
});

test("issuance is CAS-safe and idempotent, writes one complete ISSUED credential, and leaves all downstream documents empty", async () => {
  const fixture = await seed();
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA, fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const rfqId = created.payload.rfq_id;
  const createdScopeDigest = (await pool.query(
    "select scope_digest from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_CREATED'",
    [rfqId],
  )).rows[0].scope_digest;
  assert.equal(createdScopeDigest, await expectedScopeDigest(rfqId));
  const attempts = await Promise.all([
    api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", key: "fix22-issue-concurrent-a", body: { expected_version: 1 } }),
    api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", key: "fix22-issue-concurrent-b", body: { expected_version: 1 } }),
  ]);
  assert.deepEqual(attempts.map((item) => item.response.status).sort(), [200, 409]);
  const winnerIndex = attempts.findIndex((item) => item.response.status === 200);
  const winnerKey = winnerIndex === 0 ? "fix22-issue-concurrent-a" : "fix22-issue-concurrent-b";
  const replay = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", key: winnerKey, body: { expected_version: 1 } });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const differentBody = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", key: winnerKey, body: { expected_version: 2 } });
  assert.equal(differentBody.response.status, 409);
  assert.equal(differentBody.payload.code, "IDEMPOTENCY_CONFLICT");
  const event = (await pool.query(
    `select event_type,credential_version,result,old_version,new_version,from_status,to_status,idempotency_key_digest,scope_digest
    from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_ISSUED'`, [rfqId],
  )).rows;
  assert.equal(event.length, 1);
  assert.deepEqual([event[0].event_type, event[0].credential_version, event[0].result, event[0].old_version, event[0].new_version, event[0].from_status, event[0].to_status], ["RFQ_ISSUED", 2, "SUCCESS", 1, 2, "DRAFT", "ISSUED"]);
  assert.match(event[0].idempotency_key_digest, /^[0-9a-f]{64}$/);
  assert.match(event[0].scope_digest, /^[0-9a-f]{64}$/);
  assert.equal(event[0].scope_digest, createdScopeDigest);
  assert.equal(event[0].scope_digest, await expectedScopeDigest(rfqId));
  const header = (await pool.query("select status,version,issued_by,issued_at is not null issued from procurement_rfqs where id=$1", [rfqId])).rows[0];
  assert.deepEqual(header, { status: "ISSUED", version: 2, issued_by: "purchase01", issued: true });
  await assert.rejects(pool.query("update procurement_sourcing_events set reason='tampered' where rfq_id=$1 and event_type='RFQ_CREATED'", [rfqId]), /immutable/i);
  await assert.rejects(pool.query("delete from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_ISSUED'", [rfqId]), /immutable/i);
  const malformedEventClient = await pool.connect();
  try {
    await malformedEventClient.query("begin");
    await malformedEventClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(malformedEventClient.query(
      `insert into procurement_sourcing_events(
        rfq_id,event_type,actor,request_id,credential_version,result,idempotency_key_digest,
        old_version,new_version,from_status,to_status,scope_digest
      ) values($1,'RFQ_ISSUED','planning01',$2,2,'SUCCESS',$3,1,2,'DRAFT','ISSUED',$4)`,
      [rfqId, randomUUID(), digest("malformed-issue-key"), event[0].scope_digest],
    ), /does not match RFQ CAS/i);
    await malformedEventClient.query("rollback");
  } finally { malformedEventClient.release(); }
  await assert.rejects(pool.query("update procurement_rfq_supplier_line_mapping_bindings set mapping_version_no=2 where rfq_id=$1", [rfqId]), /immutable/i);
  const scopeClient = await pool.connect();
  try {
    await scopeClient.query("begin");
    await scopeClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(
      scopeClient.query("update procurement_rfqs set response_deadline='2099-10-16',version=version+1,updated_at=now() where id=$1", [rfqId]),
      /scope is immutable/i,
    );
    await scopeClient.query("rollback");
  } finally { scopeClient.release(); }
  const detail = await api(`/api/procurement/rfqs/${rfqId}`);
  assert.equal(detail.payload.data.issue_receipt.event_type, "ISSUED");
  assert.equal(detail.payload.data.issue_receipt.result, "SUCCESS");
  assert.equal(detail.payload.data.issue_receipt.mapping_count, 8);
  assert.deepEqual(detail.payload.data.downstream_counts, {
    quotes: 0,
    awards: 0,
    purchase_orders: 0,
    purchase_order_lines: 0,
    delivery_plans: 0,
  });
  assert.deepEqual(await downstreamCounts(), { quotes: 0, awards: 0, purchase_orders: 0, delivery_plans: 0, receipts: 0, ledger_entries: 0, ap_documents: 0, work_orders: 0 });
});

test("legacy DRAFT is never backfilled implicitly and requires an explicit idempotent Mapping confirmation before issue", async () => {
  const fixture = await seed();
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA, fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  const rfqId = created.payload.rfq_id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      await client.query("delete from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId]);
      await client.query("delete from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_CREATED'", [rfqId]);
      await client.query("update procurement_rfqs set traceability_version=1 where id=$1", [rfqId]);
    });
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const legacy = await api(`/api/procurement/rfqs/${rfqId}`);
  assert.equal(legacy.payload.data.creation_receipt.authority, "EXACT_SUCCESS_AUDIT");
  assert.equal(legacy.payload.data.creation_receipt.result, "SUCCESS");
  assert.equal(legacy.payload.data.mapping_traceability.mode, "UNBOUND_LEGACY_DRAFT");
  assert.equal(legacy.payload.data.mapping_traceability.bindings.length, 0);
  assert.equal(legacy.payload.data.mapping_traceability.current_qualification.length, 8);
  assert.equal(legacy.payload.data.mapping_traceability.can_issue, false);
  const beforePreview = { structural: await structuralCounts(), downstream: await downstreamCounts() };
  const preview = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings/preview?expected_version=1`);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.data.qualification_passed, true);
  assert.deepEqual([
    preview.payload.data.expected_binding_count,
    preview.payload.data.actual_candidate_count,
    preview.payload.data.current_binding_count,
    preview.payload.data.missing_combination_count,
    preview.payload.data.supplier_material_conflict_count,
    preview.payload.data.supplier_part_number_conflict_count,
  ], [8, 8, 0, 0, 0, 0]);
  assert.deepEqual(preview.payload.data.suppliers.map((supplier) => supplier.coverage), ["4/4", "4/4"]);
  assert.equal(preview.payload.data.combinations.length, 8);
  assert.ok(preview.payload.data.combinations.every((row) => row.eligible && row.mapping_id && row.mapping_version === 1 && row.mapping_row_version === 1
    && row.purchase_unit_code === "PCS" && row.base_unit_code === "PCS" && row.conversion_text === "1:1"
    && row.mapping_status === "ACTIVE" && row.current_active_supplier_material_count === 1
    && row.current_active_supplier_part_number_count === 1 && !row.supplier_material_conflict && !row.supplier_part_number_conflict));
  assert.match(preview.payload.data.qualification_digest, /^[0-9a-f]{64}$/);
  assert.equal(preview.payload.data.data_timezone, "Asia/Shanghai");
  assert.match(preview.payload.data.observed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual({ structural: await structuralCounts(), downstream: await downstreamCounts() }, beforePreview);
  const blocked = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.payload.code, "RFQ_MAPPING_BINDING_REQUIRED");
  const faultRequestId = randomUUID(), faultKeyDigest = digest("fix22-explicit-mapping-confirm-fault");
  const faultService = new ProcurementSourcingService(new ProcurementSourcingRepository(pool), (checkpoint) => {
    if (checkpoint === "after_mapping_bindings_saved") throw new Error("FIX22 forced Mapping confirmation failure");
  });
  await assert.rejects(faultService.confirmMappings(rfqId, {
    actor: actor("purchase"), requestId: faultRequestId, operationId: randomUUID(), keyDigest: faultKeyDigest,
    requestDigest: digest("mapping-confirm-fault-body"), method: "POST",
    route: `/api/procurement/rfqs/${rfqId}/mapping-bindings`, action: "RFQ_MAPPING_CONFIRMED",
  }, { expected_version: 1, qualification_digest: preview.payload.data.qualification_digest }), (error) => error?.code === "INTERNAL_ERROR");
  assert.deepEqual((await pool.query("select status,version from procurement_rfqs where id=$1", [rfqId])).rows[0], { status: "DRAFT", version: 1 });
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_MAPPING_CONFIRMED'", [rfqId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from audit_log where request_id=$1", [faultRequestId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [faultKeyDigest])).rows[0].count), 0);
  const confirmKey = "fix22-explicit-mapping-confirm";
  const confirmed = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", key: confirmKey, body: { expected_version: 1, qualification_digest: preview.payload.data.qualification_digest } });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.payload));
  assert.deepEqual([confirmed.payload.status, confirmed.payload.version, confirmed.payload.mapping_binding_count, confirmed.payload.event], ["DRAFT", 2, 8, "RFQ_MAPPING_CONFIRMED"]);
  const replay = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", key: confirmKey, body: { expected_version: 1, qualification_digest: preview.payload.data.qualification_digest } });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const different = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", key: confirmKey, body: { expected_version: 2, qualification_digest: preview.payload.data.qualification_digest } });
  assert.equal(different.payload.code, "IDEMPOTENCY_CONFLICT");
  const bindings = (await pool.query("select binding_source,bound_by,request_id::text from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId])).rows;
  assert.equal(bindings.length, 8);
  assert.ok(bindings.every((row) => row.binding_source === "LEGACY_DRAFT_CONFIRMATION" && row.bound_by === "purchase01" && row.request_id === confirmed.payload.request_id));
  const confirmationScope = (await pool.query("select scope_digest from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_MAPPING_CONFIRMED'", [rfqId])).rows[0].scope_digest;
  assert.equal(confirmationScope, await expectedScopeDigest(rfqId));
  const beforeFixedDetail = await previewWriteCounts(rfqId);
  const fixedDetail = await api(`/api/procurement/rfqs/${rfqId}`);
  assert.deepEqual(await previewWriteCounts(rfqId), beforeFixedDetail);
  const fixedIds = fixedDetail.payload.data.mapping_traceability.bindings.map((row) => row.binding_id);
  assert.equal(new Set(fixedIds).size, 8);
  assert.ok(fixedIds.every((bindingId) => /^[1-9]\d*$/.test(bindingId)));
  assert.equal(fixedDetail.payload.data.mapping_binding_receipt.event_type, "RFQ_MAPPING_CONFIRMED");
  assert.equal(fixedDetail.payload.data.mapping_binding_receipt.actor, "purchase01");
  assert.equal(fixedDetail.payload.data.mapping_binding_receipt.request_id, confirmed.payload.request_id);
  assert.equal(fixedDetail.payload.data.mapping_binding_receipt.result, "SUCCESS");
  assert.equal(fixedDetail.payload.data.mapping_binding_receipt.verified, true);
  assert.deepEqual([fixedDetail.payload.data.mapping_binding_receipt.old_version, fixedDetail.payload.data.mapping_binding_receipt.new_version], [1, 2]);
  assert.equal(fixedDetail.payload.data.mapping_binding_receipt.scope_digest, confirmationScope);
  assert.deepEqual(fixedDetail.payload.data.mapping_binding_receipt.binding_ids, fixedIds);
  const issued = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 2 } });
  assert.equal(issued.response.status, 200, JSON.stringify(issued.payload));
  assert.deepEqual([issued.payload.status, issued.payload.version, issued.payload.mapping_count], ["ISSUED", 3, 8]);
  assert.equal((await pool.query("select scope_digest from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_ISSUED'", [rfqId])).rows[0].scope_digest, confirmationScope);

  const unverifiedCreated = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[1], supplier_ids: [fixture.supplierA], response_deadline: "2099-10-15", expected_version: 1,
  } });
  const unverifiedId = unverifiedCreated.payload.rfq_id;
  const unverifiedClient = await pool.connect();
  try {
    await unverifiedClient.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(unverifiedClient, async () => {
      await unverifiedClient.query("delete from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [unverifiedId]);
      await unverifiedClient.query("delete from procurement_sourcing_events where rfq_id=$1", [unverifiedId]);
      await unverifiedClient.query("delete from audit_log where request_id=(select request_id from procurement_rfqs where id=$1)", [unverifiedId]);
      await unverifiedClient.query("update procurement_rfqs set traceability_version=1 where id=$1", [unverifiedId]);
    });
    await unverifiedClient.query("commit");
  } catch (error) { await unverifiedClient.query("rollback"); throw error; } finally { unverifiedClient.release(); }
  const unverifiedPreview = await api(`/api/procurement/rfqs/${unverifiedId}/mapping-bindings/preview?expected_version=1`);
  assert.equal(unverifiedPreview.response.status, 200, JSON.stringify(unverifiedPreview.payload));
  const unverifiedConfirm = await api(`/api/procurement/rfqs/${unverifiedId}/mapping-bindings`, { method: "POST", body: { expected_version: 1, qualification_digest: unverifiedPreview.payload.data.qualification_digest } });
  assert.equal(unverifiedConfirm.response.status, 200, JSON.stringify(unverifiedConfirm.payload));
  const unverifiedIssue = await api(`/api/procurement/rfqs/${unverifiedId}/issue`, { method: "POST", body: { expected_version: 2 } });
  assert.equal(unverifiedIssue.response.status, 409);
  assert.equal(unverifiedIssue.payload.code, "RFQ_CREATION_CREDENTIAL_UNVERIFIED");
  const unverifiedProjectionClient = await pool.connect();
  try {
    await unverifiedProjectionClient.query("begin");
    await unverifiedProjectionClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(unverifiedProjectionClient.query(`update procurement_rfqs set
      status='ISSUED',issued_by='purchase01',issued_at=now(),version=version+1,updated_at=now()
      where id=$1`, [unverifiedId]), /exact RFQ_CREATED success Audit/i);
    await unverifiedProjectionClient.query("rollback");
  } finally { unverifiedProjectionClient.release(); }
  assert.deepEqual((await pool.query("select status,version from procurement_rfqs where id=$1", [unverifiedId])).rows[0], { status: "DRAFT", version: 2 });
});

test("missing, duplicate, or cross-RFQ stable Binding IDs fail issuance before any business write", async () => {
  const fixture = await seed();
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA, fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  const rfqId = created.payload.rfq_id;
  const originalIds = (await api(`/api/procurement/rfqs/${rfqId}`)).payload.data.mapping_traceability.bindings.map((row) => row.binding_id);
  const malformedCases = [
    ["missing", (rows) => rows.map((row, index) => index === 0 ? { ...row, binding_id: "" } : row)],
    ["duplicate", (rows) => rows.map((row, index) => index === 1 ? { ...row, binding_id: rows[0].binding_id } : row)],
    ["cross-rfq", (rows) => rows.map((row, index) => index === 0 ? { ...row, rfq_id: rfqId + 999 } : row)],
  ];
  const beforeDownstream = await downstreamCounts();
  for (const [suffix, mutateRows] of malformedCases) {
    const repository = new ProcurementSourcingRepository(pool);
    const realRead = repository.rfqMappingBindings.bind(repository);
    repository.rfqMappingBindings = async (client, id) => mutateRows(await realRead(client, id));
    const service = new ProcurementSourcingService(repository);
    const requestId = randomUUID();
    await assert.rejects(service.issue(rfqId, {
      actor: actor("purchase"), requestId, operationId: randomUUID(), keyDigest: digest(`fix24-${suffix}-key`),
      requestDigest: digest(`fix24-${suffix}-body`), method: "POST", route: `/api/procurement/rfqs/${rfqId}/issue`, action: "RFQ_ISSUED",
    }, { expected_version: 1 }), (error) => error?.code === "RFQ_MAPPING_CREDENTIAL_UNVERIFIED");
    assert.deepEqual((await pool.query("select status,version from procurement_rfqs where id=$1", [rfqId])).rows[0], { status: "DRAFT", version: 1 });
  }
  assert.deepEqual(await downstreamCounts(), beforeDownstream);
  assert.equal(Number((await pool.query("select count(*) count from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_ISSUED'", [rfqId])).rows[0].count), 0);
  assert.deepEqual((await api(`/api/procurement/rfqs/${rfqId}`)).payload.data.mapping_traceability.bindings.map((row) => row.binding_id), originalIds);
  const issued = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(issued.response.status, 200, JSON.stringify(issued.payload));
  assert.deepEqual((await api(`/api/procurement/rfqs/${rfqId}`)).payload.data.mapping_traceability.bindings.map((row) => row.binding_id), originalIds);
  assert.deepEqual(await downstreamCounts(), beforeDownstream);
});

test("authoritative Mapping preview fails closed for 3/4 coverage and performs zero business writes", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const target = (await pool.query(`select id::int,mapping_uid::text mapping_id from supplier_mappings
    where supplier_id=$1 and material_id=$2 and status='ACTIVE'`, [fixture.supplierB, fixture.materialIds[3]])).rows[0];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query("update supplier_mappings set status='INACTIVE',version=version+1 where id=$1", [target.id]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const before = await previewWriteCounts(rfqId);
  const preview = await mappingPreview(rfqId);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.data.qualification_passed, false);
  assert.deepEqual([preview.payload.data.expected_binding_count, preview.payload.data.actual_candidate_count, preview.payload.data.current_binding_count], [8, 7, 0]);
  assert.equal(preview.payload.data.missing_combination_count, 1);
  const supplier = preview.payload.data.suppliers.find((row) => row.supplier_id === fixture.supplierB);
  assert.deepEqual([supplier.coverage, supplier.eligible_mapping_count, supplier.missing_material_count, supplier.eligible], ["3/4", 3, 1, false]);
  const combination = preview.payload.data.combinations.find((row) => row.supplier_id === fixture.supplierB && row.material_id === fixture.materialIds[3]);
  assert.equal(combination.mapping_id, target.mapping_id);
  assert.equal(combination.mapping_status, "INACTIVE");
  assert.equal(combination.eligible, false);
  assert.ok(combination.issues.some((issue) => issue.code === "SUPPLIER_MAPPING_INACTIVE_OR_EXPIRED" && /处理|状态|有效/.test(issue.suggestion)));
  assert.deepEqual(await previewWriteCounts(rfqId), before);
});

test("authoritative Mapping preview exposes Supplier/Material duplicate ACTIVE conflicts", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const source = (await pool.query("select id::int from supplier_mappings where supplier_id=$1 and material_id=$2 and status='ACTIVE'", [fixture.supplierA, fixture.materialIds[0]])).rows[0];
  let duplicateId = 0;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("alter table supplier_mappings drop constraint supplier_mappings_active_material_period_excl");
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      const inserted = await client.query(`insert into supplier_mappings(
        material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,supplier_item_code_normalized,
        purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,
        created_by,updated_by,request_id,created_request_id
      ) select material_id,supplier_id,supplier_name,supplier_key,$2,upper($2),purchase_uom,purchase_unit_id,
        1,1,'ACTIVE',now()-interval '1 day',created_by,updated_by,$3,$3
        from supplier_mappings where id=$1 returning id`, [source.id, `FIX23-DUP-${randomUUID()}`, randomUUID()]);
      duplicateId = Number(inserted.rows[0].id);
    });
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  try {
    const before = await previewWriteCounts(rfqId);
    const preview = await mappingPreview(rfqId);
    assert.equal(preview.payload.data.qualification_passed, false);
    assert.equal(preview.payload.data.actual_candidate_count, 9);
    assert.equal(preview.payload.data.supplier_material_conflict_count, 1);
    const combination = preview.payload.data.combinations.find((row) => row.supplier_id === fixture.supplierA && row.material_id === fixture.materialIds[0]);
    assert.equal(combination.current_active_supplier_material_count, 2);
    assert.equal(combination.supplier_material_conflict, true);
    assert.ok(combination.issues.some((issue) => issue.code === "SUPPLIER_MAPPING_ACTIVE_CONFLICT" && /确保当前仅有一条/.test(issue.suggestion)));
    assert.deepEqual(await previewWriteCounts(rfqId), before);
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("begin");
      await withSupplierMappingFixtureTriggersDisabled(cleanup, () => cleanup.query("delete from supplier_mappings where id=$1", [duplicateId]));
      await cleanup.query(`alter table supplier_mappings add constraint supplier_mappings_active_material_period_excl
        exclude using gist (supplier_id with =,material_id with =,tstzrange(valid_from,coalesce(valid_to,'infinity'::timestamptz),'[)') with &&)
        where (status='ACTIVE' and supplier_id is not null and conversion_numerator=conversion_denominator)`);
      await cleanup.query("commit");
    } catch (error) { await cleanup.query("rollback"); throw error; } finally { cleanup.release(); }
    await assertMappingExclusionConstraint();
  }
});

test("authoritative Mapping preview exposes supplier_part_number conflicts without inventing a UI rule", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const mappings = (await pool.query(`select id::int,supplier_item_code,supplier_item_code_normalized
    from supplier_mappings where supplier_id=$1 and material_id=any($2::bigint[]) and status='ACTIVE' order by material_id`,
  [fixture.supplierA, fixture.materialIds.slice(0, 2)])).rows;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("drop index supplier_mappings_active_supplier_part_uq");
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      const normalized = String(mappings[0].supplier_item_code).trim().toUpperCase();
      await client.query("update supplier_mappings set supplier_item_code_normalized=$2,version=version+1 where id=$1", [mappings[0].id, normalized]);
      await client.query(`update supplier_mappings set supplier_item_code=$2,supplier_item_code_normalized=$3,version=version+1 where id=$1`,
        [mappings[1].id, `${String(mappings[0].supplier_item_code).toLowerCase()} `, normalized]);
    });
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  try {
    const preview = await mappingPreview(rfqId);
    assert.equal(preview.payload.data.qualification_passed, false);
    assert.equal(preview.payload.data.supplier_material_conflict_count, 0);
    assert.equal(preview.payload.data.supplier_part_number_conflict_count, 2);
    const conflicts = preview.payload.data.combinations.filter((row) => row.supplier_id === fixture.supplierA && row.supplier_part_number_conflict);
    assert.equal(conflicts.length, 2);
    assert.ok(conflicts.every((row) => row.current_active_supplier_part_number_count === 2 && row.issues.some((issue) => issue.code === "SUPPLIER_PART_NUMBER_CONFLICT")));
    assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId])).rows[0].count), 0);
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("begin");
      await withSupplierMappingFixtureTriggersDisabled(cleanup, async () => {
        await cleanup.query("update supplier_mappings set supplier_item_code_normalized=$2,version=version+1 where id=$1", [mappings[0].id, mappings[0].supplier_item_code_normalized]);
        await cleanup.query(`update supplier_mappings set supplier_item_code=$2,supplier_item_code_normalized=$3,version=version+1 where id=$1`,
          [mappings[1].id, mappings[1].supplier_item_code, mappings[1].supplier_item_code_normalized]);
      });
      await cleanup.query(`create unique index supplier_mappings_active_supplier_part_uq
        on supplier_mappings (supplier_id,upper(btrim(supplier_item_code)))
        where status='ACTIVE' and supplier_id is not null`);
      await cleanup.query("commit");
    } catch (error) { await cleanup.query("rollback"); throw error; } finally { cleanup.release(); }
  }
});

test("preview is purchase-domain scoped, permission protected, and GET failures do not write Audit", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const before = await previewWriteCounts(rfqId);
  const wrongPurchase = await mappingPreview(rfqId, 1, { role: "purchase", username: "purchase02" });
  assert.equal(wrongPurchase.response.status, 403);
  assert.equal(wrongPurchase.payload.code, "RFQ_FORBIDDEN");
  assert.equal(wrongPurchase.payload.request_id, wrongPurchase.requestId);
  assert.match(wrongPurchase.payload.message, /没有权限/);
  const planning = await mappingPreview(rfqId, 1, { role: "planning" });
  assert.equal(planning.response.status, 403);
  assert.equal(planning.payload.code, "PERMISSION_DENIED");
  const wrongPurchaseDetail = await api(`/api/procurement/rfqs/${rfqId}`, { role: "purchase", username: "purchase02" });
  assert.equal(wrongPurchaseDetail.response.status, 403);
  assert.equal(wrongPurchaseDetail.payload.code, "RFQ_FORBIDDEN");
  assert.equal(wrongPurchaseDetail.payload.request_id, wrongPurchaseDetail.requestId);
  const warehouseDetail = await api(`/api/procurement/rfqs/${rfqId}`, { role: "warehouse" });
  assert.equal(warehouseDetail.response.status, 403);
  assert.equal(warehouseDetail.payload.code, "PERMISSION_DENIED");
  assert.deepEqual(await previewWriteCounts(rfqId), before);
});

test("partial Binding blocks preview and POST without appending a second Binding", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(`insert into procurement_rfq_supplier_line_mapping_bindings(
      rfq_id,rfq_supplier_id,rfq_line_id,supplier_id,material_id,supplier_mapping_version_id,mapping_uid,mapping_version_no,
      mapping_row_version,mapping_content_digest,supplier_part_number,purchase_unit_id,conversion_numerator,conversion_denominator,
      valid_from,valid_to,binding_source,binding_status,bound_by,request_id
    ) select q.id,rs.id,l.id,rs.supplier_id,l.material_id,sm.id,sm.mapping_uid,sm.mapping_version_no,sm.version,
      sm.content_digest,sm.supplier_item_code,sm.purchase_unit_id,sm.conversion_numerator,sm.conversion_denominator,
      sm.valid_from,sm.valid_to,'LEGACY_DRAFT_CONFIRMATION','ACTIVE','purchase01',$2
      from procurement_rfqs q join procurement_rfq_suppliers rs on rs.rfq_id=q.id
      join procurement_rfq_lines l on l.rfq_id=q.id
      join supplier_mappings sm on sm.supplier_id=rs.supplier_id and sm.material_id=l.material_id and sm.status='ACTIVE'
      where q.id=$1 order by rs.supplier_id,l.line_no limit 1`, [rfqId, randomUUID()]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const preview = await mappingPreview(rfqId);
  assert.equal(preview.payload.data.qualification_passed, false);
  assert.equal(preview.payload.data.current_binding_count, 1);
  assert.ok(preview.payload.data.blocking_reasons.some((reason) => reason.code === "RFQ_MAPPING_ALREADY_BOUND" && /部分补写/.test(reason.message)));
  const attempted = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", body: {
    expected_version: 1, qualification_digest: preview.payload.data.qualification_digest,
  } });
  assert.equal(attempted.response.status, 409);
  assert.equal(attempted.payload.code, "RFQ_MAPPING_QUALIFICATION_FAILED");
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId])).rows[0].count), 1);
});

test("preview digest detects Mapping CAS drift and formal confirmation remains all-or-nothing", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const preview = await mappingPreview(rfqId);
  assert.equal(preview.payload.data.qualification_passed, true);
  const mappingVersionId = preview.payload.data.combinations[0].mapping_version_id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query("update supplier_mappings set version=version+1 where id=$1", [mappingVersionId]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const attempted = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", body: {
    expected_version: 1, qualification_digest: preview.payload.data.qualification_digest,
  } });
  assert.equal(attempted.response.status, 409);
  assert.equal(attempted.payload.code, "RFQ_MAPPING_QUALIFICATION_DRIFT");
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_MAPPING_CONFIRMED'", [rfqId])).rows[0].count), 0);
});

test("formal Mapping confirmation rechecks one preview, creates exactly eight Bindings, and has one concurrent winner", async () => {
  const fixture = await seed();
  const rfqId = await createLegacyDraft(fixture);
  const preview = await mappingPreview(rfqId);
  const body = { expected_version: 1, qualification_digest: preview.payload.data.qualification_digest };
  const attempts = await Promise.all([
    api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", key: "fix23-confirm-concurrent-a", body }),
    api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", key: "fix23-confirm-concurrent-b", body }),
  ]);
  assert.deepEqual(attempts.map((item) => item.response.status).sort(), [200, 409]);
  const winnerIndex = attempts.findIndex((item) => item.response.status === 200);
  const winnerKey = winnerIndex === 0 ? "fix23-confirm-concurrent-a" : "fix23-confirm-concurrent-b";
  assert.deepEqual([attempts[winnerIndex].payload.status, attempts[winnerIndex].payload.mapping_binding_count], ["DRAFT", 8]);
  const replay = await api(`/api/procurement/rfqs/${rfqId}/mapping-bindings`, { method: "POST", key: winnerKey, body });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId])).rows[0].count), 8);
  assert.equal(Number((await pool.query("select count(*) count from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_MAPPING_CONFIRMED'", [rfqId])).rows[0].count), 1);
  assert.deepEqual((await pool.query("select status,version from procurement_rfqs where id=$1", [rfqId])).rows[0], { status: "DRAFT", version: 2 });
  const alreadyBound = await mappingPreview(rfqId, 2);
  assert.equal(alreadyBound.payload.data.qualification_passed, false);
  assert.equal(alreadyBound.payload.data.current_binding_count, 8);
  assert.ok(alreadyBound.payload.data.blocking_reasons.some((reason) => reason.code === "RFQ_MAPPING_ALREADY_BOUND"));
  assert.deepEqual(await downstreamCounts(), { quotes: 0, awards: 0, purchase_orders: 0, delivery_plans: 0, receipts: 0, ledger_entries: 0, ap_documents: 0, work_orders: 0 });
});

test("a newer Mapping version on the same stable ID blocks both the service and database issuance guard", async () => {
  const fixture = await seed();
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA, fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const rfqId = created.payload.rfq_id;
  const bound = (await pool.query(
    "select supplier_mapping_version_id::int,supplier_id::int,material_id::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 order by id limit 1",
    [rfqId],
  )).rows[0];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(`insert into supplier_mappings(
      material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,supplier_item_code_normalized,
      supplier_item_name,supplier_specification,manufacturer,mpn,revision,purchase_uom,purchase_unit_id,
      conversion_numerator,conversion_denominator,status,valid_from,valid_to,mapping_uid,mapping_version_no,
      supersedes_mapping_version_id,created_by,updated_by,request_id,created_request_id
    ) select material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,supplier_item_code_normalized,
      supplier_item_name,supplier_specification,manufacturer,mpn,revision,purchase_uom,purchase_unit_id,
      conversion_numerator,conversion_denominator,'DRAFT',valid_from,valid_to,mapping_uid,mapping_version_no+1,
      id,created_by,updated_by,$2,$2 from supplier_mappings where id=$1`,
    [bound.supplier_mapping_version_id, randomUUID()]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }

  const detail = await api(`/api/procurement/rfqs/${rfqId}`);
  const drifted = detail.payload.data.mapping_traceability.bindings.find((row) => Number(row.supplier_id) === bound.supplier_id && Number(row.material_id) === bound.material_id);
  assert.equal(drifted.version_drift, true);
  assert.equal(drifted.eligible, false);
  assert.equal(detail.payload.data.mapping_traceability.can_issue, false);
  const blocked = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.payload.code, "RFQ_MAPPING_DRIFT");
  assert.match(blocked.payload.message, new RegExp(`Supplier ${bound.supplier_id} / Material ${bound.material_id}`));
  assert.match(blocked.payload.message, /Mapping ID\/Version\/CAS 已漂移/);

  const projectionClient = await pool.connect();
  try {
    await projectionClient.query("begin");
    await projectionClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(projectionClient.query(
      "update procurement_rfqs set status='ISSUED',issued_by='purchase01',issued_at=now(),version=2,updated_at=now() where id=$1",
      [rfqId],
    ), /Mapping binding drift or conflict blocks issuance/i);
    await projectionClient.query("rollback");
  } finally { projectionClient.release(); }
  assert.deepEqual((await pool.query("select status,version,issued_by,issued_at from procurement_rfqs where id=$1", [rfqId])).rows[0], { status: "DRAFT", version: 1, issued_by: null, issued_at: null });
});

test("Mapping CAS drift, inactivation, and an active conflict each fail closed with the Supplier and Material combination", async () => {
  const fixture = await seed();
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA, fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  const rfqId = created.payload.rfq_id;
  const bound = (await pool.query("select supplier_mapping_version_id::int,supplier_id::int,material_id::int,purchase_unit_id::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 order by id limit 1", [rfqId])).rows[0];
  let client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query("update supplier_mappings set version=version+1 where id=$1", [bound.supplier_mapping_version_id]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const drift = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(drift.response.status, 409);
  assert.equal(drift.payload.code, "RFQ_MAPPING_DRIFT");
  assert.match(drift.payload.message, new RegExp(`Supplier ${bound.supplier_id} / Material ${bound.material_id}`));
  client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query("update supplier_mappings set status='INACTIVE',version=version+1 where id=$1", [bound.supplier_mapping_version_id]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const inactive = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(inactive.payload.code, "RFQ_MAPPING_DRIFT");
  assert.match(inactive.payload.message, /Mapping 已失效/);

  const conflictIds = [];
  client = await pool.connect();
  try {
    await assertMappingExclusionConstraint();
    await client.query("begin");
    await client.query("alter table supplier_mappings drop constraint supplier_mappings_active_material_period_excl");
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      for (const suffix of ["A", "B"]) {
        const inserted = await client.query(`insert into supplier_mappings(
          material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,supplier_item_code_normalized,purchase_uom,purchase_unit_id,
          conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id,created_request_id
        ) select material_id,supplier_id,supplier_name,supplier_key,$2,upper($2),purchase_uom,purchase_unit_id,1,1,'ACTIVE',now()-interval '1 day',created_by,updated_by,$3,$3
          from supplier_mappings where id=$1 returning id`, [bound.supplier_mapping_version_id, `CONFLICT-${suffix}-${bound.material_id}`, randomUUID()]);
        conflictIds.push(Number(inserted.rows[0].id));
      }
    });
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  try {
    const conflict = await api(`/api/procurement/rfqs/${rfqId}/issue`, { method: "POST", body: { expected_version: 1 } });
    assert.equal(conflict.payload.code, "RFQ_MAPPING_DRIFT");
    assert.match(conflict.payload.message, /当前有效 Mapping 冲突/);
    assert.match(conflict.payload.message, new RegExp(`Supplier ${bound.supplier_id} / Material ${bound.material_id}`));
  } finally {
    client = await pool.connect();
    try {
      await client.query("begin");
      await withSupplierMappingFixtureTriggersDisabled(client, () => client.query("delete from supplier_mappings where id=any($1::bigint[])", [conflictIds]));
      await client.query(`alter table supplier_mappings add constraint supplier_mappings_active_material_period_excl
        exclude using gist (supplier_id with =,material_id with =,tstzrange(valid_from,coalesce(valid_to,'infinity'::timestamptz),'[)') with &&)
        where (status='ACTIVE' and supplier_id is not null and conversion_numerator=conversion_denominator)`);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    await assertMappingExclusionConstraint();
  }
});

test("issue fault rolls back status, ISSUED event, success Audit, idempotency row, and all downstream effects", async () => {
  const fixture = await seed();
  const created = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA, fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  const rfqId = created.payload.rfq_id, requestId = randomUUID(), keyDigest = digest("fix22-issue-fault-key");
  const service = new ProcurementSourcingService(new ProcurementSourcingRepository(pool), (checkpoint) => { if (checkpoint === "after_rfq_issued") throw new Error("FIX22 forced issue failure"); });
  await assert.rejects(service.issue(rfqId, { actor: actor("purchase"), requestId, operationId: randomUUID(), keyDigest, requestDigest: digest("issue-body"), method: "POST", route: `/api/procurement/rfqs/${rfqId}/issue`, action: "RFQ_ISSUED" }, { expected_version: 1 }), (error) => error?.code === "INTERNAL_ERROR");
  assert.deepEqual((await pool.query("select status,version,issued_by,issued_at from procurement_rfqs where id=$1", [rfqId])).rows[0], { status: "DRAFT", version: 1, issued_by: null, issued_at: null });
  assert.equal(Number((await pool.query("select count(*) count from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_ISSUED'", [rfqId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from audit_log where request_id=$1", [requestId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [keyDigest])).rows[0].count), 0);
  assert.deepEqual(await downstreamCounts(), { quotes: 0, awards: 0, purchase_orders: 0, delivery_plans: 0, receipts: 0, ledger_entries: 0, ap_documents: 0, work_orders: 0 });
});

test("issue revalidates PRQ status/version/latestness, Shanghai deadline, Supplier, and invitation state", async () => {
  const fixture = await seed();
  const sourceDrift = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[0], supplier_ids: [fixture.supplierA], response_deadline: "2099-10-15", expected_version: 1,
  } });
  let client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query("update planning_purchase_requests set version=version+1 where id=$1", [fixture.accepted[0]]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const sourceBlocked = await api(`/api/procurement/rfqs/${sourceDrift.payload.rfq_id}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(sourceBlocked.payload.code, "RFQ_SOURCE_VERSION_DRIFT");
  assert.match(sourceBlocked.payload.message, new RegExp(`PRQ ${fixture.accepted[0]}`));

  const expired = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[1], supplier_ids: [fixture.supplierA], response_deadline: "2026-08-01", expected_version: 1,
  } });
  const deadlineBlocked = await api(`/api/procurement/rfqs/${expired.payload.rfq_id}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(deadlineBlocked.payload.code, "RFQ_DEADLINE_EXPIRED");
  assert.match(deadlineBlocked.payload.message, /2026-08-01/);

  const supplierDrift = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[2], supplier_ids: [fixture.supplierB], response_deadline: "2099-10-15", expected_version: 1,
  } });
  await pool.query("update suppliers set status='INACTIVE' where id=$1", [fixture.supplierB]);
  const supplierBlocked = await api(`/api/procurement/rfqs/${supplierDrift.payload.rfq_id}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(supplierBlocked.payload.code, "RFQ_MAPPING_DRIFT");
  assert.match(supplierBlocked.payload.message, new RegExp(`Supplier ${fixture.supplierB}`));
  assert.match(supplierBlocked.payload.message, /Supplier 已停用/);

  const invitationDrift = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[3], supplier_ids: [fixture.supplierA], response_deadline: "2099-10-15", expected_version: 1,
  } });
  client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await client.query("update procurement_rfq_suppliers set status='DECLINED' where rfq_id=$1 and supplier_id=$2", [invitationDrift.payload.rfq_id, fixture.supplierA]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const invitationBlocked = await api(`/api/procurement/rfqs/${invitationDrift.payload.rfq_id}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(invitationBlocked.payload.code, "RFQ_MAPPING_DRIFT");
  assert.match(invitationBlocked.payload.message, new RegExp(`Supplier ${fixture.supplierA}`));
  assert.match(invitationBlocked.payload.message, /邀请状态已漂移为 DECLINED/);

  const sourceStatus = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[4], supplier_ids: [fixture.supplierA], response_deadline: "2099-10-15", expected_version: 1,
  } });
  client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(`update planning_purchase_requests set
      status='RETURNED',accepted_by=null,accepted_at=null,returned_by='purchase01',returned_at=now(),
      return_reason='FIX22 isolated status drift',updated_at=now() where id=$1`, [fixture.accepted[4]]));
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const statusBlocked = await api(`/api/procurement/rfqs/${sourceStatus.payload.rfq_id}/issue`, { method: "POST", body: { expected_version: 1 } });
  assert.equal(statusBlocked.payload.code, "RFQ_SOURCE_NOT_ACCEPTED");
  assert.match(statusBlocked.payload.message, /RETURNED/);

  const sourceLatest = await api("/api/procurement/rfqs", { method: "POST", body: {
    purchase_request_id: fixture.accepted[5], supplier_ids: [fixture.supplierA], response_deadline: "2099-10-15", expected_version: 1,
  } });
  let concurrentLatestAttempt;
  client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.material_requirement_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true)");
    const projectId = Number((await client.query(`select plan.project_id from planning_purchase_requests request
      join planning_material_requirement_plans plan on plan.id=request.plan_id where request.id=$1`, [fixture.accepted[5]])).rows[0].project_id);
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-requirement-project:${projectId}`]);
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(`update planning_material_requirement_plans set
      status='STALE',submitted_by=null,submitted_at=null,accepted_by=null,accepted_at=null,
      version=version+1,updated_at=now()
      where id=(select plan_id from planning_purchase_requests where id=$1)`, [fixture.accepted[5]]));
    const newerPlan = await client.query(`insert into planning_material_requirement_plans(
      project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
      source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
    ) select project_id,planning_package_id,plan_version_no+1,required_date,'SUBMITTED',source_package_version,
      source_package_digest,$2,prepared_by,'planning01',now(),1,$3 from planning_material_requirement_plans
      where id=(select plan_id from planning_purchase_requests where id=$1) returning id`, [
      fixture.accepted[5], digest("fix22-newer-submitted-plan"), randomUUID(),
    ]);
    const newerPlanId = Number(newerPlan.rows[0].id);
    await client.query(`insert into planning_material_requirement_lines(
      plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,
      stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
    ) select $2,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,
      stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
      from planning_material_requirement_lines
      where plan_id=(select plan_id from planning_purchase_requests where id=$1)`, [fixture.accepted[5], newerPlanId]);
    const newerRequest = await client.query(`insert into planning_purchase_requests(
      request_code,plan_id,status,submitted_by,submitted_at,version,request_id
    ) values('PRQ-99999999',$1,'SUBMITTED','planning01',now(),1,$2) returning id`, [newerPlanId, randomUUID()]);
    await client.query(`insert into planning_purchase_request_lines(
      purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
    ) select $1,id,line_no,material_id,unit_id,net_purchase_requirement
      from planning_material_requirement_lines where plan_id=$2 and net_purchase_requirement>0`, [
      Number(newerRequest.rows[0].id), newerPlanId,
    ]);
    concurrentLatestAttempt = api(`/api/procurement/rfqs/${sourceLatest.payload.rfq_id}/issue`, { method: "POST", body: { expected_version: 1 } });
    let advisoryWaitObserved = false;
    for (let attempt = 0; attempt < 40 && !advisoryWaitObserved; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      advisoryWaitObserved = Number((await pool.query(`select count(*) count from pg_stat_activity
        where datname=current_database() and application_name='rfq-binding-fix19-postgres-test'
          and wait_event_type='Lock' and lower(coalesce(wait_event,''))='advisory'`)).rows[0].count) > 0;
    }
    assert.equal(advisoryWaitObserved, true, "RFQ issuance must wait for the shared Planning project lock");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (concurrentLatestAttempt) await concurrentLatestAttempt.catch(() => undefined);
    throw error;
  } finally { client.release(); }
  const latestBlocked = await concurrentLatestAttempt;
  assert.equal(latestBlocked.payload.code, "RFQ_SOURCE_NOT_LATEST");
  assert.match(latestBlocked.payload.message, new RegExp(`PRQ ${fixture.accepted[5]}`));
});
