import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { InventoryService } from "../inventory-selfhost/service.ts";
import { PostgresInventoryRepository } from "../inventory-selfhost/repository.ts";
import type { InventoryMutationMeta } from "../inventory-selfhost/types.ts";
import { ProcurementError } from "./errors.ts";
import { currency, expectedBalanceVersions, id, lines, optionalDate, quantity, receiptLines, text, version } from "./rules.ts";
import { ProcurementRepository } from "./repository.ts";
import type { ProcurementMeta, ProcurementResult, PurchaseOrderLineInput, ReceiptLineInput } from "./types.ts";

type Queryable = Pool | PoolClient;
type LockedPoLine = { id: string; purchase_order_id: string; material_id: string; unit_id: string; supplier_mapping_id: string; order_qty: string; received_qty: string; unit_price: string; status: string; version: number };

export class ProcurementService {
  readonly repository: ProcurementRepository;
  readonly inventory: InventoryService;
  readonly fault?: (checkpoint: string) => void | Promise<void>;

  constructor(repository: ProcurementRepository, inventory = new InventoryService(new PostgresInventoryRepository(repository.pool)), fault?: (checkpoint: string) => void | Promise<void>) {
    this.repository = repository; this.inventory = inventory; this.fault = fault;
  }

  async listOrders(limit: number, offset: number) {
    return this.repository.pool.query(`select po.*,po.status po_status,s.supplier_code,s.supplier_name,count(pol.id)::int line_count,
      coalesce(sum(pol.order_qty),0)::text total_order_qty,coalesce(sum(pol.received_qty),0)::text total_received_qty
      from purchase_orders po join suppliers s on s.id=po.supplier_id join purchase_order_lines pol on pol.purchase_order_id=po.id
      group by po.id,s.supplier_code,s.supplier_name order by po.created_at desc,po.id desc limit $1 offset $2`, [limit, offset]);
  }

  async getOrder(purchaseOrderId: number) {
    const header = await this.repository.pool.query(`select po.*,po.status po_status,s.supplier_code,s.supplier_name from purchase_orders po join suppliers s on s.id=po.supplier_id where po.id=$1`, [purchaseOrderId]);
    if (!header.rows[0]) throw new ProcurementError("PURCHASE_ORDER_NOT_FOUND", "采购订单不存在", 404);
    const linesResult = await this.listLines(100, 0, purchaseOrderId);
    const events = await this.repository.pool.query("select * from purchase_order_status_events where purchase_order_id=$1 order by id", [purchaseOrderId]);
    return { header: header.rows[0], lines: linesResult.rows, status_events: events.rows };
  }

  async listLines(limit: number, offset: number, purchaseOrderId?: number, receivableOnly = false) {
    const values: unknown[] = []; const filters: string[] = [];
    if (purchaseOrderId) { values.push(purchaseOrderId); filters.push(`pol.purchase_order_id=$${values.length}`); }
    if (receivableOnly) filters.push("po.status in ('OPEN','PARTIALLY_RECEIVED') and pol.received_qty<pol.order_qty");
    values.push(limit, offset);
    return this.repository.pool.query(`select pol.*,pol.status line_status,po.po_code,po.status po_status,s.supplier_name,m.internal_material_code,m.standard_name,u.code uom,
      (pol.order_qty-pol.received_qty)::text remaining_qty,coalesce(b.version,0) balance_version,coalesce(b.on_hand_qty,0)::text on_hand_qty
      from purchase_order_lines pol join purchase_orders po on po.id=pol.purchase_order_id join suppliers s on s.id=po.supplier_id
      join material_master m on m.id=pol.material_id join units u on u.id=pol.unit_id
      left join inventory_stock_balances b on b.material_id=pol.material_id and b.location_code='MAIN' and b.lot_code=''
      ${filters.length ? `where ${filters.join(" and ")}` : ""} order by po.created_at desc,po.id desc,pol.line_no limit $${values.length - 1} offset $${values.length}`, values);
  }

  async listReceipts(limit: number, offset: number, purchaseOrderId?: number) {
    const values: unknown[] = []; const where = purchaseOrderId ? (values.push(purchaseOrderId), "where pr.purchase_order_id=$1") : ""; values.push(limit, offset);
    return this.repository.pool.query(`select pr.*,po.po_code,s.supplier_name,count(prl.id)::int line_count,coalesce(sum(prl.quantity),0)::text total_quantity,pf.amount::text financial_source_amount,pf.currency_code
      from purchase_receipts pr join purchase_orders po on po.id=pr.purchase_order_id join suppliers s on s.id=po.supplier_id
      join purchase_receipt_lines prl on prl.purchase_receipt_id=pr.id join purchase_financial_source_entries pf on pf.purchase_receipt_id=pr.id
      ${where} group by pr.id,po.po_code,s.supplier_name,pf.amount,pf.currency_code order by pr.created_at desc,pr.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async getReceipt(receiptId: number) {
    const header = await this.repository.pool.query(`select pr.*,po.po_code,s.supplier_name,pf.entry_type financial_entry_type,pf.amount::text financial_source_amount,pf.currency_code,pf.source_id financial_source_id
      from purchase_receipts pr join purchase_orders po on po.id=pr.purchase_order_id join suppliers s on s.id=po.supplier_id join purchase_financial_source_entries pf on pf.purchase_receipt_id=pr.id where pr.id=$1`, [receiptId]);
    if (!header.rows[0]) throw new ProcurementError("PURCHASE_RECEIPT_NOT_FOUND", "采购收货单不存在", 404);
    const lineResult = await this.repository.pool.query(`select prl.*,pol.line_no purchase_order_line_no,m.internal_material_code,m.standard_name,u.code unit_code,l.on_hand_delta::text,l.before_on_hand_qty::text,l.after_on_hand_qty::text
      from purchase_receipt_lines prl join purchase_order_lines pol on pol.id=prl.purchase_order_line_id join material_master m on m.id=prl.material_id join units u on u.id=prl.unit_id join inventory_ledger_entries l on l.id=prl.inventory_ledger_entry_id
      where prl.purchase_receipt_id=$1 order by prl.line_no`, [receiptId]);
    return { header: header.rows[0], lines: lineResult.rows };
  }

  async listFinancialSources(limit: number, offset: number) {
    return this.repository.pool.query(`select pf.*,pr.receipt_code,pr.receipt_type,po.id purchase_order_id,po.po_code,s.supplier_code,s.supplier_name
      from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id join purchase_orders po on po.id=pr.purchase_order_id join suppliers s on s.id=pf.supplier_id
      order by pf.created_at desc,pf.id desc limit $1 offset $2`, [limit, offset]);
  }

  private async suggestionRows(db: Queryable, bomId: number, orderQty: string, currencyCode: string) {
    const bom = await db.query(`select bv.id from bom_headers bh join bom_versions bv on bv.bom_header_id=bh.id and bv.version_no=bh.current_version_no where bh.id=$1 and bh.status='ACTIVE' and bv.status='RELEASED'`, [bomId]);
    if (!bom.rows[0]) throw new ProcurementError("BOM_NOT_RELEASED", "BOM 不存在或当前版本未发布", 422);
    return db.query(`with demand as (
        select bl.id bom_line_id,bl.material_id,bl.unit_id,round(bl.quantity_per*$2::numeric*(1+bl.loss_rate),6) required_qty
        from bom_lines bl where bl.bom_version_id=$1
      ) select d.bom_line_id,d.material_id,m.internal_material_code,m.standard_name,c.category_code item_category,d.unit_id,u.code uom,
        d.required_qty::text,coalesce(b.on_hand_qty-b.reserved_qty-b.frozen_qty,0)::text available_qty,
        greatest(d.required_qty-coalesce(b.on_hand_qty-b.reserved_qty-b.frozen_qty,0),0)::text shortage_qty,
        choice.supplier_id,choice.supplier_code,choice.supplier_name,choice.supplier_mapping_id,choice.supplier_item_code,choice.price::text last_price,choice.currency_code,
        null::integer lead_time_days,
        case when m.material_status<>'ACTIVE' or m.inventory_type<>'STOCKED' or not u.enabled or u.id<>m.base_unit_id or choice.supplier_mapping_id is null then 'BLOCKED' else 'READY' end readiness_status,
        case when m.material_status<>'ACTIVE' or m.inventory_type<>'STOCKED' then 'MATERIAL_NOT_ACTIVE'
          when not u.enabled or u.id<>m.base_unit_id then 'UNIT_NOT_ACTIVE_OR_BASE_UNIT_MISMATCH'
          when choice.supplier_mapping_id is null then 'NO_ACTIVE_MAPPING_OR_PRICE' else null end blocking_reason
      from demand d join material_master m on m.id=d.material_id
      join material_categories c on c.id=m.category_id join units u on u.id=d.unit_id
      left join inventory_stock_balances b on b.material_id=d.material_id and b.location_code='MAIN' and b.lot_code=''
      left join lateral (select sm.supplier_id,s.supplier_code,s.supplier_name,sm.id supplier_mapping_id,sm.supplier_item_code,ph.price,ph.currency_code
        from supplier_mappings sm join suppliers s on s.id=sm.supplier_id and s.status='ACTIVE'
        join supplier_mapping_price_history ph on ph.supplier_mapping_id=sm.id and ph.currency_code=$3 and ph.effective_from<=now() and (ph.effective_to is null or ph.effective_to>now()) and ph.price_uom=u.code
        where sm.material_id=d.material_id and sm.status='ACTIVE' and sm.purchase_unit_id=d.unit_id and sm.conversion_numerator=1 and sm.conversion_denominator=1
          and sm.valid_from<=now() and (sm.valid_to is null or sm.valid_to>now()) order by ph.price,sm.id,ph.id desc limit 1) choice on true
      where d.required_qty>coalesce(b.on_hand_qty-b.reserved_qty-b.frozen_qty,0) order by d.bom_line_id`, [Number(bom.rows[0].id), orderQty, currencyCode]);
  }

  async suggestions(bomId: number, orderQtyValue: unknown, currencyValue: unknown = "CNY") {
    return this.suggestionRows(this.repository.pool, bomId, quantity(orderQtyValue, "order_qty"), currency(currencyValue));
  }

  private async validateOrderReferences(client: PoolClient, supplierId: number, orderLines: PurchaseOrderLineInput[]) {
    const supplier = await client.query("select 1 from suppliers where id=$1 and status='ACTIVE'", [supplierId]);
    if (!supplier.rows[0]) throw new ProcurementError("SUPPLIER_NOT_ACTIVE", "供应商不存在或未启用", 422);
    for (const line of orderLines) {
      const valid = await client.query(`select 1 from material_master m join units u on u.id=m.base_unit_id and u.enabled=true
        join supplier_mappings sm on sm.id=$3 and sm.supplier_id=$1 and sm.material_id=m.id and sm.purchase_unit_id=u.id
        where m.id=$2 and m.material_status='ACTIVE' and m.inventory_type='STOCKED' and u.id=$4 and sm.status='ACTIVE' and sm.conversion_numerator=1 and sm.conversion_denominator=1
          and sm.valid_from<=now() and (sm.valid_to is null or sm.valid_to>now())`, [supplierId, line.materialId, line.supplierMappingId, line.unitId]);
      if (!valid.rows[0]) throw new ProcurementError("PURCHASE_REFERENCE_NOT_ACTIVE", "供应商映射、物料或基础单位不存在、未启用或不一致", 422);
    }
  }

  private async insertOrder(client: PoolClient, meta: ProcurementMeta, supplierId: number, currencyCode: string, sourceType: "MANUAL" | "BOM_SHORTAGE", expectedAt: Date | null, remark: string, orderLines: PurchaseOrderLineInput[], source?: { bomVersionId: number; orderQty: string }): Promise<Record<string, unknown>> {
    await this.validateOrderReferences(client, supplierId, orderLines);
    const code = await this.repository.nextCode(client, "PURCHASE_ORDER", "PO"); const operationId = sourceType === "MANUAL" ? meta.operationId : randomUUID();
    const header = await client.query(`insert into purchase_orders(po_code,supplier_id,currency_code,source_type,expected_at,remark,operation_id,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [code, supplierId, currencyCode, sourceType, expectedAt, remark, operationId, meta.actor.username, meta.requestId]);
    const purchaseOrderId = Number(header.rows[0].id); const savedLines = [];
    for (let index = 0; index < orderLines.length; index += 1) { const line = orderLines[index]; const saved = await client.query(`insert into purchase_order_lines(purchase_order_id,line_no,material_id,unit_id,supplier_mapping_id,order_qty,unit_price,remark)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [purchaseOrderId, index + 1, line.materialId, line.unitId, line.supplierMappingId, line.orderQty, line.unitPrice, line.remark]); savedLines.push(saved.rows[0]); }
    await client.query(`insert into purchase_order_source_links(purchase_order_id,source_type,bom_version_id,order_qty,source_operation_id) values($1,$2,$3,$4,$5)`, [purchaseOrderId, sourceType, source?.bomVersionId ?? null, source?.orderQty ?? null, meta.operationId]);
    await client.query(`insert into purchase_order_status_events(purchase_order_id,from_status,to_status,event_type,created_by,request_id) values($1,null,'OPEN','CREATED',$2,$3)`, [purchaseOrderId, meta.actor.username, meta.requestId]);
    return { ...header.rows[0], lines: savedLines };
  }

  async createOrder(meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const supplierId = id(input.supplier_id, "supplier_id"); const currencyCode = currency(input.currency_code ?? "CNY"); const parsedLines = lines(input.lines); const expectedAt = optionalDate(input.expected_at, "expected_at"); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => { const data = await this.insertOrder(client, meta, supplierId, currencyCode, "MANUAL", expectedAt, remark, parsedLines); return { status: 201, body: { ok: true, data, request_id: meta.requestId }, objectId: Number(data.id) }; });
  }

  async createFromShortage(meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const bomId = id(input.bom_id, "bom_id"); const orderQty = quantity(input.order_qty, "order_qty"); const currencyCode = currency(input.currency_code ?? "CNY"); const expectedAt = optionalDate(input.expected_at, "expected_at"); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => {
      const suggestions = await this.suggestionRows(client, bomId, orderQty, currencyCode); const blocked = suggestions.rows.filter((row) => row.readiness_status !== "READY");
      if (blocked.length) throw new ProcurementError("PURCHASE_SUGGESTION_BLOCKED", "缺料建议存在无有效供应商映射或价格的物料，未创建采购单", 422);
      if (!suggestions.rows.length) throw new ProcurementError("NO_PURCHASE_SHORTAGE", "当前 BOM 没有需要采购的缺料", 409);
      const bom = await client.query(`select bv.id from bom_headers bh join bom_versions bv on bv.bom_header_id=bh.id and bv.version_no=bh.current_version_no
        where bh.id=$1 and bh.status='ACTIVE' and bv.status='RELEASED'`, [bomId]);
      const groups = new Map<string, Record<string, unknown>[]>(); for (const row of suggestions.rows) { const key = `${row.supplier_id}:${row.currency_code}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
      const created = [];
      for (const rowsForSupplier of groups.values()) { const first = rowsForSupplier[0]; const orderLines: PurchaseOrderLineInput[] = rowsForSupplier.map((row) => ({ materialId: Number(row.material_id), unitId: Number(row.unit_id), supplierMappingId: Number(row.supplier_mapping_id), orderQty: String(row.shortage_qty), unitPrice: String(row.last_price), remark: "" })); created.push(await this.insertOrder(client, meta, Number(first.supplier_id), String(first.currency_code), "BOM_SHORTAGE", expectedAt, remark, orderLines, { bomVersionId: Number(bom.rows[0].id), orderQty })); }
      return { status: 201, body: { ok: true, created, suggestions: suggestions.rows, request_id: meta.requestId }, objectId: Number(created[0].id) };
    });
  }

  async updateOrder(purchaseOrderId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const expectedVersion = version(input.expected_version, "expected_version"); const expectedAt = optionalDate(input.expected_at, "expected_at"); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => {
      const result = await client.query(`update purchase_orders po set expected_at=$3,remark=$4,version=version+1,updated_at=now()
        where po.id=$1 and po.version=$2 and po.status='OPEN' and not exists(select 1 from purchase_order_lines l where l.purchase_order_id=po.id and l.received_qty>0) returning *`, [purchaseOrderId, expectedVersion, expectedAt, remark]);
      if (!result.rows[0]) throw new ProcurementError("PURCHASE_ORDER_VERSION_OR_STATE_CONFLICT", "采购订单版本已变化、已收货或当前状态不可修改", 409);
      return { status: 200, body: { ok: true, data: result.rows[0], request_id: meta.requestId }, objectId: purchaseOrderId };
    });
  }

  async closeOrder(purchaseOrderId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const expectedVersion = version(input.expected_version, "expected_version"); const reason = text(input.reason, "关闭原因", 1000, true);
    return this.repository.execute(meta, async (client) => {
      const result = await client.query("update purchase_orders set status='CLOSED',version=version+1,updated_at=now() where id=$1 and version=$2 and status='RECEIVED' returning *", [purchaseOrderId, expectedVersion]);
      if (!result.rows[0]) throw new ProcurementError("PURCHASE_ORDER_STATE_CONFLICT", "只有已全部收货且版本匹配的采购订单可以关闭", 409);
      await client.query("insert into purchase_order_status_events(purchase_order_id,from_status,to_status,event_type,reason,created_by,request_id) values($1,'RECEIVED','CLOSED','CLOSED',$2,$3,$4)", [purchaseOrderId, reason, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: result.rows[0], request_id: meta.requestId }, objectId: purchaseOrderId };
    });
  }

  private inventoryMeta(meta: ProcurementMeta, action: string): InventoryMutationMeta { return { ...meta, action }; }

  private async createReceiptInTransaction(client: PoolClient, meta: ProcurementMeta, purchaseOrderId: number, parsedLines: ReceiptLineInput[], reason: string): Promise<ProcurementResult> {
    const poResult = await client.query("select * from purchase_orders where id=$1 for update", [purchaseOrderId]); const po = poResult.rows[0];
    if (!po) throw new ProcurementError("PURCHASE_ORDER_NOT_FOUND", "采购订单不存在", 404);
    if (!['OPEN','PARTIALLY_RECEIVED'].includes(String(po.status))) throw new ProcurementError("PURCHASE_ORDER_NOT_RECEIVABLE", "采购订单当前状态不可收货", 409);
    if (!(await client.query("select 1 from suppliers where id=$1 and status='ACTIVE'", [Number(po.supplier_id)])).rows[0]) throw new ProcurementError("SUPPLIER_NOT_ACTIVE", "供应商不存在或未启用，不能继续收货", 422);
    const lineIds = parsedLines.map((line) => line.purchaseOrderLineId); const locked = await client.query<LockedPoLine>("select * from purchase_order_lines where purchase_order_id=$1 and id=any($2::bigint[]) order by id for update", [purchaseOrderId, lineIds]);
    if (locked.rows.length !== parsedLines.length) throw new ProcurementError("PURCHASE_ORDER_LINE_NOT_FOUND", "采购明细不存在或不属于该采购订单", 404);
    const byId = new Map(locked.rows.map((row) => [Number(row.id), row]));
    for (const input of parsedLines) { const row = byId.get(input.purchaseOrderLineId)!; if (Number(row.version) !== input.expectedLineVersion) throw new ProcurementError("PURCHASE_ORDER_LINE_VERSION_CONFLICT", "采购明细版本已变化，请刷新后重试", 409); const allowed = await client.query("select $1::numeric>0 and $1::numeric<=($2::numeric-$3::numeric) ok", [input.quantity, row.order_qty, row.received_qty]); if (!allowed.rows[0].ok) throw new ProcurementError("PURCHASE_RECEIPT_OVER_QUANTITY", "收货数量超过未收数量", 409); }
    const inventoryResult = await this.inventory.postInTransaction(client, this.inventoryMeta(meta, "PURCHASE_RECEIPT_INVENTORY_POSTED"), { operation_type: "RECEIPT", reason, lines: parsedLines.map((input) => { const row = byId.get(input.purchaseOrderLineId)!; return { material_id: Number(row.material_id), unit_id: Number(row.unit_id), quantity: input.quantity, expected_balance_version: input.expectedBalanceVersion }; }) });
    await this.fault?.("after_inventory");
    const code = await this.repository.nextCode(client, "PURCHASE_RECEIPT", "PR"); const adjustmentId = Number(inventoryResult.adjustmentId); const receipt = await client.query(`insert into purchase_receipts(receipt_code,purchase_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7) returning *`, [code, purchaseOrderId, adjustmentId, reason, meta.operationId, meta.actor.username, meta.requestId]);
    const receiptId = Number(receipt.rows[0].id); const inventoryLines = (inventoryResult.body.data as { lines: Record<string, unknown>[] }).lines; const ledgerByMaterial = new Map(inventoryLines.map((line) => [Number(line.material_id), Number(line.ledger_entry_id)])); const savedLines = [];
    for (let index = 0; index < parsedLines.length; index += 1) { const input = parsedLines[index]; const row = byId.get(input.purchaseOrderLineId)!; const saved = await client.query(`insert into purchase_receipt_lines(purchase_receipt_id,line_no,purchase_order_line_id,material_id,unit_id,quantity,inventory_ledger_entry_id,line_amount)
        values($1,$2,$3,$4,$5,$6,$7,round($6::numeric*$8::numeric,6)) returning *`, [receiptId, index + 1, input.purchaseOrderLineId, Number(row.material_id), Number(row.unit_id), input.quantity, ledgerByMaterial.get(Number(row.material_id)), row.unit_price]); savedLines.push(saved.rows[0]);
      const updated = await client.query(`update purchase_order_lines set received_qty=received_qty+$2::numeric,status=case when received_qty+$2::numeric=order_qty then 'RECEIVED' else 'PARTIALLY_RECEIVED' end,version=version+1,updated_at=now() where id=$1 and version=$3 returning *`, [input.purchaseOrderLineId, input.quantity, input.expectedLineVersion]); if (!updated.rows[0]) throw new ProcurementError("PURCHASE_ORDER_LINE_VERSION_CONFLICT", "采购明细版本已变化，请刷新后重试", 409); }
    const summary = await client.query(`select case when bool_and(received_qty=order_qty) then 'RECEIVED' when bool_or(received_qty>0) then 'PARTIALLY_RECEIVED' else 'OPEN' end next_status from purchase_order_lines where purchase_order_id=$1`, [purchaseOrderId]); const nextStatus = String(summary.rows[0].next_status);
    await client.query("update purchase_orders set status=$2,version=version+1,updated_at=now() where id=$1", [purchaseOrderId, nextStatus]);
    if (nextStatus !== po.status) await client.query("insert into purchase_order_status_events(purchase_order_id,from_status,to_status,event_type,created_by,request_id) values($1,$2,$3,'RECEIPT_POSTED',$4,$5)", [purchaseOrderId, po.status, nextStatus, meta.actor.username, meta.requestId]);
    const financial = await client.query(`insert into purchase_financial_source_entries(purchase_receipt_id,supplier_id,entry_type,amount,currency_code,source_id) select $1,$2,'RECEIPT',sum(line_amount),$3,$4 from purchase_receipt_lines where purchase_receipt_id=$1 returning *`, [receiptId, Number(po.supplier_id), po.currency_code, randomUUID()]);
    const firstInventoryLine = inventoryLines.length === 1 ? inventoryLines[0] : null;
    await this.fault?.("before_result"); const body = { ok: true, data: { ...receipt.rows[0], lines: savedLines, financial_source: financial.rows[0], inventory_adjustment_id: adjustmentId }, receipt_id: receiptId, receipt_code: code, before_qty: firstInventoryLine?.before_on_hand_qty, after_qty: firstInventoryLine?.after_on_hand_qty, request_id: meta.requestId };
    return { status: 201, body, objectId: receiptId };
  }

  async createReceipt(meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const purchaseOrderId = id(input.purchase_order_id, "purchase_order_id"); const parsedLines = receiptLines(input.lines); const reason = text(input.reason ?? "采购收货", "收货原因", 1000, true);
    return this.repository.execute(meta, (client) => this.createReceiptInTransaction(client, meta, purchaseOrderId, parsedLines, reason));
  }

  async createLegacyReceipt(meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const lineId = id(input.line_id, "line_id"); const receiveQty = quantity(input.receive_qty, "receive_qty");
    return this.repository.execute(meta, async (client) => { const row = await client.query(`select pol.*,coalesce(b.version,0) balance_version from purchase_order_lines pol left join inventory_stock_balances b on b.material_id=pol.material_id and b.location_code='MAIN' and b.lot_code='' where pol.id=$1`, [lineId]); if (!row.rows[0]) throw new ProcurementError("PURCHASE_ORDER_LINE_NOT_FOUND", "采购明细不存在", 404); return this.createReceiptInTransaction(client, meta, Number(row.rows[0].purchase_order_id), [{ purchaseOrderLineId: lineId, quantity: receiveQty, expectedLineVersion: Number(row.rows[0].version), expectedBalanceVersion: Number(row.rows[0].balance_version) }], "采购收货"); });
  }

  async reverseReceipt(receiptId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const reason = text(input.reason, "冲销原因", 1000, true); const balances = expectedBalanceVersions(input.expected_balance_versions); const rawLineVersions = input.expected_line_versions;
    if (!Array.isArray(rawLineVersions) || rawLineVersions.length < 1 || rawLineVersions.length > 100) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_line_versions 必须包含 1 到 100 行");
    const lineVersions = new Map<number, number>(); for (const raw of rawLineVersions) { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_line_versions 行无效"); const row = raw as Record<string, unknown>; const lineId = id(row.purchase_order_line_id, "purchase_order_line_id"); if (lineVersions.has(lineId)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_line_versions 不能重复采购明细"); lineVersions.set(lineId, version(row.expected_line_version, "expected_line_version")); }
    return this.repository.execute(meta, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`FINANCE_SOURCE:AP:${receiptId}`]);
      const originalResult = await client.query(`select pr.*,po.supplier_id,po.currency_code,po.status po_status from purchase_receipts pr join purchase_orders po on po.id=pr.purchase_order_id where pr.id=$1 for update of pr,po`, [receiptId]); const original = originalResult.rows[0];
      if (!original) throw new ProcurementError("PURCHASE_RECEIPT_NOT_FOUND", "采购收货单不存在", 404); if (original.receipt_type !== "RECEIPT") throw new ProcurementError("PURCHASE_RECEIPT_REVERSAL_NOT_ALLOWED", "冲销收货单不能再次冲销", 409); if (original.po_status === "CLOSED") throw new ProcurementError("PURCHASE_ORDER_CLOSED", "已关闭采购订单的收货记录不能冲销", 409);
      if ((await client.query("select 1 from purchase_receipts where reversal_of_receipt_id=$1", [receiptId])).rows[0]) throw new ProcurementError("PURCHASE_RECEIPT_ALREADY_REVERSED", "采购收货单已经冲销", 409);
      const source = await client.query(`select prl.*,pol.version line_version from purchase_receipt_lines prl join purchase_order_lines pol on pol.id=prl.purchase_order_line_id where prl.purchase_receipt_id=$1 order by prl.purchase_order_line_id for update of pol`, [receiptId]);
      if (source.rows.length !== lineVersions.size || source.rows.some((row) => lineVersions.get(Number(row.purchase_order_line_id)) !== Number(row.line_version))) throw new ProcurementError("PURCHASE_ORDER_LINE_VERSION_CONFLICT", "采购明细版本已变化，请刷新后重试", 409);
      const inventoryResult = await this.inventory.reverseInTransaction(client, Number(original.inventory_adjustment_id), this.inventoryMeta(meta, "PURCHASE_RECEIPT_INVENTORY_REVERSED"), { reason, expected_balance_versions: balances.map((row) => ({ material_id: row.materialId, expected_balance_version: row.expectedBalanceVersion })) });
      await this.fault?.("after_inventory_reversal"); const code = await this.repository.nextCode(client, "PURCHASE_RECEIPT", "PR");
      const reversal = await client.query(`insert into purchase_receipts(receipt_code,purchase_order_id,receipt_type,reversal_of_receipt_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values($1,$2,'REVERSAL',$3,$4,$5,$6,$7,$8) returning *`, [code, Number(original.purchase_order_id), receiptId, Number(inventoryResult.adjustmentId), reason, meta.operationId, meta.actor.username, meta.requestId]); const reversalId = Number(reversal.rows[0].id);
      const inventoryLines = (inventoryResult.body.data as { lines: Record<string, unknown>[] }).lines; const ledgerByMaterial = new Map(inventoryLines.map((line) => [Number(line.material_id), Number(line.ledger_entry_id)])); const savedLines = [];
      for (let index = 0; index < source.rows.length; index += 1) { const row = source.rows[index]; const saved = await client.query(`insert into purchase_receipt_lines(purchase_receipt_id,line_no,purchase_order_line_id,material_id,unit_id,quantity,inventory_ledger_entry_id,reversal_of_receipt_line_id,line_amount) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [reversalId, index + 1, Number(row.purchase_order_line_id), Number(row.material_id), Number(row.unit_id), row.quantity, ledgerByMaterial.get(Number(row.material_id)), Number(row.id), row.line_amount]); savedLines.push(saved.rows[0]); const expected = lineVersions.get(Number(row.purchase_order_line_id)); const updated = await client.query(`update purchase_order_lines set received_qty=received_qty-$2::numeric,status=case when received_qty-$2::numeric=0 then 'OPEN' else 'PARTIALLY_RECEIVED' end,version=version+1,updated_at=now() where id=$1 and version=$3 and received_qty>=$2::numeric returning *`, [Number(row.purchase_order_line_id), row.quantity, expected]); if (!updated.rows[0]) throw new ProcurementError("PURCHASE_ORDER_LINE_VERSION_CONFLICT", "采购明细版本已变化或累计收货不足", 409); }
      const po = await client.query("select status from purchase_orders where id=$1", [Number(original.purchase_order_id)]); const summary = await client.query(`select case when bool_and(received_qty=order_qty) then 'RECEIVED' when bool_or(received_qty>0) then 'PARTIALLY_RECEIVED' else 'OPEN' end next_status from purchase_order_lines where purchase_order_id=$1`, [Number(original.purchase_order_id)]); const nextStatus = String(summary.rows[0].next_status); await client.query("update purchase_orders set status=$2,version=version+1,updated_at=now() where id=$1", [Number(original.purchase_order_id), nextStatus]); if (po.rows[0].status !== nextStatus) await client.query("insert into purchase_order_status_events(purchase_order_id,from_status,to_status,event_type,reason,created_by,request_id) values($1,$2,$3,'RECEIPT_REVERSED',$4,$5,$6)", [Number(original.purchase_order_id), po.rows[0].status, nextStatus, reason, meta.actor.username, meta.requestId]);
      const financial = await client.query(`insert into purchase_financial_source_entries(purchase_receipt_id,supplier_id,entry_type,amount,currency_code,source_id) select $1,$2,'RECEIPT_REVERSAL',-sum(line_amount),$3,$4 from purchase_receipt_lines where purchase_receipt_id=$1 returning *`, [reversalId, Number(original.supplier_id), original.currency_code, randomUUID()]);
      const body = { ok: true, data: { ...reversal.rows[0], lines: savedLines, financial_source: financial.rows[0], inventory_adjustment_id: Number(inventoryResult.adjustmentId) }, receipt_id: reversalId, receipt_code: code, reversal_of_receipt_id: receiptId, request_id: meta.requestId }; return { status: 201, body, objectId: reversalId };
    });
  }
}
