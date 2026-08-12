import { createHash } from "node:crypto";

import { parseStrictJson } from "../../scripts/release-identity-contract.mjs";
import { validateOfficialReleaseGatePlan } from "../../scripts/release-manifest-contract.mjs";

export const MONITORING_POLICY_CONTRACT = "chenyida-erp-operations-monitoring-policy/v1";
export const MONITORING_CONFIG_CONTRACT = "chenyida-erp-operations-monitoring-config/v1";
export const MONITORING_OBSERVATION_CONTRACT = "chenyida-erp-operations-observation/v1";
export const MONITORING_STATE_CONTRACT = "chenyida-erp-operations-monitoring-state/v1";
export const MONITORING_REPORT_CONTRACT = "chenyida-erp-operations-monitoring-report/v1";
export const MONITORING_EVENT_CONTRACT = "chenyida-erp-operations-alert-event/v1";
export const OFFICIAL_MONITORING_POLICY_PATH = "operations/monitoring-policy-v1.json";
export const OFFICIAL_RESOURCE_PLAN_PATH = "release/release-gate-plan-v1.json";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REVISION = /^[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}@sha256:[0-9a-f]{64}$/;
const IMAGE_LOCATOR = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SERVICES = Object.freeze(["caddy", "postgres", "web", "worker"]);
const SERVICE_SET = new Set(SERVICES);
const HEALTH = new Set(["healthy", "unhealthy", "starting", "none"]);
const CONTAINER_STATUS = new Set(["created", "dead", "exited", "paused", "removing", "restarting", "running"]);
const DEPLOYMENT_CLASSES = new Set(["TEST", "UAT", "PRODUCTION"]);
const SEVERITIES = Object.freeze({ WARNING: 1, CRITICAL: 2 });
const RUNTIME_CODES = new Set([
  "APPLICATION_HTTP_FAILED",
  "APPLICATION_RESPONSE_INVALID",
  "INTERNAL_ERROR",
  "RUNTIME_ATTACHMENTS_UNAVAILABLE",
  "RUNTIME_DATABASE_UNAVAILABLE",
  "RUNTIME_HEALTH_TIMEOUT",
  "RUNTIME_IDENTITY_INVALID",
  "RUNTIME_MIGRATION_MISMATCH",
  "RUNTIME_MIGRATION_SOURCE_INVALID",
  "RUNTIME_READINESS_FAILED",
  "RUNTIME_STORAGE_UNAVAILABLE",
  "RUNTIME_UPLOADS_UNAVAILABLE",
  "RUNTIME_WORKER_UNAVAILABLE",
]);
const BACKUP_VERIFICATION = new Set(["UNVERIFIED", "INVALID", "STALE", "LEGACY_LOCAL_ONLY", "LOCAL_VERIFIED", "OFFHOST_VERIFIED", "RESTORE_VERIFIED"]);
const MATCH_STATUS = new Set(["UNCONFIGURED", "MISMATCH", "MATCHED"]);
const ZERO_SHA256 = "0".repeat(64);

const ALERT_DEFINITIONS = Object.freeze({
  MONITOR_OBSERVATION_STALE: ["CRITICAL", "监控快照已过期", "operations-runbook.md#监控告警与值班处置", "monitor.observation"],
  MONITOR_CLOCK_SKEW: ["CRITICAL", "监控快照时间超出允许时钟偏差", "operations-runbook.md#监控告警与值班处置", "monitor.observation"],
  MONITOR_STATE_GAP: ["WARNING", "监控采样出现中断，持续窗口正在重新建立", "operations-runbook.md#监控告警与值班处置", "monitor.window"],
  MONITOR_SWAP_WINDOW_INCOMPLETE: ["WARNING", "Swap 增长监控尚未形成完整 60 秒窗口", "operations-runbook.md#监控告警与值班处置", "host.swap.growth"],
  MONITOR_LOAD_WINDOW_INCOMPLETE: ["WARNING", "Load 监控尚未形成完整 3 分钟窗口", "operations-runbook.md#监控告警与值班处置", "host.load.sustained"],
  HOST_MEMORY_AVAILABLE_LOW: ["CRITICAL", "宿主可用内存低于 768 MiB", "operations-runbook.md#每次重任务的资源门禁", "host.memory"],
  HOST_SWAP_USAGE_HIGH: ["CRITICAL", "宿主 Swap 使用率超过 80%", "operations-runbook.md#每次重任务的资源门禁", "host.swap.percent"],
  HOST_SWAP_GROWTH_HIGH: ["CRITICAL", "宿主 Swap 在 60 秒内增长超过 256 MiB", "operations-runbook.md#每次重任务的资源门禁", "host.swap.growth"],
  HOST_ROOT_FREE_LOW: ["CRITICAL", "根分区可用空间低于 10 GiB", "operations-runbook.md#每次重任务的资源门禁", "host.disk.root"],
  HOST_LOAD_SUSTAINED_HIGH: ["CRITICAL", "宿主 1 分钟 Load 持续 3 分钟高于 4", "operations-runbook.md#每次重任务的资源门禁", "host.load.sustained"],
  HOST_OOM_HISTORY_PRESENT: ["CRITICAL", "监控基线发现既有宿主 OOM 计数，需人工确认后重建基线", "operations-runbook.md#监控告警与值班处置", "host.oom"],
  HOST_OOM_DETECTED: ["CRITICAL", "宿主 OOM 计数增加", "operations-runbook.md#监控告警与值班处置", "host.oom"],
  HOST_REBOOT_DETECTED: ["WARNING", "宿主启动身份已变化，持续窗口已重建", "operations-runbook.md#监控告警与值班处置", "host.boot"],
  SERVICE_MISSING: ["CRITICAL", "预期服务容器缺失", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_CONTAINER_MISMATCH: ["CRITICAL", "服务容器名称与受控配置不一致", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_IMAGE_MISMATCH: ["CRITICAL", "服务镜像引用与受控配置不一致", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_NOT_RUNNING: ["CRITICAL", "服务容器未处于 running", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_HEALTH_UNAVAILABLE: ["CRITICAL", "服务缺少受控 Docker health", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_HEALTH_UNHEALTHY: ["CRITICAL", "服务 Docker health 未通过", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_RESTARTED: ["CRITICAL", "服务容器 RestartCount 非零", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_OOM_KILLED: ["CRITICAL", "服务容器曾被 OOM kill", "operations-runbook.md#监控告警与值班处置", "service"],
  SERVICE_INSTANCE_CHANGED: ["WARNING", "服务容器实例已变化，需核对是否为受控发布", "operations-runbook.md#监控告警与值班处置", "service"],
  APPLICATION_LIVENESS_UNAVAILABLE: ["CRITICAL", "应用 liveness 证据不可用", "operations-runbook.md#livenessreadiness与worker租约处置", "application.live"],
  APPLICATION_LIVENESS_FAILED: ["CRITICAL", "应用 liveness 检查失败", "operations-runbook.md#livenessreadiness与worker租约处置", "application.live"],
  APPLICATION_LIVENESS_STALE: ["CRITICAL", "应用 liveness 证据已过期", "operations-runbook.md#livenessreadiness与worker租约处置", "application.live"],
  APPLICATION_READINESS_UNAVAILABLE: ["CRITICAL", "应用 readiness 证据不可用", "operations-runbook.md#livenessreadiness与worker租约处置", "application.readiness"],
  APPLICATION_READINESS_FAILED: ["CRITICAL", "应用 readiness 检查失败", "operations-runbook.md#livenessreadiness与worker租约处置", "application.readiness"],
  APPLICATION_READINESS_STALE: ["CRITICAL", "应用 readiness 证据已过期", "operations-runbook.md#livenessreadiness与worker租约处置", "application.readiness"],
  APPLICATION_IDENTITY_MISMATCH: ["CRITICAL", "应用版本或 Git 身份与受控配置不一致", "operations-runbook.md#dashboard-与运行身份", "application.identity"],
  APPLICATION_MIGRATION_MISMATCH: ["CRITICAL", "应用 Migration 身份与受控配置不一致", "operations-runbook.md#livenessreadiness与worker租约处置", "application.migration"],
  RELEASE_IDENTITY_UNAVAILABLE: ["CRITICAL", "运行发布身份不可用", "operations-runbook.md#dashboard-与运行身份", "release.identity"],
  RELEASE_IDENTITY_INVALID: ["CRITICAL", "运行发布身份无效", "operations-runbook.md#dashboard-与运行身份", "release.identity"],
  RELEASE_IDENTITY_MISMATCH: ["CRITICAL", "运行发布身份与受控候选不一致", "operations-runbook.md#dashboard-与运行身份", "release.identity"],
  RELEASE_IDENTITY_STALE: ["CRITICAL", "运行发布身份已过期", "operations-runbook.md#dashboard-与运行身份", "release.identity"],
  BACKUP_EVIDENCE_UNAVAILABLE: ["CRITICAL", "备份恢复治理证据不可用", "backup-restore.md#dashboard-判定", "backup"],
  BACKUP_EVIDENCE_INVALID: ["CRITICAL", "备份恢复治理证据损坏或无效", "backup-restore.md#dashboard-判定", "backup"],
  BACKUP_EVIDENCE_STALE: ["CRITICAL", "备份恢复治理证据已过期", "backup-restore.md#dashboard-判定", "backup"],
  BACKUP_IDENTITY_MISMATCH: ["CRITICAL", "备份证据与运行身份不一致", "backup-restore.md#dashboard-判定", "backup"],
  BACKUP_POLICY_MISMATCH: ["CRITICAL", "备份策略或 RPO 与受控配置不一致", "backup-restore.md#dashboard-判定", "backup"],
  BACKUP_ASSURANCE_MISMATCH: ["CRITICAL", "备份证据未证明预期异机与隔离恢复", "backup-restore.md#dashboard-判定", "backup"],
  BACKUP_RECOVERY_NOT_READY: ["CRITICAL", "恢复就绪证据不完整", "backup-restore.md#dashboard-判定", "backup"],
  ALERT_DELIVERY_NOT_CONFIGURED: ["CRITICAL", "真实告警通知渠道尚未就绪", "operations-runbook.md#监控告警与值班处置", "notification"],
});

export class OpsMonitoringError extends Error {
  constructor(code) {
    super(code);
    this.name = "OpsMonitoringError";
    this.code = code;
  }
}

function reject(code) {
  throw new OpsMonitoringError(code);
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function finite(value, minimum, maximum, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) reject(code);
  return value;
}

function bounded(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function oneOf(value, allowed, code) {
  if (typeof value !== "string" || !allowed.has(value)) reject(code);
  return value;
}

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function nullable(value, validator, code) {
  if (value === null) return null;
  return validator(value, code);
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
  return value;
}

export function canonicalMonitoringJson(value) {
  return `${JSON.stringify(normalized(value))}\n`;
}

export function monitoringSha256(value) {
  const raw = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalMonitoringJson(value);
  return createHash("sha256").update(raw).digest("hex");
}

export function parseMonitoringJson(raw, maximumBytes = 1024 * 1024) {
  try {
    return parseStrictJson(raw, maximumBytes);
  } catch {
    reject("MONITOR_JSON_INVALID");
  }
}

export function validateMonitoringPolicy(value) {
  exactKeys(value, ["schema_version", "contract", "policy_id", "resource_policy_source", "observation_max_age_seconds", "max_clock_skew_seconds", "monitor_interval_seconds", "max_sample_gap_seconds", "reminder_interval_seconds", "release_identity_max_age_seconds", "max_active_alerts", "max_pending_events", "service_health", "backup"], "MONITOR_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_POLICY_CONTRACT || !IDENTIFIER.test(value.policy_id || "")) reject("MONITOR_POLICY_IDENTITY_INVALID");
  exactKeys(value.resource_policy_source, ["path", "sha256"], "MONITOR_POLICY_RESOURCE_SOURCE_FIELDS_INVALID");
  if (value.resource_policy_source.path !== OFFICIAL_RESOURCE_PLAN_PATH || !SHA256.test(value.resource_policy_source.sha256 || "")) reject("MONITOR_POLICY_RESOURCE_SOURCE_INVALID");
  integer(value.observation_max_age_seconds, 30, 600, "MONITOR_POLICY_TIME_INVALID");
  integer(value.max_clock_skew_seconds, 30, 600, "MONITOR_POLICY_TIME_INVALID");
  integer(value.monitor_interval_seconds, 15, 300, "MONITOR_POLICY_TIME_INVALID");
  integer(value.max_sample_gap_seconds, value.monitor_interval_seconds, value.monitor_interval_seconds * 3, "MONITOR_POLICY_TIME_INVALID");
  integer(value.reminder_interval_seconds, 300, 86_400, "MONITOR_POLICY_TIME_INVALID");
  integer(value.release_identity_max_age_seconds, 60, 604_800, "MONITOR_POLICY_TIME_INVALID");
  integer(value.max_active_alerts, 16, 512, "MONITOR_POLICY_ALERT_LIMIT_INVALID");
  integer(value.max_pending_events, value.max_active_alerts, 4096, "MONITOR_POLICY_EVENT_LIMIT_INVALID");
  if (!Array.isArray(value.service_health) || value.service_health.length !== SERVICES.length) reject("MONITOR_POLICY_SERVICE_SET_INVALID");
  value.service_health.forEach((entry, index) => {
    exactKeys(entry, ["service", "health_required"], "MONITOR_POLICY_SERVICE_FIELDS_INVALID");
    if (entry.service !== SERVICES[index] || typeof entry.health_required !== "boolean") reject("MONITOR_POLICY_SERVICE_SET_INVALID");
    if ((entry.service === "caddy") === entry.health_required) reject("MONITOR_POLICY_SERVICE_SET_INVALID");
  });
  exactKeys(value.backup, ["required_verification_status", "require_identity_match", "require_policy_match", "require_assurance_match", "require_recovery_ready"], "MONITOR_POLICY_BACKUP_FIELDS_INVALID");
  if (value.backup.required_verification_status !== "RESTORE_VERIFIED" || value.backup.require_identity_match !== true || value.backup.require_policy_match !== true || value.backup.require_assurance_match !== true || value.backup.require_recovery_ready !== true) reject("MONITOR_POLICY_BACKUP_INVALID");
  return value;
}

export function monitoringResourcePolicy(resourcePlan, policy) {
  validateMonitoringPolicy(policy);
  try {
    validateOfficialReleaseGatePlan(resourcePlan);
  } catch {
    reject("MONITOR_RESOURCE_PLAN_INVALID");
  }
  if (monitoringSha256(resourcePlan.resource_policy) !== policy.resource_policy_source.sha256) reject("MONITOR_RESOURCE_POLICY_SHA256_MISMATCH");
  return resourcePlan.resource_policy;
}

export function validateMonitoringConfig(value) {
  exactKeys(value, ["schema_version", "contract", "config_id", "deployment_class", "deployment_id", "compose_project", "service_expectations", "release_expectation", "backup_expectation", "notification"], "MONITOR_CONFIG_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_CONFIG_CONTRACT || !IDENTIFIER.test(value.config_id || "") || !DEPLOYMENT_CLASSES.has(value.deployment_class) || !IDENTIFIER.test(value.deployment_id || "") || !IDENTIFIER.test(value.compose_project || "")) reject("MONITOR_CONFIG_IDENTITY_INVALID");
  if (!Array.isArray(value.service_expectations) || value.service_expectations.length !== SERVICES.length) reject("MONITOR_CONFIG_SERVICE_SET_INVALID");
  const expectedByService = new Map();
  value.service_expectations.forEach((entry, index) => {
    exactKeys(entry, ["service", "container_name", "image_reference"], "MONITOR_CONFIG_SERVICE_FIELDS_INVALID");
    if (entry.service !== SERVICES[index] || !IDENTIFIER.test(entry.container_name || "") || !IMAGE_REFERENCE.test(entry.image_reference || "")) reject("MONITOR_CONFIG_SERVICE_INVALID");
    expectedByService.set(entry.service, entry);
  });
  exactKeys(value.release_expectation, ["application_version", "git_commit", "release_manifest_sha256", "supervisor_bundle_sha256", "migration_head", "migration_manifest_sha256", "web_image_digest", "worker_image_digest"], "MONITOR_CONFIG_RELEASE_FIELDS_INVALID");
  const release = value.release_expectation;
  if (!VERSION.test(release.application_version || "") || !COMMIT.test(release.git_commit || "") || !SHA256.test(release.release_manifest_sha256 || "") || !SHA256.test(release.supervisor_bundle_sha256 || "") || !MIGRATION.test(release.migration_head || "") || !SHA256.test(release.migration_manifest_sha256 || "") || !IMAGE_DIGEST.test(release.web_image_digest || "") || !IMAGE_DIGEST.test(release.worker_image_digest || "") || release.web_image_digest === release.worker_image_digest) reject("MONITOR_CONFIG_RELEASE_INVALID");
  if (expectedByService.get("web").image_reference.split("@")[1] !== release.web_image_digest || expectedByService.get("worker").image_reference.split("@")[1] !== release.worker_image_digest) reject("MONITOR_CONFIG_IMAGE_IDENTITY_MISMATCH");
  exactKeys(value.backup_expectation, ["policy_id", "rpo_hours"], "MONITOR_CONFIG_BACKUP_FIELDS_INVALID");
  if (!IDENTIFIER.test(value.backup_expectation.policy_id || "")) reject("MONITOR_CONFIG_BACKUP_INVALID");
  integer(value.backup_expectation.rpo_hours, 1, 168, "MONITOR_CONFIG_BACKUP_INVALID");
  exactKeys(value.notification, ["required", "target_id"], "MONITOR_CONFIG_NOTIFICATION_FIELDS_INVALID");
  if (typeof value.notification.required !== "boolean" || (value.notification.required ? !IDENTIFIER.test(value.notification.target_id || "") : value.notification.target_id !== null) || (value.deployment_class !== "TEST" && value.notification.required !== true)) reject("MONITOR_CONFIG_NOTIFICATION_INVALID");
  return value;
}

function validateApplicationObservation(value) {
  exactKeys(value, ["live", "readiness"], "MONITOR_OBSERVATION_APPLICATION_FIELDS_INVALID");
  exactKeys(value.live, ["status", "observed_at", "version", "code"], "MONITOR_OBSERVATION_LIVE_FIELDS_INVALID");
  if (!new Set(["NOT_COLLECTED", "PASS", "FAIL"]).has(value.live.status)) reject("MONITOR_OBSERVATION_LIVE_INVALID");
  if (value.live.status === "NOT_COLLECTED") {
    if ([value.live.observed_at, value.live.version, value.live.code].some((item) => item !== null)) reject("MONITOR_OBSERVATION_LIVE_INVALID");
  } else {
    iso(value.live.observed_at, "MONITOR_OBSERVATION_LIVE_INVALID");
    if (value.live.status === "PASS") {
      if (!VERSION.test(value.live.version || "") || value.live.code !== null) reject("MONITOR_OBSERVATION_LIVE_INVALID");
    } else if (value.live.version !== null || !RUNTIME_CODES.has(value.live.code)) reject("MONITOR_OBSERVATION_LIVE_INVALID");
  }
  exactKeys(value.readiness, ["status", "observed_at", "version", "revision", "migration_head", "code"], "MONITOR_OBSERVATION_READINESS_FIELDS_INVALID");
  if (!new Set(["NOT_COLLECTED", "READY", "NOT_READY"]).has(value.readiness.status)) reject("MONITOR_OBSERVATION_READINESS_INVALID");
  if (value.readiness.status === "NOT_COLLECTED") {
    if ([value.readiness.observed_at, value.readiness.version, value.readiness.revision, value.readiness.migration_head, value.readiness.code].some((item) => item !== null)) reject("MONITOR_OBSERVATION_READINESS_INVALID");
  } else {
    iso(value.readiness.observed_at, "MONITOR_OBSERVATION_READINESS_INVALID");
    if (value.readiness.status === "READY") {
      if (!VERSION.test(value.readiness.version || "") || !REVISION.test(value.readiness.revision || "") || !MIGRATION.test(value.readiness.migration_head || "") || value.readiness.code !== null) reject("MONITOR_OBSERVATION_READINESS_INVALID");
    } else if ([value.readiness.version, value.readiness.revision, value.readiness.migration_head].some((item) => item !== null) || !RUNTIME_CODES.has(value.readiness.code)) reject("MONITOR_OBSERVATION_READINESS_INVALID");
  }
}

function validateReleaseObservation(value) {
  const fields = ["status", "observed_at", "generated_at", "release_manifest_sha256", "supervisor_bundle_sha256", "application_version", "git_commit", "migration_head", "migration_manifest_sha256", "web_image_digest", "worker_image_digest"];
  exactKeys(value, fields, "MONITOR_OBSERVATION_RELEASE_FIELDS_INVALID");
  if (!new Set(["NOT_COLLECTED", "UNCONFIGURED", "INVALID", "MISMATCH", "MATCHED"]).has(value.status)) reject("MONITOR_OBSERVATION_RELEASE_INVALID");
  const evidenceFields = fields.slice(1);
  if (new Set(["NOT_COLLECTED", "UNCONFIGURED", "INVALID"]).has(value.status)) {
    if (evidenceFields.some((field) => value[field] !== null)) reject("MONITOR_OBSERVATION_RELEASE_INVALID");
    return;
  }
  iso(value.observed_at, "MONITOR_OBSERVATION_RELEASE_INVALID");
  iso(value.generated_at, "MONITOR_OBSERVATION_RELEASE_INVALID");
  if (!SHA256.test(value.release_manifest_sha256 || "") || !SHA256.test(value.supervisor_bundle_sha256 || "") || !VERSION.test(value.application_version || "") || !COMMIT.test(value.git_commit || "") || !MIGRATION.test(value.migration_head || "") || !SHA256.test(value.migration_manifest_sha256 || "") || !IMAGE_DIGEST.test(value.web_image_digest || "") || !IMAGE_DIGEST.test(value.worker_image_digest || "") || value.web_image_digest === value.worker_image_digest) reject("MONITOR_OBSERVATION_RELEASE_INVALID");
}

function validateBackupObservation(value) {
  exactKeys(value, ["status", "observed_at", "verification_status", "identity_status", "policy_status", "assurance_status", "recovery_ready", "recovery_point_at", "expires_at", "policy_id", "rpo_hours"], "MONITOR_OBSERVATION_BACKUP_FIELDS_INVALID");
  if (!new Set(["NOT_COLLECTED", "AVAILABLE"]).has(value.status)) reject("MONITOR_OBSERVATION_BACKUP_INVALID");
  if (value.status === "NOT_COLLECTED") {
    if ([value.observed_at, value.verification_status, value.identity_status, value.policy_status, value.assurance_status, value.recovery_point_at, value.expires_at, value.policy_id, value.rpo_hours].some((item) => item !== null) || value.recovery_ready !== false) reject("MONITOR_OBSERVATION_BACKUP_INVALID");
    return;
  }
  iso(value.observed_at, "MONITOR_OBSERVATION_BACKUP_INVALID");
  oneOf(value.verification_status, BACKUP_VERIFICATION, "MONITOR_OBSERVATION_BACKUP_INVALID");
  oneOf(value.identity_status, MATCH_STATUS, "MONITOR_OBSERVATION_BACKUP_INVALID");
  oneOf(value.policy_status, MATCH_STATUS, "MONITOR_OBSERVATION_BACKUP_INVALID");
  oneOf(value.assurance_status, MATCH_STATUS, "MONITOR_OBSERVATION_BACKUP_INVALID");
  if (typeof value.recovery_ready !== "boolean" || !IDENTIFIER.test(value.policy_id || "")) reject("MONITOR_OBSERVATION_BACKUP_INVALID");
  integer(value.rpo_hours, 1, 168, "MONITOR_OBSERVATION_BACKUP_INVALID");
  nullable(value.recovery_point_at, iso, "MONITOR_OBSERVATION_BACKUP_INVALID");
  nullable(value.expires_at, iso, "MONITOR_OBSERVATION_BACKUP_INVALID");
  if ((value.recovery_point_at === null) !== (value.expires_at === null)) reject("MONITOR_OBSERVATION_BACKUP_INVALID");
  if (value.recovery_ready && (value.verification_status !== "RESTORE_VERIFIED" || value.identity_status !== "MATCHED" || value.policy_status !== "MATCHED" || value.assurance_status !== "MATCHED" || value.recovery_point_at === null)) reject("MONITOR_OBSERVATION_BACKUP_INVALID");
}

function validateNotificationObservation(value) {
  exactKeys(value, ["status", "target_id"], "MONITOR_OBSERVATION_NOTIFICATION_FIELDS_INVALID");
  if (!new Set(["UNCONFIGURED", "READY"]).has(value.status) || (value.status === "READY" ? !IDENTIFIER.test(value.target_id || "") : value.target_id !== null)) reject("MONITOR_OBSERVATION_NOTIFICATION_INVALID");
}

export function validateMonitoringObservation(value) {
  exactKeys(value, ["schema_version", "contract", "observation_id", "observed_at", "source", "policy_sha256", "resource_policy_sha256", "host", "services", "application", "release", "backup", "notification"], "MONITOR_OBSERVATION_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_OBSERVATION_CONTRACT || !IDENTIFIER.test(value.observation_id || "") || !new Set(["HOST_METADATA_ONLY", "FULL", "SYNTHETIC_TEST"]).has(value.source) || !SHA256.test(value.policy_sha256 || "") || !SHA256.test(value.resource_policy_sha256 || "")) reject("MONITOR_OBSERVATION_IDENTITY_INVALID");
  iso(value.observed_at, "MONITOR_OBSERVATION_TIME_INVALID");
  exactKeys(value.host, ["boot_id_sha256", "monotonic_milliseconds", "available_memory_bytes", "swap_total_bytes", "swap_free_bytes", "root_free_bytes", "load_1m", "oom_kill_count"], "MONITOR_OBSERVATION_HOST_FIELDS_INVALID");
  bounded(value.host.boot_id_sha256, SHA256, "MONITOR_OBSERVATION_HOST_INVALID");
  integer(value.host.monotonic_milliseconds, 0, Number.MAX_SAFE_INTEGER, "MONITOR_OBSERVATION_HOST_INVALID");
  integer(value.host.available_memory_bytes, 0, Number.MAX_SAFE_INTEGER, "MONITOR_OBSERVATION_HOST_INVALID");
  integer(value.host.swap_total_bytes, 0, Number.MAX_SAFE_INTEGER, "MONITOR_OBSERVATION_HOST_INVALID");
  integer(value.host.swap_free_bytes, 0, value.host.swap_total_bytes, "MONITOR_OBSERVATION_HOST_INVALID");
  integer(value.host.root_free_bytes, 0, Number.MAX_SAFE_INTEGER, "MONITOR_OBSERVATION_HOST_INVALID");
  finite(value.host.load_1m, 0, 1_000_000, "MONITOR_OBSERVATION_HOST_INVALID");
  integer(value.host.oom_kill_count, 0, Number.MAX_SAFE_INTEGER, "MONITOR_OBSERVATION_HOST_INVALID");
  if (!Array.isArray(value.services) || value.services.length > SERVICES.length) reject("MONITOR_OBSERVATION_SERVICE_SET_INVALID");
  let previous = "";
  for (const service of value.services) {
    exactKeys(service, ["service", "container_name", "container_id", "image_id", "image_reference", "status", "health", "restart_count", "oom_killed"], "MONITOR_OBSERVATION_SERVICE_FIELDS_INVALID");
    if (!SERVICE_SET.has(service.service) || service.service <= previous || !IDENTIFIER.test(service.container_name || "") || !CONTAINER_ID.test(service.container_id || "") || !IMAGE_DIGEST.test(service.image_id || "") || !IMAGE_LOCATOR.test(service.image_reference || "") || !CONTAINER_STATUS.has(service.status) || !HEALTH.has(service.health)) reject("MONITOR_OBSERVATION_SERVICE_INVALID");
    integer(service.restart_count, 0, Number.MAX_SAFE_INTEGER, "MONITOR_OBSERVATION_SERVICE_INVALID");
    if (typeof service.oom_killed !== "boolean") reject("MONITOR_OBSERVATION_SERVICE_INVALID");
    previous = service.service;
  }
  validateApplicationObservation(value.application);
  validateReleaseObservation(value.release);
  validateBackupObservation(value.backup);
  validateNotificationObservation(value.notification);
  if (value.source === "HOST_METADATA_ONLY") {
    if (value.application.live.status !== "NOT_COLLECTED" || value.application.readiness.status !== "NOT_COLLECTED" || value.release.status !== "NOT_COLLECTED" || value.backup.status !== "NOT_COLLECTED" || value.notification.status !== "UNCONFIGURED") reject("MONITOR_OBSERVATION_SOURCE_INVALID");
  }
  if (value.source === "FULL" && (value.application.live.status === "NOT_COLLECTED" || value.application.readiness.status === "NOT_COLLECTED" || ["NOT_COLLECTED", "UNCONFIGURED"].includes(value.release.status) || value.backup.status === "NOT_COLLECTED")) reject("MONITOR_OBSERVATION_SOURCE_INVALID");
  return value;
}

function eventBody(value) {
  const body = { ...value };
  delete body.event_id;
  return body;
}

function validateMonitoringEvent(value, config) {
  exactKeys(value, ["schema_version", "contract", "event_id", "sequence", "event_type", "dedupe_key", "code", "severity", "message_zh", "runbook_ref", "first_observed_at", "observed_at", "delivery"], "MONITOR_EVENT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_EVENT_CONTRACT || !SHA256.test(value.event_id || "") || monitoringSha256(eventBody(value)) !== value.event_id) reject("MONITOR_EVENT_INTEGRITY_INVALID");
  integer(value.sequence, 1, Number.MAX_SAFE_INTEGER, "MONITOR_EVENT_SEQUENCE_INVALID");
  oneOf(value.event_type, new Set(["FIRING", "REMINDER", "ESCALATED", "RECOVERED"]), "MONITOR_EVENT_TYPE_INVALID");
  bounded(value.dedupe_key, IDENTIFIER, "MONITOR_EVENT_DEDUPE_INVALID");
  if (!Object.hasOwn(ALERT_DEFINITIONS, value.code) || !Object.hasOwn(SEVERITIES, value.severity)) reject("MONITOR_EVENT_CODE_INVALID");
  const definition = ALERT_DEFINITIONS[value.code];
  const message = value.event_type === "RECOVERED" ? `已恢复：${definition[1]}` : definition[1];
  if (value.message_zh !== message || value.runbook_ref !== definition[2] || value.severity !== definition[0]) reject("MONITOR_EVENT_MESSAGE_INVALID");
  iso(value.first_observed_at, "MONITOR_EVENT_TIME_INVALID");
  iso(value.observed_at, "MONITOR_EVENT_TIME_INVALID");
  if (Date.parse(value.first_observed_at) > Date.parse(value.observed_at)) reject("MONITOR_EVENT_TIME_INVALID");
  exactKeys(value.delivery, ["status", "target_id"], "MONITOR_EVENT_DELIVERY_FIELDS_INVALID");
  oneOf(value.delivery.status, new Set(["EVENT_FILE_ONLY", "NOT_CONFIGURED", "PENDING"]), "MONITOR_EVENT_DELIVERY_INVALID");
  if (value.delivery.status === "EVENT_FILE_ONLY") {
    if (config.notification.required || value.delivery.target_id !== null) reject("MONITOR_EVENT_DELIVERY_INVALID");
  } else if (!config.notification.required || value.delivery.target_id !== config.notification.target_id) reject("MONITOR_EVENT_DELIVERY_INVALID");
  return value;
}

function stateBody(value) {
  const body = { ...value };
  delete body.integrity_sha256;
  return body;
}

export function validateMonitoringState(value, config, policy) {
  exactKeys(value, ["schema_version", "contract", "deployment_id", "policy_sha256", "sequence", "previous_state_sha256", "last_observation_id", "last_observed_at", "last_boot_id_sha256", "last_monotonic_milliseconds", "last_oom_kill_count", "swap_samples", "load_samples", "service_instances", "active_alerts", "pending_events", "integrity_sha256"], "MONITOR_STATE_FIELDS_INVALID");
  const policySha = monitoringSha256(validateMonitoringPolicy(policy));
  if (value.schema_version !== 1 || value.contract !== MONITORING_STATE_CONTRACT || value.deployment_id !== config.deployment_id || value.policy_sha256 !== policySha || !SHA256.test(value.previous_state_sha256 || "") || !SHA256.test(value.integrity_sha256 || "") || monitoringSha256(stateBody(value)) !== value.integrity_sha256) reject("MONITOR_STATE_INTEGRITY_INVALID");
  integer(value.sequence, 1, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_SEQUENCE_INVALID");
  bounded(value.last_observation_id, IDENTIFIER, "MONITOR_STATE_OBSERVATION_INVALID");
  iso(value.last_observed_at, "MONITOR_STATE_OBSERVATION_INVALID");
  bounded(value.last_boot_id_sha256, SHA256, "MONITOR_STATE_HOST_INVALID");
  integer(value.last_monotonic_milliseconds, 0, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_HOST_INVALID");
  integer(value.last_oom_kill_count, 0, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_HOST_INVALID");
  for (const [name, maximum] of [["swap_samples", 16], ["load_samples", 16]]) {
    if (!Array.isArray(value[name]) || value[name].length < 1 || value[name].length > maximum) reject("MONITOR_STATE_SAMPLE_INVALID");
    let prior = -1;
    for (const sample of value[name]) {
      exactKeys(sample, ["observed_at", "monotonic_milliseconds", "value"], "MONITOR_STATE_SAMPLE_INVALID");
      iso(sample.observed_at, "MONITOR_STATE_SAMPLE_INVALID");
      integer(sample.monotonic_milliseconds, 0, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_SAMPLE_INVALID");
      finite(sample.value, 0, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_SAMPLE_INVALID");
      if (sample.monotonic_milliseconds <= prior) reject("MONITOR_STATE_SAMPLE_INVALID");
      prior = sample.monotonic_milliseconds;
    }
    if (value[name].at(-1).observed_at !== value.last_observed_at || value[name].at(-1).monotonic_milliseconds !== value.last_monotonic_milliseconds) reject("MONITOR_STATE_SAMPLE_INVALID");
  }
  if (!Array.isArray(value.service_instances) || value.service_instances.length > SERVICES.length) reject("MONITOR_STATE_SERVICE_INVALID");
  let priorService = "";
  for (const service of value.service_instances) {
    exactKeys(service, ["service", "container_id", "restart_count"], "MONITOR_STATE_SERVICE_INVALID");
    if (!SERVICE_SET.has(service.service) || service.service <= priorService || !CONTAINER_ID.test(service.container_id || "")) reject("MONITOR_STATE_SERVICE_INVALID");
    integer(service.restart_count, 0, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_SERVICE_INVALID");
    priorService = service.service;
  }
  if (!Array.isArray(value.active_alerts) || value.active_alerts.length > policy.max_active_alerts) reject("MONITOR_STATE_ALERT_INVALID");
  let priorKey = "";
  for (const alert of value.active_alerts) {
    exactKeys(alert, ["dedupe_key", "scope", "code", "severity", "first_observed_at", "last_observed_at", "observations", "last_event_at"], "MONITOR_STATE_ALERT_INVALID");
    if (!IDENTIFIER.test(alert.dedupe_key || "") || alert.dedupe_key <= priorKey || !IDENTIFIER.test(alert.scope || "") || !Object.hasOwn(ALERT_DEFINITIONS, alert.code) || alert.scope !== ALERT_DEFINITIONS[alert.code][3] && !alert.scope.startsWith(`${ALERT_DEFINITIONS[alert.code][3]}.`) || alert.severity !== ALERT_DEFINITIONS[alert.code][0]) reject("MONITOR_STATE_ALERT_INVALID");
    iso(alert.first_observed_at, "MONITOR_STATE_ALERT_INVALID");
    iso(alert.last_observed_at, "MONITOR_STATE_ALERT_INVALID");
    iso(alert.last_event_at, "MONITOR_STATE_ALERT_INVALID");
    integer(alert.observations, 1, Number.MAX_SAFE_INTEGER, "MONITOR_STATE_ALERT_INVALID");
    if (Date.parse(alert.first_observed_at) > Date.parse(alert.last_observed_at) || Date.parse(alert.last_event_at) > Date.parse(alert.last_observed_at)) reject("MONITOR_STATE_ALERT_INVALID");
    priorKey = alert.dedupe_key;
  }
  if (!Array.isArray(value.pending_events) || value.pending_events.length > policy.max_pending_events) reject("MONITOR_STATE_EVENT_INVALID");
  const eventIds = new Set();
  for (const event of value.pending_events) {
    validateMonitoringEvent(event, config);
    if (event.delivery.status === "EVENT_FILE_ONLY" || eventIds.has(event.event_id) || event.sequence > value.sequence) reject("MONITOR_STATE_EVENT_INVALID");
    eventIds.add(event.event_id);
  }
  return value;
}

function addIssue(target, code, dedupeKey, scope = null) {
  const definition = ALERT_DEFINITIONS[code];
  if (!definition || !IDENTIFIER.test(dedupeKey)) reject("MONITOR_ALERT_DEFINITION_INVALID");
  const resolvedScope = scope || definition[3];
  if (!IDENTIFIER.test(resolvedScope)) reject("MONITOR_ALERT_DEFINITION_INVALID");
  const candidate = Object.freeze({ dedupe_key: dedupeKey, scope: resolvedScope, code, severity: definition[0], message_zh: definition[1], runbook_ref: definition[2] });
  const previous = target.get(dedupeKey);
  if (!previous || SEVERITIES[candidate.severity] > SEVERITIES[previous.severity]) target.set(dedupeKey, candidate);
}

function windowWithBoundary(samples, start) {
  const before = [...samples].reverse().find((sample) => sample.monotonic_milliseconds <= start);
  const after = samples.filter((sample) => sample.monotonic_milliseconds > start);
  return before ? [before, ...after] : after;
}

function windowCovered(samples, start, maximumGapMs) {
  const window = windowWithBoundary(samples, start);
  if (window.length < 2 || window[0].monotonic_milliseconds > start) return false;
  for (let index = 1; index < window.length; index += 1) if (window[index].monotonic_milliseconds - window[index - 1].monotonic_milliseconds > maximumGapMs) return false;
  return true;
}

function eventFor(type, issue, active, observedAt, config, notification, sequence) {
  let delivery;
  if (!config.notification.required) delivery = { status: "EVENT_FILE_ONLY", target_id: null };
  else if (notification.status === "READY" && notification.target_id === config.notification.target_id) delivery = { status: "PENDING", target_id: config.notification.target_id };
  else delivery = { status: "NOT_CONFIGURED", target_id: config.notification.target_id };
  const body = {
    schema_version: 1,
    contract: MONITORING_EVENT_CONTRACT,
    event_id: "",
    sequence,
    event_type: type,
    dedupe_key: issue.dedupe_key,
    code: issue.code,
    severity: issue.severity,
    message_zh: type === "RECOVERED" ? `已恢复：${issue.message_zh}` : issue.message_zh,
    runbook_ref: issue.runbook_ref,
    first_observed_at: active.first_observed_at,
    observed_at: observedAt,
    delivery,
  };
  body.event_id = monitoringSha256(eventBody(body));
  validateMonitoringEvent(body, config);
  return Object.freeze(body);
}

function runtimeFailureCode(code) {
  if (code === "RUNTIME_MIGRATION_MISMATCH" || code === "RUNTIME_MIGRATION_SOURCE_INVALID") return "APPLICATION_MIGRATION_MISMATCH";
  return "APPLICATION_READINESS_FAILED";
}

function componentStale(observedAt, observationMs, policy) {
  const componentMs = Date.parse(observedAt);
  return componentMs > observationMs + policy.max_clock_skew_seconds * 1000 || observationMs - componentMs > policy.observation_max_age_seconds * 1000;
}

export function evaluateMonitoringObservation({ policy, resourcePlan, config, observation, previousState = null, now = new Date() }) {
  validateMonitoringPolicy(policy);
  const resourcePolicy = monitoringResourcePolicy(resourcePlan, policy);
  validateMonitoringConfig(config);
  validateMonitoringObservation(observation);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) reject("MONITOR_EVALUATION_TIME_INVALID");
  const policySha = monitoringSha256(policy);
  if (observation.policy_sha256 !== policySha || observation.resource_policy_sha256 !== policy.resource_policy_source.sha256) reject("MONITOR_OBSERVATION_POLICY_MISMATCH");
  if (previousState !== null) validateMonitoringState(previousState, config, policy);
  const observedMs = Date.parse(observation.observed_at);
  const nowMs = now.getTime();
  if (previousState && observedMs <= Date.parse(previousState.last_observed_at)) reject("MONITOR_OBSERVATION_TIME_ROLLBACK");
  const sameBoot = previousState?.last_boot_id_sha256 === observation.host.boot_id_sha256;
  if (sameBoot && observation.host.monotonic_milliseconds <= previousState.last_monotonic_milliseconds) reject("MONITOR_MONOTONIC_TIME_ROLLBACK");
  const issues = new Map();
  const unresolvedScopes = new Set();
  const observationUnreliable = nowMs - observedMs > policy.observation_max_age_seconds * 1000 || observedMs - nowMs > policy.max_clock_skew_seconds * 1000;
  if (nowMs - observedMs > policy.observation_max_age_seconds * 1000) addIssue(issues, "MONITOR_OBSERVATION_STALE", "monitor.observation.continuity");
  if (observedMs - nowMs > policy.max_clock_skew_seconds * 1000) addIssue(issues, "MONITOR_CLOCK_SKEW", "monitor.observation.skew");
  const gapMs = sameBoot ? observation.host.monotonic_milliseconds - previousState.last_monotonic_milliseconds : null;
  const stateGap = previousState === null || !sameBoot || gapMs > policy.max_sample_gap_seconds * 1000;
  if (previousState && stateGap) addIssue(issues, "MONITOR_STATE_GAP", "monitor.observation.continuity");
  if (previousState && !sameBoot) addIssue(issues, "HOST_REBOOT_DETECTED", "host.boot.changed");

  const mib = 1024 ** 2;
  const gib = 1024 ** 3;
  const swapUsedBytes = observation.host.swap_total_bytes - observation.host.swap_free_bytes;
  const swapUsedPercent = observation.host.swap_total_bytes === 0 ? 0 : swapUsedBytes / observation.host.swap_total_bytes * 100;
  if (observation.host.available_memory_bytes < resourcePolicy.min_available_memory_mib * mib) addIssue(issues, "HOST_MEMORY_AVAILABLE_LOW", "host.memory.available");
  if (swapUsedPercent > resourcePolicy.max_swap_used_percent) addIssue(issues, "HOST_SWAP_USAGE_HIGH", "host.swap.percent");
  if (observation.host.root_free_bytes < resourcePolicy.min_root_free_gib * gib) addIssue(issues, "HOST_ROOT_FREE_LOW", "host.disk.root");
  if (observation.host.oom_kill_count > 0) addIssue(issues, "HOST_OOM_HISTORY_PRESENT", "host.oom.history");
  if (previousState && sameBoot && observation.host.oom_kill_count > previousState.last_oom_kill_count) addIssue(issues, "HOST_OOM_DETECTED", "host.oom.increment");
  if (previousState && sameBoot && observation.host.oom_kill_count < previousState.last_oom_kill_count) reject("MONITOR_OOM_COUNTER_ROLLBACK");

  const sampleGapMs = policy.max_sample_gap_seconds * 1000;
  const monotonic = observation.host.monotonic_milliseconds;
  const previousSwap = stateGap ? [] : previousState.swap_samples;
  const swapSamples = [...previousSwap, { observed_at: observation.observed_at, monotonic_milliseconds: monotonic, value: swapUsedBytes }].filter((sample) => sample.monotonic_milliseconds >= monotonic - 60_000 - sampleGapMs).slice(-16);
  const swapStart = monotonic - 60_000;
  const swapWindow = windowWithBoundary(swapSamples, swapStart);
  if (!windowCovered(swapSamples, swapStart, sampleGapMs)) {
    unresolvedScopes.add("host.swap.growth");
    addIssue(issues, "MONITOR_SWAP_WINDOW_INCOMPLETE", "monitor.window.swap");
  } else if (swapUsedBytes - Math.min(...swapWindow.map((sample) => sample.value)) > resourcePolicy.max_swap_growth_mib_60s * mib) addIssue(issues, "HOST_SWAP_GROWTH_HIGH", "host.swap.growth");

  const loadWindowMs = 180_000;
  const previousLoad = stateGap ? [] : previousState.load_samples;
  const loadSamples = [...previousLoad, { observed_at: observation.observed_at, monotonic_milliseconds: monotonic, value: observation.host.load_1m }].filter((sample) => sample.monotonic_milliseconds >= monotonic - loadWindowMs - sampleGapMs).slice(-16);
  const loadStart = monotonic - loadWindowMs;
  const loadWindow = windowWithBoundary(loadSamples, loadStart);
  if (!windowCovered(loadSamples, loadStart, sampleGapMs)) {
    unresolvedScopes.add("host.load.sustained");
    addIssue(issues, "MONITOR_LOAD_WINDOW_INCOMPLETE", "monitor.window.load");
  } else if (loadWindow.every((sample) => sample.value > resourcePolicy.max_load_1m)) addIssue(issues, "HOST_LOAD_SUSTAINED_HIGH", "host.load.sustained");

  const observedServices = new Map(observation.services.map((service) => [service.service, service]));
  const priorServices = new Map((previousState?.service_instances || []).map((service) => [service.service, service]));
  const healthPolicy = new Map(policy.service_health.map((entry) => [entry.service, entry.health_required]));
  for (const expected of config.service_expectations) {
    const scope = `service.${expected.service}`;
    const actual = observedServices.get(expected.service);
    if (!actual) {
      unresolvedScopes.add(scope);
      addIssue(issues, "SERVICE_MISSING", `${scope}.missing`, scope);
      continue;
    }
    const prior = priorServices.get(expected.service);
    if (prior && prior.container_id === actual.container_id && actual.restart_count < prior.restart_count) reject("MONITOR_SERVICE_COUNTER_ROLLBACK");
    if (prior && prior.container_id !== actual.container_id) addIssue(issues, "SERVICE_INSTANCE_CHANGED", `${scope}.instance`, scope);
    if (actual.container_name !== expected.container_name) addIssue(issues, "SERVICE_CONTAINER_MISMATCH", `${scope}.container`, scope);
    if (actual.image_reference !== expected.image_reference) addIssue(issues, "SERVICE_IMAGE_MISMATCH", `${scope}.image`, scope);
    if (actual.status !== "running") addIssue(issues, "SERVICE_NOT_RUNNING", `${scope}.status`, scope);
    if (actual.restart_count !== 0) addIssue(issues, "SERVICE_RESTARTED", `${scope}.restart`, scope);
    if (actual.oom_killed) addIssue(issues, "SERVICE_OOM_KILLED", `${scope}.oom`, scope);
    if (actual.health === "none" && healthPolicy.get(expected.service)) addIssue(issues, "SERVICE_HEALTH_UNAVAILABLE", `${scope}.health`, scope);
    else if (actual.health !== "none" && actual.health !== "healthy") addIssue(issues, "SERVICE_HEALTH_UNHEALTHY", `${scope}.health`, scope);
  }

  if (observation.application.live.status === "NOT_COLLECTED") {
    unresolvedScopes.add("application.live");
    unresolvedScopes.add("application.identity");
    addIssue(issues, "APPLICATION_LIVENESS_UNAVAILABLE", "application.live.evidence");
  } else if (componentStale(observation.application.live.observed_at, observedMs, policy)) {
    unresolvedScopes.add("application.live");
    unresolvedScopes.add("application.identity");
    addIssue(issues, "APPLICATION_LIVENESS_STALE", "application.live.stale");
  } else if (observation.application.live.status === "FAIL") {
    unresolvedScopes.add("application.identity");
    addIssue(issues, "APPLICATION_LIVENESS_FAILED", "application.live");
  }
  else if (observation.application.live.version !== config.release_expectation.application_version) addIssue(issues, "APPLICATION_IDENTITY_MISMATCH", "application.live.identity");

  if (observation.application.readiness.status === "NOT_COLLECTED") {
    unresolvedScopes.add("application.readiness");
    unresolvedScopes.add("application.identity");
    unresolvedScopes.add("application.migration");
    addIssue(issues, "APPLICATION_READINESS_UNAVAILABLE", "application.readiness.evidence");
  } else if (componentStale(observation.application.readiness.observed_at, observedMs, policy)) {
    unresolvedScopes.add("application.readiness");
    unresolvedScopes.add("application.identity");
    unresolvedScopes.add("application.migration");
    addIssue(issues, "APPLICATION_READINESS_STALE", "application.readiness.stale");
  } else if (observation.application.readiness.status === "NOT_READY") {
    unresolvedScopes.add("application.identity");
    unresolvedScopes.add("application.migration");
    addIssue(issues, runtimeFailureCode(observation.application.readiness.code), "application.readiness");
  }
  else {
    if (observation.application.readiness.version !== config.release_expectation.application_version || observation.application.readiness.revision !== config.release_expectation.git_commit.slice(0, 12)) addIssue(issues, "APPLICATION_IDENTITY_MISMATCH", "application.readiness.identity");
    if (observation.application.readiness.migration_head !== config.release_expectation.migration_head) addIssue(issues, "APPLICATION_MIGRATION_MISMATCH", "application.readiness.migration");
  }

  if (observation.release.status === "NOT_COLLECTED" || observation.release.status === "UNCONFIGURED") {
    unresolvedScopes.add("release.identity");
    addIssue(issues, "RELEASE_IDENTITY_UNAVAILABLE", "release.identity.evidence");
  } else if (observation.release.status === "INVALID") {
    unresolvedScopes.add("release.identity");
    addIssue(issues, "RELEASE_IDENTITY_INVALID", "release.identity");
  } else {
    const expected = config.release_expectation;
    const match = observation.release.status === "MATCHED"
      && observation.release.release_manifest_sha256 === expected.release_manifest_sha256
      && observation.release.supervisor_bundle_sha256 === expected.supervisor_bundle_sha256
      && observation.release.application_version === expected.application_version
      && observation.release.git_commit === expected.git_commit
      && observation.release.migration_head === expected.migration_head
      && observation.release.migration_manifest_sha256 === expected.migration_manifest_sha256
      && observation.release.web_image_digest === expected.web_image_digest
      && observation.release.worker_image_digest === expected.worker_image_digest;
    if (!match) addIssue(issues, "RELEASE_IDENTITY_MISMATCH", "release.identity");
    if (componentStale(observation.release.observed_at, observedMs, policy) || nowMs - Date.parse(observation.release.generated_at) > policy.release_identity_max_age_seconds * 1000 || Date.parse(observation.release.generated_at) - nowMs > policy.max_clock_skew_seconds * 1000) {
      unresolvedScopes.add("release.identity");
      addIssue(issues, "RELEASE_IDENTITY_STALE", "release.identity.age");
    }
  }

  if (observation.backup.status === "NOT_COLLECTED") {
    unresolvedScopes.add("backup");
    addIssue(issues, "BACKUP_EVIDENCE_UNAVAILABLE", "backup.evidence.missing");
  } else {
    const backupInvalid = ["INVALID", "UNVERIFIED", "LEGACY_LOCAL_ONLY"].includes(observation.backup.verification_status);
    const backupStale = componentStale(observation.backup.observed_at, observedMs, policy) || observation.backup.verification_status === "STALE" || (observation.backup.expires_at && nowMs > Date.parse(observation.backup.expires_at)) || (observation.backup.recovery_point_at && nowMs > Date.parse(observation.backup.recovery_point_at) + config.backup_expectation.rpo_hours * 3_600_000);
    if (backupInvalid || backupStale) unresolvedScopes.add("backup");
    if (backupInvalid) addIssue(issues, "BACKUP_EVIDENCE_INVALID", "backup.evidence");
    if (backupStale) addIssue(issues, "BACKUP_EVIDENCE_STALE", "backup.evidence.age");
    if (observation.backup.identity_status !== "MATCHED") addIssue(issues, "BACKUP_IDENTITY_MISMATCH", "backup.identity");
    if (observation.backup.policy_status !== "MATCHED" || observation.backup.policy_id !== config.backup_expectation.policy_id || observation.backup.rpo_hours !== config.backup_expectation.rpo_hours) addIssue(issues, "BACKUP_POLICY_MISMATCH", "backup.policy");
    if (observation.backup.assurance_status !== "MATCHED") addIssue(issues, "BACKUP_ASSURANCE_MISMATCH", "backup.assurance");
    if (observation.backup.verification_status !== policy.backup.required_verification_status || observation.backup.recovery_ready !== true) addIssue(issues, "BACKUP_RECOVERY_NOT_READY", "backup.recovery");
  }
  if (config.notification.required && (observation.notification.status !== "READY" || observation.notification.target_id !== config.notification.target_id)) addIssue(issues, "ALERT_DELIVERY_NOT_CONFIGURED", "alert.delivery");
  if (issues.size > policy.max_active_alerts) reject("MONITOR_ACTIVE_ALERT_LIMIT_EXCEEDED");

  const previousAlerts = new Map((previousState?.active_alerts || []).map((alert) => [alert.dedupe_key, alert]));
  const activeAlerts = [];
  const events = [];
  const sequence = (previousState?.sequence || 0) + 1;
  for (const issue of [...issues.values()].sort((left, right) => left.dedupe_key.localeCompare(right.dedupe_key))) {
    const prior = previousAlerts.get(issue.dedupe_key);
    let eventType = null;
    if (!prior) eventType = "FIRING";
    else if (SEVERITIES[issue.severity] > SEVERITIES[prior.severity]) eventType = "ESCALATED";
    else if (observedMs - Date.parse(prior.last_event_at) >= policy.reminder_interval_seconds * 1000) eventType = "REMINDER";
    const active = {
      dedupe_key: issue.dedupe_key,
      scope: issue.scope,
      code: issue.code,
      severity: issue.severity,
      first_observed_at: prior?.first_observed_at || observation.observed_at,
      last_observed_at: observation.observed_at,
      observations: (prior?.observations || 0) + 1,
      last_event_at: eventType ? observation.observed_at : prior.last_event_at,
    };
    activeAlerts.push(active);
    if (eventType) events.push(eventFor(eventType, issue, active, observation.observed_at, config, observation.notification, sequence));
    previousAlerts.delete(issue.dedupe_key);
  }
  for (const prior of [...previousAlerts.values()].sort((left, right) => left.dedupe_key.localeCompare(right.dedupe_key))) {
    if (observationUnreliable || [...unresolvedScopes].some((scope) => prior.scope === scope || prior.scope.startsWith(`${scope}.`))) {
      activeAlerts.push(prior);
      continue;
    }
    const definition = ALERT_DEFINITIONS[prior.code];
    const issue = { dedupe_key: prior.dedupe_key, scope: prior.scope, code: prior.code, severity: prior.severity, message_zh: definition[1], runbook_ref: definition[2] };
    events.push(eventFor("RECOVERED", issue, prior, observation.observed_at, config, observation.notification, sequence));
  }
  activeAlerts.sort((left, right) => left.dedupe_key.localeCompare(right.dedupe_key));
  events.sort((left, right) => left.dedupe_key.localeCompare(right.dedupe_key) || left.event_type.localeCompare(right.event_type));
  const newlyPending = events.filter((event) => event.delivery.status !== "EVENT_FILE_ONLY");
  const pendingEvents = [...(previousState?.pending_events || []), ...newlyPending];
  if (pendingEvents.length > policy.max_pending_events) reject("MONITOR_PENDING_EVENT_LIMIT_EXCEEDED");
  const nextState = {
    schema_version: 1,
    contract: MONITORING_STATE_CONTRACT,
    deployment_id: config.deployment_id,
    policy_sha256: policySha,
    sequence,
    previous_state_sha256: previousState?.integrity_sha256 || ZERO_SHA256,
    last_observation_id: observation.observation_id,
    last_observed_at: observation.observed_at,
    last_boot_id_sha256: observation.host.boot_id_sha256,
    last_monotonic_milliseconds: observation.host.monotonic_milliseconds,
    last_oom_kill_count: observation.host.oom_kill_count,
    swap_samples: swapSamples,
    load_samples: loadSamples,
    service_instances: observation.services.map((service) => ({ service: service.service, container_id: service.container_id, restart_count: service.restart_count })),
    active_alerts: activeAlerts,
    pending_events: pendingEvents,
    integrity_sha256: "",
  };
  nextState.integrity_sha256 = monitoringSha256(stateBody(nextState));
  validateMonitoringState(nextState, config, policy);
  const alertView = activeAlerts.map((active) => {
    const definition = ALERT_DEFINITIONS[active.code];
    return Object.freeze({ ...active, message_zh: definition[1], runbook_ref: definition[2] });
  });
  const hasCritical = activeAlerts.some((alert) => alert.severity === "CRITICAL");
  const status = hasCritical ? "CRITICAL" : activeAlerts.length ? "DEGRADED" : "HEALTHY";
  const deliveryState = pendingEvents.some((event) => event.delivery.status === "NOT_CONFIGURED") ? "NOT_CONFIGURED" : pendingEvents.length ? "PENDING" : config.notification.required ? "IDLE" : "EVENT_FILE_ONLY";
  const report = Object.freeze({
    schema_version: 1,
    contract: MONITORING_REPORT_CONTRACT,
    report_id: monitoringSha256({ deployment_id: config.deployment_id, observation_id: observation.observation_id, state_sequence: sequence }),
    deployment_class: config.deployment_class,
    deployment_id: config.deployment_id,
    observation_id: observation.observation_id,
    observed_at: observation.observed_at,
    evaluated_at: now.toISOString(),
    state_sequence: sequence,
    status,
    active_alert_count: alertView.length,
    active_alerts: Object.freeze(alertView),
    events: Object.freeze(events),
    pending_event_count: pendingEvents.length,
    delivery_state: deliveryState,
    exit_code: pendingEvents.length ? 2 : activeAlerts.length ? 1 : 0,
  });
  return Object.freeze({ report, nextState: Object.freeze(nextState) });
}

export function emptyComponentObservation() {
  return Object.freeze({
    application: Object.freeze({
      live: Object.freeze({ status: "NOT_COLLECTED", observed_at: null, version: null, code: null }),
      readiness: Object.freeze({ status: "NOT_COLLECTED", observed_at: null, version: null, revision: null, migration_head: null, code: null }),
    }),
    release: Object.freeze({ status: "NOT_COLLECTED", observed_at: null, generated_at: null, release_manifest_sha256: null, supervisor_bundle_sha256: null, application_version: null, git_commit: null, migration_head: null, migration_manifest_sha256: null, web_image_digest: null, worker_image_digest: null }),
    backup: Object.freeze({ status: "NOT_COLLECTED", observed_at: null, verification_status: null, identity_status: null, policy_status: null, assurance_status: null, recovery_ready: false, recovery_point_at: null, expires_at: null, policy_id: null, rpo_hours: null }),
    notification: Object.freeze({ status: "UNCONFIGURED", target_id: null }),
  });
}
