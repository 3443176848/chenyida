import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import {
  transitionRuntimePrivilegeOperatorState,
  validateRuntimePrivilegeOperatorIntent,
  validateRuntimePrivilegeOperatorPlan,
  validateRuntimePrivilegeOperatorPrivateRoot,
  validateRuntimePrivilegeOperatorReceipt,
  validateRuntimePrivilegeOperatorState,
} from "./postgresql-runtime-privilege-operator.mjs";
import {
  validateRuntimePrivilegeState,
} from "./postgresql-runtime-privilege-reconciler.mjs";

export const RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER = ".chenyida-erp-postgresql-runtime-privilege-operator-v1";
export const RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER_VALUE = "chenyida-erp-postgresql-runtime-privilege-operator/v1\n";
export const RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER = ".chenyida-erp-postgresql-runtime-privilege-intent-v1";
export const RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER_VALUE = "chenyida-erp-postgresql-runtime-privilege-intent/v1\n";

const ROOT_DIRECTORIES = Object.freeze(["active", "completed", "preparing", "quarantine", "receipts"]);
const BLOCKING_DIRECTORIES = Object.freeze(["active", "preparing", "quarantine"]);
const OPERATION_FILES = Object.freeze([
  RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER,
  "baseline-state.json",
  "baseline-structure.report",
  "intent.json",
  "plan.json",
  "recovery-authorizations",
  "states",
]);
const POSTCOMMIT_FILES = Object.freeze(["final-state.json", "final-structure.report"]);
const VERIFICATION_FILES = Object.freeze(["credential-proof.json"]);
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const OPERATION_DIRECTORY = /^([A-Za-z0-9][A-Za-z0-9._-]{0,119})\.([0-9a-f]{64})$/;
const STATE_FILE = /^(\d{6})\.([A-Z_]+)\.([0-9a-f]{64})\.json$/;
const RECOVERY_AUTHORIZATION_FILE = /^(\d{6})\.([0-9a-f]{64})\.json$/;
const PENDING_WRITE_FILE = /^\.cyd-write-([0-9a-f]{64})\.pending$/;
const RECOVERY_DECISIONS = Object.freeze([
  "ARCHIVE_COMMITTED",
  "CAPTURE_AND_VERIFY",
  "DISPATCH_TRANSACTION",
  "FINISH_PUBLICATION",
  "QUARANTINE",
  "RESUME_AUTHORIZATION",
  "RETRY_TRANSACTION",
]);
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 10_000;
const JOURNAL_BINDINGS = new WeakMap();

export class RuntimePrivilegeOperatorJournalError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegeOperatorJournalError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegeOperatorJournalError(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mode(metadata) {
  return metadata.mode & 0o7777;
}

async function fsyncDirectory(directory, code) {
  let handle;
  try { handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
  catch { reject(code); }
  try { await handle.sync(); }
  catch { reject(code); }
  finally { await handle.close(); }
}

async function trustedDirectory(directory, uid, expectedMode, code) {
  const absolute = path.resolve(directory);
  const resolved = await realpath(absolute).catch(() => null);
  const metadata = await lstat(absolute).catch(() => null);
  if (resolved !== absolute || !metadata?.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== uid
    || metadata.nlink < 2 || mode(metadata) !== expectedMode) reject(code);
  return { absolute, identity: `${metadata.dev}:${metadata.ino}` };
}

async function stableFile(file, uid, expectedMode, maximum, code) {
  const absolute = path.resolve(file);
  let handle;
  try { handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject(code); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== uid || before.gid !== uid || before.nlink !== 1 || mode(before) !== expectedMode
      || before.size < 1 || before.size > maximum) reject(code);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pointed = await lstat(absolute).catch(() => null);
    if (!pointed || pointed.isSymbolicLink()) reject(code);
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "uid", "gid", "mode", "nlink"]) {
      if (before[key] !== after[key] || after[key] !== pointed[key]) reject(code);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function canonicalJson(bytes, code) {
  let value;
  try { value = parseStrictJson(bytes.toString("utf8"), MAX_JSON_BYTES); }
  catch { reject(code); }
  if (!bytes.equals(Buffer.from(canonicalClusterJson(value), "utf8"))) reject(code);
  return value;
}

async function writeExclusiveFile(file, bytes, uid, code) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  const pending = path.join(path.dirname(file), `.cyd-write-${sha256(input)}.pending`);
  let handle;
  let renamed = false;
  try { handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400); }
  catch { reject(code); }
  try {
    await handle.chmod(0o400);
    if (process.getuid?.() === 0) await handle.chown(uid, uid);
    let offset = 0;
    while (offset < input.length) {
      const result = await handle.write(input, offset, input.length - offset, offset);
      if (!result || result.bytesWritten < 1) reject(code);
      offset += result.bytesWritten;
    }
    await handle.sync();
    await handle.close();
    handle = null;
    const existing = await lstat(file).catch((error) => {
      if (error?.code === "ENOENT") return null;
      reject(code);
    });
    if (existing !== null) reject(code);
    await rename(pending, file);
    renamed = true;
    await fsyncDirectory(path.dirname(file), code);
  } catch {
    reject(code);
  } finally {
    if (handle) {
      try { await handle.close(); }
      catch { reject(code); }
    }
    if (!renamed) await unlink(pending).catch((error) => {
      if (error?.code !== "ENOENT") reject(code);
    });
  }
}

async function cleanupPendingWrites(directory, uid, code) {
  let changed = false;
  for (const entry of await entries(directory, code)) {
    if (!entry.startsWith(".cyd-write-")) continue;
    if (!PENDING_WRITE_FILE.test(entry)) reject(code);
    const file = path.join(directory, entry);
    const metadata = await lstat(file).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== uid
      || metadata.nlink !== 1 || mode(metadata) !== 0o400 || metadata.size > MAX_REPORT_BYTES) reject(code);
    try { await unlink(file); }
    catch { reject(code); }
    changed = true;
  }
  if (changed) await fsyncDirectory(directory, code);
}

async function entries(directory, code) {
  let values;
  try { values = await readdir(directory); }
  catch { reject(code); }
  if (values.length > MAX_DIRECTORY_ENTRIES || new Set(values).size !== values.length) reject(code);
  return values.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

async function validateOperationDirectoryEntry(directory, uid, code) {
  if (!OPERATION_DIRECTORY.test(path.basename(directory))) reject(code);
  await trustedDirectory(directory, uid, 0o700, code);
}

export async function validateRuntimePrivilegeOperatorJournalRoot({ stateRoot, evidenceScope = "ACTUAL_CONTROLLED" }) {
  const root = await validateRuntimePrivilegeOperatorPrivateRoot({
    root: stateRoot,
    markerName: RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER,
    markerValue: RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER_VALUE,
    evidenceScope,
    code: "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ROOT_UNSAFE",
  });
  const rootEntries = await entries(root.root, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ROOT_UNSAFE");
  const expected = [RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER, ...ROOT_DIRECTORIES]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (canonicalClusterJson(rootEntries) !== canonicalClusterJson(expected)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ROOT_UNSAFE");
  for (const name of ROOT_DIRECTORIES) await trustedDirectory(path.join(root.root, name), root.uid, 0o700, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ROOT_UNSAFE");
  await cleanupPendingWrites(path.join(root.root, "receipts"), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  for (const name of ["active", "completed", "preparing", "quarantine"]) {
    for (const entry of await entries(path.join(root.root, name), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID")) {
      await validateOperationDirectoryEntry(path.join(root.root, name, entry), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
    }
  }
  for (const entry of await entries(path.join(root.root, "receipts"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID")) {
    if (!/^([A-Za-z0-9][A-Za-z0-9._-]{0,119})\.([0-9a-f]{64})\.json$/.test(entry)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
    await stableFile(path.join(root.root, "receipts", entry), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  }
  return Object.freeze({ ...root, evidenceScope });
}

export async function assertNoRuntimePrivilegeOperatorInterlock(options) {
  const root = await validateRuntimePrivilegeOperatorJournalRoot(options);
  for (const name of BLOCKING_DIRECTORIES) {
    if ((await entries(path.join(root.root, name), "RUNTIME_PRIVILEGE_OPERATOR_INTERLOCK_INVALID")).length !== 0) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_REQUIRED");
    }
  }
  return root;
}

function validateReportBytes(bytes, expectedSha256, code) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_REPORT_BYTES || bytes.at(-1) !== 0x0a
    || bytes.includes(0x00) || bytes.includes(0x0d) || !SHA256.test(expectedSha256) || sha256(bytes) !== expectedSha256) reject(code);
}

function validatePreparedInputs({ intent: intentInput, initialState: stateInput, baseline, baselineStructure, plan, sources, operation }) {
  const intent = validateRuntimePrivilegeOperatorIntent(intentInput);
  const state = validateRuntimePrivilegeOperatorState(stateInput, intent);
  if (state.sequence !== 0 || state.phase !== "PREPARED" || !["BOOTSTRAP", "RECONCILE"].includes(operation) || intent.operation !== operation) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_INVALID");
  }
  let validatedBaseline;
  let validatedPlan;
  try {
    validatedBaseline = validateRuntimePrivilegeState(baseline, { ...sources, mode: "controlled", expectedTarget: intent.target });
    validatedPlan = validateRuntimePrivilegeOperatorPlan(plan, { baseline: validatedBaseline, sources, operation });
  } catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"); }
  validateReportBytes(baselineStructure, intent.baseline_structure_sha256, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  if (clusterSha256(validatedBaseline) !== intent.baseline_state_sha256 || validatedPlan.plan_sha256 !== intent.plan_sha256
    || validatedPlan.desired_state_sha256 !== intent.desired_state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  return { intent, state, baseline: validatedBaseline, plan: validatedPlan };
}

function operationDirectoryName(intent) {
  if (!IDENTIFIER.test(intent.operation_id) || !SHA256.test(intent.intent_sha256)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_INTENT_INVALID");
  return `${intent.operation_id}.${intent.intent_sha256}`;
}

async function createDirectory(directory, uid, code) {
  try { await mkdir(directory, { mode: 0o700 }); }
  catch { reject(code); }
  if (process.getuid?.() === 0) {
    let handle;
    try {
      handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await handle.chown(uid, uid);
      await handle.chmod(0o700);
      await handle.sync();
    } catch { reject(code); }
    finally { await handle?.close(); }
  }
  await fsyncDirectory(path.dirname(directory), code);
  return trustedDirectory(directory, uid, 0o700, code);
}

function stateFilename(state) {
  return `${String(state.sequence).padStart(6, "0")}.${state.phase}.${state.state_sha256}.json`;
}

function bindJournal(publicBinding, privateBinding) {
  JOURNAL_BINDINGS.set(publicBinding, privateBinding);
  return publicBinding;
}

export async function prepareRuntimePrivilegeOperatorJournal({
  stateRoot,
  evidenceScope = "ACTUAL_CONTROLLED",
  intent: intentInput,
  initialState: stateInput,
  baseline,
  baselineStructure,
  plan,
  sources,
  operation,
}) {
  const validated = validatePreparedInputs({ intent: intentInput, initialState: stateInput, baseline, baselineStructure, plan, sources, operation });
  const directoryName = operationDirectoryName(validated.intent);
  let root = await validateRuntimePrivilegeOperatorJournalRoot({ stateRoot, evidenceScope });
  const activeEntries = await entries(path.join(root.root, "active"), "RUNTIME_PRIVILEGE_OPERATOR_INTERLOCK_INVALID");
  const preparingEntries = await entries(path.join(root.root, "preparing"), "RUNTIME_PRIVILEGE_OPERATOR_INTERLOCK_INVALID");
  const quarantineEntries = await entries(path.join(root.root, "quarantine"), "RUNTIME_PRIVILEGE_OPERATOR_INTERLOCK_INVALID");
  const interruptedOperation = preparingEntries.length === 1
    && OPERATION_DIRECTORY.test(preparingEntries[0])
    && preparingEntries[0].startsWith(`${validated.intent.operation_id}.`);
  if (activeEntries.length === 0 && quarantineEntries.length === 0 && interruptedOperation) {
    const partial = path.join(root.root, "preparing", preparingEntries[0]);
    await validateOperationDirectoryEntry(partial, root.uid, "RUNTIME_PRIVILEGE_OPERATOR_PARTIAL_PREPARATION_INVALID");
    try { await rm(partial, { recursive: true, force: false, maxRetries: 0 }); }
    catch { reject("RUNTIME_PRIVILEGE_OPERATOR_PARTIAL_PREPARATION_RECOVERY_FAILED"); }
    await fsyncDirectory(path.join(root.root, "preparing"), "RUNTIME_PRIVILEGE_OPERATOR_PARTIAL_PREPARATION_RECOVERY_FAILED");
  }
  root = await assertNoRuntimePrivilegeOperatorInterlock({ stateRoot, evidenceScope });
  const preparing = path.join(root.root, "preparing", directoryName);
  const active = path.join(root.root, "active", directoryName);
  await createDirectory(preparing, root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await createDirectory(path.join(preparing, "states"), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await createDirectory(path.join(preparing, "recovery-authorizations"), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await writeExclusiveFile(path.join(preparing, RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER), RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER_VALUE, root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await writeExclusiveFile(path.join(preparing, "intent.json"), canonicalClusterJson(validated.intent), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await writeExclusiveFile(path.join(preparing, "baseline-state.json"), canonicalClusterJson(validated.baseline), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await writeExclusiveFile(path.join(preparing, "baseline-structure.report"), baselineStructure, root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await writeExclusiveFile(path.join(preparing, "plan.json"), canonicalClusterJson(validated.plan), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await writeExclusiveFile(path.join(preparing, "states", stateFilename(validated.state)), canonicalClusterJson(validated.state), root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await fsyncDirectory(preparing, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  try { await rename(preparing, active); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED"); }
  await fsyncDirectory(path.join(root.root, "preparing"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  await fsyncDirectory(path.join(root.root, "active"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_PREPARE_FAILED");
  const publicBinding = Object.freeze({ operationId: validated.intent.operation_id, intentSha256: validated.intent.intent_sha256, phase: "PREPARED" });
  return bindJournal(publicBinding, {
    root, directory: active, directoryName, intent: validated.intent, state: validated.state, baseline: validated.baseline,
    plan: validated.plan, sources, operation, location: "active", recoveryAuthorizations: [], finalState: null,
    finalStructure: null, proof: null, receipt: null,
  });
}

async function loadStates(directory, uid, intent) {
  const stateDirectory = path.join(directory, "states");
  await trustedDirectory(stateDirectory, uid, 0o700, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
  await cleanupPendingWrites(stateDirectory, uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
  const names = await entries(stateDirectory, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
  if (names.length < 1) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
  const states = [];
  for (let index = 0; index < names.length; index += 1) {
    const matched = names[index].match(STATE_FILE);
    if (!matched || Number(matched[1]) !== index) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
    const bytes = await stableFile(path.join(stateDirectory, names[index]), uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
    const state = validateRuntimePrivilegeOperatorState(canonicalJson(bytes, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID"), intent);
    if (names[index] !== stateFilename(state) || (index === 0 ? state.previous_state_sha256 !== null : state.previous_state_sha256 !== states[index - 1].state_sha256)) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_INVALID");
    }
    states.push(state);
  }
  return states;
}

function validateRecoveryAuthorizationRecord(value, intent, sequence) {
  const fields = [
    "schema_version", "contract", "operation_id", "intent_sha256", "sequence", "authorization_id",
    "authorization_sha256", "runtime_probe_binding_sha256", "observed_state_sha256", "decision", "recorded_at",
    "record_sha256",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("|") !== fields.sort().join("|")
    || value.schema_version !== 1
    || value.contract !== "chenyida-erp-postgresql-runtime-privilege-recovery-authorization/v1"
    || value.operation_id !== intent.operation_id || value.intent_sha256 !== intent.intent_sha256
    || value.sequence !== sequence || !IDENTIFIER.test(value.authorization_id)
    || !SHA256.test(value.authorization_sha256) || !SHA256.test(value.runtime_probe_binding_sha256)
    || !SHA256.test(value.observed_state_sha256) || !RECOVERY_DECISIONS.includes(value.decision)
    || typeof value.recorded_at !== "string" || !Number.isFinite(Date.parse(value.recorded_at))) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
  }
  const { record_sha256: ignored, ...body } = value;
  void ignored;
  if (!SHA256.test(value.record_sha256) || clusterSha256(body) !== value.record_sha256) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
  }
  return value;
}

async function loadRecoveryAuthorizations(directory, uid, intent) {
  const authorizationDirectory = path.join(directory, "recovery-authorizations");
  await trustedDirectory(authorizationDirectory, uid, 0o700, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  await cleanupPendingWrites(authorizationDirectory, uid, "RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
  const names = await entries(authorizationDirectory, "RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
  const records = [];
  for (let index = 0; index < names.length; index += 1) {
    const matched = names[index].match(RECOVERY_AUTHORIZATION_FILE);
    if (!matched || Number(matched[1]) !== index) reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
    const record = validateRecoveryAuthorizationRecord(canonicalJson(
      await stableFile(path.join(authorizationDirectory, names[index]), uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID"),
      "RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID",
    ), intent, index);
    if (names[index] !== `${String(index).padStart(6, "0")}.${record.record_sha256}.json`
      || records.some((item) => item.authorization_id === record.authorization_id || item.authorization_sha256 === record.authorization_sha256)) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
    }
    records.push(record);
  }
  return records;
}

export async function loadRuntimePrivilegeOperatorJournal({ stateRoot, evidenceScope = "ACTUAL_CONTROLLED", operationId, sources, location = "active" }) {
  if (!IDENTIFIER.test(operationId) || !["active", "completed", "quarantine"].includes(location)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_LOOKUP_INVALID");
  const root = await validateRuntimePrivilegeOperatorJournalRoot({ stateRoot, evidenceScope });
  const matches = (await entries(path.join(root.root, location), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_LOOKUP_INVALID"))
    .filter((name) => name.startsWith(`${operationId}.`));
  if (matches.length !== 1 || !OPERATION_DIRECTORY.test(matches[0])) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_LOOKUP_INVALID");
  const directoryName = matches[0];
  const directory = path.join(root.root, location, directoryName);
  await trustedDirectory(directory, root.uid, 0o700, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  await cleanupPendingWrites(directory, root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  const operationEntries = await entries(directory, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  const allowed = [...OPERATION_FILES, ...POSTCOMMIT_FILES, ...VERIFICATION_FILES, "receipt.json"];
  const extras = operationEntries.filter((name) => !allowed.includes(name));
  if (extras.length !== 0 || OPERATION_FILES.some((name) => !operationEntries.includes(name))) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  const marker = await stableFile(path.join(directory, RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER), root.uid, 0o400, 256, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  if (!marker.equals(Buffer.from(RUNTIME_PRIVILEGE_OPERATOR_INTENT_MARKER_VALUE, "utf8"))) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  const intent = validateRuntimePrivilegeOperatorIntent(canonicalJson(await stableFile(path.join(directory, "intent.json"), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID"));
  if (directoryName !== operationDirectoryName(intent)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ENTRY_INVALID");
  const baseline = canonicalJson(await stableFile(path.join(directory, "baseline-state.json"), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  const plan = canonicalJson(await stableFile(path.join(directory, "plan.json"), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  const structure = await stableFile(path.join(directory, "baseline-structure.report"), root.uid, 0o400, MAX_REPORT_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  const states = await loadStates(directory, root.uid, intent);
  validatePreparedInputs({ intent, initialState: states[0], baseline, baselineStructure: structure, plan, sources, operation: intent.operation });
  const recoveryAuthorizations = await loadRecoveryAuthorizations(directory, root.uid, intent);
  const hasFinalState = operationEntries.includes("final-state.json");
  const hasFinalStructure = operationEntries.includes("final-structure.report");
  const hasPostcommit = hasFinalState && hasFinalStructure;
  const hasPartialPostcommit = hasFinalState !== hasFinalStructure;
  const hasProof = operationEntries.includes("credential-proof.json");
  if ((hasPartialPostcommit && states.at(-1).phase !== "TRANSACTION_DISPATCHED") || (hasProof && !hasPostcommit)
    || (["POSTCOMMIT_CAPTURED", "VERIFIED", "COMMITTED"].includes(states.at(-1).phase) && !hasPostcommit)
    || (["VERIFIED", "COMMITTED"].includes(states.at(-1).phase) && !hasProof)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  let finalState = null;
  let finalStructure = null;
  let proof = null;
  let receipt = null;
  if (hasFinalState) {
    finalState = canonicalJson(await stableFile(path.join(directory, "final-state.json"), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    try { validateRuntimePrivilegeState(finalState, { ...sources, mode: "final", expectedTarget: intent.target, expectedFinal: plan.desired }); }
    catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"); }
    if (clusterSha256(finalState) !== intent.desired_state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  }
  if (hasFinalStructure) {
    finalStructure = await stableFile(path.join(directory, "final-structure.report"), root.uid, 0o400, MAX_REPORT_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    if (finalStructure.length < 2 || finalStructure.at(-1) !== 0x0a || finalStructure.includes(0x00) || finalStructure.includes(0x0d)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  }
  if (hasProof) {
    proof = canonicalJson(await stableFile(path.join(directory, "credential-proof.json"), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    if (!proof || typeof proof !== "object" || !SHA256.test(proof.proof_sha256)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    const { proof_sha256: ignored, ...body } = proof;
    void ignored;
    if (clusterSha256(body) !== proof.proof_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
  }
  if (operationEntries.includes("receipt.json")) {
    const receiptState = states.at(-1).phase === "COMMITTED"
      ? states.at(-1)
      : states.at(-1).phase === "QUARANTINED" && states.at(-2)?.phase === "COMMITTED"
        ? states.at(-2)
        : null;
    if (receiptState === null || finalStructure === null || proof === null) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    }
    receipt = canonicalJson(await stableFile(path.join(directory, "receipt.json"), root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    try { validateRuntimePrivilegeOperatorReceipt(receipt, intent, receiptState); }
    catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID"); }
    if (receipt.final_structure_sha256 !== sha256(finalStructure) || receipt.credential_verification_sha256 !== proof.proof_sha256) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_EVIDENCE_INVALID");
    }
  }
  const publicBinding = Object.freeze({ operationId: intent.operation_id, intentSha256: intent.intent_sha256, phase: states.at(-1).phase });
  return bindJournal(publicBinding, {
    root, directory, directoryName, intent, state: states.at(-1), baseline, plan, sources, operation: intent.operation, location,
    recoveryAuthorizations, finalState, finalStructure, proof, receipt,
  });
}

function privateJournal(binding) {
  const value = JOURNAL_BINDINGS.get(binding);
  if (!value) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_BINDING_INVALID");
  return value;
}

export function runtimePrivilegeOperatorJournalSnapshot(binding) {
  const value = privateJournal(binding);
  return Object.freeze({ intent: value.intent, state: value.state, baseline: value.baseline, plan: value.plan, location: value.location || "active" });
}

export function runtimePrivilegeOperatorRecoveryAuthorizations(binding) {
  const value = privateJournal(binding);
  return Object.freeze(value.recoveryAuthorizations.map((record) => Object.freeze(structuredClone(record))));
}

export function runtimePrivilegeOperatorJournalEvidence(binding) {
  const value = privateJournal(binding);
  return Object.freeze({
    finalState: value.finalState === null ? null : structuredClone(value.finalState),
    finalStructure: value.finalStructure === null ? null : Buffer.from(value.finalStructure),
    proof: value.proof === null ? null : structuredClone(value.proof),
    receipt: value.receipt === null ? null : structuredClone(value.receipt),
  });
}

export async function appendRuntimePrivilegeOperatorJournalState(binding, phase, recordedAt, observationStateSha256 = null) {
  const value = privateJournal(binding);
  if ((value.location || "active") !== "active") reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_NOT_ACTIVE");
  const next = transitionRuntimePrivilegeOperatorState(value.state, value.intent, phase, recordedAt, observationStateSha256);
  await writeExclusiveFile(path.join(value.directory, "states", stateFilename(next)), canonicalClusterJson(next), value.root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_STATE_WRITE_FAILED");
  value.state = next;
  return next;
}

export async function appendRuntimePrivilegeOperatorRecoveryAuthorization(binding, recordInput) {
  const value = privateJournal(binding);
  const required = [
    "authorization_id", "authorization_sha256", "runtime_probe_binding_sha256", "observed_state_sha256", "decision", "recorded_at",
  ];
  if (!recordInput || typeof recordInput !== "object" || Array.isArray(recordInput) || Object.keys(recordInput).sort().join("|") !== required.sort().join("|")
    || !IDENTIFIER.test(recordInput.authorization_id) || !SHA256.test(recordInput.authorization_sha256)
    || !SHA256.test(recordInput.runtime_probe_binding_sha256) || !SHA256.test(recordInput.observed_state_sha256)
    || !RECOVERY_DECISIONS.includes(recordInput.decision)
    || typeof recordInput.recorded_at !== "string" || !Number.isFinite(Date.parse(recordInput.recorded_at))) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
  }
  const duplicate = value.recoveryAuthorizations.find((record) => record.authorization_id === recordInput.authorization_id
    || record.authorization_sha256 === recordInput.authorization_sha256);
  if (duplicate) {
    const comparable = {
      authorization_id: duplicate.authorization_id,
      authorization_sha256: duplicate.authorization_sha256,
      runtime_probe_binding_sha256: duplicate.runtime_probe_binding_sha256,
      observed_state_sha256: duplicate.observed_state_sha256,
      decision: duplicate.decision,
    };
    const { recorded_at: ignoredRecordedAt, ...inputComparable } = recordInput;
    void ignoredRecordedAt;
    if (canonicalClusterJson(comparable) !== canonicalClusterJson(inputComparable)) reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_INVALID");
    return duplicate;
  }
  const directory = path.join(value.directory, "recovery-authorizations");
  const sequence = value.recoveryAuthorizations.length;
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-postgresql-runtime-privilege-recovery-authorization/v1",
    operation_id: value.intent.operation_id,
    intent_sha256: value.intent.intent_sha256,
    sequence,
    ...recordInput,
  };
  const record = Object.freeze({ ...body, record_sha256: clusterSha256(body) });
  await writeExclusiveFile(path.join(directory, `${String(sequence).padStart(6, "0")}.${record.record_sha256}.json`), canonicalClusterJson(record), value.root.uid, "RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_AUTHORIZATION_WRITE_FAILED");
  value.recoveryAuthorizations.push(record);
  return record;
}

async function writeOrValidateFile(file, expected, uid, maximum, code) {
  try { await writeExclusiveFile(file, expected, uid, code); }
  catch (error) {
    if (!(error instanceof RuntimePrivilegeOperatorJournalError) || error.code !== code) throw error;
    const actual = await stableFile(file, uid, 0o400, maximum, code);
    if (!actual.equals(expected)) reject(code);
  }
}

export async function persistRuntimePrivilegeOperatorPostcommitCapture(binding, finalStateInput, finalStructure) {
  const value = privateJournal(binding);
  if ((value.location || "active") !== "active" || value.state.phase !== "TRANSACTION_DISPATCHED") reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_POSTCOMMIT_INVALID");
  let finalState;
  try {
    finalState = validateRuntimePrivilegeState(finalStateInput, {
      ...value.sources,
      mode: "final",
      expectedTarget: value.intent.target,
      expectedFinal: value.plan.desired,
    });
  } catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_POSTCOMMIT_INVALID"); }
  if (clusterSha256(finalState) !== value.intent.desired_state_sha256 || !Buffer.isBuffer(finalStructure)
    || finalStructure.length < 2 || finalStructure.length > MAX_REPORT_BYTES || finalStructure.at(-1) !== 0x0a
    || finalStructure.includes(0x00) || finalStructure.includes(0x0d)) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_POSTCOMMIT_INVALID");
  await writeOrValidateFile(
    path.join(value.directory, "final-state.json"),
    Buffer.from(canonicalClusterJson(finalState), "utf8"),
    value.root.uid,
    MAX_JSON_BYTES,
    "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_POSTCOMMIT_WRITE_FAILED",
  );
  await writeOrValidateFile(
    path.join(value.directory, "final-structure.report"),
    finalStructure,
    value.root.uid,
    MAX_REPORT_BYTES,
    "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_POSTCOMMIT_WRITE_FAILED",
  );
  value.finalState = finalState;
  value.finalStructure = Buffer.from(finalStructure);
  return Object.freeze({ final_state_sha256: value.intent.desired_state_sha256, final_structure_sha256: sha256(finalStructure) });
}

export async function persistRuntimePrivilegeOperatorCredentialProof(binding, proof) {
  const value = privateJournal(binding);
  if ((value.location || "active") !== "active" || value.state.phase !== "POSTCOMMIT_CAPTURED"
    || !proof || typeof proof !== "object" || Array.isArray(proof) || !SHA256.test(proof.proof_sha256)) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_CREDENTIAL_PROOF_INVALID");
  }
  const { proof_sha256: ignored, ...body } = proof;
  void ignored;
  if (clusterSha256(body) !== proof.proof_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_CREDENTIAL_PROOF_INVALID");
  await writeExclusiveFile(path.join(value.directory, "credential-proof.json"), canonicalClusterJson(proof), value.root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_CREDENTIAL_PROOF_WRITE_FAILED");
  value.proof = structuredClone(proof);
  return proof;
}

async function writeOrValidateReceipt(file, receipt, uid, code) {
  const expected = Buffer.from(canonicalClusterJson(receipt), "utf8");
  await writeOrValidateFile(file, expected, uid, MAX_JSON_BYTES, code);
}

export async function archiveCommittedRuntimePrivilegeOperatorJournal(binding, receiptInput) {
  const value = privateJournal(binding);
  if (value.state.phase !== "COMMITTED" || (value.location || "active") !== "active") reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_COMMIT_INVALID");
  const receipt = validateRuntimePrivilegeOperatorReceipt(receiptInput, value.intent, value.state);
  const finalStructure = await stableFile(path.join(value.directory, "final-structure.report"), value.root.uid, 0o400, MAX_REPORT_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_COMMIT_INVALID");
  const proof = canonicalJson(await stableFile(path.join(value.directory, "credential-proof.json"), value.root.uid, 0o400, MAX_JSON_BYTES, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_COMMIT_INVALID"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_COMMIT_INVALID");
  if (sha256(finalStructure) !== receipt.final_structure_sha256 || proof.proof_sha256 !== receipt.credential_verification_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_COMMIT_INVALID");
  await writeOrValidateReceipt(path.join(value.directory, "receipt.json"), receipt, value.root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_RECEIPT_WRITE_FAILED");
  value.receipt = structuredClone(receipt);
  const receiptFile = path.join(value.root.root, "receipts", `${value.intent.operation_id}.${receipt.receipt_sha256}.json`);
  await writeOrValidateReceipt(receiptFile, receipt, value.root.uid, "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_RECEIPT_WRITE_FAILED");
  const completed = path.join(value.root.root, "completed", value.directoryName);
  try { await rename(value.directory, completed); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ARCHIVE_FAILED"); }
  await fsyncDirectory(path.join(value.root.root, "active"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ARCHIVE_FAILED");
  await fsyncDirectory(path.join(value.root.root, "completed"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_ARCHIVE_FAILED");
  value.directory = completed;
  value.location = "completed";
  return receipt;
}

export async function quarantineRuntimePrivilegeOperatorJournal(binding, recordedAt, observationStateSha256 = null) {
  const value = privateJournal(binding);
  if ((value.location || "active") !== "active") reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_NOT_ACTIVE");
  const state = await appendRuntimePrivilegeOperatorJournalState(binding, "QUARANTINED", recordedAt, observationStateSha256);
  const quarantined = path.join(value.root.root, "quarantine", value.directoryName);
  try { await rename(value.directory, quarantined); }
  catch { reject("RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_QUARANTINE_FAILED"); }
  await fsyncDirectory(path.join(value.root.root, "active"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_QUARANTINE_FAILED");
  await fsyncDirectory(path.join(value.root.root, "quarantine"), "RUNTIME_PRIVILEGE_OPERATOR_JOURNAL_QUARANTINE_FAILED");
  value.directory = quarantined;
  value.location = "quarantine";
  return state;
}
