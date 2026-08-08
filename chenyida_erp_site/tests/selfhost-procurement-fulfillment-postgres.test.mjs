import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { handleFinanceApi } from "../app/lib/finance-selfhost/handler.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementFulfillmentApi } from "../app/lib/procurement-fulfillment-selfhost/handler.ts";
import { loadAwardMappingQualification } from "../app/lib/procurement-fulfillment-selfhost/award-mapping-qualification.ts";
import { ProcurementFulfillmentService } from "../app/lib/procurement-fulfillment-selfhost/service.ts";
import { ProcurementRepository } from "../app/lib/procurement-selfhost/repository.ts";
import { handleProcurementApi } from "../app/lib/procurement-selfhost/handler.ts";
import { handleProcurementSourcingApi } from "../app/lib/procurement-sourcing-selfhost/handler.ts";
import { handleQualityApi } from "../app/lib/quality-selfhost/handler.ts";
import { handleSupplierMappingApi } from "../app/lib/supplier-mapping-selfhost/handler.ts";
import { withSupplierMappingFixtureTriggersDisabled } from "./helpers/supplier-mapping-fixture.mjs";

const databaseUrl=process.env.TEST_PROCUREMENT_FULFILLMENT_DATABASE_URL;if(!databaseUrl||!/procurement_fulfillment_test/i.test(databaseUrl))throw new Error("isolated TEST_PROCUREMENT_FULFILLMENT_DATABASE_URL containing procurement_fulfillment_test is required");
const pool=new Pool({connectionString:databaseUrl,max:2,application_name:"procurement-fulfillment-test"});
const actor=(role,username=`${role}01`)=>({username,display_name:role,role,is_active:true,must_change_password:false,version:1,last_login_at:null,permissions:permissionsForRole(role)});
async function call(handler,path,{method="GET",role="purchase",username,key=randomUUID(),body,csrf=true,poolOverride=pool}={}){const requestId=randomUUID(),headers=new Headers({"X-Request-ID":requestId});if(body!==undefined)headers.set("Content-Type","application/json");if(key)headers.set("Idempotency-Key",key);if(csrf)headers.set("X-CSRF-Token","test-csrf");const request=new Request(`http://local.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const response=await handler(request,{pool:poolOverride,actor:actor(role,username),requestId,requireCsrf:()=>{if(headers.get("X-CSRF-Token")!=="test-csrf")throw Object.assign(new Error("CSRF Token 无效"),{code:"CSRF_INVALID",status:403})}});assert.ok(response);return{response,payload:await response.json()}}
const fulfillment=(path,options)=>call(handleProcurementFulfillmentApi,path,options),procurement=(path,options)=>call(handleProcurementApi,path,options),finance=(path,options)=>call(handleFinanceApi,path,options),quality=(path,options)=>call(handleQualityApi,path,{role:"quality",...options}),sourcing=(path,options)=>call(handleProcurementSourcingApi,path,options),supplierMapping=(path,options)=>call(handleSupplierMappingApi,path,options);
async function conversionBody(awardId,remark="履约隔离测试PO备注") { const preview=await fulfillment(`/api/procurement/awards/${awardId}/purchase-order-conversion-preview`);assert.equal(preview.response.status,200,JSON.stringify(preview.payload));assert.equal(preview.payload.data.po_convertible_now,true);return{...preview.payload.data.confirmation,remark} }
async function receiptBody(planId, receiveQuantity, overrides={}) {
  const preview = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipt-preview?quantity=${encodeURIComponent(receiveQuantity)}`, { role: "warehouse" });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  const readiness = preview.payload.data;
  return {
    ...readiness.confirmation,
    quantity: receiveQuantity,
    supplier_lot_code: readiness.selected_receipt.supplier_lot.applicability === "REQUIRED_FOR_IQC" ? `SUP-LOT-${randomUUID()}` : "",
    evidence_type: "DELIVERY_NOTE",
    evidence_reference: `ISOLATED-${randomUUID()}`,
    evidence_document_date: readiness.selected_receipt.server_date_shanghai,
    early_arrival_reason: readiness.selected_receipt.is_early_arrival ? "隔离数据库提前到货门禁测试" : "",
    early_arrival_confirmed: readiness.selected_receipt.is_early_arrival,
    physical_receipt_confirmed: true,
    reason: "隔离数据库实际物理收货测试",
    ...overrides,
  };
}

async function insertGovernedMappingFixture(client, { materialId, supplierId, supplierCode, supplierName, supplierPartNumber, unitId }) {
  const createdRequestId = randomUUID(), submittedRequestId = randomUUID(), reviewedRequestId = randomUUID();
  const contentDigest = createHash("sha256").update(JSON.stringify([
    String(supplierId), String(materialId), supplierPartNumber, String(unitId), "1", "1", "ACTIVE",
  ])).digest("hex");
  return withSupplierMappingFixtureTriggersDisabled(client, async () => {
    const mapping = (await client.query(`insert into supplier_mappings(
        material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,supplier_item_code_normalized,
        purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,
        mapping_version_no,content_digest,created_request_id,submitted_by,submitted_at,submitted_request_id,
        reviewed_by,reviewed_at,reviewed_request_id,review_outcome,review_reason,version,
        created_by,created_at,updated_by,updated_at,request_id
      ) values($1,$2,$3,$4,$5,upper(btrim($5)),'PCS',$6,1,1,'ACTIVE',now()-interval '1 day',
        1,$7,$8,'purchase01',now()-interval '2 hours',$9,
        'operations01',now()-interval '1 hour',$10,'APPROVED','',3,
        'purchase01',now()-interval '3 hours','operations01',now()-interval '1 hour',$10)
      returning id::text id,mapping_uid::text mapping_uid,mapping_version_no,version,content_digest`, [
      materialId, supplierId, supplierName, supplierCode, supplierPartNumber, unitId, contentDigest,
      createdRequestId, submittedRequestId, reviewedRequestId,
    ])).rows[0];
    await client.query(`insert into supplier_mapping_supplier_part_keys(
        supplier_id,normalized_supplier_item_code,mapping_uid,created_by,request_id,created_at
      ) values($1,upper(btrim($2)),$3,'purchase01',$4,now()-interval '3 hours')`, [
      supplierId, supplierPartNumber, mapping.mapping_uid, createdRequestId,
    ]);
    await client.query(`insert into supplier_mapping_events(
        mapping_uid,mapping_version_id,mapping_version_no,event_type,from_status,to_status,actor,result,reason,request_id,created_at
      ) values
        ($1,$2,1,'CREATED',null,'DRAFT','purchase01','SUCCESS','',$3,now()-interval '3 hours'),
        ($1,$2,1,'SUBMITTED','DRAFT','PENDING_REVIEW','purchase01','SUCCESS','',$4,now()-interval '2 hours'),
        ($1,$2,1,'APPROVED','PENDING_REVIEW','ACTIVE','operations01','SUCCESS','',$5,now()-interval '1 hour')`, [
      mapping.mapping_uid, mapping.id, createdRequestId, submittedRequestId, reviewedRequestId,
    ]);
    return mapping;
  });
}

async function isolatedFixtureMutation(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await withSupplierMappingFixtureTriggersDisabled(client, () => work(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function awardMappingQualification(awardId) {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const qualification = await loadAwardMappingQualification(client, String(awardId));
    await client.query("commit");
    return qualification;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function conversionBusinessCounts() {
  return (await pool.query(`select
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from purchase_order_lines) purchase_order_lines,
    (select count(*)::int from purchase_delivery_plans) delivery_plans,
    (select count(*)::int from warehouse_receiving_queue_entries) receiving_queue_entries`)).rows[0];
}

let sequence=0;
async function seedAward(lineCount=1, {
  inspectionType = "NONE",
  promisedDeliveryDate = "2026-10-20",
  targetDeliveryDate = "2026-10-20",
  responseDeadline = "2026-09-01",
  quoteValidUntil = "2027-12-31",
} = {}) {
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
        const baseUnitId = lineCount === 4 ? null : unitId;
        material = (await client.query(
          "insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values($1,$2,$3,'PCS',$4,'ACTIVE','PURCHASE','STOCKED',$5,'ROHS','MANUAL','admin01','admin01','admin01',$6) returning id",
          [materialCode, `履约物料 ${lineNo}`, category.id, baseUnitId, inspectionType, randomUUID()],
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
        mapping = await insertGovernedMappingFixture(client, {
          materialId: materialIds[index], supplierId, supplierCode: "SUP-FUL-A", supplierName: "供应商 A",
          supplierPartNumber: `PART-A-${index + 1}`, unitId,
        });
      }
      mappingIds.push(String(mapping.id));
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
      "insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,'履约验收','admin01','engineering01','ACCEPTED',$4,1,4,$5,'admin01') returning id",
      ["PRJ-" + suffix, customer.id, "履约项目 " + sequence, targetDeliveryDate, randomUUID()],
    );
    const requirement = await client.query(
      "insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'固化需求',10,'PCS',$2,'admin01') returning id",
      [project.rows[0].id, sourceDigest],
    );
    const planningPackage = await client.query(
      "insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id) values($1,1,$2,'ACCEPTED',$3,$4,'engineering01','engineering01',now(),'planning01',now(),3,$5) returning id",
      [project.rows[0].id, requirement.rows[0].id, targetDeliveryDate, sourceDigest, randomUUID()],
    );
    const plan = await client.query(
      "insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id) values($1,$2,1,$3,'SUBMITTED',3,$4,$5,'planning01','planning01',now(),1,$6) returning id",
      [project.rows[0].id, planningPackage.rows[0].id, targetDeliveryDate, sourceDigest, createHash("sha256").update("calc-" + sequence).digest("hex"), randomUUID()],
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
      response_deadline: responseDeadline,
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
      valid_until: quoteValidUntil,
      tax_included: false,
      freight_included: false,
      payment_terms: "纯虚拟UAT付款条件，仅用于表单验收。",
      lines: rfqLineIds.map((rfqLineId) => ({
        rfq_line_id: rfqLineId,
        quoted_quantity: "10.000000",
        minimum_order_quantity: "10.000000",
        unit_price: "12.000000",
        lead_time_days: 10,
        promised_delivery_date: promisedDeliveryDate,
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
  const bindings = (await pool.query(`select id::text binding_id,rfq_line_id::text rfq_line_id,
    supplier_mapping_version_id::text mapping_fact_id,mapping_uid::text mapping_uuid,
    mapping_version_no,mapping_row_version,mapping_content_digest
    from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 and supplier_id=$2 order by rfq_line_id`, [rfqId, supplierId])).rows;
  assert.equal(bindings.length, lineCount);
  return {
    awardId: Number(awarded.payload.award_id),
    materialId,
    materialIds,
    supplierId,
    mappingId,
    mappingIds,
    bindings,
    unitId: String((await pool.query("select id::text id from units where code='PCS'")).rows[0].id),
    rfqId,
  };
}

test.beforeEach(async()=>{sequence=0;await pool.query("truncate app_users,units,material_categories,customers,suppliers,business_code_sequences,idempotency_keys,identity_write_rate_limit_buckets,audit_log restart identity cascade");await pool.query("insert into app_users(username,display_name,role,password_hash) values('admin01','管理员','admin','x'),('manager01','经理','manager','x'),('planning01','计划','planning','x'),('engineering01','项目','engineering','x'),('purchase01','采购','purchase','x'),('purchase02','跨域采购','purchase','x'),('operations01','运营','operations','x'),('warehouse01','仓库','warehouse','x'),('quality01','品质','quality','x'),('finance01','财务','finance','x')")});test.after(async()=>pool.end());

test("restricted PO history projects lineage, credentials and zero downstream without granting cross-domain access",async()=>{
  await pool.query("select setval(pg_get_serial_sequence('procurement_sourcing_awards','id'),41,false)");
  const refs=await seedAward(4),failedRequestId=randomUUID();
  await new ProcurementRepository(pool).failureAudit("purchase01",failedRequestId,"SOURCING_AWARD_CONVERTED","AWARD_SUPPLIER_MAPPING_NOT_UNIQUE");
  const body=await conversionBody(refs.awardId,"纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。");
  const converted=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key:"po-history-success",body});
  assert.equal(converted.response.status,201,JSON.stringify(converted.payload));
  const poId=Number(converted.payload.data.purchase_orders[0].id);
  assert.notEqual(refs.awardId,poId,"history must bind the success Audit by Award ID, not a coincidentally equal PO ID");
  const fingerprint=async()=> (await pool.query(`select
    (select count(*)::int from purchase_orders) po,(select count(*)::int from purchase_order_lines) lines,
    (select count(*)::int from purchase_delivery_plans) plans,(select count(*)::int from warehouse_receiving_queue_entries) queues,
    (select count(*)::int from purchase_receipts) receipts,(select count(*)::int from inventory_ledger_entries) ledger,
    (select count(*)::int from quality_inspections) iqc,(select count(*)::int from finance_documents where doc_type='AP') ap,
    (select count(*)::int from finance_settlements) payment,(select count(*)::int from production_work_orders) work_orders`)).rows[0];
  const before=await fingerprint();
  const first=await fulfillment(`/api/procurement/purchase-orders/${poId}/history`,{username:"purchase01"});
  assert.equal(first.response.status,200,JSON.stringify(first.payload));
  const history=first.payload.data;
  assert.equal(history.contract_version,"PO_HISTORY_TRACEABILITY_V1");assert.equal(history.read_only,true);
  assert.equal(history.purchase_order.purchase_order_id,String(poId));assert.equal(history.purchase_order.remark,body.remark);
  assert.equal(history.purchase_order.po_convertible_now,false);assert.equal(history.purchase_order.total_amount,"480.000000");
  assert.deepEqual([history.lineage.project.id,history.lineage.material_requirement_plan.id,history.lineage.purchase_request.id,history.lineage.rfq.id,history.lineage.quote.id,history.lineage.award.id,history.lineage.purchase_order.id].map(String),[history.lineage.project.id,history.lineage.material_requirement_plan.id,history.lineage.purchase_request.id,String(refs.rfqId),history.lineage.quote.id,String(refs.awardId),String(poId)]);
  assert.equal(history.lines.length,4);assert.equal(history.delivery_plans.length,4);assert.equal(history.line_summary.duplicate_material,false);
  assert.deepEqual(history.lines.map(line=>[line.award_line_id,line.candidate_id,line.quote_line_id,line.binding_id,line.mapping_fact_id,line.quantity,line.unit_price,line.line_amount,line.received_quantity,line.planned_delivery_date]),refs.bindings.map((binding,index)=>[String(index+1),String(index+1),String(index+1),binding.binding_id,binding.mapping_fact_id,"10.000000","12.000000","120.000000","0.000000","2026-10-20"]));
  assert.ok(history.delivery_plans.every((plan,index)=>plan.purchase_order_line_id===history.lines[index].purchase_order_line_id&&plan.award_line_id===history.lines[index].award_line_id&&plan.status==="PENDING"&&plan.version===1&&plan.queue_status==="OPEN_PENDING"&&plan.queue_version===1&&plan.plan_event_type==="CREATED"));
  assert.equal(history.credentials.purchase_order_event.event_type,"CREATED");assert.equal(history.credentials.purchase_order_event.result,"SUCCESS");
  assert.equal(history.credentials.audit.action,"SOURCING_AWARD_CONVERTED");assert.equal(history.credentials.audit.result,"SUCCESS");
  assert.equal(history.credentials.idempotency.http_status,201);assert.match(history.credentials.idempotency.key_digest,/^[0-9a-f]{64}$/);assert.match(history.credentials.idempotency.request_digest,/^[0-9a-f]{64}$/);
  assert.deepEqual({available:history.credentials.historical_failed_attempt.available,relation:history.credentials.historical_failed_attempt.relation,requestId:history.credentials.historical_failed_attempt.request_id,result:history.credentials.historical_failed_attempt.result,http:history.credentials.historical_failed_attempt.http_status,source:history.credentials.historical_failed_attempt.http_status_source,count:history.credentials.historical_failed_attempt.business_record_count},{available:true,relation:"UNBOUND_PRIOR_ATTEMPT",requestId:failedRequestId,result:"FAILED",http:422,source:"LEGACY_ERROR_CONTRACT",count:0});
  for(const field of ["receipt","warehouse_receipt","inventory_ledger","lot","iqc","ap","payment","work_order","production_report","production_completion"])assert.equal(history.downstream[field],0,field);
  assert.equal(history.downstream.all_zero,true);assert.equal(history.governance_boundary.authorization_verified,false);
  const refreshed=await fulfillment(`/api/procurement/purchase-orders/${poId}/history`,{username:"purchase01"});
  assert.equal(refreshed.response.status,200);assert.deepEqual(refreshed.payload.data.lines,history.lines);assert.deepEqual(refreshed.payload.data.delivery_plans,history.delivery_plans);assert.deepEqual(await fingerprint(),before);
  const denied=await fulfillment(`/api/procurement/purchase-orders/${poId}/history`,{username:"purchase02"});
  assert.equal(denied.response.status,403);assert.equal(denied.payload.code,"PERMISSION_DENIED");assert.doesNotMatch(JSON.stringify(denied.payload),/SUP-FUL-A|Idempotency|key_digest|request_digest/);
  const hiddenList=await fulfillment("/api/procurement/fulfillment/orders?page_size=100",{username:"purchase02"});assert.equal(hiddenList.response.status,200);assert.deepEqual(hiddenList.payload.data,[]);
  const visibleList=await fulfillment("/api/procurement/fulfillment/orders?page_size=100",{username:"purchase01"});assert.ok(visibleList.payload.data.some(row=>Number(row.purchase_order_id)===poId));
  const auditCount=Number((await pool.query("select count(*) value from audit_log")).rows[0].value);
  const rejectedMethod=await fulfillment(`/api/procurement/purchase-orders/${poId}/history`,{method:"POST",username:"purchase01",body:{}});assert.equal(rejectedMethod.response.status,405);assert.equal(Number((await pool.query("select count(*) value from audit_log")).rows[0].value),auditCount);
  assert.ok(!permissionsForRole("purchase").includes("system.audit.read"));assert.deepEqual(await fingerprint(),before);
});

test("four-line Award confirmation fails closed and atomically creates one PO with 4 Lines and 4 direct plans", async () => {
  const refs = await seedAward(4);
  const previewResponse = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`);
  assert.equal(previewResponse.response.status, 200, JSON.stringify(previewResponse.payload));
  const preview = previewResponse.payload.data;
  assert.equal(preview.contract_version, "AWARD_PO_CONFIRMATION_V2");
  assert.deepEqual({
    contract: preview.mapping_qualification.contract_version,
    allQualified: preview.mapping_qualification.all_qualified,
    qualifiedLines: preview.mapping_qualification.qualified_line_count,
    lines: preview.mapping_qualification.line_count,
  }, {
    contract: "AWARD_PO_MAPPING_QUALIFICATION_V1",
    allQualified: true,
    qualifiedLines: 4,
    lines: 4,
  });
  assert.match(preview.mapping_qualification.qualification_digest, /^[0-9a-f]{64}$/);
  assert.ok(preview.mapping_qualification.lines.every((line) => line.qualified
    && line.error_code === null && line.reason === "Supplier Mapping资格通过"
    && line.mapping_status === "ACTIVE" && line.binding_status === "ACTIVE"
    && line.supplier_status === "ACTIVE" && line.material_status === "ACTIVE"
    && line.supplier_unit_code === "PCS" && line.internal_unit_code === "PCS"
    && line.conversion_numerator === "1" && line.conversion_denominator === "1"
    && line.supplier_material_conflict_count === 0 && line.supplier_part_number_conflict_count === 0));
  assert.deepEqual((await pool.query(`select count(*)::int line_count,
      count(*) filter(where material.base_unit_id is null and material.base_uom='PCS')::int legacy_unit_count
    from procurement_sourcing_award_lines line
    join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id
    join material_master material on material.id=rfq_line.material_id
    where line.award_id=$1`, [refs.awardId])).rows[0], { line_count: 4, legacy_unit_count: 4 });
  const governedMappingFacts = (await pool.query(`select mapping.id::text mapping_fact_id,
      mapping.mapping_uid::text mapping_uuid,mapping.mapping_version_no,mapping.version mapping_row_cas,
      mapping.content_digest,count(event.id)::int event_count,
      array_agg(event.event_type order by event.created_at,event.id) event_types
    from supplier_mappings mapping
    join supplier_mapping_events event on event.mapping_version_id=mapping.id
    where mapping.id=any($1::bigint[])
    group by mapping.id order by mapping.id`, [refs.mappingIds])).rows;
  assert.equal(governedMappingFacts.length, 4);
  assert.ok(governedMappingFacts.every((row) => row.mapping_version_no === 1 && row.mapping_row_cas === 3
    && /^[0-9a-f]{64}$/.test(row.content_digest) && row.event_count === 3
    && JSON.stringify(row.event_types) === JSON.stringify(["CREATED", "SUBMITTED", "APPROVED"])));
  const authoritativeLineage = (await pool.query(`select line.id::text award_line_id,candidate.id::text candidate_id,
      quote_line.id::text quote_line_id,binding.id::text rfq_binding_id,line.supplier_id::text supplier_id,
      rfq_line.material_id::text material_id,binding.supplier_mapping_version_id::text mapping_fact_id,
      binding.mapping_uid::text mapping_uuid,binding.mapping_version_no,binding.mapping_row_version mapping_row_cas,
      binding.mapping_content_digest content_digest
    from procurement_sourcing_award_lines line
    join procurement_sourcing_awards award on award.id=line.award_id
    join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id and rfq_line.rfq_id=award.rfq_id
    join procurement_quote_comparison_lines candidate on candidate.comparison_id=line.comparison_id
      and candidate.quote_line_id=line.selected_quote_line_id and candidate.supplier_id=line.supplier_id
    join procurement_supplier_quote_lines quote_line on quote_line.id=line.selected_quote_line_id
      and quote_line.rfq_line_id=line.rfq_line_id
    join procurement_rfq_supplier_line_mapping_bindings binding on binding.rfq_id=award.rfq_id
      and binding.rfq_line_id=line.rfq_line_id and binding.supplier_id=line.supplier_id
    where line.award_id=$1 order by line.id`, [refs.awardId])).rows;
  assert.deepEqual(preview.mapping_qualification.lines.map((line) => ({
    award_line_id: line.award_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    rfq_binding_id: line.rfq_binding_id,
    supplier_id: line.supplier_id,
    material_id: line.material_id,
    mapping_fact_id: line.mapping_fact_id,
    mapping_uuid: line.mapping_uuid,
    mapping_version_no: line.mapping_version_no,
    mapping_row_cas: line.mapping_row_cas,
    content_digest: line.content_digest,
  })), authoritativeLineage);
  const directQualification = await awardMappingQualification(refs.awardId);
  assert.equal(directQualification.qualification_digest, preview.mapping_qualification.qualification_digest);
  assert.deepEqual(directQualification.lines, preview.mapping_qualification.lines);
  await isolatedFixtureMutation(async (client) => {
    const unrelatedSupplier = (await client.query(`insert into suppliers(
        supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id
      ) values('SUP-FUL-UNRELATED','无关供应商','无关供应商','ACTIVE','admin01','admin01',$1) returning id::text id`, [randomUUID()])).rows[0];
    await insertGovernedMappingFixture(client, {
      materialId: refs.materialIds[0], supplierId: unrelatedSupplier.id,
      supplierCode: "SUP-FUL-UNRELATED", supplierName: "无关供应商",
      supplierPartNumber: "UNRELATED-PART", unitId: refs.unitId,
    });
  });
  const afterUnrelatedMapping = (await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`)).payload.data;
  assert.equal(afterUnrelatedMapping.mapping_qualification.qualification_digest, preview.mapping_qualification.qualification_digest);
  assert.deepEqual(afterUnrelatedMapping.mapping_qualification.lines, preview.mapping_qualification.lines);
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
    po_line.material_id::text po_material_id,po_line.supplier_mapping_id::text po_mapping_fact_id,
    binding.id::text rfq_binding_id,binding.supplier_mapping_version_id::text binding_mapping_fact_id,
    po_line.order_qty::text po_quantity,po_line.unit_price::text po_price,
    plan.id::text plan_id,plan.purchase_order_line_id::text plan_po_line_id,plan.material_id::text plan_material_id,
    plan.planned_quantity::text plan_quantity,plan.promised_delivery_date::text plan_date
    from procurement_sourcing_award_lines award_line
    join procurement_sourcing_awards award on award.id=award_line.award_id
    join procurement_rfq_lines rfq_line on rfq_line.id=award_line.rfq_line_id
    join procurement_rfq_supplier_line_mapping_bindings binding on binding.rfq_id=award.rfq_id
      and binding.rfq_line_id=award_line.rfq_line_id and binding.supplier_id=award_line.supplier_id
    join procurement_award_po_line_links link on link.award_line_id=award_line.id
    join purchase_order_lines po_line on po_line.id=link.purchase_order_line_id
    join purchase_delivery_plans plan on plan.purchase_order_line_id=po_line.id
    where award_line.award_id=$1 order by award_line.id`, [refs.awardId])).rows;
  assert.equal(linked.length, 4);
  assert.ok(linked.every((row) => row.award_material_id === row.po_material_id
    && row.po_material_id === row.plan_material_id && row.award_quantity === row.po_quantity
    && row.po_quantity === row.plan_quantity && row.award_price === row.po_price
    && row.award_date === row.plan_date && row.po_line_id === row.plan_po_line_id
    && row.po_mapping_fact_id === row.binding_mapping_fact_id));
  assert.deepEqual(linked.map((row) => row.po_mapping_fact_id), preview.mapping_qualification.lines.map((line) => line.mapping_fact_id));
  assert.deepEqual(await zeroCounts(), { ...emptyConversionCounts, purchase_orders: 1, purchase_order_lines: 4, po_source_links: 1, po_status_events: 1, links: 4, plans: 4, queues: 4, plan_events: 4, conversion_success_audits: 1, conversion_idempotency_keys: 1 });
  assert.deepEqual((await pool.query(`select award.status award_status,award.version award_version,award.award_digest,
    rfq.status rfq_status,rfq.version rfq_version,
    (select count(*)::int from procurement_supplier_quotes where rfq_id=rfq.id) quote_count,
    (select count(*)::int from procurement_quote_comparisons where rfq_id=rfq.id) comparison_line_count
    from procurement_sourcing_awards award join procurement_rfqs rfq on rfq.id=award.rfq_id where award.id=$1`, [refs.awardId])).rows[0], upstream);
});

test("concurrent Mapping version creation and Award conversion serialize without deadlock or partial PO facts", async () => {
  const refs = await seedAward(4);
  const body = await conversionBody(refs.awardId, "Mapping并发隔离测试");
  const mappingUuid = refs.bindings[0].mapping_uuid;
  const [converted, versioned] = await Promise.all([
    fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, {
      method: "POST", key: "mapping-conversion-race", body,
    }),
    supplierMapping(`/api/supplier-mappings/${mappingUuid}/versions`, {
      method: "POST", key: "mapping-version-race", body: { expected_version: 3 },
    }),
  ]);
  assert.equal(versioned.response.status, 201, JSON.stringify(versioned.payload));
  assert.ok([201, 422].includes(converted.response.status), JSON.stringify(converted.payload));
  const counts = await conversionBusinessCounts();
  if (converted.response.status === 201) {
    assert.deepEqual(counts, {
      purchase_orders: 1, purchase_order_lines: 4, delivery_plans: 4, receiving_queue_entries: 4,
    });
  } else {
    assert.equal(converted.payload.code, "AWARD_MAPPING_VERSION_DRIFT");
    assert.match(converted.payload.message, /Award Line .*Supplier .*Material .*最新版本/);
    assert.deepEqual(counts, {
      purchase_orders: 0, purchase_order_lines: 0, delivery_plans: 0, receiving_queue_entries: 0,
    });
  }
});

test("Award Mapping state, effective period, unit and fixed fact drift return the same GET/POST blocker and create no PO facts", async () => {
  const refs = await seedAward(4);
  const previewResult = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`);
  assert.equal(previewResult.response.status, 200, JSON.stringify(previewResult.payload));
  const baseline = previewResult.payload.data;
  assert.equal(baseline.mapping_qualification.all_qualified, true);
  const body = { ...baseline.confirmation, remark: "Mapping失败关闭隔离测试" };
  const mappingFactId = refs.mappingIds[0], bindingId = refs.bindings[0].binding_id;
  const original = (await pool.query(`select mapping.valid_from,mapping.valid_to,mapping.content_digest,
      mapping.purchase_unit_id::text purchase_unit_id,supplier.status supplier_status,
      material.material_status
    from supplier_mappings mapping
    join suppliers supplier on supplier.id=mapping.supplier_id
    join material_master material on material.id=mapping.material_id
    where mapping.id=$1`, [mappingFactId])).rows[0];
  const expectedZero = { purchase_orders: 0, purchase_order_lines: 0, delivery_plans: 0, receiving_queue_entries: 0 };

  const assertBlocked = async (expectedCode, mutate, restore) => {
    await isolatedFixtureMutation(mutate);
    try {
      const blockedPreviewResult = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`);
      assert.equal(blockedPreviewResult.response.status, 200, JSON.stringify(blockedPreviewResult.payload));
      const blockedPreview = blockedPreviewResult.payload.data;
      assert.equal(blockedPreview.po_convertible_now, false);
      const previewFailure = blockedPreview.mapping_qualification.lines.find((line) => !line.qualified);
      assert.ok(previewFailure);
      assert.equal(previewFailure.error_code, expectedCode);
      assert.match(previewFailure.reason, /^Award Line [1-9]\d* \/ Supplier [1-9]\d* \/ Material [1-9]\d*：/);
      const rejected = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, {
        method: "POST", body,
      });
      assert.equal(rejected.response.status, 422, JSON.stringify(rejected.payload));
      assert.equal(rejected.payload.code, expectedCode, JSON.stringify(rejected.payload));
      assert.equal(rejected.payload.message, previewFailure.reason);
      assert.deepEqual(await conversionBusinessCounts(), expectedZero);
    } finally { await isolatedFixtureMutation(restore); }
    const restored = (await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`)).payload.data;
    assert.equal(restored.po_convertible_now, true);
    assert.equal(restored.mapping_qualification.qualification_digest, baseline.mapping_qualification.qualification_digest);
  };

  await assertBlocked("AWARD_MAPPING_NOT_ACTIVE",
    (client) => client.query("update supplier_mappings set status='INACTIVE' where id=$1", [mappingFactId]),
    (client) => client.query("update supplier_mappings set status='ACTIVE' where id=$1", [mappingFactId]));

  await assertBlocked("AWARD_MAPPING_NOT_YET_EFFECTIVE",
    async (client) => {
      await client.query("update supplier_mappings set valid_from=transaction_timestamp()+interval '1 day' where id=$1", [mappingFactId]);
      await client.query("update procurement_rfq_supplier_line_mapping_bindings set valid_from=transaction_timestamp()+interval '1 day' where id=$1", [bindingId]);
    },
    async (client) => {
      await client.query("update supplier_mappings set valid_from=$2 where id=$1", [mappingFactId, original.valid_from]);
      await client.query("update procurement_rfq_supplier_line_mapping_bindings set valid_from=$2 where id=$1", [bindingId, original.valid_from]);
    });

  await assertBlocked("AWARD_MAPPING_EXPIRED",
    async (client) => {
      await client.query("update supplier_mappings set valid_to=transaction_timestamp()-interval '1 hour' where id=$1", [mappingFactId]);
      await client.query("update procurement_rfq_supplier_line_mapping_bindings set valid_to=transaction_timestamp()-interval '1 hour' where id=$1", [bindingId]);
    },
    async (client) => {
      await client.query("update supplier_mappings set valid_to=$2 where id=$1", [mappingFactId, original.valid_to]);
      await client.query("update procurement_rfq_supplier_line_mapping_bindings set valid_to=$2 where id=$1", [bindingId, original.valid_to]);
    });

  const alternateUnitId = await isolatedFixtureMutation(async (client) => String((await client.query(
    "insert into units(code,name,symbol,unit_type,enabled) values('EACH','单件','EA','COUNT',true) returning id",
  )).rows[0].id));
  await assertBlocked("AWARD_MAPPING_UNIT_MISMATCH",
    async (client) => {
      await client.query("update supplier_mappings set purchase_unit_id=$2 where id=$1", [mappingFactId, alternateUnitId]);
      await client.query("update procurement_rfq_supplier_line_mapping_bindings set purchase_unit_id=$2 where id=$1", [bindingId, alternateUnitId]);
    },
    async (client) => {
      await client.query("update supplier_mappings set purchase_unit_id=$2 where id=$1", [mappingFactId, original.purchase_unit_id]);
      await client.query("update procurement_rfq_supplier_line_mapping_bindings set purchase_unit_id=$2 where id=$1", [bindingId, original.purchase_unit_id]);
    });

  await assertBlocked("AWARD_MAPPING_SUPPLIER_NOT_ACTIVE",
    (client) => client.query("update suppliers set status='INACTIVE' where id=$1", [refs.supplierId]),
    (client) => client.query("update suppliers set status=$2 where id=$1", [refs.supplierId, original.supplier_status]));

  await assertBlocked("AWARD_MAPPING_MATERIAL_NOT_ACTIVE",
    (client) => client.query("update material_master set material_status='INACTIVE' where id=$1", [refs.materialIds[0]]),
    (client) => client.query("update material_master set material_status=$2 where id=$1", [refs.materialIds[0], original.material_status]));

  const driftDigest = createHash("sha256").update("fixed-mapping-real-drift").digest("hex");
  await assertBlocked("AWARD_MAPPING_DIGEST_DRIFT",
    (client) => client.query("update supplier_mappings set content_digest=$2 where id=$1", [mappingFactId, driftDigest]),
    (client) => client.query("update supplier_mappings set content_digest=$2 where id=$1", [mappingFactId, original.content_digest]));

  const conflictClient = await pool.connect();
  let conflictCode = "";
  try {
    await conflictClient.query("begin");
    await conflictClient.query("set local session_replication_role=replica");
    try {
      await conflictClient.query(`insert into supplier_mappings(
          material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,
          conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id
        ) values($1,$2,'供应商 A','SUP-FUL-A','CONFLICTING-PART','PCS',$3,1,1,'ACTIVE',
          transaction_timestamp()-interval '1 day','purchase01','purchase01',$4)`, [
        refs.materialIds[0], refs.supplierId, refs.unitId, randomUUID(),
      ]);
    } catch (error) { conflictCode = String(error.code || ""); }
  } finally {
    await conflictClient.query("rollback").catch(() => undefined);
    conflictClient.release();
  }
  assert.equal(conflictCode, "23P01", "PostgreSQL exclusion constraint must reject a second overlapping ACTIVE 1:1 Mapping");
  assert.equal((await awardMappingQualification(refs.awardId)).qualification_digest, baseline.mapping_qualification.qualification_digest);

  const exclusionName = "supplier_mappings_active_material_period_excl";
  const exclusionDefinition = (await pool.query(
    "select pg_get_constraintdef(oid) definition from pg_constraint where conname=$1 and conrelid='supplier_mappings'::regclass",
    [exclusionName],
  )).rows[0]?.definition;
  assert.ok(exclusionDefinition);
  let syntheticConflictId = null;
  await pool.query(`alter table supplier_mappings drop constraint ${exclusionName}`);
  try {
    syntheticConflictId = await isolatedFixtureMutation(async (client) => String((await client.query(`insert into supplier_mappings(
        material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,
        conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id
      ) values($1,$2,'供应商 A','SUP-FUL-A','CONFLICTING-PART','PCS',$3,1,1,'ACTIVE',
        transaction_timestamp()-interval '1 day','purchase01','purchase01',$4) returning id::text id`, [
      refs.materialIds[0], refs.supplierId, refs.unitId, randomUUID(),
    ])).rows[0].id));
    const conflictPreview = (await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`)).payload.data;
    const conflictFailure = conflictPreview.mapping_qualification.lines.find((line) => !line.qualified);
    assert.equal(conflictPreview.po_convertible_now, false);
    assert.equal(conflictFailure?.error_code, "AWARD_MAPPING_SUPPLIER_MATERIAL_CONFLICT");
    assert.equal(conflictFailure?.supplier_material_conflict_count, 1);
    const conflictPost = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, {
      method: "POST", body,
    });
    assert.equal(conflictPost.response.status, 422, JSON.stringify(conflictPost.payload));
    assert.equal(conflictPost.payload.code, "AWARD_MAPPING_SUPPLIER_MATERIAL_CONFLICT");
    assert.equal(conflictPost.payload.message, conflictFailure.reason);
    assert.deepEqual(await conversionBusinessCounts(), expectedZero);
  } finally {
    if (syntheticConflictId) {
      await isolatedFixtureMutation((client) => client.query("delete from supplier_mappings where id=$1", [syntheticConflictId]));
    }
    await pool.query(`alter table supplier_mappings add constraint ${exclusionName} ${exclusionDefinition}`);
  }
  assert.equal((await awardMappingQualification(refs.awardId)).qualification_digest, baseline.mapping_qualification.qualification_digest);

  await isolatedFixtureMutation((client) => client.query("delete from supplier_mappings where id=$1", [mappingFactId]));
  const missingPreview = (await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`)).payload.data;
  const missingFailure = missingPreview.mapping_qualification.lines.find((line) => !line.qualified);
  assert.equal(missingPreview.po_convertible_now, false);
  assert.ok(missingFailure);
  assert.equal(missingFailure.error_code, "AWARD_MAPPING_FACT_MISSING");
  const missingPost = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", body });
  assert.equal(missingPost.response.status, 422, JSON.stringify(missingPost.payload));
  assert.equal(missingPost.payload.code, "AWARD_MAPPING_FACT_MISSING");
  assert.equal(missingPost.payload.message, missingFailure.reason);
  assert.deepEqual(await conversionBusinessCounts(), expectedZero);
});

test("warehouse receipt readiness GET exposes the four-line minimum DTO without cross-domain audit access or writes", async () => {
  const refs = await seedAward(4);
  const body = await conversionBody(refs.awardId, "仓库只读谱系隔离测试");
  const converted = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", body });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.payload));
  const po = converted.payload.data.purchase_orders[0];
  const planId = Number(po.delivery_plans[0].id);
  const fingerprint = async () => (await pool.query(`select
    (select count(*)::int from purchase_receipts) receipts,
    (select count(*)::int from warehouse_receipt_evidence) evidence,
    (select count(*)::int from inventory_lots) lots,
    (select count(*)::int from quality_inspections) iqc,
    (select count(*)::int from inventory_ledger_entries) ledger,
    (select count(*)::int from finance_documents where doc_type='AP') ap,
    (select count(*)::int from finance_settlements) payment,
    (select count(*)::int from production_work_orders) work_orders,
    (select jsonb_agg(jsonb_build_array(id,version,status,received_quantity) order by id) from purchase_delivery_plans) plans,
    (select jsonb_agg(jsonb_build_array(id,version,closed_at) order by id) from warehouse_receiving_queue_entries) queues`)).rows[0];
  const before = await fingerprint();

  const response = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipt-preview`, { role: "warehouse" });
  assert.equal(response.response.status, 200, JSON.stringify(response.payload));
  const readiness = response.payload.data;
  assert.equal(readiness.contract_version, "WAREHOUSE_RECEIPT_READINESS_V1");
  assert.equal(readiness.read_only, true);
  assert.equal(readiness.data_timezone, "Asia/Shanghai");
  assert.deepEqual(Object.keys(readiness.creation_evidence).sort(), ["action", "actor", "created_at_shanghai", "operation_id", "request_id", "result"]);
  assert.equal(readiness.creation_evidence.result, "SUCCESS");
  assert.equal(readiness.purchase_order.id, String(po.id));
  assert.equal(readiness.purchase_order.version, 1);
  assert.equal(readiness.purchase_order.status, "OPEN");
  assert.equal(readiness.purchase_order.currency_code, "CNY");
  assert.equal(readiness.purchase_order.total_amount, "480.000000");
  assert.equal(readiness.lines.length, 4);
  assert.deepEqual(readiness.lines.map((line) => [line.purchase_order_line_id, line.award_line_id, line.material_id, line.quantity, line.received_quantity, line.remaining_quantity, line.delivery_plan.version, line.delivery_plan.status, line.delivery_plan.promised_delivery_date, line.queue.version, line.queue.status]),
    po.lines.map((line, index) => [String(line.id), String(index + 1), String(refs.materialIds[index]), "10.000000", "0.000000", "10.000000", 1, "PENDING", "2026-10-20", 1, "OPEN_PENDING"]));
  assert.equal(readiness.selected_receipt.quantity, null);
  assert.equal(readiness.selected_receipt.initial_confirmation_blocked, true);
  assert.equal(readiness.selected_receipt.target.warehouse_model, "NOT_SEPARATELY_MODELED");
  assert.equal(readiness.selected_receipt.target.location_code, "MAIN");
  assert.equal(readiness.receipt_accounting_boundary.supplier_notification_or_in_transit_model_available, false);
  assert.equal(readiness.receipt_accounting_boundary.next_responsibility.includes("quality"), true);
  assert.equal(readiness.downstream.all_zero, true);
  for (const field of ["receipt", "warehouse_receipt", "inventory_ledger", "lot", "iqc", "ap", "payment", "work_order", "production_report", "production_completion"]) assert.equal(readiness.downstream[field], 0, field);
  const dtoKeys = [];
  const collectKeys = (value) => { if (!value || typeof value !== "object") return;for (const [key, child] of Object.entries(value)) { dtoKeys.push(key.toLowerCase());collectKeys(child); } };
  collectKeys(readiness);
  for (const secret of ["request_body", "response_body", "cookie", "session", "sensitive_header", "idempotency_key_digest", "password_hash"]) assert.ok(!dtoKeys.includes(secret), secret);
  assert.ok(!permissionsForRole("warehouse").includes("system.audit.read"));

  const historyDenied = await fulfillment(`/api/procurement/purchase-orders/${po.id}/history`, { role: "warehouse" });
  assert.equal(historyDenied.response.status, 403);assert.equal(historyDenied.payload.code, "PERMISSION_DENIED");
  const previewDenied = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipt-preview`, { role: "quality" });
  assert.equal(previewDenied.response.status, 403);assert.equal(previewDenied.payload.code, "PERMISSION_DENIED");
  const methodDenied = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipt-preview`, { method: "POST", role: "warehouse", body: {} });
  assert.equal(methodDenied.response.status, 405);assert.equal(methodDenied.payload.code, "METHOD_NOT_ALLOWED");
  assert.deepEqual(await fingerprint(), before);
});

test("receipt date, evidence, CAS, CSRF, role, legacy-entry and rate gates reject without half records", async () => {
  const refs = await seedAward(1, { promisedDeliveryDate: "2099-10-20", targetDeliveryDate: "2099-10-30", responseDeadline: "2099-09-01", quoteValidUntil: "2099-12-31" });
  const converted = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", body: await conversionBody(refs.awardId) });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.payload));
  const planId = Number(converted.payload.data.purchase_orders[0].delivery_plans[0].id);
  const valid = await receiptBody(planId, "1");
  assert.equal(valid.expected_early_arrival, true);
  const state = async () => (await pool.query(`select
    (select count(*)::int from purchase_receipts) receipts,
    (select count(*)::int from purchase_receipt_lines) receipt_lines,
    (select count(*)::int from warehouse_receipt_evidence) evidence,
    (select count(*)::int from inventory_ledger_entries) ledger,
    (select count(*)::int from inventory_lots) lots,
    (select count(*)::int from quality_inspections) iqc,
    (select count(*)::int from purchase_financial_source_entries) financial_sources,
    (select version from purchase_orders limit 1) po_version,
    (select version from purchase_order_lines limit 1) line_version,
    (select version from purchase_delivery_plans limit 1) plan_version,
    (select version from warehouse_receiving_queue_entries limit 1) queue_version`)).rows[0];
  const before = await state();
  const reject = async (candidate, code, options = {}) => {
    const result = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`, { method: "POST", role: "warehouse", body: candidate, ...options });
    assert.notEqual(result.response.status, 201, JSON.stringify(result.payload));
    assert.equal(result.payload.code, code, JSON.stringify(result.payload));
    assert.deepEqual(await state(), before);
  };
  const missingQuantity = { ...valid };delete missingQuantity.quantity;
  await reject(missingQuantity, "REQUEST_VALIDATION_FAILED");
  await reject({ ...valid, quantity: "" }, "REQUEST_VALIDATION_FAILED");
  await reject({ ...valid, quantity: "0" }, "REQUEST_VALIDATION_FAILED");
  await reject({ ...valid, quantity: "-1" }, "REQUEST_VALIDATION_FAILED");
  await reject({ ...valid, quantity: "11" }, "PURCHASE_RECEIPT_OVER_QUANTITY");
  const future = new Date(`${valid.evidence_document_date}T00:00:00Z`);future.setUTCDate(future.getUTCDate() + 1);
  await reject({ ...valid, evidence_document_date: future.toISOString().slice(0, 10) }, "RECEIPT_EVIDENCE_FUTURE_DATE");
  await reject({ ...valid, actual_receipt_at: "2099-10-20T00:00:00+08:00" }, "RECEIPT_TIME_SERVER_CONTROLLED");
  await reject({ ...valid, early_arrival_reason: "", early_arrival_confirmed: false }, "EARLY_ARRIVAL_EVIDENCE_REQUIRED");
  await reject({ ...valid, expected_early_arrival: false }, "RECEIPT_CONFIRMATION_STALE");
  await reject({ ...valid, expected_purchase_order_version: valid.expected_purchase_order_version + 1 }, "PURCHASE_ORDER_VERSION_OR_STATE_CONFLICT");
  await reject({ ...valid, expected_line_version: valid.expected_line_version + 1 }, "PURCHASE_ORDER_LINE_VERSION_CONFLICT");
  await reject({ ...valid, expected_version: valid.expected_version + 1 }, "DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT");
  await reject({ ...valid, expected_queue_version: valid.expected_queue_version + 1 }, "RECEIVING_QUEUE_VERSION_OR_STATE_CONFLICT");
  await reject({ ...valid, expected_balance_version: valid.expected_balance_version + 1 }, "INVENTORY_VERSION_CONFLICT");
  await reject(valid, "CSRF_INVALID", { csrf: false });

  const roleDenied = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`, { method: "POST", role: "purchase", body: valid });
  assert.equal(roleDenied.response.status, 403);assert.equal(roleDenied.payload.code, "PERMISSION_DENIED");
  const legacyReceipt = await procurement("/api/purchase-receipts", { method: "POST", role: "warehouse", body: {} });
  assert.equal(legacyReceipt.response.status, 403);assert.equal(legacyReceipt.payload.code, "PERMISSION_DENIED");
  const legacyReceive = await procurement("/api/purchase-receive", { method: "POST", role: "warehouse", body: {} });
  assert.equal(legacyReceive.response.status, 403);assert.equal(legacyReceive.payload.code, "PERMISSION_DENIED");
  assert.ok(!permissionsForRole("warehouse").includes("procurement.receive"));

  await pool.query(`insert into identity_write_rate_limit_buckets(username,bucket_start,attempt_count,new_key_count,rejected_count,updated_at)
    values('warehouse01',date_trunc('minute',now()),60,20,0,now())
    on conflict(username,bucket_start) do update set attempt_count=60,new_key_count=20,rejected_count=0,updated_at=now()`);
  await reject(valid, "RATE_LIMITED");
  await pool.query("delete from identity_write_rate_limit_buckets where username='warehouse01'");
  assert.deepEqual(await state(), before);
});

test("complete early-arrival evidence wins once and IQC stock remains frozen for the quality queue", async () => {
  const refs = await seedAward(1, { inspectionType: "IQC", promisedDeliveryDate: "2099-10-20", targetDeliveryDate: "2099-10-30", responseDeadline: "2099-09-01", quoteValidUntil: "2099-12-31" });
  const converted = await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`, { method: "POST", body: await conversionBody(refs.awardId) });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.payload));
  const planId = Number(converted.payload.data.purchase_orders[0].delivery_plans[0].id);
  const body = await receiptBody(planId, "10", { reason: "隔离数据库完整提前到货证据" });
  assert.equal(body.expected_early_arrival, true);assert.ok(body.supplier_lot_code);
  const keys = ["early-receipt-a", "early-receipt-b"];
  const attempts = await Promise.all(keys.map((key) => fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`, { method: "POST", role: "warehouse", key, body })));
  assert.deepEqual(attempts.map((item) => item.response.status).sort(), [201, 409]);
  const winningIndex = attempts.findIndex((item) => item.response.status === 201), won = attempts[winningIndex], winningKey = keys[winningIndex];
  assert.ok(won);assert.equal(won.payload.warehouse_receipt_evidence.early_arrival, true);
  const replay = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`, { method: "POST", role: "warehouse", key: winningKey, body });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const conflict = await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`, { method: "POST", role: "warehouse", key: winningKey, body: { ...body, reason: "异正文" } });
  assert.equal(conflict.response.status, 409);assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const receiptLineId = Number(won.payload.data.lines[0].id);
  const fact = (await pool.query(`select lot.lot_code,lot.supplier_lot_code,lot.status lot_status,lot.version lot_version,
      balance.on_hand_qty::text on_hand,balance.frozen_qty::text frozen,
      (balance.on_hand_qty-balance.reserved_qty-balance.frozen_qty)::text available,balance.version balance_version,
      ledger.entry_type,ledger.on_hand_delta::text ledger_quantity,evidence.evidence_type,evidence.early_arrival,
      (select count(*)::int from purchase_receipts) receipts,(select count(*)::int from purchase_receipt_lines) receipt_lines,
      (select count(*)::int from warehouse_receipt_evidence) evidence_count,(select count(*)::int from quality_inspections) iqc,
      (select count(*)::int from purchase_financial_source_entries) financial_sources,
      (select count(*)::int from finance_documents where doc_type='AP') ap,
      (select count(*)::int from finance_settlements) payment,
      (select count(*)::int from production_work_orders) work_orders,
      (select count(*)::int from production_reports) production_reports,
      (select count(*)::int from production_completions) production_completions
    from purchase_receipt_lines line join inventory_lots lot on lot.source_purchase_receipt_line_id=line.id
    join inventory_stock_balances balance on balance.inventory_lot_id=lot.id and balance.location_code='MAIN'
    join inventory_ledger_entries ledger on ledger.id=line.inventory_ledger_entry_id
    join warehouse_receipt_evidence evidence on evidence.purchase_receipt_line_id=line.id where line.id=$1`, [receiptLineId])).rows[0];
  assert.deepEqual(fact, { lot_code: won.payload.lot_code, supplier_lot_code: body.supplier_lot_code.toUpperCase(), lot_status: "FROZEN", lot_version: 1, on_hand: "10.000000", frozen: "10.000000", available: "0.000000", balance_version: 1, entry_type: "IQC_RECEIPT", ledger_quantity: "10.000000", evidence_type: "DELIVERY_NOTE", early_arrival: true, receipts: 1, receipt_lines: 1, evidence_count: 1, iqc: 0, financial_sources: 1, ap: 0, payment: 0, work_orders: 0, production_reports: 0, production_completions: 0 });

  const iqcBody = { inspection_type: "IQC", purchase_receipt_line_id: receiptLineId, inspected_qty: "10", passed_qty: "10", failed_qty: "0", responsible_stage: "IQC", results: [{ characteristic: "综合", result: "PASS" }], defects: [] };
  const warehouseDenied = await call(handleQualityApi, "/api/quality-inspections", { method: "POST", role: "warehouse", body: iqcBody });
  assert.equal(warehouseDenied.response.status, 403);assert.equal(warehouseDenied.payload.code, "PERMISSION_DENIED");
  assert.ok(!permissionsForRole("warehouse").includes("quality.inspect"));assert.ok(permissionsForRole("quality").includes("quality.inspect"));
  const sourceOptions = await quality("/api/quality/source-options?inspection_type=IQC", { method: "GET" });
  assert.equal(sourceOptions.response.status, 200);assert.equal(sourceOptions.payload.data.length, 1);assert.equal(Number(sourceOptions.payload.data[0].purchase_receipt_line_id), receiptLineId);
  const inspected = await quality("/api/quality-inspections", { method: "POST", body: iqcBody });
  assert.equal(inspected.response.status, 201, JSON.stringify(inspected.payload));
  const afterInspection = (await pool.query(`select lot.status,balance.on_hand_qty::text on_hand,balance.frozen_qty::text frozen,
      (balance.on_hand_qty-balance.reserved_qty-balance.frozen_qty)::text available,
      (select count(*)::int from quality_inspections where purchase_receipt_line_id=$1) iqc
    from inventory_lots lot join inventory_stock_balances balance on balance.inventory_lot_id=lot.id
    where lot.source_purchase_receipt_line_id=$1`, [receiptLineId])).rows[0];
  assert.deepEqual(afterInspection, { status: "FROZEN", on_hand: "10.000000", frozen: "10.000000", available: "0.000000", iqc: 1 });
});

test("Award 10 x 12 becomes PO with its authoritative plan, two evidenced receipts 4/6, inventory 10 and explicit AP 48/72",async()=>{
  const refs=await seedAward(),key="convert-award-main",body=await conversionBody(refs.awardId,"隔离采购订单备注");
  const converted=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body});
  assert.equal(converted.response.status,201,JSON.stringify(converted.payload));
  const replay=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body});assert.equal(replay.response.headers.get("Idempotency-Replayed"),"true");
  const conflict=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body:{...body,expected_award_version:2}});assert.equal(conflict.payload.code,"IDEMPOTENCY_CONFLICT");
  const po=converted.payload.data.purchase_orders[0],poId=Number(po.id),poLineId=Number(po.lines[0].id),planId=Number(po.delivery_plans[0].id);
  assert.equal(po.remark,"隔离采购订单备注");assert.equal(po.lines[0].order_qty,"10.000000");assert.equal(po.lines[0].unit_price,"12.000000");
  assert.deepEqual(converted.payload.data.summary,{conversion_operation_count:1,purchase_order_aggregate_count:1,purchase_order_line_count:1,delivery_plan_aggregate_count:1,delivery_plan_line_count:0,receiving_queue_entry_count:1});
  let counts=(await pool.query("select (select count(*) from purchase_receipts)::int receipts,(select count(*) from warehouse_receipt_evidence)::int evidence,(select count(*) from inventory_ledger_entries)::int ledger,(select count(*) from finance_documents where doc_type='AP')::int ap,(select count(*) from purchase_delivery_plans)::int plans,(select count(*) from warehouse_receiving_queue_entries)::int queues,(select count(*) from purchase_delivery_plan_events where event_type='CREATED')::int plan_events")).rows[0];
  assert.deepEqual(counts,{receipts:0,evidence:0,ledger:0,ap:0,plans:1,queues:1,plan_events:1});

  const receiveKey="receive-four-main",receiveFour=await receiptBody(planId,"4",{reason:"首批到货 4"});
  const first=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:receiveFour});
  assert.equal(first.response.status,201,JSON.stringify(first.payload));assert.equal(first.payload.delivery_plan.status,"PARTIAL");assert.equal(first.payload.delivery_plan.received_quantity,"4.000000");assert.equal(first.payload.data.financial_source.amount,"48.000000");
  assert.equal(Number(first.payload.warehouse_receipt_evidence.purchase_receipt_id),first.payload.receipt_id);
  const firstReplay=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:receiveFour});assert.equal(firstReplay.response.headers.get("Idempotency-Replayed"),"true");
  const firstConflict=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:{...receiveFour,quantity:"3"}});assert.equal(firstConflict.payload.code,"IDEMPOTENCY_CONFLICT");

  const ap48=await finance("/api/finance/documents",{method:"POST",role:"finance",body:{doc_type:"AP",purchase_source_entry_id:Number(first.payload.data.financial_source.id),accounting_date:"2026-07-26",due_date:"2026-08-26"}});assert.equal(ap48.response.status,201,JSON.stringify(ap48.payload));assert.equal(ap48.payload.data.total_amount,"48.000000");
  const current=await receiptBody(planId,"1");
  const stale=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{...current,expected_version:1,reason:"陈旧计划"}});assert.equal(stale.payload.code,"DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT");
  const over=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{...current,quantity:"7",reason:"超收"}});assert.equal(over.payload.code,"PURCHASE_RECEIPT_OVER_QUANTITY");

  const faultBody=await receiptBody(planId,"6",{reason:"故障注入"});
  const faultRequest=randomUUID(),faultMeta={actor:actor("warehouse"),requestId:faultRequest,operationId:randomUUID(),keyDigest:createHash("sha256").update("fault-main").digest("hex"),requestDigest:createHash("sha256").update("fault-body").digest("hex"),method:"POST",route:`/api/procurement/delivery-plans/${planId}/receipts`,action:"DELIVERY_PLAN_RECEIVED"},faultService=new ProcurementFulfillmentService(new ProcurementRepository(pool),undefined,checkpoint=>{if(checkpoint==="after_receipt_allocation")throw new Error("forced fulfillment failure")});
  await assert.rejects(faultService.receive(planId,faultMeta,faultBody),/服务器暂时无法处理采购请求/);
  assert.deepEqual((await pool.query("select received_quantity,version from purchase_delivery_plans where id=$1",[planId])).rows[0],{received_quantity:"4.000000",version:2});assert.deepEqual((await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1",[refs.materialId])).rows[0],{on_hand_qty:"4.000000",version:1});assert.equal(Number((await pool.query("select count(*) count from purchase_receipts where reason='故障注入'")).rows[0].count),0);assert.equal(Number((await pool.query("select count(*) count from warehouse_receipt_evidence where request_id=$1",[faultRequest])).rows[0].count),0);

  const secondBody=await receiptBody(planId,"6",{reason:"第二批到货 6"});
  const second=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:secondBody});assert.equal(second.response.status,201,JSON.stringify(second.payload));assert.equal(second.payload.delivery_plan.status,"COMPLETED");assert.equal(second.payload.data.financial_source.amount,"72.000000");
  const ap72=await finance("/api/finance/documents",{method:"POST",role:"finance",body:{doc_type:"AP",purchase_source_entry_id:Number(second.payload.data.financial_source.id),accounting_date:"2026-07-26",due_date:"2026-08-26"}});assert.equal(ap72.response.status,201,JSON.stringify(ap72.payload));assert.equal(ap72.payload.data.total_amount,"72.000000");
  const totals=(await pool.query(`select (select status from purchase_orders where id=$1) po_status,(select status from purchase_delivery_plans where id=$2) plan_status,(select received_qty::text from purchase_order_lines where id=$3) received,(select on_hand_qty::text from inventory_stock_balances where material_id=$4) inventory,(select sum(amount)::text from purchase_financial_source_entries where entry_type='RECEIPT') sources,(select sum(total_amount)::text from finance_documents where doc_type='AP') ap_total,(select count(*)::int from procurement_award_po_line_links where award_id=$5) links,(select count(*)::int from purchase_receipt_delivery_allocations where reversal_of_allocation_id is null) allocations,(select count(*)::int from warehouse_receipt_evidence) evidence`,[poId,planId,poLineId,refs.materialId,refs.awardId])).rows[0];assert.deepEqual(totals,{po_status:"RECEIVED",plan_status:"COMPLETED",received:"10.000000",inventory:"10.000000",sources:"120.000000",ap_total:"120.000000",links:1,allocations:2,evidence:2});
  const awardReverse=await sourcing(`/api/procurement/awards/${refs.awardId}/reversal`,{method:"POST",body:{expected_version:1,reason:"不应允许"}});assert.equal(awardReverse.payload.code,"AWARD_HAS_PURCHASE_ORDER");
  const blocked=await fulfillment(`/api/procurement/fulfillment/receipts/${second.payload.receipt_id}/reversal`,{method:"POST",role:"warehouse",body:{reason:"已有 AP 不应冲销",expected_plan_version:3,expected_line_versions:[{purchase_order_line_id:poLineId,expected_line_version:3}],expected_balance_versions:[{material_id:refs.materialId,expected_balance_version:2}]}});assert.equal(blocked.payload.code,"RECEIPT_REVERSAL_BLOCKED_BY_AP");assert.equal((await pool.query("select on_hand_qty::text value from inventory_stock_balances where material_id=$1",[refs.materialId])).rows[0].value,"10.000000");
  const pending=(await fulfillment("/api/procurement/fulfillment/payable-handoff?page_size=100",{role:"finance"})).payload.data;assert.deepEqual(pending.map(row=>[row.amount,row.handoff_status]).sort(),[["48.000000","AP_CREATED"],["72.000000","AP_CREATED"]]);await assert.rejects(pool.query("update procurement_award_po_line_links set award_id=award_id"),/immutable/);await assert.rejects(pool.query("update purchase_delivery_plans set version=version+1"),/service transaction/);
});

test("concurrent Award conversion creates one PO and plan result, plan cancellation is constrained and forbidden roles cannot mutate",async()=>{const refs=await seedAward(),body=await conversionBody(refs.awardId);const attempts=await Promise.all(["convert-concurrent-a","convert-concurrent-b"].map(key=>fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body})));assert.deepEqual(attempts.map(x=>x.response.status).sort(),[201,409]);assert.equal(Number((await pool.query("select count(*) count from procurement_award_po_line_links where award_id=$1",[refs.awardId])).rows[0].count),1);assert.equal(Number((await pool.query("select count(*) count from purchase_orders where source_type='SOURCING_AWARD'")).rows[0].count),1);assert.equal(Number((await pool.query("select count(*) count from purchase_delivery_plans")).rows[0].count),1);for(const role of ["engineering","planning","finance","warehouse"]){const denied=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",role,body});assert.equal(denied.response.status,403,role)}const poId=Number((await pool.query("select purchase_order_id from procurement_award_po_line_links where award_id=$1",[refs.awardId])).rows[0].purchase_order_id);const deniedPlan=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",role:"warehouse",body:{expected_version:1}});assert.equal(deniedPlan.response.status,403);const duplicatePlan=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",body:{expected_version:1}});assert.equal(duplicatePlan.payload.code,"DELIVERY_PLAN_ALREADY_EXISTS");const planId=Number((await pool.query("select id from purchase_delivery_plans where purchase_order_id=$1",[poId])).rows[0].id);const earlyClose=await fulfillment(`/api/procurement/delivery-plans/${planId}/close`,{method:"POST",body:{expected_version:1,reason:"尚未收货"}});assert.equal(earlyClose.payload.code,"DELIVERY_PLAN_CLOSE_CONFLICT");const cancelled=await fulfillment(`/api/procurement/delivery-plans/${planId}/cancel`,{method:"POST",body:{expected_version:1,reason:"采购取消未收货计划"}});assert.equal(cancelled.response.status,200);assert.equal(cancelled.payload.data.status,"CANCELLED");const queue=(await pool.query("select close_reason,created_by,updated_by,created_at,updated_at from warehouse_receiving_queue_entries where delivery_plan_id=$1",[planId])).rows[0];assert.equal(queue.close_reason,"采购取消未收货计划");assert.equal(queue.created_by,"purchase01");assert.equal(queue.updated_by,"purchase01");assert.ok(queue.created_at);assert.ok(queue.updated_at);const deniedReceive=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"purchase",body:{}});assert.equal(deniedReceive.response.status,403);const blockedBody=await receiptBody(planId,"1",{reason:"取消后收货"});const blockedReceive=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:blockedBody});assert.equal(blockedReceive.payload.code,"DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT")});
