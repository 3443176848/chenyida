import {
  materialRecordToValidationInput,
  type MaterialMasterD1Database,
  type MaterialMasterRepository,
  type MaterialRecord,
} from "../material-master/index.ts";
import type { MaterialValidationService } from "../material-validation/index.ts";

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

export interface MaterialMasterQueryService {
  listDrafts(query: MaterialDraftListQuery): Promise<Record<string, unknown>>;
  getDraftDetail(materialId: number, query: MaterialDraftHistoryQuery): Promise<Record<string, unknown> | null>;
  getDraftCreatedBy(materialId: number): Promise<string | null>;
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
    material_status: material.materialStatus,
    version: material.version,
    created_by: material.createdBy,
    created_at: material.createdAt,
    updated_by: material.updatedBy,
    updated_at: material.updatedAt,
    approved_by: material.approvedBy,
    approved_at: material.approvedAt,
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
    const clauses = ["m.material_status = ?"];
    const values: unknown[] = [query.materialStatus];
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
        material_status: row.material_status,
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

  async getDraftCreatedBy(materialId: number): Promise<string | null> {
    const row = await this.database.prepare("SELECT created_by FROM material_master WHERE id = ? LIMIT 1")
      .bind(materialId).first<{ created_by: string }>();
    return row?.created_by ?? null;
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
