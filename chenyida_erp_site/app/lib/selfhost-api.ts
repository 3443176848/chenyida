import { randomUUID, timingSafeEqual } from "node:crypto";
import { getPool } from "../../db/index.ts";
import { getApplicationVersion } from "./application-version.ts";
import { runtimeConfig } from "./infrastructure/config.ts";
import { requestOriginMatches } from "./infrastructure/request-origin.ts";
import { PostgresBackgroundJobQueue } from "./infrastructure/background-jobs.ts";
import { systemClock, uuidGenerator } from "./infrastructure/primitives.ts";
import { handleSelfhostMaterialApi } from "./material-selfhost/handler.ts";
import { handleSelfhostMaterialImportMappingApi } from "./material-import-selfhost/handler.ts";
import { handleSelfhostMaterialStandardizationApi } from "./material-standardization-selfhost/handler.ts";
import { handleSelfhostMaterialImportNormalizationApi } from "./material-import-normalization-selfhost/handler.ts";
import { handleSelfhostMaterialImportReviewApi } from "./material-import-review-selfhost/handler.ts";
import { handleSelfhostMaterialImportFallbackApi } from "./material-import-fallback/handler.ts";
import { handleSelfhostMaterialGovernanceApi } from "./material-governance-selfhost/handler.ts";
import { handleSelfhostAiGovernanceSuggestionApi } from "./ai-governance-suggestion-selfhost/handler.ts";
import { handleMasterDataApi } from "./master-data-selfhost/handler.ts";
import { handleBomApi } from "./bom-selfhost/handler.ts";
import { handleInventoryApi } from "./inventory-selfhost/handler.ts";
import { handleFinishedGoodsInventoryLotApi } from "./inventory-lot-selfhost/handler.ts";
import { handleProcurementApi } from "./procurement-selfhost/handler.ts";
import { handleProductionApi } from "./production-selfhost/handler.ts";
import { handleSalesApi } from "./sales-selfhost/handler.ts";
import { handleQualityApi } from "./quality-selfhost/handler.ts";
import { handleFinanceApi } from "./finance-selfhost/handler.ts";
import { handleDashboardApi } from "./dashboard-selfhost/handler.ts";
import { handleProjectApi } from "./project-selfhost/handler.ts";
import { handlePlanningHandoffApi } from "./planning-handoff-selfhost/handler.ts";
import { handleMaterialRequirementApi } from "./material-requirement-selfhost/handler.ts";
import { handleProcurementSourcingApi } from "./procurement-sourcing-selfhost/handler.ts";
import { handleSupplierMappingApi } from "./supplier-mapping-selfhost/handler.ts";
import { handleProcurementFulfillmentApi } from "./procurement-fulfillment-selfhost/handler.ts";
import { handleProductionHandoffApi } from "./production-handoff-selfhost/handler.ts";
import { handleProductionRoutingApi } from "./production-routing-selfhost/handler.ts";
import { handleProductionOperationApi } from "./production-operation-selfhost/handler.ts";
import { handleProductionNonconformanceApi } from "./production-nonconformance-selfhost/handler.ts";
import { handleProductionBatchApi } from "./production-batch-selfhost/handler.ts";
import {
  assertProtectedIdentityGate,
  buildClearCookieHeaders,
  CSRF_COOKIE,
  handleSelfhostIdentityApi,
  identityFailureResponse,
  resolveIdentitySession,
} from "./identity-selfhost/handler.ts";
import { PostgresIdentityRepository } from "./identity-selfhost/repository.ts";
import type { IdentityActor } from "./identity-selfhost/types.ts";
import { RuntimeReadinessError, runtimeReadinessErrorCode } from "./runtime-readiness/identity.ts";
import { getDefaultRuntimeReadinessService, type RuntimeReadinessResult } from "./runtime-readiness/service.ts";

export { initializeAdmin } from "./identity-selfhost/service.ts";

class ApiError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

function constantEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function cookies(request: Request) { return Object.fromEntries((request.headers.get("cookie") || "").split(";").map((item) => item.trim().split(/=(.*)/s, 2)).filter(([key]) => key)); }
function json(data: unknown, status = 200, requestId: string = randomUUID(), headers?: HeadersInit) {
  const responseHeaders = new Headers(headers); responseHeaders.set("Cache-Control", "no-store"); responseHeaders.set("X-Request-ID", requestId);
  return Response.json(data, { status, headers: responseHeaders });
}
function failure(error: unknown, requestId: string) { const known = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500); return json({ error: { code: known.code, message: known.message, request_id: requestId }, code: known.code, message: known.message, request_id: requestId }, known.status, requestId); }
function logFailure(error: unknown, requestId: string, event = "api_request_failed") {
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  const code = error instanceof ApiError
    ? error.code
    : /^(?:CONTROLLED|DATABASE_RUNTIME|RUNTIME_SECRET)_[A-Z0-9_]{1,96}$/.test(candidate)
      ? candidate
      : "INTERNAL_ERROR";
  console.error(JSON.stringify({ level: "error", event, request_id: requestId, code }));
}
function requirePermission(user: IdentityActor, permission: string) { if (!user.permissions.includes("*") && !user.permissions.includes(permission)) throw new ApiError("PERMISSION_DENIED", "没有权限执行此操作", 403); }
function requireCsrf(request: Request) { const config = runtimeConfig(); if (!requestOriginMatches(request, config.publicOrigin, config.allowUatLoopbackOrigin)) throw new ApiError("CSRF_INVALID", "请求来源校验失败", 403); const token = request.headers.get("x-csrf-token") || ""; const cookie = cookies(request)[CSRF_COOKIE] || ""; if (!token || !cookie || !constantEqual(token, cookie)) throw new ApiError("CSRF_INVALID", "CSRF Token 无效", 403); }

type HealthDatabase = {
  query(sql: string, values?: unknown[]): Promise<{ rows?: unknown[]; rowCount?: number | null }>;
};

type HealthComponentStatus = "READY" | "NOT_READY" | "UNKNOWN";

function healthFailureComponents(code: string): Record<string, HealthComponentStatus> {
  const value: Record<string, HealthComponentStatus> = {
    postgresql: "UNKNOWN", migration: "UNKNOWN", worker: "UNKNOWN",
    uploads: "UNKNOWN", attachments: "UNKNOWN", runtime: "READY",
  };
  if (code === "RUNTIME_IDENTITY_INVALID") value.runtime = "NOT_READY";
  else if (code === "RUNTIME_DATABASE_UNAVAILABLE") value.postgresql = "NOT_READY";
  else if (code === "RUNTIME_MIGRATION_SOURCE_INVALID") value.migration = "NOT_READY";
  else if (code === "RUNTIME_MIGRATION_MISMATCH") { value.postgresql = "READY"; value.migration = "NOT_READY"; }
  else if (code === "RUNTIME_WORKER_UNAVAILABLE") { value.postgresql = "READY"; value.migration = "READY"; value.worker = "NOT_READY"; }
  else if (code === "RUNTIME_UPLOADS_UNAVAILABLE") {
    Object.assign(value, { postgresql: "READY", migration: "READY", worker: "READY", uploads: "NOT_READY" });
  } else if (code === "RUNTIME_ATTACHMENTS_UNAVAILABLE") {
    Object.assign(value, { postgresql: "READY", migration: "READY", worker: "READY", uploads: "READY", attachments: "NOT_READY" });
  }
  return value;
}

function logRuntimeCheckFailure(error: unknown, requestId: string, event: string): void {
  console.error(JSON.stringify({ level: "error", event, request_id: requestId, code: runtimeReadinessErrorCode(error) }));
}

async function readinessWithTimeout(
  readiness: Readonly<{ check(): Promise<RuntimeReadinessResult> }>,
  timeoutMs: number,
): Promise<RuntimeReadinessResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readiness.check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RuntimeReadinessError("RUNTIME_HEALTH_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleSelfhostLive(input: {
  requestId: string;
  applicationVersion?: () => string;
  now?: () => Date;
}): Promise<Response> {
  try {
    const version = (input.applicationVersion || getApplicationVersion)();
    return json({ ok: true, status: "LIVE", version, time: (input.now || (() => new Date()))().toISOString() }, 200, input.requestId);
  } catch (error) {
    logRuntimeCheckFailure(error, input.requestId, "api_live_failed");
    return json({
      ok: false,
      status: "NOT_LIVE",
      error: { code: "INTERNAL_ERROR", message: "服务器暂时无法处理请求", request_id: input.requestId },
      code: "INTERNAL_ERROR",
      message: "服务器暂时无法处理请求",
      request_id: input.requestId,
    }, 500, input.requestId);
  }
}

export async function handleSelfhostHealth(input: {
  database: HealthDatabase;
  requestId: string;
  readiness?: Readonly<{ check(): Promise<RuntimeReadinessResult> }>;
  timeoutMs?: number;
}): Promise<Response> {
  try {
    const readiness = input.readiness || await getDefaultRuntimeReadinessService(input.database);
    const result = await readinessWithTimeout(readiness, input.timeoutMs ?? 4_000);
    return json({
      ok: true,
      status: "READY",
      database: "postgresql",
      storage: "local",
      worker: "postgresql-jobs",
      deployment_class: result.deploymentClass.toUpperCase(),
      deployment_id: result.deploymentId,
      version: result.version,
      revision: result.revision,
      migration_head: result.migrationHead,
      migration_manifest_sha256: result.migrationManifestSha256,
      components: result.components,
      time: result.databaseTime.toISOString(),
    }, 200, input.requestId);
  } catch (error) {
    const known = error instanceof RuntimeReadinessError;
    const safe = known ? error : new RuntimeReadinessError("RUNTIME_READINESS_FAILED");
    const status = known ? 503 : 500;
    const code = known ? safe.code : "INTERNAL_ERROR";
    const message = known ? safe.message : "服务器暂时无法处理请求";
    logRuntimeCheckFailure(safe, input.requestId, "api_health_failed");
    return json({
      ok: false,
      status: "NOT_READY",
      code,
      message,
      request_id: input.requestId,
      components: healthFailureComponents(code),
      error: { code, message, request_id: input.requestId },
    }, status, input.requestId);
  }
}

export async function handleSelfhostApi(
  request: Request,
  dependencies: Readonly<{ poolFactory?: typeof getPool }> = {},
): Promise<Response> {
  const suppliedRequestId = request.headers.get("x-request-id") || ""; const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId) ? suppliedRequestId : randomUUID(); const url = new URL(request.url); const path = url.pathname;
  if (path === "/api/live") return handleSelfhostLive({ requestId });
  try {
    const pool = (dependencies.poolFactory || getPool)();
    if (path === "/api/health") return handleSelfhostHealth({ database: pool, requestId });
    const identityResponse = await handleSelfhostIdentityApi(request, { pool, requestId });
    if (identityResponse) return identityResponse;
    const identityRepository = new PostgresIdentityRepository(pool);
    const identityContext = await resolveIdentitySession(request, identityRepository, requestId);
    let user: IdentityActor;
    try {
      user = assertProtectedIdentityGate(identityContext);
    } catch (error) {
      const headers = identityContext.token_hash && identityContext.state !== "AUTHENTICATED" ? buildClearCookieHeaders(request) : undefined;
      return identityFailureResponse(error, requestId, headers);
    }
    const config = runtimeConfig();
    const fallbackQueue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, config.workerLeaseSeconds);
    const fallbackResponse = await handleSelfhostMaterialImportFallbackApi(request, {
      pool,
      queue: fallbackQueue,
      actor: user,
      requestId,
      requireCsrf: () => requireCsrf(request),
      uploadRoot: config.uploadRoot,
      maximumBytes: config.maxUploadBytes,
      leaseSeconds: config.workerLeaseSeconds,
    });
    if (fallbackResponse) return fallbackResponse;
    const dashboardResponse = await handleDashboardApi(request, { pool, actor: user, requestId, backupStatusFile: runtimeConfig().backupStatusFile });
    if (dashboardResponse) return dashboardResponse;
    requirePermission(user, "material.read");
    const projectResponse = await handleProjectApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (projectResponse) return projectResponse;
    const planningResponse = await handlePlanningHandoffApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (planningResponse) return planningResponse;
    const materialRequirementResponse = await handleMaterialRequirementApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (materialRequirementResponse) return materialRequirementResponse;
    const procurementSourcingResponse = await handleProcurementSourcingApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (procurementSourcingResponse) return procurementSourcingResponse;
    const supplierMappingResponse = await handleSupplierMappingApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (supplierMappingResponse) return supplierMappingResponse;
    const procurementFulfillmentResponse = await handleProcurementFulfillmentApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (procurementFulfillmentResponse) return procurementFulfillmentResponse;
    const productionHandoffResponse = await handleProductionHandoffApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (productionHandoffResponse) return productionHandoffResponse;
    const financeResponse = await handleFinanceApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (financeResponse) return financeResponse;
    const nonconformanceResponse = await handleProductionNonconformanceApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (nonconformanceResponse) return nonconformanceResponse;
    const qualityResponse = await handleQualityApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (qualityResponse) return qualityResponse;
    const salesResponse = await handleSalesApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (salesResponse) return salesResponse;
    const productionRoutingResponse = await handleProductionRoutingApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (productionRoutingResponse) return productionRoutingResponse;
    const productionBatchResponse = await handleProductionBatchApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (productionBatchResponse) return productionBatchResponse;
    const productionOperationResponse = await handleProductionOperationApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (productionOperationResponse) return productionOperationResponse;
    const productionResponse = await handleProductionApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (productionResponse) return productionResponse;
    const procurementResponse = await handleProcurementApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (procurementResponse) return procurementResponse;
    const inventoryLotResponse = await handleFinishedGoodsInventoryLotApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (inventoryLotResponse) return inventoryLotResponse;
    const inventoryResponse = await handleInventoryApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (inventoryResponse) return inventoryResponse;
    const masterDataResponse = await handleMasterDataApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (masterDataResponse) return masterDataResponse;
    const bomResponse = await handleBomApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (bomResponse) return bomResponse;
    const materialResponse = await handleSelfhostMaterialApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (materialResponse) return materialResponse;
    const standardizationResponse = await handleSelfhostMaterialStandardizationApi(request, { pool, actor: user, requestId });
    if (standardizationResponse) return standardizationResponse;
    const mappingResponse = await handleSelfhostMaterialImportMappingApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (mappingResponse) return mappingResponse;
    const normalizationResponse = await handleSelfhostMaterialImportNormalizationApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (normalizationResponse) return normalizationResponse;
    const aiSuggestionResponse = await handleSelfhostAiGovernanceSuggestionApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (aiSuggestionResponse) return aiSuggestionResponse;
    const governanceResponse = await handleSelfhostMaterialGovernanceApi(request, { pool, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (governanceResponse) return governanceResponse;
    const reviewQueue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, runtimeConfig().workerLeaseSeconds);
    const reviewResponse = await handleSelfhostMaterialImportReviewApi(request, { pool, queue: reviewQueue, actor: user, requestId, requireCsrf: () => requireCsrf(request) });
    if (reviewResponse) return reviewResponse;
    throw new ApiError("NOT_FOUND", "接口不存在", 404);
  } catch (error) {
    logFailure(error, requestId);
    return failure(error, requestId);
  }
}
