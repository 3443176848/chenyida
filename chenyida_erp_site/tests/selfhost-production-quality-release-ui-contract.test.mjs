import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("native allocation page calls stable APIs and handles loading, empty, 403, CAS and unknown results",async()=>{
  const page=await read("../app/sales/finished-goods-allocation/page.tsx"),client=await read("../public/erp/api-client.js");
  for(const token of ["/api/quality/finished-goods-allocation-options","/api/quality/finished-goods-allocations","expected_completion_version","expected_sales_order_line_version","idempotencyKey","resultUnknown","403","没有客户","尚无成品订单分配"])assert.match(page,new RegExp(token));
  assert.match(client,/finished-goods-allocations/);assert.match(client,/RESULT_UNKNOWN/);assert.doesNotMatch(page,/reserved_qty\s*[:=]/);
});

test("native production quality page submits IPQC report or FQC allocation and controls lifecycle",async()=>{
  const page=await read("../app/quality/production/page.tsx"),dashboard=await read("../app/lib/dashboard-selfhost/service.ts");
  for(const token of ["production_report_id","allocation_id","passed_qty","failed_qty","defects","dispositions","close","reopen","resultUnknown","403","没有可检验来源"])assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/production_completion_line_id|sales_order_line_id/);
  for(const label of ["待 IPQC 报工","已完工待订单分配","待 FQC 成品","HOLD 数量","已放行待发货数量"])assert.match(dashboard,new RegExp(label));
  for(const route of ["/sales/finished-goods-allocation","/quality/production"])assert.match(dashboard,new RegExp(route.replaceAll("/","\\/")));
});
