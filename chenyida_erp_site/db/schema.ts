import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
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
}, (t) => [
  check("app_users_version_ck", sql`${t.version} > 0`),
  check("app_users_username_format_ck", sql`${t.username} ~ '^[a-z][a-z0-9._-]{2,31}$'`),
  check("app_users_display_name_ck", sql`char_length(btrim(${t.displayName})) between 1 and 128`),
  check("app_users_role_ck", sql`${t.role} in ('admin','manager','purchase','engineering','production','warehouse','quality','sales','finance','operations')`),
]);

export const migrationOpeningSources = pgTable("migration_opening_sources", {
  id: uuid("id").primaryKey(), migrationRunId: uuid("migration_run_id").notNull(), manifestSha256: text("manifest_sha256").notNull(),
  sourceSystem: text("source_system").notNull(), sourceEntityKind: text("source_entity_kind").notNull(), sourceStableReferenceDigest: text("source_stable_reference_digest").notNull(),
  sourceRecordDigest: text("source_record_digest").notNull(), mappingDigest: text("mapping_digest").notNull(), targetDigest: text("target_digest").notNull(),
  openingType: text("opening_type").notNull(), cutoffAt: timestamptz("cutoff_at").notNull(), status: text("status").notNull().default("POSTED"),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), operationId: uuid("operation_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("migration_opening_sources_stable_uq").on(t.sourceSystem, t.sourceEntityKind, t.sourceStableReferenceDigest, t.openingType),
  uniqueIndex("migration_opening_sources_manifest_uq").on(t.manifestSha256, t.sourceEntityKind, t.sourceStableReferenceDigest, t.openingType),
  uniqueIndex("migration_opening_sources_operation_uq").on(t.operationId), uniqueIndex("migration_opening_sources_request_uq").on(t.requestId),
  index("migration_opening_sources_run_idx").on(t.migrationRunId, t.openingType, t.id),
  check("migration_opening_sources_manifest_ck", sql`${t.manifestSha256} ~ '^[0-9a-f]{64}$'`),
  check("migration_opening_sources_digest_ck", sql`${t.sourceStableReferenceDigest} ~ '^[0-9a-f]{64}$' and ${t.sourceRecordDigest} ~ '^[0-9a-f]{64}$' and ${t.mappingDigest} ~ '^[0-9a-f]{64}$' and ${t.targetDigest} ~ '^[0-9a-f]{64}$'`),
  check("migration_opening_sources_text_ck", sql`char_length(btrim(${t.sourceSystem})) between 1 and 80 and char_length(btrim(${t.sourceEntityKind})) between 1 and 80`),
  check("migration_opening_sources_type_ck", sql`${t.openingType} in ('INVENTORY','AR','AP')`), check("migration_opening_sources_status_ck", sql`${t.status} = 'POSTED'`),
]);

export const appSessions = pgTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(), username: text("username").notNull().references(() => appUsers.username, { onDelete: "cascade" }),
  expiresAt: timestamptz("expires_at").notNull(), revokedAt: timestamptz("revoked_at"), revokedReason: text("revoked_reason"), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  index("app_sessions_username_idx").on(t.username),
  index("app_sessions_expiry_idx").on(t.expiresAt),
  index("app_sessions_active_user_idx").on(t.username, t.expiresAt).where(sql`${t.revokedAt} is null`),
  check("app_sessions_revocation_ck", sql`(${t.revokedAt} is null and ${t.revokedReason} is null) or (${t.revokedAt} is not null and ${t.revokedReason} in ('LOGOUT','USER_INACTIVE','USER_DEACTIVATED','PASSWORD_RESET','PASSWORD_CHANGED'))`),
]);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(), username: text("username").notNull().default(""), action: text("action").notNull(),
  detail: jsonb("detail").notNull().default({}), requestId: uuid("request_id").notNull(), result: text("result").notNull().default("success"),
  routeCode: text("route_code").notNull().default(""), materialId: bigint("material_id", { mode: "number" }), operationId: uuid("operation_id"),
  idempotencyKeyDigest: text("idempotency_key_digest"), oldVersion: integer("old_version"), newVersion: integer("new_version"), errorCode: text("error_code"),
  targetUsername: text("target_username"), retentionUntil: timestamptz("retention_until"), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  index("audit_log_created_at_idx").on(t.createdAt), index("audit_log_request_id_idx").on(t.requestId), index("audit_log_material_created_idx").on(t.materialId, t.createdAt),
  index("audit_log_identity_created_idx").on(t.routeCode, t.createdAt, t.id),
  index("audit_log_identity_actor_created_idx").on(t.username, t.createdAt).where(sql`${t.routeCode} = 'IDENTITY'`),
  index("audit_log_identity_target_created_idx").on(t.targetUsername, t.createdAt).where(sql`${t.routeCode} = 'IDENTITY'`),
  index("audit_log_identity_action_result_created_idx").on(t.action, t.result, t.createdAt).where(sql`${t.routeCode} = 'IDENTITY'`),
]);

export const identityLoginFailures = pgTable("identity_login_failures", {
  usernameDigest: text("username_digest").notNull(), windowStart: timestamptz("window_start").notNull(), failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("identity_login_failures_pk").on(t.usernameDigest, t.windowStart),
  index("identity_login_failures_window_idx").on(t.windowStart),
  check("identity_login_failures_digest_ck", sql`${t.usernameDigest} ~ '^[0-9a-f]{64}$'`),
  check("identity_login_failures_count_ck", sql`${t.failureCount} >= 0`),
]);

export const identityWriteRateLimitBuckets = pgTable("identity_write_rate_limit_buckets", {
  username: text("username").notNull().references(() => appUsers.username, { onDelete: "cascade" }), bucketStart: timestamptz("bucket_start").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0), newKeyCount: integer("new_key_count").notNull().default(0), rejectedCount: integer("rejected_count").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("identity_write_rate_limit_buckets_pk").on(t.username, t.bucketStart),
  index("identity_write_rate_limit_bucket_idx").on(t.bucketStart),
  check("identity_write_rate_limit_counts_ck", sql`${t.attemptCount} >= 0 and ${t.newKeyCount} >= 0 and ${t.rejectedCount} >= 0 and ${t.newKeyCount} <= ${t.attemptCount}`),
]);

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
}, (t) => [index("idempotency_keys_expiry_idx").on(t.expiresAt), index("idempotency_keys_identity_scope_idx").on(t.username, t.method, t.path, t.createdAt)]);

export const businessCodeSequences = pgTable("business_code_sequences", {
  sequenceCode: text("sequence_code").primaryKey(), currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
  version: integer("version").notNull().default(1), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [check("business_code_sequences_value_ck", sql`${t.currentValue} >= 0`), check("business_code_sequences_version_ck", sql`${t.version} > 0`)]);

export const customers = pgTable("customers", {
  id: bigserial("id", { mode: "number" }).primaryKey(), customerCode: text("customer_code").notNull(), customerName: text("customer_name").notNull(),
  normalizedName: text("normalized_name").notNull(), status: text("status").notNull().default("ACTIVE"), contactName: text("contact_name").notNull().default(""),
  phone: text("phone").notNull().default(""), email: text("email").notNull().default(""), address: text("address").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""), owner: text("owner").notNull().default(""), remark: text("remark").notNull().default(""),
  version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [
  uniqueIndex("customers_code_uq").on(t.customerCode), uniqueIndex("customers_normalized_name_uq").on(t.normalizedName),
  index("customers_status_updated_idx").on(t.status, t.updatedAt, t.id), check("customers_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`),
  check("customers_version_ck", sql`${t.version} > 0`), check("customers_name_ck", sql`char_length(btrim(${t.customerName})) between 1 and 200`),
]);

export const suppliers = pgTable("suppliers", {
  id: bigserial("id", { mode: "number" }).primaryKey(), supplierCode: text("supplier_code").notNull(), supplierName: text("supplier_name").notNull(),
  normalizedName: text("normalized_name").notNull(), status: text("status").notNull().default("ACTIVE"), contactName: text("contact_name").notNull().default(""),
  phone: text("phone").notNull().default(""), email: text("email").notNull().default(""), address: text("address").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""), supplierLevel: text("supplier_level").notNull().default(""), owner: text("owner").notNull().default(""),
  remark: text("remark").notNull().default(""), version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [
  uniqueIndex("suppliers_code_uq").on(t.supplierCode), uniqueIndex("suppliers_normalized_name_uq").on(t.normalizedName),
  index("suppliers_status_updated_idx").on(t.status, t.updatedAt, t.id), check("suppliers_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`),
  check("suppliers_version_ck", sql`${t.version} > 0`), check("suppliers_name_ck", sql`char_length(btrim(${t.supplierName})) between 1 and 200`),
]);

export const products = pgTable("products", {
  id: bigserial("id", { mode: "number" }).primaryKey(), productCode: text("product_code").notNull(), productName: text("product_name").notNull(),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("ACTIVE"), currentVersionNo: integer("current_version_no").notNull().default(1), version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [
  uniqueIndex("products_code_uq").on(t.productCode), index("products_customer_status_idx").on(t.customerId, t.status),
  index("products_status_updated_idx").on(t.status, t.updatedAt, t.id), check("products_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`),
  check("products_version_ck", sql`${t.version} > 0 and ${t.currentVersionNo} > 0`), check("products_name_ck", sql`char_length(btrim(${t.productName})) between 1 and 200`),
]);

export const productVersions = pgTable("product_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), productId: bigint("product_id", { mode: "number" }).notNull().references(() => products.id, { onDelete: "restrict" }),
  versionNo: integer("version_no").notNull(), versionCode: text("version_code").notNull(), status: text("status").notNull().default("DRAFT"),
  productType: text("product_type").notNull(), lifecycleStatus: text("lifecycle_status").notNull(), layerCount: integer("layer_count"),
  boardThickness: numeric("board_thickness", { precision: 18, scale: 6 }), minLineWidth: numeric("min_line_width", { precision: 18, scale: 6 }),
  minHole: numeric("min_hole", { precision: 18, scale: 6 }), surfaceFinish: text("surface_finish").notNull().default(""),
  smtRequired: boolean("smt_required").notNull().default(false), engineeringOwner: text("engineering_owner").notNull().default(""), remark: text("remark").notNull().default(""),
  releasedBy: text("released_by").notNull().default(""), releasedAt: timestamptz("released_at"), ...auditColumns,
}, (t) => [
  uniqueIndex("product_versions_product_no_uq").on(t.productId, t.versionNo), uniqueIndex("product_versions_product_code_uq").on(t.productId, t.versionCode),
  index("product_versions_product_status_idx").on(t.productId, t.status, t.versionNo), check("product_versions_no_ck", sql`${t.versionNo} > 0`),
  check("product_versions_status_ck", sql`${t.status} in ('DRAFT','RELEASED','OBSOLETE')`), check("product_versions_layer_ck", sql`${t.layerCount} is null or ${t.layerCount} > 0`),
  check("product_versions_dimension_ck", sql`(${t.boardThickness} is null or ${t.boardThickness} > 0) and (${t.minLineWidth} is null or ${t.minLineWidth} > 0) and (${t.minHole} is null or ${t.minHole} > 0)`),
]);

export const bomHeaders = pgTable("bom_headers", {
  id: bigserial("id", { mode: "number" }).primaryKey(), bomCode: text("bom_code").notNull(), productId: bigint("product_id", { mode: "number" }).notNull().references(() => products.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("ACTIVE"), currentVersionNo: integer("current_version_no").notNull().default(1), version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [
  uniqueIndex("bom_headers_code_uq").on(t.bomCode), index("bom_headers_product_status_idx").on(t.productId, t.status),
  check("bom_headers_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`), check("bom_headers_version_ck", sql`${t.version} > 0 and ${t.currentVersionNo} > 0`),
]);

export const bomVersions = pgTable("bom_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), bomHeaderId: bigint("bom_header_id", { mode: "number" }).notNull().references(() => bomHeaders.id, { onDelete: "restrict" }),
  productVersionId: bigint("product_version_id", { mode: "number" }).notNull().references(() => productVersions.id, { onDelete: "restrict" }),
  versionNo: integer("version_no").notNull(), versionCode: text("version_code").notNull(), status: text("status").notNull().default("DRAFT"),
  remark: text("remark").notNull().default(""), releasedBy: text("released_by").notNull().default(""), releasedAt: timestamptz("released_at"), ...auditColumns,
}, (t) => [
  uniqueIndex("bom_versions_header_no_uq").on(t.bomHeaderId, t.versionNo), uniqueIndex("bom_versions_header_code_uq").on(t.bomHeaderId, t.versionCode),
  index("bom_versions_header_status_idx").on(t.bomHeaderId, t.status, t.versionNo), check("bom_versions_no_ck", sql`${t.versionNo} > 0`),
  check("bom_versions_status_ck", sql`${t.status} in ('DRAFT','RELEASED','OBSOLETE')`),
]);

export const bomLines = pgTable("bom_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), bomVersionId: bigint("bom_version_id", { mode: "number" }).notNull().references(() => bomVersions.id, { onDelete: "restrict" }),
  lineNo: integer("line_no").notNull(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  quantityPer: numeric("quantity_per", { precision: 24, scale: 6 }).notNull(), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }),
  lossRate: numeric("loss_rate", { precision: 12, scale: 8 }).notNull().default("0"), processStage: text("process_stage").notNull().default(""),
  remark: text("remark").notNull().default(""), ...auditColumns,
}, (t) => [
  uniqueIndex("bom_lines_version_line_uq").on(t.bomVersionId, t.lineNo), uniqueIndex("bom_lines_version_material_stage_uq").on(t.bomVersionId, t.materialId, t.processStage),
  index("bom_lines_material_idx").on(t.materialId, t.bomVersionId), check("bom_lines_line_ck", sql`${t.lineNo} > 0`),
  check("bom_lines_quantity_ck", sql`${t.quantityPer} > 0`), check("bom_lines_loss_ck", sql`${t.lossRate} >= 0 and ${t.lossRate} < 1`),
]);

export const inventoryBalances = pgTable("inventory_balances", {
  itemCode: text("item_code").primaryKey(), onHandQty: numeric("on_hand_qty", { precision: 24, scale: 6 }).notNull().default("0"), reservedQty: numeric("reserved_qty", { precision: 24, scale: 6 }).notNull().default("0"), version: integer("version").notNull().default(1), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const businessProjects = pgTable("business_projects", {
  id: bigserial("id", { mode: "number" }).primaryKey(), projectCode: text("project_code").notNull(),
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customers.id, { onDelete: "restrict" }),
  projectName: text("project_name").notNull(), projectGoal: text("project_goal").notNull(),
  marketOwner: text("market_owner").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  projectOwner: text("project_owner").references(() => appUsers.username, { onDelete: "restrict" }),
  status: text("status").notNull().default("DRAFT"), targetDeliveryDate: date("target_delivery_date", { mode: "string" }),
  currentRequirementVersionNo: integer("current_requirement_version_no").notNull().default(1), version: integer("version").notNull().default(1),
  requestId: uuid("request_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("business_projects_code_uq").on(t.projectCode),
  index("business_projects_market_status_idx").on(t.marketOwner, t.status, t.updatedAt, t.id),
  index("business_projects_project_status_idx").on(t.projectOwner, t.status, t.updatedAt, t.id),
  index("business_projects_customer_idx").on(t.customerId, t.updatedAt, t.id),
  check("business_projects_code_ck", sql`${t.projectCode} ~ '^PRJ-[0-9]{8}$'`),
  check("business_projects_status_ck", sql`${t.status} in ('DRAFT','SUBMITTED','RETURNED','ACCEPTED')`),
  check("business_projects_version_ck", sql`${t.version}>0 and ${t.currentRequirementVersionNo}>0`),
  check("business_projects_text_ck", sql`char_length(btrim(${t.projectName})) between 1 and 200 and char_length(btrim(${t.projectGoal})) between 1 and 2000`),
  check("business_projects_owner_ck", sql`(${t.status}='ACCEPTED' and ${t.projectOwner} is not null) or (${t.status}<>'ACCEPTED')`),
]);

export const projectRequirementVersions = pgTable("project_requirement_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), projectId: bigint("project_id", { mode: "number" }).notNull().references(() => businessProjects.id, { onDelete: "restrict" }),
  versionNo: integer("version_no").notNull(), customerRequirementSummary: text("customer_requirement_summary").notNull(),
  quantityRequirement: numeric("quantity_requirement", { precision: 24, scale: 6 }), quantityUnit: text("quantity_unit").notNull().default(""),
  deliveryRequirement: text("delivery_requirement").notNull().default(""), commercialTerms: text("commercial_terms").notNull().default(""),
  technicalRequirements: text("technical_requirements").notNull().default(""), contentDigest: text("content_digest").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("project_requirement_versions_project_no_uq").on(t.projectId, t.versionNo),
  uniqueIndex("project_requirement_versions_project_digest_uq").on(t.projectId, t.contentDigest),
  index("project_requirement_versions_project_created_idx").on(t.projectId, t.createdAt, t.id),
  check("project_requirement_versions_no_ck", sql`${t.versionNo}>0`),
  check("project_requirement_versions_quantity_ck", sql`${t.quantityRequirement} is null or ${t.quantityRequirement}>0`),
  check("project_requirement_versions_digest_ck", sql`${t.contentDigest} ~ '^[0-9a-f]{64}$'`),
  check("project_requirement_versions_summary_ck", sql`char_length(btrim(${t.customerRequirementSummary})) between 1 and 4000`),
]);

export const projectRequirementItems = pgTable("project_requirement_items", {
  id: bigserial("id", { mode: "number" }).primaryKey(), requirementVersionId: bigint("requirement_version_id", { mode: "number" }).notNull().references(() => projectRequirementVersions.id, { onDelete: "restrict" }),
  lineNo: integer("line_no").notNull(), provisionalName: text("provisional_name").notNull(), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
  unitId: bigint("unit_id", { mode: "number" }).references(() => units.id, { onDelete: "restrict" }), unitPending: boolean("unit_pending").notNull().default(false),
  specificationRequirement: text("specification_requirement").notNull().default(""), productId: bigint("product_id", { mode: "number" }).references(() => products.id, { onDelete: "restrict" }),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("project_requirement_items_version_line_uq").on(t.requirementVersionId, t.lineNo),
  index("project_requirement_items_product_idx").on(t.productId, t.id).where(sql`${t.productId} is not null`),
  check("project_requirement_items_line_ck", sql`${t.lineNo}>0`), check("project_requirement_items_quantity_ck", sql`${t.quantity}>0`),
  check("project_requirement_items_unit_ck", sql`(${t.unitPending}=true and ${t.unitId} is null) or (${t.unitPending}=false and ${t.unitId} is not null)`),
  check("project_requirement_items_name_ck", sql`char_length(btrim(${t.provisionalName})) between 1 and 200`),
]);

export const projectDocumentLinks = pgTable("project_document_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(), projectId: bigint("project_id", { mode: "number" }).notNull().references(() => businessProjects.id, { onDelete: "restrict" }),
  requirementVersionId: bigint("requirement_version_id", { mode: "number" }).notNull().references(() => projectRequirementVersions.id, { onDelete: "restrict" }),
  fileId: bigint("file_id", { mode: "number" }).notNull().references(() => materialImportFiles.id, { onDelete: "restrict" }),
  documentType: text("document_type").notNull(), displayName: text("display_name").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("project_document_links_version_file_type_uq").on(t.requirementVersionId, t.fileId, t.documentType),
  index("project_document_links_project_idx").on(t.projectId, t.requirementVersionId, t.id),
  check("project_document_links_type_ck", sql`${t.documentType} in ('CUSTOMER_REQUIREMENT','DRAWING','SPECIFICATION','REFERENCE')`),
  check("project_document_links_name_ck", sql`char_length(btrim(${t.displayName})) between 1 and 255`),
]);

export const projectHandoffs = pgTable("project_handoffs", {
  id: bigserial("id", { mode: "number" }).primaryKey(), projectId: bigint("project_id", { mode: "number" }).notNull().references(() => businessProjects.id, { onDelete: "restrict" }),
  requirementVersionId: bigint("requirement_version_id", { mode: "number" }).notNull().references(() => projectRequirementVersions.id, { onDelete: "restrict" }),
  fromDepartment: text("from_department").notNull().default("MARKET"), toDepartment: text("to_department").notNull().default("PROJECT"), status: text("status").notNull(),
  submittedBy: text("submitted_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), submittedAt: timestamptz("submitted_at").notNull(),
  acceptedBy: text("accepted_by").references(() => appUsers.username, { onDelete: "restrict" }), acceptedAt: timestamptz("accepted_at"),
  returnedBy: text("returned_by").references(() => appUsers.username, { onDelete: "restrict" }), returnedAt: timestamptz("returned_at"),
  returnReason: text("return_reason").notNull().default(""), version: integer("version").notNull().default(1), requestId: uuid("request_id").notNull(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("project_handoffs_project_uq").on(t.projectId),
  index("project_handoffs_queue_idx").on(t.toDepartment, t.status, t.submittedAt, t.id),
  index("project_handoffs_submitter_idx").on(t.submittedBy, t.status, t.updatedAt, t.id),
  check("project_handoffs_department_ck", sql`${t.fromDepartment}='MARKET' and ${t.toDepartment}='PROJECT'`),
  check("project_handoffs_status_ck", sql`${t.status} in ('SUBMITTED','RETURNED','ACCEPTED')`), check("project_handoffs_version_ck", sql`${t.version}>0`),
  check("project_handoffs_accept_ck", sql`(${t.status}='ACCEPTED' and ${t.acceptedBy} is not null and ${t.acceptedAt} is not null) or ${t.status}<>'ACCEPTED'`),
  check("project_handoffs_return_ck", sql`(${t.status}='RETURNED' and ${t.returnedBy} is not null and ${t.returnedAt} is not null and char_length(btrim(${t.returnReason})) between 1 and 1000) or ${t.status}<>'RETURNED'`),
]);

export const projectHandoffEvents = pgTable("project_handoff_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), handoffId: bigint("handoff_id", { mode: "number" }).notNull().references(() => projectHandoffs.id, { onDelete: "restrict" }),
  projectId: bigint("project_id", { mode: "number" }).notNull().references(() => businessProjects.id, { onDelete: "restrict" }),
  requirementVersionId: bigint("requirement_version_id", { mode: "number" }).notNull().references(() => projectRequirementVersions.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(), actor: text("actor").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(), reason: text("reason").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  index("project_handoff_events_project_idx").on(t.projectId, t.id), index("project_handoff_events_handoff_idx").on(t.handoffId, t.id),
  index("project_handoff_events_request_idx").on(t.requestId, t.id),
  check("project_handoff_events_type_ck", sql`${t.eventType} in ('SUBMITTED','ACCEPTED','RETURNED','RESUBMITTED')`),
  check("project_handoff_events_reason_ck", sql`(${t.eventType}='RETURNED' and char_length(btrim(${t.reason})) between 1 and 1000) or (${t.eventType}<>'RETURNED' and char_length(${t.reason})<=1000)`),
]);

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

export const inventoryAdjustments = pgTable("inventory_adjustments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  adjustmentCode: text("adjustment_code").notNull(),
  operationType: text("operation_type").notNull(),
  status: text("status").notNull().default("POSTED"),
  reversalOfAdjustmentId: bigint("reversal_of_adjustment_id", { mode: "number" }).references((): AnyPgColumn => inventoryAdjustments.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  operationId: uuid("operation_id").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("inventory_adjustments_code_uq").on(t.adjustmentCode),
  uniqueIndex("inventory_adjustments_operation_uq").on(t.operationId),
  uniqueIndex("inventory_adjustments_request_uq").on(t.requestId),
  uniqueIndex("inventory_adjustments_reversal_uq").on(t.reversalOfAdjustmentId).where(sql`${t.reversalOfAdjustmentId} is not null`),
  index("inventory_adjustments_created_idx").on(t.createdAt, t.id),
  index("inventory_adjustments_type_created_idx").on(t.operationType, t.createdAt, t.id),
  check("inventory_adjustments_type_ck", sql`${t.operationType} in ('RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL','MIGRATION_OPENING')`),
  check("inventory_adjustments_status_ck", sql`${t.status} = 'POSTED'`),
  check("inventory_adjustments_reason_ck", sql`char_length(btrim(${t.reason})) between 1 and 1000`),
  check("inventory_adjustments_reversal_ck", sql`(${t.operationType} = 'REVERSAL' and ${t.reversalOfAdjustmentId} is not null) or (${t.operationType} <> 'REVERSAL' and ${t.reversalOfAdjustmentId} is null)`),
]);

export const inventoryStockBalances = pgTable("inventory_stock_balances", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }),
  locationCode: text("location_code").notNull().default("MAIN"),
  lotCode: text("lot_code").notNull().default(""),
  onHandQty: numeric("on_hand_qty", { precision: 24, scale: 6 }).notNull().default("0"),
  reservedQty: numeric("reserved_qty", { precision: 24, scale: 6 }).notNull().default("0"),
  frozenQty: numeric("frozen_qty", { precision: 24, scale: 6 }).notNull().default("0"),
  version: integer("version").notNull().default(1),
  lastLedgerEntryId: bigint("last_ledger_entry_id", { mode: "number" }),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("inventory_stock_balances_position_uq").on(t.materialId, t.locationCode, t.lotCode),
  index("inventory_stock_balances_material_idx").on(t.materialId, t.updatedAt),
  check("inventory_stock_balances_location_ck", sql`${t.locationCode} = 'MAIN' and ${t.lotCode} = ''`),
  check("inventory_stock_balances_quantity_ck", sql`${t.onHandQty} >= 0 and ${t.reservedQty} >= 0 and ${t.frozenQty} >= 0 and ${t.onHandQty} >= ${t.reservedQty} + ${t.frozenQty}`),
  check("inventory_stock_balances_version_ck", sql`${t.version} > 0`),
]);

export const inventoryLedgerEntries = pgTable("inventory_ledger_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  operationId: uuid("operation_id").notNull(),
  adjustmentId: bigint("adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }),
  lineNo: integer("line_no").notNull(),
  balanceId: bigint("balance_id", { mode: "number" }).notNull().references(() => inventoryStockBalances.id, { onDelete: "restrict" }),
  materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }),
  locationCode: text("location_code").notNull().default("MAIN"),
  lotCode: text("lot_code").notNull().default(""),
  entryType: text("entry_type").notNull(),
  onHandDelta: numeric("on_hand_delta", { precision: 24, scale: 6 }).notNull().default("0"),
  frozenDelta: numeric("frozen_delta", { precision: 24, scale: 6 }).notNull().default("0"),
  beforeOnHandQty: numeric("before_on_hand_qty", { precision: 24, scale: 6 }).notNull(),
  afterOnHandQty: numeric("after_on_hand_qty", { precision: 24, scale: 6 }).notNull(),
  beforeFrozenQty: numeric("before_frozen_qty", { precision: 24, scale: 6 }).notNull(),
  afterFrozenQty: numeric("after_frozen_qty", { precision: 24, scale: 6 }).notNull(),
  balanceVersionBefore: integer("balance_version_before").notNull(),
  balanceVersionAfter: integer("balance_version_after").notNull(),
  reversalOfLedgerEntryId: bigint("reversal_of_ledger_entry_id", { mode: "number" }).references((): AnyPgColumn => inventoryLedgerEntries.id, { onDelete: "restrict" }),
  sourceType: text("source_type").notNull().default("INVENTORY_ADJUSTMENT"),
  sourceId: bigint("source_id", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("inventory_ledger_entries_operation_uq").on(t.operationId),
  uniqueIndex("inventory_ledger_entries_adjustment_line_uq").on(t.adjustmentId, t.lineNo),
  uniqueIndex("inventory_ledger_entries_reversal_uq").on(t.reversalOfLedgerEntryId).where(sql`${t.reversalOfLedgerEntryId} is not null`),
  index("inventory_ledger_entries_material_created_idx").on(t.materialId, t.createdAt, t.id),
  index("inventory_ledger_entries_balance_id_idx").on(t.balanceId, t.id),
  index("inventory_ledger_entries_source_idx").on(t.sourceType, t.sourceId),
  check("inventory_ledger_entries_line_ck", sql`${t.lineNo} > 0`),
  check("inventory_ledger_entries_type_ck", sql`${t.entryType} in ('RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL','MIGRATION_OPENING')`),
  check("inventory_ledger_entries_location_ck", sql`${t.locationCode} = 'MAIN' and ${t.lotCode} = ''`),
  check("inventory_ledger_entries_delta_ck", sql`${t.onHandDelta} <> 0 or ${t.frozenDelta} <> 0`),
  check("inventory_ledger_entries_math_ck", sql`${t.afterOnHandQty} = ${t.beforeOnHandQty} + ${t.onHandDelta} and ${t.afterFrozenQty} = ${t.beforeFrozenQty} + ${t.frozenDelta}`),
  check("inventory_ledger_entries_quantity_ck", sql`${t.beforeOnHandQty} >= 0 and ${t.afterOnHandQty} >= 0 and ${t.beforeFrozenQty} >= 0 and ${t.afterFrozenQty} >= 0 and ${t.afterFrozenQty} <= ${t.afterOnHandQty}`),
  check("inventory_ledger_entries_version_ck", sql`${t.balanceVersionBefore} >= 0 and ${t.balanceVersionAfter} = ${t.balanceVersionBefore} + 1`),
  check("inventory_ledger_entries_source_ck", sql`(${t.sourceType}='INVENTORY_ADJUSTMENT' and ${t.sourceId}=${t.adjustmentId}) or (${t.entryType}='MIGRATION_OPENING' and ${t.sourceType}='MIGRATION_OPENING') or (${t.entryType}='REVERSAL' and ${t.sourceType}='MIGRATION_OPENING_REVERSAL')`),
  check("inventory_ledger_entries_reversal_ck", sql`(${t.entryType} = 'REVERSAL' and ${t.reversalOfLedgerEntryId} is not null) or (${t.entryType} <> 'REVERSAL' and ${t.reversalOfLedgerEntryId} is null)`),
]);

export const inventoryAdjustmentLines = pgTable("inventory_adjustment_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  adjustmentId: bigint("adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }),
  lineNo: integer("line_no").notNull(),
  balanceId: bigint("balance_id", { mode: "number" }).notNull().references(() => inventoryStockBalances.id, { onDelete: "restrict" }),
  ledgerEntryId: bigint("ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }),
  materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }),
  locationCode: text("location_code").notNull().default("MAIN"),
  lotCode: text("lot_code").notNull().default(""),
  requestedQty: numeric("requested_qty", { precision: 24, scale: 6 }),
  countedQty: numeric("counted_qty", { precision: 24, scale: 6 }),
  onHandDelta: numeric("on_hand_delta", { precision: 24, scale: 6 }).notNull().default("0"),
  frozenDelta: numeric("frozen_delta", { precision: 24, scale: 6 }).notNull().default("0"),
  beforeOnHandQty: numeric("before_on_hand_qty", { precision: 24, scale: 6 }).notNull(),
  afterOnHandQty: numeric("after_on_hand_qty", { precision: 24, scale: 6 }).notNull(),
  beforeFrozenQty: numeric("before_frozen_qty", { precision: 24, scale: 6 }).notNull(),
  afterFrozenQty: numeric("after_frozen_qty", { precision: 24, scale: 6 }).notNull(),
  balanceVersionBefore: integer("balance_version_before").notNull(),
  balanceVersionAfter: integer("balance_version_after").notNull(),
}, (t) => [
  uniqueIndex("inventory_adjustment_lines_adjustment_line_uq").on(t.adjustmentId, t.lineNo),
  uniqueIndex("inventory_adjustment_lines_ledger_uq").on(t.ledgerEntryId),
  index("inventory_adjustment_lines_material_idx").on(t.materialId, t.adjustmentId),
  check("inventory_adjustment_lines_line_ck", sql`${t.lineNo} > 0`),
  check("inventory_adjustment_lines_location_ck", sql`${t.locationCode} = 'MAIN' and ${t.lotCode} = ''`),
  check("inventory_adjustment_lines_input_ck", sql`(${t.requestedQty} is null) <> (${t.countedQty} is null) and coalesce(${t.requestedQty}, ${t.countedQty}) >= 0`),
  check("inventory_adjustment_lines_delta_ck", sql`${t.onHandDelta} <> 0 or ${t.frozenDelta} <> 0`),
  check("inventory_adjustment_lines_math_ck", sql`${t.afterOnHandQty} = ${t.beforeOnHandQty} + ${t.onHandDelta} and ${t.afterFrozenQty} = ${t.beforeFrozenQty} + ${t.frozenDelta}`),
  check("inventory_adjustment_lines_version_ck", sql`${t.balanceVersionBefore} >= 0 and ${t.balanceVersionAfter} = ${t.balanceVersionBefore} + 1`),
]);

export const inventoryMigrationOpenings = pgTable("inventory_migration_openings", {
  id: bigserial("id", { mode: "number" }).primaryKey(), migrationOpeningSourceId: uuid("migration_opening_source_id").notNull().references(() => migrationOpeningSources.id, { onDelete: "restrict" }),
  openingCode: text("opening_code").notNull(), inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }),
  effectiveAt: timestamptz("effective_at").notNull(), status: text("status").notNull().default("POSTED"), operationId: uuid("operation_id").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("inventory_migration_openings_source_uq").on(t.migrationOpeningSourceId), uniqueIndex("inventory_migration_openings_code_uq").on(t.openingCode), uniqueIndex("inventory_migration_openings_adjustment_uq").on(t.inventoryAdjustmentId), uniqueIndex("inventory_migration_openings_operation_uq").on(t.operationId), check("inventory_migration_openings_status_ck", sql`${t.status}='POSTED'`)]);

export const inventoryMigrationOpeningLines = pgTable("inventory_migration_opening_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), inventoryOpeningId: bigint("inventory_opening_id", { mode: "number" }).notNull().references(() => inventoryMigrationOpenings.id, { onDelete: "restrict" }),
  lineNo: integer("line_no").notNull(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), locationCode: text("location_code").notNull().default("MAIN"), lotCode: text("lot_code").notNull().default(""),
  onHandQuantity: numeric("on_hand_quantity", { precision: 24, scale: 6 }).notNull(), frozenQuantity: numeric("frozen_quantity", { precision: 24, scale: 6 }).notNull(),
  inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("inventory_migration_opening_lines_position_uq").on(t.inventoryOpeningId, t.materialId, t.unitId, t.locationCode, t.lotCode), uniqueIndex("inventory_migration_opening_lines_line_uq").on(t.inventoryOpeningId, t.lineNo), uniqueIndex("inventory_migration_opening_lines_ledger_uq").on(t.inventoryLedgerEntryId), check("inventory_migration_opening_lines_line_ck", sql`${t.lineNo}>0`), check("inventory_migration_opening_lines_location_ck", sql`${t.locationCode}='MAIN' and ${t.lotCode}=''`), check("inventory_migration_opening_lines_quantity_ck", sql`${t.onHandQuantity}>0 and ${t.frozenQuantity}>=0 and ${t.frozenQuantity}<=${t.onHandQuantity}`)]);

export const inventoryMigrationOpeningReversals = pgTable("inventory_migration_opening_reversals", {
  id: bigserial("id", { mode: "number" }).primaryKey(), inventoryOpeningId: bigint("inventory_opening_id", { mode: "number" }).notNull().references(() => inventoryMigrationOpenings.id, { onDelete: "restrict" }),
  inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }), reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("inventory_migration_opening_reversals_opening_uq").on(t.inventoryOpeningId), uniqueIndex("inventory_migration_opening_reversals_adjustment_uq").on(t.inventoryAdjustmentId), uniqueIndex("inventory_migration_opening_reversals_operation_uq").on(t.operationId), check("inventory_migration_opening_reversals_reason_ck", sql`char_length(btrim(${t.reason})) between 1 and 1000`)]);

export const inventoryMigrationOpeningReversalLines = pgTable("inventory_migration_opening_reversal_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), inventoryOpeningReversalId: bigint("inventory_opening_reversal_id", { mode: "number" }).notNull().references(() => inventoryMigrationOpeningReversals.id, { onDelete: "restrict" }),
  originalOpeningLineId: bigint("original_opening_line_id", { mode: "number" }).notNull().references(() => inventoryMigrationOpeningLines.id, { onDelete: "restrict" }), inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("inventory_migration_opening_reversal_lines_original_uq").on(t.originalOpeningLineId), uniqueIndex("inventory_migration_opening_reversal_lines_ledger_uq").on(t.inventoryLedgerEntryId)]);

export const purchaseOrders = pgTable("purchase_orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  poCode: text("po_code").notNull(), supplierId: bigint("supplier_id", { mode: "number" }).notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("OPEN"), currencyCode: text("currency_code").notNull(), sourceType: text("source_type").notNull().default("MANUAL"),
  expectedAt: timestamptz("expected_at"), remark: text("remark").notNull().default(""), version: integer("version").notNull().default(1),
  operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_orders_code_uq").on(t.poCode), uniqueIndex("purchase_orders_operation_uq").on(t.operationId), index("purchase_orders_request_idx").on(t.requestId), index("purchase_orders_supplier_status_idx").on(t.supplierId, t.status, t.createdAt), check("purchase_orders_status_ck", sql`${t.status} in ('OPEN','PARTIALLY_RECEIVED','RECEIVED','CLOSED')`), check("purchase_orders_currency_ck", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`), check("purchase_orders_source_ck", sql`${t.sourceType} in ('MANUAL','BOM_SHORTAGE')`), check("purchase_orders_version_ck", sql`${t.version} > 0`)]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(),
  materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), supplierMappingId: bigint("supplier_mapping_id", { mode: "number" }).notNull().references(() => supplierMappings.id, { onDelete: "restrict" }),
  orderQty: numeric("order_qty", { precision: 24, scale: 6 }).notNull(), unitPrice: numeric("unit_price", { precision: 24, scale: 6 }).notNull(), receivedQty: numeric("received_qty", { precision: 24, scale: 6 }).notNull().default("0"),
  status: text("status").notNull().default("OPEN"), version: integer("version").notNull().default(1), remark: text("remark").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_order_lines_line_uq").on(t.purchaseOrderId, t.lineNo), uniqueIndex("purchase_order_lines_material_uq").on(t.purchaseOrderId, t.materialId), index("purchase_order_lines_status_idx").on(t.purchaseOrderId, t.status, t.id), check("purchase_order_lines_line_ck", sql`${t.lineNo} > 0`), check("purchase_order_lines_quantity_ck", sql`${t.orderQty} > 0 and ${t.receivedQty} >= 0 and ${t.receivedQty} <= ${t.orderQty}`), check("purchase_order_lines_price_ck", sql`${t.unitPrice} > 0`), check("purchase_order_lines_status_ck", sql`${t.status} in ('OPEN','PARTIALLY_RECEIVED','RECEIVED')`), check("purchase_order_lines_version_ck", sql`${t.version} > 0`)]);

export const purchaseOrderSourceLinks = pgTable("purchase_order_source_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(), purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }), sourceType: text("source_type").notNull(), bomVersionId: bigint("bom_version_id", { mode: "number" }).references(() => bomVersions.id, { onDelete: "restrict" }), orderQty: numeric("order_qty", { precision: 24, scale: 6 }), sourceOperationId: uuid("source_operation_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_order_source_links_po_uq").on(t.purchaseOrderId), index("purchase_order_source_links_bom_idx").on(t.bomVersionId, t.createdAt), check("purchase_order_source_links_ck", sql`(${t.sourceType}='MANUAL' and ${t.bomVersionId} is null and ${t.orderQty} is null) or (${t.sourceType}='BOM_SHORTAGE' and ${t.bomVersionId} is not null and ${t.orderQty} > 0)`)]);

export const purchaseOrderStatusEvents = pgTable("purchase_order_status_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }), fromStatus: text("from_status"), toStatus: text("to_status").notNull(), eventType: text("event_type").notNull(), reason: text("reason").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("purchase_order_status_events_po_idx").on(t.purchaseOrderId, t.id), check("purchase_order_status_events_to_ck", sql`${t.toStatus} in ('OPEN','PARTIALLY_RECEIVED','RECEIVED','CLOSED')`)]);

export const purchaseReceipts = pgTable("purchase_receipts", {
  id: bigserial("id", { mode: "number" }).primaryKey(), receiptCode: text("receipt_code").notNull(), purchaseOrderId: bigint("purchase_order_id", { mode: "number" }).notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }), receiptType: text("receipt_type").notNull().default("RECEIPT"), reversalOfReceiptId: bigint("reversal_of_receipt_id", { mode: "number" }).references((): AnyPgColumn => purchaseReceipts.id, { onDelete: "restrict" }), inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }), status: text("status").notNull().default("POSTED"), reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_receipts_code_uq").on(t.receiptCode), uniqueIndex("purchase_receipts_operation_uq").on(t.operationId), uniqueIndex("purchase_receipts_request_uq").on(t.requestId), uniqueIndex("purchase_receipts_inventory_adjustment_uq").on(t.inventoryAdjustmentId), uniqueIndex("purchase_receipts_reversal_uq").on(t.reversalOfReceiptId).where(sql`${t.reversalOfReceiptId} is not null`), index("purchase_receipts_po_created_idx").on(t.purchaseOrderId, t.createdAt, t.id), check("purchase_receipts_type_ck", sql`${t.receiptType} in ('RECEIPT','REVERSAL')`), check("purchase_receipts_status_ck", sql`${t.status}='POSTED'`), check("purchase_receipts_reversal_ck", sql`(${t.receiptType}='REVERSAL' and ${t.reversalOfReceiptId} is not null) or (${t.receiptType}='RECEIPT' and ${t.reversalOfReceiptId} is null)`)]);

export const purchaseReceiptLines = pgTable("purchase_receipt_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), purchaseReceiptId: bigint("purchase_receipt_id", { mode: "number" }).notNull().references(() => purchaseReceipts.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), purchaseOrderLineId: bigint("purchase_order_line_id", { mode: "number" }).notNull().references(() => purchaseOrderLines.id, { onDelete: "restrict" }), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), reversalOfReceiptLineId: bigint("reversal_of_receipt_line_id", { mode: "number" }).references((): AnyPgColumn => purchaseReceiptLines.id, { onDelete: "restrict" }), lineAmount: numeric("line_amount", { precision: 48, scale: 6 }).notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_receipt_lines_line_uq").on(t.purchaseReceiptId, t.lineNo), uniqueIndex("purchase_receipt_lines_po_line_uq").on(t.purchaseReceiptId, t.purchaseOrderLineId), uniqueIndex("purchase_receipt_lines_ledger_uq").on(t.inventoryLedgerEntryId), uniqueIndex("purchase_receipt_lines_reversal_uq").on(t.reversalOfReceiptLineId).where(sql`${t.reversalOfReceiptLineId} is not null`), index("purchase_receipt_lines_po_line_idx").on(t.purchaseOrderLineId, t.id), check("purchase_receipt_lines_quantity_ck", sql`${t.quantity} > 0`), check("purchase_receipt_lines_amount_ck", sql`${t.lineAmount} > 0`)]);

export const purchaseFinancialSourceEntries = pgTable("purchase_financial_source_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(), purchaseReceiptId: bigint("purchase_receipt_id", { mode: "number" }).notNull().references(() => purchaseReceipts.id, { onDelete: "restrict" }), supplierId: bigint("supplier_id", { mode: "number" }).notNull().references(() => suppliers.id, { onDelete: "restrict" }), entryType: text("entry_type").notNull(), amount: numeric("amount", { precision: 48, scale: 6 }).notNull(), currencyCode: text("currency_code").notNull(), sourceId: uuid("source_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("purchase_financial_source_entries_receipt_uq").on(t.purchaseReceiptId), uniqueIndex("purchase_financial_source_entries_source_uq").on(t.sourceId), index("purchase_financial_source_entries_supplier_idx").on(t.supplierId, t.createdAt, t.id), check("purchase_financial_source_entries_type_ck", sql`${t.entryType} in ('RECEIPT','RECEIPT_REVERSAL')`), check("purchase_financial_source_entries_amount_ck", sql`(${t.entryType}='RECEIPT' and ${t.amount}>0) or (${t.entryType}='RECEIPT_REVERSAL' and ${t.amount}<0)`), check("purchase_financial_source_entries_currency_ck", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`)]);

export const materialCustomerRestrictions = pgTable("material_customer_restrictions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customers.id, { onDelete: "restrict" }), status: text("status").notNull().default("ACTIVE"), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("material_customer_restrictions_pair_uq").on(t.materialId, t.customerId), index("material_customer_restrictions_customer_idx").on(t.customerId, t.status, t.materialId), check("material_customer_restrictions_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`)]);

export const productionWorkOrders = pgTable("production_work_orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(), workOrderCode: text("work_order_code").notNull(), productId: bigint("product_id", { mode: "number" }).notNull().references(() => products.id, { onDelete: "restrict" }), productVersionId: bigint("product_version_id", { mode: "number" }).notNull().references(() => productVersions.id, { onDelete: "restrict" }), bomVersionId: bigint("bom_version_id", { mode: "number" }).notNull().references(() => bomVersions.id, { onDelete: "restrict" }), finishedMaterialId: bigint("finished_material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), finishedUnitId: bigint("finished_unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), plannedQty: numeric("planned_qty", { precision: 24, scale: 6 }).notNull(), reportedQty: numeric("reported_qty", { precision: 24, scale: 6 }).notNull().default("0"), goodQty: numeric("good_qty", { precision: 24, scale: 6 }).notNull().default("0"), scrapQty: numeric("scrap_qty", { precision: 24, scale: 6 }).notNull().default("0"), completedQty: numeric("completed_qty", { precision: 24, scale: 6 }).notNull().default("0"), status: text("status").notNull().default("DRAFT"), plannedStart: timestamptz("planned_start"), plannedFinish: timestamptz("planned_finish"), owner: text("owner").notNull().default(""), remark: text("remark").notNull().default(""), version: integer("version").notNull().default(1), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_work_orders_code_uq").on(t.workOrderCode), uniqueIndex("production_work_orders_operation_uq").on(t.operationId), index("production_work_orders_status_idx").on(t.status, t.updatedAt, t.id), index("production_work_orders_product_idx").on(t.productId, t.createdAt, t.id), check("production_work_orders_status_ck", sql`${t.status} in ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED')`), check("production_work_orders_quantity_ck", sql`${t.plannedQty}>0 and ${t.reportedQty}>=0 and ${t.goodQty}>=0 and ${t.scrapQty}>=0 and ${t.completedQty}>=0 and ${t.completedQty}<=${t.plannedQty}`), check("production_work_orders_report_ck", sql`${t.goodQty}+${t.scrapQty}<=${t.reportedQty}`), check("production_work_orders_version_ck", sql`${t.version}>0`)]);

export const productionWorkOrderStatusEvents = pgTable("production_work_order_status_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), fromStatus: text("from_status"), toStatus: text("to_status").notNull(), eventType: text("event_type").notNull(), reason: text("reason").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("production_work_order_status_events_wo_idx").on(t.workOrderId, t.id), check("production_work_order_status_events_to_ck", sql`${t.toStatus} in ('DRAFT','RELEASED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED')`)]);

export const productionBomSnapshots = pgTable("production_bom_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), bomHeaderId: bigint("bom_header_id", { mode: "number" }).notNull().references(() => bomHeaders.id, { onDelete: "restrict" }), bomVersionId: bigint("bom_version_id", { mode: "number" }).notNull().references(() => bomVersions.id, { onDelete: "restrict" }), productVersionId: bigint("product_version_id", { mode: "number" }).notNull().references(() => productVersions.id, { onDelete: "restrict" }), releasedBy: text("released_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_bom_snapshots_wo_uq").on(t.workOrderId), index("production_bom_snapshots_source_idx").on(t.bomVersionId, t.id)]);

export const productionBomSnapshotLines = pgTable("production_bom_snapshot_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), snapshotId: bigint("snapshot_id", { mode: "number" }).notNull().references(() => productionBomSnapshots.id, { onDelete: "restrict" }), sourceBomLineId: bigint("source_bom_line_id", { mode: "number" }).notNull().references(() => bomLines.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), quantityPer: numeric("quantity_per", { precision: 24, scale: 6 }).notNull(), lossRate: numeric("loss_rate", { precision: 12, scale: 8 }).notNull(), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), processStage: text("process_stage").notNull().default(""), remark: text("remark").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_bom_snapshot_lines_line_uq").on(t.snapshotId, t.lineNo), uniqueIndex("production_bom_snapshot_lines_source_uq").on(t.snapshotId, t.sourceBomLineId), index("production_bom_snapshot_lines_material_idx").on(t.materialId, t.snapshotId), check("production_bom_snapshot_lines_quantity_ck", sql`${t.lineNo}>0 and ${t.quantityPer}>0 and ${t.lossRate}>=0 and ${t.lossRate}<1`)]);

export const productionMaterialRequirements = pgTable("production_material_requirements", {
  id: bigserial("id", { mode: "number" }).primaryKey(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), snapshotLineId: bigint("snapshot_line_id", { mode: "number" }).notNull().references(() => productionBomSnapshotLines.id, { onDelete: "restrict" }), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), requiredQty: numeric("required_qty", { precision: 24, scale: 6 }).notNull(), netIssuedQty: numeric("net_issued_qty", { precision: 24, scale: 6 }).notNull().default("0"), version: integer("version").notNull().default(1), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_material_requirements_snapshot_line_uq").on(t.snapshotLineId), index("production_material_requirements_wo_idx").on(t.workOrderId, t.id), index("production_material_requirements_wo_material_idx").on(t.workOrderId, t.materialId, t.id), check("production_material_requirements_quantity_ck", sql`${t.requiredQty}>0 and ${t.netIssuedQty}>=0 and ${t.netIssuedQty}<=${t.requiredQty}`), check("production_material_requirements_version_ck", sql`${t.version}>0`)]);

export const productionMaterialIssues = pgTable("production_material_issues", {
  id: bigserial("id", { mode: "number" }).primaryKey(), issueCode: text("issue_code").notNull(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }), status: text("status").notNull().default("POSTED"), reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_material_issues_code_uq").on(t.issueCode), uniqueIndex("production_material_issues_operation_uq").on(t.operationId), uniqueIndex("production_material_issues_inventory_uq").on(t.inventoryAdjustmentId), index("production_material_issues_wo_idx").on(t.workOrderId, t.createdAt, t.id), check("production_material_issues_status_ck", sql`${t.status}='POSTED'`)]);

export const productionMaterialIssueLines = pgTable("production_material_issue_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), issueId: bigint("issue_id", { mode: "number" }).notNull().references(() => productionMaterialIssues.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), requirementId: bigint("requirement_id", { mode: "number" }).notNull().references(() => productionMaterialRequirements.id, { onDelete: "restrict" }), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_material_issue_lines_line_uq").on(t.issueId, t.lineNo), uniqueIndex("production_material_issue_lines_requirement_uq").on(t.issueId, t.requirementId), uniqueIndex("production_material_issue_lines_ledger_uq").on(t.inventoryLedgerEntryId), index("production_material_issue_lines_requirement_idx").on(t.requirementId, t.id), check("production_material_issue_lines_quantity_ck", sql`${t.lineNo}>0 and ${t.quantity}>0`)]);

export const productionMaterialReturns = pgTable("production_material_returns", {
  id: bigserial("id", { mode: "number" }).primaryKey(), returnCode: text("return_code").notNull(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }), status: text("status").notNull().default("POSTED"), reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_material_returns_code_uq").on(t.returnCode), uniqueIndex("production_material_returns_operation_uq").on(t.operationId), uniqueIndex("production_material_returns_inventory_uq").on(t.inventoryAdjustmentId), index("production_material_returns_wo_idx").on(t.workOrderId, t.createdAt, t.id), check("production_material_returns_status_ck", sql`${t.status}='POSTED'`)]);

export const productionMaterialReturnLines = pgTable("production_material_return_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), returnId: bigint("return_id", { mode: "number" }).notNull().references(() => productionMaterialReturns.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), requirementId: bigint("requirement_id", { mode: "number" }).notNull().references(() => productionMaterialRequirements.id, { onDelete: "restrict" }), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_material_return_lines_line_uq").on(t.returnId, t.lineNo), uniqueIndex("production_material_return_lines_requirement_uq").on(t.returnId, t.requirementId), uniqueIndex("production_material_return_lines_ledger_uq").on(t.inventoryLedgerEntryId), index("production_material_return_lines_requirement_idx").on(t.requirementId, t.id), check("production_material_return_lines_quantity_ck", sql`${t.lineNo}>0 and ${t.quantity}>0`)]);

export const productionReports = pgTable("production_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(), reportCode: text("report_code").notNull(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), reportedQty: numeric("reported_qty", { precision: 24, scale: 6 }).notNull(), goodQty: numeric("good_qty", { precision: 24, scale: 6 }).notNull(), scrapQty: numeric("scrap_qty", { precision: 24, scale: 6 }).notNull(), processStage: text("process_stage").notNull(), operatorName: text("operator_name").notNull(), remark: text("remark").notNull().default(""), reportedAt: timestamptz("reported_at").notNull().defaultNow(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_reports_code_uq").on(t.reportCode), uniqueIndex("production_reports_operation_uq").on(t.operationId), index("production_reports_wo_idx").on(t.workOrderId, t.reportedAt, t.id), check("production_reports_quantity_ck", sql`${t.reportedQty}>0 and ${t.goodQty}>=0 and ${t.scrapQty}>=0 and ${t.goodQty}+${t.scrapQty}<=${t.reportedQty}`)]);

export const productionCompletions = pgTable("production_completions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), completionCode: text("completion_code").notNull(), workOrderId: bigint("work_order_id", { mode: "number" }).notNull().references(() => productionWorkOrders.id, { onDelete: "restrict" }), inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }), status: text("status").notNull().default("POSTED"), reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_completions_code_uq").on(t.completionCode), uniqueIndex("production_completions_operation_uq").on(t.operationId), uniqueIndex("production_completions_inventory_uq").on(t.inventoryAdjustmentId), index("production_completions_wo_idx").on(t.workOrderId, t.createdAt, t.id), check("production_completions_status_ck", sql`${t.status}='POSTED'`)]);

export const productionCompletionLines = pgTable("production_completion_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), completionId: bigint("completion_id", { mode: "number" }).notNull().references(() => productionCompletions.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("production_completion_lines_line_uq").on(t.completionId, t.lineNo), uniqueIndex("production_completion_lines_ledger_uq").on(t.inventoryLedgerEntryId), check("production_completion_lines_quantity_ck", sql`${t.lineNo}>0 and ${t.quantity}>0`)]);

export const salesQuotations = pgTable("sales_quotations", {
  id: bigserial("id", { mode: "number" }).primaryKey(), quotationCode: text("quotation_code").notNull(), customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customers.id, { onDelete: "restrict" }), currentVersionNo: integer("current_version_no").notNull().default(1), status: text("status").notNull().default("DRAFT"), version: integer("version").notNull().default(1), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_quotations_code_uq").on(t.quotationCode), uniqueIndex("sales_quotations_operation_uq").on(t.operationId), index("sales_quotations_status_idx").on(t.status, t.updatedAt, t.id), check("sales_quotations_status_ck", sql`${t.status} in ('DRAFT','PUBLISHED','ACCEPTED','REJECTED','EXPIRED','CANCELLED','CONVERTED')`), check("sales_quotations_version_ck", sql`${t.currentVersionNo}>0 and ${t.version}>0`)]);

export const salesQuotationVersions = pgTable("sales_quotation_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), quotationId: bigint("quotation_id", { mode: "number" }).notNull().references(() => salesQuotations.id, { onDelete: "restrict" }), versionNo: integer("version_no").notNull(), status: text("status").notNull().default("DRAFT"), currencyCode: text("currency_code").notNull().default("CNY"), totalAmount: numeric("total_amount", { precision: 48, scale: 6 }).notNull(), validUntil: timestamptz("valid_until"), owner: text("owner").notNull().default(""), remark: text("remark").notNull().default(""), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_quotation_versions_no_uq").on(t.quotationId, t.versionNo), uniqueIndex("sales_quotation_versions_operation_uq").on(t.operationId), uniqueIndex("sales_quotation_versions_open_draft_uq").on(t.quotationId).where(sql`${t.status}='DRAFT'`), index("sales_quotation_versions_quote_idx").on(t.quotationId, t.id), check("sales_quotation_versions_status_ck", sql`${t.status} in ('DRAFT','PUBLISHED','ACCEPTED','SUPERSEDED','REJECTED','EXPIRED','CANCELLED','CONVERTED')`), check("sales_quotation_versions_amount_ck", sql`${t.versionNo}>0 and ${t.totalAmount}>0 and ${t.currencyCode}='CNY'`)]);

export const salesQuotationLines = pgTable("sales_quotation_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), quotationVersionId: bigint("quotation_version_id", { mode: "number" }).notNull().references(() => salesQuotationVersions.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), productId: bigint("product_id", { mode: "number" }).notNull().references(() => products.id, { onDelete: "restrict" }), productVersionId: bigint("product_version_id", { mode: "number" }).notNull().references(() => productVersions.id, { onDelete: "restrict" }), finishedMaterialId: bigint("finished_material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), unitPrice: numeric("unit_price", { precision: 24, scale: 6 }).notNull(), lineAmount: numeric("line_amount", { precision: 48, scale: 6 }).notNull(), remark: text("remark").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_quotation_lines_line_uq").on(t.quotationVersionId, t.lineNo), index("sales_quotation_lines_product_idx").on(t.productId, t.quotationVersionId), check("sales_quotation_lines_amount_ck", sql`${t.lineNo}>0 and ${t.quantity}>0 and ${t.unitPrice}>0 and ${t.lineAmount}>0`)]);

export const salesQuotationStatusEvents = pgTable("sales_quotation_status_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), quotationId: bigint("quotation_id", { mode: "number" }).notNull().references(() => salesQuotations.id, { onDelete: "restrict" }), quotationVersionId: bigint("quotation_version_id", { mode: "number" }).notNull().references(() => salesQuotationVersions.id, { onDelete: "restrict" }), fromStatus: text("from_status"), toStatus: text("to_status").notNull(), eventType: text("event_type").notNull(), reason: text("reason").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("sales_quotation_status_events_quote_idx").on(t.quotationId, t.id), check("sales_quotation_status_events_status_ck", sql`${t.toStatus} in ('DRAFT','PUBLISHED','ACCEPTED','REJECTED','EXPIRED','CANCELLED','CONVERTED')`)]);

export const salesOrders = pgTable("sales_orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(), salesOrderCode: text("sales_order_code").notNull(), customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customers.id, { onDelete: "restrict" }), currentVersionNo: integer("current_version_no").notNull().default(1), status: text("status").notNull().default("OPEN"), orderedQty: numeric("ordered_qty", { precision: 24, scale: 6 }).notNull(), shippedQty: numeric("shipped_qty", { precision: 24, scale: 6 }).notNull().default("0"), version: integer("version").notNull().default(1), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_orders_code_uq").on(t.salesOrderCode), uniqueIndex("sales_orders_operation_uq").on(t.operationId), index("sales_orders_status_idx").on(t.status, t.updatedAt, t.id), check("sales_orders_status_ck", sql`${t.status} in ('OPEN','PARTIALLY_SHIPPED','SHIPPED','CLOSED','CANCELLED')`), check("sales_orders_quantity_ck", sql`${t.orderedQty}>0 and ${t.shippedQty}>=0 and ${t.shippedQty}<=${t.orderedQty} and ${t.version}>0`)]);

export const salesOrderVersions = pgTable("sales_order_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), salesOrderId: bigint("sales_order_id", { mode: "number" }).notNull().references(() => salesOrders.id, { onDelete: "restrict" }), versionNo: integer("version_no").notNull(), currencyCode: text("currency_code").notNull().default("CNY"), totalAmount: numeric("total_amount", { precision: 48, scale: 6 }).notNull(), dueDate: timestamptz("due_date"), owner: text("owner").notNull().default(""), remark: text("remark").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_order_versions_no_uq").on(t.salesOrderId, t.versionNo), index("sales_order_versions_order_idx").on(t.salesOrderId, t.id), check("sales_order_versions_amount_ck", sql`${t.versionNo}>0 and ${t.totalAmount}>0 and ${t.currencyCode}='CNY'`)]);

export const salesOrderLines = pgTable("sales_order_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), salesOrderVersionId: bigint("sales_order_version_id", { mode: "number" }).notNull().references(() => salesOrderVersions.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), productId: bigint("product_id", { mode: "number" }).notNull().references(() => products.id, { onDelete: "restrict" }), productVersionId: bigint("product_version_id", { mode: "number" }).notNull().references(() => productVersions.id, { onDelete: "restrict" }), finishedMaterialId: bigint("finished_material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), orderedQty: numeric("ordered_qty", { precision: 24, scale: 6 }).notNull(), shippedQty: numeric("shipped_qty", { precision: 24, scale: 6 }).notNull().default("0"), unitPrice: numeric("unit_price", { precision: 24, scale: 6 }).notNull(), lineAmount: numeric("line_amount", { precision: 48, scale: 6 }).notNull(), version: integer("version").notNull().default(1), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_order_lines_line_uq").on(t.salesOrderVersionId, t.lineNo), index("sales_order_lines_material_idx").on(t.finishedMaterialId, t.id), check("sales_order_lines_quantity_ck", sql`${t.lineNo}>0 and ${t.orderedQty}>0 and ${t.shippedQty}>=0 and ${t.shippedQty}<=${t.orderedQty} and ${t.unitPrice}>0 and ${t.lineAmount}>0 and ${t.version}>0`)]);

export const salesQuoteOrderLinks = pgTable("sales_quote_order_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(), quotationId: bigint("quotation_id", { mode: "number" }).notNull().references(() => salesQuotations.id, { onDelete: "restrict" }), quotationVersionId: bigint("quotation_version_id", { mode: "number" }).notNull().references(() => salesQuotationVersions.id, { onDelete: "restrict" }), salesOrderId: bigint("sales_order_id", { mode: "number" }).notNull().references(() => salesOrders.id, { onDelete: "restrict" }), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_quote_order_links_quote_uq").on(t.quotationId), uniqueIndex("sales_quote_order_links_version_uq").on(t.quotationVersionId), uniqueIndex("sales_quote_order_links_order_uq").on(t.salesOrderId)]);

export const salesOrderStatusEvents = pgTable("sales_order_status_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), salesOrderId: bigint("sales_order_id", { mode: "number" }).notNull().references(() => salesOrders.id, { onDelete: "restrict" }), fromStatus: text("from_status"), toStatus: text("to_status").notNull(), eventType: text("event_type").notNull(), reason: text("reason").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("sales_order_status_events_order_idx").on(t.salesOrderId, t.id), check("sales_order_status_events_status_ck", sql`${t.toStatus} in ('OPEN','PARTIALLY_SHIPPED','SHIPPED','CLOSED','CANCELLED')`)]);

export const salesShipments = pgTable("sales_shipments", {
  id: bigserial("id", { mode: "number" }).primaryKey(), shipmentCode: text("shipment_code").notNull(), salesOrderId: bigint("sales_order_id", { mode: "number" }).notNull().references(() => salesOrders.id, { onDelete: "restrict" }), shipmentType: text("shipment_type").notNull().default("SHIPMENT"), originalShipmentId: bigint("original_shipment_id", { mode: "number" }), inventoryAdjustmentId: bigint("inventory_adjustment_id", { mode: "number" }).notNull().references(() => inventoryAdjustments.id, { onDelete: "restrict" }), shipDate: timestamptz("ship_date").notNull().defaultNow(), receiver: text("receiver").notNull().default(""), reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_shipments_code_uq").on(t.shipmentCode), uniqueIndex("sales_shipments_operation_uq").on(t.operationId), uniqueIndex("sales_shipments_inventory_uq").on(t.inventoryAdjustmentId), uniqueIndex("sales_shipments_original_uq").on(t.originalShipmentId), index("sales_shipments_order_idx").on(t.salesOrderId, t.createdAt, t.id), foreignKey({ name: "sales_shipments_original_fk", columns: [t.originalShipmentId], foreignColumns: [t.id] }).onDelete("restrict"), check("sales_shipments_type_ck", sql`(${t.shipmentType}='SHIPMENT' and ${t.originalShipmentId} is null) or (${t.shipmentType}='REVERSAL' and ${t.originalShipmentId} is not null)`)]);

export const salesShipmentLines = pgTable("sales_shipment_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), shipmentId: bigint("shipment_id", { mode: "number" }).notNull().references(() => salesShipments.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), salesOrderLineId: bigint("sales_order_line_id", { mode: "number" }).notNull().references(() => salesOrderLines.id, { onDelete: "restrict" }), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), inventoryLedgerEntryId: bigint("inventory_ledger_entry_id", { mode: "number" }).notNull().references(() => inventoryLedgerEntries.id, { onDelete: "restrict" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_shipment_lines_line_uq").on(t.shipmentId, t.lineNo), uniqueIndex("sales_shipment_lines_order_line_uq").on(t.shipmentId, t.salesOrderLineId), uniqueIndex("sales_shipment_lines_ledger_uq").on(t.inventoryLedgerEntryId), index("sales_shipment_lines_order_line_idx").on(t.salesOrderLineId, t.id), check("sales_shipment_lines_quantity_ck", sql`${t.lineNo}>0 and ${t.quantity}>0`)]);

export const salesFinancialSourceEntries = pgTable("sales_financial_source_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(), shipmentId: bigint("shipment_id", { mode: "number" }).notNull().references(() => salesShipments.id, { onDelete: "restrict" }), customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customers.id, { onDelete: "restrict" }), entryType: text("entry_type").notNull(), amount: numeric("amount", { precision: 48, scale: 6 }).notNull(), currencyCode: text("currency_code").notNull().default("CNY"), sourceId: uuid("source_id").notNull(), reversalOfSourceEntryId: bigint("reversal_of_source_entry_id", { mode: "number" }), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sales_financial_source_entries_shipment_uq").on(t.shipmentId), uniqueIndex("sales_financial_source_entries_source_uq").on(t.sourceId), uniqueIndex("sales_financial_source_entries_reversal_uq").on(t.reversalOfSourceEntryId), index("sales_financial_source_entries_customer_idx").on(t.customerId, t.createdAt, t.id), foreignKey({ name: "sales_financial_source_entries_reversal_fk", columns: [t.reversalOfSourceEntryId], foreignColumns: [t.id] }).onDelete("restrict"), check("sales_financial_source_entries_type_ck", sql`${t.entryType} in ('SHIPMENT','SHIPMENT_REVERSAL')`), check("sales_financial_source_entries_amount_ck", sql`(${t.entryType}='SHIPMENT' and ${t.amount}>0 and ${t.reversalOfSourceEntryId} is null) or (${t.entryType}='SHIPMENT_REVERSAL' and ${t.amount}<0 and ${t.reversalOfSourceEntryId} is not null)`), check("sales_financial_source_entries_currency_ck", sql`${t.currencyCode}='CNY'`)]);

export const qualityInspections = pgTable("quality_inspections", {
  id: bigserial("id", { mode: "number" }).primaryKey(), inspectionCode: text("inspection_code").notNull(), inspectionType: text("inspection_type").notNull(),
  purchaseReceiptLineId: bigint("purchase_receipt_line_id", { mode: "number" }).references(() => purchaseReceiptLines.id, { onDelete: "restrict" }),
  productionReportId: bigint("production_report_id", { mode: "number" }).references(() => productionReports.id, { onDelete: "restrict" }),
  productionCompletionLineId: bigint("production_completion_line_id", { mode: "number" }).references(() => productionCompletionLines.id, { onDelete: "restrict" }),
  salesOrderLineId: bigint("sales_order_line_id", { mode: "number" }).references(() => salesOrderLines.id, { onDelete: "restrict" }),
  materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }), unitId: bigint("unit_id", { mode: "number" }).notNull().references(() => units.id, { onDelete: "restrict" }),
  inspectedQty: numeric("inspected_qty", { precision: 24, scale: 6 }).notNull(), passedQty: numeric("passed_qty", { precision: 24, scale: 6 }).notNull(), failedQty: numeric("failed_qty", { precision: 24, scale: 6 }).notNull(),
  lifecycleStatus: text("lifecycle_status").notNull().default("OPEN"), decisionStatus: text("decision_status").notNull().default("PENDING"), releasedQty: numeric("released_qty", { precision: 24, scale: 6 }).notNull().default("0"),
  inspectionDate: timestamptz("inspection_date").notNull().defaultNow(), responsibleStage: text("responsible_stage").notNull().default(""), remark: text("remark").notNull().default(""), version: integer("version").notNull().default(1),
  operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("quality_inspections_code_uq").on(t.inspectionCode), uniqueIndex("quality_inspections_operation_uq").on(t.operationId), index("quality_inspections_status_idx").on(t.inspectionType, t.lifecycleStatus, t.decisionStatus, t.id),
  index("quality_inspections_receipt_idx").on(t.purchaseReceiptLineId, t.id), index("quality_inspections_report_idx").on(t.productionReportId, t.id), index("quality_inspections_completion_idx").on(t.productionCompletionLineId, t.id), index("quality_inspections_order_line_idx").on(t.salesOrderLineId, t.id),
  index("quality_inspections_fqc_order_release_idx").on(t.salesOrderLineId, t.lifecycleStatus, t.decisionStatus, t.id).where(sql`${t.inspectionType}='FQC'`),
  index("quality_inspections_fqc_completion_release_idx").on(t.productionCompletionLineId, t.lifecycleStatus, t.decisionStatus, t.id).where(sql`${t.inspectionType}='FQC'`),
  check("quality_inspections_type_source_ck", sql`(${t.inspectionType}='IQC' and ${t.purchaseReceiptLineId} is not null and ${t.productionReportId} is null and ${t.productionCompletionLineId} is null and ${t.salesOrderLineId} is null) or (${t.inspectionType}='IPQC' and ${t.purchaseReceiptLineId} is null and ${t.productionReportId} is not null and ${t.productionCompletionLineId} is null and ${t.salesOrderLineId} is null) or (${t.inspectionType}='FQC' and ${t.purchaseReceiptLineId} is null and ${t.productionReportId} is null and ${t.productionCompletionLineId} is not null and ${t.salesOrderLineId} is not null)`),
  check("quality_inspections_quantity_ck", sql`${t.inspectedQty}>0 and ${t.passedQty}>=0 and ${t.failedQty}>=0 and ${t.passedQty}+${t.failedQty}=${t.inspectedQty} and ${t.releasedQty}>=0 and ${t.releasedQty}<=${t.inspectedQty}`),
  check("quality_inspections_state_ck", sql`${t.lifecycleStatus} in ('OPEN','CLOSED') and ${t.decisionStatus} in ('PENDING','HOLD','RELEASED') and ((${t.decisionStatus} in ('PENDING','HOLD') and ${t.releasedQty}=0) or (${t.decisionStatus}='RELEASED' and ${t.releasedQty}>0)) and (${t.lifecycleStatus}='OPEN' or ${t.decisionStatus}<>'PENDING') and ${t.version}>0`),
]);

export const qualityInspectionResults = pgTable("quality_inspection_results", {
  id: bigserial("id", { mode: "number" }).primaryKey(), inspectionId: bigint("inspection_id", { mode: "number" }).notNull().references(() => qualityInspections.id, { onDelete: "restrict" }), lineNo: integer("line_no").notNull(), characteristic: text("characteristic").notNull(), result: text("result").notNull(), measuredValue: text("measured_value").notNull().default(""), specification: text("specification").notNull().default(""), remark: text("remark").notNull().default(""), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("quality_inspection_results_line_uq").on(t.inspectionId, t.lineNo), uniqueIndex("quality_inspection_results_parent_id_uq").on(t.inspectionId, t.id), index("quality_inspection_results_inspection_idx").on(t.inspectionId, t.id), check("quality_inspection_results_values_ck", sql`${t.lineNo}>0 and ${t.result} in ('PASS','FAIL') and char_length(btrim(${t.characteristic})) between 1 and 200`)]);

export const qualityDefects = pgTable("quality_defects", {
  id: bigserial("id", { mode: "number" }).primaryKey(), defectCode: text("defect_code").notNull(), inspectionId: bigint("inspection_id", { mode: "number" }).notNull().references(() => qualityInspections.id, { onDelete: "restrict" }), resultLineId: bigint("result_line_id", { mode: "number" }), defectType: text("defect_type").notNull(), severity: text("severity").notNull(), quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(), description: text("description").notNull().default(""), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("quality_defects_code_uq").on(t.defectCode), uniqueIndex("quality_defects_operation_uq").on(t.operationId), index("quality_defects_inspection_idx").on(t.inspectionId, t.id), index("quality_defects_result_idx").on(t.resultLineId, t.id), foreignKey({ name: "quality_defects_result_parent_fk", columns: [t.inspectionId, t.resultLineId], foreignColumns: [qualityInspectionResults.inspectionId, qualityInspectionResults.id] }).onDelete("restrict"), check("quality_defects_values_ck", sql`${t.quantity}>0 and ${t.severity} in ('MINOR','MAJOR','CRITICAL') and char_length(btrim(${t.defectType})) between 1 and 200`)]);

export const qualityInspectionEvents = pgTable("quality_inspection_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), inspectionId: bigint("inspection_id", { mode: "number" }).notNull().references(() => qualityInspections.id, { onDelete: "restrict" }), eventType: text("event_type").notNull(), fromLifecycleStatus: text("from_lifecycle_status"), toLifecycleStatus: text("to_lifecycle_status").notNull(), fromDecisionStatus: text("from_decision_status"), toDecisionStatus: text("to_decision_status").notNull(), dispositionCode: text("disposition_code"), releaseQty: numeric("release_qty", { precision: 24, scale: 6 }).notNull().default("0"), reason: text("reason").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("quality_inspection_events_inspection_idx").on(t.inspectionId, t.id), index("quality_inspection_events_type_idx").on(t.inspectionId, t.eventType, t.id), check("quality_inspection_events_values_ck", sql`
  (${t.eventType}='CREATED' and ${t.fromLifecycleStatus} is null and ${t.toLifecycleStatus}='OPEN' and ${t.fromDecisionStatus} is null and ${t.toDecisionStatus}='PENDING' and ${t.dispositionCode} is null and ${t.releaseQty}=0)
  or (${t.eventType}='DEFECT_ADDED' and ${t.fromLifecycleStatus}='OPEN' and ${t.toLifecycleStatus}='OPEN' and ${t.fromDecisionStatus}=${t.toDecisionStatus} and ${t.dispositionCode} is null and ${t.releaseQty}=0)
  or (${t.eventType}='DISPOSITIONED' and ${t.fromLifecycleStatus}='OPEN' and ${t.toLifecycleStatus}='OPEN' and ${t.fromDecisionStatus} is not null and ${t.dispositionCode} in ('RELEASE','CONCESSION','REWORK','RETURN_TO_SUPPLIER','SCRAP') and ((${t.toDecisionStatus}='RELEASED' and ${t.releaseQty}>0) or (${t.toDecisionStatus}='HOLD' and ${t.releaseQty}=0)))
  or (${t.eventType}='CLOSED' and ${t.fromLifecycleStatus}='OPEN' and ${t.toLifecycleStatus}='CLOSED' and ${t.fromDecisionStatus}=${t.toDecisionStatus} and ${t.toDecisionStatus} in ('HOLD','RELEASED') and ${t.dispositionCode} is null and ${t.releaseQty}>=0)
  or (${t.eventType}='REOPENED' and ${t.fromLifecycleStatus}='CLOSED' and ${t.toLifecycleStatus}='OPEN' and ${t.fromDecisionStatus} in ('HOLD','RELEASED') and ${t.toDecisionStatus}='PENDING' and ${t.dispositionCode} is null and ${t.releaseQty}=0)
`)]);

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
  id: bigserial("id", { mode: "number" }).primaryKey(), materialId: bigint("material_id", { mode: "number" }).notNull().references(() => materialMaster.id, { onDelete: "restrict" }),
  supplierId: bigint("supplier_id", { mode: "number" }).references(() => suppliers.id, { onDelete: "restrict" }), supplierName: text("supplier_name").notNull(), supplierKey: text("supplier_key").notNull(),
  supplierItemCode: text("supplier_item_code").notNull(), supplierItemName: text("supplier_item_name").notNull().default(""), supplierSpecification: text("supplier_specification").notNull().default(""),
  manufacturer: text("manufacturer").notNull().default(""), mpn: text("mpn").notNull().default(""), revision: text("revision").notNull().default(""), purchaseUom: text("purchase_uom").notNull(),
  purchaseUnitId: bigint("purchase_unit_id", { mode: "number" }).references(() => units.id, { onDelete: "restrict" }), conversionNumerator: bigint("conversion_numerator", { mode: "number" }).notNull().default(1),
  conversionDenominator: bigint("conversion_denominator", { mode: "number" }).notNull().default(1), status: text("status").notNull(), validFrom: timestamptz("valid_from").notNull(), validTo: timestamptz("valid_to"),
  version: integer("version").notNull().default(1), ...auditColumns,
}, (t) => [
  uniqueIndex("supplier_mappings_identity_period_uq").on(t.supplierKey, t.supplierItemCode, t.manufacturer, t.mpn, t.revision, t.validFrom),
  index("supplier_mappings_material_idx").on(t.materialId), index("supplier_mappings_supplier_status_idx").on(t.supplierId, t.status, t.validFrom),
  check("supplier_mappings_status_ck", sql`${t.status} in ('ACTIVE','INACTIVE')`), check("supplier_mappings_version_ck", sql`${t.version} > 0`),
  check("supplier_mappings_conversion_ck", sql`${t.conversionNumerator} > 0 and ${t.conversionDenominator} > 0`), check("supplier_mappings_period_ck", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
]);

export const supplierMappingPriceHistory = pgTable("supplier_mapping_price_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(), supplierMappingId: bigint("supplier_mapping_id", { mode: "number" }).notNull().references(() => supplierMappings.id, { onDelete: "restrict" }), price: numeric("price", { precision: 24, scale: 6 }).notNull(), currencyCode: text("currency_code").notNull(), priceUom: text("price_uom").notNull(), minimumOrderQty: numeric("minimum_order_qty", { precision: 24, scale: 6 }), effectiveFrom: timestamptz("effective_from").notNull(), effectiveTo: timestamptz("effective_to"), sourceDocumentRef: text("source_document_ref").notNull().default(""), createdBy: text("created_by").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), requestId: uuid("request_id").notNull(),
}, (t) => [index("supplier_mapping_price_history_from_idx").on(t.supplierMappingId, t.effectiveFrom), check("supplier_mapping_price_positive_ck", sql`${t.price} > 0`), check("supplier_mapping_price_moq_ck", sql`${t.minimumOrderQty} is null or ${t.minimumOrderQty} >= 0`), check("supplier_mapping_price_period_ck", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`)]);

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

export const financeDocuments = pgTable("finance_documents", {
  id: bigserial("id", { mode: "number" }).primaryKey(), docCode: text("doc_code").notNull(), docType: text("doc_type").notNull(),
  salesSourceEntryId: bigint("sales_source_entry_id", { mode: "number" }).references(() => salesFinancialSourceEntries.id, { onDelete: "restrict" }),
  purchaseSourceEntryId: bigint("purchase_source_entry_id", { mode: "number" }).references(() => purchaseFinancialSourceEntries.id, { onDelete: "restrict" }),
  financeOpeningSourceId: bigint("finance_opening_source_id", { mode: "number" }).references((): AnyPgColumn => financeOpeningSources.id, { onDelete: "restrict" }),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id, { onDelete: "restrict" }), supplierId: bigint("supplier_id", { mode: "number" }).references(() => suppliers.id, { onDelete: "restrict" }),
  currencyCode: text("currency_code").notNull(), totalAmount: numeric("total_amount", { precision: 24, scale: 6 }).notNull(), settledAmount: numeric("settled_amount", { precision: 24, scale: 6 }).notNull().default("0"),
  status: text("status").notNull().default("OPEN"), accountingDate: date("accounting_date", { mode: "string" }).notNull(), dueDate: date("due_date", { mode: "string" }), version: integer("version").notNull().default(1),
  operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(), updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("finance_documents_code_uq").on(t.docCode), uniqueIndex("finance_documents_sales_source_uq").on(t.salesSourceEntryId), uniqueIndex("finance_documents_purchase_source_uq").on(t.purchaseSourceEntryId), uniqueIndex("finance_documents_opening_source_uq").on(t.financeOpeningSourceId).where(sql`${t.financeOpeningSourceId} is not null`), index("finance_documents_status_idx").on(t.docType, t.status, t.dueDate, t.id), index("finance_documents_customer_idx").on(t.customerId, t.id), index("finance_documents_supplier_idx").on(t.supplierId, t.id), check("finance_documents_type_ck", sql`${t.docType} in ('AR','AP','OPENING_AR','OPENING_AP')`), check("finance_documents_source_ck", sql`(${t.docType}='AR' and ${t.salesSourceEntryId} is not null and ${t.purchaseSourceEntryId} is null and ${t.financeOpeningSourceId} is null and ${t.customerId} is not null and ${t.supplierId} is null) or (${t.docType}='AP' and ${t.purchaseSourceEntryId} is not null and ${t.salesSourceEntryId} is null and ${t.financeOpeningSourceId} is null and ${t.supplierId} is not null and ${t.customerId} is null) or (${t.docType}='OPENING_AR' and ${t.financeOpeningSourceId} is not null and ${t.salesSourceEntryId} is null and ${t.purchaseSourceEntryId} is null and ${t.customerId} is not null and ${t.supplierId} is null) or (${t.docType}='OPENING_AP' and ${t.financeOpeningSourceId} is not null and ${t.salesSourceEntryId} is null and ${t.purchaseSourceEntryId} is null and ${t.supplierId} is not null and ${t.customerId} is null)`), check("finance_documents_amount_ck", sql`${t.totalAmount}>0 and ${t.settledAmount}>=0 and ${t.settledAmount}<=${t.totalAmount}`), check("finance_documents_status_ck", sql`${t.status} in ('OPEN','PARTIALLY_SETTLED','SETTLED','REVERSED')`), check("finance_documents_projection_ck", sql`(${t.status}='OPEN' and ${t.settledAmount}=0) or (${t.status}='PARTIALLY_SETTLED' and ${t.settledAmount}>0 and ${t.settledAmount}<${t.totalAmount}) or (${t.status}='SETTLED' and ${t.settledAmount}=${t.totalAmount}) or (${t.status}='REVERSED' and ${t.settledAmount}=0 and ${t.docType} in ('OPENING_AR','OPENING_AP'))`), check("finance_documents_currency_ck", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`), check("finance_documents_version_ck", sql`${t.version}>0`)]);

export const financeSettlements = pgTable("finance_settlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(), settlementCode: text("settlement_code").notNull(), documentId: bigint("document_id", { mode: "number" }).notNull().references(() => financeDocuments.id, { onDelete: "restrict" }), settlementType: text("settlement_type").notNull(), amount: numeric("amount", { precision: 24, scale: 6 }).notNull(), originalSettlementId: bigint("original_settlement_id", { mode: "number" }), accountingDate: date("accounting_date", { mode: "string" }).notNull(), accountName: text("account_name").notNull(), reason: text("reason").notNull().default(""), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("finance_settlements_code_uq").on(t.settlementCode), uniqueIndex("finance_settlements_reversal_uq").on(t.originalSettlementId), index("finance_settlements_document_idx").on(t.documentId, t.createdAt, t.id), foreignKey({ name: "finance_settlements_original_fk", columns: [t.originalSettlementId], foreignColumns: [t.id] }).onDelete("restrict"), check("finance_settlements_type_ck", sql`${t.settlementType} in ('RECEIPT','PAYMENT','RECEIPT_REVERSAL','PAYMENT_REVERSAL')`), check("finance_settlements_amount_ck", sql`(${t.settlementType} in ('RECEIPT','PAYMENT') and ${t.amount}>0 and ${t.originalSettlementId} is null) or (${t.settlementType} in ('RECEIPT_REVERSAL','PAYMENT_REVERSAL') and ${t.amount}<0 and ${t.originalSettlementId} is not null)`)]);

export const financeDocumentEvents = pgTable("finance_document_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), documentId: bigint("document_id", { mode: "number" }).notNull().references(() => financeDocuments.id, { onDelete: "restrict" }), eventType: text("event_type").notNull(), fromStatus: text("from_status"), toStatus: text("to_status").notNull(), amount: numeric("amount", { precision: 24, scale: 6 }), settlementId: bigint("settlement_id", { mode: "number" }).references(() => financeSettlements.id, { onDelete: "restrict" }), reason: text("reason").notNull().default(""), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [index("finance_document_events_document_idx").on(t.documentId, t.id), check("finance_document_events_type_ck", sql`${t.eventType} in ('CREATED','SETTLED','SETTLEMENT_REVERSED','OPENING_REVERSED')`), check("finance_document_events_status_ck", sql`${t.fromStatus} is null or ${t.fromStatus} in ('OPEN','PARTIALLY_SETTLED','SETTLED','REVERSED')`), check("finance_document_events_to_status_ck", sql`${t.toStatus} in ('OPEN','PARTIALLY_SETTLED','SETTLED','REVERSED')`)]);

export const financeOpeningSources = pgTable("finance_opening_sources", {
  id: bigserial("id", { mode: "number" }).primaryKey(), migrationOpeningSourceId: uuid("migration_opening_source_id").notNull().references(() => migrationOpeningSources.id, { onDelete: "restrict" }),
  direction: text("direction").notNull(), customerId: bigint("customer_id", { mode: "number" }).references(() => customers.id, { onDelete: "restrict" }), supplierId: bigint("supplier_id", { mode: "number" }).references(() => suppliers.id, { onDelete: "restrict" }),
  currencyCode: text("currency_code").notNull(), openingOutstandingAmount: numeric("opening_outstanding_amount", { precision: 24, scale: 6 }).notNull(), accountingDate: date("accounting_date", { mode: "string" }).notNull(), businessReferenceDigest: text("business_reference_digest").notNull(),
  financeDocumentId: bigint("finance_document_id", { mode: "number" }).notNull().references(() => financeDocuments.id, { onDelete: "restrict" }), status: text("status").notNull().default("POSTED"), operationId: uuid("operation_id").notNull(),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("finance_opening_sources_migration_source_uq").on(t.migrationOpeningSourceId), uniqueIndex("finance_opening_sources_document_uq").on(t.financeDocumentId), uniqueIndex("finance_opening_sources_operation_uq").on(t.operationId), check("finance_opening_sources_direction_ck", sql`(${t.direction}='AR' and ${t.customerId} is not null and ${t.supplierId} is null) or (${t.direction}='AP' and ${t.supplierId} is not null and ${t.customerId} is null)`), check("finance_opening_sources_currency_ck", sql`${t.currencyCode}='CNY'`), check("finance_opening_sources_amount_ck", sql`${t.openingOutstandingAmount}>0`), check("finance_opening_sources_reference_ck", sql`${t.businessReferenceDigest} ~ '^[0-9a-f]{64}$'`), check("finance_opening_sources_status_ck", sql`${t.status}='POSTED'`)]);

export const financeOpeningReversals = pgTable("finance_opening_reversals", {
  id: bigserial("id", { mode: "number" }).primaryKey(), financeOpeningSourceId: bigint("finance_opening_source_id", { mode: "number" }).notNull().references(() => financeOpeningSources.id, { onDelete: "restrict" }), financeDocumentId: bigint("finance_document_id", { mode: "number" }).notNull().references(() => financeDocuments.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(), operationId: uuid("operation_id").notNull(), createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), requestId: uuid("request_id").notNull(), createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("finance_opening_reversals_source_uq").on(t.financeOpeningSourceId), uniqueIndex("finance_opening_reversals_operation_uq").on(t.operationId), check("finance_opening_reversals_reason_ck", sql`char_length(btrim(${t.reason})) between 1 and 1000`)]);
