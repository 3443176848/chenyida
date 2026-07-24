ALTER TABLE "material_import_normalization_runs"
  ADD COLUMN "source_file_id" bigint,
  ADD COLUMN "source_sheet_id" bigint,
  ADD COLUMN "source_schema_digest" text,
  ADD COLUMN "normalizer_rule_version" text,
  ADD COLUMN "mapping_snapshot" jsonb,
  ADD COLUMN "run_version" integer,
  ADD COLUMN "expected_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "supersedes_run_id" bigint,
  ADD COLUMN "worker_job_id" uuid,
  ADD COLUMN "skipped_rows" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "issue_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "warning_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "error_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "normalized_json_bytes" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "rerun_reason" text,
  ADD COLUMN "published_at" timestamptz,
  ADD COLUMN "cancel_requested_at" timestamptz,
  ADD COLUMN "cancelled_at" timestamptz,
  ADD COLUMN "cancelled_by" text;

UPDATE "material_import_normalization_runs" r
SET
  "source_file_id"=f."id",
  "source_sheet_id"=s."id",
  "source_schema_digest"=m."source_structure_digest",
  "normalizer_rule_version"=r."processor_version",
  "mapping_snapshot"=COALESCE(m."mapping_snapshot",jsonb_build_object(
    'schema_version',1,
    'legacy_backfill',true,
    'mapping_id',m."id",
    'mapping_version',m."mapping_version"
  )),
  "run_status"=CASE WHEN r."run_status"='STAGED' THEN 'PUBLISHING' ELSE r."run_status" END,
  "published_at"=CASE WHEN r."run_status" IN ('SUCCEEDED','SUPERSEDED') THEN COALESCE(r."completed_at",r."updated_at") ELSE NULL END
FROM "material_import_mappings" m
JOIN "material_import_files" f ON f."batch_id"=m."batch_id"
JOIN "material_import_parse_sheets" s
  ON s."parse_run_id"=m."parse_run_id" AND s."sheet_index"=m."selected_sheet_index"
WHERE m."id"=r."mapping_id";

WITH versions AS (
  SELECT "id",row_number() OVER (PARTITION BY "batch_id" ORDER BY "id")::integer AS "run_version"
  FROM "material_import_normalization_runs"
)
UPDATE "material_import_normalization_runs" r
SET "run_version"=v."run_version"
FROM versions v
WHERE v."id"=r."id";

UPDATE "material_import_normalization_runs" r
SET
  "issue_count"=counts."issue_count",
  "warning_count"=counts."warning_count",
  "error_count"=counts."error_count",
  "normalized_json_bytes"=counts."normalized_json_bytes"
FROM (
  SELECT
    run."id",
    count(issue."id")::integer AS "issue_count",
    count(issue."id") FILTER (WHERE issue."issue_level"='WARNING')::integer AS "warning_count",
    count(issue."id") FILTER (WHERE issue."issue_level"='ERROR')::integer AS "error_count",
    COALESCE(max(rows."normalized_json_bytes"),0)::bigint AS "normalized_json_bytes"
  FROM "material_import_normalization_runs" run
  LEFT JOIN "material_import_normalization_issues" issue ON issue."normalization_run_id"=run."id"
  LEFT JOIN (
    SELECT "normalization_run_id",sum(pg_column_size("normalized_payload"))::bigint AS "normalized_json_bytes"
    FROM "material_import_normalized_rows"
    GROUP BY "normalization_run_id"
  ) rows ON rows."normalization_run_id"=run."id"
  GROUP BY run."id"
) counts
WHERE counts."id"=r."id";

ALTER TABLE "material_import_normalization_runs"
  ALTER COLUMN "source_file_id" SET NOT NULL,
  ALTER COLUMN "source_sheet_id" SET NOT NULL,
  ALTER COLUMN "source_schema_digest" SET NOT NULL,
  ALTER COLUMN "normalizer_rule_version" SET NOT NULL,
  ALTER COLUMN "mapping_snapshot" SET NOT NULL,
  ALTER COLUMN "run_version" SET NOT NULL,
  ADD CONSTRAINT "material_import_normalization_runs_source_file_fk"
    FOREIGN KEY ("source_file_id") REFERENCES "material_import_files"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalization_runs_source_sheet_fk"
    FOREIGN KEY ("source_sheet_id") REFERENCES "material_import_parse_sheets"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalization_runs_supersedes_fk"
    FOREIGN KEY ("supersedes_run_id") REFERENCES "material_import_normalization_runs"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalization_runs_cancelled_by_fk"
    FOREIGN KEY ("cancelled_by") REFERENCES "app_users"("username") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalization_runs_status_ck"
    CHECK ("run_status" IN ('QUEUED','RUNNING','PUBLISHING','SUCCEEDED','SUPERSEDED','FAILED','CANCEL_REQUESTED','CANCELLED')),
  ADD CONSTRAINT "material_import_normalization_runs_stage_ck"
    CHECK ("current_stage" IN ('LOAD_MAPPING','READ_SOURCE_ROWS','NORMALIZE_ROWS','VERIFY_RESULT','PUBLISH_RESULT','COMPLETE')),
  ADD CONSTRAINT "material_import_normalization_runs_digest_ck"
    CHECK (
      "mapping_digest" ~ '^[0-9a-f]{64}$'
      AND "source_schema_digest" ~ '^[0-9a-f]{64}$'
      AND "metadata_digest" ~ '^[0-9a-f]{64}$'
      AND ("result_digest" IS NULL OR "result_digest" ~ '^[0-9a-f]{64}$')
    ),
  ADD CONSTRAINT "material_import_normalization_runs_counts_ck"
    CHECK (
      "run_version">0 AND "expected_version">0 AND "retry_count">=0 AND "attempt_no">0
      AND "total_rows">=0 AND "processed_rows" BETWEEN 0 AND "total_rows"
      AND "valid_rows">=0 AND "warning_rows">=0 AND "error_rows">=0 AND "skipped_rows">=0
      AND "valid_rows"+"warning_rows"+"error_rows"+"skipped_rows"<="processed_rows"
      AND "issue_count">=0 AND "warning_count">=0 AND "error_count">=0
      AND "warning_count"+"error_count"="issue_count"
      AND "normalized_json_bytes">=0
    ),
  ADD CONSTRAINT "material_import_normalization_runs_mapping_snapshot_ck"
    CHECK (jsonb_typeof("mapping_snapshot")='object' AND pg_column_size("mapping_snapshot")<=1048576),
  ADD CONSTRAINT "material_import_normalization_runs_publish_ck"
    CHECK (
      ("run_status" IN ('SUCCEEDED','SUPERSEDED') AND "published_at" IS NOT NULL AND "result_digest" IS NOT NULL AND "completed_at" IS NOT NULL)
      OR ("run_status" NOT IN ('SUCCEEDED','SUPERSEDED') AND "published_at" IS NULL)
    ),
  ADD CONSTRAINT "material_import_normalization_runs_cancel_ck"
    CHECK (
      ("run_status"='CANCEL_REQUESTED' AND "cancel_requested_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancelled_at" IS NULL)
      OR ("run_status"='CANCELLED' AND "cancel_requested_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancelled_at" IS NOT NULL)
      OR ("run_status" NOT IN ('CANCEL_REQUESTED','CANCELLED') AND "cancel_requested_at" IS NULL AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL)
    ),
  ADD CONSTRAINT "material_import_normalization_runs_failure_ck"
    CHECK (
      ("run_status"='FAILED' AND "failure_code" IS NOT NULL AND length(trim("failure_code")) BETWEEN 3 AND 100 AND "safe_failure_message" IS NOT NULL)
      OR ("run_status"<>'FAILED' AND "failure_code" IS NULL AND "safe_failure_message" IS NULL)
    ),
  ADD CONSTRAINT "material_import_normalization_runs_rerun_reason_ck"
    CHECK ("rerun_reason" IS NULL OR length(trim("rerun_reason")) BETWEEN 1 AND 500);

CREATE UNIQUE INDEX "material_import_normalization_runs_batch_version_uq"
  ON "material_import_normalization_runs" ("batch_id","run_version");
CREATE UNIQUE INDEX "material_import_normalization_runs_active_uq"
  ON "material_import_normalization_runs" ("batch_id")
  WHERE "run_status" IN ('QUEUED','RUNNING','PUBLISHING','CANCEL_REQUESTED');
CREATE INDEX "material_import_normalization_runs_history_idx"
  ON "material_import_normalization_runs" ("batch_id","run_version" DESC,"id" DESC);

ALTER TABLE "material_import_normalized_rows"
  ADD COLUMN "source_row_id" bigint,
  ADD COLUMN "source_sheet_id" bigint,
  ADD COLUMN "source_sheet_name" text,
  ADD COLUMN "core_candidate_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "attribute_candidate_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "issue_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;

UPDATE "material_import_normalized_rows" n
SET
  "source_row_id"=r."id",
  "source_sheet_id"=s."id",
  "source_sheet_name"=s."sheet_name",
  "issue_count"=n."error_count"+n."warning_count",
  "result_summary"=jsonb_build_object(
    'legacy_backfill',true,
    'issue_count',n."error_count"+n."warning_count"
  )
FROM "material_import_normalization_runs" run
JOIN "material_import_rows" r
  ON r."parse_run_id"=run."parse_run_id"
JOIN "material_import_parse_sheets" s
  ON s."parse_run_id"=run."parse_run_id" AND s."sheet_index"=r."sheet_index"
WHERE run."id"=n."normalization_run_id"
  AND r."sheet_index"=n."source_sheet_index"
  AND r."row_number"=n."source_row_number";

ALTER TABLE "material_import_normalized_rows"
  ALTER COLUMN "source_row_id" SET NOT NULL,
  ALTER COLUMN "source_sheet_id" SET NOT NULL,
  ALTER COLUMN "source_sheet_name" SET NOT NULL,
  ADD CONSTRAINT "material_import_normalized_rows_source_row_fk"
    FOREIGN KEY ("source_row_id") REFERENCES "material_import_rows"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalized_rows_source_sheet_fk"
    FOREIGN KEY ("source_sheet_id") REFERENCES "material_import_parse_sheets"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalized_rows_status_ck"
    CHECK (
      ("row_status"='VALID' AND "error_count"=0 AND "warning_count"=0)
      OR ("row_status"='WARNING' AND "error_count"=0 AND "warning_count">0)
      OR ("row_status"='ERROR' AND "error_count">0)
      OR ("row_status"='SKIPPED' AND "error_count"=0 AND "warning_count"=0)
    ),
  ADD CONSTRAINT "material_import_normalized_rows_counts_ck"
    CHECK (
      "core_candidate_count">=0 AND "attribute_candidate_count">=0 AND "issue_count">=0
      AND "error_count">=0 AND "warning_count">=0
      AND "issue_count"="error_count"+"warning_count"
    ),
  ADD CONSTRAINT "material_import_normalized_rows_hash_ck"
    CHECK ("source_raw_row_hash" ~ '^[0-9a-f]{64}$' AND "normalized_payload_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "material_import_normalized_rows_payload_ck"
    CHECK (
      jsonb_typeof("normalized_payload")='object'
      AND pg_column_size("normalized_payload")<=262144
      AND ("mapped_values" IS NULL OR jsonb_typeof("mapped_values")='object')
      AND jsonb_typeof("result_summary")='object'
    );

CREATE UNIQUE INDEX "material_import_normalized_rows_source_uq"
  ON "material_import_normalized_rows" ("normalization_run_id","source_row_id");
DROP INDEX "material_import_normalized_rows_status_idx";
CREATE INDEX "material_import_normalized_rows_status_idx"
  ON "material_import_normalized_rows" ("normalization_run_id","row_status","id");

ALTER TABLE "material_import_normalization_issues"
  ADD COLUMN "issue_key" text,
  ADD COLUMN "attribute_code" text,
  ADD COLUMN "source_value_summary" jsonb,
  ADD COLUMN "rule_code" text;

UPDATE "material_import_normalization_issues"
SET
  "issue_key"=repeat(md5(concat_ws('|',"normalization_run_id","normalized_row_id","issue_level","issue_code","target_code",COALESCE("source_column_index",-1))),2),
  "attribute_code"=CASE WHEN "target_code" LIKE 'attribute.%' THEN split_part("target_code",'.',2) ELSE NULL END,
  "rule_code"="issue_code";

ALTER TABLE "material_import_normalization_issues"
  ALTER COLUMN "issue_key" SET NOT NULL,
  ALTER COLUMN "rule_code" SET NOT NULL,
  DROP CONSTRAINT "material_import_normalization_issues_normalization_run_id_material_import_normalization_runs_id_fk",
  DROP CONSTRAINT "material_import_normalization_issues_normalized_row_id_material_import_normalized_rows_id_fk",
  ADD CONSTRAINT "material_import_normalization_issues_run_fk"
    FOREIGN KEY ("normalization_run_id") REFERENCES "material_import_normalization_runs"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalization_issues_row_fk"
    FOREIGN KEY ("normalized_row_id") REFERENCES "material_import_normalized_rows"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_normalization_issues_level_ck"
    CHECK ("issue_level" IN ('ERROR','WARNING')),
  ADD CONSTRAINT "material_import_normalization_issues_code_ck"
    CHECK (
      "issue_code" ~ '^[A-Z][A-Z0-9_]{2,99}$'
      AND length("target_code") BETWEEN 3 AND 160
      AND length("safe_message") BETWEEN 1 AND 500
      AND "rule_code" ~ '^[A-Z][A-Z0-9_]{2,127}$'
    ),
  ADD CONSTRAINT "material_import_normalization_issues_details_ck"
    CHECK (
      jsonb_typeof("safe_details")='object'
      AND pg_column_size("safe_details")<=16384
      AND ("source_value_summary" IS NULL OR pg_column_size("source_value_summary")<=16384)
    );

CREATE UNIQUE INDEX "material_import_normalization_issues_idempotent_uq"
  ON "material_import_normalization_issues" ("normalization_run_id","issue_key");
DROP INDEX "material_import_normalization_issues_filter_idx";
CREATE INDEX "material_import_normalization_issues_filter_idx"
  ON "material_import_normalization_issues" ("normalization_run_id","issue_level","issue_code","id");
CREATE INDEX "material_import_normalization_issues_row_idx"
  ON "material_import_normalization_issues" ("normalized_row_id","id");

CREATE TABLE "material_import_normalized_field_candidates" (
  "id" bigserial PRIMARY KEY,
  "normalization_run_id" bigint NOT NULL REFERENCES "material_import_normalization_runs"("id") ON DELETE restrict,
  "normalized_row_id" bigint NOT NULL REFERENCES "material_import_normalized_rows"("id") ON DELETE restrict,
  "target_namespace" text NOT NULL,
  "target_field_code" text NOT NULL,
  "raw_value" jsonb,
  "normalized_value" jsonb,
  "value_state" text NOT NULL,
  "validation_status" text NOT NULL,
  "transformation_rule_code" text NOT NULL,
  "transformation_rule_version" text NOT NULL,
  "display_order" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_normalized_field_candidates_namespace_ck"
    CHECK ("target_namespace" IN ('basic','category_hint','supplier_reference')),
  CONSTRAINT "material_import_normalized_field_candidates_status_ck"
    CHECK ("validation_status" IN ('VALID','WARNING','ERROR','EMPTY')),
  CONSTRAINT "material_import_normalized_field_candidates_size_ck"
    CHECK (
      ("raw_value" IS NULL OR pg_column_size("raw_value")<=16384)
      AND ("normalized_value" IS NULL OR pg_column_size("normalized_value")<=16384)
    )
);

CREATE UNIQUE INDEX "material_import_normalized_field_candidates_target_uq"
  ON "material_import_normalized_field_candidates" ("normalization_run_id","normalized_row_id","target_namespace","target_field_code");
CREATE INDEX "material_import_normalized_field_candidates_row_idx"
  ON "material_import_normalized_field_candidates" ("normalized_row_id","display_order","id");

CREATE TABLE "material_import_normalized_attribute_candidates" (
  "id" bigserial PRIMARY KEY,
  "normalization_run_id" bigint NOT NULL REFERENCES "material_import_normalization_runs"("id") ON DELETE restrict,
  "normalized_row_id" bigint NOT NULL REFERENCES "material_import_normalized_rows"("id") ON DELETE restrict,
  "attribute_code" text NOT NULL,
  "attribute_name_snapshot" text NOT NULL,
  "data_type" text NOT NULL,
  "raw_value" jsonb,
  "normalized_value" jsonb,
  "unit_code" text,
  "validation_status" text NOT NULL,
  "transformation_rule_code" text NOT NULL,
  "transformation_rule_version" text NOT NULL,
  "display_order" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_normalized_attribute_candidates_code_ck"
    CHECK ("attribute_code" ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  CONSTRAINT "material_import_normalized_attribute_candidates_type_ck"
    CHECK ("data_type" IN ('TEXT','INTEGER','DECIMAL','BOOLEAN','DATE','ENUM')),
  CONSTRAINT "material_import_normalized_attribute_candidates_status_ck"
    CHECK ("validation_status" IN ('VALID','WARNING','ERROR','EMPTY')),
  CONSTRAINT "material_import_normalized_attribute_candidates_size_ck"
    CHECK (
      ("raw_value" IS NULL OR pg_column_size("raw_value")<=16384)
      AND ("normalized_value" IS NULL OR pg_column_size("normalized_value")<=16384)
    )
);

CREATE UNIQUE INDEX "material_import_normalized_attribute_candidates_target_uq"
  ON "material_import_normalized_attribute_candidates" ("normalization_run_id","normalized_row_id","attribute_code");
CREATE INDEX "material_import_normalized_attribute_candidates_row_idx"
  ON "material_import_normalized_attribute_candidates" ("normalized_row_id","display_order","id");

CREATE TABLE "material_import_normalization_lineage" (
  "id" bigserial PRIMARY KEY,
  "normalization_run_id" bigint NOT NULL REFERENCES "material_import_normalization_runs"("id") ON DELETE restrict,
  "normalized_row_id" bigint NOT NULL REFERENCES "material_import_normalized_rows"("id") ON DELETE restrict,
  "target_namespace" text NOT NULL,
  "target_field_code" text NOT NULL,
  "target_attribute_code" text,
  "source_sheet_id" bigint NOT NULL REFERENCES "material_import_parse_sheets"("id") ON DELETE restrict,
  "source_sheet_name" text NOT NULL,
  "source_row_number" integer NOT NULL,
  "source_column_index" integer,
  "source_column_name" text,
  "source_field_key" text,
  "raw_value_summary" jsonb,
  "normalized_value_summary" jsonb,
  "mapping_id" bigint NOT NULL REFERENCES "material_import_mappings"("id") ON DELETE restrict,
  "mapping_digest" text NOT NULL,
  "transformation_rule_code" text NOT NULL,
  "transformation_rule_version" text NOT NULL,
  "transformation_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "lineage_ordinal" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_normalization_lineage_namespace_ck"
    CHECK ("target_namespace" IN ('basic','attribute','category_hint','supplier_reference')),
  CONSTRAINT "material_import_normalization_lineage_position_ck"
    CHECK ("source_row_number">0 AND ("source_column_index" IS NULL OR "source_column_index">=0) AND "lineage_ordinal">=0),
  CONSTRAINT "material_import_normalization_lineage_digest_ck"
    CHECK ("mapping_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "material_import_normalization_lineage_steps_ck"
    CHECK (jsonb_typeof("transformation_steps")='array' AND pg_column_size("transformation_steps")<=16384)
);

CREATE UNIQUE INDEX "material_import_normalization_lineage_source_uq"
  ON "material_import_normalization_lineage" ("normalization_run_id","normalized_row_id","target_namespace","target_field_code","lineage_ordinal");
CREATE INDEX "material_import_normalization_lineage_row_idx"
  ON "material_import_normalization_lineage" ("normalized_row_id","target_namespace","target_field_code","lineage_ordinal");

CREATE OR REPLACE FUNCTION material_import_normalization_result_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_run_id bigint;
  already_published boolean;
BEGIN
  parent_run_id := CASE WHEN TG_OP='DELETE' THEN OLD."normalization_run_id" ELSE NEW."normalization_run_id" END;
  SELECT "published_at" IS NOT NULL INTO already_published
  FROM "material_import_normalization_runs"
  WHERE "id"=parent_run_id;
  IF already_published THEN
    RAISE EXCEPTION 'published normalization result is immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "material_import_normalized_rows_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_normalized_rows"
FOR EACH ROW EXECUTE FUNCTION material_import_normalization_result_immutable_guard();
CREATE TRIGGER "material_import_normalization_issues_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_normalization_issues"
FOR EACH ROW EXECUTE FUNCTION material_import_normalization_result_immutable_guard();
CREATE TRIGGER "material_import_normalized_field_candidates_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_normalized_field_candidates"
FOR EACH ROW EXECUTE FUNCTION material_import_normalization_result_immutable_guard();
CREATE TRIGGER "material_import_normalized_attribute_candidates_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_normalized_attribute_candidates"
FOR EACH ROW EXECUTE FUNCTION material_import_normalization_result_immutable_guard();
CREATE TRIGGER "material_import_normalization_lineage_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_normalization_lineage"
FOR EACH ROW EXECUTE FUNCTION material_import_normalization_result_immutable_guard();
