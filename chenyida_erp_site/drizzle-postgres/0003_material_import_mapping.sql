ALTER TABLE "material_import_parse_runs"
  ADD COLUMN "mapping_preparation_status" text DEFAULT 'NOT_STARTED' NOT NULL,
  ADD COLUMN "source_structure_digest" text;

ALTER TABLE "material_import_rows" ADD COLUMN "parse_run_id" bigint;

INSERT INTO "material_import_parse_runs" (
  "batch_id","parser_version","run_status","attempt_no","source_file_sha256","current_stage",
  "rows_written","parsed_sheet_count","mapping_preparation_status","started_at","completed_at","created_at","updated_at"
)
SELECT
  b."id",'selfhost-0001-backfill-v1','SUCCEEDED',1,f."sha256",'COMPLETE',
  count(r."id"),count(DISTINCT r."sheet_index"),'NOT_STARTED',
  min(r."created_at"),max(r."created_at"),min(r."created_at"),max(r."created_at")
FROM "material_import_batches" b
JOIN "material_import_rows" r ON r."batch_id"=b."id"
LEFT JOIN "material_import_files" f ON f."batch_id"=b."id"
WHERE b."current_parse_run_id" IS NULL
GROUP BY b."id",f."sha256";

UPDATE "material_import_batches" b
SET "current_parse_run_id"=p."id"
FROM (
  SELECT DISTINCT ON ("batch_id") "id","batch_id"
  FROM "material_import_parse_runs"
  WHERE "run_status"='SUCCEEDED'
  ORDER BY "batch_id","id" DESC
) p
WHERE b."id"=p."batch_id" AND b."current_parse_run_id" IS NULL;

UPDATE "material_import_rows" r
SET "parse_run_id"=b."current_parse_run_id"
FROM "material_import_batches" b
WHERE b."id"=r."batch_id" AND r."parse_run_id" IS NULL;

ALTER TABLE "material_import_rows"
  ALTER COLUMN "parse_run_id" SET NOT NULL,
  ADD CONSTRAINT "material_import_rows_parse_run_id_material_import_parse_runs_id_fk"
    FOREIGN KEY ("parse_run_id") REFERENCES "material_import_parse_runs"("id") ON DELETE restrict;

DROP INDEX "material_import_rows_position_uq";
DROP INDEX "material_import_rows_batch_idx";
CREATE UNIQUE INDEX "material_import_rows_run_position_uq"
  ON "material_import_rows" ("parse_run_id","sheet_index","row_number");
CREATE INDEX "material_import_rows_batch_run_idx"
  ON "material_import_rows" ("batch_id","parse_run_id","sheet_index","row_number");

INSERT INTO "material_import_parse_sheets" (
  "parse_run_id","sheet_index","sheet_name","visibility","parse_status","row_count","source_column_max",
  "merged_ranges","warnings","created_at","updated_at"
)
SELECT
  r."parse_run_id",r."sheet_index",min(r."sheet_name"),'VISIBLE','COMPLETED',count(*),
  max(COALESCE((r."raw_values"->>'source_column_count')::integer,0)),NULL,'[]'::jsonb,min(r."created_at"),max(r."created_at")
FROM "material_import_rows" r
WHERE NOT EXISTS (
  SELECT 1 FROM "material_import_parse_sheets" s
  WHERE s."parse_run_id"=r."parse_run_id" AND s."sheet_index"=r."sheet_index"
)
GROUP BY r."parse_run_id",r."sheet_index";

ALTER TABLE "material_import_mappings"
  ADD COLUMN "mapping_key" uuid DEFAULT gen_random_uuid(),
  ADD COLUMN "source_kind" text,
  ADD COLUMN "selected_sheet_name" text,
  ADD COLUMN "source_structure_digest" text,
  ADD COLUMN "source_fields" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN "target_catalog_version" text DEFAULT 'material-import-mapping-metadata-v1',
  ADD COLUMN "mapping_snapshot" jsonb,
  ADD COLUMN "supersedes_mapping_id" bigint,
  ADD COLUMN "superseded_by_mapping_id" bigint,
  ADD COLUMN "reuse_source_mapping_id" bigint,
  ADD COLUMN "stale_reason_code" text,
  ADD COLUMN "stale_reason" text,
  ADD COLUMN "invalidated_at" timestamptz,
  ADD COLUMN "updated_by" text,
  ADD COLUMN "confirmed_by" text,
  ADD COLUMN "request_id" uuid DEFAULT gen_random_uuid(),
  ADD COLUMN "confirmed_at" timestamptz;

UPDATE "material_import_mappings" m
SET
  "source_kind"=b."source_kind",
  "selected_sheet_name"=COALESCE((
    SELECT s."sheet_name"
    FROM "material_import_parse_sheets" s
    WHERE s."parse_run_id"=m."parse_run_id" AND s."sheet_index"=m."selected_sheet_index"
    LIMIT 1
  ),'CSV'),
  "source_structure_digest"=repeat('0',64),
  "source_fields"='[]'::jsonb,
  "mapping_digest"=CASE WHEN m."mapping_digest" ~ '^[0-9a-f]{64}$' THEN m."mapping_digest" ELSE repeat('0',64) END,
  "metadata_digest"=CASE WHEN m."metadata_digest" ~ '^[0-9a-f]{64}$' THEN m."metadata_digest" ELSE repeat('0',64) END,
  "updated_by"=m."created_by",
  "mapping_snapshot"=CASE WHEN m."status"='DRAFT' THEN NULL ELSE jsonb_build_object(
    'schema_version',1,
    'legacy_backfill',true,
    'mapping_id',m."id",
    'mapping_version',m."mapping_version"
  ) END,
  "confirmed_by"=CASE WHEN m."status"='CONFIRMED' THEN m."created_by" ELSE NULL END,
  "confirmed_at"=CASE WHEN m."status"='CONFIRMED' THEN m."updated_at" ELSE NULL END,
  "status"=CASE WHEN m."status"='CONFIRMED' THEN 'STALE' ELSE m."status" END,
  "stale_reason_code"=CASE WHEN m."status"='CONFIRMED' THEN 'LEGACY_SNAPSHOT_INCOMPLETE' ELSE NULL END,
  "stale_reason"=CASE WHEN m."status"='CONFIRMED' THEN '旧基线缺少完整源结构和不可变快照，必须重新确认' ELSE NULL END,
  "invalidated_at"=CASE WHEN m."status"='CONFIRMED' THEN now() ELSE NULL END
FROM "material_import_batches" b
WHERE b."id"=m."batch_id";

ALTER TABLE "material_import_mappings"
  ALTER COLUMN "mapping_key" SET NOT NULL,
  ALTER COLUMN "source_kind" SET NOT NULL,
  ALTER COLUMN "selected_sheet_name" SET NOT NULL,
  ALTER COLUMN "source_structure_digest" SET NOT NULL,
  ALTER COLUMN "source_fields" SET NOT NULL,
  ALTER COLUMN "target_catalog_version" SET NOT NULL,
  ALTER COLUMN "updated_by" SET NOT NULL,
  ALTER COLUMN "request_id" SET NOT NULL,
  ADD CONSTRAINT "material_import_mappings_updated_by_app_users_username_fk"
    FOREIGN KEY ("updated_by") REFERENCES "app_users"("username") ON DELETE restrict,
  ADD CONSTRAINT "material_import_mappings_confirmed_by_app_users_username_fk"
    FOREIGN KEY ("confirmed_by") REFERENCES "app_users"("username") ON DELETE restrict,
  ADD CONSTRAINT "material_import_mappings_supersedes_fk"
    FOREIGN KEY ("supersedes_mapping_id") REFERENCES "material_import_mappings"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_mappings_superseded_by_fk"
    FOREIGN KEY ("superseded_by_mapping_id") REFERENCES "material_import_mappings"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_mappings_reuse_source_fk"
    FOREIGN KEY ("reuse_source_mapping_id") REFERENCES "material_import_mappings"("id") ON DELETE restrict,
  ADD CONSTRAINT "material_import_mappings_status_ck"
    CHECK ("status" IN ('DRAFT','CONFIRMED','STALE','SUPERSEDED')),
  ADD CONSTRAINT "material_import_mappings_header_ck"
    CHECK (("header_mode"='SINGLE_ROW' AND "header_row_number">0) OR ("header_mode"='NO_HEADER' AND "header_row_number" IS NULL)),
  ADD CONSTRAINT "material_import_mappings_values_ck"
    CHECK ("mapping_version">0 AND "selected_sheet_index">=0),
  ADD CONSTRAINT "material_import_mappings_digest_ck"
    CHECK ("source_structure_digest" ~ '^[0-9a-f]{64}$' AND "metadata_digest" ~ '^[0-9a-f]{64}$' AND "mapping_digest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "material_import_mappings_source_fields_ck"
    CHECK (jsonb_typeof("source_fields")='array'),
  ADD CONSTRAINT "material_import_mappings_confirm_ck"
    CHECK (
      ("status"='CONFIRMED' AND "confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "mapping_snapshot" IS NOT NULL)
      OR "status"<>'CONFIRMED'
    ),
  ADD CONSTRAINT "material_import_mappings_stale_ck"
    CHECK (
      ("status"='STALE' AND "stale_reason_code" IS NOT NULL AND "stale_reason" IS NOT NULL AND "invalidated_at" IS NOT NULL)
      OR "status"<>'STALE'
    );

CREATE UNIQUE INDEX "material_import_mappings_mapping_key_version_uq"
  ON "material_import_mappings" ("mapping_key","mapping_version");
CREATE UNIQUE INDEX "material_import_mappings_current_draft_uq"
  ON "material_import_mappings" ("batch_id") WHERE "status"='DRAFT';
CREATE UNIQUE INDEX "material_import_mappings_current_confirmed_uq"
  ON "material_import_mappings" ("batch_id") WHERE "status"='CONFIRMED';
CREATE INDEX "material_import_mappings_reuse_idx"
  ON "material_import_mappings" ("status","source_kind","source_structure_digest","confirmed_at");

ALTER TABLE "material_import_mapping_items"
  ADD COLUMN "source_column_index" integer,
  ADD COLUMN "source_header" text,
  ADD COLUMN "target_namespace" text DEFAULT 'basic',
  ADD COLUMN "combination_separator" text DEFAULT ' ',
  ADD COLUMN "adaptive_mapping_status" text DEFAULT 'CONFIRMED';

UPDATE "material_import_mapping_items"
SET
  "source_column_index"=CASE
    WHEN jsonb_typeof("source_column_indexes")='array' AND jsonb_array_length("source_column_indexes")>0
      THEN ("source_column_indexes"->>0)::integer
    ELSE NULL
  END,
  "source_header"=CASE
    WHEN jsonb_typeof("source_headers")='array' AND jsonb_array_length("source_headers")>0
      THEN "source_headers"->>0
    ELSE NULL
  END,
  "source_column_indexes"=COALESCE("source_column_indexes",'[]'::jsonb),
  "source_headers"=COALESCE("source_headers",'[]'::jsonb);

ALTER TABLE "material_import_mapping_items"
  ALTER COLUMN "source_column_indexes" SET DEFAULT '[]'::jsonb,
  ALTER COLUMN "source_column_indexes" SET NOT NULL,
  ALTER COLUMN "source_headers" SET DEFAULT '[]'::jsonb,
  ALTER COLUMN "source_headers" SET NOT NULL,
  ALTER COLUMN "target_namespace" SET NOT NULL,
  ALTER COLUMN "combination_separator" SET NOT NULL,
  ALTER COLUMN "adaptive_mapping_status" SET NOT NULL,
  ADD CONSTRAINT "material_import_mapping_items_namespace_ck"
    CHECK ("target_namespace" IN ('basic','attribute','category_hint','supplier_reference','ignore')),
  ADD CONSTRAINT "material_import_mapping_items_mode_ck"
    CHECK ("mapping_mode" IN ('SOURCE','SOURCE_WITH_DEFAULT','DEFAULT','IGNORE')),
  ADD CONSTRAINT "material_import_mapping_items_json_ck"
    CHECK (
      jsonb_typeof("source_column_indexes")='array'
      AND jsonb_array_length("source_column_indexes") BETWEEN 0 AND 8
      AND jsonb_typeof("source_headers")='array'
      AND jsonb_array_length("source_headers") BETWEEN 0 AND 8
      AND jsonb_typeof("mapping_evidence")='array'
    ),
  ADD CONSTRAINT "material_import_mapping_items_values_ck"
    CHECK (
      "display_order" BETWEEN 0 AND 255
      AND "mapping_confidence" BETWEEN 0 AND 1
      AND length("combination_separator")<=10
      AND "combination_strategy" IN ('FIRST_NON_EMPTY','JOIN_NON_EMPTY','SPECIFICATION_EXTRACT')
      AND "adaptive_mapping_status" IN ('EXACT','HIGH_CONFIDENCE','SUGGESTED','UNMAPPED','CONFLICT','CONFIRMED')
    );

DROP INDEX "material_import_mapping_items_target_uq";
CREATE UNIQUE INDEX "material_import_mapping_items_target_uq"
  ON "material_import_mapping_items" ("mapping_id","target_namespace","target_code")
  WHERE "target_namespace"<>'ignore';
CREATE INDEX "material_import_mapping_items_mapping_order_idx"
  ON "material_import_mapping_items" ("mapping_id","display_order","id");

ALTER TABLE "material_import_parse_runs"
  ADD CONSTRAINT "material_import_parse_runs_mapping_preparation_ck"
    CHECK ("mapping_preparation_status" IN ('NOT_STARTED','READY','FAILED')),
  ADD CONSTRAINT "material_import_parse_runs_source_structure_digest_ck"
    CHECK ("source_structure_digest" IS NULL OR "source_structure_digest" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION material_import_mapping_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD."status"<>'DRAFT' THEN
    RAISE EXCEPTION 'confirmed material import mapping cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' AND OLD."status"<>'DRAFT' THEN
    IF NEW."id"<>OLD."id"
      OR NEW."mapping_key"<>OLD."mapping_key"
      OR NEW."batch_id"<>OLD."batch_id"
      OR NEW."parse_run_id"<>OLD."parse_run_id"
      OR NEW."mapping_version"<>OLD."mapping_version"
      OR NEW."source_kind"<>OLD."source_kind"
      OR NEW."selected_sheet_index"<>OLD."selected_sheet_index"
      OR NEW."selected_sheet_name"<>OLD."selected_sheet_name"
      OR NEW."header_mode"<>OLD."header_mode"
      OR NEW."header_row_number" IS DISTINCT FROM OLD."header_row_number"
      OR NEW."source_structure_digest"<>OLD."source_structure_digest"
      OR NEW."source_fields"<>OLD."source_fields"
      OR NEW."metadata_digest"<>OLD."metadata_digest"
      OR NEW."target_catalog_version"<>OLD."target_catalog_version"
      OR NEW."mapping_digest"<>OLD."mapping_digest"
      OR NEW."mapping_snapshot" IS DISTINCT FROM OLD."mapping_snapshot"
      OR NEW."created_by"<>OLD."created_by"
      OR NEW."confirmed_by" IS DISTINCT FROM OLD."confirmed_by"
      OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    THEN
      RAISE EXCEPTION 'confirmed material import mapping is immutable';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "material_import_mapping_immutable_guard"
BEFORE UPDATE OR DELETE ON "material_import_mappings"
FOR EACH ROW EXECUTE FUNCTION material_import_mapping_immutable_guard();

CREATE OR REPLACE FUNCTION material_import_mapping_item_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_mapping_id bigint;
  parent_status text;
BEGIN
  parent_mapping_id := CASE WHEN TG_OP='DELETE' THEN OLD."mapping_id" ELSE NEW."mapping_id" END;
  SELECT "status" INTO parent_status FROM "material_import_mappings" WHERE "id"=parent_mapping_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'confirmed material import mapping items are immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "material_import_mapping_item_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_mapping_items"
FOR EACH ROW EXECUTE FUNCTION material_import_mapping_item_immutable_guard();
