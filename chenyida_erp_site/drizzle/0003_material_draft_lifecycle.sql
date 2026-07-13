CREATE TABLE `material_draft_lifecycle_preflight_guard` (`id` integer NOT NULL);--> statement-breakpoint
INSERT INTO `material_draft_lifecycle_preflight_guard` (`id`)
SELECT CASE WHEN EXISTS (
	SELECT 1
	FROM `material_master` m
	WHERE m.`material_status` = 'PENDING_APPROVAL'
	  AND NOT EXISTS (
		SELECT 1 FROM `material_versions` v
		WHERE v.`material_id` = m.`id`
		  AND v.`event_type` = 'SUBMIT'
		  AND v.`version_no` = m.`version`
		  AND length(trim(v.`changed_by`)) > 0
		  AND v.`created_at` IS NOT NULL
	  )
) THEN NULL ELSE 1 END;--> statement-breakpoint
DROP TABLE `material_draft_lifecycle_preflight_guard`;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_supplier_mapping_price_history` AS SELECT * FROM `supplier_mapping_price_history`;--> statement-breakpoint
DELETE FROM `supplier_mapping_price_history`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_supplier_mappings` AS SELECT * FROM `supplier_mappings`;--> statement-breakpoint
DELETE FROM `supplier_mappings`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_legacy_material_mapping` AS SELECT * FROM `legacy_material_mapping`;--> statement-breakpoint
DELETE FROM `legacy_material_mapping`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_material_aliases` AS SELECT * FROM `material_aliases`;--> statement-breakpoint
DELETE FROM `material_aliases`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_material_attribute_values` AS SELECT * FROM `material_attribute_values`;--> statement-breakpoint
DELETE FROM `material_attribute_values`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_material_change_logs` AS SELECT * FROM `material_change_logs`;--> statement-breakpoint
DELETE FROM `material_change_logs`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_material_versions` AS SELECT * FROM `material_versions`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_material_api_idempotency` AS SELECT * FROM `material_api_idempotency`;--> statement-breakpoint
DELETE FROM `material_api_idempotency`;--> statement-breakpoint
CREATE TABLE `__new_material_api_idempotency` (
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
	CONSTRAINT "material_api_idempotency_method_ck" CHECK("__new_material_api_idempotency"."method" IN ('POST', 'PATCH')),
	CONSTRAINT "material_api_idempotency_route_ck" CHECK(length("__new_material_api_idempotency"."route_scope") BETWEEN 1 AND 255),
	CONSTRAINT "material_api_idempotency_digest_ck" CHECK(length("__new_material_api_idempotency"."key_digest") = 64 AND length("__new_material_api_idempotency"."request_digest") = 64 AND length("__new_material_api_idempotency"."lease_token_digest") = 64),
	CONSTRAINT "material_api_idempotency_operation_ck" CHECK(length("__new_material_api_idempotency"."operation_id") = 36),
	CONSTRAINT "material_api_idempotency_state_ck" CHECK("__new_material_api_idempotency"."state" IN ('PENDING', 'COMPLETED')),
	CONSTRAINT "material_api_idempotency_result_ck" CHECK(("__new_material_api_idempotency"."state" = 'PENDING' AND "__new_material_api_idempotency"."lease_expires_at" > 0 AND "__new_material_api_idempotency"."status_code" IS NULL AND "__new_material_api_idempotency"."response_json" IS NULL AND "__new_material_api_idempotency"."expires_at" IS NULL) OR ("__new_material_api_idempotency"."state" = 'COMPLETED' AND "__new_material_api_idempotency"."lease_expires_at" IS NULL AND "__new_material_api_idempotency"."status_code" BETWEEN 100 AND 599 AND json_valid("__new_material_api_idempotency"."response_json") AND "__new_material_api_idempotency"."expires_at" > 0)),
	CONSTRAINT "material_api_idempotency_versions_ck" CHECK(("__new_material_api_idempotency"."old_version" IS NULL OR "__new_material_api_idempotency"."old_version" >= 0) AND ("__new_material_api_idempotency"."new_version" IS NULL OR "__new_material_api_idempotency"."new_version" > 0))
);
--> statement-breakpoint
INSERT INTO `__new_material_api_idempotency`("id", "username", "method", "route_scope", "key_digest", "request_digest", "operation_id", "state", "lease_token_digest", "lease_expires_at", "status_code", "response_json", "material_id", "old_version", "new_version", "created_at", "updated_at", "expires_at") SELECT "id", "username", "method", "route_scope", "key_digest", "request_digest", "operation_id", "state", "lease_token_digest", "lease_expires_at", "status_code", "response_json", "material_id", "old_version", "new_version", "created_at", "updated_at", "expires_at" FROM `material_api_idempotency`;--> statement-breakpoint
DROP TABLE `material_api_idempotency`;--> statement-breakpoint
ALTER TABLE `__new_material_api_idempotency` RENAME TO `material_api_idempotency`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_api_idempotency_scope_uq` ON `material_api_idempotency` (`username`,`method`,`route_scope`,`key_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_api_idempotency_operation_uq` ON `material_api_idempotency` (`operation_id`);--> statement-breakpoint
CREATE INDEX `material_api_idempotency_expiry_idx` ON `material_api_idempotency` (`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `material_api_idempotency_lease_idx` ON `material_api_idempotency` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `__new_material_master` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`internal_material_code` text,
	`standard_name` text NOT NULL,
	`category_id` integer NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`manufacturer` text DEFAULT '' NOT NULL,
	`manufacturer_part_number` text DEFAULT '' NOT NULL,
	`base_uom` text NOT NULL,
	`material_status` text NOT NULL,
	`procurement_type` text NOT NULL,
	`inventory_type` text NOT NULL,
	`lot_control_required` integer DEFAULT 0 NOT NULL,
	`shelf_life_days` integer,
	`inspection_type` text NOT NULL,
	`environmental_requirement` text NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_modified_by` text NOT NULL,
	`submitted_by` text DEFAULT '' NOT NULL,
	`submitted_at` text,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `material_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_master_status_ck" CHECK("__new_material_master"."material_status" IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_REVIEW', 'ACTIVE', 'FROZEN', 'INACTIVE')),
	CONSTRAINT "material_master_code_after_approval_ck" CHECK(("__new_material_master"."material_status" IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_REVIEW') AND "__new_material_master"."internal_material_code" IS NULL) OR ("__new_material_master"."material_status" IN ('ACTIVE', 'FROZEN', 'INACTIVE') AND "__new_material_master"."internal_material_code" IS NOT NULL AND "__new_material_master"."approved_at" IS NOT NULL AND "__new_material_master"."approved_by" <> '')),
	CONSTRAINT "material_master_last_modified_by_ck" CHECK(length(trim("__new_material_master"."last_modified_by")) > 0),
	CONSTRAINT "material_master_submission_ck" CHECK((("__new_material_master"."submitted_by" = '' AND "__new_material_master"."submitted_at" IS NULL) OR (length(trim("__new_material_master"."submitted_by")) > 0 AND "__new_material_master"."submitted_at" IS NOT NULL)) AND ("__new_material_master"."material_status" NOT IN ('PENDING_APPROVAL', 'PENDING_REVIEW') OR (length(trim("__new_material_master"."submitted_by")) > 0 AND "__new_material_master"."submitted_at" IS NOT NULL))),
	CONSTRAINT "material_master_procurement_type_ck" CHECK("__new_material_master"."procurement_type" IN ('PURCHASE', 'OUTSOURCE', 'SELF_MADE', 'NON_PURCHASABLE')),
	CONSTRAINT "material_master_inventory_type_ck" CHECK("__new_material_master"."inventory_type" IN ('STOCKED', 'NON_STOCKED', 'CONSIGNMENT')),
	CONSTRAINT "material_master_lot_control_ck" CHECK("__new_material_master"."lot_control_required" IN (0, 1)),
	CONSTRAINT "material_master_shelf_life_ck" CHECK("__new_material_master"."shelf_life_days" IS NULL OR "__new_material_master"."shelf_life_days" >= 0),
	CONSTRAINT "material_master_inspection_type_ck" CHECK("__new_material_master"."inspection_type" IN ('NONE', 'NORMAL', 'TIGHTENED', 'REDUCED', 'FULL')),
	CONSTRAINT "material_master_environmental_ck" CHECK("__new_material_master"."environmental_requirement" IN ('UNSPECIFIED', 'ROHS', 'ROHS_REACH', 'HALOGEN_FREE', 'CUSTOMER_SPECIFIC'))
);
--> statement-breakpoint
INSERT INTO `__new_material_master`("id", "internal_material_code", "standard_name", "category_id", "brand", "manufacturer", "manufacturer_part_number", "base_uom", "material_status", "procurement_type", "inventory_type", "lot_control_required", "shelf_life_days", "inspection_type", "environmental_requirement", "source_type", "source_ref", "version", "last_modified_by", "submitted_by", "submitted_at", "approved_by", "approved_at", "created_by", "created_at", "updated_by", "updated_at", "request_id")
SELECT m."id", m."internal_material_code", m."standard_name", m."category_id", m."brand", m."manufacturer", m."manufacturer_part_number", m."base_uom",
	CASE WHEN m."material_status" = 'PENDING_APPROVAL' THEN 'PENDING_REVIEW' ELSE m."material_status" END,
	m."procurement_type", m."inventory_type", m."lot_control_required", m."shelf_life_days", m."inspection_type", m."environmental_requirement", m."source_type", m."source_ref", m."version",
	m."created_by",
	CASE WHEN m."material_status" = 'PENDING_APPROVAL' THEN (SELECT v."changed_by" FROM "material_versions" v WHERE v."material_id" = m."id" AND v."event_type" = 'SUBMIT' AND v."version_no" = m."version" ORDER BY v."id" DESC LIMIT 1) ELSE '' END,
	CASE WHEN m."material_status" = 'PENDING_APPROVAL' THEN (SELECT v."created_at" FROM "material_versions" v WHERE v."material_id" = m."id" AND v."event_type" = 'SUBMIT' AND v."version_no" = m."version" ORDER BY v."id" DESC LIMIT 1) ELSE NULL END,
	m."approved_by", m."approved_at", m."created_by", m."created_at", m."updated_by", m."updated_at", m."request_id"
FROM `material_master` m;--> statement-breakpoint
DELETE FROM `material_versions`;--> statement-breakpoint
DROP TABLE `material_master`;--> statement-breakpoint
ALTER TABLE `__new_material_master` RENAME TO `material_master`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_master_internal_code_uq` ON `material_master` (`internal_material_code`) WHERE "material_master"."internal_material_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `material_master_candidate_idx` ON `material_master` (`category_id`,`manufacturer`,`manufacturer_part_number`);--> statement-breakpoint
CREATE INDEX `material_master_status_updated_idx` ON `material_master` (`material_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `material_master_category_status_idx` ON `material_master` (`category_id`,`material_status`);--> statement-breakpoint
CREATE INDEX `material_master_review_queue_idx` ON `material_master` (`material_status`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_master_review_category_idx` ON `material_master` (`material_status`,`category_id`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_master_review_source_idx` ON `material_master` (`material_status`,`source_type`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_master_review_creator_idx` ON `material_master` (`material_status`,`created_by`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `material_master_standard_name_idx` ON `material_master` (`standard_name`);
--> statement-breakpoint
INSERT INTO `legacy_material_mapping` SELECT * FROM `__lifecycle_backup_legacy_material_mapping`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_legacy_material_mapping`;--> statement-breakpoint
INSERT INTO `material_aliases` SELECT * FROM `__lifecycle_backup_material_aliases`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_material_aliases`;--> statement-breakpoint
INSERT INTO `material_attribute_values` SELECT * FROM `__lifecycle_backup_material_attribute_values`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_material_attribute_values`;--> statement-breakpoint
INSERT INTO `material_change_logs` SELECT * FROM `__lifecycle_backup_material_change_logs`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_material_change_logs`;--> statement-breakpoint
INSERT INTO `material_versions` SELECT * FROM `__lifecycle_backup_material_versions`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_material_versions`;--> statement-breakpoint
INSERT INTO `supplier_mappings` SELECT * FROM `__lifecycle_backup_supplier_mappings`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_supplier_mappings`;--> statement-breakpoint
INSERT INTO `supplier_mapping_price_history` SELECT * FROM `__lifecycle_backup_supplier_mapping_price_history`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_supplier_mapping_price_history`;--> statement-breakpoint
INSERT INTO `material_api_idempotency` SELECT * FROM `__lifecycle_backup_material_api_idempotency`;--> statement-breakpoint
DROP TABLE `__lifecycle_backup_material_api_idempotency`;
