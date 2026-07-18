CREATE TABLE `material_import_supplier_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supplier_key` text NOT NULL,
	`profile_name` text NOT NULL,
	`profile_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`template_fingerprint` text,
	`structure_rules_json` text DEFAULT '{}' NOT NULL,
	`field_aliases_json` text DEFAULT '{}' NOT NULL,
	`mapping_rules_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `material_import_supplier_profiles_identity_ck` CHECK(length(trim(`supplier_key`)) BETWEEN 1 AND 255 AND length(trim(`profile_name`)) BETWEEN 1 AND 255 AND `profile_version` > 0),
	CONSTRAINT `material_import_supplier_profiles_status_ck` CHECK(`status` IN ('ACTIVE','INACTIVE')),
	CONSTRAINT `material_import_supplier_profiles_fingerprint_ck` CHECK(`template_fingerprint` IS NULL OR (length(`template_fingerprint`)=64 AND `template_fingerprint` NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT `material_import_supplier_profiles_json_ck` CHECK(json_valid(`structure_rules_json`) AND json_type(`structure_rules_json`)='object' AND json_valid(`field_aliases_json`) AND json_type(`field_aliases_json`)='object' AND json_valid(`mapping_rules_json`) AND json_type(`mapping_rules_json`)='object')
);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_supplier_profiles_version_uq` ON `material_import_supplier_profiles` (`supplier_key`,`profile_name`,`profile_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_supplier_profiles_active_template_uq` ON `material_import_supplier_profiles` (`supplier_key`,`template_fingerprint`) WHERE `status`='ACTIVE' AND `template_fingerprint` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `material_import_supplier_profiles_status_idx` ON `material_import_supplier_profiles` (`supplier_key`,`status`,`updated_at`,`id`);--> statement-breakpoint

ALTER TABLE `material_import_mappings` ADD COLUMN `supplier_profile_id` integer REFERENCES `material_import_supplier_profiles`(`id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `material_import_mappings` ADD COLUMN `header_start_row_number` integer CHECK(`header_start_row_number` IS NULL OR `header_start_row_number` > 0);--> statement-breakpoint
ALTER TABLE `material_import_mappings` ADD COLUMN `data_start_row_number` integer CHECK(`data_start_row_number` IS NULL OR `data_start_row_number` > 0);--> statement-breakpoint
ALTER TABLE `material_import_mappings` ADD COLUMN `structure_confidence` real DEFAULT 0 NOT NULL CHECK(`structure_confidence` BETWEEN 0 AND 1);--> statement-breakpoint
ALTER TABLE `material_import_mappings` ADD COLUMN `structure_status` text DEFAULT 'NEEDS_REVIEW' NOT NULL CHECK(`structure_status` IN ('HIGH_CONFIDENCE','NEEDS_REVIEW','NO_CANDIDATE','CONFIRMED'));--> statement-breakpoint
ALTER TABLE `material_import_mappings` ADD COLUMN `structure_evidence_json` text DEFAULT '{}' NOT NULL CHECK(json_valid(`structure_evidence_json`) AND json_type(`structure_evidence_json`)='object');--> statement-breakpoint
CREATE INDEX `material_import_mappings_supplier_profile_idx` ON `material_import_mappings` (`supplier_profile_id`,`created_at`,`id`);--> statement-breakpoint

DROP INDEX `material_import_mapping_items_source_uq`;--> statement-breakpoint
CREATE INDEX `material_import_mapping_items_source_idx` ON `material_import_mapping_items` (`mapping_id`,`source_column_index`,`id`);--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `source_column_indexes_json` text CHECK(`source_column_indexes_json` IS NULL OR (json_valid(`source_column_indexes_json`) AND json_type(`source_column_indexes_json`)='array' AND json_array_length(`source_column_indexes_json`) BETWEEN 1 AND 8));--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `source_headers_json` text CHECK(`source_headers_json` IS NULL OR (json_valid(`source_headers_json`) AND json_type(`source_headers_json`)='array' AND json_array_length(`source_headers_json`) BETWEEN 1 AND 8));--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `combination_strategy` text DEFAULT 'FIRST_NON_EMPTY' NOT NULL CHECK(`combination_strategy` IN ('FIRST_NON_EMPTY','JOIN_NON_EMPTY','SPECIFICATION_EXTRACT'));--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `combination_separator` text DEFAULT ' ' NOT NULL CHECK(length(`combination_separator`) BETWEEN 0 AND 10);--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `mapping_confidence` real DEFAULT 0 NOT NULL CHECK(`mapping_confidence` BETWEEN 0 AND 1);--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `adaptive_mapping_status` text DEFAULT 'UNMAPPED' NOT NULL CHECK(`adaptive_mapping_status` IN ('EXACT','HIGH_CONFIDENCE','SUGGESTED','UNMAPPED','CONFLICT','CONFIRMED'));--> statement-breakpoint
ALTER TABLE `material_import_mapping_items` ADD COLUMN `mapping_evidence_json` text DEFAULT '[]' NOT NULL CHECK(json_valid(`mapping_evidence_json`) AND json_type(`mapping_evidence_json`)='array');--> statement-breakpoint

ALTER TABLE `material_import_normalized_rows` ADD COLUMN `mapped_values_json` text CHECK(`mapped_values_json` IS NULL OR (json_valid(`mapped_values_json`) AND json_type(`mapped_values_json`)='object'));--> statement-breakpoint
ALTER TABLE `material_import_normalized_rows` ADD COLUMN `mapping_confidence` real DEFAULT 0 NOT NULL CHECK(`mapping_confidence` BETWEEN 0 AND 1);--> statement-breakpoint
ALTER TABLE `material_import_normalized_rows` ADD COLUMN `specification_confidence` real DEFAULT 0 NOT NULL CHECK(`specification_confidence` BETWEEN 0 AND 1);--> statement-breakpoint
ALTER TABLE `material_import_normalized_rows` ADD COLUMN `adaptive_mapping_status` text DEFAULT 'UNMAPPED' NOT NULL CHECK(`adaptive_mapping_status` IN ('EXACT','HIGH_CONFIDENCE','SUGGESTED','UNMAPPED','CONFLICT'));--> statement-breakpoint
ALTER TABLE `material_import_normalized_rows` ADD COLUMN `review_status` text DEFAULT 'NEEDS_REVIEW' NOT NULL CHECK(`review_status` IN ('AUTO_ACCEPTABLE','NEEDS_REVIEW','CONFIRMED','REJECTED'));--> statement-breakpoint
CREATE INDEX `material_import_normalized_rows_adaptive_review_idx` ON `material_import_normalized_rows` (`normalization_run_id`,`review_status`,`adaptive_mapping_status`,`id`);
