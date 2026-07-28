CREATE TABLE "material_governance_alternative_candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"governance_run_id" bigint NOT NULL,
	"main_group_id" bigint NOT NULL,
	"alternative_group_id" bigint NOT NULL,
	"compatibility_digest" text NOT NULL,
	"status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_alternatives_values_ck" CHECK ("material_governance_alternative_candidates"."main_group_id"<"material_governance_alternative_candidates"."alternative_group_id" and "material_governance_alternative_candidates"."status"='PENDING_REVIEW' and "material_governance_alternative_candidates"."compatibility_digest" ~ '^[0-9a-f]{64}$' and "material_governance_alternative_candidates"."candidate_digest" ~ '^[0-9a-f]{64}$' and jsonb_typeof("material_governance_alternative_candidates"."evidence")='array' and pg_column_size("material_governance_alternative_candidates"."evidence")<=16384)
);
--> statement-breakpoint
CREATE TABLE "material_governance_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"decision_type" text NOT NULL,
	"expected_version" integer NOT NULL,
	"resulting_version" integer NOT NULL,
	"reason_code" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"decision_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_digest" text NOT NULL,
	"idempotency_key_digest" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"decided_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_decisions_values_ck" CHECK ("material_governance_decisions"."decision_type" in ('BIND_EXISTING','CREATE_DRAFT','EXCLUDE') and "material_governance_decisions"."expected_version"=1 and "material_governance_decisions"."resulting_version"="material_governance_decisions"."expected_version"+1 and "material_governance_decisions"."reason_code" ~ '^[A-Z][A-Z0-9_]{2,99}$' and char_length("material_governance_decisions"."comment")<=2000 and "material_governance_decisions"."request_digest" ~ '^[0-9a-f]{64}$' and "material_governance_decisions"."idempotency_key_digest" ~ '^[0-9a-f]{64}$' and jsonb_typeof("material_governance_decisions"."decision_payload")='object' and pg_column_size("material_governance_decisions"."decision_payload")<=65536)
);
--> statement-breakpoint
CREATE TABLE "material_governance_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"decision_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"old_status" text NOT NULL,
	"new_status" text NOT NULL,
	"old_version" integer NOT NULL,
	"new_version" integer NOT NULL,
	"reason_code" text NOT NULL,
	"safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_events_values_ck" CHECK ("material_governance_events"."old_status"='PENDING' and "material_governance_events"."old_version"=1 and "material_governance_events"."new_version"=2 and (("material_governance_events"."event_type"='GROUP_BOUND_ACTIVE' and "material_governance_events"."new_status"='BOUND_ACTIVE') or ("material_governance_events"."event_type"='GROUP_DRAFT_CREATED' and "material_governance_events"."new_status"='DRAFT_CREATED') or ("material_governance_events"."event_type"='GROUP_EXCLUDED' and "material_governance_events"."new_status"='EXCLUDED')) and "material_governance_events"."reason_code" ~ '^[A-Z][A-Z0-9_]{2,99}$' and jsonb_typeof("material_governance_events"."safe_details")='object' and pg_column_size("material_governance_events"."safe_details")<=32768)
);
--> statement-breakpoint
CREATE TABLE "material_governance_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"governance_run_id" bigint NOT NULL,
	"group_key" text NOT NULL,
	"category" text NOT NULL,
	"readiness" text NOT NULL,
	"canonical_key" text,
	"canonical_specification" text,
	"standard_name" text NOT NULL,
	"identity_digest" text,
	"compatibility_digest" text,
	"source_count" integer NOT NULL,
	"merge_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_status" text DEFAULT 'PENDING' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_groups_category_ck" CHECK ("material_governance_groups"."category" in ('RES','CAP','IND','DIODE','TRANS','IC','OSC','CON','MECH','OTHER')),
	CONSTRAINT "material_governance_groups_readiness_ck" CHECK ("material_governance_groups"."readiness" in ('READY','REVIEW_REQUIRED','UNSUPPORTED')),
	CONSTRAINT "material_governance_groups_digest_ck" CHECK ("material_governance_groups"."group_key" ~ '^[0-9a-f]{64}$' and ("material_governance_groups"."identity_digest" is null or "material_governance_groups"."identity_digest" ~ '^[0-9a-f]{64}$') and ("material_governance_groups"."compatibility_digest" is null or "material_governance_groups"."compatibility_digest" ~ '^[0-9a-f]{64}$') and ("material_governance_groups"."identity_digest" is null or "material_governance_groups"."group_key"="material_governance_groups"."identity_digest")),
	CONSTRAINT "material_governance_groups_identity_ck" CHECK (("material_governance_groups"."readiness"='READY' and "material_governance_groups"."identity_digest" is not null and "material_governance_groups"."canonical_key" is not null and "material_governance_groups"."canonical_specification" is not null) or ("material_governance_groups"."readiness"<>'READY' and "material_governance_groups"."identity_digest" is null and "material_governance_groups"."canonical_key" is null and "material_governance_groups"."canonical_specification" is null)),
	CONSTRAINT "material_governance_groups_values_ck" CHECK ("material_governance_groups"."source_count">0 and jsonb_typeof("material_governance_groups"."merge_evidence")='array' and pg_column_size("material_governance_groups"."merge_evidence")<=16384 and (("material_governance_groups"."decision_status"='PENDING' and "material_governance_groups"."version"=1) or ("material_governance_groups"."decision_status" in ('BOUND_ACTIVE','DRAFT_CREATED','EXCLUDED') and "material_governance_groups"."version"=2)))
);
--> statement-breakpoint
CREATE TABLE "material_governance_material_candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"candidate_kind" text NOT NULL,
	"candidate_rank" integer NOT NULL,
	"material_version_snapshot" integer NOT NULL,
	"material_status_snapshot" text NOT NULL,
	"candidate_snapshot" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_material_candidates_values_ck" CHECK ("material_governance_material_candidates"."candidate_kind" in ('EXACT_IDENTITY','COMPATIBILITY_REVIEW') and "material_governance_material_candidates"."candidate_rank">0 and "material_governance_material_candidates"."material_version_snapshot">0 and "material_governance_material_candidates"."material_status_snapshot"='ACTIVE' and "material_governance_material_candidates"."candidate_digest" ~ '^[0-9a-f]{64}$' and jsonb_typeof("material_governance_material_candidates"."candidate_snapshot")='object' and jsonb_typeof("material_governance_material_candidates"."evidence")='array' and pg_column_size("material_governance_material_candidates"."candidate_snapshot")<=65536 and pg_column_size("material_governance_material_candidates"."evidence")<=16384)
);
--> statement-breakpoint
CREATE TABLE "material_governance_material_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" bigint NOT NULL,
	"decision_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"link_type" text NOT NULL,
	"material_version_snapshot" integer NOT NULL,
	"material_status_snapshot" text NOT NULL,
	"material_display_snapshot" jsonb NOT NULL,
	"linked_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_material_links_values_ck" CHECK ((("material_governance_material_links"."link_type"='BOUND_ACTIVE' and "material_governance_material_links"."material_status_snapshot"='ACTIVE') or ("material_governance_material_links"."link_type"='CREATED_DRAFT' and "material_governance_material_links"."material_status_snapshot"='DRAFT')) and "material_governance_material_links"."material_version_snapshot">0 and jsonb_typeof("material_governance_material_links"."material_display_snapshot")='object' and pg_column_size("material_governance_material_links"."material_display_snapshot")<=65536)
);
--> statement-breakpoint
CREATE TABLE "material_governance_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"governance_run_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"normalized_row_id" bigint NOT NULL,
	"source_row_id" bigint NOT NULL,
	"source_key" text NOT NULL,
	"original_part_number" text,
	"manufacturer_part_number" text,
	"supplier_part_number" text,
	"source_model" text,
	"original_material_name" text,
	"original_specification" text,
	"original_description" text,
	"original_brand" text,
	"original_manufacturer" text,
	"original_supplier" text,
	"source_quantity_raw" text,
	"source_quantity" numeric(24, 6),
	"source_unit" text,
	"source_bom" text,
	"source_snapshot_digest" text NOT NULL,
	"parse_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_rows_values_ck" CHECK (char_length(btrim("material_governance_rows"."source_key")) between 1 and 200 and "material_governance_rows"."source_snapshot_digest" ~ '^[0-9a-f]{64}$' and ("material_governance_rows"."source_quantity" is null or "material_governance_rows"."source_quantity">0) and "material_governance_rows"."issue_count">=0 and "material_governance_rows"."error_count">=0 and "material_governance_rows"."warning_count">=0 and "material_governance_rows"."issue_count"="material_governance_rows"."error_count"+"material_governance_rows"."warning_count"),
	CONSTRAINT "material_governance_rows_json_ck" CHECK (jsonb_typeof("material_governance_rows"."parse_evidence")='array' and jsonb_typeof("material_governance_rows"."issues")='array' and pg_column_size("material_governance_rows"."parse_evidence")<=32768 and pg_column_size("material_governance_rows"."issues")<=65536)
);
--> statement-breakpoint
CREATE TABLE "material_governance_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"normalization_run_id" bigint NOT NULL,
	"normalization_result_digest" text NOT NULL,
	"rule_version" text NOT NULL,
	"config_digest" text NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"result_digest" text NOT NULL,
	"source_count" integer NOT NULL,
	"group_count" integer NOT NULL,
	"ready_group_count" integer NOT NULL,
	"exception_row_count" integer NOT NULL,
	"alternative_candidate_count" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_runs_digest_ck" CHECK ("material_governance_runs"."normalization_result_digest" ~ '^[0-9a-f]{64}$' and "material_governance_runs"."config_digest" ~ '^[0-9a-f]{64}$' and "material_governance_runs"."result_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "material_governance_runs_rule_ck" CHECK (char_length(btrim("material_governance_runs"."rule_version")) between 1 and 100 and jsonb_typeof("material_governance_runs"."rule_snapshot")='object' and pg_column_size("material_governance_runs"."rule_snapshot")<=262144),
	CONSTRAINT "material_governance_runs_counts_ck" CHECK ("material_governance_runs"."source_count">=0 and "material_governance_runs"."group_count" between 0 and "material_governance_runs"."source_count" and "material_governance_runs"."ready_group_count" between 0 and "material_governance_runs"."group_count" and "material_governance_runs"."exception_row_count" between 0 and "material_governance_runs"."source_count" and "material_governance_runs"."alternative_candidate_count">=0)
);
--> statement-breakpoint
CREATE TABLE "material_governance_specs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"governance_row_id" bigint NOT NULL,
	"component_code" text NOT NULL,
	"component_role" text NOT NULL,
	"normalized_value" text NOT NULL,
	"display_value" text NOT NULL,
	"canonical_unit" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_governance_specs_code_ck" CHECK ("material_governance_specs"."component_code" ~ '^[A-Z][A-Z0-9_]{0,63}$' and "material_governance_specs"."component_role" in ('IDENTITY','PERFORMANCE','DESCRIPTIVE')),
	CONSTRAINT "material_governance_specs_values_ck" CHECK (char_length("material_governance_specs"."normalized_value") between 1 and 500 and char_length("material_governance_specs"."display_value") between 1 and 500 and ("material_governance_specs"."canonical_unit" is null or char_length("material_governance_specs"."canonical_unit") between 1 and 32) and jsonb_typeof("material_governance_specs"."evidence")='array' and pg_column_size("material_governance_specs"."evidence")<=16384)
);
--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD COLUMN "header_start_row_number" integer;--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD COLUMN "header_end_row_number" integer;--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD COLUMN "data_start_row_number" integer;--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD COLUMN "structure_confidence" numeric(6, 5);--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD COLUMN "structure_status" text;--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD COLUMN "adaptive_algorithm_version" text;--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_groups_id_run_uq" ON "material_governance_groups" USING btree ("id","governance_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_decisions_id_group_uq" ON "material_governance_decisions" USING btree ("id","group_id");--> statement-breakpoint
ALTER TABLE "material_governance_alternative_candidates" ADD CONSTRAINT "material_governance_alternatives_main_run_fk" FOREIGN KEY ("main_group_id","governance_run_id") REFERENCES "public"."material_governance_groups"("id","governance_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_alternative_candidates" ADD CONSTRAINT "material_governance_alternatives_alt_run_fk" FOREIGN KEY ("alternative_group_id","governance_run_id") REFERENCES "public"."material_governance_groups"("id","governance_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_decisions" ADD CONSTRAINT "material_governance_decisions_group_id_material_governance_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."material_governance_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_decisions" ADD CONSTRAINT "material_governance_decisions_decided_by_app_users_username_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_events" ADD CONSTRAINT "material_governance_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_events" ADD CONSTRAINT "material_governance_events_decision_group_fk" FOREIGN KEY ("decision_id","group_id") REFERENCES "public"."material_governance_decisions"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_groups" ADD CONSTRAINT "material_governance_groups_governance_run_id_material_governance_runs_id_fk" FOREIGN KEY ("governance_run_id") REFERENCES "public"."material_governance_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_groups" ADD CONSTRAINT "material_governance_groups_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_groups" ADD CONSTRAINT "material_governance_groups_updated_by_app_users_username_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_material_candidates" ADD CONSTRAINT "material_governance_material_candidates_group_id_material_governance_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."material_governance_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_material_candidates" ADD CONSTRAINT "material_governance_material_candidates_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_material_links" ADD CONSTRAINT "material_governance_material_links_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_material_links" ADD CONSTRAINT "material_governance_material_links_linked_by_app_users_username_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_material_links" ADD CONSTRAINT "material_governance_material_links_decision_group_fk" FOREIGN KEY ("decision_id","group_id") REFERENCES "public"."material_governance_decisions"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_rows" ADD CONSTRAINT "material_governance_rows_normalized_row_id_material_import_normalized_rows_id_fk" FOREIGN KEY ("normalized_row_id") REFERENCES "public"."material_import_normalized_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_rows" ADD CONSTRAINT "material_governance_rows_source_row_id_material_import_rows_id_fk" FOREIGN KEY ("source_row_id") REFERENCES "public"."material_import_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_rows" ADD CONSTRAINT "material_governance_rows_group_run_fk" FOREIGN KEY ("group_id","governance_run_id") REFERENCES "public"."material_governance_groups"("id","governance_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_runs" ADD CONSTRAINT "material_governance_runs_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_runs" ADD CONSTRAINT "material_governance_runs_normalization_run_id_material_import_normalization_runs_id_fk" FOREIGN KEY ("normalization_run_id") REFERENCES "public"."material_import_normalization_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_runs" ADD CONSTRAINT "material_governance_runs_requested_by_app_users_username_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_governance_specs" ADD CONSTRAINT "material_governance_specs_governance_row_id_material_governance_rows_id_fk" FOREIGN KEY ("governance_row_id") REFERENCES "public"."material_governance_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_alternatives_pair_uq" ON "material_governance_alternative_candidates" USING btree ("governance_run_id","main_group_id","alternative_group_id");--> statement-breakpoint
CREATE INDEX "material_governance_alternatives_run_idx" ON "material_governance_alternative_candidates" USING btree ("governance_run_id","status","id");--> statement-breakpoint
CREATE INDEX "material_governance_alternatives_main_group_idx" ON "material_governance_alternative_candidates" USING btree ("main_group_id","id");--> statement-breakpoint
CREATE INDEX "material_governance_alternatives_alt_group_idx" ON "material_governance_alternative_candidates" USING btree ("alternative_group_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_decisions_group_uq" ON "material_governance_decisions" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_decisions_operation_uq" ON "material_governance_decisions" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_events_decision_uq" ON "material_governance_events" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "material_governance_events_group_idx" ON "material_governance_events" USING btree ("group_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_groups_run_key_uq" ON "material_governance_groups" USING btree ("governance_run_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_groups_run_identity_uq" ON "material_governance_groups" USING btree ("governance_run_id","identity_digest") WHERE "material_governance_groups"."identity_digest" is not null;--> statement-breakpoint
CREATE INDEX "material_governance_groups_identity_idx" ON "material_governance_groups" USING btree ("identity_digest","id") WHERE "material_governance_groups"."identity_digest" is not null;--> statement-breakpoint
CREATE INDEX "material_governance_groups_queue_idx" ON "material_governance_groups" USING btree ("governance_run_id","decision_status","readiness","category","id");--> statement-breakpoint
CREATE INDEX "material_governance_groups_compatibility_idx" ON "material_governance_groups" USING btree ("governance_run_id","category","compatibility_digest","id") WHERE "material_governance_groups"."compatibility_digest" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_material_candidates_group_material_uq" ON "material_governance_material_candidates" USING btree ("group_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_material_candidates_group_rank_uq" ON "material_governance_material_candidates" USING btree ("group_id","candidate_rank");--> statement-breakpoint
CREATE INDEX "material_governance_material_candidates_material_idx" ON "material_governance_material_candidates" USING btree ("material_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_material_links_group_uq" ON "material_governance_material_links" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_material_links_decision_uq" ON "material_governance_material_links" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_material_links_created_draft_material_uq" ON "material_governance_material_links" USING btree ("material_id") WHERE "material_governance_material_links"."link_type"='CREATED_DRAFT';--> statement-breakpoint
CREATE INDEX "material_governance_material_links_material_idx" ON "material_governance_material_links" USING btree ("material_id","linked_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_rows_run_normalized_uq" ON "material_governance_rows" USING btree ("governance_run_id","normalized_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_rows_run_source_key_uq" ON "material_governance_rows" USING btree ("governance_run_id","source_key");--> statement-breakpoint
CREATE INDEX "material_governance_rows_run_idx" ON "material_governance_rows" USING btree ("governance_run_id","id");--> statement-breakpoint
CREATE INDEX "material_governance_rows_group_idx" ON "material_governance_rows" USING btree ("group_id","id");--> statement-breakpoint
CREATE INDEX "material_governance_rows_source_row_idx" ON "material_governance_rows" USING btree ("source_row_id","id");--> statement-breakpoint
CREATE INDEX "material_governance_rows_exception_idx" ON "material_governance_rows" USING btree ("governance_run_id","error_count","id") WHERE "material_governance_rows"."error_count">0;--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_runs_source_rule_uq" ON "material_governance_runs" USING btree ("normalization_run_id","rule_version","config_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_runs_operation_uq" ON "material_governance_runs" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "material_governance_runs_batch_created_idx" ON "material_governance_runs" USING btree ("batch_id","completed_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_governance_specs_row_code_uq" ON "material_governance_specs" USING btree ("governance_row_id","component_code");--> statement-breakpoint
CREATE INDEX "material_governance_specs_lookup_idx" ON "material_governance_specs" USING btree ("component_code","normalized_value","governance_row_id");--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD CONSTRAINT "material_import_mappings_adaptive_structure_ck" CHECK (("material_import_mappings"."header_start_row_number" is null and "material_import_mappings"."header_end_row_number" is null and "material_import_mappings"."data_start_row_number" is null and "material_import_mappings"."structure_confidence" is null and "material_import_mappings"."structure_status" is null and "material_import_mappings"."adaptive_algorithm_version" is null) or ("material_import_mappings"."header_start_row_number">0 and "material_import_mappings"."header_end_row_number">="material_import_mappings"."header_start_row_number" and "material_import_mappings"."header_row_number"="material_import_mappings"."header_end_row_number" and "material_import_mappings"."data_start_row_number"="material_import_mappings"."header_end_row_number"+1 and "material_import_mappings"."structure_confidence" between 0 and 1 and "material_import_mappings"."structure_status" in ('HIGH_CONFIDENCE','NEEDS_REVIEW','NO_CANDIDATE','CONFIRMED') and char_length(btrim("material_import_mappings"."adaptive_algorithm_version")) between 1 and 100));
--> statement-breakpoint

DO $$
DECLARE
  metadata_request_id uuid := '00350000-0000-4000-8000-000000000001';
BEGIN
  -- Fresh databases receive v2 from init-admin. Existing v1 databases are upgraded here.
  IF EXISTS (SELECT 1 FROM material_categories WHERE category_code='EL_PASSIVE') THEN
    IF EXISTS (
      SELECT 1 FROM material_attribute_definitions
      WHERE (attribute_code='RESISTANCE' and (data_type<>'DECIMAL' or canonical_unit<>'ohm' or decimal_scale not in (3,6)))
         OR (attribute_code='POWER' and (data_type<>'DECIMAL' or canonical_unit<>'W' or decimal_scale not in (3,6)))
         OR (attribute_code='CAPACITANCE' and (data_type<>'DECIMAL' or canonical_unit<>'F' or decimal_scale not in (9,18)))
         OR (attribute_code='INDUCTANCE' and (data_type<>'DECIMAL' or canonical_unit<>'H' or decimal_scale not in (9,12)))
         OR (attribute_code='RATED_VOLTAGE' and (data_type<>'DECIMAL' or canonical_unit<>'V' or decimal_scale not in (3,6)))
         OR (attribute_code='PITCH' and (data_type<>'DECIMAL' or canonical_unit<>'mm' or decimal_scale not in (3,6)))
    ) THEN
      RAISE EXCEPTION 'material governance metadata v1 precision baseline is incompatible'
        USING ERRCODE = '23514';
    END IF;

    UPDATE material_attribute_definitions
    SET decimal_scale=CASE attribute_code
          WHEN 'RESISTANCE' THEN 6 WHEN 'POWER' THEN 6
          WHEN 'CAPACITANCE' THEN 18 WHEN 'INDUCTANCE' THEN 12
          WHEN 'RATED_VOLTAGE' THEN 6 WHEN 'PITCH' THEN 6
        END,
        version=version+1,updated_by='migration-0035',updated_at=now(),request_id=metadata_request_id
    WHERE attribute_code in ('RESISTANCE','POWER','CAPACITANCE','INDUCTANCE','RATED_VOLTAGE','PITCH')
      and decimal_scale<>CASE attribute_code
        WHEN 'RESISTANCE' THEN 6 WHEN 'POWER' THEN 6
        WHEN 'CAPACITANCE' THEN 18 WHEN 'INDUCTANCE' THEN 12
        WHEN 'RATED_VOLTAGE' THEN 6 WHEN 'PITCH' THEN 6
      END;

    INSERT INTO material_attribute_definitions(
      attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,version,created_by,updated_by,request_id
    ) VALUES
      ('DIELECTRIC','介质','TEXT',0,'','[]'::jsonb,'NONE','ACTIVE',1,'migration-0035','migration-0035',metadata_request_id),
      ('RATED_CURRENT','额定电流','DECIMAL',6,'A','[]'::jsonb,'NONE','ACTIVE',1,'migration-0035','migration-0035',metadata_request_id),
      ('STRUCTURE','结构','TEXT',0,'','[]'::jsonb,'NONE','ACTIVE',1,'migration-0035','migration-0035',metadata_request_id),
      ('FREQUENCY','频率','DECIMAL',0,'Hz','[]'::jsonb,'NONE','ACTIVE',1,'migration-0035','migration-0035',metadata_request_id)
    ON CONFLICT (attribute_code) DO NOTHING;

    IF EXISTS (
      SELECT 1 FROM material_attribute_definitions
      WHERE (attribute_code='DIELECTRIC' and (data_type<>'TEXT' or canonical_unit<>'' or status<>'ACTIVE'))
         OR (attribute_code='RATED_CURRENT' and (data_type<>'DECIMAL' or decimal_scale<>6 or canonical_unit<>'A' or status<>'ACTIVE'))
         OR (attribute_code='STRUCTURE' and (data_type<>'TEXT' or canonical_unit<>'' or status<>'ACTIVE'))
         OR (attribute_code='FREQUENCY' and (data_type<>'DECIMAL' or decimal_scale<>0 or canonical_unit<>'Hz' or status<>'ACTIVE'))
    ) THEN
      RAISE EXCEPTION 'material governance metadata v2 attribute collision'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
      created_by,updated_by,request_id
    ) SELECT 'IC_SOT','SOT/SC 封装 IC',id,4,'ACTIVE',30,1,'migration-0035','migration-0035',metadata_request_id
      FROM material_categories WHERE category_code='SEMI_IC'
    ON CONFLICT (category_code) DO NOTHING;
    INSERT INTO material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
      created_by,updated_by,request_id
    ) SELECT 'IC_SMD_OTHER','其他贴片封装 IC',id,4,'ACTIVE',90,1,'migration-0035','migration-0035',metadata_request_id
      FROM material_categories WHERE category_code='SEMI_IC'
    ON CONFLICT (category_code) DO NOTHING;
    INSERT INTO material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
      created_by,updated_by,request_id
    ) SELECT 'SEMI_TRANS','三极管/晶体管',id,3,'ACTIVE',40,1,'migration-0035','migration-0035',metadata_request_id
      FROM material_categories WHERE category_code='EL_SEMICONDUCTOR'
    ON CONFLICT (category_code) DO NOTHING;
    INSERT INTO material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
      created_by,updated_by,request_id
    ) SELECT 'TRANS_SMD','贴片三极管/晶体管',id,4,'ACTIVE',10,1,'migration-0035','migration-0035',metadata_request_id
      FROM material_categories WHERE category_code='SEMI_TRANS'
    ON CONFLICT (category_code) DO NOTHING;
    INSERT INTO material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
      created_by,updated_by,request_id
    ) SELECT 'PASS_OSCILLATOR','晶振/振荡器',id,3,'ACTIVE',40,1,'migration-0035','migration-0035',metadata_request_id
      FROM material_categories WHERE category_code='EL_PASSIVE'
    ON CONFLICT (category_code) DO NOTHING;
    INSERT INTO material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
      created_by,updated_by,request_id
    ) SELECT 'OSC_SMD','贴片晶振',id,4,'ACTIVE',10,1,'migration-0035','migration-0035',metadata_request_id
      FROM material_categories WHERE category_code='PASS_OSCILLATOR'
    ON CONFLICT (category_code) DO NOTHING;

    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('IC_SOT','SEMI_IC',4),('IC_SMD_OTHER','SEMI_IC',4),('SEMI_TRANS','EL_SEMICONDUCTOR',3),
        ('TRANS_SMD','SEMI_TRANS',4),('PASS_OSCILLATOR','EL_PASSIVE',3),
        ('OSC_SMD','PASS_OSCILLATOR',4)
      ) expected(code,parent_code,category_level)
      LEFT JOIN material_categories child ON child.category_code=expected.code
      LEFT JOIN material_categories parent ON parent.id=child.parent_id
      WHERE child.id is null OR child.category_level<>expected.category_level
         OR parent.category_code<>expected.parent_code OR child.status<>'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'material governance metadata v2 category collision or missing parent'
        USING ERRCODE = '23514';
    END IF;

    WITH desired(category_code,attribute_codes,required_codes) AS (VALUES
      ('RES_CHIP',ARRAY['RESISTANCE','TOLERANCE','POWER','PACKAGE','BRAND','MPN'],ARRAY['PACKAGE','RESISTANCE','TOLERANCE','POWER']),
      ('CAP_CHIP',ARRAY['CAPACITANCE','TOLERANCE','RATED_VOLTAGE','DIELECTRIC','PACKAGE','BRAND','MPN'],ARRAY['PACKAGE','CAPACITANCE','RATED_VOLTAGE','DIELECTRIC','TOLERANCE']),
      ('IND_CHIP',ARRAY['INDUCTANCE','TOLERANCE','RATED_CURRENT','POWER','PACKAGE','BRAND','MPN'],ARRAY['PACKAGE','INDUCTANCE','RATED_CURRENT','TOLERANCE']),
      ('CONN_BOARD_STD',ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE','PACKAGE'],ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE']),
      ('CONN_FPC_STD',ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE','PACKAGE'],ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE']),
      ('IC_BGA',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('IC_QFN',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('IC_SOT',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('IC_SMD_OTHER',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('DIODE_SMD',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('MOS_SMD',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('TRANS_SMD',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
      ('OSC_SMD',ARRAY['BRAND','MPN','PACKAGE','FREQUENCY'],ARRAY['MPN','PACKAGE','FREQUENCY'])
    )
    INSERT INTO material_category_attributes(
      category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,
      sort_order,status,created_by,updated_by,request_id
    )
    SELECT category.id,definition.id,listed.attribute_code=ANY(desired.required_codes),false,true,
           ordinal-1,'ACTIVE','migration-0035','migration-0035',metadata_request_id
    FROM desired
    JOIN material_categories category ON category.category_code=desired.category_code
    CROSS JOIN LATERAL unnest(desired.attribute_codes) WITH ORDINALITY listed(attribute_code,ordinal)
    JOIN material_attribute_definitions definition ON definition.attribute_code=listed.attribute_code
    ON CONFLICT (category_id,attribute_definition_id) DO UPDATE
      SET is_required=excluded.is_required,is_searchable=true,sort_order=excluded.sort_order,
          status='ACTIVE',updated_by='migration-0035',updated_at=now(),request_id=metadata_request_id;

    IF EXISTS (
      WITH desired(category_code,attribute_codes,required_codes) AS (VALUES
        ('RES_CHIP',ARRAY['RESISTANCE','TOLERANCE','POWER','PACKAGE','BRAND','MPN'],ARRAY['PACKAGE','RESISTANCE','TOLERANCE','POWER']),
        ('CAP_CHIP',ARRAY['CAPACITANCE','TOLERANCE','RATED_VOLTAGE','DIELECTRIC','PACKAGE','BRAND','MPN'],ARRAY['PACKAGE','CAPACITANCE','RATED_VOLTAGE','DIELECTRIC','TOLERANCE']),
        ('IND_CHIP',ARRAY['INDUCTANCE','TOLERANCE','RATED_CURRENT','POWER','PACKAGE','BRAND','MPN'],ARRAY['PACKAGE','INDUCTANCE','RATED_CURRENT','TOLERANCE']),
        ('CONN_BOARD_STD',ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE','PACKAGE'],ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE']),
        ('CONN_FPC_STD',ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE','PACKAGE'],ARRAY['BRAND','MPN','PIN_COUNT','PITCH','STRUCTURE']),
        ('IC_BGA',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('IC_QFN',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('IC_SOT',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('IC_SMD_OTHER',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('DIODE_SMD',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('MOS_SMD',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('TRANS_SMD',ARRAY['BRAND','MPN','PACKAGE','PIN_COUNT','RATED_VOLTAGE'],ARRAY['MPN','PACKAGE']),
        ('OSC_SMD',ARRAY['BRAND','MPN','PACKAGE','FREQUENCY'],ARRAY['MPN','PACKAGE','FREQUENCY'])
      )
      SELECT 1 FROM desired
      CROSS JOIN LATERAL unnest(desired.attribute_codes) listed(attribute_code)
      LEFT JOIN material_categories category ON category.category_code=desired.category_code
      LEFT JOIN material_attribute_definitions definition ON definition.attribute_code=listed.attribute_code
      LEFT JOIN material_category_attributes binding
        ON binding.category_id=category.id and binding.attribute_definition_id=definition.id
      WHERE definition.id is null OR definition.status<>'ACTIVE'
         OR binding.id is null OR binding.status<>'ACTIVE'
         OR binding.is_required<>(listed.attribute_code=ANY(desired.required_codes))
    ) THEN
      RAISE EXCEPTION 'material governance metadata v2 binding upgrade incomplete'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until)
    VALUES('migration-0035','MATERIAL_GOVERNANCE_METADATA_V2_APPLIED',
      jsonb_build_object('seed_version','material-category-v2','migration','0035_bom_material_governance'),
      metadata_request_id,'success','MIGRATION',now()+interval '1095 days');
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_material_governance_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'material governance facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('cyd.material_governance_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'material governance writes require service transaction'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_material_governance_group_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'material governance groups are append-preserved'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('cyd.material_governance_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'material governance writes require service transaction'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.decision_status <> 'PENDING' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'material governance groups must start pending at version 1'
        USING ERRCODE = '23514', CONSTRAINT = 'material_governance_groups_initial_state_ck';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.decision_status <> 'PENDING'
     OR OLD.version <> 1
     OR NEW.decision_status NOT IN ('BOUND_ACTIVE', 'DRAFT_CREATED', 'EXCLUDED')
     OR NEW.version <> 2
     OR ROW(
       NEW.id,
       NEW.governance_run_id,
       NEW.group_key,
       NEW.category,
       NEW.readiness,
       NEW.canonical_key,
       NEW.canonical_specification,
       NEW.standard_name,
       NEW.identity_digest,
       NEW.compatibility_digest,
       NEW.source_count,
       NEW.merge_evidence,
       NEW.created_by,
       NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.id,
       OLD.governance_run_id,
       OLD.group_key,
       OLD.category,
       OLD.readiness,
       OLD.canonical_key,
       OLD.canonical_specification,
       OLD.standard_name,
       OLD.identity_digest,
       OLD.compatibility_digest,
       OLD.source_count,
       OLD.merge_evidence,
       OLD.created_by,
       OLD.created_at
     ) THEN
    RAISE EXCEPTION 'material governance group permits one terminal decision transition only'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER material_governance_runs_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_runs
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_rows_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_rows
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_specs_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_specs
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_material_candidates_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_material_candidates
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_alternative_candidates_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_alternative_candidates
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_decisions_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_decisions
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_material_links_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_material_links
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_events_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_events
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER material_governance_groups_guard
BEFORE INSERT OR UPDATE OR DELETE ON material_governance_groups
FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_group_guard();
