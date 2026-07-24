import type { Pool, PoolClient } from "pg";
import { mappingFailure } from "./errors.ts";
import { canonicalJson, sha256 } from "./rules.ts";
import type { MappingCatalogSnapshot, MappingTarget, MappingTargetNamespace } from "./types.ts";

type Queryable = Pick<Pool | PoolClient, "query">;
type AttributeRow = {
  attribute_code: string;
  attribute_name_cn: string;
  data_type: string;
  decimal_scale: number;
  canonical_unit: string;
  allowed_values: unknown;
  normalization_rule: string;
  categories: unknown;
};

const SOURCE_MODES = Object.freeze(["SOURCE", "SOURCE_WITH_DEFAULT", "DEFAULT"] as const);
const SCALAR_DEFAULT = Object.freeze({ allowed: true, allowed_json_types: Object.freeze(["STRING", "SAFE_INTEGER", "BOOLEAN", "NULL"]) });
const NO_DEFAULT = Object.freeze({ allowed: false, allowed_json_types: Object.freeze([]) });
const NO_UNIT = Object.freeze({ mode: "NOT_APPLICABLE" as const, canonical_unit: null, allowed_units: Object.freeze([]) });
const NO_CONSTRAINTS = Object.freeze({ decimal_scale: null, enum_values: Object.freeze([]), normalization_rule: "NONE" });

function staticTarget(
  group: "BASIC" | "SPECIAL",
  namespace: Exclude<MappingTargetNamespace, "attribute">,
  code: string,
  name: string,
  valueType: MappingTarget["value_type"],
  order: number,
  required = false,
  constraints: readonly Readonly<{ code: string; message: string }>[] = [],
  enumValues: readonly string[] = [],
): MappingTarget {
  const ignore = namespace === "ignore";
  return Object.freeze({
    group_code: group,
    target_namespace: namespace,
    target_code: code,
    display_name: name,
    description: "",
    value_type: valueType,
    required_for_confirm: required,
    mapping_modes: ignore ? Object.freeze(["IGNORE"] as const) : SOURCE_MODES,
    default_value_policy: ignore ? NO_DEFAULT : SCALAR_DEFAULT,
    unit_policy: NO_UNIT,
    value_constraints: enumValues.length ? Object.freeze({ decimal_scale: null, enum_values: Object.freeze([...enumValues]), normalization_rule: "ENUM_CODE" }) : NO_CONSTRAINTS,
    categories: Object.freeze([]),
    enabled: true,
    selectable: true,
    repeatable: namespace === "ignore",
    constraints: Object.freeze([...constraints]),
    display_order: order,
  });
}

const STATIC_TARGETS = Object.freeze([
  staticTarget("BASIC", "basic", "STANDARD_NAME", "标准名称", "TEXT", 10, true, [{ code: "NON_EMPTY_TEXT", message: "确认前必须映射非空标准名称" }]),
  staticTarget("BASIC", "basic", "SPECIFICATION_MODEL", "规格/型号", "TEXT", 20),
  staticTarget("BASIC", "basic", "UNIT", "基本单位", "TEXT", 30, true, [{ code: "NON_EMPTY_UNIT_CODE", message: "确认前必须映射非空单位 code" }]),
  staticTarget("BASIC", "basic", "BRAND", "品牌", "TEXT", 40),
  staticTarget("BASIC", "basic", "MANUFACTURER", "制造商", "TEXT", 50),
  staticTarget("BASIC", "basic", "MANUFACTURER_PART_NUMBER", "制造商料号", "TEXT", 60),
  staticTarget("BASIC", "basic", "DESCRIPTION", "描述/备注", "TEXT", 70),
  staticTarget("BASIC", "basic", "SOURCE_FIELD", "来源字段", "TEXT", 80),
  staticTarget("BASIC", "basic", "PURCHASE_TYPE", "采购类型", "ENUM", 90, false, [{ code: "ENUM_VALUES", message: "PURCHASE, OUTSOURCE, SELF_MADE, NON_PURCHASABLE" }], ["PURCHASE", "OUTSOURCE", "SELF_MADE", "NON_PURCHASABLE"]),
  staticTarget("BASIC", "basic", "INVENTORY_TYPE", "库存类型", "ENUM", 100, false, [{ code: "ENUM_VALUES", message: "STOCKED, NON_STOCKED, CONSIGNMENT" }], ["STOCKED", "NON_STOCKED", "CONSIGNMENT"]),
  staticTarget("BASIC", "basic", "LOT_CONTROL", "批次控制", "BOOLEAN", 110),
  staticTarget("BASIC", "basic", "SHELF_LIFE_DAYS", "保质期天数", "INTEGER", 120),
  staticTarget("BASIC", "basic", "INSPECTION_TYPE", "检验类型", "ENUM", 130, false, [], ["NONE", "NORMAL", "TIGHTENED", "REDUCED", "FULL"]),
  staticTarget("BASIC", "basic", "ENVIRONMENTAL_REQUIREMENT", "环保要求", "ENUM", 140, false, [], ["UNSPECIFIED", "ROHS", "ROHS_REACH", "HALOGEN_FREE", "CUSTOMER_SPECIFIC"]),
  staticTarget("SPECIAL", "category_hint", "CATEGORY_HINT", "分类提示", "TEXT", 10),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_NAME", "供应商名称", "TEXT", 20),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_ITEM_CODE", "供应商料号", "TEXT", 30),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_ITEM_NAME", "供应商物料名称", "TEXT", 40),
  staticTarget("SPECIAL", "supplier_reference", "SUPPLIER_SPECIFICATION", "供应商规格", "TEXT", 50),
  staticTarget("SPECIAL", "supplier_reference", "PURCHASE_UOM", "采购单位", "TEXT", 60),
  staticTarget("SPECIAL", "ignore", "IGNORE", "明确忽略", "NONE", 70),
]);

function safeString(value: unknown, field: string, maximum = 200): string {
  const text = String(value ?? "").normalize("NFC");
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", `${field} 元数据无效`, 503);
  return text;
}

function arrayOfStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some((item) => typeof item !== "string" || !item || item.length > 128)) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性枚举元数据无效", 503);
  const values = value.map((item) => item.normalize("NFC"));
  if (new Set(values).size !== values.length) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性枚举元数据重复", 503);
  return Object.freeze([...values].sort((left, right) => left.localeCompare(right, "en")));
}

function attributeTarget(row: AttributeRow, order: number): MappingTarget {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(row.attribute_code)) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性稳定 code 无效", 503);
  const valueTypes = new Set(["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "ENUM"]);
  if (!valueTypes.has(row.data_type) || !Number.isInteger(row.decimal_scale) || row.decimal_scale < 0 || row.decimal_scale > 9) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性类型元数据无效", 503);
  const enumValues = arrayOfStrings(row.allowed_values);
  if (row.data_type !== "ENUM" && enumValues.length) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "非枚举属性包含枚举值", 503);
  const categories = Array.isArray(row.categories) ? row.categories.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "属性分类绑定无效", 503);
    const item = value as Record<string, unknown>;
    return Object.freeze({ category_code: safeString(item.category_code, "分类 code", 128), category_name: safeString(item.category_name, "分类名称"), required: Boolean(item.required) });
  }) : [];
  const canonicalUnit = row.canonical_unit ? safeString(row.canonical_unit, "属性单位", 64) : null;
  return Object.freeze({
    group_code: "ATTRIBUTE",
    target_namespace: "attribute",
    target_code: row.attribute_code,
    display_name: safeString(row.attribute_name_cn, "属性名称"),
    description: "",
    value_type: row.data_type as MappingTarget["value_type"],
    required_for_confirm: false,
    mapping_modes: SOURCE_MODES,
    default_value_policy: SCALAR_DEFAULT,
    unit_policy: Object.freeze({ mode: canonicalUnit ? "CANONICAL" as const : "FORBIDDEN" as const, canonical_unit: canonicalUnit, allowed_units: Object.freeze(canonicalUnit ? [canonicalUnit] : []) }),
    value_constraints: Object.freeze({ decimal_scale: row.data_type === "DECIMAL" ? row.decimal_scale : null, enum_values: row.data_type === "ENUM" ? enumValues : Object.freeze([]), normalization_rule: row.normalization_rule }),
    categories: Object.freeze(categories),
    enabled: true,
    selectable: true,
    repeatable: false,
    constraints: Object.freeze([]),
    display_order: order,
  });
}

export function mappingTargetSemanticProjection(target: MappingTarget): Record<string, unknown> {
  return {
    group_code: target.group_code,
    target_namespace: target.target_namespace,
    target_code: target.target_code,
    value_type: target.value_type,
    required_for_confirm: target.required_for_confirm,
    mapping_modes: target.mapping_modes,
    default_value_policy: target.default_value_policy,
    unit_policy: target.unit_policy,
    value_constraints: target.value_constraints,
    categories: target.categories.map((category) => ({ category_code: category.category_code, required: category.required })),
    repeatable: target.repeatable,
    constraints: target.constraints.map((constraint) => constraint.code),
  };
}

function compareTargets(left: MappingTarget, right: MappingTarget): number {
  const rank = { BASIC: 10, ATTRIBUTE: 20, SPECIAL: 30 };
  return rank[left.group_code] - rank[right.group_code] || left.display_order - right.display_order || `${left.target_namespace}.${left.target_code}`.localeCompare(`${right.target_namespace}.${right.target_code}`, "en");
}

export class PostgresMappingCatalog {
  readonly #database: Queryable;

  constructor(database: Queryable) {
    this.#database = database;
  }

  async snapshot(): Promise<MappingCatalogSnapshot> {
    let rows: AttributeRow[];
    try {
      const result = await this.#database.query<AttributeRow>(`
        select
          d.attribute_code,d.attribute_name_cn,d.data_type,d.decimal_scale,d.canonical_unit,
          d.allowed_values,d.normalization_rule,
          coalesce(jsonb_agg(
            jsonb_build_object(
              'category_code',c.category_code,
              'category_name',c.category_name_cn,
              'required',b.is_required
            ) order by c.category_code
          ) filter (where c.id is not null),'[]'::jsonb) categories
        from material_attribute_definitions d
        left join material_category_attributes b
          on b.attribute_definition_id=d.id and b.status='ACTIVE'
        left join material_categories c
          on c.id=b.category_id and c.status='ACTIVE'
        where d.status='ACTIVE'
        group by d.id,d.attribute_code,d.attribute_name_cn,d.data_type,d.decimal_scale,d.canonical_unit,d.allowed_values,d.normalization_rule
        order by d.attribute_code
      `);
      rows = result.rows;
    } catch {
      mappingFailure("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "Mapping 目标元数据暂不可用", 503);
    }
    const dynamic = rows.map((row, index) => attributeTarget(row, index + 1));
    const targets = Object.freeze([...STATIC_TARGETS, ...dynamic].sort(compareTargets));
    const metadataDigest = sha256(canonicalJson({ algorithm: "material-import-mapping-metadata-v1", targets: targets.map(mappingTargetSemanticProjection) }));
    return Object.freeze({
      algorithm: "material-import-mapping-metadata-v1",
      targets,
      metadataDigest,
      targetByKey: new Map(targets.map((target) => [`${target.target_namespace}\u0000${target.target_code}`, target])),
    });
  }
}
