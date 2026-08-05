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
async function call(handler,path,{method="GET",role="purchase",key=randomUUID(),body,csrf=true}={}){const requestId=randomUUID(),headers=new Headers({"X-Request-ID":requestId});if(body!==undefined)headers.set("Content-Type","application/json");if(key)headers.set("Idempotency-Key",key);if(csrf)headers.set("X-CSRF-Token","test-csrf");const request=new Request(`http://local.test${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const response=await handler(request,{pool,actor:actor(role),requestId,requireCsrf:()=>{if(headers.get("X-CSRF-Token")!=="test-csrf")throw Object.assign(new Error("CSRF Token 无效"),{code:"CSRF_INVALID",status:403})}});assert.ok(response);return{response,payload:await response.json()}}
const fulfillment=(path,options)=>call(handleProcurementFulfillmentApi,path,options),finance=(path,options)=>call(handleFinanceApi,path,options),sourcing=(path,options)=>call(handleProcurementSourcingApi,path,options);

let sequence=0;
async function seedAward() {
  sequence += 1;
  const suffix = String(sequence).padStart(8, "0");
  const sourceDigest = createHash("sha256").update("source-" + sequence).digest("hex");
  const client = await pool.connect();
  let materialId = 0;
  let supplierId = 0;
  let mappingId = 0;
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

    let material = (await client.query("select id from material_master where internal_material_code='CYD-FUL-000001'")).rows[0];
    if (!material) {
      material = (await client.query(
        "insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('CYD-FUL-000001','履约连接器',$1,'PCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL','admin01','admin01','admin01',$3) returning id",
        [category.id, unitId, randomUUID()],
      )).rows[0];
    }
    materialId = Number(material.id);

    let supplier = (await client.query("select id from suppliers where supplier_code='SUP-FUL-A'")).rows[0];
    if (!supplier) {
      supplier = (await client.query(
        "insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-FUL-A','供应商 A','供应商 A','ACTIVE','admin01','admin01',$1) returning id",
        [randomUUID()],
      )).rows[0];
    }
    supplierId = Number(supplier.id);

    let mapping = (await client.query(
      "select id from supplier_mappings where supplier_id=$1 and material_id=$2",
      [supplierId, materialId],
    )).rows[0];
    if (!mapping) {
      mapping = (await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(
        "insert into supplier_mappings(material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id) values($1,$2,'供应商 A','SUP-FUL-A','PART-A','PCS',$3,1,1,'ACTIVE',now()-interval '1 day','admin01','admin01',$4) returning id",
        [materialId, supplierId, unitId, randomUUID()],
      ))).rows[0];
    }
    mappingId = Number(mapping.id);

    let customer = (await client.query("select id from customers where customer_code='CUS-FUL'")).rows[0];
    if (!customer) {
      customer = (await client.query(
        "insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-FUL','履约客户','履约客户','ACTIVE','admin01','admin01',$1) returning id",
        [randomUUID()],
      )).rows[0];
    }

    const project = await client.query(
      "insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,'履约验收','admin01','engineering01','ACCEPTED','2026-10-01',1,4,$4,'admin01') returning id",
      ["PRJ-" + suffix, customer.id, "履约项目 " + sequence, randomUUID()],
    );
    const requirement = await client.query(
      "insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'固化需求',10,'PCS',$2,'admin01') returning id",
      [project.rows[0].id, sourceDigest],
    );
    const planningPackage = await client.query(
      "insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id) values($1,1,$2,'ACCEPTED','2026-10-01',$3,'engineering01','engineering01',now(),'planning01',now(),3,$4) returning id",
      [project.rows[0].id, requirement.rows[0].id, sourceDigest, randomUUID()],
    );
    const plan = await client.query(
      "insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id) values($1,$2,1,'2026-10-01','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id",
      [project.rows[0].id, planningPackage.rows[0].id, sourceDigest, createHash("sha256").update("calc-" + sequence).digest("hex"), randomUUID()],
    );
    const planLine = await client.query(
      "insert into planning_material_requirement_lines(plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest) values($1,1,$2,$3,$4,$5,10,0,0,0,0,10,$6) returning id",
      [plan.rows[0].id, materialId, unitId, { internal_material_code: "CYD-FUL-000001", standard_name: "履约连接器" }, sourceDigest, sourceDigest],
    );
    const purchaseRequest = await client.query(
      "insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,version,request_id) values($1,$2,'SUBMITTED','planning01',now(),1,$3) returning id",
      ["PRQ-" + suffix, plan.rows[0].id, randomUUID()],
    );
    purchaseRequestId = Number(purchaseRequest.rows[0].id);
    await client.query(
      "insert into planning_purchase_request_lines(purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity) values($1,$2,1,$3,$4,10)",
      [purchaseRequestId, planLine.rows[0].id, materialId, unitId],
    );
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
  const rfqLineId = Number((await pool.query(
    "select id from procurement_rfq_lines where rfq_id=$1",
    [rfqId],
  )).rows[0].id);

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
      tax_included: true,
      freight_included: true,
      payment_terms: "月结 30 天",
      lines: [{
        rfq_line_id: rfqLineId,
        quoted_quantity: "10.000000",
        minimum_order_quantity: "10.000000",
        unit_price: "12.000000",
        lead_time_days: 10,
        promised_delivery_date: "2026-10-01",
      }],
    },
  });
  assert.equal(quoted.response.status, 201, JSON.stringify(quoted.payload));

  const compared = await sourcing("/api/procurement/rfqs/" + rfqId + "/comparisons", {
    method: "POST",
    body: { expected_version: 3 },
  });
  assert.equal(compared.response.status, 201, JSON.stringify(compared.payload));
  const quoteLineId = Number((await pool.query(
    "select quote_line_id from procurement_quote_comparison_lines where comparison_id=$1",
    [compared.payload.comparison_id],
  )).rows[0].quote_line_id);

  const awarded = await sourcing("/api/procurement/rfqs/" + rfqId + "/award", {
    method: "POST",
    body: {
      expected_version: 4,
      reason_code: "SOLE_SOURCE",
      reason: "唯一有效报价，价格与交期满足",
      lines: [{
        rfq_line_id: rfqLineId,
        selected_quote_line_id: quoteLineId,
        selected_quantity: "10.000000",
        selection_reason: "价格与交期满足",
        late_delivery_reason_code: "",
        late_delivery_reason: "",
        excess_quantity_reason: "",
      }],
    },
  });
  assert.equal(awarded.response.status, 201, JSON.stringify(awarded.payload));
  return {
    awardId: Number(awarded.payload.award_id),
    materialId,
    supplierId,
    mappingId,
  };
}

test.beforeEach(async()=>{sequence=0;await pool.query("truncate app_users,units,material_categories,customers,suppliers,business_code_sequences,idempotency_keys,identity_write_rate_limit_buckets,audit_log restart identity cascade");await pool.query("insert into app_users(username,display_name,role,password_hash) values('admin01','管理员','admin','x'),('manager01','经理','manager','x'),('planning01','计划','planning','x'),('engineering01','项目','engineering','x'),('purchase01','采购','purchase','x'),('warehouse01','仓库','warehouse','x'),('finance01','财务','finance','x')")});test.after(async()=>pool.end());

test("Award 10 x 12 becomes PO, two receipts 4/6, inventory 10 and explicit AP 48/72",async()=>{const refs=await seedAward(),key="convert-award-main",body={expected_version:1};const converted=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body});assert.equal(converted.response.status,201,JSON.stringify(converted.payload));const replay=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body});assert.equal(replay.response.headers.get("Idempotency-Replayed"),"true");const conflict=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body:{expected_version:2}});assert.equal(conflict.payload.code,"IDEMPOTENCY_CONFLICT");const po=converted.payload.data.purchase_orders[0],poId=Number(po.id),poLineId=Number(po.lines[0].id);assert.equal(po.lines[0].order_qty,"10.000000");assert.equal(po.lines[0].unit_price,"12.000000");let counts=(await pool.query("select (select count(*) from purchase_receipts)::int receipts,(select count(*) from inventory_ledger_entries)::int ledger,(select count(*) from finance_documents where doc_type='AP')::int ap")).rows[0];assert.deepEqual(counts,{receipts:0,ledger:0,ap:0});
 const planned=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",body:{expected_version:1}});assert.equal(planned.response.status,201,JSON.stringify(planned.payload));const plan=planned.payload.data.plans[0],planId=Number(plan.id);counts=(await pool.query("select (select count(*) from purchase_receipts)::int receipts,(select count(*) from inventory_ledger_entries)::int ledger,(select count(*) from finance_documents where doc_type='AP')::int ap")).rows[0];assert.deepEqual(counts,{receipts:0,ledger:0,ap:0});
 const receiveKey="receive-four-main",receiveFour={quantity:"4",expected_version:1,expected_line_version:1,expected_balance_version:0,reason:"首批到货 4"},first=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:receiveFour});assert.equal(first.response.status,201,JSON.stringify(first.payload));assert.equal(first.payload.delivery_plan.status,"PARTIAL");assert.equal(first.payload.delivery_plan.received_quantity,"4.000000");assert.equal(first.payload.data.financial_source.amount,"48.000000");const firstReplay=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:receiveFour});assert.equal(firstReplay.response.headers.get("Idempotency-Replayed"),"true");const firstConflict=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",key:receiveKey,body:{...receiveFour,quantity:"3"}});assert.equal(firstConflict.payload.code,"IDEMPOTENCY_CONFLICT");
 const ap48=await finance("/api/finance/documents",{method:"POST",role:"finance",body:{doc_type:"AP",purchase_source_entry_id:Number(first.payload.data.financial_source.id),accounting_date:"2026-07-26",due_date:"2026-08-26"}});assert.equal(ap48.response.status,201,JSON.stringify(ap48.payload));assert.equal(ap48.payload.data.total_amount,"48.000000");const stale=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"1",expected_version:1,expected_line_version:2,expected_balance_version:1,reason:"陈旧计划"}});assert.equal(stale.payload.code,"DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT");const over=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"7",expected_version:2,expected_line_version:2,expected_balance_version:1,reason:"超收"}});assert.equal(over.payload.code,"PURCHASE_RECEIPT_OVER_QUANTITY");
 const faultRequest=randomUUID(),faultMeta={actor:actor("warehouse"),requestId:faultRequest,operationId:randomUUID(),keyDigest:createHash("sha256").update("fault-main").digest("hex"),requestDigest:createHash("sha256").update("fault-body").digest("hex"),method:"POST",route:`/api/procurement/delivery-plans/${planId}/receipts`,action:"DELIVERY_PLAN_RECEIVED"},faultService=new ProcurementFulfillmentService(new ProcurementRepository(pool),undefined,checkpoint=>{if(checkpoint==="after_receipt_allocation")throw new Error("forced fulfillment failure")});await assert.rejects(faultService.receive(planId,faultMeta,{quantity:"6",expected_version:2,expected_line_version:2,expected_balance_version:1,reason:"故障注入"}),/服务器暂时无法处理采购请求/);assert.deepEqual((await pool.query("select received_quantity,version from purchase_delivery_plans where id=$1",[planId])).rows[0],{received_quantity:"4.000000",version:2});assert.deepEqual((await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1",[refs.materialId])).rows[0],{on_hand_qty:"4.000000",version:1});assert.equal(Number((await pool.query("select count(*) count from purchase_receipts where reason='故障注入'")).rows[0].count),0);
 const second=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"6",expected_version:2,expected_line_version:2,expected_balance_version:1,reason:"第二批到货 6"}});assert.equal(second.response.status,201,JSON.stringify(second.payload));assert.equal(second.payload.delivery_plan.status,"COMPLETED");assert.equal(second.payload.data.financial_source.amount,"72.000000");const ap72=await finance("/api/finance/documents",{method:"POST",role:"finance",body:{doc_type:"AP",purchase_source_entry_id:Number(second.payload.data.financial_source.id),accounting_date:"2026-07-26",due_date:"2026-08-26"}});assert.equal(ap72.response.status,201,JSON.stringify(ap72.payload));assert.equal(ap72.payload.data.total_amount,"72.000000");
 const totals=(await pool.query(`select (select status from purchase_orders where id=$1) po_status,(select status from purchase_delivery_plans where id=$2) plan_status,(select received_qty::text from purchase_order_lines where id=$3) received,(select on_hand_qty::text from inventory_stock_balances where material_id=$4) inventory,(select sum(amount)::text from purchase_financial_source_entries where entry_type='RECEIPT') sources,(select sum(total_amount)::text from finance_documents where doc_type='AP') ap_total,(select count(*)::int from procurement_award_po_line_links where award_id=$5) links,(select count(*)::int from purchase_receipt_delivery_allocations where reversal_of_allocation_id is null) allocations`,[poId,planId,poLineId,refs.materialId,refs.awardId])).rows[0];assert.deepEqual(totals,{po_status:"RECEIVED",plan_status:"COMPLETED",received:"10.000000",inventory:"10.000000",sources:"120.000000",ap_total:"120.000000",links:1,allocations:2});
 const awardReverse=await sourcing(`/api/procurement/awards/${refs.awardId}/reversal`,{method:"POST",body:{expected_version:1,reason:"不应允许"}});assert.equal(awardReverse.payload.code,"AWARD_HAS_PURCHASE_ORDER");const blocked=await fulfillment(`/api/procurement/fulfillment/receipts/${second.payload.receipt_id}/reversal`,{method:"POST",role:"warehouse",body:{reason:"已有 AP 不应冲销",expected_plan_version:3,expected_line_versions:[{purchase_order_line_id:poLineId,expected_line_version:3}],expected_balance_versions:[{material_id:refs.materialId,expected_balance_version:2}]}});assert.equal(blocked.payload.code,"RECEIPT_REVERSAL_BLOCKED_BY_AP");assert.equal((await pool.query("select on_hand_qty::text value from inventory_stock_balances where material_id=$1",[refs.materialId])).rows[0].value,"10.000000");
 const pending=(await fulfillment("/api/procurement/fulfillment/payable-handoff?page_size=100",{role:"finance"})).payload.data;assert.deepEqual(pending.map(row=>[row.amount,row.handoff_status]).sort(),[["48.000000","AP_CREATED"],["72.000000","AP_CREATED"]]);await assert.rejects(pool.query("update procurement_award_po_line_links set award_id=award_id"),/immutable/);await assert.rejects(pool.query("update purchase_delivery_plans set version=version+1"),/service transaction/);
});

test("concurrent Award conversion creates one PO result, plan cancellation is constrained and forbidden roles cannot mutate",async()=>{const refs=await seedAward();const attempts=await Promise.all(["convert-concurrent-a","convert-concurrent-b"].map(key=>fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",key,body:{expected_version:1}})));assert.deepEqual(attempts.map(x=>x.response.status).sort(),[201,409]);assert.equal(Number((await pool.query("select count(*) count from procurement_award_po_line_links where award_id=$1",[refs.awardId])).rows[0].count),1);assert.equal(Number((await pool.query("select count(*) count from purchase_orders where source_type='SOURCING_AWARD'")).rows[0].count),1);for(const role of ["engineering","planning","finance","warehouse"]){const denied=await fulfillment(`/api/procurement/awards/${refs.awardId}/purchase-orders`,{method:"POST",role,body:{expected_version:1}});assert.equal(denied.response.status,403,role)}const poId=Number((await pool.query("select purchase_order_id from procurement_award_po_line_links where award_id=$1",[refs.awardId])).rows[0].purchase_order_id);const deniedPlan=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",role:"warehouse",body:{expected_version:1}});assert.equal(deniedPlan.response.status,403);const planned=await fulfillment(`/api/procurement/purchase-orders/${poId}/delivery-plans`,{method:"POST",body:{expected_version:1}}),planId=Number(planned.payload.data.plans[0].id);const earlyClose=await fulfillment(`/api/procurement/delivery-plans/${planId}/close`,{method:"POST",body:{expected_version:1,reason:"尚未收货"}});assert.equal(earlyClose.payload.code,"DELIVERY_PLAN_CLOSE_CONFLICT");const cancelled=await fulfillment(`/api/procurement/delivery-plans/${planId}/cancel`,{method:"POST",body:{expected_version:1,reason:"采购取消未收货计划"}});assert.equal(cancelled.response.status,200);assert.equal(cancelled.payload.data.status,"CANCELLED");const queue=(await pool.query("select close_reason,created_by,updated_by,created_at,updated_at from warehouse_receiving_queue_entries where delivery_plan_id=$1",[planId])).rows[0];assert.equal(queue.close_reason,"采购取消未收货计划");assert.equal(queue.created_by,"purchase01");assert.equal(queue.updated_by,"purchase01");assert.ok(queue.created_at);assert.ok(queue.updated_at);const deniedReceive=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"purchase",body:{}});assert.equal(deniedReceive.response.status,403);const blockedReceive=await fulfillment(`/api/procurement/delivery-plans/${planId}/receipts`,{method:"POST",role:"warehouse",body:{quantity:"1",expected_version:2,expected_line_version:1,expected_balance_version:0,reason:"取消后收货"}});assert.equal(blockedReceive.payload.code,"DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT")});
