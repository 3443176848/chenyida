import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { finalOutputAllocations } from "../app/lib/production-selfhost/rules.ts";

test("final output allocations use stable Run Report ids, decimal strings and stable ordering",()=>{
  assert.deepEqual(finalOutputAllocations([{operation_run_report_id:9,quantity:"6.000000"},{operation_run_report_id:3,quantity:"4"}]),[
    {operationRunReportId:3,quantity:"4"},{operationRunReportId:9,quantity:"6.000000"},
  ]);
  assert.throws(()=>finalOutputAllocations([{operation_run_report_id:3,quantity:"4"},{operation_run_report_id:3,quantity:"1"}]),/不能重复/);
  assert.throws(()=>finalOutputAllocations([{operation_run_report_id:3,quantity:"0"}]),/必须是正数/);
  assert.throws(()=>finalOutputAllocations([]),/1 到 100/);
});

test("production creates reports while warehouse alone creates completions",()=>{
  assert.ok(permissionsForRole("production").includes("production.report"));
  assert.ok(!permissionsForRole("production").includes("production.complete"));
  assert.ok(permissionsForRole("warehouse").includes("production.complete"));
  assert.ok(!permissionsForRole("warehouse").includes("production.report"));
  for(const role of ["manager","admin"]){assert.ok(permissionsForRole(role).includes("production.report"));assert.ok(permissionsForRole(role).includes("production.complete"));}
});
