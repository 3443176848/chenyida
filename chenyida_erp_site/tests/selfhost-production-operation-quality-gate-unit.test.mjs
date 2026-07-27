import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { legacyRoutingDigest, routingDigest } from "../app/lib/production-routing-selfhost/digest.ts";

const operation={sequence_no:30,operation_code:"REFLOW",operation_name:"回流焊",work_center_id:3,work_center_code:"REFLOW",work_center_name:"回流焊",setup_minutes:"0.000000",run_minutes_per_unit:"1.000000",description:"",quality_gate_mode:"IPQC"};
const routing={routing_code:"RT-GATE",product_id:1,product_version_id:2,version_no:1,version_code:"V1",operations:[operation]};

test("quality gate is part of the v2 canonical digest while the legacy digest remains available",()=>{
  assert.notEqual(routingDigest(routing),routingDigest({...routing,operations:[{...operation,quality_gate_mode:"NONE"}]}));
  assert.equal(legacyRoutingDigest(routing),legacyRoutingDigest({...routing,operations:[{...operation,quality_gate_mode:"NONE"}]}));
  assert.match(routingDigest(routing),/^[0-9a-f]{64}$/);
});

test("department permissions preserve quality creation and duty separation",()=>{
  assert.ok(permissionsForRole("engineering").includes("production.routing.manage"));
  assert.ok(permissionsForRole("production").includes("production.execute"));
  assert.ok(!permissionsForRole("production").includes("quality.inspect"));
  assert.ok(permissionsForRole("quality").includes("quality.inspect"));
  assert.ok(!permissionsForRole("quality").includes("quality.disposition"));
  for(const role of ["manager","admin"]){assert.ok(permissionsForRole(role).includes("quality.disposition"));assert.ok(permissionsForRole(role).includes("quality.reopen"));}
  for(const role of ["warehouse","sales","finance","purchase"]){assert.ok(!permissionsForRole(role).includes("production.execute"));assert.ok(!permissionsForRole(role).includes("quality.inspect"));}
});

test("0028 extends existing authorities and guards every quality-gated consumption path",async()=>{
  const sql=await readFile(new URL("../drizzle-postgres/0028_production_operation_quality_gates.sql",import.meta.url),"utf8");
  for(const token of ["quality_gate_mode","production_operation_run_report_id","quality_required_qty","quality_inspected_qty","quality_released_qty","quality_hold_qty","operation report is not an IPQC-gated source","operation IPQC inspected quantity exceeds source good","upstream quality-released quantity over-consumed","final operation quality-released quantity over-consumed","released operation IPQC has downstream consumption","operation quality projection does not reconcile with immutable facts"])assert.match(sql,new RegExp(token));
  for(const duplicate of ['CREATE TABLE "quality_inspections"','CREATE TABLE "production_operation_runs"','CREATE TABLE "production_reports"','CREATE TABLE "production_completions"','CREATE TABLE "inventory_ledger_entries"'])assert.doesNotMatch(sql,new RegExp(duplicate));
});
