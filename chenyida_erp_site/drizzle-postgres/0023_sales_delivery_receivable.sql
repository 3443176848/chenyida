CREATE TABLE "sales_delivery_execution_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instruction_line_id" bigint NOT NULL,
	"shipment_line_id" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"reversal_of_execution_id" bigint,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_delivery_execution_lines_type_ck" CHECK (("sales_delivery_execution_lines"."entry_type"='SHIPMENT' and "sales_delivery_execution_lines"."reversal_of_execution_id" is null) or ("sales_delivery_execution_lines"."entry_type"='REVERSAL' and "sales_delivery_execution_lines"."reversal_of_execution_id" is not null)),
	CONSTRAINT "sales_delivery_execution_lines_quantity_ck" CHECK ("sales_delivery_execution_lines"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "sales_delivery_instruction_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instruction_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_type" text NOT NULL,
	"quantity" numeric(24, 6) DEFAULT '0' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_delivery_instruction_events_status_ck" CHECK ("sales_delivery_instruction_events"."to_status" in ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','PARTIAL','COMPLETED','CANCELLED')),
	CONSTRAINT "sales_delivery_instruction_events_type_ck" CHECK ("sales_delivery_instruction_events"."event_type" in ('CREATED','SUBMITTED','ACCEPTED','RETURNED','CANCELLED','SHIPMENT_POSTED','SHIPMENT_REVERSED')),
	CONSTRAINT "sales_delivery_instruction_events_quantity_ck" CHECK ("sales_delivery_instruction_events"."quantity">=0)
);
--> statement-breakpoint
CREATE TABLE "sales_delivery_instruction_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instruction_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"sales_order_line_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_version_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"executed_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"source_digest" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_delivery_instruction_lines_quantity_ck" CHECK ("sales_delivery_instruction_lines"."line_no">0 and "sales_delivery_instruction_lines"."quantity">0 and "sales_delivery_instruction_lines"."executed_qty">=0 and "sales_delivery_instruction_lines"."executed_qty"<="sales_delivery_instruction_lines"."quantity" and "sales_delivery_instruction_lines"."version">0),
	CONSTRAINT "sales_delivery_instruction_lines_digest_ck" CHECK ("sales_delivery_instruction_lines"."source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "sales_delivery_instructions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"delivery_code" text NOT NULL,
	"sales_order_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"receiver" text NOT NULL,
	"shipping_address" text NOT NULL,
	"contact_info" text DEFAULT '' NOT NULL,
	"total_qty" numeric(24, 6) NOT NULL,
	"executed_qty" numeric(24, 6) DEFAULT '0' NOT NULL,
	"source_digest" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_delivery_instructions_status_ck" CHECK ("sales_delivery_instructions"."status" in ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','PARTIAL','COMPLETED','CANCELLED')),
	CONSTRAINT "sales_delivery_instructions_quantity_ck" CHECK ("sales_delivery_instructions"."total_qty">0 and "sales_delivery_instructions"."executed_qty">=0 and "sales_delivery_instructions"."executed_qty"<="sales_delivery_instructions"."total_qty"),
	CONSTRAINT "sales_delivery_instructions_projection_ck" CHECK (("sales_delivery_instructions"."status"='COMPLETED' and "sales_delivery_instructions"."executed_qty"="sales_delivery_instructions"."total_qty") or ("sales_delivery_instructions"."status"='PARTIAL' and "sales_delivery_instructions"."executed_qty">0 and "sales_delivery_instructions"."executed_qty"<"sales_delivery_instructions"."total_qty") or ("sales_delivery_instructions"."status" not in ('PARTIAL','COMPLETED') and "sales_delivery_instructions"."executed_qty"=0)),
	CONSTRAINT "sales_delivery_instructions_digest_ck" CHECK ("sales_delivery_instructions"."source_digest" ~ '^[0-9a-f]{64}$' and "sales_delivery_instructions"."version">0 and char_length(btrim("sales_delivery_instructions"."receiver")) between 1 and 1000 and char_length(btrim("sales_delivery_instructions"."shipping_address")) between 1 and 2000 and char_length("sales_delivery_instructions"."contact_info")<=1000)
);
--> statement-breakpoint
CREATE TABLE "sales_shipment_line_fqc_allocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_line_id" bigint NOT NULL,
	"quality_inspection_id" bigint NOT NULL,
	"fqc_allocation_id" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"reversal_of_allocation_id" bigint,
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_shipment_line_fqc_allocations_type_ck" CHECK (("sales_shipment_line_fqc_allocations"."entry_type"='SHIPMENT' and "sales_shipment_line_fqc_allocations"."reversal_of_allocation_id" is null) or ("sales_shipment_line_fqc_allocations"."entry_type"='REVERSAL' and "sales_shipment_line_fqc_allocations"."reversal_of_allocation_id" is not null)),
	CONSTRAINT "sales_shipment_line_fqc_allocations_quantity_ck" CHECK ("sales_shipment_line_fqc_allocations"."quantity">0)
);
--> statement-breakpoint
ALTER TABLE "sales_delivery_execution_lines" ADD CONSTRAINT "sales_delivery_execution_lines_instruction_line_id_sales_delivery_instruction_lines_id_fk" FOREIGN KEY ("instruction_line_id") REFERENCES "public"."sales_delivery_instruction_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_execution_lines" ADD CONSTRAINT "sales_delivery_execution_lines_shipment_line_id_sales_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."sales_shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_execution_lines" ADD CONSTRAINT "sales_delivery_execution_lines_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_execution_lines" ADD CONSTRAINT "sales_delivery_execution_lines_reversal_fk" FOREIGN KEY ("reversal_of_execution_id") REFERENCES "public"."sales_delivery_execution_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_events" ADD CONSTRAINT "sales_delivery_instruction_events_instruction_id_sales_delivery_instructions_id_fk" FOREIGN KEY ("instruction_id") REFERENCES "public"."sales_delivery_instructions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_events" ADD CONSTRAINT "sales_delivery_instruction_events_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_instruction_id_sales_delivery_instructions_id_fk" FOREIGN KEY ("instruction_id") REFERENCES "public"."sales_delivery_instructions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_material_id_material_master_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material_master"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instruction_lines" ADD CONSTRAINT "sales_delivery_instruction_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instructions" ADD CONSTRAINT "sales_delivery_instructions_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instructions" ADD CONSTRAINT "sales_delivery_instructions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_delivery_instructions" ADD CONSTRAINT "sales_delivery_instructions_created_by_app_users_username_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD CONSTRAINT "sales_shipment_line_fqc_allocations_shipment_line_id_sales_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."sales_shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD CONSTRAINT "sales_shipment_line_fqc_allocations_quality_inspection_id_quality_inspections_id_fk" FOREIGN KEY ("quality_inspection_id") REFERENCES "public"."quality_inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD CONSTRAINT "sales_shipment_line_fqc_allocations_fqc_allocation_id_finished_goods_sales_allocations_id_fk" FOREIGN KEY ("fqc_allocation_id") REFERENCES "public"."finished_goods_sales_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD CONSTRAINT "sales_shipment_line_fqc_allocations_actor_app_users_username_fk" FOREIGN KEY ("actor") REFERENCES "public"."app_users"("username") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD CONSTRAINT "sales_shipment_line_fqc_allocations_reversal_fk" FOREIGN KEY ("reversal_of_allocation_id") REFERENCES "public"."sales_shipment_line_fqc_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_execution_lines_shipment_line_uq" ON "sales_delivery_execution_lines" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_execution_lines_reversal_uq" ON "sales_delivery_execution_lines" USING btree ("reversal_of_execution_id") WHERE "sales_delivery_execution_lines"."reversal_of_execution_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_delivery_execution_lines_instruction_idx" ON "sales_delivery_execution_lines" USING btree ("instruction_line_id","id");--> statement-breakpoint
CREATE INDEX "sales_delivery_instruction_events_instruction_idx" ON "sales_delivery_instruction_events" USING btree ("instruction_id","id");--> statement-breakpoint
CREATE INDEX "sales_delivery_instruction_events_request_idx" ON "sales_delivery_instruction_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_instruction_lines_line_uq" ON "sales_delivery_instruction_lines" USING btree ("instruction_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_instruction_lines_order_line_uq" ON "sales_delivery_instruction_lines" USING btree ("instruction_id","sales_order_line_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_instruction_lines_order_line_idx" ON "sales_delivery_instruction_lines" USING btree ("sales_order_line_id","instruction_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_instructions_code_uq" ON "sales_delivery_instructions" USING btree ("delivery_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_delivery_instructions_operation_uq" ON "sales_delivery_instructions" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "sales_delivery_instructions_status_idx" ON "sales_delivery_instructions" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE INDEX "sales_delivery_instructions_order_idx" ON "sales_delivery_instructions" USING btree ("sales_order_id","status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipment_line_fqc_allocations_pair_uq" ON "sales_shipment_line_fqc_allocations" USING btree ("shipment_line_id","quality_inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipment_line_fqc_allocations_reversal_uq" ON "sales_shipment_line_fqc_allocations" USING btree ("reversal_of_allocation_id") WHERE "sales_shipment_line_fqc_allocations"."reversal_of_allocation_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_shipment_line_fqc_allocations_inspection_idx" ON "sales_shipment_line_fqc_allocations" USING btree ("quality_inspection_id","entry_type","id");--> statement-breakpoint
CREATE INDEX "sales_shipment_line_fqc_allocations_source_idx" ON "sales_shipment_line_fqc_allocations" USING btree ("fqc_allocation_id","entry_type","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_delivery_instruction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_count integer; line_total numeric(24,6); line_row record; reserved numeric(24,6); released numeric(24,6); consumed numeric(24,6); order_remaining numeric(24,6);
BEGIN
  IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'delivery instruction writes require sales service transaction' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'delivery instructions cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.executed_qty<>0 THEN RAISE EXCEPTION 'new delivery instruction state invalid' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_initial_state_ck'; END IF;
    IF NOT EXISTS(SELECT 1 FROM sales_orders WHERE id=NEW.sales_order_id AND customer_id=NEW.customer_id AND status IN ('OPEN','PARTIALLY_SHIPPED')) THEN RAISE EXCEPTION 'delivery instruction source order invalid' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_order_match_ck'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.delivery_code IS DISTINCT FROM OLD.delivery_code OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.receiver IS DISTINCT FROM OLD.receiver OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address OR NEW.contact_info IS DISTINCT FROM OLD.contact_info OR NEW.total_qty IS DISTINCT FROM OLD.total_qty OR NEW.source_digest IS DISTINCT FROM OLD.source_digest OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'delivery instruction stable facts are immutable' USING ERRCODE='55000'; END IF;
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('SUBMITTED','CANCELLED')) OR (OLD.status='RETURNED' AND NEW.status IN ('SUBMITTED','CANCELLED')) OR (OLD.status='SUBMITTED' AND NEW.status IN ('ACCEPTED','RETURNED','CANCELLED')) OR (OLD.status='ACCEPTED' AND NEW.status IN ('RETURNED','PARTIAL','COMPLETED')) OR (OLD.status='PARTIAL' AND NEW.status IN ('PARTIAL','COMPLETED','ACCEPTED')) OR (OLD.status='COMPLETED' AND NEW.status IN ('PARTIAL','ACCEPTED'))) THEN RAISE EXCEPTION 'delivery instruction transition invalid' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_transition_ck'; END IF;
  IF NEW.status='SUBMITTED' THEN
    SELECT count(*),coalesce(sum(quantity),0) INTO line_count,line_total FROM sales_delivery_instruction_lines WHERE instruction_id=NEW.id;
    IF line_count=0 OR line_total<>NEW.total_qty THEN RAISE EXCEPTION 'delivery instruction line total mismatch' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_line_total_ck'; END IF;
    FOR line_row IN SELECT * FROM sales_delivery_instruction_lines WHERE instruction_id=NEW.id ORDER BY sales_order_line_id FOR UPDATE LOOP
      SELECT sol.ordered_qty-sol.shipped_qty INTO order_remaining FROM sales_order_lines sol JOIN sales_order_versions sov ON sov.id=sol.sales_order_version_id JOIN sales_orders so ON so.id=sov.sales_order_id AND so.current_version_no=sov.version_no WHERE sol.id=line_row.sales_order_line_id AND so.id=NEW.sales_order_id AND so.customer_id=line_row.customer_id AND so.status IN ('OPEN','PARTIALLY_SHIPPED') FOR UPDATE OF sol,so;
      SELECT coalesce(sum(di.quantity-di.executed_qty),0) INTO reserved FROM sales_delivery_instruction_lines di JOIN sales_delivery_instructions d ON d.id=di.instruction_id WHERE di.sales_order_line_id=line_row.sales_order_line_id AND d.id<>NEW.id AND d.status IN ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','PARTIAL');
      SELECT coalesce(sum(qi.released_qty),0) INTO released FROM quality_inspections qi JOIN finished_goods_sales_allocations a ON a.id=qi.fqc_allocation_id AND a.status='ACTIVE' AND a.sales_order_line_id=line_row.sales_order_line_id WHERE qi.inspection_type='FQC' AND qi.lifecycle_status='CLOSED' AND qi.decision_status='RELEASED';
      SELECT coalesce(sum(CASE WHEN fa.entry_type='SHIPMENT' THEN fa.quantity ELSE -fa.quantity END),0) INTO consumed FROM sales_shipment_line_fqc_allocations fa JOIN quality_inspections qi ON qi.id=fa.quality_inspection_id WHERE qi.sales_order_line_id=line_row.sales_order_line_id;
      IF order_remaining IS NULL OR line_row.quantity+reserved>order_remaining OR line_row.quantity+reserved>greatest(released-consumed,0) THEN RAISE EXCEPTION 'delivery instruction exceeds order or FQC unreserved capacity' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_capacity_ck'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_delivery_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record; reserved numeric(24,6); released numeric(24,6); consumed numeric(24,6);
BEGIN
  IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'delivery instruction line writes require sales service transaction' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'delivery instruction lines cannot be deleted' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT so.customer_id,sol.product_id,sol.product_version_id,sol.finished_material_id,sol.unit_id,sol.ordered_qty-sol.shipped_qty remaining INTO source_row FROM sales_delivery_instructions d JOIN sales_orders so ON so.id=d.sales_order_id JOIN sales_order_versions sov ON sov.sales_order_id=so.id AND sov.version_no=so.current_version_no JOIN sales_order_lines sol ON sol.sales_order_version_id=sov.id WHERE d.id=NEW.instruction_id AND d.status='DRAFT' AND sol.id=NEW.sales_order_line_id FOR UPDATE OF so,sol;
    SELECT coalesce(sum(di.quantity-di.executed_qty),0) INTO reserved FROM sales_delivery_instruction_lines di JOIN sales_delivery_instructions d ON d.id=di.instruction_id WHERE di.sales_order_line_id=NEW.sales_order_line_id AND d.id<>NEW.instruction_id AND d.status IN ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','PARTIAL');
    SELECT coalesce(sum(qi.released_qty),0) INTO released FROM quality_inspections qi JOIN finished_goods_sales_allocations a ON a.id=qi.fqc_allocation_id AND a.status='ACTIVE' AND a.sales_order_line_id=NEW.sales_order_line_id WHERE qi.inspection_type='FQC' AND qi.lifecycle_status='CLOSED' AND qi.decision_status='RELEASED';
    SELECT coalesce(sum(CASE WHEN fa.entry_type='SHIPMENT' THEN fa.quantity ELSE -fa.quantity END),0) INTO consumed FROM sales_shipment_line_fqc_allocations fa JOIN quality_inspections qi ON qi.id=fa.quality_inspection_id WHERE qi.sales_order_line_id=NEW.sales_order_line_id;
    IF source_row IS NULL OR NEW.customer_id IS DISTINCT FROM source_row.customer_id OR NEW.product_id IS DISTINCT FROM source_row.product_id OR NEW.product_version_id IS DISTINCT FROM source_row.product_version_id OR NEW.material_id IS DISTINCT FROM source_row.finished_material_id OR NEW.unit_id IS DISTINCT FROM source_row.unit_id OR NEW.quantity>source_row.remaining OR NEW.quantity+reserved>greatest(released-consumed,0) OR NEW.executed_qty<>0 OR NEW.version<>1 THEN RAISE EXCEPTION 'delivery instruction line source mismatch' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instruction_lines_source_match_ck'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.instruction_id IS DISTINCT FROM OLD.instruction_id OR NEW.line_no IS DISTINCT FROM OLD.line_no OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id OR NEW.material_id IS DISTINCT FROM OLD.material_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.source_digest IS DISTINCT FROM OLD.source_digest OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'delivery instruction line stable facts are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_delivery_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'delivery facts require sales service transaction' USING ERRCODE='42501'; END IF; IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'delivery facts are immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_delivery_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shipment_type text; shipment_order_line bigint; instruction_order_line bigint; original record;
BEGIN
  IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'delivery execution requires sales service transaction' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'delivery execution facts are immutable' USING ERRCODE='55000'; END IF;
  SELECT sh.shipment_type,sl.sales_order_line_id INTO shipment_type,shipment_order_line FROM sales_shipment_lines sl JOIN sales_shipments sh ON sh.id=sl.shipment_id WHERE sl.id=NEW.shipment_line_id;
  SELECT sales_order_line_id INTO instruction_order_line FROM sales_delivery_instruction_lines WHERE id=NEW.instruction_line_id;
  IF shipment_order_line IS NULL OR shipment_order_line IS DISTINCT FROM instruction_order_line OR NEW.quantity IS DISTINCT FROM (SELECT quantity FROM sales_shipment_lines WHERE id=NEW.shipment_line_id) OR (NEW.entry_type='SHIPMENT' AND shipment_type<>'SHIPMENT') OR (NEW.entry_type='REVERSAL' AND shipment_type<>'REVERSAL') THEN RAISE EXCEPTION 'delivery execution source mismatch' USING ERRCODE='23514',CONSTRAINT='sales_delivery_execution_lines_source_match_ck'; END IF;
  IF NEW.entry_type='REVERSAL' THEN SELECT * INTO original FROM sales_delivery_execution_lines WHERE id=NEW.reversal_of_execution_id FOR UPDATE; IF original IS NULL OR original.entry_type<>'SHIPMENT' OR original.instruction_line_id<>NEW.instruction_line_id OR original.quantity<>NEW.quantity THEN RAISE EXCEPTION 'delivery execution reversal mismatch' USING ERRCODE='23514',CONSTRAINT='sales_delivery_execution_lines_reversal_match_ck'; END IF; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_fqc_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record; original record; consumed numeric(24,6);
BEGIN
  IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'shipment FQC allocation requires sales service transaction' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'shipment FQC allocation facts are immutable' USING ERRCODE='55000'; END IF;
  SELECT sh.shipment_type,sl.sales_order_line_id,sl.material_id,sl.unit_id,qi.fqc_allocation_id inspection_allocation,qi.sales_order_line_id inspection_order_line,qi.material_id inspection_material,qi.unit_id inspection_unit,qi.released_qty,qi.lifecycle_status,qi.decision_status,a.status allocation_status INTO source_row FROM sales_shipment_lines sl JOIN sales_shipments sh ON sh.id=sl.shipment_id JOIN quality_inspections qi ON qi.id=NEW.quality_inspection_id JOIN finished_goods_sales_allocations a ON a.id=qi.fqc_allocation_id WHERE sl.id=NEW.shipment_line_id;
  IF source_row IS NULL OR NEW.fqc_allocation_id IS DISTINCT FROM source_row.inspection_allocation OR source_row.allocation_status<>'ACTIVE' OR source_row.inspection_order_line IS DISTINCT FROM source_row.sales_order_line_id OR source_row.inspection_material IS DISTINCT FROM source_row.material_id OR source_row.inspection_unit IS DISTINCT FROM source_row.unit_id OR (NEW.entry_type='SHIPMENT' AND (source_row.shipment_type<>'SHIPMENT' OR source_row.lifecycle_status<>'CLOSED' OR source_row.decision_status<>'RELEASED')) OR (NEW.entry_type='REVERSAL' AND source_row.shipment_type<>'REVERSAL') THEN RAISE EXCEPTION 'shipment FQC allocation source mismatch' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_source_match_ck'; END IF;
  IF NEW.entry_type='SHIPMENT' THEN
    SELECT coalesce(sum(CASE WHEN entry_type='SHIPMENT' THEN quantity ELSE -quantity END),0) INTO consumed FROM sales_shipment_line_fqc_allocations WHERE quality_inspection_id=NEW.quality_inspection_id;
    IF consumed+NEW.quantity>source_row.released_qty THEN RAISE EXCEPTION 'FQC released quantity already consumed' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_capacity_ck'; END IF;
  ELSE
    SELECT * INTO original FROM sales_shipment_line_fqc_allocations WHERE id=NEW.reversal_of_allocation_id FOR UPDATE;
    IF original IS NULL OR original.entry_type<>'SHIPMENT' OR original.quality_inspection_id<>NEW.quality_inspection_id OR original.fqc_allocation_id<>NEW.fqc_allocation_id OR original.quantity<>NEW.quantity THEN RAISE EXCEPTION 'shipment FQC reversal mismatch' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_reversal_match_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_shipment_delivery_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shipment_type text; execution_qty numeric(24,6); fqc_qty numeric(24,6); execution_type text;
BEGIN
  SELECT sh.shipment_type INTO shipment_type FROM sales_shipments sh JOIN sales_shipment_lines sl ON sl.shipment_id=sh.id WHERE sl.id=NEW.id;
  SELECT coalesce(sum(quantity),0),min(entry_type) INTO execution_qty,execution_type FROM sales_delivery_execution_lines WHERE shipment_line_id=NEW.id;
  SELECT coalesce(sum(quantity),0) INTO fqc_qty FROM sales_shipment_line_fqc_allocations WHERE shipment_line_id=NEW.id;
  IF execution_qty<>NEW.quantity OR fqc_qty<>NEW.quantity OR execution_type IS DISTINCT FROM shipment_type THEN RAISE EXCEPTION 'shipment line requires exact delivery and FQC allocations' USING ERRCODE='23514',CONSTRAINT='sales_shipment_lines_delivery_fqc_complete_ck'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_delivery_header_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_total numeric(24,6); line_executed numeric(24,6);
BEGIN
  SELECT coalesce(sum(quantity),0),coalesce(sum(executed_qty),0) INTO line_total,line_executed FROM sales_delivery_instruction_lines WHERE instruction_id=NEW.id;
  IF line_total<>NEW.total_qty OR line_executed<>NEW.executed_qty THEN RAISE EXCEPTION 'delivery instruction projection inconsistent' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_projection_total_ck'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_delivery_line_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header_total numeric(24,6); line_total numeric(24,6); header_executed numeric(24,6); line_executed numeric(24,6);
BEGIN
  SELECT total_qty,executed_qty INTO header_total,header_executed FROM sales_delivery_instructions WHERE id=NEW.instruction_id;
  SELECT coalesce(sum(quantity),0),coalesce(sum(executed_qty),0) INTO line_total,line_executed FROM sales_delivery_instruction_lines WHERE instruction_id=NEW.instruction_id;
  IF line_total<>header_total OR line_executed<>header_executed THEN RAISE EXCEPTION 'delivery instruction projection inconsistent' USING ERRCODE='23514',CONSTRAINT='sales_delivery_instructions_projection_total_ck'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_quality_fqc_consumption_reopen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.inspection_type='FQC' AND OLD.lifecycle_status='CLOSED' AND OLD.decision_status='RELEASED' AND NEW.lifecycle_status='OPEN' AND EXISTS(SELECT 1 FROM sales_shipment_line_fqc_allocations a WHERE a.quality_inspection_id=OLD.id GROUP BY a.quality_inspection_id HAVING sum(CASE WHEN a.entry_type='SHIPMENT' THEN a.quantity ELSE -a.quantity END)>0) THEN RAISE EXCEPTION 'FQC release already consumed by shipment' USING ERRCODE='23514',CONSTRAINT='quality_fqc_shipment_consumption_gate_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cyd_sales_financial_source_amount_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_amount numeric(48,6); expected_customer bigint; expected_currency text;
BEGIN
  IF NEW.entry_type='SHIPMENT' AND EXISTS(SELECT 1 FROM sales_shipment_lines sl JOIN sales_delivery_execution_lines e ON e.shipment_line_id=sl.id AND e.entry_type='SHIPMENT' WHERE sl.shipment_id=NEW.shipment_id) THEN SELECT round(sum(sl.quantity*ol.unit_price),6),so.customer_id,sov.currency_code INTO expected_amount,expected_customer,expected_currency FROM sales_shipment_lines sl JOIN sales_order_lines ol ON ol.id=sl.sales_order_line_id JOIN sales_shipments sh ON sh.id=sl.shipment_id JOIN sales_orders so ON so.id=sh.sales_order_id JOIN sales_order_versions sov ON sov.sales_order_id=so.id AND sov.version_no=so.current_version_no WHERE sh.id=NEW.shipment_id GROUP BY so.customer_id,sov.currency_code; IF NEW.amount IS DISTINCT FROM expected_amount OR NEW.customer_id IS DISTINCT FROM expected_customer OR NEW.currency_code IS DISTINCT FROM expected_currency THEN RAISE EXCEPTION 'sales financial source amount mismatch' USING ERRCODE='23514',CONSTRAINT='sales_financial_source_entries_server_amount_ck'; END IF; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER sales_delivery_instructions_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_delivery_instructions FOR EACH ROW EXECUTE FUNCTION cyd_sales_delivery_instruction_guard();
--> statement-breakpoint
CREATE TRIGGER sales_delivery_instruction_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_delivery_instruction_lines FOR EACH ROW EXECUTE FUNCTION cyd_sales_delivery_line_guard();
--> statement-breakpoint
CREATE TRIGGER sales_delivery_instruction_events_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_delivery_instruction_events FOR EACH ROW EXECUTE FUNCTION cyd_sales_delivery_fact_guard();
--> statement-breakpoint
CREATE TRIGGER sales_delivery_execution_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_delivery_execution_lines FOR EACH ROW EXECUTE FUNCTION cyd_sales_delivery_execution_guard();
--> statement-breakpoint
CREATE TRIGGER sales_shipment_line_fqc_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_shipment_line_fqc_allocations FOR EACH ROW EXECUTE FUNCTION cyd_sales_fqc_allocation_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_shipment_lines_delivery_fqc_complete AFTER INSERT ON sales_shipment_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_sales_shipment_delivery_complete_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_delivery_instructions_projection_total AFTER INSERT OR UPDATE ON sales_delivery_instructions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_sales_delivery_header_projection_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_delivery_instruction_lines_projection_total AFTER INSERT OR UPDATE ON sales_delivery_instruction_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_sales_delivery_line_projection_guard();
--> statement-breakpoint
CREATE TRIGGER quality_fqc_shipment_consumption_gate BEFORE UPDATE ON quality_inspections FOR EACH ROW EXECUTE FUNCTION cyd_quality_fqc_consumption_reopen_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_financial_source_server_amount AFTER INSERT ON sales_financial_source_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_sales_financial_source_amount_guard();
