CREATE TABLE "planning_material_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" bigint NOT NULL,
	"plan_line_id" bigint NOT NULL,
	"allocation_type" text NOT NULL,
	"inventory_balance_id" bigint,
	"purchase_order_line_id" bigint,
	"quantity" numeric(24, 6) NOT NULL,
	"source_version" integer NOT NULL,
	"source_quantity" numeric(24, 6) NOT NULL,
	"source_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_material_allocations_type_ck" CHECK ("planning_material_allocations"."allocation_type" in ('STOCK','INBOUND')),
	CONSTRAINT "planning_material_allocations_source_ck" CHECK (("planning_material_allocations"."allocation_type"='STOCK' and "planning_material_allocations"."inventory_balance_id" is not null and "planning_material_allocations"."purchase_order_line_id" is null) or ("planning_material_allocations"."allocation_type"='INBOUND' and "planning_material_allocations"."inventory_balance_id" is null and "planning_material_allocations"."purchase_order_line_id" is not null)),
	CONSTRAINT "planning_material_allocations_quantity_ck" CHECK ("planning_material_allocations"."quantity">0 and "planning_material_allocations"."source_quantity">=0 and "planning_material_allocations"."source_version">0),
	CONSTRAINT "planning_material_allocations_digest_ck" CHECK ("planning_material_allocations"."source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "planning_material_requirement_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" bigint NOT NULL,
	"purchase_request_id" bigint,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_material_requirement_events_type_ck" CHECK ("planning_material_requirement_events"."event_type" in ('GENERATED','REGENERATED','SUBMITTED','PURCHASE_ACCEPTED','PURCHASE_RETURNED')),
	CONSTRAINT "planning_material_requirement_events_status_ck" CHECK ("planning_material_requirement_events"."to_status" in ('DRAFT','STALE','SUBMITTED','ACCEPTED','RETURNED')),
	CONSTRAINT "planning_material_requirement_events_reason_ck" CHECK (("planning_material_requirement_events"."event_type"='PURCHASE_RETURNED' and char_length(btrim("planning_material_requirement_events"."reason")) between 1 and 1000) or ("planning_material_requirement_events"."event_type"<>'PURCHASE_RETURNED' and char_length("planning_material_requirement_events"."reason")<=1000))
);
--> statement-breakpoint
CREATE TABLE "planning_material_requirement_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"material_snapshot" jsonb NOT NULL,
	"material_digest" text NOT NULL,
	"gross_requirement" numeric(24, 6) NOT NULL,
	"stock_available" numeric(24, 6) NOT NULL,
	"eligible_inbound" numeric(24, 6) NOT NULL,
	"stock_allocated" numeric(24, 6) NOT NULL,
	"inbound_allocated" numeric(24, 6) NOT NULL,
	"net_purchase_requirement" numeric(24, 6) NOT NULL,
	"source_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_material_requirement_lines_quantity_ck" CHECK ("planning_material_requirement_lines"."line_no">0 and "planning_material_requirement_lines"."gross_requirement">0 and "planning_material_requirement_lines"."stock_available">=0 and "planning_material_requirement_lines"."eligible_inbound">=0 and "planning_material_requirement_lines"."stock_allocated">=0 and "planning_material_requirement_lines"."inbound_allocated">=0 and "planning_material_requirement_lines"."net_purchase_requirement">=0 and "planning_material_requirement_lines"."stock_allocated"<="planning_material_requirement_lines"."stock_available" and "planning_material_requirement_lines"."inbound_allocated"<="planning_material_requirement_lines"."eligible_inbound" and "planning_material_requirement_lines"."gross_requirement"="planning_material_requirement_lines"."stock_allocated"+"planning_material_requirement_lines"."inbound_allocated"+"planning_material_requirement_lines"."net_purchase_requirement"),
	CONSTRAINT "planning_material_requirement_lines_digest_ck" CHECK ("planning_material_requirement_lines"."material_digest" ~ '^[0-9a-f]{64}$' and "planning_material_requirement_lines"."source_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "planning_material_requirement_lines_snapshot_ck" CHECK (jsonb_typeof("planning_material_requirement_lines"."material_snapshot")='object' and pg_column_size("planning_material_requirement_lines"."material_snapshot")<=65536)
);
--> statement-breakpoint
CREATE TABLE "planning_material_requirement_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"planning_package_id" bigint NOT NULL,
	"plan_version_no" integer NOT NULL,
	"required_date" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"source_package_version" integer NOT NULL,
	"source_package_digest" text NOT NULL,
	"calculation_digest" text NOT NULL,
	"prepared_by" text NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"returned_by" text,
	"returned_at" timestamp with time zone,
	"return_reason" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"request_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_material_requirement_plans_status_ck" CHECK ("planning_material_requirement_plans"."status" in ('DRAFT','STALE','SUBMITTED','ACCEPTED','RETURNED')),
	CONSTRAINT "planning_material_requirement_plans_version_ck" CHECK ("planning_material_requirement_plans"."plan_version_no">0 and "planning_material_requirement_plans"."source_package_version">0 and "planning_material_requirement_plans"."version">0),
	CONSTRAINT "planning_material_requirement_plans_digest_ck" CHECK ("planning_material_requirement_plans"."source_package_digest" ~ '^[0-9a-f]{64}$' and "planning_material_requirement_plans"."calculation_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "planning_material_requirement_plans_submit_ck" CHECK (("planning_material_requirement_plans"."status" in ('DRAFT','STALE') and "planning_material_requirement_plans"."submitted_by" is null and "planning_material_requirement_plans"."submitted_at" is null) or ("planning_material_requirement_plans"."status" in ('SUBMITTED','ACCEPTED','RETURNED') and "planning_material_requirement_plans"."submitted_by" is not null and "planning_material_requirement_plans"."submitted_at" is not null)),
	CONSTRAINT "planning_material_requirement_plans_accept_ck" CHECK (("planning_material_requirement_plans"."status"='ACCEPTED' and "planning_material_requirement_plans"."accepted_by" is not null and "planning_material_requirement_plans"."accepted_at" is not null and "planning_material_requirement_plans"."returned_by" is null and "planning_material_requirement_plans"."returned_at" is null and "planning_material_requirement_plans"."return_reason"='') or "planning_material_requirement_plans"."status"<>'ACCEPTED'),
	CONSTRAINT "planning_material_requirement_plans_return_ck" CHECK (("planning_material_requirement_plans"."status"='RETURNED' and "planning_material_requirement_plans"."returned_by" is not null and "planning_material_requirement_plans"."returned_at" is not null and char_length(btrim("planning_material_requirement_plans"."return_reason")) between 1 and 1000 and "planning_material_requirement_plans"."accepted_by" is null and "planning_material_requirement_plans"."accepted_at" is null) or "planning_material_requirement_plans"."status"<>'RETURNED')
);
--> statement-breakpoint
CREATE TABLE "planning_purchase_request_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_request_id" bigint NOT NULL,
	"plan_line_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"requested_quantity" numeric(24, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_purchase_request_lines_quantity_ck" CHECK ("planning_purchase_request_lines"."line_no">0 and "planning_purchase_request_lines"."requested_quantity">0)
);
--> statement-breakpoint
CREATE TABLE "planning_purchase_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_code" text NOT NULL,
	"plan_id" bigint NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"returned_by" text,
	"returned_at" timestamp with time zone,
	"return_reason" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"request_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_purchase_requests_code_ck" CHECK ("planning_purchase_requests"."request_code" ~ '^PRQ-[0-9]{8}$'),
	CONSTRAINT "planning_purchase_requests_status_ck" CHECK ("planning_purchase_requests"."status" in ('SUBMITTED','ACCEPTED','RETURNED')),
	CONSTRAINT "planning_purchase_requests_version_ck" CHECK ("planning_purchase_requests"."version">0),
	CONSTRAINT "planning_purchase_requests_accept_ck" CHECK (("planning_purchase_requests"."status"='ACCEPTED' and "planning_purchase_requests"."accepted_by" is not null and "planning_purchase_requests"."accepted_at" is not null and "planning_purchase_requests"."returned_by" is null and "planning_purchase_requests"."returned_at" is null and "planning_purchase_requests"."return_reason"='') or "planning_purchase_requests"."status"<>'ACCEPTED'),
	CONSTRAINT "planning_purchase_requests_return_ck" CHECK (("planning_purchase_requests"."status"='RETURNED' and "planning_purchase_requests"."returned_by" is not null and "planning_purchase_requests"."returned_at" is not null and char_length(btrim("planning_purchase_requests"."return_reason")) between 1 and 1000 and "planning_purchase_requests"."accepted_by" is null and "planning_purchase_requests"."accepted_at" is null) or "planning_purchase_requests"."status"<>'RETURNED')
);
--> statement-breakpoint
ALTER TABLE "planning_material_allocations" ADD CONSTRAINT "planning_material_allocations_plan_id_planning_material_requirement_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planning_material_requirement_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_allocations" ADD CONSTRAINT "planning_material_allocations_plan_line_id_planning_material_requirement_lines_id_fk" FOREIGN KEY ("plan_line_id") REFERENCES "public"."planning_material_requirement_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_allocations" ADD CONSTRAINT "planning_material_allocations_inventory_balance_id_inventory_stock_balances_id_fk" FOREIGN KEY ("inventory_balance_id") REFERENCES "public"."inventory_stock_balances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_allocations" ADD CONSTRAINT "planning_material_allocations_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_events" ADD CONSTRAINT "planning_material_requirement_events_plan_id_planning_material_requirement_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planning_material_requirement_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_events" ADD CONSTRAINT "planning_material_requirement_events_purchase_request_id_planning_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."planning_purchase_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_events" ADD CONSTRAINT "planning_material_requirement_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_lines" ADD CONSTRAINT "planning_material_requirement_lines_plan_id_planning_material_requirement_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planning_material_requirement_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_lines" ADD CONSTRAINT "planning_material_requirement_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_lines" ADD CONSTRAINT "planning_material_requirement_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_plans" ADD CONSTRAINT "planning_material_requirement_plans_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_plans" ADD CONSTRAINT "planning_material_requirement_plans_planning_package_id_project_planning_packages_id_fk" FOREIGN KEY ("planning_package_id") REFERENCES "public"."project_planning_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_plans" ADD CONSTRAINT "planning_material_requirement_plans_prepared_by_app_users_username_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_plans" ADD CONSTRAINT "planning_material_requirement_plans_submitted_by_app_users_username_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_plans" ADD CONSTRAINT "planning_material_requirement_plans_accepted_by_app_users_username_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_material_requirement_plans" ADD CONSTRAINT "planning_material_requirement_plans_returned_by_app_users_username_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_request_lines" ADD CONSTRAINT "planning_purchase_request_lines_purchase_request_id_planning_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."planning_purchase_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_request_lines" ADD CONSTRAINT "planning_purchase_request_lines_plan_line_id_planning_material_requirement_lines_id_fk" FOREIGN KEY ("plan_line_id") REFERENCES "public"."planning_material_requirement_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_request_lines" ADD CONSTRAINT "planning_purchase_request_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_request_lines" ADD CONSTRAINT "planning_purchase_request_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_requests" ADD CONSTRAINT "planning_purchase_requests_plan_id_planning_material_requirement_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planning_material_requirement_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_requests" ADD CONSTRAINT "planning_purchase_requests_submitted_by_app_users_username_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_requests" ADD CONSTRAINT "planning_purchase_requests_accepted_by_app_users_username_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_purchase_requests" ADD CONSTRAINT "planning_purchase_requests_returned_by_app_users_username_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planning_material_allocations_stock_uq" ON "planning_material_allocations" USING btree ("plan_line_id") WHERE "planning_material_allocations"."allocation_type"='STOCK';--> statement-breakpoint
CREATE UNIQUE INDEX "planning_material_allocations_inbound_uq" ON "planning_material_allocations" USING btree ("plan_line_id","purchase_order_line_id") WHERE "planning_material_allocations"."allocation_type"='INBOUND';--> statement-breakpoint
CREATE INDEX "planning_material_allocations_stock_active_idx" ON "planning_material_allocations" USING btree ("inventory_balance_id","plan_id") WHERE "planning_material_allocations"."allocation_type"='STOCK';--> statement-breakpoint
CREATE INDEX "planning_material_allocations_inbound_active_idx" ON "planning_material_allocations" USING btree ("purchase_order_line_id","plan_id") WHERE "planning_material_allocations"."allocation_type"='INBOUND';--> statement-breakpoint
CREATE INDEX "planning_material_requirement_events_plan_idx" ON "planning_material_requirement_events" USING btree ("plan_id","id");--> statement-breakpoint
CREATE INDEX "planning_material_requirement_events_request_idx" ON "planning_material_requirement_events" USING btree ("purchase_request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_material_requirement_lines_plan_line_uq" ON "planning_material_requirement_lines" USING btree ("plan_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_material_requirement_lines_material_unit_uq" ON "planning_material_requirement_lines" USING btree ("plan_id","material_id","unit_id");--> statement-breakpoint
CREATE INDEX "planning_material_requirement_lines_material_idx" ON "planning_material_requirement_lines" USING btree ("material_id","unit_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_material_requirement_plans_project_version_uq" ON "planning_material_requirement_plans" USING btree ("project_id","plan_version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_material_requirement_plans_open_uq" ON "planning_material_requirement_plans" USING btree ("project_id") WHERE "planning_material_requirement_plans"."status" in ('DRAFT','SUBMITTED','ACCEPTED');--> statement-breakpoint
CREATE INDEX "planning_material_requirement_plans_package_idx" ON "planning_material_requirement_plans" USING btree ("planning_package_id","plan_version_no","id");--> statement-breakpoint
CREATE INDEX "planning_material_requirement_plans_queue_idx" ON "planning_material_requirement_plans" USING btree ("status","submitted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_purchase_request_lines_request_line_uq" ON "planning_purchase_request_lines" USING btree ("purchase_request_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_purchase_request_lines_plan_line_uq" ON "planning_purchase_request_lines" USING btree ("plan_line_id");--> statement-breakpoint
CREATE INDEX "planning_purchase_request_lines_material_idx" ON "planning_purchase_request_lines" USING btree ("material_id","unit_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_purchase_requests_code_uq" ON "planning_purchase_requests" USING btree ("request_code");--> statement-breakpoint
CREATE UNIQUE INDEX "planning_purchase_requests_plan_uq" ON "planning_purchase_requests" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "planning_purchase_requests_queue_idx" ON "planning_purchase_requests" USING btree ("status","submitted_at","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_material_requirement_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.material_requirement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'material requirement plan writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'material requirement plans cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.planning_package_id IS DISTINCT FROM OLD.planning_package_id OR NEW.plan_version_no IS DISTINCT FROM OLD.plan_version_no OR NEW.required_date IS DISTINCT FROM OLD.required_date OR NEW.source_package_version IS DISTINCT FROM OLD.source_package_version OR NEW.source_package_digest IS DISTINCT FROM OLD.source_package_digest OR NEW.calculation_digest IS DISTINCT FROM OLD.calculation_digest OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN RAISE EXCEPTION 'stable material requirement plan fields are immutable' USING ERRCODE='55000'; END IF;
    IF OLD.status<>'DRAFT' AND (NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN RAISE EXCEPTION 'submitted material requirement fields are immutable' USING ERRCODE='55000'; END IF;
    IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('STALE','SUBMITTED')) OR (OLD.status='SUBMITTED' AND NEW.status IN ('ACCEPTED','RETURNED'))) THEN RAISE EXCEPTION 'invalid material requirement plan state transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project_planning_packages pp WHERE pp.id=NEW.planning_package_id AND pp.project_id=NEW.project_id AND pp.status='ACCEPTED' AND pp.version=NEW.source_package_version AND pp.package_digest=NEW.source_package_digest) THEN RAISE EXCEPTION 'material requirement plan package source is inconsistent' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_material_requirement_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.material_requirement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'material requirement line writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'material requirement lines are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_material_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.material_requirement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'planning allocation writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'planning allocations are immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM planning_material_requirement_lines l JOIN planning_material_requirement_plans p ON p.id=l.plan_id WHERE l.id=NEW.plan_line_id AND p.id=NEW.plan_id AND p.status='SUBMITTED') THEN RAISE EXCEPTION 'planning allocation must reference submitted plan line' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_purchase_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.material_requirement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'purchase request writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'purchase requests cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM planning_material_requirement_plans p JOIN planning_material_requirement_lines l ON l.plan_id=p.id AND l.net_purchase_requirement>0 WHERE p.id=NEW.plan_id AND p.status='SUBMITTED') THEN RAISE EXCEPTION 'purchase request requires submitted positive net requirement' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.request_code IS DISTINCT FROM OLD.request_code OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN RAISE EXCEPTION 'stable purchase request fields are immutable' USING ERRCODE='55000'; END IF;
    IF NOT (OLD.status='SUBMITTED' AND NEW.status IN ('ACCEPTED','RETURNED')) THEN RAISE EXCEPTION 'invalid purchase request state transition' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_purchase_request_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.material_requirement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'purchase request line writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'purchase request lines are immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM planning_purchase_requests r JOIN planning_material_requirement_lines l ON l.id=NEW.plan_line_id AND l.plan_id=r.plan_id WHERE r.id=NEW.purchase_request_id AND l.material_id=NEW.material_id AND l.unit_id=NEW.unit_id AND l.net_purchase_requirement=NEW.requested_quantity AND l.net_purchase_requirement>0) THEN RAISE EXCEPTION 'purchase request line must equal positive plan net requirement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_material_requirement_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.material_requirement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'material requirement event writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'material requirement events are immutable' USING ERRCODE='55000'; END IF;
  IF NEW.purchase_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM planning_purchase_requests r WHERE r.id=NEW.purchase_request_id AND r.plan_id=NEW.plan_id) THEN RAISE EXCEPTION 'material requirement event request is inconsistent' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_submitted_material_requirement_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='SUBMITTED' THEN
    IF EXISTS (
      SELECT 1 FROM planning_material_requirement_lines l
      WHERE l.plan_id=NEW.id AND (
        coalesce((SELECT sum(a.quantity) FROM planning_material_allocations a WHERE a.plan_line_id=l.id AND a.allocation_type='STOCK'),0)<>l.stock_allocated OR
        coalesce((SELECT sum(a.quantity) FROM planning_material_allocations a WHERE a.plan_line_id=l.id AND a.allocation_type='INBOUND'),0)<>l.inbound_allocated
      )
    ) THEN RAISE EXCEPTION 'submitted plan allocations are incomplete' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM planning_material_requirement_lines l WHERE l.plan_id=NEW.id AND l.net_purchase_requirement>0) IS DISTINCT FROM EXISTS (SELECT 1 FROM planning_purchase_requests r WHERE r.plan_id=NEW.id) THEN
      RAISE EXCEPTION 'submitted plan purchase request presence is inconsistent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_purchase_request_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM planning_material_requirement_lines l
    WHERE l.plan_id=NEW.plan_id AND l.net_purchase_requirement>0
      AND NOT EXISTS (SELECT 1 FROM planning_purchase_request_lines rl WHERE rl.purchase_request_id=NEW.id AND rl.plan_line_id=l.id)
  ) OR NOT EXISTS (SELECT 1 FROM planning_purchase_request_lines rl WHERE rl.purchase_request_id=NEW.id) THEN
    RAISE EXCEPTION 'purchase request lines are incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER planning_material_requirement_plans_service_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_material_requirement_plans FOR EACH ROW EXECUTE FUNCTION cyd_material_requirement_plan_guard();--> statement-breakpoint
CREATE TRIGGER planning_material_requirement_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON planning_material_requirement_lines FOR EACH ROW EXECUTE FUNCTION cyd_material_requirement_line_guard();--> statement-breakpoint
CREATE TRIGGER planning_material_allocations_immutable BEFORE INSERT OR UPDATE OR DELETE ON planning_material_allocations FOR EACH ROW EXECUTE FUNCTION cyd_material_allocation_guard();--> statement-breakpoint
CREATE TRIGGER planning_purchase_requests_service_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_purchase_requests FOR EACH ROW EXECUTE FUNCTION cyd_purchase_request_guard();--> statement-breakpoint
CREATE TRIGGER planning_purchase_request_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON planning_purchase_request_lines FOR EACH ROW EXECUTE FUNCTION cyd_purchase_request_line_guard();--> statement-breakpoint
CREATE TRIGGER planning_material_requirement_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON planning_material_requirement_events FOR EACH ROW EXECUTE FUNCTION cyd_material_requirement_event_guard();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER planning_submitted_plan_complete AFTER UPDATE ON planning_material_requirement_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_submitted_material_requirement_complete_guard();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER planning_purchase_request_complete AFTER INSERT ON planning_purchase_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_purchase_request_complete_guard();
