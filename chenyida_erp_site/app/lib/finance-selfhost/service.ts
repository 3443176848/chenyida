import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { FinanceError } from "./errors.ts";
import { amount, date, documentType, id, settlementType, text, version } from "./rules.ts";
import { FinanceRepository } from "./repository.ts";
import type { FinanceDocumentType, FinanceMeta, FinanceResult } from "./types.ts";

type DocumentRow = Record<string, unknown> & { id: string; doc_type: string; total_amount: string; settled_amount: string; status: string; version: number; currency_code: string };

export const FINANCE_BOUNDARY = Object.freeze({
  authority: "Node/PostgreSQL",
  ar_source: "AR 只能来自未冲销的正向 Shipment 金额来源；不从销售订单头或浏览器金额创建。",
  ap_source: "AP 只能来自未冲销的正向 Receipt 金额来源；不从采购订单头或浏览器金额创建。",
  allocation_model: "TASK09 首期每笔收付款核销一张财务单据；Settlement 的 document_id 与 amount 是不可变核销事实。",
  foreign_exchange: false,
  bank_or_payment_gateway: false,
  invoice_or_general_ledger: false,
  production_data_migrated: false,
});

export function visibleFinanceTypes(actor: Pick<IdentityActor, "role">): FinanceDocumentType[] {
  if (["admin", "manager", "finance", "operations", "warehouse"].includes(actor.role)) return ["AR", "AP"];
  if (actor.role === "sales") return ["AR"];
  if (actor.role === "purchase") return ["AP"];
  return [];
}

function assertVisible(actor: Pick<IdentityActor, "role">, type: string): asserts type is FinanceDocumentType {
  const family = type === "OPENING_AR" ? "AR" : type === "OPENING_AP" ? "AP" : type;
  if (!visibleFinanceTypes(actor).includes(family as FinanceDocumentType)) throw new FinanceError("FINANCE_NOT_VISIBLE", "财务记录不存在", 404);
}

function databaseTypes(types: FinanceDocumentType[]) { return types.flatMap((type) => type === "AR" ? ["AR", "OPENING_AR"] : ["AP", "OPENING_AP"]); }

function documentSelect() {
  return `select d.*,case when d.doc_type in ('AR','OPENING_AR') then '应收' else '应付' end legacy_doc_type,
    case d.status when 'OPEN' then '未结清' when 'PARTIALLY_SETTLED' then '部分结清' when 'REVERSED' then '已冲销' else '已结清' end legacy_status,
    (d.total_amount-d.settled_amount)::text balance_amount,d.total_amount::text total_amount,d.settled_amount::text settled_amount,
    coalesce(c.customer_name,s.supplier_name) counterparty,coalesce(c.customer_code,s.supplier_code) counterparty_code,
    coalesce(sh.shipment_code,pr.receipt_code) source_code,
    case when d.doc_type='AR' then 'SHIPMENT' when d.doc_type='AP' then 'RECEIPT' else 'FINANCE_OPENING' end source_type,
    coalesce(d.sales_source_entry_id,d.purchase_source_entry_id,d.finance_opening_source_id) stable_source_entry_id
    from finance_documents d left join customers c on c.id=d.customer_id left join suppliers s on s.id=d.supplier_id
    left join sales_financial_source_entries sf on sf.id=d.sales_source_entry_id left join sales_shipments sh on sh.id=sf.shipment_id
    left join purchase_financial_source_entries pf on pf.id=d.purchase_source_entry_id left join purchase_receipts pr on pr.id=pf.purchase_receipt_id`;
}

function legacyDocument(row: Record<string, unknown>) { return { ...row, doc_type_label: row.legacy_doc_type, paid_amount: row.settled_amount, doc_status: row.legacy_status, source_id: row.stable_source_entry_id }; }
function legacySettlement(actor: Pick<IdentityActor,"role">, row: Record<string, unknown>) { const reversal = String(row.settlement_type).endsWith("_REVERSAL"); const receipt = String(row.settlement_type).startsWith("RECEIPT"); const visibleAccount=["admin","manager","finance"].includes(actor.role); return { ...row, account_name:visibleAccount?row.account_name:undefined, payment_code: row.settlement_code, payment_type: reversal ? (receipt ? "收款冲销" : "付款冲销") : (receipt ? "收款" : "付款"), payment_date: row.accounting_date, handled_by: row.created_by }; }

export class FinanceService {
  readonly repository: FinanceRepository; readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: FinanceRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  async list(actor: IdentityActor, limit: number, offset: number, requestedType?: string, status?: string) {
    const types = visibleFinanceTypes(actor); if (!types.length) return [];
    const values: unknown[] = [databaseTypes(types)]; const where = ["d.doc_type=any($1::text[])"];
    if (requestedType) { const normalized = ["应收", "AR"].includes(requestedType) ? "AR" : ["应付", "AP"].includes(requestedType) ? "AP" : documentType(requestedType); assertVisible(actor, normalized); values.push(databaseTypes([normalized])); where.push(`d.doc_type=any($${values.length}::text[])`); }
    if (status) { const normalized = String(status).trim().toUpperCase(); if (!["OPEN", "PARTIALLY_SETTLED", "SETTLED", "REVERSED"].includes(normalized)) throw new FinanceError("REQUEST_VALIDATION_FAILED", "status 无效"); values.push(normalized); where.push(`d.status=$${values.length}`); }
    values.push(limit, offset); const result = await this.repository.pool.query(`${documentSelect()} where ${where.join(" and ")} order by d.created_at desc,d.id desc limit $${values.length - 1} offset $${values.length}`, values); return result.rows.map(legacyDocument);
  }

  async get(actor: IdentityActor, documentId: number) {
    const found = await this.repository.pool.query(`${documentSelect()} where d.id=$1`, [documentId]); if (!found.rows[0]) throw new FinanceError("FINANCE_DOCUMENT_NOT_FOUND", "财务单据不存在", 404); assertVisible(actor, String(found.rows[0].doc_type));
    const settlements = await this.repository.pool.query(`select fs.*,d.doc_code,coalesce(c.customer_name,s.supplier_name) counterparty,exists(select 1 from finance_settlements r where r.original_settlement_id=fs.id) is_reversed from finance_settlements fs join finance_documents d on d.id=fs.document_id left join customers c on c.id=d.customer_id left join suppliers s on s.id=d.supplier_id where fs.document_id=$1 order by fs.id`, [documentId]);
    const events = await this.repository.pool.query("select * from finance_document_events where document_id=$1 order by id", [documentId]); return { ...legacyDocument(found.rows[0]), settlements: settlements.rows.map((row)=>legacySettlement(actor,row)), events: events.rows, boundary: FINANCE_BOUNDARY };
  }

  async listSettlements(actor: IdentityActor, limit: number, offset: number, documentId?: number) {
    const types = visibleFinanceTypes(actor); if (!types.length) return []; const values: unknown[] = [databaseTypes(types)]; const where = ["d.doc_type=any($1::text[])"];
    if (documentId) { values.push(documentId); where.push(`fs.document_id=$${values.length}`); }
    values.push(limit, offset); const result = await this.repository.pool.query(`select fs.*,d.doc_code,d.doc_type,d.version document_version,coalesce(c.customer_name,s.supplier_name) counterparty,exists(select 1 from finance_settlements r where r.original_settlement_id=fs.id) is_reversed from finance_settlements fs join finance_documents d on d.id=fs.document_id left join customers c on c.id=d.customer_id left join suppliers s on s.id=d.supplier_id where ${where.join(" and ")} order by fs.created_at desc,fs.id desc limit $${values.length - 1} offset $${values.length}`, values); return result.rows.map((row)=>legacySettlement(actor,row));
  }

  async summary(actor: IdentityActor) {
    const types = visibleFinanceTypes(actor); if (!types.length) return { receivable_total: "0", receivable_paid: "0", receivable_balance: "0", payable_total: "0", payable_paid: "0", payable_balance: "0", cash_net: "0" }; const result = await this.repository.pool.query(`select
      coalesce(sum(total_amount) filter(where doc_type in ('AR','OPENING_AR') and status<>'REVERSED'),0)::text receivable_total,coalesce(sum(settled_amount) filter(where doc_type in ('AR','OPENING_AR') and status<>'REVERSED'),0)::text receivable_paid,coalesce(sum(total_amount-settled_amount) filter(where doc_type in ('AR','OPENING_AR') and status<>'REVERSED'),0)::text receivable_balance,
      coalesce(sum(total_amount) filter(where doc_type in ('AP','OPENING_AP') and status<>'REVERSED'),0)::text payable_total,coalesce(sum(settled_amount) filter(where doc_type in ('AP','OPENING_AP') and status<>'REVERSED'),0)::text payable_paid,coalesce(sum(total_amount-settled_amount) filter(where doc_type in ('AP','OPENING_AP') and status<>'REVERSED'),0)::text payable_balance
      from finance_documents where doc_type=any($1::text[])`, [databaseTypes(types)]); const cash = await this.repository.pool.query(`select coalesce(sum(case when fs.settlement_type in ('RECEIPT','RECEIPT_REVERSAL') then fs.amount else -fs.amount end),0)::text cash_net from finance_settlements fs join finance_documents d on d.id=fs.document_id where d.doc_type=any($1::text[])`, [databaseTypes(types)]); return { ...result.rows[0], ...cash.rows[0] };
  }

  async sourceOptions(actor: IdentityActor, typeValue: string, limit: number) {
    const type = documentType(typeValue); assertVisible(actor, type);
    if (type === "AR") return this.repository.pool.query(`select 'AR' document_type,sf.id source_entry_id,sf.id sales_source_entry_id,sf.id stable_source_entry_id,sf.amount::text amount,sf.currency_code,sf.customer_id,c.customer_code,c.customer_name,sh.id shipment_id,sh.shipment_code source_code,sh.ship_date source_date from sales_financial_source_entries sf join sales_shipments sh on sh.id=sf.shipment_id join customers c on c.id=sf.customer_id left join finance_documents d on d.sales_source_entry_id=sf.id where sf.entry_type='SHIPMENT' and d.id is null and not exists(select 1 from sales_financial_source_entries r where r.reversal_of_source_entry_id=sf.id) order by sf.id desc limit $1`, [limit]);
    return this.repository.pool.query(`select 'AP' document_type,pf.id source_entry_id,pf.id purchase_source_entry_id,pf.id stable_source_entry_id,pf.amount::text amount,pf.currency_code,pf.supplier_id,s.supplier_code,s.supplier_name,pr.id purchase_receipt_id,pr.receipt_code source_code,pr.created_at source_date from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id join suppliers s on s.id=pf.supplier_id left join finance_documents d on d.purchase_source_entry_id=pf.id where pf.entry_type='RECEIPT' and d.id is null and not exists(select 1 from purchase_receipts rr where rr.reversal_of_receipt_id=pr.id) order by pf.id desc limit $1`, [limit]);
  }

  private async ensureProjectAllocations(client: PoolClient, type: FinanceDocumentType, sourceId: number, sourceAmount: string, meta: FinanceMeta) {
    const sourceColumn = type === "AR" ? "sales_source_entry_id" : "purchase_source_entry_id";
    const existing = await client.query(`select count(*)::int count,coalesce(sum(amount),0)::text amount from finance_project_source_allocations where ${sourceColumn}=$1`, [sourceId]);
    if (Number(existing.rows[0].count)) {
      if (String(existing.rows[0].amount) !== sourceAmount) throw new FinanceError("FINANCE_PROJECT_ALLOCATION_INVALID", "财务来源的项目分配金额不守恒", 409);
      return;
    }
    const rows = type === "AR" ? await client.query(`with candidates as (
      select sf.id source_entry_id,sl.id source_line_id,fa.id origin_id,fa.quantity source_quantity,ol.unit_price,
        round(fa.quantity*ol.unit_price,6) rounded_amount,round(sl.quantity*ol.unit_price,6) line_amount,
        max(fa.id) over(partition by sl.id) max_origin_id,sum(round(fa.quantity*ol.unit_price,6)) over(partition by sl.id) rounded_total,pp.project_id
      from sales_financial_source_entries sf join sales_shipment_lines sl on sl.shipment_id=sf.shipment_id join sales_order_lines ol on ol.id=sl.sales_order_line_id
      join sales_shipment_line_fqc_allocations fa on fa.shipment_line_id=sl.id and fa.entry_type='SHIPMENT'
      left join finished_goods_sales_allocations fga on fga.id=fa.fqc_allocation_id left join production_completion_lines pcl on pcl.id=fga.completion_line_id
      left join production_completions pc on pc.id=pcl.completion_id left join production_handoff_work_order_links wl on wl.work_order_id=pc.work_order_id
      left join production_handoff_items hi on hi.id=wl.handoff_item_id left join production_handoffs ph on ph.id=hi.handoff_id
      left join project_planning_packages pp on pp.id=ph.planning_package_id where sf.id=$1 and sf.entry_type='SHIPMENT'
    ), resolved as (
      select source_entry_id,source_line_id,origin_id,source_quantity,unit_price,project_id,case when origin_id=max_origin_id then line_amount-(rounded_total-rounded_amount) else rounded_amount end amount from candidates
      union all
      select sf.id,sl.id,null,sl.quantity,ol.unit_price,null,round(sl.quantity*ol.unit_price,6)
      from sales_financial_source_entries sf join sales_shipment_lines sl on sl.shipment_id=sf.shipment_id join sales_order_lines ol on ol.id=sl.sales_order_line_id
      where sf.id=$1 and sf.entry_type='SHIPMENT' and not exists(select 1 from sales_shipment_line_fqc_allocations fa where fa.shipment_line_id=sl.id and fa.entry_type='SHIPMENT')
    ) select * from resolved where amount>0 order by source_line_id,origin_id nulls last`, [sourceId]) : await client.query(`select pf.id source_entry_id,prl.id source_line_id,null::bigint origin_id,prl.quantity source_quantity,pol.unit_price,prl.line_amount amount,p.project_id
      from purchase_financial_source_entries pf join purchase_receipt_lines prl on prl.purchase_receipt_id=pf.purchase_receipt_id join purchase_order_lines pol on pol.id=prl.purchase_order_line_id
      left join purchase_receipt_delivery_allocations rda on rda.purchase_receipt_line_id=prl.id and rda.reversal_of_allocation_id is null
      left join purchase_delivery_plans dp on dp.id=rda.delivery_plan_id left join procurement_award_po_line_links apl on apl.purchase_order_line_id=dp.purchase_order_line_id
      left join procurement_sourcing_award_lines al on al.id=apl.award_line_id left join procurement_sourcing_awards a on a.id=al.award_id
      left join procurement_rfqs q on q.id=a.rfq_id left join planning_purchase_requests r on r.id=q.purchase_request_id
      left join planning_material_requirement_plans p on p.id=r.plan_id where pf.id=$1 and pf.entry_type='RECEIPT' and prl.line_amount>0 order by prl.id`, [sourceId]);
    // 0024 以前已存在的人工/测试来源可能没有关系化来源行；保留单据兼容，由查询层明确归入 UNATTRIBUTED。
    if (!rows.rows.length) return;
    for (const row of rows.rows) {
      const projectId = row.project_id === null ? null : Number(row.project_id); const status = projectId === null ? "UNATTRIBUTED" : "PROJECT";
      const digest = createHash("sha256").update(JSON.stringify([type, Number(row.source_entry_id), Number(row.source_line_id), row.origin_id === null ? null : Number(row.origin_id), projectId, status, String(row.source_quantity), String(row.unit_price), String(row.amount)])).digest("hex");
      await client.query(`insert into finance_project_source_allocations(source_type,sales_source_entry_id,purchase_source_entry_id,sales_shipment_line_id,sales_fqc_consumption_id,purchase_receipt_line_id,project_id,attribution_status,source_quantity,unit_price,amount,allocation_digest,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [type === "AR" ? "SALES_SHIPMENT" : "PURCHASE_RECEIPT", type === "AR" ? sourceId : null, type === "AP" ? sourceId : null, type === "AR" ? Number(row.source_line_id) : null, type === "AR" && row.origin_id !== null ? Number(row.origin_id) : null, type === "AP" ? Number(row.source_line_id) : null, projectId, status, row.source_quantity, row.unit_price, row.amount, digest, meta.actor.username, meta.requestId]);
    }
    await this.fault?.("after_finance_project_allocations");
  }

  async projectSummary(actor: IdentityActor, currency?: string) {
    if (!(actor.permissions.includes("*") || actor.permissions.includes("finance.project.read"))) throw new FinanceError("PERMISSION_DENIED", "没有权限读取项目财务汇总", 403);
    const currencyCode = currency ? String(currency).trim().toUpperCase() : null; if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) throw new FinanceError("REQUEST_VALIDATION_FAILED", "currency 必须是三位币种代码");
    const result = await this.repository.pool.query(`with source_allocations as (
      select d.id document_id,d.doc_type,d.currency_code,d.total_amount,a.id allocation_id,a.project_id,a.amount source_amount
      from finance_documents d join finance_project_source_allocations a on (d.sales_source_entry_id=a.sales_source_entry_id or d.purchase_source_entry_id=a.purchase_source_entry_id) where d.doc_type in ('AR','AP')
      union all
      select d.id,d.doc_type,d.currency_code,d.total_amount,0,null,d.total_amount from finance_documents d where d.doc_type in ('AR','AP') and not exists(select 1 from finance_project_source_allocations a where a.sales_source_entry_id=d.sales_source_entry_id or a.purchase_source_entry_id=d.purchase_source_entry_id)
    ), settlement_rounded as (
      select s.id settlement_id,sa.document_id,sa.doc_type,sa.currency_code,sa.project_id,sa.allocation_id,s.amount,
        round(s.amount*sa.source_amount/sa.total_amount,6) rounded_amount,row_number() over(partition by s.id order by sa.allocation_id,sa.project_id nulls last) allocation_order
      from finance_settlements s join source_allocations sa on sa.document_id=s.document_id
    ), settlement_allocations as (
      select *,rounded_amount+case when allocation_order=1 then amount-sum(rounded_amount) over(partition by settlement_id) else 0 end allocated_amount from settlement_rounded
    ), source_totals as (
      select project_id,currency_code,sum(source_amount) filter(where doc_type='AR') sales_source_amount,sum(source_amount) filter(where doc_type='AP') purchase_source_amount from source_allocations group by project_id,currency_code
    ), cash_totals as (
      select project_id,currency_code,sum(allocated_amount) filter(where doc_type='AR') customer_receipts,sum(allocated_amount) filter(where doc_type='AP') supplier_payments from settlement_allocations group by project_id,currency_code
    ) select st.project_id,coalesce(p.project_code,'UNATTRIBUTED') project_code,coalesce(p.project_name,'未归属') project_name,st.currency_code,
      coalesce(st.sales_source_amount,0)::text sales_source_amount,coalesce(st.purchase_source_amount,0)::text purchase_source_amount,
      coalesce(st.sales_source_amount,0)::text ar_total,coalesce(ct.customer_receipts,0)::text ar_settled,(coalesce(st.sales_source_amount,0)-coalesce(ct.customer_receipts,0))::text ar_outstanding,
      coalesce(st.purchase_source_amount,0)::text ap_total,coalesce(ct.supplier_payments,0)::text ap_settled,(coalesce(st.purchase_source_amount,0)-coalesce(ct.supplier_payments,0))::text ap_outstanding,
      coalesce(ct.customer_receipts,0)::text customer_receipts,coalesce(ct.supplier_payments,0)::text supplier_payments,(coalesce(ct.customer_receipts,0)-coalesce(ct.supplier_payments,0))::text net_cash,
      (coalesce(st.sales_source_amount,0)-coalesce(st.purchase_source_amount,0))::text transaction_contribution,
      case when st.project_id is null then (coalesce(st.sales_source_amount,0)+coalesce(st.purchase_source_amount,0))::text else '0' end unattributed_amount
      from source_totals st left join cash_totals ct on ct.project_id is not distinct from st.project_id and ct.currency_code=st.currency_code left join business_projects p on p.id=st.project_id
      where ($1::text is null or st.currency_code=$1) and ($2::text<>'engineering' or (p.project_owner=$3 and st.project_id is not null)) order by st.project_id nulls last,st.currency_code`, [currencyCode, actor.role, actor.username]);
    return { rows: result.rows, currency_aggregated: false, accounting_profit: false, disclaimer: "交易贡献与净现金流不是毛利、净利润或会计利润；未包含人工、制造费用、公司费用、税、折旧、汇率和库存成本。" };
  }

  async create(meta: FinanceMeta, input: Record<string, unknown>): Promise<FinanceResult> {
    const type = documentType(input.doc_type ?? input.document_type); assertVisible(meta.actor, type); const today = new Date().toISOString().slice(0, 10); const accountingDate = date(input.accounting_date ?? today, "accounting_date")!; const dueDate = date(input.due_date, "due_date", false); const sourceKey = type === "AR" ? "sales_source_entry_id" : "purchase_source_entry_id"; const sourceId = id(input[sourceKey] ?? input.source_entry_id, sourceKey); const other = type === "AR" ? "purchase_source_entry_id" : "sales_source_entry_id"; if (input[other] !== undefined && input[other] !== null && input[other] !== "") throw new FinanceError("FINANCE_SOURCE_INVALID", "财务单据只能绑定规定的稳定来源", 422);
    return this.repository.execute(meta, async (client) => {
      const parent = type === "AR" ? await client.query("select shipment_id parent_id from sales_financial_source_entries where id=$1", [sourceId]) : await client.query("select purchase_receipt_id parent_id from purchase_financial_source_entries where id=$1", [sourceId]); if (!parent.rows[0]) throw new FinanceError("FINANCE_SOURCE_INVALID", "稳定金额来源不存在、已冲销或不能过账", 422); await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`FINANCE_SOURCE:${type}:${parent.rows[0].parent_id}`]);
      const source = type === "AR"
        ? await client.query(`select sf.*,not exists(select 1 from sales_financial_source_entries r where r.reversal_of_source_entry_id=sf.id) active from sales_financial_source_entries sf join sales_shipments sh on sh.id=sf.shipment_id where sf.id=$1 for update of sh`, [sourceId])
        : await client.query(`select pf.*,not exists(select 1 from purchase_receipts rr where rr.reversal_of_receipt_id=pr.id) active from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id where pf.id=$1 for update of pr`, [sourceId]); const row = source.rows[0]; const expectedEntry = type === "AR" ? "SHIPMENT" : "RECEIPT"; if (!row || row.entry_type !== expectedEntry || !row.active) throw new FinanceError("FINANCE_SOURCE_INVALID", "稳定金额来源不存在、已冲销或不能过账", 422); if ((await client.query(`select 1 from finance_documents where ${type === "AR" ? "sales_source_entry_id" : "purchase_source_entry_id"}=$1`, [sourceId])).rows[0]) throw new FinanceError("FINANCE_SOURCE_ALREADY_POSTED", "该稳定金额来源已经生成财务单据", 409);
      await this.ensureProjectAllocations(client, type, sourceId, String(row.amount), meta); const code = await this.repository.nextCode(client, type === "AR" ? "FINANCE_AR" : "FINANCE_AP", type); const created = await client.query(`insert into finance_documents(doc_code,doc_type,sales_source_entry_id,purchase_source_entry_id,customer_id,supplier_id,currency_code,total_amount,accounting_date,due_date,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [code, type, type === "AR" ? sourceId : null, type === "AP" ? sourceId : null, type === "AR" ? Number(row.customer_id) : null, type === "AP" ? Number(row.supplier_id) : null, row.currency_code, row.amount, accountingDate, dueDate, meta.operationId, meta.actor.username, meta.requestId]); const documentId = Number(created.rows[0].id); await client.query("insert into finance_document_events(document_id,event_type,to_status,reason,created_by,request_id) values($1,'CREATED','OPEN','',$2,$3)", [documentId, meta.actor.username, meta.requestId]); await this.fault?.("after_finance_document_create"); return { status: 201, body: { ok: true, data: created.rows[0], doc_id: documentId, doc_code: code, boundary: FINANCE_BOUNDARY, request_id: meta.requestId }, objectId: documentId };
    });
  }

  private async lockDocument(client: PoolClient, documentId: number): Promise<DocumentRow> { const found = await client.query<DocumentRow>("select * from finance_documents where id=$1 for update", [documentId]); if (!found.rows[0]) throw new FinanceError("FINANCE_DOCUMENT_NOT_FOUND", "财务单据不存在", 404); return found.rows[0]; }

  async settle(meta: FinanceMeta, input: Record<string, unknown>): Promise<FinanceResult> {
    const documentId = id(input.document_id ?? input.doc_id, "document_id"); const expected = version(input.expected_version); const value = amount(input.amount); const requestedType=input.settlement_type===undefined?null:settlementType(input.settlement_type); const accountingDate = date(input.accounting_date ?? input.payment_date, "accounting_date")!; const accountName = text(input.account_name, "account_name", 200, true); const reason = text(input.reason ?? input.remark, "reason", 1000);
    return this.repository.execute(meta, async (client) => { const document = await this.lockDocument(client, documentId); if (Number(document.version) !== expected) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据版本已变化", 409); if (document.status === "REVERSED") throw new FinanceError("FINANCE_DOCUMENT_REVERSED", "已冲销期初不能核销", 409); const allowed = await client.query("select $1::numeric<=($2::numeric-$3::numeric) ok", [value, document.total_amount, document.settled_amount]); if (!allowed.rows[0].ok) throw new FinanceError("FINANCE_AMOUNT_EXCEEDS_BALANCE", "本次核销金额不能超过未结余额", 409); const receivable = ["AR", "OPENING_AR"].includes(document.doc_type); const effectiveType = receivable ? "RECEIPT" : "PAYMENT"; if(requestedType&&requestedType!==effectiveType)throw new FinanceError("FINANCE_SETTLEMENT_TYPE_MISMATCH",receivable?"AR 只能登记客户收款 RECEIPT":"AP 只能登记供应商付款 PAYMENT",422); const code = await this.repository.nextCode(client, receivable ? "FINANCE_RECEIPT" : "FINANCE_PAYMENT", receivable ? "RCV" : "PAY"); const created = await client.query("insert into finance_settlements(settlement_code,document_id,settlement_type,amount,accounting_date,account_name,reason,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *", [code, documentId, effectiveType, value, accountingDate, accountName, reason, meta.operationId, meta.actor.username, meta.requestId]); const updated = await client.query(`update finance_documents set settled_amount=settled_amount+$2::numeric,status=case when settled_amount+$2::numeric=total_amount then 'SETTLED' else 'PARTIALLY_SETTLED' end,version=version+1,updated_at=now() where id=$1 and version=$3 returning *`, [documentId, value, expected]); if (!updated.rows[0]) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据已被并发核销", 409); const settlementId = Number(created.rows[0].id); await client.query("insert into finance_document_events(document_id,event_type,from_status,to_status,amount,settlement_id,reason,created_by,request_id) values($1,'SETTLED',$2,$3,$4,$5,$6,$7,$8)", [documentId, document.status, updated.rows[0].status, value, settlementId, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_finance_settlement"); return { status: 201, body: { ok: true, data: created.rows[0], settlement_id: settlementId, payment_code: code, doc_status: updated.rows[0].status, settled_amount: updated.rows[0].settled_amount, document_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: settlementId };
    });
  }

  async reverseSettlement(settlementId: number, meta: FinanceMeta, input: Record<string, unknown>): Promise<FinanceResult> {
    const expected = version(input.expected_version); const accountingDate = date(input.accounting_date ?? input.payment_date, "accounting_date")!; const reason = text(input.reason ?? input.remark, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => { const lookup = await client.query<{ document_id: string }>("select document_id from finance_settlements where id=$1", [settlementId]); if (!lookup.rows[0]) throw new FinanceError("FINANCE_SETTLEMENT_NOT_FOUND", "收付款记录不存在", 404); const document = await this.lockDocument(client, Number(lookup.rows[0].document_id)); if (Number(document.version) !== expected) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据版本已变化", 409); const original = await client.query<Record<string, unknown> & { id: string; amount: string; settlement_type: string; account_name: string; original_settlement_id: string | null }>("select * from finance_settlements where id=$1 and document_id=$2 for update", [settlementId, Number(document.id)]); const row = original.rows[0]; if (!row) throw new FinanceError("FINANCE_SETTLEMENT_NOT_FOUND", "收付款记录不存在", 404); if (row.original_settlement_id || String(row.settlement_type).endsWith("_REVERSAL")) throw new FinanceError("FINANCE_REVERSAL_NOT_ALLOWED", "冲销记录不能再次冲销", 409); if ((await client.query("select 1 from finance_settlements where original_settlement_id=$1", [settlementId])).rows[0]) throw new FinanceError("FINANCE_SETTLEMENT_ALREADY_REVERSED", "该收付款已经冲销", 409); const code = await this.repository.nextCode(client, "FINANCE_REVERSAL", "REV"); const reversalType = `${row.settlement_type}_REVERSAL`; const created = await client.query("insert into finance_settlements(settlement_code,document_id,settlement_type,amount,original_settlement_id,accounting_date,account_name,reason,operation_id,created_by,request_id) values($1,$2,$3,-$4::numeric,$5,$6,$7,$8,$9,$10,$11) returning *", [code, Number(document.id), reversalType, row.amount, settlementId, accountingDate, row.account_name, reason, meta.operationId, meta.actor.username, meta.requestId]); const updated = await client.query(`update finance_documents set settled_amount=settled_amount-$2::numeric,status=case when settled_amount-$2::numeric=0 then 'OPEN' else 'PARTIALLY_SETTLED' end,version=version+1,updated_at=now() where id=$1 and version=$3 returning *`, [Number(document.id), row.amount, expected]); if (!updated.rows[0]) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据已被并发更新", 409); const reversalId = Number(created.rows[0].id); await client.query("insert into finance_document_events(document_id,event_type,from_status,to_status,amount,settlement_id,reason,created_by,request_id) values($1,'SETTLEMENT_REVERSED',$2,$3,-$4::numeric,$5,$6,$7,$8)", [Number(document.id), document.status, updated.rows[0].status, row.amount, reversalId, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_finance_reversal"); return { status: 201, body: { ok: true, data: created.rows[0], reversal_id: reversalId, payment_code: code, doc_status: updated.rows[0].status, settled_amount: updated.rows[0].settled_amount, document_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: reversalId };
    });
  }
}
