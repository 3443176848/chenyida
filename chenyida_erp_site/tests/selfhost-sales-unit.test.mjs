import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { currency, expectedBalanceVersions, salesLines, shipmentLines } from "../app/lib/sales-selfhost/rules.ts";

test("sales decimals, currency and stable-ID lines fail closed", () => {
  const line = salesLines([{ product_id: 1, product_version_id: 2, finished_material_id: 3, unit_id: 4, quantity: "999999999999999999.999999", unit_price: "1.250001" }])[0];
  assert.deepEqual(line, { productId: 1, productVersionId: 2, finishedMaterialId: 3, unitId: 4, quantity: "999999999999999999.999999", unitPrice: "1.250001", remark: "" });
  assert.equal(currency("cny"), "CNY");
  assert.throws(() => currency("USD"), /仅支持 CNY/);
  assert.throws(() => salesLines([{ product_id: 1, product_version_id: 2, finished_material_id: 3, unit_id: 4, quantity: "1", unit_price: "1" }, { product_id: 2, product_version_id: 3, finished_material_id: 3, unit_id: 4, quantity: "1", unit_price: "1" }]), /不能重复成品物料/);
});

test("shipment inputs require line and inventory concurrency versions", () => {
  assert.deepEqual(shipmentLines([{ sales_order_line_id: 9, quantity: "1.000001", expected_line_version: 2, expected_balance_version: 3 }])[0], { salesOrderLineId: 9, inventoryLotId: null, quantity: "1.000001", expectedLineVersion: 2, expectedBalanceVersion: 3, expectedLotVersion: null });
  assert.throws(() => shipmentLines([{ sales_order_line_id: 9, quantity: "1", expected_line_version: 2 }]), /expected_balance_version/);
  assert.throws(() => expectedBalanceVersions([{ material_id: 1, expected_balance_version: 2 }, { material_id: 1, expected_balance_version: 3 }]), /不能重复物料/);
});

test("sales permissions separate quotation, shipment and finance responsibilities", () => {
  for (const role of ["admin", "manager", "sales"]) { assert.ok(permissionsForRole(role).includes("sales.quote")); assert.ok(permissionsForRole(role).includes("sales.order")); }
  assert.ok(!permissionsForRole("sales").includes("sales.ship"));
  assert.ok(permissionsForRole("warehouse").includes("sales.ship")); assert.ok(permissionsForRole("warehouse").includes("sales.reverse")); assert.ok(!permissionsForRole("warehouse").includes("sales.quote"));
  assert.ok(permissionsForRole("production").includes("sales.read")); assert.ok(!permissionsForRole("production").includes("sales.order"));
  assert.ok(permissionsForRole("finance").includes("sales.finance_source.read")); assert.ok(!permissionsForRole("finance").includes("sales.ship"));
});
