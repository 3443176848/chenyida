import type { Pool, PoolClient } from "pg";

import type { Clock, IdGenerator } from "./primitives.ts";

export type JobPayload = Record<string, unknown>;

export interface BackgroundJobEnqueuer {
  enqueue(client: PoolClient, input: { type: string; payload: JobPayload; idempotencyKey: string; aggregateType: string; aggregateId: string }): Promise<string>;
}

export class PostgresBackgroundJobEnqueuer implements BackgroundJobEnqueuer {
  protected readonly pool: Pool;
  protected readonly clock: Clock;
  protected readonly ids: IdGenerator;

  constructor(pool: Pool, clock: Clock, ids: IdGenerator) {
    this.pool = pool;
    this.clock = clock;
    this.ids = ids;
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
}
