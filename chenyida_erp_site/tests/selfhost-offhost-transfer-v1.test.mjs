import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createManifest,
  createReconciliation,
  migrationManifest,
  sha256File,
  verifyLocalBackup,
  verifyOffhostChain,
} from "../scripts/backup-recovery-contract.mjs";
import {
  KEY_ROOT_MARKER,
  KEY_ROOT_MARKER_VALUE,
  OFFHOST_MATERIALIZATION_ROOT_MARKER,
  OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE,
  OUTBOX_ROOT_MARKER,
  OUTBOX_ROOT_MARKER_VALUE,
  RECEIVER_ROOT_MARKER,
  RECEIVER_ROOT_MARKER_VALUE,
  acceptOffhostTransferReceipt,
  canonicalTransferJson,
  cleanupMaterializedOffhostTransfer,
  materializeOffhostTransferForRestore,
  receiveOffhostTransfer,
  sealOffhostTransfer,
  validateTransferAcceptance,
  validateTransferEnvelope,
  validateTransferReceipt,
} from "../scripts/offhost-transfer-contract.mjs";
import {
  BACKUP_OPERATIONS_ROOT_MARKER,
  BACKUP_OPERATIONS_ROOT_MARKER_VALUE,
  assertBackupOperationsKeyApproved,
  assertBackupOperationsPolicyMatchesEnvelope,
  backupOperationsPolicySha256,
  buildSuccessfulBackupOperationsEvent,
  evaluateBackupSchedule,
  initialBackupOperationsState,
  planBackupRetention,
  readBackupOperationsStateFile,
  transitionAndWriteBackupOperationsState,
  transitionBackupOperationsState,
  validateBackupOperationsPolicy,
  validateBackupOperationsState,
} from "../scripts/backup-operations-policy.mjs";
import {
  BACKUP_RECOVERY_SYNTHETIC_RESULT,
  createBackupRecoveryReadiness,
  publishBackupRecoveryReadiness,
  validateBackupRecoveryReadiness,
} from "../scripts/backup-recovery-readiness-v3.mjs";

const createdAt = "2026-08-13T01:00:00.000Z";
const sealedAt = "2026-08-13T01:05:00.000Z";
const receivedAt = "2026-08-13T01:10:00.000Z";
const acceptedAt = "2026-08-13T01:11:00.000Z";
const hash = "a".repeat(64);
const databaseProfile = {
  databaseServerMajor: "17",
  databaseEncoding: "UTF8",
  databaseCollate: "C",
  databaseCtype: "C",
  databaseLocaleProvider: "libc",
  databaseCollationVersion: "NONE",
};

function operationsPolicyFor(envelope) {
  const key = (fingerprint) => ({ fingerprint, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: "2027-01-01T00:00:00.000Z" });
  return validateBackupOperationsPolicy({
    schema_version: 1,
    contract: "chenyida-erp-backup-operations-policy/v1",
    policy_id: "synthetic-offhost-daily-v1",
    scope: "SYNTHETIC_TEST_ONLY",
    source_location_id: envelope.source.location_id,
    receiver_location_id: envelope.receiver.location_id,
    inner_policy_id: envelope.inner.policy_id,
    schedule_anchor_at: "2026-08-01T00:00:00.000Z",
    cadence_minutes: 1440,
    rpo_minutes: 1440,
    grace_minutes: 60,
    max_run_minutes: 180,
    max_clock_skew_seconds: 60,
    retention_days: 30,
    min_verified_generations: 2,
    min_restore_verified_generations: 1,
    key_allowlist: {
      source_signing: [key(envelope.source.signing_key_fingerprint)],
      receiver_encryption: [key(envelope.receiver.encryption_key_fingerprint)],
      receiver_receipt: [key(envelope.receiver.receipt_key_fingerprint)],
    },
  });
}

function event(type, attemptId, boot = "1".repeat(64), owner = "2".repeat(64)) {
  return {
    type,
    attempt_id: attemptId,
    boot_id_sha256: boot,
    owner_identity_sha256: owner,
    transfer_id: null,
    backup_id: null,
    recovery_point_at: null,
    expires_at: null,
    envelope_sha256: null,
    receiver_receipt_sha256: null,
    acceptance_sha256: null,
    offhost_status: null,
    acceptance_status: null,
  };
}

process.env.NODE_ENV = "test";

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${path.basename(binary)} failed: ${result.stderr}`);
  return result;
}

async function executable(file, source) {
  await writeFile(file, source, { mode: 0o700 });
  await chmod(file, 0o700);
}

async function markerRoot(parent, name, marker, value, mode = 0o700) {
  const root = path.join(parent, name);
  await mkdir(root, { mode });
  await chmod(root, mode);
  await writeFile(path.join(root, marker), value, { mode: 0o400 });
  await chmod(path.join(root, marker), 0o400);
  return root;
}

async function machineFile(root, name, character) {
  const file = path.join(root, name);
  await writeFile(file, `${character.repeat(32)}\n`, { mode: 0o400 });
  await chmod(file, 0o400);
  return file;
}

async function keyFile(root, name, key, type) {
  const file = path.join(root, name);
  const source = key.export({ format: "pem", type });
  await writeFile(file, source, { mode: 0o400 });
  await chmod(file, 0o400);
  return file;
}

async function temporary(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-offhost-v1-"));
  try {
    await chmod(root, 0o700);
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function treeContainsBytes(root, needle) {
  for (const name of await readdir(root, { recursive: true })) {
    const file = path.join(root, name);
    const metadata = await stat(file);
    if (metadata.isFile() && metadata.size <= 16 * 1024 * 1024 && (await readFile(file)).includes(Buffer.from(needle))) return true;
  }
  return false;
}

async function fakePgRestore(root) {
  const bin = path.join(root, "fake-pg");
  await mkdir(bin, { mode: 0o700 });
  await executable(path.join(bin, "pg_restore"), '#!/bin/sh\ncase "$*" in *--list*) printf "synthetic dump list\\n" ;; *) exit 1 ;; esac\n');
  return `${bin}:${process.env.PATH}`;
}

async function fixture(root, backupId = "backup-test") {
  const sourceRoot = path.join(root, "source");
  const migrations = path.join(root, "migrations");
  const backup = path.join(sourceRoot, backupId);
  const report = path.join(root, "database-report.txt");
  await mkdir(sourceRoot, { mode: 0o700 });
  await mkdir(migrations, { mode: 0o700 });
  await mkdir(backup, { mode: 0o700 });
  await writeFile(path.join(migrations, "0001_test.sql"), "select 1;\n", { mode: 0o600 });
  await writeFile(report, `LARGE_OBJECTS\t0\t0\t${hash}\n`, { mode: 0o600 });
  const migration = await migrationManifest(migrations);
  await writeFile(path.join(backup, "migrations.txt"), migration.text, { mode: 0o600 });
  await writeFile(path.join(backup, "postgresql.dump"), "synthetic-postgresql-dump", { mode: 0o600 });
  const sources = {};
  for (const [key, archive] of [["uploads", "uploads.tar.gz"], ["attachments", "attachments.tar.gz"], ["backup_status", "backup-status.tar.gz"]]) {
    const source = path.join(root, `${key}-source`);
    sources[key] = source;
    await mkdir(source, { mode: 0o700 });
    await writeFile(path.join(source, `${key}.txt`), key, { mode: 0o600 });
    if (key === "backup_status") {
      await writeFile(path.join(source, ".chenyida-erp-receipt-root-v2"), "chenyida-erp-receipt-root/v2\n", { mode: 0o400 });
      await chmod(path.join(source, ".chenyida-erp-receipt-root-v2"), 0o400);
    }
    run("tar", ["-C", source, "-czf", path.join(backup, archive), "."]);
    await chmod(path.join(backup, archive), 0o600);
  }
  await createReconciliation({
    backupDirectory: backup,
    databaseReportFile: report,
    uploadsDirectory: sources.uploads,
    attachmentsDirectory: sources.attachments,
    backupStatusDirectory: sources.backup_status,
  });
  const created = Date.parse(createdAt);
  await createManifest({
    backupDirectory: backup,
    migrationsDirectory: migrations,
    backupId,
    createdAt,
    deploymentClass: "TEST",
    deploymentId: "erp-test-source",
    databaseName: "source_test",
    databaseSystemIdentifier: "7612345678901234567",
    databaseOid: "16384",
    databaseMarker: "TEST.erp-test-source",
    databaseBytes: 8192,
    ...databaseProfile,
    applicationVersion: "0.1.0-alpha.46",
    gitCommit: "b".repeat(40),
    webImageDigest: `sha256:${"c".repeat(64)}`,
    workerImageDigest: `sha256:${"d".repeat(64)}`,
    policyId: "daily-rpo-v1",
    rpoHours: 24,
    webContainer: "web-test",
    webContainerId: "e".repeat(64),
    workerContainer: "worker-test",
    workerContainerId: "f".repeat(64),
    recoveryPointAt: new Date(created - 120_000).toISOString(),
    consistencyVerifiedAfter: new Date(created - 60_000).toISOString(),
    entries: { uploads: 1, attachments: 1, backup_status: 2 },
  });
  for (const name of await readdir(backup)) await chmod(path.join(backup, name), 0o600);
  const sourceMachineIdentityFile = await machineFile(root, "source-machine-id", "1");
  const receiverMachineIdentityFile = await machineFile(root, "receiver-machine-id", "2");
  const local = await verifyLocalBackup({
    backupDirectory: backup,
    migrationsDirectory: migrations,
    sourceRoot,
    machineIdentityFile: sourceMachineIdentityFile,
    locationId: "source-host",
    now: sealedAt,
    expectedDeploymentClass: "TEST",
    expectedDeploymentId: "erp-test-source",
    expectedDatabaseName: "source_test",
    expectedDatabaseSystemIdentifier: "7612345678901234567",
    expectedDatabaseOid: "16384",
    expectedDatabaseMarker: "TEST.erp-test-source",
    expectedDatabaseBytes: 8192,
    expectedDatabaseServerMajor: "17",
    expectedDatabaseEncoding: "UTF8",
    expectedDatabaseCollate: "C",
    expectedDatabaseCtype: "C",
    expectedDatabaseLocaleProvider: "libc",
    expectedDatabaseCollationVersion: "NONE",
    expectedApplicationVersion: "0.1.0-alpha.46",
    expectedGitCommit: "b".repeat(40),
    expectedWebImageDigest: `sha256:${"c".repeat(64)}`,
    expectedWorkerImageDigest: `sha256:${"d".repeat(64)}`,
    expectedMigrationHead: "0001_test.sql",
    expectedPolicyId: "daily-rpo-v1",
    expectedRpoHours: 24,
  });
  const localReceiptFile = path.join(sourceRoot, `${backupId}.local.json`);
  await writeFile(localReceiptFile, `${JSON.stringify(local)}\n`, { mode: 0o600 });
  await chmod(localReceiptFile, 0o600);
  return { root, sourceRoot, migrations, backup, backupId, localReceiptFile, sourceMachineIdentityFile, receiverMachineIdentityFile };
}

async function keys(root) {
  const sourceSigning = generateKeyPairSync("ed25519");
  const receiverEncryption = generateKeyPairSync("x25519");
  const receiverReceipt = generateKeyPairSync("ed25519");
  const sourceKeyRoot = await markerRoot(root, "source-keys", KEY_ROOT_MARKER, KEY_ROOT_MARKER_VALUE);
  const receiverKeyRoot = await markerRoot(root, "receiver-keys", KEY_ROOT_MARKER, KEY_ROOT_MARKER_VALUE);
  const files = {
    sourceKeyRoot,
    receiverKeyRoot,
    sourceSigningPrivateKey: await keyFile(sourceKeyRoot, "source-signing-private.pem", sourceSigning.privateKey, "pkcs8"),
    sourceSigningPublicAtReceiver: await keyFile(receiverKeyRoot, "source-signing-public.pem", sourceSigning.publicKey, "spki"),
    receiverEncryptionPublicAtSource: await keyFile(sourceKeyRoot, "receiver-encryption-public.pem", receiverEncryption.publicKey, "spki"),
    receiverEncryptionPrivateKey: await keyFile(receiverKeyRoot, "receiver-encryption-private.pem", receiverEncryption.privateKey, "pkcs8"),
    receiverReceiptPublicAtSource: await keyFile(sourceKeyRoot, "receiver-receipt-public.pem", receiverReceipt.publicKey, "spki"),
    receiverReceiptPrivateKey: await keyFile(receiverKeyRoot, "receiver-receipt-private.pem", receiverReceipt.privateKey, "pkcs8"),
    receiverReceiptPublicAtReceiver: await keyFile(receiverKeyRoot, "receiver-receipt-public.pem", receiverReceipt.publicKey, "spki"),
  };
  return files;
}

async function roots(root) {
  return {
    outboxRoot: await markerRoot(root, "outbox", OUTBOX_ROOT_MARKER, OUTBOX_ROOT_MARKER_VALUE),
    receiverRoot: await markerRoot(root, "receiver", RECEIVER_ROOT_MARKER, RECEIVER_ROOT_MARKER_VALUE),
    materializationRoot: await markerRoot(root, "materialized", OFFHOST_MATERIALIZATION_ROOT_MARKER, OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE),
    readinessRoot: await markerRoot(root, "readiness", ".chenyida-erp-receipt-root-v2", "chenyida-erp-receipt-root/v2\n", 0o2750),
  };
}

async function sealOptions(built, keySet, rootSet, extra = {}) {
  return {
    backupDirectory: built.backup,
    localReceiptFile: built.localReceiptFile,
    outboxRoot: rootSet.outboxRoot,
    sourceKeyRoot: keySet.sourceKeyRoot,
    sourceSigningPrivateKey: keySet.sourceSigningPrivateKey,
    receiverEncryptionPublicKey: keySet.receiverEncryptionPublicAtSource,
    receiverReceiptPublicKey: keySet.receiverReceiptPublicAtSource,
    transferId: "transfer-one",
    receiverLocationId: "offhost-a",
    createdAt: sealedAt,
    now: sealedAt,
    ...extra,
  };
}

function receiveOptions(built, keySet, rootSet, incomingPackageDirectory, extra = {}) {
  return {
    incomingPackageDirectory,
    receiverRoot: rootSet.receiverRoot,
    receiverKeyRoot: keySet.receiverKeyRoot,
    receiverEncryptionPrivateKey: keySet.receiverEncryptionPrivateKey,
    trustedSourceSigningPublicKey: keySet.sourceSigningPublicAtReceiver,
    receiverReceiptPrivateKey: keySet.receiverReceiptPrivateKey,
    migrationsDirectory: built.migrations,
    receiverLocationId: "offhost-a",
    retentionPolicyId: "synthetic-retention-v1",
    machineIdentityFile: built.receiverMachineIdentityFile,
    now: receivedAt,
    ...extra,
  };
}

test("signed encrypted transfer, receiver acknowledgement, and transient restore materialization form one chain", async () => temporary(async (root) => {
  const previousPath = process.env.PATH;
  process.env.PATH = await fakePgRestore(root);
  try {
    const built = await fixture(root), keySet = await keys(root), rootSet = await roots(root);
    const sealed = await sealOffhostTransfer(await sealOptions(built, keySet, rootSet));
    const operationsPolicy = operationsPolicyFor(sealed.envelope);
    assert.equal(sealed.envelope.inner.deployment_class, "TEST");
    assert.equal(sealed.envelope.inner.deployment_id, "erp-test-source");
    assert.throws(() => assertBackupOperationsPolicyMatchesEnvelope({ ...operationsPolicy, scope: "UAT" }, sealed.envelope), /BACKUP_POLICY_SCOPE_MISMATCH/);
    assert.equal(validateTransferEnvelope(sealed.envelope).value.status, "SEALED");
    assert.equal((await readdir(sealed.packageDirectory)).sort().join(","), "envelope.json,payload.enc");
    assert.equal((await readFile(sealed.payloadFile)).includes(Buffer.from("synthetic-postgresql-dump")), false);
    const received = await receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, sealed.packageDirectory, { policy: operationsPolicy }));
    assert.equal(validateTransferReceipt(received.receiverReceipt).status, "OFFHOST_VERIFIED");
    assert.deepEqual((await readdir(received.packageDirectory)).sort(), ["envelope.json", "offhost-receipt.json", "payload.enc", "receiver-receipt.json"]);
    assert.equal((await readdir(rootSet.receiverRoot)).some((name) => name.startsWith(".plaintext")), false);
    const accepted = await acceptOffhostTransferReceipt({
      sourcePackageDirectory: sealed.packageDirectory,
      receiverReceiptFile: received.receiverReceiptFile,
      sourceKeyRoot: keySet.sourceKeyRoot,
      sourceSigningPrivateKey: keySet.sourceSigningPrivateKey,
      receiverReceiptPublicKey: keySet.receiverReceiptPublicAtSource,
      acceptedAt,
      now: acceptedAt,
      policy: operationsPolicy,
    });
    assert.equal(validateTransferAcceptance(accepted.acceptance).status, "RECEIVER_RECEIPT_ACCEPTED");
    const initialOperations = initialBackupOperationsState(operationsPolicy);
    const runningOperations = transitionBackupOperationsState({ policy: operationsPolicy, previousState: initialOperations, event: event("START", "attempt-one"), now: receivedAt });
    const successfulEvent = await buildSuccessfulBackupOperationsEvent({
      policy: operationsPolicy,
      receiverPackageDirectory: received.packageDirectory,
      acceptanceFile: accepted.acceptanceFile,
      receiverKeyRoot: keySet.receiverKeyRoot,
      receiverEncryptionPrivateKey: keySet.receiverEncryptionPrivateKey,
      trustedSourceSigningPublicKey: keySet.sourceSigningPublicAtReceiver,
      receiverReceiptPublicKey: keySet.receiverReceiptPublicAtReceiver,
      attemptId: "attempt-one",
      bootIdSha256: "1".repeat(64),
      ownerIdentitySha256: "2".repeat(64),
      now: acceptedAt,
    });
    assert.throws(() => transitionBackupOperationsState({ policy: operationsPolicy, previousState: runningOperations, event: { ...successfulEvent }, now: acceptedAt }), /BACKUP_SUCCESS_EVIDENCE_NOT_VERIFIED/);
    const completedOperations = transitionBackupOperationsState({ policy: operationsPolicy, previousState: runningOperations, event: successfulEvent, now: acceptedAt });
    assert.equal(completedOperations.last_attempt_status, "SUCCEEDED");
    assert.equal(completedOperations.last_success_transfer_id, "transfer-one");
    assert.deepEqual(completedOperations.consumed_transfer_ids, ["transfer-one"]);
    assert.equal(evaluateBackupSchedule({ policy: operationsPolicy, state: completedOperations, now: acceptedAt, globalLockStatus: "AVAILABLE", bootIdSha256: "1".repeat(64) }).rpo_status, "WITHIN_RPO");
    const materialized = await materializeOffhostTransferForRestore({
      receiverPackageDirectory: received.packageDirectory,
      acceptanceFile: accepted.acceptanceFile,
      receiverKeyRoot: keySet.receiverKeyRoot,
      receiverEncryptionPrivateKey: keySet.receiverEncryptionPrivateKey,
      trustedSourceSigningPublicKey: keySet.sourceSigningPublicAtReceiver,
      receiverReceiptPublicKey: keySet.receiverReceiptPublicAtReceiver,
      destinationRoot: rootSet.materializationRoot,
      transferId: "transfer-one",
      backupId: built.backupId,
      policy: operationsPolicy,
    });
    const chain = await verifyOffhostChain({
      backupDirectory: materialized.backupDirectory,
      migrationsDirectory: built.migrations,
      offhostReceiptFile: materialized.offhostReceiptFile,
      now: receivedAt,
      expectedDeploymentClass: "TEST",
      expectedDeploymentId: "erp-test-source",
      expectedDatabaseName: "source_test",
      expectedDatabaseSystemIdentifier: "7612345678901234567",
      expectedDatabaseOid: "16384",
      expectedDatabaseMarker: "TEST.erp-test-source",
      expectedDatabaseBytes: 8192,
      expectedDatabaseServerMajor: "17",
      expectedDatabaseEncoding: "UTF8",
      expectedDatabaseCollate: "C",
      expectedDatabaseCtype: "C",
      expectedDatabaseLocaleProvider: "libc",
      expectedDatabaseCollationVersion: "NONE",
      expectedApplicationVersion: "0.1.0-alpha.46",
      expectedGitCommit: "b".repeat(40),
      expectedWebImageDigest: `sha256:${"c".repeat(64)}`,
      expectedWorkerImageDigest: `sha256:${"d".repeat(64)}`,
      expectedMigrationHead: "0001_test.sql",
      expectedPolicyId: "daily-rpo-v1",
      expectedRpoHours: 24,
    });
    assert.equal(chain.manifest.backup_id, built.backupId);
    const restoreVerifiedAt = "2026-08-13T01:20:00.000Z";
    const restoreReconciliation = {
      contract: "chenyida-erp-restore-reconciliation/v1",
      source_sha256: received.offhostReceipt.reconciliation.sha256,
      target_database_report_sha256: "7".repeat(64),
      target_file_trees_sha256: "8".repeat(64),
      result: "MATCHED",
    };
    const restoreReceipt = {
      ...received.offhostReceipt,
      result: "RESTORE_VERIFIED",
      verified_at: restoreVerifiedAt,
      location_id: "isolated-restore",
      evidence: {
        kind: "ISOLATED_RESTORE_VERIFICATION",
        source_location_id: sealed.envelope.source.location_id,
        offhost_location_id: sealed.envelope.receiver.location_id,
        offhost_receiver_identity_sha256: received.offhostReceipt.evidence.receiver_identity_sha256,
        offhost_receipt_sha256: await sha256File(received.offhostReceiptFile),
        restore_run_id: "restore-one",
        restored_at: restoreVerifiedAt,
        target: {
          deployment_class: "TEST",
          deployment_id: "isolated-test",
          database_name: "source_restore_test",
          database_system_identifier: "7712345678901234567",
          database_oid: "16385",
          marker_id: "target-one",
          cluster_marker_id: "target-cluster",
          database_server_major: "17",
          database_encoding: "UTF8",
          database_collate: "C",
          database_ctype: "C",
          database_locale_provider: "libc",
          database_collation_version: "NONE",
          file_root_name: "restore-one_restore_test",
        },
        reconciliation: restoreReconciliation,
        reconciliation_sha256: createHash("sha256").update(JSON.stringify(restoreReconciliation)).digest("hex"),
        attestation: "TRUSTED_EXECUTION_UID_AND_DISTINCT_CLUSTER_ACTIVE_INSPECTION",
      },
    };
    const restoreReceiptFile = path.join(root, "restore-receipt.json");
    await writeFile(restoreReceiptFile, `${JSON.stringify(restoreReceipt)}\n`, { mode: 0o600 });
    const observation = evaluateBackupSchedule({ policy: operationsPolicy, state: completedOperations, now: restoreVerifiedAt, globalLockStatus: "AVAILABLE", bootIdSha256: "1".repeat(64) });
    const retentionPlan = planBackupRetention({
      policy: operationsPolicy,
      now: restoreVerifiedAt,
      generations: [
        {
          backup_id: built.backupId,
          created_at: sealed.envelope.created_at,
          recovery_point_at: sealed.envelope.inner.recovery_point_at,
          expires_at: sealed.envelope.inner.expires_at,
          envelope_sha256: sealed.envelopeSha,
          receiver_receipt_sha256: await sha256File(received.receiverReceiptFile),
          acceptance_sha256: await sha256File(accepted.acceptanceFile),
          transfer_status: "RECEIVER_RECEIPT_ACCEPTED",
          restore_status: "RESTORE_VERIFIED",
          restore_receipt_sha256: await sha256File(restoreReceiptFile),
          hold: false,
          inflight: false,
        },
        {
          backup_id: "backup-older",
          created_at: "2026-07-01T00:01:00.000Z",
          recovery_point_at: "2026-07-01T00:00:00.000Z",
          expires_at: "2026-07-02T00:00:00.000Z",
          envelope_sha256: "3".repeat(64),
          receiver_receipt_sha256: "4".repeat(64),
          acceptance_sha256: "5".repeat(64),
          transfer_status: "RECEIVER_RECEIPT_ACCEPTED",
          restore_status: "NOT_VERIFIED",
          restore_receipt_sha256: null,
          hold: false,
          inflight: false,
        },
      ],
    });
    const readiness = await createBackupRecoveryReadiness({
      policy: operationsPolicy,
      observation,
      retentionPlan,
      receiverPackageDirectory: received.packageDirectory,
      acceptanceFile: accepted.acceptanceFile,
      receiverKeyRoot: keySet.receiverKeyRoot,
      receiverEncryptionPrivateKey: keySet.receiverEncryptionPrivateKey,
      trustedSourceSigningPublicKey: keySet.sourceSigningPublicAtReceiver,
      receiverReceiptPublicKey: keySet.receiverReceiptPublicAtReceiver,
      restoreReceiptFile,
      now: restoreVerifiedAt,
    });
    assert.equal(validateBackupRecoveryReadiness(readiness).result, BACKUP_RECOVERY_SYNTHETIC_RESULT);
    assert.equal(readiness.evidence_scope, "SYNTHETIC_ISOLATED");
    assert.equal(JSON.stringify(readiness).includes("PRIVATE KEY"), false);
    const actualRestore = { ...readiness.inner_restore.receipt, deployment: { ...readiness.inner_restore.receipt.deployment, class: "UAT" } };
    const { readiness_sha256: _syntheticReadinessSha, ...actualBase } = readiness;
    const actualBody = { ...actualBase, result: "RECOVERY_READY", evidence_scope: "ACTUAL_OFFHOST", inner_restore: { ...readiness.inner_restore, receipt_canonical_sha256: createHash("sha256").update(canonicalTransferJson(actualRestore)).digest("hex"), receipt: actualRestore }, operations: { ...readiness.operations, policy_scope: "UAT", scheduler_installation_status: "INSTALLED_AND_OBSERVED" } };
    const actualReadiness = validateBackupRecoveryReadiness({ ...actualBody, readiness_sha256: createHash("sha256").update(canonicalTransferJson(actualBody)).digest("hex") });
    const originalGetuid = process.getuid;
    try {
      process.getuid = () => 65534;
      await assert.rejects(publishBackupRecoveryReadiness({ readiness: actualReadiness, receiptRoot: rootSet.readinessRoot, receiptReaderGid: process.getgid(), confirm: "PUBLISH_ACTUAL_OFFHOST_RECOVERY_READINESS" }), (error) => error.code === "READINESS_ACTUAL_ROOT_REQUIRED");
    } finally { process.getuid = originalGetuid; }
    await assert.rejects(publishBackupRecoveryReadiness({ readiness, receiptRoot: rootSet.readinessRoot, receiptReaderGid: process.getgid(), confirm: "WRONG" }), (error) => error.code === "READINESS_PUBLICATION_CONFIRMATION_REQUIRED");
    const published = await publishBackupRecoveryReadiness({ readiness, receiptRoot: rootSet.readinessRoot, receiptReaderGid: process.getgid(), confirm: "PUBLISH_SYNTHETIC_ISOLATED_RECOVERY_EVIDENCE" });
    assert.equal(path.basename(published.aliasFile), "recovery-readiness.json");
    assert.equal((await stat(published.aliasFile)).mode & 0o777, 0o640);
    assert.equal(await readFile(published.aliasFile, "utf8"), canonicalTransferJson(readiness));
    assert.deepEqual(await publishBackupRecoveryReadiness({ readiness, receiptRoot: rootSet.readinessRoot, receiptReaderGid: process.getgid(), confirm: "PUBLISH_SYNTHETIC_ISOLATED_RECOVERY_EVIDENCE" }), published);
    const cleanupOptions = {
      receiverPackageDirectory: received.packageDirectory,
      acceptanceFile: accepted.acceptanceFile,
      receiverKeyRoot: keySet.receiverKeyRoot,
      receiverEncryptionPrivateKey: keySet.receiverEncryptionPrivateKey,
      trustedSourceSigningPublicKey: keySet.sourceSigningPublicAtReceiver,
      receiverReceiptPublicKey: keySet.receiverReceiptPublicAtReceiver,
      destinationRoot: rootSet.materializationRoot,
      transferId: "transfer-one",
      backupId: built.backupId,
      policy: operationsPolicy,
    };
    await assert.rejects(cleanupMaterializedOffhostTransfer({ ...cleanupOptions, confirm: "WRONG" }), (error) => error.code === "MATERIALIZATION_CLEANUP_CONFIRMATION_REQUIRED");
    assert.equal(await cleanupMaterializedOffhostTransfer({ ...cleanupOptions, confirm: "REMOVE_EXACT_VERIFIED_MATERIALIZATION" }), true);
    assert.equal((await readdir(rootSet.materializationRoot)).includes(built.backupId), false);
  } finally {
    process.env.PATH = previousPath;
  }
}));

test("tamper, truncation, wrong keys, partial inbox, and receipt forgery fail before publication", async () => temporary(async (root) => {
  const previousPath = process.env.PATH;
  process.env.PATH = await fakePgRestore(root);
  try {
    const built = await fixture(root), keySet = await keys(root), rootSet = await roots(root);
    const sealed = await sealOffhostTransfer(await sealOptions(built, keySet, rootSet));
    const tampered = path.join(root, "tampered-package");
    await cp(sealed.packageDirectory, tampered, { recursive: true });
    await writeFile(path.join(tampered, "payload.enc"), "truncated", { mode: 0o600 });
    await assert.rejects(receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, tampered)), (error) => error.code === "PAYLOAD_IDENTITY_MISMATCH");
    assert.deepEqual((await readdir(rootSet.receiverRoot)).filter((name) => !name.startsWith(".chenyida") && name !== ".offhost-transfer-v1.lock"), []);

    const authenticatedTamper = path.join(root, "authenticated-tamper-package");
    await cp(sealed.packageDirectory, authenticatedTamper, { recursive: true });
    const payloadFile = path.join(authenticatedTamper, "payload.enc");
    const payload = await readFile(payloadFile);
    payload[Math.floor(payload.length / 2)] ^= 0x01;
    await writeFile(payloadFile, payload, { mode: 0o600 });
    const envelopeFile = path.join(authenticatedTamper, "envelope.json");
    const envelope = JSON.parse(await readFile(envelopeFile, "utf8"));
    envelope.payload.sha256 = createHash("sha256").update(payload).digest("hex");
    const envelopeBody = { ...envelope };
    delete envelopeBody.signature;
    envelope.signature.value_base64 = sign(null, Buffer.from(canonicalTransferJson(envelopeBody)), createPrivateKey(await readFile(keySet.sourceSigningPrivateKey))).toString("base64");
    await writeFile(envelopeFile, canonicalTransferJson(envelope), { mode: 0o600 });
    await assert.rejects(receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, authenticatedTamper)), (error) => error.code === "PAYLOAD_AUTHENTICATION_FAILED");
    assert.equal(await treeContainsBytes(rootSet.receiverRoot, "synthetic-postgresql-dump"), false);

    const signatureTamper = path.join(root, "signature-tamper-package");
    await cp(sealed.packageDirectory, signatureTamper, { recursive: true });
    const signatureEnvelopeFile = path.join(signatureTamper, "envelope.json");
    const signatureEnvelope = JSON.parse(await readFile(signatureEnvelopeFile, "utf8"));
    signatureEnvelope.signature.value_base64 = Buffer.alloc(64, 3).toString("base64");
    await writeFile(signatureEnvelopeFile, canonicalTransferJson(signatureEnvelope), { mode: 0o600 });
    await assert.rejects(receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, signatureTamper)), (error) => error.code === "ENVELOPE_SIGNATURE_INVALID");

    const partial = path.join(root, "partial-package");
    await mkdir(partial, { mode: 0o700 });
    await cp(path.join(sealed.packageDirectory, "envelope.json"), path.join(partial, "envelope.json"));
    await chmod(path.join(partial, "envelope.json"), 0o600);
    await assert.rejects(receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, partial)), (error) => error.code === "TRANSFER_PACKAGE_FILE_SET_INVALID");

    const otherEncryption = generateKeyPairSync("x25519");
    const wrongKey = await keyFile(keySet.receiverKeyRoot, "wrong-decryption.pem", otherEncryption.privateKey, "pkcs8");
    await assert.rejects(receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, sealed.packageDirectory, { receiverEncryptionPrivateKey: wrongKey })), (error) => ["RECEIVER_KEY_MISMATCH", "RECEIVER_DECRYPTION_KEY_NOT_APPROVED"].includes(error.code));

    const received = await receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, sealed.packageDirectory));
    const forgedReceipt = path.join(root, "forged-receipt.json");
    const receipt = JSON.parse(await readFile(received.receiverReceiptFile, "utf8"));
    receipt.signature.value_base64 = Buffer.alloc(64, 9).toString("base64");
    await writeFile(forgedReceipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    await assert.rejects(acceptOffhostTransferReceipt({ sourcePackageDirectory: sealed.packageDirectory, receiverReceiptFile: forgedReceipt, sourceKeyRoot: keySet.sourceKeyRoot, sourceSigningPrivateKey: keySet.sourceSigningPrivateKey, receiverReceiptPublicKey: keySet.receiverReceiptPublicAtSource, acceptedAt, now: acceptedAt }), (error) => error.code === "TRANSFER_RECEIPT_SIGNATURE_INVALID");
  } finally {
    process.env.PATH = previousPath;
  }
}));

test("prepared sender and receiver stages recover idempotently while conflicting payloads never overwrite", async () => temporary(async (root) => {
  const previousPath = process.env.PATH;
  process.env.PATH = await fakePgRestore(root);
  try {
    const built = await fixture(root), keySet = await keys(root), rootSet = await roots(root);
    await assert.rejects(sealOffhostTransfer(await sealOptions(built, keySet, rootSet, { failAt: "AFTER_CIPHERTEXT" })), (error) => error.code === "INJECTED_AFTER_CIPHERTEXT");
    assert.ok((await readdir(rootSet.outboxRoot)).includes("transfer-one.prepared.json"));
    const sealed = await sealOffhostTransfer(await sealOptions(built, keySet, rootSet));
    const sealedAgain = await sealOffhostTransfer(await sealOptions(built, keySet, rootSet));
    assert.equal(sealedAgain.envelopeSha, sealed.envelopeSha);

    await assert.rejects(receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, sealed.packageDirectory, { failAt: "AFTER_RECEIPT" })), (error) => error.code === "INJECTED_AFTER_RECEIPT");
    const received = await receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, sealed.packageDirectory));
    const receivedAgain = await receiveOffhostTransfer(receiveOptions(built, keySet, rootSet, sealed.packageDirectory));
    assert.equal(receivedAgain.envelopeSha, received.envelopeSha);

    const secondRoot = path.join(root, "second");
    await mkdir(secondRoot, { mode: 0o700 });
    const second = await fixture(secondRoot, "backup-two");
    await assert.rejects(sealOffhostTransfer(await sealOptions(second, keySet, rootSet)), (error) => error.code === "TRANSFER_INTENT_CONFLICT");
  } finally {
    process.env.PATH = previousPath;
  }
}));

test("key roots reject wide modes, symlinks, hardlinks, and key replacement", async () => temporary(async (root) => {
  const previousPath = process.env.PATH;
  process.env.PATH = await fakePgRestore(root);
  try {
    const built = await fixture(root), keySet = await keys(root), rootSet = await roots(root);
    await chmod(keySet.sourceSigningPrivateKey, 0o644);
    await assert.rejects(sealOffhostTransfer(await sealOptions(built, keySet, rootSet)), (error) => error.code === "KEY_FILE_UNSAFE");
    await chmod(keySet.sourceSigningPrivateKey, 0o400);
    const linked = path.join(keySet.sourceKeyRoot, "linked-private.pem");
    await link(keySet.sourceSigningPrivateKey, linked);
    await assert.rejects(sealOffhostTransfer(await sealOptions(built, { ...keySet, sourceSigningPrivateKey: linked }, rootSet)), (error) => error.code === "KEY_FILE_UNSAFE");
    await unlink(linked);
    const outside = path.join(root, "outside-private.pem");
    await cp(keySet.sourceSigningPrivateKey, outside);
    await chmod(outside, 0o400);
    const symbolic = path.join(keySet.sourceKeyRoot, "symbolic-private.pem");
    await symlink(outside, symbolic);
    await assert.rejects(sealOffhostTransfer(await sealOptions(built, { ...keySet, sourceSigningPrivateKey: symbolic }, rootSet)), (error) => error.code === "KEY_FILE_UNSAFE");
  } finally {
    process.env.PATH = previousPath;
  }
}));

test("strict envelope and receipt schemas reject unknown fields and non-canonical algorithms", () => {
  assert.throws(() => validateTransferEnvelope({ schema_version: 1 }), (error) => error.code === "ENVELOPE_FIELDS_INVALID");
  assert.throws(() => validateTransferReceipt({ schema_version: 1, unknown: true }), (error) => error.code === "TRANSFER_RECEIPT_FIELDS_INVALID");
  assert.throws(() => validateTransferAcceptance({ schema_version: 1, unknown: true }), (error) => error.code === "TRANSFER_ACCEPTANCE_FIELDS_INVALID");
});

test("backup operations schedule is anchored, fenced across boots, and fail-closed at exact boundaries", async () => {
  const policy = validateBackupOperationsPolicy(JSON.parse(await readFile(new URL("../operations/offhost-backup-policy-v1.json", import.meta.url), "utf8")));
  assert.match(backupOperationsPolicySha256(policy), /^[0-9a-f]{64}$/);
  assertBackupOperationsKeyApproved(policy, "source_signing", "a".repeat(64), "2026-08-13T00:00:00.000Z");
  assert.throws(() => assertBackupOperationsKeyApproved({ ...policy, key_allowlist: { ...policy.key_allowlist, source_signing: [{ ...policy.key_allowlist.source_signing[0], status: "REVOKED" }] } }, "source_signing", "a".repeat(64), "2026-08-13T00:00:00.000Z"), /BACKUP_POLICY_KEY_NOT_APPROVED/);

  const initial = initialBackupOperationsState(policy);
  assert.equal(evaluateBackupSchedule({ policy, state: initial, now: "2025-12-31T23:59:59.000Z", globalLockStatus: "AVAILABLE", bootIdSha256: "1".repeat(64) }).schedule_status, "ON_TIME");
  assert.equal(evaluateBackupSchedule({ policy, state: initial, now: policy.schedule_anchor_at, globalLockStatus: "AVAILABLE", bootIdSha256: "1".repeat(64) }).schedule_status, "DUE");
  assert.equal(evaluateBackupSchedule({ policy, state: initial, now: "2026-01-01T01:00:00.000Z", globalLockStatus: "BUSY", bootIdSha256: "1".repeat(64) }).schedule_status, "MISSED");

  const started = transitionBackupOperationsState({ policy, previousState: initial, event: event("START", "attempt-stale"), now: "2026-08-13T00:00:00.000Z" });
  assert.equal(evaluateBackupSchedule({ policy, state: started, now: "2026-08-13T03:00:00.000Z", globalLockStatus: "AVAILABLE", bootIdSha256: "1".repeat(64) }).schedule_status, "STUCK");
  const recovered = transitionBackupOperationsState({ policy, previousState: started, event: event("RECOVER_STALE", "attempt-stale", "3".repeat(64), "4".repeat(64)), now: "2026-08-13T00:01:00.000Z" });
  assert.equal(recovered.last_attempt_status, "FAILED");
  assert.equal(recovered.active_attempt, null);
  assert.throws(() => validateBackupOperationsState({ ...initial, sequence: 1 }, policy), /BACKUP_STATE/);
});

test("backup operations durable state serializes writers and recovers a missing alias from immutable history", async () => temporary(async (root) => {
  const policy = validateBackupOperationsPolicy(JSON.parse(await readFile(new URL("../operations/offhost-backup-policy-v1.json", import.meta.url), "utf8")));
  const stateRoot = await markerRoot(root, "operations-state", BACKUP_OPERATIONS_ROOT_MARKER, BACKUP_OPERATIONS_ROOT_MARKER_VALUE);
  const stateFile = path.join(stateRoot, "state.json");
  const initial = await readBackupOperationsStateFile({ stateRoot, stateFile, policy });
  const attempts = await Promise.allSettled([
    transitionAndWriteBackupOperationsState({ stateRoot, stateFile, previousState: initial, event: event("DEFERRED", "attempt-a"), now: "2026-08-13T00:00:00.000Z", policy }),
    transitionAndWriteBackupOperationsState({ stateRoot, stateFile, previousState: initial, event: event("DEFERRED", "attempt-b"), now: "2026-08-13T00:00:00.000Z", policy }),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  const stored = await readBackupOperationsStateFile({ stateRoot, stateFile, policy });
  assert.equal(stored.sequence, 1);
  assert.equal((await readdir(stateRoot)).filter((name) => /^state-\d{10}\.json$/.test(name)).length, 1);
  await unlink(stateFile);
  const recovered = await readBackupOperationsStateFile({ stateRoot, stateFile, policy });
  assert.equal(recovered.integrity_sha256, stored.integrity_sha256);
  assert.throws(() => validateBackupOperationsState(recovered, { ...policy, cadence_minutes: 2880, rpo_minutes: 2880 }), /BACKUP_STATE_POLICY_MISMATCH/);
}));

test("retention output is non-executable and protects latest, minimum, restore-verified, hold, inflight, and RPO generations", async () => {
  const policy = validateBackupOperationsPolicy(JSON.parse(await readFile(new URL("../operations/offhost-backup-policy-v1.json", import.meta.url), "utf8")));
  const generation = (index, createdAtValue, recoveryPointAt, restoreStatus = "NOT_VERIFIED", hold = false, inflight = false) => ({
    backup_id: `backup-${index}`,
    created_at: createdAtValue,
    recovery_point_at: recoveryPointAt,
    expires_at: new Date(Date.parse(recoveryPointAt) + policy.rpo_minutes * 60_000).toISOString(),
    envelope_sha256: index.toString(16).repeat(64),
    receiver_receipt_sha256: (index + 5).toString(16).repeat(64),
    acceptance_sha256: (index + 10).toString(16).repeat(64),
    transfer_status: "RECEIVER_RECEIPT_ACCEPTED",
    restore_status: restoreStatus,
    restore_receipt_sha256: restoreStatus === "RESTORE_VERIFIED" ? (index + 12).toString(16).repeat(64) : null,
    hold,
    inflight,
  });
  const generations = [
    generation(1, "2026-08-12T00:01:00.000Z", "2026-08-12T00:00:00.000Z"),
    generation(2, "2026-07-01T00:01:00.000Z", "2026-07-01T00:00:00.000Z", "RESTORE_VERIFIED"),
    generation(3, "2026-05-01T00:01:00.000Z", "2026-05-01T00:00:00.000Z"),
    generation(4, "2026-03-01T00:01:00.000Z", "2026-03-01T00:00:00.000Z", "NOT_VERIFIED", true),
    generation(5, "2026-01-01T00:01:00.000Z", "2026-01-01T00:00:00.000Z", "NOT_VERIFIED", false, true),
  ];
  const plan = planBackupRetention({ policy, generations, now: "2026-08-13T00:00:00.000Z" });
  assert.equal(plan.execution, "DRY_RUN_DELETION_FORBIDDEN");
  assert.deepEqual(plan.decisions.filter((item) => item.decision === "DELETE_CANDIDATE").map((item) => item.backup_id), ["backup-3"]);
  assert.equal(plan.decisions.find((item) => item.backup_id === "backup-4").reasons.includes("HOLD"), true);
  assert.equal(plan.decisions.find((item) => item.backup_id === "backup-5").reasons.includes("INFLIGHT"), true);
  assert.throws(() => planBackupRetention({ policy, generations: generations.map((item) => ({ ...item, restore_status: "NOT_VERIFIED", restore_receipt_sha256: null })), now: "2026-08-13T00:00:00.000Z" }), /RETENTION_RESTORE_GENERATIONS_INSUFFICIENT/);
});
