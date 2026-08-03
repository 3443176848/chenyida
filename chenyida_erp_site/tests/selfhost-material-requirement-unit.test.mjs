import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { canReadPurchaseRequest, purchaseRequestReadScope } from "../app/lib/material-requirement-selfhost/service.ts";
import { canonicalDigest, requiredDate } from "../app/lib/material-requirement-selfhost/validation.ts";

test("planning and purchase capabilities are separated while managers retain the full loop", () => {
  const planning = permissionsForRole("planning"), purchase = permissionsForRole("purchase");
  for (const value of ["planning.requirement.read", "planning.requirement.prepare", "planning.requirement.submit"]) assert.ok(planning.includes(value));
  assert.ok(!planning.includes("planning.purchase_request.decide"));
  for (const value of ["planning.requirement.read", "planning.purchase_request.read", "planning.purchase_request.decide"]) assert.ok(purchase.includes(value));
  assert.ok(!purchase.includes("system.audit.read"));
  assert.ok(!purchase.includes("planning.requirement.prepare")); assert.ok(!permissionsForRole("production").includes("planning.requirement.submit"));
  for (const role of ["admin", "manager"]) for (const value of ["planning.requirement.prepare", "planning.requirement.submit", "planning.purchase_request.decide"]) assert.ok(permissionsForRole(role).includes(value));
});

test("purchase request read scope is object bounded without global audit access", () => {
  const actor=(role,username)=>({role,username,permissions:permissionsForRole(role)});
  const submitted={status:"SUBMITTED",submitted_by:"planning01",accepted_by:null,returned_by:null};
  const acceptedByOwner={...submitted,status:"ACCEPTED",accepted_by:"purchase01"};
  const returnedByOther={...submitted,status:"RETURNED",returned_by:"purchase02"};
  assert.equal(purchaseRequestReadScope(actor("purchase","purchase01")),"PURCHASE_QUEUE");
  assert.equal(purchaseRequestReadScope(actor("planning","planning01")),"PLANNING_OWN");
  assert.equal(purchaseRequestReadScope(actor("manager","manager01")),"ALL");
  assert.equal(purchaseRequestReadScope(actor("production","production01")),"NONE");
  assert.equal(canReadPurchaseRequest(actor("purchase","purchase01"),submitted),true);
  assert.equal(canReadPurchaseRequest(actor("purchase","purchase01"),acceptedByOwner),true);
  assert.equal(canReadPurchaseRequest(actor("purchase","purchase01"),returnedByOther),false);
  assert.equal(canReadPurchaseRequest(actor("planning","planning01"),submitted),true);
  assert.equal(canReadPurchaseRequest(actor("planning","planning02"),submitted),false);
});

test("dates and source digests are deterministic", () => {
  assert.equal(requiredDate("2026-12-31"), "2026-12-31"); assert.equal(requiredDate(undefined, "2026-12-30"), "2026-12-30"); assert.throws(() => requiredDate("2026-02-30"), /有效/);
  assert.equal(canonicalDigest({ b: "2.000000", a: 1 }), canonicalDigest({ a: 1, b: "2.000000" })); assert.match(canonicalDigest({ quantity: "9007199254740993.000001" }), /^[0-9a-f]{64}$/);
});

test("calculation and submission are PostgreSQL numeric, locked and scope-bounded", async () => {
  const calculation = await readFile(new URL("../app/lib/material-requirement-selfhost/calculation.ts", import.meta.url), "utf8");
  const currentSupply = await readFile(new URL("../app/lib/material-requirement-selfhost/current-supply.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../app/lib/material-requirement-selfhost/service.ts", import.meta.url), "utf8");
  const handler = await readFile(new URL("../app/lib/material-requirement-selfhost/handler.ts", import.meta.url), "utf8");
  const repository = await readFile(new URL("../app/lib/material-requirement-selfhost/repository.ts", import.meta.url), "utf8");
  assert.match(calculation, /sum\(bl\.calculated_gross_quantity\)/); assert.match(calculation, /on_hand_qty-b\.reserved_qty-b\.frozen_qty/); assert.match(calculation, /order_qty-pol\.received_qty/); assert.match(calculation, /numeric\(24,6\)/);
  assert.match(calculation, /planning_material_allocations/); assert.match(calculation, /pg_advisory_xact_lock/); assert.match(calculation, /lock table purchase_orders, purchase_order_lines in share mode/);
  assert.match(repository, /client\.query\("begin"\)/); assert.match(service, /MATERIAL_REQUIREMENT_RECALC_REQUIRED/); assert.match(service, /net_purchase_requirement>0/); assert.match(service, /PLANNING_PURCHASE_REQUEST/);
  assert.doesNotMatch(service, /insert into purchase_orders|insert into supplier|request_for_quotation|supplier_quote/i); assert.doesNotMatch(service, /update inventory_stock_balances/);
  const requestDetail = service.slice(service.indexOf("async requestDetail"), service.indexOf("async requestQueue"));
  assert.match(requestDetail, /begin transaction isolation level repeatable read read only/); assert.ok(requestDetail.indexOf("canReadPurchaseRequest") < requestDetail.indexOf("loadCurrentSupplyBreakdowns"));
  assert.match(currentSupply, /sum\(b\.on_hand_qty\)/); assert.match(currentSupply, /sum\(b\.reserved_qty\)/); assert.match(currentSupply, /sum\(b\.frozen_qty\)/);
  assert.match(currentSupply, /i\.on_hand_qty-i\.reserved_qty-i\.frozen_qty/); assert.doesNotMatch(currentSupply, /greatest\(i\.on_hand_qty-i\.reserved_qty-i\.frozen_qty,0\)/); assert.match(currentSupply, /p\.status in \('SUBMITTED','ACCEPTED'\)/);
  assert.match(currentSupply, /dp\.status in \('PENDING','PARTIAL'\)/); assert.match(currentSupply, /po\.status in \('OPEN','PARTIALLY_RECEIVED'\)/); assert.match(currentSupply, /pol\.order_qty-pol\.received_qty/);
  assert.match(currentSupply, /location_code='MAIN'/); assert.match(currentSupply, /inventory_lot_position_count/); assert.match(currentSupply, /other_unavailable_supported: false/); assert.match(currentSupply, /unposted_arrival_quantity_supported: false/);
  assert.doesNotMatch(currentSupply, /insert\s+into|update\s+[a-z_]|delete\s+from/i); assert.doesNotMatch(currentSupply, /supplier_name|supplier_item_code|unit_price/);
  assert.match(handler, /if \(request\.method !== "GET"\) await repository\.failureAudit/);
});
