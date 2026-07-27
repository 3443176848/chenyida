import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { currency, expectedBalanceVersions, lines, quantity, receiptLines } from "../app/lib/procurement-selfhost/rules.ts";

test("procurement decimal and stable-ID rules reject floats, duplicates and missing mapping", () => {
  assert.equal(quantity("999999999999999999.999999", "quantity"), "999999999999999999.999999");
  assert.equal(currency("cny"), "CNY");
  assert.throws(() => quantity("0.0000001", "quantity"), /最多六位小数/);
  assert.throws(() => lines([{ material_id: 1, unit_id: 2, order_qty: "1", unit_price: "2" }]), /supplier_mapping_id/);
  assert.throws(() => lines([{ material_id: 1, unit_id: 2, supplier_mapping_id: 3, order_qty: "1", unit_price: "2" }, { material_id: 1, unit_id: 2, supplier_mapping_id: 3, order_qty: "1", unit_price: "2" }]), /不能重复物料/);
});

test("receipt inputs require every concurrency version and deterministic unique lines", () => {
  const parsed = receiptLines([{ purchase_order_line_id: 9, quantity: "1.250001", expected_line_version: 3, expected_balance_version: 4 }]);
  assert.deepEqual(parsed[0], { purchaseOrderLineId: 9, quantity: "1.250001", expectedLineVersion: 3, expectedBalanceVersion: 4, supplierLotCode: null });
  assert.throws(() => receiptLines([{ purchase_order_line_id: 9, quantity: "1", expected_line_version: 1 }]), /expected_balance_version/);
  assert.throws(() => expectedBalanceVersions([{ material_id: 1, expected_balance_version: 2 }, { material_id: 1, expected_balance_version: 2 }]), /不能重复物料/);
});

test("procurement permissions preserve management, warehouse and read-only separation", () => {
  for (const role of ["admin", "manager", "purchase"]) assert.ok(permissionsForRole(role).includes("procurement.order"));
  assert.ok(permissionsForRole("warehouse").includes("procurement.receive"));
  assert.ok(permissionsForRole("warehouse").includes("procurement.reverse"));
  assert.ok(!permissionsForRole("warehouse").includes("procurement.order"));
  assert.ok(permissionsForRole("engineering").includes("procurement.read"));
  assert.ok(!permissionsForRole("engineering").includes("procurement.order"));
  assert.ok(permissionsForRole("finance").includes("procurement.finance_source.read"));
  assert.ok(!permissionsForRole("finance").includes("procurement.receive"));
});
