import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseClusterCatalogReport } from "../scripts/postgresql-cluster-catalog-contract.mjs";
import {
  bindClusterCredentialsWithPsql,
  createClusterRestorePlan,
  quotePostgresIdentifier,
  quotePostgresLiteral,
  validateClusterRestorePlan,
} from "../scripts/postgresql-cluster-restore-contract.mjs";
import {
  CLUSTER_POLICY_CONTRACT,
  CREDENTIAL_FILE_CONTRACT,
  CREDENTIAL_ROOT_MARKER,
  CREDENTIAL_ROOT_MARKER_VALUE,
  RECOVERY_STATE_ROOT_MARKER,
  RECOVERY_STATE_ROOT_MARKER_VALUE,
  LEGACY_TABLESPACE_MAP_CONTRACT,
  TABLESPACE_MAP_CONTRACT,
  assertCredentialBindingUnchanged,
  canonicalClusterJson,
  clusterPolicySha256,
  clusterSha256,
  compareClusterCatalogCaptures,
  createClusterSecurityReceipt,
  createClusterSnapshot,
  createCredentialBindingReceipt,
  createInitialRecoveryState,
  createRecoveryIntent,
  createTablespaceReceipt,
  credentialPassword,
  normalizeClusterCatalog,
  readRecoveryExecution,
  readCredentialBindingFile,
  transitionRecoveryState,
  validateClusterCatalog,
  validateClusterRecoveryPolicy,
  validateClusterSecurityReceipt,
  validateClusterSnapshot,
  validateCredentialBindingReceipt,
  validateLegacyTablespaceMapDocument,
  validateRecoveryIntent,
  validateTablespaceMap,
  validateTablespaceMapDocument,
  validateTablespacePreflightEvidence,
  validateTablespaceReceipt,
  verifyTablespaceMapAfterCreate,
  verifyTablespacePathAfterCreate,
  verifyTablespacePathAfterDrop,
  writeRecoveryIntent,
  writeRecoveryState,
} from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  RECOVERY_COMPENSATION_CONFIRMATION,
  RECOVERY_EXECUTOR_CONFIRMATION,
  compensateQuarantinedRecovery,
  executeNextNontransactionalRecoveryStep,
  expectedRecoveryIntentBindings,
  nontransactionalRecoveryOperations,
  runRecoveryExecutorCli,
} from "../scripts/postgresql-cluster-recovery-executor.mjs";

const siteRoot = path.resolve(new URL("..", import.meta.url).pathname);
const policyFile = path.join(siteRoot, "operations", "postgresql-cluster-recovery-policy-v1.json");
const zero = "0".repeat(64), one = "1".repeat(64), two = "2".repeat(64), three = "3".repeat(64);
const now = "2026-08-13T06:00:00.000Z";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function syntheticTablespaceMetadata() {
  return {
    namespace_metadata: { uid: process.getuid(), gid: process.getgid(), mode: "0700" },
    path_metadata: { uid: process.getuid(), gid: process.getgid(), mode: "0700" },
  };
}
async function policy() { return JSON.parse(await readFile(policyFile, "utf8")); }
async function withRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-cluster-v1-"));
  try { await chmod(root, 0o700); await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function privateRoot(parent, name, marker, value) {
  const root = path.join(parent, name);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  await writeFile(path.join(root, marker), value, { mode: 0o400 });
  await chmod(path.join(root, marker), 0o400);
  return root;
}
function privilege(grantor, grantee, privilegeType, isGrantable = false) {
  return { grantor, grantee, privilege_type: privilegeType, is_grantable: isGrantable };
}
function acl(explicit, effective, aclState = explicit.length ? "EXPLICIT" : "NULL") {
  return { acl_state: aclState, explicit_privileges: explicit, effective_privileges: effective };
}

function catalogFixture() {
  const owner = "chenyida_erp_owner", runtime = "chenyida_erp_runtime", group = "chenyida_erp_rw";
  const ownerTable = privilege(owner, owner, "SELECT", true);
  return normalizeClusterCatalog({
    database: {
      name: "chenyida_erp", owner, default_tablespace: "pg_default", allow_connect: true, connection_limit: 64,
      ...acl([privilege(owner, group, "CONNECT")], [privilege(owner, group, "CONNECT")]),
    },
    roles: [
      { name: owner, purpose: "MIGRATION_OWNER", superuser: false, inherit: true, create_role: false, create_database: false, can_login: true, replication: false, connection_limit: 2, valid_until: null, bypass_rls: false },
      { name: runtime, purpose: "RUNTIME", superuser: false, inherit: true, create_role: false, create_database: false, can_login: true, replication: false, connection_limit: 32, valid_until: null, bypass_rls: false },
      { name: group, purpose: "PRIVILEGE_GROUP", superuser: false, inherit: true, create_role: false, create_database: false, can_login: false, replication: false, connection_limit: -1, valid_until: null, bypass_rls: false },
    ],
    memberships: [{ role: group, member: runtime, grantor: "RESTORE_ADMIN", admin_option: false, inherit_option: true, set_option: false }],
    settings: [],
    objects: [
      { kind: "SCHEMA", schema: null, name: "app", identity_arguments: null, parent_identity: null, owner, tablespace: null, extension: null, ...acl([privilege(owner, group, "USAGE")], [privilege(owner, group, "USAGE")]) },
      { kind: "SCHEMA", schema: null, name: "public", identity_arguments: null, parent_identity: null, owner: "pg_database_owner", tablespace: null, extension: null, ...acl([], [privilege("pg_database_owner", "pg_database_owner", "USAGE", true)]) },
      { kind: "TABLE", schema: "app", name: "materials", identity_arguments: null, parent_identity: null, owner, tablespace: "erp_ts", extension: null, ...acl([privilege(owner, group, "SELECT"), privilege(owner, group, "INSERT"), privilege(owner, group, "UPDATE"), privilege(owner, group, "DELETE")], [privilege(owner, group, "SELECT"), privilege(owner, group, "INSERT"), privilege(owner, group, "UPDATE"), privilege(owner, group, "DELETE"), ownerTable]) },
      { kind: "COLUMN", schema: "app", name: "internal_code", identity_arguments: null, parent_identity: "materials", owner, tablespace: null, extension: null, ...acl([privilege(owner, group, "SELECT")], [privilege(owner, group, "SELECT")]) },
      { kind: "INDEX_PLACEMENT", schema: "app", name: "materials_pkey", identity_arguments: null, parent_identity: "materials", owner, tablespace: "erp_ts", extension: null, ...acl([], [], "NULL") },
      { kind: "ROUTINE", schema: "app", name: "find_material", identity_arguments: [{ schema: "pg_catalog", name: "text" }], parent_identity: null, owner, tablespace: null, extension: null, ...acl([privilege(owner, group, "EXECUTE")], [privilege(owner, group, "EXECUTE")]) },
      { kind: "TYPE", schema: "app", name: "material_state", identity_arguments: null, parent_identity: null, owner, tablespace: null, extension: null, ...acl([privilege(owner, group, "USAGE")], [privilege(owner, group, "USAGE")]) },
      { kind: "LARGE_OBJECT", schema: null, name: "lo:16400", identity_arguments: null, parent_identity: null, owner, tablespace: null, extension: null, ...acl([privilege(owner, group, "SELECT")], [privilege(owner, group, "SELECT")]) },
    ],
    default_privileges: [
      { owner, schema: "app", object_kind: "TABLE", ...acl([privilege(owner, group, "SELECT"), privilege(owner, group, "INSERT"), privilege(owner, group, "UPDATE"), privilege(owner, group, "DELETE")], [privilege(owner, group, "SELECT"), privilege(owner, group, "INSERT"), privilege(owner, group, "UPDATE"), privilege(owner, group, "DELETE")]) },
    ],
    tablespaces: [
      { name: "erp_ts", owner, options: [], source_location_sha256: zero, ...acl([], [privilege(owner, owner, "CREATE", true)]) },
    ],
    extensions: [
      { name: "pgcrypto", version: "1.3", schema: "public", owner, member_fingerprint: one },
      { name: "plpgsql", version: "1.0", schema: "pg_catalog", owner: "RESTORE_ADMIN", member_fingerprint: "f".repeat(64) },
    ],
    publications: [{ name: "erp_publication", owner, all_tables: false, publish_insert: true, publish_update: true, publish_delete: true, publish_truncate: true, publish_via_partition_root: false, table_fingerprint: two }],
    parameter_privileges: [],
    unsupported: {
      access_methods: 0, casts: 0, capture_role_conflicts: 0, collations: 0, conversions: 0, event_triggers: 0, external_database_settings: 0, foreign_data_wrappers: 0, foreign_servers: 0,
      foreign_tables: 0, operator_classes: 0, operator_families: 0, operators: 0, parameter_acl_entries: 0,
      policy_role_endpoints: 0, replication_origins: 0, row_security_policies: 0, security_labels: 0, statistics_extensions: 0,
      subscriptions: 0, text_search_objects: 0, transforms: 0, unapproved_languages: 0, unapproved_settings: 0, unsupported_relations: 0, user_mappings: 0,
    },
  });
}

class SyntheticRecoveryAdapter {
  constructor(targetIdentity) {
    this.targetIdentity = targetIdentity;
    this.resources = new Map();
    this.dispatches = new Map();
    this.markerFinalizations = new Map();
    this.dependencies = new Map();
    this.activeSessions = new Map();
    this.rolesPresent = true;
    this.contained = true;
    this.quarantined = false;
    this.dispatchResult = "APPLIED";
  }

  key(resource) { return `${resource.kind}:${resource.operationResourceIdentitySha256}`; }

  async assertTargetIdentity(expected) {
    if (expected !== this.targetIdentity) throw new Error("target identity mismatch");
  }

  async assertContainment() {
    if (!this.rolesPresent || !this.contained) throw new Error("containment failed");
    return true;
  }

  async inspect(resource) {
    const key = this.key(resource);
    return {
      status: this.resources.get(key) ?? "ABSENT",
      dependencyCount: this.dependencies.get(key) ?? 0,
      activeSessions: this.activeSessions.get(key) ?? 0,
    };
  }

  async verifyTablespacePath() {
    if (this.pathUnsafe) throw new Error("tablespace path drift");
    return true;
  }

  async dispatch(resource) {
    const key = this.key(resource);
    this.dispatches.set(key, (this.dispatches.get(key) ?? 0) + 1);
    this.resources.set(key, this.dispatchResult);
  }

  async finalizeMarker(resource) {
    const key = this.key(resource);
    this.markerFinalizations.set(key, (this.markerFinalizations.get(key) ?? 0) + 1);
    if (this.resources.get(key) === "PARTIAL_CREATED") this.resources.set(key, "APPLIED");
  }

  async quarantine() { this.quarantined = true; this.contained = true; }

  async assertCompensationSafe() {
    if (this.compensationUnsafe) throw Object.assign(new Error("unsafe compensation"), { code: "RECOVERY_COMPENSATION_ROLE_UNSAFE" });
    return true;
  }

  async compensate(resource) { this.resources.set(this.key(resource), "ABSENT"); }

  async compensateRoles() { this.rolesPresent = false; }

  async assertResourcesAbsent(context) {
    if (this.rolesPresent || [context.database, ...context.tablespaces].some((resource) => this.resources.get(this.key(resource)) !== undefined && this.resources.get(this.key(resource)) !== "ABSENT")) throw new Error("resources remain");
  }
}

function recoveryClock(start = Date.parse("2026-08-13T09:00:00.000Z")) {
  let current = start;
  return () => new Date(current += 1000).toISOString();
}

async function recoveryExecutorFixture(root) {
  const { recoveryPolicy, snapshot } = await snapshotFixture();
  const approvedRoot = path.join(root, "executor-tablespaces"); await mkdir(approvedRoot, { mode: 0o700 }); await chmod(approvedRoot, 0o700);
  const targetPath = path.join(approvedRoot, "erp_ts"); await mkdir(targetPath, { mode: 0o700 }); await chmod(targetPath, 0o700);
  const namespaceIdentitySha256 = clusterSha256("executor-namespace");
  const tablespaceMap = {
    schema_version: 2,
    contract: TABLESPACE_MAP_CONTRACT,
    map_id: "executor-map-1",
    snapshot_sha256: snapshot.snapshot_sha256,
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    approved_host_root: approvedRoot,
    approved_server_root: approvedRoot,
    namespace_identity_sha256: namespaceIdentitySha256,
    ...syntheticTablespaceMetadata(),
    entries: [{ name: "erp_ts", host_path: targetPath, server_path: targetPath }],
  };
  const tablespacePreflight = await validateTablespaceMap({
    map: tablespaceMap,
    snapshot,
    policy: recoveryPolicy,
    expectedUid: process.getuid(),
    expectedGid: process.getgid(),
    expectedNamespaceIdentitySha256: namespaceIdentitySha256,
  });
  const databaseProfile = { server_major: "17", encoding: "UTF8", locale_provider: "libc", collate: "C", ctype: "C", collation_version: null };
  const plan = createClusterRestorePlan({ snapshot, policy: recoveryPolicy, tablespaceMap, databaseProfile });
  const bindings = expectedRecoveryIntentBindings({ plan, snapshot, policy: recoveryPolicy, tablespaceMap, databaseProfile });
  const targetIdentity = clusterSha256("executor-target-system-identifier");
  const intent = createRecoveryIntent({
    restore_run_id: "executor-restore-1",
    backup_id: bindings.backup_id,
    created_at: "2026-08-13T09:00:00.000Z",
    evidence_scope: bindings.evidence_scope,
    policy_sha256: bindings.policy_sha256,
    snapshot_sha256: bindings.snapshot_sha256,
    data_transfer_acceptance_sha256: one,
    cluster_transfer_acceptance_sha256: two,
    joint_transfer_sha256: three,
    target_system_identifier_sha256: targetIdentity,
    target_empty_state_sha256: zero,
    credential_generation_id: "executor-generation-1",
    credential_role_set_sha256: bindings.credential_role_set_sha256,
    tablespace_map_sha256: bindings.tablespace_map_sha256,
    custom_tablespace_identity_sha256: [...bindings.custom_tablespace_identity_sha256],
  });
  const stateRoot = await privateRoot(root, "executor-state", RECOVERY_STATE_ROOT_MARKER, RECOVERY_STATE_ROOT_MARKER_VALUE);
  await writeRecoveryIntent({ stateRoot, intent });
  let state = createInitialRecoveryState(intent, intent.created_at);
  await writeRecoveryState({ stateRoot, state, intent });
  state = transitionRecoveryState(state, intent, { phase: "ROLE_SKELETON_APPLIED", recordedAt: "2026-08-13T09:00:01.000Z" });
  await writeRecoveryState({ stateRoot, state, intent });
  const options = { stateRoot, intent, plan, snapshot, policy: recoveryPolicy, tablespaceMap, tablespacePreflight, databaseProfile };
  return { ...options, targetIdentity, operations: nontransactionalRecoveryOperations(options) };
}

function bindingFixture() {
  return {
    backup_id: "backup-20260813-0001", manifest_sha256: one, local_receipt_sha256: two,
    recovery_point_at: now,
    source: { system_identifier: "7612345678901234567", database_oid: "16384", database_marker: "source-cluster-marker", postgresql_major: "17" },
    application: { git_commit: "a".repeat(40), version: "0.1.0-alpha.46", migration_head: "0045_selfhost_release_gate.sql", migration_manifest_sha256: three },
  };
}

async function snapshotFixture() {
  const recoveryPolicy = await policy();
  const catalog = catalogFixture();
  return { recoveryPolicy, catalog, snapshot: createClusterSnapshot({ snapshotId: "cluster-snapshot-1", capturedAt: now, binding: bindingFixture(), policy: recoveryPolicy, beforeCatalog: catalog, afterCatalog: clone(catalog) }) };
}

function expectCode(code) { return (error) => error?.code === code; }

function catalogReport(catalog) {
  const lines = [["DATABASE", catalog.database]];
  for (const [type, key] of [
    ["ROLE", "roles"], ["MEMBERSHIP", "memberships"], ["SETTING", "settings"], ["OBJECT", "objects"],
    ["DEFAULT_PRIVILEGE", "default_privileges"], ["TABLESPACE", "tablespaces"], ["EXTENSION", "extensions"],
    ["PUBLICATION", "publications"], ["PARAMETER_PRIVILEGE", "parameter_privileges"],
  ]) for (const value of catalog[key]) lines.push([type, value]);
  lines.push(["UNSUPPORTED", catalog.unsupported]);
  return `${lines.map(([type, value]) => `${type}\t${JSON.stringify(value)}`).join("\n")}\n`;
}

test("strict production policy is canonical and dangerous policy mutations fail closed", async () => {
  const value = await policy();
  assert.equal(value.contract, CLUSTER_POLICY_CONTRACT);
  assert.equal(clusterPolicySha256(validateClusterRecoveryPolicy(value)), clusterSha256(value));
  const dangerous = clone(value); dangerous.roles[0].purpose = "ROOT_OWNER";
  assert.throws(() => validateClusterRecoveryPolicy(dangerous), expectCode("CLUSTER_POLICY_ROLE_INVALID"));
  const publicConnect = clone(value); publicConnect.acl.public_allowed_privileges.DATABASE = ["CONNECT"];
  assert.throws(() => validateClusterRecoveryPolicy(publicConnect), expectCode("CLUSTER_POLICY_PUBLIC_CONNECT_INVALID"));
  const builtinEndpoint = clone(value); builtinEndpoint.acl.allowed_grantees.push("pg_read_all_data");
  assert.throws(() => validateClusterRecoveryPolicy(builtinEndpoint), expectCode("CLUSTER_POLICY_ACL_ENDPOINT_INVALID"));
  const migrationSetting = clone(value); migrationSetting.settings.required.push({ role_scope: "chenyida_erp_owner", database_scope: "DATABASE", key: "statement_timeout", value: "30s" });
  assert.throws(() => validateClusterRecoveryPolicy(migrationSetting), expectCode("CLUSTER_POLICY_MIGRATION_OWNER_SETTING_FORBIDDEN"));
});

test("catalog normalization is stable while unsafe roles, ACLs and unsupported catalog are rejected", async () => {
  const recoveryPolicy = await policy(), catalog = catalogFixture();
  validateClusterCatalog(catalog, recoveryPolicy);
  const shuffled = clone(catalog); shuffled.objects.reverse(); shuffled.objects[2].explicit_privileges.reverse();
  assert.equal(clusterSha256(normalizeClusterCatalog(shuffled)), clusterSha256(catalog));
  const superuser = clone(catalog); superuser.roles[0].superuser = true;
  assert.throws(() => validateClusterCatalog(superuser, recoveryPolicy), expectCode("CLUSTER_ROLE_DANGEROUS_ATTRIBUTE"));
  const runtimeOwner = clone(catalog); runtimeOwner.objects[0].owner = "chenyida_erp_runtime";
  assert.throws(() => validateClusterCatalog(runtimeOwner, recoveryPolicy), expectCode("CLUSTER_OBJECT_OWNER_POLICY_MISMATCH"));
  const publicCreate = clone(catalog); const appSchema = publicCreate.objects.find((item) => item.kind === "SCHEMA" && item.name === "app"); appSchema.explicit_privileges.push(privilege("chenyida_erp_owner", "PUBLIC", "CREATE"));
  assert.throws(() => validateClusterCatalog(normalizeClusterCatalog(publicCreate), recoveryPolicy), expectCode("CLUSTER_ACL_PUBLIC_PRIVILEGE_FORBIDDEN"));
  const foreign = clone(catalog); foreign.unsupported.foreign_tables = 1;
  assert.throws(() => validateClusterCatalog(foreign, recoveryPolicy), expectCode("CLUSTER_UNSUPPORTED_CATALOG_PRESENT"));
  const foreignGrantor = clone(catalog); foreignGrantor.objects[2].explicit_privileges[0].grantor = "RESTORE_ADMIN";
  assert.throws(() => validateClusterCatalog(foreignGrantor, recoveryPolicy), (error) => ["CLUSTER_ACL_ENDPOINT_NOT_ALLOWED", "CLUSTER_ACL_GRANTOR_NOT_OWNER"].includes(error?.code));
  const tablespaceOptions = clone(catalog); tablespaceOptions.tablespaces[0].options = ["random_page_cost=1.1"];
  assert.throws(() => validateClusterCatalog(tablespaceOptions, recoveryPolicy), expectCode("CLUSTER_TABLESPACE_OPTIONS_UNSUPPORTED"));
  const rawRoutineIdentity = clone(catalog); rawRoutineIdentity.objects.find((item) => item.kind === "ROUTINE").identity_arguments = "text";
  assert.throws(() => validateClusterCatalog(rawRoutineIdentity, recoveryPolicy), expectCode("CLUSTER_OBJECT_ROUTINE_IDENTITY_INVALID"));
  const missingPlatformExtension = clone(catalog); missingPlatformExtension.extensions = missingPlatformExtension.extensions.filter((item) => item.name !== "plpgsql");
  assert.throws(() => validateClusterCatalog(missingPlatformExtension, recoveryPolicy), expectCode("CLUSTER_REQUIRED_EXTENSION_MISSING"));
  const parameterAcl = clone(catalog); parameterAcl.parameter_privileges.push({ parameter: "statement_timeout", grantor: "chenyida_erp_owner", grantee: "chenyida_erp_rw", privilege_type: "SET", is_grantable: false });
  assert.throws(() => validateClusterCatalog(parameterAcl, recoveryPolicy), (error) => ["CLUSTER_ACL_PRIVILEGE_UNKNOWN", "CLUSTER_PARAMETER_ACL_UNSUPPORTED"].includes(error?.code));
});

test("snapshot binds V2 recovery identity and refuses source drift or tampering", async () => {
  const { recoveryPolicy, catalog, snapshot } = await snapshotFixture();
  assert.equal(validateClusterSnapshot(snapshot, recoveryPolicy), snapshot);
  assert.equal(snapshot.catalog_sha256, clusterSha256(catalog));
  const drift = clone(catalog); drift.extensions[0].version = "1.4";
  assert.throws(() => compareClusterCatalogCaptures(catalog, drift, recoveryPolicy), expectCode("CLUSTER_CATALOG_DRIFT"));
  const tampered = clone(snapshot); tampered.binding.manifest_sha256 = zero;
  assert.throws(() => validateClusterSnapshot(tampered, recoveryPolicy), expectCode("CLUSTER_SNAPSHOT_SHA256_MISMATCH"));
});

test("restore plan is derived, secret-free and keeps roles contained until atomic activation", async () => {
  const { recoveryPolicy, snapshot } = await snapshotFixture();
  const tablespaceMap = {
    schema_version: 2,
    contract: TABLESPACE_MAP_CONTRACT,
    map_id: "restore-plan-map",
    snapshot_sha256: snapshot.snapshot_sha256,
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    approved_host_root: "/synthetic/host/tablespaces",
    approved_server_root: "/synthetic/server/tablespaces",
    namespace_identity_sha256: zero,
    ...syntheticTablespaceMetadata(),
    entries: [{ name: "erp_ts", host_path: "/synthetic/host/tablespaces/erp_ts", server_path: "/synthetic/server/tablespaces/erp_ts" }],
  };
  const databaseProfile = { server_major: "17", encoding: "UTF8", locale_provider: "libc", collate: "C", ctype: "C", collation_version: null };
  const plan = createClusterRestorePlan({ snapshot, policy: recoveryPolicy, tablespaceMap, databaseProfile });
  validateClusterRestorePlan(plan, { snapshot, policy: recoveryPolicy, tablespaceMap, databaseProfile });
  assert.match(plan.role_skeleton.sql, /NOLOGIN/u);
  assert.match(plan.role_skeleton.sql, /PASSWORD NULL/u);
  assert.match(plan.security.sql, /ROUTINE "app"\."find_material"\("pg_catalog"\."text"\)/u);
  assert.match(plan.activation.sql, /ALTER ROLE "chenyida_erp_runtime" LOGIN/u);
  assert.match(plan.quarantine.sql, /ALTER ROLE "chenyida_erp_runtime" NOLOGIN/u);
  assert.deepEqual(plan.data_restore.required_arguments, ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"]);
  assert.equal(canonicalClusterJson(plan).includes("secret-material"), false);
  assert.equal(quotePostgresIdentifier('name";DROP ROLE unsafe;--'), '"name"";DROP ROLE unsafe;--"');
  assert.equal(quotePostgresLiteral("path';DROP TABLE unsafe;--"), "'path'';DROP TABLE unsafe;--'");
  const tampered = clone(plan); tampered.activation.sql = tampered.activation.sql.replace("LOGIN", "SUPERUSER");
  assert.throws(() => validateClusterRestorePlan(tampered, { snapshot, policy: recoveryPolicy, tablespaceMap, databaseProfile }), expectCode("CLUSTER_RESTORE_ACTIVATION_PLAN_INVALID"));
});

test("catalog adapter accepts only ordered typed JSON records and SQL never reads credential catalogs", async () => {
  const recoveryPolicy = await policy(), catalog = catalogFixture(), report = catalogReport(catalog);
  assert.deepEqual(parseClusterCatalogReport(report, recoveryPolicy), catalog);
  assert.throws(() => parseClusterCatalogReport(report.replace("DATABASE\t", "UNKNOWN\t"), recoveryPolicy), expectCode("CLUSTER_CATALOG_REPORT_TYPE_INVALID"));
  const firstRole = `ROLE\t${JSON.stringify(catalog.roles[0])}\n`;
  assert.throws(() => parseClusterCatalogReport(report.replace(firstRole, `${firstRole}${firstRole}`), recoveryPolicy), expectCode("CLUSTER_ROLES_NOT_CANONICAL"));
  assert.throws(() => parseClusterCatalogReport(report.replace(/\nUNSUPPORTED\t/, "\nDATABASE\t{}\nUNSUPPORTED\t"), recoveryPolicy), expectCode("CLUSTER_CATALOG_REPORT_ORDER_INVALID"));
  const sql = await readFile(path.join(siteRoot, "scripts", "postgresql-cluster-catalog.sql"), "utf8");
  assert.doesNotMatch(sql, /pg_authid|rolpassword|aclitem::text/i);
  for (const required of ["pg_roles", "pg_auth_members", "inherit_option", "set_option", "pg_db_role_setting", "aclexplode", "pg_tablespace", "spcacl", "pg_parameter_acl", "pg_default_acl", "pg_largeobject_metadata", "pg_identify_object_as_address"]) assert.ok(sql.includes(required), required);
});

test("tablespace map requires exact names, private empty direct children and stable identities", async () => withRoot(async (root) => {
  const { recoveryPolicy, snapshot } = await snapshotFixture();
  const approvedRoot = path.join(root, "tablespaces"); await mkdir(approvedRoot, { mode: 0o700 }); await chmod(approvedRoot, 0o700);
  const target = path.join(approvedRoot, "erp_ts"); await mkdir(target, { mode: 0o700 }); await chmod(target, 0o700);
  const namespace = clusterSha256("synthetic-shared-namespace");
  const map = { schema_version: 2, contract: TABLESPACE_MAP_CONTRACT, map_id: "map-1", snapshot_sha256: snapshot.snapshot_sha256, evidence_scope: "SYNTHETIC_TEST_ONLY", approved_host_root: approvedRoot, approved_server_root: approvedRoot, namespace_identity_sha256: namespace, ...syntheticTablespaceMetadata(), entries: [{ name: "erp_ts", host_path: target, server_path: target }] };
  const legacyMap = { schema_version: 1, contract: LEGACY_TABLESPACE_MAP_CONTRACT, map_id: "legacy-map-1", snapshot_sha256: snapshot.snapshot_sha256, evidence_scope: "SYNTHETIC_TEST_ONLY", approved_host_root: approvedRoot, approved_server_root: approvedRoot, namespace_identity_sha256: namespace, entries: [{ name: "erp_ts", host_path: target, server_path: target }] };
  assert.equal(validateLegacyTablespaceMapDocument({ map: legacyMap, snapshot, policy: recoveryPolicy }).contract, LEGACY_TABLESPACE_MAP_CONTRACT);
  assert.throws(()=>validateLegacyTablespaceMapDocument({ map: {...legacyMap,evidence_scope:"ACTUAL_CONTROLLED"}, snapshot, policy: recoveryPolicy, evidenceScope:"ACTUAL_CONTROLLED" }),expectCode("TABLESPACE_LEGACY_MAP_READ_ONLY"));
  assert.throws(()=>validateTablespaceMapDocument({ map: legacyMap, snapshot, policy: recoveryPolicy }),expectCode("TABLESPACE_MAP_INVALID"));
  assert.throws(()=>validateTablespaceMapDocument({ map: {...map,approved_host_root:null}, snapshot, policy: recoveryPolicy }),expectCode("TABLESPACE_MAP_ROOT_INVALID"));
  assert.throws(()=>validateTablespaceMapDocument({ map: {...map,entries:[{...map.entries[0],host_path:null}]}, snapshot, policy: recoveryPolicy }),expectCode("TABLESPACE_MAP_ENTRY_PATH_INVALID"));
  const validation = await validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace, prohibitedRoots: [path.join(root, "pgdata")] });
  assert.equal(validation.entryCount, 1);
  await chmod(approvedRoot, 0o2700);
  await assert.rejects(validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_ROOT_IDENTITY_MISMATCH"));
  await chmod(approvedRoot, 0o700);
  await chmod(target, 0o1700);
  await assert.rejects(validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_PATH_IDENTITY_MISMATCH"));
  await chmod(target, 0o700);
  const controlled = clone(map);
  controlled.evidence_scope = "ACTUAL_CONTROLLED";
  controlled.namespace_metadata = { uid: 0, gid: 999, mode: "0750" };
  controlled.path_metadata = { uid: 999, gid: 999, mode: "0700" };
  assert.equal(validateTablespaceMapDocument({ map: controlled, snapshot, policy: recoveryPolicy, evidenceScope: "ACTUAL_CONTROLLED" }).namespace_metadata.mode, "0750");
  const invalidControlled = clone(controlled); invalidControlled.namespace_metadata = { uid: 999, gid: 999, mode: "0700" };
  await assert.rejects(validateTablespaceMap({ map: invalidControlled, snapshot, policy: recoveryPolicy, expectedUid: 999, expectedGid: 999, expectedNamespaceIdentitySha256: namespace, evidenceScope: "ACTUAL_CONTROLLED" }), expectCode("TABLESPACE_ACTUAL_FILESYSTEM_POLICY_INVALID"));
  assert.equal(validateTablespacePreflightEvidence({ preflightValidation: validation, map, snapshot, policy: recoveryPolicy }).mapSha256, clusterSha256(map));
  const forgedPreflight = clone(validation); forgedPreflight.rootIdentitySha256 = zero;
  await assert.rejects(verifyTablespacePathAfterDrop({ preflightValidation: forgedPreflight, map, snapshot, policy: recoveryPolicy, entryName: "erp_ts", targetLocationSha256: clusterSha256(target) }), expectCode("TABLESPACE_POST_DROP_IDENTITY_MISMATCH"));
  await writeFile(path.join(target, "not-empty"), "x");
  await assert.rejects(validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_PATH_NOT_EMPTY"));
  await rm(path.join(target, "not-empty"));
  const missing = clone(map); missing.entries = [];
  await assert.rejects(validateTablespaceMap({ map: missing, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_MAP_NAME_SET_MISMATCH"));
  const duplicate = clone(map); duplicate.entries.push(clone(duplicate.entries[0]));
  await assert.rejects(validateTablespaceMap({ map: duplicate, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_MAP_ENTRIES_NOT_CANONICAL"));
  await chmod(target, 0o755);
  await assert.rejects(validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_PATH_IDENTITY_MISMATCH"));
  await chmod(target, 0o700);
  await assert.rejects(validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace, prohibitedRoots: [target] }), expectCode("TABLESPACE_ROOT_PROHIBITED"));
  await assert.rejects(validateTablespaceMap({ map, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid() + 1, expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_EXPECTED_IDENTITY_MISMATCH"));
  const aliasPath = path.join(approvedRoot, "alias"); await symlink(target, aliasPath);
  const alias = clone(map); alias.entries[0].host_path = aliasPath;
  await assert.rejects(validateTablespaceMap({ map: alias, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), (error) => ["TABLESPACE_MAP_ENTRY_BOUNDARY_INVALID", "TABLESPACE_PATH_UNSAFE"].includes(error?.code));
  const versionDirectory = path.join(target, "PG_17_202406281");
  await mkdir(path.join(target, "PG_17_wrong"), { mode: 0o700 });
  const targetCatalog = clone(snapshot.catalog); targetCatalog.tablespaces[0].source_location_sha256 = clusterSha256(target);
  await assert.rejects(verifyTablespaceMapAfterCreate({ map, snapshot, policy: recoveryPolicy, preflightValidation: validation, targetCatalog, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_POST_CREATE_IDENTITY_MISMATCH"));
  await rmdir(path.join(target, "PG_17_wrong"));
  await mkdir(versionDirectory, { mode: 0o700 });
  const postCreate = await verifyTablespaceMapAfterCreate({ map, snapshot, policy: recoveryPolicy, preflightValidation: validation, targetCatalog, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace, prohibitedRoots: [path.join(root, "pgdata")] });
  validateTablespaceReceipt(createTablespaceReceipt({ validation: postCreate, backupId: snapshot.binding.backup_id, restoreRunId: "restore-1", verifiedAt: now }));
  assert.equal(await verifyTablespacePathAfterCreate({ preflightValidation: validation, map, snapshot, policy: recoveryPolicy, entryName: "erp_ts", targetLocationSha256: clusterSha256(target) }), true);
  await writeFile(path.join(target, "rogue-sibling"), "x");
  await assert.rejects(verifyTablespaceMapAfterCreate({ map, snapshot, policy: recoveryPolicy, preflightValidation: validation, targetCatalog, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), expectCode("TABLESPACE_POST_CREATE_IDENTITY_MISMATCH"));
  await rm(path.join(target, "rogue-sibling"));
  await chmod(versionDirectory, 0o1700);
  await assert.rejects(verifyTablespacePathAfterCreate({ preflightValidation: validation, map, snapshot, policy: recoveryPolicy, entryName: "erp_ts", targetLocationSha256: clusterSha256(target) }), expectCode("TABLESPACE_POST_CREATE_IDENTITY_MISMATCH"));
  await chmod(versionDirectory, 0o700);
  await chmod(target, 0o755);
  await assert.rejects(verifyTablespaceMapAfterCreate({ map, snapshot, policy: recoveryPolicy, preflightValidation: validation, targetCatalog, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace }), (error) => ["TABLESPACE_POST_CREATE_IDENTITY_MISMATCH", "TABLESPACE_PATH_CHANGED"].includes(error?.code));
  await chmod(target, 0o700);
  await rmdir(versionDirectory);
  assert.equal(await verifyTablespacePathAfterDrop({ preflightValidation: validation, map, snapshot, policy: recoveryPolicy, entryName: "erp_ts", targetLocationSha256: clusterSha256(target) }), true);
}));

test("root-owned credential binding keeps secrets private and detects unsafe files and replacement", async () => withRoot(async (root) => {
  const recoveryPolicy = await policy();
  const credentialRoot = await privateRoot(root, "credentials", CREDENTIAL_ROOT_MARKER, CREDENTIAL_ROOT_MARKER_VALUE);
  const credentialFile = path.join(credentialRoot, "binding.json");
  const secretOwner = "owner-secret-material-000001", secretRuntime = "runtime-secret-material-001";
  const document = { schema_version: 1, contract: CREDENTIAL_FILE_CONTRACT, credential_generation_id: "generation-1", roles: [{ role: "chenyida_erp_owner", password: secretOwner }, { role: "chenyida_erp_runtime", password: secretRuntime }] };
  await writeFile(credentialFile, canonicalClusterJson(document), { mode: 0o400 }); await chmod(credentialFile, 0o400);
  const binding = await readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy });
  assert.equal(credentialPassword(binding, "chenyida_erp_runtime"), secretRuntime);
  assert.equal(await assertCredentialBindingUnchanged(binding), true);
  const receipt = createCredentialBindingReceipt({ binding, backupId: "backup-1", restoreRunId: "restore-1", boundAt: now });
  validateCredentialBindingReceipt(receipt);
  const publicEvidence = canonicalClusterJson({ binding, receipt });
  assert.equal(publicEvidence.includes(secretOwner) || publicEvidence.includes(secretRuntime) || publicEvidence.includes(credentialFile), false);
  const fakePsql = path.join(root, "fake-psql"), bindMarker = path.join(root, "bind-marker");
  await writeFile(fakePsql, `#!/bin/sh\ncase "$*" in *${secretOwner}*|*${secretRuntime}*) exit 71 ;; esac\ntask55_seen=0\nwhile IFS= read -r task55_line; do\n  case "$task55_line" in '${secretOwner}'|'${secretRuntime}') task55_seen=$((task55_seen + 1)) ;; esac\ndone\n[ "$task55_seen" -eq 2 ] || exit 72\nprintf x >> '${bindMarker}'\n`, { mode: 0o700 });
  await chmod(fakePsql, 0o700);
  const applied = await bindClusterCredentialsWithPsql({ binding, policy: recoveryPolicy, psqlPath: fakePsql, psqlArguments: ["--host=/synthetic"], connectionEnvironment: { PGUSER: "synthetic_admin", PGDATABASE: "postgres" } });
  assert.equal(applied.roleCount, 2);
  assert.equal(await readFile(bindMarker, "utf8"), "xx");
  await chmod(credentialFile, 0o644);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_FILE_UNSAFE"));
  await chmod(credentialFile, 0o4400);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_FILE_UNSAFE"));
  await chmod(credentialFile, 0o400); await chmod(credentialRoot, 0o2700);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_ROOT_UNSAFE"));
  await chmod(credentialRoot, 0o700);
  await chmod(credentialFile, 0o600);
  const reused = clone(document); reused.roles[1].password = reused.roles[0].password;
  await writeFile(credentialFile, canonicalClusterJson(reused), { mode: 0o600 }); await chmod(credentialFile, 0o400);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_PASSWORD_REUSE_FORBIDDEN"));
  const missingRole = clone(document); missingRole.roles.pop();
  await chmod(credentialFile, 0o600); await writeFile(credentialFile, canonicalClusterJson(missingRole), { mode: 0o600 }); await chmod(credentialFile, 0o400);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_ROLE_SET_MISMATCH"));
  const duplicateRole = clone(document); duplicateRole.roles[1].role = duplicateRole.roles[0].role;
  await chmod(credentialFile, 0o600); await writeFile(credentialFile, canonicalClusterJson(duplicateRole), { mode: 0o600 }); await chmod(credentialFile, 0o400);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_ROLE_DUPLICATE"));
  await chmod(credentialFile, 0o600); await writeFile(credentialFile, canonicalClusterJson(document), { mode: 0o600 }); await chmod(credentialFile, 0o400);
  const hardlink = path.join(credentialRoot, "binding-hardlink.json"); await link(credentialFile, hardlink);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy }), expectCode("CREDENTIAL_FILE_UNSAFE"));
  await rm(hardlink);
  const symbolic = path.join(credentialRoot, "binding-symbolic.json"); await symlink(credentialFile, symbolic);
  await assert.rejects(readCredentialBindingFile({ credentialRoot, credentialFile: symbolic, policy: recoveryPolicy }), expectCode("CREDENTIAL_FILE_UNSAFE"));
  await chmod(credentialFile, 0o600); await writeFile(credentialFile, `${canonicalClusterJson(document)} `, { mode: 0o600 }); await chmod(credentialFile, 0o400);
  await assert.rejects(assertCredentialBindingUnchanged(binding), expectCode("CREDENTIAL_FILE_CHANGED"));
}));

test("durable recovery state enforces intent-first dispatch, reconciliation and exact idempotency", async () => withRoot(async (root) => {
  const stateRoot = await privateRoot(root, "state", RECOVERY_STATE_ROOT_MARKER, RECOVERY_STATE_ROOT_MARKER_VALUE);
  const tablespaceIdentity = clusterSha256("erp_ts-target-identity");
  const targetIdentity = clusterSha256("target-cluster-identity");
  const intent = createRecoveryIntent({ restore_run_id: "restore-state-1", backup_id: "backup-1", created_at: now, evidence_scope: "SYNTHETIC_TEST_ONLY", policy_sha256: one, snapshot_sha256: two, data_transfer_acceptance_sha256: three, cluster_transfer_acceptance_sha256: zero, joint_transfer_sha256: one, target_system_identifier_sha256: targetIdentity, target_empty_state_sha256: two, credential_generation_id: "generation-1", credential_role_set_sha256: three, tablespace_map_sha256: zero, custom_tablespace_identity_sha256: [tablespaceIdentity] });
  validateRecoveryIntent(intent);
  await writeRecoveryIntent({ stateRoot, intent });
  let state = createInitialRecoveryState(intent, now); await writeRecoveryState({ stateRoot, state, intent });
  const roleState = transitionRecoveryState(state, intent, { phase: "ROLE_SKELETON_APPLIED", recordedAt: "2026-08-13T06:00:01.000Z" });
  assert.throws(() => transitionRecoveryState(roleState, intent, { phase: "DATABASE_COMMAND_DISPATCHED", operation: { kind: "DATABASE", resource_identity_sha256: targetIdentity, payload_sha256: one }, recordedAt: "2026-08-13T06:00:02.000Z" }), expectCode("RECOVERY_STATE_TRANSITION_INVALID"));
  const unpersistedDispatch = transitionRecoveryState(roleState, intent, { phase: "TABLESPACE_COMMAND_DISPATCHED", operation: { kind: "TABLESPACE", resource_identity_sha256: tablespaceIdentity, payload_sha256: one }, recordedAt: "2026-08-13T06:00:02.000Z" });
  await assert.rejects(writeRecoveryState({ stateRoot, state: unpersistedDispatch, intent }), expectCode("RECOVERY_PREVIOUS_STATE_MISSING"));
  await writeRecoveryState({ stateRoot, state: roleState, intent }); state = roleState;
  const tsOperation = { kind: "TABLESPACE", resource_identity_sha256: tablespaceIdentity, payload_sha256: one };
  state = transitionRecoveryState(state, intent, { phase: "TABLESPACE_COMMAND_DISPATCHED", operation: tsOperation, recordedAt: "2026-08-13T06:00:02.000Z" }); await writeRecoveryState({ stateRoot, state, intent });
  assert.equal(transitionRecoveryState(state, intent, { phase: "TABLESPACE_COMMAND_DISPATCHED", operation: tsOperation, recordedAt: "2026-08-13T06:00:03.000Z" }), state);
  assert.throws(() => transitionRecoveryState(state, intent, { phase: "TABLESPACE_COMMAND_DISPATCHED", operation: { ...tsOperation, payload_sha256: two }, recordedAt: "2026-08-13T06:00:03.000Z" }), expectCode("RECOVERY_STATE_IDEMPOTENCY_CONFLICT"));
  state = transitionRecoveryState(state, intent, { phase: "TABLESPACE_RECONCILED_APPLIED", operation: tsOperation, recordedAt: "2026-08-13T06:00:03.000Z" }); await writeRecoveryState({ stateRoot, state, intent });
  state = transitionRecoveryState(state, intent, { phase: "TABLESPACE_VERIFIED", operation: tsOperation, recordedAt: "2026-08-13T06:00:04.000Z" }); await writeRecoveryState({ stateRoot, state, intent });
  const dbOperation = { kind: "DATABASE", resource_identity_sha256: targetIdentity, payload_sha256: two };
  state = transitionRecoveryState(state, intent, { phase: "DATABASE_COMMAND_DISPATCHED", operation: dbOperation, recordedAt: "2026-08-13T06:00:05.000Z" }); await writeRecoveryState({ stateRoot, state, intent });
  state = transitionRecoveryState(state, intent, { phase: "DATABASE_RECONCILED_APPLIED", operation: dbOperation, recordedAt: "2026-08-13T06:00:06.000Z" }); await writeRecoveryState({ stateRoot, state, intent });
  state = transitionRecoveryState(state, intent, { phase: "DATABASE_VERIFIED", operation: dbOperation, recordedAt: "2026-08-13T06:00:07.000Z" }); await writeRecoveryState({ stateRoot, state, intent });
  for (const phase of ["DATA_APPLIED", "SECURITY_VERIFIED", "CREDENTIALS_VERIFIED", "ACTIVATE_PREPARED", "PREPARED", "PUBLISHED"]) {
    state = transitionRecoveryState(state, intent, { phase, recordedAt: new Date(Date.parse(state.recorded_at) + 1000).toISOString() });
    await writeRecoveryState({ stateRoot, state, intent });
  }
  assert.equal(state.phase, "PUBLISHED");
}));

test("restore plan binds every created cluster resource to a content-addressed recovery marker", async () => {
  const { recoveryPolicy, snapshot } = await snapshotFixture();
  const tablespaceMap = {
    schema_version: 2,
    contract: TABLESPACE_MAP_CONTRACT,
    map_id: "marked-plan-map",
    snapshot_sha256: snapshot.snapshot_sha256,
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    approved_host_root: "/synthetic/host/tablespaces",
    approved_server_root: "/synthetic/server/tablespaces",
    namespace_identity_sha256: zero,
    ...syntheticTablespaceMetadata(),
    entries: [{ name: "erp_ts", host_path: "/synthetic/host/tablespaces/erp_ts", server_path: "/synthetic/server/tablespaces/erp_ts" }],
  };
  const databaseProfile = { server_major: "17", encoding: "UTF8", locale_provider: "libc", collate: "C", ctype: "C", collation_version: null };
  const plan = createClusterRestorePlan({ snapshot, policy: recoveryPolicy, tablespaceMap, databaseProfile });
  for (const role of plan.roles) {
    assert.match(role.resource_identity_sha256, /^[0-9a-f]{64}$/u);
    assert.equal(role.recovery_marker, `chenyida-erp-postgresql-recovery/v1:ROLE:${role.resource_identity_sha256}`);
    assert.match(plan.role_skeleton.sql, new RegExp(role.recovery_marker.replaceAll("/", "\\/"), "u"));
  }
  assert.equal(plan.tablespaces[0].recovery_marker, `chenyida-erp-postgresql-recovery/v1:TABLESPACE:${plan.tablespaces[0].resource_identity_sha256}`);
  assert.match(plan.tablespaces[0].sql, /COMMENT ON TABLESPACE/u);
  assert.equal(plan.database.recovery_marker, `chenyida-erp-postgresql-recovery/v1:DATABASE:${plan.database.resource_identity_sha256}`);
  assert.match(plan.database.sql, /CONNECTION LIMIT 0/u);
  assert.match(plan.database.sql, /COMMENT ON DATABASE/u);
});

test("nontransactional executor persists dispatch before mutation and resumes exactly once", async () => withRoot(async (root) => {
  const fixture = await recoveryExecutorFixture(root), adapter = new SyntheticRecoveryAdapter(fixture.targetIdentity), clock = recoveryClock();
  let injected = false;
  await assert.rejects(executeNextNontransactionalRecoveryStep({
    ...fixture,
    adapter,
    confirmation: RECOVERY_EXECUTOR_CONFIRMATION,
    clock,
    faultInjector(stage) {
      if (!injected && stage === "AFTER_DISPATCH_DURABLE") { injected = true; throw new Error("synthetic crash after durable dispatch"); }
    },
  }), /synthetic crash after durable dispatch/u);
  let execution = await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id });
  assert.equal(execution.current.phase, "TABLESPACE_COMMAND_DISPATCHED");
  assert.equal(adapter.dispatches.size, 0);
  const tableResult = await executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock });
  assert.equal(tableResult.state.phase, "TABLESPACE_VERIFIED");
  assert.equal([...adapter.dispatches.values()][0], 1);
  const databaseResult = await executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock });
  assert.equal(databaseResult.status, "NONTRANSACTIONAL_COMPLETE");
  assert.equal(databaseResult.state.phase, "DATABASE_VERIFIED");
  const counts = [...adapter.dispatches.values()];
  assert.deepEqual(counts, [1, 1]);
  const repeated = await executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock });
  assert.equal(repeated.status, "NONTRANSACTIONAL_COMPLETE");
  assert.deepEqual([...adapter.dispatches.values()], counts);
  execution = await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id });
  assert.equal(execution.states.length, 8);
  assert.match(execution.chain_sha256, /^[0-9a-f]{64}$/u);
}));

test("response-loss reconciliation distinguishes applied, partial-marker and retry-safe absent outcomes", async () => withRoot(async (root) => {
  const fixture = await recoveryExecutorFixture(root), adapter = new SyntheticRecoveryAdapter(fixture.targetIdentity), clock = recoveryClock();
  let injected = false;
  await assert.rejects(executeNextNontransactionalRecoveryStep({
    ...fixture,
    adapter,
    confirmation: RECOVERY_EXECUTOR_CONFIRMATION,
    clock,
    faultInjector(stage) {
      if (!injected && stage === "AFTER_INITIAL_COMMAND") { injected = true; throw new Error("synthetic response loss"); }
    },
  }), /synthetic response loss/u);
  assert.equal((await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id })).current.phase, "TABLESPACE_COMMAND_DISPATCHED");
  await executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock });
  assert.deepEqual([...adapter.dispatches.values()], [1]);

  const secondRoot = path.join(root, "partial-fixture"); await mkdir(secondRoot, { mode: 0o700 }); await chmod(secondRoot, 0o700);
  const partial = await recoveryExecutorFixture(secondRoot), partialAdapter = new SyntheticRecoveryAdapter(partial.targetIdentity), partialClock = recoveryClock();
  partialAdapter.dispatchResult = "PARTIAL_CREATED";
  let markerInjected = false;
  await assert.rejects(executeNextNontransactionalRecoveryStep({
    ...partial,
    adapter: partialAdapter,
    confirmation: RECOVERY_EXECUTOR_CONFIRMATION,
    clock: partialClock,
    faultInjector(stage) {
      if (!markerInjected && stage === "AFTER_MARKER_COMMAND") { markerInjected = true; throw new Error("synthetic marker response loss"); }
    },
  }), /synthetic marker response loss/u);
  await executeNextNontransactionalRecoveryStep({ ...partial, adapter: partialAdapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock: partialClock });
  assert.deepEqual([...partialAdapter.dispatches.values()], [1]);
  assert.deepEqual([...partialAdapter.markerFinalizations.values()], [1]);
}));

test("verified tablespace path drift quarantines before the next mutation", async () => withRoot(async (root) => {
  const fixture = await recoveryExecutorFixture(root), adapter = new SyntheticRecoveryAdapter(fixture.targetIdentity), clock = recoveryClock();
  await executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock });
  adapter.pathUnsafe = true;
  await assert.rejects(executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock }), expectCode("RECOVERY_EXECUTOR_VERIFIED_TABLESPACE_PATH_DRIFT_QUARANTINED"));
  assert.equal(adapter.dispatches.size, 1);
  assert.equal((await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id })).current.phase, "QUARANTINED");
}));

test("ambiguous nontransactional resources quarantine and exact compensation refuses dependencies", async () => withRoot(async (root) => {
  const fixture = await recoveryExecutorFixture(root), adapter = new SyntheticRecoveryAdapter(fixture.targetIdentity), clock = recoveryClock();
  adapter.dispatchResult = "CONFLICT";
  await assert.rejects(executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock }), expectCode("RECOVERY_EXECUTOR_RESOURCE_CONFLICT_QUARANTINED"));
  let execution = await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id });
  assert.equal(execution.current.phase, "QUARANTINED");
  assert.equal(execution.current.operation.kind, "TABLESPACE");
  assert.equal(adapter.quarantined, true);
  const key = [...adapter.resources.keys()][0];
  await assert.rejects(compensateQuarantinedRecovery({ ...fixture, adapter, confirmation: RECOVERY_COMPENSATION_CONFIRMATION, clock }), expectCode("RECOVERY_COMPENSATION_TABLESPACE_UNSAFE"));
  adapter.resources.set(key, "APPLIED");
  adapter.dependencies.set(key, 1);
  await assert.rejects(compensateQuarantinedRecovery({ ...fixture, adapter, confirmation: RECOVERY_COMPENSATION_CONFIRMATION, clock }), expectCode("RECOVERY_COMPENSATION_TABLESPACE_UNSAFE"));
  adapter.dependencies.set(key, 0);
  adapter.compensationUnsafe = true;
  await assert.rejects(compensateQuarantinedRecovery({ ...fixture, adapter, confirmation: RECOVERY_COMPENSATION_CONFIRMATION, clock }), expectCode("RECOVERY_COMPENSATION_ROLE_UNSAFE"));
  assert.equal(adapter.resources.get(key), "APPLIED");
  adapter.compensationUnsafe = false;
  const compensated = await compensateQuarantinedRecovery({ ...fixture, adapter, confirmation: RECOVERY_COMPENSATION_CONFIRMATION, clock });
  assert.equal(compensated.status, "COMPENSATED");
  assert.equal(adapter.rolesPresent, false);
  execution = await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id });
  assert.equal(execution.current.phase, "COMPENSATED");
}));

test("executor lock rejects concurrent writers and persisted state files are no-follow immutable evidence", async () => withRoot(async (root) => {
  const fixture = await recoveryExecutorFixture(root), adapter = new SyntheticRecoveryAdapter(fixture.targetIdentity), clock = recoveryClock();
  let releaseDispatch, enteredDispatch;
  const entered = new Promise((resolve) => { enteredDispatch = resolve; });
  const release = new Promise((resolve) => { releaseDispatch = resolve; });
  const originalDispatch = adapter.dispatch.bind(adapter);
  adapter.dispatch = async (resource) => { enteredDispatch(); await release; await originalDispatch(resource); };
  const first = executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock });
  await entered;
  await assert.rejects(executeNextNontransactionalRecoveryStep({ ...fixture, adapter, confirmation: RECOVERY_EXECUTOR_CONFIRMATION, clock }), expectCode("RECOVERY_EXECUTOR_LOCK_BUSY"));
  releaseDispatch();
  assert.equal((await first).state.phase, "TABLESPACE_VERIFIED");
  const evidenceFile = path.join(fixture.stateRoot, "state-executor-restore-1-00000004.json");
  const committedOrphan = path.join(fixture.stateRoot, ".state-executor-restore-1-00000004.json.123.456.tmp");
  await link(evidenceFile, committedOrphan);
  assert.equal((await lstat(evidenceFile)).nlink, 2);
  assert.equal((await readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id })).current.phase, "TABLESPACE_VERIFIED");
  assert.equal((await lstat(evidenceFile)).nlink, 1);
  await assert.rejects(lstat(committedOrphan), (error) => error?.code === "ENOENT");
  await chmod(evidenceFile, 0o600);
  await assert.rejects(readRecoveryExecution({ stateRoot: fixture.stateRoot, restoreRunId: fixture.intent.restore_run_id }), expectCode("RECOVERY_STATE_FILE_INVALID"));
}));

test("executor CLI status is strict and publishes only bounded recovery state", async () => withRoot(async (root) => {
  const fixture = await recoveryExecutorFixture(root);
  let output = "";
  const stdout = { write(chunk) { output += chunk; } };
  const result = await runRecoveryExecutorCli(["status", "--state-root", fixture.stateRoot, "--restore-run-id", fixture.intent.restore_run_id], { stdout });
  assert.equal(result.phase, "ROLE_SKELETON_APPLIED");
  assert.equal(JSON.parse(output).state_sha256, result.state_sha256);
  assert.equal(output.includes("chenyida_erp_runtime"), false);
  assert.equal(output.includes("/synthetic/"), false);
  await assert.rejects(runRecoveryExecutorCli(["status", "--state-root", fixture.stateRoot, "--restore-run-id", fixture.intent.restore_run_id, "--extra", "unsafe"], { stdout }), expectCode("RECOVERY_EXECUTOR_CLI_INVALID"));
}));

test("cluster receipt cross-binds mapped tablespace and credential evidence before source equivalence", async () => withRoot(async (root) => {
  const { recoveryPolicy, catalog, snapshot } = await snapshotFixture();
  const approvedRoot = path.join(root, "receipt-tablespaces"); await mkdir(approvedRoot, { mode: 0o700 }); await chmod(approvedRoot, 0o700);
  const targetPath = path.join(approvedRoot, "erp_ts"); await mkdir(targetPath, { mode: 0o700 }); await chmod(targetPath, 0o700);
  const namespace = clusterSha256("receipt-namespace");
  const tablespaceMap = { schema_version: 2, contract: TABLESPACE_MAP_CONTRACT, map_id: "receipt-map", snapshot_sha256: snapshot.snapshot_sha256, evidence_scope: "SYNTHETIC_TEST_ONLY", approved_host_root: approvedRoot, approved_server_root: approvedRoot, namespace_identity_sha256: namespace, ...syntheticTablespaceMetadata(), entries: [{ name: "erp_ts", host_path: targetPath, server_path: targetPath }] };
  const tablespaceValidation = await validateTablespaceMap({ map: tablespaceMap, snapshot, policy: recoveryPolicy, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace });
  await mkdir(path.join(targetPath, "PG_17_202406281"), { mode: 0o700 });
  const credentialRoot = await privateRoot(root, "receipt-credentials", CREDENTIAL_ROOT_MARKER, CREDENTIAL_ROOT_MARKER_VALUE);
  const credentialFile = path.join(credentialRoot, "binding.json");
  await writeFile(credentialFile, canonicalClusterJson({ schema_version: 1, contract: CREDENTIAL_FILE_CONTRACT, credential_generation_id: "receipt-generation", roles: [{ role: "chenyida_erp_owner", password: "receipt-owner-secret-material-001" }, { role: "chenyida_erp_runtime", password: "receipt-runtime-secret-material-1" }] }), { mode: 0o400 }); await chmod(credentialFile, 0o400);
  const binding = await readCredentialBindingFile({ credentialRoot, credentialFile, policy: recoveryPolicy });
  const credentialReceipt = createCredentialBindingReceipt({ binding, backupId: snapshot.binding.backup_id, restoreRunId: "restore-1", boundAt: now });
  const targetCatalog = clone(catalog); targetCatalog.tablespaces[0].source_location_sha256 = clusterSha256(targetPath);
  const tablespacePostCreate = await verifyTablespaceMapAfterCreate({ map: tablespaceMap, snapshot, policy: recoveryPolicy, preflightValidation: tablespaceValidation, targetCatalog, expectedUid: process.getuid(), expectedGid: process.getgid(), expectedNamespaceIdentitySha256: namespace });
  const tablespaceReceipt = createTablespaceReceipt({ validation: tablespacePostCreate, backupId: snapshot.binding.backup_id, restoreRunId: "restore-1", verifiedAt: now });
  const create = (target) => createClusterSecurityReceipt({ snapshot, targetCatalog: target, policy: recoveryPolicy, tablespaceMap, tablespaceReceipt, credentialReceipt, restoreRunId: "restore-1", verifiedAt: now, evidenceScope: "SYNTHETIC_TEST_ONLY", targetSystemIdentifierSha256: zero });
  const receipt = create(targetCatalog);
  validateClusterSecurityReceipt(receipt, recoveryPolicy);
  assert.equal(receipt.result, "SYNTHETIC_ISOLATED_VERIFIED");
  assert.equal(receipt.tablespace_receipt_sha256, tablespaceReceipt.receipt_sha256);
  assert.equal(receipt.credential_receipt_sha256, credentialReceipt.receipt_sha256);
  const drift = clone(targetCatalog); drift.publications[0].publish_delete = false;
  assert.throws(() => create(drift), expectCode("CLUSTER_RECEIPT_SOURCE_TARGET_MISMATCH"));
  const wrongLocation = clone(targetCatalog); wrongLocation.tablespaces[0].source_location_sha256 = zero;
  assert.throws(() => create(wrongLocation), expectCode("CLUSTER_RECEIPT_TABLESPACE_TARGET_MISMATCH"));
  const wrongCredential = clone(credentialReceipt); wrongCredential.restore_run_id = "other-run";
  assert.throws(() => createClusterSecurityReceipt({ snapshot, targetCatalog, policy: recoveryPolicy, tablespaceMap, tablespaceReceipt, credentialReceipt: wrongCredential, restoreRunId: "restore-1", verifiedAt: now, evidenceScope: "SYNTHETIC_TEST_ONLY", targetSystemIdentifierSha256: zero }), (error) => ["CREDENTIAL_RECEIPT_SHA256_MISMATCH", "CLUSTER_RECEIPT_CREDENTIAL_BINDING_MISMATCH"].includes(error?.code));
}));
