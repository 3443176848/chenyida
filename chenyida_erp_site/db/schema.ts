import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
    routeCode: text("route_code").notNull().default(""),
    materialId: integer("material_id"),
    operationId: text("operation_id").notNull().default(""),
    idempotencyKeyDigest: text("idempotency_key_digest").notNull().default(""),
    oldVersion: integer("old_version"),
    newVersion: integer("new_version"),
    errorCode: text("error_code").notNull().default(""),
    retentionUntil: integer("retention_until").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_request_id_idx").on(table.requestId),
    index("audit_log_operation_id_idx").on(table.operationId),
    index("audit_log_material_created_idx").on(table.materialId, table.createdAt),
    index("audit_log_retention_idx").on(table.retentionUntil, table.id),
    check("audit_log_operation_id_ck", sql`${table.operationId} = '' OR length(${table.operationId}) = 36`),
    check("audit_log_key_digest_ck", sql`${table.idempotencyKeyDigest} = '' OR length(${table.idempotencyKeyDigest}) = 64`),
    check("audit_log_versions_ck", sql`(${table.oldVersion} IS NULL OR ${table.oldVersion} >= 0) AND (${table.newVersion} IS NULL OR ${table.newVersion} > 0)`),
    check("audit_log_retention_ck", sql`${table.retentionUntil} >= 0`),
  ],
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
    lastModifiedBy: text("last_modified_by").notNull(),
    submittedBy: text("submitted_by").notNull().default(""),
    submittedAt: text("submitted_at"),
    approvedBy: text("approved_by").notNull().default(""),
    approvedAt: text("approved_at"),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("material_master_internal_code_uq").on(table.internalMaterialCode).where(sql`${table.internalMaterialCode} IS NOT NULL`),
    index("material_master_candidate_idx").on(table.categoryId, table.manufacturer, table.manufacturerPartNumber),
    index("material_master_status_updated_idx").on(table.materialStatus, table.updatedAt),
    index("material_master_category_status_idx").on(table.categoryId, table.materialStatus),
    index("material_master_review_queue_idx").on(table.materialStatus, table.submittedAt, table.id),
    index("material_master_review_category_idx").on(table.materialStatus, table.categoryId, table.submittedAt, table.id),
    index("material_master_review_source_idx").on(table.materialStatus, table.sourceType, table.submittedAt, table.id),
    index("material_master_review_creator_idx").on(table.materialStatus, table.createdBy, table.submittedAt, table.id),
    index("material_master_standard_name_idx").on(table.standardName),
    check("material_master_status_ck", sql`${table.materialStatus} IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_REVIEW', 'ACTIVE', 'FROZEN', 'INACTIVE')`),
    check("material_master_code_after_approval_ck", sql`(${table.materialStatus} IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_REVIEW') AND ${table.internalMaterialCode} IS NULL) OR (${table.materialStatus} IN ('ACTIVE', 'FROZEN', 'INACTIVE') AND ${table.internalMaterialCode} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${table.approvedBy} <> '')`),
    check("material_master_last_modified_by_ck", sql`length(trim(${table.lastModifiedBy})) > 0`),
    check("material_master_submission_ck", sql`((${table.submittedBy} = '' AND ${table.submittedAt} IS NULL) OR (length(trim(${table.submittedBy})) > 0 AND ${table.submittedAt} IS NOT NULL)) AND (${table.materialStatus} NOT IN ('PENDING_APPROVAL', 'PENDING_REVIEW') OR (length(trim(${table.submittedBy})) > 0 AND ${table.submittedAt} IS NOT NULL))`),
    check("material_master_procurement_type_ck", sql`${table.procurementType} IN ('PURCHASE', 'OUTSOURCE', 'SELF_MADE', 'NON_PURCHASABLE')`),
    check("material_master_inventory_type_ck", sql`${table.inventoryType} IN ('STOCKED', 'NON_STOCKED', 'CONSIGNMENT')`),
    check("material_master_lot_control_ck", sql`${table.lotControlRequired} IN (0, 1)`),
    check("material_master_shelf_life_ck", sql`${table.shelfLifeDays} IS NULL OR ${table.shelfLifeDays} >= 0`),
    check("material_master_inspection_type_ck", sql`${table.inspectionType} IN ('NONE', 'NORMAL', 'TIGHTENED', 'REDUCED', 'FULL')`),
    check("material_master_environmental_ck", sql`${table.environmentalRequirement} IN ('UNSPECIFIED', 'ROHS', 'ROHS_REACH', 'HALOGEN_FREE', 'CUSTOMER_SPECIFIC')`),
  ],
);

export const materialApiIdempotency = sqliteTable(
  "material_api_idempotency",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
    method: text("method").notNull(),
    routeScope: text("route_scope").notNull(),
    keyDigest: text("key_digest").notNull(),
    requestDigest: text("request_digest").notNull(),
    operationId: text("operation_id").notNull(),
    state: text("state").notNull(),
    leaseTokenDigest: text("lease_token_digest").notNull(),
    leaseExpiresAt: integer("lease_expires_at"),
    statusCode: integer("status_code"),
    responseJson: text("response_json"),
    materialId: integer("material_id").references(() => materialMaster.id, { onDelete: "restrict" }),
    oldVersion: integer("old_version"),
    newVersion: integer("new_version"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [
    uniqueIndex("material_api_idempotency_scope_uq").on(table.username, table.method, table.routeScope, table.keyDigest),
    uniqueIndex("material_api_idempotency_operation_uq").on(table.operationId),
    index("material_api_idempotency_expiry_idx").on(table.state, table.expiresAt),
    index("material_api_idempotency_lease_idx").on(table.state, table.leaseExpiresAt),
    check("material_api_idempotency_method_ck", sql`${table.method} IN ('POST', 'PATCH')`),
    check("material_api_idempotency_route_ck", sql`length(${table.routeScope}) BETWEEN 1 AND 255`),
    check("material_api_idempotency_digest_ck", sql`length(${table.keyDigest}) = 64 AND length(${table.requestDigest}) = 64 AND length(${table.leaseTokenDigest}) = 64`),
    check("material_api_idempotency_operation_ck", sql`length(${table.operationId}) = 36`),
    check("material_api_idempotency_state_ck", sql`${table.state} IN ('PENDING', 'COMPLETED')`),
    check("material_api_idempotency_result_ck", sql`(${table.state} = 'PENDING' AND ${table.leaseExpiresAt} > 0 AND ${table.statusCode} IS NULL AND ${table.responseJson} IS NULL AND ${table.expiresAt} IS NULL) OR (${table.state} = 'COMPLETED' AND ${table.leaseExpiresAt} IS NULL AND ${table.statusCode} BETWEEN 100 AND 599 AND json_valid(${table.responseJson}) AND ${table.expiresAt} > 0)`),
    check("material_api_idempotency_versions_ck", sql`(${table.oldVersion} IS NULL OR ${table.oldVersion} >= 0) AND (${table.newVersion} IS NULL OR ${table.newVersion} > 0)`),
  ],
);

export const materialApiRateLimitBuckets = sqliteTable(
  "material_api_rate_limit_buckets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
    bucketStart: integer("bucket_start").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    newKeyCount: integer("new_key_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    lastAttemptTokenDigest: text("last_attempt_token_digest").notNull().default(""),
    lastNewKeyTokenDigest: text("last_new_key_token_digest").notNull().default(""),
    firstRejectedAt: text("first_rejected_at"),
    lastRejectedAt: text("last_rejected_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("material_api_rate_limit_user_bucket_uq").on(table.username, table.bucketStart),
    index("material_api_rate_limit_cleanup_idx").on(table.bucketStart, table.id),
    check("material_api_rate_limit_bucket_ck", sql`${table.bucketStart} >= 0`),
    check("material_api_rate_limit_counts_ck", sql`${table.attemptCount} BETWEEN 0 AND 60 AND ${table.newKeyCount} BETWEEN 0 AND 20 AND ${table.rejectedCount} >= 0`),
    check("material_api_rate_limit_digest_ck", sql`(${table.lastAttemptTokenDigest} = '' OR length(${table.lastAttemptTokenDigest}) = 64) AND (${table.lastNewKeyTokenDigest} = '' OR length(${table.lastNewKeyTokenDigest}) = 64)`),
  ],
);

export const materialImportBatches = sqliteTable(
  "material_import_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchNo: text("batch_no").notNull(),
    sourceKind: text("source_kind").notNull(),
    status: text("status").notNull(),
    retryOfBatchId: integer("retry_of_batch_id").references(
      (): ReturnType<typeof integer> => materialImportBatches.id,
      { onDelete: "restrict" },
    ),
    createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
    currentVersion: integer("current_version").notNull().default(1),
    currentParseRunId: integer("current_parse_run_id"),
    currentNormalizationRunId: integer("current_normalization_run_id"),
    fileCount: integer("file_count").notNull().default(0),
    totalRows: integer("total_rows").notNull().default(0),
    acceptedRows: integer("accepted_rows").notNull().default(0),
    rejectedRows: integer("rejected_rows").notNull().default(0),
    failureStage: text("failure_stage"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    cancelledBy: text("cancelled_by").references(() => appUsers.username, { onDelete: "restrict" }),
    cancelledAt: text("cancelled_at"),
    terminalAt: text("terminal_at"),
    rawDataRetentionUntil: text("raw_data_retention_until"),
    recordRetentionUntil: text("record_retention_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("material_import_batches_no_uq").on(table.batchNo),
    index("material_import_batches_owner_created_idx").on(table.createdBy, table.createdAt, table.id),
    index("material_import_batches_status_created_idx").on(table.status, table.createdAt, table.id),
    index("material_import_batches_retry_idx").on(table.retryOfBatchId),
    index("material_import_batches_raw_retention_idx").on(table.rawDataRetentionUntil, table.id),
    index("material_import_batches_current_run_idx").on(table.currentParseRunId),
    index("material_import_batches_current_normalization_idx").on(table.currentNormalizationRunId),
    check("material_import_batches_source_ck", sql`${table.sourceKind} IN ('XLSX','CSV')`),
    check("material_import_batches_status_ck", sql`${table.status} IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')`),
    check("material_import_batches_version_ck", sql`${table.currentVersion} > 0`),
    check("material_import_batches_counts_ck", sql`${table.fileCount} BETWEEN 0 AND 1 AND ${table.totalRows} >= 0 AND ${table.acceptedRows} >= 0 AND ${table.rejectedRows} >= 0 AND ${table.acceptedRows} + ${table.rejectedRows} <= ${table.totalRows}`),
    check("material_import_batches_retry_ck", sql`${table.retryOfBatchId} IS NULL OR ${table.retryOfBatchId} <> ${table.id}`),
    check("material_import_batches_failure_ck", sql`(${table.status} = 'FAILED' AND length(trim(${table.failureStage})) > 0 AND length(trim(${table.failureCode})) > 0) OR (${table.status} <> 'FAILED' AND ${table.failureStage} IS NULL AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL)`),
    check("material_import_batches_cancel_ck", sql`(${table.status} = 'CANCELLED' AND ${table.cancelledBy} IS NOT NULL AND ${table.cancelledAt} IS NOT NULL) OR (${table.status} <> 'CANCELLED' AND ${table.cancelledBy} IS NULL AND ${table.cancelledAt} IS NULL)`),
    check("material_import_batches_terminal_ck", sql`(${table.status} IN ('FAILED','CANCELLED') AND ${table.terminalAt} IS NOT NULL AND ${table.rawDataRetentionUntil} IS NOT NULL AND ${table.recordRetentionUntil} IS NOT NULL) OR (${table.status} NOT IN ('FAILED','CANCELLED') AND ${table.terminalAt} IS NULL AND ${table.rawDataRetentionUntil} IS NULL AND ${table.recordRetentionUntil} IS NULL)`),
    check("material_import_batches_current_run_ck", sql`(${table.status} IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED') AND ${table.currentParseRunId} IS NOT NULL) OR (${table.status} NOT IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED'))`),
    check("material_import_batches_current_normalization_ck", sql`(${table.status} = 'NORMALIZED' AND ${table.currentNormalizationRunId} IS NOT NULL) OR (${table.status} <> 'NORMALIZED')`),
  ],
);

export const materialImportFiles = sqliteTable(
  "material_import_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id").notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    filenameExtension: text("filename_extension"),
    declaredMimeType: text("declared_mime_type"),
    declaredSha256: text("declared_sha256").notNull(),
    declaredSizeBytes: integer("declared_size_bytes"),
    detectedFileType: text("detected_file_type"),
    actualSha256: text("actual_sha256"),
    actualSizeBytes: integer("actual_size_bytes"),
    objectEtag: text("object_etag"),
    storageStatus: text("storage_status").notNull(),
    securityCheckStatus: text("security_check_status").notNull(),
    securityFailureCode: text("security_failure_code"),
    securityFailureMessage: text("security_failure_message"),
    uploadedAt: text("uploaded_at"),
    retentionUntil: text("retention_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("material_import_files_batch_uq").on(table.batchId),
    uniqueIndex("material_import_files_object_key_uq").on(table.objectKey),
    index("material_import_files_sha_idx").on(table.actualSha256, table.batchId),
    index("material_import_files_storage_idx").on(table.storageStatus, table.updatedAt, table.id),
    check("material_import_files_filename_ck", sql`length(trim(${table.originalFilename})) BETWEEN 1 AND 255 AND instr(${table.originalFilename}, char(0)) = 0`),
    check("material_import_files_declared_sha_ck", sql`length(${table.declaredSha256}) = 64 AND ${table.declaredSha256} NOT GLOB '*[^0-9a-f]*'`),
    check("material_import_files_declared_size_ck", sql`${table.declaredSizeBytes} IS NULL OR ${table.declaredSizeBytes} >= 0`),
    check("material_import_files_detected_type_ck", sql`${table.detectedFileType} IS NULL OR ${table.detectedFileType} IN ('XLSX','CSV')`),
    check("material_import_files_actual_sha_ck", sql`${table.actualSha256} IS NULL OR (length(${table.actualSha256}) = 64 AND ${table.actualSha256} NOT GLOB '*[^0-9a-f]*')`),
    check("material_import_files_actual_size_ck", sql`${table.actualSizeBytes} IS NULL OR ${table.actualSizeBytes} > 0`),
    check("material_import_files_storage_status_ck", sql`${table.storageStatus} IN ('UPLOAD_PENDING','STORED','RECONCILIATION_REQUIRED','STORAGE_FAILED','DELETE_PENDING','DELETED')`),
    check("material_import_files_security_status_ck", sql`${table.securityCheckStatus} IN ('NOT_STARTED','PENDING','BASIC_CHECK_PASSED','REJECTED')`),
    check("material_import_files_stored_metadata_ck", sql`${table.storageStatus} <> 'STORED' OR (${table.detectedFileType} IS NOT NULL AND ${table.actualSha256} IS NOT NULL AND ${table.actualSizeBytes} > 0 AND ${table.uploadedAt} IS NOT NULL)`),
    check("material_import_files_ready_ck", sql`${table.securityCheckStatus} <> 'BASIC_CHECK_PASSED' OR (${table.storageStatus} IN ('STORED','DELETE_PENDING','DELETED') AND ${table.detectedFileType} IS NOT NULL AND ${table.actualSha256} IS NOT NULL AND ${table.actualSizeBytes} > 0)`),
    check("material_import_files_security_failure_ck", sql`(${table.securityCheckStatus} = 'REJECTED' AND length(trim(${table.securityFailureCode})) > 0) OR (${table.securityCheckStatus} <> 'REJECTED' AND ${table.securityFailureCode} IS NULL AND ${table.securityFailureMessage} IS NULL)`),
  ],
);

export const materialImportParseRuns = sqliteTable(
  "material_import_parse_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }), batchId: integer("batch_id").notNull(), parserVersion: text("parser_version").notNull(),
    runStatus: text("run_status").notNull(), attemptNo: integer("attempt_no").notNull().default(1), sourceFileSha256: text("source_file_sha256"),
    leaseTokenDigest: text("lease_token_digest"), leaseExpiresAt: integer("lease_expires_at"), heartbeatAt: text("heartbeat_at"), workerRequestId: text("worker_request_id"),
    currentStage: text("current_stage").notNull(), startedAt: text("started_at"), completedAt: text("completed_at"), rowsWritten: integer("rows_written").notNull().default(0),
    parsedSheetCount: integer("parsed_sheet_count").notNull().default(0), normalizedJsonBytes: integer("normalized_json_bytes").notNull().default(0), decodedTextBytes: integer("decoded_text_bytes").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0), errorCount: integer("error_count").notNull().default(0), failureCode: text("failure_code"), safeFailureMessage: text("safe_failure_message"),
    mappingPreparationStatus: text("mapping_preparation_status").notNull().default("NOT_STARTED"), mappingPreparationAttemptCount: integer("mapping_preparation_attempt_count").notNull().default(0),
    mappingPreparationFailureCode: text("mapping_preparation_failure_code"), mappingPreparationSafeMessage: text("mapping_preparation_safe_message"), mappingPreparationUpdatedAt: text("mapping_preparation_updated_at"),
    createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("material_import_parse_runs_batch_status_idx").on(table.batchId, table.runStatus, table.id), index("material_import_parse_runs_lease_idx").on(table.runStatus, table.leaseExpiresAt, table.id),
    uniqueIndex("material_import_parse_runs_active_uq").on(table.batchId).where(sql`${table.runStatus} IN ('QUEUED','RUNNING','STAGED','PUBLISHING')`),
    check("material_import_parse_runs_status_ck", sql`${table.runStatus} IN ('QUEUED','RUNNING','STAGED','PUBLISHING','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')`),
    check("material_import_parse_runs_stage_ck", sql`${table.currentStage} IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION','COMPLETE')`),
    check("material_import_parse_runs_counts_ck", sql`${table.attemptNo}>0 AND ${table.rowsWritten}>=0 AND ${table.parsedSheetCount}>=0 AND ${table.normalizedJsonBytes}>=0 AND ${table.decodedTextBytes}>=0 AND ${table.warningCount}>=0 AND ${table.errorCount}>=0`),
    check("material_import_parse_runs_mapping_status_ck", sql`${table.mappingPreparationStatus} IN ('NOT_STARTED','QUEUED','RUNNING','READY','FAILED')`),
    check("material_import_parse_runs_sha_ck", sql`${table.sourceFileSha256} IS NULL OR (length(${table.sourceFileSha256})=64 AND ${table.sourceFileSha256} NOT GLOB '*[^0-9a-f]*')`),
    check("material_import_parse_runs_lease_ck", sql`(${table.leaseTokenDigest} IS NULL AND ${table.leaseExpiresAt} IS NULL) OR (length(${table.leaseTokenDigest})=64 AND ${table.leaseExpiresAt}>0)`),
    check("material_import_parse_runs_failure_ck", sql`(${table.runStatus}='FAILED' AND length(trim(${table.failureCode}))>0) OR (${table.runStatus}<>'FAILED' AND ${table.failureCode} IS NULL AND ${table.safeFailureMessage} IS NULL)`),
    check("material_import_parse_runs_mapping_failure_ck", sql`(${table.mappingPreparationStatus}='FAILED' AND length(trim(${table.mappingPreparationFailureCode}))>0) OR (${table.mappingPreparationStatus}<>'FAILED' AND ${table.mappingPreparationFailureCode} IS NULL AND ${table.mappingPreparationSafeMessage} IS NULL)`),
  ],
);

export const materialImportParseSheets = sqliteTable("material_import_parse_sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }), parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
  sheetIndex: integer("sheet_index").notNull(), sheetName: text("sheet_name").notNull(), visibility: text("visibility").notNull(), parseStatus: text("parse_status").notNull(),
  rowCount: integer("row_count").notNull().default(0), sourceColumnMax: integer("source_column_max").notNull().default(0), mergedRangesJson: text("merged_ranges_json"),
  warningCount: integer("warning_count").notNull().default(0), safeWarningsJson: text("safe_warnings_json"), startedAt: text("started_at"), completedAt: text("completed_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("material_import_parse_sheets_position_uq").on(table.parseRunId, table.sheetIndex), index("material_import_parse_sheets_run_status_idx").on(table.parseRunId, table.parseStatus, table.sheetIndex), check("material_import_parse_sheets_visibility_ck", sql`${table.visibility} IN ('VISIBLE','HIDDEN','VERY_HIDDEN')`), check("material_import_parse_sheets_status_ck", sql`${table.parseStatus} IN ('PENDING','RUNNING','COMPLETED','SKIPPED_HIDDEN','SKIPPED_VERY_HIDDEN','FAILED')`), check("material_import_parse_sheets_counts_ck", sql`${table.sheetIndex}>=0 AND ${table.rowCount}>=0 AND ${table.sourceColumnMax}>=0 AND ${table.warningCount}>=0`), check("material_import_parse_sheets_json_ck", sql`(${table.mergedRangesJson} IS NULL OR json_valid(${table.mergedRangesJson})) AND (${table.safeWarningsJson} IS NULL OR json_valid(${table.safeWarningsJson}))`)]);

export const materialImportSharedStringChunks = sqliteTable("material_import_shared_string_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }), parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
  chunkIndex: integer("chunk_index").notNull(), startStringIndex: integer("start_string_index").notNull(), itemCount: integer("item_count").notNull(), decodedBytes: integer("decoded_bytes").notNull(), valuesJson: text("values_json").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("material_import_shared_string_chunks_position_uq").on(table.parseRunId, table.chunkIndex), index("material_import_shared_string_chunks_lookup_idx").on(table.parseRunId, table.startStringIndex), check("material_import_shared_string_chunks_counts_ck", sql`${table.chunkIndex}>=0 AND ${table.startStringIndex}>=0 AND ${table.itemCount}>0 AND ${table.decodedBytes}>=0`), check("material_import_shared_string_chunks_json_ck", sql`json_valid(${table.valuesJson}) AND json_type(${table.valuesJson})='array'`)]);

export const materialImportRows = sqliteTable(
  "material_import_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id").notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
    parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
    sheetIndex: integer("sheet_index").notNull(),
    sheetName: text("sheet_name").notNull(),
    rowNumber: integer("row_number").notNull(),
    rawValuesJson: text("raw_values_json").notNull(),
    rawRowHash: text("raw_row_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("material_import_rows_position_uq").on(table.parseRunId, table.sheetIndex, table.rowNumber),
    index("material_import_rows_batch_run_idx").on(table.batchId, table.parseRunId, table.sheetIndex, table.rowNumber),
    check("material_import_rows_position_ck", sql`${table.sheetIndex} >= 0 AND ${table.rowNumber} > 0 AND length(${table.sheetName}) > 0`),
    check("material_import_rows_values_ck", sql`json_valid(${table.rawValuesJson}) AND json_type(${table.rawValuesJson}) = 'object'`),
    check("material_import_rows_sha_ck", sql`length(${table.rawRowHash}) = 64 AND ${table.rawRowHash} NOT GLOB '*[^0-9a-f]*'`),
  ],
);

export const materialImportHeaderSuggestions = sqliteTable("material_import_header_suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }), parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }), sheetIndex: integer("sheet_index").notNull(),
  rowNumber: integer("row_number").notNull(), rank: integer("rank").notNull(), score: real("score").notNull(), reasonCodesJson: text("reason_codes_json").notNull(), algorithmVersion: text("algorithm_version").notNull(), metadataDigest: text("metadata_digest").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("material_import_header_suggestions_position_uq").on(table.parseRunId, table.sheetIndex, table.rowNumber, table.algorithmVersion), index("material_import_header_suggestions_rank_idx").on(table.parseRunId, table.sheetIndex, table.rank, table.id), check("material_import_header_suggestions_values_ck", sql`${table.sheetIndex}>=0 AND ${table.rowNumber}>0 AND ${table.rank}>0 AND ${table.score} BETWEEN 0 AND 1`), check("material_import_header_suggestions_json_ck", sql`json_valid(${table.reasonCodesJson}) AND json_type(${table.reasonCodesJson})='array'`), check("material_import_header_suggestions_digest_ck", sql`length(${table.metadataDigest})=64 AND ${table.metadataDigest} NOT GLOB '*[^0-9a-f]*'`)]);

export const materialImportJobOutbox = sqliteTable("material_import_job_outbox", {
  id: text("id").primaryKey(), batchId: integer("batch_id").notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), parseRunId: integer("parse_run_id").references(() => materialImportParseRuns.id, { onDelete: "restrict" }), normalizationRunId: integer("normalization_run_id"),
  jobType: text("job_type").notNull(), payloadVersion: integer("payload_version").notNull().default(1), payloadJson: text("payload_json").notNull(), dispatchStatus: text("dispatch_status").notNull().default("PENDING"),
  dispatchVersion: integer("dispatch_version").notNull().default(1), attemptCount: integer("attempt_count").notNull().default(0), availableAt: integer("available_at").notNull(), lastAttemptAt: integer("last_attempt_at"), safeFailureCode: text("safe_failure_code"), createdAt: text("created_at").notNull(), dispatchedAt: text("dispatched_at"),
}, (table) => [
  index("material_import_job_outbox_pending_idx").on(table.dispatchStatus, table.availableAt, table.id),
  uniqueIndex("material_import_job_outbox_parse_stage_uq").on(table.parseRunId, table.jobType, sql`json_extract(${table.payloadJson},'$.sheet_index')`).where(sql`${table.parseRunId} IS NOT NULL AND ${table.dispatchStatus}<>'DEAD'`),
  uniqueIndex("material_import_job_outbox_normalization_stage_uq").on(table.normalizationRunId, table.jobType, sql`COALESCE(json_extract(${table.payloadJson},'$.after_row_number'),-1)`).where(sql`${table.normalizationRunId} IS NOT NULL AND ${table.dispatchStatus}<>'DEAD'`),
  check("material_import_job_outbox_type_ck", sql`${table.jobType} IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION','START_NORMALIZATION','NORMALIZE_ROW_CHUNK','VERIFY_NORMALIZATION','PUBLISH_NORMALIZATION')`),
  check("material_import_job_outbox_subject_ck", sql`(${table.parseRunId} IS NOT NULL AND ${table.normalizationRunId} IS NULL AND ${table.jobType} IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION')) OR (${table.parseRunId} IS NULL AND ${table.normalizationRunId} IS NOT NULL AND ${table.jobType} IN ('START_NORMALIZATION','NORMALIZE_ROW_CHUNK','VERIFY_NORMALIZATION','PUBLISH_NORMALIZATION'))`),
  check("material_import_job_outbox_status_ck", sql`${table.dispatchStatus} IN ('PENDING','DISPATCHING','DISPATCHED','RETRY_WAIT','DEAD')`), check("material_import_job_outbox_counts_ck", sql`${table.payloadVersion}>0 AND ${table.dispatchVersion}>0 AND ${table.attemptCount}>=0 AND ${table.availableAt}>0`), check("material_import_job_outbox_json_ck", sql`json_valid(${table.payloadJson}) AND json_type(${table.payloadJson})='object'`),
]);

export const materialImportMappings = sqliteTable("material_import_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }), batchId: integer("batch_id").notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }), parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
  selectedSheetIndex: integer("selected_sheet_index").notNull(), headerMode: text("header_mode").notNull(), headerRowNumber: integer("header_row_number"), mappingStatus: text("mapping_status").notNull().default("DRAFT"), mappingVersion: integer("mapping_version").notNull().default(1), metadataDigest: text("metadata_digest").notNull(),
  suggestionAlgorithmVersion: text("suggestion_algorithm_version"), supersedesMappingId: integer("supersedes_mapping_id"),
  createdBy: text("created_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), updatedBy: text("updated_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), confirmedBy: text("confirmed_by").references(() => appUsers.username, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), confirmedAt: text("confirmed_at"),
}, (table) => [foreignKey({ columns: [table.supersedesMappingId], foreignColumns: [table.id] }).onDelete("restrict"), index("material_import_mappings_batch_run_idx").on(table.batchId, table.parseRunId, table.id), uniqueIndex("material_import_mappings_current_uq").on(table.parseRunId).where(sql`${table.mappingStatus}<>'SUPERSEDED'`), check("material_import_mappings_header_ck", sql`(${table.headerMode}='SINGLE_ROW' AND ${table.headerRowNumber}>0) OR (${table.headerMode}='NO_HEADER' AND ${table.headerRowNumber} IS NULL)`), check("material_import_mappings_status_ck", sql`${table.mappingStatus} IN ('DRAFT','CONFIRMED','STALE','SUPERSEDED')`), check("material_import_mappings_values_ck", sql`${table.selectedSheetIndex}>=0 AND ${table.mappingVersion}>0`), check("material_import_mappings_digest_ck", sql`length(${table.metadataDigest})=64 AND ${table.metadataDigest} NOT GLOB '*[^0-9a-f]*'`), check("material_import_mappings_confirm_ck", sql`(${table.mappingStatus}='CONFIRMED' AND ${table.confirmedBy} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL) OR (${table.mappingStatus}<>'CONFIRMED')`)]);

export const materialImportMappingItems = sqliteTable("material_import_mapping_items", {
  id: integer("id").primaryKey({ autoIncrement: true }), mappingId: integer("mapping_id").notNull().references(() => materialImportMappings.id, { onDelete: "restrict" }), sourceColumnIndex: integer("source_column_index"), sourceHeader: text("source_header"),
  targetNamespace: text("target_namespace").notNull(), targetCode: text("target_code").notNull(), mappingMode: text("mapping_mode").notNull(), defaultValueJson: text("default_value_json"), required: integer("required").notNull().default(0), displayOrder: integer("display_order").notNull(),
}, (table) => [uniqueIndex("material_import_mapping_items_source_uq").on(table.mappingId, table.sourceColumnIndex).where(sql`${table.sourceColumnIndex} IS NOT NULL`), uniqueIndex("material_import_mapping_items_target_uq").on(table.mappingId, table.targetNamespace, table.targetCode).where(sql`${table.targetNamespace}<>'ignore'`), check("material_import_mapping_items_namespace_ck", sql`${table.targetNamespace} IN ('basic','attribute','category_hint','supplier_reference','ignore')`), check("material_import_mapping_items_mode_ck", sql`${table.mappingMode} IN ('SOURCE','SOURCE_WITH_DEFAULT','DEFAULT','IGNORE')`), check("material_import_mapping_items_source_ck", sql`(${table.mappingMode}='DEFAULT' AND ${table.sourceColumnIndex} IS NULL) OR (${table.mappingMode}<>'DEFAULT' AND ${table.sourceColumnIndex}>=0)`), check("material_import_mapping_items_default_ck", sql`${table.defaultValueJson} IS NULL OR json_valid(${table.defaultValueJson})`), check("material_import_mapping_items_values_ck", sql`${table.required} IN (0,1) AND ${table.displayOrder}>=0`)]);

export const materialImportNormalizationRuns = sqliteTable("material_import_normalization_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Enforced by material_import_normalization_runs_binding_* triggers because 0006 rebuilds the batch parent on D1.
  batchId: integer("batch_id").notNull(),
  parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }),
  mappingId: integer("mapping_id").notNull().references(() => materialImportMappings.id, { onDelete: "restrict" }),
  mappingVersion: integer("mapping_version").notNull(), mappingDigest: text("mapping_digest").notNull(), processorVersion: text("processor_version").notNull(), payloadSchemaVersion: integer("payload_schema_version").notNull().default(1), metadataDigest: text("metadata_digest").notNull(), batchVersionAtStart: integer("batch_version_at_start").notNull(),
  runStatus: text("run_status").notNull(), attemptNo: integer("attempt_no").notNull().default(1), leaseTokenDigest: text("lease_token_digest"), leaseExpiresAt: integer("lease_expires_at"), heartbeatAt: text("heartbeat_at"), workerRequestId: text("worker_request_id"), currentStage: text("current_stage").notNull(),
  totalRows: integer("total_rows").notNull().default(0), processedRows: integer("processed_rows").notNull().default(0), validRows: integer("valid_rows").notNull().default(0), warningRows: integer("warning_rows").notNull().default(0), errorRows: integer("error_rows").notNull().default(0), normalizedJsonBytes: integer("normalized_json_bytes").notNull().default(0), issueCount: integer("issue_count").notNull().default(0), warningCount: integer("warning_count").notNull().default(0), errorCount: integer("error_count").notNull().default(0),
  resultDigest: text("result_digest"), detailRetentionUntil: integer("detail_retention_until"), requestedBy: text("requested_by").notNull().references(() => appUsers.username, { onDelete: "restrict" }), rerunReason: text("rerun_reason"), startedAt: text("started_at"), completedAt: text("completed_at"), failureCode: text("failure_code"), safeFailureMessage: text("safe_failure_message"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("material_import_normalization_runs_batch_status_idx").on(table.batchId, table.runStatus, table.id), index("material_import_normalization_runs_lease_idx").on(table.runStatus, table.leaseExpiresAt, table.id), index("material_import_normalization_runs_retention_idx").on(table.detailRetentionUntil, table.id),
  uniqueIndex("material_import_normalization_runs_active_uq").on(table.batchId).where(sql`${table.runStatus} IN ('QUEUED','RUNNING','STAGED','PUBLISHING')`),
  check("material_import_normalization_runs_status_ck", sql`${table.runStatus} IN ('QUEUED','RUNNING','STAGED','PUBLISHING','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')`),
  check("material_import_normalization_runs_stage_ck", sql`${table.currentStage} IN ('LOAD_MAPPING','READ_SOURCE_ROWS','NORMALIZE_ROWS','VERIFY_RESULT','PUBLISH_RESULT','COMPLETE')`),
  check("material_import_normalization_runs_counts_ck", sql`${table.mappingVersion}>0 AND ${table.payloadSchemaVersion}=1 AND ${table.batchVersionAtStart}>0 AND ${table.attemptNo}>0 AND ${table.totalRows}>=0 AND ${table.processedRows} BETWEEN 0 AND ${table.totalRows} AND ${table.validRows}>=0 AND ${table.warningRows}>=0 AND ${table.errorRows}>=0 AND ${table.validRows}+${table.warningRows}+${table.errorRows}=${table.processedRows} AND ${table.normalizedJsonBytes}>=0 AND ${table.issueCount}>=0 AND ${table.warningCount}>=0 AND ${table.errorCount}>=0 AND ${table.warningCount}+${table.errorCount}=${table.issueCount}`),
  check("material_import_normalization_runs_digest_ck", sql`length(${table.mappingDigest})=64 AND ${table.mappingDigest} NOT GLOB '*[^0-9a-f]*' AND length(${table.metadataDigest})=64 AND ${table.metadataDigest} NOT GLOB '*[^0-9a-f]*' AND (${table.resultDigest} IS NULL OR (length(${table.resultDigest})=64 AND ${table.resultDigest} NOT GLOB '*[^0-9a-f]*'))`),
  check("material_import_normalization_runs_lease_ck", sql`(${table.leaseTokenDigest} IS NULL AND ${table.leaseExpiresAt} IS NULL) OR (length(${table.leaseTokenDigest})=64 AND ${table.leaseExpiresAt}>0)`),
  check("material_import_normalization_runs_failure_ck", sql`(${table.runStatus}='FAILED' AND length(trim(${table.failureCode}))>0) OR (${table.runStatus}<>'FAILED' AND ${table.failureCode} IS NULL AND ${table.safeFailureMessage} IS NULL)`),
  check("material_import_normalization_runs_rerun_ck", sql`${table.rerunReason} IS NULL OR length(trim(${table.rerunReason})) BETWEEN 1 AND 500`),
]);

export const materialImportNormalizedRows = sqliteTable("material_import_normalized_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }), batchId: integer("batch_id").notNull(), normalizationRunId: integer("normalization_run_id").notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }), parseRunId: integer("parse_run_id").notNull().references(() => materialImportParseRuns.id, { onDelete: "restrict" }), sourceSheetIndex: integer("source_sheet_index").notNull(), sourceRowNumber: integer("source_row_number").notNull(), sourceRawRowHash: text("source_raw_row_hash").notNull(), normalizedPayloadJson: text("normalized_payload_json").notNull(), normalizedPayloadHash: text("normalized_payload_hash").notNull(), rowStatus: text("row_status").notNull(), errorCount: integer("error_count").notNull().default(0), warningCount: integer("warning_count").notNull().default(0), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("material_import_normalized_rows_position_uq").on(table.normalizationRunId, table.sourceSheetIndex, table.sourceRowNumber), index("material_import_normalized_rows_status_idx").on(table.normalizationRunId, table.rowStatus, table.id),
  check("material_import_normalized_rows_position_ck", sql`${table.sourceSheetIndex}>=0 AND ${table.sourceRowNumber}>0`), check("material_import_normalized_rows_payload_ck", sql`json_valid(${table.normalizedPayloadJson}) AND json_type(${table.normalizedPayloadJson})='object' AND length(CAST(${table.normalizedPayloadJson} AS BLOB))<=262144`), check("material_import_normalized_rows_hash_ck", sql`length(${table.sourceRawRowHash})=64 AND ${table.sourceRawRowHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.normalizedPayloadHash})=64 AND ${table.normalizedPayloadHash} NOT GLOB '*[^0-9a-f]*'`), check("material_import_normalized_rows_status_ck", sql`(${table.rowStatus}='VALID' AND ${table.errorCount}=0 AND ${table.warningCount}=0) OR (${table.rowStatus}='WARNING' AND ${table.errorCount}=0 AND ${table.warningCount}>0) OR (${table.rowStatus}='ERROR' AND ${table.errorCount}>0)`),
]);

export const materialImportNormalizationIssues = sqliteTable("material_import_normalization_issues", {
  id: integer("id").primaryKey({ autoIncrement: true }), normalizationRunId: integer("normalization_run_id").notNull().references(() => materialImportNormalizationRuns.id, { onDelete: "restrict" }), normalizedRowId: integer("normalized_row_id").notNull().references(() => materialImportNormalizedRows.id, { onDelete: "restrict" }), issueLevel: text("issue_level").notNull(), issueCode: text("issue_code").notNull(), targetCode: text("target_code").notNull(), sourceSheetIndex: integer("source_sheet_index").notNull(), sourceRowNumber: integer("source_row_number").notNull(), sourceColumnIndex: integer("source_column_index"), safeMessage: text("safe_message").notNull(), safeDetailsJson: text("safe_details_json").notNull().default("{}"), createdAt: text("created_at").notNull(),
}, (table) => [
  index("material_import_normalization_issues_filter_idx").on(table.normalizationRunId, table.issueLevel, table.issueCode, table.id), index("material_import_normalization_issues_target_idx").on(table.normalizationRunId, table.targetCode, table.id), index("material_import_normalization_issues_row_idx").on(table.normalizedRowId, table.id),
  uniqueIndex("material_import_normalization_issues_idempotent_uq").on(table.normalizationRunId, table.sourceSheetIndex, table.sourceRowNumber, table.targetCode, table.issueCode, sql`COALESCE(${table.sourceColumnIndex},-1)`),
  check("material_import_normalization_issues_level_ck", sql`${table.issueLevel} IN ('ERROR','WARNING')`), check("material_import_normalization_issues_position_ck", sql`${table.sourceSheetIndex}>=0 AND ${table.sourceRowNumber}>0 AND (${table.sourceColumnIndex} IS NULL OR ${table.sourceColumnIndex}>=0)`), check("material_import_normalization_issues_code_ck", sql`length(${table.issueCode}) BETWEEN 3 AND 100 AND length(${table.targetCode}) BETWEEN 3 AND 160 AND length(${table.safeMessage}) BETWEEN 1 AND 500`), check("material_import_normalization_issues_details_ck", sql`json_valid(${table.safeDetailsJson}) AND json_type(${table.safeDetailsJson})='object'`),
]);

export const materialImportEvents = sqliteTable(
  "material_import_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id").notNull().references(() => materialImportBatches.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorIdentifier: text("actor_identifier"),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    requestId: text("request_id").notNull(),
    safeDetailsJson: text("safe_details_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("material_import_events_batch_created_idx").on(table.batchId, table.createdAt, table.id),
    check("material_import_events_type_ck", sql`${table.eventType} IN ('BATCH_CREATED','FILE_UPLOAD_STARTED','FILE_STORED','FILE_UPLOAD_COMPLETED','FILE_UPLOAD_FAILED','FILE_SECURITY_CHECK_PASSED','FILE_SECURITY_CHECK_FAILED','RECONCILIATION_REQUIRED','BATCH_CANCELLED','FILE_DELETE_REQUESTED','FILE_DELETED','FILE_DELETE_FAILED','PARSE_QUEUED','PARSE_STARTED','PARSE_PUBLISHED','PARSE_FAILED','MAPPING_PREPARATION_READY','MAPPING_PREPARATION_FAILED','MAPPING_SAVED','MAPPING_CONFIRMED','NORMALIZATION_QUEUED','NORMALIZATION_STARTED','NORMALIZATION_PUBLISHED','NORMALIZATION_FAILED','NORMALIZATION_CANCELLED','NORMALIZATION_CLEANUP_FAILED')`),
    check("material_import_events_actor_ck", sql`${table.actorType} IN ('USER','SYSTEM')`),
    check("material_import_events_status_ck", sql`(${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')) AND (${table.newStatus} IS NULL OR ${table.newStatus} IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))`),
    check("material_import_events_details_ck", sql`${table.safeDetailsJson} IS NULL OR json_valid(${table.safeDetailsJson})`),
  ],
);

export const materialImportIdempotency = sqliteTable(
  "material_import_idempotency",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().references(() => appUsers.username, { onDelete: "restrict" }),
    method: text("method").notNull(),
    routeScope: text("route_scope").notNull(),
    keyDigest: text("key_digest").notNull(),
    requestDigest: text("request_digest").notNull(),
    operationId: text("operation_id").notNull(),
    state: text("state").notNull(),
    batchId: integer("batch_id").references(() => materialImportBatches.id, { onDelete: "restrict" }),
    fileId: integer("file_id").references(() => materialImportFiles.id, { onDelete: "restrict" }),
    leaseTokenDigest: text("lease_token_digest").notNull(),
    leaseExpiresAt: integer("lease_expires_at"),
    statusCode: integer("status_code"),
    responseJson: text("response_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: integer("expires_at"),
    recoveryUntil: integer("recovery_until").notNull(),
  },
  (table) => [
    uniqueIndex("material_import_idempotency_scope_uq").on(table.username, table.method, table.routeScope, table.keyDigest),
    uniqueIndex("material_import_idempotency_operation_uq").on(table.operationId),
    index("material_import_idempotency_recovery_idx").on(table.state, table.recoveryUntil, table.id),
    check("material_import_idempotency_method_ck", sql`${table.method} IN ('POST','PUT')`),
    check("material_import_idempotency_route_ck", sql`length(${table.routeScope}) BETWEEN 1 AND 255`),
    check("material_import_idempotency_digest_ck", sql`length(${table.keyDigest}) = 64 AND length(${table.requestDigest}) = 64 AND length(${table.leaseTokenDigest}) = 64`),
    check("material_import_idempotency_operation_ck", sql`length(${table.operationId}) = 36`),
    check("material_import_idempotency_state_ck", sql`${table.state} IN ('PENDING','COMPLETED')`),
    check("material_import_idempotency_result_ck", sql`(${table.state} = 'PENDING' AND ${table.leaseExpiresAt} > 0 AND ${table.statusCode} IS NULL AND ${table.responseJson} IS NULL AND ${table.expiresAt} IS NULL) OR (${table.state} = 'COMPLETED' AND ${table.leaseExpiresAt} IS NULL AND ${table.statusCode} BETWEEN 100 AND 599 AND json_valid(${table.responseJson}) AND ${table.expiresAt} > 0)`),
    check("material_import_idempotency_recovery_ck", sql`${table.recoveryUntil} > 0`),
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
