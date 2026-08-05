/* eslint-disable @typescript-eslint/no-explicit-any -- PostgreSQL projection rows are normalized at this service boundary. */
import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { canReadPurchaseRequest } from "../material-requirement-selfhost/service.ts";
import { ProcurementSourcingError } from "./errors.ts";
import { canonicalDigest } from "./validation.ts";

const FORMAL_MATERIAL_CODE = /^CYD-[A-Z0-9_]+-[0-9]{6}$/;

export type RfqMappingBlockingReason = Readonly<{
  code: string;
  message: string;
  suggestion: string;
  supplier_id?: number;
  material_id?: number;
  mapping_id?: string | null;
}>;

export type RfqMappingQualificationCombination = Readonly<{
  rfq_supplier_id: number;
  rfq_line_id: number;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_status: string;
  invitation_status: string;
  material_id: number;
  internal_material_code: string;
  standard_name: string;
  material_status: string;
  mapping_version_id: number | null;
  mapping_id: string | null;
  mapping_version: number | null;
  mapping_row_version: number | null;
  mapping_content_digest: string | null;
  supplier_part_number: string | null;
  purchase_unit_id: number | null;
  purchase_unit_code: string | null;
  base_unit_code: string | null;
  conversion_numerator: string | null;
  conversion_denominator: string | null;
  conversion_text: string;
  valid_from: string | null;
  valid_to: string | null;
  valid_from_instant: string | null;
  valid_to_instant: string | null;
  mapping_status: string | null;
  current_active_supplier_material_count: number;
  current_active_supplier_part_number_count: number;
  supplier_material_conflict: boolean;
  supplier_part_number_conflict: boolean;
  eligible: boolean;
  issues: RfqMappingBlockingReason[];
}>;

export type RfqMappingQualification = Readonly<{
  rfq: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  qualification_passed: boolean;
  expected_binding_count: number;
  actual_candidate_count: number;
  current_binding_count: number;
  missing_combination_count: number;
  supplier_material_conflict_count: number;
  supplier_part_number_conflict_count: number;
  blocking_reasons: RfqMappingBlockingReason[];
  observed_at: string;
  data_timezone: "Asia/Shanghai";
  qualification_digest: string;
  combinations: RfqMappingQualificationCombination[];
}>;

const numberValue = (value: unknown) => Number(value);
const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const nullableString = (value: unknown) => value === null || value === undefined ? null : String(value);

async function readHeader(client: PoolClient, rfqId: number) {
  const result = await client.query<any>(`select q.id,q.rfq_code,q.round_no,q.status,q.version,q.purchase_request_id,q.source_purchase_request_version,
      q.response_deadline::text response_deadline,q.currency_code,q.traceability_version,
      r.request_code,r.status purchase_request_status,r.version purchase_request_version,r.submitted_by,r.accepted_by,r.returned_by,
      p.project_id,p.plan_version_no,b.project_code,b.project_name,
      not exists(select 1 from planning_purchase_requests newer
        join planning_material_requirement_plans newer_plan on newer_plan.id=newer.plan_id
        where newer_plan.project_id=p.project_id and newer_plan.plan_version_no>p.plan_version_no) purchase_request_latest,
      q.response_deadline>=(statement_timestamp() at time zone 'Asia/Shanghai')::date deadline_valid,
      to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at
    from procurement_rfqs q
    join planning_purchase_requests r on r.id=q.purchase_request_id
    join planning_material_requirement_plans p on p.id=r.plan_id
    join business_projects b on b.id=p.project_id
    where q.id=$1`, [rfqId]);
  const row = result.rows[0];
  if (!row) throw new ProcurementSourcingError("RFQ_NOT_FOUND", "询价不存在", 404);
  return row;
}

async function lockQualificationSources(client: PoolClient, rfqId: number, header: any) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-requirement-project:${header.project_id}`]);
  await client.query(`select r.id from planning_purchase_requests r
    join planning_material_requirement_plans p on p.id=r.plan_id
    where r.id=$1 for share of r,p`, [header.purchase_request_id]);
  await client.query(`select l.id from procurement_rfq_lines l
    join material_master m on m.id=l.material_id join units u on u.id=l.unit_id
    where l.rfq_id=$1 order by l.id for share of l,m,u`, [rfqId]);
  await client.query(`select rs.id from procurement_rfq_suppliers rs
    join suppliers s on s.id=rs.supplier_id
    where rs.rfq_id=$1 order by rs.supplier_id for share of rs,s`, [rfqId]);
  await client.query(`select sm.id from supplier_mappings sm
    where sm.supplier_id in (select supplier_id from procurement_rfq_suppliers where rfq_id=$1)
      and sm.material_id in (select material_id from procurement_rfq_lines where rfq_id=$1)
    order by sm.id for share`, [rfqId]);
}

function combinationIssues(row: any): RfqMappingBlockingReason[] {
  const supplierId = numberValue(row.supplier_id);
  const materialId = numberValue(row.material_id);
  const mappingId = nullableString(row.mapping_id);
  const context = { supplier_id: supplierId, material_id: materialId, mapping_id: mappingId };
  const issues: RfqMappingBlockingReason[] = [];
  const add = (code: string, message: string, suggestion: string) => issues.push({ code, message, suggestion, ...context });

  if (row.invitation_status !== "INVITED") add("RFQ_SUPPLIER_STATE_DRIFT", `Supplier ${supplierId} / Material ${materialId} 的 RFQ 邀请状态为 ${row.invitation_status}`, "刷新 RFQ 并先处置 Supplier 邀请状态，禁止沿用当前预览固定。");
  if (row.supplier_status !== "ACTIVE") add("SUPPLIER_NOT_ACTIVE", `Supplier ${supplierId} 当前不是 ACTIVE`, "由 Supplier 主数据责任人恢复或更正状态后重新打开预览。");
  if (row.material_status !== "ACTIVE") add("MATERIAL_NOT_ACTIVE", `Material ${materialId} 当前不是 ACTIVE`, "由物料主数据责任人恢复或更正状态后重新打开预览。");
  if (!FORMAL_MATERIAL_CODE.test(String(row.internal_material_code || ""))) add("MATERIAL_CODE_NOT_FORMAL", `Material ${materialId} 缺少有效正式编码`, "先完成内部正式编码治理，再重新打开预览。");
  if (!row.base_unit_code || row.base_unit_enabled !== true) add("MATERIAL_BASE_UNIT_INVALID", `Material ${materialId} 的当前主单位不完整或未启用`, "先修复 Material 主单位，再重新打开预览。");

  const activeCount = numberValue(row.current_active_supplier_material_count || 0);
  if (activeCount === 0) {
    if (mappingId) add("SUPPLIER_MAPPING_INACTIVE_OR_EXPIRED", `Supplier ${supplierId} / Material ${materialId} 的 Mapping ${mappingId} 当前失效或不在有效期`, "由采购核对 Mapping 状态和有效期，建立或批准当前有效 1:1 版本后重试。");
    else add("SUPPLIER_MAPPING_MISSING", `Supplier ${supplierId} / Material ${materialId} 缺少当前有效 1:1 Mapping`, "由采购建立并完成 Supplier Mapping 审核后重新打开预览。");
  } else if (activeCount > 1) {
    add("SUPPLIER_MAPPING_ACTIVE_CONFLICT", `Supplier ${supplierId} / Material ${materialId} 存在 ${activeCount} 条当前 ACTIVE 1:1 Mapping`, "先处置 Supplier/Material ACTIVE 冲突，确保当前仅有一条后重试。");
  }

  if (mappingId && row.mapping_status !== "ACTIVE") add("SUPPLIER_MAPPING_NOT_ACTIVE", `Mapping ${mappingId} 当前状态为 ${row.mapping_status}`, "使用受控审核流程形成当前 ACTIVE Mapping 后重试。");
  if (mappingId && nullableNumber(row.purchase_unit_id) !== numberValue(row.rfq_unit_id)) add("SUPPLIER_MAPPING_UNIT_MISMATCH", `Mapping ${mappingId} 的采购单位与 RFQ Line 不一致`, "建立采购单位与 RFQ Line 单位一致的 Mapping 后重试。");
  if (mappingId && (String(row.conversion_numerator) !== String(row.conversion_denominator))) add("SUPPLIER_MAPPING_CONVERSION_NOT_ONE_TO_ONE", `Mapping ${mappingId} 不是 1:1 单位换算`, "建立并批准当前有效的 1:1 Mapping 后重试。");
  if (mappingId && row.purchase_unit_enabled !== true) add("SUPPLIER_MAPPING_UNIT_INACTIVE", `Mapping ${mappingId} 使用的采购单位当前未启用`, "先启用或更正采购单位，再重新打开预览。");

  const partActiveCount = numberValue(row.current_active_supplier_part_number_count || 0);
  const claimConflictCount = numberValue(row.supplier_part_claim_conflict_count || 0);
  if (partActiveCount > 1 || claimConflictCount > 0) {
    add("SUPPLIER_PART_NUMBER_CONFLICT", `Supplier ${supplierId} 内 supplier_part_number ${row.supplier_part_number || "—"} 存在当前 ACTIVE 或稳定占用冲突`, "由采购核对供应商料号的稳定占用关系，消除冲突后重试。");
  }
  return issues;
}

function qualificationSnapshot(value: Omit<RfqMappingQualification, "qualification_digest">) {
  return {
    rfq: value.rfq,
    lines: value.lines,
    suppliers: value.suppliers,
    expected_binding_count: value.expected_binding_count,
    actual_candidate_count: value.actual_candidate_count,
    current_binding_count: value.current_binding_count,
    missing_combination_count: value.missing_combination_count,
    supplier_material_conflict_count: value.supplier_material_conflict_count,
    supplier_part_number_conflict_count: value.supplier_part_number_conflict_count,
    blocker_codes: value.blocking_reasons.map((reason) => [reason.code, reason.supplier_id || null, reason.material_id || null, reason.mapping_id || null]),
    combinations: value.combinations.map((row) => ({
      rfq_supplier_id: row.rfq_supplier_id,
      rfq_line_id: row.rfq_line_id,
      supplier_id: row.supplier_id,
      invitation_status: row.invitation_status,
      supplier_status: row.supplier_status,
      material_id: row.material_id,
      material_status: row.material_status,
      mapping_version_id: row.mapping_version_id,
      mapping_id: row.mapping_id,
      mapping_version: row.mapping_version,
      mapping_row_version: row.mapping_row_version,
      mapping_content_digest: row.mapping_content_digest,
      supplier_part_number: row.supplier_part_number,
      purchase_unit_id: row.purchase_unit_id,
      conversion_numerator: row.conversion_numerator,
      conversion_denominator: row.conversion_denominator,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      valid_from_instant: row.valid_from_instant,
      valid_to_instant: row.valid_to_instant,
      mapping_status: row.mapping_status,
      current_active_supplier_material_count: row.current_active_supplier_material_count,
      current_active_supplier_part_number_count: row.current_active_supplier_part_number_count,
      supplier_material_conflict: row.supplier_material_conflict,
      supplier_part_number_conflict: row.supplier_part_number_conflict,
      eligible: row.eligible,
    })),
  };
}

export async function loadRfqMappingQualification(
  client: PoolClient,
  rfqId: number,
  actor: Pick<IdentityActor, "username" | "role" | "permissions">,
  requestedExpectedVersion: number,
  lock = false,
): Promise<RfqMappingQualification> {
  let header = await readHeader(client, rfqId);
  const assertDataScope = (candidate: any) => {
    if (!canReadPurchaseRequest(actor, {
      status: String(candidate.purchase_request_status),
      submitted_by: String(candidate.submitted_by),
      accepted_by: nullableString(candidate.accepted_by),
      returned_by: nullableString(candidate.returned_by),
    })) throw new ProcurementSourcingError("RFQ_FORBIDDEN", "没有权限查看该 RFQ 及其采购申请数据域", 403);
  };
  assertDataScope(header);

  if (lock) {
    await lockQualificationSources(client, rfqId, header);
    header = await readHeader(client, rfqId);
    assertDataScope(header);
  }

  const linesResult = await client.query<any>(`select l.id,l.line_no,l.purchase_request_line_id,l.material_id,m.internal_material_code,m.standard_name,m.material_status,
      l.unit_id,u.code unit_code,l.requested_quantity::text,l.required_date::text
    from procurement_rfq_lines l join material_master m on m.id=l.material_id join units u on u.id=l.unit_id
    where l.rfq_id=$1 order by l.line_no,l.id`, [rfqId]);
  const suppliersResult = await client.query<any>(`select rs.id rfq_supplier_id,rs.supplier_id,rs.status invitation_status,
      s.supplier_code,s.supplier_name,s.status supplier_status
    from procurement_rfq_suppliers rs join suppliers s on s.id=rs.supplier_id
    where rs.rfq_id=$1 order by s.supplier_code,rs.supplier_id`, [rfqId]);
  const combinationsResult = await client.query<any>(`select
      rs.id rfq_supplier_id,rs.supplier_id,rs.status invitation_status,s.supplier_code,s.supplier_name,s.status supplier_status,
      l.id rfq_line_id,l.line_no,l.material_id,m.internal_material_code,m.standard_name,m.material_status,l.unit_id rfq_unit_id,rfq_unit.code rfq_unit_code,
      base_unit.code base_unit_code,base_unit.enabled base_unit_enabled,
      coalesce(active_match.mapping_count,0)::int current_active_supplier_material_count,
      candidate.id mapping_version_id,candidate.mapping_uid mapping_id,candidate.mapping_version_no mapping_version,candidate.version mapping_row_version,
      candidate.content_digest mapping_content_digest,candidate.supplier_item_code supplier_part_number,candidate.supplier_item_code_normalized,
      candidate.purchase_unit_id,purchase_unit.code purchase_unit_code,purchase_unit.enabled purchase_unit_enabled,
      candidate.conversion_numerator::text conversion_numerator,candidate.conversion_denominator::text conversion_denominator,
      to_char(candidate.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
      case when candidate.valid_to is null then null else to_char(candidate.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to,
      to_char(candidate.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') valid_from_instant,
      case when candidate.valid_to is null then null else to_char(candidate.valid_to at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end valid_to_instant,
      candidate.status mapping_status,
      coalesce(part_stats.current_active_count,0)::int current_active_supplier_part_number_count,
      coalesce(part_stats.claim_conflict_count,0)::int supplier_part_claim_conflict_count
    from procurement_rfq_suppliers rs
    join suppliers s on s.id=rs.supplier_id
    cross join lateral (select scoped_line.* from procurement_rfq_lines scoped_line where scoped_line.rfq_id=rs.rfq_id) l
    join material_master m on m.id=l.material_id
    join units rfq_unit on rfq_unit.id=l.unit_id
    left join units base_unit on base_unit.enabled=true and (
      (m.base_unit_id is not null and base_unit.id=m.base_unit_id)
      or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(base_unit.code)=upper(btrim(m.base_uom)))
    )
    left join lateral (
      select count(*)::int mapping_count,(array_agg(active.id order by active.mapping_version_no desc,active.id desc))[1] mapping_version_id
      from supplier_mappings active
      where active.supplier_id=rs.supplier_id and active.material_id=l.material_id
        and active.status='ACTIVE' and active.conversion_numerator=active.conversion_denominator
        and active.valid_from<=statement_timestamp() and (active.valid_to is null or active.valid_to>statement_timestamp())
    ) active_match on true
    left join lateral (
      select latest.id from supplier_mappings latest
      where latest.supplier_id=rs.supplier_id and latest.material_id=l.material_id
      order by latest.mapping_version_no desc,latest.id desc limit 1
    ) latest_any on true
    left join supplier_mappings candidate on candidate.id=coalesce(active_match.mapping_version_id,latest_any.id)
    left join units purchase_unit on purchase_unit.id=candidate.purchase_unit_id
    left join lateral (
      select count(*) filter(where active_part.status='ACTIVE')::int current_active_count,
        (select count(*)::int from supplier_mapping_supplier_part_keys part_key
          where part_key.supplier_id=candidate.supplier_id
            and part_key.normalized_supplier_item_code=coalesce(candidate.supplier_item_code_normalized,upper(btrim(candidate.supplier_item_code)))
            and part_key.mapping_uid<>candidate.mapping_uid) claim_conflict_count
      from supplier_mappings active_part
      where candidate.id is not null and active_part.supplier_id=candidate.supplier_id
        and upper(btrim(active_part.supplier_item_code))=upper(btrim(candidate.supplier_item_code))
    ) part_stats on true
    where rs.rfq_id=$1 order by s.supplier_code,rs.supplier_id,l.line_no,l.id`, [rfqId]);
  const counters = (await client.query<any>(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1) binding_count,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=$1) quote_count,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=$1) award_count,
      (select count(distinct link.purchase_order_id)::int from procurement_award_po_line_links link
        join procurement_sourcing_awards award on award.id=link.award_id where award.rfq_id=$1) purchase_order_count`, [rfqId])).rows[0];

  const blockingReasons: RfqMappingBlockingReason[] = [];
  const block = (code: string, message: string, suggestion: string) => blockingReasons.push({ code, message, suggestion });
  if (numberValue(header.version) !== requestedExpectedVersion) block("RFQ_VERSION_DRIFT", `RFQ CAS 已从页面 v${requestedExpectedVersion} 漂移为 v${header.version}`, "关闭窗口并刷新 RFQ 后重新执行资格预览。");
  if (header.status !== "DRAFT") block("RFQ_NOT_DRAFT", `RFQ 当前状态为 ${header.status}，不再是 DRAFT`, "刷新 RFQ；只有 DRAFT 可以固定 Mapping。");
  if (header.purchase_request_status !== "ACCEPTED") block("RFQ_SOURCE_NOT_ACCEPTED", `来源 PRQ ${header.purchase_request_id} 当前状态为 ${header.purchase_request_status}`, "先处置来源 PRQ 状态，再重新打开预览。");
  if (numberValue(header.purchase_request_version) !== numberValue(header.source_purchase_request_version)) block("RFQ_SOURCE_VERSION_DRIFT", `来源 PRQ ${header.purchase_request_id} 已从 v${header.source_purchase_request_version} 漂移为 v${header.purchase_request_version}`, "基于当前有效 PRQ 重新建立 RFQ，不得固定旧来源。");
  if (header.purchase_request_latest !== true) block("RFQ_SOURCE_NOT_LATEST", `来源 PRQ ${header.purchase_request_id} 已不是项目最新版本`, "使用项目最新已接收 PRQ 重新建立 RFQ。");
  if (header.deadline_valid !== true) block("RFQ_DEADLINE_EXPIRED", `RFQ 报价截止日 ${header.response_deadline} 已失效`, "先以受控流程建立具有有效截止日的新 RFQ。");
  if (!linesResult.rowCount) block("RFQ_LINE_REQUIRED", "RFQ 没有可固定的 Line", "核对 RFQ 来源和行快照，禁止对空 RFQ 固定 Mapping。");
  if (!suppliersResult.rowCount) block("RFQ_SUPPLIER_REQUIRED", "RFQ 没有受邀 Supplier", "核对 RFQ Supplier 范围后重新建立 RFQ。");
  const bindingCount = numberValue(counters.binding_count || 0);
  if (bindingCount > 0) block("RFQ_MAPPING_ALREADY_BOUND", `RFQ 已存在 ${bindingCount} 条 Mapping Binding，禁止部分补写或重复固定`, "刷新 RFQ 并核对已固定凭证；不得重绑或补写。");
  if (numberValue(counters.quote_count || 0) > 0) block("RFQ_HAS_QUOTE", "RFQ 已存在 Quote，禁止补固定 Mapping", "停止操作并核对 RFQ 生命周期和报价事实。");
  if (numberValue(counters.award_count || 0) > 0 || numberValue(counters.purchase_order_count || 0) > 0) block("RFQ_DOWNSTREAM_STATE_CONFLICT", "RFQ 已存在 Award 或 PO，禁止补固定 Mapping", "停止操作并核对下游不可变事实。");

  const combinations: RfqMappingQualificationCombination[] = combinationsResult.rows.map((row) => {
    const issues = combinationIssues(row);
    blockingReasons.push(...issues);
    const materialConflict = numberValue(row.current_active_supplier_material_count || 0) > 1;
    const partConflict = numberValue(row.current_active_supplier_part_number_count || 0) > 1 || numberValue(row.supplier_part_claim_conflict_count || 0) > 0;
    return {
      rfq_supplier_id: numberValue(row.rfq_supplier_id),
      rfq_line_id: numberValue(row.rfq_line_id),
      supplier_id: numberValue(row.supplier_id),
      supplier_code: String(row.supplier_code),
      supplier_name: String(row.supplier_name),
      supplier_status: String(row.supplier_status),
      invitation_status: String(row.invitation_status),
      material_id: numberValue(row.material_id),
      internal_material_code: String(row.internal_material_code),
      standard_name: String(row.standard_name),
      material_status: String(row.material_status),
      mapping_version_id: nullableNumber(row.mapping_version_id),
      mapping_id: nullableString(row.mapping_id),
      mapping_version: nullableNumber(row.mapping_version),
      mapping_row_version: nullableNumber(row.mapping_row_version),
      mapping_content_digest: nullableString(row.mapping_content_digest),
      supplier_part_number: nullableString(row.supplier_part_number),
      purchase_unit_id: nullableNumber(row.purchase_unit_id),
      purchase_unit_code: nullableString(row.purchase_unit_code),
      base_unit_code: nullableString(row.base_unit_code),
      conversion_numerator: nullableString(row.conversion_numerator),
      conversion_denominator: nullableString(row.conversion_denominator),
      conversion_text: row.conversion_numerator === null ? "—" : `${row.conversion_numerator}:${row.conversion_denominator}`,
      valid_from: nullableString(row.valid_from),
      valid_to: nullableString(row.valid_to),
      valid_from_instant: nullableString(row.valid_from_instant),
      valid_to_instant: nullableString(row.valid_to_instant),
      mapping_status: nullableString(row.mapping_status),
      current_active_supplier_material_count: numberValue(row.current_active_supplier_material_count || 0),
      current_active_supplier_part_number_count: numberValue(row.current_active_supplier_part_number_count || 0),
      supplier_material_conflict: materialConflict,
      supplier_part_number_conflict: partConflict,
      eligible: issues.length === 0,
      issues,
    };
  });

  const expectedBindingCount = linesResult.rows.length * suppliersResult.rows.length;
  const actualCandidateCount = combinations.reduce((total, row) => total + row.current_active_supplier_material_count, 0);
  const supplierMaterialConflictCount = combinations.filter((row) => row.supplier_material_conflict).length;
  const supplierPartNumberConflictCount = combinations.filter((row) => row.supplier_part_number_conflict).length;
  const missingCombinationCount = combinations.filter((row) => row.current_active_supplier_material_count === 0).length;
  const supplierDtos = suppliersResult.rows.map((supplier) => {
    const rows = combinations.filter((row) => row.supplier_id === numberValue(supplier.supplier_id));
    const eligibleCount = rows.filter((row) => row.eligible).length;
    const supplierMaterialConflicts = rows.filter((row) => row.supplier_material_conflict).length;
    const supplierPartConflicts = rows.filter((row) => row.supplier_part_number_conflict).length;
    return {
      rfq_supplier_id: numberValue(supplier.rfq_supplier_id),
      supplier_id: numberValue(supplier.supplier_id),
      supplier_code: String(supplier.supplier_code),
      supplier_name: String(supplier.supplier_name),
      status: String(supplier.supplier_status),
      invitation_status: String(supplier.invitation_status),
      required_material_count: linesResult.rows.length,
      eligible_mapping_count: eligibleCount,
      coverage: `${eligibleCount}/${linesResult.rows.length}`,
      missing_material_count: rows.filter((row) => row.current_active_supplier_material_count === 0).length,
      supplier_material_conflict_count: supplierMaterialConflicts,
      supplier_part_number_conflict_count: supplierPartConflicts,
      conflict_count: supplierMaterialConflicts + supplierPartConflicts,
      eligible: linesResult.rows.length > 0 && eligibleCount === linesResult.rows.length,
    };
  });
  const lineDtos = linesResult.rows.map((line) => ({
    id: numberValue(line.id), line_no: numberValue(line.line_no), purchase_request_line_id: numberValue(line.purchase_request_line_id),
    material_id: numberValue(line.material_id), internal_material_code: String(line.internal_material_code), standard_name: String(line.standard_name),
    material_status: String(line.material_status), unit_id: numberValue(line.unit_id), unit_code: String(line.unit_code),
    requested_quantity: String(line.requested_quantity), required_date: String(line.required_date),
  }));
  const rfq = {
    id: numberValue(header.id), rfq_code: String(header.rfq_code), round_no: numberValue(header.round_no),
    version: numberValue(header.version), expected_version: requestedExpectedVersion, status: String(header.status), status_text: header.status === "DRAFT" ? "DRAFT / 草稿 / 待发出" : String(header.status),
    purchase_request_id: numberValue(header.purchase_request_id), request_code: String(header.request_code),
    source_purchase_request_version: numberValue(header.source_purchase_request_version), current_purchase_request_version: numberValue(header.purchase_request_version),
    project_id: numberValue(header.project_id), project_code: String(header.project_code), project_name: String(header.project_name),
    response_deadline: String(header.response_deadline), currency_code: String(header.currency_code),
  };
  const withoutDigest: Omit<RfqMappingQualification, "qualification_digest"> = {
    rfq,
    lines: lineDtos,
    suppliers: supplierDtos,
    qualification_passed: blockingReasons.length === 0 && expectedBindingCount > 0 && actualCandidateCount === expectedBindingCount,
    expected_binding_count: expectedBindingCount,
    actual_candidate_count: actualCandidateCount,
    current_binding_count: bindingCount,
    missing_combination_count: missingCombinationCount,
    supplier_material_conflict_count: supplierMaterialConflictCount,
    supplier_part_number_conflict_count: supplierPartNumberConflictCount,
    blocking_reasons: blockingReasons,
    observed_at: String(header.observed_at),
    data_timezone: "Asia/Shanghai",
    combinations,
  };
  return { ...withoutDigest, qualification_digest: canonicalDigest(qualificationSnapshot(withoutDigest)) };
}

export function coverageFromRfqMappingQualification(qualification: RfqMappingQualification) {
  return qualification.suppliers.map((supplier) => ({
    supplier_id: Number(supplier.supplier_id),
    mapping_snapshots: qualification.combinations
      .filter((row) => row.supplier_id === Number(supplier.supplier_id) && row.eligible)
      .map((row) => ({
        mapping_version_id: row.mapping_version_id,
        mapping_id: row.mapping_id,
        mapping_version: row.mapping_version,
        row_version: row.mapping_row_version,
        content_digest: row.mapping_content_digest,
        material_id: row.material_id,
        supplier_id: row.supplier_id,
        supplier_part_number: row.supplier_part_number,
        purchase_unit_id: row.purchase_unit_id,
        purchase_unit_code: row.purchase_unit_code,
        base_unit_code: row.base_unit_code,
        conversion_numerator: row.conversion_numerator,
        conversion_denominator: row.conversion_denominator,
        valid_from: row.valid_from_instant,
        valid_to: row.valid_to_instant,
      })),
  }));
}
