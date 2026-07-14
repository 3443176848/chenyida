export type DraftBasicFields = {
  standard_name: string;
  unit: string;
  brand: string;
  manufacturer: string;
  manufacturer_part_number: string;
  procurement_type: string;
  inventory_type: string;
  lot_control_required: boolean | null;
  shelf_life_days: string;
  inspection_type: string;
  environmental_requirement: string;
};

export type DraftAttributeValue = { value: string | boolean | null; unit: string };
export type DraftForm = {
  basic_fields: DraftBasicFields;
  category_id: number | null;
  attributes: Record<string, DraftAttributeValue>;
};

export type AttributeSchema = {
  attribute_code: string;
  name: string;
  description?: string;
  data_type: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "ENUM";
  required: boolean;
  standard_unit: string;
  compatible_units: string[];
  enum_options: { code: string; label: string }[];
  display_order: number;
  enabled: boolean;
  input_contract: { decimal_scale: number | null; unit_mode: "REQUIRED" | "FORBIDDEN" };
};

export type CategorySchema = {
  category_id: number;
  category_name: string;
  category_path: string;
  schema_version: string;
  attributes: AttributeSchema[];
};

export type DraftIssue = {
  source: "LOCAL" | "SERVER";
  code: string;
  severity: "ERROR" | "WARNING";
  field: string;
  attribute_code?: string;
  message: string;
};

export const EMPTY_DRAFT: DraftForm = {
  basic_fields: {
    standard_name: "", unit: "", brand: "", manufacturer: "", manufacturer_part_number: "",
    procurement_type: "", inventory_type: "", lot_control_required: null, shelf_life_days: "",
    inspection_type: "", environmental_requirement: "",
  },
  category_id: null,
  attributes: {},
};

const INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function strictInteger(value: string): number | null {
  if (!INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function strictDecimal(value: string, scale: number | null): number | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const fraction = value.split(".")[1] || "";
  if (scale !== null && fraction.length > scale) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function normalizeDraft(form: DraftForm): DraftForm {
  return stableValue({
    basic_fields: { ...form.basic_fields },
    category_id: form.category_id,
    attributes: Object.fromEntries(Object.entries(form.attributes).sort(([left], [right]) => left.localeCompare(right))),
  }) as DraftForm;
}

export function isDraftDirty(serverSnapshot: DraftForm | null, formDraft: DraftForm): boolean {
  if (!serverSnapshot) return stableStringify(normalizeDraft(formDraft)) !== stableStringify(EMPTY_DRAFT);
  return stableStringify(normalizeDraft(serverSnapshot)) !== stableStringify(normalizeDraft(formDraft));
}

function fieldIssue(field: string, message: string): DraftIssue {
  return { source: "LOCAL", code: "LOCAL_REQUIRED", severity: "ERROR", field, message };
}

export function serializeDraft(form: DraftForm, schema: CategorySchema | null): {
  basic_fields: Record<string, unknown>;
  category_id: number | null;
  attributes: Record<string, { value: unknown; unit?: string; source: "MANUAL"; confidence: 1 }>;
  issues: DraftIssue[];
} {
  const issues: DraftIssue[] = [];
  const basic = form.basic_fields;
  for (const [field, label] of [
    ["standard_name", "标准名称"], ["unit", "基本单位"], ["procurement_type", "采购类型"],
    ["inventory_type", "库存类型"], ["inspection_type", "检验类型"],
    ["environmental_requirement", "环保要求"],
  ] as const) if (!String(basic[field]).trim()) issues.push(fieldIssue(`basic_fields.${field}`, `${label}必填`));
  for (const [field, maximum, label] of [
    ["standard_name", 200, "标准名称"], ["unit", 32, "基本单位"], ["brand", 200, "品牌"],
    ["manufacturer", 200, "制造商"], ["manufacturer_part_number", 200, "制造商型号"],
  ] as const) {
    const text = String(basic[field]);
    if (text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
      issues.push({ source: "LOCAL", code: "LOCAL_TEXT_INVALID", severity: "ERROR", field: `basic_fields.${field}`, message: `${label}长度或字符无效` });
    }
  }
  if (basic.lot_control_required === null) issues.push(fieldIssue("basic_fields.lot_control_required", "请选择是否启用批次控制"));
  let shelfLife: number | null = null;
  if (basic.shelf_life_days !== "") {
    shelfLife = strictInteger(basic.shelf_life_days);
    if (shelfLife === null || shelfLife < 0) issues.push({ ...fieldIssue("basic_fields.shelf_life_days", "保质期天数必须是非负安全整数"), code: "LOCAL_INTEGER_INVALID" });
  }
  if (!form.category_id || !schema || schema.category_id !== form.category_id) {
    issues.push(fieldIssue("category_id", "请选择启用的四级叶子分类并等待属性 Schema 加载完成"));
  }

  const attributes: Record<string, { value: unknown; unit?: string; source: "MANUAL"; confidence: 1 }> = {};
  for (const definition of (schema?.attributes || []).filter((item) => item.enabled)) {
    const entry = form.attributes[definition.attribute_code] || { value: null, unit: "" };
    const raw = entry.value;
    const empty = raw === null || raw === "";
    const field = `attributes.${definition.attribute_code}`;
    if (empty) {
      if (definition.required) issues.push({ ...fieldIssue(field, `${definition.name}必填`), attribute_code: definition.attribute_code });
      continue;
    }
    let value: unknown = raw;
    if (definition.data_type === "TEXT" && String(raw).length > 1000) {
      issues.push({ source: "LOCAL", code: "LOCAL_TEXT_INVALID", severity: "ERROR", field, attribute_code: definition.attribute_code, message: `${definition.name}最多 1000 字符` });
    }
    if (definition.data_type === "INTEGER") {
      value = strictInteger(String(raw));
      if (value === null) issues.push({ source: "LOCAL", code: "LOCAL_INTEGER_INVALID", severity: "ERROR", field, attribute_code: definition.attribute_code, message: `${definition.name}必须是安全整数` });
    } else if (definition.data_type === "DECIMAL") {
      value = strictDecimal(String(raw), definition.input_contract.decimal_scale);
      if (value === null) issues.push({ source: "LOCAL", code: "LOCAL_DECIMAL_INVALID", severity: "ERROR", field, attribute_code: definition.attribute_code, message: `${definition.name}不是合法的小数或超过允许精度` });
    } else if (definition.data_type === "BOOLEAN") {
      if (typeof raw !== "boolean") issues.push({ source: "LOCAL", code: "LOCAL_BOOLEAN_REQUIRED", severity: "ERROR", field, attribute_code: definition.attribute_code, message: `${definition.name}必须明确选择是或否` });
    } else if (definition.data_type === "ENUM") {
      if (!definition.enum_options.some((option) => option.code === raw)) issues.push({ source: "LOCAL", code: "LOCAL_ENUM_INVALID", severity: "ERROR", field, attribute_code: definition.attribute_code, message: `${definition.name}的选项无效` });
    }
    const unitAllowed = definition.compatible_units.includes(entry.unit);
    if (definition.input_contract.unit_mode === "REQUIRED" && !unitAllowed) {
      issues.push({ source: "LOCAL", code: "LOCAL_UNIT_REQUIRED", severity: "ERROR", field, attribute_code: definition.attribute_code, message: `${definition.name}必须选择兼容单位` });
    }
    if (value !== null && !issues.some((issue) => issue.field === field)) {
      attributes[definition.attribute_code] = {
        value,
        ...(definition.input_contract.unit_mode === "REQUIRED" ? { unit: entry.unit } : {}),
        source: "MANUAL",
        confidence: 1,
      };
    }
  }
  return {
    basic_fields: {
      standard_name: basic.standard_name.trim(), unit: basic.unit.trim(), brand: basic.brand.trim(),
      manufacturer: basic.manufacturer.trim(), manufacturer_part_number: basic.manufacturer_part_number.trim(),
      procurement_type: basic.procurement_type, inventory_type: basic.inventory_type,
      lot_control_required: basic.lot_control_required ?? false, shelf_life_days: shelfLife,
      inspection_type: basic.inspection_type, environmental_requirement: basic.environmental_requirement,
    },
    category_id: form.category_id,
    attributes,
    issues,
  };
}

export function draftFromDetail(detail: {
  material: Record<string, unknown>;
  attributes: { attribute_code: string; value: unknown; unit?: string }[];
}): DraftForm {
  const material = detail.material;
  return {
    basic_fields: {
      standard_name: String(material.standard_name || ""), unit: String(material.unit || ""),
      brand: String(material.brand || ""), manufacturer: String(material.manufacturer || ""),
      manufacturer_part_number: String(material.manufacturer_part_number || ""),
      procurement_type: String(material.procurement_type || ""), inventory_type: String(material.inventory_type || ""),
      lot_control_required: typeof material.lot_control_required === "boolean" ? material.lot_control_required : null,
      shelf_life_days: material.shelf_life_days === null || material.shelf_life_days === undefined ? "" : String(material.shelf_life_days),
      inspection_type: String(material.inspection_type || ""), environmental_requirement: String(material.environmental_requirement || ""),
    },
    category_id: Number.isSafeInteger(material.category_id) ? Number(material.category_id) : null,
    attributes: Object.fromEntries((detail.attributes || []).map((attribute) => [attribute.attribute_code, {
      value: typeof attribute.value === "boolean" ? attribute.value : attribute.value === null || attribute.value === undefined ? "" : String(attribute.value),
      unit: String(attribute.unit || ""),
    }])),
  };
}

export function unknownAttributeCodes(form: DraftForm, schema: CategorySchema | null): string[] {
  const allowed = new Set((schema?.attributes || []).filter((item) => item.enabled).map((item) => item.attribute_code));
  return Object.keys(form.attributes).filter((code) => !allowed.has(code)).sort();
}

export function canCreateDraft(permissions: readonly string[]): boolean {
  return permissions.includes("material.draft.create");
}

export function canEditDraft(permissions: readonly string[], username: string, createdBy: unknown): boolean {
  return permissions.includes("material.draft.edit_any")
    || (permissions.includes("material.draft.edit_own") && username !== "" && username === String(createdBy || ""));
}

export function canSubmitDraft(permissions: readonly string[], username: string, createdBy: unknown): boolean {
  return permissions.includes("material.draft.submit") && canEditDraft(permissions, username, createdBy);
}

export type WriteOperation = {
  key: string;
  method: "POST" | "PATCH";
  endpoint: string;
  payloadDigest: string;
  payload: Readonly<Record<string, unknown>>;
  type: "CREATE" | "SAVE" | "SUBMIT";
  state: "PENDING" | "RESULT_UNKNOWN" | "SUCCEEDED" | "FAILED";
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function createWriteOperation(input: Omit<WriteOperation, "payloadDigest" | "payload" | "state"> & { payload: Record<string, unknown> }): WriteOperation {
  const snapshot = deepFreeze(JSON.parse(JSON.stringify(input.payload)) as Record<string, unknown>);
  return Object.freeze({ ...input, payload: snapshot, payloadDigest: stableStringify(snapshot), state: "PENDING" });
}

export function sameWriteRequest(operation: WriteOperation, method: string, endpoint: string, payload: unknown): boolean {
  return operation.method === method && operation.endpoint === endpoint && operation.payloadDigest === stableStringify(payload);
}

export function warningConfirmationFingerprint(materialId: number, version: number, schemaVersion: string, issues: DraftIssue[]): string {
  return stableStringify({ materialId, version, schemaVersion, issues: issues.map(({ code, severity, field, attribute_code }) => ({ code, severity, field, attribute_code })) });
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? 0 : Math.max(0, Math.ceil((date - now) / 1000));
}
