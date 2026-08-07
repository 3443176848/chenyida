import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { handleFinanceApi } from "../app/lib/finance-selfhost/handler.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementFulfillmentApi } from "../app/lib/procurement-fulfillment-selfhost/handler.ts";
import { ProcurementFulfillmentService } from "../app/lib/procurement-fulfillment-selfhost/service.ts";
import { ProcurementRepository } from "../app/lib/procurement-selfhost/repository.ts";
import { handleProcurementSourcingApi } from "../app/lib/procurement-sourcing-selfhost/handler.ts";
import { withSupplierMappingFixtureTriggersDisabled } from "./helpers/supplier-mapping-fixture.mjs";

const databaseUrl=process.env.TEST_PROCUREMENT_FULFILLMENT_DATABASE_URL;if(!databaseUrl||!/procurement_fulfillment_test/i.test(databaseUrl))throw new Error("isolated TEST_PROCUREMENT_FULFILLMENT_DATABASE_URL containing procurement_fulfillment_test is required");
const pool=new Pool({connectionString:databaseUrl,max:20,application_name:"procurement-fulfillment-test"});
const actor=(role,username=`${role}01`)=>({username,display_name:role,role,is_active:true,must_change_password:false,version:1,last_login_at:null,permissions:permissionsForRole(role)});
async function call(handler,path,{method="GET",role="purchase",key=randomUUID(),body,csrf=true,poolOverride=pool}={}){const requestId=randomUUID(),headers=new Headers({"X-Request-ID":requestId});if(body!==undefined)headers.set("Content-Type","application/json");if(key)headers.set("Idempotency-Key",key);if(csrf)headers.set("X-CSRF-Token","test-csrf");const request=new Request(`http://local.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const response=await handler(request,{pool:poolOverride,actor:actor(role),requestId,requireCsrf:()=>{if(headers.get("X-CSRF-Token")!=="test-csrf")throw Object.assign(new Error("CSRF Token 无效"),{code:"CSRF_INVALID",status:403})}});assert.ok(response);return{response,payload:await response.json()}}
const fulfillment=(path,options)=>call(handleProcurementFulfillmentApi,path,options),finance=(path,options)=>call(handleFinanceApi,path,options),sourcing=(path,options)=>call(handleProcurementSourcingApi,path,options);
async function conversionBody(awardId,remark="履约隔离测试PO备注") { const preview=await fulfillment(`/api/procurement/awards/${awardId}/purchase-order-conversion-preview`);assert.equal(preview.response.status,200,JSON.stringify(preview.payload));assert.equal(preview.payload.data.po_convertible_now,true);return{...preview.payload.data.confirmation,remark} }

let sequence=0;
async function seedAward(lineCount=1) {
  sequence += 1;
  const suffix = String(sequence).padStart(8, "0");
  const sourceDigest = createHash("sha256").update("source-" + sequence).digest("hex");
  const client = await pool.connect();
  let materialId = 0;
  const materialIds = [];
  let supplierId = 0;
  let mappingId = 0;
  const mappingIds = [];
  let purchaseRequestId = 0;
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true),set_config('cyd.procurement_sourcing_service_write','allowed',true),set_config('cyd.inventory_service_write','allowed',true)");

    let base = await client.query("select id from units where code='PCS'");
    let unitId;
    if (!base.rows[0]) {
      const unit = await client.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id");
      unitId = Number(unit.rows[0].id);
    } else {
      unitId = Number(base.rows[0].id);
    }

    let category = (await client.query("select id from material_categories where category_code='FULFILLMENT'")).rows[0];
    if (!category) {
      category = (await client.query(
        "insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('FULFILLMENT','履约测试',4,'ACTIVE','admin01','admin01',$1) returning id",
        [randomUUID()],
      )).rows[0];
    }

    for (let lineNo = 1; lineNo <= lineCount; lineNo += 1) {
      const materialCode = `CYD-FUL-${String(lineNo).padStart(6, "0")}`;
      let material = (await client.query(
        "select id from material_master where internal_material_code=$1",
        [materialCode],
      )).rows[0];
      if (!material) {
        material = (await client.query(
          "insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values($1,$2,$3,'PCS',$4,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL','admin01','admin01','admin01',$5) returning id",
          [materialCode, `履约物料 ${lineNo}`, category.id, unitId, randomUUID()],
        )).rows[0];
      }
      materialIds.push(Number(material.id));
    }
    materialId = materialIds[0];

    let supplier = (await client.query("select id from suppliers where supplier_code='SUP-FUL-A'")).rows[0];
    if (!supplier) {
      supplier = (await client.query(
        "insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-FUL-A','供应商 A','供应商 A','ACTIVE','admin01','admin01',$1) returning id",
        [randomUUID()],
      )).rows[0];
    }
    supplierId = Number(supplier.id);

    for (let index = 0; index < materialIds.length; index += 1) {
      let mapping = (await client.query(
        "select id from supplier_mappings where supplier_id=$1 and material_id=$2",
        [supplierId, materialIds[index]],
      )).rows[0];
      if (!mapping) {
        mapping = (await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(
          "insert into supplier_mappings(material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id) values($1,$2,'供应商 A','SUP-FUL-A',$3,'PCS',$4,1,1,'ACTIVE',now()-interval '1 day','admin01','admin01',$5) returning id",
          [materialIds[index], supplierId, `PART-A-${index + 1}`, unitId, randomUUID()],
        ))).rows[0];
      }
      mappingIds.push(Number(mapping.id));
    }
    mappingId = mappingIds[0];

    let customer = (await client.query("select id from customers where customer_code='CUS-FUL'")).rows[0];
    if (!customer) {
      customer = (await client.query(
        "insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-FUL','履约客户','履约客户','ACTIVE','admin01','admin01',$1) returning id",
        [randomUUID()],
      )).rows[0];
    }

    const project = await client.query(
      "insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,'履约验收','admin01','engineering01','ACCEPTED','2026-10-20',1,4,$4,'admin01') returning id",
      ["PRJ-" + suffix, customer.id, "履约项目 " + sequence, randomUUID()],
    );
    const requirement = await client.query(
      "insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'固化需求',10,'PCS',$2,'admin01') returning id",
      [project.rows[0].id, sourceDigest],
    );
    const planningPackage = await client.query(
      "insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id) values($1,1,$2,'ACCEPTED','2026-10-20',$3,'engineering01','engineering01',now(),'planning01',now(),3,$4) returning id",
      [project.rows[0].id, requirement.rows[0].id, sourceDigest, randomUUID()],
    );
    const plan = await client.query(
      "insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id) values($1,$2,1,'2026-10-20','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id",
      [project.rows[0].id, planningPackage.rows[0].id, sourceDigest, createHash("sha256").update("calc-" + sequence).digest("hex"), randomUUID()],
    );
    const planLineIds = [];
    for (let index = 0; index < materialIds.length; index += 1) {
      const planLine = await client.query(
        "insert into planning_material_requirement_lines(plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest) values($1,$2,$3,$4,$5,$6,10,0,0,0,0,10,$7) returning id",
        [plan.rows[0].id, index + 1, materialIds[index], unitId, {
          internal_material_code: `CYD-FUL-${String(index + 1).padStart(6, "0")}`,
          standard_name: `履约物料 ${index + 1}`,
        }, sourceDigest, sourceDigest],
      );
      planLineIds.push(Number(planLine.rows[0].id));
    }
    const purchaseRequest = await client.query(
      "insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,version,request_id) values($1,$2,'SUBMITTED','planning01',now(),1,$3) returning id",
      ["PRQ-" + suffix, plan.rows[0].id, randomUUID()],
    );
    purchaseRequestId = Number(purchaseRequest.rows[0].id);
    for (let index = 0; index < materialIds.length; index += 1) {
      await client.query(
        "insert into planning_purchase_request_lines(purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity) values($1,$2,$3,$4,$5,10)",
        [purchaseRequestId, planLineIds[index], index + 1, materialIds[index], unitId],
      );
    }
    await client.query(
      "update planning_material_requirement_plans set status='ACCEPTED',accepted_by='purchase01',accepted_at=now(),version=version+1,updated_at=now() where id=$1",
      [plan.rows[0].id],
    );
    await client.query(
      "update planning_purchase_requests set status='ACCEPTED',accepted_by='purchase01',accepted_at=now(),updated_at=now() where id=$1",
      [purchaseRequestId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const created = await sourcing("/api/procurement/rfqs", {
    method: "POST",
    body: {
      purchase_request_id: purchaseRequestId,
      supplier_ids: [supplierId],
      response_deadline: "2026-09-01",
      expected_version: 1,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const rfqId = Number(created.payload.rfq_id);
  const rfqLineIds = (await pool.query(
    "select id from procurement_rfq_lines where rfq_id=$1 order by line_no",
    [rfqId],
  )).rows.map((row) => Number(row.id));
  assert.equal(rfqLineIds.length, lineCount);

  const issued = await sourcing("/api/procurement/rfqs/" + rfqId + "/issue", {
    method: "POST",
    body: { expected_version: 1 },
  });
  assert.equal(issued.response.status, 200, JSON.stringify(issued.payload));

  const quoted = await sourcing("/api/procurement/rfqs/" + rfqId + "/quotes", {
    method: "POST",
    body: {
      expected_version: 2,
      supplier_id: supplierId,
      supplier_quote_reference: "QUOTE-" + suffix,
      valid_until: "2027-12-31",
      tax_included: false,
      freight_included: false,
      payment_terms: "纯虚拟UAT付款条件，仅用于表单验收。",
      lines: rfqLineIds.map((rfqLineId) => ({
        rfq_line_id: rfqLineId,
        quoted_quantity: "10.000000",
        minimum_order_quantity: "10.000000",
        unit_price: "12.000000",
        lead_time_days: 10,
        promised_delivery_date: "2026-10-20",
      })),
    },
  });
  assert.equal(quoted.response.status, 201, JSON.stringify(quoted.payload));

  const compared = await sourcing("/api/procurement/rfqs/" + rfqId + "/comparisons", {
    method: "POST",
    body: { expected_version: 3 },
  });
  assert.equal(compared.response.status, 201, JSON.stringify(compared.payload));
  const detail = await sourcing("/api/procurement/rfqs/" + rfqId);
  assert.equal(detail.response.status, 200, JSON.stringify(detail.payload));
  const comparisonVersion = detail.payload.data.comparison_read_model.current_version;
  assert.ok(comparisonVersion);
  const awardLines = detail.payload.data.lines.map((line) => {
    const material = comparisonVersion.material_summaries.find(
      (row) => String(row.rfq_line_id) === String(line.id),
    );
    assert.ok(material);
    const candidate = material.offers[0];
    assert.ok(candidate);
    const identity = comparisonVersion.comparison_rows.find(
      (row) => row.comparison_line_id === material.comparison_line_id,
    );
    assert.ok(identity);
    return {
      rfq_line_id: String(line.id),
      comparison_line_id: String(material.comparison_line_id),
      comparison_basis_digest: identity.basis_digest,
      selected_candidate_id: String(candidate.comparison_candidate_id),
      expected_quote_id: String(candidate.quote_id),
      expected_quote_version_no: Number(candidate.quote_version_no),
      selection_reason: "",
      late_delivery_reason_code: "",
      late_delivery_reason: "",
      excess_quantity_reason: "",
    };
  });

  const awarded = await sourcing("/api/procurement/rfqs/" + rfqId + "/award", {
    method: "POST",
    body: {
      expected_version: Number(detail.payload.data.header.version),
      expected_rfq_code: detail.payload.data.header.rfq_code,
      expected_round_no: Number(detail.payload.data.header.round_no),
      expected_comparison_version: Number(comparisonVersion.comparison_version_no),
      expected_comparison_output_digest: comparisonVersion.output_summary.digest,
      reason_code: "SOLE_SOURCE",
      reason: "唯一有效报价，价格与交期满足",
      lines: awardLines,
    },
  });
  assert.equal(awarded.response.status, 201, JSON.stringify(awarded.payload));
  return {
    awardId: Number(awarded.payload.award_id),
    materialId,
    materialIds,
    supplierId,
    mappingId,
    mappingIds,
    rfqId,
  };
}

test.beforeEach(async()=>{sequence=0;await pool.query("truncate app_users,units,material_categories,customers,suppliers,business_code_sequences,idempotency_keys,identity_write_rate_limit_buckets,audit_log restart identity cascade");await pool.query("insert into app_users(username,display_name,role,password_hash) values('admin01','管理员','admin','x'),('manager01','经理','manager','x'),('planning01','计划','planning','x'),('engineering01','项目','engineering','x'),('purchase01','采购','purchase','x'),('warehouse01','仓库','warehouse','x'),('finance01','财务','finance','x')")});test.after(async()=>pool.end());

test("four-line Award confirmation fails closed and atomically creates one PO with 4 Lines and 4 direct plans", async () => {
  const refs = await seedAward(4);
  const previewResponse = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`);
  assert.equal(previewResponse.response.status, 200, JSON.stringify(previewResponse.payload));
  const preview = previewResponse.payload.data;
  assert.deepEqual(preview.current_counts, { purchase_orders: 0, purchase_order_lines: 0, delivery_plans: 0 });
  assert.deepEqual({
    operation: preview.planned_result.conversion_operation_count,
    orders: preview.planned_result.purchase_order_aggregate_count,
    lines: preview.planned_result.purchase_order_line_count,
    plans: preview.planned_result.delivery_plan_aggregate_count,
    planLines: preview.planned_result.delivery_plan_line_count,
  }, { operation: 1, orders: 1, lines: 4, plans: 4, planLines: 0 });
  assert.deepEqual(preview.lines.map((line) => ({
    awardLineId: line.award_line_id,
    materialId: line.material_id,
    code: line.internal_material_code,
    quantity: line.selected_quantity,
    unit: line.unit_code,
    price: line.selected_unit_price,
    amount: line.line_amount,
    currency: line.currency_code,
    date: line.promised_delivery_date,
  })), refs.materialIds.map((materialId, index) => ({
    awardLineId: String(index + 1),
    materialId: String(materialId),
    code: `CYD-FUL-${String(index + 1).padStart(6, "0")}`,
    quantity: "10.000000",
    unit: "PCS",
    price: "12.000000",
    amount: "120.000000",
    currency: "CNY",
    date: "2026-10-20",
  })));
  assert.deepEqual(preview.planned_result.totals_by_currency, [{ currency_code: "CNY", total_amount: "480.000000" }]);
  assert.deepEqual(preview.planned_result.planned_delivery_dates, ["2026-10-20"]);
  assert.equal(preview.suppliers.length, 1);
  assert.equal(preview.selected_quotes.length, 1);
  assert.deepEqual({
    paymentTerms: preview.selected_quotes[0].payment_terms,
    taxIncluded: preview.selected_quotes[0].tax_included,
    freightIncluded: preview.selected_quotes[0].freight_included,
    externalReference: preview.model_capabilities.external_reference,
    remark: preview.model_capabilities.remark,
  }, {
    paymentTerms: "纯虚拟UAT付款条件，仅用于表单验收。",
    taxIncluded: false,
    freightIncluded: false,
    externalReference: false,
    remark: true,
  });

  const upstream = (await pool.query(`select award.status award_status,award.version award_version,award.award_digest,
    rfq.status rfq_status,rfq.version rfq_version,
    (select count(*)::int from procurement_supplier_quotes where rfq_id=rfq.id) quote_count,
    (select count(*)::int from procurement_quote_comparisons where rfq_id=rfq.id) comparison_line_count
    from procurement_sourcing_awards award join procurement_rfqs rfq on rfq.id=award.rfq_id where award.id=$1`, [refs.awardId])).rows[0];
  const zeroCounts = async () => (await pool.query(`select
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from purchase_order_lines) purchase_order_lines,
    (select count(*)::int from purchase_order_source_links) po_source_links,
    (select count(*)::int from purchase_order_status_events) po_status_events,
    (select count(*)::int from procurement_award_po_line_links) links,
    (select count(*)::int from purchase_delivery_plans) plans,
    (select count(*)::int from warehouse_receiving_queue_entries) queues,
    (select count(*)::int from purchase_delivery_plan_events) plan_events,
    (select count(*)::int from purchase_receipts) receipts,
    (select count(*)::int from inventory_ledger_entries) ledger,
    (select count(*)::int from quality_inspections) inspections,
    (select count(*)::int from finance_documents) finance_documents,
    (select count(*)::int from finance_settlements) payments,
    (select count(*)::int from production_work_orders) work_orders,
    (select count(*)::int from audit_log where action='SOURCING_AWARD_CONVERTED' and result='success') conversion_success_audits,
    (select count(*)::int from idempotency_keys where path=$1) conversion_idempotency_keys`, [`/api/procurement/awards/${refs.awardId}/purchase-orders`])).rows[0];
  const emptyConversionCounts = { purchase_orders: 0, purchase_order_lines: 0, po_source_links: 0, po_status_events: 0, links: 0, plans: 0, queues: 0, plan_events: 0, receipts: 0, ledger: 0, inspections: 0, finance_documents: 0, payments: 0, work_orders: 0, conversion_success_audits: 0, conversion_idempotency_keys: 0 };
  assert.deepEqual(await zeroCounts(), emptyConversionCounts);

  const body = { ...preview.confirmation, remark: "纯虚拟UAT采购订单，仅用于黑盒验收，不对应真实采购。" };
  const reject = async (candidate, expectedCode, key = randomUUID()) => {
    const result = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", key, body: candidate });
    assert.notEqual(result.response.status, 201, JSON.stringify(result.payload));
    assert.equal(result.payload.code, expectedCode, JSON.stringify(result.payload));
    assert.equal((await zeroCounts()).purchase_orders, 0);
  };
  await reject({ ...body, expected_rfq_version: body.expected_rfq_version + 1 }, "AWARD_CONVERSION_CONFIRMATION_STALE");
  await reject({ ...body, expected_award_digest: "0".repeat(64) }, "AWARD_CONVERSION_CONFIRMATION_STALE");
  await reject({ ...body, expected_award_line_ids: body.expected_award_line_ids.slice(0, 3) }, "AWARD_CONVERSION_CONFIRMATION_STALE");
  await reject({ ...body, expected_award_line_ids: [body.expected_award_line_ids[0], body.expected_award_line_ids[0], ...body.expected_award_line_ids.slice(2)] }, "REQUEST_VALIDATION_FAILED");
  await reject({ ...body, unit_price: "0.01" }, "REQUEST_VALIDATION_FAILED");
  const wrongAward = await fulfillment(`/api/procurement/awards/${refs.awardId + 999999}/purchase-orders`, { method: "POST", body });
  assert.equal(wrongAward.response.status, 404);
  assert.equal(wrongAward.payload.code, "SOURCING_AWARD_NOT_FOUND");
  const csrf = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", csrf: false, body });
  assert.equal(csrf.response.status, 403);
  assert.equal(csrf.payload.code, "CSRF_INVALID");
  assert.deepEqual(await zeroCounts(), emptyConversionCounts);

  const faultRequestId = randomUUID();
  const faultService = new ProcurementFulfillmentService(
    new ProcurementRepository(pool),
    undefined,
    (checkpoint) => { if (checkpoint === "after_award_delivery_plans") throw new Error("forced Award conversion failure"); },
  );
  await assert.rejects(faultService.convertAward(refs.awardId, {
    actor: actor("purchase"),
    requestId: faultRequestId,
    operationId: randomUUID(),
    keyDigest: createHash("sha256").update("four-line-conversion-fault").digest("hex"),
    requestDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    method: "POST",
    route: `/api/procurement/awards/${refs.awardId}/purchase-orders`,
    action: "SOURCING_AWARD_CONVERTED",
  }, body), /服务器暂时无法处理采购请求/);
  assert.deepEqual(await zeroCounts(), emptyConversionCounts);

  const constrainedPool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2_000, application_name: "procurement-fulfillment-constrained-concurrency-test" });
  let attempts;
  try {
    attempts = await Promise.all(["four-line-final-a", "four-line-final-b"].map((key) => fulfillment(
      `/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", key, body, poolOverride: constrainedPool },
    )));
  } finally { await constrainedPool.end(); }
  assert.deepEqual(attempts.map((item) => item.response.status).sort(), [201, 409]);
  const converted = attempts.find((item) => item.response.status === 201);
  assert.ok(converted);
  assert.deepEqual(converted.payload.data.summary, {
    conversion_operation_count: 1,
    purchase_order_aggregate_count: 1,
    purchase_order_line_count: 4,
    delivery_plan_aggregate_count: 4,
    delivery_plan_line_count: 0,
    receiving_queue_entry_count: 4,
  });
  assert.equal(converted.payload.data.purchase_orders.length, 1);
  assert.equal(converted.payload.data.purchase_orders[0].lines.length, 4);
  assert.equal(converted.payload.data.purchase_orders[0].delivery_plans.length, 4);
  assert.equal(converted.payload.data.purchase_orders[0].remark, body.remark.normalize("NFKC").trim());
  const linked = (await pool.query(`select award_line.id::text award_line_id,award_line.rfq_line_id::text,
    award_line.supplier_id::text award_supplier_id,rfq_line.material_id::text award_material_id,
    award_line.selected_quantity::text award_quantity,award_line.selected_unit_price::text award_price,
    award_line.promised_delivery_date::text award_date,po_line.id::text po_line_id,
    po_line.material_id::text po_material_id,po_line.order_qty::text po_quantity,po_line.unit_price::text po_price,
    plan.id::text plan_id,plan.purchase_order_line_id::text plan_po_line_id,plan.material_id::text plan_material_id,
    plan.planned_quantity::text plan_quantity,plan.promised_delivery_date::text plan_date
    from procurement_sourcing_award_lines award_line
    join procurement_rfq_lines rfq_line on rfq_line.id=award_line.rfq_line_id
    join procurement_award_po_line_links link on link.award_line_id=award_line.id
    join purchase_order_lines po_line on po_line.id=link.purchase_order_line_id
    join purchase_delivery_plans plan on plan.purchase_order_line_id=po_line.id
    where award_line.award_id=$1 order by award_line.id`, [refs.awardId])).rows;
  assert.equal(linked.length, 4);
  assert.ok(linked.every((row) => row.award_material_id === row.po_material_id
    && row.po_material_id === row.plan_material_id && row.award_quantity === row.po_quantity
    && row.po_quantity === row.plan_quantity && row.award_price === row.po_price
    && row.award_date === row.plan_date && row.po_line_id === row.plan_po_line_id));
  assert.deepEqual(await zeroCounts(), { ...emptyConversionCounts, purchase_orders: 1, purchase_order_lines: 4, po_source_links: 1, po_status_events: 1, links: 4, plans: 4, queues: 4, plan_events: 4, conversion_success_audits: 1, conversion_idempotency_keys: 1 });
  assert.deepEqual((await pool.query(`select award.status award_status,award.version award_version,award.award_digest,
    rfq.status rfq_status,rfq.version rfq_version,
    (select count(*)::int from procurement_supplier_quotes where rfq_id=rfq.id) quote_count,
    (select count(*)::int from procurement_quote_comparisons where rfq_id=rfq.id) comparison_line_count
    from procurement_sourcing_awards award join procurement_rfqs rfq on rfq.id=award.rfq_id where award.id=$1`, [refs.awardId])).rows[0], upstream);
});

test("Award 10 x 12 becomes PO with its authoritative plan, two receipts 4/6, inventory 10 and explicit AP 48/72",async()=>{const refs=await seedAward(),key="convert-award-main",body=await conversionBody(refs.awardId,"隔离采购订单备注");const converted=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body});assert.equal(converted.response.status,201,JSON.stringify(converted.payload));const replay=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body});assert.equal(replay.response.headers.get("Idempotency-Replayed"),"true");const conflict=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body:{...body,expected_award_version:2}});assert.equal(conflict.payload.code,"IDEMPOTENCY_CONFLICT");const po=converted.payload.data.purchase_orders[0],poId=Number(po.id),poLineId=Number(po.lines[0].id);assert.equal(po.remark,"隔离采购订单备注");assert.equal(po.lines[0].order_qty,"10.000000");assert.equal(po.lines[0].unit_price,"12.000000");assert.deepEqual(converted.payload.data.summary,{conversion_operation_count:1,purchase_order_aggregate_count:1,purchase_order_line_count:1,delivery_plan_aggregate_count:1,delivery_plan_line_count:0,receiving_queue_entry_count:1});const plan=po.delivery_plans[0],planId=Number(plan.id);let counts=(await pool.query("select (select count(*) from purchase_receipts)::int receipts,(select count(*) from inventory_ledger_entries)::int ledger,(select count(*) from finance_documents where doc_type='AP')::int ap,(select count(*) from purchase_delivery_plans)::int plans,(select count(*) from warehouse_receiving_queue_entries)::int queues,(select count(*) from purchase_delivery_plan_events where event_type='CREATED')::int plan_events")).rows[0];assert.deepEqual(counts,{receipts:0,ledger:0,ap:0,plans:1,queues:1,plan_events:1});
 const receiveKey="receive-four-main",receiveFour={quantity:"4",expected_version:1,expected_line_version:1,expected_balance_version:0,reason:"首批到货 4"},first=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:receiveFour});assert.equal(first.response.status,201,JSON.stringify(first.payload));assert.equal(first.payload.delivery_plan.status,"PARTIAL");assert.equal(first.payload.delivery_plan.received_quantity,"4.000000");assert.equal(first.payload.data.financial_source.amount,"48.000000");const firstReplay=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:receiveFour});assert.equal(firstReplay.response.headers.get("Idempotency-Replayed"),"true");const firstConflict=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:{...receiveFour,quantity:"3"}});assert.equal(firstConflict.payload.code,"IDEMPOTENCY_CONFLICT");
 const ap48=await finance("/api/finance/documents",{method:"POST",role:"finance",body:{doc_type:"AP",purchase_source_entry_id:Number(first.payload.data.financial_source.id),accounting_date:"2026-07-26",due_date:"2026-08-26"}});assert.equal(ap48.response.status,201,JSON.stringify(ap48.payload));assert.equal(ap48.payload.data.total_amount,"48.000000");const stale=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"1",expected_version:1,expected_line_version:2,expected_balance_version:1,reason:"陈旧计划"}});assert.equal(stale.payload.code,"DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT");const over=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"7",expected_version:2,expected_line_version:2,expected_balance_version:1,reason:"超收"}});assert.equal(over.payload.code,"PURCHASE_RECEIPT_OVER_QUANTITY");
 const faultRequest=randomUUID(),faultMeta={actor:actor("warehouse"),requestId:faultRequest,operationId:randomUUID(),keyDigest:createHash("sha256").update("fault-main").digest("hex"),requestDigest:createHash("sha256").update("fault-body").digest("hex"),method:"POST",route:`/api/procurement/delivery-plans/${planId}/receipts`,action:"DELIVERY_PLAN_RECEIVED"},faultService=new ProcurementFulfillmentService(new ProcurementRepository(pool),undefined,checkpoint=>{if(checkpoint==="after_receipt_allocation")throw new Error("forced fulfillment failure")});await assert.rejects(faultService.receive(planId,faultMeta,{quantity:"6",expected_version:2,expected_line_version:2,expected_balance_version:1,reason:"故障注入"}),/服务器暂时无法处理采购请求/);assert.deepEqual((await pool.query("select received_quantity,version from purchase_delivery_plans where id=$1",[planId])).rows[0],{received_quantity:"4.000000",version:2});assert.deepEqual((await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1",[refs.materialId])).rows[0],{on_hand_qty:"4.000000",version:1});assert.equal(Number((await pool.query("select count(*) count from purchase_receipts where reason='故障注入'")).rows[0].count),0);
 const second=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"6",expected_version:2,expected_line_version:2,expected_balance_version:1,reason:"第二批到货 6"}});assert.equal(second.response.status,201,JSON.stringify(second.payload));assert.equal(second.payload.delivery_plan.status,"COMPLETED");assert.equal(second.payload.data.financial_source.amount,"72.000000");const ap72=await finance("/api/finance/documents",{method:"POST",role:"finance",body:{doc_type:"AP",purchase_source_entry_id:Number(second.payload.data.financial_source.id),accounting_date:"2026-07-26",due_date:"2026-08-26"}});assert.equal(ap72.response.status,201,JSON.stringify(ap72.payload));assert.equal(ap72.payload.data.total_amount,"72.000000");
 const totals=(await pool.query(`select (select status from purchase_orders where id=$1) po_status,(select status from purchase_delivery_plans where id=$2) plan_status,(select received_qty::text from purchase_order_lines where id=$3) received,(select on_hand_qty::text from inventory_stock_balances where material_id=$4) inventory,(select sum(amount)::text from purchase_financial_source_entries where entry_type='RECEIPT') sources,(select sum(total_amount)::text from finance_documents where doc_type='AP') ap_total,(select count(*)::int from procurement_award_po_line_links where award_id=$5) links,(select count(*)::int from purchase_receipt_delivery_allocations where reversal_of_allocation_id is null) allocations`,[poId,planId,poLineId,refs.materialId,refs.awardId])).rows[0];assert.deepEqual(totals,{po_status:"RECEIVED",plan_status:"COMPLETED",received:"10.000000",inventory:"10.000000",sources:"120.000000",ap_total:"120.000000",links:1,allocations:2});
 const awardReverse=await sourcing(`/api/procurement/awards/${refs.awardId}/reversal`,{method:"POST",body:{expected_version:1,reason:"不应允许"}});assert.equal(awardReverse.payload.code,"AWARD_HAS_PURCHASE_ORDER");const blocked=await fulfillment(`/api/procurement/fulfillment/receipts/${second.payload.receipt_id}/reversal`,{method:"POST",role:"warehouse",body:{reason:"已有 AP 不应冲销",expected_plan_version:3,expected_line_versions:[{purchase_order_line_id:poLineId,expected_line_version:3}],expected_balance_versions:[{material_id:refs.materialId,expected_balance_version:2}]}});assert.equal(blocked.payload.code,"RECEIPT_REVERSAL_BLOCKED_BY_AP");assert.equal((await pool.query("select on_hand_qty::text value from inventory_stock_balances where material_id=$1",[refs.materialId])).rows[0].value,"10.000000");
 const pending=(await fulfillment("/api/procurement/fulfillment/payable-handoff?page_size=100",{role:"finance"})).payload.data;assert.deepEqual(pending.map(row=>[row.amount,row.handoff_status]).sort(),[["48.000000","AP_CREATED"],["72.000000","AP_CREATED"]]);await assert.rejects(pool.query("update procurement_award_po_line_links set award_id=award_id"),/immutable/);await assert.rejects(pool.query("update purchase_delivery_plans set version=version+1"),/service transaction/);
});

test("concurrent Award conversion creates one PO and plan result, plan cancellation is constrained and forbidden roles cannot mutate",async()=>{const refs=await seedAward(),body=await conversionBody(refs.awardId);const attempts=await Promise.all(["convert-concurrent-a","convert-concurrent-b"].map(key=>fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body})));assert.deepEqual(attempts.map(x=>x.response.status).sort(),[201,409]);assert.equal(Number((await pool.query("select count(*) count from procurement_award_po_line_links where award_id=$1",[refs.awardId])).rows[0].count),1);assert.equal(Number((await pool.query("select count(*) count from purchase_orders where source_type='SOURCING_AWARD'")).rows[0].count),1);assert.equal(Number((await pool.query("select count(*) count from purchase_delivery_plans")).rows[0].count),1);for(const role of ["engineering","planning","finance","warehouse"]){const denied=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",role,body});assert.equal(denied.response.status,403,role)}const poId=Number((await pool.query("select purchase_order_id from procurement_award_po_line_links where award_id=$1",[refs.awardId])).rows[0].purchase_order_id);const deniedPlan=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",role:"warehouse",body:{expected_version:1}});assert.equal(deniedPlan.response.status,403);const duplicatePlan=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",body:{expected_version:1}});assert.equal(duplicatePlan.payload.code,"DELIVERY_PLAN_ALREADY_EXISTS");const planId=Number((await pool.query("select id from purchase_delivery_plans where purchase_order_id=$1",[poId])).rows[0].id);const earlyClose=await fulfillment(`/api/procurement/delivery-plans/${planId}/close`,{method:"POST",body:{expected_version:1,reason:"尚未收货"}});assert.equal(earlyClose.payload.code,"DELIVERY_PLAN_CLOSE_CONFLICT");const cancelled=await fulfillment(`/api/procurement/delivery-plans/${planId}/cancel`,{method:"POST",body:{expected_version:1,reason:"采购取消未收货计划"}});assert.equal(cancelled.response.status,200);assert.equal(cancelled.payload.data.status,"CANCELLED");const queue=(await pool.query("select close_reason,created_by,updated_by,created_at,updated_at from warehouse_receiving_queue_entries where delivery_plan_id=$1",[planId])).rows[0];assert.equal(queue.close_reason,"采购取消未收货计划");assert.equal(queue.created_by,"purchase01");assert.equal(queue.updated_by,"purchase01");assert.ok(queue.created_at);assert.ok(queue.updated_at);const deniedReceive=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"purchase",body:{}});assert.equal(deniedReceive.response.status,403);const blockedReceive=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"1",expected_version:2,expected_line_version:1,expected_balance_version:0,reason:"取消后收货"}});assert.equal(blockedReceive.payload.code,"DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT")});
