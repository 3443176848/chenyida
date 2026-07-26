CREATE TABLE "finance_project_source_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"sales_source_entry_id" bigint,
	"purchase_source_entry_id" bigint,
	"sales_shipment_line_id" bigint,
	"sales_fqc_consumption_id" bigint,
	"purchase_receipt_line_id" bigint,
	"project_id" bigint,
	"attribution_status" text NOT NULL,
	"source_quantity" numeric(24, 6) NOT NULL,
	"unit_price" numeric(24, 6) NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"allocation_digest" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_project_allocations_source_ck" CHECK (("finance_project_source_allocations"."source_type"='SALES_SHIPMENT' and "finance_project_source_allocations"."sales_source_entry_id" is not null and "finance_project_source_allocations"."sales_shipment_line_id" is not null and "finance_project_source_allocations"."purchase_source_entry_id" is null and "finance_project_source_allocations"."purchase_receipt_line_id" is null) or ("finance_project_source_allocations"."source_type"='PURCHASE_RECEIPT' and "finance_project_source_allocations"."purchase_source_entry_id" is not null and "finance_project_source_allocations"."purchase_receipt_line_id" is not null and "finance_project_source_allocations"."sales_source_entry_id" is null and "finance_project_source_allocations"."sales_shipment_line_id" is null and "finance_project_source_allocations"."sales_fqc_consumption_id" is null)),
	CONSTRAINT "finance_project_allocations_attribution_ck" CHECK (("finance_project_source_allocations"."attribution_status"='PROJECT' and "finance_project_source_allocations"."project_id" is not null) or ("finance_project_source_allocations"."attribution_status"='UNATTRIBUTED' and "finance_project_source_allocations"."project_id" is null)),
	CONSTRAINT "finance_project_allocations_amount_ck" CHECK ("finance_project_source_allocations"."source_quantity">0 and "finance_project_source_allocations"."unit_price">=0 and "finance_project_source_allocations"."amount">0),
	CONSTRAINT "finance_project_allocations_digest_ck" CHECK ("finance_project_source_allocations"."allocation_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_sales_source_entry_id_sales_financial_source_entries_id_fk" FOREIGN KEY ("sales_source_entry_id") REFERENCES "public"."sales_financial_source_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_purchase_source_entry_id_purchase_financial_source_entries_id_fk" FOREIGN KEY ("purchase_source_entry_id") REFERENCES "public"."purchase_financial_source_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_sales_shipment_line_id_sales_shipment_lines_id_fk" FOREIGN KEY ("sales_shipment_line_id") REFERENCES "public"."sales_shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_sales_fqc_consumption_id_sales_shipment_line_fqc_allocations_id_fk" FOREIGN KEY ("sales_fqc_consumption_id") REFERENCES "public"."sales_shipment_line_fqc_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_purchase_receipt_line_id_purchase_receipt_lines_id_fk" FOREIGN KEY ("purchase_receipt_line_id") REFERENCES "public"."purchase_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_project_id_business_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."business_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_project_source_allocations" ADD CONSTRAINT "finance_project_source_allocations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_project_allocations_digest_uq" ON "finance_project_source_allocations" USING btree ("allocation_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_project_allocations_sales_fqc_uq" ON "finance_project_source_allocations" USING btree ("sales_fqc_consumption_id") WHERE "finance_project_source_allocations"."sales_fqc_consumption_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_project_allocations_sales_unattributed_line_uq" ON "finance_project_source_allocations" USING btree ("sales_source_entry_id","sales_shipment_line_id") WHERE "finance_project_source_allocations"."sales_fqc_consumption_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_project_allocations_purchase_line_uq" ON "finance_project_source_allocations" USING btree ("purchase_receipt_line_id");--> statement-breakpoint
CREATE INDEX "finance_project_allocations_project_idx" ON "finance_project_source_allocations" USING btree ("project_id","source_type","id");--> statement-breakpoint
CREATE INDEX "finance_project_allocations_sales_source_idx" ON "finance_project_source_allocations" USING btree ("sales_source_entry_id","id");--> statement-breakpoint
CREATE INDEX "finance_project_allocations_purchase_source_idx" ON "finance_project_source_allocations" USING btree ("purchase_source_entry_id","id");
--> statement-breakpoint
CREATE FUNCTION cyd_finance_project_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_project bigint; expected_quantity numeric; expected_price numeric; expected_amount numeric;
  expected_sales_source bigint; expected_purchase_source bigint; source_line_count integer;
BEGIN
  IF current_setting('cyd.finance_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'finance project allocations require FinanceService';
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'finance project allocation facts are immutable'; END IF;
  IF NEW.source_type='SALES_SHIPMENT' THEN
    SELECT sf.id,
      CASE WHEN NEW.sales_fqc_consumption_id IS NULL THEN round(sl.quantity*ol.unit_price,6)
        WHEN fa.id=stats.max_id THEN round(sl.quantity*ol.unit_price,6)-(stats.rounded_amount-round(fa.quantity*ol.unit_price,6))
        ELSE round(fa.quantity*ol.unit_price,6) END,
      CASE WHEN NEW.sales_fqc_consumption_id IS NULL THEN sl.quantity ELSE fa.quantity END,
      ol.unit_price,
      pp.project_id,
      stats.source_count
    INTO expected_sales_source,expected_amount,expected_quantity,expected_price,expected_project,source_line_count
    FROM sales_financial_source_entries sf
    JOIN sales_shipment_lines sl ON sl.shipment_id=sf.shipment_id AND sl.id=NEW.sales_shipment_line_id
    JOIN sales_order_lines ol ON ol.id=sl.sales_order_line_id
    LEFT JOIN sales_shipment_line_fqc_allocations fa ON fa.shipment_line_id=sl.id AND fa.entry_type='SHIPMENT' AND fa.id=NEW.sales_fqc_consumption_id
    LEFT JOIN LATERAL (SELECT max(all_fa.id) max_id,coalesce(sum(round(all_fa.quantity*ol.unit_price,6)),0) rounded_amount,count(*) source_count FROM sales_shipment_line_fqc_allocations all_fa WHERE all_fa.shipment_line_id=sl.id AND all_fa.entry_type='SHIPMENT') stats ON true
    LEFT JOIN finished_goods_sales_allocations fga ON fga.id=fa.fqc_allocation_id
    LEFT JOIN production_completion_lines pcl ON pcl.id=fga.completion_line_id
    LEFT JOIN production_completions pc ON pc.id=pcl.completion_id
    LEFT JOIN production_handoff_work_order_links wl ON wl.work_order_id=pc.work_order_id
    LEFT JOIN production_handoff_items hi ON hi.id=wl.handoff_item_id
    LEFT JOIN production_handoffs ph ON ph.id=hi.handoff_id
    LEFT JOIN project_planning_packages pp ON pp.id=ph.planning_package_id
    WHERE sf.id=NEW.sales_source_entry_id AND sf.entry_type='SHIPMENT';
    IF expected_sales_source IS NULL THEN RAISE EXCEPTION 'finance project sales source mismatch'; END IF;
    IF NEW.sales_fqc_consumption_id IS NULL THEN
      IF source_line_count<>0 THEN RAISE EXCEPTION 'finance project sales attribution origin missing'; END IF;
      expected_project:=NULL;
    ELSIF source_line_count=0 THEN RAISE EXCEPTION 'finance project sales FQC source mismatch'; END IF;
  ELSE
    SELECT pf.id,prl.quantity,pol.unit_price,prl.line_amount,p.project_id
      INTO expected_purchase_source,expected_quantity,expected_price,expected_amount,expected_project
    FROM purchase_financial_source_entries pf
    JOIN purchase_receipt_lines prl ON prl.purchase_receipt_id=pf.purchase_receipt_id AND prl.id=NEW.purchase_receipt_line_id
    JOIN purchase_order_lines pol ON pol.id=prl.purchase_order_line_id
    LEFT JOIN purchase_receipt_delivery_allocations rda ON rda.purchase_receipt_line_id=prl.id AND rda.reversal_of_allocation_id is null
    LEFT JOIN purchase_delivery_plans dp ON dp.id=rda.delivery_plan_id
    LEFT JOIN procurement_award_po_line_links apl ON apl.purchase_order_line_id=dp.purchase_order_line_id
    LEFT JOIN procurement_sourcing_award_lines al ON al.id=apl.award_line_id
    LEFT JOIN procurement_sourcing_awards a ON a.id=al.award_id
    LEFT JOIN procurement_rfqs q ON q.id=a.rfq_id
    LEFT JOIN planning_purchase_requests r ON r.id=q.purchase_request_id
    LEFT JOIN planning_material_requirement_plans p ON p.id=r.plan_id
    WHERE pf.id=NEW.purchase_source_entry_id AND pf.entry_type='RECEIPT';
    IF expected_purchase_source IS NULL THEN RAISE EXCEPTION 'finance project purchase source mismatch'; END IF;
  END IF;
  IF NEW.source_quantity IS DISTINCT FROM expected_quantity OR NEW.unit_price IS DISTINCT FROM expected_price OR NEW.amount IS DISTINCT FROM expected_amount THEN
    RAISE EXCEPTION 'finance project allocation amount mismatch';
  END IF;
  IF (expected_project IS NULL AND (NEW.project_id IS NOT NULL OR NEW.attribution_status<>'UNATTRIBUTED')) OR (expected_project IS NOT NULL AND (NEW.project_id IS DISTINCT FROM expected_project OR NEW.attribution_status<>'PROJECT')) THEN
    RAISE EXCEPTION 'finance project stable source mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_finance_project_allocation_total_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_total numeric; allocated_total numeric;
BEGIN
  IF NEW.source_type='SALES_SHIPMENT' THEN
    SELECT amount INTO expected_total FROM sales_financial_source_entries WHERE id=NEW.sales_source_entry_id;
    SELECT coalesce(sum(amount),0) INTO allocated_total FROM finance_project_source_allocations WHERE sales_source_entry_id=NEW.sales_source_entry_id;
  ELSE
    SELECT amount INTO expected_total FROM purchase_financial_source_entries WHERE id=NEW.purchase_source_entry_id;
    SELECT coalesce(sum(amount),0) INTO allocated_total FROM finance_project_source_allocations WHERE purchase_source_entry_id=NEW.purchase_source_entry_id;
  END IF;
  IF allocated_total IS DISTINCT FROM expected_total THEN RAISE EXCEPTION 'finance project source allocation total mismatch'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER finance_project_allocations_immutable BEFORE INSERT OR UPDATE OR DELETE ON finance_project_source_allocations FOR EACH ROW EXECUTE FUNCTION cyd_finance_project_allocation_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER finance_project_allocations_total AFTER INSERT ON finance_project_source_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_finance_project_allocation_total_guard();
