CREATE TABLE "production_report_operation_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"production_report_id" bigint NOT NULL,
	"operation_run_report_id" bigint NOT NULL,
	"snapshot_operation_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_report_operation_allocations_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
ALTER TABLE "production_report_operation_allocations" ADD CONSTRAINT "production_report_operation_allocations_production_report_id_production_reports_id_fk" FOREIGN KEY ("production_report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_report_operation_allocations" ADD CONSTRAINT "production_report_operation_allocations_operation_run_report_id_production_operation_run_reports_id_fk" FOREIGN KEY ("operation_run_report_id") REFERENCES "public"."production_operation_run_reports"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_report_operation_allocations" ADD CONSTRAINT "production_report_operation_allocations_snapshot_operation_id_production_work_order_routing_snapshot_operations_id_fk" FOREIGN KEY ("snapshot_operation_id") REFERENCES "public"."production_work_order_routing_snapshot_operations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_report_operation_allocations" ADD CONSTRAINT "production_report_operation_allocations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "production_report_operation_allocations_source_uq" ON "production_report_operation_allocations" ("production_report_id","operation_run_report_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_report_operation_allocations_operation_uq" ON "production_report_operation_allocations" ("operation_id");
--> statement-breakpoint
CREATE INDEX "production_report_operation_allocations_run_report_idx" ON "production_report_operation_allocations" ("operation_run_report_id","id");
--> statement-breakpoint
CREATE INDEX "production_report_operation_allocations_snapshot_idx" ON "production_report_operation_allocations" ("snapshot_operation_id","id");
--> statement-breakpoint

CREATE FUNCTION cyd_production_final_output_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record; source record; last_operation_id bigint; consumed numeric(24,6);
BEGIN
  IF current_setting('cyd.production_service_write',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'production final output allocation requires service transaction' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'production final output allocations are immutable' USING ERRCODE='23514',CONSTRAINT='production_report_operation_allocations_immutable_ck';
  END IF;
  SELECT r.work_order_id,p.reversed INTO target
  FROM production_reports r JOIN production_report_receipt_projections p ON p.report_id=r.id
  WHERE r.id=NEW.production_report_id FOR UPDATE OF r,p;
  SELECT rr.id,rr.good_qty,rr.snapshot_operation_id,run.work_order_id,run.status
    INTO source FROM production_operation_run_reports rr
    JOIN production_operation_runs run ON run.id=rr.run_id
    WHERE rr.id=NEW.operation_run_report_id FOR UPDATE OF rr,run;
  SELECT p.snapshot_operation_id INTO last_operation_id
  FROM production_work_order_operation_projections p
  WHERE p.work_order_id=target.work_order_id AND p.next_snapshot_operation_id IS NULL;
  IF target.work_order_id IS NULL OR target.reversed OR source.id IS NULL OR source.status IN ('CANCELLED','REVERSED')
     OR source.good_qty<=0 OR source.work_order_id IS DISTINCT FROM target.work_order_id
     OR source.snapshot_operation_id IS DISTINCT FROM last_operation_id
     OR NEW.snapshot_operation_id IS DISTINCT FROM last_operation_id THEN
    RAISE EXCEPTION 'invalid final output allocation lineage' USING ERRCODE='23514',CONSTRAINT='production_report_operation_allocations_lineage_ck';
  END IF;
  SELECT coalesce(sum(a.quantity),0) INTO consumed
  FROM production_report_operation_allocations a
  JOIN production_report_receipt_projections p ON p.report_id=a.production_report_id
  WHERE a.operation_run_report_id=NEW.operation_run_report_id AND NOT p.reversed;
  IF consumed+NEW.quantity>source.good_qty THEN
    RAISE EXCEPTION 'final operation good quantity over-consumed' USING ERRCODE='23514',CONSTRAINT='production_report_operation_allocations_quantity_gate_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_report_operation_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON production_report_operation_allocations FOR EACH ROW EXECUTE FUNCTION cyd_production_final_output_allocation_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_validate_production_final_output_report(target_report_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE report record; allocation_total numeric(24,6); allocation_count integer; invalid_lineage boolean;
BEGIN
  SELECT r.*,p.reversed,(
    SELECT op.id FROM production_work_order_routing_snapshot_operations op
    JOIN production_work_order_routing_snapshots s ON s.id=op.snapshot_id
    WHERE s.work_order_id=r.work_order_id ORDER BY op.sequence_no DESC,op.id DESC LIMIT 1
  ) last_snapshot_operation_id INTO report
  FROM production_reports r LEFT JOIN production_report_receipt_projections p ON p.report_id=r.id
  WHERE r.id=target_report_id;
  IF report.id IS NULL OR report.last_snapshot_operation_id IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(quantity),0),count(*)::integer INTO allocation_total,allocation_count
  FROM production_report_operation_allocations WHERE production_report_id=target_report_id;
  SELECT EXISTS(
    SELECT 1 FROM production_report_operation_allocations a
    JOIN production_operation_run_reports rr ON rr.id=a.operation_run_report_id
    JOIN production_operation_runs run ON run.id=rr.run_id
    WHERE a.production_report_id=target_report_id
      AND (a.snapshot_operation_id IS DISTINCT FROM report.last_snapshot_operation_id
        OR rr.snapshot_operation_id IS DISTINCT FROM report.last_snapshot_operation_id
        OR run.snapshot_operation_id IS DISTINCT FROM report.last_snapshot_operation_id
        OR run.work_order_id IS DISTINCT FROM report.work_order_id
        OR run.status IN ('CANCELLED','REVERSED') OR rr.good_qty<=0)
  ) INTO invalid_lineage;
  IF report.reversed IS NULL OR report.reported_qty<>report.good_qty OR report.scrap_qty<>0
     OR allocation_count=0 OR allocation_total<>report.good_qty OR invalid_lineage THEN
    RAISE EXCEPTION 'structured production report does not reconcile with final output allocations' USING ERRCODE='23514',CONSTRAINT='production_final_output_report_reconciliation_ck';
  END IF;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_validate_production_operation_projection(target_snapshot_operation_id bigint) RETURNS void LANGUAGE plpgsql AS $$
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
  ), final_report AS (
    SELECT coalesce(sum(a.quantity),0) qty FROM production_report_operation_allocations a
    JOIN production_report_receipt_projections p ON p.report_id=a.production_report_id
    WHERE a.snapshot_operation_id=target_snapshot_operation_id AND NOT p.reversed
  ) SELECT source.qty source_qty,(source.qty-facts.dispatched) waiting,facts.dispatched,facts.processed,facts.good,facts.scrap,facts.in_progress,transfer.qty transferred,(facts.good-transfer.qty) available,
    CASE WHEN actual.next_snapshot_operation_id IS NULL THEN facts.good-transfer.qty-final_report.qty ELSE 0 END final_output,
    CASE WHEN actual.work_order_status='CANCELLED' THEN 'CANCELLED' WHEN facts.processed>=actual.target_qty THEN 'COMPLETED' WHEN facts.has_active THEN 'IN_PROGRESS' WHEN source.qty-facts.dispatched>0 OR facts.has_ready THEN 'READY' ELSE 'WAITING' END status
  INTO expected FROM source,facts,transfer,final_report;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND r.status NOT IN ('CANCELLED','REVERSED') AND ((actual.previous_snapshot_operation_id IS NULL AND EXISTS(SELECT 1 FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)) OR (actual.previous_snapshot_operation_id IS NOT NULL AND (SELECT coalesce(sum(a.quantity),0) FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)<>r.dispatched_qty))) INTO invalid_run;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND ROW(r.processed_qty,r.good_qty,r.scrap_qty) IS DISTINCT FROM (SELECT ROW(coalesce(sum(x.processed_qty),0),coalesce(sum(x.good_qty),0),coalesce(sum(x.scrap_qty),0)) FROM production_operation_run_reports x WHERE x.run_id=r.id)) INTO invalid_reports;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND (NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='DISPATCHED') OR (r.started_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='STARTED')) OR (r.status='REVERSED' AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='REVERSED')))) INTO invalid_events;
  IF expected.waiting<0 OR expected.available<0 OR expected.final_output<0 OR invalid_run OR invalid_reports OR invalid_events OR actual.status<>expected.status OR NOT EXISTS(
    SELECT 1 FROM production_operation_wip_projections w WHERE w.operation_projection_id=actual.id AND w.snapshot_operation_id=target_snapshot_operation_id AND ROW(w.source_input_qty,w.waiting_input_qty,w.dispatched_qty,w.in_progress_qty,w.completed_good_qty,w.scrap_qty,w.transferred_to_next_qty,w.available_for_next_qty,w.final_output_available_qty)=ROW(expected.source_qty,expected.waiting,expected.dispatched,expected.in_progress,expected.good,expected.scrap,expected.transferred,expected.available,expected.final_output)
  ) THEN RAISE EXCEPTION 'operation projection does not reconcile with immutable facts' USING ERRCODE='23514',CONSTRAINT='production_operation_projection_reconciliation_ck'; END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_production_final_output_deferred_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE report_id bigint; snapshot_id bigint;
BEGIN
  IF TG_TABLE_NAME='production_reports' THEN report_id=coalesce(NEW.id,OLD.id);
  ELSIF TG_TABLE_NAME='production_report_receipt_projections' THEN report_id=coalesce(NEW.report_id,OLD.report_id);
  ELSE report_id=coalesce(NEW.production_report_id,OLD.production_report_id); END IF;
  IF report_id IS NOT NULL THEN
    PERFORM cyd_validate_production_final_output_report(report_id);
    SELECT a.snapshot_operation_id INTO snapshot_id FROM production_report_operation_allocations a WHERE a.production_report_id=report_id ORDER BY a.id LIMIT 1;
    IF snapshot_id IS NOT NULL THEN PERFORM cyd_validate_production_operation_projection(snapshot_id); END IF;
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_reports_final_output_reconcile AFTER INSERT ON production_reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_final_output_deferred_validate();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_report_operation_allocations_reconcile AFTER INSERT ON production_report_operation_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_final_output_deferred_validate();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_report_receipt_final_output_reconcile AFTER INSERT OR UPDATE ON production_report_receipt_projections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_final_output_deferred_validate();
