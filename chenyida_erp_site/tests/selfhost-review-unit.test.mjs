import assert from "node:assert/strict";
import test from "node:test";

import { assertReviewEditable, assertReviewTransition } from "../app/lib/material-import-review-selfhost/state-machine.ts";
import {
  buildEffectiveValues,
  canonicalReviewJson,
  effectiveValue,
  reviewDigest,
  validateAttributeOverride,
  validateCoreOverride,
} from "../app/lib/material-import-review-selfhost/values.ts";
import { validateDraftPayload } from "../app/lib/material-selfhost/validation.ts";

test("effective values preserve candidate and distinguish SET, CLEAR and REVERT", () => {
  assert.equal(effectiveValue("candidate", null), "candidate");
  assert.equal(effectiveValue("candidate", { value_semantics: "SET", override_value: "human" }), "human");
  assert.equal(effectiveValue("candidate", { value_semantics: "CLEAR", override_value: null }), null);
  assert.equal(effectiveValue("candidate", { value_semantics: "REVERT", override_value: null }), "candidate");
});

test("effective aggregate never falls back to raw and does not mutate candidate inputs", () => {
  const candidates = [{ target_code: "STANDARD_NAME", normalized_value: "规范名", raw_value: "原始名" }];
  const before = structuredClone(candidates);
  const result = buildEffectiveValues({
    fieldCandidates: candidates,
    attributeCandidates: [{ attribute_code: "RESISTANCE", data_type: "DECIMAL", normalized_value: { value: "10.250", unit: "ohm" }, unit_code: "ohm" }],
    fieldOverrides: [{ target_field_code: "STANDARD_NAME", value_semantics: "CLEAR", override_value: null }],
    attributeOverrides: [],
  });
  assert.equal(result.fields.STANDARD_NAME, null);
  assert.deepEqual(result.attributes.RESISTANCE, { value: 10.25, unit: "ohm" });
  assert.deepEqual(candidates, before);
});

test("canonical digest is deterministic across object key order", () => {
  assert.equal(canonicalReviewJson({ z: 1, a: { y: 2, x: 3 } }), canonicalReviewJson({ a: { x: 3, y: 2 }, z: 1 }));
  assert.equal(reviewDigest({ z: 1, a: 2 }), reviewDigest({ a: 2, z: 1 }));
  assert.match(reviewDigest({ a: 1 }), /^[a-f0-9]{64}$/);
});

test("core override validates unknown, required, string, integer, boolean and enum fields", () => {
  assert.equal(validateCoreOverride("STANDARD_NAME", "SET", "电阻"), "电阻");
  assert.equal(validateCoreOverride("SHELF_LIFE_DAYS", "SET", 30), 30);
  assert.equal(validateCoreOverride("LOT_CONTROL", "SET", true), true);
  assert.equal(validateCoreOverride("PURCHASE_TYPE", "SET", "PURCHASE"), "PURCHASE");
  assert.throws(() => validateCoreOverride("UNKNOWN", "SET", "x"), /未知复核字段/);
  assert.throws(() => validateCoreOverride("STANDARD_NAME", "CLEAR", null), /不能清空/);
  assert.throws(() => validateCoreOverride("SHELF_LIFE_DAYS", "SET", 1.5), /安全整数/);
  assert.throws(() => validateCoreOverride("LOT_CONTROL", "SET", "true"), /布尔值/);
  assert.throws(() => validateCoreOverride("PURCHASE_TYPE", "SET", "AUTO"), /枚举值/);
  assert.throws(() => validateCoreOverride("BRAND", "SET", "x".repeat(201)), /文本格式或长度无效/);
});

test("attribute override validates decimal, date, enum, disabled and category compatibility", () => {
  const base = { code: "ATTR", name: "属性", required: false, enabled: true, maximumLength: 100, categoryIds: [4], unitCode: null };
  assert.equal(validateAttributeOverride({ ...base, dataType: "DECIMAL" }, 4, "SET", "10.25"), 10.25);
  assert.equal(validateAttributeOverride({ ...base, dataType: "DATE" }, 4, "SET", "2026-07-24"), "2026-07-24");
  assert.equal(validateAttributeOverride({ ...base, dataType: "ENUM", enumValues: ["A", "B"] }, 4, "SET", "A"), "A");
  assert.throws(() => validateAttributeOverride({ ...base, dataType: "DATE" }, 4, "SET", "2026-02-30"), /日期无效/);
  assert.throws(() => validateAttributeOverride({ ...base, dataType: "ENUM", enumValues: ["A"] }, 4, "SET", "B"), /枚举值无效/);
  assert.throws(() => validateAttributeOverride({ ...base, dataType: "TEXT", enabled: false }, 4, "SET", "x"), /停用/);
  assert.throws(() => validateAttributeOverride({ ...base, dataType: "TEXT" }, 5, "SET", "x"), /不允许/);
  assert.throws(() => validateAttributeOverride({ ...base, dataType: "TEXT", required: true }, 4, "CLEAR", null), /必填属性/);
});

test("review state machine permits documented transitions and locks terminal sessions", () => {
  assert.doesNotThrow(() => assertReviewTransition("DRAFT", "IN_REVIEW"));
  assert.doesNotThrow(() => assertReviewTransition("IN_REVIEW", "READY_TO_FINALIZE"));
  assert.doesNotThrow(() => assertReviewTransition("READY_TO_FINALIZE", "FINALIZING"));
  assert.doesNotThrow(() => assertReviewTransition("FINALIZING", "FINALIZED"));
  assert.doesNotThrow(() => assertReviewTransition("FINALIZE_FAILED", "FINALIZING"));
  assert.throws(() => assertReviewTransition("FINALIZED", "IN_REVIEW"), /不能从 FINALIZED/);
  assert.throws(() => assertReviewEditable("FINALIZED"), /创建新复核版本/);
});

test("Material Service validates DATE attributes while keeping DRAFT boundary", () => {
  const metadata = {
    categoryId: 4, categoryCode: "TEST", categoryName: "测试", categoryLevel: 4,
    definitions: [{ definitionId: 9, attributeCode: "RELEASE_DATE", name: "发布日期", dataType: "DATE", decimalScale: 0, canonicalUnit: "", allowedValues: [], normalizationRule: "NONE", required: true }],
  };
  const payload = {
    category_id: 4,
    basic_fields: {
      standard_name: "测试物料", unit: "PCS", brand: "", manufacturer: "", manufacturer_part_number: "",
      procurement_type: "PURCHASE", inventory_type: "STOCKED", lot_control_required: false, shelf_life_days: null,
      inspection_type: "NORMAL", environmental_requirement: "UNSPECIFIED", source_type: "MANUAL",
    },
    attributes: { RELEASE_DATE: { value: "2026-07-24", unit: "", source: "MANUAL", confidence: 1 } },
  };
  assert.equal(validateDraftPayload(payload, metadata).attributes[0].normalizedValue, "2026-07-24");
  assert.throws(() => validateDraftPayload({ ...payload, attributes: { RELEASE_DATE: { value: "2026-02-30", unit: "", source: "MANUAL", confidence: 1 } } }, metadata), /物料属性校验失败/);
});
