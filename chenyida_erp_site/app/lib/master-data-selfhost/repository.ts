import type { Pool, PoolClient } from "pg";
import { MasterDataError, mapMasterDataError } from "./errors.ts";
import type { MutationMeta, MutationResult, MutationWork } from "./types.ts";

export class PostgresMasterDataRepository {
  readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async query(text: string, values: unknown[] = []) { return this.pool.query(text, values); }

  async nextCode(client: PoolClient, sequence: string, prefix: string): Promise<string> {
    const result = await client.query<{ current_value: string }>(`
      insert into business_code_sequences(sequence_code,current_value,version,updated_at) values($1,1,1,now())
      on conflict(sequence_code) do update set current_value=business_code_sequences.current_value+1,version=business_code_sequences.version+1,updated_at=now()
      returning current_value
    `, [sequence]);
    return `${prefix}-${String(result.rows[0].current_value).padStart(6, "0")}`;
  }

  async consumeWriteRate(actor: string, keyDigest: string): Promise<void> {
    const knownKey = await this.pool.query("select 1 from idempotency_keys where key_digest=$1 and expires_at>now()", [keyDigest]);
    const client = await this.pool.connect();
    let limited = false;
    try {
      await client.query("begin");
      const result = await client.query<{ attempt_count: number; new_key_count: number }>(`
        insert into identity_write_rate_limit_buckets(username,bucket_start,attempt_count,new_key_count,rejected_count,updated_at)
        values($1,date_trunc('minute',now()),1,$2,0,now())
        on conflict(username,bucket_start) do update set
          attempt_count=identity_write_rate_limit_buckets.attempt_count+1,
          new_key_count=identity_write_rate_limit_buckets.new_key_count+excluded.new_key_count,
          updated_at=now()
        returning attempt_count,new_key_count
      `, [actor, knownKey.rows[0] ? 0 : 1]);
      limited = Number(result.rows[0].attempt_count) > 60 || Number(result.rows[0].new_key_count) > 20;
      if (limited) await client.query("update identity_write_rate_limit_buckets set rejected_count=rejected_count+1,updated_at=now() where username=$1 and bucket_start=date_trunc('minute',now())", [actor]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw mapMasterDataError(error);
    } finally { client.release(); }
    if (limited) throw new MasterDataError("RATE_LIMITED", "主数据写操作过于频繁，请稍后重试", 429);
  }

  async execute(meta: MutationMeta, work: MutationWork): Promise<MutationResult> {
    await this.consumeWriteRate(meta.actor.username, meta.keyDigest);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [meta.keyDigest]);
      await client.query("delete from idempotency_keys where key_digest=$1 and expires_at<=now()", [meta.keyDigest]);
      const existing = await client.query<{ request_digest: string; response: Record<string, unknown>; status_code: number }>("select request_digest,response,status_code from idempotency_keys where key_digest=$1", [meta.keyDigest]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_digest !== meta.requestDigest) throw new MasterDataError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同请求", 409);
        await client.query("commit");
        return { status: Number(existing.rows[0].status_code), body: existing.rows[0].response, replayed: true };
      }
      const result = await work(client);
      await client.query(`
        insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,old_version,new_version,retention_until)
        values($1,$2,$3,$4,'success','MASTER_DATA',$5,$6,$7,$8,now()+interval '1095 days')
      `, [meta.actor.username, meta.action, { target_type: result.targetType, target_id: result.targetId }, meta.requestId, meta.operationId, meta.keyDigest, result.oldVersion ?? null, result.newVersion ?? null]);
      await client.query(`insert into idempotency_keys(key_digest,username,method,path,request_digest,status_code,response,expires_at) values($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')`, [meta.keyDigest, meta.actor.username, meta.method, meta.route, meta.requestDigest, result.status, result.body]);
      await client.query("commit");
      return { status: result.status, body: result.body, replayed: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw mapMasterDataError(error);
    } finally { client.release(); }
  }

  async failureAudit(actor: string, requestId: string, action: string, code: string): Promise<void> {
    await this.pool.query(`insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until) values($1,$2,'{}'::jsonb,$3,'failed','MASTER_DATA',$4,now()+interval '1095 days')`, [actor, action, requestId, code]).catch(() => undefined);
  }
}
