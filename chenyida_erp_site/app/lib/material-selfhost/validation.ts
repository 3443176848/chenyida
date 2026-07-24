import { MaterialWorkflowError, materialFailure, type MaterialIssue } from "./errors.ts";
import type { AttributeInput, DraftBasicFields, NormalizedAttribute, ValidatedDraft } from "./types.ts";

export type CategoryAttributeDefinition = Readonly<{
  definitionId: number;
  attributeCode: string;
  name: string;
  dataType: string;
  decimalScale: number;
  canonicalUnit: string;
  allowedValues: readonly string[];
  normalizationRule: string;
  required: boolean;
}>;

export type CategoryMetadata = Readonly<{
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  categoryLevel: number;
  definitions: readonly CategoryAttributeDefinition[];
}>;

const TOP_LEVEL_KEYS = new Set(["basic_fields", "category_id", "attributes"]);
const BASIC_KEYS = new Set([
  "standard_name", "unit", "brand", "manufacturer", "manufacturer_part_number",
  "procurement_type", "inventory_type", "lot_control_required", "shelf_life_days",
  "inspection_type", "environmental_requirement", "source_type", "source_ref",
]);
const ATTRIBUTE_KEYS = new Set(["value", "unit", "source", "confidence"]);
const IDENTITY_FIELDS = new Set([
  "actor", "context", "request_id", "created_by", "updated_by", "last_modified_by",
  "submitted_by", "submitted_at", "approved_by", "approved_at", "created_at", "updated_at",
  "reviewed_by", "internal_material_code", "material_code", "material_status", "version",
]);
const PROCUREMENT_TYPES = new Set(["PURCHASE", "OUTSOURCE", "SELF_MADE", "NON_PURCHASABLE"]);
const INVENTORY_TYPES = new Set(["STOCKED", "NON_STOCKED", "CONSIGNMENT"]);
const INSPECTION_TYPES = new Set(["NONE", "NORMAL", "TIGHTENED", "REDUCED", "FULL"]);
const ENVIRONMENT_TYPES = new Set(["UNSPECIFIED", "ROHS", "ROHS_REACH", "HALOGEN_FREE", "CUSTOMER_SPECIFIC"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) materialFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是对象`, 400);
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) materialFailure("REQUEST_VALIDATION_FAILED", `${field} 包含未知字段：${unknown}`, 400);
}

export function assertNoIdentityFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoIdentityFields(item);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_FIELDS.has(key)) materialFailure("REQUEST_VALIDATION_FAILED", `禁止客户端指定字段：${key}`, 400);
    assertNoIdentityFields(child);
  }
}

function stringField(value: unknown, field: string, maximum: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) materialFailure("REQUEST_VALIDATION_FAILED", `${field} 必填`, 400);
    return "";
  }
  if (typeof value !== "string") materialFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是字符串`, 400);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum || CONTROL_CHARACTERS.test(normalized)) {
    materialFailure("REQUEST_VALIDATION_FAILED", `${field} 为空、过长或包含非法字符`, 400);
  }
  return normalized;
}

function enumField(value: unknown, field: string, allowed: ReadonlySet<string>): string {
  const normalized = stringField(value, field, 40, true);
  if (!allowed.has(normalized)) materialFailure("REQUEST_VALIDATION_FAILED", `${field} 的值无效`, 400);
  return normalized;
}

function basicFields(raw: unknown, sourceFallback: Readonly<{ sourceType?: string; sourceRef?: string }>): DraftBasicFields {
  const value = objectValue(raw, "basic_fields");
  assertKnownKeys(value, BASIC_KEYS, "basic_fields");
  const lot = value.lot_control_required;
  if (typeof lot !== "boolean") materialFailure("REQUEST_VALIDATION_FAILED", "lot_control_required 必须明确为布尔值", 400);
  let shelfLife: number | null = null;
  if (value.shelf_life_days !== undefined && value.shelf_life_days !== null && value.shelf_life_days !== "") {
    if (!Number.isSafeInteger(value.shelf_life_days) || Number(value.shelf_life_days) < 0) materialFailure("REQUEST_VALIDATION_FAILED", "shelf_life_days 必须是非负安全整数", 400);
    shelfLife = Number(value.shelf_life_days);
  }
  const sourceType = value.source_type === undefined ? sourceFallback.sourceType ?? "MANUAL" : stringField(value.source_type, "source_type", 32, true);
  if (sourceType !== "MANUAL") materialFailure("SOURCE_TYPE_NOT_ALLOWED", "页面草稿只允许 MANUAL 来源", 400);
  return {
    standard_name: stringField(value.standard_name, "standard_name", 200, true),
    unit: stringField(value.unit, "unit", 32, true),
    brand: stringField(value.brand, "brand", 200),
    manufacturer: stringField(value.manufacturer, "manufacturer", 200),
    manufacturer_part_number: stringField(value.manufacturer_part_number, "manufacturer_part_number", 200),
    procurement_type: enumField(value.procurement_type, "procurement_type", PROCUREMENT_TYPES),
    inventory_type: enumField(value.inventory_type, "inventory_type", INVENTORY_TYPES),
    lot_control_required: lot,
    shelf_life_days: shelfLife,
    inspection_type: enumField(value.inspection_type, "inspection_type", INSPECTION_TYPES),
    environmental_requirement: enumField(value.environmental_requirement, "environmental_requirement", ENVIRONMENT_TYPES),
    source_type: sourceType,
    source_ref: value.source_ref === undefined ? sourceFallback.sourceRef ?? "" : stringField(value.source_ref, "source_ref", 500),
  };
}

function decimalPlaces(value: number): number {
  const text = String(value).toLowerCase();
  if (!text.includes("e")) return (text.split(".")[1] || "").length;
  const [coefficient, exponentText] = text.split("e");
  return Math.max(0, (coefficient.split(".")[1] || "").length - Number(exponentText));
}

function attributeIssue(definition: CategoryAttributeDefinition, code: string, message: string): MaterialIssue {
  return { code, severity: "ERROR", field: `attributes.${definition.attributeCode}`, attribute_code: definition.attributeCode, message };
}

function normalizeAttribute(definition: CategoryAttributeDefinition, raw: AttributeInput): NormalizedAttribute | MaterialIssue {
  const fieldName = definition.name || definition.attributeCode;
  const unit = raw.unit === undefined ? "" : String(raw.unit).trim();
  if (definition.canonicalUnit ? unit !== definition.canonicalUnit : Boolean(unit)) {
    return attributeIssue(definition, "MATERIAL_ATTRIBUTE_UNIT_INVALID", `${fieldName} 的单位必须为 ${definition.canonicalUnit || "空"}`);
  }
  if (raw.source !== undefined && raw.source !== "MANUAL") return attributeIssue(definition, "MATERIAL_ATTRIBUTE_SOURCE_INVALID", `${fieldName} 只允许 MANUAL 来源`);
  if (raw.confidence !== undefined && raw.confidence !== 1) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_CONFIDENCE_INVALID", `${fieldName} 的人工录入置信度必须为 1`);
  let value = raw.value;
  let normalizedValue = "";
  switch (definition.dataType) {
    case "TEXT": {
      if (typeof value !== "string") return attributeIssue(definition, "MATERIAL_ATTRIBUTE_TYPE_INVALID", `${fieldName} 必须是文本`);
      const textValue = value.trim();
      if (!textValue || textValue.length > 1000 || CONTROL_CHARACTERS.test(textValue)) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_TEXT_INVALID", `${fieldName} 为空、过长或包含非法字符`);
      value = textValue;
      normalizedValue = definition.normalizationRule === "TRIM_UPPER" ? textValue.toUpperCase() : textValue;
      break;
    }
    case "INTEGER":
      if (!Number.isSafeInteger(value)) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_TYPE_INVALID", `${fieldName} 必须是安全整数`);
      normalizedValue = String(value);
      break;
    case "DECIMAL":
      if (typeof value !== "number" || !Number.isFinite(value) || decimalPlaces(value) > definition.decimalScale) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_DECIMAL_INVALID", `${fieldName} 必须是最多 ${definition.decimalScale} 位小数`);
      normalizedValue = value.toFixed(definition.decimalScale);
      break;
    case "BOOLEAN":
      if (typeof value !== "boolean") return attributeIssue(definition, "MATERIAL_ATTRIBUTE_TYPE_INVALID", `${fieldName} 必须是布尔值`);
      normalizedValue = value ? "true" : "false";
      break;
    case "DATE": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_DATE_INVALID", `${fieldName} 必须是 YYYY-MM-DD 日期`);
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_DATE_INVALID", `${fieldName} 日期无效`);
      normalizedValue = value;
      break;
    }
    case "ENUM":
      if (typeof value !== "string" || !definition.allowedValues.includes(value)) return attributeIssue(definition, "MATERIAL_ATTRIBUTE_ENUM_INVALID", `${fieldName} 不在允许的枚举范围内`);
      normalizedValue = value;
      break;
    default:
      return attributeIssue(definition, "MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED", `${fieldName} 的属性类型不受支持`);
  }
  return {
    definitionId: definition.definitionId,
    attributeCode: definition.attributeCode,
    name: definition.name,
    dataType: definition.dataType,
    value,
    normalizedValue,
    unitCode: unit,
    sourceType: "MANUAL",
  };
}

export function validateDraftPayload(raw: unknown, metadata: CategoryMetadata, sourceFallback: Readonly<{ sourceType?: string; sourceRef?: string }> = {}): ValidatedDraft {
  const payload = objectValue(raw, "请求正文");
  assertNoIdentityFields(payload);
  assertKnownKeys(payload, TOP_LEVEL_KEYS, "请求正文");
  const categoryId = Number(payload.category_id);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0 || categoryId !== metadata.categoryId) materialFailure("MATERIAL_CATEGORY_NOT_FOUND", "物料分类不存在", 404);
  if (metadata.categoryLevel !== 4) materialFailure("MATERIAL_CATEGORY_NOT_LEAF", "只能选择启用的四级叶子分类", 422);
  const basic = basicFields(payload.basic_fields, sourceFallback);
  const attributesValue = objectValue(payload.attributes ?? {}, "attributes");
  const definitions = new Map(metadata.definitions.map((definition) => [definition.attributeCode, definition]));
  const unknown = Object.keys(attributesValue).find((code) => !definitions.has(code));
  if (unknown) materialFailure("MATERIAL_ATTRIBUTE_UNKNOWN", `属性 ${unknown} 不属于所选分类`, 422, [{ code: "MATERIAL_ATTRIBUTE_UNKNOWN", severity: "ERROR", field: `attributes.${unknown}`, attribute_code: unknown, message: "未知属性不能写入" }]);
  const issues: MaterialIssue[] = [];
  const attributes: NormalizedAttribute[] = [];
  for (const definition of metadata.definitions) {
    const rawAttribute = attributesValue[definition.attributeCode];
    if (rawAttribute === undefined || rawAttribute === null) {
      if (definition.required) issues.push(attributeIssue(definition, "MATERIAL_ATTRIBUTE_REQUIRED", `${definition.name} 必填`));
      continue;
    }
    const attribute = objectValue(rawAttribute, `attributes.${definition.attributeCode}`) as AttributeInput;
    assertKnownKeys(attribute as Record<string, unknown>, ATTRIBUTE_KEYS, `attributes.${definition.attributeCode}`);
    const normalized = normalizeAttribute(definition, attribute);
    if ("severity" in normalized) issues.push(normalized); else attributes.push(normalized);
  }
  if (issues.length) throw new MaterialWorkflowError("MATERIAL_VALIDATION_FAILED", "物料属性校验失败", 422, issues);
  return { categoryId, categoryCode: metadata.categoryCode, categoryName: metadata.categoryName, basic, attributes, issues: [] };
}
