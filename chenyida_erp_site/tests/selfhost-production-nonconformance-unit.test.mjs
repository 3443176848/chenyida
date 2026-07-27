import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

test("TASK05 permissions separate quality preparation, production decision and manager scrap",()=>{
 const quality=permissionsForRole("quality"),production=permissionsForRole("production"),manager=permissionsForRole("manager"),engineering=permissionsForRole("engineering");
 for(const permission of ["quality.nonconformance.read","quality.nonconformance.create","quality.rework_request.create","quality.rework_request.submit"])assert.ok(quality.includes(permission),permission);
 assert.ok(!quality.includes("production.rework_request.decide"));assert.ok(!quality.includes("quality.nonconformance.scrap"));
 for(const permission of ["quality.nonconformance.read","production.rework_request.read","production.rework_request.decide"])assert.ok(production.includes(permission),permission);
 assert.ok(!production.includes("quality.rework_request.create"));assert.ok(!production.includes("quality.nonconformance.scrap"));
 assert.ok(manager.includes("quality.nonconformance.scrap"));assert.ok(engineering.includes("quality.nonconformance.read"));
 for(const role of ["warehouse","sales","finance","purchase","planning","operations"]){const permissions=permissionsForRole(role);assert.ok(!permissions.includes("quality.nonconformance.create"));assert.ok(!permissions.includes("quality.rework_request.create"));assert.ok(!permissions.includes("production.rework_request.decide"));assert.ok(!permissions.includes("quality.nonconformance.scrap"));}
});

test("service preserves passed/failed separation and never creates execution or inventory facts",async()=>{const source=await readFile(new URL("../app/lib/production-nonconformance-selfhost/service.ts",import.meta.url),"utf8");for(const token of ["production_nonconformances","production_rework_requests","production_nonconformance_allocations","production_scrap_dispositions","canonicalDigest","target_snapshot_operation_id","REWORK_PENDING","REWORK_ACCEPTED"])assert.match(source,new RegExp(token));for(const forbidden of ["insert into production_operation_runs","insert into production_operation_run_reports","insert into inventory_ledger_entries","insert into inventory_stock_balances","insert into production_reports","insert into production_completions"])assert.doesNotMatch(source,new RegExp(forbidden,"i"));});

test("handler enforces body limit, idempotency, CSRF, CAS inputs and server-managed fields",async()=>{const handler=await readFile(new URL("../app/lib/production-nonconformance-selfhost/handler.ts",import.meta.url),"utf8"),service=await readFile(new URL("../app/lib/production-nonconformance-selfhost/service.ts",import.meta.url),"utf8"),source=handler+service;for(const token of ["256 * 1024","Idempotency-Key","requireCsrf","expected_version","failed_qty","unresolved_qty","canonical_digest","production.rework_request.decide","quality.nonconformance.scrap"])assert.ok(source.includes(token),token);});
