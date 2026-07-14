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
import {
  draftVisibilityPredicate,
  materialVisibilityPredicate,
  type MaterialVisibilityScope,
} from "./query-visibility.ts";

export type MaterialListQuery = Readonly<{
  page: number;
  pageSize: number;
  materialStatus?: string;
  categoryId?: number;
  categoryPath?: string;
  sourceType?: string;
  keyword?: string;
  createdBy?: string;
  createdFrom?: string;
  createdToExclusive?: string;
  updatedFrom?: string;
  updatedToExclusive?: string;
  sort: "updated_at_desc" | "updated_at_asc" | "created_at_desc" | "created_at_asc" | "standard_name_asc" | "standard_name_desc" | "material_code_asc" | "material_code_desc";
}>;

export type MaterialDraftListQuery = Omit<MaterialListQuery, "categoryPath" | "updatedFrom" | "updatedToExclusive" | "sort"> & Readonly<{
  materialStatus: "DRAFT" | "PENDING_REVIEW";
}>;

export type MaterialDraftHistoryQuery = Readonly<{
  versionPage: number;
  versionPageSize: number;
  changeLogPage: number;
  changeLogPageSize: number;
}>;

export type MaterialHistoryQuery = Readonly<{ page: number; pageSize: number }>;

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

export class MaterialQueryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "MaterialQueryError";
    this.code = code;
  }
}

export interface MaterialMasterQueryService {
  listMaterials(query: MaterialListQuery): Promise<Record<string, unknown>>;
  getMaterialDetail(materialId: number): Promise<Record<string, unknown> | null>;
  listMaterialVersions(materialId: number, query: MaterialHistoryQuery): Promise<Record<string, unknown> | null>;
  listMaterialChangeLogs(materialId: number, query: MaterialHistoryQuery): Promise<Record<string, unknown> | null>;
  listDrafts(query: MaterialDraftListQuery): Promise<Record<string, unknown>>;
  getDraftDetail(materialId: number, query: MaterialDraftHistoryQuery): Promise<Record<string, unknown> | null>;
  getReviewResponsibility(materialId: number): Promise<{ createdBy: string; lastModifiedBy: string } | null>;
  listReviewQueue(query: MaterialReviewQueueQuery): Promise<Record<string, unknown>>;
}

type CountRow = { total: number };
type Row = Record<string, unknown>;

function rows<T>(result: { results?: T[] | null } | undefined): T[] {
  return result?.results ?? [];
}

function page(total: number, current: number, pageSize: number) {
  return { page: current, page_size: pageSize, total, total_pages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

function publicStatus(value: unknown): string {
  return value === "PENDING_APPROVAL" ? "PENDING_REVIEW" : String(value);
}

function escapedLike(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function parseJsonStrict(value: unknown, expected: "array" | "object" | "any"): unknown {
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (expected === "array" && (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string"))) throw new Error();
    if (expected === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) throw new Error();
    return parsed;
  } catch {
    throw new MaterialQueryError("HISTORY_DATA_INVALID");
  }
}

function unifiedMaterialView(material: MaterialRecord): Record<string, unknown> {
  return {
    material_id: material.id,
    material_code: material.internalMaterialCode,
    standard_name: material.fields.standardName,
    material_status: publicStatus(material.materialStatus),
    category_id: material.fields.categoryId,
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
    current_version: material.version,
    created_by: material.createdBy,
    last_modified_by: material.lastModifiedBy,
    submitted_by: material.submittedBy,
    submitted_at: material.submittedAt,
    approved_by: material.approvedBy,
    approved_at: material.approvedAt,
    created_at: material.createdAt,
    updated_at: material.updatedAt,
  };
}

function compatibilityMaterialView(material: MaterialRecord): Record<string, unknown> {
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
    material_status: publicStatus(material.materialStatus),
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
  private readonly visibility: MaterialVisibilityScope;
  private readonly clock: () => Date;

  constructor(
    database: MaterialMasterD1Database,
    repository: MaterialMasterRepository,
    validationService: MaterialValidationService,
    visibility: MaterialVisibilityScope,
    clock: () => Date,
  ) {
    this.database = database;
    this.repository = repository;
    this.validationService = validationService;
    this.visibility = visibility;
    this.clock = clock;
  }

  private async loadCategories(): Promise<Row[]> {
    return rows(await this.database.prepare(`
      SELECT id, category_code, category_name_cn, parent_id, category_level, status, sort_order
      FROM material_categories
    `).all<Row>());
  }

  private categoryPathMaps(categories: readonly Row[]) {
    const byId = new Map(categories.map((row) => [Number(row.id), row]));
    const pathNodes = (categoryId: number): Row[] => {
      const path: Row[] = [];
      const seen = new Set<number>();
      let current = byId.get(categoryId);
      while (current && path.length < 4) {
        const id = Number(current.id);
        if (seen.has(id)) throw new MaterialQueryError("CATEGORY_METADATA_INVALID");
        seen.add(id);
        path.unshift(current);
        current = current.parent_id == null ? undefined : byId.get(Number(current.parent_id));
      }
      if (path.length === 0 || path[0].parent_id != null) throw new MaterialQueryError("CATEGORY_METADATA_INVALID");
      for (let index = 0; index < path.length; index += 1) {
        if (Number(path[index].category_level) !== index + 1) throw new MaterialQueryError("CATEGORY_METADATA_INVALID");
      }
      return path;
    };
    return {
      pathNodes,
      pathText: (categoryId: number) => pathNodes(categoryId).map((row) => String(row.category_name_cn)).join(" / "),
      byId,
    };
  }

  private resolveCategoryPath(categories: readonly Row[], requested: string): Set<number> {
    const codes = requested.split("/").map((part) => part.trim());
    if (codes.length < 1 || codes.length > 4 || codes.some((code) => !/^[A-Z][A-Z0-9_]{1,63}$/.test(code))) {
      throw new MaterialQueryError("CATEGORY_PATH_INVALID");
    }
    const byId = new Map(categories.map((row) => [Number(row.id), row]));
    let parent: number | null = null;
    let terminal: Row | undefined;
    for (let index = 0; index < codes.length; index += 1) {
      terminal = categories.find((row) => row.status === "ACTIVE"
        && row.category_code === codes[index]
        && (row.parent_id == null ? null : Number(row.parent_id)) === parent
        && Number(row.category_level) === index + 1);
      if (!terminal) throw new MaterialQueryError("CATEGORY_PATH_INVALID");
      parent = Number(terminal.id);
    }
    const terminalId = Number(terminal?.id);
    const included = new Set<number>();
    for (const row of categories) {
      if (row.status !== "ACTIVE") continue;
      let current: Row | undefined = row;
      const seen = new Set<number>();
      while (current) {
        const id = Number(current.id);
        if (seen.has(id)) throw new MaterialQueryError("CATEGORY_METADATA_INVALID");
        seen.add(id);
        if (id === terminalId) { included.add(Number(row.id)); break; }
        current = current.parent_id == null ? undefined : byId.get(Number(current.parent_id));
      }
    }
    return included;
  }

  private buildListWhere(query: MaterialListQuery, workflowOnly: boolean, categories: readonly Row[]) {
    const visibility = workflowOnly ? draftVisibilityPredicate(this.visibility) : materialVisibilityPredicate(this.visibility);
    const clauses = [visibility.sql];
    const values: unknown[] = [...visibility.values];
    if (query.materialStatus) {
      if (query.materialStatus === "PENDING_REVIEW") clauses.push("m.material_status IN ('PENDING_REVIEW', 'PENDING_APPROVAL')");
      else { clauses.push("m.material_status = ?"); values.push(query.materialStatus); }
    }
    if (query.categoryId !== undefined) { clauses.push("m.category_id = ?"); values.push(query.categoryId); }
    if (query.categoryPath !== undefined) {
      const ids = [...this.resolveCategoryPath(categories, query.categoryPath)];
      if (ids.length === 0) throw new MaterialQueryError("CATEGORY_PATH_INVALID");
      clauses.push(`m.category_id IN (${ids.map(() => "?").join(",")})`);
      values.push(...ids);
    }
    if (query.sourceType !== undefined) { clauses.push("m.source_type = ?"); values.push(query.sourceType); }
    if (query.keyword !== undefined) {
      const escaped = escapedLike(query.keyword);
      const asciiEscaped = escapedLike(query.keyword.toUpperCase());
      clauses.push("(m.standard_name LIKE ? ESCAPE '\\' OR UPPER(COALESCE(m.internal_material_code, '')) LIKE ? ESCAPE '\\' OR m.manufacturer LIKE ? ESCAPE '\\' OR UPPER(m.manufacturer_part_number) LIKE ? ESCAPE '\\')");
      values.push(escaped, asciiEscaped, escaped, asciiEscaped);
    }
    if (query.createdBy !== undefined) { clauses.push("m.created_by = ?"); values.push(query.createdBy); }
    if (query.createdFrom !== undefined) { clauses.push("m.created_at >= ?"); values.push(query.createdFrom); }
    if (query.createdToExclusive !== undefined) { clauses.push("m.created_at < ?"); values.push(query.createdToExclusive); }
    if (query.updatedFrom !== undefined) { clauses.push("m.updated_at >= ?"); values.push(query.updatedFrom); }
    if (query.updatedToExclusive !== undefined) { clauses.push("m.updated_at < ?"); values.push(query.updatedToExclusive); }
    return { where: clauses.join(" AND "), values };
  }

  private async listMaterialRows(query: MaterialListQuery, workflowOnly: boolean): Promise<{ data: Row[]; pagination: ReturnType<typeof page>; categories: Row[] }> {
    const categories = await this.loadCategories();
    const { where, values } = this.buildListWhere(query, workflowOnly, categories);
    const orderBy = {
      updated_at_desc: "m.updated_at DESC, m.id DESC",
      updated_at_asc: "m.updated_at ASC, m.id ASC",
      created_at_desc: "m.created_at DESC, m.id DESC",
      created_at_asc: "m.created_at ASC, m.id ASC",
      standard_name_asc: "m.standard_name ASC, m.id ASC",
      standard_name_desc: "m.standard_name DESC, m.id DESC",
      material_code_asc: "m.internal_material_code IS NULL ASC, m.internal_material_code ASC, m.id ASC",
      material_code_desc: "m.internal_material_code IS NULL ASC, m.internal_material_code DESC, m.id DESC",
    }[query.sort];
    const [count, result] = await Promise.all([
      this.database.prepare(`SELECT COUNT(*) AS total FROM material_master m WHERE ${where}`).bind(...values).first<CountRow>(),
      this.database.prepare(`
        SELECT m.id, m.internal_material_code, m.standard_name, m.category_id, m.base_uom,
               m.material_status, m.source_type, m.version, m.created_by, m.last_modified_by,
               m.submitted_by, m.submitted_at, m.created_at, m.updated_at
        FROM material_master m WHERE ${where}
        ORDER BY ${orderBy} LIMIT ? OFFSET ?
      `).bind(...values, query.pageSize, (query.page - 1) * query.pageSize).all<Row>(),
    ]);
    return { data: rows(result), pagination: page(Number(count?.total ?? 0), query.page, query.pageSize), categories };
  }

  async listMaterials(query: MaterialListQuery): Promise<Record<string, unknown>> {
    const result = await this.listMaterialRows(query, false);
    const paths = this.categoryPathMaps(result.categories);
    return {
      data: result.data.map((row) => ({
        material_id: row.id,
        material_code: row.internal_material_code,
        standard_name: row.standard_name,
        material_status: publicStatus(row.material_status),
        category_id: row.category_id,
        category_path: paths.pathText(Number(row.category_id)),
        unit: row.base_uom,
        source_type: row.source_type,
        current_version: row.version,
        created_by: row.created_by,
        last_modified_by: row.last_modified_by,
        submitted_by: row.submitted_by,
        submitted_at: row.submitted_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      pagination: result.pagination,
    };
  }

  async listDrafts(query: MaterialDraftListQuery): Promise<Record<string, unknown>> {
    const result = await this.listMaterialRows({ ...query, sort: "created_at_desc" }, true);
    const paths = this.categoryPathMaps(result.categories);
    return {
      data: result.data.map((row) => ({
        material_id: row.id,
        internal_material_code: row.internal_material_code,
        standard_name: row.standard_name,
        category_id: row.category_id,
        category_name: paths.pathNodes(Number(row.category_id)).at(-1)?.category_name_cn,
        material_status: publicStatus(row.material_status),
        source_type: row.source_type,
        version: row.version,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      pagination: result.pagination,
    };
  }

  private async canView(materialId: number, workflowOnly = false): Promise<boolean> {
    const predicate = workflowOnly ? draftVisibilityPredicate(this.visibility) : materialVisibilityPredicate(this.visibility);
    const row = await this.database.prepare(`SELECT 1 AS found FROM material_master m WHERE m.id = ? AND ${predicate.sql} LIMIT 1`)
      .bind(materialId, ...predicate.values).first<{ found: number }>();
    return row?.found === 1;
  }

  private async loadBaseDetail(materialId: number, workflowOnly = false): Promise<Record<string, unknown> | null> {
    if (!await this.canView(materialId, workflowOnly)) return null;
    const material = await this.repository.getMaterialForReview(materialId);
    if (!material) return null;
    const [categories, definitionResult, validation] = await Promise.all([
      this.loadCategories(),
      this.database.prepare(`
        SELECT d.id, d.attribute_code, d.attribute_name_cn, d.data_type,
               COALESCE(b.sort_order, 2147483647) AS sort_order
        FROM material_attribute_definitions d
        LEFT JOIN material_category_attributes b
          ON b.attribute_definition_id = d.id AND b.category_id = ? AND b.status = 'ACTIVE'
        WHERE d.id IN (SELECT attribute_definition_id FROM material_attribute_values WHERE material_id = ?)
        ORDER BY sort_order, d.attribute_code, d.id
      `).bind(material.fields.categoryId, materialId).all<Row>(),
      this.validationService.validateForReview(materialRecordToValidationInput(material)),
    ]);
    const paths = this.categoryPathMaps(categories);
    const pathNodes = paths.pathNodes(material.fields.categoryId);
    const definitions = new Map(rows(definitionResult).map((row) => [Number(row.id), row]));
    const order = new Map(rows(definitionResult).map((row, index) => [Number(row.id), index]));
    const attributes = [...material.attributes].sort((left, right) => (order.get(left.attributeDefinitionId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.attributeDefinitionId) ?? Number.MAX_SAFE_INTEGER)).map((attribute) => {
      const definition = definitions.get(attribute.attributeDefinitionId);
      if (!definition) throw new MaterialQueryError("CATEGORY_METADATA_INVALID");
      return {
        attribute_code: attribute.attributeCode,
        name: String(definition.attribute_name_cn),
        data_type: attribute.dataType,
        value: attribute.value,
        unit: attribute.unit,
        source_type: attribute.sourceType,
        source_ref: attribute.sourceRef,
      };
    });
    return {
      material_record: material,
      material: unifiedMaterialView(material),
      category_path: pathNodes.map((row) => ({
        category_id: row.id,
        category_code: row.category_code,
        category_name: row.category_name_cn,
        level: row.category_level,
      })),
      attributes,
      validation: { basis: "CURRENT_METADATA", validated_at: this.clock().toISOString(), ...validation },
    };
  }

  private async versions(materialId: number, query: MaterialHistoryQuery): Promise<Record<string, unknown>> {
    const [count, result] = await Promise.all([
      this.database.prepare("SELECT COUNT(*) AS total FROM material_versions WHERE material_id = ?").bind(materialId).first<CountRow>(),
      this.database.prepare(`
        SELECT version_no, event_type, change_reason, changed_fields_json, snapshot_json,
               changed_by, reviewed_by, reviewed_at, created_at, request_id
        FROM material_versions WHERE material_id = ?
        ORDER BY version_no DESC, id DESC LIMIT ? OFFSET ?
      `).bind(materialId, query.pageSize, (query.page - 1) * query.pageSize).all<Row>(),
    ]);
    return {
      data: rows(result).map((row) => ({
        version: row.version_no,
        event_type: row.event_type,
        change_reason: row.change_reason,
        changed_fields: parseJsonStrict(row.changed_fields_json, "array"),
        snapshot: parseJsonStrict(row.snapshot_json, "object"),
        changed_by: row.changed_by,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at,
        operation_id: row.request_id,
      })),
      pagination: page(Number(count?.total ?? 0), query.page, query.pageSize),
    };
  }

  private async changeLogs(materialId: number, query: MaterialHistoryQuery): Promise<Record<string, unknown>> {
    const [count, result] = await Promise.all([
      this.database.prepare("SELECT COUNT(*) AS total FROM material_change_logs WHERE material_id = ?").bind(materialId).first<CountRow>(),
      this.database.prepare(`
        SELECT change_type, field_name, old_value_json, new_value_json, change_reason,
               changed_by, created_at, request_id
        FROM material_change_logs WHERE material_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
      `).bind(materialId, query.pageSize, (query.page - 1) * query.pageSize).all<Row>(),
    ]);
    return {
      data: rows(result).map((row) => ({
        change_type: row.change_type,
        field_name: row.field_name,
        old_value: parseJsonStrict(row.old_value_json, "any"),
        new_value: parseJsonStrict(row.new_value_json, "any"),
        change_reason: row.change_reason,
        changed_by: row.changed_by,
        created_at: row.created_at,
        operation_id: row.request_id,
      })),
      pagination: page(Number(count?.total ?? 0), query.page, query.pageSize),
    };
  }

  private async historySummary(materialId: number): Promise<Record<string, unknown>> {
    const [versionCount, versionResult, changeCount, changeResult] = await Promise.all([
      this.database.prepare("SELECT COUNT(*) AS total FROM material_versions WHERE material_id = ?").bind(materialId).first<CountRow>(),
      this.database.prepare(`SELECT version_no, event_type, change_reason, changed_fields_json, changed_by, reviewed_by, reviewed_at, created_at FROM material_versions WHERE material_id = ? ORDER BY version_no DESC, id DESC LIMIT 5`).bind(materialId).all<Row>(),
      this.database.prepare("SELECT COUNT(*) AS total FROM material_change_logs WHERE material_id = ?").bind(materialId).first<CountRow>(),
      this.database.prepare(`SELECT change_type, field_name, change_reason, changed_by, created_at FROM material_change_logs WHERE material_id = ? ORDER BY created_at DESC, id DESC LIMIT 5`).bind(materialId).all<Row>(),
    ]);
    const versionTotal = Number(versionCount?.total ?? 0);
    const changeTotal = Number(changeCount?.total ?? 0);
    return {
      versions: {
        items: rows(versionResult).map((row) => ({
          version: row.version_no, event_type: row.event_type, change_reason: row.change_reason,
          changed_fields: parseJsonStrict(row.changed_fields_json, "array"), changed_by: row.changed_by,
          reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at, created_at: row.created_at,
        })),
        total: versionTotal, has_more: versionTotal > 5,
      },
      change_logs: {
        items: rows(changeResult).map((row) => ({
          change_type: row.change_type, field_name: row.field_name, change_reason: row.change_reason,
          changed_by: row.changed_by, created_at: row.created_at,
        })),
        total: changeTotal, has_more: changeTotal > 5,
      },
    };
  }

  private async lastRejection(materialId: number): Promise<Record<string, unknown> | null> {
    const row = await this.database.prepare(`
      SELECT version_no, change_reason, reviewed_by, reviewed_at
      FROM material_versions
      WHERE material_id = ? AND event_type = 'REJECT'
      ORDER BY version_no DESC, reviewed_at DESC, id DESC
      LIMIT 1
    `).bind(materialId).first<Row>();
    if (!row) return null;

    const version = Number(row.version_no);
    const reason = row.change_reason;
    const reviewedBy = row.reviewed_by;
    const reviewedAt = row.reviewed_at;
    const reviewedTimestamp = typeof reviewedAt === "string" ? new Date(reviewedAt) : null;
    if (
      !Number.isSafeInteger(version) || version < 1
      || typeof reason !== "string" || reason.trim().length < 1 || reason.length > 1000
      || typeof reviewedBy !== "string" || reviewedBy.trim().length < 1
      || !reviewedTimestamp || Number.isNaN(reviewedTimestamp.getTime())
    ) {
      throw new MaterialQueryError("HISTORY_DATA_INVALID");
    }
    return {
      version,
      reason,
      reviewed_by: reviewedBy,
      reviewed_at: reviewedTimestamp.toISOString(),
    };
  }

  async getMaterialDetail(materialId: number): Promise<Record<string, unknown> | null> {
    const base = await this.loadBaseDetail(materialId);
    if (!base) return null;
    const publicBase = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "material_record"));
    publicBase.attributes = (base.attributes as Row[]).map((attribute) => Object.fromEntries(
      Object.entries(attribute).filter(([key]) => key !== "source_ref"),
    ));
    const [historySummary, lastRejection] = await Promise.all([
      this.historySummary(materialId),
      this.lastRejection(materialId),
    ]);
    return { ...publicBase, history_summary: historySummary, last_rejection: lastRejection };
  }

  async listMaterialVersions(materialId: number, query: MaterialHistoryQuery): Promise<Record<string, unknown> | null> {
    if (!await this.canView(materialId)) return null;
    return this.versions(materialId, query);
  }

  async listMaterialChangeLogs(materialId: number, query: MaterialHistoryQuery): Promise<Record<string, unknown> | null> {
    if (!await this.canView(materialId)) return null;
    return this.changeLogs(materialId, query);
  }

  async getDraftDetail(materialId: number, query: MaterialDraftHistoryQuery): Promise<Record<string, unknown> | null> {
    const base = await this.loadBaseDetail(materialId, true);
    if (!base) return null;
    const material = base.material_record as MaterialRecord;
    const [versions, changeLogs, lastRejection] = await Promise.all([
      this.versions(materialId, { page: query.versionPage, pageSize: query.versionPageSize }),
      this.changeLogs(materialId, { page: query.changeLogPage, pageSize: query.changeLogPageSize }),
      this.lastRejection(materialId),
    ]);
    return {
      material: compatibilityMaterialView(material),
      attributes: base.attributes,
      category_path: base.category_path,
      validation: base.validation,
      last_rejection: lastRejection,
      versions: { items: versions.data, pagination: versions.pagination },
      change_logs: { items: changeLogs.data, pagination: changeLogs.pagination },
    };
  }

  async getReviewResponsibility(materialId: number): Promise<{ createdBy: string; lastModifiedBy: string } | null> {
    const row = await this.database.prepare("SELECT created_by, last_modified_by FROM material_master WHERE id = ? LIMIT 1")
      .bind(materialId).first<{ created_by: string; last_modified_by: string }>();
    return row ? { createdBy: row.created_by, lastModifiedBy: row.last_modified_by } : null;
  }

  async listReviewQueue(query: MaterialReviewQueueQuery): Promise<Record<string, unknown>> {
    const clauses = ["m.material_status IN ('PENDING_REVIEW', 'PENDING_APPROVAL')"];
    const values: unknown[] = [];
    if (query.categoryId !== undefined) { clauses.push("m.category_id = ?"); values.push(query.categoryId); }
    if (query.sourceType !== undefined) { clauses.push("m.source_type = ?"); values.push(query.sourceType); }
    if (query.creator !== undefined) { clauses.push("m.created_by = ?"); values.push(query.creator); }
    if (query.submittedFrom !== undefined) { clauses.push("m.submitted_at >= ?"); values.push(query.submittedFrom); }
    if (query.submittedToExclusive !== undefined) { clauses.push("m.submitted_at < ?"); values.push(query.submittedToExclusive); }
    if (query.keyword !== undefined) {
      const escaped = escapedLike(query.keyword);
      clauses.push("(m.standard_name LIKE ? ESCAPE '\\' OR m.manufacturer LIKE ? ESCAPE '\\' OR m.manufacturer_part_number LIKE ? ESCAPE '\\')");
      values.push(escaped, escaped, escaped);
    }
    const where = clauses.join(" AND ");
    const orderBy = {
      submitted_at_desc: "m.submitted_at DESC, m.id DESC", submitted_at_asc: "m.submitted_at ASC, m.id ASC",
      standard_name_asc: "m.standard_name ASC, m.id ASC", standard_name_desc: "m.standard_name DESC, m.id DESC",
    }[query.sort];
    const [count, pageResult] = await Promise.all([
      this.database.prepare(`SELECT COUNT(*) AS total FROM material_master m WHERE ${where}`).bind(...values).first<CountRow>(),
      this.database.prepare(`SELECT m.id, m.category_id, m.standard_name, m.base_uom, m.source_type, m.created_by, m.last_modified_by, m.submitted_by, m.submitted_at, m.version FROM material_master m WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...values, query.pageSize, (query.page - 1) * query.pageSize).all<Row>(),
    ]);
    const masters = rows(pageResult);
    if (masters.length === 0) return { data: [], pagination: page(Number(count?.total ?? 0), query.page, query.pageSize) };
    const ids = masters.map((row) => Number(row.id));
    const categoryIds = [...new Set(masters.map((row) => Number(row.category_id)))];
    const idSlots = ids.map(() => "?").join(",");
    const categorySlots = categoryIds.map(() => "?").join(",");
    const [attributeResult, categoryResult, ruleResult, allCategoryResult] = await Promise.all([
      this.database.prepare(`SELECT v.material_id, d.attribute_code, d.data_type, d.decimal_scale, v.value_text, v.value_integer, v.value_decimal_scaled, v.value_boolean, v.value_date, v.unit_code, v.source_type FROM material_attribute_values v INNER JOIN material_attribute_definitions d ON d.id = v.attribute_definition_id WHERE v.material_id IN (${idSlots}) ORDER BY v.material_id, d.attribute_code`).bind(...ids).all<Row>(),
      this.database.prepare(`SELECT id, category_code, category_level, status FROM material_categories WHERE id IN (${categorySlots})`).bind(...categoryIds).all<Row>(),
      this.database.prepare(`SELECT b.category_id, a.attribute_code, a.attribute_name_cn, a.data_type, a.decimal_scale, a.canonical_unit, a.allowed_values_json, b.is_required, b.sort_order FROM material_category_attributes b INNER JOIN material_attribute_definitions a ON a.id = b.attribute_definition_id WHERE b.category_id IN (${categorySlots}) AND b.status = 'ACTIVE' AND a.status = 'ACTIVE' ORDER BY b.category_id, b.sort_order, a.attribute_code`).bind(...categoryIds).all<Row>(),
      this.database.prepare("SELECT id, parent_id, category_name_cn, category_level FROM material_categories").all<Row>(),
    ]);
    const ruleRows = rows(ruleResult);
    const rules: MaterialCategoryRules[] = rows(categoryResult).map((category) => ({
      id: Number(category.id), code: String(category.category_code), level: Number(category.category_level), status: String(category.status),
      attributes: ruleRows.filter((row) => Number(row.category_id) === Number(category.id)).map((row): MaterialAttributeRule => ({
        code: String(row.attribute_code), name: String(row.attribute_name_cn), dataType: String(row.data_type), decimalScale: Number(row.decimal_scale), canonicalUnit: String(row.canonical_unit), allowedValuesJson: String(row.allowed_values_json), isRequired: Number(row.is_required) === 1, sortOrder: Number(row.sort_order),
      })),
    }));
    const batchValidation = createMaterialValidationService(new MemoryMaterialValidationRepository(rules));
    const attributeRows = rows(attributeResult);
    const categoryMap = new Map(rows(allCategoryResult).map((row) => [Number(row.id), row]));
    const pathFor = (categoryId: number): string => {
      const names: string[] = []; let current = categoryMap.get(categoryId);
      for (let depth = 0; current && depth < 4; depth += 1) { names.unshift(String(current.category_name_cn)); current = current.parent_id == null ? undefined : categoryMap.get(Number(current.parent_id)); }
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
      const validation = await batchValidation.validateForReview({ category_id: Number(master.category_id), basic_fields: { standard_name: master.standard_name, unit: master.base_uom, source_type: master.source_type }, attributes });
      const issues = [...validation.errors, ...validation.warnings].slice(0, 5).map((issue) => ({ code: issue.code, severity: issue.severity, field: issue.field, ...(issue.attribute_code ? { attribute_code: issue.attribute_code } : {}), message: issue.message }));
      return {
        material_id: master.id, standard_name: master.standard_name, category_path: pathFor(Number(master.category_id)), creator: master.created_by, last_modified_by: master.last_modified_by, submitted_by: master.submitted_by, submitted_at: master.submitted_at, current_version: master.version, source_type: master.source_type,
        validation_summary: { basis: "CURRENT_METADATA", valid: validation.valid, error_count: validation.errors.length, warning_count: validation.warnings.length, top_issues: issues },
      };
    }));
    return { data, pagination: page(Number(count?.total ?? 0), query.page, query.pageSize) };
  }
}

export function createMaterialMasterQueryService(
  database: MaterialMasterD1Database,
  repository: MaterialMasterRepository,
  validationService: MaterialValidationService,
  visibility: MaterialVisibilityScope,
  clock: () => Date = () => new Date(),
): MaterialMasterQueryService {
  return new D1MaterialMasterQueryService(database, repository, validationService, visibility, clock);
}
