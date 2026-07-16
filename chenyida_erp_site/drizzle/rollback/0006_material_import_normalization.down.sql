PRAGMA defer_foreign_keys=ON;--> statement-breakpoint

CREATE TABLE material_import_normalization_rollback_guard (id INTEGER NOT NULL);--> statement-breakpoint
INSERT INTO material_import_normalization_rollback_guard(id)
SELECT CASE WHEN
  NOT EXISTS (SELECT 1 FROM material_import_normalization_issues)
  AND NOT EXISTS (SELECT 1 FROM material_import_normalized_rows)
  AND NOT EXISTS (SELECT 1 FROM material_import_normalization_runs)
  AND NOT EXISTS (SELECT 1 FROM material_import_batches WHERE current_normalization_run_id IS NOT NULL OR status IN ('QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED'))
  AND NOT EXISTS (SELECT 1 FROM material_import_job_outbox WHERE normalization_run_id IS NOT NULL OR job_type IN ('START_NORMALIZATION','NORMALIZE_ROW_CHUNK','VERIFY_NORMALIZATION','PUBLISH_NORMALIZATION'))
  AND NOT EXISTS (SELECT 1 FROM material_import_events WHERE event_type IN ('NORMALIZATION_QUEUED','NORMALIZATION_STARTED','NORMALIZATION_PUBLISHED','NORMALIZATION_FAILED','NORMALIZATION_CANCELLED','NORMALIZATION_CLEANUP_FAILED'))
  THEN 1 ELSE NULL END;--> statement-breakpoint
DROP TABLE material_import_normalization_rollback_guard;--> statement-breakpoint

DROP TRIGGER material_import_batches_current_normalization_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_batches_current_normalization_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalization_runs_current_guard_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalization_runs_binding_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalization_runs_binding_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalized_rows_binding_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalized_rows_binding_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalization_issues_binding_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_normalization_issues_binding_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_parse_runs_batch_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_parse_runs_batch_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_batches_current_run_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_batches_current_run_update_ck;--> statement-breakpoint

CREATE TABLE __normalization_down_outbox AS SELECT id,batch_id,parse_run_id,job_type,payload_version,payload_json,dispatch_status,dispatch_version,attempt_count,available_at,last_attempt_at,safe_failure_code,created_at,dispatched_at FROM material_import_job_outbox;--> statement-breakpoint
CREATE TABLE __normalization_down_events AS SELECT * FROM material_import_events;--> statement-breakpoint
CREATE TABLE __normalization_down_files AS SELECT * FROM material_import_files;--> statement-breakpoint
CREATE TABLE __normalization_down_rows AS SELECT * FROM material_import_rows;--> statement-breakpoint
CREATE TABLE __normalization_down_mappings AS SELECT * FROM material_import_mappings;--> statement-breakpoint
CREATE TABLE __normalization_down_mapping_items AS SELECT * FROM material_import_mapping_items;--> statement-breakpoint
CREATE TABLE __normalization_down_idempotency AS SELECT * FROM material_import_idempotency;--> statement-breakpoint

DELETE FROM material_import_idempotency;--> statement-breakpoint
DELETE FROM material_import_mapping_items;--> statement-breakpoint
DELETE FROM material_import_mappings;--> statement-breakpoint
DELETE FROM material_import_job_outbox;--> statement-breakpoint
DELETE FROM material_import_events;--> statement-breakpoint
DELETE FROM material_import_rows;--> statement-breakpoint
DELETE FROM material_import_files;--> statement-breakpoint
DROP TABLE material_import_idempotency;--> statement-breakpoint
DROP TABLE material_import_mapping_items;--> statement-breakpoint
DROP TABLE material_import_mappings;--> statement-breakpoint
DROP TABLE material_import_job_outbox;--> statement-breakpoint
DROP TABLE material_import_normalization_issues;--> statement-breakpoint
DROP TABLE material_import_normalized_rows;--> statement-breakpoint
DROP TABLE material_import_normalization_runs;--> statement-breakpoint
DROP TABLE material_import_events;--> statement-breakpoint
DROP TABLE material_import_rows;--> statement-breakpoint
DROP TABLE material_import_files;--> statement-breakpoint

CREATE TABLE __old_material_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  batch_no TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_of_batch_id INTEGER,
  created_by TEXT NOT NULL,
  current_version INTEGER DEFAULT 1 NOT NULL,
  current_parse_run_id INTEGER,
  file_count INTEGER DEFAULT 0 NOT NULL,
  total_rows INTEGER DEFAULT 0 NOT NULL,
  accepted_rows INTEGER DEFAULT 0 NOT NULL,
  rejected_rows INTEGER DEFAULT 0 NOT NULL,
  failure_stage TEXT,
  failure_code TEXT,
  failure_message TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT,
  terminal_at TEXT,
  raw_data_retention_until TEXT,
  record_retention_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (retry_of_batch_id) REFERENCES __old_material_import_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES app_users(username) ON DELETE RESTRICT,
  FOREIGN KEY (cancelled_by) REFERENCES app_users(username) ON DELETE RESTRICT,
  CONSTRAINT material_import_batches_source_ck CHECK(source_kind IN ('XLSX','CSV')),
  CONSTRAINT material_import_batches_status_ck CHECK(status IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')),
  CONSTRAINT material_import_batches_version_ck CHECK(current_version > 0),
  CONSTRAINT material_import_batches_counts_ck CHECK(file_count BETWEEN 0 AND 1 AND total_rows >= 0 AND accepted_rows >= 0 AND rejected_rows >= 0 AND accepted_rows + rejected_rows <= total_rows),
  CONSTRAINT material_import_batches_retry_ck CHECK(retry_of_batch_id IS NULL OR retry_of_batch_id <> id),
  CONSTRAINT material_import_batches_failure_ck CHECK((status='FAILED' AND length(trim(failure_stage))>0 AND length(trim(failure_code))>0) OR (status<>'FAILED' AND failure_stage IS NULL AND failure_code IS NULL AND failure_message IS NULL)),
  CONSTRAINT material_import_batches_cancel_ck CHECK((status='CANCELLED' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL) OR (status<>'CANCELLED' AND cancelled_by IS NULL AND cancelled_at IS NULL)),
  CONSTRAINT material_import_batches_terminal_ck CHECK((status IN ('FAILED','CANCELLED') AND terminal_at IS NOT NULL AND raw_data_retention_until IS NOT NULL AND record_retention_until IS NOT NULL) OR (status NOT IN ('FAILED','CANCELLED') AND terminal_at IS NULL AND raw_data_retention_until IS NULL AND record_retention_until IS NULL)),
  CONSTRAINT material_import_batches_current_run_ck CHECK((status IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED') AND current_parse_run_id IS NOT NULL) OR (status NOT IN ('PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED')))
);--> statement-breakpoint
INSERT INTO __old_material_import_batches(id,batch_no,source_kind,status,retry_of_batch_id,created_by,current_version,current_parse_run_id,file_count,total_rows,accepted_rows,rejected_rows,failure_stage,failure_code,failure_message,cancelled_by,cancelled_at,terminal_at,raw_data_retention_until,record_retention_until,created_at,updated_at)
SELECT id,batch_no,source_kind,status,retry_of_batch_id,created_by,current_version,current_parse_run_id,file_count,total_rows,accepted_rows,rejected_rows,failure_stage,failure_code,failure_message,cancelled_by,cancelled_at,terminal_at,raw_data_retention_until,record_retention_until,created_at,updated_at FROM material_import_batches;--> statement-breakpoint
DROP TABLE material_import_batches;--> statement-breakpoint
ALTER TABLE __old_material_import_batches RENAME TO material_import_batches;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_batches_no_uq ON material_import_batches(batch_no);--> statement-breakpoint
CREATE INDEX material_import_batches_owner_created_idx ON material_import_batches(created_by,created_at,id);--> statement-breakpoint
CREATE INDEX material_import_batches_status_created_idx ON material_import_batches(status,created_at,id);--> statement-breakpoint
CREATE INDEX material_import_batches_retry_idx ON material_import_batches(retry_of_batch_id);--> statement-breakpoint
CREATE INDEX material_import_batches_raw_retention_idx ON material_import_batches(raw_data_retention_until,id);--> statement-breakpoint
CREATE INDEX material_import_batches_current_run_idx ON material_import_batches(current_parse_run_id);--> statement-breakpoint
CREATE TRIGGER material_import_parse_runs_batch_insert_ck BEFORE INSERT ON material_import_parse_runs
WHEN NOT EXISTS (SELECT 1 FROM material_import_batches b WHERE b.id=NEW.batch_id)
BEGIN SELECT RAISE(ABORT,'material_import_parse_runs_batch_fk'); END;--> statement-breakpoint
CREATE TRIGGER material_import_parse_runs_batch_update_ck BEFORE UPDATE OF batch_id ON material_import_parse_runs
WHEN NOT EXISTS (SELECT 1 FROM material_import_batches b WHERE b.id=NEW.batch_id)
BEGIN SELECT RAISE(ABORT,'material_import_parse_runs_batch_fk'); END;--> statement-breakpoint
CREATE TRIGGER material_import_batches_current_run_insert_ck BEFORE INSERT ON material_import_batches
WHEN NEW.current_parse_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM material_import_parse_runs p WHERE p.id=NEW.current_parse_run_id AND p.batch_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'material_import_batches_current_run_fk'); END;--> statement-breakpoint
CREATE TRIGGER material_import_batches_current_run_update_ck BEFORE UPDATE OF current_parse_run_id,id ON material_import_batches
WHEN NEW.current_parse_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM material_import_parse_runs p WHERE p.id=NEW.current_parse_run_id AND p.batch_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'material_import_batches_current_run_fk'); END;--> statement-breakpoint

CREATE TABLE material_import_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,object_key TEXT NOT NULL,original_filename TEXT NOT NULL,filename_extension TEXT,declared_mime_type TEXT,declared_sha256 TEXT NOT NULL,declared_size_bytes INTEGER,detected_file_type TEXT,actual_sha256 TEXT,actual_size_bytes INTEGER,object_etag TEXT,storage_status TEXT NOT NULL,security_check_status TEXT NOT NULL,security_failure_code TEXT,security_failure_message TEXT,uploaded_at TEXT,retention_until TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  CONSTRAINT material_import_files_filename_ck CHECK(length(trim(original_filename)) BETWEEN 1 AND 255 AND instr(original_filename,char(0))=0),
  CONSTRAINT material_import_files_declared_sha_ck CHECK(length(declared_sha256)=64 AND declared_sha256 NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT material_import_files_declared_size_ck CHECK(declared_size_bytes IS NULL OR declared_size_bytes>=0),
  CONSTRAINT material_import_files_detected_type_ck CHECK(detected_file_type IS NULL OR detected_file_type IN ('XLSX','CSV')),
  CONSTRAINT material_import_files_actual_sha_ck CHECK(actual_sha256 IS NULL OR (length(actual_sha256)=64 AND actual_sha256 NOT GLOB '*[^0-9a-f]*')),
  CONSTRAINT material_import_files_actual_size_ck CHECK(actual_size_bytes IS NULL OR actual_size_bytes>0),
  CONSTRAINT material_import_files_storage_status_ck CHECK(storage_status IN ('UPLOAD_PENDING','STORED','RECONCILIATION_REQUIRED','STORAGE_FAILED','DELETE_PENDING','DELETED')),
  CONSTRAINT material_import_files_security_status_ck CHECK(security_check_status IN ('NOT_STARTED','PENDING','BASIC_CHECK_PASSED','REJECTED')),
  CONSTRAINT material_import_files_stored_metadata_ck CHECK(storage_status<>'STORED' OR (detected_file_type IS NOT NULL AND actual_sha256 IS NOT NULL AND actual_size_bytes>0 AND uploaded_at IS NOT NULL)),
  CONSTRAINT material_import_files_ready_ck CHECK(security_check_status<>'BASIC_CHECK_PASSED' OR (storage_status IN ('STORED','DELETE_PENDING','DELETED') AND detected_file_type IS NOT NULL AND actual_sha256 IS NOT NULL AND actual_size_bytes>0)),
  CONSTRAINT material_import_files_security_failure_ck CHECK((security_check_status='REJECTED' AND length(trim(security_failure_code))>0) OR (security_check_status<>'REJECTED' AND security_failure_code IS NULL AND security_failure_message IS NULL))
);--> statement-breakpoint
INSERT INTO material_import_files SELECT * FROM __normalization_down_files;--> statement-breakpoint
DROP TABLE __normalization_down_files;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_files_batch_uq ON material_import_files(batch_id);--> statement-breakpoint
CREATE UNIQUE INDEX material_import_files_object_key_uq ON material_import_files(object_key);--> statement-breakpoint
CREATE INDEX material_import_files_sha_idx ON material_import_files(actual_sha256,batch_id);--> statement-breakpoint
CREATE INDEX material_import_files_storage_idx ON material_import_files(storage_status,updated_at,id);--> statement-breakpoint

CREATE TABLE material_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,parse_run_id INTEGER NOT NULL,sheet_index INTEGER NOT NULL,sheet_name TEXT NOT NULL,row_number INTEGER NOT NULL,raw_values_json TEXT NOT NULL,raw_row_hash TEXT NOT NULL,created_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,FOREIGN KEY(parse_run_id) REFERENCES material_import_parse_runs(id) ON DELETE RESTRICT,
  CONSTRAINT material_import_rows_position_uq UNIQUE(parse_run_id,sheet_index,row_number),
  CONSTRAINT material_import_rows_position_ck CHECK(sheet_index>=0 AND row_number>0 AND length(sheet_name)>0),
  CONSTRAINT material_import_rows_values_ck CHECK(json_valid(raw_values_json) AND json_type(raw_values_json)='object'),
  CONSTRAINT material_import_rows_sha_ck CHECK(length(raw_row_hash)=64 AND raw_row_hash NOT GLOB '*[^0-9a-f]*')
);--> statement-breakpoint
INSERT INTO material_import_rows SELECT * FROM __normalization_down_rows;--> statement-breakpoint
DROP TABLE __normalization_down_rows;--> statement-breakpoint
CREATE INDEX material_import_rows_batch_run_idx ON material_import_rows(batch_id,parse_run_id,sheet_index,row_number);--> statement-breakpoint

CREATE TABLE material_import_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,parse_run_id INTEGER NOT NULL,selected_sheet_index INTEGER NOT NULL,header_mode TEXT NOT NULL,header_row_number INTEGER,mapping_status TEXT DEFAULT 'DRAFT' NOT NULL,mapping_version INTEGER DEFAULT 1 NOT NULL,metadata_digest TEXT NOT NULL,suggestion_algorithm_version TEXT,supersedes_mapping_id INTEGER,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,confirmed_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,confirmed_at TEXT,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,FOREIGN KEY(parse_run_id) REFERENCES material_import_parse_runs(id) ON DELETE RESTRICT,FOREIGN KEY(supersedes_mapping_id) REFERENCES material_import_mappings(id) ON DELETE RESTRICT,FOREIGN KEY(created_by) REFERENCES app_users(username) ON DELETE RESTRICT,FOREIGN KEY(updated_by) REFERENCES app_users(username) ON DELETE RESTRICT,FOREIGN KEY(confirmed_by) REFERENCES app_users(username) ON DELETE RESTRICT,
  CONSTRAINT material_import_mappings_header_ck CHECK((header_mode='SINGLE_ROW' AND header_row_number>0) OR (header_mode='NO_HEADER' AND header_row_number IS NULL)),
  CONSTRAINT material_import_mappings_status_ck CHECK(mapping_status IN ('DRAFT','CONFIRMED','STALE','SUPERSEDED')),
  CONSTRAINT material_import_mappings_values_ck CHECK(selected_sheet_index>=0 AND mapping_version>0),
  CONSTRAINT material_import_mappings_digest_ck CHECK(length(metadata_digest)=64 AND metadata_digest NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT material_import_mappings_confirm_ck CHECK((mapping_status='CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL) OR mapping_status<>'CONFIRMED')
);--> statement-breakpoint
INSERT INTO material_import_mappings SELECT * FROM __normalization_down_mappings;--> statement-breakpoint
DROP TABLE __normalization_down_mappings;--> statement-breakpoint
CREATE INDEX material_import_mappings_batch_run_idx ON material_import_mappings(batch_id,parse_run_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX material_import_mappings_current_uq ON material_import_mappings(parse_run_id) WHERE mapping_status<>'SUPERSEDED';--> statement-breakpoint

CREATE TABLE material_import_mapping_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,mapping_id INTEGER NOT NULL,source_column_index INTEGER,source_header TEXT,target_namespace TEXT NOT NULL,target_code TEXT NOT NULL,mapping_mode TEXT NOT NULL,default_value_json TEXT,required INTEGER DEFAULT 0 NOT NULL,display_order INTEGER NOT NULL,
  FOREIGN KEY(mapping_id) REFERENCES material_import_mappings(id) ON DELETE RESTRICT,
  CONSTRAINT material_import_mapping_items_namespace_ck CHECK(target_namespace IN ('basic','attribute','category_hint','supplier_reference','ignore')),
  CONSTRAINT material_import_mapping_items_mode_ck CHECK(mapping_mode IN ('SOURCE','SOURCE_WITH_DEFAULT','DEFAULT','IGNORE')),
  CONSTRAINT material_import_mapping_items_source_ck CHECK((mapping_mode='DEFAULT' AND source_column_index IS NULL) OR (mapping_mode<>'DEFAULT' AND source_column_index>=0)),
  CONSTRAINT material_import_mapping_items_default_ck CHECK(default_value_json IS NULL OR json_valid(default_value_json)),
  CONSTRAINT material_import_mapping_items_values_ck CHECK(required IN (0,1) AND display_order>=0)
);--> statement-breakpoint
INSERT INTO material_import_mapping_items SELECT * FROM __normalization_down_mapping_items;--> statement-breakpoint
DROP TABLE __normalization_down_mapping_items;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_mapping_items_source_uq ON material_import_mapping_items(mapping_id,source_column_index) WHERE source_column_index IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_mapping_items_target_uq ON material_import_mapping_items(mapping_id,target_namespace,target_code) WHERE target_namespace<>'ignore';--> statement-breakpoint

CREATE TABLE material_import_idempotency (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,username TEXT NOT NULL,method TEXT NOT NULL,route_scope TEXT NOT NULL,key_digest TEXT NOT NULL,request_digest TEXT NOT NULL,operation_id TEXT NOT NULL,state TEXT NOT NULL,batch_id INTEGER,file_id INTEGER,lease_token_digest TEXT NOT NULL,lease_expires_at INTEGER,status_code INTEGER,response_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at INTEGER,recovery_until INTEGER NOT NULL,
  FOREIGN KEY(username) REFERENCES app_users(username) ON DELETE RESTRICT,FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,FOREIGN KEY(file_id) REFERENCES material_import_files(id) ON DELETE RESTRICT,
  CONSTRAINT material_import_idempotency_method_ck CHECK(method IN ('POST','PUT')),
  CONSTRAINT material_import_idempotency_route_ck CHECK(length(route_scope) BETWEEN 1 AND 255),
  CONSTRAINT material_import_idempotency_digest_ck CHECK(length(key_digest)=64 AND length(request_digest)=64 AND length(lease_token_digest)=64),
  CONSTRAINT material_import_idempotency_operation_ck CHECK(length(operation_id)=36),
  CONSTRAINT material_import_idempotency_state_ck CHECK(state IN ('PENDING','COMPLETED')),
  CONSTRAINT material_import_idempotency_result_ck CHECK((state='PENDING' AND lease_expires_at>0 AND status_code IS NULL AND response_json IS NULL AND expires_at IS NULL) OR (state='COMPLETED' AND lease_expires_at IS NULL AND status_code BETWEEN 100 AND 599 AND json_valid(response_json) AND expires_at>0)),
  CONSTRAINT material_import_idempotency_recovery_ck CHECK(recovery_until>0)
);--> statement-breakpoint
INSERT INTO material_import_idempotency SELECT * FROM __normalization_down_idempotency;--> statement-breakpoint
DROP TABLE __normalization_down_idempotency;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_idempotency_scope_uq ON material_import_idempotency(username,method,route_scope,key_digest);--> statement-breakpoint
CREATE UNIQUE INDEX material_import_idempotency_operation_uq ON material_import_idempotency(operation_id);--> statement-breakpoint
CREATE INDEX material_import_idempotency_recovery_idx ON material_import_idempotency(state,recovery_until,id);--> statement-breakpoint

CREATE TABLE material_import_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor_type TEXT NOT NULL,actor_identifier TEXT,previous_status TEXT,new_status TEXT,request_id TEXT NOT NULL,safe_details_json TEXT,created_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  CONSTRAINT material_import_events_type_ck CHECK(event_type IN ('BATCH_CREATED','FILE_UPLOAD_STARTED','FILE_STORED','FILE_UPLOAD_COMPLETED','FILE_UPLOAD_FAILED','FILE_SECURITY_CHECK_PASSED','FILE_SECURITY_CHECK_FAILED','RECONCILIATION_REQUIRED','BATCH_CANCELLED','FILE_DELETE_REQUESTED','FILE_DELETED','FILE_DELETE_FAILED','PARSE_QUEUED','PARSE_STARTED','PARSE_PUBLISHED','PARSE_FAILED','MAPPING_PREPARATION_READY','MAPPING_PREPARATION_FAILED','MAPPING_SAVED','MAPPING_CONFIRMED')),
  CONSTRAINT material_import_events_actor_ck CHECK(actor_type IN ('USER','SYSTEM')),
  CONSTRAINT material_import_events_status_ck CHECK((previous_status IS NULL OR previous_status IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')) AND (new_status IS NULL OR new_status IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))),
  CONSTRAINT material_import_events_details_ck CHECK(safe_details_json IS NULL OR json_valid(safe_details_json))
);--> statement-breakpoint
INSERT INTO material_import_events SELECT * FROM __normalization_down_events;--> statement-breakpoint
DROP TABLE __normalization_down_events;--> statement-breakpoint
CREATE INDEX material_import_events_batch_created_idx ON material_import_events(batch_id,created_at,id);--> statement-breakpoint

CREATE TABLE material_import_job_outbox (
  id TEXT PRIMARY KEY NOT NULL,batch_id INTEGER NOT NULL,parse_run_id INTEGER NOT NULL,job_type TEXT NOT NULL,payload_version INTEGER DEFAULT 1 NOT NULL,payload_json TEXT NOT NULL,dispatch_status TEXT DEFAULT 'PENDING' NOT NULL,dispatch_version INTEGER DEFAULT 1 NOT NULL,attempt_count INTEGER DEFAULT 0 NOT NULL,available_at INTEGER NOT NULL,last_attempt_at INTEGER,safe_failure_code TEXT,created_at TEXT NOT NULL,dispatched_at TEXT,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY(parse_run_id) REFERENCES material_import_parse_runs(id) ON DELETE RESTRICT,
  CONSTRAINT material_import_job_outbox_type_ck CHECK(job_type IN ('INSPECT_WORKBOOK','PREPARE_SHARED_RESOURCES','PARSE_SHEET','VERIFY_PARSE_RUN','PUBLISH_PARSE_RUN','PREPARE_MAPPING','PUBLISH_MAPPING_PREPARATION')),
  CONSTRAINT material_import_job_outbox_status_ck CHECK(dispatch_status IN ('PENDING','DISPATCHING','DISPATCHED','RETRY_WAIT','DEAD')),
  CONSTRAINT material_import_job_outbox_counts_ck CHECK(payload_version>0 AND dispatch_version>0 AND attempt_count>=0 AND available_at>0),
  CONSTRAINT material_import_job_outbox_json_ck CHECK(json_valid(payload_json) AND json_type(payload_json)='object')
);--> statement-breakpoint
INSERT INTO material_import_job_outbox SELECT * FROM __normalization_down_outbox;--> statement-breakpoint
DROP TABLE __normalization_down_outbox;--> statement-breakpoint
CREATE INDEX material_import_job_outbox_pending_idx ON material_import_job_outbox(dispatch_status,available_at,id);--> statement-breakpoint
CREATE UNIQUE INDEX material_import_job_outbox_stage_uq ON material_import_job_outbox(parse_run_id,job_type,json_extract(payload_json,'$.sheet_index')) WHERE dispatch_status<>'DEAD';--> statement-breakpoint

-- End of protected 0006 rollback.
