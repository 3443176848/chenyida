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
import { createMaterialMasterQueryService, MaterialQueryError } from "./query-service.ts";
import { createMaterialReferenceQueryService, MaterialReferenceQueryError } from "./reference-query-service.ts";
import {
  handleMaterialImportApi,
  isMaterialImportPath,
  type MaterialImportObjectStore,
} from "../material-import/index.ts";
import {
  assertMaterialCsrf,
  completeIdempotentFailure,
  DEFAULT_MATERIAL_RATE_LIMITS,
  MaterialApiFailure,
  materialErrorResponse,
  materialJsonResponse,
  materialReferenceResponse,
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
  | "material.draft.edit_own"
  | "material.draft.edit_any"
  | "material.draft.submit"
  | "material.review.queue"
  | "material.review.approve"
  | "material.review.reject"
  | "material.import.create"
  | "material.import.read"
  | "material.import.cancel"
  | "material.import.parse"
  | "material.import.map"
  | "material.import.read_any";

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
  objectStore?: MaterialImportObjectStore;
  objectPrefix?: string;
  clock?: () => Date;
  rateLimits?: Readonly<{ attemptsPerMinute: number; newKeysPerMinute: number }>;
}>;

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  "actor", "context", "request_id", "created_by", "updated_by", "last_modified_by",
  "submitted_by", "submitted_at", "approved_by", "approved_at", "created_at", "updated_at",
  "reviewed_by", "internal_material_code", "material_status", "version", "attribute_id",
]);
const SOURCE_TYPES = new Set(["MANUAL", "LEGACY_D1", "LEGACY_SQLITE", "GOVERNANCE_TEMPLATE", "API", "SUPPLIER_IMPORT", "AI", "SYSTEM"]);
const STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "ACTIVE", "FROZEN", "INACTIVE"]);
const PUBLIC_SOURCE_TYPES = new Set(["MANUAL"]);

function routeFor(path: string): MaterialRoute | null {
  if (path === "/api/material-master/categories") {
    return { code: "MATERIAL_CATEGORY_LIST", materialId: null, supportedMethods: ["GET"], permission: () => "material.read" };
  }
  const categorySchema = path.match(/^\/api\/material-master\/categories\/([1-9][0-9]*)\/schema$/);
  if (categorySchema) {
    const id = Number(categorySchema[1]);
    if (!Number.isSafeInteger(id)) return null;
    return { code: "MATERIAL_CATEGORY_SCHEMA", materialId: id, supportedMethods: ["GET"], permission: () => "material.read" };
  }
  if (path === "/api/material-master/materials") {
    return { code: "MATERIAL_LIST", materialId: null, supportedMethods: ["GET"], permission: () => "material.read" };
  }
  const materialHistory = path.match(/^\/api\/material-master\/materials\/([1-9][0-9]*)\/(versions|change-logs)$/);
  if (materialHistory) {
    const id = Number(materialHistory[1]);
    if (!Number.isSafeInteger(id)) return null;
    return { code: materialHistory[2] === "versions" ? "MATERIAL_VERSIONS" : "MATERIAL_CHANGE_LOGS", materialId: id, supportedMethods: ["GET"], permission: () => "material.read" };
  }
  const materialDetail = path.match(/^\/api\/material-master\/materials\/([1-9][0-9]*)$/);
  if (materialDetail) {
    const id = Number(materialDetail[1]);
    if (!Number.isSafeInteger(id)) return null;
    return { code: "MATERIAL_DETAIL", materialId: id, supportedMethods: ["GET"], permission: () => "material.read" };
  }
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
    return {
      code: "MATERIAL_DRAFT_DETAIL", materialId: id, supportedMethods: ["GET", "PATCH"],
      permission: (method) => method === "PATCH" ? "material.draft.edit_own" : "material.read",
    };
  }
  const submit = path.match(/^\/api\/material-master\/drafts\/([1-9][0-9]*)\/submit$/);
  if (submit) {
    const id = Number(submit[1]);
    if (!Number.isSafeInteger(id)) return null;
    return { code: "MATERIAL_DRAFT_SUBMIT", materialId: id, supportedMethods: ["POST"], permission: () => "material.draft.submit" };
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
  if (path === "/api/material-master/review-queue") {
    return { code: "MATERIAL_REVIEW_QUEUE", materialId: null, supportedMethods: ["GET"], permission: () => "material.review.queue" };
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

function editCommand(
  body: Record<string, unknown>,
  user: MaterialApiUser,
  companion: MaterialApiTransactionCompanion,
  materialId: number,
) {
  assertKeys(body, ["expected_version", "basic_fields", "category_id", "attributes"], "请求正文");
  assertNoIdentityFields(body);
  const basic = objectValue(body.basic_fields, "basic_fields");
  assertKeys(basic, [
    "standard_name", "unit", "brand", "manufacturer", "manufacturer_part_number",
    "procurement_type", "inventory_type", "lot_control_required", "shelf_life_days",
    "inspection_type", "environmental_requirement",
  ], "basic_fields");
  const parsed = createCommand({
    category_id: body.category_id,
    basic_fields: { ...basic, source_type: "MANUAL", source_ref: `immutable:${materialId}` },
    attributes: body.attributes,
  }, user, companion);
  return {
    material_id: materialId,
    expected_version: positiveInteger(body.expected_version, "expected_version"),
    category_id: parsed.basic_fields.category_id,
    basic_fields: {
      standard_name: parsed.basic_fields.standard_name,
      unit: parsed.basic_fields.unit,
      brand: parsed.basic_fields.brand,
      manufacturer: parsed.basic_fields.manufacturer,
      manufacturer_part_number: parsed.basic_fields.manufacturer_part_number,
      procurement_type: parsed.basic_fields.procurement_type,
      inventory_type: parsed.basic_fields.inventory_type,
      lot_control_required: parsed.basic_fields.lot_control_required,
      shelf_life_days: parsed.basic_fields.shelf_life_days,
      inspection_type: parsed.basic_fields.inspection_type,
      environmental_requirement: parsed.basic_fields.environmental_requirement,
    },
    attributes: parsed.attributes,
    context: parsed.context,
  };
}

function submitCommand(
  body: Record<string, unknown>,
  user: MaterialApiUser,
  companion: MaterialApiTransactionCompanion,
  materialId: number,
) {
  assertNoIdentityFields(body);
  assertKeys(body, ["expected_version", "submit_comment"], "请求正文");
  return {
    material_id: materialId,
    expected_version: positiveInteger(body.expected_version, "expected_version"),
    submit_comment: optionalString(body.submit_comment, "submit_comment", 1000),
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
    false,
  );
  if (!approve && !reason) {
    throw new MaterialApiFailure("REVIEW_REASON_REQUIRED", "驳回原因必填", 400, [], materialId);
  }
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
    MATERIAL_DRAFT_NOT_REVIEWABLE: ["MATERIAL_NOT_REVIEWABLE", "当前物料状态不允许审核", 409],
    MATERIAL_DRAFT_NOT_EDITABLE: ["DRAFT_NOT_EDITABLE", "当前物料状态不允许编辑", 409],
    MATERIAL_DRAFT_NOT_CHANGED: ["DRAFT_NOT_CHANGED", "草稿没有实质变化", 409],
    MATERIAL_DRAFT_NOT_SUBMITTABLE: ["MATERIAL_NOT_SUBMITTABLE", "当前物料状态不允许提交审核", 409],
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
    return new Response(null, { status: 405, headers: { "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Request-Id": requestId, "X-Error-Code": "METHOD_NOT_ALLOWED" } });
  }
  return materialErrorResponse(new MaterialApiFailure("METHOD_NOT_ALLOWED", "请求方法不支持", 405), requestId);
}

export async function handleMaterialMasterApi(request: Request, dependencies: MaterialApiDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  if (isMaterialImportPath(url.pathname)) {
    return handleMaterialImportApi(request, dependencies);
  }
  const route = routeFor(url.pathname);
  const routeCode = route?.code === "MATERIAL_DRAFT_LIST" && request.method === "POST"
    ? "MATERIAL_DRAFT_CREATE"
    : route?.code === "MATERIAL_DRAFT_DETAIL" && request.method === "PATCH"
      ? "MATERIAL_DRAFT_EDIT"
      : route?.code;
  const now = dependencies.clock?.() ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const auditRoute = routeCode ?? "MATERIAL_DRAFT_LIST";
  const auditMaterialId = routeCode === "MATERIAL_CATEGORY_SCHEMA" ? null : route?.materialId ?? null;
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
        materialId: auditMaterialId,
        nowSeconds,
      });
      return methodNotAllowedResponse(request, requestId);
    }
    const permission = route.permission(request.method);
    const allowed = routeCode === "MATERIAL_DRAFT_EDIT"
      ? dependencies.userCan(user, "material.draft.edit_own") || dependencies.userCan(user, "material.draft.edit_any")
      : dependencies.userCan(user, permission);
    if (!allowed) throw new MaterialApiFailure("FORBIDDEN", "当前账号没有此操作权限", 403, [], auditMaterialId);
    if (request.method !== "GET" && user.must_change_password) {
      throw new MaterialApiFailure("PASSWORD_CHANGE_REQUIRED", "请先修改临时密码", 403, [], route.materialId);
    }

    const repository = createD1MaterialMasterRepository(dependencies.database);
    const validationService = createMaterialValidationService(
      createD1MaterialValidationRepository(
        dependencies.database as unknown as MaterialValidationD1Database,
      ),
    );
    const clock = dependencies.clock ?? (() => new Date());
    const queryService = createMaterialMasterQueryService(dependencies.database, repository, validationService, {
      username: user.username,
      canEditAny: dependencies.userCan(user, "material.draft.edit_any"),
      canReviewQueue: dependencies.userCan(user, "material.review.queue"),
    }, clock);
    const referenceService = createMaterialReferenceQueryService(dependencies.database);

    if (request.method === "GET" && routeCode === "MATERIAL_CATEGORY_LIST") {
      const allowed = new Set(["view"]);
      const unknown = [...url.searchParams.keys()].find((key) => !allowed.has(key));
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const view = url.searchParams.get("view") ?? "tree";
      if (view !== "tree" && view !== "flat") throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "view 无效", 400);
      const result = await referenceService.listCategories(view);
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", nowSeconds });
      return materialReferenceResponse({ data: result.data, request_id: requestId }, requestId, result.etag, request.headers.get("If-None-Match") === result.etag);
    }

    if (request.method === "GET" && routeCode === "MATERIAL_CATEGORY_SCHEMA" && route.materialId) {
      if ([...url.searchParams.keys()].length > 0) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "Schema 接口不接受查询参数", 400);
      const result = await referenceService.getCategorySchema(route.materialId);
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", materialId: null, nowSeconds });
      return materialReferenceResponse({ data: result.data, request_id: requestId }, requestId, result.etag, request.headers.get("If-None-Match") === result.etag);
    }

    if (request.method === "GET" && routeCode === "MATERIAL_LIST") {
      const allowed = new Set(["page", "page_size", "keyword", "material_status", "category_id", "category_path", "source_type", "created_by", "created_from", "created_to", "updated_from", "updated_to", "sort"]);
      const unknown = [...url.searchParams.keys()].find((key) => !allowed.has(key));
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const status = url.searchParams.get("material_status") ?? undefined;
      if (status && !STATUSES.has(status)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "material_status 无效", 400);
      const sourceType = url.searchParams.get("source_type") ?? undefined;
      if (sourceType && !SOURCE_TYPES.has(sourceType)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "source_type 无效", 400);
      const sort = url.searchParams.get("sort") ?? "updated_at_desc";
      const sorts = new Set(["updated_at_desc", "updated_at_asc", "created_at_desc", "created_at_asc", "standard_name_asc", "standard_name_desc", "material_code_asc", "material_code_desc"]);
      if (!sorts.has(sort)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "sort 无效", 400);
      const boundary = (key: string, nextDay = false) => {
        const raw = url.searchParams.get(key);
        return raw ? dateBoundary(raw, key, nextDay) : undefined;
      };
      const createdFrom = boundary("created_from");
      const createdToExclusive = boundary("created_to", true);
      const updatedFrom = boundary("updated_from");
      const updatedToExclusive = boundary("updated_to", true);
      if ((createdFrom && createdToExclusive && createdFrom >= createdToExclusive) || (updatedFrom && updatedToExclusive && updatedFrom >= updatedToExclusive)) {
        throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "日期范围起点不能晚于终点", 400);
      }
      const result = await queryService.listMaterials({
        page: queryInteger(url, "page", 1, 1_000_000), pageSize: queryInteger(url, "page_size", 20, 100),
        materialStatus: status, categoryId: url.searchParams.has("category_id") ? positiveInteger(Number(url.searchParams.get("category_id")), "category_id") : undefined,
        categoryPath: url.searchParams.has("category_path") ? optionalString(url.searchParams.get("category_path"), "category_path", 260, true) : undefined,
        sourceType, keyword: url.searchParams.has("keyword") ? optionalString(url.searchParams.get("keyword"), "keyword", 100, true) : undefined,
        createdBy: url.searchParams.has("created_by") ? optionalString(url.searchParams.get("created_by"), "created_by", 64, true) : undefined,
        createdFrom, createdToExclusive, updatedFrom, updatedToExclusive,
        sort: sort as Parameters<typeof queryService.listMaterials>[0]["sort"],
      });
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", nowSeconds });
      return materialJsonResponse({ ...result, request_id: requestId }, 200, requestId);
    }

    if (request.method === "GET" && routeCode === "MATERIAL_DETAIL" && route.materialId) {
      if ([...url.searchParams.keys()].length > 0) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "详情接口不接受查询参数", 400);
      const detail = await queryService.getMaterialDetail(route.materialId);
      if (!detail) throw new MaterialApiFailure("MATERIAL_NOT_FOUND", "物料不存在", 404);
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", materialId: route.materialId, nowSeconds });
      return materialJsonResponse({ data: detail, request_id: requestId }, 200, requestId);
    }

    if (request.method === "GET" && (routeCode === "MATERIAL_VERSIONS" || routeCode === "MATERIAL_CHANGE_LOGS") && route.materialId) {
      const unknown = [...url.searchParams.keys()].find((key) => key !== "page" && key !== "page_size");
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const historyQuery = { page: queryInteger(url, "page", 1, 1_000_000), pageSize: queryInteger(url, "page_size", 20, 50) };
      const result = routeCode === "MATERIAL_VERSIONS"
        ? await queryService.listMaterialVersions(route.materialId, historyQuery)
        : await queryService.listMaterialChangeLogs(route.materialId, historyQuery);
      if (!result) throw new MaterialApiFailure("MATERIAL_NOT_FOUND", "物料不存在", 404);
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", materialId: route.materialId, nowSeconds });
      return materialJsonResponse({ ...result, request_id: requestId }, 200, requestId);
    }

    if (request.method === "GET" && routeCode === "MATERIAL_DRAFT_LIST") {
      const allowed = new Set(["page", "page_size", "material_status", "category_id", "source_type", "keyword", "created_by", "created_from", "created_to"]);
      const unknown = [...url.searchParams.keys()].find((key) => !allowed.has(key));
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const status = url.searchParams.get("material_status") ?? "DRAFT";
      if (status !== "DRAFT" && status !== "PENDING_REVIEW") throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "material_status 只允许 DRAFT 或 PENDING_REVIEW", 400);
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
        materialStatus: status as "DRAFT" | "PENDING_REVIEW",
        categoryId: url.searchParams.has("category_id") ? positiveInteger(Number(url.searchParams.get("category_id")), "category_id") : undefined,
        sourceType,
        keyword: url.searchParams.has("keyword") ? optionalString(url.searchParams.get("keyword"), "keyword", 100, true) : undefined,
        createdBy: url.searchParams.has("created_by") ? optionalString(url.searchParams.get("created_by"), "created_by", 32, true) : undefined,
        createdFrom,
        createdToExclusive,
      });
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", nowSeconds });
      const response = materialJsonResponse({ ...result, request_id: requestId }, 200, requestId);
      response.headers.set("Deprecation", "true");
      response.headers.set("Link", "</api/material-master/materials>; rel=\"successor-version\"");
      return response;
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
      const response = materialJsonResponse({ data: detail, request_id: requestId }, 200, requestId);
      response.headers.set("Deprecation", "true");
      response.headers.set("Link", "</api/material-master/materials>; rel=\"successor-version\"");
      return response;
    }

    if (request.method === "GET" && routeCode === "MATERIAL_REVIEW_QUEUE") {
      const allowedQuery = new Set(["page", "page_size", "category_id", "source_type", "creator", "submitted_from", "submitted_to", "keyword", "sort"]);
      const unknown = [...url.searchParams.keys()].find((key) => !allowedQuery.has(key));
      if (unknown) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", `未知查询参数：${unknown}`, 400);
      const sourceType = url.searchParams.get("source_type") ?? undefined;
      if (sourceType && !SOURCE_TYPES.has(sourceType)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "source_type 无效", 400);
      const sort = url.searchParams.get("sort") ?? "submitted_at_desc";
      const sorts = new Set(["submitted_at_desc", "submitted_at_asc", "standard_name_asc", "standard_name_desc"]);
      if (!sorts.has(sort)) throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "sort 无效", 400);
      const fromRaw = url.searchParams.get("submitted_from");
      const toRaw = url.searchParams.get("submitted_to");
      const submittedFrom = fromRaw ? dateBoundary(fromRaw, "submitted_from") : undefined;
      const submittedToExclusive = toRaw ? dateBoundary(toRaw, "submitted_to", true) : undefined;
      if (submittedFrom && submittedToExclusive && submittedFrom >= submittedToExclusive) {
        throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "submitted_from 不能晚于 submitted_to", 400);
      }
      const result = await queryService.listReviewQueue({
        page: queryInteger(url, "page", 1, 1_000_000),
        pageSize: queryInteger(url, "page_size", 20, 100),
        categoryId: url.searchParams.has("category_id") ? positiveInteger(Number(url.searchParams.get("category_id")), "category_id") : undefined,
        sourceType,
        creator: url.searchParams.has("creator") ? optionalString(url.searchParams.get("creator"), "creator", 64, true) : undefined,
        submittedFrom,
        submittedToExclusive,
        keyword: url.searchParams.has("keyword") ? optionalString(url.searchParams.get("keyword"), "keyword", 100, true) : undefined,
        sort: sort as "submitted_at_desc" | "submitted_at_asc" | "standard_name_asc" | "standard_name_desc",
      });
      await writeMaterialAudit(dependencies.database, { username: user.username, routeCode, requestId, result: "success", nowSeconds });
      return materialJsonResponse({ ...result, request_id: requestId }, 200, requestId);
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
      routeCode: routeCode as MaterialApiTransactionCompanion["routeCode"],
      method: request.method as "POST" | "PATCH",
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

    if ((routeCode === "MATERIAL_DRAFT_EDIT" || routeCode === "MATERIAL_DRAFT_SUBMIT" || routeCode === "MATERIAL_DRAFT_APPROVE" || routeCode === "MATERIAL_DRAFT_REJECT") && route.materialId) {
      const responsibility = await queryService.getReviewResponsibility(route.materialId);
      if (!responsibility) throw new MaterialApiFailure("MATERIAL_NOT_FOUND", "物料草稿不存在", 404);
      if (routeCode === "MATERIAL_DRAFT_EDIT" || routeCode === "MATERIAL_DRAFT_SUBMIT") {
        const owns = responsibility.createdBy === user.username;
        if (!owns && !dependencies.userCan(user, "material.draft.edit_any")) {
          throw new MaterialApiFailure("FORBIDDEN", "只能编辑或提交自己创建的草稿", 403, [], route.materialId);
        }
      }
      if ((routeCode === "MATERIAL_DRAFT_APPROVE" || routeCode === "MATERIAL_DRAFT_REJECT") && responsibility.createdBy === user.username) {
        throw new MaterialApiFailure("SELF_REVIEW_FORBIDDEN", "禁止审核自己创建的物料草稿", 403, [], route.materialId);
      }
      if ((routeCode === "MATERIAL_DRAFT_APPROVE" || routeCode === "MATERIAL_DRAFT_REJECT") && responsibility.lastModifiedBy === user.username) {
        throw new MaterialApiFailure("LAST_EDITOR_REVIEW_FORBIDDEN", "禁止审核自己最后修改的物料草稿", 403, [], route.materialId);
      }
    }

    const draftService = createMaterialDraftService({ repository, validationService, clock });
    const reviewService = createMaterialReviewService({ repository, validationService, clock });
    if (routeCode === "MATERIAL_DRAFT_CREATE") {
      await draftService.createDraft(createCommand(body, user, companion));
    } else if (routeCode === "MATERIAL_DRAFT_EDIT" && route.materialId) {
      await draftService.editDraft(editCommand(body, user, companion, route.materialId));
    } else if (routeCode === "MATERIAL_DRAFT_SUBMIT" && route.materialId) {
      await draftService.submitDraft(submitCommand(body, user, companion, route.materialId));
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
        : error instanceof MaterialReferenceQueryError
          ? new MaterialApiFailure(error.code, error.message, error.status, [], auditMaterialId)
        : error instanceof MaterialQueryError
          ? new MaterialApiFailure(
            error.code === "CATEGORY_PATH_INVALID" ? "REQUEST_VALIDATION_FAILED" : "INTERNAL_ERROR",
            error.code === "CATEGORY_PATH_INVALID" ? "category_path 无效" : "系统处理失败，请联系管理员",
            error.code === "CATEGORY_PATH_INVALID" ? 400 : 500,
            [], auditMaterialId,
          )
        : error instanceof MaterialMasterServiceError
        ? mapServiceError(error, auditMaterialId)
        : new MaterialApiFailure("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500, [], auditMaterialId);
    if (companion) {
      const completed = await readCompletedIdempotency(dependencies.database, companion.idempotencyRecordId).catch(() => null);
      if (completed) return renderStoredResponse(completed, requestId);
      try {
        await completeIdempotentFailure(dependencies.database, companion, failure, nowSeconds);
      } catch {
        failure = new MaterialApiFailure("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500, [], auditMaterialId);
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
