import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { JobLease } from "../infrastructure/background-jobs.ts";
import { canonicalJson } from "../material-import-selfhost/rules.ts";
import type { MaterialImportRawRow } from "../material-import/parser-model.ts";
import { MaterialImportNormalizationError, normalizationFailure } from "./errors.ts";
import { SELFHOST_NORMALIZATION_CHUNK_ROWS, SelfhostMaterialImportRowNormalizer } from "./normalizer.ts";
import { PostgresNormalizationRepository, type NormalizationRunRow } from "./repository.ts";
import type { NormalizedRowBundle } from "./types.ts";

type WorkerPublication = Readonly<{
  result: Record<string, unknown>;
  publish?: (client: PoolClient) => Promise<void>;
}>;

type Totals = Readonly<{
  processedRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  skippedRows: number;
  issueCount: number;
  warningCount: number;
  errorCount: number;
  normalizedJsonBytes: number;
}>;

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) normalizationFailure("IMPORT_NORMALIZATION_DATA_INVALID", "规范化数据标识无效", 500);
  return parsed;
}

async function verifyJobLease(client: PoolClient, job: JobLease): Promise<void> {
  const result = await client.query(`
    select 1 from background_jobs
    where id=$1 and status='RUNNING' and lease_token=$2 and lease_expires_at>now()
  `, [job.id, job.leaseToken]);
  if (!result.rows[0]) normalizationFailure("IMPORT_NORMALIZATION_LEASE_LOST", "后台任务租约已失效", 409, { retryable: true });
}

async function aggregate(client: PoolClient, runId: number): Promise<Totals> {
  const result = await client.query(`
    select
      count(*)::integer processed_rows,
      count(*) filter(where row_status='VALID')::integer valid_rows,
      count(*) filter(where row_status='WARNING')::integer warning_rows,
      count(*) filter(where row_status='ERROR')::integer error_rows,
      count(*) filter(where row_status='SKIPPED')::integer skipped_rows,
      coalesce(sum(issue_count),0)::integer issue_count,
      coalesce(sum(warning_count),0)::integer warning_count,
      coalesce(sum(error_count),0)::integer error_count,
      coalesce(sum(pg_column_size(normalized_payload)),0)::bigint normalized_json_bytes
    from material_import_normalized_rows where normalization_run_id=$1
  `, [runId]);
  const row = result.rows[0];
  return {
    processedRows: Number(row.processed_rows),
    validRows: Number(row.valid_rows),
    warningRows: Number(row.warning_rows),
    errorRows: Number(row.error_rows),
    skippedRows: Number(row.skipped_rows),
    issueCount: Number(row.issue_count),
    warningCount: Number(row.warning_count),
    errorCount: Number(row.error_count),
    normalizedJsonBytes: numberValue(row.normalized_json_bytes),
  };
}

export class PostgresMaterialImportNormalizationWorker {
  readonly #pool: Pool;
  readonly #repository: PostgresNormalizationRepository;
  readonly #normalizer: SelfhostMaterialImportRowNormalizer;

  constructor(pool: Pool, normalizer = new SelfhostMaterialImportRowNormalizer()) {
    this.#pool = pool;
    this.#repository = new PostgresNormalizationRepository(pool);
    this.#normalizer = normalizer;
  }

  async prepare(job: JobLease): Promise<WorkerPublication> {
    const batchId = numberValue(job.payload.batch_id);
    const runId = numberValue(job.payload.normalization_run_id);
    let run = await this.#claim(job, batchId, runId);
    if (["SUCCEEDED", "SUPERSEDED", "FAILED", "CANCELLED"].includes(run.run_status)) {
      return { result: { batch_id: batchId, normalization_run_id: runId, status: run.run_status } };
    }
    if (run.run_status === "CANCEL_REQUESTED") {
      await this.#cancelAtCheckpoint(job, run);
      return { result: { batch_id: batchId, normalization_run_id: runId, status: "CANCELLED" } };
    }
    const mapping = await this.#repository.mappingContext(this.#pool, run, true);
    let afterId = 0;
    while (true) {
      const sourceRows = await this.#repository.sourceRows(this.#pool, mapping, afterId, SELFHOST_NORMALIZATION_CHUNK_ROWS);
      const bundles: { source: Readonly<{ id: number; rowNumber: number; rawRowHash: string; rawRow: MaterialImportRawRow }>; bundle: NormalizedRowBundle }[] = [];
      for (const source of sourceRows) {
        bundles.push({
          source,
          bundle: await this.#normalizer.normalize({
            runId,
            rowNumber: source.rowNumber,
            rawRowHash: source.rawRowHash,
            rawRow: source.rawRow,
            mapping,
          }),
        });
      }
      const checkpoint = await this.#repository.transaction(async (client) => {
        await verifyJobLease(client, job);
        const locked = await this.#repository.run(client, batchId, runId, true);
        if (locked.run_status === "CANCEL_REQUESTED") {
          await this.#finalizeCancellation(client, locked);
          return { cancelled: true, totals: await aggregate(client, runId) };
        }
        if (locked.run_status !== "RUNNING" || locked.lease_token !== job.leaseToken) normalizationFailure("IMPORT_NORMALIZATION_LEASE_LOST", "Normalizer 运行租约已失效", 409, { retryable: true });
        for (const item of bundles) await this.#repository.replaceStagedRow(client, locked, mapping, item.source, item.bundle);
        const totals = await aggregate(client, runId);
        if (totals.issueCount > 200_000 || totals.normalizedJsonBytes > 256 * 1024 * 1024) normalizationFailure("IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "规范化暂存结果超过资源限制", 422);
        await client.query(`
          update material_import_normalization_runs set
            current_stage=$2,processed_rows=$3,valid_rows=$4,warning_rows=$5,error_rows=$6,skipped_rows=$7,
            issue_count=$8,warning_count=$9,error_count=$10,normalized_json_bytes=$11,
            heartbeat_at=now(),lease_expires_at=(select lease_expires_at from background_jobs where id=$12),
            expected_version=expected_version+1,updated_at=now()
          where id=$1
        `, [
          runId,
          sourceRows.length < SELFHOST_NORMALIZATION_CHUNK_ROWS ? "VERIFY_RESULT" : "NORMALIZE_ROWS",
          totals.processedRows,
          totals.validRows,
          totals.warningRows,
          totals.errorRows,
          totals.skippedRows,
          totals.issueCount,
          totals.warningCount,
          totals.errorCount,
          totals.normalizedJsonBytes,
          job.id,
        ]);
        return { cancelled: false, totals };
      });
      if (checkpoint.cancelled) return { result: { batch_id: batchId, normalization_run_id: runId, status: "CANCELLED" } };
      if (sourceRows.length < SELFHOST_NORMALIZATION_CHUNK_ROWS) break;
      afterId = sourceRows.at(-1)!.id;
    }
    run = await this.#verifyStaged(job, batchId, runId);
    if (run.run_status === "CANCELLED") {
      return { result: { batch_id: batchId, normalization_run_id: runId, status: "CANCELLED" } };
    }
    const resultDigest = await this.#resultDigest(run);
    return {
      result: { batch_id: batchId, normalization_run_id: runId, status: "SUCCEEDED", result_digest: resultDigest },
      publish: async (client) => this.#publish(client, job, runId, resultDigest),
    };
  }

  async markTerminalFailure(job: JobLease, safeCode: string): Promise<void> {
    const batchId = Number(job.payload.batch_id);
    const runId = Number(job.payload.normalization_run_id);
    if (!Number.isSafeInteger(batchId) || !Number.isSafeInteger(runId)) return;
    await this.#repository.transaction(async (client) => {
      const result = await client.query<NormalizationRunRow>("select * from material_import_normalization_runs where id=$1 and batch_id=$2 for update", [runId, batchId]);
      const run = result.rows[0];
      if (!run || ["SUCCEEDED", "SUPERSEDED", "FAILED", "CANCELLED"].includes(run.run_status)) return;
      if (run.run_status === "CANCEL_REQUESTED") {
        await this.#finalizeCancellation(client, run);
        return;
      }
      const batch = await client.query("select current_normalization_run_id from material_import_batches where id=$1 for update", [batchId]);
      const restore = batch.rows[0]?.current_normalization_run_id ? "NORMALIZED" : "MAPPING_CONFIRMED";
      await client.query(`
        update material_import_normalization_runs set
          run_status='FAILED',expected_version=expected_version+1,current_stage='COMPLETE',
          lease_token=null,lease_expires_at=null,heartbeat_at=null,completed_at=now(),
          failure_code=$2,safe_failure_message='规范化任务处理失败，请检查 Mapping 或重试',updated_at=now()
        where id=$1
      `, [runId, safeCode.slice(0, 100)]);
      await client.query("update material_import_batches set status=$2,current_version=current_version+1,updated_at=now() where id=$1 and status in ('QUEUED_FOR_NORMALIZATION','NORMALIZING')", [batchId, restore]);
      await client.query(`
        insert into material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details)
        values($1,'NORMALIZATION_FAILED','WORKER',null,$2,$3,$4)
      `, [batchId, restore, randomUUID(), { normalization_run_id: runId, code: safeCode.slice(0, 100) }]);
      await client.query(`
        insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
        values('system','IMPORT_NORMALIZATION_FAILED',$1,$2,'failed','MATERIAL_IMPORT_NORMALIZATION',$3,now()+interval '1095 days')
      `, [{ batch_id: batchId, normalization_run_id: runId }, randomUUID(), safeCode.slice(0, 100)]);
    }).catch(() => undefined);
  }

  async #claim(job: JobLease, batchId: number, runId: number): Promise<NormalizationRunRow> {
    return this.#repository.transaction(async (client) => {
      await verifyJobLease(client, job);
      const run = await this.#repository.run(client, batchId, runId, true);
      if (run.worker_job_id !== job.id) normalizationFailure("IMPORT_NORMALIZATION_LEASE_LOST", "后台任务与规范化运行不匹配", 409, { retryable: true });
      if (["SUCCEEDED", "SUPERSEDED", "FAILED", "CANCELLED", "CANCEL_REQUESTED"].includes(run.run_status)) return run;
      if (!["QUEUED", "RUNNING"].includes(run.run_status)) normalizationFailure("IMPORT_NORMALIZATION_STATUS_CONFLICT", "规范化运行状态无效", 409);
      if (run.run_status === "QUEUED" && Number(run.retry_count) > 0) await this.#clearStaging(client, runId);
      await this.#repository.mappingContext(client, run, true);
      const updated = await client.query<NormalizationRunRow>(`
        update material_import_normalization_runs set
          run_status='RUNNING',current_stage='READ_SOURCE_ROWS',lease_token=$2,
          lease_expires_at=(select lease_expires_at from background_jobs where id=$3),
          heartbeat_at=now(),started_at=coalesce(started_at,now()),expected_version=expected_version+1,updated_at=now()
        where id=$1 returning *
      `, [runId, job.leaseToken, job.id]);
      await client.query("update material_import_batches set status='NORMALIZING',updated_at=now() where id=$1 and status='QUEUED_FOR_NORMALIZATION'", [batchId]);
      if (run.run_status === "QUEUED") {
        await client.query(`
          insert into material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details)
          values($1,'NORMALIZATION_STARTED','WORKER','QUEUED_FOR_NORMALIZATION','NORMALIZING',$2,$3)
        `, [batchId, randomUUID(), { normalization_run_id: runId, attempt_no: Number(run.attempt_no) }]);
      }
      return updated.rows[0];
    });
  }

  async #verifyStaged(job: JobLease, batchId: number, runId: number): Promise<NormalizationRunRow> {
    return this.#repository.transaction(async (client) => {
      await verifyJobLease(client, job);
      const run = await this.#repository.run(client, batchId, runId, true);
      if (run.run_status === "CANCEL_REQUESTED") {
        await this.#finalizeCancellation(client, run);
        return { ...run, run_status: "CANCELLED" };
      }
      if (run.run_status !== "RUNNING" || run.lease_token !== job.leaseToken) normalizationFailure("IMPORT_NORMALIZATION_LEASE_LOST", "发布前运行租约已失效", 409, { retryable: true });
      await this.#repository.mappingContext(client, run, true);
      const totals = await aggregate(client, runId);
      if (
        totals.processedRows !== Number(run.total_rows)
        || totals.validRows + totals.warningRows + totals.errorRows + totals.skippedRows !== totals.processedRows
        || totals.issueCount !== totals.warningCount + totals.errorCount
      ) normalizationFailure("IMPORT_NORMALIZATION_RESULT_INCOMPLETE", "规范化结果完整性核验失败", 500, { retryable: true });
      const counts = await client.query(`
        select
          (select count(*)::integer from material_import_normalized_field_candidates where normalization_run_id=$1) field_count,
          (select count(*)::integer from material_import_normalized_attribute_candidates where normalization_run_id=$1) attribute_count,
          (select count(*)::integer from material_import_normalization_lineage where normalization_run_id=$1) lineage_count
      `, [runId]);
      const row = counts.rows[0];
      if (Number(row.lineage_count) < Number(row.field_count) + Number(row.attribute_count)) normalizationFailure("IMPORT_NORMALIZATION_RESULT_INCOMPLETE", "候选字段 lineage 不完整", 500, { retryable: true });
      const updated = await client.query<NormalizationRunRow>(`
        update material_import_normalization_runs set
          run_status='PUBLISHING',current_stage='PUBLISH_RESULT',expected_version=expected_version+1,
          heartbeat_at=now(),updated_at=now()
        where id=$1 returning *
      `, [runId]);
      return updated.rows[0];
    });
  }

  async #resultDigest(run: NormalizationRunRow): Promise<string> {
    const digest = createHash("sha256");
    digest.update(canonicalJson({
      mapping_id: numberValue(run.mapping_id),
      mapping_digest: run.mapping_digest,
      source_schema_digest: run.source_schema_digest,
      rule_version: run.normalizer_rule_version,
      run_version: Number(run.run_version),
    }));
    let after = 0;
    while (true) {
      const rows = await this.#pool.query(`
        select id,normalized_payload_hash,row_status,error_count,warning_count
        from material_import_normalized_rows
        where normalization_run_id=$1 and id>$2 order by id limit 500
      `, [numberValue(run.id), after]);
      if (!rows.rows.length) break;
      for (const row of rows.rows) digest.update(canonicalJson(row));
      after = numberValue(rows.rows.at(-1)!.id);
    }
    after = 0;
    while (true) {
      const issues = await this.#pool.query(`
        select id,issue_key,issue_level,issue_code,target_code
        from material_import_normalization_issues
        where normalization_run_id=$1 and id>$2 order by id limit 500
      `, [numberValue(run.id), after]);
      if (!issues.rows.length) break;
      for (const issue of issues.rows) digest.update(canonicalJson(issue));
      after = numberValue(issues.rows.at(-1)!.id);
    }
    return digest.digest("hex");
  }

  async #publish(client: PoolClient, job: JobLease, runId: number, resultDigest: string): Promise<void> {
    await verifyJobLease(client, job);
    const result = await client.query<NormalizationRunRow>("select * from material_import_normalization_runs where id=$1 for update", [runId]);
    const run = result.rows[0];
    if (!run) normalizationFailure("IMPORT_NORMALIZATION_RUN_NOT_FOUND", "规范化运行不存在", 404);
    if (run.run_status === "SUCCEEDED" && run.result_digest === resultDigest) return;
    if (run.run_status === "CANCEL_REQUESTED") {
      await this.#finalizeCancellation(client, run);
      return;
    }
    if (run.run_status !== "PUBLISHING" || run.lease_token !== job.leaseToken) normalizationFailure("IMPORT_NORMALIZATION_LEASE_LOST", "发布租约已失效", 409, { retryable: true });
    await this.#repository.mappingContext(client, run, true);
    const batch = await client.query("select * from material_import_batches where id=$1 for update", [run.batch_id]);
    const batchRow = batch.rows[0];
    if (!batchRow || String(batchRow.status) !== "NORMALIZING" || Number(batchRow.current_parse_run_id) !== Number(run.parse_run_id)) normalizationFailure("IMPORT_NORMALIZATION_VERSION_CONFLICT", "发布前批次事实已变化", 409);
    const totals = await aggregate(client, runId);
    if (totals.processedRows !== Number(run.total_rows)) normalizationFailure("IMPORT_NORMALIZATION_RESULT_INCOMPLETE", "发布结果行数不完整", 500);
    const previousRunId = batchRow.current_normalization_run_id == null ? null : Number(batchRow.current_normalization_run_id);
    if (previousRunId && previousRunId !== runId) {
      await client.query("update material_import_normalization_runs set run_status='SUPERSEDED',expected_version=expected_version+1,updated_at=now() where id=$1 and run_status='SUCCEEDED' and published_at is not null", [previousRunId]);
    }
    const updated = await client.query(`
      update material_import_normalization_runs set
        run_status='SUCCEEDED',current_stage='COMPLETE',expected_version=expected_version+1,result_digest=$2,
        completed_at=now(),published_at=now(),lease_token=null,lease_expires_at=null,heartbeat_at=null,updated_at=now()
      where id=$1 and run_status='PUBLISHING' and published_at is null
    `, [runId, resultDigest]);
    if (updated.rowCount !== 1) normalizationFailure("IMPORT_NORMALIZATION_PUBLISH_CONFLICT", "规范化发布竞争失败", 409);
    await client.query(`
      update material_import_batches set
        current_normalization_run_id=$2,status='NORMALIZED',current_version=current_version+1,
        accepted_rows=$3,rejected_rows=$4,updated_at=now()
      where id=$1
    `, [numberValue(run.batch_id), runId, totals.validRows + totals.warningRows, totals.errorRows]);
    const requestId = randomUUID();
    await client.query(`
      insert into material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details)
      values($1,'NORMALIZATION_PUBLISHED','WORKER','NORMALIZING','NORMALIZED',$2,$3)
    `, [numberValue(run.batch_id), requestId, { normalization_run_id: runId, result_digest: resultDigest, total_rows: totals.processedRows }]);
    await client.query(`
      insert into audit_log(username,action,detail,request_id,result,route_code,retention_until)
      values('system','IMPORT_NORMALIZATION_PUBLISHED',$1,$2,'success','MATERIAL_IMPORT_NORMALIZATION',now()+interval '1095 days')
    `, [{ batch_id: numberValue(run.batch_id), normalization_run_id: runId, result_digest: resultDigest }, requestId]);
  }

  async #cancelAtCheckpoint(job: JobLease, run: NormalizationRunRow): Promise<void> {
    await this.#repository.transaction(async (client) => {
      await verifyJobLease(client, job);
      const locked = await this.#repository.run(client, numberValue(run.batch_id), numberValue(run.id), true);
      if (locked.run_status === "CANCEL_REQUESTED") await this.#finalizeCancellation(client, locked);
    });
  }

  async #finalizeCancellation(client: PoolClient, run: NormalizationRunRow): Promise<void> {
    const batch = await client.query("select current_normalization_run_id from material_import_batches where id=$1 for update", [run.batch_id]);
    const restore = batch.rows[0]?.current_normalization_run_id ? "NORMALIZED" : "MAPPING_CONFIRMED";
    await client.query(`
      update material_import_normalization_runs set
        run_status='CANCELLED',expected_version=expected_version+1,current_stage='COMPLETE',
        cancelled_at=now(),completed_at=now(),lease_token=null,lease_expires_at=null,heartbeat_at=null,updated_at=now()
      where id=$1 and run_status='CANCEL_REQUESTED'
    `, [run.id]);
    await client.query("update material_import_batches set status=$2,current_version=current_version+1,updated_at=now() where id=$1 and status in ('QUEUED_FOR_NORMALIZATION','NORMALIZING')", [run.batch_id, restore]);
    const requestId = randomUUID();
    await client.query(`
      insert into material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details)
      values($1,'NORMALIZATION_CANCELLED','WORKER',null,$2,$3,$4)
    `, [run.batch_id, restore, requestId, { normalization_run_id: numberValue(run.id) }]);
    await client.query(`
      insert into audit_log(username,action,detail,request_id,result,route_code,retention_until)
      values('system','IMPORT_NORMALIZATION_CANCELLED',$1,$2,'success','MATERIAL_IMPORT_NORMALIZATION',now()+interval '1095 days')
    `, [{ batch_id: numberValue(run.batch_id), normalization_run_id: numberValue(run.id) }, requestId]);
  }

  async #clearStaging(client: PoolClient, runId: number): Promise<void> {
    await client.query("delete from material_import_normalization_lineage where normalization_run_id=$1", [runId]);
    await client.query("delete from material_import_normalized_attribute_candidates where normalization_run_id=$1", [runId]);
    await client.query("delete from material_import_normalized_field_candidates where normalization_run_id=$1", [runId]);
    await client.query("delete from material_import_normalization_issues where normalization_run_id=$1", [runId]);
    await client.query("delete from material_import_normalized_rows where normalization_run_id=$1", [runId]);
  }
}

export function isRetryableNormalizationError(error: unknown): boolean {
  return error instanceof MaterialImportNormalizationError && error.retryable;
}
