import type { MaterialMasterD1Database } from "../material-master/index.ts";
import { MaterialImportParserServiceError } from "./parser-service.ts";

export type MaterialImportMappingTargetNamespace = "basic" | "attribute" | "category_hint" | "supplier_reference" | "ignore";
export type MaterialImportMappingTargetGroup = "BASIC" | "ATTRIBUTE" | "SPECIAL";
export type MaterialImportMappingMode = "SOURCE" | "SOURCE_WITH_DEFAULT" | "DEFAULT" | "IGNORE";
export type MaterialImportMappingValueType = "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "ENUM" | "NONE";

export type MaterialImportMappingTarget = Readonly<{
  group_code: MaterialImportMappingTargetGroup;
  target_namespace: MaterialImportMappingTargetNamespace;
  target_code: string;
  display_name: string;
  description: string;
  value_type: MaterialImportMappingValueType;
  required_for_confirm: boolean;
  mapping_modes: readonly MaterialImportMappingMode[];
  default_value_policy: Readonly<{ allowed: boolean; allowed_json_types: readonly ("STRING" | "SAFE_INTEGER" | "BOOLEAN" | "NULL")[] }>;
  unit_policy: Readonly<{ mode: "NOT_APPLICABLE" | "FORBIDDEN" | "CANONICAL"; canonical_unit: string | null; allowed_units: readonly string[] }>;
  value_constraints: Readonly<{ decimal_scale: number | null; enum_values: readonly string[]; normalization_rule: "NONE" | "TRIM_UPPER" | "DECIMAL_SCALE" | "ENUM_CODE" | "DATE_ISO" }>;
  enabled: true;
  selectable: true;
  constraints: readonly Readonly<{ code: string; message: string }>[];
  display_order: number;
}>;

export type MaterialImportMappingMetadataSnapshot = Readonly<{
  algorithm: "material-import-mapping-metadata-v1";
  targets: readonly MaterialImportMappingTarget[];
  metadataDigest: string;
  searchProjectionDigest: string;
  targetByKey: ReadonlyMap<string, MaterialImportMappingTarget>;
}>;

type AttributeDefinitionRow = {
  attribute_code: string;
  attribute_name_cn: string;
  data_type: string;
  decimal_scale: number;
  canonical_unit: string;
  allowed_values_json: string;
  normalization_rule: string;
  status: string;
  version: number;
};

const SOURCE_MODES = Object.freeze(["SOURCE", "SOURCE_WITH_DEFAULT", "DEFAULT"] as const);
const DEFAULT_ALLOWED = Object.freeze(["STRING", "SAFE_INTEGER", "BOOLEAN", "NULL"] as const);
const NO_DEFAULT = Object.freeze({ allowed: false, allowed_json_types: Object.freeze([]) });
const SCALAR_DEFAULT = Object.freeze({ allowed: true, allowed_json_types: DEFAULT_ALLOWED });
const STATIC_UNIT = Object.freeze({ mode: "NOT_APPLICABLE" as const, canonical_unit: null, allowed_units: Object.freeze([]) });
const NO_VALUE_CONSTRAINTS = Object.freeze({ decimal_scale: null, enum_values: Object.freeze([]), normalization_rule: "NONE" as const });

function staticTarget(
  group: "BASIC" | "SPECIAL",
  namespace: Exclude<MaterialImportMappingTargetNamespace, "attribute">,
  code: string,
  name: string,
  valueType: MaterialImportMappingValueType,
  order: number,
  requiredForConfirm = false,
  constraints: readonly Readonly<{ code: string; message: string }>[] = [],
  enumValues: readonly string[] = [],
): MaterialImportMappingTarget {
  const ignore = namespace === "ignore";
  return Object.freeze({
    group_code: group,
    target_namespace: namespace,
    target_code: code,
    display_name: name,
    description: "",
    value_type: valueType,
    required_for_confirm: requiredForConfirm,
    mapping_modes: ignore ? Object.freeze(["IGNORE"] as const) : SOURCE_MODES,
    default_value_policy: ignore ? NO_DEFAULT : SCALAR_DEFAULT,
    unit_policy: STATIC_UNIT,
    value_constraints: enumValues.length ? Object.freeze({ decimal_scale: null, enum_values: Object.freeze([...enumValues]), normalization_rule: "ENUM_CODE" as const }) : NO_VALUE_CONSTRAINTS,
    enabled: true,
    selectable: true,
    constraints: Object.freeze([...constraints]),
    display_order: order,
  });
}

const STATIC_TARGETS = Object.freeze([
  staticTarget("BASIC", "basic", "STANDARD_NAME", "标准名称", "TEXT", 10, true, [{ code: "NON_EMPTY_TEXT", message: "确认前必须映射非空标准名称" }]),
  staticTarget("BASIC", "basic", "UNIT", "基本单位", "TEXT", 20, true, [{ code: "NON_EMPTY_UNIT_CODE", message: "确认前必须映射非空单位 code" }]),
  staticTarget("BASIC", "basic", "BRAND", "品牌", "TEXT", 30),
  staticTarget("BASIC", "basic", "MANUFACTURER", "制造商", "TEXT", 40),
  staticTarget("BASIC", "basic", "MANUFACTURER_PART_NUMBER", "制造商料号", "TEXT", 50),
  staticTarget("BASIC", "basic", "PURCHASE_TYPE", "采购类型", "ENUM", 60, false, [{ code: "ENUM_VALUES", message: "PURCHASE, OUTSOURCE, SELF_MADE, NON_PURCHASABLE" }], ["PURCHASE", "OUTSOURCE", "SELF_MADE", "NON_PURCHASABLE"]),
  staticTarget("BASIC", "basic", "INVENTORY_TYPE", "库存类型", "ENUM", 70, false, [{ code: "ENUM_VALUES", message: "STOCKED, NON_STOCKED, CONSIGNMENT" }], ["STOCKED", "NON_STOCKED", "CONSIGNMENT"]),
  staticTarget("BASIC", "basic", "LOT_CONTROL", "批次控制", "BOOLEAN", 80),
  staticTarget("BASIC", "basic", "SHELF_LIFE_DAYS", "保质期天数", "INTEGER", 90, false, [{ code: "NON_NEGATIVE_SAFE_INTEGER", message: "必须为非负安全整数" }]),
  staticTarget("BASIC", "basic", "INSPECTION_TYPE", "检验类型", "ENUM", 100, false, [{ code: "ENUM_VALUES", message: "NONE, NORMAL, TIGHTENED, REDUCED, FULL" }], ["NONE", "NORMAL", "TIGHTENED", "REDUCED", "FULL"]),
  staticTarget("BASIC", "basic", "ENVIRONMENTAL_REQUIREMENT", "环保要求", "ENUM", 110, false, [{ code: "ENUM_VALUES", message: "UNSPECIFIED, ROHS, ROHS_REACH, HALOGEN_FREE, CUSTOMER_SPECIFIC" }], ["UNSPECIFIED", "ROHS", "ROHS_REACH", "HALOGEN_FREE", "CUSTOMER_SPECIFIC"]),
  staticTarget("SPECIAL", "category_hint", "CATEGORY_HINT", "分类提示", "TEXT", 10),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_NAME", "供应商名称", "TEXT", 20),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_ITEM_CODE", "供应商料号", "TEXT", 30),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_ITEM_NAME", "供应商物料名称", "TEXT", 40),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_SPECIFICATION", "供应商规格", "TEXT", 50),
  staticTarget("SPECIAL", "supplier_reference", "PURCHASE_UOM", "采购单位", "TEXT", 60),
  staticTarget("SPECIAL", "ignore", "IGNORE", "明确忽略", "NONE", 70),
]);

export const BASIC_TARGETS = Object.freeze(STATIC_TARGETS.filter((target) => target.target_namespace === "basic").map((target) => target.target_code));
export const SUPPLIER_TARGETS = Object.freeze(STATIC_TARGETS.filter((target) => target.target_namespace === "supplier_reference").map((target) => target.target_code));

function key(namespace: MaterialImportMappingTargetNamespace, code: string): string {
  return `${namespace}\u0000${code}`;
}

function compareTargets(left: MaterialImportMappingTarget, right: MaterialImportMappingTarget): number {
  const rank = { BASIC: 10, ATTRIBUTE: 20, SPECIAL: 30 } as const;
  return rank[left.group_code] - rank[right.group_code]
    || left.display_order - right.display_order
    || left.target_namespace.localeCompare(right.target_namespace, "en")
    || left.target_code.localeCompare(right.target_code, "en");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right, "en")).map(([name, nested]) => [name, canonical(nested)]));
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export async function sha256Text(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSafeText(value: string, field: string, minimum: number, maximum: number): string {
  const normalized = value.normalize("NFC");
  if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", `${field} 元数据无效`, 503);
  return normalized;
}

function parseEnumValues(row: AttributeDefinitionRow): readonly string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(row.allowed_values_json); } catch { throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性枚举元数据无效", 503); }
  if (!Array.isArray(parsed) || parsed.length > 200 || parsed.some((item) => typeof item !== "string" || item.length < 1 || item.length > 128 || /[\u0000-\u001f\u007f]/.test(item))) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性枚举元数据无效", 503);
  const values = parsed.map((item) => item.normalize("NFC"));
  if (new Set(values).size !== values.length) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性枚举元数据重复", 503);
  return Object.freeze([...values].sort((left, right) => left.localeCompare(right, "en")));
}

function attributeTarget(row: AttributeDefinitionRow, order: number): MaterialImportMappingTarget {
  if (!/^[A-Z][A-Z0-9_]*$/.test(row.attribute_code) || row.attribute_code.length > 128) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性 code 元数据无效", 503);
  const valueTypes = new Set<MaterialImportMappingValueType>(["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "ENUM"]);
  const valueType = row.data_type as MaterialImportMappingValueType;
  if (!valueTypes.has(valueType) || !Number.isInteger(row.decimal_scale) || row.decimal_scale < 0 || row.decimal_scale > 9 || !Number.isInteger(row.version) || row.version < 1) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性类型元数据无效", 503);
  const rules = new Set(["NONE", "TRIM_UPPER", "DECIMAL_SCALE", "ENUM_CODE", "DATE_ISO"] as const);
  const normalizationRule = row.normalization_rule as MaterialImportMappingTarget["value_constraints"]["normalization_rule"];
  if (!rules.has(normalizationRule)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性规范化元数据无效", 503);
  const canonicalUnit = row.canonical_unit ? assertSafeText(row.canonical_unit, "属性单位", 1, 64) : null;
  const declaredEnumValues = parseEnumValues(row);
  if (valueType !== "ENUM" && declaredEnumValues.length) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "非枚举属性包含枚举值", 503);
  const enumValues = valueType === "ENUM" ? declaredEnumValues : Object.freeze([]);
  return Object.freeze({
    group_code: "ATTRIBUTE",
    target_namespace: "attribute",
    target_code: row.attribute_code,
    display_name: assertSafeText(row.attribute_name_cn, "属性名称", 1, 200),
    description: "",
    value_type: valueType,
    required_for_confirm: false,
    mapping_modes: SOURCE_MODES,
    default_value_policy: SCALAR_DEFAULT,
    unit_policy: Object.freeze({ mode: canonicalUnit ? "CANONICAL" : "FORBIDDEN", canonical_unit: canonicalUnit, allowed_units: Object.freeze(canonicalUnit ? [canonicalUnit] : []) }),
    value_constraints: Object.freeze({ decimal_scale: valueType === "DECIMAL" ? row.decimal_scale : null, enum_values: enumValues, normalization_rule: normalizationRule }),
    enabled: true,
    selectable: true,
    constraints: Object.freeze([]),
    display_order: order,
  });
}

function mappingSemanticProjection(target: MaterialImportMappingTarget): Record<string, unknown> {
  return {
    target_namespace: target.target_namespace,
    target_code: target.target_code,
    group_code: target.group_code,
    enabled: target.enabled,
    selectable: target.selectable,
    value_type: target.value_type,
    required_for_confirm: target.required_for_confirm,
    mapping_modes: target.mapping_modes,
    default_value_policy: target.default_value_policy,
    unit_policy: target.unit_policy,
    value_constraints: target.value_constraints,
    constraints: target.constraints.map((constraint) => constraint.code),
  };
}

export class MaterialImportMappingMetadataRepository {
  readonly #database: MaterialMasterD1Database;
  constructor(database: MaterialMasterD1Database) { this.#database = database; }
  async listActiveAttributes(): Promise<readonly AttributeDefinitionRow[]> {
    try {
      const result = await this.#database.prepare(`SELECT attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values_json,normalization_rule,status,version FROM material_attribute_definitions WHERE status='ACTIVE' ORDER BY attribute_code`).all<AttributeDefinitionRow>();
      return result.results ?? [];
    } catch {
      throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "Mapping 目标元数据暂不可用", 503);
    }
  }
}

export class MaterialImportMappingTargetRegistry {
  staticTargets(): readonly MaterialImportMappingTarget[] { return STATIC_TARGETS; }
  buildTargets(attributes: readonly AttributeDefinitionRow[]): readonly MaterialImportMappingTarget[] {
    const codes = new Set<string>();
    const dynamic = [...attributes].sort((left, right) => left.attribute_code.localeCompare(right.attribute_code, "en")).map((row, index) => {
      if (row.status !== "ACTIVE" || codes.has(row.attribute_code)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性目标元数据无效", 503);
      codes.add(row.attribute_code);
      return attributeTarget(row, index + 1);
    });
    return Object.freeze([...STATIC_TARGETS, ...dynamic].sort(compareTargets));
  }
}

export class MaterialImportMappingMetadataSnapshotService {
  readonly #repository: MaterialImportMappingMetadataRepository;
  readonly #registry: MaterialImportMappingTargetRegistry;
  constructor(database: MaterialMasterD1Database, registry = new MaterialImportMappingTargetRegistry()) {
    this.#repository = new MaterialImportMappingMetadataRepository(database);
    this.#registry = registry;
  }
  async current(): Promise<MaterialImportMappingMetadataSnapshot> {
    const targets = this.#registry.buildTargets(await this.#repository.listActiveAttributes());
    const metadataDigest = await sha256Text(canonicalJson({ algorithm: "material-import-mapping-metadata-v1", targets: targets.map(mappingSemanticProjection) }));
    const searchProjectionDigest = await sha256Text(canonicalJson(targets.map((target) => ({ group_code: target.group_code, target_namespace: target.target_namespace, target_code: target.target_code, display_name: target.display_name, description: target.description, display_order: target.display_order }))));
    return Object.freeze({ algorithm: "material-import-mapping-metadata-v1", targets, metadataDigest, searchProjectionDigest, targetByKey: new Map(targets.map((target) => [key(target.target_namespace, target.target_code), target])) });
  }
  lookup(snapshot: MaterialImportMappingMetadataSnapshot, namespace: MaterialImportMappingTargetNamespace, code: string): MaterialImportMappingTarget | undefined {
    return snapshot.targetByKey.get(key(namespace, code));
  }
}

export function requiredMappingTargets(snapshot: MaterialImportMappingMetadataSnapshot): readonly MaterialImportMappingTarget[] {
  return snapshot.targets.filter((target) => target.required_for_confirm);
}
