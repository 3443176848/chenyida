import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { JobLease } from "../infrastructure/background-jobs.ts";
import { PostgresMaterialRepository } from "../material-selfhost/repository.ts";
import { MaterialWorkflowService } from "../material-selfhost/service.ts";
import { MaterialWorkflowError } from "../material-selfhost/errors.ts";
import { MaterialImportReviewError, reviewFailure } from "./errors.ts";
import { PostgresMaterialImportReviewRepository } from "./repository.ts";
import { buildEffectiveValues, reviewDigest } from "./values.ts";

const PREPARE_CHUNK = 100;
const PROCESS_CHUNK = 50;
const number = (value: unknown): number => Number(value);

type Publication = Readonly<{ result: Record<string, unknown>; publish?: (client: PoolClient) => Promise<void> }>;

export class PostgresMaterialImportReviewWorker {
  readonly pool: Pool;
  readonly reviewRepository: PostgresMaterialImportReviewRepository;
  readonly materialService: MaterialWorkflowService;

  constructor(pool: Pool) {
    this.pool = pool;
    this.reviewRepository = new PostgresMaterialImportReviewRepository(pool);
    this.materialService = new MaterialWorkflowService(new PostgresMaterialRepository(pool));
  }

  async prepare(job: JobLease): Promise<Publication> {
    const batchId = number(job.payload.batch_id);
    const sessionId = number(job.payload.review_session_id);
    if (!Number.isSafeInteger(batchId) || !Number.isSafeInteger(sessionId)) reviewFailure("IMPORT_REVIEW_JOB_INVALID", "复核任务参数无效", 500);
    const session = await this.pool.query("select status,finalization_job_id from material_import_review_sessions where id=$1 and batch_id=$2", [sessionId, batchId]);
    if (!session.rows[0]) reviewFailure("IMPORT_REVIEW_SESSION_NOT_FOUND", "复核会话不存在", 404);
    if (session.rows[0].status === "FINALIZED") return { result: { batch_id: batchId, review_session_id: sessionId, status: "FINALIZED" } };
    if (String(session.rows[0].finalization_job_id) !== job.id) reviewFailure("IMPORT_REVIEW_LEASE_LOST", "复核任务已经被替代", 409, { retryable: true });

    await this.prepareSnapshot(job, sessionId);
    while (await this.processChunk(job, batchId, sessionId)) {
      // Each iteration is bounded and verifies the current queue lease in the same
      // transaction as its material side effect and result write.
    }
    const result = await this.finish(job, batchId, sessionId);
    return { result };
  }

  async markTerminalFailure(job: JobLease, safeCode: string): Promise<void> {
    const sessionId = number(job.payload.review_session_id);
    if (!Number.isSafeInteger(sessionId)) return;
    await this.pool.query(`
      update material_import_review_finalizations
      set status='FAILED',failure_code=$3,failure_message_safe='最终处理任务失败，可安全重试',updated_at=now()
      where review_session_id=$1 and job_id=$2 and status<>'COMPLETED'
    `, [sessionId, job.id, this.safeCode(safeCode)]).catch(() => undefined);
    await this.pool.query(`
      update material_import_review_sessions
      set status='FINALIZE_FAILED',failure_code=$3,failure_message_safe='最终处理任务失败，可安全重试',
          expected_version=expected_version+1,updated_at=now()
      where id=$1 and finalization_job_id=$2 and status='FINALIZING'
    `, [sessionId, job.id, this.safeCode(safeCode)]).catch(() => undefined);
  }

  private async prepareSnapshot(job: JobLease, sessionId: number): Promise<void> {
    for (;;) {
      const prepared = await this.reviewRepository.transaction(async (client) => {
        await this.assertLease(client, job, sessionId);
        const finalization = await client.query("select * from material_import_review_finalizations where review_session_id=$1 for update", [sessionId]);
        const record = finalization.rows[0];
        if (!record) reviewFailure("IMPORT_REVIEW_FINALIZATION_NOT_FOUND", "最终处理记录不存在", 404);
        if (record.status !== "PREPARING") return 0;
        const pending = await client.query(`
          select rr.*
          from material_import_review_rows rr
          where rr.review_session_id=$1 and not exists(
            select 1 from material_import_review_finalization_rows fr
            where fr.finalization_id=$2 and fr.review_row_id=rr.id
          )
          order by rr.id limit $3 for update of rr skip locked
        `, [sessionId, record.id, PREPARE_CHUNK]);
        for (const row of pending.rows) {
          if (!["EXCLUDE", "BIND_EXISTING", "CREATE_DRAFT"].includes(String(row.disposition))) reviewFailure("IMPORT_REVIEW_NOT_READY", "复核行没有可执行的最终决定", 422);
          const effective = await this.effectiveValues(client, number(row.id), number(row.normalized_row_id));
          const payload = {
            schema_version: 1,
            review_session_id: sessionId,
            review_row_id: number(row.id),
            normalized_row_id: number(row.normalized_row_id),
            source_row_id: number(row.source_row_id),
            source_row_number: Number(row.source_row_number),
            disposition: row.disposition,
            decision_reason_code: row.decision_reason_code,
            decision_comment: row.decision_comment,
            existing_material_id: row.existing_material_id == null ? null : number(row.existing_material_id),
            effective_values: effective,
          };
          const payloadDigest = reviewDigest(payload);
          const operationKey = reviewDigest({ kind: "material-import-review-row", session_id: sessionId, row_id: number(row.id), payload_digest: payloadDigest });
          await client.query(`
            insert into material_import_review_finalization_rows(
              finalization_id,review_row_id,normalized_row_id,operation_type,operation_key,
              final_payload,final_payload_digest,existing_material_id
            ) values($1,$2,$3,$4,$5,$6,$7,$8)
            on conflict(finalization_id,review_row_id) do nothing
          `, [record.id, row.id, row.normalized_row_id, row.disposition, operationKey, payload, payloadDigest, row.existing_material_id]);
        }
        await client.query(`
          update material_import_review_finalizations f set prepared_rows=x.count,updated_at=now()
          from (select count(*)::integer count from material_import_review_finalization_rows where finalization_id=$1) x
          where f.id=$1
        `, [record.id]);
        return pending.rowCount ?? 0;
      });
      if (prepared === 0) break;
    }
    await this.reviewRepository.transaction(async (client) => {
      await this.assertLease(client, job, sessionId);
      const finalization = await client.query("select * from material_import_review_finalizations where review_session_id=$1 for update", [sessionId]);
      const record = finalization.rows[0];
      if (record.status !== "PREPARING") return;
      const hashes = await client.query("select final_payload_digest from material_import_review_finalization_rows where finalization_id=$1 order by review_row_id", [record.id]);
      if (hashes.rowCount !== Number(record.total_rows)) reviewFailure("IMPORT_REVIEW_SNAPSHOT_INCOMPLETE", "最终提交快照行数不完整", 500, { retryable: true });
      const digest = reviewDigest({ schema_version: Number(record.snapshot_schema_version), row_digests: hashes.rows.map((row) => row.final_payload_digest) });
      await client.query("update material_import_review_finalizations set status='PROCESSING',snapshot_digest=$2,sealed_at=now(),prepared_rows=total_rows,updated_at=now() where id=$1", [record.id, digest]);
    });
  }

  private async processChunk(job: JobLease, batchId: number, sessionId: number): Promise<boolean> {
    const ids = await this.pool.query(`
      select fr.id
      from material_import_review_finalization_rows fr
      join material_import_review_finalizations f on f.id=fr.finalization_id
      where f.review_session_id=$1 and fr.operation_status='PENDING'
      order by fr.id limit $2
    `, [sessionId, PROCESS_CHUNK]);
    if (!ids.rows.length) return false;
    for (const item of ids.rows) {
      await this.processRow(job, batchId, sessionId, number(item.id));
    }
    return true;
  }

  private async processRow(job: JobLease, batchId: number, sessionId: number, finalizationRowId: number): Promise<void> {
    try {
      await this.reviewRepository.transaction(async (client) => {
        await this.assertLease(client, job, sessionId);
        const selected = await client.query(`
          select fr.*,f.id finalization_id,f.submitted_by,rs.status session_status
          from material_import_review_finalization_rows fr
          join material_import_review_finalizations f on f.id=fr.finalization_id
          join material_import_review_sessions rs on rs.id=f.review_session_id
          where fr.id=$1 and f.review_session_id=$2 for update of fr
        `, [finalizationRowId, sessionId]);
        const row = selected.rows[0];
        if (!row || row.operation_status === "SUCCEEDED") return;
        if (row.session_status !== "FINALIZING") reviewFailure("IMPORT_REVIEW_STATUS_CONFLICT", "复核会话不在最终处理状态", 409);
        await client.query("update material_import_review_finalization_rows set operation_status='RUNNING',attempt_count=attempt_count+1,started_at=now(),failure_code=null,failure_message_safe=null,updated_at=now() where id=$1", [finalizationRowId]);
        const payload = row.final_payload as Record<string, unknown>;
        if (reviewDigest(payload) !== row.final_payload_digest) reviewFailure("IMPORT_REVIEW_SNAPSHOT_DIGEST_MISMATCH", "最终提交快照摘要不一致", 500);
        let materialDraftId: number | null = null;
        if (row.operation_type === "BIND_EXISTING") await this.bindActive(client, row, sessionId, job.id);
        if (row.operation_type === "CREATE_DRAFT") materialDraftId = await this.createDraft(client, row, batchId, sessionId, job.id);
        await client.query(`
          update material_import_review_finalization_rows set
            operation_status='SUCCEEDED',material_draft_id=$2,completed_at=now(),updated_at=now()
          where id=$1
        `, [finalizationRowId, materialDraftId]);
        await client.query(`
          update material_import_review_rows set
            row_status='COMPLETED',material_draft_id=$2,finalized_at=now(),
            failure_code=null,failure_message_safe=null,expected_version=expected_version+1,updated_at=now()
          where id=$1
        `, [row.review_row_id, materialDraftId]);
        await client.query(`
          update material_import_review_validation_issues
          set is_active=false,resolved_at=now()
          where review_row_id=$1 and is_active
        `, [row.review_row_id]);
      });
    } catch (error) {
      if (error instanceof MaterialImportReviewError && error.code === "IMPORT_REVIEW_LEASE_LOST") throw error;
      const code = this.safeCode(error instanceof MaterialWorkflowError ? error.code : error instanceof MaterialImportReviewError ? error.code : "IMPORT_REVIEW_ROW_FAILED");
      const message = error instanceof MaterialWorkflowError || error instanceof MaterialImportReviewError ? error.message.slice(0, 500) : "行级最终处理失败，可修正后安全重试";
      await this.reviewRepository.transaction(async (client) => {
        await this.assertLease(client, job, sessionId);
        const row = await client.query("select review_row_id,operation_type from material_import_review_finalization_rows where id=$1 for update", [finalizationRowId]);
        if (!row.rows[0]) return;
        await client.query("update material_import_review_finalization_rows set operation_status='FAILED',failure_code=$2,failure_message_safe=$3,updated_at=now() where id=$1", [finalizationRowId, code, message]);
        await client.query("update material_import_review_rows set row_status='FAILED',failure_code=$2,failure_message_safe=$3,expected_version=expected_version+1,updated_at=now() where id=$1", [row.rows[0].review_row_id, code, message]);
        const issueKey = reviewDigest({ source: "FINALIZATION", review_row_id: number(row.rows[0].review_row_id), issue_code: code });
        await client.query(`
          insert into material_import_review_validation_issues(
            review_session_id,review_row_id,issue_key,issue_level,issue_code,target_code,
            safe_message,safe_details,validation_generation,is_active
          ) values($1,$2,$3,'ERROR',$4,$5,$6,$7,1,true)
          on conflict(review_row_id,issue_key,validation_generation) do update set
            safe_message=excluded.safe_message,safe_details=excluded.safe_details,is_active=true,resolved_at=null
        `, [
          sessionId,
          row.rows[0].review_row_id,
          issueKey,
          code,
          `FINALIZATION.${String(row.rows[0].operation_type)}`,
          message,
          { finalization_row_id: finalizationRowId },
        ]);
      });
    }
  }

  private async bindActive(client: PoolClient, row: Record<string, unknown>, sessionId: number, requestId: string): Promise<void> {
    const material = await client.query(`
      select id,internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,
             base_uom,material_status,version
      from material_master where id=$1 for share
    `, [row.existing_material_id]);
    if (!material.rows[0] || material.rows[0].material_status !== "ACTIVE") reviewFailure("IMPORT_REVIEW_MATERIAL_NOT_ACTIVE", "所选物料已不是 ACTIVE，请重新选择", 409);
    const snapshot = { ...material.rows[0], id: number(material.rows[0].id), category_id: number(material.rows[0].category_id), version: Number(material.rows[0].version) };
    await client.query(`
      insert into material_import_review_material_bindings(
        review_session_id,review_row_id,finalization_row_id,material_id,material_display_snapshot,bound_by,request_id
      ) values($1,$2,$3,$4,$5,$6,$7)
      on conflict(review_row_id) do update set review_row_id=excluded.review_row_id
    `, [sessionId, row.review_row_id, row.id, material.rows[0].id, snapshot, row.submitted_by, requestId]);
    await this.reviewRepository.historyEvent(client, { sessionId, rowId: number(row.review_row_id), eventType: "REVIEW_ACTIVE_MATERIAL_BOUND", actor: String(row.submitted_by), requestId, details: { material_id: number(material.rows[0].id) } });
  }

  private async createDraft(client: PoolClient, row: Record<string, unknown>, batchId: number, sessionId: number, requestId: string): Promise<number> {
    const existing = await client.query("select material_draft_id from material_import_review_draft_links where review_row_id=$1", [row.review_row_id]);
    if (existing.rows[0]) return number(existing.rows[0].material_draft_id);
    const payload = row.final_payload as Record<string, unknown>;
    const effective = payload.effective_values as { fields: Record<string, unknown>; attributes: Record<string, { value: unknown; unit: string | null }> };
    const fields = effective.fields;
    const attributes = Object.fromEntries(Object.entries(effective.attributes).filter(([, item]) => item.value != null).map(([code, item]) => [code, { value: item.value, unit: item.unit ?? "", source: "MANUAL", confidence: 1 }]));
    const draftBody = {
      category_id: fields.CATEGORY_ID,
      basic_fields: {
        standard_name: fields.STANDARD_NAME,
        unit: fields.UNIT,
        brand: fields.BRAND ?? "",
        manufacturer: fields.MANUFACTURER ?? "",
        manufacturer_part_number: fields.MANUFACTURER_PART_NUMBER ?? "",
        procurement_type: fields.PURCHASE_TYPE ?? "PURCHASE",
        inventory_type: fields.INVENTORY_TYPE ?? "STOCKED",
        lot_control_required: fields.LOT_CONTROL ?? false,
        shelf_life_days: fields.SHELF_LIFE_DAYS ?? null,
        inspection_type: fields.INSPECTION_TYPE ?? "NORMAL",
        environmental_requirement: fields.ENVIRONMENTAL_REQUIREMENT ?? "UNSPECIFIED",
        source_type: "MANUAL",
        source_ref: `material-import-review:${sessionId}:${row.review_row_id}`,
      },
      attributes,
    };
    const operationId = randomUUID();
    const actor = { username: String(row.submitted_by), permissions: ["material.draft.create"], must_change_password: false };
    const result = await this.materialService.createDraftWithClient(client, {
      actor,
      requestId,
      idempotencyKey: String(row.operation_key),
      requestDigest: String(row.final_payload_digest),
      routeScope: `IMPORT_REVIEW_DRAFT_CREATE:${sessionId}:${row.review_row_id}`,
    }, draftBody, operationId, String(row.operation_key));
    if (result.material_status !== "DRAFT" || result.internal_material_code != null) reviewFailure("IMPORT_REVIEW_DRAFT_BOUNDARY_VIOLATION", "创建结果不是未编码 DRAFT", 500);
    await client.query(`
      insert into material_import_review_draft_links(
        review_session_id,review_row_id,finalization_row_id,material_draft_id,created_by,request_id
      ) values($1,$2,$3,$4,$5,$6)
    `, [sessionId, row.review_row_id, row.id, result.material_id, row.submitted_by, requestId]);
    await this.reviewRepository.historyEvent(client, { sessionId, rowId: number(row.review_row_id), eventType: "REVIEW_MATERIAL_DRAFT_CREATED", actor: String(row.submitted_by), requestId, details: { material_draft_id: result.material_id, batch_id: batchId } });
    return result.material_id;
  }

  private async finish(job: JobLease, batchId: number, sessionId: number): Promise<Record<string, unknown>> {
    return this.reviewRepository.transaction(async (client) => {
      await this.assertLease(client, job, sessionId);
      const finalization = await client.query("select * from material_import_review_finalizations where review_session_id=$1 for update", [sessionId]);
      const record = finalization.rows[0];
      const counts = await client.query(`
        select count(*) filter(where operation_status='SUCCEEDED')::integer completed,
               count(*) filter(where operation_status='FAILED')::integer failed,
               count(*) filter(where operation_status in ('PENDING','RUNNING'))::integer unfinished
        from material_import_review_finalization_rows where finalization_id=$1
      `, [record.id]);
      const completed = Number(counts.rows[0].completed);
      const failed = Number(counts.rows[0].failed);
      const unfinished = Number(counts.rows[0].unfinished);
      if (unfinished) reviewFailure("IMPORT_REVIEW_FINALIZATION_INCOMPLETE", "最终处理仍有未完成行", 500, { retryable: true });
      if (failed) {
        await client.query("update material_import_review_finalizations set status='FAILED',completed_rows=$2,failed_rows=$3,failure_code='IMPORT_REVIEW_ROWS_FAILED',failure_message_safe='部分行处理失败，可修正后安全重试',updated_at=now() where id=$1", [record.id, completed, failed]);
        await client.query("update material_import_review_sessions set status='FINALIZE_FAILED',completed_rows=$2,failed_rows=$3,failure_code='IMPORT_REVIEW_ROWS_FAILED',failure_message_safe='部分行处理失败，可修正后安全重试',expected_version=expected_version+1,updated_at=now() where id=$1", [sessionId, completed, failed]);
        await this.reviewRepository.historyEvent(client, { sessionId, eventType: "REVIEW_FINALIZATION_FAILED", actor: String(record.submitted_by), requestId: job.id, details: { completed_rows: completed, failed_rows: failed } });
        return { batch_id: batchId, review_session_id: sessionId, status: "FINALIZE_FAILED", completed_rows: completed, failed_rows: failed };
      }
      await client.query("update material_import_review_finalizations set status='COMPLETED',completed_rows=$2,failed_rows=0,completed_at=now(),updated_at=now() where id=$1", [record.id, completed]);
      await client.query("update material_import_review_sessions set status='FINALIZED',completed_rows=$2,failed_rows=0,finalized_at=now(),failure_code=null,failure_message_safe=null,expected_version=expected_version+1,updated_at=now() where id=$1", [sessionId, completed]);
      await this.reviewRepository.historyEvent(client, { sessionId, eventType: "REVIEW_FINALIZATION_COMPLETED", actor: String(record.submitted_by), requestId: job.id, details: { completed_rows: completed } });
      return { batch_id: batchId, review_session_id: sessionId, status: "FINALIZED", completed_rows: completed, failed_rows: 0 };
    });
  }

  private async effectiveValues(client: PoolClient, rowId: number, normalizedRowId: number) {
    const [fields, attributes, fieldOverrides, attributeOverrides] = await Promise.all([
      client.query("select target_field_code target_code,normalized_value from material_import_normalized_field_candidates where normalized_row_id=$1 order by display_order,id", [normalizedRowId]),
      client.query("select attribute_code,data_type,normalized_value,unit_code from material_import_normalized_attribute_candidates where normalized_row_id=$1 order by display_order,id", [normalizedRowId]),
      client.query("select distinct on(target_field_code) target_field_code,value_semantics,override_value from material_import_review_field_overrides where review_row_id=$1 order by target_field_code,revision_number desc,id desc", [rowId]),
      client.query("select distinct on(attribute_code) attribute_code,value_semantics,override_value,unit_or_format from material_import_review_attribute_overrides where review_row_id=$1 order by attribute_code,revision_number desc,id desc", [rowId]),
    ]);
    return buildEffectiveValues({ fieldCandidates: fields.rows as never, attributeCandidates: attributes.rows as never, fieldOverrides: fieldOverrides.rows as never, attributeOverrides: attributeOverrides.rows as never });
  }

  private async assertLease(client: PoolClient, job: JobLease, sessionId: number): Promise<void> {
    const lease = await client.query(`
      select 1 from background_jobs j
      join material_import_review_sessions s on s.finalization_job_id=j.id
      where j.id=$1 and j.status='RUNNING' and j.lease_token=$2
        and j.lease_expires_at>now() and s.id=$3 and s.status='FINALIZING'
      for share of j,s
    `, [job.id, job.leaseToken, sessionId]);
    if (!lease.rows[0]) reviewFailure("IMPORT_REVIEW_LEASE_LOST", "最终处理任务租约已失效", 409, { retryable: true });
  }

  private safeCode(value: string): string {
    const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100);
    return /^[A-Z][A-Z0-9_]{2,99}$/.test(normalized) ? normalized : "IMPORT_REVIEW_WORKER_FAILED";
  }
}

export function isRetryableReviewError(error: unknown): boolean {
  return error instanceof MaterialImportReviewError && error.retryable;
}
