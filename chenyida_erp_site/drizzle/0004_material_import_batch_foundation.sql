CREATE TABLE `material_import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_no` text NOT NULL,
	`source_kind` text NOT NULL,
	`status` text NOT NULL,
	`retry_of_batch_id` integer,
	`created_by` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
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
	FOREIGN KEY (`retry_of_batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cancelled_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_batches_source_ck" CHECK("material_import_batches"."source_kind" IN ('XLSX','CSV')),
	CONSTRAINT "material_import_batches_status_ck" CHECK("material_import_batches"."status" IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED')),
	CONSTRAINT "material_import_batches_version_ck" CHECK("material_import_batches"."current_version" > 0),
	CONSTRAINT "material_import_batches_counts_ck" CHECK("material_import_batches"."file_count" BETWEEN 0 AND 1 AND "material_import_batches"."total_rows" >= 0 AND "material_import_batches"."accepted_rows" >= 0 AND "material_import_batches"."rejected_rows" >= 0 AND "material_import_batches"."accepted_rows" + "material_import_batches"."rejected_rows" <= "material_import_batches"."total_rows"),
	CONSTRAINT "material_import_batches_retry_ck" CHECK("material_import_batches"."retry_of_batch_id" IS NULL OR "material_import_batches"."retry_of_batch_id" <> "material_import_batches"."id"),
	CONSTRAINT "material_import_batches_failure_ck" CHECK(("material_import_batches"."status" = 'FAILED' AND length(trim("material_import_batches"."failure_stage")) > 0 AND length(trim("material_import_batches"."failure_code")) > 0) OR ("material_import_batches"."status" <> 'FAILED' AND "material_import_batches"."failure_stage" IS NULL AND "material_import_batches"."failure_code" IS NULL AND "material_import_batches"."failure_message" IS NULL)),
	CONSTRAINT "material_import_batches_cancel_ck" CHECK(("material_import_batches"."status" = 'CANCELLED' AND "material_import_batches"."cancelled_by" IS NOT NULL AND "material_import_batches"."cancelled_at" IS NOT NULL) OR ("material_import_batches"."status" <> 'CANCELLED' AND "material_import_batches"."cancelled_by" IS NULL AND "material_import_batches"."cancelled_at" IS NULL)),
	CONSTRAINT "material_import_batches_terminal_ck" CHECK(("material_import_batches"."status" IN ('FAILED','CANCELLED') AND "material_import_batches"."terminal_at" IS NOT NULL AND "material_import_batches"."raw_data_retention_until" IS NOT NULL AND "material_import_batches"."record_retention_until" IS NOT NULL) OR ("material_import_batches"."status" NOT IN ('FAILED','CANCELLED') AND "material_import_batches"."terminal_at" IS NULL AND "material_import_batches"."raw_data_retention_until" IS NULL AND "material_import_batches"."record_retention_until" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_batches_no_uq` ON `material_import_batches` (`batch_no`);--> statement-breakpoint
CREATE INDEX `material_import_batches_owner_created_idx` ON `material_import_batches` (`created_by`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_status_created_idx` ON `material_import_batches` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_retry_idx` ON `material_import_batches` (`retry_of_batch_id`);--> statement-breakpoint
CREATE INDEX `material_import_batches_raw_retention_idx` ON `material_import_batches` (`raw_data_retention_until`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_events` (
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
	CONSTRAINT "material_import_events_type_ck" CHECK("material_import_events"."event_type" IN ('BATCH_CREATED','FILE_UPLOAD_STARTED','FILE_STORED','FILE_UPLOAD_COMPLETED','FILE_UPLOAD_FAILED','FILE_SECURITY_CHECK_PASSED','FILE_SECURITY_CHECK_FAILED','RECONCILIATION_REQUIRED','BATCH_CANCELLED','FILE_DELETE_REQUESTED','FILE_DELETED','FILE_DELETE_FAILED')),
	CONSTRAINT "material_import_events_actor_ck" CHECK("material_import_events"."actor_type" IN ('USER','SYSTEM')),
	CONSTRAINT "material_import_events_status_ck" CHECK(("material_import_events"."previous_status" IS NULL OR "material_import_events"."previous_status" IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED')) AND ("material_import_events"."new_status" IS NULL OR "material_import_events"."new_status" IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))),
	CONSTRAINT "material_import_events_details_ck" CHECK("material_import_events"."safe_details_json" IS NULL OR json_valid("material_import_events"."safe_details_json"))
);
--> statement-breakpoint
CREATE INDEX `material_import_events_batch_created_idx` ON `material_import_events` (`batch_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`filename_extension` text,
	`declared_mime_type` text,
	`declared_sha256` text NOT NULL,
	`declared_size_bytes` integer,
	`detected_file_type` text,
	`actual_sha256` text,
	`actual_size_bytes` integer,
	`object_etag` text,
	`storage_status` text NOT NULL,
	`security_check_status` text NOT NULL,
	`security_failure_code` text,
	`security_failure_message` text,
	`uploaded_at` text,
	`retention_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_files_filename_ck" CHECK(length(trim("material_import_files"."original_filename")) BETWEEN 1 AND 255 AND instr("material_import_files"."original_filename", char(0)) = 0),
	CONSTRAINT "material_import_files_declared_sha_ck" CHECK(length("material_import_files"."declared_sha256") = 64 AND "material_import_files"."declared_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "material_import_files_declared_size_ck" CHECK("material_import_files"."declared_size_bytes" IS NULL OR "material_import_files"."declared_size_bytes" >= 0),
	CONSTRAINT "material_import_files_detected_type_ck" CHECK("material_import_files"."detected_file_type" IS NULL OR "material_import_files"."detected_file_type" IN ('XLSX','CSV')),
	CONSTRAINT "material_import_files_actual_sha_ck" CHECK("material_import_files"."actual_sha256" IS NULL OR (length("material_import_files"."actual_sha256") = 64 AND "material_import_files"."actual_sha256" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "material_import_files_actual_size_ck" CHECK("material_import_files"."actual_size_bytes" IS NULL OR "material_import_files"."actual_size_bytes" > 0),
	CONSTRAINT "material_import_files_storage_status_ck" CHECK("material_import_files"."storage_status" IN ('UPLOAD_PENDING','STORED','RECONCILIATION_REQUIRED','STORAGE_FAILED','DELETE_PENDING','DELETED')),
	CONSTRAINT "material_import_files_security_status_ck" CHECK("material_import_files"."security_check_status" IN ('NOT_STARTED','PENDING','BASIC_CHECK_PASSED','REJECTED')),
	CONSTRAINT "material_import_files_stored_metadata_ck" CHECK("material_import_files"."storage_status" <> 'STORED' OR ("material_import_files"."detected_file_type" IS NOT NULL AND "material_import_files"."actual_sha256" IS NOT NULL AND "material_import_files"."actual_size_bytes" > 0 AND "material_import_files"."uploaded_at" IS NOT NULL)),
	CONSTRAINT "material_import_files_ready_ck" CHECK("material_import_files"."security_check_status" <> 'BASIC_CHECK_PASSED' OR ("material_import_files"."storage_status" IN ('STORED','DELETE_PENDING','DELETED') AND "material_import_files"."detected_file_type" IS NOT NULL AND "material_import_files"."actual_sha256" IS NOT NULL AND "material_import_files"."actual_size_bytes" > 0)),
	CONSTRAINT "material_import_files_security_failure_ck" CHECK(("material_import_files"."security_check_status" = 'REJECTED' AND length(trim("material_import_files"."security_failure_code")) > 0) OR ("material_import_files"."security_check_status" <> 'REJECTED' AND "material_import_files"."security_failure_code" IS NULL AND "material_import_files"."security_failure_message" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_files_batch_uq` ON `material_import_files` (`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_files_object_key_uq` ON `material_import_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `material_import_files_sha_idx` ON `material_import_files` (`actual_sha256`,`batch_id`);--> statement-breakpoint
CREATE INDEX `material_import_files_storage_idx` ON `material_import_files` (`storage_status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_idempotency` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`method` text NOT NULL,
	`route_scope` text NOT NULL,
	`key_digest` text NOT NULL,
	`request_digest` text NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`batch_id` integer,
	`file_id` integer,
	`lease_token_digest` text NOT NULL,
	`lease_expires_at` integer,
	`status_code` integer,
	`response_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` integer,
	`recovery_until` integer NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`file_id`) REFERENCES `material_import_files`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_idempotency_method_ck" CHECK("material_import_idempotency"."method" = 'POST'),
	CONSTRAINT "material_import_idempotency_route_ck" CHECK(length("material_import_idempotency"."route_scope") BETWEEN 1 AND 255),
	CONSTRAINT "material_import_idempotency_digest_ck" CHECK(length("material_import_idempotency"."key_digest") = 64 AND length("material_import_idempotency"."request_digest") = 64 AND length("material_import_idempotency"."lease_token_digest") = 64),
	CONSTRAINT "material_import_idempotency_operation_ck" CHECK(length("material_import_idempotency"."operation_id") = 36),
	CONSTRAINT "material_import_idempotency_state_ck" CHECK("material_import_idempotency"."state" IN ('PENDING','COMPLETED')),
	CONSTRAINT "material_import_idempotency_result_ck" CHECK(("material_import_idempotency"."state" = 'PENDING' AND "material_import_idempotency"."lease_expires_at" > 0 AND "material_import_idempotency"."status_code" IS NULL AND "material_import_idempotency"."response_json" IS NULL AND "material_import_idempotency"."expires_at" IS NULL) OR ("material_import_idempotency"."state" = 'COMPLETED' AND "material_import_idempotency"."lease_expires_at" IS NULL AND "material_import_idempotency"."status_code" BETWEEN 100 AND 599 AND json_valid("material_import_idempotency"."response_json") AND "material_import_idempotency"."expires_at" > 0)),
	CONSTRAINT "material_import_idempotency_recovery_ck" CHECK("material_import_idempotency"."recovery_until" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_idempotency_scope_uq` ON `material_import_idempotency` (`username`,`method`,`route_scope`,`key_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_idempotency_operation_uq` ON `material_import_idempotency` (`operation_id`);--> statement-breakpoint
CREATE INDEX `material_import_idempotency_recovery_idx` ON `material_import_idempotency` (`state`,`recovery_until`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`sheet_index` integer NOT NULL,
	`sheet_name` text NOT NULL,
	`row_number` integer NOT NULL,
	`raw_values_json` text NOT NULL,
	`raw_row_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_rows_position_ck" CHECK("material_import_rows"."sheet_index" >= 0 AND "material_import_rows"."row_number" > 0 AND length("material_import_rows"."sheet_name") > 0),
	CONSTRAINT "material_import_rows_values_ck" CHECK(json_valid("material_import_rows"."raw_values_json") AND json_type("material_import_rows"."raw_values_json") = 'object'),
	CONSTRAINT "material_import_rows_sha_ck" CHECK(length("material_import_rows"."raw_row_sha256") = 64 AND "material_import_rows"."raw_row_sha256" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_rows_position_uq` ON `material_import_rows` (`batch_id`,`sheet_index`,`row_number`);
