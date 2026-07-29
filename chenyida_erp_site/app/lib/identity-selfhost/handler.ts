import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { runtimeConfig } from "../infrastructure/config.ts";
import { requestOriginMatches } from "../infrastructure/request-origin.ts";
import { IdentityError, identityErrorBody, internalIdentityError } from "./errors.ts";
import { constantTimeTextEqual, normalizeUsername } from "./password.ts";
import { PostgresIdentityRepository } from "./repository.ts";
import { IdentityService } from "./service.ts";
import type { IdentityActor, IdentityIdempotencyMeta, IdentitySessionContext } from "./types.ts";

export const SESSION_COOKIE = "CYD_ERP_SESSION";
export const CSRF_COOKIE = "CYD_ERP_CSRF";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_IDENTITY_BODY_BYTES = 16 * 1024;
const IDEMPOTENT_ROUTES = new Set(["/api/me/password", "/api/users", "/api/users/status", "/api/users/reset-password"]);
const IDENTITY_ROUTES = new Set([
  "/api/setup", "/api/login", "/api/logout", "/api/session", "/api/me/password", "/api/users",
  "/api/users/status", "/api/users/reset-password", "/api/system/audit-logs",
]);

const ROUTE_ACTIONS: Record<string, string> = {
  "/api/setup": "SYSTEM_INITIALIZED",
  "/api/login": "LOGIN",
  "/api/logout": "LOGOUT",
  "/api/me/password": "SELF_PASSWORD_CHANGED",
  "/api/users": "USER_CREATED",
  "/api/users/status": "USER_STATUS_CHANGED",
  "/api/users/reset-password": "USER_PASSWORD_RESET",
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cookies(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of (request.headers.get("cookie") || "").split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    result[item.slice(0, index).trim()] = item.slice(index + 1).trim();
  }
  return result;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function jsonResponse(data: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Request-ID", requestId);
  return Response.json(data, { status, headers: responseHeaders });
}

export function identityFailureResponse(error: unknown, requestId: string): Response {
  const known = error instanceof IdentityError ? error : internalIdentityError();
  const headers = new Headers();
  if (known.retryAfter) headers.set("Retry-After", String(known.retryAfter));
  return jsonResponse(identityErrorBody(known, requestId), known.status, requestId, headers);
}

function secureCookie(request: Request, environment: "development" | "test" | "production"): string {
  return environment === "production" || new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function buildAuthCookieHeaders(request: Request, token: string, csrf: string, environment = runtimeConfig().environment): Headers {
  const secure = secureCookie(request, environment);
  const headers = new Headers();
  headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
  headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
  return headers;
}

export function buildCsrfCookieHeader(request: Request, csrf: string, environment = runtimeConfig().environment): string {
  return `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secureCookie(request, environment)}`;
}

export function buildClearCookieHeaders(request: Request, environment = runtimeConfig().environment): Headers {
  const secure = secureCookie(request, environment);
  const headers = new Headers();
  headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  headers.append("Set-Cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`);
  return headers;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IDENTITY_BODY_BYTES) throw new IdentityError("REQUEST_TOO_LARGE", "请求正文过大", 413);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_IDENTITY_BODY_BYTES) throw new IdentityError("REQUEST_TOO_LARGE", "请求正文过大", 413);
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed;
  } catch {
    throw new IdentityError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON");
  }
}

function assertKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const accepted = new Set(allowed);
  if (Object.keys(body).some((key) => !accepted.has(key))) {
    throw new IdentityError("REQUEST_VALIDATION_FAILED", "请求包含不允许的字段");
  }
}

function requireCsrf(request: Request): void {
  const config = runtimeConfig();
  if (!requestOriginMatches(request, config.publicOrigin, config.allowUatLoopbackOrigin)) throw new IdentityError("CSRF_INVALID", "请求来源校验失败", 403);
  const header = request.headers.get("x-csrf-token") || "";
  const cookie = cookies(request)[CSRF_COOKIE] || "";
  if (!header || !cookie || !constantTimeTextEqual(header, cookie)) throw new IdentityError("CSRF_INVALID", "CSRF Token 无效", 403);
}

function requireAuthenticated(context: IdentitySessionContext): asserts context is IdentitySessionContext & { actor: IdentityActor; token_hash: string } {
  if (context.state === "REVOKED") throw new IdentityError("SESSION_REVOKED", "当前会话已撤销，请重新登录", 401);
  if (context.state !== "AUTHENTICATED" || !context.actor || !context.token_hash) throw new IdentityError("AUTH_REQUIRED", "请先登录", 401);
}

function idempotencyMeta(request: Request, actor: IdentityActor, route: string, targetUsername: string, body: Record<string, unknown>, requestId: string): IdentityIdempotencyMeta {
  const key = request.headers.get("idempotency-key") || "";
  if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) throw new IdentityError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效的 Idempotency-Key");
  const keyDigest = digest(key);
  return {
    actor: actor.username,
    method: request.method,
    route,
    targetUsername,
    keyDigest: digest(JSON.stringify([actor.username, request.method, route, targetUsername, keyDigest])),
    requestDigest: digest(JSON.stringify(canonical(body))),
    requestId,
    operationId: randomUUID(),
    action: ROUTE_ACTIONS[route],
  };
}

function routeTarget(path: string, body: Record<string, unknown>, actor?: IdentityActor | null): string {
  if (path === "/api/me/password" || path === "/api/logout") return actor?.username || "";
  return normalizeUsername(body.username).slice(0, 32);
}

export async function resolveIdentitySession(request: Request, repository: PostgresIdentityRepository): Promise<IdentitySessionContext> {
  const token = cookies(request)[SESSION_COOKIE] || "";
  return repository.authenticate(token ? digest(token) : null);
}

export async function handleSelfhostIdentityApi(request: Request, dependencies: { pool: Pool; requestId: string }): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!IDENTITY_ROUTES.has(path)) return null;
  const repository = new PostgresIdentityRepository(dependencies.pool);
  const service = new IdentityService(repository);
  const requestId = dependencies.requestId;
  let context: IdentitySessionContext = { state: "ANONYMOUS", actor: null, token_hash: null };
  let parsedBody: Record<string, unknown> = {};
  let operationMeta: IdentityIdempotencyMeta | null = null;
  try {
    if (path === "/api/setup") {
      if (request.method !== "POST") throw new IdentityError("METHOD_NOT_ALLOWED", "请求方法不允许", 405);
      parsedBody = await readBody(request);
      assertKeys(parsedBody, ["setup_token", "username", "display_name", "password"]);
      const config = runtimeConfig();
      if (!config.setupToken || !constantTimeTextEqual(String(parsedBody.setup_token || ""), config.setupToken)) throw new IdentityError("SETUP_TOKEN_INVALID", "初始化凭证不正确", 403);
      const result = await service.setup({ username: parsedBody.username, displayName: parsedBody.display_name, password: parsedBody.password, requestId });
      const csrf = randomBytes(32).toString("base64url");
      return jsonResponse({ ok: true, user: result.user, setup_required: false, csrf_token: csrf }, 201, requestId, buildAuthCookieHeaders(request, result.token, csrf, config.environment));
    }
    if (path === "/api/login") {
      if (request.method !== "POST") throw new IdentityError("METHOD_NOT_ALLOWED", "请求方法不允许", 405);
      parsedBody = await readBody(request);
      assertKeys(parsedBody, ["username", "password"]);
      const result = await service.login({ username: parsedBody.username, password: parsedBody.password, requestId });
      const csrf = randomBytes(32).toString("base64url");
      return jsonResponse({ ok: true, user: result.user, setup_required: false, csrf_token: csrf }, 200, requestId, buildAuthCookieHeaders(request, result.token, csrf));
    }
    context = await resolveIdentitySession(request, repository);
    if (path === "/api/session") {
      if (request.method !== "GET") throw new IdentityError("METHOD_NOT_ALLOWED", "请求方法不允许", 405);
      const setupRequired = await repository.setupRequired();
      if (context.state !== "AUTHENTICATED" || !context.actor) {
        const headers = context.state === "REVOKED" ? buildClearCookieHeaders(request) : undefined;
        return jsonResponse({ authenticated: false, user: null, setup_required: setupRequired, session_state: context.state }, 200, requestId, headers);
      }
      let csrf = cookies(request)[CSRF_COOKIE] || "";
      const headers = new Headers();
      if (!csrf) {
        csrf = randomBytes(32).toString("base64url");
        headers.append("Set-Cookie", buildCsrfCookieHeader(request, csrf));
      }
      return jsonResponse({ authenticated: true, user: context.actor, setup_required: false, csrf_token: csrf }, 200, requestId, headers);
    }
    if (path === "/api/logout") {
      if (request.method !== "POST") throw new IdentityError("METHOD_NOT_ALLOWED", "请求方法不允许", 405);
      if (context.state === "AUTHENTICATED" && context.actor && context.token_hash) {
        requireCsrf(request);
        await service.logout({ actor: context.actor, tokenHash: context.token_hash }, requestId);
      }
      return jsonResponse({ ok: true }, 200, requestId, buildClearCookieHeaders(request));
    }
    requireAuthenticated(context);
    if (context.actor.must_change_password && path !== "/api/me/password") {
      throw new IdentityError("PASSWORD_CHANGE_REQUIRED", "请先修改临时密码", 403);
    }
    if (path === "/api/users" && request.method === "GET") {
      const rows = await service.listUsers(context.actor);
      return jsonResponse({ rows, data: rows }, 200, requestId);
    }
    if (path === "/api/system/audit-logs" && request.method === "GET") {
      const result = await service.auditLogs(context.actor, new URL(request.url).searchParams);
      return jsonResponse(result, 200, requestId);
    }
    if (!IDEMPOTENT_ROUTES.has(path) || request.method !== "POST") throw new IdentityError("METHOD_NOT_ALLOWED", "请求方法不允许", 405);
    requireCsrf(request);
    parsedBody = await readBody(request);
    const allowedKeys: Record<string, string[]> = {
      "/api/me/password": ["old_password", "new_password", "expected_version"],
      "/api/users": ["username", "display_name", "role", "temporary_password"],
      "/api/users/status": ["username", "is_active", "expected_version"],
      "/api/users/reset-password": ["username", "temporary_password", "expected_version"],
    };
    assertKeys(parsedBody, allowedKeys[path]);
    const target = routeTarget(path, parsedBody, context.actor);
    operationMeta = idempotencyMeta(request, context.actor, path, target, parsedBody, requestId);
    const replay = await repository.lookupIdempotency(operationMeta);
    if (replay) {
      const headers = new Headers({ "Idempotency-Replayed": "true" });
      return jsonResponse(replay.body, replay.status, requestId, headers);
    }
    await repository.consumeWriteRate(context.actor.username, true);
    const result = path === "/api/me/password"
      ? await service.changeOwnPassword(context.actor, context.token_hash, parsedBody, operationMeta)
      : path === "/api/users"
        ? await service.createUser(context.actor, parsedBody, operationMeta)
        : path === "/api/users/status"
          ? await service.changeStatus(context.actor, parsedBody, operationMeta)
          : await service.resetPassword(context.actor, parsedBody, operationMeta);
    const headers = new Headers();
    if (result.replayed) headers.set("Idempotency-Replayed", "true");
    return jsonResponse(result.body, result.status, requestId, headers);
  } catch (error) {
    const known = error instanceof IdentityError ? error : internalIdentityError();
    const loginAlreadyAudited = path === "/api/login" && ["LOGIN_FAILED", "RATE_LIMITED"].includes(known.code);
    if (!loginAlreadyAudited && path !== "/api/session" && path !== "/api/system/audit-logs") {
      const target = routeTarget(path, parsedBody, context.actor);
      await repository.recordFailure({
        actor: context.actor?.username || "",
        action: ROUTE_ACTIONS[path] || "IDENTITY_REQUEST",
        targetUsername: target,
        requestId,
        operationId: operationMeta?.operationId,
        idempotencyKeyDigest: operationMeta?.keyDigest,
        result: "failed",
        errorCode: known.code,
      }).catch(() => undefined);
    }
    console.error(JSON.stringify({ level: "error", event: "identity_request_failed", request_id: requestId, code: known.code }));
    return identityFailureResponse(known, requestId);
  }
}

export function assertProtectedIdentityGate(context: IdentitySessionContext): IdentityActor {
  requireAuthenticated(context);
  if (context.actor.must_change_password) throw new IdentityError("PASSWORD_CHANGE_REQUIRED", "请先修改临时密码", 403);
  return context.actor;
}
