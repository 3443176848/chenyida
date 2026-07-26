CREATE TABLE "finished_goods_sales_allocation_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"allocation_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finished_goods_sales_allocation_events_type_ck" CHECK ("finished_goods_sales_allocation_events"."event_type" in ('CREATED','CANCELLED')),
	CONSTRAINT "finished_goods_sales_allocation_events_quantity_ck" CHECK ("finished_goods_sales_allocation_events"."quantity">0),
	CONSTRAINT "finished_goods_sales_allocation_events_reason_ck" CHECK (("finished_goods_sales_allocation_events"."event_type"='CREATED' and "finished_goods_sales_allocation_events"."reason"='') or ("finished_goods_sales_allocation_events"."event_type"='CANCELLED' and char_length(btrim("finished_goods_sales_allocation_events"."reason")) between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "finished_goods_sales_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"completion_line_id" bigint NOT NULL,
	"sales_order_line_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"cancelled_by" text,
	"cancelled_request_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finished_goods_sales_allocations_quantity_ck" CHECK ("finished_goods_sales_allocations"."quantity">0),
	CONSTRAINT "finished_goods_sales_allocations_status_ck" CHECK ("finished_goods_sales_allocations"."status" in ('ACTIVE','CANCELLED')),
	CONSTRAINT "finished_goods_sales_allocations_version_ck" CHECK ("finished_goods_sales_allocations"."version">0),
	CONSTRAINT "finished_goods_sales_allocations_cancel_ck" CHECK (("finished_goods_sales_allocations"."status"='ACTIVE' and "finished_goods_sales_allocations"."cancelled_by" is null and "finished_goods_sales_allocations"."cancelled_request_id" is null and "finished_goods_sales_allocations"."cancelled_at" is null and "finished_goods_sales_allocations"."cancel_reason"='') or ("finished_goods_sales_allocations"."status"='CANCELLED' and "finished_goods_sales_allocations"."cancelled_by" is not null and "finished_goods_sales_allocations"."cancelled_request_id" is not null and "finished_goods_sales_allocations"."cancelled_at" is not null and char_length(btrim("finished_goods_sales_allocations"."cancel_reason")) between 1 and 1000))
);
--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "fqc_allocation_id" bigint;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocation_events" ADD CONSTRAINT "finished_goods_sales_allocation_events_allocation_id_finished_goods_sales_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."finished_goods_sales_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocation_events" ADD CONSTRAINT "finished_goods_sales_allocation_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocations" ADD CONSTRAINT "finished_goods_sales_allocations_completion_line_id_production_completion_lines_id_fk" FOREIGN KEY ("completion_line_id") REFERENCES "public"."production_completion_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocations" ADD CONSTRAINT "finished_goods_sales_allocations_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocations" ADD CONSTRAINT "finished_goods_sales_allocations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocations" ADD CONSTRAINT "finished_goods_sales_allocations_cancelled_by_app_users_username_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finished_goods_sales_allocation_events_allocation_idx" ON "finished_goods_sales_allocation_events" USING btree ("allocation_id","id");--> statement-breakpoint
CREATE INDEX "finished_goods_sales_allocation_events_request_idx" ON "finished_goods_sales_allocation_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "finished_goods_sales_allocations_pair_uq" ON "finished_goods_sales_allocations" USING btree ("completion_line_id","sales_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finished_goods_sales_allocations_operation_uq" ON "finished_goods_sales_allocations" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "finished_goods_sales_allocations_completion_idx" ON "finished_goods_sales_allocations" USING btree ("completion_line_id","status","id");--> statement-breakpoint
CREATE INDEX "finished_goods_sales_allocations_order_line_idx" ON "finished_goods_sales_allocations" USING btree ("sales_order_line_id","status","id");--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_fqc_allocation_id_finished_goods_sales_allocations_id_fk" FOREIGN KEY ("fqc_allocation_id") REFERENCES "public"."finished_goods_sales_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quality_inspections_fqc_allocation_idx" ON "quality_inspections" USING btree ("fqc_allocation_id","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_finished_goods_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  completion_qty numeric(24,6); completion_used numeric(24,6); completion_reversed boolean;
  order_qty numeric(24,6); order_used numeric(24,6); order_status text;
  work_customer bigint; order_customer bigint; work_product bigint; order_product bigint;
  work_product_version bigint; order_product_version bigint; work_material bigint; order_material bigint;
  work_unit bigint; order_unit bigint;
BEGIN
  IF current_setting('cyd.quality_service_write',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'finished goods allocation requires quality service transaction' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'finished goods allocations cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'ACTIVE' OR NEW.status<>'CANCELLED' OR NEW.version<>OLD.version+1
      OR NEW.completion_line_id IS DISTINCT FROM OLD.completion_line_id OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id
      OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.cancelled_by IS NULL OR NEW.cancelled_request_id IS NULL OR NEW.cancelled_at IS NULL OR char_length(btrim(NEW.cancel_reason)) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'finished goods allocation facts are immutable' USING ERRCODE='55000';
    END IF;
    IF EXISTS(SELECT 1 FROM quality_inspections WHERE fqc_allocation_id=OLD.id) THEN
      RAISE EXCEPTION 'allocation already has FQC' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_fqc_gate_ck';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status<>'ACTIVE' OR NEW.version<>1 OR NEW.cancelled_by IS NOT NULL OR NEW.cancelled_request_id IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason<>'' THEN
    RAISE EXCEPTION 'new allocation state invalid' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_state_ck';
  END IF;

  PERFORM 1 FROM production_completion_lines pcl
    JOIN production_completions pc ON pc.id=pcl.completion_id
    JOIN production_completion_receipt_projections cp ON cp.completion_id=pc.id
    WHERE pcl.id=NEW.completion_line_id FOR UPDATE OF pcl,cp;
  SELECT pcl.quantity,cp.reversed,p.customer_id,wo.product_id,wo.product_version_id,wo.finished_material_id,wo.finished_unit_id
    INTO completion_qty,completion_reversed,work_customer,work_product,work_product_version,work_material,work_unit
    FROM production_completion_lines pcl
    JOIN production_completions pc ON pc.id=pcl.completion_id
    JOIN production_completion_receipt_projections cp ON cp.completion_id=pc.id
    JOIN production_work_orders wo ON wo.id=pc.work_order_id JOIN products p ON p.id=wo.product_id
    WHERE pcl.id=NEW.completion_line_id;
  PERFORM 1 FROM sales_order_lines sol JOIN sales_order_versions sov ON sov.id=sol.sales_order_version_id JOIN sales_orders so ON so.id=sov.sales_order_id
    WHERE sol.id=NEW.sales_order_line_id FOR UPDATE OF sol,so;
  SELECT sol.ordered_qty,so.status,so.customer_id,sol.product_id,sol.product_version_id,sol.finished_material_id,sol.unit_id
    INTO order_qty,order_status,order_customer,order_product,order_product_version,order_material,order_unit
    FROM sales_order_lines sol JOIN sales_order_versions sov ON sov.id=sol.sales_order_version_id
    JOIN sales_orders so ON so.id=sov.sales_order_id AND so.current_version_no=sov.version_no WHERE sol.id=NEW.sales_order_line_id;
  IF completion_qty IS NULL OR order_qty IS NULL OR completion_reversed OR order_status NOT IN ('OPEN','PARTIALLY_SHIPPED')
    OR work_customer IS DISTINCT FROM order_customer OR work_product IS DISTINCT FROM order_product OR work_product_version IS DISTINCT FROM order_product_version
    OR work_material IS DISTINCT FROM order_material OR work_unit IS DISTINCT FROM order_unit THEN
    RAISE EXCEPTION 'finished goods allocation source mismatch' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_source_match_ck';
  END IF;
  SELECT coalesce(sum(quantity),0) INTO completion_used FROM finished_goods_sales_allocations WHERE completion_line_id=NEW.completion_line_id AND status='ACTIVE';
  SELECT coalesce(sum(quantity),0) INTO order_used FROM finished_goods_sales_allocations WHERE sales_order_line_id=NEW.sales_order_line_id AND status='ACTIVE';
  IF completion_used+NEW.quantity>completion_qty THEN RAISE EXCEPTION 'completion allocation exceeded' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_completion_capacity_ck'; END IF;
  IF order_used+NEW.quantity>order_qty THEN RAISE EXCEPTION 'sales order allocation exceeded' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_order_capacity_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finished_goods_sales_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON finished_goods_sales_allocations FOR EACH ROW EXECUTE FUNCTION cyd_finished_goods_allocation_guard();
--> statement-breakpoint
CREATE TRIGGER finished_goods_sales_allocation_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON finished_goods_sales_allocation_events FOR EACH ROW EXECUTE FUNCTION cyd_quality_fact_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_material_id bigint; source_unit_id bigint; stable_completion_line_id bigint; stable_order_line_id bigint;
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality writes require quality service' USING ERRCODE='42501'; END IF;
  IF NEW.inspection_type='IQC' THEN
    IF NEW.fqc_allocation_id IS NOT NULL THEN RAISE EXCEPTION 'IQC cannot reference FQC allocation' USING ERRCODE='23514',CONSTRAINT='quality_inspections_source_match_ck'; END IF;
    SELECT prl.material_id,prl.unit_id INTO source_material_id,source_unit_id FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.purchase_receipt_id AND pr.receipt_type='RECEIPT' WHERE prl.id=NEW.purchase_receipt_line_id AND NOT EXISTS(SELECT 1 FROM purchase_receipts rr WHERE rr.reversal_of_receipt_id=pr.id);
  ELSIF NEW.inspection_type='IPQC' THEN
    IF NEW.fqc_allocation_id IS NOT NULL THEN RAISE EXCEPTION 'IPQC cannot reference FQC allocation' USING ERRCODE='23514',CONSTRAINT='quality_inspections_source_match_ck'; END IF;
    SELECT wo.finished_material_id,wo.finished_unit_id INTO source_material_id,source_unit_id FROM production_reports r JOIN production_report_receipt_projections rp ON rp.report_id=r.id AND NOT rp.reversed JOIN production_work_orders wo ON wo.id=r.work_order_id WHERE r.id=NEW.production_report_id;
  ELSE
    SELECT pcl.material_id,pcl.unit_id,a.completion_line_id,a.sales_order_line_id
      INTO source_material_id,source_unit_id,stable_completion_line_id,stable_order_line_id
      FROM finished_goods_sales_allocations a
      JOIN production_completion_lines pcl ON pcl.id=a.completion_line_id
      JOIN production_completions pc ON pc.id=pcl.completion_id
      JOIN production_completion_receipt_projections cp ON cp.completion_id=pc.id AND NOT cp.reversed
      JOIN sales_order_lines sol ON sol.id=a.sales_order_line_id AND sol.finished_material_id=pcl.material_id AND sol.unit_id=pcl.unit_id
      JOIN sales_order_versions sov ON sov.id=sol.sales_order_version_id
      JOIN sales_orders so ON so.id=sov.sales_order_id AND so.current_version_no=sov.version_no AND so.status IN ('OPEN','PARTIALLY_SHIPPED')
      WHERE a.id=NEW.fqc_allocation_id AND a.status='ACTIVE';
    IF stable_completion_line_id IS DISTINCT FROM NEW.production_completion_line_id OR stable_order_line_id IS DISTINCT FROM NEW.sales_order_line_id THEN
      RAISE EXCEPTION 'FQC must use stable active allocation' USING ERRCODE='23514',CONSTRAINT='quality_inspections_fqc_allocation_ck';
    END IF;
  END IF;
  IF source_material_id IS NULL OR source_material_id IS DISTINCT FROM NEW.material_id OR source_unit_id IS DISTINCT FROM NEW.unit_id THEN RAISE EXCEPTION 'quality source material or unit mismatch' USING ERRCODE='23514', CONSTRAINT='quality_inspections_source_match_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality projection writes require quality service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'quality inspections cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (NEW.inspection_code IS DISTINCT FROM OLD.inspection_code OR NEW.inspection_type IS DISTINCT FROM OLD.inspection_type OR NEW.purchase_receipt_line_id IS DISTINCT FROM OLD.purchase_receipt_line_id OR NEW.production_report_id IS DISTINCT FROM OLD.production_report_id OR NEW.production_completion_line_id IS DISTINCT FROM OLD.production_completion_line_id OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id OR NEW.fqc_allocation_id IS DISTINCT FROM OLD.fqc_allocation_id OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.inspected_qty IS DISTINCT FROM OLD.inspected_qty OR NEW.passed_qty IS DISTINCT FROM OLD.passed_qty OR NEW.failed_qty IS DISTINCT FROM OLD.failed_qty OR NEW.inspection_date IS DISTINCT FROM OLD.inspection_date OR NEW.responsible_stage IS DISTINCT FROM OLD.responsible_stage OR NEW.remark IS DISTINCT FROM OLD.remark OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'quality inspection facts are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_production_completion_allocation_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.production_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'production receipt fact requires service transaction' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM finished_goods_sales_allocations a JOIN production_completion_lines pcl ON pcl.id=a.completion_line_id WHERE pcl.completion_id=NEW.completion_id AND a.status='ACTIVE') THEN
    RAISE EXCEPTION 'completion has active sales allocation' USING ERRCODE='23514',CONSTRAINT='production_completion_reversal_allocation_gate_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_completion_reversals_allocation_gate BEFORE INSERT ON production_completion_reversals FOR EACH ROW EXECUTE FUNCTION cyd_production_completion_allocation_reversal_guard();
