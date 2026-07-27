CREATE TABLE "production_nonconformances" (
  "id" bigserial PRIMARY KEY,
  "ncr_code" text NOT NULL,
  "inspection_id" bigint NOT NULL REFERENCES "quality_inspections"("id") ON DELETE restrict,
  "production_operation_run_report_id" bigint NOT NULL REFERENCES "production_operation_run_reports"("id") ON DELETE restrict,
  "work_order_id" bigint NOT NULL REFERENCES "production_work_orders"("id") ON DELETE restrict,
  "snapshot_operation_id" bigint NOT NULL REFERENCES "production_work_order_routing_snapshot_operations"("id") ON DELETE restrict,
  "work_center_id" bigint NOT NULL REFERENCES "production_work_centers"("id") ON DELETE restrict,
  "work_center_code" text NOT NULL,
  "work_center_name" text NOT NULL,
  "material_id" bigint NOT NULL REFERENCES "material_master"("id") ON DELETE restrict,
  "unit_id" bigint NOT NULL REFERENCES "units"("id") ON DELETE restrict,
  "inspected_qty" numeric(24,6) NOT NULL,
  "passed_qty" numeric(24,6) NOT NULL,
  "failed_qty" numeric(24,6) NOT NULL,
  "active_rework_qty" numeric(24,6) NOT NULL DEFAULT 0,
  "final_scrap_qty" numeric(24,6) NOT NULL DEFAULT 0,
  "unresolved_qty" numeric(24,6) NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "version" integer NOT NULL DEFAULT 1,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "cancelled_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "cancelled_request_id" uuid,
  "cancelled_at" timestamptz,
  "cancel_reason" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_nonconformances_code_uq" UNIQUE("ncr_code"),
  CONSTRAINT "production_nonconformances_inspection_uq" UNIQUE("inspection_id"),
  CONSTRAINT "production_nonconformances_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "production_nonconformances_status_ck" CHECK ("status" in ('OPEN','REWORK_PENDING','REWORK_ACCEPTED','DISPOSED','CANCELLED')),
  CONSTRAINT "production_nonconformances_quantity_ck" CHECK ("inspected_qty">0 and "passed_qty">=0 and "failed_qty">0 and "passed_qty"+"failed_qty"="inspected_qty" and "active_rework_qty">=0 and "final_scrap_qty">=0 and "unresolved_qty">=0 and "active_rework_qty"+"final_scrap_qty"+"unresolved_qty"="failed_qty"),
  CONSTRAINT "production_nonconformances_version_ck" CHECK ("version">0),
  CONSTRAINT "production_nonconformances_cancel_ck" CHECK (("status"='CANCELLED' and "cancelled_by" is not null and "cancelled_request_id" is not null and "cancelled_at" is not null and char_length(btrim("cancel_reason")) between 1 and 1000) or ("status"<>'CANCELLED' and "cancelled_by" is null and "cancelled_request_id" is null and "cancelled_at" is null and "cancel_reason"=''))
);
--> statement-breakpoint
CREATE INDEX "production_nonconformances_queue_idx" ON "production_nonconformances" ("status","created_at","id");
--> statement-breakpoint
CREATE INDEX "production_nonconformances_work_order_idx" ON "production_nonconformances" ("work_order_id","snapshot_operation_id","id");
--> statement-breakpoint

CREATE TABLE "production_nonconformance_events" (
  "id" bigserial PRIMARY KEY,
  "nonconformance_id" bigint NOT NULL REFERENCES "production_nonconformances"("id") ON DELETE restrict,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "quantity" numeric(24,6) NOT NULL DEFAULT 0,
  "reason" text NOT NULL DEFAULT '',
  "actor" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_nonconformance_events_type_ck" CHECK ("event_type" in ('CREATED','REWORK_RESERVED','REWORK_UPDATED','REWORK_SUBMITTED','REWORK_RETURNED','REWORK_ACCEPTED','REWORK_CANCELLED','SCRAP_DISPOSED','CANCELLED')),
  CONSTRAINT "production_nonconformance_events_status_ck" CHECK (("from_status" is null or "from_status" in ('OPEN','REWORK_PENDING','REWORK_ACCEPTED','DISPOSED','CANCELLED')) and "to_status" in ('OPEN','REWORK_PENDING','REWORK_ACCEPTED','DISPOSED','CANCELLED') and "quantity">=0)
);
--> statement-breakpoint
CREATE INDEX "production_nonconformance_events_ncr_idx" ON "production_nonconformance_events" ("nonconformance_id","id");
--> statement-breakpoint

CREATE TABLE "production_rework_requests" (
  "id" bigserial PRIMARY KEY,
  "request_code" text NOT NULL,
  "nonconformance_id" bigint NOT NULL REFERENCES "production_nonconformances"("id") ON DELETE restrict,
  "revision_no" integer NOT NULL,
  "supersedes_request_id" bigint,
  "target_snapshot_operation_id" bigint NOT NULL REFERENCES "production_work_order_routing_snapshot_operations"("id") ON DELETE restrict,
  "target_sequence_no" integer NOT NULL,
  "target_operation_code" text NOT NULL,
  "target_operation_name" text NOT NULL,
  "target_work_center_id" bigint NOT NULL REFERENCES "production_work_centers"("id") ON DELETE restrict,
  "target_work_center_code" text NOT NULL,
  "target_work_center_name" text NOT NULL,
  "target_description" text NOT NULL DEFAULT '',
  "quantity" numeric(24,6) NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "version" integer NOT NULL DEFAULT 1,
  "canonical_digest" text,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "submitted_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "submitted_request_id" uuid,
  "submitted_at" timestamptz,
  "decided_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "decided_request_id" uuid,
  "decided_at" timestamptz,
  "return_reason" text NOT NULL DEFAULT '',
  "cancelled_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "cancelled_request_id" uuid,
  "cancelled_at" timestamptz,
  "cancel_reason" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_rework_requests_code_uq" UNIQUE("request_code"),
  CONSTRAINT "production_rework_requests_revision_uq" UNIQUE("nonconformance_id","revision_no"),
  CONSTRAINT "production_rework_requests_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "production_rework_requests_supersedes_uq" UNIQUE("supersedes_request_id"),
  CONSTRAINT "production_rework_requests_supersedes_fk" FOREIGN KEY ("supersedes_request_id") REFERENCES "production_rework_requests"("id") ON DELETE restrict,
  CONSTRAINT "production_rework_requests_status_ck" CHECK ("status" in ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','CANCELLED')),
  CONSTRAINT "production_rework_requests_quantity_ck" CHECK ("quantity">0),
  CONSTRAINT "production_rework_requests_reason_ck" CHECK (char_length(btrim("reason")) between 1 and 2000),
  CONSTRAINT "production_rework_requests_version_ck" CHECK ("version">0),
  CONSTRAINT "production_rework_requests_digest_ck" CHECK (("status"='DRAFT' and "canonical_digest" is null and "submitted_by" is null and "submitted_request_id" is null and "submitted_at" is null) or ("status" in ('SUBMITTED','ACCEPTED','RETURNED') and "canonical_digest" ~ '^[0-9a-f]{64}$' and "submitted_by" is not null and "submitted_request_id" is not null and "submitted_at" is not null) or ("status"='CANCELLED' and (("canonical_digest" is null and "submitted_by" is null and "submitted_request_id" is null and "submitted_at" is null) or ("canonical_digest" ~ '^[0-9a-f]{64}$' and "submitted_by" is not null and "submitted_request_id" is not null and "submitted_at" is not null)))),
  CONSTRAINT "production_rework_requests_decision_ck" CHECK (("status" in ('ACCEPTED','RETURNED') and "decided_by" is not null and "decided_request_id" is not null and "decided_at" is not null and (("status"='RETURNED' and char_length(btrim("return_reason")) between 1 and 1000) or ("status"='ACCEPTED' and "return_reason"=''))) or ("status" not in ('ACCEPTED','RETURNED') and "decided_by" is null and "decided_request_id" is null and "decided_at" is null and "return_reason"='')),
  CONSTRAINT "production_rework_requests_cancel_ck" CHECK (("status"='CANCELLED' and "cancelled_by" is not null and "cancelled_request_id" is not null and "cancelled_at" is not null and char_length(btrim("cancel_reason")) between 1 and 1000) or ("status"<>'CANCELLED' and "cancelled_by" is null and "cancelled_request_id" is null and "cancelled_at" is null and "cancel_reason"=''))
);
--> statement-breakpoint
CREATE INDEX "production_rework_requests_queue_idx" ON "production_rework_requests" ("status","created_at","id");
--> statement-breakpoint
CREATE INDEX "production_rework_requests_ncr_idx" ON "production_rework_requests" ("nonconformance_id","revision_no","id");
--> statement-breakpoint

CREATE TABLE "production_rework_request_versions" (
  "id" bigserial PRIMARY KEY,
  "rework_request_id" bigint NOT NULL REFERENCES "production_rework_requests"("id") ON DELETE restrict,
  "version_no" integer NOT NULL,
  "nonconformance_id" bigint NOT NULL REFERENCES "production_nonconformances"("id") ON DELETE restrict,
  "target_snapshot_operation_id" bigint NOT NULL REFERENCES "production_work_order_routing_snapshot_operations"("id") ON DELETE restrict,
  "target_sequence_no" integer NOT NULL,
  "target_operation_code" text NOT NULL,
  "target_operation_name" text NOT NULL,
  "target_work_center_id" bigint NOT NULL REFERENCES "production_work_centers"("id") ON DELETE restrict,
  "target_work_center_code" text NOT NULL,
  "target_work_center_name" text NOT NULL,
  "target_description" text NOT NULL DEFAULT '',
  "quantity" numeric(24,6) NOT NULL,
  "reason" text NOT NULL,
  "canonical_digest" text NOT NULL,
  "submitted_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_rework_request_versions_request_uq" UNIQUE("rework_request_id"),
  CONSTRAINT "production_rework_request_versions_number_uq" UNIQUE("rework_request_id","version_no"),
  CONSTRAINT "production_rework_request_versions_quantity_ck" CHECK ("quantity">0),
  CONSTRAINT "production_rework_request_versions_digest_ck" CHECK ("canonical_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint

CREATE TABLE "production_rework_request_events" (
  "id" bigserial PRIMARY KEY,
  "rework_request_id" bigint NOT NULL REFERENCES "production_rework_requests"("id") ON DELETE restrict,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "quantity" numeric(24,6) NOT NULL,
  "reason" text NOT NULL DEFAULT '',
  "actor" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_rework_request_events_type_ck" CHECK ("event_type" in ('CREATED','UPDATED','SUBMITTED','ACCEPTED','RETURNED','CANCELLED')),
  CONSTRAINT "production_rework_request_events_status_ck" CHECK (("from_status" is null or "from_status" in ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','CANCELLED')) and "to_status" in ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','CANCELLED') and "quantity">0)
);
--> statement-breakpoint
CREATE INDEX "production_rework_request_events_request_idx" ON "production_rework_request_events" ("rework_request_id","id");
--> statement-breakpoint

CREATE TABLE "production_scrap_dispositions" (
  "id" bigserial PRIMARY KEY,
  "disposition_code" text NOT NULL,
  "nonconformance_id" bigint NOT NULL REFERENCES "production_nonconformances"("id") ON DELETE restrict,
  "quantity" numeric(24,6) NOT NULL,
  "reason" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_scrap_dispositions_code_uq" UNIQUE("disposition_code"),
  CONSTRAINT "production_scrap_dispositions_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "production_scrap_dispositions_quantity_ck" CHECK ("quantity">0),
  CONSTRAINT "production_scrap_dispositions_reason_ck" CHECK (char_length(btrim("reason")) between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX "production_scrap_dispositions_ncr_idx" ON "production_scrap_dispositions" ("nonconformance_id","id");
--> statement-breakpoint

CREATE TABLE "production_nonconformance_allocations" (
  "id" bigserial PRIMARY KEY,
  "nonconformance_id" bigint NOT NULL REFERENCES "production_nonconformances"("id") ON DELETE restrict,
  "allocation_type" text NOT NULL,
  "rework_request_id" bigint REFERENCES "production_rework_requests"("id") ON DELETE restrict,
  "scrap_disposition_id" bigint REFERENCES "production_scrap_dispositions"("id") ON DELETE restrict,
  "quantity" numeric(24,6) NOT NULL,
  "status" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "released_by" text REFERENCES "app_users"("username") ON DELETE restrict,
  "released_request_id" uuid,
  "released_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_nonconformance_allocations_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "production_nonconformance_allocations_rework_uq" UNIQUE("rework_request_id"),
  CONSTRAINT "production_nonconformance_allocations_scrap_uq" UNIQUE("scrap_disposition_id"),
  CONSTRAINT "production_nonconformance_allocations_source_ck" CHECK (("allocation_type"='REWORK' and "rework_request_id" is not null and "scrap_disposition_id" is null and "status" in ('ACTIVE','RELEASED')) or ("allocation_type"='SCRAP' and "rework_request_id" is null and "scrap_disposition_id" is not null and "status"='FINAL')),
  CONSTRAINT "production_nonconformance_allocations_quantity_ck" CHECK ("quantity">0),
  CONSTRAINT "production_nonconformance_allocations_release_ck" CHECK (("status"='RELEASED' and "released_by" is not null and "released_request_id" is not null and "released_at" is not null) or ("status"<>'RELEASED' and "released_by" is null and "released_request_id" is null and "released_at" is null))
);
--> statement-breakpoint
CREATE INDEX "production_nonconformance_allocations_ncr_idx" ON "production_nonconformance_allocations" ("nonconformance_id","status","id");
--> statement-breakpoint

CREATE FUNCTION cyd_nonconformance_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source record; defect_count bigint; fail_count bigint;
BEGIN
  IF current_setting('cyd.nonconformance_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'nonconformance writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'nonconformance facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT qi.*,rr.id run_report_id,run.work_order_id,rr.snapshot_operation_id,op.work_center_id,op.work_center_code,op.work_center_name,op.quality_gate_mode,wo.finished_material_id source_material_id,wo.finished_unit_id source_unit_id
      INTO source FROM quality_inspections qi
      JOIN production_operation_run_reports rr ON rr.id=qi.production_operation_run_report_id
      JOIN production_operation_runs run ON run.id=rr.run_id AND run.status NOT IN ('CANCELLED','REVERSED')
      JOIN production_work_order_routing_snapshot_operations op ON op.id=rr.snapshot_operation_id AND op.id=run.snapshot_operation_id
      JOIN production_work_order_routing_snapshots s ON s.id=op.snapshot_id AND s.work_order_id=run.work_order_id
      JOIN production_work_orders wo ON wo.id=run.work_order_id
      WHERE qi.id=NEW.inspection_id AND qi.inspection_type='IPQC' AND qi.failed_qty>0 AND qi.lifecycle_status='CLOSED' FOR SHARE OF qi,rr,run,op,s,wo;
    SELECT count(*) INTO defect_count FROM quality_defects WHERE inspection_id=NEW.inspection_id AND quantity>0;
    SELECT count(*) INTO fail_count FROM quality_inspection_results WHERE inspection_id=NEW.inspection_id AND result='FAIL';
    IF source.id IS NULL OR source.quality_gate_mode<>'IPQC' OR defect_count=0 OR fail_count=0 THEN RAISE EXCEPTION 'NCR requires closed structured failed IPQC evidence' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_source_ck'; END IF;
    IF NEW.production_operation_run_report_id IS DISTINCT FROM source.run_report_id OR NEW.work_order_id IS DISTINCT FROM source.work_order_id OR NEW.snapshot_operation_id IS DISTINCT FROM source.snapshot_operation_id OR NEW.work_center_id IS DISTINCT FROM source.work_center_id OR NEW.work_center_code IS DISTINCT FROM source.work_center_code OR NEW.work_center_name IS DISTINCT FROM source.work_center_name OR NEW.material_id IS DISTINCT FROM source.source_material_id OR NEW.unit_id IS DISTINCT FROM source.source_unit_id OR NEW.inspected_qty IS DISTINCT FROM source.inspected_qty OR NEW.passed_qty IS DISTINCT FROM source.passed_qty OR NEW.failed_qty IS DISTINCT FROM source.failed_qty OR NEW.unresolved_qty IS DISTINCT FROM source.failed_qty OR NEW.active_rework_qty<>0 OR NEW.final_scrap_qty<>0 OR NEW.status<>'OPEN' THEN RAISE EXCEPTION 'NCR source facts mismatch' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_source_ck'; END IF;
  ELSIF NEW.ncr_code IS DISTINCT FROM OLD.ncr_code OR NEW.inspection_id IS DISTINCT FROM OLD.inspection_id OR NEW.production_operation_run_report_id IS DISTINCT FROM OLD.production_operation_run_report_id OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id OR NEW.snapshot_operation_id IS DISTINCT FROM OLD.snapshot_operation_id OR NEW.work_center_id IS DISTINCT FROM OLD.work_center_id OR NEW.work_center_code IS DISTINCT FROM OLD.work_center_code OR NEW.work_center_name IS DISTINCT FROM OLD.work_center_name OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.inspected_qty IS DISTINCT FROM OLD.inspected_qty OR NEW.passed_qty IS DISTINCT FROM OLD.passed_qty OR NEW.failed_qty IS DISTINCT FROM OLD.failed_qty OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'NCR source facts are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "production_nonconformances_guard" BEFORE INSERT OR UPDATE OR DELETE ON "production_nonconformances" FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_header_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_rework_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ncr record; target record; previous record;
BEGIN
  IF current_setting('cyd.nonconformance_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'rework request writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'rework requests are immutable' USING ERRCODE='55000'; END IF;
  SELECT n.*,source.sequence_no source_sequence INTO ncr FROM production_nonconformances n JOIN production_work_order_routing_snapshot_operations source ON source.id=n.snapshot_operation_id WHERE n.id=NEW.nonconformance_id FOR SHARE OF n,source;
  SELECT op.*,s.work_order_id INTO target FROM production_work_order_routing_snapshot_operations op JOIN production_work_order_routing_snapshots s ON s.id=op.snapshot_id WHERE op.id=NEW.target_snapshot_operation_id FOR SHARE OF op,s;
  IF ncr.id IS NULL OR ncr.status='CANCELLED' OR target.id IS NULL OR target.work_order_id IS DISTINCT FROM ncr.work_order_id OR target.sequence_no>ncr.source_sequence OR NEW.target_sequence_no IS DISTINCT FROM target.sequence_no OR NEW.target_operation_code IS DISTINCT FROM target.operation_code OR NEW.target_operation_name IS DISTINCT FROM target.operation_name OR NEW.target_work_center_id IS DISTINCT FROM target.work_center_id OR NEW.target_work_center_code IS DISTINCT FROM target.work_center_code OR NEW.target_work_center_name IS DISTINCT FROM target.work_center_name OR NEW.target_description IS DISTINCT FROM target.description THEN RAISE EXCEPTION 'invalid rework target snapshot operation' USING ERRCODE='23514',CONSTRAINT='production_rework_requests_target_ck'; END IF;
  IF NEW.supersedes_request_id IS NOT NULL THEN SELECT * INTO previous FROM production_rework_requests WHERE id=NEW.supersedes_request_id; IF previous.id IS NULL OR previous.nonconformance_id IS DISTINCT FROM NEW.nonconformance_id OR previous.status NOT IN ('RETURNED','CANCELLED') OR NEW.revision_no<>previous.revision_no+1 THEN RAISE EXCEPTION 'invalid rework request revision' USING ERRCODE='23514',CONSTRAINT='production_rework_requests_revision_ck'; END IF; ELSIF NEW.revision_no<>1 THEN RAISE EXCEPTION 'first rework request must be revision one' USING ERRCODE='23514',CONSTRAINT='production_rework_requests_revision_ck'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.request_code IS DISTINCT FROM OLD.request_code OR NEW.nonconformance_id IS DISTINCT FROM OLD.nonconformance_id OR NEW.revision_no IS DISTINCT FROM OLD.revision_no OR NEW.supersedes_request_id IS DISTINCT FROM OLD.supersedes_request_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'rework request identity is immutable' USING ERRCODE='55000'; END IF;
    IF OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','SUBMITTED','CANCELLED') THEN RAISE EXCEPTION 'invalid rework draft transition' USING ERRCODE='23514',CONSTRAINT='production_rework_requests_transition_ck'; END IF;
    IF OLD.status='SUBMITTED' AND NEW.status NOT IN ('ACCEPTED','RETURNED') THEN RAISE EXCEPTION 'invalid rework submitted transition' USING ERRCODE='23514',CONSTRAINT='production_rework_requests_transition_ck'; END IF;
    IF OLD.status IN ('ACCEPTED','RETURNED','CANCELLED') THEN RAISE EXCEPTION 'terminal rework request is immutable' USING ERRCODE='55000'; END IF;
    IF OLD.status='SUBMITTED' AND (NEW.target_snapshot_operation_id IS DISTINCT FROM OLD.target_snapshot_operation_id OR NEW.target_sequence_no IS DISTINCT FROM OLD.target_sequence_no OR NEW.target_operation_code IS DISTINCT FROM OLD.target_operation_code OR NEW.target_operation_name IS DISTINCT FROM OLD.target_operation_name OR NEW.target_work_center_id IS DISTINCT FROM OLD.target_work_center_id OR NEW.target_work_center_code IS DISTINCT FROM OLD.target_work_center_code OR NEW.target_work_center_name IS DISTINCT FROM OLD.target_work_center_name OR NEW.target_description IS DISTINCT FROM OLD.target_description OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.canonical_digest IS DISTINCT FROM OLD.canonical_digest OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.submitted_request_id IS DISTINCT FROM OLD.submitted_request_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN RAISE EXCEPTION 'submitted rework snapshot is immutable' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "production_rework_requests_guard" BEFORE INSERT OR UPDATE OR DELETE ON "production_rework_requests" FOR EACH ROW EXECUTE FUNCTION cyd_rework_request_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_nonconformance_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_ncr bigint; source_qty numeric(24,6); request_status text; used numeric(24,6); failed numeric(24,6);
BEGIN
  IF current_setting('cyd.nonconformance_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'NCR allocations require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'NCR allocations are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.allocation_type<>'REWORK' OR OLD.status<>'ACTIVE' OR NEW.status<>'RELEASED' OR NEW.nonconformance_id IS DISTINCT FROM OLD.nonconformance_id OR NEW.allocation_type IS DISTINCT FROM OLD.allocation_type OR NEW.rework_request_id IS DISTINCT FROM OLD.rework_request_id OR NEW.scrap_disposition_id IS DISTINCT FROM OLD.scrap_disposition_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'NCR allocation is immutable' USING ERRCODE='55000'; END IF;
    SELECT nonconformance_id,quantity,status INTO source_ncr,source_qty,request_status FROM production_rework_requests WHERE id=NEW.rework_request_id FOR SHARE;
    IF source_ncr IS DISTINCT FROM NEW.nonconformance_id OR source_qty IS DISTINCT FROM NEW.quantity OR request_status NOT IN ('RETURNED','CANCELLED') THEN RAISE EXCEPTION 'only a terminal request can release allocation' USING ERRCODE='23514',CONSTRAINT='production_nonconformance_allocations_release_state_ck'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.allocation_type='REWORK' THEN SELECT nonconformance_id,quantity,status INTO source_ncr,source_qty,request_status FROM production_rework_requests WHERE id=NEW.rework_request_id FOR SHARE; IF request_status NOT IN ('SUBMITTED','ACCEPTED') OR NEW.status<>'ACTIVE' THEN RAISE EXCEPTION 'invalid active rework allocation' USING ERRCODE='23514',CONSTRAINT='production_nonconformance_allocations_source_match_ck'; END IF;
  ELSE SELECT nonconformance_id,quantity INTO source_ncr,source_qty FROM production_scrap_dispositions WHERE id=NEW.scrap_disposition_id FOR SHARE; IF NEW.status<>'FINAL' THEN RAISE EXCEPTION 'scrap allocation must be final' USING ERRCODE='23514',CONSTRAINT='production_nonconformance_allocations_source_match_ck'; END IF; END IF;
  IF source_ncr IS DISTINCT FROM NEW.nonconformance_id OR source_qty IS DISTINCT FROM NEW.quantity THEN RAISE EXCEPTION 'NCR allocation source mismatch' USING ERRCODE='23514',CONSTRAINT='production_nonconformance_allocations_source_match_ck'; END IF;
  SELECT failed_qty INTO failed FROM production_nonconformances WHERE id=NEW.nonconformance_id FOR UPDATE;
  SELECT coalesce(sum(quantity) filter(where status in ('ACTIVE','FINAL')),0) INTO used FROM production_nonconformance_allocations WHERE nonconformance_id=NEW.nonconformance_id;
  IF failed IS NULL OR used+NEW.quantity>failed THEN RAISE EXCEPTION 'NCR failed quantity over-allocated' USING ERRCODE='23514',CONSTRAINT='production_nonconformance_allocations_capacity_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "production_nonconformance_allocations_guard" BEFORE INSERT OR UPDATE OR DELETE ON "production_nonconformance_allocations" FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_allocation_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_rework_request_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source record;
BEGIN
  IF current_setting('cyd.nonconformance_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'rework snapshot writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'rework submitted snapshots are immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO source FROM production_rework_requests WHERE id=NEW.rework_request_id FOR SHARE;
  IF source.id IS NULL OR source.status<>'SUBMITTED' OR NEW.version_no IS DISTINCT FROM source.version OR NEW.nonconformance_id IS DISTINCT FROM source.nonconformance_id OR NEW.target_snapshot_operation_id IS DISTINCT FROM source.target_snapshot_operation_id OR NEW.target_sequence_no IS DISTINCT FROM source.target_sequence_no OR NEW.target_operation_code IS DISTINCT FROM source.target_operation_code OR NEW.target_operation_name IS DISTINCT FROM source.target_operation_name OR NEW.target_work_center_id IS DISTINCT FROM source.target_work_center_id OR NEW.target_work_center_code IS DISTINCT FROM source.target_work_center_code OR NEW.target_work_center_name IS DISTINCT FROM source.target_work_center_name OR NEW.target_description IS DISTINCT FROM source.target_description OR NEW.quantity IS DISTINCT FROM source.quantity OR NEW.reason IS DISTINCT FROM source.reason OR NEW.canonical_digest IS DISTINCT FROM source.canonical_digest OR NEW.submitted_by IS DISTINCT FROM source.submitted_by OR NEW.request_id IS DISTINCT FROM source.submitted_request_id THEN RAISE EXCEPTION 'rework submitted snapshot mismatch' USING ERRCODE='23514',CONSTRAINT='production_rework_request_versions_source_match_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "production_rework_request_versions_guard" BEFORE INSERT OR UPDATE OR DELETE ON "production_rework_request_versions" FOR EACH ROW EXECUTE FUNCTION cyd_rework_request_version_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_nonconformance_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('cyd.nonconformance_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'NCR facts require service' USING ERRCODE='42501'; END IF; IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'NCR facts are immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER "production_nonconformance_events_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "production_nonconformance_events" FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER "production_rework_request_events_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "production_rework_request_events" FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER "production_scrap_dispositions_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "production_scrap_dispositions" FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_append_only_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_nonconformance_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint; ncr record; active_qty numeric(24,6); scrap_qty numeric(24,6); active_requests bigint; pending_requests bigint; accepted_requests bigint; invalid_allocations bigint; invalid_scraps bigint; invalid_versions bigint;
BEGIN
  IF TG_TABLE_NAME='production_nonconformances' THEN target_id:=coalesce(NEW.id,OLD.id); ELSE target_id:=coalesce(NEW.nonconformance_id,OLD.nonconformance_id); END IF;
  SELECT * INTO ncr FROM production_nonconformances WHERE id=target_id; IF ncr.id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum(quantity) filter(where allocation_type='REWORK' and status='ACTIVE'),0),coalesce(sum(quantity) filter(where allocation_type='SCRAP' and status='FINAL'),0) INTO active_qty,scrap_qty FROM production_nonconformance_allocations WHERE nonconformance_id=target_id;
  SELECT count(*) filter(where status in ('DRAFT','SUBMITTED','ACCEPTED')),count(*) filter(where status='SUBMITTED'),count(*) filter(where status='ACCEPTED') INTO active_requests,pending_requests,accepted_requests FROM production_rework_requests WHERE nonconformance_id=target_id;
  SELECT count(*) INTO invalid_allocations FROM production_nonconformance_allocations a JOIN production_rework_requests r ON r.id=a.rework_request_id WHERE a.nonconformance_id=target_id AND ((r.status in ('DRAFT','SUBMITTED','ACCEPTED') and a.status<>'ACTIVE') or (r.status in ('RETURNED','CANCELLED') and a.status<>'RELEASED'));
  SELECT count(*) INTO invalid_scraps FROM production_scrap_dispositions d LEFT JOIN production_nonconformance_allocations a ON a.scrap_disposition_id=d.id AND a.allocation_type='SCRAP' AND a.status='FINAL' AND a.nonconformance_id=d.nonconformance_id AND a.quantity=d.quantity WHERE d.nonconformance_id=target_id AND a.id IS NULL;
  SELECT count(*) INTO invalid_versions FROM production_rework_requests r LEFT JOIN production_rework_request_versions v ON v.rework_request_id=r.id WHERE r.nonconformance_id=target_id AND ((r.status in ('SUBMITTED','ACCEPTED','RETURNED') AND (v.id IS NULL OR v.canonical_digest IS DISTINCT FROM r.canonical_digest OR v.quantity IS DISTINCT FROM r.quantity OR v.target_snapshot_operation_id IS DISTINCT FROM r.target_snapshot_operation_id)) OR (r.status='DRAFT' AND v.id IS NOT NULL));
  IF ncr.active_rework_qty<>active_qty OR ncr.final_scrap_qty<>scrap_qty OR ncr.unresolved_qty<>ncr.failed_qty-active_qty-scrap_qty OR ncr.unresolved_qty<0 OR invalid_allocations>0 OR invalid_scraps>0 OR invalid_versions>0 THEN RAISE EXCEPTION 'NCR quantity projection mismatch' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_conservation_ck'; END IF;
  IF ncr.status='CANCELLED' AND (active_qty<>0 OR scrap_qty<>0 OR active_requests<>0) THEN RAISE EXCEPTION 'cancelled NCR has active disposition' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_status_projection_ck'; END IF;
  IF ncr.status<>'CANCELLED' AND ((pending_requests>0 AND ncr.status<>'REWORK_PENDING') OR (pending_requests=0 AND accepted_requests>0 AND ncr.status<>'REWORK_ACCEPTED') OR (pending_requests=0 AND accepted_requests=0 AND ncr.unresolved_qty=0 AND ncr.status<>'DISPOSED') OR (pending_requests=0 AND accepted_requests=0 AND ncr.unresolved_qty>0 AND ncr.status<>'OPEN')) THEN RAISE EXCEPTION 'NCR status projection mismatch' USING ERRCODE='23514',CONSTRAINT='production_nonconformances_status_projection_ck'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_nonconformances_conservation_ck" AFTER INSERT OR UPDATE OR DELETE ON "production_nonconformances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_nonconformance_allocations_conservation_ck" AFTER INSERT OR UPDATE OR DELETE ON "production_nonconformance_allocations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_rework_requests_conservation_ck" AFTER INSERT OR UPDATE OR DELETE ON "production_rework_requests" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_rework_request_versions_conservation_ck" AFTER INSERT OR UPDATE OR DELETE ON "production_rework_request_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "production_scrap_dispositions_conservation_ck" AFTER INSERT OR UPDATE OR DELETE ON "production_scrap_dispositions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_nonconformance_consistency_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_quality_ncr_reopen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ncr_status text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.lifecycle_status='CLOSED' AND NEW.lifecycle_status='OPEN' THEN
    SELECT status INTO ncr_status FROM production_nonconformances WHERE inspection_id=OLD.id;
    IF ncr_status IS NOT NULL AND ncr_status<>'CANCELLED' THEN RAISE EXCEPTION 'inspection NCR must be safely cancelled before reopen' USING ERRCODE='23514',CONSTRAINT='quality_inspection_ncr_reopen_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "quality_inspections_ncr_reopen_guard" BEFORE UPDATE ON "quality_inspections" FOR EACH ROW EXECUTE FUNCTION cyd_quality_ncr_reopen_guard();
