import type { Pool, PoolClient } from "pg";
import type { Clock, IdGenerator } from "./primitives.ts";

export type JobPayload = Record<string, unknown>;
export type JobLease = { id: string; type: string; payload: JobPayload; attemptCount: number; maxAttempts: number; leaseToken: string; version: number; aggregateType?: string; aggregateId?: string };
export type JobTerminalPublication = (client: PoolClient, job: JobLease, code: string) => Promise<void>;

export interface BackgroundJobQueue {
  enqueue(client: PoolClient, input: { type: string; payload: JobPayload; idempotencyKey: string; aggregateType: string; aggregateId: string }): Promise<string>;
  dispatchOutbox(limit?: number): Promise<number>;
  claim(workerId: string): Promise<JobLease | null>;
  heartbeat(job: JobLease, workerId: string): Promise<boolean>;
  complete(job: JobLease, workerId: string, result: JobPayload, publish?: (client: PoolClient) => Promise<void>): Promise<boolean>;
  fail(job: JobLease, workerId: string, code: string, message: string, forceTerminal?: boolean, publishTerminal?: JobTerminalPublication): Promise<boolean>;
  recoverExpired(publishTerminal?: JobTerminalPublication): Promise<number>;
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
      const selected = await client.query<{ id: string; type: string; payload: JobPayload; attempt_count: number; max_attempts: number; version: number; aggregate_type: string | null; aggregate_id: string | null }>(
        `select j.id,j.type,j.payload,j.attempt_count,j.max_attempts,j.version,o.aggregate_type,o.aggregate_id
         from background_jobs j left join material_import_job_outbox o on o.id=j.id
         where j.status='QUEUED' and j.available_at <= $1 order by j.priority,j.created_at,j.id for update of j skip locked limit 1`, [this.clock.now()]);
      const row = selected.rows[0]; if (!row) { await client.query("COMMIT"); return null; }
      const leaseToken = this.ids.uuid(); const expires = new Date(this.clock.now().getTime() + this.leaseSeconds * 1000);
      const updated = await client.query(`update background_jobs set status='RUNNING',attempt_count=attempt_count+1,lease_owner=$2,lease_token=$3,
        lease_expires_at=$4,heartbeat_at=$5,started_at=coalesce(started_at,$5),updated_at=$5,version=version+1 where id=$1 and version=$6`,
        [row.id, workerId, leaseToken, expires, this.clock.now(), row.version]);
      if (updated.rowCount !== 1) throw new Error("JOB_CLAIM_CAS_FAILED");
      await client.query("COMMIT");
      return { id: row.id, type: row.type, payload: row.payload, attemptCount: row.attempt_count + 1, maxAttempts: row.max_attempts, leaseToken, version: row.version + 1,
        ...(row.aggregate_type == null ? {} : { aggregateType: row.aggregate_type }), ...(row.aggregate_id == null ? {} : { aggregateId: row.aggregate_id }) };
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
      await client.query("BEGIN");
      const active = await client.query(`select id from background_jobs
        where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3 and lease_expires_at>$4
        for update`, [job.id, workerId, job.leaseToken, this.clock.now()]);
      if (active.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      if (publish) await publish(client);
      const updated = await client.query(`update background_jobs set status='SUCCEEDED',result=$4,completed_at=$5,updated_at=$5,
        lease_owner=null,lease_token=null,lease_expires_at=null,heartbeat_at=null,version=version+1
        where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3`, [job.id, workerId, job.leaseToken, result, this.clock.now()]);
      if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async fail(job: JobLease, workerId: string, code: string, message: string, forceTerminal = false, publishTerminal?: JobTerminalPublication): Promise<boolean> {
    const client = await this.pool.connect(); const now = this.clock.now();
    try {
      await client.query("BEGIN");
      const active = await client.query<{ id: string; type: string; payload: JobPayload; attempt_count: number; max_attempts: number; version: number; aggregate_type: string | null; aggregate_id: string | null }>(`
        select j.id,j.type,j.payload,j.attempt_count,j.max_attempts,j.version,o.aggregate_type,o.aggregate_id
        from background_jobs j left join material_import_job_outbox o on o.id=j.id
        where j.id=$1 and j.status='RUNNING' and j.lease_owner=$2 and j.lease_token=$3
          and j.lease_expires_at>$4 for update of j
      `, [job.id, workerId, job.leaseToken, now]);
      const row = active.rows[0];
      if (!row) { await client.query("ROLLBACK"); return false; }
      const terminal = forceTerminal || Number(row.attempt_count) >= Number(row.max_attempts);
      const authoritative: JobLease = {
        id: row.id, type: row.type, payload: row.payload, attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts),
        leaseToken: job.leaseToken, version: Number(row.version),
        ...(row.aggregate_type == null ? {} : { aggregateType: row.aggregate_type }), ...(row.aggregate_id == null ? {} : { aggregateId: row.aggregate_id }),
      };
      if (terminal && publishTerminal) await publishTerminal(client, authoritative, code.slice(0, 100));
      const delay = Math.min(300, 2 ** Math.min(authoritative.attemptCount, 8));
      const available = new Date(now.getTime() + delay * 1000);
      const updated = await client.query(`update background_jobs set status=$4,available_at=$5,last_error_code=$6,last_error_message=$7,
        completed_at=case when $4::text='DEAD' then $8::timestamptz else null end,updated_at=$8::timestamptz,lease_owner=null,lease_token=null,lease_expires_at=null,heartbeat_at=null,version=version+1
        where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3 and lease_expires_at>$8`, [job.id, workerId, job.leaseToken, terminal ? "DEAD" : "QUEUED", available, code.slice(0, 100), message.slice(0, 500), now]);
      if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async recoverExpired(publishTerminal?: JobTerminalPublication): Promise<number> {
    const client = await this.pool.connect(); const now = this.clock.now();
    try {
      await client.query("BEGIN");
      const expired = await client.query<{ id: string; type: string; payload: JobPayload; attempt_count: number; max_attempts: number; lease_token: string; version: number; aggregate_type: string | null; aggregate_id: string | null }>(`
        select j.id,j.type,j.payload,j.attempt_count,j.max_attempts,j.lease_token,j.version,o.aggregate_type,o.aggregate_id
        from background_jobs j left join material_import_job_outbox o on o.id=j.id
        where j.status='RUNNING' and j.lease_expires_at <= $1
        order by j.lease_expires_at,j.id for update of j skip locked limit 50
      `, [now]);
      for (const row of expired.rows) {
        const terminal = Number(row.attempt_count) >= Number(row.max_attempts);
        const job: JobLease = {
          id: row.id, type: row.type, payload: row.payload, attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts),
          leaseToken: row.lease_token, version: Number(row.version),
          ...(row.aggregate_type == null ? {} : { aggregateType: row.aggregate_type }), ...(row.aggregate_id == null ? {} : { aggregateId: row.aggregate_id }),
        };
        if (terminal && publishTerminal) await publishTerminal(client, job, "LEASE_EXPIRED");
        const updated = await client.query(`update background_jobs set status=$2,available_at=$3,last_error_code='LEASE_EXPIRED',
          last_error_message='任务租约超时，已由恢复器处理',completed_at=case when $2::text='DEAD' then $3 else null end,
          lease_owner=null,lease_token=null,lease_expires_at=null,heartbeat_at=null,updated_at=$3,version=version+1
          where id=$1 and status='RUNNING' and lease_token=$4 and lease_expires_at<=$3`, [row.id, terminal ? "DEAD" : "QUEUED", now, row.lease_token]);
        if (updated.rowCount !== 1) throw new Error("JOB_RECOVERY_CAS_FAILED");
      }
      await client.query("COMMIT"); return expired.rowCount || 0;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
