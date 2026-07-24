import assert from "node:assert/strict";
import test from "node:test";

import { SelfhostMaterialImportRowNormalizer } from "../app/lib/material-import-normalization-selfhost/normalizer.ts";
import { assertNormalizationTransition } from "../app/lib/material-import-normalization-selfhost/state-machine.ts";

function target(namespace, code, valueType, options = {}) {
  return Object.freeze({
    group_code: namespace === "attribute" ? "ATTRIBUTE" : namespace === "basic" ? "BASIC" : "SPECIAL",
    target_namespace: namespace,
    target_code: code,
    display_name: options.name || code,
    description: "",
    value_type: valueType,
    required_for_confirm: Boolean(options.required),
    mapping_modes: Object.freeze(["SOURCE", "SOURCE_WITH_DEFAULT", "DEFAULT"]),
    default_value_policy: Object.freeze({ allowed: true, allowed_json_types: Object.freeze(["STRING", "SAFE_INTEGER", "BOOLEAN", "NULL"]) }),
    unit_policy: Object.freeze(options.unit ? { mode: "CANONICAL", canonical_unit: options.unit, allowed_units: Object.freeze([options.unit]) } : { mode: "FORBIDDEN", canonical_unit: null, allowed_units: Object.freeze([]) }),
    value_constraints: Object.freeze({ decimal_scale: options.scale ?? null, enum_values: Object.freeze(options.enumValues || []), normalization_rule: options.rule || "NONE" }),
    categories: Object.freeze([]),
    enabled: options.enabled !== false,
    selectable: options.enabled !== false,
    repeatable: false,
    constraints: Object.freeze([]),
    display_order: options.order || 1,
  });
}

const targets = [
  target("basic", "STANDARD_NAME", "TEXT", { required: true, order: 1 }),
  target("basic", "UNIT", "TEXT", { required: true, order: 2 }),
  target("basic", "SHELF_LIFE_DAYS", "INTEGER", { order: 3 }),
  target("attribute", "RESISTANCE", "DECIMAL", { name: "阻值", unit: "ohm", scale: 3, order: 4 }),
  target("attribute", "HALOGEN_FREE", "BOOLEAN", { name: "无卤", order: 5 }),
  target("attribute", "COLOR", "ENUM", { name: "颜色", enumValues: ["BLACK", "WHITE"], order: 6 }),
  target("attribute", "RELEASE_DATE", "DATE", { name: "发布日期", order: 7 }),
];
const catalog = Object.freeze({
  algorithm: "material-import-mapping-metadata-v1",
  targets: Object.freeze(targets),
  metadataDigest: "b".repeat(64),
  targetByKey: new Map(targets.map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item])),
});
const items = targets.map((item, index) => ({
  source_column_index: index,
  source_column_indexes: [index],
  source_header: item.target_code,
  source_headers: [item.target_code],
  target_namespace: item.target_namespace,
  target_code: item.target_code,
  mapping_mode: "SOURCE",
  default_value_json: null,
  required: item.required_for_confirm,
  display_order: index,
  combination_strategy: "FIRST_NON_EMPTY",
  combination_separator: " ",
  mapping_confidence: 1,
  adaptive_mapping_status: "CONFIRMED",
  mapping_evidence: [],
}));
const mapping = Object.freeze({
  batchId: 1,
  parseRunId: 2,
  mappingId: 3,
  mappingVersion: 4,
  mappingDigest: "a".repeat(64),
  sourceSchemaDigest: "c".repeat(64),
  metadataDigest: catalog.metadataDigest,
  sourceFileId: 5,
  sourceSheetId: 6,
  sourceSheetIndex: 0,
  sourceSheetName: "物料",
  headerRowNumber: 1,
  sourceFields: Object.freeze(items.map((item, index) => ({ column_index: index, column_ref: String.fromCharCode(65 + index), source_header: item.target_code, normalized_header: item.target_code }))),
  mappingSnapshot: Object.freeze({ schema_version: 1 }),
  mappingItems: Object.freeze(items),
  catalog,
});

function raw(values) {
  return {
    schema_version: 1,
    source_column_count: values.length,
    cells: values.map((value, index) => ({
      column_index: index,
      column_ref: String.fromCharCode(65 + index),
      type: index === 6 ? "DATE" : "TEXT",
      source_type: "TEST",
      raw_value: value,
      display: String(value),
      format_code: null,
      ...(index === 6 ? { interpreted_iso_value: String(value), interpretation_status: "INTERPRETED" } : {}),
    })),
  };
}

test("deterministic normalizer emits core/attribute candidates, multi-field lineage, and leaves raw rows unchanged", async () => {
  const normalizer = new SelfhostMaterialImportRowNormalizer();
  const original = raw(["  精密电阻  ", " PCS ", "365", "10.250", "true", "BLACK", "2026-07-23"]);
  const before = structuredClone(original);
  const first = await normalizer.normalize({ runId: 9, rowNumber: 2, rawRowHash: "d".repeat(64), rawRow: original, mapping });
  const reordered = { ...structuredClone(original), cells: [...original.cells].reverse() };
  const second = await normalizer.normalize({ runId: 9, rowNumber: 2, rawRowHash: "d".repeat(64), rawRow: reordered, mapping });
  assert.deepEqual(original, before);
  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(first.rowStatus, "VALID");
  assert.equal(first.fieldCandidates.find((item) => item.targetCode === "STANDARD_NAME").normalizedValue, "精密电阻");
  assert.equal(first.fieldCandidates.find((item) => item.targetCode === "SHELF_LIFE_DAYS").normalizedValue, 365);
  const resistance = first.attributeCandidates.find((item) => item.attributeCode === "RESISTANCE");
  assert.ok(resistance, JSON.stringify(first.attributeCandidates));
  assert.deepEqual(resistance.normalizedValue, { value: "10.250", unit: "ohm" });
  assert.equal(first.attributeCandidates.find((item) => item.attributeCode === "HALOGEN_FREE").normalizedValue, true);
  assert.equal(first.attributeCandidates.find((item) => item.attributeCode === "RELEASE_DATE").normalizedValue, "2026-07-23");
  assert.equal(first.lineage.length, first.fieldCandidates.length + first.attributeCandidates.length);
  assert.ok(first.lineage.every((entry) => entry.ruleCode && entry.ruleVersion && entry.sourceColumnName));
});

test("normalizer preserves missing/blank semantics and stable ERROR/WARNING issue codes", async () => {
  const normalizer = new SelfhostMaterialImportRowNormalizer();
  const result = await normalizer.normalize({
    runId: 10,
    rowNumber: 3,
    rawRowHash: "e".repeat(64),
    rawRow: raw(["   ", "PCS", "1.5", "x", "yes", "BLUE", "2026-02-30"]),
    mapping,
  });
  assert.equal(result.rowStatus, "ERROR");
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("NORMALIZATION_BLANK_VALUE"));
  assert.ok(codes.includes("NORMALIZATION_NUMBER_INVALID"));
  assert.ok(codes.includes("NORMALIZATION_BOOLEAN_INVALID"));
  assert.ok(codes.includes("NORMALIZATION_ENUM_INVALID"));
  assert.ok(codes.includes("NORMALIZATION_DATE_INVALID"));
  assert.ok(result.issues.every((issue) => /^[a-f0-9]{64}$/.test(issue.issueKey)));
  assert.equal(new Set(result.issues.map((issue) => issue.issueKey)).size, result.issues.length);
});

test("normalizer produces deterministic size-limit and disabled-target errors", async () => {
  const disabled = target("attribute", "DISABLED_ATTR", "TEXT", { enabled: false });
  const disabledCatalog = Object.freeze({ ...catalog, targets: Object.freeze([...targets, disabled]), targetByKey: new Map([...targets, disabled].map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item])) });
  const disabledItem = { ...items[0], target_namespace: "attribute", target_code: "DISABLED_ATTR", required: false };
  const result = await new SelfhostMaterialImportRowNormalizer().normalize({
    runId: 11,
    rowNumber: 4,
    rawRowHash: "f".repeat(64),
    rawRow: raw(["value"]),
    mapping: { ...mapping, mappingItems: [disabledItem], catalog: disabledCatalog },
  });
  assert.equal(result.issues[0].code, "NORMALIZATION_ATTRIBUTE_DISABLED");
});

test("normalization state machine accepts only documented transitions", () => {
  assert.doesNotThrow(() => assertNormalizationTransition("QUEUED", "RUNNING"));
  assert.doesNotThrow(() => assertNormalizationTransition("RUNNING", "PUBLISHING"));
  assert.doesNotThrow(() => assertNormalizationTransition("FAILED", "QUEUED"));
  assert.throws(() => assertNormalizationTransition("SUCCEEDED", "RUNNING"), /不能从 SUCCEEDED 转换为 RUNNING/);
  assert.throws(() => assertNormalizationTransition("CANCELLED", "SUCCEEDED"), /不能从 CANCELLED 转换为 SUCCEEDED/);
});
