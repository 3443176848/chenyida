CREATE TABLE "inventory_adjustment_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"adjustment_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"balance_id" bigint NOT NULL,
	"ledger_entry_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"location_code" text DEFAULT 'MAIN' NOT NULL,
	"lot_code" text DEFAULT '' NOT NULL,
	"requested_qty" numeric(24, 6),
	"counted_qty" numeric(24, 6),
	"on_hand_delta" numeric(24, 6) DEFAULT '0' NOT NULL,
	"frozen_delta" numeric(24, 6) DEFAULT '0' NOT NULL,
	"before_on_hand_qty" numeric(24, 6) NOT NULL,
	"after_on_hand_qty" numeric(24, 6) NOT NULL,
	"before_frozen_qty" numeric(24, 6) NOT NULL,
	"after_frozen_qty" numeric(24, 6) NOT NULL,
	"balance_version_before" integer NOT NULL,
	"balance_version_after" integer NOT NULL,
	CONSTRAINT "inventory_adjustment_lines_line_ck" CHECK ("inventory_adjustment_lines"."line_no" > 0),
	CONSTRAINT "inventory_adjustment_lines_location_ck" CHECK ("inventory_adjustment_lines"."location_code" = 'MAIN' and "inventory_adjustment_lines"."lot_code" = ''),
	CONSTRAINT "inventory_adjustment_lines_input_ck" CHECK (("inventory_adjustment_lines"."requested_qty" is null) <> ("inventory_adjustment_lines"."counted_qty" is null) and coalesce("inventory_adjustment_lines"."requested_qty", "inventory_adjustment_lines"."counted_qty") >= 0),
	CONSTRAINT "inventory_adjustment_lines_delta_ck" CHECK ("inventory_adjustment_lines"."on_hand_delta" <> 0 or "inventory_adjustment_lines"."frozen_delta" <> 0),
	CONSTRAINT "inventory_adjustment_lines_math_ck" CHECK ("inventory_adjustment_lines"."after_on_hand_qty" = "inventory_adjustment_lines"."before_on_hand_qty" + "inventory_adjustment_lines"."on_hand_delta" and "inventory_adjustment_lines"."after_frozen_qty" = "inventory_adjustment_lines"."before_frozen_qty" + "inventory_adjustment_lines"."frozen_delta"),
	CONSTRAINT "inventory_adjustment_lines_version_ck" CHECK ("inventory_adjustment_lines"."balance_version_before" >= 0 and "inventory_adjustment_lines"."balance_version_after" = "inventory_adjustment_lines"."balance_version_before" + 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_adjustments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"adjustment_code" text NOT NULL,
	"operation_type" text NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reversal_of_adjustment_id" bigint,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_adjustments_type_ck" CHECK ("inventory_adjustments"."operation_type" in ('RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL')),
	CONSTRAINT "inventory_adjustments_status_ck" CHECK ("inventory_adjustments"."status" = 'POSTED'),
	CONSTRAINT "inventory_adjustments_reason_ck" CHECK (char_length(btrim("inventory_adjustments"."reason")) between 1 and 1000),
	CONSTRAINT "inventory_adjustments_reversal_ck" CHECK (("inventory_adjustments"."operation_type" = 'REVERSAL' and "inventory_adjustments"."reversal_of_adjustment_id" is not null) or ("inventory_adjustments"."operation_type" <> 'REVERSAL' and "inventory_adjustments"."reversal_of_adjustment_id" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"adjustment_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"balance_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"location_code" text DEFAULT 'MAIN' NOT NULL,
	"lot_code" text DEFAULT '' NOT NULL,
	"entry_type" text NOT NULL,
	"on_hand_delta" numeric(24, 6) DEFAULT '0' NOT NULL,
	"frozen_delta" numeric(24, 6) DEFAULT '0' NOT NULL,
	"before_on_hand_qty" numeric(24, 6) NOT NULL,
	"after_on_hand_qty" numeric(24, 6) NOT NULL,
	"before_frozen_qty" numeric(24, 6) NOT NULL,
	"after_frozen_qty" numeric(24, 6) NOT NULL,
	"balance_version_before" integer NOT NULL,
	"balance_version_after" integer NOT NULL,
	"reversal_of_ledger_entry_id" bigint,
	"source_type" text DEFAULT 'INVENTORY_ADJUSTMENT' NOT NULL,
	"source_id" bigint NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_ledger_entries_line_ck" CHECK ("inventory_ledger_entries"."line_no" > 0),
	CONSTRAINT "inventory_ledger_entries_type_ck" CHECK ("inventory_ledger_entries"."entry_type" in ('RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL')),
	CONSTRAINT "inventory_ledger_entries_location_ck" CHECK ("inventory_ledger_entries"."location_code" = 'MAIN' and "inventory_ledger_entries"."lot_code" = ''),
	CONSTRAINT "inventory_ledger_entries_delta_ck" CHECK ("inventory_ledger_entries"."on_hand_delta" <> 0 or "inventory_ledger_entries"."frozen_delta" <> 0),
	CONSTRAINT "inventory_ledger_entries_math_ck" CHECK ("inventory_ledger_entries"."after_on_hand_qty" = "inventory_ledger_entries"."before_on_hand_qty" + "inventory_ledger_entries"."on_hand_delta" and "inventory_ledger_entries"."after_frozen_qty" = "inventory_ledger_entries"."before_frozen_qty" + "inventory_ledger_entries"."frozen_delta"),
	CONSTRAINT "inventory_ledger_entries_quantity_ck" CHECK ("inventory_ledger_entries"."before_on_hand_qty" >= 0 and "inventory_ledger_entries"."after_on_hand_qty" >= 0 and "inventory_ledger_entries"."before_frozen_qty" >= 0 and "inventory_ledger_entries"."after_frozen_qty" >= 0 and "inventory_ledger_entries"."after_frozen_qty" <= "inventory_ledger_entries"."after_on_hand_qty"),
	CONSTRAINT "inventory_ledger_entries_version_ck" CHECK ("inventory_ledger_entries"."balance_version_before" >= 0 and "inventory_ledger_entries"."balance_version_after" = "inventory_ledger_entries"."balance_version_before" + 1),
	CONSTRAINT "inventory_ledger_entries_source_ck" CHECK ("inventory_ledger_entries"."source_type" = 'INVENTORY_ADJUSTMENT' and "inventory_ledger_entries"."source_id" = "inventory_ledger_entries"."adjustment_id"),
	CONSTRAINT "inventory_ledger_entries_reversal_ck" CHECK (("inventory_ledger_entries"."entry_type" = 'REVERSAL' and "inventory_ledger_entries"."reversal_of_ledger_entry_id" is not null) or ("inventory_ledger_entries"."entry_type" <> 'REVERSAL' and "inventory_ledger_entries"."reversal_of_ledger_entry_id" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_balances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"location_code" text DEFAULT 'MAIN' NOT NULL,
	"lot_code" text DEFAULT '' NOT NULL,
	"on_hand_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reserved_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"frozen_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_ledger_entry_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_stock_balances_location_ck" CHECK ("inventory_stock_balances"."location_code" = 'MAIN' and "inventory_stock_balances"."lot_code" = ''),
	CONSTRAINT "inventory_stock_balances_quantity_ck" CHECK ("inventory_stock_balances"."on_hand_qty" >= 0 and "inventory_stock_balances"."reserved_qty" >= 0 and "inventory_stock_balances"."frozen_qty" >= 0 and "inventory_stock_balances"."on_hand_qty" >= "inventory_stock_balances"."reserved_qty" + "inventory_stock_balances"."frozen_qty"),
	CONSTRAINT "inventory_stock_balances_version_ck" CHECK ("inventory_stock_balances"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_balance_id_inventory_stock_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."inventory_stock_balances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_reversal_of_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("reversal_of_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_adjustment_id_inventory_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_balance_id_inventory_stock_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."inventory_stock_balances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_reversal_of_ledger_entry_id_inventory_ledger_entries_id_fk" FOREIGN KEY ("reversal_of_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustment_lines_adjustment_line_uq" ON "inventory_adjustment_lines" USING btree ("adjustment_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustment_lines_ledger_uq" ON "inventory_adjustment_lines" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "inventory_adjustment_lines_material_idx" ON "inventory_adjustment_lines" USING btree ("material_id","adjustment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustments_code_uq" ON "inventory_adjustments" USING btree ("adjustment_code");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustments_operation_uq" ON "inventory_adjustments" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustments_request_uq" ON "inventory_adjustments" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustments_reversal_uq" ON "inventory_adjustments" USING btree ("reversal_of_adjustment_id") WHERE "inventory_adjustments"."reversal_of_adjustment_id" is not null;--> statement-breakpoint
CREATE INDEX "inventory_adjustments_created_idx" ON "inventory_adjustments" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_type_created_idx" ON "inventory_adjustments" USING btree ("operation_type","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_ledger_entries_operation_uq" ON "inventory_ledger_entries" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_ledger_entries_adjustment_line_uq" ON "inventory_ledger_entries" USING btree ("adjustment_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_ledger_entries_reversal_uq" ON "inventory_ledger_entries" USING btree ("reversal_of_ledger_entry_id") WHERE "inventory_ledger_entries"."reversal_of_ledger_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "inventory_ledger_entries_material_created_idx" ON "inventory_ledger_entries" USING btree ("material_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inventory_ledger_entries_balance_id_idx" ON "inventory_ledger_entries" USING btree ("balance_id","id");--> statement-breakpoint
CREATE INDEX "inventory_ledger_entries_source_idx" ON "inventory_ledger_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_balances_position_uq" ON "inventory_stock_balances" USING btree ("material_id","location_code","lot_code");--> statement-breakpoint
CREATE INDEX "inventory_stock_balances_material_idx" ON "inventory_stock_balances" USING btree ("material_id","updated_at");
--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_last_ledger_entry_id_fk" FOREIGN KEY ("last_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_require_service_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('cyd.inventory_service_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'inventory balance writes require inventory service transaction';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_stock_balances_service_write
BEFORE INSERT OR UPDATE OR DELETE ON "inventory_stock_balances"
FOR EACH ROW EXECUTE FUNCTION inventory_require_service_write();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_posted_record_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'posted inventory records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_adjustments_immutable
BEFORE UPDATE OR DELETE ON "inventory_adjustments"
FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE TRIGGER inventory_adjustment_lines_immutable
BEFORE UPDATE OR DELETE ON "inventory_adjustment_lines"
FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
--> statement-breakpoint
CREATE TRIGGER inventory_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON "inventory_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION inventory_posted_record_immutable();
