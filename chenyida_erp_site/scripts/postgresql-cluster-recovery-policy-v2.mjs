import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  canonicalClusterJson,
  clusterPolicySha256,
  clusterSha256,
  validateClusterRecoveryPolicy,
} from "./postgresql-cluster-recovery-contract.mjs";
import {
  BASE_CLUSTER_POLICY_V1_FILE_SHA256,
  CLUSTER_POLICY_V2_CONTRACT,
  RECOVERY_CONTROL_INTENT_V2_CONTRACT,
  ZERO_SHA256,
  clusterRecoveryPolicyV2Sha256,
  validateClusterRecoveryPolicyV2,
} from "./postgresql-cluster-recovery-policy-v2-contract.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CONTRACT,
  verifyRuntimePrivilegeOperatorPolicySources,
} from "./postgresql-runtime-privilege-operator.mjs";
import { loadRuntimePrivilegePolicySources } from "./postgresql-runtime-privilege-policy.mjs";

export const CLUSTER_RECOVERY_POLICY_V2_PATH = "operations/postgresql-cluster-recovery-policy-v2.json";
export const CLUSTER_RECOVERY_POLICY_V1_PATH = "operations/postgresql-cluster-recovery-policy-v1.json";
export const RUNTIME_PRIVILEGE_POLICY_V2_PATH = "operations/postgresql-runtime-privilege-policy-v2.json";
export const RUNTIME_PRIVILEGE_OPERATOR_POLICY_V1_PATH = "operations/postgresql-runtime-privilege-operator-policy-v1.json";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA256 = /^[0-9a-f]{64}$/u;
const SUPPORTED_OBJECT_KINDS = Object.freeze([
  "COLUMN", "INDEX_PLACEMENT", "LARGE_OBJECT", "MATERIALIZED_VIEW", "PARTITIONED_INDEX_PLACEMENT",
  "PARTITIONED_TABLE", "ROUTINE", "SCHEMA", "SEQUENCE", "TABLE", "TYPE", "VIEW",
]);
const UNSUPPORTED_COUNTERS = Object.freeze([
  "access_methods", "capture_role_conflicts", "casts", "collations", "conversions", "event_triggers",
  "external_database_settings", "foreign_data_wrappers", "foreign_servers", "foreign_tables", "operator_classes",
  "operator_families", "operators", "parameter_acl_entries", "policy_role_endpoints", "replication_origins",
  "row_security_policies", "security_labels", "statistics_extensions", "subscriptions", "text_search_objects",
  "transforms", "unapproved_languages", "unapproved_settings", "unsupported_relations", "user_mappings",
]);
const ACL_KINDS = Object.freeze([
  "DATABASE", "SCHEMA", "TABLE", "PARTITIONED_TABLE", "VIEW", "MATERIALIZED_VIEW", "SEQUENCE",
  "COLUMN", "ROUTINE", "TYPE", "LARGE_OBJECT", "TABLESPACE",
]);

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactSource(raw, expected, code) {
  if (!Buffer.isBuffer(raw)) reject(code);
  let parsed;
  try { parsed = parseStrictJson(raw.toString("utf8")); }
  catch { reject(code); }
  if (canonicalClusterJson(parsed) !== canonicalClusterJson(expected)) reject(code);
}

function exactRuntimePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 2
    || value.contract !== "chenyida-erp-postgresql-runtime-privilege-policy/v2"
    || value.policy_id !== "chenyida-erp-postgresql-runtime-privilege-v2" || !SHA256.test(value.policy_sha256 || "")) {
    reject("CLUSTER_POLICY_V2_RUNTIME_SOURCE_INVALID");
  }
  const { policy_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.policy_sha256 || value.deployment_authorized !== false
    || value.evidence_scope !== "SYNTHETIC_ISOLATED_ONLY" || value.authorization_status !== "ISOLATED_RECONCILIATION_ONLY") {
    reject("CLUSTER_POLICY_V2_RUNTIME_SOURCE_INVALID");
  }
  return value;
}

function exactOperatorPolicy(value, runtimePolicy) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1
    || value.contract !== "chenyida-erp-postgresql-runtime-privilege-operator-policy/v1"
    || !SHA256.test(value.policy_sha256 || "") || value.runtime_privilege_policy_sha256 !== runtimePolicy.policy_sha256) {
    reject("CLUSTER_POLICY_V2_OPERATOR_SOURCE_INVALID");
  }
  const { policy_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.policy_sha256) reject("CLUSTER_POLICY_V2_OPERATOR_SOURCE_INVALID");
  return value;
}

function roleProjection(runtimePolicy) {
  const roles = runtimePolicy.roles.map((role) => {
    if (role.superuser || role.create_role || role.create_database || role.replication || role.bypass_rls) {
      reject("CLUSTER_POLICY_V2_RUNTIME_ROLE_UNSAFE");
    }
    return {
      name: role.name,
      purpose: role.purpose,
      intended_login: role.intended_login,
      inherit: role.inherit,
      connection_limit: role.connection_limit,
      valid_until: role.valid_until,
    };
  });
  roles.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return roles;
}

function identities(runtimePolicy) {
  const source = runtimePolicy.identities;
  return {
    migration_owner: source.migration_owner,
    platform_owner: source.platform_owner,
    admin_login: source.admin_login,
    admin_privilege_group: source.admin_privilege_group,
    backup_login: source.backup_login,
    backup_privilege_group: source.backup_privilege_group,
    web_login: source.web_login,
    web_privilege_group: source.web_privilege_group,
    worker_login: source.worker_login,
    worker_privilege_group: source.worker_privilege_group,
    backup_control: source.backup_control,
    restore_bootstrap: source.restore_bootstrap,
    unauthorized_probe: source.unauthorized_probe,
  };
}

function publicPrivileges() {
  return Object.fromEntries(ACL_KINDS.map((kind) => [kind, []]));
}

function nonOwnerPrivileges() {
  return {
    DATABASE: ["CONNECT", "TEMPORARY"],
    SCHEMA: ["USAGE"],
    TABLE: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    PARTITIONED_TABLE: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    VIEW: ["SELECT"],
    MATERIALIZED_VIEW: ["SELECT"],
    SEQUENCE: ["SELECT", "UPDATE", "USAGE"],
    COLUMN: ["INSERT", "REFERENCES", "SELECT", "UPDATE"],
    ROUTINE: ["EXECUTE"],
    TYPE: ["USAGE"],
    LARGE_OBJECT: [],
    TABLESPACE: [],
  };
}

export function buildClusterRecoveryPolicyV2(basePolicyInput, basePolicyRaw, runtimePolicyInput, runtimePolicyRaw, operatorPolicyInput, operatorPolicyRaw) {
  const basePolicy = validateClusterRecoveryPolicy(basePolicyInput);
  exactSource(basePolicyRaw, basePolicy, "CLUSTER_POLICY_V2_BASE_SOURCE_INVALID");
  if (digest(basePolicyRaw) !== BASE_CLUSTER_POLICY_V1_FILE_SHA256) reject("CLUSTER_POLICY_V2_BASE_SOURCE_CHANGED");
  const runtimePolicy = exactRuntimePolicy(runtimePolicyInput);
  exactSource(runtimePolicyRaw, runtimePolicy, "CLUSTER_POLICY_V2_RUNTIME_SOURCE_INVALID");
  const operatorPolicy = exactOperatorPolicy(operatorPolicyInput, runtimePolicy);
  exactSource(operatorPolicyRaw, operatorPolicy, "CLUSTER_POLICY_V2_OPERATOR_SOURCE_INVALID");
  const projectedRoles = roleProjection(runtimePolicy), projectedIdentities = identities(runtimePolicy);
  const memberships = structuredClone(runtimePolicy.memberships);
  memberships.sort((left, right) => {
    const leftText = canonicalClusterJson(left), rightText = canonicalClusterJson(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  });
  const loginRoles = projectedRoles.filter((role) => role.intended_login).map((role) => role.name).sort();
  const extensions = runtimePolicy.extensions.map((extension) => ({
    name: extension.name,
    schema: extension.schema,
    owner: extension.owner,
    kind: "PLATFORM",
  })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const binding = runtimePolicy.source_binding;
  const body = {
    schema_version: 2,
    contract: CLUSTER_POLICY_V2_CONTRACT,
    policy_id: "chenyida-erp-postgresql-cluster-recovery-v2",
    policy_generation: 1,
    scope: "PRODUCTION_BASELINE",
    postgresql_major: binding.engine_binding.server_major,
    base_cluster_policy_binding: {
      path: CLUSTER_RECOVERY_POLICY_V1_PATH,
      contract: basePolicy.contract,
      policy_id: basePolicy.policy_id,
      policy_sha256: clusterPolicySha256(basePolicy),
      file_sha256: digest(basePolicyRaw),
      policy: structuredClone(basePolicy),
    },
    database: {
      name: runtimePolicy.database.name,
      owner: runtimePolicy.database.owner,
      default_tablespace: runtimePolicy.database.default_tablespace,
      allow_connect: runtimePolicy.database.allow_connect,
      connection_limit: runtimePolicy.database.connection_limit,
      public_connect: false,
    },
    identities: projectedIdentities,
    roles: projectedRoles,
    memberships,
    settings: {
      allowed_keys: ["application_name", "idle_in_transaction_session_timeout", "lock_timeout", "statement_timeout"],
      required: [],
    },
    acl: {
      fixed_semantic_references: ["PUBLIC", "pg_database_owner"],
      allowed_grantors: [projectedIdentities.migration_owner, "pg_database_owner"].sort(),
      allowed_grantees: [
        "PUBLIC", projectedIdentities.admin_privilege_group, projectedIdentities.backup_privilege_group,
        projectedIdentities.migration_owner, projectedIdentities.web_privilege_group,
        projectedIdentities.worker_privilege_group, "pg_database_owner",
      ].sort(),
      grantable_roles: [projectedIdentities.migration_owner],
      public_allowed_privileges: publicPrivileges(),
      non_owner_allowed_privileges: nonOwnerPrivileges(),
    },
    supported_object_kinds: [...SUPPORTED_OBJECT_KINDS],
    extensions: { allowed: extensions, required: extensions.map((extension) => extension.name) },
    unsupported_catalog_counters: [...UNSUPPORTED_COUNTERS],
    tablespaces: { allow_custom: false, maximum_custom: 0, owner: projectedIdentities.platform_owner },
    credential_binding: { login_roles: loginRoles, minimum_password_bytes: 32, maximum_password_bytes: 64 },
    runtime_privilege_binding: {
      path: RUNTIME_PRIVILEGE_POLICY_V2_PATH,
      contract: runtimePolicy.contract,
      policy_id: runtimePolicy.policy_id,
      policy_sha256: runtimePolicy.policy_sha256,
      file_sha256: digest(runtimePolicyRaw),
      access_sha256: binding.access_intent.access_sha256,
      compiled_catalog_sha256: binding.compiled_catalog.catalog_sha256,
      compiled_catalog_artifact_sha256: binding.compiled_catalog.artifact_sha256,
      migration_head: binding.migrations.head,
      migration_count: binding.migrations.count,
      migration_source_set_sha256: binding.migrations.source_set_sha256,
      migration_allowlist_sha256: binding.migrations.allowlist_sha256,
      engine_image_reference: binding.engine_binding.image_reference,
      engine_server_version_num: binding.engine_binding.server_version_num,
      role_set_sha256: clusterSha256(projectedRoles),
      membership_set_sha256: clusterSha256(memberships),
      login_role_set_sha256: clusterSha256(loginRoles),
      service_bindings_sha256: clusterSha256(runtimePolicy.service_bindings),
      default_privileges_sha256: clusterSha256(runtimePolicy.default_privileges),
      extensions_sha256: clusterSha256(runtimePolicy.extensions),
      acl_summary_sha256: clusterSha256(runtimePolicy.acl_summary),
      object_constraints_sha256: clusterSha256(runtimePolicy.object_constraints),
      tablespaces_sha256: clusterSha256(runtimePolicy.tablespaces),
      operator_policy_path: RUNTIME_PRIVILEGE_OPERATOR_POLICY_V1_PATH,
      operator_policy_contract: operatorPolicy.contract,
      operator_policy_sha256: operatorPolicy.policy_sha256,
      operator_policy_file_sha256: digest(operatorPolicyRaw),
    },
    actual_recovery_controls: {
      required_recovery_control_intent_contract: RECOVERY_CONTROL_INTENT_V2_CONTRACT,
      required_runtime_privilege_receipt_contract: RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CONTRACT,
      required_runtime_privilege_operation: "BOOTSTRAP",
      required_runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
      allowed_deployment_classes: ["PRODUCTION", "UAT"],
      required_isolated_target_deployment_class: "TEST",
      required_data_domains: ["POSTGRESQL", "attachments", "backup_status", "uploads"],
      required_target_bootstrap_state: "EMPTY_NEW_CLUSTER",
      required_prepublication_connection_state: "NETWORK_FENCED_NO_APPLICATION_WRITERS",
      source_overwrite_forbidden: true,
      large_object_verification_required: true,
      secret_rebinding_required: true,
      target_disposition_required: true,
      rpo_rto_activation_binding_required: true,
      one_time_authorization_required: true,
      approval_reference_sha256_required: true,
      distinct_source_target_system_identifier_required: true,
      distinct_source_target_machine_identity_required: true,
      distinct_source_target_location_required: true,
      root_credential_binding_required: true,
      operations_policy_match_required: true,
      runtime_release_identity_match_required: true,
    },
    activation: {
      status: "REPOSITORY_TEMPLATE",
      environment: null,
      generation: 0,
      previous_policy_sha256: ZERO_SHA256,
      supervisor_bundle_sha256: ZERO_SHA256,
      authorization_sha256: ZERO_SHA256,
      approval_reference_sha256: ZERO_SHA256,
      responsible_operator_identity_sha256: ZERO_SHA256,
      approver_identity_sha256: ZERO_SHA256,
      rpo_hours: null,
      rto_minutes: null,
      target_disposition: null,
      activated_at: null,
      expires_at: null,
    },
  };
  return validateClusterRecoveryPolicyV2(body);
}

export function activateClusterRecoveryPolicyV2(templateInput, activation) {
  const template = validateClusterRecoveryPolicyV2(templateInput);
  if (template.activation.status !== "REPOSITORY_TEMPLATE" || !activation || typeof activation !== "object" || Array.isArray(activation)) {
    reject("CLUSTER_POLICY_V2_ACTIVATION_SOURCE_INVALID");
  }
  const policy = structuredClone(template);
  policy.activation = { status: "ACTIVATED", ...structuredClone(activation) };
  return validateClusterRecoveryPolicyV2(policy);
}

export async function createRepositoryClusterRecoveryPolicyV2(siteRoot = SITE_ROOT) {
  const basePolicyRaw = await readFile(path.join(siteRoot, CLUSTER_RECOVERY_POLICY_V1_PATH));
  const runtimePolicyRaw = await readFile(path.join(siteRoot, RUNTIME_PRIVILEGE_POLICY_V2_PATH));
  const operatorPolicyRaw = await readFile(path.join(siteRoot, RUNTIME_PRIVILEGE_OPERATOR_POLICY_V1_PATH));
  let basePolicy;
  let runtimePolicy;
  let operatorPolicy;
  try { basePolicy = parseStrictJson(basePolicyRaw.toString("utf8")); }
  catch { reject("CLUSTER_POLICY_V2_BASE_SOURCE_INVALID"); }
  try { runtimePolicy = parseStrictJson(runtimePolicyRaw.toString("utf8")); }
  catch { reject("CLUSTER_POLICY_V2_RUNTIME_SOURCE_INVALID"); }
  try { operatorPolicy = parseStrictJson(operatorPolicyRaw.toString("utf8")); }
  catch { reject("CLUSTER_POLICY_V2_OPERATOR_SOURCE_INVALID"); }
  const verifiedRuntime = await loadRuntimePrivilegePolicySources({ siteRoot }).catch(() => reject("CLUSTER_POLICY_V2_RUNTIME_SOURCE_INVALID"));
  if (canonicalClusterJson(verifiedRuntime.policy) !== canonicalClusterJson(runtimePolicy)) {
    reject("CLUSTER_POLICY_V2_RUNTIME_SOURCE_INVALID");
  }
  await verifyRuntimePrivilegeOperatorPolicySources(operatorPolicy, { siteRoot })
    .catch(() => reject("CLUSTER_POLICY_V2_OPERATOR_SOURCE_INVALID"));
  return buildClusterRecoveryPolicyV2(basePolicy, basePolicyRaw, runtimePolicy, runtimePolicyRaw, operatorPolicy, operatorPolicyRaw);
}

export async function verifyRepositoryClusterRecoveryPolicyV2(siteRoot = SITE_ROOT) {
  const expected = await createRepositoryClusterRecoveryPolicyV2(siteRoot);
  const source = await readFile(path.join(siteRoot, CLUSTER_RECOVERY_POLICY_V2_PATH), "utf8");
  if (source !== `${JSON.stringify(expected, null, 2)}\n`) reject("CLUSTER_POLICY_V2_REPOSITORY_FILE_STALE");
  return expected;
}

async function main(argumentsList) {
  if (argumentsList.length !== 1 || !new Set(["generate", "verify"]).has(argumentsList[0])) reject("CLUSTER_POLICY_V2_USAGE_INVALID");
  if (argumentsList[0] === "generate") {
    process.stdout.write(`${JSON.stringify(await createRepositoryClusterRecoveryPolicyV2(), null, 2)}\n`);
    return;
  }
  const policy = await verifyRepositoryClusterRecoveryPolicyV2();
  process.stdout.write(`CLUSTER_RECOVERY_POLICY_V2_VERIFIED sha256=${clusterRecoveryPolicyV2Sha256(policy)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "CLUSTER_POLICY_V2_FAILED"}\n`);
    process.exitCode = 1;
  });
}
