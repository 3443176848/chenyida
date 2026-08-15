import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { parseStrictJson } from "./release-identity-contract.mjs";
import {
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

const STAGE_SOURCE_ROLES = Object.freeze({
  PRECONDITION_RECHECK: UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES,
  WRITER_CONTAINMENT: ["candidate_deployment_result", "candidate_postdeploy_identity"],
  POSTGRESQL_RESTORE: [
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_postgresql", "snapshot_policy", "snapshot_policy_activation",
  ],
  UPLOADS_RESTORE: ["snapshot_manifest", "snapshot_uploads"],
  ATTACHMENTS_RESTORE: ["snapshot_manifest", "snapshot_attachments"],
  BACKUP_STATUS_RESTORE: ["snapshot_manifest", "snapshot_backup_status"],
  RUNTIME_CONFIGURATION_RESTORE: [
    "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
  ],
  WEB_WORKER_PREDECESSOR_ACTIVATION: [
    "predecessor_postdeploy_receipt", "predecessor_release_manifest", "compose_file",
    "compose_release_file", "deployment_environment", "runtime_policy",
  ],
  PROTECTED_RESOURCE_RECHECK: ["candidate_deployment_result", "candidate_postdeploy_identity"],
});

const CHECK_SOURCE_ROLES = Object.freeze({
  POSTGRESQL_CONTENT: ["snapshot_postgresql", "snapshot_manifest", "snapshot_migrations"],
  UPLOADS_CONTENT: ["snapshot_uploads", "snapshot_manifest"],
  ATTACHMENTS_CONTENT: ["snapshot_attachments", "snapshot_manifest"],
  BACKUP_STATUS_CONTENT: ["snapshot_backup_status", "snapshot_manifest"],
  MIGRATION_HEAD: ["snapshot_migrations", "predecessor_release_manifest"],
  CADDY_IDENTITY: ["candidate_deployment_result"],
  POSTGRES_IDENTITY: ["candidate_deployment_result"],
  WEB_IDENTITY: ["predecessor_postdeploy_receipt", "predecessor_release_manifest"],
  WORKER_IDENTITY: ["predecessor_postdeploy_receipt", "predecessor_release_manifest"],
  RUNTIME_CONFIGURATION: ["deployment_environment", "runtime_policy"],
  STRICT_RELEASE_IDENTITY: ["predecessor_postdeploy_receipt", "predecessor_release_manifest"],
  HEALTH: ["predecessor_postdeploy_receipt"],
  PROTECTED_RESOURCES: ["candidate_deployment_result", "candidate_postdeploy_identity"],
});

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

function invokeHelper(context, intent, consumed, phase, label = null) {
  const descriptor = Number(process.env.ERP_RELEASE_GATE_LOCK_FD);
  const stdio = ["pipe", "pipe", "pipe"];
  for (let index = 3; index <= descriptor; index += 1) stdio[index] = "ignore";
  stdio[descriptor] = descriptor;
  const argumentsList = [HELPER, phase, context.operation_id];
  if (label !== null) argumentsList.push(label);
  const result = spawnSync("/usr/bin/python3", argumentsList, {
    cwd: "/", env: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent", PYTHONDONTWRITEBYTECODE: "1",
      PYTHONHASHSEED: "0", ERP_RELEASE_SUPERVISOR_LAUNCHED: "YES",
      ERP_RELEASE_GATE_LOCK_HELD: "YES", ERP_RELEASE_GATE_LOCK_FD: String(descriptor),
      ERP_RELEASE_SUPERVISOR_SITE_ROOT: SITE_ROOT,
      ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256: context.supervisor_bundle_sha256,
      ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256: context.execution_authorization_sha256,
      ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED: consumed ? "YES" : "NO",
      ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED:
        context.execution_mode === "RECOVERY" ? "YES" : "NO",
    },
    input: Buffer.from(canonicalClusterJson({ context, intent })), encoding: "buffer",
    maxBuffer: MAX_JSON_BYTES, timeout: phase === "preflight" ? 120_000 : 30 * 60 * 1000, stdio,
  });
  if (result.status !== 0 || result.signal !== null || result.stderr?.length !== 0
    || !result.stdout || result.stdout.length < 2 || result.stdout.length > MAX_JSON_BYTES) {
    reject(phase === "contain"
      ? "ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"
      : phase === "preflight" ? "ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_FAILED"
        : "ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED");
  }
  try { return parseStrictJson(result.stdout.toString("utf8"), MAX_JSON_BYTES); }
  catch { reject("ROLLBACK_CONTROL_RUNTIME_ADAPTER_RESPONSE_INVALID"); }
}

function productionAdapter(context, intent) {
  return Object.freeze({
    async preflight() { return invokeHelper(context, intent, false, "preflight"); },
    async executeStage({ stage, stageIntent }) {
      return invokeHelper(context, { intent, record_intent: stageIntent }, true, "stage", stage);
    },
    async verifyCheck({ check, checkIntent, rollbackResult }) {
      return invokeHelper(context, { intent, record_intent: checkIntent, rollback_result: rollbackResult }, true, "check", check);
    },
    async contain({ containmentIntent }) {
      return invokeHelper(context, { intent, containment_intent: containmentIntent }, true, "contain");
    },
  });
}

function validatePreflightResponse(value, packageValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), ["execution_package_sha256", "result", "source_set_sha256"].sort())
    || value.result !== "ROLLBACK_RUNTIME_PREFLIGHT_PASSED"
    || value.execution_package_sha256 !== packageValue.package_sha256
    || value.source_set_sha256 !== packageValue.source_set_sha256) reject("ROLLBACK_CONTROL_RUNTIME_PREFLIGHT_INVALID");
  return value;
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
  if (Date.parse(nowIso(resolved.clock)) > Date.parse(packageValue.execution_deadline)) {
    reject("ROLLBACK_CONTROL_EXECUTION_DEADLINE_EXPIRED");
  }
  const adapter = options.adapter ?? productionAdapter(context, intent);
  if (!adapter || typeof adapter.preflight !== "function") reject("ROLLBACK_CONTROL_ADAPTER_INVALID");
  const response = validatePreflightResponse(
    await adapter.preflight({ context, intent, packageValue, rollbackResult }), packageValue,
  );
  const reloaded = await loadExecutionPackage(
    context, intent, resolved.filesystemRoot, rollbackResult,
  );
  if (!same(reloaded.packageValue, packageValue)) reject("ROLLBACK_CONTROL_EXECUTION_PACKAGE_CHANGED");
  await verifyPackageSources(
    reloaded.packageValue, resolved.filesystemRoot, UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES,
  );
  return Object.freeze({
    result: "ROLLBACK_CONTROL_PREFLIGHT_PASSED", promotion_id: context.parameters.promotion_id,
    intent_sha256: options.expectedIntentSha256,
    execution_package_sha256: response.execution_package_sha256,
    source_set_sha256: response.source_set_sha256,
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

async function lastCommittedRecord(root, postverify) {
  const labels = postverify ? UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS : UAT_PROMOTION_ROLLBACK_STAGES;
  const names = (await readdir(root)).sort();
  let previous = ZERO_SHA256;
  for (const [index, label] of labels.entries()) {
    const prefix = recordNames(index, label).resultPrefix;
    const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
    if (matches.length === 0) break;
    if (matches.length !== 1) return ZERO_SHA256;
    let stored;
    try {
      stored = await trustedJson(
        path.join(root, matches[0]),
        postverify ? validateUatPromotionRollbackCheckResult : validateUatPromotionRollbackStageResult,
        "ROLLBACK_CONTROL_RECORD_RESULT_INVALID",
      );
    } catch { return ZERO_SHA256; }
    const digestField = postverify ? "check_result_sha256" : "stage_result_sha256";
    if (stored.value.previous_result_sha256 !== previous
      || matches[0] !== `${prefix}${stored.value[digestField]}.json`) return ZERO_SHA256;
    previous = stored.value[digestField];
  }
  return previous;
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

function assertStageEvidenceBindings(stage, evidence, intent, packageValue) {
  const parameters = intent.parameters;
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
    || evidence.finalization_intent_sha256 !== parameters.finalization_intent_sha256)) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  if (Object.hasOwn(sourceByStage, stage)) {
    const [role, domain] = sourceByStage[stage];
    const object = parameters.snapshot_objects[domain];
    if (evidence.source_sha256 !== packageValue.sources[role].sha256
      || evidence.source_sha256 !== object.sha256 || evidence.source_bytes !== object.bytes
      || evidence.content_sha256 !== object.sha256
      || domain !== "postgresql" && evidence.source_entries !== object.entries
      || domain === "postgresql" && (evidence.snapshot_database_oid !== parameters.database.oid
        || evidence.system_identifier !== parameters.database.system_identifier
        || evidence.migration_head !== parameters.predecessor.migration_head)) {
      reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
    }
  }
  if (stage === "RUNTIME_CONFIGURATION_RESTORE" && (
    evidence.compose_file_sha256 !== packageValue.sources.compose_file.sha256
    || evidence.compose_release_file_sha256 !== packageValue.sources.compose_release_file.sha256
    || evidence.deployment_environment_sha256 !== packageValue.sources.deployment_environment.sha256
    || evidence.runtime_policy_sha256 !== packageValue.sources.runtime_policy.sha256
    || evidence.runtime_configuration_sha256 !== parameters.predecessor.runtime_configuration_sha256
  )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  if (stage === "WEB_WORKER_PREDECESSOR_ACTIVATION" && (
    evidence.web.image_reference !== parameters.predecessor.web_image
    || evidence.worker.image_reference !== parameters.predecessor.worker_image
  )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
  if (stage === "PROTECTED_RESOURCE_RECHECK" && (
    evidence.before_sha256 !== packageValue.protected_resources_sha256
    || evidence.after_sha256 !== packageValue.protected_resources_sha256
  )) reject("ROLLBACK_CONTROL_STAGE_EVIDENCE_BINDING_INVALID");
}

function assertCheckEvidenceBindings(check, evidence, rollbackResult, packageValue) {
  const sourceByCheck = {
    POSTGRESQL_CONTENT: ["snapshot_postgresql", "postgresql"],
    UPLOADS_CONTENT: ["snapshot_uploads", "uploads"],
    ATTACHMENTS_CONTENT: ["snapshot_attachments", "attachments"],
    BACKUP_STATUS_CONTENT: ["snapshot_backup_status", "backup_status"],
  };
  if (Object.hasOwn(sourceByCheck, check)) {
    const [role, domain] = sourceByCheck[check];
    const object = rollbackResult.snapshot_objects[domain];
    if (evidence.source_sha256 !== packageValue.sources[role].sha256
      || evidence.source_sha256 !== object.sha256 || evidence.content_sha256 !== object.sha256
      || evidence.bytes !== object.bytes || evidence.entries !== object.entries) {
      reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
    }
  }
  const activation = rollbackResult.stages[7].evidence;
  if (check === "MIGRATION_HEAD" && (evidence.migration_head !== rollbackResult.predecessor.migration_head
    || evidence.migration_manifest_sha256 !== rollbackResult.predecessor.migration_manifest_sha256)) {
    reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  }
  if (check === "CADDY_IDENTITY" && !same(evidence, activation.caddy)) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  if (check === "POSTGRES_IDENTITY" && !same(evidence, activation.postgres)) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  for (const [label, service] of [["WEB_IDENTITY", "web"], ["WORKER_IDENTITY", "worker"]]) {
    if (check === label && (evidence.container_id !== activation[service].container_id
      || evidence.image_reference !== activation[service].image_reference
      || evidence.application_version !== rollbackResult.predecessor.application_version
      || evidence.git_commit !== rollbackResult.predecessor.git_commit)) {
      reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
    }
  }
  if (check === "RUNTIME_CONFIGURATION" && (
    evidence.runtime_configuration_sha256 !== rollbackResult.predecessor.runtime_configuration_sha256
    || evidence.deployment_environment_sha256 !== packageValue.sources.deployment_environment.sha256
  )) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  if (check === "STRICT_RELEASE_IDENTITY" && (
    evidence.release_identity_sha256 !== activation.release_identity_sha256
    || evidence.release_manifest_sha256 !== rollbackResult.predecessor.release_manifest_sha256
    || evidence.postdeploy_receipt_sha256 !== packageValue.sources.predecessor_postdeploy_receipt.sha256
  )) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
  if (check === "PROTECTED_RESOURCES" && (
    evidence.before_sha256 !== packageValue.protected_resources_sha256
    || evidence.after_sha256 !== packageValue.protected_resources_sha256
  )) reject("ROLLBACK_CONTROL_CHECK_EVIDENCE_BINDING_INVALID");
}

function adapterRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), ["completed_at", "evidence", "started_at"].sort())) reject(code);
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

function validateContainmentObservation(value, packageValue, previousResultSha256) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [
      "contained_at", "database", "last_committed_record_sha256", "protected_resources_sha256",
      "stopped_services",
    ].sort()) || !value.database || value.database.name !== "chenyida_erp"
    || !/^[1-9][0-9]{0,9}$/u.test(value.database.oid || "") || value.database.sealed !== true
    || value.last_committed_record_sha256 !== previousResultSha256
    || value.protected_resources_sha256 !== packageValue.protected_resources_sha256
    || !Array.isArray(value.stopped_services) || value.stopped_services.length !== 2
    || !same(value.stopped_services.map((item) => item.service).sort(), ["web", "worker"])
    || value.stopped_services.some((item) => !item || typeof item !== "object"
      || !same(Object.keys(item).sort(), ["container_id", "service"].sort())
      || !/^[0-9a-f]{64}$/u.test(item.container_id || ""))
    || nowIso(() => new Date(value.contained_at)) !== value.contained_at) {
    reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_INVALID");
  }
  return value;
}

async function containAndRecord(context, intent, packageValue, root, adapter, failureCode, options, previousResultSha256) {
  if (!adapter || typeof adapter.contain !== "function") reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED");
  const preparedAt = nowIso(options.clock);
  const intentBody = {
    schema_version: 1, contract: "chenyida-erp-uat-promotion-rollback-containment-intent/v1",
    status: "PREPARED", operation: context.operation, operation_id: context.operation_id,
    promotion_id: context.parameters.promotion_id, intent_sha256: options.expectedIntentSha256,
    execution_package_sha256: packageValue.package_sha256, failure_code: failureCode,
    last_committed_record_sha256: previousResultSha256, prepared_at: preparedAt,
  };
  const containmentIntent = Object.freeze({
    ...intentBody, containment_intent_sha256: clusterSha256(intentBody),
  });
  await immutableJson(
    path.join(root, `containment.intent.${containmentIntent.containment_intent_sha256}.json`),
    containmentIntent,
    (value) => { if (!same(value, containmentIntent)) reject("ROLLBACK_CONTROL_CONTAINMENT_INTENT_INVALID"); return value; },
    "ROLLBACK_CONTROL_CONTAINMENT_INTENT_INVALID",
  );
  let observed;
  try {
    observed = validateContainmentObservation(
      await adapter.contain({ context, intent, packageValue, containmentIntent }),
      packageValue, previousResultSha256,
    );
  } catch { reject("ROLLBACK_CONTROL_RUNTIME_CONTAINMENT_FAILED"); }
  const body = {
    schema_version: 1, contract: "chenyida-erp-uat-promotion-rollback-containment/v1",
    status: "CONTAINED_FOR_JOURNAL_QUARANTINE", operation: context.operation,
    operation_id: context.operation_id, promotion_id: context.parameters.promotion_id,
    intent_sha256: options.expectedIntentSha256,
    containment_intent_sha256: containmentIntent.containment_intent_sha256,
    execution_package_sha256: packageValue.package_sha256, failure_code: failureCode,
    database: observed.database, stopped_services: observed.stopped_services,
    protected_resources_sha256: observed.protected_resources_sha256,
    last_committed_record_sha256: observed.last_committed_record_sha256,
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
    const roles = postverify ? CHECK_SOURCE_ROLES[label] : STAGE_SOURCE_ROLES[label];
    await verifyPackageSources(packageValue, options.filesystemRoot, roles);
    const preparedAt = nowIso(options.clock);
    const common = {
      promotion_id: context.parameters.promotion_id,
      promotion_generation: context.parameters.promotion_generation,
      operation_id: context.operation_id,
      execution_authorization_sha256: context.original_authorization_sha256,
      rollback_plan_sha256: postverify ? rollbackResult.rollback_plan_sha256 : intent.rollback_plan_sha256,
      execution_package_sha256: packageValue.package_sha256,
      ordinal: index + 1,
      previous_result_sha256: previousResultSha256,
      input_sha256: clusterSha256({
        operation_id: context.operation_id, label, ordinal: index + 1,
        rollback_plan_sha256: postverify ? rollbackResult.rollback_plan_sha256 : intent.rollback_plan_sha256,
        execution_package_sha256: packageValue.package_sha256, previous_result_sha256: previousResultSha256,
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
      ? await adapter.verifyCheck({ context, intent, packageValue, rollbackResult, check: label, checkIntent: recordIntent })
      : await adapter.executeStage({ context, intent, packageValue, stage: label, stageIntent: recordIntent }),
    postverify ? "ROLLBACK_CONTROL_CHECK_ADAPTER_RESULT_INVALID" : "ROLLBACK_CONTROL_STAGE_ADAPTER_RESULT_INVALID");
    await verifyPackageSources(packageValue, options.filesystemRoot, roles);
    if (Date.parse(observed.started_at) < Date.parse(preparedAt)
      || Date.parse(observed.completed_at) > Date.parse(packageValue.execution_deadline)) {
      reject("ROLLBACK_CONTROL_RECORD_TIME_INVALID");
    }
    if (postverify) assertCheckEvidenceBindings(label, observed.evidence, rollbackResult, packageValue);
    else assertStageEvidenceBindings(label, observed.evidence, intent, packageValue);
    const resultCommon = {
      promotion_id: common.promotion_id,
      promotion_generation: common.promotion_generation,
      operation_id: common.operation_id,
      execution_authorization_sha256: common.execution_authorization_sha256,
      rollback_plan_sha256: common.rollback_plan_sha256,
      execution_package_sha256: common.execution_package_sha256,
      ordinal: common.ordinal,
      previous_result_sha256: common.previous_result_sha256,
    };
    const recordResult = postverify
      ? createUatPromotionRollbackCheckResult({
        ...resultCommon, check: label, check_intent_sha256: recordIntent.check_intent_sha256,
        evidence: observed.evidence, started_at: observed.started_at, completed_at: observed.completed_at,
      })
      : createUatPromotionRollbackStageResult({
        ...resultCommon, stage: label, stage_intent_sha256: recordIntent.stage_intent_sha256,
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
    return createUatPromotionRollbackResult({
      promotion_id: intent.promotion_id, promotion_generation: intent.promotion_generation,
      rollback_operation_id: intent.rollback_operation_id,
      execution_authorization_sha256: intent.execution_authorization_sha256,
      supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
      checkpoint_13_receipt_sha256: intent.checkpoint_13_receipt_sha256,
      rollback_intent_sha256: intent.rollback_intent_sha256, rollback_plan_sha256: intent.rollback_plan_sha256,
      execution_package_sha256: packageValue.package_sha256, source_set_sha256: packageValue.source_set_sha256,
      promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
      snapshot_readiness_sha256: intent.snapshot_readiness_sha256,
      snapshot_backup_id: intent.parameters.snapshot_backup_id,
      snapshot_restore_run_id: intent.parameters.snapshot_restore_run_id,
      snapshot_objects: intent.parameters.snapshot_objects, predecessor: intent.parameters.predecessor,
      database: intent.parameters.database,
      restored_database: {
        name: postgres.restored_database_name, system_identifier: postgres.system_identifier,
        oid: postgres.restored_database_oid, marker: intent.parameters.database.marker,
      },
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
    postverify_intent_sha256: intent.postverify_intent_sha256,
    postverify_plan_sha256: intent.postverify_plan_sha256, snapshot_objects: rollbackResult.snapshot_objects,
    predecessor: rollbackResult.predecessor, database: rollbackResult.database,
    restored_database: rollbackResult.restored_database, boundary: rollbackResult.boundary,
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
  await verifyPackageSources(packageValue, resolved.filesystemRoot, UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES);
  const adapter = options.adapter ?? productionAdapter(context, intent);
  if (phase === "preflight") return preflightUatPromotionRollbackControl(context, options);
  const root = await executionRoot(context, options.expectedIntentSha256, resolved.filesystemRoot, phase === "recover");
  let existing;
  try { existing = await completion(context, intent, resolved.filesystemRoot, root); }
  catch (cause) {
    if (phase !== "recover") throw cause;
    existing = Object.freeze({ partial: true });
  }
  if (phase === "recover") {
    if (existing && !existing.partial && resolved.recoveryDecision !== "QUARANTINE") {
      return Object.freeze({
        result: context.operation === "ROLLBACK_POSTVERIFY"
          ? "ROLLBACK_POSTVERIFY_ALREADY_COMPLETED" : "ROLLBACK_EXECUTION_ALREADY_COMPLETED",
        promotion_id: context.parameters.promotion_id, result_sha256: existing.result.result_sha256,
      });
    }
    const containment = await containAndRecord(
      context, intent, packageValue, root, adapter,
      resolved.recoveryDecision === "QUARANTINE" && existing && !existing.partial
        ? "ROLLBACK_JOURNAL_REQUIRES_RUNTIME_QUARANTINE"
        : existing === null ? "ROLLBACK_CONTROL_RESULT_ABSENT"
          : "ROLLBACK_CONTROL_RESULT_UNTRUSTED_OR_PARTIAL",
      { ...options, ...resolved },
      await lastCommittedRecord(root, context.operation === "ROLLBACK_POSTVERIFY"),
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
  let lastCommitted = ZERO_SHA256;
  try {
    const execution = await executeRecords(
      context, intent, packageValue, rollbackResult, root, adapter,
      { ...options, ...resolved, onCommit: (value) => { lastCommitted = value; } },
    );
    lastCommitted = execution.previousResultSha256;
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
    await containAndRecord(
      context, intent, packageValue, root, adapter,
      cause?.code || "ROLLBACK_CONTROL_RUNTIME_ADAPTER_FAILED",
      { ...options, ...resolved }, lastCommitted,
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
