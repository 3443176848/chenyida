import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementSourcingApi } from "../app/lib/procurement-sourcing-selfhost/handler.ts";
import { ProcurementSourcingRepository } from "../app/lib/procurement-sourcing-selfhost/repository.ts";
import { ProcurementSourcingService } from "../app/lib/procurement-sourcing-selfhost/service.ts";

const databaseUrl = process.env.TEST_PROCUREMENT_SOURCING_DATABASE_URL;
if (!databaseUrl || !/procurement_sourcing_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_PROCUREMENT_SOURCING_DATABASE_URL containing procurement_sourcing_test is required");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 8,
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

async function api(path, { method = "GET", role = "purchase", key = randomUUID(), body } = {}) {
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
    actor: actor(role),
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
      '2026-10-30',1,4,$4,'admin01') returning id`,
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
    ) values($1,1,$2,'ACCEPTED','2026-10-30',$3,'engineering01','engineering01',now(),
      'planning01',now(),3,$4) returning id`,
    [projectId, requirement.rows[0].id, digest(`package-${sequence}`), randomUUID()],
  );
  const plan = await client.query(
    `insert into planning_material_requirement_plans(
      project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
      source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
    ) values($1,$2,1,'2026-10-30','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
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
        { internal_material_code: `MAT-FIX19-${materialId}`, standard_name: `FIX-19 物料 ${materialId}` },
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
        [materialId, `MAT-FIX19-${materialId}`, `FIX-19 物料 ${materialId}`, category.rows[0].id, unitId, randomUUID()],
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
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      accepted.push(await createPurchaseRequest(client, fixture, sequence));
    }
    const submitted = await createPurchaseRequest(client, fixture, 6, "SUBMITTED");

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
    for (const supplierId of supplierIds.slice(0, 3)) {
      for (const materialId of materialIds) {
        await client.query(
          `insert into supplier_mappings(
            material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,
            purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,
            created_by,updated_by,request_id
          ) values($1,$2,$3,$4,$5,'PCS',$6,1,1,'ACTIVE',now()-interval '1 day',
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

test.beforeEach(async () => {
  await pool.query(
    "truncate app_users,units,material_categories,customers,suppliers,business_code_sequences,idempotency_keys,identity_write_rate_limit_buckets,audit_log restart identity cascade",
  );
});
test.after(async () => pool.end());

test("stable Purchase Request ID 1 creates one four-line RFQ and normalized replay returns it", async () => {
  const fixture = await seed();
  assert.equal(fixture.accepted[0], 1);
  assert.deepEqual([fixture.supplierA, fixture.supplierB], [1, 2]);
  const key = "fix19-create-rfq-stable-id";
  const body = {
    purchase_request_id: 1,
    supplier_ids: [2, 1],
    response_deadline: "2026-10-15",
    expected_version: 1,
  };
  const created = await api("/api/procurement/rfqs", { method: "POST", key, body });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, "DRAFT");
  const rfqId = created.payload.rfq_id;

  const header = (await pool.query(
    "select id::int,purchase_request_id::int,status,response_deadline::text from procurement_rfqs where id=$1",
    [rfqId],
  )).rows[0];
  assert.deepEqual(header, {
    id: rfqId,
    purchase_request_id: 1,
    status: "DRAFT",
    response_deadline: "2026-10-15",
  });
  const lines = (await pool.query(
    `select lines.line_no::int,lines.purchase_request_line_id::int,lines.material_id::int,
      lines.requested_quantity::numeric(24,6)::text,lines.required_date::text
    from procurement_rfq_lines lines where rfq_id=$1 order by line_no`,
    [rfqId],
  )).rows;
  assert.deepEqual(lines.map((line) => line.material_id), fixture.materialIds);
  assert.deepEqual(lines.map((line) => line.requested_quantity), Array(4).fill("10.000000"));
  assert.deepEqual(lines.map((line) => line.required_date), Array(4).fill("2026-10-30"));
  assert.equal(new Set(lines.map((line) => line.purchase_request_line_id)).size, 4);
  const boundSuppliers = (await pool.query(
    "select supplier_id::int from procurement_rfq_suppliers where rfq_id=$1 order by supplier_id",
    [rfqId],
  )).rows.map((row) => row.supplier_id);
  assert.deepEqual(boundSuppliers, [1, 2]);

  const replay = await api("/api/procurement/rfqs", {
    method: "POST",
    key,
    body: {
      purchase_request_id: "1",
      supplier_ids: ["1", "2"],
      response_deadline: "2026-10-15",
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
    body: { ...body, response_deadline: "2026-10-16" },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");
  assert.match(conflict.payload.message, /同一 Idempotency-Key/);
  assert.equal(conflict.payload.request_id, conflict.requestId);
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

test("concurrent create has one winner and invalid, stale-label, state and permission inputs are rejected", async () => {
  const fixture = await seed();
  const concurrentBody = {
    purchase_request_id: fixture.accepted[1],
    supplier_ids: [fixture.supplierA, fixture.supplierB],
    response_deadline: "2026-10-15",
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
      { purchase_request_id: fixture.submitted, supplier_ids: [1], response_deadline: "2026-10-15", expected_version: 1 },
      409,
      "PURCHASE_REQUEST_NOT_ACCEPTED",
      "purchase",
    ],
    [
      { purchase_request_id: 999999, supplier_ids: [1], response_deadline: "2026-10-15", expected_version: 1 },
      404,
      "PURCHASE_REQUEST_NOT_FOUND",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [1], response_deadline: "2026-10-15", expected_version: 1, project_id: 999 },
      400,
      "REQUEST_VALIDATION_FAILED",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [1], response_deadline: "2026-10-15", expected_version: 1 },
      403,
      "PERMISSION_DENIED",
      "planning",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [1, 1], response_deadline: "2026-10-15", expected_version: 1 },
      400,
      "REQUEST_VALIDATION_FAILED",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [fixture.inactiveSupplier], response_deadline: "2026-10-15", expected_version: 1 },
      422,
      "SUPPLIER_NOT_ACTIVE",
      "purchase",
    ],
    [
      { purchase_request_id: fixture.accepted[2], supplier_ids: [fixture.noMappingSupplier], response_deadline: "2026-10-15", expected_version: 1 },
      422,
      "SUPPLIER_MAPPING_REQUIRED",
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
      response_deadline: "2026-10-15",
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
