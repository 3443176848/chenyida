import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { amount, date, documentType, id, text, version } from "../app/lib/finance-selfhost/rules.ts";
import { visibleFinanceTypes } from "../app/lib/finance-selfhost/service.ts";

test("finance permissions separate read, posting, settlement and reversal", () => {
  for (const permission of ["finance.read", "finance.post", "finance.pay", "finance.reverse"]) for (const role of ["admin", "manager", "finance"]) assert.ok(permissionsForRole(role).includes(permission));
  for (const role of ["purchase", "engineering", "production", "warehouse", "quality", "sales", "operations"]) { assert.ok(permissionsForRole(role).includes("finance.read")); assert.ok(!permissionsForRole(role).includes("finance.post")); }
  assert.deepEqual(visibleFinanceTypes({ role: "purchase" }), ["AP"]); assert.deepEqual(visibleFinanceTypes({ role: "sales" }), ["AR"]);
});
test("finance validation keeps ids, versions, dates and decimal strings exact", () => {
  assert.equal(documentType("ar"), "AR"); assert.equal(id("9", "id"), 9); assert.equal(version(1), 1); assert.equal(amount("999999999999999999.123456"), "999999999999999999.123456"); assert.equal(date("2026-07-25", "date"), "2026-07-25"); assert.equal(text(" 基本户 ", "account", 20, true), "基本户");
  for (const invalid of ["0", "-1", "1e2", "1.0000001"]) assert.throws(() => amount(invalid), /最多 6 位小数/); assert.throws(() => documentType("GL"), /AR 或 AP/); assert.throws(() => version(0), /正整数/); assert.throws(() => date("25/07/2026", "date"), /无效/);
});
