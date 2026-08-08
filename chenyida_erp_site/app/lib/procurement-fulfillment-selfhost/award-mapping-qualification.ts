import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type AwardMappingQualificationLine = Readonly<{
  award_line_id: string;
  candidate_id: string | null;
  quote_line_id: string;
  rfq_binding_id: string | null;
  supplier_id: string;
  supplier_code: string;
  material_id: string;
  mapping_uuid: string | null;
  mapping_fact_id: string | null;
  mapping_version_no: number | null;
  mapping_row_cas: number | null;
  binding_status: string | null;
  mapping_status: string | null;
  supplier_status: string;
  material_status: string;
  supplier_part_number: string | null;
  supplier_unit_id: string | null;
  supplier_unit_code: string | null;
  internal_unit_id: string | null;
  internal_unit_code: string | null;
  conversion_numerator: string | null;
  conversion_denominator: string | null;
  valid_from: string | null;
  valid_to: string | null;
  content_digest: string | null;
  supplier_material_conflict_count: number;
  supplier_part_number_conflict_count: number;
  qualified: boolean;
  error_code: string | null;
  reason: string;
}>;

export type AwardMappingQualification = Readonly<{
  contract_version: "AWARD_PO_MAPPING_QUALIFICATION_V1";
  observed_at: string;
  data_timezone: "Asia/Shanghai";
  qualification_digest: string;
  all_qualified: boolean;
  qualified_line_count: number;
  line_count: number;
  lines: AwardMappingQualificationLine[];
}>;

export type AwardMappingQualificationRawRow = Readonly<{
  award_line_id: unknown;
  rfq_id: unknown;
  rfq_line_id: unknown;
  quote_line_id: unknown;
  candidate_id: unknown;
  candidate_count: unknown;
  quote_line_scope_matches: unknown;
  supplier_id: unknown;
  supplier_code: unknown;
  supplier_status: unknown;
  material_id: unknown;
  material_status: unknown;
  material_inventory_type: unknown;
  rfq_unit_id: unknown;
  rfq_unit_code: unknown;
  rfq_unit_enabled: unknown;
  binding_count: unknown;
  rfq_binding_id: unknown;
  binding_rfq_id: unknown;
  binding_rfq_line_id: unknown;
  binding_supplier_id: unknown;
  binding_material_id: unknown;
  binding_mapping_fact_id: unknown;
  binding_mapping_uuid: unknown;
  binding_mapping_version_no: unknown;
  binding_mapping_row_cas: unknown;
  binding_content_digest: unknown;
  binding_supplier_part_number: unknown;
  binding_supplier_unit_id: unknown;
  binding_conversion_numerator: unknown;
  binding_conversion_denominator: unknown;
  binding_valid_from_matches: unknown;
  binding_valid_to_matches: unknown;
  binding_status: unknown;
  mapping_fact_id: unknown;
  mapping_uuid: unknown;
  mapping_version_no: unknown;
  mapping_row_cas: unknown;
  mapping_status: unknown;
  mapping_content_digest: unknown;
  mapping_supplier_id: unknown;
  mapping_material_id: unknown;
  supplier_part_number: unknown;
  mapping_supplier_unit_id: unknown;
  supplier_unit_code: unknown;
  supplier_unit_enabled: unknown;
  conversion_numerator: unknown;
  conversion_denominator: unknown;
  valid_from: unknown;
  valid_to: unknown;
  mapping_effective_now: unknown;
  mapping_expired_now: unknown;
  internal_unit_match_count: unknown;
  internal_unit_id: unknown;
  internal_unit_code: unknown;
  material_base_uom_matches: unknown;
  latest_mapping_fact_id: unknown;
  latest_mapping_version_no: unknown;
  supplier_material_conflict_count: unknown;
  supplier_part_number_conflict_count: unknown;
}>;

const stableId = (value: unknown) => {
  const result = String(value ?? "");
  return /^[1-9]\d*$/.test(result) ? result : null;
};
const nullableText = (value: unknown) => value === null || value === undefined ? null : String(value);
const requiredText = (value: unknown) => String(value ?? "");
const nullableInteger = (value: unknown) => value === null || value === undefined ? null : Number(value);
const count = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const truth = (value: unknown) => value === true;
const compareIds = (left: string, right: string) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
const oneToOne = (numerator: string | null, denominator: string | null) => {
  try { return numerator !== null && denominator !== null && BigInt(numerator) > 0n && BigInt(numerator) === BigInt(denominator); }
  catch { return false; }
};
const issue = (code: string, row: AwardMappingQualificationRawRow, message: string) => ({
  code,
  reason: `Award Line ${stableId(row.award_line_id) || "?"} / Supplier ${stableId(row.supplier_id) || "?"} / Material ${stableId(row.material_id) || "?"}：${message}`,
});

function qualificationIssue(row: AwardMappingQualificationRawRow) {
  const awardLineId = stableId(row.award_line_id);
  const candidateId = stableId(row.candidate_id);
  const quoteLineId = stableId(row.quote_line_id);
  const bindingId = stableId(row.rfq_binding_id);
  const mappingFactId = stableId(row.mapping_fact_id);
  const mappingUuid = nullableText(row.mapping_uuid);
  const mappingVersion = nullableInteger(row.mapping_version_no);
  const mappingRowCas = nullableInteger(row.mapping_row_cas);
  const supplierId = stableId(row.supplier_id);
  const materialId = stableId(row.material_id);
  const rfqUnitId = stableId(row.rfq_unit_id);
  const supplierUnitId = stableId(row.mapping_supplier_unit_id);
  const internalUnitId = stableId(row.internal_unit_id);
  const numerator = nullableText(row.conversion_numerator);
  const denominator = nullableText(row.conversion_denominator);
  const digest = nullableText(row.mapping_content_digest);

  if (!awardLineId || !candidateId || count(row.candidate_count) !== 1 || !quoteLineId || !truth(row.quote_line_scope_matches)) {
    return issue("AWARD_MAPPING_LINEAGE_INVALID", row, "Candidate或Quote Line固定谱系缺失、重复或跨越RFQ Line");
  }
  if (count(row.binding_count) === 0 || !bindingId) return issue("AWARD_MAPPING_BINDING_MISSING", row, "缺少固定RFQ Binding");
  if (count(row.binding_count) !== 1) return issue("AWARD_MAPPING_BINDING_CONFLICT", row, `固定RFQ Binding数量为${count(row.binding_count)}，要求恰好1条`);
  if (stableId(row.binding_rfq_id) !== stableId(row.rfq_id)
    || stableId(row.binding_rfq_line_id) !== stableId(row.rfq_line_id)
    || stableId(row.binding_supplier_id) !== supplierId
    || stableId(row.binding_material_id) !== materialId) {
    return issue("AWARD_MAPPING_BINDING_SCOPE_MISMATCH", row, `RFQ Binding ${bindingId} 与Award Supplier、RFQ Line或Material不一致`);
  }
  if (!mappingFactId) return issue("AWARD_MAPPING_FACT_MISSING", row, `RFQ Binding ${bindingId} 引用的Mapping Fact不存在`);
  if (!mappingUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mappingUuid)
    || !Number.isSafeInteger(mappingVersion) || Number(mappingVersion) < 1
    || !Number.isSafeInteger(mappingRowCas) || Number(mappingRowCas) < 1
    || !nullableText(row.supplier_part_number)?.trim() || !nullableText(row.valid_from)) {
    return issue("AWARD_MAPPING_FACT_CREDENTIAL_INVALID", row, `Mapping Fact ${mappingFactId} 的UUID、Version、Row CAS、Supplier Part或有效期凭证不完整`);
  }
  if (stableId(row.binding_mapping_fact_id) !== mappingFactId
    || nullableText(row.binding_mapping_uuid) !== mappingUuid
    || nullableInteger(row.binding_mapping_version_no) !== mappingVersion
    || nullableInteger(row.binding_mapping_row_cas) !== mappingRowCas
    || stableId(row.binding_supplier_unit_id) !== supplierUnitId
    || nullableText(row.binding_supplier_part_number) !== nullableText(row.supplier_part_number)
    || nullableText(row.binding_conversion_numerator) !== numerator
    || nullableText(row.binding_conversion_denominator) !== denominator
    || !truth(row.binding_valid_from_matches) || !truth(row.binding_valid_to_matches)) {
    return issue("AWARD_MAPPING_BINDING_FACT_DRIFT", row, `RFQ Binding ${bindingId} 快照与精确Mapping Fact ${mappingFactId}不一致`);
  }
  if (nullableText(row.binding_content_digest) !== digest || !digest || !/^[0-9a-f]{64}$/.test(digest)) {
    return issue("AWARD_MAPPING_DIGEST_DRIFT", row, `RFQ Binding ${bindingId} 与Mapping Fact ${mappingFactId}的content digest缺失或不一致`);
  }
  if (nullableText(row.binding_status) !== "ACTIVE") return issue("AWARD_MAPPING_BINDING_NOT_ACTIVE", row, `RFQ Binding ${bindingId} 状态不是ACTIVE`);
  if (stableId(row.mapping_supplier_id) !== supplierId || stableId(row.mapping_material_id) !== materialId) {
    return issue("AWARD_MAPPING_FACT_SCOPE_MISMATCH", row, `Mapping Fact ${mappingFactId} 的Supplier或Material与Award不一致`);
  }
  if (nullableText(row.mapping_status) !== "ACTIVE") return issue("AWARD_MAPPING_NOT_ACTIVE", row, `Mapping Fact ${mappingFactId} 状态为${nullableText(row.mapping_status) || "缺失"}`);
  if (stableId(row.latest_mapping_fact_id) !== mappingFactId
    || nullableInteger(row.latest_mapping_version_no) !== nullableInteger(row.mapping_version_no)) {
    return issue("AWARD_MAPPING_VERSION_DRIFT", row, `固定Mapping Fact ${mappingFactId} 已不是该Mapping UUID的最新版本`);
  }
  if (requiredText(row.supplier_status) !== "ACTIVE") return issue("AWARD_MAPPING_SUPPLIER_NOT_ACTIVE", row, `Supplier状态为${requiredText(row.supplier_status) || "缺失"}`);
  if (requiredText(row.material_status) !== "ACTIVE") return issue("AWARD_MAPPING_MATERIAL_NOT_ACTIVE", row, `Material状态为${requiredText(row.material_status) || "缺失"}`);
  if (requiredText(row.material_inventory_type) !== "STOCKED") return issue("AWARD_MAPPING_MATERIAL_NOT_STOCKED", row, `Material库存类型为${requiredText(row.material_inventory_type) || "缺失"}`);
  if (!truth(row.rfq_unit_enabled) || !truth(row.supplier_unit_enabled) || count(row.internal_unit_match_count) !== 1
    || !internalUnitId || !truth(row.material_base_uom_matches)) {
    return issue("AWARD_MAPPING_INTERNAL_UNIT_UNRESOLVED", row, "内部主单位或Supplier Unit未唯一解析为启用Unit");
  }
  if (!rfqUnitId || supplierUnitId !== rfqUnitId || internalUnitId !== rfqUnitId) {
    return issue("AWARD_MAPPING_UNIT_MISMATCH", row, `Supplier Unit、Internal Unit与RFQ Unit不一致`);
  }
  if (!oneToOne(numerator, denominator)) return issue("AWARD_MAPPING_CONVERSION_NOT_ONE_TO_ONE", row, `Mapping Fact ${mappingFactId} 的换算率不是正数1:1`);
  if (!truth(row.mapping_effective_now)) return issue("AWARD_MAPPING_NOT_YET_EFFECTIVE", row, `Mapping Fact ${mappingFactId} 尚未生效`);
  if (truth(row.mapping_expired_now)) return issue("AWARD_MAPPING_EXPIRED", row, `Mapping Fact ${mappingFactId} 已失效`);
  if (count(row.supplier_material_conflict_count) !== 0) {
    return issue("AWARD_MAPPING_SUPPLIER_MATERIAL_CONFLICT", row, `相同Supplier/Material另有${count(row.supplier_material_conflict_count)}条当前ACTIVE 1:1 Mapping`);
  }
  if (count(row.supplier_part_number_conflict_count) !== 0) {
    return issue("AWARD_MAPPING_SUPPLIER_PART_CONFLICT", row, `相同Supplier内supplier_part_number另有${count(row.supplier_part_number_conflict_count)}条当前ACTIVE Mapping`);
  }
  return null;
}

export function buildAwardMappingQualification(rows: AwardMappingQualificationRawRow[], observedAt: string): AwardMappingQualification {
  const sorted = [...rows].sort((left, right) => {
    const leftId = stableId(left.award_line_id), rightId = stableId(right.award_line_id);
    if (!leftId) return rightId ? 1 : 0;
    return rightId ? compareIds(leftId, rightId) : -1;
  });
  const lines: AwardMappingQualificationLine[] = sorted.map((row) => {
    const failure = qualificationIssue(row);
    return {
      award_line_id: stableId(row.award_line_id) || "0",
      candidate_id: stableId(row.candidate_id),
      quote_line_id: stableId(row.quote_line_id) || "0",
      rfq_binding_id: stableId(row.rfq_binding_id),
      supplier_id: stableId(row.supplier_id) || "0",
      supplier_code: requiredText(row.supplier_code),
      material_id: stableId(row.material_id) || "0",
      mapping_uuid: nullableText(row.mapping_uuid),
      mapping_fact_id: stableId(row.mapping_fact_id),
      mapping_version_no: nullableInteger(row.mapping_version_no),
      mapping_row_cas: nullableInteger(row.mapping_row_cas),
      binding_status: nullableText(row.binding_status),
      mapping_status: nullableText(row.mapping_status),
      supplier_status: requiredText(row.supplier_status),
      material_status: requiredText(row.material_status),
      supplier_part_number: nullableText(row.supplier_part_number),
      supplier_unit_id: stableId(row.mapping_supplier_unit_id),
      supplier_unit_code: nullableText(row.supplier_unit_code),
      internal_unit_id: stableId(row.internal_unit_id),
      internal_unit_code: nullableText(row.internal_unit_code),
      conversion_numerator: nullableText(row.conversion_numerator),
      conversion_denominator: nullableText(row.conversion_denominator),
      valid_from: nullableText(row.valid_from),
      valid_to: nullableText(row.valid_to),
      content_digest: nullableText(row.mapping_content_digest),
      supplier_material_conflict_count: count(row.supplier_material_conflict_count),
      supplier_part_number_conflict_count: count(row.supplier_part_number_conflict_count),
      qualified: failure === null,
      error_code: failure?.code || null,
      reason: failure?.reason || "Supplier Mapping资格通过",
    };
  });
  const digestBody = lines.map((line) => ({ ...line }));
  const qualificationDigest = createHash("sha256").update(JSON.stringify([
    "AWARD_PO_MAPPING_QUALIFICATION_V1",
    digestBody,
  ])).digest("hex");
  const qualifiedLineCount = lines.filter((line) => line.qualified).length;
  return {
    contract_version: "AWARD_PO_MAPPING_QUALIFICATION_V1",
    observed_at: observedAt,
    data_timezone: "Asia/Shanghai",
    qualification_digest: qualificationDigest,
    all_qualified: lines.length > 0 && qualifiedLineCount === lines.length,
    qualified_line_count: qualifiedLineCount,
    line_count: lines.length,
    lines,
  };
}

export function firstAwardMappingQualificationFailure(qualification: AwardMappingQualification) {
  return qualification.lines.find((line) => !line.qualified) || null;
}

async function lockQualificationFacts(client: PoolClient, awardId: string | number) {
  await client.query("select id from procurement_sourcing_awards where id=$1 for update", [awardId]);
  await client.query("select id from procurement_sourcing_award_lines where award_id=$1 order by id for update", [awardId]);
  await client.query(`select candidate.id from procurement_quote_comparison_lines candidate where exists(
      select 1 from procurement_sourcing_award_lines line where line.award_id=$1
        and line.comparison_id=candidate.comparison_id
        and line.selected_quote_line_id=candidate.quote_line_id and line.supplier_id=candidate.supplier_id
    ) order by candidate.id for share`, [awardId]);
  await client.query(`select quote_line.id from procurement_supplier_quote_lines quote_line where exists(
      select 1 from procurement_sourcing_award_lines line where line.award_id=$1
        and line.selected_quote_line_id=quote_line.id
    ) order by quote_line.id for share`, [awardId]);
  await client.query(`select quote.id from procurement_supplier_quotes quote where exists(
      select 1 from procurement_sourcing_award_lines line
      join procurement_supplier_quote_lines quote_line on quote_line.id=line.selected_quote_line_id
      where line.award_id=$1 and quote.id=quote_line.quote_id and quote.supplier_id=line.supplier_id
    ) order by quote.id for share`, [awardId]);
  await client.query(`select binding.id from procurement_rfq_supplier_line_mapping_bindings binding
    where exists(select 1 from procurement_sourcing_award_lines line
      join procurement_sourcing_awards award on award.id=line.award_id
      where line.award_id=$1 and binding.rfq_id=award.rfq_id
        and binding.rfq_line_id=line.rfq_line_id and binding.supplier_id=line.supplier_id)
    order by binding.id for update`, [awardId]);
  const mappingScopes = (await client.query<{
    supplier_id: string;
    material_id: string;
    normalized_supplier_item_code: string;
  }>(`select distinct binding.supplier_id::text supplier_id,binding.material_id::text material_id,
      coalesce(mapping.supplier_item_code_normalized,upper(regexp_replace(btrim(mapping.supplier_item_code),'\\s+',' ','g')))
        normalized_supplier_item_code
    from procurement_rfq_supplier_line_mapping_bindings binding
    join procurement_sourcing_awards award on award.rfq_id=binding.rfq_id and award.id=$1
    join procurement_sourcing_award_lines line on line.award_id=award.id
      and line.rfq_line_id=binding.rfq_line_id and line.supplier_id=binding.supplier_id
    join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
    order by binding.supplier_id::text,binding.material_id::text,normalized_supplier_item_code`, [awardId])).rows;
  const supplierPartKeys = [...new Set(mappingScopes.map((scope) =>
    `supplier-part:${scope.supplier_id}:${scope.normalized_supplier_item_code}`))].sort();
  const supplierMaterialKeys = [...new Set(mappingScopes.map((scope) =>
    `supplier-material:${scope.supplier_id}:${scope.material_id}`))].sort();
  for (const key of [...supplierPartKeys, ...supplierMaterialKeys]) {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  }
  await client.query(`select mapping.id from supplier_mappings mapping where exists(
      select 1 from procurement_rfq_supplier_line_mapping_bindings binding
      join procurement_sourcing_award_lines line on line.rfq_line_id=binding.rfq_line_id and line.supplier_id=binding.supplier_id
      join procurement_sourcing_awards award on award.id=line.award_id and award.rfq_id=binding.rfq_id
      where line.award_id=$1 and (
        mapping.id=binding.supplier_mapping_version_id or mapping.mapping_uid=binding.mapping_uid
        or (mapping.supplier_id=binding.supplier_id and mapping.material_id=binding.material_id)
        or exists(select 1 from supplier_mappings fixed_mapping
          where fixed_mapping.id=binding.supplier_mapping_version_id
            and mapping.supplier_id=binding.supplier_id
            and upper(btrim(mapping.supplier_item_code))=upper(btrim(fixed_mapping.supplier_item_code)))
      )
    ) order by mapping.id for update`, [awardId]);
  await client.query(`select supplier.id from suppliers supplier where exists(
      select 1 from procurement_sourcing_award_lines line where line.award_id=$1 and line.supplier_id=supplier.id
    ) order by supplier.id for share`, [awardId]);
  await client.query(`select material.id from material_master material where exists(
      select 1 from procurement_sourcing_award_lines line
      join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id
      where line.award_id=$1 and rfq_line.material_id=material.id
    ) order by material.id for share`, [awardId]);
  await client.query(`select unit.id from units unit where exists(
      select 1 from procurement_sourcing_award_lines line
      join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id
      join material_master material on material.id=rfq_line.material_id
      where line.award_id=$1 and (unit.id=rfq_line.unit_id or unit.id=material.base_unit_id
        or (material.base_unit_id is null and upper(unit.code)=upper(btrim(material.base_uom))))
    ) or exists(select 1 from procurement_rfq_supplier_line_mapping_bindings binding
      join procurement_sourcing_awards award on award.rfq_id=binding.rfq_id and award.id=$1
      join procurement_sourcing_award_lines award_line on award_line.award_id=award.id
        and award_line.rfq_line_id=binding.rfq_line_id and award_line.supplier_id=binding.supplier_id
      join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
      where unit.id=mapping.purchase_unit_id)
    order by unit.id for share`, [awardId]);
}

export async function loadAwardMappingQualification(
  client: PoolClient,
  awardId: string | number,
  options: Readonly<{ lock?: boolean }> = {},
): Promise<AwardMappingQualification> {
  if (options.lock) await lockQualificationFacts(client, awardId);
  const observedAt = String((await client.query<{ observed_at: string }>(
    `select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at`,
  )).rows[0].observed_at);
  const result = await client.query<AwardMappingQualificationRawRow>(`select
      line.id::text award_line_id,award.rfq_id::text rfq_id,line.rfq_line_id::text rfq_line_id,
      line.selected_quote_line_id::text quote_line_id,candidate.candidate_id,candidate.candidate_count,
      (quote_line.id is not null and quote_line.rfq_line_id=line.rfq_line_id
        and quote_line.material_id=rfq_line.material_id and quote_line.unit_id=rfq_line.unit_id
        and quote.rfq_id=award.rfq_id and quote.supplier_id=line.supplier_id) quote_line_scope_matches,
      line.supplier_id::text supplier_id,supplier.supplier_code,supplier.status supplier_status,
      rfq_line.material_id::text material_id,material.material_status,material.inventory_type material_inventory_type,
      rfq_line.unit_id::text rfq_unit_id,rfq_unit.code rfq_unit_code,rfq_unit.enabled rfq_unit_enabled,
      binding_choice.binding_count,binding.id::text rfq_binding_id,binding.rfq_id::text binding_rfq_id,
      binding.rfq_line_id::text binding_rfq_line_id,binding.supplier_id::text binding_supplier_id,
      binding.material_id::text binding_material_id,binding.supplier_mapping_version_id::text binding_mapping_fact_id,
      binding.mapping_uid::text binding_mapping_uuid,binding.mapping_version_no binding_mapping_version_no,
      binding.mapping_row_version binding_mapping_row_cas,binding.mapping_content_digest binding_content_digest,
      binding.supplier_part_number binding_supplier_part_number,binding.purchase_unit_id::text binding_supplier_unit_id,
      binding.conversion_numerator::text binding_conversion_numerator,
      binding.conversion_denominator::text binding_conversion_denominator,
      (binding.valid_from is not distinct from mapping.valid_from) binding_valid_from_matches,
      (binding.valid_to is not distinct from mapping.valid_to) binding_valid_to_matches,binding.binding_status,
      mapping.id::text mapping_fact_id,mapping.mapping_uid::text mapping_uuid,
      mapping.mapping_version_no,mapping.version mapping_row_cas,mapping.status mapping_status,
      mapping.content_digest mapping_content_digest,mapping.supplier_id::text mapping_supplier_id,
      mapping.material_id::text mapping_material_id,mapping.supplier_item_code supplier_part_number,
      mapping.purchase_unit_id::text mapping_supplier_unit_id,supplier_unit.code supplier_unit_code,
      supplier_unit.enabled supplier_unit_enabled,mapping.conversion_numerator::text conversion_numerator,
      mapping.conversion_denominator::text conversion_denominator,
      to_char(mapping.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
      case when mapping.valid_to is null then null else to_char(mapping.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to,
      (mapping.valid_from<=transaction_timestamp()) mapping_effective_now,
      (mapping.valid_to is not null and mapping.valid_to<=transaction_timestamp()) mapping_expired_now,
      internal_unit.match_count internal_unit_match_count,internal_unit.internal_unit_id,
      internal_unit.internal_unit_code,
      (nullif(btrim(material.base_uom),'') is not null
        and upper(btrim(material.base_uom))=upper(internal_unit.internal_unit_code)) material_base_uom_matches,
      latest.id::text latest_mapping_fact_id,
      latest.mapping_version_no latest_mapping_version_no,
      supplier_material_conflict.conflict_count supplier_material_conflict_count,
      supplier_part_conflict.conflict_count supplier_part_number_conflict_count
    from procurement_sourcing_award_lines line
    join procurement_sourcing_awards award on award.id=line.award_id
    join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id and rfq_line.rfq_id=award.rfq_id
    join suppliers supplier on supplier.id=line.supplier_id
    join material_master material on material.id=rfq_line.material_id
    join units rfq_unit on rfq_unit.id=rfq_line.unit_id
    left join procurement_supplier_quote_lines quote_line on quote_line.id=line.selected_quote_line_id
    left join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
    left join lateral (
      select count(*)::int candidate_count,
        (array_agg(candidate.id::text order by candidate.id))[1] candidate_id
      from procurement_quote_comparison_lines candidate
      where candidate.comparison_id=line.comparison_id
        and candidate.quote_line_id=line.selected_quote_line_id and candidate.supplier_id=line.supplier_id
    ) candidate on true
    left join lateral (
      select count(*)::int binding_count,(array_agg(candidate_binding.id order by candidate_binding.id))[1] binding_id
      from procurement_rfq_supplier_line_mapping_bindings candidate_binding
      where candidate_binding.rfq_id=award.rfq_id and candidate_binding.rfq_line_id=line.rfq_line_id
        and candidate_binding.supplier_id=line.supplier_id
    ) binding_choice on true
    left join procurement_rfq_supplier_line_mapping_bindings binding on binding.id=binding_choice.binding_id
    left join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
    left join units supplier_unit on supplier_unit.id=mapping.purchase_unit_id
    left join lateral (
      select count(*)::int match_count,(array_agg(candidate_unit.id::text order by candidate_unit.id))[1] internal_unit_id,
        (array_agg(candidate_unit.code order by candidate_unit.id))[1] internal_unit_code
      from units candidate_unit where candidate_unit.enabled=true and (
        (material.base_unit_id is not null and candidate_unit.id=material.base_unit_id)
        or (material.base_unit_id is null and nullif(btrim(material.base_uom),'') is not null
          and upper(candidate_unit.code)=upper(btrim(material.base_uom)))
      )
    ) internal_unit on true
    left join lateral (
      select candidate_mapping.id,candidate_mapping.mapping_version_no
      from supplier_mappings candidate_mapping where candidate_mapping.mapping_uid=mapping.mapping_uid
      order by candidate_mapping.mapping_version_no desc,candidate_mapping.id desc limit 1
    ) latest on true
    left join lateral (
      select count(*)::int conflict_count from supplier_mappings conflict
      where mapping.id is not null and conflict.id<>mapping.id and conflict.supplier_id=line.supplier_id
        and conflict.material_id=rfq_line.material_id and conflict.status='ACTIVE'
        and conflict.conversion_numerator>0 and conflict.conversion_numerator=conflict.conversion_denominator
        and conflict.valid_from<=transaction_timestamp()
        and (conflict.valid_to is null or conflict.valid_to>transaction_timestamp())
    ) supplier_material_conflict on true
    left join lateral (
      select count(*)::int conflict_count from (
        select conflict.mapping_uid::text conflict_identity from supplier_mappings conflict
        where mapping.id is not null and conflict.id<>mapping.id and conflict.mapping_uid<>mapping.mapping_uid
          and conflict.supplier_id=line.supplier_id
          and coalesce(conflict.supplier_item_code_normalized,upper(regexp_replace(btrim(conflict.supplier_item_code),'\\s+',' ','g')))
            =coalesce(mapping.supplier_item_code_normalized,upper(regexp_replace(btrim(mapping.supplier_item_code),'\\s+',' ','g')))
          and conflict.status='ACTIVE' and conflict.valid_from<=transaction_timestamp()
          and (conflict.valid_to is null or conflict.valid_to>transaction_timestamp())
        union
        select part_key.mapping_uid::text conflict_identity from supplier_mapping_supplier_part_keys part_key
        where mapping.id is not null and part_key.supplier_id=line.supplier_id
          and part_key.normalized_supplier_item_code=coalesce(mapping.supplier_item_code_normalized,
            upper(regexp_replace(btrim(mapping.supplier_item_code),'\\s+',' ','g')))
          and part_key.mapping_uid<>mapping.mapping_uid
      ) conflicts
    ) supplier_part_conflict on true
    where line.award_id=$1 order by line.id`, [awardId]);
  return buildAwardMappingQualification(result.rows, observedAt);
}
