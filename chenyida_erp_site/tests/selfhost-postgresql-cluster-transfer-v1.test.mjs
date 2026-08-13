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
  createClusterSnapshot,
  normalizeClusterCatalog,
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
