import assert from "node:assert/strict";
import test from "node:test";

import { MaterialWorkflowError } from "../app/lib/material-selfhost/errors.ts";
import { assertReviewSeparation, buildInternalMaterialCode, transitionMaterialState } from "../app/lib/material-selfhost/state-machine.ts";
import { validateDraftPayload } from "../app/lib/material-selfhost/validation.ts";

const metadata = {
  categoryId: 4, categoryCode: "RES_CHIP", categoryName: "贴片电阻", categoryLevel: 4,
  definitions: [
    { definitionId: 10, attributeCode: "RESISTANCE", name: "阻值", dataType: "DECIMAL", decimalScale: 3, canonicalUnit: "ohm", allowedValues: [], normalizationRule: "DECIMAL_SCALE", required: true },
    { definitionId: 11, attributeCode: "HALOGEN_FREE", name: "无卤", dataType: "BOOLEAN", decimalScale: 0, canonicalUnit: "", allowedValues: [], normalizationRule: "NONE", required: false },
    { definitionId: 12, attributeCode: "COLOR", name: "颜色", dataType: "ENUM", decimalScale: 0, canonicalUnit: "", allowedValues: ["BLACK", "WHITE"], normalizationRule: "ENUM_CODE", required: false },
  ],
};

function payload(attributes = { RESISTANCE: { value: 10.25, unit: "ohm", source: "MANUAL", confidence: 1 } }) {
  return {
    category_id: 4,
    basic_fields: {
      standard_name: "10.25 欧姆贴片电阻", unit: "PCS", brand: "", manufacturer: "", manufacturer_part_number: "",
      procurement_type: "PURCHASE", inventory_type: "STOCKED", lot_control_required: false, shelf_life_days: null,
      inspection_type: "NORMAL", environmental_requirement: "ROHS", source_type: "MANUAL",
    },
    attributes,
  };
}

test("fixed material state machine accepts only approved transitions", () => {
  assert.equal(transitionMaterialState("DRAFT", "SUBMIT"), "PENDING_REVIEW");
  assert.equal(transitionMaterialState("PENDING_REVIEW", "APPROVE"), "ACTIVE");
  assert.equal(transitionMaterialState("PENDING_REVIEW", "REJECT"), "DRAFT");
  assert.throws(() => transitionMaterialState("ACTIVE", "SUBMIT"), (error) => error instanceof MaterialWorkflowError && error.status === 409);
});

test("review separation rejects creator and last editor", () => {
  assert.throws(() => assertReviewSeparation("creator", "creator", "editor"), (error) => error.code === "SELF_REVIEW_FORBIDDEN");
  assert.throws(() => assertReviewSeparation("editor", "creator", "editor"), (error) => error.code === "LAST_EDITOR_REVIEW_FORBIDDEN");
  assert.doesNotThrow(() => assertReviewSeparation("reviewer", "creator", "editor"));
});

test("formal codes are deterministic and bounded", () => {
  assert.equal(buildInternalMaterialCode("RES_CHIP", 1), "CYD-RES_CHIP-000001");
  assert.equal(buildInternalMaterialCode("CAP_CHIP", 999999), "CYD-CAP_CHIP-999999");
  assert.throws(() => buildInternalMaterialCode("bad", 1), (error) => error.code === "MATERIAL_CATEGORY_CODE_INVALID");
  assert.throws(() => buildInternalMaterialCode("RES_CHIP", 1_000_000), (error) => error.code === "MATERIAL_CODE_SEQUENCE_EXHAUSTED");
});

test("typed dynamic attributes are validated without string degradation", () => {
  const result = validateDraftPayload(payload({
    RESISTANCE: { value: 10.25, unit: "ohm", source: "MANUAL", confidence: 1 },
    HALOGEN_FREE: { value: true, source: "MANUAL", confidence: 1 },
    COLOR: { value: "BLACK", source: "MANUAL", confidence: 1 },
  }), metadata);
  assert.equal(result.attributes[0].value, 10.25);
  assert.equal(result.attributes[1].value, true);
  assert.equal(result.attributes[2].value, "BLACK");
  assert.equal(result.attributes[0].normalizedValue, "10.250");
});

test("required, unknown, type, enum and unit violations fail closed", () => {
  for (const [attributes, code] of [
    [{}, "MATERIAL_ATTRIBUTE_REQUIRED"],
    [{ RESISTANCE: { value: "10", unit: "ohm" } }, "MATERIAL_ATTRIBUTE_DECIMAL_INVALID"],
    [{ RESISTANCE: { value: 10, unit: "V" } }, "MATERIAL_ATTRIBUTE_UNIT_INVALID"],
    [{ RESISTANCE: { value: 10, unit: "ohm" }, UNKNOWN: { value: "x" } }, "MATERIAL_ATTRIBUTE_UNKNOWN"],
    [{ RESISTANCE: { value: 10, unit: "ohm" }, COLOR: { value: "GREEN" } }, "MATERIAL_ATTRIBUTE_ENUM_INVALID"],
  ]) {
    assert.throws(() => validateDraftPayload(payload(attributes), metadata), (error) => error instanceof MaterialWorkflowError && (error.code === code || error.details.some((issue) => issue.code === code)));
  }
});

test("clients cannot forge workflow identity or formal code fields", () => {
  assert.throws(() => validateDraftPayload({ ...payload(), internal_material_code: "CYD-RES_CHIP-000001" }, metadata), (error) => error.code === "REQUEST_VALIDATION_FAILED");
});
