import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { enumValue, id, quantity, resultLines, version } from "../app/lib/quality-selfhost/rules.ts";

test("quality permissions separate inspection, disposition and finished-goods allocation", () => {
  for (const role of ["purchase", "engineering", "production", "warehouse", "sales", "finance", "operations"]) { assert.ok(permissionsForRole(role).includes("quality.read")); assert.ok(!permissionsForRole(role).includes("quality.inspect")); }
  for (const permission of ["quality.read", "quality.inspect", "quality.defect", "quality.close", "quality.finished_goods_allocation.read"]) assert.ok(permissionsForRole("quality").includes(permission));
  assert.ok(permissionsForRole("quality").includes("quality.disposition"));
  for (const permission of ["quality.reopen", "quality.finished_goods_allocation.create"]) assert.ok(!permissionsForRole("quality").includes(permission));
  for (const permission of ["quality.disposition", "quality.reopen"]) assert.ok(permissionsForRole("manager").includes(permission));
  for (const permission of ["quality.finished_goods_allocation.read", "quality.finished_goods_allocation.create", "quality.finished_goods_allocation.cancel"]) assert.ok(permissionsForRole("sales").includes(permission));
});

test("quality validation fixes exact enums, ids, versions and numeric scale", () => {
  assert.equal(enumValue("fqc", "inspection_type", ["IQC", "IPQC", "FQC"]), "FQC"); assert.equal(id("9", "id"), 9); assert.equal(version(1), 1); assert.equal(quantity("12.345678", "qty"), "12.345678"); assert.equal(quantity("0", "qty", false), "0");
  for (const invalid of ["-1", "1.0000001", "1e2"]) assert.throws(() => quantity(invalid, "qty"), /最多 6 位小数/);
  assert.throws(() => id(0, "id"), /正整数/); assert.throws(() => version(0), /正整数/); assert.throws(() => enumValue("OQC", "inspection_type", ["IQC", "IPQC", "FQC"]), /无效/);
});

test("inspection result lines are bounded and normalized", () => {
  assert.deepEqual(resultLines([{ characteristic: " 外观 ", result: "pass", measured_value: "OK" }]), [{ characteristic: "外观", result: "PASS", measuredValue: "OK", specification: "", remark: "" }]);
  assert.throws(() => resultLines([]), /1 到 100/); assert.throws(() => resultLines([{ characteristic: "", result: "PASS" }]), /不能为空/); assert.throws(() => resultLines([{ characteristic: "外观", result: "UNKNOWN" }]), /无效/);
});
