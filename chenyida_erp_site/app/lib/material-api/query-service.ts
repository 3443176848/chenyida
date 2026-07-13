import {
  materialRecordToValidationInput,
  type MaterialMasterD1Database,
  type MaterialMasterRepository,
  type MaterialRecord,
} from "../material-master/index.ts";
import {
  createMaterialValidationService,
  MemoryMaterialValidationRepository,
  type MaterialAttributeRule,
  type MaterialCategoryRules,
  type MaterialValidationService,
} from "../material-validation/index.ts";

export type MaterialDraftListQuery = Readonly<{
  page: number;
  pageSize: number;
  materialStatus: string;
  categoryId?: number;
  sourceType?: string;
  keyword?: string;
  createdBy?: string;
  createdFrom?: string;
  createdToExclusive?: string;
}>;

export type MaterialDraftHistoryQuery = Readonly<{
  versionPage: number;
  versionPageSize: number;
  changeLogPage: number;
  changeLogPageSize: number;
}>;

export type MaterialReviewQueueQuery = Readonly<{
  page: number;
  pageSize: number;
  categoryId?: number;
  sourceType?: string;
  creator?: string;
  submittedFrom?: string;
  submittedToExclusive?: string;
  keyword?: string;
  sort: "submitted_at_desc" | "submitted_at_asc" | "standard_name_asc" | "standard_name_desc";
}>;

export interface MaterialMasterQueryService {
  listDrafts(query: MaterialDraftListQuery): Promise<Record<string, unknown>>;
  getDraftDetail(materialId: number, query: MaterialDraftHistoryQuery): Promise<Record<string, unknown> | null>;
  getReviewResponsibility(materialId: number): Promise<{ createdBy: string; lastModifiedBy: string } | null>;
  listReviewQueue(query: MaterialReviewQueueQuery): Promise<Record<string, unknown>>;
}

type CountRow = { total: number };

function rows<T>(result: { results?: T[] | null } | undefined): T[] {
  return result?.results ?? [];
}

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function page(total: number, current: number, pageSize: number) {
  return {
    page: current,
    page_size: pageSize,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function materialView(material: MaterialRecord) {
  return {
    material_id: material.id,
    internal_material_code: material.internalMaterialCode,
    category_id: material.fields.categoryId,
    standard_name: material.fields.standardName,
    unit: material.fields.baseUom,
    brand: material.fields.brand,
    manufacturer: material.fields.manufacturer,
    manufacturer_part_number: material.fields.manufacturerPartNumber,
    procurement_type: material.fields.procurementType,
    inventory_type: material.fields.inventoryType,
    lot_control_required: material.fields.lotControlRequired === 1,
    shelf_life_days: material.fields.shelfLifeDays,
    inspection_type: material.fields.inspectionType,
    environmental_requirement: material.fields.environmentalRequirement,
    source_type: material.fields.sourceType,
    source_ref: material.fields.sourceRef,
    material_status: material.materialStatus === "PENDING_APPROVAL" ? "PENDING_REVIEW" : material.materialStatus,
    version: material.version,
    created_by: material.createdBy,
    created_at: material.createdAt,
    updated_by: material.updatedBy,
    updated_at: material.updatedAt,
    approved_by: material.approvedBy,
    approved_at: material.approvedAt,
    last_modified_by: material.lastModifiedBy,
    submitted_by: material.submittedBy,
    submitted_at: material.submittedAt,
  };
}

class D1MaterialMasterQueryService implements MaterialMasterQueryService {
  private readonly database: MaterialMasterD1Database;
  private readonly repository: MaterialMasterRepository;
  private readonly validationService: MaterialValidationService;
  private readonly clock: () => Date;

  constructor(
    database: MaterialMasterD1Database,
    repository: MaterialMasterRepository,
    validationService: MaterialValidationService,
    clock: () => Date,
  ) {
    this.database = database;
    this.repository = repository;
    this.validationService = validationService;
    this.clock = clock;
  }

  async listDrafts(query: MaterialDraftListQuery): Promise<Record<string, unknown>> {
    const clauses = [query.materialStatus === "PENDING_REVIEW"
      ? "m.material_status IN ('PENDING_REVIEW', 'PENDING_APPROVAL')"
      : "m.material_status = ?"];
    const values: unknown[] = query.materialStatus === "PENDING_REVIEW" ? [] : [query.materialStatus];
    if (query.categoryId !== undefined) {
      clauses.push("m.category_id = ?");
      values.push(query.categoryId);
    }
    if (query.sourceType !== undefined) {
      clauses.push("m.source_type = ?");
      values.push(query.sourceType);
    }
    if (query.keyword !== undefined) {
      clauses.push("(m.standard_name LIKE ? ESCAPE '\\' OR COALESCE(m.internal_material_code, '') LIKE ? ESCAPE '\\' OR m.manufacturer LIKE ? ESCAPE '\\' OR m.manufacturer_part_number LIKE ? ESCAPE '\\')");
      const escaped = `%${query.keyword.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      values.push(escaped, escaped, escaped, escaped);
    }
    if (query.createdBy !== undefined) {
      clauses.push("m.created_by = ?");
      values.push(query.createdBy);
    }
    if (query.createdFrom !== undefined) {
      clauses.push("m.created_at >= ?");
      values.push(query.createdFrom);
    }
    if (query.createdToExclusive !== undefined) {
      clauses.push("m.created_at < ?");
      values.push(query.createdToExclusive);
    }
    const where = clauses.join(" AND ");
    const count = await this.database.prepare(`SELECT COUNT(*) AS total FROM material_master m WHERE ${where}`)
      .bind(...values).first<CountRow>();
    const total = Number(count?.total ?? 0);
    const result = await this.database.prepare(`
      SELECT m.id, m.internal_material_code, m.standard_name, m.category_id,
             c.category_name_cn, m.material_status, m.source_type, m.version,
             m.created_by, m.created_at, m.updated_at
      FROM material_master m
      INNER JOIN material_categories c ON c.id = m.category_id
      WHERE ${where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?
    `).bind(...values, query.pageSize, (query.page - 1) * query.pageSize).all<Record<string, unknown>>();
    return {
      data: rows(result).map((row) => ({
        material_id: row.id,
        internal_material_code: row.internal_material_code,
        standard_name: row.standard_name,
        category_id: row.category_id,
        category_name: row.category_name_cn,
        material_status: row.material_status === "PENDING_APPROVAL" ? "PENDING_REVIEW" : row.material_status,
        source_type: row.source_type,
        version: row.version,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      pagination: page(total, query.page, query.pageSize),
    };
  }

  async getDraftDetail(materialId: number, query: MaterialDraftHistoryQuery): Promise<Record<string, unknown> | null> {
    const material = await this.repository.getMaterialForReview(materialId);
    if (!material) return null;
    const [categoryResult, versionCount, versionResult, changeCount, changeResult, validation] = await Promise.all([
      this.database.prepare(`
        WITH RECURSIVE path(id, category_code, category_name_cn, parent_id, category_level, depth) AS (
          SELECT id, category_code, category_name_cn, parent_id, category_level, 1
          FROM material_categories WHERE id = ?
          UNION ALL
          SELECT c.id, c.category_code, c.category_name_cn, c.parent_id, c.category_level, path.depth + 1
          FROM material_categories c INNER JOIN path ON c.id = path.parent_id
          WHERE path.depth < 4
        )
        SELECT id, category_code, category_name_cn, category_level FROM path ORDER BY category_level
      `).bind(materialId === material.id ? material.fields.categoryId : 0).all<Record<string, unknown>>(),
      this.database.prepare("SELECT COUNT(*) AS total FROM material_versions WHERE material_id = ?").bind(materialId).first<CountRow>(),
      this.database.prepare(`
        SELECT version_no, event_type, change_reason, changed_fields_json, snapshot_json,
               changed_by, reviewed_by, reviewed_at, created_at, request_id
        FROM material_versions WHERE material_id = ?
        ORDER BY version_no DESC, id DESC LIMIT ? OFFSET ?
      `).bind(materialId, query.versionPageSize, (query.versionPage - 1) * query.versionPageSize).all<Record<string, unknown>>(),
      this.database.prepare("SELECT COUNT(*) AS total FROM material_change_logs WHERE material_id = ?").bind(materialId).first<CountRow>(),
      this.database.prepare(`
        SELECT change_type, field_name, old_value_json, new_value_json, change_reason,
               changed_by, created_at, request_id
        FROM material_change_logs WHERE material_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
      `).bind(materialId, query.changeLogPageSize, (query.changeLogPage - 1) * query.changeLogPageSize).all<Record<string, unknown>>(),
      this.validationService.validateForReview(materialRecordToValidationInput(material)),
    ]);
    return {
      material: materialView(material),
      attributes: material.attributes.map((attribute) => ({
        attribute_code: attribute.attributeCode,
        data_type: attribute.dataType,
        value: attribute.value,
        unit: attribute.unit,
        source_type: attribute.sourceType,
        source_ref: attribute.sourceRef,
      })),
      category_path: rows(categoryResult).map((row) => ({
        category_id: row.id,
        category_code: row.category_code,
        category_name: row.category_name_cn,
        level: row.category_level,
      })),
      validation: {
        basis: "CURRENT_METADATA",
        validated_at: this.clock().toISOString(),
        ...validation,
      },
      versions: {
        items: rows(versionResult).map((row) => ({
          version: row.version_no,
          event_type: row.event_type,
          change_reason: row.change_reason,
          changed_fields: parseJson(String(row.changed_fields_json), []),
          snapshot: parseJson(String(row.snapshot_json), {}),
          changed_by: row.changed_by,
          reviewed_by: row.reviewed_by,
          reviewed_at: row.reviewed_at,
          created_at: row.created_at,
          operation_id: row.request_id,
        })),
        pagination: page(Number(versionCount?.total ?? 0), query.versionPage, query.versionPageSize),
      },
      change_logs: {
        items: rows(changeResult).map((row) => ({
          change_type: row.change_type,
          field_name: row.field_name,
          old_value: parseJson(String(row.old_value_json), null),
          new_value: parseJson(String(row.new_value_json), null),
          change_reason: row.change_reason,
          changed_by: row.changed_by,
          created_at: row.created_at,
          operation_id: row.request_id,
        })),
        pagination: page(Number(changeCount?.total ?? 0), query.changeLogPage, query.changeLogPageSize),
      },
    };
  }

  async getReviewResponsibility(materialId: number): Promise<{ createdBy: string; lastModifiedBy: string } | null> {
    const row = await this.database.prepare("SELECT created_by, last_modified_by FROM material_master WHERE id = ? LIMIT 1")
      .bind(materialId).first<{ created_by: string; last_modified_by: string }>();
    return row ? { createdBy: row.created_by, lastModifiedBy: row.last_modified_by } : null;
  }

  async listReviewQueue(query: MaterialReviewQueueQuery): Promise<Record<string, unknown>> {
    const clauses = ["m.material_status = 'PENDING_REVIEW'"];
    const values: unknown[] = [];
    if (query.categoryId !== undefined) { clauses.push("m.category_id = ?"); values.push(query.categoryId); }
    if (query.sourceType !== undefined) { clauses.push("m.source_type = ?"); values.push(query.sourceType); }
    if (query.creator !== undefined) { clauses.push("m.created_by = ?"); values.push(query.creator); }
    if (query.submittedFrom !== undefined) { clauses.push("m.submitted_at >= ?"); values.push(query.submittedFrom); }
    if (query.submittedToExclusive !== undefined) { clauses.push("m.submitted_at < ?"); values.push(query.submittedToExclusive); }
    if (query.keyword !== undefined) {
      const escaped = `%${query.keyword.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      clauses.push("(m.standard_name LIKE ? ESCAPE '\\' OR m.manufacturer LIKE ? ESCAPE '\\' OR m.manufacturer_part_number LIKE ? ESCAPE '\\')");
      values.push(escaped, escaped, escaped);
    }
    const where = clauses.join(" AND ");
    const orderBy = {
      submitted_at_desc: "m.submitted_at DESC, m.id DESC",
      submitted_at_asc: "m.submitted_at ASC, m.id ASC",
      standard_name_asc: "m.standard_name ASC, m.id ASC",
      standard_name_desc: "m.standard_name DESC, m.id DESC",
    }[query.sort];
    const [count, pageResult] = await Promise.all([
      this.database.prepare(`SELECT COUNT(*) AS total FROM material_master m WHERE ${where}`).bind(...values).first<CountRow>(),
      this.database.prepare(`
        SELECT m.id, m.category_id, m.standard_name, m.base_uom, m.source_type,
               m.created_by, m.last_modified_by, m.submitted_by, m.submitted_at, m.version
        FROM material_master m WHERE ${where}
        ORDER BY ${orderBy} LIMIT ? OFFSET ?
      `).bind(...values, query.pageSize, (query.page - 1) * query.pageSize).all<Record<string, unknown>>(),
    ]);
    const masters = rows(pageResult);
    if (masters.length === 0) {
      return { data: [], pagination: page(Number(count?.total ?? 0), query.page, query.pageSize) };
    }
    const ids = masters.map((row) => Number(row.id));
    const categoryIds = [...new Set(masters.map((row) => Number(row.category_id)))];
    const idSlots = ids.map(() => "?").join(",");
    const categorySlots = categoryIds.map(() => "?").join(",");
    const [attributeResult, categoryResult, ruleResult, allCategoryResult] = await Promise.all([
      this.database.prepare(`
        SELECT v.material_id, d.attribute_code, d.data_type, d.decimal_scale,
               v.value_text, v.value_integer, v.value_decimal_scaled, v.value_boolean,
               v.value_date, v.unit_code, v.source_type
        FROM material_attribute_values v
        INNER JOIN material_attribute_definitions d ON d.id = v.attribute_definition_id
        WHERE v.material_id IN (${idSlots}) ORDER BY v.material_id, d.attribute_code
      `).bind(...ids).all<Record<string, unknown>>(),
      this.database.prepare(`SELECT id, category_code, category_level, status FROM material_categories WHERE id IN (${categorySlots})`).bind(...categoryIds).all<Record<string, unknown>>(),
      this.database.prepare(`
        SELECT b.category_id, a.attribute_code, a.attribute_name_cn, a.data_type,
               a.decimal_scale, a.canonical_unit, a.allowed_values_json,
               b.is_required, b.sort_order
        FROM material_category_attributes b
        INNER JOIN material_attribute_definitions a ON a.id = b.attribute_definition_id
        WHERE b.category_id IN (${categorySlots}) AND b.status = 'ACTIVE' AND a.status = 'ACTIVE'
        ORDER BY b.category_id, b.sort_order, a.attribute_code
      `).bind(...categoryIds).all<Record<string, unknown>>(),
      this.database.prepare("SELECT id, parent_id, category_name_cn, category_level FROM material_categories").all<Record<string, unknown>>(),
    ]);
    const ruleRows = rows(ruleResult);
    const rules: MaterialCategoryRules[] = rows(categoryResult).map((category) => ({
      id: Number(category.id),
      code: String(category.category_code),
      level: Number(category.category_level),
      status: String(category.status),
      attributes: ruleRows.filter((row) => Number(row.category_id) === Number(category.id)).map((row): MaterialAttributeRule => ({
        code: String(row.attribute_code), name: String(row.attribute_name_cn), dataType: String(row.data_type),
        decimalScale: Number(row.decimal_scale), canonicalUnit: String(row.canonical_unit),
        allowedValuesJson: String(row.allowed_values_json), isRequired: Number(row.is_required) === 1,
        sortOrder: Number(row.sort_order),
      })),
    }));
    const batchValidation = createMaterialValidationService(new MemoryMaterialValidationRepository(rules));
    const attributeRows = rows(attributeResult);
    const categoryMap = new Map(rows(allCategoryResult).map((row) => [Number(row.id), row]));
    const pathFor = (categoryId: number): string => {
      const names: string[] = [];
      let current = categoryMap.get(categoryId);
      for (let depth = 0; current && depth < 4; depth += 1) {
        names.unshift(String(current.category_name_cn));
        current = current.parent_id == null ? undefined : categoryMap.get(Number(current.parent_id));
      }
      return names.join(" / ");
    };
    const data = await Promise.all(masters.map(async (master) => {
      const attributes = Object.fromEntries(attributeRows.filter((row) => Number(row.material_id) === Number(master.id)).map((row) => {
        let value: unknown = row.value_text;
        if (row.data_type === "INTEGER") value = row.value_integer;
        else if (row.data_type === "DECIMAL") value = Number(row.value_decimal_scaled) / 10 ** Number(row.decimal_scale);
        else if (row.data_type === "BOOLEAN") value = Number(row.value_boolean) === 1;
        else if (row.data_type === "DATE") value = row.value_date;
        return [String(row.attribute_code), { value, unit: String(row.unit_code ?? ""), source: String(row.source_type) }];
      }));
      const validation = await batchValidation.validateForReview({
        category_id: Number(master.category_id),
        basic_fields: { standard_name: master.standard_name, unit: master.base_uom, source_type: master.source_type },
        attributes,
      });
      const issues = [...validation.errors, ...validation.warnings].slice(0, 5).map((issue) => ({
        code: issue.code, severity: issue.severity, field: issue.field,
        ...(issue.attribute_code ? { attribute_code: issue.attribute_code } : {}), message: issue.message,
      }));
      return {
        material_id: master.id, standard_name: master.standard_name,
        category_path: pathFor(Number(master.category_id)), creator: master.created_by,
        last_modified_by: master.last_modified_by, submitted_by: master.submitted_by,
        submitted_at: master.submitted_at, current_version: master.version,
        source_type: master.source_type,
        validation_summary: {
          basis: "CURRENT_METADATA", valid: validation.valid, error_count: validation.errors.length,
          warning_count: validation.warnings.length, top_issues: issues,
        },
      };
    }));
    return { data, pagination: page(Number(count?.total ?? 0), query.page, query.pageSize) };
  }
}

export function createMaterialMasterQueryService(
  database: MaterialMasterD1Database,
  repository: MaterialMasterRepository,
  validationService: MaterialValidationService,
  clock: () => Date = () => new Date(),
): MaterialMasterQueryService {
  return new D1MaterialMasterQueryService(database, repository, validationService, clock);
}
