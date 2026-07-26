import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

test("planning, production and warehouse permissions are separated",()=>{
  for(const permission of ["production.handoff.read","production.handoff.prepare","production.handoff.submit"])assert.ok(permissionsForRole("planning").includes(permission),permission);
  for(const permission of ["production.handoff.read","production.handoff.decide","production.handoff.work_order","production.plan"])assert.ok(permissionsForRole("production").includes(permission),permission);
  for(const permission of ["production.handoff.read","production.issue"])assert.ok(permissionsForRole("warehouse").includes(permission),permission);
  assert.ok(!permissionsForRole("planning").includes("production.handoff.decide"));assert.ok(!permissionsForRole("production").includes("production.issue"));assert.ok(!permissionsForRole("warehouse").includes("production.handoff.work_order"));
  for(const role of ["admin","manager"])for(const permission of ["production.handoff.prepare","production.handoff.decide","production.handoff.work_order","production.issue"])assert.ok(permissionsForRole(role).includes(permission),`${role}:${permission}`);
});

test("handoff orchestration reuses work-order and inventory authorities",async()=>{
  const handoff=await readFile(new URL("../app/lib/production-handoff-selfhost/service.ts",import.meta.url),"utf8"),production=await readFile(new URL("../app/lib/production-selfhost/service.ts",import.meta.url),"utf8");
  assert.match(handoff,/createWorkOrderInTransaction/);assert.doesNotMatch(handoff,/insert into production_work_orders|insert into inventory_ledger_entries|insert into production_material_issues/i);
  assert.match(production,/inventory\.postInTransaction/);assert.match(production,/production_inventory_reservations/);assert.match(production,/on_hand_qty-reserved_qty-frozen_qty/);assert.match(production,/PRODUCTION_MATERIAL_SHORTAGE/);assert.match(production,/after_material_reservations/);
});

test("0020 declares relational facts, numeric quantities and immutable guards",async()=>{
  const sql=await readFile(new URL("../drizzle-postgres/0020_production_handoff_reservations.sql",import.meta.url),"utf8");
  for(const table of ["production_handoffs","production_handoff_items","production_handoff_events","production_handoff_work_order_links","production_inventory_reservations","production_inventory_reservation_events"])assert.match(sql,new RegExp(`CREATE TABLE "${table}"`));
  assert.match(sql,/numeric\(24,6\)/);assert.match(sql,/production_handoffs_active_uq/);assert.match(sql,/production_handoff_links_item_uq/);assert.match(sql,/production_reservations_requirement_uq/);assert.match(sql,/cyd_production_handoff_guard/);assert.match(sql,/production handoff facts are immutable/);assert.match(sql,/source is inconsistent/);
});
