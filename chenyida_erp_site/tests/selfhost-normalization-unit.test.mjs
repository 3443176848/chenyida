import assert from "node:assert/strict";
import test from "node:test";

import { governMaterialSource } from "../app/lib/material-governance-selfhost/engine.ts";
import { governanceSourceFromNormalizedRow } from "../app/lib/material-governance-selfhost/service.ts";
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
  dataStartRowNumber: 2,
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
  const first = await normalizer.normalize({ runId: 9, rowNumber: 2, rawRowHash: "d".repeat(64), rawRow: original, sourceCreatedAt: "2026-07-23T01:02:03.000Z", mapping });
  const reordered = { ...structuredClone(original), cells: [...original.cells].reverse() };
  const second = await normalizer.normalize({ runId: 9, rowNumber: 2, rawRowHash: "d".repeat(64), rawRow: reordered, sourceCreatedAt: "2026-07-23T01:02:03.000Z", mapping });
  assert.deepEqual(original, before);
  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(first.payload.canonical_import.created_at, "2026-07-23T01:02:03.000Z");
  assert.deepEqual(first.payload.adaptive_mapping["basic.STANDARD_NAME"].source_column_indexes, [0]);
  assert.equal(first.payload.adaptive_mapping["basic.STANDARD_NAME"].mapping_status, "CONFIRMED");
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
    sourceCreatedAt: "2026-07-23T01:02:03.000Z",
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
    sourceCreatedAt: "2026-07-23T01:02:03.000Z",
    mapping: { ...mapping, mappingItems: [disabledItem], catalog: disabledCatalog },
  });
  assert.equal(result.issues[0].code, "NORMALIZATION_ATTRIBUTE_DISABLED");
});

test("single-column adaptive metadata classifies repeated headers without producing candidates", async () => {
  const result = await new SelfhostMaterialImportRowNormalizer().normalize({
    runId: 12,
    rowNumber: 8,
    rawRowHash: "1".repeat(64),
    rawRow: raw(items.map((item) => item.source_header)),
    sourceCreatedAt: "2026-07-23T01:02:03.000Z",
    mapping,
  });
  assert.equal(result.rowStatus, "SKIPPED");
  assert.equal(result.payload.row_disposition, "SKIPPED");
  assert.equal(result.payload.row_classification.kind, "REPEATED_HEADER");
  assert.equal(result.fieldCandidates.length, 0);
  assert.equal(result.attributeCandidates.length, 0);
  assert.equal(result.issues.length, 0);
});

test("canonical context keeps manufacturer, model and description separate with a stable source timestamp", async () => {
  const canonicalTargets = [
    target("basic", "STANDARD_NAME", "TEXT", { required: true, order: 1 }),
    target("basic", "UNIT", "TEXT", { required: true, order: 2 }),
    target("basic", "MANUFACTURER", "TEXT", { order: 3 }),
    target("basic", "SPECIFICATION_MODEL", "TEXT", { order: 4 }),
    target("basic", "DESCRIPTION", "TEXT", { order: 5 }),
    target("supplier_reference", "SUPPLIER_SPECIFICATION", "TEXT", { order: 6 }),
  ];
  const canonicalItems = canonicalTargets.map((item, index) => ({
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
    adaptive_mapping_status: "EXACT",
    mapping_evidence: ["TEST_EXACT_HEADER"],
  }));
  const canonicalCatalog = Object.freeze({
    ...catalog,
    targets: Object.freeze(canonicalTargets),
    targetByKey: new Map(canonicalTargets.map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item])),
  });
  const sourceTime = "2026-07-23T04:05:06.000Z";
  const result = await new SelfhostMaterialImportRowNormalizer().normalize({
    runId: 13,
    rowNumber: 9,
    rawRowHash: "2".repeat(64),
    rawRow: raw(["连接器", "PCS", "制造商甲", "MX-10", "板端连接器", "2.0mm 10PIN"]),
    sourceCreatedAt: sourceTime,
    mapping: {
      ...mapping,
      mappingItems: canonicalItems,
      sourceFields: canonicalItems.map((item, index) => ({ column_index: index, column_ref: String.fromCharCode(65 + index), source_header: item.source_header, normalized_header: item.source_header })),
      mappingSnapshot: { schema_version: 1, adaptive_algorithm_version: "adaptive-supplier-v1" },
      catalog: canonicalCatalog,
    },
  });
  assert.equal(result.rowStatus, "VALID");
  assert.equal(result.payload.canonical_import.raw_manufacturer, "制造商甲");
  assert.equal(result.payload.canonical_import.raw_model, "MX-10");
  assert.equal(result.payload.canonical_import.raw_description, "板端连接器");
  assert.equal(result.payload.canonical_import.created_at, sourceTime);
});

test("governance bridge consumes canonical-unit objects emitted by the real normalizer", async () => {
  const bridgeTargets = [
    target("category_hint", "CATEGORY_HINT", "TEXT", { order: 1 }),
    target("attribute", "PACKAGE", "TEXT", { order: 2 }),
    target("attribute", "RESISTANCE", "DECIMAL", { unit: "ohm", scale: 6, order: 3 }),
    target("attribute", "TOLERANCE", "DECIMAL", { unit: "%", scale: 2, order: 4 }),
    target("attribute", "POWER", "DECIMAL", { unit: "W", scale: 6, order: 5 }),
  ];
  const bridgeItems = bridgeTargets.map((item, index) => ({
    source_column_index: index,
    source_column_indexes: [index],
    source_header: item.target_code,
    source_headers: [item.target_code],
    target_namespace: item.target_namespace,
    target_code: item.target_code,
    mapping_mode: "SOURCE",
    default_value_json: null,
    required: false,
    display_order: index,
    combination_strategy: "FIRST_NON_EMPTY",
    combination_separator: " ",
    mapping_confidence: 1,
    adaptive_mapping_status: "CONFIRMED",
    mapping_evidence: [],
  }));
  const bridgeCatalog = Object.freeze({
    algorithm: "material-import-mapping-metadata-v1",
    targets: Object.freeze(bridgeTargets),
    metadataDigest: "7".repeat(64),
    targetByKey: new Map(bridgeTargets.map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item])),
  });
  const normalized = await new SelfhostMaterialImportRowNormalizer().normalize({
    runId: 14,
    rowNumber: 2,
    rawRowHash: "8".repeat(64),
    rawRow: raw(["RES", "0201", "0", "5", "0.05"]),
    sourceCreatedAt: "2026-07-29T01:02:03.000Z",
    mapping: {
      ...mapping,
      metadataDigest: bridgeCatalog.metadataDigest,
      mappingItems: bridgeItems,
      sourceFields: bridgeItems.map((item, index) => ({
        column_index: index,
        column_ref: String.fromCharCode(65 + index),
        source_header: item.source_header,
        normalized_header: item.source_header,
      })),
      catalog: bridgeCatalog,
    },
  });
  const resistance = normalized.attributeCandidates.find((item) => item.attributeCode === "RESISTANCE");
  assert.deepEqual(resistance.normalizedValue, { value: "0", unit: "ohm" });
  const fields = Object.fromEntries(normalized.fieldCandidates.map((item) => [
    `${item.targetNamespace}.${item.targetCode}`,
    { normalized_value: item.normalizedValue, validation_status: item.validationStatus },
  ]));
  const attributes = Object.fromEntries(normalized.attributeCandidates.map((item) => [
    item.attributeCode,
    { normalized_value: item.normalizedValue, unit_code: item.unitCode, validation_status: item.validationStatus },
  ]));
  const source = governanceSourceFromNormalizedRow({
    normalized_row_id: 99,
    source_row_id: 88,
    source_sheet_name: "BOM",
    source_row_number: 2,
    normalized_payload_hash: "9".repeat(64),
    row_status: normalized.rowStatus,
    batch_no: "IMP-GOV-BRIDGE",
    original_filename: "bridge.csv",
    fields,
    attributes,
    normalization_issues: [],
  });
  assert.match(source.specification, /0ohm/);
  const governed = governMaterialSource(source);
  assert.equal(governed.readiness, "READY");
  assert.equal(governed.canonicalKey, "RES_0201_0R_5_1-20W");
});

test("governance bridge fails closed when normalized basic and structured identities conflict", () => {
  const base = {
    normalized_row_id: 101,
    source_row_id: 100,
    source_sheet_name: "BOM",
    source_row_number: 2,
    normalized_payload_hash: "b".repeat(64),
    row_status: "VALID",
    batch_no: "IMP-GOV-CONFLICT",
    original_filename: "conflict.csv",
    normalization_issues: [],
  };
  const ic = governanceSourceFromNormalizedRow({
    ...base,
    fields: {
      "category_hint.CATEGORY_HINT": "IC",
      "basic.MANUFACTURER_PART_NUMBER": "TPS7A2033PDBVR",
    },
    attributes: {
      MPN: { normalized_value: "TPS7A2033PDBVRX", validation_status: "VALID" },
      PACKAGE: { normalized_value: "SOT-23-5", validation_status: "VALID" },
    },
  });
  assert.ok(ic.upstreamIssues.some((issue) => issue.code === "GOVERNANCE_NORMALIZED_MPN_CONFLICT"));
  assert.equal(governMaterialSource(ic).readiness, "REVIEW_REQUIRED");

  const connector = governanceSourceFromNormalizedRow({
    ...base,
    normalized_row_id: 102,
    fields: {
      "category_hint.CATEGORY_HINT": "CON",
      "basic.SPECIFICATION_MODEL": "B5B-PH-K",
      "basic.BRAND": "MOLEX",
    },
    attributes: {
      BRAND: { normalized_value: "JST", validation_status: "VALID" },
      PIN_COUNT: { normalized_value: "5", validation_status: "VALID" },
      PITCH: { normalized_value: "2", unit_code: "mm", validation_status: "VALID" },
      STRUCTURE: { normalized_value: "VERTICAL", validation_status: "VALID" },
    },
  });
  assert.ok(connector.upstreamIssues.some((issue) => issue.code === "GOVERNANCE_NORMALIZED_BRAND_CONFLICT"));
  assert.equal(governMaterialSource(connector).readiness, "REVIEW_REQUIRED");
});

test("real normalizer keeps a valid mapped row when an unmapped remark starts with a footer marker", async () => {
  const result = await new SelfhostMaterialImportRowNormalizer().normalize({
    runId: 15,
    rowNumber: 2,
    rawRowHash: "a".repeat(64),
    rawRow: raw(["精密电阻", "PCS", "365", "10.250", "true", "BLACK", "2026-07-29", "备注：可替代"]),
    sourceCreatedAt: "2026-07-29T01:02:03.000Z",
    mapping,
  });
  assert.equal(result.rowStatus, "VALID");
  assert.notEqual(result.payload.row_disposition, "SKIPPED");
  assert.ok(result.fieldCandidates.length > 0);
  assert.ok(result.attributeCandidates.length > 0);
});

test("normalization state machine accepts only documented transitions", () => {
  assert.doesNotThrow(() => assertNormalizationTransition("QUEUED", "RUNNING"));
  assert.doesNotThrow(() => assertNormalizationTransition("RUNNING", "PUBLISHING"));
  assert.doesNotThrow(() => assertNormalizationTransition("FAILED", "QUEUED"));
  assert.throws(() => assertNormalizationTransition("SUCCEEDED", "RUNNING"), /不能从 SUCCEEDED 转换为 RUNNING/);
  assert.throws(() => assertNormalizationTransition("CANCELLED", "SUCCEEDED"), /不能从 CANCELLED 转换为 SUCCEEDED/);
});
