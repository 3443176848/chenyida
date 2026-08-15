import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
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
const webImage = `127.0.0.1:5000/chenyida-erp/web@sha256:${"c".repeat(64)}`;
const workerImage = `127.0.0.1:5000/chenyida-erp/worker@sha256:${"d".repeat(64)}`;
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
      dockerfile_sha256: digest("dockerfile"), compose_path: "chenyida_erp_site/compose.yml", compose_sha256: digest("compose"),
      release_compose_path: "chenyida_erp_site/compose.release.yml", release_compose_sha256: digest("release-compose"),
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

async function run(context, phase, root, options = {}) {
  return runUatPromotionTransactionPhase(context, phase, { filesystemRoot: root, siteRoot, allowTestRoot: true, ...options });
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
