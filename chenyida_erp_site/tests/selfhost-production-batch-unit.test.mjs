import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { PRODUCTION_BATCH_BOUNDARY } from "../app/lib/production-batch-selfhost/service.ts";

test("Manufacturing Batch boundary exposes finished-goods Lot without widening raw-material scope", () => {
  assert.deepEqual(PRODUCTION_BATCH_BOUNDARY, {
    manufacturing_batch_genealogy: true,
    finished_goods_inventory_lot: true,
    raw_material_inventory_lot: false,
    supplier_inventory_lot: false,
    message: "成品 Manufacturing Batch 已绑定 Inventory Lot；原材料和供应商批次仍未启用。",
  });
});

test("Batch write and read permissions are role-trimmed", () => {
  for (const role of ["admin", "manager", "production"]) assert.ok(permissionsForRole(role).includes("production.batch.manage"), role);
  for (const role of ["quality", "warehouse", "engineering"]) {
    assert.ok(permissionsForRole(role).includes("production.batch.read"), role);
    assert.ok(!permissionsForRole(role).includes("production.batch.manage"), role);
  }
  for (const role of ["planning", "purchase", "sales", "finance"]) assert.ok(!permissionsForRole(role).includes("production.batch.manage"), role);
});

test("service sources bind NORMAL, REWORK, Report and Completion to stable Batch ids", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/lib/production-operation-selfhost/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/production-selfhost/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/production-batch-selfhost/service.ts", import.meta.url), "utf8"),
  ]);
  for (const token of ["production_batch_id", "sourceBatch", "PRODUCTION_BATCH_REQUIRED", "PRODUCTION_BATCH_MODE_CONFLICT"]) assert.match(files[0], new RegExp(token));
  for (const token of ["production_report_batches", "production_completion_batches", "PRODUCTION_REPORT_BATCH_MIXED", "PRODUCTION_COMPLETION_BATCH_MIXED"]) assert.match(files[1], new RegExp(token));
  for (const token of ["canonical_digest", "normal_runs", "rework_runs", "inventory_links", "lot_code"]) assert.match(files[2], new RegExp(token));
});
