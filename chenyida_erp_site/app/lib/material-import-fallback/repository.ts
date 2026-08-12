import type { Pool, PoolClient, QueryResult } from "pg";

export type MaterialImportFallbackQueryResult = QueryResult<Record<string, unknown>>;

export class MaterialImportTransactionOutcomeUnknownError extends Error {
  constructor() { super("MATERIAL_IMPORT_TRANSACTION_OUTCOME_UNKNOWN"); }
}

export class PostgresMaterialImportFallbackRepository {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  query(text: string, values: readonly unknown[] = []): Promise<MaterialImportFallbackQueryResult> {
    return this.pool.query(text, [...values]);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let committing = false;
    try {
      await client.query("begin");
      const result = await operation(client);
      committing = true;
      await client.query("commit");
      return result;
    } catch (error) {
      if (committing) {
        await client.query("rollback").catch(() => undefined);
        throw new MaterialImportTransactionOutcomeUnknownError();
      }
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeWriteRate(actor: string, routeScope: string, keyDigest: string): Promise<void> {
    const client = await this.pool.connect();
    let limited = false;
    let retryAfter = 60;
    try {
      await client.query("begin");
      const known = await client.query(`
        select 1 from material_import_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3
          and recovery_until>now() limit 1
      `, [actor, routeScope, keyDigest]);
      const result = await client.query<{ attempt_count: number; new_key_count: number; retry_after: number }>(`
        insert into identity_write_rate_limit_buckets(
          username,bucket_start,attempt_count,new_key_count,rejected_count,updated_at
        ) values($1,date_trunc('minute',now()),1,$2,0,now())
        on conflict(username,bucket_start) do update set
          attempt_count=identity_write_rate_limit_buckets.attempt_count+1,
          new_key_count=identity_write_rate_limit_buckets.new_key_count+excluded.new_key_count,
          updated_at=now()
        returning attempt_count,new_key_count,
          greatest(1,ceil(extract(epoch from (bucket_start+interval '1 minute'-now()))))::int retry_after
      `, [actor, known.rows[0] ? 0 : 1]);
      const row = result.rows[0];
      limited = Number(row.attempt_count) > 60 || Number(row.new_key_count) > 20;
      retryAfter = Math.min(60, Math.max(1, Number(row.retry_after)));
      if (limited) {
        await client.query(`
          update identity_write_rate_limit_buckets set rejected_count=rejected_count+1,updated_at=now()
          where username=$1 and bucket_start=date_trunc('minute',now())
        `, [actor]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (limited) {
      const error = new Error("MATERIAL_IMPORT_RATE_LIMITED") as Error & { retryAfterSeconds?: number };
      error.retryAfterSeconds = retryAfter;
      throw error;
    }
  }

  async audit(client: PoolClient, input: Readonly<{
    actor: string;
    action: string;
    requestId: string;
    routeCode: string;
    result?: "success" | "failed";
    errorCode?: string | null;
    details?: Readonly<Record<string, unknown>>;
  }>): Promise<void> {
    await client.query(`
      insert into audit_log(
        username,action,detail,request_id,result,route_code,error_code,retention_until
      ) values($1,$2,$3,$4,$5,$6,$7,now()+interval '1095 days')
    `, [
      input.actor,
      input.action,
      input.details ?? {},
      input.requestId,
      input.result ?? "success",
      input.routeCode,
      input.errorCode ?? null,
    ]);
  }

  async failureAudit(input: Readonly<{
    actor: string;
    action: string;
    requestId: string;
    routeCode: string;
    errorCode: string;
    batchId?: number;
  }>): Promise<void> {
    await this.pool.query(`
      insert into audit_log(
        username,action,detail,request_id,result,route_code,error_code,retention_until
      ) values($1,$2,$3,$4,'failed',$5,$6,now()+interval '1095 days')
    `, [input.actor, input.action, input.batchId ? { batch_id: input.batchId } : {}, input.requestId, input.routeCode, input.errorCode]);
  }

  async event(client: PoolClient, input: Readonly<{
    batchId: number;
    eventType: string;
    actorType: "USER" | "SYSTEM" | "WORKER";
    actorIdentifier: string;
    previousStatus: string | null;
    newStatus: string | null;
    requestId: string;
    safeDetails?: Readonly<Record<string, unknown>>;
  }>): Promise<void> {
    await client.query(`
      insert into material_import_events(
        batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details
      ) values($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      input.batchId,
      input.eventType,
      input.actorType,
      input.actorIdentifier,
      input.previousStatus,
      input.newStatus,
      input.requestId,
      input.safeDetails ?? {},
    ]);
  }
}
