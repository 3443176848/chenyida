import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { GOVERNANCE_CATEGORIES } from "./types.ts";
import { MaterialGovernanceError } from "./errors.ts";
import { PostgresMaterialGovernanceRepository } from "./repository.ts";
import { MaterialGovernanceService } from "./service.ts";
import type { GovernanceActor } from "./api-types.ts";

type Dependencies = Readonly<{
  pool: Pool;
  actor: GovernanceActor;
  requestId: string;
  requireCsrf: () => void;
}>;

type Route = Readonly<{
  code: string;
  action: "latest" | "runs" | "run" | "groups" | "group" | "decision" | "rows" | "report";
  methods: readonly string[];
  batchId: number;
  runId?: number;
  groupId?: number;
  report?: string;
}>;

function response(payload: unknown, status: number, requestId: string, headers?: HeadersInit): Response {
  const values = new Headers(headers);
  values.set("Cache-Control", "no-store");
  values.set("X-Request-ID", requestId);
  return Response.json(payload, { status, headers: values });
}

function routeFor(path: string): Route | null {
  const root = path.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/(governance|governance-runs)(?:\/(.*))?$/);
  if (!root) return null;
  const batchId = Number(root[1]);
  if (root[2] === "governance") {
    if (root[3]) return null;
    return { code: "MATERIAL_GOVERNANCE_LATEST", action: "latest", methods: ["GET"], batchId };
  }
  const suffix = root[3] ?? "";
  if (!suffix) return { code: "MATERIAL_GOVERNANCE_RUNS", action: "runs", methods: ["GET", "POST"], batchId };
  const run = suffix.match(/^([1-9][0-9]*)(?:\/(.*))?$/);
  if (!run) return null;
  const runId = Number(run[1]);
  const child = run[2] ?? "";
  if (!child) return { code: "MATERIAL_GOVERNANCE_RUN", action: "run", methods: ["GET"], batchId, runId };
  if (child === "groups") return { code: "MATERIAL_GOVERNANCE_GROUPS", action: "groups", methods: ["GET"], batchId, runId };
  if (child === "rows") return { code: "MATERIAL_GOVERNANCE_ROWS", action: "rows", methods: ["GET"], batchId, runId };
  const report = child.match(/^reports\/(materials|bom-mapping|duplicates|exceptions|alternatives)$/);
  if (report) return { code: `MATERIAL_GOVERNANCE_REPORT_${report[1].toUpperCase().replaceAll("-", "_")}`, action: "report", methods: ["GET"], batchId, runId, report: report[1] };
  const group = child.match(/^groups\/([1-9][0-9]*)(?:\/(decision))?$/);
  if (!group) return null;
  const groupId = Number(group[1]);
  return group[2]
    ? { code: "MATERIAL_GOVERNANCE_GROUP_DECISION", action: "decision", methods: ["POST"], batchId, runId, groupId }
    : { code: "MATERIAL_GOVERNANCE_GROUP", action: "group", methods: ["GET"], batchId, runId, groupId };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function readBody(request: Request): Promise<Readonly<{ value: Record<string, unknown>; digest: string }>> {
  const maximumBytes = 256 * 1024;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
    }
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    totalBytes += part.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
    }
    chunks.push(part.value);
  }
  if (totalBytes === 0) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB", 400);
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString("utf8");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { value, digest: createHash("sha256").update(canonicalJson(value)).digest("hex") };
  } catch {
    throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON 对象", 400);
  }
}

function integer(value: string | null, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value == null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", `${field} 无效`, 400);
  return result;
}

function assertQuery(url: URL, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  const unknown = [...url.searchParams.keys()].find((key) => !keys.has(key));
  if (unknown) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
}

async function failureAudit(dependencies: Dependencies, route: Route, error: MaterialGovernanceError): Promise<void> {
  await dependencies.pool.query(`
    insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until)
    values($1,'MATERIAL_GOVERNANCE_REQUEST_FAILED',$2,$3,'failed',$4,$5,now()+interval '1095 days')
  `, [dependencies.actor.username, { batch_id: route.batchId, governance_run_id: route.runId ?? null, group_id: route.groupId ?? null }, dependencies.requestId, route.code, error.code]).catch(() => undefined);
}

export async function handleSelfhostMaterialGovernanceApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  if (!route) return null;
  try {
    if (!route.methods.includes(request.method)) throw new MaterialGovernanceError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    const service = new MaterialGovernanceService(new PostgresMaterialGovernanceRepository(dependencies.pool));
    if (request.method === "POST") {
      assertQuery(url, []);
      dependencies.requireCsrf();
      const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
      if (!idempotencyKey) throw new MaterialGovernanceError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供 Idempotency-Key", 400);
      const parsed = await readBody(request);
      const context = {
        actor: dependencies.actor,
        requestId: dependencies.requestId,
        idempotencyKey,
        requestDigest: parsed.digest,
        routeScope: `${route.code}:${route.batchId}:${route.runId ?? 0}:${route.groupId ?? 0}`,
      };
      const result = route.action === "runs"
        ? await service.createRun(route.batchId, context, parsed.value)
        : await service.decide(route.batchId, route.runId!, route.groupId!, context, parsed.value);
      return response({ data: result.data, operation_id: result.operationId, request_id: dependencies.requestId }, result.statusCode, dependencies.requestId, result.replayed ? { "Idempotency-Replayed": "true" } : undefined);
    }
    const page = {
      afterId: integer(url.searchParams.get("after_id"), "after_id", 0, 0, Number.MAX_SAFE_INTEGER),
      limit: integer(url.searchParams.get("limit"), "limit", 50, 1, 100),
    };
    if (route.action === "latest") {
      assertQuery(url, []);
      return response({ ...(await service.latest(route.batchId, dependencies.actor)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "runs") {
      assertQuery(url, ["after_id", "limit"]);
      return response({ ...(await service.runs(route.batchId, dependencies.actor, page)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "run") {
      assertQuery(url, []);
      return response({ ...(await service.run(route.batchId, route.runId!, dependencies.actor)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "groups") {
      assertQuery(url, ["after_id", "limit", "readiness", "category", "decision_status"]);
      const readiness = url.searchParams.get("readiness") || undefined;
      const category = url.searchParams.get("category") || undefined;
      const decisionStatus = url.searchParams.get("decision_status") || undefined;
      if (readiness && !["READY", "REVIEW_REQUIRED", "UNSUPPORTED"].includes(readiness)) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "readiness 无效", 400);
      if (category && !GOVERNANCE_CATEGORIES.includes(category as never)) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "category 无效", 400);
      if (decisionStatus && !["PENDING", "BOUND_ACTIVE", "DRAFT_CREATED", "EXCLUDED"].includes(decisionStatus)) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "decision_status 无效", 400);
      return response({ ...(await service.groups(route.batchId, route.runId!, dependencies.actor, page, { readiness, category, decisionStatus })), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "group") {
      assertQuery(url, ["after_id", "limit"]);
      return response({ ...(await service.group(route.batchId, route.runId!, route.groupId!, dependencies.actor, page)), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    if (route.action === "rows") {
      assertQuery(url, ["after_id", "limit", "exceptions_only"]);
      const exceptionsOnly = url.searchParams.get("exceptions_only");
      if (exceptionsOnly && !["true", "false"].includes(exceptionsOnly)) throw new MaterialGovernanceError("REQUEST_VALIDATION_FAILED", "exceptions_only 无效", 400);
      return response({ ...(await service.rows(route.batchId, route.runId!, dependencies.actor, page, exceptionsOnly === "true")), request_id: dependencies.requestId }, 200, dependencies.requestId);
    }
    assertQuery(url, ["after_id", "limit"]);
    return response({ ...(await service.report(route.batchId, route.runId!, dependencies.actor, route.report!, page)), request_id: dependencies.requestId }, 200, dependencies.requestId);
  } catch (error) {
    const compatible = error as { code?: unknown; status?: unknown; message?: unknown; currentVersion?: unknown };
    const known = error instanceof MaterialGovernanceError
      ? error
      : typeof compatible?.code === "string" && Number.isInteger(compatible.status)
        ? new MaterialGovernanceError(String(compatible.code), typeof compatible.message === "string" ? compatible.message : "请求失败", Number(compatible.status), Number.isSafeInteger(compatible.currentVersion) ? Number(compatible.currentVersion) : undefined)
        : new MaterialGovernanceError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
    await failureAudit(dependencies, route, known);
    console.error(JSON.stringify({ level: "error", event: "material_governance_api_failed", request_id: dependencies.requestId, route_code: route.code, code: known.code }));
    const version = known.currentVersion == null ? {} : { current_version: known.currentVersion };
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId, ...version }, code: known.code, message: known.message, request_id: dependencies.requestId, ...version }, known.status, dependencies.requestId);
  }
}
