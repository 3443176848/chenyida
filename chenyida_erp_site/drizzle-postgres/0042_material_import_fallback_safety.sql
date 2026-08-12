CREATE TABLE "material_import_upload_operations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"expected_batch_version" integer NOT NULL,
	"declared_filename" text NOT NULL,
	"filename_extension" text NOT NULL,
	"declared_mime_type" text DEFAULT '' NOT NULL,
	"declared_sha256" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"duplicate_action" text NOT NULL,
	"staging_relative_path" text NOT NULL,
	"final_relative_path" text NOT NULL,
	"phase" text DEFAULT 'PREPARED' NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"staged_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"promoted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_import_upload_operations_version_ck" CHECK ("material_import_upload_operations"."expected_batch_version" > 0),
	CONSTRAINT "material_import_upload_operations_filename_ck" CHECK (length(btrim("material_import_upload_operations"."declared_filename")) between 1 and 255 and position('/' in "material_import_upload_operations"."declared_filename")=0 and position(chr(92) in "material_import_upload_operations"."declared_filename")=0 and "material_import_upload_operations"."declared_filename" !~ '[[:cntrl:]]'),
	CONSTRAINT "material_import_upload_operations_extension_ck" CHECK ("material_import_upload_operations"."filename_extension" in ('.csv','.xls','.xlsx')),
	CONSTRAINT "material_import_upload_operations_mime_ck" CHECK (length("material_import_upload_operations"."declared_mime_type") <= 255 and "material_import_upload_operations"."declared_mime_type" !~ '[[:cntrl:]]'),
	CONSTRAINT "material_import_upload_operations_sha_ck" CHECK ("material_import_upload_operations"."declared_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "material_import_upload_operations_size_ck" CHECK ("material_import_upload_operations"."declared_size_bytes" between 1 and 10485760),
	CONSTRAINT "material_import_upload_operations_duplicate_action_ck" CHECK ("material_import_upload_operations"."duplicate_action" in ('REJECT','ALLOW_DUPLICATE')),
	CONSTRAINT "material_import_upload_operations_staging_path_ck" CHECK ("material_import_upload_operations"."staging_relative_path"='material-import/.staging/'||"material_import_upload_operations"."operation_id"::text||'.ready'),
	CONSTRAINT "material_import_upload_operations_final_path_ck" CHECK ("material_import_upload_operations"."final_relative_path"='material-import/'||"material_import_upload_operations"."batch_id"::text||'/'||"material_import_upload_operations"."operation_id"::text||"material_import_upload_operations"."filename_extension"),
	CONSTRAINT "material_import_upload_operations_phase_ck" CHECK ("material_import_upload_operations"."phase" in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','PUBLISHED','FAILED','RECONCILIATION_REQUIRED')),
	CONSTRAINT "material_import_upload_operations_failure_ck" CHECK (("material_import_upload_operations"."phase" in ('FAILED','RECONCILIATION_REQUIRED') and "material_import_upload_operations"."failure_code" is not null) or ("material_import_upload_operations"."phase" not in ('FAILED','RECONCILIATION_REQUIRED') and "material_import_upload_operations"."failure_code" is null and "material_import_upload_operations"."failure_message" is null)),
	CONSTRAINT "material_import_upload_operations_failure_bounds_ck" CHECK (("material_import_upload_operations"."failure_code" is null or "material_import_upload_operations"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,99}$') and ("material_import_upload_operations"."failure_message" is null or length("material_import_upload_operations"."failure_message") between 1 and 500)),
	CONSTRAINT "material_import_upload_operations_lifecycle_ck" CHECK (("material_import_upload_operations"."staged_at" is null or "material_import_upload_operations"."staged_at">="material_import_upload_operations"."created_at") and ("material_import_upload_operations"."checked_at" is null or ("material_import_upload_operations"."staged_at" is not null and "material_import_upload_operations"."checked_at">="material_import_upload_operations"."staged_at")) and ("material_import_upload_operations"."promoted_at" is null or ("material_import_upload_operations"."checked_at" is not null and "material_import_upload_operations"."promoted_at">="material_import_upload_operations"."checked_at")) and ("material_import_upload_operations"."completed_at" is null or ("material_import_upload_operations"."completed_at">="material_import_upload_operations"."created_at" and ("material_import_upload_operations"."phase" in ('PUBLISHED','FAILED') or "material_import_upload_operations"."phase"='RECONCILIATION_REQUIRED')))),
	CONSTRAINT "material_import_upload_operations_phase_facts_ck" CHECK (("material_import_upload_operations"."phase"='PREPARED' and "material_import_upload_operations"."staged_at" is null and "material_import_upload_operations"."checked_at" is null and "material_import_upload_operations"."promoted_at" is null and "material_import_upload_operations"."completed_at" is null) or ("material_import_upload_operations"."phase"='STAGED' and "material_import_upload_operations"."staged_at" is not null and "material_import_upload_operations"."checked_at" is null and "material_import_upload_operations"."promoted_at" is null and "material_import_upload_operations"."completed_at" is null) or ("material_import_upload_operations"."phase"='SECURITY_PASSED' and "material_import_upload_operations"."staged_at" is not null and "material_import_upload_operations"."checked_at" is not null and "material_import_upload_operations"."promoted_at" is null and "material_import_upload_operations"."completed_at" is null) or ("material_import_upload_operations"."phase"='PROMOTED' and "material_import_upload_operations"."staged_at" is not null and "material_import_upload_operations"."checked_at" is not null and "material_import_upload_operations"."promoted_at" is not null and "material_import_upload_operations"."completed_at" is null) or ("material_import_upload_operations"."phase"='PUBLISHED' and "material_import_upload_operations"."staged_at" is not null and "material_import_upload_operations"."checked_at" is not null and "material_import_upload_operations"."promoted_at" is not null and "material_import_upload_operations"."completed_at" is not null) or ("material_import_upload_operations"."phase"='FAILED' and "material_import_upload_operations"."completed_at" is not null) or "material_import_upload_operations"."phase"='RECONCILIATION_REQUIRED')
);
--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "staging_relative_path" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "filename_extension" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "declared_mime_type" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "declared_sha256" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "declared_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "detected_file_type" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "actual_sha256" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "actual_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "security_check_status" text DEFAULT 'NOT_APPLICABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "security_failure_code" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "security_failure_message" text;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "security_warning_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "material_import_files" AS f
SET
	"filename_extension" = CASE
		WHEN lower(f."original_filename") LIKE '%.xlsx' THEN '.xlsx'
		WHEN lower(f."original_filename") LIKE '%.xls' THEN '.xls'
		WHEN lower(f."original_filename") LIKE '%.csv' THEN '.csv'
		ELSE NULL
	END,
	"actual_sha256" = f."sha256",
	"actual_size_bytes" = f."size_bytes",
	"security_check_status" = 'LEGACY_UNVERIFIED',
	"uploaded_at" = f."created_at",
	"updated_at" = greatest(f."updated_at", f."created_at")
FROM "material_import_batches" AS b
WHERE b."id"=f."batch_id" AND b."source_kind" IN ('CSV','XLSX');--> statement-breakpoint
DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "material_import_batches" b
		LEFT JOIN "material_import_batches" parent ON parent."id"=b."retry_of_batch_id"
		WHERE b."retry_of_batch_id" IS NOT NULL AND (parent."id" IS NULL OR b."retry_of_batch_id"=b."id")
	) THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='MATERIAL_IMPORT_0042_RETRY_REFERENCE_INVALID'; END IF;
	IF EXISTS (
		SELECT 1 FROM "material_import_batches"
		WHERE "file_count" NOT BETWEEN 0 AND 1 OR "total_rows" < 0 OR "accepted_rows" < 0 OR "rejected_rows" < 0 OR "accepted_rows"+"rejected_rows">"total_rows"
	) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MATERIAL_IMPORT_0042_BATCH_COUNTS_INVALID'; END IF;
	IF EXISTS (
		SELECT 1 FROM "material_import_files" GROUP BY "storage_name" HAVING count(*)>1
	) THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='MATERIAL_IMPORT_0042_STORAGE_NAME_DUPLICATE'; END IF;
	IF EXISTS (
		SELECT 1 FROM "material_import_idempotency" i
		LEFT JOIN "material_import_files" f ON f."id"=i."file_id"
		WHERE i."file_id" IS NOT NULL AND (i."batch_id" IS NULL OR f."id" IS NULL OR f."batch_id"<>i."batch_id")
	) THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='MATERIAL_IMPORT_0042_IDEMPOTENCY_FILE_BATCH_INVALID'; END IF;
	IF EXISTS (
		SELECT 1 FROM "material_import_idempotency"
		WHERE "method" NOT IN ('POST','PUT','DELETE') OR "state" NOT IN ('PENDING','COMPLETED')
			OR "key_digest" !~ '^[0-9a-f]{64}$' OR "request_digest" !~ '^[0-9a-f]{64}$'
			OR length(btrim("route_scope")) NOT BETWEEN 1 AND 255
			OR (("lease_token" IS NULL)<>("lease_expires_at" IS NULL))
			OR ("state"='PENDING' AND ("response" IS NOT NULL OR "status_code" IS NOT NULL OR "lease_token" IS NULL))
			OR ("state"='COMPLETED' AND ("response" IS NULL OR "status_code" NOT BETWEEN 200 AND 599 OR "lease_token" IS NOT NULL OR "expires_at" IS NULL))
			OR "recovery_until" <= "created_at"
			OR ("expires_at" IS NOT NULL AND ("expires_at" <= "created_at" OR "recovery_until" < "expires_at"))
			OR ("lease_expires_at" IS NOT NULL AND "lease_expires_at" <= "created_at")
	) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MATERIAL_IMPORT_0042_IDEMPOTENCY_LIFECYCLE_INVALID'; END IF;
END
$migration$;--> statement-breakpoint
ALTER TABLE "material_import_upload_operations" ADD CONSTRAINT "material_import_upload_operations_operation_id_material_import_idempotency_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."material_import_idempotency"("operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_upload_operations" ADD CONSTRAINT "material_import_upload_operations_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_upload_operations_batch_uq" ON "material_import_upload_operations" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_upload_operations_staging_path_uq" ON "material_import_upload_operations" USING btree ("staging_relative_path");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_upload_operations_final_path_uq" ON "material_import_upload_operations" USING btree ("final_relative_path");--> statement-breakpoint
CREATE INDEX "material_import_upload_operations_recovery_idx" ON "material_import_upload_operations" USING btree ("phase","updated_at","operation_id") WHERE "material_import_upload_operations"."phase" in ('PREPARED','STAGED','SECURITY_PASSED','PROMOTED','RECONCILIATION_REQUIRED');--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_retry_of_batch_id_material_import_batches_id_fk" FOREIGN KEY ("retry_of_batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_import_batches_retry_idx" ON "material_import_batches" USING btree ("retry_of_batch_id") WHERE "material_import_batches"."retry_of_batch_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_files_id_batch_uq" ON "material_import_files" USING btree ("id","batch_id");--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_file_batch_fk" FOREIGN KEY ("file_id","batch_id") REFERENCES "public"."material_import_files"("id","batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_files_storage_name_uq" ON "material_import_files" USING btree ("storage_name");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_files_staging_path_uq" ON "material_import_files" USING btree ("staging_relative_path") WHERE "material_import_files"."staging_relative_path" is not null;--> statement-breakpoint
CREATE INDEX "material_import_files_actual_sha_idx" ON "material_import_files" USING btree ("actual_sha256") WHERE "material_import_files"."actual_sha256" is not null;--> statement-breakpoint
CREATE INDEX "material_import_files_recovery_idx" ON "material_import_files" USING btree ("storage_status","updated_at") WHERE "material_import_files"."storage_status" in ('STAGING','STAGED','RECONCILIATION_REQUIRED','DELETE_PENDING');--> statement-breakpoint
CREATE INDEX "material_import_idempotency_lease_idx" ON "material_import_idempotency" USING btree ("state","lease_expires_at") WHERE "material_import_idempotency"."state"='PENDING';--> statement-breakpoint
CREATE INDEX "material_import_idempotency_recovery_idx" ON "material_import_idempotency" USING btree ("state","recovery_until","id") WHERE "material_import_idempotency"."state"='PENDING';--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_retry_not_self_ck" CHECK ("material_import_batches"."retry_of_batch_id" is null or "material_import_batches"."retry_of_batch_id" <> "material_import_batches"."id");--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_counts_ck" CHECK ("material_import_batches"."file_count" between 0 and 1 and "material_import_batches"."total_rows" >= 0 and "material_import_batches"."accepted_rows" >= 0 and "material_import_batches"."rejected_rows" >= 0 and "material_import_batches"."accepted_rows"+"material_import_batches"."rejected_rows" <= "material_import_batches"."total_rows");--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_declared_sha_ck" CHECK ("material_import_files"."declared_sha256" is null or "material_import_files"."declared_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_declared_size_ck" CHECK ("material_import_files"."declared_size_bytes" is null or "material_import_files"."declared_size_bytes" between 1 and 10485760);--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_actual_sha_ck" CHECK ("material_import_files"."actual_sha256" is null or "material_import_files"."actual_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_actual_size_ck" CHECK ("material_import_files"."actual_size_bytes" is null or "material_import_files"."actual_size_bytes" > 0);--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_extension_ck" CHECK ("material_import_files"."filename_extension" is null or "material_import_files"."filename_extension" in ('.csv','.xls','.xlsx'));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_detected_type_ck" CHECK ("material_import_files"."detected_file_type" is null or "material_import_files"."detected_file_type" in ('CSV','XLS','XLSX'));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_storage_status_ck" CHECK ("material_import_files"."storage_status" in ('STAGING','STAGED','STORED','RECONCILIATION_REQUIRED','STORAGE_FAILED','DELETE_PENDING','DELETED'));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_security_status_ck" CHECK ("material_import_files"."security_check_status" in ('NOT_APPLICABLE','NOT_STARTED','PENDING','BASIC_CHECK_PASSED','REJECTED','LEGACY_UNVERIFIED'));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_warning_codes_ck" CHECK (jsonb_typeof("material_import_files"."security_warning_codes")='array' and pg_column_size("material_import_files"."security_warning_codes")<=4096);--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_actual_facts_ck" CHECK (("material_import_files"."actual_sha256" is null) = ("material_import_files"."actual_size_bytes" is null));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_declared_facts_ck" CHECK (("material_import_files"."declared_sha256" is null) = ("material_import_files"."declared_size_bytes" is null));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_metadata_bounds_ck" CHECK (("material_import_files"."staging_relative_path" is null or "material_import_files"."staging_relative_path" ~ '^material-import/\.staging/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.ready$') and ("material_import_files"."declared_mime_type" is null or (length(btrim("material_import_files"."declared_mime_type")) between 1 and 255 and "material_import_files"."declared_mime_type" !~ '[[:cntrl:]]')) and ("material_import_files"."security_failure_code" is null or "material_import_files"."security_failure_code" ~ '^[A-Z][A-Z0-9_]{0,99}$') and ("material_import_files"."security_failure_message" is null or length("material_import_files"."security_failure_message") between 1 and 500));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_security_failure_ck" CHECK (("material_import_files"."security_check_status"='REJECTED' and "material_import_files"."security_failure_code" is not null) or ("material_import_files"."security_check_status"<>'REJECTED' and "material_import_files"."security_failure_code" is null and "material_import_files"."security_failure_message" is null));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_timestamps_ck" CHECK ("material_import_files"."promoted_at" is null or ("material_import_files"."uploaded_at" is not null and "material_import_files"."promoted_at">="material_import_files"."uploaded_at"));--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_passed_facts_ck" CHECK ("material_import_files"."security_check_status" <> 'BASIC_CHECK_PASSED' or ("material_import_files"."storage_status" in ('STORED','DELETE_PENDING','DELETED') and "material_import_files"."actual_sha256" is not null and "material_import_files"."actual_size_bytes" is not null and "material_import_files"."declared_sha256" is not null and "material_import_files"."declared_size_bytes" is not null and "material_import_files"."filename_extension" is not null and "material_import_files"."detected_file_type" is not null and "material_import_files"."declared_sha256"="material_import_files"."actual_sha256" and "material_import_files"."declared_size_bytes"="material_import_files"."actual_size_bytes" and "material_import_files"."sha256"="material_import_files"."actual_sha256" and "material_import_files"."size_bytes"="material_import_files"."actual_size_bytes" and "material_import_files"."uploaded_at" is not null and "material_import_files"."promoted_at" is not null and (("material_import_files"."filename_extension"='.csv' and "material_import_files"."detected_file_type"='CSV') or ("material_import_files"."filename_extension"='.xls' and "material_import_files"."detected_file_type"='XLS') or ("material_import_files"."filename_extension"='.xlsx' and "material_import_files"."detected_file_type"='XLSX'))));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_method_ck" CHECK ("material_import_idempotency"."method" in ('POST','PUT','DELETE'));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_state_ck" CHECK ("material_import_idempotency"."state" in ('PENDING','COMPLETED'));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_key_digest_ck" CHECK ("material_import_idempotency"."key_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_request_digest_ck" CHECK ("material_import_idempotency"."request_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_lease_ck" CHECK (("material_import_idempotency"."lease_token" is null) = ("material_import_idempotency"."lease_expires_at" is null));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_completion_ck" CHECK (("material_import_idempotency"."state"='PENDING' and "material_import_idempotency"."response" is null and "material_import_idempotency"."status_code" is null and "material_import_idempotency"."lease_token" is not null) or ("material_import_idempotency"."state"='COMPLETED' and "material_import_idempotency"."response" is not null and "material_import_idempotency"."status_code" between 200 and 599 and "material_import_idempotency"."lease_token" is null and "material_import_idempotency"."expires_at" is not null));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_response_ck" CHECK ("material_import_idempotency"."response" is null or (jsonb_typeof("material_import_idempotency"."response")='object' and pg_column_size("material_import_idempotency"."response")<=65536));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_route_ck" CHECK (length(btrim("material_import_idempotency"."route_scope")) between 1 and 255);--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_recovery_ck" CHECK ("material_import_idempotency"."recovery_until" > "material_import_idempotency"."created_at" and ("material_import_idempotency"."expires_at" is null or ("material_import_idempotency"."expires_at">"material_import_idempotency"."created_at" and "material_import_idempotency"."recovery_until">="material_import_idempotency"."expires_at")) and ("material_import_idempotency"."lease_expires_at" is null or "material_import_idempotency"."lease_expires_at">"material_import_idempotency"."created_at"));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_file_batch_ck" CHECK ("material_import_idempotency"."file_id" is null or "material_import_idempotency"."batch_id" is not null);
