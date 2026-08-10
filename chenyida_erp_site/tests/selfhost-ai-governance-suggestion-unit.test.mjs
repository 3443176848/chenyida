import assert from "node:assert/strict";
import test from "node:test";

import { runLocalDeterministicSuggestion, deriveAiSuggestionInputDigests } from "../app/lib/ai-governance-suggestion-selfhost/adapter.ts";
import { canonicalDigest, canonicalJson } from "../app/lib/ai-governance-suggestion-selfhost/canonical.ts";
import { AiGovernanceSuggestionError } from "../app/lib/ai-governance-suggestion-selfhost/errors.ts";
import { AiGovernanceSuggestionService } from "../app/lib/ai-governance-suggestion-selfhost/service.ts";

function fixture(overrides = {}) {
  const sourceDigest = "a".repeat(64);
  const candidateDigest = "b".repeat(64);
  return {
    batch: { id: 1, created_by: "operator" },
    governanceRun: { id: 2, result_digest: "c".repeat(64), normalization_result_digest: "d".repeat(64) },
    group: {
      id: 3,
      group_key: "e".repeat(64),
      version: 1,
      decision_status: "PENDING",
      category: "RES",
      readiness: "READY",
      identity_digest: "f".repeat(64),
    },
    rows: [{
      id: 4,
      source_key: "SYNTHETIC-ROW-1",
      source_snapshot_digest: sourceDigest,
      original_supplier: "SYNTHETIC SUPPLIER",
      supplier_part_number: "SYN-PART-001",
    }],
    specs: [{
      id: 5,
      governance_row_id: 4,
      source_key: "SYNTHETIC-ROW-1",
      source_snapshot_digest: sourceDigest,
      component_code: "RESISTANCE",
      component_role: "IDENTITY",
      normalized_value: "10000",
      canonical_unit: "OHM",
    }],
    normalizationLineage: [],
    materialCandidates: [{
      id: 6,
      material_id: 7,
      candidate_kind: "EXACT_IDENTITY",
      candidate_rank: 1,
      candidate_digest: candidateDigest,
      material_version_snapshot: 2,
      material_status_snapshot: "ACTIVE",
      internal_material_code: "MAT-000001",
      material_status: "ACTIVE",
      version: 2,
    }],
    categories: [{ id: 8, category_code: "RES", status: "ACTIVE", version: 1 }],
    attributeDefinitions: [{
      id: 9,
      attribute_code: "RESISTANCE",
      data_type: "DECIMAL",
      decimal_scale: 0,
      canonical_unit: "OHM",
      allowed_values: [],
      status: "ACTIVE",
      version: 3,
    }],
    suppliers: [{ id: 10, supplier_code: "SUP-001", normalized_name: "SYNTHETIC SUPPLIER", status: "ACTIVE", version: 4 }],
    supplierMappings: [{
      mapping_id: 11,
      mapping_uid: "11111111-1111-4111-8111-111111111111",
      mapping_version_no: 2,
      mapping_row_version: 3,
      content_digest: "1".repeat(64),
      mapping_status: "ACTIVE",
      supplier_id: 10,
      supplier_item_code: "SYN-PART-001",
      material_id: 7,
      purchase_unit_id: 12,
      purchase_unit_code: "PCS",
      conversion_numerator: "1",
      conversion_denominator: "1",
      supplier_code: "SUP-001",
      supplier_status: "ACTIVE",
      supplier_version: 4,
      internal_material_code: "MAT-000001",
      material_status: "ACTIVE",
      version: 2,
      governance_material_candidate_id: 6,
      candidate_kind: "EXACT_IDENTITY",
      candidate_digest: candidateDigest,
      material_version_snapshot: 2,
    }],
    serverNow: new Date("2026-08-10T00:00:00.000Z"),
    ...overrides,
  };
}

test("canonical serialization is Unicode-normalized, key-stable, and rejects unsafe numbers", () => {
  assert.equal(canonicalJson({ z: "Ａ", a: [2, 1] }), canonicalJson({ a: [2, 1], z: "A" }));
  assert.equal(canonicalDigest({ b: true, a: null }), canonicalDigest({ a: null, b: true }));
  assert.throws(() => canonicalJson({ unsafe: 1.5 }), /AI_CANONICAL_NUMBER_INVALID/);
});

test("input digests ignore server time and remain stable across source array order", () => {
  const left = fixture();
  const right = fixture({
    serverNow: new Date("2030-01-01T00:00:00.000Z"),
    rows: [...left.rows].reverse(),
    specs: [...left.specs].reverse(),
  });
  assert.deepEqual(deriveAiSuggestionInputDigests(left, "ATTRIBUTE_EXTRACTION"), deriveAiSuggestionInputDigests(right, "ATTRIBUTE_EXTRACTION"));
});

test("LOCAL_DETERMINISTIC emits typed, evidenced candidates for all four capabilities", () => {
  for (const capability of ["CLASSIFICATION", "ATTRIBUTE_EXTRACTION", "MATERIAL_MATCH", "SUPPLIER_MAPPING"]) {
    const result = runLocalDeterministicSuggestion(fixture(), capability);
    assert.equal(result.disposition, "SUGGEST", capability);
    assert.ok(result.items.length >= 1, capability);
    assert.ok(result.items.every((item) => item.itemKind === capability && item.evidence.length >= 1));
    assert.ok(result.items.every((item) => item.evidence.every((entry) => /^[0-9a-f]{64}$/.test(entry.evidenceDigest))));
    if (capability === "SUPPLIER_MAPPING") assert.doesNotMatch(JSON.stringify(result), /SYN-PART-001/);
  }
});

test("unsafe ambiguity, lifecycle conflicts, and conversion failures abstain without formal action", () => {
  const ambiguous = runLocalDeterministicSuggestion(fixture({
    materialCandidates: [...fixture().materialCandidates, { ...fixture().materialCandidates[0], id: 66, material_id: 77, internal_material_code: "MAT-000002" }],
  }), "MATERIAL_MATCH");
  assert.equal(ambiguous.disposition, "ABSTAIN");
  assert.equal(ambiguous.items.length, 0);

  const inactive = runLocalDeterministicSuggestion(fixture({ categories: [{ id: 8, category_code: "RES", status: "INACTIVE", version: 2 }] }), "CLASSIFICATION");
  assert.equal(inactive.disposition, "ABSTAIN");

  const conversion = runLocalDeterministicSuggestion(fixture({
    specs: [{ ...fixture().specs[0], normalized_value: "not-a-number" }],
  }), "ATTRIBUTE_EXTRACTION");
  assert.equal(conversion.disposition, "ABSTAIN");
  assert.doesNotMatch(JSON.stringify(conversion), /approve|formalize|create_material|bind_existing/i);
});

test("service enforces permission, must-change-password, and exact create fields", async () => {
  let calls = 0;
  const repository = {
    async create() { calls += 1; return { data: {}, operationId: "op", replayed: false, replaySource: "NONE", statusCode: 201 }; },
    async list() { return { items: [], nextAfterUid: null }; },
    async one() { return {}; },
  };
  const service = new AiGovernanceSuggestionService(repository);
  const context = (permissions, mustChange = false) => ({
    actor: { username: "operator", permissions, must_change_password: mustChange },
    requestId: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: "abcdefgh",
    requestDigest: "2".repeat(64),
    routeScope: "scope",
  });
  await assert.rejects(service.create(1, 2, 3, context([]), { capability: "CLASSIFICATION", expected_group_version: 1 }), (error) => error instanceof AiGovernanceSuggestionError && error.code === "PERMISSION_DENIED");
  await assert.rejects(service.create(1, 2, 3, context(["material.import.governance.run"], true), { capability: "CLASSIFICATION", expected_group_version: 1 }), (error) => error instanceof AiGovernanceSuggestionError && error.code === "PASSWORD_CHANGE_REQUIRED");
  await assert.rejects(service.create(1, 2, 3, context(["material.import.governance.run"]), { capability: "CLASSIFICATION", expected_group_version: 1, item: {} }), (error) => error instanceof AiGovernanceSuggestionError && error.code === "REQUEST_FIELD_UNKNOWN");
  await service.create(1, 2, 3, context(["material.import.governance.run"]), { capability: "CLASSIFICATION", expected_group_version: 1 });
  assert.equal(calls, 1);
});
