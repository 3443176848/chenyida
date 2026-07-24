import type { Pool, PoolClient } from "pg";
import type { Clock, IdGenerator } from "./primitives.ts";

export type JobPayload = Record<string, unknown>;
export type JobLease = { id: string; type: string; payload: JobPayload; attemptCount: number; maxAttempts: number; leaseToken: string; version: number };

export interface BackgroundJobQueue {
  enqueue(client: PoolClient, input: { type: string; payload: JobPayload; idempotencyKey: string; aggregateType: string; aggregateId: string }): Promise<string>;
  dispatchOutbox(limit?: number): Promise<number>;
  claim(workerId: string): Promise<JobLease | null>;
  heartbeat(job: JobLease, workerId: string): Promise<boolean>;
  complete(job: JobLease, workerId: string, result: JobPayload, publish?: (client: PoolClient) => Promise<void>): Promise<boolean>;
  fail(job: JobLease, workerId: string, code: string, message: string, forceTerminal?: boolean): Promise<boolean>;
  recoverExpired(): Promise<number>;
}

export class PostgresBackgroundJobQueue implements BackgroundJobQueue {
  private pool: Pool;
  private clock: Clock;
  private ids: IdGenerator;
  private leaseSeconds: number;
  constructor(pool: Pool, clock: Clock, ids: IdGenerator, leaseSeconds = 60) {
    this.pool = pool; this.clock = clock; this.ids = ids; this.leaseSeconds = leaseSeconds;
  }

  async enqueue(client: PoolClient, input: { type: string; payload: JobPayload; idempotencyKey: string; aggregateType: string; aggregateId: string }): Promise<string> {
    const id = this.ids.uuid();
    const found = await client.query<{ id: string }>(`insert into material_import_job_outbox
      (id, aggregate_type, aggregate_id, job_type, idempotency_key, payload, status, available_at, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,'PENDING',$7,$7,$7)
      on conflict (idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id`,
      [id, input.aggregateType, input.aggregateId, input.type, input.idempotencyKey, input.payload, this.clock.now()]);
    return found.rows[0].id;
  }

  async dispatchOutbox(limit = 50): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pending = await client.query<{ id: string; job_type: string; idempotency_key: string; payload: JobPayload }>(
        `select id, job_type, idempotency_key, payload from material_import_job_outbox
         where status='PENDING' and available_at <= $1 order by created_at, id for update skip locked limit $2`, [this.clock.now(), limit]);
      for (const row of pending.rows) {
        await client.query(`insert into background_jobs
          (id,type,idempotency_key,payload,status,available_at,created_at,updated_at)
          values ($1,$2,$3,$4,'QUEUED',$5,$5,$5) on conflict (idempotency_key) do nothing`,
          [row.id, row.job_type, row.idempotency_key, row.payload, this.clock.now()]);
        await client.query("update material_import_job_outbox set status='PUBLISHED', published_at=$2, updated_at=$2 where id=$1", [row.id, this.clock.now()]);
      }
      await client.query("COMMIT"); return pending.rowCount || 0;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async claim(workerId: string): Promise<JobLease | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ id: string; type: string; payload: JobPayload; attempt_count: number; max_attempts: number; version: number }>(
        `select id,type,payload,attempt_count,max_attempts,version from background_jobs
         where status='QUEUED' and available_at <= $1 order by priority,created_at,id for update skip locked limit 1`, [this.clock.now()]);
      const row = selected.rows[0]; if (!row) { await client.query("COMMIT"); return null; }
      const leaseToken = this.ids.uuid(); const expires = new Date(this.clock.now().getTime() + this.leaseSeconds * 1000);
      const updated = await client.query(`update background_jobs set status='RUNNING',attempt_count=attempt_count+1,lease_owner=$2,lease_token=$3,
        lease_expires_at=$4,heartbeat_at=$5,started_at=coalesce(started_at,$5),updated_at=$5,version=version+1 where id=$1 and version=$6`,
        [row.id, workerId, leaseToken, expires, this.clock.now(), row.version]);
      if (updated.rowCount !== 1) throw new Error("JOB_CLAIM_CAS_FAILED");
      await client.query("COMMIT");
      return { id: row.id, type: row.type, payload: row.payload, attemptCount: row.attempt_count + 1, maxAttempts: row.max_attempts, leaseToken, version: row.version + 1 };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async heartbeat(job: JobLease, workerId: string): Promise<boolean> {
    const expires = new Date(this.clock.now().getTime() + this.leaseSeconds * 1000);
    const result = await this.pool.query(`update background_jobs set heartbeat_at=$4,lease_expires_at=$5,updated_at=$4,version=version+1
      where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3 and lease_expires_at>$4`, [job.id, workerId, job.leaseToken, this.clock.now(), expires]);
    if (result.rowCount === 1) job.version += 1; return result.rowCount === 1;
  }

  async complete(job: JobLease, workerId: string, result: JobPayload, publish?: (client: PoolClient) => Promise<void>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); if (publish) await publish(client);
      const updated = await client.query(`update background_jobs set status='SUCCEEDED',result=$4,completed_at=$5,updated_at=$5,
        lease_owner=null,lease_token=null,lease_expires_at=null,heartbeat_at=null,version=version+1
        where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3`, [job.id, workerId, job.leaseToken, result, this.clock.now()]);
      if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async fail(job: JobLease, workerId: string, code: string, message: string, forceTerminal = false): Promise<boolean> {
    const terminal = forceTerminal || job.attemptCount >= job.maxAttempts; const delay = Math.min(300, 2 ** Math.min(job.attemptCount, 8));
    const available = new Date(this.clock.now().getTime() + delay * 1000);
    const result = await this.pool.query(`update background_jobs set status=$4,available_at=$5,last_error_code=$6,last_error_message=$7,
      completed_at=case when $4::text='DEAD' then $8::timestamptz else null end,updated_at=$8::timestamptz,lease_owner=null,lease_token=null,lease_expires_at=null,heartbeat_at=null,version=version+1
      where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3`, [job.id, workerId, job.leaseToken, terminal ? "DEAD" : "QUEUED", available, code.slice(0, 100), message.slice(0, 500), this.clock.now()]);
    return result.rowCount === 1;
  }

  async recoverExpired(): Promise<number> {
    const result = await this.pool.query(`update background_jobs set status=case when attempt_count>=max_attempts then 'DEAD' else 'QUEUED' end,
      available_at=$1,last_error_code='LEASE_EXPIRED',last_error_message='任务租约超时，已由恢复器处理',completed_at=case when attempt_count>=max_attempts then $1 else null end,
      lease_owner=null,lease_token=null,lease_expires_at=null,heartbeat_at=null,updated_at=$1,version=version+1 where status='RUNNING' and lease_expires_at <= $1`, [this.clock.now()]);
    return result.rowCount || 0;
  }
}
