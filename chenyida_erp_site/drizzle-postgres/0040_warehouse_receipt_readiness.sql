CREATE TABLE "warehouse_receipt_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_receipt_id" bigint NOT NULL,
	"purchase_receipt_line_id" bigint NOT NULL,
	"delivery_plan_id" bigint NOT NULL,
	"queue_entry_id" bigint NOT NULL,
	"evidence_type" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"evidence_document_date" date NOT NULL,
	"early_arrival" boolean NOT NULL,
	"early_arrival_reason" text,
	"early_arrival_confirmed" boolean DEFAULT false NOT NULL,
	"physical_receipt_confirmed" boolean NOT NULL,
	"target_location_code" text DEFAULT 'MAIN' NOT NULL,
	"expected_purchase_order_version" integer NOT NULL,
	"expected_purchase_order_line_version" integer NOT NULL,
	"expected_delivery_plan_version" integer NOT NULL,
	"expected_queue_version" integer NOT NULL,
	"expected_balance_version" integer NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_receipt_evidence_type_ck" CHECK ("warehouse_receipt_evidence"."evidence_type" in ('DELIVERY_NOTE','LOGISTICS_HANDOVER','OTHER_EQUIVALENT')),
	CONSTRAINT "warehouse_receipt_evidence_reference_ck" CHECK (char_length(btrim("warehouse_receipt_evidence"."evidence_reference")) between 1 and 128 and "warehouse_receipt_evidence"."evidence_reference" !~ '[[:cntrl:]]'),
	CONSTRAINT "warehouse_receipt_evidence_early_ck" CHECK (("warehouse_receipt_evidence"."early_arrival" and "warehouse_receipt_evidence"."early_arrival_confirmed" and "warehouse_receipt_evidence"."early_arrival_reason" is not null and char_length(btrim("warehouse_receipt_evidence"."early_arrival_reason")) between 1 and 1000 and "warehouse_receipt_evidence"."early_arrival_reason" !~ '[[:cntrl:]]') or (not "warehouse_receipt_evidence"."early_arrival" and not "warehouse_receipt_evidence"."early_arrival_confirmed" and "warehouse_receipt_evidence"."early_arrival_reason" is null)),
	CONSTRAINT "warehouse_receipt_evidence_physical_ck" CHECK ("warehouse_receipt_evidence"."physical_receipt_confirmed"),
	CONSTRAINT "warehouse_receipt_evidence_location_ck" CHECK ("warehouse_receipt_evidence"."target_location_code"='MAIN'),
	CONSTRAINT "warehouse_receipt_evidence_versions_ck" CHECK ("warehouse_receipt_evidence"."expected_purchase_order_version">0 and "warehouse_receipt_evidence"."expected_purchase_order_line_version">0 and "warehouse_receipt_evidence"."expected_delivery_plan_version">0 and "warehouse_receipt_evidence"."expected_queue_version">0 and "warehouse_receipt_evidence"."expected_balance_version">=0)
);
--> statement-breakpoint
ALTER TABLE "warehouse_receipt_evidence" ADD CONSTRAINT "warehouse_receipt_evidence_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_receipt_evidence" ADD CONSTRAINT "warehouse_receipt_evidence_purchase_receipt_line_id_purchase_receipt_lines_id_fk" FOREIGN KEY ("purchase_receipt_line_id") REFERENCES "public"."purchase_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_receipt_evidence" ADD CONSTRAINT "warehouse_receipt_evidence_delivery_plan_id_purchase_delivery_plans_id_fk" FOREIGN KEY ("delivery_plan_id") REFERENCES "public"."purchase_delivery_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_receipt_evidence" ADD CONSTRAINT "warehouse_receipt_evidence_queue_entry_id_warehouse_receiving_queue_entries_id_fk" FOREIGN KEY ("queue_entry_id") REFERENCES "public"."warehouse_receiving_queue_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_receipt_evidence" ADD CONSTRAINT "warehouse_receipt_evidence_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_receipt_evidence_receipt_uq" ON "warehouse_receipt_evidence" USING btree ("purchase_receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_receipt_evidence_receipt_line_uq" ON "warehouse_receipt_evidence" USING btree ("purchase_receipt_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_receipt_evidence_request_uq" ON "warehouse_receipt_evidence" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "warehouse_receipt_evidence_plan_idx" ON "warehouse_receipt_evidence" USING btree ("delivery_plan_id","id");--> statement-breakpoint
CREATE INDEX "warehouse_receipt_evidence_queue_idx" ON "warehouse_receipt_evidence" USING btree ("queue_entry_id","id");--> statement-breakpoint
CREATE FUNCTION cyd_warehouse_receipt_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lineage record;
  actual_early boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'warehouse receipt evidence is immutable' USING ERRCODE='55000';
  END IF;
  IF current_setting('cyd.procurement_fulfillment_service_write',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'warehouse receipt evidence requires fulfillment service' USING ERRCODE='42501';
  END IF;

  SELECT receipt.receipt_type,receipt.purchase_order_id,receipt.created_by,receipt.request_id,
      receipt.created_at,receipt_line.purchase_order_line_id,receipt_line.quantity,
      allocation.reversal_of_allocation_id,plan.purchase_order_id plan_purchase_order_id,
      plan.purchase_order_line_id plan_purchase_order_line_id,plan.promised_delivery_date,
      plan.version plan_version,queue.version queue_version,purchase_order.version purchase_order_version,
      purchase_order_line.version purchase_order_line_version,ledger.balance_version_before,
      ledger.location_code
    INTO lineage
    FROM purchase_receipts receipt
    JOIN purchase_receipt_lines receipt_line
      ON receipt_line.purchase_receipt_id=receipt.id AND receipt_line.id=NEW.purchase_receipt_line_id
    JOIN purchase_receipt_delivery_allocations allocation
      ON allocation.purchase_receipt_line_id=receipt_line.id AND allocation.delivery_plan_id=NEW.delivery_plan_id
    JOIN purchase_delivery_plans plan ON plan.id=allocation.delivery_plan_id
    JOIN warehouse_receiving_queue_entries queue
      ON queue.delivery_plan_id=plan.id AND queue.id=NEW.queue_entry_id
    JOIN purchase_orders purchase_order ON purchase_order.id=receipt.purchase_order_id
    JOIN purchase_order_lines purchase_order_line
      ON purchase_order_line.id=receipt_line.purchase_order_line_id
    JOIN inventory_ledger_entries ledger ON ledger.id=receipt_line.inventory_ledger_entry_id
    WHERE receipt.id=NEW.purchase_receipt_id
    FOR SHARE OF receipt,receipt_line,allocation,plan,queue,purchase_order,purchase_order_line,ledger;

  IF NOT FOUND OR lineage.receipt_type<>'RECEIPT'
      OR lineage.reversal_of_allocation_id IS NOT NULL
      OR lineage.purchase_order_id IS DISTINCT FROM lineage.plan_purchase_order_id
      OR lineage.purchase_order_line_id IS DISTINCT FROM lineage.plan_purchase_order_line_id THEN
    RAISE EXCEPTION 'warehouse receipt evidence lineage mismatch'
      USING ERRCODE='23514',CONSTRAINT='warehouse_receipt_evidence_lineage_ck';
  END IF;
  IF NEW.created_by IS DISTINCT FROM lineage.created_by
      OR NEW.request_id IS DISTINCT FROM lineage.request_id
      OR NEW.created_at IS DISTINCT FROM lineage.created_at THEN
    RAISE EXCEPTION 'warehouse receipt evidence credential mismatch'
      USING ERRCODE='23514',CONSTRAINT='warehouse_receipt_evidence_credential_ck';
  END IF;
  IF lineage.purchase_order_version<>NEW.expected_purchase_order_version+1
      OR lineage.purchase_order_line_version<>NEW.expected_purchase_order_line_version+1
      OR lineage.plan_version<>NEW.expected_delivery_plan_version+1
      OR lineage.queue_version<>NEW.expected_queue_version+1
      OR lineage.balance_version_before<>NEW.expected_balance_version THEN
    RAISE EXCEPTION 'warehouse receipt evidence CAS snapshot mismatch'
      USING ERRCODE='23514',CONSTRAINT='warehouse_receipt_evidence_cas_ck';
  END IF;
  IF NEW.target_location_code IS DISTINCT FROM lineage.location_code THEN
    RAISE EXCEPTION 'warehouse receipt target location mismatch'
      USING ERRCODE='23514',CONSTRAINT='warehouse_receipt_evidence_target_ck';
  END IF;
  IF NEW.evidence_document_date>(lineage.created_at AT TIME ZONE 'Asia/Shanghai')::date THEN
    RAISE EXCEPTION 'warehouse receipt evidence date cannot be in the future'
      USING ERRCODE='23514',CONSTRAINT='warehouse_receipt_evidence_future_date_ck';
  END IF;

  actual_early := (lineage.created_at AT TIME ZONE 'Asia/Shanghai')::date<lineage.promised_delivery_date;
  IF NEW.early_arrival IS DISTINCT FROM actual_early THEN
    RAISE EXCEPTION 'warehouse receipt early arrival projection mismatch'
      USING ERRCODE='23514',CONSTRAINT='warehouse_receipt_evidence_early_projection_ck';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER warehouse_receipt_evidence_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON warehouse_receipt_evidence
  FOR EACH ROW EXECUTE FUNCTION cyd_warehouse_receipt_evidence_guard();
