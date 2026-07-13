import {
  createD1MaterialMasterRepository,
  createMaterialDraftService,
  createMaterialReviewService,
  MaterialMasterServiceError,
  type MaterialApiTransactionCompanion,
  type MaterialMasterD1Database,
} from "../material-master/index.ts";
import {
  createD1MaterialValidationRepository,
  createMaterialValidationService,
  type MaterialAttributeInput,
  type MaterialValidationD1Database,
  type ValidationIssue,
} from "../material-validation/index.ts";
import { createMaterialMasterQueryService } from "./query-service.ts";
import {
  assertMaterialCsrf,
  completeIdempotentFailure,
  DEFAULT_MATERIAL_RATE_LIMITS,
  MaterialApiFailure,
  materialErrorResponse,
  materialJsonResponse,
  readBoundedJson,
  readCompletedIdempotency,
  renderStoredResponse,
  reserveIdempotency,
  writeMaterialAudit,
  type MaterialApiRouteCode,
  type MaterialApiUser,
} from "./security.ts";

type MaterialPermission =
  | "material.read"
  | "material.draft.create"
  | "material.review.approve"
  | "material.review.reject";

type MaterialRoute = Readonly<{
  code: MaterialApiRouteCode;
  materialId: number | null;
  supportedMethods: readonly string[];
  permission(method: string): MaterialPermission;
}>;

export type MaterialApiDependencies = Readonly<{
  database: MaterialMasterD1Database;
  currentUser(request: Request): Promise<MaterialApiUser | null>;
  userCan(user: MaterialApiUser, permission: MaterialPermission): boolean;
  clock?: () => Date;
  rateLimits?: Readonly<{ attemptsPerMinute: number; newKeysPerMinute: number }>;
}>;

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  "actor", "context", "request_id", "created_by", "updated_by", "approved_by",
  "reviewed_by", "internal_material_code", "material_status", "version", "attribute_id",
]);
const SOURCE_TYPES = new Set(["MANUAL", "LEGACY_D1", "LEGACY_SQLITE", "GOVERNANCE_TEMPLATE", "API", "SUPPLIER_IMPORT", "AI", "SYSTEM"]);
const STATUSES = new Set(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "FROZEN", "INACTIVE"]);
const PUBLIC_SOURCE_TYPES = new Set(["MANUAL"]);

function routeFor(path: string): MaterialRoute | null {
  if (path === "/api/material-master/drafts") {
    return {
      code: "MATERIAL_DRAFT_LIST", materialId: null, supportedMethods: ["GET", "POST"],
      permission: (method) => method === "GET" ? "material.read" : "material.draft.create",
    };
  }
  const detail = path.match(/^\/api\/material-master\/drafts\/([1-9][0-9]*)$/);
  if (detail) {
    const id = Number(detail[1]);
    if (!Number.isSafeInteger(id)) return null;
    return { code: "MATERIAL_DRAFT_DETAIL", materialId: id, supportedMethods: ["GET"], permission: () => "material.read" };
  }
  const review = path.match(/^\/api\/material-master\/drafts\/([1-9][0-9]*)\/(approve|reject)$/);
  if (review) {
    const id = Number(review[1]);
    if (!Number.isSafeInteger(id)) return null;
    const approve = review[2] === "approve";
    return {
      code: approve ? "MATERIAL_DRAFT_APPROVE" : "MATERIAL_DRAFT_REJECT",
      materialId: id,
      supportedMethods: ["POST"],
      permission: () => approve ? "material.review.approve" : "material.review.reject",
    };
  }
  return null;
}

function assertNoIdentityFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoIdentityFields(item);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_IDENTITY_FIELDS.has(key)) {
      throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `禁止客户端指定字段：${key}`, 400);
    }
    assertNoIdentityFields(child);
  }
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 包含未声明字段：${unknown}`, 400);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是对象`, 400);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string, maximum: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 必填`, 400);
    return "";
  }
  if (typeof value !== "string") throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是字符串`, 400);
  const normalized = value.trim();
  if (required && !normalized) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 必填`, 400);
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 长度或字符无效`, 400);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`, 400);
  }
  return Number(value);
}

function createCommand(
  body: Record<string, unknown>,
  user: MaterialApiUser,
  companion: MaterialApiTransactionCompanion,
) {
  assertKeys(body, ["basic_fields", "category_id", "attributes"], "请求正文");
  assertNoIdentityFields(body);
  const basic = objectValue(body.basic_fields, "basic_fields");
  assertKeys(basic, [
    "standard_name", "unit", "source_type", "source_ref", "brand", "manufacturer",
    "manufacturer_part_number", "procurement_type", "inventory_type", "lot_control_required",
    "shelf_life_days", "inspection_type", "environmental_requirement",
  ], "basic_fields");
  const sourceType = optionalString(basic.source_type, "basic_fields.source_type", 32, true);
  if (SOURCE_TYPES.has(sourceType) && !PUBLIC_SOURCE_TYPES.has(sourceType)) {
    throw new MaterialApiFailure("SOURCE_TYPE_NOT_ALLOWED", "人工创建 API 只允许 MANUAL 来源", 400);
  }
  if (sourceType !== "MANUAL") {
    throw new MaterialApiFailure("SOURCE_TYPE_NOT_ALLOWED", "人工创建 API 只允许 MANUAL 来源", 400);
  }
  const attributes = objectValue(body.attributes, "attributes");
  if (Object.keys(attributes).length > 128) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "attributes 最多包含 128 项", 400);
  }
  for (const [code, rawEntry] of Object.entries(attributes)) {
    const entry = objectValue(rawEntry, `attributes.${code}`);
    assertKeys(entry, ["value", "unit", "source", "confidence"], `attributes.${code}`);
    if (!("value" in entry)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `attributes.${code}.value 必填`, 400);
    if (typeof entry.value === "string" && entry.value.length > 1000) {
      throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `attributes.${code}.value 过长`, 400);
    }
    if (entry.unit !== undefined) optionalString(entry.unit, `attributes.${code}.unit`, 32, true);
    if (entry.source !== undefined && entry.source !== "MANUAL") {
      throw new MaterialApiFailure("SOURCE_TYPE_NOT_ALLOWED", "人工创建属性只允许 MANUAL 来源", 400);
    }
    if (entry.confidence !== undefined && (typeof entry.confidence !== "number" || !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1)) {
      throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `attributes.${code}.confidence 必须在 0 到 1 之间`, 400);
    }
  }
  if (basic.lot_control_required !== undefined && typeof basic.lot_control_required !== "boolean") {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "basic_fields.lot_control_required 必须是布尔值", 400);
  }
  if (basic.shelf_life_days !== undefined && basic.shelf_life_days !== null && (!Number.isSafeInteger(basic.shelf_life_days) || Number(basic.shelf_life_days) < 0)) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "basic_fields.shelf_life_days 必须是非负整数或 null", 400);
  }
  return {
    basic_fields: {
      category_id: positiveInteger(body.category_id, "category_id"),
      standard_name: optionalString(basic.standard_name, "basic_fields.standard_name", 200, true),
      unit: optionalString(basic.unit, "basic_fields.unit", 32, true),
      brand: optionalString(basic.brand, "basic_fields.brand", 200),
      manufacturer: optionalString(basic.manufacturer, "basic_fields.manufacturer", 200),
      manufacturer_part_number: optionalString(basic.manufacturer_part_number, "basic_fields.manufacturer_part_number", 200),
      procurement_type: optionalString(basic.procurement_type, "basic_fields.procurement_type", 32, true),
      inventory_type: optionalString(basic.inventory_type, "basic_fields.inventory_type", 32, true),
      lot_control_required: basic.lot_control_required ?? false,
      shelf_life_days: basic.shelf_life_days ?? null,
      inspection_type: optionalString(basic.inspection_type, "basic_fields.inspection_type", 32, true),
      environmental_requirement: optionalString(basic.environmental_requirement, "basic_fields.environmental_requirement", 32, true),
      source_ref: optionalString(basic.source_ref, "basic_fields.source_ref", 255) || `request:${companion.operationId}`,
    },
    attributes: attributes as Record<string, MaterialAttributeInput>,
    source_type: "MANUAL",
    context: { actor: user.username, request_id: companion.operationId, transaction_companion: companion },
  };
}

function reviewCommand(
  body: Record<string, unknown>,
  user: MaterialApiUser,
  companion: MaterialApiTransactionCompanion,
  materialId: number,
  approve: boolean,
) {
  assertNoIdentityFields(body);
  assertKeys(body, approve ? ["expected_version", "review_comment"] : ["expected_version", "reason"], "请求正文");
  const reason = optionalString(
    approve ? body.review_comment : body.reason,
    approve ? "review_comment" : "reason",
    1000,
    !approve,
  );
  return {
    material_id: materialId,
    expected_version: positiveInteger(body.expected_version, "expected_version"),
    reason,
    context: { actor: user.username, request_id: companion.operationId, transaction_companion: companion },
  };
}

function queryInteger(url: URL, key: string, fallback: number, maximum: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${key} 必须是正整数`, 400);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${key} 超出允许范围`, 400);
  return value;
}

function dateBoundary(value: string, key: string, nextDay = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${key} 日期格式无效`, 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `${key} 日期无效`, 400);
  }
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function mapServiceError(error: MaterialMasterServiceError, materialId: number | null): MaterialApiFailure {
  const validation = error.validation;
  const details: ValidationIssue[] = validation ? [...validation.errors, ...validation.warnings] : [];
  const metadataCodes = new Set([
    "MATERIAL_VALIDATION_METADATA_UNAVAILABLE", "MATERIAL_ATTRIBUTE_METADATA_INVALID",
    "MATERIAL_CATEGORY_RULES_MISSING", "MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED",
  ]);
  if (error.code === "MATERIAL_CREATE_VALIDATION_FAILED" || error.code === "MATERIAL_REVIEW_VALIDATION_FAILED") {
    const internal = validation?.errors.some((issue) => metadataCodes.has(issue.code));
    return new MaterialApiFailure(internal ? "INTERNAL_ERROR" : "MATERIAL_VALIDATION_FAILED", internal ? "物料校验规则暂时不可用" : "物料未通过校验", internal ? 500 : 422, details, materialId);
  }
  const mappings: Record<string, [string, string, number]> = {
    MATERIAL_DRAFT_INPUT_INVALID: ["REQUEST_VALIDATION_FAILED", error.message, 400],
    MATERIAL_ATTRIBUTE_VALUE_INVALID: ["MATERIAL_VALIDATION_FAILED", error.message, 422],
    MATERIAL_ATTRIBUTE_STORAGE_METADATA_CONFLICT: ["MATERIAL_METADATA_CONFLICT", "物料规则在提交期间发生变化，请重试", 409],
    MATERIAL_ATTRIBUTE_STORAGE_METADATA_INVALID: ["INTERNAL_ERROR", "物料属性规则暂时不可用", 500],
    MATERIAL_ATTRIBUTE_STORAGE_INVALID: ["INTERNAL_ERROR", "物料属性规则暂时不可用", 500],
    MATERIAL_DRAFT_NOT_FOUND: ["MATERIAL_NOT_FOUND", "物料草稿不存在", 404],
    MATERIAL_DRAFT_NOT_REVIEWABLE: ["INVALID_MATERIAL_STATE", "当前物料状态不允许审核", 409],
    MATERIAL_VERSION_CONFLICT: ["VERSION_CONFLICT", "物料已被其他用户修改，请刷新后重试", 409],
    MATERIAL_CODE_RULE_NOT_FOUND: ["CODE_GENERATION_CONFLICT", "物料编码规则不可用", 409],
    MATERIAL_CODE_RULE_AMBIGUOUS: ["CODE_GENERATION_CONFLICT", "物料编码规则不可用", 409],
    MATERIAL_CODE_RULE_INVALID: ["CODE_GENERATION_CONFLICT", "物料编码规则不可用", 409],
    MATERIAL_CODE_SEQUENCE_EXHAUSTED: ["CODE_GENERATION_CONFLICT", "物料编码序列不可用", 409],
    MATERIAL_CODE_ALLOCATION_CONFLICT: ["CODE_GENERATION_CONFLICT", "物料编码分配冲突，请重试", 409],
    MATERIAL_WRITE_FAILED: ["INTERNAL_ERROR", "系统处理失败，请联系管理员", 500],
  };
  const mapped = mappings[error.code] ?? ["INTERNAL_ERROR", "系统处理失败，请联系管理员", 500];
  return new MaterialApiFailure(
    mapped[0],
    mapped[1],
    mapped[2],
    [],
    error.code === "MATERIAL_DRAFT_NOT_FOUND" ? null : materialId,
  );
}

function methodNotAllowedResponse(request: Request, requestId: string): Response {
  if (request.method === "HEAD") {
    return new Response(null, { status: 405, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId, "X-Error-Code": "METHOD_NOT_ALLOWED" } });
  }
  return materialErrorResponse(new MaterialApiFailure("METHOD_NOT_ALLOWED", "请求方法不支持", 405), requestId);
}

export async function handleMaterialMasterApi(request: Request, dependencies: MaterialApiDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const route = routeFor(url.pathname);
  const routeCode = route?.code === "MATERIAL_DRAFT_LIST" && request.method === "POST"
    ? "MATERIAL_DRAFT_CREATE"
    : route?.code;
  const now = dependencies.clock?.() ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const auditRoute = routeCode ?? "MATERIAL_DRAFT_LIST";
  let user: MaterialApiUser | null = null;
  let companion: MaterialApiTransactionCompanion | undefined;
  try {
    user = await dependencies.currentUser(request);
    if (!user) throw new MaterialApiFailure("AUTH_REQUIRED", "请先登录", 401);
    if (!route) throw new MaterialApiFailure("NOT_FOUND", "接口不存在", 404);
    if (!route.supportedMethods.includes(request.method)) {
      await writeMaterialAudit(dependencies.database, {
        username: user.username,
        routeCode: routeCode ?? route.code,
        requestId,
        result: "failed",
        errorCode: "METHOD_NOT_ALLOWED",
        materialId: route.materialId,
        nowSeconds,
      });
      return methodNotAllowedResponse(request, requestId);
    }
    const permission = route.permission(request.method);
    if (!dependencies.userCan(user, permission)) throw new MaterialApiFailure("FORBIDDEN", "当前账号没有此操作权限", 403, [], route.materialId);
    if (request.method === "POST" && user.must_change_password) {
      throw new MaterialApiFailure("PASSWORD_CHANGE_REQUIRED", "请先修改临时密码", 403, [], route.materialId);
    }

    const repository = createD1MaterialMasterRepository(dependencies.database);
    const validationService = createMaterialValidationService(
      createD1MaterialValidationRepository(
        dependencies.database as unknown as MaterialValidationD1Database,
      ),
    );
    const clock = dependencies.clock ?? (() => new Date());
    const queryService = createMaterialMasterQueryService(dependencies.database, repository, validationService, clock);

    if (request.method === "GET" && routeCode === "MATERIAL_DRAFT_LIST") {
      const allowed = new Set(["page", "page_size", "material_status", "category_id", "source_type", "keyword", "created_by", "created_from", "created_to"]);
      const unknown = [...url.searchParams.keys()].find((key) => !allowed.has(key));
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const status = url.searchParams.get("material_status") ?? "DRAFT";
      if (!STATUSES.has(status)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "material_status 无效", 400);
      const sourceType = url.searchParams.get("source_type") ?? undefined;
      if (sourceType && !SOURCE_TYPES.has(sourceType)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "source_type 无效", 400);
      const fromRaw = url.searchParams.get("created_from");
      const toRaw = url.searchParams.get("created_to");
      const createdFrom = fromRaw ? dateBoundary(fromRaw, "created_from") : undefined;
      const createdToExclusive = toRaw ? dateBoundary(toRaw, "created_to", true) : undefined;
      if (createdFrom && createdToExclusive && createdFrom >= createdToExclusive) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "created_from 不能晚于 created_to", 400);
      const result = await queryService.listDrafts({
        page: queryInteger(url, "page", 1, 1_000_000),
        pageSize: queryInteger(url, "page_size", 20, 100),
        materialStatus: status,
        categoryId: url.searchParams.has("category_id") ? positiveInteger(Number(url.searchParams.get("category_id")), "category_id") : undefined,
        sourceType,
        keyword: url.searchParams.has("keyword") ? optionalString(url.searchParams.get("keyword"), "keyword", 100, true) : undefined,
        createdBy: url.searchParams.has("created_by") ? optionalString(url.searchParams.get("created_by"), "created_by", 32, true) : undefined,
        createdFrom,
        createdToExclusive,
      });
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", nowSeconds });
      return materialJsonResponse({ ...result, request_id: requestId }, 200, requestId);
    }

    if (request.method === "GET" && routeCode === "MATERIAL_DRAFT_DETAIL" && route.materialId) {
      const allowed = new Set(["version_page", "version_page_size", "change_log_page", "change_log_page_size"]);
      const unknown = [...url.searchParams.keys()].find((key) => !allowed.has(key));
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const detail = await queryService.getDraftDetail(route.materialId, {
        versionPage: queryInteger(url, "version_page", 1, 1_000_000),
        versionPageSize: queryInteger(url, "version_page_size", 50, 100),
        changeLogPage: queryInteger(url, "change_log_page", 1, 1_000_000),
        changeLogPageSize: queryInteger(url, "change_log_page_size", 50, 100),
      });
      if (!detail) throw new MaterialApiFailure("MATERIAL_NOT_FOUND", "物料草稿不存在", 404, [], route.materialId);
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", materialId: route.materialId, nowSeconds });
      return materialJsonResponse({ data: detail, request_id: requestId }, 200, requestId);
    }

    assertMaterialCsrf(request);
    const { body, canonicalJson } = await readBoundedJson(request);
    const rawKey = request.headers.get("Idempotency-Key") ?? "";
    const rateLimits = dependencies.rateLimits ?? DEFAULT_MATERIAL_RATE_LIMITS;
    if (!Number.isInteger(rateLimits.attemptsPerMinute) || rateLimits.attemptsPerMinute < 1 || rateLimits.attemptsPerMinute > 60 || !Number.isInteger(rateLimits.newKeysPerMinute) || rateLimits.newKeysPerMinute < 1 || rateLimits.newKeysPerMinute > 20) {
      throw new MaterialApiFailure("INTERNAL_ERROR", "服务端限流配置无效", 500);
    }
    const reservation = await reserveIdempotency(dependencies.database, {
      username: user.username,
      routeCode: routeCode as "MATERIAL_DRAFT_CREATE" | "MATERIAL_DRAFT_APPROVE" | "MATERIAL_DRAFT_REJECT",
      method: "POST",
      routeScope: url.pathname,
      rawKey,
      canonicalJson,
      physicalRequestId: requestId,
      nowSeconds,
      attemptsPerMinute: rateLimits.attemptsPerMinute,
      newKeysPerMinute: rateLimits.newKeysPerMinute,
    });
    if (reservation.kind === "replay") return renderStoredResponse(reservation, requestId);
    companion = reservation.companion;

    if ((routeCode === "MATERIAL_DRAFT_APPROVE" || routeCode === "MATERIAL_DRAFT_REJECT") && route.materialId) {
      const creator = await queryService.getDraftCreatedBy(route.materialId);
      if (!creator) throw new MaterialApiFailure("MATERIAL_NOT_FOUND", "物料草稿不存在", 404);
      if (creator === user.username) {
        throw new MaterialApiFailure("SELF_REVIEW_FORBIDDEN", "禁止审核自己创建的物料草稿", 403, [], route.materialId);
      }
    }

    const draftService = createMaterialDraftService({ repository, validationService, clock });
    const reviewService = createMaterialReviewService({ repository, validationService, clock });
    if (routeCode === "MATERIAL_DRAFT_CREATE") {
      await draftService.createDraft(createCommand(body, user, companion));
    } else if (routeCode === "MATERIAL_DRAFT_APPROVE" && route.materialId) {
      await reviewService.approveDraft(reviewCommand(body, user, companion, route.materialId, true));
    } else if (routeCode === "MATERIAL_DRAFT_REJECT" && route.materialId) {
      await reviewService.rejectDraft(reviewCommand(body, user, companion, route.materialId, false));
    } else {
      throw new MaterialApiFailure("NOT_FOUND", "接口不存在", 404);
    }
    const completed = await readCompletedIdempotency(dependencies.database, companion.idempotencyRecordId);
    if (!completed) throw new MaterialApiFailure("INTERNAL_ERROR", "幂等结果未能原子完成", 500, [], route.materialId);
    const response = renderStoredResponse(completed, requestId);
    response.headers.delete("Idempotency-Replayed");
    return response;
  } catch (error) {
    let failure = error instanceof MaterialApiFailure
      ? error
      : error instanceof MaterialMasterServiceError
        ? mapServiceError(error, route?.materialId ?? null)
        : new MaterialApiFailure("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500, [], route?.materialId ?? null);
    if (companion) {
      const completed = await readCompletedIdempotency(dependencies.database, companion.idempotencyRecordId).catch(() => null);
      if (completed) return renderStoredResponse(completed, requestId);
      try {
        await completeIdempotentFailure(dependencies.database, companion, failure, nowSeconds);
      } catch {
        failure = new MaterialApiFailure("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500, [], route?.materialId ?? null);
      }
      return materialErrorResponse(failure, requestId, companion.operationId);
    }
    try {
      await writeMaterialAudit(dependencies.database, {
        username: user?.username ?? "",
        routeCode: auditRoute,
        requestId,
        result: "failed",
        errorCode: failure.code,
        materialId: failure.materialId,
        nowSeconds,
      });
    } catch {
      if (failure.status < 500) failure = new MaterialApiFailure("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500);
    }
    const response = materialErrorResponse(failure, requestId);
    if (failure.code === "RATE_LIMITED") response.headers.set("Retry-After", String(60 - (nowSeconds % 60)));
    return response;
  }
}
