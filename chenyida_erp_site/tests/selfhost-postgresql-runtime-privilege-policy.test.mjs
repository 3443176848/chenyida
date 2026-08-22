import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseStrictJson } from "../scripts/backup-recovery-contract.mjs";
import {
  createRuntimePrivilegePolicy,
  validateRuntimePrivilegePolicy,
  verifyRuntimePrivilegePolicySources,
} from "../scripts/postgresql-runtime-privilege-policy.mjs";
import {
  createControlledRuntimePrivilegeBootstrapPlan,
  createRuntimePrivilegeBootstrapPlan,
  createRuntimePrivilegeDesiredState,
  createRuntimePrivilegeReconciliationIntent,
  createRuntimePrivilegeReconciliationPlan,
  decideRuntimePrivilegeInterruptedRecovery,
  runtimePrivilegeControlledBaselineNeedsOwnershipBootstrap,
  renderIsolatedPsql,
  transitionRuntimePrivilegeIntent,
  validateRuntimePrivilegeState,
} from "../scripts/postgresql-runtime-privilege-reconciler.mjs";
import { validateRuntimePrivilegeCompiledCatalog } from "../scripts/postgresql-runtime-privilege-catalog.mjs";
import { validateRuntimePrivilegeAccessDocument } from "../scripts/postgresql-runtime-privilege-source.mjs";

const access = validateRuntimePrivilegeAccessDocument(parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-access-v2.json", import.meta.url), "utf8")));
const catalog = validateRuntimePrivilegeCompiledCatalog(parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-compiled-catalog-v1.json", import.meta.url), "utf8")), { access });
const policy = await createRuntimePrivilegePolicy();
const policyArtifact = validateRuntimePrivilegePolicy(parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-policy-v2.json", import.meta.url), "utf8")), { access, catalog });
const sources = Object.freeze({ policy, access, catalog });
const target = Object.freeze({ database_oid: "16384", system_identifier_sha256: "a".repeat(64), marker_sha256: "b".repeat(64) });
const engine = Object.freeze({
  server_version_num: policy.source_binding.engine_binding.server_version_num,
  encoding: policy.database.encoding,
  locale_provider: policy.database.locale_provider,
  collate: policy.database.collate,
  ctype: policy.database.ctype,
  collation_version: policy.database.collation_version,
});

function compareC(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function aclKey(record) {
  return `${record.kind}\u0001${record.identity}\u0001${record.grantee}\u0001${record.privilege_type}\u0001${record.grantor}`;
}

function publicAcl(kind, identity, owner, privilegeType) {
  return { kind, identity, owner, grantor: owner, grantee: "PUBLIC", privilege_type: privilegeType, is_grantable: false };
}

function initialBaseline() {
  const seed = { target, engine };
  const final = createRuntimePrivilegeDesiredState(seed, sources);
  const objectAcl = [
    publicAcl("DATABASE", policy.database.name, policy.database.owner, "CONNECT"),
    publicAcl("DATABASE", policy.database.name, policy.database.owner, "TEMPORARY"),
    publicAcl("SCHEMA", policy.schema.name, policy.schema.owner, "USAGE"),
    ...catalog.catalog.routines.map((item) => publicAcl("ROUTINE", item.identity, item.owner === "MIGRATION_OWNER" ? policy.identities.migration_owner : item.owner, "EXECUTE")),
    ...catalog.catalog.standalone_types.map((item) => publicAcl("TYPE", item.identity, item.owner, "USAGE")),
  ].sort((left, right) => compareC(aclKey(left), aclKey(right)));
  const publicObjects = new Set(objectAcl.map((record) => `${record.kind}\u0001${record.identity}`));
  const storage = final.object_acl_storage.map((record) => ({
    ...record,
    acl_state: publicObjects.has(`${record.kind}\u0001${record.identity}`) ? "EXPLICIT" : "NULL",
    acl_item_count: publicObjects.has(`${record.kind}\u0001${record.identity}`) ? 2 : 1,
  }));
  return {
    ...final,
    database: { ...final.database, connection_limit: -1 },
    roles: final.roles.filter((role) => role.name === policy.identities.migration_owner),
    memberships: [],
    object_acl: objectAcl,
    object_acl_storage: storage,
    default_privilege_scopes: [],
    default_privileges: [],
    default_privilege_row_count: 0,
  };
}

function controlledLegacyBaseline() {
  const baseline = structuredClone(initialBaseline());
  baseline.database.owner = policy.identities.platform_owner;
  baseline.roles = [];
  baseline.object_acl = baseline.object_acl.map((record) => record.owner === policy.identities.migration_owner
    ? { ...record, owner: policy.identities.platform_owner, grantor: policy.identities.platform_owner }
    : record);
  baseline.object_acl_storage = baseline.object_acl_storage.map((record) => record.owner === policy.identities.migration_owner
    ? { ...record, owner: policy.identities.platform_owner }
    : record);
  return baseline;
}

function sortedAcl(records) {
  return records.sort((left, right) => compareC(aclKey(left), aclKey(right)));
}

test("v2 policy artifact is exact, source-fresh and fixes five physical identities, exact ACL counts and global defaults", async () => {
  assert.deepEqual(policyArtifact, policy);
  assert.deepEqual(await verifyRuntimePrivilegePolicySources(policyArtifact), policy);
  assert.equal(validateRuntimePrivilegePolicy(policy, { access, catalog }), policy);
  assert.deepEqual(Object.keys(policy.service_bindings), ["ADMIN", "BACKUP", "MIGRATION", "WEB", "WORKER"]);
  assert.equal(policy.roles.length, 9);
  assert.equal(policy.memberships.length, 4);
  assert.equal(policy.service_bindings.MIGRATION.login, "chenyida_erp_owner");
  assert.equal(policy.service_bindings.MIGRATION.privilege_group, null);
  assert.equal(policy.service_bindings.MIGRATION.ddl_allowed, true);
  assert.equal(policy.service_bindings.MIGRATION.schema_migrations_write, true);
  assert.deepEqual(policy.acl_summary.tuple_counts, { database: 4, schema: 4, table: 813, sequence: 411, routine: 29, type: 0, tablespace: 0, large_object: 0, total: 1261 });
  assert.deepEqual(policy.default_privileges.map((item) => [item.object_kind, item.scope, item.schema, item.materialized_row_required]), [
    ["SEQUENCE", "SCHEMA", "public", false],
    ["TABLE", "SCHEMA", "public", false],
    ["ROUTINE", "GLOBAL", null, true],
    ["TYPE", "GLOBAL", null, true],
  ]);
  assert.deepEqual(policy.resolves.map((item) => item.code), ["POSTGRESQL17_COMPILED_CATALOG_REQUIRED"]);
  assert.equal(policy.database.default_tablespace, "pg_default");
  assert.equal(policy.tablespaces.owner, "PLATFORM_OWNER");
});

test("desired state contains exact group ACL, owner-only physical defaults and complete object storage", () => {
  const baseline = initialBaseline();
  assert.equal(validateRuntimePrivilegeState(baseline, { ...sources, mode: "baseline" }), baseline);
  const desired = createRuntimePrivilegeDesiredState(baseline, sources);
  assert.equal(validateRuntimePrivilegeState(desired, { ...sources, mode: "final", expectedTarget: target, expectedFinal: desired }), desired);
  assert.equal(desired.object_acl.length, 1261);
  assert.equal(desired.object_acl_storage.length, 849);
  assert.equal(desired.object_acl.filter((item) => item.kind === "TABLE").length, 813);
  assert.equal(desired.object_acl.filter((item) => item.kind === "SEQUENCE").length, 411);
  assert.equal(desired.object_acl.filter((item) => item.kind === "ROUTINE").length, 29);
  assert.equal(new Set(desired.object_acl.filter((item) => item.kind === "ROUTINE").map((item) => item.identity)).size, 28);
  assert.deepEqual(desired.default_privilege_scopes, [
    { owner: "chenyida_erp_owner", schema: "ALL", object_kind: "ROUTINE" },
    { owner: "chenyida_erp_owner", schema: "ALL", object_kind: "TYPE" },
  ]);
  assert.equal(desired.default_privilege_row_count, 2);
  assert.deepEqual(desired.default_privileges, []);
  assert.deepEqual(desired.object_acl.filter((item) => item.identity === "public.schema_migrations").map((item) => [item.grantee, item.privilege_type]), [
    ["chenyida_erp_backup_priv", "SELECT"],
    ["chenyida_erp_web_priv", "SELECT"],
    ["chenyida_erp_worker_priv", "SELECT"],
  ]);
});

test("baseline validation fails closed on unknown authority, direct ACL, grant option and unsupported physical surfaces", () => {
  const mutations = [
    (value) => { value.roles.push({ ...value.roles[0], name: "chenyida_erp_rogue" }); value.roles.sort((a, b) => compareC(a.name, b.name)); },
    (value) => { value.memberships.push({ role: "pg_read_all_data", member: "chenyida_erp_owner", grantor: "PLATFORM_OWNER", admin_option: false, inherit_option: true, set_option: true }); },
    (value) => { value.object_acl.push({ ...value.object_acl[0], grantee: "chenyida_erp_web" }); value.object_acl = sortedAcl(value.object_acl); },
    (value) => { value.object_acl[0].is_grantable = true; },
    (value) => { value.object_acl_storage[0].owner_privileges.push({ privilege_type: "CONNECT", is_grantable: true }); },
    (value) => { value.role_settings.push({ role_scope: "ALL", database_scope: "ALL", settings: ["search_path=public"] }); },
    (value) => { value.column_acl_object_count = 1; },
    (value) => { value.parameter_acl_row_count = 1; },
    (value) => { value.custom_tablespace_count = 1; },
    (value) => { value.large_object_count = 1; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(initialBaseline());
    mutate(value);
    assert.throws(() => validateRuntimePrivilegeState(value, { ...sources, mode: "baseline" }), /RUNTIME_PRIVILEGE_/);
  }
});

test("planner separates role bootstrap, emits migration lock and exact default scopes, then becomes a no-op", () => {
  const baseline = initialBaseline();
  assert.throws(() => createRuntimePrivilegeReconciliationPlan(baseline, sources), /RUNTIME_PRIVILEGE_ROLE_BOOTSTRAP_REQUIRED/);
  const bootstrap = createRuntimePrivilegeBootstrapPlan(baseline, sources);
  assert.equal(bootstrap.no_op, false);
  assert.equal(bootstrap.role_bootstrap, true);
  assert.match(bootstrap.statements[0], /chenyida_erp_schema_migration/);
  assert.ok(bootstrap.statements.some((statement) => /^CREATE ROLE "chenyida_erp_web"/.test(statement)));
  assert.ok(bootstrap.statements.some((statement) => statement === "ALTER DEFAULT PRIVILEGES FOR ROLE \"chenyida_erp_owner\" REVOKE ALL PRIVILEGES ON ROUTINES FROM PUBLIC, \"chenyida_erp_admin_priv\", \"chenyida_erp_backup_priv\", \"chenyida_erp_web_priv\", \"chenyida_erp_worker_priv\", \"chenyida_erp_admin\", \"chenyida_erp_backup\", \"chenyida_erp_web\", \"chenyida_erp_worker\""));
  assert.ok(bootstrap.statements.some((statement) => statement.includes("IN SCHEMA \"public\" REVOKE ALL PRIVILEGES ON TABLES")));
  assert.ok(bootstrap.statements.some((statement) => statement.includes("REVOKE ALL PRIVILEGES ON ROUTINE public.digest(bytea,text)")));
  const rendered = renderIsolatedPsql(bootstrap);
  const rollback = rendered.indexOf("  ROLLBACK;");
  const lockFailure = rendered.indexOf(
    "RAISE EXCEPTION 'RUNTIME_PRIVILEGE_MIGRATION_LOCK_UNAVAILABLE';",
  );
  assert.ok(rollback >= 0 && lockFailure > rollback);
  assert.doesNotMatch(rendered, /\\(?:quit|q)[ \t]+\S/u);

  const reconcilerBaseline = { ...baseline, roles: bootstrap.desired.roles, memberships: bootstrap.desired.memberships };
  const reconciliation = createRuntimePrivilegeReconciliationPlan(reconcilerBaseline, sources);
  assert.equal(reconciliation.role_bootstrap, false);
  assert.equal(reconciliation.no_op, false);
  assert.ok(reconciliation.statements.every((statement) => !statement.startsWith("CREATE ROLE")));

  const noOp = createRuntimePrivilegeReconciliationPlan(bootstrap.desired, sources);
  assert.equal(noOp.no_op, true);
  assert.equal(noOp.role_bootstrap, false);
  assert.deepEqual(noOp.statements, []);
});

test("controlled bootstrap accepts only an exact all-platform legacy owner class and enumerates every transfer", () => {
  const baseline = controlledLegacyBaseline();
  assert.equal(validateRuntimePrivilegeState(baseline, { ...sources, mode: "controlled" }), baseline);
  assert.throws(() => validateRuntimePrivilegeState(baseline, { ...sources, mode: "baseline" }), /RUNTIME_PRIVILEGE_STATE_DATABASE_DRIFT/);
  assert.equal(runtimePrivilegeControlledBaselineNeedsOwnershipBootstrap(baseline, sources), true);

  const plan = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources);
  assert.equal(plan.no_op, false);
  assert.equal(plan.role_bootstrap, true);
  assert.equal(validateRuntimePrivilegeState(plan.desired, { ...sources, mode: "final", expectedFinal: plan.desired }), plan.desired);
  assert.ok(plan.statements.some((statement) => statement === 'ALTER DATABASE "chenyida_erp" OWNER TO "chenyida_erp_owner"'));
  assert.ok(plan.statements.some((statement) => statement === 'ALTER TABLE "public"."app_meta" OWNER TO "chenyida_erp_owner"'));
  assert.ok(plan.statements.some((statement) => statement.startsWith('ALTER SEQUENCE "public".')));
  assert.ok(plan.statements.some((statement) => statement.startsWith('ALTER ROUTINE public.')));
  assert.ok(plan.statements.every((statement) => !statement.includes("REASSIGN OWNED")));
  assert.ok(plan.statements.every((statement) => !statement.startsWith("ALTER ROUTINE public.digest(")));
  const lastCreate = plan.statements.reduce((index, statement, current) => statement.startsWith("CREATE ROLE ") ? current : index, -1);
  const firstTransfer = plan.statements.findIndex((statement) => /^ALTER (DATABASE|TABLE|SEQUENCE|ROUTINE) /.test(statement));
  assert.ok(lastCreate >= 0 && firstTransfer > lastCreate);

  const mixed = structuredClone(baseline);
  mixed.object_acl_storage.find((record) => record.owner === policy.identities.platform_owner && record.kind === "TABLE").owner = policy.identities.migration_owner;
  assert.throws(() => createControlledRuntimePrivilegeBootstrapPlan(mixed, sources), /RUNTIME_PRIVILEGE_CONTROLLED_OWNER_CLASS_INVALID/);

  const partialRoles = structuredClone(baseline);
  partialRoles.roles = [plan.desired.roles.find((role) => role.name === "chenyida_erp_web")];
  assert.throws(() => createControlledRuntimePrivilegeBootstrapPlan(partialRoles, sources), /RUNTIME_PRIVILEGE_CONTROLLED_ROLE_CLASS_INVALID/);
});

test("durable v2 intent has monotonic transitions and ambiguous result recovery quarantines third states", () => {
  const baseline = initialBaseline();
  const plan = createRuntimePrivilegeBootstrapPlan(baseline, sources);
  const intent = createRuntimePrivilegeReconciliationIntent(plan, "2026-08-13T00:00:00.000Z");
  assert.equal(intent.state, "INTENT_DURABLE");
  const dispatched = transitionRuntimePrivilegeIntent(intent, "TRANSACTION_DISPATCHED");
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(intent, baseline), "RETRY_TRANSACTION");
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(intent, plan.desired), "QUARANTINE");
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(dispatched, baseline), "RETRY_TRANSACTION");
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(dispatched, plan.desired), "FINISH_VERIFICATION");
  const third = structuredClone(baseline);
  third.database.connection_limit = 1;
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(dispatched, third), "QUARANTINE");
  const captured = transitionRuntimePrivilegeIntent(dispatched, "POSTCOMMIT_CAPTURED");
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(captured, baseline), "QUARANTINE");
  assert.equal(decideRuntimePrivilegeInterruptedRecovery(captured, plan.desired), "FINISH_VERIFICATION");
  const verified = transitionRuntimePrivilegeIntent(captured, "VERIFIED");
  assert.equal(verified.state, "VERIFIED");
  assert.throws(() => transitionRuntimePrivilegeIntent(verified, "TRANSACTION_DISPATCHED"), /RUNTIME_PRIVILEGE_INTENT_TRANSITION_INVALID/);
});
