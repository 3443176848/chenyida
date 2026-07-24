import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import type { PoolClient } from "pg";
import type { BackgroundJobQueue, JobLease } from "./infrastructure/background-jobs.ts";
import type { FileStorage } from "./infrastructure/file-storage.ts";
import { parseMaterialImportCsv } from "./material-import/csv-parser.ts";
import { parseMaterialImportXls } from "./material-import/xls-parser.ts";
import { MemoryMaterialImportSharedStringStore, parseMaterialImportXlsx } from "./material-import/xlsx-parser.ts";
import type { MaterialImportParsedRow } from "./material-import/parser-model.ts";
import { publishInitialMapping } from "./material-import-selfhost/service.ts";
import {
  PostgresMaterialImportNormalizationWorker,
  isRetryableNormalizationError,
} from "./material-import-normalization-selfhost/worker.ts";
import {
  PostgresMaterialImportReviewWorker,
  isRetryableReviewError,
} from "./material-import-review-selfhost/worker.ts";

type Publication = { result: Record<string, unknown>; publish?: (client: PoolClient) => Promise<void> };
type Handler = (job: JobLease) => Promise<Publication>;

async function parseImport(storage: FileStorage, job: JobLease): Promise<Publication> {
  const batchId = Number(job.payload.batch_id); const relativePath = String(job.payload.relative_path || "");
  if (!Number.isSafeInteger(batchId) || batchId <= 0 || !relativePath) throw new Error("JOB_PAYLOAD_INVALID");
  const stream = await storage.open(relativePath); const source = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  const rows: MaterialImportParsedRow[] = []; const onRow = async (row: MaterialImportParsedRow) => { rows.push(row); };
  const extension = relativePath.toLowerCase().slice(relativePath.lastIndexOf(".")); let parser: string;
  if (extension === ".csv") { await parseMaterialImportCsv(source, onRow); parser = "csv-parse"; }
  else if (extension === ".xls") { await parseMaterialImportXls(source, onRow); parser = "biff-xls"; }
  else if (extension === ".xlsx") {
    const wasm = await readFile(new URL("../../node_modules/sax-wasm/lib/sax-wasm.wasm", import.meta.url));
    await parseMaterialImportXlsx(source, wasm, new MemoryMaterialImportSharedStringStore(), onRow); parser = "ooxml-xlsx";
  } else throw new Error("IMPORT_FILE_TYPE_UNSUPPORTED");
  return {
    result: { batch_id: batchId, rows: rows.length, parser },
    publish: async (client) => {
      const batchResult = await client.query(`
        select b.*,f.sha256 from material_import_batches b
        join material_import_files f on f.batch_id=b.id
        where b.id=$1 for update of b
      `, [batchId]);
      const batch = batchResult.rows[0];
      if (!batch || !["QUEUED_FOR_PARSING", "PARSING"].includes(String(batch.status))) throw new Error("IMPORT_PARSE_PUBLICATION_STALE");
      const attempt = await client.query("select coalesce(max(attempt_no),0)::int+1 attempt from material_import_parse_runs where batch_id=$1", [batchId]);
      const parseRun = await client.query(`
        insert into material_import_parse_runs(
          batch_id,parser_version,run_status,attempt_no,source_file_sha256,worker_request_id,current_stage,
          rows_written,parsed_sheet_count,mapping_preparation_status,started_at,completed_at
        ) values($1,'material-import-parser-v1','SUCCEEDED',$2,$3,$4,'COMPLETE',$5,$6,'NOT_STARTED',now(),now())
        returning id
      `, [batchId, Number(attempt.rows[0].attempt), batch.sha256, job.id, rows.length, new Set(rows.map((row) => row.sheetIndex)).size]);
      const parseRunId = Number(parseRun.rows[0].id);
      for (const item of rows) {
        await client.query(`
          insert into material_import_rows (batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
          values ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [batchId, parseRunId, job.id, item.sheetIndex, item.sheetName, item.rowNumber, item.raw, item.rawRowHash]);
      }
      const sheetIndexes = [...new Set(rows.map((row) => row.sheetIndex))].sort((left, right) => left - right);
      for (const sheetIndex of sheetIndexes) {
        const sheetRows = rows.filter((row) => row.sheetIndex === sheetIndex);
        const columnMax = Math.max(0, ...sheetRows.map((row) => Number(row.raw.source_column_count || 0)));
        await client.query(`
          insert into material_import_parse_sheets(
            parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,merged_ranges,warnings
          ) values($1,$2,$3,'VISIBLE','COMPLETED',$4,$5,null,'[]'::jsonb)
        `, [parseRunId, sheetIndex, sheetRows[0]?.sheetName || `Sheet${sheetIndex + 1}`, sheetRows.length, columnMax]);
        if (sheetRows.length) {
          await client.query(`
            insert into material_import_header_suggestions(
              parse_run_id,sheet_index,row_number,rank,score,reason_codes,algorithm_version,metadata_digest
            ) values($1,$2,1,1,1,'["FIRST_NON_EMPTY_ROW"]'::jsonb,'selfhost-header-v1',$3)
          `, [parseRunId, sheetIndex, "0".repeat(64)]);
        }
      }
      await client.query("delete from material_import_mappings where batch_id=$1 and status='DRAFT'", [batchId]);
      const mapping = await publishInitialMapping(client, {
        batchId,
        parseRunId,
        requestId: job.id,
        actor: String(batch.created_by),
        rows,
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
      `, [batchId, String(batch.created_by), String(batch.status), job.id, { parse_run_id: parseRunId, mapping_id: mapping.mappingId, rows: rows.length }]);
    },
  };
}

export class SelfHostedWorker {
  private stopping = false;
  private handlers: Record<string, Handler>;
  private jobs: BackgroundJobQueue;
  private storage: FileStorage;
  private workerId: string;
  private pollMs: number;
  private heartbeatMs: number;
  private normalization?: PostgresMaterialImportNormalizationWorker;
  private review?: PostgresMaterialImportReviewWorker;
  constructor(
    jobs: BackgroundJobQueue,
    storage: FileStorage,
    workerId: string,
    pollMs = 1000,
    normalization?: PostgresMaterialImportNormalizationWorker,
    review?: PostgresMaterialImportReviewWorker,
    heartbeatMs = 20_000,
  ) {
    this.jobs = jobs; this.storage = storage; this.workerId = workerId; this.pollMs = pollMs;
    this.heartbeatMs = heartbeatMs;
    this.normalization = normalization;
    this.review = review;
    this.handlers = {
      "material.import.parse": (job) => parseImport(this.storage, job),
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
  stop() { this.stopping = true; }
  async runOnce(): Promise<boolean> {
    await this.jobs.recoverExpired(); await this.jobs.dispatchOutbox(); const job = await this.jobs.claim(this.workerId); if (!job) return false;
    const heartbeat = setInterval(() => void this.jobs.heartbeat(job, this.workerId), this.heartbeatMs); heartbeat.unref();
    try {
      const handler = this.handlers[job.type]; if (!handler) throw new Error("JOB_TYPE_UNSUPPORTED"); const publication = await handler(job);
      if (!(await this.jobs.complete(job, this.workerId, publication.result, publication.publish))) throw new Error("JOB_LEASE_LOST"); return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "JOB_FAILED";
      const forceTerminal = job.type === "material.import.normalize"
        ? !isRetryableNormalizationError(error)
        : job.type === "material.import.review.finalize"
          ? !isRetryableReviewError(error)
          : false;
      if (job.type === "material.import.normalize" && this.normalization && (forceTerminal || job.attemptCount >= job.maxAttempts)) {
        await this.normalization.markTerminalFailure(job, error && typeof error === "object" && "code" in error ? String(error.code) : code);
      }
      if (job.type === "material.import.review.finalize" && this.review && (forceTerminal || job.attemptCount >= job.maxAttempts)) {
        await this.review.markTerminalFailure(job, error && typeof error === "object" && "code" in error ? String(error.code) : code);
      }
      await this.jobs.fail(job, this.workerId, code, "后台任务执行失败", forceTerminal); return true;
    }
    finally { clearInterval(heartbeat); }
  }
  async run(): Promise<void> { while (!this.stopping) { const worked = await this.runOnce(); if (!worked) await new Promise((resolve) => setTimeout(resolve, this.pollMs)); } }
}
