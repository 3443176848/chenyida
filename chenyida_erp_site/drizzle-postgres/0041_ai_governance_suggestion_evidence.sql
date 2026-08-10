CREATE TABLE "ai_governance_suggestion_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_uid" uuid NOT NULL,
	"suggestion_id" bigint NOT NULL,
	"event_sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"reason_code" text NOT NULL,
	"superseding_suggestion_id" bigint,
	"expected_suggestion_row_version" integer NOT NULL,
	"expected_previous_event_digest" text,
	"event_digest" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_governance_suggestion_events_values_ck" CHECK ("ai_governance_suggestion_events"."expected_suggestion_row_version"=1 and "ai_governance_suggestion_events"."row_version"=1 and "ai_governance_suggestion_events"."event_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_events"."reason_code" ~ '^[A-Z][A-Z0-9_]{2,99}$' and (("ai_governance_suggestion_events"."event_type"='CREATED' and "ai_governance_suggestion_events"."event_sequence"=1 and "ai_governance_suggestion_events"."superseding_suggestion_id" is null and "ai_governance_suggestion_events"."expected_previous_event_digest" is null) or ("ai_governance_suggestion_events"."event_type" in ('INVALIDATED','DISCARDED') and "ai_governance_suggestion_events"."event_sequence"=2 and "ai_governance_suggestion_events"."superseding_suggestion_id" is null and "ai_governance_suggestion_events"."expected_previous_event_digest" ~ '^[0-9a-f]{64}$') or ("ai_governance_suggestion_events"."event_type"='SUPERSEDED' and "ai_governance_suggestion_events"."event_sequence"=2 and "ai_governance_suggestion_events"."superseding_suggestion_id" is not null and "ai_governance_suggestion_events"."expected_previous_event_digest" ~ '^[0-9a-f]{64}$')))
);
--> statement-breakpoint
CREATE TABLE "ai_governance_suggestion_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"evidence_uid" uuid NOT NULL,
	"suggestion_item_id" bigint NOT NULL,
	"evidence_ordinal" integer NOT NULL,
	"evidence_kind" text NOT NULL,
	"governance_row_id" bigint,
	"governance_spec_id" bigint,
	"governance_material_candidate_id" bigint,
	"governance_alternative_candidate_id" bigint,
	"normalization_lineage_id" bigint,
	"material_id" bigint,
	"supplier_id" bigint,
	"supplier_mapping_version_id" bigint,
	"observed_version_no" integer,
	"safe_field_path" text NOT NULL,
	"source_digest" text NOT NULL,
	"locator_digest" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"rule_trace_code" text,
	"rule_trace_version" text,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_governance_suggestion_evidence_common_ck" CHECK ("ai_governance_suggestion_evidence"."evidence_ordinal">0 and "ai_governance_suggestion_evidence"."row_version"=1 and char_length("ai_governance_suggestion_evidence"."safe_field_path") between 1 and 200 and "ai_governance_suggestion_evidence"."safe_field_path" ~ '^[A-Za-z0-9_.:-]+$' and "ai_governance_suggestion_evidence"."source_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_evidence"."locator_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_evidence"."evidence_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_governance_suggestion_evidence_kind_ck" CHECK (
    ("ai_governance_suggestion_evidence"."evidence_kind"='GOVERNANCE_ROW' and "ai_governance_suggestion_evidence"."governance_row_id" is not null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no" is null and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='GOVERNANCE_SPEC' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is not null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no" is null and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='DETERMINISTIC_MATERIAL_CANDIDATE' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is not null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no" is null and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='DETERMINISTIC_ALTERNATIVE_CANDIDATE' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is not null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no" is null and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='NORMALIZATION_LINEAGE' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is not null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no" is null and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='MATERIAL_VERSION' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is not null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no">0 and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='SUPPLIER_VERSION' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is not null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no">0 and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='SUPPLIER_MAPPING_VERSION' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is not null and "ai_governance_suggestion_evidence"."observed_version_no">0 and "ai_governance_suggestion_evidence"."rule_trace_code" is null and "ai_governance_suggestion_evidence"."rule_trace_version" is null)
    or ("ai_governance_suggestion_evidence"."evidence_kind"='RULE_TRACE' and "ai_governance_suggestion_evidence"."governance_row_id" is null and "ai_governance_suggestion_evidence"."governance_spec_id" is null and "ai_governance_suggestion_evidence"."governance_material_candidate_id" is null and "ai_governance_suggestion_evidence"."governance_alternative_candidate_id" is null and "ai_governance_suggestion_evidence"."normalization_lineage_id" is null and "ai_governance_suggestion_evidence"."material_id" is null and "ai_governance_suggestion_evidence"."supplier_id" is null and "ai_governance_suggestion_evidence"."supplier_mapping_version_id" is null and "ai_governance_suggestion_evidence"."observed_version_no" is null and "ai_governance_suggestion_evidence"."rule_trace_code" ~ '^[A-Z][A-Z0-9_]{2,127}$' and char_length(btrim("ai_governance_suggestion_evidence"."rule_trace_version")) between 1 and 160)
  )
);
--> statement-breakpoint
CREATE TABLE "ai_governance_suggestion_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_uid" uuid NOT NULL,
	"suggestion_id" bigint NOT NULL,
	"item_kind" text NOT NULL,
	"item_ordinal" integer NOT NULL,
	"candidate_rank" integer NOT NULL,
	"score" numeric(9, 8),
	"item_digest" text NOT NULL,
	"category_id" bigint,
	"category_version_snapshot" integer,
	"category_status_snapshot" text,
	"category_digest" text,
	"attribute_definition_id" bigint,
	"attribute_definition_version_snapshot" integer,
	"attribute_status_snapshot" text,
	"attribute_value_type" text,
	"value_text" text,
	"value_integer" bigint,
	"value_decimal" numeric(38, 18),
	"value_boolean" boolean,
	"value_date" date,
	"value_unit_code" text,
	"attribute_value_digest" text,
	"material_id" bigint,
	"material_version_snapshot" integer,
	"material_status_snapshot" text,
	"material_digest" text,
	"supplier_id" bigint,
	"supplier_version_snapshot" integer,
	"supplier_status_snapshot" text,
	"supplier_digest" text,
	"supplier_part_key_digest" text,
	"purchase_unit_id" bigint,
	"conversion_numerator" numeric(38, 18),
	"conversion_denominator" numeric(38, 18),
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_governance_suggestion_items_common_ck" CHECK ("ai_governance_suggestion_items"."item_kind" in ('CLASSIFICATION','ATTRIBUTE_EXTRACTION','MATERIAL_MATCH','SUPPLIER_MAPPING') and "ai_governance_suggestion_items"."item_ordinal">0 and "ai_governance_suggestion_items"."candidate_rank">0 and "ai_governance_suggestion_items"."row_version"=1 and ("ai_governance_suggestion_items"."score" is null or ("ai_governance_suggestion_items"."score">=0 and "ai_governance_suggestion_items"."score"<=1)) and "ai_governance_suggestion_items"."item_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_governance_suggestion_items_conversion_ck" CHECK (("ai_governance_suggestion_items"."purchase_unit_id" is null and "ai_governance_suggestion_items"."conversion_numerator" is null and "ai_governance_suggestion_items"."conversion_denominator" is null) or ("ai_governance_suggestion_items"."purchase_unit_id" is not null and "ai_governance_suggestion_items"."conversion_numerator">0 and "ai_governance_suggestion_items"."conversion_denominator">0)),
	CONSTRAINT "ai_governance_suggestion_items_kind_ck" CHECK (
    ("ai_governance_suggestion_items"."item_kind"='CLASSIFICATION' and "ai_governance_suggestion_items"."category_id" is not null and "ai_governance_suggestion_items"."category_version_snapshot">0 and "ai_governance_suggestion_items"."category_status_snapshot"='ACTIVE' and "ai_governance_suggestion_items"."category_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_items"."attribute_definition_id" is null and "ai_governance_suggestion_items"."attribute_definition_version_snapshot" is null and "ai_governance_suggestion_items"."attribute_status_snapshot" is null and "ai_governance_suggestion_items"."attribute_value_type" is null and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is null and "ai_governance_suggestion_items"."value_unit_code" is null and "ai_governance_suggestion_items"."attribute_value_digest" is null and "ai_governance_suggestion_items"."material_id" is null and "ai_governance_suggestion_items"."material_version_snapshot" is null and "ai_governance_suggestion_items"."material_status_snapshot" is null and "ai_governance_suggestion_items"."material_digest" is null and "ai_governance_suggestion_items"."supplier_id" is null and "ai_governance_suggestion_items"."supplier_version_snapshot" is null and "ai_governance_suggestion_items"."supplier_status_snapshot" is null and "ai_governance_suggestion_items"."supplier_digest" is null and "ai_governance_suggestion_items"."supplier_part_key_digest" is null and "ai_governance_suggestion_items"."purchase_unit_id" is null)
    or ("ai_governance_suggestion_items"."item_kind"='ATTRIBUTE_EXTRACTION' and "ai_governance_suggestion_items"."category_id" is null and "ai_governance_suggestion_items"."category_version_snapshot" is null and "ai_governance_suggestion_items"."category_status_snapshot" is null and "ai_governance_suggestion_items"."category_digest" is null and "ai_governance_suggestion_items"."attribute_definition_id" is not null and "ai_governance_suggestion_items"."attribute_definition_version_snapshot">0 and "ai_governance_suggestion_items"."attribute_status_snapshot"='ACTIVE' and "ai_governance_suggestion_items"."attribute_value_type" in ('TEXT','ENUM','INTEGER','DECIMAL','BOOLEAN','DATE') and "ai_governance_suggestion_items"."attribute_value_digest" ~ '^[0-9a-f]{64}$' and (("ai_governance_suggestion_items"."attribute_value_type" in ('TEXT','ENUM') and "ai_governance_suggestion_items"."value_text" is not null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is null) or ("ai_governance_suggestion_items"."attribute_value_type"='INTEGER' and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is not null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is null) or ("ai_governance_suggestion_items"."attribute_value_type"='DECIMAL' and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is not null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is null) or ("ai_governance_suggestion_items"."attribute_value_type"='BOOLEAN' and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is not null and "ai_governance_suggestion_items"."value_date" is null) or ("ai_governance_suggestion_items"."attribute_value_type"='DATE' and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is not null)) and "ai_governance_suggestion_items"."material_id" is null and "ai_governance_suggestion_items"."material_version_snapshot" is null and "ai_governance_suggestion_items"."material_status_snapshot" is null and "ai_governance_suggestion_items"."material_digest" is null and "ai_governance_suggestion_items"."supplier_id" is null and "ai_governance_suggestion_items"."supplier_version_snapshot" is null and "ai_governance_suggestion_items"."supplier_status_snapshot" is null and "ai_governance_suggestion_items"."supplier_digest" is null and "ai_governance_suggestion_items"."supplier_part_key_digest" is null and "ai_governance_suggestion_items"."purchase_unit_id" is null)
    or ("ai_governance_suggestion_items"."item_kind"='MATERIAL_MATCH' and "ai_governance_suggestion_items"."category_id" is null and "ai_governance_suggestion_items"."category_version_snapshot" is null and "ai_governance_suggestion_items"."category_status_snapshot" is null and "ai_governance_suggestion_items"."category_digest" is null and "ai_governance_suggestion_items"."attribute_definition_id" is null and "ai_governance_suggestion_items"."attribute_definition_version_snapshot" is null and "ai_governance_suggestion_items"."attribute_status_snapshot" is null and "ai_governance_suggestion_items"."attribute_value_type" is null and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is null and "ai_governance_suggestion_items"."value_unit_code" is null and "ai_governance_suggestion_items"."attribute_value_digest" is null and "ai_governance_suggestion_items"."material_id" is not null and "ai_governance_suggestion_items"."material_version_snapshot">0 and "ai_governance_suggestion_items"."material_status_snapshot"='ACTIVE' and "ai_governance_suggestion_items"."material_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_items"."supplier_id" is null and "ai_governance_suggestion_items"."supplier_version_snapshot" is null and "ai_governance_suggestion_items"."supplier_status_snapshot" is null and "ai_governance_suggestion_items"."supplier_digest" is null and "ai_governance_suggestion_items"."supplier_part_key_digest" is null and "ai_governance_suggestion_items"."purchase_unit_id" is null)
    or ("ai_governance_suggestion_items"."item_kind"='SUPPLIER_MAPPING' and "ai_governance_suggestion_items"."category_id" is null and "ai_governance_suggestion_items"."category_version_snapshot" is null and "ai_governance_suggestion_items"."category_status_snapshot" is null and "ai_governance_suggestion_items"."category_digest" is null and "ai_governance_suggestion_items"."attribute_definition_id" is null and "ai_governance_suggestion_items"."attribute_definition_version_snapshot" is null and "ai_governance_suggestion_items"."attribute_status_snapshot" is null and "ai_governance_suggestion_items"."attribute_value_type" is null and "ai_governance_suggestion_items"."value_text" is null and "ai_governance_suggestion_items"."value_integer" is null and "ai_governance_suggestion_items"."value_decimal" is null and "ai_governance_suggestion_items"."value_boolean" is null and "ai_governance_suggestion_items"."value_date" is null and "ai_governance_suggestion_items"."value_unit_code" is null and "ai_governance_suggestion_items"."attribute_value_digest" is null and "ai_governance_suggestion_items"."material_id" is not null and "ai_governance_suggestion_items"."material_version_snapshot">0 and "ai_governance_suggestion_items"."material_status_snapshot"='ACTIVE' and "ai_governance_suggestion_items"."material_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_items"."supplier_id" is not null and "ai_governance_suggestion_items"."supplier_version_snapshot">0 and "ai_governance_suggestion_items"."supplier_status_snapshot"='ACTIVE' and "ai_governance_suggestion_items"."supplier_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_items"."supplier_part_key_digest" ~ '^[0-9a-f]{64}$')
  )
);
--> statement-breakpoint
CREATE TABLE "ai_governance_suggestion_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_uid" uuid NOT NULL,
	"governance_run_id" bigint NOT NULL,
	"governance_group_id" bigint NOT NULL,
	"group_version" integer NOT NULL,
	"group_input_digest" text NOT NULL,
	"capability" text NOT NULL,
	"execution_mode" text NOT NULL,
	"schema_version" text NOT NULL,
	"schema_digest" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"rule_version" text NOT NULL,
	"config_version" text NOT NULL,
	"config_digest" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_digest" text,
	"parameter_digest" text NOT NULL,
	"confidence_semantics_version" text,
	"input_version" text NOT NULL,
	"input_digest" text NOT NULL,
	"contract_digest" text NOT NULL,
	"run_digest" text NOT NULL,
	"result_digest" text NOT NULL,
	"idempotency_key_digest" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_governance_suggestion_runs_capability_ck" CHECK ("ai_governance_suggestion_runs"."capability" in ('CLASSIFICATION','ATTRIBUTE_EXTRACTION','MATERIAL_MATCH','SUPPLIER_MAPPING')),
	CONSTRAINT "ai_governance_suggestion_runs_contract_ck" CHECK ("ai_governance_suggestion_runs"."execution_mode"='LOCAL_DETERMINISTIC' and "ai_governance_suggestion_runs"."provider_id"='LOCAL_DETERMINISTIC' and "ai_governance_suggestion_runs"."model_id"='NONE' and "ai_governance_suggestion_runs"."model_version"='NONE' and "ai_governance_suggestion_runs"."prompt_version"='NONE' and "ai_governance_suggestion_runs"."prompt_digest" is null and "ai_governance_suggestion_runs"."confidence_semantics_version" is null),
	CONSTRAINT "ai_governance_suggestion_runs_version_ck" CHECK ("ai_governance_suggestion_runs"."group_version"=1 and "ai_governance_suggestion_runs"."row_version"=1 and char_length(btrim("ai_governance_suggestion_runs"."execution_mode")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."schema_version")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."evaluator_version")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."rule_version")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."config_version")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."provider_id")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."model_id")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."model_version")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."prompt_version")) between 1 and 160 and char_length(btrim("ai_governance_suggestion_runs"."input_version")) between 1 and 160),
	CONSTRAINT "ai_governance_suggestion_runs_digest_ck" CHECK ("ai_governance_suggestion_runs"."group_input_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."schema_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."config_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."parameter_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."input_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."contract_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."run_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."result_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestion_runs"."idempotency_key_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_governance_suggestion_runs_ttl_ck" CHECK ("ai_governance_suggestion_runs"."expires_at">"ai_governance_suggestion_runs"."created_at" and "ai_governance_suggestion_runs"."expires_at"<="ai_governance_suggestion_runs"."created_at"+interval '30 days')
);
--> statement-breakpoint
CREATE TABLE "ai_governance_suggestions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"suggestion_uid" uuid NOT NULL,
	"suggestion_run_id" bigint NOT NULL,
	"governance_group_id" bigint NOT NULL,
	"capability" text NOT NULL,
	"suggestion_version_no" integer NOT NULL,
	"supersedes_suggestion_id" bigint,
	"disposition" text NOT NULL,
	"abstain_reason_code" text,
	"overall_confidence" numeric(9, 8),
	"payload_digest" text NOT NULL,
	"suggestion_digest" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_governance_suggestions_values_ck" CHECK ("ai_governance_suggestions"."capability" in ('CLASSIFICATION','ATTRIBUTE_EXTRACTION','MATERIAL_MATCH','SUPPLIER_MAPPING') and "ai_governance_suggestions"."suggestion_version_no">0 and "ai_governance_suggestions"."row_version"=1 and (("ai_governance_suggestions"."suggestion_version_no"=1 and "ai_governance_suggestions"."supersedes_suggestion_id" is null) or ("ai_governance_suggestions"."suggestion_version_no">1 and "ai_governance_suggestions"."supersedes_suggestion_id" is not null))),
	CONSTRAINT "ai_governance_suggestions_disposition_ck" CHECK (("ai_governance_suggestions"."disposition"='SUGGEST' and "ai_governance_suggestions"."abstain_reason_code" is null) or ("ai_governance_suggestions"."disposition"='ABSTAIN' and "ai_governance_suggestions"."abstain_reason_code" ~ '^[A-Z][A-Z0-9_]{2,99}$')),
	CONSTRAINT "ai_governance_suggestions_confidence_ck" CHECK ("ai_governance_suggestions"."overall_confidence" is null or ("ai_governance_suggestions"."overall_confidence">=0 and "ai_governance_suggestions"."overall_confidence"<=1)),
	CONSTRAINT "ai_governance_suggestions_digest_ck" CHECK ("ai_governance_suggestions"."payload_digest" ~ '^[0-9a-f]{64}$' and "ai_governance_suggestions"."suggestion_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_runs_id_subject_uq" ON "ai_governance_suggestion_runs" USING btree ("id","governance_group_id","capability");--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_events" ADD CONSTRAINT "ai_governance_suggestion_events_suggestion_id_ai_governance_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_governance_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_events" ADD CONSTRAINT "ai_governance_suggestion_events_superseding_suggestion_id_ai_governance_suggestions_id_fk" FOREIGN KEY ("superseding_suggestion_id") REFERENCES "public"."ai_governance_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_events" ADD CONSTRAINT "ai_governance_suggestion_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_suggestion_item_id_ai_governance_suggestion_items_id_fk" FOREIGN KEY ("suggestion_item_id") REFERENCES "public"."ai_governance_suggestion_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_governance_row_id_material_governance_rows_id_fk" FOREIGN KEY ("governance_row_id") REFERENCES "public"."material_governance_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_governance_spec_id_material_governance_specs_id_fk" FOREIGN KEY ("governance_spec_id") REFERENCES "public"."material_governance_specs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_governance_material_candidate_id_material_governance_material_candidates_id_fk" FOREIGN KEY ("governance_material_candidate_id") REFERENCES "public"."material_governance_material_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_governance_alternative_candidate_id_material_governance_alternative_candidates_id_fk" FOREIGN KEY ("governance_alternative_candidate_id") REFERENCES "public"."material_governance_alternative_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_normalization_lineage_id_material_import_normalization_lineage_id_fk" FOREIGN KEY ("normalization_lineage_id") REFERENCES "public"."material_import_normalization_lineage"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_supplier_mapping_version_id_supplier_mappings_id_fk" FOREIGN KEY ("supplier_mapping_version_id") REFERENCES "public"."supplier_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_evidence" ADD CONSTRAINT "ai_governance_suggestion_evidence_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_suggestion_id_ai_governance_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_governance_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_category_id_material_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."material_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_attribute_definition_id_material_attribute_definitions_id_fk" FOREIGN KEY ("attribute_definition_id") REFERENCES "public"."material_attribute_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_purchase_unit_id_units_id_fk" FOREIGN KEY ("purchase_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_items" ADD CONSTRAINT "ai_governance_suggestion_items_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_runs" ADD CONSTRAINT "ai_governance_suggestion_runs_governance_run_id_material_governance_runs_id_fk" FOREIGN KEY ("governance_run_id") REFERENCES "public"."material_governance_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_runs" ADD CONSTRAINT "ai_governance_suggestion_runs_requested_by_app_users_username_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestion_runs" ADD CONSTRAINT "ai_governance_suggestion_runs_group_run_fk" FOREIGN KEY ("governance_group_id","governance_run_id") REFERENCES "public"."material_governance_groups"("id","governance_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestions" ADD CONSTRAINT "ai_governance_suggestions_supersedes_suggestion_id_ai_governance_suggestions_id_fk" FOREIGN KEY ("supersedes_suggestion_id") REFERENCES "public"."ai_governance_suggestions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestions" ADD CONSTRAINT "ai_governance_suggestions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_suggestions" ADD CONSTRAINT "ai_governance_suggestions_run_subject_fk" FOREIGN KEY ("suggestion_run_id","governance_group_id","capability") REFERENCES "public"."ai_governance_suggestion_runs"("id","governance_group_id","capability") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_events_uid_uq" ON "ai_governance_suggestion_events" USING btree ("event_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_events_operation_uq" ON "ai_governance_suggestion_events" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_events_sequence_uq" ON "ai_governance_suggestion_events" USING btree ("suggestion_id","event_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_events_terminal_uq" ON "ai_governance_suggestion_events" USING btree ("suggestion_id") WHERE "ai_governance_suggestion_events"."event_type" in ('INVALIDATED','DISCARDED','SUPERSEDED');--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_events_history_idx" ON "ai_governance_suggestion_events" USING btree ("suggestion_id","event_sequence","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_evidence_uid_uq" ON "ai_governance_suggestion_evidence" USING btree ("evidence_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_evidence_ordinal_uq" ON "ai_governance_suggestion_evidence" USING btree ("suggestion_item_id","evidence_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_evidence_digest_uq" ON "ai_governance_suggestion_evidence" USING btree ("suggestion_item_id","evidence_digest");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_kind_idx" ON "ai_governance_suggestion_evidence" USING btree ("suggestion_item_id","evidence_kind","id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_row_idx" ON "ai_governance_suggestion_evidence" USING btree ("governance_row_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_spec_idx" ON "ai_governance_suggestion_evidence" USING btree ("governance_spec_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_material_candidate_idx" ON "ai_governance_suggestion_evidence" USING btree ("governance_material_candidate_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_alternative_idx" ON "ai_governance_suggestion_evidence" USING btree ("governance_alternative_candidate_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_lineage_idx" ON "ai_governance_suggestion_evidence" USING btree ("normalization_lineage_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_material_idx" ON "ai_governance_suggestion_evidence" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_supplier_idx" ON "ai_governance_suggestion_evidence" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_evidence_mapping_idx" ON "ai_governance_suggestion_evidence" USING btree ("supplier_mapping_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_uid_uq" ON "ai_governance_suggestion_items" USING btree ("item_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_ordinal_uq" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","item_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_digest_uq" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","item_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_category_uq" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","category_id") WHERE "ai_governance_suggestion_items"."item_kind"='CLASSIFICATION';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_attribute_uq" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","attribute_definition_id","candidate_rank") WHERE "ai_governance_suggestion_items"."item_kind"='ATTRIBUTE_EXTRACTION';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_material_uq" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","material_id") WHERE "ai_governance_suggestion_items"."item_kind"='MATERIAL_MATCH';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_items_supplier_uq" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","supplier_id","supplier_part_key_digest","material_id") WHERE "ai_governance_suggestion_items"."item_kind"='SUPPLIER_MAPPING';--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_items_kind_rank_idx" ON "ai_governance_suggestion_items" USING btree ("suggestion_id","item_kind","candidate_rank","id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_items_category_idx" ON "ai_governance_suggestion_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_items_attribute_idx" ON "ai_governance_suggestion_items" USING btree ("attribute_definition_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_items_material_idx" ON "ai_governance_suggestion_items" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_items_supplier_idx" ON "ai_governance_suggestion_items" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_runs_uid_uq" ON "ai_governance_suggestion_runs" USING btree ("run_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_runs_operation_uq" ON "ai_governance_suggestion_runs" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_runs_digest_uq" ON "ai_governance_suggestion_runs" USING btree ("run_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestion_runs_business_uq" ON "ai_governance_suggestion_runs" USING btree ("governance_group_id","group_version","capability","input_version","input_digest","contract_digest");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_runs_group_cap_created_idx" ON "ai_governance_suggestion_runs" USING btree ("governance_group_id","capability","created_at","id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_runs_expiry_idx" ON "ai_governance_suggestion_runs" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestion_runs_request_idx" ON "ai_governance_suggestion_runs" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestions_uid_uq" ON "ai_governance_suggestions" USING btree ("suggestion_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestions_run_uq" ON "ai_governance_suggestions" USING btree ("suggestion_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestions_subject_version_uq" ON "ai_governance_suggestions" USING btree ("governance_group_id","capability","suggestion_version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_suggestions_supersedes_uq" ON "ai_governance_suggestions" USING btree ("supersedes_suggestion_id") WHERE "ai_governance_suggestions"."supersedes_suggestion_id" is not null;--> statement-breakpoint
CREATE INDEX "ai_governance_suggestions_subject_history_idx" ON "ai_governance_suggestions" USING btree ("governance_group_id","capability","suggestion_version_no");--> statement-breakpoint
CREATE INDEX "ai_governance_suggestions_review_queue_idx" ON "ai_governance_suggestions" USING btree ("governance_group_id","suggestion_version_no","id") WHERE "ai_governance_suggestions"."disposition"='SUGGEST';
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'AI governance suggestion facts are immutable'
      USING ERRCODE='55000';
  END IF;
  IF current_setting('cyd.ai_governance_suggestion_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'AI governance suggestion writes require service transaction'
      USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='ai_governance_suggestion_items' THEN
    IF EXISTS (
      SELECT 1 FROM ai_governance_suggestion_events
      WHERE suggestion_id=NEW.suggestion_id AND event_type='CREATED'
    ) THEN
      RAISE EXCEPTION 'AI governance suggestion items cannot be appended after creation'
        USING ERRCODE='55000', CONSTRAINT='ai_governance_suggestion_items_append_closed_ck';
    END IF;
  END IF;
  IF TG_TABLE_NAME='ai_governance_suggestion_evidence' THEN
    IF EXISTS (
      SELECT 1
      FROM ai_governance_suggestion_items item
      JOIN ai_governance_suggestion_events event
        ON event.suggestion_id=item.suggestion_id AND event.event_type='CREATED'
      WHERE item.id=NEW.suggestion_item_id
    ) THEN
      RAISE EXCEPTION 'AI governance suggestion evidence cannot be appended after creation'
        USING ERRCODE='55000', CONSTRAINT='ai_governance_suggestion_evidence_append_closed_ck';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_assert_run_complete(p_run_id bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM ai_governance_suggestions WHERE suggestion_run_id=p_run_id)<>1 THEN
    RAISE EXCEPTION 'AI governance suggestion run must have exactly one suggestion'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_runs_complete_ck';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_assert_complete(p_suggestion_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  subject record;
  previous record;
  item record;
  evidence record;
  item_count integer;
  evidence_count integer;
BEGIN
  SELECT
    suggestion.id suggestion_id,
    suggestion.capability,
    suggestion.suggestion_version_no,
    suggestion.supersedes_suggestion_id,
    suggestion.disposition,
    suggestion.overall_confidence,
    suggestion.created_by,
    suggestion.request_id,
    suggestion.created_at,
    suggestion.row_version,
    run.id suggestion_run_id,
    run.governance_run_id,
    run.governance_group_id,
    run.group_version,
    run.requested_by,
    run.request_id run_request_id,
    run.created_at run_created_at,
    run.confidence_semantics_version,
    governance_group.decision_status group_status,
    governance_group.version current_group_version
  INTO subject
  FROM ai_governance_suggestions suggestion
  JOIN ai_governance_suggestion_runs run ON run.id=suggestion.suggestion_run_id
  JOIN material_governance_groups governance_group
    ON governance_group.id=run.governance_group_id
   AND governance_group.governance_run_id=run.governance_run_id
  WHERE suggestion.id=p_suggestion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI governance suggestion subject is missing'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_subject_ck';
  END IF;
  IF subject.group_status<>'PENDING' OR subject.current_group_version<>1 OR subject.group_version<>subject.current_group_version THEN
    RAISE EXCEPTION 'AI governance suggestion requires a pending version 1 governance group'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_group_state_ck';
  END IF;
  IF subject.created_by IS DISTINCT FROM subject.requested_by
     OR subject.request_id IS DISTINCT FROM subject.run_request_id
     OR subject.created_at IS DISTINCT FROM subject.run_created_at
     OR subject.row_version<>1 THEN
    RAISE EXCEPTION 'AI governance suggestion transaction identity mismatch'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_transaction_identity_ck';
  END IF;
  IF subject.overall_confidence IS NOT NULL AND subject.confidence_semantics_version IS NULL THEN
    RAISE EXCEPTION 'AI governance suggestion confidence semantics are missing'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_confidence_semantics_ck';
  END IF;

  IF subject.suggestion_version_no>1 THEN
    SELECT id,governance_group_id,capability,suggestion_version_no
      INTO previous
      FROM ai_governance_suggestions
      WHERE id=subject.supersedes_suggestion_id;
    IF NOT FOUND
       OR previous.governance_group_id<>subject.governance_group_id
       OR previous.capability<>subject.capability
       OR previous.suggestion_version_no<>subject.suggestion_version_no-1 THEN
      RAISE EXCEPTION 'AI governance suggestion version chain is not contiguous'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_version_chain_ck';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ai_governance_suggestion_events
      WHERE suggestion_id=previous.id
        AND event_type='SUPERSEDED'
        AND superseding_suggestion_id=subject.suggestion_id
    ) THEN
      RAISE EXCEPTION 'AI governance suggestion predecessor is not superseded by the next version'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_predecessor_event_ck';
    END IF;
  END IF;

  SELECT count(*) INTO item_count
  FROM ai_governance_suggestion_items
  WHERE suggestion_id=subject.suggestion_id;
  IF (subject.disposition='SUGGEST' AND item_count<1)
     OR (subject.disposition='ABSTAIN' AND item_count<>0) THEN
    RAISE EXCEPTION 'AI governance suggestion disposition and item cardinality mismatch'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_item_cardinality_ck';
  END IF;

  FOR item IN SELECT * FROM ai_governance_suggestion_items WHERE suggestion_id=subject.suggestion_id LOOP
    IF item.item_kind<>subject.capability
       OR item.created_by IS DISTINCT FROM subject.created_by
       OR item.request_id IS DISTINCT FROM subject.request_id
       OR item.created_at IS DISTINCT FROM subject.created_at
       OR item.row_version<>1 THEN
      RAISE EXCEPTION 'AI governance suggestion item subject or transaction identity mismatch'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_subject_ck';
    END IF;
    IF item.score IS NOT NULL AND subject.confidence_semantics_version IS NULL THEN
      RAISE EXCEPTION 'AI governance suggestion item score semantics are missing'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_score_semantics_ck';
    END IF;

    IF item.item_kind='CLASSIFICATION' AND NOT EXISTS (
      SELECT 1 FROM material_categories category
      WHERE category.id=item.category_id
        AND category.version=item.category_version_snapshot
        AND category.status=item.category_status_snapshot
        AND category.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'AI governance classification target snapshot is invalid'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_category_snapshot_ck';
    END IF;
    IF item.item_kind='ATTRIBUTE_EXTRACTION' AND NOT EXISTS (
      SELECT 1 FROM material_attribute_definitions definition
      WHERE definition.id=item.attribute_definition_id
        AND definition.version=item.attribute_definition_version_snapshot
        AND definition.status=item.attribute_status_snapshot
        AND definition.status='ACTIVE'
        AND definition.data_type=item.attribute_value_type
    ) THEN
      RAISE EXCEPTION 'AI governance attribute target snapshot is invalid'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_attribute_snapshot_ck';
    END IF;
    IF item.item_kind IN ('MATERIAL_MATCH','SUPPLIER_MAPPING') AND NOT EXISTS (
      SELECT 1 FROM material_master material
      WHERE material.id=item.material_id
        AND material.version=item.material_version_snapshot
        AND material.material_status=item.material_status_snapshot
        AND material.material_status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'AI governance material target snapshot is invalid'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_material_snapshot_ck';
    END IF;
    IF item.item_kind='SUPPLIER_MAPPING' AND NOT EXISTS (
      SELECT 1 FROM suppliers supplier
      WHERE supplier.id=item.supplier_id
        AND supplier.version=item.supplier_version_snapshot
        AND supplier.status=item.supplier_status_snapshot
        AND supplier.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'AI governance supplier target snapshot is invalid'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_supplier_snapshot_ck';
    END IF;
    IF item.purchase_unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM units unit WHERE unit.id=item.purchase_unit_id AND unit.enabled
    ) THEN
      RAISE EXCEPTION 'AI governance supplier mapping unit is not enabled'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_unit_snapshot_ck';
    END IF;

    SELECT count(*) INTO evidence_count
    FROM ai_governance_suggestion_evidence
    WHERE suggestion_item_id=item.id;
    IF evidence_count<1 THEN
      RAISE EXCEPTION 'AI governance suggestion item requires evidence'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_items_evidence_cardinality_ck';
    END IF;

    FOR evidence IN SELECT * FROM ai_governance_suggestion_evidence WHERE suggestion_item_id=item.id LOOP
      IF evidence.created_by IS DISTINCT FROM subject.created_by
         OR evidence.request_id IS DISTINCT FROM subject.request_id
         OR evidence.created_at IS DISTINCT FROM subject.created_at
         OR evidence.row_version<>1 THEN
        RAISE EXCEPTION 'AI governance suggestion evidence transaction identity mismatch'
          USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_evidence_transaction_identity_ck';
      END IF;

      IF evidence.evidence_kind='GOVERNANCE_ROW' THEN
        PERFORM 1 FROM material_governance_rows row_fact
        WHERE row_fact.id=evidence.governance_row_id
          AND row_fact.group_id=subject.governance_group_id
          AND row_fact.governance_run_id=subject.governance_run_id;
      ELSIF evidence.evidence_kind='GOVERNANCE_SPEC' THEN
        PERFORM 1
        FROM material_governance_specs spec
        JOIN material_governance_rows row_fact ON row_fact.id=spec.governance_row_id
        WHERE spec.id=evidence.governance_spec_id
          AND row_fact.group_id=subject.governance_group_id
          AND row_fact.governance_run_id=subject.governance_run_id;
      ELSIF evidence.evidence_kind='DETERMINISTIC_MATERIAL_CANDIDATE' THEN
        PERFORM 1 FROM material_governance_material_candidates candidate
        WHERE candidate.id=evidence.governance_material_candidate_id
          AND candidate.group_id=subject.governance_group_id
          AND (item.material_id IS NULL OR candidate.material_id=item.material_id);
      ELSIF evidence.evidence_kind='DETERMINISTIC_ALTERNATIVE_CANDIDATE' THEN
        PERFORM 1 FROM material_governance_alternative_candidates candidate
        WHERE candidate.id=evidence.governance_alternative_candidate_id
          AND candidate.governance_run_id=subject.governance_run_id
          AND subject.governance_group_id IN (candidate.main_group_id,candidate.alternative_group_id);
      ELSIF evidence.evidence_kind='NORMALIZATION_LINEAGE' THEN
        PERFORM 1
        FROM material_import_normalization_lineage lineage
        JOIN material_governance_rows row_fact
          ON row_fact.normalized_row_id=lineage.normalized_row_id
        WHERE lineage.id=evidence.normalization_lineage_id
          AND row_fact.group_id=subject.governance_group_id
          AND row_fact.governance_run_id=subject.governance_run_id;
      ELSIF evidence.evidence_kind='MATERIAL_VERSION' THEN
        PERFORM 1 WHERE evidence.material_id IS NOT DISTINCT FROM item.material_id
          AND evidence.observed_version_no IS NOT DISTINCT FROM item.material_version_snapshot;
      ELSIF evidence.evidence_kind='SUPPLIER_VERSION' THEN
        PERFORM 1 WHERE evidence.supplier_id IS NOT DISTINCT FROM item.supplier_id
          AND evidence.observed_version_no IS NOT DISTINCT FROM item.supplier_version_snapshot;
      ELSIF evidence.evidence_kind='SUPPLIER_MAPPING_VERSION' THEN
        PERFORM 1 FROM supplier_mappings mapping
        WHERE mapping.id=evidence.supplier_mapping_version_id
          AND mapping.supplier_id IS NOT DISTINCT FROM item.supplier_id
          AND mapping.material_id=item.material_id
          AND mapping.mapping_version_no=evidence.observed_version_no;
      ELSE
        PERFORM 1;
      END IF;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'AI governance suggestion evidence crosses subject or input lineage'
          USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_evidence_subject_lineage_ck';
      END IF;
    END LOOP;
  END LOOP;

  IF (SELECT count(*) FROM ai_governance_suggestion_events
      WHERE suggestion_id=subject.suggestion_id AND event_type='CREATED')<>1 THEN
    RAISE EXCEPTION 'AI governance suggestion must have exactly one CREATED event'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestions_created_event_ck';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_assert_event(p_event_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  event_fact record;
  created_fact record;
  next_suggestion record;
BEGIN
  SELECT event.*,suggestion.governance_group_id,suggestion.capability,
         suggestion.suggestion_version_no,suggestion.created_by suggestion_created_by,
         suggestion.request_id suggestion_request_id,suggestion.created_at suggestion_created_at,
         suggestion.row_version suggestion_row_version
    INTO event_fact
    FROM ai_governance_suggestion_events event
    JOIN ai_governance_suggestions suggestion ON suggestion.id=event.suggestion_id
    WHERE event.id=p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI governance suggestion event subject is missing'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_events_subject_ck';
  END IF;
  IF event_fact.expected_suggestion_row_version<>event_fact.suggestion_row_version
     OR event_fact.created_at<event_fact.suggestion_created_at THEN
    RAISE EXCEPTION 'AI governance suggestion event CAS snapshot is invalid'
      USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_events_cas_ck';
  END IF;
  IF event_fact.event_type='CREATED' THEN
    IF event_fact.actor IS DISTINCT FROM event_fact.suggestion_created_by
       OR event_fact.request_id IS DISTINCT FROM event_fact.suggestion_request_id
       OR event_fact.created_at IS DISTINCT FROM event_fact.suggestion_created_at THEN
      RAISE EXCEPTION 'AI governance suggestion CREATED event transaction identity mismatch'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_events_created_identity_ck';
    END IF;
  ELSE
    SELECT event_digest INTO created_fact
    FROM ai_governance_suggestion_events
    WHERE suggestion_id=event_fact.suggestion_id AND event_type='CREATED';
    IF NOT FOUND OR event_fact.expected_previous_event_digest IS DISTINCT FROM created_fact.event_digest THEN
      RAISE EXCEPTION 'AI governance suggestion terminal event previous digest mismatch'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_events_previous_digest_ck';
    END IF;
  END IF;
  IF event_fact.event_type='SUPERSEDED' THEN
    SELECT * INTO next_suggestion
    FROM ai_governance_suggestions
    WHERE id=event_fact.superseding_suggestion_id;
    IF NOT FOUND
       OR next_suggestion.governance_group_id<>event_fact.governance_group_id
       OR next_suggestion.capability<>event_fact.capability
       OR next_suggestion.suggestion_version_no<>event_fact.suggestion_version_no+1
       OR next_suggestion.supersedes_suggestion_id<>event_fact.suggestion_id THEN
      RAISE EXCEPTION 'AI governance suggestion SUPERSEDED event must point to the direct next version'
        USING ERRCODE='23514', CONSTRAINT='ai_governance_suggestion_events_superseded_chain_ck';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_run_complete_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cyd_ai_governance_suggestion_assert_run_complete(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_complete_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_suggestion_id bigint;
BEGIN
  IF TG_TABLE_NAME='ai_governance_suggestions' THEN
    target_suggestion_id:=NEW.id;
  ELSIF TG_TABLE_NAME='ai_governance_suggestion_items' THEN
    target_suggestion_id:=NEW.suggestion_id;
  ELSE
    SELECT suggestion_id INTO target_suggestion_id
    FROM ai_governance_suggestion_items WHERE id=NEW.suggestion_item_id;
  END IF;
  PERFORM cyd_ai_governance_suggestion_assert_complete(target_suggestion_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION cyd_ai_governance_suggestion_event_complete_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cyd_ai_governance_suggestion_assert_event(NEW.id);
  -- Terminal events validate CAS/chain only. CREATED already proved the
  -- historical target snapshot complete, and later drift may be the reason
  -- that a replacement or invalidation is being appended.
  IF NEW.event_type='CREATED' THEN
    PERFORM cyd_ai_governance_suggestion_assert_complete(NEW.suggestion_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_governance_suggestion_runs_guard
BEFORE INSERT OR UPDATE OR DELETE ON ai_governance_suggestion_runs
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_write_guard();
--> statement-breakpoint
CREATE TRIGGER ai_governance_suggestions_guard
BEFORE INSERT OR UPDATE OR DELETE ON ai_governance_suggestions
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_write_guard();
--> statement-breakpoint
CREATE TRIGGER ai_governance_suggestion_items_guard
BEFORE INSERT OR UPDATE OR DELETE ON ai_governance_suggestion_items
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_write_guard();
--> statement-breakpoint
CREATE TRIGGER ai_governance_suggestion_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON ai_governance_suggestion_evidence
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_write_guard();
--> statement-breakpoint
CREATE TRIGGER ai_governance_suggestion_events_guard
BEFORE INSERT OR UPDATE OR DELETE ON ai_governance_suggestion_events
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_write_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_governance_suggestion_runs_complete
AFTER INSERT ON ai_governance_suggestion_runs DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_run_complete_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_governance_suggestions_complete
AFTER INSERT ON ai_governance_suggestions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_complete_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_governance_suggestion_items_complete
AFTER INSERT ON ai_governance_suggestion_items DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_complete_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_governance_suggestion_evidence_complete
AFTER INSERT ON ai_governance_suggestion_evidence DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_complete_trigger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_governance_suggestion_events_complete
AFTER INSERT ON ai_governance_suggestion_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cyd_ai_governance_suggestion_event_complete_trigger();
--> statement-breakpoint
ALTER TABLE ai_governance_suggestion_runs ENABLE ALWAYS TRIGGER ai_governance_suggestion_runs_guard;
ALTER TABLE ai_governance_suggestions ENABLE ALWAYS TRIGGER ai_governance_suggestions_guard;
ALTER TABLE ai_governance_suggestion_items ENABLE ALWAYS TRIGGER ai_governance_suggestion_items_guard;
ALTER TABLE ai_governance_suggestion_evidence ENABLE ALWAYS TRIGGER ai_governance_suggestion_evidence_guard;
ALTER TABLE ai_governance_suggestion_events ENABLE ALWAYS TRIGGER ai_governance_suggestion_events_guard;
ALTER TABLE ai_governance_suggestion_runs ENABLE ALWAYS TRIGGER ai_governance_suggestion_runs_complete;
ALTER TABLE ai_governance_suggestions ENABLE ALWAYS TRIGGER ai_governance_suggestions_complete;
ALTER TABLE ai_governance_suggestion_items ENABLE ALWAYS TRIGGER ai_governance_suggestion_items_complete;
ALTER TABLE ai_governance_suggestion_evidence ENABLE ALWAYS TRIGGER ai_governance_suggestion_evidence_complete;
ALTER TABLE ai_governance_suggestion_events ENABLE ALWAYS TRIGGER ai_governance_suggestion_events_complete;
