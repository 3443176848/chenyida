import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { IdentityError, versionConflict } from "./errors.ts";
import {
  assertPasswordChanged,
  hashPassword,
  isValidUsername,
  normalizeUsername,
  validateDisplayName,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./password.ts";
import { requirePermission, validateRole } from "./permissions.ts";
import { identityActor, identityUserDto, PostgresIdentityRepository } from "./repository.ts";
import type { IdentityActor, IdentityIdempotencyMeta, IdentityUserDto, IdentityUserRow } from "./types.ts";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function databaseCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}

async function directAudit(client: PoolClient, input: {
  actor: string;
  action: string;
  targetUsername: string;
  requestId: string;
  result?: string;
  errorCode?: string | null;
}): Promise<void> {
  await client.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,target_username,error_code,retention_until,created_at)
    values($1,$2,'{}'::jsonb,$3,$4,'IDENTITY',$5,$6,now()+interval '1095 days',now())
  `, [input.actor, input.action, input.requestId, input.result || "success", input.targetUsername, input.errorCode || null]);
}

export async function initializeAdmin(client: PoolClient, input: { username: string; displayName: string; password: string; requestId?: string }): Promise<string> {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName);
  const password = validatePassword(input.password, username);
  const requestId = input.requestId || randomUUID();
  await client.query("select pg_advisory_xact_lock(hashtext('chenyida-erp-identity-setup'))");
  const count = await client.query<{ count: string }>("select count(*) count from app_users");
  if (Number(count.rows[0].count) > 0) throw new IdentityError("SETUP_COMPLETE", "系统已经完成初始化", 409);
  await client.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values($1,$2,'admin',$3,true,false,1)
  `, [username, displayName, await hashPassword(password)]);
  await client.query("insert into app_meta(key,value) values('setup_completed','1') on conflict(key) do update set value=excluded.value,updated_at=now()");
  await directAudit(client, { actor: username, action: "SYSTEM_INITIALIZED", targetUsername: username, requestId });
  return username;
}

export function assertStatusChangeAllowed(actorUsername: string, target: Pick<IdentityUserRow, "username" | "role" | "is_active">, nextActive: boolean, activeAdminCount: number): void {
  if (target.username === actorUsername && nextActive === false) throw new IdentityError("SELF_DEACTIVATION_FORBIDDEN", "管理员不能停用自己", 403);
  if (target.role === "admin" && target.is_active && nextActive === false && activeAdminCount <= 1) {
    throw new IdentityError("LAST_ACTIVE_ADMIN", "不能停用最后一个 active 管理员", 409);
  }
}

export function assertResetAllowed(actorUsername: string, targetUsername: string): void {
  if (targetUsername === actorUsername) throw new IdentityError("SELF_PASSWORD_RESET_FORBIDDEN", "管理员不能通过重置接口重置自己的密码", 403);
}

export class IdentityService {
  readonly repository: PostgresIdentityRepository;

  constructor(repository: PostgresIdentityRepository) {
    this.repository = repository;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async setup(input: { username: unknown; displayName: unknown; password: unknown; requestId: string }): Promise<{ user: IdentityActor; token: string }> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = digest(token);
    const username = await this.transaction(async (client) => {
      const createdUsername = await initializeAdmin(client, {
        username: String(input.username ?? "admin"),
        displayName: String(input.displayName ?? "系统管理员"),
        password: String(input.password ?? ""),
        requestId: input.requestId,
      });
      await this.repository.createSession(client, createdUsername, tokenHash);
      await client.query("update app_users set last_login_at=now(),updated_at=now() where username=$1", [createdUsername]);
      await this.repository.recordAudit(client, { actor: createdUsername, action: "LOGIN", targetUsername: createdUsername, requestId: input.requestId });
      return createdUsername;
    });
    const row = await this.repository.findUser(username);
    if (!row) throw new Error("created admin missing");
    return { user: identityActor(row), token };
  }

  async login(input: { username: unknown; password: unknown; requestId: string }): Promise<{ user: IdentityActor; token: string }> {
    const normalized = normalizeUsername(input.username).slice(0, 128);
    const usernameDigest = digest(normalized);
    const rate = await this.repository.checkLoginRate(usernameDigest);
    if (rate.limited) {
      await this.repository.recordFailure({ actor: "", action: "LOGIN_RATE_LIMITED", targetUsername: isValidUsername(normalized) ? normalized : "", requestId: input.requestId, errorCode: "RATE_LIMITED" });
      throw new IdentityError("RATE_LIMITED", "登录尝试过于频繁，请稍后重试", 429, rate.retryAfter);
    }
    const row = isValidUsername(normalized) ? await this.repository.findUser(normalized) : null;
    const passwordMatches = await verifyPassword(String(input.password ?? ""), row?.password_hash);
    if (!row || !row.is_active || !passwordMatches) {
      await this.repository.recordLoginFailure(usernameDigest);
      await this.repository.recordFailure({ actor: "", action: "LOGIN_FAILED", targetUsername: isValidUsername(normalized) ? normalized : "", requestId: input.requestId, errorCode: "LOGIN_FAILED" });
      throw new IdentityError("LOGIN_FAILED", "账号或密码不正确", 401);
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = digest(token);
    await this.transaction(async (client) => {
      await this.repository.clearLoginFailures(client, usernameDigest);
      await this.repository.createSession(client, row.username, tokenHash);
      await client.query("update app_users set last_login_at=now(),updated_at=now() where username=$1", [row.username]);
      await this.repository.recordAudit(client, { actor: row.username, action: "LOGIN", targetUsername: row.username, requestId: input.requestId });
    });
    const refreshed = await this.repository.findUser(row.username);
    if (!refreshed) throw new Error("logged in user missing");
    return { user: identityActor(refreshed), token };
  }

  async logout(context: { actor: IdentityActor; tokenHash: string }, requestId: string): Promise<void> {
    await this.transaction(async (client) => {
      await this.repository.revokeCurrentSession(client, context.tokenHash, "LOGOUT");
      await this.repository.recordAudit(client, { actor: context.actor.username, action: "LOGOUT", targetUsername: context.actor.username, requestId });
    });
  }

  async listUsers(actor: IdentityActor): Promise<IdentityUserDto[]> {
    requirePermission(actor, "system.user.read");
    return this.repository.listUsers();
  }

  async createUser(actor: IdentityActor, input: Record<string, unknown>, meta: IdentityIdempotencyMeta) {
    return this.repository.executeIdempotent(meta, async (client) => {
      requirePermission(actor, "system.user.create");
      const username = validateUsername(input.username);
      const displayName = validateDisplayName(input.display_name);
      const role = validateRole(input.role);
      const password = validatePassword(input.temporary_password, username);
      let result;
      try {
        result = await client.query<IdentityUserRow>(`
          insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
          values($1,$2,$3,$4,true,true,1) returning *
        `, [username, displayName, role, await hashPassword(password)]);
      } catch (error) {
        if (databaseCode(error) === "23505") throw new IdentityError("USERNAME_EXISTS", "用户名已存在", 409);
        throw error;
      }
      const user = identityUserDto(result.rows[0]);
      return {
        status: 201,
        body: { ok: true, user, operation_id: meta.operationId, request_id: meta.requestId },
        audit: { actor: actor.username, action: "USER_CREATED", targetUsername: username, oldVersion: null, newVersion: 1 },
      };
    });
  }

  async changeStatus(actor: IdentityActor, input: Record<string, unknown>, meta: IdentityIdempotencyMeta) {
    return this.repository.executeIdempotent(meta, async (client) => {
      requirePermission(actor, "system.user.status");
      const username = validateUsername(input.username);
      if (typeof input.is_active !== "boolean") throw new IdentityError("REQUEST_VALIDATION_FAILED", "is_active 必须为布尔值");
      const desiredActive = input.is_active;
      const expectedVersion = this.expectedVersion(input.expected_version);
      await client.query("select pg_advisory_xact_lock(hashtext('chenyida-erp-active-admin'))");
      const found = await client.query<IdentityUserRow>("select * from app_users where username=$1 for update", [username]);
      const target = found.rows[0];
      if (!target) throw new IdentityError("USER_NOT_FOUND", "用户不存在", 404);
      if (Number(target.version) !== expectedVersion) versionConflict();
      const count = target.role === "admin" && target.is_active && desiredActive === false
        ? await client.query<{ count: string }>("select count(*) count from app_users where role='admin' and is_active=true")
        : { rows: [{ count: "2" }] };
      assertStatusChangeAllowed(actor.username, target, desiredActive, Number(count.rows[0].count));
      const updated = await client.query<IdentityUserRow>(`
        update app_users set is_active=$2,version=version+1,updated_at=now()
        where username=$1 and version=$3 returning *
      `, [username, desiredActive, expectedVersion]);
      if (!updated.rows[0]) versionConflict();
      if (desiredActive === false) await this.repository.revokeUserSessions(client, username, "USER_DEACTIVATED");
      const user = identityUserDto(updated.rows[0]);
      return {
        status: 200,
        body: { ok: true, user, operation_id: meta.operationId, request_id: meta.requestId },
        audit: { actor: actor.username, action: "USER_STATUS_CHANGED", targetUsername: username, oldVersion: expectedVersion, newVersion: user.version, safeDetails: { is_active: user.is_active } },
      };
    });
  }

  async resetPassword(actor: IdentityActor, input: Record<string, unknown>, meta: IdentityIdempotencyMeta) {
    return this.repository.executeIdempotent(meta, async (client) => {
      requirePermission(actor, "system.user.reset");
      const username = validateUsername(input.username);
      assertResetAllowed(actor.username, username);
      const expectedVersion = this.expectedVersion(input.expected_version);
      const password = validatePassword(input.temporary_password, username);
      const found = await client.query<IdentityUserRow>("select * from app_users where username=$1 for update", [username]);
      const target = found.rows[0];
      if (!target) throw new IdentityError("USER_NOT_FOUND", "用户不存在", 404);
      if (Number(target.version) !== expectedVersion) versionConflict();
      const updated = await client.query<IdentityUserRow>(`
        update app_users set password_hash=$2,must_change_password=true,version=version+1,updated_at=now()
        where username=$1 and version=$3 returning *
      `, [username, await hashPassword(password), expectedVersion]);
      if (!updated.rows[0]) versionConflict();
      await this.repository.revokeUserSessions(client, username, "PASSWORD_RESET");
      const user = identityUserDto(updated.rows[0]);
      return {
        status: 200,
        body: { ok: true, user, operation_id: meta.operationId, request_id: meta.requestId },
        audit: { actor: actor.username, action: "USER_PASSWORD_RESET", targetUsername: username, oldVersion: expectedVersion, newVersion: user.version },
      };
    });
  }

  async changeOwnPassword(actor: IdentityActor, currentTokenHash: string, input: Record<string, unknown>, meta: IdentityIdempotencyMeta) {
    return this.repository.executeIdempotent(meta, async (client) => {
      const expectedVersion = this.expectedVersion(input.expected_version);
      const oldPassword = String(input.old_password ?? "");
      const newPassword = validatePassword(input.new_password, actor.username);
      assertPasswordChanged(oldPassword, newPassword);
      const found = await client.query<IdentityUserRow>("select * from app_users where username=$1 and is_active=true for update", [actor.username]);
      const target = found.rows[0];
      if (!target) throw new IdentityError("AUTH_REQUIRED", "请先登录", 401);
      if (Number(target.version) !== expectedVersion) versionConflict();
      if (!(await verifyPassword(oldPassword, target.password_hash))) throw new IdentityError("OLD_PASSWORD_INVALID", "原密码不正确", 400);
      const updated = await client.query<IdentityUserRow>(`
        update app_users set password_hash=$2,must_change_password=false,version=version+1,updated_at=now()
        where username=$1 and version=$3 returning *
      `, [actor.username, await hashPassword(newPassword), expectedVersion]);
      if (!updated.rows[0]) versionConflict();
      await this.repository.revokeUserSessions(client, actor.username, "PASSWORD_CHANGED", currentTokenHash);
      const user = identityUserDto(updated.rows[0]);
      return {
        status: 200,
        body: { ok: true, user, operation_id: meta.operationId, request_id: meta.requestId },
        audit: { actor: actor.username, action: "SELF_PASSWORD_CHANGED", targetUsername: actor.username, oldVersion: expectedVersion, newVersion: user.version },
      };
    });
  }

  async auditLogs(actor: IdentityActor, query: URLSearchParams) {
    requirePermission(actor, "system.audit.read");
    const page = this.boundedInteger(query.get("page"), 1, 1, 1_000_000, "page");
    const pageSize = this.boundedInteger(query.get("page_size"), 20, 1, 100, "page_size");
    const actorFilter = this.optionalUsername(query.get("actor"));
    const targetUsername = this.optionalUsername(query.get("target_username"));
    const action = query.get("action") || undefined;
    if (action && !/^[A-Z][A-Z0-9_]{1,63}$/.test(action)) throw new IdentityError("QUERY_INVALID", "action 筛选无效");
    const result = query.get("result") || undefined;
    if (result && !["success", "failed"].includes(result)) throw new IdentityError("QUERY_INVALID", "result 筛选无效");
    const from = this.optionalDate(query.get("from"), "from");
    const to = this.optionalDate(query.get("to"), "to");
    if (from && to && from > to) throw new IdentityError("QUERY_INVALID", "时间范围无效");
    const data = await this.repository.listAuditLogs({ actor: actorFilter, targetUsername, action, result, from, to, page, pageSize });
    return { data: data.items, rows: data.items, pagination: { page, page_size: pageSize, total: data.total, total_pages: Math.ceil(data.total / pageSize) } };
  }

  private expectedVersion(value: unknown): number {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version < 1) throw new IdentityError("EXPECTED_VERSION_REQUIRED", "expected_version 必须为正整数");
    return version;
  }

  private boundedInteger(value: string | null, fallback: number, min: number, max: number, name: string): number {
    if (value === null || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new IdentityError("QUERY_INVALID", `${name} 参数无效`);
    return parsed;
  }

  private optionalUsername(value: string | null): string | undefined {
    if (!value) return undefined;
    return validateUsername(value);
  }

  private optionalDate(value: string | null, name: string): Date | undefined {
    if (!value) return undefined;
    if (value.length > 40) throw new IdentityError("QUERY_INVALID", `${name} 参数无效`);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new IdentityError("QUERY_INVALID", `${name} 参数无效`);
    return parsed;
  }
}
