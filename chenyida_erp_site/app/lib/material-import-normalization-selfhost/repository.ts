import type { Pool, PoolClient, QueryResultRow } from "pg";
import { PostgresMappingCatalog } from "../material-import-selfhost/catalog.ts";
import type { MaterialImportRawRow } from "../material-import/parser-model.ts";
import type { MappingItemInput, MappingTarget } from "../material-import-selfhost/types.ts";
import { normalizationFailure } from "./errors.ts";
import type { NormalizationActor, NormalizationMappingContext, NormalizedRowBundle } from "./types.ts";

type Queryable = Pick<Pool | PoolClient, "query">;

export type NormalizationRunRow = QueryResultRow & {
  id: string | number;
  batch_id: string | number;
  parse_run_id: string | number;
  mapping_id: string | number;
  source_file_id: string | number;
  source_sheet_id: string | number;
  mapping_version: number;
  mapping_digest: string;
  source_schema_digest: string;
  processor_version: string;
  normalizer_rule_version: string;
  metadata_digest: string;
  mapping_snapshot: Record<string, unknown>;
  run_version: number;
  run_status: string;
  expected_version: number;
  attempt_no: number;
  retry_count: number;
  supersedes_run_id: string | number | null;
  worker_job_id: string | null;
  lease_token: string | null;
  current_stage: string;
  total_rows: number;
  processed_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  skipped_rows: number;
  issue_count: number;
  warning_count: number;
  error_count: number;
  normalized_json_bytes: string | number;
  result_digest: string | null;
  requested_by: string;
  rerun_reason: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  published_at: Date | null;
  cancel_requested_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  heartbeat_at: Date | null;
  failure_code: string | null;
  safe_failure_message: string | null;
  created_at: Date;
  updated_at: Date;
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) normalizationFailure("IMPORT_NORMALIZATION_DATA_INVALID", "规范化数据标识无效", 500);
  return parsed;
}

function jsonValue(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function allowed(actor: NormalizationActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function targetMap(targets: readonly MappingTarget[]): ReadonlyMap<string, MappingTarget> {
  return new Map(targets.map((target) => [`${target.target_namespace}\u0000${target.target_code}`, target]));
}

export function runDto(row: NormalizationRunRow | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: numberValue(row.id),
    parse_run_id: numberValue(row.parse_run_id),
    mapping_id: numberValue(row.mapping_id),
    mapping_version: Number(row.mapping_version),
    mapping_digest: row.mapping_digest,
    source_schema_digest: row.source_schema_digest,
    processor_version: row.processor_version,
    normalizer_rule_version: row.normalizer_rule_version,
    payload_schema_version: 1,
    metadata_digest: row.metadata_digest,
    run_version: Number(row.run_version),
    run_status: row.run_status,
    expected_version: Number(row.expected_version),
    attempt_no: Number(row.attempt_no),
    retry_count: Number(row.retry_count),
    supersedes_run_id: row.supersedes_run_id == null ? null : numberValue(row.supersedes_run_id),
    current_stage: row.current_stage,
    total_rows: Number(row.total_rows),
    processed_rows: Number(row.processed_rows),
    valid_rows: Number(row.valid_rows),
    warning_rows: Number(row.warning_rows),
    error_rows: Number(row.error_rows),
    skipped_rows: Number(row.skipped_rows),
    issue_count: Number(row.issue_count),
    warning_count: Number(row.warning_count),
    error_count: Number(row.error_count),
    normalized_json_bytes: numberValue(row.normalized_json_bytes),
    result_digest: row.result_digest,
    failure_code: row.failure_code,
    safe_failure_message: row.safe_failure_message,
    started_at: iso(row.started_at),
    heartbeat_at: iso(row.heartbeat_at),
    completed_at: iso(row.completed_at),
    published_at: iso(row.published_at),
    cancel_requested_at: iso(row.cancel_requested_at),
    cancelled_at: iso(row.cancelled_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export class PostgresNormalizationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  get pool(): Pool {
    return this.#pool;
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async visibleBatch(database: Queryable, batchId: number, actor: NormalizationActor, lock = false): Promise<QueryResultRow> {
    const result = await database.query(`select * from material_import_batches where id=$1${lock ? " for update" : ""}`, [batchId]);
    const row = result.rows[0];
    if (!row || (!allowed(actor, "material.import.read_any") && String(row.created_by) !== actor.username)) {
      normalizationFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
    }
    return row;
  }

  async run(database: Queryable, batchId: number, runId: number, lock = false): Promise<NormalizationRunRow> {
    const result = await database.query<NormalizationRunRow>(`select * from material_import_normalization_runs where id=$1 and batch_id=$2${lock ? " for update" : ""}`, [runId, batchId]);
    if (!result.rows[0]) normalizationFailure("IMPORT_NORMALIZATION_RUN_NOT_FOUND", "规范化运行不存在", 404);
    return result.rows[0];
  }

  async mappingContext(database: Queryable, run: NormalizationRunRow, revalidate = true): Promise<NormalizationMappingContext> {
    const mappingResult = await database.query(`
      select m.*,f.id source_file_id,s.id source_sheet_id,s.sheet_name source_sheet_name,p.source_structure_digest parse_source_digest
      from material_import_mappings m
      join material_import_files f on f.batch_id=m.batch_id
      join material_import_parse_sheets s on s.parse_run_id=m.parse_run_id and s.sheet_index=m.selected_sheet_index
      join material_import_parse_runs p on p.id=m.parse_run_id
      where m.id=$1 and m.batch_id=$2
    `, [numberValue(run.mapping_id), numberValue(run.batch_id)]);
    const mapping = mappingResult.rows[0];
    if (!mapping || String(mapping.status) !== "CONFIRMED") normalizationFailure("IMPORT_NORMALIZATION_MAPPING_STALE", "Mapping 版本已失效或不可用", 422);
    if (
      numberValue(mapping.parse_run_id) !== numberValue(run.parse_run_id)
      || Number(mapping.mapping_version) !== Number(run.mapping_version)
      || String(mapping.mapping_digest) !== run.mapping_digest
      || String(mapping.source_structure_digest) !== run.source_schema_digest
      || String(mapping.parse_source_digest) !== run.source_schema_digest
    ) normalizationFailure("IMPORT_NORMALIZATION_SOURCE_SCHEMA_MISMATCH", "源结构或 Mapping 绑定已变化", 422);
    const snapshot = mapping.mapping_snapshot as Record<string, unknown>;
    if (!snapshot || Number(snapshot.schema_version) !== 1 || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.targets) || !Array.isArray(snapshot.source_fields)) {
      normalizationFailure("IMPORT_NORMALIZATION_MAPPING_INVALID", "Mapping 不可变快照不完整", 422);
    }
    const catalog = await new PostgresMappingCatalog(database).snapshot();
    if (revalidate && (catalog.metadataDigest !== run.metadata_digest || String(mapping.metadata_digest) !== run.metadata_digest)) {
      normalizationFailure("IMPORT_NORMALIZATION_MAPPING_STALE", "目标字段元数据已变化，Mapping 需要重新确认", 422);
    }
    const savedTargets = snapshot.targets as MappingTarget[];
    for (const saved of savedTargets) {
      const current = catalog.targetByKey.get(`${saved.target_namespace}\u0000${saved.target_code}`);
      if (!current) normalizationFailure(saved.target_namespace === "attribute" ? "IMPORT_NORMALIZATION_UNKNOWN_ATTRIBUTE" : "IMPORT_NORMALIZATION_UNKNOWN_TARGET", "Mapping 目标已停用或不存在", 422);
    }
    return {
      batchId: numberValue(run.batch_id),
      parseRunId: numberValue(run.parse_run_id),
      mappingId: numberValue(run.mapping_id),
      mappingVersion: Number(run.mapping_version),
      mappingDigest: run.mapping_digest,
      sourceSchemaDigest: run.source_schema_digest,
      metadataDigest: run.metadata_digest,
      sourceFileId: numberValue(mapping.source_file_id),
      sourceSheetId: numberValue(mapping.source_sheet_id),
      sourceSheetIndex: Number(mapping.selected_sheet_index),
      sourceSheetName: String(mapping.source_sheet_name),
      headerRowNumber: mapping.header_row_number == null ? null : Number(mapping.header_row_number),
      sourceFields: snapshot.source_fields as NormalizationMappingContext["sourceFields"],
      mappingSnapshot: snapshot,
      mappingItems: snapshot.items as MappingItemInput[],
      catalog: Object.freeze({ ...catalog, targets: Object.freeze([...catalog.targets]), targetByKey: targetMap(catalog.targets) }),
    };
  }

  async listRuns(batchId: number, actor: NormalizationActor, afterVersion: number, limit: number): Promise<Record<string, unknown>> {
    await this.visibleBatch(this.#pool, batchId, actor);
    const result = await this.#pool.query<NormalizationRunRow>(`
      select * from material_import_normalization_runs
      where batch_id=$1 and ($2::integer=0 or run_version<$2)
      order by run_version desc,id desc limit $3
    `, [batchId, afterVersion, limit + 1]);
    const page = result.rows.slice(0, limit);
    return {
      batch_id: batchId,
      items: page.map((row) => runDto(row)),
      next_after_version: result.rows.length > limit ? Number(page.at(-1)?.run_version ?? 0) : null,
    };
  }

  async summary(batchId: number, actor: NormalizationActor, selectedRunId?: number): Promise<Record<string, unknown>> {
    const batch = await this.visibleBatch(this.#pool, batchId, actor);
    const current = batch.current_normalization_run_id
      ? (await this.#pool.query<NormalizationRunRow>("select * from material_import_normalization_runs where id=$1 and batch_id=$2 and published_at is not null", [batch.current_normalization_run_id, batchId])).rows[0]
      : undefined;
    const latest = (await this.#pool.query<NormalizationRunRow>("select * from material_import_normalization_runs where batch_id=$1 order by run_version desc,id desc limit 1", [batchId])).rows[0];
    let selected = current;
    if (selectedRunId !== undefined) {
      const result = await this.#pool.query<NormalizationRunRow>("select * from material_import_normalization_runs where id=$1 and batch_id=$2 and published_at is not null", [selectedRunId, batchId]);
      if (!result.rows[0]) normalizationFailure("IMPORT_NORMALIZATION_RUN_NOT_FOUND", "已发布规范化运行不存在", 404);
      selected = result.rows[0];
    }
    return {
      batch_id: batchId,
      batch_status: batch.status,
      current_version: Number(batch.current_version),
      current_run: runDto(current),
      latest_attempt: runDto(latest),
      selected_run: runDto(selected),
    };
  }

  async publishedRun(batchId: number, actor: NormalizationActor, requestedRunId?: number): Promise<NormalizationRunRow> {
    const batch = await this.visibleBatch(this.#pool, batchId, actor);
    const runId = requestedRunId ?? (batch.current_normalization_run_id == null ? undefined : numberValue(batch.current_normalization_run_id));
    if (!runId) normalizationFailure("IMPORT_NORMALIZATION_NOT_PUBLISHED", "尚无已发布的规范化结果", 409);
    const result = await this.#pool.query<NormalizationRunRow>("select * from material_import_normalization_runs where id=$1 and batch_id=$2 and published_at is not null and run_status in ('SUCCEEDED','SUPERSEDED')", [runId, batchId]);
    if (!result.rows[0]) normalizationFailure("IMPORT_NORMALIZATION_RUN_NOT_FOUND", "已发布规范化运行不存在", 404);
    return result.rows[0];
  }

  async listRows(input: Readonly<{
    batchId: number;
    actor: NormalizationActor;
    runId?: number;
    afterId: number;
    limit: number;
    rowStatus?: string;
    issueLevel?: string;
  }>): Promise<Record<string, unknown>> {
    const run = await this.publishedRun(input.batchId, input.actor, input.runId);
    const clauses = ["r.normalization_run_id=$1", "r.id>$2"];
    const values: unknown[] = [numberValue(run.id), input.afterId];
    if (input.rowStatus) {
      values.push(input.rowStatus);
      clauses.push(`r.row_status=$${values.length}`);
    }
    if (input.issueLevel) {
      values.push(input.issueLevel);
      clauses.push(`exists(select 1 from material_import_normalization_issues i where i.normalized_row_id=r.id and i.issue_level=$${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.#pool.query(`
      select r.id,r.source_sheet_index,r.source_sheet_name,r.source_row_number,r.source_raw_row_hash,r.normalized_payload_hash,
        r.row_status,r.core_candidate_count,r.attribute_candidate_count,r.issue_count,r.error_count,r.warning_count,r.created_at
      from material_import_normalized_rows r
      where ${clauses.join(" and ")}
      order by r.id limit $${values.length}
    `, values);
    const page = result.rows.slice(0, input.limit).map((row) => ({
      ...row,
      id: numberValue(row.id),
      source_sheet_index: Number(row.source_sheet_index),
      source_row_number: Number(row.source_row_number),
      core_candidate_count: Number(row.core_candidate_count),
      attribute_candidate_count: Number(row.attribute_candidate_count),
      issue_count: Number(row.issue_count),
      error_count: Number(row.error_count),
      warning_count: Number(row.warning_count),
      created_at: iso(row.created_at),
    }));
    return {
      batch_id: input.batchId,
      normalization_run_id: numberValue(run.id),
      items: page,
      next_after_id: result.rows.length > input.limit ? numberValue(page.at(-1)?.id) : null,
    };
  }

  async rowDetail(batchId: number, rowId: number, actor: NormalizationActor, requestedRunId?: number): Promise<Record<string, unknown>> {
    const run = await this.publishedRun(batchId, actor, requestedRunId);
    const result = await this.#pool.query(`
      select n.*,r.raw_values
      from material_import_normalized_rows n
      join material_import_rows r on r.id=n.source_row_id
      where n.id=$1 and n.normalization_run_id=$2
    `, [rowId, numberValue(run.id)]);
    const row = result.rows[0];
    if (!row) normalizationFailure("IMPORT_NORMALIZED_ROW_NOT_FOUND", "规范化行不存在", 404);
    const [fields, attributes, lineage, issues] = await Promise.all([
      this.#pool.query("select * from material_import_normalized_field_candidates where normalized_row_id=$1 order by display_order,id", [rowId]),
      this.#pool.query("select * from material_import_normalized_attribute_candidates where normalized_row_id=$1 order by display_order,id", [rowId]),
      this.#pool.query("select * from material_import_normalization_lineage where normalized_row_id=$1 order by target_namespace,target_field_code,lineage_ordinal,id", [rowId]),
      this.#pool.query("select * from material_import_normalization_issues where normalized_row_id=$1 order by id", [rowId]),
    ]);
    return {
      batch_id: batchId,
      normalization_run_id: numberValue(run.id),
      row: {
        id: numberValue(row.id),
        source_sheet_index: Number(row.source_sheet_index),
        source_sheet_name: row.source_sheet_name,
        source_row_number: Number(row.source_row_number),
        source_raw_row_hash: row.source_raw_row_hash,
        normalized_payload_hash: row.normalized_payload_hash,
        row_status: row.row_status,
        error_count: Number(row.error_count),
        warning_count: Number(row.warning_count),
        created_at: iso(row.created_at),
      },
      raw_row: row.raw_values,
      normalized_payload: row.normalized_payload,
      field_candidates: fields.rows,
      attribute_candidates: attributes.rows,
      lineage: lineage.rows,
      issues: issues.rows.map((issue) => ({
        ...issue,
        id: numberValue(issue.id),
        normalized_row_id: numberValue(issue.normalized_row_id),
        source_sheet_index: Number(issue.source_sheet_index),
        source_row_number: Number(issue.source_row_number),
      })),
    };
  }

  async listIssues(input: Readonly<{
    batchId: number;
    actor: NormalizationActor;
    runId?: number;
    afterId: number;
    limit: number;
    level?: string;
    code?: string;
    targetCode?: string;
    sourceRowNumber?: number;
  }>): Promise<Record<string, unknown>> {
    const run = await this.publishedRun(input.batchId, input.actor, input.runId);
    const clauses = ["normalization_run_id=$1", "id>$2"];
    const values: unknown[] = [numberValue(run.id), input.afterId];
    for (const [column, value] of [["issue_level", input.level], ["issue_code", input.code], ["target_code", input.targetCode], ["source_row_number", input.sourceRowNumber]] as const) {
      if (value !== undefined) {
        values.push(value);
        clauses.push(`${column}=$${values.length}`);
      }
    }
    values.push(input.limit + 1);
    const result = await this.#pool.query(`select * from material_import_normalization_issues where ${clauses.join(" and ")} order by id limit $${values.length}`, values);
    const page = result.rows.slice(0, input.limit).map((row) => ({
      id: numberValue(row.id),
      normalized_row_id: numberValue(row.normalized_row_id),
      issue_level: row.issue_level,
      issue_code: row.issue_code,
      target_code: row.target_code,
      attribute_code: row.attribute_code,
      source_sheet_index: Number(row.source_sheet_index),
      source_row_number: Number(row.source_row_number),
      source_column_index: row.source_column_index == null ? null : Number(row.source_column_index),
      safe_message: row.safe_message,
      safe_details: row.safe_details,
      source_value_summary: row.source_value_summary,
      rule_code: row.rule_code,
      created_at: iso(row.created_at),
    }));
    return {
      batch_id: input.batchId,
      normalization_run_id: numberValue(run.id),
      items: page,
      next_after_id: result.rows.length > input.limit ? numberValue(page.at(-1)?.id) : null,
    };
  }

  async sourceRows(database: Queryable, mapping: NormalizationMappingContext, afterId: number, limit: number): Promise<readonly Readonly<{
    id: number;
    rowNumber: number;
    rawRowHash: string;
    rawRow: MaterialImportRawRow;
  }>[]> {
    const values: unknown[] = [mapping.parseRunId, mapping.sourceSheetIndex, afterId, limit];
    const header = mapping.headerRowNumber === null ? "" : " and row_number<>$5";
    if (mapping.headerRowNumber !== null) values.push(mapping.headerRowNumber);
    const result = await database.query(`
      select id,row_number,raw_row_hash,raw_values
      from material_import_rows
      where parse_run_id=$1 and sheet_index=$2 and id>$3${header}
      order by id limit $4
    `, values);
    return result.rows.map((row) => ({
      id: numberValue(row.id),
      rowNumber: Number(row.row_number),
      rawRowHash: String(row.raw_row_hash),
      rawRow: row.raw_values as MaterialImportRawRow,
    }));
  }

  async replaceStagedRow(
    client: PoolClient,
    run: NormalizationRunRow,
    mapping: NormalizationMappingContext,
    source: Readonly<{ id: number; rowNumber: number; rawRowHash: string }>,
    bundle: NormalizedRowBundle,
  ): Promise<void> {
    const existing = await client.query("select id from material_import_normalized_rows where normalization_run_id=$1 and source_row_id=$2", [numberValue(run.id), source.id]);
    if (existing.rows[0]) {
      const rowId = numberValue(existing.rows[0].id);
      await client.query("delete from material_import_normalization_lineage where normalized_row_id=$1", [rowId]);
      await client.query("delete from material_import_normalized_attribute_candidates where normalized_row_id=$1", [rowId]);
      await client.query("delete from material_import_normalized_field_candidates where normalized_row_id=$1", [rowId]);
      await client.query("delete from material_import_normalization_issues where normalized_row_id=$1", [rowId]);
      await client.query("delete from material_import_normalized_rows where id=$1", [rowId]);
    }
    const errorCount = bundle.issues.filter((issue) => issue.level === "ERROR").length;
    const warningCount = bundle.issues.length - errorCount;
    const inserted = await client.query(`
      insert into material_import_normalized_rows(
        batch_id,normalization_run_id,source_row_id,source_sheet_id,source_sheet_index,source_sheet_name,source_row_number,
        source_raw_row_hash,normalized_payload,normalized_payload_hash,mapped_values,row_status,review_status,
        core_candidate_count,attribute_candidate_count,issue_count,error_count,warning_count,result_summary
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'NEEDS_REVIEW',$13,$14,$15,$16,$17,$18)
      returning id
    `, [
      mapping.batchId,
      numberValue(run.id),
      source.id,
      mapping.sourceSheetId,
      mapping.sourceSheetIndex,
      mapping.sourceSheetName,
      source.rowNumber,
      source.rawRowHash,
      jsonValue(bundle.payload),
      bundle.payloadHash,
      jsonValue(bundle.mappedValues),
      bundle.rowStatus,
      bundle.fieldCandidates.length,
      bundle.attributeCandidates.length,
      bundle.issues.length,
      errorCount,
      warningCount,
      jsonValue({
        core_candidate_count: bundle.fieldCandidates.length,
        attribute_candidate_count: bundle.attributeCandidates.length,
        issue_count: bundle.issues.length,
      }),
    ]);
    const rowId = numberValue(inserted.rows[0].id);
    for (const candidate of bundle.fieldCandidates) {
      await client.query(`
        insert into material_import_normalized_field_candidates(
          normalization_run_id,normalized_row_id,target_namespace,target_field_code,raw_value,normalized_value,
          value_state,validation_status,transformation_rule_code,transformation_rule_version,display_order
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [numberValue(run.id), rowId, candidate.targetNamespace, candidate.targetCode, jsonValue(candidate.rawValue), jsonValue(candidate.normalizedValue), candidate.valueState, candidate.validationStatus, candidate.ruleCode, candidate.ruleVersion, candidate.displayOrder]);
    }
    for (const candidate of bundle.attributeCandidates) {
      await client.query(`
        insert into material_import_normalized_attribute_candidates(
          normalization_run_id,normalized_row_id,attribute_code,attribute_name_snapshot,data_type,raw_value,
          normalized_value,unit_code,validation_status,transformation_rule_code,transformation_rule_version,display_order
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [numberValue(run.id), rowId, candidate.attributeCode, candidate.attributeName, candidate.dataType, jsonValue(candidate.rawValue), jsonValue(candidate.normalizedValue), candidate.unitCode, candidate.validationStatus, candidate.ruleCode, candidate.ruleVersion, candidate.displayOrder]);
    }
    for (const item of bundle.lineage) {
      await client.query(`
        insert into material_import_normalization_lineage(
          normalization_run_id,normalized_row_id,target_namespace,target_field_code,target_attribute_code,
          source_sheet_id,source_sheet_name,source_row_number,source_column_index,source_column_name,source_field_key,
          raw_value_summary,normalized_value_summary,mapping_id,mapping_digest,transformation_rule_code,
          transformation_rule_version,transformation_steps,lineage_ordinal
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [numberValue(run.id), rowId, item.targetNamespace, item.targetCode, item.attributeCode, mapping.sourceSheetId, mapping.sourceSheetName, source.rowNumber, item.sourceColumnIndex, item.sourceColumnName, item.sourceFieldKey, jsonValue(item.rawValueSummary), jsonValue(item.normalizedValueSummary), mapping.mappingId, mapping.mappingDigest, item.ruleCode, item.ruleVersion, jsonValue(item.steps), item.ordinal]);
    }
    for (const issue of bundle.issues) {
      await client.query(`
        insert into material_import_normalization_issues(
          normalization_run_id,normalized_row_id,issue_level,issue_code,issue_key,target_code,attribute_code,
          source_sheet_index,source_row_number,source_column_index,safe_message,safe_details,source_value_summary,rule_code
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [numberValue(run.id), rowId, issue.level, issue.code, issue.issueKey, issue.targetCode, issue.attributeCode, mapping.sourceSheetIndex, source.rowNumber, issue.sourceColumnIndex, issue.message, jsonValue(issue.safeDetails), jsonValue(issue.sourceValueSummary), issue.ruleCode]);
    }
  }
}
