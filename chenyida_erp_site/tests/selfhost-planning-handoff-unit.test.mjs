import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { canonicalDigest, optionalDate, resolutionInput } from "../app/lib/planning-handoff-selfhost/validation.ts";

test("planning is a formal separated role with the minimum handoff permissions", () => {
  const engineering = permissionsForRole("engineering");
  const planning = permissionsForRole("planning");
  for (const permission of ["planning.read", "planning.prepare", "planning.submit"]) assert.ok(engineering.includes(permission));
  for (const permission of ["planning.read", "planning.accept"]) assert.ok(planning.includes(permission));
  assert.ok(!planning.includes("planning.prepare"));
  assert.ok(!engineering.includes("planning.accept"));
  assert.ok(!permissionsForRole("production").includes("planning.accept"));
  for (const role of ["admin", "manager"]) for (const permission of ["planning.read", "planning.prepare", "planning.submit", "planning.accept"]) assert.ok(permissionsForRole(role).includes(permission));
});

test("resolution inputs require explicit stable identifiers and deterministic digests", () => {
  const input = { expected_version: 4, resolutions: [{ requirement_item_id: 8, product_id: 9, product_version_id: 10, bom_header_id: 11, bom_version_id: 12 }] };
  assert.deepEqual(resolutionInput(input), { expected: 4, rows: [{ requirementItemId: 8, productId: 9, productVersionId: 10, bomHeaderId: 11, bomVersionId: 12 }] });
  assert.equal(canonicalDigest({ b: 2, a: 1 }), canonicalDigest({ a: 1, b: 2 }));
  assert.match(canonicalDigest(input), /^[0-9a-f]{64}$/);
  assert.throws(() => resolutionInput({ expected_version: 4, resolutions: [] }), /1 至 200/);
  assert.throws(() => resolutionInput({ expected_version: 4, resolutions: [input.resolutions[0], input.resolutions[0]] }), /不能重复/);
  assert.throws(() => resolutionInput({ expected_version: 4, resolutions: [{ ...input.resolutions[0], product_id: "产品甲" }] }), /正整数/);
  assert.equal(optionalDate("2026-12-31"), "2026-12-31");
  assert.throws(() => optionalDate("2026-02-30"), /无效/);
});

test("planning API owns a bounded transactional boundary and excludes downstream planning", async () => {
  const handler = await readFile(new URL("../app/lib/planning-handoff-selfhost/handler.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../app/lib/planning-handoff-selfhost/service.ts", import.meta.url), "utf8");
  const repository = await readFile(new URL("../app/lib/planning-handoff-selfhost/repository.ts", import.meta.url), "utf8");
  for (const route of ["requirement-resolutions", "planning-packages", "planning-handoffs", "submit|accept|return"]) assert.match(handler, new RegExp(route));
  assert.match(handler, /256 \* 1024/); assert.match(handler, /requireCsrf/); assert.match(handler, /Idempotency-Key/); assert.match(handler, /X-Request-ID/);
  assert.match(service, /for update/); assert.match(service, /status='RELEASED'/); assert.match(service, /material_status='ACTIVE'/); assert.match(service, /round\(\$2::numeric\*bl\.quantity_per\*\(1\+bl\.loss_rate\),6\)/);
  assert.match(service, /package_digest/); assert.match(service, /RESUBMITTED/); assert.match(repository, /client\.query\("begin"\)/); assert.match(repository, /idempotency_keys/); assert.match(repository, /audit_log/);
  for (const forbidden of [/inventory_stock_balances/i, /material_requirement/i, /purchase_request/i, /purchase_orders/i, /supplier/i, /relative_path/i, /absolute_path/i, /file_body/i]) assert.doesNotMatch(service, forbidden);
});
