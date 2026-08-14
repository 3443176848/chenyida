import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { loadReleaseManifest } from "./release-manifest-contract.mjs";
import {
  appendRuntimePrivilegeOperatorJournalState,
  appendRuntimePrivilegeOperatorRecoveryAuthorization,
  archiveCommittedRuntimePrivilegeOperatorJournal,
  loadRuntimePrivilegeOperatorJournal,
  persistRuntimePrivilegeOperatorCredentialProof,
  persistRuntimePrivilegeOperatorPostcommitCapture,
  prepareRuntimePrivilegeOperatorJournal,
  quarantineRuntimePrivilegeOperatorJournal,
  runtimePrivilegeOperatorJournalEvidence,
  runtimePrivilegeOperatorRecoveryAuthorizations,
  runtimePrivilegeOperatorJournalSnapshot,
} from "./postgresql-runtime-privilege-journal.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES,
  RUNTIME_PRIVILEGE_OPERATOR_POLICY_PATH,
  assertRuntimePrivilegeOperatorCredentialsUnchanged,
  buildRuntimePrivilegeOperatorTransactionInput,
  createInitialRuntimePrivilegeOperatorState,
  createRuntimePrivilegeOperatorIntent,
  createRuntimePrivilegeOperatorReceipt,
  decideRuntimePrivilegeOperatorRecovery,
  disposeRuntimePrivilegeOperatorCredentials,
  loadRuntimePrivilegeOperatorSources,
  readRuntimePrivilegeOperatorCredentials,
  verifyRuntimePrivilegeOperatorPolicySources,
  withRuntimePrivilegeOperatorPassword,
} from "./postgresql-runtime-privilege-operator.mjs";
import {
  createControlledRuntimePrivilegeBootstrapPlan,
  createRuntimePrivilegeReconciliationPlan,
  validateRuntimePrivilegeState,
  validateRuntimePrivilegeStructuralReport,
} from "./postgresql-runtime-privilege-reconciler.mjs";

export const RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-control-context/v2";
export const RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PROOF_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-credential-proof/v1";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,29}$/;
const OID = /^[1-9][0-9]{0,9}$/;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_DATABASE_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_INSPECT_OUTPUT_BYTES = 16 * 1024;
const WRONG_PASSWORD = Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ascii");
const CONTROL_SHELL = "set -eu\n: \"${POSTGRES_USER:?}\" \"${POSTGRES_DB:?}\"\nexec psql --no-psqlrc --quiet --username=\"$POSTGRES_USER\" --dbname=\"$POSTGRES_DB\" \"$@\"\n";
const PASSWORD_PROBE_SHELL = "set -eu\nrole=$1\ndatabase=$2\nexec env PGCONNECT_TIMEOUT=5 psql --no-psqlrc --quiet --no-align --tuples-only --password --host=127.0.0.1 --port=5432 --username=\"$role\" --dbname=\"$database\" --command=\"SELECT (session_user=current_user)::text||'|'||(current_database()='$database')::text||'|'||(SELECT (rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)::text FROM pg_catalog.pg_roles WHERE rolname=current_user)\"\n";

export class RuntimePrivilegeOperatorRunnerError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegeOperatorRunnerError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegeOperatorRunnerError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
  return value;
}

function bounded(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value) || value !== value.normalize("NFC") || value.includes("\u0000")) reject(code);
  return value;
}

function absolute(value, code) {
  if (typeof value !== "string" || value.length < 2 || value.length > 4096 || !path.isAbsolute(value) || path.normalize(value) !== value) reject(code);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isoNow(clock) {
  const value = clock().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) reject("RUNTIME_PRIVILEGE_OPERATOR_CLOCK_INVALID");
  return value;
}

export function validateRuntimePrivilegeOperatorControlContext(value, policy) {
  exactKeys(value, [
    "schema_version", "contract", "evidence_scope", "operation_id", "operation", "deployment_class", "deployment_id",
    "execution_mode", "execution_authorization_id", "execution_authorization_sha256", "expected_intent_sha256",
    "state_root", "runtime_secret_root", "backup_credential_root", "backup_capture_service_file", "backup_capture_service",
    "credential_generation_id", "backup_root", "release_manifest", "release_manifest_sha256", "runtime_guard_mode", "postgres_container_name",
    "postgres_container_id", "expected_database", "expected_database_oid", "expected_system_identifier", "expected_database_marker",
    "supervisor_bundle_sha256", "authorization_sha256", "runtime_configuration_sha256", "runtime_probe_binding_sha256",
  ], "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  if (value.schema_version !== 2 || value.contract !== RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_CONTRACT
    || !["ACTUAL_CONTROLLED", "SYNTHETIC_TEST_ONLY"].includes(value.evidence_scope)
    || !["BOOTSTRAP", "RECONCILE"].includes(value.operation)
    || !["ORIGINAL", "RECOVERY"].includes(value.execution_mode)) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.operation_id, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.execution_authorization_id, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.deployment_id, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.credential_generation_id, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.backup_capture_service, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.postgres_container_name, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.postgres_container_id, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.expected_database_oid, OID, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  bounded(value.expected_system_identifier, SYSTEM_IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  for (const field of ["supervisor_bundle_sha256", "authorization_sha256", "execution_authorization_sha256", "release_manifest_sha256", "runtime_configuration_sha256", "runtime_probe_binding_sha256"]) {
    bounded(value[field], SHA256, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  }
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_id !== value.operation_id || value.execution_authorization_sha256 !== value.authorization_sha256
      || value.expected_intent_sha256 !== null) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  } else {
    bounded(value.expected_intent_sha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
    if (value.execution_authorization_id === value.operation_id || value.execution_authorization_sha256 === value.authorization_sha256) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
    }
  }
  for (const field of ["state_root", "runtime_secret_root", "backup_credential_root", "backup_capture_service_file", "backup_root", "release_manifest"]) {
    absolute(value[field], "RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  }
  const expectedGuardMode = value.operation === "BOOTSTRAP"
    ? "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND"
    : "POST_DEPLOY_CURRENT_RUNTIME_STRICT";
  if (path.dirname(value.backup_capture_service_file) !== value.backup_credential_root
    || path.basename(value.backup_capture_service_file) === policy.roots.backup_credential_root_marker
    || value.runtime_guard_mode !== expectedGuardMode || value.expected_database !== policy.target.database
    || value.expected_database_marker !== `chenyida-erp-deployment/v2:${value.deployment_class}:${value.deployment_id}`) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  }
  if (value.evidence_scope === "ACTUAL_CONTROLLED") {
    if (!['UAT', 'PRODUCTION'].includes(value.deployment_class) || value.state_root !== policy.roots.state_root
      || value.runtime_secret_root !== policy.roots.runtime_secret_root || value.backup_root !== policy.roots.backup_root
      || process.getuid?.() !== 0) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  } else if (value.deployment_class !== "TEST") reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  return value;
}

async function loadOperatorPolicy(siteRoot) {
  let value;
  try { value = parseStrictJson(await readFile(path.join(siteRoot, RUNTIME_PRIVILEGE_OPERATOR_POLICY_PATH), "utf8"), 2 * 1024 * 1024); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_FILE_INVALID"); }
  try { return await verifyRuntimePrivilegeOperatorPolicySources(value, { siteRoot }); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_FILE_INVALID"); }
}

async function assertReleaseManifestBinding(context) {
  if (context.evidence_scope !== "ACTUAL_CONTROLLED") return true;
  let manifest;
  try {
    manifest = await loadReleaseManifest({
      file: context.release_manifest,
      expectedSha256: context.release_manifest_sha256,
      requireEligible: context.execution_mode === "ORIGINAL",
      trusted: true,
    });
  } catch {
    reject("RUNTIME_PRIVILEGE_OPERATOR_RELEASE_MANIFEST_INVALID");
  }
  if (manifest.promotion_status !== "ELIGIBLE" || manifest.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== context.deployment_class) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_RELEASE_MANIFEST_INVALID");
  }
  return true;
}

function credentialOptions(context) {
  return {
    runtimeSecretRoot: context.runtime_secret_root,
    backupCredentialRoot: context.backup_credential_root,
    backupCaptureServiceFile: context.backup_capture_service_file,
    backupCaptureService: context.backup_capture_service,
    expectedDatabase: context.expected_database,
    credentialGenerationId: context.credential_generation_id,
    evidenceScope: context.evidence_scope,
  };
}

function expectedTarget(context) {
  return Object.freeze({
    database_oid: context.expected_database_oid,
    system_identifier_sha256: sha256(Buffer.from(context.expected_system_identifier, "utf8")),
    marker_sha256: sha256(Buffer.from(context.expected_database_marker, "utf8")),
  });
}

function validateContainerEvidence(value, context, policy) {
  exactKeys(value, ["container_id", "container_name", "image_id", "image_reference"], "RUNTIME_PRIVILEGE_OPERATOR_CONTAINER_INVALID");
  if (value.container_id !== context.postgres_container_id || value.container_name !== context.postgres_container_name
    || value.image_reference !== policy.execution.postgres_image || !/^sha256:[0-9a-f]{64}$/.test(value.image_id)) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTAINER_INVALID");
  return value;
}

function validateBackupEvidence(value) {
  validateBackupInspection(value);
  if (value.fence_absent !== true) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_INTERLOCK_INVALID");
  return value;
}

function validateBackupInspection(value) {
  exactKeys(value, ["identity_sha256", "fence_absent"], "RUNTIME_PRIVILEGE_OPERATOR_BACKUP_INTERLOCK_INVALID");
  if (!SHA256.test(value.identity_sha256) || typeof value.fence_absent !== "boolean") reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_INTERLOCK_INVALID");
  return value;
}

function validateCredentialProof(value, intent, verifiedAt) {
  exactKeys(value, [
    "schema_version", "contract", "operation_id", "intent_sha256", "postgres_container_id", "credential_generation_id",
    "credential_role_set_sha256", "credential_source_identity_sha256", "credential_role_count", "scram_hash_count", "wrong_password_rejected_count",
    "correct_password_accepted_count", "verified_at", "proof_sha256",
  ], "RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PROOF_INVALID");
  const { proof_sha256: ignored, ...body } = value;
  void ignored;
  if (value.schema_version !== 1 || value.contract !== RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PROOF_CONTRACT
    || value.operation_id !== intent.operation_id || value.intent_sha256 !== intent.intent_sha256
    || value.postgres_container_id !== intent.postgres_container_id || value.credential_generation_id !== intent.credential_generation_id
    || value.credential_role_set_sha256 !== intent.credential_role_set_sha256
    || value.credential_source_identity_sha256 !== intent.credential_source_identity_sha256
    || value.credential_role_count !== RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length
    || value.scram_hash_count !== RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length
    || value.wrong_password_rejected_count !== RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length
    || value.correct_password_accepted_count !== RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length
    || value.verified_at !== verifiedAt || value.proof_sha256 !== clusterSha256(body)) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PROOF_INVALID");
  return value;
}

export function createRuntimePrivilegeOperatorCredentialProof({ intent, verifiedAt }) {
  const body = {
    schema_version: 1,
    contract: RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PROOF_CONTRACT,
    operation_id: intent.operation_id,
    intent_sha256: intent.intent_sha256,
    postgres_container_id: intent.postgres_container_id,
    credential_generation_id: intent.credential_generation_id,
    credential_role_set_sha256: intent.credential_role_set_sha256,
    credential_source_identity_sha256: intent.credential_source_identity_sha256,
    credential_role_count: RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length,
    scram_hash_count: RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length,
    wrong_password_rejected_count: RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length,
    correct_password_accepted_count: RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length,
    verified_at: verifiedAt,
  };
  return Object.freeze({ ...body, proof_sha256: clusterSha256(body) });
}

function assertContextMatchesIntent(context, intent) {
  if (context.operation_id !== intent.operation_id || context.operation !== intent.operation
    || context.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256 || context.authorization_sha256 !== intent.authorization_sha256
    || context.release_manifest_sha256 !== intent.release_manifest_sha256
    || context.runtime_configuration_sha256 !== intent.runtime_configuration_sha256 || context.runtime_guard_mode !== intent.runtime_guard_mode
    || context.postgres_container_id !== intent.postgres_container_id || context.postgres_container_name !== intent.postgres_container_name
    || context.credential_generation_id !== intent.credential_generation_id
    || canonicalClusterJson(expectedTarget(context)) !== canonicalClusterJson(intent.target)) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_MISMATCH");
  if (context.execution_mode === "ORIGINAL" && context.runtime_probe_binding_sha256 !== intent.runtime_probe_binding_sha256) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_MISMATCH");
  }
  if (context.execution_mode === "RECOVERY" && context.expected_intent_sha256 !== intent.intent_sha256) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_MISMATCH");
  }
}

export async function prepareControlledRuntimePrivilegeOperation(contextInput, adapter, {
  siteRoot = SITE_ROOT,
  structureValidator = validateRuntimePrivilegeStructuralReport,
} = {}) {
  const policy = await loadOperatorPolicy(siteRoot);
  const context = validateRuntimePrivilegeOperatorControlContext(contextInput, policy);
  if (context.execution_mode !== "ORIGINAL") reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  const loaded = await loadRuntimePrivilegeOperatorSources(siteRoot);
  const sources = { policy: loaded.runtimePolicy, access: loaded.access, catalog: loaded.catalog };
  await assertReleaseManifestBinding(context);
  await adapter.assertControl(context, policy);
  const backup = validateBackupEvidence(await adapter.inspectBackupRoot(context, policy));
  validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy);
  let credentials;
  try {
    credentials = await readRuntimePrivilegeOperatorCredentials(credentialOptions(context));
    if (credentials.credentialGenerationId !== context.credential_generation_id) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_GENERATION_MISMATCH");
    let existing = null;
    try {
      existing = await loadRuntimePrivilegeOperatorJournal({
        stateRoot: context.state_root,
        evidenceScope: context.evidence_scope,
        operationId: context.operation_id,
        sources,
        location: "active",
      });
    } catch (error) {
      if (error?.code !== "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_LOOKUP_INVALID") throw error;
    }
    if (existing !== null) {
      const snapshot = runtimePrivilegeOperatorJournalSnapshot(existing);
      assertContextMatchesIntent(context, snapshot.intent);
      if (snapshot.state.phase !== "PREPARED" || snapshot.intent.backup_root_identity_sha256 !== backup.identity_sha256
        || credentials.credentialGenerationId !== snapshot.intent.credential_generation_id
        || credentials.roleSetSha256 !== snapshot.intent.credential_role_set_sha256
        || credentials.sourceIdentitySha256 !== snapshot.intent.credential_source_identity_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_PREPARED_INTENT_MISMATCH");
      const current = validateRuntimePrivilegeState(await adapter.captureState(context, policy), { ...sources, mode: "controlled", expectedTarget: snapshot.intent.target });
      if (clusterSha256(current) !== snapshot.intent.baseline_state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_PREPARED_INTENT_MISMATCH");
      await assertRuntimePrivilegeOperatorCredentialsUnchanged(credentials);
      return Object.freeze({ result: "ALREADY_PREPARED", operation_id: snapshot.intent.operation_id, intent_sha256: snapshot.intent.intent_sha256, plan_sha256: snapshot.intent.plan_sha256 });
    }
    const baseline = validateRuntimePrivilegeState(await adapter.captureState(context, policy), {
      ...sources,
      mode: "controlled",
      expectedTarget: expectedTarget(context),
    });
    const baselineStructure = await adapter.captureStructure(context, policy);
    if (!Buffer.isBuffer(baselineStructure)) reject("RUNTIME_PRIVILEGE_OPERATOR_STRUCTURE_CAPTURE_INVALID");
    structureValidator(baselineStructure.toString("utf8"), {
      ...sources,
      expectedDefaultPrivilegeCount: baseline.default_privilege_row_count,
      allowPlatformOwnership: true,
    });
    const plan = context.operation === "BOOTSTRAP"
      ? createControlledRuntimePrivilegeBootstrapPlan(baseline, sources)
      : createRuntimePrivilegeReconciliationPlan(baseline, sources);
    if (plan.no_op && context.operation !== "RECONCILE") reject("RUNTIME_PRIVILEGE_OPERATOR_NOOP_NOT_AUTHORIZABLE");
    const intent = createRuntimePrivilegeOperatorIntent({
      operation_id: context.operation_id,
      operation: context.operation,
      created_at: isoNow(adapter.clock),
      supervisor_bundle_sha256: context.supervisor_bundle_sha256,
      authorization_sha256: context.authorization_sha256,
      release_manifest_sha256: context.release_manifest_sha256,
      runtime_configuration_sha256: context.runtime_configuration_sha256,
      runtime_guard_mode: context.runtime_guard_mode,
      runtime_probe_binding_sha256: context.runtime_probe_binding_sha256,
      operator_policy_sha256: policy.policy_sha256,
      runtime_privilege_policy_sha256: sources.policy.policy_sha256,
      target: baseline.target,
      postgres_container_id: context.postgres_container_id,
      postgres_container_name: context.postgres_container_name,
      backup_root_identity_sha256: backup.identity_sha256,
      baseline_state_sha256: plan.baseline_state_sha256,
      baseline_structure_sha256: sha256(baselineStructure),
      desired_state_sha256: plan.desired_state_sha256,
      plan_sha256: plan.plan_sha256,
      credential_generation_id: credentials.credentialGenerationId,
      credential_role_set_sha256: credentials.roleSetSha256,
      credential_source_identity_sha256: credentials.sourceIdentitySha256,
    });
    const initialState = createInitialRuntimePrivilegeOperatorState(intent, isoNow(adapter.clock));
    await prepareRuntimePrivilegeOperatorJournal({
      stateRoot: context.state_root,
      evidenceScope: context.evidence_scope,
      intent,
      initialState,
      baseline,
      baselineStructure,
      plan,
      sources,
      operation: context.operation,
    });
    await assertRuntimePrivilegeOperatorCredentialsUnchanged(credentials);
    validateBackupEvidence(await adapter.inspectBackupRoot(context, policy));
    validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy);
    return Object.freeze({ result: "PREPARED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, plan_sha256: intent.plan_sha256 });
  } finally {
    if (credentials) disposeRuntimePrivilegeOperatorCredentials(credentials);
  }
}

export async function executePreparedRuntimePrivilegeOperation(contextInput, adapter, {
  siteRoot = SITE_ROOT,
  structureValidator = validateRuntimePrivilegeStructuralReport,
} = {}) {
  const policy = await loadOperatorPolicy(siteRoot);
  const context = validateRuntimePrivilegeOperatorControlContext(contextInput, policy);
  if (context.execution_mode !== "ORIGINAL") reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  const loaded = await loadRuntimePrivilegeOperatorSources(siteRoot);
  const sources = { policy: loaded.runtimePolicy, access: loaded.access, catalog: loaded.catalog };
  await assertReleaseManifestBinding(context);
  await adapter.assertControl(context, policy);
  const journal = await loadRuntimePrivilegeOperatorJournal({
    stateRoot: context.state_root,
    evidenceScope: context.evidence_scope,
    operationId: context.operation_id,
    sources,
    location: "active",
  });
  const snapshot = runtimePrivilegeOperatorJournalSnapshot(journal);
  assertContextMatchesIntent(context, snapshot.intent);
  const backup = validateBackupEvidence(await adapter.inspectBackupRoot(context, policy));
  if (backup.identity_sha256 !== snapshot.intent.backup_root_identity_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_CHANGED");
  validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy);
  let credentials;
  let transaction;
  try {
    credentials = await readRuntimePrivilegeOperatorCredentials(credentialOptions(context));
    if (credentials.credentialGenerationId !== snapshot.intent.credential_generation_id
      || credentials.roleSetSha256 !== snapshot.intent.credential_role_set_sha256
      || credentials.sourceIdentitySha256 !== snapshot.intent.credential_source_identity_sha256) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_GENERATION_MISMATCH");
    }
    const current = validateRuntimePrivilegeState(await adapter.captureState(context, policy), { ...sources, mode: "controlled", expectedTarget: snapshot.intent.target });
    if (clusterSha256(current) !== snapshot.intent.baseline_state_sha256 || snapshot.state.phase !== "PREPARED") {
      reject("RUNTIME_PRIVILEGE_OPERATOR_EXECUTION_BASELINE_MISMATCH");
    }
    await appendRuntimePrivilegeOperatorJournalState(journal, "AUTHORIZATION_CONSUMED", isoNow(adapter.clock));
    await assertRuntimePrivilegeOperatorCredentialsUnchanged(credentials);
    validateBackupEvidence(await adapter.inspectBackupRoot(context, policy));
    validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy);
    await appendRuntimePrivilegeOperatorJournalState(journal, "TRANSACTION_DISPATCHED", isoNow(adapter.clock));
    transaction = buildRuntimePrivilegeOperatorTransactionInput(snapshot.plan, credentials, { baseline: snapshot.baseline, sources, operation: snapshot.intent.operation });
    await adapter.applyTransaction(context, policy, transaction);
    transaction.fill(0);
    transaction = null;
    const finalState = validateRuntimePrivilegeState(await adapter.captureState(context, policy), {
      ...sources,
      mode: "final",
      expectedTarget: snapshot.intent.target,
      expectedFinal: snapshot.plan.desired,
    });
    if (clusterSha256(finalState) !== snapshot.intent.desired_state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_FINAL_STATE_MISMATCH");
    const finalStructure = await adapter.captureStructure(context, policy);
    if (!Buffer.isBuffer(finalStructure)) reject("RUNTIME_PRIVILEGE_OPERATOR_STRUCTURE_CAPTURE_INVALID");
    structureValidator(finalStructure.toString("utf8"), { ...sources, expectedDefaultPrivilegeCount: 2, allowPlatformOwnership: false });
    await persistRuntimePrivilegeOperatorPostcommitCapture(journal, finalState, finalStructure);
    await appendRuntimePrivilegeOperatorJournalState(journal, "POSTCOMMIT_CAPTURED", isoNow(adapter.clock), snapshot.intent.desired_state_sha256);
    await assertRuntimePrivilegeOperatorCredentialsUnchanged(credentials);
    await adapter.verifyCredentials(context, policy, credentials);
    const verifiedAt = isoNow(adapter.clock);
    const proof = validateCredentialProof(createRuntimePrivilegeOperatorCredentialProof({ intent: snapshot.intent, verifiedAt }), snapshot.intent, verifiedAt);
    await persistRuntimePrivilegeOperatorCredentialProof(journal, proof);
    validateBackupEvidence(await adapter.inspectBackupRoot(context, policy));
    validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy);
    await appendRuntimePrivilegeOperatorJournalState(journal, "VERIFIED", isoNow(adapter.clock), snapshot.intent.desired_state_sha256);
    const committed = await appendRuntimePrivilegeOperatorJournalState(journal, "COMMITTED", isoNow(adapter.clock), snapshot.intent.desired_state_sha256);
    const receipt = createRuntimePrivilegeOperatorReceipt({
      intent: snapshot.intent,
      state: committed,
      completedAt: isoNow(adapter.clock),
      finalStructureSha256: sha256(finalStructure),
      credentialVerificationSha256: proof.proof_sha256,
    });
    await archiveCommittedRuntimePrivilegeOperatorJournal(journal, receipt);
    return Object.freeze({ result: "VERIFIED", operation_id: snapshot.intent.operation_id, intent_sha256: snapshot.intent.intent_sha256, receipt_sha256: receipt.receipt_sha256 });
  } finally {
    transaction?.fill(0);
    if (credentials) disposeRuntimePrivilegeOperatorCredentials(credentials);
  }
}

async function observeRuntimePrivilegeRecovery(context, adapter, policy, sources) {
  const journal = await loadRuntimePrivilegeOperatorJournal({
    stateRoot: context.state_root,
    evidenceScope: context.evidence_scope,
    operationId: context.operation_id,
    sources,
    location: "active",
  });
  const snapshot = runtimePrivilegeOperatorJournalSnapshot(journal);
  assertContextMatchesIntent(context, snapshot.intent);
  let currentInput;
  try { currentInput = await adapter.captureState(context, policy); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_STATE_CAPTURE_FAILED"); }
  let current = null;
  let observedStateSha256;
  let decision = "QUARANTINE";
  try {
    current = validateRuntimePrivilegeState(currentInput, { ...sources, mode: "controlled", expectedTarget: snapshot.intent.target });
    observedStateSha256 = clusterSha256(current);
    decision = decideRuntimePrivilegeOperatorRecovery(snapshot.intent, snapshot.state, current);
  } catch {
    try { observedStateSha256 = clusterSha256(currentInput); }
    catch { reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_STATE_CAPTURE_FAILED"); }
  }
  let unsafe = false;
  let backup;
  try { backup = validateBackupInspection(await adapter.inspectBackupRoot(context, policy)); }
  catch { unsafe = true; }
  if (!backup || backup.identity_sha256 !== snapshot.intent.backup_root_identity_sha256 || backup.fence_absent !== true) unsafe = true;
  try { validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy); }
  catch { unsafe = true; }
  let credentials = null;
  try {
    credentials = await readRuntimePrivilegeOperatorCredentials(credentialOptions(context));
    if (credentials.credentialGenerationId !== snapshot.intent.credential_generation_id
      || credentials.roleSetSha256 !== snapshot.intent.credential_role_set_sha256
      || credentials.sourceIdentitySha256 !== snapshot.intent.credential_source_identity_sha256) unsafe = true;
    await assertRuntimePrivilegeOperatorCredentialsUnchanged(credentials);
  } catch {
    if (credentials) disposeRuntimePrivilegeOperatorCredentials(credentials);
    credentials = null;
    unsafe = true;
  }
  const authorizations = runtimePrivilegeOperatorRecoveryAuthorizations(journal);
  const previous = authorizations.find((record) => record.authorization_id === context.execution_authorization_id
    || record.authorization_sha256 === context.execution_authorization_sha256);
  const priorAttempts = authorizations.filter((record) => record !== previous).length;
  if (decision === "RETRY_TRANSACTION" && priorAttempts >= 2) unsafe = true;
  if (unsafe) decision = "QUARANTINE";
  return { journal, snapshot, current, observedStateSha256, decision, credentials, authorizations, previous };
}

function recoveryResult(result, snapshot, record, extra = {}) {
  return Object.freeze({
    result,
    operation_id: snapshot.intent.operation_id,
    intent_sha256: snapshot.intent.intent_sha256,
    recovery_record_sha256: record.record_sha256,
    ...extra,
  });
}

export async function prepareRuntimePrivilegeOperationRecovery(contextInput, adapter, { siteRoot = SITE_ROOT } = {}) {
  const policy = await loadOperatorPolicy(siteRoot);
  const context = validateRuntimePrivilegeOperatorControlContext(contextInput, policy);
  if (context.execution_mode !== "RECOVERY") reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  const loaded = await loadRuntimePrivilegeOperatorSources(siteRoot);
  const sources = { policy: loaded.runtimePolicy, access: loaded.access, catalog: loaded.catalog };
  await assertReleaseManifestBinding(context);
  await adapter.assertControl(context, policy);
  const observed = await observeRuntimePrivilegeRecovery(context, adapter, policy, sources);
  try {
    const record = await appendRuntimePrivilegeOperatorRecoveryAuthorization(observed.journal, {
      authorization_id: context.execution_authorization_id,
      authorization_sha256: context.execution_authorization_sha256,
      runtime_probe_binding_sha256: context.runtime_probe_binding_sha256,
      observed_state_sha256: observed.observedStateSha256,
      decision: observed.decision,
      recorded_at: isoNow(adapter.clock),
    });
    return recoveryResult("RECOVERY_PREPARED", observed.snapshot, record, { decision: record.decision });
  } finally {
    if (observed.credentials) disposeRuntimePrivilegeOperatorCredentials(observed.credentials);
  }
}

async function quarantineRecoveredOperation(observed, record, adapter) {
  const state = await quarantineRuntimePrivilegeOperatorJournal(observed.journal, isoNow(adapter.clock), observed.observedStateSha256);
  return recoveryResult("QUARANTINED", observed.snapshot, record, { quarantine_state_sha256: state.state_sha256 });
}

async function verifyRecoveryPublicationSafety(context, adapter, policy, snapshot) {
  try {
    const backup = validateBackupInspection(await adapter.inspectBackupRoot(context, policy));
    if (backup.identity_sha256 !== snapshot.intent.backup_root_identity_sha256 || backup.fence_absent !== true) return false;
    validateContainerEvidence(await adapter.inspectContainer(context, policy), context, policy);
    return true;
  } catch { return false; }
}

async function finalizeRecoveredRuntimePrivilegeOperation(context, adapter, policy, sources, observed, record, structureValidator) {
  const finalState = validateRuntimePrivilegeState(await adapter.captureState(context, policy), {
    ...sources,
    mode: "final",
    expectedTarget: observed.snapshot.intent.target,
    expectedFinal: observed.snapshot.plan.desired,
  });
  if (clusterSha256(finalState) !== observed.snapshot.intent.desired_state_sha256) {
    observed.observedStateSha256 = clusterSha256(finalState);
    return quarantineRecoveredOperation(observed, record, adapter);
  }
  const finalStructure = await adapter.captureStructure(context, policy);
  if (!Buffer.isBuffer(finalStructure)) reject("RUNTIME_PRIVILEGE_OPERATOR_STRUCTURE_CAPTURE_INVALID");
  structureValidator(finalStructure.toString("utf8"), { ...sources, expectedDefaultPrivilegeCount: 2, allowPlatformOwnership: false });
  let snapshot = runtimePrivilegeOperatorJournalSnapshot(observed.journal);
  if (snapshot.state.phase === "TRANSACTION_DISPATCHED") {
    await persistRuntimePrivilegeOperatorPostcommitCapture(observed.journal, finalState, finalStructure);
    await appendRuntimePrivilegeOperatorJournalState(observed.journal, "POSTCOMMIT_CAPTURED", isoNow(adapter.clock), snapshot.intent.desired_state_sha256);
    snapshot = runtimePrivilegeOperatorJournalSnapshot(observed.journal);
  } else {
    const evidence = runtimePrivilegeOperatorJournalEvidence(observed.journal);
    if (evidence.finalState === null || evidence.finalStructure === null
      || clusterSha256(evidence.finalState) !== snapshot.intent.desired_state_sha256
      || !evidence.finalStructure.equals(finalStructure)) reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_EVIDENCE_MISMATCH");
  }
  if (!["POSTCOMMIT_CAPTURED", "VERIFIED", "COMMITTED"].includes(snapshot.state.phase)) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_PHASE_INVALID");
  }
  if (!observed.credentials) return quarantineRecoveredOperation(observed, record, adapter);
  await assertRuntimePrivilegeOperatorCredentialsUnchanged(observed.credentials);
  await adapter.verifyCredentials(context, policy, observed.credentials);
  if (!(await verifyRecoveryPublicationSafety(context, adapter, policy, snapshot))) {
    observed.observedStateSha256 = snapshot.intent.desired_state_sha256;
    return quarantineRecoveredOperation(observed, record, adapter);
  }
  if (snapshot.state.phase === "POSTCOMMIT_CAPTURED") {
    const existing = runtimePrivilegeOperatorJournalEvidence(observed.journal).proof;
    if (existing === null) {
      const verifiedAt = isoNow(adapter.clock);
      const proof = validateCredentialProof(createRuntimePrivilegeOperatorCredentialProof({ intent: snapshot.intent, verifiedAt }), snapshot.intent, verifiedAt);
      await persistRuntimePrivilegeOperatorCredentialProof(observed.journal, proof);
    } else {
      validateCredentialProof(existing, snapshot.intent, existing.verified_at);
    }
    await appendRuntimePrivilegeOperatorJournalState(observed.journal, "VERIFIED", isoNow(adapter.clock), snapshot.intent.desired_state_sha256);
    snapshot = runtimePrivilegeOperatorJournalSnapshot(observed.journal);
  } else {
    const evidence = runtimePrivilegeOperatorJournalEvidence(observed.journal);
    if (evidence.proof === null) reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_EVIDENCE_MISMATCH");
    validateCredentialProof(evidence.proof, snapshot.intent, evidence.proof.verified_at);
  }
  if (snapshot.state.phase === "VERIFIED") {
    await appendRuntimePrivilegeOperatorJournalState(observed.journal, "COMMITTED", isoNow(adapter.clock), snapshot.intent.desired_state_sha256);
    snapshot = runtimePrivilegeOperatorJournalSnapshot(observed.journal);
  }
  if (snapshot.state.phase !== "COMMITTED") reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_PHASE_INVALID");
  const evidence = runtimePrivilegeOperatorJournalEvidence(observed.journal);
  if (evidence.finalStructure === null || evidence.proof === null) reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_EVIDENCE_MISMATCH");
  const receipt = evidence.receipt || createRuntimePrivilegeOperatorReceipt({
    intent: snapshot.intent,
    state: snapshot.state,
    completedAt: isoNow(adapter.clock),
    finalStructureSha256: sha256(evidence.finalStructure),
    credentialVerificationSha256: evidence.proof.proof_sha256,
  });
  await archiveCommittedRuntimePrivilegeOperatorJournal(observed.journal, receipt);
  return recoveryResult("VERIFIED", snapshot, record, { receipt_sha256: receipt.receipt_sha256 });
}

export async function executeRuntimePrivilegeOperationRecovery(contextInput, adapter, {
  siteRoot = SITE_ROOT,
  structureValidator = validateRuntimePrivilegeStructuralReport,
} = {}) {
  const policy = await loadOperatorPolicy(siteRoot);
  const context = validateRuntimePrivilegeOperatorControlContext(contextInput, policy);
  if (context.execution_mode !== "RECOVERY") reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  const loaded = await loadRuntimePrivilegeOperatorSources(siteRoot);
  const sources = { policy: loaded.runtimePolicy, access: loaded.access, catalog: loaded.catalog };
  await assertReleaseManifestBinding(context);
  await adapter.assertControl(context, policy);
  const observed = await observeRuntimePrivilegeRecovery(context, adapter, policy, sources);
  const record = observed.authorizations.find((item) => item.authorization_id === context.execution_authorization_id
    && item.authorization_sha256 === context.execution_authorization_sha256);
  if (!record) reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_MISSING");
  const preparedDecision = observed.previous?.decision;
  if (record.observed_state_sha256 !== observed.observedStateSha256 || record.runtime_probe_binding_sha256 !== context.runtime_probe_binding_sha256
    || preparedDecision !== record.decision || observed.decision !== record.decision) observed.decision = "QUARANTINE";
  let transaction = null;
  try {
    if (observed.decision === "QUARANTINE") return await quarantineRecoveredOperation(observed, record, adapter);
    let action = observed.decision;
    if (action === "RESUME_AUTHORIZATION") {
      await appendRuntimePrivilegeOperatorJournalState(observed.journal, "AUTHORIZATION_CONSUMED", isoNow(adapter.clock));
      action = "DISPATCH_TRANSACTION";
    }
    if (action === "DISPATCH_TRANSACTION") {
      await appendRuntimePrivilegeOperatorJournalState(observed.journal, "TRANSACTION_DISPATCHED", isoNow(adapter.clock));
    }
    if (["DISPATCH_TRANSACTION", "RETRY_TRANSACTION"].includes(action)) {
      if (!observed.credentials) return await quarantineRecoveredOperation(observed, record, adapter);
      transaction = buildRuntimePrivilegeOperatorTransactionInput(observed.snapshot.plan, observed.credentials, {
        baseline: observed.snapshot.baseline,
        sources,
        operation: observed.snapshot.intent.operation,
      });
      await adapter.applyTransaction(context, policy, transaction);
      transaction.fill(0);
      transaction = null;
    } else if (!["CAPTURE_AND_VERIFY", "FINISH_PUBLICATION", "ARCHIVE_COMMITTED"].includes(action)) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_PHASE_INVALID");
    }
    return await finalizeRecoveredRuntimePrivilegeOperation(context, adapter, policy, sources, observed, record, structureValidator);
  } finally {
    transaction?.fill(0);
    if (observed.credentials) disposeRuntimePrivilegeOperatorCredentials(observed.credentials);
  }
}

function safeEnvironment() {
  return Object.freeze({ PATH: SAFE_PATH, LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent" });
}

async function runProcess(command, args, { input = null, maximum = MAX_DATABASE_OUTPUT_BYTES, timeoutMs = 90_000, code }) {
  return new Promise((resolve, rejectPromise) => {
    let child;
    try { child = spawn(command, args, { env: safeEnvironment(), stdio: ["pipe", "pipe", "ignore"] }); }
    catch { rejectPromise(new RuntimePrivilegeOperatorRunnerError(code)); return; }
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new RuntimePrivilegeOperatorRunnerError(code));
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximum) { child.kill("SIGKILL"); return; }
      chunks.push(chunk);
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      if (status !== 0 || signal !== null || size > maximum) { fail(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

function psqlVariables(context) {
  return [
    "--no-align", "--tuples-only", "--field-separator=\t", "--set=ON_ERROR_STOP=1",
    `--set=expected_database=${context.expected_database}`,
    "--set=migration_owner=chenyida_erp_owner",
    `--set=expected_marker=${context.expected_database_marker}`,
    `--set=expected_system_identifier=${context.expected_system_identifier}`,
    "--set=controlled_runtime_mode=1",
  ];
}

async function inspectContainer(context, policy) {
  const template = [
    "{{.Id}}", "{{.Name}}", "{{.Image}}", "{{.Config.Image}}", "{{.Config.User}}", "{{.State.Running}}", "{{.State.Restarting}}",
    "{{.State.OOMKilled}}", "{{.RestartCount}}", "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    '{{index .Config.Labels "com.docker.compose.project"}}', '{{index .Config.Labels "com.docker.compose.service"}}',
  ].join("|");
  const output = await runProcess(policy.execution.docker_cli, ["inspect", "--format", template, context.postgres_container_name], {
    maximum: MAX_INSPECT_OUTPUT_BYTES, timeoutMs: 15_000, code: "RUNTIME_PRIVILEGE_OPERATOR_CONTAINER_INSPECT_FAILED",
  });
  const values = output.toString("utf8").trim().split("|");
  if (values.length !== 12 || values[0] !== context.postgres_container_id || values[1] !== `/${context.postgres_container_name}`
    || values[3] !== policy.execution.postgres_image || values[4] !== "999:999" || values[5] !== "true" || values[6] !== "false"
    || values[7] !== "false" || values[8] !== "0" || values[9] !== "healthy" || values[10] !== context.deployment_id || values[11] !== "postgres") {
    reject("RUNTIME_PRIVILEGE_OPERATOR_CONTAINER_INVALID");
  }
  return { container_id: values[0], container_name: context.postgres_container_name, image_id: values[2], image_reference: values[3] };
}

async function controlPsql(context, policy, input, extra = [], code) {
  return runProcess(policy.execution.docker_cli, ["exec", "-i", "--", context.postgres_container_name, "/bin/sh", "-ceu", CONTROL_SHELL, "sh", ...extra], {
    input,
    maximum: MAX_DATABASE_OUTPUT_BYTES,
    timeoutMs: 90_000,
    code,
  });
}

async function captureState(context, policy, siteRoot) {
  const sql = await readFile(path.join(siteRoot, "scripts/postgresql-runtime-privilege-state.sql"));
  const output = await controlPsql(context, policy, sql, psqlVariables(context), "RUNTIME_PRIVILEGE_OPERATOR_STATE_CAPTURE_FAILED");
  let state;
  try { state = parseStrictJson(output.toString("utf8").trim(), MAX_DATABASE_OUTPUT_BYTES); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_CAPTURE_FAILED"); }
  return state;
}

async function captureStructure(context, policy, siteRoot) {
  const sql = await readFile(path.join(siteRoot, "scripts/postgresql-runtime-privilege-catalog.sql"));
  const output = await controlPsql(context, policy, sql, psqlVariables(context), "RUNTIME_PRIVILEGE_OPERATOR_STRUCTURE_CAPTURE_FAILED");
  if (output.length < 2 || output.at(-1) !== 0x0a) reject("RUNTIME_PRIVILEGE_OPERATOR_STRUCTURE_CAPTURE_FAILED");
  return output;
}

async function assertActualBackupAncestors(absoluteRoot) {
  const relative = path.relative(path.parse(absoluteRoot).root, absoluteRoot);
  let candidate = path.parse(absoluteRoot).root;
  for (const component of [null, ...relative.split(path.sep).filter(Boolean)]) {
    if (component !== null) candidate = path.join(candidate, component);
    const metadata = await lstat(candidate).catch(() => null);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
      || (metadata.mode & 0o022) !== 0) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
  }
}

async function inspectBackupRoot(context) {
  const root = await realpath(context.backup_root).catch(() => null);
  const metadata = await lstat(context.backup_root).catch(() => null);
  const expectedUid = context.evidence_scope === "ACTUAL_CONTROLLED" ? 0 : process.getuid?.() ?? 0;
  if (root !== context.backup_root || !metadata?.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== expectedUid
    || metadata.gid !== expectedUid || (metadata.mode & 0o7777) !== 0o700) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
  if (context.evidence_scope === "ACTUAL_CONTROLLED") await assertActualBackupAncestors(root);
  const marker = path.join(root, ".chenyida-erp-backup-root-v2");
  let handle;
  try { handle = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID"); }
  let markerBytes;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== expectedUid || before.gid !== expectedUid || before.nlink !== 1 || ![0o400, 0o600].includes(before.mode & 0o7777)) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
    }
    markerBytes = await handle.readFile();
    const after = await handle.stat();
    const pointed = await lstat(marker).catch(() => null);
    if (!pointed || pointed.isSymbolicLink()) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "uid", "gid", "mode", "nlink"]) {
      if (before[key] !== after[key] || after[key] !== pointed[key]) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
    }
  } finally { await handle.close(); }
  if (!markerBytes.equals(Buffer.from("chenyida-erp-backup-root/v2\n", "utf8"))) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
  const fence = await lstat(path.join(root, ".backup-fence-v2.json")).catch(() => null);
  const finalMetadata = await lstat(root).catch(() => null);
  if (!finalMetadata || finalMetadata.dev !== metadata.dev || finalMetadata.ino !== metadata.ino || finalMetadata.uid !== metadata.uid
    || finalMetadata.gid !== metadata.gid || finalMetadata.mode !== metadata.mode || finalMetadata.mtimeMs !== metadata.mtimeMs
    || finalMetadata.ctimeMs !== metadata.ctimeMs) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_ROOT_INVALID");
  return {
    identity_sha256: clusterSha256({ device: String(metadata.dev), inode: String(metadata.ino), marker_sha256: sha256(markerBytes) }),
    fence_absent: fence === null,
  };
}

async function verifyCredentials(context, policy, binding) {
  const roleSql = RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.map((role) => `'${role}'`).join(",");
  const hashCheck = await controlPsql(context, policy, null, ["--no-align", "--tuples-only", "--set=ON_ERROR_STOP=1", "--command", `SELECT count(*) FILTER (WHERE rolpassword LIKE 'SCRAM-SHA-256$%')::text||'|'||current_setting('password_encryption') FROM pg_catalog.pg_authid WHERE rolcanlogin AND rolname IN (${roleSql})`], "RUNTIME_PRIVILEGE_OPERATOR_SCRAM_HASH_CHECK_FAILED");
  if (hashCheck.toString("utf8").trim() !== `${RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES.length}|scram-sha-256`) reject("RUNTIME_PRIVILEGE_OPERATOR_SCRAM_HASH_CHECK_FAILED");
  for (const role of RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES) {
    const wrong = Buffer.concat([WRONG_PASSWORD, Buffer.from("\n")]);
    try {
      await assertRejectsPassword(context, policy, role, wrong);
    } finally { wrong.fill(0); }
    await withRuntimePrivilegeOperatorPassword(binding, role, async (password) => {
      const input = Buffer.concat([password, Buffer.from("\n")]);
      try {
        const output = await runPasswordProbe(context, policy, role, input);
        if (output.toString("utf8").trim() !== "true|true|true") reject("RUNTIME_PRIVILEGE_OPERATOR_PASSWORD_PROBE_FAILED");
      } finally { input.fill(0); }
    });
  }
}

async function runPasswordProbe(context, policy, role, input) {
  return runProcess(policy.execution.docker_cli, ["exec", "-i", "--", context.postgres_container_name, "/bin/sh", "-ceu", PASSWORD_PROBE_SHELL, "sh", role, context.expected_database], {
    input, maximum: 1024, timeoutMs: 15_000, code: "RUNTIME_PRIVILEGE_OPERATOR_PASSWORD_PROBE_FAILED",
  });
}

async function assertRejectsPassword(context, policy, role, input) {
  try { await runPasswordProbe(context, policy, role, input); }
  catch (error) {
    if (error instanceof RuntimePrivilegeOperatorRunnerError && error.code === "RUNTIME_PRIVILEGE_OPERATOR_PASSWORD_PROBE_FAILED") return;
    throw error;
  }
  reject("RUNTIME_PRIVILEGE_OPERATOR_WRONG_PASSWORD_ACCEPTED");
}

export async function assertRuntimePrivilegeGlobalLockHeld(lockPath) {
  return new Promise((resolve, rejectPromise) => {
    let child;
    try {
      child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "--conflict-exit-code", "75", lockPath, "/usr/bin/true"], {
        env: safeEnvironment(), stdio: ["ignore", "ignore", "ignore"],
      });
    } catch { rejectPromise(new RuntimePrivilegeOperatorRunnerError("RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_PROBE_INVALID")); return; }
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    const fail = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new RuntimePrivilegeOperatorRunnerError(code));
    };
    child.on("error", () => fail("RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_PROBE_INVALID"));
    child.on("close", (status, signal) => {
      if (settled) return;
      if (signal !== null || status === null) { fail("RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_PROBE_INVALID"); return; }
      if (status === 75) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
        return;
      }
      fail(status === 0 ? "RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_NOT_HELD" : "RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_PROBE_INVALID");
    });
  });
}

async function assertSupervisorControl(context, policy) {
  if (context.evidence_scope !== "ACTUAL_CONTROLLED") return;
  if (process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES" || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT) reject("RUNTIME_PRIVILEGE_OPERATOR_SUPERVISOR_CONTROL_INVALID");
  const bundleRoot = path.dirname(SITE_ROOT);
  if (path.basename(bundleRoot) !== context.supervisor_bundle_sha256
    || !bundleRoot.startsWith("/usr/local/libexec/chenyida-erp-release-supervisor/bundles/")) reject("RUNTIME_PRIVILEGE_OPERATOR_SUPERVISOR_CONTROL_INVALID");
  const lockPath = policy.roots.global_lock;
  const lockDescriptor = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/.test(lockDescriptor || "")) reject("RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_INVALID");
  const lock = await lstat(lockPath).catch(() => null);
  const descriptor = await stat(`/proc/self/fd/${lockDescriptor}`).catch(() => null);
  if (!lock?.isFile() || lock.isSymbolicLink() || lock.uid !== 0 || lock.gid !== 0 || lock.nlink !== 1 || (lock.mode & 0o7777) !== 0o600
    || !descriptor || descriptor.dev !== lock.dev || descriptor.ino !== lock.ino) reject("RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_INVALID");
  await assertRuntimePrivilegeGlobalLockHeld(lockPath);
}

export function createRuntimePrivilegeOperatorSystemAdapter({ siteRoot = SITE_ROOT, clock = () => new Date() } = {}) {
  return Object.freeze({
    clock,
    assertControl: assertSupervisorControl,
    inspectBackupRoot,
    inspectContainer,
    captureState: (context, policy) => captureState(context, policy, siteRoot),
    captureStructure: (context, policy) => captureStructure(context, policy, siteRoot),
    applyTransaction: async (context, policy, input) => {
      const output = await controlPsql(context, policy, input, [], "RUNTIME_PRIVILEGE_OPERATOR_TRANSACTION_FAILED");
      if (output.toString("utf8").trim() !== "") reject("RUNTIME_PRIVILEGE_OPERATOR_TRANSACTION_OUTPUT_INVALID");
    },
    verifyCredentials,
  });
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_CONTEXT_BYTES) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  let value;
  try { value = parseStrictJson(bytes.toString("utf8"), MAX_CONTEXT_BYTES); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID"); }
  if (!bytes.equals(Buffer.from(canonicalClusterJson(value), "utf8"))) reject("RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_INVALID");
  return value;
}

async function main(argumentsList) {
  const confirmations = Object.freeze({
    prepare: "PREPARE_DURABLE_INTENT_BEFORE_AUTHORIZATION",
    execute: "EXECUTE_EXACT_PREPARED_RUNTIME_PRIVILEGE_INTENT",
    "recover-prepare": "PREPARE_DURABLE_RECOVERY_AUTHORIZATION",
    "recover-execute": "EXECUTE_EXACT_PREPARED_RUNTIME_PRIVILEGE_RECOVERY",
  });
  if (argumentsList.length !== 2 || confirmations[argumentsList[0]] !== argumentsList[1]) {
    process.stderr.write("usage: postgresql-runtime-privilege-runner.mjs <prepare|execute|recover-prepare|recover-execute> <exact-confirmation>\n");
    process.exitCode = 2;
    return;
  }
  const context = await readStdin();
  const adapter = createRuntimePrivilegeOperatorSystemAdapter();
  const operations = {
    prepare: prepareControlledRuntimePrivilegeOperation,
    execute: executePreparedRuntimePrivilegeOperation,
    "recover-prepare": prepareRuntimePrivilegeOperationRecovery,
    "recover-execute": executeRuntimePrivilegeOperationRecovery,
  };
  const result = await operations[argumentsList[0]](context, adapter);
  process.stdout.write(canonicalClusterJson(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    const code = typeof error?.code === "string" && /^RUNTIME_PRIVILEGE_OPERATOR_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "RUNTIME_PRIVILEGE_OPERATOR_RUNNER_INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
