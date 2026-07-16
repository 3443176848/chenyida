PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__normalization_backup_files` AS SELECT * FROM `material_import_files`;--> statement-breakpoint
CREATE TABLE `__normalization_backup_rows` AS SELECT * FROM `material_import_rows`;--> statement-breakpoint
CREATE TABLE `__normalization_backup_mappings` AS SELECT * FROM `material_import_mappings`;--> statement-breakpoint
CREATE TABLE `__normalization_backup_mapping_items` AS SELECT * FROM `material_import_mapping_items`;--> statement-breakpoint
CREATE TABLE `__normalization_backup_events` AS SELECT * FROM `material_import_events`;--> statement-breakpoint
CREATE TABLE `__normalization_backup_idempotency` AS SELECT * FROM `material_import_idempotency`;--> statement-breakpoint
CREATE TABLE `__normalization_backup_job_outbox` AS SELECT * FROM `material_import_job_outbox`;--> statement-breakpoint
DELETE FROM `material_import_idempotency`;--> statement-breakpoint
DELETE FROM `material_import_mapping_items`;--> statement-breakpoint
DELETE FROM `material_import_mappings`;--> statement-breakpoint
DELETE FROM `material_import_job_outbox`;--> statement-breakpoint
DELETE FROM `material_import_events`;--> statement-breakpoint
DELETE FROM `material_import_rows`;--> statement-breakpoint
DELETE FROM `material_import_files`;--> statement-breakpoint
DROP TABLE `material_import_idempotency`;--> statement-breakpoint
DROP TABLE `material_import_mapping_items`;--> statement-breakpoint
DROP TABLE `material_import_mappings`;--> statement-breakpoint
DROP TABLE `material_import_job_outbox`;--> statement-breakpoint
DROP TABLE `material_import_events`;--> statement-breakpoint
DROP TABLE `material_import_rows`;--> statement-breakpoint
DROP TABLE `material_import_files`;--> statement-breakpoint
CREATE TABLE `material_import_normalization_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalization_run_id` integer NOT NULL,
	`normalized_row_id` integer NOT NULL,
	`issue_level` text NOT NULL,
	`issue_code` text NOT NULL,
	`target_code` text NOT NULL,
	`source_sheet_index` integer NOT NULL,
	`source_row_number` integer NOT NULL,
	`source_column_index` integer,
	`safe_message` text NOT NULL,
	`safe_details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`normalization_run_id`) REFERENCES `material_import_normalization_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalized_row_id`) REFERENCES `material_import_normalized_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_normalization_issues_level_ck" CHECK("material_import_normalization_issues"."issue_level" IN ('ERROR','WARNING')),
	CONSTRAINT "material_import_normalization_issues_position_ck" CHECK("material_import_normalization_issues"."source_sheet_index">=0 AND "material_import_normalization_issues"."source_row_number">0 AND ("material_import_normalization_issues"."source_column_index" IS NULL OR "material_import_normalization_issues"."source_column_index">=0)),
	CONSTRAINT "material_import_normalization_issues_code_ck" CHECK(length("material_import_normalization_issues"."issue_code") BETWEEN 3 AND 100 AND length("material_import_normalization_issues"."target_code") BETWEEN 3 AND 160 AND length("material_import_normalization_issues"."safe_message") BETWEEN 1 AND 500),
	CONSTRAINT "material_import_normalization_issues_details_ck" CHECK(json_valid("material_import_normalization_issues"."safe_details_json") AND json_type("material_import_normalization_issues"."safe_details_json")='object')
);
--> statement-breakpoint
CREATE INDEX `material_import_normalization_issues_filter_idx` ON `material_import_normalization_issues` (`normalization_run_id`,`issue_level`,`issue_code`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_normalization_issues_target_idx` ON `material_import_normalization_issues` (`normalization_run_id`,`target_code`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_normalization_issues_row_idx` ON `material_import_normalization_issues` (`normalized_row_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_normalization_issues_idempotent_uq` ON `material_import_normalization_issues` (`normalization_run_id`,`source_sheet_index`,`source_row_number`,`target_code`,`issue_code`,COALESCE(`source_column_index`,-1));--> statement-breakpoint
CREATE TABLE `material_import_normalization_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`parse_run_id` integer NOT NULL,
	`mapping_id` integer NOT NULL,
	`mapping_version` integer NOT NULL,
	`mapping_digest` text NOT NULL,
	`processor_version` text NOT NULL,
	`payload_schema_version` integer DEFAULT 1 NOT NULL,
	`metadata_digest` text NOT NULL,
	`batch_version_at_start` integer NOT NULL,
	`run_status` text NOT NULL,
	`attempt_no` integer DEFAULT 1 NOT NULL,
	`lease_token_digest` text,
	`lease_expires_at` integer,
	`heartbeat_at` text,
	`worker_request_id` text,
	`current_stage` text NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`processed_rows` integer DEFAULT 0 NOT NULL,
	`valid_rows` integer DEFAULT 0 NOT NULL,
	`warning_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`normalized_json_bytes` integer DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`result_digest` text,
	`detail_retention_until` integer,
	`requested_by` text NOT NULL,
	`rerun_reason` text,
	`started_at` text,
	`completed_at` text,
	`failure_code` text,
	`safe_failure_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`mapping_id`) REFERENCES `material_import_mappings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_normalization_runs_status_ck" CHECK("material_import_normalization_runs"."run_status" IN ('QUEUED','RUNNING','STAGED','PUBLISHING','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')),
	CONSTRAINT "material_import_normalization_runs_stage_ck" CHECK("material_import_normalization_runs"."current_stage" IN ('LOAD_MAPPING','READ_SOURCE_ROWS','NORMALIZE_ROWS','VERIFY_RESULT','PUBLISH_RESULT','COMPLETE')),
	CONSTRAINT "material_import_normalization_runs_counts_ck" CHECK("material_import_normalization_runs"."mapping_version">0 AND "material_import_normalization_runs"."payload_schema_version"=1 AND "material_import_normalization_runs"."batch_version_at_start">0 AND "material_import_normalization_runs"."attempt_no">0 AND "material_import_normalization_runs"."total_rows">=0 AND "material_import_normalization_runs"."processed_rows" BETWEEN 0 AND "material_import_normalization_runs"."total_rows" AND "material_import_normalization_runs"."valid_rows">=0 AND "material_import_normalization_runs"."warning_rows">=0 AND "material_import_normalization_runs"."error_rows">=0 AND "material_import_normalization_runs"."valid_rows"+"material_import_normalization_runs"."warning_rows"+"material_import_normalization_runs"."error_rows"="material_import_normalization_runs"."processed_rows" AND "material_import_normalization_runs"."normalized_json_bytes">=0 AND "material_import_normalization_runs"."issue_count">=0 AND "material_import_normalization_runs"."warning_count">=0 AND "material_import_normalization_runs"."error_count">=0 AND "material_import_normalization_runs"."warning_count"+"material_import_normalization_runs"."error_count"="material_import_normalization_runs"."issue_count"),
	CONSTRAINT "material_import_normalization_runs_digest_ck" CHECK(length("material_import_normalization_runs"."mapping_digest")=64 AND "material_import_normalization_runs"."mapping_digest" NOT GLOB '*[^0-9a-f]*' AND length("material_import_normalization_runs"."metadata_digest")=64 AND "material_import_normalization_runs"."metadata_digest" NOT GLOB '*[^0-9a-f]*' AND ("material_import_normalization_runs"."result_digest" IS NULL OR (length("material_import_normalization_runs"."result_digest")=64 AND "material_import_normalization_runs"."result_digest" NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "material_import_normalization_runs_lease_ck" CHECK(("material_import_normalization_runs"."lease_token_digest" IS NULL AND "material_import_normalization_runs"."lease_expires_at" IS NULL) OR (length("material_import_normalization_runs"."lease_token_digest")=64 AND "material_import_normalization_runs"."lease_expires_at">0)),
	CONSTRAINT "material_import_normalization_runs_failure_ck" CHECK(("material_import_normalization_runs"."run_status"='FAILED' AND length(trim("material_import_normalization_runs"."failure_code"))>0) OR ("material_import_normalization_runs"."run_status"<>'FAILED' AND "material_import_normalization_runs"."failure_code" IS NULL AND "material_import_normalization_runs"."safe_failure_message" IS NULL)),
	CONSTRAINT "material_import_normalization_runs_rerun_ck" CHECK("material_import_normalization_runs"."rerun_reason" IS NULL OR length(trim("material_import_normalization_runs"."rerun_reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `material_import_normalization_runs_batch_status_idx` ON `material_import_normalization_runs` (`batch_id`,`run_status`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_normalization_runs_lease_idx` ON `material_import_normalization_runs` (`run_status`,`lease_expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_normalization_runs_retention_idx` ON `material_import_normalization_runs` (`detail_retention_until`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_normalization_runs_active_uq` ON `material_import_normalization_runs` (`batch_id`) WHERE "material_import_normalization_runs"."run_status" IN ('QUEUED','RUNNING','STAGED','PUBLISHING');--> statement-breakpoint
CREATE TABLE `material_import_normalized_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`normalization_run_id` integer NOT NULL,
	`parse_run_id` integer NOT NULL,
	`source_sheet_index` integer NOT NULL,
	`source_row_number` integer NOT NULL,
	`source_raw_row_hash` text NOT NULL,
	`normalized_payload_json` text NOT NULL,
	`normalized_payload_hash` text NOT NULL,
	`row_status` text NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`normalization_run_id`) REFERENCES `material_import_normalization_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_normalized_rows_position_ck" CHECK("material_import_normalized_rows"."source_sheet_index">=0 AND "material_import_normalized_rows"."source_row_number">0),
	CONSTRAINT "material_import_normalized_rows_payload_ck" CHECK(json_valid("material_import_normalized_rows"."normalized_payload_json") AND json_type("material_import_normalized_rows"."normalized_payload_json")='object' AND length(CAST("material_import_normalized_rows"."normalized_payload_json" AS BLOB))<=262144),
	CONSTRAINT "material_import_normalized_rows_hash_ck" CHECK(length("material_import_normalized_rows"."source_raw_row_hash")=64 AND "material_import_normalized_rows"."source_raw_row_hash" NOT GLOB '*[^0-9a-f]*' AND length("material_import_normalized_rows"."normalized_payload_hash")=64 AND "material_import_normalized_rows"."normalized_payload_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "material_import_normalized_rows_status_ck" CHECK(("material_import_normalized_rows"."row_status"='VALID' AND "material_import_normalized_rows"."error_count"=0 AND "material_import_normalized_rows"."warning_count"=0) OR ("material_import_normalized_rows"."row_status"='WARNING' AND "material_import_normalized_rows"."error_count"=0 AND "material_import_normalized_rows"."warning_count">0) OR ("material_import_normalized_rows"."row_status"='ERROR' AND "material_import_normalized_rows"."error_count">0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_normalized_rows_position_uq` ON `material_import_normalized_rows` (`normalization_run_id`,`source_sheet_index`,`source_row_number`);--> statement-breakpoint
CREATE INDEX `material_import_normalized_rows_status_idx` ON `material_import_normalized_rows` (`normalization_run_id`,`row_status`,`id`);--> statement-breakpoint
CREATE TABLE `__new_material_import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_no` text NOT NULL,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`retry_of_batch_id` integer,
	`created_by` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`current_parse_run_id` integer,
	`current_normalization_run_id` integer,
	`file_count` integer DEFAULT 0 NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`accepted_rows` integer DEFAULT 0 NOT NULL,
	`rejected_rows` integer DEFAULT 0 NOT NULL,
	`failure_stage` text,
	`failure_code` text,
	`failure_message` text,
	`cancelled_by` text,
	`cancelled_at` text,
	`terminal_at` text,
	`raw_data_retention_until` text,
	`record_retention_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`retry_of_batch_id`) REFERENCES `__new_material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cancelled_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_batches_source_ck" CHECK("__new_material_import_batches"."source_kind" IN ('XLSX','CSV')),
	CONSTRAINT "material_import_batches_status_ck" CHECK("__new_material_import_batches"."status" IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')),
	CONSTRAINT "material_import_batches_version_ck" CHECK("__new_material_import_batches"."current_version" > 0),
	CONSTRAINT "material_import_batches_counts_ck" CHECK("__new_material_import_batches"."file_count" BETWEEN 0 AND 1 AND "__new_material_import_batches"."total_rows" >= 0 AND "__new_material_import_batches"."accepted_rows" >= 0 AND "__new_material_import_batches"."rejected_rows" >= 0 AND "__new_material_import_batches"."accepted_rows" + "__new_material_import_batches"."rejected_rows" <= "__new_material_import_batches"."total_rows"),
	CONSTRAINT "material_import_batches_retry_ck" CHECK("__new_material_import_batches"."retry_of_batch_id" IS NULL OR "__new_material_import_batches"."retry_of_batch_id" <> "__new_material_import_batches"."id"),
	CONSTRAINT "material_import_batches_failure_ck" CHECK(("__new_material_import_batches"."status" = 'FAILED' AND length(trim("__new_material_import_batches"."failure_stage")) > 0 AND length(trim("__new_material_import_batches"."failure_code")) > 0) OR ("__new_material_import_batches"."status" <> 'FAILED' AND "__new_material_import_batches"."failure_stage" IS NULL AND "__new_material_import_batches"."failure_code" IS NULL AND "__new_material_import_batches"."failure_message" IS NULL)),
	CONSTRAINT "material_import_batches_cancel_ck" CHECK(("__new_material_import_batches"."status" = 'CANCELLED' AND "__new_material_import_batches"."cancelled_by" IS NOT NULL AND "__new_material_import_batches"."cancelled_at" IS NOT NULL) OR ("__new_material_import_batches"."status" <> 'CANCELLED' AND "__new_material_import_batches"."cancelled_by" IS NULL AND "__new_material_import_batches"."cancelled_at" IS NULL)),
	CONSTRAINT "material_import_batches_terminal_ck" CHECK(("__new_material_import_batches"."status" IN ('FAILED','CANCELLED') AND "__new_material_import_batches"."terminal_at" IS NOT NULL AND "__new_material_import_batches"."raw_data_retention_until" IS NOT NULL AND "__new_material_import_batches"."record_retention_until" IS NOT NULL) OR ("__new_material_import_batches"."status" NOT IN ('FAILED','CANCELLED') AND "__new_material_import_batches"."terminal_at" IS NULL AND "__new_material_import_batches"."raw_data_retention_until" IS NULL AND "__new_material_import_batches"."record_retention_until" IS NULL)),
	CONSTRAINT "material_import_batches_current_run_ck" CHECK(("__new_material_import_batches"."status" IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED') AND "__new_material_import_batches"."current_parse_run_id" IS NOT NULL) OR ("__new_material_import_batches"."status" NOT IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED'))),
	CONSTRAINT "material_import_batches_current_normalization_ck" CHECK(("__new_material_import_batches"."status" = 'NORMALIZED' AND "__new_material_import_batches"."current_normalization_run_id" IS NOT NULL) OR ("__new_material_import_batches"."status" <> 'NORMALIZED'))
);
--> statement-breakpoint
INSERT INTO `__new_material_import_batches`("id", "batch_no", "source_kind", "status", "retry_of_batch_id", "created_by", "current_version", "current_parse_run_id", "current_normalization_run_id", "file_count", "total_rows", "accepted_rows", "rejected_rows", "failure_stage", "failure_code", "failure_message", "cancelled_by", "cancelled_at", "terminal_at", "raw_data_retention_until", "record_retention_until", "created_at", "updated_at") SELECT "id", "batch_no", "source_kind", "status", "retry_of_batch_id", "created_by", "current_version", "current_parse_run_id", NULL, "file_count", "total_rows", "accepted_rows", "rejected_rows", "failure_stage", "failure_code", "failure_message", "cancelled_by", "cancelled_at", "terminal_at", "raw_data_retention_until", "record_retention_until", "created_at", "updated_at" FROM `material_import_batches`;--> statement-breakpoint
DROP TRIGGER `material_import_parse_runs_batch_insert_ck`;--> statement-breakpoint
DROP TRIGGER `material_import_parse_runs_batch_update_ck`;--> statement-breakpoint
DROP TRIGGER `material_import_batches_current_run_insert_ck`;--> statement-breakpoint
DROP TRIGGER `material_import_batches_current_run_update_ck`;--> statement-breakpoint
DROP TABLE `material_import_batches`;--> statement-breakpoint
ALTER TABLE `__new_material_import_batches` RENAME TO `material_import_batches`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_batches_no_uq` ON `material_import_batches` (`batch_no`);--> statement-breakpoint
CREATE INDEX `material_import_batches_owner_created_idx` ON `material_import_batches` (`created_by`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_status_created_idx` ON `material_import_batches` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_retry_idx` ON `material_import_batches` (`retry_of_batch_id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_raw_retention_idx` ON `material_import_batches` (`raw_data_retention_until`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_current_run_idx` ON `material_import_batches` (`current_parse_run_id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_current_normalization_idx` ON `material_import_batches` (`current_normalization_run_id`);--> statement-breakpoint
CREATE TRIGGER `material_import_parse_runs_batch_insert_ck` BEFORE INSERT ON `material_import_parse_runs`
WHEN NOT EXISTS (SELECT 1 FROM `material_import_batches` b WHERE b.`id`=NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT,'material_import_parse_runs_batch_fk'); END;--> statement-breakpoint
CREATE TRIGGER `material_import_parse_runs_batch_update_ck` BEFORE UPDATE OF `batch_id` ON `material_import_parse_runs`
WHEN NOT EXISTS (SELECT 1 FROM `material_import_batches` b WHERE b.`id`=NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT,'material_import_parse_runs_batch_fk'); END;--> statement-breakpoint
CREATE TRIGGER `material_import_batches_current_run_insert_ck` BEFORE INSERT ON `material_import_batches`
WHEN NEW.`current_parse_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `material_import_parse_runs` p WHERE p.`id`=NEW.`current_parse_run_id` AND p.`batch_id`=NEW.`id`)
BEGIN SELECT RAISE(ABORT,'material_import_batches_current_run_fk'); END;--> statement-breakpoint
CREATE TRIGGER `material_import_batches_current_run_update_ck` BEFORE UPDATE OF `current_parse_run_id`,`id` ON `material_import_batches`
WHEN NEW.`current_parse_run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `material_import_parse_runs` p WHERE p.`id`=NEW.`current_parse_run_id` AND p.`batch_id`=NEW.`id`)
BEGIN SELECT RAISE(ABORT,'material_import_batches_current_run_fk'); END;--> statement-breakpoint
CREATE TABLE `material_import_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `batch_id` integer NOT NULL, `object_key` text NOT NULL, `original_filename` text NOT NULL, `filename_extension` text, `declared_mime_type` text, `declared_sha256` text NOT NULL, `declared_size_bytes` integer, `detected_file_type` text, `actual_sha256` text, `actual_size_bytes` integer, `object_etag` text, `storage_status` text NOT NULL, `security_check_status` text NOT NULL, `security_failure_code` text, `security_failure_message` text, `uploaded_at` text, `retention_until` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_files_filename_ck` CHECK(length(trim(`original_filename`)) BETWEEN 1 AND 255 AND instr(`original_filename`, char(0)) = 0),
	CONSTRAINT `material_import_files_declared_sha_ck` CHECK(length(`declared_sha256`) = 64 AND `declared_sha256` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `material_import_files_declared_size_ck` CHECK(`declared_size_bytes` IS NULL OR `declared_size_bytes` >= 0),
	CONSTRAINT `material_import_files_detected_type_ck` CHECK(`detected_file_type` IS NULL OR `detected_file_type` IN ('XLSX','CSV')),
	CONSTRAINT `material_import_files_actual_sha_ck` CHECK(`actual_sha256` IS NULL OR (length(`actual_sha256`) = 64 AND `actual_sha256` NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT `material_import_files_actual_size_ck` CHECK(`actual_size_bytes` IS NULL OR `actual_size_bytes` > 0),
	CONSTRAINT `material_import_files_storage_status_ck` CHECK(`storage_status` IN ('UPLOAD_PENDING','STORED','RECONCILIATION_REQUIRED','STORAGE_FAILED','DELETE_PENDING','DELETED')),
	CONSTRAINT `material_import_files_security_status_ck` CHECK(`security_check_status` IN ('NOT_STARTED','PENDING','BASIC_CHECK_PASSED','REJECTED')),
	CONSTRAINT `material_import_files_stored_metadata_ck` CHECK(`storage_status` <> 'STORED' OR (`detected_file_type` IS NOT NULL AND `actual_sha256` IS NOT NULL AND `actual_size_bytes` > 0 AND `uploaded_at` IS NOT NULL)),
	CONSTRAINT `material_import_files_ready_ck` CHECK(`security_check_status` <> 'BASIC_CHECK_PASSED' OR (`storage_status` IN ('STORED','DELETE_PENDING','DELETED') AND `detected_file_type` IS NOT NULL AND `actual_sha256` IS NOT NULL AND `actual_size_bytes` > 0)),
	CONSTRAINT `material_import_files_security_failure_ck` CHECK((`security_check_status` = 'REJECTED' AND length(trim(`security_failure_code`)) > 0) OR (`security_check_status` <> 'REJECTED' AND `security_failure_code` IS NULL AND `security_failure_message` IS NULL))
);--> statement-breakpoint
INSERT INTO `material_import_files` SELECT * FROM `__normalization_backup_files`;--> statement-breakpoint
DROP TABLE `__normalization_backup_files`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_files_batch_uq` ON `material_import_files` (`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_files_object_key_uq` ON `material_import_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `material_import_files_sha_idx` ON `material_import_files` (`actual_sha256`,`batch_id`);--> statement-breakpoint
CREATE INDEX `material_import_files_storage_idx` ON `material_import_files` (`storage_status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `batch_id` integer NOT NULL, `parse_run_id` integer NOT NULL, `sheet_index` integer NOT NULL, `sheet_name` text NOT NULL, `row_number` integer NOT NULL, `raw_values_json` text NOT NULL, `raw_row_hash` text NOT NULL, `created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_rows_position_uq` UNIQUE(`parse_run_id`,`sheet_index`,`row_number`),
	CONSTRAINT `material_import_rows_position_ck` CHECK(`sheet_index` >= 0 AND `row_number` > 0 AND length(`sheet_name`) > 0),
	CONSTRAINT `material_import_rows_values_ck` CHECK(json_valid(`raw_values_json`) AND json_type(`raw_values_json`) = 'object'),
	CONSTRAINT `material_import_rows_sha_ck` CHECK(length(`raw_row_hash`) = 64 AND `raw_row_hash` NOT GLOB '*[^0-9a-f]*')
);--> statement-breakpoint
INSERT INTO `material_import_rows` SELECT * FROM `__normalization_backup_rows`;--> statement-breakpoint
DROP TABLE `__normalization_backup_rows`;--> statement-breakpoint
CREATE INDEX `material_import_rows_batch_run_idx` ON `material_import_rows` (`batch_id`,`parse_run_id`,`sheet_index`,`row_number`);--> statement-breakpoint
CREATE TABLE `material_import_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `batch_id` integer NOT NULL, `parse_run_id` integer NOT NULL, `selected_sheet_index` integer NOT NULL, `header_mode` text NOT NULL, `header_row_number` integer, `mapping_status` text DEFAULT 'DRAFT' NOT NULL, `mapping_version` integer DEFAULT 1 NOT NULL, `metadata_digest` text NOT NULL, `suggestion_algorithm_version` text, `supersedes_mapping_id` integer, `created_by` text NOT NULL, `updated_by` text NOT NULL, `confirmed_by` text, `created_at` text NOT NULL, `updated_at` text NOT NULL, `confirmed_at` text,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_mapping_id`) REFERENCES `material_import_mappings`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_mappings_header_ck` CHECK((`header_mode`='SINGLE_ROW' AND `header_row_number` > 0) OR (`header_mode`='NO_HEADER' AND `header_row_number` IS NULL)),
	CONSTRAINT `material_import_mappings_status_ck` CHECK(`mapping_status` IN ('DRAFT','CONFIRMED','STALE','SUPERSEDED')),
	CONSTRAINT `material_import_mappings_values_ck` CHECK(`selected_sheet_index` >= 0 AND `mapping_version` > 0),
	CONSTRAINT `material_import_mappings_digest_ck` CHECK(length(`metadata_digest`) = 64 AND `metadata_digest` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `material_import_mappings_confirm_ck` CHECK((`mapping_status`='CONFIRMED' AND `confirmed_by` IS NOT NULL AND `confirmed_at` IS NOT NULL) OR (`mapping_status`<>'CONFIRMED'))
);--> statement-breakpoint
INSERT INTO `material_import_mappings` SELECT * FROM `__normalization_backup_mappings`;--> statement-breakpoint
DROP TABLE `__normalization_backup_mappings`;--> statement-breakpoint
CREATE INDEX `material_import_mappings_batch_run_idx` ON `material_import_mappings` (`batch_id`,`parse_run_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_mappings_current_uq` ON `material_import_mappings` (`parse_run_id`) WHERE `mapping_status` <> 'SUPERSEDED';--> statement-breakpoint
CREATE TABLE `material_import_mapping_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `mapping_id` integer NOT NULL, `source_column_index` integer, `source_header` text, `target_namespace` text NOT NULL, `target_code` text NOT NULL, `mapping_mode` text NOT NULL, `default_value_json` text, `required` integer DEFAULT 0 NOT NULL, `display_order` integer NOT NULL,
	FOREIGN KEY (`mapping_id`) REFERENCES `material_import_mappings`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_mapping_items_namespace_ck` CHECK(`target_namespace` IN ('basic','attribute','category_hint','supplier_reference','ignore')),
	CONSTRAINT `material_import_mapping_items_mode_ck` CHECK(`mapping_mode` IN ('SOURCE','SOURCE_WITH_DEFAULT','DEFAULT','IGNORE')),
	CONSTRAINT `material_import_mapping_items_source_ck` CHECK((`mapping_mode`='DEFAULT' AND `source_column_index` IS NULL) OR (`mapping_mode`<>'DEFAULT' AND `source_column_index` >= 0)),
	CONSTRAINT `material_import_mapping_items_default_ck` CHECK(`default_value_json` IS NULL OR json_valid(`default_value_json`)),
	CONSTRAINT `material_import_mapping_items_values_ck` CHECK(`required` IN (0,1) AND `display_order` >= 0)
);--> statement-breakpoint
INSERT INTO `material_import_mapping_items` SELECT * FROM `__normalization_backup_mapping_items`;--> statement-breakpoint
DROP TABLE `__normalization_backup_mapping_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_mapping_items_source_uq` ON `material_import_mapping_items` (`mapping_id`,`source_column_index`) WHERE `source_column_index` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_mapping_items_target_uq` ON `material_import_mapping_items` (`mapping_id`,`target_namespace`,`target_code`) WHERE `target_namespace` <> 'ignore';--> statement-breakpoint
CREATE TABLE `material_import_idempotency` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `username` text NOT NULL, `method` text NOT NULL, `route_scope` text NOT NULL, `key_digest` text NOT NULL, `request_digest` text NOT NULL, `operation_id` text NOT NULL, `state` text NOT NULL, `batch_id` integer, `file_id` integer, `lease_token_digest` text NOT NULL, `lease_expires_at` integer, `status_code` integer, `response_json` text, `created_at` text NOT NULL, `updated_at` text NOT NULL, `expires_at` integer, `recovery_until` integer NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict, FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict, FOREIGN KEY (`file_id`) REFERENCES `material_import_files`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_idempotency_method_ck` CHECK(`method` IN ('POST','PUT')),
	CONSTRAINT `material_import_idempotency_route_ck` CHECK(length(`route_scope`) BETWEEN 1 AND 255),
	CONSTRAINT `material_import_idempotency_digest_ck` CHECK(length(`key_digest`)=64 AND length(`request_digest`)=64 AND length(`lease_token_digest`)=64),
	CONSTRAINT `material_import_idempotency_operation_ck` CHECK(length(`operation_id`)=36),
	CONSTRAINT `material_import_idempotency_state_ck` CHECK(`state` IN ('PENDING','COMPLETED')),
	CONSTRAINT `material_import_idempotency_result_ck` CHECK((`state`='PENDING' AND `lease_expires_at`>0 AND `status_code` IS NULL AND `response_json` IS NULL AND `expires_at` IS NULL) OR (`state`='COMPLETED' AND `lease_expires_at` IS NULL AND `status_code` BETWEEN 100 AND 599 AND json_valid(`response_json`) AND `expires_at`>0)),
	CONSTRAINT `material_import_idempotency_recovery_ck` CHECK(`recovery_until`>0)
);--> statement-breakpoint
INSERT INTO `material_import_idempotency` SELECT * FROM `__normalization_backup_idempotency`;--> statement-breakpoint
DROP TABLE `__normalization_backup_idempotency`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_idempotency_scope_uq` ON `material_import_idempotency` (`username`,`method`,`route_scope`,`key_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_idempotency_operation_uq` ON `material_import_idempotency` (`operation_id`);--> statement-breakpoint
CREATE INDEX `material_import_idempotency_recovery_idx` ON `material_import_idempotency` (`state`,`recovery_until`,`id`);--> statement-breakpoint
CREATE TABLE `__new_material_import_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_identifier` text,
	`previous_status` text,
	`new_status` text,
	`request_id` text NOT NULL,
	`safe_details_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_events_type_ck" CHECK("__new_material_import_events"."event_type" IN ('BATCH_CREATED','FILE_UPLOAD_STARTED','FILE_STORED','FILE_UPLOAD_COMPLETED','FILE_UPLOAD_FAILED','FILE_SECURITY_CHECK_PASSED','FILE_SECURITY_CHECK_FAILED','RECONCILIATION_REQUIRED','BATCH_CANCELLED','FILE_DELETE_REQUESTED','FILE_DELETED','FILE_DELETE_FAILED','PARSE_QUEUED','PARSE_STARTED','PARSE_PUBLISHED','PARSE_FAILED','MAPPING_PREPARATION_READY','MAPPING_PREPARATION_FAILED','MAPPING_SAVED','MAPPING_CONFIRMED','NORMALIZATION_QUEUED','NORMALIZATION_STARTED','NORMALIZATION_PUBLISHED','NORMALIZATION_FAILED','NORMALIZATION_CANCELLED','NORMALIZATION_CLEANUP_FAILED')),
	CONSTRAINT "material_import_events_actor_ck" CHECK("__new_material_import_events"."actor_type" IN ('USER','SYSTEM')),
	CONSTRAINT "material_import_events_status_ck" CHECK(("__new_material_import_events"."previous_status" IS NULL OR "__new_material_import_events"."previous_status" IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')) AND ("__new_material_import_events"."new_status" IS NULL OR "__new_material_import_events"."new_status" IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))),
	CONSTRAINT "material_import_events_details_ck" CHECK("__new_material_import_events"."safe_details_json" IS NULL OR json_valid("__new_material_import_events"."safe_details_json"))
);
--> statement-breakpoint
INSERT INTO `__new_material_import_events`("id", "batch_id", "event_type", "actor_type", "actor_identifier", "previous_status", "new_status", "request_id", "safe_details_json", "created_at") SELECT "id", "batch_id", "event_type", "actor_type", "actor_identifier", "previous_status", "new_status", "request_id", "safe_details_json", "created_at" FROM `__normalization_backup_events`;--> statement-breakpoint
DROP TABLE `__normalization_backup_events`;--> statement-breakpoint
ALTER TABLE `__new_material_import_events` RENAME TO `material_import_events`;--> statement-breakpoint
CREATE INDEX `material_import_events_batch_created_idx` ON `material_import_events` (`batch_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `__new_material_import_job_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` integer NOT NULL,
	`parse_run_id` integer,
	`normalization_run_id` integer,
	`job_type` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`dispatch_status` text DEFAULT 'PENDING' NOT NULL,
	`dispatch_version` integer DEFAULT 1 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`last_attempt_at` integer,
	`safe_failure_code` text,
	`created_at` text NOT NULL,
	`dispatched_at` text,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalization_run_id`) REFERENCES `material_import_normalization_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_job_outbox_type_ck" CHECK("__new_material_import_job_outbox"."job_type" IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION','START_NORMALIZATION','NORMALIZE_ROW_CHUNK','VERIFY_NORMALIZATION','PUBLISH_NORMALIZATION')),
	CONSTRAINT "material_import_job_outbox_subject_ck" CHECK(("__new_material_import_job_outbox"."parse_run_id" IS NOT NULL AND "__new_material_import_job_outbox"."normalization_run_id" IS NULL AND "__new_material_import_job_outbox"."job_type" IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION')) OR ("__new_material_import_job_outbox"."parse_run_id" IS NULL AND "__new_material_import_job_outbox"."normalization_run_id" IS NOT NULL AND "__new_material_import_job_outbox"."job_type" IN ('START_NORMALIZATION','NORMALIZE_ROW_CHUNK','VERIFY_NORMALIZATION','PUBLISH_NORMALIZATION'))),
	CONSTRAINT "material_import_job_outbox_status_ck" CHECK("__new_material_import_job_outbox"."dispatch_status" IN ('PENDING','DISPATCHING','DISPATCHED','RETRY_WAIT','DEAD')),
	CONSTRAINT "material_import_job_outbox_counts_ck" CHECK("__new_material_import_job_outbox"."payload_version">0 AND "__new_material_import_job_outbox"."dispatch_version">0 AND "__new_material_import_job_outbox"."attempt_count">=0 AND "__new_material_import_job_outbox"."available_at">0),
	CONSTRAINT "material_import_job_outbox_json_ck" CHECK(json_valid("__new_material_import_job_outbox"."payload_json") AND json_type("__new_material_import_job_outbox"."payload_json")='object')
);
--> statement-breakpoint
INSERT INTO `__new_material_import_job_outbox`("id", "batch_id", "parse_run_id", "normalization_run_id", "job_type", "payload_version", "payload_json", "dispatch_status", "dispatch_version", "attempt_count", "available_at", "last_attempt_at", "safe_failure_code", "created_at", "dispatched_at") SELECT "id", "batch_id", "parse_run_id", NULL, "job_type", "payload_version", "payload_json", "dispatch_status", "dispatch_version", "attempt_count", "available_at", "last_attempt_at", "safe_failure_code", "created_at", "dispatched_at" FROM `__normalization_backup_job_outbox`;--> statement-breakpoint
DROP TABLE `__normalization_backup_job_outbox`;--> statement-breakpoint
ALTER TABLE `__new_material_import_job_outbox` RENAME TO `material_import_job_outbox`;--> statement-breakpoint
CREATE INDEX `material_import_job_outbox_pending_idx` ON `material_import_job_outbox` (`dispatch_status`,`available_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_job_outbox_parse_stage_uq` ON `material_import_job_outbox` (`parse_run_id`,`job_type`,json_extract(`payload_json`,'$.sheet_index')) WHERE `parse_run_id` IS NOT NULL AND `dispatch_status`<>'DEAD';--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_job_outbox_normalization_stage_uq` ON `material_import_job_outbox` (`normalization_run_id`,`job_type`,COALESCE(json_extract(`payload_json`,'$.after_row_number'),-1)) WHERE `normalization_run_id` IS NOT NULL AND `dispatch_status`<>'DEAD';--> statement-breakpoint

CREATE TRIGGER `material_import_batches_current_normalization_insert_ck`
BEFORE INSERT ON `material_import_batches`
WHEN NEW.current_normalization_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_normalization_runs r
    WHERE r.id=NEW.current_normalization_run_id AND r.batch_id=NEW.id AND r.run_status='SUCCEEDED'
  ) THEN RAISE(ABORT,'invalid current normalization run') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_batches_current_normalization_update_ck`
BEFORE UPDATE OF current_normalization_run_id,status ON `material_import_batches`
WHEN NEW.current_normalization_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_normalization_runs r
    WHERE r.id=NEW.current_normalization_run_id AND r.batch_id=NEW.id AND r.run_status='SUCCEEDED'
  ) THEN RAISE(ABORT,'invalid current normalization run') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_normalization_runs_current_guard_ck`
BEFORE UPDATE OF run_status ON `material_import_normalization_runs`
WHEN NEW.run_status<>'SUCCEEDED'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM material_import_batches b WHERE b.current_normalization_run_id=OLD.id
  ) THEN RAISE(ABORT,'current normalization run must remain succeeded') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_normalization_runs_binding_insert_ck`
BEFORE INSERT ON `material_import_normalization_runs`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_batches b
    JOIN material_import_parse_runs p ON p.id=NEW.parse_run_id AND p.batch_id=b.id
    JOIN material_import_mappings m ON m.id=NEW.mapping_id AND m.batch_id=b.id AND m.parse_run_id=p.id
    WHERE b.id=NEW.batch_id
  ) THEN RAISE(ABORT,'normalization run binding mismatch') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_normalization_runs_binding_update_ck`
BEFORE UPDATE OF batch_id,parse_run_id,mapping_id ON `material_import_normalization_runs`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_batches b
    JOIN material_import_parse_runs p ON p.id=NEW.parse_run_id AND p.batch_id=b.id
    JOIN material_import_mappings m ON m.id=NEW.mapping_id AND m.batch_id=b.id AND m.parse_run_id=p.id
    WHERE b.id=NEW.batch_id
  ) THEN RAISE(ABORT,'normalization run binding mismatch') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_normalized_rows_binding_insert_ck`
BEFORE INSERT ON `material_import_normalized_rows`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_normalization_runs r
    WHERE r.id=NEW.normalization_run_id AND r.batch_id=NEW.batch_id AND r.parse_run_id=NEW.parse_run_id
  ) THEN RAISE(ABORT,'normalized row binding mismatch') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_normalized_rows_binding_update_ck`
BEFORE UPDATE OF batch_id,normalization_run_id,parse_run_id ON `material_import_normalized_rows`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_normalization_runs r
    WHERE r.id=NEW.normalization_run_id AND r.batch_id=NEW.batch_id AND r.parse_run_id=NEW.parse_run_id
  ) THEN RAISE(ABORT,'normalized row binding mismatch') END;
END;--> statement-breakpoint
CREATE TRIGGER `material_import_normalization_issues_binding_insert_ck`
BEFORE INSERT ON `material_import_normalization_issues`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_normalized_rows r
    WHERE r.id=NEW.normalized_row_id AND r.normalization_run_id=NEW.normalization_run_id
      AND r.source_sheet_index=NEW.source_sheet_index AND r.source_row_number=NEW.source_row_number
  ) THEN RAISE(ABORT,'normalization issue binding mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `material_import_normalization_issues_binding_update_ck`
BEFORE UPDATE OF normalization_run_id,normalized_row_id,source_sheet_index,source_row_number ON `material_import_normalization_issues`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM material_import_normalized_rows r
    WHERE r.id=NEW.normalized_row_id AND r.normalization_run_id=NEW.normalization_run_id
      AND r.source_sheet_index=NEW.source_sheet_index AND r.source_row_number=NEW.source_row_number
  ) THEN RAISE(ABORT,'normalization issue binding mismatch') END;
END;
