import {
  MATERIAL_ACTION_CHANGE_TYPES,
  MaterialMasterRepositoryError,
  type ApproveDraftWrite,
  type CreateDraftWrite,
  type MaterialAttributeRecord,
  type MaterialAttributeStorageSnapshot,
  type MaterialApiTransactionCompanion,
  type MaterialCodeRule,
  type MaterialDraftFields,
  type MaterialMasterRepository,
  type MaterialRecord,
  type MaterialSourceType,
  type MaterialStatus,
  type RejectDraftWrite,
} from "./types.ts";

export interface MaterialMasterD1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[] | null;
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
}

export interface MaterialMasterD1Statement {
  bind(...values: unknown[]): MaterialMasterD1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<MaterialMasterD1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<MaterialMasterD1Result<T>>;
}

export interface MaterialMasterD1Database {
  prepare(query: string): MaterialMasterD1Statement;
  batch<T = Record<string, unknown>>(
    statements: MaterialMasterD1Statement[],
  ): Promise<MaterialMasterD1Result<T>[]>;
}

type MaterialRow = {
  id: number;
  internal_material_code: string | null;
  standard_name: string;
  category_id: number;
  brand: string;
  manufacturer: string;
  manufacturer_part_number: string;
  base_uom: string;
  material_status: MaterialStatus;
  procurement_type: MaterialDraftFields["procurementType"];
  inventory_type: MaterialDraftFields["inventoryType"];
  lot_control_required: 0 | 1;
  shelf_life_days: number | null;
  inspection_type: MaterialDraftFields["inspectionType"];
  environmental_requirement: MaterialDraftFields["environmentalRequirement"];
  source_type: MaterialSourceType;
  source_ref: string;
  version: number;
  approved_by: string;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  request_id: string;
};

type AttributeRow = {
  attribute_definition_id: number;
  attribute_code: string;
  data_type: string;
  decimal_scale: number;
  value_text: string | null;
  value_integer: number | null;
  value_decimal_scaled: number | null;
  value_boolean: number | null;
  value_date: string | null;
  unit_code: string;
  source_type: MaterialSourceType;
  source_ref: string;
  created_by: string;
  created_at: string;
};

type StorageDefinitionRow = {
  id: number;
  attribute_code: string;
  data_type: string;
  decimal_scale: number;
  normalization_rule: string;
  is_required: number;
};

type MetadataGuardRow = {
  category_level: number;
  status: string;
  metadata_guard: string;
};

type ReviewGuardRow = {
  review_guard: string;
};

type CodeRuleRow = {
  id: number;
  category_id: number;
  prefix: string;
  major_segment: string;
  minor_segment: string;
  separator: string;
  sequence_width: number;
  next_sequence: number;
  version: number;
};

const SELECT_MATERIAL_SQL = `
  SELECT
    id, internal_material_code, standard_name, category_id, brand, manufacturer,
    manufacturer_part_number, base_uom, material_status, procurement_type,
    inventory_type, lot_control_required, shelf_life_days, inspection_type,
    environmental_requirement, source_type, source_ref, version, approved_by,
    approved_at, created_by, created_at, updated_by, updated_at, request_id
  FROM material_master
  WHERE id = ?
  LIMIT 1
`;

const SELECT_ATTRIBUTES_SQL = `
  SELECT
    v.attribute_definition_id,
    d.attribute_code,
    d.data_type,
    d.decimal_scale,
    v.value_text,
    v.value_integer,
    v.value_decimal_scaled,
    v.value_boolean,
    v.value_date,
    v.unit_code,
    v.source_type,
    v.source_ref,
    v.created_by,
    v.created_at
  FROM material_attribute_values v
  INNER JOIN material_attribute_definitions d ON d.id = v.attribute_definition_id
  WHERE v.material_id = ?
  ORDER BY d.attribute_code
`;

function metadataGuardExpression(categoryIdSql: string): string {
  return `json_object(
    'category', COALESCE((
      SELECT json_object(
        'id', c.id,
        'level', c.category_level,
        'status', c.status,
        'version', c.version,
        'updated_at', c.updated_at
      )
      FROM material_categories c
      WHERE c.id = ${categoryIdSql}
    ), 'null'),
    'rules', COALESCE((
      SELECT json_group_array(json(ordered_rule.rule_json))
      FROM (
        SELECT json_object(
          'binding_id', b.id,
          'definition_id', d.id,
          'binding_status', b.status,
          'required', b.is_required,
          'sort_order', b.sort_order,
          'definition_status', d.status,
          'attribute_code', d.attribute_code,
          'data_type', d.data_type,
          'decimal_scale', d.decimal_scale,
          'canonical_unit', d.canonical_unit,
          'allowed_values_json', d.allowed_values_json,
          'normalization_rule', d.normalization_rule,
          'definition_version', d.version,
          'binding_updated_at', b.updated_at,
          'definition_updated_at', d.updated_at
        ) AS rule_json
        FROM material_category_attributes b
        INNER JOIN material_attribute_definitions d
          ON d.id = b.attribute_definition_id
        WHERE b.category_id = ${categoryIdSql}
        ORDER BY b.sort_order, d.attribute_code, b.id
      ) ordered_rule
    ), json('[]'))
  )`;
}

function attributeGuardExpression(materialIdSql: string): string {
  return `COALESCE((
    SELECT json_group_array(json(ordered_attribute.attribute_json))
    FROM (
      SELECT json_object(
        'id', v.id,
        'definition_id', v.attribute_definition_id,
        'value_text', v.value_text,
        'value_integer', v.value_integer,
        'value_decimal_scaled', v.value_decimal_scaled,
        'value_boolean', v.value_boolean,
        'value_date', v.value_date,
        'normalized_value', v.normalized_value,
        'unit_code', v.unit_code,
        'source_type', v.source_type,
        'source_ref', v.source_ref,
        'updated_by', v.updated_by,
        'updated_at', v.updated_at,
        'request_id', v.request_id
      ) AS attribute_json
      FROM material_attribute_values v
      WHERE v.material_id = ${materialIdSql}
      ORDER BY v.attribute_definition_id, v.id
    ) ordered_attribute
  ), json('[]'))`;
}

function reviewGuardExpression(materialAlias: string): string {
  return `json_object(
    'metadata', json(${metadataGuardExpression(`${materialAlias}.category_id`)}),
    'attributes', json(${attributeGuardExpression(`${materialAlias}.id`)})
  )`;
}

const SELECT_REVIEW_GUARD_SQL = `
  SELECT ${reviewGuardExpression("m")} AS review_guard
  FROM material_master m
  WHERE m.id = ?
  LIMIT 1
`;

function resultRows<T>(result: MaterialMasterD1Result<T> | undefined): T[] {
  return result?.results ?? [];
}

function rowToCodeRule(row: CodeRuleRow): MaterialCodeRule {
  return {
    id: row.id,
    categoryId: row.category_id,
    prefix: row.prefix,
    majorSegment: row.major_segment,
    minorSegment: row.minor_segment,
    separator: row.separator,
    sequenceWidth: row.sequence_width,
    nextSequence: row.next_sequence,
    version: row.version,
  };
}

function attributeValue(row: AttributeRow): string | number | boolean {
  switch (row.data_type) {
    case "TEXT":
    case "ENUM":
      if (row.value_text !== null) return row.value_text;
      break;
    case "INTEGER":
      if (row.value_integer !== null) return row.value_integer;
      break;
    case "DECIMAL":
      if (row.value_decimal_scaled !== null) {
        return row.value_decimal_scaled / 10 ** row.decimal_scale;
      }
      break;
    case "BOOLEAN":
      if (row.value_boolean === 0 || row.value_boolean === 1) return row.value_boolean === 1;
      break;
    case "DATE":
      if (row.value_date !== null) return row.value_date;
      break;
  }
  throw new MaterialMasterRepositoryError("WRITE_FAILED");
}

function rowToAttribute(row: AttributeRow): MaterialAttributeRecord {
  return {
    attributeDefinitionId: row.attribute_definition_id,
    attributeCode: row.attribute_code,
    dataType: row.data_type,
    decimalScale: row.decimal_scale,
    value: attributeValue(row),
    unit: row.unit_code,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToMaterial(
  row: MaterialRow,
  attributes: readonly MaterialAttributeRecord[],
  reviewGuard: string,
): MaterialRecord {
  return {
    id: row.id,
    internalMaterialCode: row.internal_material_code,
    fields: {
      categoryId: row.category_id,
      standardName: row.standard_name,
      baseUom: row.base_uom,
      brand: row.brand,
      manufacturer: row.manufacturer,
      manufacturerPartNumber: row.manufacturer_part_number,
      procurementType: row.procurement_type,
      inventoryType: row.inventory_type,
      lotControlRequired: row.lot_control_required,
      shelfLifeDays: row.shelf_life_days,
      inspectionType: row.inspection_type,
      environmentalRequirement: row.environmental_requirement,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
    },
    materialStatus: row.material_status,
    version: row.version,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    requestId: row.request_id,
    reviewGuard,
    attributes,
  };
}

function materialApiSuccessStatements(
  database: MaterialMasterD1Database,
  companion: MaterialApiTransactionCompanion | undefined,
  result: Readonly<{
    materialId: number;
    materialStatus: "DRAFT" | "ACTIVE";
    version: number;
    internalMaterialCode: string | null;
    oldVersion: number | null;
    completedAt: string;
  }>,
): MaterialMasterD1Statement[] {
  if (!companion) return [];
  const responseJson = JSON.stringify({
    data: {
      material_id: result.materialId,
      material_status: result.materialStatus,
      version: result.version,
      internal_material_code: result.internalMaterialCode,
    },
    operation_id: companion.operationId,
  });
  return [
    database.prepare(`
      UPDATE material_api_idempotency
      SET state = 'COMPLETED', lease_expires_at = NULL, status_code = ?,
          response_json = ?, material_id = ?, old_version = ?, new_version = ?,
          updated_at = ?, expires_at = ?
      WHERE id = ? AND username = ? AND state = 'PENDING'
        AND operation_id = ? AND key_digest = ? AND request_digest = ?
        AND lease_token_digest = ?
    `).bind(
      companion.statusCode,
      responseJson,
      result.materialId,
      result.oldVersion,
      result.version,
      result.completedAt,
      companion.expiresAt,
      companion.idempotencyRecordId,
      companion.username,
      companion.operationId,
      companion.keyDigest,
      companion.requestDigest,
      companion.leaseTokenDigest,
    ),
    database.prepare(`
      INSERT INTO audit_log(
        username, action, detail, request_id, result, route_code, material_id,
        operation_id, idempotency_key_digest, old_version, new_version,
        error_code, retention_until, created_at
      ) VALUES (
        (
          SELECT username FROM material_api_idempotency
          WHERE id = ? AND username = ? AND state = 'COMPLETED'
            AND operation_id = ? AND request_digest = ? AND lease_token_digest = ?
            AND response_json = ? AND material_id = ? AND new_version = ?
        ),
        ?, '{"replayed":false}', ?, 'success', ?, ?, ?, ?, ?, ?, '', ?, ?
      )
    `).bind(
      companion.idempotencyRecordId,
      companion.username,
      companion.operationId,
      companion.requestDigest,
      companion.leaseTokenDigest,
      responseJson,
      result.materialId,
      result.version,
      companion.routeCode,
      companion.physicalRequestId,
      companion.routeCode,
      result.materialId,
      companion.operationId,
      companion.keyDigest,
      result.oldVersion,
      result.version,
      companion.retentionUntil,
      result.completedAt,
    ),
  ];
}

function isMaterialIdConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:UNIQUE|PRIMARY KEY).*material_master(?:\.id)?/i.test(message);
}

class D1MaterialMasterRepository implements MaterialMasterRepository {
  private readonly database: MaterialMasterD1Database;

  constructor(database: MaterialMasterD1Database) {
    this.database = database;
  }

  async getAttributeStorageDefinitions(
    categoryId: number,
  ): Promise<MaterialAttributeStorageSnapshot> {
    try {
      const results = await this.database.batch<StorageDefinitionRow | MetadataGuardRow>([
        this.database.prepare(`
          SELECT
            d.id,
            d.attribute_code,
            d.data_type,
            d.decimal_scale,
            d.normalization_rule,
            b.is_required
          FROM material_category_attributes b
          INNER JOIN material_attribute_definitions d
            ON d.id = b.attribute_definition_id
          WHERE b.category_id = ?
            AND b.status = 'ACTIVE'
            AND d.status = 'ACTIVE'
          ORDER BY b.sort_order, d.attribute_code
        `).bind(categoryId),
        this.database.prepare(`
          SELECT
            c.category_level,
            c.status,
            ${metadataGuardExpression("c.id")} AS metadata_guard
          FROM material_categories c
          WHERE c.id = ?
          LIMIT 1
        `).bind(categoryId),
      ]);
      const definitions = resultRows(
        results[0] as MaterialMasterD1Result<StorageDefinitionRow>,
      ).map((row) => ({
        id: row.id,
        code: row.attribute_code,
        dataType: row.data_type,
        decimalScale: row.decimal_scale,
        normalizationRule: row.normalization_rule,
        isRequired: row.is_required === 1,
      }));
      const guard = resultRows(
        results[1] as MaterialMasterD1Result<MetadataGuardRow>,
      )[0];
      if (!guard || typeof guard.metadata_guard !== "string") {
        throw new MaterialMasterRepositoryError("WRITE_FAILED");
      }
      return {
        categoryLevel: guard.category_level,
        categoryStatus: guard.status,
        metadataGuard: guard.metadata_guard,
        definitions,
      };
    } catch {
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }
  }

  async createDraft(input: CreateDraftWrite): Promise<MaterialRecord> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await this.nextMaterialId();
      try {
        await this.database.batch([
          this.database
            .prepare(`
              INSERT INTO material_master(
                id, internal_material_code, standard_name, category_id, brand,
                manufacturer, manufacturer_part_number, base_uom, material_status,
                procurement_type, inventory_type, lot_control_required, shelf_life_days,
                inspection_type, environmental_requirement, source_type, source_ref,
                version, approved_by, approved_at, created_by, created_at, updated_by,
                updated_at, request_id
              ) VALUES (
                ?, NULL,
                (
                  SELECT CASE
                    WHEN ${metadataGuardExpression("c.id")} = ? THEN ?
                    ELSE NULL
                  END
                  FROM material_categories c
                  WHERE c.id = ?
                ),
                ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?,
                1, '', NULL, ?, ?, ?, ?, ?
              )
            `)
            .bind(
              candidate,
              input.metadataGuard,
              input.fields.standardName,
              input.fields.categoryId,
              input.fields.categoryId,
              input.fields.brand,
              input.fields.manufacturer,
              input.fields.manufacturerPartNumber,
              input.fields.baseUom,
              input.fields.procurementType,
              input.fields.inventoryType,
              input.fields.lotControlRequired,
              input.fields.shelfLifeDays,
              input.fields.inspectionType,
              input.fields.environmentalRequirement,
              input.fields.sourceType,
              input.fields.sourceRef,
              input.createdBy,
              input.createdAt,
              input.createdBy,
              input.createdAt,
              input.requestId,
            ),
          this.database
            .prepare(`
              INSERT INTO material_versions(
                material_id, version_no, event_type, change_reason, changed_fields_json,
                snapshot_json, changed_by, reviewed_by, reviewed_at, created_at, request_id
              ) VALUES (?, 1, 'CREATE', '', ?, ?, ?, '', NULL, ?, ?)
            `)
            .bind(
              candidate,
              JSON.stringify(["material_status", "basic_fields", "attributes"]),
              input.snapshotJson,
              input.createdBy,
              input.createdAt,
              input.requestId,
            ),
          this.database
            .prepare(`
              INSERT INTO material_change_logs(
                material_id, change_type, field_name, old_value_json, new_value_json,
                change_reason, changed_by, created_at, request_id
              ) VALUES (?, ?, 'CREATE_DRAFT', 'null', ?, '', ?, ?, ?)
            `)
            .bind(
              candidate,
              MATERIAL_ACTION_CHANGE_TYPES.CREATE_DRAFT,
              input.snapshotJson,
              input.createdBy,
              input.createdAt,
              input.requestId,
            ),
          ...input.attributes.map((attribute) =>
            this.database
              .prepare(`
                INSERT INTO material_attribute_values(
                  material_id, attribute_definition_id, value_text, value_integer,
                  value_decimal_scaled, value_boolean, value_date, normalized_value,
                  unit_code, source_type, source_ref, created_by, created_at, updated_by,
                  updated_at, request_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `)
              .bind(
                candidate,
                attribute.attributeDefinitionId,
                attribute.valueText,
                attribute.valueInteger,
                attribute.valueDecimalScaled,
                attribute.valueBoolean,
                attribute.valueDate,
                attribute.normalizedValue,
                attribute.unitCode,
                attribute.sourceType,
                attribute.sourceRef,
                input.createdBy,
                input.createdAt,
                input.createdBy,
                input.createdAt,
                input.requestId,
              ),
          ),
          ...materialApiSuccessStatements(this.database, input.transactionCompanion, {
            materialId: candidate,
            materialStatus: "DRAFT",
            version: 1,
            internalMaterialCode: null,
            oldVersion: null,
            completedAt: input.createdAt,
          }),
        ]);

        const material = await this.getMaterialForReview(candidate);
        if (!material) throw new MaterialMasterRepositoryError("WRITE_FAILED");
        return material;
      } catch (error) {
        if (isMaterialIdConflict(error)) continue;
        if (error instanceof MaterialMasterRepositoryError) throw error;
        throw new MaterialMasterRepositoryError("WRITE_FAILED");
      }
    }
    throw new MaterialMasterRepositoryError("MATERIAL_ID_CONFLICT");
  }

  async getMaterialForReview(materialId: number): Promise<MaterialRecord | null> {
    try {
      const results = await this.database.batch<MaterialRow | AttributeRow | ReviewGuardRow>([
        this.database.prepare(SELECT_MATERIAL_SQL).bind(materialId),
        this.database.prepare(SELECT_ATTRIBUTES_SQL).bind(materialId),
        this.database.prepare(SELECT_REVIEW_GUARD_SQL).bind(materialId),
      ]);
      const materialRow = resultRows(results[0] as MaterialMasterD1Result<MaterialRow>)[0];
      if (!materialRow) return null;
      const attributes = resultRows(results[1] as MaterialMasterD1Result<AttributeRow>).map(rowToAttribute);
      const guard = resultRows(results[2] as MaterialMasterD1Result<ReviewGuardRow>)[0];
      if (!guard || typeof guard.review_guard !== "string") {
        throw new MaterialMasterRepositoryError("WRITE_FAILED");
      }
      return rowToMaterial(materialRow, attributes, guard.review_guard);
    } catch (error) {
      if (error instanceof MaterialMasterRepositoryError) throw error;
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }
  }

  async getApplicableCodeRules(
    categoryId: number,
    effectiveDate: string,
  ): Promise<readonly MaterialCodeRule[]> {
    try {
      const result = await this.database
        .prepare(`
          SELECT
            id, category_id, prefix, major_segment, minor_segment, separator,
            sequence_width, next_sequence, version
          FROM material_code_rules
          WHERE category_id = ?
            AND status = 'ACTIVE'
            AND effective_from <= ?
            AND (effective_to IS NULL OR effective_to > ?)
          ORDER BY id
        `)
        .bind(categoryId, effectiveDate, effectiveDate)
        .all<CodeRuleRow>();
      return resultRows(result).map(rowToCodeRule);
    } catch {
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }
  }

  async materialCodeExists(code: string): Promise<boolean> {
    try {
      const row = await this.database
        .prepare("SELECT 1 AS found FROM material_master WHERE internal_material_code = ? LIMIT 1")
        .bind(code)
        .first<{ found: number }>();
      return row?.found === 1;
    } catch {
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }
  }

  async advanceOccupiedCodeSequence(
    rule: MaterialCodeRule,
    actor: string,
    timestamp: string,
    requestId: string,
  ): Promise<boolean> {
    try {
      const result = await this.database
        .prepare(`
          UPDATE material_code_rules
          SET next_sequence = next_sequence + 1,
              version = version + 1,
              updated_by = ?,
              updated_at = ?,
              request_id = ?
          WHERE id = ?
            AND version = ?
            AND next_sequence = ?
            AND status = 'ACTIVE'
        `)
        .bind(actor, timestamp, requestId, rule.id, rule.version, rule.nextSequence)
        .run();
      return result.meta?.changes === 1;
    } catch {
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }
  }

  async approveDraftWithCode(input: ApproveDraftWrite): Promise<MaterialRecord> {
    const nextMaterialVersion = input.expectedVersion + 1;
    const nextRuleVersion = input.rule.version + 1;
    const nextSequence = input.rule.nextSequence + 1;
    const effectiveDate = input.reviewedAt.slice(0, 10);

    try {
      await this.database.batch([
        this.database
          .prepare(`
            UPDATE material_code_rules
            SET next_sequence = next_sequence + 1,
                version = version + 1,
                updated_by = ?,
                updated_at = ?,
                request_id = ?
            WHERE id = ?
              AND version = ?
              AND next_sequence = ?
              AND status = 'ACTIVE'
              AND effective_from <= ?
              AND (effective_to IS NULL OR effective_to > ?)
          `)
          .bind(
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
            input.rule.id,
            input.rule.version,
            input.rule.nextSequence,
            effectiveDate,
            effectiveDate,
          ),
        this.database
          .prepare(`
            UPDATE material_master
            SET internal_material_code = ?,
                material_status = 'ACTIVE',
                version = version + 1,
                approved_by = ?,
                approved_at = ?,
                updated_by = ?,
                updated_at = ?,
                request_id = ?
            WHERE id = ?
              AND version = ?
              AND material_status = 'DRAFT'
              AND internal_material_code IS NULL
          `)
          .bind(
            input.code,
            input.reviewedBy,
            input.reviewedAt,
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
            input.materialId,
            input.expectedVersion,
          ),
        this.database
          .prepare(`
            INSERT INTO material_versions(
              material_id, version_no, event_type, change_reason, changed_fields_json,
              snapshot_json, changed_by, reviewed_by, reviewed_at, created_at, request_id
            ) VALUES (
              (
                SELECT m.id
                FROM material_master m
                WHERE m.id = ?
                  AND m.version = ?
                  AND m.material_status = 'ACTIVE'
                  AND m.internal_material_code = ?
                  AND m.request_id = ?
                  AND m.updated_at = ?
                  AND ${reviewGuardExpression("m")} = ?
                  AND EXISTS (
                    SELECT 1 FROM material_code_rules r
                    WHERE r.id = ?
                      AND r.version = ?
                      AND r.next_sequence = ?
                      AND r.request_id = ?
                      AND r.updated_at = ?
                  )
              ),
              ?, 'APPROVE', ?, ?, ?, ?, ?, ?, ?, ?
            )
          `)
          .bind(
            input.materialId,
            nextMaterialVersion,
            input.code,
            input.requestId,
            input.reviewedAt,
            input.reviewGuard,
            input.rule.id,
            nextRuleVersion,
            nextSequence,
            input.requestId,
            input.reviewedAt,
            nextMaterialVersion,
            input.reason,
            JSON.stringify(["material_status", "internal_material_code", "approved_by", "approved_at"]),
            input.snapshotJson,
            input.reviewedBy,
            input.reviewedBy,
            input.reviewedAt,
            input.reviewedAt,
            input.requestId,
          ),
        this.database
          .prepare(`
            INSERT INTO material_change_logs(
              material_id, change_type, field_name, old_value_json, new_value_json,
              change_reason, changed_by, created_at, request_id
            ) VALUES (?, ?, 'APPROVE', ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            input.materialId,
            MATERIAL_ACTION_CHANGE_TYPES.APPROVE,
            JSON.stringify("DRAFT"),
            JSON.stringify("ACTIVE"),
            input.reason,
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
          ),
        this.database
          .prepare(`
            INSERT INTO material_change_logs(
              material_id, change_type, field_name, old_value_json, new_value_json,
              change_reason, changed_by, created_at, request_id
            ) VALUES (?, ?, 'CODE_GENERATE', 'null', ?, ?, ?, ?, ?)
          `)
          .bind(
            input.materialId,
            MATERIAL_ACTION_CHANGE_TYPES.CODE_GENERATE,
            JSON.stringify(input.code),
            input.reason,
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
          ),
        ...materialApiSuccessStatements(this.database, input.transactionCompanion, {
          materialId: input.materialId,
          materialStatus: "ACTIVE",
          version: nextMaterialVersion,
          internalMaterialCode: input.code,
          oldVersion: input.expectedVersion,
          completedAt: input.reviewedAt,
        }),
      ]);
    } catch {
      await this.throwApprovalConflict(input);
    }

    const material = await this.getMaterialForReview(input.materialId);
    if (!material) throw new MaterialMasterRepositoryError("WRITE_FAILED");
    return material;
  }

  async rejectDraft(input: RejectDraftWrite): Promise<MaterialRecord> {
    const nextVersion = input.expectedVersion + 1;
    try {
      await this.database.batch([
        this.database
          .prepare(`
            UPDATE material_master
            SET version = version + 1,
                updated_by = ?,
                updated_at = ?,
                request_id = ?
            WHERE id = ?
              AND version = ?
              AND material_status = 'DRAFT'
              AND internal_material_code IS NULL
          `)
          .bind(
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
            input.materialId,
            input.expectedVersion,
          ),
        this.database
          .prepare(`
            INSERT INTO material_versions(
              material_id, version_no, event_type, change_reason, changed_fields_json,
              snapshot_json, changed_by, reviewed_by, reviewed_at, created_at, request_id
            ) VALUES (
              (
                SELECT m.id FROM material_master m
                WHERE m.id = ?
                  AND m.version = ?
                  AND m.material_status = 'DRAFT'
                  AND m.internal_material_code IS NULL
                  AND m.updated_by = ?
                  AND m.updated_at = ?
                  AND m.request_id = ?
                  AND ${reviewGuardExpression("m")} = ?
              ),
              ?, 'REJECT', ?, ?, ?, ?, ?, ?, ?, ?
            )
          `)
          .bind(
            input.materialId,
            nextVersion,
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
            input.reviewGuard,
            nextVersion,
            input.reason,
            JSON.stringify(["review_result"]),
            input.snapshotJson,
            input.reviewedBy,
            input.reviewedBy,
            input.reviewedAt,
            input.reviewedAt,
            input.requestId,
          ),
        this.database
          .prepare(`
            INSERT INTO material_change_logs(
              material_id, change_type, field_name, old_value_json, new_value_json,
              change_reason, changed_by, created_at, request_id
            ) VALUES (?, ?, 'REJECT', 'null', ?, ?, ?, ?, ?)
          `)
          .bind(
            input.materialId,
            MATERIAL_ACTION_CHANGE_TYPES.REJECT,
            JSON.stringify({ result: "REJECT", material_status: "DRAFT" }),
            input.reason,
            input.reviewedBy,
            input.reviewedAt,
            input.requestId,
          ),
        ...materialApiSuccessStatements(this.database, input.transactionCompanion, {
          materialId: input.materialId,
          materialStatus: "DRAFT",
          version: nextVersion,
          internalMaterialCode: null,
          oldVersion: input.expectedVersion,
          completedAt: input.reviewedAt,
        }),
      ]);
    } catch {
      const material = await this.getMaterialForReview(input.materialId);
      if (
        !material ||
        material.version !== input.expectedVersion ||
        material.materialStatus !== "DRAFT" ||
        material.reviewGuard !== input.reviewGuard
      ) {
        throw new MaterialMasterRepositoryError("MATERIAL_VERSION_CONFLICT");
      }
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }

    const material = await this.getMaterialForReview(input.materialId);
    if (!material) throw new MaterialMasterRepositoryError("WRITE_FAILED");
    return material;
  }

  private async nextMaterialId(): Promise<number> {
    try {
      const row = await this.database
        .prepare(`
          SELECT COALESCE(
            (SELECT seq FROM sqlite_sequence WHERE name = 'material_master'),
            0
          ) + 1 AS candidate_id
        `)
        .first<{ candidate_id: number }>();
      if (!row || !Number.isSafeInteger(row.candidate_id) || row.candidate_id <= 0) {
        throw new MaterialMasterRepositoryError("WRITE_FAILED");
      }
      return row.candidate_id;
    } catch (error) {
      if (error instanceof MaterialMasterRepositoryError) throw error;
      throw new MaterialMasterRepositoryError("WRITE_FAILED");
    }
  }

  private async throwApprovalConflict(input: ApproveDraftWrite): Promise<never> {
    try {
      const material = await this.getMaterialForReview(input.materialId);
      if (
        !material ||
        material.version !== input.expectedVersion ||
        material.materialStatus !== "DRAFT" ||
        material.internalMaterialCode !== null ||
        material.reviewGuard !== input.reviewGuard
      ) {
        throw new MaterialMasterRepositoryError("MATERIAL_VERSION_CONFLICT");
      }

      if (await this.materialCodeExists(input.code)) {
        throw new MaterialMasterRepositoryError("CODE_DUPLICATE");
      }

      const row = await this.database
        .prepare("SELECT version, next_sequence FROM material_code_rules WHERE id = ? LIMIT 1")
        .bind(input.rule.id)
        .first<{ version: number; next_sequence: number }>();
      if (
        !row ||
        row.version !== input.rule.version ||
        row.next_sequence !== input.rule.nextSequence
      ) {
        throw new MaterialMasterRepositoryError("CODE_SEQUENCE_CONFLICT");
      }
    } catch (error) {
      if (error instanceof MaterialMasterRepositoryError) throw error;
    }
    throw new MaterialMasterRepositoryError("WRITE_FAILED");
  }
}

export function createD1MaterialMasterRepository(
  database: MaterialMasterD1Database,
): MaterialMasterRepository {
  return new D1MaterialMasterRepository(database);
}
