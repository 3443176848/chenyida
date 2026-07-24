import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { formatQuantity, parseDatabaseQuantity, parseOperationInput, parseQuantityMicros, parseReversalVersions } from "../app/lib/inventory-selfhost/rules.ts";

test("inventory decimal rules preserve six-place precision without floating point", () => {
  assert.equal(parseQuantityMicros("999999999999999999.999999", "quantity", false), 999_999_999_999_999_999_999_999n);
  assert.equal(formatQuantity(-1_234_567n), "-1.234567");
  assert.equal(parseDatabaseQuantity("0.100001"), 100_001n);
  assert.throws(() => parseQuantityMicros("0.0000001", "quantity", false), /最多 6 位小数/);
  assert.throws(() => parseQuantityMicros("0", "quantity", false), /超出允许范围/);
});

test("inventory operation validation uses stable IDs and fail-closed V1 boundaries", () => {
  const parsed = parseOperationInput({ operation_type: "FREEZE", reason: "待检冻结", lines: [{ material_id: 9, unit_id: 3, quantity: "2.5", expected_balance_version: 4 }] });
  assert.equal(parsed.operationType, "FREEZE"); assert.equal(parsed.lines[0].materialId, 9); assert.equal(parsed.lines[0].quantityMicros, 2_500_000n);
  assert.throws(() => parseOperationInput({ operation_type: "ISSUE", reason: "出库", lines: [{ material_id: 9, unit_id: 3, quantity: "1", expected_balance_version: 1, location_code: "SECOND" }] }), /只支持 MAIN/);
  assert.throws(() => parseOperationInput({ operation_type: "ADJUSTMENT", reason: "盘点", lines: [{ material_id: 9, unit_id: 3, counted_qty: "1", expected_balance_version: 1 }, { material_id: 9, unit_id: 3, counted_qty: "2", expected_balance_version: 1 }] }), /不能重复物料/);
  const reversal = parseReversalVersions({ reason: "录入错误", expected_balance_versions: [{ material_id: 9, expected_balance_version: 6 }] });
  assert.equal(reversal.versions.get(9), 6);
});

test("inventory permissions separate read adjustment and reversal", () => {
  assert.ok(permissionsForRole("warehouse").includes("inventory.adjust"));
  assert.ok(permissionsForRole("warehouse").includes("inventory.reverse"));
  assert.ok(permissionsForRole("purchase").includes("inventory.read"));
  assert.ok(!permissionsForRole("purchase").includes("inventory.adjust"));
});
