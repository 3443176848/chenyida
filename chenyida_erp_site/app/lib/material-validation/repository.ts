import type {
  MaterialAttributeRule,
  MaterialCategoryRules,
  MaterialValidationRepository,
} from "./types.ts";

export interface MaterialValidationD1Result<T> {
  results: T[];
}

export interface MaterialValidationD1Statement {
  bind(...values: unknown[]): MaterialValidationD1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<MaterialValidationD1Result<T>>;
}

export interface MaterialValidationD1Database {
  prepare(query: string): MaterialValidationD1Statement;
}

type CategoryRow = {
  id: number;
  category_code: string;
  category_level: number;
  status: string;
};

type AttributeRuleRow = {
  attribute_code: string;
  attribute_name_cn: string;
  data_type: string;
  decimal_scale: number;
  canonical_unit: string;
  allowed_values_json: string;
  is_required: number;
  sort_order: number;
};

const CATEGORY_SQL = `
  SELECT id, category_code, category_level, status
  FROM material_categories
  WHERE id = ?
  LIMIT 1
`;

const ATTRIBUTE_RULES_SQL = `
  SELECT
    a.attribute_code,
    a.attribute_name_cn,
    a.data_type,
    a.decimal_scale,
    a.canonical_unit,
    a.allowed_values_json,
    b.is_required,
    b.sort_order
  FROM material_category_attributes b
  INNER JOIN material_attribute_definitions a
    ON a.id = b.attribute_definition_id
  WHERE b.category_id = ?
    AND b.status = 'ACTIVE'
    AND a.status = 'ACTIVE'
  ORDER BY b.sort_order, a.attribute_code
`;

function copyRules(rules: MaterialCategoryRules): MaterialCategoryRules {
  return {
    ...rules,
    attributes: rules.attributes.map((attribute) => ({ ...attribute })),
  };
}

export class D1MaterialValidationRepository implements MaterialValidationRepository {
  private readonly database: MaterialValidationD1Database;

  constructor(database: MaterialValidationD1Database) {
    this.database = database;
  }

  async getCategoryRules(categoryId: number): Promise<MaterialCategoryRules | null> {
    const category = await this.database
      .prepare(CATEGORY_SQL)
      .bind(categoryId)
      .first<CategoryRow>();

    if (!category) return null;

    const result = await this.database
      .prepare(ATTRIBUTE_RULES_SQL)
      .bind(categoryId)
      .all<AttributeRuleRow>();

    const attributes: MaterialAttributeRule[] = result.results.map((row) => ({
      code: row.attribute_code,
      name: row.attribute_name_cn,
      dataType: row.data_type,
      decimalScale: row.decimal_scale,
      canonicalUnit: row.canonical_unit,
      allowedValuesJson: row.allowed_values_json,
      isRequired: row.is_required === 1,
      sortOrder: row.sort_order,
    }));

    return {
      id: category.id,
      code: category.category_code,
      level: category.category_level,
      status: category.status,
      attributes,
    };
  }
}

export class MemoryMaterialValidationRepository implements MaterialValidationRepository {
  private readonly categories = new Map<number, MaterialCategoryRules>();

  constructor(initialRules: readonly MaterialCategoryRules[] = []) {
    for (const rules of initialRules) this.setCategoryRules(rules);
  }

  setCategoryRules(rules: MaterialCategoryRules): void {
    this.categories.set(rules.id, copyRules(rules));
  }

  removeCategoryRules(categoryId: number): void {
    this.categories.delete(categoryId);
  }

  async getCategoryRules(categoryId: number): Promise<MaterialCategoryRules | null> {
    const rules = this.categories.get(categoryId);
    return rules ? copyRules(rules) : null;
  }
}

export function createD1MaterialValidationRepository(
  database: MaterialValidationD1Database,
): MaterialValidationRepository {
  return new D1MaterialValidationRepository(database);
}
