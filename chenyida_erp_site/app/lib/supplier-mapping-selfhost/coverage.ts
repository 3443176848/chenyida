import { SupplierMappingError } from "./errors.ts";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

export type MissingMappingCombination = Readonly<{
  material_id: number;
  internal_material_code: string;
  standard_name: string;
  unit_id: number;
  unit_code: string;
}>;

export type SupplierMappingCoverage = Readonly<{
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_status: string;
  covered_count: number;
  required_count: number;
  selectable: boolean;
  unavailable_reason: string;
  missing: MissingMappingCombination[];
  mapping_snapshots: Array<Record<string, unknown>>;
}>;

export async function loadSupplierMappingCoverage(
  database: Queryable,
  purchaseRequestId: number,
  supplierIds: readonly number[] | null = null,
): Promise<SupplierMappingCoverage[]> {
  const result = await database.query(`
    with requested_lines as (
      select distinct l.material_id,l.unit_id,m.internal_material_code,m.standard_name,m.material_status,u.code unit_code,
        ((m.base_unit_id is not null and m.base_unit_id=l.unit_id)
          or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(u.code)=upper(btrim(m.base_uom)))) base_unit_matches
      from planning_purchase_request_lines l
      join material_master m on m.id=l.material_id
      join units u on u.id=l.unit_id
      where l.purchase_request_id=$1
    ), supplier_scope as (
      select s.id supplier_id,s.supplier_code,s.supplier_name,s.status supplier_status
      from suppliers s
      where ($2::bigint[] is null or s.id=any($2::bigint[]))
    ), combinations as (
      select supplier_scope.*,requested_lines.*,
        supplier_scope.supplier_status='ACTIVE'
          and requested_lines.material_status='ACTIVE'
          and requested_lines.internal_material_code ~ '^CYD-[A-Z0-9_]+-[0-9]{6}$'
          and requested_lines.base_unit_matches
          and mapping_match.mapping_count=1 covered,
        mapping_match.mapping_rows
      from supplier_scope
      cross join requested_lines
      left join lateral (
        select count(*)::int mapping_count,
          coalesce(jsonb_agg(jsonb_build_object(
            'mapping_version_id',sm.id,
            'mapping_id',sm.mapping_uid,
            'mapping_version',sm.mapping_version_no,
            'row_version',sm.version,
            'mapping_status',sm.status,
            'material_id',sm.material_id,
            'supplier_id',sm.supplier_id,
            'supplier_part_number',sm.supplier_item_code,
            'purchase_unit_id',sm.purchase_unit_id,
            'purchase_unit_code',pu.code,
            'base_unit_id',mm.base_unit_id,
            'base_unit_code',bu.code,
            'conversion_numerator',sm.conversion_numerator::text,
            'conversion_denominator',sm.conversion_denominator::text,
            'valid_from',sm.valid_from,
            'valid_to',sm.valid_to,
            'content_digest',sm.content_digest
          ) order by sm.id),'[]'::jsonb) mapping_rows
        from supplier_mappings sm
        join material_master mm on mm.id=sm.material_id
        join units pu on pu.id=sm.purchase_unit_id
        left join units bu on bu.id=mm.base_unit_id
        where sm.supplier_id=supplier_scope.supplier_id
          and sm.material_id=requested_lines.material_id
          and sm.purchase_unit_id=requested_lines.unit_id
          and sm.status='ACTIVE'
          and sm.conversion_numerator=sm.conversion_denominator
          and sm.valid_from<=statement_timestamp()
          and (sm.valid_to is null or sm.valid_to>statement_timestamp())
      ) mapping_match on true
    )
    select supplier_id,supplier_code,supplier_name,supplier_status,
      count(*) filter(where covered)::int covered_count,
      count(*)::int required_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'material_id',material_id,
        'internal_material_code',internal_material_code,
        'standard_name',standard_name,
        'unit_id',unit_id,
        'unit_code',unit_code
      ) order by material_id) filter(where not covered),'[]'::jsonb) missing,
      coalesce(jsonb_agg(mapping_rows->0 order by material_id) filter(where covered),'[]'::jsonb) mapping_snapshots
    from combinations
    group by supplier_id,supplier_code,supplier_name,supplier_status
    order by supplier_code,supplier_id
  `, [purchaseRequestId, supplierIds ? [...supplierIds] : null]);

  return result.rows.map((row) => {
    const covered = Number(row.covered_count);
    const required = Number(row.required_count);
    const status = String(row.supplier_status);
    const selectable = status === "ACTIVE" && required > 0 && covered === required;
    return {
      supplier_id: Number(row.supplier_id),
      supplier_code: String(row.supplier_code),
      supplier_name: String(row.supplier_name),
      supplier_status: status,
      covered_count: covered,
      required_count: required,
      selectable,
      unavailable_reason: selectable
        ? ""
        : status !== "ACTIVE"
          ? "供应商不是 ACTIVE"
          : required === 0
            ? "采购申请没有物料明细"
            : "缺少当前有效 1:1 Supplier Mapping",
      missing: (row.missing || []) as MissingMappingCombination[],
      mapping_snapshots: (row.mapping_snapshots || []) as Array<Record<string, unknown>>,
    };
  });
}

export function mappingIncompleteMessage(coverage: SupplierMappingCoverage): string {
  const prefix = `Supplier ${coverage.supplier_id} / ${coverage.supplier_code}`;
  if (coverage.supplier_status !== "ACTIVE") return `${prefix} 当前不是 ACTIVE，不能选入 RFQ`;
  const missing = coverage.missing
    .map((item) => `- Material ${item.material_id} / ${item.internal_material_code}`)
    .join("\n");
  return `${prefix} 缺少：${missing ? `\n${missing}` : "当前有效 1:1 Supplier Mapping"}`;
}

export function requireCompleteCoverage(
  coverageRows: readonly SupplierMappingCoverage[],
  expectedSupplierIds: readonly number[],
): void {
  const byId = new Map(coverageRows.map((row) => [row.supplier_id, row]));
  for (const supplierId of expectedSupplierIds) {
    const coverage = byId.get(supplierId);
    if (!coverage) throw new SupplierMappingError("SUPPLIER_NOT_FOUND", `Supplier ${supplierId} 不存在`, 422);
    if (!coverage.selectable) {
      throw new SupplierMappingError("SUPPLIER_MAPPING_INCOMPLETE", mappingIncompleteMessage(coverage), 422);
    }
  }
}
