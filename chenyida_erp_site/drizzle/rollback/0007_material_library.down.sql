CREATE TABLE `material_library_down_guard` (`id` integer NOT NULL);--> statement-breakpoint
INSERT INTO `material_library_down_guard` (`id`)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM `brands`) = 0
  AND (SELECT COUNT(*) FROM `brand_aliases`) = 0
  AND (SELECT COUNT(*) FROM `material_import_normalization_approvals`) = 0
  AND (SELECT COUNT(*) FROM `material_import_draft_links`) = 0
  AND (SELECT COUNT(*) FROM `material_duplicate_candidates`) = 0
  AND (SELECT COUNT(*) FROM `units`) = 5
  AND (SELECT COUNT(*) FROM `units` WHERE (`code`,`name`,`symbol`,`unit_type`,`enabled`) IN (
    ('PCS','件','pcs','COUNT',1),
    ('KG','千克','kg','MASS',1),
    ('G','克','g','MASS',1),
    ('M','米','m','LENGTH',1),
    ('MM','毫米','mm','LENGTH',1)
  )) = 5
  AND (SELECT COUNT(*) FROM `unit_aliases`) = 3
  AND (SELECT COUNT(*) FROM `material_master`
    WHERE `brand_id` IS NOT NULL
       OR `base_unit_id` IS NOT NULL
       OR `source_import_batch_id` IS NOT NULL
       OR `source_import_file_id` IS NOT NULL
       OR `source_import_row_id` IS NOT NULL
  ) = 0
THEN 1 END;--> statement-breakpoint
DROP TABLE `material_library_down_guard`;--> statement-breakpoint
DROP INDEX `material_master_import_source_idx`;--> statement-breakpoint
DROP INDEX `material_master_base_unit_idx`;--> statement-breakpoint
DROP INDEX `material_master_brand_idx`;--> statement-breakpoint
ALTER TABLE `material_master` DROP COLUMN `source_import_row_id`;--> statement-breakpoint
ALTER TABLE `material_master` DROP COLUMN `source_import_file_id`;--> statement-breakpoint
ALTER TABLE `material_master` DROP COLUMN `source_import_batch_id`;--> statement-breakpoint
ALTER TABLE `material_master` DROP COLUMN `base_unit_id`;--> statement-breakpoint
ALTER TABLE `material_master` DROP COLUMN `brand_id`;--> statement-breakpoint
DROP TABLE `material_duplicate_candidates`;--> statement-breakpoint
DROP TABLE `material_import_draft_links`;--> statement-breakpoint
DROP TABLE `material_import_normalization_approvals`;--> statement-breakpoint
DROP TABLE `brand_aliases`;--> statement-breakpoint
DROP TABLE `brands`;--> statement-breakpoint
DROP TABLE `unit_aliases`;--> statement-breakpoint
DROP TABLE `units`;
