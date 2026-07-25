import type { PoolClient } from "pg";
import { ProjectError } from "./errors.ts";
import { assertOnlyKeys, expectedVersion, positiveId, requirementInput, safeDocumentInput, boundedText } from "./validation.ts";
import { ProjectRepository } from "./repository.ts";
import type { ProjectMutationMeta, ProjectMutationResult, RequirementInput } from "./types.ts";
import type { IdentityActor } from "../identity-selfhost/types.ts";

type ProjectRow = Record<string, unknown> & { id: string; status: string; version: number; market_owner: string; project_owner: string | null; current_requirement_version_no: number };
const marketActor = (actor: IdentityActor) => { if (actor.role !== "sales") throw new ProjectError("MARKET_ROLE_REQUIRED", "只有市场部门人员可以执行此操作", 403); };
const engineeringActor = (actor: IdentityActor) => { if (actor.role !== "engineering") throw new ProjectError("PROJECT_ROLE_REQUIRED", "只有项目部门人员可以执行此操作", 403); };

export class ProjectService {
  readonly repository: ProjectRepository;
  readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: ProjectRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  private visibility(actor: IdentityActor, start = 1) {
    if (actor.role === "sales") return { sql: `p.market_owner=$${start}`, values: [actor.username] };
    if (actor.role === "engineering") return { sql: `(p.status='SUBMITTED' or p.project_owner=$${start})`, values: [actor.username] };
    if (actor.permissions.includes("*") || actor.permissions.includes("project.read_all")) return { sql: "true", values: [] };
    throw new ProjectError("PERMISSION_DENIED", "没有权限读取项目交接", 403);
  }

  async list(actor: IdentityActor, page: number, pageSize: number, status?: string) {
    const visible = this.visibility(actor); const values: unknown[] = [...visible.values]; const conditions = [visible.sql];
    if (status) { if (!new Set(["DRAFT", "SUBMITTED", "RETURNED", "ACCEPTED"]).has(status)) throw new ProjectError("REQUEST_VALIDATION_FAILED", "status 无效"); values.push(status); conditions.push(`p.status=$${values.length}`); }
    values.push(pageSize, (page - 1) * pageSize); const limitAt = values.length - 1; const offsetAt = values.length;
    const rows = await this.repository.pool.query(`select p.*,c.customer_code,c.customer_name,h.id handoff_id,h.status handoff_status,h.version handoff_version,h.submitted_at,h.return_reason,h.accepted_at,
      rv.id requirement_version_id,rv.version_no requirement_version_no,rv.customer_requirement_summary
      from business_projects p join customers c on c.id=p.customer_id join project_requirement_versions rv on rv.project_id=p.id and rv.version_no=p.current_requirement_version_no
      left join project_handoffs h on h.project_id=p.id where ${conditions.join(" and ")} order by p.updated_at desc,p.id desc limit $${limitAt} offset $${offsetAt}`, values);
    const count = await this.repository.pool.query(`select count(*)::int count from business_projects p where ${conditions.join(" and ")}`, values.slice(0, values.length - 2));
    return { rows: rows.rows, pagination: { page, page_size: pageSize, total: Number(count.rows[0].count) } };
  }

  async handoffQueue(actor: IdentityActor, page: number, pageSize: number, status?: string) {
    engineeringActor(actor); const wanted = status || "SUBMITTED"; if (!new Set(["SUBMITTED", "ACCEPTED"]).has(wanted)) throw new ProjectError("REQUEST_VALIDATION_FAILED", "交接队列 status 无效");
    const rows = await this.repository.pool.query(`select h.*,p.project_code,p.project_name,p.project_goal,p.target_delivery_date,p.version project_version,p.project_owner,c.customer_code,c.customer_name,
      rv.version_no requirement_version_no,rv.customer_requirement_summary,rv.quantity_requirement::text,rv.quantity_unit,rv.delivery_requirement,rv.commercial_terms,rv.technical_requirements
      from project_handoffs h join business_projects p on p.id=h.project_id join customers c on c.id=p.customer_id join project_requirement_versions rv on rv.id=h.requirement_version_id
      where h.status=$1 and ($1='SUBMITTED' or p.project_owner=$2) order by h.submitted_at,h.id limit $3 offset $4`, [wanted, actor.username, pageSize, (page - 1) * pageSize]);
    const count = await this.repository.pool.query("select count(*)::int count from project_handoffs h join business_projects p on p.id=h.project_id where h.status=$1 and ($1='SUBMITTED' or p.project_owner=$2)", [wanted, actor.username]);
    return { rows: rows.rows, pagination: { page, page_size: pageSize, total: Number(count.rows[0].count) } };
  }

  async detail(actor: IdentityActor, projectId: number) {
    const visible = this.visibility(actor, 2); const header = await this.repository.pool.query(`select p.*,c.customer_code,c.customer_name,h.id handoff_id,h.status handoff_status,h.version handoff_version,h.submitted_by,h.submitted_at,h.accepted_by,h.accepted_at,h.returned_by,h.returned_at,h.return_reason
      from business_projects p join customers c on c.id=p.customer_id left join project_handoffs h on h.project_id=p.id where p.id=$1 and ${visible.sql}`, [projectId, ...visible.values]);
    if (!header.rows[0]) throw new ProjectError("PROJECT_NOT_FOUND", "项目不存在", 404);
    const [versions, items, documents, events] = await Promise.all([
      this.repository.pool.query("select id,project_id,version_no,customer_requirement_summary,quantity_requirement::text,quantity_unit,delivery_requirement,commercial_terms,technical_requirements,content_digest,created_by,created_at from project_requirement_versions where project_id=$1 order by version_no desc", [projectId]),
      this.repository.pool.query(`select i.*,i.quantity::text,u.code unit_code,p.product_code from project_requirement_items i join project_requirement_versions v on v.id=i.requirement_version_id left join units u on u.id=i.unit_id left join products p on p.id=i.product_id where v.project_id=$1 order by v.version_no desc,i.line_no`, [projectId]),
      this.repository.pool.query(`select l.id,l.project_id,l.requirement_version_id,l.file_id,l.document_type,l.display_name,l.created_by,l.created_at,f.original_filename,f.mime_type,f.sha256,f.size_bytes::text,f.storage_status
        from project_document_links l join material_import_files f on f.id=l.file_id where l.project_id=$1 order by l.id`, [projectId]),
      this.repository.pool.query("select id,handoff_id,project_id,requirement_version_id,event_type,actor,request_id,reason,created_at from project_handoff_events where project_id=$1 order by id", [projectId]),
    ]);
    const itemsByVersion = new Map<number, Record<string, unknown>[]>(); for (const item of items.rows) { const key = Number(item.requirement_version_id); const list = itemsByVersion.get(key) || []; list.push(item); itemsByVersion.set(key, list); }
    return { header: header.rows[0], requirement_versions: versions.rows.map((row) => ({ ...row, items: itemsByVersion.get(Number(row.id)) || [] })), documents: documents.rows, handoff_events: events.rows };
  }

  private async validateReferences(client: PoolClient, customerId: number, requirement: RequirementInput) {
    const customer = await client.query("select 1 from customers where id=$1 and status='ACTIVE'", [customerId]); if (!customer.rows[0]) throw new ProjectError("CUSTOMER_NOT_ACTIVE", "客户不存在或未启用", 422);
    const unitIds = [...new Set(requirement.items.flatMap((item) => item.unitId ? [item.unitId] : []))]; if (unitIds.length) { const found = await client.query("select id from units where id=any($1::bigint[]) and enabled=true", [unitIds]); if (found.rowCount !== unitIds.length) throw new ProjectError("UNIT_NOT_ACTIVE", "需求明细单位不存在或未启用", 422); }
  }

  private async insertRequirement(client: PoolClient, projectId: number, versionNo: number, meta: ProjectMutationMeta, requirement: RequirementInput) {
    const version = await client.query(`insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,delivery_requirement,commercial_terms,technical_requirements,content_digest,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [projectId, versionNo, requirement.customerRequirementSummary, requirement.quantityRequirement, requirement.quantityUnit, requirement.deliveryRequirement, requirement.commercialTerms, requirement.technicalRequirements, requirement.contentDigest, meta.actor.username]);
    for (const item of requirement.items) await client.query(`insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending,specification_requirement) values($1,$2,$3,$4,$5,$6,$7)`, [version.rows[0].id, item.lineNo, item.provisionalName, item.quantity, item.unitId, item.unitPending, item.specificationRequirement]);
    return version.rows[0];
  }

  async create(meta: ProjectMutationMeta, input: Record<string, unknown>): Promise<ProjectMutationResult> {
    marketActor(meta.actor); const customerId = positiveId(input.customer_id, "customer_id"); const requirement = requirementInput(input);
    return this.repository.execute(meta, async (client) => { await this.validateReferences(client, customerId, requirement); const code = await this.repository.nextProjectCode(client);
      const project = await client.query(`insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,$4,$5,'DRAFT',$6,1,1,$7,$5) returning *`, [code, customerId, requirement.projectName, requirement.projectGoal, meta.actor.username, requirement.targetDeliveryDate, meta.requestId]);
      const projectId = Number(project.rows[0].id); const version = await this.insertRequirement(client, projectId, 1, meta, requirement); await this.fault?.("after_project_requirement");
      return { status: 201, body: { ok: true, project_id: projectId, project_code: code, data: { ...project.rows[0], current_requirement: version }, request_id: meta.requestId }, objectId: projectId, newVersion: 1 };
    });
  }

  async revise(projectId: number, meta: ProjectMutationMeta, input: Record<string, unknown>): Promise<ProjectMutationResult> {
    marketActor(meta.actor); const expected = expectedVersion(input.expected_version); const requirement = requirementInput(input);
    return this.repository.execute(meta, async (client) => { const locked = await client.query<ProjectRow>("select * from business_projects where id=$1 for update", [projectId]); const project = locked.rows[0]; if (!project || project.market_owner !== meta.actor.username) throw new ProjectError("PROJECT_NOT_FOUND", "项目不存在", 404); if (!new Set(["DRAFT", "RETURNED"]).has(project.status)) throw new ProjectError("PROJECT_IMMUTABLE_AFTER_SUBMIT", "已提交或已接收项目不能直接修改", 409); if (Number(project.version) !== expected) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      await this.validateReferences(client, Number((project as Record<string, unknown>).customer_id), requirement); const nextNo = Number(project.current_requirement_version_no) + 1; const version = await this.insertRequirement(client, projectId, nextNo, meta, requirement); await this.fault?.("after_project_revision");
      const updated = await client.query("update business_projects set project_name=$2,project_goal=$3,target_delivery_date=$4,current_requirement_version_no=$5,version=version+1,request_id=$6,updated_at=now() where id=$1 and version=$7 returning *", [projectId, requirement.projectName, requirement.projectGoal, requirement.targetDeliveryDate, nextNo, meta.requestId, expected]); if (!updated.rows[0]) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      return { status: 200, body: { ok: true, project_id: projectId, data: { ...updated.rows[0], current_requirement: version }, request_id: meta.requestId }, objectId: projectId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  async submit(projectId: number, meta: ProjectMutationMeta, input: Record<string, unknown>): Promise<ProjectMutationResult> {
    marketActor(meta.actor); assertOnlyKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => { const locked = await client.query<ProjectRow>("select p.*,rv.id requirement_version_id from business_projects p join project_requirement_versions rv on rv.project_id=p.id and rv.version_no=p.current_requirement_version_no where p.id=$1 for update of p", [projectId]); const project = locked.rows[0]; if (!project || project.market_owner !== meta.actor.username) throw new ProjectError("PROJECT_NOT_FOUND", "项目不存在", 404); if (!new Set(["DRAFT", "RETURNED"]).has(project.status)) throw new ProjectError("PROJECT_STATE_CONFLICT", "当前项目状态不能提交", 409); if (Number(project.version) !== expected) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      const eventType = project.status === "RETURNED" ? "RESUBMITTED" : "SUBMITTED"; let handoff;
      if (eventType === "SUBMITTED") handoff = await client.query(`insert into project_handoffs(project_id,requirement_version_id,status,submitted_by,submitted_at,version,request_id) values($1,$2,'SUBMITTED',$3,now(),1,$4) returning *`, [projectId, Number((project as Record<string, unknown>).requirement_version_id), meta.actor.username, meta.requestId]);
      else handoff = await client.query(`update project_handoffs set requirement_version_id=$2,status='SUBMITTED',submitted_by=$3,submitted_at=now(),accepted_by=null,accepted_at=null,returned_by=null,returned_at=null,return_reason='',version=version+1,request_id=$4,updated_at=now() where project_id=$1 and status='RETURNED' returning *`, [projectId, Number((project as Record<string, unknown>).requirement_version_id), meta.actor.username, meta.requestId]);
      if (!handoff.rows[0]) throw new ProjectError("PROJECT_STATE_CONFLICT", "交接状态已变化，请刷新后重试", 409); await this.fault?.("after_handoff_projection");
      await client.query("insert into project_handoff_events(handoff_id,project_id,requirement_version_id,event_type,actor,request_id,reason) values($1,$2,$3,$4,$5,$6,'')", [handoff.rows[0].id, projectId, Number((project as Record<string, unknown>).requirement_version_id), eventType, meta.actor.username, meta.requestId]);
      const updated = await client.query("update business_projects set status='SUBMITTED',project_owner=null,version=version+1,request_id=$2,updated_at=now() where id=$1 and version=$3 returning *", [projectId, meta.requestId, expected]); if (!updated.rows[0]) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409); await this.fault?.("after_submit_event");
      return { status: 200, body: { ok: true, project_id: projectId, data: { project: updated.rows[0], handoff: handoff.rows[0] }, request_id: meta.requestId }, objectId: projectId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  private async decide(projectId: number, meta: ProjectMutationMeta, input: Record<string, unknown>, decision: "ACCEPTED" | "RETURNED"): Promise<ProjectMutationResult> {
    engineeringActor(meta.actor); assertOnlyKeys(input, decision === "RETURNED" ? ["expected_version", "reason"] : ["expected_version"]); const expected = expectedVersion(input.expected_version); const reason = decision === "RETURNED" ? boundedText(input.reason, "退回原因", 1000, true) : "";
    return this.repository.execute(meta, async (client) => { const locked = await client.query<ProjectRow & { handoff_id: string; requirement_version_id: string; submitted_by: string }>(`select p.*,h.id handoff_id,h.requirement_version_id,h.submitted_by from business_projects p join project_handoffs h on h.project_id=p.id where p.id=$1 for update of p,h`, [projectId]); const project = locked.rows[0]; if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "项目不存在", 404); if (project.status !== "SUBMITTED" || Number(project.version) !== expected) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目已被其他人员处理，请刷新", 409); if (project.submitted_by === meta.actor.username) throw new ProjectError("HANDOFF_SELF_ACCEPT_FORBIDDEN", "提交人不能接收自己的项目交接", 403);
      const handoff = decision === "ACCEPTED"
        ? await client.query("update project_handoffs set status='ACCEPTED',accepted_by=$2,accepted_at=now(),returned_by=null,returned_at=null,return_reason='',version=version+1,request_id=$3,updated_at=now() where id=$1 and status='SUBMITTED' returning *", [Number(project.handoff_id), meta.actor.username, meta.requestId])
        : await client.query("update project_handoffs set status='RETURNED',returned_by=$2,returned_at=now(),accepted_by=null,accepted_at=null,return_reason=$3,version=version+1,request_id=$4,updated_at=now() where id=$1 and status='SUBMITTED' returning *", [Number(project.handoff_id), meta.actor.username, reason, meta.requestId]);
      if (!handoff.rows[0]) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目已被其他人员处理，请刷新", 409); await this.fault?.("after_decision_projection");
      await client.query("insert into project_handoff_events(handoff_id,project_id,requirement_version_id,event_type,actor,request_id,reason) values($1,$2,$3,$4,$5,$6,$7)", [Number(project.handoff_id), projectId, Number(project.requirement_version_id), decision, meta.actor.username, meta.requestId, reason]);
      const updated = await client.query("update business_projects set status=$2,project_owner=$3,version=version+1,request_id=$4,updated_at=now() where id=$1 and status='SUBMITTED' and version=$5 returning *", [projectId, decision, decision === "ACCEPTED" ? meta.actor.username : null, meta.requestId, expected]); if (!updated.rows[0]) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目已被其他人员处理，请刷新", 409); await this.fault?.("after_decision_event");
      return { status: 200, body: { ok: true, project_id: projectId, data: { project: updated.rows[0], handoff: handoff.rows[0] }, request_id: meta.requestId }, objectId: projectId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  accept(projectId: number, meta: ProjectMutationMeta, input: Record<string, unknown>) { return this.decide(projectId, meta, input, "ACCEPTED"); }
  returnToMarket(projectId: number, meta: ProjectMutationMeta, input: Record<string, unknown>) { return this.decide(projectId, meta, input, "RETURNED"); }

  async addDocument(projectId: number, meta: ProjectMutationMeta, input: Record<string, unknown>): Promise<ProjectMutationResult> {
    marketActor(meta.actor); const document = safeDocumentInput(input);
    return this.repository.execute(meta, async (client) => { const locked = await client.query<ProjectRow & { requirement_version_id: string }>(`select p.*,rv.id requirement_version_id from business_projects p join project_requirement_versions rv on rv.project_id=p.id and rv.version_no=p.current_requirement_version_no where p.id=$1 for update of p`, [projectId]); const project = locked.rows[0]; if (!project || project.market_owner !== meta.actor.username) throw new ProjectError("PROJECT_NOT_FOUND", "项目不存在", 404); if (!new Set(["DRAFT", "RETURNED"]).has(project.status)) throw new ProjectError("PROJECT_DOCUMENT_STATE_CONFLICT", "只有草稿或退回项目可以修改技术资料", 409); if (Number(project.version) !== document.expectedVersion) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      const file = await client.query("select id,original_filename,mime_type,sha256,size_bytes::text,storage_status from material_import_files where id=$1 and storage_status='STORED'", [document.fileId]); if (!file.rows[0]) throw new ProjectError("CONTROLLED_FILE_NOT_FOUND", "受控文件不存在或不可用", 422);
      const link = await client.query("insert into project_document_links(project_id,requirement_version_id,file_id,document_type,display_name,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7) returning *", [projectId, Number(project.requirement_version_id), document.fileId, document.documentType, document.displayName, meta.actor.username, meta.requestId]);
      const updated = await client.query("update business_projects set version=version+1,request_id=$2,updated_at=now() where id=$1 and version=$3 returning *", [projectId, meta.requestId, document.expectedVersion]); await this.fault?.("after_document_link");
      return { status: 201, body: { ok: true, project_id: projectId, data: { ...link.rows[0], file: file.rows[0], project_version: Number(updated.rows[0].version) }, request_id: meta.requestId }, objectId: projectId, oldVersion: document.expectedVersion, newVersion: document.expectedVersion + 1 };
    });
  }

  async deleteDocument(projectId: number, linkId: number, meta: ProjectMutationMeta, input: Record<string, unknown>): Promise<ProjectMutationResult> {
    marketActor(meta.actor); assertOnlyKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => { const locked = await client.query<ProjectRow>("select * from business_projects where id=$1 for update", [projectId]); const project = locked.rows[0]; if (!project || project.market_owner !== meta.actor.username) throw new ProjectError("PROJECT_NOT_FOUND", "项目不存在", 404); if (!new Set(["DRAFT", "RETURNED"]).has(project.status)) throw new ProjectError("PROJECT_DOCUMENT_STATE_CONFLICT", "只有草稿或退回项目可以修改技术资料", 409); if (Number(project.version) !== expected) throw new ProjectError("PROJECT_VERSION_CONFLICT", "项目版本已变化，请刷新后重试", 409);
      const removed = await client.query("delete from project_document_links where id=$1 and project_id=$2 returning id", [linkId, projectId]); if (!removed.rows[0]) throw new ProjectError("PROJECT_DOCUMENT_NOT_FOUND", "项目资料引用不存在", 404);
      const updated = await client.query("update business_projects set version=version+1,request_id=$2,updated_at=now() where id=$1 and version=$3 returning *", [projectId, meta.requestId, expected]); await this.fault?.("after_document_unlink");
      return { status: 200, body: { ok: true, project_id: projectId, data: { deleted_link_id: linkId, project_version: Number(updated.rows[0].version) }, request_id: meta.requestId }, objectId: projectId, oldVersion: expected, newVersion: expected + 1 };
    });
  }
}
