import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { PlanningHandoffError } from "./errors.ts";
import { PlanningHandoffRepository } from "./repository.ts";
import type { PlanningMutationMeta, PlanningMutationResult, ResolutionInput } from "./types.ts";
import { assertOnlyKeys, boundedText, canonicalDigest, expectedVersion, optionalDate, resolutionInput, revisionResponseInput, successorPackageInput, unitResolutionInput } from "./validation.ts";

type ProjectRow = Record<string, unknown> & { id: string; status: string; version: number; project_owner: string | null; current_requirement_version_no: number; requirement_version_id: string; customer_id: string };
type PackageRow = Record<string, unknown> & { id: string; project_id: string; requirement_version_id: string; package_version_no: number; status: string; version: number; prepared_by: string; submitted_by: string | null; project_owner: string | null };
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);

export class PlanningHandoffService {
  readonly repository: PlanningHandoffRepository;
  readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: PlanningHandoffRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  private assertEngineeringOwner(actor: IdentityActor, project: Pick<ProjectRow, "project_owner">) {
    if (["admin", "manager"].includes(actor.role) || actor.permissions.includes("*")) return;
    if (actor.role !== "engineering" || project.project_owner !== actor.username) throw new PlanningHandoffError("PROJECT_OWNER_REQUIRED", "只有该项目负责人可以准备或提交计划交接", 403);
  }

  private assertPlanningDecision(actor: IdentityActor) {
    if (!allowed(actor, "planning.accept")) throw new PlanningHandoffError("PERMISSION_DENIED", "只有计划员或获准管理人员可以接收或退回", 403);
  }

  private async acceptedProject(client: PoolClient, projectId: number, lock = false): Promise<ProjectRow> {
    const result = await client.query<ProjectRow>(`select p.*,rv.id requirement_version_id from business_projects p join project_requirement_versions rv on rv.project_id=p.id and rv.version_no=p.current_requirement_version_no where p.id=$1 ${lock ? "for update of p" : ""}`, [projectId]);
    const project = result.rows[0]; if (!project) throw new PlanningHandoffError("PROJECT_NOT_FOUND", "项目不存在", 404);
    if (project.status !== "ACCEPTED" || !project.project_owner) throw new PlanningHandoffError("PROJECT_NOT_ACCEPTED", "只有项目部已接收的项目可以准备计划交接", 409);
    return project;
  }

  async resolutions(actor: IdentityActor, projectId: number) {
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403);
    const client = await this.repository.pool.connect();
    try {
      const project = await this.acceptedProject(client, projectId); if (actor.role === "engineering" && project.project_owner !== actor.username) throw new PlanningHandoffError("PROJECT_NOT_FOUND", "项目不存在", 404);
      const rows = await client.query(`select ri.id requirement_item_id,ri.line_no,ri.provisional_name,ri.quantity::text,ri.unit_id,ri.unit_id source_unit_id,ri.unit_pending,ri.unit_pending source_unit_pending,ri.specification_requirement,su.code unit_code,su.code source_unit_code,
        r.id resolution_id,r.product_id,r.product_version_id,r.bom_header_id,r.bom_version_id,r.resolved_by,r.resolved_at,
        p.product_code,p.product_name,pv.version_code product_version_code,bh.bom_code,bv.version_code bom_version_code,
        ur.id unit_resolution_id,ur.resolution_version_no unit_resolution_version_no,uh.version unit_resolution_head_version,ur.source_type unit_resolution_source_type,
        ur.unit_id resolved_unit_id,ru.code resolved_unit_code,ru.name resolved_unit_name,ru.enabled resolved_unit_enabled
        from project_requirement_items ri left join units su on su.id=ri.unit_id left join project_requirement_resolutions r on r.requirement_item_id=ri.id
        left join products p on p.id=r.product_id left join product_versions pv on pv.id=r.product_version_id left join bom_headers bh on bh.id=r.bom_header_id left join bom_versions bv on bv.id=r.bom_version_id
        left join project_requirement_unit_resolution_heads uh on uh.requirement_item_id=ri.id
        left join project_requirement_unit_resolution_versions ur on ur.id=uh.current_resolution_id and ur.requirement_item_id=ri.id
        left join units ru on ru.id=ur.unit_id
        where ri.requirement_version_id=$1 order by ri.line_no`, [Number(project.requirement_version_id)]);
      const enabledUnits = await client.query("select id,code,name,symbol from units where enabled=true order by code,id");
      const candidates = await client.query(`select p.id product_id,p.product_code,p.product_name,pv.id product_version_id,pv.version_code product_version_code,pv.product_type,pv.lifecycle_status,
        bh.id bom_header_id,bh.bom_code,bv.id bom_version_id,bv.version_code bom_version_code,count(bl.id)::int bom_line_count
        from products p join product_versions pv on pv.product_id=p.id and pv.status='RELEASED'
        join bom_headers bh on bh.product_id=p.id and bh.status='ACTIVE' join bom_versions bv on bv.bom_header_id=bh.id and bv.product_version_id=pv.id and bv.status='RELEASED'
        join bom_lines bl on bl.bom_version_id=bv.id join material_master m on m.id=bl.material_id and m.material_status='ACTIVE' join units u on u.id=bl.unit_id and u.enabled=true
        where p.status='ACTIVE' and p.customer_id=$1 and p.customer_id is not null
        and not exists(select 1 from bom_lines x left join material_master xm on xm.id=x.material_id left join units xu on xu.id=x.unit_id where x.bom_version_id=bv.id and (xm.id is null or xm.material_status<>'ACTIVE' or xu.id is null or xu.enabled=false))
        group by p.id,p.product_code,p.product_name,pv.id,pv.version_code,pv.product_type,pv.lifecycle_status,bh.id,bh.bom_code,bv.id,bv.version_code order by p.product_code,pv.version_no,bh.bom_code,bv.version_no`, [Number(project.customer_id)]);
      return { project: { id: Number(project.id), project_code: project.project_code, project_name: project.project_name, customer_id: Number(project.customer_id), project_owner: project.project_owner, version: Number(project.version), requirement_version_id: Number(project.requirement_version_id) }, rows: rows.rows, candidates: candidates.rows, enabled_units: enabledUnits.rows };
    } finally { client.release(); }
  }

  private async validateResolution(client: PoolClient, project: ProjectRow, row: ResolutionInput) {
    const valid = await client.query(`select 1 from project_requirement_items ri
      join products p on p.id=$3 and p.status='ACTIVE' and p.customer_id=$7 and p.customer_id is not null
      join product_versions pv on pv.id=$4 and pv.product_id=p.id and pv.status='RELEASED'
      join bom_headers bh on bh.id=$5 and bh.product_id=p.id and bh.status='ACTIVE'
      join bom_versions bv on bv.id=$6 and bv.bom_header_id=bh.id and bv.product_version_id=pv.id and bv.status='RELEASED'
      where ri.id=$2 and ri.requirement_version_id=$1`, [Number(project.requirement_version_id), row.requirementItemId, row.productId, row.productVersionId, row.bomHeaderId, row.bomVersionId, Number(project.customer_id)]);
    if (!valid.rows[0]) throw new PlanningHandoffError("RESOLUTION_REFERENCE_INVALID", "需求明细与客户、已发布产品版本或已发布 BOM 关系不一致", 422);
    const structure = await client.query(`select count(*)::int total,count(*) filter(where m.material_status='ACTIVE' and u.enabled=true)::int valid from bom_lines bl left join material_master m on m.id=bl.material_id left join units u on u.id=bl.unit_id where bl.bom_version_id=$1`, [row.bomVersionId]);
    if (Number(structure.rows[0].total) < 1 || Number(structure.rows[0].valid) !== Number(structure.rows[0].total)) throw new PlanningHandoffError("BOM_STRUCTURE_INVALID", "BOM 必须至少一行且全部行引用 ACTIVE 物料和 enabled 单位", 422);
    const restriction = await client.query(`select 1 from bom_lines bl join material_customer_restrictions r on r.material_id=bl.material_id and r.status='ACTIVE' where bl.bom_version_id=$1 and r.customer_id is distinct from $2 limit 1`, [row.bomVersionId, Number(project.customer_id)]);
    if (restriction.rows[0]) throw new PlanningHandoffError("MATERIAL_CUSTOMER_RESTRICTED", "BOM 包含与项目客户不一致的客户专用物料", 422);
  }

  async saveResolutions(projectId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    const parsed = resolutionInput(input);
    return this.repository.execute(meta, async (client) => {
      const project = await this.acceptedProject(client, projectId, true); this.assertEngineeringOwner(meta.actor, project);
      if (Number(project.version) !== parsed.expected) throw new PlanningHandoffError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      const currentPackage = await client.query("select status from project_planning_packages where project_id=$1 order by package_version_no desc limit 1", [projectId]);
      if (currentPackage.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_STATE_CONFLICT", "已有交接包后，Product/BOM 解析只能通过独立的变更解析流程修改；本次退回仅允许保存工程修订回复", 409);
      for (const row of parsed.rows) { await this.validateResolution(client, project, row); await client.query(`insert into project_requirement_resolutions(project_id,requirement_version_id,requirement_item_id,product_id,product_version_id,bom_header_id,bom_version_id,resolved_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict(requirement_item_id) do update set product_id=excluded.product_id,product_version_id=excluded.product_version_id,bom_header_id=excluded.bom_header_id,bom_version_id=excluded.bom_version_id,resolved_by=excluded.resolved_by,resolved_at=now(),request_id=excluded.request_id`, [projectId, Number(project.requirement_version_id), row.requirementItemId, row.productId, row.productVersionId, row.bomHeaderId, row.bomVersionId, meta.actor.username, meta.requestId]); }
      await this.fault?.("after_resolutions");
      const body = { ok: true, project_id: projectId, resolved_count: parsed.rows.length, request_id: meta.requestId };
      return { status: 200, body, objectId: projectId, oldVersion: parsed.expected, newVersion: parsed.expected };
    });
  }

  async saveUnitResolution(projectId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    const parsed = unitResolutionInput(input);
    return this.repository.execute(meta, async (client) => {
      const project = await this.acceptedProject(client, projectId, true); this.assertEngineeringOwner(meta.actor, project);
      const currentPackage = await client.query("select status from project_planning_packages where project_id=$1 order by package_version_no desc limit 1", [projectId]);
      if (currentPackage.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_STATE_CONFLICT", "已有交接包后，单位解析只能通过独立的变更解析流程修改；本次退回仅允许保存工程修订回复", 409);
      const item = await client.query(`select ri.id,ri.line_no from project_requirement_items ri
        where ri.id=$1 and ri.requirement_version_id=$2 for update of ri`, [parsed.requirementItemId, Number(project.requirement_version_id)]);
      if (!item.rows[0]) throw new PlanningHandoffError("REQUIREMENT_UNIT_INVALID", "需求明细不属于项目当前需求版本，请刷新页面后重试", 422);
      const unit = await client.query("select id,code,name,enabled from units where id=$1 for update", [parsed.unitId]);
      if (!unit.rows[0]) throw new PlanningHandoffError("REQUIREMENT_UNIT_INVALID", "所选单位不存在，请刷新单位列表后重新选择", 422);
      if (!unit.rows[0].enabled) throw new PlanningHandoffError("REQUIREMENT_UNIT_DISABLED", "所选单位已停用，请刷新单位列表并选择启用单位", 422);
      const head = await client.query("select current_resolution_id,version from project_requirement_unit_resolution_heads where requirement_item_id=$1 for update", [parsed.requirementItemId]);
      const currentHeadVersion = Number(head.rows[0]?.version || 0);
      if (currentHeadVersion !== parsed.expectedHeadVersion) throw new PlanningHandoffError("REQUIREMENT_UNIT_VERSION_CONFLICT", "该需求单位解析已被其他人员更新，请刷新后重新确认", 409);
      const nextVersion = currentHeadVersion + 1;
      const supersedesResolutionId = head.rows[0]?.current_resolution_id ? Number(head.rows[0].current_resolution_id) : null;
      const contentDigest = canonicalDigest({ project_id: projectId, requirement_version_id: Number(project.requirement_version_id), requirement_item_id: parsed.requirementItemId, resolution_version_no: nextVersion, unit_id: parsed.unitId, source_type: "ENGINEERING_CONFIRMED", supersedes_resolution_id: supersedesResolutionId, resolved_by: meta.actor.username });
      const resolution = await client.query(`insert into project_requirement_unit_resolution_versions(project_id,requirement_version_id,requirement_item_id,resolution_version_no,unit_id,source_type,supersedes_resolution_id,resolved_by,request_id,content_digest)
        values($1,$2,$3,$4,$5,'ENGINEERING_CONFIRMED',$6,$7,$8,$9) returning *`, [projectId, Number(project.requirement_version_id), parsed.requirementItemId, nextVersion, parsed.unitId, supersedesResolutionId, meta.actor.username, meta.requestId, contentDigest]);
      await this.fault?.("after_unit_resolution_version");
      let savedHead;
      if (currentHeadVersion === 0) {
        savedHead = await client.query(`insert into project_requirement_unit_resolution_heads(requirement_item_id,project_id,requirement_version_id,current_resolution_id,version)
          values($1,$2,$3,$4,1) returning *`, [parsed.requirementItemId, projectId, Number(project.requirement_version_id), Number(resolution.rows[0].id)]);
      } else {
        savedHead = await client.query(`update project_requirement_unit_resolution_heads set current_resolution_id=$2,version=version+1,updated_at=now()
          where requirement_item_id=$1 and version=$3 returning *`, [parsed.requirementItemId, Number(resolution.rows[0].id), parsed.expectedHeadVersion]);
      }
      if (!savedHead.rows[0]) throw new PlanningHandoffError("REQUIREMENT_UNIT_VERSION_CONFLICT", "该需求单位解析已被其他人员更新，请刷新后重新确认", 409);
      await this.fault?.("after_unit_resolution_head");
      const resolutionId = Number(resolution.rows[0].id);
      const body = { ok: true, project_id: projectId, requirement_item_id: parsed.requirementItemId, unit_resolution_id: resolutionId, unit_resolution_version_no: nextVersion, unit_resolution_head_version: nextVersion, unit: { id: parsed.unitId, code: unit.rows[0].code, name: unit.rows[0].name }, request_id: meta.requestId };
      return { status: 201, body, objectId: resolutionId, oldVersion: currentHeadVersion, newVersion: nextVersion, auditDetail: { project_id: projectId, requirement_item_id: parsed.requirementItemId, unit_id: parsed.unitId, unit_resolution_id: resolutionId, source_type: "ENGINEERING_CONFIRMED" } };
    });
  }

  private async snapshotSources(client: PoolClient, project: ProjectRow) {
    const items = await client.query(`select ri.id requirement_item_id,ri.line_no,ri.provisional_name,ri.quantity::text required_quantity,ri.unit_id source_unit_id,ri.unit_pending source_unit_pending,ri.specification_requirement,
      uh.current_resolution_id unit_resolution_id,uh.version unit_resolution_head_version,ur.resolution_version_no unit_resolution_version_no,ur.source_type unit_resolution_source_type,ur.content_digest unit_resolution_digest,
      ur.unit_id,ru.code requirement_unit_code,ru.name requirement_unit_name,ru.enabled requirement_unit_enabled,
      r.product_id,r.product_version_id,r.bom_header_id,r.bom_version_id,p.product_code,p.product_name,pv.version_code product_version_code,pv.product_type,pv.lifecycle_status,
      bh.bom_code,bv.id validated_bom_version_id,bv.version_code bom_version_code
      from project_requirement_items ri
      left join project_requirement_unit_resolution_heads uh on uh.requirement_item_id=ri.id and uh.project_id=$2 and uh.requirement_version_id=$1
      left join project_requirement_unit_resolution_versions ur on ur.id=uh.current_resolution_id and ur.requirement_item_id=ri.id and ur.project_id=$2 and ur.requirement_version_id=$1
      left join units ru on ru.id=ur.unit_id
      left join project_requirement_resolutions r on r.requirement_item_id=ri.id and r.project_id=$2 and r.requirement_version_id=$1
      left join products p on p.id=r.product_id and p.status='ACTIVE' and p.customer_id=$3 and p.customer_id is not null
      left join product_versions pv on pv.id=r.product_version_id and pv.product_id=p.id and pv.status='RELEASED'
      left join bom_headers bh on bh.id=r.bom_header_id and bh.product_id=p.id and bh.status='ACTIVE'
      left join bom_versions bv on bv.id=r.bom_version_id and bv.bom_header_id=bh.id and bv.product_version_id=pv.id and bv.status='RELEASED'
      where ri.requirement_version_id=$1 order by ri.line_no`, [Number(project.requirement_version_id), Number(project.id), Number(project.customer_id)]);
    if (!items.rows.length) throw new PlanningHandoffError("REQUIREMENT_PRODUCT_BOM_UNRESOLVED", "当前需求版本没有可交接明细，请返回项目需求页面补充后重试", 422);
    const missingUnits = items.rows.filter((item) => !item.unit_resolution_id).map((item) => Number(item.line_no));
    if (missingUnits.length) throw new PlanningHandoffError("REQUIREMENT_UNIT_UNRESOLVED", `需求第 ${missingUnits.join("、")} 行尚未确认单位，请在工程解析页逐项选择有效单位后重试`, 422);
    const invalidUnits = items.rows.filter((item) => !item.unit_id || !item.requirement_unit_code).map((item) => Number(item.line_no));
    if (invalidUnits.length) throw new PlanningHandoffError("REQUIREMENT_UNIT_INVALID", `需求第 ${invalidUnits.join("、")} 行的单位引用无效，请刷新页面后重新确认`, 422);
    const disabledUnits = items.rows.filter((item) => item.requirement_unit_enabled !== true).map((item) => Number(item.line_no));
    if (disabledUnits.length) throw new PlanningHandoffError("REQUIREMENT_UNIT_DISABLED", `需求第 ${disabledUnits.join("、")} 行的已确认单位已停用，请选择启用单位后再生成交接包`, 422);
    const missingProductBom = items.rows.filter((item) => !item.validated_bom_version_id).map((item) => Number(item.line_no));
    if (missingProductBom.length) throw new PlanningHandoffError("REQUIREMENT_PRODUCT_BOM_UNRESOLVED", `需求第 ${missingProductBom.join("、")} 行尚未完成有效 Product/BOM 解析，请逐项保存后重试`, 422);
    const lockedUnits = await client.query(`select uh.requirement_item_id from project_requirement_unit_resolution_heads uh
      join project_requirement_unit_resolution_versions ur on ur.id=uh.current_resolution_id and ur.requirement_item_id=uh.requirement_item_id
      join units u on u.id=ur.unit_id and u.enabled=true
      where uh.project_id=$1 and uh.requirement_version_id=$2 for update of uh,u`, [Number(project.id), Number(project.requirement_version_id)]);
    if (lockedUnits.rowCount !== items.rowCount) throw new PlanningHandoffError("REQUIREMENT_UNIT_VERSION_CONFLICT", "需求单位解析在生成交接包时发生变化，请刷新后重试", 409);
    const snapshots: Array<Record<string, unknown> & { lines: Record<string, unknown>[] }> = [];
    for (const item of items.rows) {
      const lines = await client.query(`select bl.id source_bom_line_id,bl.line_no,bl.material_id,bl.unit_id,bl.quantity_per::text,bl.loss_rate::text,
        round($2::numeric*bl.quantity_per*(1+bl.loss_rate),6)::numeric(24,6)::text calculated_gross_quantity,u.code unit_code,
        jsonb_build_object('internal_material_code',m.internal_material_code,'standard_name',m.standard_name,'category_code',c.category_code,'brand',m.brand,'manufacturer',m.manufacturer,'manufacturer_part_number',m.manufacturer_part_number,'base_uom',m.base_uom,'attributes',coalesce((select jsonb_object_agg(d.attribute_code,jsonb_build_object('value',av.value,'unit',av.unit_code) order by d.attribute_code) from material_attribute_values av join material_attribute_definitions d on d.id=av.attribute_definition_id where av.material_id=m.id),'{}'::jsonb)) specification_snapshot
        from bom_lines bl join material_master m on m.id=bl.material_id and m.material_status='ACTIVE' join material_categories c on c.id=m.category_id join units u on u.id=bl.unit_id and u.enabled=true where bl.bom_version_id=$1 order by bl.line_no`, [Number(item.bom_version_id), item.required_quantity]);
      const total = await client.query("select count(*)::int count from bom_lines where bom_version_id=$1", [Number(item.bom_version_id)]);
      if (!lines.rows.length || lines.rowCount !== Number(total.rows[0].count)) throw new PlanningHandoffError("BOM_STRUCTURE_INVALID", "BOM 快照生成时发现物料或单位已失效", 422);
      const restriction = await client.query(`select 1 from bom_lines bl join material_customer_restrictions r on r.material_id=bl.material_id and r.status='ACTIVE' where bl.bom_version_id=$1 and r.customer_id is distinct from $2 limit 1`, [Number(item.bom_version_id), Number(project.customer_id)]);
      if (restriction.rows[0]) throw new PlanningHandoffError("MATERIAL_CUSTOMER_RESTRICTED", "BOM 包含与项目客户不一致的客户专用物料", 422);
      snapshots.push({ ...item, lines: lines.rows.map((line) => ({ ...line, material_digest: canonicalDigest(line.specification_snapshot) })) });
    }
    return snapshots;
  }

  private packageDigest(
    projectId: number,
    packageVersionNo: number,
    requirementVersionId: number,
    targetDeliveryDate: string | null,
    snapshots: Array<Record<string, unknown> & { lines: Record<string, unknown>[] }>,
    documents: Record<string, unknown>[],
    lineage: Record<string, unknown> | null,
  ) {
    const items = snapshots.map((item) => ({
      requirement_item_id: Number(item.requirement_item_id),
      product_version_id: Number(item.product_version_id),
      bom_version_id: Number(item.bom_version_id),
      required_quantity: String(item.required_quantity),
      unit_id: Number(item.unit_id),
      unit_resolution_id: Number(item.unit_resolution_id),
      line_no: Number(item.line_no),
      source_digest: String(item.source_digest),
      lines: item.lines.map((line) => ({
        source_bom_line_id: Number(line.source_bom_line_id),
        material_id: Number(line.material_id),
        unit_id: Number(line.unit_id),
        quantity_per: String(line.quantity_per),
        loss_rate: String(line.loss_rate),
        calculated_gross_quantity: String(line.calculated_gross_quantity),
        specification_snapshot: line.specification_snapshot,
        material_digest: String(line.material_digest),
        line_no: Number(line.line_no),
      })),
    }));
    const documentSnapshot = documents.map((document) => ({
      project_document_link_id: Number(document.project_document_link_id),
      document_type: String(document.document_type || ""),
      display_name: String(document.display_name || ""),
      sha256: String(document.sha256 || ""),
      size_bytes: String(document.size_bytes || ""),
    }));
    return canonicalDigest({ project_id: projectId, package_version_no: packageVersionNo, requirement_version_id: requirementVersionId, target_delivery_date: targetDeliveryDate, lineage, items, documents: documentSnapshot });
  }

  private async fixedPackageSources(client: PoolClient, sourcePackageId: number) {
    const sourceCount = await client.query("select count(*)::int count from project_planning_package_items where package_id=$1", [sourcePackageId]);
    const items = await client.query(`select pi.id source_package_item_id,pi.requirement_item_id,pi.product_version_id,pi.bom_version_id,
      pi.required_quantity::text,pi.unit_id,pi.unit_resolution_id,pi.line_no,pi.source_digest,
      p.status product_status,pv.status product_version_status,bh.status bom_status,bv.status bom_version_status,
      u.enabled unit_enabled,ur.id validated_unit_resolution_id
      from project_planning_package_items pi
      left join product_versions pv on pv.id=pi.product_version_id
      left join products p on p.id=pv.product_id
      left join bom_versions bv on bv.id=pi.bom_version_id and bv.product_version_id=pi.product_version_id
      left join bom_headers bh on bh.id=bv.bom_header_id and bh.product_id=p.id
      left join units u on u.id=pi.unit_id
      left join project_requirement_unit_resolution_versions ur on ur.id=pi.unit_resolution_id and ur.requirement_item_id=pi.requirement_item_id and ur.unit_id=pi.unit_id
      where pi.package_id=$1 order by pi.line_no`, [sourcePackageId]);
    if (!items.rows.length || items.rowCount !== Number(sourceCount.rows[0].count)) throw new PlanningHandoffError("PLANNING_HANDOFF_CONSTRAINT_VIOLATION", "源 Package 快照不完整，不能生成后继版本", 422);
    const invalidProductBom = items.rows.filter((item) => item.product_status !== "ACTIVE" || item.product_version_status !== "RELEASED" || item.bom_status !== "ACTIVE" || item.bom_version_status !== "RELEASED");
    if (invalidProductBom.length) throw new PlanningHandoffError("RESOLUTION_REFERENCE_INVALID", "源 Package 固定引用的 Product/BOM 已失效；请先发起独立变更解析流程", 422);
    const invalidUnits = items.rows.filter((item) => !item.validated_unit_resolution_id || item.unit_enabled !== true);
    if (invalidUnits.length) throw new PlanningHandoffError("REQUIREMENT_UNIT_INVALID", "源 Package 固定引用的 Unit Resolution 或单位已失效；请先发起独立变更解析流程", 422);
    const snapshots: Array<Record<string, unknown> & { lines: Record<string, unknown>[] }> = [];
    for (const item of items.rows) {
      const lines = await client.query(`select source_bom_line_id,material_id,unit_id,quantity_per::text,loss_rate::text,
        calculated_gross_quantity::text,specification_snapshot,material_digest,line_no
        from project_planning_package_bom_lines where package_item_id=$1 order by line_no`, [Number(item.source_package_item_id)]);
      if (!lines.rows.length) throw new PlanningHandoffError("PLANNING_HANDOFF_CONSTRAINT_VIOLATION", "源 Package 物料快照不完整，不能生成后继版本", 422);
      snapshots.push({ ...item, lines: lines.rows });
    }
    const documents = await client.query(`select dl.project_document_link_id,l.document_type,l.display_name,f.sha256,f.size_bytes::text
      from project_planning_document_links dl
      join project_document_links l on l.id=dl.project_document_link_id
      join material_import_files f on f.id=l.file_id
      where dl.package_id=$1 order by dl.id`, [sourcePackageId]);
    return { snapshots, documents: documents.rows };
  }

  async createPackage(projectId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    assertOnlyKeys(input, ["expected_version", "target_delivery_date"]); const expected = expectedVersion(input.expected_version); const requestedDate = optionalDate(input.target_delivery_date);
    return this.repository.execute(meta, async (client) => {
      const project = await this.acceptedProject(client, projectId, true); this.assertEngineeringOwner(meta.actor, project); if (Number(project.version) !== expected) throw new PlanningHandoffError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      const previous = await client.query("select * from project_planning_packages where project_id=$1 order by package_version_no desc limit 1", [projectId]);
      if (previous.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_STATE_CONFLICT", "当前项目已有计划交接包；Planning 退回后请先保存工程修订回复，再从源 Package 生成固定谱系后继", 409);
      const packageVersionNo = 1; const sourceSnapshots = await this.snapshotSources(client, project);
      const snapshots: Array<Record<string, unknown> & { lines: Record<string, unknown>[] }> = sourceSnapshots.map((item) => ({ ...item, source_digest: canonicalDigest({ ...item, lines: item.lines }) }));
      const documents = await client.query(`select l.id project_document_link_id,l.document_type,l.display_name,f.original_filename,f.mime_type,f.sha256,f.size_bytes::text,f.storage_status from project_document_links l join material_import_files f on f.id=l.file_id where l.project_id=$1 and l.requirement_version_id=$2 and f.storage_status='STORED' order by l.id`, [projectId, Number(project.requirement_version_id)]);
      const sourceTargetDate = project.target_delivery_date; const targetDate = requestedDate ?? (sourceTargetDate instanceof Date ? sourceTargetDate.toISOString().slice(0, 10) : sourceTargetDate ? String(sourceTargetDate).slice(0, 10) : null);
      const packageDigest = this.packageDigest(projectId, packageVersionNo, Number(project.requirement_version_id), targetDate, snapshots, documents.rows, null);
      const saved = await client.query(`insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,request_id) values($1,$2,$3,'DRAFT',$4,$5,$6,$7) returning *`, [projectId, packageVersionNo, Number(project.requirement_version_id), targetDate, packageDigest, meta.actor.username, meta.requestId]);
      const packageId = Number(saved.rows[0].id); await this.fault?.("after_package_header");
      await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values($1,$2,'CREATED',$3,$4)", [packageId, projectId, meta.actor.username, meta.requestId]);
      await this.fault?.("after_package_create_event");
      for (const item of snapshots) {
        const packageItem = await client.query(`insert into project_planning_package_items(package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,unit_resolution_id,line_no,source_digest) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [packageId, Number(item.requirement_item_id), Number(item.product_version_id), Number(item.bom_version_id), item.required_quantity, Number(item.unit_id), Number(item.unit_resolution_id), Number(item.line_no), item.source_digest]);
        for (const line of item.lines) await client.query(`insert into project_planning_package_bom_lines(package_item_id,source_bom_line_id,material_id,unit_id,quantity_per,loss_rate,calculated_gross_quantity,specification_snapshot,material_digest,line_no) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [Number(packageItem.rows[0].id), Number(line.source_bom_line_id), Number(line.material_id), Number(line.unit_id), line.quantity_per, line.loss_rate, line.calculated_gross_quantity, line.specification_snapshot, line.material_digest, Number(line.line_no)]);
      }
      for (const document of documents.rows) await client.query("insert into project_planning_document_links(package_id,project_document_link_id,created_by,request_id) values($1,$2,$3,$4)", [packageId, Number(document.project_document_link_id), meta.actor.username, meta.requestId]);
      await this.fault?.("after_package_snapshot");
      const body = { ok: true, project_id: projectId, package_id: packageId, data: saved.rows[0], item_count: snapshots.length, package_digest: packageDigest, request_id: meta.requestId };
      return { status: 201, body, objectId: packageId, newVersion: 1 };
    });
  }

  async saveRevisionResponse(packageId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    const parsed = revisionResponseInput(input);
    return this.repository.execute(meta, async (client) => {
      const source = await this.packageForUpdate(client, packageId); this.assertEngineeringOwner(meta.actor, source as unknown as ProjectRow);
      if (source.status !== "RETURNED") throw new PlanningHandoffError("PACKAGE_NOT_RETURNED", "只有 Planning 已退回且责任队列已回到工程/项目部的 Package 才能保存修订回复", 409);
      const returnEvents = await client.query("select id,package_id,project_id,event_type,actor,reason,request_id,created_at from project_planning_handoff_events where package_id=$1 and project_id=$2 and event_type='RETURNED' order by id for update", [packageId, Number(source.project_id)]);
      if (returnEvents.rowCount !== 1) throw new PlanningHandoffError("RETURN_EVENT_NOT_FOUND", "没有找到唯一且属于该源 Package 的 Planning RETURN 事件，请联系管理员核验事件链", 409);
      const returnEventId = Number(returnEvents.rows[0].id);
      const head = await client.query("select current_response_version_id,version from project_planning_revision_response_heads where return_event_id=$1 for update", [returnEventId]);
      const currentHeadVersion = Number(head.rows[0]?.version || 0);
      if (currentHeadVersion !== parsed.expectedHeadVersion) throw new PlanningHandoffError("REVISION_VERSION_CONFLICT", "工程修订回复已被其他人员更新，请刷新后基于最新版本继续", 409);
      const nextVersion = currentHeadVersion + 1;
      const supersedesResponseId = head.rows[0]?.current_response_version_id ? Number(head.rows[0].current_response_version_id) : null;
      const saved = await client.query(`insert into project_planning_revision_response_versions(source_package_id,return_event_id,project_id,response_version_no,response_text,response_text_digest,supersedes_response_id,created_by,request_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,source_package_id,return_event_id,project_id,response_version_no,response_text,response_text_digest,supersedes_response_id,created_by,created_at,request_id`, [packageId, returnEventId, Number(source.project_id), nextVersion, parsed.responseText, parsed.responseTextDigest, supersedesResponseId, meta.actor.username, meta.requestId]);
      await this.fault?.("after_revision_response_version");
      let savedHead;
      if (currentHeadVersion === 0) {
        savedHead = await client.query(`insert into project_planning_revision_response_heads(return_event_id,source_package_id,project_id,current_response_version_id,version)
          values($1,$2,$3,$4,1) returning *`, [returnEventId, packageId, Number(source.project_id), Number(saved.rows[0].id)]);
      } else {
        savedHead = await client.query(`update project_planning_revision_response_heads set current_response_version_id=$2,version=version+1,updated_at=now()
          where return_event_id=$1 and version=$3 returning *`, [returnEventId, Number(saved.rows[0].id), parsed.expectedHeadVersion]);
      }
      if (!savedHead.rows[0]) throw new PlanningHandoffError("REVISION_VERSION_CONFLICT", "工程修订回复已被其他人员更新，请刷新后基于最新版本继续", 409);
      await this.fault?.("after_revision_response_head");
      const responseVersionId = Number(saved.rows[0].id);
      const body = { ok: true, package_id: packageId, return_event_id: returnEventId, revision_response_version_id: responseVersionId, response_head_version: nextVersion, response: saved.rows[0], request_id: meta.requestId };
      return { status: 201, body, objectId: responseVersionId, oldVersion: currentHeadVersion, newVersion: nextVersion, auditDetail: { source_package_id: packageId, return_event_id: returnEventId, revision_response_version_id: responseVersionId, response_version_no: nextVersion, response_text_digest: parsed.responseTextDigest } };
    });
  }

  async createSuccessorPackage(sourcePackageId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    const parsed = successorPackageInput(input);
    return this.repository.execute(meta, async (client) => {
      const source = await this.packageForUpdate(client, sourcePackageId); this.assertEngineeringOwner(meta.actor, source as unknown as ProjectRow);
      if (source.status !== "RETURNED") throw new PlanningHandoffError("PACKAGE_NOT_RETURNED", "源 Package 不是 RETURNED，不能生成工程修订后继版本", 409);
      if (Number(source.version) !== parsed.expectedPackageVersion) throw new PlanningHandoffError("REVISION_VERSION_CONFLICT", "源 Package 状态或版本已变化，请刷新后重试", 409);
      const returnEvents = await client.query("select id,package_id,project_id,event_type,actor,reason,request_id,created_at from project_planning_handoff_events where package_id=$1 and project_id=$2 and event_type='RETURNED' order by id for update", [sourcePackageId, Number(source.project_id)]);
      if (returnEvents.rowCount !== 1) throw new PlanningHandoffError("RETURN_EVENT_NOT_FOUND", "没有找到唯一且属于源 Package 的 Planning RETURN 事件，不能生成后继版本", 409);
      const returnEventId = Number(returnEvents.rows[0].id);
      const successor = await client.query("select id,package_version_no from project_planning_packages where previous_package_id=$1 or responds_to_return_event_id=$2 or (project_id=$3 and package_version_no=$4) order by id limit 1", [sourcePackageId, returnEventId, Number(source.project_id), Number(source.package_version_no) + 1]);
      if (successor.rows[0]) throw new PlanningHandoffError("SUCCESSOR_PACKAGE_EXISTS", `该 Planning RETURN 已存在直接后继 Package v${successor.rows[0].package_version_no}，请刷新查看`, 409);
      const responseHead = await client.query(`select h.version head_version,h.current_response_version_id,rr.id,rr.response_version_no,rr.response_text_digest
        from project_planning_revision_response_heads h
        join project_planning_revision_response_versions rr on rr.id=h.current_response_version_id and rr.source_package_id=h.source_package_id and rr.return_event_id=h.return_event_id and rr.project_id=h.project_id
        where h.return_event_id=$1 and h.source_package_id=$2 and h.project_id=$3 for update of h`, [returnEventId, sourcePackageId, Number(source.project_id)]);
      if (!responseHead.rows[0]) throw new PlanningHandoffError("REVISION_RESPONSE_REQUIRED", "请先保存工程修订回复并刷新确认回复 Version，再生成 v2", 422);
      if (Number(responseHead.rows[0].head_version) !== parsed.expectedResponseHeadVersion || Number(responseHead.rows[0].current_response_version_id) !== parsed.revisionResponseVersionId) {
        throw new PlanningHandoffError("REVISION_VERSION_CONFLICT", "工程修订回复 Head 已变化，请刷新确认最新回复后再生成 v2", 409);
      }
      const consumed = await client.query("select id from project_planning_packages where project_id=$1 and revision_response_version_id=$2 limit 1", [Number(source.project_id), parsed.revisionResponseVersionId]);
      if (consumed.rows[0]) throw new PlanningHandoffError("RETURN_ALREADY_RESPONDED", "当前工程回复 Version 已被 Package 固定引用，请刷新查看已有后继版本", 409);
      const fixed = await this.fixedPackageSources(client, sourcePackageId);
      const packageVersionNo = Number(source.package_version_no) + 1;
      const sourceDate = source.target_delivery_date; const targetDate = sourceDate instanceof Date ? sourceDate.toISOString().slice(0, 10) : sourceDate ? String(sourceDate).slice(0, 10) : null;
      const lineage = { previous_package_id: sourcePackageId, return_event_id: returnEventId, revision_response_version_id: parsed.revisionResponseVersionId, response_text_digest: String(responseHead.rows[0].response_text_digest) };
      const packageDigest = this.packageDigest(Number(source.project_id), packageVersionNo, Number(source.requirement_version_id), targetDate, fixed.snapshots, fixed.documents, lineage);
      const saved = await client.query(`insert into project_planning_packages(project_id,package_version_no,requirement_version_id,previous_package_id,responds_to_return_event_id,revision_response_version_id,status,target_delivery_date,package_digest,prepared_by,request_id)
        values($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10) returning *`, [Number(source.project_id), packageVersionNo, Number(source.requirement_version_id), sourcePackageId, returnEventId, parsed.revisionResponseVersionId, targetDate, packageDigest, meta.actor.username, meta.requestId]);
      const packageId = Number(saved.rows[0].id); await this.fault?.("after_successor_header");
      await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values($1,$2,'CREATED',$3,$4)", [packageId, Number(source.project_id), meta.actor.username, meta.requestId]);
      await this.fault?.("after_successor_create_event");
      for (const item of fixed.snapshots) {
        const packageItem = await client.query(`insert into project_planning_package_items(package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,unit_resolution_id,line_no,source_digest)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [packageId, Number(item.requirement_item_id), Number(item.product_version_id), Number(item.bom_version_id), item.required_quantity, Number(item.unit_id), Number(item.unit_resolution_id), Number(item.line_no), item.source_digest]);
        for (const line of item.lines) await client.query(`insert into project_planning_package_bom_lines(package_item_id,source_bom_line_id,material_id,unit_id,quantity_per,loss_rate,calculated_gross_quantity,specification_snapshot,material_digest,line_no)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [Number(packageItem.rows[0].id), Number(line.source_bom_line_id), Number(line.material_id), Number(line.unit_id), line.quantity_per, line.loss_rate, line.calculated_gross_quantity, line.specification_snapshot, line.material_digest, Number(line.line_no)]);
      }
      for (const document of fixed.documents) await client.query("insert into project_planning_document_links(package_id,project_document_link_id,created_by,request_id) values($1,$2,$3,$4)", [packageId, Number(document.project_document_link_id), meta.actor.username, meta.requestId]);
      await this.fault?.("after_successor_snapshot");
      const body = { ok: true, project_id: Number(source.project_id), package_id: packageId, data: saved.rows[0], item_count: fixed.snapshots.length, package_digest: packageDigest, lineage, request_id: meta.requestId };
      return { status: 201, body, objectId: packageId, newVersion: 1, auditDetail: { source_package_id: sourcePackageId, return_event_id: returnEventId, revision_response_version_id: parsed.revisionResponseVersionId, response_text_digest: responseHead.rows[0].response_text_digest } };
    });
  }

  async listPackages(actor: IdentityActor, projectId: number) {
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403); const project = await this.repository.pool.query("select project_owner from business_projects where id=$1 and status='ACCEPTED'", [projectId]);
    if (!project.rows[0] || (actor.role === "engineering" && project.rows[0].project_owner !== actor.username)) throw new PlanningHandoffError("PROJECT_NOT_FOUND", "项目不存在", 404);
    const result = await this.repository.pool.query(`select pp.*,count(distinct pi.id)::int item_count,count(bl.id)::int bom_line_count from project_planning_packages pp left join project_planning_package_items pi on pi.package_id=pp.id left join project_planning_package_bom_lines bl on bl.package_item_id=pi.id where pp.project_id=$1 group by pp.id order by pp.package_version_no desc`, [projectId]); return result.rows;
  }

  async detail(actor: IdentityActor, packageId: number) {
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403);
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin transaction isolation level repeatable read read only");
      const header = await client.query(`select pp.id,pp.project_id,pp.package_version_no,pp.requirement_version_id,pp.previous_package_id,pp.responds_to_return_event_id,pp.revision_response_version_id,pp.status,pp.target_delivery_date,pp.package_digest,
      pp.prepared_by,pp.prepared_at,pp.submitted_by,pp.submitted_at,pp.accepted_by,pp.accepted_at,pp.returned_by,pp.returned_at,pp.return_reason,pp.version,pp.updated_at,
      p.project_code,p.project_name,p.project_goal,p.project_owner,p.customer_id,c.customer_code,c.customer_name,rv.version_no requirement_version_no,rv.customer_requirement_summary
      from project_planning_packages pp join business_projects p on p.id=pp.project_id join customers c on c.id=p.customer_id
      join project_requirement_versions rv on rv.id=pp.requirement_version_id where pp.id=$1`, [packageId]);
      if (!header.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_NOT_FOUND", "计划交接包不存在", 404);
      if (actor.role === "engineering" && header.rows[0].project_owner !== actor.username) throw new PlanningHandoffError("PLANNING_PACKAGE_FORBIDDEN", "没有权限查看该计划交接包", 403);
      if (header.rows[0].status === "DRAFT" && !["admin", "manager", "engineering"].includes(actor.role)) throw new PlanningHandoffError("PLANNING_PACKAGE_FORBIDDEN", "该计划交接包尚未提交，无权查看", 403);
      const items = await client.query(`select pi.id,pi.package_id,pi.requirement_item_id,pi.product_version_id,pi.bom_version_id,pi.required_quantity::text,pi.unit_id,pi.unit_resolution_id,pi.line_no,pi.source_digest,
        ri.provisional_name,ri.specification_requirement,ri.unit_id source_unit_id,ri.unit_pending source_unit_pending,su.code source_unit_code,su.name source_unit_name,
        u.code unit_code,u.name unit_name,ur.resolution_version_no unit_resolution_version_no,ur.source_type unit_resolution_source_type,
        ur.unit_id resolved_unit_id,ur.content_digest unit_resolution_digest,p.id product_id,p.product_code,p.product_name,p.status product_current_status,
        pv.version_code product_version_code,pv.status product_version_current_status,bh.id bom_header_id,bh.bom_code,bh.status bom_current_status,
        bv.version_code bom_version_code,bv.status bom_version_current_status
        from project_planning_package_items pi join project_requirement_items ri on ri.id=pi.requirement_item_id
        left join units su on su.id=ri.unit_id join units u on u.id=pi.unit_id
        left join project_requirement_unit_resolution_versions ur on ur.id=pi.unit_resolution_id and ur.requirement_item_id=pi.requirement_item_id and ur.unit_id=pi.unit_id
        join product_versions pv on pv.id=pi.product_version_id join products p on p.id=pv.product_id
        join bom_versions bv on bv.id=pi.bom_version_id and bv.product_version_id=pi.product_version_id join bom_headers bh on bh.id=bv.bom_header_id and bh.product_id=p.id
        where pi.package_id=$1 order by pi.line_no`, [packageId]);
      const lines = await client.query(`select bl.id,bl.package_item_id,bl.source_bom_line_id,bl.material_id,bl.unit_id,bl.quantity_per::text,bl.loss_rate::text,
        bl.calculated_gross_quantity::text,bl.specification_snapshot,bl.material_digest,bl.line_no,u.code unit_code,u.name unit_name
        from project_planning_package_bom_lines bl join project_planning_package_items pi on pi.id=bl.package_item_id
        join units u on u.id=bl.unit_id where pi.package_id=$1 order by pi.line_no,bl.line_no`, [packageId]);
      const documents = await client.query(`select dl.id,dl.project_document_link_id,l.document_type,l.display_name,f.original_filename,f.mime_type,f.sha256,f.size_bytes::text,f.storage_status from project_planning_document_links dl join project_document_links l on l.id=dl.project_document_link_id join material_import_files f on f.id=l.file_id where dl.package_id=$1 order by dl.id`, [packageId]);
      const events = await client.query("select id,package_id,project_id,event_type,actor,reason,request_id,created_at from project_planning_handoff_events where package_id=$1 order by id", [packageId]);
      const revisionCurrent = await client.query(`select e.id return_event_id,e.actor return_actor,e.reason return_reason,e.request_id return_request_id,e.created_at return_created_at,
        h.version response_head_version,rr.id revision_response_version_id,rr.response_version_no,rr.response_text,rr.response_text_digest,rr.created_by response_created_by,rr.created_at response_created_at,rr.request_id response_request_id,
        successor.id successor_package_id,successor.package_version_no successor_package_version_no,successor.status successor_status
        from project_planning_handoff_events e
        left join project_planning_revision_response_heads h on h.return_event_id=e.id and h.source_package_id=e.package_id and h.project_id=e.project_id
        left join project_planning_revision_response_versions rr on rr.id=h.current_response_version_id and rr.source_package_id=e.package_id and rr.return_event_id=e.id and rr.project_id=e.project_id
        left join project_planning_packages successor on successor.previous_package_id=e.package_id and successor.responds_to_return_event_id=e.id
        where e.package_id=$1 and e.event_type='RETURNED'`, [packageId]);
      const fixedLineage = await client.query(`select previous.id previous_package_id,previous.package_version_no previous_package_version_no,previous.status previous_package_status,previous.package_digest previous_package_digest,
        e.id return_event_id,e.actor return_actor,e.reason return_reason,e.request_id return_request_id,e.created_at return_created_at,
        rr.id revision_response_version_id,rr.response_version_no,rr.response_text,rr.response_text_digest,rr.created_by response_created_by,rr.created_at response_created_at,rr.request_id response_request_id,
        h.version current_response_head_version
        from project_planning_packages successor
        join project_planning_packages previous on previous.id=successor.previous_package_id and previous.project_id=successor.project_id
        join project_planning_handoff_events e on e.id=successor.responds_to_return_event_id and e.package_id=previous.id and e.project_id=successor.project_id and e.event_type='RETURNED'
        join project_planning_revision_response_versions rr on rr.id=successor.revision_response_version_id and rr.source_package_id=previous.id and rr.return_event_id=e.id and rr.project_id=successor.project_id
        left join project_planning_revision_response_heads h on h.return_event_id=e.id and h.source_package_id=previous.id and h.project_id=successor.project_id
        where successor.id=$1`, [packageId]);
      const creationAudits = await client.query(`select a.username actor,a.request_id,a.result,a.created_at
        from audit_log a join project_planning_packages pp on pp.id=$1
        where a.route_code='PLANNING_HANDOFF' and a.action='PLANNING_PACKAGE_PREPARED' and a.result='success'
        and a.detail @> jsonb_build_object('object_id',$1::bigint) order by a.id limit 2`, [packageId]);
      const byItem = new Map<number, Record<string, unknown>[]>(); for (const line of lines.rows) { const key = Number(line.package_item_id); const rows = byItem.get(key) || []; rows.push(line); byItem.set(key, rows); }
      const candidateCreationAudit = creationAudits.rows.length === 1 ? creationAudits.rows[0] : null;
      const creationAudit = candidateCreationAudit && candidateCreationAudit.actor === header.rows[0].prepared_by && new Date(candidateCreationAudit.created_at).getTime() === new Date(header.rows[0].prepared_at).getTime() ? candidateCreationAudit : null;
      const persistedCreateEvent = events.rows.find((event) => event.event_type === "CREATED") || null;
      const mappedEvents = events.rows.filter((event) => event.event_type !== "CREATED").map((event) => ({
        id: `EVENT-${event.id}`,
        action: event.event_type === "SUBMITTED" ? "SUBMIT"
          : event.event_type === "RESUBMITTED" ? "RESUBMIT"
            : event.event_type === "RETURNED" ? "RETURN"
              : event.event_type === "ACCEPTED" ? "ACCEPT"
                : event.event_type,
        actor: event.actor,
        occurred_at: event.created_at,
        request_id: event.request_id,
        result: "SUCCESS",
        reason: event.reason,
        evidence_source: "PACKAGE_EVENT",
      }));
      const traceEvents = [
        persistedCreateEvent
          ? { id: `EVENT-${persistedCreateEvent.id}`, action: "CREATE", actor: persistedCreateEvent.actor, occurred_at: persistedCreateEvent.created_at, request_id: persistedCreateEvent.request_id, result: "SUCCESS", reason: "", evidence_source: "PACKAGE_EVENT" }
          : { id: `CREATE-${packageId}`, action: "CREATE", actor: header.rows[0].prepared_by, occurred_at: header.rows[0].prepared_at, request_id: creationAudit?.request_id ?? null, result: creationAudit ? "SUCCESS" : "TRACE_INCOMPLETE", reason: "", evidence_source: creationAudit ? "PACKAGE_SNAPSHOT_AND_SCOPED_AUDIT" : "PACKAGE_SNAPSHOT" },
        ...mappedEvents,
      ];
      const responsibility = header.rows[0].status === "SUBMITTED"
        ? { queue_role: "PLANNING", assignee: null, handling_deadline: null }
        : ["DRAFT", "RETURNED"].includes(header.rows[0].status)
          ? { queue_role: "ENGINEERING_PROJECT", assignee: null, handling_deadline: null }
          : { queue_role: "COMPLETED", assignee: null, handling_deadline: null };
      const creationValidation = { outcome: "PASSED", evidence_source: "PACKAGE_CREATION_SERVICE_GATE", product_required_status: "ACTIVE", product_version_required_status: "RELEASED", bom_required_status: "ACTIVE", bom_version_required_status: "RELEASED" };
      const response = {
        header: header.rows[0],
        responsibility,
        traceability: { complete: Boolean(persistedCreateEvent || creationAudit), creation_request_source: persistedCreateEvent ? "PACKAGE_EVENT" : creationAudit ? "PACKAGE_SCOPED_AUDIT" : null, transition_source: "PACKAGE_EVENT", unit_resolution_source: "PACKAGE_ITEM_FIXED_REFERENCE", revision_lineage_source: fixedLineage.rows[0] ? "PACKAGE_FIXED_FOREIGN_KEYS" : revisionCurrent.rows[0] ? "RETURN_RESPONSE_HEAD" : null },
        trace_events: traceEvents,
        items: items.rows.map((item) => ({ ...item, creation_validation: creationValidation, bom_lines: byItem.get(Number(item.id)) || [] })),
        documents: documents.rows,
        events: events.rows,
        revision: revisionCurrent.rows[0] || null,
        lineage: fixedLineage.rows[0] || null,
      };
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async packageForUpdate(client: PoolClient, packageId: number): Promise<PackageRow> {
    const result = await client.query<PackageRow>(`select pp.*,p.project_owner from project_planning_packages pp join business_projects p on p.id=pp.project_id where pp.id=$1 for update of pp,p`, [packageId]); if (!result.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_NOT_FOUND", "计划交接包不存在", 404); return result.rows[0];
  }

  async submit(packageId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    assertOnlyKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => { const row = await this.packageForUpdate(client, packageId); this.assertEngineeringOwner(meta.actor, row as unknown as ProjectRow); if (row.status !== "DRAFT" || Number(row.version) !== expected) throw new PlanningHandoffError("PLANNING_PACKAGE_VERSION_CONFLICT", "计划交接包状态或版本已变化", 409);
      const updated = await client.query("update project_planning_packages set status='SUBMITTED',submitted_by=$2,submitted_at=now(),version=version+1,request_id=$3,updated_at=now() where id=$1 and status='DRAFT' and version=$4 returning *", [packageId, meta.actor.username, meta.requestId, expected]); if (!updated.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_VERSION_CONFLICT", "计划交接包状态或版本已变化", 409);
      const eventType = Number(row.package_version_no) > 1 ? "RESUBMITTED" : "SUBMITTED"; await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values($1,$2,$3,$4,$5)", [packageId, Number(row.project_id), eventType, meta.actor.username, meta.requestId]); await this.fault?.("after_submit_event");
      return { status: 200, body: { ok: true, package_id: packageId, data: updated.rows[0], request_id: meta.requestId }, objectId: packageId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  private async decide(packageId: number, meta: PlanningMutationMeta, input: Record<string, unknown>, decision: "ACCEPTED" | "RETURNED"): Promise<PlanningMutationResult> {
    this.assertPlanningDecision(meta.actor); assertOnlyKeys(input, decision === "RETURNED" ? ["expected_version", "reason"] : ["expected_version"]); const expected = expectedVersion(input.expected_version); const reason = decision === "RETURNED" ? boundedText(input.reason, "退回原因", 1000, true) : "";
    return this.repository.execute(meta, async (client) => { const row = await this.packageForUpdate(client, packageId); if (row.status !== "SUBMITTED" || Number(row.version) !== expected) throw new PlanningHandoffError("PLANNING_PACKAGE_VERSION_CONFLICT", "计划交接包已被其他计划员处理", 409); if (row.submitted_by === meta.actor.username) throw new PlanningHandoffError("PLANNING_SELF_DECISION_FORBIDDEN", "提交人不能接收或退回自己的计划交接包", 403);
      const updated = decision === "ACCEPTED"
        ? await client.query("update project_planning_packages set status='ACCEPTED',accepted_by=$2,accepted_at=now(),returned_by=null,returned_at=null,return_reason='',version=version+1,request_id=$3,updated_at=now() where id=$1 and status='SUBMITTED' and version=$4 returning *", [packageId, meta.actor.username, meta.requestId, expected])
        : await client.query("update project_planning_packages set status='RETURNED',returned_by=$2,returned_at=now(),accepted_by=null,accepted_at=null,return_reason=$3,version=version+1,request_id=$4,updated_at=now() where id=$1 and status='SUBMITTED' and version=$5 returning *", [packageId, meta.actor.username, reason, meta.requestId, expected]);
      if (!updated.rows[0]) throw new PlanningHandoffError("PLANNING_PACKAGE_VERSION_CONFLICT", "计划交接包已被其他计划员处理", 409);
      await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,reason,request_id) values($1,$2,$3,$4,$5,$6)", [packageId, Number(row.project_id), decision, meta.actor.username, reason, meta.requestId]); await this.fault?.("after_decision_event");
      return { status: 200, body: { ok: true, package_id: packageId, data: updated.rows[0], request_id: meta.requestId }, objectId: packageId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  accept(packageId: number, meta: PlanningMutationMeta, input: Record<string, unknown>) { return this.decide(packageId, meta, input, "ACCEPTED"); }
  returnToProject(packageId: number, meta: PlanningMutationMeta, input: Record<string, unknown>) { return this.decide(packageId, meta, input, "RETURNED"); }

  async queue(actor: IdentityActor, page: number, pageSize: number, status?: string) {
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403);
    const wanted = status || "SUBMITTED";
    if (!["SUBMITTED", "RETURNED", "ACCEPTED", "PROCESSED"].includes(wanted)) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "status 无效");
    const statuses = wanted === "PROCESSED" ? ["RETURNED", "ACCEPTED"] : [wanted];
    const values: unknown[] = [statuses];
    let visible = "true";
    if (actor.role === "engineering") { values.push(actor.username); visible = `p.project_owner=$${values.length}`; }
    const order = wanted === "SUBMITTED"
      ? "coalesce(pp.submitted_at,pp.prepared_at),pp.id"
      : "coalesce(pp.accepted_at,pp.returned_at,pp.submitted_at,pp.prepared_at) desc,pp.id desc";
    values.push(pageSize, (page - 1) * pageSize);
    const rows = await this.repository.pool.query(`select pp.*,p.project_code,p.project_name,p.project_owner,c.customer_code,c.customer_name,count(pi.id)::int item_count
      from project_planning_packages pp join business_projects p on p.id=pp.project_id join customers c on c.id=p.customer_id
      left join project_planning_package_items pi on pi.package_id=pp.id
      where pp.status=any($1::text[]) and ${visible}
      group by pp.id,p.project_code,p.project_name,p.project_owner,c.customer_code,c.customer_name
      order by ${order} limit $${values.length - 1} offset $${values.length}`, values);
    const count = await this.repository.pool.query(`select count(*)::int count from project_planning_packages pp join business_projects p on p.id=pp.project_id where pp.status=any($1::text[]) and ${visible}`, values.slice(0, values.length - 2));
    return { rows: rows.rows, pagination: { page, page_size: pageSize, total: Number(count.rows[0].count) } };
  }
}
