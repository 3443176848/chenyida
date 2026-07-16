import type { MaterialMasterD1Database, MaterialMasterD1Statement } from "../material-master/index.ts";
import { parseMaterialImportCsv } from "./csv-parser.ts";
import type { MaterialImportObjectStore } from "./object-store.ts";
import {
  MATERIAL_IMPORT_PARSER_VERSION,
  MaterialImportParserError,
  type MaterialImportParsedRow,
} from "./parser-model.ts";
import type { MaterialImportTask, MaterialImportTaskDisposition, MaterialImportTaskHandler } from "./task-scheduler.ts";
import { parseMaterialImportXlsx, type MaterialImportSharedStringStore, type MaterialImportXlsxSheet } from "./xlsx-parser.ts";
import { MaterialImportMappingMetadataSnapshotService } from "./mapping-target-registry.ts";

const LEASE_SECONDS = 120;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const IDEMPOTENCY_RECOVERY_SECONDS = 604_800;
const RAW_RETENTION_DAYS = 30;
const RECORD_RETENTION_DAYS = 1_095;

type ParserBatchRow = { id: number; status: string; source_kind: "CSV" | "XLSX"; created_by: string; current_version: number; current_parse_run_id: number | null };
type ParserRunRow = { id: number; batch_id: number; run_status: string; attempt_no: number; lease_token_digest: string | null; lease_expires_at: number | null; mapping_preparation_status: string; parser_version: string };
type ParserFileRow = { object_key: string; detected_file_type: "CSV" | "XLSX"; actual_sha256: string };

export type QueueMaterialImportParseInput = Readonly<{
  batchId: number;
  username: string;
  canReadAny: boolean;
  expectedVersion: number;
  parserVersion: string;
  idempotencyKey: string;
  requestId: string;
}>;

export type MaterialImportParserServiceResult = Readonly<{ status: number; payload: Record<string, unknown>; replayed?: boolean }>;

export class MaterialImportParserServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expectedVersion?: number;
  constructor(code: string, message: string, status: number, expectedVersion?: number) { super(message); this.code = code; this.status = status; this.expectedVersion = expectedVersion; }
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new MaterialImportParserServiceError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 必须为 8 到 200 个安全字符", 400);
}

function visibleBatch(row: ParserBatchRow | null, username: string, canReadAny: boolean): ParserBatchRow {
  if (!row || (!canReadAny && row.created_by !== username)) throw new MaterialImportParserServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return row;
}

export async function queueMaterialImportParse(database: MaterialMasterD1Database, input: QueueMaterialImportParseInput, clock: () => Date = () => new Date()): Promise<MaterialImportParserServiceResult> {
  assertIdempotencyKey(input.idempotencyKey);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new MaterialImportParserServiceError("IMPORT_PARSE_VERSION_CONFLICT", "批次版本无效", 409);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(input.parserVersion) || input.parserVersion !== MATERIAL_IMPORT_PARSER_VERSION) throw new MaterialImportParserServiceError("IMPORT_PARSE_NOT_ALLOWED", "Parser 版本不受支持", 409);
  const keyDigest = await sha256Text(input.idempotencyKey);
  const requestDigest = await sha256Text(JSON.stringify({ batch_id: input.batchId, expected_version: input.expectedVersion, parser_version: input.parserVersion }));
  const routeScope = `material-import:${input.batchId}:parse`;
  const previous = await database.prepare("SELECT request_digest,state,status_code,response_json FROM material_import_idempotency WHERE username=? AND method='POST' AND route_scope=? AND key_digest=?").bind(input.username, routeScope, keyDigest).first<{ request_digest: string; state: string; status_code: number | null; response_json: string | null }>();
  if (previous) {
    if (previous.request_digest !== requestDigest) throw new MaterialImportParserServiceError("IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求", 409);
    if (previous.state === "COMPLETED" && previous.response_json && previous.status_code) return { status: previous.status_code, payload: JSON.parse(previous.response_json) as Record<string, unknown>, replayed: true };
    throw new MaterialImportParserServiceError("IMPORT_PARSE_ALREADY_RUNNING", "解析请求正在处理", 409);
  }
  const batch = visibleBatch(await database.prepare("SELECT id,status,source_kind,created_by,current_version,current_parse_run_id FROM material_import_batches WHERE id=?").bind(input.batchId).first<ParserBatchRow>(), input.username, input.canReadAny);
  if (batch.current_version !== input.expectedVersion) throw new MaterialImportParserServiceError("IMPORT_PARSE_VERSION_CONFLICT", "批次版本已变化", 409, batch.current_version);
  if (batch.status === "QUEUED_FOR_PARSING" || batch.status === "PARSING") throw new MaterialImportParserServiceError("IMPORT_PARSE_ALREADY_RUNNING", "该批次已有解析任务", 409);
  if (batch.status !== "FILE_READY") throw new MaterialImportParserServiceError("IMPORT_PARSE_NOT_ALLOWED", "当前批次状态不允许解析", 409);
  const now = clock();
  const nowText = now.toISOString();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const operationId = crypto.randomUUID();
  const leaseDigest = await sha256Text(crypto.randomUUID());
  const jobId = crypto.randomUUID();
  const statements = [
    database.prepare(`INSERT INTO material_import_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until) VALUES(?,'POST',?,?,?,?, 'PENDING',?,?,?, ?,?,?)`).bind(input.username, routeScope, keyDigest, requestDigest, operationId, input.batchId, leaseDigest, nowSeconds + LEASE_SECONDS, nowText, nowText, nowSeconds + IDEMPOTENCY_RECOVERY_SECONDS),
    database.prepare(`INSERT INTO material_import_parse_runs(batch_id,parser_version,run_status,attempt_no,current_stage,created_at,updated_at) SELECT id,?,'QUEUED',1,'INSPECT_WORKBOOK',?,? FROM material_import_batches WHERE id=? AND status='FILE_READY' AND current_version=?`).bind(input.parserVersion, nowText, nowText, input.batchId, input.expectedVersion),
    database.prepare(`UPDATE material_import_batches SET status='QUEUED_FOR_PARSING',current_version=current_version+1,updated_at=? WHERE id=? AND status='FILE_READY' AND current_version=?`).bind(nowText, input.batchId, input.expectedVersion),
    database.prepare(`INSERT INTO material_import_job_outbox(id,batch_id,parse_run_id,job_type,payload_version,payload_json,dispatch_status,dispatch_version,attempt_count,available_at,created_at) SELECT ?,?,id,'INSPECT_WORKBOOK',1,json_object('parse_run_id',id),'PENDING',1,0,?,? FROM material_import_parse_runs WHERE batch_id=? AND run_status='QUEUED'`).bind(jobId, input.batchId, nowSeconds, nowText, input.batchId),
    database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,'PARSE_QUEUED','USER',?,'FILE_READY','QUEUED_FOR_PARSING',?,json_object('parser_version',?),?)`).bind(input.batchId, input.username, input.requestId, input.parserVersion, nowText),
    database.prepare(`INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES(?,'MATERIAL_IMPORT_PARSE_QUEUED',?,?,'success','MATERIAL_IMPORT_PARSER',?,?)`).bind(input.username, String(input.batchId), input.requestId, nowSeconds + RECORD_RETENTION_DAYS * 86_400, nowText),
    database.prepare(`UPDATE material_import_idempotency SET state='COMPLETED',lease_expires_at=NULL,status_code=202,response_json=json_object('batch_id',?,'batch_status','QUEUED_FOR_PARSING','current_version',?,'parse_run_id',(SELECT id FROM material_import_parse_runs WHERE batch_id=? AND run_status='QUEUED'),'parse_run_status','QUEUED'),updated_at=?,expires_at=? WHERE username=? AND method='POST' AND route_scope=? AND key_digest=? AND request_digest=? AND state='PENDING'`).bind(input.batchId, input.expectedVersion + 1, input.batchId, nowText, nowSeconds + IDEMPOTENCY_TTL_SECONDS, input.username, routeScope, keyDigest, requestDigest),
  ];
  try { await database.batch(statements); } catch {
    const active = await database.prepare("SELECT id FROM material_import_parse_runs WHERE batch_id=? AND run_status IN ('QUEUED','RUNNING','STAGED','PUBLISHING')").bind(input.batchId).first<{ id: number }>();
    if (active) throw new MaterialImportParserServiceError("IMPORT_PARSE_ALREADY_RUNNING", "该批次已有解析任务", 409);
    throw new MaterialImportParserServiceError("INTERNAL_ERROR", "解析请求暂时无法保存", 500);
  }
  const run = await database.prepare("SELECT id FROM material_import_parse_runs WHERE batch_id=? AND run_status='QUEUED'").bind(input.batchId).first<{ id: number }>();
  if (!run) throw new MaterialImportParserServiceError("IMPORT_PARSE_VERSION_CONFLICT", "批次状态已变化", 409);
  const payload = { batch_id: input.batchId, batch_status: "QUEUED_FOR_PARSING", current_version: input.expectedVersion + 1, parse_run_id: run.id, parse_run_status: "QUEUED" };
  return { status: 202, payload };
}

class D1SharedStringStore implements MaterialImportSharedStringStore {
  readonly #database: MaterialMasterD1Database;
  readonly #runId: number;
  readonly #clock: () => Date;
  readonly #cache = new Map<number, Readonly<{ start: number; values: readonly string[]; bytes: number }>>();
  #cacheBytes = 0;
  constructor(database: MaterialMasterD1Database, runId: number, clock: () => Date) { this.#database = database; this.#runId = runId; this.#clock = clock; }
  async appendChunk(startStringIndex: number, values: readonly string[], decodedBytes: number): Promise<void> {
    const chunkIndex = Math.floor(startStringIndex / 512);
    await this.#database.prepare(`INSERT INTO material_import_shared_string_chunks(parse_run_id,chunk_index,start_string_index,item_count,decoded_bytes,values_json,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(parse_run_id,chunk_index) DO UPDATE SET start_string_index=excluded.start_string_index,item_count=excluded.item_count,decoded_bytes=excluded.decoded_bytes,values_json=excluded.values_json`).bind(this.#runId, chunkIndex, startStringIndex, values.length, decodedBytes, JSON.stringify(values), this.#clock().toISOString()).run();
  }
  async get(index: number): Promise<string | null> {
    for (const [key, chunk] of this.#cache) {
      if (index >= chunk.start && index < chunk.start + chunk.values.length) { this.#cache.delete(key); this.#cache.set(key, chunk); return chunk.values[index - chunk.start] ?? null; }
    }
    const row = await this.#database.prepare("SELECT chunk_index,start_string_index,values_json,decoded_bytes FROM material_import_shared_string_chunks WHERE parse_run_id=? AND start_string_index<=? ORDER BY start_string_index DESC LIMIT 1").bind(this.#runId, index).first<{ chunk_index: number; start_string_index: number; values_json: string; decoded_bytes: number }>();
    if (!row) return null;
    const values = JSON.parse(row.values_json) as string[];
    this.#cache.set(row.chunk_index, { start: row.start_string_index, values, bytes: row.decoded_bytes });
    this.#cacheBytes += row.decoded_bytes;
    while (this.#cacheBytes > 8 * 1024 * 1024 && this.#cache.size > 1) { const first = this.#cache.entries().next().value as [number, { bytes: number }] | undefined; if (!first) break; this.#cache.delete(first[0]); this.#cacheBytes -= first[1].bytes; }
    return values[index - row.start_string_index] ?? null;
  }
}

class D1RowWriter {
  readonly #database: MaterialMasterD1Database;
  readonly #batchId: number;
  readonly #runId: number;
  readonly #clock: () => Date;
  readonly #buffer: MaterialImportParsedRow[] = [];
  rowsWritten = 0;
  constructor(database: MaterialMasterD1Database, batchId: number, runId: number, clock: () => Date) { this.#database = database; this.#batchId = batchId; this.#runId = runId; this.#clock = clock; }
  async add(row: MaterialImportParsedRow): Promise<void> { this.#buffer.push(row); if (this.#buffer.length >= 100) await this.flush(); }
  async flush(): Promise<void> {
    if (!this.#buffer.length) return;
    const rows = this.#buffer.splice(0);
    const timestamp = this.#clock().toISOString();
    const statements = rows.map((row) => this.#database.prepare(`INSERT OR IGNORE INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(this.#batchId, this.#runId, row.sheetIndex, row.sheetName, row.rowNumber, row.rawJson, row.rawRowHash, timestamp));
    const results = await this.#database.batch(statements);
    for (let index = 0; index < rows.length; index += 1) {
      if ((results[index]?.meta?.changes ?? 0) === 0) {
        const row = rows[index];
        const existing = await this.#database.prepare("SELECT raw_row_hash FROM material_import_rows WHERE parse_run_id=? AND sheet_index=? AND row_number=?").bind(this.#runId, row.sheetIndex, row.rowNumber).first<{ raw_row_hash: string }>();
        if (existing?.raw_row_hash !== row.rawRowHash) throw new MaterialImportParserError("IMPORT_PARSE_VERSION_CONFLICT", "解析重放与已有原始行不一致");
      }
      this.rowsWritten += 1;
    }
  }
}

export type MaterialImportParserTaskDependencies = Readonly<{
  database: MaterialMasterD1Database;
  objectStore: MaterialImportObjectStore;
  saxWasm?: WebAssembly.Module | Uint8Array;
  clock?: () => Date;
}>;

export class MaterialImportParserTaskHandler implements MaterialImportTaskHandler {
  readonly #database: MaterialMasterD1Database;
  readonly #objectStore: MaterialImportObjectStore;
  readonly #saxWasm?: WebAssembly.Module | Uint8Array;
  readonly #clock: () => Date;
  constructor(dependencies: MaterialImportParserTaskDependencies) { this.#database = dependencies.database; this.#objectStore = dependencies.objectStore; this.#saxWasm = dependencies.saxWasm; this.#clock = dependencies.clock ?? (() => new Date()); }

  async handle(task: MaterialImportTask): Promise<MaterialImportTaskDisposition> {
    if (task.jobType === "PREPARE_MAPPING") return this.#prepareMapping(task);
    if (task.jobType !== "INSPECT_WORKBOOK") return "ACK";
    const leaseToken = crypto.randomUUID();
    const leaseDigest = await sha256Text(leaseToken);
    const nowSeconds = Math.floor(this.#clock().getTime() / 1000);
    const nowText = this.#clock().toISOString();
    const claimed = await this.#database.prepare(`UPDATE material_import_parse_runs SET run_status='RUNNING',lease_token_digest=?,lease_expires_at=?,heartbeat_at=?,started_at=COALESCE(started_at,?),current_stage='INSPECT_WORKBOOK',updated_at=? WHERE id=? AND batch_id=? AND (run_status='QUEUED' OR (run_status='RUNNING' AND lease_expires_at<?))`).bind(leaseDigest, nowSeconds + LEASE_SECONDS, nowText, nowText, nowText, task.parseRunId, task.batchId, nowSeconds).run();
    if ((claimed.meta?.changes ?? 0) !== 1) {
      const run = await this.#database.prepare("SELECT run_status FROM material_import_parse_runs WHERE id=? AND batch_id=?").bind(task.parseRunId, task.batchId).first<{ run_status: string }>();
      return !run || ["SUCCEEDED", "FAILED", "CANCELLED", "SUPERSEDED"].includes(run.run_status) ? "ACK" : "RETRY";
    }
    const batch = await this.#database.prepare("SELECT id,status,source_kind,created_by,current_version,current_parse_run_id FROM material_import_batches WHERE id=?").bind(task.batchId).first<ParserBatchRow>();
    if (!batch || !["QUEUED_FOR_PARSING", "PARSING"].includes(batch.status)) { await this.#releaseAsCancelled(task, leaseDigest); return "ACK"; }
    if (batch.status === "QUEUED_FOR_PARSING") {
      await this.#database.batch([
        this.#database.prepare("UPDATE material_import_batches SET status='PARSING',updated_at=? WHERE id=? AND status='QUEUED_FOR_PARSING'").bind(nowText, task.batchId),
        this.#database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,created_at) VALUES(?,'PARSE_STARTED','SYSTEM','QUEUED_FOR_PARSING','PARSING',?,?)").bind(task.batchId, task.jobId, nowText),
      ]);
    }
    try {
      const file = await this.#database.prepare("SELECT object_key,detected_file_type,actual_sha256 FROM material_import_files WHERE batch_id=? AND storage_status='STORED' AND security_check_status='BASIC_CHECK_PASSED'").bind(task.batchId).first<ParserFileRow>();
      if (!file) throw new MaterialImportParserError("IMPORT_PARSE_FAILED", "解析源文件不可用", true);
      const source = await this.#objectStore.open(file.object_key);
      if (!source) throw new MaterialImportParserError("IMPORT_PARSE_FAILED", "解析源文件不可用", true);
      const writer = new D1RowWriter(this.#database, task.batchId, task.parseRunId, this.#clock);
      const heartbeat = async (rows: number) => {
        const current = Math.floor(this.#clock().getTime() / 1000);
        const result = await this.#database.prepare("UPDATE material_import_parse_runs SET rows_written=?,heartbeat_at=?,lease_expires_at=?,updated_at=? WHERE id=? AND run_status='RUNNING' AND lease_token_digest=?").bind(rows, this.#clock().toISOString(), current + LEASE_SECONDS, this.#clock().toISOString(), task.parseRunId, leaseDigest).run();
        if ((result.meta?.changes ?? 0) !== 1) throw new MaterialImportParserError("IMPORT_PARSE_CANCELLED", "解析租约已失效");
      };
      let sheets: readonly MaterialImportXlsxSheet[];
      let parsedSheetCount: number;
      let normalizedJsonBytes: number;
      let decodedTextBytes: number;
      let warningCount: number;
      if (file.detected_file_type === "CSV") {
        const result = await parseMaterialImportCsv(source, (row) => writer.add(row), { onProgress: heartbeat });
        sheets = [{ sheetIndex: 0, sheetName: "__CSV__", visibility: "VISIBLE", status: "COMPLETED", rowCount: result.rowCount, sourceColumnMax: result.sourceColumnMax, mergedRanges: [], warnings: result.warnings }];
        parsedSheetCount = 1;
        normalizedJsonBytes = result.normalizedJsonBytes;
        decodedTextBytes = result.decodedTextBytes;
        warningCount = result.warnings.length;
      } else {
        if (!this.#saxWasm) throw new MaterialImportParserError("IMPORT_PARSE_FAILED", "XLSX XML 解析模块不可用", true);
        const result = await parseMaterialImportXlsx(source, this.#saxWasm, new D1SharedStringStore(this.#database, task.parseRunId, this.#clock), (row) => writer.add(row), { onProgress: heartbeat });
        sheets = result.sheets;
        parsedSheetCount = result.parsedSheetCount;
        normalizedJsonBytes = result.normalizedJsonBytes;
        decodedTextBytes = result.decodedTextBytes;
        warningCount = result.warnings.length;
      }
      await writer.flush();
      const sheetStatements = sheets.map((sheet) => this.#database.prepare(`INSERT INTO material_import_parse_sheets(parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,merged_ranges_json,warning_count,safe_warnings_json,started_at,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(parse_run_id,sheet_index) DO UPDATE SET sheet_name=excluded.sheet_name,visibility=excluded.visibility,parse_status=excluded.parse_status,row_count=excluded.row_count,source_column_max=excluded.source_column_max,merged_ranges_json=excluded.merged_ranges_json,warning_count=excluded.warning_count,safe_warnings_json=excluded.safe_warnings_json,completed_at=excluded.completed_at,updated_at=excluded.updated_at`).bind(task.parseRunId, sheet.sheetIndex, sheet.sheetName, sheet.visibility, sheet.status, sheet.rowCount, sheet.sourceColumnMax, JSON.stringify(sheet.mergedRanges), sheet.warnings.length, JSON.stringify(sheet.warnings.slice(0, 100)), nowText, this.#clock().toISOString(), nowText, this.#clock().toISOString()));
      if (sheetStatements.length) await this.#database.batch(sheetStatements);
      const staged = await this.#database.prepare(`UPDATE material_import_parse_runs SET run_status='STAGED',current_stage='VERIFY_PARSE_RUN',rows_written=?,parsed_sheet_count=?,normalized_json_bytes=?,decoded_text_bytes=?,warning_count=?,source_file_sha256=?,updated_at=? WHERE id=? AND run_status='RUNNING' AND lease_token_digest=?`).bind(writer.rowsWritten, parsedSheetCount, normalizedJsonBytes, decodedTextBytes, warningCount, file.actual_sha256, this.#clock().toISOString(), task.parseRunId, leaseDigest).run();
      if ((staged.meta?.changes ?? 0) !== 1) throw new MaterialImportParserError("IMPORT_PARSE_CANCELLED", "解析租约已失效");
      await this.#publish(task, batch.current_version, leaseDigest, writer.rowsWritten);
      return "ACK";
    } catch (error) {
      const failure = error instanceof MaterialImportParserError ? error : new MaterialImportParserError("IMPORT_PARSE_FAILED", "解析任务失败", true);
      const run = await this.#database.prepare("SELECT attempt_no FROM material_import_parse_runs WHERE id=?").bind(task.parseRunId).first<{ attempt_no: number }>();
      if (failure.retryable && (run?.attempt_no ?? 1) < 3) {
        await this.#database.prepare("UPDATE material_import_parse_runs SET run_status='QUEUED',lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,attempt_no=attempt_no+1,updated_at=? WHERE id=? AND lease_token_digest=?").bind(this.#clock().toISOString(), task.parseRunId, leaseDigest).run();
        return "RETRY";
      }
      await this.#fail(task, leaseDigest, failure);
      return "ACK";
    }
  }

  async #publish(task: MaterialImportTask, expectedVersion: number, leaseDigest: string, rows: number): Promise<void> {
    const timestamp = this.#clock().toISOString();
    const nowSeconds = Math.floor(this.#clock().getTime() / 1000);
    const mappingJobId = crypto.randomUUID();
    await this.#database.batch([
      this.#database.prepare(`INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details_json,created_at) VALUES((SELECT CASE WHEN p.run_status='STAGED' AND p.lease_token_digest=? AND p.lease_expires_at>? AND b.status='PARSING' AND b.current_version=? THEN b.id ELSE NULL END FROM material_import_parse_runs p JOIN material_import_batches b ON b.id=p.batch_id WHERE p.id=?),'PARSE_PUBLISHED','SYSTEM','PARSING','PARSED',?,json_object('parse_run_id',?,'parsed_row_count',?),?)`).bind(leaseDigest, nowSeconds, expectedVersion, task.parseRunId, task.jobId, task.parseRunId, rows, timestamp),
      this.#database.prepare("UPDATE material_import_mappings SET mapping_status='STALE',updated_at=? WHERE batch_id=? AND parse_run_id<>? AND mapping_status='DRAFT'").bind(timestamp, task.batchId, task.parseRunId),
      this.#database.prepare("UPDATE material_import_parse_runs SET run_status='SUPERSEDED',updated_at=? WHERE batch_id=? AND id<>? AND run_status='SUCCEEDED'").bind(timestamp, task.batchId, task.parseRunId),
      this.#database.prepare("UPDATE material_import_parse_runs SET run_status='SUCCEEDED',current_stage='COMPLETE',completed_at=?,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,mapping_preparation_status='QUEUED',mapping_preparation_updated_at=?,updated_at=? WHERE id=? AND run_status='STAGED' AND lease_token_digest=?").bind(timestamp, timestamp, timestamp, task.parseRunId, leaseDigest),
      this.#database.prepare("UPDATE material_import_batches SET current_parse_run_id=?,status='PARSED',current_version=current_version+1,total_rows=?,updated_at=? WHERE id=? AND status='PARSING' AND current_version=?").bind(task.parseRunId, rows, timestamp, task.batchId, expectedVersion),
      this.#database.prepare(`INSERT INTO material_import_job_outbox(id,batch_id,parse_run_id,job_type,payload_version,payload_json,dispatch_status,dispatch_version,attempt_count,available_at,created_at) VALUES(?,?,?,'PREPARE_MAPPING',1,json_object('parse_run_id',?),'PENDING',1,0,?,?)`).bind(mappingJobId, task.batchId, task.parseRunId, task.parseRunId, nowSeconds, timestamp),
      this.#database.prepare(`INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES('system','MATERIAL_IMPORT_PARSE_PUBLISHED',?,?,'success','MATERIAL_IMPORT_PARSER',?,?)`).bind(String(task.batchId), task.jobId, nowSeconds + RECORD_RETENTION_DAYS * 86_400, timestamp),
    ]);
  }

  async #prepareMapping(task: MaterialImportTask): Promise<MaterialImportTaskDisposition> {
    const batch = await this.#database.prepare("SELECT id,status,source_kind,created_by,current_version,current_parse_run_id FROM material_import_batches WHERE id=?").bind(task.batchId).first<ParserBatchRow>();
    const run = await this.#database.prepare("SELECT id,batch_id,run_status,attempt_no,lease_token_digest,lease_expires_at,mapping_preparation_status,parser_version FROM material_import_parse_runs WHERE id=?").bind(task.parseRunId).first<ParserRunRow>();
    if (!batch || !run || batch.current_parse_run_id !== task.parseRunId || !["PARSED", "AWAITING_MAPPING"].includes(batch.status)) return "ACK";
    if (run.mapping_preparation_status === "READY") return "ACK";
    const timestamp = this.#clock().toISOString();
    const claim = await this.#database.prepare("UPDATE material_import_parse_runs SET mapping_preparation_status='RUNNING',mapping_preparation_attempt_count=mapping_preparation_attempt_count+1,mapping_preparation_failure_code=NULL,mapping_preparation_safe_message=NULL,mapping_preparation_updated_at=?,current_stage='PREPARE_MAPPING',updated_at=? WHERE id=? AND mapping_preparation_status IN ('NOT_STARTED','QUEUED','FAILED')").bind(timestamp, timestamp, task.parseRunId).run();
    if ((claim.meta?.changes ?? 0) !== 1) return "RETRY";
    try {
      const sheet = await this.#database.prepare("SELECT sheet_index,row_count,source_column_max FROM material_import_parse_sheets WHERE parse_run_id=? AND visibility='VISIBLE' AND parse_status='COMPLETED' ORDER BY CASE WHEN row_count>0 THEN 0 ELSE 1 END,sheet_index LIMIT 1").bind(task.parseRunId).first<{ sheet_index: number; row_count: number; source_column_max: number }>();
      if (!sheet) throw new MaterialImportParserError("IMPORT_MAPPING_PREPARATION_FAILED", "没有可用于 Mapping 的可见 Sheet");
      const sample = (await this.#database.prepare("SELECT row_number,raw_values_json FROM material_import_rows WHERE parse_run_id=? AND sheet_index=? ORDER BY row_number LIMIT 10").bind(task.parseRunId, sheet.sheet_index).all<{ row_number: number; raw_values_json: string }>()).results ?? [];
      const candidates = sample.map((row) => {
        const raw = JSON.parse(row.raw_values_json) as { cells?: Array<{ type?: string; raw_value?: unknown }> };
        const cells = raw.cells ?? [];
        const nonEmpty = cells.filter((cell) => cell.type !== "EMPTY" && String(cell.raw_value ?? "").trim()).length;
        const unique = new Set(cells.map((cell) => String(cell.raw_value ?? "").trim()).filter(Boolean)).size;
        const score = cells.length ? Math.min(1, (nonEmpty / cells.length) * 0.7 + (unique / Math.max(1, nonEmpty)) * 0.3) : 0;
        return { rowNumber: row.row_number, score };
      }).filter((candidate) => candidate.score > 0).sort((left, right) => right.score - left.score).slice(0, 3);
      const metadataDigest = (await new MaterialImportMappingMetadataSnapshotService(this.#database).current()).metadataDigest;
      const header = candidates[0]?.rowNumber ?? null;
      const statements: MaterialMasterD1Statement[] = [this.#database.prepare("DELETE FROM material_import_header_suggestions WHERE parse_run_id=?").bind(task.parseRunId)];
      candidates.forEach((candidate, index) => statements.push(this.#database.prepare("INSERT INTO material_import_header_suggestions(parse_run_id,sheet_index,row_number,rank,score,reason_codes_json,algorithm_version,metadata_digest,created_at) VALUES(?,?,?,?,?,'[\"NON_EMPTY_UNIQUE_ROW\"]','header-v1',?,?)").bind(task.parseRunId, sheet.sheet_index, candidate.rowNumber, index + 1, candidate.score, metadataDigest, timestamp)));
      statements.push(
        this.#database.prepare(`INSERT INTO material_import_mappings(batch_id,parse_run_id,selected_sheet_index,header_mode,header_row_number,mapping_status,mapping_version,metadata_digest,suggestion_algorithm_version,created_by,updated_by,created_at,updated_at) SELECT ?,?,?,?,?,'DRAFT',1,?,'header-v1',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM material_import_mappings WHERE parse_run_id=? AND mapping_status<>'SUPERSEDED')`).bind(task.batchId, task.parseRunId, sheet.sheet_index, header ? "SINGLE_ROW" : "NO_HEADER", header, metadataDigest, batch.created_by, batch.created_by, timestamp, timestamp, task.parseRunId),
        this.#database.prepare("UPDATE material_import_parse_runs SET mapping_preparation_status='READY',mapping_preparation_updated_at=?,current_stage='COMPLETE',updated_at=? WHERE id=? AND mapping_preparation_status='RUNNING'").bind(timestamp, timestamp, task.parseRunId),
        this.#database.prepare("UPDATE material_import_batches SET status='AWAITING_MAPPING',current_version=current_version+1,updated_at=? WHERE id=? AND status='PARSED' AND current_parse_run_id=? AND current_version=?").bind(timestamp, task.batchId, task.parseRunId, batch.current_version),
        this.#database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,'MAPPING_PREPARATION_READY','SYSTEM','PARSED','AWAITING_MAPPING',?,json_object('parse_run_id',?,'sheet_index',?),?)").bind(task.batchId, task.jobId, task.parseRunId, sheet.sheet_index, timestamp),
      );
      await this.#database.batch(statements);
      return "ACK";
    } catch {
      await this.#database.batch([
        this.#database.prepare("UPDATE material_import_parse_runs SET mapping_preparation_status='FAILED',mapping_preparation_failure_code='IMPORT_MAPPING_PREPARATION_FAILED',mapping_preparation_safe_message='Mapping 准备失败，可单独重试',mapping_preparation_updated_at=?,updated_at=? WHERE id=? AND mapping_preparation_status='RUNNING'").bind(timestamp, timestamp, task.parseRunId),
        this.#database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,request_id,safe_details_json,created_at) VALUES(?,'MAPPING_PREPARATION_FAILED','SYSTEM',?,json_object('parse_run_id',?),?)").bind(task.batchId, task.jobId, task.parseRunId, timestamp),
      ]);
      return "ACK";
    }
  }

  async #releaseAsCancelled(task: MaterialImportTask, leaseDigest: string): Promise<void> { await this.#database.prepare("UPDATE material_import_parse_runs SET run_status='CANCELLED',completed_at=?,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND lease_token_digest=?").bind(this.#clock().toISOString(), this.#clock().toISOString(), task.parseRunId, leaseDigest).run(); }

  async #fail(task: MaterialImportTask, leaseDigest: string, error: MaterialImportParserError): Promise<void> {
    const timestamp = this.#clock().toISOString();
    const terminal = new Date(timestamp);
    const rawRetention = new Date(terminal); rawRetention.setUTCDate(rawRetention.getUTCDate() + RAW_RETENTION_DAYS);
    const recordRetention = new Date(terminal); recordRetention.setUTCDate(recordRetention.getUTCDate() + RECORD_RETENTION_DAYS);
    await this.#database.batch([
      this.#database.prepare("DELETE FROM material_import_rows WHERE parse_run_id=? AND NOT EXISTS(SELECT 1 FROM material_import_batches WHERE current_parse_run_id=?)").bind(task.parseRunId, task.parseRunId),
      this.#database.prepare("DELETE FROM material_import_parse_sheets WHERE parse_run_id=? AND NOT EXISTS(SELECT 1 FROM material_import_batches WHERE current_parse_run_id=?)").bind(task.parseRunId, task.parseRunId),
      this.#database.prepare("DELETE FROM material_import_shared_string_chunks WHERE parse_run_id=? AND NOT EXISTS(SELECT 1 FROM material_import_batches WHERE current_parse_run_id=?)").bind(task.parseRunId, task.parseRunId),
      this.#database.prepare("UPDATE material_import_parse_runs SET run_status=?,failure_code=?,safe_failure_message=?,completed_at=?,lease_token_digest=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE id=? AND lease_token_digest=?").bind(error.code === "IMPORT_PARSE_CANCELLED" ? "CANCELLED" : "FAILED", error.code, error.message.slice(0, 500), timestamp, timestamp, task.parseRunId, leaseDigest),
      this.#database.prepare("UPDATE material_import_batches SET status='FAILED',failure_stage='PARSER',failure_code=?,failure_message=?,terminal_at=?,raw_data_retention_until=?,record_retention_until=?,updated_at=? WHERE id=? AND status='PARSING'").bind(error.code, error.message.slice(0, 500), timestamp, rawRetention.toISOString(), recordRetention.toISOString(), timestamp, task.batchId),
      this.#database.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,previous_status,new_status,request_id,safe_details_json,created_at) SELECT ?,'PARSE_FAILED','SYSTEM','PARSING','FAILED',?,json_object('code',?),? WHERE EXISTS(SELECT 1 FROM material_import_batches WHERE id=? AND status='FAILED')").bind(task.batchId, task.jobId, error.code, timestamp, task.batchId),
    ]);
  }
}

export { BASIC_TARGETS, SUPPLIER_TARGETS } from "./mapping-target-registry.ts";
