import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { FinanceError } from "./errors.ts";
import { amount, date, documentType, id, text, version } from "./rules.ts";
import { FinanceRepository } from "./repository.ts";
import type { FinanceDocumentType, FinanceMeta, FinanceResult } from "./types.ts";

type DocumentRow = Record<string, unknown> & { id: string; doc_type: FinanceDocumentType; total_amount: string; settled_amount: string; status: string; version: number; currency_code: string };

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
  if (!visibleFinanceTypes(actor).includes(type as FinanceDocumentType)) throw new FinanceError("FINANCE_NOT_VISIBLE", "财务记录不存在", 404);
}

function documentSelect() {
  return `select d.*,case d.doc_type when 'AR' then '应收' else '应付' end legacy_doc_type,
    case d.status when 'OPEN' then '未结清' when 'PARTIALLY_SETTLED' then '部分结清' else '已结清' end legacy_status,
    (d.total_amount-d.settled_amount)::text balance_amount,d.total_amount::text total_amount,d.settled_amount::text settled_amount,
    coalesce(c.customer_name,s.supplier_name) counterparty,coalesce(c.customer_code,s.supplier_code) counterparty_code,
    coalesce(sh.shipment_code,pr.receipt_code) source_code,
    case d.doc_type when 'AR' then 'SHIPMENT' else 'RECEIPT' end source_type,
    coalesce(d.sales_source_entry_id,d.purchase_source_entry_id) stable_source_entry_id
    from finance_documents d left join customers c on c.id=d.customer_id left join suppliers s on s.id=d.supplier_id
    left join sales_financial_source_entries sf on sf.id=d.sales_source_entry_id left join sales_shipments sh on sh.id=sf.shipment_id
    left join purchase_financial_source_entries pf on pf.id=d.purchase_source_entry_id left join purchase_receipts pr on pr.id=pf.purchase_receipt_id`;
}

function legacyDocument(row: Record<string, unknown>) { return { ...row, doc_type_label: row.legacy_doc_type, paid_amount: row.settled_amount, doc_status: row.legacy_status, source_id: row.stable_source_entry_id }; }
function legacySettlement(row: Record<string, unknown>) { const reversal = String(row.settlement_type).endsWith("_REVERSAL"); const receipt = String(row.settlement_type).startsWith("RECEIPT"); return { ...row, payment_code: row.settlement_code, payment_type: reversal ? (receipt ? "收款冲销" : "付款冲销") : (receipt ? "收款" : "付款"), payment_date: row.accounting_date, handled_by: row.created_by }; }

export class FinanceService {
  readonly repository: FinanceRepository; readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: FinanceRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  async list(actor: IdentityActor, limit: number, offset: number, requestedType?: string, status?: string) {
    const types = visibleFinanceTypes(actor); if (!types.length) return [];
    const values: unknown[] = [types]; const where = ["d.doc_type=any($1::text[])"];
    if (requestedType) { const normalized = ["应收", "AR"].includes(requestedType) ? "AR" : ["应付", "AP"].includes(requestedType) ? "AP" : documentType(requestedType); assertVisible(actor, normalized); values.push(normalized); where.push(`d.doc_type=$${values.length}`); }
    if (status) { const normalized = String(status).trim().toUpperCase(); if (!["OPEN", "PARTIALLY_SETTLED", "SETTLED"].includes(normalized)) throw new FinanceError("REQUEST_VALIDATION_FAILED", "status 无效"); values.push(normalized); where.push(`d.status=$${values.length}`); }
    values.push(limit, offset); const result = await this.repository.pool.query(`${documentSelect()} where ${where.join(" and ")} order by d.created_at desc,d.id desc limit $${values.length - 1} offset $${values.length}`, values); return result.rows.map(legacyDocument);
  }

  async get(actor: IdentityActor, documentId: number) {
    const found = await this.repository.pool.query(`${documentSelect()} where d.id=$1`, [documentId]); if (!found.rows[0]) throw new FinanceError("FINANCE_DOCUMENT_NOT_FOUND", "财务单据不存在", 404); assertVisible(actor, String(found.rows[0].doc_type));
    const settlements = await this.repository.pool.query(`select fs.*,d.doc_code,coalesce(c.customer_name,s.supplier_name) counterparty,exists(select 1 from finance_settlements r where r.original_settlement_id=fs.id) is_reversed from finance_settlements fs join finance_documents d on d.id=fs.document_id left join customers c on c.id=d.customer_id left join suppliers s on s.id=d.supplier_id where fs.document_id=$1 order by fs.id`, [documentId]);
    const events = await this.repository.pool.query("select * from finance_document_events where document_id=$1 order by id", [documentId]); return { ...legacyDocument(found.rows[0]), settlements: settlements.rows.map(legacySettlement), events: events.rows, boundary: FINANCE_BOUNDARY };
  }

  async listSettlements(actor: IdentityActor, limit: number, offset: number, documentId?: number) {
    const types = visibleFinanceTypes(actor); if (!types.length) return []; const values: unknown[] = [types]; const where = ["d.doc_type=any($1::text[])"];
    if (documentId) { values.push(documentId); where.push(`fs.document_id=$${values.length}`); }
    values.push(limit, offset); const result = await this.repository.pool.query(`select fs.*,d.doc_code,d.doc_type,coalesce(c.customer_name,s.supplier_name) counterparty,exists(select 1 from finance_settlements r where r.original_settlement_id=fs.id) is_reversed from finance_settlements fs join finance_documents d on d.id=fs.document_id left join customers c on c.id=d.customer_id left join suppliers s on s.id=d.supplier_id where ${where.join(" and ")} order by fs.created_at desc,fs.id desc limit $${values.length - 1} offset $${values.length}`, values); return result.rows.map(legacySettlement);
  }

  async summary(actor: IdentityActor) {
    const types = visibleFinanceTypes(actor); if (!types.length) return { receivable_total: "0", receivable_paid: "0", receivable_balance: "0", payable_total: "0", payable_paid: "0", payable_balance: "0", cash_net: "0" }; const result = await this.repository.pool.query(`select
      coalesce(sum(total_amount) filter(where doc_type='AR'),0)::text receivable_total,coalesce(sum(settled_amount) filter(where doc_type='AR'),0)::text receivable_paid,coalesce(sum(total_amount-settled_amount) filter(where doc_type='AR'),0)::text receivable_balance,
      coalesce(sum(total_amount) filter(where doc_type='AP'),0)::text payable_total,coalesce(sum(settled_amount) filter(where doc_type='AP'),0)::text payable_paid,coalesce(sum(total_amount-settled_amount) filter(where doc_type='AP'),0)::text payable_balance
      from finance_documents where doc_type=any($1::text[])`, [types]); const cash = await this.repository.pool.query(`select coalesce(sum(case when fs.settlement_type in ('RECEIPT','RECEIPT_REVERSAL') then fs.amount else -fs.amount end),0)::text cash_net from finance_settlements fs join finance_documents d on d.id=fs.document_id where d.doc_type=any($1::text[])`, [types]); return { ...result.rows[0], ...cash.rows[0] };
  }

  async sourceOptions(actor: IdentityActor, typeValue: string, limit: number) {
    const type = documentType(typeValue); assertVisible(actor, type);
    if (type === "AR") return this.repository.pool.query(`select 'AR' document_type,sf.id source_entry_id,sf.id sales_source_entry_id,sf.id stable_source_entry_id,sf.amount::text amount,sf.currency_code,sf.customer_id,c.customer_code,c.customer_name,sh.id shipment_id,sh.shipment_code source_code,sh.ship_date source_date from sales_financial_source_entries sf join sales_shipments sh on sh.id=sf.shipment_id join customers c on c.id=sf.customer_id left join finance_documents d on d.sales_source_entry_id=sf.id where sf.entry_type='SHIPMENT' and d.id is null and not exists(select 1 from sales_financial_source_entries r where r.reversal_of_source_entry_id=sf.id) order by sf.id desc limit $1`, [limit]);
    return this.repository.pool.query(`select 'AP' document_type,pf.id source_entry_id,pf.id purchase_source_entry_id,pf.id stable_source_entry_id,pf.amount::text amount,pf.currency_code,pf.supplier_id,s.supplier_code,s.supplier_name,pr.id purchase_receipt_id,pr.receipt_code source_code,pr.created_at source_date from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id join suppliers s on s.id=pf.supplier_id left join finance_documents d on d.purchase_source_entry_id=pf.id where pf.entry_type='RECEIPT' and d.id is null and not exists(select 1 from purchase_receipts rr where rr.reversal_of_receipt_id=pr.id) order by pf.id desc limit $1`, [limit]);
  }

  async create(meta: FinanceMeta, input: Record<string, unknown>): Promise<FinanceResult> {
    const type = documentType(input.doc_type ?? input.document_type); assertVisible(meta.actor, type); const today = new Date().toISOString().slice(0, 10); const accountingDate = date(input.accounting_date ?? today, "accounting_date")!; const dueDate = date(input.due_date, "due_date", false); const sourceKey = type === "AR" ? "sales_source_entry_id" : "purchase_source_entry_id"; const sourceId = id(input[sourceKey] ?? input.source_entry_id, sourceKey); const other = type === "AR" ? "purchase_source_entry_id" : "sales_source_entry_id"; if (input[other] !== undefined && input[other] !== null && input[other] !== "") throw new FinanceError("FINANCE_SOURCE_INVALID", "财务单据只能绑定规定的稳定来源", 422);
    return this.repository.execute(meta, async (client) => {
      const parent = type === "AR" ? await client.query("select shipment_id parent_id from sales_financial_source_entries where id=$1", [sourceId]) : await client.query("select purchase_receipt_id parent_id from purchase_financial_source_entries where id=$1", [sourceId]); if (!parent.rows[0]) throw new FinanceError("FINANCE_SOURCE_INVALID", "稳定金额来源不存在、已冲销或不能过账", 422); await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`FINANCE_SOURCE:${type}:${parent.rows[0].parent_id}`]);
      const source = type === "AR"
        ? await client.query(`select sf.*,not exists(select 1 from sales_financial_source_entries r where r.reversal_of_source_entry_id=sf.id) active from sales_financial_source_entries sf join sales_shipments sh on sh.id=sf.shipment_id where sf.id=$1 for update of sh`, [sourceId])
        : await client.query(`select pf.*,not exists(select 1 from purchase_receipts rr where rr.reversal_of_receipt_id=pr.id) active from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id where pf.id=$1 for update of pr`, [sourceId]); const row = source.rows[0]; const expectedEntry = type === "AR" ? "SHIPMENT" : "RECEIPT"; if (!row || row.entry_type !== expectedEntry || !row.active) throw new FinanceError("FINANCE_SOURCE_INVALID", "稳定金额来源不存在、已冲销或不能过账", 422); if ((await client.query(`select 1 from finance_documents where ${type === "AR" ? "sales_source_entry_id" : "purchase_source_entry_id"}=$1`, [sourceId])).rows[0]) throw new FinanceError("FINANCE_SOURCE_ALREADY_POSTED", "该稳定金额来源已经生成财务单据", 409);
      const code = await this.repository.nextCode(client, type === "AR" ? "FINANCE_AR" : "FINANCE_AP", type); const created = await client.query(`insert into finance_documents(doc_code,doc_type,sales_source_entry_id,purchase_source_entry_id,customer_id,supplier_id,currency_code,total_amount,accounting_date,due_date,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [code, type, type === "AR" ? sourceId : null, type === "AP" ? sourceId : null, type === "AR" ? Number(row.customer_id) : null, type === "AP" ? Number(row.supplier_id) : null, row.currency_code, row.amount, accountingDate, dueDate, meta.operationId, meta.actor.username, meta.requestId]); const documentId = Number(created.rows[0].id); await client.query("insert into finance_document_events(document_id,event_type,to_status,reason,created_by,request_id) values($1,'CREATED','OPEN','',$2,$3)", [documentId, meta.actor.username, meta.requestId]); await this.fault?.("after_finance_document_create"); return { status: 201, body: { ok: true, data: created.rows[0], doc_id: documentId, doc_code: code, boundary: FINANCE_BOUNDARY, request_id: meta.requestId }, objectId: documentId };
    });
  }

  private async lockDocument(client: PoolClient, documentId: number): Promise<DocumentRow> { const found = await client.query<DocumentRow>("select * from finance_documents where id=$1 for update", [documentId]); if (!found.rows[0]) throw new FinanceError("FINANCE_DOCUMENT_NOT_FOUND", "财务单据不存在", 404); return found.rows[0]; }

  async settle(meta: FinanceMeta, input: Record<string, unknown>): Promise<FinanceResult> {
    const documentId = id(input.document_id ?? input.doc_id, "document_id"); const expected = version(input.expected_version); const value = amount(input.amount); const accountingDate = date(input.accounting_date ?? input.payment_date, "accounting_date")!; const accountName = text(input.account_name, "account_name", 200, true); const reason = text(input.reason ?? input.remark, "reason", 1000);
    return this.repository.execute(meta, async (client) => { const document = await this.lockDocument(client, documentId); if (Number(document.version) !== expected) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据版本已变化", 409); const allowed = await client.query("select $1::numeric<=($2::numeric-$3::numeric) ok", [value, document.total_amount, document.settled_amount]); if (!allowed.rows[0].ok) throw new FinanceError("FINANCE_AMOUNT_EXCEEDS_BALANCE", "本次核销金额不能超过未结余额", 409); const settlementType = document.doc_type === "AR" ? "RECEIPT" : "PAYMENT"; const code = await this.repository.nextCode(client, document.doc_type === "AR" ? "FINANCE_RECEIPT" : "FINANCE_PAYMENT", document.doc_type === "AR" ? "RCV" : "PAY"); const created = await client.query("insert into finance_settlements(settlement_code,document_id,settlement_type,amount,accounting_date,account_name,reason,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *", [code, documentId, settlementType, value, accountingDate, accountName, reason, meta.operationId, meta.actor.username, meta.requestId]); const updated = await client.query(`update finance_documents set settled_amount=settled_amount+$2::numeric,status=case when settled_amount+$2::numeric=total_amount then 'SETTLED' else 'PARTIALLY_SETTLED' end,version=version+1,updated_at=now() where id=$1 and version=$3 returning *`, [documentId, value, expected]); if (!updated.rows[0]) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据已被并发核销", 409); const settlementId = Number(created.rows[0].id); await client.query("insert into finance_document_events(document_id,event_type,from_status,to_status,amount,settlement_id,reason,created_by,request_id) values($1,'SETTLED',$2,$3,$4,$5,$6,$7,$8)", [documentId, document.status, updated.rows[0].status, value, settlementId, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_finance_settlement"); return { status: 201, body: { ok: true, data: created.rows[0], settlement_id: settlementId, payment_code: code, doc_status: updated.rows[0].status, settled_amount: updated.rows[0].settled_amount, document_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: settlementId };
    });
  }

  async reverseSettlement(settlementId: number, meta: FinanceMeta, input: Record<string, unknown>): Promise<FinanceResult> {
    const expected = version(input.expected_version); const accountingDate = date(input.accounting_date ?? input.payment_date, "accounting_date")!; const reason = text(input.reason ?? input.remark, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => { const lookup = await client.query<{ document_id: string }>("select document_id from finance_settlements where id=$1", [settlementId]); if (!lookup.rows[0]) throw new FinanceError("FINANCE_SETTLEMENT_NOT_FOUND", "收付款记录不存在", 404); const document = await this.lockDocument(client, Number(lookup.rows[0].document_id)); if (Number(document.version) !== expected) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据版本已变化", 409); const original = await client.query<Record<string, unknown> & { id: string; amount: string; settlement_type: string; account_name: string; original_settlement_id: string | null }>("select * from finance_settlements where id=$1 and document_id=$2 for update", [settlementId, Number(document.id)]); const row = original.rows[0]; if (!row) throw new FinanceError("FINANCE_SETTLEMENT_NOT_FOUND", "收付款记录不存在", 404); if (row.original_settlement_id || String(row.settlement_type).endsWith("_REVERSAL")) throw new FinanceError("FINANCE_REVERSAL_NOT_ALLOWED", "冲销记录不能再次冲销", 409); if ((await client.query("select 1 from finance_settlements where original_settlement_id=$1", [settlementId])).rows[0]) throw new FinanceError("FINANCE_SETTLEMENT_ALREADY_REVERSED", "该收付款已经冲销", 409); const code = await this.repository.nextCode(client, "FINANCE_REVERSAL", "REV"); const reversalType = `${row.settlement_type}_REVERSAL`; const created = await client.query("insert into finance_settlements(settlement_code,document_id,settlement_type,amount,original_settlement_id,accounting_date,account_name,reason,operation_id,created_by,request_id) values($1,$2,$3,-$4::numeric,$5,$6,$7,$8,$9,$10,$11) returning *", [code, Number(document.id), reversalType, row.amount, settlementId, accountingDate, row.account_name, reason, meta.operationId, meta.actor.username, meta.requestId]); const updated = await client.query(`update finance_documents set settled_amount=settled_amount-$2::numeric,status=case when settled_amount-$2::numeric=0 then 'OPEN' else 'PARTIALLY_SETTLED' end,version=version+1,updated_at=now() where id=$1 and version=$3 returning *`, [Number(document.id), row.amount, expected]); if (!updated.rows[0]) throw new FinanceError("FINANCE_VERSION_CONFLICT", "财务单据已被并发更新", 409); const reversalId = Number(created.rows[0].id); await client.query("insert into finance_document_events(document_id,event_type,from_status,to_status,amount,settlement_id,reason,created_by,request_id) values($1,'SETTLEMENT_REVERSED',$2,$3,-$4::numeric,$5,$6,$7,$8)", [Number(document.id), document.status, updated.rows[0].status, row.amount, reversalId, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_finance_reversal"); return { status: 201, body: { ok: true, data: created.rows[0], reversal_id: reversalId, payment_code: code, doc_status: updated.rows[0].status, settled_amount: updated.rows[0].settled_amount, document_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: reversalId };
    });
  }
}
