CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"username" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "app_users_version_ck" CHECK ("app_users"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"result" text DEFAULT 'success' NOT NULL,
	"route_code" text DEFAULT '' NOT NULL,
	"material_id" bigint,
	"operation_id" uuid,
	"idempotency_key_digest" text,
	"old_version" integer,
	"new_version" integer,
	"error_code" text,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"result" jsonb,
	"last_error_code" text,
	"last_error_message" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_jobs_status_ck" CHECK ("background_jobs"."status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD','CANCELLED')),
	CONSTRAINT "background_jobs_attempt_ck" CHECK ("background_jobs"."attempt_count" >= 0 and "background_jobs"."max_attempts" > 0 and "background_jobs"."attempt_count" <= "background_jobs"."max_attempts"),
	CONSTRAINT "background_jobs_version_ck" CHECK ("background_jobs"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "brand_aliases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"brand_id" bigint NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"standard_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key_digest" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_digest" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"item_code" text PRIMARY KEY NOT NULL,
	"on_hand_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reserved_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_code" text NOT NULL,
	"txn_type" text NOT NULL,
	"qty" numeric(24, 6) NOT NULL,
	"ref_type" text DEFAULT '' NOT NULL,
	"ref_no" text DEFAULT '' NOT NULL,
	"before_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"after_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_material_mapping" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_table" text NOT NULL,
	"source_key" text NOT NULL,
	"source_code" text DEFAULT '' NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"mapping_method" text NOT NULL,
	"status" text NOT NULL,
	"mapped_by" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_aliases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"alias_type" text NOT NULL,
	"alias_text" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"language_code" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_api_idempotency" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"method" text NOT NULL,
	"route_scope" text NOT NULL,
	"key_digest" text NOT NULL,
	"request_digest" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"state" text NOT NULL,
	"response" jsonb,
	"status_code" integer,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"material_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "material_api_rate_limit_buckets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"new_key_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_attribute_definitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attribute_code" text NOT NULL,
	"attribute_name_cn" text NOT NULL,
	"attribute_name_en" text DEFAULT '' NOT NULL,
	"data_type" text NOT NULL,
	"decimal_scale" integer DEFAULT 0 NOT NULL,
	"canonical_unit" text DEFAULT '' NOT NULL,
	"allowed_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalization_rule" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_by" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_attribute_values" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"attribute_definition_id" bigint NOT NULL,
	"value" jsonb NOT NULL,
	"normalized_value" text NOT NULL,
	"unit_code" text DEFAULT '' NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"category_name_cn" text NOT NULL,
	"category_name_en" text DEFAULT '' NOT NULL,
	"parent_id" bigint,
	"category_level" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "material_categories_level_ck" CHECK ("material_categories"."category_level" between 1 and 4),
	CONSTRAINT "material_categories_status_ck" CHECK ("material_categories"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "material_category_attributes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category_id" bigint NOT NULL,
	"attribute_definition_id" bigint NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_unique_key_component" boolean DEFAULT false NOT NULL,
	"is_searchable" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_change_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"change_type" text NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"change_reason" text DEFAULT '' NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_code_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_code" text NOT NULL,
	"rule_name" text NOT NULL,
	"category_id" bigint NOT NULL,
	"prefix" text DEFAULT 'CYD' NOT NULL,
	"major_segment" text NOT NULL,
	"minor_segment" text NOT NULL,
	"separator" text DEFAULT '-' NOT NULL,
	"sequence_width" integer DEFAULT 6 NOT NULL,
	"next_sequence" bigint DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_duplicate_candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"normalized_row_id" bigint NOT NULL,
	"draft_material_id" bigint NOT NULL,
	"candidate_material_id" bigint NOT NULL,
	"match_level" text NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"matched_fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "material_duplicate_candidates_not_self_ck" CHECK ("material_duplicate_candidates"."draft_material_id" <> "material_duplicate_candidates"."candidate_material_id")
);
--> statement-breakpoint
CREATE TABLE "material_import_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_no" text NOT NULL,
	"source_kind" text NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"retry_of_batch_id" bigint,
	"created_by" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"current_parse_run_id" bigint,
	"current_normalization_run_id" bigint,
	"file_count" integer DEFAULT 0 NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"accepted_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"failure_stage" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_import_batches_version_ck" CHECK ("material_import_batches"."current_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_import_draft_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"file_id" bigint NOT NULL,
	"source_row_id" bigint NOT NULL,
	"normalized_row_id" bigint NOT NULL,
	"normalization_approval_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_identifier" text,
	"previous_status" text,
	"new_status" text,
	"request_id" uuid NOT NULL,
	"safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"storage_name" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_status" text DEFAULT 'STORED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_import_files_sha_ck" CHECK ("material_import_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "material_import_files_size_ck" CHECK ("material_import_files"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_import_header_suggestions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"parse_run_id" bigint NOT NULL,
	"sheet_index" integer NOT NULL,
	"row_number" integer NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(6, 5) NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"algorithm_version" text NOT NULL,
	"metadata_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_idempotency" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"method" text NOT NULL,
	"route_scope" text NOT NULL,
	"key_digest" text NOT NULL,
	"request_digest" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"state" text NOT NULL,
	"batch_id" bigint,
	"file_id" bigint,
	"response" jsonb,
	"status_code" integer,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"recovery_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_job_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_mapping_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mapping_id" bigint NOT NULL,
	"target_code" text NOT NULL,
	"mapping_mode" text NOT NULL,
	"source_column_indexes" jsonb,
	"source_headers" jsonb,
	"default_value" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"combination_strategy" text DEFAULT 'FIRST_NON_EMPTY' NOT NULL,
	"mapping_confidence" numeric(6, 5) DEFAULT '0' NOT NULL,
	"mapping_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_mappings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"parse_run_id" bigint NOT NULL,
	"mapping_version" integer DEFAULT 1 NOT NULL,
	"selected_sheet_index" integer NOT NULL,
	"header_mode" text NOT NULL,
	"header_row_number" integer,
	"metadata_digest" text NOT NULL,
	"mapping_digest" text NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_normalization_approvals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"normalization_run_id" bigint NOT NULL,
	"result_digest" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_normalization_issues" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"normalization_run_id" bigint NOT NULL,
	"normalized_row_id" bigint NOT NULL,
	"issue_level" text NOT NULL,
	"issue_code" text NOT NULL,
	"target_code" text NOT NULL,
	"source_sheet_index" integer NOT NULL,
	"source_row_number" integer NOT NULL,
	"source_column_index" integer,
	"safe_message" text NOT NULL,
	"safe_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_normalization_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"parse_run_id" bigint NOT NULL,
	"mapping_id" bigint NOT NULL,
	"mapping_version" integer NOT NULL,
	"mapping_digest" text NOT NULL,
	"processor_version" text NOT NULL,
	"metadata_digest" text NOT NULL,
	"run_status" text NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"current_stage" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"result_digest" text,
	"requested_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"safe_failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_normalized_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"normalization_run_id" bigint NOT NULL,
	"source_sheet_index" integer NOT NULL,
	"source_row_number" integer NOT NULL,
	"source_raw_row_hash" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"normalized_payload_hash" text NOT NULL,
	"mapped_values" jsonb,
	"row_status" text NOT NULL,
	"review_status" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_parse_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"parser_version" text NOT NULL,
	"run_status" text NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"source_file_sha256" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"worker_request_id" uuid,
	"current_stage" text NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"parsed_sheet_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"safe_failure_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_parse_sheets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"parse_run_id" bigint NOT NULL,
	"sheet_index" integer NOT NULL,
	"sheet_name" text NOT NULL,
	"visibility" text NOT NULL,
	"parse_status" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"source_column_max" integer DEFAULT 0 NOT NULL,
	"merged_ranges" jsonb,
	"warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"job_id" uuid NOT NULL,
	"sheet_index" integer DEFAULT 0 NOT NULL,
	"sheet_name" text DEFAULT 'CSV' NOT NULL,
	"row_number" integer NOT NULL,
	"raw_values" jsonb NOT NULL,
	"raw_row_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_shared_string_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"parse_run_id" bigint NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_string_index" integer NOT NULL,
	"item_count" integer NOT NULL,
	"decoded_bytes" integer NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_import_supplier_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_code" text NOT NULL,
	"profile_name" text NOT NULL,
	"supplier_key" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_master" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"internal_material_code" text,
	"standard_name" text NOT NULL,
	"category_id" bigint NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"brand_id" bigint,
	"manufacturer" text DEFAULT '' NOT NULL,
	"manufacturer_part_number" text DEFAULT '' NOT NULL,
	"base_uom" text NOT NULL,
	"base_unit_id" bigint,
	"material_status" text DEFAULT 'DRAFT' NOT NULL,
	"procurement_type" text NOT NULL,
	"inventory_type" text NOT NULL,
	"lot_control_required" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"inspection_type" text NOT NULL,
	"environmental_requirement" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"source_import_batch_id" bigint,
	"source_import_file_id" bigint,
	"source_import_row_id" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"last_modified_by" text NOT NULL,
	"submitted_by" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "material_master_version_ck" CHECK ("material_master"."version" > 0),
	CONSTRAINT "material_master_status_ck" CHECK ("material_master"."material_status" in ('DRAFT','PENDING_REVIEW','ACTIVE','FROZEN','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "material_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"event_type" text NOT NULL,
	"change_reason" text DEFAULT '' NOT NULL,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_mapping_price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_mapping_id" bigint NOT NULL,
	"price" numeric(24, 6) NOT NULL,
	"currency_code" text NOT NULL,
	"price_uom" text NOT NULL,
	"minimum_order_qty" numeric(24, 6),
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source_document_ref" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_mappings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_key" text NOT NULL,
	"supplier_item_code" text NOT NULL,
	"supplier_item_name" text DEFAULT '' NOT NULL,
	"supplier_specification" text DEFAULT '' NOT NULL,
	"manufacturer" text DEFAULT '' NOT NULL,
	"mpn" text DEFAULT '' NOT NULL,
	"revision" text DEFAULT '' NOT NULL,
	"purchase_uom" text NOT NULL,
	"conversion_numerator" bigint DEFAULT 1 NOT NULL,
	"conversion_denominator" bigint DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_aliases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"unit_id" bigint NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"unit_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_username_app_users_username_fk" FOREIGN KEY ("username") REFERENCES "public"."app_users"("username") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_material_mapping" ADD CONSTRAINT "legacy_material_mapping_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_aliases" ADD CONSTRAINT "material_aliases_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_api_idempotency" ADD CONSTRAINT "material_api_idempotency_username_app_users_username_fk" FOREIGN KEY ("username") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_api_idempotency" ADD CONSTRAINT "material_api_idempotency_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_api_rate_limit_buckets" ADD CONSTRAINT "material_api_rate_limit_buckets_username_app_users_username_fk" FOREIGN KEY ("username") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_attribute_values" ADD CONSTRAINT "material_attribute_values_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_attribute_values" ADD CONSTRAINT "material_attribute_values_attribute_definition_id_material_attribute_definitions_id_fk" FOREIGN KEY ("attribute_definition_id") REFERENCES "public"."material_attribute_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_category_attributes" ADD CONSTRAINT "material_category_attributes_category_id_material_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."material_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_category_attributes" ADD CONSTRAINT "material_category_attributes_attribute_definition_id_material_attribute_definitions_id_fk" FOREIGN KEY ("attribute_definition_id") REFERENCES "public"."material_attribute_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_change_logs" ADD CONSTRAINT "material_change_logs_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_code_rules" ADD CONSTRAINT "material_code_rules_category_id_material_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."material_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_duplicate_candidates" ADD CONSTRAINT "material_duplicate_candidates_normalized_row_id_material_import_normalized_rows_id_fk" FOREIGN KEY ("normalized_row_id") REFERENCES "public"."material_import_normalized_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_duplicate_candidates" ADD CONSTRAINT "material_duplicate_candidates_draft_material_id_material_master_id_fk" FOREIGN KEY ("draft_material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_duplicate_candidates" ADD CONSTRAINT "material_duplicate_candidates_candidate_material_id_material_master_id_fk" FOREIGN KEY ("candidate_material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_batches" ADD CONSTRAINT "material_import_batches_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_draft_links" ADD CONSTRAINT "material_import_draft_links_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_draft_links" ADD CONSTRAINT "material_import_draft_links_file_id_material_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."material_import_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_draft_links" ADD CONSTRAINT "material_import_draft_links_source_row_id_material_import_rows_id_fk" FOREIGN KEY ("source_row_id") REFERENCES "public"."material_import_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_draft_links" ADD CONSTRAINT "material_import_draft_links_normalized_row_id_material_import_normalized_rows_id_fk" FOREIGN KEY ("normalized_row_id") REFERENCES "public"."material_import_normalized_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_draft_links" ADD CONSTRAINT "material_import_draft_links_normalization_approval_id_material_import_normalization_approvals_id_fk" FOREIGN KEY ("normalization_approval_id") REFERENCES "public"."material_import_normalization_approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_draft_links" ADD CONSTRAINT "material_import_draft_links_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_events" ADD CONSTRAINT "material_import_events_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_files" ADD CONSTRAINT "material_import_files_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_header_suggestions" ADD CONSTRAINT "material_import_header_suggestions_parse_run_id_material_import_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."material_import_parse_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_username_app_users_username_fk" FOREIGN KEY ("username") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_idempotency" ADD CONSTRAINT "material_import_idempotency_file_id_material_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."material_import_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_mapping_items" ADD CONSTRAINT "material_import_mapping_items_mapping_id_material_import_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."material_import_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD CONSTRAINT "material_import_mappings_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_mappings" ADD CONSTRAINT "material_import_mappings_parse_run_id_material_import_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."material_import_parse_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_approvals" ADD CONSTRAINT "material_import_normalization_approvals_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_approvals" ADD CONSTRAINT "material_import_normalization_approvals_normalization_run_id_material_import_normalization_runs_id_fk" FOREIGN KEY ("normalization_run_id") REFERENCES "public"."material_import_normalization_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_approvals" ADD CONSTRAINT "material_import_normalization_approvals_approved_by_app_users_username_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_issues" ADD CONSTRAINT "material_import_normalization_issues_normalization_run_id_material_import_normalization_runs_id_fk" FOREIGN KEY ("normalization_run_id") REFERENCES "public"."material_import_normalization_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_issues" ADD CONSTRAINT "material_import_normalization_issues_normalized_row_id_material_import_normalized_rows_id_fk" FOREIGN KEY ("normalized_row_id") REFERENCES "public"."material_import_normalized_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_runs" ADD CONSTRAINT "material_import_normalization_runs_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_runs" ADD CONSTRAINT "material_import_normalization_runs_parse_run_id_material_import_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."material_import_parse_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_runs" ADD CONSTRAINT "material_import_normalization_runs_mapping_id_material_import_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."material_import_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalization_runs" ADD CONSTRAINT "material_import_normalization_runs_requested_by_app_users_username_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalized_rows" ADD CONSTRAINT "material_import_normalized_rows_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_normalized_rows" ADD CONSTRAINT "material_import_normalized_rows_normalization_run_id_material_import_normalization_runs_id_fk" FOREIGN KEY ("normalization_run_id") REFERENCES "public"."material_import_normalization_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_parse_runs" ADD CONSTRAINT "material_import_parse_runs_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_parse_sheets" ADD CONSTRAINT "material_import_parse_sheets_parse_run_id_material_import_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."material_import_parse_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_rows" ADD CONSTRAINT "material_import_rows_batch_id_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_shared_string_chunks" ADD CONSTRAINT "material_import_shared_string_chunks_parse_run_id_material_import_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."material_import_parse_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_master" ADD CONSTRAINT "material_master_category_id_material_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."material_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_master" ADD CONSTRAINT "material_master_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_master" ADD CONSTRAINT "material_master_base_unit_id_units_id_fk" FOREIGN KEY ("base_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mapping_price_history" ADD CONSTRAINT "supplier_mapping_price_history_supplier_mapping_id_supplier_mappings_id_fk" FOREIGN KEY ("supplier_mapping_id") REFERENCES "public"."supplier_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_aliases" ADD CONSTRAINT "unit_aliases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_sessions_username_idx" ON "app_sessions" USING btree ("username");--> statement-breakpoint
CREATE INDEX "app_sessions_expiry_idx" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_request_id_idx" ON "audit_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "audit_log_material_created_idx" ON "audit_log" USING btree ("material_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idempotency_uq" ON "background_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("status","available_at","priority","created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_lease_idx" ON "background_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_aliases_normalized_uq" ON "brand_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "brand_aliases_brand_idx" ON "brand_aliases" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_code_uq" ON "brands" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_normalized_name_uq" ON "brands" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_records_kind_code_uq" ON "erp_records" USING btree ("kind","code");--> statement-breakpoint
CREATE INDEX "erp_records_kind_idx" ON "erp_records" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inventory_transactions_item_idx" ON "inventory_transactions" USING btree ("item_code","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_material_mapping_source_identity_uq" ON "legacy_material_mapping" USING btree ("source_type","source_table","source_key");--> statement-breakpoint
CREATE INDEX "legacy_material_mapping_material_idx" ON "legacy_material_mapping" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_aliases_material_type_normalized_uq" ON "material_aliases" USING btree ("material_id","alias_type","normalized_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "material_api_idempotency_scope_uq" ON "material_api_idempotency" USING btree ("username","method","route_scope","key_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "material_api_idempotency_operation_uq" ON "material_api_idempotency" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "material_api_idempotency_expiry_idx" ON "material_api_idempotency" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_api_rate_limit_user_bucket_uq" ON "material_api_rate_limit_buckets" USING btree ("username","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "material_attribute_definitions_code_uq" ON "material_attribute_definitions" USING btree ("attribute_code");--> statement-breakpoint
CREATE UNIQUE INDEX "material_attribute_values_material_definition_uq" ON "material_attribute_values" USING btree ("material_id","attribute_definition_id");--> statement-breakpoint
CREATE INDEX "material_attribute_values_definition_normalized_idx" ON "material_attribute_values" USING btree ("attribute_definition_id","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "material_categories_code_uq" ON "material_categories" USING btree ("category_code");--> statement-breakpoint
CREATE INDEX "material_categories_parent_status_sort_idx" ON "material_categories" USING btree ("parent_id","status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "material_category_attributes_category_definition_uq" ON "material_category_attributes" USING btree ("category_id","attribute_definition_id");--> statement-breakpoint
CREATE INDEX "material_change_logs_material_created_idx" ON "material_change_logs" USING btree ("material_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_code_rules_code_uq" ON "material_code_rules" USING btree ("rule_code");--> statement-breakpoint
CREATE INDEX "material_code_rules_category_status_idx" ON "material_code_rules" USING btree ("category_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_duplicate_candidates_pair_uq" ON "material_duplicate_candidates" USING btree ("normalized_row_id","candidate_material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_batches_no_uq" ON "material_import_batches" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX "material_import_batches_owner_created_idx" ON "material_import_batches" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "material_import_batches_status_created_idx" ON "material_import_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_draft_links_normalized_row_uq" ON "material_import_draft_links" USING btree ("normalized_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_draft_links_material_uq" ON "material_import_draft_links" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_import_events_batch_created_idx" ON "material_import_events" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_files_batch_uq" ON "material_import_files" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_files_path_uq" ON "material_import_files" USING btree ("relative_path");--> statement-breakpoint
CREATE INDEX "material_import_files_sha_idx" ON "material_import_files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_header_suggestions_position_uq" ON "material_import_header_suggestions" USING btree ("parse_run_id","sheet_index","row_number","algorithm_version");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_idempotency_scope_uq" ON "material_import_idempotency" USING btree ("username","method","route_scope","key_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_idempotency_operation_uq" ON "material_import_idempotency" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_job_outbox_idempotency_uq" ON "material_import_job_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "material_import_job_outbox_pending_idx" ON "material_import_job_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_mapping_items_target_uq" ON "material_import_mapping_items" USING btree ("mapping_id","target_code");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_mappings_batch_version_uq" ON "material_import_mappings" USING btree ("batch_id","mapping_version");--> statement-breakpoint
CREATE INDEX "material_import_mappings_batch_status_idx" ON "material_import_mappings" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_normalization_approvals_run_uq" ON "material_import_normalization_approvals" USING btree ("normalization_run_id");--> statement-breakpoint
CREATE INDEX "material_import_normalization_approvals_batch_idx" ON "material_import_normalization_approvals" USING btree ("batch_id","approved_at");--> statement-breakpoint
CREATE INDEX "material_import_normalization_issues_filter_idx" ON "material_import_normalization_issues" USING btree ("normalization_run_id","issue_level","issue_code");--> statement-breakpoint
CREATE INDEX "material_import_normalization_runs_batch_status_idx" ON "material_import_normalization_runs" USING btree ("batch_id","run_status","id");--> statement-breakpoint
CREATE INDEX "material_import_normalization_runs_lease_idx" ON "material_import_normalization_runs" USING btree ("run_status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_normalized_rows_position_uq" ON "material_import_normalized_rows" USING btree ("normalization_run_id","source_sheet_index","source_row_number");--> statement-breakpoint
CREATE INDEX "material_import_normalized_rows_status_idx" ON "material_import_normalized_rows" USING btree ("normalization_run_id","row_status");--> statement-breakpoint
CREATE INDEX "material_import_parse_runs_batch_status_idx" ON "material_import_parse_runs" USING btree ("batch_id","run_status","id");--> statement-breakpoint
CREATE INDEX "material_import_parse_runs_lease_idx" ON "material_import_parse_runs" USING btree ("run_status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_parse_sheets_position_uq" ON "material_import_parse_sheets" USING btree ("parse_run_id","sheet_index");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_rows_position_uq" ON "material_import_rows" USING btree ("batch_id","sheet_index","row_number");--> statement-breakpoint
CREATE INDEX "material_import_rows_batch_idx" ON "material_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_shared_string_chunks_position_uq" ON "material_import_shared_string_chunks" USING btree ("parse_run_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "material_import_supplier_profiles_code_uq" ON "material_import_supplier_profiles" USING btree ("profile_code");--> statement-breakpoint
CREATE UNIQUE INDEX "material_master_internal_code_uq" ON "material_master" USING btree ("internal_material_code") WHERE "material_master"."internal_material_code" is not null;--> statement-breakpoint
CREATE INDEX "material_master_status_updated_idx" ON "material_master" USING btree ("material_status","updated_at");--> statement-breakpoint
CREATE INDEX "material_master_category_status_idx" ON "material_master" USING btree ("category_id","material_status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_versions_material_version_uq" ON "material_versions" USING btree ("material_id","version_no");--> statement-breakpoint
CREATE INDEX "material_versions_material_created_idx" ON "material_versions" USING btree ("material_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_mapping_price_history_from_idx" ON "supplier_mapping_price_history" USING btree ("supplier_mapping_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_mappings_identity_period_uq" ON "supplier_mappings" USING btree ("supplier_key","supplier_item_code","manufacturer","mpn","revision","valid_from");--> statement-breakpoint
CREATE INDEX "supplier_mappings_material_idx" ON "supplier_mappings" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_aliases_normalized_uq" ON "unit_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "unit_aliases_unit_idx" ON "unit_aliases" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_uq" ON "units" USING btree ("code");