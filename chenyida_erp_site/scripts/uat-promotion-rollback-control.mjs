import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { validateClusterRecoveryPolicyV2 } from "./postgresql-cluster-recovery-policy-v2-contract.mjs";
import { validateRuntimePrivilegeAccessDocument } from "./postgresql-runtime-privilege-source.mjs";
import { validateRuntimePrivilegeCompiledCatalog } from "./postgresql-runtime-privilege-catalog.mjs";
import { validateRuntimePrivilegePolicy } from "./postgresql-runtime-privilege-policy.mjs";
import { validateRuntimePrivilegeOperatorPolicy } from "./postgresql-runtime-privilege-operator.mjs";
import { validateReconciliation } from "./backup-recovery-contract.mjs";
import { validateUatPromotionComposeDeploymentResult } from "./uat-promotion-compose-deployment-contract.mjs";
import { parseStrictJson, validateReleaseIdentity } from "./release-identity-contract.mjs";
import {
  buildReleaseIdentityFromPostDeployReceipt,
  validatePostDeployReceipt,
  validatePostDeployReadiness,
} from "./postdeploy-release-contract.mjs";
import {
  canonicalJson as releaseCanonicalJson,
  validateReleaseManifest,
} from "./release-manifest-contract.mjs";
import {
  UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION,
  UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES,
  UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS,
  UAT_PROMOTION_ROLLBACK_STAGES,
  assertUatPromotionRollbackExecutionPackageMatchesParameters,
  assertUatPromotionRollbackPostverifyResultMatchesIntent,
  assertUatPromotionRollbackResultMatchesIntent,
  createUatPromotionRollbackCheckIntent,
  createUatPromotionRollbackCheckResult,
  createUatPromotionRollbackPostverifyResult,
  createUatPromotionRollbackResult,
  createUatPromotionRollbackStageIntent,
  createUatPromotionRollbackStageResult,
  validateUatPromotionRollbackCheckIntent,
  validateUatPromotionRollbackCheckResult,
  validateUatPromotionRollbackExecutionPackage,
  validateUatPromotionRollbackPostverifyResult,
  validateUatPromotionRollbackResult,
  validateUatPromotionRollbackSourceSpec,
  validateUatPromotionRollbackStageIntent,
  validateUatPromotionRollbackStageResult,
} from "./uat-promotion-rollback-contract.mjs";
import {
  UAT_PROMOTION_ROLLBACK_RUNTIME_CHECK_SOURCE_ROLES,
  UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_FILE,
  UAT_PROMOTION_ROLLBACK_RUNTIME_STAGE_SOURCE_ROLES,
  UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS,
  uatPromotionRollbackRuntimeTimeoutSeconds,
  createUatPromotionRollbackRuntimeOriginalObservation,
  createUatPromotionRollbackRuntimeRequest,
  createUatPromotionRollbackComposeOverlay,
  deriveUatPromotionRollbackRuntimeProjection,
  deriveUatPromotionRollbackRuntimeSourceRoles,
  deriveUatPromotionRollbackRuntimeTargets,
  validateUatPromotionRollbackRuntimeActivation,
  validateUatPromotionRollbackRuntimeObservation,
  validateUatPromotionRollbackRuntimeResponse,
} from "./uat-promotion-rollback-runtime-contract.mjs";
import {
  UAT_PROMOTION_STATE_ROOT,
  validateUatPromotionContext,
  validateUatPromotionRollbackIntent,
  validateUatPromotionRollbackPostverifyIntent,
} from "./uat-promotion-transaction-journal.mjs";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const SUPERVISOR_BUNDLE_ROOT = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const HASH_BUFFER_BYTES = 1024 * 1024;
const HELPER = path.join(SITE_ROOT, "scripts/uat-promotion-rollback-runtime-adapter.py");
const ZERO_SHA256 = "0".repeat(64);
const MAX_CONTAINMENT_ATTEMPTS = 3;
const HEALTH_DATABASE_TIME_MAX_SKEW_MS = 5_000;

const STAGE_SOURCE_ROLES = UAT_PROMOTION_ROLLBACK_RUNTIME_STAGE_SOURCE_ROLES;
const CHECK_SOURCE_ROLES = UAT_PROMOTION_ROLLBACK_RUNTIME_CHECK_SOURCE_ROLES;

export class UatPromotionRollbackControlError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionRollbackControlError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionRollbackControlError(code); }
function modeOf(metadata) { return Number(metadata.mode & 0o7777n); }
function modeText(metadata) { return modeOf(metadata).toString(8).padStart(4, "0"); }
function operationArtifactMatches(name, operationId) {
  const match = /^(.+)\.([0-9a-f]{64})\.json$/u.exec(name);
  return match !== null && match[1] === operationId;
}
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }
function runtimeExchangeSha256(responses) {
  return clusterSha256(responses.map((response) => ({
    action: response.action,
    request_sha256: response.request_sha256,
    response_sha256: response.response_sha256,
    status: response.status,
  })));
}
function containmentDrift(outcome, observed, responses) {
  return Object.freeze({
    status: "CONTAINMENT_OBSERVATION_DRIFT",
    outcome,
    observed,
    runtime_exchange_sha256: runtimeExchangeSha256(responses),
  });
}
function nowIso(clock = () => new Date()) {
  const observed = clock();
  const value = observed instanceof Date ? observed : new Date(observed);
  if (Number.isNaN(value.getTime())) reject("ROLLBACK_CONTROL_TIME_INVALID");
  return value.toISOString();
}
function physicalPath(logical, filesystemRoot) {
  return filesystemRoot === "/" ? logical : path.join(filesystemRoot, logical.slice(1));
}

async function syncDirectory(directory, code) {
  const handle = await open(
    directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => reject(code));
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isDirectory()) reject(code);
    await handle.sync().catch(() => reject(code));
  } finally { await handle.close(); }
}

async function trustedJson(file, validator, code) {
  const before = await lstat(file, { bigint: true }).catch(() => reject(code));
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n
    || before.nlink !== 1n || modeOf(before) !== 0o400 || before.size < 2n
    || before.size > BigInt(MAX_JSON_BYTES)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) reject(`${code}_CHANGED`);
    let value;
    try { value = validator(parseStrictJson(raw.toString("utf8"), MAX_JSON_BYTES)); }
    catch { reject(code); }
    if (raw.toString("utf8") !== canonicalClusterJson(value)) reject(code);
    return Object.freeze({ raw, value });
  } finally { await handle.close(); }
}

async function immutableJson(file, value, validator, code) {
  const raw = Buffer.from(canonicalClusterJson(value));
  let handle;
  let created = false;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    created = true;
    await handle.writeFile(raw);
    await handle.chown(0, 0);
    await handle.chmod(0o400);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") reject(code);
  } finally { await handle?.close().catch(() => undefined); }
  if (created) await syncDirectory(path.dirname(file), `${code}_SYNC_FAILED`);
  const stored = await trustedJson(file, validator, code);
  if (!stored.raw.equals(raw)) reject(code);
}

async function verifySource(specInput, filesystemRoot, code) {
  const spec = validateUatPromotionRollbackSourceSpec(specInput, code);
  const file = physicalPath(spec.path, filesystemRoot);
  const before = await lstat(file, { bigint: true }).catch(() => reject(code));
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== BigInt(spec.uid)
    || before.gid !== BigInt(spec.gid) || before.nlink !== BigInt(spec.nlink)
    || before.dev.toString() !== spec.device || before.ino.toString() !== spec.inode
    || before.size !== BigInt(spec.bytes) || modeText(before) !== spec.mode) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) reject(`${code}_CHANGED`);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let position = 0;
    while (position < spec.bytes) {
      const wanted = Math.min(buffer.length, spec.bytes - position);
      const { bytesRead } = await handle.read(buffer, 0, wanted, position);
      if (bytesRead < 1) reject(code);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || hash.digest("hex") !== spec.sha256) reject(`${code}_CHANGED`);
  } finally { await handle.close(); }
  return spec;
}

async function verifyPackageSources(packageValue, filesystemRoot, roles) {
  for (const role of roles) {
    if (!UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES.includes(role)) {
      reject("ROLLBACK_CONTROL_EXECUTION_PACKAGE_INVALID");
    }
    await verifySource(
      packageValue.sources[role], filesystemRoot,
      `ROLLBACK_CONTROL_PACKAGE_SOURCE_${role.toUpperCase()}_INVALID`,
    );
  }
}

async function executionRoot(context, intentSha256, filesystemRoot, recovery) {
  const parent = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/executions`, filesystemRoot);
  const parentMetadata = await lstat(parent, { bigint: true }).catch(() => reject("ROLLBACK_CONTROL_STATE_INVALID"));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || parentMetadata.uid !== 0n
    || parentMetadata.gid !== 0n || modeOf(parentMetadata) !== 0o700) reject("ROLLBACK_CONTROL_STATE_INVALID");
  const root = path.join(parent, `${context.operation_id}.${intentSha256}`);
  try {
    await mkdir(root, { mode: 0o700 });
    await chown(root, 0, 0);
    await chmod(root, 0o700);
    await syncDirectory(parent, "ROLLBACK_CONTROL_STATE_SYNC_FAILED");
  } catch (error) {
    if (error?.code !== "EEXIST" || !recovery) reject("ROLLBACK_CONTROL_EXECUTION_ALREADY_EXISTS");
  }
  const metadata = await lstat(root, { bigint: true }).catch(() => reject("ROLLBACK_CONTROL_STATE_INVALID"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0n
    || metadata.gid !== 0n || modeOf(metadata) !== 0o700) reject("ROLLBACK_CONTROL_STATE_INVALID");
  return root;
}

async function trustedIntent(context, expectedIntentSha256, filesystemRoot) {
  const postverify = context.operation === "ROLLBACK_POSTVERIFY";
  const validator = postverify ? validateUatPromotionRollbackPostverifyIntent : validateUatPromotionRollbackIntent;
  const file = physicalPath(
    `${UAT_PROMOTION_STATE_ROOT}/intents/${context.operation_id}.${expectedIntentSha256}.json`, filesystemRoot,
  );
  const stored = await trustedJson(file, validator, "ROLLBACK_CONTROL_INTENT_INVALID");
  const actual = postverify ? stored.value.postverify_intent_sha256 : stored.value.rollback_intent_sha256;
  if (actual !== expectedIntentSha256
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || !same(stored.value.parameters, context.parameters)) reject("ROLLBACK_CONTROL_INTENT_BINDING_INVALID");
  return stored.value;
}

async function trustedSourceJson(spec, filesystemRoot, validator, code) {
  await verifySource(spec, filesystemRoot, code);
  const stored = await trustedJson(physicalPath(spec.path, filesystemRoot), validator, code);
  if (createHash("sha256").update(stored.raw).digest("hex") !== spec.sha256) reject(code);
  return stored.value;
}

async function trustedSourceDocument(specInput, filesystemRoot, validator, code) {
  const spec = validateUatPromotionRollbackSourceSpec(specInput, code);
  const file = physicalPath(spec.path, filesystemRoot);
  const before = await lstat(file, { bigint: true }).catch(() => reject(code));
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== BigInt(spec.uid)
    || before.gid !== BigInt(spec.gid) || before.nlink !== BigInt(spec.nlink)
    || before.dev.toString() !== spec.device || before.ino.toString() !== spec.inode
    || before.size !== BigInt(spec.bytes) || before.size > BigInt(MAX_JSON_BYTES)
    || modeText(before) !== spec.mode) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true }).catch(() => reject(`${code}_CHANGED`));
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || named.dev !== opened.dev || named.ino !== opened.ino || named.size !== opened.size
      || createHash("sha256").update(raw).digest("hex") !== spec.sha256) reject(`${code}_CHANGED`);
    let value;
    try { value = validator(parseStrictJson(raw.toString("utf8"), MAX_JSON_BYTES)); }
    catch { reject(code); }
    const text = raw.toString("utf8");
    if (text !== canonicalClusterJson(value) && text !== releaseCanonicalJson(value)
      && text !== `${JSON.stringify(value, null, 2)}\n`) reject(code);
    return value;
  } finally { await handle.close(); }
}

async function verifyTrustedParentChain(file, filesystemRoot, code) {
  const boundary = path.resolve(filesystemRoot);
  let current = path.dirname(path.resolve(file));
  while (true) {
    const metadata = await lstat(current, { bigint: true }).catch(() => reject(code));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || metadata.uid !== 0n || metadata.gid !== 0n || (modeOf(metadata) & 0o022) !== 0) reject(code);
    if (current === boundary) return;
    const parent = path.dirname(current);
    if (parent === current || boundary !== "/" && !parent.startsWith(`${boundary}${path.sep}`)
      && parent !== boundary) reject(code);
    current = parent;
  }
}

async function loadRollbackResultForPostverify(context, filesystemRoot) {
  return trustedSourceJson(
    context.parameters.rollback_result_source, filesystemRoot,
    validateUatPromotionRollbackResult, "ROLLBACK_CONTROL_ROLLBACK_RESULT_INVALID",
  );
}

async function loadExecutionPackage(context, intent, filesystemRoot, rollbackResult = null) {
  let rollbackIntent = intent;
  if (context.operation === "ROLLBACK_POSTVERIFY") {
    rollbackIntent = await trustedSourceJson(
      context.parameters.rollback_intent_source, filesystemRoot,
      validateUatPromotionRollbackIntent, "ROLLBACK_CONTROL_ROLLBACK_INTENT_INVALID",
    );
    if (rollbackResult === null) reject("ROLLBACK_CONTROL_ROLLBACK_RESULT_INVALID");
    assertUatPromotionRollbackResultMatchesIntent(rollbackResult, rollbackIntent);
  }
  const parameters = rollbackIntent.parameters;
  const packageValue = await trustedSourceJson(
    parameters.execution_package_source, filesystemRoot,
    validateUatPromotionRollbackExecutionPackage,
    "ROLLBACK_CONTROL_EXECUTION_PACKAGE_INVALID",
  );
  assertUatPromotionRollbackExecutionPackageMatchesParameters(packageValue, parameters);
  if (rollbackResult !== null && rollbackResult.execution_package_sha256 !== packageValue.package_sha256) {
    reject("ROLLBACK_CONTROL_EXECUTION_PACKAGE_BINDING_INVALID");
  }
  return Object.freeze({ packageValue, rollbackIntent });
}

function reconciliationProjection(source, sourceSha256) {
  const body = {
    source_reconciliation_sha256: sourceSha256,
    database: { report_sha256: source.database.report_sha256 },
    files: Object.fromEntries(["uploads", "attachments", "backup_status"].map((domain) => [domain, {
      tree_sha256: source.files[domain].tree_sha256,
      entries: source.files[domain].entries,
    }])),
  };
  return Object.freeze({ ...body, binding_sha256: clusterSha256(body) });
}

function candidateServiceProjection(result) {
  return Object.fromEntries([...result.unchanged_services, ...result.services].map((service) => [
    service.service,
    {
      service: service.service,
      container_id: service.container_id,
      image_reference: service.image_reference,
      image_digest: service.image_id,
    },
  ]));
}

async function loadRuntimeTrustSources(context, packageValue, filesystemRoot, clock, { full = true } = {}) {
  const sources = packageValue.sources;
  if (sources.runtime_adapter_activation.path !== UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_FILE
    || sources.runtime_adapter_activation.uid !== 0 || sources.runtime_adapter_activation.gid !== 0
    || sources.runtime_adapter_activation.mode !== "0400") reject("ROLLBACK_CONTROL_RUNTIME_ACTIVATION_INVALID");
  await verifyTrustedParentChain(
    physicalPath(sources.runtime_adapter_activation.path, filesystemRoot),
    filesystemRoot, "ROLLBACK_CONTROL_RUNTIME_ACTIVATION_INVALID",
  );
  const activation = await trustedSourceDocument(
    sources.runtime_adapter_activation, filesystemRoot,
    (value) => validateUatPromotionRollbackRuntimeActivation(value, {
      now: clock(), allowExpired: context.execution_mode === "RECOVERY",
      executionDeadline: packageValue.execution_deadline,
    }),
    "ROLLBACK_CONTROL_RUNTIME_ACTIVATION_INVALID",
  );
  if (activation.plan.runtime_plan_sha256 !== packageValue.runtime_plan_sha256) {
    reject("ROLLBACK_CONTROL_RUNTIME_ACTIVATION_BINDING_INVALID");
  }
  const candidateDeployment = await trustedSourceDocument(
    sources.candidate_deployment_result, filesystemRoot, validateUatPromotionComposeDeploymentResult,
    "ROLLBACK_CONTROL_CANDIDATE_DEPLOYMENT_INVALID",
  );
  const candidateIdentity = await trustedSourceDocument(
    sources.candidate_postdeploy_identity, filesystemRoot, validateReleaseIdentity,
    "ROLLBACK_CONTROL_CANDIDATE_IDENTITY_INVALID",
  );
  const plan = activation.plan;
  const reconciliationAuthority = plan.reconciliation_authority;
  const authorityApproved = Date.parse(reconciliationAuthority.approved_at);
  const authorityExpires = Date.parse(reconciliationAuthority.expires_at);
  const observedAt = clock().getTime();
  if (authorityExpires < Date.parse(packageValue.execution_deadline)
    || context.execution_mode === "ORIGINAL"
      && (observedAt < authorityApproved || observedAt >= authorityExpires)) {
    reject("ROLLBACK_CONTROL_RECONCILIATION_AUTHORITY_INVALID");
  }
  const candidateServices = candidateServiceProjection(candidateDeployment);
  const handoff = candidateDeployment.database_handoff;
  if (!same(plan.candidate.services, candidateServices)
    || plan.candidate.protected_resources_sha256 !== candidateDeployment.protected_resources_after_sha256
    || candidateDeployment.protected_resources_before_sha256 !== packageValue.protected_resources_sha256
    || candidateDeployment.protected_resources_after_sha256 !== packageValue.protected_resources_sha256
    || candidateDeployment.compose_project !== packageValue.compose_project
    || candidateDeployment.compose_project_root !== packageValue.compose_project_root
    || !same(plan.deployment.database, {
      name: handoff.database_name, system_identifier: handoff.database_system_identifier,
      oid: handoff.database_oid, marker: handoff.database_marker,
    })
    || candidateIdentity.release_manifest_sha256 !== candidateDeployment.release_manifest_sha256
    || candidateIdentity.deployment_class !== "UAT"
    || candidateIdentity.deployment_id !== packageValue.compose_project
    || ["caddy", "postgres", "web", "worker"].some((service) => (
      candidateIdentity[`${service}_container_id`] !== candidateServices[service].container_id
      || candidateIdentity[`${service}_image_digest`] !== candidateServices[service].image_digest
    ))) reject("ROLLBACK_CONTROL_CANDIDATE_PLAN_BINDING_INVALID");
  if (!full) return Object.freeze({ runtimePlan: plan, candidateDeployment, candidateIdentity });
  const reconciliation = await trustedSourceDocument(
    sources.snapshot_reconciliation, filesystemRoot, validateReconciliation,
    "ROLLBACK_CONTROL_SNAPSHOT_RECONCILIATION_INVALID",
  );
  if (!same(
    packageValue.content_reconciliation,
    reconciliationProjection(reconciliation, sources.snapshot_reconciliation.sha256),
  )) reject("ROLLBACK_CONTROL_SNAPSHOT_RECONCILIATION_BINDING_INVALID");
  const snapshotPolicy = await trustedSourceDocument(
    sources.snapshot_policy, filesystemRoot, validateClusterRecoveryPolicyV2,
    "ROLLBACK_CONTROL_SNAPSHOT_POLICY_INVALID",
  );
  const runtimePrivilegeAccess = await trustedSourceDocument(
    sources.snapshot_runtime_privilege_access, filesystemRoot,
    validateRuntimePrivilegeAccessDocument,
    "ROLLBACK_CONTROL_RUNTIME_PRIVILEGE_ACCESS_INVALID",
  );
  const runtimePrivilegeCatalog = await trustedSourceDocument(
    sources.snapshot_runtime_privilege_compiled_catalog, filesystemRoot,
    (value) => validateRuntimePrivilegeCompiledCatalog(value, { access: runtimePrivilegeAccess }),
    "ROLLBACK_CONTROL_RUNTIME_PRIVILEGE_CATALOG_INVALID",
  );
  const runtimePrivilegePolicy = await trustedSourceDocument(
    sources.snapshot_runtime_privilege_policy, filesystemRoot,
    (value) => validateRuntimePrivilegePolicy(value, {
      access: runtimePrivilegeAccess, catalog: runtimePrivilegeCatalog,
    }),
    "ROLLBACK_CONTROL_RUNTIME_PRIVILEGE_POLICY_INVALID",
  );
  const runtimePrivilegeOperatorPolicy = await trustedSourceDocument(
    sources.snapshot_runtime_privilege_operator_policy, filesystemRoot,
    (value) => validateRuntimePrivilegeOperatorPolicy(value, {
      runtimePolicy: runtimePrivilegePolicy,
      access: runtimePrivilegeAccess,
      catalog: runtimePrivilegeCatalog,
    }),
    "ROLLBACK_CONTROL_RUNTIME_PRIVILEGE_OPERATOR_POLICY_INVALID",
  );
  const privilegeBinding = snapshotPolicy.runtime_privilege_binding;
  if (privilegeBinding.access_sha256 !== runtimePrivilegeAccess.access_sha256
    || privilegeBinding.compiled_catalog_sha256 !== runtimePrivilegeCatalog.catalog_sha256
    || privilegeBinding.compiled_catalog_artifact_sha256 !== runtimePrivilegeCatalog.artifact_sha256
    || privilegeBinding.policy_sha256 !== runtimePrivilegePolicy.policy_sha256
    || privilegeBinding.operator_policy_sha256 !== runtimePrivilegeOperatorPolicy.policy_sha256
    || privilegeBinding.file_sha256 !== sources.snapshot_runtime_privilege_policy.sha256
    || privilegeBinding.operator_policy_file_sha256
      !== sources.snapshot_runtime_privilege_operator_policy.sha256
    || runtimePrivilegePolicy.source_binding.access_intent.file_sha256
      !== sources.snapshot_runtime_privilege_access.sha256
    || runtimePrivilegePolicy.source_binding.compiled_catalog.file_sha256
      !== sources.snapshot_runtime_privilege_compiled_catalog.sha256
    || runtimePrivilegeCatalog.source_binding.access_intent.file_sha256
      !== sources.snapshot_runtime_privilege_access.sha256) {
    reject("ROLLBACK_CONTROL_RUNTIME_PRIVILEGE_BINDING_INVALID");
  }
  const predecessorReceipt = await trustedSourceDocument(
    sources.predecessor_postdeploy_receipt, filesystemRoot, validatePostDeployReceipt,
    "ROLLBACK_CONTROL_PREDECESSOR_RECEIPT_INVALID",
  );
  const predecessorManifest = await trustedSourceDocument(
    sources.predecessor_release_manifest, filesystemRoot,
    (value) => validateReleaseManifest(value, { requireEligible: false }),
    "ROLLBACK_CONTROL_PREDECESSOR_MANIFEST_INVALID",
  );
  const predecessorIdentity = buildReleaseIdentityFromPostDeployReceipt({
    receipt: predecessorReceipt, receiptSha256: sources.predecessor_postdeploy_receipt.sha256,
  });
  const predecessorServices = Object.fromEntries(predecessorReceipt.services.map((service) => [service.service, service]));
  const predecessor = packageValue.predecessor;
  if (sources.predecessor_release_manifest.sha256 !== predecessor.release_manifest_sha256
    || predecessorReceipt.release.manifest_sha256 !== predecessor.release_manifest_sha256
    || predecessorManifest.source.git_commit !== predecessor.git_commit
    || predecessorManifest.source.git_tree !== predecessor.git_tree
    || predecessorManifest.source.package_version !== predecessor.application_version
    || predecessorManifest.migrations.head !== predecessor.migration_head
    || predecessorManifest.migrations.allowlist_sha256 !== predecessor.migration_manifest_sha256
    || predecessorManifest.images.web.image_reference !== predecessor.web_image
    || plan.predecessor.web_image_config_digest
      !== predecessorManifest.images.web.image_digest
    || predecessorManifest.images.worker.image_reference !== predecessor.worker_image
    || plan.predecessor.worker_image_config_digest
      !== predecessorManifest.images.worker.image_digest
    || predecessorReceipt.runtime_configuration_sha256 !== predecessor.runtime_configuration_sha256
    || predecessorServices.web.image_reference !== predecessor.web_image
    || predecessorServices.worker.image_reference !== predecessor.worker_image
    || predecessorIdentity.release_manifest_sha256 !== predecessor.release_manifest_sha256
    || predecessorIdentity.application_version !== predecessor.application_version
    || predecessorIdentity.git_commit !== predecessor.git_commit
    || predecessorIdentity.git_tree !== predecessor.git_tree
    || predecessorIdentity.migration_head !== predecessor.migration_head
    || predecessorIdentity.migration_manifest_sha256 !== predecessor.migration_manifest_sha256) {
    reject("ROLLBACK_CONTROL_PREDECESSOR_BINDING_INVALID");
  }
  return Object.freeze({
    runtimePlan: plan, reconciliation, candidateDeployment, candidateIdentity,
    predecessorReceipt, predecessorManifest, predecessorIdentity, snapshotPolicy,
    runtimePrivilegeAccess, runtimePrivilegeCatalog, runtimePrivilegePolicy,
    runtimePrivilegeOperatorPolicy,
  });
}

function terminateProcessGroup(child, signal) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processGroupExists(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) return false;
  try { process.kill(-child.pid, 0); return true; } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function killAndConfirmProcessGroup(child, timeoutMs = 2_000) {
  try { terminateProcessGroup(child, "SIGKILL"); } catch { return false; }
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(child);
}

function boundedProcess(binary, argumentsList, options) {
  return new Promise((resolve, fail) => {
    const child = spawn(binary, argumentsList, {
      cwd: "/", env: options.env, detached: true, stdio: options.stdio,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failureCode = null;
    let killTimer = null;
    let settled = false;
    const watchedSignals = ["SIGTERM", "SIGINT", "SIGHUP"];
    const removeHandlers = () => {
      for (const watched of watchedSignals) process.removeListener(watched, signalHandlers[watched]);
      process.removeListener("exit", exitHandler);
    };
    const requestTermination = (code) => {
      if (failureCode === null) failureCode = code;
      try { terminateProcessGroup(child, "SIGTERM"); } catch { failureCode = code; }
      if (killTimer === null) {
        killTimer = setTimeout(() => {
          try { terminateProcessGroup(child, "SIGKILL"); } catch { /* close handler rejects */ }
        }, options.killGraceMs ?? 7_000);
        killTimer.unref?.();
      }
    };
    const signalHandlers = Object.fromEntries(watchedSignals.map((watched) => [watched, () => {
      requestTermination(options.failureCode);
    }]));
    const exitHandler = () => {
      try { terminateProcessGroup(child, "SIGKILL"); } catch { /* best effort during exit */ }
    };
    for (const watched of watchedSignals) process.once(watched, signalHandlers[watched]);
    process.once("exit", exitHandler);
    const timeout = setTimeout(() => requestTermination(options.failureCode), options.timeoutMs);
    timeout.unref?.();
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_JSON_BYTES) requestTermination(options.failureCode);
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_JSON_BYTES) requestTermination(options.failureCode);
      else stderr.push(chunk);
    });
    child.once("error", () => requestTermination(options.failureCode));
    child.once("close", async (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer !== null) clearTimeout(killTimer);
      removeHandlers();
      if (processGroupExists(child)) {
        if (!await killAndConfirmProcessGroup(child)) failureCode = options.failureCode;
        failureCode = options.failureCode;
      }
      if (failureCode !== null || status !== 0 || signal !== null || stderrBytes !== 0
        || stdoutBytes < 2 || stdoutBytes > MAX_JSON_BYTES) {
        fail(new UatPromotionRollbackControlError(options.failureCode));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
    child.stdin.once("error", () => requestTermination(options.failureCode));
    child.stdin.end(options.input);
  });
}

function transactionIntentSha256(context, intent) {
  return context.operation === "ROLLBACK_POSTVERIFY"
    ? intent.postverify_intent_sha256 : intent.rollback_intent_sha256;
}

function recordIntentSha256(recordIntent) {
  if (recordIntent?.stage_intent_sha256) return recordIntent.stage_intent_sha256;
  if (recordIntent?.check_intent_sha256) return recordIntent.check_intent_sha256;
  if (recordIntent?.containment_intent_sha256) return recordIntent.containment_intent_sha256;
  return ZERO_SHA256;
}

async function invokeHelper({
  context, intent, packageValue, rollbackResult = null, consumed, action, label = null,
  recordIntent = null, previousResultSha256 = ZERO_SHA256, requestedAt = nowIso(), extra = {},
}) {
  const descriptor = Number(process.env.ERP_RELEASE_GATE_LOCK_FD);
  const stdio = ["pipe", "pipe", "pipe"];
  for (let index = 3; index <= descriptor; index += 1) stdio[index] = "ignore";
  stdio[descriptor] = descriptor;
  const argumentsList = [HELPER, action.toLowerCase(), context.operation_id];
  if (label !== null) argumentsList.push(label);
  const payload = {
    context, transaction_intent: intent, execution_package: packageValue,
    ...(rollbackResult === null ? {} : { rollback_result: rollbackResult }),
    ...(recordIntent === null ? {} : { record_intent: recordIntent }),
    ...extra,
  };
  const policyTimeout = uatPromotionRollbackRuntimeTimeoutSeconds(action, label) * 1_000;
  const requestedMs = Date.parse(requestedAt);
  const authorizationExpiresAt = process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_EXPIRES_AT;
  const authorizationExpiresMs = Date.parse(authorizationExpiresAt || "");
  const packageDeadlineMs = Date.parse(packageValue.execution_deadline);
  if (![requestedMs, authorizationExpiresMs, packageDeadlineMs].every(Number.isFinite)) {
    reject("ROLLBACK_CONTROL_EXECUTION_DEADLINE_INVALID");
  }
  const actionDeadlineMs = Math.min(
    requestedMs + policyTimeout,
    authorizationExpiresMs,
    context.execution_mode === "ORIGINAL" ? packageDeadlineMs : Number.POSITIVE_INFINITY,
  );
  if (actionDeadlineMs <= requestedMs) reject("ROLLBACK_CONTROL_EXECUTION_DEADLINE_EXPIRED");
  const actionDeadline = new Date(actionDeadlineMs).toISOString();
  const sourceRoles = deriveUatPromotionRollbackRuntimeSourceRoles({ action, operation: context.operation, label });
  const request = createUatPromotionRollbackRuntimeRequest({
    action, operation: context.operation, operation_id: context.operation_id,
    execution_mode: context.execution_mode, label,
    execution_package_sha256: packageValue.package_sha256,
    source_set_sha256: packageValue.source_set_sha256,
    transaction_intent_sha256: transactionIntentSha256(context, intent),
    record_intent_sha256: recordIntentSha256(recordIntent),
    runtime_plan_sha256: packageValue.runtime_plan_sha256,
    previous_result_sha256: previousResultSha256,
    source_roles: sourceRoles,
    payload, requested_at: requestedAt, execution_deadline: packageValue.execution_deadline,
    authorization_expires_at: authorizationExpiresAt, action_deadline: actionDeadline,
  });
  const remaining = actionDeadlineMs - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) reject("ROLLBACK_CONTROL_EXECUTION_DEADLINE_EXPIRED");
  const failureCode = action === "CONTAIN"
    ? "ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"
    : action === "PREFLIGHT" ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_FAILED"
      : "ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED";
  let stdout;
  try {
    stdout = await boundedProcess("/usr/bin/python3", argumentsList, {
      env: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent", PYTHONDONTWRITEBYTECODE: "1",
      PYTHONHASHSEED: "0", ERP_RELEASE_SUPERVISOR_LAUNCHED: "YES",
      ERP_RELEASE_GATE_LOCK_HELD: "YES", ERP_RELEASE_GATE_LOCK_FD: String(descriptor),
      ERP_RELEASE_SUPERVISOR_SITE_ROOT: SITE_ROOT,
      ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256: context.supervisor_bundle_sha256,
      ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256: context.execution_authorization_sha256,
      ERP_RELEASE_SUPERVISOR_AUTHORIZATION_EXPIRES_AT: authorizationExpiresAt,
      ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED: consumed ? "YES" : "NO",
      ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED:
        context.execution_mode === "RECOVERY" ? "YES" : "NO",
      },
      input: Buffer.from(canonicalClusterJson(request)), stdio,
      timeoutMs: Math.max(1, remaining + 7_000), killGraceMs: 7_000, failureCode,
    });
  } catch (error) { reject(error?.code || failureCode); }
  try {
    const response = validateUatPromotionRollbackRuntimeResponse(
      parseStrictJson(stdout.toString("utf8"), MAX_JSON_BYTES), request,
    );
    if (stdout.toString("utf8") !== canonicalClusterJson(response)) {
      reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_RESPONSE_INVALID");
    }
    return response;
  } catch (error) { reject(error?.code || "ROLLBACK_CONTROL_RUNTIME_ADAPTER_RESPONSE_INVALID"); }
}

function productionAdapter(context, intent) {
  return Object.freeze({
    async preflight({ packageValue, rollbackResult }) {
      const response = await invokeHelper({
        context, intent, packageValue, rollbackResult,
        consumed: false,
        action: "PREFLIGHT",
      });
      const allowed = context.execution_mode === "ORIGINAL"
        ? new Set([context.operation === "ROLLBACK_POSTVERIFY"
          ? "EXACT_RESULT_ALREADY_DURABLE" : "SAFE_TO_EXECUTE"])
        : new Set([
          "EXACT_RESULT_ALREADY_DURABLE", "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
          "BLOCKED_TARGET_IDENTITY_MISMATCH",
        ]);
      if (!allowed.has(response.status)) reject("ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID");
      return response.output;
    },
    async recheck({ packageValue, rollbackResult, containment = false }) {
      const response = await invokeHelper({
        context, intent, packageValue, rollbackResult, consumed: true, action: "RECHECK",
      });
      const allowed = containment
        ? new Set([
          "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
          "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT", "BLOCKED_TARGET_IDENTITY_MISMATCH",
        ])
        : context.execution_mode === "ORIGINAL"
        ? new Set([context.operation === "ROLLBACK_POSTVERIFY"
          ? "EXACT_RESULT_ALREADY_DURABLE" : "SAFE_TO_EXECUTE"])
        : new Set([
          "EXACT_RESULT_ALREADY_DURABLE", "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
          "BLOCKED_TARGET_IDENTITY_MISMATCH",
        ]);
      if (!allowed.has(response.status)) reject("ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID");
      return response.output;
    },
    async executeStage({ packageValue, rollbackResult, stage, stageIntent }) {
      const common = {
        context, intent, packageValue, rollbackResult, consumed: true, label: stage,
        recordIntent: stageIntent, previousResultSha256: stageIntent.previous_result_sha256,
      };
      const prepared = await invokeHelper({ ...common, action: "PREPARE" });
      if (prepared.status !== "PREPARED") reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED");
      const executed = await invokeHelper({ ...common, action: "EXECUTE" });
      if (!new Set(["COMMITTED", "ALREADY_COMMITTED", "PARTIAL_OR_UNKNOWN"])
        .has(executed.status)) {
        reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED");
      }
      const probed = await invokeHelper({ ...common, action: "PROBE" });
      if (probed.status !== "COMMITTED") reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED");
      const { started_at, side_effect_receipts_sha256, evidence, completed_at } = probed.output.record;
      return { started_at, side_effect_receipts_sha256, evidence, completed_at };
    },
    async verifyCheck({ packageValue, rollbackResult, check, checkIntent }) {
      const common = {
        context, intent, packageValue, rollbackResult, consumed: true, label: check,
        recordIntent: checkIntent, previousResultSha256: checkIntent.previous_result_sha256,
      };
      const prepared = await invokeHelper({ ...common, action: "PREPARE" });
      if (prepared.status !== "PREPARED") reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED");
      const probed = await invokeHelper({ ...common, action: "PROBE" });
      if (probed.status !== "VERIFIED") reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED");
      const { started_at, side_effect_receipts_sha256, evidence, completed_at } = probed.output.record;
      return { started_at, side_effect_receipts_sha256, evidence, completed_at };
    },
    async contain({ packageValue, containmentIntent, runtimeObservation }) {
      const common = {
        context, intent, packageValue, consumed: true,
        recordIntent: containmentIntent,
        previousResultSha256: containmentIntent.last_committed_record_sha256,
        extra: { containment_intent: containmentIntent },
      };
      const before = await invokeHelper({ ...common, action: "PROBE" });
      if (!new Set(["PARTIAL_OR_UNKNOWN", "COMMITTED", "VERIFIED", "CONTAINED"]).has(before.status)) {
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      if (!before.output || !same(Object.keys(before.output).sort(), ["containment", "observed"])) {
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      let beforeObserved;
      try { beforeObserved = validateUatPromotionRollbackRuntimeObservation(before.output.observed); }
      catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
      if (!same(beforeObserved, runtimeObservation)) {
        return containmentDrift("DRIFT_BEFORE_CONTAIN", beforeObserved, [before]);
      }
      const contained = await invokeHelper({ ...common, action: "CONTAIN" });
      if (contained.status === "STALE_INTENT") {
        if (!contained.output || !same(Object.keys(contained.output).sort(), ["observed"])) {
          reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
        }
        let drifted;
        try { drifted = validateUatPromotionRollbackRuntimeObservation(contained.output.observed); }
        catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
        return containmentDrift("STALE_INTENT_BEFORE_CONTAIN", drifted, [before, contained]);
      }
      if (contained.status !== "CONTAINED" || !contained.output
        || !same(Object.keys(contained.output).sort(), ["containment", "observed"])) {
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      const after = await invokeHelper({ ...common, action: "PROBE" });
      if (after.status !== "CONTAINED" || !after.output
        || !same(Object.keys(after.output).sort(), ["containment", "observed"])) {
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      if (!same(contained.output, after.output)) {
        let drifted;
        try { drifted = validateUatPromotionRollbackRuntimeObservation(after.output.observed); }
        catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
        return containmentDrift("DRIFT_AFTER_CONTAIN", drifted, [before, contained, after]);
      }
      return {
        before_observed: before.output.observed,
        after_observed: after.output.observed,
        containment: after.output.containment,
        runtime_exchange_sha256: runtimeExchangeSha256([before, contained, after]),
      };
    },
  });
}

function validateContainmentRefreshObservation(value, previous, packageValue, runtimeTrust) {
  const observed = value;
  const stableDatabaseFields = ["name", "system_identifier", "oid", "marker"];
  const plan = runtimeTrust.runtimePlan;
  if (same(observed, previous)
    || stableDatabaseFields.some((field) => observed.database[field] !== previous.database[field])
    || ["caddy", "postgres"].some((service) => !same(
      observed.services[service], previous.services[service],
    ))
    || !same(observed.volumes, previous.volumes)
    || !same(observed.retained_candidate_volumes, previous.retained_candidate_volumes)
    || !same(observed.derived_targets, previous.derived_targets)
    || observed.protected_resources_sha256 !== packageValue.protected_resources_sha256
    || observed.protected_resources_sha256 !== previous.protected_resources_sha256
    || ["uploads", "attachments", "backup_status"].some((domain) => !same(
      observed.retained_candidate_volumes[domain],
      { ...plan.candidate.volumes[domain], present: true },
    ))) reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
  return observed;
}

function validateRuntimeGateResponse(
  value, packageValue, executionMode, operation, action, runtimeTrust, allowedTargetStates = null,
) {
  const targetStates = allowedTargetStates ?? (executionMode === "ORIGINAL"
    ? new Set([operation === "ROLLBACK_POSTVERIFY"
      ? "EXACT_RESULT_ALREADY_DURABLE" : "SAFE_TO_EXECUTE"])
    : new Set([
      "EXACT_RESULT_ALREADY_DURABLE", "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
      "BLOCKED_TARGET_IDENTITY_MISMATCH",
    ]));
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [
      "deployment_identity_sha256", "execution_package_sha256", "executor_sha256",
      "protected_resources_sha256", "result", "runtime_activation_source_sha256",
      "runtime_plan_sha256", "source_set_sha256", "target_state", "observed",
    ].sort())
    || value.result !== (action === "PREFLIGHT"
      ? "ROLLBACK_RUNTIME_PREFLIGHT_PASSED" : "ROLLBACK_RUNTIME_RECHECK_PASSED")
    || value.execution_package_sha256 !== packageValue.package_sha256
    || value.source_set_sha256 !== packageValue.source_set_sha256
    || value.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
    || value.runtime_activation_source_sha256
      !== packageValue.sources.runtime_adapter_activation.sha256
    || value.protected_resources_sha256 !== packageValue.protected_resources_sha256
    || !targetStates.has(value.target_state)
    || !SHA256.test(value.executor_sha256 || "")
    || value.deployment_identity_sha256 !== clusterSha256(runtimeTrust.runtimePlan.deployment)) {
    reject(action === "PREFLIGHT"
      ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID" : "ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID");
  }
  let observed;
  try { observed = validateUatPromotionRollbackRuntimeObservation(value.observed); }
  catch { reject(action === "PREFLIGHT"
    ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID" : "ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID"); }
  if (value.target_state === "SAFE_TO_EXECUTE"
    && !same(observed, createUatPromotionRollbackRuntimeOriginalObservation(runtimeTrust.runtimePlan))) {
    reject(action === "PREFLIGHT"
      ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID" : "ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID");
  }
  const plan = runtimeTrust.runtimePlan;
  const targets = plan.targets;
  if (observed.derived_targets.database.staging.name !== targets.database.staging
    || observed.derived_targets.database.candidate_quarantine.name
      !== targets.database.candidate_quarantine
    || ["uploads", "attachments", "backup_status"].some((domain) => (
      observed.derived_targets.volumes[domain].target.name !== targets.volumes[domain].target
      || observed.derived_targets.volumes[domain].utility_container.name
        !== targets.volumes[domain].utility_container
      || observed.retained_candidate_volumes[domain].name
        !== plan.candidate.volumes[domain].name
    ))) reject(action === "PREFLIGHT"
    ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID" : "ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID");
  if (value.target_state === "EXACT_RESULT_ALREADY_DURABLE") {
    const expectedDigest = (reference) => {
      const matched = /@sha256:([0-9a-f]{64})$/u.exec(reference);
      if (matched === null) return null;
      return `sha256:${matched[1]}`;
    };
    if (observed.active_generation !== "PREDECESSOR"
      || observed.database.name !== plan.deployment.database.name
      || observed.database.system_identifier !== plan.deployment.database.system_identifier
      || observed.database.marker !== plan.deployment.database.marker
      || observed.database.oid === plan.deployment.database.oid
      || observed.database.allow_connections !== true
      || observed.database.writer_sessions !== 0
      || observed.database.sealed !== false
      || ["caddy", "postgres"].some((service) => !same(
        {
          service: observed.services[service].service,
          container_id: observed.services[service].container_id,
          image_reference: observed.services[service].image_reference,
          image_digest: observed.services[service].image_digest,
        },
        plan.candidate.services[service],
      ))
      || ["web", "worker"].some((service) => (
        observed.services[service].image_reference !== plan.predecessor[`${service}_image`]
        || observed.services[service].image_digest
          !== expectedDigest(plan.predecessor[`${service}_image`])
        || observed.services[service].container_id === plan.candidate.services[service].container_id
      ))
      || Object.values(observed.services).some((service) => !service.running
        || service.oom_killed || service.restart_count !== 0
        || service.health !== (service.service === "caddy" ? "none" : "healthy"))
      || observed.writer_inventory.active_writer_count !== 2
      || observed.writer_inventory.unexpected_writer_count !== 0
      || observed.writer_inventory.members.length !== 2
      || observed.derived_targets.database.staging.present
      || !observed.derived_targets.database.candidate_quarantine.present
      || observed.derived_targets.database.candidate_quarantine.oid !== plan.deployment.database.oid
      || ["uploads", "attachments", "backup_status"].some((domain) => (
        observed.volumes[domain].name !== targets.volumes[domain].target
        || observed.volumes[domain].identity_sha256 === plan.candidate.volumes[domain].identity_sha256
        || !observed.derived_targets.volumes[domain].target.present
        || observed.derived_targets.volumes[domain].target.identity_sha256
          !== observed.volumes[domain].identity_sha256
        || observed.derived_targets.volumes[domain].utility_container.present
        || observed.retained_candidate_volumes[domain].present !== true
        || observed.retained_candidate_volumes[domain].identity_sha256
          !== plan.candidate.volumes[domain].identity_sha256
      ))) reject(action === "PREFLIGHT"
      ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID" : "ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID");
  }
  return value;
}

function exactRuntimeMatchesRollbackStages(runtimeRecheck, stages) {
  if (runtimeRecheck.target_state !== "EXACT_RESULT_ALREADY_DURABLE") return false;
  if (!Array.isArray(stages) || stages.length !== UAT_PROMOTION_ROLLBACK_STAGES.length) return false;
  const database = stages[2]?.evidence;
  const activation = stages[7]?.evidence;
  const observed = runtimeRecheck.observed;
  if (!database || !activation || !observed) return false;
  if (!same(observed.database, {
    name: database.restored_database_name,
    system_identifier: database.system_identifier,
    oid: database.restored_database_oid,
    marker: database.restored_database_marker,
    allow_connections: true,
    writer_sessions: 0,
    sealed: false,
  })) return false;
  const volumeStage = { uploads: 3, attachments: 4, backup_status: 5 };
  if (Object.entries(volumeStage).some(([domain, index]) => (
    observed.volumes[domain].name !== stages[index].evidence.target_volume
    || observed.volumes[domain].identity_sha256
      !== stages[index].evidence.target_volume_identity_sha256
    || observed.retained_candidate_volumes[domain].present !== true
    || observed.retained_candidate_volumes[domain].name
      !== stages[index].evidence.retained_candidate_volume
    || observed.retained_candidate_volumes[domain].identity_sha256
      !== stages[index].evidence.retained_candidate_volume_identity_sha256
  ))) return false;
  if (observed.writer_inventory.active_writer_count !== 2
    || observed.writer_inventory.unexpected_writer_count !== 0
    || observed.writer_inventory.members.length !== 2) return false;
  return ["caddy", "postgres", "web", "worker"].every((service) => {
    const actual = observed.services[service];
    const expected = activation[service];
    return actual.container_id === expected.container_id
      && actual.running === expected.running
      && actual.restart_count === expected.restart_count
      && actual.oom_killed === expected.oom_killed
      && actual.health === (service === "caddy" ? "none" : "healthy")
      && (service === "web" || service === "worker"
        ? actual.image_reference === expected.image_reference
        : actual.image_digest === expected.image_digest);
  });
}

function exactRuntimeMatchesDurableRollback(context, runtimeRecheck, ledger, rollbackResult) {
  if (!ledger.complete) return false;
  const stages = context.operation === "ROLLBACK_EXECUTION" ? ledger.records : rollbackResult?.stages;
  return exactRuntimeMatchesRollbackStages(runtimeRecheck, stages);
}

function controlOptions(context, phase, options) {
  const filesystemRoot = path.resolve(options.filesystemRoot || "/");
  if (!new Set(["ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"]).has(context.operation)
    || !new Set(["preflight", "execute", "recover"]).has(phase)
    || phase === "execute" && context.execution_mode !== "ORIGINAL"
    || phase === "recover" && context.execution_mode !== "RECOVERY"
    || typeof options.expectedIntentSha256 !== "string" || !SHA256.test(options.expectedIntentSha256)) {
    reject("ROLLBACK_CONTROL_CONTEXT_INVALID");
  }
  if (filesystemRoot !== "/" && options.allowTestRoot !== true) reject("ROLLBACK_CONTROL_TEST_ROOT_NOT_EXPLICIT");
  if (options.adapter !== undefined && (filesystemRoot === "/" || options.allowTestRoot !== true)) {
    reject("ROLLBACK_CONTROL_TEST_ADAPTER_NOT_EXPLICIT");
  }
  if (options.clock !== undefined && (filesystemRoot === "/" || options.allowTestRoot !== true
    || typeof options.clock !== "function")) reject("ROLLBACK_CONTROL_TEST_CLOCK_NOT_EXPLICIT");
  if (options.recoveryDecision !== undefined
    && (phase !== "recover" || !new Set([
      "RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE",
    ]).has(options.recoveryDecision))) reject("ROLLBACK_CONTROL_RECOVERY_DECISION_INVALID");
  return Object.freeze({
    filesystemRoot, clock: options.clock ?? (() => new Date()),
    recoveryDecision: options.recoveryDecision,
  });
}

export async function preflightUatPromotionRollbackControl(contextInput, options = {}) {
  const context = validateUatPromotionContext(contextInput);
  const resolved = controlOptions(context, "preflight", options);
  const intent = await trustedIntent(context, options.expectedIntentSha256, resolved.filesystemRoot);
  const rollbackResult = context.operation === "ROLLBACK_POSTVERIFY"
    ? await loadRollbackResultForPostverify(context, resolved.filesystemRoot) : null;
  const { packageValue } = await loadExecutionPackage(
    context, intent, resolved.filesystemRoot, rollbackResult,
  );
  await verifyPackageSources(packageValue, resolved.filesystemRoot, UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES);
  if (context.execution_mode === "ORIGINAL"
    && Date.parse(nowIso(resolved.clock)) > Date.parse(packageValue.execution_deadline)) {
    reject("ROLLBACK_CONTROL_EXECUTION_DEADLINE_EXPIRED");
  }
  const runtimeTrust = await loadRuntimeTrustSources(
    context, packageValue, resolved.filesystemRoot, resolved.clock,
  );
  const adapter = options.adapter ?? productionAdapter(context, intent);
  if (!adapter || typeof adapter.preflight !== "function") reject("ROLLBACK_CONTROL_ADAPTER_INVALID");
  const response = validateRuntimeGateResponse(
    await adapter.preflight({ context, intent, packageValue, rollbackResult, runtimeTrust }), packageValue,
    context.execution_mode, context.operation, "PREFLIGHT", runtimeTrust,
  );
  if (context.operation === "ROLLBACK_POSTVERIFY" && context.execution_mode === "ORIGINAL"
    && !exactRuntimeMatchesRollbackStages(response, rollbackResult.stages)) {
    reject("ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID");
  }
  const reloaded = await loadExecutionPackage(
    context, intent, resolved.filesystemRoot, rollbackResult,
  );
  if (!same(reloaded.packageValue, packageValue)) reject("ROLLBACK_CONTROL_EXECUTION_PACKAGE_CHANGED");
  await verifyPackageSources(
    reloaded.packageValue, resolved.filesystemRoot, UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES,
  );
  await loadRuntimeTrustSources(context, reloaded.packageValue, resolved.filesystemRoot, resolved.clock);
  return Object.freeze({
    result: "ROLLBACK_CONTROL_PREFLIGHT_PASSED", promotion_id: context.parameters.promotion_id,
    intent_sha256: options.expectedIntentSha256,
    execution_package_sha256: response.execution_package_sha256,
    source_set_sha256: response.source_set_sha256,
    runtime_plan_sha256: response.runtime_plan_sha256,
    runtime_activation_source_sha256: response.runtime_activation_source_sha256,
    executor_sha256: response.executor_sha256,
    deployment_identity_sha256: response.deployment_identity_sha256,
    protected_resources_sha256: response.protected_resources_sha256,
  });
}

function recordNames(index, label) {
  const prefix = `${String(index + 1).padStart(2, "0")}.${label}`;
  return Object.freeze({ intentPrefix: `${prefix}.intent.`, resultPrefix: `${prefix}.result.` });
}

async function completeLedger(root, result, postverify) {
  const records = postverify ? result.checks : result.stages;
  const labels = postverify ? UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS : UAT_PROMOTION_ROLLBACK_STAGES;
  const names = (await readdir(root)).sort();
  if (names.length !== labels.length * 2) return false;
  for (const [index, label] of labels.entries()) {
    const prefixes = recordNames(index, label);
    const intentField = postverify ? "check_intent_sha256" : "stage_intent_sha256";
    const resultField = postverify ? "check_result_sha256" : "stage_result_sha256";
    const intentName = `${prefixes.intentPrefix}${records[index][intentField]}.json`;
    const resultName = `${prefixes.resultPrefix}${records[index][resultField]}.json`;
    if (!names.includes(intentName) || !names.includes(resultName)) return false;
    const storedIntent = await trustedJson(
      path.join(root, intentName),
      postverify ? validateUatPromotionRollbackCheckIntent : validateUatPromotionRollbackStageIntent,
      "ROLLBACK_CONTROL_RECORD_INTENT_INVALID",
    );
    const storedResult = await trustedJson(
      path.join(root, resultName),
      postverify ? validateUatPromotionRollbackCheckResult : validateUatPromotionRollbackStageResult,
      "ROLLBACK_CONTROL_RECORD_RESULT_INVALID",
    );
    if (!same(storedResult.value, records[index])
      || storedResult.value[intentField] !== storedIntent.value[intentField]
      || Date.parse(storedResult.value.started_at) < Date.parse(storedIntent.value.prepared_at)) return false;
  }
  return true;
}

async function auditCommittedRecords(root, context, intent, packageValue, rollbackResult, runtimeTrust) {
  const postverify = context.operation === "ROLLBACK_POSTVERIFY";
  const labels = postverify ? UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS : UAT_PROMOTION_ROLLBACK_STAGES;
  const names = (await readdir(root)).sort();
  const recordFiles = new Set();
  const records = [];
  let previous = ZERO_SHA256;
  let prefixExact = true;
  let diagnostic = null;
  for (const [index, label] of labels.entries()) {
    const prefixes = recordNames(index, label);
    const intentMatches = names.filter((name) => name.startsWith(prefixes.intentPrefix) && name.endsWith(".json"));
    const resultMatches = names.filter((name) => name.startsWith(prefixes.resultPrefix) && name.endsWith(".json"));
    for (const name of [...intentMatches, ...resultMatches]) recordFiles.add(name);
    if (intentMatches.length === 0 && resultMatches.length === 0) {
      if (names.some((name) => labels.slice(index + 1).some((later, offset) => {
        const laterNames = recordNames(index + offset + 1, later);
        return name.startsWith(laterNames.intentPrefix) || name.startsWith(laterNames.resultPrefix);
      }))) {
        prefixExact = false;
        diagnostic = `LATER_RECORD_AFTER_GAP:${label}`;
      }
      break;
    }
    if (intentMatches.length !== 1 || resultMatches.length > 1) {
      prefixExact = false;
      diagnostic = `RECORD_CARDINALITY:${label}`;
      break;
    }
    let storedIntent;
    try {
      storedIntent = (await trustedJson(
        path.join(root, intentMatches[0]),
        postverify ? validateUatPromotionRollbackCheckIntent : validateUatPromotionRollbackStageIntent,
        "ROLLBACK_CONTROL_RECORD_INTENT_INVALID",
      )).value;
    } catch (error) {
      prefixExact = false;
      diagnostic = `INTENT_INVALID:${label}:${error?.code || "UNKNOWN"}`;
      break;
    }
    const intentField = postverify ? "check_intent_sha256" : "stage_intent_sha256";
    const resultField = postverify ? "check_result_sha256" : "stage_result_sha256";
    const planSha256 = postverify ? rollbackResult.rollback_plan_sha256 : intent.rollback_plan_sha256;
    const common = {
      promotion_id: context.parameters.promotion_id,
      promotion_generation: context.parameters.promotion_generation,
      operation_id: context.operation_id,
      execution_authorization_sha256: context.original_authorization_sha256,
      rollback_plan_sha256: planSha256,
      execution_package_sha256: packageValue.package_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      ordinal: index + 1,
      previous_result_sha256: previous,
      input_sha256: clusterSha256({
        operation_id: context.operation_id, label, ordinal: index + 1,
        rollback_plan_sha256: planSha256,
        execution_package_sha256: packageValue.package_sha256,
        runtime_plan_sha256: packageValue.runtime_plan_sha256,
        previous_result_sha256: previous,
      }),
      prepared_at: storedIntent.prepared_at,
    };
    const expectedIntent = postverify
      ? createUatPromotionRollbackCheckIntent({ ...common, check: label })
      : createUatPromotionRollbackStageIntent({ ...common, stage: label });
    if (!same(storedIntent, expectedIntent)
      || intentMatches[0] !== `${prefixes.intentPrefix}${storedIntent[intentField]}.json`) {
      prefixExact = false;
      diagnostic = `INTENT_BINDING:${label}`;
      break;
    }
    if (resultMatches.length === 0) {
      prefixExact = false;
      diagnostic = `DANGLING_INTENT:${label}`;
      break;
    }
    let storedResult;
    try {
      storedResult = (await trustedJson(
        path.join(root, resultMatches[0]),
        postverify ? validateUatPromotionRollbackCheckResult : validateUatPromotionRollbackStageResult,
        "ROLLBACK_CONTROL_RECORD_RESULT_INVALID",
      )).value;
      if (postverify) assertCheckEvidenceBindings(
        label, storedResult.evidence, rollbackResult, packageValue,
        { startedAt: storedResult.started_at, completedAt: storedResult.completed_at },
      );
      else assertStageEvidenceBindings(
        label, storedResult.evidence, intent, packageValue, runtimeTrust, storedIntent,
      );
    } catch (error) {
      prefixExact = false;
      diagnostic = `RESULT_INVALID:${label}:${error?.code || "UNKNOWN"}`;
      break;
    }
    const expectedResult = postverify
      ? createUatPromotionRollbackCheckResult({
        promotion_id: common.promotion_id,
        promotion_generation: common.promotion_generation,
        operation_id: common.operation_id,
        execution_authorization_sha256: common.execution_authorization_sha256,
        rollback_plan_sha256: common.rollback_plan_sha256,
        execution_package_sha256: common.execution_package_sha256,
        runtime_plan_sha256: common.runtime_plan_sha256,
        ordinal: common.ordinal,
        check: label,
        previous_result_sha256: previous,
        check_intent_sha256: storedIntent.check_intent_sha256,
        side_effect_receipts_sha256: storedResult.side_effect_receipts_sha256,
        evidence: storedResult.evidence,
        started_at: storedResult.started_at,
        completed_at: storedResult.completed_at,
      })
      : createUatPromotionRollbackStageResult({
        promotion_id: common.promotion_id,
        promotion_generation: common.promotion_generation,
        operation_id: common.operation_id,
        execution_authorization_sha256: common.execution_authorization_sha256,
        rollback_plan_sha256: common.rollback_plan_sha256,
        execution_package_sha256: common.execution_package_sha256,
        runtime_plan_sha256: common.runtime_plan_sha256,
        ordinal: common.ordinal,
        stage: label,
        previous_result_sha256: previous,
        stage_intent_sha256: storedIntent.stage_intent_sha256,
        side_effect_receipts_sha256: storedResult.side_effect_receipts_sha256,
        evidence: storedResult.evidence,
        started_at: storedResult.started_at,
        completed_at: storedResult.completed_at,
      });
    if (!same(storedResult, expectedResult)
      || resultMatches[0] !== `${prefixes.resultPrefix}${storedResult[resultField]}.json`
      || Date.parse(storedResult.started_at) < Date.parse(storedIntent.prepared_at)
      || Date.parse(storedResult.completed_at) > Date.parse(packageValue.execution_deadline)) {
      prefixExact = false;
      diagnostic = `RESULT_BINDING:${label}`;
      break;
    }
    records.push(storedResult);
    previous = storedResult[resultField];
  }
  const unexpected = names.filter((name) => !recordFiles.has(name));
  if (unexpected.length > 0 && diagnostic === null) diagnostic = "UNEXPECTED_FILES";
  const complete = prefixExact && unexpected.length === 0 && records.length === labels.length;
  const state = prefixExact && unexpected.length === 0
    ? (records.length === 0 ? "EMPTY" : "EXACT_PREFIX") : "UNKNOWN";
  return Object.freeze({
    state, complete, ordinal: records.length,
    records: Object.freeze(records), lastResultSha256: previous, diagnostic,
  });
}

async function completion(context, intent, filesystemRoot, root) {
  const results = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/results`, filesystemRoot);
  const names = (await readdir(results).catch(() => reject("ROLLBACK_CONTROL_RESULT_ROOT_INVALID")))
    .filter((name) => operationArtifactMatches(name, context.operation_id));
  if (names.length === 0) return null;
  if (names.length !== 1) return Object.freeze({ partial: true });
  const postverify = context.operation === "ROLLBACK_POSTVERIFY";
  const stored = await trustedJson(
    path.join(results, names[0]),
    postverify ? validateUatPromotionRollbackPostverifyResult : validateUatPromotionRollbackResult,
    "ROLLBACK_CONTROL_RESULT_INVALID",
  );
  if (names[0] !== `${context.operation_id}.${stored.value.result_sha256}.json`) reject("ROLLBACK_CONTROL_RESULT_INVALID");
  if (postverify) {
    const rollbackStored = await loadRollbackResultForPostverify(context, filesystemRoot);
    assertUatPromotionRollbackPostverifyResultMatchesIntent(stored.value, intent, rollbackStored);
  } else assertUatPromotionRollbackResultMatchesIntent(stored.value, intent);
  if (!await completeLedger(root, stored.value, postverify)) return Object.freeze({ partial: true });
  return Object.freeze({ partial: false, result: stored.value });
}

function assertStageEvidenceBindings(
  stage, evidence, intent, packageValue, runtimeTrust, recordIntent = null,
) {
  const parameters = intent.parameters;
  const plan = runtimeTrust?.runtimePlan;
  if (!plan || plan.runtime_plan_sha256 !== packageValue.runtime_plan_sha256) {
    reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  }
  const runtimeProjection = deriveUatPromotionRollbackRuntimeProjection(plan);
  const rollbackOverlay = createUatPromotionRollbackComposeOverlay(plan);
  const sourceByStage = {
    POSTGRESQL_RESTORE: ["snapshot_postgresql", "postgresql"],
    UPLOADS_RESTORE: ["snapshot_uploads", "uploads"],
    ATTACHMENTS_RESTORE: ["snapshot_attachments", "attachments"],
    BACKUP_STATUS_RESTORE: ["snapshot_backup_status", "backup_status"],
  };
  if (stage === "PRECONDITION_RECHECK" && (evidence.execution_package_sha256 !== packageValue.package_sha256
    || evidence.source_set_sha256 !== packageValue.source_set_sha256
    || evidence.checkpoint_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || evidence.snapshot_intent_sha256 !== parameters.snapshot_intent_sha256
    || evidence.finalization_intent_sha256 !== parameters.finalization_intent_sha256
    || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
    || evidence.runtime_activation_sha256
      !== packageValue.sources.runtime_adapter_activation.sha256)) {
    reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  }
  if (stage === "WRITER_CONTAINMENT" && (
    evidence.database_oid !== parameters.database.oid
    || evidence.system_identifier !== parameters.database.system_identifier
    || evidence.web_container_id !== plan.candidate.services.web.container_id
    || evidence.worker_container_id !== plan.candidate.services.worker.container_id
    || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
    || evidence.candidate_service_set_sha256 !== clusterSha256({
      deployment_result_sha256: packageValue.sources.candidate_deployment_result.sha256,
      postdeploy_identity_sha256: packageValue.sources.candidate_postdeploy_identity.sha256,
    })
  )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  if (Object.hasOwn(sourceByStage, stage)) {
    const [role, domain] = sourceByStage[stage];
    const object = parameters.snapshot_objects[domain];
    const expectedContentSha256 = domain === "postgresql"
      ? packageValue.content_reconciliation.database.report_sha256
      : packageValue.content_reconciliation.files[domain].tree_sha256;
    if (evidence.source_artifact_sha256 !== packageValue.sources[role].sha256
      || evidence.source_artifact_sha256 !== object.sha256
      || evidence.source_artifact_bytes !== object.bytes
      || evidence.source_reconciliation_sha256
        !== packageValue.content_reconciliation.source_reconciliation_sha256
      || evidence.target_content_sha256 !== expectedContentSha256
      || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
      || domain !== "postgresql" && evidence.source_entries !== object.entries
      || domain === "postgresql" && (evidence.snapshot_database_oid !== parameters.database.oid
        || evidence.restored_database_oid === plan.deployment.database.oid
        || evidence.system_identifier !== parameters.database.system_identifier
        || evidence.restored_database_marker !== parameters.database.marker
        || evidence.migration_head !== parameters.predecessor.migration_head)) {
      reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
    }
    const targets = deriveUatPromotionRollbackRuntimeTargets(intent.rollback_operation_id);
    if (domain === "postgresql" && (
      evidence.staging_database_name !== targets.database.staging
      || evidence.candidate_database_quarantine_name !== targets.database.candidate_quarantine
      || evidence.candidate_database_quarantine_oid !== plan.deployment.database.oid
      || evidence.manifest_sha256 !== packageValue.sources.snapshot_manifest.sha256
      || evidence.migration_ledger_file_sha256
        !== packageValue.sources.snapshot_migrations.sha256
      || evidence.migration_manifest_sha256 !== parameters.predecessor.migration_manifest_sha256
      || evidence.restore_precondition_sha256
        !== evidence.restore_precondition.restore_precondition_sha256
      || evidence.restore_precondition_opcode_spec_sha256
        !== evidence.restore_precondition.opcode_spec_sha256
      || evidence.dump_inventory_sha256
        !== evidence.restore_precondition.dump_inventory_sha256
      || evidence.empty_projection_sha256
        !== evidence.restore_precondition.empty_projection_sha256
      || evidence.restore_precondition.base_spec_sha256
        !== evidence.postgres_base_spec_sha256
      || evidence.restore_precondition.binding_sha256
        !== evidence.staging_create_receipt_sha256
      || evidence.restore_precondition.create_receipt_sha256
        !== evidence.staging_create_receipt_sha256
      || evidence.restore_precondition.system_identifier
        !== parameters.database.system_identifier
      || evidence.restore_precondition.database.name !== targets.database.staging
      || evidence.restore_precondition.database.oid !== evidence.restored_database_oid
      || evidence.restore_precondition.database.marker !== evidence.staging_database_marker
      || evidence.restore_precondition.profile_sha256 !== evidence.database_profile_sha256
      || evidence.pre_switch_content_proof_sha256
        !== evidence.pre_switch_content_proof.proof_sha256
      || evidence.pre_switch_content_proof.binding_sha256
        !== evidence.privilege_reconcile_receipt_sha256
      || evidence.pre_switch_content_proof.base_spec_sha256
        !== evidence.postgres_base_spec_sha256
      || evidence.pre_switch_content_proof.runtime_plan_sha256
        !== packageValue.runtime_plan_sha256
      || evidence.pre_switch_content_proof.source_reconciliation_sha256
        !== packageValue.content_reconciliation.source_reconciliation_sha256
      || evidence.pre_switch_content_proof.source_database_report_sha256
        !== packageValue.content_reconciliation.database.report_sha256
      || evidence.pre_switch_content_proof.live_database_report_sha256
        !== packageValue.content_reconciliation.database.report_sha256
      || evidence.pre_switch_content_proof.migration_head
        !== parameters.predecessor.migration_head
      || evidence.pre_switch_content_proof.migration_ledger_file_sha256
        !== packageValue.sources.snapshot_migrations.sha256
      || evidence.pre_switch_content_proof.migration_allowlist_sha256
        !== parameters.predecessor.migration_manifest_sha256
      || evidence.pre_switch_content_proof.staging_database_name
        !== targets.database.staging
      || evidence.pre_switch_content_proof.staging_database_oid
        !== evidence.restored_database_oid
      || evidence.pre_switch_content_proof.staging_database_marker
        !== evidence.staging_database_marker
      || evidence.pre_switch_content_proof.system_identifier
        !== parameters.database.system_identifier
      || evidence.pre_switch_content_proof.candidate_database_name
        !== parameters.database.name
      || evidence.pre_switch_content_proof.candidate_database_oid
        !== plan.deployment.database.oid
      || evidence.pre_switch_content_proof.candidate_database_marker
        !== parameters.database.marker
      || evidence.switch_receipt.operation_id !== intent.rollback_operation_id
      || !recordIntent
      || evidence.writer_containment_stage_result_sha256
        !== recordIntent.previous_result_sha256
      || evidence.postgres_container_id !== plan.candidate.services.postgres.container_id
      || evidence.postgres_image_config_digest
        !== plan.candidate.services.postgres.image_digest
      || evidence.runtime_privilege_access_sha256
        !== runtimeTrust.runtimePrivilegeAccess.access_sha256
      || evidence.runtime_privilege_catalog_sha256
        !== runtimeTrust.runtimePrivilegeCatalog.catalog_sha256
      || evidence.runtime_privilege_catalog_artifact_sha256
        !== runtimeTrust.runtimePrivilegeCatalog.artifact_sha256
      || evidence.runtime_privilege_policy_sha256
        !== runtimeTrust.runtimePrivilegePolicy.policy_sha256
      || evidence.runtime_privilege_operator_policy_sha256
        !== runtimeTrust.runtimePrivilegeOperatorPolicy.policy_sha256
      || evidence.uat_reconciliation_authority_sha256
        !== plan.reconciliation_authority.authority_sha256
      || evidence.staging_database_marker
        !== `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:RESTORED_STAGING`
      || evidence.candidate_database_quarantine_marker
        !== `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:CANDIDATE_QUARANTINE`
    )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
    if (domain !== "postgresql" && evidence.target_volume !== targets.volumes[domain].target) {
      reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
    }
    if (domain !== "postgresql" && (
      evidence.retained_candidate_volume !== plan.candidate.volumes[domain].name
      || evidence.retained_candidate_volume_identity_sha256
        !== plan.candidate.volumes[domain].identity_sha256
      || evidence.target_volume_identity_sha256 === plan.candidate.volumes[domain].identity_sha256
      || evidence.domain !== domain
      || evidence.manifest_sha256 !== packageValue.sources.snapshot_manifest.sha256
      || evidence.expected_tree_sha256 !== expectedContentSha256
      || evidence.helper_image_reference !== plan.helpers.volume_restore.image_reference
      || evidence.helper_image_config_digest !== plan.helpers.volume_restore.image_config_digest
    )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
    if (domain === "backup_status" && (
      evidence.backup_status_disposition !== UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION
      || evidence.current_backup_readiness !== false
      || evidence.post_rollback_backup_required !== true
    )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  }
  if (stage === "RUNTIME_CONFIGURATION_RESTORE" && (
    evidence.compose_file_sha256 !== packageValue.sources.compose_file.sha256
    || evidence.compose_release_file_sha256 !== packageValue.sources.compose_release_file.sha256
    || evidence.deployment_environment_sha256 !== packageValue.sources.deployment_environment.sha256
    || evidence.runtime_policy_sha256 !== packageValue.sources.runtime_policy.sha256
    || evidence.predecessor_runtime_configuration_sha256
      !== parameters.predecessor.runtime_configuration_sha256
    || evidence.rollback_runtime_configuration_sha256
      === parameters.predecessor.runtime_configuration_sha256
    || evidence.rollback_runtime_projection_sha256
      !== runtimeProjection.rollback_runtime_projection_sha256
    || evidence.compose_rollback_overlay_sha256
      !== rollbackOverlay.compose_rollback_overlay_sha256
    || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
  )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  if (stage === "WEB_WORKER_PREDECESSOR_ACTIVATION") {
    let receipt, identity, derivedIdentity;
    try {
      receipt = validatePostDeployReceipt(parseStrictJson(
        evidence.rollback_postdeploy_receipt_json, 1024 * 1024,
      ));
      identity = validateReleaseIdentity(parseStrictJson(
        evidence.release_identity_json, 1024 * 1024,
      ));
      derivedIdentity = buildReleaseIdentityFromPostDeployReceipt({
        receipt, receiptSha256: evidence.rollback_postdeploy_receipt_sha256,
      });
    } catch { reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID"); }
    const receiptSha256 = createHash("sha256")
      .update(evidence.rollback_postdeploy_receipt_json).digest("hex");
    const identitySha256 = createHash("sha256")
      .update(evidence.release_identity_json).digest("hex");
    const receiptServices = Object.fromEntries(receipt.services.map((service) => [service.service, service]));
    const pinnedDigest = (reference) => {
      const match = /@sha256:([0-9a-f]{64})$/u.exec(reference);
      return match === null ? null : `sha256:${match[1]}`;
    };
    if (evidence.web.image_reference !== parameters.predecessor.web_image
      || evidence.worker.image_reference !== parameters.predecessor.worker_image
      || evidence.web.image_config_digest
        !== plan.predecessor.web_image_config_digest
      || evidence.worker.image_config_digest
        !== plan.predecessor.worker_image_config_digest
      || evidence.web.container_id === plan.candidate.services.web.container_id
      || evidence.worker.container_id === plan.candidate.services.worker.container_id
      || evidence.caddy.container_id !== plan.candidate.services.caddy.container_id
      || evidence.caddy.image_digest !== plan.candidate.services.caddy.image_digest
      || evidence.postgres.container_id !== plan.candidate.services.postgres.container_id
      || evidence.postgres.image_digest !== plan.candidate.services.postgres.image_digest
      || receiptSha256 !== evidence.rollback_postdeploy_receipt_sha256
      || evidence.rollback_postdeploy_receipt_json !== releaseCanonicalJson(receipt)
      || receiptSha256 === packageValue.sources.predecessor_postdeploy_receipt.sha256
      || identitySha256 !== evidence.release_identity_sha256
      || evidence.release_identity_json !== releaseCanonicalJson(identity)
      || !same(identity, derivedIdentity)
      || receipt.run_id !== plan.targets.rollback_postdeploy_run_id
      || receipt.deployment.class !== "UAT"
      || receipt.deployment.id !== plan.deployment.id
      || receipt.deployment.compose_project !== plan.deployment.compose_project
      || receipt.release.manifest_sha256 !== parameters.predecessor.release_manifest_sha256
      || receipt.source.application_version !== parameters.predecessor.application_version
      || receipt.source.git_commit !== parameters.predecessor.git_commit
      || receipt.source.git_tree !== parameters.predecessor.git_tree
      || receipt.migrations.head !== parameters.predecessor.migration_head
      || receipt.migrations.manifest_sha256 !== parameters.predecessor.migration_manifest_sha256
      || receipt.runtime_configuration_sha256 !== evidence.rollback_runtime_configuration_sha256
      || receipt.control.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256
      || receipt.control.authorization_sha256 !== intent.execution_authorization_sha256
      || ["caddy", "postgres"].some((service) => (
        receiptServices[service].container_id !== plan.candidate.services[service].container_id
        || receiptServices[service].image_id !== plan.candidate.services[service].image_digest
        || receiptServices[service].image_reference !== plan.candidate.services[service].image_reference
      ))
      || ["web", "worker"].some((service) => (
        receiptServices[service].container_id !== evidence[service].container_id
        || receiptServices[service].image_reference !== parameters.predecessor[`${service}_image`]
        || receiptServices[service].image_id
          !== pinnedDigest(parameters.predecessor[`${service}_image`])
      ))
      || evidence.predecessor_runtime_configuration_sha256
        !== parameters.predecessor.runtime_configuration_sha256
      || evidence.rollback_runtime_configuration_sha256
        === parameters.predecessor.runtime_configuration_sha256
      || evidence.rollback_runtime_projection_sha256
        !== runtimeProjection.rollback_runtime_projection_sha256
      || evidence.compose_rollback_overlay_sha256
        !== rollbackOverlay.compose_rollback_overlay_sha256
      || evidence.protected_resources_sha256 !== packageValue.protected_resources_sha256
      || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
      || evidence.uat_reconciliation_authority_sha256
        !== plan.reconciliation_authority.authority_sha256) {
      reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
    }
  }
  if (stage === "PROTECTED_RESOURCE_RECHECK" && (
    evidence.before_sha256 !== packageValue.protected_resources_sha256
    || evidence.after_sha256 !== packageValue.protected_resources_sha256
    || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
  )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
}

function assertCheckEvidenceBindings(check, evidence, rollbackResult, packageValue, timing) {
  const activation = rollbackResult.stages[7].evidence;
  const sourceByCheck = {
    POSTGRESQL_CONTENT: ["snapshot_postgresql", "postgresql"],
    UPLOADS_CONTENT: ["snapshot_uploads", "uploads"],
    ATTACHMENTS_CONTENT: ["snapshot_attachments", "attachments"],
    BACKUP_STATUS_CONTENT: ["snapshot_backup_status", "backup_status"],
  };
  if (Object.hasOwn(sourceByCheck, check)) {
    const [role, domain] = sourceByCheck[check];
    const object = rollbackResult.snapshot_objects[domain];
    const stageIndex = { postgresql: 2, uploads: 3, attachments: 4, backup_status: 5 }[domain];
    const stage = rollbackResult.stages[stageIndex];
    const expectedContentSha256 = domain === "postgresql"
      ? packageValue.content_reconciliation.database.report_sha256
      : packageValue.content_reconciliation.files[domain].tree_sha256;
    const expectedTargetIdentitySha256 = domain === "postgresql"
      ? clusterSha256(rollbackResult.restored_database)
      : stage.evidence.target_volume_identity_sha256;
    const postgresqlSharedFields = [
      "runtime_plan_sha256", "restored_database_oid", "restored_database_marker",
      "system_identifier", "migration_head", "migration_ledger_file_sha256",
      "migration_manifest_sha256",
      "restore_receipt_sha256", "runtime_privilege_access_sha256",
      "runtime_privilege_catalog_sha256", "runtime_privilege_catalog_artifact_sha256",
      "runtime_privilege_policy_sha256", "runtime_privilege_operator_policy_sha256",
      "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
      "sealed_security_projection_sha256", "candidate_database_quarantine_marker",
    ];
    const volumeSharedFields = [
      "domain", "runtime_plan_sha256", "target_volume", "target_volume_marker_sha256",
      "expected_tree_sha256", "target_root_identity_sha256", "metadata_policy_sha256",
      "metadata_state_sha256", "volume_restore_receipt_sha256", "helper_image_config_digest",
    ];
    if (evidence.source_artifact_sha256 !== packageValue.sources[role].sha256
      || evidence.source_artifact_sha256 !== object.sha256
      || evidence.source_artifact_bytes !== object.bytes
      || evidence.source_reconciliation_sha256
        !== packageValue.content_reconciliation.source_reconciliation_sha256
      || evidence.target_content_sha256 !== expectedContentSha256
      || evidence.target_identity_sha256 !== expectedTargetIdentitySha256
      || evidence.stage_result_sha256 !== stage.stage_result_sha256
      || evidence.entries !== object.entries
      || check === "POSTGRESQL_CONTENT" && (
        evidence.candidate_database_quarantine_present !== true
        || evidence.candidate_database_quarantine_name
          !== stage.evidence.candidate_database_quarantine_name
        || evidence.candidate_database_quarantine_oid
          !== stage.evidence.candidate_database_quarantine_oid
        || evidence.candidate_database_quarantine_oid !== packageValue.database.oid
        || evidence.active_allow_connections !== activation.active_database_allow_connections
        || evidence.active_connection_limit !== activation.active_database_connection_limit
        || evidence.candidate_database_quarantine_allow_connections
          !== stage.evidence.candidate_database_quarantine_allow_connections_at_commit
        || evidence.candidate_database_quarantine_connection_limit
          !== stage.evidence.candidate_database_quarantine_connection_limit_at_commit
        || evidence.candidate_database_quarantine_sessions
          !== stage.evidence.candidate_database_quarantine_sessions_at_commit
        || evidence.candidate_database_quarantine_prepared_xacts
          !== stage.evidence.candidate_database_quarantine_prepared_xacts_at_commit
        || evidence.candidate_database_quarantine_allow_connections
          !== activation.candidate_database_quarantine_allow_connections
        || evidence.candidate_database_quarantine_connection_limit
          !== activation.candidate_database_quarantine_connection_limit
        || postgresqlSharedFields.some((field) => (
          evidence[field] !== stage.evidence[field]
        ))
      )
      || check !== "POSTGRESQL_CONTENT" && (
        evidence.candidate_volume_present !== true
        || evidence.candidate_volume_name !== stage.evidence.retained_candidate_volume
        || evidence.candidate_volume_identity_sha256
          !== stage.evidence.retained_candidate_volume_identity_sha256
        || volumeSharedFields.some((field) => evidence[field] !== stage.evidence[field])
        || check === "BACKUP_STATUS_CONTENT" && (
          evidence.backup_status_disposition !== UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION
          || evidence.current_backup_readiness !== false
          || evidence.post_rollback_backup_required !== true
        )
      )) {
      reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
    }
  }
  const activationStageSha256 = rollbackResult.stages[7].stage_result_sha256;
  if (check === "MIGRATION_HEAD" && (evidence.migration_head !== rollbackResult.predecessor.migration_head
    || evidence.migration_ledger_file_sha256
      !== packageValue.sources.snapshot_migrations.sha256
    || evidence.migration_manifest_sha256 !== rollbackResult.predecessor.migration_manifest_sha256
    || evidence.database_identity_sha256 !== clusterSha256(rollbackResult.restored_database)
    || evidence.postgresql_stage_result_sha256 !== rollbackResult.stages[2].stage_result_sha256)) {
    reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  }
  if (check === "CADDY_IDENTITY" && !same(evidence, activation.caddy)) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  if (check === "POSTGRES_IDENTITY" && !same(evidence, activation.postgres)) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  for (const [label, service] of [["WEB_IDENTITY", "web"], ["WORKER_IDENTITY", "worker"]]) {
    if (check === label && (evidence.container_id !== activation[service].container_id
      || evidence.image_reference !== activation[service].image_reference
      || evidence.image_config_digest !== activation[service].image_config_digest
      || evidence.application_version !== rollbackResult.predecessor.application_version
      || evidence.git_commit !== rollbackResult.predecessor.git_commit
      || evidence.running !== activation[service].running
      || evidence.healthy !== activation[service].healthy
      || evidence.restart_count !== activation[service].restart_count
      || evidence.oom_killed !== activation[service].oom_killed)) {
      reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
    }
  }
  if (check === "RUNTIME_CONFIGURATION" && (
    evidence.predecessor_runtime_configuration_sha256
      !== rollbackResult.predecessor_runtime_configuration_sha256
    || evidence.rollback_runtime_configuration_sha256
      !== rollbackResult.rollback_runtime_configuration_sha256
    || evidence.rollback_runtime_projection_sha256
      !== rollbackResult.rollback_runtime_projection_sha256
    || evidence.compose_rollback_overlay_sha256
      !== rollbackResult.compose_rollback_overlay_sha256
    || evidence.deployment_environment_sha256 !== packageValue.sources.deployment_environment.sha256
    || evidence.activation_stage_result_sha256 !== activationStageSha256
    || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
  )) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  if (check === "STRICT_RELEASE_IDENTITY" && (
    evidence.release_identity_sha256 !== activation.release_identity_sha256
    || evidence.release_manifest_sha256 !== rollbackResult.predecessor.release_manifest_sha256
    || evidence.rollback_postdeploy_receipt_sha256 !== activation.rollback_postdeploy_receipt_sha256
    || evidence.activation_stage_result_sha256 !== activationStageSha256
    || evidence.predecessor_runtime_configuration_sha256
      !== rollbackResult.predecessor_runtime_configuration_sha256
    || evidence.rollback_runtime_configuration_sha256
      !== rollbackResult.rollback_runtime_configuration_sha256
  )) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  if (check === "HEALTH") {
    let readiness;
    try { readiness = validatePostDeployReadiness(evidence.readiness); }
    catch { reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID"); }
    const checkedAtMs = Date.parse(evidence.checked_at);
    const databaseTimeMs = Date.parse(readiness.database_time);
    const expectedServices = {
      caddy: activation.caddy, postgres: activation.postgres,
      web: activation.web, worker: activation.worker,
    };
    if (!timing || !Number.isFinite(checkedAtMs) || !Number.isFinite(databaseTimeMs)
      || checkedAtMs < Date.parse(timing.startedAt)
      || checkedAtMs > Date.parse(timing.completedAt)
      || Math.abs(checkedAtMs - databaseTimeMs) > HEALTH_DATABASE_TIME_MAX_SKEW_MS
      || readiness.deployment_class !== "UAT"
      || readiness.deployment_id !== packageValue.compose_project
      || readiness.version !== rollbackResult.predecessor.application_version
      || readiness.revision !== rollbackResult.predecessor.git_commit.slice(0, 12)
      || readiness.migration_head !== rollbackResult.predecessor.migration_head
      || readiness.migration_manifest_sha256
        !== rollbackResult.predecessor.migration_manifest_sha256
      || evidence.readiness_sha256 !== clusterSha256(readiness)
      || !same(evidence.services, expectedServices)
      || evidence.service_set_sha256 !== clusterSha256(expectedServices)
      || evidence.release_identity_sha256 !== activation.release_identity_sha256
      || evidence.runtime_configuration_sha256 !== rollbackResult.rollback_runtime_configuration_sha256
      || activation.rollback_runtime_configuration_sha256
        !== rollbackResult.rollback_runtime_configuration_sha256
      || evidence.backup_status_disposition !== UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION
      || evidence.current_backup_readiness !== false
      || evidence.post_rollback_backup_required !== true
      || evidence.health_sha256 !== clusterSha256(
        Object.fromEntries(Object.entries(evidence).filter(([field]) => field !== "health_sha256")),
      )) {
      reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
    }
  }
  if (check === "PROTECTED_RESOURCES" && (
    evidence.before_sha256 !== packageValue.protected_resources_sha256
    || evidence.after_sha256 !== packageValue.protected_resources_sha256
    || evidence.protected_recheck_stage_result_sha256 !== rollbackResult.stages[8].stage_result_sha256
    || evidence.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
  )) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
}

function adapterRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [
      "completed_at", "evidence", "side_effect_receipts_sha256", "started_at",
    ].sort()) || !SHA256.test(value.side_effect_receipts_sha256)
    || value.side_effect_receipts_sha256 === ZERO_SHA256) reject(code);
  return value;
}

async function persistRecord(root, record, postverify, intentRecord) {
  const index = record.ordinal - 1;
  const label = postverify ? record.check : record.stage;
  const names = recordNames(index, label);
  const intentField = postverify ? "check_intent_sha256" : "stage_intent_sha256";
  const resultField = postverify ? "check_result_sha256" : "stage_result_sha256";
  await immutableJson(
    path.join(root, `${names.intentPrefix}${intentRecord[intentField]}.json`), intentRecord,
    postverify ? validateUatPromotionRollbackCheckIntent : validateUatPromotionRollbackStageIntent,
    "ROLLBACK_CONTROL_RECORD_INTENT_INVALID",
  );
  await immutableJson(
    path.join(root, `${names.resultPrefix}${record[resultField]}.json`), record,
    postverify ? validateUatPromotionRollbackCheckResult : validateUatPromotionRollbackStageResult,
    "ROLLBACK_CONTROL_RECORD_RESULT_INVALID",
  );
}

function validateContainmentObservation(value, packageValue, runtimeTrust, ledger, containmentIntent) {
  const preparedMs = Date.parse(containmentIntent.prepared_at);
  const deadlineCandidates = [preparedMs + UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS.CONTAIN * 1_000];
  const authorizationDeadline = Date.parse(
    process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_EXPIRES_AT || "",
  );
  if (Number.isFinite(authorizationDeadline)) deadlineCandidates.push(authorizationDeadline);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [
      "after_observed", "before_observed", "containment", "runtime_exchange_sha256",
    ])
    || !SHA256.test(value.runtime_exchange_sha256 || "")) {
    reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
  }
  let before;
  let after;
  try {
    before = validateUatPromotionRollbackRuntimeObservation(value.before_observed);
    after = validateUatPromotionRollbackRuntimeObservation(value.after_observed);
  } catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID"); }
  const containment = value.containment;
  if (!containment || typeof containment !== "object" || Array.isArray(containment)
    || !same(Object.keys(containment).sort(), [
      "active_generation", "after_observation_sha256", "after_writer_inventory_sha256",
      "before_observation_sha256", "before_writer_inventory_sha256",
      "contained_at", "containment_probe_sha256", "database", "last_committed_record_sha256",
      "protected_resources_sha256", "retained_candidate_volumes",
      "retained_candidate_volumes_sha256", "runtime_plan_sha256", "stopped_writers",
      "writer_set_sha256",
    ].sort()) || !containment.database
    || !same(Object.keys(containment.database).sort(), [
      "allow_connections", "marker", "name", "oid", "sealed", "system_identifier",
      "writer_sessions",
    ].sort())
    || containment.database.name !== "chenyida_erp"
    || !/^[1-9][0-9]{0,9}$/u.test(containment.database.oid || "")
    || containment.database.sealed !== true
    || containment.database.system_identifier !== packageValue.database.system_identifier
    || containment.database.marker !== packageValue.database.marker
    || !new Set(["CANDIDATE", "PREDECESSOR", "PARTIAL_OR_UNKNOWN"])
      .has(containment.active_generation)
    || containment.last_committed_record_sha256 !== ledger.lastResultSha256
    || containment.protected_resources_sha256 !== packageValue.protected_resources_sha256
    || containment.runtime_plan_sha256 !== packageValue.runtime_plan_sha256
    || !SHA256.test(containment.containment_probe_sha256 || "")
    || !SHA256.test(containment.retained_candidate_volumes_sha256 || "")
    || !SHA256.test(containment.before_writer_inventory_sha256 || "")
    || !SHA256.test(containment.after_writer_inventory_sha256 || "")
    || !SHA256.test(containment.writer_set_sha256 || "")
    || !Array.isArray(containment.stopped_writers)
    || containment.stopped_writers.some((item) => !item || typeof item !== "object"
      || !same(Object.keys(item).sort(), ["container_id", "service", "writer_key"].sort())
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(item.writer_key || "")
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(item.service || "")
      || !/^[0-9a-f]{64}$/u.test(item.container_id || ""))
    || new Set(containment.stopped_writers.map((item) => item.writer_key)).size
      !== containment.stopped_writers.length
    || new Set(containment.stopped_writers.map((item) => item.container_id)).size
      !== containment.stopped_writers.length
    || nowIso(() => new Date(containment.contained_at)) !== containment.contained_at
    || Date.parse(containment.contained_at) < preparedMs
    || Date.parse(containment.contained_at) > Math.min(...deadlineCandidates)) {
    reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
  }
  const expectedServices = {
    web: containmentIntent.expected_web_container_id,
    worker: containmentIntent.expected_worker_container_id,
  };
  const plan = runtimeTrust.runtimePlan;
  const stopped = Object.fromEntries(containment.stopped_writers.map((item) => [item.writer_key, item]));
  const beforeWriters = before.writer_inventory.members;
  const afterWriters = after.writer_inventory.members;
  const writerIdentitySet = (members) => members.map((item) => ({
    writer_key: item.writer_key,
    service: item.service,
    container_id: item.container_id,
    unexpected: item.unexpected,
  }));
  const expectedStopped = beforeWriters.map((item) => ({
    writer_key: item.writer_key, service: item.service, container_id: item.container_id,
  }));
  const sameServiceIdentity = (service) => [
    "service", "container_id", "image_reference", "image_digest", "restart_count", "oom_killed",
  ].every((field) => before.services[service][field] === after.services[service][field]);
  if (before.observation_sha256 !== containmentIntent.runtime_observation_sha256
    || clusterSha256(before.writer_inventory) !== containmentIntent.expected_writer_inventory_sha256
    || before.writer_inventory.writer_set_sha256 !== containmentIntent.expected_writer_set_sha256
    || before.active_generation !== containmentIntent.expected_active_generation
    || before.database.oid !== containmentIntent.expected_database_oid
    || before.services.web.container_id !== expectedServices.web
    || before.services.worker.container_id !== expectedServices.worker
    || containment.before_observation_sha256 !== before.observation_sha256
    || containment.after_observation_sha256 !== after.observation_sha256
    || containment.before_writer_inventory_sha256 !== clusterSha256(before.writer_inventory)
    || containment.after_writer_inventory_sha256 !== clusterSha256(after.writer_inventory)
    || containment.writer_set_sha256 !== before.writer_inventory.writer_set_sha256
    || containment.active_generation !== before.active_generation
    || !same(containment.database, after.database)
    || !same(after.database, {
      ...before.database, allow_connections: false, writer_sessions: 0, sealed: true,
    })
    || after.active_generation !== before.active_generation
    || !same(after.volumes, before.volumes)
    || !same(after.retained_candidate_volumes, before.retained_candidate_volumes)
    || !same(containment.retained_candidate_volumes, after.retained_candidate_volumes)
    || containment.retained_candidate_volumes_sha256
      !== clusterSha256(containment.retained_candidate_volumes)
    || ["uploads", "attachments", "backup_status"].some((domain) => {
      const expected = { ...plan.candidate.volumes[domain], present: true };
      return !same(before.retained_candidate_volumes[domain], expected)
        || !same(after.retained_candidate_volumes[domain], expected);
    })
    || !same(after.derived_targets, before.derived_targets)
    || after.protected_resources_sha256 !== before.protected_resources_sha256
    || !same(after.services.caddy, before.services.caddy)
    || !same(after.services.postgres, before.services.postgres)
    || before.writer_inventory.discovery_complete !== true
    || after.writer_inventory.discovery_complete !== true
    || before.writer_inventory.discovery_scope !== after.writer_inventory.discovery_scope
    || before.writer_inventory.writer_set_sha256 !== after.writer_inventory.writer_set_sha256
    || !same(writerIdentitySet(beforeWriters), writerIdentitySet(afterWriters))
    || after.writer_inventory.active_writer_count !== 0
    || after.writer_inventory.unexpected_writer_count !== before.writer_inventory.unexpected_writer_count
    || afterWriters.some((item) => item.running)
    || !same(containment.stopped_writers, expectedStopped)
    || ["web", "worker"].some((service) => (
      stopped[service].container_id !== expectedServices[service]
      || !sameServiceIdentity(service)
      || before.services[service].running !== (before.services[service].health !== "stopped")
      || after.services[service].running !== false
      || after.services[service].health !== "stopped"
    ))) reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
  const probeBody = {
    before_observation_sha256: containment.before_observation_sha256,
    after_observation_sha256: containment.after_observation_sha256,
    before_writer_inventory_sha256: containment.before_writer_inventory_sha256,
    after_writer_inventory_sha256: containment.after_writer_inventory_sha256,
    writer_set_sha256: containment.writer_set_sha256,
    database: containment.database,
    stopped_writers: containment.stopped_writers,
    retained_candidate_volumes: containment.retained_candidate_volumes,
    retained_candidate_volumes_sha256: containment.retained_candidate_volumes_sha256,
    protected_resources_sha256: containment.protected_resources_sha256,
    runtime_plan_sha256: containment.runtime_plan_sha256,
    last_committed_record_sha256: containment.last_committed_record_sha256,
    contained_at: containment.contained_at,
  };
  if (containment.containment_probe_sha256 !== clusterSha256(probeBody)) {
    reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
  }
  const exact = ledger.state !== "UNKNOWN" && containmentIntent.containment_attempt === 1;
  const predecessorActive = exact && ledger.ordinal >= 8;
  const databaseRestored = exact && ledger.ordinal >= 3;
  const expectedGeneration = exact ? (predecessorActive ? "PREDECESSOR" : "CANDIDATE") : "PARTIAL_OR_UNKNOWN";
  const expectedDatabaseOid = databaseRestored
    ? ledger.records[2].evidence.restored_database_oid : plan.deployment.database.oid;
  if (exact && (containment.active_generation !== expectedGeneration
    || containment.database.name !== plan.deployment.database.name
    || containment.database.system_identifier !== plan.deployment.database.system_identifier
    || containment.database.marker !== plan.deployment.database.marker
    || containment.database.oid !== expectedDatabaseOid)) {
    reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
  }
  if (exact) {
    const ledgerServices = predecessorActive
      ? {
        web: ledger.records[7].evidence.web.container_id,
        worker: ledger.records[7].evidence.worker.container_id,
      }
      : {
        web: plan.candidate.services.web.container_id,
        worker: plan.candidate.services.worker.container_id,
      };
    if (["web", "worker"].some((service) => stopped[service].container_id !== ledgerServices[service])) {
      reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
    }
  }
  return Object.freeze({
    ...containment,
    runtime_exchange_sha256: value.runtime_exchange_sha256,
  });
}

async function containAndRecord(
  context, intent, packageValue, runtimeTrust, root, adapter, failureCode, options, ledger,
  runtimeRecheck,
) {
  if (!adapter || typeof adapter.contain !== "function") reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
  let runtimeObservation = runtimeRecheck.observed;
  let runtimeTargetState = runtimeRecheck.target_state;
  let observed;
  let containmentIntent;
  let containmentAttemptReceipt;
  let previousContainmentIntentSha256 = null;
  let previousContainmentAttemptReceiptSha256 = null;
  const persistAttemptReceipt = async ({
    outcome, observation, runtimeExchangeSha256: exchangeSha256,
    containmentProbeSha256 = null, nextRuntimeTargetState,
  }) => {
    if (!new Set([
      "DRIFT_BEFORE_CONTAIN", "STALE_INTENT_BEFORE_CONTAIN", "DRIFT_AFTER_CONTAIN",
      "CONTAINED", "REFRESH_REJECTED", "CONTAINMENT_RESPONSE_REJECTED",
    ]).has(outcome) || !SHA256.test(exchangeSha256 || "")
      || containmentProbeSha256 !== null && !SHA256.test(containmentProbeSha256)
      || new Set(["REFRESH_REJECTED", "CONTAINMENT_RESPONSE_REJECTED"]).has(outcome)
        !== (nextRuntimeTargetState === null)) {
      reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
    }
    const receiptBody = {
      schema_version: 1,
      contract: "chenyida-erp-uat-promotion-rollback-containment-attempt/v1",
      status: "RECORDED",
      operation: context.operation,
      operation_id: context.operation_id,
      promotion_id: context.parameters.promotion_id,
      containment_attempt: containmentIntent.containment_attempt,
      containment_intent_sha256: containmentIntent.containment_intent_sha256,
      previous_attempt_receipt_sha256: previousContainmentAttemptReceiptSha256,
      outcome,
      runtime_target_state: containmentIntent.runtime_target_state,
      next_runtime_target_state: nextRuntimeTargetState,
      runtime_observation_sha256: observation.observation_sha256,
      writer_inventory_sha256: clusterSha256(observation.writer_inventory),
      writer_set_sha256: observation.writer_inventory.writer_set_sha256,
      runtime_exchange_sha256: exchangeSha256,
      containment_probe_sha256: containmentProbeSha256,
      recorded_at: nowIso(options.clock),
    };
    const receipt = Object.freeze({
      ...receiptBody, containment_attempt_receipt_sha256: clusterSha256(receiptBody),
    });
    await immutableJson(
      path.join(
        root,
        `containment.attempt.${receipt.containment_attempt}.${receipt.containment_attempt_receipt_sha256}.json`,
      ),
      receipt,
      (value) => {
        if (!same(value, receipt)) reject("ROLLBACK_CONTROL_CONTAINMENT_ATTEMPT_INVALID");
        return value;
      },
      "ROLLBACK_CONTROL_CONTAINMENT_ATTEMPT_INVALID",
    );
    previousContainmentAttemptReceiptSha256 = receipt.containment_attempt_receipt_sha256;
    return receipt;
  };
  for (let attempt = 1; attempt <= MAX_CONTAINMENT_ATTEMPTS; attempt += 1) {
    const preparedAt = nowIso(options.clock);
    const intentBody = {
      schema_version: 1, contract: "chenyida-erp-uat-promotion-rollback-containment-intent/v1",
      status: "PREPARED", operation: context.operation, operation_id: context.operation_id,
      promotion_id: context.parameters.promotion_id, intent_sha256: options.expectedIntentSha256,
      execution_package_sha256: packageValue.package_sha256, failure_code: failureCode,
      ledger_state: ledger.state,
      last_committed_ordinal: ledger.ordinal,
      last_committed_label: ledger.ordinal === 0 ? null
        : (context.operation === "ROLLBACK_POSTVERIFY"
          ? UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS : UAT_PROMOTION_ROLLBACK_STAGES)[ledger.ordinal - 1],
      last_committed_record_sha256: ledger.lastResultSha256,
      containment_attempt: attempt,
      previous_containment_intent_sha256: previousContainmentIntentSha256,
      previous_containment_attempt_receipt_sha256: previousContainmentAttemptReceiptSha256,
      runtime_target_state: runtimeTargetState,
      runtime_observation_sha256: runtimeObservation.observation_sha256,
      expected_writer_inventory_sha256: clusterSha256(runtimeObservation.writer_inventory),
      expected_writer_set_sha256: runtimeObservation.writer_inventory.writer_set_sha256,
      expected_active_generation: runtimeObservation.active_generation,
      expected_database_oid: runtimeObservation.database.oid,
      expected_web_container_id: runtimeObservation.services.web.container_id,
      expected_worker_container_id: runtimeObservation.services.worker.container_id,
      prepared_at: preparedAt,
    };
    containmentIntent = Object.freeze({
      ...intentBody, containment_intent_sha256: clusterSha256(intentBody),
    });
    await immutableJson(
      path.join(root, `containment.intent.${containmentIntent.containment_intent_sha256}.json`),
      containmentIntent,
      (value) => {
        if (!same(value, containmentIntent)) reject("ROLLBACK_CONTROL_CONTAINMENT_INTENT_INVALID");
        return value;
      },
      "ROLLBACK_CONTROL_CONTAINMENT_INTENT_INVALID",
    );
    let containmentResult;
    try {
      containmentResult = await adapter.contain({
        context, intent, packageValue, runtimeTrust, containmentIntent,
        runtimeObservation,
      });
    } catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
    if (containmentResult?.status === "CONTAINMENT_OBSERVATION_DRIFT") {
      if (!same(Object.keys(containmentResult).sort(), [
        "observed", "outcome", "runtime_exchange_sha256", "status",
      ]) || !new Set([
        "DRIFT_BEFORE_CONTAIN", "STALE_INTENT_BEFORE_CONTAIN", "DRIFT_AFTER_CONTAIN",
      ]).has(containmentResult.outcome)) {
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      let refreshedObservation;
      try {
        refreshedObservation = validateUatPromotionRollbackRuntimeObservation(
          containmentResult.observed,
        );
      } catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
      let acceptedObservation;
      try {
        acceptedObservation = validateContainmentRefreshObservation(
          refreshedObservation, runtimeObservation, packageValue, runtimeTrust,
        );
      } catch {
        await persistAttemptReceipt({
          outcome: "REFRESH_REJECTED",
          observation: refreshedObservation,
          runtimeExchangeSha256: containmentResult.runtime_exchange_sha256,
          nextRuntimeTargetState: null,
        });
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      containmentAttemptReceipt = await persistAttemptReceipt({
        outcome: containmentResult.outcome,
        observation: acceptedObservation,
        runtimeExchangeSha256: containmentResult.runtime_exchange_sha256,
        nextRuntimeTargetState: "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
      });
      runtimeObservation = acceptedObservation;
      if (attempt === MAX_CONTAINMENT_ATTEMPTS) {
        reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
      }
      runtimeTargetState = "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT";
      previousContainmentIntentSha256 = containmentIntent.containment_intent_sha256;
      continue;
    }
    try {
      observed = validateContainmentObservation(
        containmentResult, packageValue, runtimeTrust, ledger, containmentIntent,
      );
    } catch {
      let rejectedObservation;
      try {
        rejectedObservation = validateUatPromotionRollbackRuntimeObservation(
          containmentResult?.after_observed,
        );
      } catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
      await persistAttemptReceipt({
        outcome: "CONTAINMENT_RESPONSE_REJECTED",
        observation: rejectedObservation,
        runtimeExchangeSha256: containmentResult.runtime_exchange_sha256,
        containmentProbeSha256: SHA256.test(
          containmentResult?.containment?.containment_probe_sha256 || "",
        ) ? containmentResult.containment.containment_probe_sha256 : null,
        nextRuntimeTargetState: null,
      });
      reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
    }
    containmentAttemptReceipt = await persistAttemptReceipt({
      outcome: "CONTAINED",
      observation: validateUatPromotionRollbackRuntimeObservation(containmentResult.after_observed),
      runtimeExchangeSha256: observed.runtime_exchange_sha256,
      containmentProbeSha256: observed.containment_probe_sha256,
      nextRuntimeTargetState: containmentIntent.runtime_target_state,
    });
    break;
  }
  if (!observed || !containmentIntent || !containmentAttemptReceipt) {
    reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
  }
  const body = {
    schema_version: 1, contract: "chenyida-erp-uat-promotion-rollback-containment/v1",
    status: "CONTAINED_FOR_JOURNAL_QUARANTINE", operation: context.operation,
    operation_id: context.operation_id, promotion_id: context.parameters.promotion_id,
    intent_sha256: options.expectedIntentSha256,
    containment_intent_sha256: containmentIntent.containment_intent_sha256,
    containment_attempt: containmentIntent.containment_attempt,
    previous_containment_intent_sha256: containmentIntent.previous_containment_intent_sha256,
    previous_containment_attempt_receipt_sha256:
      containmentIntent.previous_containment_attempt_receipt_sha256,
    containment_attempt_receipt_sha256:
      containmentAttemptReceipt.containment_attempt_receipt_sha256,
    execution_package_sha256: packageValue.package_sha256, failure_code: failureCode,
    database: observed.database, stopped_writers: observed.stopped_writers,
    active_generation: observed.active_generation,
    before_observation_sha256: observed.before_observation_sha256,
    after_observation_sha256: observed.after_observation_sha256,
    before_writer_inventory_sha256: observed.before_writer_inventory_sha256,
    after_writer_inventory_sha256: observed.after_writer_inventory_sha256,
    writer_set_sha256: observed.writer_set_sha256,
    containment_probe_sha256: observed.containment_probe_sha256,
    runtime_exchange_sha256: observed.runtime_exchange_sha256,
    retained_candidate_volumes: observed.retained_candidate_volumes,
    retained_candidate_volumes_sha256: observed.retained_candidate_volumes_sha256,
    protected_resources_sha256: observed.protected_resources_sha256,
    runtime_plan_sha256: observed.runtime_plan_sha256,
    last_committed_record_sha256: observed.last_committed_record_sha256,
    runtime_target_state: containmentIntent.runtime_target_state,
    contained_at: observed.contained_at,
    preservation: "EXACT_RECORD_INTENTS_RESULTS_AND_CANDIDATE_RESOURCES_LEFT_UNCHANGED_NO_RERUN_NO_DELETE",
    recovery_authorization_sha256: context.execution_authorization_sha256,
  };
  const containment = Object.freeze({ ...body, containment_sha256: clusterSha256(body) });
  await immutableJson(
    path.join(root, `containment.result.${containment.containment_sha256}.json`), containment,
    (value) => { if (!same(value, containment)) reject("ROLLBACK_CONTROL_CONTAINMENT_INVALID"); return value; },
    "ROLLBACK_CONTROL_CONTAINMENT_INVALID",
  );
  return containment;
}

async function executeRecords(context, intent, packageValue, rollbackResult, root, adapter, options) {
  const postverify = context.operation === "ROLLBACK_POSTVERIFY";
  const labels = postverify ? UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS : UAT_PROMOTION_ROLLBACK_STAGES;
  const records = [];
  let previousResultSha256 = ZERO_SHA256;
  for (const [index, label] of labels.entries()) {
    const roles = [...new Set([
      ...(postverify ? CHECK_SOURCE_ROLES[label] : STAGE_SOURCE_ROLES[label]),
      "runtime_adapter_activation",
    ])];
    await verifyPackageSources(packageValue, options.filesystemRoot, roles);
    const preparedAt = nowIso(options.clock);
    const common = {
      promotion_id: context.parameters.promotion_id,
      promotion_generation: context.parameters.promotion_generation,
      operation_id: context.operation_id,
      execution_authorization_sha256: context.original_authorization_sha256,
      rollback_plan_sha256: postverify ? rollbackResult.rollback_plan_sha256 : intent.rollback_plan_sha256,
      execution_package_sha256: packageValue.package_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      ordinal: index + 1,
      previous_result_sha256: previousResultSha256,
      input_sha256: clusterSha256({
        operation_id: context.operation_id, label, ordinal: index + 1,
        rollback_plan_sha256: postverify ? rollbackResult.rollback_plan_sha256 : intent.rollback_plan_sha256,
        execution_package_sha256: packageValue.package_sha256,
        runtime_plan_sha256: packageValue.runtime_plan_sha256,
        previous_result_sha256: previousResultSha256,
      }),
      prepared_at: preparedAt,
    };
    const recordIntent = postverify
      ? createUatPromotionRollbackCheckIntent({ ...common, check: label })
      : createUatPromotionRollbackStageIntent({ ...common, stage: label });
    const names = recordNames(index, label);
    const intentField = postverify ? "check_intent_sha256" : "stage_intent_sha256";
    await immutableJson(
      path.join(root, `${names.intentPrefix}${recordIntent[intentField]}.json`), recordIntent,
      postverify ? validateUatPromotionRollbackCheckIntent : validateUatPromotionRollbackStageIntent,
      "ROLLBACK_CONTROL_RECORD_INTENT_INVALID",
    );
    await verifyPackageSources(packageValue, options.filesystemRoot, roles);
    const observed = adapterRecord(postverify
      ? await adapter.verifyCheck({
        context, intent, packageValue, rollbackResult, runtimeTrust: options.runtimeTrust,
        check: label, checkIntent: recordIntent,
      })
      : await adapter.executeStage({
        context, intent, packageValue, rollbackResult, runtimeTrust: options.runtimeTrust,
        stage: label, stageIntent: recordIntent,
      }),
    postverify ? "ROLLBACK_CONTROL_CHECK_ADAPTER_RESULT_INVALID" : "ROLLBACK_CONTROL_STAGE_ADAPTER_RESULT_INVALID");
    await verifyPackageSources(packageValue, options.filesystemRoot, roles);
    if (Date.parse(observed.started_at) < Date.parse(preparedAt)
      || Date.parse(observed.completed_at) > Date.parse(packageValue.execution_deadline)) {
      reject("ROLLBACK_CONTROL_RECORD_TIME_INVALID");
    }
    if (postverify) assertCheckEvidenceBindings(
      label, observed.evidence, rollbackResult, packageValue,
      { startedAt: observed.started_at, completedAt: observed.completed_at },
    );
    else assertStageEvidenceBindings(
      label, observed.evidence, intent, packageValue, options.runtimeTrust, recordIntent,
    );
    const resultCommon = {
      promotion_id: common.promotion_id,
      promotion_generation: common.promotion_generation,
      operation_id: common.operation_id,
      execution_authorization_sha256: common.execution_authorization_sha256,
      rollback_plan_sha256: common.rollback_plan_sha256,
      execution_package_sha256: common.execution_package_sha256,
      runtime_plan_sha256: common.runtime_plan_sha256,
      ordinal: common.ordinal,
      previous_result_sha256: common.previous_result_sha256,
    };
    const recordResult = postverify
      ? createUatPromotionRollbackCheckResult({
        ...resultCommon, check: label, check_intent_sha256: recordIntent.check_intent_sha256,
        side_effect_receipts_sha256: observed.side_effect_receipts_sha256,
        evidence: observed.evidence, started_at: observed.started_at, completed_at: observed.completed_at,
      })
      : createUatPromotionRollbackStageResult({
        ...resultCommon, stage: label, stage_intent_sha256: recordIntent.stage_intent_sha256,
        side_effect_receipts_sha256: observed.side_effect_receipts_sha256,
        evidence: observed.evidence, started_at: observed.started_at, completed_at: observed.completed_at,
      });
    await persistRecord(root, recordResult, postverify, recordIntent);
    records.push(recordResult);
    previousResultSha256 = postverify ? recordResult.check_result_sha256 : recordResult.stage_result_sha256;
    options.onCommit?.(previousResultSha256);
  }
  return Object.freeze({ records: Object.freeze(records), previousResultSha256 });
}

function finalResult(context, intent, packageValue, rollbackResult, execution) {
  if (context.operation === "ROLLBACK_EXECUTION") {
    const postgres = execution.records[2].evidence;
    const runtimeConfiguration = execution.records[6].evidence;
    return createUatPromotionRollbackResult({
      promotion_id: intent.promotion_id, promotion_generation: intent.promotion_generation,
      rollback_operation_id: intent.rollback_operation_id,
      execution_authorization_sha256: intent.execution_authorization_sha256,
      supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
      checkpoint_13_receipt_sha256: intent.checkpoint_13_receipt_sha256,
      rollback_intent_sha256: intent.rollback_intent_sha256, rollback_plan_sha256: intent.rollback_plan_sha256,
      execution_package_sha256: packageValue.package_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      source_set_sha256: packageValue.source_set_sha256,
      promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
      uat_reconciliation_authority_sha256:
        postgres.uat_reconciliation_authority_sha256,
      uat_reconciliation_activation_sha256:
        postgres.uat_reconciliation_activation_sha256,
      sealed_security_projection_sha256: postgres.sealed_security_projection_sha256,
      snapshot_readiness_sha256: intent.snapshot_readiness_sha256,
      snapshot_backup_id: intent.parameters.snapshot_backup_id,
      snapshot_restore_run_id: intent.parameters.snapshot_restore_run_id,
      snapshot_objects: intent.parameters.snapshot_objects, predecessor: intent.parameters.predecessor,
      database: intent.parameters.database,
      restored_database: {
        name: postgres.restored_database_name, system_identifier: postgres.system_identifier,
        oid: postgres.restored_database_oid, marker: intent.parameters.database.marker,
      },
      candidate_database_quarantine: {
        name: postgres.candidate_database_quarantine_name,
        oid: postgres.candidate_database_quarantine_oid,
      },
      predecessor_runtime_configuration_sha256:
        runtimeConfiguration.predecessor_runtime_configuration_sha256,
      rollback_runtime_configuration_sha256:
        runtimeConfiguration.rollback_runtime_configuration_sha256,
      rollback_runtime_projection_sha256:
        runtimeConfiguration.rollback_runtime_projection_sha256,
      compose_rollback_overlay_sha256: runtimeConfiguration.compose_rollback_overlay_sha256,
      compose_project: intent.parameters.compose_project,
      compose_project_root: intent.parameters.compose_project_root, boundary: intent.parameters.boundary,
      protected_resources_before_sha256: packageValue.protected_resources_sha256,
      protected_resources_after_sha256: execution.records.at(-1).evidence.after_sha256,
      stage_result_sha256_chain: execution.previousResultSha256, stages: execution.records,
      started_at: execution.records[0].started_at, completed_at: execution.records.at(-1).completed_at,
    });
  }
  return createUatPromotionRollbackPostverifyResult({
    promotion_id: intent.promotion_id, promotion_generation: intent.promotion_generation,
    postverify_operation_id: intent.postverify_operation_id,
    execution_authorization_sha256: intent.execution_authorization_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    checkpoint_14_receipt_sha256: intent.checkpoint_14_receipt_sha256,
    rollback_operation_id: intent.rollback_operation_id, rollback_intent_sha256: intent.rollback_intent_sha256,
    rollback_result_sha256: rollbackResult.result_sha256, rollback_plan_sha256: rollbackResult.rollback_plan_sha256,
    execution_package_sha256: packageValue.package_sha256,
    runtime_plan_sha256: packageValue.runtime_plan_sha256,
    postverify_intent_sha256: intent.postverify_intent_sha256,
    postverify_plan_sha256: intent.postverify_plan_sha256, snapshot_objects: rollbackResult.snapshot_objects,
    predecessor: rollbackResult.predecessor, database: rollbackResult.database,
    restored_database: rollbackResult.restored_database,
    candidate_database_quarantine: rollbackResult.candidate_database_quarantine,
    boundary: rollbackResult.boundary,
    uat_reconciliation_authority_sha256:
      rollbackResult.uat_reconciliation_authority_sha256,
    uat_reconciliation_activation_sha256:
      rollbackResult.uat_reconciliation_activation_sha256,
    sealed_security_projection_sha256: rollbackResult.sealed_security_projection_sha256,
    predecessor_runtime_configuration_sha256:
      rollbackResult.predecessor_runtime_configuration_sha256,
    rollback_runtime_configuration_sha256: rollbackResult.rollback_runtime_configuration_sha256,
    rollback_runtime_projection_sha256: rollbackResult.rollback_runtime_projection_sha256,
    compose_rollback_overlay_sha256: rollbackResult.compose_rollback_overlay_sha256,
    check_result_sha256_chain: execution.previousResultSha256, checks: execution.records,
    verified_at: execution.records.at(-1).completed_at,
  });
}

export async function runUatPromotionRollbackControl(contextInput, phase, options = {}) {
  const context = validateUatPromotionContext(contextInput);
  const resolved = controlOptions(context, phase, options);
  const intent = await trustedIntent(context, options.expectedIntentSha256, resolved.filesystemRoot);
  const rollbackResult = context.operation === "ROLLBACK_POSTVERIFY"
    ? await loadRollbackResultForPostverify(context, resolved.filesystemRoot) : null;
  const { packageValue } = await loadExecutionPackage(context, intent, resolved.filesystemRoot, rollbackResult);
  const adapter = options.adapter ?? productionAdapter(context, intent);
  if (phase === "preflight") return preflightUatPromotionRollbackControl(context, options);
  const runtimeTrust = await loadRuntimeTrustSources(
    context, packageValue, resolved.filesystemRoot, resolved.clock, { full: false },
  );
  if (!adapter || typeof adapter.recheck !== "function") reject("ROLLBACK_CONTROL_ADAPTER_INVALID");
  const runtimeRecheck = validateRuntimeGateResponse(
    await adapter.recheck({ context, intent, packageValue, rollbackResult, runtimeTrust }),
    packageValue, context.execution_mode, context.operation, "RECHECK", runtimeTrust,
  );
  if (context.operation === "ROLLBACK_POSTVERIFY" && context.execution_mode === "ORIGINAL"
    && !exactRuntimeMatchesRollbackStages(runtimeRecheck, rollbackResult.stages)) {
    reject("ROLLBACK_CONTROL_RUNTIME_RECHECK_INVALID");
  }
  let recordTrust = runtimeTrust;
  try {
    recordTrust = await loadRuntimeTrustSources(
      context, packageValue, resolved.filesystemRoot, resolved.clock,
    );
  } catch (cause) {
    if (phase !== "recover") throw cause;
  }
  const root = await executionRoot(context, options.expectedIntentSha256, resolved.filesystemRoot, phase === "recover");
  let ledger;
  try {
    ledger = await auditCommittedRecords(
      root, context, intent, packageValue, rollbackResult, recordTrust,
    );
  } catch {
    ledger = Object.freeze({
      state: "UNKNOWN", complete: false, ordinal: 0,
      records: Object.freeze([]), lastResultSha256: ZERO_SHA256,
    });
  }
  let existing;
  try { existing = await completion(context, intent, resolved.filesystemRoot, root); }
  catch (cause) {
    if (phase !== "recover") throw cause;
    existing = Object.freeze({ partial: true });
  }
  if (phase === "recover") {
    const runtimeClaimsExact = runtimeRecheck.target_state === "EXACT_RESULT_ALREADY_DURABLE";
    const runtimeExact = exactRuntimeMatchesDurableRollback(
      context, runtimeRecheck, ledger, rollbackResult,
    );
    if (runtimeExact && ledger.complete && existing && !existing.partial
      && resolved.recoveryDecision === "ALREADY_COMMITTED") {
      return Object.freeze({
        result: context.operation === "ROLLBACK_POSTVERIFY"
          ? "ROLLBACK_POSTVERIFY_ALREADY_COMPLETED" : "ROLLBACK_EXECUTION_ALREADY_COMPLETED",
        promotion_id: context.parameters.promotion_id, result_sha256: existing.result.result_sha256,
      });
    }
    if (runtimeExact && ledger.complete && existing === null
      && resolved.recoveryDecision === "RESUME_PUBLICATION") {
      const rebuilt = finalResult(context, intent, packageValue, rollbackResult, {
        records: ledger.records, previousResultSha256: ledger.lastResultSha256,
      });
      if (context.operation === "ROLLBACK_POSTVERIFY") {
        assertUatPromotionRollbackPostverifyResultMatchesIntent(rebuilt, intent, rollbackResult);
      } else assertUatPromotionRollbackResultMatchesIntent(rebuilt, intent);
      const resultRoot = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/results`, resolved.filesystemRoot);
      await immutableJson(
        path.join(resultRoot, `${context.operation_id}.${rebuilt.result_sha256}.json`), rebuilt,
        context.operation === "ROLLBACK_POSTVERIFY"
          ? validateUatPromotionRollbackPostverifyResult : validateUatPromotionRollbackResult,
        "ROLLBACK_CONTROL_RESULT_PUBLICATION_INVALID",
      );
      const published = await completion(context, intent, resolved.filesystemRoot, root);
      if (!published || published.partial || published.result.result_sha256 !== rebuilt.result_sha256) {
        reject("ROLLBACK_CONTROL_RESULT_PUBLICATION_INVALID");
      }
      return Object.freeze({
        result: context.operation === "ROLLBACK_POSTVERIFY"
          ? "ROLLBACK_POSTVERIFY_ALREADY_COMPLETED" : "ROLLBACK_EXECUTION_ALREADY_COMPLETED",
        promotion_id: context.parameters.promotion_id, result_sha256: rebuilt.result_sha256,
      });
    }
    const containmentLedger = runtimeExact ? ledger : Object.freeze({ ...ledger, state: "UNKNOWN" });
    const containment = await containAndRecord(
      context, intent, packageValue, runtimeTrust, root, adapter,
      runtimeRecheck.target_state === "BLOCKED_TARGET_IDENTITY_MISMATCH"
        ? "ROLLBACK_CONTROL_RUNTIME_TARGET_IDENTITY_MISMATCH"
        : runtimeClaimsExact && !runtimeExact
          ? "ROLLBACK_CONTROL_RUNTIME_LEDGER_MISMATCH"
        : runtimeRecheck.target_state === "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT"
          ? "ROLLBACK_CONTROL_RUNTIME_PARTIAL_OR_UNKNOWN"
          : resolved.recoveryDecision === "QUARANTINE" && existing && !existing.partial
        ? "ROLLBACK_JOURNAL_REQUIRES_RUNTIME_QUARANTINE"
          : existing === null ? "ROLLBACK_CONTROL_RESULT_ABSENT_OR_UNPUBLISHABLE"
            : "ROLLBACK_CONTROL_RESULT_UNTRUSTED_OR_PARTIAL",
      { ...options, ...resolved, runtimeTrust },
      containmentLedger,
      runtimeRecheck,
    );
    return Object.freeze({
      result: "CONTAINED_FOR_JOURNAL_QUARANTINE", promotion_id: context.parameters.promotion_id,
      containment_sha256: containment.containment_sha256,
    });
  }
  if (existing !== null) reject("ROLLBACK_CONTROL_RESULT_PREEXISTS");
  const requiredMethod = context.operation === "ROLLBACK_POSTVERIFY" ? "verifyCheck" : "executeStage";
  if (!adapter || typeof adapter[requiredMethod] !== "function" || typeof adapter.contain !== "function") {
    reject("ROLLBACK_CONTROL_ADAPTER_INVALID");
  }
  try {
    const execution = await executeRecords(
      context, intent, packageValue, rollbackResult, root, adapter,
      { ...options, ...resolved, runtimeTrust: recordTrust },
    );
    const result = finalResult(context, intent, packageValue, rollbackResult, execution);
    if (context.operation === "ROLLBACK_POSTVERIFY") {
      assertUatPromotionRollbackPostverifyResultMatchesIntent(result, intent, rollbackResult);
    } else assertUatPromotionRollbackResultMatchesIntent(result, intent);
    const resultRoot = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/results`, resolved.filesystemRoot);
    await immutableJson(
      path.join(resultRoot, `${context.operation_id}.${result.result_sha256}.json`), result,
      context.operation === "ROLLBACK_POSTVERIFY"
        ? validateUatPromotionRollbackPostverifyResult : validateUatPromotionRollbackResult,
      "ROLLBACK_CONTROL_RESULT_PUBLICATION_INVALID",
    );
    return Object.freeze({
      result: context.operation === "ROLLBACK_POSTVERIFY"
        ? "ROLLBACK_POSTVERIFY_RESULT_PERSISTED" : "ROLLBACK_EXECUTION_RESULT_PERSISTED",
      promotion_id: context.parameters.promotion_id, result_sha256: result.result_sha256,
    });
  } catch (cause) {
    let failureLedger;
    try {
      failureLedger = await auditCommittedRecords(
        root, context, intent, packageValue, rollbackResult, recordTrust,
      );
    } catch {
      failureLedger = Object.freeze({
        state: "UNKNOWN", complete: false, ordinal: 0,
        records: Object.freeze([]), lastResultSha256: ZERO_SHA256,
      });
    }
    const containmentStates = new Set([
      "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
      "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT", "BLOCKED_TARGET_IDENTITY_MISMATCH",
    ]);
    const failureRuntimeRecheck = validateRuntimeGateResponse(
      await adapter.recheck({
        context, intent, packageValue, rollbackResult, runtimeTrust, containment: true,
      }),
      packageValue, context.execution_mode, context.operation, "RECHECK", runtimeTrust,
      containmentStates,
    );
    await containAndRecord(
      context, intent, packageValue, runtimeTrust, root, adapter,
      cause?.code || "ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED",
      { ...options, ...resolved }, Object.freeze({ ...failureLedger, state: "UNKNOWN" }),
      failureRuntimeRecheck,
    );
    throw cause;
  }
}

function assertSupervisorControl(context, phase) {
  const consumed = phase === "preflight" ? "NO" : "YES";
  if (process.getuid?.() !== 0 || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES"
    || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED !== consumed
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED
      !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT) reject("ROLLBACK_CONTROL_SUPERVISOR_INVALID");
  const bundleRoot = path.dirname(SITE_ROOT);
  if (path.dirname(bundleRoot) !== SUPERVISOR_BUNDLE_ROOT
    || path.basename(bundleRoot) !== context.supervisor_bundle_sha256) reject("ROLLBACK_CONTROL_SUPERVISOR_INVALID");
  const descriptorText = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/u.test(descriptorText || "")) reject("ROLLBACK_CONTROL_LOCK_INVALID");
  const descriptor = Number(descriptorText);
  let opened, named, locks;
  try {
    opened = fstatSync(descriptor, { bigint: true });
    named = lstatSync(GLOBAL_RELEASE_LOCK, { bigint: true });
    locks = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:"));
  } catch { reject("ROLLBACK_CONTROL_LOCK_INVALID"); }
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || named.uid !== 0n
    || named.gid !== 0n || named.nlink !== 1n || modeOf(named) !== 0o600
    || opened.dev !== named.dev || opened.ino !== named.ino || locks.length !== 1
    || !/^lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ /u.test(locks[0])) reject("ROLLBACK_CONTROL_LOCK_INVALID");
}

async function readContext() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) reject("ROLLBACK_CONTROL_CONTEXT_INVALID");
    chunks.push(chunk);
  }
  try { return parseStrictJson(Buffer.concat(chunks).toString("utf8"), 512 * 1024); }
  catch { reject("ROLLBACK_CONTROL_CONTEXT_INVALID"); }
}

async function main(argumentsList) {
  const phase = argumentsList[0];
  if (!new Set(["preflight", "execute", "recover"]).has(phase)
    || !SHA256.test(argumentsList[1] || "")
    || phase === "recover" && (argumentsList.length !== 3 || !new Set([
      "RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE",
    ]).has(argumentsList[2]))
    || phase !== "recover" && argumentsList.length !== 2) reject("ROLLBACK_CONTROL_USAGE_INVALID");
  const context = validateUatPromotionContext(await readContext());
  assertSupervisorControl(context, phase);
  const options = {
    expectedIntentSha256: argumentsList[1],
    ...(phase === "recover" ? { recoveryDecision: argumentsList[2] } : {}),
  };
  const result = phase === "preflight"
    ? await preflightUatPromotionRollbackControl(context, options)
    : await runUatPromotionRollbackControl(context, phase, options);
  process.stdout.write(canonicalClusterJson(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "ROLLBACK_CONTROL_FAILED"}\n`);
    process.exitCode = 1;
  });
}
