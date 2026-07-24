import type { Pool, PoolClient } from "pg";
import { IdentityError, identityErrorBody } from "./errors.ts";
import { permissionsForRole } from "./permissions.ts";
import type {
  IdentityActor,
  IdentityAuditInput,
  IdentityExecutedResponse,
  IdentityIdempotencyMeta,
  IdentityOperationResponse,
  IdentityOperationWork,
  IdentitySessionContext,
  IdentityUserDto,
  IdentityUserRow,
} from "./types.ts";

const SESSION_HOURS = 8;
const IDEMPOTENCY_HOURS = 24;
const WRITE_ATTEMPT_LIMIT = 60;
const WRITE_NEW_KEY_LIMIT = 20;
const LOGIN_FAILURE_LIMIT = 5;

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function identityUserDto(row: IdentityUserRow): IdentityUserDto {
  return {
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
    version: Number(row.version),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    last_login_at: row.last_login_at ? iso(row.last_login_at) : null,
  };
}

export function identityActor(row: IdentityUserRow): IdentityActor {
  const dto = identityUserDto(row);
  if (!dto.is_active) throw new IdentityError("AUTH_REQUIRED", "请先登录", 401);
  return { ...dto, is_active: true, permissions: permissionsForRole(dto.role) };
}

function postgresCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}

export class PostgresIdentityRepository {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async setupRequired(): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>("select count(*) count from app_users");
    return Number(result.rows[0].count) === 0;
  }

  async findUser(username: string, client: Pool | PoolClient = this.pool): Promise<IdentityUserRow | null> {
    const result = await client.query<IdentityUserRow>("select * from app_users where username=$1", [username]);
    return result.rows[0] || null;
  }

  async authenticate(tokenHash: string | null): Promise<IdentitySessionContext> {
    if (!tokenHash) return { state: "ANONYMOUS", actor: null, token_hash: null };
    const result = await this.pool.query<IdentityUserRow & {
      session_expires_at: Date | string;
      revoked_at: Date | string | null;
      revoked_reason: string | null;
    }>(`
      select u.*,s.expires_at session_expires_at,s.revoked_at,s.revoked_reason
      from app_sessions s left join app_users u on u.username=s.username
      where s.token_hash=$1
    `, [tokenHash]);
    const row = result.rows[0];
    if (!row) return { state: "ANONYMOUS", actor: null, token_hash: tokenHash };
    if (row.revoked_at) return { state: "REVOKED", actor: null, token_hash: tokenHash, revoked_reason: row.revoked_reason };
    if (new Date(row.session_expires_at).getTime() <= Date.now()) return { state: "EXPIRED", actor: null, token_hash: tokenHash };
    if (!row.username || !row.is_active) {
      await this.pool.query("update app_sessions set revoked_at=now(),revoked_reason='USER_INACTIVE' where token_hash=$1 and revoked_at is null", [tokenHash]);
      return { state: "REVOKED", actor: null, token_hash: tokenHash, revoked_reason: "USER_INACTIVE" };
    }
    await this.pool.query(`update app_sessions set expires_at=now()+interval '${SESSION_HOURS} hours' where token_hash=$1 and revoked_at is null`, [tokenHash]);
    return { state: "AUTHENTICATED", actor: identityActor(row), token_hash: tokenHash };
  }

  async createSession(client: PoolClient, username: string, tokenHash: string): Promise<void> {
    await client.query(`insert into app_sessions(token_hash,username,expires_at) values($1,$2,now()+interval '${SESSION_HOURS} hours')`, [tokenHash, username]);
  }

  async revokeCurrentSession(client: PoolClient, tokenHash: string, reason: string): Promise<void> {
    await client.query("update app_sessions set revoked_at=coalesce(revoked_at,now()),revoked_reason=coalesce(revoked_reason,$2) where token_hash=$1", [tokenHash, reason]);
  }

  async revokeUserSessions(client: PoolClient, username: string, reason: string, exceptTokenHash?: string): Promise<number> {
    const result = await client.query(`
      update app_sessions set revoked_at=now(),revoked_reason=$2
      where username=$1 and revoked_at is null and ($3::text is null or token_hash<>$3)
    `, [username, reason, exceptTokenHash || null]);
    return result.rowCount || 0;
  }

  async recordAudit(client: PoolClient, input: IdentityAuditInput): Promise<void> {
    await client.query(`
      insert into audit_log(
        username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,
        old_version,new_version,error_code,target_username,retention_until,created_at
      ) values($1,$2,$3,$4,$5,'IDENTITY',$6,$7,$8,$9,$10,$11,now()+interval '1095 days',now())
    `, [
      input.actor || "", input.action, input.safeDetails || {}, input.requestId, input.result || "success",
      input.operationId || null, input.idempotencyKeyDigest || null, input.oldVersion ?? null,
      input.newVersion ?? null, input.errorCode || null, input.targetUsername || null,
    ]);
  }

  async recordFailure(input: IdentityAuditInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.recordAudit(client, { ...input, result: "failed" });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkLoginRate(usernameDigest: string): Promise<{ limited: boolean; retryAfter: number }> {
    const result = await this.pool.query<{ failure_count: number; retry_after: number }>(`
      select failure_count,
        greatest(1,ceil(extract(epoch from (window_start+interval '15 minutes'-now()))))::int retry_after
      from identity_login_failures
      where username_digest=$1 and window_start=to_timestamp(floor(extract(epoch from now())/900)*900)
    `, [usernameDigest]);
    if (!result.rows[0] || Number(result.rows[0].failure_count) < LOGIN_FAILURE_LIMIT) return { limited: false, retryAfter: 0 };
    return { limited: true, retryAfter: Math.min(900, Math.max(1, Number(result.rows[0].retry_after))) };
  }

  async recordLoginFailure(usernameDigest: string): Promise<number> {
    const result = await this.pool.query<{ failure_count: number }>(`
      insert into identity_login_failures(username_digest,window_start,failure_count,updated_at)
      values($1,to_timestamp(floor(extract(epoch from now())/900)*900),1,now())
      on conflict(username_digest,window_start) do update
        set failure_count=identity_login_failures.failure_count+1,updated_at=now()
      returning failure_count
    `, [usernameDigest]);
    return Number(result.rows[0].failure_count);
  }

  async clearLoginFailures(client: PoolClient, usernameDigest: string): Promise<void> {
    await client.query("delete from identity_login_failures where username_digest=$1", [usernameDigest]);
  }

  async lookupIdempotency(meta: IdentityIdempotencyMeta): Promise<IdentityExecutedResponse | null> {
    const result = await this.pool.query<{ request_digest: string; response: Record<string, unknown>; status_code: number }>(`
      select request_digest,response,status_code from idempotency_keys
      where key_digest=$1 and expires_at>now()
    `, [meta.keyDigest]);
    const row = result.rows[0];
    if (!row) return null;
    if (row.request_digest !== meta.requestDigest) throw new IdentityError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同请求", 409);
    return { status: Number(row.status_code), body: row.response, replayed: true };
  }

  async consumeWriteRate(actor: string, newKey: boolean): Promise<void> {
    const client = await this.pool.connect();
    let limited = false;
    let retryAfter = 60;
    try {
      await client.query("begin");
      const result = await client.query<{ attempt_count: number; new_key_count: number; retry_after: number }>(`
        insert into identity_write_rate_limit_buckets(username,bucket_start,attempt_count,new_key_count,rejected_count,updated_at)
        values($1,date_trunc('minute',now()),1,$2,0,now())
        on conflict(username,bucket_start) do update set
          attempt_count=identity_write_rate_limit_buckets.attempt_count+1,
          new_key_count=identity_write_rate_limit_buckets.new_key_count+excluded.new_key_count,
          updated_at=now()
        returning attempt_count,new_key_count,
          greatest(1,ceil(extract(epoch from (bucket_start+interval '1 minute'-now()))))::int retry_after
      `, [actor, newKey ? 1 : 0]);
      const row = result.rows[0];
      limited = Number(row.attempt_count) > WRITE_ATTEMPT_LIMIT || Number(row.new_key_count) > WRITE_NEW_KEY_LIMIT;
      retryAfter = Math.min(60, Math.max(1, Number(row.retry_after)));
      if (limited) await client.query("update identity_write_rate_limit_buckets set rejected_count=rejected_count+1,updated_at=now() where username=$1 and bucket_start=date_trunc('minute',now())", [actor]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (limited) throw new IdentityError("RATE_LIMITED", "身份写操作过于频繁，请稍后重试", 429, retryAfter);
  }

  async executeIdempotent(meta: IdentityIdempotencyMeta, work: IdentityOperationWork): Promise<IdentityExecutedResponse> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [meta.keyDigest]);
      await client.query("delete from idempotency_keys where key_digest=$1 and expires_at<=now()", [meta.keyDigest]);
      const existing = await client.query<{ request_digest: string; response: Record<string, unknown>; status_code: number }>("select request_digest,response,status_code from idempotency_keys where key_digest=$1", [meta.keyDigest]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_digest !== meta.requestDigest) throw new IdentityError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同请求", 409);
        await client.query("commit");
        return { status: Number(existing.rows[0].status_code), body: existing.rows[0].response, replayed: true };
      }
      await client.query("savepoint identity_business_operation");
      let response: IdentityOperationResponse;
      try {
        response = await work(client);
        await this.recordAudit(client, {
          ...response.audit,
          requestId: meta.requestId,
          operationId: meta.operationId,
          idempotencyKeyDigest: meta.keyDigest,
        });
      } catch (error) {
        if (!(error instanceof IdentityError)) throw error;
        await client.query("rollback to savepoint identity_business_operation");
        const body = identityErrorBody(error, meta.requestId);
        response = {
          status: error.status,
          body,
          audit: { actor: meta.actor, action: meta.action, targetUsername: meta.targetUsername, result: "failed", errorCode: error.code },
        };
        await this.recordAudit(client, {
          ...response.audit,
          requestId: meta.requestId,
          operationId: meta.operationId,
          idempotencyKeyDigest: meta.keyDigest,
        });
      }
      await client.query(`
        insert into idempotency_keys(key_digest,username,method,path,request_digest,status_code,response,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,now()+interval '${IDEMPOTENCY_HOURS} hours')
      `, [meta.keyDigest, meta.actor, meta.method, `${meta.route}:${meta.targetUsername}`, meta.requestDigest, response.status, response.body]);
      await client.query("commit");
      return { status: response.status, body: response.body, replayed: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (postgresCode(error) === "23505") throw new IdentityError("USERNAME_EXISTS", "用户名已存在", 409);
      throw error;
    } finally {
      client.release();
    }
  }

  async listUsers(): Promise<IdentityUserDto[]> {
    const result = await this.pool.query<IdentityUserRow>("select * from app_users order by username asc");
    return result.rows.map(identityUserDto);
  }

  async listAuditLogs(filters: {
    actor?: string;
    targetUsername?: string;
    action?: string;
    result?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const conditions = ["route_code='IDENTITY'"];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); conditions.push(sql.replace("?", `$${values.length}`)); };
    if (filters.actor) add("username=?", filters.actor);
    if (filters.targetUsername) add("target_username=?", filters.targetUsername);
    if (filters.action) add("action=?", filters.action);
    if (filters.result) add("result=?", filters.result);
    if (filters.from) add("created_at>=?", filters.from);
    if (filters.to) add("created_at<=?", filters.to);
    const where = `where ${conditions.join(" and ")}`;
    const count = await this.pool.query<{ count: string }>(`select count(*) count from audit_log ${where}`, values);
    values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
    const result = await this.pool.query(`
      select id,username actor,action,target_username,result,request_id,operation_id,old_version,new_version,error_code,created_at
      from audit_log ${where} order by created_at desc,id desc limit $${values.length - 1} offset $${values.length}
    `, values);
    return {
      total: Number(count.rows[0].count),
      items: result.rows.map((row) => ({ ...row, id: Number(row.id), created_at: iso(row.created_at) })),
    };
  }
}
