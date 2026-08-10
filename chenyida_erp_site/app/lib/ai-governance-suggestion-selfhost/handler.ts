import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { canonicalJson } from "./canonical.ts";
import { AiGovernanceSuggestionError } from "./errors.ts";
import { PostgresAiGovernanceSuggestionRepository } from "./repository.ts";
import { AiGovernanceSuggestionService } from "./service.ts";
import type { AiSuggestionActor } from "./types.ts";

type Dependencies = Readonly<{
  pool: Pool;
  actor: AiSuggestionActor;
  requestId: string;
  requireCsrf: () => void;
  service?: AiGovernanceSuggestionService;
}>;

type Route = Readonly<{
  code: "AI_GOVERNANCE_SUGGESTIONS" | "AI_GOVERNANCE_SUGGESTION";
  batchId: number;
  governanceRunId: number;
  governanceGroupId: number;
  suggestionUid?: string;
}>;

function routeFor(path: string): Route | null {
  const match = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/governance-runs\/([1-9][0-9]*)\/groups\/([1-9][0-9]*)\/ai-suggestions(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/i);
  if (!match) return null;
  return {
    code: match[4] ? "AI_GOVERNANCE_SUGGESTION" : "AI_GOVERNANCE_SUGGESTIONS",
    batchId: Number(match[1]),
    governanceRunId: Number(match[2]),
    governanceGroupId: Number(match[3]),
    ...(match[4] ? { suggestionUid: match[4].toLowerCase() } : {}),
  };
}

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const values = new Headers(headers);
  values.set("Cache-Control", "no-store");
  values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function integer(value: string | null, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value == null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new AiGovernanceSuggestionError("REQUEST_VALIDATION_FAILED", `${field} 无效`, 400);
  }
  return result;
}

function assertQuery(url: URL, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  const unknown = [...url.searchParams.keys()].find((key) => !keys.has(key));
  if (unknown) throw new AiGovernanceSuggestionError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

function optionalUuid(value: string | null, field: string): string | null {
  if (value == null || value === "") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AiGovernanceSuggestionError("REQUEST_VALIDATION_FAILED", `${field} 无效`, 400);
  }
  return value.toLowerCase();
}

async function readBody(request: Request): Promise<Readonly<{ value: Record<string, unknown>; digest: string }>> {
  const maximumBytes = 256 * 1024;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new AiGovernanceSuggestionError("REQUEST_BODY_TOO_LARGE", "请求正文为空或超过 256 KiB", 413);
    }
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AiGovernanceSuggestionError("REQUEST_VALIDATION_FAILED", "请求正文为空", 400);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    totalBytes += part.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AiGovernanceSuggestionError("REQUEST_BODY_TOO_LARGE", "请求正文超过 256 KiB", 413);
    }
    chunks.push(part.value);
  }
  if (totalBytes === 0) throw new AiGovernanceSuggestionError("REQUEST_VALIDATION_FAILED", "请求正文为空", 400);
  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString("utf8");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
    const canonical = canonicalJson(value);
    return { value, digest: createHash("sha256").update(canonical).digest("hex") };
  } catch {
    throw new AiGovernanceSuggestionError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON 对象", 400);
  }
}

async function failureAudit(dependencies: Dependencies, route: Route, error: AiGovernanceSuggestionError): Promise<void> {
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,'AI_GOVERNANCE_SUGGESTION_REQUEST_FAILED',$2,$3,'failed',$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, {
    batch_id: route.batchId,
    governance_run_id: route.governanceRunId,
    governance_group_id: route.governanceGroupId,
    suggestion_uid: route.suggestionUid ?? null,
  }, dependencies.requestId, route.code, error.code]).catch(() => undefined);
}

export async function handleSelfhostAiGovernanceSuggestionApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  try {
    const allowedMethods = route.suggestionUid ? ["GET"] : ["GET", "POST"];
    if (!allowedMethods.includes(request.method)) throw new AiGovernanceSuggestionError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    const service = dependencies.service ?? new AiGovernanceSuggestionService(new PostgresAiGovernanceSuggestionRepository(dependencies.pool));
    if (request.method === "POST") {
      assertQuery(url, []);
      dependencies.requireCsrf();
      const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
      if (!idempotencyKey) throw new AiGovernanceSuggestionError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
      const parsed = await readBody(request);
      const result = await service.create(route.batchId, route.governanceRunId, route.governanceGroupId, {
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        idempotencyKey,
        requestDigest: parsed.digest,
        routeScope: `${route.code}:${route.batchId}:${route.governanceRunId}:${route.governanceGroupId}`,
      }, parsed.value);
      return response({
        data: result.data,
        operation_id: result.operationId,
        replay_source: result.replaySource,
        request_id: dependencies.requestId,
      }, result.statusCode, dependencies.requestId, result.replayed ? { "Idempotency-Replayed": "true" } : undefined);
    }
    if (route.suggestionUid) {
      assertQuery(url, []);
      return response({
        data: await service.one(route.batchId, route.governanceRunId, route.governanceGroupId, route.suggestionUid, dependencies.actor),
        request_id: dependencies.requestId,
      }, 200, dependencies.requestId);
    }
    assertQuery(url, ["after_uid", "limit"]);
    const page = {
      afterUid: optionalUuid(url.searchParams.get("after_uid"), "after_uid"),
      limit: integer(url.searchParams.get("limit"), "limit", 50, 1, 100),
    };
    const result = await service.list(route.batchId, route.governanceRunId, route.governanceGroupId, dependencies.actor, page);
    return response({ items: result.items, next_after_uid: result.nextAfterUid, request_id: dependencies.requestId }, 200, dependencies.requestId);
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown; currentVersion?: unknown };
    const known = error instanceof AiGovernanceSuggestionError
      ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new AiGovernanceSuggestionError(String(compatible.code), typeof compatible.message === "string" ? compatible.message : "请求失败", Number(compatible.status), Number.isSafeInteger(compatible.currentVersion) ? Number(compatible.currentVersion) : undefined)
        : new AiGovernanceSuggestionError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
    await failureAudit(dependencies, route, known);
    console.error(JSON.stringify({
      level: "error",
      event: "ai_governance_suggestion_api_failed",
      request_id: dependencies.requestId,
      route_code: route.code,
      code: known.code,
    }));
    const version = known.currentVersion == null ? {} : { current_version: known.currentVersion };
    return response({
      error: { code: known.code, message: known.message, request_id: dependencies.requestId, ...version },
      code: known.code,
      message: known.message,
      request_id: dependencies.requestId,
      ...version,
    }, known.status, dependencies.requestId);
  }
}
