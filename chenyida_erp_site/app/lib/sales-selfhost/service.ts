import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { InventoryService } from "../inventory-selfhost/service.ts";
import { PostgresInventoryRepository } from "../inventory-selfhost/repository.ts";
import type { InventoryMutationMeta } from "../inventory-selfhost/types.ts";
import { SalesError } from "./errors.ts";
import { currency, expectedBalanceVersions, id, optionalDate, salesLines, shipmentLines, text, version } from "./rules.ts";
import { SalesRepository } from "./repository.ts";
import type { SalesLineInput, SalesMeta, SalesResult, ShipmentLineInput } from "./types.ts";

type QuoteRow = Record<string, unknown> & { id: string; customer_id: string; current_version_no: number; status: string; version: number };
type OrderRow = Record<string, unknown> & { id: string; customer_id: string; current_version_no: number; status: string; version: number; ordered_qty: string; shipped_qty: string };
type OrderLineRow = Record<string, unknown> & { id: string; sales_order_version_id: string; product_id: string; product_version_id: string; finished_material_id: string; unit_id: string; ordered_qty: string; shipped_qty: string; unit_price: string; version: number };

export class SalesService {
  readonly repository: SalesRepository;
  readonly inventory: InventoryService;
  readonly fault?: (checkpoint: string) => void | Promise<void>;

  constructor(repository: SalesRepository, inventory = new InventoryService(new PostgresInventoryRepository(repository.pool)), fault?: (checkpoint: string) => void | Promise<void>) {
    this.repository = repository; this.inventory = inventory; this.fault = fault;
  }

  async listQuotations(limit: number, offset: number) {
    return this.repository.pool.query(`select q.*,q.quotation_code quote_code,q.status quote_status,c.customer_code,c.customer_name,v.id quotation_version_id,v.version_no,v.currency_code,v.total_amount::text,v.valid_until,v.owner,v.remark,
      count(l.id)::int line_count,sum(l.quantity)::text quote_qty,min(l.unit_price)::text unit_price,min(p.product_code) product_code,min(p.product_name) product_name,link.sales_order_id
      from sales_quotations q join customers c on c.id=q.customer_id join sales_quotation_versions v on v.quotation_id=q.id and v.version_no=q.current_version_no
      join sales_quotation_lines l on l.quotation_version_id=v.id join products p on p.id=l.product_id left join sales_quote_order_links link on link.quotation_id=q.id
      group by q.id,c.customer_code,c.customer_name,v.id,link.sales_order_id order by q.created_at desc,q.id desc limit $1 offset $2`, [limit, offset]);
  }

  async getQuotation(quotationId: number) {
    const header = await this.repository.pool.query(`select q.*,c.customer_code,c.customer_name,v.id quotation_version_id,v.status version_status,v.currency_code,v.total_amount::text,v.valid_until,v.owner,v.remark
      from sales_quotations q join customers c on c.id=q.customer_id join sales_quotation_versions v on v.quotation_id=q.id and v.version_no=q.current_version_no where q.id=$1`, [quotationId]);
    if (!header.rows[0]) throw new SalesError("QUOTATION_NOT_FOUND", "报价单不存在", 404);
    const [lines, versions, events, link] = await Promise.all([
      this.repository.pool.query(`select l.*,l.quantity::text,l.unit_price::text,l.line_amount::text,p.product_code,p.product_name,pv.version_code product_version_code,m.internal_material_code finished_item_code,m.standard_name finished_item_name,u.code uom
        from sales_quotation_lines l join products p on p.id=l.product_id join product_versions pv on pv.id=l.product_version_id join material_master m on m.id=l.finished_material_id join units u on u.id=l.unit_id where l.quotation_version_id=$1 order by l.line_no`, [Number(header.rows[0].quotation_version_id)]),
      this.repository.pool.query("select id,quotation_id,version_no,status,currency_code,total_amount::text,valid_until,owner,remark,created_by,request_id,created_at,updated_at from sales_quotation_versions where quotation_id=$1 order by version_no desc", [quotationId]),
      this.repository.pool.query("select * from sales_quotation_status_events where quotation_id=$1 order by id", [quotationId]),
      this.repository.pool.query("select * from sales_quote_order_links where quotation_id=$1", [quotationId]),
    ]);
    return { header: header.rows[0], lines: lines.rows, versions: versions.rows, status_events: events.rows, sales_order_link: link.rows[0] ?? null };
  }

  async getQuotationVersion(quotationId: number, versionNo: number) {
    const header = await this.repository.pool.query("select * from sales_quotation_versions where quotation_id=$1 and version_no=$2", [quotationId, versionNo]);
    if (!header.rows[0]) throw new SalesError("QUOTATION_VERSION_NOT_FOUND", "报价版本不存在", 404);
    const lines = await this.repository.pool.query(`select l.*,p.product_code,p.product_name,pv.version_code product_version_code,m.internal_material_code finished_item_code,m.standard_name finished_item_name,u.code uom from sales_quotation_lines l join products p on p.id=l.product_id join product_versions pv on pv.id=l.product_version_id join material_master m on m.id=l.finished_material_id join units u on u.id=l.unit_id where l.quotation_version_id=$1 order by l.line_no`, [Number(header.rows[0].id)]);
    return { header: header.rows[0], lines: lines.rows };
  }

  async listOrders(limit: number, offset: number) {
    return this.repository.pool.query(`select so.*,so.status sales_status,c.customer_code,c.customer_name,v.id sales_order_version_id,v.currency_code,v.total_amount::text,v.due_date,v.owner,v.remark,
      count(l.id)::int line_count,min(l.id) sales_order_line_id,min(l.version)::int expected_line_version,min(l.product_id) product_id,min(l.product_version_id) product_version_id,min(l.finished_material_id) finished_material_id,min(l.unit_id) unit_id,
      min(p.product_code) product_code,min(p.product_name) product_name,min(m.internal_material_code) finished_item_code,sum(l.ordered_qty)::text order_qty,sum(l.shipped_qty)::text shipped_qty,
      coalesce(min(b.on_hand_qty-b.reserved_qty-b.frozen_qty),0)::text finished_available_qty,coalesce(min(b.version),0)::int expected_balance_version
      from sales_orders so join customers c on c.id=so.customer_id join sales_order_versions v on v.sales_order_id=so.id and v.version_no=so.current_version_no
      join sales_order_lines l on l.sales_order_version_id=v.id join products p on p.id=l.product_id join material_master m on m.id=l.finished_material_id
      left join inventory_stock_balances b on b.material_id=l.finished_material_id and b.location_code='MAIN' and b.lot_code=''
      group by so.id,c.customer_code,c.customer_name,v.id order by so.created_at desc,so.id desc limit $1 offset $2`, [limit, offset]);
  }

  async getOrder(salesOrderId: number) {
    const header = await this.repository.pool.query(`select so.*,c.customer_code,c.customer_name,v.id sales_order_version_id,v.currency_code,v.total_amount::text,v.due_date,v.owner,v.remark from sales_orders so join customers c on c.id=so.customer_id join sales_order_versions v on v.sales_order_id=so.id and v.version_no=so.current_version_no where so.id=$1`, [salesOrderId]);
    if (!header.rows[0]) throw new SalesError("SALES_ORDER_NOT_FOUND", "销售订单不存在", 404);
    const [lines, versions, events, quote, shipments] = await Promise.all([
      this.availableToShip(salesOrderId),
      this.repository.pool.query("select * from sales_order_versions where sales_order_id=$1 order by version_no desc", [salesOrderId]),
      this.repository.pool.query("select * from sales_order_status_events where sales_order_id=$1 order by id", [salesOrderId]),
      this.repository.pool.query("select * from sales_quote_order_links where sales_order_id=$1", [salesOrderId]),
      this.repository.pool.query("select id,shipment_code,shipment_type,original_shipment_id,ship_date,receiver,reason,created_at from sales_shipments where sales_order_id=$1 order by id", [salesOrderId]),
    ]);
    return { header: header.rows[0], lines: lines.rows, versions: versions.rows, status_events: events.rows, quotation_link: quote.rows[0] ?? null, shipments: shipments.rows };
  }

  async availableToShip(salesOrderId: number) {
    return this.repository.pool.query(`select l.*,p.product_code,p.product_name,pv.version_code product_version_code,m.internal_material_code finished_item_code,m.standard_name finished_item_name,u.code uom,
      (l.ordered_qty-l.shipped_qty)::text remaining_qty,coalesce(b.on_hand_qty-b.reserved_qty-b.frozen_qty,0)::text inventory_available_qty,coalesce(fqc.released_qty,0)::text fqc_released_qty,greatest(coalesce(fqc.released_qty,0)-l.shipped_qty,0)::text fqc_available_qty,
      least(l.ordered_qty-l.shipped_qty,coalesce(b.on_hand_qty-b.reserved_qty-b.frozen_qty,0),greatest(coalesce(fqc.released_qty,0)-l.shipped_qty,0))::text available_qty,coalesce(b.version,0)::int balance_version
      from sales_orders so join sales_order_versions v on v.sales_order_id=so.id and v.version_no=so.current_version_no join sales_order_lines l on l.sales_order_version_id=v.id
      join products p on p.id=l.product_id join product_versions pv on pv.id=l.product_version_id join material_master m on m.id=l.finished_material_id join units u on u.id=l.unit_id
      left join inventory_stock_balances b on b.material_id=l.finished_material_id and b.location_code='MAIN' and b.lot_code=''
      left join lateral(select sum(qi.released_qty)::numeric released_qty from quality_inspections qi where qi.sales_order_line_id=l.id and qi.inspection_type='FQC' and qi.lifecycle_status='CLOSED' and qi.decision_status='RELEASED') fqc on true
      where so.id=$1 order by l.line_no`, [salesOrderId]);
  }

  async listShipments(limit: number, offset: number, salesOrderId?: number) {
    const values: unknown[] = []; const where = salesOrderId ? (values.push(salesOrderId), "where sh.sales_order_id=$1") : ""; values.push(limit, offset);
    return this.repository.pool.query(`select sh.*,so.sales_order_code,c.customer_name,count(sl.id)::int line_count,sum(sl.quantity)::text ship_qty,min(p.product_code) product_code,min(p.product_name) product_name,min(m.internal_material_code) finished_item_code,fs.amount::text financial_source_amount,fs.currency_code
      from sales_shipments sh join sales_orders so on so.id=sh.sales_order_id join customers c on c.id=so.customer_id join sales_shipment_lines sl on sl.shipment_id=sh.id
      join sales_order_lines ol on ol.id=sl.sales_order_line_id join products p on p.id=ol.product_id join material_master m on m.id=sl.material_id join sales_financial_source_entries fs on fs.shipment_id=sh.id
      ${where} group by sh.id,so.sales_order_code,c.customer_name,fs.amount,fs.currency_code order by sh.created_at desc,sh.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async getShipment(shipmentId: number) {
    const header = await this.repository.pool.query(`select sh.*,so.sales_order_code,c.customer_code,c.customer_name,fs.id financial_source_entry_id,fs.entry_type financial_entry_type,fs.amount::text financial_source_amount,fs.currency_code,fs.source_id,fs.reversal_of_source_entry_id from sales_shipments sh join sales_orders so on so.id=sh.sales_order_id join customers c on c.id=so.customer_id join sales_financial_source_entries fs on fs.shipment_id=sh.id where sh.id=$1`, [shipmentId]);
    if (!header.rows[0]) throw new SalesError("SHIPMENT_NOT_FOUND", "出货单不存在", 404);
    const lines = await this.repository.pool.query(`select sl.*,ol.line_no sales_order_line_no,p.product_code,p.product_name,m.internal_material_code finished_item_code,m.standard_name finished_item_name,u.code uom,il.before_on_hand_qty::text,il.after_on_hand_qty::text from sales_shipment_lines sl join sales_order_lines ol on ol.id=sl.sales_order_line_id join products p on p.id=ol.product_id join material_master m on m.id=sl.material_id join units u on u.id=sl.unit_id join inventory_ledger_entries il on il.id=sl.inventory_ledger_entry_id where sl.shipment_id=$1 order by sl.line_no`, [shipmentId]);
    return { header: header.rows[0], lines: lines.rows };
  }

  async listFinancialSources(limit: number, offset: number) { return this.repository.pool.query(`select fs.*,sh.shipment_code,sh.shipment_type,so.id sales_order_id,so.sales_order_code,c.customer_code,c.customer_name from sales_financial_source_entries fs join sales_shipments sh on sh.id=fs.shipment_id join sales_orders so on so.id=sh.sales_order_id join customers c on c.id=fs.customer_id order by fs.created_at desc,fs.id desc limit $1 offset $2`, [limit, offset]); }

  private async validateReferences(client: PoolClient, customerId: number, lines: SalesLineInput[]) {
    if (!(await client.query("select 1 from customers where id=$1 and status='ACTIVE'", [customerId])).rows[0]) throw new SalesError("CUSTOMER_NOT_ACTIVE", "客户不存在或未启用", 422);
    for (const line of lines) {
      const valid = await client.query(`select 1 from products p join product_versions pv on pv.id=$2 and pv.product_id=p.id and pv.status='RELEASED'
        join material_master m on m.id=$3 and m.material_status='ACTIVE' and m.inventory_type='STOCKED' join units u on u.id=$4 and u.id=m.base_unit_id and u.enabled=true
        where p.id=$1 and p.status='ACTIVE' and (p.customer_id is null or p.customer_id=$5)`, [line.productId, line.productVersionId, line.finishedMaterialId, line.unitId, customerId]);
      if (!valid.rows[0]) throw new SalesError("SALES_REFERENCE_NOT_ACTIVE", "产品、发布版本、成品物料或基础单位不存在、未启用或不一致", 422);
      if ((await client.query("select 1 from material_customer_restrictions where material_id=$1 and status='ACTIVE' and customer_id is distinct from $2::bigint limit 1", [line.finishedMaterialId, customerId])).rows[0]) throw new SalesError("MATERIAL_CUSTOMER_RESTRICTED", "成品物料的客户限制与订单客户不一致", 422);
    }
  }

  private async insertLines(client: PoolClient, table: "sales_quotation_lines" | "sales_order_lines", parentColumn: "quotation_version_id" | "sales_order_version_id", parentId: number, lines: SalesLineInput[]) {
    const saved = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (table === "sales_quotation_lines") {
        const result = await client.query(`insert into sales_quotation_lines(${parentColumn},line_no,product_id,product_version_id,finished_material_id,unit_id,quantity,unit_price,line_amount,remark) values($1,$2,$3,$4,$5,$6,$7,$8,round($7::numeric*$8::numeric,6),$9) returning *`, [parentId, index + 1, line.productId, line.productVersionId, line.finishedMaterialId, line.unitId, line.quantity, line.unitPrice, line.remark]); saved.push(result.rows[0]);
      } else {
        const result = await client.query(`insert into sales_order_lines(${parentColumn},line_no,product_id,product_version_id,finished_material_id,unit_id,ordered_qty,unit_price,line_amount) values($1,$2,$3,$4,$5,$6,$7,$8,round($7::numeric*$8::numeric,6)) returning *`, [parentId, index + 1, line.productId, line.productVersionId, line.finishedMaterialId, line.unitId, line.quantity, line.unitPrice]); saved.push(result.rows[0]);
      }
    }
    return saved;
  }

  private async quoteTotal(client: PoolClient, versionId: number) { const result = await client.query("select round(sum(line_amount),6)::text total from sales_quotation_lines where quotation_version_id=$1", [versionId]); return String(result.rows[0].total); }

  async createQuotation(meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const customerId = id(input.customer_id, "customer_id"); const lines = salesLines(input.lines); currency(input.currency_code); const validUntil = optionalDate(input.valid_until, "valid_until"); const owner = text(input.owner, "owner", 128); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => {
      await this.validateReferences(client, customerId, lines); const code = await this.repository.nextCode(client, "SALES_QUOTATION", "QT");
      const header = await client.query("insert into sales_quotations(quotation_code,customer_id,operation_id,created_by,request_id) values($1,$2,$3,$4,$5) returning *", [code, customerId, meta.operationId, meta.actor.username, meta.requestId]); const quotationId = Number(header.rows[0].id);
      const versionRow = await client.query("insert into sales_quotation_versions(quotation_id,version_no,status,currency_code,total_amount,valid_until,owner,remark,operation_id,created_by,request_id) values($1,1,'DRAFT','CNY',1,$2,$3,$4,$5,$6,$7) returning *", [quotationId, validUntil, owner, remark, meta.operationId, meta.actor.username, meta.requestId]); const versionId = Number(versionRow.rows[0].id);
      const savedLines = await this.insertLines(client, "sales_quotation_lines", "quotation_version_id", versionId, lines); const total = await this.quoteTotal(client, versionId); const savedVersion = await client.query("update sales_quotation_versions set total_amount=$2 where id=$1 returning *", [versionId, total]);
      await client.query("insert into sales_quotation_status_events(quotation_id,quotation_version_id,from_status,to_status,event_type,created_by,request_id) values($1,$2,null,'DRAFT','CREATED',$3,$4)", [quotationId, versionId, meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: { ...header.rows[0], current_version: { ...savedVersion.rows[0], lines: savedLines } }, quote_id: quotationId, quote_code: code, request_id: meta.requestId }, objectId: quotationId };
    });
  }

  async updateQuotation(quotationId: number, meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const expectedVersion = version(input.expected_version); const lines = salesLines(input.lines); currency(input.currency_code); const validUntil = optionalDate(input.valid_until, "valid_until"); const owner = text(input.owner, "owner", 128); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => {
      const locked = await client.query<QuoteRow>("select * from sales_quotations where id=$1 for update", [quotationId]); const quote = locked.rows[0]; if (!quote) throw new SalesError("QUOTATION_NOT_FOUND", "报价单不存在", 404); if (quote.status !== "DRAFT" || Number(quote.version) !== expectedVersion) throw new SalesError("QUOTATION_VERSION_OR_STATE_CONFLICT", "报价版本已变化或当前状态不可编辑", 409);
      await this.validateReferences(client, Number(quote.customer_id), lines); const current = await client.query("select * from sales_quotation_versions where quotation_id=$1 and version_no=$2 and status='DRAFT' for update", [quotationId, quote.current_version_no]); if (!current.rows[0]) throw new SalesError("QUOTATION_VERSION_OR_STATE_CONFLICT", "当前草稿版本不存在或已发布", 409); const versionId = Number(current.rows[0].id);
      await client.query("delete from sales_quotation_lines where quotation_version_id=$1", [versionId]); const savedLines = await this.insertLines(client, "sales_quotation_lines", "quotation_version_id", versionId, lines); const total = await this.quoteTotal(client, versionId);
      const savedVersion = await client.query("update sales_quotation_versions set total_amount=$2,valid_until=$3,owner=$4,remark=$5,updated_at=now() where id=$1 and status='DRAFT' returning *", [versionId, total, validUntil, owner, remark]); const savedQuote = await client.query("update sales_quotations set version=version+1,updated_at=now() where id=$1 and version=$2 returning *", [quotationId, expectedVersion]); if (!savedQuote.rows[0]) throw new SalesError("QUOTATION_VERSION_CONFLICT", "报价单已被并发更新", 409);
      return { status: 200, body: { ok: true, data: { ...savedQuote.rows[0], current_version: { ...savedVersion.rows[0], lines: savedLines } }, request_id: meta.requestId }, objectId: quotationId };
    });
  }

  async createQuotationVersion(quotationId: number, meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const expectedVersion = version(input.expected_version); currency(input.currency_code); const validUntil = optionalDate(input.valid_until, "valid_until"); const owner = text(input.owner, "owner", 128); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => {
      const locked = await client.query<QuoteRow>("select * from sales_quotations where id=$1 for update", [quotationId]); const quote = locked.rows[0]; if (!quote) throw new SalesError("QUOTATION_NOT_FOUND", "报价单不存在", 404); if (Number(quote.version) !== expectedVersion || ["DRAFT", "CONVERTED", "CANCELLED"].includes(quote.status)) throw new SalesError("QUOTATION_REVISION_NOT_ALLOWED", "报价版本已变化、已有草稿或当前状态不能修订", 409);
      const source = await client.query("select * from sales_quotation_versions where quotation_id=$1 and version_no=$2 for update", [quotationId, quote.current_version_no]); if (!source.rows[0]) throw new SalesError("QUOTATION_VERSION_NOT_FOUND", "当前报价版本不存在", 404);
      const parsedLines = input.lines === undefined ? null : salesLines(input.lines); let lines: SalesLineInput[];
      if (parsedLines) lines = parsedLines; else { const sourceLines = await client.query("select * from sales_quotation_lines where quotation_version_id=$1 order by line_no", [Number(source.rows[0].id)]); lines = sourceLines.rows.map((row) => ({ productId: Number(row.product_id), productVersionId: Number(row.product_version_id), finishedMaterialId: Number(row.finished_material_id), unitId: Number(row.unit_id), quantity: String(row.quantity), unitPrice: String(row.unit_price), remark: String(row.remark) })); }
      await this.validateReferences(client, Number(quote.customer_id), lines); await client.query("update sales_quotation_versions set status='SUPERSEDED',updated_at=now() where id=$1", [Number(source.rows[0].id)]); const nextNo = Number(quote.current_version_no) + 1;
      const savedVersion = await client.query("insert into sales_quotation_versions(quotation_id,version_no,status,currency_code,total_amount,valid_until,owner,remark,operation_id,created_by,request_id) values($1,$2,'DRAFT','CNY',1,$3,$4,$5,$6,$7,$8) returning *", [quotationId, nextNo, validUntil ?? source.rows[0].valid_until, owner || source.rows[0].owner, remark || source.rows[0].remark, meta.operationId, meta.actor.username, meta.requestId]); const versionId = Number(savedVersion.rows[0].id);
      const savedLines = await this.insertLines(client, "sales_quotation_lines", "quotation_version_id", versionId, lines); const total = await this.quoteTotal(client, versionId); const finalVersion = await client.query("update sales_quotation_versions set total_amount=$2 where id=$1 returning *", [versionId, total]); const savedQuote = await client.query("update sales_quotations set current_version_no=$2,status='DRAFT',version=version+1,updated_at=now() where id=$1 and version=$3 returning *", [quotationId, nextNo, expectedVersion]); if (!savedQuote.rows[0]) throw new SalesError("QUOTATION_VERSION_CONFLICT", "报价单已被并发更新", 409);
      await client.query("insert into sales_quotation_status_events(quotation_id,quotation_version_id,from_status,to_status,event_type,created_by,request_id) values($1,$2,$3,'DRAFT','REVISION_CREATED',$4,$5)", [quotationId, versionId, quote.status, meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: { ...savedQuote.rows[0], current_version: { ...finalVersion.rows[0], lines: savedLines } }, request_id: meta.requestId }, objectId: quotationId };
    });
  }

  async transitionQuotation(quotationId: number, target: "PUBLISHED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED", meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const expectedVersion = version(input.expected_version); const reason = text(input.reason, "原因", 1000, target !== "PUBLISHED" && target !== "ACCEPTED");
    const allowed: Record<string, string[]> = { PUBLISHED: ["DRAFT"], ACCEPTED: ["PUBLISHED"], REJECTED: ["PUBLISHED"], EXPIRED: ["PUBLISHED", "ACCEPTED"], CANCELLED: ["DRAFT", "PUBLISHED", "ACCEPTED"] };
    return this.repository.execute(meta, async (client) => {
      const locked = await client.query<QuoteRow>("select * from sales_quotations where id=$1 for update", [quotationId]); const quote = locked.rows[0]; if (!quote) throw new SalesError("QUOTATION_NOT_FOUND", "报价单不存在", 404); if (Number(quote.version) !== expectedVersion || !allowed[target].includes(quote.status)) throw new SalesError("QUOTATION_STATE_CONFLICT", "报价版本已变化或当前状态不能执行该转换", 409);
      const current = await client.query("select * from sales_quotation_versions where quotation_id=$1 and version_no=$2 for update", [quotationId, quote.current_version_no]); if (!current.rows[0] || current.rows[0].status !== quote.status) throw new SalesError("QUOTATION_PROJECTION_INCONSISTENT", "报价当前版本状态不一致", 409);
      if (target === "PUBLISHED") { await this.validateReferences(client, Number(quote.customer_id), (await client.query("select * from sales_quotation_lines where quotation_version_id=$1 order by line_no", [Number(current.rows[0].id)])).rows.map((row) => ({ productId: Number(row.product_id), productVersionId: Number(row.product_version_id), finishedMaterialId: Number(row.finished_material_id), unitId: Number(row.unit_id), quantity: String(row.quantity), unitPrice: String(row.unit_price), remark: String(row.remark) }))); if (current.rows[0].valid_until && new Date(current.rows[0].valid_until) <= new Date()) throw new SalesError("QUOTATION_ALREADY_EXPIRED", "报价有效期已过，不能发布", 409); }
      await client.query("update sales_quotation_versions set status=$2,updated_at=now() where id=$1", [Number(current.rows[0].id), target]); const updated = await client.query("update sales_quotations set status=$2,version=version+1,updated_at=now() where id=$1 and version=$3 returning *", [quotationId, target, expectedVersion]); if (!updated.rows[0]) throw new SalesError("QUOTATION_VERSION_CONFLICT", "报价单已被并发更新", 409);
      await client.query("insert into sales_quotation_status_events(quotation_id,quotation_version_id,from_status,to_status,event_type,reason,created_by,request_id) values($1,$2,$3,$4,$4,$5,$6,$7)", [quotationId, Number(current.rows[0].id), quote.status, target, reason, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: quotationId };
    });
  }

  private async insertOrder(client: PoolClient, meta: SalesMeta, customerId: number, lines: SalesLineInput[], dueDate: Date | null, owner: string, remark: string) {
    await this.validateReferences(client, customerId, lines); const code = await this.repository.nextCode(client, "SALES_ORDER", "SO"); const totals = await client.query("select round(sum(x.qty*x.price),6)::text amount,round(sum(x.qty),6)::text quantity from unnest($1::numeric[],$2::numeric[]) x(qty,price)", [lines.map((line) => line.quantity), lines.map((line) => line.unitPrice)]); const totalAmount = String(totals.rows[0].amount); const orderedQty = String(totals.rows[0].quantity);
    const header = await client.query("insert into sales_orders(sales_order_code,customer_id,ordered_qty,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6) returning *", [code, customerId, orderedQty, meta.operationId, meta.actor.username, meta.requestId]); const salesOrderId = Number(header.rows[0].id);
    const versionRow = await client.query("insert into sales_order_versions(sales_order_id,version_no,currency_code,total_amount,due_date,owner,remark,created_by,request_id) values($1,1,'CNY',$2,$3,$4,$5,$6,$7) returning *", [salesOrderId, totalAmount, dueDate, owner, remark, meta.actor.username, meta.requestId]); const savedLines = await this.insertLines(client, "sales_order_lines", "sales_order_version_id", Number(versionRow.rows[0].id), lines);
    await client.query("insert into sales_order_status_events(sales_order_id,from_status,to_status,event_type,created_by,request_id) values($1,null,'OPEN','CREATED',$2,$3)", [salesOrderId, meta.actor.username, meta.requestId]); return { ...header.rows[0], current_version: { ...versionRow.rows[0], lines: savedLines } };
  }

  async createOrder(meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const customerId = id(input.customer_id, "customer_id"); const lines = salesLines(input.lines); currency(input.currency_code); const dueDate = optionalDate(input.due_date, "due_date"); const owner = text(input.owner, "owner", 128); const remark = text(input.remark, "remark", 2000);
    return this.repository.execute(meta, async (client) => { const data = await this.insertOrder(client, meta, customerId, lines, dueDate, owner, remark); return { status: 201, body: { ok: true, data, sales_order_id: Number(data.id), sales_order_code: data.sales_order_code, request_id: meta.requestId }, objectId: Number(data.id) }; });
  }

  async convertQuotation(quotationId: number, meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const expectedVersion = version(input.expected_version); const dueDate = optionalDate(input.due_date, "due_date"); const ownerOverride = text(input.owner, "owner", 128);
    return this.repository.execute(meta, async (client) => {
      const locked = await client.query<QuoteRow>("select * from sales_quotations where id=$1 for update", [quotationId]); const quote = locked.rows[0]; if (!quote) throw new SalesError("QUOTATION_NOT_FOUND", "报价单不存在", 404); if (Number(quote.version) !== expectedVersion || quote.status !== "ACCEPTED") throw new SalesError("QUOTATION_NOT_CONVERTIBLE", "只有版本匹配且已接受的报价可以转销售订单", 409); if ((await client.query("select 1 from sales_quote_order_links where quotation_id=$1", [quotationId])).rows[0]) throw new SalesError("QUOTATION_ALREADY_CONVERTED", "报价单已经转为销售订单", 409);
      const current = await client.query("select * from sales_quotation_versions where quotation_id=$1 and version_no=$2 and status='ACCEPTED' for update", [quotationId, quote.current_version_no]); if (!current.rows[0]) throw new SalesError("QUOTATION_VERSION_NOT_CONVERTIBLE", "报价当前版本不可转换", 409); if (current.rows[0].valid_until && new Date(current.rows[0].valid_until) < new Date()) throw new SalesError("QUOTATION_EXPIRED", "报价已过有效期，不能转单", 409);
      const sourceLines = await client.query("select * from sales_quotation_lines where quotation_version_id=$1 order by line_no", [Number(current.rows[0].id)]); const lines: SalesLineInput[] = sourceLines.rows.map((row) => ({ productId: Number(row.product_id), productVersionId: Number(row.product_version_id), finishedMaterialId: Number(row.finished_material_id), unitId: Number(row.unit_id), quantity: String(row.quantity), unitPrice: String(row.unit_price), remark: String(row.remark) }));
      const order = await this.insertOrder(client, meta, Number(quote.customer_id), lines, dueDate ?? current.rows[0].valid_until, ownerOverride || String(current.rows[0].owner), `由报价单 ${String(quote.quotation_code)} 转入；${String(current.rows[0].remark || "")}`); await this.fault?.("after_order_created"); const salesOrderId = Number(order.id);
      await client.query("insert into sales_quote_order_links(quotation_id,quotation_version_id,sales_order_id,created_by,request_id) values($1,$2,$3,$4,$5)", [quotationId, Number(current.rows[0].id), salesOrderId, meta.actor.username, meta.requestId]); await client.query("update sales_quotation_versions set status='CONVERTED',updated_at=now() where id=$1", [Number(current.rows[0].id)]); const updated = await client.query("update sales_quotations set status='CONVERTED',version=version+1,updated_at=now() where id=$1 and version=$2 and status='ACCEPTED' returning *", [quotationId, expectedVersion]); if (!updated.rows[0]) throw new SalesError("QUOTATION_CONVERSION_CONFLICT", "报价单已被并发转换", 409);
      await client.query("insert into sales_quotation_status_events(quotation_id,quotation_version_id,from_status,to_status,event_type,created_by,request_id) values($1,$2,'ACCEPTED','CONVERTED','CONVERTED',$3,$4)", [quotationId, Number(current.rows[0].id), meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, quote_code: quote.quotation_code, sales_order_id: salesOrderId, sales_order_code: order.sales_order_code, data: { quotation: updated.rows[0], sales_order: order }, request_id: meta.requestId }, objectId: salesOrderId };
    });
  }

  private inventoryMeta(meta: SalesMeta, action: string): InventoryMutationMeta { return { ...meta, action }; }

  private async createShipmentInTransaction(client: PoolClient, salesOrderId: number, meta: SalesMeta, inputs: ShipmentLineInput[], shipDate: Date | null, receiver: string, reason: string): Promise<SalesResult> {
    const orderResult = await client.query<OrderRow>("select * from sales_orders where id=$1 for update", [salesOrderId]); const order = orderResult.rows[0]; if (!order) throw new SalesError("SALES_ORDER_NOT_FOUND", "销售订单不存在", 404); if (!["OPEN", "PARTIALLY_SHIPPED"].includes(order.status)) throw new SalesError("SALES_ORDER_NOT_SHIPPABLE", "销售订单当前状态不可出货", 409);
    const ids = inputs.map((line) => line.salesOrderLineId); const locked = await client.query<OrderLineRow>(`select l.* from sales_order_lines l join sales_order_versions v on v.id=l.sales_order_version_id and v.sales_order_id=$1 join sales_orders so on so.id=$1 and v.version_no=so.current_version_no where l.id=any($2::bigint[]) order by l.id for update of l`, [salesOrderId, ids]); if (locked.rows.length !== inputs.length) throw new SalesError("SALES_ORDER_LINE_NOT_FOUND", "销售明细不存在或不属于当前订单版本", 404); const byId = new Map(locked.rows.map((row) => [Number(row.id), row]));
    for (const input of inputs) {
      const row = byId.get(input.salesOrderLineId)!; if (Number(row.version) !== input.expectedLineVersion) throw new SalesError("SALES_ORDER_LINE_VERSION_CONFLICT", "销售明细版本已变化，请刷新后重试", 409);
      const allowed = await client.query("select $1::numeric>0 and $1::numeric<=($2::numeric-$3::numeric) ok", [input.quantity, row.ordered_qty, row.shipped_qty]); if (!allowed.rows[0].ok) throw new SalesError("SHIPMENT_OVER_QUANTITY", "出货数量超过订单未出数量", 409);
      const quality = await client.query(`with released as (
          select coalesce(sum(released_qty),0)::numeric qty from quality_inspections where sales_order_line_id=$1 and inspection_type='FQC' and lifecycle_status='CLOSED' and decision_status='RELEASED'
        ), consumed as (
          select coalesce(sum(case when sh.shipment_type='SHIPMENT' then sl.quantity else -sl.quantity end),0)::numeric qty from sales_shipment_lines sl join sales_shipments sh on sh.id=sl.shipment_id where sl.sales_order_line_id=$1
        ) select consumed.qty+$2::numeric<=released.qty ok from released,consumed`, [input.salesOrderLineId, input.quantity]);
      if (!quality.rows[0].ok) throw new SalesError("FQC_RELEASE_INSUFFICIENT", "FQC 已关闭放行数量不足，不能出货", 409);
    }
    const inventory = await this.inventory.postInTransaction(client, this.inventoryMeta(meta, "SALES_SHIPMENT_INVENTORY_POSTED"), { operation_type: "ISSUE", reason, lines: inputs.map((input) => { const row = byId.get(input.salesOrderLineId)!; return { material_id: Number(row.finished_material_id), unit_id: Number(row.unit_id), quantity: input.quantity, expected_balance_version: input.expectedBalanceVersion }; }) }); await this.fault?.("after_shipment_inventory");
    const code = await this.repository.nextCode(client, "SALES_SHIPMENT", "DN"); const shipment = await client.query("insert into sales_shipments(shipment_code,sales_order_id,inventory_adjustment_id,ship_date,receiver,reason,operation_id,created_by,request_id) values($1,$2,$3,coalesce($4,now()),$5,$6,$7,$8,$9) returning *", [code, salesOrderId, Number(inventory.adjustmentId), shipDate, receiver, reason, meta.operationId, meta.actor.username, meta.requestId]); const shipmentId = Number(shipment.rows[0].id); const inventoryLines = (inventory.body.data as { lines: Record<string, unknown>[] }).lines; const ledger = new Map(inventoryLines.map((line) => [Number(line.material_id), Number(line.ledger_entry_id)])); const saved = [];
    for (let index = 0; index < inputs.length; index += 1) { const input = inputs[index]; const row = byId.get(input.salesOrderLineId)!; const line = await client.query("insert into sales_shipment_lines(shipment_id,line_no,sales_order_line_id,material_id,unit_id,quantity,inventory_ledger_entry_id) values($1,$2,$3,$4,$5,$6,$7) returning *", [shipmentId, index + 1, input.salesOrderLineId, Number(row.finished_material_id), Number(row.unit_id), input.quantity, ledger.get(Number(row.finished_material_id))]); saved.push(line.rows[0]); const updated = await client.query("update sales_order_lines set shipped_qty=shipped_qty+$2::numeric,version=version+1,updated_at=now() where id=$1 and version=$3 and shipped_qty+$2::numeric<=ordered_qty returning *", [input.salesOrderLineId, input.quantity, input.expectedLineVersion]); if (!updated.rows[0]) throw new SalesError("SALES_ORDER_LINE_VERSION_CONFLICT", "销售明细并发更新冲突", 409); }
    const summary = await client.query(`select round(sum(ordered_qty),6)::text ordered,round(sum(shipped_qty),6)::text shipped,case when bool_and(shipped_qty=ordered_qty) then 'SHIPPED' when bool_or(shipped_qty>0) then 'PARTIALLY_SHIPPED' else 'OPEN' end next_status from sales_order_lines where sales_order_version_id=(select id from sales_order_versions where sales_order_id=$1 and version_no=$2)`, [salesOrderId, order.current_version_no]); const nextStatus = String(summary.rows[0].next_status); const updatedOrder = await client.query("update sales_orders set shipped_qty=$2,status=$3,version=version+1,updated_at=now() where id=$1 and version=$4 returning *", [salesOrderId, summary.rows[0].shipped, nextStatus, order.version]); if (!updatedOrder.rows[0]) throw new SalesError("SALES_ORDER_VERSION_CONFLICT", "销售订单已被并发更新", 409); if (order.status !== nextStatus) await client.query("insert into sales_order_status_events(sales_order_id,from_status,to_status,event_type,created_by,request_id) values($1,$2,$3,'SHIPMENT_POSTED',$4,$5)", [salesOrderId, order.status, nextStatus, meta.actor.username, meta.requestId]);
    const financial = await client.query(`insert into sales_financial_source_entries(shipment_id,customer_id,entry_type,amount,currency_code,source_id) select $1,$2,'SHIPMENT',round(sum(sl.quantity*ol.unit_price),6),'CNY',$3 from sales_shipment_lines sl join sales_order_lines ol on ol.id=sl.sales_order_line_id where sl.shipment_id=$1 returning *`, [shipmentId, Number(order.customer_id), randomUUID()]); await this.fault?.("after_shipment_projection");
    return { status: 201, body: { ok: true, data: { ...shipment.rows[0], lines: saved, inventory: inventory.body.data, sales_order: updatedOrder.rows[0], financial_source: financial.rows[0] }, shipment_id: shipmentId, shipment_code: code, shipped_qty: updatedOrder.rows[0].shipped_qty, sales_status: nextStatus, request_id: meta.requestId }, objectId: shipmentId };
  }

  async createShipment(meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> { const salesOrderId = id(input.sales_order_id, "sales_order_id"); const expectedOrderVersion = version(input.expected_order_version, "expected_order_version"); const lines = shipmentLines(input.lines); const shipDate = optionalDate(input.ship_date, "ship_date"); const receiver = text(input.receiver, "receiver", 1000); const reason = text(input.reason ?? "销售出货", "出货原因", 1000, true); return this.repository.execute(meta, async (client) => { const current = await client.query("select version from sales_orders where id=$1", [salesOrderId]); if (!current.rows[0]) throw new SalesError("SALES_ORDER_NOT_FOUND", "销售订单不存在", 404); if (Number(current.rows[0].version) !== expectedOrderVersion) throw new SalesError("SALES_ORDER_VERSION_CONFLICT", "销售订单版本已变化，请刷新后重试", 409); return this.createShipmentInTransaction(client, salesOrderId, meta, lines, shipDate, receiver, reason); }); }

  async createLegacyShipment(meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const salesOrderId = id(input.sales_order_id, "sales_order_id"); const shipQty = String(input.ship_qty ?? input.quantity ?? ""); const shipDate = optionalDate(input.ship_date, "ship_date"); const receiver = text(input.receiver, "receiver", 1000); const reason = text(input.reason ?? "销售出货", "出货原因", 1000, true);
    return this.repository.execute(meta, async (client) => { const lines = await client.query(`select l.*,coalesce(b.version,0)::int balance_version from sales_orders so join sales_order_versions v on v.sales_order_id=so.id and v.version_no=so.current_version_no join sales_order_lines l on l.sales_order_version_id=v.id left join inventory_stock_balances b on b.material_id=l.finished_material_id and b.location_code='MAIN' and b.lot_code='' where so.id=$1 and l.shipped_qty<l.ordered_qty order by l.line_no for update of so,l`, [salesOrderId]); if (lines.rows.length !== 1) throw new SalesError("LEGACY_SHIPMENT_REQUIRES_SINGLE_LINE", "兼容出货仅支持单行订单，请使用稳定多行出货接口", 409); const row = lines.rows[0]; return this.createShipmentInTransaction(client, salesOrderId, meta, [{ salesOrderLineId: Number(row.id), quantity: shipQty, expectedLineVersion: Number(row.version), expectedBalanceVersion: Number(row.balance_version) }], shipDate, receiver, reason); });
  }

  async reverseShipment(shipmentId: number, meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const reason = text(input.reason, "冲销原因", 1000, true); const balances = expectedBalanceVersions(input.expected_balance_versions);
    return this.repository.execute(meta, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`FINANCE_SOURCE:AR:${shipmentId}`]);
      const originalResult = await client.query(`select sh.*,so.status order_status,so.version order_version,so.customer_id,so.current_version_no,fs.id financial_source_entry_id,fs.amount financial_amount,fs.currency_code from sales_shipments sh join sales_orders so on so.id=sh.sales_order_id join sales_financial_source_entries fs on fs.shipment_id=sh.id where sh.id=$1 for update of sh,so`, [shipmentId]); const original = originalResult.rows[0]; if (!original) throw new SalesError("SHIPMENT_NOT_FOUND", "出货单不存在", 404); if (original.shipment_type !== "SHIPMENT") throw new SalesError("SHIPMENT_REVERSAL_NOT_ALLOWED", "冲销出货单不能再次冲销", 409); if (original.order_status === "CLOSED") throw new SalesError("SALES_ORDER_CLOSED", "已关闭销售订单的出货不能冲销", 409); if ((await client.query("select 1 from sales_shipments where original_shipment_id=$1", [shipmentId])).rows[0]) throw new SalesError("SHIPMENT_ALREADY_REVERSED", "出货单已经冲销", 409);
      const sourceLines = await client.query("select sl.*,ol.version line_version from sales_shipment_lines sl join sales_order_lines ol on ol.id=sl.sales_order_line_id where sl.shipment_id=$1 order by sl.sales_order_line_id for update of ol", [shipmentId]); const materialIds = sourceLines.rows.map((row) => Number(row.material_id)); if (balances.length !== materialIds.length || materialIds.some((materialId) => !balances.some((entry) => entry.materialId === materialId))) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 必须完整匹配原出货物料");
      const inventory = await this.inventory.reverseInTransaction(client, Number(original.inventory_adjustment_id), this.inventoryMeta(meta, "SALES_SHIPMENT_INVENTORY_REVERSED"), { reason, expected_balance_versions: balances.map((row) => ({ material_id: row.materialId, expected_balance_version: row.expectedBalanceVersion })) }); await this.fault?.("after_shipment_inventory_reversal"); const code = await this.repository.nextCode(client, "SALES_SHIPMENT", "DN"); const reversal = await client.query("insert into sales_shipments(shipment_code,sales_order_id,shipment_type,original_shipment_id,inventory_adjustment_id,ship_date,receiver,reason,operation_id,created_by,request_id) values($1,$2,'REVERSAL',$3,$4,now(),$5,$6,$7,$8,$9) returning *", [code, Number(original.sales_order_id), shipmentId, Number(inventory.adjustmentId), String(original.receiver), reason, meta.operationId, meta.actor.username, meta.requestId]); const reversalId = Number(reversal.rows[0].id); const inventoryLines = (inventory.body.data as { lines: Record<string, unknown>[] }).lines; const ledger = new Map(inventoryLines.map((line) => [Number(line.material_id), Number(line.ledger_entry_id)])); const saved = [];
      for (let index = 0; index < sourceLines.rows.length; index += 1) { const row = sourceLines.rows[index]; const line = await client.query("insert into sales_shipment_lines(shipment_id,line_no,sales_order_line_id,material_id,unit_id,quantity,inventory_ledger_entry_id) values($1,$2,$3,$4,$5,$6,$7) returning *", [reversalId, index + 1, Number(row.sales_order_line_id), Number(row.material_id), Number(row.unit_id), row.quantity, ledger.get(Number(row.material_id))]); saved.push(line.rows[0]); const updated = await client.query("update sales_order_lines set shipped_qty=shipped_qty-$2::numeric,version=version+1,updated_at=now() where id=$1 and version=$3 and shipped_qty>=$2::numeric returning *", [Number(row.sales_order_line_id), row.quantity, Number(row.line_version)]); if (!updated.rows[0]) throw new SalesError("SALES_ORDER_LINE_VERSION_CONFLICT", "销售明细已变化，不能安全冲销", 409); }
      const summary = await client.query(`select round(sum(shipped_qty),6)::text shipped,case when bool_and(shipped_qty=ordered_qty) then 'SHIPPED' when bool_or(shipped_qty>0) then 'PARTIALLY_SHIPPED' else 'OPEN' end next_status from sales_order_lines where sales_order_version_id=(select id from sales_order_versions where sales_order_id=$1 and version_no=$2)`, [Number(original.sales_order_id), Number(original.current_version_no)]); const nextStatus = String(summary.rows[0].next_status); const updatedOrder = await client.query("update sales_orders set shipped_qty=$2,status=$3,version=version+1,updated_at=now() where id=$1 and version=$4 returning *", [Number(original.sales_order_id), summary.rows[0].shipped, nextStatus, Number(original.order_version)]); if (!updatedOrder.rows[0]) throw new SalesError("SALES_ORDER_VERSION_CONFLICT", "销售订单已变化，不能安全冲销", 409); if (original.order_status !== nextStatus) await client.query("insert into sales_order_status_events(sales_order_id,from_status,to_status,event_type,reason,created_by,request_id) values($1,$2,$3,'SHIPMENT_REVERSED',$4,$5,$6)", [Number(original.sales_order_id), original.order_status, nextStatus, reason, meta.actor.username, meta.requestId]); const financial = await client.query("insert into sales_financial_source_entries(shipment_id,customer_id,entry_type,amount,currency_code,source_id,reversal_of_source_entry_id) values($1,$2,'SHIPMENT_REVERSAL',-$3::numeric,$4,$5,$6) returning *", [reversalId, Number(original.customer_id), original.financial_amount, original.currency_code, randomUUID(), Number(original.financial_source_entry_id)]); await this.fault?.("after_shipment_reversal_projection");
      return { status: 201, body: { ok: true, data: { ...reversal.rows[0], lines: saved, inventory: inventory.body.data, sales_order: updatedOrder.rows[0], financial_source: financial.rows[0] }, shipment_id: reversalId, shipment_code: code, reversal_of_shipment_id: shipmentId, request_id: meta.requestId }, objectId: reversalId };
    });
  }

  async transitionOrder(salesOrderId: number, target: "CLOSED" | "CANCELLED", meta: SalesMeta, input: Record<string, unknown>): Promise<SalesResult> {
    const expectedVersion = version(input.expected_version); const reason = text(input.reason, "原因", 1000, true);
    return this.repository.execute(meta, async (client) => { const locked = await client.query<OrderRow>("select * from sales_orders where id=$1 for update", [salesOrderId]); const order = locked.rows[0]; if (!order) throw new SalesError("SALES_ORDER_NOT_FOUND", "销售订单不存在", 404); const permitted = target === "CLOSED" ? order.status === "SHIPPED" : order.status === "OPEN" && String(order.shipped_qty) === "0.000000"; if (Number(order.version) !== expectedVersion || !permitted) throw new SalesError("SALES_ORDER_STATE_CONFLICT", target === "CLOSED" ? "只有全部出货且版本匹配的订单可以关闭" : "只有从未出货且版本匹配的开放订单可以取消", 409); const updated = await client.query("update sales_orders set status=$2,version=version+1,updated_at=now() where id=$1 and version=$3 returning *", [salesOrderId, target, expectedVersion]); await client.query("insert into sales_order_status_events(sales_order_id,from_status,to_status,event_type,reason,created_by,request_id) values($1,$2,$3,$3,$4,$5,$6)", [salesOrderId, order.status, target, reason, meta.actor.username, meta.requestId]); return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: salesOrderId }; });
  }
}
