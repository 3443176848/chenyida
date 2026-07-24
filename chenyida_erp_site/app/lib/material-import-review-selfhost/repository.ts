import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { MaterialImportReviewError, reviewFailure } from "./errors.ts";
import type { ReviewActor, ReviewMutationContext, ReviewRow, ReviewSessionRow } from "./types.ts";

type Queryable = Pick<Pool | PoolClient, "query">;
type IdempotentResult<T> = Readonly<{ data: T; operationId: string; replayed: boolean; statusCode: number }>;

const number = (value: unknown): number => Number(value);
const iso = (value: unknown): string | null => value ? new Date(String(value)).toISOString() : null;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const canReadAny = (actor: ReviewActor): boolean => actor.permissions.includes("*") || actor.permissions.includes("material.import.read_any");

export function reviewSessionDto(row: ReviewSessionRow): Record<string, unknown> {
  return {
    review_session_id: number(row.id),
    import_batch_id: number(row.batch_id),
    normalization_run_id: number(row.normalization_run_id),
    normalization_run_version: Number(row.normalization_run_version),
    normalization_result_digest: row.normalization_result_digest,
    mapping_version_id: number(row.mapping_version_id),
    mapping_content_digest: row.mapping_content_digest,
    review_version: Number(row.review_version),
    status: row.status,
    created_by: row.created_by,
    started_at: iso(row.started_at),
    submitted_at: iso(row.submitted_at),
    finalizing_at: iso(row.finalizing_at),
    finalized_at: iso(row.finalized_at),
    cancelled_at: iso(row.cancelled_at),
    failure_code: row.failure_code,
    failure_message_safe: row.failure_message_safe,
    total_rows: Number(row.total_rows),
    pending_rows: Number(row.pending_rows),
    reviewed_rows: Number(row.reviewed_rows),
    kept_rows: Number(row.kept_rows),
    excluded_rows: Number(row.excluded_rows),
    bind_existing_rows: Number(row.bind_existing_rows),
    create_draft_rows: Number(row.create_draft_rows),
    completed_rows: Number(row.completed_rows),
    failed_rows: Number(row.failed_rows),
    expected_version: Number(row.expected_version),
    supersedes_review_session_id: row.supersedes_review_session_id == null ? null : number(row.supersedes_review_session_id),
    finalization_job_id: row.finalization_job_id ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function reviewRowDto(row: ReviewRow): Record<string, unknown> {
  return {
    review_row_id: number(row.id),
    review_session_id: number(row.review_session_id),
    normalized_row_id: number(row.normalized_row_id),
    source_row_id: number(row.source_row_id),
    source_row_number: Number(row.source_row_number),
    normalization_row_status: row.normalization_row_status,
    error_count: Number(row.error_count ?? 0),
    warning_count: Number(row.warning_count ?? 0),
    row_status: row.row_status,
    disposition: row.disposition,
    decision_reason_code: row.decision_reason_code,
    decision_comment: row.decision_comment,
    existing_material_id: row.existing_material_id == null ? null : number(row.existing_material_id),
    material_draft_id: row.material_draft_id == null ? null : number(row.material_draft_id),
    reviewed_by: row.reviewed_by,
    reviewed_at: iso(row.reviewed_at),
    finalized_at: iso(row.finalized_at),
    failure_code: row.failure_code,
    failure_message_safe: row.failure_message_safe,
    expected_version: Number(row.expected_version),
    updated_at: iso(row.updated_at),
  };
}

export class PostgresMaterialImportReviewRepository {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const value = await work(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async runIdempotent<T extends Record<string, unknown>>(
    context: ReviewMutationContext,
    statusCode: number,
    work: (client: PoolClient, operationId: string, keyDigest: string) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!/^[\x21-\x7e]{8,200}$/.test(context.idempotencyKey)) reviewFailure("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 长度或字符无效", 400);
    const keyDigest = sha256(context.idempotencyKey);
    const scope = `${context.actor.username}:POST:${context.routeScope}:${keyDigest}`;
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [scope]);
      const found = await client.query<{ request_digest: string; operation_id: string; response: T; status_code: number }>(`
        select request_digest,operation_id,response,status_code
        from material_api_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3
        for update
      `, [context.actor.username, context.routeScope, keyDigest]);
      if (found.rows[0]) {
        if (found.rows[0].request_digest !== context.requestDigest) reviewFailure("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求正文", 409);
        return { data: found.rows[0].response, operationId: found.rows[0].operation_id, replayed: true, statusCode: found.rows[0].status_code };
      }
      const operationId = randomUUID();
      const data = await work(client, operationId, keyDigest);
      await client.query(`
        insert into material_api_idempotency
          (username,method,route_scope,key_digest,request_digest,operation_id,state,response,status_code,created_at,updated_at,expires_at)
        values($1,'POST',$2,$3,$4,$5,'COMPLETED',$6,$7,now(),now(),now()+interval '24 hours')
      `, [context.actor.username, context.routeScope, keyDigest, context.requestDigest, operationId, data, statusCode]);
      return { data, operationId, replayed: false, statusCode };
    });
  }

  async visibleBatch(database: Queryable, batchId: number, actor: ReviewActor, lock = false): Promise<QueryResultRow> {
    const result = await database.query(`select * from material_import_batches where id=$1${lock ? " for update" : ""}`, [batchId]);
    const row = result.rows[0];
    if (!row || (!canReadAny(actor) && String(row.created_by) !== actor.username)) reviewFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
    return row;
  }

  async visibleSession(database: Queryable, batchId: number, sessionId: number, actor: ReviewActor, lock = false): Promise<ReviewSessionRow> {
    await this.visibleBatch(database, batchId, actor, false);
    const result = await database.query<ReviewSessionRow>(`
      select * from material_import_review_sessions
      where id=$1 and batch_id=$2${lock ? " for update" : ""}
    `, [sessionId, batchId]);
    if (!result.rows[0]) reviewFailure("IMPORT_REVIEW_SESSION_NOT_FOUND", "复核会话不存在", 404);
    return result.rows[0];
  }

  async currentSession(batchId: number, actor: ReviewActor): Promise<ReviewSessionRow | null> {
    await this.visibleBatch(this.pool, batchId, actor);
    const result = await this.pool.query<ReviewSessionRow>(`
      select * from material_import_review_sessions
      where batch_id=$1 order by review_version desc,id desc limit 1
    `, [batchId]);
    return result.rows[0] ?? null;
  }

  async history(batchId: number, actor: ReviewActor, afterVersion: number, limit: number): Promise<readonly ReviewSessionRow[]> {
    await this.visibleBatch(this.pool, batchId, actor);
    const result = await this.pool.query<ReviewSessionRow>(`
      select * from material_import_review_sessions
      where batch_id=$1 and ($2=0 or review_version<$2)
      order by review_version desc,id desc limit $3
    `, [batchId, afterVersion, limit + 1]);
    return result.rows;
  }

  async createSession(client: PoolClient, batchId: number, runId: number, actor: ReviewActor, supersedesId: number | null, requestId: string): Promise<ReviewSessionRow> {
    await this.visibleBatch(client, batchId, actor, true);
    const run = await client.query(`
      select * from material_import_normalization_runs
      where id=$1 and batch_id=$2 and run_status in ('SUCCEEDED','SUPERSEDED')
        and published_at is not null and result_digest is not null
      for share
    `, [runId, batchId]);
    if (!run.rows[0]) reviewFailure("IMPORT_REVIEW_NORMALIZATION_NOT_PUBLISHED", "只有完整发布的 Normalization 运行可以复核", 422);
    if (supersedesId != null) {
      const previous = await client.query("select * from material_import_review_sessions where id=$1 and normalization_run_id=$2 and status in ('FINALIZED','FINALIZE_FAILED','CANCELLED') for update", [supersedesId, runId]);
      if (!previous.rows[0]) reviewFailure("IMPORT_REVIEW_SUPERSEDED_INVALID", "被替代复核版本不存在或尚未终结", 409);
      if (previous.rows[0].status === "FINALIZE_FAILED") {
        await client.query("update material_import_review_sessions set status='CANCELLED',cancelled_at=now(),expected_version=expected_version+1,updated_at=now() where id=$1", [supersedesId]);
        await this.historyEvent(client, { sessionId: supersedesId, eventType: "REVIEW_FAILED_VERSION_SUPERSEDED", actor: actor.username, requestId, oldVersion: Number(previous.rows[0].expected_version), newVersion: Number(previous.rows[0].expected_version) + 1, details: { normalization_run_id: runId } });
      }
    }
    const active = await client.query("select id from material_import_review_sessions where normalization_run_id=$1 and status in ('DRAFT','IN_REVIEW','READY_TO_FINALIZE','FINALIZING','FINALIZE_FAILED')", [runId]);
    if (active.rows[0]) reviewFailure("IMPORT_REVIEW_SESSION_ACTIVE", "该 Normalization 运行已有活动复核会话", 409);
    const version = await client.query("select coalesce(max(review_version),0)::integer+1 review_version from material_import_review_sessions where normalization_run_id=$1", [runId]);
    const totalRows = Number(run.rows[0].total_rows);
    const inserted = await client.query<ReviewSessionRow>(`
      insert into material_import_review_sessions(
        batch_id,normalization_run_id,normalization_run_version,normalization_result_digest,
        mapping_version_id,mapping_content_digest,review_version,status,created_by,total_rows,pending_rows,
        supersedes_review_session_id
      ) values($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$9,$10) returning *
    `, [batchId, runId, run.rows[0].run_version, run.rows[0].result_digest, run.rows[0].mapping_id, run.rows[0].mapping_digest, Number(version.rows[0].review_version), actor.username, totalRows, supersedesId]);
    const session = inserted.rows[0];
    await client.query(`
      insert into material_import_review_rows(
        review_session_id,normalized_row_id,source_row_id,source_row_number
      )
      select $1,n.id,n.source_row_id,n.source_row_number
      from material_import_normalized_rows n
      where n.normalization_run_id=$2 order by n.id
    `, [session.id, runId]);
    await this.historyEvent(client, { sessionId: number(session.id), eventType: "REVIEW_SESSION_CREATED", actor: actor.username, requestId, oldVersion: null, newVersion: 1, details: { normalization_run_id: runId, review_version: session.review_version } });
    return session;
  }

  async row(database: Queryable, sessionId: number, rowId: number, lock = false): Promise<ReviewRow> {
    const result = await database.query<ReviewRow>(`
      select rr.*,nr.row_status normalization_row_status,nr.error_count,nr.warning_count
      from material_import_review_rows rr
      join material_import_normalized_rows nr on nr.id=rr.normalized_row_id
      where rr.id=$1 and rr.review_session_id=$2${lock ? " for update of rr" : ""}
    `, [rowId, sessionId]);
    if (!result.rows[0]) reviewFailure("IMPORT_REVIEW_ROW_NOT_FOUND", "复核行不存在", 404);
    return result.rows[0];
  }

  async rows(input: Readonly<{ sessionId: number; afterId: number; limit: number; rowStatus?: string; disposition?: string; issueLevel?: string }>): Promise<readonly ReviewRow[]> {
    const values: unknown[] = [input.sessionId, input.afterId];
    const conditions = ["rr.review_session_id=$1", "rr.id>$2"];
    if (input.rowStatus) { values.push(input.rowStatus); conditions.push(`rr.row_status=$${values.length}`); }
    if (input.disposition) { values.push(input.disposition); conditions.push(`rr.disposition=$${values.length}`); }
    if (input.issueLevel) {
      values.push(input.issueLevel);
      conditions.push(`exists(select 1 from material_import_normalization_issues ni where ni.normalized_row_id=rr.normalized_row_id and ni.issue_level=$${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query<ReviewRow>(`
      select rr.*,nr.row_status normalization_row_status,nr.error_count,nr.warning_count
      from material_import_review_rows rr
      join material_import_normalized_rows nr on nr.id=rr.normalized_row_id
      where ${conditions.join(" and ")}
      order by rr.id limit $${values.length}
    `, values);
    return result.rows;
  }

  async rowBundle(sessionId: number, rowId: number): Promise<Record<string, unknown>> {
    const row = await this.row(this.pool, sessionId, rowId);
    const normalizedRowId = number(row.normalized_row_id);
    const [raw, fields, attributes, fieldOverrides, attributeOverrides, issues, resolutions, lineage, validationIssues] = await Promise.all([
      this.pool.query("select id,row_number,raw_values,raw_row_hash from material_import_rows where id=$1", [row.source_row_id]),
      this.pool.query("select * from material_import_normalized_field_candidates where normalized_row_id=$1 order by display_order,id", [normalizedRowId]),
      this.pool.query("select * from material_import_normalized_attribute_candidates where normalized_row_id=$1 order by display_order,id", [normalizedRowId]),
      this.pool.query(`select distinct on(target_field_code) * from material_import_review_field_overrides where review_row_id=$1 order by target_field_code,revision_number desc,id desc`, [rowId]),
      this.pool.query(`select distinct on(attribute_code) * from material_import_review_attribute_overrides where review_row_id=$1 order by attribute_code,revision_number desc,id desc`, [rowId]),
      this.pool.query("select * from material_import_normalization_issues where normalized_row_id=$1 order by id", [normalizedRowId]),
      this.pool.query(`select distinct on(normalization_issue_id) * from material_import_review_issue_resolutions where review_row_id=$1 order by normalization_issue_id,revision_number desc,id desc`, [rowId]),
      this.pool.query("select * from material_import_normalization_lineage where normalized_row_id=$1 order by lineage_ordinal,id", [normalizedRowId]),
      this.pool.query("select * from material_import_review_validation_issues where review_row_id=$1 and is_active order by issue_level,id", [rowId]),
    ]);
    return {
      row: reviewRowDto(row),
      raw: raw.rows[0] ?? null,
      field_candidates: fields.rows,
      attribute_candidates: attributes.rows,
      field_overrides: fieldOverrides.rows,
      attribute_overrides: attributeOverrides.rows,
      normalization_issues: issues.rows,
      issue_resolutions: resolutions.rows,
      review_validation_issues: validationIssues.rows,
      lineage: lineage.rows,
    };
  }

  async activeMaterial(database: Queryable, materialId: number, lock = false): Promise<QueryResultRow | null> {
    const result = await database.query(`
      select id,internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,
             base_uom,material_status,version,updated_at
      from material_master where id=$1${lock ? " for share" : ""}
    `, [materialId]);
    return result.rows[0] ?? null;
  }

  async searchActiveMaterials(actor: ReviewActor, keyword: string, page: number, pageSize: number): Promise<Record<string, unknown>> {
    void actor;
    const pattern = `%${keyword.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const count = await this.pool.query<{ count: string }>(`
      select count(*) count from material_master
      where material_status='ACTIVE' and (
        internal_material_code ilike $1 escape '\' or standard_name ilike $1 escape '\'
        or manufacturer_part_number ilike $1 escape '\'
      )
    `, [pattern]);
    const rows = await this.pool.query(`
      select id,internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,version
      from material_master
      where material_status='ACTIVE' and (
        internal_material_code ilike $1 escape '\' or standard_name ilike $1 escape '\'
        or manufacturer_part_number ilike $1 escape '\'
      )
      order by internal_material_code,id limit $2 offset $3
    `, [pattern, pageSize, (page - 1) * pageSize]);
    return { items: rows.rows.map((row) => ({ ...row, id: number(row.id), category_id: number(row.category_id), version: Number(row.version) })), page, page_size: pageSize, total: Number(count.rows[0].count) };
  }

  async refreshSessionCounts(client: PoolClient, sessionId: number): Promise<ReviewSessionRow> {
    const result = await client.query<ReviewSessionRow>(`
      update material_import_review_sessions s set
        pending_rows=x.pending_rows,reviewed_rows=x.reviewed_rows,kept_rows=x.kept_rows,
        excluded_rows=x.excluded_rows,bind_existing_rows=x.bind_existing_rows,
        create_draft_rows=x.create_draft_rows,completed_rows=x.completed_rows,failed_rows=x.failed_rows,
        updated_at=now()
      from (
        select review_session_id,
          count(*) filter(where disposition='PENDING')::integer pending_rows,
          count(*) filter(where disposition<>'PENDING')::integer reviewed_rows,
          count(*) filter(where disposition='KEEP')::integer kept_rows,
          count(*) filter(where disposition='EXCLUDE')::integer excluded_rows,
          count(*) filter(where disposition='BIND_EXISTING')::integer bind_existing_rows,
          count(*) filter(where disposition='CREATE_DRAFT')::integer create_draft_rows,
          count(*) filter(where row_status='COMPLETED')::integer completed_rows,
          count(*) filter(where row_status='FAILED')::integer failed_rows
        from material_import_review_rows where review_session_id=$1 group by review_session_id
      ) x where s.id=x.review_session_id returning s.*
    `, [sessionId]);
    if (!result.rows[0]) reviewFailure("IMPORT_REVIEW_SESSION_NOT_FOUND", "复核会话不存在", 404);
    return result.rows[0];
  }

  async historyEvent(client: PoolClient, input: Readonly<{
    sessionId: number; rowId?: number | null; eventType: string; actor: string; requestId: string;
    oldVersion?: number | null; newVersion?: number | null; reasonCode?: string | null; details?: Record<string, unknown>;
  }>): Promise<void> {
    await client.query(`
      insert into material_import_review_history(
        review_session_id,review_row_id,event_type,actor,old_version,new_version,reason_code,safe_details,request_id
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [input.sessionId, input.rowId ?? null, input.eventType, input.actor, input.oldVersion ?? null, input.newVersion ?? null, input.reasonCode ?? null, input.details ?? {}, input.requestId]);
  }

  async audit(client: PoolClient, input: Readonly<{
    actor: string; action: string; requestId: string; routeCode: string; batchId: number;
    result?: string; errorCode?: string | null; details?: Record<string, unknown>;
  }>): Promise<void> {
    await client.query(`
      insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
      values($1,$2,$3,$4,$5,$6,$7,now()+interval '1095 days')
    `, [input.actor, input.action, { batch_id: input.batchId, ...(input.details ?? {}) }, input.requestId, input.result ?? "success", input.routeCode, input.errorCode ?? null]);
  }
}

export function mapReviewDatabaseError(error: unknown): never {
  if (error instanceof MaterialImportReviewError) throw error;
  const candidate = error as { code?: string; constraint?: string };
  if (candidate.code === "23505") reviewFailure("IMPORT_REVIEW_CONFLICT", "复核数据已被其他请求更新", 409);
  if (candidate.code === "23503") reviewFailure("IMPORT_REVIEW_REFERENCE_CONFLICT", "复核引用的数据已变化", 409);
  if (candidate.code === "23514" || candidate.code === "P0001") reviewFailure("IMPORT_REVIEW_STATE_CONFLICT", "复核状态或数据约束冲突", 409);
  throw error;
}
