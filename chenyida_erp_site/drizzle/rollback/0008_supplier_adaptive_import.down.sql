-- D1 blocks TEMP schema changes; use a transaction-scoped ordinary guard table.
-- This is an expand-only compatibility rollback: it restores 0007 index behavior
-- for the previous application version while retaining additive nullable columns.
-- Full structural recovery uses the mandatory pre-migration D1 snapshot.
CREATE TABLE `__adaptive_import_down_guard` (`value` integer NOT NULL);--> statement-breakpoint
INSERT INTO `__adaptive_import_down_guard`(`value`)
SELECT CASE WHEN
	EXISTS(SELECT 1 FROM `material_import_supplier_profiles`) OR
	EXISTS(SELECT 1 FROM `material_import_mappings` WHERE `supplier_profile_id` IS NOT NULL OR `header_start_row_number` IS NOT NULL OR `data_start_row_number` IS NOT NULL OR `structure_confidence`<>0 OR `structure_status`<>'NEEDS_REVIEW' OR `structure_evidence_json`<>'{}') OR
	EXISTS(SELECT 1 FROM `material_import_mapping_items` WHERE `source_column_indexes_json` IS NOT NULL OR `source_headers_json` IS NOT NULL OR `combination_strategy`<>'FIRST_NON_EMPTY' OR `combination_separator`<>' ' OR `mapping_confidence`<>0 OR `adaptive_mapping_status`<>'UNMAPPED' OR `mapping_evidence_json`<>'[]') OR
	EXISTS(SELECT 1 FROM `material_import_normalized_rows` WHERE `mapped_values_json` IS NOT NULL OR `mapping_confidence`<>0 OR `specification_confidence`<>0 OR `adaptive_mapping_status`<>'UNMAPPED' OR `review_status`<>'NEEDS_REVIEW')
THEN NULL ELSE 1 END;--> statement-breakpoint
DROP INDEX `material_import_normalized_rows_adaptive_review_idx`;--> statement-breakpoint
DROP INDEX `material_import_mapping_items_source_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `material_import_mapping_items_source_uq` ON `material_import_mapping_items` (`mapping_id`,`source_column_index`) WHERE `source_column_index` IS NOT NULL;--> statement-breakpoint
DROP INDEX `material_import_mappings_supplier_profile_idx`;--> statement-breakpoint
DROP TABLE `__adaptive_import_down_guard`;
