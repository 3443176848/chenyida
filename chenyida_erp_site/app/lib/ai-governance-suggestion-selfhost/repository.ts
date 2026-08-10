import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { deriveAiSuggestionInputDigests, runLocalDeterministicSuggestion } from "./adapter.ts";
import { canonicalDigest, normalizeIdentity, sha256Hex } from "./canonical.ts";
import {
  AI_SUGGESTION_APPROVED_CONTRACT,
  AI_SUGGESTION_CONFIG_DIGEST,
  AI_SUGGESTION_CONFIG_VERSION,
  AI_SUGGESTION_CONTRACT_DIGEST,
  AI_SUGGESTION_EVALUATOR_VERSION,
  AI_SUGGESTION_INPUT_VERSION,
  AI_SUGGESTION_LIMITS,
  AI_SUGGESTION_PARAMETER_DIGEST,
  AI_SUGGESTION_RULE_VERSION,
  AI_SUGGESTION_SCHEMA_DIGEST,
  AI_SUGGESTION_SCHEMA_VERSION,
} from "./config.ts";
import { AiGovernanceSuggestionError, aiSuggestionFailure } from "./errors.ts";
import type {
  AiGovernanceCapability,
  AiSuggestionActor,
  AiSuggestionCandidate,
  AiSuggestionCreateResult,
  AiSuggestionEvidenceCandidate,
  AiSuggestionMutationContext,
  AiSuggestionSourceSnapshot,
} from "./types.ts";

type Queryable = Pick<Pool | PoolClient, "query">;
type StoredEnvelope = Readonly<{ data: Record<string, unknown>; operation_id: string }>;

const number = (value: unknown): number => Number(value);
const text = (value: unknown): string => String(value ?? "");
const canReadAny = (actor: AiSuggestionActor): boolean => actor.permissions.includes("*") || actor.permissions.includes("material.import.read_any");

function mapDatabaseError(error: unknown): never {
  if (error instanceof AiGovernanceSuggestionError) throw error;
  const database = error as { code?: unknown; constraint?: unknown };
  if (database.code === "23505" || database.code === "40001" || database.code === "40P01") {
    aiSuggestionFailure("AI_SUGGESTION_CONFLICT", "AI 建议已存在或发生并发冲突", 409);
  }
  if (database.code === "23514" || database.code === "23503" || database.code === "55000" || database.code === "42501") {
    aiSuggestionFailure("AI_SUGGESTION_INVARIANT_VIOLATION", "AI 建议写入未通过安全约束", 422);
  }
  throw error;
}

function expiryFrom(createdAt: Date): Date {
  return new Date(createdAt.valueOf() + AI_SUGGESTION_LIMITS.ttlDays * 24 * 60 * 60 * 1000);
}

function assertSourceIntegrity(source: AiSuggestionSourceSnapshot, drift = false): void {
  const digestPattern = /^[0-9a-f]{64}$/;
  const completeRowSet = source.rows.length <= AI_SUGGESTION_LIMITS.maximumRows;
  const valid = text(source.governanceRun.rule_version) === AI_SUGGESTION_RULE_VERSION
    && digestPattern.test(text(source.governanceRun.result_digest))
    && digestPattern.test(text(source.governanceRun.normalization_result_digest))
    && digestPattern.test(text(source.group.group_key))
    && (!source.group.identity_digest || digestPattern.test(text(source.group.identity_digest)))
    && (!completeRowSet || source.rows.length === number(source.group.source_count))
    && source.rows.every((row) => digestPattern.test(text(row.source_snapshot_digest)))
    && source.normalizationLineage.every((row) => digestPattern.test(text(row.mapping_digest)));
  if (!valid) {
    aiSuggestionFailure(
      drift ? "AI_SUGGESTION_INPUT_DRIFT" : "AI_SUGGESTION_SOURCE_INVALID",
      drift ? "AI 建议输入谱系已变化" : "治理来源事实不完整或版本不获准",
      409,
    );
  }
}

function runDigestFor(source: AiSuggestionSourceSnapshot, capability: AiGovernanceCapability, inputDigest: string): string {
  return canonicalDigest({
    group_key: text(source.group.group_key),
    group_version: number(source.group.version),
    capability,
    input_version: AI_SUGGESTION_INPUT_VERSION,
    input_digest: inputDigest,
    contract_digest: AI_SUGGESTION_CONTRACT_DIGEST,
  });
}

function suggestionDigestFor(input: Readonly<{
  groupKey: string;
  capability: AiGovernanceCapability;
  suggestionVersionNo: number;
  disposition: string;
  abstainReasonCode: string | null;
  payloadDigest: string;
}>): string {
  return canonicalDigest({
    group_key: input.groupKey,
    capability: input.capability,
    suggestion_version_no: input.suggestionVersionNo,
    disposition: input.disposition,
    abstain_reason_code: input.abstainReasonCode,
    overall_confidence: null,
    payload_digest: input.payloadDigest,
  });
}

function resultDigestFor(candidate: AiSuggestionCandidate, suggestionVersionNo: number, suggestionDigest: string): string {
  return canonicalDigest({
    disposition: candidate.disposition,
    abstain_reason_code: candidate.abstainReasonCode,
    suggestion_version_no: suggestionVersionNo,
    suggestion_digest: suggestionDigest,
    items: candidate.items.map((item) => ({
      item_digest: item.itemDigest,
      evidence_digests: item.evidence.map((entry) => entry.evidenceDigest),
    })),
  });
}

function createdEventDigest(suggestionDigest: string): string {
  return canonicalDigest({
    event_sequence: 1,
    event_type: "CREATED",
    reason_code: "AI_SUGGESTION_CREATED",
    suggestion_digest: suggestionDigest,
    expected_suggestion_row_version: 1,
    expected_previous_event_digest: null,
  });
}

function supersededEventDigest(previousSuggestionDigest: string, nextSuggestionDigest: string, previousEventDigest: string): string {
  return canonicalDigest({
    event_sequence: 2,
    event_type: "SUPERSEDED",
    reason_code: "NEW_DETERMINISTIC_VERSION",
    suggestion_digest: previousSuggestionDigest,
    superseding_suggestion_digest: nextSuggestionDigest,
    expected_suggestion_row_version: 1,
    expected_previous_event_digest: previousEventDigest,
  });
}

function publicEvidence(row: QueryResultRow): Record<string, unknown> {
  const reference = row.evidence_kind === "GOVERNANCE_ROW" ? { governance_row_id: number(row.governance_row_id) }
    : row.evidence_kind === "GOVERNANCE_SPEC" ? { governance_spec_id: number(row.governance_spec_id) }
      : row.evidence_kind === "DETERMINISTIC_MATERIAL_CANDIDATE" ? { governance_material_candidate_id: number(row.governance_material_candidate_id) }
        : row.evidence_kind === "DETERMINISTIC_ALTERNATIVE_CANDIDATE" ? { governance_alternative_candidate_id: number(row.governance_alternative_candidate_id) }
          : row.evidence_kind === "NORMALIZATION_LINEAGE" ? { normalization_lineage_id: number(row.normalization_lineage_id) }
            : row.evidence_kind === "MATERIAL_VERSION" ? { material_id: number(row.evidence_material_id), observed_version_no: number(row.observed_version_no) }
              : row.evidence_kind === "SUPPLIER_VERSION" ? { supplier_id: number(row.evidence_supplier_id), observed_version_no: number(row.observed_version_no) }
                : row.evidence_kind === "SUPPLIER_MAPPING_VERSION" ? { supplier_mapping_version_id: number(row.supplier_mapping_version_id), observed_version_no: number(row.observed_version_no) }
                  : { rule_trace_code: row.rule_trace_code, rule_trace_version: row.rule_trace_version };
  return {
    evidence_uid: row.evidence_uid,
    evidence_ordinal: number(row.evidence_ordinal),
    evidence_kind: row.evidence_kind,
    safe_field_path: row.safe_field_path,
    source_digest: row.source_digest,
    locator_digest: row.locator_digest,
    evidence_digest: row.evidence_digest,
    reference,
  };
}

function publicItem(row: QueryResultRow, evidenceRows: readonly QueryResultRow[]): Record<string, unknown> {
  const target = row.item_kind === "CLASSIFICATION" ? {
    category_id: number(row.category_id),
    category_version_snapshot: number(row.category_version_snapshot),
    category_status_snapshot: row.category_status_snapshot,
    category_digest: row.category_digest,
  } : row.item_kind === "ATTRIBUTE_EXTRACTION" ? {
    attribute_definition_id: number(row.attribute_definition_id),
    attribute_definition_version_snapshot: number(row.attribute_definition_version_snapshot),
    attribute_status_snapshot: row.attribute_status_snapshot,
    attribute_value_type: row.attribute_value_type,
    value_text: row.value_text,
    value_integer: row.value_integer == null ? null : number(row.value_integer),
    value_decimal: row.value_decimal,
    value_boolean: row.value_boolean,
    value_date: row.value_date,
    value_unit_code: row.value_unit_code,
    attribute_value_digest: row.attribute_value_digest,
  } : row.item_kind === "MATERIAL_MATCH" ? {
    material_id: number(row.material_id),
    material_version_snapshot: number(row.material_version_snapshot),
    material_status_snapshot: row.material_status_snapshot,
    material_digest: row.material_digest,
  } : {
    material_id: number(row.material_id),
    material_version_snapshot: number(row.material_version_snapshot),
    material_status_snapshot: row.material_status_snapshot,
    material_digest: row.material_digest,
    supplier_id: number(row.supplier_id),
    supplier_version_snapshot: number(row.supplier_version_snapshot),
    supplier_status_snapshot: row.supplier_status_snapshot,
    supplier_digest: row.supplier_digest,
    supplier_part_key_digest: row.supplier_part_key_digest,
    purchase_unit_id: row.purchase_unit_id == null ? null : number(row.purchase_unit_id),
    conversion_numerator: row.conversion_numerator,
    conversion_denominator: row.conversion_denominator,
  };
  return {
    item_uid: row.item_uid,
    item_kind: row.item_kind,
    item_ordinal: number(row.item_ordinal),
    candidate_rank: number(row.candidate_rank),
    score: null,
    item_digest: row.item_digest,
    target,
    evidence: evidenceRows.filter((entry) => number(entry.suggestion_item_id) === number(row.id)).map(publicEvidence),
  };
}

async function hydrate(database: Queryable, header: QueryResultRow): Promise<Record<string, unknown>> {
  const items = await database.query(`
    select * from ai_governance_suggestion_items where suggestion_id=$1 order by item_ordinal,id
  `, [header.suggestion_id]);
  const itemIds = items.rows.map((row) => number(row.id));
  const evidence = itemIds.length === 0 ? { rows: [] as QueryResultRow[] } : await database.query(`
    select evidence.*,evidence.material_id evidence_material_id,evidence.supplier_id evidence_supplier_id
    from ai_governance_suggestion_evidence evidence
    where evidence.suggestion_item_id=any($1::bigint[])
    order by evidence.suggestion_item_id,evidence.evidence_ordinal,evidence.id
  `, [itemIds]);
  const events = await database.query(`
    select event_uid,event_sequence,event_type,reason_code,event_digest,created_at
    from ai_governance_suggestion_events where suggestion_id=$1 order by event_sequence,id
  `, [header.suggestion_id]);
  return {
    run_uid: header.run_uid,
    suggestion_uid: header.suggestion_uid,
    capability: header.capability,
    group_version: number(header.group_version),
    group_input_digest: header.group_input_digest,
    suggestion_version_no: number(header.suggestion_version_no),
    disposition: header.disposition,
    abstain_reason_code: header.abstain_reason_code,
    overall_confidence: null,
    execution_mode: header.execution_mode,
    provider_id: header.provider_id,
    model_id: header.model_id,
    model_version: header.model_version,
    prompt_version: header.prompt_version,
    prompt_digest: null,
    schema_version: header.schema_version,
    schema_digest: header.schema_digest,
    evaluator_version: header.evaluator_version,
    rule_version: header.rule_version,
    config_version: header.config_version,
    config_digest: header.config_digest,
    parameter_digest: header.parameter_digest,
    confidence_semantics_version: null,
    input_version: header.input_version,
    input_digest: header.input_digest,
    contract_digest: header.contract_digest,
    run_digest: header.run_digest,
    result_digest: header.result_digest,
    payload_digest: header.payload_digest,
    suggestion_digest: header.suggestion_digest,
    created_at: new Date(String(header.created_at)).toISOString(),
    expires_at: new Date(String(header.expires_at)).toISOString(),
    items: items.rows.map((row) => publicItem(row, evidence.rows)),
    events: events.rows.map((row) => ({
      event_uid: row.event_uid,
      event_sequence: number(row.event_sequence),
      event_type: row.event_type,
      reason_code: row.reason_code,
      event_digest: row.event_digest,
      created_at: new Date(String(row.created_at)).toISOString(),
    })),
    human_review_required: true,
    formal_action_performed: false,
  };
}

export class PostgresAiGovernanceSuggestionRepository {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async transaction<T>(readOnly: boolean, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? "begin isolation level repeatable read read only" : "begin");
      const value = await work(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  private async visibleBatch(database: Queryable, batchId: number, actor: AiSuggestionActor): Promise<QueryResultRow> {
    const result = await database.query("select * from material_import_batches where id=$1", [batchId]);
    const row = result.rows[0];
    if (!row || (!canReadAny(actor) && text(row.created_by) !== actor.username)) {
      aiSuggestionFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
    }
    return row;
  }

  private async sourceSnapshot(
    client: PoolClient,
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    actor: AiSuggestionActor,
    lock: boolean,
  ): Promise<AiSuggestionSourceSnapshot> {
    const batch = await this.visibleBatch(client, batchId, actor);
    const runResult = await client.query("select * from material_governance_runs where id=$1 and batch_id=$2", [governanceRunId, batchId]);
    const governanceRun = runResult.rows[0];
    if (!governanceRun) aiSuggestionFailure("GOVERNANCE_RUN_NOT_FOUND", "治理运行不存在", 404);
    const groupResult = await client.query(`
      select * from material_governance_groups
      where id=$1 and governance_run_id=$2${lock ? " for update" : ""}
    `, [governanceGroupId, governanceRunId]);
    const group = groupResult.rows[0];
    if (!group) aiSuggestionFailure("GOVERNANCE_GROUP_NOT_FOUND", "治理候选组不存在", 404);
    const nowResult = await client.query<{ server_now: Date }>("select transaction_timestamp() server_now");
    const rowsResult = await client.query(`
      select row_fact.*
      from material_governance_rows row_fact
      where row_fact.group_id=$1 and row_fact.governance_run_id=$2
      order by row_fact.source_key,row_fact.id
      limit $3
    `, [governanceGroupId, governanceRunId, AI_SUGGESTION_LIMITS.maximumRows + 1]);
    const specsResult = await client.query(`
      select spec.*,row_fact.source_key,row_fact.source_snapshot_digest
      from material_governance_specs spec
      join material_governance_rows row_fact on row_fact.id=spec.governance_row_id
      where row_fact.group_id=$1 and row_fact.governance_run_id=$2
      order by spec.component_code,row_fact.source_key,spec.id
      limit $3
    `, [governanceGroupId, governanceRunId, AI_SUGGESTION_LIMITS.maximumSpecs + 1]);
    const lineageResult = await client.query(`
      select lineage.id,lineage.normalized_row_id,lineage.target_namespace,lineage.target_field_code,
             lineage.target_attribute_code,lineage.source_row_number,lineage.source_column_index,
             lineage.mapping_digest,lineage.transformation_rule_code,lineage.transformation_rule_version,
             lineage.lineage_ordinal,row_fact.source_key,row_fact.source_snapshot_digest
      from material_import_normalization_lineage lineage
      join material_governance_rows row_fact on row_fact.normalized_row_id=lineage.normalized_row_id
      where row_fact.group_id=$1 and row_fact.governance_run_id=$2
      order by row_fact.source_key,lineage.target_namespace,lineage.target_field_code,
               lineage.target_attribute_code nulls first,lineage.lineage_ordinal,lineage.id
      limit $3
    `, [governanceGroupId, governanceRunId, AI_SUGGESTION_LIMITS.maximumLineage + 1]);
    const candidatesResult = await client.query(`
      select candidate.*,material.internal_material_code,material.material_status,material.version
      from material_governance_material_candidates candidate
      join material_master material on material.id=candidate.material_id
      where candidate.group_id=$1
      order by candidate.candidate_rank,candidate.id
      limit $2
    `, [governanceGroupId, AI_SUGGESTION_LIMITS.maximumMaterialCandidates + 1]);
    const categoriesResult = await client.query(`
      select id,category_code,status,version from material_categories where category_code=$1 order by id
    `, [group.category]);
    const componentCodes = [...new Set(specsResult.rows.map((row) => text(row.component_code)))];
    const definitionsResult = componentCodes.length === 0 ? { rows: [] as QueryResultRow[] } : await client.query(`
      select id,attribute_code,data_type,decimal_scale,canonical_unit,allowed_values,status,version
      from material_attribute_definitions where attribute_code=any($1::text[]) order by attribute_code,id
    `, [componentCodes]);
    const supplierNames = [...new Set(rowsResult.rows.map((row) => normalizeIdentity(row.original_supplier)).filter(Boolean))];
    const supplierParts = [...new Set(rowsResult.rows.map((row) => normalizeIdentity(row.supplier_part_number)).filter(Boolean))];
    const suppliersResult = supplierNames.length === 0 ? { rows: [] as QueryResultRow[] } : await client.query(`
      select id,supplier_code,normalized_name,status,version
      from suppliers where status='ACTIVE' and upper(btrim(normalized_name))=any($1::text[]) order by id
    `, [supplierNames]);
    const supplierIds = suppliersResult.rows.map((row) => number(row.id));
    const mappingsResult = supplierIds.length === 0 || supplierParts.length === 0 ? { rows: [] as QueryResultRow[] } : await client.query(`
      select mapping.id mapping_id,mapping.mapping_uid,mapping.mapping_version_no,
             mapping.version mapping_row_version,mapping.content_digest,mapping.status mapping_status,
             mapping.supplier_id,mapping.supplier_item_code,mapping.material_id,mapping.purchase_unit_id,
             mapping.conversion_numerator,mapping.conversion_denominator,unit.code purchase_unit_code,
             supplier.supplier_code,supplier.status supplier_status,supplier.version supplier_version,
             material.internal_material_code,material.material_status,material.version,
             candidate.id governance_material_candidate_id,candidate.candidate_kind,
             candidate.candidate_digest,candidate.material_version_snapshot
      from supplier_mappings mapping
      join suppliers supplier on supplier.id=mapping.supplier_id
      join material_master material on material.id=mapping.material_id
      join material_governance_material_candidates candidate
        on candidate.group_id=$1 and candidate.material_id=mapping.material_id
      left join units unit on unit.id=mapping.purchase_unit_id and unit.enabled
      where mapping.supplier_id=any($2::bigint[])
        and upper(btrim(mapping.supplier_item_code))=any($3::text[])
        and mapping.status='ACTIVE' and mapping.valid_from<=$4
        and (mapping.valid_to is null or mapping.valid_to>$4)
      order by mapping.supplier_id,upper(btrim(mapping.supplier_item_code)),mapping.id
    `, [governanceGroupId, supplierIds, supplierParts, nowResult.rows[0].server_now]);
    return Object.freeze({
      batch,
      governanceRun,
      group,
      rows: Object.freeze(rowsResult.rows),
      specs: Object.freeze(specsResult.rows),
      normalizationLineage: Object.freeze(lineageResult.rows),
      materialCandidates: Object.freeze(candidatesResult.rows),
      categories: Object.freeze(categoriesResult.rows),
      attributeDefinitions: Object.freeze(definitionsResult.rows),
      suppliers: Object.freeze(suppliersResult.rows),
      supplierMappings: Object.freeze(mappingsResult.rows),
      serverNow: new Date(nowResult.rows[0].server_now),
    });
  }

  private async headerByRunDigest(database: Queryable, runDigest: string): Promise<QueryResultRow | undefined> {
    const result = await database.query(`
      select run.*,suggestion.id suggestion_id,suggestion.suggestion_uid,suggestion.suggestion_version_no,
             suggestion.supersedes_suggestion_id,suggestion.disposition,suggestion.abstain_reason_code,
             suggestion.payload_digest,suggestion.suggestion_digest,suggestion.created_at suggestion_created_at
      from ai_governance_suggestion_runs run
      join ai_governance_suggestions suggestion on suggestion.suggestion_run_id=run.id
      where run.run_digest=$1
    `, [runDigest]);
    return result.rows[0];
  }

  private async audit(client: PoolClient, input: Readonly<{
    actor: string;
    requestId: string;
    operationId: string;
    keyDigest: string;
    action: string;
    batchId: number;
    governanceRunId: number;
    governanceGroupId: number;
    capability: AiGovernanceCapability;
    suggestionUid: unknown;
    replaySource: string;
  }>): Promise<void> {
    await client.query(`
      insert into audit_log(
        username,action,detail,request_id,result,route_code,operation_id,
        idempotency_key_digest,retention_until
      ) values($1,$2,$3,$4,'success','AI_GOVERNANCE_SUGGESTION',$5,$6,now()+interval '1095 days')
    `, [input.actor, input.action, {
      batch_id: input.batchId,
      governance_run_id: input.governanceRunId,
      governance_group_id: input.governanceGroupId,
      capability: input.capability,
      suggestion_uid: input.suggestionUid,
      replay_source: input.replaySource,
      formal_action_performed: false,
    }, input.requestId, input.operationId, input.keyDigest]);
  }

  private async saveIdempotency(
    client: PoolClient,
    context: AiSuggestionMutationContext,
    keyDigest: string,
    databaseOperationId: string,
    envelope: StoredEnvelope,
    statusCode: number,
  ): Promise<void> {
    await client.query(`
      insert into material_api_idempotency(
        username,method,route_scope,key_digest,request_digest,operation_id,state,response,
        status_code,created_at,updated_at,expires_at
      ) values($1,'POST',$2,$3,$4,$5,'COMPLETED',$6,$7,now(),now(),now()+interval '24 hours')
    `, [context.actor.username, context.routeScope, keyDigest, context.requestDigest, databaseOperationId, envelope, statusCode]);
  }

  async create(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    capability: AiGovernanceCapability,
    expectedGroupVersion: number,
    context: AiSuggestionMutationContext,
  ): Promise<AiSuggestionCreateResult> {
    if (!/^[\x21-\x7e]{8,200}$/.test(context.idempotencyKey)) {
      aiSuggestionFailure("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 长度或字符无效", 400);
    }
    const keyDigest = sha256Hex(context.idempotencyKey);
    return this.transaction(false, async (client) => {
      const idempotencyScope = `${context.actor.username}:POST:${context.routeScope}:${keyDigest}`;
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [idempotencyScope]);
      const found = await client.query<{ request_digest: string; response: StoredEnvelope; status_code: number }>(`
        select request_digest,response,status_code from material_api_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3
        for update
      `, [context.actor.username, context.routeScope, keyDigest]);
      if (found.rows[0]) {
        if (found.rows[0].request_digest !== context.requestDigest) {
          aiSuggestionFailure("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求正文", 409);
        }
        const envelope = found.rows[0].response;
        return {
          data: envelope.data,
          operationId: envelope.operation_id,
          replayed: true,
          replaySource: "IDEMPOTENCY_KEY",
          statusCode: found.rows[0].status_code,
        };
      }
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-suggestion:${governanceGroupId}:${capability}`]);
      const source = await this.sourceSnapshot(client, batchId, governanceRunId, governanceGroupId, context.actor, true);
      assertSourceIntegrity(source);
      if (text(source.group.decision_status) !== "PENDING" || number(source.group.version) !== expectedGroupVersion || expectedGroupVersion !== 1) {
        aiSuggestionFailure("GOVERNANCE_GROUP_VERSION_CONFLICT", "治理候选组状态或版本已变化", 409, number(source.group.version));
      }
      const input = deriveAiSuggestionInputDigests(source, capability);
      const runDigest = runDigestFor(source, capability, input.inputDigest);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-run:${runDigest}`]);
      const existing = await this.headerByRunDigest(client, runDigest);
      if (existing) {
        const data = await hydrate(client, existing);
        const operationId = text(existing.operation_id);
        const envelope = { data, operation_id: operationId };
        const replayRecordOperationId = randomUUID();
        await this.audit(client, {
          actor: context.actor.username,
          requestId: context.requestId,
          operationId: replayRecordOperationId,
          keyDigest,
          action: "AI_GOVERNANCE_SUGGESTION_REPLAYED",
          batchId,
          governanceRunId,
          governanceGroupId,
          capability,
          suggestionUid: existing.suggestion_uid,
          replaySource: "RUN_DIGEST",
        });
        await this.saveIdempotency(client, context, keyDigest, replayRecordOperationId, envelope, 200);
        return { data, operationId, replayed: true, replaySource: "RUN_DIGEST", statusCode: 200 };
      }
      const candidate = runLocalDeterministicSuggestion(source, capability);
      const previousResult = await client.query(`
        select suggestion.*,created.event_digest created_event_digest
        from ai_governance_suggestions suggestion
        join ai_governance_suggestion_events created
          on created.suggestion_id=suggestion.id and created.event_type='CREATED'
        where suggestion.governance_group_id=$1 and suggestion.capability=$2
        order by suggestion.suggestion_version_no desc
        limit 1 for update of suggestion
      `, [governanceGroupId, capability]);
      const previous = previousResult.rows[0];
      if (previous) {
        const terminal = await client.query(`
          select event_type from ai_governance_suggestion_events
          where suggestion_id=$1 and event_type in ('INVALIDATED','DISCARDED','SUPERSEDED')
        `, [previous.id]);
        if (terminal.rows.length) aiSuggestionFailure("AI_SUGGESTION_VERSION_CONFLICT", "上一版建议已经终止，不能直接替代", 409);
      }
      const suggestionVersionNo = previous ? number(previous.suggestion_version_no) + 1 : 1;
      const suggestionDigest = suggestionDigestFor({
        groupKey: text(source.group.group_key),
        capability,
        suggestionVersionNo,
        disposition: candidate.disposition,
        abstainReasonCode: candidate.abstainReasonCode,
        payloadDigest: candidate.payloadDigest,
      });
      const resultDigest = resultDigestFor(candidate, suggestionVersionNo, suggestionDigest);
      const operationId = randomUUID();
      const runUid = randomUUID();
      const suggestionUid = randomUUID();
      const createdAt = source.serverNow;
      const expiresAt = expiryFrom(createdAt);
      await client.query("select set_config('cyd.ai_governance_suggestion_service_write','allowed',true)");
      const runResult = await client.query(`
        insert into ai_governance_suggestion_runs(
          run_uid,governance_run_id,governance_group_id,group_version,group_input_digest,
          capability,execution_mode,schema_version,schema_digest,evaluator_version,rule_version,
          config_version,config_digest,provider_id,model_id,model_version,prompt_version,prompt_digest,
          parameter_digest,confidence_semantics_version,input_version,input_digest,contract_digest,
          run_digest,result_digest,idempotency_key_digest,operation_id,request_id,requested_by,
          created_at,expires_at,row_version
        ) values(
          $1,$2,$3,1,$4,$5,'LOCAL_DETERMINISTIC',$6,$7,$8,$9,$10,$11,
          'LOCAL_DETERMINISTIC','NONE','NONE','NONE',null,$12,null,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,1
        ) returning id
      `, [
        runUid, governanceRunId, governanceGroupId, input.groupInputDigest, capability,
        AI_SUGGESTION_SCHEMA_VERSION, AI_SUGGESTION_SCHEMA_DIGEST, AI_SUGGESTION_EVALUATOR_VERSION,
        AI_SUGGESTION_RULE_VERSION, AI_SUGGESTION_CONFIG_VERSION, AI_SUGGESTION_CONFIG_DIGEST,
        AI_SUGGESTION_PARAMETER_DIGEST, AI_SUGGESTION_INPUT_VERSION, input.inputDigest,
        AI_SUGGESTION_CONTRACT_DIGEST, runDigest, resultDigest, keyDigest, operationId,
        context.requestId, context.actor.username, createdAt, expiresAt,
      ]);
      const suggestionResult = await client.query(`
        insert into ai_governance_suggestions(
          suggestion_uid,suggestion_run_id,governance_group_id,capability,suggestion_version_no,
          supersedes_suggestion_id,disposition,abstain_reason_code,overall_confidence,payload_digest,
          suggestion_digest,created_by,request_id,created_at,row_version
        ) values($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10,$11,$12,$13,1) returning id
      `, [suggestionUid, runResult.rows[0].id, governanceGroupId, capability, suggestionVersionNo,
        previous?.id ?? null, candidate.disposition, candidate.abstainReasonCode, candidate.payloadDigest,
        suggestionDigest, context.actor.username, context.requestId, createdAt]);
      const suggestionId = number(suggestionResult.rows[0].id);
      for (const [itemIndex, item] of candidate.items.entries()) {
        const itemResult = await client.query(`
          insert into ai_governance_suggestion_items(
            item_uid,suggestion_id,item_kind,item_ordinal,candidate_rank,score,item_digest,
            category_id,category_version_snapshot,category_status_snapshot,category_digest,
            attribute_definition_id,attribute_definition_version_snapshot,attribute_status_snapshot,
            attribute_value_type,value_text,value_integer,value_decimal,value_boolean,value_date,
            value_unit_code,attribute_value_digest,material_id,material_version_snapshot,
            material_status_snapshot,material_digest,supplier_id,supplier_version_snapshot,
            supplier_status_snapshot,supplier_digest,supplier_part_key_digest,purchase_unit_id,
            conversion_numerator,conversion_denominator,created_by,request_id,created_at,row_version
          ) values(
            $1,$2,$3,$4,$5,null,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
            $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,1
          ) returning id
        `, [
          randomUUID(), suggestionId, item.itemKind, itemIndex + 1, item.candidateRank, item.itemDigest,
          item.categoryId ?? null, item.categoryVersionSnapshot ?? null, item.categoryStatusSnapshot ?? null, item.categoryDigest ?? null,
          item.attributeDefinitionId ?? null, item.attributeDefinitionVersionSnapshot ?? null, item.attributeStatusSnapshot ?? null,
          item.attributeValueType ?? null, item.valueText ?? null, item.valueInteger ?? null, item.valueDecimal ?? null,
          item.valueBoolean ?? null, item.valueDate ?? null, item.valueUnitCode ?? null, item.attributeValueDigest ?? null,
          item.materialId ?? null, item.materialVersionSnapshot ?? null, item.materialStatusSnapshot ?? null, item.materialDigest ?? null,
          item.supplierId ?? null, item.supplierVersionSnapshot ?? null, item.supplierStatusSnapshot ?? null,
          item.supplierDigest ?? null, item.supplierPartKeyDigest ?? null, item.purchaseUnitId ?? null,
          item.conversionNumerator ?? null, item.conversionDenominator ?? null, context.actor.username,
          context.requestId, createdAt,
        ]);
        for (const [evidenceIndex, itemEvidence] of item.evidence.entries()) {
          await this.insertEvidence(client, number(itemResult.rows[0].id), evidenceIndex + 1, itemEvidence, context, createdAt);
        }
      }
      const createdDigest = createdEventDigest(suggestionDigest);
      await client.query(`
        insert into ai_governance_suggestion_events(
          event_uid,suggestion_id,event_sequence,event_type,reason_code,superseding_suggestion_id,
          expected_suggestion_row_version,expected_previous_event_digest,event_digest,operation_id,
          request_id,actor,created_at,row_version
        ) values($1,$2,1,'CREATED','AI_SUGGESTION_CREATED',null,1,null,$3,$4,$5,$6,$7,1)
      `, [randomUUID(), suggestionId, createdDigest, randomUUID(), context.requestId, context.actor.username, createdAt]);
      if (previous) {
        await client.query(`
          insert into ai_governance_suggestion_events(
            event_uid,suggestion_id,event_sequence,event_type,reason_code,superseding_suggestion_id,
            expected_suggestion_row_version,expected_previous_event_digest,event_digest,operation_id,
            request_id,actor,created_at,row_version
          ) values($1,$2,2,'SUPERSEDED','NEW_DETERMINISTIC_VERSION',$3,1,$4,$5,$6,$7,$8,$9,1)
        `, [randomUUID(), previous.id, suggestionId, previous.created_event_digest,
          supersededEventDigest(text(previous.suggestion_digest), suggestionDigest, text(previous.created_event_digest)), randomUUID(),
          context.requestId, context.actor.username, createdAt]);
      }
      const inserted = await this.headerByRunDigest(client, runDigest);
      if (!inserted) aiSuggestionFailure("AI_SUGGESTION_PERSISTENCE_FAILED", "AI 建议未能完整保存", 500);
      const data = await hydrate(client, inserted);
      const envelope = { data, operation_id: operationId };
      await this.audit(client, {
        actor: context.actor.username,
        requestId: context.requestId,
        operationId,
        keyDigest,
        action: "AI_GOVERNANCE_SUGGESTION_CREATED",
        batchId,
        governanceRunId,
        governanceGroupId,
        capability,
        suggestionUid,
        replaySource: "NONE",
      });
      await this.saveIdempotency(client, context, keyDigest, operationId, envelope, 201);
      return { data, operationId, replayed: false, replaySource: "NONE", statusCode: 201 };
    });
  }

  private async insertEvidence(
    client: PoolClient,
    suggestionItemId: number,
    ordinal: number,
    evidence: AiSuggestionEvidenceCandidate,
    context: AiSuggestionMutationContext,
    createdAt: Date,
  ): Promise<void> {
    await client.query(`
      insert into ai_governance_suggestion_evidence(
        evidence_uid,suggestion_item_id,evidence_ordinal,evidence_kind,governance_row_id,
        governance_spec_id,governance_material_candidate_id,governance_alternative_candidate_id,
        normalization_lineage_id,material_id,supplier_id,supplier_mapping_version_id,
        observed_version_no,safe_field_path,source_digest,locator_digest,evidence_digest,
        rule_trace_code,rule_trace_version,created_by,request_id,created_at,row_version
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,1)
    `, [
      randomUUID(), suggestionItemId, ordinal, evidence.evidenceKind, evidence.governanceRowId ?? null,
      evidence.governanceSpecId ?? null, evidence.governanceMaterialCandidateId ?? null,
      evidence.governanceAlternativeCandidateId ?? null, evidence.normalizationLineageId ?? null,
      evidence.materialId ?? null, evidence.supplierId ?? null, evidence.supplierMappingVersionId ?? null,
      evidence.observedVersionNo ?? null, evidence.safeFieldPath, evidence.sourceDigest,
      evidence.locatorDigest, evidence.evidenceDigest, evidence.ruleTraceCode ?? null,
      evidence.ruleTraceVersion ?? null, context.actor.username, context.requestId, createdAt,
    ]);
  }

  private async validateCurrent(
    client: PoolClient,
    header: QueryResultRow,
    source: AiSuggestionSourceSnapshot,
  ): Promise<void> {
    assertSourceIntegrity(source, true);
    if (source.serverNow.valueOf() >= new Date(String(header.expires_at)).valueOf()) {
      aiSuggestionFailure("AI_SUGGESTION_EXPIRED", "AI 建议已过期", 409);
    }
    if (text(source.group.decision_status) !== "PENDING" || number(source.group.version) !== 1 || number(header.group_version) !== 1) {
      aiSuggestionFailure("AI_SUGGESTION_GROUP_DRIFT", "治理候选组状态或版本已变化", 409);
    }
    const contractMatches = header.execution_mode === AI_SUGGESTION_APPROVED_CONTRACT.execution_mode
      && header.schema_version === AI_SUGGESTION_SCHEMA_VERSION
      && header.schema_digest === AI_SUGGESTION_SCHEMA_DIGEST
      && header.evaluator_version === AI_SUGGESTION_EVALUATOR_VERSION
      && header.rule_version === AI_SUGGESTION_RULE_VERSION
      && header.config_version === AI_SUGGESTION_CONFIG_VERSION
      && header.config_digest === AI_SUGGESTION_CONFIG_DIGEST
      && header.provider_id === "LOCAL_DETERMINISTIC"
      && header.model_id === "NONE" && header.model_version === "NONE"
      && header.prompt_version === "NONE" && header.prompt_digest == null
      && header.parameter_digest === AI_SUGGESTION_PARAMETER_DIGEST
      && header.confidence_semantics_version == null
      && header.input_version === AI_SUGGESTION_INPUT_VERSION
      && header.contract_digest === AI_SUGGESTION_CONTRACT_DIGEST;
    if (!contractMatches) aiSuggestionFailure("AI_SUGGESTION_CONTRACT_DRIFT", "AI 建议版本合同不再获准", 409);
    const capability = header.capability as AiGovernanceCapability;
    const input = deriveAiSuggestionInputDigests(source, capability);
    if (input.groupInputDigest !== header.group_input_digest || input.inputDigest !== header.input_digest || runDigestFor(source, capability, input.inputDigest) !== header.run_digest) {
      aiSuggestionFailure("AI_SUGGESTION_INPUT_DRIFT", "AI 建议输入已变化", 409);
    }
    const candidate = runLocalDeterministicSuggestion(source, capability);
    if (candidate.payloadDigest !== header.payload_digest || candidate.disposition !== header.disposition || candidate.abstainReasonCode !== header.abstain_reason_code) {
      aiSuggestionFailure("AI_SUGGESTION_RESULT_DRIFT", "AI 建议结果已无法复现", 409);
    }
    const itemRows = await client.query("select id,item_digest from ai_governance_suggestion_items where suggestion_id=$1 order by item_ordinal,id", [header.suggestion_id]);
    if (itemRows.rows.length !== candidate.items.length || itemRows.rows.some((row, index) => row.item_digest !== candidate.items[index].itemDigest)) {
      aiSuggestionFailure("AI_SUGGESTION_RESULT_DRIFT", "AI 建议候选项摘要已变化", 409);
    }
    for (const [index, row] of itemRows.rows.entries()) {
      const evidenceRows = await client.query("select evidence_digest from ai_governance_suggestion_evidence where suggestion_item_id=$1 order by evidence_ordinal,id", [row.id]);
      const expected = candidate.items[index].evidence.map((entry) => entry.evidenceDigest);
      if (evidenceRows.rows.length !== expected.length || evidenceRows.rows.some((entry, evidenceIndex) => entry.evidence_digest !== expected[evidenceIndex])) {
        aiSuggestionFailure("AI_SUGGESTION_EVIDENCE_DRIFT", "AI 建议证据已变化", 409);
      }
    }
    const suggestionDigest = suggestionDigestFor({
      groupKey: text(source.group.group_key),
      capability,
      suggestionVersionNo: number(header.suggestion_version_no),
      disposition: candidate.disposition,
      abstainReasonCode: candidate.abstainReasonCode,
      payloadDigest: candidate.payloadDigest,
    });
    if (suggestionDigest !== header.suggestion_digest || resultDigestFor(candidate, number(header.suggestion_version_no), suggestionDigest) !== header.result_digest) {
      aiSuggestionFailure("AI_SUGGESTION_DIGEST_DRIFT", "AI 建议摘要校验失败", 409);
    }
    const events = await client.query("select event_type,event_digest from ai_governance_suggestion_events where suggestion_id=$1 order by event_sequence,id", [header.suggestion_id]);
    if (events.rows.length !== 1 || events.rows[0].event_type !== "CREATED" || events.rows[0].event_digest !== createdEventDigest(suggestionDigest)) {
      aiSuggestionFailure(events.rows.some((row) => row.event_type !== "CREATED") ? "AI_SUGGESTION_TERMINATED" : "AI_SUGGESTION_EVENT_DRIFT", "AI 建议已终止或事件校验失败", 409);
    }
  }

  private async visibleHeader(
    client: PoolClient,
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    suggestionUid: string,
    actor: AiSuggestionActor,
  ): Promise<Readonly<{ header: QueryResultRow; source: AiSuggestionSourceSnapshot }>> {
    const source = await this.sourceSnapshot(client, batchId, governanceRunId, governanceGroupId, actor, false);
    const result = await client.query(`
      select run.*,suggestion.id suggestion_id,suggestion.suggestion_uid,suggestion.suggestion_version_no,
             suggestion.supersedes_suggestion_id,suggestion.disposition,suggestion.abstain_reason_code,
             suggestion.payload_digest,suggestion.suggestion_digest,suggestion.created_at suggestion_created_at
      from ai_governance_suggestion_runs run
      join ai_governance_suggestions suggestion on suggestion.suggestion_run_id=run.id
      where run.governance_run_id=$1 and run.governance_group_id=$2 and suggestion.suggestion_uid=$3
    `, [governanceRunId, governanceGroupId, suggestionUid]);
    if (!result.rows[0]) aiSuggestionFailure("AI_SUGGESTION_NOT_FOUND", "AI 建议不存在", 404);
    return { header: result.rows[0], source };
  }

  async one(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    suggestionUid: string,
    actor: AiSuggestionActor,
  ): Promise<Record<string, unknown>> {
    return this.transaction(true, async (client) => {
      const visible = await this.visibleHeader(client, batchId, governanceRunId, governanceGroupId, suggestionUid, actor);
      await this.validateCurrent(client, visible.header, visible.source);
      return {
        ...await hydrate(client, visible.header),
        current_validity: "VALID",
        review_eligible: visible.header.disposition === "SUGGEST",
      };
    });
  }

  async list(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    actor: AiSuggestionActor,
    afterUid: string | null,
    limit: number,
  ): Promise<Readonly<{ items: readonly Record<string, unknown>[]; nextAfterUid: string | null }>> {
    return this.transaction(true, async (client) => {
      const source = await this.sourceSnapshot(client, batchId, governanceRunId, governanceGroupId, actor, false);
      const result = await client.query(`
        select run.*,suggestion.id suggestion_id,suggestion.suggestion_uid,suggestion.suggestion_version_no,
               suggestion.supersedes_suggestion_id,suggestion.disposition,suggestion.abstain_reason_code,
               suggestion.payload_digest,suggestion.suggestion_digest,suggestion.created_at suggestion_created_at
        from ai_governance_suggestion_runs run
        join ai_governance_suggestions suggestion on suggestion.suggestion_run_id=run.id
        where run.governance_run_id=$1 and run.governance_group_id=$2
          and ($3::uuid is null or suggestion.suggestion_uid>$3::uuid)
        order by suggestion.suggestion_uid limit $4
      `, [governanceRunId, governanceGroupId, afterUid, limit + 1]);
      const visibleRows = result.rows.slice(0, limit);
      const items: Record<string, unknown>[] = [];
      for (const header of visibleRows) {
        try {
          await this.validateCurrent(client, header, source);
          items.push({
            ...await hydrate(client, header),
            current_validity: "VALID",
            review_eligible: header.disposition === "SUGGEST",
          });
        } catch (error) {
          if (!(error instanceof AiGovernanceSuggestionError)) throw error;
          const value = await hydrate(client, header);
          items.push({ ...value, current_validity: "INVALID", invalid_reason_code: error.code, review_eligible: false });
        }
      }
      return {
        items,
        nextAfterUid: result.rows.length > limit ? text(visibleRows.at(-1)?.suggestion_uid) : null,
      };
    });
  }
}
