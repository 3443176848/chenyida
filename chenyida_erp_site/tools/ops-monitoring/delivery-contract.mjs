import {
  OpsMonitoringError,
  canonicalMonitoringJson,
  monitoringSha256,
  validateMonitoringConfig,
  validateMonitoringEvent,
} from "./contract.mjs";

export const MONITORING_HOST_CONFIG_CONTRACT = "chenyida-erp-monitoring-host-config/v1";
export const MONITORING_EVALUATOR_CONFIG_CONTRACT = "chenyida-erp-monitoring-evaluator-config/v1";
export const MONITORING_NOTIFIER_CONFIG_CONTRACT = "chenyida-erp-monitoring-notifier-config/v1";
export const MONITORING_DELIVERY_ENVELOPE_CONTRACT = "chenyida-erp-monitoring-delivery-envelope/v1";
export const MONITORING_DELIVERY_GRANT_CONTRACT = "chenyida-erp-monitoring-delivery-grant/v1";
export const MONITORING_DELIVERY_CLAIM_CONTRACT = "chenyida-erp-monitoring-delivery-claim/v1";
export const MONITORING_DELIVERY_ATTEMPT_CONTRACT = "chenyida-erp-monitoring-delivery-attempt/v2";
export const MONITORING_DELIVERY_RESULT_CONTRACT = "chenyida-erp-monitoring-delivery-result/v1";
export const MONITORING_DELIVERY_ACK_CONTRACT = "chenyida-erp-monitoring-delivery-ack/v1";
export const MONITORING_DELIVERY_READINESS_CONTRACT = "chenyida-erp-monitoring-delivery-readiness/v2";
export const MONITORING_REMOTE_ACK_CONTRACT = "chenyida-erp-monitoring-remote-ack/v1";

export const MONITORING_PRIVATE_CONFIG_PATH = "/etc/chenyida-erp/monitoring-v1/private/host-config.json";
export const MONITORING_CREDENTIAL_SOURCE_PATH = "/etc/chenyida-erp/monitoring-v1/private/notification.credential";
export const MONITORING_COMPONENTS_PROJECTION_PATH = "/var/lib/chenyida-erp/monitoring-v1/projections/components.json";
export const MONITORING_BACKUP_PROJECTION_PATH = "/var/lib/chenyida-erp/monitoring-v1/projections/backup.json";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,30}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HTTPS_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,1023}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZERO_SHA256 = "0".repeat(64);

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

function identifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code);
  return value;
}

function digest(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) reject(code);
  return value;
}

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function validateInstallation(value) {
  exactKeys(value, ["activation_id", "installation_generation", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "state_schema_min", "state_schema_max"], "MONITOR_HOST_INSTALLATION_FIELDS_INVALID");
  identifier(value.activation_id, "MONITOR_HOST_INSTALLATION_INVALID");
  integer(value.installation_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_INSTALLATION_INVALID");
  digest(value.monitoring_bundle_sha256, "MONITOR_HOST_INSTALLATION_INVALID");
  digest(value.supervisor_bundle_sha256, "MONITOR_HOST_INSTALLATION_INVALID");
  integer(value.state_schema_min, 1, 32, "MONITOR_HOST_INSTALLATION_INVALID");
  integer(value.state_schema_max, value.state_schema_min, 32, "MONITOR_HOST_INSTALLATION_INVALID");
  if (value.state_schema_min !== 1 || value.state_schema_max !== 1) reject("MONITOR_HOST_STATE_SCHEMA_UNSUPPORTED");
  return value;
}

function validateIdentity(value, expectedUser, code) {
  exactKeys(value, ["user", "uid", "gid"], `${code}_FIELDS_INVALID`);
  if (value.user !== expectedUser || !ACCOUNT.test(value.user)) reject(code);
  integer(value.uid, 1, 2 ** 31 - 1, code);
  integer(value.gid, 1, 2 ** 31 - 1, code);
  return value;
}

function validateEvidence(value) {
  exactKeys(value, ["components_projection_path", "backup_projection_path", "release_activation_id", "release_activated_at", "postdeploy_receipt_sha256", "components_producer_bundle_sha256", "backup_producer_bundle_sha256", "minimum_components_projection_generation", "minimum_backup_projection_generation"], "MONITOR_HOST_EVIDENCE_FIELDS_INVALID");
  if (value.components_projection_path !== MONITORING_COMPONENTS_PROJECTION_PATH || value.backup_projection_path !== MONITORING_BACKUP_PROJECTION_PATH) reject("MONITOR_HOST_EVIDENCE_PATH_INVALID");
  identifier(value.release_activation_id, "MONITOR_HOST_EVIDENCE_INVALID");
  iso(value.release_activated_at, "MONITOR_HOST_EVIDENCE_INVALID");
  digest(value.postdeploy_receipt_sha256, "MONITOR_HOST_EVIDENCE_INVALID");
  digest(value.components_producer_bundle_sha256, "MONITOR_HOST_EVIDENCE_INVALID");
  digest(value.backup_producer_bundle_sha256, "MONITOR_HOST_EVIDENCE_INVALID");
  integer(value.minimum_components_projection_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_EVIDENCE_INVALID");
  integer(value.minimum_backup_projection_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_EVIDENCE_INVALID");
  return value;
}

function validateEndpoint(value, adapterId) {
  exactKeys(value, ["scheme", "host", "port", "path", "tls_server_name"], "MONITOR_HOST_ENDPOINT_FIELDS_INVALID");
  if (adapterId === "SYNTHETIC_FAKE_ACK_V1") {
    if (Object.values(value).some((item) => item !== null)) reject("MONITOR_HOST_FAKE_ENDPOINT_INVALID");
    return value;
  }
  if (value.scheme !== "https" || typeof value.host !== "string" || !HOST.test(value.host) || typeof value.tls_server_name !== "string" || !HOST.test(value.tls_server_name) || value.host !== value.tls_server_name || typeof value.path !== "string" || !HTTPS_PATH.test(value.path)) reject("MONITOR_HOST_ENDPOINT_INVALID");
  integer(value.port, 1, 65_535, "MONITOR_HOST_ENDPOINT_INVALID");
  return value;
}

function validateNotification(value, deploymentClass) {
  exactKeys(value, ["required", "target_id", "target_generation", "adapter", "endpoint", "credential", "ack", "oncall_roster_generation", "escalation_table_sha256"], "MONITOR_HOST_NOTIFICATION_FIELDS_INVALID");
  if (value.required !== true || deploymentClass === "TEST" && typeof value.required !== "boolean") reject("MONITOR_HOST_NOTIFICATION_REQUIRED");
  identifier(value.target_id, "MONITOR_HOST_NOTIFICATION_INVALID");
  integer(value.target_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_NOTIFICATION_INVALID");
  exactKeys(value.adapter, ["id", "version", "source_sha256"], "MONITOR_HOST_ADAPTER_FIELDS_INVALID");
  if (!new Set(["HTTPS_JSON_ACK_V1", "SYNTHETIC_FAKE_ACK_V1"]).has(value.adapter.id) || value.adapter.version !== 1) reject("MONITOR_HOST_ADAPTER_INVALID");
  if (value.adapter.id === "SYNTHETIC_FAKE_ACK_V1" && deploymentClass !== "TEST") reject("MONITOR_HOST_FAKE_ADAPTER_FORBIDDEN");
  digest(value.adapter.source_sha256, "MONITOR_HOST_ADAPTER_INVALID");
  validateEndpoint(value.endpoint, value.adapter.id);
  exactKeys(value.credential, ["source_file", "sha256", "generation"], "MONITOR_HOST_CREDENTIAL_FIELDS_INVALID");
  if (value.credential.source_file !== MONITORING_CREDENTIAL_SOURCE_PATH) reject("MONITOR_HOST_CREDENTIAL_PATH_INVALID");
  digest(value.credential.sha256, "MONITOR_HOST_CREDENTIAL_INVALID");
  integer(value.credential.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_CREDENTIAL_INVALID");
  exactKeys(value.ack, ["contract", "timeout_milliseconds", "claim_ttl_seconds", "retry_backoff_seconds", "max_attempts"], "MONITOR_HOST_ACK_FIELDS_INVALID");
  if (value.ack.contract !== MONITORING_REMOTE_ACK_CONTRACT) reject("MONITOR_HOST_ACK_INVALID");
  integer(value.ack.timeout_milliseconds, 500, 15_000, "MONITOR_HOST_ACK_INVALID");
  integer(value.ack.claim_ttl_seconds, 15, 300, "MONITOR_HOST_ACK_INVALID");
  integer(value.ack.retry_backoff_seconds, 15, 3600, "MONITOR_HOST_ACK_INVALID");
  integer(value.ack.max_attempts, 1, 32, "MONITOR_HOST_ACK_INVALID");
  integer(value.oncall_roster_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_ONCALL_INVALID");
  digest(value.escalation_table_sha256, "MONITOR_HOST_ONCALL_INVALID");
  return value;
}

export function validateMonitoringHostConfig(value) {
  exactKeys(value, ["schema_version", "contract", "config_id", "config_generation", "previous_config_sha256", "deployment", "installation", "identities", "monitoring", "evidence", "notification"], "MONITOR_HOST_CONFIG_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_HOST_CONFIG_CONTRACT) reject("MONITOR_HOST_CONFIG_VERSION_INVALID");
  identifier(value.config_id, "MONITOR_HOST_CONFIG_ID_INVALID");
  integer(value.config_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_CONFIG_GENERATION_INVALID");
  digest(value.previous_config_sha256, "MONITOR_HOST_CONFIG_GENERATION_INVALID");
  if ((value.config_generation === 1) !== (value.previous_config_sha256 === ZERO_SHA256)) reject("MONITOR_HOST_CONFIG_GENERATION_INVALID");
  exactKeys(value.deployment, ["class", "id", "compose_project"], "MONITOR_HOST_DEPLOYMENT_FIELDS_INVALID");
  if (!new Set(["TEST", "UAT", "PRODUCTION"]).has(value.deployment.class)) reject("MONITOR_HOST_DEPLOYMENT_INVALID");
  identifier(value.deployment.id, "MONITOR_HOST_DEPLOYMENT_INVALID");
  identifier(value.deployment.compose_project, "MONITOR_HOST_DEPLOYMENT_INVALID");
  validateInstallation(value.installation);
  exactKeys(value.identities, ["evaluator", "notifier"], "MONITOR_HOST_IDENTITIES_FIELDS_INVALID");
  validateIdentity(value.identities.evaluator, "chenyida-monitor-eval", "MONITOR_HOST_EVALUATOR_IDENTITY_INVALID");
  validateIdentity(value.identities.notifier, "chenyida-monitor-notify", "MONITOR_HOST_NOTIFIER_IDENTITY_INVALID");
  if (value.identities.evaluator.uid === value.identities.notifier.uid || value.identities.evaluator.gid === value.identities.notifier.gid) reject("MONITOR_HOST_IDENTITY_SEPARATION_INVALID");
  validateMonitoringConfig(value.monitoring);
  if (value.monitoring.deployment_class !== value.deployment.class || value.monitoring.deployment_id !== value.deployment.id || value.monitoring.compose_project !== value.deployment.compose_project) reject("MONITOR_HOST_MONITORING_DEPLOYMENT_MISMATCH");
  validateEvidence(value.evidence);
  validateNotification(value.notification, value.deployment.class);
  if (value.monitoring.notification.required !== value.notification.required || value.monitoring.notification.target_id !== value.notification.target_id) reject("MONITOR_HOST_NOTIFICATION_BINDING_INVALID");
  return value;
}

export function monitoringHostConfigSha256(value) {
  return monitoringSha256(validateMonitoringHostConfig(value));
}

export function deriveMonitoringHostConfigViews(value) {
  const host = validateMonitoringHostConfig(value);
  const hostConfigSha256 = monitoringSha256(host);
  const common = {
    schema_version: 1,
    config_id: host.config_id,
    config_generation: host.config_generation,
    previous_config_sha256: host.previous_config_sha256,
    host_config_sha256: hostConfigSha256,
    deployment: host.deployment,
    installation: host.installation,
  };
  const notifier = {
    ...common,
    contract: MONITORING_NOTIFIER_CONFIG_CONTRACT,
    identity: host.identities.notifier,
    evaluator_identity: host.identities.evaluator,
    notification: host.notification,
  };
  const evaluator = {
    ...common,
    contract: MONITORING_EVALUATOR_CONFIG_CONTRACT,
    identity: host.identities.evaluator,
    notifier_identity: host.identities.notifier,
    monitoring: host.monitoring,
    evidence: host.evidence,
    notification: { required: host.notification.required, target_id: host.notification.target_id, target_generation: host.notification.target_generation, notifier_config_sha256: monitoringSha256(notifier) },
  };
  return Object.freeze({ evaluator: Object.freeze(validateMonitoringEvaluatorConfig(evaluator)), notifier: Object.freeze(validateMonitoringNotifierConfig(notifier)) });
}

function validateViewCommon(value, contract, extraFields, code) {
  exactKeys(value, ["schema_version", "contract", "config_id", "config_generation", "previous_config_sha256", "host_config_sha256", "deployment", "installation", ...extraFields], `${code}_FIELDS_INVALID`);
  if (value.schema_version !== 1 || value.contract !== contract) reject(`${code}_VERSION_INVALID`);
  identifier(value.config_id, `${code}_INVALID`);
  integer(value.config_generation, 1, Number.MAX_SAFE_INTEGER, `${code}_INVALID`);
  digest(value.previous_config_sha256, `${code}_INVALID`);
  digest(value.host_config_sha256, `${code}_INVALID`);
  exactKeys(value.deployment, ["class", "id", "compose_project"], `${code}_DEPLOYMENT_INVALID`);
  if (!new Set(["TEST", "UAT", "PRODUCTION"]).has(value.deployment.class)) reject(`${code}_DEPLOYMENT_INVALID`);
  identifier(value.deployment.id, `${code}_DEPLOYMENT_INVALID`);
  identifier(value.deployment.compose_project, `${code}_DEPLOYMENT_INVALID`);
  validateInstallation(value.installation);
}

export function validateMonitoringEvaluatorConfig(value) {
  validateViewCommon(value, MONITORING_EVALUATOR_CONFIG_CONTRACT, ["identity", "notifier_identity", "monitoring", "evidence", "notification"], "MONITOR_EVALUATOR_CONFIG");
  validateIdentity(value.identity, "chenyida-monitor-eval", "MONITOR_HOST_EVALUATOR_IDENTITY_INVALID");
  validateIdentity(value.notifier_identity, "chenyida-monitor-notify", "MONITOR_HOST_NOTIFIER_IDENTITY_INVALID");
  validateMonitoringConfig(value.monitoring);
  validateEvidence(value.evidence);
  exactKeys(value.notification, ["required", "target_id", "target_generation", "notifier_config_sha256"], "MONITOR_EVALUATOR_NOTIFICATION_FIELDS_INVALID");
  if (value.notification.required !== true) reject("MONITOR_EVALUATOR_NOTIFICATION_INVALID");
  identifier(value.notification.target_id, "MONITOR_EVALUATOR_NOTIFICATION_INVALID");
  integer(value.notification.target_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_EVALUATOR_NOTIFICATION_INVALID");
  digest(value.notification.notifier_config_sha256, "MONITOR_EVALUATOR_NOTIFICATION_INVALID");
  return value;
}

export function validateMonitoringNotifierConfig(value) {
  validateViewCommon(value, MONITORING_NOTIFIER_CONFIG_CONTRACT, ["identity", "evaluator_identity", "notification"], "MONITOR_NOTIFIER_CONFIG");
  validateIdentity(value.identity, "chenyida-monitor-notify", "MONITOR_HOST_NOTIFIER_IDENTITY_INVALID");
  validateIdentity(value.evaluator_identity, "chenyida-monitor-eval", "MONITOR_HOST_EVALUATOR_IDENTITY_INVALID");
  validateNotification(value.notification, value.deployment.class);
  return value;
}

function hashIdentity(value, field, code) {
  const body = { ...value };
  delete body[field];
  const expected = monitoringSha256(body);
  if (value[field] !== expected) reject(code);
}

export function createDeliveryEnvelope({ event, evaluatorConfig }) {
  validateMonitoringEvent(event);
  validateMonitoringEvaluatorConfig(evaluatorConfig);
  if (event.delivery.status === "EVENT_FILE_ONLY" || event.delivery.target_id !== evaluatorConfig.notification.target_id) reject("MONITOR_DELIVERY_EVENT_TARGET_INVALID");
  const envelope = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_ENVELOPE_CONTRACT,
    envelope_id: "",
    event_id: event.event_id,
    event_sha256: monitoringSha256(event),
    event,
    deployment_id: evaluatorConfig.deployment.id,
    config_id: evaluatorConfig.config_id,
    config_generation: evaluatorConfig.config_generation,
    host_config_sha256: evaluatorConfig.host_config_sha256,
    target_id: evaluatorConfig.notification.target_id,
    target_generation: evaluatorConfig.notification.target_generation,
    created_at: event.observed_at,
  };
  envelope.envelope_id = monitoringSha256({ ...envelope, envelope_id: undefined });
  return Object.freeze(validateDeliveryEnvelope(envelope));
}

export function validateDeliveryEnvelope(value) {
  exactKeys(value, ["schema_version", "contract", "envelope_id", "event_id", "event_sha256", "event", "deployment_id", "config_id", "config_generation", "host_config_sha256", "target_id", "target_generation", "created_at"], "MONITOR_DELIVERY_ENVELOPE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_DELIVERY_ENVELOPE_CONTRACT) reject("MONITOR_DELIVERY_ENVELOPE_VERSION_INVALID");
  digest(value.envelope_id, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  digest(value.event_id, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  digest(value.event_sha256, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  validateMonitoringEvent(value.event);
  if (value.event.event_id !== value.event_id || monitoringSha256(value.event) !== value.event_sha256 || value.event.delivery.target_id !== value.target_id || value.event.delivery.status === "EVENT_FILE_ONLY") reject("MONITOR_DELIVERY_ENVELOPE_EVENT_INVALID");
  identifier(value.deployment_id, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  identifier(value.config_id, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  integer(value.config_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  digest(value.host_config_sha256, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  identifier(value.target_id, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  integer(value.target_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  iso(value.created_at, "MONITOR_DELIVERY_ENVELOPE_INVALID");
  hashIdentity(value, "envelope_id", "MONITOR_DELIVERY_ENVELOPE_INTEGRITY_INVALID");
  return value;
}

export function createDeliveryGrant({ envelope, hostStateSha256, hostStateSequence, grantedAt }) {
  validateDeliveryEnvelope(envelope);
  digest(hostStateSha256, "MONITOR_DELIVERY_GRANT_INVALID");
  integer(hostStateSequence, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_GRANT_INVALID");
  iso(grantedAt, "MONITOR_DELIVERY_GRANT_INVALID");
  const value = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_GRANT_CONTRACT,
    grant_id: "",
    event_id: envelope.event_id,
    envelope_id: envelope.envelope_id,
    host_state_sha256: hostStateSha256,
    host_state_sequence: hostStateSequence,
    granted_at: grantedAt,
  };
  value.grant_id = monitoringSha256({ ...value, grant_id: undefined });
  return Object.freeze(validateDeliveryGrant(value));
}

export function validateDeliveryGrant(value) {
  exactKeys(value, ["schema_version", "contract", "grant_id", "event_id", "envelope_id", "host_state_sha256", "host_state_sequence", "granted_at"], "MONITOR_DELIVERY_GRANT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_DELIVERY_GRANT_CONTRACT) reject("MONITOR_DELIVERY_GRANT_VERSION_INVALID");
  for (const field of ["grant_id", "event_id", "envelope_id", "host_state_sha256"]) digest(value[field], "MONITOR_DELIVERY_GRANT_INVALID");
  integer(value.host_state_sequence, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_GRANT_INVALID");
  iso(value.granted_at, "MONITOR_DELIVERY_GRANT_INVALID");
  hashIdentity(value, "grant_id", "MONITOR_DELIVERY_GRANT_INTEGRITY_INVALID");
  return value;
}

function validateAttemptBinding(value, code) {
  digest(value.event_id, code);
  digest(value.envelope_id, code);
  integer(value.attempt_no, 1, 32, code);
  identifier(value.target_id, code);
  integer(value.target_generation, 1, Number.MAX_SAFE_INTEGER, code);
  digest(value.notifier_config_sha256, code);
  digest(value.credential_sha256, code);
  integer(value.credential_generation, 1, Number.MAX_SAFE_INTEGER, code);
  if (value.idempotency_key !== value.event_id) reject(code);
}

export function validateDeliveryClaim(value) {
  exactKeys(value, ["schema_version", "contract", "claim_id", "event_id", "envelope_id", "attempt_no", "claimed_at", "lease_expires_at", "previous_attempt_sha256", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "idempotency_key"], "MONITOR_DELIVERY_CLAIM_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_DELIVERY_CLAIM_CONTRACT) reject("MONITOR_DELIVERY_CLAIM_VERSION_INVALID");
  digest(value.claim_id, "MONITOR_DELIVERY_CLAIM_INVALID");
  validateAttemptBinding(value, "MONITOR_DELIVERY_CLAIM_INVALID");
  iso(value.claimed_at, "MONITOR_DELIVERY_CLAIM_INVALID");
  iso(value.lease_expires_at, "MONITOR_DELIVERY_CLAIM_INVALID");
  if (Date.parse(value.lease_expires_at) <= Date.parse(value.claimed_at)) reject("MONITOR_DELIVERY_CLAIM_INVALID");
  digest(value.previous_attempt_sha256, "MONITOR_DELIVERY_CLAIM_INVALID");
  hashIdentity(value, "claim_id", "MONITOR_DELIVERY_CLAIM_INTEGRITY_INVALID");
  return value;
}

export function validateDeliveryAttempt(value) {
  const legacy = value?.contract === "chenyida-erp-monitoring-delivery-attempt/v1";
  const fields = ["schema_version", "contract", "attempt_id", "claim_id", "event_id", "envelope_id", "attempt_no", "prepared_at", "previous_attempt_sha256", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "adapter_id", "adapter_version", "adapter_sha256", "idempotency_key"];
  exactKeys(value, legacy ? fields : [...fields.slice(0, -1), "egress_policy_sha256", "egress_activation_receipt_sha256", "egress_effective_unit_sha256", "idempotency_key"], "MONITOR_DELIVERY_ATTEMPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || !new Set([MONITORING_DELIVERY_ATTEMPT_CONTRACT, "chenyida-erp-monitoring-delivery-attempt/v1"]).has(value.contract)) reject("MONITOR_DELIVERY_ATTEMPT_VERSION_INVALID");
  digest(value.attempt_id, "MONITOR_DELIVERY_ATTEMPT_INVALID");
  digest(value.claim_id, "MONITOR_DELIVERY_ATTEMPT_INVALID");
  validateAttemptBinding(value, "MONITOR_DELIVERY_ATTEMPT_INVALID");
  iso(value.prepared_at, "MONITOR_DELIVERY_ATTEMPT_INVALID");
  digest(value.previous_attempt_sha256, "MONITOR_DELIVERY_ATTEMPT_INVALID");
  if (!new Set(["HTTPS_JSON_ACK_V1", "SYNTHETIC_FAKE_ACK_V1"]).has(value.adapter_id) || value.adapter_version !== 1) reject("MONITOR_DELIVERY_ATTEMPT_INVALID");
  if (!legacy) {
    const egressFields = ["egress_policy_sha256", "egress_activation_receipt_sha256", "egress_effective_unit_sha256"];
    for (const field of egressFields) digest(value[field], "MONITOR_DELIVERY_ATTEMPT_INVALID");
    const allZero = egressFields.every((field) => value[field] === ZERO_SHA256);
    const allNonzero = egressFields.every((field) => value[field] !== ZERO_SHA256);
    if (value.adapter_id === "SYNTHETIC_FAKE_ACK_V1" ? !allZero : !allNonzero) reject("MONITOR_DELIVERY_ATTEMPT_EGRESS_INVALID");
  }
  digest(value.adapter_sha256, "MONITOR_DELIVERY_ATTEMPT_INVALID");
  hashIdentity(value, "attempt_id", "MONITOR_DELIVERY_ATTEMPT_INTEGRITY_INVALID");
  return value;
}

export function validateDeliveryResult(value) {
  exactKeys(value, ["schema_version", "contract", "result_id", "attempt_id", "event_id", "recorded_at", "status", "detail_code", "response_sha256"], "MONITOR_DELIVERY_RESULT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_DELIVERY_RESULT_CONTRACT) reject("MONITOR_DELIVERY_RESULT_VERSION_INVALID");
  digest(value.result_id, "MONITOR_DELIVERY_RESULT_INVALID");
  digest(value.attempt_id, "MONITOR_DELIVERY_RESULT_INVALID");
  digest(value.event_id, "MONITOR_DELIVERY_RESULT_INVALID");
  iso(value.recorded_at, "MONITOR_DELIVERY_RESULT_INVALID");
  if (!new Set(["ACKNOWLEDGED", "AMBIGUOUS", "RETRYABLE", "REJECTED"]).has(value.status) || typeof value.detail_code !== "string" || !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.detail_code)) reject("MONITOR_DELIVERY_RESULT_INVALID");
  if (value.response_sha256 !== null) digest(value.response_sha256, "MONITOR_DELIVERY_RESULT_INVALID");
  hashIdentity(value, "result_id", "MONITOR_DELIVERY_RESULT_INTEGRITY_INVALID");
  return value;
}

export function validateDeliveryAck(value) {
  exactKeys(value, ["schema_version", "contract", "ack_id", "event_id", "envelope_id", "attempt_id", "result_id", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "remote_ack_id_sha256", "acked_at", "verification"], "MONITOR_DELIVERY_ACK_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_DELIVERY_ACK_CONTRACT) reject("MONITOR_DELIVERY_ACK_VERSION_INVALID");
  for (const field of ["ack_id", "event_id", "envelope_id", "attempt_id", "result_id", "notifier_config_sha256", "credential_sha256", "remote_ack_id_sha256"]) digest(value[field], "MONITOR_DELIVERY_ACK_INVALID");
  identifier(value.target_id, "MONITOR_DELIVERY_ACK_INVALID");
  integer(value.target_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_ACK_INVALID");
  integer(value.credential_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_ACK_INVALID");
  iso(value.acked_at, "MONITOR_DELIVERY_ACK_INVALID");
  if (value.verification !== "EXACT_REMOTE_ACK_V1") reject("MONITOR_DELIVERY_ACK_INVALID");
  hashIdentity(value, "ack_id", "MONITOR_DELIVERY_ACK_INTEGRITY_INVALID");
  return value;
}

export function validateDeliveryAckChain({ ack, envelope, grant, claim, attempt, result }) {
  const checkedAck = validateDeliveryAck(ack);
  const checkedEnvelope = validateDeliveryEnvelope(envelope);
  const checkedGrant = validateDeliveryGrant(grant);
  const checkedClaim = validateDeliveryClaim(claim);
  const checkedAttempt = validateDeliveryAttempt(attempt);
  const checkedResult = validateDeliveryResult(result);
  if (checkedGrant.event_id !== checkedEnvelope.event_id || checkedGrant.envelope_id !== checkedEnvelope.envelope_id) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (checkedClaim.claim_id !== checkedAttempt.claim_id || checkedClaim.event_id !== checkedEnvelope.event_id || checkedClaim.envelope_id !== checkedEnvelope.envelope_id || checkedClaim.attempt_no !== checkedAttempt.attempt_no || checkedClaim.claimed_at !== checkedAttempt.prepared_at || checkedClaim.previous_attempt_sha256 !== checkedAttempt.previous_attempt_sha256) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  for (const field of ["target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "idempotency_key"]) if (checkedClaim[field] !== checkedAttempt[field]) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (checkedAck.event_id !== checkedEnvelope.event_id || checkedAck.envelope_id !== checkedEnvelope.envelope_id || checkedAck.attempt_id !== checkedAttempt.attempt_id || checkedAck.result_id !== checkedResult.result_id) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (checkedAttempt.event_id !== checkedEnvelope.event_id || checkedAttempt.envelope_id !== checkedEnvelope.envelope_id || checkedAttempt.target_id !== checkedEnvelope.target_id || checkedAttempt.target_generation !== checkedEnvelope.target_generation) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (checkedResult.event_id !== checkedEnvelope.event_id || checkedResult.attempt_id !== checkedAttempt.attempt_id || checkedResult.status !== "ACKNOWLEDGED" || checkedResult.detail_code !== "REMOTE_ACK_VERIFIED" || checkedResult.response_sha256 === null) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (checkedAck.target_id !== checkedAttempt.target_id || checkedAck.target_generation !== checkedAttempt.target_generation || checkedAck.notifier_config_sha256 !== checkedAttempt.notifier_config_sha256 || checkedAck.credential_sha256 !== checkedAttempt.credential_sha256 || checkedAck.credential_generation !== checkedAttempt.credential_generation) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (Date.parse(checkedResult.recorded_at) < Date.parse(checkedAttempt.prepared_at)) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  if (Date.parse(checkedClaim.claimed_at) < Date.parse(checkedGrant.granted_at)) reject("MONITOR_DELIVERY_ACK_CHAIN_INVALID");
  return Object.freeze({ ack: checkedAck, envelope: checkedEnvelope, grant: checkedGrant, claim: checkedClaim, attempt: checkedAttempt, result: checkedResult });
}

export function validateDeliveryReadiness(value) {
  const legacy = value?.contract === "chenyida-erp-monitoring-delivery-readiness/v1";
  const fields = ["schema_version", "contract", "readiness_id", "status", "event_id", "envelope_id", "grant_id", "claim_id", "attempt_id", "result_id", "ack_id", "remote_ack_id_sha256", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "adapter_id", "adapter_sha256", "verified_at", "expires_at"];
  exactKeys(value, legacy ? fields : [...fields.slice(0, -2), "egress_policy_sha256", "egress_activation_receipt_sha256", "egress_effective_unit_sha256", "verified_at", "expires_at"], "MONITOR_DELIVERY_READINESS_FIELDS_INVALID");
  if (value.schema_version !== 1 || !new Set([MONITORING_DELIVERY_READINESS_CONTRACT, "chenyida-erp-monitoring-delivery-readiness/v1"]).has(value.contract) || value.status !== "READY") reject("MONITOR_DELIVERY_READINESS_VERSION_INVALID");
  const digests = ["readiness_id", "event_id", "envelope_id", "grant_id", "claim_id", "attempt_id", "result_id", "ack_id", "remote_ack_id_sha256", "notifier_config_sha256", "credential_sha256", "adapter_sha256"];
  for (const field of legacy ? digests : [...digests, "egress_policy_sha256", "egress_activation_receipt_sha256", "egress_effective_unit_sha256"]) digest(value[field], "MONITOR_DELIVERY_READINESS_INVALID");
  identifier(value.target_id, "MONITOR_DELIVERY_READINESS_INVALID");
  integer(value.target_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_READINESS_INVALID");
  integer(value.credential_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_DELIVERY_READINESS_INVALID");
  if (!new Set(["HTTPS_JSON_ACK_V1", "SYNTHETIC_FAKE_ACK_V1"]).has(value.adapter_id)) reject("MONITOR_DELIVERY_READINESS_INVALID");
  if (!legacy) {
    const egressFields = ["egress_policy_sha256", "egress_activation_receipt_sha256", "egress_effective_unit_sha256"];
    const allZero = egressFields.every((field) => value[field] === ZERO_SHA256);
    const allNonzero = egressFields.every((field) => value[field] !== ZERO_SHA256);
    if (value.adapter_id === "SYNTHETIC_FAKE_ACK_V1" ? !allZero : !allNonzero) reject("MONITOR_DELIVERY_READINESS_EGRESS_INVALID");
  }
  iso(value.verified_at, "MONITOR_DELIVERY_READINESS_INVALID");
  iso(value.expires_at, "MONITOR_DELIVERY_READINESS_INVALID");
  if (Date.parse(value.expires_at) <= Date.parse(value.verified_at)) reject("MONITOR_DELIVERY_READINESS_INVALID");
  hashIdentity(value, "readiness_id", "MONITOR_DELIVERY_READINESS_INTEGRITY_INVALID");
  return value;
}

export function canonicalDeliveryJson(value) {
  return canonicalMonitoringJson(value);
}

export { ZERO_SHA256 };
