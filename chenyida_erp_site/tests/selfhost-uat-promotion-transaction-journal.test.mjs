import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, chown, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  PRE_DEPLOY_RUNTIME_GUARD_MODE,
  RELEASE_RUNTIME_POLICY_SHA256,
  officialReleaseLifecycle,
  runtimeGuardBinding,
} from "../scripts/release-lifecycle-contract.mjs";
import { canonicalJson as releaseCanonicalJson, migrationAllowlistDigest } from "../scripts/release-manifest-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import { createClusterRecoveryPolicyActivationReceipt } from "../scripts/postgresql-cluster-recovery-policy-v2-activation-contract.mjs";
import { readinessPolicySha256 } from "../scripts/postgresql-cluster-recovery-policy-v2-contract.mjs";
import { activateClusterRecoveryPolicyV2 } from "../scripts/postgresql-cluster-recovery-policy-v2.mjs";
import {
  canonicalMigrationExecutionJson,
  createUatPromotionMigrationEngineResult,
  createUatPromotionMigrationFence,
  createUatPromotionMigrationResult,
  UAT_PROMOTION_MIGRATION_DATABASE_OWNER_PRIVILEGES,
  UAT_PROMOTION_MIGRATION_MEMBERSHIPS,
  UAT_PROMOTION_MIGRATION_ROLE_RECORDS,
} from "../scripts/uat-promotion-migration-execution-contract.mjs";
import {
  createUatPromotionActiveFenceTransfer,
  createUatPromotionComposeDeploymentResult,
  createUatPromotionDatabaseHandoff,
} from "../scripts/uat-promotion-compose-deployment-contract.mjs";
import { runUatPromotionComposeDeploymentControl } from "../scripts/uat-promotion-compose-deployment-control.mjs";
import {
  canonicalRuntimeConfigurationProbeJson,
  createRuntimeConfigurationProbeReceipt,
} from "../scripts/postdeploy-runtime-configuration-probe.mjs";
import {
  buildPostDeployReceipt,
  buildReleaseIdentityFromPostDeployReceipt,
} from "../scripts/postdeploy-release-contract.mjs";
import {
  UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT,
  UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT,
  canonicalUatPromotionCrossRoleResultJson,
  createUatPromotionCrossRoleResult,
  uatPromotionCrossRoleControlObservations,
  uatPromotionCrossRoleSanitization,
} from "../scripts/uat-promotion-cross-role-evidence-contract.mjs";
import { canonicalJson as crossRoleCanonicalJson } from "../scripts/cross-role-uat-evidence-contract.mjs";
import {
  UAT_PROMOTION_CURRENT_FILE,
  UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT,
  UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT,
  UAT_PROMOTION_POLICY_FILE_SHA256,
  UAT_PROMOTION_POLICY_SHA256,
  UAT_PROMOTION_QUIESCE_INTENT_CONTRACT,
  UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT,
  UAT_PROMOTION_STATE_ROOT,
  ZERO_SHA256,
  createNextUatPromotionCheckpointReceipt,
  runUatPromotionTransactionPhase,
  validateUatPromotionCheckpointReceipt,
} from "../scripts/uat-promotion-transaction-journal.mjs";

const siteRoot = path.resolve(new URL("../", import.meta.url).pathname);
const gitCommit = "a".repeat(40);
const gitTree = "b".repeat(40);
const version = "0.1.0-alpha.47";
const webImage = `registry.example.com/chenyida-erp/web@sha256:${"c".repeat(64)}`;
const workerImage = `registry.example.com/chenyida-erp/worker@sha256:${"d".repeat(64)}`;
const databaseSystemIdentifier = "7612345678901234567";
const databaseOid = "16384";
const databaseMarker = "chenyida-erp-deployment/v2:UAT:chenyida-erp";
const supervisorBundleSha256 = digest("supervisor-bundle");
const candidatePath = "/var/lib/chenyida-erp/release-candidate-snapshots/receipts/promotion-fixture.prepared.json";
const manifestPath = "/var/lib/chenyida-erp/release-artifacts/promotion-alpha47/release-manifest.json";
const identityPath = "/var/lib/chenyida-erp/release-identity/release-identity.json";
const readinessPath = "/var/lib/chenyida-erp/backup-status/recovery-readiness.json";
const clusterPolicyPath = "/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json";
const clusterActivationPath = "/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2/current.json";
const clusterPolicyTemplate = JSON.parse(await readFile(new URL("../operations/postgresql-cluster-recovery-policy-v2.json", import.meta.url), "utf8"));
const crossRoleTemplateRaw = await readFile(new URL("../operations/cross-role-uat-evidence-contract-v1.json", import.meta.url), "utf8");
const crossRoleTemplate = JSON.parse(crossRoleTemplateRaw);
const composeRaw = "services:\n  web:\n    image: fixture\n";
const releaseComposeRaw = "services:\n  web:\n    image: ${ERP_WEB_IMAGE}\n";
const deploymentEnvironmentRaw = "ERP_DEPLOYMENT_CLASS=uat\n";

function digest(label) { return createHash("sha256").update(label).digest("hex"); }
function artifactMatches(name, operationId) {
  const matched = /^(.+)\.([0-9a-f]{64})\.json$/u.exec(name);
  return matched !== null && matched[1] === operationId;
}
function physical(root, logical) { return path.join(root, logical.slice(1)); }

async function directory(root, logical, mode = 0o755) {
  const target = physical(root, logical);
  await mkdir(target, { recursive: true, mode });
  await chmod(target, mode);
  return target;
}

async function canonicalFile(root, logical, value, mode) {
  const file = physical(root, logical);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  await writeFile(file, canonicalClusterJson(value), { mode });
  await chmod(file, mode);
  return file;
}

async function rawFile(root, logical, raw, mode) {
  const file = physical(root, logical);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  await writeFile(file, raw, { mode });
  await chmod(file, mode);
  return file;
}

async function source(root, logical) {
  const file = physical(root, logical);
  const [raw, metadata] = await Promise.all([readFile(file), lstat(file, { bigint: true })]);
  return Object.freeze({
    path: logical,
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.length,
    device: String(metadata.dev),
    inode: String(metadata.ino),
    uid: Number(metadata.uid),
    gid: Number(metadata.gid),
    mode: (Number(metadata.mode & 0o7777n)).toString(8).padStart(4, "0"),
    nlink: Number(metadata.nlink),
  });
}

function migrations() {
  return Array.from({ length: 46 }, (_, index) => {
    const ordinal = index + 1;
    const prefix = String(ordinal).padStart(4, "0");
    return {
      ordinal,
      filename: ordinal === 46 ? "0046_runtime_lock_privilege_boundary.sql" : `${prefix}_promotion_fixture_${prefix}.sql`,
      sha256: digest(`migration-${ordinal}`),
    };
  });
}

function manifest(entries) {
  const migrationDigest = migrationAllowlistDigest(entries);
  const image = (service, reference, imageDigest) => ({
    service, image_reference: reference, image_digest: imageDigest, oci_version: version, oci_revision: gitCommit,
    baked_version: version, baked_revision: gitCommit,
  });
  return {
    schema_version: 2,
    contract: "chenyida-erp-release-manifest/v2",
    release_id: "promotion-alpha47",
    generated_at: "2026-08-15T00:55:00.000Z",
    expires_at: "2026-08-15T02:00:00.000Z",
    promotion_status: "ELIGIBLE",
    lifecycle: officialReleaseLifecycle(),
    control: {
      supervisor_bundle_sha256: supervisorBundleSha256, image_evidence_authorization_sha256: digest("image-authorization"),
      release_gate_authorization_sha256: digest("gate-authorization"), manifest_authorization_sha256: digest("manifest-authorization"),
    },
    source: {
      git_commit: gitCommit, git_tree: gitTree, worktree_clean: true, package_path: "chenyida_erp_site/package.json",
      package_version: version, package_sha256: digest("package"), dockerfile_path: "chenyida_erp_site/Dockerfile",
      dockerfile_sha256: digest("dockerfile"), compose_path: "chenyida_erp_site/compose.yml",
      compose_sha256: createHash("sha256").update(composeRaw).digest("hex"),
      release_compose_path: "chenyida_erp_site/compose.release.yml",
      release_compose_sha256: createHash("sha256").update(releaseComposeRaw).digest("hex"),
    },
    images: {
      web: image("web", webImage, `sha256:${"c".repeat(64)}`),
      worker: image("worker", workerImage, `sha256:${"d".repeat(64)}`),
    },
    migrations: { directory: "chenyida_erp_site/drizzle-postgres", head: entries.at(-1).filename, allowlist_sha256: migrationDigest, entries },
    gate: {
      plan_id: "selfhost-release-gate-v2", plan_file: "promotion.plan.json", plan_sha256: digest("plan"),
      report_file: "promotion.report.json", report_sha256: digest("report"), runtime_guard_mode: PRE_DEPLOY_RUNTIME_GUARD_MODE, result: "PASS",
    },
    evidence: {
      sbom_file: "promotion.sbom.json", sbom_sha256: digest("sbom"), sbom_scope: "WEB_AND_WORKER_IMAGES",
      security_file: "promotion.security.json", security_sha256: digest("security"), security_result: "PASS",
    },
    allowed_deployment_classes: ["UAT"],
  };
}

function releaseIdentity(migrationDigest) {
  return {
    schema_version: 3,
    contract: "chenyida-erp-runtime-release-identity/v3",
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    release_id: "current-alpha47",
    release_manifest_sha256: digest("current-release-manifest"),
    postdeploy_receipt_sha256: digest("current-postdeploy"),
    supervisor_bundle_sha256: digest("current-supervisor"),
    authorization_sha256: digest("current-authorization"),
    runtime_guard: runtimeGuardBinding(POST_DEPLOY_RUNTIME_GUARD_MODE),
    runtime_policy_sha256: RELEASE_RUNTIME_POLICY_SHA256,
    application_version: version,
    git_commit: "e".repeat(40),
    git_tree: "f".repeat(40),
    migration_head: "0046_runtime_lock_privilege_boundary.sql",
    migration_manifest_sha256: migrationDigest,
    caddy_container_id: "1".repeat(64),
    caddy_image_digest: `sha256:${"1".repeat(64)}`,
    postgres_container_id: "2".repeat(64),
    postgres_image_digest: `sha256:${"2".repeat(64)}`,
    web_container_id: "3".repeat(64),
    web_image_digest: `sha256:${"3".repeat(64)}`,
    worker_container_id: "4".repeat(64),
    worker_image_digest: `sha256:${"4".repeat(64)}`,
    generated_at: "2026-08-15T00:50:00.000Z",
  };
}

function readiness(snapshotSha256) {
  const body = {
    schema_version: 4,
    contract: "chenyida-erp-backup-verification/v4",
    result: "RECOVERY_READY",
    evidence_scope: "ACTUAL_OFFHOST",
    backup_id: "promotion-recovery-fixture",
    restore_run_id: "promotion-restore-fixture",
    created_at: "2026-08-14T20:00:00.000Z",
    verified_at: "2026-08-15T00:40:00.000Z",
    expires_at: "2026-08-16T00:40:00.000Z",
    data_readiness: {
      receipt: {
        result: "RECOVERY_READY", evidence_scope: "ACTUAL_OFFHOST",
        inner_restore: { receipt: { deployment: { class: "UAT", id: "chenyida-erp", database: "chenyida_erp", database_oid: databaseOid, database_system_identifier: databaseSystemIdentifier, database_marker: databaseMarker } } },
      },
    },
    recovery_execution: { states: [{ phase: "PUBLISHED" }] },
    cluster_security: { status: "VERIFIED", snapshot_sha256: snapshotSha256 },
    status: {
      data_restore: "VERIFIED", data_transfer: "VERIFIED", cluster_transfer: "VERIFIED", cluster_security: "VERIFIED",
      credential_binding: "VERIFIED", tablespace: "VERIFIED", recovery_execution: "PUBLISHED", schedule: "ON_TIME",
      retention: "POLICY_VALID_DRY_RUN",
    },
    attestation: "ROOT_PUBLISHED_DATA_V3_JOINT_TRANSFER_V2_CLUSTER_SECURITY_CREDENTIAL_TABLESPACE_AND_RECOVERY_STATE_VERIFIED",
  };
  return { ...body, readiness_sha256: clusterSha256(body) };
}

async function fixture({ promotionId = "promotion-fixture-001" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-uat-promotion-"));
  await chmod(root, 0o700);
  for (const logical of ["/var", "/var/lib", "/var/lib/chenyida-erp", "/var/lib/chenyida-erp/release-candidate-snapshots", "/var/lib/chenyida-erp/release-candidate-snapshots/receipts", "/var/lib/chenyida-erp/release-artifacts", "/var/lib/chenyida-erp/release-artifacts/promotion-alpha47"]) await directory(root, logical, logical.endsWith("receipts") ? 0o700 : 0o755);
  const candidate = {
    schema_version: 1, contract: "chenyida-erp-release-candidate-snapshot/v1", state: "PREPARED",
    snapshot_id: "promotion-fixture", source_repository: { root: "/opt/erp" },
    candidate: { commit: gitCommit, tree: gitTree }, test_runtime: { root: "/opt/erp" },
  };
  await canonicalFile(root, candidatePath, candidate, 0o400);
  const entries = migrations();
  const release = manifest(entries);
  await rawFile(root, "/var/lib/chenyida-erp/release-artifacts/promotion-alpha47/.chenyida-erp-release-artifact-root-v1", "chenyida-erp-release-artifact-root/v1\n", 0o440);
  await rawFile(root, manifestPath, releaseCanonicalJson(release), 0o440);
  await directory(root, "/var/lib/chenyida-erp/release-identity", 0o750);
  await rawFile(root, "/var/lib/chenyida-erp/release-identity/.chenyida-erp-release-identity-root-v1", "chenyida-erp-release-identity-root/v1\n", 0o440);
  await canonicalFile(root, identityPath, releaseIdentity(migrationAllowlistDigest(entries)), 0o440);
  await directory(root, "/var/lib/chenyida-erp/backup-status", 0o750);
  await rawFile(root, "/var/lib/chenyida-erp/backup-status/.chenyida-erp-receipt-root-v2", "chenyida-erp-receipt-root/v2\n", 0o440);
  const snapshotSha256 = digest("preupgrade-snapshot");
  const recovery = readiness(snapshotSha256);
  await canonicalFile(root, readinessPath, recovery, 0o440);
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: promotionId,
    promotion_generation: 1,
    previous_promotion_receipt_sha256: ZERO_SHA256,
    repository_root: "/opt/erp",
    git_commit: gitCommit,
    git_tree: gitTree,
    candidate_snapshot_receipt: candidatePath,
    candidate_snapshot_receipt_sha256: (await source(root, candidatePath)).sha256,
    candidate_snapshot_source: await source(root, candidatePath),
    test_runtime_root: "/opt/erp",
    application_version: version,
    release_manifest: manifestPath,
    release_manifest_sha256: (await source(root, manifestPath)).sha256,
    release_manifest_source: await source(root, manifestPath),
    web_image: webImage,
    worker_image: workerImage,
    migration_head: entries.at(-1).filename,
    migration_manifest_sha256: migrationAllowlistDigest(entries),
    current_runtime_identity_source: await source(root, identityPath),
    recovery_readiness_source: await source(root, readinessPath),
    preupgrade_recovery_readiness_sha256: recovery.readiness_sha256,
    preupgrade_recovery_snapshot_sha256: snapshotSha256,
    database_name: "chenyida_erp",
    database_oid: databaseOid,
    database_system_identifier: databaseSystemIdentifier,
    database_marker: databaseMarker,
    promotion_created_at: "2026-08-15T01:00:00.000Z",
    promotion_expires_at: "2026-08-15T01:50:00.000Z",
    requester_identity_sha256: digest("requester"),
    approver_identity_sha256: digest("approver"),
    executor_identity_sha256: digest("executor"),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
    current_promotion_source: null,
  };
  const originalAuthorization = digest(`authorization-${promotionId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: promotionId,
    operation: "BEGIN",
    execution_mode: "ORIGINAL",
    execution_authorization_id: promotionId,
    execution_authorization_sha256: originalAuthorization,
    execution_created_at: parameters.promotion_created_at,
    original_authorization_sha256: originalAuthorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { root, context };
}

function recoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:05:00.000Z",
    expected_intent_sha256: intentSha256,
  };
}

function snapshotObjects() {
  return {
    postgresql: { file: "postgresql.dump", sha256: digest("snapshot-postgresql"), bytes: 101, entries: null },
    uploads: { file: "uploads.tar.gz", sha256: digest("snapshot-uploads"), bytes: 102, entries: 2 },
    attachments: { file: "attachments.tar.gz", sha256: digest("snapshot-attachments"), bytes: 103, entries: 3 },
    backup_status: { file: "backup-status.tar.gz", sha256: digest("snapshot-backup-status"), bytes: 104, entries: 4 },
  };
}

function activatedSnapshotPolicy() {
  return activateClusterRecoveryPolicyV2(clusterPolicyTemplate, {
    environment: "UAT",
    generation: 1,
    previous_policy_sha256: ZERO_SHA256,
    supervisor_bundle_sha256: supervisorBundleSha256,
    authorization_sha256: digest("cluster-policy-authorization"),
    approval_reference_sha256: digest("cluster-policy-approval"),
    responsible_operator_identity_sha256: digest("cluster-policy-operator"),
    approver_identity_sha256: digest("cluster-policy-approver"),
    rpo_hours: 24,
    rto_minutes: 120,
    target_disposition: "DESTROY_AFTER_EVIDENCE",
    activated_at: "2026-08-15T00:45:00.000Z",
    expires_at: "2026-08-16T00:40:00.000Z",
  });
}

function snapshotReadiness(identity, activation, objects, variant = "valid") {
  const backupId = "promotion-snapshot-fixture";
  const restoreRunId = "promotion-snapshot-restore";
  const sourceDatabaseOid = variant === "cross-database" ? "16385" : databaseOid;
  const sourceMachine = digest("snapshot-source-machine");
  const receiverMachine = variant === "same-host" ? sourceMachine : digest("snapshot-receiver-machine");
  const artifacts = {
    postgresql_dump: { ...objects.postgresql },
    uploads: { ...objects.uploads },
    attachments: { ...objects.attachments },
    backup_status: { ...objects.backup_status },
  };
  delete artifacts.postgresql_dump.entries;
  if (variant === "missing-domain") delete artifacts.backup_status;
  const restore = {
    schema_version: 2,
    contract: "chenyida-erp-backup-verification/v2",
    result: "RESTORE_VERIFIED",
    backup_id: backupId,
    created_at: variant === "old-evidence" ? "2026-08-15T00:30:00.000Z" : "2026-08-15T01:15:00.000Z",
    verified_at: "2026-08-15T01:25:00.000Z",
    expires_at: "2026-08-15T02:00:00.000Z",
    location_id: "snapshot-isolated-restore",
    deployment: {
      class: "UAT", id: "chenyida-erp", database: "chenyida_erp", database_system_identifier: databaseSystemIdentifier,
      database_oid: sourceDatabaseOid, database_marker: databaseMarker, database_bytes: 2048,
    },
    application: {
      version: identity.application_version, git_commit: identity.git_commit,
      web_image_digest: identity.web_image_digest, worker_image_digest: identity.worker_image_digest,
    },
    migration: { head: identity.migration_head, manifest_sha256: identity.migration_manifest_sha256 },
    consistency: {
      method: "QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION",
      database_snapshot: "PG_DUMP_CONSISTENT_SNAPSHOT",
      writer_boundary: "EXACT_COMPOSE_WEB_WORKER_STOPPED",
      recovery_point_at: variant === "old-evidence" ? "2026-08-15T00:29:00.000Z" : "2026-08-15T01:14:00.000Z",
      verified_after: variant === "old-evidence" ? "2026-08-15T00:30:00.000Z" : "2026-08-15T01:20:00.000Z",
      web_container: "chenyida-erp-web-1",
      web_container_id: identity.web_container_id,
      worker_container: "chenyida-erp-worker-1",
      worker_container_id: identity.worker_container_id,
    },
    artifacts,
    evidence: {
      kind: "ISOLATED_RESTORE_VERIFICATION",
      target: { database_system_identifier: "8612345678901234567" },
    },
    manifest_sha256: digest("snapshot-manifest"),
  };
  const innerRestoreSha256 = clusterSha256(restore);
  const body = {
    schema_version: 4,
    contract: "chenyida-erp-backup-verification/v4",
    result: variant === "synthetic" ? "SYNTHETIC_ISOLATED_VERIFIED" : "RECOVERY_READY",
    evidence_scope: variant === "synthetic" ? "SYNTHETIC_ISOLATED" : "ACTUAL_OFFHOST",
    backup_id: backupId,
    restore_run_id: restoreRunId,
    created_at: restore.created_at,
    verified_at: "2026-08-15T01:30:00.000Z",
    expires_at: "2026-08-15T02:00:00.000Z",
    data_readiness: {
      receipt: {
        inner_restore: { receipt_canonical_sha256: innerRestoreSha256, receipt: restore },
        transfer: {
          source_location_id: "snapshot-source", receiver_location_id: "snapshot-offhost",
          source_machine_identity_sha256: sourceMachine, receiver_machine_identity_sha256: receiverMachine,
        },
      },
    },
    joint_transfer: { receipt_sha256: digest("snapshot-joint-transfer") },
    recovery_execution: { states: [{ phase: variant === "partial" ? "PREPARED" : "PUBLISHED", state_sha256: digest("snapshot-final-state") }] },
    cluster_security: { status: "VERIFIED", receipt_sha256: digest("snapshot-cluster-security") },
    credential_binding: { status: "VERIFIED", receipt_sha256: digest("snapshot-credential") },
    tablespace: { status: "VERIFIED", receipt_sha256: digest("snapshot-tablespace") },
    policy_activation: { receipt_sha256: activation.receipt_sha256, receipt: activation },
    status: {
      data_restore: "VERIFIED", data_transfer: "VERIFIED", cluster_transfer: "VERIFIED", cluster_security: "VERIFIED",
      credential_binding: "VERIFIED", tablespace: "VERIFIED", recovery_execution: variant === "partial" ? "PREPARED" : "PUBLISHED",
      schedule: "ON_TIME", retention: "POLICY_VALID_DRY_RUN", runtime_privilege: "VERIFIED", policy_activation: "VERIFIED",
    },
    attestation: "ROOT_PUBLISHED_DATA_V3_JOINT_TRANSFER_V2_CLUSTER_SECURITY_CREDENTIAL_TABLESPACE_RECOVERY_STATE_RUNTIME_PRIVILEGE_AND_COMMITTED_POLICY_ACTIVATION_VERIFIED",
  };
  return { ...body, readiness_sha256: clusterSha256(body) };
}

async function snapshotFixture({ promotionId = "promotion-snapshot-001", variant = "valid", operationId = null } = {}) {
  const base = await fixture({ promotionId });
  await run(base.context, "prepare", base.root);
  await run(base.context, "execute", base.root);
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(physical(base.root, UAT_PROMOTION_CURRENT_FILE), "utf8")));
  const identity = releaseIdentity(migrationAllowlistDigest(migrations()));
  const identitySource = await source(base.root, identityPath);
  const policy = activatedSnapshotPolicy();
  const activation = createClusterRecoveryPolicyActivationReceipt({
    policy,
    activationId: "snapshot-policy-activation",
    operation: "ACTIVATE",
    previousActivationReceiptSha256: ZERO_SHA256,
    releaseIdentitySha256: identitySource.sha256,
  });
  await directory(base.root, "/etc", 0o755);
  await directory(base.root, "/etc/chenyida-erp", 0o755);
  await directory(base.root, "/etc/chenyida-erp/recovery", 0o755);
  await rawFile(base.root, "/etc/chenyida-erp/recovery/.chenyida-erp-postgresql-cluster-recovery-policy-v2", "chenyida-erp-postgresql-cluster-recovery-policy-target/v1\n", 0o400);
  await canonicalFile(base.root, clusterPolicyPath, policy, 0o440);
  await directory(base.root, "/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2", 0o700);
  await rawFile(base.root, "/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2/.chenyida-erp-postgresql-cluster-recovery-policy-v2", "chenyida-erp-postgresql-cluster-recovery-policy-activation/v1\n", 0o400);
  await canonicalFile(base.root, clusterActivationPath, activation, 0o400);
  const objects = snapshotObjects();
  const recovery = snapshotReadiness(identity, activation, objects, variant);
  const snapshotPath = `/var/lib/chenyida-erp/backup-status/${recovery.backup_id}.${recovery.restore_run_id}.recovery-readiness-v4.json`;
  await canonicalFile(base.root, snapshotPath, recovery, 0o640);
  const snapshotOperationId = operationId ?? `${promotionId}-capture`;
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: promotionId,
    promotion_generation: current.promotion_generation,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    promotion_intent_sha256: current.intent_sha256,
    promotion_original_authorization_sha256: current.original_authorization_sha256,
    candidate_binding_sha256: current.candidate_binding_sha256,
    database_binding_sha256: current.database_binding_sha256,
    runtime_binding_sha256: current.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: current.recovery_binding_sha256,
    current_checkpoint_source: await source(base.root, UAT_PROMOTION_CURRENT_FILE),
    runtime_identity_source: identitySource,
    snapshot_readiness: snapshotPath,
    snapshot_readiness_file_sha256: (await source(base.root, snapshotPath)).sha256,
    snapshot_readiness_sha256: recovery.readiness_sha256,
    snapshot_readiness_source: await source(base.root, snapshotPath),
    snapshot_policy: clusterPolicyPath,
    snapshot_policy_file_sha256: (await source(base.root, clusterPolicyPath)).sha256,
    snapshot_policy_sha256: readinessPolicySha256(policy),
    snapshot_policy_source: await source(base.root, clusterPolicyPath),
    snapshot_policy_activation: clusterActivationPath,
    snapshot_policy_activation_file_sha256: (await source(base.root, clusterActivationPath)).sha256,
    snapshot_policy_activation_receipt_sha256: activation.receipt_sha256,
    snapshot_policy_activation_source: await source(base.root, clusterActivationPath),
    snapshot_backup_id: recovery.backup_id,
    snapshot_restore_run_id: recovery.restore_run_id,
    snapshot_objects: objects,
    snapshot_created_at: "2026-08-15T01:10:00.000Z",
    snapshot_expires_at: "2026-08-15T01:45:00.000Z",
    requester_identity_sha256: digest("snapshot-requester"),
    approver_identity_sha256: digest("snapshot-approver"),
    executor_identity_sha256: digest("snapshot-executor"),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
  };
  const authorization = digest(`authorization-${snapshotOperationId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: snapshotOperationId,
    operation: "CAPTURE_SNAPSHOT",
    execution_mode: "ORIGINAL",
    execution_authorization_id: snapshotOperationId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.snapshot_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { ...base, context, recovery, snapshotPath };
}

function snapshotRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:35:00.000Z",
    expected_intent_sha256: intentSha256,
  };
}

const snapshotValidators = Object.freeze({ snapshotReadinessValidator: (value) => value });

function quiescedWriter(expected, service) {
  const capture = expected.capture[service];
  return {
    container_name: capture.container_name,
    container_id: capture.container_id,
    service,
    image_digest: capture.image_digest,
    compose_project: expected.parameters.compose_project,
    compose_project_root: expected.parameters.compose_project_root,
    compose_config_hash: digest(`${service}-compose-config`),
    created_at: "2026-08-14T23:00:00.000000000Z",
    last_started_at: "2026-08-15T00:50:00.000000000Z",
    last_finished_at: "2026-08-15T01:18:00.000000000Z",
    restart_count: 0,
    exit_code: 0,
    status: "exited",
    running: false,
    restarting: false,
    paused: false,
    dead: false,
    oom_killed: false,
    oneoff: false,
    container_number: 1,
    application_version: expected.capture.application_version,
    git_commit: expected.capture.git_commit,
  };
}

function quiesceEvidence(expected, variant = "valid") {
  const value = {
    contract: "chenyida-erp-uat-writer-quiesce-evidence/v1",
    status: "CONTINUED_QUIESCE_VERIFIED",
    checked_at: expected.checkedAt,
    snapshot_writer_verified_at: expected.capture.snapshot_writer_verified_at,
    docker_client_identity_sha256: digest("docker-client"),
    docker_daemon_id_sha256: digest("docker-daemon"),
    docker_server_version: "fixture-1.0",
    docker_storage_driver: "overlay2",
    compose_project: expected.parameters.compose_project,
    compose_project_root: expected.parameters.compose_project_root,
    project_container_count: 4,
    project_inventory_sha256: digest("compose-project-inventory"),
    allowed_running_services: ["caddy", "postgres"],
    writer_scope: "EXACT_COMPOSE_PROJECT_AND_WORKING_DIRECTORY_ONLY_EXTERNAL_CLIENTS_DEFERRED_TO_MIGRATION_FENCE",
    web: quiescedWriter(expected, "web"),
    worker: quiescedWriter(expected, "worker"),
  };
  if (variant === "running") value.web.running = true;
  if (variant === "restarted") value.worker.last_finished_at = "2026-08-15T01:21:00.000000000Z";
  if (variant === "replaced") value.web.container_id = "9".repeat(64);
  if (variant === "extra-writer") value.project_container_count = 5;
  return value;
}

async function quiesceFixture({ promotionId = "promotion-quiesce-001", evidenceVariant = "valid", operationId = null } = {}) {
  const base = await snapshotFixture({ promotionId });
  await run(base.context, "prepare", base.root, snapshotValidators);
  await run(base.context, "execute", base.root, snapshotValidators);
  const current = validateUatPromotionCheckpointReceipt(
    JSON.parse(await readFile(physical(base.root, UAT_PROMOTION_CURRENT_FILE), "utf8")),
  );
  const snapshotIntentFile = await intentPath(base.root, base.context.operation_id);
  const snapshotIntent = JSON.parse(await readFile(snapshotIntentFile, "utf8"));
  const identity = JSON.parse(await readFile(physical(base.root, identityPath), "utf8"));
  const quiesceOperationId = operationId ?? `${promotionId}-quiesce`;
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: promotionId,
    promotion_generation: current.promotion_generation,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    promotion_intent_sha256: current.intent_sha256,
    promotion_original_authorization_sha256: current.original_authorization_sha256,
    snapshot_operation_id: base.context.operation_id,
    snapshot_intent_sha256: snapshotIntent.snapshot_intent_sha256,
    snapshot_intent_source: await source(base.root, `${UAT_PROMOTION_STATE_ROOT}/intents/${path.basename(snapshotIntentFile)}`),
    candidate_binding_sha256: current.candidate_binding_sha256,
    database_binding_sha256: current.database_binding_sha256,
    runtime_binding_sha256: current.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: current.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: current.promotion_snapshot_binding_sha256,
    current_checkpoint_source: await source(base.root, UAT_PROMOTION_CURRENT_FILE),
    runtime_identity_source: await source(base.root, identityPath),
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    compose_project: "chenyida-erp",
    compose_project_root: "/opt/erp/chenyida_erp_site",
    web_container: snapshotIntent.writer_capture.web.container_name,
    web_container_id: identity.web_container_id,
    worker_container: snapshotIntent.writer_capture.worker.container_name,
    worker_container_id: identity.worker_container_id,
    quiesce_created_at: "2026-08-15T01:32:00.000Z",
    quiesce_expires_at: "2026-08-15T01:44:00.000Z",
    requester_identity_sha256: digest("quiesce-requester"),
    approver_identity_sha256: digest("quiesce-approver"),
    executor_identity_sha256: digest("quiesce-executor"),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
  };
  const authorization = digest(`authorization-${quiesceOperationId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: quiesceOperationId,
    operation: "QUIESCE_WRITERS",
    execution_mode: "ORIGINAL",
    execution_authorization_id: quiesceOperationId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.quiesce_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  const quiesceValidators = Object.freeze({ writerQuiesceValidator: (expected) => quiesceEvidence(expected, evidenceVariant) });
  return { ...base, context, snapshotIntent, quiesceValidators };
}

function quiesceRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:36:00.000Z",
    expected_intent_sha256: intentSha256,
  };
}

async function migrationAuthorizationFixture({ promotionId = "promotion-migration-authorization-001", operationId = null } = {}) {
  const base = await quiesceFixture({ promotionId });
  await run(base.context, "prepare", base.root, base.quiesceValidators);
  await run(base.context, "execute", base.root, base.quiesceValidators);
  const current = validateUatPromotionCheckpointReceipt(
    JSON.parse(await readFile(physical(base.root, UAT_PROMOTION_CURRENT_FILE), "utf8")),
  );
  const quiesceIntentFile = await intentPath(base.root, base.context.operation_id);
  const quiesceIntent = JSON.parse(await readFile(quiesceIntentFile, "utf8"));
  const identity = JSON.parse(await readFile(physical(base.root, identityPath), "utf8"));
  const authorizationOperationId = operationId ?? `${promotionId}-migration-authorization`;
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: promotionId,
    promotion_generation: current.promotion_generation,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    promotion_intent_sha256: current.intent_sha256,
    promotion_original_authorization_sha256: current.original_authorization_sha256,
    quiesce_operation_id: base.context.operation_id,
    quiesce_intent_sha256: quiesceIntent.quiesce_intent_sha256,
    quiesce_intent_source: await source(
      base.root, `${UAT_PROMOTION_STATE_ROOT}/intents/${path.basename(quiesceIntentFile)}`,
    ),
    candidate_binding_sha256: current.candidate_binding_sha256,
    database_binding_sha256: current.database_binding_sha256,
    runtime_binding_sha256: current.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: current.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: current.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: current.writer_quiesce_binding_sha256,
    current_checkpoint_source: await source(base.root, UAT_PROMOTION_CURRENT_FILE),
    runtime_identity_source: await source(base.root, identityPath),
    release_manifest: manifestPath,
    release_manifest_sha256: (await source(base.root, manifestPath)).sha256,
    release_manifest_source: await source(base.root, manifestPath),
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    database_name: "chenyida_erp",
    database_oid: databaseOid,
    database_system_identifier: databaseSystemIdentifier,
    database_marker: databaseMarker,
    expected_current_migration_head: identity.migration_head,
    target_migration_head: migrations().at(-1).filename,
    migration_manifest_sha256: migrationAllowlistDigest(migrations()),
    migration_role: "chenyida_erp_owner",
    authorization_created_at: "2026-08-15T01:37:00.000Z",
    authorization_expires_at: "2026-08-15T01:43:00.000Z",
    requester_identity_sha256: digest("migration-authorization-requester"),
    approver_identity_sha256: digest("migration-authorization-approver"),
    executor_identity_sha256: digest("migration-authorization-executor"),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
  };
  const authorization = digest(`authorization-${authorizationOperationId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: authorizationOperationId,
    operation: "MIGRATION_AUTHORIZATION",
    execution_mode: "ORIGINAL",
    execution_authorization_id: authorizationOperationId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.authorization_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { ...base, context, quiesceIntent };
}

function migrationAuthorizationRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:40:00.000Z",
    expected_intent_sha256: intentSha256,
  };
}

async function migrationExecutionFixture({ promotionId = "promotion-migration-execution-001", operationId = null } = {}) {
  const base = await migrationAuthorizationFixture({ promotionId });
  await run(base.context, "prepare", base.root);
  await run(base.context, "execute", base.root);
  const current = validateUatPromotionCheckpointReceipt(
    JSON.parse(await readFile(physical(base.root, UAT_PROMOTION_CURRENT_FILE), "utf8")),
  );
  const approvalIntentFile = await intentPath(base.root, base.context.operation_id);
  const approvalIntent = JSON.parse(await readFile(approvalIntentFile, "utf8"));
  const identity = JSON.parse(await readFile(physical(base.root, identityPath), "utf8"));
  const executionOperationId = operationId ?? `${promotionId}-migration-execution`;
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: promotionId,
    promotion_generation: current.promotion_generation,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    promotion_intent_sha256: current.intent_sha256,
    promotion_original_authorization_sha256: current.original_authorization_sha256,
    migration_authorization_operation_id: base.context.operation_id,
    migration_authorization_intent_sha256: approvalIntent.migration_authorization_intent_sha256,
    migration_authorization_intent_source: await source(
      base.root, `${UAT_PROMOTION_STATE_ROOT}/intents/${path.basename(approvalIntentFile)}`,
    ),
    migration_approval_authorization_sha256: base.context.original_authorization_sha256,
    candidate_binding_sha256: current.candidate_binding_sha256,
    database_binding_sha256: current.database_binding_sha256,
    runtime_binding_sha256: current.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: current.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: current.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: current.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: current.migration_authorization_binding_sha256,
    current_checkpoint_source: await source(base.root, UAT_PROMOTION_CURRENT_FILE),
    runtime_identity_source: await source(base.root, identityPath),
    release_manifest: manifestPath,
    release_manifest_sha256: (await source(base.root, manifestPath)).sha256,
    release_manifest_source: await source(base.root, manifestPath),
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    database_name: "chenyida_erp",
    database_oid: databaseOid,
    database_system_identifier: databaseSystemIdentifier,
    database_marker: databaseMarker,
    expected_current_migration_head: identity.migration_head,
    target_migration_head: migrations().at(-1).filename,
    migration_manifest_sha256: migrationAllowlistDigest(migrations()),
    migration_role: "chenyida_erp_owner",
    control_role: "postgres",
    worker_image: workerImage,
    postgres_container: "chenyida-erp-postgres-1",
    postgres_container_id: identity.postgres_container_id,
    postgres_image_digest: identity.postgres_image_digest,
    backend_network: "chenyida-erp_backend",
    execution_created_at: "2026-08-15T01:40:00.000Z",
    execution_expires_at: "2026-08-15T01:42:00.000Z",
    requester_identity_sha256: digest("migration-execution-requester"),
    approver_identity_sha256: digest("migration-execution-approver"),
    executor_identity_sha256: digest("migration-execution-executor"),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
  };
  const authorization = digest(`authorization-${executionOperationId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: executionOperationId,
    operation: "MIGRATION_EXECUTION",
    execution_mode: "ORIGINAL",
    execution_authorization_id: executionOperationId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.execution_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { ...base, context, approvalIntent };
}

function migrationExecutionRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:41:30.000Z",
    expected_intent_sha256: intentSha256,
  };
}

async function writeMigrationExecutionResult(root, context) {
  const grantDirectory = physical(root, `${UAT_PROMOTION_STATE_ROOT}/grants`);
  const [grantName] = (await readdir(grantDirectory)).filter((name) => artifactMatches(name, context.operation_id));
  const grant = JSON.parse(await readFile(path.join(grantDirectory, grantName), "utf8"));
  const entries = migrations();
  const fileResults = entries.map((entry) => ({
    filename: entry.filename,
    sha256: entry.sha256,
    outcome: entry.filename <= grant.expected_current_head ? "ALREADY_APPLIED" : "APPLIED",
  }));
  const engineResult = createUatPromotionMigrationEngineResult({
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    grant_sha256: grant.grant_sha256,
    database_name: grant.database.database_name,
    database_system_identifier: grant.database.database_system_identifier,
    database_oid: grant.database.database_oid,
    database_marker: grant.database.database_marker,
    migration_role: grant.database.migration_role,
    application_name: "chenyida-erp-migration",
    current_head_before: grant.expected_current_head,
    target_head: grant.target_head,
    started_at: "2026-08-15T01:40:20.000Z",
    completed_at: "2026-08-15T01:41:00.000Z",
    files: fileResults,
    final_migration_rows_sha256: clusterSha256(entries.map((entry) => ({
      version: entry.filename, checksum: entry.sha256,
    }))),
    final_migration_rows_count: entries.length,
    other_backend_count_before: 0,
    other_backend_count_after: 0,
    database_default_transaction_read_only: "on",
    migration_transaction_read_only: "off",
  });
  const fence = (phase, observedAt) => createUatPromotionMigrationFence({
    phase,
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    database_name: grant.database.database_name,
    database_system_identifier: grant.database.database_system_identifier,
    database_oid: grant.database.database_oid,
    database_marker: grant.database.database_marker,
    control_role: grant.database.control_role,
    control_superuser: true,
    database_allow_connections: phase === "BEFORE",
    default_transaction_read_only: "on",
    database_setting_count: 1,
    database_connection_limit: phase === "BEFORE" ? 1 : 0,
    other_backend_count: 0,
    managed_roles: [
      "chenyida_erp_admin", "chenyida_erp_admin_priv", "chenyida_erp_backup", "chenyida_erp_backup_priv",
      "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_web_priv", "chenyida_erp_worker",
      "chenyida_erp_worker_priv",
    ],
    login_roles: [
      "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_worker",
    ],
    connect_roles: ["chenyida_erp_owner"],
    platform_superuser_roles: ["postgres"],
    public_connect: false,
    public_temporary: false,
    unknown_connect_acl_count: 0,
    unknown_connect_login_count: 0,
    prepared_transaction_count: 0,
    role_records: UAT_PROMOTION_MIGRATION_ROLE_RECORDS,
    memberships: UAT_PROMOTION_MIGRATION_MEMBERSHIPS,
    non_owner_database_acl: [],
    database_owner_privileges: UAT_PROMOTION_MIGRATION_DATABASE_OWNER_PRIVILEGES,
    observed_at: observedAt,
  });
  const result = createUatPromotionMigrationResult({
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    grant_sha256: grant.grant_sha256,
    migration_approval_receipt_sha256: grant.migration_approval_receipt_sha256,
    migration_authorization_binding_sha256: grant.migration_authorization_binding_sha256,
    fence_before: fence("BEFORE", "2026-08-15T01:40:10.000Z"),
    engine_result: engineResult,
    fence_after: fence("AFTER", "2026-08-15T01:41:10.000Z"),
    committed_at: "2026-08-15T01:41:11.000Z",
  });
  const resultDirectory = physical(root, `${UAT_PROMOTION_STATE_ROOT}/results`);
  const resultFile = path.join(resultDirectory, `${context.operation_id}.${result.result_sha256}.json`);
  await writeFile(resultFile, canonicalMigrationExecutionJson(result), { mode: 0o400, flag: "wx" });
  await chmod(resultFile, 0o400);
  return { grant, result, resultFile };
}

async function composeDeploymentFixture({
  promotionId = "promotion-compose-deployment-001", operationId = null,
} = {}) {
  const migration = await migrationExecutionFixture({
    promotionId, operationId: `${promotionId}-migration-execution`,
  });
  const migrationPrepared = await run(migration.context, "prepare", migration.root);
  const { grant, result: migrationResult, resultFile } = await writeMigrationExecutionResult(
    migration.root, migration.context,
  );
  const activeBody = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-active-migration-fence/v1",
    status: "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION",
    promotion_id: promotionId,
    migration_operation_id: migration.context.operation_id,
    execution_authorization_sha256: migration.context.execution_authorization_sha256,
    grant_sha256: grant.grant_sha256,
    database_name: "chenyida_erp",
    database_system_identifier: databaseSystemIdentifier,
    database_oid: databaseOid,
    database_marker: databaseMarker,
    released_baseline_sha256: digest(`released-baseline-${promotionId}`),
    fence_before_sha256: migrationResult.fence_before.fence_sha256,
    activated_at: migrationResult.fence_before.observed_at,
  };
  const activeFence = { ...activeBody, active_fence_sha256: clusterSha256(activeBody) };
  const activeFenceLogical = `${UAT_PROMOTION_STATE_ROOT}/active-fences/${migration.context.operation_id}.${activeFence.active_fence_sha256}.json`;
  await canonicalFile(migration.root, activeFenceLogical, activeFence, 0o400);
  await run(migration.context, "execute", migration.root);

  const composeProjectRoot = "/srv/chenyida-erp";
  await directory(migration.root, "/srv", 0o755);
  await directory(migration.root, composeProjectRoot, 0o755);
  await rawFile(migration.root, `${composeProjectRoot}/compose.yml`, composeRaw, 0o444);
  await rawFile(migration.root, `${composeProjectRoot}/compose.release.yml`, releaseComposeRaw, 0o444);
  const deploymentEnvironment = "/etc/chenyida-erp/uat-deployment.env";
  await directory(migration.root, "/etc", 0o755);
  await directory(migration.root, "/etc/chenyida-erp", 0o700);
  await rawFile(migration.root, deploymentEnvironment, deploymentEnvironmentRaw, 0o400);
  const identity = releaseIdentity(migrationAllowlistDigest(migrations()));
  const migrationIntentLogical = `${UAT_PROMOTION_STATE_ROOT}/intents/${migration.context.operation_id}.${migrationPrepared.intent_sha256}.json`;
  const deploymentOperationId = operationId || `${promotionId}-compose-deployment`;
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: promotionId,
    promotion_generation: 1,
    previous_checkpoint_receipt_sha256: JSON.parse(await readFile(
      physical(migration.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
    )).receipt_sha256,
    promotion_intent_sha256: migration.context.parameters.promotion_intent_sha256,
    promotion_original_authorization_sha256: migration.context.parameters.promotion_original_authorization_sha256,
    migration_operation_id: migration.context.operation_id,
    migration_execution_intent_sha256: migrationPrepared.intent_sha256,
    migration_execution_intent_source: await source(migration.root, migrationIntentLogical),
    migration_execution_authorization_sha256: migration.context.execution_authorization_sha256,
    migration_grant_sha256: grant.grant_sha256,
    migration_result_sha256: migrationResult.result_sha256,
    migration_result_source: await source(
      migration.root, `${UAT_PROMOTION_STATE_ROOT}/results/${path.basename(resultFile)}`,
    ),
    active_migration_fence_sha256: activeFence.active_fence_sha256,
    active_migration_fence_source: await source(migration.root, activeFenceLogical),
    candidate_binding_sha256: migration.context.parameters.candidate_binding_sha256,
    database_binding_sha256: migration.context.parameters.database_binding_sha256,
    runtime_binding_sha256: migration.context.parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: migration.context.parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: migration.context.parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: migration.context.parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: migration.context.parameters.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: migrationResult.database_fence_binding_sha256,
    migration_result_binding_sha256: migrationResult.migration_result_binding_sha256,
    current_checkpoint_source: await source(migration.root, UAT_PROMOTION_CURRENT_FILE),
    runtime_identity_source: await source(migration.root, identityPath),
    release_manifest: manifestPath,
    release_manifest_sha256: (await source(migration.root, manifestPath)).sha256,
    release_manifest_source: await source(migration.root, manifestPath),
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    compose_project: "chenyida-erp",
    compose_project_root: composeProjectRoot,
    compose_file_source: await source(migration.root, `${composeProjectRoot}/compose.yml`),
    compose_release_file_source: await source(migration.root, `${composeProjectRoot}/compose.release.yml`),
    deployment_environment: deploymentEnvironment,
    deployment_environment_sha256: (await source(migration.root, deploymentEnvironment)).sha256,
    deployment_environment_source: await source(migration.root, deploymentEnvironment),
    web_image: webImage,
    worker_image: workerImage,
    web_container: "chenyida-erp-web-1",
    old_web_container_id: identity.web_container_id,
    old_web_image_digest: identity.web_image_digest,
    worker_container: "chenyida-erp-worker-1",
    old_worker_container_id: identity.worker_container_id,
    old_worker_image_digest: identity.worker_image_digest,
    postgres_container: "chenyida-erp-postgres-1",
    postgres_container_id: identity.postgres_container_id,
    postgres_image_digest: identity.postgres_image_digest,
    caddy_container: "chenyida-erp-caddy-1",
    caddy_container_id: identity.caddy_container_id,
    caddy_image_digest: identity.caddy_image_digest,
    backend_network: "chenyida-erp_backend",
    edge_network: "chenyida-erp_edge",
    reader_gid: 1000,
    database_name: "chenyida_erp",
    database_oid: databaseOid,
    database_system_identifier: databaseSystemIdentifier,
    database_marker: databaseMarker,
    control_role: "postgres",
    deployment_created_at: "2026-08-15T01:41:20.000Z",
    deployment_expires_at: "2026-08-15T01:44:00.000Z",
    requester_identity_sha256: digest(`deployment-requester-${promotionId}`),
    approver_identity_sha256: digest(`deployment-approver-${promotionId}`),
    executor_identity_sha256: digest(`deployment-executor-${promotionId}`),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
  };
  const authorization = digest(`authorization-${deploymentOperationId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: deploymentOperationId,
    operation: "COMPOSE_DEPLOYMENT",
    execution_mode: "ORIGINAL",
    execution_authorization_id: deploymentOperationId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.deployment_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { ...migration, context, activeFence, migrationResult };
}

function composeDeploymentRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:43:30.000Z",
    expected_intent_sha256: intentSha256,
  };
}

async function writeComposeDeploymentCompletion(root, context, intent) {
  const handoff = createUatPromotionDatabaseHandoff({
    promotion_id: context.parameters.promotion_id,
    deployment_operation_id: context.operation_id,
    database_name: context.parameters.database_name,
    database_system_identifier: context.parameters.database_system_identifier,
    database_oid: context.parameters.database_oid,
    database_marker: context.parameters.database_marker,
    active_fence_sha256: context.parameters.active_migration_fence_sha256,
    released_baseline_sha256: intent.released_baseline_sha256,
    sealed_probe_sha256: intent.sealed_database_fence_sha256,
    runtime_probe_sha256: digest("runtime-probe"),
    database_allow_connections: true,
    database_connection_limit: 64,
    default_transaction_read_only: "RESET",
    connect_roles: [
      "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web",
      "chenyida_erp_worker",
    ],
    unknown_connect_login_count: 0,
    prepared_transaction_count: 0,
    handed_off_at: "2026-08-15T01:41:30.000Z",
  });
  const service = (name, id, imageId, imageReference) => ({
    service: name, container_id: id, container_name: `chenyida-erp-${name}-1`, image_id: imageId,
    image_reference: imageReference, compose_config_sha256: digest(`${name}-compose-config`),
    running: true, health: "healthy", restart_count: 0, oom_killed: false,
  });
  const unchanged = (name, id, imageId, imageReference, health) => {
    const identitySha256 = digest(`${name}-stable-runtime`);
    return {
      service: name, container_id: id, container_name: `chenyida-erp-${name}-1`, image_id: imageId,
      image_reference: imageReference, compose_config_sha256: digest(`${name}-compose-config`),
      pre_identity_sha256: identitySha256, post_identity_sha256: identitySha256,
      restart_count: 0, oom_killed: false, running: true, health,
    };
  };
  const protectedSha256 = digest("protected-runtime");
  const result = createUatPromotionComposeDeploymentResult({
    promotion_id: intent.promotion_id,
    deployment_operation_id: intent.deployment_operation_id,
    execution_authorization_sha256: intent.execution_authorization_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    release_manifest_sha256: context.parameters.release_manifest_sha256,
    migration_operation_id: intent.migration_operation_id,
    migration_execution_authorization_sha256: intent.migration_execution_authorization_sha256,
    migration_grant_sha256: intent.migration_grant_sha256,
    migration_result_sha256: intent.migration_result_sha256,
    active_fence_sha256: intent.active_migration_fence_sha256,
    migration_fence_binding_sha256: intent.migration_fence_binding_sha256,
    migration_result_binding_sha256: intent.migration_result_binding_sha256,
    deployment_plan_sha256: intent.deployment_plan_sha256,
    compose_project: context.parameters.compose_project,
    compose_project_root: context.parameters.compose_project_root,
    old_runtime_sha256: digest("old-runtime"),
    created_runtime_sha256: digest("created-runtime"),
    committed_runtime_sha256: digest("committed-runtime"),
    protected_resources_before_sha256: protectedSha256,
    protected_resources_after_sha256: protectedSha256,
    runtime_configuration_sha256: digest("runtime-configuration"),
    readiness_sha256: digest("readiness"),
    database_handoff: handoff,
    services: [
      service("web", "5".repeat(64), `sha256:${"c".repeat(64)}`, webImage),
      service("worker", "6".repeat(64), `sha256:${"d".repeat(64)}`, workerImage),
    ],
    unchanged_services: [
      unchanged("caddy", "1".repeat(64), `sha256:${"1".repeat(64)}`,
        `docker.io/library/caddy@sha256:${"1".repeat(64)}`, "none"),
      unchanged("postgres", "2".repeat(64), `sha256:${"2".repeat(64)}`,
        `docker.io/library/postgres@sha256:${"2".repeat(64)}`, "healthy"),
    ],
    started_at: "2026-08-15T01:41:21.000Z",
    completed_at: "2026-08-15T01:42:00.000Z",
  });
  const transfer = createUatPromotionActiveFenceTransfer({
    promotion_id: intent.promotion_id,
    migration_operation_id: intent.migration_operation_id,
    deployment_operation_id: intent.deployment_operation_id,
    migration_execution_authorization_sha256: intent.migration_execution_authorization_sha256,
    deployment_authorization_sha256: intent.execution_authorization_sha256,
    active_fence_sha256: intent.active_migration_fence_sha256,
    migration_result_sha256: intent.migration_result_sha256,
    deployment_result_sha256: result.result_sha256,
    database_handoff_sha256: handoff.handoff_sha256,
    runtime_configuration_sha256: result.runtime_configuration_sha256,
    transferred_at: "2026-08-15T01:42:01.000Z",
  });
  await canonicalFile(
    root, `${UAT_PROMOTION_STATE_ROOT}/results/${context.operation_id}.${result.result_sha256}.json`, result, 0o400,
  );
  await canonicalFile(
    root, `${UAT_PROMOTION_STATE_ROOT}/fence-transfers/${context.operation_id}.${transfer.transfer_sha256}.json`, transfer, 0o400,
  );
  return { result, transfer };
}

function postdeployServices(deploymentResult) {
  const services = new Map([
    ...deploymentResult.services.map((item) => [item.service, item]),
    ...deploymentResult.unchanged_services.map((item) => [item.service, item]),
  ]);
  return ["caddy", "postgres", "web", "worker"].map((name) => {
    const item = services.get(name);
    return {
      service: name,
      container_id: item.container_id,
      image_id: item.image_id,
      image_reference: item.image_reference,
      restart_count: item.restart_count,
      oom_killed: item.oom_killed,
      running: item.running,
      restarting: false,
      paused: false,
      dead: false,
      status: "running",
      health: item.health,
      healthcheck_present: name !== "caddy",
    };
  });
}

function postdeployCommonParameters(current, composeContext, completion, root) {
  const deploymentResultLogical = `${UAT_PROMOTION_STATE_ROOT}/results/${composeContext.operation_id}.${completion.result.result_sha256}.json`;
  const fenceTransferLogical = `${UAT_PROMOTION_STATE_ROOT}/fence-transfers/${composeContext.operation_id}.${completion.transfer.transfer_sha256}.json`;
  return {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: current.promotion_id,
    promotion_generation: current.promotion_generation,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    promotion_intent_sha256: current.intent_sha256,
    promotion_original_authorization_sha256: current.original_authorization_sha256,
    candidate_binding_sha256: current.candidate_binding_sha256,
    database_binding_sha256: current.database_binding_sha256,
    runtime_binding_sha256: current.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: current.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: current.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: current.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: current.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: current.migration_fence_binding_sha256,
    migration_result_binding_sha256: current.migration_result_binding_sha256,
    compose_deployment_binding_sha256: current.compose_deployment_binding_sha256,
    current_checkpoint_source: null,
    deployment_operation_id: composeContext.operation_id,
    deployment_result_sha256: completion.result.result_sha256,
    deployment_result_source: null,
    fence_transfer_sha256: completion.transfer.transfer_sha256,
    fence_transfer_source: null,
    release_manifest: composeContext.parameters.release_manifest,
    release_manifest_sha256: composeContext.parameters.release_manifest_sha256,
    release_manifest_source: null,
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    compose_project: "chenyida-erp",
    compose_project_root: composeContext.parameters.compose_project_root,
    runtime_guard_contract: "chenyida-erp-release-runtime-guard/v1",
    runtime_guard_mode: POST_DEPLOY_RUNTIME_GUARD_MODE,
    runtime_policy_sha256: RELEASE_RUNTIME_POLICY_SHA256,
    reader_gid: 1000,
    caddy_container: "chenyida-erp-caddy-1",
    postgres_container: "chenyida-erp-postgres-1",
    web_container: "chenyida-erp-web-1",
    worker_container: "chenyida-erp-worker-1",
    requester_identity_sha256: digest(`postdeploy-requester-${current.promotion_id}`),
    approver_identity_sha256: digest(`postdeploy-approver-${current.promotion_id}`),
    executor_identity_sha256: digest(`postdeploy-executor-${current.promotion_id}`),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
    _sources: { root, deploymentResultLogical, fenceTransferLogical },
  };
}

async function bindPostdeployCommonSources(parameters) {
  const { root, deploymentResultLogical, fenceTransferLogical } = parameters._sources;
  const value = { ...parameters };
  delete value._sources;
  value.current_checkpoint_source = await source(root, UAT_PROMOTION_CURRENT_FILE);
  value.deployment_result_source = await source(root, deploymentResultLogical);
  value.fence_transfer_source = await source(root, fenceTransferLogical);
  value.release_manifest_source = await source(root, value.release_manifest);
  return value;
}

async function postdeployRuntimeFixture({
  promotionId = "promotion-postdeploy-runtime-001", operationId = null,
} = {}) {
  const deployment = await composeDeploymentFixture({ promotionId });
  await run(deployment.context, "prepare", deployment.root);
  const deploymentIntent = JSON.parse(await readFile(await intentPath(
    deployment.root, deployment.context.operation_id,
  ), "utf8"));
  const completion = await writeComposeDeploymentCompletion(
    deployment.root, deployment.context, deploymentIntent,
  );
  await run(deployment.context, "execute", deployment.root);
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(deployment.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  const probeId = operationId ?? `${promotionId}-runtime-probe`;
  const parameters = await bindPostdeployCommonSources({
    ...postdeployCommonParameters(current, deployment.context, completion, deployment.root),
    verification_created_at: "2026-08-15T01:42:10.000Z",
    verification_expires_at: "2026-08-15T01:46:00.000Z",
    probe_root: "/var/lib/chenyida-erp/runtime-probes",
    probe_id: probeId,
  });
  const authorization = digest(`authorization-${probeId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: probeId,
    operation: "POSTDEPLOY_RUNTIME_CONFIGURATION",
    execution_mode: "ORIGINAL",
    execution_authorization_id: probeId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.verification_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { ...deployment, context, composeContext: deployment.context, completion };
}

async function writeRuntimeProbe(root, context, completion, mutate = (value) => value) {
  await directory(root, context.parameters.probe_root, 0o700);
  await rawFile(
    root, `${context.parameters.probe_root}/.chenyida-erp-runtime-probe-root-v1`,
    "chenyida-erp-runtime-probe-root/v1\n", 0o400,
  );
  const release = JSON.parse(await readFile(physical(root, context.parameters.release_manifest), "utf8"));
  const receipt = mutate(createRuntimeConfigurationProbeReceipt({
    probeId: context.parameters.probe_id,
    probedAt: "2026-08-15T01:42:30.000Z",
    deploymentClass: "UAT",
    deploymentId: context.parameters.deployment_id,
    composeProject: context.parameters.compose_project,
    composeProjectRoot: context.parameters.compose_project_root,
    manifest: release,
    manifestSha256: context.parameters.release_manifest_sha256,
    runtimeGuardContract: context.parameters.runtime_guard_contract,
    runtimeGuardMode: context.parameters.runtime_guard_mode,
    runtimePolicySha256: context.parameters.runtime_policy_sha256,
    selectors: {
      caddy: context.parameters.caddy_container,
      postgres: context.parameters.postgres_container,
      web: context.parameters.web_container,
      worker: context.parameters.worker_container,
    },
    runtime: {
      services: postdeployServices(completion.result),
      runtime_configuration_sha256: completion.result.runtime_configuration_sha256,
    },
    control: {
      supervisor_bundle_sha256: context.supervisor_bundle_sha256,
      authorization_sha256: context.original_authorization_sha256,
    },
  }));
  const logical = `${context.parameters.probe_root}/${context.parameters.probe_id}.runtime-configuration-probe.json`;
  await rawFile(root, logical, canonicalRuntimeConfigurationProbeJson(receipt), 0o400);
  return { receipt, logical };
}

async function postdeployIdentityFixture({ promotionId = "promotion-postdeploy-identity-001" } = {}) {
  const runtime = await postdeployRuntimeFixture({ promotionId });
  const runtimePrepared = await run(runtime.context, "prepare", runtime.root);
  const runtimeProbe = await writeRuntimeProbe(runtime.root, runtime.context, runtime.completion);
  await run(runtime.context, "execute", runtime.root, { now: new Date("2026-08-15T01:42:31.000Z") });
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(runtime.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  const runId = `${promotionId}-identity`;
  const runtimeIntentLogical = `${UAT_PROMOTION_STATE_ROOT}/intents/${runtime.context.operation_id}.${runtimePrepared.intent_sha256}.json`;
  const runtimeResultLogical = `${UAT_PROMOTION_STATE_ROOT}/results/${runtime.context.operation_id}.${current.checkpoint_evidence_sha256}.json`;
  const parameters = await bindPostdeployCommonSources({
    ...postdeployCommonParameters(current, runtime.composeContext, runtime.completion, runtime.root),
    verification_created_at: "2026-08-15T01:43:00.000Z",
    verification_expires_at: "2026-08-15T01:48:00.000Z",
    runtime_probe_operation_id: runtime.context.operation_id,
    runtime_probe_intent_sha256: runtimePrepared.intent_sha256,
    runtime_probe_intent_source: await source(runtime.root, runtimeIntentLogical),
    runtime_probe_result_sha256: current.checkpoint_evidence_sha256,
    runtime_probe_result_source: await source(runtime.root, runtimeResultLogical),
    runtime_probe_receipt: runtimeProbe.logical,
    runtime_probe_receipt_sha256: (await source(runtime.root, runtimeProbe.logical)).sha256,
    runtime_probe_receipt_source: await source(runtime.root, runtimeProbe.logical),
    runtime_configuration_sha256: runtimeProbe.receipt.runtime_configuration_sha256,
    postdeploy_root: `/var/lib/chenyida-erp/postdeploy/${runId}`,
    identity_root: "/var/lib/chenyida-erp/release-identity",
    run_id: runId,
  });
  const authorization = digest(`authorization-${runId}`);
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: runId,
    operation: "POSTDEPLOY_IDENTITY",
    execution_mode: "ORIGINAL",
    execution_authorization_id: runId,
    execution_authorization_sha256: authorization,
    execution_created_at: parameters.verification_created_at,
    original_authorization_sha256: authorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return {
    ...runtime, context, runtimeContext: runtime.context, runtimePrepared,
    runtimeProbe: runtimeProbe.receipt,
  };
}

async function writePostdeployIdentityEvidence(root, context, runtimeProbe, mutateReceipt = (value) => value) {
  const release = JSON.parse(await readFile(physical(root, context.parameters.release_manifest), "utf8"));
  const readiness = {
    deployment_class: "UAT",
    deployment_id: "chenyida-erp",
    version: release.source.package_version,
    revision: release.source.git_commit.slice(0, 12),
    migration_head: release.migrations.head,
    migration_manifest_sha256: release.migrations.allowlist_sha256,
    database_time: "2026-08-15T01:43:30.000Z",
    components: {
      postgresql: "READY", migration: "READY", worker: "READY",
      uploads: "READY", attachments: "READY", runtime: "READY",
    },
  };
  const receipt = mutateReceipt(buildPostDeployReceipt({
    runId: context.parameters.run_id,
    generatedAt: readiness.database_time,
    deploymentClass: "UAT",
    deploymentId: "chenyida-erp",
    composeProject: "chenyida-erp",
    manifest: release,
    manifestSha256: context.parameters.release_manifest_sha256,
    supervisorBundleSha256: context.supervisor_bundle_sha256,
    authorizationSha256: context.original_authorization_sha256,
    runtimePolicySha256: context.parameters.runtime_policy_sha256,
    runtimeConfigurationSha256: context.parameters.runtime_configuration_sha256,
    services: runtimeProbe.services,
    readiness,
  }));
  await directory(root, "/var/lib/chenyida-erp/postdeploy", 0o755);
  await directory(root, context.parameters.postdeploy_root, 0o750);
  await rawFile(
    root, `${context.parameters.postdeploy_root}/.chenyida-erp-release-artifact-root-v1`,
    "chenyida-erp-release-artifact-root/v1\n", 0o440,
  );
  const receiptLogical = `${context.parameters.postdeploy_root}/${context.parameters.run_id}.postdeploy-receipt.json`;
  await rawFile(root, receiptLogical, releaseCanonicalJson(receipt), 0o440);
  const receiptSha256 = (await source(root, receiptLogical)).sha256;
  const identity = buildReleaseIdentityFromPostDeployReceipt({ receipt, receiptSha256 });
  await rawFile(root, identityPath, releaseCanonicalJson(identity), 0o440);
  for (const logical of [
    "/var/lib/chenyida-erp/release-identity",
    "/var/lib/chenyida-erp/release-identity/.chenyida-erp-release-identity-root-v1",
    identityPath,
  ]) await chown(physical(root, logical), 0, context.parameters.reader_gid);
  return { receipt, identity, receiptLogical };
}

function postdeployRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`authorization-${executionId}`),
    execution_created_at: "2026-08-15T01:44:00.000Z",
    expected_intent_sha256: intentSha256,
  };
}

async function postdeployExpectedResultSha256(context, root) {
  const logical = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? `${context.parameters.probe_root}/${context.parameters.probe_id}.runtime-configuration-probe.json`
    : `${context.parameters.postdeploy_root}/${context.parameters.run_id}.postdeploy-receipt.json`;
  return (await source(root, logical)).sha256;
}

const crossRoleInstant = (second) => new Date(
  Date.parse("2026-08-15T01:44:00.000Z") + second * 1000,
).toISOString();

function crossRoleActors() {
  return Object.entries(crossRoleTemplate.actor_slots)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slot, actor]) => ({
      slot,
      role: actor.role,
      person_identity_sha256: digest(`cross-role-person:${slot}`),
      account_identity_sha256: digest(`cross-role-account:${slot}`),
    }));
}

function crossRoleActor(actors, slot) {
  return actors.find((actor) => actor.slot === slot);
}

function crossRoleSignoff(slot, actor, signedAt, result = "PASS", timeField = "signed_at") {
  return {
    actor_slot: slot,
    person_identity_sha256: actor.person_identity_sha256,
    account_identity_sha256: actor.account_identity_sha256,
    [timeField]: signedAt,
    evidence_sha256: digest(`cross-role-signoff:${slot}:${signedAt}`),
    result,
  };
}

function crossRoleWorkflowEvidence(actors) {
  let cursor = 5;
  let first = null;
  let executionCompleted = null;
  let signoffCompleted = null;
  const workflows = crossRoleTemplate.workflows.map((workflow) => {
    const steps = workflow.steps.map((step) => {
      const startedAt = crossRoleInstant(cursor);
      const completedAt = crossRoleInstant(cursor + 1);
      cursor += 2;
      first ??= startedAt;
      const requestId = `UAT77:${workflow.id}:${step.id}:REQUEST`;
      return {
        step_id: step.id,
        actor_slot: step.actor_slot,
        operation_id: step.operation_id,
        expected_contract_sha256: digest(crossRoleCanonicalJson(step)),
        started_at: startedAt,
        completed_at: completedAt,
        request: {
          request_id: requestId,
          metadata_evidence_sha256: digest(`cross-role-request-metadata:${workflow.id}:${step.id}`),
          body_digest_sha256: digest(`cross-role-request-body:${workflow.id}:${step.id}`),
          origin_check: "APPROVED",
          content_type_check: "APPLICATION_JSON",
          csrf_check: "PRESENT_AND_ACCEPTED",
          idempotency_key_digest_sha256: digest(`cross-role-idempotency-key:${workflow.id}:${step.id}`),
        },
        response: {
          http_status: step.expected_status,
          header_request_id: requestId,
          body_request_id: requestId,
          body_digest_sha256: digest(`cross-role-response-body:${workflow.id}:${step.id}`),
          evidence_sha256: digest(`cross-role-response-evidence:${workflow.id}:${step.id}`),
        },
        database: {
          expected_delta_contract_sha256: digest(crossRoleCanonicalJson(step.expected_db_delta)),
          observed_delta_sha256: digest(`cross-role-database:${workflow.id}:${step.id}`),
          matches_expected: true,
          half_record_count: 0,
        },
        audit: {
          request_id: requestId,
          evidence_sha256: digest(`cross-role-audit:${workflow.id}:${step.id}`),
          transactionally_committed: true,
        },
        idempotency: {
          request_digest_sha256: digest(`cross-role-idempotency-request:${workflow.id}:${step.id}`),
          result_digest_sha256: digest(`cross-role-idempotency-result:${workflow.id}:${step.id}`),
          state: "ORIGINAL_COMMITTED",
        },
        result: "PASS",
      };
    });
    const controls = workflow.controls.map((control) => {
      const observedAt = crossRoleInstant(cursor++);
      executionCompleted = observedAt;
      return {
        kind: control.kind,
        target_step: control.target_step,
        expected_contract_sha256: digest(crossRoleCanonicalJson(control)),
        observed_at: observedAt,
        observation: structuredClone(uatPromotionCrossRoleControlObservations[control.kind]),
        evidence_sha256: digest(`cross-role-control:${workflow.id}:${control.kind}`),
        result: "PASS",
      };
    });
    const reversals = workflow.steps
      .filter((step) => step.branch_from_checkpoint !== undefined)
      .map((step) => {
        const recordedAt = crossRoleInstant(cursor++);
        executionCompleted = recordedAt;
        return {
          step_id: step.id,
          branch_from_checkpoint: step.branch_from_checkpoint,
          mode: "APPEND_ONLY_REVERSAL",
          original_fact_preserved: true,
          recorded_at: recordedAt,
          source_fact_sha256: digest(`cross-role-source-fact:${workflow.id}:${step.id}`),
          reversal_fact_sha256: digest(`cross-role-reversal-fact:${workflow.id}:${step.id}`),
          ledger_delta_sha256: digest(`cross-role-reversal-ledger:${workflow.id}:${step.id}`),
          audit_evidence_sha256: digest(`cross-role-reversal-audit:${workflow.id}:${step.id}`),
          result: "PASS",
          evidence_sha256: digest(`cross-role-reversal:${workflow.id}:${step.id}`),
        };
      });
    return {
      workflow_id: workflow.id,
      status: "PASS",
      steps,
      controls,
      reversals,
    };
  });
  for (const [index, workflowEvidence] of workflows.entries()) {
    const workflow = crossRoleTemplate.workflows[index];
    const signoffStart = cursor;
    const executorSignoffs = workflow.signoff.executor_slots.map((slot, index) => crossRoleSignoff(
      slot, crossRoleActor(actors, slot), crossRoleInstant(signoffStart + index),
    ));
    const observerSecond = signoffStart + executorSignoffs.length;
    const businessSecond = observerSecond + 1;
    cursor = businessSecond + 2;
    signoffCompleted = crossRoleInstant(businessSecond);
    workflowEvidence.signoff = {
      executor_signoffs: executorSignoffs,
      observer_signoff: crossRoleSignoff(
        workflow.signoff.observer_slot,
        crossRoleActor(actors, workflow.signoff.observer_slot),
        crossRoleInstant(observerSecond),
      ),
      business_acceptance: crossRoleSignoff(
        workflow.signoff.business_acceptor_slot,
        crossRoleActor(actors, workflow.signoff.business_acceptor_slot),
        crossRoleInstant(businessSecond), "ACCEPTED", "accepted_at",
      ),
    };
  }
  return { workflows, first, executionCompleted, signoffCompleted };
}

function createCrossRoleFixtureResult({
  current, resultId, promotionId, humanAuthorizationSha256, releaseIdentitySha256,
}) {
  const actors = crossRoleActors();
  const evidence = crossRoleWorkflowEvidence(actors);
  return createUatPromotionCrossRoleResult({
    schema_version: 1,
    contract: UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT,
    status: "PASS",
    evidence_class: "HUMAN_EXECUTED_UAT",
    result_id: resultId,
    promotion_id: promotionId,
    promotion_generation: current.promotion_generation,
    verification_operation_id: resultId,
    human_execution_authorization_sha256: humanAuthorizationSha256,
    supervisor_bundle_sha256: supervisorBundleSha256,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    postdeploy_identity_evidence_sha256: current.checkpoint_evidence_sha256,
    release_identity_sha256: releaseIdentitySha256,
    cross_role_contract_artifact_sha256: crossRoleTemplate.artifact_sha256,
    authorization_matrix_artifact_sha256:
      crossRoleTemplate.generated_from.authorization_matrix.artifact_sha256,
    authorization_matrix_source_manifest_sha256:
      crossRoleTemplate.generated_from.authorization_matrix.source_manifest_sha256,
    fixture_id: crossRoleTemplate.synthetic_fixture.fixture_id,
    data_class: "SYNTHETIC_ONLY",
    approval: {
      status: "APPROVED",
      business_role_matrix_approval_id: "BRM-20260815-077",
      uat_account_mapping_approval_id: "UAM-20260815-077",
      allowed_write_scope: `SYNTHETIC_ONLY:${crossRoleTemplate.synthetic_fixture.fixture_id}`,
      execution_window_start: crossRoleInstant(0),
      execution_window_end: crossRoleInstant(290),
      stop_authority_identity_sha256: digest("cross-role-stop-authority"),
      rollback_owner_identity_sha256:
        crossRoleActor(actors, "rollback_owner").person_identity_sha256,
      approval_evidence_sha256: digest("cross-role-approval-evidence"),
    },
    actors,
    workflows: evidence.workflows,
    execution_started_at: evidence.first,
    execution_completed_at: evidence.executionCompleted,
    signoff_completed_at: evidence.signoffCompleted,
    evidence_expires_at: "2026-08-15T01:49:30.000Z",
    sanitization: uatPromotionCrossRoleSanitization,
  }, { template: crossRoleTemplate, now: new Date("2026-08-15T01:48:30.000Z") });
}

async function crossRoleFixture({
  promotionId = "promotion-cross-role-001", conflateHumanAndIngestAuthorization = false,
} = {}) {
  const identity = await postdeployIdentityFixture({ promotionId });
  const identityPrepared = await run(identity.context, "prepare", identity.root);
  await writePostdeployIdentityEvidence(
    identity.root, identity.context, identity.runtimeProbe,
  );
  await run(identity.context, "execute", identity.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
  });
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(identity.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  const resultId = `${promotionId}-cross-role`;
  const ingestAuthorization = digest(`cross-role-ingest-authorization:${resultId}`);
  const contractLogical = `/usr/local/libexec/chenyida-erp-release-supervisor/bundles/${supervisorBundleSha256}/chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json`;
  await rawFile(identity.root, contractLogical, crossRoleTemplateRaw, 0o444);
  const releaseIdentitySource = await source(identity.root, identityPath);
  const result = createCrossRoleFixtureResult({
    current,
    resultId,
    promotionId,
    humanAuthorizationSha256: conflateHumanAndIngestAuthorization
      ? ingestAuthorization : digest(`human-execution-authorization:${resultId}`),
    releaseIdentitySha256: releaseIdentitySource.sha256,
  });
  await directory(identity.root, UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT, 0o700);
  await rawFile(
    identity.root,
    `${UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT}/.chenyida-erp-uat-cross-role-results-v1`,
    "chenyida-erp-uat-cross-role-results/v1\n", 0o400,
  );
  const resultLogical = `${UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT}/${resultId}.cross-role-uat-result.json`;
  await rawFile(
    identity.root, resultLogical, canonicalUatPromotionCrossRoleResultJson(result), 0o400,
  );
  const identityIntentLogical = `${UAT_PROMOTION_STATE_ROOT}/intents/${identity.context.operation_id}.${identityPrepared.intent_sha256}.json`;
  const identityEvidenceLogical = `${UAT_PROMOTION_STATE_ROOT}/results/${identity.context.operation_id}.${current.checkpoint_evidence_sha256}.json`;
  const contractSource = await source(identity.root, contractLogical);
  const resultSource = await source(identity.root, resultLogical);
  const parameters = {
    promotion_state_root: UAT_PROMOTION_STATE_ROOT,
    promotion_id: current.promotion_id,
    promotion_generation: current.promotion_generation,
    previous_checkpoint_receipt_sha256: current.receipt_sha256,
    promotion_intent_sha256: current.intent_sha256,
    promotion_original_authorization_sha256: current.original_authorization_sha256,
    candidate_binding_sha256: current.candidate_binding_sha256,
    database_binding_sha256: current.database_binding_sha256,
    runtime_binding_sha256: current.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: current.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: current.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: current.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: current.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: current.migration_fence_binding_sha256,
    migration_result_binding_sha256: current.migration_result_binding_sha256,
    compose_deployment_binding_sha256: current.compose_deployment_binding_sha256,
    current_checkpoint_source: await source(identity.root, UAT_PROMOTION_CURRENT_FILE),
    postdeploy_identity_operation_id: identity.context.operation_id,
    postdeploy_identity_intent_sha256: identityPrepared.intent_sha256,
    postdeploy_identity_intent_source: await source(identity.root, identityIntentLogical),
    postdeploy_identity_evidence_sha256: current.checkpoint_evidence_sha256,
    postdeploy_identity_evidence_source: await source(identity.root, identityEvidenceLogical),
    release_identity_sha256: releaseIdentitySource.sha256,
    release_identity_source: releaseIdentitySource,
    cross_role_contract: contractLogical,
    cross_role_contract_file_sha256: contractSource.sha256,
    cross_role_contract_artifact_sha256: crossRoleTemplate.artifact_sha256,
    cross_role_contract_source: contractSource,
    authorization_matrix_artifact_sha256:
      crossRoleTemplate.generated_from.authorization_matrix.artifact_sha256,
    authorization_matrix_source_manifest_sha256:
      crossRoleTemplate.generated_from.authorization_matrix.source_manifest_sha256,
    cross_role_result_root: UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT,
    result_id: resultId,
    cross_role_result: resultLogical,
    cross_role_result_file_sha256: resultSource.sha256,
    cross_role_result_sha256: result.result_sha256,
    cross_role_result_source: resultSource,
    verification_created_at: "2026-08-15T01:48:30.000Z",
    verification_expires_at: "2026-08-15T01:49:00.000Z",
    requester_identity_sha256: digest(`cross-role-requester:${resultId}`),
    approver_identity_sha256: digest(`cross-role-approver:${resultId}`),
    executor_identity_sha256: digest(`cross-role-executor:${resultId}`),
    policy_file_sha256: UAT_PROMOTION_POLICY_FILE_SHA256,
    policy_sha256: UAT_PROMOTION_POLICY_SHA256,
  };
  const context = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-transaction-context/v1",
    operation_id: resultId,
    operation: "CROSS_ROLE_UAT",
    execution_mode: "ORIGINAL",
    execution_authorization_id: resultId,
    execution_authorization_sha256: ingestAuthorization,
    execution_created_at: parameters.verification_created_at,
    original_authorization_sha256: ingestAuthorization,
    supervisor_bundle_sha256: supervisorBundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return {
    ...identity, context, identityContext: identity.context, identityPrepared,
    current, result, resultLogical, contractLogical,
  };
}

function crossRoleRecoveryContext(original, intentSha256, suffix = "recovery") {
  const executionId = `${original.operation_id}-${suffix}`;
  return {
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionId,
    execution_authorization_sha256: digest(`cross-role-recovery-authorization:${executionId}`),
    execution_created_at: "2026-08-15T01:48:40.000Z",
    expected_intent_sha256: intentSha256,
  };
}

async function run(context, phase, root, options = {}) {
  const resolved = { ...options };
  if (phase === "execute"
    && new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(context.operation)
    && resolved.expectedPostdeployResultSha256 === undefined) {
    resolved.expectedPostdeployResultSha256 = await postdeployExpectedResultSha256(context, root);
  }
  return runUatPromotionTransactionPhase(context, phase, {
    filesystemRoot: root, siteRoot, allowTestRoot: true, ...resolved,
  });
}

async function intentPath(root, promotionId) {
  const directoryPath = physical(root, `${UAT_PROMOTION_STATE_ROOT}/intents`);
  const [name] = (await readdir(directoryPath)).filter((entry) => artifactMatches(entry, promotionId));
  return path.join(directoryPath, name);
}

test("BEGIN persists intent first and publishes generation/history/receipt/current idempotently", async (t) => {
  const { root, context } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await run(context, "prepare", root);
  assert.equal(prepared.result, "PREPARED");
  assert.equal(await readFile(await intentPath(root, context.operation_id), "utf8").then((raw) => JSON.parse(raw).intent_sha256), prepared.intent_sha256);
  await assert.rejects(readFile(physical(root, UAT_PROMOTION_CURRENT_FILE)), { code: "ENOENT" });
  assert.equal((await run(context, "prepare", root)).result, "ALREADY_PREPARED");
  const committed = await run(context, "execute", root);
  assert.equal(committed.result, "COMMITTED");
  assert.equal((await run(context, "execute", root)).result, "ALREADY_COMMITTED");
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8")));
  assert.equal(current.checkpoint_id, "PROMOTION_INTENT_AND_DURABLE_JOURNAL");
  assert.equal(current.checkpoint_ordinal, 4);
  assert.equal(current.journal_status, "IN_PROGRESS");
  assert.deepEqual(await Promise.all(["generations", "history", "receipts"].map(async (name) => (await readdir(physical(root, `${UAT_PROMOTION_STATE_ROOT}/${name}`))).length)), [1, 1, 1]);
  assert.equal((await lstat(physical(root, UAT_PROMOTION_CURRENT_FILE))).mode & 0o7777, 0o400);
});

test("same promotion id with a different intent is rejected", async (t) => {
  const { root, context } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(context, "prepare", root);
  const changed = structuredClone(context);
  changed.parameters.executor_identity_sha256 = digest("different-executor");
  await assert.rejects(run(changed, "prepare", root), (error) => error.code === "UAT_PROMOTION_INTENT_ID_REUSED");
});

test("checkpoint contract rejects skip, cross-binding, authorization reuse and UNKNOWN continuation", async (t) => {
  const { root, context } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(context, "prepare", root);
  await run(context, "execute", root);
  const previous = JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8"));
  const base = {
    checkpoint_id: "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: "2026-08-15T01:10:00.000Z",
    checkpoint_evidence_sha256: digest("promotion-snapshot-receipt"),
    checkpoint_authorization_sha256: digest("snapshot-authorization"),
    intent_sha256: previous.intent_sha256,
    candidate_binding_sha256: previous.candidate_binding_sha256,
    database_binding_sha256: previous.database_binding_sha256,
    runtime_binding_sha256: previous.runtime_binding_sha256,
    recovery_binding_sha256: previous.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: digest("promotion-snapshot"),
    writer_quiesce_binding_sha256: ZERO_SHA256,
    migration_authorization_binding_sha256: ZERO_SHA256,
    migration_fence_binding_sha256: ZERO_SHA256,
    migration_result_binding_sha256: ZERO_SHA256,
    compose_deployment_binding_sha256: ZERO_SHA256,
  };
  const next = createNextUatPromotionCheckpointReceipt(previous, base);
  assert.equal(next.previous_checkpoint_receipt_sha256, previous.receipt_sha256);
  assert.throws(() => createNextUatPromotionCheckpointReceipt(previous, { ...base, checkpoint_id: "WRITER_QUIESCE_RECEIPT" }), (error) => error.code === "UAT_PROMOTION_CHECKPOINT_SKIP_FORBIDDEN");
  assert.throws(() => createNextUatPromotionCheckpointReceipt(previous, { ...base, candidate_binding_sha256: digest("other-candidate") }), (error) => error.code === "UAT_PROMOTION_CHECKPOINT_BINDING_INVALID");
  assert.throws(() => createNextUatPromotionCheckpointReceipt(previous, { ...base, checkpoint_authorization_sha256: previous.original_authorization_sha256 }), (error) => error.code === "UAT_PROMOTION_CHECKPOINT_AUTHORIZATION_REUSED");
  const unknown = createNextUatPromotionCheckpointReceipt(previous, { ...base, checkpoint_status: "UNKNOWN", journal_status: "UNKNOWN" });
  assert.throws(() => createNextUatPromotionCheckpointReceipt(unknown, {
    ...base, checkpoint_id: "WRITER_QUIESCE_RECEIPT", recorded_at: "2026-08-15T01:11:00.000Z",
    checkpoint_authorization_sha256: digest("quiesce-authorization"),
  }), (error) => error.code === "UAT_PROMOTION_CHECKPOINT_PREVIOUS_BLOCKED");

  const quiesce = createNextUatPromotionCheckpointReceipt(next, {
    ...base,
    checkpoint_id: "WRITER_QUIESCE_RECEIPT",
    recorded_at: "2026-08-15T01:11:00.000Z",
    checkpoint_authorization_sha256: digest("quiesce-authorization"),
    writer_quiesce_binding_sha256: digest("writer-quiesce"),
  });
  assert.throws(() => createNextUatPromotionCheckpointReceipt(quiesce, {
    ...base,
    checkpoint_id: "ONE_TIME_MIGRATION_AUTHORIZATION",
    recorded_at: "2026-08-15T01:12:00.000Z",
    checkpoint_authorization_sha256: digest("snapshot-authorization"),
    writer_quiesce_binding_sha256: quiesce.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: digest("migration-authorization"),
  }), (error) => error.code === "UAT_PROMOTION_CHECKPOINT_AUTHORIZATION_REUSED");
});

test("crashes after each publication stage converge only through a fresh recovery authorization", async (t) => {
  for (const [index, failpoint] of ["AFTER_GENERATION", "AFTER_HISTORY", "AFTER_RECEIPT", "AFTER_CURRENT"].entries()) {
    const { root, context } = await fixture({ promotionId: `promotion-crash-${index}` });
    t.after(() => rm(root, { recursive: true, force: true }));
    const prepared = await run(context, "prepare", root);
    await assert.rejects(run(context, "execute", root, { fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); } }), new RegExp(`CRASH:${failpoint}`));
    const recovery = recoveryContext(context, prepared.intent_sha256, `recovery-${index}`);
    const planned = await run(recovery, "recover-prepare", root);
    assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
    const result = await run(recovery, "recover-execute", root);
    assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(result.result));
    assert.equal(JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8")).receipt_sha256, result.receipt_sha256);
  }
});

test("broken journal stage and replaced source are preserved and quarantined", async (t) => {
  for (const [index, mutate] of [
    ["broken-history", async (root, context) => {
      await assert.rejects(run(context, "execute", root, { fault: async (point) => { if (point === "AFTER_HISTORY") throw new Error("CRASH"); } }), /CRASH/);
      const [name] = await readdir(physical(root, `${UAT_PROMOTION_STATE_ROOT}/history`));
      await chmod(path.join(physical(root, `${UAT_PROMOTION_STATE_ROOT}/history`), name), 0o600);
    }],
    ["replaced-source", async (root, context) => {
      await chmod(physical(root, manifestPath), 0o600);
      const raw = await readFile(physical(root, manifestPath));
      await writeFile(physical(root, manifestPath), Buffer.concat([raw.subarray(0, -2), Buffer.from(" \n")]));
      await chmod(physical(root, manifestPath), 0o440);
    }],
  ]) {
    const { root, context } = await fixture({ promotionId: `promotion-${index}` });
    t.after(() => rm(root, { recursive: true, force: true }));
    const prepared = await run(context, "prepare", root);
    await mutate(root, context);
    const recovery = recoveryContext(context, prepared.intent_sha256, `recovery-${index}`);
    const planned = await run(recovery, "recover-prepare", root);
    assert.equal(planned.decision, "QUARANTINE");
    const quarantined = await run(recovery, "recover-execute", root);
    assert.equal(quarantined.result, "QUARANTINED");
    assert.equal((await readdir(physical(root, `${UAT_PROMOTION_STATE_ROOT}/quarantine`))).length, 1);
  }
});

test("hardlinked or symlinked intent is never followed and produces quarantine evidence", async (t) => {
  for (const kind of ["hardlink", "symlink"]) {
    const { root, context } = await fixture({ promotionId: `promotion-${kind}` });
    t.after(() => rm(root, { recursive: true, force: true }));
    const prepared = await run(context, "prepare", root);
    const intent = await intentPath(root, context.operation_id);
    const preserved = path.join(root, `${kind}-intent.json`);
    await rename(intent, preserved);
    if (kind === "hardlink") await link(preserved, intent);
    else await symlink(preserved, intent);
    const recovery = recoveryContext(context, prepared.intent_sha256, `recovery-${kind}`);
    assert.equal((await run(recovery, "recover-prepare", root)).decision, "QUARANTINE");
    assert.equal((await run(recovery, "recover-execute", root)).result, "QUARANTINED");
    assert.equal((await lstat(intent)).isSymbolicLink(), kind === "symlink");
    if (kind === "hardlink") assert.equal((await lstat(intent)).nlink, 2);
  }
});

test("CAPTURE persists a bound intent before publishing the nonzero snapshot checkpoint", async (t) => {
  const { root, context } = await snapshotFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await run(context, "prepare", root, snapshotValidators);
  assert.equal(prepared.result, "PREPARED");
  const storedIntent = JSON.parse(await readFile(await intentPath(root, context.operation_id), "utf8"));
  assert.equal(storedIntent.contract, UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT);
  assert.equal(storedIntent.snapshot_intent_sha256, prepared.intent_sha256);
  assert.equal(storedIntent.previous_checkpoint_receipt_sha256, context.parameters.previous_checkpoint_receipt_sha256);
  assert.deepEqual(storedIntent.snapshot_objects, context.parameters.snapshot_objects);
  assert.equal((await run(context, "prepare", root, snapshotValidators)).result, "ALREADY_PREPARED");
  const committed = await run(context, "execute", root, snapshotValidators);
  assert.equal(committed.result, "COMMITTED");
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8")));
  assert.equal(current.checkpoint_id, "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT");
  assert.equal(current.checkpoint_ordinal, 5);
  assert.notEqual(current.promotion_snapshot_binding_sha256, ZERO_SHA256);
  assert.equal(current.promotion_snapshot_binding_sha256, storedIntent.promotion_snapshot_binding_sha256);
  assert.equal(current.checkpoint_authorization_sha256, context.execution_authorization_sha256);
  assert.equal(current.previous_checkpoint_receipt_sha256, context.parameters.previous_checkpoint_receipt_sha256);
  assert.deepEqual(await Promise.all(["history", "receipts"].map(async (name) => (await readdir(physical(root, `${UAT_PROMOTION_STATE_ROOT}/${name}`))).length)), [2, 2]);
});

test("CAPTURE rejects old, synthetic, partial, same-host, cross-database and incomplete four-domain evidence", async (t) => {
  const expected = new Map([
    ["old-evidence", "UAT_PROMOTION_SNAPSHOT_WINDOW_INVALID"],
    ["synthetic", "UAT_PROMOTION_SNAPSHOT_READINESS_INVALID"],
    ["partial", "UAT_PROMOTION_SNAPSHOT_READINESS_INVALID"],
    ["same-host", "UAT_PROMOTION_SNAPSHOT_OFFHOST_INVALID"],
    ["cross-database", "UAT_PROMOTION_SNAPSHOT_DATABASE_MISMATCH"],
    ["missing-domain", "UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID"],
  ]);
  let index = 0;
  for (const [variant, code] of expected) {
    const fixtureValue = await snapshotFixture({ promotionId: `promotion-snapshot-negative-${index}`, variant });
    index += 1;
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    await assert.rejects(
      run(fixtureValue.context, "prepare", fixtureValue.root, snapshotValidators),
      (error) => error.code === code,
      variant,
    );
  }
});

test("CAPTURE publication crashes converge only through a fresh recovery authorization", async (t) => {
  for (const [index, failpoint] of ["AFTER_SNAPSHOT_HISTORY", "AFTER_SNAPSHOT_RECEIPT", "AFTER_SNAPSHOT_CURRENT"].entries()) {
    const { root, context } = await snapshotFixture({ promotionId: `promotion-snapshot-crash-${index}` });
    t.after(() => rm(root, { recursive: true, force: true }));
    const prepared = await run(context, "prepare", root, snapshotValidators);
    await assert.rejects(
      run(context, "execute", root, { ...snapshotValidators, fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); } }),
      new RegExp(`CRASH:${failpoint}`),
    );
    const recovery = snapshotRecoveryContext(context, prepared.intent_sha256, `recovery-${index}`);
    const planned = await run(recovery, "recover-prepare", root, snapshotValidators);
    assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
    const result = await run(recovery, "recover-execute", root, snapshotValidators);
    assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(result.result));
    assert.equal(JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8")).receipt_sha256, result.receipt_sha256);
  }
});

test("CAPTURE source replacement and linked snapshot intents are preserved and quarantined", async (t) => {
  const replaced = await snapshotFixture({ promotionId: "promotion-snapshot-replaced" });
  t.after(() => rm(replaced.root, { recursive: true, force: true }));
  const prepared = await run(replaced.context, "prepare", replaced.root, snapshotValidators);
  const readinessFile = physical(replaced.root, replaced.snapshotPath);
  const original = await readFile(readinessFile);
  await chmod(readinessFile, 0o600);
  await writeFile(readinessFile, Buffer.concat([original, Buffer.from(" ")]));
  await chmod(readinessFile, 0o640);
  await assert.rejects(run(replaced.context, "execute", replaced.root, snapshotValidators));
  const replacedRecovery = snapshotRecoveryContext(replaced.context, prepared.intent_sha256, "recovery-replaced");
  assert.equal((await run(replacedRecovery, "recover-prepare", replaced.root, snapshotValidators)).decision, "QUARANTINE");
  assert.equal((await run(replacedRecovery, "recover-execute", replaced.root, snapshotValidators)).result, "QUARANTINED");
  assert.deepEqual(await readFile(readinessFile), Buffer.concat([original, Buffer.from(" ")]));

  for (const kind of ["hardlink", "symlink"]) {
    const linked = await snapshotFixture({ promotionId: `promotion-snapshot-${kind}` });
    t.after(() => rm(linked.root, { recursive: true, force: true }));
    const snapshotPrepared = await run(linked.context, "prepare", linked.root, snapshotValidators);
    const intent = await intentPath(linked.root, linked.context.operation_id);
    const preserved = path.join(linked.root, `${kind}-snapshot-intent.json`);
    await rename(intent, preserved);
    if (kind === "hardlink") await link(preserved, intent);
    else await symlink(preserved, intent);
    const recovery = snapshotRecoveryContext(linked.context, snapshotPrepared.intent_sha256, `recovery-${kind}`);
    assert.equal((await run(recovery, "recover-prepare", linked.root, snapshotValidators)).decision, "QUARANTINE");
    assert.equal((await run(recovery, "recover-execute", linked.root, snapshotValidators)).result, "QUARANTINED");
  }
});

test("QUIESCE publishes checkpoint 6 with same-writer continued-stop evidence and an explicit external-client boundary", async (t) => {
  const { root, context, quiesceValidators } = await quiesceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await run(context, "prepare", root, quiesceValidators);
  assert.equal(prepared.result, "PREPARED");
  assert.equal((await run(context, "prepare", root, quiesceValidators)).result, "ALREADY_PREPARED");
  const storedIntent = JSON.parse(await readFile(await intentPath(root, context.operation_id), "utf8"));
  assert.equal(storedIntent.contract, UAT_PROMOTION_QUIESCE_INTENT_CONTRACT);
  assert.equal(storedIntent.quiesce_intent_sha256, prepared.intent_sha256);
  assert.equal(storedIntent.quiesce_evidence.status, "CONTINUED_QUIESCE_VERIFIED");
  assert.equal(
    storedIntent.quiesce_evidence.writer_scope,
    "EXACT_COMPOSE_PROJECT_AND_WORKING_DIRECTORY_ONLY_EXTERNAL_CLIENTS_DEFERRED_TO_MIGRATION_FENCE",
  );
  assert.equal(storedIntent.snapshot_writer_capture.web.container_id, context.parameters.web_container_id);
  assert.equal(storedIntent.snapshot_writer_capture.worker.container_id, context.parameters.worker_container_id);
  const committed = await run(context, "execute", root, quiesceValidators);
  assert.equal(committed.result, "COMMITTED");
  const current = validateUatPromotionCheckpointReceipt(
    JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8")),
  );
  assert.equal(current.checkpoint_id, "WRITER_QUIESCE_RECEIPT");
  assert.equal(current.checkpoint_ordinal, 6);
  assert.equal(current.checkpoint_evidence_sha256, prepared.intent_sha256);
  assert.notEqual(current.writer_quiesce_binding_sha256, ZERO_SHA256);
  assert.equal(current.writer_quiesce_binding_sha256, storedIntent.writer_quiesce_binding_sha256);
  assert.equal(current.checkpoint_authorization_sha256, context.execution_authorization_sha256);
});

test("QUIESCE rejects running, restarted, replaced and extra Compose writer evidence", async (t) => {
  for (const [index, variant] of ["running", "restarted", "replaced", "extra-writer"].entries()) {
    const fixtureValue = await quiesceFixture({ promotionId: `promotion-quiesce-negative-${index}`, evidenceVariant: variant });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    await assert.rejects(
      run(fixtureValue.context, "prepare", fixtureValue.root, fixtureValue.quiesceValidators),
      (error) => error.code === "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID",
      variant,
    );
  }
});

test("QUIESCE rejects cross-runtime binding and source replacement", async (t) => {
  const crossed = await quiesceFixture({ promotionId: "promotion-quiesce-crossed" });
  t.after(() => rm(crossed.root, { recursive: true, force: true }));
  const changed = structuredClone(crossed.context);
  changed.parameters.worker_container_id = "8".repeat(64);
  await assert.rejects(
    run(changed, "prepare", crossed.root, crossed.quiesceValidators),
    (error) => error.code === "UAT_PROMOTION_QUIESCE_BINDING_MISMATCH",
  );

  const replaced = await quiesceFixture({ promotionId: "promotion-quiesce-source-replaced" });
  t.after(() => rm(replaced.root, { recursive: true, force: true }));
  const prepared = await run(replaced.context, "prepare", replaced.root, replaced.quiesceValidators);
  const identityFile = physical(replaced.root, identityPath);
  const original = await readFile(identityFile);
  await chmod(identityFile, 0o600);
  await writeFile(identityFile, Buffer.concat([original, Buffer.from(" ")]));
  await chmod(identityFile, 0o440);
  await assert.rejects(run(replaced.context, "execute", replaced.root, replaced.quiesceValidators));
  const recovery = quiesceRecoveryContext(replaced.context, prepared.intent_sha256, "source-replaced-recovery");
  assert.equal((await run(recovery, "recover-prepare", replaced.root, replaced.quiesceValidators)).decision, "QUARANTINE");
  assert.equal((await run(recovery, "recover-execute", replaced.root, replaced.quiesceValidators)).result, "QUARANTINED");
  assert.deepEqual(await readFile(identityFile), Buffer.concat([original, Buffer.from(" ")]));
});

test("QUIESCE publication crashes converge through fresh recovery authorization", async (t) => {
  for (const [index, failpoint] of ["AFTER_QUIESCE_HISTORY", "AFTER_QUIESCE_RECEIPT", "AFTER_QUIESCE_CURRENT"].entries()) {
    const fixtureValue = await quiesceFixture({ promotionId: `promotion-quiesce-crash-${index}` });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root, fixtureValue.quiesceValidators);
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, {
        ...fixtureValue.quiesceValidators,
        fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); },
      }),
      new RegExp(`CRASH:${failpoint}`),
    );
    const recovery = quiesceRecoveryContext(fixtureValue.context, prepared.intent_sha256, `recovery-${index}`);
    const planned = await run(recovery, "recover-prepare", fixtureValue.root, fixtureValue.quiesceValidators);
    assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
    const result = await run(recovery, "recover-execute", fixtureValue.root, fixtureValue.quiesceValidators);
    assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(result.result));
    assert.equal(
      JSON.parse(await readFile(physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8")).receipt_sha256,
      result.receipt_sha256,
    );
  }
});

test("linked QUIESCE intents are never followed and are quarantined", async (t) => {
  for (const kind of ["hardlink", "symlink"]) {
    const fixtureValue = await quiesceFixture({ promotionId: `promotion-quiesce-${kind}` });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root, fixtureValue.quiesceValidators);
    const intent = await intentPath(fixtureValue.root, fixtureValue.context.operation_id);
    const preserved = path.join(fixtureValue.root, `${kind}-quiesce-intent.json`);
    await rename(intent, preserved);
    if (kind === "hardlink") await link(preserved, intent);
    else await symlink(preserved, intent);
    const recovery = quiesceRecoveryContext(fixtureValue.context, prepared.intent_sha256, `recovery-${kind}`);
    assert.equal((await run(recovery, "recover-prepare", fixtureValue.root, fixtureValue.quiesceValidators)).decision, "QUARANTINE");
    assert.equal((await run(recovery, "recover-execute", fixtureValue.root, fixtureValue.quiesceValidators)).result, "QUARANTINED");
  }
});

test("migration approval publishes checkpoint 7 without a SQL or database-fence execution grant", async (t) => {
  const { root, context } = await migrationAuthorizationFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const prepared = await run(context, "prepare", root);
  assert.equal(prepared.result, "PREPARED");
  assert.equal((await run(context, "prepare", root)).result, "ALREADY_PREPARED");
  const storedIntent = JSON.parse(await readFile(await intentPath(root, context.operation_id), "utf8"));
  assert.equal(storedIntent.contract, UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT);
  assert.equal(storedIntent.execution_scope, "APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE");
  assert.equal(storedIntent.migration_authorization_intent_sha256, prepared.intent_sha256);
  assert.equal(storedIntent.previous_checkpoint_receipt_sha256, context.parameters.previous_checkpoint_receipt_sha256);
  assert.notEqual(storedIntent.migration_authorization_binding_sha256, ZERO_SHA256);
  const committed = await run(context, "execute", root);
  assert.equal(committed.result, "COMMITTED");
  const current = validateUatPromotionCheckpointReceipt(
    JSON.parse(await readFile(physical(root, UAT_PROMOTION_CURRENT_FILE), "utf8")),
  );
  assert.equal(current.checkpoint_id, "ONE_TIME_MIGRATION_AUTHORIZATION");
  assert.equal(current.checkpoint_ordinal, 7);
  assert.equal(current.checkpoint_evidence_sha256, prepared.intent_sha256);
  assert.equal(
    current.migration_authorization_binding_sha256,
    storedIntent.migration_authorization_binding_sha256,
  );
  assert.equal(current.checkpoint_authorization_sha256, context.execution_authorization_sha256);
  await assert.rejects(
    run(context, "execute", root),
    (error) => error.code === "UAT_PROMOTION_MIGRATION_AUTHORIZATION_CURRENT_SOURCE_INVALID",
  );
});

test("migration approval rejects binding drift and preserves replaced sources for quarantine", async (t) => {
  const crossed = await migrationAuthorizationFixture({ promotionId: "promotion-migration-authorization-crossed" });
  t.after(() => rm(crossed.root, { recursive: true, force: true }));
  const changed = structuredClone(crossed.context);
  changed.parameters.target_migration_head = "0045_wrong_target.sql";
  await assert.rejects(
    run(changed, "prepare", crossed.root),
    (error) => error.code === "UAT_PROMOTION_MIGRATION_AUTHORIZATION_PROMOTION_MISMATCH",
  );

  const replaced = await migrationAuthorizationFixture({ promotionId: "promotion-migration-authorization-replaced" });
  t.after(() => rm(replaced.root, { recursive: true, force: true }));
  const prepared = await run(replaced.context, "prepare", replaced.root);
  const manifestFile = physical(replaced.root, manifestPath);
  const original = await readFile(manifestFile);
  await chmod(manifestFile, 0o600);
  await writeFile(manifestFile, Buffer.concat([original, Buffer.from(" ")]));
  await chmod(manifestFile, 0o440);
  await assert.rejects(run(replaced.context, "execute", replaced.root));
  const recovery = migrationAuthorizationRecoveryContext(replaced.context, prepared.intent_sha256, "source-replaced");
  assert.equal((await run(recovery, "recover-prepare", replaced.root)).decision, "QUARANTINE");
  assert.equal((await run(recovery, "recover-execute", replaced.root)).result, "QUARANTINED");
  assert.deepEqual(await readFile(manifestFile), Buffer.concat([original, Buffer.from(" ")]));
});

test("migration approval publication crashes converge only through fresh recovery authorization", async (t) => {
  const failpoints = [
    "AFTER_MIGRATION_AUTHORIZATION_HISTORY",
    "AFTER_MIGRATION_AUTHORIZATION_RECEIPT",
    "AFTER_MIGRATION_AUTHORIZATION_CURRENT",
  ];
  for (const [index, failpoint] of failpoints.entries()) {
    const fixtureValue = await migrationAuthorizationFixture({
      promotionId: `promotion-migration-authorization-crash-${index}`,
    });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, {
        fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); },
      }),
      new RegExp(`CRASH:${failpoint}`),
    );
    const recovery = migrationAuthorizationRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `recovery-${index}`,
    );
    const planned = await run(recovery, "recover-prepare", fixtureValue.root);
    assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
    const result = await run(recovery, "recover-execute", fixtureValue.root);
    assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(result.result));
    assert.equal(
      JSON.parse(await readFile(physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8")).receipt_sha256,
      result.receipt_sha256,
    );
  }
});

test("linked migration approval intents are never followed and are quarantined", async (t) => {
  for (const kind of ["hardlink", "symlink"]) {
    const fixtureValue = await migrationAuthorizationFixture({
      promotionId: `promotion-migration-authorization-${kind}`,
    });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
    const intent = await intentPath(fixtureValue.root, fixtureValue.context.operation_id);
    const preserved = path.join(fixtureValue.root, `${kind}-migration-authorization-intent.json`);
    await rename(intent, preserved);
    if (kind === "hardlink") await link(preserved, intent);
    else await symlink(preserved, intent);
    const recovery = migrationAuthorizationRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `recovery-${kind}`,
    );
    assert.equal((await run(recovery, "recover-prepare", fixtureValue.root)).decision, "QUARANTINE");
    assert.equal((await run(recovery, "recover-execute", fixtureValue.root)).result, "QUARANTINED");
  }
});

test("migration execution persists a separate grant and publishes checkpoint 8 only from a complete result", async (t) => {
  const fixtureValue = await migrationExecutionFixture();
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  assert.equal(prepared.result, "PREPARED");
  assert.notEqual(
    fixtureValue.context.original_authorization_sha256,
    fixtureValue.context.parameters.migration_approval_authorization_sha256,
  );
  const storedIntent = JSON.parse(await readFile(await intentPath(
    fixtureValue.root, fixtureValue.context.operation_id,
  ), "utf8"));
  assert.equal(storedIntent.contract, UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT);
  assert.equal(storedIntent.grant_sha256, prepared.grant_sha256);
  const grantName = (await readdir(physical(
    fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/grants`,
  ))).find((name) => artifactMatches(name, fixtureValue.context.operation_id));
  assert.ok(grantName.endsWith(`.${prepared.grant_sha256}.json`));
  assert.equal((await lstat(path.join(physical(
    fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/grants`,
  ), grantName))).mode & 0o7777, 0o440);
  await assert.rejects(
    run(fixtureValue.context, "execute", fixtureValue.root),
    (error) => error.code === "UAT_PROMOTION_MIGRATION_RESULT_MISSING",
  );
  const { result } = await writeMigrationExecutionResult(fixtureValue.root, fixtureValue.context);
  const committed = await run(fixtureValue.context, "execute", fixtureValue.root);
  assert.equal(committed.result, "COMMITTED");
  assert.equal(committed.migration_result_sha256, result.result_sha256);
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  assert.equal(current.checkpoint_id, "MIGRATION_COMMIT_RECEIPT");
  assert.equal(current.checkpoint_ordinal, 8);
  assert.equal(current.checkpoint_evidence_sha256, result.result_sha256);
  assert.equal(current.migration_fence_binding_sha256, result.database_fence_binding_sha256);
  assert.equal(current.migration_result_binding_sha256, result.migration_result_binding_sha256);
});

test("dotted migration operation ids do not collide with longer artifact prefixes", async (t) => {
  const operationId = "promotion.migration.execution";
  const fixtureValue = await migrationExecutionFixture({
    promotionId: "promotion-migration-dotted-id",
    operationId,
  });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const unrelatedId = `${operationId}.other`;
  const unrelatedDigest = digest("unrelated-dotted-operation");
  for (const [directoryName, mode] of [["intents", 0o400], ["grants", 0o440]]) {
    const directoryPath = physical(fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/${directoryName}`);
    const artifact = path.join(directoryPath, `${unrelatedId}.${unrelatedDigest}.json`);
    await writeFile(artifact, "{}\n", { mode });
    await chmod(artifact, mode);
  }
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  assert.equal(prepared.result, "PREPARED");
  const intentNames = await readdir(physical(fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/intents`));
  assert.equal(intentNames.filter((name) => artifactMatches(name, operationId)).length, 1);
  assert.equal(intentNames.filter((name) => artifactMatches(name, unrelatedId)).length, 1);
});

test("migration execution publication crashes resume from the immutable result without rerunning SQL", async (t) => {
  const failpoints = [
    "AFTER_MIGRATION_EXECUTION_HISTORY",
    "AFTER_MIGRATION_EXECUTION_RECEIPT",
    "AFTER_MIGRATION_EXECUTION_CURRENT",
  ];
  for (const [index, failpoint] of failpoints.entries()) {
    const fixtureValue = await migrationExecutionFixture({
      promotionId: `promotion-migration-execution-crash-${index}`,
    });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
    const { result, resultFile } = await writeMigrationExecutionResult(fixtureValue.root, fixtureValue.context);
    const resultRaw = await readFile(resultFile);
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, {
        fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); },
      }),
      new RegExp(`CRASH:${failpoint}`),
    );
    const recovery = migrationExecutionRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `recovery-${index}`,
    );
    const planned = await run(recovery, "recover-prepare", fixtureValue.root);
    assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
    const recovered = await run(recovery, "recover-execute", fixtureValue.root);
    assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(recovered.result));
    assert.equal(recovered.migration_result_sha256, result.result_sha256);
    assert.deepEqual(await readFile(resultFile), resultRaw);
  }
});

test("migration execution recovery quarantines missing or invalid results and never synthesizes one", async (t) => {
  for (const variant of ["missing", "invalid"]) {
    const fixtureValue = await migrationExecutionFixture({
      promotionId: `promotion-migration-execution-${variant}`,
    });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
    if (variant === "invalid") {
      const { resultFile } = await writeMigrationExecutionResult(fixtureValue.root, fixtureValue.context);
      const parsed = JSON.parse(await readFile(resultFile, "utf8"));
      parsed.status = "MIGRATION_FAILED";
      await chmod(resultFile, 0o600);
      await writeFile(resultFile, canonicalMigrationExecutionJson(parsed));
      await chmod(resultFile, 0o400);
    }
    const recovery = migrationExecutionRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `recovery-${variant}`,
    );
    assert.equal((await run(recovery, "recover-prepare", fixtureValue.root)).decision, "QUARANTINE");
    assert.equal((await run(recovery, "recover-execute", fixtureValue.root)).result, "QUARANTINED");
    const resultNames = await readdir(physical(fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/results`));
    assert.equal(resultNames.length, variant === "missing" ? 0 : 1);
  }
});

test("migration execution cannot outlive the checkpoint 7 approval window", async (t) => {
  const fixtureValue = await migrationExecutionFixture({ promotionId: "promotion-migration-execution-expired" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const changed = structuredClone(fixtureValue.context);
  changed.parameters.execution_expires_at = "2026-08-15T01:44:00.000Z";
  await assert.rejects(
    run(changed, "prepare", fixtureValue.root),
    (error) => error.code === "UAT_PROMOTION_MIGRATION_EXECUTION_APPROVAL_EXPIRED",
  );
});

test("compose deployment publishes checkpoint 9 only from a bound result and active-fence transfer", async (t) => {
  const fixtureValue = await composeDeploymentFixture();
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  assert.equal(prepared.result, "PREPARED");
  const intent = JSON.parse(await readFile(await intentPath(
    fixtureValue.root, fixtureValue.context.operation_id,
  ), "utf8"));
  assert.equal(intent.deployment_plan_sha256, prepared.deployment_plan_sha256);
  assert.equal(intent.released_baseline_sha256, fixtureValue.activeFence.released_baseline_sha256);
  await assert.rejects(
    run(fixtureValue.context, "execute", fixtureValue.root),
    (error) => error.code === "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_MISSING",
  );
  const { result, transfer } = await writeComposeDeploymentCompletion(
    fixtureValue.root, fixtureValue.context, intent,
  );
  const committed = await run(fixtureValue.context, "execute", fixtureValue.root);
  assert.equal(committed.result, "COMMITTED");
  assert.equal(committed.deployment_result_sha256, result.result_sha256);
  assert.equal(committed.fence_transfer_sha256, transfer.transfer_sha256);
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  assert.equal(current.checkpoint_id, "COMPOSE_DEPLOYMENT_RECEIPT");
  assert.equal(current.checkpoint_ordinal, 9);
  assert.equal(current.checkpoint_evidence_sha256, result.result_sha256);
  assert.equal(current.compose_deployment_binding_sha256, clusterSha256({
    deployment_result_sha256: result.result_sha256,
    fence_transfer_sha256: transfer.transfer_sha256,
  }));
});

test("compose deployment publication crashes resume from immutable result and transfer", async (t) => {
  const failpoints = [
    "AFTER_COMPOSE_DEPLOYMENT_HISTORY",
    "AFTER_COMPOSE_DEPLOYMENT_RECEIPT",
    "AFTER_COMPOSE_DEPLOYMENT_CURRENT",
  ];
  for (const [index, failpoint] of failpoints.entries()) {
    const fixtureValue = await composeDeploymentFixture({
      promotionId: `promotion-compose-publication-crash-${index}`,
    });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
    const intent = JSON.parse(await readFile(await intentPath(
      fixtureValue.root, fixtureValue.context.operation_id,
    ), "utf8"));
    const completion = await writeComposeDeploymentCompletion(
      fixtureValue.root, fixtureValue.context, intent,
    );
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, {
        fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); },
      }),
      new RegExp(`CRASH:${failpoint}`),
    );
    const recovery = composeDeploymentRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `recovery-${index}`,
    );
    const planned = await run(recovery, "recover-prepare", fixtureValue.root);
    assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
    const recovered = await run(recovery, "recover-execute", fixtureValue.root);
    assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(recovered.result));
    assert.equal(recovered.deployment_result_sha256, completion.result.result_sha256);
    assert.equal(recovered.fence_transfer_sha256, completion.transfer.transfer_sha256);
  }
});

test("compose deployment controller contains protected-runtime drift and recovery quarantines without guessing", async (t) => {
  const fixtureValue = await composeDeploymentFixture({ promotionId: "promotion-compose-controller-drift" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  const intent = JSON.parse(await readFile(await intentPath(
    fixtureValue.root, fixtureValue.context.operation_id,
  ), "utf8"));
  const completion = await writeComposeDeploymentCompletion(fixtureValue.root, fixtureValue.context, intent);
  const resultFile = physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/results/${fixtureValue.context.operation_id}.${completion.result.result_sha256}.json`,
  );
  const transferFile = physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/fence-transfers/${fixtureValue.context.operation_id}.${completion.transfer.transfer_sha256}.json`,
  );
  await rm(resultFile); await rm(transferFile);
  let containmentCalls = 0;
  const before = {
    old_runtime_sha256: completion.result.old_runtime_sha256,
    protected_resources_before_sha256: completion.result.protected_resources_before_sha256,
  };
  const created = {
    selectors: { web: "5".repeat(64), worker: "6".repeat(64) },
    created_runtime_sha256: completion.result.created_runtime_sha256,
  };
  const committed = {
    services: completion.result.services,
    unchanged_services: completion.result.unchanged_services,
    created_runtime_sha256: completion.result.created_runtime_sha256,
    committed_runtime_sha256: completion.result.committed_runtime_sha256,
    protected_resources_after_sha256: digest("unexpected-protected-runtime"),
    runtime_configuration_sha256: completion.result.runtime_configuration_sha256,
    readiness_sha256: completion.result.readiness_sha256,
    completed_at: completion.result.completed_at,
  };
  const adapter = {
    captureBefore: async () => before,
    handoffDatabase: async () => completion.result.database_handoff,
    createRuntime: async () => created,
    verifyRuntime: async () => committed,
    emergencyContainment: async () => {
      containmentCalls += 1;
      return { database_sealed: true, stopped_container_ids: ["5".repeat(64), "6".repeat(64)] };
    },
  };
  await assert.rejects(
    runUatPromotionComposeDeploymentControl(fixtureValue.context, "execute", {
      filesystemRoot: fixtureValue.root, allowTestRoot: true, intent,
      expectedIntentSha256: prepared.intent_sha256, adapter,
      now: () => new Date("2026-08-15T01:41:21.000Z"),
    }),
    (error) => error.code === "COMPOSE_DEPLOYMENT_CONTROL_PROTECTED_RUNTIME_CHANGED",
  );
  assert.equal(containmentCalls, 1);
  const recovery = composeDeploymentRecoveryContext(fixtureValue.context, prepared.intent_sha256, "controller");
  assert.equal((await run(recovery, "recover-prepare", fixtureValue.root)).decision, "QUARANTINE");
  const contained = await runUatPromotionComposeDeploymentControl(recovery, "recover", {
    filesystemRoot: fixtureValue.root, allowTestRoot: true, intent,
    expectedIntentSha256: prepared.intent_sha256, adapter,
    now: () => new Date("2026-08-15T01:43:31.000Z"),
  });
  assert.equal(contained.result, "CONTAINED_FOR_JOURNAL_QUARANTINE");
  assert.equal(containmentCalls, 2);
  assert.equal((await run(recovery, "recover-execute", fixtureValue.root)).result, "QUARANTINED");
});

test("compose deployment recovery contains malformed completion artifacts", async (t) => {
  const fixtureValue = await composeDeploymentFixture({ promotionId: "promotion-compose-controller-malformed" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  const intent = JSON.parse(await readFile(await intentPath(
    fixtureValue.root, fixtureValue.context.operation_id,
  ), "utf8"));
  const malformedResult = physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/results/${fixtureValue.context.operation_id}.${"1".repeat(64)}.json`,
  );
  const malformedTransfer = physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/fence-transfers/${fixtureValue.context.operation_id}.${"2".repeat(64)}.json`,
  );
  await writeFile(malformedResult, canonicalClusterJson({}), { mode: 0o400 });
  await writeFile(malformedTransfer, canonicalClusterJson({}), { mode: 0o400 });
  let containmentCalls = 0;
  const recovery = composeDeploymentRecoveryContext(fixtureValue.context, prepared.intent_sha256, "malformed");
  const contained = await runUatPromotionComposeDeploymentControl(recovery, "recover", {
    filesystemRoot: fixtureValue.root, allowTestRoot: true, intent,
    expectedIntentSha256: prepared.intent_sha256,
    adapter: {
      emergencyContainment: async () => {
        containmentCalls += 1;
        return { database_sealed: true, stopped_container_ids: [] };
      },
    },
    now: () => new Date("2026-08-15T01:43:31.000Z"),
  });
  assert.equal(contained.result, "CONTAINED_FOR_JOURNAL_QUARANTINE");
  assert.equal(containmentCalls, 1);
});

test("compose deployment controller persists exact completion for checkpoint 9", async (t) => {
  const fixtureValue = await composeDeploymentFixture({ promotionId: "promotion-compose-controller-success" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  const intent = JSON.parse(await readFile(await intentPath(
    fixtureValue.root, fixtureValue.context.operation_id,
  ), "utf8"));
  const completion = await writeComposeDeploymentCompletion(fixtureValue.root, fixtureValue.context, intent);
  await rm(physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/results/${fixtureValue.context.operation_id}.${completion.result.result_sha256}.json`,
  ));
  await rm(physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/fence-transfers/${fixtureValue.context.operation_id}.${completion.transfer.transfer_sha256}.json`,
  ));
  let containmentCalls = 0;
  const adapter = {
    captureBefore: async () => ({
      old_runtime_sha256: completion.result.old_runtime_sha256,
      protected_resources_before_sha256: completion.result.protected_resources_before_sha256,
    }),
    handoffDatabase: async () => completion.result.database_handoff,
    createRuntime: async () => ({
      selectors: { web: "5".repeat(64), worker: "6".repeat(64) },
      created_runtime_sha256: completion.result.created_runtime_sha256,
    }),
    verifyRuntime: async () => ({
      services: completion.result.services,
      unchanged_services: completion.result.unchanged_services,
      created_runtime_sha256: completion.result.created_runtime_sha256,
      committed_runtime_sha256: completion.result.committed_runtime_sha256,
      protected_resources_after_sha256: completion.result.protected_resources_after_sha256,
      runtime_configuration_sha256: completion.result.runtime_configuration_sha256,
      readiness_sha256: completion.result.readiness_sha256,
      completed_at: completion.result.completed_at,
    }),
    emergencyContainment: async () => { containmentCalls += 1; return { database_sealed: true, stopped_container_ids: [] }; },
  };
  const times = [new Date("2026-08-15T01:41:21.000Z"), new Date("2026-08-15T01:42:01.000Z")];
  const control = await runUatPromotionComposeDeploymentControl(fixtureValue.context, "execute", {
    filesystemRoot: fixtureValue.root, allowTestRoot: true, intent,
    expectedIntentSha256: prepared.intent_sha256, adapter,
    now: () => times.shift(),
  });
  assert.equal(control.result, "COMPOSE_DEPLOYMENT_RESULT_PERSISTED");
  assert.equal(containmentCalls, 0);
  const committed = await run(fixtureValue.context, "execute", fixtureValue.root);
  assert.equal(committed.deployment_result_sha256, control.deployment_result_sha256);
  assert.equal(committed.fence_transfer_sha256, control.fence_transfer_sha256);
});

test("postdeploy runtime and identity use distinct authorizations and stop the journal at checkpoint 11", async (t) => {
  const fixtureValue = await postdeployIdentityFixture();
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const checkpoint10 = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  assert.equal(checkpoint10.checkpoint_id, "POST_DEPLOY_RUNTIME_CONFIGURATION");
  assert.equal(checkpoint10.checkpoint_ordinal, 10);
  assert.equal(checkpoint10.checkpoint_authorization_sha256, fixtureValue.runtimeContext.original_authorization_sha256);
  assert.notEqual(fixtureValue.context.original_authorization_sha256, fixtureValue.runtimeContext.original_authorization_sha256);
  assert.notEqual(fixtureValue.context.original_authorization_sha256, fixtureValue.composeContext.original_authorization_sha256);

  const replay = structuredClone(fixtureValue.context);
  replay.execution_authorization_sha256 = fixtureValue.runtimeContext.original_authorization_sha256;
  replay.original_authorization_sha256 = fixtureValue.runtimeContext.original_authorization_sha256;
  await assert.rejects(
    run(replay, "prepare", fixtureValue.root),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_DEPLOYMENT_BINDING_INVALID",
  );

  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  const evidence = await writePostdeployIdentityEvidence(
    fixtureValue.root, fixtureValue.context, fixtureValue.runtimeProbe,
  );
  const committed = await run(fixtureValue.context, "execute", fixtureValue.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
  });
  assert.equal(committed.result, "COMMITTED");
  assert.equal(committed.intent_sha256, prepared.intent_sha256);
  assert.equal(committed.postdeploy_receipt_sha256, (await source(
    fixtureValue.root, evidence.receiptLogical,
  )).sha256);
  const checkpoint11 = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  assert.equal(checkpoint11.checkpoint_id, "POST_DEPLOY_IDENTITY");
  assert.equal(checkpoint11.checkpoint_ordinal, 11);
  assert.equal(checkpoint11.journal_status, "IN_PROGRESS");
  assert.equal(checkpoint11.authorization_sha256_chain.at(-2), fixtureValue.runtimeContext.original_authorization_sha256);
  assert.equal(checkpoint11.authorization_sha256_chain.at(-1), fixtureValue.context.original_authorization_sha256);
});

test("postdeploy runtime rejects cross-promotion and exact service identity drift", async (t) => {
  const crossPromotion = await postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-cross" });
  t.after(() => rm(crossPromotion.root, { recursive: true, force: true }));
  const changedContext = structuredClone(crossPromotion.context);
  changedContext.parameters.promotion_id = "different-promotion";
  await assert.rejects(
    run(changedContext, "prepare", crossPromotion.root),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_CURRENT_MISMATCH",
  );

  const serviceDrift = await postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-service-drift" });
  t.after(() => rm(serviceDrift.root, { recursive: true, force: true }));
  await run(serviceDrift.context, "prepare", serviceDrift.root);
  await writeRuntimeProbe(serviceDrift.root, serviceDrift.context, serviceDrift.completion, (value) => {
    const changed = structuredClone(value);
    changed.services.find((item) => item.service === "web").container_id = "9".repeat(64);
    return changed;
  });
  await assert.rejects(
    run(serviceDrift.context, "execute", serviceDrift.root, { now: new Date("2026-08-15T01:42:31.000Z") }),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_BINDING_INVALID",
  );
});

test("postdeploy runtime and identity publication crashes resume without rerunning external controls", async (t) => {
  const operations = [
    {
      name: "runtime",
      fixture: (index) => postdeployRuntimeFixture({ promotionId: `promotion-postdeploy-runtime-crash-${index}` }),
      write: (value) => writeRuntimeProbe(value.root, value.context, value.completion),
      now: new Date("2026-08-15T01:44:00.000Z"),
      failpoints: [
        "AFTER_POSTDEPLOY_RUNTIME_RESULT", "AFTER_POSTDEPLOY_RUNTIME_HISTORY",
        "AFTER_POSTDEPLOY_RUNTIME_RECEIPT", "AFTER_POSTDEPLOY_RUNTIME_CURRENT",
      ],
    },
    {
      name: "identity",
      fixture: (index) => postdeployIdentityFixture({ promotionId: `promotion-postdeploy-identity-crash-${index}` }),
      write: (value) => writePostdeployIdentityEvidence(value.root, value.context, value.runtimeProbe),
      now: new Date("2026-08-15T01:44:00.000Z"),
      failpoints: [
        "AFTER_POSTDEPLOY_IDENTITY_RESULT", "AFTER_POSTDEPLOY_IDENTITY_HISTORY",
        "AFTER_POSTDEPLOY_IDENTITY_RECEIPT", "AFTER_POSTDEPLOY_IDENTITY_CURRENT",
      ],
    },
  ];
  for (const operation of operations) {
    for (const [index, failpoint] of operation.failpoints.entries()) {
      const fixtureValue = await operation.fixture(index);
      t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
      const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
      await operation.write(fixtureValue);
      await assert.rejects(
        run(fixtureValue.context, "execute", fixtureValue.root, {
          now: operation.now,
          fault: async (point) => { if (point === failpoint) throw new Error(`CRASH:${point}`); },
        }),
        new RegExp(`CRASH:${failpoint}`),
      );
      const recovery = postdeployRecoveryContext(
        fixtureValue.context, prepared.intent_sha256, `${operation.name}-${index}`,
      );
      const planned = await run(recovery, "recover-prepare", fixtureValue.root, { now: operation.now });
      assert.ok(["RESUME_PUBLICATION", "ALREADY_COMMITTED"].includes(planned.decision));
      const recovered = await run(recovery, "recover-execute", fixtureValue.root, { now: operation.now });
      assert.ok(["COMMITTED", "ALREADY_COMMITTED"].includes(recovered.result));
    }
  }
});

test("postdeploy control digest is durably bound before publication and mismatch can only quarantine", async (t) => {
  const operations = [
    {
      name: "runtime",
      fixture: () => postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-runtime-control-mismatch" }),
      write: (value) => writeRuntimeProbe(value.root, value.context, value.completion),
      now: new Date("2026-08-15T01:42:31.000Z"),
    },
    {
      name: "identity",
      fixture: () => postdeployIdentityFixture({ promotionId: "promotion-postdeploy-identity-control-mismatch" }),
      write: (value) => writePostdeployIdentityEvidence(value.root, value.context, value.runtimeProbe),
      now: new Date("2026-08-15T01:43:31.000Z"),
    },
  ];
  for (const operation of operations) {
    const fixtureValue = await operation.fixture();
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
    await operation.write(fixtureValue);
    const currentFile = physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE);
    const before = await readFile(currentFile);
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, {
        now: operation.now,
        expectedPostdeployResultSha256: digest(`${operation.name}-wrong-control-result`),
      }),
      (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_MISMATCH",
    );
    assert.deepEqual(await readFile(currentFile), before);
    assert.equal((await readdir(physical(
      fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/postdeploy-control-bindings`,
    ))).filter((name) => artifactMatches(name, fixtureValue.context.operation_id)).length, 1);
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, { now: operation.now }),
      (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONFLICT",
    );
    assert.deepEqual(await readFile(currentFile), before);
    assert.equal((await readdir(physical(
      fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/postdeploy-control-bindings`,
    ))).filter((name) => artifactMatches(name, fixtureValue.context.operation_id)).length, 1);
    const recovery = postdeployRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `${operation.name}-control-mismatch`,
    );
    assert.equal((await run(recovery, "recover-prepare", fixtureValue.root, {
      now: operation.now,
    })).decision, "QUARANTINE");
    assert.equal((await run(recovery, "recover-execute", fixtureValue.root, {
      now: operation.now,
    })).result, "QUARANTINED");
    assert.deepEqual(await readFile(currentFile), before);
  }
});

test("postdeploy external failure records containment without changing checkpoint 9 and missing evidence quarantines", async (t) => {
  const fixtureValue = await postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-contained" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root);
  const currentFile = physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE);
  const before = await readFile(currentFile);
  const contained = await run(fixtureValue.context, "contain", fixtureValue.root, {
    now: new Date("2026-08-15T01:42:40.000Z"),
    failureStage: "EXTERNAL_CONTROL",
    failureCode: "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
  });
  assert.equal(contained.result, "CONTAINED");
  assert.deepEqual(await readFile(currentFile), before);
  assert.equal((await readdir(physical(
    fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/containments`,
  ))).length, 1);

  const bypass = structuredClone(fixtureValue.context);
  bypass.operation_id = "promotion-postdeploy-contained-replacement";
  bypass.execution_authorization_id = bypass.operation_id;
  bypass.execution_authorization_sha256 = digest(`authorization-${bypass.operation_id}`);
  bypass.original_authorization_sha256 = bypass.execution_authorization_sha256;
  bypass.parameters.probe_id = bypass.operation_id;
  await assert.rejects(
    run(bypass, "prepare", fixtureValue.root),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_RECOVERY_REQUIRED",
  );

  const recovery = postdeployRecoveryContext(fixtureValue.context, prepared.intent_sha256, "missing");
  assert.equal((await run(recovery, "recover-prepare", fixtureValue.root, {
    now: new Date("2026-08-15T01:44:00.000Z"),
  })).decision, "QUARANTINE");
  assert.equal((await run(recovery, "recover-execute", fixtureValue.root, {
    now: new Date("2026-08-15T01:44:00.000Z"),
  })).result, "QUARANTINED");
  assert.deepEqual(await readFile(currentFile), before);
});

test("identity containment reports prepared receipt state as partial instead of absent", async (t) => {
  const fixtureValue = await postdeployIdentityFixture({ promotionId: "promotion-postdeploy-partial" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  await run(fixtureValue.context, "prepare", fixtureValue.root);
  await directory(fixtureValue.root, "/var/lib/chenyida-erp/postdeploy", 0o755);
  await directory(fixtureValue.root, fixtureValue.context.parameters.postdeploy_root, 0o750);
  await rawFile(
    fixtureValue.root,
    `${fixtureValue.context.parameters.postdeploy_root}/.${fixtureValue.context.parameters.run_id}.postdeploy-receipt.prepared.json`,
    "{}\n", 0o400,
  );
  await run(fixtureValue.context, "contain", fixtureValue.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
    failureStage: "EXTERNAL_CONTROL",
    failureCode: "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
  });
  const containmentDirectory = physical(
    fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/containments`,
  );
  const [name] = await readdir(containmentDirectory);
  const containment = JSON.parse(await readFile(path.join(containmentDirectory, name), "utf8"));
  assert.equal(containment.external_artifact_state, "UNTRUSTED_OR_PARTIAL");
});

test("identity containment detects a trusted prepared-publication temporary artifact", async (t) => {
  const fixtureValue = await postdeployIdentityFixture({ promotionId: "promotion-postdeploy-publish-temp" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  await run(fixtureValue.context, "prepare", fixtureValue.root);
  await directory(fixtureValue.root, "/var/lib/chenyida-erp/postdeploy", 0o755);
  await directory(fixtureValue.root, fixtureValue.context.parameters.postdeploy_root, 0o750);
  await rawFile(
    fixtureValue.root,
    `${fixtureValue.context.parameters.postdeploy_root}/.chenyida-erp-release-artifact-root-v1`,
    "chenyida-erp-release-artifact-root/v1\n", 0o440,
  );
  await rawFile(
    fixtureValue.root,
    `${fixtureValue.context.parameters.postdeploy_root}/.${fixtureValue.context.parameters.run_id}.postdeploy-receipt.prepared.json.1234.fixture.publish.tmp`,
    "{}\n", 0o400,
  );
  await run(fixtureValue.context, "contain", fixtureValue.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
    failureStage: "EXTERNAL_CONTROL",
    failureCode: "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
  });
  const containmentDirectory = physical(
    fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/containments`,
  );
  const [name] = await readdir(containmentDirectory);
  const containment = JSON.parse(await readFile(path.join(containmentDirectory, name), "utf8"));
  assert.equal(containment.external_artifact_state, "UNTRUSTED_OR_PARTIAL");
});

test("empty untrusted postdeploy roots are partial rather than absent", async (t) => {
  const runtime = await postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-untrusted-runtime-root" });
  t.after(() => rm(runtime.root, { recursive: true, force: true }));
  await run(runtime.context, "prepare", runtime.root);
  await directory(runtime.root, runtime.context.parameters.probe_root, 0o755);
  await run(runtime.context, "contain", runtime.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
    failureStage: "EXTERNAL_CONTROL",
    failureCode: "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
  });
  let [name] = await readdir(physical(runtime.root, `${UAT_PROMOTION_STATE_ROOT}/containments`));
  let containment = JSON.parse(await readFile(path.join(
    physical(runtime.root, `${UAT_PROMOTION_STATE_ROOT}/containments`), name,
  ), "utf8"));
  assert.equal(containment.external_artifact_state, "UNTRUSTED_OR_PARTIAL");

  const identity = await postdeployIdentityFixture({ promotionId: "promotion-postdeploy-untrusted-identity-root" });
  t.after(() => rm(identity.root, { recursive: true, force: true }));
  await run(identity.context, "prepare", identity.root);
  await directory(identity.root, "/var/lib/chenyida-erp/postdeploy", 0o755);
  await directory(identity.root, identity.context.parameters.postdeploy_root, 0o750);
  await run(identity.context, "contain", identity.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
    failureStage: "EXTERNAL_CONTROL",
    failureCode: "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
  });
  [name] = await readdir(physical(identity.root, `${UAT_PROMOTION_STATE_ROOT}/containments`));
  containment = JSON.parse(await readFile(path.join(
    physical(identity.root, `${UAT_PROMOTION_STATE_ROOT}/containments`), name,
  ), "utf8"));
  assert.equal(containment.external_artifact_state, "UNTRUSTED_OR_PARTIAL");
});

test("committed postdeploy response anomaly is durable and blocks the next checkpoint", async (t) => {
  const fixtureValue = await postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-committed-anomaly" });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  await run(fixtureValue.context, "prepare", fixtureValue.root);
  await writeRuntimeProbe(fixtureValue.root, fixtureValue.context, fixtureValue.completion);
  await run(fixtureValue.context, "execute", fixtureValue.root, {
    now: new Date("2026-08-15T01:43:31.000Z"),
  });
  const recorded = await run(fixtureValue.context, "contain", fixtureValue.root, {
    now: new Date("2026-08-15T01:43:32.000Z"),
    failureStage: "RESULT_CROSSCHECK",
    failureCode: "UAT_PROMOTION_POSTDEPLOY_RESULT_CROSSCHECK_FAILED",
  });
  assert.equal(recorded.result, "COMMITTED_ANOMALY_RECORDED");
  const [name] = await readdir(physical(fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/containments`));
  const containment = JSON.parse(await readFile(path.join(
    physical(fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/containments`), name,
  ), "utf8"));
  assert.equal(containment.status, "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY");
  assert.equal(containment.observed_checkpoint_ordinal, 10);
  const next = structuredClone(fixtureValue.context);
  next.operation_id = "promotion-postdeploy-after-anomaly";
  next.execution_authorization_id = next.operation_id;
  next.execution_authorization_sha256 = digest(`authorization-${next.operation_id}`);
  next.original_authorization_sha256 = next.execution_authorization_sha256;
  next.parameters.probe_id = next.operation_id;
  await assert.rejects(
    run(next, "prepare", fixtureValue.root),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_ANOMALY_REQUIRES_REVIEW",
  );
});

test("linked postdeploy intent and cross-operation identity receipt are preserved and rejected", async (t) => {
  const linked = await postdeployRuntimeFixture({ promotionId: "promotion-postdeploy-linked-intent" });
  t.after(() => rm(linked.root, { recursive: true, force: true }));
  const linkedPrepared = await run(linked.context, "prepare", linked.root);
  const storedIntent = await intentPath(linked.root, linked.context.operation_id);
  const outside = path.join(linked.root, "postdeploy-linked-intent-source.json");
  await rename(storedIntent, outside);
  await link(outside, storedIntent);
  const linkedRecovery = postdeployRecoveryContext(linked.context, linkedPrepared.intent_sha256, "linked");
  assert.equal((await run(linkedRecovery, "recover-prepare", linked.root, {
    now: new Date("2026-08-15T01:44:00.000Z"),
  })).decision, "QUARANTINE");

  const crossOperation = await postdeployIdentityFixture({ promotionId: "promotion-postdeploy-cross-auth" });
  t.after(() => rm(crossOperation.root, { recursive: true, force: true }));
  const originalRuntimeIntentPath = await intentPath(
    crossOperation.root, crossOperation.runtimeContext.operation_id,
  );
  const forgedRuntimeIntent = JSON.parse(await readFile(originalRuntimeIntentPath, "utf8"));
  forgedRuntimeIntent.promotion_id = "different-promotion";
  forgedRuntimeIntent.parameters.promotion_id = "different-promotion";
  const forgedParameters = forgedRuntimeIntent.parameters;
  forgedRuntimeIntent.verification_plan_sha256 = clusterSha256({
    operation: "POSTDEPLOY_RUNTIME_CONFIGURATION",
    promotion_id: forgedParameters.promotion_id,
    promotion_generation: forgedParameters.promotion_generation,
    previous_checkpoint_receipt_sha256: forgedParameters.previous_checkpoint_receipt_sha256,
    deployment_operation_id: forgedParameters.deployment_operation_id,
    deployment_result_sha256: forgedParameters.deployment_result_sha256,
    fence_transfer_sha256: forgedParameters.fence_transfer_sha256,
    compose_deployment_binding_sha256: forgedParameters.compose_deployment_binding_sha256,
    release_manifest_sha256: forgedParameters.release_manifest_sha256,
    compose_project_root_sha256: createHash("sha256").update(forgedParameters.compose_project_root).digest("hex"),
    runtime_policy_sha256: forgedParameters.runtime_policy_sha256,
    selectors: {
      caddy: forgedParameters.caddy_container,
      postgres: forgedParameters.postgres_container,
      web: forgedParameters.web_container,
      worker: forgedParameters.worker_container,
    },
    probe_id: forgedParameters.probe_id,
    probe_path: `${forgedParameters.probe_root}/${forgedParameters.probe_id}.runtime-configuration-probe.json`,
    runtime_configuration_sha256: forgedRuntimeIntent.runtime_configuration_sha256,
  });
  delete forgedRuntimeIntent.postdeploy_runtime_intent_sha256;
  forgedRuntimeIntent.postdeploy_runtime_intent_sha256 = clusterSha256(forgedRuntimeIntent);
  const forgedRuntimeIntentLogical = `${UAT_PROMOTION_STATE_ROOT}/intents/${crossOperation.runtimeContext.operation_id}.${forgedRuntimeIntent.postdeploy_runtime_intent_sha256}.json`;
  await canonicalFile(crossOperation.root, forgedRuntimeIntentLogical, forgedRuntimeIntent, 0o400);
  const crossedRuntime = structuredClone(crossOperation.context);
  crossedRuntime.parameters.runtime_probe_intent_sha256 = forgedRuntimeIntent.postdeploy_runtime_intent_sha256;
  crossedRuntime.parameters.runtime_probe_intent_source = await source(
    crossOperation.root, forgedRuntimeIntentLogical,
  );
  await assert.rejects(
    run(crossedRuntime, "prepare", crossOperation.root),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_BINDING_INVALID",
  );
  await run(crossOperation.context, "prepare", crossOperation.root);
  const identityBypass = structuredClone(crossOperation.context);
  identityBypass.operation_id = "promotion-postdeploy-cross-auth-replacement";
  identityBypass.execution_authorization_id = identityBypass.operation_id;
  identityBypass.execution_authorization_sha256 = digest(`authorization-${identityBypass.operation_id}`);
  identityBypass.original_authorization_sha256 = identityBypass.execution_authorization_sha256;
  identityBypass.parameters.run_id = identityBypass.operation_id;
  identityBypass.parameters.postdeploy_root = `/var/lib/chenyida-erp/postdeploy/${identityBypass.operation_id}`;
  await assert.rejects(
    run(identityBypass, "prepare", crossOperation.root),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_RECOVERY_REQUIRED",
  );
  await writePostdeployIdentityEvidence(
    crossOperation.root, crossOperation.context, crossOperation.runtimeProbe, (receipt) => ({
      ...structuredClone(receipt),
      control: {
        ...receipt.control,
        authorization_sha256: crossOperation.runtimeContext.original_authorization_sha256,
      },
    }),
  );
  await assert.rejects(
    run(crossOperation.context, "execute", crossOperation.root, { now: new Date("2026-08-15T01:43:31.000Z") }),
    (error) => error.code === "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RESULT_BINDING_INVALID",
  );
});

test("cross-role evidence is durably ingested as checkpoint 12 without publishing final receipt", async (t) => {
  const fixtureValue = await crossRoleFixture();
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root, {
    now: new Date("2026-08-15T01:48:31.000Z"),
  });
  assert.equal(prepared.result, "PREPARED");
  assert.equal(prepared.cross_role_result_sha256, fixtureValue.result.result_sha256);
  assert.equal((await run(fixtureValue.context, "prepare", fixtureValue.root, {
    now: new Date("2026-08-15T01:48:31.000Z"),
  })).result, "ALREADY_PREPARED");
  const committed = await run(fixtureValue.context, "execute", fixtureValue.root, {
    now: new Date("2026-08-15T01:48:32.000Z"),
  });
  assert.equal(committed.result, "COMMITTED");
  assert.equal(committed.cross_role_result_sha256, fixtureValue.result.result_sha256);
  assert.equal(committed.evidence_subject_sha256, fixtureValue.result.evidence_subject_sha256);
  assert.equal(
    committed.approval_subject_sha256,
    fixtureValue.result.approval.approval_subject_sha256,
  );
  const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
    physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
  )));
  assert.equal(current.checkpoint_id, "CROSS_ROLE_UAT_EXECUTION");
  assert.equal(current.checkpoint_ordinal, 12);
  assert.equal(current.journal_status, "IN_PROGRESS");
  assert.equal(current.checkpoint_evidence_sha256, fixtureValue.result.result_sha256);
  assert.equal(current.checkpoint_authorization_sha256, fixtureValue.context.original_authorization_sha256);
  assert.equal(current.authorization_sha256_chain.includes(
    fixtureValue.result.human_execution_authorization_sha256,
  ), false);
  const internalResult = physical(
    fixtureValue.root,
    `${UAT_PROMOTION_STATE_ROOT}/results/${fixtureValue.context.operation_id}.${fixtureValue.result.result_sha256}.json`,
  );
  assert.equal((await lstat(internalResult)).mode & 0o7777, 0o400);
  assert.equal(await readFile(internalResult, "utf8"), canonicalUatPromotionCrossRoleResultJson(
    fixtureValue.result,
  ));
});

test("cross-role human execution approval cannot be conflated with Supervisor ingest authorization", async (t) => {
  const fixtureValue = await crossRoleFixture({
    promotionId: "promotion-cross-role-auth-split",
    conflateHumanAndIngestAuthorization: true,
  });
  t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
  await assert.rejects(
    run(fixtureValue.context, "prepare", fixtureValue.root, {
      now: new Date("2026-08-15T01:48:31.000Z"),
    }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_RESULT_BINDING_INVALID",
  );
});

test("cross-role result root marker, one-link source and post-prepare source identity fail closed", async (t) => {
  const linked = await crossRoleFixture({ promotionId: "promotion-cross-role-linked-result" });
  t.after(() => rm(linked.root, { recursive: true, force: true }));
  await link(physical(linked.root, linked.resultLogical), path.join(linked.root, "linked-cross-role-result.json"));
  await assert.rejects(
    run(linked.context, "prepare", linked.root, { now: new Date("2026-08-15T01:48:31.000Z") }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_RESULT_SOURCE_INVALID",
  );

  const marker = await crossRoleFixture({ promotionId: "promotion-cross-role-marker" });
  t.after(() => rm(marker.root, { recursive: true, force: true }));
  await writeFile(physical(
    marker.root,
    `${UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT}/.chenyida-erp-uat-cross-role-results-v1`,
  ), "wrong-marker\n");
  await assert.rejects(
    run(marker.context, "prepare", marker.root, { now: new Date("2026-08-15T01:48:31.000Z") }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_RESULT_SOURCE_INVALID",
  );

  const replaced = await crossRoleFixture({ promotionId: "promotion-cross-role-replaced-result" });
  t.after(() => rm(replaced.root, { recursive: true, force: true }));
  const prepared = await run(replaced.context, "prepare", replaced.root, {
    now: new Date("2026-08-15T01:48:31.000Z"),
  });
  await writeFile(physical(replaced.root, replaced.resultLogical), "{}\n");
  await assert.rejects(
    run(replaced.context, "execute", replaced.root, {
      now: new Date("2026-08-15T01:48:32.000Z"),
    }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_RESULT_SOURCE_INVALID",
  );
  const recovery = crossRoleRecoveryContext(replaced.context, prepared.intent_sha256, "replaced");
  assert.equal((await run(recovery, "recover-prepare", replaced.root, {
    now: new Date("2026-08-15T01:48:41.000Z"),
  })).decision, "QUARANTINE");
  assert.equal((await run(recovery, "recover-execute", replaced.root, {
    now: new Date("2026-08-15T01:48:42.000Z"),
  })).result, "QUARANTINED");
});

test("cross-role publication crash recovery resumes journal only and never reruns human UAT", async (t) => {
  const cases = [
    ["AFTER_CROSS_ROLE_RESULT", "RESUME_PUBLICATION", "REMOVE_EXTERNAL"],
    ["AFTER_CROSS_ROLE_HISTORY", "RESUME_PUBLICATION", "REPLACE_EXTERNAL"],
    ["AFTER_CROSS_ROLE_RECEIPT", "RESUME_PUBLICATION", null],
    ["AFTER_CROSS_ROLE_CURRENT", "ALREADY_COMMITTED", null],
  ];
  for (const [index, [failpoint, expectedDecision, externalMutation]] of cases.entries()) {
    const fixtureValue = await crossRoleFixture({
      promotionId: `promotion-cross-role-crash-${index}`,
    });
    t.after(() => rm(fixtureValue.root, { recursive: true, force: true }));
    const prepared = await run(fixtureValue.context, "prepare", fixtureValue.root, {
      now: new Date("2026-08-15T01:48:31.000Z"),
    });
    await assert.rejects(
      run(fixtureValue.context, "execute", fixtureValue.root, {
        now: new Date("2026-08-15T01:48:32.000Z"),
        fault: async (stage) => {
          if (stage === failpoint) throw new Error(`injected:${stage}`);
        },
      }),
      new RegExp(`injected:${failpoint}`),
    );
    const externalResult = physical(fixtureValue.root, fixtureValue.resultLogical);
    if (externalMutation === "REMOVE_EXTERNAL") await rm(externalResult);
    if (externalMutation === "REPLACE_EXTERNAL") await writeFile(externalResult, "{}\n");
    const recovery = crossRoleRecoveryContext(
      fixtureValue.context, prepared.intent_sha256, `recovery-${index}`,
    );
    const recoveryPrepared = await run(recovery, "recover-prepare", fixtureValue.root, {
      now: new Date("2026-08-15T02:00:00.000Z"),
    });
    assert.equal(recoveryPrepared.decision, expectedDecision);
    const recovered = await run(recovery, "recover-execute", fixtureValue.root, {
      now: new Date("2026-08-15T02:00:01.000Z"),
    });
    assert.equal(
      recovered.result,
      expectedDecision === "ALREADY_COMMITTED" ? "ALREADY_COMMITTED" : "COMMITTED",
    );
    const current = validateUatPromotionCheckpointReceipt(JSON.parse(await readFile(
      physical(fixtureValue.root, UAT_PROMOTION_CURRENT_FILE), "utf8",
    )));
    assert.equal(current.checkpoint_id, "CROSS_ROLE_UAT_EXECUTION");
    assert.equal(current.checkpoint_evidence_sha256, fixtureValue.result.result_sha256);
    assert.equal((await readdir(physical(
      fixtureValue.root, `${UAT_PROMOTION_STATE_ROOT}/results`,
    ))).filter((name) => artifactMatches(name, fixtureValue.context.operation_id)).length, 1);
  }
});

test("fake root requires an explicit test-only option and a symlinked state root fails closed", async (t) => {
  const first = await fixture({ promotionId: "promotion-explicit-root" });
  t.after(() => rm(first.root, { recursive: true, force: true }));
  await assert.rejects(runUatPromotionTransactionPhase(first.context, "prepare", { filesystemRoot: first.root, siteRoot }), (error) => error.code === "UAT_PROMOTION_TEST_ROOT_NOT_EXPLICIT");

  const second = await fixture({ promotionId: "promotion-symlink-root" });
  t.after(() => rm(second.root, { recursive: true, force: true }));
  const target = path.join(second.root, "state-target");
  await mkdir(target, { mode: 0o700 });
  await symlink(target, physical(second.root, UAT_PROMOTION_STATE_ROOT));
  await assert.rejects(run(second.context, "prepare", second.root), (error) => error.code === "UAT_PROMOTION_STATE_ROOT_INVALID");
});
