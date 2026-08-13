import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { backupOperationsSha256 } from "../scripts/backup-operations-policy.mjs";
import { validateBackupRecoveryReadiness } from "../scripts/backup-recovery-readiness-v3.mjs";
import {
  BACKUP_RECOVERY_READINESS_V4_ATTESTATION,
  createBackupRecoveryReadinessV4,
  publishBackupRecoveryReadinessV4,
  validateBackupRecoveryReadinessV4,
} from "../scripts/backup-recovery-readiness-v4.mjs";
import {
  KEY_ROOT_MARKER,
  KEY_ROOT_MARKER_VALUE,
  OFFHOST_ACCEPTANCE_CONTRACT,
  OFFHOST_RECEIPT_CONTRACT,
  OFFHOST_TRANSFER_CONTRACT,
  canonicalTransferJson,
  transferSha256,
  validateTransferAcceptance,
  validateTransferEnvelope,
  validateTransferReceipt,
} from "../scripts/offhost-transfer-contract.mjs";
import {
  CLUSTER_OUTBOX_ROOT_MARKER,
  CLUSTER_OUTBOX_ROOT_MARKER_VALUE,
  CLUSTER_RECEIVER_ROOT_MARKER,
  CLUSTER_RECEIVER_ROOT_MARKER_VALUE,
  JOINT_TRANSFER_ROOT_MARKER,
  JOINT_TRANSFER_ROOT_MARKER_VALUE,
  acceptClusterCapsuleReceipt,
  createJointTransferV2,
  receiveClusterCapsule,
  sealClusterCapsule,
  validateClusterCapsule,
  validateClusterCapsuleAcceptance,
  validateClusterCapsuleReceipt,
  validateJointTransferV2,
  verifyClusterTransferEvidence,
  verifyJointTransferV2,
  writeJointTransferV2,
} from "../scripts/postgresql-cluster-transfer-contract.mjs";
import {
  CREDENTIAL_RECEIPT_CONTRACT,
  CLUSTER_SECURITY_RECEIPT_CONTRACT,
  TABLESPACE_RECEIPT_CONTRACT,
  clusterPolicySha256,
  clusterSha256,
  createInitialRecoveryState,
  createRecoveryIntent,
  createClusterSnapshot,
  normalizeClusterCatalog,
  transitionRecoveryState,
} from "../scripts/postgresql-cluster-recovery-contract.mjs";

process.env.NODE_ENV = "test";

const siteRoot = path.resolve(new URL("..", import.meta.url).pathname);
const policyFile = path.join(siteRoot, "operations", "postgresql-cluster-recovery-policy-v1.json");
const zero = "0".repeat(64), one = "1".repeat(64), two = "2".repeat(64), three = "3".repeat(64);
const recoveryPoint = "2026-08-13T06:00:00.000Z";
const createdAt = "2026-08-13T06:01:00.000Z";
const receivedAt = "2026-08-13T06:02:00.000Z";
const acceptedAt = "2026-08-13T06:03:00.000Z";
const jointAcceptedAt = "2026-08-13T06:04:00.000Z";
const expiresAt = "2026-08-14T06:00:00.000Z";
const restoreRunId = "restore-run-1";
const targetSystemIdentifier = "8612345678901234567";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function expectCode(...codes) { return (error) => codes.includes(error?.code); }
function fingerprint(key) {
  return createHash("sha256").update(createPublicKey(key).export({ format: "der", type: "spki" })).digest("hex");
}
function signed(body, privateKey, keyFingerprint) {
  return {
    ...body,
    signature: {
      algorithm: "Ed25519",
      key_fingerprint: keyFingerprint,
      value_base64: sign(null, Buffer.from(canonicalTransferJson(body)), privateKey).toString("base64"),
    },
  };
}
async function privateRoot(parent, name, marker, markerValue) {
  const root = path.join(parent, name);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  await writeFile(path.join(root, marker), markerValue, { mode: 0o400 });
  await chmod(path.join(root, marker), 0o400);
  return root;
}

async function readinessRoot(parent) {
  const root = path.join(parent, "readiness");
  await mkdir(root, { mode: 0o2750 });
  await chmod(root, 0o2750);
  const marker = path.join(root, ".chenyida-erp-receipt-root-v2");
  await writeFile(marker, "chenyida-erp-receipt-root/v2\n", { mode: 0o400 });
  await chmod(marker, 0o400);
  return root;
}
async function writeKey(file, key, type) {
  const source = key.export(type === "private"
    ? { format: "pem", type: "pkcs8" }
    : { format: "pem", type: "spki" });
  await writeFile(file, source, { mode: 0o400 });
  await chmod(file, 0o400);
  return file;
}

function catalogFixture(policy) {
  const owner = policy.identities.migration_owner;
  const group = policy.identities.privilege_group;
  const privilege = (grantor, grantee, privilegeType, isGrantable = false) => ({
    grantor, grantee, privilege_type: privilegeType, is_grantable: isGrantable,
  });
  const unsupported = Object.fromEntries(policy.unsupported_catalog_counters.map((name) => [name, 0]));
  return normalizeClusterCatalog({
    database: {
      name: policy.database.name,
      owner,
      default_tablespace: policy.database.default_tablespace,
      allow_connect: true,
      connection_limit: 64,
      acl_state: "EXPLICIT",
      explicit_privileges: [privilege(owner, group, "CONNECT")],
      effective_privileges: [privilege(owner, group, "CONNECT")],
    },
    roles: policy.roles.map((role) => ({
      name: role.name,
      purpose: role.purpose,
      superuser: false,
      inherit: role.inherit,
      create_role: false,
      create_database: false,
      can_login: role.intended_login,
      replication: false,
      connection_limit: role.connection_limit,
      valid_until: role.valid_until,
      bypass_rls: false,
    })),
    memberships: clone(policy.memberships),
    settings: [],
    objects: [{
      kind: "SCHEMA",
      schema: null,
      name: "confidential_app",
      identity_arguments: null,
      parent_identity: null,
      owner,
      tablespace: null,
      extension: null,
      acl_state: "EXPLICIT",
      explicit_privileges: [privilege(owner, group, "USAGE")],
      effective_privileges: [privilege(owner, group, "USAGE")],
    }],
    default_privileges: [],
    tablespaces: [{
      name: "erp_secret_ts",
      owner,
      options: [],
      source_location_sha256: zero,
      acl_state: "NULL",
      explicit_privileges: [],
      effective_privileges: [privilege(owner, owner, "CREATE", true)],
    }],
    extensions: [{
      name: "plpgsql",
      version: "1.0",
      schema: "pg_catalog",
      owner: policy.identities.restore_admin,
      member_fingerprint: three,
    }],
    publications: [],
    parameter_privileges: [],
    unsupported,
  });
}

function dataEnvelopeAadProjection(value) {
  return {
    schema_version: value.schema_version,
    contract: value.contract,
    status: value.status,
    transfer_id: value.transfer_id,
    backup_id: value.backup_id,
    created_at: value.created_at,
    source: value.source,
    receiver: value.receiver,
    inner: value.inner,
    algorithms: {
      payload: value.encryption.payload_algorithm,
      agreement: value.encryption.key_agreement,
      derivation: value.encryption.key_derivation,
      signature: "Ed25519",
    },
    payload: { file: value.payload.file, format: value.payload.format },
  };
}

function dataEvidenceFixture(keys, binding) {
  const sourceFingerprint = fingerprint(keys.source.privateKey);
  const encryptionFingerprint = fingerprint(keys.encryption.privateKey);
  const receiptFingerprint = fingerprint(keys.receipt.privateKey);
  const ephemeral = generateKeyPairSync("x25519");
  const envelopeBody = {
    schema_version: 1,
    contract: OFFHOST_TRANSFER_CONTRACT,
    status: "SEALED",
    transfer_id: "data-transfer-1",
    backup_id: binding.backup_id,
    created_at: createdAt,
    source: {
      location_id: "source-site",
      machine_identity_sha256: binding.machine_identity_sha256,
      signing_key_fingerprint: sourceFingerprint,
    },
    receiver: {
      location_id: "receiver-site",
      encryption_key_fingerprint: encryptionFingerprint,
      receipt_key_fingerprint: receiptFingerprint,
    },
    inner: {
      manifest_sha256: binding.manifest_sha256,
      local_receipt_sha256: binding.local_receipt_sha256,
      deployment_class: "TEST",
      deployment_id: "synthetic-test",
      policy_id: "synthetic-backup-policy",
      rpo_hours: 24,
      recovery_point_at: recoveryPoint,
      expires_at: expiresAt,
    },
    encryption: {
      payload_algorithm: "AES-256-GCM",
      key_agreement: "X25519",
      key_derivation: "HKDF-SHA256",
      ephemeral_public_key_der_base64: ephemeral.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      salt_base64: Buffer.alloc(32, 1).toString("base64"),
      wrapped_key: {
        algorithm: "AES-256-GCM",
        nonce_base64: Buffer.alloc(12, 2).toString("base64"),
        ciphertext_base64: Buffer.alloc(32, 3).toString("base64"),
        tag_base64: Buffer.alloc(16, 4).toString("base64"),
      },
      payload_nonce_base64: Buffer.alloc(12, 5).toString("base64"),
      payload_tag_base64: Buffer.alloc(16, 6).toString("base64"),
      aad_sha256: "",
    },
    payload: {
      file: "payload.enc",
      format: "POSIX_TAR_V1",
      sha256: "4".repeat(64),
      bytes: 4096,
    },
  };
  envelopeBody.encryption.aad_sha256 = transferSha256(dataEnvelopeAadProjection(envelopeBody));
  const envelope = validateTransferEnvelope(signed(envelopeBody, keys.source.privateKey, sourceFingerprint)).value;
  const envelopeSha = transferSha256(envelope);
  const receiverBody = {
    schema_version: 1,
    contract: OFFHOST_RECEIPT_CONTRACT,
    status: "OFFHOST_VERIFIED",
    transfer_id: envelope.transfer_id,
    backup_id: envelope.backup_id,
    received_at: receivedAt,
    source_location_id: envelope.source.location_id,
    receiver_location_id: envelope.receiver.location_id,
    source_signing_key_fingerprint: sourceFingerprint,
    receiver_encryption_key_fingerprint: encryptionFingerprint,
    receiver_receipt_key_fingerprint: receiptFingerprint,
    envelope_sha256: envelopeSha,
    payload_sha256: envelope.payload.sha256,
    payload_bytes: envelope.payload.bytes,
    inner_manifest_sha256: envelope.inner.manifest_sha256,
    local_receipt_sha256: envelope.inner.local_receipt_sha256,
    offhost_receipt_sha256: "5".repeat(64),
    retention_policy_id: "synthetic-retention",
    retention_status: "PLANNED_NO_DELETION",
    attestation: "SIGNED_SOURCE_ENVELOPE_AEAD_INNER_V2_AND_DISTINCT_RECEIVER_VERIFIED",
  };
  const receiverReceipt = validateTransferReceipt(signed(receiverBody, keys.receipt.privateKey, receiptFingerprint));
  const acceptanceBody = {
    schema_version: 1,
    contract: OFFHOST_ACCEPTANCE_CONTRACT,
    status: "RECEIVER_RECEIPT_ACCEPTED",
    transfer_id: envelope.transfer_id,
    backup_id: envelope.backup_id,
    accepted_at: acceptedAt,
    source_location_id: envelope.source.location_id,
    receiver_location_id: envelope.receiver.location_id,
    source_signing_key_fingerprint: sourceFingerprint,
    receiver_receipt_key_fingerprint: receiptFingerprint,
    envelope_sha256: envelopeSha,
    receiver_receipt_sha256: transferSha256(receiverReceipt),
    attestation: "SOURCE_VERIFIED_SIGNED_RECEIVER_ACKNOWLEDGEMENT",
  };
  const acceptance = validateTransferAcceptance(signed(acceptanceBody, keys.source.privateKey, sourceFingerprint));
  return { envelope, receiverReceipt, acceptance };
}

function syntheticDataReadiness(context, dataEvidence) {
  const restoreReconciliation = {
    contract: "chenyida-erp-restore-reconciliation/v1",
    source_sha256: context.binding.application.migration_manifest_sha256,
    target_database_report_sha256: "8".repeat(64),
    target_file_trees_sha256: "9".repeat(64),
    result: "MATCHED",
  };
  const restore = {
    schema_version: 2,
    contract: "chenyida-erp-backup-verification/v2",
    result: "RESTORE_VERIFIED",
    backup_id: context.binding.backup_id,
    created_at: createdAt,
    verified_at: "2026-08-13T06:06:00.000Z",
    expires_at: expiresAt,
    location_id: "isolated-restore",
    deployment: {
      class: "TEST",
      id: "synthetic-test",
      database: "chenyida_erp_test",
      database_system_identifier: context.binding.source.system_identifier,
      database_oid: context.binding.source.database_oid,
      database_marker: context.binding.source.database_marker,
      database_bytes: 16_777_216,
      database_server_major: context.binding.source.postgresql_major,
      database_encoding: "UTF8",
      database_collate: "C.UTF-8",
      database_ctype: "C.UTF-8",
      database_locale_provider: "libc",
      database_collation_version: "NONE",
    },
    application: {
      version: context.binding.application.version,
      git_commit: context.binding.application.git_commit,
      web_image_digest: `sha256:${"a".repeat(64)}`,
      worker_image_digest: `sha256:${"b".repeat(64)}`,
    },
    migration: {
      head: context.binding.application.migration_head,
      manifest_file: "migrations.txt",
      manifest_sha256: context.binding.application.migration_manifest_sha256,
    },
    policy: { id: "synthetic-backup-policy", rpo_hours: 24 },
    consistency: {
      method: "QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION",
      database_snapshot: "PG_DUMP_CONSISTENT_SNAPSHOT",
      database_guard: "DEFAULT_TRANSACTION_READ_ONLY_DEFENSE_IN_DEPTH",
      writer_boundary: "EXACT_COMPOSE_WEB_WORKER_STOPPED",
      content_reconciliation: "BEFORE_AFTER_FULL_RELATION_CONTENT_DIGESTS",
      dump_scope: "COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL",
      web_container: "web-test",
      web_container_id: "a".repeat(64),
      worker_container: "worker-test",
      worker_container_id: "b".repeat(64),
      recovery_point_at: recoveryPoint,
      verified_after: "2026-08-13T06:00:30.000Z",
    },
    reconciliation: {
      contract: "chenyida-erp-backup-reconciliation/v1",
      file: "reconciliation.json",
      sha256: context.binding.application.migration_manifest_sha256,
    },
    manifest_sha256: context.binding.manifest_sha256,
    artifacts: {
      postgresql_dump: { file: "postgresql.dump", sha256: one, bytes: 1024 },
      uploads: { file: "uploads.tar.gz", sha256: two, bytes: 1024, entries: 0 },
      attachments: { file: "attachments.tar.gz", sha256: three, bytes: 1024, entries: 0 },
      backup_status: { file: "backup-status.tar.gz", sha256: zero, bytes: 1024, entries: 0 },
    },
    evidence: {
      kind: "ISOLATED_RESTORE_VERIFICATION",
      source_location_id: dataEvidence.envelope.source.location_id,
      offhost_location_id: dataEvidence.envelope.receiver.location_id,
      offhost_receiver_identity_sha256: "7".repeat(64),
      offhost_receipt_sha256: dataEvidence.receiverReceipt.offhost_receipt_sha256,
      restore_run_id: restoreRunId,
      restored_at: "2026-08-13T06:06:00.000Z",
      target: {
        deployment_class: "TEST",
        deployment_id: "synthetic-restore",
        database_name: "chenyida_erp_restore_test",
        database_system_identifier: targetSystemIdentifier,
        database_oid: "16385",
        marker_id: "synthetic-target",
        cluster_marker_id: "synthetic-cluster",
        database_server_major: context.binding.source.postgresql_major,
        database_encoding: "UTF8",
        database_collate: "C.UTF-8",
        database_ctype: "C.UTF-8",
        database_locale_provider: "libc",
        database_collation_version: "NONE",
        file_root_name: "synthetic_restore_test",
      },
      reconciliation: restoreReconciliation,
      reconciliation_sha256: createHash("sha256").update(JSON.stringify(restoreReconciliation)).digest("hex"),
      attestation: "TRUSTED_EXECUTION_UID_AND_DISTINCT_CLUSTER_ACTIVE_INSPECTION",
    },
  };
  const body = {
    schema_version: 3,
    contract: "chenyida-erp-backup-verification/v3",
    result: "SYNTHETIC_ISOLATED_VERIFIED",
    evidence_scope: "SYNTHETIC_ISOLATED",
    backup_id: context.binding.backup_id,
    created_at: createdAt,
    verified_at: "2026-08-13T06:07:00.000Z",
    expires_at: expiresAt,
    inner_restore: {
      receipt_file_sha256: "8".repeat(64),
      receipt_canonical_sha256: backupOperationsSha256(restore),
      receipt: restore,
    },
    transfer: {
      transfer_id: dataEvidence.envelope.transfer_id,
      envelope_sha256: transferSha256(dataEvidence.envelope),
      receiver_receipt_sha256: transferSha256(dataEvidence.receiverReceipt),
      acceptance_sha256: transferSha256(dataEvidence.acceptance),
      offhost_receipt_sha256: dataEvidence.receiverReceipt.offhost_receipt_sha256,
      payload_algorithm: dataEvidence.envelope.encryption.payload_algorithm,
      key_agreement: dataEvidence.envelope.encryption.key_agreement,
      key_derivation: dataEvidence.envelope.encryption.key_derivation,
      signature_algorithm: "Ed25519",
      source_location_id: dataEvidence.envelope.source.location_id,
      source_machine_identity_sha256: dataEvidence.envelope.source.machine_identity_sha256,
      receiver_location_id: dataEvidence.envelope.receiver.location_id,
      receiver_machine_identity_sha256: "6".repeat(64),
      receiver_identity_sha256: restore.evidence.offhost_receiver_identity_sha256,
      source_signing_key_fingerprint: dataEvidence.envelope.source.signing_key_fingerprint,
      receiver_encryption_key_fingerprint: dataEvidence.envelope.receiver.encryption_key_fingerprint,
      receiver_receipt_key_fingerprint: dataEvidence.envelope.receiver.receipt_key_fingerprint,
    },
    operations: {
      policy_id: "synthetic-operations-policy",
      policy_sha256: one,
      policy_scope: "TEST",
      schedule_observation_sha256: two,
      schedule_status: "ON_TIME",
      rpo_status: "WITHIN_RPO",
      scheduler_installation_status: "REPOSITORY_EVALUATOR_ONLY",
      retention_plan_sha256: three,
      retention_status: "POLICY_VALID_DRY_RUN",
      retention_execution: "DRY_RUN_DELETION_FORBIDDEN",
    },
    attestation: "ROOT_PUBLISHED_INNER_V2_RESTORE_SIGNED_ENCRYPTED_OFFHOST_AND_OPERATIONS_POLICY_VERIFIED",
  };
  return validateBackupRecoveryReadiness({ ...body, readiness_sha256: transferSha256(body) });
}

function syntheticClusterRecovery(context, joint) {
  const tablespaceIdentity = clusterSha256("synthetic-tablespace-target-identity");
  const targetSystemIdentifierSha256 = clusterSha256(targetSystemIdentifier);
  const roleSetSha256 = clusterSha256(context.policy.credential_binding.login_roles);
  const tablespaceMapSha256 = clusterSha256("synthetic-tablespace-map");
  const tablespaceBody = {
    schema_version: 1,
    contract: TABLESPACE_RECEIPT_CONTRACT,
    backup_id: context.binding.backup_id,
    restore_run_id: restoreRunId,
    map_sha256: tablespaceMapSha256,
    entry_set_sha256: one,
    post_create_entry_set_sha256: two,
    target_tablespace_catalog_sha256: three,
    namespace_identity_sha256: zero,
    custom_tablespace_count: context.snapshot.catalog.tablespaces.length,
    verified_at: "2026-08-13T06:09:00.000Z",
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    namespace_status: "VERIFIED",
    path_identity_status: "VERIFIED",
    post_create_status: "VERIFIED",
    result: "SYNTHETIC_ISOLATED_VERIFIED",
  };
  const tablespaceReceipt = { ...tablespaceBody, receipt_sha256: clusterSha256(tablespaceBody) };
  const credentialBody = {
    schema_version: 1,
    contract: CREDENTIAL_RECEIPT_CONTRACT,
    backup_id: context.binding.backup_id,
    restore_run_id: restoreRunId,
    credential_generation_id: "synthetic-generation-1",
    role_set_sha256: roleSetSha256,
    role_count: context.policy.credential_binding.login_roles.length,
    bound_at: "2026-08-13T06:10:00.000Z",
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    root_enforced: false,
    result: "SYNTHETIC_ISOLATED_VERIFIED",
  };
  const credentialReceipt = { ...credentialBody, receipt_sha256: clusterSha256(credentialBody) };
  const clusterBody = {
    schema_version: 1,
    contract: CLUSTER_SECURITY_RECEIPT_CONTRACT,
    backup_id: context.binding.backup_id,
    restore_run_id: restoreRunId,
    snapshot_sha256: context.snapshot.snapshot_sha256,
    policy_id: context.policy.policy_id,
    policy_sha256: clusterPolicySha256(context.policy),
    source_catalog_sha256: context.snapshot.catalog_sha256,
    target_raw_catalog_sha256: "8".repeat(64),
    target_catalog_sha256: context.snapshot.catalog_sha256,
    tablespace_map_sha256: tablespaceMapSha256,
    tablespace_receipt_sha256: tablespaceReceipt.receipt_sha256,
    credential_receipt_sha256: credentialReceipt.receipt_sha256,
    credential_role_set_sha256: roleSetSha256,
    target_system_identifier_sha256: targetSystemIdentifierSha256,
    verified_at: "2026-08-13T06:11:00.000Z",
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    policy_status: "VERIFIED",
    source_equivalence_status: "VERIFIED",
    result: "SYNTHETIC_ISOLATED_VERIFIED",
  };
  const clusterSecurityReceipt = { ...clusterBody, receipt_sha256: clusterSha256(clusterBody) };
  const recoveryIntent = createRecoveryIntent({
    restore_run_id: restoreRunId,
    backup_id: context.binding.backup_id,
    created_at: "2026-08-13T06:05:00.000Z",
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    policy_sha256: clusterPolicySha256(context.policy),
    snapshot_sha256: context.snapshot.snapshot_sha256,
    data_transfer_acceptance_sha256: joint.data.acceptance_sha256,
    cluster_transfer_acceptance_sha256: joint.cluster.acceptance_sha256,
    joint_transfer_sha256: transferSha256(joint),
    target_system_identifier_sha256: targetSystemIdentifierSha256,
    target_empty_state_sha256: "9".repeat(64),
    credential_generation_id: credentialReceipt.credential_generation_id,
    credential_role_set_sha256: roleSetSha256,
    tablespace_map_sha256: tablespaceMapSha256,
    custom_tablespace_identity_sha256: [tablespaceIdentity],
  });
  const states = [createInitialRecoveryState(recoveryIntent, recoveryIntent.created_at)];
  const advance = (phase, minute, operation = null) => states.push(transitionRecoveryState(states.at(-1), recoveryIntent, {
    phase,
    operation,
    recordedAt: `2026-08-13T06:${String(minute).padStart(2, "0")}:00.000Z`,
  }));
  const tablespaceOperation = { kind: "TABLESPACE", resource_identity_sha256: tablespaceIdentity, payload_sha256: one };
  const databaseOperation = { kind: "DATABASE", resource_identity_sha256: targetSystemIdentifierSha256, payload_sha256: two };
  advance("ROLE_SKELETON_APPLIED", 6);
  advance("TABLESPACE_COMMAND_DISPATCHED", 7, tablespaceOperation);
  advance("TABLESPACE_RECONCILED_APPLIED", 8, tablespaceOperation);
  advance("TABLESPACE_VERIFIED", 9, tablespaceOperation);
  advance("DATABASE_COMMAND_DISPATCHED", 10, databaseOperation);
  advance("DATABASE_RECONCILED_APPLIED", 11, databaseOperation);
  advance("DATABASE_VERIFIED", 12, databaseOperation);
  advance("DATA_APPLIED", 13);
  advance("SECURITY_VERIFIED", 14);
  advance("CREDENTIALS_VERIFIED", 15);
  advance("ACTIVATE_PREPARED", 16);
  advance("PREPARED", 17);
  advance("PUBLISHED", 18);
  return { tablespaceReceipt, credentialReceipt, clusterSecurityReceipt, recoveryIntent, recoveryStates: states };
}

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-cluster-transfer-v1-"));
  try {
    await chmod(root, 0o700);
    const policy = JSON.parse(await readFile(policyFile, "utf8"));
    const catalog = catalogFixture(policy);
    const binding = {
      backup_id: "backup-20260813-0001",
      manifest_sha256: one,
      local_receipt_sha256: two,
      recovery_point_at: recoveryPoint,
      source: {
        system_identifier: "7612345678901234567",
        database_oid: "16384",
        database_marker: "synthetic-source-marker",
        postgresql_major: "17",
      },
      application: {
        git_commit: "a".repeat(40),
        version: "0.1.0-alpha.46",
        migration_head: "0045_runtime_worker_readiness.sql",
        migration_manifest_sha256: three,
      },
    };
    const snapshot = createClusterSnapshot({
      snapshotId: "cluster-snapshot-1",
      capturedAt: recoveryPoint,
      binding,
      policy,
      beforeCatalog: catalog,
      afterCatalog: clone(catalog),
    });
    const keys = {
      source: generateKeyPairSync("ed25519"),
      encryption: generateKeyPairSync("x25519"),
      receipt: generateKeyPairSync("ed25519"),
    };
    const sourceKeyRoot = await privateRoot(root, "source-keys", KEY_ROOT_MARKER, KEY_ROOT_MARKER_VALUE);
    const receiverKeyRoot = await privateRoot(root, "receiver-keys", KEY_ROOT_MARKER, KEY_ROOT_MARKER_VALUE);
    const outboxRoot = await privateRoot(root, "cluster-outbox", CLUSTER_OUTBOX_ROOT_MARKER, CLUSTER_OUTBOX_ROOT_MARKER_VALUE);
    const receiverRoot = await privateRoot(root, "cluster-receiver", CLUSTER_RECEIVER_ROOT_MARKER, CLUSTER_RECEIVER_ROOT_MARKER_VALUE);
    const jointRoot = await privateRoot(root, "joint", JOINT_TRANSFER_ROOT_MARKER, JOINT_TRANSFER_ROOT_MARKER_VALUE);
    const keyFiles = {
      sourcePrivate: await writeKey(path.join(sourceKeyRoot, "source-private.pem"), keys.source.privateKey, "private"),
      sourcePublicAtReceiver: await writeKey(path.join(receiverKeyRoot, "source-public.pem"), keys.source.publicKey, "public"),
      encryptionPublicAtSource: await writeKey(path.join(sourceKeyRoot, "receiver-encryption-public.pem"), keys.encryption.publicKey, "public"),
      encryptionPrivate: await writeKey(path.join(receiverKeyRoot, "receiver-encryption-private.pem"), keys.encryption.privateKey, "private"),
      receiptPublicAtSource: await writeKey(path.join(sourceKeyRoot, "receiver-receipt-public.pem"), keys.receipt.publicKey, "public"),
      receiptPrivate: await writeKey(path.join(receiverKeyRoot, "receiver-receipt-private.pem"), keys.receipt.privateKey, "private"),
      receiptPublicAtReceiver: await writeKey(path.join(receiverKeyRoot, "receiver-receipt-public.pem"), keys.receipt.publicKey, "public"),
    };
    await callback({ root, policy, snapshot, binding, keys, keyFiles, sourceKeyRoot, receiverKeyRoot, outboxRoot, receiverRoot, jointRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runClusterChain(context) {
  const sealed = await sealClusterCapsule(clusterSealOptions(context));
  const received = await receiveClusterCapsule({
    incomingPackageDirectory: sealed.packageDirectory,
    receiverRoot: context.receiverRoot,
    receiverKeyRoot: context.receiverKeyRoot,
    trustedSourceSigningPublicKey: context.keyFiles.sourcePublicAtReceiver,
    receiverEncryptionPrivateKey: context.keyFiles.encryptionPrivate,
    receiverReceiptPrivateKey: context.keyFiles.receiptPrivate,
    clusterPolicy: context.policy,
    receiverLocationId: "receiver-site",
    retentionPolicyId: "synthetic-retention",
    receivedAt,
    now: new Date(receivedAt),
  });
  const accepted = await acceptClusterCapsuleReceipt({
    sourcePackageDirectory: sealed.packageDirectory,
    sourceKeyRoot: context.sourceKeyRoot,
    sourceSigningPrivateKey: context.keyFiles.sourcePrivate,
    receiverReceiptPublicKey: context.keyFiles.receiptPublicAtSource,
    receiverReceiptFile: received.receiverReceiptFile,
    acceptedAt,
    now: new Date(acceptedAt),
  });
  const verified = await verifyClusterTransferEvidence({
    receiverPackageDirectory: received.packageDirectory,
    acceptanceFile: accepted.acceptanceFile,
    receiverKeyRoot: context.receiverKeyRoot,
    trustedSourceSigningPublicKey: context.keyFiles.sourcePublicAtReceiver,
    receiverEncryptionPrivateKey: context.keyFiles.encryptionPrivate,
    receiverReceiptPublicKey: context.keyFiles.receiptPublicAtReceiver,
    clusterPolicy: context.policy,
    now: new Date(jointAcceptedAt),
  });
  return { sealed, received, accepted, verified };
}

function clusterSealOptions(context, clusterTransferId = "cluster-transfer-1") {
  return {
    outboxRoot: context.outboxRoot,
    sourceKeyRoot: context.sourceKeyRoot,
    sourceSigningPrivateKey: context.keyFiles.sourcePrivate,
    receiverEncryptionPublicKey: context.keyFiles.encryptionPublicAtSource,
    receiverReceiptPublicKey: context.keyFiles.receiptPublicAtSource,
    clusterPolicy: context.policy,
    snapshot: context.snapshot,
    clusterTransferId,
    evidenceScope: "SYNTHETIC_TEST_ONLY",
    sourceLocationId: "source-site",
    sourceMachineIdentitySha256: zero,
    receiverLocationId: "receiver-site",
    expiresAt,
    createdAt,
    now: new Date(createdAt),
  };
}

test("cluster snapshot is independently signed, encrypted, acknowledged and never stored as plaintext", async () => fixture(async (context) => {
  const chain = await runClusterChain(context);
  validateClusterCapsule(chain.sealed.capsule);
  validateClusterCapsuleReceipt(chain.received.receiverReceipt);
  validateClusterCapsuleAcceptance(chain.accepted.acceptance);
  assert.equal(chain.verified.capsule.inner.snapshot_sha256, context.snapshot.snapshot_sha256);
  const retried = await sealClusterCapsule(clusterSealOptions(context));
  assert.equal(retried.capsuleSha, chain.sealed.capsuleSha);
  await assert.rejects(sealClusterCapsule({ ...clusterSealOptions(context), expiresAt: "2026-08-15T06:00:00.000Z" }), expectCode("CLUSTER_PACKAGE_CONFLICT"));
  assert.deepEqual((await readdir(chain.sealed.packageDirectory)).sort(), ["capsule.json", "cluster-snapshot.enc"]);
  assert.deepEqual((await readdir(chain.received.packageDirectory)).sort(), ["capsule.json", "cluster-receiver-receipt.json", "cluster-snapshot.enc"]);
  const ciphertext = await readFile(chain.sealed.payloadFile);
  for (const sensitive of ["chenyida_erp_runtime", "confidential_app", "erp_secret_ts", "7612345678901234567"]) {
    assert.equal(ciphertext.includes(Buffer.from(sensitive)), false, sensitive);
    assert.equal(canonicalTransferJson(chain.sealed.capsule).includes(sensitive), false, sensitive);
  }
  assert.equal((await readdir(context.receiverRoot)).some((name) => name.includes("plaintext")), false);
}));

test("wrong decryption key, ciphertext change, extra files and stale evidence fail closed", async () => fixture(async (context) => {
  const sealed = await sealClusterCapsule({
    outboxRoot: context.outboxRoot,
    sourceKeyRoot: context.sourceKeyRoot,
    sourceSigningPrivateKey: context.keyFiles.sourcePrivate,
    receiverEncryptionPublicKey: context.keyFiles.encryptionPublicAtSource,
    receiverReceiptPublicKey: context.keyFiles.receiptPublicAtSource,
    clusterPolicy: context.policy,
    snapshot: context.snapshot,
    clusterTransferId: "cluster-transfer-negative",
    evidenceScope: "SYNTHETIC_TEST_ONLY",
    sourceLocationId: "source-site",
    sourceMachineIdentitySha256: zero,
    receiverLocationId: "receiver-site",
    expiresAt,
    createdAt,
    now: new Date(createdAt),
  });
  const wrong = generateKeyPairSync("x25519");
  const wrongFile = await writeKey(path.join(context.receiverKeyRoot, "wrong-private.pem"), wrong.privateKey, "private");
  await assert.rejects(receiveClusterCapsule({
    incomingPackageDirectory: sealed.packageDirectory,
    receiverRoot: context.receiverRoot,
    receiverKeyRoot: context.receiverKeyRoot,
    trustedSourceSigningPublicKey: context.keyFiles.sourcePublicAtReceiver,
    receiverEncryptionPrivateKey: wrongFile,
    receiverReceiptPrivateKey: context.keyFiles.receiptPrivate,
    clusterPolicy: context.policy,
    receiverLocationId: "receiver-site",
    retentionPolicyId: "synthetic-retention",
    receivedAt,
    now: new Date(receivedAt),
  }), expectCode("RECEIVER_DECRYPTION_KEY_NOT_APPROVED"));
  const incomingCopy = path.join(context.root, "incoming-copy");
  await cp(sealed.packageDirectory, incomingCopy, { recursive: true });
  await writeFile(path.join(incomingCopy, "unexpected.json"), "{}\n", { mode: 0o600 });
  const incomingPreflight = {
    incomingPackageDirectory: incomingCopy,
    receiverRoot: context.receiverRoot,
    receiverLocationId: "receiver-site",
    retentionPolicyId: "synthetic-retention",
    receivedAt,
    now: new Date(receivedAt),
  };
  await assert.rejects(receiveClusterCapsule(incomingPreflight), expectCode("CLUSTER_PACKAGE_FILE_SET_INVALID"));
  await unlink(path.join(incomingCopy, "unexpected.json"));
  const payload = await readFile(path.join(incomingCopy, "cluster-snapshot.enc"));
  payload[0] ^= 0xff;
  await writeFile(path.join(incomingCopy, "cluster-snapshot.enc"), payload, { mode: 0o600 });
  await assert.rejects(receiveClusterCapsule(incomingPreflight), expectCode("CLUSTER_PAYLOAD_IDENTITY_MISMATCH"));
  const chain = await runClusterChain({ ...context, outboxRoot: await privateRoot(context.root, "second-outbox", CLUSTER_OUTBOX_ROOT_MARKER, CLUSTER_OUTBOX_ROOT_MARKER_VALUE), receiverRoot: await privateRoot(context.root, "second-receiver", CLUSTER_RECEIVER_ROOT_MARKER, CLUSTER_RECEIVER_ROOT_MARKER_VALUE) });
  await assert.rejects(verifyClusterTransferEvidence({
    receiverPackageDirectory: chain.received.packageDirectory,
    acceptanceFile: chain.accepted.acceptanceFile,
    receiverKeyRoot: context.receiverKeyRoot,
    trustedSourceSigningPublicKey: context.keyFiles.sourcePublicAtReceiver,
    receiverEncryptionPrivateKey: context.keyFiles.encryptionPrivate,
    receiverReceiptPublicKey: context.keyFiles.receiptPublicAtReceiver,
    clusterPolicy: context.policy,
    now: new Date("2026-08-15T06:00:00.000Z"),
  }), expectCode("CLUSTER_TRANSFER_EVIDENCE_STALE"));
}));

test("joint transfer v2 cross-binds verified data v1 and cluster capsule chains", async () => fixture(async (context) => {
  const clusterChain = await runClusterChain(context);
  const dataEvidence = dataEvidenceFixture(context.keys, {
    backup_id: context.binding.backup_id,
    manifest_sha256: context.binding.manifest_sha256,
    local_receipt_sha256: context.binding.local_receipt_sha256,
    machine_identity_sha256: zero,
  });
  const clusterEvidence = {
    capsule: clusterChain.verified.capsule,
    receiverReceipt: clusterChain.verified.receiverReceipt,
    acceptance: clusterChain.verified.acceptance,
  };
  const joint = createJointTransferV2({
    dataEvidence,
    clusterEvidence,
    sourceSigningPrivateKey: context.keys.source.privateKey,
    receiverReceiptPublicKey: context.keys.receipt.publicKey,
    acceptedAt: jointAcceptedAt,
    evidenceScope: "SYNTHETIC_TEST_ONLY",
  });
  validateJointTransferV2(joint);
  assert.equal(verifyJointTransferV2({
    joint,
    dataEvidence,
    clusterEvidence,
    sourceSigningPublicKey: context.keys.source.publicKey,
    receiverReceiptPublicKey: context.keys.receipt.publicKey,
  }), joint);
  const written = await writeJointTransferV2({
    jointRoot: context.jointRoot,
    sourceKeyRoot: context.sourceKeyRoot,
    sourceSigningPrivateKey: context.keyFiles.sourcePrivate,
    receiverReceiptPublicKey: context.keyFiles.receiptPublicAtSource,
    dataEvidence,
    clusterEvidence,
    acceptedAt: jointAcceptedAt,
    evidenceScope: "SYNTHETIC_TEST_ONLY",
  });
  assert.equal(written.jointSha, transferSha256(joint));
  assert.equal((await readFile(written.jointFile, "utf8")), canonicalTransferJson(joint));
  const publicText = canonicalTransferJson(joint);
  for (const sensitive of ["chenyida_erp_runtime", "confidential_app", "erp_secret_ts", "7612345678901234567"]) assert.equal(publicText.includes(sensitive), false);
  const mismatch = clone(dataEvidence);
  mismatch.envelope.payload.sha256 = "9".repeat(64);
  await assert.rejects(async () => createJointTransferV2({
    dataEvidence: mismatch,
    clusterEvidence,
    sourceSigningPrivateKey: context.keys.source.privateKey,
    receiverReceiptPublicKey: context.keys.receipt.publicKey,
    acceptedAt: jointAcceptedAt,
    evidenceScope: "SYNTHETIC_TEST_ONLY",
  }), expectCode("JOINT_DATA_ENVELOPE_SIGNATURE_INVALID"));
  const tamperedJoint = clone(joint);
  tamperedJoint.cluster.snapshot_sha256 = "8".repeat(64);
  assert.throws(() => verifyJointTransferV2({
    joint: tamperedJoint,
    dataEvidence,
    clusterEvidence,
    sourceSigningPublicKey: context.keys.source.publicKey,
    receiverReceiptPublicKey: context.keys.receipt.publicKey,
  }), expectCode("JOINT_TRANSFER_BINDING_INVALID", "JOINT_TRANSFER_SIGNATURE_INVALID"));
}));

test("readiness v4 requires the published recovery state and every cluster-security proof", async () => fixture(async (context) => {
  const clusterChain = await runClusterChain(context);
  const dataEvidence = dataEvidenceFixture(context.keys, {
    backup_id: context.binding.backup_id,
    manifest_sha256: context.binding.manifest_sha256,
    local_receipt_sha256: context.binding.local_receipt_sha256,
    machine_identity_sha256: zero,
  });
  const clusterEvidence = {
    capsule: clusterChain.verified.capsule,
    receiverReceipt: clusterChain.verified.receiverReceipt,
    acceptance: clusterChain.verified.acceptance,
  };
  const joint = createJointTransferV2({
    dataEvidence,
    clusterEvidence,
    sourceSigningPrivateKey: context.keys.source.privateKey,
    receiverReceiptPublicKey: context.keys.receipt.publicKey,
    acceptedAt: jointAcceptedAt,
    evidenceScope: "SYNTHETIC_TEST_ONLY",
  });
  const dataReadiness = syntheticDataReadiness(context, dataEvidence);
  const recovery = syntheticClusterRecovery(context, joint);
  const options = {
    policy: context.policy,
    dataReadiness,
    jointTransfer: joint,
    dataEvidence,
    clusterEvidence,
    sourceSigningPublicKey: context.keys.source.publicKey,
    receiverReceiptPublicKey: context.keys.receipt.publicKey,
    recoveryIntent: recovery.recoveryIntent,
    recoveryStates: recovery.recoveryStates,
    clusterSecurityReceipt: recovery.clusterSecurityReceipt,
    credentialBindingReceipt: recovery.credentialReceipt,
    tablespaceReceipt: recovery.tablespaceReceipt,
    verifiedAt: "2026-08-13T06:19:00.000Z",
  };
  const readiness = createBackupRecoveryReadinessV4(options);
  assert.equal(validateBackupRecoveryReadinessV4(readiness, context.policy), readiness);
  assert.equal(readiness.attestation, BACKUP_RECOVERY_READINESS_V4_ATTESTATION);
  assert.equal(readiness.status.recovery_execution, "PUBLISHED");
  assert.equal(readiness.status.cluster_security, "VERIFIED");

  const publicEvidence = canonicalTransferJson(readiness);
  for (const sensitive of [
    ...context.policy.roles.map((role) => role.name),
    ...Object.values(context.policy.identities),
    "erp_secret_ts",
    "/synthetic/credential",
  ]) assert.equal(publicEvidence.includes(sensitive), false, sensitive);

  const incomplete = clone(readiness);
  incomplete.recovery_execution.states.pop();
  incomplete.recovery_execution.state_count -= 1;
  incomplete.recovery_execution.state_chain_sha256 = clusterSha256(incomplete.recovery_execution.states.map((state) => state.state_sha256));
  delete incomplete.readiness_sha256;
  incomplete.readiness_sha256 = clusterSha256(incomplete);
  assert.throws(() => validateBackupRecoveryReadinessV4(incomplete, context.policy), expectCode("READINESS_V4_RECOVERY_NOT_PUBLISHED"));

  const wrongTarget = clone(readiness);
  wrongTarget.cluster_security.receipt.target_system_identifier_sha256 = zero;
  const clusterBody = { ...wrongTarget.cluster_security.receipt };
  delete clusterBody.receipt_sha256;
  wrongTarget.cluster_security.receipt.receipt_sha256 = clusterSha256(clusterBody);
  wrongTarget.cluster_security.receipt_sha256 = wrongTarget.cluster_security.receipt.receipt_sha256;
  wrongTarget.cluster_security.target_system_identifier_sha256 = zero;
  delete wrongTarget.readiness_sha256;
  wrongTarget.readiness_sha256 = clusterSha256(wrongTarget);
  assert.throws(() => validateBackupRecoveryReadinessV4(wrongTarget, context.policy), expectCode("READINESS_V4_CLUSTER_CHAIN_MISMATCH"));

  const earlyCluster = clone(readiness);
  earlyCluster.cluster_security.receipt.verified_at = "2026-08-13T06:09:30.000Z";
  const earlyBody = { ...earlyCluster.cluster_security.receipt };
  delete earlyBody.receipt_sha256;
  earlyCluster.cluster_security.receipt.receipt_sha256 = clusterSha256(earlyBody);
  earlyCluster.cluster_security.receipt_sha256 = earlyCluster.cluster_security.receipt.receipt_sha256;
  delete earlyCluster.readiness_sha256;
  earlyCluster.readiness_sha256 = clusterSha256(earlyCluster);
  assert.throws(() => validateBackupRecoveryReadinessV4(earlyCluster, context.policy), expectCode("READINESS_V4_TIME_CHAIN_INVALID"));
  assert.throws(() => createBackupRecoveryReadinessV4({ ...options, verifiedAt: "not-a-time" }), expectCode("READINESS_V4_TIME_INVALID"));

  const receiptRoot = await readinessRoot(context.root);
  const aliasFile = path.join(receiptRoot, "recovery-readiness.json");
  await writeFile(aliasFile, canonicalTransferJson(dataReadiness), { mode: 0o640 });
  await chmod(aliasFile, 0o640);
  await assert.rejects(publishBackupRecoveryReadinessV4({
    readiness,
    policy: context.policy,
    verification: {
      dataEvidence,
      clusterEvidence,
      sourceSigningPublicKey: context.keys.source.publicKey,
      receiverReceiptPublicKey: context.keys.receipt.publicKey,
    },
    receiptRoot,
    receiptReaderGid: process.getgid(),
    confirm: "wrong-confirmation",
  }), expectCode("READINESS_V4_PUBLICATION_CONFIRMATION_REQUIRED"));
  const published = await publishBackupRecoveryReadinessV4({
    readiness,
    policy: context.policy,
    verification: {
      dataEvidence,
      clusterEvidence,
      sourceSigningPublicKey: context.keys.source.publicKey,
      receiverReceiptPublicKey: context.keys.receipt.publicKey,
    },
    receiptRoot,
    receiptReaderGid: process.getgid(),
    confirm: "PUBLISH_SYNTHETIC_CLUSTER_COMPLETE_RECOVERY_EVIDENCE_V4",
  });
  assert.equal(await readFile(published.aliasFile, "utf8"), canonicalTransferJson(readiness));
  assert.equal(await readFile(published.immutableFile, "utf8"), canonicalTransferJson(readiness));
}));
