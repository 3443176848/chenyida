import type { MaterialMasterD1Database } from "../material-master/index.ts";
import {
  assertMaterialCsrf,
  MaterialApiFailure,
  readBoundedJson,
  type MaterialApiUser,
} from "../material-api/security.ts";
import type { MaterialImportObjectStore } from "./object-store.ts";
import {
  D1MaterialImportReadRateLimiter,
  MaterialImportMappingTargetCatalogService,
  type MaterialImportReadRateLimiter,
} from "./mapping-target-catalog-service.ts";
import {
  confirmMaterialImportMapping,
  getMaterialImportMapping,
  listMaterialImportRows,
  listMaterialImportSheets,
  previewMaterialImportMapping,
  replaceMaterialImportMapping,
  type MaterialImportMappingDraftInput,
} from "./mapping-service.ts";
import { MaterialImportParserServiceError, queueMaterialImportParse } from "./parser-service.ts";
import {
  getMaterialImportNormalization,
  getMaterialImportNormalizedRow,
  listMaterialImportNormalizationIssues,
  listMaterialImportNormalizedRows,
  MaterialImportNormalizationServiceError,
  startMaterialImportNormalization,
} from "./normalization-service.ts";
import {
  approveMaterialImportNormalization,
  commitMaterialImportDraftGeneration,
  dryRunMaterialImportDraftGeneration,
  inspectMaterialImportDraftGeneration,
  reportMaterialImportDraftGeneration,
} from "./draft-generation-service.ts";
import {
  cancelMaterialImportBatch,
  createMaterialImportBatch,
  getMaterialImportBatch,
  listMaterialImportBatches,
  listMaterialImportEvents,
  MaterialImportServiceError,
  uploadMaterialImportFile,
  type MaterialImportServiceResult,
} from "./service.ts";

type ImportPermission =
  | "material.import.create"
  | "material.import.read"
  | "material.import.cancel"
  | "material.import.parse"
  | "material.import.map"
  | "material.import.normalize"
  | "material.import.commit"
  | "material.import.read_any";

export type MaterialImportApiDependencies = Readonly<{
  database: MaterialMasterD1Database;
  objectStore?: MaterialImportObjectStore;
  objectPrefix?: string;
  importReadRateLimit?: number;
  importNormalizationWriteRateLimit?: number;
  importReadRateLimiter?: MaterialImportReadRateLimiter;
  currentUser(request: Request): Promise<MaterialApiUser | null>;
  userCan(user: MaterialApiUser, permission: ImportPermission): boolean;
  clock?: () => Date;
}>;

const unavailableStore: MaterialImportObjectStore = {
  async putIfAbsent() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
  async head() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
  async open() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
  async delete() { throw new Error("OBJECT_STORE_UNAVAILABLE"); },
};

function response(result: MaterialImportServiceResult, requestId: string): Response {
  const payload = { request_id: requestId, ...result.payload };
  const output = new Response(JSON.stringify(payload), {
    status: result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "X-Request-Id": requestId,
    },
  });
  if (result.replayed) output.headers.set("Idempotency-Replayed", "true");
  return output;
}

function errorResponse(error: MaterialImportServiceError, requestId: string): Response {
  const details = error.code === "IMPORT_MAPPING_TARGET_CATALOG_CHANGED" ? [{ restart_from_first_page: true }] : [];
  const body: Record<string, unknown> = { code: error.code, message: error.message, request_id: requestId, details };
  if (error.expectedVersion !== undefined) body.expected_version = error.expectedVersion;
  return new Response(JSON.stringify({ request_id: requestId, error: body }), {
    status: error.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "X-Request-Id": requestId,
      "X-Error-Code": error.code,
    },
  });
}

function integerPath(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return parsed;
}

function queryLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new MaterialImportServiceError("INVALID_REQUEST", "limit 必须是正整数", 400);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 100) throw new MaterialImportServiceError("INVALID_REQUEST", "limit 最大为 100", 400);
  return parsed;
}

function assertQueryKeys(url: URL, allowed: readonly string[]): void {
  const set = new Set(allowed);
  const unknown = [...url.searchParams.keys()].find((key) => !set.has(key));
  if (unknown) throw new MaterialImportServiceError("INVALID_REQUEST", `未知查询参数：${unknown}`, 400);
}

function catalogQuery(url: URL): Readonly<{ namespace?: "BASIC" | "ATTRIBUTE" | "SPECIAL"; q?: string; limit: number; cursor?: string }> {
  const allowed = new Set(["namespace", "q", "limit", "cursor"]);
  const unknown = [...url.searchParams.keys()].find((key) => !allowed.has(key));
  if (unknown) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", `未知查询参数：${unknown}`, 400);
  for (const key of ["namespace", "q", "limit", "cursor"]) if (url.searchParams.getAll(key).length > 1) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", `查询参数 ${key} 不得重复`, 400);
  const namespace = url.searchParams.get("namespace") ?? undefined;
  if (namespace && !new Set(["BASIC", "ATTRIBUTE", "SPECIAL"]).has(namespace)) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "namespace 无效", 400);
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null && !/^[1-9][0-9]*$/.test(rawLimit)) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "limit 必须是正整数", 400);
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "limit 必须在 1 到 100 之间", 400);
  const q = url.searchParams.get("q") ?? undefined;
  if (q !== undefined && q.length > 256) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "q 无效", 400);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > 1024)) throw new MaterialImportServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  return { namespace: namespace as "BASIC" | "ATTRIBUTE" | "SPECIAL" | undefined, q, limit, cursor };
}

function normalizationLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "limit 必须是正整数", 400);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 100) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", "limit 必须在 1 到 100 之间", 400);
  return value;
}

function assertNormalizationQuery(url: URL, allowed: readonly string[]): void {
  const accepted = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (!accepted.has(key) || url.searchParams.getAll(key).length > 1) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_QUERY_INVALID", `查询参数 ${key} 无效`, 400);
  }
}

function assertObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !set.has(key));
  if (unknown) throw new MaterialImportServiceError("INVALID_REQUEST", `请求包含未声明字段：${unknown}`, 400);
}

async function writeFailureAudit(
  dependencies: MaterialImportApiDependencies,
  user: MaterialApiUser | null,
  requestId: string,
  path: string,
  error: MaterialImportServiceError,
): Promise<void> {
  if (!user) return;
  const timestamp = (dependencies.clock ?? (() => new Date()))().toISOString();
  const catalog = /^\/api\/material-master\/import-batches\/[1-9][0-9]*\/mapping-targets$/.test(path);
  const normalization = /^\/api\/material-master\/import-batches\/[1-9][0-9]*\/(?:normalize|normalization(?:\/approve)?|normalized-rows(?:\/[1-9][0-9]*)?|normalization-issues|draft-generation|drafts)$/.test(path);
  const draftGeneration = /\/(?:normalization\/approve|draft-generation|drafts)$/.test(path);
  const routeCode = catalog ? "MATERIAL_IMPORT_MAPPING_TARGET_CATALOG" : draftGeneration ? "MATERIAL_IMPORT_DRAFT_GENERATION" : normalization ? "MATERIAL_IMPORT_NORMALIZATION" : "MATERIAL_IMPORT_BATCH";
  try {
    await dependencies.database.prepare(`
      INSERT INTO audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until,created_at)
      VALUES(?,'MATERIAL_IMPORT_API_REJECTED',?,?,'failed',?,?,?,?)
    `).bind(user.username, path.slice(0, 255), requestId, routeCode, error.code, Math.floor(new Date(timestamp).getTime() / 1000) + 1095 * 86400, timestamp).run();
  } catch { /* Security audit failures must not expose internal storage errors. */ }
}

async function writeNormalizationReadAudit(
  dependencies: MaterialImportApiDependencies,
  username: string,
  requestId: string,
  path: string,
): Promise<void> {
  const now = (dependencies.clock ?? (() => new Date()))();
  await dependencies.database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES(?,'MATERIAL_IMPORT_NORMALIZATION_READ',?,?,'success','MATERIAL_IMPORT_NORMALIZATION_READ',?,?)")
    .bind(username, path.slice(0, 255), requestId, Math.floor(now.getTime() / 1000) + 1_095 * 86_400, now.toISOString()).run();
}

export function isMaterialImportPath(path: string): boolean {
  return path === "/api/material-master/import-batches" || path.startsWith("/api/material-master/import-batches/");
}

export async function handleMaterialImportApi(request: Request, dependencies: MaterialImportApiDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const isMappingTargetsRequest = /^\/api\/material-master\/import-batches\/[1-9][0-9]*\/mapping-targets$/.test(url.pathname);
  const isNormalizationRequest = /^\/api\/material-master\/import-batches\/[1-9][0-9]*\/(?:normalize|normalization(?:\/approve)?|normalized-rows(?:\/[1-9][0-9]*)?|normalization-issues|draft-generation|drafts)$/.test(url.pathname);
  let user: MaterialApiUser | null = null;
  try {
    user = await dependencies.currentUser(request);
    if (!user) throw new MaterialImportServiceError(isMappingTargetsRequest || isNormalizationRequest ? "AUTH_REQUIRED" : "AUTHENTICATION_REQUIRED", "请先登录", 401);
    if (user.must_change_password) throw new MaterialImportServiceError(isMappingTargetsRequest || isNormalizationRequest ? "FORBIDDEN" : "PERMISSION_DENIED", "请先修改临时密码", 403);
    const root = url.pathname === "/api/material-master/import-batches";
    const detailMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)$/);
    const fileMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/file$/);
    const eventsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/events$/);
    const cancelMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/cancel$/);
    const parseMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/parse$/);
    const sheetsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/sheets$/);
    const rowsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/rows$/);
    const mappingMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/mapping$/);
    const mappingTargetsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/mapping-targets$/);
    const previewMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/mapping\/preview$/);
    const confirmMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/mapping\/confirm$/);
    const normalizeMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/normalize$/);
    const normalizationMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/normalization$/);
    const normalizedRowsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/normalized-rows$/);
    const normalizedRowMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/normalized-rows\/([1-9][0-9]*)$/);
    const normalizationIssuesMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/normalization-issues$/);
    const normalizationApproveMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/normalization\/approve$/);
    const draftGenerationMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/draft-generation$/);
    const draftsMatch = url.pathname.match(/^\/api\/material-master\/import-batches\/([1-9][0-9]*)\/drafts$/);
    if (!root && !detailMatch && !fileMatch && !eventsMatch && !cancelMatch && !parseMatch && !sheetsMatch && !rowsMatch && !mappingMatch && !mappingTargetsMatch && !previewMatch && !confirmMatch && !normalizeMatch && !normalizationMatch && !normalizedRowsMatch && !normalizedRowMatch && !normalizationIssuesMatch && !normalizationApproveMatch && !draftGenerationMatch && !draftsMatch) throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入接口不存在", 404);
    const permission: ImportPermission = root && request.method === "POST"
      ? "material.import.create"
      : fileMatch
        ? "material.import.create"
        : cancelMatch
          ? "material.import.cancel"
          : normalizationApproveMatch || draftsMatch
            ? "material.import.commit"
            : parseMatch
              ? "material.import.parse"
              : (mappingMatch && request.method !== "GET") || previewMatch || confirmMatch
                ? "material.import.map"
                : "material.import.read";
    if (!normalizeMatch && !dependencies.userCan(user, permission)) throw new MaterialImportServiceError(mappingTargetsMatch || isNormalizationRequest ? "FORBIDDEN" : "PERMISSION_DENIED", "没有执行此操作的权限", 403);
    const canReadAny = dependencies.userCan(user, "material.import.read_any");
    const normalizationRateLimiter = dependencies.importReadRateLimiter ?? new D1MaterialImportReadRateLimiter(dependencies.database);
    const consumeNormalizationRateLimit = (routeCode: string, limit: number) => () => normalizationRateLimiter.consume({ username: user.username, limit, now: (dependencies.clock ?? (() => new Date()))(), routeCode });
    const serviceDependencies = {
      database: dependencies.database,
      objectStore: dependencies.objectStore ?? unavailableStore,
      objectPrefix: dependencies.objectPrefix,
      clock: dependencies.clock,
    };
    let result: MaterialImportServiceResult;
    if (root && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["source_kind", "retry_of_batch_id"]);
      result = await createMaterialImportBatch(serviceDependencies, {
        user,
        rawKey: request.headers.get("Idempotency-Key") ?? "",
        requestId,
        sourceKind: body.source_kind,
        retryOfBatchId: body.retry_of_batch_id,
        canReadAny,
      });
    } else if (root && request.method === "GET") {
      assertQueryKeys(url, ["status", "source_kind", "created_by_me", "cursor", "limit", "sort"]);
      const status = url.searchParams.get("status") ?? undefined;
      if (status && !new Set(["CREATED", "UPLOAD_PENDING", "FILE_READY", "QUEUED_FOR_PARSING", "PARSING", "PARSED", "AWAITING_MAPPING", "MAPPING_CONFIRMED", "RECONCILIATION_REQUIRED", "FAILED", "CANCELLED"]).has(status)) throw new MaterialImportServiceError("INVALID_REQUEST", "status 无效", 400);
      const sourceKind = url.searchParams.get("source_kind") ?? undefined;
      if (sourceKind && sourceKind !== "XLSX" && sourceKind !== "CSV") throw new MaterialImportServiceError("INVALID_REQUEST", "source_kind 无效", 400);
      const createdByMe = url.searchParams.get("created_by_me");
      if (createdByMe && createdByMe !== "true" && createdByMe !== "false") throw new MaterialImportServiceError("INVALID_REQUEST", "created_by_me 无效", 400);
      const sort = url.searchParams.get("sort") ?? "created_at_desc";
      if (sort !== "created_at_desc" && sort !== "created_at_asc") throw new MaterialImportServiceError("INVALID_REQUEST", "sort 无效", 400);
      result = await listMaterialImportBatches(serviceDependencies, {
        user,
        canReadAny: canReadAny && createdByMe !== "true",
        status,
        sourceKind,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: queryLimit(url),
        sort,
      });
    } else if (detailMatch && request.method === "GET") {
      assertQueryKeys(url, []);
      result = await getMaterialImportBatch(serviceDependencies, { batchId: integerPath(detailMatch[1]), user, canReadAny });
    } else if (eventsMatch && request.method === "GET") {
      assertQueryKeys(url, ["cursor", "limit"]);
      result = await listMaterialImportEvents(serviceDependencies, { batchId: integerPath(eventsMatch[1]), user, canReadAny, cursor: url.searchParams.get("cursor") ?? undefined, limit: queryLimit(url) });
    } else if (fileMatch && request.method === "POST") {
      if (!dependencies.objectStore) throw new MaterialImportServiceError("IMPORT_FILE_STORAGE_FAILED", "对象存储在当前环境不可用", 503);
      assertMaterialCsrf(request);
      result = await uploadMaterialImportFile(serviceDependencies, { request, batchId: integerPath(fileMatch[1]), user, canReadAny, rawKey: request.headers.get("Idempotency-Key") ?? "", requestId });
    } else if (cancelMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "reason_code"]);
      result = await cancelMaterialImportBatch(serviceDependencies, { batchId: integerPath(cancelMatch[1]), user, canReadAny, rawKey: request.headers.get("Idempotency-Key") ?? "", requestId, expectedVersion: body.expected_version, reasonCode: body.reason_code });
    } else if (parseMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "parser_version"]);
      result = await queueMaterialImportParse(dependencies.database, { batchId: integerPath(parseMatch[1]), username: user.username, canReadAny, expectedVersion: Number(body.expected_version), parserVersion: String(body.parser_version ?? ""), idempotencyKey: request.headers.get("Idempotency-Key") ?? "", requestId }, dependencies.clock);
    } else if (sheetsMatch && request.method === "GET") {
      assertQueryKeys(url, []);
      result = await listMaterialImportSheets(dependencies.database, integerPath(sheetsMatch[1]), { username: user.username, canReadAny });
    } else if (rowsMatch && request.method === "GET") {
      assertQueryKeys(url, ["sheet_index", "page", "page_size", "start_row", "end_row"]);
      const rangeMode = url.searchParams.has("start_row") || url.searchParams.has("end_row");
      if (rangeMode && (url.searchParams.has("page") || url.searchParams.has("page_size"))) throw new MaterialImportServiceError("INVALID_REQUEST", "分页模式与行范围模式不能混用", 400);
      result = await listMaterialImportRows(dependencies.database, integerPath(rowsMatch[1]), { username: user.username, canReadAny, sheetIndex: Number(url.searchParams.get("sheet_index")), page: Number(url.searchParams.get("page") ?? 1), pageSize: Number(url.searchParams.get("page_size") ?? 50), ...(rangeMode ? { startRow: Number(url.searchParams.get("start_row")), endRow: Number(url.searchParams.get("end_row")) } : {}) });
    } else if (mappingMatch && request.method === "GET") {
      assertQueryKeys(url, []);
      result = await getMaterialImportMapping(dependencies.database, integerPath(mappingMatch[1]), { username: user.username, canReadAny });
    } else if (mappingTargetsMatch && request.method === "GET") {
      result = await new MaterialImportMappingTargetCatalogService(dependencies.database, { rateLimiter: dependencies.importReadRateLimiter, readLimit: dependencies.importReadRateLimit, clock: dependencies.clock }).list(integerPath(mappingTargetsMatch[1]), { username: user.username, canReadAny, canMap: dependencies.userCan(user, "material.import.map"), requestId, query: catalogQuery(url) });
    } else if (mappingMatch && request.method === "PUT") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "parse_run_id", "expected_mapping_version", "selected_sheet_index", "header_mode", "header_row_number", "items"]);
      const draft = { selected_sheet_index: Number(body.selected_sheet_index), header_mode: body.header_mode, header_row_number: body.header_row_number, items: body.items } as MaterialImportMappingDraftInput;
      result = await replaceMaterialImportMapping(dependencies.database, integerPath(mappingMatch[1]), { username: user.username, canReadAny, idempotencyKey: request.headers.get("Idempotency-Key") ?? "", requestId, expectedVersion: Number(body.expected_version), parseRunId: Number(body.parse_run_id), expectedMappingVersion: Number(body.expected_mapping_version), draft }, dependencies.clock);
    } else if (previewMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "parse_run_id", "mapping", "start_row", "row_limit"]);
      result = await previewMaterialImportMapping(dependencies.database, integerPath(previewMatch[1]), { username: user.username, canReadAny, idempotencyKey: request.headers.get("Idempotency-Key") ?? "", requestId, expectedVersion: Number(body.expected_version), parseRunId: Number(body.parse_run_id), draft: body.mapping as MaterialImportMappingDraftInput, startRow: Number(body.start_row), rowLimit: Number(body.row_limit) }, dependencies.clock);
    } else if (confirmMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "parse_run_id", "mapping_id", "expected_mapping_version", "metadata_digest"]);
      result = await confirmMaterialImportMapping(dependencies.database, integerPath(confirmMatch[1]), { username: user.username, canReadAny, idempotencyKey: request.headers.get("Idempotency-Key") ?? "", requestId, expectedVersion: Number(body.expected_version), parseRunId: Number(body.parse_run_id), mappingId: Number(body.mapping_id), expectedMappingVersion: Number(body.expected_mapping_version), metadataDigest: String(body.metadata_digest ?? "") }, dependencies.clock);
    } else if (normalizeMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "processor_version", "rerun_reason"]);
      result = await startMaterialImportNormalization(dependencies.database, { batchId: integerPath(normalizeMatch[1]), username: user.username, canReadAny, canNormalize: dependencies.userCan(user, "material.import.normalize"), expectedVersion: Number(body.expected_version), processorVersion: String(body.processor_version ?? ""), rerunReason: body.rerun_reason === undefined || body.rerun_reason === null ? null : String(body.rerun_reason), idempotencyKey: request.headers.get("Idempotency-Key") ?? "", requestId, consumeRateLimit: consumeNormalizationRateLimit("MATERIAL_IMPORT_NORMALIZATION_START", dependencies.importNormalizationWriteRateLimit ?? 20) }, dependencies.clock);
    } else if (normalizationMatch && request.method === "GET") {
      assertNormalizationQuery(url, []);
      result = await getMaterialImportNormalization(dependencies.database, integerPath(normalizationMatch[1]), { username: user.username, canReadAny, consumeRateLimit: consumeNormalizationRateLimit("MATERIAL_IMPORT_NORMALIZATION_READ", dependencies.importReadRateLimit ?? 120) });
    } else if (normalizedRowsMatch && request.method === "GET") {
      assertNormalizationQuery(url, ["cursor", "limit", "row_status"]);
      result = await listMaterialImportNormalizedRows(dependencies.database, integerPath(normalizedRowsMatch[1]), { username: user.username, canReadAny, rowStatus: url.searchParams.get("row_status") ?? undefined, limit: normalizationLimit(url), cursor: url.searchParams.get("cursor") ?? undefined, consumeRateLimit: consumeNormalizationRateLimit("MATERIAL_IMPORT_NORMALIZATION_READ", dependencies.importReadRateLimit ?? 120) });
    } else if (normalizedRowMatch && request.method === "GET") {
      assertNormalizationQuery(url, []);
      result = await getMaterialImportNormalizedRow(dependencies.database, integerPath(normalizedRowMatch[1]), integerPath(normalizedRowMatch[2]), { username: user.username, canReadAny, consumeRateLimit: consumeNormalizationRateLimit("MATERIAL_IMPORT_NORMALIZATION_READ", dependencies.importReadRateLimit ?? 120) });
    } else if (normalizationIssuesMatch && request.method === "GET") {
      assertNormalizationQuery(url, ["cursor", "limit", "issue_level", "issue_code", "target_code", "source_row_number"]);
      const sourceRow = url.searchParams.get("source_row_number");
      result = await listMaterialImportNormalizationIssues(dependencies.database, integerPath(normalizationIssuesMatch[1]), { username: user.username, canReadAny, issueLevel: url.searchParams.get("issue_level") ?? undefined, issueCode: url.searchParams.get("issue_code") ?? undefined, targetCode: url.searchParams.get("target_code") ?? undefined, sourceRowNumber: sourceRow === null ? undefined : Number(sourceRow), limit: normalizationLimit(url), cursor: url.searchParams.get("cursor") ?? undefined, consumeRateLimit: consumeNormalizationRateLimit("MATERIAL_IMPORT_NORMALIZATION_READ", dependencies.importReadRateLimit ?? 120) });
    } else if (draftGenerationMatch && request.method === "GET") {
      assertNormalizationQuery(url, ["mode", "after_row_id", "after_link_id", "limit"]);
      const mode = url.searchParams.get("mode") ?? "inspect";
      const common = { batchId: integerPath(draftGenerationMatch[1]), username: user.username, canReadAny };
      if (mode === "inspect") {
        if (url.searchParams.has("after_row_id") || url.searchParams.has("after_link_id") || url.searchParams.has("limit")) throw new MaterialImportServiceError("IMPORT_DRAFT_REQUEST_INVALID", "inspect 不接受分页参数", 400);
        result = await inspectMaterialImportDraftGeneration(dependencies.database, common);
      } else if (mode === "dry-run") {
        if (url.searchParams.has("after_link_id")) throw new MaterialImportServiceError("IMPORT_DRAFT_REQUEST_INVALID", "dry-run 不接受 after_link_id", 400);
        result = await dryRunMaterialImportDraftGeneration(dependencies.database, {
          ...common,
          requestId,
          afterRowId: Number(url.searchParams.get("after_row_id") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 20),
        });
      } else if (mode === "report") {
        if (url.searchParams.has("after_row_id")) throw new MaterialImportServiceError("IMPORT_DRAFT_REQUEST_INVALID", "report 不接受 after_row_id", 400);
        result = await reportMaterialImportDraftGeneration(dependencies.database, {
          ...common,
          afterLinkId: Number(url.searchParams.get("after_link_id") ?? 0),
          limit: Number(url.searchParams.get("limit") ?? 20),
        });
      } else {
        throw new MaterialImportServiceError("IMPORT_DRAFT_REQUEST_INVALID", "mode 只允许 inspect、dry-run 或 report", 400);
      }
    } else if (normalizationApproveMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "result_digest", "accept_warnings"]);
      result = await approveMaterialImportNormalization(dependencies.database, {
        batchId: integerPath(normalizationApproveMatch[1]),
        username: user.username,
        canReadAny,
        canCommit: dependencies.userCan(user, "material.import.commit"),
        expectedVersion: Number(body.expected_version),
        resultDigest: String(body.result_digest ?? ""),
        acceptWarnings: body.accept_warnings === true,
        rawKey: request.headers.get("Idempotency-Key") ?? "",
        requestId,
        clock: dependencies.clock,
      });
    } else if (draftsMatch && request.method === "POST") {
      assertMaterialCsrf(request);
      const { body } = await readBoundedJson(request);
      assertObjectKeys(body, ["expected_version", "after_row_id", "limit"]);
      result = await commitMaterialImportDraftGeneration(dependencies.database, {
        batchId: integerPath(draftsMatch[1]),
        username: user.username,
        canReadAny,
        canCommit: dependencies.userCan(user, "material.import.commit"),
        expectedVersion: Number(body.expected_version),
        afterRowId: Number(body.after_row_id ?? 0),
        limit: Number(body.limit ?? 20),
        rawKey: request.headers.get("Idempotency-Key") ?? "",
        requestId,
        clock: dependencies.clock,
      });
    } else {
      throw new MaterialImportServiceError("METHOD_NOT_ALLOWED", "请求方法不支持", 405);
    }
    if (isNormalizationRequest && request.method === "GET") await writeNormalizationReadAudit(dependencies, user.username, requestId, url.pathname);
    return response(result, requestId);
  } catch (error) {
    let failure: MaterialImportServiceError;
    if (error instanceof MaterialImportServiceError) failure = error;
    else if (error instanceof MaterialImportParserServiceError) failure = new MaterialImportServiceError(error.code, error.message, error.status, error.expectedVersion);
    else if (error instanceof MaterialImportNormalizationServiceError) failure = new MaterialImportServiceError(error.code, error.message, error.status, error.expectedVersion);
    else if (error instanceof MaterialApiFailure) {
      failure = new MaterialImportServiceError(
        error.code === "CSRF_INVALID" && !isNormalizationRequest ? "CSRF_VALIDATION_FAILED" : error.code,
        error.code === "CSRF_INVALID" ? "CSRF 校验失败" : error.message,
        error.status,
      );
    } else failure = new MaterialImportServiceError("INTERNAL_ERROR", "系统处理失败，请联系管理员", 500);
    await writeFailureAudit(dependencies, user, requestId, url.pathname, failure);
    const output = errorResponse(failure, requestId);
    if (failure.status === 429) output.headers.set("Retry-After", "60");
    return output;
  }
}
