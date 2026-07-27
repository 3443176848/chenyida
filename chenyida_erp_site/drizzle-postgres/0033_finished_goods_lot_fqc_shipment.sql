ALTER TABLE "inventory_lot_events" DROP CONSTRAINT "inventory_lot_events_type_ck";--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocations" ADD COLUMN "inventory_lot_id" bigint;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD COLUMN "inventory_lot_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD COLUMN "inventory_lot_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD COLUMN "inventory_lot_id" bigint;--> statement-breakpoint
ALTER TABLE "finished_goods_sales_allocations" ADD CONSTRAINT "finished_goods_sales_allocations_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_line_fqc_allocations" ADD CONSTRAINT "sales_shipment_line_fqc_allocations_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finished_goods_sales_allocations_lot_order_idx" ON "finished_goods_sales_allocations" USING btree ("inventory_lot_id","sales_order_line_id","status","id");--> statement-breakpoint
CREATE INDEX "quality_inspections_fqc_lot_idx" ON "quality_inspections" USING btree ("inventory_lot_id","sales_order_line_id","lifecycle_status","decision_status","id") WHERE "quality_inspections"."inspection_type"='FQC';--> statement-breakpoint
CREATE INDEX "sales_shipment_line_fqc_allocations_lot_idx" ON "sales_shipment_line_fqc_allocations" USING btree ("inventory_lot_id","quality_inspection_id","entry_type","id");--> statement-breakpoint
CREATE INDEX "sales_shipment_lines_lot_idx" ON "sales_shipment_lines" USING btree ("inventory_lot_id","sales_order_line_id","id");--> statement-breakpoint
ALTER TABLE "inventory_lot_events" ADD CONSTRAINT "inventory_lot_events_type_ck" CHECK ("inventory_lot_events"."event_type" in ('CREATED','COMPLETION_RECEIVED','COMPLETION_REVERSED','FROZEN','UNFROZEN','SHIPMENT_ISSUED','SHIPMENT_REVERSED'));
--> statement-breakpoint
UPDATE finished_goods_sales_allocations a SET inventory_lot_id=link.inventory_lot_id FROM production_completion_lines line JOIN production_completion_inventory_lots link ON link.production_completion_id=line.completion_id WHERE a.completion_line_id=line.id;
--> statement-breakpoint
UPDATE quality_inspections inspection SET inventory_lot_id=allocation.inventory_lot_id FROM finished_goods_sales_allocations allocation WHERE inspection.fqc_allocation_id=allocation.id AND inspection.inspection_type='FQC';
--> statement-breakpoint
UPDATE sales_shipment_lines line SET inventory_lot_id=ledger.inventory_lot_id FROM inventory_ledger_entries ledger WHERE line.inventory_ledger_entry_id=ledger.id;
--> statement-breakpoint
UPDATE sales_shipment_line_fqc_allocations consumption SET inventory_lot_id=inspection.inventory_lot_id FROM quality_inspections inspection WHERE consumption.quality_inspection_id=inspection.id;
--> statement-breakpoint

CREATE FUNCTION cyd_finished_goods_allocation_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_lot_id bigint; source_material_id bigint; source_unit_id bigint; lot_row record;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT link.inventory_lot_id,line.material_id,line.unit_id INTO source_lot_id,source_material_id,source_unit_id FROM production_completion_lines line LEFT JOIN production_completion_inventory_lots link ON link.production_completion_id=line.completion_id WHERE line.id=NEW.completion_line_id;
  IF source_material_id IS NULL OR NEW.inventory_lot_id IS DISTINCT FROM source_lot_id THEN RAISE EXCEPTION 'finished goods allocation inventory lot mismatch' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_inventory_lot_ck'; END IF;
  IF TG_OP='UPDATE' AND NEW.inventory_lot_id IS DISTINCT FROM OLD.inventory_lot_id THEN RAISE EXCEPTION 'finished goods allocation lot is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.inventory_lot_id IS NOT NULL THEN
    SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
    IF lot_row.id IS NULL OR ROW(lot_row.material_id,lot_row.unit_id) IS DISTINCT FROM ROW(source_material_id,source_unit_id) THEN RAISE EXCEPTION 'finished goods allocation lot material or unit mismatch' USING ERRCODE='23514',CONSTRAINT='finished_goods_sales_allocations_inventory_lot_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finished_goods_sales_allocations_lot_guard BEFORE INSERT OR UPDATE OR DELETE ON "finished_goods_sales_allocations" FOR EACH ROW EXECUTE FUNCTION cyd_finished_goods_allocation_lot_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_quality_fqc_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation_lot_id bigint; lot_row record; net_consumed numeric(24,6);
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.inspection_type='FQC' THEN
    SELECT inventory_lot_id INTO allocation_lot_id FROM finished_goods_sales_allocations WHERE id=NEW.fqc_allocation_id FOR SHARE;
    IF NOT FOUND OR NEW.inventory_lot_id IS DISTINCT FROM allocation_lot_id THEN RAISE EXCEPTION 'FQC inventory lot mismatch' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck'; END IF;
    IF NEW.inventory_lot_id IS NOT NULL THEN
      SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
      IF lot_row.id IS NULL OR ROW(lot_row.material_id,lot_row.unit_id) IS DISTINCT FROM ROW(NEW.material_id,NEW.unit_id) THEN RAISE EXCEPTION 'FQC lot material or unit mismatch' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck'; END IF;
    END IF;
  ELSIF NEW.inventory_lot_id IS NOT NULL THEN RAISE EXCEPTION 'only FQC may reference finished goods lot' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck';
  END IF;
  IF TG_OP='UPDATE' AND NEW.inventory_lot_id IS DISTINCT FROM OLD.inventory_lot_id THEN RAISE EXCEPTION 'quality inspection lot is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD.inspection_type='FQC' AND EXISTS(SELECT 1 FROM sales_shipment_line_fqc_allocations fact WHERE fact.quality_inspection_id=OLD.id GROUP BY fact.quality_inspection_id HAVING sum(CASE WHEN fact.entry_type='SHIPMENT' THEN fact.quantity ELSE -fact.quantity END)>0) THEN
    SELECT coalesce(sum(CASE WHEN entry_type='SHIPMENT' THEN quantity ELSE -quantity END),0) INTO net_consumed FROM sales_shipment_line_fqc_allocations WHERE quality_inspection_id=OLD.id;
    IF NEW.released_qty<net_consumed OR ROW(NEW.production_completion_line_id,NEW.sales_order_line_id,NEW.fqc_allocation_id,NEW.material_id,NEW.unit_id) IS DISTINCT FROM ROW(OLD.production_completion_line_id,OLD.sales_order_line_id,OLD.fqc_allocation_id,OLD.material_id,OLD.unit_id) THEN RAISE EXCEPTION 'consumed FQC release cannot be reduced or moved' USING ERRCODE='23514',CONSTRAINT='quality_fqc_lot_consumption_gate_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER quality_inspections_fqc_lot_guard BEFORE INSERT OR UPDATE OR DELETE ON "quality_inspections" FOR EACH ROW EXECUTE FUNCTION cyd_quality_fqc_lot_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_sales_shipment_line_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_row record; source_shipment_type text; original_row record;
BEGIN
  IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'shipment lot facts require sales service insert' USING ERRCODE='42501'; END IF;
  SELECT * INTO ledger_row FROM inventory_ledger_entries WHERE id=NEW.inventory_ledger_entry_id FOR SHARE;
  SELECT s.shipment_type INTO source_shipment_type FROM sales_shipments s WHERE s.id=NEW.shipment_id FOR SHARE;
  IF ledger_row.id IS NULL OR NEW.inventory_lot_id IS DISTINCT FROM ledger_row.inventory_lot_id OR ROW(NEW.material_id,NEW.unit_id) IS DISTINCT FROM ROW(ledger_row.material_id,ledger_row.unit_id) THEN RAISE EXCEPTION 'shipment line inventory lot ledger mismatch' USING ERRCODE='23514',CONSTRAINT='sales_shipment_lines_inventory_lot_ck'; END IF;
  IF source_shipment_type='SHIPMENT' AND ledger_row.on_hand_delta<>-NEW.quantity THEN RAISE EXCEPTION 'shipment ledger quantity mismatch' USING ERRCODE='23514',CONSTRAINT='sales_shipment_lines_inventory_lot_ck'; END IF;
  IF source_shipment_type='REVERSAL' THEN
    SELECT original_line.* INTO original_row FROM sales_shipments reversal JOIN sales_shipments original ON original.id=reversal.original_shipment_id JOIN sales_shipment_lines original_line ON original_line.shipment_id=original.id AND original_line.sales_order_line_id=NEW.sales_order_line_id WHERE reversal.id=NEW.shipment_id;
    IF original_row.id IS NULL OR NEW.inventory_lot_id IS DISTINCT FROM original_row.inventory_lot_id OR ledger_row.reversal_of_ledger_entry_id IS DISTINCT FROM original_row.inventory_ledger_entry_id OR ledger_row.on_hand_delta<>NEW.quantity THEN RAISE EXCEPTION 'shipment reversal must restore original inventory lot' USING ERRCODE='23514',CONSTRAINT='sales_shipment_lines_inventory_lot_reversal_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sales_shipment_lines_lot_guard BEFORE INSERT OR UPDATE OR DELETE ON "sales_shipment_lines" FOR EACH ROW EXECUTE FUNCTION cyd_sales_shipment_line_lot_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_sales_fqc_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shipment_row record; inspection_row record; allocation_row record; original_row record; consumed numeric(24,6);
BEGIN
  IF current_setting('cyd.sales_service_write',true) IS DISTINCT FROM 'allowed' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'shipment FQC lot facts require sales service insert' USING ERRCODE='42501'; END IF;
  SELECT line.inventory_lot_id,line.sales_order_line_id,line.material_id,line.unit_id,shipment.shipment_type INTO shipment_row FROM sales_shipment_lines line JOIN sales_shipments shipment ON shipment.id=line.shipment_id WHERE line.id=NEW.shipment_line_id FOR SHARE OF line,shipment;
  SELECT inventory_lot_id,sales_order_line_id,material_id,unit_id,released_qty,lifecycle_status,decision_status,fqc_allocation_id INTO inspection_row FROM quality_inspections WHERE id=NEW.quality_inspection_id FOR UPDATE;
  SELECT inventory_lot_id,sales_order_line_id,status INTO allocation_row FROM finished_goods_sales_allocations WHERE id=NEW.fqc_allocation_id FOR SHARE;
  IF shipment_row IS NULL OR inspection_row IS NULL OR allocation_row IS NULL OR NEW.inventory_lot_id IS DISTINCT FROM shipment_row.inventory_lot_id OR NEW.inventory_lot_id IS DISTINCT FROM inspection_row.inventory_lot_id OR NEW.inventory_lot_id IS DISTINCT FROM allocation_row.inventory_lot_id OR inspection_row.fqc_allocation_id IS DISTINCT FROM NEW.fqc_allocation_id OR allocation_row.sales_order_line_id IS DISTINCT FROM shipment_row.sales_order_line_id OR inspection_row.sales_order_line_id IS DISTINCT FROM shipment_row.sales_order_line_id OR ROW(inspection_row.material_id,inspection_row.unit_id) IS DISTINCT FROM ROW(shipment_row.material_id,shipment_row.unit_id) OR allocation_row.status<>'ACTIVE' THEN RAISE EXCEPTION 'shipment FQC inventory lot source mismatch' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_inventory_lot_ck'; END IF;
  IF NEW.entry_type='SHIPMENT' THEN
    IF shipment_row.shipment_type<>'SHIPMENT' OR inspection_row.lifecycle_status<>'CLOSED' OR inspection_row.decision_status<>'RELEASED' THEN RAISE EXCEPTION 'shipment requires closed released FQC on same lot' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_inventory_lot_ck'; END IF;
    SELECT coalesce(sum(CASE WHEN entry_type='SHIPMENT' THEN quantity ELSE -quantity END),0) INTO consumed FROM sales_shipment_line_fqc_allocations WHERE quality_inspection_id=NEW.quality_inspection_id;
    IF consumed+NEW.quantity>inspection_row.released_qty THEN RAISE EXCEPTION 'lot FQC released quantity already consumed' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_lot_capacity_ck'; END IF;
  ELSE
    SELECT * INTO original_row FROM sales_shipment_line_fqc_allocations WHERE id=NEW.reversal_of_allocation_id FOR UPDATE;
    IF shipment_row.shipment_type<>'REVERSAL' OR original_row.id IS NULL OR original_row.entry_type<>'SHIPMENT' OR NEW.inventory_lot_id IS DISTINCT FROM original_row.inventory_lot_id OR NEW.quality_inspection_id IS DISTINCT FROM original_row.quality_inspection_id OR NEW.fqc_allocation_id IS DISTINCT FROM original_row.fqc_allocation_id OR NEW.quantity IS DISTINCT FROM original_row.quantity THEN RAISE EXCEPTION 'FQC reversal must restore original lot release' USING ERRCODE='23514',CONSTRAINT='sales_shipment_line_fqc_allocations_lot_reversal_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sales_shipment_line_fqc_allocations_lot_guard BEFORE INSERT OR UPDATE OR DELETE ON "sales_shipment_line_fqc_allocations" FOR EACH ROW EXECUTE FUNCTION cyd_sales_fqc_lot_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_validate_shipment_line_lot(target_line_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE line_row record; ledger_row record; fqc_qty numeric(24,6); distinct_lots integer;
BEGIN
  SELECT line.*,shipment.shipment_type INTO line_row FROM sales_shipment_lines line JOIN sales_shipments shipment ON shipment.id=line.shipment_id WHERE line.id=target_line_id;
  IF line_row.id IS NULL THEN RETURN; END IF;
  SELECT * INTO ledger_row FROM inventory_ledger_entries WHERE id=line_row.inventory_ledger_entry_id;
  SELECT coalesce(sum(quantity),0),count(DISTINCT inventory_lot_id) FILTER (WHERE inventory_lot_id IS NOT NULL) INTO fqc_qty,distinct_lots FROM sales_shipment_line_fqc_allocations WHERE shipment_line_id=target_line_id;
  IF ledger_row.id IS NULL OR line_row.inventory_lot_id IS DISTINCT FROM ledger_row.inventory_lot_id OR fqc_qty<>line_row.quantity OR (line_row.inventory_lot_id IS NULL AND EXISTS(SELECT 1 FROM sales_shipment_line_fqc_allocations WHERE shipment_line_id=target_line_id AND inventory_lot_id IS NOT NULL)) OR (line_row.inventory_lot_id IS NOT NULL AND (distinct_lots<>1 OR EXISTS(SELECT 1 FROM sales_shipment_line_fqc_allocations WHERE shipment_line_id=target_line_id AND inventory_lot_id IS DISTINCT FROM line_row.inventory_lot_id))) THEN RAISE EXCEPTION 'shipment line lot ledger and FQC facts do not reconcile' USING ERRCODE='23514',CONSTRAINT='sales_shipment_lines_lot_reconciliation_ck'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_shipment_line_lot_deferred_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='sales_shipment_lines' THEN
    PERFORM cyd_validate_shipment_line_lot(coalesce(NEW.id,OLD.id));
  ELSE
    PERFORM cyd_validate_shipment_line_lot(coalesce(NEW.shipment_line_id,OLD.shipment_line_id));
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_shipment_lines_lot_reconcile AFTER INSERT ON "sales_shipment_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_shipment_line_lot_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_shipment_fqc_lot_reconcile AFTER INSERT ON "sales_shipment_line_fqc_allocations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_shipment_line_lot_deferred_guard();
