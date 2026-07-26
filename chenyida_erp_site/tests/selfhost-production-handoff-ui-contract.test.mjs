import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("three native workspaces expose role-specific production handoff actions",async()=>{
  const planning=await read("../app/planning/production-handoffs/page.tsx"),production=await read("../app/production/work-orders/page.tsx"),warehouse=await read("../app/warehouse/production-issues/page.tsx");
  assert.match(planning,/production\.handoff\.prepare/);assert.match(planning,/production\.handoff\.submit/);assert.match(planning,/提交生产/);
  assert.match(production,/production\.handoff\.decide/);assert.match(production,/production\.handoff\.work_order/);assert.match(production,/齐套校验并释放/);
  assert.match(warehouse,/production\.issue/);assert.match(warehouse,/expected_requirement_version/);assert.match(warehouse,/expected_balance_version/);assert.match(warehouse,/确认分批领料/);
});

test("dashboard exposes permission-trimmed task06 metrics and native routes",async()=>{
  const dashboard=await read("../app/lib/dashboard-selfhost/service.ts");
  for(const label of ["待生产接收","齐套不足","已释放待领料","部分领料"])assert.match(dashboard,new RegExp(label));
  for(const route of ["/planning/production-handoffs","/production/work-orders","/warehouse/production-issues"])assert.match(dashboard,new RegExp(route.replaceAll("/","\\/")));
  assert.match(dashboard,/production\.handoff\.read/);
});
