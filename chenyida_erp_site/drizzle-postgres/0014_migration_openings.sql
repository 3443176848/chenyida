CREATE TABLE "migration_opening_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"migration_run_id" uuid NOT NULL,
	"manifest_sha256" text NOT NULL,
	"source_system" text NOT NULL,
	"source_entity_kind" text NOT NULL,
	"source_stable_reference_digest" text NOT NULL,
	"source_record_digest" text NOT NULL,
	"mapping_digest" text NOT NULL,
	"target_digest" text NOT NULL,
	"opening_type" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_opening_sources_manifest_ck" CHECK ("manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "migration_opening_sources_digest_ck" CHECK ("source_stable_reference_digest" ~ '^[0-9a-f]{64}$' and "source_record_digest" ~ '^[0-9a-f]{64}$' and "mapping_digest" ~ '^[0-9a-f]{64}$' and "target_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "migration_opening_sources_text_ck" CHECK (char_length(btrim("source_system")) between 1 and 80 and char_length(btrim("source_entity_kind")) between 1 and 80),
	CONSTRAINT "migration_opening_sources_type_ck" CHECK ("opening_type" in ('INVENTORY','AR','AP')),
	CONSTRAINT "migration_opening_sources_status_ck" CHECK ("status" = 'POSTED')
);
--> statement-breakpoint
CREATE TABLE "inventory_migration_openings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"migration_opening_source_id" uuid NOT NULL,
	"opening_code" text NOT NULL,
	"inventory_adjustment_id" bigint NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_migration_openings_status_ck" CHECK ("status" = 'POSTED')
);
--> statement-breakpoint
CREATE TABLE "inventory_migration_opening_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inventory_opening_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"location_code" text DEFAULT 'MAIN' NOT NULL,
	"lot_code" text DEFAULT '' NOT NULL,
	"on_hand_quantity" numeric(24, 6) NOT NULL,
	"frozen_quantity" numeric(24, 6) NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_migration_opening_lines_line_ck" CHECK ("line_no" > 0),
	CONSTRAINT "inventory_migration_opening_lines_location_ck" CHECK ("location_code" = 'MAIN' and "lot_code" = ''),
	CONSTRAINT "inventory_migration_opening_lines_quantity_ck" CHECK ("on_hand_quantity" > 0 and "frozen_quantity" >= 0 and "frozen_quantity" <= "on_hand_quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_migration_opening_reversals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inventory_opening_id" bigint NOT NULL,
	"inventory_adjustment_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_migration_opening_reversals_reason_ck" CHECK (char_length(btrim("reason")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "inventory_migration_opening_reversal_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"inventory_opening_reversal_id" bigint NOT NULL,
	"original_opening_line_id" bigint NOT NULL,
	"inventory_ledger_entry_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_opening_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"migration_opening_source_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"customer_id" bigint,
	"supplier_id" bigint,
	"currency_code" text NOT NULL,
	"opening_outstanding_amount" numeric(24, 6) NOT NULL,
	"accounting_date" date NOT NULL,
	"business_reference_digest" text NOT NULL,
	"finance_document_id" bigint NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_opening_sources_direction_ck" CHECK (("direction"='AR' and "customer_id" is not null and "supplier_id" is null) or ("direction"='AP' and "supplier_id" is not null and "customer_id" is null)),
	CONSTRAINT "finance_opening_sources_currency_ck" CHECK ("currency_code" = 'CNY'),
	CONSTRAINT "finance_opening_sources_amount_ck" CHECK ("opening_outstanding_amount" > 0),
	CONSTRAINT "finance_opening_sources_reference_ck" CHECK ("business_reference_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "finance_opening_sources_status_ck" CHECK ("status" = 'POSTED')
);
--> statement-breakpoint
CREATE TABLE "finance_opening_reversals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"finance_opening_source_id" bigint NOT NULL,
	"finance_document_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_opening_reversals_reason_ck" CHECK (char_length(btrim("reason")) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "finance_documents" ADD COLUMN "finance_opening_source_id" bigint;
--> statement-breakpoint
ALTER TABLE "migration_opening_sources" ADD CONSTRAINT "migration_opening_sources_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_openings" ADD CONSTRAINT "inventory_migration_openings_source_fk" FOREIGN KEY ("migration_opening_source_id") REFERENCES "public"."migration_opening_sources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_openings" ADD CONSTRAINT "inventory_migration_openings_adjustment_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "inventory_migration_openings" ADD CONSTRAINT "inventory_migration_openings_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_lines" ADD CONSTRAINT "inventory_migration_opening_lines_opening_fk" FOREIGN KEY ("inventory_opening_id") REFERENCES "public"."inventory_migration_openings"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_lines" ADD CONSTRAINT "inventory_migration_opening_lines_material_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_lines" ADD CONSTRAINT "inventory_migration_opening_lines_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_lines" ADD CONSTRAINT "inventory_migration_opening_lines_ledger_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_reversals" ADD CONSTRAINT "inventory_migration_opening_reversals_opening_fk" FOREIGN KEY ("inventory_opening_id") REFERENCES "public"."inventory_migration_openings"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_reversals" ADD CONSTRAINT "inventory_migration_opening_reversals_adjustment_fk" FOREIGN KEY ("inventory_adjustment_id") REFERENCES "public"."inventory_adjustments"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_reversals" ADD CONSTRAINT "inventory_migration_opening_reversals_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_reversal_lines" ADD CONSTRAINT "inventory_migration_opening_reversal_lines_reversal_fk" FOREIGN KEY ("inventory_opening_reversal_id") REFERENCES "public"."inventory_migration_opening_reversals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_reversal_lines" ADD CONSTRAINT "inventory_migration_opening_reversal_lines_original_fk" FOREIGN KEY ("original_opening_line_id") REFERENCES "public"."inventory_migration_opening_lines"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_migration_opening_reversal_lines" ADD CONSTRAINT "inventory_migration_opening_reversal_lines_ledger_fk" FOREIGN KEY ("inventory_ledger_entry_id") REFERENCES "public"."inventory_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_opening_sources" ADD CONSTRAINT "finance_opening_sources_migration_source_fk" FOREIGN KEY ("migration_opening_source_id") REFERENCES "public"."migration_opening_sources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_opening_sources" ADD CONSTRAINT "finance_opening_sources_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_opening_sources" ADD CONSTRAINT "finance_opening_sources_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_opening_sources" ADD CONSTRAINT "finance_opening_sources_document_fk" FOREIGN KEY ("finance_document_id") REFERENCES "public"."finance_documents"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "finance_opening_sources" ADD CONSTRAINT "finance_opening_sources_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_opening_source_fk" FOREIGN KEY ("finance_opening_source_id") REFERENCES "public"."finance_opening_sources"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "finance_opening_reversals" ADD CONSTRAINT "finance_opening_reversals_source_fk" FOREIGN KEY ("finance_opening_source_id") REFERENCES "public"."finance_opening_sources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_opening_reversals" ADD CONSTRAINT "finance_opening_reversals_document_fk" FOREIGN KEY ("finance_document_id") REFERENCES "public"."finance_documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_opening_reversals" ADD CONSTRAINT "finance_opening_reversals_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_opening_sources_stable_uq" ON "migration_opening_sources" ("source_system","source_entity_kind","source_stable_reference_digest","opening_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_opening_sources_manifest_uq" ON "migration_opening_sources" ("manifest_sha256","source_entity_kind","source_stable_reference_digest","opening_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_opening_sources_operation_uq" ON "migration_opening_sources" ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_opening_sources_request_uq" ON "migration_opening_sources" ("request_id");
--> statement-breakpoint
CREATE INDEX "migration_opening_sources_run_idx" ON "migration_opening_sources" ("migration_run_id","opening_type","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_openings_source_uq" ON "inventory_migration_openings" ("migration_opening_source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_openings_code_uq" ON "inventory_migration_openings" ("opening_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_openings_adjustment_uq" ON "inventory_migration_openings" ("inventory_adjustment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_openings_operation_uq" ON "inventory_migration_openings" ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_lines_position_uq" ON "inventory_migration_opening_lines" ("inventory_opening_id","material_id","unit_id","location_code","lot_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_lines_line_uq" ON "inventory_migration_opening_lines" ("inventory_opening_id","line_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_lines_ledger_uq" ON "inventory_migration_opening_lines" ("inventory_ledger_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_reversals_opening_uq" ON "inventory_migration_opening_reversals" ("inventory_opening_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_reversals_adjustment_uq" ON "inventory_migration_opening_reversals" ("inventory_adjustment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_reversals_operation_uq" ON "inventory_migration_opening_reversals" ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_reversal_lines_original_uq" ON "inventory_migration_opening_reversal_lines" ("original_opening_line_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_migration_opening_reversal_lines_ledger_uq" ON "inventory_migration_opening_reversal_lines" ("inventory_ledger_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_opening_sources_migration_source_uq" ON "finance_opening_sources" ("migration_opening_source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_opening_sources_document_uq" ON "finance_opening_sources" ("finance_document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_opening_sources_operation_uq" ON "finance_opening_sources" ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_documents_opening_source_uq" ON "finance_documents" ("finance_opening_source_id") WHERE "finance_opening_source_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_opening_reversals_source_uq" ON "finance_opening_reversals" ("finance_opening_source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_opening_reversals_operation_uq" ON "finance_opening_reversals" ("operation_id");
--> statement-breakpoint
ALTER TABLE "inventory_adjustments" DROP CONSTRAINT "inventory_adjustments_type_ck";
--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_type_ck" CHECK ("operation_type" in ('RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL','MIGRATION_OPENING'));
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" DROP CONSTRAINT "inventory_ledger_entries_type_ck";
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_type_ck" CHECK ("entry_type" in ('RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL','MIGRATION_OPENING'));
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" DROP CONSTRAINT "inventory_ledger_entries_source_ck";
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_source_ck" CHECK (("source_type"='INVENTORY_ADJUSTMENT' and "source_id"="adjustment_id") or ("entry_type"='MIGRATION_OPENING' and "source_type"='MIGRATION_OPENING') or ("entry_type"='REVERSAL' and "source_type"='MIGRATION_OPENING_REVERSAL'));
--> statement-breakpoint
ALTER TABLE "finance_documents" DROP CONSTRAINT "finance_documents_type_ck";
--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_type_ck" CHECK ("doc_type" in ('AR','AP','OPENING_AR','OPENING_AP'));
--> statement-breakpoint
ALTER TABLE "finance_documents" DROP CONSTRAINT "finance_documents_source_ck";
--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_source_ck" CHECK (("doc_type"='AR' and "sales_source_entry_id" is not null and "purchase_source_entry_id" is null and "finance_opening_source_id" is null and "customer_id" is not null and "supplier_id" is null) or ("doc_type"='AP' and "purchase_source_entry_id" is not null and "sales_source_entry_id" is null and "finance_opening_source_id" is null and "supplier_id" is not null and "customer_id" is null) or ("doc_type"='OPENING_AR' and "finance_opening_source_id" is not null and "sales_source_entry_id" is null and "purchase_source_entry_id" is null and "customer_id" is not null and "supplier_id" is null) or ("doc_type"='OPENING_AP' and "finance_opening_source_id" is not null and "sales_source_entry_id" is null and "purchase_source_entry_id" is null and "supplier_id" is not null and "customer_id" is null));
--> statement-breakpoint
ALTER TABLE "finance_documents" DROP CONSTRAINT "finance_documents_status_ck";
--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_status_ck" CHECK ("status" in ('OPEN','PARTIALLY_SETTLED','SETTLED','REVERSED'));
--> statement-breakpoint
ALTER TABLE "finance_documents" DROP CONSTRAINT "finance_documents_projection_ck";
--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_projection_ck" CHECK (("status"='OPEN' and "settled_amount"=0) or ("status"='PARTIALLY_SETTLED' and "settled_amount">0 and "settled_amount"<"total_amount") or ("status"='SETTLED' and "settled_amount"="total_amount") or ("status"='REVERSED' and "settled_amount"=0 and "doc_type" in ('OPENING_AR','OPENING_AP')));
--> statement-breakpoint
ALTER TABLE "finance_document_events" DROP CONSTRAINT "finance_document_events_type_ck";
--> statement-breakpoint
ALTER TABLE "finance_document_events" ADD CONSTRAINT "finance_document_events_type_ck" CHECK ("event_type" in ('CREATED','SETTLED','SETTLEMENT_REVERSED','OPENING_REVERSED'));
--> statement-breakpoint
ALTER TABLE "finance_document_events" DROP CONSTRAINT "finance_document_events_status_ck";
--> statement-breakpoint
ALTER TABLE "finance_document_events" ADD CONSTRAINT "finance_document_events_status_ck" CHECK ("from_status" is null or "from_status" in ('OPEN','PARTIALLY_SETTLED','SETTLED','REVERSED'));
--> statement-breakpoint
ALTER TABLE "finance_document_events" DROP CONSTRAINT "finance_document_events_to_status_ck";
--> statement-breakpoint
ALTER TABLE "finance_document_events" ADD CONSTRAINT "finance_document_events_to_status_ck" CHECK ("to_status" in ('OPEN','PARTIALLY_SETTLED','SETTLED','REVERSED'));
--> statement-breakpoint
CREATE FUNCTION cyd_migration_opening_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cyd.migration_opening_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'migration openings require internal MigrationOpeningService'; END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'migration opening facts are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_inventory_migration_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='inventory_adjustments' THEN
    IF NEW.operation_type='MIGRATION_OPENING' AND current_setting('cyd.migration_opening_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'migration inventory facts require internal MigrationOpeningService'; END IF;
  ELSIF TG_TABLE_NAME='inventory_ledger_entries' THEN
    IF NEW.source_type IN ('MIGRATION_OPENING','MIGRATION_OPENING_REVERSAL') AND current_setting('cyd.migration_opening_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'migration inventory facts require internal MigrationOpeningService'; END IF;
    IF NEW.source_type='MIGRATION_OPENING' AND NOT EXISTS (SELECT 1 FROM inventory_migration_openings WHERE id=NEW.source_id AND inventory_adjustment_id=NEW.adjustment_id) THEN RAISE EXCEPTION 'inventory migration opening source mismatch'; END IF;
    IF NEW.source_type='MIGRATION_OPENING_REVERSAL' AND NOT EXISTS (SELECT 1 FROM inventory_migration_opening_reversals WHERE id=NEW.source_id AND inventory_adjustment_id=NEW.adjustment_id) THEN RAISE EXCEPTION 'inventory migration reversal source mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_adjustments_migration_source_guard BEFORE INSERT ON inventory_adjustments FOR EACH ROW EXECUTE FUNCTION cyd_inventory_migration_source_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_ledger_migration_source_guard BEFORE INSERT ON inventory_ledger_entries FOR EACH ROW EXECUTE FUNCTION cyd_inventory_migration_source_guard();
--> statement-breakpoint
CREATE TRIGGER migration_opening_sources_guard BEFORE INSERT OR UPDATE OR DELETE ON migration_opening_sources FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_migration_openings_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_migration_openings FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_migration_opening_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_migration_opening_lines FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_migration_opening_reversals_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_migration_opening_reversals FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_migration_opening_reversal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_migration_opening_reversal_lines FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE TRIGGER finance_opening_sources_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_opening_sources FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE TRIGGER finance_opening_reversals_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_opening_reversals FOR EACH ROW EXECUTE FUNCTION cyd_migration_opening_fact_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_finance_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src record; projected numeric;
BEGIN
  IF current_setting('cyd.finance_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'finance documents require FinanceService'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'finance documents are immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.doc_code<>OLD.doc_code OR NEW.doc_type<>OLD.doc_type OR NEW.sales_source_entry_id IS DISTINCT FROM OLD.sales_source_entry_id OR NEW.purchase_source_entry_id IS DISTINCT FROM OLD.purchase_source_entry_id OR NEW.finance_opening_source_id IS DISTINCT FROM OLD.finance_opening_source_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.currency_code<>OLD.currency_code OR NEW.total_amount<>OLD.total_amount OR NEW.accounting_date<>OLD.accounting_date OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.operation_id<>OLD.operation_id OR NEW.created_by<>OLD.created_by OR NEW.request_id<>OLD.request_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'finance document facts are immutable'; END IF;
    SELECT coalesce(sum(amount),0) INTO projected FROM finance_settlements WHERE document_id=OLD.id;
    IF NEW.settled_amount<>projected OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'finance document projection mismatch'; END IF;
    IF NEW.status='REVERSED' AND (OLD.doc_type NOT IN ('OPENING_AR','OPENING_AP') OR projected<>0 OR current_setting('cyd.migration_opening_service_write', true) IS DISTINCT FROM 'allowed' OR NOT EXISTS (SELECT 1 FROM finance_opening_reversals WHERE finance_document_id=OLD.id)) THEN RAISE EXCEPTION 'finance opening reversal mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.doc_type='AR' THEN
    SELECT id,customer_id,null::bigint supplier_id,amount,currency_code,entry_type INTO src FROM sales_financial_source_entries WHERE id=NEW.sales_source_entry_id FOR UPDATE;
  ELSIF NEW.doc_type='AP' THEN
    SELECT id,null::bigint customer_id,supplier_id,amount,currency_code,entry_type INTO src FROM purchase_financial_source_entries WHERE id=NEW.purchase_source_entry_id FOR UPDATE;
  ELSE
    IF current_setting('cyd.migration_opening_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'finance openings require internal MigrationOpeningService'; END IF;
    SELECT id,customer_id,supplier_id,opening_outstanding_amount amount,currency_code,direction entry_type INTO src FROM finance_opening_sources WHERE id=NEW.finance_opening_source_id AND finance_document_id=NEW.id FOR UPDATE;
  END IF;
  IF src.id IS NULL OR src.amount<=0 OR src.amount<>NEW.total_amount OR src.currency_code<>NEW.currency_code OR (NEW.doc_type IN ('AR','OPENING_AR') AND (src.customer_id IS DISTINCT FROM NEW.customer_id OR src.entry_type NOT IN ('SHIPMENT','AR'))) OR (NEW.doc_type IN ('AP','OPENING_AP') AND (src.supplier_id IS DISTINCT FROM NEW.supplier_id OR src.entry_type NOT IN ('RECEIPT','AP'))) THEN RAISE EXCEPTION 'finance source mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_finance_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; o record;
BEGIN
  SELECT id,doc_type,status INTO d FROM finance_documents WHERE id=NEW.document_id FOR SHARE;
  IF d.id IS NULL OR d.status='REVERSED' OR (d.doc_type IN ('AR','OPENING_AR') AND NEW.settlement_type NOT IN ('RECEIPT','RECEIPT_REVERSAL')) OR (d.doc_type IN ('AP','OPENING_AP') AND NEW.settlement_type NOT IN ('PAYMENT','PAYMENT_REVERSAL')) THEN RAISE EXCEPTION 'finance settlement type mismatch'; END IF;
  IF NEW.original_settlement_id IS NOT NULL THEN SELECT * INTO o FROM finance_settlements WHERE id=NEW.original_settlement_id FOR SHARE; IF o.id IS NULL OR o.document_id<>NEW.document_id OR o.original_settlement_id IS NOT NULL OR NEW.amount<>-o.amount OR NEW.settlement_type<>o.settlement_type||'_REVERSAL' THEN RAISE EXCEPTION 'finance settlement reversal mismatch'; END IF; END IF;
  RETURN NEW;
END $$;
