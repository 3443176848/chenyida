CREATE TABLE material_draft_lifecycle_rollback_guard (id INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO material_draft_lifecycle_rollback_guard(id)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM material_master)
  OR EXISTS (SELECT 1 FROM material_api_idempotency)
  OR EXISTS (SELECT 1 FROM audit_log WHERE route_code IN ('MATERIAL_DRAFT_EDIT','MATERIAL_DRAFT_SUBMIT','MATERIAL_REVIEW_QUEUE'))
  OR EXISTS (SELECT 1 FROM material_versions WHERE event_type IN ('UPDATE', 'SUBMIT'))
THEN NULL ELSE 1 END;
--> statement-breakpoint
DROP TABLE material_draft_lifecycle_rollback_guard;
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
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
DELETE FROM `material_versions`;--> statement-breakpoint
CREATE TABLE `__lifecycle_backup_material_api_idempotency` AS SELECT * FROM `material_api_idempotency`;--> statement-breakpoint
DELETE FROM `material_api_idempotency`;--> statement-breakpoint
CREATE TABLE __old_material_api_idempotency (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  username TEXT NOT NULL REFERENCES app_users(username) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK(method = 'POST'),
  route_scope TEXT NOT NULL CHECK(length(route_scope) BETWEEN 1 AND 255),
  key_digest TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_token_digest TEXT NOT NULL,
  lease_expires_at INTEGER,
  status_code INTEGER,
  response_json TEXT,
  material_id INTEGER REFERENCES material_master(id) ON DELETE RESTRICT,
  old_version INTEGER,
  new_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at INTEGER,
  CONSTRAINT material_api_idempotency_digest_ck CHECK(length(key_digest)=64 AND length(request_digest)=64 AND length(lease_token_digest)=64),
  CONSTRAINT material_api_idempotency_operation_ck CHECK(length(operation_id)=36),
  CONSTRAINT material_api_idempotency_state_ck CHECK(state IN ('PENDING','COMPLETED')),
  CONSTRAINT material_api_idempotency_result_ck CHECK((state='PENDING' AND lease_expires_at>0 AND status_code IS NULL AND response_json IS NULL AND expires_at IS NULL) OR (state='COMPLETED' AND lease_expires_at IS NULL AND status_code BETWEEN 100 AND 599 AND json_valid(response_json) AND expires_at>0)),
  CONSTRAINT material_api_idempotency_versions_ck CHECK((old_version IS NULL OR old_version>=0) AND (new_version IS NULL OR new_version>0))
);
--> statement-breakpoint
INSERT INTO __old_material_api_idempotency SELECT * FROM material_api_idempotency;
--> statement-breakpoint
DROP TABLE material_api_idempotency;
--> statement-breakpoint
ALTER TABLE __old_material_api_idempotency RENAME TO material_api_idempotency;
--> statement-breakpoint
CREATE UNIQUE INDEX material_api_idempotency_scope_uq ON material_api_idempotency(username,method,route_scope,key_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX material_api_idempotency_operation_uq ON material_api_idempotency(operation_id);
--> statement-breakpoint
CREATE INDEX material_api_idempotency_expiry_idx ON material_api_idempotency(state,expires_at);
--> statement-breakpoint
CREATE INDEX material_api_idempotency_lease_idx ON material_api_idempotency(state,lease_expires_at);
--> statement-breakpoint
CREATE TABLE __old_material_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  internal_material_code TEXT,
  standard_name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES material_categories(id),
  brand TEXT DEFAULT '' NOT NULL,
  manufacturer TEXT DEFAULT '' NOT NULL,
  manufacturer_part_number TEXT DEFAULT '' NOT NULL,
  base_uom TEXT NOT NULL,
  material_status TEXT NOT NULL CHECK(material_status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','FROZEN','INACTIVE')),
  procurement_type TEXT NOT NULL CHECK(procurement_type IN ('PURCHASE','OUTSOURCE','SELF_MADE','NON_PURCHASABLE')),
  inventory_type TEXT NOT NULL CHECK(inventory_type IN ('STOCKED','NON_STOCKED','CONSIGNMENT')),
  lot_control_required INTEGER DEFAULT 0 NOT NULL CHECK(lot_control_required IN (0,1)),
  shelf_life_days INTEGER CHECK(shelf_life_days IS NULL OR shelf_life_days>=0),
  inspection_type TEXT NOT NULL CHECK(inspection_type IN ('NONE','NORMAL','TIGHTENED','REDUCED','FULL')),
  environmental_requirement TEXT NOT NULL CHECK(environmental_requirement IN ('UNSPECIFIED','ROHS','ROHS_REACH','HALOGEN_FREE','CUSTOMER_SPECIFIC')),
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  approved_by TEXT DEFAULT '' NOT NULL,
  approved_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  request_id TEXT NOT NULL,
  CONSTRAINT material_master_code_after_approval_ck CHECK((material_status IN ('DRAFT','PENDING_APPROVAL') AND internal_material_code IS NULL) OR (material_status IN ('ACTIVE','FROZEN','INACTIVE') AND internal_material_code IS NOT NULL AND approved_at IS NOT NULL AND approved_by<>''))
);
--> statement-breakpoint
INSERT INTO __old_material_master(id,internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,material_status,procurement_type,inventory_type,lot_control_required,shelf_life_days,inspection_type,environmental_requirement,source_type,source_ref,version,approved_by,approved_at,created_by,created_at,updated_by,updated_at,request_id)
SELECT id,internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,material_status,procurement_type,inventory_type,lot_control_required,shelf_life_days,inspection_type,environmental_requirement,source_type,source_ref,version,approved_by,approved_at,created_by,created_at,updated_by,updated_at,request_id FROM material_master;
--> statement-breakpoint
DROP TABLE material_master;
--> statement-breakpoint
ALTER TABLE __old_material_master RENAME TO material_master;
--> statement-breakpoint
CREATE UNIQUE INDEX material_master_internal_code_uq ON material_master(internal_material_code) WHERE internal_material_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX material_master_candidate_idx ON material_master(category_id,manufacturer,manufacturer_part_number);
--> statement-breakpoint
CREATE INDEX material_master_status_updated_idx ON material_master(material_status,updated_at);
--> statement-breakpoint
CREATE INDEX material_master_category_status_idx ON material_master(category_id,material_status);
--> statement-breakpoint
CREATE INDEX material_master_standard_name_idx ON material_master(standard_name);
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
