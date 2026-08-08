import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { mappingIncompleteMessage } from "../app/lib/supplier-mapping-selfhost/coverage.ts";
import { boundedExactText, canonicalDigest, mappingUid, parseDraftInput, positiveId } from "../app/lib/supplier-mapping-selfhost/validation.ts";
import { buildCreateRfqDraftRequest } from "../app/procurement/sourcing/create-rfq-draft-request.ts";

test("the exact role matrix separates purchase authorship from operations review", () => {
  const purchase = permissionsForRole("purchase");
  const operations = permissionsForRole("operations");
  const engineering = permissionsForRole("engineering");
  for (const permission of ["supplier_mapping.read", "supplier_mapping.create", "supplier_mapping.edit_draft", "supplier_mapping.submit"]) {
    assert.ok(purchase.includes(permission), permission);
  }
  for (const permission of ["supplier_mapping.review_queue", "supplier_mapping.approve", "supplier_mapping.reject", "master.supplier_mapping.manage"]) {
    assert.ok(!purchase.includes(permission), permission);
  }
  for (const permission of ["supplier_mapping.read", "supplier_mapping.review_queue", "supplier_mapping.approve", "supplier_mapping.reject"]) {
    assert.ok(operations.includes(permission), permission);
  }
  for (const permission of ["supplier_mapping.create", "supplier_mapping.edit_draft", "supplier_mapping.submit"]) {
    assert.ok(!operations.includes(permission), permission);
  }
  assert.ok(engineering.includes("supplier_mapping.read"));
  assert.ok(!engineering.some((permission) => permission.startsWith("supplier_mapping.") && permission !== "supplier_mapping.read"));
  for (const role of ["admin", "manager"]) {
    const permissions = permissionsForRole(role);
    for (const permission of ["supplier_mapping.create", "supplier_mapping.submit", "supplier_mapping.approve", "supplier_mapping.reject"]) {
      assert.ok(permissions.includes("*") || permissions.includes(permission), `${role}:${permission}`);
    }
  }
});

test("draft validation uses stable IDs, controlled rational precision and Shanghai date-only boundaries", () => {
  const parsed = parseDraftInput({
    supplier_id: "12", material_id: 34, supplier_item_code: "  ab   01  ", supplier_item_name: "供应商名称",
    supplier_specification: "规格", manufacturer: "制造商", mpn: "MPN", revision: "A", purchase_unit_id: "56",
    conversion_numerator: 200, conversion_denominator: 100, valid_from: "2026-08-04", valid_to: "2026-12-31",
  });
  assert.deepEqual({
    supplierId: parsed.supplierId, materialId: parsed.materialId, normalized: parsed.normalizedSupplierItemCode,
    numerator: parsed.conversionNumerator, denominator: parsed.conversionDenominator, validFrom: parsed.validFrom, validTo: parsed.validTo,
  }, { supplierId: 12, materialId: 34, normalized: "AB 01", numerator: 2, denominator: 1, validFrom: "2026-08-04", validTo: "2026-12-31" });
  assert.throws(() => parseDraftInput({ ...Object.fromEntries(Object.entries({
    supplier_id: 12, material_id: 34, supplier_item_code: "AB", supplier_item_name: "", supplier_specification: "",
    manufacturer: "", mpn: "", revision: "", purchase_unit_id: 56, conversion_numerator: 1,
    conversion_denominator: 1, valid_from: "2026-08-04", valid_to: "2026-08-04",
  })), unexpected: true }), /不支持的字段/);
  assert.throws(() => parseDraftInput({
    supplier_id: 12, material_id: 34, supplier_item_code: "AB", supplier_item_name: "", supplier_specification: "",
    manufacturer: "", mpn: "", revision: "", purchase_unit_id: 56, conversion_numerator: 1,
    conversion_denominator: 1, valid_from: "2026-02-30", valid_to: "",
  }), /有效的 YYYY-MM-DD/);
  for (const value of [undefined, null, "", 0, -1, 1.5, "1.0", "1e0", true, { id: 1 }]) {
    assert.throws(() => positiveId(value, "supplier_id"), /正整数/);
  }
  assert.equal(mappingUid("123E4567-E89B-42D3-A456-426614174000"), "123e4567-e89b-42d3-a456-426614174000");
  assert.throws(() => mappingUid("Mapping 1"), /稳定 UUID/);
  assert.equal(boundedExactText(" UAT审核通过：1:1。 ", "审核意见", 500, true), "UAT审核通过：1:1。");
});

test("canonical request digests and Chinese missing-combination errors are deterministic and scoped", () => {
  assert.equal(canonicalDigest({ b: 2, a: { y: 2, x: 1 } }), canonicalDigest({ a: { x: 1, y: 2 }, b: 2 }));
  const message = mappingIncompleteMessage({
    supplier_id: 1, supplier_code: "SUP-000001", supplier_name: "供应商一", supplier_status: "ACTIVE",
    covered_count: 2, required_count: 4, selectable: false, unavailable_reason: "缺失", mapping_snapshots: [],
    missing: [
      { material_id: 533, internal_material_code: "CYD-RB_PCB-000016", standard_name: "PCB", unit_id: 1, unit_code: "PCS" },
      { material_id: 534, internal_material_code: "CYD-RB_SENSOR-000003", standard_name: "Sensor", unit_id: 1, unit_code: "PCS" },
    ],
  });
  assert.equal(message, "Supplier 1 / SUP-000001 缺少：\n- Material 533 / CYD-RB_PCB-000016\n- Material 534 / CYD-RB_SENSOR-000003");
  assert.doesNotMatch(message, /供应商一|价格|MPN/);
});

test("RFQ request builder refuses disabled coverage rows even when a forged checkbox value is submitted", () => {
  const requests = [{ id: 1, version: 3 }];
  const suppliers = [{ id: 1, selectable: false }, { id: 2, selectable: true }];
  assert.throws(() => buildCreateRfqDraftRequest(requests, suppliers, {
    purchaseRequestId: "1", supplierIds: ["1"], responseDeadline: "2026-12-01",
  }), /供应商已失效/);
  assert.deepEqual(buildCreateRfqDraftRequest(requests, suppliers, {
    purchaseRequestId: "1", supplierIds: ["2"], responseDeadline: "2026-12-01",
  }), { purchase_request_id: 1, supplier_ids: [2], response_deadline: "2026-12-01", expected_version: 3 });
});

test("RFQ creation shares authoritative current coverage while fixed bindings prevent downstream dynamic rematching", async () => {
  const coverage = await readFile(new URL("../app/lib/supplier-mapping-selfhost/coverage.ts", import.meta.url), "utf8");
  const mappingService = await readFile(new URL("../app/lib/supplier-mapping-selfhost/service.ts", import.meta.url), "utf8");
  const sourcing = await readFile(new URL("../app/lib/procurement-sourcing-selfhost/service.ts", import.meta.url), "utf8");
  const legacyHandler = await readFile(new URL("../app/lib/master-data-selfhost/handler.ts", import.meta.url), "utf8");
  const legacyService = await readFile(new URL("../app/lib/master-data-selfhost/service.ts", import.meta.url), "utf8");
  for (const predicate of [
    "sm.status='ACTIVE'", "sm.conversion_numerator=sm.conversion_denominator", "sm.valid_from<=statement_timestamp()",
    "sm.valid_to is null or sm.valid_to>statement_timestamp()", "mapping_match.mapping_count=1",
  ]) assert.match(coverage, new RegExp(predicate.replace(/[()]/g, "\\$&")));
  assert.match(coverage, /m\.base_unit_id is null[\s\S]*upper\(u\.code\)=upper\(btrim\(m\.base_uom\)\)/);
  assert.match(mappingService, /coalesce\(m\.base_unit_id,u\.id\) base_unit_id/);
  assert.match(mappingService, /m\.base_unit_id is null[\s\S]*upper\(u\.code\)=upper\(btrim\(m\.base_uom\)\)/);
  assert.match(sourcing, /loadSupplierMappingCoverage\(client, requestId, suppliers\)/);
  assert.doesNotMatch(sourcing, /loadSupplierMappingCoverage\(client, Number\(rfq\.purchase_request_id\), supplierIds\)/);
  assert.match(sourcing, /procurement_rfq_supplier_line_mapping_bindings/);
  assert.match(sourcing, /requireRfqCoverage\(coverage, suppliers\)/);
  assert.match(legacyHandler, /SUPPLIER_MAPPING_GOVERNANCE_REQUIRED/);
  assert.doesNotMatch(legacyService, /createMapping|setMappingStatus/);
});

test("approval comments use the existing immutable event fact while rejection reasons remain row-scoped", async () => {
  const service = await readFile(new URL("../app/lib/supplier-mapping-selfhost/service.ts", import.meta.url), "utf8");
  const handler = await readFile(new URL("../app/lib/supplier-mapping-selfhost/handler.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(service, /decision === "APPROVE" \? \["expected_version", "review_comment"\]/);
  assert.match(service, /boundedExactText\(input\.review_comment, "审核意见", 500, true\)/);
  assert.match(service, /const storedReviewReason = decision === "REJECT" \? reason : ""/);
  assert.match(service, /supplier_mapping_events[\s\S]*actor,reason,request_id/);
  assert.match(service, /review_comment_display: input\.reviewComment \|\| "历史批准未采集审核意见"/);
  assert.match(schema, /supplierMappingEvents[\s\S]*reason: text\("reason"\)/);
  assert.match(handler, /if \(request\.method !== "GET"\)[\s\S]*failureAudit/);
  assert.doesNotMatch(service, /safeDetail:\s*\{[^}]*review_comment/);
});
