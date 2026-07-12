import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryMaterialValidationRepository,
  createMaterialValidationService,
} from "../app/lib/material-validation/index.ts";

const attribute = (code, name, dataType, options = {}) => ({
  code,
  name,
  dataType,
  decimalScale: options.decimalScale ?? 0,
  canonicalUnit: options.canonicalUnit ?? "",
  allowedValuesJson: JSON.stringify(options.allowedValues ?? []),
  isRequired: options.isRequired ?? true,
  sortOrder: options.sortOrder ?? 10,
});

const FR4_RULES = {
  id: 101,
  code: "FR4_STANDARD",
  level: 4,
  status: "ACTIVE",
  attributes: [
    attribute("BRAND", "品牌", "TEXT", { sortOrder: 10 }),
    attribute("MODEL", "型号", "TEXT", { sortOrder: 20 }),
    attribute("THICKNESS", "厚度", "DECIMAL", { canonicalUnit: "mm", decimalScale: 3, sortOrder: 30 }),
    attribute("COPPER_THICKNESS", "铜厚", "DECIMAL", { canonicalUnit: "um", decimalScale: 1, sortOrder: 40 }),
    attribute("TG", "TG", "DECIMAL", { canonicalUnit: "°C", decimalScale: 1, sortOrder: 50 }),
    attribute("FLAMMABILITY", "阻燃等级", "TEXT", { sortOrder: 60 }),
    attribute("HALOGEN_FREE", "无卤", "BOOLEAN", { sortOrder: 70 }),
  ],
};

const RESISTOR_RULES = {
  id: 102,
  code: "RES_CHIP",
  level: 4,
  status: "ACTIVE",
  attributes: [
    attribute("RESISTANCE", "阻值", "DECIMAL", { canonicalUnit: "ohm", decimalScale: 3, sortOrder: 10 }),
    attribute("TOLERANCE", "精度", "DECIMAL", { canonicalUnit: "%", decimalScale: 3, sortOrder: 20 }),
    attribute("POWER", "功率", "DECIMAL", { canonicalUnit: "W", decimalScale: 3, sortOrder: 30 }),
    attribute("PACKAGE", "封装", "TEXT", { sortOrder: 40 }),
    attribute("BRAND", "品牌", "TEXT", { sortOrder: 50 }),
    attribute("MPN", "制造商料号", "TEXT", { sortOrder: 60 }),
  ],
};

const PASTE_RULES = {
  id: 103,
  code: "PASTE_LEAD_FREE_STD",
  level: 4,
  status: "ACTIVE",
  attributes: [
    attribute("BRAND", "品牌", "TEXT", { sortOrder: 10 }),
    attribute("ALLOY", "合金", "ENUM", { allowedValues: ["SAC305", "SAC0307", "SN63PB37", "OTHER"], sortOrder: 20 }),
    attribute("POWDER_GRADE", "粉号", "ENUM", { allowedValues: ["T3", "T4", "T5", "T6", "OTHER"], sortOrder: 30 }),
    attribute("WEIGHT", "重量", "DECIMAL", { canonicalUnit: "kg", decimalScale: 3, sortOrder: 40 }),
    attribute("SHELF_LIFE_DAYS", "保质期", "INTEGER", { canonicalUnit: "day", sortOrder: 50 }),
  ],
};

function serviceWith(rules = [FR4_RULES, RESISTOR_RULES, PASTE_RULES]) {
  const repository = new MemoryMaterialValidationRepository(rules);
  return { repository, service: createMaterialValidationService(repository) };
}

function input(categoryId, attributes, basicFields = {}) {
  return {
    category_id: categoryId,
    basic_fields: {
      standard_name: "测试物料",
      unit: "PCS",
      source_type: "MANUAL",
      ...basicFields,
    },
    attributes,
  };
}

function fr4Attributes(overrides = {}) {
  return {
    BRAND: { value: "KINGBOARD" },
    MODEL: { value: "KB-6160" },
    THICKNESS: { value: 1.6, unit: "mm" },
    COPPER_THICKNESS: { value: 35, unit: "um" },
    TG: { value: 150, unit: "°C" },
    FLAMMABILITY: { value: "V-0" },
    HALOGEN_FREE: { value: false },
    ...overrides,
  };
}

function resistorAttributes(overrides = {}) {
  return {
    RESISTANCE: { value: 10_000, unit: "ohm" },
    TOLERANCE: { value: 1, unit: "%" },
    POWER: { value: 0.25, unit: "W" },
    PACKAGE: { value: "0603" },
    BRAND: { value: "YAGEO" },
    MPN: { value: "RC0603FR-0710KL" },
    ...overrides,
  };
}

function pasteAttributes(overrides = {}) {
  return {
    BRAND: { value: "ALPHA" },
    ALLOY: { value: "SAC305" },
    POWDER_GRADE: { value: "T4" },
    WEIGHT: { value: 0.5, unit: "kg" },
    SHELF_LIFE_DAYS: { value: 180, unit: "day" },
    ...overrides,
  };
}

const codes = (result) => result.errors.map((entry) => entry.code);

test("FR4 correct input passes with compatible length units", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(101, fr4Attributes({
    THICKNESS: { value: 1600, unit: "um" },
  })));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("FR4 missing thickness fails", async () => {
  const { service } = serviceWith();
  const attributes = fr4Attributes();
  delete attributes.THICKNESS;
  const result = await service.validateForCreate(input(101, attributes));
  assert.equal(result.valid, false);
  assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_REQUIRED"]);
  assert.equal(result.errors[0].attribute_code, "THICKNESS");
  assert.equal(result.errors[0].severity, "ERROR");
  assert.equal(result.errors[0].field, "attributes.THICKNESS");
  assert.match(result.errors[0].message, /厚度/);
});

test("FR4 copper thickness rejects incompatible unit", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(101, fr4Attributes({
    COPPER_THICKNESS: { value: 35, unit: "kg" },
  })));
  assert.equal(result.valid, false);
  assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE"]);
});

test("resistor correct input passes", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(102, resistorAttributes()));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("resistor missing resistance fails", async () => {
  const { service } = serviceWith();
  const attributes = resistorAttributes();
  delete attributes.RESISTANCE;
  const result = await service.validateForCreate(input(102, attributes));
  assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_REQUIRED"]);
  assert.equal(result.errors[0].attribute_code, "RESISTANCE");
});

test("resistor power rejects string number", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(102, resistorAttributes({
    POWER: { value: "0.25", unit: "W" },
  })));
  assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_TYPE_INVALID"]);
  assert.equal(result.errors[0].metadata.actual_type, "string");
});

test("solder paste correct input passes", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(103, pasteAttributes()));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("solder paste rejects invalid alloy enum", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(103, pasteAttributes({
    ALLOY: { value: "SAC999" },
  })));
  assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_ENUM_INVALID"]);
  assert.deepEqual(result.errors[0].metadata.allowed_values, ["SAC305", "SAC0307", "SN63PB37", "OTHER"]);
});

test("basic fields and source type return structured errors", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(101, fr4Attributes(), {
    standard_name: " ",
    unit: null,
    source_type: "AI",
  }));
  assert.deepEqual(codes(result), [
    "MATERIAL_STANDARD_NAME_REQUIRED",
    "MATERIAL_UNIT_REQUIRED",
    "MATERIAL_SOURCE_TYPE_INVALID",
  ]);
  assert.ok(result.errors.every((entry) => entry.severity === "ERROR" && typeof entry.code === "string"));
});

test("category must exist, be active and be a level-four leaf", async (t) => {
  const inactive = { ...FR4_RULES, id: 201, code: "FR4_INACTIVE", status: "INACTIVE" };
  const parent = { ...FR4_RULES, id: 202, code: "SUB_FR4", level: 3 };
  const noRules = { ...FR4_RULES, id: 203, code: "FR4_NO_RULES", attributes: [] };
  const { service } = serviceWith([inactive, parent, noRules]);

  await t.test("not found", async () => {
    const result = await service.validateForCreate(input(999, {}));
    assert.deepEqual(codes(result), ["MATERIAL_CATEGORY_NOT_FOUND"]);
  });
  await t.test("inactive", async () => {
    const result = await service.validateForCreate(input(201, {}));
    assert.deepEqual(codes(result), ["MATERIAL_CATEGORY_INACTIVE"]);
  });
  await t.test("not leaf", async () => {
    const result = await service.validateForCreate(input(202, {}));
    assert.deepEqual(codes(result), ["MATERIAL_CATEGORY_NOT_LEAF"]);
  });
  await t.test("missing rules", async () => {
    const result = await service.validateForCreate(input(203, {}));
    assert.deepEqual(codes(result), ["MATERIAL_CATEGORY_RULES_MISSING"]);
  });
});

test("category id and attributes container are validated before repository access", async () => {
  let calls = 0;
  const service = createMaterialValidationService({
    async getCategoryRules() {
      calls += 1;
      return FR4_RULES;
    },
  });
  const result = await service.validateForCreate({
    category_id: "101",
    basic_fields: { standard_name: "测试", unit: "PCS", source_type: "MANUAL" },
    attributes: [],
  });
  assert.deepEqual(codes(result), ["MATERIAL_CATEGORY_INVALID", "MATERIAL_ATTRIBUTES_INVALID"]);
  assert.equal(calls, 0);
});

test("attribute code must be uppercase and bound to the category", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(101, fr4Attributes({
    brand: { value: "lowercase" },
    EXTRA_ATTRIBUTE: { value: "extra" },
  })));
  assert.deepEqual(codes(result), [
    "MATERIAL_ATTRIBUTE_NOT_BOUND",
    "MATERIAL_ATTRIBUTE_CODE_INVALID",
  ]);
});

test("bound attribute errors precede unbound attributes in stable output order", async () => {
  const { service } = serviceWith();
  const attributes = fr4Attributes({ EXTRA_ATTRIBUTE: { value: "extra" } });
  delete attributes.THICKNESS;
  const result = await service.validateForCreate(input(101, attributes));
  assert.deepEqual(codes(result), [
    "MATERIAL_ATTRIBUTE_REQUIRED",
    "MATERIAL_ATTRIBUTE_NOT_BOUND",
  ]);
  assert.deepEqual(result.errors.map((entry) => entry.attribute_code), ["THICKNESS", "EXTRA_ATTRIBUTE"]);
});

test("attribute_id is forbidden at the top level and inside attribute entries", async () => {
  const { service } = serviceWith();
  const request = {
    ...input(101, fr4Attributes({ BRAND: { value: "KINGBOARD", attribute_id: 88 } })),
    attribute_id: 77,
  };
  const result = await service.validateForCreate(request);
  assert.deepEqual(codes(result), [
    "MATERIAL_ATTRIBUTE_ID_FORBIDDEN",
    "MATERIAL_ATTRIBUTE_ID_FORBIDDEN",
  ]);
});

test("attribute entry must contain a value field", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(101, fr4Attributes({ BRAND: { unit: "" } })));
  assert.ok(codes(result).includes("MATERIAL_ATTRIBUTE_ENTRY_INVALID"));
});

test("unknown brand is a warning and does not block review", async () => {
  const { service } = serviceWith();
  const result = await service.validateForReview(input(101, fr4Attributes({ BRAND: { value: "UNKNOWN" } })));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.map((entry) => entry.code), ["MATERIAL_BRAND_UNKNOWN"]);
  assert.equal(result.warnings[0].severity, "WARNING");
});

test("review is blocked when validation contains an ERROR", async () => {
  const { service } = serviceWith();
  const attributes = fr4Attributes();
  delete attributes.THICKNESS;
  const result = await service.validateForReview(input(101, attributes));
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].severity, "ERROR");
});

test("unsupported type and damaged enum metadata block validation", async (t) => {
  await t.test("unsupported DATE type", async () => {
    const rules = {
      id: 301,
      code: "DATE_CATEGORY",
      level: 4,
      status: "ACTIVE",
      attributes: [attribute("EXPIRY_DATE", "失效日期", "DATE")],
    };
    const { service } = serviceWith([rules]);
    const result = await service.validateForCreate(input(301, { EXPIRY_DATE: { value: "2026-12-31" } }));
    assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED"]);
  });

  await t.test("invalid enum JSON", async () => {
    const badEnum = { ...attribute("ALLOY", "合金", "ENUM"), allowedValuesJson: "not-json" };
    const rules = { id: 302, code: "BAD_ENUM", level: 4, status: "ACTIVE", attributes: [badEnum] };
    const { service } = serviceWith([rules]);
    const result = await service.validateForCreate(input(302, { ALLOY: { value: "SAC305" } }));
    assert.deepEqual(codes(result), ["MATERIAL_ATTRIBUTE_METADATA_INVALID"]);
  });
});

test("repository failures become sanitized metadata errors", async () => {
  const service = createMaterialValidationService({
    async getCategoryRules() {
      throw new Error("SQL SELECT secret_table failed");
    },
  });
  const result = await service.validateForCreate(input(101, fr4Attributes()));
  assert.deepEqual(codes(result), ["MATERIAL_VALIDATION_METADATA_UNAVAILABLE"]);
  assert.doesNotMatch(JSON.stringify(result), /SELECT|secret_table/);
});

test("memory repository metadata replacement is visible on the next validation", async () => {
  const optionalBrand = {
    id: 401,
    code: "MEMORY_DYNAMIC",
    level: 4,
    status: "ACTIVE",
    attributes: [attribute("BRAND", "品牌", "TEXT", { isRequired: false })],
  };
  const { repository, service } = serviceWith([optionalBrand]);
  assert.equal((await service.validateForCreate(input(401, {}))).valid, true);

  repository.setCategoryRules({
    ...optionalBrand,
    attributes: [attribute("BRAND", "品牌", "TEXT", { isRequired: true })],
  });
  const changed = await service.validateForCreate(input(401, {}));
  assert.deepEqual(codes(changed), ["MATERIAL_ATTRIBUTE_REQUIRED"]);
});

test("source and confidence extension fields are reserved without changing V1 decisions", async () => {
  const { service } = serviceWith();
  const result = await service.validateForCreate(input(101, fr4Attributes({
    BRAND: { value: "KINGBOARD", source: "SUPPLIER_FILE", confidence: 0.42 },
  })));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});
