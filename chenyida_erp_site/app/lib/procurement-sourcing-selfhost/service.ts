/* eslint-disable @typescript-eslint/no-explicit-any -- PostgreSQL projection rows are validated at service boundaries. */
import type { PoolClient } from "pg";
import { ProcurementSourcingError } from "./errors.ts";
import { ProcurementSourcingRepository } from "./repository.ts";
import type { FaultInjector, SourcingMutationMeta } from "./types.ts";
import { booleanValue, boundedText, canonicalDigest, dateOnly, decimal, exactKeys, expectedVersion, nonNegativeInteger, normalizeCreateRfqInput, positiveId } from "./validation.ts";
import { loadSupplierMappingCoverage, requireCompleteCoverage } from "../supplier-mapping-selfhost/coverage.ts";
import { SupplierMappingError } from "../supplier-mapping-selfhost/errors.ts";

const rowData = <T>(result: { rows: T[] }, code: string, message: string): T => { if (!result.rows[0]) throw new ProcurementSourcingError(code, message, 404); return result.rows[0]; };
const lockRfq = async (client: PoolClient, id: number) => rowData(await client.query<any>("select q.*,q.response_deadline::text response_deadline_text from procurement_rfqs q where q.id=$1 for update", [id]), "RFQ_NOT_FOUND", "询价不存在");
const requireRfqCoverage = (rows: Parameters<typeof requireCompleteCoverage>[0], supplierIds: readonly number[]) => {
  try { requireCompleteCoverage(rows, supplierIds); }
  catch (error) {
    if (error instanceof SupplierMappingError) throw new ProcurementSourcingError(error.code, error.message, error.status);
    throw error;
  }
};

const shanghaiTimestamp = (value: unknown) => String(value || "");

async function requireCurrentRfqSource(client: PoolClient, rfq: any) {
  const project = rowData(await client.query<{ project_id: string | number }>(`select p.project_id
    from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id
    where r.id=$1`, [rfq.purchase_request_id]), "PURCHASE_REQUEST_NOT_FOUND", "RFQ 来源采购申请不存在");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-requirement-project:${project.project_id}`]);
  const source = rowData(await client.query<any>(`select r.status,r.version,p.project_id,p.plan_version_no,
      not exists(select 1 from planning_purchase_requests newer join planning_material_requirement_plans np on np.id=newer.plan_id where np.project_id=p.project_id and np.plan_version_no>p.plan_version_no) source_latest
    from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id where r.id=$1 for share of r`, [rfq.purchase_request_id]), "PURCHASE_REQUEST_NOT_FOUND", "RFQ 来源采购申请不存在");
  if (source.status !== "ACCEPTED") throw new ProcurementSourcingError("RFQ_SOURCE_NOT_ACCEPTED", `来源 PRQ ${rfq.purchase_request_id} 当前状态为 ${source.status}，不能发出`, 409);
  if (Number(source.version) !== Number(rfq.source_purchase_request_version)) throw new ProcurementSourcingError("RFQ_SOURCE_VERSION_DRIFT", `来源 PRQ ${rfq.purchase_request_id} 版本已从 ${rfq.source_purchase_request_version} 漂移为 ${source.version}`, 409);
  if (!source.source_latest) throw new ProcurementSourcingError("RFQ_SOURCE_NOT_LATEST", `来源 PRQ ${rfq.purchase_request_id} 已不是项目最新采购申请`, 409);
  const deadline = await client.query<{ valid: boolean }>("select $1::date>=(statement_timestamp() at time zone 'Asia/Shanghai')::date valid", [rfq.response_deadline_text]);
  if (!deadline.rows[0]?.valid) throw new ProcurementSourcingError("RFQ_DEADLINE_EXPIRED", `RFQ 报价截止日 ${rfq.response_deadline_text} 已失效`, 409);
  return source;
}

async function requireExactCreationCredential(client: PoolClient, rfq: any) {
  const credential = (await client.query<any>(`select
      (select count(*)::int from procurement_sourcing_events event
        where event.rfq_id=$1 and event.event_type='RFQ_CREATED') raw_event_count,
      (select count(*)::int from procurement_sourcing_events event
        where event.rfq_id=$1 and event.event_type='RFQ_CREATED'
          and event.credential_version=2 and event.result='SUCCESS'
          and event.actor=rfq.created_by and event.request_id=rfq.request_id
          and event.created_at=rfq.created_at and event.old_version is null and event.new_version=1
          and event.from_status is null and event.to_status='DRAFT'
          and event.idempotency_key_digest is not null and event.scope_digest is not null) exact_event_count,
      (select count(*)::int from audit_log audit
        where audit.route_code='PROCUREMENT_SOURCING' and audit.action='RFQ_CREATED'
          and audit.result='success' and audit.request_id=rfq.request_id and audit.username=rfq.created_by
          and audit.old_version is null and audit.new_version=1
          and audit.idempotency_key_digest is not null and audit.operation_id is not null
          and audit.detail->>'object_id'=rfq.id::text and audit.created_at=rfq.created_at) exact_audit_count
    from procurement_rfqs rfq where rfq.id=$1`, [rfq.id])).rows[0];
  const exactEvent = Number(credential?.raw_event_count) === 1 && Number(credential?.exact_event_count) === 1;
  const exactLegacyAudit = Number(credential?.raw_event_count) === 0 && Number(credential?.exact_audit_count) === 1;
  if (!exactEvent && !exactLegacyAudit) {
    throw new ProcurementSourcingError("RFQ_CREATION_CREDENTIAL_UNVERIFIED", "未找到唯一、精确关联的 RFQ 创建成功事件或历史成功审计，禁止发出", 409);
  }
  return exactEvent ? "IMMUTABLE_EVENT" : "EXACT_SUCCESS_AUDIT";
}

async function currentCoverageForRfq(client: PoolClient, rfq: any) {
  const invited = await client.query<{ id: string | number; supplier_id: string | number; status: string }>("select id,supplier_id,status from procurement_rfq_suppliers where rfq_id=$1 order by supplier_id for share", [rfq.id]);
  if (!invited.rowCount) throw new ProcurementSourcingError("RFQ_SUPPLIER_REQUIRED", "RFQ 至少需要一个受邀 Supplier", 422);
  const invitationDrift = invited.rows.filter((row) => row.status !== "INVITED");
  if (invitationDrift.length) throw new ProcurementSourcingError("RFQ_SUPPLIER_STATE_DRIFT", `受邀 Supplier 状态已漂移：${invitationDrift.map((row) => `Supplier ${row.supplier_id}: ${row.status}`).join("；")}`, 409);
  const supplierIds = invited.rows.map((row) => Number(row.supplier_id));
  const coverage = await loadSupplierMappingCoverage(client, Number(rfq.purchase_request_id), supplierIds);
  requireRfqCoverage(coverage, supplierIds);
  return { invited: invited.rows, supplierIds, coverage };
}

async function saveMappingBindings(client: PoolClient, rfq: any, rfqLines: any[], rfqSuppliers: any[], coverage: any[], source: "RFQ_CREATE" | "LEGACY_DRAFT_CONFIRMATION", meta: SourcingMutationMeta) {
  const bySupplier = new Map(coverage.map((row) => [Number(row.supplier_id), row]));
  const persisted: Array<Record<string, unknown>> = [];
  for (const invitation of rfqSuppliers) {
    const snapshots = bySupplier.get(Number(invitation.supplier_id))?.mapping_snapshots || [];
    for (const line of rfqLines) {
      const mapping = snapshots.find((item: any) => Number(item.material_id) === Number(line.material_id) && Number(item.purchase_unit_id) === Number(line.unit_id));
      if (!mapping) throw new ProcurementSourcingError("SUPPLIER_MAPPING_INCOMPLETE", `Supplier ${invitation.supplier_id} / Material ${line.material_id} 缺少可固定 Mapping`, 422);
      const locked = await client.query("select id from supplier_mappings where id=$1 for share", [mapping.mapping_version_id]);
      if (!locked.rows[0]) throw new ProcurementSourcingError("SUPPLIER_MAPPING_INCOMPLETE", `Supplier ${invitation.supplier_id} / Material ${line.material_id} 的 Mapping 已不存在`, 422);
      const binding = await client.query<any>(`insert into procurement_rfq_supplier_line_mapping_bindings(
          rfq_id,rfq_supplier_id,rfq_line_id,supplier_id,material_id,supplier_mapping_version_id,mapping_uid,mapping_version_no,mapping_row_version,mapping_content_digest,
          supplier_part_number,purchase_unit_id,conversion_numerator,conversion_denominator,valid_from,valid_to,binding_source,binding_status,bound_by,request_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ACTIVE',$18,$19) returning *`, [
        rfq.id, invitation.id, line.id, invitation.supplier_id, line.material_id, mapping.mapping_version_id, mapping.mapping_id, mapping.mapping_version, mapping.row_version,
        mapping.content_digest || null, mapping.supplier_part_number, mapping.purchase_unit_id, mapping.conversion_numerator, mapping.conversion_denominator,
        mapping.valid_from, mapping.valid_to || null, source, meta.actor.username, meta.requestId,
      ]);
      persisted.push(binding.rows[0]);
    }
  }
  return persisted;
}

const frozenScope = (rfq: any, lines: any[], suppliers: any[], bindings: any[]) => ({
  rfq_id: Number(rfq.id), purchase_request_id: Number(rfq.purchase_request_id), round_no: Number(rfq.round_no), response_deadline: String(rfq.response_deadline_text), currency_code: String(rfq.currency_code),
  lines: [...lines].sort((left, right) => Number(left.id) - Number(right.id)).map((line) => ({ rfq_line_id: Number(line.id), purchase_request_line_id: Number(line.purchase_request_line_id), material_id: Number(line.material_id), unit_id: Number(line.unit_id), requested_quantity: String(line.requested_quantity), line_no: Number(line.line_no) })),
  suppliers: [...suppliers].sort((left, right) => Number(left.id) - Number(right.id)).map((supplier) => ({ rfq_supplier_id: Number(supplier.id), supplier_id: Number(supplier.supplier_id) })),
  mappings: [...bindings].sort((left, right) => Number(left.rfq_supplier_id) - Number(right.rfq_supplier_id) || Number(left.rfq_line_id) - Number(right.rfq_line_id)).map((binding) => ({ rfq_supplier_id: Number(binding.rfq_supplier_id), rfq_line_id: Number(binding.rfq_line_id), mapping_id: String(binding.mapping_uid), mapping_version: Number(binding.mapping_version_no), mapping_row_version: Number(binding.mapping_row_version) })),
});

async function exactBindingRows(client: PoolClient, rfqId: number) {
  return (await client.query<any>(`select b.*,b.mapping_uid mapping_id,b.mapping_version_no mapping_version,b.request_id binding_request_id,rs.status invitation_status,s.supplier_code,s.supplier_name,s.status supplier_status,m.internal_material_code,m.standard_name,m.material_status,
      pu.code purchase_unit_code,bu.code base_unit_code,sm.status current_status,sm.version current_bound_row_version,sm.mapping_version_no current_bound_mapping_version,
      sm.content_digest current_content_digest,latest.status latest_mapping_status,latest.mapping_version_no current_mapping_version,latest.version current_mapping_row_version,
      active_match.mapping_count current_active_count,active_match.mapping_version_id current_active_mapping_version_id,
      (sm.status is distinct from b.binding_status) status_drift,
      (latest.id is distinct from b.supplier_mapping_version_id or sm.version is distinct from b.mapping_row_version or active_match.mapping_version_id is distinct from b.supplier_mapping_version_id) version_drift,
      (rs.status='INVITED' and s.status='ACTIVE' and m.material_status='ACTIVE' and sm.status='ACTIVE' and sm.version=b.mapping_row_version and sm.mapping_version_no=b.mapping_version_no
        and sm.content_digest is not distinct from b.mapping_content_digest and active_match.mapping_count=1 and active_match.mapping_version_id=b.supplier_mapping_version_id
        and latest.id=b.supplier_mapping_version_id
        and b.valid_from<=statement_timestamp() and (b.valid_to is null or b.valid_to>statement_timestamp())) eligible
    from procurement_rfq_supplier_line_mapping_bindings b
    join procurement_rfq_suppliers rs on rs.id=b.rfq_supplier_id
    join suppliers s on s.id=b.supplier_id join material_master m on m.id=b.material_id
    join units pu on pu.id=b.purchase_unit_id
    left join units bu on ((m.base_unit_id is not null and bu.id=m.base_unit_id)
      or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(bu.code)=upper(btrim(m.base_uom))))
    join supplier_mappings sm on sm.id=b.supplier_mapping_version_id
    left join lateral (select x.id,x.status,x.mapping_version_no,x.version from supplier_mappings x where x.mapping_uid=b.mapping_uid order by x.mapping_version_no desc,x.id desc limit 1) latest on true
    left join lateral (select count(*)::int mapping_count,(array_agg(x.id order by x.mapping_version_no desc,x.id desc))[1] mapping_version_id from supplier_mappings x where x.supplier_id=b.supplier_id and x.material_id=b.material_id and x.purchase_unit_id=b.purchase_unit_id and x.status='ACTIVE' and x.conversion_numerator=x.conversion_denominator and x.valid_from<=statement_timestamp() and (x.valid_to is null or x.valid_to>statement_timestamp())) active_match on true
    where b.rfq_id=$1 order by s.supplier_code,b.supplier_id,b.rfq_line_id`, [rfqId])).rows;
}

export class ProcurementSourcingService {
  private readonly repository: ProcurementSourcingRepository; private readonly fault: FaultInjector;
  constructor(repository: ProcurementSourcingRepository, fault: FaultInjector = () => undefined) { this.repository = repository; this.fault = fault; }

  async acceptedRequests(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize; const result = await this.repository.pool.query(`select r.id,r.request_code,r.status,r.version,p.required_date,p.plan_version_no,b.project_code,b.project_name,count(l.id)::int line_count,coalesce(sum(l.requested_quantity),0)::text requested_quantity,
      jsonb_agg(jsonb_build_object('line_id',l.id,'line_no',l.line_no,'material_id',l.material_id,'internal_material_code',m.internal_material_code,'standard_name',m.standard_name,'unit_id',l.unit_id,'unit_code',u.code,'requested_quantity',l.requested_quantity) order by l.line_no,l.id) lines,
      not exists(select 1 from procurement_rfqs q where q.purchase_request_id=r.id and q.status in ('DRAFT','ISSUED')) rfq_available
      from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id join business_projects b on b.id=p.project_id join planning_purchase_request_lines l on l.purchase_request_id=r.id join material_master m on m.id=l.material_id join units u on u.id=l.unit_id
      where r.status='ACCEPTED' and not exists(select 1 from planning_purchase_requests newer join planning_material_requirement_plans np on np.id=newer.plan_id where np.project_id=p.project_id and np.plan_version_no>p.plan_version_no)
      group by r.id,p.required_date,p.plan_version_no,b.project_code,b.project_name order by r.accepted_at,id limit $1 offset $2`, [pageSize, offset]);
    return { rows: result.rows, pagination: { page, page_size: pageSize, returned: result.rowCount || 0 } };
  }

  async coverage(purchaseRequestId: number) {
    const request = await this.repository.pool.query("select status from planning_purchase_requests where id=$1", [purchaseRequestId]);
    if (!request.rows[0]) throw new ProcurementSourcingError("PURCHASE_REQUEST_NOT_FOUND", "采购申请不存在", 404);
    if (request.rows[0].status !== "ACCEPTED") throw new ProcurementSourcingError("PURCHASE_REQUEST_NOT_ACCEPTED", "只有已接收采购申请可以查询 RFQ Mapping 覆盖率", 409);
    const rows = await loadSupplierMappingCoverage(this.repository.pool, purchaseRequestId);
    return rows.map((row) => ({
      supplier_id: row.supplier_id,
      supplier_code: row.supplier_code,
      supplier_name: row.supplier_name,
      supplier_status: row.supplier_status,
      covered_count: row.covered_count,
      required_count: row.required_count,
      selectable: row.selectable,
      unavailable_reason: row.unavailable_reason,
      missing: row.missing,
    }));
  }

  async list(page: number, pageSize: number, status?: string) {
    const allowed = ["DRAFT", "ISSUED", "CLOSED", "CANCELLED"]; if (status && !allowed.includes(status)) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", "RFQ 状态筛选无效"); const offset = (page - 1) * pageSize;
    const result = await this.repository.pool.query(`select q.id,q.rfq_code,q.purchase_request_id,r.request_code,q.round_no,q.status,q.response_deadline,q.currency_code,q.version,q.created_at,q.issued_at,
      count(distinct s.id)::int supplier_count,count(distinct sq.id) filter(where sq.status='SUBMITTED')::int submitted_quote_count,count(distinct c.rfq_line_id)::int compared_line_count,a.id award_id,a.status award_status
      from procurement_rfqs q join planning_purchase_requests r on r.id=q.purchase_request_id left join procurement_rfq_suppliers s on s.rfq_id=q.id left join procurement_supplier_quotes sq on sq.rfq_id=q.id left join procurement_quote_comparisons c on c.rfq_id=q.id left join procurement_sourcing_awards a on a.rfq_id=q.id
      where ($1::text is null or q.status=$1) group by q.id,r.request_code,a.id,a.status order by q.created_at desc,q.id desc limit $2 offset $3`, [status || null, pageSize, offset]);
    return { rows: result.rows, pagination: { page, page_size: pageSize, returned: result.rowCount || 0 } };
  }

  async detail(id: number) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const header = rowData(await client.query<any>(`select q.*,r.request_code,r.status source_status,r.version source_current_version,p.required_date source_required_date,p.plan_version_no,b.project_code,b.project_name,
          not exists(select 1 from planning_purchase_requests newer join planning_material_requirement_plans np on np.id=newer.plan_id where np.project_id=p.project_id and np.plan_version_no>p.plan_version_no) source_latest,
          q.response_deadline>=(statement_timestamp() at time zone 'Asia/Shanghai')::date deadline_valid
        from procurement_rfqs q join planning_purchase_requests r on r.id=q.purchase_request_id join planning_material_requirement_plans p on p.id=r.plan_id join business_projects b on b.id=p.project_id where q.id=$1`, [id]), "RFQ_NOT_FOUND", "询价不存在");
      const lines = await client.query<any>(`select l.*,m.internal_material_code,m.standard_name,u.code unit_code from procurement_rfq_lines l join material_master m on m.id=l.material_id join units u on u.id=l.unit_id where l.rfq_id=$1 order by l.line_no`, [id]);
      const suppliers = await client.query<any>(`select rs.*,s.supplier_code,s.supplier_name,s.status supplier_status from procurement_rfq_suppliers rs join suppliers s on s.id=rs.supplier_id where rs.rfq_id=$1 order by s.supplier_code,s.id`, [id]);
      const quotes = await client.query<any>(`select q.*,s.supplier_code,s.supplier_name,(q.valid_until<current_date) quote_expired from procurement_supplier_quotes q join suppliers s on s.id=q.supplier_id where q.rfq_id=$1 order by q.supplier_id,q.quote_version_no desc`, [id]);
      const quoteLines = await client.query<any>(`select l.* from procurement_supplier_quote_lines l join procurement_supplier_quotes q on q.id=l.quote_id where q.rfq_id=$1 order by l.rfq_line_id,q.supplier_id,q.quote_version_no desc`, [id]);
      const comparisons = await client.query<any>(`select distinct on(c.rfq_line_id) c.* from procurement_quote_comparisons c where c.rfq_id=$1 order by c.rfq_line_id,c.comparison_version_no desc`, [id]);
      const comparisonLines = await client.query<any>(`select cl.*,s.supplier_code,s.supplier_name from procurement_quote_comparison_lines cl join procurement_quote_comparisons c on c.id=cl.comparison_id join suppliers s on s.id=cl.supplier_id where c.rfq_id=$1 and not exists(select 1 from procurement_quote_comparisons n where n.rfq_line_id=c.rfq_line_id and n.comparison_version_no>c.comparison_version_no) order by c.rfq_line_id,cl.tax_included,cl.freight_included,cl.price_rank nulls last,s.supplier_code`, [id]);
      const award = await client.query<any>(`select a.*,coalesce(jsonb_agg(to_jsonb(al) order by al.rfq_line_id) filter(where al.id is not null),'[]'::jsonb) lines from procurement_sourcing_awards a left join procurement_sourcing_award_lines al on al.award_id=a.id where a.rfq_id=$1 group by a.id`, [id]);
      const events = await client.query<any>(`select e.*,to_char(e.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai from procurement_sourcing_events e where e.rfq_id=$1 order by e.id`, [id]);
      const bindings = await exactBindingRows(client, id);
      const current = await client.query<any>(`select rs.id rfq_supplier_id,rs.supplier_id,rs.status invitation_status,s.supplier_code,s.supplier_name,s.status supplier_status,l.id rfq_line_id,l.material_id,m.internal_material_code,m.standard_name,m.material_status,
          l.unit_id purchase_unit_id,u.code purchase_unit_code,bu.code base_unit_code,match.mapping_count current_active_count,sm.id mapping_version_id,sm.mapping_uid mapping_id,
          sm.mapping_version_no mapping_version,sm.version mapping_row_version,sm.status current_status,sm.supplier_item_code supplier_part_number,
          sm.conversion_numerator::text conversion_numerator,sm.conversion_denominator::text conversion_denominator,sm.valid_from,sm.valid_to,
          (rs.status='INVITED' and s.status='ACTIVE' and m.material_status='ACTIVE' and match.mapping_count=1) eligible,
          case when rs.status<>'INVITED' then 'RFQ Supplier 邀请状态已漂移为 '||rs.status when s.status<>'ACTIVE' then 'Supplier 当前不是 ACTIVE' when m.material_status<>'ACTIVE' then 'Material 当前不是 ACTIVE' when match.mapping_count=0 then '缺少当前有效 1:1 Mapping' when match.mapping_count>1 then '当前有效 Mapping 冲突' else '' end issue_reason,
          'CURRENT_QUALIFICATION' binding_source,'CURRENT_ACTIVE_CANDIDATE' binding_status,false status_drift,false version_drift
        from procurement_rfq_suppliers rs join suppliers s on s.id=rs.supplier_id cross join lateral (select l.* from procurement_rfq_lines l where l.rfq_id=rs.rfq_id) l
        join material_master m on m.id=l.material_id join units u on u.id=l.unit_id
        left join units bu on ((m.base_unit_id is not null and bu.id=m.base_unit_id)
          or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(bu.code)=upper(btrim(m.base_uom))))
        left join lateral (select count(*)::int mapping_count,(array_agg(x.id order by x.mapping_version_no desc,x.id desc))[1] mapping_version_id from supplier_mappings x where x.supplier_id=rs.supplier_id and x.material_id=l.material_id and x.purchase_unit_id=l.unit_id and x.status='ACTIVE' and x.conversion_numerator=x.conversion_denominator and x.valid_from<=statement_timestamp() and (x.valid_to is null or x.valid_to>statement_timestamp())) match on true
        left join supplier_mappings sm on sm.id=match.mapping_version_id where rs.rfq_id=$1 order by s.supplier_code,rs.supplier_id,l.line_no`, [id]);
      const creationEvents = events.rows.filter((event) => event.event_type === "RFQ_CREATED"
        && Number(event.credential_version) === 2 && event.result === "SUCCESS"
        && event.actor === header.created_by && event.request_id === header.request_id
        && Number(event.new_version) === 1 && event.old_version === null
        && event.from_status === null && event.to_status === "DRAFT"
        && Boolean(event.idempotency_key_digest) && Boolean(event.scope_digest)
        && new Date(event.created_at).valueOf() === new Date(header.created_at).valueOf());
      const audits = await client.query<any>(`select a.*,to_char(a.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai from audit_log a
        where a.route_code='PROCUREMENT_SOURCING' and a.action='RFQ_CREATED' and a.result='success' and a.request_id=$2 and a.username=$3
          and a.old_version is null and a.new_version=1 and a.idempotency_key_digest is not null and a.operation_id is not null
          and a.detail->>'object_id'=($1::bigint)::text and a.created_at=(select created_at from procurement_rfqs where id=$1::bigint) order by a.id`, [id, header.request_id, header.created_by]);
      let creationReceipt: Record<string, unknown>;
      if (creationEvents.length === 1) {
        const event = creationEvents[0];
        creationReceipt = { authority: "IMMUTABLE_EVENT", event_type: "RFQ_CREATED", immutable: true, authority_note: "RFQ_CREATED 是与草稿同事务提交、数据库禁止改写或删除的业务事件。", actor: event.actor, occurred_at: event.created_at, occurred_at_shanghai: event.occurred_at_shanghai, request_id: event.request_id, result: "SUCCESS", idempotency_key_digest: event.idempotency_key_digest, old_version: event.old_version, new_version: event.new_version, operation_id: null, scope_digest: event.scope_digest };
      } else if (creationEvents.length === 0 && audits.rowCount === 1) {
        const audit = audits.rows[0];
        creationReceipt = { authority: "EXACT_SUCCESS_AUDIT", event_type: "RFQ_CREATED", immutable: false, authority_note: "0039 前草稿没有独立 RFQ_CREATED 业务事件；SUCCESS 来自与创建事务一并提交且时间精确匹配的成功 Audit，RFQ 头创建字段受数据库保护。未伪造历史事件。", actor: audit.username, occurred_at: audit.created_at, occurred_at_shanghai: shanghaiTimestamp(audit.occurred_at_shanghai), request_id: audit.request_id, result: "SUCCESS", idempotency_key_digest: audit.idempotency_key_digest, old_version: audit.old_version, new_version: audit.new_version, operation_id: audit.operation_id };
      } else {
        creationReceipt = { authority: "UNVERIFIED", event_type: "RFQ_CREATED", immutable: false, authority_note: "未找到唯一、精确关联的创建成功事件或审计；页面不会由可读取状态反推 SUCCESS。", actor: header.created_by, occurred_at: header.created_at, occurred_at_shanghai: "", request_id: header.request_id, result: "UNVERIFIED", idempotency_key_digest: null, old_version: null, new_version: null, operation_id: null };
      }
      const expectedBindings = suppliers.rows.length * lines.rows.length;
      const complete = expectedBindings > 0 && bindings.length === expectedBindings;
      const creationOkay = creationReceipt.result === "SUCCESS";
      const sourceOkay = header.source_status === "ACCEPTED" && Number(header.source_current_version) === Number(header.source_purchase_request_version) && header.source_latest === true && header.deadline_valid === true;
      const mappingIssues = current.rows.filter((row) => !row.eligible).map((row) => `Supplier ${row.supplier_id} / Material ${row.material_id}: ${row.issue_reason}`);
      const driftIssues = bindings.filter((row) => !row.eligible).map((row) => `Supplier ${row.supplier_id} / Material ${row.material_id}: ${row.current_active_count === 0 ? "Mapping 已失效" : row.current_active_count > 1 ? "Mapping 冲突" : row.status_drift ? `状态从 ${row.binding_status} 漂移为 ${row.current_status}` : "Mapping Version/CAS 已漂移"}`);
      const issues = [...(!complete ? [bindings.length === 0 ? "历史草稿尚未固定 Mapping；当前资格结果不能冒充创建时绑定。" : `Mapping 绑定不完整：${bindings.length}/${expectedBindings}`] : []), ...(!creationOkay ? ["创建成功凭证未通过唯一、精确关联校验，禁止发出。"] : []), ...(!sourceOkay ? ["来源 PRQ 状态、版本、最新性或截止日期校验未通过。"] : []), ...mappingIssues, ...driftIssues];
      const mode = bindings.length === 0 ? "UNBOUND_LEGACY_DRAFT" : bindings.every((row) => row.binding_source === "RFQ_CREATE") ? "BOUND_AT_CREATE" : "BOUND_BY_EXPLICIT_CONFIRMATION";
      const downstream = await client.query<any>(`select (select count(*)::int from procurement_supplier_quotes where rfq_id=$1) quotes,
        (select count(*)::int from procurement_sourcing_awards where rfq_id=$1) awards,
        (select count(distinct link.purchase_order_id)::int from procurement_award_po_line_links link join procurement_sourcing_awards a on a.id=link.award_id where a.rfq_id=$1) purchase_orders`, [id]);
      const issued = events.rows.filter((event) => event.event_type === "RFQ_ISSUED" && Number(event.credential_version) === 2).at(-1) || null;
      const issueReceipt = issued ? { event_type: "ISSUED", actor: issued.actor, occurred_at: issued.created_at, occurred_at_shanghai: issued.occurred_at_shanghai, request_id: issued.request_id, result: issued.result, old_version: issued.old_version, new_version: issued.new_version, from_status: issued.from_status, to_status: issued.to_status, scope_digest: issued.scope_digest, supplier_count: suppliers.rows.length, mapping_count: bindings.length, quote_count: downstream.rows[0].quotes, award_count: downstream.rows[0].awards, purchase_order_count: downstream.rows[0].purchase_orders } : null;
      await client.query("commit");
      return { header, lines: lines.rows, suppliers: suppliers.rows, quotes: quotes.rows, quote_lines: quoteLines.rows, comparisons: comparisons.rows, comparison_lines: comparisonLines.rows, award: award.rows[0] || null, events: events.rows, creation_receipt: creationReceipt,
        mapping_traceability: { mode, complete, can_issue: header.status === "DRAFT" && complete && creationOkay && sourceOkay && !issues.length, summary: mode === "UNBOUND_LEGACY_DRAFT" ? "历史草稿尚未固定 Mapping" : mode === "BOUND_AT_CREATE" ? "Mapping 已在 RFQ 创建事务中固定" : "Mapping 已由采购显式确认固定", issues, bindings, current_qualification: current.rows }, downstream_counts: downstream.rows[0], issue_receipt: issueReceipt };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async comparison(id: number) {
    const header = rowData(await this.repository.pool.query(`select c.*,r.rfq_code,l.line_no,l.requested_quantity,l.required_date,m.internal_material_code,m.standard_name,u.code unit_code from procurement_quote_comparisons c join procurement_rfqs r on r.id=c.rfq_id join procurement_rfq_lines l on l.id=c.rfq_line_id join material_master m on m.id=l.material_id join units u on u.id=l.unit_id where c.id=$1`, [id]), "COMPARISON_NOT_FOUND", "比价结果不存在");
    const lines = await this.repository.pool.query(`select cl.*,s.supplier_code,s.supplier_name,q.supplier_quote_reference,q.quote_version_no,q.valid_until,q.payment_terms from procurement_quote_comparison_lines cl join procurement_supplier_quote_lines ql on ql.id=cl.quote_line_id join procurement_supplier_quotes q on q.id=ql.quote_id join suppliers s on s.id=cl.supplier_id where cl.comparison_id=$1 order by cl.tax_included,cl.freight_included,cl.price_rank nulls last,s.id`, [id]); return { header, lines: lines.rows };
  }

  async create(meta: SourcingMutationMeta, input: Record<string, unknown>) {
    const normalized = normalizeCreateRfqInput(input), requestId = normalized.purchase_request_id, suppliers = normalized.supplier_ids, deadline = normalized.response_deadline, expected = normalized.expected_version;
    return this.repository.execute({ ...meta, requestDigest: canonicalDigest(normalized) }, async (client) => {
      await client.query("select pg_advisory_xact_lock($1)", [requestId]); const request = rowData(await client.query<any>(`select r.*,p.project_id,p.plan_version_no,p.required_date from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id where r.id=$1 for update`, [requestId]), "PURCHASE_REQUEST_NOT_FOUND", "采购申请不存在");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-requirement-project:${request.project_id}`]);
      if (request.version !== expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "采购申请版本已变化", 409); if (request.status !== "ACCEPTED") throw new ProcurementSourcingError("PURCHASE_REQUEST_NOT_ACCEPTED", "只有已接收采购申请可以创建询价", 409);
      const newer = await client.query("select 1 from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id where p.project_id=$1 and p.plan_version_no>$2 limit 1", [request.project_id, request.plan_version_no]); if (newer.rows[0]) throw new ProcurementSourcingError("PURCHASE_REQUEST_NOT_LATEST", "只能对最新采购申请创建询价", 409);
      const lines = await client.query<any>(`select l.*,m.base_unit_id,m.material_status from planning_purchase_request_lines l join material_master m on m.id=l.material_id where l.purchase_request_id=$1 order by l.line_no`, [requestId]); if (!lines.rowCount) throw new ProcurementSourcingError("PURCHASE_REQUEST_EMPTY", "采购申请没有可询价行", 422);
      const coverage = await loadSupplierMappingCoverage(client, requestId, suppliers); requireRfqCoverage(coverage, suppliers);
      const mappingSnapshots = Object.fromEntries(coverage.map((row) => [row.supplier_id, row.mapping_snapshots]));
      const source = { request_id: request.id, version: request.version, plan_version_no: request.plan_version_no, required_date: String(request.required_date), lines: lines.rows.map((line) => ({ id: line.id, line_no: line.line_no, material_id: line.material_id, unit_id: line.unit_id, requested_quantity: line.requested_quantity })) }; const sourceDigest = canonicalDigest(source);
      const seq = await client.query<any>("insert into business_code_sequences(sequence_code,current_value,version,updated_at) values('PROCUREMENT_RFQ',1,1,now()) on conflict(sequence_code) do update set current_value=business_code_sequences.current_value+1,version=business_code_sequences.version+1,updated_at=now() returning current_value"); const code = `RFQ-${String(seq.rows[0].current_value).padStart(8, "0")}`; const round = Number((await client.query("select coalesce(max(round_no),0)+1 round from procurement_rfqs where purchase_request_id=$1", [requestId])).rows[0].round);
      const rfq = await client.query<any>("insert into procurement_rfqs(rfq_code,purchase_request_id,round_no,response_deadline,source_purchase_request_version,source_digest,request_id,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning *,response_deadline::text response_deadline_text", [code, requestId, round, deadline, request.version, sourceDigest, meta.requestId, meta.actor.username]);
      const rfqLines: any[] = [];
      for (const line of lines.rows) rfqLines.push((await client.query<any>("insert into procurement_rfq_lines(rfq_id,purchase_request_line_id,material_id,unit_id,requested_quantity,required_date,line_no,source_digest) values($1,$2,$3,$4,$5,$6,$7,$8) returning *", [rfq.rows[0].id, line.id, line.material_id, line.unit_id, line.requested_quantity, request.required_date, line.line_no, canonicalDigest({ purchase_request_line_id: line.id, material_id: line.material_id, unit_id: line.unit_id, requested_quantity: line.requested_quantity, required_date: String(request.required_date) })])).rows[0]);
      const rfqSuppliers: any[] = [];
      for (const supplierId of suppliers) rfqSuppliers.push((await client.query<any>("insert into procurement_rfq_suppliers(rfq_id,supplier_id,invited_by,supplier_mapping_digest) values($1,$2,$3,$4) returning *", [rfq.rows[0].id, supplierId, meta.actor.username, canonicalDigest(mappingSnapshots[supplierId])])).rows[0]);
      const bindings = await saveMappingBindings(client, rfq.rows[0], rfqLines, rfqSuppliers, coverage, "RFQ_CREATE", meta);
      const scopeDigest = canonicalDigest(frozenScope(rfq.rows[0], rfqLines, rfqSuppliers, bindings));
      await client.query(`insert into procurement_sourcing_events(rfq_id,event_type,actor,request_id,credential_version,result,idempotency_key_digest,old_version,new_version,from_status,to_status,scope_digest)
        values($1,'RFQ_CREATED',$2,$3,2,'SUCCESS',$4,null,1,null,'DRAFT',$5)`, [rfq.rows[0].id, meta.actor.username, meta.requestId, meta.keyDigest, scopeDigest]);
      this.fault("after_rfq_saved"); const body = { rfq_id: Number(rfq.rows[0].id), rfq_code: code, status: "DRAFT", round_no: round, version: 1, request_id: meta.requestId, mapping_binding_count: bindings.length, event: "RFQ_CREATED", result: "SUCCESS" }; return { status: 201, body, objectId: body.rfq_id, newVersion: 1 };
    });
  }

  async confirmMappings(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) {
    exactKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const rfq = await lockRfq(client, id);
      if (rfq.version !== expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "RFQ 版本已变化", 409);
      if (rfq.status !== "DRAFT") throw new ProcurementSourcingError("RFQ_NOT_DRAFT", "只有 DRAFT 询价可以确认 Mapping", 409);
      if ((await client.query("select 1 from procurement_supplier_quotes where rfq_id=$1 limit 1", [id])).rows[0]) throw new ProcurementSourcingError("RFQ_HAS_QUOTE", "已有报价的 RFQ 不能补固定 Mapping", 409);
      if ((await client.query("select 1 from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1 limit 1", [id])).rows[0]) throw new ProcurementSourcingError("RFQ_MAPPING_ALREADY_BOUND", "RFQ Mapping 已固定，不能重复或改绑", 409);
      await requireCurrentRfqSource(client, rfq);
      const { coverage } = await currentCoverageForRfq(client, rfq);
      const rfqLines = (await client.query<any>("select * from procurement_rfq_lines where rfq_id=$1 order by line_no for share", [id])).rows;
      const rfqSuppliers = (await client.query<any>("select * from procurement_rfq_suppliers where rfq_id=$1 order by supplier_id for share", [id])).rows;
      const bindings = await saveMappingBindings(client, rfq, rfqLines, rfqSuppliers, coverage, "LEGACY_DRAFT_CONFIRMATION", meta);
      const nextVersion = expected + 1, scopeDigest = canonicalDigest(frozenScope(rfq, rfqLines, rfqSuppliers, bindings));
      await client.query("update procurement_rfqs set version=version+1,updated_at=now() where id=$1", [id]);
      await client.query(`insert into procurement_sourcing_events(rfq_id,event_type,actor,request_id,credential_version,result,idempotency_key_digest,old_version,new_version,from_status,to_status,scope_digest)
        values($1,'RFQ_MAPPING_CONFIRMED',$2,$3,2,'SUCCESS',$4,$5,$6,'DRAFT','DRAFT',$7)`, [id, meta.actor.username, meta.requestId, meta.keyDigest, expected, nextVersion, scopeDigest]);
      this.fault("after_mapping_bindings_saved");
      const body = { rfq_id: id, status: "DRAFT", version: nextVersion, mapping_binding_count: bindings.length, event: "RFQ_MAPPING_CONFIRMED", result: "SUCCESS", request_id: meta.requestId };
      return { status: 200, body, objectId: id, oldVersion: expected, newVersion: nextVersion };
    });
  }

  async issue(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) {
    exactKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version); return this.repository.execute(meta, async (client) => { const rfq = await lockRfq(client, id); if (rfq.version !== expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "RFQ 版本已变化", 409); if (rfq.status !== "DRAFT") throw new ProcurementSourcingError("RFQ_NOT_DRAFT", "只有 DRAFT 询价可以发出", 409);
      await requireExactCreationCredential(client, rfq);
      await requireCurrentRfqSource(client, rfq);
      const rfqLines = (await client.query<any>("select * from procurement_rfq_lines where rfq_id=$1 order by line_no for share", [id])).rows;
      const rfqSuppliers = (await client.query<any>("select rs.* from procurement_rfq_suppliers rs join suppliers s on s.id=rs.supplier_id where rs.rfq_id=$1 order by rs.supplier_id for share of rs,s", [id])).rows;
      await client.query("select sm.id from supplier_mappings sm join (select distinct mapping_uid from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1) b on b.mapping_uid=sm.mapping_uid order by sm.id for share of sm", [id]);
      const bindings = await exactBindingRows(client, id), expectedBindingCount = rfqLines.length * rfqSuppliers.length;
      if (!expectedBindingCount || bindings.length !== expectedBindingCount) throw new ProcurementSourcingError("RFQ_MAPPING_BINDING_REQUIRED", `RFQ Mapping 尚未完整固定：${bindings.length}/${expectedBindingCount}；请先执行显式确认`, 409);
      const problems = bindings.filter((row) => !row.eligible).map((row) => {
        const reason = row.invitation_status !== "INVITED" ? `RFQ Supplier 邀请状态已漂移为 ${row.invitation_status}` : row.supplier_status !== "ACTIVE" ? "Supplier 已停用" : row.material_status !== "ACTIVE" ? "Material 已停用" : Number(row.current_active_count) > 1 ? "当前有效 Mapping 冲突" : Number(row.current_active_count) === 0 ? "Mapping 已失效" : row.status_drift ? `Mapping 状态从 ${row.binding_status} 漂移为 ${row.current_status}` : "Mapping ID/Version/CAS 已漂移";
        return `Supplier ${row.supplier_id} / Material ${row.material_id}: ${reason}`;
      });
      if (problems.length) throw new ProcurementSourcingError("RFQ_MAPPING_DRIFT", `发出前 Mapping 校验失败：${problems.join("；")}`, 409);
      const downstream = (await client.query<any>(`select
        (select count(*)::int from procurement_supplier_quotes where rfq_id=$1) quotes,
        (select count(*)::int from procurement_sourcing_awards where rfq_id=$1) awards,
        (select count(distinct link.purchase_order_id)::int from procurement_award_po_line_links link join procurement_sourcing_awards award on award.id=link.award_id where award.rfq_id=$1) purchase_orders`, [id])).rows[0];
      if (downstream.quotes || downstream.awards || downstream.purchase_orders) throw new ProcurementSourcingError("RFQ_DOWNSTREAM_STATE_CONFLICT", "DRAFT RFQ 已存在 Quote、Award 或 PO，禁止发出", 409);
      const scopeDigest = canonicalDigest(frozenScope(rfq, rfqLines, rfqSuppliers, bindings)), nextVersion = expected + 1;
      await client.query("update procurement_rfqs set status='ISSUED',issued_by=$2,issued_at=now(),version=version+1,updated_at=now() where id=$1", [id, meta.actor.username]);
      await client.query(`insert into procurement_sourcing_events(rfq_id,event_type,actor,request_id,credential_version,result,idempotency_key_digest,old_version,new_version,from_status,to_status,scope_digest)
        values($1,'RFQ_ISSUED',$2,$3,2,'SUCCESS',$4,$5,$6,'DRAFT','ISSUED',$7)`, [id, meta.actor.username, meta.requestId, meta.keyDigest, expected, nextVersion, scopeDigest]);
      this.fault("after_rfq_issued"); const body = { rfq_id: id, status: "ISSUED", version: nextVersion, request_id: meta.requestId, event: "ISSUED", result: "SUCCESS", old_version: expected, new_version: nextVersion, frozen_scope_digest: scopeDigest, supplier_count: rfqSuppliers.length, mapping_count: bindings.length, quote_count: downstream.quotes, award_count: downstream.awards, purchase_order_count: downstream.purchase_orders }; return { status: 200, body, objectId: id, oldVersion: expected, newVersion: nextVersion }; });
  }

  private quoteInput(input: Record<string, unknown>, revise: boolean) {
    exactKeys(input, revise ? ["expected_version", "rfq_expected_version", "supplier_quote_reference", "valid_until", "tax_included", "freight_included", "payment_terms", "lines"] : ["expected_version", "supplier_id", "supplier_quote_reference", "valid_until", "tax_included", "freight_included", "payment_terms", "lines"]);
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 200) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", "报价行必须包含 1—200 行"); const seen = new Set<number>(); const lines = input.lines.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `报价行 ${index + 1} 无效`); const value = raw as Record<string, unknown>; exactKeys(value, ["rfq_line_id", "quoted_quantity", "minimum_order_quantity", "unit_price", "lead_time_days", "promised_delivery_date"]); const rfqLineId = positiveId(value.rfq_line_id, "rfq_line_id"); if (seen.has(rfqLineId)) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", "报价行不能重复"); seen.add(rfqLineId); return { rfqLineId, quotedQuantity: decimal(value.quoted_quantity, "quoted_quantity"), moq: decimal(value.minimum_order_quantity, "minimum_order_quantity"), unitPrice: decimal(value.unit_price, "unit_price"), leadTimeDays: nonNegativeInteger(value.lead_time_days, "lead_time_days"), promisedDeliveryDate: dateOnly(value.promised_delivery_date, "promised_delivery_date") }; });
    return { expected: expectedVersion(input.expected_version), rfqExpected: revise ? expectedVersion(input.rfq_expected_version, "rfq_expected_version") : expectedVersion(input.expected_version), supplierId: revise ? 0 : positiveId(input.supplier_id, "supplier_id"), reference: boundedText(input.supplier_quote_reference, "supplier_quote_reference", 200, true), validUntil: dateOnly(input.valid_until, "valid_until"), taxIncluded: booleanValue(input.tax_included, "tax_included"), freightIncluded: booleanValue(input.freight_included, "freight_included"), paymentTerms: boundedText(input.payment_terms, "payment_terms", 1000, true), lines };
  }

  private async saveQuote(client: PoolClient, rfq: any, supplierId: number, versionNo: number, parsed: ReturnType<ProcurementSourcingService["quoteInput"]>, meta: SourcingMutationMeta) {
    const sourceLines = await client.query<any>("select * from procurement_rfq_lines where rfq_id=$1 order by line_no", [rfq.id]); if (parsed.lines.length !== sourceLines.rowCount || parsed.lines.some((line) => !sourceLines.rows.some((source) => Number(source.id) === line.rfqLineId))) throw new ProcurementSourcingError("QUOTE_SCOPE_MISMATCH", "报价必须完整覆盖 RFQ 行且不能超出询价范围", 422);
    const quoteDigest = canonicalDigest({ rfq_id: rfq.id, supplier_id: supplierId, quote_version_no: versionNo, reference: parsed.reference, valid_until: parsed.validUntil, tax_included: parsed.taxIncluded, freight_included: parsed.freightIncluded, payment_terms: parsed.paymentTerms, lines: parsed.lines }); const quote = await client.query<any>("insert into procurement_supplier_quotes(rfq_id,supplier_id,quote_version_no,supplier_quote_reference,valid_until,tax_included,freight_included,payment_terms,quote_digest,recorded_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *", [rfq.id, supplierId, versionNo, parsed.reference, parsed.validUntil, parsed.taxIncluded, parsed.freightIncluded, parsed.paymentTerms, quoteDigest, meta.actor.username, meta.requestId]);
    for (const line of parsed.lines) { const source = sourceLines.rows.find((item) => Number(item.id) === line.rfqLineId); await client.query("insert into procurement_supplier_quote_lines(quote_id,rfq_line_id,material_id,unit_id,quoted_quantity,minimum_order_quantity,unit_price,lead_time_days,promised_delivery_date,line_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [quote.rows[0].id, line.rfqLineId, source.material_id, source.unit_id, line.quotedQuantity, line.moq, line.unitPrice, line.leadTimeDays, line.promisedDeliveryDate, canonicalDigest(line)]); }
    return quote.rows[0];
  }

  async recordQuote(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) { const parsed = this.quoteInput(input, false); return this.repository.execute(meta, async (client) => { const rfq = await lockRfq(client, id); if (rfq.version !== parsed.expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "RFQ 版本已变化", 409); if (rfq.status !== "ISSUED") throw new ProcurementSourcingError("RFQ_NOT_ISSUED", "只有已发出的 RFQ 可以录入报价", 409); const invitation = await client.query<any>("select rs.*,s.status supplier_status from procurement_rfq_suppliers rs join suppliers s on s.id=rs.supplier_id where rs.rfq_id=$1 and rs.supplier_id=$2 for update of rs", [id, parsed.supplierId]); if (!invitation.rows[0] || invitation.rows[0].supplier_status !== "ACTIVE") throw new ProcurementSourcingError("SUPPLIER_NOT_INVITED", "供应商未受邀或已停用", 422); const prior = await client.query("select 1 from procurement_supplier_quotes where rfq_id=$1 and supplier_id=$2 and status='SUBMITTED'", [id, parsed.supplierId]); if (prior.rows[0]) throw new ProcurementSourcingError("QUOTE_REVISION_REQUIRED", "该供应商已有当前报价，改价必须创建新版本", 409); const quote = await this.saveQuote(client, rfq, parsed.supplierId, 1, parsed, meta); await client.query("update procurement_rfq_suppliers set status='RESPONDED',responded_at=now() where rfq_id=$1 and supplier_id=$2", [id, parsed.supplierId]); await client.query("update procurement_rfqs set version=version+1,updated_at=now() where id=$1", [id]); await client.query("insert into procurement_sourcing_events(rfq_id,quote_id,event_type,actor,request_id) values($1,$2,'QUOTE_SUBMITTED',$3,$4)", [id, quote.id, meta.actor.username, meta.requestId]); this.fault("after_quote_saved"); const body = { quote_id: Number(quote.id), rfq_id: id, quote_version_no: 1, status: "SUBMITTED", rfq_version: rfq.version + 1, request_id: meta.requestId }; return { status: 201, body, objectId: body.quote_id, oldVersion: rfq.version, newVersion: rfq.version + 1 }; }); }

  async reviseQuote(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) { const parsed = this.quoteInput(input, true); return this.repository.execute(meta, async (client) => { const old = rowData(await client.query<any>("select * from procurement_supplier_quotes where id=$1 for update", [id]), "QUOTE_NOT_FOUND", "报价不存在"); if (old.version !== parsed.expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "报价版本已变化", 409); if (old.status !== "SUBMITTED") throw new ProcurementSourcingError("QUOTE_NOT_CURRENT", "只有当前 SUBMITTED 报价可以修订", 409); const rfq = await lockRfq(client, Number(old.rfq_id)); if (rfq.version !== parsed.rfqExpected) throw new ProcurementSourcingError("VERSION_CONFLICT", "RFQ 版本已变化", 409); if (rfq.status !== "ISSUED") throw new ProcurementSourcingError("RFQ_NOT_ISSUED", "已关闭 RFQ 不能修订报价", 409); await client.query("update procurement_supplier_quotes set status='SUPERSEDED',version=version+1 where id=$1", [id]); const quote = await this.saveQuote(client, rfq, Number(old.supplier_id), Number(old.quote_version_no) + 1, parsed, meta); await client.query("update procurement_rfqs set version=version+1,updated_at=now() where id=$1", [rfq.id]); await client.query("insert into procurement_sourcing_events(rfq_id,quote_id,event_type,actor,request_id) values($1,$2,'QUOTE_SUPERSEDED',$3,$4),($1,$5,'QUOTE_SUBMITTED',$3,$4)", [rfq.id, id, meta.actor.username, meta.requestId, quote.id]); this.fault("after_quote_revision"); const body = { quote_id: Number(quote.id), superseded_quote_id: id, rfq_id: Number(rfq.id), quote_version_no: Number(old.quote_version_no) + 1, status: "SUBMITTED", rfq_version: rfq.version + 1, request_id: meta.requestId }; return { status: 201, body, objectId: body.quote_id, oldVersion: rfq.version, newVersion: rfq.version + 1 }; }); }

  async compare(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) { exactKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version); return this.repository.execute(meta, async (client) => { const rfq = await lockRfq(client, id); if (rfq.version !== expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "RFQ 版本已变化", 409); if (rfq.status !== "ISSUED") throw new ProcurementSourcingError("RFQ_NOT_ISSUED", "只有已发出的 RFQ 可以比价", 409); const current = await client.query<any>(`select l.id rfq_line_id,l.requested_quantity,l.required_date,q.id quote_id,q.supplier_id,q.currency_code,q.valid_until,q.tax_included,q.freight_included,ql.id quote_line_id,ql.unit_id,ql.unit_price,ql.minimum_order_quantity,ql.promised_delivery_date from procurement_rfq_lines l join procurement_supplier_quote_lines ql on ql.rfq_line_id=l.id join procurement_supplier_quotes q on q.id=ql.quote_id and q.status='SUBMITTED' where l.rfq_id=$1 order by l.id,q.supplier_id`, [id]); if (!current.rowCount) throw new ProcurementSourcingError("QUOTE_REQUIRED", "至少需要一份当前报价才能生成比价", 422); const ids: number[] = [];
      const rfqLines = await client.query<any>("select * from procurement_rfq_lines where rfq_id=$1 order by line_no", [id]); for (const sourceLine of rfqLines.rows) { const basisRows = current.rows.filter((row) => Number(row.rfq_line_id) === Number(sourceLine.id)); if (!basisRows.length) continue; const basisDigest = canonicalDigest(basisRows); const exists = await client.query("select 1 from procurement_quote_comparisons where rfq_line_id=$1 and basis_digest=$2", [sourceLine.id, basisDigest]); if (exists.rows[0]) throw new ProcurementSourcingError("COMPARISON_ALREADY_CURRENT", "当前报价口径已生成比价，无需重复生成", 409); const versionNo = Number((await client.query("select coalesce(max(comparison_version_no),0)+1 value from procurement_quote_comparisons where rfq_line_id=$1", [sourceLine.id])).rows[0].value); const comparison = await client.query<any>("insert into procurement_quote_comparisons(rfq_id,rfq_line_id,comparison_version_no,basis_digest,generated_by,request_id) values($1,$2,$3,$4,$5,$6) returning id", [id, sourceLine.id, versionNo, basisDigest, meta.actor.username, meta.requestId]); ids.push(Number(comparison.rows[0].id));
        await client.query(`with ranked as (select ql.id quote_line_id,q.supplier_id,q.currency_code,ql.unit_id,q.tax_included,q.freight_included,ql.unit_price,ql.minimum_order_quantity,ql.promised_delivery_date,q.valid_until,
          row_number() over(partition by q.currency_code,ql.unit_id,q.tax_included,q.freight_included order by (q.valid_until<current_date),ql.unit_price,ql.promised_delivery_date,q.supplier_id) price_rank
          from procurement_supplier_quote_lines ql join procurement_supplier_quotes q on q.id=ql.quote_id where ql.rfq_line_id=$2 and q.status='SUBMITTED')
          insert into procurement_quote_comparison_lines(comparison_id,quote_line_id,supplier_id,currency_code,unit_id,tax_included,freight_included,unit_price,minimum_order_quantity,promised_delivery_date,price_rank,lowest_price,moq_satisfied,delivery_status,quote_expired,comparable_status,reason_code,awardable)
          select $1,quote_line_id,supplier_id,currency_code,unit_id,tax_included,freight_included,unit_price,minimum_order_quantity,promised_delivery_date,case when valid_until>=current_date then price_rank::integer end,valid_until>=current_date and price_rank=1,$3::numeric>=minimum_order_quantity,case when promised_delivery_date<=$4::date then 'ON_TIME' else 'LATE' end,valid_until<current_date,case when valid_until<current_date then 'NOT_COMPARABLE' else 'COMPARABLE' end,case when valid_until<current_date then 'QUOTE_EXPIRED' when $3::numeric<minimum_order_quantity then 'MOQ_EXCEEDS_REQUEST' when promised_delivery_date>$4::date then 'LATE_DELIVERY' else 'COMPARABLE' end,valid_until>=current_date and $3::numeric>=minimum_order_quantity from ranked`, [comparison.rows[0].id, sourceLine.id, sourceLine.requested_quantity, sourceLine.required_date]); }
      await client.query("update procurement_rfqs set version=version+1,updated_at=now() where id=$1", [id]); for (const comparisonId of ids) await client.query("insert into procurement_sourcing_events(rfq_id,comparison_id,event_type,actor,request_id) values($1,$2,'COMPARISON_GENERATED',$3,$4)", [id, comparisonId, meta.actor.username, meta.requestId]); this.fault("after_comparison_saved"); const body = { rfq_id: id, comparison_ids: ids, comparison_id: ids[0] || null, rfq_version: expected + 1, request_id: meta.requestId }; return { status: 201, body, objectId: ids[0] || id, oldVersion: expected, newVersion: expected + 1 }; }); }

  async award(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) { exactKeys(input, ["expected_version", "reason_code", "reason", "lines"]); const expected = expectedVersion(input.expected_version), reasonCode = boundedText(input.reason_code, "reason_code", 64, true), reason = boundedText(input.reason, "reason", 1000, true); if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 200) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", "定标行必须包含 1—200 行"); const seen = new Set<number>(); const selections = input.lines.map((raw) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", "定标行无效"); const value = raw as Record<string, unknown>; exactKeys(value, ["rfq_line_id", "selected_quote_line_id", "selected_quantity", "selection_reason", "late_delivery_reason_code", "late_delivery_reason", "excess_quantity_reason"]); const rfqLineId = positiveId(value.rfq_line_id, "rfq_line_id"); if (seen.has(rfqLineId)) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", "一条 RFQ 行只能选择一个供应商"); seen.add(rfqLineId); return { rfqLineId, quoteLineId: positiveId(value.selected_quote_line_id, "selected_quote_line_id"), quantity: decimal(value.selected_quantity, "selected_quantity"), selectionReason: boundedText(value.selection_reason, "selection_reason", 1000), lateCode: boundedText(value.late_delivery_reason_code, "late_delivery_reason_code", 64), lateReason: boundedText(value.late_delivery_reason, "late_delivery_reason", 1000), excessReason: boundedText(value.excess_quantity_reason, "excess_quantity_reason", 1000) }; });
    return this.repository.execute(meta, async (client) => { const rfq = await lockRfq(client, id); if (rfq.version !== expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "RFQ 版本已变化", 409); if (rfq.status !== "ISSUED") throw new ProcurementSourcingError("RFQ_NOT_ISSUED", "只有已发出的 RFQ 可以定标", 409); const rfqLines = await client.query<any>("select * from procurement_rfq_lines where rfq_id=$1 order by line_no", [id]); if (selections.length !== rfqLines.rowCount || selections.some((item) => !rfqLines.rows.some((line) => Number(line.id) === item.rfqLineId))) throw new ProcurementSourcingError("AWARD_SCOPE_MISMATCH", "定标必须覆盖每条 RFQ 行且不能拆单", 422); const rows: any[] = []; let soleSource = false;
      for (const selection of selections) { const result = await client.query<any>(`select ql.*,q.supplier_id,q.valid_until,q.status quote_status,q.quote_version_no,c.id comparison_id,c.comparison_version_no,cl.price_rank,cl.comparable_status,cl.delivery_status,l.requested_quantity,l.required_date,
        ($2::numeric>=l.requested_quantity) quantity_covers_request,($2::numeric>=ql.minimum_order_quantity) quantity_covers_moq,($2::numeric>l.requested_quantity) excess,
        (select count(*) from procurement_supplier_quote_lines vql join procurement_supplier_quotes vq on vq.id=vql.quote_id where vql.rfq_line_id=l.id and vq.status='SUBMITTED' and vq.valid_until>=current_date) valid_quote_count
        from procurement_supplier_quote_lines ql join procurement_supplier_quotes q on q.id=ql.quote_id join procurement_rfq_lines l on l.id=ql.rfq_line_id join procurement_quote_comparisons c on c.rfq_line_id=l.id and not exists(select 1 from procurement_quote_comparisons n where n.rfq_line_id=l.id and n.comparison_version_no>c.comparison_version_no) join procurement_quote_comparison_lines cl on cl.comparison_id=c.id and cl.quote_line_id=ql.id where ql.id=$1 and l.rfq_id=$3`, [selection.quoteLineId, selection.quantity, id]); const row = rowData(result, "QUOTE_LINE_NOT_COMPARABLE", "所选报价行不在当前 RFQ 最新比较中"); if (row.quote_status !== "SUBMITTED" || String(row.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10) || row.comparable_status !== "COMPARABLE") throw new ProcurementSourcingError("QUOTE_NOT_AWARDABLE", "过期、已修订或不可比较报价不能定标", 422); if (!row.quantity_covers_request || !row.quantity_covers_moq) throw new ProcurementSourcingError("AWARD_QUANTITY_TOO_LOW", "中标数量不得低于申请数量或供应商 MOQ", 422); if (row.excess && !selection.excessReason) throw new ProcurementSourcingError("EXCESS_QUANTITY_REASON_REQUIRED", "超过申请数量必须填写超量原因", 422); if (Number(row.valid_quote_count) === 1) soleSource = true; if (Number(row.price_rank) !== 1 && !selection.selectionReason && !reason) throw new ProcurementSourcingError("NON_LOWEST_REASON_REQUIRED", "选择非最低价必须填写明确理由", 422); if (row.delivery_status === "LATE" && (selection.lateCode !== "LATE_DELIVERY_ACCEPTED" || !selection.lateReason)) throw new ProcurementSourcingError("LATE_DELIVERY_REASON_REQUIRED", "晚于需求日期必须填写 LATE_DELIVERY_ACCEPTED 理由", 422); rows.push({ ...row, selection }); }
      if (soleSource && reasonCode !== "SOLE_SOURCE") throw new ProcurementSourcingError("SOLE_SOURCE_REASON_REQUIRED", "单一有效报价定标必须使用 SOLE_SOURCE 理由", 422); const awardDigest = canonicalDigest({ rfq_id: id, reason_code: reasonCode, reason, selections }); const award = await client.query<any>("insert into procurement_sourcing_awards(rfq_id,award_digest,selected_by,reason_code,reason,request_id) values($1,$2,$3,$4,$5,$6) returning *", [id, awardDigest, meta.actor.username, reasonCode, reason, meta.requestId]); for (const row of rows) { const s = row.selection; await client.query("insert into procurement_sourcing_award_lines(award_id,rfq_line_id,comparison_id,selected_quote_line_id,supplier_id,selected_quantity,selected_unit_price,required_date,promised_delivery_date,selection_reason,late_delivery_reason_code,late_delivery_reason,excess_quantity_reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [award.rows[0].id, s.rfqLineId, row.comparison_id, s.quoteLineId, row.supplier_id, s.quantity, row.unit_price, row.required_date, row.promised_delivery_date, s.selectionReason, s.lateCode || null, s.lateReason, s.excessReason]); }
      await client.query("update procurement_rfqs set status='CLOSED',closed_at=now(),version=version+1,updated_at=now() where id=$1", [id]); await client.query("insert into procurement_sourcing_events(rfq_id,award_id,event_type,actor,request_id,reason) values($1,$2,'AWARDED',$3,$4,$5)", [id, award.rows[0].id, meta.actor.username, meta.requestId, reason]); this.fault("after_award_saved"); const body = { award_id: Number(award.rows[0].id), rfq_id: id, status: "AWARDED", reason_code: reasonCode, rfq_version: expected + 1, purchase_order_created: false, request_id: meta.requestId }; return { status: 201, body, objectId: body.award_id, oldVersion: expected, newVersion: expected + 1 }; });
  }

  async reverseAward(id: number, meta: SourcingMutationMeta, input: Record<string, unknown>) { exactKeys(input, ["expected_version", "reason"]); const expected = expectedVersion(input.expected_version), reason = boundedText(input.reason, "reason", 1000, true); return this.repository.execute(meta, async (client) => { const award = rowData(await client.query<any>("select * from procurement_sourcing_awards where id=$1 for update", [id]), "AWARD_NOT_FOUND", "定标结果不存在"); if (award.version !== expected) throw new ProcurementSourcingError("VERSION_CONFLICT", "定标版本已变化", 409); if (award.status !== "AWARDED") throw new ProcurementSourcingError("AWARD_ALREADY_REVERSED", "定标已经撤销", 409); if ((await client.query("select 1 from procurement_award_po_line_links where award_id=$1 limit 1", [id])).rows[0]) throw new ProcurementSourcingError("AWARD_HAS_PURCHASE_ORDER", "定标已经生成采购订单，不能直接撤销", 409); await client.query("update procurement_sourcing_awards set status='REVERSED',reversed_by=$2,reversed_at=now(),reversal_reason=$3,version=version+1 where id=$1", [id, meta.actor.username, reason]); await client.query("insert into procurement_sourcing_events(rfq_id,award_id,event_type,actor,request_id,reason) values($1,$2,'AWARD_REVERSED',$3,$4,$5)", [award.rfq_id, id, meta.actor.username, meta.requestId, reason]); this.fault("after_award_reversed"); const body = { award_id: id, rfq_id: Number(award.rfq_id), status: "REVERSED", version: expected + 1, request_id: meta.requestId }; return { status: 200, body, objectId: id, oldVersion: expected, newVersion: expected + 1 }; }); }
}
