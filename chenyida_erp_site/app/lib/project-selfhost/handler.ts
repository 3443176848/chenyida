import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { ProjectError, mapProjectError } from "./errors.ts";
import { ProjectRepository } from "./repository.ts";
import { ProjectService } from "./service.ts";
import { canonicalDigest, positiveId } from "./validation.ts";

type Dependencies = Readonly<{ pool: Pool; actor: IdentityActor; requestId: string; requireCsrf: () => void }>;
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => { if (!allowed(actor, permission)) throw new ProjectError("PERMISSION_DENIED", "没有权限执行此操作", 403); };
const response = (body: unknown, status: number, requestId: string, replayed = false) => { const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId }); if (replayed) headers.set("Idempotency-Replayed", "true"); return Response.json(body, { status, headers }); };
const pageValue = (value: string | null, field: string, fallback: number, maximum: number) => { if (!value) return fallback; const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new ProjectError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };

async function readBody(request: Request) {
  const raw = await request.text(); if (!raw || Buffer.byteLength(raw) > 256 * 1024) throw new ProjectError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 256 KiB");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new ProjectError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  const forbidden = ["project_code", "status", "market_owner", "project_owner", "created_by", "request_id", "version", "current_requirement_version_no", "content_digest", "accepted_by", "returned_by", "submitted_by"].find((key) => key in (value as Record<string, unknown>));
  if (forbidden) throw new ProjectError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: value as Record<string, unknown>, digest: canonicalDigest(value) };
}

function mutationMeta(request: Request, dependencies: Dependencies, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || ""; if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) throw new ProjectError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  const route = new URL(request.url).pathname; const rawKeyDigest = createHash("sha256").update(key).digest("hex");
  return { actor: dependencies.actor, requestId: dependencies.requestId, operationId: randomUUID(), keyDigest: createHash("sha256").update(JSON.stringify([dependencies.actor.username, request.method, route, rawKeyDigest])).digest("hex"), requestDigest, method: request.method, route, action };
}

export async function handleProjectApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname; const project = path.match(/^\/api\/projects\/([1-9]\d*)$/); const action = path.match(/^\/api\/projects\/([1-9]\d*)\/(submit|accept|return)$/); const documents = path.match(/^\/api\/projects\/([1-9]\d*)\/documents$/); const document = path.match(/^\/api\/projects\/([1-9]\d*)\/documents\/([1-9]\d*)$/);
  if (path !== "/api/projects" && path !== "/api/project-handoffs" && !project && !action && !documents && !document) return null;
  const repository = new ProjectRepository(dependencies.pool); const service = new ProjectService(repository); let auditAction = "PROJECT_REQUEST";
  try {
    if (request.method === "GET") {
      if (path === "/api/projects") { requirePermission(dependencies.actor, "project.read"); const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 20, 100); const result = await service.list(dependencies.actor, page, size, url.searchParams.get("status") || undefined); return response({ rows: result.rows, data: result.rows, pagination: result.pagination, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (path === "/api/project-handoffs") { requirePermission(dependencies.actor, "project.engineering.read"); const page = pageValue(url.searchParams.get("page"), "page", 1, 1_000_000); const size = pageValue(url.searchParams.get("page_size"), "page_size", 20, 100); const result = await service.handoffQueue(dependencies.actor, page, size, url.searchParams.get("status") || undefined); return response({ rows: result.rows, data: result.rows, pagination: result.pagination, request_id: dependencies.requestId }, 200, dependencies.requestId); }
      if (project) { requirePermission(dependencies.actor, "project.read"); return response({ data: await service.detail(dependencies.actor, Number(project[1])), request_id: dependencies.requestId }, 200, dependencies.requestId); }
      throw new ProjectError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    }
    if (!new Set(["POST", "PATCH", "DELETE"]).has(request.method)) throw new ProjectError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    dependencies.requireCsrf(); const parsed = await readBody(request); let result;
    if (path === "/api/projects" && request.method === "POST") { auditAction = "PROJECT_CREATED"; requirePermission(dependencies.actor, "project.market.create"); result = await service.create(mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else if (project && request.method === "PATCH") { auditAction = "PROJECT_REQUIREMENT_REVISED"; requirePermission(dependencies.actor, "project.market.edit"); result = await service.revise(Number(project[1]), mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else if (action?.[2] === "submit") { auditAction = "PROJECT_HANDOFF_SUBMITTED"; requirePermission(dependencies.actor, "project.market.submit"); result = await service.submit(Number(action[1]), mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else if (action?.[2] === "accept") { auditAction = "PROJECT_HANDOFF_ACCEPTED"; requirePermission(dependencies.actor, "project.engineering.accept"); result = await service.accept(Number(action[1]), mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else if (action?.[2] === "return") { auditAction = "PROJECT_HANDOFF_RETURNED"; requirePermission(dependencies.actor, "project.engineering.return"); result = await service.returnToMarket(Number(action[1]), mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else if (documents && request.method === "POST") { auditAction = "PROJECT_DOCUMENT_LINKED"; requirePermission(dependencies.actor, "project.market.edit"); result = await service.addDocument(Number(documents[1]), mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else if (document && request.method === "DELETE") { auditAction = "PROJECT_DOCUMENT_UNLINKED"; requirePermission(dependencies.actor, "project.market.edit"); result = await service.deleteDocument(Number(document[1]), positiveId(document[2], "linkId"), mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value); }
    else throw new ProjectError("NOT_FOUND", "接口不存在", 404);
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapProjectError(error); await repository.failureAudit(dependencies.actor.username, dependencies.requestId, auditAction, known.code);
    console.error(JSON.stringify({ level: "error", event: "project_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({ error: { code: known.code, message: known.message, request_id: dependencies.requestId }, code: known.code, message: known.message, request_id: dependencies.requestId }, known.status, dependencies.requestId);
  }
}
