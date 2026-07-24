import type { Pool, PoolClient } from "pg";
import type { BackgroundJobQueue } from "../infrastructure/background-jobs.ts";
import { reviewFailure } from "./errors.ts";
import { PostgresMaterialImportReviewRepository, mapReviewDatabaseError, reviewRowDto, reviewSessionDto } from "./repository.ts";
import { assertReviewEditable } from "./state-machine.ts";
import type {
  OverrideSemantics,
  ReviewActor,
  ReviewDisposition,
  ReviewIssueResolution,
  ReviewMutationContext,
  ReviewSessionRow,
} from "./types.ts";
import { buildEffectiveValues, canonicalReviewJson, reviewDigest, validateAttributeOverride, validateCoreOverride } from "./values.ts";

const positive = (value: unknown, field: string): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) reviewFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是正安全整数`, 400);
  return result;
};

const optionalText = (value: unknown, field: string, maximum = 1000): string => {
  if (value == null) return "";
  if (typeof value !== "string") reviewFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是字符串`, 400);
  const result = value.trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) reviewFailure("REQUEST_VALIDATION_FAILED", `${field} 长度或字符无效`, 400);
  return result;
};

const reasonCode = (value: unknown, required = true): string => {
  const result = optionalText(value, "reason_code", 100).toUpperCase();
  if ((required || result) && !/^[A-Z][A-Z0-9_]{2,99}$/.test(result)) reviewFailure("REQUEST_VALIDATION_FAILED", "reason_code 无效", 400);
  return result;
};

const has = (actor: ReviewActor, permission: string): boolean => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: ReviewActor, permission: string): void => {
  if (!has(actor, permission)) reviewFailure("PERMISSION_DENIED", "没有权限执行此操作", 403);
  if (actor.must_change_password) reviewFailure("PERMISSION_DENIED", "请先修改密码再执行写操作", 403);
};

const expectedVersions = (body: Record<string, unknown>): Readonly<{ session: number; row: number }> => ({
  session: positive(body.expected_session_version, "expected_session_version"),
  row: positive(body.expected_row_version, "expected_row_version"),
});

export function reviewRequestDigest(body: unknown): string {
  return reviewDigest(body);
}

export class MaterialImportReviewService {
  readonly repository: PostgresMaterialImportReviewRepository;
  readonly queue: BackgroundJobQueue;

  constructor(repository: PostgresMaterialImportReviewRepository, queue: BackgroundJobQueue) {
    this.repository = repository;
    this.queue = queue;
  }

  async create(batchId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.create");
    const runId = positive(body.normalization_run_id, "normalization_run_id");
    const supersedesId = body.supersedes_review_session_id == null ? null : positive(body.supersedes_review_session_id, "supersedes_review_session_id");
    return this.repository.runIdempotent(context, 201, async (client) => {
      try {
        const session = await this.repository.createSession(client, batchId, runId, context.actor, supersedesId, context.requestId);
        await this.repository.audit(client, { actor: context.actor.username, action: "IMPORT_REVIEW_SESSION_CREATED", requestId: context.requestId, routeCode: context.routeScope, batchId, details: { review_session_id: Number(session.id), normalization_run_id: runId, review_version: session.review_version } });
        return { data: reviewSessionDto(session) };
      } catch (error) {
        return mapReviewDatabaseError(error);
      }
    });
  }

  async current(batchId: number, actor: ReviewActor) {
    const session = await this.repository.currentSession(batchId, actor);
    return { data: session ? reviewSessionDto(session) : null };
  }

  async history(batchId: number, actor: ReviewActor, afterVersion: number, limit: number) {
    requirePermission(actor, "material.import.review.history");
    const rows = await this.repository.history(batchId, actor, afterVersion, limit);
    const visible = rows.slice(0, limit);
    return { items: visible.map(reviewSessionDto), next_after_version: rows.length > limit ? Number(visible.at(-1)?.review_version ?? 0) : null };
  }

  async rows(input: Readonly<{
    batchId: number; sessionId: number; actor: ReviewActor; afterId: number; limit: number;
    rowStatus?: string; disposition?: string; issueLevel?: string;
  }>) {
    await this.repository.visibleSession(this.repository.pool, input.batchId, input.sessionId, input.actor);
    const rows = await this.repository.rows(input);
    const visible = rows.slice(0, input.limit);
    return { items: visible.map(reviewRowDto), next_after_id: rows.length > input.limit ? Number(visible.at(-1)?.id ?? 0) : null };
  }

  async row(batchId: number, sessionId: number, rowId: number, actor: ReviewActor) {
    await this.repository.visibleSession(this.repository.pool, batchId, sessionId, actor);
    const bundle = await this.repository.rowBundle(sessionId, rowId);
    const effective = buildEffectiveValues({
      fieldCandidates: bundle.field_candidates as never,
      attributeCandidates: bundle.attribute_candidates as never,
      fieldOverrides: bundle.field_overrides as never,
      attributeOverrides: bundle.attribute_overrides as never,
    });
    return { ...bundle, effective_values: effective };
  }

  async statistics(batchId: number, sessionId: number, actor: ReviewActor) {
    const session = await this.repository.visibleSession(this.repository.pool, batchId, sessionId, actor);
    return { data: reviewSessionDto(session) };
  }

  async fieldOverride(batchId: number, sessionId: number, rowId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.edit");
    const versions = expectedVersions(body);
    const code = String(body.target_field_code || "").toUpperCase();
    const semantics = String(body.value_semantics || "") as OverrideSemantics;
    if (!["SET", "CLEAR", "REVERT"].includes(semantics)) reviewFailure("REQUEST_VALIDATION_FAILED", "value_semantics 无效", 400);
    const value = validateCoreOverride(code, semantics, body.override_value);
    const reason = reasonCode(body.reason_code);
    const comment = optionalText(body.comment, "comment");
    return this.mutateRow(batchId, sessionId, rowId, context, versions, async (client, row, session) => {
      const candidate = await client.query("select normalized_value from material_import_normalized_field_candidates where normalized_row_id=$1 and target_field_code=$2", [row.normalized_row_id, code]);
      const previous = await client.query("select id,revision_number from material_import_review_field_overrides where review_row_id=$1 and target_field_code=$2 order by revision_number desc,id desc limit 1 for update", [rowId, code]);
      const revision = Number(previous.rows[0]?.revision_number ?? 0) + 1;
      await client.query(`
        insert into material_import_review_field_overrides(
          review_session_id,review_row_id,target_field_code,original_candidate_value,override_value,value_semantics,
          reason_code,comment,changed_by,revision_number,supersedes_override_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        sessionId,
        rowId,
        code,
        candidate.rows[0]?.normalized_value == null ? null : canonicalReviewJson(candidate.rows[0].normalized_value),
        semantics === "SET" ? canonicalReviewJson(value) : null,
        semantics,
        reason,
        comment,
        context.actor.username,
        revision,
        previous.rows[0]?.id ?? null,
      ]);
      await this.repository.historyEvent(client, { sessionId, rowId, eventType: semantics === "REVERT" ? "FIELD_OVERRIDE_REVERTED" : semantics === "CLEAR" ? "FIELD_EXPLICITLY_CLEARED" : "FIELD_OVERRIDE_CHANGED", actor: context.actor.username, requestId: context.requestId, oldVersion: versions.row, newVersion: versions.row + 1, reasonCode: reason, details: { target_field_code: code, semantics, revision_number: revision } });
      return { target_field_code: code, value_semantics: semantics, revision_number: revision, session_version: Number(session.expected_version) + 1, row_version: versions.row + 1 };
    });
  }

  async attributeOverride(batchId: number, sessionId: number, rowId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.edit");
    const versions = expectedVersions(body);
    const code = String(body.attribute_code || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(code)) reviewFailure("REQUEST_VALIDATION_FAILED", "attribute_code 无效", 400);
    const semantics = String(body.value_semantics || "") as OverrideSemantics;
    if (!["SET", "CLEAR", "REVERT"].includes(semantics)) reviewFailure("REQUEST_VALIDATION_FAILED", "value_semantics 无效", 400);
    const reason = reasonCode(body.reason_code);
    const comment = optionalText(body.comment, "comment");
    return this.mutateRow(batchId, sessionId, rowId, context, versions, async (client, row, session) => {
      const category = await this.effectiveCategory(client, rowId, Number(row.normalized_row_id));
      const definitionResult = await client.query(`
        select d.attribute_code,d.attribute_name_cn,d.data_type,d.allowed_values,d.status,d.canonical_unit,
               coalesce(array_agg(b.category_id) filter(where b.status='ACTIVE'),array[]::bigint[]) category_ids,
               bool_or(b.category_id=$2 and b.status='ACTIVE') is_allowed,
               bool_or(b.category_id=$2 and b.status='ACTIVE' and b.is_required) is_required
        from material_attribute_definitions d
        left join material_category_attributes b on b.attribute_definition_id=d.id
        where d.attribute_code=$1
        group by d.id
      `, [code, category ?? 0]);
      const definition = definitionResult.rows[0] ? {
        code,
        name: String(definitionResult.rows[0].attribute_name_cn),
        dataType: String(definitionResult.rows[0].data_type) as never,
        required: Boolean(definitionResult.rows[0].is_required),
        enabled: definitionResult.rows[0].status === "ACTIVE",
        enumValues: Array.isArray(definitionResult.rows[0].allowed_values) ? definitionResult.rows[0].allowed_values.map(String) : [],
        categoryIds: (definitionResult.rows[0].category_ids as unknown[]).map(Number),
        unitCode: definitionResult.rows[0].canonical_unit ? String(definitionResult.rows[0].canonical_unit) : null,
      } : null;
      const value = validateAttributeOverride(definition, category, semantics, body.override_value);
      const candidate = await client.query("select * from material_import_normalized_attribute_candidates where normalized_row_id=$1 and attribute_code=$2", [row.normalized_row_id, code]);
      const previous = await client.query("select id,revision_number from material_import_review_attribute_overrides where review_row_id=$1 and attribute_code=$2 order by revision_number desc,id desc limit 1 for update", [rowId, code]);
      const revision = Number(previous.rows[0]?.revision_number ?? 0) + 1;
      const original = candidate.rows[0];
      await client.query(`
        insert into material_import_review_attribute_overrides(
          review_session_id,review_row_id,attribute_code,attribute_name_snapshot,data_type_snapshot,
          original_raw_value,original_normalized_value,override_value,value_semantics,unit_or_format,
          reason_code,comment,validation_status,changed_by,revision_number,supersedes_override_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'VALID',$13,$14,$15)
      `, [
        sessionId,
        rowId,
        code,
        definition!.name,
        definition!.dataType,
        original?.raw_value == null ? null : canonicalReviewJson(original.raw_value),
        original?.normalized_value == null ? null : canonicalReviewJson(original.normalized_value),
        semantics === "SET" ? canonicalReviewJson(value) : null,
        semantics,
        optionalText(body.unit_or_format ?? definition!.unitCode ?? "", "unit_or_format", 100),
        reason,
        comment,
        context.actor.username,
        revision,
        previous.rows[0]?.id ?? null,
      ]);
      await this.repository.historyEvent(client, { sessionId, rowId, eventType: semantics === "REVERT" ? "ATTRIBUTE_OVERRIDE_REVERTED" : semantics === "CLEAR" ? "ATTRIBUTE_EXPLICITLY_CLEARED" : "ATTRIBUTE_OVERRIDE_CHANGED", actor: context.actor.username, requestId: context.requestId, oldVersion: versions.row, newVersion: versions.row + 1, reasonCode: reason, details: { attribute_code: code, semantics, revision_number: revision } });
      return { attribute_code: code, value_semantics: semantics, revision_number: revision, session_version: Number(session.expected_version) + 1, row_version: versions.row + 1 };
    });
  }

  async decide(batchId: number, sessionId: number, rowId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.decide");
    const versions = expectedVersions(body);
    const disposition = String(body.disposition || "") as ReviewDisposition;
    if (!["PENDING", "KEEP", "EXCLUDE", "BIND_EXISTING", "CREATE_DRAFT"].includes(disposition)) reviewFailure("REQUEST_VALIDATION_FAILED", "disposition 无效", 400);
    if (disposition === "BIND_EXISTING") requirePermission(context.actor, "material.import.review.bind");
    if (disposition === "CREATE_DRAFT") requirePermission(context.actor, "material.import.review.create_draft");
    const reason = reasonCode(body.decision_reason_code, disposition === "EXCLUDE");
    const comment = optionalText(body.decision_comment, "decision_comment");
    if (disposition === "EXCLUDE" && !comment) reviewFailure("IMPORT_REVIEW_EXCLUDE_REASON_REQUIRED", "排除行必须填写原因", 422);
    const materialId = disposition === "BIND_EXISTING" ? positive(body.existing_material_id, "existing_material_id") : null;
    return this.mutateRow(batchId, sessionId, rowId, context, versions, async (client, row, session) => {
      if (materialId != null) {
        const material = await this.repository.activeMaterial(client, materialId, true);
        if (!material) reviewFailure("MATERIAL_NOT_FOUND", "物料不存在或无权查看", 404);
        if (material.material_status !== "ACTIVE") reviewFailure("IMPORT_REVIEW_MATERIAL_NOT_ACTIVE", "只能选择当前 ACTIVE 物料", 409);
      }
      const updated = await client.query(`
        update material_import_review_rows set
          disposition=$3,row_status=case when $3='PENDING' then 'PENDING' else 'REVIEWED' end,
          decision_reason_code=nullif($4,''),decision_comment=$5,existing_material_id=$6,material_draft_id=null,
          reviewed_by=case when $3='PENDING' then null else $7 end,
          reviewed_at=case when $3='PENDING' then null else now() end,
          failure_code=null,failure_message_safe=null,expected_version=expected_version+1,updated_at=now()
        where id=$1 and review_session_id=$2 and expected_version=$8
      `, [rowId, sessionId, disposition, reason, comment, materialId, context.actor.username, versions.row]);
      if (updated.rowCount !== 1) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核行已被修改，请刷新后重试", 409);
      const event = disposition === "EXCLUDE" ? "REVIEW_ROW_EXCLUDED" : disposition === "BIND_EXISTING" ? "REVIEW_BINDING_SELECTED" : disposition === "CREATE_DRAFT" ? "REVIEW_DRAFT_SELECTED" : disposition === "KEEP" ? "REVIEW_ROW_KEPT" : "REVIEW_ROW_RESET";
      await this.repository.historyEvent(client, { sessionId, rowId, eventType: event, actor: context.actor.username, requestId: context.requestId, oldVersion: versions.row, newVersion: versions.row + 1, reasonCode: reason || null, details: { disposition, existing_material_id: materialId } });
      return { disposition, existing_material_id: materialId, session_version: Number(session.expected_version) + 1, row_version: versions.row + 1 };
    }, false);
  }

  async resolveIssue(batchId: number, sessionId: number, rowId: number, issueId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.issue");
    const versions = expectedVersions(body);
    const status = String(body.resolution_status || "") as ReviewIssueResolution;
    if (!["UNRESOLVED", "RESOLVED_BY_OVERRIDE", "WARNING_ACKNOWLEDGED", "EXCLUDED", "BLOCKING"].includes(status)) reviewFailure("REQUEST_VALIDATION_FAILED", "resolution_status 无效", 400);
    const code = reasonCode(body.resolution_code);
    const comment = optionalText(body.comment, "comment");
    return this.mutateRow(batchId, sessionId, rowId, context, versions, async (client, row, session) => {
      const issue = await client.query("select * from material_import_normalization_issues where id=$1 and normalized_row_id=$2", [issueId, row.normalized_row_id]);
      if (!issue.rows[0]) reviewFailure("IMPORT_REVIEW_ISSUE_NOT_FOUND", "Normalization issue 不存在", 404);
      if (status === "WARNING_ACKNOWLEDGED" && issue.rows[0].issue_level !== "WARNING") reviewFailure("IMPORT_REVIEW_ISSUE_RESOLUTION_INVALID", "只有 WARNING 可以人工确认", 422);
      if (status === "RESOLVED_BY_OVERRIDE" && issue.rows[0].issue_level === "ERROR") {
        const target = String(issue.rows[0].target_code);
        const attributeCode = issue.rows[0].attribute_code || (target.startsWith("attribute.") ? target.slice("attribute.".length) : null);
        const fieldCode = target.startsWith("basic.") ? target.slice("basic.".length) : target;
        const override = attributeCode
          ? await client.query("select value_semantics from material_import_review_attribute_overrides where review_row_id=$1 and attribute_code=$2 order by revision_number desc,id desc limit 1", [rowId, attributeCode])
          : await client.query("select value_semantics from material_import_review_field_overrides where review_row_id=$1 and target_field_code=$2 order by revision_number desc,id desc limit 1", [rowId, fieldCode]);
        if (override.rows[0]?.value_semantics !== "SET") reviewFailure("IMPORT_REVIEW_ERROR_OVERRIDE_REQUIRED", "ERROR 只有在对应字段存在有效人工覆盖后才能标记为已解决", 422);
      }
      const previous = await client.query("select revision_number from material_import_review_issue_resolutions where review_row_id=$1 and normalization_issue_id=$2 order by revision_number desc limit 1 for update", [rowId, issueId]);
      const revision = Number(previous.rows[0]?.revision_number ?? 0) + 1;
      await client.query(`
        insert into material_import_review_issue_resolutions(
          review_session_id,review_row_id,normalization_issue_id,resolution_status,resolution_code,comment,resolved_by,revision_number
        ) values($1,$2,$3,$4,$5,$6,$7,$8)
      `, [sessionId, rowId, issueId, status, code, comment, context.actor.username, revision]);
      await this.repository.historyEvent(client, { sessionId, rowId, eventType: status === "WARNING_ACKNOWLEDGED" ? "REVIEW_WARNING_ACKNOWLEDGED" : "REVIEW_ISSUE_RESOLUTION_CHANGED", actor: context.actor.username, requestId: context.requestId, oldVersion: versions.row, newVersion: versions.row + 1, reasonCode: code, details: { normalization_issue_id: issueId, resolution_status: status, revision_number: revision } });
      return { normalization_issue_id: issueId, resolution_status: status, revision_number: revision, session_version: Number(session.expected_version) + 1, row_version: versions.row + 1 };
    });
  }

  async bulkDecide(batchId: number, sessionId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.bulk");
    const sessionVersion = positive(body.expected_session_version, "expected_session_version");
    const rowIds = Array.isArray(body.review_row_ids) ? [...new Set(body.review_row_ids.map((value) => positive(value, "review_row_ids")))] : [];
    if (!rowIds.length || rowIds.length > 200) reviewFailure("REQUEST_VALIDATION_FAILED", "批量操作必须包含 1 到 200 行", 400);
    const disposition = String(body.disposition || "") as ReviewDisposition;
    if (!["KEEP", "EXCLUDE"].includes(disposition)) reviewFailure("REQUEST_VALIDATION_FAILED", "批量操作只支持 KEEP 或 EXCLUDE", 400);
    const reason = reasonCode(body.decision_reason_code, disposition === "EXCLUDE");
    const comment = optionalText(body.decision_comment, "decision_comment");
    if (disposition === "EXCLUDE" && !comment) reviewFailure("IMPORT_REVIEW_EXCLUDE_REASON_REQUIRED", "批量排除必须填写原因", 422);
    return this.repository.runIdempotent(context, 200, async (client) => {
      const session = await this.lockEditableSession(client, batchId, sessionId, context.actor, sessionVersion);
      const changed = await client.query(`
        update material_import_review_rows set
          disposition=$3,row_status='REVIEWED',decision_reason_code=nullif($4,''),decision_comment=$5,
          existing_material_id=null,material_draft_id=null,reviewed_by=$6,reviewed_at=now(),
          failure_code=null,failure_message_safe=null,expected_version=expected_version+1,updated_at=now()
        where review_session_id=$1 and id=any($2::bigint[])
          and row_status in ('PENDING','REVIEWED')
        returning id
      `, [sessionId, rowIds, disposition, reason, comment, context.actor.username]);
      if (changed.rowCount !== rowIds.length) reviewFailure("IMPORT_REVIEW_BULK_CONFLICT", "部分复核行已变化，请刷新后重试", 409);
      await this.bumpSession(client, sessionId, sessionVersion);
      await this.repository.refreshSessionCounts(client, sessionId);
      await this.repository.historyEvent(client, { sessionId, eventType: disposition === "EXCLUDE" ? "REVIEW_ROWS_BULK_EXCLUDED" : "REVIEW_ROWS_BULK_KEPT", actor: context.actor.username, requestId: context.requestId, oldVersion: sessionVersion, newVersion: sessionVersion + 1, reasonCode: reason || null, details: { row_count: rowIds.length } });
      await this.repository.audit(client, { actor: context.actor.username, action: "IMPORT_REVIEW_BULK_DECISION", requestId: context.requestId, routeCode: context.routeScope, batchId, details: { review_session_id: sessionId, disposition, row_count: rowIds.length, previous_status: session.status } });
      return { changed_rows: rowIds.length, disposition, session_version: sessionVersion + 1 };
    });
  }

  async validate(batchId: number, sessionId: number, actor: ReviewActor) {
    const session = await this.repository.visibleSession(this.repository.pool, batchId, sessionId, actor);
    const result = await this.validationSummary(this.repository.pool, sessionId);
    return { data: { review_session: reviewSessionDto(session), ...result, can_finalize: result.blocking_count === 0 } };
  }

  async finalize(batchId: number, sessionId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.finalize");
    const sessionVersion = positive(body.expected_version, "expected_version");
    return this.repository.runIdempotent(context, 202, async (client) => {
      const session = await this.lockEditableSession(client, batchId, sessionId, context.actor, sessionVersion);
      const validation = await this.validationSummary(client, sessionId);
      if (validation.blocking_count > 0) reviewFailure("IMPORT_REVIEW_NOT_READY", "复核仍有未决定行、KEEP 行或未解决问题", 422);
      const jobId = await this.queue.enqueue(client, {
        type: "material.import.review.finalize",
        payload: { batch_id: batchId, review_session_id: sessionId, submitted_by: context.actor.username, request_id: context.requestId },
        idempotencyKey: reviewDigest({ kind: "review-finalization", session_id: sessionId }),
        aggregateType: "material_import_review_session",
        aggregateId: String(sessionId),
      });
      const finalization = await client.query(`
        insert into material_import_review_finalizations(
          review_session_id,review_expected_version,status,job_id,total_rows,submitted_by
        ) values($1,$2,'PREPARING',$3,$4,$5) returning id
      `, [sessionId, sessionVersion + 1, jobId, Number(session.total_rows), context.actor.username]);
      const updated = await client.query(`
        update material_import_review_sessions set
          status='FINALIZING',submitted_at=now(),finalizing_at=now(),finalization_job_id=$3,
          failure_code=null,failure_message_safe=null,expected_version=expected_version+1,updated_at=now()
        where id=$1 and expected_version=$2
      `, [sessionId, sessionVersion, jobId]);
      if (updated.rowCount !== 1) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核会话已变化，请刷新后重试", 409);
      await this.repository.historyEvent(client, { sessionId, eventType: "REVIEW_FINALIZATION_SUBMITTED", actor: context.actor.username, requestId: context.requestId, oldVersion: sessionVersion, newVersion: sessionVersion + 1, details: { finalization_id: Number(finalization.rows[0].id), job_id: jobId } });
      await this.repository.audit(client, { actor: context.actor.username, action: "IMPORT_REVIEW_FINALIZATION_SUBMITTED", requestId: context.requestId, routeCode: context.routeScope, batchId, details: { review_session_id: sessionId, job_id: jobId } });
      return { review_session_id: sessionId, finalization_id: Number(finalization.rows[0].id), job_id: jobId, status: "FINALIZING", expected_version: sessionVersion + 1 };
    });
  }

  async progress(batchId: number, sessionId: number, actor: ReviewActor) {
    const session = await this.repository.visibleSession(this.repository.pool, batchId, sessionId, actor);
    const result = await this.repository.pool.query(`
      select f.*,j.status job_status,j.attempt_count,j.max_attempts,j.last_error_code
      from material_import_review_finalizations f
      left join background_jobs j on j.id=f.job_id
      where f.review_session_id=$1
    `, [sessionId]);
    const failures = await this.repository.pool.query(`
      select fr.id finalization_row_id,fr.review_row_id,fr.operation_type,fr.attempt_count,
             fr.failure_code,fr.failure_message_safe
      from material_import_review_finalization_rows fr
      join material_import_review_finalizations f on f.id=fr.finalization_id
      where f.review_session_id=$1 and fr.operation_status='FAILED'
      order by fr.id limit 100
    `, [sessionId]);
    return { data: { review_session: reviewSessionDto(session), finalization: result.rows[0] ?? null, failures: failures.rows } };
  }

  async retry(batchId: number, sessionId: number, context: ReviewMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.review.retry");
    const expected = positive(body.expected_version, "expected_version");
    return this.repository.runIdempotent(context, 202, async (client) => {
      const session = await this.repository.visibleSession(client, batchId, sessionId, context.actor, true);
      if (session.status !== "FINALIZE_FAILED") reviewFailure("IMPORT_REVIEW_STATUS_CONFLICT", "只有 FINALIZE_FAILED 会话可以重试", 409);
      if (Number(session.expected_version) !== expected) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核会话已变化，请刷新后重试", 409, { currentVersion: Number(session.expected_version) });
      const finalization = await client.query("select * from material_import_review_finalizations where review_session_id=$1 for update", [sessionId]);
      if (!finalization.rows[0]) reviewFailure("IMPORT_REVIEW_FINALIZATION_NOT_FOUND", "最终处理记录不存在", 404);
      await client.query("update material_import_review_finalization_rows set operation_status='PENDING',failure_code=null,failure_message_safe=null,started_at=null,updated_at=now() where finalization_id=$1 and operation_status='FAILED'", [finalization.rows[0].id]);
      const jobId = await this.queue.enqueue(client, {
        type: "material.import.review.finalize",
        payload: { batch_id: batchId, review_session_id: sessionId, submitted_by: context.actor.username, request_id: context.requestId },
        idempotencyKey: reviewDigest({ kind: "review-finalization-retry", session_id: sessionId, version: expected }),
        aggregateType: "material_import_review_session",
        aggregateId: String(sessionId),
      });
      await client.query("update material_import_review_finalizations set status=case when sealed_at is null then 'PREPARING' else 'SEALED' end,job_id=$2,failure_code=null,failure_message_safe=null,updated_at=now() where id=$1", [finalization.rows[0].id, jobId]);
      await client.query("update material_import_review_sessions set status='FINALIZING',finalization_job_id=$2,failure_code=null,failure_message_safe=null,expected_version=expected_version+1,updated_at=now() where id=$1", [sessionId, jobId]);
      await this.repository.historyEvent(client, { sessionId, eventType: "REVIEW_FINALIZATION_RETRIED", actor: context.actor.username, requestId: context.requestId, oldVersion: expected, newVersion: expected + 1, details: { job_id: jobId } });
      return { review_session_id: sessionId, job_id: jobId, status: "FINALIZING", expected_version: expected + 1 };
    });
  }

  async searchActiveMaterials(actor: ReviewActor, keyword: string, page: number, pageSize: number) {
    requirePermission(actor, "material.import.review.search_material");
    if (keyword.length < 2 || keyword.length > 100) reviewFailure("REQUEST_VALIDATION_FAILED", "搜索关键字长度必须为 2 到 100", 400);
    return this.repository.searchActiveMaterials(actor, keyword, page, pageSize);
  }

  private async mutateRow<T extends Record<string, unknown>>(
    batchId: number,
    sessionId: number,
    rowId: number,
    context: ReviewMutationContext,
    versions: Readonly<{ session: number; row: number }>,
    work: (client: PoolClient, row: Record<string, unknown>, session: ReviewSessionRow) => Promise<T>,
    bumpRow = true,
  ) {
    return this.repository.runIdempotent(context, 200, async (client) => {
      try {
        const session = await this.lockEditableSession(client, batchId, sessionId, context.actor, versions.session);
        const row = await this.repository.row(client, sessionId, rowId, true);
        if (Number(row.expected_version) !== versions.row) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核行已变化，请刷新后重试", 409, { currentVersion: Number(row.expected_version) });
        const data = await work(client, row, session);
        if (bumpRow) {
          const bumped = await client.query("update material_import_review_rows set expected_version=expected_version+1,updated_at=now() where id=$1 and expected_version=$2", [rowId, versions.row]);
          if (bumped.rowCount !== 1) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核行已变化，请刷新后重试", 409);
        }
        await this.bumpSession(client, sessionId, versions.session);
        await this.repository.refreshSessionCounts(client, sessionId);
        await this.repository.audit(client, { actor: context.actor.username, action: "IMPORT_REVIEW_ROW_MUTATED", requestId: context.requestId, routeCode: context.routeScope, batchId, details: { review_session_id: sessionId, review_row_id: rowId } });
        return data;
      } catch (error) {
        return mapReviewDatabaseError(error);
      }
    });
  }

  private async lockEditableSession(client: PoolClient, batchId: number, sessionId: number, actor: ReviewActor, expected: number): Promise<ReviewSessionRow> {
    const session = await this.repository.visibleSession(client, batchId, sessionId, actor, true);
    assertReviewEditable(session.status);
    if (Number(session.expected_version) !== expected) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核会话已变化，请刷新后重试", 409, { currentVersion: Number(session.expected_version) });
    return session;
  }

  private async bumpSession(client: PoolClient, sessionId: number, expected: number): Promise<void> {
    const result = await client.query(`
      update material_import_review_sessions set
        status=case when status='DRAFT' then 'IN_REVIEW' else status end,
        expected_version=expected_version+1,updated_at=now()
      where id=$1 and expected_version=$2
    `, [sessionId, expected]);
    if (result.rowCount !== 1) reviewFailure("IMPORT_REVIEW_VERSION_CONFLICT", "复核会话已变化，请刷新后重试", 409);
  }

  private async effectiveCategory(client: PoolClient, rowId: number, normalizedRowId: number): Promise<number | null> {
    const override = await client.query(`
      select value_semantics,override_value from material_import_review_field_overrides
      where review_row_id=$1 and target_field_code='CATEGORY_ID'
      order by revision_number desc,id desc limit 1
    `, [rowId]);
    if (override.rows[0]?.value_semantics === "SET") return Number(override.rows[0].override_value);
    if (override.rows[0]?.value_semantics === "CLEAR") return null;
    const candidate = await client.query("select normalized_value from material_import_normalized_field_candidates where normalized_row_id=$1 and target_field_code='CATEGORY_ID'", [normalizedRowId]);
    return candidate.rows[0]?.normalized_value == null ? null : Number(candidate.rows[0].normalized_value);
  }

  private async validationSummary(database: Pick<Pool | PoolClient, "query">, sessionId: number) {
    const summary = await database.query(`
      with latest_resolution as (
        select distinct on(review_row_id,normalization_issue_id)
          review_row_id,normalization_issue_id,resolution_status
        from material_import_review_issue_resolutions
        where review_session_id=$1
        order by review_row_id,normalization_issue_id,revision_number desc,id desc
      )
      select
        count(*) filter(where rr.disposition='PENDING')::integer pending_decisions,
        count(*) filter(where rr.disposition='KEEP')::integer kept_without_action,
        count(*) filter(where rr.disposition='BIND_EXISTING' and (m.id is null or m.material_status<>'ACTIVE'))::integer invalid_bindings,
        (
          select count(*)::integer
          from material_import_normalization_issues ni
          join material_import_review_rows r2 on r2.normalized_row_id=ni.normalized_row_id and r2.review_session_id=$1
          left join latest_resolution lr on lr.review_row_id=r2.id and lr.normalization_issue_id=ni.id
          where r2.disposition<>'EXCLUDE' and (
            (ni.issue_level='ERROR' and coalesce(lr.resolution_status,'UNRESOLVED')<>'RESOLVED_BY_OVERRIDE')
            or (ni.issue_level='WARNING' and coalesce(lr.resolution_status,'UNRESOLVED')<>'WARNING_ACKNOWLEDGED')
          )
        )::integer unresolved_issues,
        (
          select count(*)::integer from material_import_review_validation_issues vi
          where vi.review_session_id=$1 and vi.is_active and vi.issue_level='ERROR'
        )::integer validation_errors
      from material_import_review_rows rr
      left join material_master m on m.id=rr.existing_material_id
      where rr.review_session_id=$1
    `, [sessionId]);
    const row = summary.rows[0];
    const result = {
      pending_decisions: Number(row.pending_decisions),
      kept_without_action: Number(row.kept_without_action),
      invalid_bindings: Number(row.invalid_bindings),
      unresolved_issues: Number(row.unresolved_issues),
      validation_errors: Number(row.validation_errors),
    };
    return { ...result, blocking_count: Object.values(result).reduce((sum, value) => sum + value, 0) };
  }
}
