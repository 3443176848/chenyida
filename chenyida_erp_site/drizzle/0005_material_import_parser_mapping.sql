PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__parser_backup_files` AS SELECT * FROM `material_import_files`;--> statement-breakpoint
CREATE TABLE `__parser_backup_idempotency` AS SELECT * FROM `material_import_idempotency`;--> statement-breakpoint
CREATE TABLE `__parser_backup_events` AS SELECT * FROM `material_import_events`;--> statement-breakpoint
CREATE TABLE `__parser_backup_rows` AS SELECT * FROM `material_import_rows`;--> statement-breakpoint
CREATE TABLE `material_import_parse_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `batch_id` integer NOT NULL, `parser_version` text NOT NULL, `run_status` text NOT NULL, `attempt_no` integer DEFAULT 1 NOT NULL, `source_file_sha256` text, `lease_token_digest` text, `lease_expires_at` integer, `heartbeat_at` text, `worker_request_id` text, `current_stage` text NOT NULL, `started_at` text, `completed_at` text, `rows_written` integer DEFAULT 0 NOT NULL, `parsed_sheet_count` integer DEFAULT 0 NOT NULL, `normalized_json_bytes` integer DEFAULT 0 NOT NULL, `decoded_text_bytes` integer DEFAULT 0 NOT NULL, `warning_count` integer DEFAULT 0 NOT NULL, `error_count` integer DEFAULT 0 NOT NULL, `failure_code` text, `safe_failure_message` text, `mapping_preparation_status` text DEFAULT 'NOT_STARTED' NOT NULL, `mapping_preparation_attempt_count` integer DEFAULT 0 NOT NULL, `mapping_preparation_failure_code` text, `mapping_preparation_safe_message` text, `mapping_preparation_updated_at` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
	CONSTRAINT `material_import_parse_runs_status_ck` CHECK(`run_status` IN ('QUEUED','RUNNING','STAGED','PUBLISHING','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')),
	CONSTRAINT `material_import_parse_runs_stage_ck` CHECK(`current_stage` IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION','COMPLETE')),
	CONSTRAINT `material_import_parse_runs_counts_ck` CHECK(`attempt_no` > 0 AND `rows_written` >= 0 AND `parsed_sheet_count` >= 0 AND `normalized_json_bytes` >= 0 AND `decoded_text_bytes` >= 0 AND `warning_count` >= 0 AND `error_count` >= 0),
	CONSTRAINT `material_import_parse_runs_sha_ck` CHECK(`source_file_sha256` IS NULL OR (length(`source_file_sha256`) = 64 AND `source_file_sha256` NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT `material_import_parse_runs_lease_ck` CHECK((`lease_token_digest` IS NULL AND `lease_expires_at` IS NULL) OR (length(`lease_token_digest`) = 64 AND `lease_expires_at` > 0)),
	CONSTRAINT `material_import_parse_runs_mapping_status_ck` CHECK(`mapping_preparation_status` IN ('NOT_STARTED','QUEUED','RUNNING','READY','FAILED')),
	CONSTRAINT `material_import_parse_runs_failure_ck` CHECK((`run_status` = 'FAILED' AND length(trim(`failure_code`)) > 0) OR (`run_status` <> 'FAILED' AND `failure_code` IS NULL AND `safe_failure_message` IS NULL)),
	CONSTRAINT `material_import_parse_runs_mapping_failure_ck` CHECK((`mapping_preparation_status` = 'FAILED' AND length(trim(`mapping_preparation_failure_code`)) > 0) OR (`mapping_preparation_status` <> 'FAILED' AND `mapping_preparation_failure_code` IS NULL AND `mapping_preparation_safe_message` IS NULL))
);--> statement-breakpoint
CREATE INDEX `material_import_parse_runs_batch_status_idx` ON `material_import_parse_runs` (`batch_id`,`run_status`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_parse_runs_lease_idx` ON `material_import_parse_runs` (`run_status`,`lease_expires_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_parse_runs_active_uq` ON `material_import_parse_runs` (`batch_id`) WHERE `run_status` IN ('QUEUED','RUNNING','STAGED','PUBLISHING');--> statement-breakpoint
INSERT INTO `material_import_parse_runs`(`batch_id`,`parser_version`,`run_status`,`attempt_no`,`current_stage`,`completed_at`,`rows_written`,`created_at`,`updated_at`)
SELECT r.`batch_id`,'legacy-0004-backfill-v1','SUPERSEDED',1,'COMPLETE',max(r.`created_at`),count(*),min(r.`created_at`),max(r.`created_at`) FROM `__parser_backup_rows` r GROUP BY r.`batch_id`;--> statement-breakpoint
DELETE FROM `material_import_idempotency`;--> statement-breakpoint
DELETE FROM `material_import_events`;--> statement-breakpoint
DELETE FROM `material_import_rows`;--> statement-breakpoint
DELETE FROM `material_import_files`;--> statement-breakpoint
DROP TABLE `material_import_idempotency`;--> statement-breakpoint
DROP TABLE `material_import_events`;--> statement-breakpoint
DROP TABLE `material_import_rows`;--> statement-breakpoint
DROP TABLE `material_import_files`;--> statement-breakpoint
CREATE TABLE `__new_material_import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_no` text NOT NULL,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`retry_of_batch_id` integer,
	`created_by` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`current_parse_run_id` integer,
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
	CONSTRAINT `material_import_batches_source_ck` CHECK(`source_kind` IN ('XLSX','CSV')),
	CONSTRAINT `material_import_batches_status_ck` CHECK(`status` IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')),
	CONSTRAINT `material_import_batches_version_ck` CHECK(`current_version` > 0),
	CONSTRAINT `material_import_batches_counts_ck` CHECK(`file_count` BETWEEN 0 AND 1 AND `total_rows` >= 0 AND `accepted_rows` >= 0 AND `rejected_rows` >= 0 AND `accepted_rows` + `rejected_rows` <= `total_rows`),
	CONSTRAINT `material_import_batches_retry_ck` CHECK(`retry_of_batch_id` IS NULL OR `retry_of_batch_id` <> `id`),
	CONSTRAINT `material_import_batches_failure_ck` CHECK((`status` = 'FAILED' AND length(trim(`failure_stage`)) > 0 AND length(trim(`failure_code`)) > 0) OR (`status` <> 'FAILED' AND `failure_stage` IS NULL AND `failure_code` IS NULL AND `failure_message` IS NULL)),
	CONSTRAINT `material_import_batches_cancel_ck` CHECK((`status` = 'CANCELLED' AND `cancelled_by` IS NOT NULL AND `cancelled_at` IS NOT NULL) OR (`status` <> 'CANCELLED' AND `cancelled_by` IS NULL AND `cancelled_at` IS NULL)),
	CONSTRAINT `material_import_batches_terminal_ck` CHECK((`status` IN ('FAILED','CANCELLED') AND `terminal_at` IS NOT NULL AND `raw_data_retention_until` IS NOT NULL AND `record_retention_until` IS NOT NULL) OR (`status` NOT IN ('FAILED','CANCELLED') AND `terminal_at` IS NULL AND `raw_data_retention_until` IS NULL AND `record_retention_until` IS NULL)),
	CONSTRAINT `material_import_batches_current_run_ck` CHECK((`status` IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED') AND `current_parse_run_id` IS NOT NULL) OR (`status` NOT IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED')))
);--> statement-breakpoint
INSERT INTO `__new_material_import_batches`(`id`,`batch_no`,`source_kind`,`status`,`retry_of_batch_id`,`created_by`,`current_version`,`file_count`,`total_rows`,`accepted_rows`,`rejected_rows`,`failure_stage`,`failure_code`,`failure_message`,`cancelled_by`,`cancelled_at`,`terminal_at`,`raw_data_retention_until`,`record_retention_until`,`created_at`,`updated_at`)
SELECT `id`,`batch_no`,`source_kind`,`status`,`retry_of_batch_id`,`created_by`,`current_version`,`file_count`,`total_rows`,`accepted_rows`,`rejected_rows`,`failure_stage`,`failure_code`,`failure_message`,`cancelled_by`,`cancelled_at`,`terminal_at`,`raw_data_retention_until`,`record_retention_until`,`created_at`,`updated_at` FROM `material_import_batches`;--> statement-breakpoint
DROP TABLE `material_import_batches`;--> statement-breakpoint
ALTER TABLE `__new_material_import_batches` RENAME TO `material_import_batches`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_batches_no_uq` ON `material_import_batches` (`batch_no`);--> statement-breakpoint
CREATE INDEX `material_import_batches_owner_created_idx` ON `material_import_batches` (`created_by`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_status_created_idx` ON `material_import_batches` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_retry_idx` ON `material_import_batches` (`retry_of_batch_id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_raw_retention_idx` ON `material_import_batches` (`raw_data_retention_until`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_current_run_idx` ON `material_import_batches` (`current_parse_run_id`);--> statement-breakpoint
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
INSERT INTO `material_import_files` SELECT * FROM `__parser_backup_files`;--> statement-breakpoint
DROP TABLE `__parser_backup_files`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_files_batch_uq` ON `material_import_files` (`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_files_object_key_uq` ON `material_import_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `material_import_files_sha_idx` ON `material_import_files` (`actual_sha256`,`batch_id`);--> statement-breakpoint
CREATE INDEX `material_import_files_storage_idx` ON `material_import_files` (`storage_status`,`updated_at`,`id`);--> statement-breakpoint
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
CREATE TABLE `material_import_parse_sheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `parse_run_id` integer NOT NULL, `sheet_index` integer NOT NULL, `sheet_name` text NOT NULL, `visibility` text NOT NULL, `parse_status` text NOT NULL, `row_count` integer DEFAULT 0 NOT NULL, `source_column_max` integer DEFAULT 0 NOT NULL, `merged_ranges_json` text, `warning_count` integer DEFAULT 0 NOT NULL, `safe_warnings_json` text, `started_at` text, `completed_at` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_parse_sheets_position_uq` UNIQUE(`parse_run_id`,`sheet_index`),
	CONSTRAINT `material_import_parse_sheets_visibility_ck` CHECK(`visibility` IN ('VISIBLE','HIDDEN','VERY_HIDDEN')),
	CONSTRAINT `material_import_parse_sheets_status_ck` CHECK(`parse_status` IN ('PENDING','RUNNING','COMPLETED','SKIPPED_HIDDEN','SKIPPED_VERY_HIDDEN','FAILED')),
	CONSTRAINT `material_import_parse_sheets_counts_ck` CHECK(`sheet_index` >= 0 AND `row_count` >= 0 AND `source_column_max` >= 0 AND `warning_count` >= 0),
	CONSTRAINT `material_import_parse_sheets_json_ck` CHECK((`merged_ranges_json` IS NULL OR json_valid(`merged_ranges_json`)) AND (`safe_warnings_json` IS NULL OR json_valid(`safe_warnings_json`)))
);--> statement-breakpoint
CREATE INDEX `material_import_parse_sheets_run_status_idx` ON `material_import_parse_sheets` (`parse_run_id`,`parse_status`,`sheet_index`);--> statement-breakpoint
CREATE TABLE `material_import_shared_string_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `parse_run_id` integer NOT NULL, `chunk_index` integer NOT NULL, `start_string_index` integer NOT NULL, `item_count` integer NOT NULL, `decoded_bytes` integer NOT NULL, `values_json` text NOT NULL, `created_at` text NOT NULL,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_shared_string_chunks_position_uq` UNIQUE(`parse_run_id`,`chunk_index`),
	CONSTRAINT `material_import_shared_string_chunks_counts_ck` CHECK(`chunk_index` >= 0 AND `start_string_index` >= 0 AND `item_count` > 0 AND `decoded_bytes` >= 0),
	CONSTRAINT `material_import_shared_string_chunks_json_ck` CHECK(json_valid(`values_json`) AND json_type(`values_json`) = 'array')
);--> statement-breakpoint
CREATE INDEX `material_import_shared_string_chunks_lookup_idx` ON `material_import_shared_string_chunks` (`parse_run_id`,`start_string_index`);--> statement-breakpoint
CREATE TABLE `material_import_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `batch_id` integer NOT NULL, `parse_run_id` integer NOT NULL, `sheet_index` integer NOT NULL, `sheet_name` text NOT NULL, `row_number` integer NOT NULL, `raw_values_json` text NOT NULL, `raw_row_hash` text NOT NULL, `created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_rows_position_uq` UNIQUE(`parse_run_id`,`sheet_index`,`row_number`),
	CONSTRAINT `material_import_rows_position_ck` CHECK(`sheet_index` >= 0 AND `row_number` > 0 AND length(`sheet_name`) > 0),
	CONSTRAINT `material_import_rows_values_ck` CHECK(json_valid(`raw_values_json`) AND json_type(`raw_values_json`) = 'object'),
	CONSTRAINT `material_import_rows_sha_ck` CHECK(length(`raw_row_hash`) = 64 AND `raw_row_hash` NOT GLOB '*[^0-9a-f]*')
);--> statement-breakpoint
INSERT INTO `material_import_rows`(`id`,`batch_id`,`parse_run_id`,`sheet_index`,`sheet_name`,`row_number`,`raw_values_json`,`raw_row_hash`,`created_at`)
SELECT r.`id`,r.`batch_id`,p.`id`,r.`sheet_index`,r.`sheet_name`,r.`row_number`,r.`raw_values_json`,r.`raw_row_sha256`,r.`created_at` FROM `__parser_backup_rows` r JOIN `material_import_parse_runs` p ON p.`batch_id`=r.`batch_id` AND p.`parser_version`='legacy-0004-backfill-v1';--> statement-breakpoint
DROP TABLE `__parser_backup_rows`;--> statement-breakpoint
CREATE INDEX `material_import_rows_batch_run_idx` ON `material_import_rows` (`batch_id`,`parse_run_id`,`sheet_index`,`row_number`);--> statement-breakpoint
CREATE TABLE `material_import_header_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `parse_run_id` integer NOT NULL, `sheet_index` integer NOT NULL, `row_number` integer NOT NULL, `rank` integer NOT NULL, `score` real NOT NULL, `reason_codes_json` text NOT NULL, `algorithm_version` text NOT NULL, `metadata_digest` text NOT NULL, `created_at` text NOT NULL,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_header_suggestions_position_uq` UNIQUE(`parse_run_id`,`sheet_index`,`row_number`,`algorithm_version`),
	CONSTRAINT `material_import_header_suggestions_values_ck` CHECK(`sheet_index` >= 0 AND `row_number` > 0 AND `rank` > 0 AND `score` BETWEEN 0 AND 1),
	CONSTRAINT `material_import_header_suggestions_json_ck` CHECK(json_valid(`reason_codes_json`) AND json_type(`reason_codes_json`) = 'array'),
	CONSTRAINT `material_import_header_suggestions_digest_ck` CHECK(length(`metadata_digest`) = 64 AND `metadata_digest` NOT GLOB '*[^0-9a-f]*')
);--> statement-breakpoint
CREATE INDEX `material_import_header_suggestions_rank_idx` ON `material_import_header_suggestions` (`parse_run_id`,`sheet_index`,`rank`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_job_outbox` (
	`id` text PRIMARY KEY NOT NULL, `batch_id` integer NOT NULL, `parse_run_id` integer NOT NULL, `job_type` text NOT NULL, `payload_version` integer DEFAULT 1 NOT NULL, `payload_json` text NOT NULL, `dispatch_status` text DEFAULT 'PENDING' NOT NULL, `dispatch_version` integer DEFAULT 1 NOT NULL, `attempt_count` integer DEFAULT 0 NOT NULL, `available_at` integer NOT NULL, `last_attempt_at` integer, `safe_failure_code` text, `created_at` text NOT NULL, `dispatched_at` text,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parse_run_id`) REFERENCES `material_import_parse_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_job_outbox_type_ck` CHECK(`job_type` IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION')),
	CONSTRAINT `material_import_job_outbox_status_ck` CHECK(`dispatch_status` IN ('PENDING','DISPATCHING','DISPATCHED','RETRY_WAIT','DEAD')),
	CONSTRAINT `material_import_job_outbox_counts_ck` CHECK(`payload_version` > 0 AND `dispatch_version` > 0 AND `attempt_count` >= 0 AND `available_at` > 0),
	CONSTRAINT `material_import_job_outbox_json_ck` CHECK(json_valid(`payload_json`) AND json_type(`payload_json`) = 'object')
);--> statement-breakpoint
CREATE INDEX `material_import_job_outbox_pending_idx` ON `material_import_job_outbox` (`dispatch_status`,`available_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_job_outbox_stage_uq` ON `material_import_job_outbox` (`parse_run_id`,`job_type`,json_extract(`payload_json`,'$.sheet_index')) WHERE `dispatch_status` <> 'DEAD';--> statement-breakpoint
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
CREATE UNIQUE INDEX `material_import_mapping_items_source_uq` ON `material_import_mapping_items` (`mapping_id`,`source_column_index`) WHERE `source_column_index` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_mapping_items_target_uq` ON `material_import_mapping_items` (`mapping_id`,`target_namespace`,`target_code`) WHERE `target_namespace` <> 'ignore';--> statement-breakpoint
CREATE TABLE `material_import_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `batch_id` integer NOT NULL, `event_type` text NOT NULL, `actor_type` text NOT NULL, `actor_identifier` text, `previous_status` text, `new_status` text, `request_id` text NOT NULL, `safe_details_json` text, `created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_events_type_ck` CHECK(`event_type` IN ('BATCH_CREATED','FILE_UPLOAD_STARTED','FILE_STORED','FILE_UPLOAD_COMPLETED','FILE_UPLOAD_FAILED','FILE_SECURITY_CHECK_PASSED','FILE_SECURITY_CHECK_FAILED','RECONCILIATION_REQUIRED','BATCH_CANCELLED','FILE_DELETE_REQUESTED','FILE_DELETED','FILE_DELETE_FAILED','PARSE_QUEUED','PARSE_STARTED','PARSE_PUBLISHED','PARSE_FAILED','MAPPING_PREPARATION_READY','MAPPING_PREPARATION_FAILED','MAPPING_SAVED','MAPPING_CONFIRMED')),
	CONSTRAINT `material_import_events_actor_ck` CHECK(`actor_type` IN ('USER','SYSTEM')),
	CONSTRAINT `material_import_events_status_ck` CHECK((`previous_status` IS NULL OR `previous_status` IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')) AND (`new_status` IS NULL OR `new_status` IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))),
	CONSTRAINT `material_import_events_details_ck` CHECK(`safe_details_json` IS NULL OR json_valid(`safe_details_json`))
);--> statement-breakpoint
INSERT INTO `material_import_events` SELECT * FROM `__parser_backup_events`;--> statement-breakpoint
DROP TABLE `__parser_backup_events`;--> statement-breakpoint
CREATE INDEX `material_import_events_batch_created_idx` ON `material_import_events` (`batch_id`,`created_at`,`id`);--> statement-breakpoint
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
INSERT INTO `material_import_idempotency` SELECT * FROM `__parser_backup_idempotency`;--> statement-breakpoint
DROP TABLE `__parser_backup_idempotency`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_idempotency_scope_uq` ON `material_import_idempotency` (`username`,`method`,`route_scope`,`key_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_idempotency_operation_uq` ON `material_import_idempotency` (`operation_id`);--> statement-breakpoint
CREATE INDEX `material_import_idempotency_recovery_idx` ON `material_import_idempotency` (`state`,`recovery_until`,`id`);
