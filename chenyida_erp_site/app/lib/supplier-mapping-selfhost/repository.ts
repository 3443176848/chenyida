import type { Pool } from "pg";
import { mapSupplierMappingError, SupplierMappingError } from "./errors.ts";
import type { SupplierMappingMutationMeta, SupplierMappingMutationResult, SupplierMappingWork } from "./types.ts";

export class SupplierMappingRepository {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async consumeWriteRate(actor: string, keyDigest: string): Promise<void> {
    const known = await this.pool.query("select 1 from idempotency_keys where key_digest=$1 and expires_at>now()", [keyDigest]);
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
      `, [actor, known.rows[0] ? 0 : 1]);
      limited = Number(result.rows[0].attempt_count) > 60 || Number(result.rows[0].new_key_count) > 20;
      if (limited) {
        await client.query("update identity_write_rate_limit_buckets set rejected_count=rejected_count+1,updated_at=now() where username=$1 and bucket_start=date_trunc('minute',now())", [actor]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw mapSupplierMappingError(error);
    } finally {
      client.release();
    }
    if (limited) throw new SupplierMappingError("RATE_LIMITED", "Supplier Mapping 写操作过于频繁，请稍后重试", 429);
  }

  async execute(meta: SupplierMappingMutationMeta, work: SupplierMappingWork): Promise<SupplierMappingMutationResult> {
    await this.consumeWriteRate(meta.actor.username, meta.keyDigest);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [meta.keyDigest]);
      await client.query("delete from idempotency_keys where key_digest=$1 and expires_at<=now()", [meta.keyDigest]);
      const existing = await client.query<{ request_digest: string; response: Record<string, unknown>; status_code: number }>(
        "select request_digest,response,status_code from idempotency_keys where key_digest=$1",
        [meta.keyDigest],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_digest !== meta.requestDigest) {
          throw new SupplierMappingError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同请求", 409);
        }
        await client.query("commit");
        const body = existing.rows[0].response;
        return {
          status: Number(existing.rows[0].status_code), body, replayed: true,
          mappingUid: String(body.mapping_id || ""), mappingVersionId: Number(body.mapping_version_id || 0),
        };
      }

      await client.query("select set_config('cyd.supplier_mapping_service_write','allowed',true)");
      const result = await work(client);
      await client.query(`
        insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,old_version,new_version,retention_until)
        values($1,$2,$3,$4,'success','SUPPLIER_MAPPING',$5,$6,$7,$8,now()+interval '1095 days')
      `, [meta.actor.username, meta.action, {
        mapping_id: result.mappingUid,
        mapping_version_id: result.mappingVersionId,
        ...(result.safeDetail || {}),
      }, meta.requestId, meta.operationId, meta.keyDigest, result.oldVersion ?? null, result.newVersion ?? null]);
      await client.query(`
        insert into idempotency_keys(key_digest,username,method,path,request_digest,status_code,response,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')
      `, [meta.keyDigest, meta.actor.username, meta.method, meta.route, meta.requestDigest, result.status, result.body]);
      await client.query("commit");
      return { ...result, replayed: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw mapSupplierMappingError(error);
    } finally {
      client.release();
    }
  }

  async failureAudit(actor: string, requestId: string, action: string, code: string): Promise<void> {
    await this.pool.query(`
      insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
      values($1,$2,'{}'::jsonb,$3,'failed','SUPPLIER_MAPPING',$4,now()+interval '1095 days')
    `, [actor, action, requestId, code]).catch(() => undefined);
  }
}
