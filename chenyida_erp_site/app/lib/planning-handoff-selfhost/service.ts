import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { PlanningHandoffError } from "./errors.ts";
import { PlanningHandoffRepository } from "./repository.ts";
import type { PlanningMutationMeta, PlanningMutationResult, ResolutionInput } from "./types.ts";
import { assertOnlyKeys, boundedText, canonicalDigest, expectedVersion, optionalDate, resolutionInput } from "./validation.ts";

type ProjectRow = Record<string, unknown> & { id: string; status: string; version: number; project_owner: string | null; current_requirement_version_no: number; requirement_version_id: string; customer_id: string };
type PackageRow = Record<string, unknown> & { id: string; project_id: string; package_version_no: number; status: string; version: number; prepared_by: string; submitted_by: string | null; project_owner: string | null };
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
      const rows = await client.query(`select ri.id requirement_item_id,ri.line_no,ri.provisional_name,ri.quantity::text,ri.unit_id,ri.unit_pending,ri.specification_requirement,u.code unit_code,
        r.id resolution_id,r.product_id,r.product_version_id,r.bom_header_id,r.bom_version_id,r.resolved_by,r.resolved_at,
        p.product_code,p.product_name,pv.version_code product_version_code,bh.bom_code,bv.version_code bom_version_code
        from project_requirement_items ri left join units u on u.id=ri.unit_id left join project_requirement_resolutions r on r.requirement_item_id=ri.id
        left join products p on p.id=r.product_id left join product_versions pv on pv.id=r.product_version_id left join bom_headers bh on bh.id=r.bom_header_id left join bom_versions bv on bv.id=r.bom_version_id
        where ri.requirement_version_id=$1 order by ri.line_no`, [Number(project.requirement_version_id)]);
      const candidates = await client.query(`select p.id product_id,p.product_code,p.product_name,pv.id product_version_id,pv.version_code product_version_code,pv.product_type,pv.lifecycle_status,
        bh.id bom_header_id,bh.bom_code,bv.id bom_version_id,bv.version_code bom_version_code,count(bl.id)::int bom_line_count
        from products p join product_versions pv on pv.product_id=p.id and pv.status='RELEASED'
        join bom_headers bh on bh.product_id=p.id and bh.status='ACTIVE' join bom_versions bv on bv.bom_header_id=bh.id and bv.product_version_id=pv.id and bv.status='RELEASED'
        join bom_lines bl on bl.bom_version_id=bv.id join material_master m on m.id=bl.material_id and m.material_status='ACTIVE' join units u on u.id=bl.unit_id and u.enabled=true
        where p.status='ACTIVE' and p.customer_id=$1 and p.customer_id is not null
        and not exists(select 1 from bom_lines x left join material_master xm on xm.id=x.material_id left join units xu on xu.id=x.unit_id where x.bom_version_id=bv.id and (xm.id is null or xm.material_status<>'ACTIVE' or xu.id is null or xu.enabled=false))
        group by p.id,p.product_code,p.product_name,pv.id,pv.version_code,pv.product_type,pv.lifecycle_status,bh.id,bh.bom_code,bv.id,bv.version_code order by p.product_code,pv.version_no,bh.bom_code,bv.version_no`, [Number(project.customer_id)]);
      return { project: { id: Number(project.id), project_code: project.project_code, project_name: project.project_name, customer_id: Number(project.customer_id), project_owner: project.project_owner, version: Number(project.version), requirement_version_id: Number(project.requirement_version_id) }, rows: rows.rows, candidates: candidates.rows };
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
      if (currentPackage.rows[0] && currentPackage.rows[0].status !== "RETURNED") throw new PlanningHandoffError("PLANNING_PACKAGE_STATE_CONFLICT", "只能在首次生成交接包前或上一版本退回后修订解析", 409);
      for (const row of parsed.rows) { await this.validateResolution(client, project, row); await client.query(`insert into project_requirement_resolutions(project_id,requirement_version_id,requirement_item_id,product_id,product_version_id,bom_header_id,bom_version_id,resolved_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict(requirement_item_id) do update set product_id=excluded.product_id,product_version_id=excluded.product_version_id,bom_header_id=excluded.bom_header_id,bom_version_id=excluded.bom_version_id,resolved_by=excluded.resolved_by,resolved_at=now(),request_id=excluded.request_id`, [projectId, Number(project.requirement_version_id), row.requirementItemId, row.productId, row.productVersionId, row.bomHeaderId, row.bomVersionId, meta.actor.username, meta.requestId]); }
      await this.fault?.("after_resolutions");
      const body = { ok: true, project_id: projectId, resolved_count: parsed.rows.length, request_id: meta.requestId };
      return { status: 200, body, objectId: projectId, oldVersion: parsed.expected, newVersion: parsed.expected };
    });
  }

  private async snapshotSources(client: PoolClient, project: ProjectRow) {
    const itemCount = await client.query("select count(*)::int count from project_requirement_items where requirement_version_id=$1", [Number(project.requirement_version_id)]);
    const items = await client.query(`select ri.id requirement_item_id,ri.line_no,ri.provisional_name,ri.quantity::text required_quantity,ri.unit_id,ri.specification_requirement,u.code requirement_unit_code,
      r.product_id,r.product_version_id,r.bom_header_id,r.bom_version_id,p.product_code,p.product_name,pv.version_code product_version_code,pv.product_type,pv.lifecycle_status,
      bh.bom_code,bv.version_code bom_version_code
      from project_requirement_items ri join units u on u.id=ri.unit_id and u.enabled=true
      join project_requirement_resolutions r on r.requirement_item_id=ri.id and r.project_id=$2 and r.requirement_version_id=$1
      join products p on p.id=r.product_id and p.status='ACTIVE' and p.customer_id=$3 and p.customer_id is not null
      join product_versions pv on pv.id=r.product_version_id and pv.product_id=p.id and pv.status='RELEASED'
      join bom_headers bh on bh.id=r.bom_header_id and bh.product_id=p.id and bh.status='ACTIVE'
      join bom_versions bv on bv.id=r.bom_version_id and bv.bom_header_id=bh.id and bv.product_version_id=pv.id and bv.status='RELEASED'
      where ri.requirement_version_id=$1 order by ri.line_no`, [Number(project.requirement_version_id), Number(project.id), Number(project.customer_id)]);
    if (Number(itemCount.rows[0].count) < 1 || items.rowCount !== Number(itemCount.rows[0].count)) throw new PlanningHandoffError("REQUIREMENT_ITEMS_UNRESOLVED", "每条需求明细必须关联有效的 Product Version 和 BOM Version", 422);
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

  async createPackage(projectId: number, meta: PlanningMutationMeta, input: Record<string, unknown>): Promise<PlanningMutationResult> {
    assertOnlyKeys(input, ["expected_version", "target_delivery_date"]); const expected = expectedVersion(input.expected_version); const requestedDate = optionalDate(input.target_delivery_date);
    return this.repository.execute(meta, async (client) => {
      const project = await this.acceptedProject(client, projectId, true); this.assertEngineeringOwner(meta.actor, project); if (Number(project.version) !== expected) throw new PlanningHandoffError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      const previous = await client.query("select * from project_planning_packages where project_id=$1 order by package_version_no desc limit 1", [projectId]);
      if (previous.rows[0] && previous.rows[0].status !== "RETURNED") throw new PlanningHandoffError("PLANNING_PACKAGE_STATE_CONFLICT", "当前项目已有未退回或已接收的计划交接包", 409);
      const packageVersionNo = Number(previous.rows[0]?.package_version_no || 0) + 1; const snapshots = await this.snapshotSources(client, project);
      const documents = await client.query(`select l.id project_document_link_id,l.document_type,l.display_name,f.original_filename,f.mime_type,f.sha256,f.size_bytes::text,f.storage_status from project_document_links l join material_import_files f on f.id=l.file_id where l.project_id=$1 and l.requirement_version_id=$2 and f.storage_status='STORED' order by l.id`, [projectId, Number(project.requirement_version_id)]);
      const sourceTargetDate = project.target_delivery_date; const targetDate = requestedDate ?? (sourceTargetDate instanceof Date ? sourceTargetDate.toISOString().slice(0, 10) : sourceTargetDate ? String(sourceTargetDate).slice(0, 10) : null);
      const digestPayload = { project_id: projectId, package_version_no: packageVersionNo, requirement_version_id: Number(project.requirement_version_id), target_delivery_date: targetDate, items: snapshots, documents: documents.rows };
      const packageDigest = canonicalDigest(digestPayload);
      const saved = await client.query(`insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,request_id) values($1,$2,$3,'DRAFT',$4,$5,$6,$7) returning *`, [projectId, packageVersionNo, Number(project.requirement_version_id), targetDate, packageDigest, meta.actor.username, meta.requestId]);
      const packageId = Number(saved.rows[0].id); await this.fault?.("after_package_header");
      for (const item of snapshots) {
        const sourceDigest = canonicalDigest({ ...item, lines: item.lines });
        const packageItem = await client.query(`insert into project_planning_package_items(package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,line_no,source_digest) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [packageId, Number(item.requirement_item_id), Number(item.product_version_id), Number(item.bom_version_id), item.required_quantity, Number(item.unit_id), Number(item.line_no), sourceDigest]);
        for (const line of item.lines) await client.query(`insert into project_planning_package_bom_lines(package_item_id,source_bom_line_id,material_id,unit_id,quantity_per,loss_rate,calculated_gross_quantity,specification_snapshot,material_digest,line_no) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [Number(packageItem.rows[0].id), Number(line.source_bom_line_id), Number(line.material_id), Number(line.unit_id), line.quantity_per, line.loss_rate, line.calculated_gross_quantity, line.specification_snapshot, line.material_digest, Number(line.line_no)]);
      }
      for (const document of documents.rows) await client.query("insert into project_planning_document_links(package_id,project_document_link_id,created_by,request_id) values($1,$2,$3,$4)", [packageId, Number(document.project_document_link_id), meta.actor.username, meta.requestId]);
      await this.fault?.("after_package_snapshot");
      const body = { ok: true, project_id: projectId, package_id: packageId, data: saved.rows[0], item_count: snapshots.length, package_digest: packageDigest, request_id: meta.requestId };
      return { status: 201, body, objectId: packageId, newVersion: 1 };
    });
  }

  async listPackages(actor: IdentityActor, projectId: number) {
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403); const project = await this.repository.pool.query("select project_owner from business_projects where id=$1 and status='ACCEPTED'", [projectId]);
    if (!project.rows[0] || (actor.role === "engineering" && project.rows[0].project_owner !== actor.username)) throw new PlanningHandoffError("PROJECT_NOT_FOUND", "项目不存在", 404);
    const result = await this.repository.pool.query(`select pp.*,count(distinct pi.id)::int item_count,count(bl.id)::int bom_line_count from project_planning_packages pp left join project_planning_package_items pi on pi.package_id=pp.id left join project_planning_package_bom_lines bl on bl.package_item_id=pi.id where pp.project_id=$1 group by pp.id order by pp.package_version_no desc`, [projectId]); return result.rows;
  }

  async detail(actor: IdentityActor, packageId: number) {
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403);
    const header = await this.repository.pool.query(`select pp.*,p.project_code,p.project_name,p.project_goal,p.project_owner,p.customer_id,c.customer_code,c.customer_name,rv.version_no requirement_version_no,rv.customer_requirement_summary from project_planning_packages pp join business_projects p on p.id=pp.project_id join customers c on c.id=p.customer_id join project_requirement_versions rv on rv.id=pp.requirement_version_id where pp.id=$1`, [packageId]);
    if (!header.rows[0] || (actor.role === "engineering" && header.rows[0].project_owner !== actor.username)) throw new PlanningHandoffError("PLANNING_PACKAGE_NOT_FOUND", "计划交接包不存在", 404);
    const [items, lines, documents, events] = await Promise.all([
      this.repository.pool.query(`select pi.*,pi.required_quantity::text,ri.provisional_name,ri.specification_requirement,u.code unit_code,p.product_code,p.product_name,pv.version_code product_version_code,bh.bom_code,bv.version_code bom_version_code from project_planning_package_items pi join project_requirement_items ri on ri.id=pi.requirement_item_id join units u on u.id=pi.unit_id join product_versions pv on pv.id=pi.product_version_id join products p on p.id=pv.product_id join bom_versions bv on bv.id=pi.bom_version_id join bom_headers bh on bh.id=bv.bom_header_id where pi.package_id=$1 order by pi.line_no`, [packageId]),
      this.repository.pool.query(`select bl.*,bl.quantity_per::text,bl.loss_rate::text,bl.calculated_gross_quantity::text,u.code unit_code from project_planning_package_bom_lines bl join project_planning_package_items pi on pi.id=bl.package_item_id join units u on u.id=bl.unit_id where pi.package_id=$1 order by pi.line_no,bl.line_no`, [packageId]),
      this.repository.pool.query(`select dl.id,dl.project_document_link_id,l.document_type,l.display_name,f.original_filename,f.mime_type,f.sha256,f.size_bytes::text,f.storage_status from project_planning_document_links dl join project_document_links l on l.id=dl.project_document_link_id join material_import_files f on f.id=l.file_id where dl.package_id=$1 order by dl.id`, [packageId]),
      this.repository.pool.query("select id,package_id,project_id,event_type,actor,reason,request_id,created_at from project_planning_handoff_events where package_id=$1 order by id", [packageId]),
    ]);
    const byItem = new Map<number, Record<string, unknown>[]>(); for (const line of lines.rows) { const key = Number(line.package_item_id); const rows = byItem.get(key) || []; rows.push(line); byItem.set(key, rows); }
    return { header: header.rows[0], items: items.rows.map((item) => ({ ...item, bom_lines: byItem.get(Number(item.id)) || [] })), documents: documents.rows, events: events.rows };
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
    if (!allowed(actor, "planning.read")) throw new PlanningHandoffError("PERMISSION_DENIED", "没有权限读取计划交接", 403); const wanted = status || "SUBMITTED"; if (!["SUBMITTED", "RETURNED", "ACCEPTED"].includes(wanted)) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "status 无效");
    const values: unknown[] = [wanted]; let visible = "true"; if (actor.role === "engineering") { values.push(actor.username); visible = `p.project_owner=$${values.length}`; }
    values.push(pageSize, (page - 1) * pageSize); const rows = await this.repository.pool.query(`select pp.*,p.project_code,p.project_name,p.project_owner,c.customer_code,c.customer_name,count(pi.id)::int item_count from project_planning_packages pp join business_projects p on p.id=pp.project_id join customers c on c.id=p.customer_id left join project_planning_package_items pi on pi.package_id=pp.id where pp.status=$1 and ${visible} group by pp.id,p.project_code,p.project_name,p.project_owner,c.customer_code,c.customer_name order by coalesce(pp.submitted_at,pp.prepared_at),pp.id limit $${values.length - 1} offset $${values.length}`, values);
    const count = await this.repository.pool.query(`select count(*)::int count from project_planning_packages pp join business_projects p on p.id=pp.project_id where pp.status=$1 and ${visible}`, values.slice(0, values.length - 2)); return { rows: rows.rows, pagination: { page, page_size: pageSize, total: Number(count.rows[0].count) } };
  }
}
