import type { MaterialMasterD1Database, MaterialMasterD1Statement } from "../material-master/index.ts";
import { extractSpecificationCandidate } from "./adaptive-import.ts";
import { MaterialImportParserServiceError, type MaterialImportParserServiceResult } from "./parser-service.ts";
import {
  MaterialImportMappingMetadataSnapshotService,
  requiredMappingTargets,
  type MaterialImportMappingMetadataSnapshot,
  type MaterialImportMappingTargetNamespace,
} from "./mapping-target-registry.ts";

type MappingBatch = { id: number; status: string; created_by: string; current_version: number; current_parse_run_id: number | null };
type MappingRow = { id: number; batch_id: number; parse_run_id: number; selected_sheet_index: number; header_mode: "SINGLE_ROW" | "NO_HEADER"; header_row_number: number | null; mapping_status: string; mapping_version: number; metadata_digest: string; suggestion_algorithm_version: string | null; created_at: string; updated_at: string; confirmed_at: string | null; supplier_profile_id?: number | null; header_start_row_number?: number | null; data_start_row_number?: number | null; structure_confidence?: number; structure_status?: string; structure_evidence_json?: string };
type MappingItemRow = { id: number; mapping_id: number; source_column_index: number | null; source_header: string | null; target_namespace: string; target_code: string; mapping_mode: string; default_value_json: string | null; required: 0 | 1; display_order: number; source_column_indexes_json?: string | null; source_headers_json?: string | null; combination_strategy?: "FIRST_NON_EMPTY" | "JOIN_NON_EMPTY" | "SPECIFICATION_EXTRACT"; combination_separator?: string; mapping_confidence?: number; adaptive_mapping_status?: string; mapping_evidence_json?: string };

export type MaterialImportMappingItemInput = Readonly<{
  source_column_index: number | null;
  source_column_indexes?: readonly number[];
  source_header?: string | null;
  source_headers?: readonly string[];
  target_namespace: "basic" | "attribute" | "category_hint" | "supplier_reference" | "ignore";
  target_code: string;
  mapping_mode: "SOURCE" | "SOURCE_WITH_DEFAULT" | "DEFAULT" | "IGNORE";
  default_value_json?: unknown;
  required: boolean;
  display_order: number;
  combination_strategy?: "FIRST_NON_EMPTY" | "JOIN_NON_EMPTY" | "SPECIFICATION_EXTRACT";
  combination_separator?: string;
  mapping_confidence?: number;
  adaptive_mapping_status?: "EXACT" | "HIGH_CONFIDENCE" | "SUGGESTED" | "UNMAPPED" | "CONFLICT" | "CONFIRMED";
  mapping_evidence?: readonly string[];
}>;

export type MaterialImportMappingDraftInput = Readonly<{
  selected_sheet_index: number;
  header_mode: "SINGLE_ROW" | "NO_HEADER";
  header_row_number?: number | null;
  items: readonly MaterialImportMappingItemInput[];
}>;

type Visibility = Readonly<{ username: string; canReadAny: boolean }>;
type WriteContext = Visibility & Readonly<{ idempotencyKey: string; requestId: string }>;

async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertKey(value: string): void {
  if (value.length < 8 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new MaterialImportParserServiceError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 必须为 8 到 200 个安全字符", 400);
}

async function batchVisible(database: MaterialMasterD1Database, batchId: number, visibility: Visibility): Promise<MappingBatch> {
  const batch = await database.prepare("SELECT id,status,created_by,current_version,current_parse_run_id FROM material_import_batches WHERE id=?").bind(batchId).first<MappingBatch>();
  if (!batch || (!visibility.canReadAny && batch.created_by !== visibility.username)) throw new MaterialImportParserServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return batch;
}

async function currentMapping(database: MaterialMasterD1Database, runId: number): Promise<MappingRow | null> {
  return database.prepare("SELECT * FROM material_import_mappings WHERE parse_run_id=? AND mapping_status<>'SUPERSEDED' ORDER BY id DESC LIMIT 1").bind(runId).first<MappingRow>();
}

async function mappingItems(database: MaterialMasterD1Database, mappingId: number): Promise<MappingItemRow[]> {
  return (await database.prepare("SELECT * FROM material_import_mapping_items WHERE mapping_id=? ORDER BY display_order,id").bind(mappingId).all<MappingItemRow>()).results ?? [];
}

function projectedItem(row: MappingItemRow): Record<string, unknown> {
  return {
    id: row.id,
    source_column_index: row.source_column_index,
    source_column_indexes: row.source_column_indexes_json ? JSON.parse(row.source_column_indexes_json) : row.source_column_index === null ? [] : [row.source_column_index],
    source_header: row.source_header,
    source_headers: row.source_headers_json ? JSON.parse(row.source_headers_json) : row.source_header ? [row.source_header] : [],
    target_namespace: row.target_namespace,
    target_code: row.target_code,
    mapping_mode: row.mapping_mode,
    default_value_json: row.default_value_json === null ? null : JSON.parse(row.default_value_json),
    required: row.required === 1,
    display_order: row.display_order,
    combination_strategy: row.combination_strategy ?? "FIRST_NON_EMPTY",
    combination_separator: row.combination_separator ?? " ",
    mapping_confidence: row.mapping_confidence ?? 0,
    adaptive_mapping_status: row.adaptive_mapping_status ?? "UNMAPPED",
    mapping_evidence: row.mapping_evidence_json ? JSON.parse(row.mapping_evidence_json) : [],
  };
}

async function adaptiveSchemaAvailable(database: MaterialMasterD1Database): Promise<boolean> {
  const row = await database.prepare("SELECT 1 AS present FROM pragma_table_info('material_import_mapping_items') WHERE name='source_column_indexes_json'").first<{ present: number }>();
  return row?.present === 1;
}

async function mappingPayload(database: MaterialMasterD1Database, batch: MappingBatch, mapping: MappingRow): Promise<Record<string, unknown>> {
  return {
    batch_id: batch.id,
    batch_status: batch.status,
    current_version: batch.current_version,
    mapping: {
      id: mapping.id,
      batch_id: mapping.batch_id,
      parse_run_id: mapping.parse_run_id,
      selected_sheet_index: mapping.selected_sheet_index,
      header_mode: mapping.header_mode,
      header_row_number: mapping.header_row_number,
      header_start_row_number: mapping.header_start_row_number ?? mapping.header_row_number,
      data_start_row_number: mapping.data_start_row_number ?? (mapping.header_row_number === null ? 1 : mapping.header_row_number + 1),
      structure_confidence: mapping.structure_confidence ?? 0,
      structure_status: mapping.structure_status ?? "NEEDS_REVIEW",
      structure_evidence: mapping.structure_evidence_json ? JSON.parse(mapping.structure_evidence_json) : {},
      supplier_profile_id: mapping.supplier_profile_id ?? null,
      mapping_status: mapping.mapping_status,
      mapping_version: mapping.mapping_version,
      metadata_digest: mapping.metadata_digest,
      suggestion_algorithm_version: mapping.suggestion_algorithm_version,
      items: (await mappingItems(database, mapping.id)).map(projectedItem),
    },
  };
}

export async function listMaterialImportSheets(database: MaterialMasterD1Database, batchId: number, visibility: Visibility): Promise<MaterialImportParserServiceResult> {
  const batch = await batchVisible(database, batchId, visibility);
  if (!batch.current_parse_run_id || !["PARSED", "AWAITING_MAPPING", "MAPPING_CONFIRMED"].includes(batch.status)) throw new MaterialImportParserServiceError("IMPORT_PARSE_NOT_ALLOWED", "当前批次尚无已发布解析结果", 409);
  const run = await database.prepare("SELECT id,parser_version,mapping_preparation_status,rows_written FROM material_import_parse_runs WHERE id=? AND run_status='SUCCEEDED'").bind(batch.current_parse_run_id).first<{ id: number; parser_version: string; mapping_preparation_status: string; rows_written: number }>();
  if (!run) throw new MaterialImportParserServiceError("IMPORT_PARSE_NOT_ALLOWED", "当前批次尚无已发布解析结果", 409);
  const rows = (await database.prepare("SELECT * FROM material_import_parse_sheets WHERE parse_run_id=? ORDER BY sheet_index").bind(run.id).all<{ sheet_index: number; sheet_name: string; visibility: string; parse_status: string; row_count: number; source_column_max: number; safe_warnings_json: string | null }>()).results ?? [];
  const suggestions = (await database.prepare("SELECT sheet_index,row_number,rank,score,reason_codes_json,algorithm_version FROM material_import_header_suggestions WHERE parse_run_id=? ORDER BY sheet_index,rank,id").bind(run.id).all<{ sheet_index: number; row_number: number; rank: number; score: number; reason_codes_json: string; algorithm_version: string }>()).results ?? [];
  const visibleRows = rows.filter((row) => row.visibility === "VISIBLE");
  const defaultIndex = visibleRows.find((row) => row.row_count > 0)?.sheet_index ?? visibleRows[0]?.sheet_index ?? null;
  return { status: 200, payload: {
    batch_id: batch.id, batch_status: batch.status, current_version: batch.current_version, parse_run_id: run.id, parser_version: run.parser_version, mapping_preparation_status: run.mapping_preparation_status,
    workbook_summary: { workbook_sheet_count: rows.length, visible_sheet_count: visibleRows.length, hidden_sheet_count: rows.filter((row) => row.visibility === "HIDDEN").length, very_hidden_sheet_count: rows.filter((row) => row.visibility === "VERY_HIDDEN").length, parsed_sheet_count: rows.filter((row) => row.parse_status === "COMPLETED").length, skipped_sheet_count: rows.filter((row) => row.parse_status !== "COMPLETED").length, parsed_row_count: run.rows_written, skipped_sheet_warnings: rows.filter((row) => row.visibility !== "VISIBLE").flatMap((row) => row.safe_warnings_json ? JSON.parse(row.safe_warnings_json) : []) },
    sheets: rows.map((row) => ({ sheet_index: row.sheet_index, sheet_name: row.sheet_name, visibility: row.visibility, parse_disposition: row.parse_status === "COMPLETED" ? "PARSED" : row.parse_status, parsed_row_count: row.visibility === "VISIBLE" ? row.row_count : 0, source_column_max: row.visibility === "VISIBLE" ? row.source_column_max : 0, is_default_suggestion: row.sheet_index === defaultIndex, header_suggestions: row.visibility === "VISIBLE" ? suggestions.filter((suggestion) => suggestion.sheet_index === row.sheet_index).map((suggestion) => ({ ...suggestion, reason_codes: JSON.parse(suggestion.reason_codes_json), reason_codes_json: undefined })) : [], warnings: row.safe_warnings_json ? JSON.parse(row.safe_warnings_json) : [] })),
  } };
}

export async function listMaterialImportRows(database: MaterialMasterD1Database, batchId: number, visibility: Visibility & Readonly<{ sheetIndex: number; page: number; pageSize: number; startRow?: number; endRow?: number }>): Promise<MaterialImportParserServiceResult> {
  const batch = await batchVisible(database, batchId, visibility);
  if (!batch.current_parse_run_id || !["PARSED", "AWAITING_MAPPING", "MAPPING_CONFIRMED"].includes(batch.status)) throw new MaterialImportParserServiceError("IMPORT_PARSE_NOT_ALLOWED", "当前批次尚无已发布解析结果", 409);
  if (!Number.isInteger(visibility.sheetIndex) || visibility.sheetIndex < 0 || visibility.sheetIndex > 31) throw new MaterialImportParserServiceError("IMPORT_SHEET_NOT_FOUND", "Sheet 不存在", 404);
  const sheet = await database.prepare("SELECT row_count FROM material_import_parse_sheets WHERE parse_run_id=? AND sheet_index=? AND visibility='VISIBLE' AND parse_status='COMPLETED'").bind(batch.current_parse_run_id, visibility.sheetIndex).first<{ row_count: number }>();
  if (!sheet) throw new MaterialImportParserServiceError("IMPORT_SHEET_NOT_FOUND", "Sheet 不存在", 404);
  let start: number;
  let end: number;
  let page = visibility.page;
  let pageSize = visibility.pageSize;
  if (visibility.startRow !== undefined || visibility.endRow !== undefined) {
    if (!visibility.startRow || !visibility.endRow || visibility.endRow < visibility.startRow || visibility.endRow - visibility.startRow + 1 > 100) throw new MaterialImportParserServiceError("INVALID_REQUEST", "行范围无效或超过 100 行", 400);
    start = visibility.startRow; end = visibility.endRow; page = 1; pageSize = end - start + 1;
  } else {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new MaterialImportParserServiceError("INVALID_REQUEST", "分页参数无效", 400);
    start = (page - 1) * pageSize + 1; end = start + pageSize - 1;
  }
  const rows = (await database.prepare("SELECT row_number,raw_values_json,raw_row_hash FROM material_import_rows WHERE parse_run_id=? AND sheet_index=? AND row_number BETWEEN ? AND ? ORDER BY row_number LIMIT 100").bind(batch.current_parse_run_id, visibility.sheetIndex, start, end).all<{ row_number: number; raw_values_json: string; raw_row_hash: string }>()).results ?? [];
  return { status: 200, payload: { batch_id: batch.id, parse_run_id: batch.current_parse_run_id, sheet_index: visibility.sheetIndex, rows: rows.map((row) => ({ sheet_index: visibility.sheetIndex, row_number: row.row_number, ...JSON.parse(row.raw_values_json), raw_row_hash: row.raw_row_hash })), page, page_size: pageSize, total_rows: sheet.row_count } };
}

export async function getMaterialImportMapping(database: MaterialMasterD1Database, batchId: number, visibility: Visibility): Promise<MaterialImportParserServiceResult> {
  const batch = await batchVisible(database, batchId, visibility);
  if (!batch.current_parse_run_id) throw new MaterialImportParserServiceError("IMPORT_MAPPING_NOT_FOUND", "Mapping 不存在", 404);
  const mapping = await currentMapping(database, batch.current_parse_run_id);
  if (!mapping) throw new MaterialImportParserServiceError("IMPORT_MAPPING_NOT_FOUND", "Mapping 不存在", 404);
  return { status: 200, payload: await mappingPayload(database, batch, mapping) };
}

async function validateDraft(database: MaterialMasterD1Database, runId: number, draft: MaterialImportMappingDraftInput, metadata?: MaterialImportMappingMetadataSnapshot): Promise<Readonly<{ metadataDigest: string; items: MaterialImportMappingItemInput[] }>> {
  if (!Number.isInteger(draft.selected_sheet_index) || draft.selected_sheet_index < 0 || draft.selected_sheet_index > 31 || !Array.isArray(draft.items) || draft.items.length < 1 || draft.items.length > 256) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Mapping 结构无效", 422);
  const sheet = await database.prepare("SELECT row_count,source_column_max FROM material_import_parse_sheets WHERE parse_run_id=? AND sheet_index=? AND visibility='VISIBLE' AND parse_status='COMPLETED'").bind(runId, draft.selected_sheet_index).first<{ row_count: number; source_column_max: number }>();
  if (!sheet) throw new MaterialImportParserServiceError("IMPORT_SHEET_NOT_FOUND", "Sheet 不存在", 404);
  if ((draft.header_mode === "SINGLE_ROW" && (!Number.isInteger(draft.header_row_number) || Number(draft.header_row_number) < 1 || Number(draft.header_row_number) > sheet.row_count)) || (draft.header_mode === "NO_HEADER" && draft.header_row_number != null)) throw new MaterialImportParserServiceError("IMPORT_HEADER_NOT_CONFIRMED", "表头模式或行号无效", 422);
  if (draft.header_mode !== "SINGLE_ROW" && draft.header_mode !== "NO_HEADER") throw new MaterialImportParserServiceError("IMPORT_HEADER_NOT_CONFIRMED", "表头模式无效", 422);
  const snapshot = metadata ?? await new MaterialImportMappingMetadataSnapshotService(database).current();
  const snapshots = new MaterialImportMappingMetadataSnapshotService(database);
  const targets = new Set<string>();
  const items = [...draft.items];
  for (const item of items) {
    const requiresSource = item.mapping_mode !== "DEFAULT";
    const sourceColumns = item.source_column_indexes?.length ? [...new Set(item.source_column_indexes)] : item.source_column_index === null ? [] : [item.source_column_index];
    if (sourceColumns.length > 8 || sourceColumns.some((column) => !Number.isInteger(column) || column < 0 || column >= sheet.source_column_max)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Mapping 源列无效", 422);
    if (requiresSource && !sourceColumns.length) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Mapping 必须指定来源列", 422);
    if (!requiresSource && item.source_column_index !== null) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "默认值 Mapping 不得指定源列", 422);
    if (!requiresSource && sourceColumns.length) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "默认值 Mapping 不得指定来源列", 422);
    if (item.source_headers && item.source_headers.length !== sourceColumns.length) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "组合表头与来源列数量不一致", 422);
    const strategy = item.combination_strategy ?? "FIRST_NON_EMPTY";
    if (!["FIRST_NON_EMPTY", "JOIN_NON_EMPTY", "SPECIFICATION_EXTRACT"].includes(strategy)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "来源列组合策略无效", 422);
    if (strategy !== "FIRST_NON_EMPTY" && sourceColumns.length < 1) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "组合 Mapping 缺少来源列", 422);
    if (strategy === "SPECIFICATION_EXTRACT" && `${item.target_namespace}.${item.target_code}` !== "supplier_reference.SUPPLIER_SPECIFICATION") throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "规格提取策略只能用于规格目标", 422);
    if ((item.combination_separator ?? " ").length > 10 || /[\u0000-\u001f\u007f]/.test(item.combination_separator ?? " ")) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "组合分隔符无效", 422);
    if (item.mapping_confidence !== undefined && (!Number.isFinite(item.mapping_confidence) || item.mapping_confidence < 0 || item.mapping_confidence > 1)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Mapping 置信度无效", 422);
    if (item.adaptive_mapping_status && !["EXACT", "HIGH_CONFIDENCE", "SUGGESTED", "UNMAPPED", "CONFLICT", "CONFIRMED"].includes(item.adaptive_mapping_status)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Mapping 状态无效", 422);
    if (item.adaptive_mapping_status === "CONFLICT" || item.adaptive_mapping_status === "UNMAPPED") throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "冲突或未映射字段必须先人工处理", 422);
    if (item.mapping_mode === "IGNORE" && item.target_namespace !== "ignore") throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Ignore Mapping 无效", 422);
    const targetDefinition = snapshots.lookup(snapshot, item.target_namespace as MaterialImportMappingTargetNamespace, item.target_code);
    if (!targetDefinition || !targetDefinition.mapping_modes.includes(item.mapping_mode)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_INVALID", "Mapping 目标无效或已禁用", 422);
    if (item.required !== targetDefinition.required_for_confirm) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "Mapping 必填规则与当前目标元数据不一致", 422);
    const target = `${item.target_namespace}.${item.target_code}`;
    if (item.target_namespace !== "ignore" && targets.has(target)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_DUPLICATE_TARGET", "一个目标字段只能映射一次", 422);
    targets.add(target);
    if (!Number.isInteger(item.display_order) || item.display_order < 0 || item.display_order > 255) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "显示顺序无效", 422);
    if (item.mapping_mode === "DEFAULT" || item.mapping_mode === "SOURCE_WITH_DEFAULT") {
      const value = item.default_value_json;
      if (value !== null && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "默认值只能是受限标量", 422);
      if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value))) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "数值默认值无效", 422);
    } else if (item.default_value_json !== undefined && item.default_value_json !== null) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "当前 Mapping 模式不允许默认值", 422);
  }
  return { metadataDigest: snapshot.metadataDigest, items };
}

type IdempotencyClaim = Readonly<{ keyDigest: string; requestDigest: string; route: string; replay?: MaterialImportParserServiceResult }>;
async function claimWrite(database: MaterialMasterD1Database, batchId: number, context: WriteContext, method: "POST" | "PUT", route: string, body: unknown, clock: () => Date): Promise<IdempotencyClaim> {
  assertKey(context.idempotencyKey);
  const keyDigest = await digest(context.idempotencyKey);
  const requestDigest = await digest(JSON.stringify(body));
  const scope = `material-import:${batchId}:${route}`;
  const existing = await database.prepare("SELECT request_digest,state,status_code,response_json FROM material_import_idempotency WHERE username=? AND method=? AND route_scope=? AND key_digest=?").bind(context.username, method, scope, keyDigest).first<{ request_digest: string; state: string; status_code: number | null; response_json: string | null }>();
  if (existing) {
    if (existing.request_digest !== requestDigest) throw new MaterialImportParserServiceError("IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求", 409);
    if (existing.state === "COMPLETED" && existing.status_code && existing.response_json) return { keyDigest, requestDigest, route: scope, replay: { status: existing.status_code, payload: JSON.parse(existing.response_json) as Record<string, unknown>, replayed: true } };
    throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 请求正在处理", 409);
  }
  const now = clock(); const seconds = Math.floor(now.getTime() / 1000);
  await database.prepare(`INSERT INTO material_import_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until) VALUES(?,?,?,?,?,?,'PENDING',?,?,?, ?,?,?)`).bind(context.username, method, scope, keyDigest, requestDigest, crypto.randomUUID(), batchId, await digest(crypto.randomUUID()), seconds + 120, now.toISOString(), now.toISOString(), seconds + 604_800).run();
  return { keyDigest, requestDigest, route: scope };
}

async function completeWrite(database: MaterialMasterD1Database, context: WriteContext, method: "POST" | "PUT", claim: IdempotencyClaim, result: MaterialImportParserServiceResult, clock: () => Date): Promise<MaterialImportParserServiceResult> {
  const now = clock();
  await database.prepare("UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=?,response_json=?,updated_at=?,expires_at=? WHERE username=? AND method=? AND route_scope=? AND key_digest=? AND request_digest=? AND state='PENDING'").bind(result.status, JSON.stringify(result.payload), now.toISOString(), Math.floor(now.getTime() / 1000) + 86_400, context.username, method, claim.route, claim.keyDigest, claim.requestDigest).run();
  return result;
}

async function readCompletedWrite(database: MaterialMasterD1Database, context: WriteContext, method: "POST" | "PUT", claim: IdempotencyClaim): Promise<MaterialImportParserServiceResult> {
  const row = await database.prepare("SELECT status_code,response_json FROM material_import_idempotency WHERE username=? AND method=? AND route_scope=? AND key_digest=? AND request_digest=? AND state='COMPLETED'").bind(context.username, method, claim.route, claim.keyDigest, claim.requestDigest).first<{ status_code: number; response_json: string }>();
  if (!row?.status_code || !row.response_json) throw new MaterialImportParserServiceError("INTERNAL_ERROR", "Mapping 幂等结果无法读取", 500);
  return { status: row.status_code, payload: JSON.parse(row.response_json) as Record<string, unknown> };
}

export async function replaceMaterialImportMapping(database: MaterialMasterD1Database, batchId: number, context: WriteContext & Readonly<{ expectedVersion: number; parseRunId: number; expectedMappingVersion: number; draft: MaterialImportMappingDraftInput }>, clock: () => Date = () => new Date()): Promise<MaterialImportParserServiceResult> {
  const claim = await claimWrite(database, batchId, context, "PUT", "mapping", { expected_version: context.expectedVersion, parse_run_id: context.parseRunId, expected_mapping_version: context.expectedMappingVersion, mapping: context.draft }, clock); if (claim.replay) return claim.replay;
  const batch = await batchVisible(database, batchId, context);
  if (batch.status !== "AWAITING_MAPPING" || batch.current_parse_run_id !== context.parseRunId) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "批次或解析版本已变化", 409, batch.current_version);
  if (batch.current_version !== context.expectedVersion) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "批次版本已变化", 409, batch.current_version);
  const mapping = await currentMapping(database, context.parseRunId);
  if (!mapping || mapping.mapping_status !== "DRAFT") throw new MaterialImportParserServiceError("IMPORT_MAPPING_NOT_FOUND", "可编辑 Mapping 不存在", 404);
  if (mapping.mapping_version !== context.expectedMappingVersion) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 版本已变化", 409, mapping.mapping_version);
  const validated = await validateDraft(database, context.parseRunId, context.draft);
  const adaptive = await adaptiveSchemaAvailable(database);
  const timestamp = clock().toISOString();
  const statements: MaterialMasterD1Statement[] = [
    database.prepare("UPDATE material_import_mappings SET selected_sheet_index=?,header_mode=?,header_row_number=?,mapping_version=mapping_version+1,metadata_digest=?,updated_by=?,updated_at=? WHERE id=? AND mapping_status='DRAFT' AND mapping_version=?").bind(context.draft.selected_sheet_index, context.draft.header_mode, context.draft.header_row_number ?? null, validated.metadataDigest, context.username, timestamp, mapping.id, context.expectedMappingVersion),
    database.prepare("DELETE FROM material_import_mapping_items WHERE mapping_id=?").bind(mapping.id),
  ];
  validated.items.forEach((item) => {
    const sourceColumns = item.source_column_indexes?.length ? [...new Set(item.source_column_indexes)] : item.source_column_index === null ? [] : [item.source_column_index];
    if (adaptive) {
      statements.push(database.prepare(`INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,default_value_json,required,display_order,source_column_indexes_json,source_headers_json,combination_strategy,combination_separator,mapping_confidence,adaptive_mapping_status,mapping_evidence_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(mapping.id, sourceColumns[0] ?? null, item.source_header?.slice(0, 32_767) ?? null, item.target_namespace, item.target_code, item.mapping_mode, item.default_value_json === undefined ? null : JSON.stringify(item.default_value_json), item.required ? 1 : 0, item.display_order, sourceColumns.length ? JSON.stringify(sourceColumns) : null, item.source_headers?.length ? JSON.stringify(item.source_headers.map((value) => value.slice(0, 32_767))) : null, item.combination_strategy ?? "FIRST_NON_EMPTY", item.combination_separator ?? " ", item.mapping_confidence ?? 0, item.adaptive_mapping_status ?? "CONFIRMED", JSON.stringify((item.mapping_evidence ?? []).slice(0, 20))));
    } else {
      if (sourceColumns.length > 1) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "当前数据库版本不支持多来源列 Mapping", 409);
      statements.push(database.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,default_value_json,required,display_order) VALUES(?,?,?,?,?,?,?,?,?)").bind(mapping.id, sourceColumns[0] ?? null, item.source_header?.slice(0, 32_767) ?? null, item.target_namespace, item.target_code, item.mapping_mode, item.default_value_json === undefined ? null : JSON.stringify(item.default_value_json), item.required ? 1 : 0, item.display_order));
    }
  });
  statements.push(
    database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,request_id,safe_details_json,created_at) VALUES(?,'MAPPING_SAVED','USER',?,?,json_object('mapping_id',?,'mapping_version',?),?)").bind(batchId, context.username, context.requestId, mapping.id, mapping.mapping_version + 1, timestamp),
    database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES(?,'MATERIAL_IMPORT_MAPPING_SAVED',?,?,'success','MATERIAL_IMPORT_MAPPING',?,?)").bind(context.username, String(mapping.id), context.requestId, Math.floor(clock().getTime() / 1000) + 1_095 * 86_400, timestamp),
    database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=200,response_json=(
      SELECT json_object(
        'batch_id',b.id,'batch_status',b.status,'current_version',b.current_version,
        'mapping',json_object(
          'id',m.id,'batch_id',m.batch_id,'parse_run_id',m.parse_run_id,'selected_sheet_index',m.selected_sheet_index,
          'header_mode',m.header_mode,'header_row_number',m.header_row_number,'mapping_status',m.mapping_status,
          'mapping_version',m.mapping_version,'metadata_digest',m.metadata_digest,
          'items',json(COALESCE((SELECT json_group_array(json(item_json)) FROM (
            SELECT json_object(
              'id',i.id,'source_column_index',i.source_column_index,'source_header',i.source_header,
              'target_namespace',i.target_namespace,'target_code',i.target_code,'mapping_mode',i.mapping_mode,
              'default_value_json',json(COALESCE(i.default_value_json,'null')),
              'required',json(CASE WHEN i.required=1 THEN 'true' ELSE 'false' END),'display_order',i.display_order
            ) AS item_json
            FROM material_import_mapping_items i WHERE i.mapping_id=m.id ORDER BY i.display_order,i.id
          )),'[]'))
        )
      ) FROM material_import_batches b JOIN material_import_mappings m ON m.batch_id=b.id
      WHERE b.id=? AND m.id=?
    ),updated_at=?,expires_at=? WHERE username=? AND method='PUT' AND route_scope=? AND key_digest=? AND request_digest=? AND state='PENDING'`).bind(batchId, mapping.id, timestamp, Math.floor(clock().getTime() / 1000) + 86_400, context.username, claim.route, claim.keyDigest, claim.requestDigest),
  );
  await database.batch(statements);
  const updated = await currentMapping(database, context.parseRunId);
  if (!updated || updated.mapping_version !== mapping.mapping_version + 1) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 版本已变化", 409);
  return readCompletedWrite(database, context, "PUT", claim);
}

export async function previewMaterialImportMapping(database: MaterialMasterD1Database, batchId: number, context: WriteContext & Readonly<{ expectedVersion: number; parseRunId: number; draft: MaterialImportMappingDraftInput; startRow: number; rowLimit: number }>, clock: () => Date = () => new Date()): Promise<MaterialImportParserServiceResult> {
  const claim = await claimWrite(database, batchId, context, "POST", "mapping-preview", { expected_version: context.expectedVersion, parse_run_id: context.parseRunId, mapping: context.draft, start_row: context.startRow, row_limit: context.rowLimit }, clock); if (claim.replay) return claim.replay;
  const batch = await batchVisible(database, batchId, context);
  if (batch.status !== "AWAITING_MAPPING" || batch.current_parse_run_id !== context.parseRunId || batch.current_version !== context.expectedVersion) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "批次或解析版本已变化", 409, batch.current_version);
  if (!Number.isInteger(context.startRow) || context.startRow < 1 || !Number.isInteger(context.rowLimit) || context.rowLimit < 1 || context.rowLimit > 100) throw new MaterialImportParserServiceError("IMPORT_MAPPING_PREVIEW_FAILED", "预览范围无效", 422);
  const validated = await validateDraft(database, context.parseRunId, context.draft);
  const rows = (await database.prepare("SELECT row_number,raw_values_json FROM material_import_rows WHERE parse_run_id=? AND sheet_index=? AND row_number>=? ORDER BY row_number LIMIT ?").bind(context.parseRunId, context.draft.selected_sheet_index, context.startRow, context.rowLimit).all<{ row_number: number; raw_values_json: string }>()).results ?? [];
  const preview = rows.map((row) => {
    const raw = JSON.parse(row.raw_values_json) as { cells: Array<{ column_index: number; type: string; raw_value: unknown; cached_value?: unknown }> };
    const cells = new Map(raw.cells.map((cell) => [cell.column_index, cell]));
    return { row_number: row.row_number, values: validated.items.filter((item) => item.target_namespace !== "ignore").map((item) => {
      const sourceColumns = item.source_column_indexes?.length ? item.source_column_indexes : item.source_column_index === null ? [] : [item.source_column_index];
      const sourceCells = sourceColumns.map((column) => cells.get(column)).filter((cell) => cell && cell.type !== "EMPTY");
      const empty = sourceCells.length === 0;
      const useDefault = item.mapping_mode === "DEFAULT" || (item.mapping_mode === "SOURCE_WITH_DEFAULT" && empty);
      const issues = sourceCells.some((source) => source?.type === "FORMULA") ? [{ code: "UNTRUSTED_FORMULA_CACHE", message: "公式未执行，缓存值不可信" }] : [];
      const rawValues = sourceCells.map((source) => source?.raw_value).filter((value) => value !== null && value !== undefined && String(value).trim());
      let candidate: unknown = rawValues[0] ?? null;
      if ((item.combination_strategy ?? "FIRST_NON_EMPTY") === "JOIN_NON_EMPTY") candidate = [...new Set(rawValues.map(String))].join(item.combination_separator ?? " ");
      if ((item.combination_strategy ?? "FIRST_NON_EMPTY") === "SPECIFICATION_EXTRACT") {
        const extracted = extractSpecificationCandidate({ componentValues: rawValues.map(String) });
        candidate = extracted.value;
        if (extracted.reviewStatus === "NEEDS_REVIEW") issues.push({ code: "SPECIFICATION_REVIEW_REQUIRED", message: "规格为确定性提取候选，必须人工确认" });
      }
      return { target_namespace: item.target_namespace, target_code: item.target_code, source_column_index: item.source_column_index, source_column_indexes: sourceColumns, status: issues.length ? "WARNING" : "OK", raw_value: rawValues, candidate_value: useDefault ? item.default_value_json ?? null : candidate, issues };
    }) };
  });
  return completeWrite(database, context, "POST", claim, { status: 200, payload: { batch_id: batchId, parse_run_id: context.parseRunId, sampled_row_count: preview.length, rows: preview } }, clock);
}

export async function confirmMaterialImportMapping(database: MaterialMasterD1Database, batchId: number, context: WriteContext & Readonly<{ expectedVersion: number; parseRunId: number; mappingId: number; expectedMappingVersion: number; metadataDigest: string }>, clock: () => Date = () => new Date()): Promise<MaterialImportParserServiceResult> {
  const claim = await claimWrite(database, batchId, context, "POST", "mapping-confirm", { expected_version: context.expectedVersion, parse_run_id: context.parseRunId, mapping_id: context.mappingId, expected_mapping_version: context.expectedMappingVersion, metadata_digest: context.metadataDigest }, clock); if (claim.replay) return claim.replay;
  const batch = await batchVisible(database, batchId, context);
  if (batch.status !== "AWAITING_MAPPING" || batch.current_parse_run_id !== context.parseRunId || batch.current_version !== context.expectedVersion) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "批次或解析版本已变化", 409, batch.current_version);
  const mapping = await database.prepare("SELECT * FROM material_import_mappings WHERE id=? AND batch_id=? AND parse_run_id=?").bind(context.mappingId, batchId, context.parseRunId).first<MappingRow>();
  if (!mapping) throw new MaterialImportParserServiceError("IMPORT_MAPPING_NOT_FOUND", "Mapping 不存在", 404);
  if (mapping.mapping_status !== "DRAFT" || mapping.mapping_version !== context.expectedMappingVersion) throw new MaterialImportParserServiceError("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping 版本已变化或不可确认", 409, mapping.mapping_version);
  const metadata = await new MaterialImportMappingMetadataSnapshotService(database).current();
  if (metadata.metadataDigest !== context.metadataDigest || mapping.metadata_digest !== context.metadataDigest) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_INVALID", "目标元数据已变化，请重新保存 Mapping", 422);
  const items = await mappingItems(database, mapping.id);
  const mapped = new Set(items.map((item) => `${item.target_namespace}\u0000${item.target_code}`));
  if (requiredMappingTargets(metadata).some((target) => !mapped.has(`${target.target_namespace}\u0000${target.target_code}`))) throw new MaterialImportParserServiceError("IMPORT_MAPPING_INVALID", "确认前必须映射标准名称和单位", 422);
  await validateDraft(database, context.parseRunId, { selected_sheet_index: mapping.selected_sheet_index, header_mode: mapping.header_mode, header_row_number: mapping.header_row_number, items: items.map((item) => ({ source_column_index: item.source_column_index, source_column_indexes: item.source_column_indexes_json ? JSON.parse(item.source_column_indexes_json) : undefined, source_header: item.source_header, source_headers: item.source_headers_json ? JSON.parse(item.source_headers_json) : undefined, target_namespace: item.target_namespace as MaterialImportMappingItemInput["target_namespace"], target_code: item.target_code, mapping_mode: item.mapping_mode as MaterialImportMappingItemInput["mapping_mode"], default_value_json: item.default_value_json === null ? undefined : JSON.parse(item.default_value_json), required: item.required === 1, display_order: item.display_order, combination_strategy: item.combination_strategy, combination_separator: item.combination_separator, mapping_confidence: item.mapping_confidence, adaptive_mapping_status: item.adaptive_mapping_status as MaterialImportMappingItemInput["adaptive_mapping_status"] | undefined, mapping_evidence: item.mapping_evidence_json ? JSON.parse(item.mapping_evidence_json) : undefined })) }, metadata);
  const timestamp = clock().toISOString();
  const result: MaterialImportParserServiceResult = { status: 200, payload: { batch_id: batchId, batch_status: "MAPPING_CONFIRMED", current_version: batch.current_version + 1, parse_run_id: context.parseRunId, mapping_id: mapping.id, mapping_status: "CONFIRMED", mapping_version: mapping.mapping_version } };
  const statements: MaterialMasterD1Statement[] = [
    database.prepare("UPDATE material_import_mappings SET mapping_status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_by=?,updated_at=? WHERE id=? AND mapping_status='DRAFT' AND mapping_version=?").bind(context.username, timestamp, context.username, timestamp, mapping.id, mapping.mapping_version),
    database.prepare("UPDATE material_import_batches SET status='MAPPING_CONFIRMED',current_version=current_version+1,updated_at=? WHERE id=? AND status='AWAITING_MAPPING' AND current_parse_run_id=? AND current_version=?").bind(timestamp, batchId, context.parseRunId, context.expectedVersion),
    database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,'MAPPING_CONFIRMED','USER',?,'AWAITING_MAPPING','MAPPING_CONFIRMED',?,json_object('mapping_id',?,'mapping_version',?),?)").bind(batchId, context.username, context.requestId, mapping.id, mapping.mapping_version, timestamp),
    database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES(?,'MATERIAL_IMPORT_MAPPING_CONFIRMED',?,?,'success','MATERIAL_IMPORT_MAPPING',?,?)").bind(context.username, String(mapping.id), context.requestId, Math.floor(clock().getTime() / 1000) + 1_095 * 86_400, timestamp),
    database.prepare("UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=?,response_json=?,updated_at=?,expires_at=? WHERE username=? AND method='POST' AND route_scope=? AND key_digest=? AND request_digest=? AND state='PENDING'").bind(result.status, JSON.stringify(result.payload), timestamp, Math.floor(clock().getTime() / 1000) + 86_400, context.username, claim.route, claim.keyDigest, claim.requestDigest),
  ];
  if (await adaptiveSchemaAvailable(database)) {
    statements.splice(1, 0,
      database.prepare("UPDATE material_import_mapping_items SET adaptive_mapping_status='CONFIRMED' WHERE mapping_id=? AND adaptive_mapping_status IN ('EXACT','HIGH_CONFIDENCE','SUGGESTED')").bind(mapping.id),
      database.prepare("UPDATE material_import_mappings SET structure_status='CONFIRMED' WHERE id=? AND structure_status IN ('HIGH_CONFIDENCE','NEEDS_REVIEW')").bind(mapping.id),
    );
  }
  await database.batch(statements);
  return result;
}
