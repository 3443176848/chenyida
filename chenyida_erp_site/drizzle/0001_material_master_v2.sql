CREATE TABLE `legacy_material_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_table` text NOT NULL,
	`source_key` text NOT NULL,
	`source_code` text DEFAULT '' NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`source_snapshot_hash` text NOT NULL,
	`mapping_method` text NOT NULL,
	`status` text NOT NULL,
	`mapped_by` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_material_mapping_source_type_ck" CHECK("legacy_material_mapping"."source_type" IN ('LEGACY_D1','LEGACY_SQLITE','GOVERNANCE_TEMPLATE')),
	CONSTRAINT "legacy_material_mapping_method_ck" CHECK("legacy_material_mapping"."mapping_method" IN ('MANUAL','EXACT_CODE','APPROVED_MERGE')),
	CONSTRAINT "legacy_material_mapping_status_ck" CHECK("legacy_material_mapping"."status" IN ('ACTIVE','SUPERSEDED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_material_mapping_source_identity_uq` ON `legacy_material_mapping` (`source_type`,`source_table`,`source_key`);--> statement-breakpoint
CREATE INDEX `legacy_material_mapping_material_idx` ON `legacy_material_mapping` (`material_id`);--> statement-breakpoint
CREATE INDEX `legacy_material_mapping_source_code_idx` ON `legacy_material_mapping` (`source_type`,`source_code`);--> statement-breakpoint
CREATE INDEX `legacy_material_mapping_snapshot_hash_idx` ON `legacy_material_mapping` (`source_snapshot_hash`);--> statement-breakpoint
CREATE TABLE `material_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`alias_type` text NOT NULL,
	`alias_text` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`language_code` text DEFAULT '' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_aliases_type_ck" CHECK("material_aliases"."alias_type" IN ('CHINESE_NAME','ENGLISH_NAME','SUPPLIER_NAME','LEGACY_NAME','INTERNAL_SHORT_NAME','LEGACY_CODE')),
	CONSTRAINT "material_aliases_primary_ck" CHECK("material_aliases"."is_primary" IN (0,1)),
	CONSTRAINT "material_aliases_status_ck" CHECK("material_aliases"."status" IN ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_aliases_material_type_normalized_uq` ON `material_aliases` (`material_id`,`alias_type`,`normalized_alias`);--> statement-breakpoint
CREATE TABLE `material_attribute_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attribute_code` text NOT NULL,
	`attribute_name_cn` text NOT NULL,
	`attribute_name_en` text DEFAULT '' NOT NULL,
	`data_type` text NOT NULL,
	`decimal_scale` integer DEFAULT 0 NOT NULL,
	`canonical_unit` text DEFAULT '' NOT NULL,
	`allowed_values_json` text DEFAULT '[]' NOT NULL,
	`normalization_rule` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	CONSTRAINT "material_attribute_definitions_type_ck" CHECK("material_attribute_definitions"."data_type" IN ('TEXT','INTEGER','DECIMAL','BOOLEAN','DATE','ENUM')),
	CONSTRAINT "material_attribute_definitions_scale_ck" CHECK("material_attribute_definitions"."decimal_scale" BETWEEN 0 AND 9),
	CONSTRAINT "material_attribute_definitions_normalization_ck" CHECK("material_attribute_definitions"."normalization_rule" IN ('NONE','TRIM_UPPER','DECIMAL_SCALE','ENUM_CODE','DATE_ISO')),
	CONSTRAINT "material_attribute_definitions_status_ck" CHECK("material_attribute_definitions"."status" IN ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_attribute_definitions_code_uq` ON `material_attribute_definitions` (`attribute_code`);--> statement-breakpoint
CREATE TABLE `material_attribute_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`attribute_definition_id` integer NOT NULL,
	`value_text` text,
	`value_integer` integer,
	`value_decimal_scaled` integer,
	`value_boolean` integer,
	`value_date` text,
	`normalized_value` text NOT NULL,
	`unit_code` text DEFAULT '' NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attribute_definition_id`) REFERENCES `material_attribute_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_attribute_values_boolean_ck" CHECK("material_attribute_values"."value_boolean" IS NULL OR "material_attribute_values"."value_boolean" IN (0,1)),
	CONSTRAINT "material_attribute_values_single_value_ck" CHECK((("material_attribute_values"."value_text" IS NOT NULL) + ("material_attribute_values"."value_integer" IS NOT NULL) + ("material_attribute_values"."value_decimal_scaled" IS NOT NULL) + ("material_attribute_values"."value_boolean" IS NOT NULL) + ("material_attribute_values"."value_date" IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_attribute_values_material_definition_uq` ON `material_attribute_values` (`material_id`,`attribute_definition_id`);--> statement-breakpoint
CREATE INDEX `material_attribute_values_definition_normalized_idx` ON `material_attribute_values` (`attribute_definition_id`,`normalized_value`);--> statement-breakpoint
CREATE TABLE `material_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_code` text NOT NULL,
	`category_name_cn` text NOT NULL,
	`category_name_en` text DEFAULT '' NOT NULL,
	`parent_id` integer,
	`category_level` integer NOT NULL,
	`status` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `material_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_categories_level_ck" CHECK("material_categories"."category_level" BETWEEN 1 AND 4),
	CONSTRAINT "material_categories_status_ck" CHECK("material_categories"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_categories_code_uq` ON `material_categories` (`category_code`);--> statement-breakpoint
CREATE INDEX `material_categories_parent_status_sort_idx` ON `material_categories` (`parent_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `material_categories_level_status_idx` ON `material_categories` (`category_level`,`status`);--> statement-breakpoint
CREATE TABLE `material_category_attributes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`attribute_definition_id` integer NOT NULL,
	`is_required` integer DEFAULT 0 NOT NULL,
	`is_unique_key_component` integer DEFAULT 0 NOT NULL,
	`is_searchable` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `material_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attribute_definition_id`) REFERENCES `material_attribute_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_category_attributes_flags_ck" CHECK("material_category_attributes"."is_required" IN (0,1) AND "material_category_attributes"."is_unique_key_component" IN (0,1) AND "material_category_attributes"."is_searchable" IN (0,1)),
	CONSTRAINT "material_category_attributes_status_ck" CHECK("material_category_attributes"."status" IN ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_category_attributes_category_definition_uq` ON `material_category_attributes` (`category_id`,`attribute_definition_id`);--> statement-breakpoint
CREATE INDEX `material_category_attributes_category_status_sort_idx` ON `material_category_attributes` (`category_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `material_change_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`change_type` text NOT NULL,
	`field_name` text NOT NULL,
	`old_value_json` text DEFAULT 'null' NOT NULL,
	`new_value_json` text DEFAULT 'null' NOT NULL,
	`change_reason` text DEFAULT '' NOT NULL,
	`changed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_change_logs_type_ck" CHECK("material_change_logs"."change_type" IN ('CREATE','UPDATE','STATUS_CHANGE','APPROVAL','REJECTION','CODE_ASSIGNMENT'))
);
--> statement-breakpoint
CREATE INDEX `material_change_logs_material_created_idx` ON `material_change_logs` (`material_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `material_change_logs_request_idx` ON `material_change_logs` (`request_id`);--> statement-breakpoint
CREATE TABLE `material_code_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_code` text NOT NULL,
	`rule_name` text NOT NULL,
	`category_id` integer NOT NULL,
	`prefix` text DEFAULT 'CYD' NOT NULL,
	`major_segment` text NOT NULL,
	`minor_segment` text NOT NULL,
	`separator` text DEFAULT '-' NOT NULL,
	`sequence_width` integer DEFAULT 6 NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `material_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_code_rules_width_ck" CHECK("material_code_rules"."sequence_width" BETWEEN 4 AND 12),
	CONSTRAINT "material_code_rules_sequence_ck" CHECK("material_code_rules"."next_sequence" > 0),
	CONSTRAINT "material_code_rules_status_ck" CHECK("material_code_rules"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "material_code_rules_validity_ck" CHECK("material_code_rules"."effective_to" IS NULL OR "material_code_rules"."effective_to" > "material_code_rules"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_code_rules_code_uq` ON `material_code_rules` (`rule_code`);--> statement-breakpoint
CREATE INDEX `material_code_rules_category_status_idx` ON `material_code_rules` (`category_id`,`status`);--> statement-breakpoint
CREATE TABLE `material_master` (
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
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `material_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_master_status_ck" CHECK("material_master"."material_status" IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'FROZEN', 'INACTIVE')),
	CONSTRAINT "material_master_code_after_approval_ck" CHECK(("material_master"."material_status" IN ('DRAFT', 'PENDING_APPROVAL') AND "material_master"."internal_material_code" IS NULL) OR ("material_master"."material_status" IN ('ACTIVE', 'FROZEN', 'INACTIVE') AND "material_master"."internal_material_code" IS NOT NULL AND "material_master"."approved_at" IS NOT NULL AND "material_master"."approved_by" <> '')),
	CONSTRAINT "material_master_procurement_type_ck" CHECK("material_master"."procurement_type" IN ('PURCHASE', 'OUTSOURCE', 'SELF_MADE', 'NON_PURCHASABLE')),
	CONSTRAINT "material_master_inventory_type_ck" CHECK("material_master"."inventory_type" IN ('STOCKED', 'NON_STOCKED', 'CONSIGNMENT')),
	CONSTRAINT "material_master_lot_control_ck" CHECK("material_master"."lot_control_required" IN (0, 1)),
	CONSTRAINT "material_master_shelf_life_ck" CHECK("material_master"."shelf_life_days" IS NULL OR "material_master"."shelf_life_days" >= 0),
	CONSTRAINT "material_master_inspection_type_ck" CHECK("material_master"."inspection_type" IN ('NONE', 'NORMAL', 'TIGHTENED', 'REDUCED', 'FULL')),
	CONSTRAINT "material_master_environmental_ck" CHECK("material_master"."environmental_requirement" IN ('UNSPECIFIED', 'ROHS', 'ROHS_REACH', 'HALOGEN_FREE', 'CUSTOMER_SPECIFIC'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_master_internal_code_uq` ON `material_master` (`internal_material_code`) WHERE "material_master"."internal_material_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `material_master_candidate_idx` ON `material_master` (`category_id`,`manufacturer`,`manufacturer_part_number`);--> statement-breakpoint
CREATE INDEX `material_master_status_updated_idx` ON `material_master` (`material_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `material_master_category_status_idx` ON `material_master` (`category_id`,`material_status`);--> statement-breakpoint
CREATE INDEX `material_master_standard_name_idx` ON `material_master` (`standard_name`);--> statement-breakpoint
CREATE TABLE `material_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`version_no` integer NOT NULL,
	`event_type` text NOT NULL,
	`change_reason` text DEFAULT '' NOT NULL,
	`changed_fields_json` text DEFAULT '[]' NOT NULL,
	`snapshot_json` text NOT NULL,
	`changed_by` text NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "material_versions_version_ck" CHECK("material_versions"."version_no" > 0),
	CONSTRAINT "material_versions_event_ck" CHECK("material_versions"."event_type" IN ('CREATE','UPDATE','SUBMIT','APPROVE','REJECT','FREEZE','DEACTIVATE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_material_version_uq` ON `material_versions` (`material_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `material_versions_material_created_idx` ON `material_versions` (`material_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `material_versions_event_created_idx` ON `material_versions` (`event_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `supplier_mapping_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supplier_mapping_id` integer NOT NULL,
	`price_scaled` integer NOT NULL,
	`price_scale` integer NOT NULL,
	`currency_code` text NOT NULL,
	`price_uom` text NOT NULL,
	`minimum_order_qty_scaled` integer,
	`quantity_scale` integer DEFAULT 0 NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_document_ref` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`supplier_mapping_id`) REFERENCES `supplier_mappings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_mapping_price_history_price_ck" CHECK("supplier_mapping_price_history"."price_scaled" >= 0 AND "supplier_mapping_price_history"."price_scale" BETWEEN 0 AND 6),
	CONSTRAINT "supplier_mapping_price_history_qty_ck" CHECK(("supplier_mapping_price_history"."minimum_order_qty_scaled" IS NULL OR "supplier_mapping_price_history"."minimum_order_qty_scaled" >= 0) AND "supplier_mapping_price_history"."quantity_scale" BETWEEN 0 AND 6),
	CONSTRAINT "supplier_mapping_price_history_validity_ck" CHECK("supplier_mapping_price_history"."effective_to" IS NULL OR "supplier_mapping_price_history"."effective_to" > "supplier_mapping_price_history"."effective_from")
);
--> statement-breakpoint
CREATE INDEX `supplier_mapping_price_history_from_idx` ON `supplier_mapping_price_history` (`supplier_mapping_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `supplier_mapping_price_history_to_idx` ON `supplier_mapping_price_history` (`supplier_mapping_id`,`effective_to`);--> statement-breakpoint
CREATE TABLE `supplier_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`supplier_name` text NOT NULL,
	`supplier_key` text NOT NULL,
	`supplier_item_code` text NOT NULL,
	`supplier_item_name` text DEFAULT '' NOT NULL,
	`supplier_specification` text DEFAULT '' NOT NULL,
	`manufacturer` text DEFAULT '' NOT NULL,
	`mpn` text DEFAULT '' NOT NULL,
	`revision` text DEFAULT '' NOT NULL,
	`purchase_uom` text NOT NULL,
	`uom_conversion_numerator` integer DEFAULT 1 NOT NULL,
	`uom_conversion_denominator` integer DEFAULT 1 NOT NULL,
	`minimum_order_qty_scaled` integer,
	`quantity_scale` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`supersedes_mapping_id` integer,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_mapping_id`) REFERENCES `supplier_mappings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_mappings_conversion_ck" CHECK("supplier_mappings"."uom_conversion_numerator" > 0 AND "supplier_mappings"."uom_conversion_denominator" > 0),
	CONSTRAINT "supplier_mappings_moq_ck" CHECK("supplier_mappings"."minimum_order_qty_scaled" IS NULL OR "supplier_mappings"."minimum_order_qty_scaled" >= 0),
	CONSTRAINT "supplier_mappings_scale_ck" CHECK("supplier_mappings"."quantity_scale" BETWEEN 0 AND 6),
	CONSTRAINT "supplier_mappings_status_ck" CHECK("supplier_mappings"."status" IN ('PENDING','ACTIVE','INACTIVE','REJECTED')),
	CONSTRAINT "supplier_mappings_validity_ck" CHECK("supplier_mappings"."valid_to" IS NULL OR "supplier_mappings"."valid_to" > "supplier_mappings"."valid_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_mappings_identity_period_uq` ON `supplier_mappings` (`supplier_key`,`supplier_item_code`,`manufacturer`,`mpn`,`revision`,`valid_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_mappings_current_identity_uq` ON `supplier_mappings` (`supplier_key`,`supplier_item_code`,`manufacturer`,`mpn`,`revision`) WHERE "supplier_mappings"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX `supplier_mappings_material_idx` ON `supplier_mappings` (`material_id`);--> statement-breakpoint
CREATE INDEX `supplier_mappings_supersedes_idx` ON `supplier_mappings` (`supersedes_mapping_id`);--> statement-breakpoint
CREATE INDEX `supplier_mappings_mpn_manufacturer_idx` ON `supplier_mappings` (`mpn`,`manufacturer`);--> statement-breakpoint
CREATE INDEX `supplier_mappings_status_updated_idx` ON `supplier_mappings` (`status`,`updated_at`);