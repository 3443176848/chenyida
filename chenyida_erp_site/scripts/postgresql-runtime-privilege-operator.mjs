import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { validateRuntimePrivilegeCompiledCatalog } from "./postgresql-runtime-privilege-catalog.mjs";
import { validateRuntimePrivilegePolicy } from "./postgresql-runtime-privilege-policy.mjs";
import {
  RUNTIME_PRIVILEGE_RECONCILIATION_PLAN_CONTRACT,
  createControlledRuntimePrivilegeBootstrapPlan,
  createRuntimePrivilegeReconciliationPlan,
  validateRuntimePrivilegeState,
} from "./postgresql-runtime-privilege-reconciler.mjs";
import { validateRuntimePrivilegeAccessDocument } from "./postgresql-runtime-privilege-source.mjs";

export const RUNTIME_PRIVILEGE_OPERATOR_POLICY_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-operator-policy/v1";
export const RUNTIME_PRIVILEGE_OPERATOR_POLICY_PATH = "operations/postgresql-runtime-privilege-operator-policy-v1.json";
export const RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-consumer-credentials/v1";
export const RUNTIME_PRIVILEGE_OPERATOR_INTENT_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-operator-intent/v1";
export const RUNTIME_PRIVILEGE_OPERATOR_STATE_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-operator-state/v1";
export const RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-operator-receipt/v1";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const POLICY_SOURCE_PATHS = Object.freeze([
  "operations/postgresql-runtime-privilege-access-v2.json",
  "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
  "operations/postgresql-runtime-privilege-policy-v2.json",
  "operations/runtime-secret-file-policy-v1.json",
  "scripts/postgresql-runtime-privilege-catalog.sql",
  "scripts/postgresql-runtime-privilege-interlock.sh",
  "scripts/postgresql-runtime-privilege-journal.mjs",
  "scripts/postgresql-runtime-privilege-operator.mjs",
  "scripts/postgresql-runtime-privilege-reconciler.mjs",
  "scripts/postgresql-runtime-privilege-runner.mjs",
  "scripts/postgresql-runtime-privilege-state.sql",
]);
const LOGIN_ROLES = Object.freeze([
  "chenyida_erp_admin",
  "chenyida_erp_backup",
  "chenyida_erp_owner",
  "chenyida_erp_web",
  "chenyida_erp_worker",
]);
export const RUNTIME_PRIVILEGE_OPERATOR_LOGIN_ROLES = LOGIN_ROLES;
const OPERATIONS = Object.freeze(["BOOTSTRAP", "RECONCILE", "RECOVER"]);
const CONFIRMATIONS = Object.freeze({
  BOOTSTRAP: "AUTHORIZE_BOOTSTRAP_EXACT_POSTGRESQL_RUNTIME_PRIVILEGES",
  RECONCILE: "AUTHORIZE_RECONCILE_EXACT_POSTGRESQL_RUNTIME_PRIVILEGES",
  RECOVER: "AUTHORIZE_RECOVER_EXACT_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT",
});
const PHASES = Object.freeze([
  "PREPARED",
  "AUTHORIZATION_CONSUMED",
  "TRANSACTION_DISPATCHED",
  "POSTCOMMIT_CAPTURED",
  "VERIFIED",
  "COMMITTED",
  "QUARANTINED",
]);
const TRANSITIONS = Object.freeze({
  PREPARED: Object.freeze(["AUTHORIZATION_CONSUMED", "QUARANTINED"]),
  AUTHORIZATION_CONSUMED: Object.freeze(["TRANSACTION_DISPATCHED", "QUARANTINED"]),
  TRANSACTION_DISPATCHED: Object.freeze(["POSTCOMMIT_CAPTURED", "QUARANTINED"]),
  POSTCOMMIT_CAPTURED: Object.freeze(["VERIFIED", "QUARANTINED"]),
  VERIFIED: Object.freeze(["COMMITTED", "QUARANTINED"]),
  COMMITTED: Object.freeze(["QUARANTINED"]),
  QUARANTINED: Object.freeze([]),
});
const MAX_POLICY_BYTES = 2 * 1024 * 1024;
const MAX_SECRET_BYTES = 44;
const MAX_SERVICE_BYTES = 16 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const OID = /^[1-9][0-9]{0,9}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_FINAL = new Set("AEIMQUYcgkosw048");
const PLAN_LOCK = "SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint)";
const SECRET_BINDINGS = new WeakMap();
const RUNTIME_SECRET_SOURCES = Object.freeze([
  Object.freeze({ id: "ADMIN_DATABASE_PASSWORD", role: "chenyida_erp_admin", name: "admin-database-password", gid: 65532 }),
  Object.freeze({ id: "ADMIN_PASSWORD", role: null, name: "admin-password", gid: 65532 }),
  Object.freeze({ id: "MIGRATION_DATABASE_PASSWORD", role: "chenyida_erp_owner", name: "migration-database-password", gid: 0 }),
  Object.freeze({ id: "POSTGRES_BOOTSTRAP_PASSWORD", role: null, name: "postgres-bootstrap-password", gid: 999 }),
  Object.freeze({ id: "WEB_DATABASE_PASSWORD", role: "chenyida_erp_web", name: "web-database-password", gid: 65532 }),
  Object.freeze({ id: "WORKER_DATABASE_PASSWORD", role: "chenyida_erp_worker", name: "worker-database-password", gid: 65532 }),
]);

export class RuntimePrivilegeOperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegeOperatorError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegeOperatorError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
  return value;
}

function exact(left, right, code) {
  if (canonicalClusterJson(left) !== canonicalClusterJson(right)) reject(code);
}

function string(value, pattern, code) {
  if (typeof value !== "string" || !value || value !== value.normalize("NFC") || value.includes("\u0000") || (pattern && !pattern.test(value))) reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function iso(value, code) {
  string(value, ISO_UTC, code);
  if (!Number.isFinite(Date.parse(value))) reject(code);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readStableFile(file, { maximum = MAX_POLICY_BYTES, uid = null, gid = null, modes = null, code }) {
  const absolute = path.resolve(file);
  let handle;
  try { handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject(code); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maximum
      || (uid !== null && before.uid !== uid) || (gid !== null && before.gid !== gid)
      || (modes && !modes.includes(before.mode & 0o7777))) reject(code);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pointed = await lstat(absolute).catch(() => null);
    if (!pointed || pointed.isSymbolicLink()) reject(code);
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "uid", "gid", "mode", "nlink"]) {
      if (before[key] !== after[key] || after[key] !== pointed[key]) reject(code);
    }
    return { bytes, metadata: after, absolute };
  } finally {
    await handle.close();
  }
}

async function validatePrivateRoot(rootInput, markerName, markerValue, { synthetic, code, markerModes = [0o400] }) {
  const root = path.resolve(rootInput);
  if (root === path.parse(root).root || (!synthetic && (root === os.tmpdir() || root.startsWith(`${os.tmpdir()}${path.sep}`)))) reject(code);
  const resolved = await realpath(root).catch(() => null);
  const metadata = await lstat(root).catch(() => null);
  const expectedUid = synthetic ? process.getuid?.() ?? 0 : 0;
  if (resolved !== root || !metadata?.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== expectedUid
    || metadata.gid !== expectedUid || metadata.nlink < 2 || (metadata.mode & 0o7777) !== 0o700) reject(code);
  if (!synthetic) {
    let cursor = root;
    while (true) {
      const ancestor = await lstat(cursor).catch(() => null);
      if (!ancestor?.isDirectory() || ancestor.isSymbolicLink() || ancestor.uid !== 0 || ancestor.gid !== 0
        || (ancestor.mode & 0o022) !== 0) reject(code);
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  const markerFile = path.join(root, markerName);
  const marker = await readStableFile(markerFile, { maximum: 256, uid: expectedUid, gid: expectedUid, modes: markerModes, code });
  const markerIdentity = stableMetadata(marker.metadata);
  try {
    if (!marker.bytes.equals(Buffer.from(markerValue, "utf8"))) reject(code);
  } finally {
    marker.bytes.fill(0);
  }
  return { root, uid: expectedUid, identity: stableMetadata(metadata), marker: { file: markerFile, identity: markerIdentity } };
}

export async function validateRuntimePrivilegeOperatorPrivateRoot({ root, markerName, markerValue, evidenceScope, code }) {
  if (!["ACTUAL_CONTROLLED", "SYNTHETIC_TEST_ONLY"].includes(evidenceScope)) reject("RUNTIME_PRIVILEGE_OPERATOR_ROOT_SCOPE_INVALID");
  return validatePrivateRoot(root, markerName, markerValue, {
    synthetic: evidenceScope === "SYNTHETIC_TEST_ONLY",
    code,
  });
}

function parseCanonicalJson(bytes, code) {
  let value;
  try { value = parseStrictJson(bytes.toString("utf8"), MAX_POLICY_BYTES); }
  catch { reject(code); }
  if (!bytes.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"))) reject(code);
  return value;
}

function validateSourceBinding(value) {
  if (!Array.isArray(value) || value.length !== POLICY_SOURCE_PATHS.length) reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_SOURCE_INVALID");
  value.forEach((entry, index) => {
    exactKeys(entry, ["path", "sha256"], "RUNTIME_PRIVILEGE_OPERATOR_POLICY_SOURCE_INVALID");
    if (entry.path !== POLICY_SOURCE_PATHS[index]) reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_SOURCE_INVALID");
    string(entry.sha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_SOURCE_INVALID");
  });
}

export function validateRuntimePrivilegeOperatorPolicy(value, { runtimePolicy, access, catalog } = {}) {
  let validatedRuntimePolicy;
  try {
    const validatedAccess = validateRuntimePrivilegeAccessDocument(access);
    const validatedCatalog = validateRuntimePrivilegeCompiledCatalog(catalog, { access: validatedAccess });
    validatedRuntimePolicy = validateRuntimePrivilegePolicy(runtimePolicy, { access: validatedAccess, catalog: validatedCatalog });
  } catch { reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_RUNTIME_SOURCE_INVALID"); }
  exactKeys(value, [
    "schema_version", "contract", "policy_id", "evidence_scope", "deployment_authorized", "authorization", "target",
    "execution", "roots", "interlocks", "credentials", "state_machine", "source_binding", "runtime_privilege_policy_sha256", "policy_sha256",
  ], "RUNTIME_PRIVILEGE_OPERATOR_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RUNTIME_PRIVILEGE_OPERATOR_POLICY_CONTRACT
    || value.policy_id !== "chenyida-erp-postgresql-runtime-privilege-operator-v1"
    || value.evidence_scope !== "CONTROLLED_RUNTIME_ONLY" || value.deployment_authorized !== false) reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_IDENTITY_INVALID");
  exact(value.authorization, {
    supervisor_contract: "chenyida-erp-release-supervisor-authorization/v3",
    operations: OPERATIONS,
    confirmations: CONFIRMATIONS,
    runtime_guard_modes: {
      BOOTSTRAP: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
      RECONCILE: "POST_DEPLOY_CURRENT_RUNTIME_STRICT",
      RECOVER: "MATCH_ORIGINAL_OPERATION",
    },
    intent_before_authorization_consumption: true,
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_AUTHORIZATION_INVALID");
  exact(value.target, {
    database: validatedRuntimePolicy.database.name,
    server_version_num: validatedRuntimePolicy.source_binding.engine_binding.server_version_num,
    listen_addresses: "*",
    control_identity: "CURRENT_SESSION_SUPERUSER",
    migration_owner: validatedRuntimePolicy.identities.migration_owner,
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_TARGET_INVALID");
  exact(value.execution, {
    docker_cli: "/usr/bin/docker",
    node_tooling_image: "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3",
    postgres_image: validatedRuntimePolicy.source_binding.engine_binding.image_reference,
    control_transport: "EXACT_CONTAINER_LOCAL_SOCKET_BOOTSTRAP_IDENTITY",
    control_user_source: "CONTAINER_POSTGRES_USER",
    control_database_source: "CONTAINER_POSTGRES_DB",
    password_verification_transport: "EXACT_CONTAINER_TCP_LOOPBACK_PSQL_FORCED_STDIN_PROMPT",
    global_lock_verification: "INHERITED_FD_IDENTITY_AND_INDEPENDENT_CONTENDER_BUSY",
    host_psql_required: false,
    wrong_password_must_fail: true,
    correct_password_must_succeed: true,
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_EXECUTION_INVALID");
  exact(value.roots, {
    global_lock: "/run/lock/chenyida-erp-release-gate-v1.lock",
    state_root: "/var/lib/chenyida-erp/postgresql-runtime-privilege-operator",
    state_root_marker: ".chenyida-erp-postgresql-runtime-privilege-operator-v1",
    runtime_secret_root: "/etc/chenyida-erp/runtime-secrets",
    backup_root: "/var/backups/chenyida-erp-v2",
    backup_credential_root_marker: ".chenyida-erp-credential-root-v2",
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_ROOT_INVALID");
  exact(value.interlocks, {
    active_intent_blocks_release_and_backup: true,
    backup_root_fixed: true,
    backup_fence_filename: ".backup-fence-v2.json",
    mixed_backup_and_operator_intent: "QUARANTINE",
    stale_intent: "RECOVERY_REQUIRED",
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_INTERLOCK_INVALID");
  exact(value.credentials, {
    contract: RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_CONTRACT,
    source: "EXACT_RUNTIME_SECRET_FILES_AND_BACKUP_CAPTURE_LIBPQ_SERVICE",
    login_roles: LOGIN_ROLES,
    runtime_secret_role_bindings: RUNTIME_SECRET_SOURCES.map(({ role, name }) => ({ role, source_name: name })),
    backup_capture_login: "chenyida_erp_backup",
    backup_capture_external_secret_references: "FORBIDDEN",
    source_identity_binding: "PATH_AND_STABLE_METADATA_WITHOUT_SECRET_DIGEST",
    exact_password_bytes: 43,
    decoded_password_bytes: 32,
    encoding: "CANONICAL_BASE64URL_NO_PADDING",
    minimum_distinct_characters: 16,
    all_values_distinct: true,
    transport: "ONE_PSQL_STDIN_BUFFER_ONE_TRANSACTION",
    password_encryption: "scram-sha-256",
    structural_noop_reconcile: "RESET_AND_VERIFY_ALL_LOGIN_PASSWORDS",
    server_log_suppression: [
      "log_statement=none",
      "log_min_error_statement=panic",
      "log_duration=off",
      "log_min_duration_statement=-1",
    ],
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_CREDENTIAL_INVALID");
  exact(value.state_machine, {
    phases: PHASES,
    append_only_digest_chain: true,
    fsync_each_record_and_parent: true,
    ambiguous_state: "QUARANTINE",
    postcommit_baseline: "QUARANTINE",
  }, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_STATE_INVALID");
  validateSourceBinding(value.source_binding);
  if (value.runtime_privilege_policy_sha256 !== validatedRuntimePolicy.policy_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_RUNTIME_DIGEST_INVALID");
  string(value.policy_sha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_SHA256_INVALID");
  const { policy_sha256: ignored, ...body } = value;
  void ignored;
  if (value.policy_sha256 !== clusterSha256(body)) reject("RUNTIME_PRIVILEGE_OPERATOR_POLICY_SHA256_INVALID");
  return value;
}

export async function loadRuntimePrivilegeOperatorSources(siteRoot = SITE_ROOT) {
  const root = path.resolve(siteRoot);
  const accessRecord = await readStableFile(path.join(root, "operations/postgresql-runtime-privilege-access-v2.json"), { code: "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID" });
  const catalogRecord = await readStableFile(path.join(root, "operations/postgresql-runtime-privilege-compiled-catalog-v1.json"), { code: "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID" });
  const policyRecord = await readStableFile(path.join(root, "operations/postgresql-runtime-privilege-policy-v2.json"), { code: "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID" });
  const access = parseCanonicalJson(accessRecord.bytes, "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID");
  const catalog = parseCanonicalJson(catalogRecord.bytes, "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID");
  const runtimePolicy = parseCanonicalJson(policyRecord.bytes, "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID");
  validateRuntimePrivilegeAccessDocument(access);
  validateRuntimePrivilegeCompiledCatalog(catalog, { access });
  validateRuntimePrivilegePolicy(runtimePolicy, { access, catalog });
  return { root, access, catalog, runtimePolicy };
}

export async function createRuntimePrivilegeOperatorPolicy({ siteRoot = SITE_ROOT } = {}) {
  const sources = await loadRuntimePrivilegeOperatorSources(siteRoot);
  const sourceBinding = [];
  for (const relative of POLICY_SOURCE_PATHS) {
    const record = await readStableFile(path.join(sources.root, relative), { code: "RUNTIME_PRIVILEGE_OPERATOR_SOURCE_FILE_INVALID" });
    sourceBinding.push({ path: relative, sha256: sha256(record.bytes) });
  }
  const body = {
    schema_version: 1,
    contract: RUNTIME_PRIVILEGE_OPERATOR_POLICY_CONTRACT,
    policy_id: "chenyida-erp-postgresql-runtime-privilege-operator-v1",
    evidence_scope: "CONTROLLED_RUNTIME_ONLY",
    deployment_authorized: false,
    authorization: {
      supervisor_contract: "chenyida-erp-release-supervisor-authorization/v3",
      operations: OPERATIONS,
      confirmations: CONFIRMATIONS,
      runtime_guard_modes: {
        BOOTSTRAP: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
        RECONCILE: "POST_DEPLOY_CURRENT_RUNTIME_STRICT",
        RECOVER: "MATCH_ORIGINAL_OPERATION",
      },
      intent_before_authorization_consumption: true,
    },
    target: {
      database: sources.runtimePolicy.database.name,
      server_version_num: sources.runtimePolicy.source_binding.engine_binding.server_version_num,
      listen_addresses: "*",
      control_identity: "CURRENT_SESSION_SUPERUSER",
      migration_owner: sources.runtimePolicy.identities.migration_owner,
    },
    execution: {
      docker_cli: "/usr/bin/docker",
      node_tooling_image: "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3",
      postgres_image: sources.catalog.engine_binding.image_reference,
      control_transport: "EXACT_CONTAINER_LOCAL_SOCKET_BOOTSTRAP_IDENTITY",
      control_user_source: "CONTAINER_POSTGRES_USER",
      control_database_source: "CONTAINER_POSTGRES_DB",
      password_verification_transport: "EXACT_CONTAINER_TCP_LOOPBACK_PSQL_FORCED_STDIN_PROMPT",
      global_lock_verification: "INHERITED_FD_IDENTITY_AND_INDEPENDENT_CONTENDER_BUSY",
      host_psql_required: false,
      wrong_password_must_fail: true,
      correct_password_must_succeed: true,
    },
    roots: {
      global_lock: "/run/lock/chenyida-erp-release-gate-v1.lock",
      state_root: "/var/lib/chenyida-erp/postgresql-runtime-privilege-operator",
      state_root_marker: ".chenyida-erp-postgresql-runtime-privilege-operator-v1",
      runtime_secret_root: "/etc/chenyida-erp/runtime-secrets",
      backup_root: "/var/backups/chenyida-erp-v2",
      backup_credential_root_marker: ".chenyida-erp-credential-root-v2",
    },
    interlocks: {
      active_intent_blocks_release_and_backup: true,
      backup_root_fixed: true,
      backup_fence_filename: ".backup-fence-v2.json",
      mixed_backup_and_operator_intent: "QUARANTINE",
      stale_intent: "RECOVERY_REQUIRED",
    },
    credentials: {
      contract: RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_CONTRACT,
      source: "EXACT_RUNTIME_SECRET_FILES_AND_BACKUP_CAPTURE_LIBPQ_SERVICE",
      login_roles: LOGIN_ROLES,
      runtime_secret_role_bindings: RUNTIME_SECRET_SOURCES.map(({ role, name }) => ({ role, source_name: name })),
      backup_capture_login: "chenyida_erp_backup",
      backup_capture_external_secret_references: "FORBIDDEN",
      source_identity_binding: "PATH_AND_STABLE_METADATA_WITHOUT_SECRET_DIGEST",
      exact_password_bytes: 43,
      decoded_password_bytes: 32,
      encoding: "CANONICAL_BASE64URL_NO_PADDING",
      minimum_distinct_characters: 16,
      all_values_distinct: true,
      transport: "ONE_PSQL_STDIN_BUFFER_ONE_TRANSACTION",
      password_encryption: "scram-sha-256",
      structural_noop_reconcile: "RESET_AND_VERIFY_ALL_LOGIN_PASSWORDS",
      server_log_suppression: [
        "log_statement=none",
        "log_min_error_statement=panic",
        "log_duration=off",
        "log_min_duration_statement=-1",
      ],
    },
    state_machine: {
      phases: PHASES,
      append_only_digest_chain: true,
      fsync_each_record_and_parent: true,
      ambiguous_state: "QUARANTINE",
      postcommit_baseline: "QUARANTINE",
    },
    source_binding: sourceBinding,
    runtime_privilege_policy_sha256: sources.runtimePolicy.policy_sha256,
  };
  return validateRuntimePrivilegeOperatorPolicy({ ...body, policy_sha256: clusterSha256(body) }, sources);
}

export async function verifyRuntimePrivilegeOperatorPolicySources(policy, { siteRoot = SITE_ROOT } = {}) {
  const sources = await loadRuntimePrivilegeOperatorSources(siteRoot);
  const expected = await createRuntimePrivilegeOperatorPolicy({ siteRoot });
  exact(validateRuntimePrivilegeOperatorPolicy(policy, sources), expected, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_STALE");
  return expected;
}

function passwordValid(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== 43) return false;
  let distinct = 0;
  const seen = new Set();
  for (const byte of buffer) {
    if (!(byte >= 0x41 && byte <= 0x5a) && !(byte >= 0x61 && byte <= 0x7a) && !(byte >= 0x30 && byte <= 0x39) && byte !== 0x5f && byte !== 0x2d) return false;
    if (!seen.has(byte)) { seen.add(byte); distinct += 1; }
  }
  return distinct >= 16 && BASE64URL_FINAL.has(String.fromCharCode(buffer.at(-1)));
}

function stableMetadata(metadata) {
  return Object.freeze({
    device: String(metadata.dev),
    inode: String(metadata.ino),
    mode: metadata.mode & 0o7777,
    links: metadata.nlink,
    uid: metadata.uid,
    gid: metadata.gid,
    size: metadata.size,
    mtime_ms: String(metadata.mtimeMs),
    ctime_ms: String(metadata.ctimeMs),
  });
}

function metadataMatches(metadata, expected) {
  return canonicalClusterJson(stableMetadata(metadata)) === canonicalClusterJson(expected);
}

async function validateConsumerRoot(rootInput, { synthetic, code }) {
  const root = path.resolve(rootInput);
  if (root === path.parse(root).root || (!synthetic && (root === os.tmpdir() || root.startsWith(`${os.tmpdir()}${path.sep}`)))) reject(code);
  const resolved = await realpath(root).catch(() => null);
  const metadata = await lstat(root).catch(() => null);
  const expectedUid = synthetic ? process.getuid?.() ?? 0 : 0;
  if (resolved !== root || !metadata?.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== expectedUid
    || metadata.gid !== expectedUid || metadata.nlink < 2 || (metadata.mode & 0o7777) !== 0o700) reject(code);
  if (!synthetic) {
    let cursor = root;
    while (true) {
      const ancestor = await lstat(cursor).catch(() => null);
      if (!ancestor?.isDirectory() || ancestor.isSymbolicLink() || ancestor.uid !== 0 || ancestor.gid !== 0
        || (ancestor.mode & 0o022) !== 0) reject(code);
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return { root, uid: expectedUid, identity: stableMetadata(metadata) };
}

function normalizedPassword(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.includes(0x00) || bytes.includes(0x0d)) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PASSWORD_INVALID");
  const value = bytes.at(-1) === 0x0a ? bytes.subarray(0, -1) : bytes;
  if (!passwordValid(value) || bytes.length !== value.length + (bytes.at(-1) === 0x0a ? 1 : 0)) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PASSWORD_INVALID");
  }
  return Buffer.from(value);
}

function splitServiceLines(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.includes(0x00) || bytes.includes(0x0d)) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
  }
  const lines = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0x0a) continue;
    if (index === bytes.length && start === bytes.length) break;
    if (index === start) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
    const line = bytes.subarray(start, index);
    if ([...line].some((byte) => byte < 0x20 || byte > 0x7e)) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
    lines.push(line);
    start = index + 1;
  }
  if (start < bytes.length || lines.length < 5) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
  return lines;
}

function parseBackupCapturePassword(bytes, service, expectedDatabase) {
  string(service, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
  const lines = splitServiceLines(bytes);
  if (!lines[0].equals(Buffer.from(`[${service}]`, "ascii"))) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
  const allowed = new Set(["connect_timeout", "dbname", "host", "password", "port", "sslmode", "user"]);
  const fields = new Map();
  try {
    for (const line of lines.slice(1)) {
      const separator = line.indexOf(0x3d);
      if (separator < 1 || separator === line.length - 1) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
      const key = line.subarray(0, separator).toString("ascii");
      const value = line.subarray(separator + 1);
      if (!allowed.has(key) || fields.has(key)) reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
      fields.set(key, key === "password" ? Buffer.from(value) : value.toString("ascii"));
    }
    if (!["host", "dbname", "user", "password"].every((key) => fields.has(key))
      || fields.get("dbname") !== expectedDatabase || fields.get("user") !== "chenyida_erp_backup"
      || !/^[A-Za-z0-9._:/-]{1,255}$/.test(fields.get("host"))
      || (fields.has("port") && !/^[1-9][0-9]{0,4}$/.test(fields.get("port")))
      || (fields.has("connect_timeout") && !/^[1-9][0-9]{0,2}$/.test(fields.get("connect_timeout")))
      || (fields.has("sslmode") && !["disable", "require", "verify-ca", "verify-full"].includes(fields.get("sslmode")))) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
    }
    const password = fields.get("password");
    if (!passwordValid(password)) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PASSWORD_INVALID");
    return password;
  } catch (error) {
    const password = fields.get("password");
    if (Buffer.isBuffer(password)) password.fill(0);
    throw error;
  }
}

export async function readRuntimePrivilegeOperatorCredentials({
  runtimeSecretRoot,
  backupCredentialRoot,
  backupCaptureServiceFile,
  backupCaptureService,
  expectedDatabase,
  credentialGenerationId,
  evidenceScope = "ACTUAL_CONTROLLED",
}) {
  if (!["ACTUAL_CONTROLLED", "SYNTHETIC_TEST_ONLY"].includes(evidenceScope)) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_SCOPE_INVALID");
  const synthetic = evidenceScope === "SYNTHETIC_TEST_ONLY";
  if (!synthetic && process.getuid?.() !== 0) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_ROOT_REQUIRED");
  string(credentialGenerationId, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_GENERATION_INVALID");
  string(expectedDatabase, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID");
  const runtimeRoot = await validateConsumerRoot(runtimeSecretRoot, {
    synthetic,
    code: "RUNTIME_PRIVILEGE_OPERATOR_RUNTIME_SECRET_ROOT_UNSAFE",
  });
  const backupRoot = await validatePrivateRoot(
    backupCredentialRoot,
    ".chenyida-erp-credential-root-v2",
    "chenyida-erp-credential-root/v2\n",
    { synthetic, markerModes: synthetic ? [0o400, 0o600] : [0o400, 0o600], code: "RUNTIME_PRIVILEGE_OPERATOR_BACKUP_CREDENTIAL_ROOT_UNSAFE" },
  );
  const serviceFile = path.resolve(backupCaptureServiceFile);
  if (path.dirname(serviceFile) !== backupRoot.root || path.basename(serviceFile) === ".chenyida-erp-credential-root-v2") {
    reject("RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_BOUNDARY_INVALID");
  }
  const ownedBuffers = [];
  const sourceFiles = [];
  const allValues = [];
  const secrets = new Map();
  try {
    sourceFiles.push({ id: "BACKUP_CREDENTIAL_ROOT_MARKER", ...backupRoot.marker });
    for (const source of RUNTIME_SECRET_SOURCES) {
      const file = path.join(runtimeRoot.root, source.name);
      const loaded = await readStableFile(file, {
        maximum: MAX_SECRET_BYTES,
        uid: runtimeRoot.uid,
        gid: synthetic ? runtimeRoot.uid : source.gid,
        modes: synthetic ? [0o400, 0o440, 0o600] : [0o440],
        code: "RUNTIME_PRIVILEGE_OPERATOR_RUNTIME_SECRET_FILE_UNSAFE",
      });
      ownedBuffers.push(loaded.bytes);
      const password = normalizedPassword(loaded.bytes);
      ownedBuffers.push(password);
      allValues.push(password);
      if (source.role !== null) secrets.set(source.role, password);
      sourceFiles.push({ id: source.id, file, identity: stableMetadata(loaded.metadata) });
    }
    const service = await readStableFile(serviceFile, {
      maximum: MAX_SERVICE_BYTES,
      uid: backupRoot.uid,
      gid: backupRoot.uid,
      modes: synthetic ? [0o400, 0o600] : [0o400, 0o600],
      code: "RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_UNSAFE",
    });
    ownedBuffers.push(service.bytes);
    const backupPassword = parseBackupCapturePassword(service.bytes, backupCaptureService, expectedDatabase);
    ownedBuffers.push(backupPassword);
    allValues.push(backupPassword);
    secrets.set("chenyida_erp_backup", backupPassword);
    sourceFiles.push({ id: "BACKUP_CAPTURE_SERVICE", file: serviceFile, identity: stableMetadata(service.metadata) });
    if (secrets.size !== LOGIN_ROLES.length || allValues.some((value, index) => allValues.some((other, otherIndex) => index < otherIndex && value.equals(other)))) {
      reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PASSWORD_REUSE_FORBIDDEN");
    }
    const sourceIdentitySha256 = clusterSha256({
      runtime_secret_root: runtimeRoot.identity,
      backup_credential_root: backupRoot.identity,
      files: sourceFiles.map(({ id, identity }) => ({ id, identity })),
    });
    const binding = Object.freeze({
      credentialGenerationId,
      roleSetSha256: clusterSha256(LOGIN_ROLES),
      sourceIdentitySha256,
      roleCount: LOGIN_ROLES.length,
      evidenceScope,
      rootEnforced: !synthetic,
    });
    SECRET_BINDINGS.set(binding, {
      ownedBuffers,
      secrets,
      sourceFiles,
      roots: [
        { file: runtimeRoot.root, identity: runtimeRoot.identity, directory: true },
        { file: backupRoot.root, identity: backupRoot.identity, directory: true },
      ],
    });
    return binding;
  } catch (error) {
    for (const value of ownedBuffers) value.fill(0);
    secrets.clear();
    throw error;
  }
}

export async function assertRuntimePrivilegeOperatorCredentialsUnchanged(binding) {
  const privateBinding = SECRET_BINDINGS.get(binding);
  if (!privateBinding) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_BINDING_INVALID");
  for (const source of [...privateBinding.roots, ...privateBinding.sourceFiles]) {
    const metadata = await lstat(source.file).catch(() => null);
    if (!metadata || metadata.isSymbolicLink() || (source.directory ? !metadata.isDirectory() : !metadata.isFile())
      || !metadataMatches(metadata, source.identity)) reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_FILE_CHANGED");
  }
  return true;
}

export function disposeRuntimePrivilegeOperatorCredentials(binding) {
  const privateBinding = SECRET_BINDINGS.get(binding);
  if (!privateBinding) return false;
  for (const value of privateBinding.ownedBuffers) value.fill(0);
  privateBinding.secrets.clear();
  SECRET_BINDINGS.delete(binding);
  return true;
}

export async function withRuntimePrivilegeOperatorPassword(binding, role, callback) {
  const privateBinding = SECRET_BINDINGS.get(binding);
  if (!privateBinding || !LOGIN_ROLES.includes(role) || typeof callback !== "function") reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_BINDING_INVALID");
  const password = Buffer.from(privateBinding.secrets.get(role));
  try { return await callback(password); }
  finally { password.fill(0); }
}

function validatePlanForTransaction(plan, { baseline, sources, operation }) {
  exactKeys(plan, [
    "schema_version", "contract", "policy_sha256", "target", "baseline_state_sha256", "desired_state_sha256", "no_op",
    "role_bootstrap", "statements", "plan_sha256", "desired",
  ], "RUNTIME_PRIVILEGE_OPERATOR_PLAN_INVALID");
  const structural = plan.no_op === false && Array.isArray(plan.statements) && plan.statements.length >= 2 && plan.statements[0] === PLAN_LOCK;
  const credentialOnly = operation === "RECONCILE" && plan.no_op === true && plan.role_bootstrap === false
    && Array.isArray(plan.statements) && plan.statements.length === 0
    && plan.baseline_state_sha256 === plan.desired_state_sha256;
  if (plan.schema_version !== 2 || plan.contract !== RUNTIME_PRIVILEGE_RECONCILIATION_PLAN_CONTRACT || (!structural && !credentialOnly)
    || !Array.isArray(plan.statements)
    || plan.statements.some((statement) => typeof statement !== "string" || !statement || /[;\u0000\r\n]/u.test(statement))
    || !SHA256.test(plan.policy_sha256) || !SHA256.test(plan.baseline_state_sha256) || !SHA256.test(plan.desired_state_sha256)
    || !SHA256.test(plan.plan_sha256)) reject("RUNTIME_PRIVILEGE_OPERATOR_PLAN_INVALID");
  const { plan_sha256: ignoredPlan, desired: ignoredDesired, ...body } = plan;
  void ignoredPlan; void ignoredDesired;
  if (clusterSha256(body) !== plan.plan_sha256 || clusterSha256(plan.desired) !== plan.desired_state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_PLAN_INVALID");
  let expected;
  try {
    expected = operation === "BOOTSTRAP"
      ? createControlledRuntimePrivilegeBootstrapPlan(baseline, sources)
      : operation === "RECONCILE"
        ? createRuntimePrivilegeReconciliationPlan(baseline, sources)
        : null;
  } catch { reject("RUNTIME_PRIVILEGE_OPERATOR_PLAN_DERIVATION_INVALID"); }
  if (!expected || canonicalClusterJson(expected) !== canonicalClusterJson(plan)) reject("RUNTIME_PRIVILEGE_OPERATOR_PLAN_DERIVATION_INVALID");
  return plan;
}

export function validateRuntimePrivilegeOperatorPlan(plan, options) {
  return validatePlanForTransaction(plan, options || {});
}

function appendBuffer(parts, value) {
  parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"));
}

export function buildRuntimePrivilegeOperatorTransactionInput(planInput, binding, options) {
  const plan = validatePlanForTransaction(planInput, options || {});
  const privateBinding = SECRET_BINDINGS.get(binding);
  if (!privateBinding || binding.roleSetSha256 !== clusterSha256(LOGIN_ROLES) || binding.roleCount !== LOGIN_ROLES.length) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_BINDING_INVALID");
  }
  const parts = [];
  appendBuffer(parts, "\\set ON_ERROR_STOP on\n\\set QUIET on\n\\set VERBOSITY terse\nBEGIN;\nSET LOCAL log_statement='none';\nSET LOCAL log_min_error_statement='panic';\nSET LOCAL log_duration=off;\nSET LOCAL log_min_duration_statement=-1;\nSET LOCAL password_encryption='scram-sha-256';\n");
  appendBuffer(parts, `${PLAN_LOCK} AS migration_lock_acquired\n\\gset\n\\if :migration_lock_acquired\n`);
  for (const statement of plan.statements.slice(1)) appendBuffer(parts, `${statement};\n`);
  for (const role of LOGIN_ROLES) {
    appendBuffer(parts, `\\password "${role}"\n`);
    appendBuffer(parts, privateBinding.secrets.get(role));
    appendBuffer(parts, "\n");
    appendBuffer(parts, privateBinding.secrets.get(role));
    appendBuffer(parts, "\n");
  }
  appendBuffer(parts, "COMMIT;\n\\else\n  ROLLBACK;\nDO $cyd_runtime_operator_failure$\nBEGIN\n  RAISE EXCEPTION 'RUNTIME_PRIVILEGE_OPERATOR_MIGRATION_LOCK_UNAVAILABLE';\nEND\n$cyd_runtime_operator_failure$;\n\\endif\n");
  const input = Buffer.concat(parts);
  for (const part of parts) {
    if (![...privateBinding.secrets.values()].includes(part)) part.fill(0);
  }
  return input;
}

function validateTarget(value) {
  exactKeys(value, ["database_oid", "system_identifier_sha256", "marker_sha256"], "RUNTIME_PRIVILEGE_OPERATOR_TARGET_INVALID");
  string(value.database_oid, OID, "RUNTIME_PRIVILEGE_OPERATOR_TARGET_INVALID");
  string(value.system_identifier_sha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_TARGET_INVALID");
  string(value.marker_sha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_TARGET_INVALID");
  return value;
}

export function createRuntimePrivilegeOperatorIntent(input) {
  exactKeys(input, [
    "operation_id", "operation", "created_at", "supervisor_bundle_sha256", "authorization_sha256", "release_manifest_sha256",
    "runtime_configuration_sha256", "runtime_guard_mode", "runtime_probe_binding_sha256", "operator_policy_sha256", "runtime_privilege_policy_sha256", "target", "postgres_container_id",
    "postgres_container_name", "backup_root_identity_sha256", "baseline_state_sha256", "baseline_structure_sha256", "desired_state_sha256", "plan_sha256",
    "credential_generation_id", "credential_role_set_sha256", "credential_source_identity_sha256",
  ], "RUNTIME_PRIVILEGE_OPERATOR_INTENT_INPUT_INVALID");
  string(input.operation_id, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_ID_INVALID");
  if (!["BOOTSTRAP", "RECONCILE"].includes(input.operation)) reject("RUNTIME_PRIVILEGE_OPERATOR_INTENT_OPERATION_INVALID");
  iso(input.created_at, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_TIME_INVALID");
  for (const field of [
    "supervisor_bundle_sha256", "authorization_sha256", "release_manifest_sha256", "runtime_configuration_sha256", "runtime_probe_binding_sha256",
    "operator_policy_sha256", "runtime_privilege_policy_sha256", "backup_root_identity_sha256", "baseline_state_sha256",
    "baseline_structure_sha256", "desired_state_sha256", "plan_sha256", "credential_role_set_sha256", "credential_source_identity_sha256",
  ]) string(input[field], SHA256, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_DIGEST_INVALID");
  const expectedGuardMode = input.operation === "BOOTSTRAP"
    ? "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND"
    : "POST_DEPLOY_CURRENT_RUNTIME_STRICT";
  if (input.runtime_guard_mode !== expectedGuardMode) reject("RUNTIME_PRIVILEGE_OPERATOR_INTENT_RUNTIME_GUARD_INVALID");
  validateTarget(input.target);
  string(input.postgres_container_id, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_CONTAINER_INVALID");
  string(input.postgres_container_name, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_CONTAINER_INVALID");
  string(input.credential_generation_id, IDENTIFIER, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_CREDENTIAL_INVALID");
  const body = { schema_version: 1, contract: RUNTIME_PRIVILEGE_OPERATOR_INTENT_CONTRACT, ...structuredClone(input) };
  return Object.freeze({ ...body, intent_sha256: clusterSha256(body) });
}

export function validateRuntimePrivilegeOperatorIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "operation_id", "operation", "created_at", "supervisor_bundle_sha256", "authorization_sha256",
    "release_manifest_sha256", "runtime_configuration_sha256", "runtime_guard_mode", "runtime_probe_binding_sha256", "operator_policy_sha256", "runtime_privilege_policy_sha256",
    "target", "postgres_container_id", "postgres_container_name", "backup_root_identity_sha256", "baseline_state_sha256", "baseline_structure_sha256",
    "desired_state_sha256", "plan_sha256", "credential_generation_id", "credential_role_set_sha256", "credential_source_identity_sha256", "intent_sha256",
  ], "RUNTIME_PRIVILEGE_OPERATOR_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== RUNTIME_PRIVILEGE_OPERATOR_INTENT_CONTRACT) reject("RUNTIME_PRIVILEGE_OPERATOR_INTENT_INVALID");
  const { schema_version: ignoredVersion, contract: ignoredContract, intent_sha256: ignoredDigest, ...input } = value;
  void ignoredVersion; void ignoredContract; void ignoredDigest;
  const expected = createRuntimePrivilegeOperatorIntent(input);
  exact(value, expected, "RUNTIME_PRIVILEGE_OPERATOR_INTENT_INVALID");
  return value;
}

function stateObservation(phase, observation) {
  if (["POSTCOMMIT_CAPTURED", "VERIFIED", "COMMITTED"].includes(phase)) {
    string(observation, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_STATE_OBSERVATION_INVALID");
    return observation;
  }
  if (phase === "QUARANTINED") {
    if (observation !== null) string(observation, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_STATE_OBSERVATION_INVALID");
    return observation;
  }
  if (observation !== null) reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_OBSERVATION_INVALID");
  return observation;
}

function buildState(intent, sequence, phase, previousStateSha256, observationStateSha256, recordedAt) {
  const body = {
    schema_version: 1,
    contract: RUNTIME_PRIVILEGE_OPERATOR_STATE_CONTRACT,
    operation_id: intent.operation_id,
    intent_sha256: intent.intent_sha256,
    sequence,
    phase,
    observation_state_sha256: stateObservation(phase, observationStateSha256),
    previous_state_sha256: previousStateSha256,
    recorded_at: iso(recordedAt, "RUNTIME_PRIVILEGE_OPERATOR_STATE_TIME_INVALID"),
  };
  return Object.freeze({ ...body, state_sha256: clusterSha256(body) });
}

export function createInitialRuntimePrivilegeOperatorState(intentInput, recordedAt) {
  const intent = validateRuntimePrivilegeOperatorIntent(intentInput);
  return buildState(intent, 0, "PREPARED", null, null, recordedAt);
}

export function validateRuntimePrivilegeOperatorState(value, intentInput) {
  const intent = validateRuntimePrivilegeOperatorIntent(intentInput);
  exactKeys(value, [
    "schema_version", "contract", "operation_id", "intent_sha256", "sequence", "phase", "observation_state_sha256",
    "previous_state_sha256", "recorded_at", "state_sha256",
  ], "RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  if (value.schema_version !== 1 || value.contract !== RUNTIME_PRIVILEGE_OPERATOR_STATE_CONTRACT
    || value.operation_id !== intent.operation_id || value.intent_sha256 !== intent.intent_sha256 || !PHASES.includes(value.phase)) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  }
  integer(value.sequence, 0, 1_000_000, "RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  if ((value.sequence === 0) !== (value.phase === "PREPARED") || (value.sequence === 0) !== (value.previous_state_sha256 === null)) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  }
  if (value.previous_state_sha256 !== null) string(value.previous_state_sha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  stateObservation(value.phase, value.observation_state_sha256);
  iso(value.recorded_at, "RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  const { state_sha256: ignored, ...body } = value;
  void ignored;
  if (!SHA256.test(value.state_sha256) || clusterSha256(body) !== value.state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_INVALID");
  return value;
}

export function transitionRuntimePrivilegeOperatorState(currentInput, intentInput, phase, recordedAt, observationStateSha256 = null) {
  const intent = validateRuntimePrivilegeOperatorIntent(intentInput);
  const current = validateRuntimePrivilegeOperatorState(currentInput, intent);
  if (!TRANSITIONS[current.phase]?.includes(phase)) reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_TRANSITION_INVALID");
  if (["POSTCOMMIT_CAPTURED", "VERIFIED", "COMMITTED"].includes(phase) && observationStateSha256 !== intent.desired_state_sha256) {
    reject("RUNTIME_PRIVILEGE_OPERATOR_STATE_DESIRED_MISMATCH");
  }
  return buildState(intent, current.sequence + 1, phase, current.state_sha256, observationStateSha256, recordedAt);
}

export function decideRuntimePrivilegeOperatorRecovery(intentInput, stateInput, currentState) {
  const intent = validateRuntimePrivilegeOperatorIntent(intentInput);
  const state = validateRuntimePrivilegeOperatorState(stateInput, intent);
  const digest = clusterSha256(currentState);
  if (state.phase === "COMMITTED") return digest === intent.desired_state_sha256 ? "ARCHIVE_COMMITTED" : "QUARANTINE";
  if (state.phase === "QUARANTINED") reject("RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_PHASE_INVALID");
  if (state.phase === "PREPARED") return digest === intent.baseline_state_sha256 ? "RESUME_AUTHORIZATION" : "QUARANTINE";
  if (state.phase === "AUTHORIZATION_CONSUMED") return digest === intent.baseline_state_sha256 ? "DISPATCH_TRANSACTION" : "QUARANTINE";
  if (state.phase === "TRANSACTION_DISPATCHED") {
    if (digest === intent.baseline_state_sha256) return "RETRY_TRANSACTION";
    if (digest === intent.desired_state_sha256) return "CAPTURE_AND_VERIFY";
    return "QUARANTINE";
  }
  if (["POSTCOMMIT_CAPTURED", "VERIFIED"].includes(state.phase)) return digest === intent.desired_state_sha256 ? "FINISH_PUBLICATION" : "QUARANTINE";
  return "QUARANTINE";
}

export function createRuntimePrivilegeOperatorReceipt({ intent: intentInput, state: stateInput, completedAt, finalStructureSha256, credentialVerificationSha256 }) {
  const intent = validateRuntimePrivilegeOperatorIntent(intentInput);
  const state = validateRuntimePrivilegeOperatorState(stateInput, intent);
  if (state.phase !== "COMMITTED" || state.observation_state_sha256 !== intent.desired_state_sha256) reject("RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_STATE_INVALID");
  const body = {
    schema_version: 1,
    contract: RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CONTRACT,
    operation_id: intent.operation_id,
    operation: intent.operation,
    intent_sha256: intent.intent_sha256,
    final_state_sha256: state.state_sha256,
    target: intent.target,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    authorization_sha256: intent.authorization_sha256,
    release_manifest_sha256: intent.release_manifest_sha256,
    runtime_configuration_sha256: intent.runtime_configuration_sha256,
    runtime_guard_mode: intent.runtime_guard_mode,
    runtime_probe_binding_sha256: intent.runtime_probe_binding_sha256,
    operator_policy_sha256: intent.operator_policy_sha256,
    runtime_privilege_policy_sha256: intent.runtime_privilege_policy_sha256,
    desired_state_sha256: intent.desired_state_sha256,
    final_structure_sha256: string(finalStructureSha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_STRUCTURE_INVALID"),
    credential_verification_sha256: string(credentialVerificationSha256, SHA256, "RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CREDENTIAL_PROOF_INVALID"),
    credential_generation_id: intent.credential_generation_id,
    credential_role_set_sha256: intent.credential_role_set_sha256,
    credential_source_identity_sha256: intent.credential_source_identity_sha256,
    credential_role_count: LOGIN_ROLES.length,
    transport: "ONE_PSQL_STDIN_BUFFER_ONE_TRANSACTION",
    completed_at: iso(completedAt, "RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_TIME_INVALID"),
    result: "VERIFIED",
  };
  return Object.freeze({ ...body, receipt_sha256: clusterSha256(body) });
}

export function validateRuntimePrivilegeOperatorReceipt(value, intentInput, stateInput) {
  const expected = createRuntimePrivilegeOperatorReceipt({
    intent: intentInput,
    state: stateInput,
    completedAt: value?.completed_at,
    finalStructureSha256: value?.final_structure_sha256,
    credentialVerificationSha256: value?.credential_verification_sha256,
  });
  exact(value, expected, "RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_INVALID");
  return value;
}

export function validateRuntimePrivilegeOperatorFinalState(state, sources) {
  return validateRuntimePrivilegeState(state, { ...sources, mode: "final", expectedTarget: state.target, expectedFinal: state });
}

async function main(argumentsList) {
  if (argumentsList.length !== 1 || !["render-policy", "verify-policy"].includes(argumentsList[0])) {
    process.stderr.write("usage: postgresql-runtime-privilege-operator.mjs render-policy|verify-policy\n");
    process.exitCode = 2;
    return;
  }
  const expected = await createRuntimePrivilegeOperatorPolicy();
  if (argumentsList[0] === "render-policy") {
    process.stdout.write(`${JSON.stringify(expected, null, 2)}\n`);
    return;
  }
  const record = await readStableFile(path.join(SITE_ROOT, RUNTIME_PRIVILEGE_OPERATOR_POLICY_PATH), { code: "RUNTIME_PRIVILEGE_OPERATOR_POLICY_FILE_INVALID" });
  const parsed = parseCanonicalJson(record.bytes, "RUNTIME_PRIVILEGE_OPERATOR_POLICY_FILE_INVALID");
  await verifyRuntimePrivilegeOperatorPolicySources(parsed);
  process.stdout.write(`RUNTIME_PRIVILEGE_OPERATOR_POLICY_VERIFIED sha256=${expected.policy_sha256}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof RuntimePrivilegeOperatorError ? error.code : "RUNTIME_PRIVILEGE_OPERATOR_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
