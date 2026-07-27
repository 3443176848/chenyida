CREATE TABLE "inventory_lots" (
  "id" bigserial PRIMARY KEY,
  "lot_code" text NOT NULL,
  "lot_type" text NOT NULL,
  "material_id" bigint NOT NULL REFERENCES "material_master"("id") ON DELETE restrict,
  "unit_id" bigint NOT NULL REFERENCES "units"("id") ON DELETE restrict,
  "source_production_batch_id" bigint NOT NULL REFERENCES "production_batches"("id") ON DELETE restrict,
  "work_order_id" bigint NOT NULL REFERENCES "production_work_orders"("id") ON DELETE restrict,
  "product_version_id" bigint NOT NULL REFERENCES "product_versions"("id") ON DELETE restrict,
  "manufactured_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'AVAILABLE',
  "version" integer NOT NULL DEFAULT 1,
  "operation_id" uuid NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_lots_code_uq" UNIQUE("lot_code"),
  CONSTRAINT "inventory_lots_batch_uq" UNIQUE("source_production_batch_id"),
  CONSTRAINT "inventory_lots_operation_uq" UNIQUE("operation_id"),
  CONSTRAINT "inventory_lots_identity_uq" UNIQUE("id","material_id","unit_id","lot_code"),
  CONSTRAINT "inventory_lots_code_ck" CHECK ("lot_code" ~ '^FGL-[0-9]{8}$' and "lot_code"=upper(btrim("lot_code"))),
  CONSTRAINT "inventory_lots_type_ck" CHECK ("lot_type"='MANUFACTURING_FINISHED_GOODS'),
  CONSTRAINT "inventory_lots_status_ck" CHECK ("status" in ('AVAILABLE','FROZEN','DEPLETED','REVERSED')),
  CONSTRAINT "inventory_lots_version_ck" CHECK ("version">0)
);
--> statement-breakpoint
CREATE TABLE "production_completion_inventory_lots" (
  "production_completion_id" bigint PRIMARY KEY REFERENCES "production_completions"("id") ON DELETE restrict,
  "inventory_lot_id" bigint NOT NULL REFERENCES "inventory_lots"("id") ON DELETE restrict,
  "production_batch_id" bigint NOT NULL REFERENCES "production_batches"("id") ON DELETE restrict,
  "inventory_adjustment_id" bigint NOT NULL REFERENCES "inventory_adjustments"("id") ON DELETE restrict,
  "inventory_ledger_entry_id" bigint NOT NULL REFERENCES "inventory_ledger_entries"("id") ON DELETE restrict,
  "quantity" numeric(24,6) NOT NULL,
  "created_by" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "production_completion_inventory_lots_ledger_uq" UNIQUE("inventory_ledger_entry_id"),
  CONSTRAINT "production_completion_inventory_lots_quantity_ck" CHECK ("quantity">0)
);
--> statement-breakpoint
CREATE TABLE "inventory_lot_events" (
  "id" bigserial PRIMARY KEY,
  "inventory_lot_id" bigint NOT NULL REFERENCES "inventory_lots"("id") ON DELETE restrict,
  "event_type" text NOT NULL,
  "inventory_adjustment_id" bigint REFERENCES "inventory_adjustments"("id") ON DELETE restrict,
  "inventory_ledger_entry_id" bigint REFERENCES "inventory_ledger_entries"("id") ON DELETE restrict,
  "production_completion_id" bigint REFERENCES "production_completions"("id") ON DELETE restrict,
  "quantity" numeric(24,6) NOT NULL DEFAULT 0,
  "from_status" text,
  "to_status" text NOT NULL,
  "reason" text NOT NULL DEFAULT '',
  "actor" text NOT NULL REFERENCES "app_users"("username") ON DELETE restrict,
  "request_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_lot_events_type_ck" CHECK ("event_type" in ('CREATED','COMPLETION_RECEIVED','COMPLETION_REVERSED','FROZEN','UNFROZEN')),
  CONSTRAINT "inventory_lot_events_quantity_ck" CHECK ("quantity">=0),
  CONSTRAINT "inventory_lot_events_status_ck" CHECK (("from_status" is null or "from_status" in ('AVAILABLE','FROZEN','DEPLETED','REVERSED')) and "to_status" in ('AVAILABLE','FROZEN','DEPLETED','REVERSED'))
);
--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" ADD COLUMN "inventory_lot_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD COLUMN "inventory_lot_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD COLUMN "inventory_lot_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_lot_fk" FOREIGN KEY ("inventory_lot_id","material_id","unit_id","lot_code") REFERENCES "inventory_lots"("id","material_id","unit_id","lot_code") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_lot_fk" FOREIGN KEY ("inventory_lot_id","material_id","unit_id","lot_code") REFERENCES "inventory_lots"("id","material_id","unit_id","lot_code") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_lot_fk" FOREIGN KEY ("inventory_lot_id","material_id","unit_id","lot_code") REFERENCES "inventory_lots"("id","material_id","unit_id","lot_code") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" DROP CONSTRAINT "inventory_stock_balances_location_ck";
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" DROP CONSTRAINT "inventory_ledger_entries_location_ck";
--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" DROP CONSTRAINT "inventory_adjustment_lines_location_ck";
--> statement-breakpoint
ALTER TABLE "inventory_stock_balances" ADD CONSTRAINT "inventory_stock_balances_location_ck" CHECK ("location_code"='MAIN' and (("inventory_lot_id" is null and "lot_code"='') or ("inventory_lot_id" is not null and "lot_code"<>'')));
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_location_ck" CHECK ("location_code"='MAIN' and (("inventory_lot_id" is null and "lot_code"='') or ("inventory_lot_id" is not null and "lot_code"<>'')));
--> statement-breakpoint
ALTER TABLE "inventory_adjustment_lines" ADD CONSTRAINT "inventory_adjustment_lines_location_ck" CHECK ("location_code"='MAIN' and (("inventory_lot_id" is null and "lot_code"='') or ("inventory_lot_id" is not null and "lot_code"<>'')));
--> statement-breakpoint
DROP INDEX "inventory_stock_balances_position_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_balances_empty_lot_uq" ON "inventory_stock_balances"("material_id","location_code") WHERE "inventory_lot_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_balances_lot_uq" ON "inventory_stock_balances"("material_id","location_code","inventory_lot_id") WHERE "inventory_lot_id" is not null;
--> statement-breakpoint
CREATE INDEX "inventory_stock_balances_lot_idx" ON "inventory_stock_balances"("inventory_lot_id","updated_at");
--> statement-breakpoint
CREATE INDEX "inventory_ledger_entries_lot_created_idx" ON "inventory_ledger_entries"("inventory_lot_id","created_at","id") WHERE "inventory_lot_id" is not null;
--> statement-breakpoint
CREATE INDEX "inventory_lots_material_status_idx" ON "inventory_lots"("material_id","status","created_at","id");
--> statement-breakpoint
CREATE INDEX "inventory_lots_work_order_idx" ON "inventory_lots"("work_order_id","id");
--> statement-breakpoint
CREATE INDEX "production_completion_inventory_lots_lot_idx" ON "production_completion_inventory_lots"("inventory_lot_id","production_completion_id");
--> statement-breakpoint
CREATE INDEX "inventory_lot_events_lot_idx" ON "inventory_lot_events"("inventory_lot_id","id");
--> statement-breakpoint

CREATE FUNCTION cyd_inventory_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lineage record;
BEGIN
  IF current_setting('cyd.inventory_lot_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'inventory lot writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'inventory lots are append-preserved' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.version<>OLD.version+1 OR ROW(NEW.lot_code,NEW.lot_type,NEW.material_id,NEW.unit_id,NEW.source_production_batch_id,NEW.work_order_id,NEW.product_version_id,NEW.manufactured_at,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.lot_code,OLD.lot_type,OLD.material_id,OLD.unit_id,OLD.source_production_batch_id,OLD.work_order_id,OLD.product_version_id,OLD.manufactured_at,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at) THEN RAISE EXCEPTION 'inventory lot identity is immutable' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  SELECT b.work_order_id,s.product_version_id,s.finished_material_id,s.unit_id,s.status INTO lineage
  FROM production_batches b JOIN production_batch_sets s ON s.id=b.batch_set_id WHERE b.id=NEW.source_production_batch_id FOR SHARE OF b,s;
  IF lineage.work_order_id IS NULL OR lineage.status<>'RELEASED' OR NEW.work_order_id IS DISTINCT FROM lineage.work_order_id OR NEW.product_version_id IS DISTINCT FROM lineage.product_version_id OR NEW.material_id IS DISTINCT FROM lineage.finished_material_id OR NEW.unit_id IS DISTINCT FROM lineage.unit_id OR NEW.version<>1 OR NEW.status<>'AVAILABLE' THEN RAISE EXCEPTION 'inventory lot production batch lineage mismatch' USING ERRCODE='23514',CONSTRAINT='inventory_lots_batch_lineage_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_lots_guard BEFORE INSERT OR UPDATE OR DELETE ON "inventory_lots" FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_inventory_lot_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lot_row record; balance_row record; ledger_row record; completion_row record; batch_link record;
BEGIN
  IF current_setting('cyd.inventory_lot_service_write',true) IS DISTINCT FROM 'allowed' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'inventory lot facts are service-managed immutable facts' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='inventory_lot_events' THEN
    SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
    IF lot_row.id IS NULL OR NEW.to_status IS DISTINCT FROM lot_row.status THEN RAISE EXCEPTION 'inventory lot event status mismatch' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
  SELECT c.*,cb.production_batch_id INTO completion_row FROM production_completions c JOIN production_completion_batches cb ON cb.production_completion_id=c.id WHERE c.id=NEW.production_completion_id FOR SHARE OF c,cb;
  SELECT * INTO ledger_row FROM inventory_ledger_entries WHERE id=NEW.inventory_ledger_entry_id FOR SHARE;
  SELECT * INTO batch_link FROM production_batches WHERE id=NEW.production_batch_id FOR SHARE;
  IF lot_row.id IS NULL OR completion_row.id IS NULL OR ledger_row.id IS NULL OR batch_link.id IS NULL OR NEW.production_batch_id IS DISTINCT FROM lot_row.source_production_batch_id OR completion_row.production_batch_id IS DISTINCT FROM NEW.production_batch_id OR completion_row.work_order_id IS DISTINCT FROM lot_row.work_order_id OR batch_link.work_order_id IS DISTINCT FROM lot_row.work_order_id OR completion_row.inventory_adjustment_id IS DISTINCT FROM NEW.inventory_adjustment_id OR ledger_row.adjustment_id IS DISTINCT FROM NEW.inventory_adjustment_id OR ledger_row.inventory_lot_id IS DISTINCT FROM NEW.inventory_lot_id OR ledger_row.material_id IS DISTINCT FROM lot_row.material_id OR ledger_row.unit_id IS DISTINCT FROM lot_row.unit_id OR ledger_row.lot_code IS DISTINCT FROM lot_row.lot_code OR ledger_row.on_hand_delta IS DISTINCT FROM NEW.quantity THEN RAISE EXCEPTION 'completion inventory lot lineage mismatch' USING ERRCODE='23514',CONSTRAINT='production_completion_inventory_lots_lineage_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_completion_inventory_lots_guard BEFORE INSERT OR UPDATE OR DELETE ON "production_completion_inventory_lots" FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_fact_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_lot_events_guard BEFORE INSERT OR UPDATE OR DELETE ON "inventory_lot_events" FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_fact_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_inventory_lot_position_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lot_row record; balance_row record;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.inventory_lot_id IS NULL THEN
    IF NEW.lot_code<>'' THEN RAISE EXCEPTION 'empty lot identity requires empty lot code' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
  IF lot_row.id IS NULL OR ROW(NEW.material_id,NEW.unit_id,NEW.lot_code) IS DISTINCT FROM ROW(lot_row.material_id,lot_row.unit_id,lot_row.lot_code) THEN RAISE EXCEPTION 'inventory lot position mismatch' USING ERRCODE='23514',CONSTRAINT='inventory_lot_position_reconciliation_ck'; END IF;
  IF TG_TABLE_NAME<>'inventory_stock_balances' THEN
    SELECT * INTO balance_row FROM inventory_stock_balances WHERE id=NEW.balance_id FOR SHARE;
    IF balance_row.id IS NULL OR ROW(NEW.inventory_lot_id,NEW.material_id,NEW.unit_id,NEW.location_code,NEW.lot_code) IS DISTINCT FROM ROW(balance_row.inventory_lot_id,balance_row.material_id,balance_row.unit_id,balance_row.location_code,balance_row.lot_code) THEN RAISE EXCEPTION 'inventory ledger balance lot mismatch' USING ERRCODE='23514',CONSTRAINT='inventory_lot_balance_reconciliation_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_stock_balances_lot_guard BEFORE INSERT OR UPDATE ON "inventory_stock_balances" FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_position_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_ledger_entries_lot_guard BEFORE INSERT ON "inventory_ledger_entries" FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_position_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_adjustment_lines_lot_guard BEFORE INSERT ON "inventory_adjustment_lines" FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_position_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_validate_inventory_lot_balance(target_balance_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE balance_row record; ledger_on_hand numeric(24,6); ledger_frozen numeric(24,6); latest_id bigint;
BEGIN
  SELECT * INTO balance_row FROM inventory_stock_balances WHERE id=target_balance_id;
  IF balance_row.id IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(on_hand_delta),0),coalesce(sum(frozen_delta),0),max(id) INTO ledger_on_hand,ledger_frozen,latest_id FROM inventory_ledger_entries WHERE balance_id=target_balance_id;
  IF balance_row.on_hand_qty<>ledger_on_hand OR balance_row.frozen_qty<>ledger_frozen OR balance_row.last_ledger_entry_id IS DISTINCT FROM latest_id THEN RAISE EXCEPTION 'inventory ledger and balance do not reconcile' USING ERRCODE='23514',CONSTRAINT='inventory_ledger_balance_reconciliation_ck'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_inventory_lot_balance_deferred_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint;
BEGIN
  IF TG_TABLE_NAME='inventory_stock_balances' THEN target_id=coalesce(NEW.id,OLD.id); ELSE target_id=coalesce(NEW.balance_id,OLD.balance_id); END IF;
  PERFORM cyd_validate_inventory_lot_balance(target_id);
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_stock_balances_lot_reconcile AFTER INSERT OR UPDATE ON "inventory_stock_balances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_balance_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_ledger_entries_lot_reconcile AFTER INSERT ON "inventory_ledger_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_inventory_lot_balance_deferred_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_validate_completion_inventory_lot(target_completion_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE completion_row record; batch_row record; lot_link record; line_row record; ledger_row record;
BEGIN
  SELECT * INTO completion_row FROM production_completions WHERE id=target_completion_id;
  IF completion_row.id IS NULL THEN RETURN; END IF;
  SELECT * INTO batch_row FROM production_completion_batches WHERE production_completion_id=target_completion_id;
  SELECT * INTO lot_link FROM production_completion_inventory_lots WHERE production_completion_id=target_completion_id;
  IF batch_row.production_completion_id IS NULL THEN
    IF lot_link.production_completion_id IS NOT NULL OR EXISTS(select 1 from inventory_ledger_entries where adjustment_id=completion_row.inventory_adjustment_id and (inventory_lot_id is not null or lot_code<>'')) THEN RAISE EXCEPTION 'ORDER completion cannot claim inventory lot' USING ERRCODE='23514',CONSTRAINT='order_completion_inventory_lot_ck'; END IF;
    RETURN;
  END IF;
  SELECT * INTO line_row FROM production_completion_lines WHERE completion_id=target_completion_id;
  SELECT * INTO ledger_row FROM inventory_ledger_entries WHERE id=line_row.inventory_ledger_entry_id;
  IF lot_link.production_completion_id IS NULL OR lot_link.production_batch_id IS DISTINCT FROM batch_row.production_batch_id OR lot_link.inventory_adjustment_id IS DISTINCT FROM completion_row.inventory_adjustment_id OR lot_link.inventory_ledger_entry_id IS DISTINCT FROM line_row.inventory_ledger_entry_id OR lot_link.quantity IS DISTINCT FROM line_row.quantity OR ledger_row.inventory_lot_id IS DISTINCT FROM lot_link.inventory_lot_id OR ledger_row.on_hand_delta IS DISTINCT FROM line_row.quantity THEN RAISE EXCEPTION 'Batch completion inventory lot does not reconcile' USING ERRCODE='23514',CONSTRAINT='batch_completion_inventory_lot_ck'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_completion_inventory_lot_deferred_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE completion_id bigint;
BEGIN
  IF TG_TABLE_NAME='production_completions' THEN completion_id=coalesce(NEW.id,OLD.id); ELSE completion_id=coalesce(NEW.production_completion_id,OLD.production_completion_id); END IF;
  PERFORM cyd_validate_completion_inventory_lot(completion_id);
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_completions_inventory_lot_reconcile AFTER INSERT ON "production_completions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_completion_inventory_lot_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_completion_batches_inventory_lot_reconcile AFTER INSERT ON "production_completion_batches" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_completion_inventory_lot_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_completion_inventory_lots_reconcile AFTER INSERT ON "production_completion_inventory_lots" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_completion_inventory_lot_deferred_guard();
