import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const auditColumns = {
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  requestId: text("request_id").notNull(),
};

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appUsers = sqliteTable("app_users", {
  username: text("username").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: integer("is_active").notNull().default(1),
  mustChangePassword: integer("must_change_password").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text("last_login_at").notNull().default(""),
});

export const appSessions = sqliteTable(
  "app_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    username: text("username").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("app_sessions_username_idx").on(table.username)],
);

export const erpRecords = sqliteTable(
  "erp_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    dataJson: text("data_json").notNull().default("{}"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("erp_records_kind_code_uq").on(table.kind, table.code),
    index("erp_records_kind_idx").on(table.kind),
  ],
);

export const inventoryBalances = sqliteTable("inventory_balances", {
  itemCode: text("item_code").primaryKey(),
  onHandQty: real("on_hand_qty").notNull().default(0),
  reservedQty: real("reserved_qty").notNull().default(0),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const inventoryTransactions = sqliteTable(
  "inventory_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemCode: text("item_code").notNull(),
    txnType: text("txn_type").notNull(),
    qty: real("qty").notNull(),
    refType: text("ref_type").notNull().default(""),
    refNo: text("ref_no").notNull().default(""),
    beforeQty: real("before_qty").notNull().default(0),
    afterQty: real("after_qty").notNull().default(0),
    createdBy: text("created_by").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("inventory_transactions_item_idx").on(table.itemCode)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().default(""),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    requestId: text("request_id").notNull().default(""),
    result: text("result").notNull().default("success"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_log_created_at_idx").on(table.createdAt)],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    username: text("username").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    responseJson: text("response_json").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idempotency_keys_expires_at_idx").on(table.expiresAt)],
);

export const materialCategories = sqliteTable(
  "material_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryCode: text("category_code").notNull(),
    categoryNameCn: text("category_name_cn").notNull(),
    categoryNameEn: text("category_name_en").notNull().default(""),
    parentId: integer("parent_id").references((): ReturnType<typeof integer> => materialCategories.id),
    categoryLevel: integer("category_level").notNull(),
    status: text("status").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    description: text("description").notNull().default(""),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("material_categories_code_uq").on(table.categoryCode),
    index("material_categories_parent_status_sort_idx").on(table.parentId, table.status, table.sortOrder),
    index("material_categories_level_status_idx").on(table.categoryLevel, table.status),
    check("material_categories_level_ck", sql`${table.categoryLevel} BETWEEN 1 AND 4`),
    check("material_categories_status_ck", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const materialMaster = sqliteTable(
  "material_master",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    internalMaterialCode: text("internal_material_code"),
    standardName: text("standard_name").notNull(),
    categoryId: integer("category_id").notNull().references(() => materialCategories.id),
    brand: text("brand").notNull().default(""),
    manufacturer: text("manufacturer").notNull().default(""),
    manufacturerPartNumber: text("manufacturer_part_number").notNull().default(""),
    baseUom: text("base_uom").notNull(),
    materialStatus: text("material_status").notNull(),
    procurementType: text("procurement_type").notNull(),
    inventoryType: text("inventory_type").notNull(),
    lotControlRequired: integer("lot_control_required").notNull().default(0),
    shelfLifeDays: integer("shelf_life_days"),
    inspectionType: text("inspection_type").notNull(),
    environmentalRequirement: text("environmental_requirement").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    version: integer("version").notNull().default(1),
    approvedBy: text("approved_by").notNull().default(""),
    approvedAt: text("approved_at"),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("material_master_internal_code_uq").on(table.internalMaterialCode).where(sql`${table.internalMaterialCode} IS NOT NULL`),
    index("material_master_candidate_idx").on(table.categoryId, table.manufacturer, table.manufacturerPartNumber),
    index("material_master_status_updated_idx").on(table.materialStatus, table.updatedAt),
    index("material_master_category_status_idx").on(table.categoryId, table.materialStatus),
    index("material_master_standard_name_idx").on(table.standardName),
    check("material_master_status_ck", sql`${table.materialStatus} IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'FROZEN', 'INACTIVE')`),
    check("material_master_code_after_approval_ck", sql`(${table.materialStatus} IN ('DRAFT', 'PENDING_APPROVAL') AND ${table.internalMaterialCode} IS NULL) OR (${table.materialStatus} IN ('ACTIVE', 'FROZEN', 'INACTIVE') AND ${table.internalMaterialCode} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.approvedBy} <> '')`),
    check("material_master_procurement_type_ck", sql`${table.procurementType} IN ('PURCHASE', 'OUTSOURCE', 'SELF_MADE', 'NON_PURCHASABLE')`),
    check("material_master_inventory_type_ck", sql`${table.inventoryType} IN ('STOCKED', 'NON_STOCKED', 'CONSIGNMENT')`),
    check("material_master_lot_control_ck", sql`${table.lotControlRequired} IN (0, 1)`),
    check("material_master_shelf_life_ck", sql`${table.shelfLifeDays} IS NULL OR ${table.shelfLifeDays} >= 0`),
    check("material_master_inspection_type_ck", sql`${table.inspectionType} IN ('NONE', 'NORMAL', 'TIGHTENED', 'REDUCED', 'FULL')`),
    check("material_master_environmental_ck", sql`${table.environmentalRequirement} IN ('UNSPECIFIED', 'ROHS', 'ROHS_REACH', 'HALOGEN_FREE', 'CUSTOMER_SPECIFIC')`),
  ],
);

export const materialAttributeDefinitions = sqliteTable(
  "material_attribute_definitions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }), attributeCode: text("attribute_code").notNull(),
    attributeNameCn: text("attribute_name_cn").notNull(), attributeNameEn: text("attribute_name_en").notNull().default(""),
    dataType: text("data_type").notNull(), decimalScale: integer("decimal_scale").notNull().default(0),
    canonicalUnit: text("canonical_unit").notNull().default(""), allowedValuesJson: text("allowed_values_json").notNull().default("[]"),
    normalizationRule: text("normalization_rule").notNull(), status: text("status").notNull(), version: integer("version").notNull().default(1),
    approvedBy: text("approved_by").notNull().default(""), approvedAt: text("approved_at"), ...auditColumns,
  },
  (table) => [uniqueIndex("material_attribute_definitions_code_uq").on(table.attributeCode),
    check("material_attribute_definitions_type_ck", sql`${table.dataType} IN ('TEXT','INTEGER','DECIMAL','BOOLEAN','DATE','ENUM')`),
    check("material_attribute_definitions_scale_ck", sql`${table.decimalScale} BETWEEN 0 AND 9`),
    check("material_attribute_definitions_normalization_ck", sql`${table.normalizationRule} IN ('NONE','TRIM_UPPER','DECIMAL_SCALE','ENUM_CODE','DATE_ISO')`),
    check("material_attribute_definitions_status_ck", sql`${table.status} IN ('ACTIVE','INACTIVE')`)],
);

export const materialCategoryAttributes = sqliteTable(
  "material_category_attributes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }), categoryId: integer("category_id").notNull().references(() => materialCategories.id),
    attributeDefinitionId: integer("attribute_definition_id").notNull().references(() => materialAttributeDefinitions.id),
    isRequired: integer("is_required").notNull().default(0), isUniqueKeyComponent: integer("is_unique_key_component").notNull().default(0),
    isSearchable: integer("is_searchable").notNull().default(1), sortOrder: integer("sort_order").notNull().default(0), status: text("status").notNull(), ...auditColumns,
  },
  (table) => [uniqueIndex("material_category_attributes_category_definition_uq").on(table.categoryId, table.attributeDefinitionId),
    index("material_category_attributes_category_status_sort_idx").on(table.categoryId, table.status, table.sortOrder),
    check("material_category_attributes_flags_ck", sql`${table.isRequired} IN (0,1) AND ${table.isUniqueKeyComponent} IN (0,1) AND ${table.isSearchable} IN (0,1)`),
    check("material_category_attributes_status_ck", sql`${table.status} IN ('ACTIVE','INACTIVE')`)],
);

export const materialAttributeValues = sqliteTable(
  "material_attribute_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }), materialId: integer("material_id").notNull().references(() => materialMaster.id),
    attributeDefinitionId: integer("attribute_definition_id").notNull().references(() => materialAttributeDefinitions.id), valueText: text("value_text"),
    valueInteger: integer("value_integer"), valueDecimalScaled: integer("value_decimal_scaled"), valueBoolean: integer("value_boolean"), valueDate: text("value_date"),
    normalizedValue: text("normalized_value").notNull(), unitCode: text("unit_code").notNull().default(""), sourceType: text("source_type").notNull(), sourceRef: text("source_ref").notNull(), ...auditColumns,
  },
  (table) => [uniqueIndex("material_attribute_values_material_definition_uq").on(table.materialId, table.attributeDefinitionId),
    index("material_attribute_values_definition_normalized_idx").on(table.attributeDefinitionId, table.normalizedValue),
    check("material_attribute_values_boolean_ck", sql`${table.valueBoolean} IS NULL OR ${table.valueBoolean} IN (0,1)`),
    check("material_attribute_values_single_value_ck", sql`((${table.valueText} IS NOT NULL) + (${table.valueInteger} IS NOT NULL) + (${table.valueDecimalScaled} IS NOT NULL) + (${table.valueBoolean} IS NOT NULL) + (${table.valueDate} IS NOT NULL)) = 1`)],
);

export const supplierMappings = sqliteTable(
  "supplier_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }), materialId: integer("material_id").notNull().references(() => materialMaster.id),
    supplierName: text("supplier_name").notNull(), supplierKey: text("supplier_key").notNull(), supplierItemCode: text("supplier_item_code").notNull(),
    supplierItemName: text("supplier_item_name").notNull().default(""), supplierSpecification: text("supplier_specification").notNull().default(""),
    manufacturer: text("manufacturer").notNull().default(""), mpn: text("mpn").notNull().default(""), revision: text("revision").notNull().default(""),
    purchaseUom: text("purchase_uom").notNull(), uomConversionNumerator: integer("uom_conversion_numerator").notNull().default(1),
    uomConversionDenominator: integer("uom_conversion_denominator").notNull().default(1), minimumOrderQtyScaled: integer("minimum_order_qty_scaled"),
    quantityScale: integer("quantity_scale").notNull().default(0), status: text("status").notNull(),
    supersedesMappingId: integer("supersedes_mapping_id").references((): ReturnType<typeof integer> => supplierMappings.id), validFrom: text("valid_from").notNull(), validTo: text("valid_to"),
    sourceType: text("source_type").notNull(), sourceRef: text("source_ref").notNull(), version: integer("version").notNull().default(1),
    approvedBy: text("approved_by").notNull().default(""), approvedAt: text("approved_at"), ...auditColumns,
  },
  (table) => [
    uniqueIndex("supplier_mappings_identity_period_uq").on(table.supplierKey, table.supplierItemCode, table.manufacturer, table.mpn, table.revision, table.validFrom),
    uniqueIndex("supplier_mappings_current_identity_uq").on(table.supplierKey, table.supplierItemCode, table.manufacturer, table.mpn, table.revision).where(sql`${table.validTo} IS NULL`),
    index("supplier_mappings_material_idx").on(table.materialId), index("supplier_mappings_supersedes_idx").on(table.supersedesMappingId),
    index("supplier_mappings_mpn_manufacturer_idx").on(table.mpn, table.manufacturer), index("supplier_mappings_status_updated_idx").on(table.status, table.updatedAt),
    check("supplier_mappings_conversion_ck", sql`${table.uomConversionNumerator} > 0 AND ${table.uomConversionDenominator} > 0`),
    check("supplier_mappings_moq_ck", sql`${table.minimumOrderQtyScaled} IS NULL OR ${table.minimumOrderQtyScaled} >= 0`),
    check("supplier_mappings_scale_ck", sql`${table.quantityScale} BETWEEN 0 AND 6`), check("supplier_mappings_status_ck", sql`${table.status} IN ('PENDING','ACTIVE','INACTIVE','REJECTED')`),
    check("supplier_mappings_validity_ck", sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`),
  ],
);

export const supplierMappingPriceHistory = sqliteTable("supplier_mapping_price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }), supplierMappingId: integer("supplier_mapping_id").notNull().references(() => supplierMappings.id),
  priceScaled: integer("price_scaled").notNull(), priceScale: integer("price_scale").notNull(), currencyCode: text("currency_code").notNull(), priceUom: text("price_uom").notNull(),
  minimumOrderQtyScaled: integer("minimum_order_qty_scaled"), quantityScale: integer("quantity_scale").notNull().default(0), effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"),
  sourceDocumentRef: text("source_document_ref").notNull().default(""), createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), requestId: text("request_id").notNull(),
}, (table) => [index("supplier_mapping_price_history_from_idx").on(table.supplierMappingId, table.effectiveFrom), index("supplier_mapping_price_history_to_idx").on(table.supplierMappingId, table.effectiveTo),
  check("supplier_mapping_price_history_price_ck", sql`${table.priceScaled} >= 0 AND ${table.priceScale} BETWEEN 0 AND 6`), check("supplier_mapping_price_history_qty_ck", sql`(${table.minimumOrderQtyScaled} IS NULL OR ${table.minimumOrderQtyScaled} >= 0) AND ${table.quantityScale} BETWEEN 0 AND 6`),
  check("supplier_mapping_price_history_validity_ck", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`)]);

export const materialVersions = sqliteTable("material_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }), materialId: integer("material_id").notNull().references(() => materialMaster.id), versionNo: integer("version_no").notNull(),
  eventType: text("event_type").notNull(), changeReason: text("change_reason").notNull().default(""), changedFieldsJson: text("changed_fields_json").notNull().default("[]"),
  snapshotJson: text("snapshot_json").notNull(), changedBy: text("changed_by").notNull(), reviewedBy: text("reviewed_by").notNull().default(""), reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), requestId: text("request_id").notNull(),
}, (table) => [uniqueIndex("material_versions_material_version_uq").on(table.materialId, table.versionNo), index("material_versions_material_created_idx").on(table.materialId, table.createdAt),
  index("material_versions_event_created_idx").on(table.eventType, table.createdAt), check("material_versions_version_ck", sql`${table.versionNo} > 0`),
  check("material_versions_event_ck", sql`${table.eventType} IN ('CREATE','UPDATE','SUBMIT','APPROVE','REJECT','FREEZE','DEACTIVATE')`)]);

export const materialChangeLogs = sqliteTable("material_change_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }), materialId: integer("material_id").notNull().references(() => materialMaster.id),
  changeType: text("change_type").notNull(), fieldName: text("field_name").notNull(), oldValueJson: text("old_value_json").notNull().default("null"),
  newValueJson: text("new_value_json").notNull().default("null"), changeReason: text("change_reason").notNull().default(""), changedBy: text("changed_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), requestId: text("request_id").notNull(),
}, (table) => [index("material_change_logs_material_created_idx").on(table.materialId, table.createdAt), index("material_change_logs_request_idx").on(table.requestId),
  check("material_change_logs_type_ck", sql`${table.changeType} IN ('CREATE','UPDATE','STATUS_CHANGE','APPROVAL','REJECTION','CODE_ASSIGNMENT')`)]);

export const materialAliases = sqliteTable("material_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }), materialId: integer("material_id").notNull().references(() => materialMaster.id), aliasType: text("alias_type").notNull(),
  aliasText: text("alias_text").notNull(), normalizedAlias: text("normalized_alias").notNull(), languageCode: text("language_code").notNull().default(""), isPrimary: integer("is_primary").notNull().default(0),
  status: text("status").notNull(), sourceType: text("source_type").notNull(), sourceRef: text("source_ref").notNull(), ...auditColumns,
}, (table) => [uniqueIndex("material_aliases_material_type_normalized_uq").on(table.materialId, table.aliasType, table.normalizedAlias),
  check("material_aliases_type_ck", sql`${table.aliasType} IN ('CHINESE_NAME','ENGLISH_NAME','SUPPLIER_NAME','LEGACY_NAME','INTERNAL_SHORT_NAME','LEGACY_CODE')`),
  check("material_aliases_primary_ck", sql`${table.isPrimary} IN (0,1)`), check("material_aliases_status_ck", sql`${table.status} IN ('ACTIVE','INACTIVE')`)]);

export const materialCodeRules = sqliteTable("material_code_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }), ruleCode: text("rule_code").notNull(), ruleName: text("rule_name").notNull(), categoryId: integer("category_id").notNull().references(() => materialCategories.id),
  prefix: text("prefix").notNull().default("CYD"), majorSegment: text("major_segment").notNull(), minorSegment: text("minor_segment").notNull(), separator: text("separator").notNull().default("-"),
  sequenceWidth: integer("sequence_width").notNull().default(6), nextSequence: integer("next_sequence").notNull().default(1), status: text("status").notNull(), effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"),
  version: integer("version").notNull().default(1), approvedBy: text("approved_by").notNull().default(""), approvedAt: text("approved_at"), ...auditColumns,
}, (table) => [uniqueIndex("material_code_rules_code_uq").on(table.ruleCode), index("material_code_rules_category_status_idx").on(table.categoryId, table.status),
  check("material_code_rules_width_ck", sql`${table.sequenceWidth} BETWEEN 4 AND 12`), check("material_code_rules_sequence_ck", sql`${table.nextSequence} > 0`),
  check("material_code_rules_status_ck", sql`${table.status} IN ('ACTIVE','INACTIVE')`), check("material_code_rules_validity_ck", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`)]);

export const legacyMaterialMapping = sqliteTable("legacy_material_mapping", {
  id: integer("id").primaryKey({ autoIncrement: true }), materialId: integer("material_id").notNull().references(() => materialMaster.id), sourceType: text("source_type").notNull(),
  sourceTable: text("source_table").notNull(), sourceKey: text("source_key").notNull(), sourceCode: text("source_code").notNull().default(""), sourceName: text("source_name").notNull().default(""),
  sourceSnapshotHash: text("source_snapshot_hash").notNull(), mappingMethod: text("mapping_method").notNull(), status: text("status").notNull(), mappedBy: text("mapped_by").notNull(),
  approvedBy: text("approved_by").notNull(), approvedAt: text("approved_at").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`), requestId: text("request_id").notNull(),
}, (table) => [uniqueIndex("legacy_material_mapping_source_identity_uq").on(table.sourceType, table.sourceTable, table.sourceKey), index("legacy_material_mapping_material_idx").on(table.materialId),
  index("legacy_material_mapping_source_code_idx").on(table.sourceType, table.sourceCode), index("legacy_material_mapping_snapshot_hash_idx").on(table.sourceSnapshotHash),
  check("legacy_material_mapping_source_type_ck", sql`${table.sourceType} IN ('LEGACY_D1','LEGACY_SQLITE','GOVERNANCE_TEMPLATE')`),
  check("legacy_material_mapping_method_ck", sql`${table.mappingMethod} IN ('MANUAL','EXACT_CODE','APPROVED_MERGE')`), check("legacy_material_mapping_status_ck", sql`${table.status} IN ('ACTIVE','SUPERSEDED')`)]);
