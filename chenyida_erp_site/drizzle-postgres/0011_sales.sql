CREATE TABLE "sales_financial_source_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"amount" numeric(48, 6) NOT NULL,
	"currency_code" text DEFAULT 'CNY' NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_financial_source_entries_type_ck" CHECK ("sales_financial_source_entries"."entry_type" in ('SHIPMENT','SHIPMENT_REVERSAL')),
	CONSTRAINT "sales_financial_source_entries_amount_ck" CHECK (("sales_financial_source_entries"."entry_type"='SHIPMENT' and "sales_financial_source_entries"."amount">0) or ("sales_financial_source_entries"."entry_type"='SHIPMENT_REVERSAL' and "sales_financial_source_entries"."amount"<0)),
	CONSTRAINT "sales_financial_source_entries_currency_ck" CHECK ("sales_financial_source_entries"."currency_code"='CNY')
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sales_order_version_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"finished_material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"ordered_qty" numeric(24, 6) NOT NULL,
	"shipped_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(24, 6) NOT NULL,
	"line_amount" numeric(48, 6) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_lines_quantity_ck" CHECK ("sales_order_lines"."line_no">0 and "sales_order_lines"."ordered_qty">0 and "sales_order_lines"."shipped_qty">=0 and "sales_order_lines"."shipped_qty"<="sales_order_lines"."ordered_qty" and "sales_order_lines"."unit_price">0 and "sales_order_lines"."line_amount">0 and "sales_order_lines"."version">0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sales_order_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_status_events_status_ck" CHECK ("sales_order_status_events"."to_status" in ('OPEN','PARTIALLY_SHIPPED','SHIPPED','CLOSED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "sales_order_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sales_order_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"currency_code" text DEFAULT 'CNY' NOT NULL,
	"total_amount" numeric(48, 6) NOT NULL,
	"due_date" timestamp with time zone,
	"owner" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_versions_amount_ck" CHECK ("sales_order_versions"."version_no">0 and "sales_order_versions"."total_amount">0 and "sales_order_versions"."currency_code"='CNY')
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sales_order_code" text NOT NULL,
	"customer_id" bigint NOT NULL,
	"current_version_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"ordered_qty" numeric(24, 6) NOT NULL,
	"shipped_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_status_ck" CHECK ("sales_orders"."status" in ('OPEN','PARTIALLY_SHIPPED','SHIPPED','CLOSED','CANCELLED')),
	CONSTRAINT "sales_orders_quantity_ck" CHECK ("sales_orders"."ordered_qty">0 and "sales_orders"."shipped_qty">=0 and "sales_orders"."shipped_qty"<="sales_orders"."ordered_qty" and "sales_orders"."version">0)
);
--> statement-breakpoint
CREATE TABLE "sales_quotation_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quotation_version_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"finished_material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_price" numeric(24, 6) NOT NULL,
	"line_amount" numeric(48, 6) NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_quotation_lines_amount_ck" CHECK ("sales_quotation_lines"."line_no">0 and "sales_quotation_lines"."quantity">0 and "sales_quotation_lines"."unit_price">0 and "sales_quotation_lines"."line_amount">0)
);
--> statement-breakpoint
CREATE TABLE "sales_quotation_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quotation_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency_code" text DEFAULT 'CNY' NOT NULL,
	"total_amount" numeric(48, 6) NOT NULL,
	"valid_until" timestamp with time zone,
	"owner" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_quotation_versions_status_ck" CHECK ("sales_quotation_versions"."status" in ('DRAFT','SUPERSEDED','CONVERTED')),
	CONSTRAINT "sales_quotation_versions_amount_ck" CHECK ("sales_quotation_versions"."version_no">0 and "sales_quotation_versions"."total_amount">0 and "sales_quotation_versions"."currency_code"='CNY')
);
--> statement-breakpoint
CREATE TABLE "sales_quotations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quotation_code" text NOT NULL,
	"customer_id" bigint NOT NULL,
	"current_version_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_quotations_status_ck" CHECK ("sales_quotations"."status" in ('DRAFT','CONVERTED','CANCELLED')),
	CONSTRAINT "sales_quotations_version_ck" CHECK ("sales_quotations"."current_version_no">0 and "sales_quotations"."version">0)
);
--> statement-breakpoint
CREATE TABLE "sales_quote_order_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quotation_id" bigint NOT NULL,
	"quotation_version_id" bigint NOT NULL,
	"sales_order_id" bigint NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_shipment_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"sales_order_line_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_shipment_lines_quantity_ck" CHECK ("sales_shipment_lines"."line_no">0 and "sales_shipment_lines"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "sales_shipments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_code" text NOT NULL,
	"sales_order_id" bigint NOT NULL,
	"shipment_type" text DEFAULT 'SHIPMENT' NOT NULL,
	"original_shipment_id" bigint,
	"inventory_adjustment_id" bigint NOT NULL,
	"ship_date" timestamp with time zone DEFAULT now() NOT NULL,
	"receiver" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_shipments_type_ck" CHECK (("sales_shipments"."shipment_type"='SHIPMENT' and "sales_shipments"."original_shipment_id" is null) or ("sales_shipments"."shipment_type"='REVERSAL' and "sales_shipments"."original_shipment_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "sales_financial_source_entries" ADD CONSTRAINT "sales_financial_source_entries_shipment_id_sales_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."sales_shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_financial_source_entries" ADD CONSTRAINT "sales_financial_source_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_version_id_sales_order_versions_id_fk" FOREIGN KEY ("sales_order_version_id") REFERENCES "public"."sales_order_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_finished_material_id_material_master_id_fk" FOREIGN KEY ("finished_material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_status_events" ADD CONSTRAINT "sales_order_status_events_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_status_events" ADD CONSTRAINT "sales_order_status_events_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_versions" ADD CONSTRAINT "sales_order_versions_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_versions" ADD CONSTRAINT "sales_order_versions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_quotation_version_id_sales_quotation_versions_id_fk" FOREIGN KEY ("quotation_version_id") REFERENCES "public"."sales_quotation_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_finished_material_id_material_master_id_fk" FOREIGN KEY ("finished_material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_versions" ADD CONSTRAINT "sales_quotation_versions_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_versions" ADD CONSTRAINT "sales_quotation_versions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_order_links" ADD CONSTRAINT "sales_quote_order_links_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_order_links" ADD CONSTRAINT "sales_quote_order_links_quotation_version_id_sales_quotation_versions_id_fk" FOREIGN KEY ("quotation_version_id") REFERENCES "public"."sales_quotation_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_order_links" ADD CONSTRAINT "sales_quote_order_links_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quote_order_links" ADD CONSTRAINT "sales_quote_order_links_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_shipment_id_sales_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."sales_shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_inventory_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_inventory_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_original_fk" FOREIGN KEY ("original_shipment_id") REFERENCES "public"."sales_shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_financial_source_entries_shipment_uq" ON "sales_financial_source_entries" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_financial_source_entries_source_uq" ON "sales_financial_source_entries" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "sales_financial_source_entries_customer_idx" ON "sales_financial_source_entries" USING btree ("customer_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_line_uq" ON "sales_order_lines" USING btree ("sales_order_version_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_order_lines_material_idx" ON "sales_order_lines" USING btree ("finished_material_id","id");--> statement-breakpoint
CREATE INDEX "sales_order_status_events_order_idx" ON "sales_order_status_events" USING btree ("sales_order_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_versions_no_uq" ON "sales_order_versions" USING btree ("sales_order_id","version_no");--> statement-breakpoint
CREATE INDEX "sales_order_versions_order_idx" ON "sales_order_versions" USING btree ("sales_order_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_code_uq" ON "sales_orders" USING btree ("sales_order_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_operation_uq" ON "sales_orders" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotation_lines_line_uq" ON "sales_quotation_lines" USING btree ("quotation_version_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_quotation_lines_product_idx" ON "sales_quotation_lines" USING btree ("product_id","quotation_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotation_versions_no_uq" ON "sales_quotation_versions" USING btree ("quotation_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotation_versions_operation_uq" ON "sales_quotation_versions" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "sales_quotation_versions_quote_idx" ON "sales_quotation_versions" USING btree ("quotation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotations_code_uq" ON "sales_quotations" USING btree ("quotation_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotations_operation_uq" ON "sales_quotations" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "sales_quotations_status_idx" ON "sales_quotations" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quote_order_links_quote_uq" ON "sales_quote_order_links" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quote_order_links_version_uq" ON "sales_quote_order_links" USING btree ("quotation_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quote_order_links_order_uq" ON "sales_quote_order_links" USING btree ("sales_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipment_lines_line_uq" ON "sales_shipment_lines" USING btree ("shipment_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipment_lines_order_line_uq" ON "sales_shipment_lines" USING btree ("shipment_id","sales_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipment_lines_ledger_uq" ON "sales_shipment_lines" USING btree ("inventory_ledger_entry_id");--> statement-breakpoint
CREATE INDEX "sales_shipment_lines_order_line_idx" ON "sales_shipment_lines" USING btree ("sales_order_line_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipments_code_uq" ON "sales_shipments" USING btree ("shipment_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipments_operation_uq" ON "sales_shipments" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipments_inventory_uq" ON "sales_shipments" USING btree ("inventory_adjustment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipments_original_uq" ON "sales_shipments" USING btree ("original_shipment_id");--> statement-breakpoint
CREATE INDEX "sales_shipments_order_idx" ON "sales_shipments" USING btree ("sales_order_id","created_at","id");
--> statement-breakpoint
CREATE TABLE "sales_quotation_status_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"quotation_id" bigint NOT NULL,
	"quotation_version_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_quotation_status_events_status_ck" CHECK ("sales_quotation_status_events"."to_status" in ('DRAFT','PUBLISHED','ACCEPTED','REJECTED','EXPIRED','CANCELLED','CONVERTED'))
);
--> statement-breakpoint
ALTER TABLE "sales_financial_source_entries" DROP CONSTRAINT "sales_financial_source_entries_amount_ck";--> statement-breakpoint
ALTER TABLE "sales_quotation_versions" DROP CONSTRAINT "sales_quotation_versions_status_ck";--> statement-breakpoint
ALTER TABLE "sales_quotations" DROP CONSTRAINT "sales_quotations_status_ck";--> statement-breakpoint
ALTER TABLE "sales_financial_source_entries" ADD COLUMN "reversal_of_source_entry_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_quotation_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_quotation_status_events" ADD CONSTRAINT "sales_quotation_status_events_quotation_id_sales_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_status_events" ADD CONSTRAINT "sales_quotation_status_events_quotation_version_id_sales_quotation_versions_id_fk" FOREIGN KEY ("quotation_version_id") REFERENCES "public"."sales_quotation_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_status_events" ADD CONSTRAINT "sales_quotation_status_events_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_quotation_status_events_quote_idx" ON "sales_quotation_status_events" USING btree ("quotation_id","id");--> statement-breakpoint
ALTER TABLE "sales_financial_source_entries" ADD CONSTRAINT "sales_financial_source_entries_reversal_fk" FOREIGN KEY ("reversal_of_source_entry_id") REFERENCES "public"."sales_financial_source_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_financial_source_entries_reversal_uq" ON "sales_financial_source_entries" USING btree ("reversal_of_source_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotation_versions_open_draft_uq" ON "sales_quotation_versions" USING btree ("quotation_id") WHERE "sales_quotation_versions"."status"='DRAFT';--> statement-breakpoint
ALTER TABLE "sales_financial_source_entries" ADD CONSTRAINT "sales_financial_source_entries_amount_ck" CHECK (("sales_financial_source_entries"."entry_type"='SHIPMENT' and "sales_financial_source_entries"."amount">0 and "sales_financial_source_entries"."reversal_of_source_entry_id" is null) or ("sales_financial_source_entries"."entry_type"='SHIPMENT_REVERSAL' and "sales_financial_source_entries"."amount"<0 and "sales_financial_source_entries"."reversal_of_source_entry_id" is not null));--> statement-breakpoint
ALTER TABLE "sales_quotation_versions" ADD CONSTRAINT "sales_quotation_versions_status_ck" CHECK ("sales_quotation_versions"."status" in ('DRAFT','PUBLISHED','ACCEPTED','SUPERSEDED','REJECTED','EXPIRED','CANCELLED','CONVERTED'));--> statement-breakpoint
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_status_ck" CHECK ("sales_quotations"."status" in ('DRAFT','PUBLISHED','ACCEPTED','REJECTED','EXPIRED','CANCELLED','CONVERTED'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_quote_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.sales_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'sales projection writes require sales service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sales projections cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.quotation_code IS DISTINCT FROM OLD.quotation_code OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'sales quotation stable fields are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_order_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.sales_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'sales projection writes require sales service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sales projections cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.sales_order_code IS DISTINCT FROM OLD.sales_order_code OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.current_version_no IS DISTINCT FROM OLD.current_version_no OR NEW.ordered_qty IS DISTINCT FROM OLD.ordered_qty OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'sales order stable fields are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_order_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.sales_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'sales line writes require sales service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sales order lines cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id OR NEW.line_no IS DISTINCT FROM OLD.line_no OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id OR NEW.finished_material_id IS DISTINCT FROM OLD.finished_material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.ordered_qty IS DISTINCT FROM OLD.ordered_qty OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.line_amount IS DISTINCT FROM OLD.line_amount THEN RAISE EXCEPTION 'sales order source fields are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_quote_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.sales_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'sales quotation writes require sales service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sales quotation versions cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.quotation_id IS DISTINCT FROM OLD.quotation_id OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'sales quotation version identity is immutable' USING ERRCODE='55000'; END IF;
  IF OLD.status<>'DRAFT' AND (NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.owner IS DISTINCT FROM OLD.owner OR NEW.remark IS DISTINCT FROM OLD.remark) THEN RAISE EXCEPTION 'published sales quotation content is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_quote_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_version_id bigint; parent_status text;
BEGIN
  IF current_setting('cyd.sales_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'sales quotation writes require sales service' USING ERRCODE='42501'; END IF;
  parent_version_id := CASE WHEN TG_OP='DELETE' THEN OLD.quotation_version_id ELSE NEW.quotation_version_id END;
  SELECT status INTO parent_status FROM sales_quotation_versions WHERE id=parent_version_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'published sales quotation lines are immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND NEW.quotation_version_id IS DISTINCT FROM OLD.quotation_version_id THEN RAISE EXCEPTION 'sales quotation line parent is immutable' USING ERRCODE='55000'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'posted sales records are immutable' USING ERRCODE='55000'; END $$;
--> statement-breakpoint
CREATE TRIGGER sales_quotations_service_guard BEFORE UPDATE OR DELETE ON sales_quotations FOR EACH ROW EXECUTE FUNCTION cyd_sales_quote_header_guard();
--> statement-breakpoint
CREATE TRIGGER sales_orders_service_guard BEFORE UPDATE OR DELETE ON sales_orders FOR EACH ROW EXECUTE FUNCTION cyd_sales_order_header_guard();
--> statement-breakpoint
CREATE TRIGGER sales_order_lines_service_guard BEFORE UPDATE OR DELETE ON sales_order_lines FOR EACH ROW EXECUTE FUNCTION cyd_sales_order_line_guard();
--> statement-breakpoint
CREATE TRIGGER sales_quotation_versions_service_guard BEFORE UPDATE OR DELETE ON sales_quotation_versions FOR EACH ROW EXECUTE FUNCTION cyd_sales_quote_version_guard();
--> statement-breakpoint
CREATE TRIGGER sales_quotation_lines_service_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_quotation_lines FOR EACH ROW EXECUTE FUNCTION cyd_sales_quote_line_guard();
--> statement-breakpoint
CREATE TRIGGER sales_quotation_status_events_immutable BEFORE UPDATE OR DELETE ON sales_quotation_status_events FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
--> statement-breakpoint
CREATE TRIGGER sales_order_versions_immutable BEFORE UPDATE OR DELETE ON sales_order_versions FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
--> statement-breakpoint
CREATE TRIGGER sales_quote_order_links_immutable BEFORE UPDATE OR DELETE ON sales_quote_order_links FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
--> statement-breakpoint
CREATE TRIGGER sales_order_status_events_immutable BEFORE UPDATE OR DELETE ON sales_order_status_events FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
--> statement-breakpoint
CREATE TRIGGER sales_shipments_immutable BEFORE UPDATE OR DELETE ON sales_shipments FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
--> statement-breakpoint
CREATE TRIGGER sales_shipment_lines_immutable BEFORE UPDATE OR DELETE ON sales_shipment_lines FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
--> statement-breakpoint
CREATE TRIGGER sales_financial_source_entries_immutable BEFORE UPDATE OR DELETE ON sales_financial_source_entries FOR EACH ROW EXECUTE FUNCTION cyd_sales_immutable();
