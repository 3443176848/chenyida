CREATE TABLE "finance_document_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"amount" numeric(24, 6),
	"settlement_id" bigint,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_document_events_type_ck" CHECK ("finance_document_events"."event_type" in ('CREATED','SETTLED','SETTLEMENT_REVERSED')),
	CONSTRAINT "finance_document_events_status_ck" CHECK ("finance_document_events"."from_status" is null or "finance_document_events"."from_status" in ('OPEN','PARTIALLY_SETTLED','SETTLED')),
	CONSTRAINT "finance_document_events_to_status_ck" CHECK ("finance_document_events"."to_status" in ('OPEN','PARTIALLY_SETTLED','SETTLED'))
);
--> statement-breakpoint
CREATE TABLE "finance_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_code" text NOT NULL,
	"doc_type" text NOT NULL,
	"sales_source_entry_id" bigint,
	"purchase_source_entry_id" bigint,
	"customer_id" bigint,
	"supplier_id" bigint,
	"currency_code" text NOT NULL,
	"total_amount" numeric(24, 6) NOT NULL,
	"settled_amount" numeric(24, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"accounting_date" date NOT NULL,
	"due_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_documents_type_ck" CHECK ("finance_documents"."doc_type" in ('AR','AP')),
	CONSTRAINT "finance_documents_source_ck" CHECK (("finance_documents"."doc_type"='AR' and "finance_documents"."sales_source_entry_id" is not null and "finance_documents"."purchase_source_entry_id" is null and "finance_documents"."customer_id" is not null and "finance_documents"."supplier_id" is null) or ("finance_documents"."doc_type"='AP' and "finance_documents"."purchase_source_entry_id" is not null and "finance_documents"."sales_source_entry_id" is null and "finance_documents"."supplier_id" is not null and "finance_documents"."customer_id" is null)),
	CONSTRAINT "finance_documents_amount_ck" CHECK ("finance_documents"."total_amount">0 and "finance_documents"."settled_amount">=0 and "finance_documents"."settled_amount"<="finance_documents"."total_amount"),
	CONSTRAINT "finance_documents_status_ck" CHECK ("finance_documents"."status" in ('OPEN','PARTIALLY_SETTLED','SETTLED')),
	CONSTRAINT "finance_documents_projection_ck" CHECK (("finance_documents"."status"='OPEN' and "finance_documents"."settled_amount"=0) or ("finance_documents"."status"='PARTIALLY_SETTLED' and "finance_documents"."settled_amount">0 and "finance_documents"."settled_amount"<"finance_documents"."total_amount") or ("finance_documents"."status"='SETTLED' and "finance_documents"."settled_amount"="finance_documents"."total_amount")),
	CONSTRAINT "finance_documents_currency_ck" CHECK ("finance_documents"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "finance_documents_version_ck" CHECK ("finance_documents"."version">0)
);
--> statement-breakpoint
CREATE TABLE "finance_settlements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"settlement_code" text NOT NULL,
	"document_id" bigint NOT NULL,
	"settlement_type" text NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"original_settlement_id" bigint,
	"accounting_date" date NOT NULL,
	"account_name" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_settlements_type_ck" CHECK ("finance_settlements"."settlement_type" in ('RECEIPT','PAYMENT','RECEIPT_REVERSAL','PAYMENT_REVERSAL')),
	CONSTRAINT "finance_settlements_amount_ck" CHECK (("finance_settlements"."settlement_type" in ('RECEIPT','PAYMENT') and "finance_settlements"."amount">0 and "finance_settlements"."original_settlement_id" is null) or ("finance_settlements"."settlement_type" in ('RECEIPT_REVERSAL','PAYMENT_REVERSAL') and "finance_settlements"."amount"<0 and "finance_settlements"."original_settlement_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "finance_document_events" ADD CONSTRAINT "finance_document_events_document_id_finance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."finance_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_document_events" ADD CONSTRAINT "finance_document_events_settlement_id_finance_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."finance_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_document_events" ADD CONSTRAINT "finance_document_events_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_sales_source_entry_id_sales_financial_source_entries_id_fk" FOREIGN KEY ("sales_source_entry_id") REFERENCES "public"."sales_financial_source_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_purchase_source_entry_id_purchase_financial_source_entries_id_fk" FOREIGN KEY ("purchase_source_entry_id") REFERENCES "public"."purchase_financial_source_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settlements" ADD CONSTRAINT "finance_settlements_document_id_finance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."finance_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settlements" ADD CONSTRAINT "finance_settlements_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settlements" ADD CONSTRAINT "finance_settlements_original_fk" FOREIGN KEY ("original_settlement_id") REFERENCES "public"."finance_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_document_events_document_idx" ON "finance_document_events" USING btree ("document_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_documents_code_uq" ON "finance_documents" USING btree ("doc_code");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_documents_sales_source_uq" ON "finance_documents" USING btree ("sales_source_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_documents_purchase_source_uq" ON "finance_documents" USING btree ("purchase_source_entry_id");--> statement-breakpoint
CREATE INDEX "finance_documents_status_idx" ON "finance_documents" USING btree ("doc_type","status","due_date","id");--> statement-breakpoint
CREATE INDEX "finance_documents_customer_idx" ON "finance_documents" USING btree ("customer_id","id");--> statement-breakpoint
CREATE INDEX "finance_documents_supplier_idx" ON "finance_documents" USING btree ("supplier_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_settlements_code_uq" ON "finance_settlements" USING btree ("settlement_code");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_settlements_reversal_uq" ON "finance_settlements" USING btree ("original_settlement_id");--> statement-breakpoint
CREATE INDEX "finance_settlements_document_idx" ON "finance_settlements" USING btree ("document_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION cyd_finance_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src record; projected numeric;
BEGIN
  IF current_setting('cyd.finance_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'finance documents require FinanceService'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'finance documents are immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.doc_code<>OLD.doc_code OR NEW.doc_type<>OLD.doc_type OR NEW.sales_source_entry_id IS DISTINCT FROM OLD.sales_source_entry_id OR NEW.purchase_source_entry_id IS DISTINCT FROM OLD.purchase_source_entry_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.currency_code<>OLD.currency_code OR NEW.total_amount<>OLD.total_amount OR NEW.accounting_date<>OLD.accounting_date OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.operation_id<>OLD.operation_id OR NEW.created_by<>OLD.created_by OR NEW.request_id<>OLD.request_id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'finance document facts are immutable'; END IF;
    SELECT coalesce(sum(amount),0) INTO projected FROM finance_settlements WHERE document_id=OLD.id;
    IF NEW.settled_amount<>projected OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'finance document projection mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.doc_type='AR' THEN SELECT id,customer_id,null::bigint supplier_id,amount,currency_code,entry_type INTO src FROM sales_financial_source_entries WHERE id=NEW.sales_source_entry_id FOR UPDATE; ELSE SELECT id,null::bigint customer_id,supplier_id,amount,currency_code,entry_type INTO src FROM purchase_financial_source_entries WHERE id=NEW.purchase_source_entry_id FOR UPDATE; END IF;
  IF src.id IS NULL OR src.entry_type NOT IN ('SHIPMENT','RECEIPT') OR src.amount<=0 OR src.amount<>NEW.total_amount OR src.currency_code<>NEW.currency_code OR (NEW.doc_type='AR' AND src.customer_id<>NEW.customer_id) OR (NEW.doc_type='AP' AND src.supplier_id<>NEW.supplier_id) THEN RAISE EXCEPTION 'finance source mismatch'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_finance_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('cyd.finance_service_write', true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'finance facts require FinanceService'; END IF; IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'finance facts are immutable'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_finance_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; o record;
BEGIN
  SELECT id,doc_type INTO d FROM finance_documents WHERE id=NEW.document_id FOR SHARE;
  IF d.id IS NULL OR (d.doc_type='AR' AND NEW.settlement_type NOT IN ('RECEIPT','RECEIPT_REVERSAL')) OR (d.doc_type='AP' AND NEW.settlement_type NOT IN ('PAYMENT','PAYMENT_REVERSAL')) THEN RAISE EXCEPTION 'finance settlement type mismatch'; END IF;
  IF NEW.original_settlement_id IS NOT NULL THEN SELECT * INTO o FROM finance_settlements WHERE id=NEW.original_settlement_id FOR SHARE; IF o.id IS NULL OR o.document_id<>NEW.document_id OR o.original_settlement_id IS NOT NULL OR NEW.amount<>-o.amount OR NEW.settlement_type<>o.settlement_type||'_REVERSAL' THEN RAISE EXCEPTION 'finance settlement reversal mismatch'; END IF; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_finance_source_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_source_id bigint;
BEGIN
  IF TG_TABLE_NAME='sales_financial_source_entries' AND NEW.entry_type='SHIPMENT_REVERSAL' THEN
    SELECT id INTO original_source_id FROM sales_financial_source_entries WHERE id=NEW.reversal_of_source_entry_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM finance_documents WHERE sales_source_entry_id=original_source_id) THEN RAISE EXCEPTION 'posted finance document blocks source reversal'; END IF;
  ELSIF TG_TABLE_NAME='purchase_financial_source_entries' AND NEW.entry_type='RECEIPT_REVERSAL' THEN
    SELECT pf.id INTO original_source_id FROM purchase_receipts r JOIN purchase_financial_source_entries pf ON pf.purchase_receipt_id=r.reversal_of_receipt_id WHERE r.id=NEW.purchase_receipt_id FOR UPDATE OF pf;
    IF EXISTS(SELECT 1 FROM finance_documents WHERE purchase_source_entry_id=original_source_id) THEN RAISE EXCEPTION 'posted finance document blocks source reversal'; END IF;
  ELSE RETURN NEW; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finance_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_documents FOR EACH ROW EXECUTE FUNCTION cyd_finance_document_guard();
--> statement-breakpoint
CREATE TRIGGER finance_settlements_immutable BEFORE INSERT OR UPDATE OR DELETE ON finance_settlements FOR EACH ROW EXECUTE FUNCTION cyd_finance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER finance_settlements_consistency BEFORE INSERT ON finance_settlements FOR EACH ROW EXECUTE FUNCTION cyd_finance_settlement_guard();
--> statement-breakpoint
CREATE TRIGGER finance_document_events_immutable BEFORE INSERT OR UPDATE OR DELETE ON finance_document_events FOR EACH ROW EXECUTE FUNCTION cyd_finance_fact_guard();
--> statement-breakpoint
CREATE TRIGGER sales_finance_posting_guard BEFORE INSERT ON sales_financial_source_entries FOR EACH ROW EXECUTE FUNCTION cyd_finance_source_reversal_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_finance_posting_guard BEFORE INSERT ON purchase_financial_source_entries FOR EACH ROW EXECUTE FUNCTION cyd_finance_source_reversal_guard();
