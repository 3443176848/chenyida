import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const auditColumns = {
  createdBy: text("created_by").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  requestId: uuid("request_id").notNull(),
};

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(), value: text("value").notNull(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const appUsers = pgTable("app_users", {
  username: text("username").primaryKey(), displayName: text("display_name").notNull(), role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(), isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false), version: integer("version").notNull().default(1),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(), lastLoginAt: timestamptz("last_login_at"),
}, (t) => [check("app_users_version_ck", sql`${t.version} > 0`)]);

export const appSessions = pgTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(), username: text("username").notNull().references(() => appUsers.username, { onDelete: "cascade" }),
  expiresAt: timestamptz("expires_at").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("app_sessions_username_idx").on(t.username), index("app_sessions_expiry_idx").on(t.expiresAt)]);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(), username: text("username").notNull().default(""), action: text("action").notNull(),
  detail: jsonb("detail").notNull().default({}), requestId: uuid("request_id").notNull(), result: text("result").notNull().default("success"),
  routeCode: text("route_code").notNull().default(""), materialId: bigint("material_id", { mode: "number" }), operationId: uuid("operation_id"),
  idempotencyKeyDigest: text("idempotency_key_digest"), oldVersion: integer("old_version"), newVersion: integer("new_version"), errorCode: text("error_code"),
  retentionUntil: timestamptz("retention_until"), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("audit_log_created_at_idx").on(t.createdAt), index("audit_log_request_id_idx").on(t.requestId), index("audit_log_material_created_idx").on(t.materialId, t.createdAt)]);

export const materialCategories = pgTable("material_categories", {
  id: bigserial("id", { mode: "number" }).primaryKey(), categoryCode: text("category_code").notNull(), categoryNameCn: text("category_name_cn").notNull(),
  categoryNameEn: text("category_name_en").notNull().default(""), parentId: bigint("parent_id", { mode: "number" }), categoryLevel: integer("category_level").notNull(),
  status: text("status").notNull().default("ACTIVE"), sortOrder: integer("sort_order").notNull().default(0), description: text("description").notNull().default(""),
  version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [uniqueIndex("material_categories_code_uq").on(t.categoryCode), index("material_categories_parent_status_sort_idx").on(t.parentId, t.status, t.sortOrder), check("material_categories_level_ck", sql`${t.categoryLevel} between 1 and 4`), check("material_categories_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`)]);

export const units = pgTable("units", {
  id: bigserial("id", { mode: "number" }).primaryKey(), code: text("code").notNull(), name: text("name").notNull(), symbol: text("symbol").notNull(),
  unitType: text("unit_type").notNull(), enabled: boolean("enabled").notNull().default(true), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("units_code_uq").on(t.code)]);

export const brands = pgTable("brands", {
  id: bigserial("id", { mode: "number" }).primaryKey(), code: text("code").notNull(), standardName: text("standard_name").notNull(), normalizedName: text("normalized_name").notNull(),
  enabled: boolean("enabled").notNull().default(true), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("brands_code_uq").on(t.code), uniqueIndex("brands_normalized_name_uq").on(t.normalizedName)]);

export const materialMaster = pgTable("material_master", {
  id: bigserial("id", { mode: "number" }).primaryKey(), internalMaterialCode: text("internal_material_code"), standardName: text("standard_name").notNull(),
  categoryId: bigint("category_id", { mode: "number" }).notNull().references(() => materialCategories.id, { onDelete: "restrict" }), brand: text("brand").notNull().default(""),
  brandId: bigint("brand_id", { mode: "number" }).references(() => brands.id, { onDelete: "restrict" }), manufacturer: text("manufacturer").notNull().default(""),
  manufacturerPartNumber: text("manufacturer_part_number").notNull().default(""), baseUom: text("base_uom").notNull(), baseUnitId: bigint("base_unit_id", { mode: "number" }).references(() => units.id, { onDelete: "restrict" }),
  materialStatus: text("material_status").notNull().default("DRAFT"), procurementType: text("procurement_type").notNull(), inventoryType: text("inventory_type").notNull(),
  lotControlRequired: boolean("lot_control_required").notNull().default(false), shelfLifeDays: integer("shelf_life_days"), inspectionType: text("inspection_type").notNull(),
  environmentalRequirement: text("environmental_requirement").notNull(), sourceType: text("source_type").notNull(), sourceRef: text("source_ref").notNull().default(""),
  sourceImportBatchId: bigint("source_import_batch_id", { mode: "number" }), sourceImportFileId: bigint("source_import_file_id", { mode: "number" }), sourceImportRowId: bigint("source_import_row_id", { mode: "number" }),
  version: integer("version").notNull().default(1), lastModifiedBy: text("last_modified_by").notNull(), submittedBy: text("submitted_by").notNull().default(""),
  submittedAt: timestamptz("submitted_at"), approvedBy: text("approved_by").notNull().default(""), approvedAt: timestamptz("approved_at"), ...auditColumns,
}, (t) => [uniqueIndex("material_master_internal_code_uq").on(t.internalMaterialCode).where(sql`${t.internalMaterialCode} is not null`), index("material_master_status_updated_idx").on(t.materialStatus, t.updatedAt), index("material_master_category_status_idx").on(t.categoryId, t.materialStatus), index("material_master_review_queue_idx").on(t.materialStatus, t.submittedAt, t.id), check("material_master_version_ck", sql`${t.version} > 0`), check("material_master_status_ck", sql`${t.materialStatus} in ('DRAFT','PENDING_REVIEW','ACTIVE','FROZEN','INACTIVE')`), check("material_master_draft_code_ck", sql`${t.materialStatus} not in ('DRAFT','PENDING_REVIEW') or ${t.internalMaterialCode} is null`), check("material_master_active_code_ck", sql`${t.materialStatus} <> 'ACTIVE' or ${t.internalMaterialCode} is not null`)]);

export const materialAttributeDefinitions = pgTable("material_attribute_definitions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), attributeCode: text("attribute_code").notNull(), attributeNameCn: text("attribute_name_cn").notNull(), attributeNameEn: text("attribute_name_en").notNull().default(""),
  dataType: text("data_type").notNull(), decimalScale: integer("decimal_scale").notNull().default(0), canonicalUnit: text("canonical_unit").notNull().default(""), allowedValues: jsonb("allowed_values").notNull().default([]),
  normalizationRule: text("normalization_rule").notNull(), status: text("status").notNull(), version: integer("version").notNull().default(1), approvedBy: text("approved_by").notNull().default(""), approvedAt: timestamptz("approved_at"), ...auditColumns,
}, (t) => [uniqueIndex("material_attribute_definitions_code_uq").on(t.attributeCode)]);

export const materialCategoryAttributes = pgTable("material_category_attributes", {
  id: bigserial("id", { mode: "number" }).primaryKey(), categoryId: bigint("category_id", { mode: "number" }).notNull().references(() => materialCategories.id, { onDelete: "restrict" }),
  attributeDefinitionId: bigint("attribute_definition_id", { mode: "number" }).notNull().references(() => materialAttributeDefinitions.id, { onDelete: "restrict" }),
  isRequired: boolean("is_required").notNull().default(false), isUniqueKeyComponent: boolean("is_unique_key_component").notNull().default(false), isSearchable: boolean("is_searchable").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0), status: text("status").notNull(), ...auditColumns,
}, (t) => [uniqueIndex("material_category_attributes_category_definition_uq").on(t.categoryId, t.attributeDefinitionId)]);

export const materialAttributeValues = pgTable("material_attribute_values", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "cascade" }),
  attributeDefinitionId: bigint("attribute_definition_id", { mode: "number" }).notNull().references(() => materialAttributeDefinitions.id, { onDelete: "restrict" }),
  value: jsonb("value").notNull(), normalizedValue: text("normalized_value").notNull(), unitCode: text("unit_code").notNull().default(""), sourceType: text("source_type").notNull(), sourceRef: text("source_ref").notNull().default(""), ...auditColumns,
}, (t) => [uniqueIndex("material_attribute_values_material_definition_uq").on(t.materialId, t.attributeDefinitionId), index("material_attribute_values_definition_normalized_idx").on(t.attributeDefinitionId, t.normalizedValue)]);

export const materialVersions = pgTable("material_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), versionNo: integer("version_no").notNull(),
  eventType: text("event_type").notNull(), changeReason: text("change_reason").notNull().default(""), changedFields: jsonb("changed_fields").notNull().default([]), snapshot: jsonb("snapshot").notNull(),
  changedBy: text("changed_by").notNull(), reviewedBy: text("reviewed_by").notNull().default(""), reviewedAt: timestamptz("reviewed_at"), createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [uniqueIndex("material_versions_material_version_uq").on(t.materialId, t.versionNo), index("material_versions_material_created_idx").on(t.materialId, t.createdAt), index("material_versions_material_event_idx").on(t.materialId, t.eventType, t.versionNo)]);

export const materialImportBatches = pgTable("material_import_batches", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchNo: text("batch_no").notNull(), sourceKind: text("source_kind").notNull(), status: text("status").notNull().default("CREATED"),
  retryOfBatchId: bigint("retry_of_batch_id", { mode: "number" }), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  currentVersion: integer("current_version").notNull().default(1), currentParseRunId: bigint("current_parse_run_id", { mode: "number" }), currentNormalizationRunId: bigint("current_normalization_run_id", { mode: "number" }),
  fileCount: integer("file_count").notNull().default(0), totalRows: integer("total_rows").notNull().default(0), acceptedRows: integer("accepted_rows").notNull().default(0), rejectedRows: integer("rejected_rows").notNull().default(0),
  failureStage: text("failure_stage"), failureCode: text("failure_code"), failureMessage: text("failure_message"), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_batches_no_uq").on(t.batchNo), index("material_import_batches_owner_created_idx").on(t.createdBy, t.createdAt), index("material_import_batches_status_created_idx").on(t.status, t.createdAt), check("material_import_batches_version_ck", sql`${t.currentVersion} > 0`)]);

export const materialImportFiles = pgTable("material_import_files", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
  storageName: uuid("storage_name").notNull(), relativePath: text("relative_path").notNull(), originalFilename: text("original_filename").notNull(), mimeType: text("mime_type").notNull(), sha256: text("sha256").notNull(), sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageStatus: text("storage_status").notNull().default("STORED"), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_files_batch_uq").on(t.batchId), uniqueIndex("material_import_files_path_uq").on(t.relativePath), index("material_import_files_sha_idx").on(t.sha256), check("material_import_files_sha_ck", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`), check("material_import_files_size_ck", sql`${t.sizeBytes} > 0`)]);

export const materialImportRows = pgTable("material_import_rows", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
  parseRunId: bigint("parse_run_id", { mode: "number" }).notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").notNull(), sheetIndex: integer("sheet_index").notNull().default(0), sheetName: text("sheet_name").notNull().default("CSV"), rowNumber: integer("row_number").notNull(), rawValues: jsonb("raw_values").notNull(), rawRowHash: text("raw_row_hash").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_rows_run_position_uq").on(t.parseRunId, t.sheetIndex, t.rowNumber), index("material_import_rows_batch_run_idx").on(t.batchId, t.parseRunId, t.sheetIndex, t.rowNumber)]);

export const materialImportJobOutbox = pgTable("material_import_job_outbox", {
  id: uuid("id").primaryKey(), aggregateType: text("aggregate_type").notNull(), aggregateId: text("aggregate_id").notNull(), jobType: text("job_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), payload: jsonb("payload").notNull(), status: text("status").notNull().default("PENDING"),
  attemptCount: integer("attempt_count").notNull().default(0), availableAt: timestamptz("available_at").notNull().defaultNow(), publishedAt: timestamptz("published_at"), lastErrorCode: text("last_error_code"),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_job_outbox_idempotency_uq").on(t.idempotencyKey), index("material_import_job_outbox_pending_idx").on(t.status, t.availableAt)]);

export const backgroundJobs = pgTable("background_jobs", {
  id: uuid("id").primaryKey(), type: text("type").notNull(), idempotencyKey: text("idempotency_key").notNull(), payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("QUEUED"), priority: integer("priority").notNull().default(100), attemptCount: integer("attempt_count").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5),
  availableAt: timestamptz("available_at").notNull().defaultNow(), leaseOwner: text("lease_owner"), leaseToken: uuid("lease_token"), leaseExpiresAt: timestamptz("lease_expires_at"), heartbeatAt: timestamptz("heartbeat_at"),
  result: jsonb("result"), lastErrorCode: text("last_error_code"), lastErrorMessage: text("last_error_message"), version: integer("version").notNull().default(1),
  createdAt: timestamptz("created_at").notNull().defaultNow(), startedAt: timestamptz("started_at"), completedAt: timestamptz("completed_at"), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("background_jobs_idempotency_uq").on(t.idempotencyKey), index("background_jobs_claim_idx").on(t.status, t.availableAt, t.priority, t.createdAt), index("background_jobs_lease_idx").on(t.status, t.leaseExpiresAt), check("background_jobs_status_ck", sql`${t.status} in ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD','CANCELLED')`), check("background_jobs_attempt_ck", sql`${t.attemptCount} >= 0 and ${t.maxAttempts} > 0 and ${t.attemptCount} <= ${t.maxAttempts}`), check("background_jobs_version_ck", sql`${t.version} > 0`)]);

export const materialImportEvents = pgTable("material_import_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(), actorType: text("actor_type").notNull(), actorIdentifier: text("actor_identifier"), previousStatus: text("previous_status"), newStatus: text("new_status"), requestId: uuid("request_id").notNull(), safeDetails: jsonb("safe_details").notNull().default({}), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("material_import_events_batch_created_idx").on(t.batchId, t.createdAt)]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  keyDigest: text("key_digest").primaryKey(), username: text("username").notNull(), method: text("method").notNull(), path: text("path").notNull(), requestDigest: text("request_digest").notNull(),
  statusCode: integer("status_code").notNull(), response: jsonb("response").notNull(), expiresAt: timestamptz("expires_at").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("idempotency_keys_expiry_idx").on(t.expiresAt)]);

export const inventoryBalances = pgTable("inventory_balances", {
  itemCode: text("item_code").primaryKey(), onHandQty: numeric("on_hand_qty", { precision: 24, scale: 6 }).notNull().default("0"), reservedQty: numeric("reserved_qty", { precision: 24, scale: 6 }).notNull().default("0"), version: integer("version").notNull().default(1), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

// Compatibility tables retained from the D1 implementation. PostgreSQL uses
// native boolean/jsonb/timestamptz and explicit foreign keys rather than D1's
// integer booleans, JSON text and millisecond epochs.
export const erpRecords = pgTable("erp_records", {
  id: bigserial("id", { mode: "number" }).primaryKey(), kind: text("kind").notNull(), code: text("code").notNull(), data: jsonb("data").notNull().default({}),
  version: integer("version").notNull().default(1), createdBy: text("created_by").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("erp_records_kind_code_uq").on(t.kind, t.code), index("erp_records_kind_idx").on(t.kind)]);

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), itemCode: text("item_code").notNull(), txnType: text("txn_type").notNull(), qty: numeric("qty", { precision: 24, scale: 6 }).notNull(),
  refType: text("ref_type").notNull().default(""), refNo: text("ref_no").notNull().default(""), beforeQty: numeric("before_qty", { precision: 24, scale: 6 }).notNull().default("0"), afterQty: numeric("after_qty", { precision: 24, scale: 6 }).notNull().default("0"),
  createdBy: text("created_by").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("inventory_transactions_item_idx").on(t.itemCode, t.createdAt)]);

export const unitAliases = pgTable("unit_aliases", {
  id: bigserial("id", { mode: "number" }).primaryKey(), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), alias: text("alias").notNull(), normalizedAlias: text("normalized_alias").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("unit_aliases_normalized_uq").on(t.normalizedAlias), index("unit_aliases_unit_idx").on(t.unitId)]);

export const brandAliases = pgTable("brand_aliases", {
  id: bigserial("id", { mode: "number" }).primaryKey(), brandId: bigint("brand_id", { mode: "number" }).notNull().references(() => brands.id, { onDelete: "restrict" }), alias: text("alias").notNull(), normalizedAlias: text("normalized_alias").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("brand_aliases_normalized_uq").on(t.normalizedAlias), index("brand_aliases_brand_idx").on(t.brandId)]);

export const materialApiIdempotency = pgTable("material_api_idempotency", {
  id: bigserial("id", { mode: "number" }).primaryKey(), username: text("username").notNull().references(() => appUsers.username, { onDelete: "restrict" }), method: text("method").notNull(), routeScope: text("route_scope").notNull(),
  keyDigest: text("key_digest").notNull(), requestDigest: text("request_digest").notNull(), operationId: uuid("operation_id").notNull(), state: text("state").notNull(), response: jsonb("response"), statusCode: integer("status_code"),
  leaseTokenDigest: text("lease_token_digest"), leaseExpiresAt: timestamptz("lease_expires_at"), materialId: bigint("material_id", { mode: "number" }).references(() => materialMaster.id, { onDelete: "restrict" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(), expiresAt: timestamptz("expires_at"),
}, (t) => [uniqueIndex("material_api_idempotency_scope_uq").on(t.username, t.method, t.routeScope, t.keyDigest), uniqueIndex("material_api_idempotency_operation_uq").on(t.operationId), index("material_api_idempotency_expiry_idx").on(t.state, t.expiresAt)]);

export const materialApiRateLimitBuckets = pgTable("material_api_rate_limit_buckets", {
  id: bigserial("id", { mode: "number" }).primaryKey(), username: text("username").notNull().references(() => appUsers.username, { onDelete: "restrict" }), bucketStart: timestamptz("bucket_start").notNull(), attemptCount: integer("attempt_count").notNull().default(0), newKeyCount: integer("new_key_count").notNull().default(0), rejectedCount: integer("rejected_count").notNull().default(0), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_api_rate_limit_user_bucket_uq").on(t.username, t.bucketStart)]);

export const materialImportParseRuns = pgTable("material_import_parse_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), parserVersion: text("parser_version").notNull(),
  runStatus: text("run_status").notNull(), attemptNo: integer("attempt_no").notNull().default(1), sourceFileSha256: text("source_file_sha256"), leaseToken: uuid("lease_token"), leaseExpiresAt: timestamptz("lease_expires_at"), heartbeatAt: timestamptz("heartbeat_at"),
  workerRequestId: uuid("worker_request_id"), currentStage: text("current_stage").notNull(), rowsWritten: integer("rows_written").notNull().default(0), parsedSheetCount: integer("parsed_sheet_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0), errorCount: integer("error_count").notNull().default(0), failureCode: text("failure_code"), safeFailureMessage: text("safe_failure_message"),
  mappingPreparationStatus: text("mapping_preparation_status").notNull().default("NOT_STARTED"), sourceStructureDigest: text("source_structure_digest"),
  startedAt: timestamptz("started_at"), completedAt: timestamptz("completed_at"), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  index("material_import_parse_runs_batch_status_idx").on(t.batchId, t.runStatus, t.id),
  index("material_import_parse_runs_lease_idx").on(t.runStatus, t.leaseExpiresAt),
  check("material_import_parse_runs_mapping_preparation_ck", sql`${t.mappingPreparationStatus} in ('NOT_STARTED','READY','FAILED')`),
  check("material_import_parse_runs_source_structure_digest_ck", sql`${t.sourceStructureDigest} is null or ${t.sourceStructureDigest} ~ '^[0-9a-f]{64}$'`),
]);

export const materialImportParseSheets = pgTable("material_import_parse_sheets", {
  id: bigserial("id", { mode: "number" }).primaryKey(), parseRunId: bigint("parse_run_id", { mode: "number" }).notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }), sheetIndex: integer("sheet_index").notNull(), sheetName: text("sheet_name").notNull(), visibility: text("visibility").notNull(), parseStatus: text("parse_status").notNull(), rowCount: integer("row_count").notNull().default(0), sourceColumnMax: integer("source_column_max").notNull().default(0), mergedRanges: jsonb("merged_ranges"), warnings: jsonb("warnings"), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_parse_sheets_position_uq").on(t.parseRunId, t.sheetIndex)]);

export const materialImportSharedStringChunks = pgTable("material_import_shared_string_chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(), parseRunId: bigint("parse_run_id", { mode: "number" }).notNull().references(() => materialImportParseRuns.id, { onDelete: "cascade" }), chunkIndex: integer("chunk_index").notNull(), startStringIndex: integer("start_string_index").notNull(), itemCount: integer("item_count").notNull(), decodedBytes: integer("decoded_bytes").notNull(), values: jsonb("values").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_shared_string_chunks_position_uq").on(t.parseRunId, t.chunkIndex)]);

export const materialImportHeaderSuggestions = pgTable("material_import_header_suggestions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), parseRunId: bigint("parse_run_id", { mode: "number" }).notNull().references(() => materialImportParseRuns.id, { onDelete: "cascade" }), sheetIndex: integer("sheet_index").notNull(), rowNumber: integer("row_number").notNull(), rank: integer("rank").notNull(), score: numeric("score", { precision: 6, scale: 5 }).notNull(), reasonCodes: jsonb("reason_codes").notNull(), algorithmVersion: text("algorithm_version").notNull(), metadataDigest: text("metadata_digest").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_header_suggestions_position_uq").on(t.parseRunId, t.sheetIndex, t.rowNumber, t.algorithmVersion)]);

export const materialImportSupplierProfiles = pgTable("material_import_supplier_profiles", {
  id: bigserial("id", { mode: "number" }).primaryKey(), profileCode: text("profile_code").notNull(), profileName: text("profile_name").notNull(), supplierKey: text("supplier_key"), enabled: boolean("enabled").notNull().default(true), rules: jsonb("rules").notNull().default({}), version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [uniqueIndex("material_import_supplier_profiles_code_uq").on(t.profileCode)]);

export const materialImportMappings = pgTable("material_import_mappings", {
  id: bigserial("id", { mode: "number" }).primaryKey(), mappingKey: uuid("mapping_key").notNull().defaultRandom(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), parseRunId: bigint("parse_run_id", { mode: "number" }).notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
  mappingVersion: integer("mapping_version").notNull().default(1), sourceKind: text("source_kind").notNull(), selectedSheetIndex: integer("selected_sheet_index").notNull(), selectedSheetName: text("selected_sheet_name").notNull(), headerMode: text("header_mode").notNull(), headerRowNumber: integer("header_row_number"),
  sourceStructureDigest: text("source_structure_digest").notNull(), sourceFields: jsonb("source_fields").notNull().default([]), metadataDigest: text("metadata_digest").notNull(), targetCatalogVersion: text("target_catalog_version").notNull().default("material-import-mapping-metadata-v1"), mappingDigest: text("mapping_digest").notNull(), mappingSnapshot: jsonb("mapping_snapshot"),
  status: text("status").notNull(), supersedesMappingId: bigint("supersedes_mapping_id", { mode: "number" }), supersededByMappingId: bigint("superseded_by_mapping_id", { mode: "number" }), reuseSourceMappingId: bigint("reuse_source_mapping_id", { mode: "number" }),
  staleReasonCode: text("stale_reason_code"), staleReason: text("stale_reason"), invalidatedAt: timestamptz("invalidated_at"),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), updatedBy: text("updated_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), confirmedBy: text("confirmed_by").references(() => appUsers.username, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull().defaultRandom(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(), confirmedAt: timestamptz("confirmed_at"),
}, (t) => [
  uniqueIndex("material_import_mappings_batch_version_uq").on(t.batchId, t.mappingVersion),
  uniqueIndex("material_import_mappings_mapping_key_version_uq").on(t.mappingKey, t.mappingVersion),
  uniqueIndex("material_import_mappings_current_draft_uq").on(t.batchId).where(sql`${t.status} = 'DRAFT'`),
  uniqueIndex("material_import_mappings_current_confirmed_uq").on(t.batchId).where(sql`${t.status} = 'CONFIRMED'`),
  index("material_import_mappings_batch_status_idx").on(t.batchId, t.status),
  index("material_import_mappings_reuse_idx").on(t.status, t.sourceKind, t.sourceStructureDigest, t.confirmedAt),
  foreignKey({ name: "material_import_mappings_supersedes_fk", columns: [t.supersedesMappingId], foreignColumns: [t.id] }).onDelete("restrict"),
  foreignKey({ name: "material_import_mappings_superseded_by_fk", columns: [t.supersededByMappingId], foreignColumns: [t.id] }).onDelete("restrict"),
  foreignKey({ name: "material_import_mappings_reuse_source_fk", columns: [t.reuseSourceMappingId], foreignColumns: [t.id] }).onDelete("restrict"),
  check("material_import_mappings_status_ck", sql`${t.status} in ('DRAFT','CONFIRMED','STALE','SUPERSEDED')`),
  check("material_import_mappings_header_ck", sql`(${t.headerMode}='SINGLE_ROW' and ${t.headerRowNumber}>0) or (${t.headerMode}='NO_HEADER' and ${t.headerRowNumber} is null)`),
  check("material_import_mappings_values_ck", sql`${t.mappingVersion}>0 and ${t.selectedSheetIndex}>=0`),
  check("material_import_mappings_digest_ck", sql`${t.sourceStructureDigest} ~ '^[0-9a-f]{64}$' and ${t.metadataDigest} ~ '^[0-9a-f]{64}$' and ${t.mappingDigest} ~ '^[0-9a-f]{64}$'`),
  check("material_import_mappings_source_fields_ck", sql`jsonb_typeof(${t.sourceFields})='array'`),
  check("material_import_mappings_confirm_ck", sql`(${t.status}='CONFIRMED' and ${t.confirmedBy} is not null and ${t.confirmedAt} is not null and ${t.mappingSnapshot} is not null) or ${t.status}<>'CONFIRMED'`),
  check("material_import_mappings_stale_ck", sql`(${t.status}='STALE' and ${t.staleReasonCode} is not null and ${t.staleReason} is not null and ${t.invalidatedAt} is not null) or ${t.status}<>'STALE'`),
]);

export const materialImportMappingItems = pgTable("material_import_mapping_items", {
  id: bigserial("id", { mode: "number" }).primaryKey(), mappingId: bigint("mapping_id", { mode: "number" }).notNull().references(() => materialImportMappings.id, { onDelete: "cascade" }),
  sourceColumnIndex: integer("source_column_index"), sourceHeader: text("source_header"), targetNamespace: text("target_namespace").notNull(), targetCode: text("target_code").notNull(), mappingMode: text("mapping_mode").notNull(),
  sourceColumnIndexes: jsonb("source_column_indexes").notNull().default([]), sourceHeaders: jsonb("source_headers").notNull().default([]), defaultValue: jsonb("default_value"), required: boolean("required").notNull().default(false),
  combinationStrategy: text("combination_strategy").notNull().default("FIRST_NON_EMPTY"), combinationSeparator: text("combination_separator").notNull().default(" "), mappingConfidence: numeric("mapping_confidence", { precision: 6, scale: 5 }).notNull().default("0"),
  adaptiveMappingStatus: text("adaptive_mapping_status").notNull().default("CONFIRMED"), mappingEvidence: jsonb("mapping_evidence").notNull().default([]), displayOrder: integer("display_order").notNull().default(0),
}, (t) => [
  uniqueIndex("material_import_mapping_items_target_uq").on(t.mappingId, t.targetNamespace, t.targetCode).where(sql`${t.targetNamespace} <> 'ignore'`),
  index("material_import_mapping_items_mapping_order_idx").on(t.mappingId, t.displayOrder, t.id),
  check("material_import_mapping_items_namespace_ck", sql`${t.targetNamespace} in ('basic','attribute','category_hint','supplier_reference','ignore')`),
  check("material_import_mapping_items_mode_ck", sql`${t.mappingMode} in ('SOURCE','SOURCE_WITH_DEFAULT','DEFAULT','IGNORE')`),
  check("material_import_mapping_items_json_ck", sql`jsonb_typeof(${t.sourceColumnIndexes})='array' and jsonb_array_length(${t.sourceColumnIndexes}) between 0 and 8 and jsonb_typeof(${t.sourceHeaders})='array' and jsonb_array_length(${t.sourceHeaders}) between 0 and 8 and jsonb_typeof(${t.mappingEvidence})='array'`),
  check("material_import_mapping_items_values_ck", sql`${t.displayOrder} between 0 and 255 and ${t.mappingConfidence} between 0 and 1 and length(${t.combinationSeparator})<=10 and ${t.combinationStrategy} in ('FIRST_NON_EMPTY','JOIN_NON_EMPTY','SPECIFICATION_EXTRACT') and ${t.adaptiveMappingStatus} in ('EXACT','HIGH_CONFIDENCE','SUGGESTED','UNMAPPED','CONFLICT','CONFIRMED')`),
]);

export const materialImportNormalizationRuns = pgTable("material_import_normalization_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), parseRunId: bigint("parse_run_id", { mode: "number" }).notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }), mappingId: bigint("mapping_id", { mode: "number" }).notNull().references(() => materialImportMappings.id, { onDelete: "restrict" }),
  sourceFileId: bigint("source_file_id", { mode: "number" }).notNull().references(() => materialImportFiles.id, { onDelete: "restrict" }),
  sourceSheetId: bigint("source_sheet_id", { mode: "number" }).notNull().references(() => materialImportParseSheets.id, { onDelete: "restrict" }),
  mappingVersion: integer("mapping_version").notNull(), mappingDigest: text("mapping_digest").notNull(), sourceSchemaDigest: text("source_schema_digest").notNull(),
  processorVersion: text("processor_version").notNull(), normalizerRuleVersion: text("normalizer_rule_version").notNull(), metadataDigest: text("metadata_digest").notNull(),
  mappingSnapshot: jsonb("mapping_snapshot").notNull(), runVersion: integer("run_version").notNull(), runStatus: text("run_status").notNull(), expectedVersion: integer("expected_version").notNull().default(1),
  attemptNo: integer("attempt_no").notNull().default(1), retryCount: integer("retry_count").notNull().default(0), supersedesRunId: bigint("supersedes_run_id", { mode: "number" }),
  workerJobId: uuid("worker_job_id"), leaseToken: uuid("lease_token"), leaseExpiresAt: timestamptz("lease_expires_at"), heartbeatAt: timestamptz("heartbeat_at"),
  currentStage: text("current_stage").notNull(), totalRows: integer("total_rows").notNull().default(0), processedRows: integer("processed_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0), warningRows: integer("warning_rows").notNull().default(0), errorRows: integer("error_rows").notNull().default(0), skippedRows: integer("skipped_rows").notNull().default(0),
  issueCount: integer("issue_count").notNull().default(0), warningCount: integer("warning_count").notNull().default(0), errorCount: integer("error_count").notNull().default(0),
  normalizedJsonBytes: bigint("normalized_json_bytes", { mode: "number" }).notNull().default(0), resultDigest: text("result_digest"),
  requestedBy: text("requested_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), rerunReason: text("rerun_reason"),
  startedAt: timestamptz("started_at"), completedAt: timestamptz("completed_at"), publishedAt: timestamptz("published_at"),
  cancelRequestedAt: timestamptz("cancel_requested_at"), cancelledAt: timestamptz("cancelled_at"), cancelledBy: text("cancelled_by").references(() => appUsers.username, { onDelete: "restrict" }),
  failureCode: text("failure_code"), safeFailureMessage: text("safe_failure_message"), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_normalization_runs_batch_version_uq").on(t.batchId, t.runVersion),
  uniqueIndex("material_import_normalization_runs_active_uq").on(t.batchId).where(sql`${t.runStatus} in ('QUEUED','RUNNING','PUBLISHING','CANCEL_REQUESTED')`),
  index("material_import_normalization_runs_batch_status_idx").on(t.batchId, t.runStatus, t.id),
  index("material_import_normalization_runs_lease_idx").on(t.runStatus, t.leaseExpiresAt),
  index("material_import_normalization_runs_history_idx").on(t.batchId, t.runVersion, t.id),
  check("material_import_normalization_runs_status_ck", sql`${t.runStatus} in ('QUEUED','RUNNING','PUBLISHING','SUCCEEDED','SUPERSEDED','FAILED','CANCEL_REQUESTED','CANCELLED')`),
  check("material_import_normalization_runs_stage_ck", sql`${t.currentStage} in ('LOAD_MAPPING','READ_SOURCE_ROWS','NORMALIZE_ROWS','VERIFY_RESULT','PUBLISH_RESULT','COMPLETE')`),
  check("material_import_normalization_runs_digest_ck", sql`${t.mappingDigest} ~ '^[0-9a-f]{64}$' and ${t.sourceSchemaDigest} ~ '^[0-9a-f]{64}$' and ${t.metadataDigest} ~ '^[0-9a-f]{64}$' and (${t.resultDigest} is null or ${t.resultDigest} ~ '^[0-9a-f]{64}$')`),
  check("material_import_normalization_runs_counts_ck", sql`${t.runVersion}>0 and ${t.expectedVersion}>0 and ${t.retryCount}>=0 and ${t.attemptNo}>0 and ${t.totalRows}>=0 and ${t.processedRows} between 0 and ${t.totalRows} and ${t.validRows}>=0 and ${t.warningRows}>=0 and ${t.errorRows}>=0 and ${t.skippedRows}>=0 and ${t.validRows}+${t.warningRows}+${t.errorRows}+${t.skippedRows}<=${t.processedRows} and ${t.issueCount}>=0 and ${t.warningCount}>=0 and ${t.errorCount}>=0 and ${t.warningCount}+${t.errorCount}=${t.issueCount} and ${t.normalizedJsonBytes}>=0`),
  check("material_import_normalization_runs_mapping_snapshot_ck", sql`jsonb_typeof(${t.mappingSnapshot})='object' and pg_column_size(${t.mappingSnapshot})<=1048576`),
  check("material_import_normalization_runs_publish_ck", sql`(${t.runStatus} in ('SUCCEEDED','SUPERSEDED') and ${t.publishedAt} is not null and ${t.resultDigest} is not null and ${t.completedAt} is not null) or (${t.runStatus} not in ('SUCCEEDED','SUPERSEDED') and ${t.publishedAt} is null)`),
  check("material_import_normalization_runs_cancel_ck", sql`(${t.runStatus}='CANCEL_REQUESTED' and ${t.cancelRequestedAt} is not null and ${t.cancelledBy} is not null and ${t.cancelledAt} is null) or (${t.runStatus}='CANCELLED' and ${t.cancelRequestedAt} is not null and ${t.cancelledBy} is not null and ${t.cancelledAt} is not null) or (${t.runStatus} not in ('CANCEL_REQUESTED','CANCELLED') and ${t.cancelRequestedAt} is null and ${t.cancelledAt} is null and ${t.cancelledBy} is null)`),
  check("material_import_normalization_runs_failure_ck", sql`(${t.runStatus}='FAILED' and ${t.failureCode} is not null and length(trim(${t.failureCode})) between 3 and 100 and ${t.safeFailureMessage} is not null) or (${t.runStatus}<>'FAILED' and ${t.failureCode} is null and ${t.safeFailureMessage} is null)`),
  check("material_import_normalization_runs_rerun_reason_ck", sql`${t.rerunReason} is null or length(trim(${t.rerunReason})) between 1 and 500`),
]);

export const materialImportNormalizedRows = pgTable("material_import_normalized_rows", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }),
  sourceRowId: bigint("source_row_id", { mode: "number" }).notNull().references(() => materialImportRows.id, { onDelete: "restrict" }), sourceSheetId: bigint("source_sheet_id", { mode: "number" }).notNull().references(() => materialImportParseSheets.id, { onDelete: "restrict" }),
  sourceSheetIndex: integer("source_sheet_index").notNull(), sourceSheetName: text("source_sheet_name").notNull(), sourceRowNumber: integer("source_row_number").notNull(), sourceRawRowHash: text("source_raw_row_hash").notNull(),
  normalizedPayload: jsonb("normalized_payload").notNull(), normalizedPayloadHash: text("normalized_payload_hash").notNull(), mappedValues: jsonb("mapped_values"),
  rowStatus: text("row_status").notNull(), reviewStatus: text("review_status").notNull().default("NEEDS_REVIEW"), coreCandidateCount: integer("core_candidate_count").notNull().default(0),
  attributeCandidateCount: integer("attribute_candidate_count").notNull().default(0), issueCount: integer("issue_count").notNull().default(0), errorCount: integer("error_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0), resultSummary: jsonb("result_summary").notNull().default({}), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_normalized_rows_position_uq").on(t.normalizationRunId, t.sourceSheetIndex, t.sourceRowNumber),
  uniqueIndex("material_import_normalized_rows_source_uq").on(t.normalizationRunId, t.sourceRowId),
  index("material_import_normalized_rows_status_idx").on(t.normalizationRunId, t.rowStatus, t.id),
  check("material_import_normalized_rows_status_ck", sql`(${t.rowStatus}='VALID' and ${t.errorCount}=0 and ${t.warningCount}=0) or (${t.rowStatus}='WARNING' and ${t.errorCount}=0 and ${t.warningCount}>0) or (${t.rowStatus}='ERROR' and ${t.errorCount}>0) or (${t.rowStatus}='SKIPPED' and ${t.errorCount}=0 and ${t.warningCount}=0)`),
  check("material_import_normalized_rows_counts_ck", sql`${t.coreCandidateCount}>=0 and ${t.attributeCandidateCount}>=0 and ${t.issueCount}>=0 and ${t.errorCount}>=0 and ${t.warningCount}>=0 and ${t.issueCount}=${t.errorCount}+${t.warningCount}`),
  check("material_import_normalized_rows_hash_ck", sql`${t.sourceRawRowHash} ~ '^[0-9a-f]{64}$' and ${t.normalizedPayloadHash} ~ '^[0-9a-f]{64}$'`),
  check("material_import_normalized_rows_payload_ck", sql`jsonb_typeof(${t.normalizedPayload})='object' and pg_column_size(${t.normalizedPayload})<=262144 and (${t.mappedValues} is null or jsonb_typeof(${t.mappedValues})='object') and jsonb_typeof(${t.resultSummary})='object'`),
]);

export const materialImportNormalizationIssues = pgTable("material_import_normalization_issues", {
  id: bigserial("id", { mode: "number" }).primaryKey(), normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }), normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }),
  issueLevel: text("issue_level").notNull(), issueCode: text("issue_code").notNull(), issueKey: text("issue_key").notNull(), targetCode: text("target_code").notNull(), attributeCode: text("attribute_code"),
  sourceSheetIndex: integer("source_sheet_index").notNull(), sourceRowNumber: integer("source_row_number").notNull(), sourceColumnIndex: integer("source_column_index"),
  safeMessage: text("safe_message").notNull(), safeDetails: jsonb("safe_details").notNull().default({}), sourceValueSummary: jsonb("source_value_summary"),
  ruleCode: text("rule_code").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_normalization_issues_idempotent_uq").on(t.normalizationRunId, t.issueKey),
  index("material_import_normalization_issues_filter_idx").on(t.normalizationRunId, t.issueLevel, t.issueCode, t.id),
  index("material_import_normalization_issues_row_idx").on(t.normalizedRowId, t.id),
  check("material_import_normalization_issues_level_ck", sql`${t.issueLevel} in ('ERROR','WARNING')`),
  check("material_import_normalization_issues_code_ck", sql`${t.issueCode} ~ '^[A-Z][A-Z0-9_]{2,99}$' and length(${t.targetCode}) between 3 and 160 and length(${t.safeMessage}) between 1 and 500 and ${t.ruleCode} ~ '^[A-Z][A-Z0-9_]{2,127}$'`),
  check("material_import_normalization_issues_details_ck", sql`jsonb_typeof(${t.safeDetails})='object' and pg_column_size(${t.safeDetails})<=16384`),
]);

export const materialImportNormalizedFieldCandidates = pgTable("material_import_normalized_field_candidates", {
  id: bigserial("id", { mode: "number" }).primaryKey(), normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }),
  normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }),
  targetNamespace: text("target_namespace").notNull(), targetFieldCode: text("target_field_code").notNull(), rawValue: jsonb("raw_value"), normalizedValue: jsonb("normalized_value"),
  valueState: text("value_state").notNull(), validationStatus: text("validation_status").notNull(), transformationRuleCode: text("transformation_rule_code").notNull(),
  transformationRuleVersion: text("transformation_rule_version").notNull(), displayOrder: integer("display_order").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_normalized_field_candidates_target_uq").on(t.normalizationRunId, t.normalizedRowId, t.targetNamespace, t.targetFieldCode),
  index("material_import_normalized_field_candidates_row_idx").on(t.normalizedRowId, t.displayOrder, t.id),
  check("material_import_normalized_field_candidates_namespace_ck", sql`${t.targetNamespace} in ('basic','category_hint','supplier_reference')`),
  check("material_import_normalized_field_candidates_status_ck", sql`${t.validationStatus} in ('VALID','WARNING','ERROR','EMPTY')`),
  check("material_import_normalized_field_candidates_size_ck", sql`(${t.rawValue} is null or pg_column_size(${t.rawValue})<=16384) and (${t.normalizedValue} is null or pg_column_size(${t.normalizedValue})<=16384)`),
]);

export const materialImportNormalizedAttributeCandidates = pgTable("material_import_normalized_attribute_candidates", {
  id: bigserial("id", { mode: "number" }).primaryKey(), normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }),
  normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }),
  attributeCode: text("attribute_code").notNull(), attributeNameSnapshot: text("attribute_name_snapshot").notNull(), dataType: text("data_type").notNull(),
  rawValue: jsonb("raw_value"), normalizedValue: jsonb("normalized_value"), unitCode: text("unit_code"), validationStatus: text("validation_status").notNull(),
  transformationRuleCode: text("transformation_rule_code").notNull(), transformationRuleVersion: text("transformation_rule_version").notNull(), displayOrder: integer("display_order").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_normalized_attribute_candidates_target_uq").on(t.normalizationRunId, t.normalizedRowId, t.attributeCode),
  index("material_import_normalized_attribute_candidates_row_idx").on(t.normalizedRowId, t.displayOrder, t.id),
  check("material_import_normalized_attribute_candidates_code_ck", sql`${t.attributeCode} ~ '^[A-Z][A-Z0-9_]{0,127}$'`),
  check("material_import_normalized_attribute_candidates_type_ck", sql`${t.dataType} in ('TEXT','INTEGER','DECIMAL','BOOLEAN','DATE','ENUM')`),
  check("material_import_normalized_attribute_candidates_status_ck", sql`${t.validationStatus} in ('VALID','WARNING','ERROR','EMPTY')`),
  check("material_import_normalized_attribute_candidates_size_ck", sql`(${t.rawValue} is null or pg_column_size(${t.rawValue})<=16384) and (${t.normalizedValue} is null or pg_column_size(${t.normalizedValue})<=16384)`),
]);

export const materialImportNormalizationLineage = pgTable("material_import_normalization_lineage", {
  id: bigserial("id", { mode: "number" }).primaryKey(), normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }),
  normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }),
  targetNamespace: text("target_namespace").notNull(), targetFieldCode: text("target_field_code").notNull(), targetAttributeCode: text("target_attribute_code"),
  sourceSheetId: bigint("source_sheet_id", { mode: "number" }).notNull().references(() => materialImportParseSheets.id, { onDelete: "restrict" }), sourceSheetName: text("source_sheet_name").notNull(),
  sourceRowNumber: integer("source_row_number").notNull(), sourceColumnIndex: integer("source_column_index"), sourceColumnName: text("source_column_name"), sourceFieldKey: text("source_field_key"),
  rawValueSummary: jsonb("raw_value_summary"), normalizedValueSummary: jsonb("normalized_value_summary"), mappingId: bigint("mapping_id", { mode: "number" }).notNull().references(() => materialImportMappings.id, { onDelete: "restrict" }),
  mappingDigest: text("mapping_digest").notNull(), transformationRuleCode: text("transformation_rule_code").notNull(), transformationRuleVersion: text("transformation_rule_version").notNull(),
  transformationSteps: jsonb("transformation_steps").notNull().default([]), lineageOrdinal: integer("lineage_ordinal").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_normalization_lineage_source_uq").on(t.normalizationRunId, t.normalizedRowId, t.targetNamespace, t.targetFieldCode, t.lineageOrdinal),
  index("material_import_normalization_lineage_row_idx").on(t.normalizedRowId, t.targetNamespace, t.targetFieldCode, t.lineageOrdinal),
  check("material_import_normalization_lineage_namespace_ck", sql`${t.targetNamespace} in ('basic','attribute','category_hint','supplier_reference')`),
  check("material_import_normalization_lineage_digest_ck", sql`${t.mappingDigest} ~ '^[0-9a-f]{64}$'`),
  check("material_import_normalization_lineage_steps_ck", sql`jsonb_typeof(${t.transformationSteps})='array' and pg_column_size(${t.transformationSteps})<=16384`),
]);

export const materialImportNormalizationApprovals = pgTable("material_import_normalization_approvals", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }), resultDigest: text("result_digest").notNull(), approvedBy: text("approved_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), approvedAt: timestamptz("approved_at").notNull(), requestId: uuid("request_id").notNull(),
}, (t) => [uniqueIndex("material_import_normalization_approvals_run_uq").on(t.normalizationRunId), index("material_import_normalization_approvals_batch_idx").on(t.batchId, t.approvedAt)]);

export const materialImportDraftLinks = pgTable("material_import_draft_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), fileId: bigint("file_id", { mode: "number" }).notNull().references(() => materialImportFiles.id, { onDelete: "restrict" }), sourceRowId: bigint("source_row_id", { mode: "number" }).notNull().references(() => materialImportRows.id, { onDelete: "restrict" }), normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }), normalizationApprovalId: bigint("normalization_approval_id", { mode: "number" }).notNull().references(() => materialImportNormalizationApprovals.id, { onDelete: "restrict" }), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), createdBy: text("created_by").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [uniqueIndex("material_import_draft_links_normalized_row_uq").on(t.normalizedRowId), uniqueIndex("material_import_draft_links_material_uq").on(t.materialId)]);

export const materialDuplicateCandidates = pgTable("material_duplicate_candidates", {
  id: bigserial("id", { mode: "number" }).primaryKey(), normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }), draftMaterialId: bigint("draft_material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), candidateMaterialId: bigint("candidate_material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), matchLevel: text("match_level").notNull(), confidenceBasisPoints: integer("confidence_basis_points").notNull(), matchedFields: jsonb("matched_fields").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [uniqueIndex("material_duplicate_candidates_pair_uq").on(t.normalizedRowId, t.candidateMaterialId), check("material_duplicate_candidates_not_self_ck", sql`${t.draftMaterialId} <> ${t.candidateMaterialId}`)]);

export const materialImportIdempotency = pgTable("material_import_idempotency", {
  id: bigserial("id", { mode: "number" }).primaryKey(), username: text("username").notNull().references(() => appUsers.username, { onDelete: "restrict" }), method: text("method").notNull(), routeScope: text("route_scope").notNull(), keyDigest: text("key_digest").notNull(), requestDigest: text("request_digest").notNull(), operationId: uuid("operation_id").notNull(), state: text("state").notNull(), batchId: bigint("batch_id", { mode: "number" }).references(() => materialImportBatches.id, { onDelete: "restrict" }), fileId: bigint("file_id", { mode: "number" }).references(() => materialImportFiles.id, { onDelete: "restrict" }), response: jsonb("response"), statusCode: integer("status_code"), leaseToken: uuid("lease_token"), leaseExpiresAt: timestamptz("lease_expires_at"), expiresAt: timestamptz("expires_at"), recoveryUntil: timestamptz("recovery_until").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_import_idempotency_scope_uq").on(t.username, t.method, t.routeScope, t.keyDigest), uniqueIndex("material_import_idempotency_operation_uq").on(t.operationId)]);

export const supplierMappings = pgTable("supplier_mappings", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), supplierName: text("supplier_name").notNull(), supplierKey: text("supplier_key").notNull(), supplierItemCode: text("supplier_item_code").notNull(), supplierItemName: text("supplier_item_name").notNull().default(""), supplierSpecification: text("supplier_specification").notNull().default(""), manufacturer: text("manufacturer").notNull().default(""), mpn: text("mpn").notNull().default(""), revision: text("revision").notNull().default(""), purchaseUom: text("purchase_uom").notNull(), conversionNumerator: bigint("conversion_numerator", { mode: "number" }).notNull().default(1), conversionDenominator: bigint("conversion_denominator", { mode: "number" }).notNull().default(1), status: text("status").notNull(), validFrom: timestamptz("valid_from").notNull(), validTo: timestamptz("valid_to"), version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [uniqueIndex("supplier_mappings_identity_period_uq").on(t.supplierKey, t.supplierItemCode, t.manufacturer, t.mpn, t.revision, t.validFrom), index("supplier_mappings_material_idx").on(t.materialId)]);

export const supplierMappingPriceHistory = pgTable("supplier_mapping_price_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(), supplierMappingId: bigint("supplier_mapping_id", { mode: "number" }).notNull().references(() => supplierMappings.id, { onDelete: "restrict" }), price: numeric("price", { precision: 24, scale: 6 }).notNull(), currencyCode: text("currency_code").notNull(), priceUom: text("price_uom").notNull(), minimumOrderQty: numeric("minimum_order_qty", { precision: 24, scale: 6 }), effectiveFrom: timestamptz("effective_from").notNull(), effectiveTo: timestamptz("effective_to"), sourceDocumentRef: text("source_document_ref").notNull().default(""), createdBy: text("created_by").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [index("supplier_mapping_price_history_from_idx").on(t.supplierMappingId, t.effectiveFrom)]);

export const materialChangeLogs = pgTable("material_change_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), changeType: text("change_type").notNull(), fieldName: text("field_name").notNull(), oldValue: jsonb("old_value"), newValue: jsonb("new_value"), changeReason: text("change_reason").notNull().default(""), changedBy: text("changed_by").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [index("material_change_logs_material_created_idx").on(t.materialId, t.createdAt)]);

export const materialAliases = pgTable("material_aliases", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), aliasType: text("alias_type").notNull(), aliasText: text("alias_text").notNull(), normalizedAlias: text("normalized_alias").notNull(), languageCode: text("language_code").notNull().default(""), isPrimary: boolean("is_primary").notNull().default(false), status: text("status").notNull(), sourceType: text("source_type").notNull(), sourceRef: text("source_ref").notNull(), ...auditColumns,
}, (t) => [uniqueIndex("material_aliases_material_type_normalized_uq").on(t.materialId, t.aliasType, t.normalizedAlias)]);

export const materialCodeRules = pgTable("material_code_rules", {
  id: bigserial("id", { mode: "number" }).primaryKey(), ruleCode: text("rule_code").notNull(), ruleName: text("rule_name").notNull(), categoryId: bigint("category_id", { mode: "number" }).notNull().references(() => materialCategories.id, { onDelete: "restrict" }), prefix: text("prefix").notNull().default("CYD"), majorSegment: text("major_segment").notNull(), minorSegment: text("minor_segment").notNull(), separator: text("separator").notNull().default("-"), sequenceWidth: integer("sequence_width").notNull().default(6), nextSequence: bigint("next_sequence", { mode: "number" }).notNull().default(1), status: text("status").notNull(), effectiveFrom: timestamptz("effective_from").notNull(), effectiveTo: timestamptz("effective_to"), version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [uniqueIndex("material_code_rules_code_uq").on(t.ruleCode), index("material_code_rules_category_status_idx").on(t.categoryId, t.status)]);

export const materialCodeSequences = pgTable("material_code_sequences", {
  categoryId: bigint("category_id", { mode: "number" }).primaryKey().references(() => materialCategories.id, { onDelete: "restrict" }),
  categoryCode: text("category_code").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_code_sequences_category_code_uq").on(t.categoryCode),
  check("material_code_sequences_next_value_ck", sql`${t.nextValue} between 1 and 1000001`),
  check("material_code_sequences_category_code_ck", sql`${t.categoryCode} ~ '^[A-Z][A-Z0-9_]{1,63}$'`),
]);

export const legacyMaterialMapping = pgTable("legacy_material_mapping", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), sourceType: text("source_type").notNull(), sourceTable: text("source_table").notNull(), sourceKey: text("source_key").notNull(), sourceCode: text("source_code").notNull().default(""), sourceName: text("source_name").notNull().default(""), sourceSnapshotHash: text("source_snapshot_hash").notNull(), mappingMethod: text("mapping_method").notNull(), status: text("status").notNull(), mappedBy: text("mapped_by").notNull(), approvedBy: text("approved_by").notNull(), approvedAt: timestamptz("approved_at").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [uniqueIndex("legacy_material_mapping_source_identity_uq").on(t.sourceType, t.sourceTable, t.sourceKey), index("legacy_material_mapping_material_idx").on(t.materialId)]);

export const materialImportReviewSessions = pgTable("material_import_review_sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  batchId: bigint("batch_id", { mode: "number" }).notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
  normalizationRunId: bigint("normalization_run_id", { mode: "number" }).notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }),
  normalizationRunVersion: integer("normalization_run_version").notNull(),
  normalizationResultDigest: text("normalization_result_digest").notNull(),
  mappingVersionId: bigint("mapping_version_id", { mode: "number" }).notNull().references(() => materialImportMappings.id, { onDelete: "restrict" }),
  mappingContentDigest: text("mapping_content_digest").notNull(),
  reviewVersion: integer("review_version").notNull(),
  status: text("status").notNull().default("DRAFT"),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  submittedAt: timestamptz("submitted_at"), finalizingAt: timestamptz("finalizing_at"),
  finalizedAt: timestamptz("finalized_at"), cancelledAt: timestamptz("cancelled_at"),
  failureCode: text("failure_code"), failureMessageSafe: text("failure_message_safe"),
  totalRows: integer("total_rows").notNull(), pendingRows: integer("pending_rows").notNull(),
  reviewedRows: integer("reviewed_rows").notNull().default(0), keptRows: integer("kept_rows").notNull().default(0),
  excludedRows: integer("excluded_rows").notNull().default(0), bindExistingRows: integer("bind_existing_rows").notNull().default(0),
  createDraftRows: integer("create_draft_rows").notNull().default(0), completedRows: integer("completed_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0), expectedVersion: integer("expected_version").notNull().default(1),
  supersedesReviewSessionId: bigint("supersedes_review_session_id", { mode: "number" }),
  finalizationJobId: uuid("finalization_job_id"),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.supersedesReviewSessionId], foreignColumns: [t.id], name: "material_import_review_sessions_supersedes_fk" }).onDelete("restrict"),
  uniqueIndex("material_import_review_sessions_run_version_uq").on(t.normalizationRunId, t.reviewVersion),
  uniqueIndex("material_import_review_sessions_active_uq").on(t.normalizationRunId).where(sql`${t.status} in ('DRAFT','IN_REVIEW','READY_TO_FINALIZE','FINALIZING','FINALIZE_FAILED')`),
  uniqueIndex("material_import_review_sessions_job_uq").on(t.finalizationJobId).where(sql`${t.finalizationJobId} is not null`),
  index("material_import_review_sessions_batch_history_idx").on(t.batchId, t.reviewVersion, t.id),
  index("material_import_review_sessions_status_idx").on(t.status, t.updatedAt, t.id),
]);

export const materialImportReviewRows = pgTable("material_import_review_rows", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }),
  sourceRowId: bigint("source_row_id", { mode: "number" }).notNull().references(() => materialImportRows.id, { onDelete: "restrict" }),
  sourceRowNumber: integer("source_row_number").notNull(), rowStatus: text("row_status").notNull().default("PENDING"),
  disposition: text("disposition").notNull().default("PENDING"), decisionReasonCode: text("decision_reason_code"),
  decisionComment: text("decision_comment").notNull().default(""),
  existingMaterialId: bigint("existing_material_id", { mode: "number" }).references(() => materialMaster.id, { onDelete: "restrict" }),
  materialDraftId: bigint("material_draft_id", { mode: "number" }).references(() => materialMaster.id, { onDelete: "restrict" }),
  reviewedBy: text("reviewed_by").references(() => appUsers.username, { onDelete: "restrict" }),
  reviewedAt: timestamptz("reviewed_at"), finalizedAt: timestamptz("finalized_at"),
  failureCode: text("failure_code"), failureMessageSafe: text("failure_message_safe"),
  expectedVersion: integer("expected_version").notNull().default(1),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_review_rows_session_normalized_uq").on(t.reviewSessionId, t.normalizedRowId),
  index("material_import_review_rows_session_status_idx").on(t.reviewSessionId, t.rowStatus, t.id),
  index("material_import_review_rows_session_disposition_idx").on(t.reviewSessionId, t.disposition, t.id),
  index("material_import_review_rows_existing_material_idx").on(t.existingMaterialId, t.id).where(sql`${t.existingMaterialId} is not null`),
]);

export const materialImportReviewFieldOverrides = pgTable("material_import_review_field_overrides", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  targetFieldCode: text("target_field_code").notNull(), originalCandidateValue: jsonb("original_candidate_value"),
  overrideValue: jsonb("override_value"), valueSemantics: text("value_semantics").notNull(),
  reasonCode: text("reason_code").notNull(), comment: text("comment").notNull().default(""),
  changedBy: text("changed_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  changedAt: timestamptz("changed_at").notNull().defaultNow(), revisionNumber: integer("revision_number").notNull(),
  supersedesOverrideId: bigint("supersedes_override_id", { mode: "number" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.supersedesOverrideId], foreignColumns: [t.id], name: "material_import_review_field_overrides_supersedes_fk" }).onDelete("restrict"),
  uniqueIndex("material_import_review_field_overrides_revision_uq").on(t.reviewRowId, t.targetFieldCode, t.revisionNumber),
  index("material_import_review_field_overrides_history_idx").on(t.reviewRowId, t.targetFieldCode, t.revisionNumber, t.id),
]);

export const materialImportReviewAttributeOverrides = pgTable("material_import_review_attribute_overrides", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  attributeCode: text("attribute_code").notNull(), attributeNameSnapshot: text("attribute_name_snapshot").notNull(),
  dataTypeSnapshot: text("data_type_snapshot").notNull(), originalRawValue: jsonb("original_raw_value"),
  originalNormalizedValue: jsonb("original_normalized_value"), overrideValue: jsonb("override_value"),
  valueSemantics: text("value_semantics").notNull(), unitOrFormat: text("unit_or_format").notNull().default(""),
  reasonCode: text("reason_code").notNull(), comment: text("comment").notNull().default(""),
  validationStatus: text("validation_status").notNull(),
  changedBy: text("changed_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  changedAt: timestamptz("changed_at").notNull().defaultNow(), revisionNumber: integer("revision_number").notNull(),
  supersedesOverrideId: bigint("supersedes_override_id", { mode: "number" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.supersedesOverrideId], foreignColumns: [t.id], name: "material_import_review_attribute_overrides_supersedes_fk" }).onDelete("restrict"),
  uniqueIndex("material_import_review_attribute_overrides_revision_uq").on(t.reviewRowId, t.attributeCode, t.revisionNumber),
  index("material_import_review_attribute_overrides_history_idx").on(t.reviewRowId, t.attributeCode, t.revisionNumber, t.id),
]);

export const materialImportReviewIssueResolutions = pgTable("material_import_review_issue_resolutions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  normalizationIssueId: bigint("normalization_issue_id", { mode: "number" }).notNull().references(() => materialImportNormalizationIssues.id, { onDelete: "restrict" }),
  resolutionStatus: text("resolution_status").notNull(), resolutionCode: text("resolution_code").notNull(),
  comment: text("comment").notNull().default(""), resolvedBy: text("resolved_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  resolvedAt: timestamptz("resolved_at").notNull().defaultNow(), revisionNumber: integer("revision_number").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_review_issue_resolutions_revision_uq").on(t.reviewRowId, t.normalizationIssueId, t.revisionNumber),
  index("material_import_review_issue_resolutions_history_idx").on(t.reviewRowId, t.normalizationIssueId, t.revisionNumber, t.id),
]);

export const materialImportReviewValidationIssues = pgTable("material_import_review_validation_issues", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  issueKey: text("issue_key").notNull(), issueLevel: text("issue_level").notNull(), issueCode: text("issue_code").notNull(),
  targetCode: text("target_code").notNull(), safeMessage: text("safe_message").notNull(),
  safeDetails: jsonb("safe_details").notNull().default({}), validationGeneration: integer("validation_generation").notNull(),
  isActive: boolean("is_active").notNull().default(true), createdAt: timestamptz("created_at").notNull().defaultNow(),
  resolvedAt: timestamptz("resolved_at"),
}, (t) => [
  uniqueIndex("material_import_review_validation_issues_generation_uq").on(t.reviewRowId, t.issueKey, t.validationGeneration),
  index("material_import_review_validation_issues_active_idx").on(t.reviewSessionId, t.issueLevel, t.id).where(sql`${t.isActive}`),
]);

export const materialImportReviewFinalizations = pgTable("material_import_review_finalizations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewExpectedVersion: integer("review_expected_version").notNull(), snapshotSchemaVersion: integer("snapshot_schema_version").notNull().default(1),
  snapshotDigest: text("snapshot_digest"), status: text("status").notNull().default("PREPARING"), jobId: uuid("job_id").notNull(),
  totalRows: integer("total_rows").notNull(), preparedRows: integer("prepared_rows").notNull().default(0),
  completedRows: integer("completed_rows").notNull().default(0), failedRows: integer("failed_rows").notNull().default(0),
  failureCode: text("failure_code"), failureMessageSafe: text("failure_message_safe"),
  submittedBy: text("submitted_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  submittedAt: timestamptz("submitted_at").notNull().defaultNow(), sealedAt: timestamptz("sealed_at"),
  completedAt: timestamptz("completed_at"), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_review_finalizations_session_uq").on(t.reviewSessionId),
  uniqueIndex("material_import_review_finalizations_job_uq").on(t.jobId),
  index("material_import_review_finalizations_status_idx").on(t.status, t.updatedAt, t.id),
]);

export const materialImportReviewFinalizationRows = pgTable("material_import_review_finalization_rows", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  finalizationId: bigint("finalization_id", { mode: "number" }).notNull().references(() => materialImportReviewFinalizations.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  normalizedRowId: bigint("normalized_row_id", { mode: "number" }).notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }),
  operationType: text("operation_type").notNull(), operationKey: text("operation_key").notNull(),
  finalPayload: jsonb("final_payload").notNull(), finalPayloadDigest: text("final_payload_digest").notNull(),
  existingMaterialId: bigint("existing_material_id", { mode: "number" }).references(() => materialMaster.id, { onDelete: "restrict" }),
  materialDraftId: bigint("material_draft_id", { mode: "number" }).references(() => materialMaster.id, { onDelete: "restrict" }),
  operationStatus: text("operation_status").notNull().default("PENDING"), attemptCount: integer("attempt_count").notNull().default(0),
  failureCode: text("failure_code"), failureMessageSafe: text("failure_message_safe"),
  createdAt: timestamptz("created_at").notNull().defaultNow(), startedAt: timestamptz("started_at"),
  completedAt: timestamptz("completed_at"), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_import_review_finalization_rows_review_uq").on(t.finalizationId, t.reviewRowId),
  uniqueIndex("material_import_review_finalization_rows_operation_uq").on(t.operationKey),
  index("material_import_review_finalization_rows_queue_idx").on(t.finalizationId, t.operationStatus, t.id),
]);

export const materialImportReviewMaterialBindings = pgTable("material_import_review_material_bindings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  finalizationRowId: bigint("finalization_row_id", { mode: "number" }).notNull().references(() => materialImportReviewFinalizationRows.id, { onDelete: "restrict" }),
  materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  materialDisplaySnapshot: jsonb("material_display_snapshot").notNull(),
  boundBy: text("bound_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  boundAt: timestamptz("bound_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [
  uniqueIndex("material_import_review_material_bindings_row_uq").on(t.reviewRowId),
  uniqueIndex("material_import_review_material_bindings_finalization_row_uq").on(t.finalizationRowId),
  index("material_import_review_material_bindings_material_idx").on(t.materialId, t.id),
]);

export const materialImportReviewDraftLinks = pgTable("material_import_review_draft_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).notNull().references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  finalizationRowId: bigint("finalization_row_id", { mode: "number" }).notNull().references(() => materialImportReviewFinalizationRows.id, { onDelete: "restrict" }),
  materialDraftId: bigint("material_draft_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [
  uniqueIndex("material_import_review_draft_links_row_uq").on(t.reviewRowId),
  uniqueIndex("material_import_review_draft_links_finalization_row_uq").on(t.finalizationRowId),
  uniqueIndex("material_import_review_draft_links_material_uq").on(t.materialDraftId),
]);

export const materialImportReviewHistory = pgTable("material_import_review_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewSessionId: bigint("review_session_id", { mode: "number" }).notNull().references(() => materialImportReviewSessions.id, { onDelete: "restrict" }),
  reviewRowId: bigint("review_row_id", { mode: "number" }).references(() => materialImportReviewRows.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(), actor: text("actor").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  oldVersion: integer("old_version"), newVersion: integer("new_version"), reasonCode: text("reason_code"),
  safeDetails: jsonb("safe_details").notNull().default({}), requestId: uuid("request_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  index("material_import_review_history_session_idx").on(t.reviewSessionId, t.id),
  index("material_import_review_history_row_idx").on(t.reviewRowId, t.id).where(sql`${t.reviewRowId} is not null`),
]);
