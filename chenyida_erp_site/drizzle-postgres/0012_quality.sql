CREATE TABLE "quality_defects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"defect_code" text NOT NULL,
	"inspection_id" bigint NOT NULL,
	"result_line_id" bigint,
	"defect_type" text NOT NULL,
	"severity" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_defects_values_ck" CHECK ("quality_defects"."quantity">0 and "quality_defects"."severity" in ('MINOR','MAJOR','CRITICAL') and char_length(btrim("quality_defects"."defect_type")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "quality_inspection_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inspection_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"from_lifecycle_status" text,
	"to_lifecycle_status" text NOT NULL,
	"from_decision_status" text,
	"to_decision_status" text NOT NULL,
	"disposition_code" text,
	"release_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_inspection_events_values_ck" CHECK (
		("quality_inspection_events"."event_type"='CREATED' and "quality_inspection_events"."from_lifecycle_status" is null and "quality_inspection_events"."to_lifecycle_status"='OPEN' and "quality_inspection_events"."from_decision_status" is null and "quality_inspection_events"."to_decision_status"='PENDING' and "quality_inspection_events"."disposition_code" is null and "quality_inspection_events"."release_qty"=0)
		or ("quality_inspection_events"."event_type"='DEFECT_ADDED' and "quality_inspection_events"."from_lifecycle_status"='OPEN' and "quality_inspection_events"."to_lifecycle_status"='OPEN' and "quality_inspection_events"."from_decision_status"="quality_inspection_events"."to_decision_status" and "quality_inspection_events"."disposition_code" is null and "quality_inspection_events"."release_qty"=0)
		or ("quality_inspection_events"."event_type"='DISPOSITIONED' and "quality_inspection_events"."from_lifecycle_status"='OPEN' and "quality_inspection_events"."to_lifecycle_status"='OPEN' and "quality_inspection_events"."from_decision_status" is not null and "quality_inspection_events"."disposition_code" in ('RELEASE','CONCESSION','REWORK','RETURN_TO_SUPPLIER','SCRAP') and (("quality_inspection_events"."to_decision_status"='RELEASED' and "quality_inspection_events"."release_qty">0) or ("quality_inspection_events"."to_decision_status"='HOLD' and "quality_inspection_events"."release_qty"=0)))
		or ("quality_inspection_events"."event_type"='CLOSED' and "quality_inspection_events"."from_lifecycle_status"='OPEN' and "quality_inspection_events"."to_lifecycle_status"='CLOSED' and "quality_inspection_events"."from_decision_status"="quality_inspection_events"."to_decision_status" and "quality_inspection_events"."to_decision_status" in ('HOLD','RELEASED') and "quality_inspection_events"."disposition_code" is null and "quality_inspection_events"."release_qty">=0)
		or ("quality_inspection_events"."event_type"='REOPENED' and "quality_inspection_events"."from_lifecycle_status"='CLOSED' and "quality_inspection_events"."to_lifecycle_status"='OPEN' and "quality_inspection_events"."from_decision_status" in ('HOLD','RELEASED') and "quality_inspection_events"."to_decision_status"='PENDING' and "quality_inspection_events"."disposition_code" is null and "quality_inspection_events"."release_qty"=0)
	)
);
--> statement-breakpoint
CREATE TABLE "quality_inspection_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inspection_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"characteristic" text NOT NULL,
	"result" text NOT NULL,
	"measured_value" text DEFAULT '' NOT NULL,
	"specification" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_inspection_results_values_ck" CHECK ("quality_inspection_results"."line_no">0 and "quality_inspection_results"."result" in ('PASS','FAIL') and char_length(btrim("quality_inspection_results"."characteristic")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "quality_inspections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inspection_code" text NOT NULL,
	"inspection_type" text NOT NULL,
	"purchase_receipt_line_id" bigint,
	"production_report_id" bigint,
	"production_completion_line_id" bigint,
	"sales_order_line_id" bigint,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"inspected_qty" numeric(24, 6) NOT NULL,
	"passed_qty" numeric(24, 6) NOT NULL,
	"failed_qty" numeric(24, 6) NOT NULL,
	"lifecycle_status" text DEFAULT 'OPEN' NOT NULL,
	"decision_status" text DEFAULT 'PENDING' NOT NULL,
	"released_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"inspection_date" timestamp with time zone DEFAULT now() NOT NULL,
	"responsible_stage" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_inspections_type_source_ck" CHECK (("quality_inspections"."inspection_type"='IQC' and "quality_inspections"."purchase_receipt_line_id" is not null and "quality_inspections"."production_report_id" is null and "quality_inspections"."production_completion_line_id" is null and "quality_inspections"."sales_order_line_id" is null) or ("quality_inspections"."inspection_type"='IPQC' and "quality_inspections"."purchase_receipt_line_id" is null and "quality_inspections"."production_report_id" is not null and "quality_inspections"."production_completion_line_id" is null and "quality_inspections"."sales_order_line_id" is null) or ("quality_inspections"."inspection_type"='FQC' and "quality_inspections"."purchase_receipt_line_id" is null and "quality_inspections"."production_report_id" is null and "quality_inspections"."production_completion_line_id" is not null and "quality_inspections"."sales_order_line_id" is not null)),
	CONSTRAINT "quality_inspections_quantity_ck" CHECK ("quality_inspections"."inspected_qty">0 and "quality_inspections"."passed_qty">=0 and "quality_inspections"."failed_qty">=0 and "quality_inspections"."passed_qty"+"quality_inspections"."failed_qty"="quality_inspections"."inspected_qty" and "quality_inspections"."released_qty">=0 and "quality_inspections"."released_qty"<="quality_inspections"."inspected_qty"),
	CONSTRAINT "quality_inspections_state_ck" CHECK ("quality_inspections"."lifecycle_status" in ('OPEN','CLOSED') and "quality_inspections"."decision_status" in ('PENDING','HOLD','RELEASED') and (("quality_inspections"."decision_status" in ('PENDING','HOLD') and "quality_inspections"."released_qty"=0) or ("quality_inspections"."decision_status"='RELEASED' and "quality_inspections"."released_qty">0)) and ("quality_inspections"."lifecycle_status"='OPEN' or "quality_inspections"."decision_status"<>'PENDING') and "quality_inspections"."version">0)
);
--> statement-breakpoint
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_events" ADD CONSTRAINT "quality_inspection_events_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_events" ADD CONSTRAINT "quality_inspection_events_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_results" ADD CONSTRAINT "quality_inspection_results_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_purchase_receipt_line_id_purchase_receipt_lines_id_fk" FOREIGN KEY ("purchase_receipt_line_id") REFERENCES "public"."purchase_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_production_report_id_production_reports_id_fk" FOREIGN KEY ("production_report_id") REFERENCES "public"."production_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_production_completion_line_id_production_completion_lines_id_fk" FOREIGN KEY ("production_completion_line_id") REFERENCES "public"."production_completion_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_inspection_results_parent_id_uq" ON "quality_inspection_results" USING btree ("inspection_id","id");--> statement-breakpoint
ALTER TABLE "quality_defects" ADD CONSTRAINT "quality_defects_result_parent_fk" FOREIGN KEY ("inspection_id","result_line_id") REFERENCES "public"."quality_inspection_results"("inspection_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_defects_code_uq" ON "quality_defects" USING btree ("defect_code");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_defects_operation_uq" ON "quality_defects" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "quality_defects_inspection_idx" ON "quality_defects" USING btree ("inspection_id","id");--> statement-breakpoint
CREATE INDEX "quality_defects_result_idx" ON "quality_defects" USING btree ("result_line_id","id");--> statement-breakpoint
CREATE INDEX "quality_inspection_events_inspection_idx" ON "quality_inspection_events" USING btree ("inspection_id","id");--> statement-breakpoint
CREATE INDEX "quality_inspection_events_type_idx" ON "quality_inspection_events" USING btree ("inspection_id","event_type","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_inspection_results_line_uq" ON "quality_inspection_results" USING btree ("inspection_id","line_no");--> statement-breakpoint
CREATE INDEX "quality_inspection_results_inspection_idx" ON "quality_inspection_results" USING btree ("inspection_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_inspections_code_uq" ON "quality_inspections" USING btree ("inspection_code");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_inspections_operation_uq" ON "quality_inspections" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "quality_inspections_status_idx" ON "quality_inspections" USING btree ("inspection_type","lifecycle_status","decision_status","id");--> statement-breakpoint
CREATE INDEX "quality_inspections_receipt_idx" ON "quality_inspections" USING btree ("purchase_receipt_line_id","id");--> statement-breakpoint
CREATE INDEX "quality_inspections_report_idx" ON "quality_inspections" USING btree ("production_report_id","id");--> statement-breakpoint
CREATE INDEX "quality_inspections_completion_idx" ON "quality_inspections" USING btree ("production_completion_line_id","id");--> statement-breakpoint
CREATE INDEX "quality_inspections_order_line_idx" ON "quality_inspections" USING btree ("sales_order_line_id","id");--> statement-breakpoint
CREATE INDEX "quality_inspections_fqc_order_release_idx" ON "quality_inspections" USING btree ("sales_order_line_id","lifecycle_status","decision_status","id") WHERE "quality_inspections"."inspection_type"='FQC';--> statement-breakpoint
CREATE INDEX "quality_inspections_fqc_completion_release_idx" ON "quality_inspections" USING btree ("production_completion_line_id","lifecycle_status","decision_status","id") WHERE "quality_inspections"."inspection_type"='FQC';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_material_id bigint; source_unit_id bigint;
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality writes require quality service' USING ERRCODE='42501'; END IF;
  IF NEW.inspection_type='IQC' THEN
    SELECT prl.material_id,prl.unit_id INTO source_material_id,source_unit_id FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.purchase_receipt_id AND pr.receipt_type='RECEIPT' WHERE prl.id=NEW.purchase_receipt_line_id AND NOT EXISTS(SELECT 1 FROM purchase_receipts rr WHERE rr.reversal_of_receipt_id=pr.id);
  ELSIF NEW.inspection_type='IPQC' THEN
    SELECT wo.finished_material_id,wo.finished_unit_id INTO source_material_id,source_unit_id FROM production_reports r JOIN production_work_orders wo ON wo.id=r.work_order_id WHERE r.id=NEW.production_report_id;
  ELSE
    SELECT pcl.material_id,pcl.unit_id INTO source_material_id,source_unit_id FROM production_completion_lines pcl JOIN sales_order_lines sol ON sol.id=NEW.sales_order_line_id AND sol.finished_material_id=pcl.material_id AND sol.unit_id=pcl.unit_id WHERE pcl.id=NEW.production_completion_line_id;
  END IF;
  IF source_material_id IS NULL OR source_material_id IS DISTINCT FROM NEW.material_id OR source_unit_id IS DISTINCT FROM NEW.unit_id THEN RAISE EXCEPTION 'quality source material or unit mismatch' USING ERRCODE='23514', CONSTRAINT='quality_inspections_source_match_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality projection writes require quality service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'quality inspections cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (NEW.inspection_code IS DISTINCT FROM OLD.inspection_code OR NEW.inspection_type IS DISTINCT FROM OLD.inspection_type OR NEW.purchase_receipt_line_id IS DISTINCT FROM OLD.purchase_receipt_line_id OR NEW.production_report_id IS DISTINCT FROM OLD.production_report_id OR NEW.production_completion_line_id IS DISTINCT FROM OLD.production_completion_line_id OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.inspected_qty IS DISTINCT FROM OLD.inspected_qty OR NEW.passed_qty IS DISTINCT FROM OLD.passed_qty OR NEW.failed_qty IS DISTINCT FROM OLD.failed_qty OR NEW.inspection_date IS DISTINCT FROM OLD.inspection_date OR NEW.responsible_stage IS DISTINCT FROM OLD.responsible_stage OR NEW.remark IS DISTINCT FROM OLD.remark OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'quality inspection facts are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.quality_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'quality fact writes require quality service' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'quality facts are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_defect_quantity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE failed numeric(24,6); existing numeric(24,6);
BEGIN
  SELECT failed_qty INTO failed FROM quality_inspections WHERE id=NEW.inspection_id FOR UPDATE;
  SELECT coalesce(sum(quantity),0) INTO existing FROM quality_defects WHERE inspection_id=NEW.inspection_id;
  IF failed IS NULL OR existing+NEW.quantity>failed THEN RAISE EXCEPTION 'defect quantity exceeds failed quantity' USING ERRCODE='23514', CONSTRAINT='quality_defects_total_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint; failed numeric(24,6); decision text; defect_count bigint; fail_result_count bigint;
BEGIN
  IF TG_TABLE_NAME='quality_inspections' THEN target_id := NEW.id; ELSE target_id := NEW.inspection_id; END IF;
  SELECT failed_qty,decision_status INTO failed,decision FROM quality_inspections WHERE id=target_id;
  IF failed IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO defect_count FROM quality_defects WHERE inspection_id=target_id;
  SELECT count(*) INTO fail_result_count FROM quality_inspection_results WHERE inspection_id=target_id AND result='FAIL';
	  IF failed>0 AND (fail_result_count=0 OR defect_count=0) THEN RAISE EXCEPTION 'failed inspection requires fail result and defect' USING ERRCODE='23514', CONSTRAINT='quality_inspections_failed_evidence_ck'; END IF;
  IF failed=0 AND (defect_count>0 OR fail_result_count>0) THEN RAISE EXCEPTION 'passing inspection cannot contain failed evidence' USING ERRCODE='23514', CONSTRAINT='quality_inspections_failed_evidence_ck'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER quality_inspections_service_guard BEFORE INSERT OR UPDATE OR DELETE ON quality_inspections FOR EACH ROW EXECUTE FUNCTION cyd_quality_header_guard();
--> statement-breakpoint
CREATE TRIGGER quality_inspections_source_guard BEFORE INSERT ON quality_inspections FOR EACH ROW EXECUTE FUNCTION cyd_quality_source_guard();
--> statement-breakpoint
CREATE TRIGGER quality_inspection_results_immutable BEFORE INSERT OR UPDATE OR DELETE ON quality_inspection_results FOR EACH ROW EXECUTE FUNCTION cyd_quality_fact_guard();
--> statement-breakpoint
CREATE TRIGGER quality_defects_immutable BEFORE INSERT OR UPDATE OR DELETE ON quality_defects FOR EACH ROW EXECUTE FUNCTION cyd_quality_fact_guard();
--> statement-breakpoint
CREATE TRIGGER quality_defects_quantity_guard BEFORE INSERT ON quality_defects FOR EACH ROW EXECUTE FUNCTION cyd_quality_defect_quantity_guard();
--> statement-breakpoint
CREATE TRIGGER quality_inspection_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON quality_inspection_events FOR EACH ROW EXECUTE FUNCTION cyd_quality_fact_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER quality_inspections_consistency AFTER INSERT OR UPDATE ON quality_inspections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_quality_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER quality_results_consistency AFTER INSERT ON quality_inspection_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_quality_consistency_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER quality_defects_consistency AFTER INSERT ON quality_defects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_quality_consistency_guard();
--> statement-breakpoint
CREATE FUNCTION sales_fqc_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shipment_kind text; already_shipped numeric(24,6); released numeric(24,6);
BEGIN
  SELECT shipment_type INTO shipment_kind FROM sales_shipments WHERE id=NEW.shipment_id;
  IF shipment_kind='SHIPMENT' THEN
    SELECT shipped_qty INTO already_shipped FROM sales_order_lines WHERE id=NEW.sales_order_line_id FOR UPDATE;
    SELECT coalesce(sum(released_qty),0) INTO released FROM quality_inspections WHERE sales_order_line_id=NEW.sales_order_line_id AND inspection_type='FQC' AND lifecycle_status='CLOSED' AND decision_status='RELEASED';
    IF already_shipped+NEW.quantity>released THEN RAISE EXCEPTION 'FQC release insufficient' USING ERRCODE='23514',CONSTRAINT='sales_shipment_lines_fqc_release_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sales_shipment_lines_fqc_release BEFORE INSERT ON sales_shipment_lines FOR EACH ROW EXECUTE FUNCTION sales_fqc_release_guard();
