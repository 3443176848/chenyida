import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { canonicalDigest, decimal, requirementInput, safeDocumentInput } from "../app/lib/project-selfhost/validation.ts";

test("project requirements normalize bounded relational inputs and stable digests", () => {
  const input = { project_name: " 新项目 ", project_goal: "验证客户目标", target_delivery_date: "2026-09-30", customer_requirement_summary: "首版需求", quantity_requirement: "10.500000", quantity_unit: "套", delivery_requirement: "分批交付", commercial_terms: "含税", technical_requirements: "符合图纸", items: [{ provisional_name: "控制板", quantity: "10", unit_pending: true, specification_requirement: "双层" }] };
  const first = requirementInput(input); const reordered = requirementInput(Object.fromEntries(Object.entries(input).reverse()));
  assert.equal(first.projectName, "新项目"); assert.equal(first.items[0].unitId, null); assert.equal(first.contentDigest, reordered.contentDigest); assert.match(first.contentDigest, /^[0-9a-f]{64}$/);
  assert.equal(canonicalDigest({ b: 2, a: 1 }), canonicalDigest({ a: 1, b: 2 }));
  assert.equal(decimal("999999999999999999.999999", "quantity"), "999999999999999999.999999");
  assert.throws(() => requirementInput({ ...input, items: [] }), /1 到 100/);
  assert.throws(() => requirementInput({ ...input, items: [{ provisional_name: "x", quantity: "0", unit_pending: true }] }), /正数/);
  assert.throws(() => requirementInput({ ...input, items: [{ provisional_name: "x", quantity: "1", unit_pending: false }] }), /unit_id/);
});

test("document inputs accept only controlled file IDs and enumerated metadata", () => {
  assert.deepEqual(safeDocumentInput({ file_id: 9, document_type: "drawing", display_name: "客户图纸", expected_version: 3 }), { fileId: 9, documentType: "DRAWING", displayName: "客户图纸", expectedVersion: 3 });
  assert.throws(() => safeDocumentInput({ file_id: "/tmp/a.pdf", document_type: "DRAWING", display_name: "x", expected_version: 1 }), /file_id/);
  assert.throws(() => safeDocumentInput({ file_id: 1, document_type: "DRAWING", display_name: "x", expected_version: 1, relative_path: "/srv/private.pdf" }), /未知字段/);
  assert.throws(() => safeDocumentInput({ file_id: 1, document_type: "RAW_BODY", display_name: "x", expected_version: 1 }), /document_type/);
});

test("sales and engineering permissions form a strict market-project separation", () => {
  const sales = permissionsForRole("sales"); const engineering = permissionsForRole("engineering");
  for (const permission of ["project.read", "project.market.create", "project.market.edit", "project.market.submit"]) assert.ok(sales.includes(permission));
  for (const permission of ["project.engineering.read", "project.engineering.accept", "project.engineering.return"]) assert.ok(engineering.includes(permission));
  assert.ok(!sales.includes("project.engineering.accept")); assert.ok(!engineering.includes("project.market.create"));
  assert.ok(permissionsForRole("manager").includes("project.read_all"));
});

test("project API delegates state changes and never embeds SQL or storage paths", async () => {
  const handler = await readFile(new URL("../app/lib/project-selfhost/handler.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../app/lib/project-selfhost/service.ts", import.meta.url), "utf8");
  for (const route of ["/api/projects", "/api/project-handoffs", "submit|accept|return", "documents"]) assert.match(handler, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(handler, /requireCsrf/); assert.match(handler, /Idempotency-Key/); assert.match(handler, /X-Request-ID/); assert.match(handler, /page_size/);
  assert.doesNotMatch(handler, /insert into|update business_projects|relative_path|stack/i);
  assert.match(service, /PROJECT_IMMUTABLE_AFTER_SUBMIT/); assert.match(service, /HANDOFF_SELF_ACCEPT_FORBIDDEN/); assert.match(service, /for update/); assert.match(service, /project_handoff_events/);
  assert.match(service, /project_requirement_unit_resolution_versions/); assert.match(service, /REQUIREMENT_DECLARED/); assert.match(service, /project_requirement_unit_resolution_heads/);
  assert.match(service, /select id from units where id=any\(\$1::bigint\[\]\) and enabled=true order by id for update/);
  assert.doesNotMatch(service, /relative_path|absolute_path|file_body/i);
});
