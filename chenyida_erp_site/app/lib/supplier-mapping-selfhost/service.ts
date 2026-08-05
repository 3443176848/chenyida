/* eslint-disable @typescript-eslint/no-explicit-any -- PostgreSQL projections are normalized at this service boundary. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { SupplierMappingError } from "./errors.ts";
import { SupplierMappingRepository } from "./repository.ts";
import type {
  SupplierMappingDraftInput,
  SupplierMappingFaultInjector,
  SupplierMappingMutationMeta,
  SupplierMappingWorkResult,
} from "./types.ts";
import {
  boundedExactText,
  boundedText,
  canonicalDigest,
  exactKeys,
  expectedVersion,
  parseDraftInput,
  shanghaiBoundary,
} from "./validation.ts";

const FORMAL_MATERIAL_CODE = /^CYD-[A-Z0-9_]+-[0-9]{6}$/;
const LIST_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "ACTIVE", "REJECTED", "INACTIVE"]);
const rowData = <T>(rows: T[], code: string, message: string, status = 404): T => {
  if (!rows[0]) throw new SupplierMappingError(code, message, status);
  return rows[0];
};

type ReferenceRow = {
  supplier_id: string | number;
  supplier_code: string;
  supplier_name: string;
  supplier_status: string;
  material_id: string | number;
  internal_material_code: string;
  standard_name: string;
  material_status: string;
  base_unit_id: string | number | null;
  base_uom: string;
  internal_unit_code: string | null;
  internal_unit_enabled: boolean | null;
  purchase_unit_id: string | number;
  purchase_unit_code: string;
  purchase_unit_enabled: boolean;
};

export class SupplierMappingService {
  readonly repository: SupplierMappingRepository;
  private readonly fault: SupplierMappingFaultInjector;

  constructor(repository: SupplierMappingRepository, fault: SupplierMappingFaultInjector = () => undefined) {
    this.repository = repository;
    this.fault = fault;
  }

  async list(input: Readonly<{
    page: number;
    pageSize: number;
    status?: string;
    mappingId?: string;
    supplierQuery?: string;
    materialQuery?: string;
    supplierPartNumber?: string;
  }>) {
    const status = String(input.status || "").toUpperCase();
    if (status && !LIST_STATUSES.has(status)) throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "Supplier Mapping 状态筛选无效");
    const values: unknown[] = [];
    const conditions: string[] = [];
    const addSearch = (raw: string | undefined, sql: (parameter: number) => string, field: string) => {
      const value = boundedText(raw, field, 100);
      if (!value) return;
      values.push(value);
      conditions.push(sql(values.length));
    };
    if (status) { values.push(status); conditions.push(`sm.status=$${values.length}`); }
    addSearch(input.mappingId, (parameter) => `sm.mapping_uid::text ilike '%'||$${parameter}||'%'`, "mapping_id");
    addSearch(input.supplierQuery, (parameter) => `(s.id::text=$${parameter} or s.supplier_code ilike '%'||$${parameter}||'%' or s.supplier_name ilike '%'||$${parameter}||'%')`, "supplier");
    addSearch(input.materialQuery, (parameter) => `(m.id::text=$${parameter} or m.internal_material_code ilike '%'||$${parameter}||'%' or m.standard_name ilike '%'||$${parameter}||'%')`, "material");
    addSearch(input.supplierPartNumber, (parameter) => `sm.supplier_item_code ilike '%'||$${parameter}||'%'`, "supplier_part_number");
    values.push(input.pageSize, (input.page - 1) * input.pageSize);
    const result = await this.repository.pool.query(`
      select sm.id mapping_version_id,sm.mapping_uid mapping_id,sm.mapping_version_no mapping_version,sm.version expected_version,
        sm.status,sm.material_id,m.internal_material_code,m.standard_name,m.material_status,
        sm.supplier_id,s.supplier_code,s.supplier_name,s.status supplier_status,
        sm.supplier_item_code supplier_part_number,sm.supplier_item_name,sm.supplier_specification,sm.manufacturer,sm.mpn,sm.revision,
        sm.purchase_unit_id,pu.code supplier_unit,bu.id internal_unit_id,bu.code internal_unit,
        sm.conversion_numerator::text,sm.conversion_denominator::text,sm.valid_from,sm.valid_to,
        sm.created_by,sm.created_at,sm.submitted_by,sm.submitted_at,sm.reviewed_by,sm.reviewed_at,sm.review_outcome,sm.review_reason,
        sm.created_request_id,sm.submitted_request_id,sm.reviewed_request_id,sm.request_id,
        coalesce(last_event.result,case when sm.submitted_at is null then 'LEGACY' else null end) result,
        last_event.event_type,last_event.actor event_actor,last_event.created_at event_at,last_event.request_id event_request_id,
        coalesce(active_stats.active_mapping_count,0)::integer active_mapping_count,
        coalesce(active_stats.active_conflict_count,0)::integer active_conflict_count,
        coalesce(part_stats.supplier_part_conflict_count,0)::integer supplier_part_conflict_count,
        approved_event.reason approval_comment,approved_event.actor approval_actor,
        approved_event.created_at approval_at,approved_event.request_id approval_request_id
      from supplier_mappings sm
      join suppliers s on s.id=sm.supplier_id
      join material_master m on m.id=sm.material_id
      join units pu on pu.id=sm.purchase_unit_id
      left join units bu on bu.enabled=true and (
        (m.base_unit_id is not null and bu.id=m.base_unit_id)
        or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(bu.code)=upper(btrim(m.base_uom)))
      )
      left join lateral (
        select e.result,e.event_type,e.actor,e.created_at,e.request_id
        from supplier_mapping_events e where e.mapping_version_id=sm.id order by e.id desc limit 1
      ) last_event on true
      left join lateral (
        select count(*) filter (where active.status='ACTIVE') active_mapping_count,
          count(*) filter (where active.status='ACTIVE'
            and active.id<>sm.id and active.mapping_uid<>sm.mapping_uid
            and sm.conversion_numerator=sm.conversion_denominator
            and active.conversion_numerator=active.conversion_denominator
            and tstzrange(active.valid_from,coalesce(active.valid_to,'infinity'::timestamptz),'[)')
              && tstzrange(sm.valid_from,coalesce(sm.valid_to,'infinity'::timestamptz),'[)')) active_conflict_count
        from supplier_mappings active
        where active.supplier_id=sm.supplier_id and active.material_id=sm.material_id
      ) active_stats on true
      left join lateral (
        select count(*) filter (where key.mapping_uid<>sm.mapping_uid) supplier_part_conflict_count
        from supplier_mapping_supplier_part_keys key
        where key.supplier_id=sm.supplier_id and key.normalized_supplier_item_code=sm.supplier_item_code_normalized
      ) part_stats on true
      left join lateral (
        select e.reason,e.actor,e.created_at,e.request_id
        from supplier_mapping_events e
        where e.mapping_version_id=sm.id and e.event_type='APPROVED'
        order by e.id desc limit 1
      ) approved_event on true
      ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
      order by sm.updated_at desc,sm.mapping_uid,sm.mapping_version_no desc
      limit $${values.length - 1} offset $${values.length}
    `, values);
    return {
      rows: result.rows.map((row) => this.dto(row)),
      pagination: { page: input.page, page_size: input.pageSize, returned: result.rowCount || 0 },
    };
  }

  async reviewPreview(mappingId: string, requestedExpectedVersion: number, actorUsername: string) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await client.query("set local statement_timeout='5s'");
      const row = rowData((await client.query<any>(`
        select sm.id mapping_version_id,sm.id,sm.mapping_uid mapping_id,sm.mapping_uid,
          sm.mapping_version_no mapping_version,sm.mapping_version_no,sm.version expected_version,sm.version,
          sm.status,sm.material_id,m.internal_material_code,m.standard_name,m.material_status,m.base_uom,
          sm.supplier_id,s.supplier_code,s.supplier_name,s.status supplier_status,
          sm.supplier_item_code supplier_part_number,sm.supplier_item_code,sm.supplier_item_code_normalized,
          sm.supplier_item_name,sm.supplier_specification,sm.manufacturer,sm.mpn,sm.revision,
          sm.purchase_unit_id,pu.code supplier_unit,pu.enabled supplier_unit_enabled,
          bu.id internal_unit_id,bu.code internal_unit,bu.enabled internal_unit_enabled,
          sm.conversion_numerator::text,sm.conversion_denominator::text,sm.valid_from,sm.valid_to,
          to_char(sm.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from_date,
          case when sm.valid_to is null then null else to_char(sm.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to_date,
          sm.content_digest,sm.created_by,sm.created_at,sm.created_request_id,
          sm.submitted_by,sm.submitted_at,sm.submitted_request_id,
          sm.reviewed_by,sm.reviewed_at,sm.reviewed_request_id,sm.review_outcome,sm.review_reason,
          created_event.actor created_actor,created_event.created_at created_event_at,
          created_event.request_id created_event_request_id,created_event.result created_result,
          submitted_event.actor submitted_actor,submitted_event.created_at submitted_event_at,
          submitted_event.request_id submitted_event_request_id,submitted_event.result submitted_result,
          approved_event.actor approval_actor,approved_event.created_at approval_at,
          approved_event.request_id approval_request_id,approved_event.result approval_result,
          approved_event.reason approval_comment,approved_event.old_version approval_old_cas,
          approved_event.new_version approval_new_cas,
          coalesce(active_stats.active_mapping_count,0)::integer active_mapping_count,
          coalesce(active_stats.active_conflict_count,0)::integer active_conflict_count,
          coalesce(part_stats.supplier_part_conflict_count,0)::integer supplier_part_conflict_count
        from supplier_mappings sm
        join suppliers s on s.id=sm.supplier_id
        join material_master m on m.id=sm.material_id
        join units pu on pu.id=sm.purchase_unit_id
        left join units bu on (
          (m.base_unit_id is not null and bu.id=m.base_unit_id)
          or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(bu.code)=upper(btrim(m.base_uom)))
        )
        left join lateral (
          select e.actor,e.created_at,e.request_id,e.result
          from supplier_mapping_events e
          where e.mapping_version_id=sm.id and e.event_type in ('CREATED','NEW_VERSION_CREATED')
          order by e.id limit 1
        ) created_event on true
        left join lateral (
          select e.actor,e.created_at,e.request_id,e.result
          from supplier_mapping_events e
          where e.mapping_version_id=sm.id and e.event_type='SUBMITTED'
          order by e.id desc limit 1
        ) submitted_event on true
        left join lateral (
          select e.actor,e.created_at,e.request_id,e.result,e.reason,a.old_version,a.new_version
          from supplier_mapping_events e
          left join lateral (
            select audit.old_version,audit.new_version
            from audit_log audit
            where audit.request_id=e.request_id and audit.action='SUPPLIER_MAPPING_APPROVED' and audit.result='success'
            order by audit.id desc limit 1
          ) a on true
          where e.mapping_version_id=sm.id and e.event_type='APPROVED'
          order by e.id desc limit 1
        ) approved_event on true
        left join lateral (
          select count(*) filter (where active.status='ACTIVE') active_mapping_count,
            count(*) filter (where active.status='ACTIVE'
              and active.id<>sm.id and active.mapping_uid<>sm.mapping_uid
              and sm.conversion_numerator=sm.conversion_denominator
              and active.conversion_numerator=active.conversion_denominator
              and tstzrange(active.valid_from,coalesce(active.valid_to,'infinity'::timestamptz),'[)')
                && tstzrange(sm.valid_from,coalesce(sm.valid_to,'infinity'::timestamptz),'[)')) active_conflict_count
          from supplier_mappings active
          where active.supplier_id=sm.supplier_id and active.material_id=sm.material_id
        ) active_stats on true
        left join lateral (
          select count(*) filter (where key.mapping_uid<>sm.mapping_uid) supplier_part_conflict_count
          from supplier_mapping_supplier_part_keys key
          where key.supplier_id=sm.supplier_id and key.normalized_supplier_item_code=sm.supplier_item_code_normalized
        ) part_stats on true
        where sm.mapping_uid=$1
        order by sm.mapping_version_no desc limit 1
      `, [mappingId])).rows, "MAPPING_NOT_FOUND", "Supplier Mapping 不存在");

      const issues: Array<{ code: string; message: string; suggestion: string }> = [];
      const issue = (code: string, message: string, suggestion: string) => issues.push({ code, message, suggestion });
      if (row.status !== "PENDING_REVIEW") issue("MAPPING_NOT_PENDING_REVIEW", "当前状态不是 PENDING_REVIEW", "返回列表并重新选择待审核 Mapping；ACTIVE 只能查看历史凭证。");
      if (Number(row.version) !== requestedExpectedVersion) issue("VERSION_CONFLICT", "页面 CAS 已过期", "刷新审核预览后再决定，禁止沿用旧页面确认。");
      if (row.created_by === actorUsername) issue("SELF_REVIEW_FORBIDDEN", "创建人不能审核自己创建的 Supplier Mapping", "由另一名具有 operations 审核权限的人员处理。");
      if (row.supplier_status !== "ACTIVE") issue("SUPPLIER_NOT_ACTIVE", "Supplier 当前不是 ACTIVE", "先由主数据责任人恢复或更正 Supplier 状态，再重新提交。");
      if (row.material_status !== "ACTIVE" || !FORMAL_MATERIAL_CODE.test(String(row.internal_material_code))) {
        issue("MATERIAL_NOT_FORMAL_ACTIVE", "Material 当前不是正式 ACTIVE 物料", "先完成物料正式编码及 ACTIVE 状态治理，再重新提交。");
      }
      if (!row.supplier_unit_enabled) issue("SUPPLIER_UNIT_NOT_ACTIVE", "Supplier Unit 当前未启用", "选择启用单位并由采购建立受控新版本。");
      if (!row.internal_unit_id || !row.internal_unit_enabled
        || String(row.base_uom || "").trim().toUpperCase() !== String(row.internal_unit || "").trim().toUpperCase()) {
        issue("MATERIAL_BASE_UNIT_INVALID", "Material 主单位当前不完整或不一致", "先修复 Material 主单位，再重新读取审核预览。");
      }
      if (!row.created_actor || row.created_result !== "SUCCESS" || !row.submitted_actor || row.submitted_result !== "SUCCESS") {
        issue("MAPPING_LIFECYCLE_INCOMPLETE", "创建或提交成功事实不完整", "停止审核并由管理员核对不可变事件与审计记录。");
      }
      if (!String(row.supplier_item_code || "").trim() || !row.content_digest
        || canonicalDigest(this.contentFromRow(row)) !== row.content_digest) {
        issue("MAPPING_CONTENT_DIGEST_MISMATCH", "提交正文不完整或摘要不一致", "由采购重新建立受控版本，禁止批准当前事实。");
      }
      if (Number(row.active_conflict_count) > 0) {
        issue("SUPPLIER_MAPPING_ACTIVE_CONFLICT", "有效期内存在其他 ACTIVE 1:1 Supplier/Material Mapping", "先处置 ACTIVE 冲突，再重新读取审核预览。");
      }
      if (Number(row.supplier_part_conflict_count) > 0) {
        issue("SUPPLIER_PART_NUMBER_CONFLICT", "supplier_part_number 已由另一稳定 Mapping 占用", "由采购核对稳定占用关系并更正冲突。");
      }

      const reference: ReferenceRow = {
        supplier_id: row.supplier_id,
        supplier_code: row.supplier_code,
        supplier_name: row.supplier_name,
        supplier_status: row.supplier_status,
        material_id: row.material_id,
        internal_material_code: row.internal_material_code,
        standard_name: row.standard_name,
        material_status: row.material_status,
        base_unit_id: row.internal_unit_id,
        base_uom: row.base_uom,
        internal_unit_code: row.internal_unit,
        internal_unit_enabled: row.internal_unit_enabled,
        purchase_unit_id: row.purchase_unit_id,
        purchase_unit_code: row.supplier_unit,
        purchase_unit_enabled: row.supplier_unit_enabled,
      };
      const approvalReceipt = row.approval_request_id ? this.approvalReceipt({
        row,
        reference,
        actor: String(row.approval_actor),
        occurredAt: String(row.approval_at),
        requestId: String(row.approval_request_id),
        result: String(row.approval_result),
        reviewComment: String(row.approval_comment || ""),
        beforeCas: row.approval_old_cas == null ? null : Number(row.approval_old_cas),
        afterCas: row.approval_new_cas == null ? null : Number(row.approval_new_cas),
      }) : null;
      const oneToOne = Number(row.conversion_numerator) === Number(row.conversion_denominator);
      const result = {
        mapping: {
          mapping_version_id: Number(row.id), mapping_id: String(row.mapping_uid),
          mapping_version: Number(row.mapping_version_no), expected_version: Number(row.version), status: String(row.status),
          supplier: { id: Number(row.supplier_id), code: row.supplier_code, name: row.supplier_name, status: row.supplier_status },
          material: { id: Number(row.material_id), code: row.internal_material_code, name: row.standard_name, status: row.material_status },
          supplier_part_number: row.supplier_item_code,
          units: { supplier: row.supplier_unit, internal: row.internal_unit },
          conversion: { numerator: String(row.conversion_numerator), denominator: String(row.conversion_denominator) },
          validity: { valid_from: row.valid_from, valid_to: row.valid_to },
        },
        lifecycle: {
          created: { actor: row.created_actor, occurred_at: row.created_event_at, request_id: row.created_event_request_id, result: row.created_result },
          submitted: { actor: row.submitted_actor, occurred_at: row.submitted_event_at, request_id: row.submitted_event_request_id, result: row.submitted_result },
        },
        conflicts: {
          active_mapping_count: Number(row.active_mapping_count),
          active_conflict_count: Number(row.active_conflict_count),
          supplier_part_conflict_count: Number(row.supplier_part_conflict_count),
        },
        approval_conditions: { can_approve: issues.length === 0, issues },
        approval_projection: {
          before: { mapping_version: Number(row.mapping_version_no), cas: Number(row.version) },
          after: { mapping_version: Number(row.mapping_version_no), cas: Number(row.version) + 1 },
          final_status: "ACTIVE",
          rfq_coverage_eligible_after_approval: oneToOne,
          rfq_coverage_note: oneToOne ? "批准后可作为 RFQ 当前有效 1:1 Mapping 参与覆盖校验" : "非 1:1 Mapping 不计入 RFQ 完整覆盖",
          creates_downstream: { rfq: false, quote: false, award: false, purchase_order: false },
        },
        approval_receipt: approvalReceipt,
      };
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async referenceOptions(kind: string, query: string, limit: number) {
    const q = boundedText(query, "q", 80);
    if (kind === "supplier") {
      const result = await this.repository.pool.query(`
        select id,supplier_code code,supplier_name name,status
        from suppliers where status='ACTIVE' and ($1='' or id::text=$1 or supplier_code ilike $1||'%' or supplier_name ilike '%'||$1||'%')
        order by case when id::text=$1 or upper(supplier_code)=upper($1) then 0 when supplier_code ilike $1||'%' then 1 else 2 end,supplier_code,id limit $2
      `, [q, limit]);
      return result.rows.map((row) => ({ id: Number(row.id), code: row.code, name: row.name, status: row.status }));
    }
    if (kind === "material") {
      const result = await this.repository.pool.query(`
        select m.id,m.internal_material_code code,m.standard_name name,m.material_status status,coalesce(m.base_unit_id,u.id) base_unit_id,u.code base_unit
        from material_master m join units u on u.enabled=true and (
          (m.base_unit_id is not null and u.id=m.base_unit_id)
          or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(u.code)=upper(btrim(m.base_uom)))
        )
        where m.material_status='ACTIVE' and m.internal_material_code ~ '^CYD-[A-Z0-9_]+-[0-9]{6}$'
          and ($1='' or m.id::text=$1 or m.internal_material_code ilike $1||'%' or m.standard_name ilike '%'||$1||'%')
        order by case when m.id::text=$1 or upper(m.internal_material_code)=upper($1) then 0 when m.internal_material_code ilike $1||'%' then 1 else 2 end,m.internal_material_code,m.id limit $2
      `, [q, limit]);
      return result.rows.map((row) => ({ id: Number(row.id), code: row.code, name: row.name, status: row.status, base_unit_id: Number(row.base_unit_id), base_unit: row.base_unit }));
    }
    if (kind === "unit") {
      const result = await this.repository.pool.query(`
        select id,code,name,enabled status from units
        where enabled=true and ($1='' or id::text=$1 or code ilike $1||'%' or name ilike '%'||$1||'%')
        order by case when id::text=$1 or upper(code)=upper($1) then 0 when code ilike $1||'%' then 1 else 2 end,code,id limit $2
      `, [q, limit]);
      return result.rows.map((row) => ({ id: Number(row.id), code: row.code, name: row.name, status: row.status }));
    }
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "option type 必须是 supplier、material 或 unit");
  }

  async create(meta: SupplierMappingMutationMeta, input: Record<string, unknown>) {
    const parsed = parseDraftInput(input);
    return this.repository.execute(meta, async (client) => {
      const reference = await this.validateReferences(client, parsed);
      const uid = randomUUID();
      await this.lockIdentity(client, parsed);
      await this.claimSupplierPart(client, parsed, uid, meta);
      const result = await client.query<any>(`
        insert into supplier_mappings(
          mapping_uid,mapping_version_no,material_id,supplier_id,supplier_name,supplier_key,
          supplier_item_code,supplier_item_code_normalized,supplier_item_name,supplier_specification,manufacturer,mpn,revision,
          purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,valid_to,
          created_by,updated_by,created_request_id,request_id
        ) values($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'DRAFT',$17,$18,$19,$19,$20,$20)
        returning *
      `, [
        uid, parsed.materialId, parsed.supplierId, reference.supplier_name, reference.supplier_code,
        parsed.supplierItemCode, parsed.normalizedSupplierItemCode, parsed.supplierItemName, parsed.supplierSpecification,
        parsed.manufacturer, parsed.mpn, parsed.revision, reference.purchase_unit_code, parsed.purchaseUnitId,
        parsed.conversionNumerator, parsed.conversionDenominator, shanghaiBoundary(parsed.validFrom),
        parsed.validTo ? shanghaiBoundary(parsed.validTo) : null, meta.actor.username, meta.requestId,
      ]);
      const row = result.rows[0];
      await this.event(client, row, null, "DRAFT", "CREATED", meta, "");
      this.fault("after_mapping_draft_created");
      return this.success(row, meta, 201, undefined, 1);
    });
  }

  async editDraft(mappingId: string, meta: SupplierMappingMutationMeta, input: Record<string, unknown>) {
    exactKeys(input, ["expected_version", ...parseDraftKeys]);
    const expected = expectedVersion(input.expected_version);
    const draftInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "expected_version"));
    const parsed = parseDraftInput(draftInput);
    return this.repository.execute(meta, async (client) => {
      const current = await this.lockLatest(client, mappingId);
      this.requireDraftOwner(current, meta, expected);
      if (Number(current.supplier_id) !== parsed.supplierId
        || String(current.supplier_item_code_normalized) !== parsed.normalizedSupplierItemCode) {
        throw new SupplierMappingError(
          "MAPPING_IDENTITY_IMMUTABLE",
          "稳定 Mapping 的 Supplier 与 supplier_part_number 创建后不可变；请另建 Mapping",
          409,
        );
      }
      const reference = await this.validateReferences(client, parsed);
      await this.lockIdentity(client, parsed);
      await this.claimSupplierPart(client, parsed, mappingId, meta);
      const updated = rowData((await client.query<any>(`
        update supplier_mappings set material_id=$3,supplier_id=$4,supplier_name=$5,supplier_key=$6,
          supplier_item_code=$7,supplier_item_code_normalized=$8,supplier_item_name=$9,supplier_specification=$10,
          manufacturer=$11,mpn=$12,revision=$13,purchase_uom=$14,purchase_unit_id=$15,
          conversion_numerator=$16,conversion_denominator=$17,valid_from=$18,valid_to=$19,
          version=version+1,updated_by=$20,updated_at=now(),request_id=$21
        where id=$1 and version=$2 returning *
      `, [
        current.id, expected, parsed.materialId, parsed.supplierId, reference.supplier_name, reference.supplier_code,
        parsed.supplierItemCode, parsed.normalizedSupplierItemCode, parsed.supplierItemName, parsed.supplierSpecification,
        parsed.manufacturer, parsed.mpn, parsed.revision, reference.purchase_unit_code, parsed.purchaseUnitId,
        parsed.conversionNumerator, parsed.conversionDenominator, shanghaiBoundary(parsed.validFrom),
        parsed.validTo ? shanghaiBoundary(parsed.validTo) : null, meta.actor.username, meta.requestId,
      ])).rows, "VERSION_CONFLICT", "草稿版本已变化，请刷新后重试", 409);
      await this.event(client, updated, "DRAFT", "DRAFT", "DRAFT_EDITED", meta, "");
      this.fault("after_mapping_draft_edited");
      return this.success(updated, meta, 200, expected, expected + 1);
    });
  }

  async submit(mappingId: string, meta: SupplierMappingMutationMeta, input: Record<string, unknown>) {
    exactKeys(input, ["expected_version"]);
    const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const current = await this.lockLatest(client, mappingId);
      this.requireDraftOwner(current, meta, expected);
      await this.validateReferences(client, this.inputFromRow(current));
      const digest = canonicalDigest(this.contentFromRow(current));
      const updated = rowData((await client.query<any>(`
        update supplier_mappings set status='PENDING_REVIEW',content_digest=$3,submitted_by=$4,submitted_at=now(),submitted_request_id=$5,
          version=version+1,updated_by=$4,updated_at=now(),request_id=$5
        where id=$1 and version=$2 returning *
      `, [current.id, expected, digest, meta.actor.username, meta.requestId])).rows, "VERSION_CONFLICT", "草稿版本已变化，请刷新后重试", 409);
      await this.event(client, updated, "DRAFT", "PENDING_REVIEW", "SUBMITTED", meta, "");
      this.fault("after_mapping_submitted");
      return this.success(updated, meta, 200, expected, expected + 1);
    });
  }

  async review(mappingId: string, decision: "APPROVE" | "REJECT", meta: SupplierMappingMutationMeta, input: Record<string, unknown>) {
    const expected = expectedVersion(input.expected_version);
    exactKeys(input, decision === "APPROVE" ? ["expected_version", "review_comment"] : ["expected_version", "reason"]);
    const reason = decision === "APPROVE"
      ? boundedExactText(input.review_comment, "审核意见", 500, true)
      : boundedText(input.reason, "退回原因", 500, true);
    return this.repository.execute(meta, async (client) => {
      const current = await this.lockLatest(client, mappingId);
      if (Number(current.version) !== expected) throw new SupplierMappingError("VERSION_CONFLICT", "待审核 Mapping 版本已变化，请刷新后重试", 409);
      if (current.status !== "PENDING_REVIEW") throw new SupplierMappingError("MAPPING_NOT_PENDING_REVIEW", "只有 PENDING_REVIEW Mapping 可以审核", 409);
      if (current.created_by === meta.actor.username) throw new SupplierMappingError("SELF_REVIEW_FORBIDDEN", "创建人不能审核自己创建的 Supplier Mapping", 403);
      const parsed = this.inputFromRow(current);
      const reference = await this.validateReferences(client, parsed);
      await this.lockIdentity(client, parsed);
      if (decision === "APPROVE") await this.assertApprovalConflicts(client, current);
      if (canonicalDigest(this.contentFromRow(current)) !== current.content_digest) {
        throw new SupplierMappingError("MAPPING_CONTENT_DIGEST_MISMATCH", "提交后的 Mapping 正文摘要不一致，已拒绝审核", 409);
      }

      if (decision === "APPROVE") {
        const active = await client.query<any>("select * from supplier_mappings where mapping_uid=$1 and status='ACTIVE' and id<>$2 order by mapping_version_no desc for update", [mappingId, current.id]);
        for (const prior of active.rows) {
          const superseded = rowData((await client.query<any>(`
            update supplier_mappings set status='INACTIVE',superseded_by_mapping_version_id=$2,
              version=version+1,updated_by=$3,updated_at=now(),request_id=$4 where id=$1 returning *
          `, [prior.id, current.id, meta.actor.username, meta.requestId])).rows, "VERSION_CONFLICT", "旧 ACTIVE Mapping 已变化", 409);
          await this.event(client, superseded, "ACTIVE", "INACTIVE", "SUPERSEDED", meta, "");
        }
      }

      const nextStatus = decision === "APPROVE" ? "ACTIVE" : "REJECTED";
      const outcome = decision === "APPROVE" ? "APPROVED" : "REJECTED";
      const storedReviewReason = decision === "REJECT" ? reason : "";
      const updated = rowData((await client.query<any>(`
        update supplier_mappings set status=$3,reviewed_by=$4,reviewed_at=now(),reviewed_request_id=$5,
          review_outcome=$6,review_reason=$7,version=version+1,updated_by=$4,updated_at=now(),request_id=$5
        where id=$1 and version=$2 returning *
      `, [current.id, expected, nextStatus, meta.actor.username, meta.requestId, outcome, storedReviewReason])).rows, "VERSION_CONFLICT", "待审核 Mapping 版本已变化，请刷新后重试", 409);
      const reviewEvent = await this.event(client, updated, "PENDING_REVIEW", nextStatus, decision === "APPROVE" ? "APPROVED" : "REJECTED", meta, reason);
      this.fault("after_mapping_reviewed");
      const result = this.success(updated, meta, 200, expected, expected + 1);
      if (decision === "APPROVE") {
        result.body.approval_receipt = this.approvalReceipt({
          row: updated,
          reference,
          actor: String(reviewEvent.actor),
          occurredAt: String(reviewEvent.created_at),
          requestId: String(reviewEvent.request_id),
          result: String(reviewEvent.result),
          reviewComment: reason,
          beforeCas: expected,
          afterCas: expected + 1,
        });
      }
      return result;
    });
  }

  async newVersion(mappingId: string, meta: SupplierMappingMutationMeta, input: Record<string, unknown>) {
    exactKeys(input, ["expected_version"]);
    const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const current = await this.lockLatest(client, mappingId);
      if (Number(current.version) !== expected) throw new SupplierMappingError("VERSION_CONFLICT", "Mapping 版本已变化，请刷新后重试", 409);
      if (!["ACTIVE", "REJECTED"].includes(current.status)) throw new SupplierMappingError("MAPPING_NEW_VERSION_NOT_ALLOWED", "只有 ACTIVE 或 REJECTED Mapping 可以创建新版本", 409);
      const parsed = this.inputFromRow(current);
      const reference = await this.validateReferences(client, parsed);
      await this.lockIdentity(client, parsed);
      await this.claimSupplierPart(client, parsed, mappingId, meta);
      const nextVersion = Number(current.mapping_version_no) + 1;
      const created = rowData((await client.query<any>(`
        insert into supplier_mappings(
          mapping_uid,mapping_version_no,supersedes_mapping_version_id,material_id,supplier_id,supplier_name,supplier_key,
          supplier_item_code,supplier_item_code_normalized,supplier_item_name,supplier_specification,manufacturer,mpn,revision,
          purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,valid_to,
          created_by,updated_by,created_request_id,request_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'DRAFT',$19,$20,$21,$21,$22,$22)
        returning *
      `, [
        mappingId, nextVersion, current.id, parsed.materialId, parsed.supplierId, reference.supplier_name, reference.supplier_code,
        parsed.supplierItemCode, parsed.normalizedSupplierItemCode, parsed.supplierItemName, parsed.supplierSpecification,
        parsed.manufacturer, parsed.mpn, parsed.revision, reference.purchase_unit_code, parsed.purchaseUnitId,
        parsed.conversionNumerator, parsed.conversionDenominator, shanghaiBoundary(parsed.validFrom),
        parsed.validTo ? shanghaiBoundary(parsed.validTo) : null, meta.actor.username, meta.requestId,
      ])).rows, "SUPPLIER_MAPPING_CONFLICT", "Mapping 新版本已由另一请求创建", 409);
      await this.event(client, created, current.status, "DRAFT", "NEW_VERSION_CREATED", meta, "");
      this.fault("after_mapping_new_version_created");
      return this.success(created, meta, 201, undefined, 1);
    });
  }

  private dto(row: any) {
    return {
      ...row,
      mapping_version_id: Number(row.mapping_version_id ?? row.id),
      mapping_id: String(row.mapping_id ?? row.mapping_uid),
      mapping_version: Number(row.mapping_version ?? row.mapping_version_no),
      expected_version: Number(row.expected_version ?? row.version),
      supplier_id: Number(row.supplier_id), material_id: Number(row.material_id),
      purchase_unit_id: Number(row.purchase_unit_id), internal_unit_id: row.internal_unit_id == null ? null : Number(row.internal_unit_id),
      active_mapping_count: Number(row.active_mapping_count || 0),
      active_conflict_count: Number(row.active_conflict_count || 0),
      supplier_part_conflict_count: Number(row.supplier_part_conflict_count || 0),
      request_id: String(row.request_id), result: row.result || "SUCCESS",
    };
  }

  private async lockLatest(client: PoolClient, mappingId: string) {
    const result = await client.query<any>(`
      select sm.*,
        to_char(sm.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from_date,
        case when sm.valid_to is null then null else to_char(sm.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to_date
      from supplier_mappings sm where sm.mapping_uid=$1 order by sm.mapping_version_no desc limit 1 for update
    `, [mappingId]);
    return rowData(result.rows, "MAPPING_NOT_FOUND", "Supplier Mapping 不存在");
  }

  private requireDraftOwner(current: any, meta: SupplierMappingMutationMeta, expected: number) {
    if (Number(current.version) !== expected) throw new SupplierMappingError("VERSION_CONFLICT", "草稿版本已变化，请刷新后重试", 409);
    if (current.status !== "DRAFT") throw new SupplierMappingError("MAPPING_NOT_DRAFT", "只有 DRAFT Mapping 可以修改或提交", 409);
    if (current.created_by !== meta.actor.username) throw new SupplierMappingError("DRAFT_OWNER_REQUIRED", "只有草稿创建人可以修改或提交", 403);
  }

  private async validateReferences(client: PoolClient, input: SupplierMappingDraftInput): Promise<ReferenceRow> {
    const result = await client.query<ReferenceRow>(`
      select s.id supplier_id,s.supplier_code,s.supplier_name,s.status supplier_status,
        m.id material_id,m.internal_material_code,m.standard_name,m.material_status,coalesce(m.base_unit_id,bu.id) base_unit_id,m.base_uom,
        bu.code internal_unit_code,bu.enabled internal_unit_enabled,
        pu.id purchase_unit_id,pu.code purchase_unit_code,pu.enabled purchase_unit_enabled
      from suppliers s cross join material_master m cross join units pu
      left join units bu on bu.enabled=true and (
        (m.base_unit_id is not null and bu.id=m.base_unit_id)
        or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(bu.code)=upper(btrim(m.base_uom)))
      )
      where s.id=$1 and m.id=$2 and pu.id=$3
    `, [input.supplierId, input.materialId, input.purchaseUnitId]);
    const reference = rowData(result.rows, "MAPPING_REFERENCE_NOT_FOUND", "供应商、物料或单位不存在", 422);
    if (reference.supplier_status !== "ACTIVE") throw new SupplierMappingError("SUPPLIER_NOT_ACTIVE", "Supplier 必须为 ACTIVE", 422);
    if (reference.material_status !== "ACTIVE" || !FORMAL_MATERIAL_CODE.test(reference.internal_material_code)) {
      throw new SupplierMappingError("MATERIAL_NOT_FORMAL_ACTIVE", "Material 必须为 ACTIVE 且具有正式内部编码", 422);
    }
    if (!reference.base_unit_id || !reference.internal_unit_enabled
      || String(reference.base_uom || "").trim().toUpperCase() !== String(reference.internal_unit_code || "").trim().toUpperCase()) {
      throw new SupplierMappingError("MATERIAL_BASE_UNIT_INVALID", "Material 必须具有一致且启用的主单位", 422);
    }
    if (!reference.purchase_unit_enabled) throw new SupplierMappingError("SUPPLIER_UNIT_NOT_ACTIVE", "Supplier Unit 必须为启用单位", 422);
    return reference;
  }

  private async lockIdentity(client: PoolClient, input: SupplierMappingDraftInput) {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`supplier-part:${input.supplierId}:${input.normalizedSupplierItemCode}`]);
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`supplier-material:${input.supplierId}:${input.materialId}`]);
  }

  private async assertApprovalConflicts(client: PoolClient, current: any) {
    const claim = await client.query<{ mapping_uid: string }>(`
      select mapping_uid from supplier_mapping_supplier_part_keys
      where supplier_id=$1 and normalized_supplier_item_code=$2 for update
    `, [current.supplier_id, current.supplier_item_code_normalized]);
    if (!claim.rows[0] || claim.rows[0].mapping_uid !== current.mapping_uid) {
      throw new SupplierMappingError(
        "SUPPLIER_PART_NUMBER_CONFLICT",
        "该供应商料号的稳定占用事实已变化，请由采购核对后重新提交",
        409,
      );
    }
    if (Number(current.conversion_numerator) !== Number(current.conversion_denominator)) return;
    const active = await client.query<{ id: string | number }>(`
      select id from supplier_mappings
      where status='ACTIVE' and supplier_id=$1 and material_id=$2
        and id<>$3 and mapping_uid<>$4
        and conversion_numerator=conversion_denominator
        and tstzrange(valid_from,coalesce(valid_to,'infinity'::timestamptz),'[)')
          && tstzrange($5::timestamptz,coalesce($6::timestamptz,'infinity'::timestamptz),'[)')
      order by id for update
    `, [current.supplier_id, current.material_id, current.id, current.mapping_uid, current.valid_from, current.valid_to]);
    if (active.rows[0]) {
      throw new SupplierMappingError(
        "SUPPLIER_MAPPING_ACTIVE_CONFLICT",
        "该 Supplier/Material 有效期内已存在其他 ACTIVE 1:1 Mapping，请先处理冲突",
        409,
      );
    }
  }

  private async claimSupplierPart(client: PoolClient, input: SupplierMappingDraftInput, uid: string, meta: SupplierMappingMutationMeta) {
    const existing = await client.query<{ mapping_uid: string }>(`
      select mapping_uid from supplier_mapping_supplier_part_keys
      where supplier_id=$1 and normalized_supplier_item_code=$2 for update
    `, [input.supplierId, input.normalizedSupplierItemCode]);
    if (existing.rows[0] && existing.rows[0].mapping_uid !== uid) {
      throw new SupplierMappingError("SUPPLIER_PART_NUMBER_CONFLICT", "该供应商料号已由另一条 Supplier Mapping 占用", 409);
    }
    if (!existing.rows[0]) {
      await client.query(`
        insert into supplier_mapping_supplier_part_keys(supplier_id,normalized_supplier_item_code,mapping_uid,created_by,request_id)
        values($1,$2,$3,$4,$5)
      `, [input.supplierId, input.normalizedSupplierItemCode, uid, meta.actor.username, meta.requestId]);
    }
  }

  private inputFromRow(row: any): SupplierMappingDraftInput {
    return {
      supplierId: Number(row.supplier_id), materialId: Number(row.material_id),
      supplierItemCode: String(row.supplier_item_code), normalizedSupplierItemCode: String(row.supplier_item_code_normalized),
      supplierItemName: String(row.supplier_item_name), supplierSpecification: String(row.supplier_specification),
      manufacturer: String(row.manufacturer), mpn: String(row.mpn), revision: String(row.revision),
      purchaseUnitId: Number(row.purchase_unit_id), conversionNumerator: Number(row.conversion_numerator),
      conversionDenominator: Number(row.conversion_denominator), validFrom: String(row.valid_from_date),
      validTo: row.valid_to_date == null ? null : String(row.valid_to_date),
    };
  }

  private contentFromRow(row: any) {
    const input = this.inputFromRow(row);
    return {
      supplier_id: input.supplierId, material_id: input.materialId, supplier_item_code: input.supplierItemCode,
      supplier_item_code_normalized: input.normalizedSupplierItemCode, supplier_item_name: input.supplierItemName,
      supplier_specification: input.supplierSpecification, manufacturer: input.manufacturer, mpn: input.mpn,
      revision: input.revision, purchase_unit_id: input.purchaseUnitId,
      conversion_numerator: input.conversionNumerator, conversion_denominator: input.conversionDenominator,
      valid_from: input.validFrom, valid_to: input.validTo,
    };
  }

  private approvalReceipt(input: Readonly<{
    row: any;
    reference: ReferenceRow;
    actor: string;
    occurredAt: string;
    requestId: string;
    result: string;
    reviewComment: string;
    beforeCas: number | null;
    afterCas: number | null;
  }>) {
    const { row, reference } = input;
    return {
      mapping_id: String(row.mapping_uid),
      mapping_version_id: Number(row.id),
      decision: "APPROVE",
      actor: input.actor,
      occurred_at: new Date(input.occurredAt).toISOString(),
      request_id: input.requestId,
      result: input.result,
      review_comment: input.reviewComment || null,
      review_comment_display: input.reviewComment || "历史批准未采集审核意见",
      historical_comment_missing: !input.reviewComment,
      before: { mapping_version: Number(row.mapping_version_no), cas: input.beforeCas },
      after: { mapping_version: Number(row.mapping_version_no), cas: input.afterCas },
      final_status: "ACTIVE",
      supplier: {
        id: Number(row.supplier_id),
        code: reference.supplier_code,
        name: reference.supplier_name,
      },
      material: {
        id: Number(row.material_id),
        code: reference.internal_material_code,
        name: reference.standard_name,
      },
      supplier_part_number: String(row.supplier_item_code),
      units: {
        supplier: reference.purchase_unit_code,
        internal: reference.internal_unit_code,
      },
      conversion: {
        numerator: String(row.conversion_numerator),
        denominator: String(row.conversion_denominator),
      },
      validity: { valid_from: row.valid_from, valid_to: row.valid_to },
    };
  }

  private async event(
    client: PoolClient,
    row: any,
    fromStatus: string | null,
    toStatus: string,
    eventType: string,
    meta: SupplierMappingMutationMeta,
    reason: string,
  ) {
    const inserted = await client.query<any>(`
      insert into supplier_mapping_events(mapping_uid,mapping_version_id,mapping_version_no,event_type,from_status,to_status,actor,reason,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning actor,result,reason,request_id,created_at
    `, [row.mapping_uid, row.id, row.mapping_version_no, eventType, fromStatus, toStatus, meta.actor.username, reason, meta.requestId]);
    return inserted.rows[0];
  }

  private success(row: any, meta: SupplierMappingMutationMeta, status: number, oldVersion?: number, newVersion?: number): SupplierMappingWorkResult {
    const body = {
      ok: true,
      mapping_id: String(row.mapping_uid),
      mapping_version_id: Number(row.id),
      mapping_version: Number(row.mapping_version_no),
      status: String(row.status),
      expected_version: Number(row.version),
      actor: meta.actor.username,
      occurred_at: new Date(String(row.updated_at)).toISOString(),
      request_id: meta.requestId,
      result: "SUCCESS",
    };
    return {
      status, body, mappingUid: body.mapping_id, mappingVersionId: body.mapping_version_id,
      oldVersion, newVersion, safeDetail: { status: body.status, mapping_version: body.mapping_version },
    };
  }
}

const parseDraftKeys = [
  "supplier_id", "material_id", "supplier_item_code", "supplier_item_name", "supplier_specification",
  "manufacturer", "mpn", "revision", "purchase_unit_id", "conversion_numerator",
  "conversion_denominator", "valid_from", "valid_to",
] as const;
