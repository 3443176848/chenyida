import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { buildAwardConversionPreview } from "../app/lib/procurement-fulfillment-selfhost/award-conversion-preview.ts";
import { buildAwardHistoryReadModel } from "../app/lib/procurement-sourcing-selfhost/award-read-model.ts";

const mappingUuids = [
  "224d1965-44ef-4c3e-901e-1926b6b07ff8",
  "43ca04d8-9933-4dac-ba21-b7fb85741830",
  "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e",
  "9659ad2d-406a-4c4c-b575-51329badc63f",
];
const supplierParts = ["UAT-A-PCBA-042576", "UAT-A-SENSOR-042576", "UAT-A-HARNESS-042576", "UAT-A-CASE-042576"];
const qualifiedMappingDigest = "a".repeat(64);
const blockedMappingDigest = "b".repeat(64);

function fourLineMappingQualification(lines, { blockedAwardLineId = null } = {}) {
  const credentialLines = lines.map((line, index) => {
    const qualified = line.award_line_id !== blockedAwardLineId;
    return {
      award_line_id: line.award_line_id,
      candidate_id: line.comparison_candidate_id,
      quote_line_id: line.quote_line_id,
      rfq_binding_id: String(index + 1),
      supplier_id: line.supplier_id,
      supplier_code: line.supplier_code,
      material_id: line.material_id,
      mapping_uuid: mappingUuids[index],
      mapping_fact_id: String(index + 1),
      mapping_version_no: 1,
      mapping_row_cas: 3,
      binding_status: "ACTIVE",
      mapping_status: qualified ? "ACTIVE" : "INACTIVE",
      supplier_status: "ACTIVE",
      material_status: "ACTIVE",
      supplier_part_number: supplierParts[index],
      supplier_unit_id: "1",
      supplier_unit_code: "PCS",
      internal_unit_id: "1",
      internal_unit_code: "PCS",
      conversion_numerator: "1",
      conversion_denominator: "1",
      valid_from: "2026-08-05",
      valid_to: null,
      content_digest: String(index + 1).repeat(64),
      supplier_material_conflict_count: 0,
      supplier_part_number_conflict_count: 0,
      qualified,
      error_code: qualified ? null : "AWARD_MAPPING_NOT_ACTIVE",
      reason: qualified ? "Supplier Mapping资格通过" : `Award Line ${line.award_line_id} / Supplier ${line.supplier_id} / Material ${line.material_id}：Mapping Fact ${index + 1} 状态为INACTIVE`,
    };
  });
  const qualifiedLineCount = credentialLines.filter((line) => line.qualified).length;
  return {
    contract_version: "AWARD_PO_MAPPING_QUALIFICATION_V1",
    observed_at: "2026-08-08T02:00:00.000000Z",
    data_timezone: "Asia/Shanghai",
    qualification_digest: blockedAwardLineId === null ? qualifiedMappingDigest : blockedMappingDigest,
    all_qualified: qualifiedLineCount === credentialLines.length,
    qualified_line_count: qualifiedLineCount,
    line_count: credentialLines.length,
    lines: credentialLines,
  };
}

test("purchase, warehouse and finance receive only their fulfillment handoff writes",()=>{
  for(const permission of ["procurement.fulfillment.read","procurement.award.convert","procurement.delivery_plan.manage"])assert.ok(permissionsForRole("purchase").includes(permission),permission);
  for(const permission of ["procurement.fulfillment.read","procurement.receiving.receive","procurement.receiving.reverse"])assert.ok(permissionsForRole("warehouse").includes(permission),permission);
  assert.ok(permissionsForRole("finance").includes("procurement.fulfillment.read"));assert.ok(permissionsForRole("finance").includes("finance.post"));
  assert.ok(!permissionsForRole("warehouse").includes("procurement.award.convert"));assert.ok(!permissionsForRole("purchase").includes("finance.post"));assert.ok(!permissionsForRole("finance").includes("procurement.receiving.receive"));
  for(const role of ["admin","manager"])for(const permission of ["procurement.award.convert","procurement.delivery_plan.manage","procurement.receiving.receive","procurement.receiving.reverse"])assert.ok(permissionsForRole(role).includes(permission),`${role}:${permission}`);
});

test("fulfillment orchestrator reuses procurement receipt, inventory and finance authority",async()=>{
  const source=await readFile(new URL("../app/lib/procurement-fulfillment-selfhost/service.ts",import.meta.url),"utf8");
  assert.match(source,/createOrderInTransaction/);assert.match(source,/createReceiptInTransaction/);assert.match(source,/reverseReceiptInTransaction/);
  assert.doesNotMatch(source,/insert into inventory_ledger_entries|insert into inventory_stock_balances|insert into finance_documents/i);
  assert.match(source,/SOURCING_AWARD/);assert.match(source,/supplier_id.*currency_code/);assert.match(source,/PURCHASE_RECEIPT_OVER_QUANTITY/);assert.match(source,/RECEIPT_REVERSAL_BLOCKED_BY_AP/);
});

test("0019 is the only new migration and protects relationship facts",async()=>{
  const sql=await readFile(new URL("../drizzle-postgres/0019_sourcing_purchase_fulfillment.sql",import.meta.url),"utf8");
  for(const table of ["procurement_award_po_line_links","purchase_delivery_plans","warehouse_receiving_queue_entries","purchase_receipt_delivery_allocations","purchase_delivery_plan_events"])assert.match(sql,new RegExp(`CREATE TABLE "${table}"`));
  assert.match(sql,/award has purchase order/);assert.match(sql,/procurement_fulfillment_service_write/);assert.match(sql,/delivery plan received quantity must match purchase order line/);assert.match(sql,/procurement_fulfillment_immutable/);
});

test("authoritative Award conversion preview derives one PO, four Lines and four direct Plan aggregates",()=>{
  const reason="交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。";
  const award={id:"1",rfq_id:"1",status:"AWARDED",award_digest:"7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55",selected_by:"uat_20260729_purchase",selected_at:"2026-08-07T12:02:24.641511Z",selected_at_shanghai:"2026-08-07 20:02:24.641511",reason_code:"DELIVERY_PRIORITY",reason,version:1,request_id:"4634fff1-988d-465b-92c6-34ffe214ddda"};
  const codes=["CYD-RB_PCB-000016","CYD-RB_SENSOR-000003","CYD-RB_CONN-000075","CYD-RB_METAL-000015"];
  const lines=[533,534,535,536].map((material,index)=>({award_line_id:String(index+1),award_id:"1",rfq_id:"1",rfq_line_id:String(index+1),line_no:index+1,material_id:String(material),internal_material_code:codes[index],standard_name:`Material ${material}`,unit_id:"1",unit_code:"PCS",comparison_line_id:String(index+1),comparison_version_no:1,comparison_candidate_id:String((index+1)*2),quote_line_id:String(index+1),quote_id:"1",quote_version_no:1,supplier_id:"1",supplier_code:"SUP-000001",supplier_name:"Supplier A",selected_quantity:"10.000000",selected_unit_price:"12.000000",currency_code:"CNY",required_date:"2026-10-30",promised_delivery_date:"2026-10-20",selection_reason:"",late_delivery_reason_code:null,late_delivery_reason:"",excess_quantity_reason:""}));
  const comparison={comparison_version_no:1,status:"CURRENT",awardable_now:false,awardability_note:"已完成定标",output_summary:{digest:"79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec"},fixed_quote_inputs:[{quote_id:"1",quote_version_no:1,supplier_id:"1",supplier_code:"SUP-000001",supplier_name:"Supplier A",supplier_quote_reference:"UAT-Q-A-042576",currency_code:"CNY"},{quote_id:"2",quote_version_no:1,supplier_id:"2",supplier_code:"SUP-000002",supplier_name:"Supplier B",supplier_quote_reference:"UAT-Q-B-042576",currency_code:"CNY"}]};
  const event={id:"9",award_id:"1",event_type:"AWARDED",actor:award.selected_by,request_id:award.request_id,result:"SUCCESS",reason,created_at:award.selected_at,occurred_at_shanghai:award.selected_at_shanghai,old_version:null,new_version:null,from_status:null,to_status:null};
  const history=buildAwardHistoryReadModel({award,award_lines:lines,award_events:[event],award_audits:[{audit_id:"1469",actor:award.selected_by,request_id:award.request_id,result:"success",old_version:6,new_version:7,occurred_at_shanghai:award.selected_at_shanghai}],rfq:{id:"1",rfq_code:"RFQ-00000001",round_no:1,status:"CLOSED",version:7,source_status:"ACCEPTED"},rfq_line_ids:["1","2","3","4"],comparison_version:comparison,purchase_order_count:0});
  const detail={header:{status:"CLOSED"},award_history:history,quotes:[{quote_id:"1",quote_version_no:1,supplier_id:1,supplier_code:"SUP-000001",supplier_name:"Supplier A",supplier_quote_reference:"UAT-Q-A-042576",status:"SUBMITTED",currency_code:"CNY",payment_terms:"纯虚拟UAT付款条件，仅用于表单验收。",tax_included:false,freight_included:false,quote_expired:false}],downstream_counts:{purchase_orders:0,purchase_order_lines:0,delivery_plans:0}};
  const mappingQualification=fourLineMappingQualification(lines);
  const preview=buildAwardConversionPreview(detail,1,mappingQualification);
  assert.equal(preview.contract_version,"AWARD_PO_CONFIRMATION_V2");
  assert.deepEqual(preview.mapping_qualification,mappingQualification);
  assert.equal(preview.po_convertible_now,true);
  assert.equal(preview.digests.decision_digest,"7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a");
  assert.deepEqual(preview.lines.map(line=>[line.award_line_id,line.material_id,line.internal_material_code,line.selected_quantity,line.selected_unit_price,line.line_amount,line.promised_delivery_date]),[["1","533",codes[0],"10.000000","12.000000","120.000000","2026-10-20"],["2","534",codes[1],"10.000000","12.000000","120.000000","2026-10-20"],["3","535",codes[2],"10.000000","12.000000","120.000000","2026-10-20"],["4","536",codes[3],"10.000000","12.000000","120.000000","2026-10-20"]]);
  assert.deepEqual(preview.planned_result,{conversion_operation_count:1,purchase_order_aggregate_count:1,purchase_order_line_count:4,delivery_plan_aggregate_count:4,delivery_plan_line_count:0,receiving_queue_entry_count:4,delivery_plan_event_count:4,totals_by_currency:[{currency_code:"CNY",total_amount:"480.000000"}],planned_delivery_dates:["2026-10-20"]});
  assert.equal(preview.model_capabilities.external_reference,false);assert.equal(preview.model_capabilities.remark,true);assert.equal(preview.selected_quotes[0].payment_terms,"纯虚拟UAT付款条件，仅用于表单验收。");
  assert.deepEqual(preview.confirmation.expected_award_line_ids,["1","2","3","4"]);assert.equal(preview.confirmation.expected_rfq_version,7);
  assert.equal(preview.confirmation.expected_mapping_qualification_digest,qualifiedMappingDigest);

  const blockedQualification=fourLineMappingQualification(lines,{blockedAwardLineId:"3"});
  const blockedPreview=buildAwardConversionPreview(detail,1,blockedQualification);
  assert.equal(blockedPreview.contract_version,"AWARD_PO_CONFIRMATION_V2");
  assert.equal(blockedPreview.po_convertible_now,false);
  assert.equal(blockedPreview.mapping_qualification.all_qualified,false);
  assert.equal(blockedPreview.mapping_qualification.qualified_line_count,3);
  assert.equal(blockedPreview.mapping_qualification.lines.find(line=>line.award_line_id==="3").error_code,"AWARD_MAPPING_NOT_ACTIVE");
  assert.match(blockedPreview.mapping_qualification.lines.find(line=>line.award_line_id==="3").reason,/Award Line 3 \/ Supplier 1 \/ Material 535：/);
  assert.equal(blockedPreview.confirmation.expected_mapping_qualification_digest,blockedMappingDigest);

  assert.throws(()=>buildAwardConversionPreview({...detail,downstream_counts:{purchase_orders:1,purchase_order_lines:4,delivery_plans:4}},1,mappingQualification),/PO计数投影不一致|当前不能转换/);
  for(const field of ["purchase_order_lines","delivery_plans"]){const missing=structuredClone(detail);delete missing.downstream_counts[field];assert.throws(()=>buildAwardConversionPreview(missing,1,mappingQualification),/缺少有效当前/);}
  for(const value of [null,false,"",[],"0"]){const invalid=structuredClone(detail);invalid.downstream_counts.delivery_plans=value;assert.throws(()=>buildAwardConversionPreview(invalid,1,mappingQualification),/缺少有效当前到货计划数量/);}
  for(const [field,value] of [["quote_expired",undefined],["quote_expired",true],["tax_included","false"],["freight_included",0],["payment_terms",""],["payment_terms",123],["payment_terms",{}]]){const invalid=structuredClone(detail);if(value===undefined)delete invalid.quotes[0][field];else invalid.quotes[0][field]=value;assert.throws(()=>buildAwardConversionPreview(invalid,1,mappingQualification),/已停止转换|付款条件/);}
  assert.throws(()=>buildAwardConversionPreview(detail,1,{...mappingQualification,all_qualified:false}),/资格摘要不完整或自相矛盾/);
});
