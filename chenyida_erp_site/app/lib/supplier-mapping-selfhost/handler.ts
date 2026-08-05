import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { mapSupplierMappingError, SupplierMappingError } from "./errors.ts";
import { SupplierMappingRepository } from "./repository.ts";
import { SupplierMappingService } from "./service.ts";
import { canonicalDigest, mappingUid } from "./validation.ts";

type Dependencies = Readonly<{
  pool: Pool;
  actor: IdentityActor;
  requestId: string;
  requireCsrf: () => void;
}>;

const response = (body: unknown, status: number, requestId: string, replayed = false) => {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId });
  if (replayed) headers.set("Idempotency-Replayed", "true");
  return Response.json(body, { status, headers });
};

const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);
const requirePermission = (actor: IdentityActor, permission: string) => {
  if (!allowed(actor, permission)) throw new SupplierMappingError("PERMISSION_DENIED", "没有权限执行此操作", 403);
};

const positiveQuery = (value: string | null, field: string, fallback: number, maximum: number) => {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `${field} 必须是 1—${maximum} 的整数`);
  }
  return parsed;
};

async function readBody(request: Request) {
  const raw = await request.text();
  if (!raw || Buffer.byteLength(raw) > 64 * 1024) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "请求正文为空或超过 64 KiB");
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "请求正文不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "请求正文必须是对象");
  }
  const object = value as Record<string, unknown>;
  const forbidden = [
    "username", "role", "permissions", "created_by", "updated_by", "submitted_by", "reviewed_by",
    "status", "mapping_uid", "mapping_version_no", "content_digest", "request_id",
  ].find((key) => key in object);
  if (forbidden) throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `请求正文不能指定服务端字段：${forbidden}`);
  return { value: object, digest: canonicalDigest(object) };
}

function mutationMeta(request: Request, dependencies: Dependencies, action: string, requestDigest: string) {
  const key = request.headers.get("Idempotency-Key") || "";
  if (key.length < 8 || key.length > 200) {
    throw new SupplierMappingError("IDEMPOTENCY_KEY_REQUIRED", "写操作必须提供有效 Idempotency-Key");
  }
  const route = new URL(request.url).pathname;
  return {
    actor: dependencies.actor,
    requestId: dependencies.requestId,
    operationId: randomUUID(),
    keyDigest: createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"),
    requestDigest,
    method: request.method,
    route,
    action,
  };
}

export async function handleSupplierMappingApi(request: Request, dependencies: Dependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const collection = path === "/api/supplier-mappings";
  const queue = path === "/api/supplier-mappings/review-queue";
  const options = path === "/api/supplier-mappings/options";
  const preview = path.match(/^\/api\/supplier-mappings\/([0-9a-f-]+)\/review-preview$/i);
  const action = path.match(/^\/api\/supplier-mappings\/([0-9a-f-]+)\/(draft|submit|approve|reject|versions)$/i);
  if (!collection && !queue && !options && !preview && !action) return null;

  const repository = new SupplierMappingRepository(dependencies.pool);
  const service = new SupplierMappingService(repository);
  let auditAction = "SUPPLIER_MAPPING_REQUEST";
  try {
    if (request.method === "GET") {
      if (preview) {
        requirePermission(dependencies.actor, "supplier_mapping.review_queue");
        if (!url.searchParams.has("expected_version")) {
          throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "审核预览必须提供 expected_version");
        }
        const result = await service.reviewPreview(
          mappingUid(preview[1]),
          positiveQuery(url.searchParams.get("expected_version"), "expected_version", 1, 1_000_000_000),
          dependencies.actor.username,
        );
        return response({ ...result, request_id: dependencies.requestId }, 200, dependencies.requestId);
      }
      if (action) throw new SupplierMappingError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
      if (options) {
        requirePermission(dependencies.actor, "supplier_mapping.read");
        const items = await service.referenceOptions(
          String(url.searchParams.get("type") || ""),
          String(url.searchParams.get("q") || ""),
          positiveQuery(url.searchParams.get("limit"), "limit", 20, 20),
        );
        return response({ data: items, items, request_id: dependencies.requestId }, 200, dependencies.requestId);
      }
      if (queue) requirePermission(dependencies.actor, "supplier_mapping.review_queue");
      else requirePermission(dependencies.actor, "supplier_mapping.read");
      const page = positiveQuery(url.searchParams.get("page"), "page", 1, 1_000_000);
      const pageSize = positiveQuery(url.searchParams.get("page_size"), "page_size", 50, 100);
      const result = await service.list({
        page,
        pageSize,
        status: queue
          ? (url.searchParams.has("status") ? url.searchParams.get("status") || undefined : "PENDING_REVIEW")
          : url.searchParams.get("status") || undefined,
        mappingId: url.searchParams.get("mapping_id") || undefined,
        supplierQuery: url.searchParams.get("supplier") || undefined,
        materialQuery: url.searchParams.get("material") || undefined,
        supplierPartNumber: url.searchParams.get("supplier_part_number") || undefined,
      });
      return response({ data: result.rows, rows: result.rows, pagination: result.pagination, request_id: dependencies.requestId }, 200, dependencies.requestId);
    }

    if ((collection && request.method !== "POST") || queue || options || preview || (action && !["POST", "PATCH"].includes(request.method))) {
      throw new SupplierMappingError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
    }
    dependencies.requireCsrf();
    const parsed = await readBody(request);
    let result;
    if (collection) {
      auditAction = "SUPPLIER_MAPPING_CREATED";
      requirePermission(dependencies.actor, "supplier_mapping.create");
      result = await service.create(mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value);
    } else {
      const uid = mappingUid(action![1]);
      const operation = action![2].toLowerCase();
      if (operation === "draft" && request.method === "PATCH") {
        auditAction = "SUPPLIER_MAPPING_DRAFT_EDITED";
        requirePermission(dependencies.actor, "supplier_mapping.edit_draft");
        result = await service.editDraft(uid, mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value);
      } else if (operation === "submit" && request.method === "POST") {
        auditAction = "SUPPLIER_MAPPING_SUBMITTED";
        requirePermission(dependencies.actor, "supplier_mapping.submit");
        result = await service.submit(uid, mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value);
      } else if (operation === "approve" && request.method === "POST") {
        auditAction = "SUPPLIER_MAPPING_APPROVED";
        requirePermission(dependencies.actor, "supplier_mapping.approve");
        result = await service.review(uid, "APPROVE", mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value);
      } else if (operation === "reject" && request.method === "POST") {
        auditAction = "SUPPLIER_MAPPING_REJECTED";
        requirePermission(dependencies.actor, "supplier_mapping.reject");
        result = await service.review(uid, "REJECT", mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value);
      } else if (operation === "versions" && request.method === "POST") {
        auditAction = "SUPPLIER_MAPPING_NEW_VERSION_CREATED";
        requirePermission(dependencies.actor, "supplier_mapping.create");
        result = await service.newVersion(uid, mutationMeta(request, dependencies, auditAction, parsed.digest), parsed.value);
      } else {
        throw new SupplierMappingError("METHOD_NOT_ALLOWED", "接口不支持该请求方法", 405);
      }
    }
    return response(result.body, result.status, dependencies.requestId, result.replayed);
  } catch (error) {
    const known = mapSupplierMappingError(error);
    if (request.method !== "GET") {
      await repository.failureAudit(dependencies.actor.username, dependencies.requestId, auditAction, known.code);
    }
    console.error(JSON.stringify({ level: "error", event: "supplier_mapping_api_failed", request_id: dependencies.requestId, code: known.code }));
    return response({
      error: { code: known.code, message: known.message, request_id: dependencies.requestId },
      code: known.code,
      message: known.message,
      request_id: dependencies.requestId,
    }, known.status, dependencies.requestId);
  }
}
