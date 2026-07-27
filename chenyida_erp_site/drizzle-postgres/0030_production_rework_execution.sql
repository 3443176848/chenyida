CREATE TABLE "production_rework_execution_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_projection_id" bigint NOT NULL,
	"rework_request_id" bigint NOT NULL,
	"run_id" bigint,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"quantity" numeric(24, 6) DEFAULT '0' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_rework_execution_events_type_ck" CHECK ("production_rework_execution_events"."event_type" in ('ACCEPTED','DISPATCHED','STARTED','REPORTED','CANCELLED','REVERSED','REINSPECTION_CREATED','REINSPECTION_RELEASED','COMPLETED','COMPLETED_WITH_SCRAP')),
	CONSTRAINT "production_rework_execution_events_status_ck" CHECK (("production_rework_execution_events"."from_status" is null or "production_rework_execution_events"."from_status" in ('ACCEPTED','IN_PROGRESS','WAITING_REINSPECTION','COMPLETED','COMPLETED_WITH_SCRAP')) and "production_rework_execution_events"."to_status" in ('ACCEPTED','IN_PROGRESS','WAITING_REINSPECTION','COMPLETED','COMPLETED_WITH_SCRAP') and "production_rework_execution_events"."quantity">=0)
);
--> statement-breakpoint
CREATE TABLE "production_rework_execution_projections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rework_request_id" bigint NOT NULL,
	"nonconformance_id" bigint NOT NULL,
	"accepted_rework_qty" numeric(24, 6) NOT NULL,
	"rework_waiting_dispatch_qty" numeric(24, 6) NOT NULL,
	"rework_dispatched_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"rework_in_progress_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"rework_reported_good_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"rework_reported_scrap_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"rework_pending_reinspection_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"rework_released_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"rework_completed_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"unresolved_rework_qty" numeric(24, 6) NOT NULL,
	"status" text DEFAULT 'ACCEPTED' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_rework_execution_projections_status_ck" CHECK ("production_rework_execution_projections"."status" in ('ACCEPTED','IN_PROGRESS','WAITING_REINSPECTION','COMPLETED','COMPLETED_WITH_SCRAP')),
	CONSTRAINT "production_rework_execution_projections_quantity_ck" CHECK ("production_rework_execution_projections"."accepted_rework_qty">0 and "production_rework_execution_projections"."rework_waiting_dispatch_qty">=0 and "production_rework_execution_projections"."rework_dispatched_qty">=0 and "production_rework_execution_projections"."rework_in_progress_qty">=0 and "production_rework_execution_projections"."rework_reported_good_qty">=0 and "production_rework_execution_projections"."rework_reported_scrap_qty">=0 and "production_rework_execution_projections"."rework_pending_reinspection_qty">=0 and "production_rework_execution_projections"."rework_released_qty">=0 and "production_rework_execution_projections"."rework_completed_qty">=0 and "production_rework_execution_projections"."unresolved_rework_qty">=0 and "production_rework_execution_projections"."version">0),
	CONSTRAINT "production_rework_execution_projections_balance_ck" CHECK ("production_rework_execution_projections"."accepted_rework_qty"="production_rework_execution_projections"."rework_waiting_dispatch_qty"+"production_rework_execution_projections"."rework_dispatched_qty"+"production_rework_execution_projections"."rework_in_progress_qty"+"production_rework_execution_projections"."rework_pending_reinspection_qty"+"production_rework_execution_projections"."rework_released_qty"+"production_rework_execution_projections"."rework_reported_scrap_qty" and "production_rework_execution_projections"."rework_reported_good_qty"="production_rework_execution_projections"."rework_pending_reinspection_qty"+"production_rework_execution_projections"."rework_released_qty" and "production_rework_execution_projections"."rework_completed_qty"="production_rework_execution_projections"."rework_released_qty"+"production_rework_execution_projections"."rework_reported_scrap_qty" and "production_rework_execution_projections"."unresolved_rework_qty"="production_rework_execution_projections"."rework_waiting_dispatch_qty"+"production_rework_execution_projections"."rework_dispatched_qty"+"production_rework_execution_projections"."rework_in_progress_qty"+"production_rework_execution_projections"."rework_pending_reinspection_qty")
);
--> statement-breakpoint
CREATE TABLE "production_rework_run_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rework_request_id" bigint NOT NULL,
	"rework_request_version_id" bigint NOT NULL,
	"nonconformance_id" bigint NOT NULL,
	"run_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"released_by" text,
	"released_request_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_rework_run_allocations_quantity_ck" CHECK ("production_rework_run_allocations"."quantity">0),
	CONSTRAINT "production_rework_run_allocations_status_ck" CHECK (("production_rework_run_allocations"."status"='ACTIVE' and "production_rework_run_allocations"."released_by" is null and "production_rework_run_allocations"."released_request_id" is null and "production_rework_run_allocations"."released_at" is null) or ("production_rework_run_allocations"."status"='RELEASED' and "production_rework_run_allocations"."released_by" is not null and "production_rework_run_allocations"."released_request_id" is not null and "production_rework_run_allocations"."released_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD COLUMN "run_kind" text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD COLUMN "rework_request_id" bigint;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD COLUMN "nonconformance_id" bigint;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD COLUMN "source_inspection_id" bigint;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD COLUMN "source_operation_run_report_id" bigint;--> statement-breakpoint
ALTER TABLE "production_rework_execution_events" ADD CONSTRAINT "production_rework_execution_events_execution_projection_id_production_rework_execution_projections_id_fk" FOREIGN KEY ("execution_projection_id") REFERENCES "public"."production_rework_execution_projections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_execution_events" ADD CONSTRAINT "production_rework_execution_events_rework_request_id_production_rework_requests_id_fk" FOREIGN KEY ("rework_request_id") REFERENCES "public"."production_rework_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_execution_events" ADD CONSTRAINT "production_rework_execution_events_run_id_production_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_execution_events" ADD CONSTRAINT "production_rework_execution_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_execution_projections" ADD CONSTRAINT "production_rework_execution_projections_rework_request_id_production_rework_requests_id_fk" FOREIGN KEY ("rework_request_id") REFERENCES "public"."production_rework_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_execution_projections" ADD CONSTRAINT "production_rework_execution_projections_nonconformance_id_production_nonconformances_id_fk" FOREIGN KEY ("nonconformance_id") REFERENCES "public"."production_nonconformances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_run_allocations" ADD CONSTRAINT "production_rework_run_allocations_rework_request_id_production_rework_requests_id_fk" FOREIGN KEY ("rework_request_id") REFERENCES "public"."production_rework_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_run_allocations" ADD CONSTRAINT "production_rework_run_allocations_rework_request_version_id_production_rework_request_versions_id_fk" FOREIGN KEY ("rework_request_version_id") REFERENCES "public"."production_rework_request_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_run_allocations" ADD CONSTRAINT "production_rework_run_allocations_nonconformance_id_production_nonconformances_id_fk" FOREIGN KEY ("nonconformance_id") REFERENCES "public"."production_nonconformances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_run_allocations" ADD CONSTRAINT "production_rework_run_allocations_run_id_production_operation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_operation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_run_allocations" ADD CONSTRAINT "production_rework_run_allocations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_rework_run_allocations" ADD CONSTRAINT "production_rework_run_allocations_released_by_app_users_username_fk" FOREIGN KEY ("released_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_rework_execution_events_request_idx" ON "production_rework_execution_events" USING btree ("rework_request_id","id");--> statement-breakpoint
CREATE INDEX "production_rework_execution_events_run_idx" ON "production_rework_execution_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_rework_execution_projections_request_uq" ON "production_rework_execution_projections" USING btree ("rework_request_id");--> statement-breakpoint
CREATE INDEX "production_rework_execution_projections_queue_idx" ON "production_rework_execution_projections" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE INDEX "production_rework_execution_projections_ncr_idx" ON "production_rework_execution_projections" USING btree ("nonconformance_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_rework_run_allocations_run_uq" ON "production_rework_run_allocations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_rework_run_allocations_operation_uq" ON "production_rework_run_allocations" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "production_rework_run_allocations_request_idx" ON "production_rework_run_allocations" USING btree ("rework_request_id","status","id");--> statement-breakpoint
CREATE INDEX "production_rework_run_allocations_ncr_idx" ON "production_rework_run_allocations" USING btree ("nonconformance_id","status","id");--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_rework_request_id_production_rework_requests_id_fk" FOREIGN KEY ("rework_request_id") REFERENCES "public"."production_rework_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_nonconformance_id_production_nonconformances_id_fk" FOREIGN KEY ("nonconformance_id") REFERENCES "public"."production_nonconformances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_source_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("source_inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_source_operation_run_report_id_production_operation_run_reports_id_fk" FOREIGN KEY ("source_operation_run_report_id") REFERENCES "public"."production_operation_run_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_operation_runs_rework_idx" ON "production_operation_runs" USING btree ("rework_request_id","status","id");--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD CONSTRAINT "production_operation_runs_kind_ck" CHECK ("production_operation_runs"."run_kind" in ('NORMAL','REWORK') and (("production_operation_runs"."run_kind"='NORMAL' and "production_operation_runs"."rework_request_id" is null and "production_operation_runs"."nonconformance_id" is null and "production_operation_runs"."source_inspection_id" is null and "production_operation_runs"."source_operation_run_report_id" is null) or ("production_operation_runs"."run_kind"='REWORK' and "production_operation_runs"."rework_request_id" is not null and "production_operation_runs"."nonconformance_id" is not null and "production_operation_runs"."source_inspection_id" is not null and "production_operation_runs"."source_operation_run_report_id" is not null)));
--> statement-breakpoint
ALTER TABLE "production_nonconformances" DROP CONSTRAINT "production_nonconformances_status_ck";
--> statement-breakpoint
ALTER TABLE "production_nonconformances" ADD CONSTRAINT "production_nonconformances_status_ck" CHECK ("status" in ('OPEN','REWORK_PENDING','REWORK_ACCEPTED','DISPOSED','RESOLVED','CANCELLED'));
--> statement-breakpoint
ALTER TABLE "production_nonconformance_events" DROP CONSTRAINT "production_nonconformance_events_type_ck";
--> statement-breakpoint
ALTER TABLE "production_nonconformance_events" DROP CONSTRAINT "production_nonconformance_events_status_ck";
--> statement-breakpoint
ALTER TABLE "production_nonconformance_events" ADD CONSTRAINT "production_nonconformance_events_type_ck" CHECK ("event_type" in ('CREATED','REWORK_RESERVED','REWORK_UPDATED','REWORK_SUBMITTED','REWORK_RETURNED','REWORK_ACCEPTED','REWORK_CANCELLED','REWORK_EXECUTION_STARTED','REWORK_RESOLVED','SCRAP_DISPOSED','CANCELLED'));
--> statement-breakpoint
ALTER TABLE "production_nonconformance_events" ADD CONSTRAINT "production_nonconformance_events_status_ck" CHECK (("from_status" is null or "from_status" in ('OPEN','REWORK_PENDING','REWORK_ACCEPTED','DISPOSED','RESOLVED','CANCELLED')) and "to_status" in ('OPEN','REWORK_PENDING','REWORK_ACCEPTED','DISPOSED','RESOLVED','CANCELLED') and "quantity">=0);
--> statement-breakpoint

INSERT INTO production_rework_execution_projections(rework_request_id,nonconformance_id,accepted_rework_qty,rework_waiting_dispatch_qty,unresolved_rework_qty,status)
SELECT r.id,r.nonconformance_id,r.quantity,r.quantity,r.quantity,'ACCEPTED'
FROM production_rework_requests r
WHERE r.status='ACCEPTED'
ON CONFLICT(rework_request_id) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_production_operation_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op record; operator_ok boolean; available numeric; rework record; allocated numeric;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'operation runs are append-preserved' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_immutable_ck'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT s.work_order_id,o.work_center_id,o.work_center_code,o.work_center_name,wo.status INTO op
      FROM production_work_order_routing_snapshot_operations o JOIN production_work_order_routing_snapshots s ON s.id=o.snapshot_id JOIN production_work_orders wo ON wo.id=s.work_order_id
      WHERE o.id=NEW.snapshot_operation_id FOR SHARE OF o,s,wo;
    IF op.work_order_id IS NULL OR op.work_order_id<>NEW.work_order_id OR op.work_center_id<>NEW.work_center_id OR op.work_center_code<>NEW.work_center_code OR op.work_center_name<>NEW.work_center_name THEN RAISE EXCEPTION 'run does not match work-order snapshot operation' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_snapshot_ck'; END IF;
    IF op.status NOT IN ('RELEASED','IN_PROGRESS') THEN RAISE EXCEPTION 'work order is not executable' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_work_order_state_ck'; END IF;
    SELECT is_active AND role IN ('production','manager','admin') INTO operator_ok FROM app_users WHERE username=NEW.assigned_operator FOR SHARE;
    IF coalesce(operator_ok,false)=false THEN RAISE EXCEPTION 'assigned operator is not eligible' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_operator_ck'; END IF;
    IF NEW.run_kind='NORMAL' THEN
      SELECT waiting_input_qty INTO available FROM production_operation_wip_projections WHERE snapshot_operation_id=NEW.snapshot_operation_id FOR UPDATE;
      IF available IS NULL OR NEW.dispatched_qty>available THEN RAISE EXCEPTION 'dispatch exceeds available input' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_available_ck'; END IF;
    ELSE
      SELECT r.*,v.id request_version_id,n.inspection_id,n.production_operation_run_report_id source_report_id,n.work_order_id ncr_work_order_id,n.status ncr_status,a.status ncr_allocation_status
        INTO rework FROM production_rework_requests r
        JOIN production_rework_request_versions v ON v.rework_request_id=r.id AND v.canonical_digest=r.canonical_digest AND v.target_snapshot_operation_id=r.target_snapshot_operation_id AND v.quantity=r.quantity
        JOIN production_nonconformances n ON n.id=r.nonconformance_id
        JOIN production_nonconformance_allocations a ON a.rework_request_id=r.id AND a.nonconformance_id=n.id AND a.allocation_type='REWORK'
        WHERE r.id=NEW.rework_request_id FOR UPDATE OF r,n,a;
      IF rework.id IS NULL OR rework.status<>'ACCEPTED' OR rework.ncr_allocation_status<>'ACTIVE' OR rework.ncr_status IN ('CANCELLED','RESOLVED') OR rework.target_snapshot_operation_id IS DISTINCT FROM NEW.snapshot_operation_id OR rework.ncr_work_order_id IS DISTINCT FROM NEW.work_order_id OR rework.nonconformance_id IS DISTINCT FROM NEW.nonconformance_id OR rework.inspection_id IS DISTINCT FROM NEW.source_inspection_id OR rework.source_report_id IS DISTINCT FROM NEW.source_operation_run_report_id THEN RAISE EXCEPTION 'invalid accepted rework source' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_rework_source_ck'; END IF;
      SELECT coalesce(sum(quantity) filter(where status='ACTIVE'),0) INTO allocated FROM production_rework_run_allocations WHERE rework_request_id=NEW.rework_request_id;
      IF allocated+NEW.dispatched_qty>rework.quantity THEN RAISE EXCEPTION 'rework dispatch exceeds accepted quantity' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_rework_capacity_ck'; END IF;
    END IF;
  ELSE
    IF ROW(NEW.run_code,NEW.run_kind,NEW.work_order_id,NEW.snapshot_operation_id,NEW.work_center_id,NEW.work_center_code,NEW.work_center_name,NEW.rework_request_id,NEW.nonconformance_id,NEW.source_inspection_id,NEW.source_operation_run_report_id,NEW.assigned_operator,NEW.dispatched_qty,NEW.planned_start,NEW.planned_end,NEW.source_digest,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.run_code,OLD.run_kind,OLD.work_order_id,OLD.snapshot_operation_id,OLD.work_center_id,OLD.work_center_code,OLD.work_center_name,OLD.rework_request_id,OLD.nonconformance_id,OLD.source_inspection_id,OLD.source_operation_run_report_id,OLD.assigned_operator,OLD.dispatched_qty,OLD.planned_start,OLD.planned_end,OLD.source_digest,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at)
       OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'operation run immutable fields changed' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_immutable_ck'; END IF;
    IF NOT ((OLD.status='READY' AND NEW.status IN ('IN_PROGRESS','CANCELLED')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('IN_PROGRESS','COMPLETED','REVERSED')) OR (OLD.status='COMPLETED' AND NEW.status='REVERSED')) THEN RAISE EXCEPTION 'invalid operation run transition' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_transition_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_rework_execution_service_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.rework_execution_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'rework execution writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'rework execution facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='production_rework_execution_events' THEN
    IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'rework execution events are immutable' USING ERRCODE='55000'; END IF;
  ELSIF TG_TABLE_NAME='production_rework_execution_projections' THEN
    IF TG_OP='UPDATE' AND ROW(NEW.rework_request_id,NEW.nonconformance_id,NEW.accepted_rework_qty,NEW.id) IS DISTINCT FROM ROW(OLD.rework_request_id,OLD.nonconformance_id,OLD.accepted_rework_qty,OLD.id) THEN RAISE EXCEPTION 'rework execution identity is immutable' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER production_rework_execution_projections_guard BEFORE INSERT OR UPDATE OR DELETE ON production_rework_execution_projections FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_service_guard();
--> statement-breakpoint
CREATE TRIGGER production_rework_execution_events_guard BEFORE INSERT OR UPDATE OR DELETE ON production_rework_execution_events FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_service_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_rework_run_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run record; request record; used numeric;
BEGIN
  IF current_setting('cyd.rework_execution_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'rework allocation writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'rework run allocations are immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO run FROM production_operation_runs WHERE id=NEW.run_id FOR UPDATE;
  SELECT r.*,v.id request_version_id INTO request FROM production_rework_requests r JOIN production_rework_request_versions v ON v.rework_request_id=r.id WHERE r.id=NEW.rework_request_id FOR UPDATE OF r;
  IF TG_OP='INSERT' THEN
    IF run.id IS NULL OR run.run_kind<>'REWORK' OR run.rework_request_id IS DISTINCT FROM NEW.rework_request_id OR run.nonconformance_id IS DISTINCT FROM NEW.nonconformance_id OR run.dispatched_qty IS DISTINCT FROM NEW.quantity OR request.id IS NULL OR request.status<>'ACCEPTED' OR request.nonconformance_id IS DISTINCT FROM NEW.nonconformance_id OR request.request_version_id IS DISTINCT FROM NEW.rework_request_version_id OR NEW.status<>'ACTIVE' THEN RAISE EXCEPTION 'invalid rework run allocation lineage' USING ERRCODE='23514',CONSTRAINT='production_rework_run_allocations_lineage_ck'; END IF;
    SELECT coalesce(sum(quantity) filter(where status='ACTIVE'),0) INTO used FROM production_rework_run_allocations WHERE rework_request_id=NEW.rework_request_id;
    IF used+NEW.quantity>request.quantity THEN RAISE EXCEPTION 'accepted rework quantity over-allocated' USING ERRCODE='23514',CONSTRAINT='production_rework_run_allocations_capacity_ck'; END IF;
  ELSE
    IF OLD.status<>'ACTIVE' OR NEW.status<>'RELEASED' OR run.status NOT IN ('CANCELLED','REVERSED') OR ROW(NEW.rework_request_id,NEW.rework_request_version_id,NEW.nonconformance_id,NEW.run_id,NEW.quantity,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.rework_request_id,OLD.rework_request_version_id,OLD.nonconformance_id,OLD.run_id,OLD.quantity,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at) THEN RAISE EXCEPTION 'invalid rework allocation release' USING ERRCODE='23514',CONSTRAINT='production_rework_run_allocations_release_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_rework_run_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON production_rework_run_allocations FOR EACH ROW EXECUTE FUNCTION cyd_rework_run_allocation_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_validate_production_operation_projection(target_snapshot_operation_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE expected record; actual record; invalid_run boolean; invalid_reports boolean; invalid_events boolean;
BEGIN
  SELECT p.*,wo.status work_order_status,wo.planned_qty,op.quality_gate_mode INTO actual FROM production_work_order_operation_projections p JOIN production_work_orders wo ON wo.id=p.work_order_id JOIN production_work_order_routing_snapshot_operations op ON op.id=p.snapshot_operation_id WHERE p.snapshot_operation_id=target_snapshot_operation_id;
  IF actual.id IS NULL THEN RETURN; END IF;
  WITH source AS (
    SELECT CASE WHEN actual.previous_snapshot_operation_id IS NULL THEN
      (SELECT least(wo.planned_qty,coalesce(min(round(r.net_issued_qty*wo.planned_qty/nullif(r.required_qty,0),6)),0)) FROM production_work_orders wo LEFT JOIN production_material_requirements r ON r.work_order_id=wo.id WHERE wo.id=actual.work_order_id GROUP BY wo.id)
      WHEN (SELECT quality_gate_mode FROM production_work_order_routing_snapshot_operations WHERE id=actual.previous_snapshot_operation_id)='IPQC' THEN
      (SELECT coalesce(sum(q.released_qty),0) FROM quality_inspections q JOIN production_operation_run_reports rr ON rr.id=q.production_operation_run_report_id JOIN production_operation_runs run ON run.id=rr.run_id WHERE run.snapshot_operation_id=actual.previous_snapshot_operation_id AND run.status NOT IN ('CANCELLED','REVERSED') AND q.lifecycle_status='CLOSED' AND q.decision_status='RELEASED')
      ELSE (SELECT coalesce(sum(good_qty),0) FROM production_operation_runs WHERE snapshot_operation_id=actual.previous_snapshot_operation_id AND status NOT IN ('CANCELLED','REVERSED')) END qty
  ), facts AS (
    SELECT coalesce(sum(dispatched_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) dispatched,coalesce(sum(processed_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) processed,coalesce(sum(good_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) good,coalesce(sum(scrap_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) scrap,coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0) in_progress,coalesce(bool_or(status='READY'),false) has_ready,coalesce(bool_or(status='IN_PROGRESS'),false) has_active FROM production_operation_runs WHERE snapshot_operation_id=target_snapshot_operation_id AND run_kind='NORMAL'
  ), all_good AS (
    SELECT coalesce(sum(good_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) good FROM production_operation_runs WHERE snapshot_operation_id=target_snapshot_operation_id
  ), quality AS (
    SELECT coalesce(sum(q.inspected_qty),0) inspected,coalesce(sum(q.released_qty) filter(where q.lifecycle_status='CLOSED' and q.decision_status='RELEASED'),0) released FROM quality_inspections q JOIN production_operation_run_reports rr ON rr.id=q.production_operation_run_report_id JOIN production_operation_runs run ON run.id=rr.run_id WHERE run.snapshot_operation_id=target_snapshot_operation_id AND run.status NOT IN ('CANCELLED','REVERSED')
  ), transfer AS (
    SELECT coalesce(sum(a.quantity),0) qty FROM production_operation_run_input_allocations a JOIN production_operation_runs s ON s.id=a.source_run_id JOIN production_operation_runs t ON t.id=a.run_id WHERE s.snapshot_operation_id=target_snapshot_operation_id AND s.status NOT IN ('CANCELLED','REVERSED') AND t.status NOT IN ('CANCELLED','REVERSED')
  ), final_report AS (
    SELECT coalesce(sum(a.quantity),0) qty FROM production_report_operation_allocations a JOIN production_report_receipt_projections p ON p.report_id=a.production_report_id WHERE a.snapshot_operation_id=target_snapshot_operation_id AND NOT p.reversed
  ) SELECT source.qty source_qty,(source.qty-facts.dispatched) waiting,facts.dispatched,facts.processed,facts.good,facts.scrap,facts.in_progress,transfer.qty transferred,
    CASE WHEN actual.quality_gate_mode='IPQC' THEN all_good.good ELSE 0 END quality_required,CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.inspected ELSE 0 END quality_inspected,CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.released ELSE 0 END quality_released,CASE WHEN actual.quality_gate_mode='IPQC' THEN all_good.good-quality.released ELSE 0 END quality_hold,
    (CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.released ELSE all_good.good END-transfer.qty) available,
    CASE WHEN actual.next_snapshot_operation_id IS NULL THEN CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.released ELSE all_good.good END-transfer.qty-final_report.qty ELSE 0 END final_output,
    CASE WHEN actual.work_order_status='CANCELLED' THEN 'CANCELLED' WHEN facts.processed>=actual.target_qty THEN 'COMPLETED' WHEN facts.has_active THEN 'IN_PROGRESS' WHEN source.qty-facts.dispatched>0 OR facts.has_ready THEN 'READY' ELSE 'WAITING' END status
  INTO expected FROM source,facts,all_good,quality,transfer,final_report;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND r.status NOT IN ('CANCELLED','REVERSED') AND ((r.run_kind='NORMAL' AND ((actual.previous_snapshot_operation_id IS NULL AND EXISTS(SELECT 1 FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)) OR (actual.previous_snapshot_operation_id IS NOT NULL AND (SELECT coalesce(sum(a.quantity),0) FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)<>r.dispatched_qty))) OR (r.run_kind='REWORK' AND EXISTS(SELECT 1 FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)))) INTO invalid_run;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND ROW(r.processed_qty,r.good_qty,r.scrap_qty) IS DISTINCT FROM (SELECT ROW(coalesce(sum(x.processed_qty),0),coalesce(sum(x.good_qty),0),coalesce(sum(x.scrap_qty),0)) FROM production_operation_run_reports x WHERE x.run_id=r.id)) INTO invalid_reports;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND (NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='DISPATCHED') OR (r.started_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='STARTED')) OR (r.status='REVERSED' AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='REVERSED')))) INTO invalid_events;
  IF expected.waiting<0 OR expected.available<0 OR expected.final_output<0 OR expected.quality_hold<0 OR expected.quality_released>expected.quality_inspected OR invalid_run OR invalid_reports OR invalid_events OR actual.status<>expected.status OR NOT EXISTS(
    SELECT 1 FROM production_operation_wip_projections w WHERE w.operation_projection_id=actual.id AND w.snapshot_operation_id=target_snapshot_operation_id AND ROW(w.source_input_qty,w.waiting_input_qty,w.dispatched_qty,w.in_progress_qty,w.completed_good_qty,w.scrap_qty,w.transferred_to_next_qty,w.available_for_next_qty,w.final_output_available_qty,w.quality_required_qty,w.quality_inspected_qty,w.quality_released_qty,w.quality_hold_qty)=ROW(expected.source_qty,expected.waiting,expected.dispatched,expected.in_progress,expected.good,expected.scrap,expected.transferred,expected.available,expected.final_output,expected.quality_required,expected.quality_inspected,expected.quality_released,expected.quality_hold)
  ) THEN RAISE EXCEPTION 'operation quality projection does not reconcile with immutable facts' USING ERRCODE='23514',CONSTRAINT='production_operation_projection_reconciliation_ck'; END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_rework_execution_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_request_id bigint; request record; projection record; expected record; invalid boolean;
BEGIN
  IF TG_TABLE_NAME='production_rework_execution_projections' THEN target_request_id:=coalesce(NEW.rework_request_id,OLD.rework_request_id);
  ELSIF TG_TABLE_NAME='production_rework_run_allocations' THEN target_request_id:=coalesce(NEW.rework_request_id,OLD.rework_request_id);
  ELSIF TG_TABLE_NAME='production_operation_runs' THEN target_request_id:=coalesce(NEW.rework_request_id,OLD.rework_request_id);
  ELSIF TG_TABLE_NAME='production_operation_run_reports' THEN SELECT rework_request_id INTO target_request_id FROM production_operation_runs WHERE id=coalesce(NEW.run_id,OLD.run_id);
  ELSIF TG_TABLE_NAME='quality_inspections' THEN SELECT run.rework_request_id INTO target_request_id FROM production_operation_run_reports rr JOIN production_operation_runs run ON run.id=rr.run_id WHERE rr.id=coalesce(NEW.production_operation_run_report_id,OLD.production_operation_run_report_id);
  ELSE target_request_id:=coalesce(NEW.rework_request_id,OLD.rework_request_id); END IF;
  IF target_request_id IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
  SELECT * INTO request FROM production_rework_requests WHERE id=target_request_id;
  SELECT * INTO projection FROM production_rework_execution_projections WHERE rework_request_id=target_request_id;
  WITH active AS (
    SELECT run.* FROM production_rework_run_allocations a JOIN production_operation_runs run ON run.id=a.run_id WHERE a.rework_request_id=target_request_id AND a.status='ACTIVE' AND run.status NOT IN ('CANCELLED','REVERSED')
  ), facts AS (
    SELECT coalesce(sum(dispatched_qty) filter(where status='READY'),0) dispatched,coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0) in_progress,coalesce(sum(good_qty),0) good,coalesce(sum(scrap_qty),0) scrap FROM active
  ), released AS (
    SELECT coalesce(sum(q.released_qty) filter(where q.lifecycle_status='CLOSED' and q.decision_status='RELEASED'),0) qty FROM quality_inspections q JOIN production_operation_run_reports rr ON rr.id=q.production_operation_run_report_id JOIN active run ON run.id=rr.run_id
  ), allocated AS (
    SELECT coalesce(sum(quantity) filter(where status='ACTIVE'),0) qty FROM production_rework_run_allocations WHERE rework_request_id=target_request_id
  ) SELECT (request.quantity-allocated.qty) waiting,facts.dispatched,facts.in_progress,facts.good,facts.scrap,(facts.good-released.qty) pending,released.qty released,(released.qty+facts.scrap) completed,(request.quantity-released.qty-facts.scrap) unresolved,
    CASE WHEN released.qty+facts.scrap=request.quantity THEN CASE WHEN facts.scrap>0 THEN 'COMPLETED_WITH_SCRAP' ELSE 'COMPLETED' END WHEN facts.good-released.qty>0 AND request.quantity-allocated.qty=0 AND facts.dispatched=0 AND facts.in_progress=0 THEN 'WAITING_REINSPECTION' WHEN allocated.qty>0 THEN 'IN_PROGRESS' ELSE 'ACCEPTED' END status
    INTO expected FROM facts,released,allocated;
  SELECT EXISTS(SELECT 1 FROM production_rework_run_allocations a JOIN production_operation_runs r ON r.id=a.run_id WHERE a.rework_request_id=target_request_id AND (a.nonconformance_id IS DISTINCT FROM request.nonconformance_id OR a.quantity IS DISTINCT FROM r.dispatched_qty OR r.run_kind<>'REWORK' OR r.rework_request_id IS DISTINCT FROM request.id OR r.snapshot_operation_id IS DISTINCT FROM request.target_snapshot_operation_id OR (a.status='ACTIVE' AND r.status IN ('CANCELLED','REVERSED')) OR (a.status='RELEASED' AND r.status NOT IN ('CANCELLED','REVERSED')))) INTO invalid;
  IF request.status<>'ACCEPTED' OR projection.id IS NULL OR projection.nonconformance_id IS DISTINCT FROM request.nonconformance_id OR projection.accepted_rework_qty IS DISTINCT FROM request.quantity OR expected.waiting<0 OR expected.pending<0 OR expected.unresolved<0 OR expected.released>expected.good OR invalid OR ROW(projection.rework_waiting_dispatch_qty,projection.rework_dispatched_qty,projection.rework_in_progress_qty,projection.rework_reported_good_qty,projection.rework_reported_scrap_qty,projection.rework_pending_reinspection_qty,projection.rework_released_qty,projection.rework_completed_qty,projection.unresolved_rework_qty,projection.status) IS DISTINCT FROM ROW(expected.waiting,expected.dispatched,expected.in_progress,expected.good,expected.scrap,expected.pending,expected.released,expected.completed,expected.unresolved,expected.status) THEN RAISE EXCEPTION 'rework execution does not reconcile with immutable facts' USING ERRCODE='23514',CONSTRAINT='production_rework_execution_reconciliation_ck'; END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_rework_execution_projection_reconcile AFTER INSERT OR UPDATE ON production_rework_execution_projections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_rework_run_allocation_reconcile AFTER INSERT OR UPDATE ON production_rework_run_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_rework_operation_run_reconcile AFTER INSERT OR UPDATE ON production_operation_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_rework_operation_report_reconcile AFTER INSERT ON production_operation_run_reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_rework_quality_reconcile AFTER INSERT OR UPDATE ON quality_inspections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_rework_execution_consistency_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_nonconformance_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint; ncr record; active_qty numeric(24,6); scrap_qty numeric(24,6); active_requests bigint; pending_requests bigint; accepted_requests bigint; completed_requests bigint; invalid_allocations bigint; invalid_scraps bigint; invalid_versions bigint;
BEGIN
  IF TG_TABLE_NAME='production_nonconformances' THEN target_id:=coalesce(NEW.id,OLD.id); ELSE target_id:=coalesce(NEW.nonconformance_id,OLD.nonconformance_id); END IF;
  SELECT * INTO ncr FROM production_nonconformances WHERE id=target_id; IF ncr.id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum(quantity) filter(where allocation_type='REWORK' and status='ACTIVE'),0),coalesce(sum(quantity) filter(where allocation_type='SCRAP' and status='FINAL'),0) INTO active_qty,scrap_qty FROM production_nonconformance_allocations WHERE nonconformance_id=target_id;
  SELECT count(*) filter(where status in ('DRAFT','SUBMITTED','ACCEPTED')),count(*) filter(where status='SUBMITTED'),count(*) filter(where status='ACCEPTED') INTO active_requests,pending_requests,accepted_requests FROM production_rework_requests WHERE nonconformance_id=target_id;
  SELECT count(*) INTO completed_requests FROM production_rework_execution_projections WHERE nonconformance_id=target_id AND status IN ('COMPLETED','COMPLETED_WITH_SCRAP');
  SELECT count(*) INTO invalid_allocations FROM production_nonconformance_allocations a JOIN production_rework_requests r ON r.id=a.rework_request_id WHERE a.nonconformance_id=target_id AND ((r.status in ('DRAFT','SUBMITTED','ACCEPTED') and a.status<>'ACTIVE') or (r.status in ('RETURNED','CANCELLED') and a.status<>'RELEASED'));
  SELECT count(*) INTO invalid_scraps FROM production_scrap_dispositions d LEFT JOIN production_nonconformance_allocations a ON a.scrap_disposition_id=d.id AND a.allocation_type='SCRAP' AND a.status='FINAL' AND a.nonconformance_id=d.nonconformance_id AND a.quantity=d.quantity WHERE d.nonconformance_id=target_id AND a.id IS NULL;
  SELECT count(*) INTO invalid_versions FROM production_rework_requests r LEFT JOIN production_rework_request_versions v ON v.rework_request_id=r.id WHERE r.nonconformance_id=target_id AND ((r.status in ('SUBMITTED','ACCEPTED','RETURNED') AND (v.id IS NULL OR v.canonical_digest IS DISTINCT FROM r.canonical_digest OR v.quantity IS DISTINCT FROM r.quantity OR v.target_snapshot_operation_id IS DISTINCT FROM r.target_snapshot_operation_id)) OR (r.status='DRAFT' AND v.id IS NOT NULL));
  IF ncr.active_rework_qty<>active_qty OR ncr.final_scrap_qty<>scrap_qty OR ncr.unresolved_qty<>ncr.failed_qty-active_qty-scrap_qty OR ncr.unresolved_qty<0 OR invalid_allocations>0 OR invalid_scraps>0 OR invalid_versions>0 THEN RAISE EXCEPTION 'NCR quantity projection mismatch' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_conservation_ck'; END IF;
  IF ncr.status='CANCELLED' AND (active_qty<>0 OR scrap_qty<>0 OR active_requests<>0) THEN RAISE EXCEPTION 'cancelled NCR has active disposition' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_status_projection_ck'; END IF;
  IF ncr.status<>'CANCELLED' AND ((pending_requests>0 AND ncr.status<>'REWORK_PENDING') OR (pending_requests=0 AND accepted_requests>0 AND completed_requests=accepted_requests AND ncr.status<>'RESOLVED') OR (pending_requests=0 AND accepted_requests>0 AND completed_requests<accepted_requests AND ncr.status<>'REWORK_ACCEPTED') OR (pending_requests=0 AND accepted_requests=0 AND ncr.unresolved_qty=0 AND ncr.status<>'DISPOSED') OR (pending_requests=0 AND accepted_requests=0 AND ncr.unresolved_qty>0 AND ncr.status<>'OPEN')) THEN RAISE EXCEPTION 'NCR status projection mismatch' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_status_projection_ck'; END IF;
  RETURN NULL;
END $$;
