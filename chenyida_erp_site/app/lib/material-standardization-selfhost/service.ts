import type { Pool, PoolClient } from "pg";
import type { MappingActor } from "../material-import-selfhost/types.ts";
import { standardizationFailure } from "./errors.ts";
import { createMaterialStandardizationCsv, standardizeMaterialRows } from "./rules.ts";
import type {
  MaterialStandardizationMappingItem,
  MaterialStandardizationProjection,
  MaterialStandardizationSourceField,
  MaterialStandardizationSourceRow,
} from "./types.ts";

const IMPORT_READ_ANY = "material.import.read_any";
const MAX_STANDARDIZATION_SOURCE_ROWS = 5_000;
const MAX_STANDARDIZATION_SOURCE_BYTES = 32 * 1024 * 1024;
const READABLE_STATUSES = new Set(["AWAITING_MAPPING", "MAPPING_CONFIRMED", "QUEUED_FOR_NORMALIZATION", "NORMALIZING", "NORMALIZED"]);

type BatchContext = Readonly<{
  batchId: number;
  batchNo: string;
  batchStatus: string;
  parseRunId: number;
  filename: string;
  sheetIndex: number;
  sheetName: string;
  dataStartRow: number;
  mappingStatus: string;
  sourceFields: readonly MaterialStandardizationSourceField[];
  mappingItems: readonly MaterialStandardizationMappingItem[];
}>;
type Queryable = Pick<Pool | PoolClient, "query">;

function allowed(actor: MappingActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function numberValue(value: unknown): number {
  return Number(value);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function arrayValue(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sourceFields(value: unknown): readonly MaterialStandardizationSourceField[] {
  return Object.freeze(arrayValue(value).flatMap((candidate) => {
    const item = objectValue(candidate);
    const columnIndex = Number(item?.column_index);
    if (!item || !Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex > 255) return [];
    return [Object.freeze({
      column_index: columnIndex,
      source_header: String(item.source_header ?? ""),
      normalized_header: item.normalized_header == null ? undefined : String(item.normalized_header),
    })];
  }).sort((left, right) => left.column_index - right.column_index));
}

function mappingItems(rows: readonly Record<string, unknown>[]): readonly MaterialStandardizationMappingItem[] {
  return Object.freeze(rows.map((row) => Object.freeze({
    source_column_index: row.source_column_index == null ? null : numberValue(row.source_column_index),
    source_column_indexes: Object.freeze(arrayValue(row.source_column_indexes).map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 255)),
    target_namespace: String(row.target_namespace ?? ""),
    target_code: String(row.target_code ?? ""),
    mapping_mode: String(row.mapping_mode ?? "SOURCE"),
    default_value_json: row.default_value,
    combination_strategy: row.combination_strategy == null ? undefined : String(row.combination_strategy),
    combination_separator: row.combination_separator == null ? undefined : String(row.combination_separator),
  })));
}

function sourceRows(rows: readonly Record<string, unknown>[]): readonly MaterialStandardizationSourceRow[] {
  return Object.freeze(rows.map((row) => Object.freeze({
    rowNumber: numberValue(row.row_number),
    raw: objectValue(row.raw_values) ?? {},
  })));
}

export class MaterialStandardizationService {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async preview(batchId: number, actor: MappingActor, input: Readonly<{ page: number; pageSize: 20 | 50 }>): Promise<Record<string, unknown>> {
    const { context, projection } = await this.#projection(batchId, actor);
    const offset = (input.page - 1) * input.pageSize;
    const rows = projection.rows.slice(offset, offset + input.pageSize);
    return {
      batch_id: context.batchId,
      batch_no: context.batchNo,
      batch_status: context.batchStatus,
      ...projection,
      rows,
      pagination: {
        page: input.page,
        page_size: input.pageSize,
        total_rows: projection.rows.length,
        total_pages: Math.max(1, Math.ceil(projection.rows.length / input.pageSize)),
      },
    };
  }

  async exportCsv(batchId: number, actor: MappingActor, requestId: string): Promise<Readonly<{ filename: string; csv: string; rowCount: number }>> {
    const { context, projection } = await this.#projection(batchId, actor);
    await this.#pool.query(`
      insert into audit_log(username,action,detail,request_id,result,route_code,retention_until)
      values($1,'IMPORT_STANDARDIZATION_CSV_EXPORTED',$2,$3,'success','IMPORT_STANDARDIZATION_EXPORT',now()+interval '1095 days')
    `, [actor.username, { batch_id: batchId, standard_version: projection.standard_version, row_count: projection.rows.length }, requestId]);
    return {
      filename: `material-standardization-${context.batchNo || batchId}.csv`,
      csv: createMaterialStandardizationCsv(projection),
      rowCount: projection.rows.length,
    };
  }

  async #context(client: Queryable, batchId: number, actor: MappingActor): Promise<BatchContext> {
    const batchResult = await client.query(`
      select b.*,f.original_filename
      from material_import_batches b
      left join lateral (
        select original_filename from material_import_files where batch_id=b.id order by id limit 1
      ) f on true
      where b.id=$1
    `, [batchId]);
    const batch = batchResult.rows[0] as Record<string, unknown> | undefined;
    if (!batch || (!allowed(actor, IMPORT_READ_ANY) && String(batch.created_by) !== actor.username)) standardizationFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在或无权查看", 404);
    if (!READABLE_STATUSES.has(String(batch.status))) standardizationFailure("STANDARDIZATION_PARSE_NOT_READY", "解析和字段结构准备完成后才能查看标准整理结果", 409);
    const parseRunId = numberValue(batch.current_parse_run_id);
    if (!Number.isSafeInteger(parseRunId) || parseRunId < 1) standardizationFailure("STANDARDIZATION_PARSE_NOT_READY", "当前批次没有已发布的解析结果", 409);

    const mappingResult = await client.query(`
      select * from material_import_mappings
      where batch_id=$1 and parse_run_id=$2 and status in ('DRAFT','CONFIRMED')
      order by case status when 'DRAFT' then 0 else 1 end,mapping_version desc,id desc limit 1
    `, [batchId, parseRunId]);
    const mapping = mappingResult.rows[0] as Record<string, unknown> | undefined;
    if (!mapping) standardizationFailure("STANDARDIZATION_MAPPING_NOT_READY", "当前解析结果尚未生成可用的字段结构", 409);
    const sheetIndex = numberValue(mapping.selected_sheet_index);
    const sheetResult = await client.query(`
      select sheet_name,row_count,source_column_max from material_import_parse_sheets
      where parse_run_id=$1 and sheet_index=$2 and visibility='VISIBLE' and parse_status='COMPLETED'
    `, [parseRunId, sheetIndex]);
    const sheet = sheetResult.rows[0] as Record<string, unknown> | undefined;
    if (!sheet) standardizationFailure("STANDARDIZATION_SHEET_NOT_AVAILABLE", "字段 Mapping 指向的来源 Sheet 不可用于标准整理", 409);
    const itemResult = await client.query("select * from material_import_mapping_items where mapping_id=$1 order by display_order,id", [numberValue(mapping.id)]);
    const headerEnd = mapping.header_end_row_number ?? mapping.header_row_number;
    const dataStartRow = Math.max(1, numberValue(mapping.data_start_row_number ?? (headerEnd == null ? 1 : numberValue(headerEnd) + 1)));
    return Object.freeze({
      batchId,
      batchNo: String(batch.batch_no ?? batchId),
      batchStatus: String(batch.status),
      parseRunId,
      filename: String(batch.original_filename ?? "未命名来源"),
      sheetIndex,
      sheetName: String(sheet.sheet_name ?? mapping.selected_sheet_name ?? ""),
      dataStartRow,
      mappingStatus: String(mapping.status),
      sourceFields: sourceFields(mapping.source_fields),
      mappingItems: mappingItems(itemResult.rows as Record<string, unknown>[]),
    });
  }

  async #projection(batchId: number, actor: MappingActor): Promise<Readonly<{ context: BatchContext; projection: MaterialStandardizationProjection }>> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin transaction isolation level repeatable read read only");
      const context = await this.#context(client, batchId, actor);
      const countResult = await client.query(`
        select count(*)::int count,coalesce(sum(octet_length(raw_values::text)),0)::bigint source_bytes from material_import_rows
        where batch_id=$1 and parse_run_id=$2 and sheet_index=$3 and row_number>=$4
      `, [batchId, context.parseRunId, context.sheetIndex, context.dataStartRow]);
      const count = numberValue(countResult.rows[0]?.count ?? 0);
      if (count > MAX_STANDARDIZATION_SOURCE_ROWS) standardizationFailure("STANDARDIZATION_ROW_LIMIT_EXCEEDED", `标准整理一次最多处理 ${MAX_STANDARDIZATION_SOURCE_ROWS} 个候选来源行`, 413);
      if (numberValue(countResult.rows[0]?.source_bytes ?? 0) > MAX_STANDARDIZATION_SOURCE_BYTES) standardizationFailure("STANDARDIZATION_SOURCE_SIZE_LIMIT_EXCEEDED", "标准整理候选来源正文超过 32 MiB，请拆分文件后重试", 413);
      const preludeResult = await client.query(`
        select row_number,raw_values from material_import_rows
        where batch_id=$1 and parse_run_id=$2 and sheet_index=$3 and row_number<$4
        order by row_number desc limit 50
      `, [batchId, context.parseRunId, context.sheetIndex, context.dataStartRow]);
      const rowResult = await client.query(`
        select row_number,raw_values from material_import_rows
        where batch_id=$1 and parse_run_id=$2 and sheet_index=$3 and row_number>=$4
        order by row_number limit $5
      `, [batchId, context.parseRunId, context.sheetIndex, context.dataStartRow, MAX_STANDARDIZATION_SOURCE_ROWS + 1]);
      const projection = standardizeMaterialRows({
        filename: context.filename,
        sheetName: context.sheetName,
        sheetIndex: context.sheetIndex,
        parseRunId: context.parseRunId,
        mappingStatus: context.mappingStatus,
        sourceFields: context.sourceFields,
        mappingItems: context.mappingItems,
        preludeRows: sourceRows([...(preludeResult.rows as Record<string, unknown>[])].reverse()),
        rows: sourceRows(rowResult.rows as Record<string, unknown>[]),
      });
      await client.query("commit");
      return Object.freeze({ context, projection });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
