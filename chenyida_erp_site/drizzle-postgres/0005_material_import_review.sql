CREATE TABLE "material_import_review_sessions" (
  "id" bigserial PRIMARY KEY,
  "batch_id" bigint NOT NULL REFERENCES "material_import_batches"("id") ON DELETE restrict,
  "normalization_run_id" bigint NOT NULL REFERENCES "material_import_normalization_runs"("id") ON DELETE restrict,
  "normalization_run_version" integer NOT NULL,
  "normalization_result_digest" text NOT NULL,
  "mapping_version_id" bigint NOT NULL REFERENCES "material_import_mappings"("id") ON DELETE restrict,
  "mapping_content_digest" text NOT NULL,
  "review_version" integer NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "submitted_at" timestamptz,
  "finalizing_at" timestamptz,
  "finalized_at" timestamptz,
  "cancelled_at" timestamptz,
  "failure_code" text,
  "failure_message_safe" text,
  "total_rows" integer NOT NULL,
  "pending_rows" integer NOT NULL,
  "reviewed_rows" integer DEFAULT 0 NOT NULL,
  "kept_rows" integer DEFAULT 0 NOT NULL,
  "excluded_rows" integer DEFAULT 0 NOT NULL,
  "bind_existing_rows" integer DEFAULT 0 NOT NULL,
  "create_draft_rows" integer DEFAULT 0 NOT NULL,
  "completed_rows" integer DEFAULT 0 NOT NULL,
  "failed_rows" integer DEFAULT 0 NOT NULL,
  "expected_version" integer DEFAULT 1 NOT NULL,
  "supersedes_review_session_id" bigint REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "finalization_job_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_sessions_status_ck"
    CHECK ("status" IN ('DRAFT','IN_REVIEW','READY_TO_FINALIZE','FINALIZING','FINALIZED','FINALIZE_FAILED','CANCELLED')),
  CONSTRAINT "material_import_review_sessions_digest_ck"
    CHECK ("normalization_result_digest" ~ '^[0-9a-f]{64}$' AND "mapping_content_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "material_import_review_sessions_version_ck"
    CHECK ("normalization_run_version">0 AND "review_version">0 AND "expected_version">0),
  CONSTRAINT "material_import_review_sessions_counts_ck"
    CHECK (
      "total_rows">=0 AND "pending_rows" BETWEEN 0 AND "total_rows"
      AND "reviewed_rows" BETWEEN 0 AND "total_rows"
      AND "kept_rows">=0 AND "excluded_rows">=0 AND "bind_existing_rows">=0 AND "create_draft_rows">=0
      AND "completed_rows" BETWEEN 0 AND "total_rows" AND "failed_rows" BETWEEN 0 AND "total_rows"
      AND "pending_rows"+"reviewed_rows"="total_rows"
      AND "kept_rows"+"excluded_rows"+"bind_existing_rows"+"create_draft_rows"="reviewed_rows"
    ),
  CONSTRAINT "material_import_review_sessions_terminal_ck"
    CHECK (
      ("status"='FINALIZED' AND "finalized_at" IS NOT NULL AND "finalizing_at" IS NOT NULL AND "failure_code" IS NULL)
      OR ("status"='CANCELLED' AND "cancelled_at" IS NOT NULL)
      OR ("status"='FINALIZE_FAILED' AND "failure_code" IS NOT NULL AND "failure_message_safe" IS NOT NULL)
      OR ("status" NOT IN ('FINALIZED','CANCELLED','FINALIZE_FAILED') AND "finalized_at" IS NULL AND "cancelled_at" IS NULL)
    ),
  CONSTRAINT "material_import_review_sessions_failure_ck"
    CHECK (
      ("failure_code" IS NULL AND "failure_message_safe" IS NULL)
      OR (
        "failure_code" ~ '^[A-Z][A-Z0-9_]{2,99}$'
        AND length("failure_message_safe") BETWEEN 1 AND 500
      )
    )
);

CREATE UNIQUE INDEX "material_import_review_sessions_run_version_uq"
  ON "material_import_review_sessions" ("normalization_run_id","review_version");
CREATE UNIQUE INDEX "material_import_review_sessions_active_uq"
  ON "material_import_review_sessions" ("normalization_run_id")
  WHERE "status" IN ('DRAFT','IN_REVIEW','READY_TO_FINALIZE','FINALIZING','FINALIZE_FAILED');
CREATE UNIQUE INDEX "material_import_review_sessions_job_uq"
  ON "material_import_review_sessions" ("finalization_job_id")
  WHERE "finalization_job_id" IS NOT NULL;
CREATE INDEX "material_import_review_sessions_batch_history_idx"
  ON "material_import_review_sessions" ("batch_id","review_version" DESC,"id" DESC);
CREATE INDEX "material_import_review_sessions_status_idx"
  ON "material_import_review_sessions" ("status","updated_at","id");

CREATE TABLE "material_import_review_rows" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "normalized_row_id" bigint NOT NULL REFERENCES "material_import_normalized_rows"("id") ON DELETE restrict,
  "source_row_id" bigint NOT NULL REFERENCES "material_import_rows"("id") ON DELETE restrict,
  "source_row_number" integer NOT NULL,
  "row_status" text DEFAULT 'PENDING' NOT NULL,
  "disposition" text DEFAULT 'PENDING' NOT NULL,
  "decision_reason_code" text,
  "decision_comment" text DEFAULT '' NOT NULL,
  "existing_material_id" bigint REFERENCES "material_master"("id") ON DELETE restrict,
  "material_draft_id" bigint REFERENCES "material_master"("id") ON DELETE restrict,
  "reviewed_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "reviewed_at" timestamptz,
  "finalized_at" timestamptz,
  "failure_code" text,
  "failure_message_safe" text,
  "expected_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_rows_status_ck"
    CHECK ("row_status" IN ('PENDING','REVIEWED','FINALIZING','COMPLETED','FAILED')),
  CONSTRAINT "material_import_review_rows_disposition_ck"
    CHECK ("disposition" IN ('PENDING','KEEP','EXCLUDE','BIND_EXISTING','CREATE_DRAFT')),
  CONSTRAINT "material_import_review_rows_version_ck"
    CHECK ("source_row_number">0 AND "expected_version">0),
  CONSTRAINT "material_import_review_rows_decision_ck"
    CHECK (
      ("disposition"='PENDING' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "existing_material_id" IS NULL)
      OR (
        "disposition"<>'PENDING' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL
        AND (("disposition"='BIND_EXISTING' AND "existing_material_id" IS NOT NULL) OR ("disposition"<>'BIND_EXISTING' AND "existing_material_id" IS NULL))
      )
    ),
  CONSTRAINT "material_import_review_rows_exclude_reason_ck"
    CHECK (
      "disposition"<>'EXCLUDE'
      OR (
        "decision_reason_code" ~ '^[A-Z][A-Z0-9_]{2,99}$'
        AND length(trim("decision_comment")) BETWEEN 1 AND 1000
      )
    ),
  CONSTRAINT "material_import_review_rows_comment_ck"
    CHECK (length("decision_comment")<=1000),
  CONSTRAINT "material_import_review_rows_failure_ck"
    CHECK (
      ("failure_code" IS NULL AND "failure_message_safe" IS NULL)
      OR ("failure_code" ~ '^[A-Z][A-Z0-9_]{2,99}$' AND length("failure_message_safe") BETWEEN 1 AND 500)
    )
);

CREATE UNIQUE INDEX "material_import_review_rows_session_normalized_uq"
  ON "material_import_review_rows" ("review_session_id","normalized_row_id");
CREATE INDEX "material_import_review_rows_session_status_idx"
  ON "material_import_review_rows" ("review_session_id","row_status","id");
CREATE INDEX "material_import_review_rows_session_disposition_idx"
  ON "material_import_review_rows" ("review_session_id","disposition","id");
CREATE INDEX "material_import_review_rows_existing_material_idx"
  ON "material_import_review_rows" ("existing_material_id","id")
  WHERE "existing_material_id" IS NOT NULL;

CREATE TABLE "material_import_review_field_overrides" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "target_field_code" text NOT NULL,
  "original_candidate_value" jsonb,
  "override_value" jsonb,
  "value_semantics" text NOT NULL,
  "reason_code" text NOT NULL,
  "comment" text DEFAULT '' NOT NULL,
  "changed_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "changed_at" timestamptz DEFAULT now() NOT NULL,
  "revision_number" integer NOT NULL,
  "supersedes_override_id" bigint REFERENCES "material_import_review_field_overrides"("id") ON DELETE restrict,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_field_overrides_code_ck"
    CHECK ("target_field_code" ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  CONSTRAINT "material_import_review_field_overrides_semantics_ck"
    CHECK ("value_semantics" IN ('SET','CLEAR','REVERT')),
  CONSTRAINT "material_import_review_field_overrides_revision_ck"
    CHECK ("revision_number">0),
  CONSTRAINT "material_import_review_field_overrides_value_ck"
    CHECK (
      ("value_semantics"='SET' AND "override_value" IS NOT NULL)
      OR ("value_semantics" IN ('CLEAR','REVERT') AND "override_value" IS NULL)
    ),
  CONSTRAINT "material_import_review_field_overrides_size_ck"
    CHECK (
      ("original_candidate_value" IS NULL OR pg_column_size("original_candidate_value")<=16384)
      AND ("override_value" IS NULL OR pg_column_size("override_value")<=16384)
      AND length("reason_code") BETWEEN 3 AND 100
      AND length("comment")<=1000
    )
);

CREATE UNIQUE INDEX "material_import_review_field_overrides_revision_uq"
  ON "material_import_review_field_overrides" ("review_row_id","target_field_code","revision_number");
CREATE INDEX "material_import_review_field_overrides_history_idx"
  ON "material_import_review_field_overrides" ("review_row_id","target_field_code","revision_number" DESC,"id" DESC);

CREATE TABLE "material_import_review_attribute_overrides" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "attribute_code" text NOT NULL,
  "attribute_name_snapshot" text NOT NULL,
  "data_type_snapshot" text NOT NULL,
  "original_raw_value" jsonb,
  "original_normalized_value" jsonb,
  "override_value" jsonb,
  "value_semantics" text NOT NULL,
  "unit_or_format" text DEFAULT '' NOT NULL,
  "reason_code" text NOT NULL,
  "comment" text DEFAULT '' NOT NULL,
  "validation_status" text NOT NULL,
  "changed_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "changed_at" timestamptz DEFAULT now() NOT NULL,
  "revision_number" integer NOT NULL,
  "supersedes_override_id" bigint REFERENCES "material_import_review_attribute_overrides"("id") ON DELETE restrict,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_attribute_overrides_code_ck"
    CHECK ("attribute_code" ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  CONSTRAINT "material_import_review_attribute_overrides_type_ck"
    CHECK ("data_type_snapshot" IN ('TEXT','INTEGER','DECIMAL','BOOLEAN','DATE','ENUM')),
  CONSTRAINT "material_import_review_attribute_overrides_semantics_ck"
    CHECK ("value_semantics" IN ('SET','CLEAR','REVERT')),
  CONSTRAINT "material_import_review_attribute_overrides_validation_ck"
    CHECK ("validation_status" IN ('VALID','WARNING','ERROR')),
  CONSTRAINT "material_import_review_attribute_overrides_revision_ck"
    CHECK ("revision_number">0),
  CONSTRAINT "material_import_review_attribute_overrides_value_ck"
    CHECK (
      ("value_semantics"='SET' AND "override_value" IS NOT NULL)
      OR ("value_semantics" IN ('CLEAR','REVERT') AND "override_value" IS NULL)
    ),
  CONSTRAINT "material_import_review_attribute_overrides_size_ck"
    CHECK (
      ("original_raw_value" IS NULL OR pg_column_size("original_raw_value")<=16384)
      AND ("original_normalized_value" IS NULL OR pg_column_size("original_normalized_value")<=16384)
      AND ("override_value" IS NULL OR pg_column_size("override_value")<=16384)
      AND length("attribute_name_snapshot") BETWEEN 1 AND 200
      AND length("unit_or_format")<=100
      AND length("reason_code") BETWEEN 3 AND 100
      AND length("comment")<=1000
    )
);

CREATE UNIQUE INDEX "material_import_review_attribute_overrides_revision_uq"
  ON "material_import_review_attribute_overrides" ("review_row_id","attribute_code","revision_number");
CREATE INDEX "material_import_review_attribute_overrides_history_idx"
  ON "material_import_review_attribute_overrides" ("review_row_id","attribute_code","revision_number" DESC,"id" DESC);

CREATE TABLE "material_import_review_issue_resolutions" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "normalization_issue_id" bigint NOT NULL REFERENCES "material_import_normalization_issues"("id") ON DELETE restrict,
  "resolution_status" text NOT NULL,
  "resolution_code" text NOT NULL,
  "comment" text DEFAULT '' NOT NULL,
  "resolved_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "resolved_at" timestamptz DEFAULT now() NOT NULL,
  "revision_number" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_issue_resolutions_status_ck"
    CHECK ("resolution_status" IN ('UNRESOLVED','RESOLVED_BY_OVERRIDE','WARNING_ACKNOWLEDGED','EXCLUDED','BLOCKING')),
  CONSTRAINT "material_import_review_issue_resolutions_revision_ck"
    CHECK ("revision_number">0),
  CONSTRAINT "material_import_review_issue_resolutions_text_ck"
    CHECK (
      "resolution_code" ~ '^[A-Z][A-Z0-9_]{2,99}$'
      AND length("comment")<=1000
    )
);

CREATE UNIQUE INDEX "material_import_review_issue_resolutions_revision_uq"
  ON "material_import_review_issue_resolutions" ("review_row_id","normalization_issue_id","revision_number");
CREATE INDEX "material_import_review_issue_resolutions_history_idx"
  ON "material_import_review_issue_resolutions" ("review_row_id","normalization_issue_id","revision_number" DESC,"id" DESC);

CREATE TABLE "material_import_review_validation_issues" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "issue_key" text NOT NULL,
  "issue_level" text NOT NULL,
  "issue_code" text NOT NULL,
  "target_code" text NOT NULL,
  "safe_message" text NOT NULL,
  "safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "validation_generation" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  CONSTRAINT "material_import_review_validation_issues_level_ck"
    CHECK ("issue_level" IN ('ERROR','WARNING')),
  CONSTRAINT "material_import_review_validation_issues_code_ck"
    CHECK (
      "issue_key" ~ '^[0-9a-f]{64}$'
      AND "issue_code" ~ '^[A-Z][A-Z0-9_]{2,99}$'
      AND length("target_code") BETWEEN 1 AND 160
      AND length("safe_message") BETWEEN 1 AND 500
      AND "validation_generation">0
    ),
  CONSTRAINT "material_import_review_validation_issues_size_ck"
    CHECK (jsonb_typeof("safe_details")='object' AND pg_column_size("safe_details")<=16384)
);

CREATE UNIQUE INDEX "material_import_review_validation_issues_generation_uq"
  ON "material_import_review_validation_issues" ("review_row_id","issue_key","validation_generation");
CREATE INDEX "material_import_review_validation_issues_active_idx"
  ON "material_import_review_validation_issues" ("review_session_id","issue_level","id")
  WHERE "is_active";

CREATE TABLE "material_import_review_finalizations" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_expected_version" integer NOT NULL,
  "snapshot_schema_version" integer DEFAULT 1 NOT NULL,
  "snapshot_digest" text,
  "status" text DEFAULT 'PREPARING' NOT NULL,
  "job_id" uuid NOT NULL,
  "total_rows" integer NOT NULL,
  "prepared_rows" integer DEFAULT 0 NOT NULL,
  "completed_rows" integer DEFAULT 0 NOT NULL,
  "failed_rows" integer DEFAULT 0 NOT NULL,
  "failure_code" text,
  "failure_message_safe" text,
  "submitted_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "submitted_at" timestamptz DEFAULT now() NOT NULL,
  "sealed_at" timestamptz,
  "completed_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_finalizations_status_ck"
    CHECK ("status" IN ('PREPARING','SEALED','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT "material_import_review_finalizations_digest_ck"
    CHECK ("snapshot_digest" IS NULL OR "snapshot_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "material_import_review_finalizations_counts_ck"
    CHECK (
      "review_expected_version">0 AND "snapshot_schema_version">0 AND "total_rows">=0
      AND "prepared_rows" BETWEEN 0 AND "total_rows"
      AND "completed_rows" BETWEEN 0 AND "total_rows"
      AND "failed_rows" BETWEEN 0 AND "total_rows"
    ),
  CONSTRAINT "material_import_review_finalizations_sealed_ck"
    CHECK (
      ("status"='PREPARING' AND "snapshot_digest" IS NULL AND "sealed_at" IS NULL)
      OR (
        "status"='FAILED'
        AND (
          ("snapshot_digest" IS NULL AND "sealed_at" IS NULL)
          OR ("snapshot_digest" IS NOT NULL AND "sealed_at" IS NOT NULL)
        )
      )
      OR ("status" IN ('SEALED','PROCESSING','COMPLETED') AND "snapshot_digest" IS NOT NULL AND "sealed_at" IS NOT NULL)
    ),
  CONSTRAINT "material_import_review_finalizations_failure_ck"
    CHECK (
      ("status"='FAILED' AND "failure_code" ~ '^[A-Z][A-Z0-9_]{2,99}$' AND length("failure_message_safe") BETWEEN 1 AND 500)
      OR ("status"<>'FAILED' AND "failure_code" IS NULL AND "failure_message_safe" IS NULL)
    )
);

CREATE UNIQUE INDEX "material_import_review_finalizations_session_uq"
  ON "material_import_review_finalizations" ("review_session_id");
CREATE UNIQUE INDEX "material_import_review_finalizations_job_uq"
  ON "material_import_review_finalizations" ("job_id");
CREATE INDEX "material_import_review_finalizations_status_idx"
  ON "material_import_review_finalizations" ("status","updated_at","id");

CREATE TABLE "material_import_review_finalization_rows" (
  "id" bigserial PRIMARY KEY,
  "finalization_id" bigint NOT NULL REFERENCES "material_import_review_finalizations"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "normalized_row_id" bigint NOT NULL REFERENCES "material_import_normalized_rows"("id") ON DELETE restrict,
  "operation_type" text NOT NULL,
  "operation_key" text NOT NULL,
  "final_payload" jsonb NOT NULL,
  "final_payload_digest" text NOT NULL,
  "existing_material_id" bigint REFERENCES "material_master"("id") ON DELETE restrict,
  "material_draft_id" bigint REFERENCES "material_master"("id") ON DELETE restrict,
  "operation_status" text DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "failure_code" text,
  "failure_message_safe" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_finalization_rows_type_ck"
    CHECK ("operation_type" IN ('EXCLUDE','BIND_EXISTING','CREATE_DRAFT')),
  CONSTRAINT "material_import_review_finalization_rows_status_ck"
    CHECK ("operation_status" IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  CONSTRAINT "material_import_review_finalization_rows_digest_ck"
    CHECK ("operation_key" ~ '^[0-9a-f]{64}$' AND "final_payload_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "material_import_review_finalization_rows_payload_ck"
    CHECK (jsonb_typeof("final_payload")='object' AND pg_column_size("final_payload")<=262144),
  CONSTRAINT "material_import_review_finalization_rows_material_ck"
    CHECK (
      ("operation_type"='BIND_EXISTING' AND "existing_material_id" IS NOT NULL)
      OR ("operation_type"<>'BIND_EXISTING' AND "existing_material_id" IS NULL)
    ),
  CONSTRAINT "material_import_review_finalization_rows_attempt_ck"
    CHECK ("attempt_count">=0),
  CONSTRAINT "material_import_review_finalization_rows_failure_ck"
    CHECK (
      ("operation_status"='FAILED' AND "failure_code" ~ '^[A-Z][A-Z0-9_]{2,99}$' AND length("failure_message_safe") BETWEEN 1 AND 500)
      OR ("operation_status"<>'FAILED' AND "failure_code" IS NULL AND "failure_message_safe" IS NULL)
    )
);

CREATE UNIQUE INDEX "material_import_review_finalization_rows_review_uq"
  ON "material_import_review_finalization_rows" ("finalization_id","review_row_id");
CREATE UNIQUE INDEX "material_import_review_finalization_rows_operation_uq"
  ON "material_import_review_finalization_rows" ("operation_key");
CREATE INDEX "material_import_review_finalization_rows_queue_idx"
  ON "material_import_review_finalization_rows" ("finalization_id","operation_status","id");

CREATE TABLE "material_import_review_material_bindings" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "finalization_row_id" bigint NOT NULL REFERENCES "material_import_review_finalization_rows"("id") ON DELETE restrict,
  "material_id" bigint NOT NULL REFERENCES "material_master"("id") ON DELETE restrict,
  "material_display_snapshot" jsonb NOT NULL,
  "bound_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "bound_at" timestamptz DEFAULT now() NOT NULL,
  "request_id" uuid NOT NULL,
  CONSTRAINT "material_import_review_material_bindings_snapshot_ck"
    CHECK (jsonb_typeof("material_display_snapshot")='object' AND pg_column_size("material_display_snapshot")<=16384)
);

CREATE UNIQUE INDEX "material_import_review_material_bindings_row_uq"
  ON "material_import_review_material_bindings" ("review_row_id");
CREATE UNIQUE INDEX "material_import_review_material_bindings_finalization_row_uq"
  ON "material_import_review_material_bindings" ("finalization_row_id");
CREATE INDEX "material_import_review_material_bindings_material_idx"
  ON "material_import_review_material_bindings" ("material_id","id");

CREATE TABLE "material_import_review_draft_links" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint NOT NULL REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "finalization_row_id" bigint NOT NULL REFERENCES "material_import_review_finalization_rows"("id") ON DELETE restrict,
  "material_draft_id" bigint NOT NULL REFERENCES "material_master"("id") ON DELETE restrict,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "request_id" uuid NOT NULL
);

CREATE UNIQUE INDEX "material_import_review_draft_links_row_uq"
  ON "material_import_review_draft_links" ("review_row_id");
CREATE UNIQUE INDEX "material_import_review_draft_links_finalization_row_uq"
  ON "material_import_review_draft_links" ("finalization_row_id");
CREATE UNIQUE INDEX "material_import_review_draft_links_material_uq"
  ON "material_import_review_draft_links" ("material_draft_id");

CREATE TABLE "material_import_review_history" (
  "id" bigserial PRIMARY KEY,
  "review_session_id" bigint NOT NULL REFERENCES "material_import_review_sessions"("id") ON DELETE restrict,
  "review_row_id" bigint REFERENCES "material_import_review_rows"("id") ON DELETE restrict,
  "event_type" text NOT NULL,
  "actor" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "old_version" integer,
  "new_version" integer,
  "reason_code" text,
  "safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "material_import_review_history_event_ck"
    CHECK ("event_type" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  CONSTRAINT "material_import_review_history_details_ck"
    CHECK (jsonb_typeof("safe_details")='object' AND pg_column_size("safe_details")<=16384)
);

CREATE INDEX "material_import_review_history_session_idx"
  ON "material_import_review_history" ("review_session_id","id" DESC);
CREATE INDEX "material_import_review_history_row_idx"
  ON "material_import_review_history" ("review_row_id","id" DESC)
  WHERE "review_row_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION material_import_review_session_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_run record;
BEGIN
  SELECT r."batch_id",r."run_version",r."result_digest",r."mapping_id",r."mapping_digest",r."published_at",r."run_status"
  INTO bound_run
  FROM "material_import_normalization_runs" r
  WHERE r."id"=NEW."normalization_run_id";
  IF bound_run IS NULL
    OR bound_run."batch_id"<>NEW."batch_id"
    OR bound_run."run_version"<>NEW."normalization_run_version"
    OR bound_run."result_digest"<>NEW."normalization_result_digest"
    OR bound_run."mapping_id"<>NEW."mapping_version_id"
    OR bound_run."mapping_digest"<>NEW."mapping_content_digest"
    OR bound_run."published_at" IS NULL
    OR bound_run."run_status" NOT IN ('SUCCEEDED','SUPERSEDED')
  THEN
    RAISE EXCEPTION 'review session must bind an immutable published normalization run';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "material_import_review_session_binding_guard"
BEFORE INSERT ON "material_import_review_sessions"
FOR EACH ROW EXECUTE FUNCTION material_import_review_session_binding_guard();

CREATE OR REPLACE FUNCTION material_import_review_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_id bigint;
  session_status text;
BEGIN
  session_id := CASE WHEN TG_OP='DELETE' THEN OLD."review_session_id" ELSE NEW."review_session_id" END;
  SELECT "status" INTO session_status
  FROM "material_import_review_sessions"
  WHERE "id"=session_id;
  IF session_status IN ('FINALIZING','FINALIZED','FINALIZE_FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'review session is immutable after finalization starts';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "material_import_review_field_overrides_mutation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_review_field_overrides"
FOR EACH ROW EXECUTE FUNCTION material_import_review_mutation_guard();
CREATE TRIGGER "material_import_review_attribute_overrides_mutation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_review_attribute_overrides"
FOR EACH ROW EXECUTE FUNCTION material_import_review_mutation_guard();
CREATE TRIGGER "material_import_review_issue_resolutions_mutation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_review_issue_resolutions"
FOR EACH ROW EXECUTE FUNCTION material_import_review_mutation_guard();

CREATE OR REPLACE FUNCTION material_import_review_row_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_status text;
BEGIN
  SELECT "status" INTO session_status
  FROM "material_import_review_sessions"
  WHERE "id"=CASE WHEN TG_OP='DELETE' THEN OLD."review_session_id" ELSE NEW."review_session_id" END;

  IF TG_OP='DELETE' AND session_status IN ('FINALIZING','FINALIZED','FINALIZE_FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'review rows cannot be deleted after finalization starts';
  END IF;
  IF TG_OP='INSERT' AND session_status IN ('FINALIZING','FINALIZED','FINALIZE_FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'review rows cannot be inserted after finalization starts';
  END IF;
  IF TG_OP='UPDATE' AND session_status IN ('FINALIZING','FINALIZE_FAILED') THEN
    IF NEW."review_session_id"<>OLD."review_session_id"
      OR NEW."normalized_row_id"<>OLD."normalized_row_id"
      OR NEW."source_row_id"<>OLD."source_row_id"
      OR NEW."source_row_number"<>OLD."source_row_number"
      OR NEW."disposition"<>OLD."disposition"
      OR NEW."decision_reason_code" IS DISTINCT FROM OLD."decision_reason_code"
      OR NEW."decision_comment"<>OLD."decision_comment"
      OR NEW."existing_material_id" IS DISTINCT FROM OLD."existing_material_id"
      OR NEW."reviewed_by" IS DISTINCT FROM OLD."reviewed_by"
      OR NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at"
    THEN
      RAISE EXCEPTION 'review decision is immutable after finalization starts';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND session_status IN ('FINALIZED','CANCELLED') THEN
    RAISE EXCEPTION 'review rows are immutable in a terminal session';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "material_import_review_rows_mutation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "material_import_review_rows"
FOR EACH ROW EXECUTE FUNCTION material_import_review_row_mutation_guard();

CREATE OR REPLACE FUNCTION material_import_review_final_payload_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'finalization rows cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW."finalization_id"<>OLD."finalization_id"
    OR NEW."review_row_id"<>OLD."review_row_id"
    OR NEW."normalized_row_id"<>OLD."normalized_row_id"
    OR NEW."operation_type"<>OLD."operation_type"
    OR NEW."operation_key"<>OLD."operation_key"
    OR NEW."final_payload"<>OLD."final_payload"
    OR NEW."final_payload_digest"<>OLD."final_payload_digest"
    OR NEW."existing_material_id" IS DISTINCT FROM OLD."existing_material_id"
  ) THEN
    RAISE EXCEPTION 'sealed finalization payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "material_import_review_final_payload_guard"
BEFORE UPDATE OR DELETE ON "material_import_review_finalization_rows"
FOR EACH ROW EXECUTE FUNCTION material_import_review_final_payload_guard();
