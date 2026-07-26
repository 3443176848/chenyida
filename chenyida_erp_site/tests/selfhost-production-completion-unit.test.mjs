import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { completionAllocations } from "../app/lib/production-selfhost/rules.ts";

test("production and warehouse permissions keep reporting and receipt duties separate",()=>{
  assert.ok(permissionsForRole("production").includes("production.report"));
  assert.ok(permissionsForRole("production").includes("production.report.reverse"));
  assert.ok(!permissionsForRole("production").includes("production.complete"));
  assert.ok(permissionsForRole("warehouse").includes("production.complete"));
  assert.ok(permissionsForRole("warehouse").includes("production.complete.reverse"));
  assert.ok(!permissionsForRole("warehouse").includes("production.report"));
  for(const role of ["planning","purchase","finance","sales"])for(const permission of ["production.report","production.complete","production.report.reverse","production.complete.reverse"])assert.ok(!permissionsForRole(role).includes(permission),`${role}:${permission}`);
});

test("completion allocations require unique positive report sources and CAS versions",()=>{
  assert.deepEqual(completionAllocations([{report_id:2,quantity:"4.000001",expected_report_version:3},{report_id:1,quantity:"2",expected_report_version:1}]),[
    {reportId:1,quantity:"2",expectedReportVersion:1},{reportId:2,quantity:"4.000001",expectedReportVersion:3},
  ]);
  assert.throws(()=>completionAllocations([{report_id:1,quantity:"1",expected_report_version:1},{report_id:1,quantity:"1",expected_report_version:1}]),/不能重复报工来源/);
  assert.throws(()=>completionAllocations([{report_id:1,quantity:"0",expected_report_version:1}]),/必须是正数/);
  assert.throws(()=>completionAllocations([{report_id:1,quantity:"1",expected_report_version:-1}]),/必须是非负整数/);
});

test("0021 extends existing production authority with guarded immutable allocation and reversal facts",async()=>{
  const sql=await readFile(new URL("../drizzle-postgres/0021_production_reporting_completions.sql",import.meta.url),"utf8");
  for(const table of ["production_report_receipt_projections","production_completion_receipt_projections","production_completion_report_allocations","production_report_reversals","production_completion_reversals","production_completion_reversal_allocations","production_report_events","production_completion_events"])assert.match(sql,new RegExp(`CREATE TABLE "${table}"`));
  assert.doesNotMatch(sql,/CREATE TABLE "production_reports"|CREATE TABLE "production_completions"|CREATE TABLE "production_work_orders"/);
  assert.match(sql,/numeric\(24, 6\)/);assert.match(sql,/production receipt fact requires service transaction/);assert.match(sql,/production receipt facts are immutable/);assert.match(sql,/production completion allocation source mismatch/);
});
