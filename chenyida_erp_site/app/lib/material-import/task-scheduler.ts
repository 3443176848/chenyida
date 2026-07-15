import type { MaterialMasterD1Database } from "../material-master/index.ts";

export type MaterialImportJobType = "INSPECT_WORKBOOK" | "PREPARE_SHARED_RESOURCES" | "PARSE_SHEET" | "VERIFY_PARSE_RUN" | "PUBLISH_PARSE_RUN" | "PREPARE_MAPPING" | "PUBLISH_MAPPING_PREPARATION";

export type MaterialImportTask = Readonly<{
  jobId: string;
  batchId: number;
  parseRunId: number;
  jobType: MaterialImportJobType;
  payloadVersion: 1;
  sheetIndex?: number;
}>;

export type MaterialImportTaskDisposition = "ACK" | "RETRY" | "DEAD";

export interface MaterialImportTaskScheduler {
  enqueue(task: MaterialImportTask): Promise<void>;
}

export interface MaterialImportTaskHandler {
  handle(task: MaterialImportTask): Promise<MaterialImportTaskDisposition>;
}

export class InMemoryMaterialImportTaskScheduler implements MaterialImportTaskScheduler {
  readonly #queued: MaterialImportTask[] = [];
  readonly #seen = new Set<string>();
  enqueueFailures = 0;
  async enqueue(task: MaterialImportTask): Promise<void> {
    if (this.enqueueFailures > 0) { this.enqueueFailures -= 1; throw new Error("IN_MEMORY_SCHEDULER_SEND_UNKNOWN"); }
    if (this.#seen.has(task.jobId)) return;
    this.#seen.add(task.jobId);
    this.#queued.push(task);
  }
  pending(): readonly MaterialImportTask[] { return [...this.#queued]; }
  async drain(handler: MaterialImportTaskHandler): Promise<Readonly<{ acknowledged: number; retried: number; dead: number }>> {
    let acknowledged = 0;
    let retried = 0;
    let dead = 0;
    const attempts = this.#queued.length;
    for (let index = 0; index < attempts; index += 1) {
      const task = this.#queued.shift();
      if (!task) break;
      const disposition = await handler.handle(task);
      if (disposition === "ACK") acknowledged += 1;
      else if (disposition === "DEAD") dead += 1;
      else { retried += 1; this.#queued.push(task); }
    }
    return { acknowledged, retried, dead };
  }
}

export type CloudflareQueueLike = Readonly<{ send(message: MaterialImportTask, options?: Readonly<{ contentType?: "json" }>): Promise<void> }>;

export class CloudflareQueueMaterialImportTaskScheduler implements MaterialImportTaskScheduler {
  readonly #queue: CloudflareQueueLike;
  constructor(queue: CloudflareQueueLike) { this.#queue = queue; }
  async enqueue(task: MaterialImportTask): Promise<void> { await this.#queue.send(task, { contentType: "json" }); }
}

type OutboxRow = {
  id: string;
  batch_id: number;
  parse_run_id: number;
  job_type: MaterialImportJobType;
  payload_version: 1;
  payload_json: string;
  dispatch_version: number;
};

function outboxTask(row: OutboxRow): MaterialImportTask {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; } catch { /* protected by DB CHECK */ }
  return {
    jobId: row.id,
    batchId: row.batch_id,
    parseRunId: row.parse_run_id,
    jobType: row.job_type,
    payloadVersion: row.payload_version,
    ...(Number.isInteger(payload.sheet_index) ? { sheetIndex: Number(payload.sheet_index) } : {}),
  };
}

export class MaterialImportOutboxDispatcher {
  readonly #database: MaterialMasterD1Database;
  readonly #scheduler: MaterialImportTaskScheduler;
  readonly #clock: () => Date;
  constructor(database: MaterialMasterD1Database, scheduler: MaterialImportTaskScheduler, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#scheduler = scheduler;
    this.#clock = clock;
  }
  async dispatch(limit = 20): Promise<Readonly<{ selected: number; dispatched: number; retried: number; dead: number }>> {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const now = Math.floor(this.#clock().getTime() / 1000);
    const rows = (await this.#database.prepare(`
      SELECT id,batch_id,parse_run_id,job_type,payload_version,payload_json,dispatch_version
      FROM material_import_job_outbox
      WHERE dispatch_status IN ('PENDING','RETRY_WAIT') AND available_at<=?
      ORDER BY available_at,id LIMIT ?
    `).bind(now, bounded).all<OutboxRow>()).results ?? [];
    let dispatched = 0;
    let retried = 0;
    let dead = 0;
    for (const row of rows) {
      const claimed = await this.#database.prepare(`UPDATE material_import_job_outbox SET dispatch_status='DISPATCHING',dispatch_version=dispatch_version+1,attempt_count=attempt_count+1,last_attempt_at=? WHERE id=? AND dispatch_version=? AND dispatch_status IN ('PENDING','RETRY_WAIT')`).bind(now, row.id, row.dispatch_version).run();
      if ((claimed.meta?.changes ?? 0) !== 1) continue;
      try {
        await this.#scheduler.enqueue(outboxTask(row));
        const completed = await this.#database.prepare(`UPDATE material_import_job_outbox SET dispatch_status='DISPATCHED',dispatched_at=?,safe_failure_code=NULL WHERE id=? AND dispatch_status='DISPATCHING' AND dispatch_version=?`).bind(this.#clock().toISOString(), row.id, row.dispatch_version + 1).run();
        if ((completed.meta?.changes ?? 0) === 1) dispatched += 1;
      } catch {
        const attempt = await this.#database.prepare("SELECT attempt_count FROM material_import_job_outbox WHERE id=?").bind(row.id).first<{ attempt_count: number }>();
        const isDead = (attempt?.attempt_count ?? 1) >= 10;
        await this.#database.prepare(`UPDATE material_import_job_outbox SET dispatch_status=?,available_at=?,safe_failure_code=? WHERE id=? AND dispatch_status='DISPATCHING' AND dispatch_version=?`).bind(isDead ? "DEAD" : "RETRY_WAIT", now + Math.min(3_600, 2 ** Math.min(10, attempt?.attempt_count ?? 1) * 5), "SCHEDULER_SEND_UNKNOWN", row.id, row.dispatch_version + 1).run();
        if (isDead) dead += 1; else retried += 1;
      }
    }
    return { selected: rows.length, dispatched, retried, dead };
  }
}

export type CloudflareQueueMessageLike = Readonly<{ body: MaterialImportTask; ack(): void; retry(options?: Readonly<{ delaySeconds?: number }>): void }>;

export async function consumeMaterialImportQueueMessage(message: CloudflareQueueMessageLike, handler: MaterialImportTaskHandler): Promise<void> {
  const disposition = await handler.handle(message.body).catch(() => "RETRY" as const);
  if (disposition === "RETRY") message.retry({ delaySeconds: 30 });
  else message.ack();
}
