import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

test("TASK08 permissions separate sales allocation, quality execution and manager disposition",()=>{
  for(const permission of ["quality.finished_goods_allocation.create","quality.finished_goods_allocation.cancel"])assert.ok(permissionsForRole("sales").includes(permission));
  for(const permission of ["quality.inspect","quality.defect","quality.close"])assert.ok(permissionsForRole("quality").includes(permission));
  assert.ok(permissionsForRole("quality").includes("quality.disposition"));
  assert.ok(!permissionsForRole("quality").includes("quality.reopen"));
  for(const permission of ["quality.disposition","quality.reopen"])assert.ok(permissionsForRole("manager").includes(permission));
  for(const role of ["production","warehouse"])assert.ok(permissionsForRole(role).includes("quality.finished_goods_allocation.read"));
  for(const role of ["purchase","finance","operations"])for(const permission of ["quality.finished_goods_allocation.create","quality.finished_goods_allocation.cancel"])assert.ok(!permissionsForRole(role).includes(permission));
});

test("0022 defines one relational allocation authority and stable FQC reference",async()=>{
  const sql=await readFile(new URL("../drizzle-postgres/0022_production_quality_release.sql",import.meta.url),"utf8");
  for(const token of ["finished_goods_sales_allocations","finished_goods_sales_allocation_events","fqc_allocation_id","completion allocation exceeded","sales order allocation exceeded","FQC must use stable active allocation","completion has active sales allocation"])assert.match(sql,new RegExp(token));
  assert.match(sql,/FOR UPDATE OF pcl,cp/);assert.match(sql,/FOR UPDATE OF sol,so/);assert.match(sql,/quality_inspections_fqc_allocation_ck/);assert.match(sql,/production_completion_reversal_allocation_gate_ck/);
  assert.doesNotMatch(sql,/CREATE TABLE "quality_inspection_results"|CREATE TABLE "quality_defects"/);
});

test("release workflow keeps shipment and finance outside TASK08 service",async()=>{
  const service=await readFile(new URL("../app/lib/quality-selfhost/service.ts",import.meta.url),"utf8");
  assert.match(service,/fqc_allocation_id/);assert.match(service,/lifecycle_status='CLOSED'/);assert.match(service,/decision_status='RELEASED'/);
  assert.doesNotMatch(service,/insert into sales_shipments/i);assert.doesNotMatch(service,/insert into sales_financial_source_entries/i);assert.doesNotMatch(service,/insert into finance_documents/i);assert.doesNotMatch(service,/reserved_qty\s*=/i);
});
