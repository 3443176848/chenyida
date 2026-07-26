import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("native reporting and warehouse receipt pages submit only source facts and expected versions",async()=>{
  const reporting=await read("../app/production/reporting/page.tsx"),receipt=await read("../app/warehouse/production-completions/page.tsx"),orders=await read("../app/production/work-orders/page.tsx"),client=await read("../public/erp/api-client.js");
  for(const token of ["reported_qty","good_qty","scrap_qty","process_stage","production.report"])assert.match(reporting,new RegExp(token));
  for(const token of ["allocations","report_id","expected_report_version","expected_balance_version","production.complete"])assert.match(receipt,new RegExp(token));
  assert.match(reporting,/production\.report\.reverse/);assert.match(reporting,/expected_work_order_version/);assert.match(receipt,/production\.complete\.reverse/);assert.match(receipt,/expected_completion_version/);
  assert.match(client,/production\\\/\(\?:reports\|completions\).*reverse/);assert.match(client,/protectedWriteRequest/);
  assert.doesNotMatch(reporting,/inventory_ledger/);assert.doesNotMatch(reporting,/body:JSON\.stringify\(\{[^}]*completed_qty/);assert.match(orders,/issued_supported_qty/);assert.match(orders,/waiting_receipt_qty/);
  for(const route of ["/production/reporting","/warehouse/production-completions"])assert.match(orders,new RegExp(route.replaceAll("/","\\/")));
});

test("dashboard exposes four permission-trimmed task07 indicators without creating quality facts",async()=>{
  const service=await read("../app/lib/dashboard-selfhost/service.ts");
  for(const label of ["待报工工单","已报工待入库良品","部分完工工单","已完成待品质处理数量"])assert.match(service,new RegExp(label));
  assert.match(service,/只读提示/);assert.doesNotMatch(service,/insert into quality_inspections/i);
});
