import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { PostgresMappingCatalog } from "../material-import-selfhost/catalog.ts";
import { canonicalJson } from "../material-import-selfhost/rules.ts";
import { MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION } from "../material-import/normalization-model.ts";
import { normalizationFailure } from "./errors.ts";
import { PostgresNormalizationRepository, type NormalizationRunRow } from "./repository.ts";
import { assertNormalizationTransition } from "./state-machine.ts";
import type { NormalizationActor } from "./types.ts";

type MutationContext = Readonly<{
  actor: NormalizationActor;
  requestId: string;
  method: "POST";
  routeScope: string;
  idempotencyKey: string;
  requestDigest: string;
}>;

type MutationResult = Readonly<{
  data: Record<string, unknown>;
  statusCode: number;
  operationId: string;
  replayed: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function numberValue(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) normalizationFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`, 400);
  return parsed;
}

function allowed(actor: NormalizationActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function requireCapability(actor: NormalizationActor, permission: string): void {
  if (!allowed(actor, permission)) normalizationFailure("PERMISSION_DENIED", "没有权限执行此操作", 403);
  if (actor.must_change_password) normalizationFailure("PERMISSION_DENIED", "请先修改密码再执行写操作", 403);
}

async function audit(
  client: PoolClient,
  input: Readonly<{ actor: string; action: string; requestId: string; batchId: number; runId?: number; result?: string; errorCode?: string }>,
): Promise<void> {
  await client.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,$2,$3,$4,$5,'MATERIAL_IMPORT_NORMALIZATION',$6,now()+interval '1095 days')
  `, [input.actor, input.action, { batch_id: input.batchId, normalization_run_id: input.runId ?? null }, input.requestId, input.result ?? "success", input.errorCode ?? null]);
}

export class MaterialImportNormalizationService {
  readonly #repository: PostgresNormalizationRepository;

  constructor(repository: PostgresNormalizationRepository) {
    this.#repository = repository;
  }

  async create(batchId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult> {
    requireCapability(context.actor, "material.import.normalize");
    const expectedVersion = numberValue(input.expected_version, "expected_version");
    const processorVersion = String(input.processor_version ?? "");
    if (processorVersion !== MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION) normalizationFailure("IMPORT_NORMALIZATION_PROCESSOR_UNSUPPORTED", "Normalizer 规则版本不受支持", 422);
    const mappingId = input.mapping_version_id == null ? null : numberValue(input.mapping_version_id, "mapping_version_id");
    const rerunReason = input.rerun_reason == null ? null : String(input.rerun_reason).trim();
    if (rerunReason !== null && (rerunReason.length < 1 || rerunReason.length > 500)) normalizationFailure("REQUEST_VALIDATION_FAILED", "重跑原因长度必须为 1 到 500", 400);
    return this.#mutate(batchId, context, 202, async (client, batch) => {
      if (Number(batch.current_version) !== expectedVersion) normalizationFailure("IMPORT_NORMALIZATION_VERSION_CONFLICT", "导入批次版本冲突", 409, { currentVersion: Number(batch.current_version) });
      if (!["MAPPING_CONFIRMED", "NORMALIZED"].includes(String(batch.status))) normalizationFailure("IMPORT_NORMALIZATION_STATUS_CONFLICT", "当前批次不能启动规范化", 409);
      const active = await client.query("select id from material_import_normalization_runs where batch_id=$1 and run_status in ('QUEUED','RUNNING','PUBLISHING','CANCEL_REQUESTED') limit 1", [batchId]);
      if (active.rows[0]) normalizationFailure("IMPORT_NORMALIZATION_ALREADY_RUNNING", "已有规范化运行正在处理", 409);
      const mappingResult = await client.query(`
        select m.*,p.source_structure_digest parse_source_digest,f.id source_file_id,s.id source_sheet_id,s.sheet_name source_sheet_name
        from material_import_mappings m
        join material_import_parse_runs p on p.id=m.parse_run_id
        join material_import_files f on f.batch_id=m.batch_id
        join material_import_parse_sheets s on s.parse_run_id=m.parse_run_id and s.sheet_index=m.selected_sheet_index
        where m.batch_id=$1 and m.status='CONFIRMED' ${mappingId === null ? "" : "and m.id=$2"}
        order by m.mapping_version desc limit 1
        for share of m
      `, mappingId === null ? [batchId] : [batchId, mappingId]);
      const mapping = mappingResult.rows[0];
      if (!mapping) normalizationFailure("IMPORT_NORMALIZATION_MAPPING_REQUIRED", "必须选择已确认且有效的 Mapping 版本", 422);
      if (Number(mapping.parse_run_id) !== Number(batch.current_parse_run_id)) normalizationFailure("IMPORT_NORMALIZATION_SOURCE_SCHEMA_MISMATCH", "Mapping 与当前解析结果不一致", 422);
      if (!DIGEST.test(String(mapping.source_structure_digest)) || String(mapping.source_structure_digest) !== String(mapping.parse_source_digest)) normalizationFailure("IMPORT_NORMALIZATION_SOURCE_SCHEMA_MISMATCH", "源结构摘要不一致", 422);
      if (!mapping.mapping_snapshot || typeof mapping.mapping_snapshot !== "object" || !Array.isArray(mapping.mapping_snapshot.items) || !Array.isArray(mapping.mapping_snapshot.targets)) normalizationFailure("IMPORT_NORMALIZATION_MAPPING_INVALID", "Mapping 不可变快照不完整", 422);
      const catalog = await new PostgresMappingCatalog(client).snapshot();
      if (catalog.metadataDigest !== String(mapping.metadata_digest)) {
        await audit(client, { actor: context.actor.username, action: "IMPORT_NORMALIZATION_MAPPING_REJECTED", requestId: context.requestId, batchId, result: "failed", errorCode: "IMPORT_NORMALIZATION_MAPPING_STALE" });
        normalizationFailure("IMPORT_NORMALIZATION_MAPPING_STALE", "目标字段元数据已变化，Mapping 必须重新确认", 422);
      }
      const targetKeys = new Set(catalog.targets.map((target) => `${target.target_namespace}\u0000${target.target_code}`));
      for (const target of mapping.mapping_snapshot.targets as Record<string, unknown>[]) {
        if (!targetKeys.has(`${target.target_namespace}\u0000${target.target_code}`)) normalizationFailure("IMPORT_NORMALIZATION_MAPPING_STALE", "Mapping 包含已停用目标字段", 422);
      }
      const count = await client.query(`
        select count(*)::integer total
        from material_import_rows
        where parse_run_id=$1 and sheet_index=$2 and ($3::integer is null or row_number<>$3)
      `, [mapping.parse_run_id, mapping.selected_sheet_index, mapping.header_row_number]);
      const totalRows = Number(count.rows[0].total);
      if (totalRows > 50_000) normalizationFailure("IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "规范化源行数超过 50000 行限制", 422);
      const version = await client.query("select coalesce(max(run_version),0)::integer+1 run_version from material_import_normalization_runs where batch_id=$1", [batchId]);
      const runVersion = Number(version.rows[0].run_version);
      const created = await client.query<NormalizationRunRow>(`
        insert into material_import_normalization_runs(
          batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,
          source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,
          run_version,run_status,expected_version,attempt_no,retry_count,supersedes_run_id,current_stage,
          total_rows,requested_by,rerun_reason
        ) values(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,'QUEUED',1,1,0,$13,'LOAD_MAPPING',$14,$15,$16
        ) returning *
      `, [
        batchId,
        mapping.parse_run_id,
        mapping.id,
        mapping.source_file_id,
        mapping.source_sheet_id,
        mapping.mapping_version,
        mapping.mapping_digest,
        mapping.source_structure_digest,
        processorVersion,
        mapping.metadata_digest,
        mapping.mapping_snapshot,
        runVersion,
        batch.current_normalization_run_id,
        totalRows,
        context.actor.username,
        rerunReason,
      ]);
      const run = created.rows[0];
      const jobId = randomUUID();
      await client.query(`
        insert into material_import_job_outbox(
          id,aggregate_type,aggregate_id,job_type,idempotency_key,payload,status,available_at
        ) values($1,'material_import_normalization',$2,'material.import.normalize',$3,$4,'PENDING',now())
      `, [jobId, String(run.id), `normalization-run:${run.id}:attempt:1`, { batch_id: batchId, normalization_run_id: Number(run.id) }]);
      await client.query("update material_import_normalization_runs set worker_job_id=$2 where id=$1", [run.id, jobId]);
      const updated = await client.query("update material_import_batches set status='QUEUED_FOR_NORMALIZATION',current_version=current_version+1,updated_at=now() where id=$1 returning current_version", [batchId]);
      await client.query(`
        insert into material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details)
        values($1,'NORMALIZATION_QUEUED','USER',$2,$3,'QUEUED_FOR_NORMALIZATION',$4,$5)
      `, [batchId, context.actor.username, batch.status, context.requestId, { normalization_run_id: Number(run.id), run_version: runVersion, mapping_id: Number(mapping.id) }]);
      await audit(client, { actor: context.actor.username, action: rerunReason ? "IMPORT_NORMALIZATION_RERUN_QUEUED" : "IMPORT_NORMALIZATION_QUEUED", requestId: context.requestId, batchId, runId: Number(run.id) });
      return {
        batch_id: batchId,
        normalization_run_id: Number(run.id),
        run_version: runVersion,
        run_status: "QUEUED",
        batch_status: "QUEUED_FOR_NORMALIZATION",
        current_version: Number(updated.rows[0].current_version),
        expected_version: 1,
      };
    });
  }

  async retry(batchId: number, runId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult> {
    requireCapability(context.actor, "material.import.normalize");
    const expectedVersion = numberValue(input.expected_version, "expected_version");
    return this.#mutate(batchId, context, 202, async (client, batch) => {
      const run = await this.#repository.run(client, batchId, runId, true);
      if (Number(run.expected_version) !== expectedVersion) normalizationFailure("IMPORT_NORMALIZATION_VERSION_CONFLICT", "规范化运行版本冲突", 409, { currentVersion: Number(run.expected_version) });
      if (run.run_status !== "FAILED") normalizationFailure("IMPORT_NORMALIZATION_STATUS_CONFLICT", "只有失败运行可以重试", 409);
      assertNormalizationTransition("FAILED", "QUEUED");
      const retryCount = Number(run.retry_count) + 1;
      const jobId = randomUUID();
      await client.query(`
        update material_import_normalization_runs set
          run_status='QUEUED',expected_version=expected_version+1,attempt_no=attempt_no+1,retry_count=$2,
          worker_job_id=$3,lease_token=null,lease_expires_at=null,heartbeat_at=null,current_stage='LOAD_MAPPING',
          processed_rows=0,valid_rows=0,warning_rows=0,error_rows=0,skipped_rows=0,issue_count=0,
          warning_count=0,error_count=0,normalized_json_bytes=0,result_digest=null,started_at=null,
          completed_at=null,failure_code=null,safe_failure_message=null,updated_at=now()
        where id=$1
      `, [runId, retryCount, jobId]);
      await client.query(`
        insert into material_import_job_outbox(
          id,aggregate_type,aggregate_id,job_type,idempotency_key,payload,status,available_at
        ) values($1,'material_import_normalization',$2,'material.import.normalize',$3,$4,'PENDING',now())
      `, [jobId, String(runId), `normalization-run:${runId}:retry:${retryCount}`, { batch_id: batchId, normalization_run_id: runId }]);
      const restored = batch.current_normalization_run_id ? "NORMALIZED" : "MAPPING_CONFIRMED";
      if (!["NORMALIZED", "MAPPING_CONFIRMED"].includes(String(batch.status))) normalizationFailure("IMPORT_NORMALIZATION_STATUS_CONFLICT", "批次状态不允许重试", 409);
      const updated = await client.query("update material_import_batches set status='QUEUED_FOR_NORMALIZATION',current_version=current_version+1,updated_at=now() where id=$1 returning current_version", [batchId]);
      await audit(client, { actor: context.actor.username, action: "IMPORT_NORMALIZATION_RETRY_QUEUED", requestId: context.requestId, batchId, runId });
      return { batch_id: batchId, normalization_run_id: runId, run_status: "QUEUED", restored_from: restored, expected_version: expectedVersion + 1, current_version: Number(updated.rows[0].current_version) };
    });
  }

  async cancel(batchId: number, runId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult> {
    requireCapability(context.actor, "material.import.cancel");
    const expectedVersion = numberValue(input.expected_version, "expected_version");
    return this.#mutate(batchId, context, 202, async (client, batch) => {
      const run = await this.#repository.run(client, batchId, runId, true);
      if (Number(run.expected_version) !== expectedVersion) normalizationFailure("IMPORT_NORMALIZATION_VERSION_CONFLICT", "规范化运行版本冲突", 409, { currentVersion: Number(run.expected_version) });
      if (run.run_status === "CANCELLED" || run.run_status === "CANCEL_REQUESTED") {
        return { batch_id: batchId, normalization_run_id: runId, run_status: run.run_status, expected_version: Number(run.expected_version), current_version: Number(batch.current_version) };
      }
      if (!["QUEUED", "RUNNING", "PUBLISHING"].includes(run.run_status)) normalizationFailure("IMPORT_NORMALIZATION_STATUS_CONFLICT", "当前运行不能取消", 409);
      const restore = batch.current_normalization_run_id ? "NORMALIZED" : "MAPPING_CONFIRMED";
      if (run.run_status === "QUEUED") {
        assertNormalizationTransition("QUEUED", "CANCELLED");
        await client.query(`
          update material_import_normalization_runs set run_status='CANCELLED',expected_version=expected_version+1,
            cancel_requested_at=now(),cancelled_at=now(),cancelled_by=$2,completed_at=now(),current_stage='COMPLETE',updated_at=now()
          where id=$1
        `, [runId, context.actor.username]);
        if (run.worker_job_id) {
          await client.query("update material_import_job_outbox set status='CANCELLED',updated_at=now() where id=$1 and status='PENDING'", [run.worker_job_id]);
          await client.query("update background_jobs set status='CANCELLED',completed_at=now(),updated_at=now() where id=$1 and status='QUEUED'", [run.worker_job_id]);
        }
        await client.query("update material_import_batches set status=$2,current_version=current_version+1,updated_at=now() where id=$1", [batchId, restore]);
        await audit(client, { actor: context.actor.username, action: "IMPORT_NORMALIZATION_CANCELLED", requestId: context.requestId, batchId, runId });
        return { batch_id: batchId, normalization_run_id: runId, run_status: "CANCELLED", expected_version: expectedVersion + 1, current_version: Number(batch.current_version) + 1 };
      }
      assertNormalizationTransition(run.run_status as "RUNNING" | "PUBLISHING", "CANCEL_REQUESTED");
      await client.query(`
        update material_import_normalization_runs set run_status='CANCEL_REQUESTED',expected_version=expected_version+1,
          cancel_requested_at=now(),cancelled_by=$2,updated_at=now() where id=$1
      `, [runId, context.actor.username]);
      await audit(client, { actor: context.actor.username, action: "IMPORT_NORMALIZATION_CANCEL_REQUESTED", requestId: context.requestId, batchId, runId });
      return { batch_id: batchId, normalization_run_id: runId, run_status: "CANCEL_REQUESTED", expected_version: expectedVersion + 1, current_version: Number(batch.current_version) };
    });
  }

  summary(batchId: number, actor: NormalizationActor, runId?: number): Promise<Record<string, unknown>> {
    return this.#repository.summary(batchId, actor, runId);
  }

  runs(batchId: number, actor: NormalizationActor, afterVersion: number, limit: number): Promise<Record<string, unknown>> {
    return this.#repository.listRuns(batchId, actor, afterVersion, limit);
  }

  rows(input: Parameters<PostgresNormalizationRepository["listRows"]>[0]): Promise<Record<string, unknown>> {
    return this.#repository.listRows(input);
  }

  row(batchId: number, rowId: number, actor: NormalizationActor, runId?: number): Promise<Record<string, unknown>> {
    return this.#repository.rowDetail(batchId, rowId, actor, runId);
  }

  issues(input: Parameters<PostgresNormalizationRepository["listIssues"]>[0]): Promise<Record<string, unknown>> {
    return this.#repository.listIssues(input);
  }

  async #mutate(
    batchId: number,
    context: MutationContext,
    statusCode: number,
    operation: (client: PoolClient, batch: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ): Promise<MutationResult> {
    if (!UUID.test(context.requestId)) normalizationFailure("REQUEST_VALIDATION_FAILED", "请求编号无效", 400);
    if (context.idempotencyKey.length < 8 || context.idempotencyKey.length > 200) normalizationFailure("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 长度必须为 8 到 200", 400);
    const keyDigest = createHash("sha256").update(context.idempotencyKey).digest("hex");
    return this.#repository.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [context.actor.username, `${context.routeScope}:${keyDigest}`]);
      const existing = await client.query(`
        select * from material_import_idempotency
        where username=$1 and method=$2 and route_scope=$3 and key_digest=$4 for update
      `, [context.actor.username, context.method, context.routeScope, keyDigest]);
      if (existing.rows[0]) {
        if (String(existing.rows[0].request_digest) !== context.requestDigest) normalizationFailure("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
        if (existing.rows[0].state !== "COMPLETED" || !existing.rows[0].response) normalizationFailure("IDEMPOTENCY_IN_PROGRESS", "同一操作仍在处理中", 409);
        return {
          data: existing.rows[0].response,
          statusCode: Number(existing.rows[0].status_code),
          operationId: String(existing.rows[0].operation_id),
          replayed: true,
        };
      }
      const batch = await this.#repository.visibleBatch(client, batchId, context.actor, true);
      const operationId = randomUUID();
      await client.query(`
        insert into material_import_idempotency(
          username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
          lease_token,lease_expires_at,expires_at,recovery_until
        ) values($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,now()+interval '5 minutes',now()+interval '24 hours',now()+interval '7 days')
      `, [context.actor.username, context.method, context.routeScope, keyDigest, context.requestDigest, operationId, batchId, randomUUID()]);
      const data = await operation(client, batch);
      await client.query(`
        update material_import_idempotency set state='COMPLETED',response=$2,status_code=$3,
          lease_token=null,lease_expires_at=null,updated_at=now()
        where operation_id=$1
      `, [operationId, data, statusCode]);
      return { data, statusCode, operationId, replayed: false };
    });
  }
}

export function normalizationRequestDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
