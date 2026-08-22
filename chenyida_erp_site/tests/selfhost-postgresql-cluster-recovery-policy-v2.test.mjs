import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clusterPolicySha256,
  clusterSha256,
  createRecoveryIntent,
  validateClusterRecoveryPolicy,
  validateRecoveryIntent,
} from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  baseClusterRecoveryPolicy,
  clusterRecoveryPolicyV2Sha256,
  createRecoveryControlIntentV2,
  validateClusterRecoveryPolicyForReadiness,
  validateClusterRecoveryPolicyV2,
  validateRecoveryControlIntentForPolicy,
} from "../scripts/postgresql-cluster-recovery-policy-v2-contract.mjs";
import {
  activateClusterRecoveryPolicyV2,
  verifyRepositoryClusterRecoveryPolicyV2,
} from "../scripts/postgresql-cluster-recovery-policy-v2.mjs";

const digest = (character) => character.repeat(64);
const v1Source = await readFile(new URL("../operations/postgresql-cluster-recovery-policy-v1.json", import.meta.url));
const v1 = JSON.parse(v1Source.toString("utf8"));
const template = JSON.parse(await readFile(new URL("../operations/postgresql-cluster-recovery-policy-v2.json", import.meta.url), "utf8"));

function activatedPolicy(overrides = {}) {
  return activateClusterRecoveryPolicyV2(template, {
    environment: "UAT",
    generation: 1,
    previous_policy_sha256: digest("0"),
    supervisor_bundle_sha256: digest("1"),
    authorization_sha256: digest("2"),
    approval_reference_sha256: digest("3"),
    responsible_operator_identity_sha256: digest("4"),
    approver_identity_sha256: digest("5"),
    rpo_hours: 24,
    rto_minutes: 120,
    target_disposition: "DESTROY_AFTER_EVIDENCE",
    activated_at: "2026-07-25T01:00:00.000Z",
    expires_at: "2026-07-26T01:00:00.000Z",
    ...overrides,
  });
}

function baseIntent(policy, overrides = {}) {
  const basePolicy = baseClusterRecoveryPolicy(policy);
  const actual = policy.activation?.status === "ACTIVATED";
  return createRecoveryIntent({
    restore_run_id: "restore-policy-v2-1",
    backup_id: "backup-policy-v2-1",
    created_at: "2026-07-25T01:20:00.000Z",
    evidence_scope: actual ? "ACTUAL_CONTROLLED" : "SYNTHETIC_TEST_ONLY",
    policy_sha256: clusterPolicySha256(basePolicy),
    snapshot_sha256: digest("6"),
    data_transfer_acceptance_sha256: digest("7"),
    cluster_transfer_acceptance_sha256: digest("8"),
    joint_transfer_sha256: digest("9"),
    target_system_identifier_sha256: digest("e"),
    target_empty_state_sha256: digest("a"),
    credential_generation_id: "base-credential-v1-1",
    credential_role_set_sha256: clusterSha256(basePolicy.credential_binding.login_roles),
    tablespace_map_sha256: digest("b"),
    custom_tablespace_identity_sha256: [],
    ...overrides,
  });
}

function recoveryControl(policy, controlOverrides = {}, baseOverrides = {}) {
  const base = baseIntent(policy, baseOverrides);
  const actual = base.evidence_scope === "ACTUAL_CONTROLLED";
  const control = createRecoveryControlIntentV2({
    restore_run_id: base.restore_run_id,
    backup_id: base.backup_id,
    created_at: "2026-07-25T01:30:00.000Z",
    evidence_scope: base.evidence_scope,
    policy_sha256: clusterRecoveryPolicyV2Sha256(policy),
    base_policy_sha256: base.policy_sha256,
    base_recovery_intent_sha256: base.intent_sha256,
    deployment_class: actual ? "UAT" : "TEST",
    target_deployment_class: "TEST",
    source_location_id: "uat-source",
    target_location_id: "isolated-target",
    target_disposition: "DESTROY_AFTER_EVIDENCE",
    rpo_hours: 24,
    rto_minutes: 120,
    recovery_operator_identity_sha256: digest("8"),
    recovery_approver_identity_sha256: digest("9"),
    source_system_identifier_sha256: digest("d"),
    target_system_identifier_sha256: base.target_system_identifier_sha256,
    source_machine_identity_sha256: digest("a"),
    target_machine_identity_sha256: digest("b"),
    supervisor_bundle_sha256: digest("1"),
    authorization_sha256: digest("6"),
    approval_reference_sha256: digest("7"),
    release_manifest_sha256: digest("c"),
    runtime_configuration_sha256: digest("d"),
    runtime_privilege_policy_sha256: policy.runtime_privilege_binding.policy_sha256,
    operations_policy_sha256: digest("e"),
    runtime_credential_generation_id: "runtime-credential-v2-1",
    runtime_credential_role_set_sha256: policy.runtime_privilege_binding.login_role_set_sha256,
    ...controlOverrides,
  });
  return { base, control };
}

test("repository V2 is generated exactly from immutable V1 and current runtime privilege sources", async () => {
  assert.deepEqual(await verifyRepositoryClusterRecoveryPolicyV2(), template);
  assert.equal(template.base_cluster_policy_binding.contract, v1.contract);
  assert.equal(template.base_cluster_policy_binding.policy_sha256, clusterPolicySha256(v1));
  assert.equal(template.base_cluster_policy_binding.file_sha256, createHash("sha256").update(v1Source).digest("hex"));
  assert.deepEqual(template.base_cluster_policy_binding.policy, v1);
  assert.equal(template.roles.length, 9);
  assert.equal(template.memberships.length, 4);
  assert.equal(template.credential_binding.login_roles.length, 5);
  assert.equal(template.runtime_privilege_binding.migration_head, "0046_runtime_lock_privilege_boundary.sql");
  assert.equal(template.runtime_privilege_binding.policy_sha256, "1e147e55b5285fc548ba8bc473e044e9f4e6a4b80be6b3520ec257fcbc1c29f7");
  assert.deepEqual(template.actual_recovery_controls.required_data_domains, ["POSTGRESQL", "attachments", "backup_status", "uploads"]);
  assert.ok(template.supported_object_kinds.includes("LARGE_OBJECT"));
  assert.equal(template.activation.status, "REPOSITORY_TEMPLATE");
});

test("immutable V1 remains independently readable and is the exact base recovery policy", () => {
  assert.equal(validateClusterRecoveryPolicy(v1), v1);
  assert.equal(validateClusterRecoveryPolicyForReadiness(v1), v1);
  assert.equal(validateClusterRecoveryPolicyForReadiness(template), template);
  assert.deepEqual(baseClusterRecoveryPolicy(template), v1);
  const base = baseIntent(template);
  assert.equal(validateRecoveryIntent(base), base);
  assert.equal(base.policy_sha256, template.base_cluster_policy_binding.policy_sha256);
  assert.notEqual(base.credential_role_set_sha256, template.runtime_privilege_binding.login_role_set_sha256);
});

test("actual V2 control binds the V1 recovery intent, activation, isolated target, runtime privileges and SLA", () => {
  const policy = activatedPolicy();
  const { base, control } = recoveryControl(policy);
  assert.deepEqual(validateRecoveryControlIntentForPolicy(control, policy, base), { control, baseIntent: base });
  for (const [name, controlOverrides, baseOverrides, code] of [
    ["source environment", { deployment_class: "PRODUCTION" }, {}, "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH"],
    ["target environment", { target_deployment_class: "UAT" }, {}, "RECOVERY_CONTROL_INTENT_V2_DEPLOYMENT_INVALID"],
    ["RPO", { rpo_hours: 12 }, {}, "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH"],
    ["RTO", { rto_minutes: 121 }, {}, "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH"],
    ["disposition", { target_disposition: "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT" }, {}, "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH"],
    ["source cluster", { source_system_identifier_sha256: digest("e") }, {}, "RECOVERY_CONTROL_INTENT_V2_ISOLATION_INVALID"],
    ["target host", { target_machine_identity_sha256: digest("a") }, {}, "RECOVERY_CONTROL_INTENT_V2_ISOLATION_INVALID"],
    ["reused approval", { approval_reference_sha256: digest("6") }, {}, "RECOVERY_CONTROL_INTENT_V2_ISOLATION_INVALID"],
    ["policy authorization", { authorization_sha256: digest("2") }, {}, "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH"],
    ["reused policy actor", { recovery_operator_identity_sha256: digest("5") }, {}, "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH"],
    ["different base target", {}, { target_system_identifier_sha256: digest("f") }, "RECOVERY_CONTROL_INTENT_V2_BINDING_MISMATCH"],
    ["runtime role set", { runtime_credential_role_set_sha256: digest("f") }, {}, "RECOVERY_CONTROL_INTENT_V2_BINDING_MISMATCH"],
  ]) {
    assert.throws(() => {
      const fixture = recoveryControl(policy, controlOverrides, baseOverrides);
      validateRecoveryControlIntentForPolicy(fixture.control, policy, base);
    }, (error) => error.code === code, name);
  }
});

test("repository template permits only explicitly synthetic TEST control evidence", () => {
  const { base, control } = recoveryControl(template);
  assert.deepEqual(validateRecoveryControlIntentForPolicy(control, template, base), { control, baseIntent: base });
  const actualBase = baseIntent(template, { evidence_scope: "ACTUAL_CONTROLLED" });
  const actualControl = createRecoveryControlIntentV2({
    ...Object.fromEntries(Object.entries(control).filter(([key]) => !["schema_version", "contract", "intent_sha256"].includes(key))),
    evidence_scope: "ACTUAL_CONTROLLED",
    deployment_class: "UAT",
    base_recovery_intent_sha256: actualBase.intent_sha256,
  });
  assert.throws(
    () => validateRecoveryControlIntentForPolicy(actualControl, template, actualBase),
    (error) => error.code === "RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH",
  );
});

test("V2 policy fails closed on activation, generation, role, ACL, extension and source drift", () => {
  const activated = activatedPolicy();
  const { base, control } = recoveryControl(activated);
  assert.throws(() => validateRecoveryControlIntentForPolicy(control, template, base), (error) => error.code === "RECOVERY_CONTROL_INTENT_V2_BINDING_MISMATCH");
  assert.throws(() => activatedPolicy({ generation: 2 }), (error) => error.code === "CLUSTER_POLICY_V2_ACTIVATION_GENERATION_INVALID");
  assert.throws(() => activatedPolicy({ approver_identity_sha256: digest("4") }), (error) => error.code === "CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  assert.throws(() => activatedPolicy({ approval_reference_sha256: digest("2") }), (error) => error.code === "CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  assert.throws(() => activatedPolicy({ rto_minutes: 0 }), (error) => error.code === "CLUSTER_POLICY_V2_ACTIVATION_SLA_INVALID");
  assert.throws(() => activatedPolicy({ expires_at: "2026-07-26T01:00:00.001Z" }), (error) => error.code === "CLUSTER_POLICY_V2_ACTIVATION_TIME_INVALID");
  for (const [name, mutate] of [
    ["role", (value) => { value.roles[0].connection_limit += 1; }],
    ["coherently re-signed role", (value) => {
      value.roles[0].connection_limit += 1;
      value.runtime_privilege_binding.role_set_sha256 = clusterSha256(value.roles);
    }],
    ["platform identity", (value) => { value.identities.platform_owner = "REPLACED_OWNER"; }],
    ["membership", (value) => { value.memberships[0].admin_option = true; }],
    ["public ACL", (value) => { value.acl.public_allowed_privileges.DATABASE.push("CONNECT"); }],
    ["large object", (value) => { value.supported_object_kinds = value.supported_object_kinds.filter((kind) => kind !== "LARGE_OBJECT"); }],
    ["extension", (value) => { value.extensions.allowed[0].owner = value.identities.migration_owner; }],
    ["tablespace", (value) => { value.tablespaces.allow_custom = true; }],
    ["runtime source", (value) => { value.runtime_privilege_binding.role_set_sha256 = digest("f"); }],
    ["default privileges source", (value) => { value.runtime_privilege_binding.default_privileges_sha256 = digest("f"); }],
    ["base policy", (value) => { value.base_cluster_policy_binding.policy.database.connection_limit += 1; }],
  ]) {
    const changed = structuredClone(template);
    mutate(changed);
    assert.throws(() => validateClusterRecoveryPolicyV2(changed), undefined, name);
  }
  assert.throws(() => validateClusterRecoveryPolicyV2({ ...template, unexpected: true }), (error) => error.code === "CLUSTER_POLICY_V2_INVALID");
});
