import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

test("purchase, warehouse and finance receive only their fulfillment handoff writes",()=>{
  for(const permission of ["procurement.fulfillment.read","procurement.award.convert","procurement.delivery_plan.manage"])assert.ok(permissionsForRole("purchase").includes(permission),permission);
  for(const permission of ["procurement.fulfillment.read","procurement.receiving.receive","procurement.receiving.reverse"])assert.ok(permissionsForRole("warehouse").includes(permission),permission);
  assert.ok(permissionsForRole("finance").includes("procurement.fulfillment.read"));assert.ok(permissionsForRole("finance").includes("finance.post"));
  assert.ok(!permissionsForRole("warehouse").includes("procurement.award.convert"));assert.ok(!permissionsForRole("purchase").includes("finance.post"));assert.ok(!permissionsForRole("finance").includes("procurement.receiving.receive"));
  for(const role of ["admin","manager"])for(const permission of ["procurement.award.convert","procurement.delivery_plan.manage","procurement.receiving.receive","procurement.receiving.reverse"])assert.ok(permissionsForRole(role).includes(permission),`${role}:${permission}`);
});

test("fulfillment orchestrator reuses procurement receipt, inventory and finance authority",async()=>{
  const source=await readFile(new URL("../app/lib/procurement-fulfillment-selfhost/service.ts",import.meta.url),"utf8");
  assert.match(source,/createOrderInTransaction/);assert.match(source,/createReceiptInTransaction/);assert.match(source,/reverseReceiptInTransaction/);
  assert.doesNotMatch(source,/insert into inventory_ledger_entries|insert into inventory_stock_balances|insert into finance_documents/i);
  assert.match(source,/SOURCING_AWARD/);assert.match(source,/supplier_id.*currency_code/);assert.match(source,/PURCHASE_RECEIPT_OVER_QUANTITY/);assert.match(source,/RECEIPT_REVERSAL_BLOCKED_BY_AP/);
});

test("0019 is the only new migration and protects relationship facts",async()=>{
  const sql=await readFile(new URL("../drizzle-postgres/0019_sourcing_purchase_fulfillment.sql",import.meta.url),"utf8");
  for(const table of ["procurement_award_po_line_links","purchase_delivery_plans","warehouse_receiving_queue_entries","purchase_receipt_delivery_allocations","purchase_delivery_plan_events"])assert.match(sql,new RegExp(`CREATE TABLE "${table}"`));
  assert.match(sql,/award has purchase order/);assert.match(sql,/procurement_fulfillment_service_write/);assert.match(sql,/delivery plan received quantity must match purchase order line/);assert.match(sql,/procurement_fulfillment_immutable/);
});
