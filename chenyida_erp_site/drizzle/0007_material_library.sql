CREATE TABLE `brand_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "brand_aliases_alias_ck" CHECK(length(trim("brand_aliases"."alias")) BETWEEN 1 AND 200 AND length(trim("brand_aliases"."normalized_alias")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_aliases_normalized_uq` ON `brand_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `brand_aliases_brand_idx` ON `brand_aliases` (`brand_id`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`standard_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "brands_code_ck" CHECK(length(trim("brands"."code")) BETWEEN 1 AND 64 AND "brands"."code" = upper(trim("brands"."code"))),
	CONSTRAINT "brands_name_ck" CHECK(length(trim("brands"."standard_name")) BETWEEN 1 AND 200 AND length(trim("brands"."normalized_name")) BETWEEN 1 AND 200),
	CONSTRAINT "brands_enabled_ck" CHECK("brands"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_code_uq` ON `brands` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `brands_normalized_name_uq` ON `brands` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `brands_enabled_name_idx` ON `brands` (`enabled`,`standard_name`);--> statement-breakpoint
CREATE TABLE `material_duplicate_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized_row_id` integer NOT NULL,
	`draft_material_id` integer NOT NULL,
	`candidate_material_id` integer NOT NULL,
	`match_level` text NOT NULL,
	`confidence_basis_points` integer NOT NULL,
	`matched_fields_json` text NOT NULL,
	`created_at` text NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`normalized_row_id`) REFERENCES `material_import_normalized_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`draft_material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_duplicate_candidates_level_ck" CHECK("material_duplicate_candidates"."match_level" IN ('EXACT','HIGH_CONFIDENCE','POSSIBLE')),
	CONSTRAINT "material_duplicate_candidates_confidence_ck" CHECK("material_duplicate_candidates"."confidence_basis_points" BETWEEN 1 AND 10000),
	CONSTRAINT "material_duplicate_candidates_fields_ck" CHECK(json_valid("material_duplicate_candidates"."matched_fields_json") AND json_type("material_duplicate_candidates"."matched_fields_json")='array'),
	CONSTRAINT "material_duplicate_candidates_not_self_ck" CHECK("material_duplicate_candidates"."draft_material_id" <> "material_duplicate_candidates"."candidate_material_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_duplicate_candidates_pair_uq` ON `material_duplicate_candidates` (`normalized_row_id`,`candidate_material_id`);--> statement-breakpoint
CREATE INDEX `material_duplicate_candidates_draft_level_idx` ON `material_duplicate_candidates` (`draft_material_id`,`match_level`,`confidence_basis_points`,`id`);--> statement-breakpoint
CREATE INDEX `material_duplicate_candidates_candidate_idx` ON `material_duplicate_candidates` (`candidate_material_id`,`id`);--> statement-breakpoint
CREATE TABLE `material_import_draft_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	`source_row_id` integer NOT NULL,
	`normalized_row_id` integer NOT NULL,
	`normalization_approval_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`file_id`) REFERENCES `material_import_files`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_row_id`) REFERENCES `material_import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalized_row_id`) REFERENCES `material_import_normalized_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalization_approval_id`) REFERENCES `material_import_normalization_approvals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_draft_links_normalized_row_uq` ON `material_import_draft_links` (`normalized_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_draft_links_material_uq` ON `material_import_draft_links` (`material_id`);--> statement-breakpoint
CREATE INDEX `material_import_draft_links_batch_idx` ON `material_import_draft_links` (`batch_id`,`id`);--> statement-breakpoint
CREATE INDEX `material_import_draft_links_source_row_idx` ON `material_import_draft_links` (`source_row_id`);--> statement-breakpoint
CREATE TABLE `material_import_normalization_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`normalization_run_id` integer NOT NULL,
	`result_digest` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `material_import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalization_run_id`) REFERENCES `material_import_normalization_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by`) REFERENCES `app_users`(`username`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_import_normalization_approvals_digest_ck" CHECK(length("material_import_normalization_approvals"."result_digest")=64 AND "material_import_normalization_approvals"."result_digest" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_normalization_approvals_run_uq` ON `material_import_normalization_approvals` (`normalization_run_id`);--> statement-breakpoint
CREATE INDEX `material_import_normalization_approvals_batch_idx` ON `material_import_normalization_approvals` (`batch_id`,`approved_at`,`id`);--> statement-breakpoint
CREATE TABLE `unit_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "unit_aliases_alias_ck" CHECK(length(trim("unit_aliases"."alias")) BETWEEN 1 AND 100 AND length(trim("unit_aliases"."normalized_alias")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_aliases_normalized_uq` ON `unit_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `unit_aliases_unit_idx` ON `unit_aliases` (`unit_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`unit_type` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "units_code_ck" CHECK(length(trim("units"."code")) BETWEEN 1 AND 32 AND "units"."code" = upper(trim("units"."code"))),
	CONSTRAINT "units_name_ck" CHECK(length(trim("units"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "units_symbol_ck" CHECK(length(trim("units"."symbol")) BETWEEN 1 AND 32),
	CONSTRAINT "units_type_ck" CHECK("units"."unit_type" IN ('COUNT','MASS','LENGTH','AREA','VOLUME','TIME','OTHER')),
	CONSTRAINT "units_enabled_ck" CHECK("units"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_code_uq` ON `units` (`code`);--> statement-breakpoint
CREATE INDEX `units_type_enabled_idx` ON `units` (`unit_type`,`enabled`,`code`);--> statement-breakpoint
INSERT INTO `units` (`code`,`name`,`symbol`,`unit_type`,`enabled`) VALUES
	('PCS','件','pcs','COUNT',1),
	('KG','千克','kg','MASS',1),
	('G','克','g','MASS',1),
	('M','米','m','LENGTH',1),
	('MM','毫米','mm','LENGTH',1);--> statement-breakpoint
INSERT INTO `unit_aliases` (`unit_id`,`alias`,`normalized_alias`)
SELECT `id`,'个','个' FROM `units` WHERE `code`='PCS'
UNION ALL SELECT `id`,'件','件' FROM `units` WHERE `code`='PCS'
UNION ALL SELECT `id`,'pcs','pcs' FROM `units` WHERE `code`='PCS';--> statement-breakpoint
ALTER TABLE `material_master` ADD `brand_id` integer REFERENCES brands(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `material_master` ADD `base_unit_id` integer REFERENCES units(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `material_master` ADD `source_import_batch_id` integer REFERENCES material_import_batches(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `material_master` ADD `source_import_file_id` integer REFERENCES material_import_files(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `material_master` ADD `source_import_row_id` integer REFERENCES material_import_rows(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `material_master_brand_idx` ON `material_master` (`brand_id`,`material_status`,`id`);--> statement-breakpoint
CREATE INDEX `material_master_base_unit_idx` ON `material_master` (`base_unit_id`,`material_status`,`id`);--> statement-breakpoint
CREATE INDEX `material_master_import_source_idx` ON `material_master` (`source_import_batch_id`,`source_import_row_id`,`id`);
