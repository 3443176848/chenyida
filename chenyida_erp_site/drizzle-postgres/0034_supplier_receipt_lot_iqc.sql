ALTER TABLE "inventory_lots" ALTER COLUMN "source_production_batch_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "work_order_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "product_version_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "manufactured_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "source_purchase_receipt_line_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "supplier_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "supplier_lot_code" text;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "received_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_purchase_receipt_line_fk" FOREIGN KEY ("source_purchase_receipt_line_id") REFERENCES "purchase_receipt_lines"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_lots" DROP CONSTRAINT "inventory_lots_batch_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_batch_uq" ON "inventory_lots"("source_production_batch_id") WHERE "source_production_batch_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_receipt_line_uq" ON "inventory_lots"("source_purchase_receipt_line_id") WHERE "source_purchase_receipt_line_id" is not null;
--> statement-breakpoint
CREATE INDEX "inventory_lots_supplier_idx" ON "inventory_lots"("supplier_id","received_at","id");
--> statement-breakpoint
ALTER TABLE "inventory_lots" DROP CONSTRAINT "inventory_lots_code_ck";
--> statement-breakpoint
ALTER TABLE "inventory_lots" DROP CONSTRAINT "inventory_lots_type_ck";
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_code_ck" CHECK (("lot_type"='MANUFACTURING_FINISHED_GOODS' and "lot_code" ~ '^FGL-[0-9]{8}$' or "lot_type"='SUPPLIER_RECEIPT' and "lot_code" ~ '^RML-[0-9]{8}$') and "lot_code"=upper(btrim("lot_code")));
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_xor_ck" CHECK (("lot_type"='MANUFACTURING_FINISHED_GOODS' and "source_production_batch_id" is not null and "work_order_id" is not null and "product_version_id" is not null and "manufactured_at" is not null and "source_purchase_receipt_line_id" is null and "supplier_id" is null and "supplier_lot_code" is null and "received_at" is null) or ("lot_type"='SUPPLIER_RECEIPT' and "source_production_batch_id" is null and "work_order_id" is null and "product_version_id" is null and "manufactured_at" is null and "source_purchase_receipt_line_id" is not null and "supplier_id" is not null and "supplier_lot_code" is not null and "received_at" is not null));
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_supplier_code_ck" CHECK ("supplier_lot_code" is null or ("supplier_lot_code"=upper(btrim("supplier_lot_code")) and "supplier_lot_code" ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'));
--> statement-breakpoint

ALTER TABLE "inventory_adjustments" DROP CONSTRAINT "inventory_adjustments_type_ck";
--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_type_ck" CHECK ("operation_type" in ('RECEIPT','IQC_RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL','MIGRATION_OPENING'));
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" DROP CONSTRAINT "inventory_ledger_entries_type_ck";
--> statement-breakpoint
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_type_ck" CHECK ("entry_type" in ('RECEIPT','IQC_RECEIPT','ISSUE','ADJUSTMENT','FREEZE','UNFREEZE','REVERSAL','MIGRATION_OPENING'));
--> statement-breakpoint

ALTER TABLE "purchase_receipts" ALTER COLUMN "inventory_adjustment_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ALTER COLUMN "inventory_ledger_entry_id" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "inventory_lot_events" ADD COLUMN "purchase_receipt_line_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_lot_events" ADD COLUMN "quality_inspection_id" bigint;
--> statement-breakpoint
ALTER TABLE "inventory_lot_events" ADD CONSTRAINT "inventory_lot_events_purchase_receipt_line_fk" FOREIGN KEY ("purchase_receipt_line_id") REFERENCES "purchase_receipt_lines"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "inventory_lot_events" ADD CONSTRAINT "inventory_lot_events_quality_inspection_fk" FOREIGN KEY ("quality_inspection_id") REFERENCES "quality_inspections"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "inventory_lot_events_receipt_idx" ON "inventory_lot_events"("purchase_receipt_line_id","id");
--> statement-breakpoint
CREATE INDEX "inventory_lot_events_iqc_idx" ON "inventory_lot_events"("quality_inspection_id","id");
--> statement-breakpoint
ALTER TABLE "inventory_lot_events" DROP CONSTRAINT "inventory_lot_events_type_ck";
--> statement-breakpoint
ALTER TABLE "inventory_lot_events" ADD CONSTRAINT "inventory_lot_events_type_ck" CHECK ("event_type" in ('CREATED','COMPLETION_RECEIVED','COMPLETION_REVERSED','FROZEN','UNFROZEN','SHIPMENT_ISSUED','SHIPMENT_REVERSED','SUPPLIER_RECEIVED','IQC_RELEASED','SUPPLIER_RECEIPT_REVERSED'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_inventory_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lineage record;
BEGIN
  IF current_setting('cyd.inventory_lot_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'inventory lot writes require service' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'inventory lots are append-preserved' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.version<>OLD.version+1 OR ROW(NEW.lot_code,NEW.lot_type,NEW.material_id,NEW.unit_id,NEW.source_production_batch_id,NEW.work_order_id,NEW.product_version_id,NEW.manufactured_at,NEW.source_purchase_receipt_line_id,NEW.supplier_id,NEW.supplier_lot_code,NEW.received_at,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.lot_code,OLD.lot_type,OLD.material_id,OLD.unit_id,OLD.source_production_batch_id,OLD.work_order_id,OLD.product_version_id,OLD.manufactured_at,OLD.source_purchase_receipt_line_id,OLD.supplier_id,OLD.supplier_lot_code,OLD.received_at,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at) THEN RAISE EXCEPTION 'inventory lot identity is immutable' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.lot_type='MANUFACTURING_FINISHED_GOODS' THEN
    SELECT b.work_order_id,s.product_version_id,s.finished_material_id,s.unit_id,s.status INTO lineage FROM production_batches b JOIN production_batch_sets s ON s.id=b.batch_set_id WHERE b.id=NEW.source_production_batch_id FOR SHARE OF b,s;
    IF lineage.work_order_id IS NULL OR lineage.status<>'RELEASED' OR NEW.work_order_id IS DISTINCT FROM lineage.work_order_id OR NEW.product_version_id IS DISTINCT FROM lineage.product_version_id OR NEW.material_id IS DISTINCT FROM lineage.finished_material_id OR NEW.unit_id IS DISTINCT FROM lineage.unit_id OR NEW.version<>1 OR NEW.status<>'AVAILABLE' THEN RAISE EXCEPTION 'inventory lot production batch lineage mismatch' USING ERRCODE='23514',CONSTRAINT='inventory_lots_batch_lineage_ck'; END IF;
  ELSE
    SELECT pr.receipt_type,prl.material_id,prl.unit_id,po.supplier_id,m.material_status,m.inventory_type,m.inspection_type INTO lineage FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.purchase_receipt_id JOIN purchase_orders po ON po.id=pr.purchase_order_id JOIN material_master m ON m.id=prl.material_id WHERE prl.id=NEW.source_purchase_receipt_line_id FOR SHARE OF prl,pr,po,m;
    IF lineage.receipt_type IS NULL OR lineage.receipt_type<>'RECEIPT' OR NEW.material_id IS DISTINCT FROM lineage.material_id OR NEW.unit_id IS DISTINCT FROM lineage.unit_id OR NEW.supplier_id IS DISTINCT FROM lineage.supplier_id OR lineage.material_status<>'ACTIVE' OR lineage.inventory_type<>'STOCKED' OR lineage.inspection_type<>'IQC' OR NEW.version<>1 OR NEW.status<>'FROZEN' THEN RAISE EXCEPTION 'supplier receipt inventory lot lineage mismatch' USING ERRCODE='23514',CONSTRAINT='inventory_lots_supplier_receipt_lineage_ck'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER purchase_receipts_immutable ON "purchase_receipts";
--> statement-breakpoint
DROP TRIGGER purchase_receipt_lines_immutable ON "purchase_receipt_lines";
--> statement-breakpoint
CREATE FUNCTION cyd_purchase_receipt_posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'posted inventory records are immutable' USING ERRCODE='55000'; END IF;
  IF current_setting('cyd.procurement_service_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'purchase receipt posting requires service' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='purchase_receipts' THEN
    IF OLD.inventory_adjustment_id IS NOT NULL OR NEW.inventory_adjustment_id IS NULL OR ROW(NEW.id,NEW.receipt_code,NEW.purchase_order_id,NEW.receipt_type,NEW.reversal_of_receipt_id,NEW.status,NEW.reason,NEW.operation_id,NEW.created_by,NEW.request_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.receipt_code,OLD.purchase_order_id,OLD.receipt_type,OLD.reversal_of_receipt_id,OLD.status,OLD.reason,OLD.operation_id,OLD.created_by,OLD.request_id,OLD.created_at) THEN RAISE EXCEPTION 'posted inventory records are immutable' USING ERRCODE='55000'; END IF;
  ELSE
    IF OLD.inventory_ledger_entry_id IS NOT NULL OR NEW.inventory_ledger_entry_id IS NULL OR ROW(NEW.id,NEW.purchase_receipt_id,NEW.line_no,NEW.purchase_order_line_id,NEW.material_id,NEW.unit_id,NEW.quantity,NEW.reversal_of_receipt_line_id,NEW.line_amount,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.purchase_receipt_id,OLD.line_no,OLD.purchase_order_line_id,OLD.material_id,OLD.unit_id,OLD.quantity,OLD.reversal_of_receipt_line_id,OLD.line_amount,OLD.created_at) THEN RAISE EXCEPTION 'posted inventory records are immutable' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_receipts_immutable BEFORE UPDATE OR DELETE ON "purchase_receipts" FOR EACH ROW EXECUTE FUNCTION cyd_purchase_receipt_posting_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_receipt_lines_immutable BEFORE UPDATE OR DELETE ON "purchase_receipt_lines" FOR EACH ROW EXECUTE FUNCTION cyd_purchase_receipt_posting_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_quality_fqc_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_lot_id bigint; lot_row record; net_consumed numeric(24,6);
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.inspection_type='FQC' THEN
    SELECT inventory_lot_id INTO source_lot_id FROM finished_goods_sales_allocations WHERE id=NEW.fqc_allocation_id FOR SHARE;
    IF NOT FOUND OR NEW.inventory_lot_id IS DISTINCT FROM source_lot_id THEN RAISE EXCEPTION 'FQC inventory lot mismatch' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck'; END IF;
  ELSIF NEW.inspection_type='IQC' THEN
    SELECT id INTO source_lot_id FROM inventory_lots WHERE source_purchase_receipt_line_id=NEW.purchase_receipt_line_id AND lot_type='SUPPLIER_RECEIPT' FOR SHARE;
    IF NOT FOUND OR NEW.inventory_lot_id IS DISTINCT FROM source_lot_id THEN RAISE EXCEPTION 'IQC supplier receipt inventory lot mismatch' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck'; END IF;
  ELSIF NEW.inventory_lot_id IS NOT NULL THEN RAISE EXCEPTION 'IPQC cannot reference inventory lot' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck';
  END IF;
  IF NEW.inventory_lot_id IS NOT NULL THEN SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE; IF lot_row.id IS NULL OR ROW(lot_row.material_id,lot_row.unit_id) IS DISTINCT FROM ROW(NEW.material_id,NEW.unit_id) THEN RAISE EXCEPTION 'quality inventory lot material or unit mismatch' USING ERRCODE='23514',CONSTRAINT='quality_inspections_inventory_lot_ck'; END IF; END IF;
  IF TG_OP='UPDATE' AND NEW.inventory_lot_id IS DISTINCT FROM OLD.inventory_lot_id THEN RAISE EXCEPTION 'quality inspection lot is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD.inspection_type='IQC' AND OLD.released_qty>0 AND NEW.released_qty IS DISTINCT FROM OLD.released_qty THEN RAISE EXCEPTION 'IQC inventory release is immutable' USING ERRCODE='23514',CONSTRAINT='quality_iqc_release_immutable_ck'; END IF;
  IF TG_OP='UPDATE' AND OLD.inspection_type='FQC' AND EXISTS(SELECT 1 FROM sales_shipment_line_fqc_allocations fact WHERE fact.quality_inspection_id=OLD.id GROUP BY fact.quality_inspection_id HAVING sum(CASE WHEN fact.entry_type='SHIPMENT' THEN fact.quantity ELSE -fact.quantity END)>0) THEN SELECT coalesce(sum(CASE WHEN entry_type='SHIPMENT' THEN quantity ELSE -quantity END),0) INTO net_consumed FROM sales_shipment_line_fqc_allocations WHERE quality_inspection_id=OLD.id; IF NEW.released_qty<net_consumed OR ROW(NEW.production_completion_line_id,NEW.sales_order_line_id,NEW.fqc_allocation_id,NEW.material_id,NEW.unit_id) IS DISTINCT FROM ROW(OLD.production_completion_line_id,OLD.sales_order_line_id,OLD.fqc_allocation_id,OLD.material_id,OLD.unit_id) THEN RAISE EXCEPTION 'consumed FQC release cannot be reduced or moved' USING ERRCODE='23514',CONSTRAINT='quality_fqc_lot_consumption_gate_ck'; END IF; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cyd_inventory_lot_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lot_row record; ledger_row record; completion_row record; batch_link record;
BEGIN
  IF current_setting('cyd.inventory_lot_service_write',true) IS DISTINCT FROM 'allowed' OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'inventory lot facts are service-managed immutable facts' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='inventory_lot_events' THEN
    SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
    IF lot_row.id IS NULL OR NEW.to_status IS DISTINCT FROM lot_row.status THEN RAISE EXCEPTION 'inventory lot event status mismatch' USING ERRCODE='23514'; END IF;
    IF lot_row.lot_type='SUPPLIER_RECEIPT' AND NEW.purchase_receipt_line_id IS DISTINCT FROM lot_row.source_purchase_receipt_line_id THEN RAISE EXCEPTION 'supplier lot event receipt mismatch' USING ERRCODE='23514',CONSTRAINT='inventory_lot_event_supplier_receipt_ck'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO lot_row FROM inventory_lots WHERE id=NEW.inventory_lot_id FOR SHARE;
  SELECT c.*,cb.production_batch_id INTO completion_row FROM production_completions c JOIN production_completion_batches cb ON cb.production_completion_id=c.id WHERE c.id=NEW.production_completion_id FOR SHARE OF c,cb;
  SELECT * INTO ledger_row FROM inventory_ledger_entries WHERE id=NEW.inventory_ledger_entry_id FOR SHARE;
  SELECT * INTO batch_link FROM production_batches WHERE id=NEW.production_batch_id FOR SHARE;
  IF lot_row.id IS NULL OR lot_row.lot_type<>'MANUFACTURING_FINISHED_GOODS' OR completion_row.id IS NULL OR ledger_row.id IS NULL OR batch_link.id IS NULL OR NEW.production_batch_id IS DISTINCT FROM lot_row.source_production_batch_id OR completion_row.production_batch_id IS DISTINCT FROM NEW.production_batch_id OR completion_row.work_order_id IS DISTINCT FROM lot_row.work_order_id OR batch_link.work_order_id IS DISTINCT FROM lot_row.work_order_id OR completion_row.inventory_adjustment_id IS DISTINCT FROM NEW.inventory_adjustment_id OR ledger_row.adjustment_id IS DISTINCT FROM NEW.inventory_adjustment_id OR ledger_row.inventory_lot_id IS DISTINCT FROM NEW.inventory_lot_id OR ledger_row.material_id IS DISTINCT FROM lot_row.material_id OR ledger_row.unit_id IS DISTINCT FROM lot_row.unit_id OR ledger_row.lot_code IS DISTINCT FROM lot_row.lot_code OR ledger_row.on_hand_delta IS DISTINCT FROM NEW.quantity THEN RAISE EXCEPTION 'completion inventory lot lineage mismatch' USING ERRCODE='23514',CONSTRAINT='production_completion_inventory_lots_lineage_ck'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION cyd_validate_purchase_receipt_posting(target_receipt_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE receipt_row record; line_row record; ledger_row record;
BEGIN
  SELECT * INTO receipt_row FROM purchase_receipts WHERE id=target_receipt_id;
  IF receipt_row.id IS NULL THEN RETURN; END IF;
  IF receipt_row.inventory_adjustment_id IS NULL THEN RAISE EXCEPTION 'purchase receipt adjustment missing at commit' USING ERRCODE='23514',CONSTRAINT='purchase_receipt_posting_complete_ck'; END IF;
  FOR line_row IN SELECT * FROM purchase_receipt_lines WHERE purchase_receipt_id=target_receipt_id LOOP
    IF line_row.inventory_ledger_entry_id IS NULL THEN RAISE EXCEPTION 'purchase receipt ledger missing at commit' USING ERRCODE='23514',CONSTRAINT='purchase_receipt_posting_complete_ck'; END IF;
    SELECT * INTO ledger_row FROM inventory_ledger_entries WHERE id=line_row.inventory_ledger_entry_id;
    IF ledger_row.id IS NULL OR ledger_row.adjustment_id IS DISTINCT FROM receipt_row.inventory_adjustment_id OR ROW(ledger_row.material_id,ledger_row.unit_id) IS DISTINCT FROM ROW(line_row.material_id,line_row.unit_id) OR abs(ledger_row.on_hand_delta) IS DISTINCT FROM line_row.quantity THEN RAISE EXCEPTION 'purchase receipt ledger mismatch' USING ERRCODE='23514',CONSTRAINT='purchase_receipt_posting_complete_ck'; END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_purchase_receipt_posting_deferred_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_receipt_id bigint;
BEGIN
  IF TG_TABLE_NAME='purchase_receipts' THEN target_receipt_id=NEW.id;
  ELSE target_receipt_id=NEW.purchase_receipt_id; END IF;
  PERFORM cyd_validate_purchase_receipt_posting(target_receipt_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER purchase_receipts_posting_reconcile AFTER INSERT OR UPDATE ON "purchase_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_purchase_receipt_posting_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER purchase_receipt_lines_posting_reconcile AFTER INSERT OR UPDATE ON "purchase_receipt_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_purchase_receipt_posting_deferred_guard();
--> statement-breakpoint

CREATE FUNCTION cyd_validate_supplier_receipt_lot(target_lot_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lot_row record; receipt_line record; initial_ledger record; balance_row record; released numeric(24,6); iqc_count bigint;
BEGIN
  SELECT * INTO lot_row FROM inventory_lots WHERE id=target_lot_id;
  IF lot_row.id IS NULL OR lot_row.lot_type<>'SUPPLIER_RECEIPT' THEN RETURN; END IF;
  SELECT prl.*,pr.receipt_type,pr.inventory_adjustment_id,po.supplier_id INTO receipt_line FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.purchase_receipt_id JOIN purchase_orders po ON po.id=pr.purchase_order_id WHERE prl.id=lot_row.source_purchase_receipt_line_id;
  SELECT * INTO initial_ledger FROM inventory_ledger_entries WHERE id=receipt_line.inventory_ledger_entry_id;
  SELECT * INTO balance_row FROM inventory_stock_balances WHERE inventory_lot_id=target_lot_id AND location_code='MAIN';
  SELECT coalesce(sum(released_qty),0),count(*) INTO released,iqc_count FROM quality_inspections WHERE inventory_lot_id=target_lot_id AND inspection_type='IQC';
  IF receipt_line.id IS NULL OR receipt_line.receipt_type<>'RECEIPT' OR receipt_line.supplier_id IS DISTINCT FROM lot_row.supplier_id OR ROW(receipt_line.material_id,receipt_line.unit_id) IS DISTINCT FROM ROW(lot_row.material_id,lot_row.unit_id) OR initial_ledger.id IS NULL OR initial_ledger.entry_type<>'IQC_RECEIPT' OR initial_ledger.adjustment_id IS DISTINCT FROM receipt_line.inventory_adjustment_id OR initial_ledger.inventory_lot_id IS DISTINCT FROM lot_row.id OR initial_ledger.on_hand_delta IS DISTINCT FROM receipt_line.quantity OR initial_ledger.frozen_delta IS DISTINCT FROM receipt_line.quantity OR balance_row.id IS NULL THEN RAISE EXCEPTION 'supplier receipt lot posting mismatch' USING ERRCODE='23514',CONSTRAINT='supplier_receipt_lot_posting_ck'; END IF;
  IF EXISTS(SELECT 1 FROM quality_inspections qi WHERE qi.inventory_lot_id=target_lot_id AND (qi.purchase_receipt_line_id IS DISTINCT FROM lot_row.source_purchase_receipt_line_id OR ROW(qi.material_id,qi.unit_id) IS DISTINCT FROM ROW(lot_row.material_id,lot_row.unit_id) OR qi.released_qty>qi.passed_qty)) THEN RAISE EXCEPTION 'IQC receipt lot source mismatch' USING ERRCODE='23514',CONSTRAINT='supplier_receipt_lot_iqc_ck'; END IF;
  IF lot_row.status='REVERSED' THEN
    IF iqc_count<>0 OR balance_row.on_hand_qty<>0 OR balance_row.frozen_qty<>0 OR balance_row.reserved_qty<>0 THEN RAISE EXCEPTION 'reversed supplier lot must be empty without IQC' USING ERRCODE='23514',CONSTRAINT='supplier_receipt_lot_conservation_ck'; END IF;
  ELSIF balance_row.on_hand_qty<>receipt_line.quantity OR balance_row.reserved_qty<>0 OR balance_row.frozen_qty<>receipt_line.quantity-released OR balance_row.frozen_qty<0 OR released>receipt_line.quantity OR (lot_row.status='FROZEN')<>(balance_row.frozen_qty>0) OR (lot_row.status='AVAILABLE')<>(balance_row.frozen_qty=0 and balance_row.on_hand_qty>0) THEN RAISE EXCEPTION 'supplier receipt lot frozen release conservation failed' USING ERRCODE='23514',CONSTRAINT='supplier_receipt_lot_conservation_ck';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION cyd_supplier_receipt_lot_deferred_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id bigint;
BEGIN
  IF TG_TABLE_NAME='inventory_lots' THEN target_id=coalesce(NEW.id,OLD.id);
  ELSIF TG_TABLE_NAME='inventory_stock_balances' THEN target_id=coalesce(NEW.inventory_lot_id,OLD.inventory_lot_id);
  ELSIF TG_TABLE_NAME='quality_inspections' THEN target_id=coalesce(NEW.inventory_lot_id,OLD.inventory_lot_id);
  ELSE target_id=coalesce(NEW.inventory_lot_id,OLD.inventory_lot_id); END IF;
  IF target_id IS NOT NULL THEN PERFORM cyd_validate_supplier_receipt_lot(target_id); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_lots_supplier_reconcile AFTER INSERT OR UPDATE ON "inventory_lots" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_supplier_receipt_lot_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_balances_supplier_lot_reconcile AFTER INSERT OR UPDATE ON "inventory_stock_balances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_supplier_receipt_lot_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER quality_iqc_supplier_lot_reconcile AFTER INSERT OR UPDATE ON "quality_inspections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_supplier_receipt_lot_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_lot_events_supplier_reconcile AFTER INSERT ON "inventory_lot_events" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cyd_supplier_receipt_lot_deferred_guard();
