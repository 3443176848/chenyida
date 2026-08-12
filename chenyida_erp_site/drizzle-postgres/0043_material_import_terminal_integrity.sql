DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "material_import_upload_operations" o
		JOIN "material_import_idempotency" i ON i."operation_id"=o."operation_id"
		WHERE i."batch_id" IS DISTINCT FROM o."batch_id" OR i."method"<>'POST'
			OR i."route_scope"<>'/api/material-master/import-batches/'||o."batch_id"::text||'/file'
	) THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='MATERIAL_IMPORT_0043_OPERATION_SCOPE_INVALID'; END IF;
	IF EXISTS (
		SELECT 1 FROM "material_import_batches"
		WHERE "source_kind" NOT IN ('CSV','XLSX','PROJECT_REFERENCE')
			OR "status" NOT IN ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED')
			OR (("status" IN ('FAILED','RECONCILIATION_REQUIRED'))<>("failure_stage" IS NOT NULL AND "failure_code" IS NOT NULL AND "failure_message" IS NOT NULL))
			OR ("failure_stage" IS NOT NULL AND "failure_stage" !~ '^[A-Z][A-Z0-9_]{0,99}$')
			OR ("failure_code" IS NOT NULL AND "failure_code" !~ '^[A-Z][A-Z0-9_]{0,99}$')
			OR ("failure_message" IS NOT NULL AND length("failure_message") NOT BETWEEN 1 AND 500)
	) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MATERIAL_IMPORT_0043_BATCH_LIFECYCLE_INVALID'; END IF;
	IF EXISTS (
		SELECT 1 FROM "material_import_idempotency"
		WHERE "response" IS NOT NULL AND (jsonb_typeof("response")<>'object' OR pg_column_size("response")>1048576)
	) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MATERIAL_IMPORT_0043_RESPONSE_INVALID'; END IF;
END
$migration$;--> statement-breakpoint
ALTER TABLE "material_import_idempotency" DROP CONSTRAINT "material_import_idempotency_response_ck";--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_idempotency_operation_batch_uq" ON "material_import_idempotency" USING btree ("operation_id","batch_id");--> statement-breakpoint
ALTER TABLE "material_import_upload_operations" ADD CONSTRAINT "material_import_upload_operations_operation_batch_fk" FOREIGN KEY ("operation_id","batch_id") REFERENCES "public"."material_import_idempotency"("operation_id","batch_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_source_kind_ck" CHECK ("material_import_batches"."source_kind" in ('CSV','XLSX','PROJECT_REFERENCE'));--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_status_ck" CHECK ("material_import_batches"."status" in ('CREATED','UPLOAD_PENDING','FILE_READY','QUEUED_FOR_PARSING','PARSING','PARSED','AWAITING_MAPPING','MAPPING_CONFIRMED','QUEUED_FOR_NORMALIZATION','NORMALIZING','NORMALIZED','RECONCILIATION_REQUIRED','FAILED','CANCELLED'));--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_failure_ck" CHECK (("material_import_batches"."status" in ('FAILED','RECONCILIATION_REQUIRED') and "material_import_batches"."failure_stage" is not null and "material_import_batches"."failure_code" is not null and "material_import_batches"."failure_message" is not null) or ("material_import_batches"."status" not in ('FAILED','RECONCILIATION_REQUIRED') and "material_import_batches"."failure_stage" is null and "material_import_batches"."failure_code" is null and "material_import_batches"."failure_message" is null));--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_failure_bounds_ck" CHECK (("material_import_batches"."failure_stage" is null or "material_import_batches"."failure_stage" ~ '^[A-Z][A-Z0-9_]{0,99}$') and ("material_import_batches"."failure_code" is null or "material_import_batches"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,99}$') and ("material_import_batches"."failure_message" is null or length("material_import_batches"."failure_message") between 1 and 500));--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_response_ck" CHECK ("material_import_idempotency"."response" is null or (jsonb_typeof("material_import_idempotency"."response")='object' and pg_column_size("material_import_idempotency"."response")<=1048576));
