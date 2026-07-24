import { createHash } from "node:crypto";
import { reviewFailure } from "./errors.ts";
import type {
  EffectiveReviewValues,
  OverrideSemantics,
  ReviewAttributeDefinition,
  ReviewFieldDefinition,
} from "./types.ts";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CORE_REVIEW_FIELDS: Readonly<Record<string, ReviewFieldDefinition>> = Object.freeze({
  CATEGORY_ID: { code: "CATEGORY_ID", dataType: "INTEGER", required: true },
  STANDARD_NAME: { code: "STANDARD_NAME", dataType: "TEXT", required: true, maximumLength: 200 },
  SPECIFICATION_MODEL: { code: "SPECIFICATION_MODEL", dataType: "TEXT", required: false, maximumLength: 500 },
  UNIT: { code: "UNIT", dataType: "TEXT", required: true, maximumLength: 50 },
  BRAND: { code: "BRAND", dataType: "TEXT", required: false, maximumLength: 200 },
  MANUFACTURER: { code: "MANUFACTURER", dataType: "TEXT", required: false, maximumLength: 200 },
  MANUFACTURER_PART_NUMBER: { code: "MANUFACTURER_PART_NUMBER", dataType: "TEXT", required: false, maximumLength: 200 },
  DESCRIPTION: { code: "DESCRIPTION", dataType: "TEXT", required: false, maximumLength: 2000 },
  PURCHASE_TYPE: { code: "PURCHASE_TYPE", dataType: "ENUM", required: false, enumValues: ["PURCHASE", "OUTSOURCE", "SELF_MADE", "NON_PURCHASABLE"] },
  INVENTORY_TYPE: { code: "INVENTORY_TYPE", dataType: "ENUM", required: false, enumValues: ["STOCKED", "NON_STOCKED", "CONSIGNMENT"] },
  LOT_CONTROL: { code: "LOT_CONTROL", dataType: "BOOLEAN", required: false },
  SHELF_LIFE_DAYS: { code: "SHELF_LIFE_DAYS", dataType: "INTEGER", required: false },
  INSPECTION_TYPE: { code: "INSPECTION_TYPE", dataType: "ENUM", required: false, enumValues: ["NONE", "NORMAL", "TIGHTENED", "REDUCED", "FULL"] },
  ENVIRONMENTAL_REQUIREMENT: { code: "ENVIRONMENTAL_REQUIREMENT", dataType: "ENUM", required: false, enumValues: ["UNSPECIFIED", "ROHS", "ROHS_REACH", "HALOGEN_FREE", "CUSTOMER_SPECIFIC"] },
});

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}

export function canonicalReviewJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function reviewDigest(value: unknown): string {
  return createHash("sha256").update(canonicalReviewJson(value)).digest("hex");
}

function validateDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${field} 必须是 YYYY-MM-DD 日期`, 422);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${field} 日期无效`, 422);
  return value;
}

function validateValue(
  code: string,
  value: unknown,
  definition: Pick<ReviewAttributeDefinition, "dataType" | "maximumLength" | "enumValues"> | ReviewFieldDefinition,
): unknown {
  if (definition.dataType === "TEXT") {
    if (typeof value !== "string" || CONTROL.test(value) || Buffer.byteLength(value) > 16_384 || value.length > (definition.maximumLength ?? 2000)) {
      reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${code} 文本格式或长度无效`, 422);
    }
    return value.trim();
  }
  if (definition.dataType === "BOOLEAN") {
    if (typeof value !== "boolean") reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${code} 必须是布尔值`, 422);
    return value;
  }
  if (definition.dataType === "INTEGER") {
    if (!Number.isSafeInteger(value)) reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${code} 必须是安全整数`, 422);
    return value;
  }
  if (definition.dataType === "DECIMAL") {
    if ((typeof value !== "number" && typeof value !== "string") || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))) {
      reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${code} 必须是有限十进制数`, 422);
    }
    return Number(value);
  }
  if (definition.dataType === "DATE") return validateDate(value, code);
  if (typeof value !== "string" || !definition.enumValues?.includes(value)) reviewFailure("IMPORT_REVIEW_VALUE_INVALID", `${code} 枚举值无效`, 422);
  return value;
}

export function validateCoreOverride(code: string, semantics: OverrideSemantics, value: unknown): unknown {
  const definition = CORE_REVIEW_FIELDS[code];
  if (!definition) reviewFailure("IMPORT_REVIEW_FIELD_UNKNOWN", `未知复核字段：${code}`, 422);
  if (semantics === "REVERT" || semantics === "CLEAR") {
    if (value !== undefined && value !== null) reviewFailure("IMPORT_REVIEW_VALUE_INVALID", "清空或撤销覆盖时不能携带 override_value", 400);
    if (semantics === "CLEAR" && definition.required) reviewFailure("IMPORT_REVIEW_REQUIRED_FIELD", `${code} 不能清空`, 422);
    return null;
  }
  return validateValue(code, value, definition);
}

export function validateAttributeOverride(
  definition: ReviewAttributeDefinition | null,
  categoryId: number | null,
  semantics: OverrideSemantics,
  value: unknown,
): unknown {
  if (!definition || !definition.enabled) reviewFailure("IMPORT_REVIEW_ATTRIBUTE_UNAVAILABLE", "属性不存在或已经停用", 422);
  if (categoryId && definition.categoryIds.length && !definition.categoryIds.includes(categoryId)) reviewFailure("IMPORT_REVIEW_ATTRIBUTE_CATEGORY_MISMATCH", "当前分类不允许该属性", 422);
  if (semantics === "REVERT" || semantics === "CLEAR") {
    if (value !== undefined && value !== null) reviewFailure("IMPORT_REVIEW_VALUE_INVALID", "清空或撤销覆盖时不能携带 override_value", 400);
    if (semantics === "CLEAR" && definition.required) reviewFailure("IMPORT_REVIEW_REQUIRED_ATTRIBUTE", `${definition.code} 是必填属性`, 422);
    return null;
  }
  return validateValue(definition.code, value, definition);
}

export function effectiveValue(candidate: unknown, override: Readonly<{ value_semantics: OverrideSemantics; override_value: unknown }> | null): unknown {
  if (!override || override.value_semantics === "REVERT") return candidate;
  if (override.value_semantics === "CLEAR") return null;
  return override.override_value;
}

export function buildEffectiveValues(input: Readonly<{
  fieldCandidates: readonly Readonly<{ target_code: string; normalized_value: unknown }>[];
  attributeCandidates: readonly Readonly<{ attribute_code: string; data_type?: string; normalized_value: unknown; unit_code: string | null }>[];
  fieldOverrides: readonly Readonly<{ target_field_code: string; value_semantics: OverrideSemantics; override_value: unknown }>[];
  attributeOverrides: readonly Readonly<{ attribute_code: string; value_semantics: OverrideSemantics; override_value: unknown; unit_or_format: string | null }>[];
}>): EffectiveReviewValues {
  const fields: Record<string, unknown> = {};
  const attributes: Record<string, { value: unknown; unit: string | null }> = {};
  const fieldOverrides = new Map(input.fieldOverrides.map((item) => [item.target_field_code, item]));
  const attributeOverrides = new Map(input.attributeOverrides.map((item) => [item.attribute_code, item]));
  for (const item of input.fieldCandidates) fields[item.target_code] = effectiveValue(item.normalized_value, fieldOverrides.get(item.target_code) ?? null);
  for (const [code, item] of fieldOverrides) if (!(code in fields)) fields[code] = effectiveValue(undefined, item);
  for (const item of input.attributeCandidates) {
    const override = attributeOverrides.get(item.attribute_code) ?? null;
    const candidateObject = item.normalized_value && typeof item.normalized_value === "object" && !Array.isArray(item.normalized_value)
      ? item.normalized_value as Record<string, unknown>
      : null;
    const candidateRawValue = candidateObject && Object.hasOwn(candidateObject, "value") ? candidateObject.value : item.normalized_value;
    const candidateValue = item.data_type === "DECIMAL" && candidateRawValue !== null && candidateRawValue !== ""
      ? Number(candidateRawValue)
      : candidateRawValue;
    const candidateUnit = candidateObject && typeof candidateObject.unit === "string" ? candidateObject.unit : item.unit_code;
    attributes[item.attribute_code] = {
      value: effectiveValue(candidateValue, override),
      unit: override?.value_semantics === "SET" ? override.unit_or_format || null : candidateUnit,
    };
  }
  for (const [code, item] of attributeOverrides) if (!(code in attributes)) attributes[code] = { value: effectiveValue(undefined, item), unit: item.unit_or_format || null };
  return { fields, attributes };
}
