import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  OpsMonitoringError,
  canonicalMonitoringJson,
  monitoringSha256,
} from "./contract.mjs";
import { validateMonitoringNotifierConfig } from "./delivery-contract.mjs";

export const NOTIFIER_EGRESS_TEMPLATE_CONTRACT = "chenyida-erp-monitoring-notifier-egress-template/v1";
export const NOTIFIER_EGRESS_POLICY_CONTRACT = "chenyida-erp-monitoring-notifier-egress-policy/v1";
export const NOTIFIER_EGRESS_RECEIPT_CONTRACT = "chenyida-erp-monitoring-notifier-egress-activation-receipt/v1";
export const NOTIFIER_EGRESS_STATE_ROOT = "/var/lib/chenyida-erp/monitoring-notifier-egress-v1";
export const NOTIFIER_EGRESS_CURRENT_FILE = `${NOTIFIER_EGRESS_STATE_ROOT}/current.json`;
export const NOTIFIER_EGRESS_POLICY_TARGET = "/etc/chenyida-erp/monitoring-v1/views/notifier-egress-policy.json";
export const NOTIFIER_EGRESS_ACTIVATION_VIEW = "/etc/chenyida-erp/monitoring-v1/views/notifier-egress-activation.json";
export const NOTIFIER_EGRESS_UNIT = "chenyida-erp-monitor-notifier.service";
export const NOTIFIER_EGRESS_UNIT_FRAGMENT = `/etc/systemd/system/${NOTIFIER_EGRESS_UNIT}`;
export const NOTIFIER_EGRESS_DROPIN_TARGET = `/etc/systemd/system/${NOTIFIER_EGRESS_UNIT}.d/50-chenyida-erp-notifier-egress.conf`;
export const ZERO_SHA256 = "0".repeat(64);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HTTPS_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,1023}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class NotifierEgressError extends OpsMonitoringError {
  constructor(code) {
    super(code);
    this.name = "NotifierEgressError";
  }
}

function reject(code) { throw new NotifierEgressError(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function digest(value, code, allowZero = false) {
  if (typeof value !== "string" || !SHA256.test(value) || !allowZero && value === ZERO_SHA256) reject(code);
  return value;
}
function identifier(value, code) { if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code); return value; }
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}
function bodyWithout(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }

function canonicalIpv6(value) {
  let hostname;
  try { hostname = new URL(`https://[${value}]/`).hostname; }
  catch { reject("MONITOR_EGRESS_ADDRESS_INVALID"); }
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) reject("MONITOR_EGRESS_ADDRESS_INVALID");
  return hostname.slice(1, -1);
}

export function canonicalNotifierEgressAddress(value) {
  if (typeof value !== "string" || value.length < 2 || value.length > 45 || value !== value.toLowerCase()) reject("MONITOR_EGRESS_ADDRESS_INVALID");
  const family = isIP(value);
  if (family === 4) {
    const parts = value.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/u.test(part) || Number(part) > 255)) reject("MONITOR_EGRESS_ADDRESS_INVALID");
    const octets = parts.map(Number);
    const forbidden = octets[0] === 0
      || octets[0] === 10
      || octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
      || octets[0] === 127
      || octets[0] === 169 && octets[1] === 254
      || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
      || octets[0] === 192 && octets[1] === 0 && octets[2] === 0
      || octets[0] === 192 && octets[1] === 0 && octets[2] === 2
      || octets[0] === 192 && octets[1] === 88 && octets[2] === 99
      || octets[0] === 192 && octets[1] === 168
      || octets[0] === 198 && new Set([18, 19]).has(octets[1])
      || octets[0] === 198 && octets[1] === 51 && octets[2] === 100
      || octets[0] === 203 && octets[1] === 0 && octets[2] === 113
      || octets[0] >= 224;
    if (forbidden) reject("MONITOR_EGRESS_ADDRESS_FORBIDDEN");
    const address = octets.join(".");
    if (address !== value) reject("MONITOR_EGRESS_ADDRESS_NOT_CANONICAL");
    return Object.freeze({ family: "AF_INET", address, prefix_length: 32, systemd_prefix: `${address}/32` });
  }
  if (family !== 6 || value.includes(".")) reject("MONITOR_EGRESS_ADDRESS_INVALID");
  const address = canonicalIpv6(value);
  if (address !== value) reject("MONITOR_EGRESS_ADDRESS_NOT_CANONICAL");
  const first = Number.parseInt(address.split(":", 1)[0] || "0", 16);
  if (address === "::" || address === "::1" || address.startsWith("::ffff:")
    || first < 0x2000 || first > 0x3fff || address.startsWith("2001:db8:")) reject("MONITOR_EGRESS_ADDRESS_FORBIDDEN");
  return Object.freeze({ family: "AF_INET6", address, prefix_length: 128, systemd_prefix: `${address}/128` });
}

function validateEndpoint(value) {
  exactKeys(value, ["scheme", "host", "port", "path", "tls_server_name"], "MONITOR_EGRESS_ENDPOINT_FIELDS_INVALID");
  if (value.scheme !== "https" || typeof value.host !== "string" || !HOST.test(value.host) || !value.host.includes(".") || isIP(value.host) !== 0
    || value.host.endsWith(".local") || value.host !== value.host.toLowerCase()
    || value.tls_server_name !== value.host || value.port !== 443 || typeof value.path !== "string" || !HTTPS_PATH.test(value.path)) reject("MONITOR_EGRESS_ENDPOINT_INVALID");
  return value;
}

export function validateNotifierEgressTemplate(value) {
  exactKeys(value, ["schema_version", "contract", "policy_id", "scope", "network", "systemd", "paths", "activation"], "MONITOR_EGRESS_TEMPLATE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== NOTIFIER_EGRESS_TEMPLATE_CONTRACT || value.policy_id !== "chenyida-erp-monitoring-notifier-egress-v1" || value.scope !== "UAT_AND_PRODUCTION") reject("MONITOR_EGRESS_TEMPLATE_INVALID");
  exactKeys(value.network, ["scheme", "port", "ip_address_deny", "maximum_exact_addresses", "ipv4_prefix_length", "ipv6_prefix_length", "runtime_dns", "proxy_environment", "redirects", "remote_address_verification"], "MONITOR_EGRESS_TEMPLATE_NETWORK_FIELDS_INVALID");
  if (value.network.scheme !== "https" || value.network.port !== 443 || value.network.ip_address_deny !== "any" || value.network.maximum_exact_addresses !== 8 || value.network.ipv4_prefix_length !== 32 || value.network.ipv6_prefix_length !== 128 || value.network.runtime_dns !== "FORBIDDEN" || value.network.proxy_environment !== "FORBIDDEN" || value.network.redirects !== "FORBIDDEN" || value.network.remote_address_verification !== "REQUIRED") reject("MONITOR_EGRESS_TEMPLATE_NETWORK_INVALID");
  exactKeys(value.systemd, ["unit", "fragment_path", "dropin_path", "transient", "user", "group"], "MONITOR_EGRESS_TEMPLATE_SYSTEMD_FIELDS_INVALID");
  if (value.systemd.unit !== NOTIFIER_EGRESS_UNIT || value.systemd.fragment_path !== NOTIFIER_EGRESS_UNIT_FRAGMENT || value.systemd.dropin_path !== NOTIFIER_EGRESS_DROPIN_TARGET || value.systemd.transient !== "no" || value.systemd.user !== "chenyida-monitor-notify" || value.systemd.group !== "chenyida-monitor-notify") reject("MONITOR_EGRESS_TEMPLATE_SYSTEMD_INVALID");
  exactKeys(value.paths, ["state_root", "policy_target", "activation_view"], "MONITOR_EGRESS_TEMPLATE_PATH_FIELDS_INVALID");
  if (value.paths.state_root !== NOTIFIER_EGRESS_STATE_ROOT || value.paths.policy_target !== NOTIFIER_EGRESS_POLICY_TARGET || value.paths.activation_view !== NOTIFIER_EGRESS_ACTIVATION_VIEW) reject("MONITOR_EGRESS_TEMPLATE_PATH_INVALID");
  exactKeys(value.activation, ["maximum_validity_hours", "generation_step", "authorization", "rollback", "recovery"], "MONITOR_EGRESS_TEMPLATE_ACTIVATION_FIELDS_INVALID");
  if (value.activation.maximum_validity_hours !== 24 || value.activation.generation_step !== 1 || value.activation.authorization !== "RELEASE_SUPERVISOR_ONE_TIME_V5" || value.activation.rollback !== "EXACT_COMMITTED_RECEIPT_ONLY" || value.activation.recovery !== "NEW_AUTHORIZATION_AND_PRESERVE_UNKNOWN") reject("MONITOR_EGRESS_TEMPLATE_ACTIVATION_INVALID");
  return value;
}

export function notifierEgressTemplateLogicalSha256(value) {
  return monitoringSha256(validateNotifierEgressTemplate(value));
}

function validateAddressSet(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) reject("MONITOR_EGRESS_ADDRESS_SET_INVALID");
  const normalized = value.map(canonicalNotifierEgressAddress);
  const ordered = [...normalized].sort((left, right) => left.systemd_prefix.localeCompare(right.systemd_prefix));
  if (new Set(ordered.map((entry) => entry.systemd_prefix)).size !== ordered.length || ordered.some((entry, index) => entry.address !== value[index])) reject("MONITOR_EGRESS_ADDRESS_SET_NOT_CANONICAL");
  return ordered;
}

function policyFields() {
  return ["schema_version", "contract", "policy_id", "operation", "environment", "generation", "previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256", "deployment_id", "target", "binding", "network", "systemd", "activated_at", "expires_at"];
}

export function createNotifierEgressDropIn(policyInput) {
  const policy = validateNotifierEgressPolicy(policyInput, { skipDropinDigest: true, skipEffectiveDigest: true });
  return Buffer.from(["# Managed by chenyida-erp release supervisor; manual edits are forbidden.", "[Service]", "IPAddressAllow=", ...policy.network.allowed_addresses.map((entry) => `IPAddressAllow=${entry.systemd_prefix}`), ""].join("\n"), "utf8");
}

export function expectedNotifierEgressEffectiveUnit(policyInput) {
  const policy = validateNotifierEgressPolicy(policyInput, { skipEffectiveDigest: true });
  return Object.freeze({
    schema_version: 1,
    contract: "chenyida-erp-monitoring-notifier-egress-effective-unit/v1",
    unit: NOTIFIER_EGRESS_UNIT,
    load_state: "loaded",
    fragment_path: NOTIFIER_EGRESS_UNIT_FRAGMENT,
    dropin_paths: [NOTIFIER_EGRESS_DROPIN_TARGET],
    transient: "no",
    user: "chenyida-monitor-notify",
    group: "chenyida-monitor-notify",
    private_network: "no",
    no_new_privileges: "yes",
    protect_system: "strict",
    memory_deny_write_execute: "yes",
    ip_address_deny: "any",
    ip_address_allow: policy.network.allowed_addresses.map((entry) => entry.systemd_prefix),
    proxy_environment: [],
  });
}

export function validateNotifierEgressEffectiveUnit(value, policyInput) {
  const expected = expectedNotifierEgressEffectiveUnit(policyInput);
  if (canonicalMonitoringJson(value) !== canonicalMonitoringJson(expected)) reject("MONITOR_EGRESS_EFFECTIVE_UNIT_INVALID");
  return expected;
}

export function validateNotifierEgressPolicy(value, options = {}) {
  exactKeys(value, policyFields(), "MONITOR_EGRESS_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== NOTIFIER_EGRESS_POLICY_CONTRACT || value.policy_id !== "chenyida-erp-monitoring-notifier-egress-v1" || !new Set(["ACTIVATE", "ROLLBACK"]).has(value.operation) || !new Set(["UAT", "PRODUCTION"]).has(value.environment)) reject("MONITOR_EGRESS_POLICY_INVALID");
  integer(value.generation, 1, 1_000_000, "MONITOR_EGRESS_GENERATION_INVALID");
  digest(value.previous_policy_sha256, "MONITOR_EGRESS_PREVIOUS_INVALID", true);
  digest(value.previous_activation_receipt_sha256, "MONITOR_EGRESS_PREVIOUS_INVALID", true);
  digest(value.rollback_target_activation_receipt_sha256, "MONITOR_EGRESS_ROLLBACK_INVALID", true);
  if (value.generation === 1 && (value.previous_policy_sha256 !== ZERO_SHA256 || value.previous_activation_receipt_sha256 !== ZERO_SHA256) || value.generation > 1 && (value.previous_policy_sha256 === ZERO_SHA256 || value.previous_activation_receipt_sha256 === ZERO_SHA256)) reject("MONITOR_EGRESS_GENERATION_INVALID");
  if (value.operation === "ACTIVATE" && value.rollback_target_activation_receipt_sha256 !== ZERO_SHA256 || value.operation === "ROLLBACK" && (value.generation < 3 || value.rollback_target_activation_receipt_sha256 === ZERO_SHA256)) reject("MONITOR_EGRESS_ROLLBACK_INVALID");
  identifier(value.deployment_id, "MONITOR_EGRESS_DEPLOYMENT_INVALID");
  exactKeys(value.target, ["target_id", "target_generation", "endpoint"], "MONITOR_EGRESS_TARGET_FIELDS_INVALID");
  identifier(value.target.target_id, "MONITOR_EGRESS_TARGET_INVALID");
  integer(value.target.target_generation, 1, 1_000_000, "MONITOR_EGRESS_TARGET_INVALID");
  validateEndpoint(value.target.endpoint);
  exactKeys(value.binding, ["monitoring_bundle_sha256", "supervisor_bundle_sha256", "notifier_config_sha256", "adapter_id", "adapter_sha256", "credential_sha256", "credential_generation", "oncall_roster_generation", "escalation_table_sha256", "base_unit_sha256", "template_file_sha256", "template_policy_sha256", "authorization_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256"], "MONITOR_EGRESS_BINDING_FIELDS_INVALID");
  for (const key of Object.keys(value.binding).filter((key) => key.endsWith("_sha256"))) digest(value.binding[key], "MONITOR_EGRESS_BINDING_INVALID");
  if (value.binding.adapter_id !== "HTTPS_JSON_ACK_V1") reject("MONITOR_EGRESS_BINDING_INVALID");
  for (const key of ["credential_generation", "oncall_roster_generation"]) integer(value.binding[key], 1, 1_000_000, "MONITOR_EGRESS_BINDING_INVALID");
  if (new Set([value.binding.approval_reference_sha256, value.binding.responsible_operator_identity_sha256, value.binding.approver_identity_sha256]).size !== 3) reject("MONITOR_EGRESS_ACTORS_INVALID");
  exactKeys(value.network, ["scheme", "port", "runtime_dns", "proxy_environment", "redirects", "remote_address_verification", "ip_address_deny", "allowed_addresses"], "MONITOR_EGRESS_NETWORK_FIELDS_INVALID");
  if (value.network.scheme !== "https" || value.network.port !== 443 || value.network.runtime_dns !== "FORBIDDEN" || value.network.proxy_environment !== "FORBIDDEN" || value.network.redirects !== "FORBIDDEN" || value.network.remote_address_verification !== "REQUIRED" || value.network.ip_address_deny !== "any") reject("MONITOR_EGRESS_NETWORK_INVALID");
  const addresses = validateAddressSet(value.network.allowed_addresses.map((entry) => entry.address));
  if (canonicalMonitoringJson(addresses) !== canonicalMonitoringJson(value.network.allowed_addresses)) reject("MONITOR_EGRESS_ADDRESS_SET_NOT_CANONICAL");
  exactKeys(value.systemd, ["unit", "fragment_path", "dropin_path", "dropin_sha256", "effective_unit_sha256"], "MONITOR_EGRESS_SYSTEMD_FIELDS_INVALID");
  if (value.systemd.unit !== NOTIFIER_EGRESS_UNIT || value.systemd.fragment_path !== NOTIFIER_EGRESS_UNIT_FRAGMENT || value.systemd.dropin_path !== NOTIFIER_EGRESS_DROPIN_TARGET) reject("MONITOR_EGRESS_SYSTEMD_INVALID");
  digest(value.systemd.dropin_sha256, "MONITOR_EGRESS_SYSTEMD_INVALID", options.skipDropinDigest === true);
  digest(value.systemd.effective_unit_sha256, "MONITOR_EGRESS_SYSTEMD_INVALID", options.skipEffectiveDigest === true);
  iso(value.activated_at, "MONITOR_EGRESS_TIME_INVALID");
  iso(value.expires_at, "MONITOR_EGRESS_TIME_INVALID");
  if (Date.parse(value.expires_at) <= Date.parse(value.activated_at) || Date.parse(value.expires_at) - Date.parse(value.activated_at) > 24 * 60 * 60 * 1000) reject("MONITOR_EGRESS_TIME_INVALID");
  if (!options.skipDropinDigest && monitoringSha256(createNotifierEgressDropIn(value)) !== value.systemd.dropin_sha256) reject("MONITOR_EGRESS_DROPIN_DIGEST_INVALID");
  if (!options.skipEffectiveDigest && monitoringSha256(expectedNotifierEgressEffectiveUnit(value)) !== value.systemd.effective_unit_sha256) reject("MONITOR_EGRESS_EFFECTIVE_DIGEST_INVALID");
  return value;
}

const CREATE_POLICY_PARAMETER_FIELDS = Object.freeze([
  "operation", "environment", "egress_generation", "previous_policy_sha256", "previous_activation_receipt_sha256",
  "rollback_target_activation_receipt_sha256", "deployment_id", "target_id", "target_generation", "endpoint",
  "allowed_addresses", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "notifier_config_sha256", "adapter_id",
  "adapter_sha256", "credential_sha256", "credential_generation", "oncall_roster_generation", "escalation_table_sha256",
  "base_unit_sha256", "template_file_sha256", "template_policy_sha256", "authorization_sha256",
  "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256", "activated_at", "expires_at",
]);

export function createNotifierEgressPolicy({ template: templateInput, parameters: parameterInput }) {
  const template = validateNotifierEgressTemplate(templateInput);
  exactKeys(parameterInput, CREATE_POLICY_PARAMETER_FIELDS, "MONITOR_EGRESS_PARAMETERS_INVALID");
  const parameters = parameterInput;
  const endpoint = validateEndpoint(parameters.endpoint);
  const addresses = validateAddressSet(parameters.allowed_addresses);
  const base = {
    schema_version: 1,
    contract: NOTIFIER_EGRESS_POLICY_CONTRACT,
    policy_id: template.policy_id,
    operation: parameters.operation,
    environment: parameters.environment,
    generation: parameters.egress_generation,
    previous_policy_sha256: parameters.previous_policy_sha256,
    previous_activation_receipt_sha256: parameters.previous_activation_receipt_sha256,
    rollback_target_activation_receipt_sha256: parameters.rollback_target_activation_receipt_sha256,
    deployment_id: parameters.deployment_id,
    target: { target_id: parameters.target_id, target_generation: parameters.target_generation, endpoint },
    binding: {
      monitoring_bundle_sha256: parameters.monitoring_bundle_sha256,
      supervisor_bundle_sha256: parameters.supervisor_bundle_sha256,
      notifier_config_sha256: parameters.notifier_config_sha256,
      adapter_id: parameters.adapter_id,
      adapter_sha256: parameters.adapter_sha256,
      credential_sha256: parameters.credential_sha256,
      credential_generation: parameters.credential_generation,
      oncall_roster_generation: parameters.oncall_roster_generation,
      escalation_table_sha256: parameters.escalation_table_sha256,
      base_unit_sha256: parameters.base_unit_sha256,
      template_file_sha256: parameters.template_file_sha256,
      template_policy_sha256: parameters.template_policy_sha256,
      authorization_sha256: parameters.authorization_sha256,
      approval_reference_sha256: parameters.approval_reference_sha256,
      responsible_operator_identity_sha256: parameters.responsible_operator_identity_sha256,
      approver_identity_sha256: parameters.approver_identity_sha256,
    },
    network: { scheme: "https", port: 443, runtime_dns: "FORBIDDEN", proxy_environment: "FORBIDDEN", redirects: "FORBIDDEN", remote_address_verification: "REQUIRED", ip_address_deny: "any", allowed_addresses: addresses },
    systemd: { unit: NOTIFIER_EGRESS_UNIT, fragment_path: NOTIFIER_EGRESS_UNIT_FRAGMENT, dropin_path: NOTIFIER_EGRESS_DROPIN_TARGET, dropin_sha256: ZERO_SHA256, effective_unit_sha256: ZERO_SHA256 },
    activated_at: parameters.activated_at,
    expires_at: parameters.expires_at,
  };
  const dropinSha256 = monitoringSha256(createNotifierEgressDropIn(base));
  const withDropin = { ...base, systemd: { ...base.systemd, dropin_sha256: dropinSha256 } };
  const effectiveUnitSha256 = monitoringSha256(expectedNotifierEgressEffectiveUnit(withDropin));
  return Object.freeze(validateNotifierEgressPolicy({ ...withDropin, systemd: { ...withDropin.systemd, effective_unit_sha256: effectiveUnitSha256 } }));
}

const RECEIPT_FIELDS = Object.freeze(["schema_version", "contract", "activation_id", "operation", "status", "committed_at", "environment", "generation", "policy_id", "policy_sha256", "policy_file_sha256", "previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256", "deployment_id", "target_id", "target_generation", "endpoint_sha256", "address_set_sha256", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "notifier_config_sha256", "adapter_id", "adapter_sha256", "credential_sha256", "credential_generation", "oncall_roster_generation", "escalation_table_sha256", "base_unit_sha256", "dropin_sha256", "effective_unit_sha256", "template_file_sha256", "template_policy_sha256", "authorization_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256", "activated_at", "expires_at", "state_root", "policy_target", "activation_view", "dropin_target", "history_file", "receipt_sha256"]);

export function createNotifierEgressActivationReceipt({ policy: policyInput, activationId }) {
  const policy = validateNotifierEgressPolicy(policyInput);
  return Object.freeze(validateNotifierEgressActivationReceipt(
    createNotifierEgressActivationReceiptUnchecked(policy, activationId), policy,
  ));
}

export function validateNotifierEgressActivationReceipt(value, policyInput = null) {
  exactKeys(value, RECEIPT_FIELDS, "MONITOR_EGRESS_RECEIPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== NOTIFIER_EGRESS_RECEIPT_CONTRACT || value.status !== "COMMITTED" || !new Set(["ACTIVATE", "ROLLBACK"]).has(value.operation)) reject("MONITOR_EGRESS_RECEIPT_INVALID");
  identifier(value.activation_id, "MONITOR_EGRESS_RECEIPT_INVALID");
  integer(value.generation, 1, 1_000_000, "MONITOR_EGRESS_RECEIPT_INVALID");
  if (!new Set(["UAT", "PRODUCTION"]).has(value.environment) || value.policy_id !== "chenyida-erp-monitoring-notifier-egress-v1") reject("MONITOR_EGRESS_RECEIPT_INVALID");
  integer(value.target_generation, 1, 1_000_000, "MONITOR_EGRESS_RECEIPT_INVALID");
  integer(value.credential_generation, 1, 1_000_000, "MONITOR_EGRESS_RECEIPT_INVALID");
  integer(value.oncall_roster_generation, 1, 1_000_000, "MONITOR_EGRESS_RECEIPT_INVALID");
  if (value.adapter_id !== "HTTPS_JSON_ACK_V1") reject("MONITOR_EGRESS_RECEIPT_INVALID");
  identifier(value.policy_id, "MONITOR_EGRESS_RECEIPT_INVALID");
  identifier(value.deployment_id, "MONITOR_EGRESS_RECEIPT_INVALID");
  identifier(value.target_id, "MONITOR_EGRESS_RECEIPT_INVALID");
  for (const key of RECEIPT_FIELDS.filter((field) => field.endsWith("_sha256"))) digest(value[key], "MONITOR_EGRESS_RECEIPT_DIGEST_INVALID", new Set(["previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256"]).has(key));
  iso(value.committed_at, "MONITOR_EGRESS_RECEIPT_TIME_INVALID"); iso(value.activated_at, "MONITOR_EGRESS_RECEIPT_TIME_INVALID"); iso(value.expires_at, "MONITOR_EGRESS_RECEIPT_TIME_INVALID");
  const expectedHistory = `${NOTIFIER_EGRESS_STATE_ROOT}/history/${String(value.generation).padStart(16, "0")}.${value.policy_sha256}.json`;
  const invalidGeneration = value.generation === 1
    ? value.previous_policy_sha256 !== ZERO_SHA256 || value.previous_activation_receipt_sha256 !== ZERO_SHA256
    : value.previous_policy_sha256 === ZERO_SHA256 || value.previous_activation_receipt_sha256 === ZERO_SHA256;
  const invalidRollback = value.operation === "ACTIVATE"
    ? value.rollback_target_activation_receipt_sha256 !== ZERO_SHA256
    : value.generation < 3 || value.rollback_target_activation_receipt_sha256 === ZERO_SHA256;
  if (value.committed_at !== value.activated_at || Date.parse(value.expires_at) <= Date.parse(value.activated_at)
    || Date.parse(value.expires_at) - Date.parse(value.activated_at) > 24 * 60 * 60 * 1000 || invalidGeneration || invalidRollback
    || value.policy_file_sha256 !== value.policy_sha256 || value.history_file !== expectedHistory
    || value.state_root !== NOTIFIER_EGRESS_STATE_ROOT || value.policy_target !== NOTIFIER_EGRESS_POLICY_TARGET
    || value.activation_view !== NOTIFIER_EGRESS_ACTIVATION_VIEW || value.dropin_target !== NOTIFIER_EGRESS_DROPIN_TARGET
    || new Set([value.approval_reference_sha256, value.responsible_operator_identity_sha256, value.approver_identity_sha256]).size !== 3
    || monitoringSha256(bodyWithout(value, "receipt_sha256")) !== value.receipt_sha256) reject("MONITOR_EGRESS_RECEIPT_INTEGRITY_INVALID");
  if (policyInput !== null) {
    const policy = validateNotifierEgressPolicy(policyInput);
    const expected = createNotifierEgressActivationReceiptUnchecked(policy, value.activation_id);
    if (canonicalMonitoringJson(value) !== canonicalMonitoringJson(expected)) reject("MONITOR_EGRESS_RECEIPT_POLICY_MISMATCH");
  }
  return value;
}

function createNotifierEgressActivationReceiptUnchecked(policy, activationId) {
  const policyRaw = canonicalMonitoringJson(policy);
  const policySha256 = monitoringSha256(policy);
  const body = {
    schema_version: 1, contract: NOTIFIER_EGRESS_RECEIPT_CONTRACT, activation_id: activationId, operation: policy.operation, status: "COMMITTED", committed_at: policy.activated_at,
    environment: policy.environment, generation: policy.generation, policy_id: policy.policy_id, policy_sha256: policySha256, policy_file_sha256: createHash("sha256").update(policyRaw).digest("hex"), previous_policy_sha256: policy.previous_policy_sha256, previous_activation_receipt_sha256: policy.previous_activation_receipt_sha256, rollback_target_activation_receipt_sha256: policy.rollback_target_activation_receipt_sha256,
    deployment_id: policy.deployment_id, target_id: policy.target.target_id, target_generation: policy.target.target_generation, endpoint_sha256: monitoringSha256(policy.target.endpoint), address_set_sha256: monitoringSha256(policy.network.allowed_addresses), monitoring_bundle_sha256: policy.binding.monitoring_bundle_sha256, supervisor_bundle_sha256: policy.binding.supervisor_bundle_sha256, notifier_config_sha256: policy.binding.notifier_config_sha256, adapter_id: policy.binding.adapter_id, adapter_sha256: policy.binding.adapter_sha256, credential_sha256: policy.binding.credential_sha256, credential_generation: policy.binding.credential_generation, oncall_roster_generation: policy.binding.oncall_roster_generation, escalation_table_sha256: policy.binding.escalation_table_sha256, base_unit_sha256: policy.binding.base_unit_sha256, dropin_sha256: policy.systemd.dropin_sha256, effective_unit_sha256: policy.systemd.effective_unit_sha256, template_file_sha256: policy.binding.template_file_sha256, template_policy_sha256: policy.binding.template_policy_sha256, authorization_sha256: policy.binding.authorization_sha256, approval_reference_sha256: policy.binding.approval_reference_sha256, responsible_operator_identity_sha256: policy.binding.responsible_operator_identity_sha256, approver_identity_sha256: policy.binding.approver_identity_sha256,
    activated_at: policy.activated_at, expires_at: policy.expires_at, state_root: NOTIFIER_EGRESS_STATE_ROOT, policy_target: NOTIFIER_EGRESS_POLICY_TARGET, activation_view: NOTIFIER_EGRESS_ACTIVATION_VIEW, dropin_target: NOTIFIER_EGRESS_DROPIN_TARGET, history_file: `${NOTIFIER_EGRESS_STATE_ROOT}/history/${String(policy.generation).padStart(16, "0")}.${policySha256}.json`,
  };
  return { ...body, receipt_sha256: monitoringSha256(body) };
}

export function validateCommittedNotifierEgressActivation({ policy: policyInput, receipt: receiptInput, notifierConfig = null, now = null }) {
  const policy = validateNotifierEgressPolicy(policyInput);
  const receipt = validateNotifierEgressActivationReceipt(receiptInput, policy);
  if (notifierConfig !== null) {
    const config = validateMonitoringNotifierConfig(notifierConfig);
    if (policy.environment !== config.deployment.class || policy.deployment_id !== config.deployment.id || policy.target.target_id !== config.notification.target_id || policy.target.target_generation !== config.notification.target_generation || canonicalMonitoringJson(policy.target.endpoint) !== canonicalMonitoringJson(config.notification.endpoint) || policy.binding.notifier_config_sha256 !== monitoringSha256(config) || policy.binding.adapter_id !== config.notification.adapter.id || policy.binding.adapter_sha256 !== config.notification.adapter.source_sha256 || policy.binding.credential_sha256 !== config.notification.credential.sha256 || policy.binding.credential_generation !== config.notification.credential.generation || policy.binding.oncall_roster_generation !== config.notification.oncall_roster_generation || policy.binding.escalation_table_sha256 !== config.notification.escalation_table_sha256 || policy.binding.monitoring_bundle_sha256 !== config.installation.monitoring_bundle_sha256 || policy.binding.supervisor_bundle_sha256 !== config.installation.supervisor_bundle_sha256) reject("MONITOR_EGRESS_CONFIG_BINDING_INVALID");
  }
  if (now !== null && (!(now instanceof Date) || Number.isNaN(now.getTime())
    || Date.parse(policy.activated_at) > now.getTime() + 5 * 60 * 1000 || now.getTime() >= Date.parse(policy.expires_at))) reject("MONITOR_EGRESS_POLICY_EXPIRED");
  return Object.freeze({ policy, receipt });
}
