import {
  MATERIAL_ATTRIBUTE_CODE_PATTERN,
  type MaterialAttributeRule,
  type MaterialCategoryRules,
  type MaterialValidationInput,
  type MaterialValidationResult,
  type ValidationIssue,
  type ValidationIssueMetadataValue,
  type ValidationSeverity,
} from "./types.ts";
import { compatibleMaterialUnits } from "./unit-policy.ts";

type UnknownRecord = Record<string, unknown>;

export type PreparedMaterialValidationInput = Readonly<{
  categoryId: number | null;
  attributes: UnknownRecord | null;
  issues: readonly ValidationIssue[];
}>;

const SOURCE_TYPES = new Set([
  "MANUAL",
  "LEGACY_D1",
  "LEGACY_SQLITE",
  "GOVERNANCE_TEMPLATE",
  "API",
]);

const SUPPORTED_ATTRIBUTE_TYPES = new Set(["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "ENUM"]);
const NUMERIC_ATTRIBUTE_TYPES = new Set(["INTEGER", "DECIMAL"]);
const UNKNOWN_BRAND_VALUES = new Set(["UNKNOWN", "UNSPECIFIED", "N/A", "NA", "未知"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function issue(
  code: string,
  severity: ValidationSeverity,
  field: string,
  message: string,
  attributeCode?: string,
  metadata?: Readonly<Record<string, ValidationIssueMetadataValue>>,
): ValidationIssue {
  return {
    code,
    severity,
    field,
    message,
    ...(attributeCode ? { attribute_code: attributeCode } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function isMissingValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function parseEnumValues(rule: MaterialAttributeRule): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(rule.allowedValuesJson);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every((value) => typeof value === "string" && value.length > 0)) return null;
    if (new Set(parsed).size !== parsed.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validateAttributeMetadata(rule: MaterialAttributeRule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const field = `attributes.${rule.code}`;

  if (!MATERIAL_ATTRIBUTE_CODE_PATTERN.test(rule.code) || !rule.name || typeof rule.canonicalUnit !== "string") {
    issues.push(issue(
      "MATERIAL_ATTRIBUTE_METADATA_INVALID",
      "ERROR",
      field,
      "属性定义 metadata 无法安全解释",
      rule.code,
    ));
    return issues;
  }

  if (!SUPPORTED_ATTRIBUTE_TYPES.has(rule.dataType)) {
    issues.push(issue(
      "MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED",
      "ERROR",
      field,
      `属性“${rule.name}”使用了当前版本不支持的类型`,
      rule.code,
      { data_type: rule.dataType },
    ));
    return issues;
  }

  if (!NUMERIC_ATTRIBUTE_TYPES.has(rule.dataType) && rule.canonicalUnit !== "") {
    issues.push(issue(
      "MATERIAL_ATTRIBUTE_METADATA_INVALID",
      "ERROR",
      field,
      `属性“${rule.name}”的单位 metadata 与类型不一致`,
      rule.code,
    ));
  }

  if (rule.dataType === "ENUM" && parseEnumValues(rule) === null) {
    issues.push(issue(
      "MATERIAL_ATTRIBUTE_METADATA_INVALID",
      "ERROR",
      field,
      `属性“${rule.name}”的枚举 metadata 无效`,
      rule.code,
    ));
  }

  return issues;
}

export function prepareMaterialValidationInput(input: MaterialValidationInput): PreparedMaterialValidationInput {
  const issues: ValidationIssue[] = [];
  const root: UnknownRecord = isRecord(input) ? input : {};
  const basicFields: UnknownRecord = isRecord(root.basic_fields) ? root.basic_fields : {};

  if (hasOwn(root, "attribute_id")) {
    issues.push(issue(
      "MATERIAL_ATTRIBUTE_ID_FORBIDDEN",
      "ERROR",
      "attribute_id",
      "接口不接受 attribute_id，请使用稳定属性 code",
    ));
  }

  const standardName = basicFields.standard_name;
  if (typeof standardName !== "string" || standardName.trim() === "") {
    issues.push(issue(
      "MATERIAL_STANDARD_NAME_REQUIRED",
      "ERROR",
      "basic_fields.standard_name",
      "标准名称不能为空",
    ));
  }

  const materialUnit = basicFields.unit;
  if (typeof materialUnit !== "string" || materialUnit.trim() === "") {
    issues.push(issue(
      "MATERIAL_UNIT_REQUIRED",
      "ERROR",
      "basic_fields.unit",
      "基础单位不能为空",
    ));
  }

  const sourceType = basicFields.source_type;
  if (typeof sourceType !== "string" || sourceType.trim() === "") {
    issues.push(issue(
      "MATERIAL_SOURCE_TYPE_REQUIRED",
      "ERROR",
      "basic_fields.source_type",
      "来源类型不能为空",
    ));
  } else if (!SOURCE_TYPES.has(sourceType)) {
    issues.push(issue(
      "MATERIAL_SOURCE_TYPE_INVALID",
      "ERROR",
      "basic_fields.source_type",
      "来源类型不在受控值集中",
      undefined,
      { allowed_values: [...SOURCE_TYPES] },
    ));
  }

  const rawCategoryId = root.category_id;
  let categoryId: number | null = null;
  if (rawCategoryId === null || rawCategoryId === undefined || rawCategoryId === "") {
    issues.push(issue(
      "MATERIAL_CATEGORY_REQUIRED",
      "ERROR",
      "category_id",
      "分类不能为空",
    ));
  } else if (typeof rawCategoryId !== "number" || !Number.isInteger(rawCategoryId) || rawCategoryId <= 0) {
    issues.push(issue(
      "MATERIAL_CATEGORY_INVALID",
      "ERROR",
      "category_id",
      "分类 ID 必须是正整数",
    ));
  } else {
    categoryId = rawCategoryId;
  }

  let attributes: UnknownRecord | null = null;
  if (!isRecord(root.attributes)) {
    issues.push(issue(
      "MATERIAL_ATTRIBUTES_INVALID",
      "ERROR",
      "attributes",
      "attributes 必须是按属性 code 索引的对象",
    ));
  } else {
    attributes = root.attributes;
    for (const code of Object.keys(attributes).sort()) {
      const entry = attributes[code];
      if (!MATERIAL_ATTRIBUTE_CODE_PATTERN.test(code)) {
        issues.push(issue(
          "MATERIAL_ATTRIBUTE_CODE_INVALID",
          "ERROR",
          `attributes.${code}`,
          "属性 code 必须使用大写英文、数字和下划线",
          code,
        ));
      }
      if (!isRecord(entry) || !hasOwn(entry, "value")) {
        issues.push(issue(
          "MATERIAL_ATTRIBUTE_ENTRY_INVALID",
          "ERROR",
          `attributes.${code}`,
          "属性条目必须是包含 value 的对象",
          code,
        ));
        continue;
      }
      if (hasOwn(entry, "attribute_id")) {
        issues.push(issue(
          "MATERIAL_ATTRIBUTE_ID_FORBIDDEN",
          "ERROR",
          `attributes.${code}.attribute_id`,
          "接口不接受 attribute_id，请使用稳定属性 code",
          code,
        ));
      }
    }
  }

  return { categoryId, attributes, issues };
}

export function validateCategoryRules(category: MaterialCategoryRules | null): ValidationIssue[] {
  if (!category) {
    return [issue(
      "MATERIAL_CATEGORY_NOT_FOUND",
      "ERROR",
      "category_id",
      "分类不存在",
    )];
  }

  if (category.status !== "ACTIVE") {
    return [issue(
      "MATERIAL_CATEGORY_INACTIVE",
      "ERROR",
      "category_id",
      "分类已停用",
      undefined,
      { category_code: category.code },
    )];
  }

  if (category.level !== 4) {
    return [issue(
      "MATERIAL_CATEGORY_NOT_LEAF",
      "ERROR",
      "category_id",
      "物料必须选择四级叶子分类",
      undefined,
      { category_code: category.code, category_level: category.level },
    )];
  }

  if (category.attributes.length === 0) {
    return [issue(
      "MATERIAL_CATEGORY_RULES_MISSING",
      "ERROR",
      "category_id",
      "当前叶子分类没有有效属性规则",
      undefined,
      { category_code: category.code },
    )];
  }

  return [];
}

function validateAttributeType(rule: MaterialAttributeRule, value: unknown): ValidationIssue[] {
  const isValid = rule.dataType === "TEXT" || rule.dataType === "ENUM"
    ? typeof value === "string"
    : rule.dataType === "INTEGER"
      ? typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
      : rule.dataType === "DECIMAL"
        ? typeof value === "number" && Number.isFinite(value)
        : rule.dataType === "BOOLEAN"
          ? typeof value === "boolean"
          : false;

  if (isValid) return [];

  return [issue(
    "MATERIAL_ATTRIBUTE_TYPE_INVALID",
    "ERROR",
    `attributes.${rule.code}.value`,
    `属性“${rule.name}”的值类型必须是 ${rule.dataType}`,
    rule.code,
    { expected_type: rule.dataType, actual_type: actualType(value) },
  )];
}

function validateAttributeUnit(rule: MaterialAttributeRule, entry: UnknownRecord): ValidationIssue[] {
  const unit = entry.unit;
  const hasUnit = unit !== undefined && unit !== null && unit !== "";

  if (!NUMERIC_ATTRIBUTE_TYPES.has(rule.dataType) || rule.canonicalUnit === "") {
    if (!hasUnit) return [];
    return [issue(
      "MATERIAL_ATTRIBUTE_UNIT_NOT_ALLOWED",
      "ERROR",
      `attributes.${rule.code}.unit`,
      `属性“${rule.name}”不允许提供单位`,
      rule.code,
    )];
  }

  if (typeof unit !== "string" || unit === "") {
    return [issue(
      "MATERIAL_ATTRIBUTE_UNIT_REQUIRED",
      "ERROR",
      `attributes.${rule.code}.unit`,
      `属性“${rule.name}”必须提供单位`,
      rule.code,
      { canonical_unit: rule.canonicalUnit },
    )];
  }

  const compatibleUnits = compatibleMaterialUnits(rule.canonicalUnit);
  if (compatibleUnits.includes(unit)) return [];

  return [issue(
    "MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE",
    "ERROR",
    `attributes.${rule.code}.unit`,
    `属性“${rule.name}”的单位与标准单位不兼容`,
    rule.code,
    { canonical_unit: rule.canonicalUnit, allowed_units: compatibleUnits },
  )];
}

function validateAttributeEnum(rule: MaterialAttributeRule, value: unknown): ValidationIssue[] {
  if (rule.dataType !== "ENUM" || typeof value !== "string") return [];
  const values = parseEnumValues(rule);
  if (!values || values.includes(value)) return [];

  return [issue(
    "MATERIAL_ATTRIBUTE_ENUM_INVALID",
    "ERROR",
    `attributes.${rule.code}.value`,
    `属性“${rule.name}”的枚举值不合法`,
    rule.code,
    { allowed_values: values },
  )];
}

export function validateMaterialAttributes(
  category: MaterialCategoryRules,
  attributes: UnknownRecord,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const boundCodes = new Set(category.attributes.map((rule) => rule.code));

  for (const code of Object.keys(attributes).filter((value) => MATERIAL_ATTRIBUTE_CODE_PATTERN.test(value)).sort()) {
    if (boundCodes.has(code)) continue;
    issues.push(issue(
      "MATERIAL_ATTRIBUTE_NOT_BOUND",
      "ERROR",
      `attributes.${code}`,
      "属性未绑定当前分类",
      code,
      { category_code: category.code },
    ));
  }

  const sortedRules = [...category.attributes].sort((left, right) =>
    left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
  );

  for (const rule of sortedRules) {
    const metadataIssues = validateAttributeMetadata(rule);
    issues.push(...metadataIssues);
    if (metadataIssues.length > 0) continue;

    const entry = attributes[rule.code];
    if (entry === undefined) {
      if (rule.isRequired) {
        issues.push(issue(
          "MATERIAL_ATTRIBUTE_REQUIRED",
          "ERROR",
          `attributes.${rule.code}`,
          `缺少必填属性：${rule.name}`,
          rule.code,
        ));
      }
      continue;
    }

    if (!isRecord(entry) || !hasOwn(entry, "value")) continue;
    const value = entry.value;
    if (isMissingValue(value)) {
      if (rule.isRequired) {
        issues.push(issue(
          "MATERIAL_ATTRIBUTE_REQUIRED",
          "ERROR",
          `attributes.${rule.code}`,
          `缺少必填属性：${rule.name}`,
          rule.code,
        ));
      }
      continue;
    }

    const typeIssues = validateAttributeType(rule, value);
    issues.push(...typeIssues);
    if (typeIssues.length > 0) continue;

    issues.push(...validateAttributeUnit(rule, entry));
    issues.push(...validateAttributeEnum(rule, value));

    if (
      rule.code === "BRAND"
      && typeof value === "string"
      && UNKNOWN_BRAND_VALUES.has(value.trim().toUpperCase())
    ) {
      issues.push(issue(
        "MATERIAL_BRAND_UNKNOWN",
        "WARNING",
        "attributes.BRAND.value",
        "品牌为未知占位值，请人工确认",
        "BRAND",
      ));
    }
  }

  return issues;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function issueGroup(issueEntry: ValidationIssue, boundOrder: ReadonlyMap<string, number>): number {
  if (issueEntry.field.startsWith("basic_fields.") || issueEntry.field === "attribute_id") return 0;
  if (issueEntry.field === "category_id") return 1;
  if (issueEntry.attribute_code && boundOrder.has(issueEntry.attribute_code)) return 2;
  if (issueEntry.field === "attributes" || issueEntry.field.startsWith("attributes.")) return 3;
  return 4;
}

function basicFieldOrder(field: string): number {
  if (field === "basic_fields.standard_name") return 0;
  if (field === "basic_fields.unit") return 1;
  if (field === "basic_fields.source_type") return 2;
  if (field === "attribute_id") return 3;
  if (field === "attributes") return 4;
  return 5;
}

function sortValidationIssues(
  issues: readonly ValidationIssue[],
  category?: MaterialCategoryRules | null,
): ValidationIssue[] {
  const boundOrder = new Map(
    (category?.attributes ?? [])
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder || compareText(left.code, right.code))
      .map((rule, index) => [rule.code, index]),
  );

  return [...issues].sort((left, right) => {
    const leftGroup = issueGroup(left, boundOrder);
    const rightGroup = issueGroup(right, boundOrder);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;

    if (leftGroup === 0) {
      const fieldDifference = basicFieldOrder(left.field) - basicFieldOrder(right.field);
      if (fieldDifference !== 0) return fieldDifference;
    }

    if (leftGroup === 2) {
      const orderDifference = (boundOrder.get(left.attribute_code ?? "") ?? 0)
        - (boundOrder.get(right.attribute_code ?? "") ?? 0);
      if (orderDifference !== 0) return orderDifference;
    }

    if (leftGroup === 3) {
      const codeDifference = compareText(left.attribute_code ?? left.field, right.attribute_code ?? right.field);
      if (codeDifference !== 0) return codeDifference;
    }

    const fieldDifference = compareText(left.field, right.field);
    if (fieldDifference !== 0) return fieldDifference;
    return compareText(left.code, right.code);
  });
}

export function buildMaterialValidationResult(
  issues: readonly ValidationIssue[],
  category?: MaterialCategoryRules | null,
): MaterialValidationResult {
  const errors = sortValidationIssues(issues.filter((entry) => entry.severity === "ERROR"), category);
  const warnings = sortValidationIssues(issues.filter((entry) => entry.severity === "WARNING"), category);
  return { valid: errors.length === 0, errors, warnings };
}
