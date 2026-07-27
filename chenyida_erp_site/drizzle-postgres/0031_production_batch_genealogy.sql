CREATE TABLE "production_batch_sets" (
  "id" bigserial PRIMARY KEY,
  "batch_set_code" text NOT NULL,
  "work_order_id" bigint NOT NULL REFERENCES "production_work_orders"("id") ON DELETE restrict,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "product_version_id" bigint REFERENCES "product_versions"("id") ON DELETE restrict,
  "bom_snapshot_id" bigint REFERENCES "production_bom_snapshots"("id") ON DELETE restrict,
  "routing_snapshot_id" bigint REFERENCES "production_work_order_routing_snapshots"("id") ON DELETE restrict,
  "finished_material_id" bigint REFERENCES "material_master"("id") ON DELETE restrict,
  "unit_id" bigint REFERENCES "units"("id") ON DELETE restrict,
  "planned_qty" numeric(24,6),
  "canonical_digest" text,
  "version" integer NOT NULL DEFAULT 1,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "released_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "released_request_id" uuid,
  "released_at" timestamptz,
  "cancelled_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "cancelled_request_id" uuid,
  "cancelled_at" timestamptz,
  "cancel_reason" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_batch_sets_code_uq" UNIQUE("batch_set_code"),
  CONSTRAINT "production_batch_sets_work_order_uq" UNIQUE("work_order_id"),
  CONSTRAINT "production_batch_sets_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "production_batch_sets_status_ck" CHECK ("status" in ('DRAFT','RELEASED','CANCELLED')),
  CONSTRAINT "production_batch_sets_version_ck" CHECK ("version">0),
  CONSTRAINT "production_batch_sets_release_ck" CHECK (("status"='DRAFT' and "product_version_id" is null and "bom_snapshot_id" is null and "routing_snapshot_id" is null and "finished_material_id" is null and "unit_id" is null and "planned_qty" is null and "canonical_digest" is null and "released_by" is null and "released_request_id" is null and "released_at" is null) or ("status"='RELEASED' and "product_version_id" is not null and "bom_snapshot_id" is not null and "routing_snapshot_id" is not null and "finished_material_id" is not null and "unit_id" is not null and "planned_qty">0 and "canonical_digest" ~ '^[0-9a-f]{64}$' and "released_by" is not null and "released_request_id" is not null and "released_at" is not null) or ("status"='CANCELLED')),
  CONSTRAINT "production_batch_sets_cancel_ck" CHECK (("status"='CANCELLED' and "cancelled_by" is not null and "cancelled_request_id" is not null and "cancelled_at" is not null and char_length(btrim("cancel_reason")) between 1 and 1000) or ("status"<>'CANCELLED' and "cancelled_by" is null and "cancelled_request_id" is null and "cancelled_at" is null and "cancel_reason"=''))
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
  "id" bigserial PRIMARY KEY,
  "batch_code" text NOT NULL,
  "batch_set_id" bigint NOT NULL REFERENCES "production_batch_sets"("id") ON DELETE restrict,
  "work_order_id" bigint NOT NULL REFERENCES "production_work_orders"("id") ON DELETE restrict,
  "planned_qty" numeric(24,6) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_batches_code_uq" UNIQUE("batch_code"),
  CONSTRAINT "production_batches_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "production_batches_quantity_ck" CHECK ("planned_qty">0),
  CONSTRAINT "production_batches_version_ck" CHECK ("version">0)
);
--> statement-breakpoint
CREATE TABLE "production_batch_events" (
  "id" bigserial PRIMARY KEY,
  "batch_set_id" bigint NOT NULL REFERENCES "production_batch_sets"("id") ON DELETE restrict,
  "production_batch_id" bigint REFERENCES "production_batches"("id") ON DELETE restrict,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "quantity" numeric(24,6) NOT NULL DEFAULT 0,
  "reason" text NOT NULL DEFAULT '',
  "actor" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_batch_events_type_ck" CHECK ("event_type" in ('SET_CREATED','BATCH_ADDED','BATCH_UPDATED','BATCH_DELETED','SET_RELEASED','SET_CANCELLED')),
  CONSTRAINT "production_batch_events_status_ck" CHECK (("from_status" is null or "from_status" in ('DRAFT','RELEASED','CANCELLED')) and "to_status" in ('DRAFT','RELEASED','CANCELLED') and "quantity">=0)
);
--> statement-breakpoint
ALTER TABLE "production_operation_runs" ADD COLUMN "production_batch_id" bigint REFERENCES "production_batches"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "production_report_batches" (
  "production_report_id" bigint PRIMARY KEY REFERENCES "production_reports"("id") ON DELETE restrict,
  "production_batch_id" bigint NOT NULL REFERENCES "production_batches"("id") ON DELETE restrict,
  "work_order_id" bigint NOT NULL REFERENCES "production_work_orders"("id") ON DELETE restrict,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "production_completion_batches" (
  "production_completion_id" bigint PRIMARY KEY REFERENCES "production_completions"("id") ON DELETE restrict,
  "production_batch_id" bigint NOT NULL REFERENCES "production_batches"("id") ON DELETE restrict,
  "work_order_id" bigint NOT NULL REFERENCES "production_work_orders"("id") ON DELETE restrict,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "production_batch_sets_queue_idx" ON "production_batch_sets"("status","updated_at","id");
--> statement-breakpoint
CREATE INDEX "production_batches_set_idx" ON "production_batches"("batch_set_id","id");
--> statement-breakpoint
CREATE INDEX "production_batches_work_order_idx" ON "production_batches"("work_order_id","id");
--> statement-breakpoint
CREATE INDEX "production_batch_events_set_idx" ON "production_batch_events"("batch_set_id","id");
--> statement-breakpoint
CREATE INDEX "production_operation_runs_batch_idx" ON "production_operation_runs"("production_batch_id","snapshot_operation_id","status","id");
--> statement-breakpoint
CREATE INDEX "production_report_batches_batch_idx" ON "production_report_batches"("production_batch_id","production_report_id");
--> statement-breakpoint
CREATE INDEX "production_completion_batches_batch_idx" ON "production_completion_batches"("production_batch_id","production_completion_id");
--> statement-breakpoint

CREATE FUNCTION cyd_production_batch_set_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wo record; bom_id bigint; routing_id bigint; batch_total numeric(24,6); run_exists boolean;
BEGIN
  IF current_setting('cyd.production_batch_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production batch set writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'production batch sets are append-preserved' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'batch set must start as DRAFT' USING ERRCODE='23514',CONSTRAINT='production_batch_sets_initial_state_ck'; END IF;
    SELECT status INTO wo FROM production_work_orders WHERE id=NEW.work_order_id FOR SHARE;
    IF wo.status IS NULL OR wo.status NOT IN ('RELEASED','IN_PROGRESS') THEN RAISE EXCEPTION 'work order is not eligible for batch set' USING ERRCODE='23514',CONSTRAINT='production_batch_sets_work_order_state_ck'; END IF;
  ELSE
    IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'released or cancelled batch set is immutable' USING ERRCODE='55000'; END IF;
    IF NEW.version<>OLD.version+1 OR NEW.batch_set_code IS DISTINCT FROM OLD.batch_set_code OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'batch set identity is immutable' USING ERRCODE='55000'; END IF;
    IF NEW.status='DRAFT' THEN
      NULL;
    ELSIF NEW.status='RELEASED' THEN
      SELECT * INTO wo FROM production_work_orders WHERE id=NEW.work_order_id FOR UPDATE;
      SELECT id INTO bom_id FROM production_bom_snapshots WHERE work_order_id=NEW.work_order_id FOR SHARE;
      SELECT id INTO routing_id FROM production_work_order_routing_snapshots WHERE work_order_id=NEW.work_order_id FOR SHARE;
      SELECT coalesce(sum(planned_qty),0) INTO batch_total FROM production_batches WHERE batch_set_id=OLD.id;
      SELECT exists(select 1 from production_operation_runs where work_order_id=NEW.work_order_id) INTO run_exists;
      IF wo.id IS NULL OR wo.status NOT IN ('RELEASED','IN_PROGRESS') OR run_exists OR bom_id IS NULL OR routing_id IS NULL OR batch_total<>wo.planned_qty OR NEW.product_version_id IS DISTINCT FROM wo.product_version_id OR NEW.bom_snapshot_id IS DISTINCT FROM bom_id OR NEW.routing_snapshot_id IS DISTINCT FROM routing_id OR NEW.finished_material_id IS DISTINCT FROM wo.finished_material_id OR NEW.unit_id IS DISTINCT FROM wo.finished_unit_id OR NEW.planned_qty IS DISTINCT FROM wo.planned_qty THEN RAISE EXCEPTION 'batch set release facts do not reconcile' USING ERRCODE='23514',CONSTRAINT='production_batch_sets_release_reconciliation_ck'; END IF;
    ELSIF NEW.status<>'CANCELLED' THEN RAISE EXCEPTION 'invalid batch set transition' USING ERRCODE='23514',CONSTRAINT='production_batch_sets_transition_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_batch_sets_guard BEFORE INSERT OR UPDATE OR DELETE ON production_batch_sets FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_set_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_production_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE set_row record;
BEGIN
  IF current_setting('cyd.production_batch_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production batch writes require service' USING ERRCODE='42501'; END IF;
  SELECT * INTO set_row FROM production_batch_sets WHERE id=coalesce(NEW.batch_set_id,OLD.batch_set_id) FOR UPDATE;
  IF set_row.id IS NULL OR set_row.status<>'DRAFT' THEN RAISE EXCEPTION 'only a DRAFT batch set is mutable' USING ERRCODE='23514',CONSTRAINT='production_batches_draft_only_ck'; END IF;
  IF TG_OP='INSERT' AND (NEW.work_order_id IS DISTINCT FROM set_row.work_order_id OR NEW.version<>1) THEN RAISE EXCEPTION 'batch work order mismatch' USING ERRCODE='23514',CONSTRAINT='production_batches_work_order_ck'; END IF;
  IF TG_OP='UPDATE' AND (NEW.version<>OLD.version+1 OR ROW(NEW.batch_code,NEW.batch_set_id,NEW.work_order_id,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.batch_code,OLD.batch_set_id,OLD.work_order_id,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at)) THEN RAISE EXCEPTION 'batch identity is immutable' USING ERRCODE='55000'; END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER production_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON production_batches FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_production_batch_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.production_batch_service_write',true) IS DISTINCT FROM 'allowed' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'production batch events are service-managed immutable facts' USING ERRCODE='42501'; END IF;
  IF NEW.production_batch_id IS NOT NULL AND NOT EXISTS(select 1 from production_batches b where b.id=NEW.production_batch_id and b.batch_set_id=NEW.batch_set_id) THEN RAISE EXCEPTION 'batch event lineage mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_batch_events_guard BEFORE INSERT OR UPDATE OR DELETE ON production_batch_events FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_event_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_production_run_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE set_row record; batch_row record; first_operation_id bigint; normal_dispatched numeric(24,6); source_batch_id bigint;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.production_batch_id IS DISTINCT FROM OLD.production_batch_id THEN RAISE EXCEPTION 'operation run batch identity is immutable' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_batch_immutable_ck'; END IF;
  IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
  SELECT * INTO set_row FROM production_batch_sets WHERE work_order_id=NEW.work_order_id AND status='RELEASED' FOR SHARE;
  IF set_row.id IS NULL THEN
    IF NEW.production_batch_id IS NOT NULL THEN RAISE EXCEPTION 'ORDER mode run cannot claim a production batch' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_batch_mode_ck'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.production_batch_id IS NULL THEN RAISE EXCEPTION 'released batch work order requires production batch' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_batch_required_ck'; END IF;
  SELECT * INTO batch_row FROM production_batches WHERE id=NEW.production_batch_id FOR UPDATE;
  IF batch_row.id IS NULL OR batch_row.batch_set_id IS DISTINCT FROM set_row.id OR batch_row.work_order_id IS DISTINCT FROM NEW.work_order_id THEN RAISE EXCEPTION 'operation run production batch mismatch' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_batch_lineage_ck'; END IF;
  IF NEW.run_kind='REWORK' THEN
    SELECT source.production_batch_id INTO source_batch_id FROM production_operation_run_reports rr JOIN production_operation_runs source ON source.id=rr.run_id WHERE rr.id=NEW.source_operation_run_report_id;
    IF source_batch_id IS DISTINCT FROM NEW.production_batch_id THEN RAISE EXCEPTION 'rework run must inherit source production batch' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_rework_batch_ck'; END IF;
  ELSE
    SELECT op.id INTO first_operation_id FROM production_work_order_routing_snapshot_operations op WHERE op.snapshot_id=set_row.routing_snapshot_id ORDER BY op.sequence_no,op.id LIMIT 1;
    IF NEW.snapshot_operation_id=first_operation_id THEN
      SELECT coalesce(sum(dispatched_qty),0) INTO normal_dispatched FROM production_operation_runs WHERE production_batch_id=NEW.production_batch_id AND snapshot_operation_id=first_operation_id AND run_kind='NORMAL' AND status NOT IN ('CANCELLED','REVERSED');
      IF normal_dispatched+NEW.dispatched_qty>batch_row.planned_qty THEN RAISE EXCEPTION 'first operation dispatch exceeds batch planned quantity' USING ERRCODE='23514',CONSTRAINT='production_operation_runs_batch_capacity_ck'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_operation_runs_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON production_operation_runs FOR EACH ROW EXECUTE FUNCTION cyd_production_run_batch_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_production_input_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record; source record;
BEGIN
  IF TG_OP<>'INSERT' THEN RETURN coalesce(NEW,OLD); END IF;
  SELECT work_order_id,production_batch_id,run_kind INTO target FROM production_operation_runs WHERE id=NEW.run_id;
  SELECT work_order_id,production_batch_id,run_kind INTO source FROM production_operation_runs WHERE id=NEW.source_run_id;
  IF target.work_order_id IS DISTINCT FROM source.work_order_id OR target.run_kind<>'NORMAL' OR source.run_kind NOT IN ('NORMAL','REWORK') OR target.production_batch_id IS DISTINCT FROM source.production_batch_id THEN RAISE EXCEPTION 'operation input allocation cannot cross production batch' USING ERRCODE='23514',CONSTRAINT='production_operation_run_input_allocations_batch_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_operation_run_input_allocations_batch_guard BEFORE INSERT OR UPDATE ON production_operation_run_input_allocations FOR EACH ROW EXECUTE FUNCTION cyd_production_input_batch_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_production_report_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE report_row record; batch_row record; invalid boolean;
BEGIN
  IF current_setting('cyd.production_batch_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production report batch writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'production report batch lineage is immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO report_row FROM production_reports WHERE id=NEW.production_report_id FOR SHARE;
  SELECT * INTO batch_row FROM production_batches WHERE id=NEW.production_batch_id FOR SHARE;
  SELECT exists(select 1 from production_report_operation_allocations a join production_operation_run_reports rr on rr.id=a.operation_run_report_id join production_operation_runs run on run.id=rr.run_id where a.production_report_id=NEW.production_report_id and run.production_batch_id is distinct from NEW.production_batch_id) INTO invalid;
  IF report_row.id IS NULL OR batch_row.id IS NULL OR report_row.work_order_id IS DISTINCT FROM NEW.work_order_id OR batch_row.work_order_id IS DISTINCT FROM NEW.work_order_id OR invalid THEN RAISE EXCEPTION 'production report batch lineage mismatch' USING ERRCODE='23514',CONSTRAINT='production_report_batches_lineage_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_report_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON production_report_batches FOR EACH ROW EXECUTE FUNCTION cyd_production_report_batch_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_production_completion_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE completion_row record; batch_row record; invalid boolean;
BEGIN
  IF current_setting('cyd.production_batch_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production completion batch writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'production completion batch lineage is immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO completion_row FROM production_completions WHERE id=NEW.production_completion_id FOR SHARE;
  SELECT * INTO batch_row FROM production_batches WHERE id=NEW.production_batch_id FOR SHARE;
  SELECT exists(select 1 from production_completion_report_allocations a left join production_report_batches rb on rb.production_report_id=a.report_id where a.completion_id=NEW.production_completion_id and rb.production_batch_id is distinct from NEW.production_batch_id) INTO invalid;
  IF completion_row.id IS NULL OR batch_row.id IS NULL OR completion_row.work_order_id IS DISTINCT FROM NEW.work_order_id OR batch_row.work_order_id IS DISTINCT FROM NEW.work_order_id OR invalid THEN RAISE EXCEPTION 'production completion batch lineage mismatch' USING ERRCODE='23514',CONSTRAINT='production_completion_batches_lineage_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_completion_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON production_completion_batches FOR EACH ROW EXECUTE FUNCTION cyd_production_completion_batch_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_validate_production_batch_mode(target_work_order_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE set_row record; batch_total numeric(24,6); invalid_runs boolean; invalid_inputs boolean; invalid_reports boolean; invalid_completions boolean;
BEGIN
  SELECT * INTO set_row FROM production_batch_sets WHERE work_order_id=target_work_order_id;
  IF set_row.id IS NULL OR set_row.status<>'RELEASED' THEN RETURN; END IF;
  SELECT coalesce(sum(planned_qty),0) INTO batch_total FROM production_batches WHERE batch_set_id=set_row.id;
  SELECT exists(select 1 from production_operation_runs r left join production_batches b on b.id=r.production_batch_id where r.work_order_id=target_work_order_id and (b.id is null or b.batch_set_id<>set_row.id or b.work_order_id<>target_work_order_id)) INTO invalid_runs;
  SELECT exists(select 1 from production_operation_run_input_allocations a join production_operation_runs t on t.id=a.run_id join production_operation_runs s on s.id=a.source_run_id where t.work_order_id=target_work_order_id and t.production_batch_id is distinct from s.production_batch_id) INTO invalid_inputs;
  SELECT exists(
    select 1 from production_reports r
    left join production_report_batches rb on rb.production_report_id=r.id
    where r.work_order_id=target_work_order_id
      and exists(select 1 from production_report_operation_allocations a where a.production_report_id=r.id)
      and (rb.production_batch_id is null or exists(
        select 1 from production_report_operation_allocations a
        join production_operation_run_reports rr on rr.id=a.operation_run_report_id
        join production_operation_runs run on run.id=rr.run_id
        where a.production_report_id=r.id and run.production_batch_id is distinct from rb.production_batch_id
      ))
  ) INTO invalid_reports;
  SELECT exists(
    select 1 from production_completions c
    left join production_completion_batches cb on cb.production_completion_id=c.id
    where c.work_order_id=target_work_order_id
      and (cb.production_batch_id is null or exists(
        select 1 from production_completion_report_allocations a
        left join production_report_batches rb on rb.production_report_id=a.report_id
        where a.completion_id=c.id and rb.production_batch_id is distinct from cb.production_batch_id
      ))
  ) INTO invalid_completions;
  IF batch_total<>set_row.planned_qty OR invalid_runs OR invalid_inputs OR invalid_reports OR invalid_completions THEN RAISE EXCEPTION 'production batch mode does not reconcile' USING ERRCODE='23514',CONSTRAINT='production_batch_mode_reconciliation_ck'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_production_batch_deferred_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_id bigint;
BEGIN
  IF TG_TABLE_NAME='production_batch_sets' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_batches' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_operation_runs' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_reports' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_completions' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_report_batches' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_completion_batches' THEN work_id=coalesce(NEW.work_order_id,OLD.work_order_id);
  ELSIF TG_TABLE_NAME='production_report_operation_allocations' THEN
    SELECT work_order_id INTO work_id FROM production_reports WHERE id=coalesce(NEW.production_report_id,OLD.production_report_id);
  ELSIF TG_TABLE_NAME='production_completion_report_allocations' THEN
    SELECT work_order_id INTO work_id FROM production_completions WHERE id=coalesce(NEW.completion_id,OLD.completion_id);
  END IF;
  IF work_id IS NOT NULL THEN PERFORM cyd_validate_production_batch_mode(work_id); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_batch_sets_reconcile AFTER INSERT OR UPDATE ON production_batch_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_batches_reconcile AFTER INSERT OR UPDATE OR DELETE ON production_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_operation_runs_batch_reconcile AFTER INSERT OR UPDATE ON production_operation_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_reports_batch_reconcile AFTER INSERT ON production_reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_report_batches_reconcile AFTER INSERT ON production_report_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_report_operation_allocations_batch_reconcile AFTER INSERT OR UPDATE OR DELETE ON production_report_operation_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_completions_batch_reconcile AFTER INSERT ON production_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_completion_batches_reconcile AFTER INSERT ON production_completion_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_completion_report_allocations_batch_reconcile AFTER INSERT OR UPDATE OR DELETE ON production_completion_report_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_production_batch_deferred_guard();
