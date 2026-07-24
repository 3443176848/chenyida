import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { mappingTargetSemanticProjection, PostgresMappingCatalog } from "./catalog.ts";
import { mappingFailure } from "./errors.ts";
import {
  canonicalJson,
  columnReference,
  decideReuse,
  mappingContentDigest,
  missingRequiredTargets,
  normalizeSourceHeader,
  sourceStructureDigest,
  validateMappingDraft,
} from "./rules.ts";
import type { MappingActor, MappingDraftInput, MappingItemInput, MappingTarget, SourceField } from "./types.ts";

type Queryable = Pick<Pool | PoolClient, "query">;
type BatchRow = Record<string, unknown>;
type MappingRow = Record<string, unknown>;
type MutationContext = Readonly<{
  actor: MappingActor;
  requestId: string;
  method: "POST" | "PUT";
  idempotencyKey: string;
  requestDigest: string;
  routeScope: string;
}>;
type MutationResult<T> = Readonly<{ data: T; statusCode: number; operationId: string; replayed: boolean }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMPORT_READ_ANY = "material.import.read_any";

function allowed(actor: MappingActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function numberValue(value: unknown): number {
  return Number(value);
}

function dateValue(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function cellsOf(raw: unknown): readonly Record<string, unknown>[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const cells = (raw as Record<string, unknown>).cells;
  return Array.isArray(cells) ? cells.filter((cell): cell is Record<string, unknown> => Boolean(cell) && typeof cell === "object" && !Array.isArray(cell)) : [];
}

function rawCellValue(raw: unknown, columnIndex: number): unknown {
  const cell = cellsOf(raw).find((item) => Number(item.column_index) === columnIndex);
  return cell?.display ?? cell?.raw_value ?? null;
}

function sourceColumnCount(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  return Number((raw as Record<string, unknown>).source_column_count || 0);
}

export function sourceFieldsFromRaw(raw: unknown, columnCount: number): readonly SourceField[] {
  return Object.freeze(Array.from({ length: columnCount }, (_, index) => {
    const sourceHeader = String(rawCellValue(raw, index) ?? "");
    return Object.freeze({
      column_index: index,
      column_ref: columnReference(index),
      source_header: sourceHeader,
      normalized_header: normalizeSourceHeader(sourceHeader, index),
    });
  }));
}

const HEADER_TARGETS = new Map<string, readonly [MappingItemInput["target_namespace"], string]>([
  ["standard_name", ["basic", "STANDARD_NAME"]],
  ["标准名称", ["basic", "STANDARD_NAME"]],
  ["物料名称", ["basic", "STANDARD_NAME"]],
  ["unit", ["basic", "UNIT"]],
  ["单位", ["basic", "UNIT"]],
  ["规格", ["basic", "SPECIFICATION_MODEL"]],
  ["型号", ["basic", "SPECIFICATION_MODEL"]],
  ["specification", ["basic", "SPECIFICATION_MODEL"]],
  ["description", ["basic", "DESCRIPTION"]],
  ["描述", ["basic", "DESCRIPTION"]],
  ["备注", ["basic", "DESCRIPTION"]],
  ["supplier_code", ["supplier_reference", "SUPPLIER_ITEM_CODE"]],
  ["supplier_item_code", ["supplier_reference", "SUPPLIER_ITEM_CODE"]],
  ["供应商料号", ["supplier_reference", "SUPPLIER_ITEM_CODE"]],
  ["供应商名称", ["supplier_reference", "SUPPLIER_NAME"]],
  ["supplier_name", ["supplier_reference", "SUPPLIER_NAME"]],
]);

export function suggestedItems(fields: readonly SourceField[], targets: readonly MappingTarget[]): readonly MappingItemInput[] {
  const byKey = new Map(targets.map((target) => [`${target.target_namespace}\u0000${target.target_code}`, target]));
  const used = new Set<string>();
  const items: MappingItemInput[] = [];
  for (const field of fields) {
    const alias = HEADER_TARGETS.get(field.normalized_header.toLowerCase());
    if (!alias) continue;
    const key = `${alias[0]}\u0000${alias[1]}`;
    const target = byKey.get(key);
    if (!target || used.has(key)) continue;
    used.add(key);
    items.push({
      source_column_index: field.column_index,
      source_column_indexes: [field.column_index],
      source_header: field.source_header,
      source_headers: [field.source_header],
      target_namespace: alias[0],
      target_code: alias[1],
      mapping_mode: "SOURCE",
      required: target.required_for_confirm,
      display_order: items.length,
      combination_strategy: "FIRST_NON_EMPTY",
      combination_separator: " ",
      mapping_confidence: 1,
      adaptive_mapping_status: "EXACT",
      mapping_evidence: ["HEADER_ALIAS_EXACT"],
    });
  }
  return Object.freeze(items);
}

async function batchFor(client: Queryable, batchId: number, actor: MappingActor, lock = false): Promise<BatchRow> {
  const result = await client.query(`select * from material_import_batches where id=$1${lock ? " for update" : ""}`, [batchId]);
  const batch = result.rows[0] as BatchRow | undefined;
  if (!batch || (!allowed(actor, IMPORT_READ_ANY) && String(batch.created_by) !== actor.username)) {
    mappingFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在或无权查看", 404);
  }
  return batch;
}

async function sourceContext(
  client: Queryable,
  batch: BatchRow,
  parseRunId: number,
  sheetIndex: number,
  headerMode: "SINGLE_ROW" | "NO_HEADER",
  headerRowNumber: number | null,
): Promise<Readonly<{ sheetName: string; rowCount: number; columnCount: number; fields: readonly SourceField[]; digest: string }>> {
  if (numberValue(batch.current_parse_run_id) !== parseRunId) mappingFailure("IMPORT_MAPPING_PARSE_RUN_CONFLICT", "解析结果已经变化，请刷新后重试", 409);
  const sheetResult = await client.query(`
    select sheet_name,row_count,source_column_max from material_import_parse_sheets
    where parse_run_id=$1 and sheet_index=$2 and visibility='VISIBLE' and parse_status='COMPLETED'
  `, [parseRunId, sheetIndex]);
  const sheet = sheetResult.rows[0] as Record<string, unknown> | undefined;
  if (!sheet) mappingFailure("IMPORT_MAPPING_SHEET_NOT_FOUND", "来源 Sheet 不存在或不可用于 Mapping", 404);
  const rowCount = numberValue(sheet.row_count);
  const columnCount = numberValue(sheet.source_column_max);
  if (headerMode === "SINGLE_ROW" && (!headerRowNumber || headerRowNumber < 1 || headerRowNumber > rowCount)) mappingFailure("IMPORT_HEADER_NOT_CONFIRMED", "表头行无效", 422);
  const header = headerMode === "SINGLE_ROW"
    ? await client.query("select raw_values from material_import_rows where parse_run_id=$1 and sheet_index=$2 and row_number=$3", [parseRunId, sheetIndex, headerRowNumber])
    : { rows: [{ raw_values: null }] };
  if (headerMode === "SINGLE_ROW" && !header.rows[0]) mappingFailure("IMPORT_HEADER_NOT_CONFIRMED", "表头行不存在", 422);
  const fields = sourceFieldsFromRaw(header.rows[0]?.raw_values, columnCount);
  return {
    sheetName: String(sheet.sheet_name),
    rowCount,
    columnCount,
    fields,
    digest: sourceStructureDigest({
      sourceKind: String(batch.source_kind),
      sheetName: String(sheet.sheet_name),
      sheetIndex,
      headerMode,
      headerRowNumber,
      fields,
    }),
  };
}

async function insertItems(client: Queryable, mappingId: number, items: readonly MappingItemInput[]): Promise<void> {
  for (const item of items) {
    await client.query(`
      insert into material_import_mapping_items (
        mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,
        source_column_indexes,source_headers,default_value,required,combination_strategy,
        combination_separator,mapping_confidence,adaptive_mapping_status,mapping_evidence,display_order
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [
      mappingId, item.source_column_index, item.source_header ?? null, item.target_namespace, item.target_code,
      item.mapping_mode, JSON.stringify(item.source_column_indexes ?? []), JSON.stringify(item.source_headers ?? []), item.default_value_json === undefined ? null : JSON.stringify(item.default_value_json),
      item.required, item.combination_strategy ?? "FIRST_NON_EMPTY", item.combination_separator ?? " ",
      item.mapping_confidence ?? 0, item.adaptive_mapping_status ?? "CONFIRMED", JSON.stringify(item.mapping_evidence ?? []), item.display_order,
    ]);
  }
}

async function itemRows(client: Queryable, mappingId: number): Promise<readonly Record<string, unknown>[]> {
  const result = await client.query("select * from material_import_mapping_items where mapping_id=$1 order by display_order,id", [mappingId]);
  return result.rows as Record<string, unknown>[];
}

function itemDto(row: Record<string, unknown>): MappingItemInput {
  return {
    source_column_index: row.source_column_index == null ? null : numberValue(row.source_column_index),
    source_column_indexes: Array.isArray(row.source_column_indexes) ? row.source_column_indexes.map(Number) : [],
    source_header: row.source_header == null ? null : String(row.source_header),
    source_headers: Array.isArray(row.source_headers) ? row.source_headers.map(String) : [],
    target_namespace: String(row.target_namespace) as MappingItemInput["target_namespace"],
    target_code: String(row.target_code),
    mapping_mode: String(row.mapping_mode) as MappingItemInput["mapping_mode"],
    default_value_json: row.default_value,
    required: Boolean(row.required),
    display_order: numberValue(row.display_order),
    combination_strategy: String(row.combination_strategy) as MappingItemInput["combination_strategy"],
    combination_separator: String(row.combination_separator),
    mapping_confidence: Number(row.mapping_confidence),
    adaptive_mapping_status: String(row.adaptive_mapping_status) as MappingItemInput["adaptive_mapping_status"],
    mapping_evidence: Array.isArray(row.mapping_evidence) ? row.mapping_evidence.map(String) : [],
  };
}

async function mappingDto(client: Queryable, row: MappingRow): Promise<Record<string, unknown>> {
  return {
    id: numberValue(row.id),
    mapping_key: row.mapping_key,
    batch_id: numberValue(row.batch_id),
    parse_run_id: numberValue(row.parse_run_id),
    source_kind: row.source_kind,
    selected_sheet_index: numberValue(row.selected_sheet_index),
    selected_sheet_name: row.selected_sheet_name,
    header_mode: row.header_mode,
    header_row_number: row.header_row_number == null ? null : numberValue(row.header_row_number),
    header_start_row_number: row.header_row_number == null ? null : numberValue(row.header_row_number),
    data_start_row_number: row.header_row_number == null ? 1 : numberValue(row.header_row_number) + 1,
    structure_confidence: 1,
    structure_status: "CONFIRMED",
    source_structure_digest: row.source_structure_digest,
    source_fields: row.source_fields,
    mapping_status: row.status,
    status: row.status,
    mapping_version: numberValue(row.mapping_version),
    metadata_digest: row.metadata_digest,
    mapping_digest: row.mapping_digest,
    stale_reason_code: row.stale_reason_code,
    stale_reason: row.stale_reason,
    supersedes_mapping_id: row.supersedes_mapping_id == null ? null : numberValue(row.supersedes_mapping_id),
    superseded_by_mapping_id: row.superseded_by_mapping_id == null ? null : numberValue(row.superseded_by_mapping_id),
    reuse_source_mapping_id: row.reuse_source_mapping_id == null ? null : numberValue(row.reuse_source_mapping_id),
    created_by: row.created_by,
    updated_by: row.updated_by,
    confirmed_by: row.confirmed_by,
    created_at: dateValue(row.created_at),
    updated_at: dateValue(row.updated_at),
    confirmed_at: dateValue(row.confirmed_at),
    items: (await itemRows(client, numberValue(row.id))).map(itemDto),
  };
}

async function currentMapping(client: Queryable, batchId: number, lock = false): Promise<MappingRow> {
  const result = await client.query(`
    select * from material_import_mappings
    where batch_id=$1 and status in ('DRAFT','CONFIRMED')
    order by case status when 'DRAFT' then 0 else 1 end,mapping_version desc
    limit 1${lock ? " for update" : ""}
  `, [batchId]);
  if (!result.rows[0]) mappingFailure("IMPORT_MAPPING_NOT_FOUND", "当前批次尚无 Mapping", 404);
  return result.rows[0] as MappingRow;
}

async function audit(
  client: Queryable,
  batch: BatchRow,
  context: Pick<MutationContext, "actor" | "requestId">,
  eventType: string,
  previousStatus: string | null,
  newStatus: string | null,
  safeDetails: Record<string, unknown>,
): Promise<void> {
  await client.query(`
    insert into material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details)
    values($1,$2,'USER',$3,$4,$5,$6,$7)
  `, [numberValue(batch.id), eventType, context.actor.username, previousStatus, newStatus, context.requestId, safeDetails]);
  await client.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,retention_until)
    values($1,$2,$3,$4,'success',$5,now()+interval '1095 days')
  `, [context.actor.username, eventType, safeDetails, context.requestId, `IMPORT_MAPPING_${eventType}`]);
}

function targetSnapshot(catalogTargets: readonly MappingTarget[], items: readonly MappingItemInput[]): readonly Record<string, unknown>[] {
  const keys = new Set(items.map((item) => `${item.target_namespace}\u0000${item.target_code}`));
  return catalogTargets.filter((target) => keys.has(`${target.target_namespace}\u0000${target.target_code}`)).map(mappingTargetSemanticProjection);
}

function targetCompatibility(mappingSnapshot: unknown, currentTargets: readonly MappingTarget[]): boolean {
  if (!mappingSnapshot || typeof mappingSnapshot !== "object" || Array.isArray(mappingSnapshot)) return false;
  const saved = (mappingSnapshot as Record<string, unknown>).targets;
  if (!Array.isArray(saved)) return false;
  const current = new Map(currentTargets.map((target) => [`${target.target_namespace}\u0000${target.target_code}`, mappingTargetSemanticProjection(target)]));
  return saved.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const value = item as Record<string, unknown>;
    const found = current.get(`${value.target_namespace}\u0000${value.target_code}`);
    return found !== undefined && canonicalJson(found) === canonicalJson(value);
  });
}

export async function publishInitialMapping(
  client: PoolClient,
  input: Readonly<{ batchId: number; parseRunId: number; requestId: string; actor: string; rows: readonly Readonly<{ sheetIndex: number; sheetName: string; rowNumber: number; raw: unknown }>[] }>,
): Promise<Readonly<{ mappingId: number; sourceStructureDigest: string }>> {
  const batchResult = await client.query("select * from material_import_batches where id=$1 for update", [input.batchId]);
  const batch = batchResult.rows[0] as BatchRow | undefined;
  if (!batch) mappingFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  const catalog = await new PostgresMappingCatalog(client).snapshot();
  const sheetIndexes = [...new Set(input.rows.map((row) => row.sheetIndex))].sort((a, b) => a - b);
  const selectedSheetIndex = sheetIndexes[0] ?? 0;
  const selectedRows = input.rows.filter((row) => row.sheetIndex === selectedSheetIndex);
  const sheetName = selectedRows[0]?.sheetName ?? "__CSV__";
  const columnCount = Math.max(0, ...selectedRows.map((row) => sourceColumnCount(row.raw)));
  const headerRow = selectedRows.find((row) => row.rowNumber === 1)?.raw ?? null;
  const fields = sourceFieldsFromRaw(headerRow, columnCount);
  const structureDigest = sourceStructureDigest({
    sourceKind: String(batch.source_kind),
    sheetName,
    sheetIndex: selectedSheetIndex,
    headerMode: selectedRows.length ? "SINGLE_ROW" : "NO_HEADER",
    headerRowNumber: selectedRows.length ? 1 : null,
    fields,
  });
  const items = suggestedItems(fields, catalog.targets);
  const mappingDigest = mappingContentDigest({
    selectedSheetIndex,
    headerMode: selectedRows.length ? "SINGLE_ROW" : "NO_HEADER",
    headerRowNumber: selectedRows.length ? 1 : null,
    sourceStructureDigest: structureDigest,
    metadataDigest: catalog.metadataDigest,
    items,
  });
  const previous = await client.query("select max(mapping_version)::int version from material_import_mappings where batch_id=$1", [input.batchId]);
  const created = await client.query(`
    insert into material_import_mappings (
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
      header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
      mapping_digest,status,created_by,updated_by,request_id
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'material-import-mapping-metadata-v1',$13,'DRAFT',$14,$14,$15)
    returning id
  `, [
    randomUUID(), input.batchId, input.parseRunId, Number(previous.rows[0]?.version || 0) + 1,
    String(batch.source_kind), selectedSheetIndex, sheetName, selectedRows.length ? "SINGLE_ROW" : "NO_HEADER",
    selectedRows.length ? 1 : null, structureDigest, JSON.stringify(fields), catalog.metadataDigest, mappingDigest, input.actor, input.requestId,
  ]);
  const mappingId = numberValue(created.rows[0].id);
  await insertItems(client, mappingId, items);
  return { mappingId, sourceStructureDigest: structureDigest };
}

export class MaterialImportMappingService {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async readBatch(batchId: number, actor: MappingActor): Promise<BatchRow> {
    return batchFor(this.#pool, batchId, actor);
  }

  async sheets(batchId: number, actor: MappingActor): Promise<Record<string, unknown>> {
    const batch = await batchFor(this.#pool, batchId, actor);
    const parseRunId = numberValue(batch.current_parse_run_id);
    if (!parseRunId) mappingFailure("IMPORT_PARSE_NOT_READY", "解析结果尚未就绪", 409);
    const run = await this.#pool.query("select * from material_import_parse_runs where id=$1 and batch_id=$2", [parseRunId, batchId]);
    const sheets = await this.#pool.query(`
      select s.*,
        coalesce((select jsonb_agg(jsonb_build_object('row_number',h.row_number,'rank',h.rank,'score',h.score,'reason_codes',h.reason_codes) order by h.rank)
          from material_import_header_suggestions h where h.parse_run_id=s.parse_run_id and h.sheet_index=s.sheet_index),'[]'::jsonb) header_suggestions
      from material_import_parse_sheets s where s.parse_run_id=$1 order by s.sheet_index
    `, [parseRunId]);
    return {
      batch_id: batchId,
      batch_status: batch.status,
      current_version: numberValue(batch.current_version),
      parse_run_id: parseRunId,
      parser_version: run.rows[0]?.parser_version,
      mapping_preparation_status: run.rows[0]?.mapping_preparation_status,
      workbook_summary: {
        sheet_count: sheets.rows.length,
        visible_sheet_count: sheets.rows.filter((row) => row.visibility === "VISIBLE").length,
        parsed_sheet_count: sheets.rows.filter((row) => row.parse_status === "COMPLETED").length,
        total_rows: sheets.rows.reduce((sum, row) => sum + numberValue(row.row_count), 0),
      },
      sheets: sheets.rows.map((row) => ({
        sheet_index: numberValue(row.sheet_index),
        sheet_name: row.sheet_name,
        visibility: row.visibility,
        parse_disposition: row.parse_status === "COMPLETED" ? "PARSED" : row.parse_status,
        parsed_row_count: numberValue(row.row_count),
        source_column_max: numberValue(row.source_column_max),
        merged_ranges: row.merged_ranges,
        warnings: row.warnings ?? [],
        header_suggestions: row.header_suggestions ?? [],
      })),
    };
  }

  async rows(batchId: number, actor: MappingActor, input: Readonly<{ sheetIndex: number; page: number; pageSize: number }>): Promise<Record<string, unknown>> {
    const batch = await batchFor(this.#pool, batchId, actor);
    const parseRunId = numberValue(batch.current_parse_run_id);
    if (!parseRunId) mappingFailure("IMPORT_PARSE_NOT_READY", "解析结果尚未就绪", 409);
    const count = await this.#pool.query("select count(*)::int count from material_import_rows where batch_id=$1 and parse_run_id=$2 and sheet_index=$3", [batchId, parseRunId, input.sheetIndex]);
    const result = await this.#pool.query(`
      select row_number,raw_values,raw_row_hash from material_import_rows
      where batch_id=$1 and parse_run_id=$2 and sheet_index=$3
      order by row_number limit $4 offset $5
    `, [batchId, parseRunId, input.sheetIndex, input.pageSize, (input.page - 1) * input.pageSize]);
    return {
      batch_id: batchId,
      parse_run_id: parseRunId,
      sheet_index: input.sheetIndex,
      page: input.page,
      page_size: input.pageSize,
      total_rows: numberValue(count.rows[0]?.count),
      rows: result.rows.map((row) => ({ row_number: numberValue(row.row_number), raw: row.raw_values, raw_values: row.raw_values, raw_row_hash: row.raw_row_hash })),
    };
  }

  async mapping(batchId: number, actor: MappingActor): Promise<Record<string, unknown>> {
    const batch = await batchFor(this.#pool, batchId, actor);
    const row = await currentMapping(this.#pool, batchId);
    return { batch_id: batchId, batch_status: batch.status, current_version: numberValue(batch.current_version), mapping: await mappingDto(this.#pool, row) };
  }

  async versions(batchId: number, actor: MappingActor): Promise<Record<string, unknown>> {
    await batchFor(this.#pool, batchId, actor);
    const result = await this.#pool.query("select * from material_import_mappings where batch_id=$1 order by mapping_version desc,id desc", [batchId]);
    return { batch_id: batchId, items: await Promise.all(result.rows.map((row) => mappingDto(this.#pool, row))) };
  }

  async version(batchId: number, actor: MappingActor, version: number): Promise<Record<string, unknown>> {
    await batchFor(this.#pool, batchId, actor);
    const result = await this.#pool.query("select * from material_import_mappings where batch_id=$1 and mapping_version=$2", [batchId, version]);
    if (!result.rows[0]) mappingFailure("IMPORT_MAPPING_VERSION_NOT_FOUND", "Mapping 版本不存在", 404);
    return { batch_id: batchId, mapping: await mappingDto(this.#pool, result.rows[0]) };
  }

  async catalog(batchId: number, actor: MappingActor, input: Readonly<{ query: string; limit: number; cursor: number }>): Promise<Record<string, unknown>> {
    const batch = await batchFor(this.#pool, batchId, actor);
    const snapshot = await new PostgresMappingCatalog(this.#pool).snapshot();
    const query = input.query.normalize("NFKC").trim().toLowerCase();
    const filtered = snapshot.targets.filter((target) => !query || `${target.target_code} ${target.display_name} ${target.target_namespace}`.toLowerCase().includes(query));
    const items = filtered.slice(input.cursor, input.cursor + input.limit);
    return {
      batch_id: batchId,
      parse_run_id: numberValue(batch.current_parse_run_id),
      metadata_digest: snapshot.metadataDigest,
      items,
      next_cursor: input.cursor + items.length < filtered.length ? String(input.cursor + items.length) : null,
    };
  }

  async validity(batchId: number, actor: MappingActor): Promise<Record<string, unknown>> {
    const batch = await batchFor(this.#pool, batchId, actor);
    const row = await currentMapping(this.#pool, batchId);
    const catalog = await new PostgresMappingCatalog(this.#pool).snapshot();
    const currentParse = numberValue(batch.current_parse_run_id) === numberValue(row.parse_run_id);
    const compatible = String(row.status) === "DRAFT" || targetCompatibility(row.mapping_snapshot, catalog.targets);
    return {
      batch_id: batchId,
      mapping_id: numberValue(row.id),
      status: row.status,
      valid: !["STALE", "SUPERSEDED"].includes(String(row.status)) && currentParse && compatible,
      source_structure_valid: currentParse,
      target_catalog_compatible: compatible,
      metadata_digest_matches: String(row.metadata_digest) === catalog.metadataDigest,
      reason_code: !currentParse ? "SOURCE_PARSE_RUN_CHANGED" : !compatible ? "TARGET_CATALOG_INCOMPATIBLE" : row.stale_reason_code,
    };
  }

  async reuseCandidates(batchId: number, actor: MappingActor): Promise<Record<string, unknown>> {
    const batch = await batchFor(this.#pool, batchId, actor);
    const draft = await currentMapping(this.#pool, batchId);
    if (draft.status !== "DRAFT") mappingFailure("IMPORT_MAPPING_DRAFT_REQUIRED", "当前批次没有可应用复用的 Mapping 草稿", 409);
    const catalog = await new PostgresMappingCatalog(this.#pool).snapshot();
    const result = await this.#pool.query(`
      select m.*,b.batch_no from material_import_mappings m
      join material_import_batches b on b.id=m.batch_id
      where m.batch_id<>$1 and m.status in ('CONFIRMED','STALE')
      order by m.confirmed_at desc nulls last,m.id desc limit 100
    `, [batchId]);
    const items = result.rows.map((candidate) => {
      const decision = decideReuse({
        candidateStatus: String(candidate.status),
        sourceKindMatches: String(candidate.source_kind) === String(batch.source_kind),
        structureDigestMatches: String(candidate.source_structure_digest) === String(draft.source_structure_digest),
        metadataDigestMatches: String(candidate.metadata_digest) === catalog.metadataDigest,
        targetsCompatible: targetCompatibility(candidate.mapping_snapshot, catalog.targets),
      });
      return {
        mapping_id: numberValue(candidate.id),
        mapping_version: numberValue(candidate.mapping_version),
        batch_id: numberValue(candidate.batch_id),
        batch_no: candidate.batch_no,
        confirmed_by: candidate.confirmed_by,
        confirmed_at: dateValue(candidate.confirmed_at),
        metadata_digest: candidate.metadata_digest,
        source_structure_digest: candidate.source_structure_digest,
        ...decision,
      };
    });
    return { batch_id: batchId, items };
  }

  async save(batchId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult<Record<string, unknown>>> {
    return this.#mutate(batchId, context, 200, async (client, batch) => {
      if (batch.status !== "AWAITING_MAPPING") mappingFailure("IMPORT_MAPPING_STATUS_CONFLICT", "当前批次状态不能编辑 Mapping", 409);
      if (numberValue(input.expected_version) !== numberValue(batch.current_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "导入批次版本冲突", 409, { currentVersion: numberValue(batch.current_version) });
      const row = await currentMapping(client, batchId, true);
      if (row.status !== "DRAFT" || numberValue(input.expected_mapping_version) !== numberValue(row.mapping_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 版本冲突", 409, { currentVersion: numberValue(row.mapping_version) });
      const parseRunId = numberValue(input.parse_run_id);
      const draft: MappingDraftInput = {
        selected_sheet_index: numberValue(input.selected_sheet_index),
        header_mode: String(input.header_mode) as MappingDraftInput["header_mode"],
        header_row_number: input.header_row_number == null ? null : numberValue(input.header_row_number),
        items: Array.isArray(input.items) ? input.items as MappingItemInput[] : [],
      };
      const source = await sourceContext(client, batch, parseRunId, draft.selected_sheet_index, draft.header_mode, draft.header_row_number ?? null);
      const catalog = await new PostgresMappingCatalog(client).snapshot();
      const items = validateMappingDraft(draft, { sourceColumnMax: source.columnCount, rowCount: source.rowCount, catalog });
      const mappingDigest = mappingContentDigest({
        selectedSheetIndex: draft.selected_sheet_index,
        headerMode: draft.header_mode,
        headerRowNumber: draft.header_row_number ?? null,
        sourceStructureDigest: source.digest,
        metadataDigest: catalog.metadataDigest,
        items,
      });
      const nextVersion = numberValue(row.mapping_version) + 1;
      await client.query(`
        update material_import_mappings set
          parse_run_id=$2,mapping_version=$3,selected_sheet_index=$4,selected_sheet_name=$5,header_mode=$6,
          header_row_number=$7,source_structure_digest=$8,source_fields=$9,metadata_digest=$10,mapping_digest=$11,
          mapping_snapshot=null,reuse_source_mapping_id=null,updated_by=$12,request_id=$13,updated_at=now()
        where id=$1
      `, [numberValue(row.id), parseRunId, nextVersion, draft.selected_sheet_index, source.sheetName, draft.header_mode, draft.header_row_number ?? null, source.digest, JSON.stringify(source.fields), catalog.metadataDigest, mappingDigest, context.actor.username, context.requestId]);
      await client.query("delete from material_import_mapping_items where mapping_id=$1", [numberValue(row.id)]);
      await insertItems(client, numberValue(row.id), items);
      await audit(client, batch, context, "IMPORT_MAPPING_SAVED", String(batch.status), String(batch.status), { batch_id: batchId, mapping_id: numberValue(row.id), mapping_version: nextVersion });
      const saved = await client.query("select * from material_import_mappings where id=$1", [numberValue(row.id)]);
      return { batch_id: batchId, batch_status: batch.status, current_version: numberValue(batch.current_version), mapping: await mappingDto(client, saved.rows[0]) };
    });
  }

  async preview(batchId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult<Record<string, unknown>>> {
    return this.#mutate(batchId, context, 200, async (client, batch) => {
      if (numberValue(input.expected_version) !== numberValue(batch.current_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "导入批次版本冲突", 409);
      const row = await currentMapping(client, batchId, true);
      if (row.status !== "DRAFT") mappingFailure("IMPORT_MAPPING_DRAFT_REQUIRED", "Mapping 已确认，不能重新预览为草稿", 409);
      const supplied = input.mapping as Record<string, unknown> | undefined;
      if (!supplied) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 预览正文无效", 422);
      const draft: MappingDraftInput = {
        selected_sheet_index: numberValue(supplied.selected_sheet_index),
        header_mode: String(supplied.header_mode) as MappingDraftInput["header_mode"],
        header_row_number: supplied.header_row_number == null ? null : numberValue(supplied.header_row_number),
        items: Array.isArray(supplied.items) ? supplied.items as MappingItemInput[] : [],
      };
      const source = await sourceContext(client, batch, numberValue(input.parse_run_id), draft.selected_sheet_index, draft.header_mode, draft.header_row_number ?? null);
      const catalog = await new PostgresMappingCatalog(client).snapshot();
      const items = validateMappingDraft(draft, { sourceColumnMax: source.columnCount, rowCount: source.rowCount, catalog });
      const startRow = Math.max(draft.header_mode === "SINGLE_ROW" ? Number(draft.header_row_number) + 1 : 1, numberValue(input.start_row || 1));
      const limit = Math.min(Math.max(numberValue(input.row_limit || 20), 1), 50);
      const rows = await client.query(`
        select row_number,raw_values from material_import_rows
        where parse_run_id=$1 and sheet_index=$2 and row_number>=$3 order by row_number limit $4
      `, [numberValue(input.parse_run_id), draft.selected_sheet_index, startRow, limit]);
      const previewRows = rows.rows.map((sourceRow) => ({
        row_number: numberValue(sourceRow.row_number),
        values: items.map((item) => {
          const indexes = item.source_column_indexes?.length ? item.source_column_indexes : item.source_column_index == null ? [] : [item.source_column_index];
          const sourceValues = indexes.map((index) => rawCellValue(sourceRow.raw_values, index)).filter((value) => value !== null && value !== "");
          const value = item.mapping_mode === "DEFAULT" ? item.default_value_json
            : item.combination_strategy === "JOIN_NON_EMPTY" ? sourceValues.join(item.combination_separator ?? " ")
              : sourceValues[0] ?? (item.mapping_mode === "SOURCE_WITH_DEFAULT" ? item.default_value_json : null);
          return {
            target_namespace: item.target_namespace,
            target_code: item.target_code,
            source_column_index: item.source_column_index,
            status: value === null || value === "" ? "EMPTY" : "OK",
            raw_value: sourceValues[0] ?? null,
            candidate_value: value,
            issues: value === null || value === "" ? [{ code: "EMPTY_VALUE", message: "预览值为空" }] : [],
          };
        }),
      }));
      await audit(client, batch, context, "IMPORT_MAPPING_PREVIEWED", String(batch.status), String(batch.status), { batch_id: batchId, mapping_id: numberValue(row.id), sampled_row_count: previewRows.length });
      return { batch_id: batchId, parse_run_id: numberValue(input.parse_run_id), sampled_row_count: previewRows.length, rows: previewRows };
    });
  }

  async confirm(batchId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult<Record<string, unknown>>> {
    return this.#mutate(batchId, context, 200, async (client, batch) => {
      if (batch.status !== "AWAITING_MAPPING" || numberValue(input.expected_version) !== numberValue(batch.current_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "导入批次状态或版本冲突", 409);
      const row = await currentMapping(client, batchId, true);
      if (row.status !== "DRAFT" || numberValue(input.mapping_id) !== numberValue(row.id) || numberValue(input.expected_mapping_version) !== numberValue(row.mapping_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 版本冲突", 409);
      if (numberValue(input.parse_run_id) !== numberValue(batch.current_parse_run_id) || numberValue(row.parse_run_id) !== numberValue(batch.current_parse_run_id)) mappingFailure("IMPORT_MAPPING_PARSE_RUN_CONFLICT", "解析结果已经变化", 409);
      const catalog = await new PostgresMappingCatalog(client).snapshot();
      if (String(input.metadata_digest) !== catalog.metadataDigest || String(row.metadata_digest) !== catalog.metadataDigest) mappingFailure("IMPORT_MAPPING_METADATA_CHANGED", "目标字段元数据已经变化，请重新保存并预览", 409);
      const items = (await itemRows(client, numberValue(row.id))).map(itemDto);
      const missing = missingRequiredTargets(items, catalog);
      if (missing.length) mappingFailure("IMPORT_MAPPING_REQUIRED_TARGET_MISSING", "必填目标字段尚未映射", 422, { details: missing.map((target) => ({ target_namespace: target.target_namespace, target_code: target.target_code })) });
      const duplicate = await client.query(`
        select id,mapping_version from material_import_mappings
        where batch_id=$1 and status in ('CONFIRMED','SUPERSEDED') and mapping_digest=$2 limit 1
      `, [batchId, row.mapping_digest]);
      if (duplicate.rows[0]) mappingFailure("IMPORT_MAPPING_DUPLICATE_VERSION", "相同内容的 Mapping 已经确认，不能创建无意义重复版本", 409);
      const prior = await client.query("select * from material_import_mappings where batch_id=$1 and status='CONFIRMED' for update", [batchId]);
      const snapshot = {
        schema_version: 1,
        mapping_id: numberValue(row.id),
        mapping_version: numberValue(row.mapping_version),
        source_structure_digest: row.source_structure_digest,
        metadata_digest: catalog.metadataDigest,
        source_fields: row.source_fields,
        items,
        targets: targetSnapshot(catalog.targets, items),
      };
      if (prior.rows[0]) {
        await client.query("update material_import_mappings set status='SUPERSEDED',superseded_by_mapping_id=$2,updated_by=$3,request_id=$4,updated_at=now() where id=$1", [numberValue(prior.rows[0].id), numberValue(row.id), context.actor.username, context.requestId]);
      }
      await client.query(`
        update material_import_mappings set status='CONFIRMED',mapping_snapshot=$2,supersedes_mapping_id=$3,
          confirmed_by=$4,confirmed_at=now(),updated_by=$4,request_id=$5,updated_at=now()
        where id=$1
      `, [numberValue(row.id), snapshot, prior.rows[0] ? numberValue(prior.rows[0].id) : null, context.actor.username, context.requestId]);
      const updatedBatch = await client.query(`
        update material_import_batches set status='MAPPING_CONFIRMED',current_version=current_version+1,updated_at=now()
        where id=$1 returning *
      `, [batchId]);
      await audit(client, batch, context, "IMPORT_MAPPING_CONFIRMED", String(batch.status), "MAPPING_CONFIRMED", { batch_id: batchId, mapping_id: numberValue(row.id), mapping_version: numberValue(row.mapping_version), mapping_digest: row.mapping_digest });
      const saved = await client.query("select * from material_import_mappings where id=$1", [numberValue(row.id)]);
      return { batch_id: batchId, batch_status: "MAPPING_CONFIRMED", current_version: numberValue(updatedBatch.rows[0].current_version), mapping: await mappingDto(client, saved.rows[0]) };
    });
  }

  async createVersion(batchId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult<Record<string, unknown>>> {
    return this.#mutate(batchId, context, 201, async (client, batch) => {
      if (batch.status !== "MAPPING_CONFIRMED" || numberValue(input.expected_version) !== numberValue(batch.current_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "导入批次状态或版本冲突", 409);
      const confirmed = await currentMapping(client, batchId, true);
      if (confirmed.status !== "CONFIRMED") mappingFailure("IMPORT_MAPPING_CONFIRMED_REQUIRED", "没有可作为新版本基线的已确认 Mapping", 409);
      const items = (await itemRows(client, numberValue(confirmed.id))).map(itemDto);
      const created = await client.query(`
        insert into material_import_mappings (
          mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
          header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
          mapping_digest,status,reuse_source_mapping_id,created_by,updated_by,request_id
        ) select mapping_key,batch_id,parse_run_id,mapping_version+1,source_kind,selected_sheet_index,selected_sheet_name,
          header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
          mapping_digest,'DRAFT',id,$2,$2,$3 from material_import_mappings where id=$1 returning *
      `, [numberValue(confirmed.id), context.actor.username, context.requestId]);
      await insertItems(client, numberValue(created.rows[0].id), items);
      const updated = await client.query("update material_import_batches set status='AWAITING_MAPPING',current_version=current_version+1,updated_at=now() where id=$1 returning *", [batchId]);
      await audit(client, batch, context, "IMPORT_MAPPING_VERSION_CREATED", "MAPPING_CONFIRMED", "AWAITING_MAPPING", { batch_id: batchId, mapping_id: numberValue(created.rows[0].id), source_mapping_id: numberValue(confirmed.id) });
      return { batch_id: batchId, batch_status: "AWAITING_MAPPING", current_version: numberValue(updated.rows[0].current_version), mapping: await mappingDto(client, created.rows[0]) };
    });
  }

  async applyReuse(batchId: number, context: MutationContext, input: Record<string, unknown>): Promise<MutationResult<Record<string, unknown>>> {
    return this.#mutate(batchId, context, 200, async (client, batch) => {
      if (batch.status !== "AWAITING_MAPPING" || numberValue(input.expected_version) !== numberValue(batch.current_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "导入批次状态或版本冲突", 409);
      const draft = await currentMapping(client, batchId, true);
      if (draft.status !== "DRAFT" || numberValue(input.expected_mapping_version) !== numberValue(draft.mapping_version)) mappingFailure("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 草稿版本冲突", 409);
      const candidateResult = await client.query("select * from material_import_mappings where id=$1 and batch_id<>$2", [numberValue(input.source_mapping_id), batchId]);
      const candidate = candidateResult.rows[0] as MappingRow | undefined;
      if (!candidate) mappingFailure("IMPORT_MAPPING_REUSE_SOURCE_NOT_FOUND", "复用来源 Mapping 不存在", 404);
      const catalog = await new PostgresMappingCatalog(client).snapshot();
      const decision = decideReuse({
        candidateStatus: String(candidate.status),
        sourceKindMatches: String(candidate.source_kind) === String(batch.source_kind),
        structureDigestMatches: String(candidate.source_structure_digest) === String(draft.source_structure_digest),
        metadataDigestMatches: String(candidate.metadata_digest) === catalog.metadataDigest,
        targetsCompatible: targetCompatibility(candidate.mapping_snapshot, catalog.targets),
      });
      if (!["AUTO_RECOMMEND", "RECONFIRM_REQUIRED"].includes(decision.decision)) mappingFailure("IMPORT_MAPPING_REUSE_INCOMPATIBLE", "该 Mapping 版本与当前文件结构或字段元数据不兼容", 409, { details: [{ reason_code: decision.reason_code }] });
      const items = (await itemRows(client, numberValue(candidate.id))).map(itemDto);
      const source = await sourceContext(client, batch, numberValue(draft.parse_run_id), numberValue(draft.selected_sheet_index), String(draft.header_mode) as "SINGLE_ROW" | "NO_HEADER", draft.header_row_number == null ? null : numberValue(draft.header_row_number));
      const validated = validateMappingDraft({ selected_sheet_index: numberValue(draft.selected_sheet_index), header_mode: String(draft.header_mode) as "SINGLE_ROW" | "NO_HEADER", header_row_number: draft.header_row_number == null ? null : numberValue(draft.header_row_number), items }, { sourceColumnMax: source.columnCount, rowCount: source.rowCount, catalog });
      const nextVersion = numberValue(draft.mapping_version) + 1;
      const mappingDigest = mappingContentDigest({
        selectedSheetIndex: numberValue(draft.selected_sheet_index),
        headerMode: String(draft.header_mode) as "SINGLE_ROW" | "NO_HEADER",
        headerRowNumber: draft.header_row_number == null ? null : numberValue(draft.header_row_number),
        sourceStructureDigest: source.digest,
        metadataDigest: catalog.metadataDigest,
        items: validated,
      });
      await client.query(`
        update material_import_mappings set mapping_version=$2,metadata_digest=$3,mapping_digest=$4,
          mapping_snapshot=null,reuse_source_mapping_id=$5,updated_by=$6,request_id=$7,updated_at=now()
        where id=$1
      `, [numberValue(draft.id), nextVersion, catalog.metadataDigest, mappingDigest, numberValue(candidate.id), context.actor.username, context.requestId]);
      await client.query("delete from material_import_mapping_items where mapping_id=$1", [numberValue(draft.id)]);
      await insertItems(client, numberValue(draft.id), validated);
      await audit(client, batch, context, "IMPORT_MAPPING_REUSED", String(batch.status), String(batch.status), { batch_id: batchId, mapping_id: numberValue(draft.id), source_mapping_id: numberValue(candidate.id), decision: decision.decision });
      const saved = await client.query("select * from material_import_mappings where id=$1", [numberValue(draft.id)]);
      return { batch_id: batchId, batch_status: batch.status, current_version: numberValue(batch.current_version), reuse_decision: decision.decision, confirmation_required: true, mapping: await mappingDto(client, saved.rows[0]) };
    });
  }

  async #mutate<T>(
    batchId: number,
    context: MutationContext,
    statusCode: number,
    operation: (client: PoolClient, batch: BatchRow) => Promise<T>,
  ): Promise<MutationResult<T>> {
    if (!UUID.test(context.requestId)) mappingFailure("REQUEST_VALIDATION_FAILED", "请求编号无效", 400);
    if (!context.idempotencyKey || context.idempotencyKey.length < 8 || context.idempotencyKey.length > 200) mappingFailure("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 长度必须为 8 到 200", 400);
    const keyDigest = createHash("sha256").update(context.idempotencyKey).digest("hex");
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1),hashtext($2))", [context.actor.username, `${context.routeScope}:${keyDigest}`]);
      const existing = await client.query(`
        select * from material_import_idempotency
        where username=$1 and method=$2 and route_scope=$3 and key_digest=$4
        for update
      `, [context.actor.username, context.method, context.routeScope, keyDigest]);
      if (existing.rows[0]) {
        if (String(existing.rows[0].request_digest) !== context.requestDigest) mappingFailure("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已用于不同请求", 409);
        if (existing.rows[0].state !== "COMPLETED" || !existing.rows[0].response) mappingFailure("IDEMPOTENCY_IN_PROGRESS", "同一操作仍在处理中", 409);
        await client.query("commit");
        return { data: existing.rows[0].response as T, statusCode: numberValue(existing.rows[0].status_code), operationId: String(existing.rows[0].operation_id), replayed: true };
      }
      const operationId = randomUUID();
      const batch = await batchFor(client, batchId, context.actor, true);
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
      await client.query("commit");
      return { data, statusCode, operationId, replayed: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
