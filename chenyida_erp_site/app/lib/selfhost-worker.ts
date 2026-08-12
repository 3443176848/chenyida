import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import type { PoolClient } from "pg";
import type { BackgroundJobQueue, JobLease } from "./infrastructure/background-jobs.ts";
import type { FileStorage } from "./infrastructure/file-storage.ts";
import type { LocalMaterialImportFileFacts, LocalMaterialImportFileStore } from "./material-import-fallback/local-file-store.ts";
import { MATERIAL_IMPORT_MAX_FILE_BYTES } from "./material-import/multipart.ts";
import { parseMaterialImportCsv } from "./material-import/csv-parser.ts";
import { parseMaterialImportXls } from "./material-import/xls-parser.ts";
import { MemoryMaterialImportSharedStringStore, parseMaterialImportXlsx } from "./material-import/xlsx-parser.ts";
import type { MaterialImportParsedRow, MaterialImportParserWarning } from "./material-import/parser-model.ts";
import { publishInitialMapping } from "./material-import-selfhost/service.ts";
import {
  PostgresMaterialImportNormalizationWorker,
  isRetryableNormalizationError,
} from "./material-import-normalization-selfhost/worker.ts";
import {
  PostgresMaterialImportReviewWorker,
  isRetryableReviewError,
} from "./material-import-review-selfhost/worker.ts";

type Publication = {
  result: Record<string, unknown>;
  verify?: () => Promise<void>;
  publish?: (client: PoolClient) => Promise<void>;
};
type Handler = (job: JobLease) => Promise<Publication>;
type PollErrorLogger = (code: string) => void;
type UploadReconciler = Readonly<{ reconcileOneUpload(workerId: string): Promise<boolean> }>;
type RuntimeLeaseGuard = Readonly<{ assertCurrent(): Promise<void> }>;
type ParsedSheetMetadata = Readonly<{
  sheetIndex: number;
  sheetName: string;
  visibility: "VISIBLE" | "HIDDEN" | "VERY_HIDDEN";
  status: "COMPLETED" | "SKIPPED_HIDDEN" | "SKIPPED_VERY_HIDDEN";
  rowCount: number;
  sourceColumnMax: number;
  mergedRanges: readonly string[];
  warnings: readonly MaterialImportParserWarning[];
}>;

export function workerInfrastructureErrorCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error
    ? String(error.code || "")
    : error instanceof Error
      ? error.message
      : "";
  const publicCodes = new Set([
    "IMPORT_FILE_INTEGRITY_MISMATCH", "IMPORT_FILE_STORAGE_MISSING", "IMPORT_FILE_TOO_LARGE", "IMPORT_FILE_TYPE_UNSUPPORTED",
    "IMPORT_NORMALIZATION_LEASE_LOST", "IMPORT_NORMALIZATION_LIMIT_EXCEEDED", "IMPORT_NORMALIZATION_RESULT_INCOMPLETE",
    "IMPORT_PARSE_CANCELLED", "IMPORT_PARSE_INVALID_CSV", "IMPORT_PARSE_INVALID_XLS", "IMPORT_PARSE_INVALID_XLSX",
    "IMPORT_PARSE_LIMIT_EXCEEDED", "IMPORT_PARSE_UNSUPPORTED_ENCODING", "IMPORT_REVIEW_LEASE_LOST", "JOB_LEASE_LOST",
    "JOB_PAYLOAD_INVALID", "JOB_TYPE_UNSUPPORTED",
  ]);
  return publicCodes.has(candidate) ? candidate : "WORKER_INFRASTRUCTURE_ERROR";
}

const defaultPollErrorLogger: PollErrorLogger = (code) => {
  console.error(JSON.stringify({ level: "error", event: "worker_poll_failed", code }));
};

class JobLeaseHeartbeat {
  private readonly callback: () => Promise<boolean>;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  private lost = false;

  constructor(callback: () => Promise<boolean>, intervalMs: number) {
    this.callback = callback;
    this.intervalMs = intervalMs;
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.lost) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private tick(): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.stopped || this.lost) return;
      try { if (!(await this.callback())) this.lost = true; }
      catch { this.lost = true; }
    });
    return this.chain;
  }

  async renew(): Promise<void> {
    await this.tick();
    if (this.lost) throw new Error("JOB_LEASE_LOST");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.chain.catch(() => undefined);
  }
}

type SecureImportStore = Pick<LocalMaterialImportFileStore, "inspect" | "open">;

function expectedImportFacts(job: JobLease): Readonly<{
  batchId: number;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}> {
  const batchId = Number(job.payload.batch_id);
  const relativePath = String(job.payload.relative_path || "");
  const sha256 = String(job.payload.actual_sha256 || "");
  const sizeBytes = Number(job.payload.actual_size_bytes);
  const path = relativePath.match(/^material-import\/([1-9][0-9]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.csv|\.xls|\.xlsx)$/i);
  if (!Number.isSafeInteger(batchId) || batchId <= 0 || !path || Number(path[1]) !== batchId
    || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(sizeBytes)
    || sizeBytes <= 0 || sizeBytes > MATERIAL_IMPORT_MAX_FILE_BYTES) {
    throw new Error("JOB_PAYLOAD_INVALID");
  }
  return { batchId, relativePath, sha256, sizeBytes };
}

function assertImportFacts(
  facts: Readonly<{ sha256: string; sizeBytes: number }>,
  expected: Readonly<{ sha256: string; sizeBytes: number }>,
): void {
  if (facts.sha256 !== expected.sha256 || facts.sizeBytes !== expected.sizeBytes) {
    throw new Error("IMPORT_FILE_INTEGRITY_MISMATCH");
  }
}

async function inspectLegacyStorage(
  storage: FileStorage,
  relativePath: string,
): Promise<Readonly<{ sha256: string; sizeBytes: number }>> {
  const source = await storage.open(relativePath);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of source) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > MATERIAL_IMPORT_MAX_FILE_BYTES) throw new Error("IMPORT_FILE_TOO_LARGE");
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

async function inspectImportStorage(
  storage: FileStorage,
  secureStore: SecureImportStore | undefined,
  relativePath: string,
): Promise<Readonly<{ sha256: string; sizeBytes: number }>> {
  if (secureStore) {
    try {
      const facts: LocalMaterialImportFileFacts = await secureStore.inspect(relativePath, MATERIAL_IMPORT_MAX_FILE_BYTES);
      return { sha256: facts.sha256, sizeBytes: facts.sizeBytes };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new Error("IMPORT_FILE_STORAGE_MISSING");
      }
      throw error;
    }
  }
  return inspectLegacyStorage(storage, relativePath);
}

async function monitoredImportStream(
  storage: FileStorage,
  secureStore: SecureImportStore | undefined,
  relativePath: string,
): Promise<Readonly<{
  stream: ReadableStream<Uint8Array>;
  facts: () => Readonly<{ sha256: string; sizeBytes: number }>;
}>> {
  const opened = secureStore
    ? await secureStore.open(relativePath)
    : Readable.toWeb(await storage.open(relativePath)) as ReadableStream<Uint8Array>;
  if (!opened) throw new Error("IMPORT_FILE_STORAGE_MISSING");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const stream = opened.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > MATERIAL_IMPORT_MAX_FILE_BYTES) throw new Error("IMPORT_FILE_TOO_LARGE");
      hash.update(chunk);
      controller.enqueue(chunk);
    },
  }));
  let digest: string | null = null;
  return {
    stream,
    facts: () => {
      digest ??= hash.digest("hex");
      return { sha256: digest, sizeBytes };
    },
  };
}

async function parseImport(storage: FileStorage, job: JobLease, executor: string, secureStore?: SecureImportStore): Promise<Publication> {
  const expected = expectedImportFacts(job);
  const { batchId, relativePath } = expected;
  assertImportFacts(await inspectImportStorage(storage, secureStore, relativePath), expected);
  const monitored = await monitoredImportStream(storage, secureStore, relativePath);
  const source = monitored.stream;
  const rows: MaterialImportParsedRow[] = []; const onRow = async (row: MaterialImportParsedRow) => { rows.push(row); };
  const extension = relativePath.toLowerCase().slice(relativePath.lastIndexOf(".")); let parser: string; let sheets: readonly ParsedSheetMetadata[];
  if (extension === ".csv") {
    const result = await parseMaterialImportCsv(source, onRow); parser = "csv-parse";
    sheets = Object.freeze([Object.freeze({
      sheetIndex: 0,
      sheetName: "__CSV__",
      visibility: "VISIBLE",
      status: "COMPLETED",
      rowCount: result.rowCount,
      sourceColumnMax: result.sourceColumnMax,
      mergedRanges: Object.freeze([]),
      warnings: result.warnings,
    })]);
  }
  else if (extension === ".xls") { const result = await parseMaterialImportXls(source, onRow); parser = "biff-xls"; sheets = result.sheets; }
  else if (extension === ".xlsx") {
    const wasm = await readFile(new URL("../../node_modules/sax-wasm/lib/sax-wasm.wasm", import.meta.url));
    const result = await parseMaterialImportXlsx(source, wasm, new MemoryMaterialImportSharedStringStore(), onRow); parser = "ooxml-xlsx"; sheets = result.sheets;
  } else throw new Error("IMPORT_FILE_TYPE_UNSUPPORTED");
  assertImportFacts(monitored.facts(), expected);
  return {
    result: { batch_id: batchId, rows: rows.length, sheets: sheets.length, parser },
    verify: async () => assertImportFacts(await inspectImportStorage(storage, secureStore, relativePath), expected),
    publish: async (client) => {
      const batchResult = await client.query(`
        select b.*,f.sha256,f.actual_sha256,f.actual_size_bytes,f.declared_sha256,f.declared_size_bytes,
               f.relative_path,f.storage_status,f.security_check_status
        from material_import_batches b
        join material_import_files f on f.batch_id=b.id
        where b.id=$1 for update of b,f
      `, [batchId]);
      const batch = batchResult.rows[0];
      if (!batch || !["QUEUED_FOR_PARSING", "PARSING"].includes(String(batch.status))
        || batch.relative_path !== relativePath || batch.storage_status !== "STORED"
        || batch.security_check_status !== "BASIC_CHECK_PASSED"
        || batch.actual_sha256 !== expected.sha256 || batch.declared_sha256 !== expected.sha256
        || batch.sha256 !== expected.sha256 || Number(batch.actual_size_bytes) !== expected.sizeBytes
        || Number(batch.declared_size_bytes) !== expected.sizeBytes) {
        throw new Error("IMPORT_PARSE_PUBLICATION_STALE");
      }
      const attempt = await client.query("select coalesce(max(attempt_no),0)::int+1 attempt from material_import_parse_runs where batch_id=$1", [batchId]);
      const parseRun = await client.query(`
        insert into material_import_parse_runs(
          batch_id,parser_version,run_status,attempt_no,source_file_sha256,worker_request_id,current_stage,
          rows_written,parsed_sheet_count,mapping_preparation_status,started_at,completed_at
        ) values($1,'material-import-parser-v1','SUCCEEDED',$2,$3,$4,'COMPLETE',$5,$6,'NOT_STARTED',now(),now())
        returning id
      `, [batchId, Number(attempt.rows[0].attempt), expected.sha256, job.id, rows.length, sheets.filter((sheet) => sheet.status === "COMPLETED").length]);
      const parseRunId = Number(parseRun.rows[0].id);
      for (const item of rows) {
        await client.query(`
          insert into material_import_rows (batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
          values ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [batchId, parseRunId, job.id, item.sheetIndex, item.sheetName, item.rowNumber, item.raw, item.rawRowHash]);
      }
      for (const sheet of sheets) {
        await client.query(`
          insert into material_import_parse_sheets(
            parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,merged_ranges,warnings
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
          parseRunId,
          sheet.sheetIndex,
          sheet.sheetName,
          sheet.visibility,
          sheet.status,
          sheet.rowCount,
          sheet.sourceColumnMax,
          JSON.stringify(sheet.mergedRanges),
          JSON.stringify(sheet.warnings),
        ]);
      }
      await client.query("delete from material_import_mappings where batch_id=$1 and status='DRAFT'", [batchId]);
      const mapping = await publishInitialMapping(client, {
        batchId,
        parseRunId,
        requestId: job.id,
        actor: String(batch.created_by),
        rows,
        sheets: sheets.filter((sheet) => sheet.status === "COMPLETED").map((sheet) => ({
          sheetIndex: sheet.sheetIndex,
          sheetName: sheet.sheetName,
          rowCount: sheet.rowCount,
          sourceColumnMax: sheet.sourceColumnMax,
          mergedRanges: sheet.mergedRanges,
        })),
      });
      await client.query(`
        update material_import_parse_runs
        set mapping_preparation_status='READY',source_structure_digest=$2,updated_at=now()
        where id=$1
      `, [parseRunId, mapping.sourceStructureDigest]);
      await client.query(`
        update material_import_batches set
          status='AWAITING_MAPPING',current_parse_run_id=$2,total_rows=$3,accepted_rows=$3,rejected_rows=0,
          current_version=current_version+1,updated_at=now()
        where id=$1
      `, [batchId, parseRunId, rows.length]);
      await client.query(`
        insert into material_import_events(
          batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details
        ) values($1,'IMPORT_PARSE_PUBLISHED','WORKER',$2,$3,'AWAITING_MAPPING',$4,$5)
      `, [batchId, executor, String(batch.status), job.id, { parse_run_id: parseRunId, mapping_id: mapping.mappingId, rows: rows.length, initiator: String(batch.created_by) }]);
    },
  };
}

async function publishParseTerminalFailure(
  client: PoolClient,
  job: JobLease,
  safeCode: string,
  executor: string,
): Promise<void> {
  const selected = await client.query(`
    select b.* from material_import_job_outbox o
    join material_import_batches b
      on o.aggregate_type='material_import_batch' and b.id::text=o.aggregate_id
    where o.id=$1 and o.job_type='material.import.parse'
      and b.source_kind in ('CSV','XLSX') for update of b
  `, [job.id]);
  const batch = selected.rows[0]; if (!batch || !["QUEUED_FOR_PARSING", "PARSING"].includes(String(batch.status))) return;
  const batchId = Number(batch.id);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) throw new Error("IMPORT_PARSE_BATCH_ID_INVALID");
  const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(safeCode) ? safeCode : "IMPORT_PARSE_FAILED";
  const updated = await client.query(`
    update material_import_batches set status='FAILED',failure_stage='PARSING',failure_code=$2,
      failure_message='文件解析任务失败，请检查文件后重试',current_version=current_version+1,updated_at=now()
    where id=$1 and status in ('QUEUED_FOR_PARSING','PARSING')
  `, [batchId, code]);
  if (updated.rowCount !== 1) return;
  await client.query(`
    update material_import_parse_runs set run_status='FAILED',current_stage='COMPLETE',failure_code=$2,
      safe_failure_message='文件解析任务失败，请检查文件后重试',completed_at=now(),lease_token=null,
      lease_expires_at=null,heartbeat_at=null,updated_at=now()
    where batch_id=$1 and worker_request_id=$3 and run_status not in ('SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')
  `, [batchId, code, job.id]);
  await client.query(`
    insert into material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details)
    values($1,'IMPORT_PARSE_FAILED','WORKER',$2,$3,'FAILED',$4,$5)
  `, [batchId, executor, String(batch.status), job.id, { job_id: job.id, code, initiator: String(batch.created_by) }]);
  await client.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values('system','IMPORT_PARSE_FAILED',$1,$2,'failed','MATERIAL_IMPORT_PARSE',$3,now()+interval '1095 days')
  `, [{ batch_id: batchId, job_id: job.id, executor }, job.id, code]);
}

export class SelfHostedWorker {
  private stopping = false;
  private handlers: Record<string, Handler>;
  private jobs: BackgroundJobQueue;
  private storage: FileStorage;
  private workerId: string;
  private pollMs: number;
  private heartbeatMs: number;
  private pollErrorLogger: PollErrorLogger;
  private normalization?: PostgresMaterialImportNormalizationWorker;
  private review?: PostgresMaterialImportReviewWorker;
  private secureImportStore?: SecureImportStore;
  private uploadReconciler?: UploadReconciler;
  private runtimeLeaseGuard?: RuntimeLeaseGuard;
  constructor(
    jobs: BackgroundJobQueue,
    storage: FileStorage,
    workerId: string,
    pollMs = 1000,
    normalization?: PostgresMaterialImportNormalizationWorker,
    review?: PostgresMaterialImportReviewWorker,
    heartbeatMs = 20_000,
    pollErrorLogger: PollErrorLogger = defaultPollErrorLogger,
    secureImportStore?: SecureImportStore,
    uploadReconciler?: UploadReconciler,
    runtimeLeaseGuard?: RuntimeLeaseGuard,
  ) {
    this.jobs = jobs; this.storage = storage; this.workerId = workerId; this.pollMs = pollMs;
    this.heartbeatMs = heartbeatMs;
    this.pollErrorLogger = pollErrorLogger;
    this.normalization = normalization;
    this.review = review;
    this.secureImportStore = secureImportStore;
    this.uploadReconciler = uploadReconciler;
    this.runtimeLeaseGuard = runtimeLeaseGuard;
    this.handlers = {
      "material.import.parse": (job) => parseImport(this.storage, job, this.workerId, this.secureImportStore),
      "material.import.normalize": (job) => {
        if (!this.normalization) throw new Error("NORMALIZATION_WORKER_NOT_CONFIGURED");
        return this.normalization.prepare(job);
      },
      "material.import.review.finalize": (job) => {
        if (!this.review) throw new Error("IMPORT_REVIEW_WORKER_NOT_CONFIGURED");
        return this.review.prepare(job);
      },
    };
  }
  private async publishTerminalFailure(client: PoolClient, job: JobLease, code: string): Promise<void> {
    if (job.type === "material.import.parse") {
      await publishParseTerminalFailure(client, job, code, this.workerId); return;
    }
    if (job.type === "material.import.normalize" && this.normalization) {
      await this.normalization.publishTerminalFailure(client, job, code, this.workerId); return;
    }
    if (job.type === "material.import.review.finalize" && this.review) {
      await this.review.publishTerminalFailure(client, job, code, this.workerId);
    }
  }
  stop() { this.stopping = true; }
  async runOnce(): Promise<boolean> {
    await this.runtimeLeaseGuard?.assertCurrent();
    await this.jobs.recoverExpired((client, job, code) => this.publishTerminalFailure(client, job, code));
    let reconciledUpload = false;
    if (this.uploadReconciler) {
      try { reconciledUpload = await this.uploadReconciler.reconcileOneUpload(this.workerId); }
      catch (error) { this.pollErrorLogger(workerInfrastructureErrorCode(error)); }
    }
    await this.jobs.dispatchOutbox(); const job = await this.jobs.claim(this.workerId); if (!job) return reconciledUpload;
    const heartbeat = new JobLeaseHeartbeat(() => this.jobs.heartbeat(job, this.workerId), this.heartbeatMs);
    try {
      const handler = this.handlers[job.type]; if (!handler) throw new Error("JOB_TYPE_UNSUPPORTED"); const publication = await handler(job);
      await heartbeat.renew();
      if (publication.verify) await publication.verify();
      await heartbeat.renew();
      await this.runtimeLeaseGuard?.assertCurrent();
      if (!(await this.jobs.complete(job, this.workerId, publication.result, publication.publish))) throw new Error("JOB_LEASE_LOST"); return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("RUNTIME_")) throw error;
      const code = workerInfrastructureErrorCode(error);
      const forceTerminal = job.type === "material.import.normalize"
        ? !isRetryableNormalizationError(error)
        : job.type === "material.import.review.finalize"
          ? !isRetryableReviewError(error)
          : false;
      await this.jobs.fail(
        job,
        this.workerId,
        code,
        "后台任务执行失败",
        forceTerminal,
        (client, terminalJob, terminalCode) => this.publishTerminalFailure(client, terminalJob, terminalCode),
      ); return true;
    }
    finally { await heartbeat.stop(); }
  }
  async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const worked = await this.runOnce();
        if (!worked) await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      } catch (error) {
        if (this.stopping) return;
        this.pollErrorLogger(workerInfrastructureErrorCode(error));
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
    }
  }
}
