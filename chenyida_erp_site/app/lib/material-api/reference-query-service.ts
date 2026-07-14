import type { MaterialMasterD1Database } from "../material-master/index.ts";
import {
  compatibleMaterialUnits,
  MATERIAL_UNIT_POLICY_VERSION,
} from "../material-validation/index.ts";

type Row = Record<string, unknown>;

export class MaterialReferenceQueryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MaterialReferenceQueryError";
    this.code = code;
    this.status = status;
  }
}

export type CategoryNode = {
  category_id: number;
  code: string;
  name: string;
  level: number;
  parent_id: number | null;
  full_path: string;
  enabled: true;
  is_leaf: boolean;
  display_order: number;
  children: CategoryNode[];
};

export type CategorySchemaProjectionInput = Readonly<{
  attributeCode: string;
  name: string;
  description?: string;
  dataType: string;
  required: boolean;
  canonicalUnit: string;
  decimalScale: number;
  allowedValuesJson: string;
  enumLabels?: Readonly<Record<string, string>>;
  displayOrder: number;
}>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function digest(value: unknown): Promise<{ hex: string; base64url: string }> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value))));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { hex, base64url: btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") };
}

function resultRows<T>(result: { results?: T[] | null } | undefined): T[] {
  return result?.results ?? [];
}

function referenceFailure(code = "CATEGORY_SCHEMA_INVALID"): never {
  throw new MaterialReferenceQueryError(code, code === "CATEGORY_TREE_INVALID" ? "物料分类树暂时不可用" : "物料分类属性规则暂时不可用", 500);
}

function parseEnumOptions(input: CategorySchemaProjectionInput): Array<{ code: string; label: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.allowedValuesJson);
  } catch {
    return referenceFailure();
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((code) => typeof code === "string" && code.length > 0)) {
    return referenceFailure();
  }
  if (new Set(parsed).size !== parsed.length) return referenceFailure();
  return parsed.map((code) => ({ code, label: input.enumLabels?.[code] || code }));
}

export function projectCategoryAttributeSchema(input: CategorySchemaProjectionInput): Record<string, unknown> {
  const type = input.dataType;
  if (!["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "ENUM"].includes(type)) return referenceFailure();
  if (!Number.isInteger(input.decimalScale) || input.decimalScale < 0 || input.decimalScale > 9) return referenceFailure();
  const numeric = type === "INTEGER" || type === "DECIMAL";
  if (!numeric && input.canonicalUnit) return referenceFailure();
  const enumOptions = type === "ENUM" ? parseEnumOptions(input) : [];
  if (type !== "ENUM") {
    try {
      const allowed = JSON.parse(input.allowedValuesJson);
      if (!Array.isArray(allowed) || allowed.length !== 0) return referenceFailure();
    } catch {
      return referenceFailure();
    }
  }
  const inputContract = {
    TEXT: { json_type: "string", control: "text" },
    INTEGER: { json_type: "integer", control: "integer" },
    DECIMAL: { json_type: "number", control: "decimal" },
    BOOLEAN: { json_type: "boolean", control: "checkbox" },
    ENUM: { json_type: "string", control: "select" },
  }[type] as { json_type: string; control: string };
  return {
    attribute_code: input.attributeCode,
    name: input.name,
    description: input.description ?? "",
    data_type: type,
    required: input.required,
    standard_unit: input.canonicalUnit,
    compatible_units: compatibleMaterialUnits(input.canonicalUnit),
    enum_options: enumOptions,
    display_order: input.displayOrder,
    enabled: true,
    input_contract: {
      ...inputContract,
      unit_mode: input.canonicalUnit ? "REQUIRED" : "FORBIDDEN",
      decimal_scale: type === "DECIMAL" ? input.decimalScale : null,
    },
  };
}

export interface MaterialReferenceQueryService {
  listCategories(view: "tree" | "flat"): Promise<{ data: CategoryNode[]; etag: string }>;
  getCategorySchema(categoryId: number): Promise<{ data: Record<string, unknown>; etag: string }>;
}

export function createMaterialReferenceQueryService(database: MaterialMasterD1Database): MaterialReferenceQueryService {
  const loadTree = async (): Promise<{ tree: CategoryNode[]; flat: CategoryNode[] }> => {
    const result = await database.prepare(`
      SELECT id, category_code, category_name_cn, parent_id, category_level, status, sort_order
      FROM material_categories ORDER BY sort_order, category_code, id
    `).all<Row>();
    const all = resultRows(result);
    const byId = new Map(all.map((row) => [Number(row.id), row]));
    const active = all.filter((row) => row.status === "ACTIVE");
    const activeIds = new Set(active.map((row) => Number(row.id)));
    const childRows = new Map<number | null, Row[]>();
    for (const row of active) {
      const id = Number(row.id);
      const level = Number(row.category_level);
      const parentId = row.parent_id == null ? null : Number(row.parent_id);
      if (!Number.isSafeInteger(id) || level < 1 || level > 4) return referenceFailure("CATEGORY_TREE_INVALID");
      if ((level === 1) !== (parentId === null)) return referenceFailure("CATEGORY_TREE_INVALID");
      if (parentId !== null) {
        const parent = byId.get(parentId);
        if (!parent || !activeIds.has(parentId) || Number(parent.category_level) !== level - 1) return referenceFailure("CATEGORY_TREE_INVALID");
      }
      const siblings = childRows.get(parentId) ?? [];
      siblings.push(row);
      childRows.set(parentId, siblings);
    }
    const compare = (left: Row, right: Row) => Number(left.sort_order) - Number(right.sort_order)
      || String(left.category_code).localeCompare(String(right.category_code), "en")
      || Number(left.id) - Number(right.id);
    for (const siblings of childRows.values()) siblings.sort(compare);
    const visiting = new Set<number>();
    const seen = new Set<number>();
    const flat: CategoryNode[] = [];
    const build = (row: Row, names: string[]): CategoryNode => {
      const id = Number(row.id);
      if (visiting.has(id) || seen.has(id)) return referenceFailure("CATEGORY_TREE_INVALID");
      visiting.add(id);
      seen.add(id);
      const name = String(row.category_name_cn);
      const level = Number(row.category_level);
      const node: CategoryNode = {
        category_id: id,
        code: String(row.category_code),
        name,
        level,
        parent_id: row.parent_id == null ? null : Number(row.parent_id),
        full_path: [...names, name].join(" / "),
        enabled: true,
        is_leaf: level === 4,
        display_order: Number(row.sort_order),
        children: [],
      };
      flat.push(node);
      node.children = (childRows.get(id) ?? []).map((child) => build(child, [...names, name]));
      if (level === 4 && node.children.length > 0) return referenceFailure("CATEGORY_TREE_INVALID");
      visiting.delete(id);
      return node;
    };
    const tree = (childRows.get(null) ?? []).map((row) => build(row, []));
    if (seen.size !== active.length) return referenceFailure("CATEGORY_TREE_INVALID");
    return { tree, flat };
  };

  return {
    async listCategories(view) {
      const loaded = await loadTree();
      const data = view === "tree"
        ? loaded.tree
        : loaded.flat.map((node) => ({ ...node, children: [] }));
      const hash = await digest(data);
      return { data, etag: `"sha256-${hash.base64url}"` };
    },

    async getCategorySchema(categoryId) {
      const category = await database.prepare(`
        SELECT id, category_code, category_name_cn, category_level, status
        FROM material_categories WHERE id = ? LIMIT 1
      `).bind(categoryId).first<Row>();
      if (!category) throw new MaterialReferenceQueryError("CATEGORY_NOT_FOUND", "物料分类不存在", 404);
      if (category.status !== "ACTIVE") throw new MaterialReferenceQueryError("CATEGORY_DISABLED", "物料分类已停用", 409);
      if (Number(category.category_level) !== 4) throw new MaterialReferenceQueryError("CATEGORY_NOT_LEAF", "仅四级叶子分类提供属性 Schema", 409);
      const tree = await loadTree();
      const node = tree.flat.find((candidate) => candidate.category_id === categoryId);
      if (!node || !node.is_leaf) return referenceFailure();
      const bindings = await database.prepare(`
        SELECT d.id AS attribute_definition_id, d.attribute_code, d.attribute_name_cn,
               d.data_type, d.decimal_scale, d.canonical_unit, d.allowed_values_json,
               b.is_required, b.sort_order
        FROM material_category_attributes b
        INNER JOIN material_attribute_definitions d ON d.id = b.attribute_definition_id
        WHERE b.category_id = ? AND b.status = 'ACTIVE' AND d.status = 'ACTIVE'
        ORDER BY b.sort_order, d.attribute_code, d.id
      `).bind(categoryId).all<Row>();
      const attributes = resultRows(bindings).map((row) => projectCategoryAttributeSchema({
        attributeCode: String(row.attribute_code),
        name: String(row.attribute_name_cn),
        dataType: String(row.data_type),
        required: Number(row.is_required) === 1,
        canonicalUnit: String(row.canonical_unit),
        decimalScale: Number(row.decimal_scale),
        allowedValuesJson: String(row.allowed_values_json),
        displayOrder: Number(row.sort_order),
      }));
      const versionBasis = {
        category_id: categoryId,
        category_code: String(category.category_code),
        category_name: String(category.category_name_cn),
        category_path: node.full_path,
        unit_policy_version: MATERIAL_UNIT_POLICY_VERSION,
        attributes,
      };
      const schemaHash = await digest(versionBasis);
      const data = {
        category_id: categoryId,
        category_code: String(category.category_code),
        category_name: String(category.category_name_cn),
        category_path: node.full_path,
        schema_version: `sha256:${schemaHash.hex}`,
        attributes,
      };
      const responseHash = await digest(data);
      return { data, etag: `"sha256-${responseHash.base64url}"` };
    },
  };
}
