ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_source_ck";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_ck" CHECK ("source_type" in ('MANUAL','BOM_SHORTAGE','SOURCING_AWARD'));
ALTER TABLE "purchase_order_source_links" DROP CONSTRAINT "purchase_order_source_links_ck";
ALTER TABLE "purchase_order_source_links" ADD CONSTRAINT "purchase_order_source_links_ck" CHECK (("source_type" in ('MANUAL','SOURCING_AWARD') and "bom_version_id" is null and "order_qty" is null) or ("source_type"='BOM_SHORTAGE' and "bom_version_id" is not null and "order_qty">0));
--> statement-breakpoint
CREATE TABLE "procurement_award_po_line_links" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "award_id" bigint NOT NULL,
  "award_line_id" bigint NOT NULL,
  "purchase_order_id" bigint NOT NULL,
  "purchase_order_line_id" bigint NOT NULL,
  "source_digest" text NOT NULL,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procurement_award_po_line_links_digest_ck" CHECK ("source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "purchase_delivery_plans" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "purchase_order_id" bigint NOT NULL,
  "purchase_order_line_id" bigint NOT NULL,
  "supplier_id" bigint NOT NULL,
  "material_id" bigint NOT NULL,
  "unit_id" bigint NOT NULL,
  "planned_quantity" numeric(24,6) NOT NULL,
  "received_quantity" numeric(24,6) DEFAULT 0 NOT NULL,
  "promised_delivery_date" date NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "request_id" uuid NOT NULL,
  CONSTRAINT "purchase_delivery_plans_quantity_ck" CHECK ("planned_quantity">0 AND "received_quantity">=0 AND "received_quantity"<="planned_quantity"),
  CONSTRAINT "purchase_delivery_plans_status_ck" CHECK ("status" IN ('PENDING','PARTIAL','COMPLETED','CANCELLED','CLOSED')),
  CONSTRAINT "purchase_delivery_plans_version_ck" CHECK ("version">0),
  CONSTRAINT "purchase_delivery_plans_projection_ck" CHECK (("status"='PENDING' AND "received_quantity"=0) OR ("status"='PARTIAL' AND "received_quantity">0 AND "received_quantity"<"planned_quantity") OR ("status"='COMPLETED' AND "received_quantity"="planned_quantity") OR ("status"='CANCELLED' AND "received_quantity"=0) OR ("status"='CLOSED' AND "received_quantity">=0))
);
--> statement-breakpoint
CREATE TABLE "warehouse_receiving_queue_entries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "delivery_plan_id" bigint NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_by" text,
  "closed_at" timestamp with time zone,
  "close_reason" text NOT NULL DEFAULT '',
  CONSTRAINT "warehouse_receiving_queue_entries_version_ck" CHECK ("version">0),
  CONSTRAINT "warehouse_receiving_queue_entries_close_ck" CHECK (("closed_at" IS NULL AND "closed_by" IS NULL AND "close_reason"='') OR ("closed_at" IS NOT NULL AND "closed_by" IS NOT NULL AND char_length(btrim("close_reason")) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_delivery_allocations" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "purchase_receipt_line_id" bigint NOT NULL,
  "delivery_plan_id" bigint NOT NULL,
  "quantity" numeric(24,6) NOT NULL,
  "reversal_of_allocation_id" bigint,
  "created_by" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_receipt_delivery_allocations_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
CREATE TABLE "purchase_delivery_plan_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "delivery_plan_id" bigint NOT NULL,
  "purchase_receipt_id" bigint,
  "from_status" text,
  "to_status" text NOT NULL,
  "event_type" text NOT NULL,
  "quantity" numeric(24,6),
  "reason" text NOT NULL DEFAULT '',
  "actor" text NOT NULL,
  "request_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_delivery_plan_events_status_ck" CHECK (("from_status" IS NULL OR "from_status" IN ('PENDING','PARTIAL','COMPLETED','CANCELLED','CLOSED')) AND "to_status" IN ('PENDING','PARTIAL','COMPLETED','CANCELLED','CLOSED')),
  CONSTRAINT "purchase_delivery_plan_events_type_ck" CHECK ("event_type" IN ('CREATED','RECEIPT_POSTED','RECEIPT_REVERSED','CANCELLED','CLOSED')),
  CONSTRAINT "purchase_delivery_plan_events_quantity_ck" CHECK (("event_type" IN ('RECEIPT_POSTED','RECEIPT_REVERSED') AND "quantity">0 AND "purchase_receipt_id" IS NOT NULL) OR ("event_type" NOT IN ('RECEIPT_POSTED','RECEIPT_REVERSED') AND "quantity" IS NULL)),
  CONSTRAINT "purchase_delivery_plan_events_reason_ck" CHECK (char_length("reason")<=1000)
);
--> statement-breakpoint
ALTER TABLE "procurement_award_po_line_links" ADD CONSTRAINT "procurement_award_po_line_links_award_fk" FOREIGN KEY ("award_id") REFERENCES "procurement_sourcing_awards"("id") ON DELETE restrict;
ALTER TABLE "procurement_award_po_line_links" ADD CONSTRAINT "procurement_award_po_line_links_award_line_fk" FOREIGN KEY ("award_line_id") REFERENCES "procurement_sourcing_award_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_award_po_line_links" ADD CONSTRAINT "procurement_award_po_line_links_po_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE restrict;
ALTER TABLE "procurement_award_po_line_links" ADD CONSTRAINT "procurement_award_po_line_links_po_line_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE restrict;
ALTER TABLE "procurement_award_po_line_links" ADD CONSTRAINT "procurement_award_po_line_links_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_po_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_po_line_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_material_fk" FOREIGN KEY ("material_id") REFERENCES "material_master"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plans" ADD CONSTRAINT "purchase_delivery_plans_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "warehouse_receiving_queue_entries" ADD CONSTRAINT "warehouse_receiving_queue_entries_plan_fk" FOREIGN KEY ("delivery_plan_id") REFERENCES "purchase_delivery_plans"("id") ON DELETE restrict;
ALTER TABLE "warehouse_receiving_queue_entries" ADD CONSTRAINT "warehouse_receiving_queue_entries_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "warehouse_receiving_queue_entries" ADD CONSTRAINT "warehouse_receiving_queue_entries_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "warehouse_receiving_queue_entries" ADD CONSTRAINT "warehouse_receiving_queue_entries_closed_by_fk" FOREIGN KEY ("closed_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "purchase_receipt_delivery_allocations" ADD CONSTRAINT "purchase_receipt_delivery_allocations_receipt_line_fk" FOREIGN KEY ("purchase_receipt_line_id") REFERENCES "purchase_receipt_lines"("id") ON DELETE restrict;
ALTER TABLE "purchase_receipt_delivery_allocations" ADD CONSTRAINT "purchase_receipt_delivery_allocations_plan_fk" FOREIGN KEY ("delivery_plan_id") REFERENCES "purchase_delivery_plans"("id") ON DELETE restrict;
ALTER TABLE "purchase_receipt_delivery_allocations" ADD CONSTRAINT "purchase_receipt_delivery_allocations_reversal_fk" FOREIGN KEY ("reversal_of_allocation_id") REFERENCES "purchase_receipt_delivery_allocations"("id") ON DELETE restrict;
ALTER TABLE "purchase_receipt_delivery_allocations" ADD CONSTRAINT "purchase_receipt_delivery_allocations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "app_users"("username") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plan_events" ADD CONSTRAINT "purchase_delivery_plan_events_plan_fk" FOREIGN KEY ("delivery_plan_id") REFERENCES "purchase_delivery_plans"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plan_events" ADD CONSTRAINT "purchase_delivery_plan_events_receipt_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE restrict;
ALTER TABLE "purchase_delivery_plan_events" ADD CONSTRAINT "purchase_delivery_plan_events_actor_fk" FOREIGN KEY ("actor") REFERENCES "app_users"("username") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_award_po_line_links_award_line_uq" ON "procurement_award_po_line_links" ("award_line_id");
CREATE UNIQUE INDEX "procurement_award_po_line_links_po_line_uq" ON "procurement_award_po_line_links" ("purchase_order_line_id");
CREATE INDEX "procurement_award_po_line_links_award_idx" ON "procurement_award_po_line_links" ("award_id","id");
CREATE UNIQUE INDEX "purchase_delivery_plans_po_line_uq" ON "purchase_delivery_plans" ("purchase_order_line_id");
CREATE INDEX "purchase_delivery_plans_queue_idx" ON "purchase_delivery_plans" ("status","promised_delivery_date","id");
CREATE INDEX "purchase_delivery_plans_po_idx" ON "purchase_delivery_plans" ("purchase_order_id","id");
CREATE UNIQUE INDEX "warehouse_receiving_queue_entries_plan_uq" ON "warehouse_receiving_queue_entries" ("delivery_plan_id");
CREATE INDEX "warehouse_receiving_queue_entries_open_idx" ON "warehouse_receiving_queue_entries" ("delivery_plan_id","id") WHERE "closed_at" IS NULL;
CREATE UNIQUE INDEX "purchase_receipt_delivery_allocations_receipt_line_uq" ON "purchase_receipt_delivery_allocations" ("purchase_receipt_line_id");
CREATE UNIQUE INDEX "purchase_receipt_delivery_allocations_reversal_uq" ON "purchase_receipt_delivery_allocations" ("reversal_of_allocation_id") WHERE "reversal_of_allocation_id" IS NOT NULL;
CREATE INDEX "purchase_receipt_delivery_allocations_plan_idx" ON "purchase_receipt_delivery_allocations" ("delivery_plan_id","id");
CREATE INDEX "purchase_delivery_plan_events_plan_idx" ON "purchase_delivery_plan_events" ("delivery_plan_id","id");
CREATE INDEX "purchase_delivery_plan_events_request_idx" ON "purchase_delivery_plan_events" ("request_id","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_fulfillment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'procurement fulfillment fact is immutable'; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_fulfillment_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'procurement fulfillment records cannot be deleted'; END IF;
  IF current_setting('cyd.procurement_fulfillment_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement fulfillment projections require service transaction'; END IF;
  IF TG_TABLE_NAME='purchase_delivery_plans' THEN
    IF (NEW.purchase_order_id,NEW.purchase_order_line_id,NEW.supplier_id,NEW.material_id,NEW.unit_id,NEW.planned_quantity,NEW.promised_delivery_date,NEW.created_by,NEW.created_at,NEW.request_id) IS DISTINCT FROM (OLD.purchase_order_id,OLD.purchase_order_line_id,OLD.supplier_id,OLD.material_id,OLD.unit_id,OLD.planned_quantity,OLD.promised_delivery_date,OLD.created_by,OLD.created_at,OLD.request_id) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'delivery plan identity is immutable'; END IF;
    IF NEW.received_quantity<>(SELECT received_qty FROM purchase_order_lines WHERE id=NEW.purchase_order_line_id) THEN RAISE EXCEPTION 'delivery plan received quantity must match purchase order line'; END IF;
    IF NOT ((OLD.status='PENDING' AND NEW.status IN ('PENDING','PARTIAL','COMPLETED','CANCELLED','CLOSED')) OR (OLD.status='PARTIAL' AND NEW.status IN ('PENDING','PARTIAL','COMPLETED','CLOSED')) OR (OLD.status='COMPLETED' AND NEW.status IN ('PENDING','PARTIAL','CLOSED')) OR (OLD.status IN ('CANCELLED','CLOSED') AND NEW.status=OLD.status)) THEN RAISE EXCEPTION 'invalid delivery plan transition'; END IF;
  ELSE
    IF (NEW.delivery_plan_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.delivery_plan_id,OLD.created_by,OLD.created_at) OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'receiving queue identity is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_fulfillment_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE award_line procurement_sourcing_award_lines%ROWTYPE; award procurement_sourcing_awards%ROWTYPE; rfq procurement_rfqs%ROWTYPE; rfq_line procurement_rfq_lines%ROWTYPE; quote_line procurement_supplier_quote_lines%ROWTYPE; quote procurement_supplier_quotes%ROWTYPE; po purchase_orders%ROWTYPE; po_line purchase_order_lines%ROWTYPE; plan purchase_delivery_plans%ROWTYPE; receipt_line purchase_receipt_lines%ROWTYPE; receipt purchase_receipts%ROWTYPE; original purchase_receipt_delivery_allocations%ROWTYPE;
BEGIN
  IF current_setting('cyd.procurement_fulfillment_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement fulfillment insert requires service transaction'; END IF;
  IF TG_TABLE_NAME='procurement_award_po_line_links' THEN
    SELECT * INTO award_line FROM procurement_sourcing_award_lines WHERE id=NEW.award_line_id; SELECT * INTO award FROM procurement_sourcing_awards WHERE id=NEW.award_id; SELECT * INTO rfq FROM procurement_rfqs WHERE id=award.rfq_id; SELECT * INTO rfq_line FROM procurement_rfq_lines WHERE id=award_line.rfq_line_id; SELECT * INTO quote_line FROM procurement_supplier_quote_lines WHERE id=award_line.selected_quote_line_id; SELECT * INTO quote FROM procurement_supplier_quotes WHERE id=quote_line.quote_id; SELECT * INTO po FROM purchase_orders WHERE id=NEW.purchase_order_id; SELECT * INTO po_line FROM purchase_order_lines WHERE id=NEW.purchase_order_line_id;
    IF award_line.award_id<>award.id OR award.status<>'AWARDED' OR po_line.purchase_order_id<>po.id OR po.source_type<>'SOURCING_AWARD' OR po.supplier_id<>award_line.supplier_id OR po.supplier_id<>quote.supplier_id OR po.currency_code<>quote.currency_code OR po_line.material_id<>rfq_line.material_id OR po_line.material_id<>quote_line.material_id OR po_line.unit_id<>rfq_line.unit_id OR po_line.unit_id<>quote_line.unit_id OR po_line.order_qty<>award_line.selected_quantity OR quote_line.quoted_quantity<>award_line.selected_quantity OR po_line.unit_price<>award_line.selected_unit_price OR quote_line.unit_price<>award_line.selected_unit_price OR quote_line.promised_delivery_date<>award_line.promised_delivery_date OR NOT EXISTS(SELECT 1 FROM planning_purchase_requests r WHERE r.id=rfq.purchase_request_id AND r.status='ACCEPTED') THEN RAISE EXCEPTION 'invalid award to purchase order source'; END IF;
  ELSIF TG_TABLE_NAME='purchase_delivery_plans' THEN
    SELECT * INTO po FROM purchase_orders WHERE id=NEW.purchase_order_id; SELECT * INTO po_line FROM purchase_order_lines WHERE id=NEW.purchase_order_line_id;
    IF po_line.purchase_order_id<>po.id OR NEW.supplier_id<>po.supplier_id OR NEW.material_id<>po_line.material_id OR NEW.unit_id<>po_line.unit_id OR NEW.planned_quantity<>po_line.order_qty OR NEW.received_quantity<>po_line.received_qty OR NOT EXISTS(SELECT 1 FROM procurement_award_po_line_links l WHERE l.purchase_order_line_id=po_line.id) THEN RAISE EXCEPTION 'invalid delivery plan source'; END IF;
  ELSIF TG_TABLE_NAME='warehouse_receiving_queue_entries' THEN SELECT * INTO plan FROM purchase_delivery_plans WHERE id=NEW.delivery_plan_id; IF plan.status NOT IN ('PENDING','PARTIAL') THEN RAISE EXCEPTION 'only open delivery plans enter receiving queue'; END IF;
  ELSIF TG_TABLE_NAME='purchase_receipt_delivery_allocations' THEN
    SELECT * INTO plan FROM purchase_delivery_plans WHERE id=NEW.delivery_plan_id; SELECT * INTO receipt_line FROM purchase_receipt_lines WHERE id=NEW.purchase_receipt_line_id; SELECT * INTO receipt FROM purchase_receipts WHERE id=receipt_line.purchase_receipt_id;
    IF receipt_line.purchase_order_line_id<>plan.purchase_order_line_id OR receipt_line.quantity<>NEW.quantity THEN RAISE EXCEPTION 'invalid receipt delivery allocation'; END IF;
    IF receipt.receipt_type='REVERSAL' THEN SELECT * INTO original FROM purchase_receipt_delivery_allocations WHERE id=NEW.reversal_of_allocation_id; IF NOT FOUND OR original.delivery_plan_id<>NEW.delivery_plan_id OR original.quantity<>NEW.quantity OR receipt_line.reversal_of_receipt_line_id<>original.purchase_receipt_line_id THEN RAISE EXCEPTION 'invalid receipt delivery allocation reversal'; END IF; ELSIF NEW.reversal_of_allocation_id IS NOT NULL THEN RAISE EXCEPTION 'normal receipt allocation cannot reverse another allocation'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procurement_award_po_line_links_immutable BEFORE UPDATE OR DELETE ON "procurement_award_po_line_links" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_immutable();
CREATE TRIGGER purchase_delivery_plans_service_guard BEFORE UPDATE OR DELETE ON "purchase_delivery_plans" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_projection_guard();
CREATE TRIGGER warehouse_receiving_queue_entries_service_guard BEFORE UPDATE OR DELETE ON "warehouse_receiving_queue_entries" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_projection_guard();
CREATE TRIGGER purchase_receipt_delivery_allocations_immutable BEFORE UPDATE OR DELETE ON "purchase_receipt_delivery_allocations" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_immutable();
CREATE TRIGGER purchase_delivery_plan_events_immutable BEFORE UPDATE OR DELETE ON "purchase_delivery_plan_events" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_immutable();
CREATE TRIGGER procurement_award_po_line_links_integrity BEFORE INSERT ON "procurement_award_po_line_links" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_integrity_guard();
CREATE TRIGGER purchase_delivery_plans_integrity BEFORE INSERT ON "purchase_delivery_plans" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_integrity_guard();
CREATE TRIGGER warehouse_receiving_queue_entries_integrity BEFORE INSERT ON "warehouse_receiving_queue_entries" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_integrity_guard();
CREATE TRIGGER purchase_receipt_delivery_allocations_integrity BEFORE INSERT ON "purchase_receipt_delivery_allocations" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_integrity_guard();
CREATE TRIGGER purchase_delivery_plan_events_insert_guard BEFORE INSERT ON "purchase_delivery_plan_events" FOR EACH ROW EXECUTE FUNCTION procurement_fulfillment_integrity_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_sourcing_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'procurement sourcing records cannot be deleted'; END IF;
  IF current_setting('cyd.procurement_sourcing_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement sourcing projections require service transaction'; END IF;
  IF TG_TABLE_NAME='procurement_rfqs' THEN
    IF (NEW.rfq_code,NEW.purchase_request_id,NEW.round_no,NEW.response_deadline,NEW.currency_code,NEW.source_purchase_request_version,NEW.source_digest,NEW.request_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.rfq_code,OLD.purchase_request_id,OLD.round_no,OLD.response_deadline,OLD.currency_code,OLD.source_purchase_request_version,OLD.source_digest,OLD.request_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'issued rfq scope is immutable'; END IF;
    IF NEW.version<>OLD.version+1 OR NOT ((OLD.status='DRAFT' AND NEW.status IN ('ISSUED','CANCELLED')) OR (OLD.status='ISSUED' AND NEW.status IN ('ISSUED','CLOSED','CANCELLED'))) THEN RAISE EXCEPTION 'invalid rfq transition'; END IF;
  ELSIF TG_TABLE_NAME='procurement_rfq_suppliers' THEN
    IF (NEW.rfq_id,NEW.supplier_id,NEW.invited_by,NEW.invited_at,NEW.supplier_mapping_digest) IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.invited_by,OLD.invited_at,OLD.supplier_mapping_digest) OR NOT (OLD.status='INVITED' AND NEW.status IN ('RESPONDED','DECLINED')) THEN RAISE EXCEPTION 'rfq supplier invitation is immutable'; END IF;
  ELSIF TG_TABLE_NAME='procurement_supplier_quotes' THEN
    IF NEW.version<>OLD.version+1 OR (NEW.rfq_id,NEW.supplier_id,NEW.quote_version_no,NEW.supplier_quote_reference,NEW.currency_code,NEW.valid_until,NEW.tax_included,NEW.freight_included,NEW.payment_terms,NEW.quote_digest,NEW.recorded_by,NEW.recorded_at,NEW.request_id) IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.quote_version_no,OLD.supplier_quote_reference,OLD.currency_code,OLD.valid_until,OLD.tax_included,OLD.freight_included,OLD.payment_terms,OLD.quote_digest,OLD.recorded_by,OLD.recorded_at,OLD.request_id) OR NOT (OLD.status='SUBMITTED' AND NEW.status IN ('SUPERSEDED','WITHDRAWN')) THEN RAISE EXCEPTION 'submitted quote is immutable'; END IF;
  ELSIF TG_TABLE_NAME='procurement_sourcing_awards' THEN
    IF EXISTS(SELECT 1 FROM procurement_award_po_line_links l WHERE l.award_id=OLD.id) THEN RAISE EXCEPTION 'award has purchase order'; END IF;
    IF NEW.version<>OLD.version+1 OR (NEW.rfq_id,NEW.award_digest,NEW.selected_by,NEW.selected_at,NEW.reason_code,NEW.reason,NEW.request_id) IS DISTINCT FROM (OLD.rfq_id,OLD.award_digest,OLD.selected_by,OLD.selected_at,OLD.reason_code,OLD.reason,OLD.request_id) OR NOT (OLD.status='AWARDED' AND NEW.status='REVERSED') THEN RAISE EXCEPTION 'sourcing award is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
