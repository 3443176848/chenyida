import assert from "node:assert/strict";
import test from "node:test";

import { governMaterialSource } from "../app/lib/material-governance-selfhost/engine.ts";
import {
  draftSource,
  materialSource,
  validatedDraftSource,
} from "../app/lib/material-governance-selfhost/source-adapter.ts";

const capAttributes = [
  { code: "PACKAGE", value: "0201", unit: "" },
  { code: "CAPACITANCE", value: "0.000000000100000000", unit: "F" },
  { code: "RATED_VOLTAGE", value: "6.300000", unit: "V" },
  { code: "DIELECTRIC", value: "X5R", unit: "" },
  { code: "TOLERANCE", value: "10.00", unit: "%" },
];

function draftAttributes(attributes) {
  return Object.fromEntries(attributes.map((attribute) => [attribute.code, {
    value: attribute.value,
    unit: attribute.unit,
    source: "MANUAL",
    confidence: 1,
  }]));
}

function normalizedAttributes(attributes) {
  return attributes.map((attribute, index) => ({
    definitionId: index + 1,
    attributeCode: attribute.code,
    name: attribute.code,
    dataType: attribute.code === "PACKAGE" || attribute.code === "DIELECTRIC" || attribute.code === "BRAND" || attribute.code === "MODEL" || attribute.code === "MPN" || attribute.code === "STRUCTURE" ? "TEXT" : "DECIMAL",
    value: attribute.value,
    normalizedValue: attribute.value,
    unitCode: attribute.unit,
    sourceType: "MANUAL",
  }));
}

function basicFields(name, overrides = {}) {
  return {
    standard_name: name,
    unit: "PCS",
    brand: "",
    manufacturer: "",
    manufacturer_part_number: "",
    procurement_type: "PURCHASE",
    inventory_type: "STOCKED",
    lot_control_required: false,
    shelf_life_days: null,
    inspection_type: "NORMAL",
    environmental_requirement: "ROHS",
    source_type: "MANUAL",
    source_ref: "adapter-unit-test",
    ...overrides,
  };
}

function adapterCases(categoryCode, name, attributes, basicOverrides = {}) {
  return [
    {
      adapter: "materialSource",
      source: materialSource({
        id: 101,
        category_code: categoryCode,
        standard_name: name,
        brand: basicOverrides.brand ?? "",
        manufacturer: basicOverrides.manufacturer ?? "",
        manufacturer_part_number: basicOverrides.manufacturer_part_number ?? "",
        attributes,
      }),
    },
    {
      adapter: "draftSource",
      source: draftSource({
        category_id: 1,
        basic_fields: basicFields(name, basicOverrides),
        attributes: draftAttributes(attributes),
      }, categoryCode),
    },
    {
      adapter: "validatedDraftSource",
      source: validatedDraftSource({
        categoryId: 1,
        categoryCode,
        categoryName: categoryCode,
        basic: basicFields(name, basicOverrides),
        attributes: normalizedAttributes(attributes),
        issues: [],
      }, 101),
    },
  ];
}

test("formal master-data adapters never use standard_name as identity evidence", () => {
  const harmlessName = "贴片电容";
  const conflictingName = "0402 1uF 16V X7R ±20% 贴片电容";
  const base = adapterCases("CAP_CHIP", harmlessName, capAttributes);
  const renamed = adapterCases("CAP_CHIP", conflictingName, capAttributes);
  for (let index = 0; index < base.length; index += 1) {
    const left = base[index];
    const right = renamed[index];
    assert.equal(left.adapter, right.adapter);
    assert.ok(left.source, left.adapter);
    assert.ok(right.source, right.adapter);
    assert.equal(Object.hasOwn(left.source, "materialName"), false, left.adapter);
    assert.equal(Object.hasOwn(right.source, "materialName"), false, right.adapter);
    const governedLeft = governMaterialSource(left.source);
    const governedRight = governMaterialSource(right.source);
    assert.equal(governedLeft.readiness, "READY", left.adapter);
    assert.equal(governedRight.readiness, "READY", right.adapter);
    assert.equal(governedLeft.identityDigest, governedRight.identityDigest, left.adapter);
  }

  const incomplete = capAttributes.filter((attribute) => ["PACKAGE", "CAPACITANCE"].includes(attribute.code));
  for (const item of adapterCases("CAP_CHIP", "0201 100pF 6.3V X5R ±10% 贴片电容", incomplete)) {
    assert.ok(item.source, item.adapter);
    const governed = governMaterialSource(item.source);
    assert.equal(governed.readiness, "REVIEW_REQUIRED", item.adapter);
    assert.equal(governed.identityDigest, null, item.adapter);
    assert.ok(governed.issues.some((issue) => issue.code === "GOVERNANCE_VOLTAGE_MISSING"), item.adapter);
    assert.ok(governed.issues.some((issue) => issue.code === "GOVERNANCE_DIELECTRIC_MISSING"), item.adapter);
    assert.ok(governed.issues.some((issue) => issue.code === "GOVERNANCE_TOLERANCE_MISSING"), item.adapter);
  }
});

test("formal master-data adapters reconcile structured brands and fail closed on conflicts", () => {
  const connectorAttributes = [
    { code: "MODEL", value: "MX-5P-20", unit: "" },
    { code: "BRAND", value: "Ｍｏｌｅｘ", unit: "" },
    { code: "PIN_COUNT", value: "5", unit: "" },
    { code: "PITCH", value: "2.000000", unit: "mm" },
    { code: "STRUCTURE", value: "VERTICAL", unit: "" },
  ];
  for (const item of adapterCases("CONN_BOARD_STD", "连接器", connectorAttributes, { brand: "  Molex  " })) {
    assert.ok(item.source, item.adapter);
    const governed = governMaterialSource(item.source);
    assert.equal(governed.readiness, "READY", item.adapter);
    assert.ok(governed.components.some((component) => component.code === "BRAND" && component.normalizedValue === "MOLEX"), item.adapter);
  }

  const conflictingAttributes = connectorAttributes.map((attribute) => attribute.code === "BRAND"
    ? { ...attribute, value: "JST" }
    : attribute);
  for (const item of adapterCases("CONN_BOARD_STD", "连接器", conflictingAttributes, { brand: "Molex" })) {
    assert.ok(item.source, item.adapter);
    const governed = governMaterialSource(item.source);
    assert.equal(governed.readiness, "REVIEW_REQUIRED", item.adapter);
    assert.equal(governed.identityDigest, null, item.adapter);
    assert.ok(governed.issues.some((issue) => issue.code === "GOVERNANCE_FORMAL_BRAND_CONFLICT"), item.adapter);
  }

  const nonIdentityBrandConflict = adapterCases(
    "CAP_CHIP",
    "电容",
    [...capAttributes, { code: "BRAND", value: "JST", unit: "" }],
    { brand: "MOLEX" },
  );
  for (const item of nonIdentityBrandConflict) {
    assert.ok(item.source, item.adapter);
    assert.equal(governMaterialSource(item.source).readiness, "READY", item.adapter);
  }
});

test("formal master-data adapters preserve explicit MPN conflict detection", () => {
  const icAttributes = [
    { code: "MPN", value: "TPS7A2033", unit: "" },
    { code: "PACKAGE", value: "SOT-23-5", unit: "" },
  ];
  for (const item of adapterCases("IC_SOT", "稳压芯片", icAttributes, { manufacturer_part_number: "TPS7A2033PDBVR" })) {
    assert.ok(item.source, item.adapter);
    const governed = governMaterialSource(item.source);
    assert.equal(governed.readiness, "REVIEW_REQUIRED", item.adapter);
    assert.equal(governed.identityDigest, null, item.adapter);
    assert.ok(governed.issues.some((issue) => issue.code === "GOVERNANCE_MODEL_CONFLICT"), item.adapter);
  }
});

test("historical formal IC rows remain visible by actual package while new drafts enforce their category leaf", () => {
  const attributes = [
    { code: "MPN", value: "LEGACY-QFN-8", unit: "" },
    { code: "PACKAGE", value: "QFN-8", unit: "" },
  ];
  const formal = materialSource({
    id: 202,
    category_code: "IC_BGA",
    standard_name: "历史错分类 IC",
    brand: "",
    manufacturer: "",
    manufacturer_part_number: "LEGACY-QFN-8",
    attributes,
  });
  assert.ok(formal);
  const governed = governMaterialSource(formal);
  assert.equal(governed.readiness, "READY");
  assert.ok(governed.components.some((component) => component.code === "PACKAGE" && component.normalizedValue === "QFN-8"));

  const draft = {
    category_id: 1,
    basic_fields: basicFields("新建错分类 IC", { manufacturer_part_number: "LEGACY-QFN-8" }),
    attributes: draftAttributes(attributes),
  };
  assert.equal(draftSource(draft, "IC_BGA"), null);
  assert.equal(validatedDraftSource({
    categoryId: 1,
    categoryCode: "IC_BGA",
    categoryName: "BGA 封装 IC",
    basic: basicFields("新建错分类 IC", { manufacturer_part_number: "LEGACY-QFN-8" }),
    attributes: normalizedAttributes(attributes),
    issues: [],
  }, 203), null);
});

test("formal draft adapters preserve negative physical values as blocking conflicts", () => {
  const negativeCapacitance = capAttributes.map((attribute) => attribute.code === "CAPACITANCE"
    ? { ...attribute, value: "-0.000000000100000000" }
    : attribute);
  for (const item of adapterCases("CAP_CHIP", "名称不参与身份", negativeCapacitance)) {
    assert.ok(item.source, item.adapter);
    const governed = governMaterialSource(item.source);
    assert.equal(governed.readiness, "REVIEW_REQUIRED", item.adapter);
    assert.equal(governed.identityDigest, null, item.adapter);
    assert.ok(governed.issues.some((issue) => issue.code === "GOVERNANCE_CAPACITANCE_CONFLICT"), item.adapter);
  }
});
