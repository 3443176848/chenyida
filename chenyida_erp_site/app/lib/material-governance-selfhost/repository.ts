import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { governanceFailure, MaterialGovernanceError } from "./errors.ts";
import type { GovernanceActor, GovernanceMutationContext } from "./api-types.ts";

type Queryable = Pick<Pool | PoolClient, "query">;
type IdempotentResult<T> = Readonly<{ data: T; operationId: string; replayed: boolean; statusCode: number }>;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const canReadAny = (actor: GovernanceActor): boolean => actor.permissions.includes("*") || actor.permissions.includes("material.import.read_any");

export class PostgresMaterialGovernanceRepository {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const value = await work(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error instanceof MaterialGovernanceError) throw error;
      const database = error as { code?: unknown; constraint?: unknown };
      if (database.code === "23505") governanceFailure("GOVERNANCE_CONFLICT", "治理结果已存在或已被处理", 409);
      if (database.code === "23514" || database.code === "23503") governanceFailure("GOVERNANCE_INVARIANT_VIOLATION", "治理写入未通过数据约束", 422);
      throw error;
    } finally {
      client.release();
    }
  }

  async runIdempotent<T extends Record<string, unknown>>(
    context: GovernanceMutationContext,
    statusCode: number,
    work: (client: PoolClient, operationId: string, keyDigest: string) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!/^[\x21-\x7e]{8,200}$/.test(context.idempotencyKey)) {
      governanceFailure("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key 长度或字符无效", 400);
    }
    const keyDigest = sha256(context.idempotencyKey);
    const scope = `${context.actor.username}:POST:${context.routeScope}:${keyDigest}`;
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [scope]);
      const found = await client.query<{ request_digest: string; operation_id: string; response: T; status_code: number }>(`
        select request_digest,operation_id,response,status_code
        from material_api_idempotency
        where username=$1 and method='POST' and route_scope=$2 and key_digest=$3
        for update
      `, [context.actor.username, context.routeScope, keyDigest]);
      if (found.rows[0]) {
        if (found.rows[0].request_digest !== context.requestDigest) {
          governanceFailure("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求正文", 409);
        }
        return {
          data: found.rows[0].response,
          operationId: found.rows[0].operation_id,
          replayed: true,
          statusCode: found.rows[0].status_code,
        };
      }
      const operationId = randomUUID();
      await client.query("select set_config('cyd.material_governance_service_write','allowed',true)");
      const data = await work(client, operationId, keyDigest);
      await client.query(`
        insert into material_api_idempotency
          (username,method,route_scope,key_digest,request_digest,operation_id,state,response,status_code,created_at,updated_at,expires_at)
        values($1,'POST',$2,$3,$4,$5,'COMPLETED',$6,$7,now(),now(),now()+interval '24 hours')
      `, [context.actor.username, context.routeScope, keyDigest, context.requestDigest, operationId, data, statusCode]);
      return { data, operationId, replayed: false, statusCode };
    });
  }

  async visibleBatch(database: Queryable, batchId: number, actor: GovernanceActor, lock = false): Promise<QueryResultRow> {
    const result = await database.query(`select * from material_import_batches where id=$1${lock ? " for update" : ""}`, [batchId]);
    const row = result.rows[0];
    if (!row || (!canReadAny(actor) && String(row.created_by) !== actor.username)) {
      governanceFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
    }
    return row;
  }

  async visibleRun(database: Queryable, batchId: number, runId: number, actor: GovernanceActor): Promise<QueryResultRow> {
    await this.visibleBatch(database, batchId, actor);
    const result = await database.query("select * from material_governance_runs where id=$1 and batch_id=$2", [runId, batchId]);
    if (!result.rows[0]) governanceFailure("GOVERNANCE_RUN_NOT_FOUND", "治理运行不存在", 404);
    return result.rows[0];
  }

  async audit(client: PoolClient, input: Readonly<{
    actor: string;
    action: string;
    requestId: string;
    routeCode: string;
    operationId?: string;
    keyDigest?: string;
    materialId?: number | null;
    oldVersion?: number | null;
    newVersion?: number | null;
    details?: Record<string, unknown>;
  }>): Promise<void> {
    await client.query(`
      insert into audit_log(
        username,action,detail,request_id,result,route_code,operation_id,
        idempotency_key_digest,material_id,old_version,new_version,retention_until
      ) values($1,$2,$3,$4,'success',$5,$6,$7,$8,$9,$10,now()+interval '1095 days')
    `, [
      input.actor,
      input.action,
      input.details ?? {},
      input.requestId,
      input.routeCode,
      input.operationId ?? null,
      input.keyDigest ?? null,
      input.materialId ?? null,
      input.oldVersion ?? null,
      input.newVersion ?? null,
    ]);
  }
}
