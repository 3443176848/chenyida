CREATE TABLE "production_operation_run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"report_id" bigint,
	"reversal_id" bigint,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"processed_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"good_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operation_run_events_type_ck" CHECK ("production_operation_run_events"."event_type" in ('DISPATCHED','STARTED','REPORTED','CANCELLED','REVERSED')),
	CONSTRAINT "production_operation_run_events_status_ck" CHECK ("production_operation_run_events"."to_status" in ('READY','IN_PROGRESS','COMPLETED','CANCELLED','REVERSED')),
	CONSTRAINT "production_operation_run_events_quantity_ck" CHECK ("production_operation_run_events"."processed_qty">=0 and "production_operation_run_events"."good_qty">=0 and "production_operation_run_events"."scrap_qty">=0 and "production_operation_run_events"."processed_qty"="production_operation_run_events"."good_qty"+"production_operation_run_events"."scrap_qty")
);
--> statement-breakpoint
CREATE TABLE "production_operation_run_input_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"source_run_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operation_run_input_allocations_quantity_ck" CHECK ("production_operation_run_input_allocations"."quantity">0 and "production_operation_run_input_allocations"."run_id"<>"production_operation_run_input_allocations"."source_run_id")
);
--> statement-breakpoint
CREATE TABLE "production_operation_run_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_code" text NOT NULL,
	"run_id" bigint NOT NULL,
	"snapshot_operation_id" bigint NOT NULL,
	"processed_qty" numeric(24, 6) NOT NULL,
	"good_qty" numeric(24, 6) NOT NULL,
	"scrap_qty" numeric(24, 6) NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"operation_id" uuid NOT NULL,
	"reported_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operation_run_reports_quantity_ck" CHECK ("production_operation_run_reports"."processed_qty">0 and "production_operation_run_reports"."good_qty">=0 and "production_operation_run_reports"."scrap_qty">=0 and "production_operation_run_reports"."processed_qty"="production_operation_run_reports"."good_qty"+"production_operation_run_reports"."scrap_qty")
);
--> statement-breakpoint
CREATE TABLE "production_operation_run_reversals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reversal_code" text NOT NULL,
	"run_id" bigint NOT NULL,
	"processed_qty" numeric(24, 6) NOT NULL,
	"good_qty" numeric(24, 6) NOT NULL,
	"scrap_qty" numeric(24, 6) NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"reversed_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"reversed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operation_run_reversals_quantity_ck" CHECK ("production_operation_run_reversals"."processed_qty">0 and "production_operation_run_reversals"."good_qty">=0 and "production_operation_run_reversals"."scrap_qty">=0 and "production_operation_run_reversals"."processed_qty"="production_operation_run_reversals"."good_qty"+"production_operation_run_reversals"."scrap_qty" and char_length(btrim("production_operation_run_reversals"."reason")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "production_operation_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_code" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"snapshot_operation_id" bigint NOT NULL,
	"work_center_id" bigint NOT NULL,
	"work_center_code" text NOT NULL,
	"work_center_name" text NOT NULL,
	"assigned_operator" text NOT NULL,
	"dispatched_qty" numeric(24, 6) NOT NULL,
	"processed_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"good_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"source_digest" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" text,
	"started_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operation_runs_status_ck" CHECK ("production_operation_runs"."status" in ('READY','IN_PROGRESS','COMPLETED','CANCELLED','REVERSED')),
	CONSTRAINT "production_operation_runs_quantity_ck" CHECK ("production_operation_runs"."dispatched_qty">0 and "production_operation_runs"."processed_qty">=0 and "production_operation_runs"."good_qty">=0 and "production_operation_runs"."scrap_qty">=0 and "production_operation_runs"."processed_qty"="production_operation_runs"."good_qty"+"production_operation_runs"."scrap_qty" and "production_operation_runs"."processed_qty"<="production_operation_runs"."dispatched_qty"),
	CONSTRAINT "production_operation_runs_digest_ck" CHECK ("production_operation_runs"."source_digest" ~ '^[0-9a-f]{64}$' and "production_operation_runs"."version">0),
	CONSTRAINT "production_operation_runs_time_ck" CHECK ("production_operation_runs"."planned_start" is null or "production_operation_runs"."planned_end" is null or "production_operation_runs"."planned_end">="production_operation_runs"."planned_start"),
	CONSTRAINT "production_operation_runs_lifecycle_ck" CHECK (("production_operation_runs"."status"='READY' and "production_operation_runs"."started_at" is null and "production_operation_runs"."cancelled_at" is null) or ("production_operation_runs"."status" in ('IN_PROGRESS','COMPLETED','REVERSED') and "production_operation_runs"."started_at" is not null and "production_operation_runs"."started_by" is not null) or ("production_operation_runs"."status"='CANCELLED' and "production_operation_runs"."started_at" is null and "production_operation_runs"."cancelled_at" is not null and "production_operation_runs"."cancelled_by" is not null and char_length(btrim("production_operation_runs"."cancellation_reason")) between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "production_operation_wip_projections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operation_projection_id" bigint NOT NULL,
	"snapshot_operation_id" bigint NOT NULL,
	"source_input_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"waiting_input_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"dispatched_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"in_progress_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"completed_good_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"transferred_to_next_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"available_for_next_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"final_output_available_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_operation_wip_projections_quantity_ck" CHECK ("production_operation_wip_projections"."source_input_qty">=0 and "production_operation_wip_projections"."waiting_input_qty">=0 and "production_operation_wip_projections"."dispatched_qty">=0 and "production_operation_wip_projections"."in_progress_qty">=0 and "production_operation_wip_projections"."completed_good_qty">=0 and "production_operation_wip_projections"."scrap_qty">=0 and "production_operation_wip_projections"."transferred_to_next_qty">=0 and "production_operation_wip_projections"."available_for_next_qty">=0 and "production_operation_wip_projections"."final_output_available_qty">=0 and "production_operation_wip_projections"."version">0),
	CONSTRAINT "production_operation_wip_projections_balance_ck" CHECK ("production_operation_wip_projections"."waiting_input_qty"+"production_operation_wip_projections"."dispatched_qty"="production_operation_wip_projections"."source_input_qty" and "production_operation_wip_projections"."transferred_to_next_qty"<="production_operation_wip_projections"."completed_good_qty" and "production_operation_wip_projections"."available_for_next_qty"="production_operation_wip_projections"."completed_good_qty"-"production_operation_wip_projections"."transferred_to_next_qty")
);
--> statement-breakpoint
CREATE TABLE "production_work_order_operation_projections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"snapshot_operation_id" bigint NOT NULL,
	"previous_snapshot_operation_id" bigint,
	"next_snapshot_operation_id" bigint,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"target_qty" numeric(24, 6) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_work_order_operation_projections_status_ck" CHECK ("production_work_order_operation_projections"."status" in ('WAITING','READY','IN_PROGRESS','COMPLETED','CANCELLED')),
	CONSTRAINT "production_work_order_operation_projections_quantity_ck" CHECK ("production_work_order_operation_projections"."target_qty">0 and "production_work_order_operation_projections"."version">0)
);
--> statement-breakpoint
ALTER TABLE "production_operation_run_events" ADD CONSTRAINT "production_operation_run_events_run_id_production_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_events" ADD CONSTRAINT "production_operation_run_events_report_id_production_operation_run_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."production_operation_run_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_events" ADD CONSTRAINT "production_operation_run_events_reversal_id_production_operation_run_reversals_id_fk" FOREIGN KEY ("reversal_id") REFERENCES "public"."production_operation_run_reversals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_events" ADD CONSTRAINT "production_operation_run_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_input_allocations" ADD CONSTRAINT "production_operation_run_input_allocations_run_id_production_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_input_allocations" ADD CONSTRAINT "production_operation_run_input_allocations_source_run_id_production_operation_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_input_allocations" ADD CONSTRAINT "production_operation_run_input_allocations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_reports" ADD CONSTRAINT "production_operation_run_reports_run_id_production_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_reports" ADD CONSTRAINT "production_operation_run_reports_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_reports" ADD CONSTRAINT "production_operation_run_reports_reported_by_app_users_username_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_reversals" ADD CONSTRAINT "production_operation_run_reversals_run_id_production_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_run_reversals" ADD CONSTRAINT "production_operation_run_reversals_reversed_by_app_users_username_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_work_center_id_production_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."production_work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_assigned_operator_app_users_username_fk" FOREIGN KEY ("assigned_operator") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_started_by_app_users_username_fk" FOREIGN KEY ("started_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_cancelled_by_app_users_username_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD CONSTRAINT "production_operation_wip_projections_operation_projection_id_production_work_order_operation_projections_id_fk" FOREIGN KEY ("operation_projection_id") REFERENCES "public"."production_work_order_operation_projections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD CONSTRAINT "production_operation_wip_projections_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_operation_projections" ADD CONSTRAINT "production_work_order_operation_projections_work_order_id_production_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."production_work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_operation_projections" ADD CONSTRAINT "production_work_order_operation_projections_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_operation_projections" ADD CONSTRAINT "production_work_order_operation_projections_previous_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("previous_snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_work_order_operation_projections" ADD CONSTRAINT "production_work_order_operation_projections_next_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("next_snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_operation_run_events_run_idx" ON "production_operation_run_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_input_allocations_source_uq" ON "production_operation_run_input_allocations" USING btree ("run_id","source_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_input_allocations_operation_uq" ON "production_operation_run_input_allocations" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "production_operation_run_input_allocations_source_idx" ON "production_operation_run_input_allocations" USING btree ("source_run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_reports_code_uq" ON "production_operation_run_reports" USING btree ("report_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_reports_operation_uq" ON "production_operation_run_reports" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "production_operation_run_reports_run_idx" ON "production_operation_run_reports" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_reversals_code_uq" ON "production_operation_run_reversals" USING btree ("reversal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_reversals_run_uq" ON "production_operation_run_reversals" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_run_reversals_operation_uq" ON "production_operation_run_reversals" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_runs_code_uq" ON "production_operation_runs" USING btree ("run_code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_runs_operation_uq" ON "production_operation_runs" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "production_operation_runs_operation_idx" ON "production_operation_runs" USING btree ("snapshot_operation_id","status","id");--> statement-breakpoint
CREATE INDEX "production_operation_runs_work_order_idx" ON "production_operation_runs" USING btree ("work_order_id","status","id");--> statement-breakpoint
CREATE INDEX "production_operation_runs_operator_idx" ON "production_operation_runs" USING btree ("assigned_operator","status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_wip_projections_operation_uq" ON "production_operation_wip_projections" USING btree ("operation_projection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_operation_wip_projections_snapshot_uq" ON "production_operation_wip_projections" USING btree ("snapshot_operation_id");--> statement-breakpoint
CREATE INDEX "production_operation_wip_projections_waiting_idx" ON "production_operation_wip_projections" USING btree ("waiting_input_qty","snapshot_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_order_operation_projections_snapshot_uq" ON "production_work_order_operation_projections" USING btree ("snapshot_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_work_order_operation_projections_wo_snapshot_uq" ON "production_work_order_operation_projections" USING btree ("work_order_id","snapshot_operation_id");--> statement-breakpoint
CREATE INDEX "production_work_order_operation_projections_queue_idx" ON "production_work_order_operation_projections" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE INDEX "production_work_order_operation_projections_work_order_idx" ON "production_work_order_operation_projections" USING btree ("work_order_id","id");--> statement-breakpoint
INSERT INTO production_work_order_operation_projections(work_order_id,snapshot_operation_id,previous_snapshot_operation_id,next_snapshot_operation_id,status,target_qty)
SELECT s.work_order_id,op.id,
  lag(op.id) over(partition by s.work_order_id order by op.sequence_no,op.id),
  lead(op.id) over(partition by s.work_order_id order by op.sequence_no,op.id),
  CASE WHEN wo.status='CANCELLED' THEN 'CANCELLED' ELSE 'WAITING' END,
  wo.planned_qty
FROM production_work_order_routing_snapshot_operations op
JOIN production_work_order_routing_snapshots s ON s.id=op.snapshot_id
JOIN production_work_orders wo ON wo.id=s.work_order_id
ON CONFLICT(snapshot_operation_id) DO NOTHING;--> statement-breakpoint
INSERT INTO production_operation_wip_projections(operation_projection_id,snapshot_operation_id)
SELECT id,snapshot_operation_id FROM production_work_order_operation_projections
ON CONFLICT(snapshot_operation_id) DO NOTHING;--> statement-breakpoint
WITH first_ops AS (
  SELECT p.id,p.work_order_id,p.snapshot_operation_id,wo.planned_qty,
    least(wo.planned_qty,coalesce(min(round(r.net_issued_qty*wo.planned_qty/nullif(r.required_qty,0),6)),0)) source_qty
  FROM production_work_order_operation_projections p
  JOIN production_work_orders wo ON wo.id=p.work_order_id
  LEFT JOIN production_material_requirements r ON r.work_order_id=wo.id
  WHERE p.previous_snapshot_operation_id IS NULL
  GROUP BY p.id,wo.id
)
UPDATE production_operation_wip_projections w SET source_input_qty=f.source_qty,waiting_input_qty=f.source_qty
FROM first_ops f WHERE w.operation_projection_id=f.id;--> statement-breakpoint
UPDATE production_work_order_operation_projections p SET status='READY'
FROM production_operation_wip_projections w
WHERE w.operation_projection_id=p.id AND p.status<>'CANCELLED' AND w.waiting_input_qty>0;--> statement-breakpoint

CREATE FUNCTION cyd_production_operation_service_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;--> statement-breakpoint

CREATE FUNCTION cyd_production_operation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op record; operator_ok boolean; available numeric;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'operation runs are append-preserved' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_immutable_ck'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT s.work_order_id,o.work_center_id,o.work_center_code,o.work_center_name,wo.status
      INTO op FROM production_work_order_routing_snapshot_operations o
      JOIN production_work_order_routing_snapshots s ON s.id=o.snapshot_id
      JOIN production_work_orders wo ON wo.id=s.work_order_id WHERE o.id=NEW.snapshot_operation_id;
    IF op.work_order_id IS NULL OR op.work_order_id<>NEW.work_order_id OR op.work_center_id<>NEW.work_center_id OR op.work_center_code<>NEW.work_center_code OR op.work_center_name<>NEW.work_center_name THEN
      RAISE EXCEPTION 'run does not match work-order snapshot operation' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_snapshot_ck';
    END IF;
    IF op.status NOT IN ('RELEASED','IN_PROGRESS') THEN RAISE EXCEPTION 'work order is not executable' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_work_order_state_ck'; END IF;
    SELECT is_active AND role IN ('production','manager','admin') INTO operator_ok FROM app_users WHERE username=NEW.assigned_operator;
    IF coalesce(operator_ok,false)=false THEN RAISE EXCEPTION 'assigned operator is not eligible' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_operator_ck'; END IF;
    SELECT waiting_input_qty INTO available FROM production_operation_wip_projections WHERE snapshot_operation_id=NEW.snapshot_operation_id FOR UPDATE;
    IF available IS NULL OR NEW.dispatched_qty>available THEN RAISE EXCEPTION 'dispatch exceeds available input' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_available_ck'; END IF;
  ELSE
    IF ROW(NEW.run_code,NEW.work_order_id,NEW.snapshot_operation_id,NEW.work_center_id,NEW.work_center_code,NEW.work_center_name,NEW.assigned_operator,NEW.dispatched_qty,NEW.planned_start,NEW.planned_end,NEW.source_digest,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.run_code,OLD.work_order_id,OLD.snapshot_operation_id,OLD.work_center_id,OLD.work_center_code,OLD.work_center_name,OLD.assigned_operator,OLD.dispatched_qty,OLD.planned_start,OLD.planned_end,OLD.source_digest,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at)
       OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'operation run immutable fields changed' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_immutable_ck'; END IF;
    IF NOT ((OLD.status='READY' AND NEW.status IN ('IN_PROGRESS','CANCELLED')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('IN_PROGRESS','COMPLETED','REVERSED')) OR (OLD.status='COMPLETED' AND NEW.status='REVERSED')) THEN
      RAISE EXCEPTION 'invalid operation run transition' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_transition_ck';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER production_operation_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_runs FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_run_guard();--> statement-breakpoint

CREATE FUNCTION cyd_production_operation_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record; source record; consumed numeric;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'operation input allocation is immutable' USING ERRCODE='23514',CONSTRAINT='production_operation_allocations_immutable_ck'; END IF;
  SELECT r.*,p.previous_snapshot_operation_id INTO target FROM production_operation_runs r JOIN production_work_order_operation_projections p ON p.snapshot_operation_id=r.snapshot_operation_id WHERE r.id=NEW.run_id;
  SELECT * INTO source FROM production_operation_runs WHERE id=NEW.source_run_id FOR UPDATE;
  IF target.id IS NULL OR source.id IS NULL OR target.previous_snapshot_operation_id IS DISTINCT FROM source.snapshot_operation_id OR target.work_order_id<>source.work_order_id OR target.status IN ('CANCELLED','REVERSED') OR source.status IN ('CANCELLED','REVERSED') THEN
    RAISE EXCEPTION 'invalid linear upstream allocation' USING ERRCODE='23514',CONSTRAINT='production_operation_allocations_lineage_ck';
  END IF;
  SELECT coalesce(sum(a.quantity),0) INTO consumed FROM production_operation_run_input_allocations a JOIN production_operation_runs r ON r.id=a.run_id WHERE a.source_run_id=NEW.source_run_id AND r.status NOT IN ('CANCELLED','REVERSED');
  IF consumed+NEW.quantity>source.good_qty THEN RAISE EXCEPTION 'upstream good quantity over-consumed' USING ERRCODE='23514',CONSTRAINT='production_operation_allocations_quantity_gate_ck'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER production_operation_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_run_input_allocations FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_allocation_guard();--> statement-breakpoint

CREATE FUNCTION cyd_production_operation_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run record; totals record;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'operation report is immutable' USING ERRCODE='23514',CONSTRAINT='production_operation_reports_immutable_ck'; END IF;
  SELECT * INTO run FROM production_operation_runs WHERE id=NEW.run_id FOR UPDATE;
  IF run.id IS NULL OR run.status<>'IN_PROGRESS' OR run.snapshot_operation_id<>NEW.snapshot_operation_id THEN RAISE EXCEPTION 'run is not reportable' USING ERRCODE='23514',CONSTRAINT='production_operation_reports_run_ck'; END IF;
  SELECT coalesce(sum(processed_qty),0) processed INTO totals FROM production_operation_run_reports WHERE run_id=NEW.run_id;
  IF totals.processed+NEW.processed_qty>run.dispatched_qty THEN RAISE EXCEPTION 'report exceeds dispatched quantity' USING ERRCODE='23514',CONSTRAINT='production_operation_reports_quantity_gate_ck'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER production_operation_reports_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_run_reports FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_report_guard();--> statement-breakpoint

CREATE FUNCTION cyd_production_operation_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run record;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'operation reversal is immutable' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_immutable_ck'; END IF;
  SELECT r.*,p.next_snapshot_operation_id INTO run FROM production_operation_runs r JOIN production_work_order_operation_projections p ON p.snapshot_operation_id=r.snapshot_operation_id WHERE r.id=NEW.run_id FOR UPDATE;
  IF run.id IS NULL OR run.status NOT IN ('IN_PROGRESS','COMPLETED') OR run.processed_qty<=0 OR ROW(NEW.processed_qty,NEW.good_qty,NEW.scrap_qty) IS DISTINCT FROM ROW(run.processed_qty,run.good_qty,run.scrap_qty) THEN RAISE EXCEPTION 'run is not reversable' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_run_ck'; END IF;
  IF EXISTS(SELECT 1 FROM production_operation_run_input_allocations a JOIN production_operation_runs t ON t.id=a.run_id WHERE a.source_run_id=NEW.run_id AND t.status NOT IN ('CANCELLED','REVERSED')) THEN RAISE EXCEPTION 'run output has downstream consumption' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_downstream_ck'; END IF;
  IF run.next_snapshot_operation_id IS NULL AND EXISTS(SELECT 1 FROM production_reports r LEFT JOIN production_report_reversals x ON x.report_id=r.id WHERE r.work_order_id=run.work_order_id AND x.id IS NULL) THEN RAISE EXCEPTION 'final output has production report consumption' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_downstream_ck'; END IF;
  IF EXISTS(SELECT 1 FROM quality_inspections q JOIN production_reports r ON r.id=q.production_report_id WHERE r.work_order_id=run.work_order_id) THEN RAISE EXCEPTION 'quality downstream exists' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_downstream_ck'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER production_operation_reversals_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_run_reversals FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_reversal_guard();--> statement-breakpoint

CREATE TRIGGER production_operation_events_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_run_events FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_service_guard();--> statement-breakpoint
CREATE TRIGGER production_operation_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON production_work_order_operation_projections FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_service_guard();--> statement-breakpoint
CREATE TRIGGER production_operation_wip_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_wip_projections FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_service_guard();--> statement-breakpoint

CREATE FUNCTION cyd_validate_production_operation_projection(target_snapshot_operation_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE expected record; actual record; invalid_run boolean; invalid_reports boolean; invalid_events boolean;
BEGIN
  SELECT p.*,wo.status work_order_status,wo.planned_qty INTO actual FROM production_work_order_operation_projections p JOIN production_work_orders wo ON wo.id=p.work_order_id WHERE p.snapshot_operation_id=target_snapshot_operation_id;
  IF actual.id IS NULL THEN RETURN; END IF;
  WITH source AS (
    SELECT CASE WHEN actual.previous_snapshot_operation_id IS NULL THEN
      (SELECT least(wo.planned_qty,coalesce(min(round(r.net_issued_qty*wo.planned_qty/nullif(r.required_qty,0),6)),0)) FROM production_work_orders wo LEFT JOIN production_material_requirements r ON r.work_order_id=wo.id WHERE wo.id=actual.work_order_id GROUP BY wo.id)
      ELSE (SELECT coalesce(sum(good_qty),0) FROM production_operation_runs WHERE snapshot_operation_id=actual.previous_snapshot_operation_id AND status NOT IN ('CANCELLED','REVERSED')) END qty
  ), facts AS (
    SELECT coalesce(sum(dispatched_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) dispatched,
      coalesce(sum(processed_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) processed,
      coalesce(sum(good_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) good,
      coalesce(sum(scrap_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) scrap,
      coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0) in_progress,
      coalesce(bool_or(status='READY'),false) has_ready,coalesce(bool_or(status='IN_PROGRESS'),false) has_active
    FROM production_operation_runs WHERE snapshot_operation_id=target_snapshot_operation_id
  ), transfer AS (
    SELECT coalesce(sum(a.quantity),0) qty FROM production_operation_run_input_allocations a JOIN production_operation_runs s ON s.id=a.source_run_id JOIN production_operation_runs t ON t.id=a.run_id WHERE s.snapshot_operation_id=target_snapshot_operation_id AND s.status NOT IN ('CANCELLED','REVERSED') AND t.status NOT IN ('CANCELLED','REVERSED')
  ) SELECT source.qty source_qty,(source.qty-facts.dispatched) waiting,facts.dispatched,facts.processed,facts.good,facts.scrap,facts.in_progress,transfer.qty transferred,(facts.good-transfer.qty) available,
    CASE WHEN actual.next_snapshot_operation_id IS NULL THEN facts.good-transfer.qty ELSE 0 END final_output,
    CASE WHEN actual.work_order_status='CANCELLED' THEN 'CANCELLED' WHEN facts.processed>=actual.target_qty THEN 'COMPLETED' WHEN facts.has_active THEN 'IN_PROGRESS' WHEN source.qty-facts.dispatched>0 OR facts.has_ready THEN 'READY' ELSE 'WAITING' END status
  INTO expected FROM source,facts,transfer;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND r.status NOT IN ('CANCELLED','REVERSED') AND ((actual.previous_snapshot_operation_id IS NULL AND EXISTS(SELECT 1 FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)) OR (actual.previous_snapshot_operation_id IS NOT NULL AND (SELECT coalesce(sum(a.quantity),0) FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)<>r.dispatched_qty))) INTO invalid_run;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND ROW(r.processed_qty,r.good_qty,r.scrap_qty) IS DISTINCT FROM (SELECT ROW(coalesce(sum(x.processed_qty),0),coalesce(sum(x.good_qty),0),coalesce(sum(x.scrap_qty),0)) FROM production_operation_run_reports x WHERE x.run_id=r.id)) INTO invalid_reports;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND (NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='DISPATCHED') OR (r.started_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='STARTED')) OR (r.status='REVERSED' AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='REVERSED')))) INTO invalid_events;
  IF expected.waiting<0 OR expected.available<0 OR invalid_run OR invalid_reports OR invalid_events OR actual.status<>expected.status OR NOT EXISTS(
    SELECT 1 FROM production_operation_wip_projections w WHERE w.operation_projection_id=actual.id AND w.snapshot_operation_id=target_snapshot_operation_id AND ROW(w.source_input_qty,w.waiting_input_qty,w.dispatched_qty,w.in_progress_qty,w.completed_good_qty,w.scrap_qty,w.transferred_to_next_qty,w.available_for_next_qty,w.final_output_available_qty)=ROW(expected.source_qty,expected.waiting,expected.dispatched,expected.in_progress,expected.good,expected.scrap,expected.transferred,expected.available,expected.final_output)
  ) THEN RAISE EXCEPTION 'operation projection does not reconcile with immutable facts' USING ERRCODE='23514',CONSTRAINT='production_operation_projection_reconciliation_ck'; END IF;
END $$;--> statement-breakpoint

CREATE FUNCTION cyd_production_operation_deferred_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_id bigint; source_snapshot_id bigint;
BEGIN
  IF TG_TABLE_NAME='production_work_order_operation_projections' THEN snapshot_id=coalesce(NEW.snapshot_operation_id,OLD.snapshot_operation_id);
  ELSIF TG_TABLE_NAME='production_operation_wip_projections' THEN snapshot_id=coalesce(NEW.snapshot_operation_id,OLD.snapshot_operation_id);
  ELSIF TG_TABLE_NAME='production_material_requirements' THEN SELECT p.snapshot_operation_id INTO snapshot_id FROM production_work_order_operation_projections p WHERE p.work_order_id=coalesce(NEW.work_order_id,OLD.work_order_id) AND p.previous_snapshot_operation_id IS NULL;
  ELSIF TG_TABLE_NAME='production_operation_runs' THEN snapshot_id=coalesce(NEW.snapshot_operation_id,OLD.snapshot_operation_id);
  ELSE SELECT snapshot_operation_id INTO snapshot_id FROM production_operation_runs WHERE id=coalesce(NEW.run_id,OLD.run_id); END IF;
  IF snapshot_id IS NOT NULL THEN PERFORM cyd_validate_production_operation_projection(snapshot_id); END IF;
  IF TG_TABLE_NAME='production_operation_run_input_allocations' THEN SELECT snapshot_operation_id INTO source_snapshot_id FROM production_operation_runs WHERE id=coalesce(NEW.source_run_id,OLD.source_run_id); IF source_snapshot_id IS NOT NULL THEN PERFORM cyd_validate_production_operation_projection(source_snapshot_id); END IF; END IF;
  RETURN coalesce(NEW,OLD);
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_runs_reconcile AFTER INSERT OR UPDATE ON production_operation_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_allocations_reconcile AFTER INSERT ON production_operation_run_input_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_reports_reconcile AFTER INSERT ON production_operation_run_reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_reversals_reconcile AFTER INSERT ON production_operation_run_reversals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_events_reconcile AFTER INSERT ON production_operation_run_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_projection_reconcile AFTER INSERT OR UPDATE ON production_work_order_operation_projections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_wip_reconcile AFTER INSERT OR UPDATE ON production_operation_wip_projections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_issue_reconcile AFTER UPDATE OF net_issued_qty ON production_material_requirements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_operation_deferred_validate();
