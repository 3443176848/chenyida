CREATE TABLE "production_report_receipt_projections" (
	"report_id" bigint PRIMARY KEY NOT NULL,
	"allocated_good_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_report_receipt_projection_quantity_ck" CHECK ("allocated_good_qty">=0),
	CONSTRAINT "production_report_receipt_projection_version_ck" CHECK ("version">0)
);
--> statement-breakpoint
CREATE TABLE "production_completion_receipt_projections" (
	"completion_id" bigint PRIMARY KEY NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completion_receipt_projection_version_ck" CHECK ("version">0)
);
--> statement-breakpoint
CREATE TABLE "production_completion_report_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"completion_id" bigint NOT NULL,
	"completion_line_id" bigint NOT NULL,
	"report_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completion_report_allocations_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_report_reversals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reversal_code" text NOT NULL,
	"report_id" bigint NOT NULL,
	"work_order_id" bigint NOT NULL,
	"reported_qty" numeric(24, 6) NOT NULL,
	"good_qty" numeric(24, 6) NOT NULL,
	"scrap_qty" numeric(24, 6) NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_report_reversals_quantity_ck" CHECK ("reported_qty">0 and "good_qty">=0 and "scrap_qty">=0 and "good_qty"+"scrap_qty"<="reported_qty")
);
--> statement-breakpoint
CREATE TABLE "production_completion_reversals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reversal_code" text NOT NULL,
	"completion_id" bigint NOT NULL,
	"work_order_id" bigint NOT NULL,
	"inventory_adjustment_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completion_reversals_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_completion_reversal_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"completion_reversal_id" bigint NOT NULL,
	"original_allocation_id" bigint NOT NULL,
	"report_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completion_reversal_allocations_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_report_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_report_events_type_ck" CHECK ("event_type" in ('REPORTED','REVERSED')),
	CONSTRAINT "production_report_events_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
CREATE TABLE "production_completion_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"completion_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_completion_events_type_ck" CHECK ("event_type" in ('RECEIVED','REVERSED')),
	CONSTRAINT "production_completion_events_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
ALTER TABLE "production_report_receipt_projections" ADD CONSTRAINT "production_report_receipt_projections_report_fk" FOREIGN KEY ("report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_receipt_projections" ADD CONSTRAINT "production_completion_receipt_projections_completion_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."production_completions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_report_allocations" ADD CONSTRAINT "production_completion_report_allocations_completion_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."production_completions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_report_allocations" ADD CONSTRAINT "production_completion_report_allocations_line_fk" FOREIGN KEY ("completion_line_id") REFERENCES "public"."production_completion_lines"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_report_allocations" ADD CONSTRAINT "production_completion_report_allocations_report_fk" FOREIGN KEY ("report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_report_allocations" ADD CONSTRAINT "production_completion_report_allocations_actor_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_report_reversals" ADD CONSTRAINT "production_report_reversals_report_fk" FOREIGN KEY ("report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_report_reversals" ADD CONSTRAINT "production_report_reversals_work_order_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_report_reversals" ADD CONSTRAINT "production_report_reversals_actor_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversals" ADD CONSTRAINT "production_completion_reversals_completion_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."production_completions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversals" ADD CONSTRAINT "production_completion_reversals_work_order_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversals" ADD CONSTRAINT "production_completion_reversals_inventory_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversals" ADD CONSTRAINT "production_completion_reversals_actor_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversal_allocations" ADD CONSTRAINT "production_completion_reversal_allocations_reversal_fk" FOREIGN KEY ("completion_reversal_id") REFERENCES "public"."production_completion_reversals"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversal_allocations" ADD CONSTRAINT "production_completion_reversal_allocations_original_fk" FOREIGN KEY ("original_allocation_id") REFERENCES "public"."production_completion_report_allocations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversal_allocations" ADD CONSTRAINT "production_completion_reversal_allocations_report_fk" FOREIGN KEY ("report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_reversal_allocations" ADD CONSTRAINT "production_completion_reversal_allocations_actor_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_report_events" ADD CONSTRAINT "production_report_events_report_fk" FOREIGN KEY ("report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_report_events" ADD CONSTRAINT "production_report_events_actor_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_events" ADD CONSTRAINT "production_completion_events_completion_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."production_completions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "production_completion_events" ADD CONSTRAINT "production_completion_events_actor_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_report_allocations_source_uq" ON "production_completion_report_allocations" ("completion_id","report_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_report_allocations_operation_report_uq" ON "production_completion_report_allocations" ("operation_id","report_id");
--> statement-breakpoint
CREATE INDEX "production_completion_report_allocations_report_idx" ON "production_completion_report_allocations" ("report_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_report_reversals_code_uq" ON "production_report_reversals" ("reversal_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_report_reversals_report_uq" ON "production_report_reversals" ("report_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_report_reversals_operation_uq" ON "production_report_reversals" ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_reversals_code_uq" ON "production_completion_reversals" ("reversal_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_reversals_completion_uq" ON "production_completion_reversals" ("completion_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_reversals_inventory_uq" ON "production_completion_reversals" ("inventory_adjustment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_reversals_operation_uq" ON "production_completion_reversals" ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_completion_reversal_allocations_original_uq" ON "production_completion_reversal_allocations" ("original_allocation_id");
--> statement-breakpoint
CREATE INDEX "production_report_events_report_idx" ON "production_report_events" ("report_id","id");
--> statement-breakpoint
CREATE INDEX "production_completion_events_completion_idx" ON "production_completion_events" ("completion_id","id");
--> statement-breakpoint
INSERT INTO production_report_receipt_projections(report_id)
SELECT id FROM production_reports ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO production_completion_receipt_projections(completion_id)
SELECT id FROM production_completions ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_receipt_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE report_good numeric(24,6);
BEGIN
  IF current_setting('cyd.production_service_write',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production receipt projection requires service transaction' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'production receipt projections cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'production receipt projection version must advance once' USING ERRCODE='23514'; END IF;
  IF OLD.reversed AND NOT NEW.reversed THEN RAISE EXCEPTION 'production receipt reversal cannot be undone' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='production_report_receipt_projections' THEN
    SELECT good_qty INTO report_good FROM production_reports WHERE id=NEW.report_id;
    IF NEW.allocated_good_qty>report_good OR (NEW.reversed AND NEW.allocated_good_qty<>0) THEN
      RAISE EXCEPTION 'production report receipt projection is outside report good quantity' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_report_receipt_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON production_report_receipt_projections FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_projection_guard();
--> statement-breakpoint
CREATE TRIGGER production_completion_receipt_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON production_completion_receipt_projections FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_projection_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_receipt_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE completion_work_order bigint; report_work_order bigint; line_completion bigint;
BEGIN
  IF current_setting('cyd.production_service_write',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production receipt fact requires service transaction' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'production receipt facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='production_completion_report_allocations' THEN
    SELECT work_order_id INTO completion_work_order FROM production_completions WHERE id=NEW.completion_id;
    SELECT work_order_id INTO report_work_order FROM production_reports WHERE id=NEW.report_id;
    SELECT completion_id INTO line_completion FROM production_completion_lines WHERE id=NEW.completion_line_id;
    IF completion_work_order IS NULL OR report_work_order IS DISTINCT FROM completion_work_order OR line_completion IS DISTINCT FROM NEW.completion_id THEN
      RAISE EXCEPTION 'production completion allocation source mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_completion_report_allocations_immutable BEFORE INSERT OR UPDATE OR DELETE ON production_completion_report_allocations FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_fact_guard();
--> statement-breakpoint
CREATE TRIGGER production_report_reversals_immutable BEFORE INSERT OR UPDATE OR DELETE ON production_report_reversals FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_fact_guard();
--> statement-breakpoint
CREATE TRIGGER production_completion_reversals_immutable BEFORE INSERT OR UPDATE OR DELETE ON production_completion_reversals FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_fact_guard();
--> statement-breakpoint
CREATE TRIGGER production_completion_reversal_allocations_immutable BEFORE INSERT OR UPDATE OR DELETE ON production_completion_reversal_allocations FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_fact_guard();
--> statement-breakpoint
CREATE TRIGGER production_report_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON production_report_events FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_fact_guard();
--> statement-breakpoint
CREATE TRIGGER production_completion_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON production_completion_events FOR EACH ROW EXECUTE FUNCTION cyd_production_receipt_fact_guard();
