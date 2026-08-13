import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  ClusterRecoveryError,
  canonicalClusterJson,
  clusterPolicySha256,
  clusterSha256,
  readRecoveryExecution,
  transitionRecoveryState,
  validateClusterRecoveryPolicy,
  validateClusterSnapshot,
  validateRecoveryIntent,
  validateTablespaceMapDocument,
  validateTablespacePreflightEvidence,
  verifyTablespacePathAfterCreate,
  verifyTablespacePathAfterDrop,
  writeRecoveryState,
} from "./postgresql-cluster-recovery-contract.mjs";
import {
  quotePostgresIdentifier,
  quotePostgresLiteral,
  validateClusterRestorePlan,
} from "./postgresql-cluster-restore-contract.mjs";

export const RECOVERY_EXECUTOR_CONFIRMATION = "EXECUTE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1";
export const RECOVERY_COMPENSATION_CONFIRMATION = "COMPENSATE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1";

const LOCK_FILE = ".postgresql-cluster-recovery-executor-v1.lock";
const LOCK_VALUE = "chenyida-erp-postgresql-recovery-executor-lock/v1\n";
const SAFE_PATH = "/usr/bin:/bin";
const SHA256 = /^[0-9a-f]{64}$/u;
const CONNECTION_KEYS = new Set(["PGHOST", "PGPORT", "PGUSER", "PGCONNECT_TIMEOUT", "PGSSLMODE", "PGSSLROOTCERT"]);
const INSPECTION_STATUSES = new Set(["ABSENT", "PARTIAL_CREATED", "APPLIED", "CONFLICT"]);
const COMPENSATABLE_PREDECESSORS = new Set([
  "ROLE_SKELETON_APPLIED",
  "TABLESPACE_COMMAND_DISPATCHED",
  "TABLESPACE_RECONCILED_APPLIED",
  "TABLESPACE_VERIFIED",
  "DATABASE_COMMAND_DISPATCHED",
  "DATABASE_RECONCILED_APPLIED",
  "DATABASE_VERIFIED",
]);

function reject(code) {
  throw new ClusterRecoveryError(code);
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function same(left, right) {
  return canonicalClusterJson(left) === canonicalClusterJson(right);
}

function validateClock(clock) {
  if (typeof clock !== "function") reject("RECOVERY_EXECUTOR_CLOCK_INVALID");
  return clock;
}

function now(clock) {
  const value = clock();
  if (typeof value !== "string") reject("RECOVERY_EXECUTOR_CLOCK_INVALID");
  return value;
}

function operationFor(resource) {
  return Object.freeze({
    kind: resource.kind,
    resource_identity_sha256: resource.operationResourceIdentitySha256,
    payload_sha256: resource.sqlSha256,
  });
}

function buildExecutionContext({ intent: intentInput, plan: planInput, snapshot: snapshotInput, policy: policyInput, tablespaceMap: mapInput, tablespacePreflight: preflightInput, databaseProfile }) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  const tablespaceMap = validateTablespaceMapDocument({ map: mapInput, snapshot, policy, evidenceScope: mapInput?.evidence_scope });
  const tablespacePreflight = validateTablespacePreflightEvidence({ preflightValidation: preflightInput, map: tablespaceMap, snapshot, policy, evidenceScope: tablespaceMap.evidence_scope });
  const plan = validateClusterRestorePlan(planInput, { snapshot, policy, tablespaceMap, databaseProfile });
  const intent = validateRecoveryIntent(intentInput);
  const expectedTablespaceIdentities = plan.tablespaces.map((entry) => entry.resource_identity_sha256).sort();
  if (intent.backup_id !== plan.backup_id || intent.snapshot_sha256 !== plan.snapshot_sha256
    || intent.policy_sha256 !== plan.policy_sha256 || intent.tablespace_map_sha256 !== plan.tablespace_map_sha256
    || intent.credential_role_set_sha256 !== plan.credential_binding.role_set_sha256
    || intent.evidence_scope !== tablespaceMap.evidence_scope
    || !same(intent.custom_tablespace_identity_sha256, expectedTablespaceIdentities)) reject("RECOVERY_EXECUTOR_BINDING_MISMATCH");
  const tablespaces = plan.tablespaces.map((entry, index) => Object.freeze({
    kind: "TABLESPACE",
    operationResourceIdentitySha256: entry.resource_identity_sha256,
    resourceIdentitySha256: entry.resource_identity_sha256,
    sql: entry.sql,
    sqlSha256: entry.sql_sha256,
    markerSql: `COMMENT ON TABLESPACE ${quotePostgresIdentifier(entry.name)} IS ${quotePostgresLiteral(entry.recovery_marker)};\n`,
    name: entry.name,
    owner: snapshot.catalog.tablespaces[index].owner,
    hostPath: tablespaceMap.entries[index].host_path,
    serverPath: tablespaceMap.entries[index].server_path,
    recoveryMarker: entry.recovery_marker,
  }));
  const database = Object.freeze({
    kind: "DATABASE",
    operationResourceIdentitySha256: intent.target_system_identifier_sha256,
    resourceIdentitySha256: plan.database.resource_identity_sha256,
    sql: plan.database.sql,
    sqlSha256: plan.database.sql_sha256,
    markerSql: `COMMENT ON DATABASE ${quotePostgresIdentifier(plan.database.name)} IS ${quotePostgresLiteral(plan.database.recovery_marker)};\n`,
    name: plan.database.name,
    owner: snapshot.catalog.database.owner,
    defaultTablespace: snapshot.catalog.database.default_tablespace,
    recoveryMarker: plan.database.recovery_marker,
    profile: Object.freeze({ ...databaseProfile }),
  });
  return Object.freeze({ intent, plan, snapshot, policy, tablespaceMap, tablespacePreflight, tablespaces: Object.freeze(tablespaces), database });
}

function resourceForCurrentState(context, state) {
  if (new Set(["DATABASE_COMMAND_DISPATCHED", "DATABASE_RECONCILED_APPLIED", "DATABASE_VERIFIED"]).has(state.phase)) {
    if (!same(state.operation, operationFor(context.database))) reject("RECOVERY_EXECUTOR_STATE_OPERATION_MISMATCH");
    return context.database;
  }
  if (new Set(["TABLESPACE_COMMAND_DISPATCHED", "TABLESPACE_RECONCILED_APPLIED"]).has(state.phase)) {
    const resource = context.tablespaces.find((entry) => same(state.operation, operationFor(entry)));
    if (!resource) reject("RECOVERY_EXECUTOR_STATE_OPERATION_MISMATCH");
    return resource;
  }
  if (new Set(["ROLE_SKELETON_APPLIED", "TABLESPACE_VERIFIED"]).has(state.phase)) {
    const resource = context.tablespaces.find((entry) => !state.verified_tablespaces.includes(entry.resourceIdentitySha256));
    return resource ?? context.database;
  }
  return null;
}

async function safeLockFile(file) {
  const metadata = await lstat(file).catch(() => reject("RECOVERY_EXECUTOR_LOCK_UNSAFE"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== (process.getuid?.() ?? 0) || (metadata.mode & 0o777) !== 0o600
    || metadata.size !== Buffer.byteLength(LOCK_VALUE)) reject("RECOVERY_EXECUTOR_LOCK_UNSAFE");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("RECOVERY_EXECUTOR_LOCK_UNSAFE"));
  try {
    const source = await handle.readFile("utf8");
    const after = await handle.stat();
    if (source !== LOCK_VALUE || after.dev !== metadata.dev || after.ino !== metadata.ino) reject("RECOVERY_EXECUTOR_LOCK_UNSAFE");
  } finally { await handle.close(); }
  return metadata;
}

async function acquireExecutionLock(rootInput) {
  const root = path.resolve(rootInput), lockFile = path.join(root, LOCK_FILE);
  let created = false;
  try {
    const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(LOCK_VALUE, "utf8"); await handle.chmod(0o600); await handle.sync(); created = true; } finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== "EEXIST") reject("RECOVERY_EXECUTOR_LOCK_UNSAFE");
  }
  if (created) {
    const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch(() => reject("RECOVERY_EXECUTOR_LOCK_UNSAFE"));
    try { await directory.sync(); } finally { await directory.close(); }
  }
  const metadata = await safeLockFile(lockFile);
  const child = spawn("flock", ["-n", lockFile, "sh", "-c", "printf 'LOCKED\\n'; IFS= read -r task55_release"], {
    env: { PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const acquired = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.once("error", () => finish(false));
    child.once("close", () => finish(false));
    child.stdout.once("data", (chunk) => finish(chunk.toString("utf8") === "LOCKED\n"));
  });
  if (!acquired) { child.kill("SIGKILL"); reject("RECOVERY_EXECUTOR_LOCK_BUSY"); }
  return async () => {
    child.stdin.end("release\n");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("close", resolve));
    const after = await safeLockFile(lockFile);
    if (after.dev !== metadata.dev || after.ino !== metadata.ino) reject("RECOVERY_EXECUTOR_LOCK_CHANGED");
  };
}

function validateAdapter(adapter, evidenceScope) {
  record(adapter, "RECOVERY_EXECUTOR_ADAPTER_INVALID");
  for (const method of ["assertTargetIdentity", "assertContainment", "inspect", "verifyTablespacePath", "dispatch", "finalizeMarker", "quarantine"] ) {
    if (typeof adapter[method] !== "function") reject("RECOVERY_EXECUTOR_ADAPTER_INVALID");
  }
  if (evidenceScope === "ACTUAL_CONTROLLED" && !(adapter instanceof PsqlClusterRecoveryAdapter)) reject("RECOVERY_EXECUTOR_ACTUAL_ADAPTER_REQUIRED");
  return adapter;
}

function validateInspection(value) {
  record(value, "RECOVERY_EXECUTOR_INSPECTION_INVALID");
  if (!INSPECTION_STATUSES.has(value.status)) reject("RECOVERY_EXECUTOR_INSPECTION_INVALID");
  if (!Number.isSafeInteger(value.dependencyCount) || value.dependencyCount < 0) reject("RECOVERY_EXECUTOR_INSPECTION_INVALID");
  if (!Number.isSafeInteger(value.activeSessions) || value.activeSessions < 0) reject("RECOVERY_EXECUTOR_INSPECTION_INVALID");
  return value;
}

async function persistPhase({ stateRoot, execution, phase, operation, clock }) {
  const state = transitionRecoveryState(execution.current, execution.intent, { phase, operation, recordedAt: now(clock) });
  await writeRecoveryState({ stateRoot, state, intent: execution.intent });
  return readRecoveryExecution({ stateRoot, restoreRunId: execution.intent.restore_run_id });
}

async function invokeFault(faultInjector, stage, context) {
  if (!faultInjector) return;
  await faultInjector(stage, Object.freeze({
    restoreRunId: context.intent.restore_run_id,
    resourceKind: context.resource?.kind ?? null,
  }));
}

async function quarantineAndReject({ adapter, context, execution, stateRoot, clock, code }) {
  try {
    const databaseInspection = validateInspection(await adapter.inspect(context.database));
    const includeDatabase = new Set(["APPLIED", "PARTIAL_CREATED"]).has(databaseInspection.status);
    await adapter.quarantine(context, { includeDatabase });
    await adapter.assertContainment(context, { allowForeignDatabase: true });
  } catch {
    reject("RECOVERY_EXECUTOR_QUARANTINE_UNVERIFIED");
  }
  await persistPhase({ stateRoot, execution, phase: "QUARANTINED", operation: execution.current.operation, clock });
  reject(code);
}

async function reconcileDispatched({ adapter, context, resource, execution, stateRoot, clock, faultInjector, resumed }) {
  let inspection;
  try { inspection = validateInspection(await adapter.inspect(resource)); }
  catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_INSPECTION_FAILED_QUARANTINED" }); }
  if (inspection.status === "ABSENT") {
    if (!resumed) reject("RECOVERY_EXECUTOR_DISPATCH_NOT_APPLIED_RETRY_SAFE");
    try { await adapter.dispatch(resource); } catch { /* The catalog reconciliation below is authoritative. */ }
    await invokeFault(faultInjector, "AFTER_RESUME_COMMAND", { ...context, resource });
    try { inspection = validateInspection(await adapter.inspect(resource)); }
    catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_INSPECTION_FAILED_QUARANTINED" }); }
    if (inspection.status === "ABSENT") reject("RECOVERY_EXECUTOR_DISPATCH_NOT_APPLIED_RETRY_SAFE");
  }
  if (inspection.status === "PARTIAL_CREATED") {
    try { await adapter.finalizeMarker(resource); } catch { /* Re-inspection decides whether retry remains safe. */ }
    await invokeFault(faultInjector, "AFTER_MARKER_COMMAND", { ...context, resource });
    try { inspection = validateInspection(await adapter.inspect(resource)); }
    catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_INSPECTION_FAILED_QUARANTINED" }); }
    if (inspection.status === "PARTIAL_CREATED") reject("RECOVERY_EXECUTOR_MARKER_NOT_APPLIED_RETRY_SAFE");
  }
  if (inspection.status === "CONFLICT") {
    await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_RESOURCE_CONFLICT_QUARANTINED" });
  }
  if (inspection.status !== "APPLIED") reject("RECOVERY_EXECUTOR_INSPECTION_INVALID");
  if (resource.kind === "TABLESPACE") {
    try { await adapter.verifyTablespacePath(resource, context); }
    catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_TABLESPACE_PATH_FAILED_QUARANTINED" }); }
  }
  await adapter.assertContainment(context);
  const phase = resource.kind === "TABLESPACE" ? "TABLESPACE_RECONCILED_APPLIED" : "DATABASE_RECONCILED_APPLIED";
  const advanced = await persistPhase({ stateRoot, execution, phase, operation: operationFor(resource), clock });
  await invokeFault(faultInjector, "AFTER_RECONCILED_DURABLE", { ...context, resource });
  return advanced;
}

async function verifyReconciled({ adapter, context, resource, execution, stateRoot, clock, faultInjector }) {
  let inspection;
  try { inspection = validateInspection(await adapter.inspect(resource)); }
  catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_VERIFY_FAILED_QUARANTINED" }); }
  if (inspection.status !== "APPLIED") {
    await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_VERIFY_DRIFT_QUARANTINED" });
  }
  await adapter.assertContainment(context);
  const phase = resource.kind === "TABLESPACE" ? "TABLESPACE_VERIFIED" : "DATABASE_VERIFIED";
  const advanced = await persistPhase({ stateRoot, execution, phase, operation: operationFor(resource), clock });
  await invokeFault(faultInjector, "AFTER_VERIFIED_DURABLE", { ...context, resource });
  return advanced;
}

async function assertPreviouslyVerifiedResources({ adapter, context, execution, stateRoot, clock }) {
  const resources = context.tablespaces.filter((resource) => execution.current.verified_tablespaces.includes(resource.resourceIdentitySha256));
  if (execution.current.phase === "DATABASE_VERIFIED") resources.push(context.database);
  for (const resource of resources) {
    let inspection;
    try { inspection = validateInspection(await adapter.inspect(resource)); }
    catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_VERIFIED_RESOURCE_INSPECTION_FAILED_QUARANTINED" }); }
    if (inspection.status !== "APPLIED") {
      await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_VERIFIED_RESOURCE_DRIFT_QUARANTINED" });
    }
    if (resource.kind === "TABLESPACE") {
      try { await adapter.verifyTablespacePath(resource, context); }
      catch { await quarantineAndReject({ adapter, context, execution, stateRoot, clock, code: "RECOVERY_EXECUTOR_VERIFIED_TABLESPACE_PATH_DRIFT_QUARANTINED" }); }
    }
  }
}

export async function executeNextNontransactionalRecoveryStep({
  stateRoot,
  intent,
  plan,
  snapshot,
  policy,
  tablespaceMap,
  tablespacePreflight,
  databaseProfile,
  adapter,
  confirmation,
  clock = () => new Date().toISOString(),
  faultInjector = null,
}) {
  if (confirmation !== RECOVERY_EXECUTOR_CONFIRMATION) reject("RECOVERY_EXECUTOR_CONFIRMATION_REQUIRED");
  validateClock(clock);
  const context = buildExecutionContext({ intent, plan, snapshot, policy, tablespaceMap, tablespacePreflight, databaseProfile });
  validateAdapter(adapter, context.intent.evidence_scope);
  if (faultInjector !== null && (context.intent.evidence_scope !== "SYNTHETIC_TEST_ONLY" || typeof faultInjector !== "function")) reject("RECOVERY_EXECUTOR_FAULT_INJECTION_FORBIDDEN");
  await readRecoveryExecution({ stateRoot, restoreRunId: context.intent.restore_run_id });
  const release = await acquireExecutionLock(stateRoot);
  try {
    let execution = await readRecoveryExecution({ stateRoot, restoreRunId: context.intent.restore_run_id });
    if (execution.intent.intent_sha256 !== context.intent.intent_sha256) reject("RECOVERY_EXECUTOR_INTENT_CONFLICT");
    if (execution.current.phase === "QUARANTINED" || execution.current.phase === "COMPENSATED") {
      return Object.freeze({ status: execution.current.phase, state: execution.current, chainSha256: execution.chain_sha256 });
    }
    await adapter.assertTargetIdentity(context.intent.target_system_identifier_sha256);
    await adapter.assertContainment(context);
    await assertPreviouslyVerifiedResources({ adapter, context, execution, stateRoot, clock });
    if (execution.current.phase === "DATABASE_VERIFIED") {
      return Object.freeze({ status: "NONTRANSACTIONAL_COMPLETE", state: execution.current, chainSha256: execution.chain_sha256 });
    }
    const resource = resourceForCurrentState(context, execution.current);
    if (!resource) reject("RECOVERY_EXECUTOR_PHASE_UNSUPPORTED");
    const dispatchedPhase = resource.kind === "TABLESPACE" ? "TABLESPACE_COMMAND_DISPATCHED" : "DATABASE_COMMAND_DISPATCHED";
    const reconciledPhase = resource.kind === "TABLESPACE" ? "TABLESPACE_RECONCILED_APPLIED" : "DATABASE_RECONCILED_APPLIED";
    let resumed = execution.current.phase === dispatchedPhase;
    if (!resumed && execution.current.phase !== reconciledPhase) {
      execution = await persistPhase({ stateRoot, execution, phase: dispatchedPhase, operation: operationFor(resource), clock });
      await invokeFault(faultInjector, "AFTER_DISPATCH_DURABLE", { ...context, resource });
      try { await adapter.dispatch(resource); } catch { /* Reconciliation is authoritative after durable dispatch. */ }
      await invokeFault(faultInjector, "AFTER_INITIAL_COMMAND", { ...context, resource });
      resumed = false;
    }
    if (execution.current.phase === dispatchedPhase) {
      execution = await reconcileDispatched({ adapter, context, resource, execution, stateRoot, clock, faultInjector, resumed });
    }
    if (execution.current.phase === reconciledPhase) {
      execution = await verifyReconciled({ adapter, context, resource, execution, stateRoot, clock, faultInjector });
    }
    return Object.freeze({
      status: execution.current.phase === "DATABASE_VERIFIED" ? "NONTRANSACTIONAL_COMPLETE" : "STEP_VERIFIED",
      state: execution.current,
      chainSha256: execution.chain_sha256,
    });
  } finally { await release(); }
}

export async function compensateQuarantinedRecovery({
  stateRoot,
  intent,
  plan,
  snapshot,
  policy,
  tablespaceMap,
  tablespacePreflight,
  databaseProfile,
  adapter,
  confirmation,
  clock = () => new Date().toISOString(),
}) {
  if (confirmation !== RECOVERY_COMPENSATION_CONFIRMATION) reject("RECOVERY_COMPENSATION_CONFIRMATION_REQUIRED");
  validateClock(clock);
  const context = buildExecutionContext({ intent, plan, snapshot, policy, tablespaceMap, tablespacePreflight, databaseProfile });
  validateAdapter(adapter, context.intent.evidence_scope);
  for (const method of ["assertCompensationSafe", "compensate", "compensateRoles", "assertResourcesAbsent"]) {
    if (typeof adapter[method] !== "function") reject("RECOVERY_COMPENSATION_ADAPTER_INVALID");
  }
  await readRecoveryExecution({ stateRoot, restoreRunId: context.intent.restore_run_id });
  const release = await acquireExecutionLock(stateRoot);
  try {
    let execution = await readRecoveryExecution({ stateRoot, restoreRunId: context.intent.restore_run_id });
    if (execution.intent.intent_sha256 !== context.intent.intent_sha256) reject("RECOVERY_EXECUTOR_INTENT_CONFLICT");
    if (execution.current.phase === "COMPENSATED") return Object.freeze({ status: "COMPENSATED", state: execution.current, chainSha256: execution.chain_sha256 });
    if (execution.current.phase !== "QUARANTINED") reject("RECOVERY_COMPENSATION_PHASE_INVALID");
    const predecessor = execution.states.at(-2);
    if (!predecessor || !COMPENSATABLE_PREDECESSORS.has(predecessor.phase)) reject("RECOVERY_COMPENSATION_SCOPE_UNSAFE");
    await adapter.assertTargetIdentity(context.intent.target_system_identifier_sha256);
    await adapter.assertContainment(context, { allowForeignDatabase: true });
    const databaseInspection = validateInspection(await adapter.inspect(context.database));
    if (databaseInspection.status === "CONFLICT" || databaseInspection.activeSessions !== 0) reject("RECOVERY_COMPENSATION_DATABASE_UNSAFE");
    const tablespaceInspections = [];
    for (const resource of [...context.tablespaces].reverse()) {
      const inspection = validateInspection(await adapter.inspect(resource));
      if (inspection.status === "CONFLICT" || inspection.dependencyCount !== 0) reject("RECOVERY_COMPENSATION_TABLESPACE_UNSAFE");
      if (inspection.status !== "ABSENT") await adapter.verifyTablespacePath(resource, context);
      tablespaceInspections.push({ resource, inspection });
    }
    await adapter.assertCompensationSafe(context);
    if (databaseInspection.status !== "ABSENT") await adapter.compensate(context.database, databaseInspection);
    for (const { resource } of tablespaceInspections) {
      const inspection = validateInspection(await adapter.inspect(resource));
      if (inspection.status !== "ABSENT") {
        if (inspection.status === "CONFLICT" || inspection.dependencyCount !== 0) reject("RECOVERY_COMPENSATION_TABLESPACE_UNSAFE");
        await adapter.compensate(resource, inspection);
      }
    }
    await adapter.compensateRoles(context);
    await adapter.assertResourcesAbsent(context);
    execution = await persistPhase({ stateRoot, execution, phase: "COMPENSATED", operation: execution.current.operation, clock });
    return Object.freeze({ status: "COMPENSATED", state: execution.current, chainSha256: execution.chain_sha256 });
  } finally { await release(); }
}

function validateConnectionEnvironment(input) {
  const value = record(input, "RECOVERY_PSQL_ENVIRONMENT_INVALID"), output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!CONNECTION_KEYS.has(key) || typeof entry !== "string" || Buffer.byteLength(entry, "utf8") > 4096
      || /[\u0000\r\n]/u.test(entry) || /(?:password\s*=|pgpassword|postgres(?:ql)?:\/\/)/iu.test(entry)) reject("RECOVERY_PSQL_ENVIRONMENT_INVALID");
    output[key] = entry;
  }
  if (typeof output.PGHOST !== "string" || typeof output.PGUSER !== "string") reject("RECOVERY_PSQL_ENVIRONMENT_INVALID");
  return Object.freeze(output);
}

async function validateExecutable(file) {
  const resolved = path.resolve(file);
  if (resolved !== file || await realpath(resolved).catch(() => null) !== resolved) reject("RECOVERY_PSQL_EXECUTABLE_UNSAFE");
  const metadata = await lstat(resolved).catch(() => reject("RECOVERY_PSQL_EXECUTABLE_UNSAFE"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o111) === 0) reject("RECOVERY_PSQL_EXECUTABLE_UNSAFE");
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: String(metadata.mtimeMs),
    ctimeMs: String(metadata.ctimeMs),
  });
}

async function runPsql(psqlPath, executableIdentity, connectionEnvironment, sql, capture) {
  if (typeof sql !== "string" || sql.length === 0 || Buffer.byteLength(sql, "utf8") > 2 * 1024 * 1024 || /\u0000|\r/u.test(sql)) reject("RECOVERY_PSQL_INPUT_INVALID");
  const current = await validateExecutable(psqlPath);
  if (!same(current, executableIdentity)) reject("RECOVERY_PSQL_EXECUTABLE_CHANGED");
  const environment = {
    PATH: SAFE_PATH,
    LANG: "C",
    LC_ALL: "C",
    PGPASSFILE: "/dev/null",
    PGSSLKEY: "/dev/null",
    PGSSLCERT: "/dev/null",
    PGDATABASE: "postgres",
    ...connectionEnvironment,
  };
  const child = spawn(psqlPath, ["-X", "--no-password", "--quiet", "--no-align", "--tuples-only", "--set", "ON_ERROR_STOP=on", "--set", "VERBOSITY=terse", "--dbname=postgres"], {
    env: environment,
    stdio: ["pipe", capture ? "pipe" : "ignore", "ignore"],
    windowsHide: true,
  });
  let bytes = 0, overflow = false, output = "";
  if (capture) child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 256 * 1024) { overflow = true; child.kill("SIGKILL"); return; }
    output += chunk.toString("utf8");
  });
  const completed = new Promise((resolve) => {
    let spawnFailed = false;
    child.once("error", () => { spawnFailed = true; });
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, spawnFailed }));
  });
  child.stdin.end(sql);
  const status = await completed;
  if (overflow || status.spawnFailed || status.exitCode !== 0 || status.signal !== null) reject("RECOVERY_PSQL_COMMAND_FAILED");
  return output;
}

function parseSingleJson(source) {
  const text = source.trim();
  if (text.length === 0 || text.includes("\n")) reject("RECOVERY_PSQL_RESULT_INVALID");
  try { return record(parseStrictJson(text), "RECOVERY_PSQL_RESULT_INVALID"); }
  catch { reject("RECOVERY_PSQL_RESULT_INVALID"); }
}

function literalList(values) {
  return values.map((value) => quotePostgresLiteral(value)).join(", ");
}

export class PsqlClusterRecoveryAdapter {
  constructor({ psqlPath, connectionEnvironment }) {
    if (typeof psqlPath !== "string" || !path.isAbsolute(psqlPath) || /[\u0000\r\n]/u.test(psqlPath)) reject("RECOVERY_PSQL_EXECUTABLE_UNSAFE");
    this.psqlPath = psqlPath;
    this.connectionEnvironment = validateConnectionEnvironment(connectionEnvironment);
    this.executableIdentity = null;
  }

  async initialize() {
    if (this.executableIdentity === null) this.executableIdentity = await validateExecutable(this.psqlPath);
  }

  async command(sql) {
    await this.initialize();
    await runPsql(this.psqlPath, this.executableIdentity, this.connectionEnvironment, sql, false);
  }

  async query(sql) {
    await this.initialize();
    return parseSingleJson(await runPsql(this.psqlPath, this.executableIdentity, this.connectionEnvironment, `SET statement_timeout = '15s';\n${sql}`, true));
  }

  async assertTargetIdentity(expectedSha256) {
    if (typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)) reject("RECOVERY_TARGET_IDENTITY_INVALID");
    const value = await this.query("SELECT json_build_object('system_identifier', system_identifier::text)::text FROM pg_control_system();\n");
    if (typeof value.system_identifier !== "string" || clusterSha256(value.system_identifier) !== expectedSha256) reject("RECOVERY_TARGET_IDENTITY_MISMATCH");
  }

  async inspect(resource) {
    if (resource.kind === "TABLESPACE") return this.inspectTablespace(resource);
    if (resource.kind === "DATABASE") return this.inspectDatabase(resource);
    reject("RECOVERY_RESOURCE_KIND_INVALID");
  }

  async inspectTablespace(resource) {
    const name = quotePostgresLiteral(resource.name);
    const result = await this.query(`SELECT json_build_object(
  'rows', COALESCE((SELECT json_agg(json_build_object(
    'oid', t.oid::text,
    'owner', r.rolname,
    'location', pg_tablespace_location(t.oid),
    'options', COALESCE(to_json(t.spcoptions), '[]'::json),
    'acl_is_null', t.spcacl IS NULL,
    'comment', shobj_description(t.oid, 'pg_tablespace')
  ) ORDER BY t.oid) FROM pg_tablespace t JOIN pg_roles r ON r.oid=t.spcowner WHERE t.spcname=${name}), '[]'::json),
  'dependency_count', (SELECT count(*)::integer FROM (
    SELECT c.oid FROM pg_class c JOIN pg_tablespace t ON t.oid=c.reltablespace WHERE t.spcname=${name}
    UNION ALL
    SELECT d.oid FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE t.spcname=${name}
  ) dependencies)
)::text;\n`);
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.dependency_count) || result.dependency_count < 0) reject("RECOVERY_TABLESPACE_INSPECTION_INVALID");
    if (result.rows.length === 0) return Object.freeze({ status: "ABSENT", dependencyCount: 0, activeSessions: 0 });
    if (result.rows.length !== 1) return Object.freeze({ status: "CONFLICT", dependencyCount: result.dependency_count, activeSessions: 0 });
    const row = record(result.rows[0], "RECOVERY_TABLESPACE_INSPECTION_INVALID");
    const exact = typeof row.oid === "string" && row.owner === resource.owner && row.location === resource.serverPath
      && Array.isArray(row.options) && row.options.length === 0 && row.acl_is_null === true;
    const status = !exact || (row.comment !== null && row.comment !== resource.recoveryMarker)
      ? "CONFLICT"
      : row.comment === resource.recoveryMarker ? "APPLIED" : "PARTIAL_CREATED";
    return Object.freeze({ status, dependencyCount: result.dependency_count, activeSessions: 0 });
  }

  async inspectDatabase(resource) {
    const name = quotePostgresLiteral(resource.name);
    const result = await this.query(`SELECT json_build_object(
  'rows', COALESCE((SELECT json_agg(json_build_object(
    'oid', d.oid::text,
    'owner', r.rolname,
    'encoding', pg_encoding_to_char(d.encoding),
    'locale_provider', CASE d.datlocprovider WHEN 'c' THEN 'libc' WHEN 'i' THEN 'icu' WHEN 'b' THEN 'builtin' ELSE 'unknown' END,
    'collate', d.datcollate,
    'ctype', d.datctype,
    'collation_version', d.datcollversion,
    'default_tablespace', t.spcname,
    'allow_connections', d.datallowconn,
    'connection_limit', d.datconnlimit,
    'is_template', d.datistemplate,
    'acl_is_null', d.datacl IS NULL,
    'setting_count', (SELECT count(*)::integer FROM pg_db_role_setting s WHERE s.setdatabase=d.oid),
    'comment', shobj_description(d.oid, 'pg_database')
  ) ORDER BY d.oid) FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=${name}), '[]'::json),
  'active_sessions', (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=${name})
)::text;\n`);
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.active_sessions) || result.active_sessions < 0) reject("RECOVERY_DATABASE_INSPECTION_INVALID");
    if (result.rows.length === 0) return Object.freeze({ status: "ABSENT", dependencyCount: 0, activeSessions: result.active_sessions });
    if (result.rows.length !== 1) return Object.freeze({ status: "CONFLICT", dependencyCount: 0, activeSessions: result.active_sessions });
    const row = record(result.rows[0], "RECOVERY_DATABASE_INSPECTION_INVALID"), profile = resource.profile;
    const exact = typeof row.oid === "string" && row.owner === resource.owner && row.encoding === profile.encoding
      && row.locale_provider === profile.locale_provider && row.collate === profile.collate && row.ctype === profile.ctype
      && row.collation_version === profile.collation_version && row.default_tablespace === resource.defaultTablespace
      && row.allow_connections === true && row.connection_limit === 0 && row.is_template === false
      && row.acl_is_null === true && row.setting_count === 0;
    const status = !exact || (row.comment !== null && row.comment !== resource.recoveryMarker)
      ? "CONFLICT"
      : row.comment === resource.recoveryMarker ? "APPLIED" : "PARTIAL_CREATED";
    return Object.freeze({ status, dependencyCount: 0, activeSessions: result.active_sessions });
  }

  async verifyTablespacePath(resource, context) {
    return verifyTablespacePathAfterCreate({
      preflightValidation: context.tablespacePreflight,
      map: context.tablespaceMap,
      snapshot: context.snapshot,
      policy: context.policy,
      entryName: resource.name,
      targetLocationSha256: clusterSha256(resource.serverPath),
      evidenceScope: context.intent.evidence_scope,
    });
  }

  async assertContainment(context, { allowForeignDatabase = false } = {}) {
    const names = context.snapshot.catalog.roles.map((role) => role.name), markers = new Map(context.plan.roles.map((role) => [role.name, role.recovery_marker]));
    const result = await this.query(`SELECT json_build_object(
  'rows', COALESCE((SELECT json_agg(json_build_object(
    'name', r.rolname,
    'superuser', r.rolsuper,
    'inherit', r.rolinherit,
    'create_role', r.rolcreaterole,
    'create_database', r.rolcreatedb,
    'can_login', r.rolcanlogin,
    'replication', r.rolreplication,
    'connection_limit', r.rolconnlimit,
    'bypass_rls', r.rolbypassrls,
    'valid_until', CASE WHEN r.rolvaliduntil IS NULL OR r.rolvaliduntil='infinity'::timestamptz THEN NULL ELSE to_char(r.rolvaliduntil AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'setting_count', COALESCE(array_length(r.rolconfig, 1), 0),
    'comment', shobj_description(r.oid, 'pg_authid')
  ) ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname IN (${literalList(names)})), '[]'::json),
  'membership_count', (SELECT count(*)::integer FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE granted.rolname IN (${literalList(names)}) OR member.rolname IN (${literalList(names)}))
)::text;\n`);
    if (!Array.isArray(result.rows) || result.rows.length !== names.length || result.membership_count !== 0) reject("RECOVERY_ROLE_CONTAINMENT_FAILED");
    const expectedRoles = [...context.snapshot.catalog.roles].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const [index, rowInput] of result.rows.entries()) {
      const row = record(rowInput, "RECOVERY_ROLE_CONTAINMENT_FAILED"), expected = expectedRoles[index];
      if (row.name !== expected.name || row.superuser !== false || row.inherit !== expected.inherit || row.create_role !== false
        || row.create_database !== false || row.can_login !== false || row.replication !== false || row.connection_limit !== expected.connection_limit
        || row.bypass_rls !== false || row.valid_until !== expected.valid_until
        || row.setting_count !== 0 || row.comment !== markers.get(expected.name)) reject("RECOVERY_ROLE_CONTAINMENT_FAILED");
    }
    const database = await this.inspect(context.database);
    if (database.status === "CONFLICT" && !allowForeignDatabase) reject("RECOVERY_DATABASE_CONTAINMENT_FAILED");
    if (new Set(["APPLIED", "PARTIAL_CREATED"]).has(database.status) && database.activeSessions !== 0) reject("RECOVERY_DATABASE_CONTAINMENT_FAILED");
    return true;
  }

  async dispatch(resource) { await this.command(resource.sql); }

  async finalizeMarker(resource) { await this.command(resource.markerSql); }

  async quarantine(context, { includeDatabase }) {
    const lines = ["BEGIN;", "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';"];
    if (includeDatabase) lines.push(`ALTER DATABASE ${quotePostgresIdentifier(context.database.name)} CONNECTION LIMIT 0;`);
    for (const role of context.snapshot.catalog.roles) lines.push(`ALTER ROLE ${quotePostgresIdentifier(role.name)} NOLOGIN;`);
    lines.push("COMMIT;");
    await this.command(`${lines.join("\n")}\n`);
  }

  async assertCompensationSafe(context) {
    const roleNames = literalList(context.plan.roles.map((role) => role.name));
    const tablespaceNames = literalList(context.tablespaces.map((resource) => resource.name));
    const databaseName = quotePostgresLiteral(context.database.name);
    const tablespaceClause = context.tablespaces.length === 0
      ? "FALSE"
      : `(d.classid='pg_tablespace'::regclass AND d.objid IN (SELECT oid FROM pg_tablespace WHERE spcname IN (${tablespaceNames})))`;
    const result = await this.query(`SELECT json_build_object(
  'unexpected_dependency_count', (SELECT count(*)::integer FROM pg_shdepend d
    JOIN pg_roles r ON d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid
    WHERE r.rolname IN (${roleNames})
      AND NOT (
        (d.classid='pg_database'::regclass AND d.objid IN (SELECT oid FROM pg_database WHERE datname=${databaseName}))
        OR ${tablespaceClause}
      )),
  'membership_count', (SELECT count(*)::integer FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE granted.rolname IN (${roleNames}) OR member.rolname IN (${roleNames}))
)::text;\n`);
    if (result.unexpected_dependency_count !== 0 || result.membership_count !== 0) reject("RECOVERY_COMPENSATION_ROLE_UNSAFE");
    return true;
  }

  async compensate(resource) {
    if (resource.kind === "DATABASE") {
      await this.command(`SET lock_timeout = '5s';\nSET statement_timeout = '120s';\nDROP DATABASE ${quotePostgresIdentifier(resource.name)};\n`);
    } else {
      await this.command(`SET lock_timeout = '5s';\nSET statement_timeout = '120s';\nDROP TABLESPACE ${quotePostgresIdentifier(resource.name)};\n`);
    }
    const inspection = await this.inspect(resource);
    if (inspection.status !== "ABSENT") reject("RECOVERY_COMPENSATION_VERIFY_FAILED");
  }

  async compensateRoles(context) {
    const names = context.plan.roles.map((role) => role.name), markerByName = new Map(context.plan.roles.map((role) => [role.name, role.recovery_marker]));
    const result = await this.query(`SELECT json_build_object(
  'rows', COALESCE((SELECT json_agg(json_build_object(
    'name', r.rolname,
    'can_login', r.rolcanlogin,
    'comment', shobj_description(r.oid, 'pg_authid'),
    'dependency_count', (SELECT count(*)::integer FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid),
    'setting_count', COALESCE(array_length(r.rolconfig, 1), 0)
  ) ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname IN (${literalList(names)})), '[]'::json),
  'membership_count', (SELECT count(*)::integer FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE granted.rolname IN (${literalList(names)}) OR member.rolname IN (${literalList(names)}))
)::text;\n`);
    if (!Array.isArray(result.rows) || result.rows.length !== names.length || result.membership_count !== 0) reject("RECOVERY_COMPENSATION_ROLE_UNSAFE");
    for (const rowInput of result.rows) {
      const row = record(rowInput, "RECOVERY_COMPENSATION_ROLE_UNSAFE");
      if (!names.includes(row.name) || row.can_login !== false || row.comment !== markerByName.get(row.name)
        || row.dependency_count !== 0 || row.setting_count !== 0) reject("RECOVERY_COMPENSATION_ROLE_UNSAFE");
    }
    await this.command(`BEGIN;\nDROP ROLE ${names.map(quotePostgresIdentifier).join(", ")};\nCOMMIT;\n`);
  }

  async assertResourcesAbsent(context) {
    if ((await this.inspect(context.database)).status !== "ABSENT") reject("RECOVERY_COMPENSATION_VERIFY_FAILED");
    for (const resource of context.tablespaces) {
      if ((await this.inspect(resource)).status !== "ABSENT") reject("RECOVERY_COMPENSATION_VERIFY_FAILED");
      await verifyTablespacePathAfterDrop({
        preflightValidation: context.tablespacePreflight,
        map: context.tablespaceMap,
        snapshot: context.snapshot,
        policy: context.policy,
        entryName: resource.name,
        targetLocationSha256: clusterSha256(resource.serverPath),
        evidenceScope: context.intent.evidence_scope,
      });
    }
    const result = await this.query(`SELECT json_build_object('role_count', count(*)::integer)::text FROM pg_roles WHERE rolname IN (${literalList(context.plan.roles.map((role) => role.name))});\n`);
    if (result.role_count !== 0) reject("RECOVERY_COMPENSATION_VERIFY_FAILED");
  }
}

export function nontransactionalRecoveryOperations({ intent, plan, snapshot, policy, tablespaceMap, tablespacePreflight, databaseProfile }) {
  const context = buildExecutionContext({ intent, plan, snapshot, policy, tablespaceMap, tablespacePreflight, databaseProfile });
  return Object.freeze([
    ...context.tablespaces.map((resource) => operationFor(resource)),
    operationFor(context.database),
  ]);
}

export function expectedRecoveryIntentBindings({ plan, snapshot, policy, tablespaceMap, databaseProfile }) {
  const validatedPolicy = validateClusterRecoveryPolicy(policy);
  const validatedSnapshot = validateClusterSnapshot(snapshot, validatedPolicy);
  const validatedMap = validateTablespaceMapDocument({ map: tablespaceMap, snapshot: validatedSnapshot, policy: validatedPolicy, evidenceScope: tablespaceMap?.evidence_scope });
  const validatedPlan = validateClusterRestorePlan(plan, { snapshot: validatedSnapshot, policy: validatedPolicy, tablespaceMap: validatedMap, databaseProfile });
  return Object.freeze({
    backup_id: validatedPlan.backup_id,
    evidence_scope: validatedMap.evidence_scope,
    policy_sha256: clusterPolicySha256(validatedPolicy),
    snapshot_sha256: validatedSnapshot.snapshot_sha256,
    credential_role_set_sha256: validatedPlan.credential_binding.role_set_sha256,
    tablespace_map_sha256: validatedPlan.tablespace_map_sha256,
    custom_tablespace_identity_sha256: Object.freeze(validatedPlan.tablespaces.map((entry) => entry.resource_identity_sha256).sort()),
  });
}

async function readExecutorJson(fileInput, { privateOperatorFile, expectedUid }) {
  if (typeof fileInput !== "string" || !path.isAbsolute(fileInput) || /[\u0000\r\n]/u.test(fileInput)) reject("RECOVERY_EXECUTOR_INPUT_FILE_UNSAFE");
  const file = path.resolve(fileInput);
  if (file !== fileInput || await realpath(file).catch(() => null) !== file) reject("RECOVERY_EXECUTOR_INPUT_FILE_UNSAFE");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("RECOVERY_EXECUTOR_INPUT_FILE_UNSAFE"));
  let source;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== expectedUid || (before.mode & 0o022) !== 0
      || (privateOperatorFile && ![0o400, 0o600].includes(before.mode & 0o777))
      || before.size <= 0 || before.size > 32 * 1024 * 1024) reject("RECOVERY_EXECUTOR_INPUT_FILE_UNSAFE");
    source = await handle.readFile("utf8");
    const after = await handle.stat(), pointed = await lstat(file).catch(() => reject("RECOVERY_EXECUTOR_INPUT_FILE_CHANGED"));
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "uid", "gid", "mode", "nlink"]) {
      if (before[key] !== after[key] || after[key] !== pointed[key]) reject("RECOVERY_EXECUTOR_INPUT_FILE_CHANGED");
    }
  } finally { await handle.close(); }
  let value;
  try { value = parseStrictJson(source); } catch { reject("RECOVERY_EXECUTOR_INPUT_JSON_INVALID"); }
  if (privateOperatorFile && source !== canonicalClusterJson(value)) reject("RECOVERY_EXECUTOR_INPUT_JSON_NOT_CANONICAL");
  return value;
}

function parseExecutorCli(argv) {
  if (!Array.isArray(argv) || argv.length < 1) reject("RECOVERY_EXECUTOR_CLI_INVALID");
  const command = argv[0];
  if (!new Set(["status", "next", "compensate"]).has(command)) reject("RECOVERY_EXECUTOR_CLI_INVALID");
  if ((argv.length - 1) % 2 !== 0) reject("RECOVERY_EXECUTOR_CLI_INVALID");
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(key) || typeof value !== "string" || value.length === 0 || /[\u0000\r\n]/u.test(value)
      || Object.hasOwn(options, key)) reject("RECOVERY_EXECUTOR_CLI_INVALID");
    options[key] = value;
  }
  const statusKeys = new Set(["--state-root", "--restore-run-id"]);
  const mutationKeys = new Set([
    ...statusKeys,
    "--plan", "--snapshot", "--policy", "--tablespace-map", "--tablespace-preflight", "--database-profile", "--psql",
    "--pg-host", "--pg-port", "--pg-user", "--confirm",
  ]);
  const expected = command === "status" ? statusKeys : mutationKeys;
  const actual = new Set(Object.keys(options));
  if (actual.size !== expected.size || [...actual].some((key) => !expected.has(key))) reject("RECOVERY_EXECUTOR_CLI_INVALID");
  return Object.freeze({ command, options: Object.freeze(options) });
}

function publicExecutionResult(result) {
  return Object.freeze({
    contract: "chenyida-erp-postgresql-recovery-executor-result/v1",
    status: result.status,
    phase: result.state.phase,
    sequence: result.state.sequence,
    state_sha256: result.state.state_sha256,
    chain_sha256: result.chainSha256,
  });
}

export async function runRecoveryExecutorCli(argv, { stdout = process.stdout } = {}) {
  const parsed = parseExecutorCli(argv), stateRoot = parsed.options["--state-root"], restoreRunId = parsed.options["--restore-run-id"];
  const execution = await readRecoveryExecution({ stateRoot, restoreRunId });
  if (parsed.command === "status") {
    const result = publicExecutionResult({ status: execution.current.phase, state: execution.current, chainSha256: execution.chain_sha256 });
    stdout.write(canonicalClusterJson(result));
    return result;
  }
  const expectedUid = execution.intent.evidence_scope === "ACTUAL_CONTROLLED" ? 0 : (process.getuid?.() ?? 0);
  const [plan, snapshot, policy, tablespaceMap, tablespacePreflight, databaseProfile] = await Promise.all([
    readExecutorJson(parsed.options["--plan"], { privateOperatorFile: true, expectedUid }),
    readExecutorJson(parsed.options["--snapshot"], { privateOperatorFile: true, expectedUid }),
    readExecutorJson(parsed.options["--policy"], { privateOperatorFile: false, expectedUid: 0 }),
    readExecutorJson(parsed.options["--tablespace-map"], { privateOperatorFile: true, expectedUid }),
    readExecutorJson(parsed.options["--tablespace-preflight"], { privateOperatorFile: true, expectedUid }),
    readExecutorJson(parsed.options["--database-profile"], { privateOperatorFile: true, expectedUid }),
  ]);
  const adapter = new PsqlClusterRecoveryAdapter({
    psqlPath: parsed.options["--psql"],
    connectionEnvironment: {
      PGHOST: parsed.options["--pg-host"],
      PGPORT: parsed.options["--pg-port"],
      PGUSER: parsed.options["--pg-user"],
    },
  });
  const input = { stateRoot, intent: execution.intent, plan, snapshot, policy, tablespaceMap, tablespacePreflight, databaseProfile, adapter, confirmation: parsed.options["--confirm"] };
  const result = parsed.command === "next"
    ? await executeNextNontransactionalRecoveryStep(input)
    : await compensateQuarantinedRecovery(input);
  const publicResult = publicExecutionResult(result);
  stdout.write(canonicalClusterJson(publicResult));
  return publicResult;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRecoveryExecutorCli(process.argv.slice(2)).catch((error) => {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,120}$/u.test(error.code) ? error.code : "RECOVERY_EXECUTOR_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
