import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { lstat, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKUP_RECOVERY_READINESS_V4_ATTESTATION,
  BACKUP_RECOVERY_READINESS_V4_CONTRACT,
  validateBackupRecoveryReadinessV4,
} from "../../scripts/backup-recovery-readiness-v4.mjs";
import { canonicalTransferJson } from "../../scripts/offhost-transfer-contract.mjs";
import { buildReleaseIdentityFromPostDeployReceipt, validatePostDeployReceipt } from "../../scripts/postdeploy-release-contract.mjs";
import { canonicalClusterJson, clusterPolicySha256, validateClusterRecoveryPolicy } from "../../scripts/postgresql-cluster-recovery-contract.mjs";
import { parseStrictJson, validateReleaseIdentity } from "../../scripts/release-identity-contract.mjs";
import { canonicalJson } from "../../scripts/release-manifest-contract.mjs";
import {
  MONITORING_BACKUP_PROJECTION_CONTRACT,
  createBackupProjection,
  validateBackupProjection,
} from "./backup-projection.mjs";
import {
  MONITORING_COMPONENTS_PROJECTION_CONTRACT,
  createComponentsProjection,
  validateComponentsProjection,
} from "./components-projection.mjs";
import { validateMonitoringHostConfig } from "./delivery-contract.mjs";
import {
  OpsMonitoringError,
  canonicalMonitoringJson,
  monitoringSha256,
} from "./contract.mjs";

export const MONITORING_PROJECTION_PUBLICATION_CONTRACT = "chenyida-erp-monitoring-projection-publication/v1";
export const MONITORING_PROJECTION_ROOT_MARKER = ".chenyida-erp-monitoring-projection-v1";
export const MONITORING_PROJECTION_ROOT_MARKER_VALUE = "chenyida-erp-monitoring-projection/v1\n";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SUPERVISOR_BUNDLE_ROOT = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const PROJECTION_ROOT = "/var/lib/chenyida-erp/monitoring-v1/projections";
const ACTIVE_FILE = "/var/lib/chenyida-erp/monitoring-v1/active.json";
const PRIVATE_CONFIG = "/etc/chenyida-erp/monitoring-v1/private/host-config.json";
const RELEASE_IDENTITY_FILE = "/var/lib/chenyida-erp/release-identity/release-identity.json";
const POSTDEPLOY_ROOT = "/var/lib/chenyida-erp/postdeploy";
const BACKUP_READINESS_FILE = "/var/lib/chenyida-erp/backup-status/recovery-readiness.json";
const CLUSTER_POLICY_FILE = "/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json";
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MODE = /^0[0-7]{3}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZERO_SHA256 = "0".repeat(64);
const SOURCE_FIELDS = Object.freeze(["path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink"]);
const ACTIVE_FIELDS = Object.freeze([
  "schema_version", "contract", "activation_sha256", "activation_id", "status", "installation_generation",
  "monitoring_bundle_sha256", "supervisor_bundle_sha256", "runtime_sha256", "runtime_bytes", "runtime_version",
  "private_config_sha256", "evaluator_config_sha256", "notifier_config_sha256", "evaluator_uid", "evaluator_gid",
  "notifier_uid", "notifier_gid", "state_schema_min", "state_schema_max", "unit_set_sha256",
  "previous_activation_sha256", "committed_at",
]);

function reject(code) {
  throw new OpsMonitoringError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function digest(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) reject(code);
  return value;
}

function identifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function normalizedIso(value, code) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) reject(code);
  return new Date(value).toISOString();
}

function sha256(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function modeOf(metadata) {
  return `0${Number(metadata.mode & 0o7777n).toString(8).padStart(3, "0")}`;
}

function validateSourceSpec(value, code) {
  exactKeys(value, SOURCE_FIELDS, code);
  if (typeof value.path !== "string" || value.path !== path.resolve(value.path) || value.path === "/" || value.path.length > 4096) reject(code);
  digest(value.sha256, code);
  integer(value.bytes, 1, MAX_SOURCE_BYTES, code);
  if (typeof value.device !== "string" || !DECIMAL.test(value.device) || typeof value.inode !== "string" || !/^[1-9][0-9]*$/.test(value.inode)) reject(code);
  integer(value.uid, 0, 2_147_483_647, code);
  integer(value.gid, 0, 2_147_483_647, code);
  if (typeof value.mode !== "string" || !MODE.test(value.mode) || value.nlink !== 1) reject(code);
  return value;
}

function metadataMatches(metadata, spec) {
  return metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1n
    && metadata.dev.toString() === spec.device && metadata.ino.toString() === spec.inode
    && Number(metadata.size) === spec.bytes && Number(metadata.uid) === spec.uid && Number(metadata.gid) === spec.gid
    && modeOf(metadata) === spec.mode;
}

async function readAuthorizedSource(specInput, code) {
  const spec = validateSourceSpec(specInput, code);
  let before;
  let handle;
  try {
    before = await lstat(spec.path, { bigint: true });
    if (!metadataMatches(before, spec)) reject(code);
    handle = await open(spec.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!metadataMatches(opened, spec) || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(spec.path, { bigint: true });
    if (raw.length !== spec.bytes || sha256(raw) !== spec.sha256 || !metadataMatches(after, spec) || !metadataMatches(named, spec)
      || after.dev !== opened.dev || after.ino !== opened.ino || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || named.dev !== opened.dev || named.ino !== opened.ino || named.mtimeNs !== opened.mtimeNs || named.ctimeNs !== opened.ctimeNs) reject(`${code}_CHANGED`);
    return Object.freeze({ raw, text: raw.toString("utf8"), spec });
  } catch (error) {
    if (error instanceof OpsMonitoringError) throw error;
    reject(code);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function validateActive(value) {
  exactKeys(value, ACTIVE_FIELDS, "MONITOR_PROJECTION_ACTIVE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== "chenyida-erp-monitoring-host-activation/v1" || value.status !== "COMMITTED") reject("MONITOR_PROJECTION_ACTIVE_INVALID");
  identifier(value.activation_id, "MONITOR_PROJECTION_ACTIVE_INVALID");
  integer(value.installation_generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_PROJECTION_ACTIVE_INVALID");
  integer(value.runtime_bytes, 1, 256 * 1024 * 1024, "MONITOR_PROJECTION_ACTIVE_INVALID");
  if (typeof value.runtime_version !== "string" || !/^(?:22\.(?:1[3-9]|[2-9][0-9])|23\.[0-9]+|24\.[0-9]+)\.[0-9]+$/.test(value.runtime_version)) reject("MONITOR_PROJECTION_ACTIVE_INVALID");
  for (const field of ["activation_sha256", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "runtime_sha256", "private_config_sha256", "evaluator_config_sha256", "notifier_config_sha256", "unit_set_sha256", "previous_activation_sha256"]) digest(value[field], "MONITOR_PROJECTION_ACTIVE_INVALID");
  for (const field of ["evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid"]) integer(value[field], 1, 2_147_483_647, "MONITOR_PROJECTION_ACTIVE_INVALID");
  if (value.evaluator_uid === value.notifier_uid || value.evaluator_gid === value.notifier_gid || value.state_schema_min !== 1 || value.state_schema_max !== 1) reject("MONITOR_PROJECTION_ACTIVE_INVALID");
  iso(value.committed_at, "MONITOR_PROJECTION_ACTIVE_INVALID");
  const body = { ...value };
  delete body.activation_sha256;
  if (monitoringSha256(body) !== value.activation_sha256) reject("MONITOR_PROJECTION_ACTIVE_INTEGRITY_INVALID");
  return value;
}

function validateContext(value) {
  exactKeys(value, ["schema_version", "contract", "operation", "authorization_sha256", "supervisor_bundle_sha256", "projection_root", "projection", "sources"], "MONITOR_PROJECTION_CONTEXT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_PROJECTION_PUBLICATION_CONTRACT || !new Set(["COMPONENTS", "BACKUP"]).has(value.operation)) reject("MONITOR_PROJECTION_CONTEXT_INVALID");
  digest(value.authorization_sha256, "MONITOR_PROJECTION_CONTEXT_INVALID");
  digest(value.supervisor_bundle_sha256, "MONITOR_PROJECTION_CONTEXT_INVALID");
  if (typeof value.projection_root !== "string" || value.projection_root !== path.resolve(value.projection_root) || value.projection_root === "/") reject("MONITOR_PROJECTION_CONTEXT_INVALID");
  exactKeys(value.projection, ["reader_gid", "generation", "previous_projection_sha256", "published_at", "expected_source_sha256", "expected_projection_sha256"], "MONITOR_PROJECTION_PARAMETERS_INVALID");
  integer(value.projection.reader_gid, 1, 2_147_483_647, "MONITOR_PROJECTION_PARAMETERS_INVALID");
  integer(value.projection.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_PROJECTION_PARAMETERS_INVALID");
  digest(value.projection.previous_projection_sha256, "MONITOR_PROJECTION_PARAMETERS_INVALID");
  digest(value.projection.expected_source_sha256, "MONITOR_PROJECTION_PARAMETERS_INVALID");
  digest(value.projection.expected_projection_sha256, "MONITOR_PROJECTION_PARAMETERS_INVALID");
  iso(value.projection.published_at, "MONITOR_PROJECTION_PARAMETERS_INVALID");
  if ((value.projection.generation === 1) !== (value.projection.previous_projection_sha256 === ZERO_SHA256)) reject("MONITOR_PROJECTION_PARAMETERS_INVALID");
  const sourceKeys = ["active", "host_config", "release_identity", "postdeploy_receipt", ...(value.operation === "BACKUP" ? ["backup_readiness", "cluster_policy"] : [])];
  exactKeys(value.sources, sourceKeys, "MONITOR_PROJECTION_SOURCE_SET_INVALID");
  for (const source of Object.values(value.sources)) validateSourceSpec(source, "MONITOR_PROJECTION_SOURCE_SPEC_INVALID");
  return value;
}

function exactReleaseExpectation(hostConfig, identity) {
  const expected = hostConfig.monitoring.release_expectation;
  if (expected.release_manifest_sha256 !== identity.release_manifest_sha256
    || expected.supervisor_bundle_sha256 !== identity.supervisor_bundle_sha256
    || expected.application_version !== identity.application_version
    || expected.git_commit !== identity.git_commit
    || expected.migration_head !== identity.migration_head
    || expected.migration_manifest_sha256 !== identity.migration_manifest_sha256
    || expected.web_image_digest !== identity.web_image_digest
    || expected.worker_image_digest !== identity.worker_image_digest) reject("MONITOR_PROJECTION_RELEASE_EXPECTATION_MISMATCH");
}

function validateCurrentBinding({ context, active, hostConfig, identity, receipt, receiptSha256, hostConfigSha256 }) {
  if (active.evaluator_gid !== context.projection.reader_gid || active.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256 || active.private_config_sha256 !== hostConfigSha256
    || hostConfig.installation.activation_id !== active.activation_id
    || hostConfig.installation.installation_generation !== active.installation_generation
    || hostConfig.installation.monitoring_bundle_sha256 !== active.monitoring_bundle_sha256
    || hostConfig.installation.supervisor_bundle_sha256 !== active.supervisor_bundle_sha256) reject("MONITOR_PROJECTION_MONITORING_ACTIVATION_MISMATCH");
  if (hostConfig.deployment.class !== identity.deployment_class || hostConfig.deployment.id !== identity.deployment_id
    || receipt.deployment.class !== identity.deployment_class || receipt.deployment.id !== identity.deployment_id
    || receipt.deployment.compose_project !== hostConfig.deployment.compose_project) reject("MONITOR_PROJECTION_DEPLOYMENT_MISMATCH");
  if (hostConfig.evidence.release_activation_id !== receipt.run_id || hostConfig.evidence.release_activated_at !== receipt.generated_at
    || hostConfig.evidence.postdeploy_receipt_sha256 !== receiptSha256
    || hostConfig.evidence.components_producer_bundle_sha256 !== context.supervisor_bundle_sha256
    || hostConfig.evidence.backup_producer_bundle_sha256 !== context.supervisor_bundle_sha256) reject("MONITOR_PROJECTION_EVIDENCE_BINDING_MISMATCH");
  if (context.projection.generation < (context.operation === "COMPONENTS" ? hostConfig.evidence.minimum_components_projection_generation : hostConfig.evidence.minimum_backup_projection_generation)) reject("MONITOR_PROJECTION_GENERATION_BELOW_CONFIG");
  exactReleaseExpectation(hostConfig, identity);
}

async function loadCommonSources(context) {
  const [activeSource, hostSource, identitySource, receiptSource] = await Promise.all([
    readAuthorizedSource(context.sources.active, "MONITOR_PROJECTION_ACTIVE_SOURCE_INVALID"),
    readAuthorizedSource(context.sources.host_config, "MONITOR_PROJECTION_HOST_CONFIG_SOURCE_INVALID"),
    readAuthorizedSource(context.sources.release_identity, "MONITOR_PROJECTION_RELEASE_IDENTITY_SOURCE_INVALID"),
    readAuthorizedSource(context.sources.postdeploy_receipt, "MONITOR_PROJECTION_POSTDEPLOY_SOURCE_INVALID"),
  ]);
  let active;
  let hostConfig;
  let identity;
  let receipt;
  try {
    active = validateActive(parseStrictJson(activeSource.text, 64 * 1024));
    hostConfig = validateMonitoringHostConfig(parseStrictJson(hostSource.text, 256 * 1024));
    identity = validateReleaseIdentity(parseStrictJson(identitySource.text, 64 * 1024));
    receipt = validatePostDeployReceipt(parseStrictJson(receiptSource.text, MAX_SOURCE_BYTES));
  } catch (error) {
    reject(typeof error?.code === "string" ? `MONITOR_PROJECTION_SOURCE_${error.code}` : "MONITOR_PROJECTION_SOURCE_JSON_INVALID");
  }
  if (activeSource.text !== canonicalMonitoringJson(active) || hostSource.text !== canonicalMonitoringJson(hostConfig)
    || identitySource.text !== `${JSON.stringify(identity)}\n` || receiptSource.text !== canonicalJson(receipt)) reject("MONITOR_PROJECTION_SOURCE_NOT_CANONICAL");
  let derived;
  try { derived = buildReleaseIdentityFromPostDeployReceipt({ receipt, receiptSha256: receiptSource.spec.sha256 }); }
  catch (error) { reject(typeof error?.code === "string" ? `MONITOR_PROJECTION_SOURCE_${error.code}` : "MONITOR_PROJECTION_RELEASE_CHAIN_INVALID"); }
  if (canonicalMonitoringJson(derived) !== canonicalMonitoringJson(identity)) reject("MONITOR_PROJECTION_RELEASE_CHAIN_MISMATCH");
  validateCurrentBinding({ context, active, hostConfig, identity, receipt, receiptSha256: receiptSource.spec.sha256, hostConfigSha256: hostSource.spec.sha256 });
  return Object.freeze({ active, hostConfig, identity, receipt, sources: { activeSource, hostSource, identitySource, receiptSource } });
}

function componentsProjection(context, common) {
  const sourceSha256 = monitoringSha256({
    active_activation_sha256: common.active.activation_sha256,
    host_config_sha256: common.sources.hostSource.spec.sha256,
    release_identity_sha256: common.sources.identitySource.spec.sha256,
    postdeploy_receipt_sha256: common.sources.receiptSource.spec.sha256,
  });
  if (sourceSha256 !== context.projection.expected_source_sha256) reject("MONITOR_COMPONENTS_SOURCE_SHA256_MISMATCH");
  const observedAt = common.receipt.generated_at;
  const projection = createComponentsProjection({
    schema_version: 1,
    contract: MONITORING_COMPONENTS_PROJECTION_CONTRACT,
    projection_id: `components-${context.projection.generation}-${sourceSha256.slice(0, 24)}`,
    generation: context.projection.generation,
    previous_projection_sha256: context.projection.previous_projection_sha256,
    producer: { bundle_sha256: context.supervisor_bundle_sha256, source_sha256: sourceSha256 },
    published_at: context.projection.published_at,
    release_binding: { activation_id: common.receipt.run_id, activated_at: observedAt, postdeploy_receipt_sha256: common.sources.receiptSource.spec.sha256 },
    application: {
      live: { status: "PASS", observed_at: observedAt, version: common.receipt.source.application_version, code: null },
      readiness: { status: "READY", observed_at: observedAt, version: common.receipt.readiness.version, revision: common.receipt.readiness.revision, migration_head: common.receipt.readiness.migration_head, code: null },
    },
    release: {
      status: "MATCHED", observed_at: observedAt, generated_at: common.identity.generated_at,
      release_manifest_sha256: common.identity.release_manifest_sha256,
      supervisor_bundle_sha256: common.identity.supervisor_bundle_sha256,
      application_version: common.identity.application_version, git_commit: common.identity.git_commit,
      migration_head: common.identity.migration_head, migration_manifest_sha256: common.identity.migration_manifest_sha256,
      web_image_digest: common.identity.web_image_digest, worker_image_digest: common.identity.worker_image_digest,
    },
  });
  if (projection.projection_sha256 !== context.projection.expected_projection_sha256) reject("MONITOR_COMPONENTS_PROJECTION_SHA256_MISMATCH");
  return Object.freeze({ projection, sourceSha256 });
}

function backupProjectionFromValidatedReadiness(context, common, readiness, policy, readinessSource, now) {
  if (readiness.schema_version !== 4 || readiness.contract !== BACKUP_RECOVERY_READINESS_V4_CONTRACT
    || readiness.result !== "RECOVERY_READY" || readiness.evidence_scope !== "ACTUAL_OFFHOST"
    || readiness.attestation !== BACKUP_RECOVERY_READINESS_V4_ATTESTATION) reject("MONITOR_BACKUP_ACTUAL_V4_REQUIRED");
  if (readiness.readiness_sha256 !== context.projection.expected_source_sha256) reject("MONITOR_BACKUP_SOURCE_SHA256_MISMATCH");
  const publicationTime = Date.parse(context.projection.published_at);
  if (Date.parse(readiness.verified_at) > publicationTime || Date.parse(readiness.expires_at) <= publicationTime
    || Date.parse(readiness.expires_at) <= now.getTime()) reject("MONITOR_BACKUP_SOURCE_TIME_INVALID");
  const restore = readiness.data_readiness?.receipt?.inner_restore?.receipt;
  const operations = readiness.data_readiness?.receipt?.operations;
  if (!restore || !operations) reject("MONITOR_BACKUP_SOURCE_CHAIN_INVALID");
  if (restore.deployment.class !== common.identity.deployment_class || restore.deployment.id !== common.identity.deployment_id
    || restore.application.version !== common.identity.application_version || restore.application.git_commit !== common.identity.git_commit
    || restore.application.web_image_digest !== common.identity.web_image_digest || restore.application.worker_image_digest !== common.identity.worker_image_digest
    || restore.migration.head !== common.identity.migration_head || restore.migration.manifest_sha256 !== common.identity.migration_manifest_sha256) reject("MONITOR_BACKUP_RUNTIME_IDENTITY_MISMATCH");
  const expectation = common.hostConfig.monitoring.backup_expectation;
  if (restore.policy.id !== expectation.policy_id || restore.policy.rpo_hours !== expectation.rpo_hours
    || operations.policy_id !== expectation.policy_id || readiness.cluster_security?.policy_sha256 !== clusterPolicySha256(policy)) reject("MONITOR_BACKUP_POLICY_MISMATCH");
  const projection = createBackupProjection({
    schema_version: 1,
    contract: MONITORING_BACKUP_PROJECTION_CONTRACT,
    projection_id: `backup-${context.projection.generation}-${readiness.readiness_sha256.slice(0, 24)}`,
    generation: context.projection.generation,
    previous_projection_sha256: context.projection.previous_projection_sha256,
    producer: { bundle_sha256: context.supervisor_bundle_sha256, policy_sha256: operations.policy_sha256, source_readiness_sha256: readiness.readiness_sha256 },
    published_at: context.projection.published_at,
    verified_at: normalizedIso(readiness.verified_at, "MONITOR_BACKUP_SOURCE_TIME_INVALID"),
    recovery_point_at: normalizedIso(restore.consistency.recovery_point_at, "MONITOR_BACKUP_SOURCE_TIME_INVALID"),
    expires_at: normalizedIso(readiness.expires_at, "MONITOR_BACKUP_SOURCE_TIME_INVALID"),
    release: {
      activation_id: common.receipt.run_id, activated_at: common.receipt.generated_at,
      postdeploy_receipt_sha256: common.sources.receiptSource.spec.sha256,
      release_manifest_sha256: common.identity.release_manifest_sha256,
      application_version: common.identity.application_version, git_commit: common.identity.git_commit,
    },
    backup: {
      verification_status: "RECOVERY_READY", evidence_scope: "ACTUAL_OFFHOST", transfer_status: "VERIFIED", encryption_status: "VERIFIED",
      cluster_transfer_status: "VERIFIED", cluster_security_status: "VERIFIED", credential_binding_status: "VERIFIED", tablespace_status: "VERIFIED",
      recovery_execution_status: "PUBLISHED", schedule_status: "ON_TIME", retention_status: "POLICY_VALID_DRY_RUN",
      identity_status: "MATCHED", policy_status: "MATCHED", assurance_status: "MATCHED", recovery_ready: true,
      policy_id: expectation.policy_id, rpo_hours: expectation.rpo_hours,
    },
  });
  if (readinessSource.spec.sha256 !== sha256(Buffer.from(canonicalTransferJson(readiness)))) reject("MONITOR_BACKUP_SOURCE_NOT_CANONICAL");
  if (projection.projection_sha256 !== context.projection.expected_projection_sha256) reject("MONITOR_BACKUP_PROJECTION_SHA256_MISMATCH");
  return Object.freeze({ projection, sourceSha256: readiness.readiness_sha256 });
}

async function backupProjection(context, common, validator, now) {
  const [readinessSource, policySource] = await Promise.all([
    readAuthorizedSource(context.sources.backup_readiness, "MONITOR_BACKUP_READINESS_SOURCE_INVALID"),
    readAuthorizedSource(context.sources.cluster_policy, "MONITOR_BACKUP_POLICY_SOURCE_INVALID"),
  ]);
  let readinessInput;
  let policy;
  let readiness;
  try {
    readinessInput = parseStrictJson(readinessSource.text, MAX_SOURCE_BYTES);
    policy = validateClusterRecoveryPolicy(parseStrictJson(policySource.text, MAX_SOURCE_BYTES));
    readiness = validator(readinessInput, policy);
  } catch (error) {
    reject(typeof error?.code === "string" ? `MONITOR_BACKUP_SOURCE_${error.code}` : "MONITOR_BACKUP_SOURCE_INVALID");
  }
  if (policySource.text !== canonicalClusterJson(policy) || policySource.spec.sha256 !== sha256(policySource.raw)) reject("MONITOR_BACKUP_POLICY_SHA256_MISMATCH");
  return backupProjectionFromValidatedReadiness(context, common, readiness, policy, readinessSource, now);
}

async function syncDirectory(directory, code) {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
}

async function trustedProjectionDirectory(directory, gid, code) {
  let metadata;
  try { metadata = await lstat(directory); }
  catch { reject(code); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== gid || (metadata.mode & 0o7777) !== 0o750 || await realpath(directory) !== directory) reject(code);
  return directory;
}

async function assertTrustedProjectionMarker(file, gid) {
  const code = "MONITOR_PROJECTION_ROOT_MARKER_INVALID";
  let handle;
  try {
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== 0n || before.gid !== BigInt(gid)
      || Number(before.mode & 0o7777n) !== 0o400) reject(code);
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) reject(code);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (raw.toString("utf8") !== MONITORING_PROJECTION_ROOT_MARKER_VALUE || after.dev !== opened.dev || after.ino !== opened.ino
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || named.dev !== opened.dev || named.ino !== opened.ino
      || named.mtimeNs !== opened.mtimeNs || named.ctimeNs !== opened.ctimeNs || named.nlink !== 1n || named.uid !== 0n
      || named.gid !== BigInt(gid) || Number(named.mode & 0o7777n) !== 0o400) reject(code);
  } catch (error) {
    if (error instanceof OpsMonitoringError) throw error;
    reject(code);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function trustedProjectionFile(file, gid, validator, code) {
  const metadata = await lstat(file, { bigint: true }).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata === null) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.uid !== 0n || metadata.gid !== BigInt(gid)
    || Number(metadata.mode & 0o7777n) !== 0o440 || metadata.size < 2n || metadata.size > BigInt(MAX_SOURCE_BYTES)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = (value) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs];
    if (identity(opened).some((value, index) => value !== identity(metadata)[index]) || opened.nlink !== 1n || opened.uid !== 0n
      || opened.gid !== BigInt(gid) || Number(opened.mode & 0o7777n) !== 0o440) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (raw.length !== Number(opened.size) || identity(after).some((value, index) => value !== identity(opened)[index])
      || identity(named).some((value, index) => value !== identity(opened)[index]) || named.nlink !== 1n || named.uid !== 0n
      || named.gid !== BigInt(gid) || Number(named.mode & 0o7777n) !== 0o440) reject(`${code}_CHANGED`);
    let value;
    try { value = validator(parseStrictJson(raw.toString("utf8"), MAX_SOURCE_BYTES)); }
    catch { reject(code); }
    if (raw.toString("utf8") !== canonicalMonitoringJson(value)) reject(code);
    return Object.freeze({ raw, value });
  } finally { await handle.close(); }
}

async function writeExclusive(file, raw, gid, code) {
  let handle;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(raw);
    await handle.chown(0, gid);
    await handle.chmod(0o440);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") reject(code);
    return false;
  } finally { await handle?.close().catch(() => undefined); }
  return true;
}

async function ensureExactFile(file, raw, gid, validator, code) {
  await writeExclusive(file, raw, gid, code);
  const existing = await trustedProjectionFile(file, gid, validator, code);
  if (!existing || !existing.raw.equals(raw)) reject(code);
}

async function reconcileIncompleteCandidateFile(file, raw, gid, validator, removable, code) {
  const metadata = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata === null) return;
  if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && metadata.uid === 0 && metadata.gid === gid
    && (metadata.mode & 0o7777) === 0o440 && metadata.size >= 2 && metadata.size <= MAX_SOURCE_BYTES) {
    let stored = null;
    try {
      stored = await trustedProjectionFile(file, gid, validator, code);
    } catch (error) {
      if (!removable || !(error instanceof OpsMonitoringError)) throw error;
    }
    if (stored?.raw.equals(raw)) return;
    if (stored !== null) reject(code);
  }
  if (!removable || !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== 0
    || !new Set([0, gid]).has(metadata.gid) || !new Set([0o600, 0o440]).has(metadata.mode & 0o7777)
    || metadata.size < 0 || metadata.size > raw.length) reject(code);
  try { await unlink(file); }
  catch { reject(code); }
  await syncDirectory(path.dirname(file), "MONITOR_PROJECTION_PARTIAL_SYNC_FAILED");
}

async function readProjectionHistory(historyRoot, gid, validator) {
  let names;
  try { names = await readdir(historyRoot); }
  catch { reject("MONITOR_PROJECTION_HISTORY_INVALID"); }
  if (names.length > 100_000) reject("MONITOR_PROJECTION_HISTORY_INVALID");
  const history = [];
  for (const name of names.sort()) {
    const match = /^([0-9]{16})\.([0-9a-f]{64})\.json$/.exec(name);
    if (!match) reject("MONITOR_PROJECTION_HISTORY_INVALID");
    const stored = await trustedProjectionFile(path.join(historyRoot, name), gid, validator, "MONITOR_PROJECTION_HISTORY_INVALID");
    const generation = Number(match[1]);
    if (!stored || !Number.isSafeInteger(generation) || generation < 1 || stored.value.generation !== generation
      || stored.value.projection_sha256 !== match[2]) reject("MONITOR_PROJECTION_HISTORY_INVALID");
    history.push(stored);
  }
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].value.generation !== index + 1
      || history[index].value.previous_projection_sha256 !== (index === 0 ? ZERO_SHA256 : history[index - 1].value.projection_sha256)) reject("MONITOR_PROJECTION_HISTORY_CHAIN_INVALID");
  }
  return history;
}

function assertRecoverableHistoryState(history, current, raw) {
  if (current === null) {
    if (history.length > 1 || history.length === 1 && !history[0].raw.equals(raw)) reject("MONITOR_PROJECTION_HISTORY_STATE_INVALID");
    return;
  }
  const currentIndex = history.findIndex((stored) => stored.raw.equals(current.raw));
  if (currentIndex < 0) reject("MONITOR_PROJECTION_HISTORY_STATE_INVALID");
  if (current.raw.equals(raw)) {
    if (currentIndex !== history.length - 1) reject("MONITOR_PROJECTION_HISTORY_STATE_INVALID");
    return;
  }
  if (currentIndex === history.length - 1) return;
  if (currentIndex !== history.length - 2 || !history.at(-1).raw.equals(raw)) reject("MONITOR_PROJECTION_HISTORY_STATE_INVALID");
}

async function cleanupExactProjectionTemps(root, kind, projection, raw, gid, validator) {
  let names;
  try { names = await readdir(root); }
  catch { reject("MONITOR_PROJECTION_TEMP_CLEANUP_FAILED"); }
  const pattern = new RegExp(`^\\.${kind}\\.[0-9a-f]{64}\\.${projection.projection_sha256}\\.tmp$`);
  let changed = false;
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const temporary = path.join(root, name);
    const stored = await trustedProjectionFile(temporary, gid, validator, "MONITOR_PROJECTION_TEMP_CLEANUP_FAILED");
    if (!stored || !stored.raw.equals(raw)) reject("MONITOR_PROJECTION_TEMP_CLEANUP_FAILED");
    try { await unlink(temporary); }
    catch { reject("MONITOR_PROJECTION_TEMP_CLEANUP_FAILED"); }
    changed = true;
  }
  if (changed) await syncDirectory(root, "MONITOR_PROJECTION_ROOT_SYNC_FAILED");
}

async function publishProjectionFile({ root, gid, kind, projection, authorizationSha256, fault }) {
  await trustedProjectionDirectory(root, gid, "MONITOR_PROJECTION_ROOT_INVALID");
  await assertTrustedProjectionMarker(path.join(root, MONITORING_PROJECTION_ROOT_MARKER), gid);
  const validator = kind === "components" ? validateComponentsProjection : validateBackupProjection;
  const historyRoot = await trustedProjectionDirectory(path.join(root, kind), gid, "MONITOR_PROJECTION_HISTORY_ROOT_INVALID");
  const alias = path.join(root, `${kind}.json`);
  const current = await trustedProjectionFile(alias, gid, validator, "MONITOR_PROJECTION_CURRENT_INVALID");
  const raw = Buffer.from(canonicalMonitoringJson(projection));
  const history = path.join(historyRoot, `${String(projection.generation).padStart(16, "0")}.${projection.projection_sha256}.json`);
  await reconcileIncompleteCandidateFile(history, raw, gid, validator, !current?.raw.equals(raw), "MONITOR_PROJECTION_HISTORY_CONFLICT");
  const existingHistory = await readProjectionHistory(historyRoot, gid, validator);
  assertRecoverableHistoryState(existingHistory, current, raw);
  if (current?.raw.equals(raw)) {
    await ensureExactFile(history, raw, gid, validator, "MONITOR_PROJECTION_HISTORY_CONFLICT");
    await syncDirectory(historyRoot, "MONITOR_PROJECTION_HISTORY_SYNC_FAILED");
    await cleanupExactProjectionTemps(root, kind, projection, raw, gid, validator);
    await syncDirectory(root, "MONITOR_PROJECTION_ROOT_SYNC_FAILED");
    return "ALREADY_PUBLISHED";
  }
  if (current === null) {
    if (projection.generation !== 1 || projection.previous_projection_sha256 !== ZERO_SHA256) reject("MONITOR_PROJECTION_BOOTSTRAP_ANCHOR_REQUIRED");
  } else if (projection.generation !== current.value.generation + 1 || projection.previous_projection_sha256 !== current.value.projection_sha256) reject("MONITOR_PROJECTION_CHAIN_INVALID");
  await ensureExactFile(history, raw, gid, validator, "MONITOR_PROJECTION_HISTORY_CONFLICT");
  await syncDirectory(historyRoot, "MONITOR_PROJECTION_HISTORY_SYNC_FAILED");
  await fault?.("AFTER_HISTORY");
  const temporary = path.join(root, `.${kind}.${authorizationSha256}.${projection.projection_sha256}.tmp`);
  await reconcileIncompleteCandidateFile(temporary, raw, gid, validator, true, "MONITOR_PROJECTION_TEMP_CONFLICT");
  await ensureExactFile(temporary, raw, gid, validator, "MONITOR_PROJECTION_TEMP_CONFLICT");
  await syncDirectory(root, "MONITOR_PROJECTION_ROOT_SYNC_FAILED");
  await fault?.("AFTER_TEMP");
  const beforePublish = await trustedProjectionFile(alias, gid, validator, "MONITOR_PROJECTION_CURRENT_INVALID");
  if (current === null ? beforePublish !== null : beforePublish === null || !beforePublish.raw.equals(current.raw)) reject("MONITOR_PROJECTION_CURRENT_CHANGED");
  await fault?.("BEFORE_ALIAS");
  try { await rename(temporary, alias); }
  catch { reject("MONITOR_PROJECTION_ALIAS_PUBLICATION_FAILED"); }
  await fault?.("AFTER_ALIAS");
  await syncDirectory(root, "MONITOR_PROJECTION_ROOT_SYNC_FAILED");
  const published = await trustedProjectionFile(alias, gid, validator, "MONITOR_PROJECTION_ALIAS_INVALID");
  if (!published || !published.raw.equals(raw)) reject("MONITOR_PROJECTION_ALIAS_INVALID");
  await cleanupExactProjectionTemps(root, kind, projection, raw, gid, validator);
  return "PUBLISHED";
}

function productionPaths(context) {
  if (context.projection_root !== PROJECTION_ROOT || context.sources.active.path !== ACTIVE_FILE || context.sources.host_config.path !== PRIVATE_CONFIG || context.sources.release_identity.path !== RELEASE_IDENTITY_FILE) reject("MONITOR_PROJECTION_PRODUCTION_PATH_INVALID");
  const receipt = context.sources.postdeploy_receipt.path;
  if (path.dirname(path.dirname(receipt)) !== POSTDEPLOY_ROOT || !IDENTIFIER.test(path.basename(path.dirname(receipt)))
    || path.basename(receipt) !== `${path.basename(path.dirname(receipt))}.postdeploy-receipt.json`) reject("MONITOR_PROJECTION_PRODUCTION_PATH_INVALID");
  if (context.operation === "BACKUP") {
    if (context.sources.backup_readiness.path !== BACKUP_READINESS_FILE || context.sources.cluster_policy.path !== CLUSTER_POLICY_FILE) reject("MONITOR_PROJECTION_PRODUCTION_PATH_INVALID");
  }
}

export async function publishMonitoringProjection(contextInput, options = {}) {
  const context = validateContext(contextInput);
  if (options.production !== false) productionPaths(context);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime()) || Date.parse(context.projection.published_at) > now.getTime() + 5 * 60 * 1000) reject("MONITOR_PROJECTION_PUBLICATION_TIME_INVALID");
  const common = await loadCommonSources(context);
  if (Date.parse(context.projection.published_at) < Math.max(Date.parse(common.receipt.generated_at), Date.parse(common.active.committed_at))) reject("MONITOR_PROJECTION_PUBLICATION_TIME_INVALID");
  const built = context.operation === "COMPONENTS"
    ? componentsProjection(context, common)
    : await backupProjection(context, common, options.backupValidator || validateBackupRecoveryReadinessV4, now);
  const kind = context.operation.toLowerCase();
  const result = await publishProjectionFile({ root: context.projection_root, gid: common.active.evaluator_gid, kind, projection: built.projection, authorizationSha256: context.authorization_sha256, fault: options.fault });
  return Object.freeze({ result, kind, generation: built.projection.generation, projection_sha256: built.projection.projection_sha256, source_sha256: built.sourceSha256 });
}

function assertSupervisorControl(context) {
  if (process.getuid?.() !== 0 || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES" || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT) reject("MONITOR_PROJECTION_SUPERVISOR_CONTROL_INVALID");
  const bundleRoot = path.dirname(SITE_ROOT);
  if (path.dirname(bundleRoot) !== SUPERVISOR_BUNDLE_ROOT || path.basename(bundleRoot) !== context.supervisor_bundle_sha256) reject("MONITOR_PROJECTION_SUPERVISOR_CONTROL_INVALID");
  const descriptorText = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/.test(descriptorText || "")) reject("MONITOR_PROJECTION_GLOBAL_LOCK_INVALID");
  const descriptor = Number(descriptorText);
  let opened;
  let named;
  let lockLines;
  try {
    opened = fstatSync(descriptor, { bigint: true });
    named = lstatSync(GLOBAL_RELEASE_LOCK, { bigint: true });
    lockLines = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:"));
  } catch { reject("MONITOR_PROJECTION_GLOBAL_LOCK_INVALID"); }
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || named.uid !== 0n || named.gid !== 0n || named.nlink !== 1n || Number(named.mode & 0o7777n) !== 0o600
    || opened.dev !== named.dev || opened.ino !== named.ino || lockLines.length !== 1 || !/^lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ /.test(lockLines[0])) reject("MONITOR_PROJECTION_GLOBAL_LOCK_INVALID");
}

async function readContext() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_CONTEXT_BYTES) reject("MONITOR_PROJECTION_CONTEXT_INVALID");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let context;
  try { context = validateContext(parseStrictJson(raw, MAX_CONTEXT_BYTES)); }
  catch (error) {
    if (error instanceof OpsMonitoringError) throw error;
    reject("MONITOR_PROJECTION_CONTEXT_INVALID");
  }
  if (raw !== canonicalMonitoringJson(context)) reject("MONITOR_PROJECTION_CONTEXT_NOT_CANONICAL");
  return context;
}

async function main() {
  if (process.argv.length !== 2) reject("MONITOR_PROJECTION_CLI_ARGUMENT_INVALID");
  const context = await readContext();
  assertSupervisorControl(context);
  const result = await publishMonitoringProjection(context);
  process.stdout.write(canonicalMonitoringJson(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${typeof error?.code === "string" ? error.code : "MONITOR_PROJECTION_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
