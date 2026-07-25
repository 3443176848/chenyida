CREATE TABLE "procurement_rfqs" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_code" text NOT NULL,
  "purchase_request_id" bigint NOT NULL,
  "round_no" integer NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "response_deadline" date NOT NULL,
  "currency_code" text DEFAULT 'CNY' NOT NULL,
  "source_purchase_request_version" integer NOT NULL,
  "source_digest" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "request_id" uuid NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "issued_by" text,
  "issued_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_rfqs_code_ck" CHECK ("rfq_code" ~ '^RFQ-[0-9]{8}$'),
  CONSTRAINT "procurement_rfqs_round_ck" CHECK ("round_no">0 AND "version">0 AND "source_purchase_request_version">0),
  CONSTRAINT "procurement_rfqs_status_ck" CHECK ("status" IN ('DRAFT','ISSUED','CLOSED','CANCELLED')),
  CONSTRAINT "procurement_rfqs_currency_ck" CHECK ("currency_code"='CNY'),
  CONSTRAINT "procurement_rfqs_digest_ck" CHECK ("source_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "procurement_rfqs_issue_ck" CHECK (("status"='DRAFT' AND "issued_by" IS NULL AND "issued_at" IS NULL) OR ("status"<>'DRAFT' AND "issued_by" IS NOT NULL AND "issued_at" IS NOT NULL)),
  CONSTRAINT "procurement_rfqs_close_ck" CHECK (("status"='CLOSED' AND "closed_at" IS NOT NULL) OR ("status"<>'CLOSED' AND "closed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "procurement_rfq_lines" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_id" bigint NOT NULL,
  "purchase_request_line_id" bigint NOT NULL,
  "material_id" bigint NOT NULL,
  "unit_id" bigint NOT NULL,
  "requested_quantity" numeric(24,6) NOT NULL,
  "required_date" date NOT NULL,
  "line_no" integer NOT NULL,
  "source_digest" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_rfq_lines_quantity_ck" CHECK ("requested_quantity">0 AND "line_no">0),
  CONSTRAINT "procurement_rfq_lines_digest_ck" CHECK ("source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "procurement_rfq_suppliers" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_id" bigint NOT NULL,
  "supplier_id" bigint NOT NULL,
  "status" text DEFAULT 'INVITED' NOT NULL,
  "invited_by" text NOT NULL,
  "invited_at" timestamp with time zone DEFAULT now() NOT NULL,
  "responded_at" timestamp with time zone,
  "supplier_mapping_digest" text NOT NULL,
  CONSTRAINT "procurement_rfq_suppliers_status_ck" CHECK ("status" IN ('INVITED','RESPONDED','DECLINED')),
  CONSTRAINT "procurement_rfq_suppliers_digest_ck" CHECK ("supplier_mapping_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "procurement_rfq_suppliers_response_ck" CHECK (("status"='RESPONDED' AND "responded_at" IS NOT NULL) OR ("status"<>'RESPONDED' AND "responded_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "procurement_supplier_quotes" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_id" bigint NOT NULL,
  "supplier_id" bigint NOT NULL,
  "quote_version_no" integer NOT NULL,
  "supplier_quote_reference" text NOT NULL,
  "status" text DEFAULT 'SUBMITTED' NOT NULL,
  "currency_code" text DEFAULT 'CNY' NOT NULL,
  "valid_until" date NOT NULL,
  "tax_included" boolean NOT NULL,
  "freight_included" boolean NOT NULL,
  "payment_terms" text NOT NULL,
  "quote_digest" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "request_id" uuid NOT NULL,
  CONSTRAINT "procurement_supplier_quotes_status_ck" CHECK ("status" IN ('SUBMITTED','SUPERSEDED','WITHDRAWN')),
  CONSTRAINT "procurement_supplier_quotes_version_ck" CHECK ("quote_version_no">0 AND "version">0),
  CONSTRAINT "procurement_supplier_quotes_currency_ck" CHECK ("currency_code"='CNY'),
  CONSTRAINT "procurement_supplier_quotes_reference_ck" CHECK (char_length(btrim("supplier_quote_reference")) BETWEEN 1 AND 200),
  CONSTRAINT "procurement_supplier_quotes_terms_ck" CHECK (char_length(btrim("payment_terms")) BETWEEN 1 AND 1000),
  CONSTRAINT "procurement_supplier_quotes_digest_ck" CHECK ("quote_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "procurement_supplier_quote_lines" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "quote_id" bigint NOT NULL,
  "rfq_line_id" bigint NOT NULL,
  "material_id" bigint NOT NULL,
  "unit_id" bigint NOT NULL,
  "quoted_quantity" numeric(24,6) NOT NULL,
  "minimum_order_quantity" numeric(24,6) NOT NULL,
  "unit_price" numeric(24,6) NOT NULL,
  "lead_time_days" integer NOT NULL,
  "promised_delivery_date" date NOT NULL,
  "line_digest" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_supplier_quote_lines_quantity_ck" CHECK ("quoted_quantity">0 AND "minimum_order_quantity">0 AND "unit_price">0 AND "lead_time_days">=0),
  CONSTRAINT "procurement_supplier_quote_lines_digest_ck" CHECK ("line_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "procurement_quote_comparisons" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_id" bigint NOT NULL,
  "rfq_line_id" bigint NOT NULL,
  "comparison_version_no" integer NOT NULL,
  "basis_digest" text NOT NULL,
  "generated_by" text NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "request_id" uuid NOT NULL,
  CONSTRAINT "procurement_quote_comparisons_version_ck" CHECK ("comparison_version_no">0),
  CONSTRAINT "procurement_quote_comparisons_digest_ck" CHECK ("basis_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "procurement_quote_comparison_lines" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "comparison_id" bigint NOT NULL,
  "quote_line_id" bigint NOT NULL,
  "supplier_id" bigint NOT NULL,
  "currency_code" text NOT NULL,
  "unit_id" bigint NOT NULL,
  "tax_included" boolean NOT NULL,
  "freight_included" boolean NOT NULL,
  "unit_price" numeric(24,6) NOT NULL,
  "minimum_order_quantity" numeric(24,6) NOT NULL,
  "promised_delivery_date" date NOT NULL,
  "price_rank" integer,
  "lowest_price" boolean NOT NULL,
  "moq_satisfied" boolean NOT NULL,
  "delivery_status" text NOT NULL,
  "quote_expired" boolean NOT NULL,
  "comparable_status" text NOT NULL,
  "reason_code" text NOT NULL,
  "awardable" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_quote_comparison_lines_numeric_ck" CHECK ("unit_price">0 AND "minimum_order_quantity">0 AND ("price_rank" IS NULL OR "price_rank">0)),
  CONSTRAINT "procurement_quote_comparison_lines_delivery_ck" CHECK ("delivery_status" IN ('ON_TIME','LATE')),
  CONSTRAINT "procurement_quote_comparison_lines_comparable_ck" CHECK ("comparable_status" IN ('COMPARABLE','NOT_COMPARABLE')),
  CONSTRAINT "procurement_quote_comparison_lines_rank_ck" CHECK (("comparable_status"='COMPARABLE' AND "price_rank" IS NOT NULL) OR ("comparable_status"='NOT_COMPARABLE' AND "price_rank" IS NULL AND NOT "lowest_price" AND NOT "awardable"))
);
--> statement-breakpoint
CREATE TABLE "procurement_sourcing_awards" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_id" bigint NOT NULL,
  "status" text DEFAULT 'AWARDED' NOT NULL,
  "award_digest" text NOT NULL,
  "selected_by" text NOT NULL,
  "selected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reason_code" text NOT NULL,
  "reason" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "request_id" uuid NOT NULL,
  "reversed_by" text,
  "reversed_at" timestamp with time zone,
  "reversal_reason" text NOT NULL DEFAULT '',
  CONSTRAINT "procurement_sourcing_awards_status_ck" CHECK ("status" IN ('AWARDED','REVERSED')),
  CONSTRAINT "procurement_sourcing_awards_digest_ck" CHECK ("award_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "procurement_sourcing_awards_reason_ck" CHECK (char_length(btrim("reason_code")) BETWEEN 1 AND 64 AND char_length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "procurement_sourcing_awards_version_ck" CHECK ("version">0),
  CONSTRAINT "procurement_sourcing_awards_reversal_ck" CHECK (("status"='AWARDED' AND "reversed_by" IS NULL AND "reversed_at" IS NULL AND "reversal_reason"='') OR ("status"='REVERSED' AND "reversed_by" IS NOT NULL AND "reversed_at" IS NOT NULL AND char_length(btrim("reversal_reason")) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
CREATE TABLE "procurement_sourcing_award_lines" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "award_id" bigint NOT NULL,
  "rfq_line_id" bigint NOT NULL,
  "comparison_id" bigint NOT NULL,
  "selected_quote_line_id" bigint NOT NULL,
  "supplier_id" bigint NOT NULL,
  "selected_quantity" numeric(24,6) NOT NULL,
  "selected_unit_price" numeric(24,6) NOT NULL,
  "required_date" date NOT NULL,
  "promised_delivery_date" date NOT NULL,
  "selection_reason" text NOT NULL DEFAULT '',
  "late_delivery_reason_code" text,
  "late_delivery_reason" text NOT NULL DEFAULT '',
  "excess_quantity_reason" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_sourcing_award_lines_quantity_ck" CHECK ("selected_quantity">0 AND "selected_unit_price">0),
  CONSTRAINT "procurement_sourcing_award_lines_late_ck" CHECK (("promised_delivery_date"<="required_date" AND "late_delivery_reason_code" IS NULL AND "late_delivery_reason"='') OR ("promised_delivery_date">"required_date" AND "late_delivery_reason_code"='LATE_DELIVERY_ACCEPTED' AND char_length(btrim("late_delivery_reason")) BETWEEN 1 AND 1000)),
  CONSTRAINT "procurement_sourcing_award_lines_reason_ck" CHECK (char_length("selection_reason")<=1000 AND char_length("excess_quantity_reason")<=1000)
);
--> statement-breakpoint
CREATE TABLE "procurement_sourcing_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "rfq_id" bigint NOT NULL,
  "quote_id" bigint,
  "comparison_id" bigint,
  "award_id" bigint,
  "event_type" text NOT NULL,
  "actor" text NOT NULL,
  "request_id" uuid NOT NULL,
  "reason" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_sourcing_events_type_ck" CHECK ("event_type" IN ('RFQ_ISSUED','QUOTE_SUBMITTED','QUOTE_SUPERSEDED','COMPARISON_GENERATED','AWARDED','AWARD_REVERSED')),
  CONSTRAINT "procurement_sourcing_events_reason_ck" CHECK (char_length("reason")<=1000)
);
--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_purchase_request_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "planning_purchase_requests"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_issued_by_fk" FOREIGN KEY ("issued_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_request_line_fk" FOREIGN KEY ("purchase_request_line_id") REFERENCES "planning_purchase_request_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_material_fk" FOREIGN KEY ("material_id") REFERENCES "material_master"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfq_suppliers" ADD CONSTRAINT "procurement_rfq_suppliers_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfq_suppliers" ADD CONSTRAINT "procurement_rfq_suppliers_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
ALTER TABLE "procurement_rfq_suppliers" ADD CONSTRAINT "procurement_rfq_suppliers_invited_by_fk" FOREIGN KEY ("invited_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quotes" ADD CONSTRAINT "procurement_supplier_quotes_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quotes" ADD CONSTRAINT "procurement_supplier_quotes_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quotes" ADD CONSTRAINT "procurement_supplier_quotes_recorded_by_fk" FOREIGN KEY ("recorded_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quote_lines" ADD CONSTRAINT "procurement_supplier_quote_lines_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "procurement_supplier_quotes"("id") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quote_lines" ADD CONSTRAINT "procurement_supplier_quote_lines_rfq_line_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "procurement_rfq_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quote_lines" ADD CONSTRAINT "procurement_supplier_quote_lines_material_fk" FOREIGN KEY ("material_id") REFERENCES "material_master"("id") ON DELETE restrict;
ALTER TABLE "procurement_supplier_quote_lines" ADD CONSTRAINT "procurement_supplier_quote_lines_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparisons" ADD CONSTRAINT "procurement_quote_comparisons_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparisons" ADD CONSTRAINT "procurement_quote_comparisons_rfq_line_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "procurement_rfq_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparisons" ADD CONSTRAINT "procurement_quote_comparisons_generated_by_fk" FOREIGN KEY ("generated_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparison_lines" ADD CONSTRAINT "procurement_quote_comparison_lines_comparison_fk" FOREIGN KEY ("comparison_id") REFERENCES "procurement_quote_comparisons"("id") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparison_lines" ADD CONSTRAINT "procurement_quote_comparison_lines_quote_line_fk" FOREIGN KEY ("quote_line_id") REFERENCES "procurement_supplier_quote_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparison_lines" ADD CONSTRAINT "procurement_quote_comparison_lines_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
ALTER TABLE "procurement_quote_comparison_lines" ADD CONSTRAINT "procurement_quote_comparison_lines_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_awards" ADD CONSTRAINT "procurement_sourcing_awards_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_awards" ADD CONSTRAINT "procurement_sourcing_awards_selected_by_fk" FOREIGN KEY ("selected_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_awards" ADD CONSTRAINT "procurement_sourcing_awards_reversed_by_fk" FOREIGN KEY ("reversed_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_award_lines" ADD CONSTRAINT "procurement_sourcing_award_lines_award_fk" FOREIGN KEY ("award_id") REFERENCES "procurement_sourcing_awards"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_award_lines" ADD CONSTRAINT "procurement_sourcing_award_lines_rfq_line_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "procurement_rfq_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_award_lines" ADD CONSTRAINT "procurement_sourcing_award_lines_comparison_fk" FOREIGN KEY ("comparison_id") REFERENCES "procurement_quote_comparisons"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_award_lines" ADD CONSTRAINT "procurement_sourcing_award_lines_quote_line_fk" FOREIGN KEY ("selected_quote_line_id") REFERENCES "procurement_supplier_quote_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_award_lines" ADD CONSTRAINT "procurement_sourcing_award_lines_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_rfq_fk" FOREIGN KEY ("rfq_id") REFERENCES "procurement_rfqs"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_quote_fk" FOREIGN KEY ("quote_id") REFERENCES "procurement_supplier_quotes"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_comparison_fk" FOREIGN KEY ("comparison_id") REFERENCES "procurement_quote_comparisons"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_award_fk" FOREIGN KEY ("award_id") REFERENCES "procurement_sourcing_awards"("id") ON DELETE restrict;
ALTER TABLE "procurement_sourcing_events" ADD CONSTRAINT "procurement_sourcing_events_actor_fk" FOREIGN KEY ("actor") REFERENCES "app_users"("username") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_rfqs_code_uq" ON "procurement_rfqs" ("rfq_code");
CREATE UNIQUE INDEX "procurement_rfqs_request_round_uq" ON "procurement_rfqs" ("purchase_request_id","round_no");
CREATE UNIQUE INDEX "procurement_rfqs_active_request_uq" ON "procurement_rfqs" ("purchase_request_id") WHERE "status" IN ('DRAFT','ISSUED');
CREATE INDEX "procurement_rfqs_queue_idx" ON "procurement_rfqs" ("status","response_deadline","id");
CREATE INDEX "procurement_rfqs_request_idx" ON "procurement_rfqs" ("purchase_request_id","round_no" DESC);
CREATE UNIQUE INDEX "procurement_rfq_lines_rfq_line_uq" ON "procurement_rfq_lines" ("rfq_id","line_no");
CREATE UNIQUE INDEX "procurement_rfq_lines_request_line_uq" ON "procurement_rfq_lines" ("rfq_id","purchase_request_line_id");
CREATE INDEX "procurement_rfq_lines_material_idx" ON "procurement_rfq_lines" ("material_id","unit_id","required_date","id");
CREATE UNIQUE INDEX "procurement_rfq_suppliers_rfq_supplier_uq" ON "procurement_rfq_suppliers" ("rfq_id","supplier_id");
CREATE INDEX "procurement_rfq_suppliers_supplier_status_idx" ON "procurement_rfq_suppliers" ("supplier_id","status","rfq_id");
CREATE UNIQUE INDEX "procurement_supplier_quotes_version_uq" ON "procurement_supplier_quotes" ("rfq_id","supplier_id","quote_version_no");
CREATE UNIQUE INDEX "procurement_supplier_quotes_current_uq" ON "procurement_supplier_quotes" ("rfq_id","supplier_id") WHERE "status"='SUBMITTED';
CREATE INDEX "procurement_supplier_quotes_valid_idx" ON "procurement_supplier_quotes" ("rfq_id","status","valid_until","supplier_id");
CREATE UNIQUE INDEX "procurement_supplier_quote_lines_quote_rfq_line_uq" ON "procurement_supplier_quote_lines" ("quote_id","rfq_line_id");
CREATE INDEX "procurement_supplier_quote_lines_material_idx" ON "procurement_supplier_quote_lines" ("material_id","unit_id","promised_delivery_date","id");
CREATE UNIQUE INDEX "procurement_quote_comparisons_version_uq" ON "procurement_quote_comparisons" ("rfq_line_id","comparison_version_no");
CREATE UNIQUE INDEX "procurement_quote_comparisons_basis_uq" ON "procurement_quote_comparisons" ("rfq_line_id","basis_digest");
CREATE INDEX "procurement_quote_comparisons_latest_idx" ON "procurement_quote_comparisons" ("rfq_id","rfq_line_id","comparison_version_no" DESC);
CREATE UNIQUE INDEX "procurement_quote_comparison_lines_quote_uq" ON "procurement_quote_comparison_lines" ("comparison_id","quote_line_id");
CREATE INDEX "procurement_quote_comparison_lines_supplier_idx" ON "procurement_quote_comparison_lines" ("supplier_id","comparison_id");
CREATE UNIQUE INDEX "procurement_sourcing_awards_rfq_uq" ON "procurement_sourcing_awards" ("rfq_id");
CREATE UNIQUE INDEX "procurement_sourcing_award_lines_rfq_line_uq" ON "procurement_sourcing_award_lines" ("rfq_line_id");
CREATE INDEX "procurement_sourcing_award_lines_supplier_idx" ON "procurement_sourcing_award_lines" ("supplier_id","award_id");
CREATE INDEX "procurement_sourcing_events_rfq_idx" ON "procurement_sourcing_events" ("rfq_id","id");
CREATE INDEX "procurement_sourcing_events_request_idx" ON "procurement_sourcing_events" ("request_id","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_sourcing_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'procurement sourcing records cannot be deleted'; END IF;
  IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement sourcing projections require service transaction'; END IF;
  IF TG_TABLE_NAME='procurement_rfqs' THEN
    IF (NEW.rfq_code,NEW.purchase_request_id,NEW.round_no,NEW.response_deadline,NEW.currency_code,NEW.source_purchase_request_version,NEW.source_digest,NEW.request_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.rfq_code,OLD.purchase_request_id,OLD.round_no,OLD.response_deadline,OLD.currency_code,OLD.source_purchase_request_version,OLD.source_digest,OLD.request_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'issued rfq scope is immutable'; END IF;
    IF NEW.version<>OLD.version+1 OR NOT ((OLD.status='DRAFT' AND NEW.status IN ('ISSUED','CANCELLED')) OR (OLD.status='ISSUED' AND NEW.status IN ('ISSUED','CLOSED','CANCELLED'))) THEN RAISE EXCEPTION 'invalid rfq transition'; END IF;
  ELSIF TG_TABLE_NAME='procurement_rfq_suppliers' THEN
    IF (NEW.rfq_id,NEW.supplier_id,NEW.invited_by,NEW.invited_at,NEW.supplier_mapping_digest) IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.invited_by,OLD.invited_at,OLD.supplier_mapping_digest) OR NOT (OLD.status='INVITED' AND NEW.status IN ('RESPONDED','DECLINED')) THEN RAISE EXCEPTION 'rfq supplier invitation is immutable'; END IF;
  ELSIF TG_TABLE_NAME='procurement_supplier_quotes' THEN
    IF NEW.version<>OLD.version+1 OR (NEW.rfq_id,NEW.supplier_id,NEW.quote_version_no,NEW.supplier_quote_reference,NEW.currency_code,NEW.valid_until,NEW.tax_included,NEW.freight_included,NEW.payment_terms,NEW.quote_digest,NEW.recorded_by,NEW.recorded_at,NEW.request_id) IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.quote_version_no,OLD.supplier_quote_reference,OLD.currency_code,OLD.valid_until,OLD.tax_included,OLD.freight_included,OLD.payment_terms,OLD.quote_digest,OLD.recorded_by,OLD.recorded_at,OLD.request_id) OR NOT (OLD.status='SUBMITTED' AND NEW.status IN ('SUPERSEDED','WITHDRAWN')) THEN RAISE EXCEPTION 'submitted quote is immutable'; END IF;
  ELSIF TG_TABLE_NAME='procurement_sourcing_awards' THEN
    IF NEW.version<>OLD.version+1 OR (NEW.rfq_id,NEW.award_digest,NEW.selected_by,NEW.selected_at,NEW.reason_code,NEW.reason,NEW.request_id) IS DISTINCT FROM (OLD.rfq_id,OLD.award_digest,OLD.selected_by,OLD.selected_at,OLD.reason_code,OLD.reason,OLD.request_id) OR NOT (OLD.status='AWARDED' AND NEW.status='REVERSED') THEN RAISE EXCEPTION 'sourcing award is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_sourcing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'procurement sourcing fact is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER procurement_rfqs_service_guard BEFORE UPDATE OR DELETE ON "procurement_rfqs" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_projection_guard();
CREATE TRIGGER procurement_rfq_suppliers_service_guard BEFORE UPDATE OR DELETE ON "procurement_rfq_suppliers" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_projection_guard();
CREATE TRIGGER procurement_supplier_quotes_service_guard BEFORE UPDATE OR DELETE ON "procurement_supplier_quotes" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_projection_guard();
CREATE TRIGGER procurement_sourcing_awards_service_guard BEFORE UPDATE OR DELETE ON "procurement_sourcing_awards" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_projection_guard();
CREATE TRIGGER procurement_rfq_lines_immutable BEFORE UPDATE OR DELETE ON "procurement_rfq_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_immutable();
CREATE TRIGGER procurement_supplier_quote_lines_immutable BEFORE UPDATE OR DELETE ON "procurement_supplier_quote_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_immutable();
CREATE TRIGGER procurement_quote_comparisons_immutable BEFORE UPDATE OR DELETE ON "procurement_quote_comparisons" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_immutable();
CREATE TRIGGER procurement_quote_comparison_lines_immutable BEFORE UPDATE OR DELETE ON "procurement_quote_comparison_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_immutable();
CREATE TRIGGER procurement_sourcing_award_lines_immutable BEFORE UPDATE OR DELETE ON "procurement_sourcing_award_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_immutable();
CREATE TRIGGER procurement_sourcing_events_immutable BEFORE UPDATE OR DELETE ON "procurement_sourcing_events" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_sourcing_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r procurement_rfqs%ROWTYPE; l procurement_rfq_lines%ROWTYPE; q procurement_supplier_quotes%ROWTYPE; c procurement_quote_comparisons%ROWTYPE; ql procurement_supplier_quote_lines%ROWTYPE;
BEGIN
  IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement sourcing insert requires service transaction'; END IF;
  IF TG_TABLE_NAME='procurement_rfq_lines' THEN
    SELECT * INTO r FROM procurement_rfqs WHERE id=NEW.rfq_id;
    IF r.status<>'DRAFT' OR NOT EXISTS(SELECT 1 FROM planning_purchase_request_lines p WHERE p.id=NEW.purchase_request_line_id AND p.purchase_request_id=r.purchase_request_id AND p.material_id=NEW.material_id AND p.unit_id=NEW.unit_id AND p.requested_quantity=NEW.requested_quantity) THEN RAISE EXCEPTION 'invalid rfq line source'; END IF;
  ELSIF TG_TABLE_NAME='procurement_rfq_suppliers' THEN SELECT * INTO r FROM procurement_rfqs WHERE id=NEW.rfq_id; IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'issued rfq supplier scope is immutable'; END IF;
  ELSIF TG_TABLE_NAME='procurement_supplier_quotes' THEN SELECT * INTO r FROM procurement_rfqs WHERE id=NEW.rfq_id; IF r.status<>'ISSUED' OR NOT EXISTS(SELECT 1 FROM procurement_rfq_suppliers s WHERE s.rfq_id=NEW.rfq_id AND s.supplier_id=NEW.supplier_id) THEN RAISE EXCEPTION 'invalid quote invitation'; END IF;
  ELSIF TG_TABLE_NAME='procurement_supplier_quote_lines' THEN SELECT * INTO q FROM procurement_supplier_quotes WHERE id=NEW.quote_id; SELECT * INTO l FROM procurement_rfq_lines WHERE id=NEW.rfq_line_id; IF q.rfq_id<>l.rfq_id OR NEW.material_id<>l.material_id OR NEW.unit_id<>l.unit_id THEN RAISE EXCEPTION 'invalid quote line source'; END IF;
  ELSIF TG_TABLE_NAME='procurement_quote_comparisons' THEN SELECT * INTO l FROM procurement_rfq_lines WHERE id=NEW.rfq_line_id; IF l.rfq_id<>NEW.rfq_id THEN RAISE EXCEPTION 'invalid comparison rfq line'; END IF;
  ELSIF TG_TABLE_NAME='procurement_quote_comparison_lines' THEN SELECT * INTO c FROM procurement_quote_comparisons WHERE id=NEW.comparison_id; SELECT * INTO ql FROM procurement_supplier_quote_lines WHERE id=NEW.quote_line_id; SELECT * INTO q FROM procurement_supplier_quotes WHERE id=ql.quote_id; IF c.rfq_line_id<>ql.rfq_line_id OR q.supplier_id<>NEW.supplier_id THEN RAISE EXCEPTION 'invalid comparison quote line'; END IF;
  ELSIF TG_TABLE_NAME='procurement_sourcing_award_lines' THEN
    SELECT * INTO c FROM procurement_quote_comparisons WHERE id=NEW.comparison_id; SELECT * INTO ql FROM procurement_supplier_quote_lines WHERE id=NEW.selected_quote_line_id; SELECT * INTO q FROM procurement_supplier_quotes WHERE id=ql.quote_id;
    IF c.rfq_line_id<>NEW.rfq_line_id OR ql.rfq_line_id<>NEW.rfq_line_id OR q.supplier_id<>NEW.supplier_id OR q.status<>'SUBMITTED' OR q.valid_until<CURRENT_DATE OR ql.unit_price<>NEW.selected_unit_price OR NOT EXISTS(SELECT 1 FROM procurement_quote_comparison_lines x WHERE x.comparison_id=c.id AND x.quote_line_id=ql.id AND x.comparable_status='COMPARABLE') OR EXISTS(SELECT 1 FROM procurement_quote_comparisons newer WHERE newer.rfq_line_id=c.rfq_line_id AND newer.comparison_version_no>c.comparison_version_no) THEN RAISE EXCEPTION 'award must reference current quote and latest comparison'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procurement_rfq_lines_integrity BEFORE INSERT ON "procurement_rfq_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_rfqs_insert_guard BEFORE INSERT ON "procurement_rfqs" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_rfq_suppliers_integrity BEFORE INSERT ON "procurement_rfq_suppliers" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_supplier_quotes_integrity BEFORE INSERT ON "procurement_supplier_quotes" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_supplier_quote_lines_integrity BEFORE INSERT ON "procurement_supplier_quote_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_quote_comparisons_integrity BEFORE INSERT ON "procurement_quote_comparisons" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_quote_comparison_lines_integrity BEFORE INSERT ON "procurement_quote_comparison_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_sourcing_awards_insert_guard BEFORE INSERT ON "procurement_sourcing_awards" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_sourcing_award_lines_integrity BEFORE INSERT ON "procurement_sourcing_award_lines" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
CREATE TRIGGER procurement_sourcing_events_insert_guard BEFORE INSERT ON "procurement_sourcing_events" FOR EACH ROW EXECUTE FUNCTION procurement_sourcing_integrity_guard();
