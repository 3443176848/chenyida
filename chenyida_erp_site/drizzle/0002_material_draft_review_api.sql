CREATE TABLE `material_api_idempotency` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`method` text NOT NULL,
	`route_scope` text NOT NULL,
	`key_digest` text NOT NULL,
	`request_digest` text NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`lease_token_digest` text NOT NULL,
	`lease_expires_at` integer,
	`status_code` integer,
	`response_json` text,
	`material_id` integer,
	`old_version` integer,
	`new_version` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`username`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_api_idempotency_method_ck" CHECK("material_api_idempotency"."method" = 'POST'),
	CONSTRAINT "material_api_idempotency_route_ck" CHECK(length("material_api_idempotency"."route_scope") BETWEEN 1 AND 255),
	CONSTRAINT "material_api_idempotency_digest_ck" CHECK(length("material_api_idempotency"."key_digest") = 64 AND length("material_api_idempotency"."request_digest") = 64 AND length("material_api_idempotency"."lease_token_digest") = 64),
	CONSTRAINT "material_api_idempotency_operation_ck" CHECK(length("material_api_idempotency"."operation_id") = 36),
	CONSTRAINT "material_api_idempotency_state_ck" CHECK("material_api_idempotency"."state" IN ('PENDING', 'COMPLETED')),
	CONSTRAINT "material_api_idempotency_result_ck" CHECK(("material_api_idempotency"."state" = 'PENDING' AND "material_api_idempotency"."lease_expires_at" > 0 AND "material_api_idempotency"."status_code" IS NULL AND "material_api_idempotency"."response_json" IS NULL AND "material_api_idempotency"."expires_at" IS NULL) OR ("material_api_idempotency"."state" = 'COMPLETED' AND "material_api_idempotency"."lease_expires_at" IS NULL AND "material_api_idempotency"."status_code" BETWEEN 100 AND 599 AND json_valid("material_api_idempotency"."response_json") AND "material_api_idempotency"."expires_at" > 0)),
	CONSTRAINT "material_api_idempotency_versions_ck" CHECK(("material_api_idempotency"."old_version" IS NULL OR "material_api_idempotency"."old_version" >= 0) AND ("material_api_idempotency"."new_version" IS NULL OR "material_api_idempotency"."new_version" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_api_idempotency_scope_uq` ON `material_api_idempotency` (`username`,`method`,`route_scope`,`key_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_api_idempotency_operation_uq` ON `material_api_idempotency` (`operation_id`);--> statement-breakpoint
CREATE INDEX `material_api_idempotency_expiry_idx` ON `material_api_idempotency` (`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `material_api_idempotency_lease_idx` ON `material_api_idempotency` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `material_api_rate_limit_buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`bucket_start` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`new_key_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_token_digest` text DEFAULT '' NOT NULL,
	`last_new_key_token_digest` text DEFAULT '' NOT NULL,
	`first_rejected_at` text,
	`last_rejected_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_api_rate_limit_bucket_ck" CHECK("material_api_rate_limit_buckets"."bucket_start" >= 0),
	CONSTRAINT "material_api_rate_limit_counts_ck" CHECK("material_api_rate_limit_buckets"."attempt_count" BETWEEN 0 AND 60 AND "material_api_rate_limit_buckets"."new_key_count" BETWEEN 0 AND 20 AND "material_api_rate_limit_buckets"."rejected_count" >= 0),
	CONSTRAINT "material_api_rate_limit_digest_ck" CHECK(("material_api_rate_limit_buckets"."last_attempt_token_digest" = '' OR length("material_api_rate_limit_buckets"."last_attempt_token_digest") = 64) AND ("material_api_rate_limit_buckets"."last_new_key_token_digest" = '' OR length("material_api_rate_limit_buckets"."last_new_key_token_digest") = 64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_api_rate_limit_user_bucket_uq` ON `material_api_rate_limit_buckets` (`username`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `material_api_rate_limit_cleanup_idx` ON `material_api_rate_limit_buckets` (`bucket_start`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`result` text DEFAULT 'success' NOT NULL,
	`route_code` text DEFAULT '' NOT NULL,
	`material_id` integer,
	`operation_id` text DEFAULT '' NOT NULL,
	`idempotency_key_digest` text DEFAULT '' NOT NULL,
	`old_version` integer,
	`new_version` integer,
	`error_code` text DEFAULT '' NOT NULL,
	`retention_until` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "audit_log_operation_id_ck" CHECK("__new_audit_log"."operation_id" = '' OR length("__new_audit_log"."operation_id") = 36),
	CONSTRAINT "audit_log_key_digest_ck" CHECK("__new_audit_log"."idempotency_key_digest" = '' OR length("__new_audit_log"."idempotency_key_digest") = 64),
	CONSTRAINT "audit_log_versions_ck" CHECK(("__new_audit_log"."old_version" IS NULL OR "__new_audit_log"."old_version" >= 0) AND ("__new_audit_log"."new_version" IS NULL OR "__new_audit_log"."new_version" > 0)),
	CONSTRAINT "audit_log_retention_ck" CHECK("__new_audit_log"."retention_until" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "username", "action", "detail", "request_id", "result", "route_code", "material_id", "operation_id", "idempotency_key_digest", "old_version", "new_version", "error_code", "retention_until", "created_at") SELECT "id", "username", "action", "detail", "request_id", "result", '', NULL, '', '', NULL, NULL, '', 0, "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_request_id_idx` ON `audit_log` (`request_id`);--> statement-breakpoint
CREATE INDEX `audit_log_operation_id_idx` ON `audit_log` (`operation_id`);--> statement-breakpoint
CREATE INDEX `audit_log_material_created_idx` ON `audit_log` (`material_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_retention_idx` ON `audit_log` (`retention_until`,`id`);
