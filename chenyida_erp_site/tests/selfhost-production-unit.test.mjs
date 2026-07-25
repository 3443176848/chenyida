import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { nonNegativeQuantity, quantity, requirementLines } from "../app/lib/production-selfhost/rules.ts";

test("production decimal and requirement inputs preserve six-place values and concurrency versions", () => {
  assert.equal(quantity("999999999999999999.999999", "quantity"), "999999999999999999.999999");
  assert.equal(nonNegativeQuantity("0", "scrap_qty"), "0");
  assert.throws(() => quantity("0", "quantity"), /正数/);
  assert.throws(() => quantity("1.0000001", "quantity"), /6 位小数/);
  const parsed = requirementLines([{ requirement_id: 7, quantity: "1.250001", expected_requirement_version: 2, expected_balance_version: 3 }]);
  assert.deepEqual(parsed[0], { requirementId: 7, quantity: "1.250001", expectedRequirementVersion: 2, expectedBalanceVersion: 3 });
  assert.throws(() => requirementLines([{ requirement_id: 7, quantity: "1", expected_requirement_version: 1, expected_balance_version: 0 }, { requirement_id: 7, quantity: "1", expected_requirement_version: 1, expected_balance_version: 0 }]), /不能重复物料需求/);
});

test("production permissions keep planning, inventory posting and reporting separated", () => {
  for (const role of ["admin", "manager"]) for (const permission of ["production.plan", "production.issue", "production.report", "production.complete", "production.close"]) assert.ok(permissionsForRole(role).includes(permission));
  assert.ok(permissionsForRole("production").includes("production.plan"));
  assert.ok(permissionsForRole("production").includes("production.report"));
  assert.ok(!permissionsForRole("production").includes("production.issue"));
  assert.ok(permissionsForRole("warehouse").includes("production.issue"));
  assert.ok(permissionsForRole("warehouse").includes("production.complete"));
  assert.ok(!permissionsForRole("warehouse").includes("production.plan"));
  for (const role of ["engineering", "quality", "purchase", "finance", "sales", "operations"]) { assert.ok(permissionsForRole(role).includes("production.read")); assert.ok(!permissionsForRole(role).includes("production.plan")); }
});
