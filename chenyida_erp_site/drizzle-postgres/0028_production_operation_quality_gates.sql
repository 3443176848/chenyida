ALTER TABLE "production_routing_operations" ADD COLUMN "quality_gate_mode" text DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_routing_operations" ADD CONSTRAINT "production_routing_operations_quality_gate_ck" CHECK ("quality_gate_mode" in ('NONE','IPQC'));
--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshot_operations" ADD COLUMN "quality_gate_mode" text DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_work_order_routing_snapshot_operations" ADD CONSTRAINT "production_work_order_routing_snapshot_operations_quality_gate_ck" CHECK ("quality_gate_mode" in ('NONE','IPQC'));
--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "production_operation_run_report_id" bigint;
--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_operation_run_report_id_fk" FOREIGN KEY ("production_operation_run_report_id") REFERENCES "public"."production_operation_run_reports"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "quality_inspections_operation_run_report_idx" ON "quality_inspections" ("production_operation_run_report_id","id");
--> statement-breakpoint
CREATE INDEX "quality_inspections_operation_run_report_release_idx" ON "quality_inspections" ("production_operation_run_report_id","lifecycle_status","decision_status","id") WHERE "production_operation_run_report_id" is not null;
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD COLUMN "quality_required_qty" numeric(24,6) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD COLUMN "quality_inspected_qty" numeric(24,6) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD COLUMN "quality_released_qty" numeric(24,6) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD COLUMN "quality_hold_qty" numeric(24,6) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quality_inspections" DROP CONSTRAINT "quality_inspections_type_source_ck";
--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_type_source_ck" CHECK (
  ("inspection_type"='IQC' and "purchase_receipt_line_id" is not null and "production_report_id" is null and "production_operation_run_report_id" is null and "production_completion_line_id" is null and "sales_order_line_id" is null and "fqc_allocation_id" is null)
  or ("inspection_type"='IPQC' and "purchase_receipt_line_id" is null and (("production_report_id" is not null)::integer+("production_operation_run_report_id" is not null)::integer)=1 and "production_completion_line_id" is null and "sales_order_line_id" is null and "fqc_allocation_id" is null)
  or ("inspection_type"='FQC' and "purchase_receipt_line_id" is null and "production_report_id" is null and "production_operation_run_report_id" is null and "production_completion_line_id" is not null and "sales_order_line_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" DROP CONSTRAINT "production_operation_wip_projections_quantity_ck";
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" DROP CONSTRAINT "production_operation_wip_projections_balance_ck";
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD CONSTRAINT "production_operation_wip_projections_quantity_ck" CHECK (
  "source_input_qty">=0 and "waiting_input_qty">=0 and "dispatched_qty">=0 and "in_progress_qty">=0 and "completed_good_qty">=0 and "scrap_qty">=0 and "transferred_to_next_qty">=0 and "available_for_next_qty">=0 and "final_output_available_qty">=0
  and "quality_required_qty">=0 and "quality_inspected_qty">=0 and "quality_released_qty">=0 and "quality_hold_qty">=0 and "version">0
);
--> statement-breakpoint
ALTER TABLE "production_operation_wip_projections" ADD CONSTRAINT "production_operation_wip_projections_balance_ck" CHECK (
  "waiting_input_qty"+"dispatched_qty"="source_input_qty"
  and "quality_inspected_qty"<="quality_required_qty"
  and "quality_released_qty"<="quality_inspected_qty"
  and "quality_hold_qty"="quality_required_qty"-"quality_released_qty"
  and "transferred_to_next_qty"+"available_for_next_qty"<=case when "quality_required_qty">0 then "quality_released_qty" else "completed_good_qty" end
  and "final_output_available_qty"<=case when "quality_required_qty">0 then "quality_released_qty" else "completed_good_qty" end
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_work_order_routing_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record; snapshot_row record;
BEGIN
  IF current_setting('cyd.production_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'work order routing snapshots require ProductionService'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'work order routing snapshots are immutable'; END IF;
  IF TG_TABLE_NAME='production_work_order_routing_snapshots' THEN
    SELECT rv.*,rh.routing_code,wo.product_version_id work_order_product_version_id INTO source_row
      FROM production_routing_versions rv JOIN production_routing_headers rh ON rh.id=rv.routing_header_id JOIN production_work_orders wo ON wo.id=NEW.work_order_id
      WHERE rv.id=NEW.routing_version_id AND rv.status='RELEASED';
    IF source_row.id IS NULL OR NEW.routing_header_id IS DISTINCT FROM source_row.routing_header_id OR NEW.product_version_id IS DISTINCT FROM source_row.product_version_id OR NEW.product_version_id IS DISTINCT FROM source_row.work_order_product_version_id OR NEW.routing_code IS DISTINCT FROM source_row.routing_code OR NEW.routing_version_no IS DISTINCT FROM source_row.version_no OR NEW.routing_version_code IS DISTINCT FROM source_row.version_code OR NEW.routing_digest IS DISTINCT FROM source_row.canonical_digest THEN RAISE EXCEPTION 'work order routing snapshot source mismatch'; END IF;
    RETURN NEW;
  END IF;
  SELECT s.*,o.sequence_no source_sequence_no,o.operation_code source_operation_code,o.operation_name source_operation_name,o.work_center_id source_work_center_id,o.setup_minutes source_setup_minutes,o.run_minutes_per_unit source_run_minutes,o.description source_description,o.quality_gate_mode source_quality_gate_mode,w.work_center_code source_work_center_code,w.name_cn source_work_center_name INTO snapshot_row
    FROM production_work_order_routing_snapshots s JOIN production_routing_operations o ON o.id=NEW.source_routing_operation_id AND o.routing_version_id=s.routing_version_id JOIN production_work_centers w ON w.id=o.work_center_id WHERE s.id=NEW.snapshot_id;
  IF snapshot_row.id IS NULL OR NEW.sequence_no IS DISTINCT FROM snapshot_row.source_sequence_no OR NEW.operation_code IS DISTINCT FROM snapshot_row.source_operation_code OR NEW.operation_name IS DISTINCT FROM snapshot_row.source_operation_name OR NEW.work_center_id IS DISTINCT FROM snapshot_row.source_work_center_id OR NEW.work_center_code IS DISTINCT FROM snapshot_row.source_work_center_code OR NEW.work_center_name IS DISTINCT FROM snapshot_row.source_work_center_name OR NEW.setup_minutes IS DISTINCT FROM snapshot_row.source_setup_minutes OR NEW.run_minutes_per_unit IS DISTINCT FROM snapshot_row.source_run_minutes OR NEW.description IS DISTINCT FROM snapshot_row.source_description OR NEW.quality_gate_mode IS DISTINCT FROM snapshot_row.source_quality_gate_mode THEN RAISE EXCEPTION 'work order routing snapshot operation mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_quality_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_material_id bigint; source_unit_id bigint; stable_completion_line_id bigint; stable_order_line_id bigint; gate_mode text;
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality writes require quality service' USING ERRCODE='42501'; END IF;
  IF NEW.inspection_type='IQC' THEN
    SELECT prl.material_id,prl.unit_id INTO source_material_id,source_unit_id FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.purchase_receipt_id AND pr.receipt_type='RECEIPT' WHERE prl.id=NEW.purchase_receipt_line_id AND NOT EXISTS(SELECT 1 FROM purchase_receipts rr WHERE rr.reversal_of_receipt_id=pr.id);
  ELSIF NEW.inspection_type='IPQC' AND NEW.production_operation_run_report_id IS NOT NULL THEN
    SELECT wo.finished_material_id,wo.finished_unit_id,op.quality_gate_mode INTO source_material_id,source_unit_id,gate_mode
      FROM production_operation_run_reports rr JOIN production_operation_runs run ON run.id=rr.run_id
      JOIN production_work_order_routing_snapshot_operations op ON op.id=rr.snapshot_operation_id AND op.id=run.snapshot_operation_id
      JOIN production_work_order_routing_snapshots s ON s.id=op.snapshot_id AND s.work_order_id=run.work_order_id
      JOIN production_work_orders wo ON wo.id=run.work_order_id
      WHERE rr.id=NEW.production_operation_run_report_id AND run.status NOT IN ('CANCELLED','REVERSED') AND rr.good_qty>0 FOR SHARE OF rr,run,op,s,wo;
    IF gate_mode IS DISTINCT FROM 'IPQC' THEN RAISE EXCEPTION 'operation report is not an IPQC-gated source' USING ERRCODE='23514',CONSTRAINT='quality_inspections_operation_gate_ck'; END IF;
  ELSIF NEW.inspection_type='IPQC' THEN
    SELECT wo.finished_material_id,wo.finished_unit_id INTO source_material_id,source_unit_id FROM production_reports r JOIN production_report_receipt_projections rp ON rp.report_id=r.id AND NOT rp.reversed JOIN production_work_orders wo ON wo.id=r.work_order_id WHERE r.id=NEW.production_report_id;
  ELSE
    SELECT pcl.material_id,pcl.unit_id,a.completion_line_id,a.sales_order_line_id INTO source_material_id,source_unit_id,stable_completion_line_id,stable_order_line_id
      FROM finished_goods_sales_allocations a JOIN production_completion_lines pcl ON pcl.id=a.completion_line_id
      JOIN production_completions pc ON pc.id=pcl.completion_id JOIN production_completion_receipt_projections cp ON cp.completion_id=pc.id AND NOT cp.reversed
      JOIN sales_order_lines sol ON sol.id=a.sales_order_line_id AND sol.finished_material_id=pcl.material_id AND sol.unit_id=pcl.unit_id
      JOIN sales_order_versions sov ON sov.id=sol.sales_order_version_id JOIN sales_orders so ON so.id=sov.sales_order_id AND so.current_version_no=sov.version_no AND so.status IN ('OPEN','PARTIALLY_SHIPPED')
      WHERE a.id=NEW.fqc_allocation_id AND a.status='ACTIVE';
    IF stable_completion_line_id IS DISTINCT FROM NEW.production_completion_line_id OR stable_order_line_id IS DISTINCT FROM NEW.sales_order_line_id THEN RAISE EXCEPTION 'FQC must use stable active allocation' USING ERRCODE='23514',CONSTRAINT='quality_inspections_fqc_allocation_ck'; END IF;
  END IF;
  IF source_material_id IS NULL OR source_material_id IS DISTINCT FROM NEW.material_id OR source_unit_id IS DISTINCT FROM NEW.unit_id THEN RAISE EXCEPTION 'quality source material or unit mismatch' USING ERRCODE='23514',CONSTRAINT='quality_inspections_source_match_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_quality_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE consumed numeric(24,6);
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality projection writes require quality service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'quality inspections cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.production_operation_run_report_id IS NOT NULL AND NEW.released_qty>NEW.passed_qty THEN RAISE EXCEPTION 'operation IPQC release exceeds passed quantity' USING ERRCODE='23514',CONSTRAINT='quality_operation_release_passed_ck'; END IF;
  IF TG_OP='UPDATE' AND (NEW.inspection_code IS DISTINCT FROM OLD.inspection_code OR NEW.inspection_type IS DISTINCT FROM OLD.inspection_type OR NEW.purchase_receipt_line_id IS DISTINCT FROM OLD.purchase_receipt_line_id OR NEW.production_report_id IS DISTINCT FROM OLD.production_report_id OR NEW.production_operation_run_report_id IS DISTINCT FROM OLD.production_operation_run_report_id OR NEW.production_completion_line_id IS DISTINCT FROM OLD.production_completion_line_id OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id OR NEW.fqc_allocation_id IS DISTINCT FROM OLD.fqc_allocation_id OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.inspected_qty IS DISTINCT FROM OLD.inspected_qty OR NEW.passed_qty IS DISTINCT FROM OLD.passed_qty OR NEW.failed_qty IS DISTINCT FROM OLD.failed_qty OR NEW.inspection_date IS DISTINCT FROM OLD.inspection_date OR NEW.responsible_stage IS DISTINCT FROM OLD.responsible_stage OR NEW.remark IS DISTINCT FROM OLD.remark OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'quality inspection facts are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD.production_operation_run_report_id IS NOT NULL AND OLD.lifecycle_status='CLOSED' AND OLD.decision_status='RELEASED' AND (NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status OR NEW.decision_status IS DISTINCT FROM OLD.decision_status OR NEW.released_qty<OLD.released_qty) THEN
    SELECT coalesce(sum(a.quantity),0) INTO consumed FROM production_operation_run_input_allocations a
      JOIN production_operation_runs source ON source.id=a.source_run_id JOIN production_operation_run_reports rr ON rr.run_id=source.id
      JOIN production_operation_runs target ON target.id=a.run_id
      WHERE rr.id=OLD.production_operation_run_report_id AND target.status NOT IN ('CANCELLED','REVERSED');
    consumed := consumed + coalesce((SELECT sum(a.quantity) FROM production_report_operation_allocations a JOIN production_report_receipt_projections rp ON rp.report_id=a.production_report_id WHERE a.operation_run_report_id=OLD.production_operation_run_report_id AND NOT rp.reversed),0);
    IF consumed>0 THEN RAISE EXCEPTION 'released operation IPQC has downstream consumption' USING ERRCODE='23514',CONSTRAINT='quality_operation_release_consumption_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_quality_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint; failed numeric(24,6); decision text; defect_count bigint; fail_result_count bigint; source_report_id bigint; source_good numeric(24,6); inspected_total numeric(24,6); released_total numeric(24,6); passed_total numeric(24,6);
BEGIN
  IF TG_TABLE_NAME='quality_inspections' THEN target_id := NEW.id; ELSE target_id := NEW.inspection_id; END IF;
  SELECT failed_qty,decision_status,production_operation_run_report_id INTO failed,decision,source_report_id FROM quality_inspections WHERE id=target_id;
  IF failed IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO defect_count FROM quality_defects WHERE inspection_id=target_id;
  SELECT count(*) INTO fail_result_count FROM quality_inspection_results WHERE inspection_id=target_id AND result='FAIL';
  IF failed>0 AND (fail_result_count=0 OR defect_count=0) THEN RAISE EXCEPTION 'failed inspection requires fail result and defect' USING ERRCODE='23514',CONSTRAINT='quality_inspections_failed_evidence_ck'; END IF;
  IF failed=0 AND (defect_count>0 OR fail_result_count>0) THEN RAISE EXCEPTION 'passing inspection cannot contain failed evidence' USING ERRCODE='23514',CONSTRAINT='quality_inspections_failed_evidence_ck'; END IF;
  IF source_report_id IS NOT NULL THEN
    SELECT good_qty INTO source_good FROM production_operation_run_reports WHERE id=source_report_id;
    SELECT coalesce(sum(inspected_qty),0),coalesce(sum(passed_qty),0),coalesce(sum(released_qty) filter(where lifecycle_status='CLOSED' and decision_status='RELEASED'),0) INTO inspected_total,passed_total,released_total FROM quality_inspections WHERE production_operation_run_report_id=source_report_id;
    IF source_good IS NULL OR inspected_total>source_good THEN RAISE EXCEPTION 'operation IPQC inspected quantity exceeds source good' USING ERRCODE='23514',CONSTRAINT='quality_operation_inspected_capacity_ck'; END IF;
    IF released_total>passed_total OR released_total>source_good THEN RAISE EXCEPTION 'operation IPQC released quantity exceeds passed or source good' USING ERRCODE='23514',CONSTRAINT='quality_operation_released_capacity_ck'; END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_production_operation_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record; source record; consumed numeric; capacity numeric;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'operation input allocation is immutable' USING ERRCODE='23514',CONSTRAINT='production_operation_allocations_immutable_ck'; END IF;
  SELECT r.*,p.previous_snapshot_operation_id INTO target FROM production_operation_runs r JOIN production_work_order_operation_projections p ON p.snapshot_operation_id=r.snapshot_operation_id WHERE r.id=NEW.run_id;
  SELECT r.*,op.quality_gate_mode INTO source FROM production_operation_runs r JOIN production_work_order_routing_snapshot_operations op ON op.id=r.snapshot_operation_id WHERE r.id=NEW.source_run_id FOR UPDATE OF r,op;
  IF target.id IS NULL OR source.id IS NULL OR target.previous_snapshot_operation_id IS DISTINCT FROM source.snapshot_operation_id OR target.work_order_id<>source.work_order_id OR target.status IN ('CANCELLED','REVERSED') OR source.status IN ('CANCELLED','REVERSED') THEN RAISE EXCEPTION 'invalid linear upstream allocation' USING ERRCODE='23514',CONSTRAINT='production_operation_allocations_lineage_ck'; END IF;
  SELECT coalesce(sum(a.quantity),0) INTO consumed FROM production_operation_run_input_allocations a JOIN production_operation_runs r ON r.id=a.run_id WHERE a.source_run_id=NEW.source_run_id AND r.status NOT IN ('CANCELLED','REVERSED');
  IF source.quality_gate_mode='IPQC' THEN SELECT coalesce(sum(q.released_qty),0) INTO capacity FROM quality_inspections q JOIN production_operation_run_reports rr ON rr.id=q.production_operation_run_report_id WHERE rr.run_id=NEW.source_run_id AND q.lifecycle_status='CLOSED' AND q.decision_status='RELEASED'; ELSE capacity:=source.good_qty; END IF;
  IF consumed+NEW.quantity>capacity THEN RAISE EXCEPTION 'upstream quality-released quantity over-consumed' USING ERRCODE='23514',CONSTRAINT='production_operation_allocations_quantity_gate_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_production_final_output_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record; source record; last_operation_id bigint; consumed numeric(24,6); capacity numeric(24,6);
BEGIN
  IF current_setting('cyd.production_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production final output allocation requires service transaction' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'production final output allocations are immutable' USING ERRCODE='23514',CONSTRAINT='production_report_operation_allocations_immutable_ck'; END IF;
  SELECT r.work_order_id,p.reversed INTO target FROM production_reports r JOIN production_report_receipt_projections p ON p.report_id=r.id WHERE r.id=NEW.production_report_id FOR UPDATE OF r,p;
  SELECT rr.id,rr.good_qty,rr.snapshot_operation_id,run.work_order_id,run.status,op.quality_gate_mode INTO source FROM production_operation_run_reports rr JOIN production_operation_runs run ON run.id=rr.run_id JOIN production_work_order_routing_snapshot_operations op ON op.id=rr.snapshot_operation_id WHERE rr.id=NEW.operation_run_report_id FOR UPDATE OF rr,run,op;
  SELECT p.snapshot_operation_id INTO last_operation_id FROM production_work_order_operation_projections p WHERE p.work_order_id=target.work_order_id AND p.next_snapshot_operation_id IS NULL;
  IF target.work_order_id IS NULL OR target.reversed OR source.id IS NULL OR source.status IN ('CANCELLED','REVERSED') OR source.good_qty<=0 OR source.work_order_id IS DISTINCT FROM target.work_order_id OR source.snapshot_operation_id IS DISTINCT FROM last_operation_id OR NEW.snapshot_operation_id IS DISTINCT FROM last_operation_id THEN RAISE EXCEPTION 'invalid final output allocation lineage' USING ERRCODE='23514',CONSTRAINT='production_report_operation_allocations_lineage_ck'; END IF;
  SELECT coalesce(sum(a.quantity),0) INTO consumed FROM production_report_operation_allocations a JOIN production_report_receipt_projections p ON p.report_id=a.production_report_id WHERE a.operation_run_report_id=NEW.operation_run_report_id AND NOT p.reversed;
  IF source.quality_gate_mode='IPQC' THEN SELECT coalesce(sum(q.released_qty),0) INTO capacity FROM quality_inspections q WHERE q.production_operation_run_report_id=NEW.operation_run_report_id AND q.lifecycle_status='CLOSED' AND q.decision_status='RELEASED'; ELSE capacity:=source.good_qty; END IF;
  IF consumed+NEW.quantity>capacity THEN RAISE EXCEPTION 'final operation quality-released quantity over-consumed' USING ERRCODE='23514',CONSTRAINT='production_report_operation_allocations_quantity_gate_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_production_operation_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run record;
BEGIN
  IF current_setting('cyd.production_operation_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production operation records are service-managed' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'operation reversal is immutable' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_immutable_ck'; END IF;
  SELECT r.*,p.next_snapshot_operation_id INTO run FROM production_operation_runs r JOIN production_work_order_operation_projections p ON p.snapshot_operation_id=r.snapshot_operation_id WHERE r.id=NEW.run_id FOR UPDATE;
  IF run.id IS NULL OR run.status NOT IN ('IN_PROGRESS','COMPLETED') OR run.processed_qty<=0 OR ROW(NEW.processed_qty,NEW.good_qty,NEW.scrap_qty) IS DISTINCT FROM ROW(run.processed_qty,run.good_qty,run.scrap_qty) THEN RAISE EXCEPTION 'run is not reversable' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_run_ck'; END IF;
  IF EXISTS(SELECT 1 FROM production_operation_run_input_allocations a JOIN production_operation_runs t ON t.id=a.run_id WHERE a.source_run_id=NEW.run_id AND t.status NOT IN ('CANCELLED','REVERSED')) THEN RAISE EXCEPTION 'run output has downstream consumption' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_downstream_ck'; END IF;
  IF run.next_snapshot_operation_id IS NULL AND EXISTS(SELECT 1 FROM production_reports r LEFT JOIN production_report_reversals x ON x.report_id=r.id WHERE r.work_order_id=run.work_order_id AND x.id IS NULL) THEN RAISE EXCEPTION 'final output has production report consumption' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_downstream_ck'; END IF;
  IF EXISTS(SELECT 1 FROM quality_inspections q JOIN production_operation_run_reports rr ON rr.id=q.production_operation_run_report_id WHERE rr.run_id=NEW.run_id) OR EXISTS(SELECT 1 FROM quality_inspections q JOIN production_reports r ON r.id=q.production_report_id WHERE r.work_order_id=run.work_order_id) THEN RAISE EXCEPTION 'quality downstream exists' USING ERRCODE='23514',CONSTRAINT='production_operation_reversals_downstream_ck'; END IF;
  RETURN NEW;
END $$;
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
    SELECT coalesce(sum(dispatched_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) dispatched,coalesce(sum(processed_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) processed,coalesce(sum(good_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) good,coalesce(sum(scrap_qty) filter(where status NOT IN ('CANCELLED','REVERSED')),0) scrap,coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0) in_progress,coalesce(bool_or(status='READY'),false) has_ready,coalesce(bool_or(status='IN_PROGRESS'),false) has_active FROM production_operation_runs WHERE snapshot_operation_id=target_snapshot_operation_id
  ), quality AS (
    SELECT coalesce(sum(q.inspected_qty),0) inspected,coalesce(sum(q.released_qty) filter(where q.lifecycle_status='CLOSED' and q.decision_status='RELEASED'),0) released FROM quality_inspections q JOIN production_operation_run_reports rr ON rr.id=q.production_operation_run_report_id JOIN production_operation_runs run ON run.id=rr.run_id WHERE run.snapshot_operation_id=target_snapshot_operation_id AND run.status NOT IN ('CANCELLED','REVERSED')
  ), transfer AS (
    SELECT coalesce(sum(a.quantity),0) qty FROM production_operation_run_input_allocations a JOIN production_operation_runs s ON s.id=a.source_run_id JOIN production_operation_runs t ON t.id=a.run_id WHERE s.snapshot_operation_id=target_snapshot_operation_id AND s.status NOT IN ('CANCELLED','REVERSED') AND t.status NOT IN ('CANCELLED','REVERSED')
  ), final_report AS (
    SELECT coalesce(sum(a.quantity),0) qty FROM production_report_operation_allocations a JOIN production_report_receipt_projections p ON p.report_id=a.production_report_id WHERE a.snapshot_operation_id=target_snapshot_operation_id AND NOT p.reversed
  ) SELECT source.qty source_qty,(source.qty-facts.dispatched) waiting,facts.dispatched,facts.processed,facts.good,facts.scrap,facts.in_progress,transfer.qty transferred,
    CASE WHEN actual.quality_gate_mode='IPQC' THEN facts.good ELSE 0 END quality_required,CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.inspected ELSE 0 END quality_inspected,CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.released ELSE 0 END quality_released,CASE WHEN actual.quality_gate_mode='IPQC' THEN facts.good-quality.released ELSE 0 END quality_hold,
    (CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.released ELSE facts.good END-transfer.qty) available,
    CASE WHEN actual.next_snapshot_operation_id IS NULL THEN CASE WHEN actual.quality_gate_mode='IPQC' THEN quality.released ELSE facts.good END-transfer.qty-final_report.qty ELSE 0 END final_output,
    CASE WHEN actual.work_order_status='CANCELLED' THEN 'CANCELLED' WHEN facts.processed>=actual.target_qty THEN 'COMPLETED' WHEN facts.has_active THEN 'IN_PROGRESS' WHEN source.qty-facts.dispatched>0 OR facts.has_ready THEN 'READY' ELSE 'WAITING' END status
  INTO expected FROM source,facts,quality,transfer,final_report;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND r.status NOT IN ('CANCELLED','REVERSED') AND ((actual.previous_snapshot_operation_id IS NULL AND EXISTS(SELECT 1 FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)) OR (actual.previous_snapshot_operation_id IS NOT NULL AND (SELECT coalesce(sum(a.quantity),0) FROM production_operation_run_input_allocations a WHERE a.run_id=r.id)<>r.dispatched_qty))) INTO invalid_run;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND ROW(r.processed_qty,r.good_qty,r.scrap_qty) IS DISTINCT FROM (SELECT ROW(coalesce(sum(x.processed_qty),0),coalesce(sum(x.good_qty),0),coalesce(sum(x.scrap_qty),0)) FROM production_operation_run_reports x WHERE x.run_id=r.id)) INTO invalid_reports;
  SELECT EXISTS(SELECT 1 FROM production_operation_runs r WHERE r.snapshot_operation_id=target_snapshot_operation_id AND (NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='DISPATCHED') OR (r.started_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='STARTED')) OR (r.status='REVERSED' AND NOT EXISTS(SELECT 1 FROM production_operation_run_events e WHERE e.run_id=r.id AND e.event_type='REVERSED')))) INTO invalid_events;
  IF expected.waiting<0 OR expected.available<0 OR expected.final_output<0 OR expected.quality_hold<0 OR expected.quality_inspected>expected.quality_required OR expected.quality_released>expected.quality_inspected OR invalid_run OR invalid_reports OR invalid_events OR actual.status<>expected.status OR NOT EXISTS(
    SELECT 1 FROM production_operation_wip_projections w WHERE w.operation_projection_id=actual.id AND w.snapshot_operation_id=target_snapshot_operation_id AND ROW(w.source_input_qty,w.waiting_input_qty,w.dispatched_qty,w.in_progress_qty,w.completed_good_qty,w.scrap_qty,w.transferred_to_next_qty,w.available_for_next_qty,w.final_output_available_qty,w.quality_required_qty,w.quality_inspected_qty,w.quality_released_qty,w.quality_hold_qty)=ROW(expected.source_qty,expected.waiting,expected.dispatched,expected.in_progress,expected.good,expected.scrap,expected.transferred,expected.available,expected.final_output,expected.quality_required,expected.quality_inspected,expected.quality_released,expected.quality_hold)
  ) THEN RAISE EXCEPTION 'operation quality projection does not reconcile with immutable facts' USING ERRCODE='23514',CONSTRAINT='production_operation_projection_reconciliation_ck'; END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_quality_operation_deferred_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_report_id bigint; snapshot_id bigint; next_snapshot_id bigint;
BEGIN
  source_report_id:=coalesce(NEW.production_operation_run_report_id,OLD.production_operation_run_report_id);
  IF source_report_id IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
  SELECT rr.snapshot_operation_id,p.next_snapshot_operation_id INTO snapshot_id,next_snapshot_id FROM production_operation_run_reports rr LEFT JOIN production_work_order_operation_projections p ON p.snapshot_operation_id=rr.snapshot_operation_id WHERE rr.id=source_report_id;
  IF snapshot_id IS NOT NULL THEN PERFORM cyd_validate_production_operation_projection(snapshot_id); END IF;
  IF next_snapshot_id IS NOT NULL THEN PERFORM cyd_validate_production_operation_projection(next_snapshot_id); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER quality_operation_projection_reconcile AFTER INSERT OR UPDATE ON quality_inspections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_quality_operation_deferred_validate();
