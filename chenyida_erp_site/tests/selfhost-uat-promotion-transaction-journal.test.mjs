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
import {
  UAT_PROMOTION_CURRENT_FILE,
  UAT_PROMOTION_POLICY_FILE_SHA256,
  UAT_PROMOTION_POLICY_SHA256,
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

function digest(label) { return createHash("sha256").update(label).digest("hex"); }
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

async function run(context, phase, root, options = {}) {
  return runUatPromotionTransactionPhase(context, phase, { filesystemRoot: root, siteRoot, allowTestRoot: true, ...options });
}

async function intentPath(root, promotionId) {
  const directoryPath = physical(root, `${UAT_PROMOTION_STATE_ROOT}/intents`);
  const [name] = (await readdir(directoryPath)).filter((entry) => entry.startsWith(`${promotionId}.`));
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
  });
  assert.throws(() => createNextUatPromotionCheckpointReceipt(quiesce, {
    ...base,
    checkpoint_id: "ONE_TIME_MIGRATION_AUTHORIZATION",
    recorded_at: "2026-08-15T01:12:00.000Z",
    checkpoint_authorization_sha256: digest("snapshot-authorization"),
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
