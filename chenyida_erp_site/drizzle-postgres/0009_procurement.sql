CREATE TABLE "purchase_financial_source_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_receipt_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"amount" numeric(48, 6) NOT NULL,
	"currency_code" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_financial_source_entries_type_ck" CHECK ("purchase_financial_source_entries"."entry_type" in ('RECEIPT','RECEIPT_REVERSAL')),
	CONSTRAINT "purchase_financial_source_entries_amount_ck" CHECK (("purchase_financial_source_entries"."entry_type"='RECEIPT' and "purchase_financial_source_entries"."amount">0) or ("purchase_financial_source_entries"."entry_type"='RECEIPT_REVERSAL' and "purchase_financial_source_entries"."amount"<0)),
	CONSTRAINT "purchase_financial_source_entries_currency_ck" CHECK ("purchase_financial_source_entries"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_order_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"supplier_mapping_id" bigint NOT NULL,
	"order_qty" numeric(24, 6) NOT NULL,
	"unit_price" numeric(24, 6) NOT NULL,
	"received_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_line_ck" CHECK ("purchase_order_lines"."line_no" > 0),
	CONSTRAINT "purchase_order_lines_quantity_ck" CHECK ("purchase_order_lines"."order_qty" > 0 and "purchase_order_lines"."received_qty" >= 0 and "purchase_order_lines"."received_qty" <= "purchase_order_lines"."order_qty"),
	CONSTRAINT "purchase_order_lines_price_ck" CHECK ("purchase_order_lines"."unit_price" > 0),
	CONSTRAINT "purchase_order_lines_status_ck" CHECK ("purchase_order_lines"."status" in ('OPEN','PARTIALLY_RECEIVED','RECEIVED')),
	CONSTRAINT "purchase_order_lines_version_ck" CHECK ("purchase_order_lines"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_source_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_order_id" bigint NOT NULL,
	"source_type" text NOT NULL,
	"bom_version_id" bigint,
	"order_qty" numeric(24, 6),
	"source_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_source_links_ck" CHECK (("purchase_order_source_links"."source_type"='MANUAL' and "purchase_order_source_links"."bom_version_id" is null and "purchase_order_source_links"."order_qty" is null) or ("purchase_order_source_links"."source_type"='BOM_SHORTAGE' and "purchase_order_source_links"."bom_version_id" is not null and "purchase_order_source_links"."order_qty" > 0))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_order_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_status_events_to_ck" CHECK ("purchase_order_status_events"."to_status" in ('OPEN','PARTIALLY_RECEIVED','RECEIVED','CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_code" text NOT NULL,
	"supplier_id" bigint NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"currency_code" text NOT NULL,
	"source_type" text DEFAULT 'MANUAL' NOT NULL,
	"expected_at" timestamp with time zone,
	"remark" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_ck" CHECK ("purchase_orders"."status" in ('OPEN','PARTIALLY_RECEIVED','RECEIVED','CLOSED')),
	CONSTRAINT "purchase_orders_currency_ck" CHECK ("purchase_orders"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "purchase_orders_source_ck" CHECK ("purchase_orders"."source_type" in ('MANUAL','BOM_SHORTAGE')),
	CONSTRAINT "purchase_orders_version_ck" CHECK ("purchase_orders"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"purchase_receipt_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"purchase_order_line_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"reversal_of_receipt_line_id" bigint,
	"line_amount" numeric(48, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_lines_quantity_ck" CHECK ("purchase_receipt_lines"."quantity" > 0),
	CONSTRAINT "purchase_receipt_lines_amount_ck" CHECK ("purchase_receipt_lines"."line_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"receipt_code" text NOT NULL,
	"purchase_order_id" bigint NOT NULL,
	"receipt_type" text DEFAULT 'RECEIPT' NOT NULL,
	"reversal_of_receipt_id" bigint,
	"inventory_adjustment_id" bigint NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_type_ck" CHECK ("purchase_receipts"."receipt_type" in ('RECEIPT','REVERSAL')),
	CONSTRAINT "purchase_receipts_status_ck" CHECK ("purchase_receipts"."status"='POSTED'),
	CONSTRAINT "purchase_receipts_reversal_ck" CHECK (("purchase_receipts"."receipt_type"='REVERSAL' and "purchase_receipts"."reversal_of_receipt_id" is not null) or ("purchase_receipts"."receipt_type"='RECEIPT' and "purchase_receipts"."reversal_of_receipt_id" is null))
);
--> statement-breakpoint
ALTER TABLE "purchase_financial_source_entries" ADD CONSTRAINT "purchase_financial_source_entries_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_financial_source_entries" ADD CONSTRAINT "purchase_financial_source_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_mapping_id_supplier_mappings_id_fk" FOREIGN KEY ("supplier_mapping_id") REFERENCES "public"."supplier_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_source_links" ADD CONSTRAINT "purchase_order_source_links_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_source_links" ADD CONSTRAINT "purchase_order_source_links_bom_version_id_bom_versions_id_fk" FOREIGN KEY ("bom_version_id") REFERENCES "public"."bom_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_status_events" ADD CONSTRAINT "purchase_order_status_events_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_status_events" ADD CONSTRAINT "purchase_order_status_events_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_inventory_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_reversal_of_receipt_line_id_purchase_receipt_lines_id_fk" FOREIGN KEY ("reversal_of_receipt_line_id") REFERENCES "public"."purchase_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_reversal_of_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("reversal_of_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_inventory_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_financial_source_entries_receipt_uq" ON "purchase_financial_source_entries" USING btree ("purchase_receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_financial_source_entries_source_uq" ON "purchase_financial_source_entries" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "purchase_financial_source_entries_supplier_idx" ON "purchase_financial_source_entries" USING btree ("supplier_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_line_uq" ON "purchase_order_lines" USING btree ("purchase_order_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_material_uq" ON "purchase_order_lines" USING btree ("purchase_order_id","material_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_status_idx" ON "purchase_order_lines" USING btree ("purchase_order_id","status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_source_links_po_uq" ON "purchase_order_source_links" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_source_links_bom_idx" ON "purchase_order_source_links" USING btree ("bom_version_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_order_status_events_po_idx" ON "purchase_order_status_events" USING btree ("purchase_order_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_code_uq" ON "purchase_orders" USING btree ("po_code");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_operation_uq" ON "purchase_orders" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_request_idx" ON "purchase_orders" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_status_idx" ON "purchase_orders" USING btree ("supplier_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_lines_line_uq" ON "purchase_receipt_lines" USING btree ("purchase_receipt_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_lines_po_line_uq" ON "purchase_receipt_lines" USING btree ("purchase_receipt_id","purchase_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_lines_ledger_uq" ON "purchase_receipt_lines" USING btree ("inventory_ledger_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipt_lines_reversal_uq" ON "purchase_receipt_lines" USING btree ("reversal_of_receipt_line_id") WHERE "purchase_receipt_lines"."reversal_of_receipt_line_id" is not null;--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_po_line_idx" ON "purchase_receipt_lines" USING btree ("purchase_order_line_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_code_uq" ON "purchase_receipts" USING btree ("receipt_code");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_operation_uq" ON "purchase_receipts" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_request_uq" ON "purchase_receipts" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_inventory_adjustment_uq" ON "purchase_receipts" USING btree ("inventory_adjustment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_reversal_uq" ON "purchase_receipts" USING btree ("reversal_of_receipt_id") WHERE "purchase_receipts"."reversal_of_receipt_id" is not null;--> statement-breakpoint
CREATE INDEX "purchase_receipts_po_created_idx" ON "purchase_receipts" USING btree ("purchase_order_id","created_at","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_projection_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'procurement records cannot be deleted'; END IF;
  IF current_setting('cyd.procurement_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'procurement projections require service transaction'; END IF;
  IF TG_TABLE_NAME='purchase_orders' THEN
    IF (NEW.po_code,NEW.supplier_id,NEW.currency_code,NEW.source_type,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at) IS DISTINCT FROM (OLD.po_code,OLD.supplier_id,OLD.currency_code,OLD.source_type,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at) THEN RAISE EXCEPTION 'purchase order identity fields are immutable'; END IF;
    IF (NEW.expected_at,NEW.remark) IS DISTINCT FROM (OLD.expected_at,OLD.remark) AND (OLD.status<>'OPEN' OR EXISTS(SELECT 1 FROM purchase_order_lines l WHERE l.purchase_order_id=OLD.id AND l.received_qty>0)) THEN RAISE EXCEPTION 'received purchase order business fields are immutable'; END IF;
  ELSIF TG_TABLE_NAME='purchase_order_lines' THEN
    IF (NEW.purchase_order_id,NEW.line_no,NEW.material_id,NEW.unit_id,NEW.supplier_mapping_id,NEW.order_qty,NEW.unit_price,NEW.remark,NEW.created_at) IS DISTINCT FROM (OLD.purchase_order_id,OLD.line_no,OLD.material_id,OLD.unit_id,OLD.supplier_mapping_id,OLD.order_qty,OLD.unit_price,OLD.remark,OLD.created_at) THEN RAISE EXCEPTION 'purchase order line business fields are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_orders_projection_guard BEFORE UPDATE OR DELETE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION procurement_projection_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_order_lines_projection_guard BEFORE UPDATE OR DELETE ON "purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION procurement_projection_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_order_source_links_immutable BEFORE UPDATE OR DELETE ON "purchase_order_source_links" FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE TRIGGER purchase_order_status_events_immutable BEFORE UPDATE OR DELETE ON "purchase_order_status_events" FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE TRIGGER purchase_receipts_immutable BEFORE UPDATE OR DELETE ON "purchase_receipts" FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE TRIGGER purchase_receipt_lines_immutable BEFORE UPDATE OR DELETE ON "purchase_receipt_lines" FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE TRIGGER purchase_financial_source_entries_immutable BEFORE UPDATE OR DELETE ON "purchase_financial_source_entries" FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION procurement_receipt_integrity_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_row purchase_receipts%ROWTYPE; order_line purchase_order_lines%ROWTYPE; order_row purchase_orders%ROWTYPE; original_receipt purchase_receipts%ROWTYPE; original_line purchase_receipt_lines%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='purchase_receipts' THEN
    IF NEW.receipt_type='REVERSAL' THEN
      SELECT * INTO original_receipt FROM purchase_receipts WHERE id=NEW.reversal_of_receipt_id;
      IF NOT FOUND OR original_receipt.receipt_type<>'RECEIPT' OR original_receipt.purchase_order_id<>NEW.purchase_order_id THEN RAISE EXCEPTION 'invalid purchase receipt reversal'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='purchase_receipt_lines' THEN
    SELECT * INTO receipt_row FROM purchase_receipts WHERE id=NEW.purchase_receipt_id;
    SELECT * INTO order_line FROM purchase_order_lines WHERE id=NEW.purchase_order_line_id;
    IF NOT FOUND OR receipt_row.purchase_order_id<>order_line.purchase_order_id OR NEW.material_id<>order_line.material_id OR NEW.unit_id<>order_line.unit_id THEN RAISE EXCEPTION 'invalid purchase receipt line source'; END IF;
    IF receipt_row.receipt_type='REVERSAL' THEN
      SELECT * INTO original_line FROM purchase_receipt_lines WHERE id=NEW.reversal_of_receipt_line_id;
      IF NOT FOUND OR original_line.purchase_receipt_id<>receipt_row.reversal_of_receipt_id OR original_line.purchase_order_line_id<>NEW.purchase_order_line_id OR original_line.quantity<>NEW.quantity OR original_line.line_amount<>NEW.line_amount THEN RAISE EXCEPTION 'invalid purchase receipt line reversal'; END IF;
    ELSIF NEW.reversal_of_receipt_line_id IS NOT NULL THEN RAISE EXCEPTION 'normal receipt line cannot reverse another line';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO receipt_row FROM purchase_receipts WHERE id=NEW.purchase_receipt_id;
  SELECT * INTO order_row FROM purchase_orders WHERE id=receipt_row.purchase_order_id;
  IF NEW.supplier_id<>order_row.supplier_id OR (receipt_row.receipt_type='RECEIPT')<>(NEW.entry_type='RECEIPT') THEN RAISE EXCEPTION 'invalid purchase financial source'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_receipts_integrity BEFORE INSERT ON "purchase_receipts" FOR EACH ROW EXECUTE FUNCTION procurement_receipt_integrity_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_receipt_lines_integrity BEFORE INSERT ON "purchase_receipt_lines" FOR EACH ROW EXECUTE FUNCTION procurement_receipt_integrity_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_financial_sources_integrity BEFORE INSERT ON "purchase_financial_source_entries" FOR EACH ROW EXECUTE FUNCTION procurement_receipt_integrity_guard();
