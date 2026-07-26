import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");
test("three native workspaces expose server-backed purchase, receiving and payable actions",async()=>{
  const purchase=await read("../app/procurement/fulfillment/procurement-fulfillment-workspace.tsx"),warehouse=await read("../app/warehouse/receiving/warehouse-receiving-workspace.tsx"),finance=await read("../app/finance/payables/finance-payables-workspace.tsx");
  assert.match(purchase,/pending-awards/);assert.match(purchase,/显式生成采购订单/);assert.match(purchase,/建立到货计划/);assert.match(purchase,/procurement\.award\.convert/);
  assert.match(warehouse,/receiving-queue/);assert.match(warehouse,/确认过账收货/);assert.match(warehouse,/expected_balance_version/);assert.match(warehouse,/expected_line_version/);
  assert.match(finance,/payable-handoff/);assert.match(finance,/核对并显式生成 AP/);assert.match(finance,/purchase_source_entry_id/);assert.doesNotMatch(finance,/name="amount"|total_amount:/);
});
test("native pages exist and the dashboard links distinguish pending and generated AP",async()=>{for(const path of ["../app/procurement/fulfillment/page.tsx","../app/warehouse/receiving/page.tsx","../app/finance/payables/page.tsx"])assert.match(await read(path),/Workspace/);const dashboard=await read("../app/lib/dashboard-selfhost/service.ts");assert.match(dashboard,/已收货待生成应付/);assert.match(dashboard,/已生成采购应付/);assert.match(dashboard,/\/finance\/payables/)});
