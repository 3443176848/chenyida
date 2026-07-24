import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { mapMaterialDatabaseError, MaterialWorkflowError, materialFailure } from "./errors.ts";
import { validateDraftPayload, type CategoryMetadata } from "./validation.ts";
import type { MaterialActor, MaterialRow, MutationResult, NormalizedAttribute, ValidatedDraft } from "./types.ts";

type Executor = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type Page = Readonly<{ page: number; pageSize: number }>;
type IdempotencyInput = Readonly<{
  actor: string;
  method: string;
  routeScope: string;
  key: string;
  requestDigest: string;
  requestId: string;
  statusCode: number;
}>;
type AuditInput = Readonly<{
  username: string;
  action: string;
  routeCode: string;
  requestId: string;
  materialId?: number | null;
  operationId?: string | null;
  idempotencyKeyDigest?: string | null;
  oldVersion?: number | null;
  newVersion?: number | null;
  details?: Record<string, unknown>;
}>;

const numberValue = (value: unknown) => Number(value);
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function mutationResult(row: MaterialRow): MutationResult {
  return {
    material_id: numberValue(row.id),
    material_status: String(row.material_status),
    status: String(row.material_status),
    version: numberValue(row.version),
    internal_material_code: row.internal_material_code ? String(row.internal_material_code) : null,
  };
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, page_size: pageSize, total, total_pages: total ? Math.ceil(total / pageSize) : 0 };
}

export class PostgresMaterialRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error instanceof MaterialWorkflowError) throw error;
      throw mapMaterialDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async runIdempotent<T extends Record<string, unknown>>(input: IdempotencyInput, work: (client: PoolClient, operationId: string, keyDigest: string) => Promise<T>): Promise<Readonly<{ data: T; operationId: string; replayed: boolean; statusCode: number }>> {
    if (!/^[\x21-\x7e]{8,200}$/.test(input.key)) materialFailure("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 长度或字符无效", 400);
    const keyDigest = sha256(input.key);
    const scope = `${input.actor}:${input.method}:${input.routeScope}:${keyDigest}`;
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [scope]);
      const existing = await client.query<{ request_digest: string; operation_id: string; response: T; status_code: number }>(`
        select request_digest, operation_id, response, status_code
        from material_api_idempotency
        where username=$1 and method=$2 and route_scope=$3 and key_digest=$4
        for update
      `, [input.actor, input.method, input.routeScope, keyDigest]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_digest !== input.requestDigest) materialFailure("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求正文", 409);
        return { data: existing.rows[0].response, operationId: existing.rows[0].operation_id, replayed: true, statusCode: existing.rows[0].status_code };
      }
      const operationId = randomUUID();
      const data = await work(client, operationId, keyDigest);
      await client.query(`
        insert into material_api_idempotency
          (username,method,route_scope,key_digest,request_digest,operation_id,state,response,status_code,created_at,updated_at,expires_at)
        values ($1,$2,$3,$4,$5,$6,'COMPLETED',$7,$8,now(),now(),now()+interval '24 hours')
      `, [input.actor, input.method, input.routeScope, keyDigest, input.requestDigest, operationId, JSON.stringify(data), input.statusCode]);
      return { data, operationId, replayed: false, statusCode: input.statusCode };
    });
  }

  async categoryMetadata(executor: Executor, categoryId: number): Promise<CategoryMetadata | null> {
    const category = await executor.query<{
      id: string; category_code: string; category_name_cn: string; category_level: number;
    }>("select id,category_code,category_name_cn,category_level from material_categories where id=$1 and status='ACTIVE'", [categoryId]);
    if (!category.rows[0]) return null;
    const definitions = await executor.query<{
      id: string; attribute_code: string; attribute_name_cn: string; data_type: string; decimal_scale: number;
      canonical_unit: string; allowed_values: unknown; normalization_rule: string; is_required: boolean;
    }>(`
      select d.id,d.attribute_code,d.attribute_name_cn,d.data_type,d.decimal_scale,d.canonical_unit,
             d.allowed_values,d.normalization_rule,b.is_required
      from material_category_attributes b
      join material_attribute_definitions d on d.id=b.attribute_definition_id
      where b.category_id=$1 and b.status='ACTIVE' and d.status='ACTIVE'
      order by b.sort_order,d.id
    `, [categoryId]);
    const row = category.rows[0];
    return {
      categoryId: numberValue(row.id), categoryCode: row.category_code, categoryName: row.category_name_cn,
      categoryLevel: Number(row.category_level),
      definitions: definitions.rows.map((item) => ({
        definitionId: numberValue(item.id), attributeCode: item.attribute_code, name: item.attribute_name_cn,
        dataType: item.data_type, decimalScale: Number(item.decimal_scale), canonicalUnit: item.canonical_unit,
        allowedValues: Array.isArray(item.allowed_values) ? item.allowed_values.map(String) : [],
        normalizationRule: item.normalization_rule, required: Boolean(item.is_required),
      })),
    };
  }

  async lockMaterial(client: PoolClient, materialId: number): Promise<MaterialRow | null> {
    const result = await client.query<MaterialRow>("select * from material_master where id=$1 for update", [materialId]);
    return result.rows[0] ?? null;
  }

  async materialAttributes(executor: Executor, materialId: number): Promise<readonly Record<string, unknown>[]> {
    const result = await executor.query(`
      select d.id definition_id,d.attribute_code,d.attribute_name_cn,d.data_type,d.decimal_scale,d.canonical_unit,
             v.value,v.normalized_value,v.unit_code,v.source_type
      from material_attribute_values v
      join material_attribute_definitions d on d.id=v.attribute_definition_id
      where v.material_id=$1 order by d.attribute_code
    `, [materialId]);
    return result.rows;
  }

  async insertDraft(client: PoolClient, value: ValidatedDraft, actor: string, requestId: string): Promise<MaterialRow> {
    const basic = value.basic;
    const result = await client.query<MaterialRow>(`
      insert into material_master
        (standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,material_status,
         procurement_type,inventory_type,lot_control_required,shelf_life_days,inspection_type,
         environmental_requirement,source_type,source_ref,version,last_modified_by,created_by,updated_by,request_id)
      values ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$15,$15,$16)
      returning *
    `, [basic.standard_name, value.categoryId, basic.brand, basic.manufacturer, basic.manufacturer_part_number,
      basic.unit, basic.procurement_type, basic.inventory_type, basic.lot_control_required, basic.shelf_life_days,
      basic.inspection_type, basic.environmental_requirement, basic.source_type, basic.source_ref, actor, requestId]);
    const row = result.rows[0];
    await this.replaceAttributes(client, numberValue(row.id), value.attributes, actor, requestId);
    return row;
  }

  async updateDraft(client: PoolClient, materialId: number, expectedVersion: number, value: ValidatedDraft, actor: string, requestId: string): Promise<MaterialRow | null> {
    const basic = value.basic;
    const result = await client.query<MaterialRow>(`
      update material_master set
        standard_name=$1,category_id=$2,brand=$3,manufacturer=$4,manufacturer_part_number=$5,base_uom=$6,
        procurement_type=$7,inventory_type=$8,lot_control_required=$9,shelf_life_days=$10,inspection_type=$11,
        environmental_requirement=$12,version=version+1,last_modified_by=$13,updated_by=$13,updated_at=now(),request_id=$14
      where id=$15 and material_status='DRAFT' and version=$16 returning *
    `, [basic.standard_name, value.categoryId, basic.brand, basic.manufacturer, basic.manufacturer_part_number,
      basic.unit, basic.procurement_type, basic.inventory_type, basic.lot_control_required, basic.shelf_life_days,
      basic.inspection_type, basic.environmental_requirement, actor, requestId, materialId, expectedVersion]);
    if (!result.rows[0]) return null;
    await this.replaceAttributes(client, materialId, value.attributes, actor, requestId);
    return result.rows[0];
  }

  private async replaceAttributes(client: PoolClient, materialId: number, attributes: readonly NormalizedAttribute[], actor: string, requestId: string): Promise<void> {
    await client.query("delete from material_attribute_values where material_id=$1", [materialId]);
    for (const attribute of attributes) {
      await client.query(`
        insert into material_attribute_values
          (material_id,attribute_definition_id,value,normalized_value,unit_code,source_type,source_ref,created_by,updated_by,request_id)
        values ($1,$2,$3,$4,$5,$6,'',$7,$7,$8)
      `, [materialId, attribute.definitionId, JSON.stringify(attribute.value), attribute.normalizedValue, attribute.unitCode, attribute.sourceType, actor, requestId]);
    }
  }

  async transition(client: PoolClient, materialId: number, expectedVersion: number, from: string, to: string, actor: string, requestId: string, extra: Readonly<{ approvedCode?: string; reason?: string }> = {}): Promise<MaterialRow | null> {
    const result = await client.query<MaterialRow>(`
      update material_master set material_status=$1,version=version+1,updated_by=$2,updated_at=now(),request_id=$3,
        submitted_by=case when $1='PENDING_REVIEW' then $2 else submitted_by end,
        submitted_at=case when $1='PENDING_REVIEW' then now() else submitted_at end,
        approved_by=case when $1='ACTIVE' then $2 else approved_by end,
        approved_at=case when $1='ACTIVE' then now() else approved_at end,
        internal_material_code=case when $1='ACTIVE' then $4 else internal_material_code end
      where id=$5 and material_status=$6 and version=$7 returning *
    `, [to, actor, requestId, extra.approvedCode ?? null, materialId, from, expectedVersion]);
    return result.rows[0] ?? null;
  }

  async allocateCategorySequence(client: PoolClient, categoryId: number, categoryCode: string): Promise<number> {
    const result = await client.query<{ allocated: number }>(`
      insert into material_code_sequences(category_id,category_code,next_value)
      values ($1,$2,2)
      on conflict(category_id) do update set
        next_value=material_code_sequences.next_value+1,updated_at=now()
      where material_code_sequences.category_code=excluded.category_code
        and material_code_sequences.next_value<=1000000
      returning next_value-1 allocated
    `, [categoryId, categoryCode]);
    if (!result.rows[0]) materialFailure("MATERIAL_CODE_SEQUENCE_EXHAUSTED", "该分类正式物料编码流水号已用尽或分类编码发生冲突", 409);
    return Number(result.rows[0].allocated);
  }

  async version(client: PoolClient, input: Readonly<{ materialId: number; version: number; eventType: string; reason?: string; changedFields: readonly string[]; snapshot: Record<string, unknown>; actor: string; reviewer?: string; requestId: string }>): Promise<void> {
    await client.query(`
      insert into material_versions
        (material_id,version_no,event_type,change_reason,changed_fields,snapshot,changed_by,reviewed_by,reviewed_at,request_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,case when $8<>'' then now() else null end,$9)
    `, [input.materialId, input.version, input.eventType, input.reason ?? "", JSON.stringify(input.changedFields), JSON.stringify(input.snapshot),
      input.actor, input.reviewer ?? "", input.requestId]);
  }

  async changes(client: PoolClient, input: Readonly<{ materialId: number; changeType: string; fields: readonly Readonly<{ name: string; oldValue: unknown; newValue: unknown }>[]; reason?: string; actor: string; requestId: string }>): Promise<void> {
    for (const field of input.fields) {
      await client.query(`
        insert into material_change_logs(material_id,change_type,field_name,old_value,new_value,change_reason,changed_by,request_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [input.materialId, input.changeType, field.name, field.oldValue === undefined || field.oldValue === null ? null : JSON.stringify(field.oldValue), field.newValue === undefined || field.newValue === null ? null : JSON.stringify(field.newValue), input.reason ?? "", input.actor, input.requestId]);
    }
  }

  async audit(client: PoolClient, input: AuditInput): Promise<void> {
    await client.query(`
      insert into audit_log
        (username,action,detail,request_id,result,route_code,material_id,operation_id,idempotency_key_digest,
         old_version,new_version,retention_until)
      values ($1,$2,$3,$4,'success',$5,$6,$7,$8,$9,$10,now()+interval '1095 days')
    `, [input.username, input.action, JSON.stringify(input.details ?? {}), input.requestId, input.routeCode, input.materialId ?? null,
      input.operationId ?? null, input.idempotencyKeyDigest ?? null, input.oldVersion ?? null, input.newVersion ?? null]);
  }

  result(row: MaterialRow): MutationResult { return mutationResult(row); }

  async categoryTree(view: "tree" | "flat") {
    const result = await this.pool.query(`select id,category_code,category_name_cn,parent_id,category_level,sort_order,version from material_categories where status='ACTIVE' order by category_level,sort_order,id`);
    const nodes = new Map<number, Record<string, unknown>>();
    for (const row of result.rows) nodes.set(numberValue(row.id), { category_id: numberValue(row.id), code: row.category_code, name: row.category_name_cn, level: Number(row.category_level), full_path: "", code_path: "", is_leaf: true, version: Number(row.version), children: [] });
    const roots: Record<string, unknown>[] = [];
    for (const row of result.rows) {
      const node = nodes.get(numberValue(row.id))!; const parent = row.parent_id ? nodes.get(numberValue(row.parent_id)) : undefined;
      if (parent) { (parent.children as unknown[]).push(node); parent.is_leaf = false; } else roots.push(node);
    }
    const flat: Record<string, unknown>[] = [];
    const walk = (node: Record<string, unknown>, names: string[], codes: string[]) => {
      const nextNames = [...names, String(node.name)]; const nextCodes = [...codes, String(node.code)];
      node.full_path = nextNames.join(" / "); node.code_path = nextCodes.join("/"); flat.push(node);
      for (const child of node.children as Record<string, unknown>[]) walk(child, nextNames, nextCodes);
    };
    roots.forEach((root) => walk(root, [], []));
    return view === "flat" ? flat.map((item) => {
      const node = { ...item };
      delete node.children;
      return node;
    }) : roots;
  }

  async categorySchema(categoryId: number) {
    const metadata = await this.categoryMetadata(this.pool, categoryId);
    if (!metadata) return null;
    const path = await this.categoryPath(categoryId);
    return {
      category_id: metadata.categoryId, category_name: metadata.categoryName,
      category_path: path.map((item) => item.category_name).join(" / "),
      schema_version: sha256(JSON.stringify(metadata)),
      attributes: metadata.definitions.map((item, index) => ({
        attribute_code: item.attributeCode, name: item.name, description: "", data_type: item.dataType,
        required: item.required, standard_unit: item.canonicalUnit,
        compatible_units: item.canonicalUnit ? [item.canonicalUnit] : [],
        enum_options: item.allowedValues.map((value) => ({ code: value, label: value })),
        display_order: (index + 1) * 10, enabled: true,
        input_contract: { decimal_scale: item.dataType === "DECIMAL" ? item.decimalScale : null, unit_mode: item.canonicalUnit ? "REQUIRED" : "FORBIDDEN" },
      })),
    };
  }

  private async categoryPath(categoryId: number) {
    const result = await this.pool.query(`
      with recursive path as (
        select id,category_code,category_name_cn,parent_id,category_level from material_categories where id=$1
        union all
        select c.id,c.category_code,c.category_name_cn,c.parent_id,c.category_level from material_categories c join path p on p.parent_id=c.id
      ) select id,category_code,category_name_cn,category_level from path order by category_level
    `, [categoryId]);
    return result.rows.map((row) => ({ category_id: numberValue(row.id), category_code: row.category_code, category_name: row.category_name_cn, level: Number(row.category_level) }));
  }

  private visibility(actor: MaterialActor, params: unknown[]): string {
    const owner = params.push(actor.username);
    const editAny = params.push(actor.permissions.includes("*") || actor.permissions.includes("material.draft.edit_any"));
    const review = params.push(actor.permissions.includes("*") || actor.permissions.includes("material.review.queue"));
    return `(m.material_status in ('ACTIVE','FROZEN','INACTIVE') or m.created_by=$${owner} or $${editAny}::boolean or (m.material_status='PENDING_REVIEW' and $${review}::boolean))`;
  }

  async listMaterials(actor: MaterialActor, input: Page & Record<string, unknown>) {
    const params: unknown[] = []; const where = [this.visibility(actor, params)];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
    if (input.materialStatus) add("m.material_status=?", input.materialStatus);
    if (input.categoryId) add("m.category_id=?", input.categoryId);
    if (input.sourceType) add("m.source_type=?", input.sourceType);
    if (input.createdBy) add("m.created_by=?", input.createdBy);
    if (input.keyword) { params.push(`%${String(input.keyword)}%`); where.push(`(m.internal_material_code ilike $${params.length} or m.standard_name ilike $${params.length} or m.manufacturer ilike $${params.length} or m.manufacturer_part_number ilike $${params.length})`); }
    for (const [key, column, operator] of [["createdFrom","m.created_at",">="],["createdTo","m.created_at","<"],["updatedFrom","m.updated_at",">="],["updatedTo","m.updated_at","<"]] as const) if (input[key]) add(`${column}${operator}?`, input[key]);
    if (input.categoryPath) { params.push(String(input.categoryPath).split("/")[0]); where.push(`exists (with recursive descendants as (select id,category_code,parent_id from material_categories where category_code=$${params.length} union all select c.id,c.category_code,c.parent_id from material_categories c join descendants d on c.parent_id=d.id) select 1 from descendants where id=m.category_id)`); }
    const sorts: Record<string, string> = { updated_at_desc: "m.updated_at desc,m.id desc", updated_at_asc: "m.updated_at,m.id", created_at_desc: "m.created_at desc,m.id desc", created_at_asc: "m.created_at,m.id", standard_name_asc: "m.standard_name,m.id", standard_name_desc: "m.standard_name desc,m.id desc", material_code_asc: "m.internal_material_code nulls last,m.id", material_code_desc: "m.internal_material_code desc nulls last,m.id desc" };
    const order = sorts[String(input.sort)] || sorts.updated_at_desc;
    const total = Number((await this.pool.query<{ count: string }>(`select count(*) count from material_master m where ${where.join(" and ")}`, params)).rows[0].count);
    params.push(input.pageSize, (input.page - 1) * input.pageSize);
    const rows = await this.pool.query(`
      select m.id material_id,m.internal_material_code material_code,m.standard_name,m.material_status,m.category_id,
             c.category_name_cn category_path,m.base_uom unit,m.source_type,m.version current_version,m.created_by,m.updated_at
      from material_master m join material_categories c on c.id=m.category_id
      where ${where.join(" and ")} order by ${order} limit $${params.length - 1} offset $${params.length}
    `, params);
    return { data: rows.rows.map((row) => ({ ...row, material_id: numberValue(row.material_id), category_id: numberValue(row.category_id), current_version: Number(row.current_version), updated_at: iso(row.updated_at) })), pagination: pagination(input.page, input.pageSize, total) };
  }

  async listDrafts(actor: MaterialActor, input: Page & Record<string, unknown>) {
    return this.listMaterials(actor, { ...input, materialStatus: input.materialStatus || "DRAFT", sort: "updated_at_desc" });
  }

  async reviewQueue(input: Page & Record<string, unknown>) {
    const params: unknown[] = []; const where = ["m.material_status='PENDING_REVIEW'"];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
    if (input.categoryId) add("m.category_id=?", input.categoryId);
    if (input.sourceType) add("m.source_type=?", input.sourceType);
    if (input.creator) add("m.created_by=?", input.creator);
    if (input.submittedFrom) add("m.submitted_at>=?", input.submittedFrom);
    if (input.submittedTo) add("m.submitted_at<?", input.submittedTo);
    if (input.keyword) { params.push(`%${String(input.keyword)}%`); where.push(`(m.standard_name ilike $${params.length} or m.manufacturer ilike $${params.length} or m.manufacturer_part_number ilike $${params.length})`); }
    const sorts: Record<string, string> = { submitted_at_desc: "m.submitted_at desc,m.id desc", submitted_at_asc: "m.submitted_at,m.id", standard_name_asc: "m.standard_name,m.id", standard_name_desc: "m.standard_name desc,m.id desc" };
    const total = Number((await this.pool.query<{ count: string }>(`select count(*) count from material_master m where ${where.join(" and ")}`, params)).rows[0].count);
    params.push(input.pageSize, (input.page - 1) * input.pageSize);
    const rows = await this.pool.query(`
      select m.id material_id,m.standard_name,c.category_name_cn category_path,m.created_by creator,m.last_modified_by,
             m.submitted_by,m.submitted_at,m.version current_version,m.source_type
      from material_master m join material_categories c on c.id=m.category_id where ${where.join(" and ")}
      order by ${sorts[String(input.sort)] || sorts.submitted_at_desc} limit $${params.length - 1} offset $${params.length}
    `, params);
    const data = [];
    for (const row of rows.rows) {
      const material = await this.pool.query<MaterialRow>("select * from material_master where id=$1", [row.material_id]);
      const attributes = await this.materialAttributes(this.pool, numberValue(row.material_id));
      const validation = await this.currentValidation(material.rows[0], attributes);
      data.push({ ...row, material_id: numberValue(row.material_id), current_version: Number(row.current_version), submitted_at: iso(row.submitted_at), validation_summary: { basis: validation.basis, valid: validation.valid, error_count: validation.errors.length, warning_count: validation.warnings.length, top_issues: [...validation.errors, ...validation.warnings].slice(0, 5) } });
    }
    return { data, pagination: pagination(input.page, input.pageSize, total) };
  }

  async detail(actor: MaterialActor, materialId: number) {
    const params: unknown[] = [materialId]; const visible = this.visibility(actor, params);
    const result = await this.pool.query<MaterialRow & QueryResultRow>(`select m.* from material_master m where m.id=$1 and ${visible}`, params);
    const row = result.rows[0]; if (!row) return null;
    const attributes = await this.materialAttributes(this.pool, materialId); const categoryPath = await this.categoryPath(numberValue(row.category_id));
    const versions = await this.pool.query(`select version_no version,event_type,changed_by,created_at from material_versions where material_id=$1 order by version_no desc limit 5`, [materialId]);
    const changes = await this.pool.query(`select change_type,field_name,changed_by,created_at from material_change_logs where material_id=$1 order by id desc limit 5`, [materialId]);
    const totals = await this.pool.query<{ versions: string; changes: string; audits: string }>(`select (select count(*) from material_versions where material_id=$1) versions,(select count(*) from material_change_logs where material_id=$1) changes,(select count(*) from audit_log where material_id=$1) audits`, [materialId]);
    const rejection = await this.pool.query(`select version_no version,change_reason reason,reviewed_by,reviewed_at from material_versions where material_id=$1 and event_type='REJECT' order by version_no desc,id desc limit 1`, [materialId]);
    const validation = await this.currentValidation(row, attributes);
    return {
      material: {
        material_id: materialId, material_code: row.internal_material_code ?? null, internal_material_code: row.internal_material_code ?? null,
        standard_name: row.standard_name, category_id: numberValue(row.category_id), brand: row.brand, manufacturer: row.manufacturer,
        manufacturer_part_number: row.manufacturer_part_number, unit: row.base_uom, base_uom: row.base_uom,
        material_status: row.material_status, procurement_type: row.procurement_type, inventory_type: row.inventory_type,
        lot_control_required: row.lot_control_required, shelf_life_days: row.shelf_life_days, inspection_type: row.inspection_type,
        environmental_requirement: row.environmental_requirement, source_type: row.source_type, source_ref: row.source_ref,
        current_version: Number(row.version), version: Number(row.version), created_by: row.created_by,
        last_modified_by: row.last_modified_by, submitted_by: row.submitted_by, submitted_at: iso(row.submitted_at),
        approved_by: row.approved_by, approved_at: iso(row.approved_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at),
      },
      category_path: categoryPath,
      attributes: attributes.map((item) => ({ attribute_code: item.attribute_code, name: item.attribute_name_cn, data_type: item.data_type, value: item.value, unit: item.unit_code, source_type: item.source_type })),
      validation,
      history_summary: {
        versions: { items: versions.rows.map((item) => ({ ...item, version: Number(item.version), created_at: iso(item.created_at) })), total: Number(totals.rows[0].versions), has_more: Number(totals.rows[0].versions) > 5 },
        change_logs: { items: changes.rows.map((item) => ({ ...item, created_at: iso(item.created_at) })), total: Number(totals.rows[0].changes), has_more: Number(totals.rows[0].changes) > 5 },
        audit_logs: { total: Number(totals.rows[0].audits), has_more: Number(totals.rows[0].audits) > 5 },
      },
      last_rejection: rejection.rows[0] ? { ...rejection.rows[0], version: Number(rejection.rows[0].version), reviewed_at: iso(rejection.rows[0].reviewed_at) } : null,
    };
  }

  private async currentValidation(row: MaterialRow, attributes: readonly Record<string, unknown>[]) {
    const metadata = await this.categoryMetadata(this.pool, numberValue(row.category_id));
    let errors: readonly Record<string, unknown>[] = [];
    if (!metadata || metadata.categoryLevel !== 4) errors = [{ code: "MATERIAL_CATEGORY_INVALID", severity: "ERROR", field: "category_id", message: "分类不存在、未启用或不是四级叶子" }];
    else try {
      validateDraftPayload({
        category_id: numberValue(row.category_id),
        basic_fields: {
          standard_name: row.standard_name, unit: row.base_uom, brand: row.brand, manufacturer: row.manufacturer,
          manufacturer_part_number: row.manufacturer_part_number, procurement_type: row.procurement_type,
          inventory_type: row.inventory_type, lot_control_required: row.lot_control_required, shelf_life_days: row.shelf_life_days,
          inspection_type: row.inspection_type, environmental_requirement: row.environmental_requirement,
          source_type: row.source_type, source_ref: row.source_ref,
        },
        attributes: Object.fromEntries(attributes.map((item) => [String(item.attribute_code), { value: item.value, unit: item.unit_code, source: item.source_type, confidence: 1 }])),
      }, metadata);
    } catch (error) {
      errors = error instanceof MaterialWorkflowError && error.details.length ? error.details : [{ code: "MATERIAL_VALIDATION_FAILED", severity: "ERROR", field: "material", message: "当前物料不符合元数据规则" }];
    }
    return { basis: "CURRENT_POSTGRES_METADATA", validated_at: new Date().toISOString(), valid: errors.length === 0, errors, warnings: [] };
  }

  async history(actor: MaterialActor, materialId: number, kind: "versions" | "change-logs" | "audit-logs", page: Page) {
    if (!(await this.detail(actor, materialId))) return null;
    const table = kind === "versions" ? "material_versions" : kind === "change-logs" ? "material_change_logs" : "audit_log";
    const total = Number((await this.pool.query<{ count: string }>(`select count(*) count from ${table} where material_id=$1`, [materialId])).rows[0].count);
    const offset = (page.page - 1) * page.pageSize;
    let sql = "";
    if (kind === "versions") sql = `select version_no version,event_type,change_reason,changed_fields,snapshot,changed_by,reviewed_by,reviewed_at,created_at,request_id operation_id from material_versions where material_id=$1 order by version_no desc limit $2 offset $3`;
    else if (kind === "change-logs") sql = `select change_type,field_name,old_value,new_value,change_reason,changed_by,created_at,request_id operation_id from material_change_logs where material_id=$1 order by id desc limit $2 offset $3`;
    else sql = `select id,username,action,detail,request_id,result,route_code,operation_id,old_version,new_version,error_code,created_at from audit_log where material_id=$1 order by id desc limit $2 offset $3`;
    const rows = await this.pool.query(sql, [materialId, page.pageSize, offset]);
    return { data: rows.rows.map((row) => ({ ...row, ...(row.version !== undefined ? { version: Number(row.version) } : {}), created_at: iso(row.created_at), reviewed_at: iso(row.reviewed_at) })), pagination: pagination(page.page, page.pageSize, total) };
  }
}
