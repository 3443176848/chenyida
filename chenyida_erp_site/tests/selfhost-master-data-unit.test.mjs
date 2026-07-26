import assert from "node:assert/strict";
import test from "node:test";
import { mapMasterDataError, MasterDataError } from "../app/lib/master-data-selfhost/errors.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

test("master-data permissions are fixed by role on the server", () => {
  assert.ok(permissionsForRole("sales").includes("master.customer.manage"));
  assert.ok(!permissionsForRole("sales").includes("master.supplier.manage"));
  assert.ok(permissionsForRole("purchase").includes("master.supplier.manage"));
  assert.ok(permissionsForRole("purchase").includes("master.supplier_mapping.manage"));
  assert.ok(permissionsForRole("engineering").includes("master.product.manage"));
  assert.ok(permissionsForRole("engineering").includes("master.bom.manage"));
  for (const role of ["production", "warehouse", "quality", "finance", "operations"]) {
    assert.ok(permissionsForRole(role).includes("master.bom.read"));
    assert.ok(!permissionsForRole(role).some((permission) => permission.startsWith("master.") && permission.endsWith(".manage")));
  }
});

test("database errors map to stable safe master-data errors", () => {
  assert.deepEqual(mapMasterDataError(new MasterDataError("VERSION_CONFLICT", "版本冲突", 409)), new MasterDataError("VERSION_CONFLICT", "版本冲突", 409));
  assert.equal(mapMasterDataError({ code: "23505" }).code, "MASTER_DATA_CONFLICT");
  assert.equal(mapMasterDataError({ code: "23P01" }).status, 409);
  assert.equal(mapMasterDataError({ code: "23514" }).status, 422);
  const unknown = mapMasterDataError(new Error("select secret from customers"));
  assert.equal(unknown.code, "INTERNAL_ERROR"); assert.doesNotMatch(unknown.message, /select|customers/i);
});
