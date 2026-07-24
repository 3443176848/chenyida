CREATE TABLE "bom_headers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bom_code" text NOT NULL,
	"product_id" bigint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"current_version_no" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "bom_headers_status_ck" CHECK ("bom_headers"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "bom_headers_version_ck" CHECK ("bom_headers"."version" > 0 and "bom_headers"."current_version_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bom_version_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"quantity_per" numeric(24, 6) NOT NULL,
	"unit_id" bigint NOT NULL,
	"loss_rate" numeric(12, 8) DEFAULT '0' NOT NULL,
	"process_stage" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "bom_lines_line_ck" CHECK ("bom_lines"."line_no" > 0),
	CONSTRAINT "bom_lines_quantity_ck" CHECK ("bom_lines"."quantity_per" > 0),
	CONSTRAINT "bom_lines_loss_ck" CHECK ("bom_lines"."loss_rate" >= 0 and "bom_lines"."loss_rate" < 1)
);
--> statement-breakpoint
CREATE TABLE "bom_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bom_header_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"version_code" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"released_by" text DEFAULT '' NOT NULL,
	"released_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "bom_versions_no_ck" CHECK ("bom_versions"."version_no" > 0),
	CONSTRAINT "bom_versions_status_ck" CHECK ("bom_versions"."status" in ('DRAFT','RELEASED','OBSOLETE'))
);
--> statement-breakpoint
CREATE TABLE "business_code_sequences" (
	"sequence_code" text PRIMARY KEY NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_code_sequences_value_ck" CHECK ("business_code_sequences"."current_value" >= 0),
	CONSTRAINT "business_code_sequences_version_ck" CHECK ("business_code_sequences"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_code" text NOT NULL,
	"customer_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "customers_status_ck" CHECK ("customers"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "customers_version_ck" CHECK ("customers"."version" > 0),
	CONSTRAINT "customers_name_ck" CHECK (char_length(btrim("customers"."customer_name")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "product_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"version_code" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"product_type" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"layer_count" integer,
	"board_thickness" numeric(18, 6),
	"min_line_width" numeric(18, 6),
	"min_hole" numeric(18, 6),
	"surface_finish" text DEFAULT '' NOT NULL,
	"smt_required" boolean DEFAULT false NOT NULL,
	"engineering_owner" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"released_by" text DEFAULT '' NOT NULL,
	"released_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "product_versions_no_ck" CHECK ("product_versions"."version_no" > 0),
	CONSTRAINT "product_versions_status_ck" CHECK ("product_versions"."status" in ('DRAFT','RELEASED','OBSOLETE')),
	CONSTRAINT "product_versions_layer_ck" CHECK ("product_versions"."layer_count" is null or "product_versions"."layer_count" > 0),
	CONSTRAINT "product_versions_dimension_ck" CHECK (("product_versions"."board_thickness" is null or "product_versions"."board_thickness" > 0) and ("product_versions"."min_line_width" is null or "product_versions"."min_line_width" > 0) and ("product_versions"."min_hole" is null or "product_versions"."min_hole" > 0))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"customer_id" bigint,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"current_version_no" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "products_status_ck" CHECK ("products"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "products_version_ck" CHECK ("products"."version" > 0 and "products"."current_version_no" > 0),
	CONSTRAINT "products_name_ck" CHECK (char_length(btrim("products"."product_name")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_code" text NOT NULL,
	"supplier_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"supplier_level" text DEFAULT '' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "suppliers_status_ck" CHECK ("suppliers"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "suppliers_version_ck" CHECK ("suppliers"."version" > 0),
	CONSTRAINT "suppliers_name_ck" CHECK (char_length(btrim("suppliers"."supplier_name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "supplier_id" bigint;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD COLUMN "purchase_unit_id" bigint;--> statement-breakpoint
ALTER TABLE "bom_headers" ADD CONSTRAINT "bom_headers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_version_id_bom_versions_id_fk" FOREIGN KEY ("bom_version_id") REFERENCES "public"."bom_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_bom_header_id_bom_headers_id_fk" FOREIGN KEY ("bom_header_id") REFERENCES "public"."bom_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_headers_code_uq" ON "bom_headers" USING btree ("bom_code");--> statement-breakpoint
CREATE INDEX "bom_headers_product_status_idx" ON "bom_headers" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_lines_version_line_uq" ON "bom_lines" USING btree ("bom_version_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_lines_version_material_stage_uq" ON "bom_lines" USING btree ("bom_version_id","material_id","process_stage");--> statement-breakpoint
CREATE INDEX "bom_lines_material_idx" ON "bom_lines" USING btree ("material_id","bom_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_versions_header_no_uq" ON "bom_versions" USING btree ("bom_header_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_versions_header_code_uq" ON "bom_versions" USING btree ("bom_header_id","version_code");--> statement-breakpoint
CREATE INDEX "bom_versions_header_status_idx" ON "bom_versions" USING btree ("bom_header_id","status","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_uq" ON "customers" USING btree ("customer_code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_normalized_name_uq" ON "customers" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "customers_status_updated_idx" ON "customers" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_versions_product_no_uq" ON "product_versions" USING btree ("product_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "product_versions_product_code_uq" ON "product_versions" USING btree ("product_id","version_code");--> statement-breakpoint
CREATE INDEX "product_versions_product_status_idx" ON "product_versions" USING btree ("product_id","status","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "products_code_uq" ON "products" USING btree ("product_code");--> statement-breakpoint
CREATE INDEX "products_customer_status_idx" ON "products" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "products_status_updated_idx" ON "products" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_uq" ON "suppliers" USING btree ("supplier_code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_normalized_name_uq" ON "suppliers" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "suppliers_status_updated_idx" ON "suppliers" USING btree ("status","updated_at","id");--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_purchase_unit_id_units_id_fk" FOREIGN KEY ("purchase_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_mappings_supplier_status_idx" ON "supplier_mappings" USING btree ("supplier_id","status","valid_from");--> statement-breakpoint
ALTER TABLE "supplier_mapping_price_history" ADD CONSTRAINT "supplier_mapping_price_positive_ck" CHECK ("supplier_mapping_price_history"."price" > 0);--> statement-breakpoint
ALTER TABLE "supplier_mapping_price_history" ADD CONSTRAINT "supplier_mapping_price_moq_ck" CHECK ("supplier_mapping_price_history"."minimum_order_qty" is null or "supplier_mapping_price_history"."minimum_order_qty" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_mapping_price_history" ADD CONSTRAINT "supplier_mapping_price_period_ck" CHECK ("supplier_mapping_price_history"."effective_to" is null or "supplier_mapping_price_history"."effective_to" > "supplier_mapping_price_history"."effective_from");--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_status_ck" CHECK ("supplier_mappings"."status" in ('ACTIVE','INACTIVE'));--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_version_ck" CHECK ("supplier_mappings"."version" > 0);--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_conversion_ck" CHECK ("supplier_mappings"."conversion_numerator" > 0 and "supplier_mappings"."conversion_denominator" > 0);--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_period_ck" CHECK ("supplier_mappings"."valid_to" is null or "supplier_mappings"."valid_to" > "supplier_mappings"."valid_from");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "supplier_mappings" ADD CONSTRAINT "supplier_mappings_active_period_excl" EXCLUDE USING gist (
  "supplier_id" WITH =,
  "supplier_item_code" WITH =,
  "manufacturer" WITH =,
  "mpn" WITH =,
  "revision" WITH =,
  tstzrange("valid_from",coalesce("valid_to",'infinity'::timestamptz),'[)') WITH &&
) WHERE ("status" = 'ACTIVE' AND "supplier_id" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_released_product_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'RELEASED' THEN
    RAISE EXCEPTION 'released product version is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_versions_released_immutable
BEFORE UPDATE OR DELETE ON "product_versions"
FOR EACH ROW EXECUTE FUNCTION reject_released_product_version_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_released_bom_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'RELEASED' THEN
    RAISE EXCEPTION 'released bom version is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER bom_versions_released_immutable
BEFORE UPDATE OR DELETE ON "bom_versions"
FOR EACH ROW EXECUTE FUNCTION reject_released_bom_version_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_released_bom_line_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id bigint;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.bom_version_id ELSE NEW.bom_version_id END;
  IF EXISTS (SELECT 1 FROM bom_versions WHERE id = target_version_id AND status = 'RELEASED') THEN
    RAISE EXCEPTION 'released bom lines are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.bom_version_id <> NEW.bom_version_id
     AND EXISTS (SELECT 1 FROM bom_versions WHERE id = OLD.bom_version_id AND status = 'RELEASED') THEN
    RAISE EXCEPTION 'released bom lines are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER bom_lines_released_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "bom_lines"
FOR EACH ROW EXECUTE FUNCTION reject_released_bom_line_mutation();
