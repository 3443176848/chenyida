PRAGMA defer_foreign_keys=ON;--> statement-breakpoint

CREATE TABLE material_import_parser_rollback_guard (id INTEGER NOT NULL);--> statement-breakpoint
INSERT INTO material_import_parser_rollback_guard(id)
SELECT CASE WHEN
  NOT EXISTS (SELECT 1 FROM material_import_batches WHERE status NOT IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))
  AND NOT EXISTS (SELECT 1 FROM material_import_parse_runs WHERE parser_version <> 'legacy-0004-backfill-v1')
  AND NOT EXISTS (SELECT 1 FROM material_import_mappings)
  AND NOT EXISTS (SELECT 1 FROM material_import_job_outbox)
  AND NOT EXISTS (SELECT 1 FROM material_import_header_suggestions)
  THEN 1 ELSE NULL END;--> statement-breakpoint
DROP TABLE material_import_parser_rollback_guard;--> statement-breakpoint

CREATE TABLE __parser_down_files AS SELECT * FROM material_import_files;--> statement-breakpoint
CREATE TABLE __parser_down_idempotency AS SELECT * FROM material_import_idempotency;--> statement-breakpoint
CREATE TABLE __parser_down_events AS SELECT * FROM material_import_events;--> statement-breakpoint
CREATE TABLE __parser_down_rows AS
SELECT r.id,r.batch_id,r.sheet_index,r.sheet_name,r.row_number,r.raw_values_json,r.raw_row_hash AS raw_row_sha256,r.created_at
FROM material_import_rows r
JOIN material_import_parse_runs p ON p.id=r.parse_run_id
WHERE p.parser_version='legacy-0004-backfill-v1';--> statement-breakpoint

DELETE FROM material_import_idempotency;--> statement-breakpoint
DELETE FROM material_import_events;--> statement-breakpoint
DELETE FROM material_import_rows;--> statement-breakpoint
DELETE FROM material_import_files;--> statement-breakpoint
DROP TABLE material_import_idempotency;--> statement-breakpoint
DROP TABLE material_import_events;--> statement-breakpoint
DROP TABLE material_import_rows;--> statement-breakpoint
DROP TABLE material_import_files;--> statement-breakpoint
DROP TABLE material_import_mapping_items;--> statement-breakpoint
DROP TABLE material_import_mappings;--> statement-breakpoint
DROP TABLE material_import_header_suggestions;--> statement-breakpoint
DROP TABLE material_import_job_outbox;--> statement-breakpoint
DROP TABLE material_import_parse_sheets;--> statement-breakpoint
DROP TABLE material_import_shared_string_chunks;--> statement-breakpoint
DROP TRIGGER material_import_batches_current_run_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_batches_current_run_insert_ck;--> statement-breakpoint
DROP TRIGGER material_import_parse_runs_batch_update_ck;--> statement-breakpoint
DROP TRIGGER material_import_parse_runs_batch_insert_ck;--> statement-breakpoint
DROP TABLE material_import_parse_runs;--> statement-breakpoint

CREATE TABLE __old_material_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  batch_no TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_of_batch_id INTEGER,
  created_by TEXT NOT NULL,
  current_version INTEGER DEFAULT 1 NOT NULL,
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
  CONSTRAINT material_import_batches_status_ck CHECK(status IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED')),
  CONSTRAINT material_import_batches_version_ck CHECK(current_version > 0),
  CONSTRAINT material_import_batches_counts_ck CHECK(file_count BETWEEN 0 AND 1 AND total_rows >= 0 AND accepted_rows >= 0 AND rejected_rows >= 0 AND accepted_rows + rejected_rows <= total_rows),
  CONSTRAINT material_import_batches_retry_ck CHECK(retry_of_batch_id IS NULL OR retry_of_batch_id <> id),
  CONSTRAINT material_import_batches_failure_ck CHECK((status='FAILED' AND length(trim(failure_stage))>0 AND length(trim(failure_code))>0) OR (status<>'FAILED' AND failure_stage IS NULL AND failure_code IS NULL AND failure_message IS NULL)),
  CONSTRAINT material_import_batches_cancel_ck CHECK((status='CANCELLED' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL) OR (status<>'CANCELLED' AND cancelled_by IS NULL AND cancelled_at IS NULL)),
  CONSTRAINT material_import_batches_terminal_ck CHECK((status IN ('FAILED','CANCELLED') AND terminal_at IS NOT NULL AND raw_data_retention_until IS NOT NULL AND record_retention_until IS NOT NULL) OR (status NOT IN ('FAILED','CANCELLED') AND terminal_at IS NULL AND raw_data_retention_until IS NULL AND record_retention_until IS NULL))
);--> statement-breakpoint
INSERT INTO __old_material_import_batches(id,batch_no,source_kind,status,retry_of_batch_id,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,failure_stage,failure_code,failure_message,cancelled_by,cancelled_at,terminal_at,raw_data_retention_until,record_retention_until,created_at,updated_at)
SELECT id,batch_no,source_kind,status,retry_of_batch_id,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,failure_stage,failure_code,failure_message,cancelled_by,cancelled_at,terminal_at,raw_data_retention_until,record_retention_until,created_at,updated_at FROM material_import_batches;--> statement-breakpoint
DROP TABLE material_import_batches;--> statement-breakpoint
ALTER TABLE __old_material_import_batches RENAME TO material_import_batches;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_batches_no_uq ON material_import_batches(batch_no);--> statement-breakpoint
CREATE INDEX material_import_batches_owner_created_idx ON material_import_batches(created_by,created_at,id);--> statement-breakpoint
CREATE INDEX material_import_batches_status_created_idx ON material_import_batches(status,created_at,id);--> statement-breakpoint
CREATE INDEX material_import_batches_retry_idx ON material_import_batches(retry_of_batch_id);--> statement-breakpoint
CREATE INDEX material_import_batches_raw_retention_idx ON material_import_batches(raw_data_retention_until,id);--> statement-breakpoint

CREATE TABLE material_import_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,object_key TEXT NOT NULL,original_filename TEXT NOT NULL,filename_extension TEXT,declared_mime_type TEXT,declared_sha256 TEXT NOT NULL,declared_size_bytes INTEGER,detected_file_type TEXT,actual_sha256 TEXT,actual_size_bytes INTEGER,object_etag TEXT,storage_status TEXT NOT NULL,security_check_status TEXT NOT NULL,security_failure_code TEXT,security_failure_message TEXT,uploaded_at TEXT,retention_until TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  CHECK(length(trim(original_filename)) BETWEEN 1 AND 255 AND instr(original_filename,char(0))=0),
  CHECK(length(declared_sha256)=64 AND declared_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK(declared_size_bytes IS NULL OR declared_size_bytes>=0),
  CHECK(detected_file_type IS NULL OR detected_file_type IN ('XLSX','CSV')),
  CHECK(actual_sha256 IS NULL OR (length(actual_sha256)=64 AND actual_sha256 NOT GLOB '*[^0-9a-f]*')),
  CHECK(actual_size_bytes IS NULL OR actual_size_bytes>0),
  CHECK(storage_status IN ('UPLOAD_PENDING','STORED','RECONCILIATION_REQUIRED','STORAGE_FAILED','DELETE_PENDING','DELETED')),
  CHECK(security_check_status IN ('NOT_STARTED','PENDING','BASIC_CHECK_PASSED','REJECTED')),
  CHECK(storage_status<>'STORED' OR (detected_file_type IS NOT NULL AND actual_sha256 IS NOT NULL AND actual_size_bytes>0 AND uploaded_at IS NOT NULL)),
  CHECK(security_check_status<>'BASIC_CHECK_PASSED' OR (storage_status IN ('STORED','DELETE_PENDING','DELETED') AND detected_file_type IS NOT NULL AND actual_sha256 IS NOT NULL AND actual_size_bytes>0)),
  CHECK((security_check_status='REJECTED' AND length(trim(security_failure_code))>0) OR (security_check_status<>'REJECTED' AND security_failure_code IS NULL AND security_failure_message IS NULL))
);--> statement-breakpoint
INSERT INTO material_import_files SELECT * FROM __parser_down_files;--> statement-breakpoint
DROP TABLE __parser_down_files;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_files_batch_uq ON material_import_files(batch_id);--> statement-breakpoint
CREATE UNIQUE INDEX material_import_files_object_key_uq ON material_import_files(object_key);--> statement-breakpoint
CREATE INDEX material_import_files_sha_idx ON material_import_files(actual_sha256,batch_id);--> statement-breakpoint
CREATE INDEX material_import_files_storage_idx ON material_import_files(storage_status,updated_at,id);--> statement-breakpoint

CREATE TABLE material_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,sheet_index INTEGER NOT NULL,sheet_name TEXT NOT NULL,row_number INTEGER NOT NULL,raw_values_json TEXT NOT NULL,raw_row_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  CHECK(sheet_index>=0 AND row_number>0 AND length(sheet_name)>0),
  CHECK(json_valid(raw_values_json) AND json_type(raw_values_json)='object'),
  CHECK(length(raw_row_sha256)=64 AND raw_row_sha256 NOT GLOB '*[^0-9a-f]*')
);--> statement-breakpoint
INSERT INTO material_import_rows SELECT * FROM __parser_down_rows;--> statement-breakpoint
DROP TABLE __parser_down_rows;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_rows_position_uq ON material_import_rows(batch_id,sheet_index,row_number);--> statement-breakpoint

CREATE TABLE material_import_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,batch_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor_type TEXT NOT NULL,actor_identifier TEXT,previous_status TEXT,new_status TEXT,request_id TEXT NOT NULL,safe_details_json TEXT,created_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  CHECK(event_type IN ('BATCH_CREATED','FILE_UPLOAD_STARTED','FILE_STORED','FILE_UPLOAD_COMPLETED','FILE_UPLOAD_FAILED','FILE_SECURITY_CHECK_PASSED','FILE_SECURITY_CHECK_FAILED','RECONCILIATION_REQUIRED','BATCH_CANCELLED','FILE_DELETE_REQUESTED','FILE_DELETED','FILE_DELETE_FAILED')),
  CHECK(actor_type IN ('USER','SYSTEM')),
  CHECK((previous_status IS NULL OR previous_status IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED')) AND (new_status IS NULL OR new_status IN ('CREATED','UPLOAD_PENDING','FILE_READY','RECONCILIATION_REQUIRED','FAILED','CANCELLED'))),
  CHECK(safe_details_json IS NULL OR json_valid(safe_details_json))
);--> statement-breakpoint
INSERT INTO material_import_events SELECT * FROM __parser_down_events;--> statement-breakpoint
DROP TABLE __parser_down_events;--> statement-breakpoint
CREATE INDEX material_import_events_batch_created_idx ON material_import_events(batch_id,created_at,id);--> statement-breakpoint

CREATE TABLE material_import_idempotency (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,username TEXT NOT NULL,method TEXT NOT NULL,route_scope TEXT NOT NULL,key_digest TEXT NOT NULL,request_digest TEXT NOT NULL,operation_id TEXT NOT NULL,state TEXT NOT NULL,batch_id INTEGER,file_id INTEGER,lease_token_digest TEXT NOT NULL,lease_expires_at INTEGER,status_code INTEGER,response_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at INTEGER,recovery_until INTEGER NOT NULL,
  FOREIGN KEY(username) REFERENCES app_users(username) ON DELETE RESTRICT,
  FOREIGN KEY(batch_id) REFERENCES material_import_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY(file_id) REFERENCES material_import_files(id) ON DELETE RESTRICT,
  CHECK(method='POST'),CHECK(length(route_scope) BETWEEN 1 AND 255),CHECK(length(key_digest)=64 AND length(request_digest)=64 AND length(lease_token_digest)=64),CHECK(length(operation_id)=36),CHECK(state IN ('PENDING','COMPLETED')),
  CHECK((state='PENDING' AND lease_expires_at>0 AND status_code IS NULL AND response_json IS NULL AND expires_at IS NULL) OR (state='COMPLETED' AND lease_expires_at IS NULL AND status_code BETWEEN 100 AND 599 AND json_valid(response_json) AND expires_at>0)),CHECK(recovery_until>0)
);--> statement-breakpoint
INSERT INTO material_import_idempotency SELECT * FROM __parser_down_idempotency;--> statement-breakpoint
DROP TABLE __parser_down_idempotency;--> statement-breakpoint
CREATE UNIQUE INDEX material_import_idempotency_scope_uq ON material_import_idempotency(username,method,route_scope,key_digest);--> statement-breakpoint
CREATE UNIQUE INDEX material_import_idempotency_operation_uq ON material_import_idempotency(operation_id);--> statement-breakpoint
CREATE INDEX material_import_idempotency_recovery_idx ON material_import_idempotency(state,recovery_until,id);--> statement-breakpoint
-- End of protected 0005 rollback.
