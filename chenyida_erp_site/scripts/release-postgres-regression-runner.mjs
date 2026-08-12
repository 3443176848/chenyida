import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildMigrationAllowlist } from "./release-manifest-contract.mjs";
import { loadOfficialReleaseTestInventory, verifyReleaseTestInventory } from "./release-test-inventory.mjs";

const CANDIDATE_ROOT = "/workspace";
const SUPERVISOR_ROOT = "/supervisor";
const ADMIN_DATABASE_URL = "postgresql://postgres@127.0.0.1:5432/postgres";
// The isolated PostgreSQL server uses trust auth; the non-secret placeholder only
// satisfies the recovery tools' requirement that a credential-bearing URL was supplied.
const SOURCE_DATABASE_URL = "postgresql://chenyida_erp:x@postgres:5432/chenyida_erp";
const EXPECTED_POSTGRES_TESTS = 83;
const DATABASE_ENVIRONMENT = /^(?:DATABASE_URL|MIGRATION_TEST_DATABASE_URL|TEST_DATABASE_URL|TEST_[A-Z0-9_]+_DATABASE_URL)$/;
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const TEMPLATE_NAMES = Object.freeze({
  17: "cyd_release_regression_template_17",
  36: "cyd_release_regression_template_36",
  44: "cyd_release_regression_template_44",
});
const EXACT_DATABASE_NAMES = new Map([
  ["TEST_PROCUREMENT_SOURCING_DATABASE_URL", "procurement_sourcing_test_fix22_20260805"],
  ["TEST_RFQ_TRACEABILITY_MIGRATION_DATABASE_URL", "rfq_traceability_migration_test_fix22_20260805"],
]);
const DATABASE_STEM_OVERRIDES = new Map([
  ["TEST_GOVERNANCE_UPGRADE_DATABASE_URL", "material_governance_upgrade_test"],
  ["TEST_MIGRATION_OPENINGS_UPGRADE_DATABASE_URL", "opening_upgrade_test"],
  ["TEST_MIGRATION_OPENINGS_DATABASE_URL", "migration_openings_migration_test"],
  ["TEST_OPERATIONS_MATERIAL_REVIEW_DATABASE_URL", "ops_review_test"],
  ["TEST_PRODUCTION_QUALITY_GATE_DATABASE_URL", "production_operation_quality_gate_test"],
  ["TEST_PRODUCTION_QUALITY_GATE_UPGRADE_DATABASE_URL", "production_operation_quality_gate_upgrade_test"],
  ["TEST_PUBLIC_MATERIALIZATION_DATABASE_URL", "public_materialization_migration_test"],
  ["TEST_UPGRADE_DATABASE_URL", "mapping_upgrade_test"],
]);
const FIXED_17_TESTS = new Set([
  "tests/selfhost-migration-materializer-postgres.test.mjs",
  "tests/selfhost-migration-openings-postgres.test.mjs",
  "tests/selfhost-migration-postgres.test.mjs",
]);
const EMPTY_DATABASE_TESTS = new Set([
  "tests/selfhost-ai-governance-suggestion-postgres.test.mjs",
  "tests/selfhost-supplier-mapping-postgres.test.mjs",
  "tests/selfhost-targeted-offline-identity-recovery-postgres.test.mjs",
]);

class PostgresRegressionError extends Error {
  constructor(code) {
    super(code);
    this.name = "PostgresRegressionError";
    this.code = code;
  }
}

function reject(code) {
  throw new PostgresRegressionError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value) {
  if (!DATABASE_NAME.test(value)) reject("POSTGRES_REGRESSION_DATABASE_NAME_INVALID");
  return `"${value}"`;
}

function parseTapSummary(stdout) {
  const values = new Map();
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)) {
    if (values.has(match[1])) reject("POSTGRES_REGRESSION_TAP_SUMMARY_AMBIGUOUS");
    values.set(match[1], Number(match[2]));
  }
  if (["tests", "pass", "fail", "cancelled", "skipped", "todo"].some((key) => !values.has(key))) reject("POSTGRES_REGRESSION_TAP_SUMMARY_MISSING");
  return Object.fromEntries(values);
}

function boundedOutput(value) {
  const text = typeof value === "string" ? value : "";
  return text.length <= 32_768 ? text : text.slice(-32_768);
}

function databaseEnvironmentNames(source) {
  const names = [...new Set([...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*DATABASE_URL)/g)].map((match) => match[1]))].sort();
  if (names.length < 1 || names.length > 3 || names.some((name) => !DATABASE_ENVIRONMENT.test(name))) reject("POSTGRES_REGRESSION_DATABASE_ENVIRONMENT_INVALID");
  return names;
}

function primaryDatabaseEnvironment(names) {
  if (names.includes("MIGRATION_TEST_DATABASE_URL")) return "MIGRATION_TEST_DATABASE_URL";
  const specialized = names.filter((name) => name.startsWith("TEST_") && name !== "TEST_DATABASE_URL").sort((left, right) => right.length - left.length);
  if (specialized.length > 0) return specialized[0];
  if (names.includes("TEST_DATABASE_URL")) return "TEST_DATABASE_URL";
  if (names.length === 1 && names[0] === "DATABASE_URL") return "DATABASE_URL";
  reject("POSTGRES_REGRESSION_PRIMARY_DATABASE_ENVIRONMENT_INVALID");
}

function normalDatabaseName(primary, testPath) {
  const exact = EXACT_DATABASE_NAMES.get(primary);
  if (exact) return exact;
  let stem = DATABASE_STEM_OVERRIDES.get(primary);
  if (!stem && primary === "MIGRATION_TEST_DATABASE_URL") stem = "migration_test";
  if (!stem && primary === "TEST_DATABASE_URL") stem = "generic_test";
  if (!stem && primary.startsWith("TEST_") && primary.endsWith("_DATABASE_URL")) {
    stem = `${primary.slice(5, -13).toLowerCase()}_test`;
  }
  if (!stem || !/^[a-z][a-z0-9_]{0,47}$/.test(stem)) reject("POSTGRES_REGRESSION_DATABASE_STEM_INVALID");
  const result = `cyd_${stem}_${sha256(testPath).slice(0, 8)}`;
  if (!DATABASE_NAME.test(result)) reject("POSTGRES_REGRESSION_DATABASE_NAME_INVALID");
  return result;
}

function databaseConfiguration(entry, source) {
  if (entry.path === "tests/selfhost-offline-identity-recovery-postgres.test.mjs") {
    const database = `cyd_oir_test_${sha256(entry.path).slice(0, 12)}`;
    return { database, template: TEMPLATE_NAMES[36], owner: "chenyida_erp", variables: ["DATABASE_URL"], extras: { RECOVERY_EXPECTED_DATABASE: database, RECOVERY_REWRITE_DATABASE_PATH: "1" }, sourceUrl: true };
  }
  if (entry.path === "tests/selfhost-targeted-offline-identity-recovery-postgres.test.mjs") {
    const database = `cyd_toir_test_${sha256(entry.path).slice(0, 12)}`;
    return { database, template: "template0", owner: "chenyida_erp", variables: ["DATABASE_URL"], extras: { TARGETED_RECOVERY_EXPECTED_DATABASE: database, TARGETED_RECOVERY_REWRITE_DATABASE_PATH: "1" }, sourceUrl: true };
  }
  const variables = databaseEnvironmentNames(source);
  const primary = primaryDatabaseEnvironment(variables);
  const database = normalDatabaseName(primary, entry.path);
  let template = TEMPLATE_NAMES[44];
  if (FIXED_17_TESTS.has(entry.path)) template = TEMPLATE_NAMES[17];
  else if (EMPTY_DATABASE_TESTS.has(entry.path) || /-migration(?:-upgrade)?\.test\.mjs$/.test(entry.path)) template = "template0";
  const extras = {};
  if (primary === "TEST_PROCUREMENT_SOURCING_DATABASE_URL") extras.ERP_PROCUREMENT_SOURCING_TEST_CONFIRM = "ISOLATED_FIX22_SYNTHETIC_ONLY";
  if (primary === "TEST_RFQ_TRACEABILITY_MIGRATION_DATABASE_URL") extras.ERP_RFQ_TRACEABILITY_FIX22_MIGRATION_CONFIRM = "ISOLATED_FIX22_SYNTHETIC_ONLY";
  if (entry.path === "tests/selfhost-dashboard-postgres.test.mjs") {
    extras.ERP_BACKUP_EXPECTED_RESTORE_TARGET_SYSTEM_IDENTIFIER = "9999999999999999999";
    extras.ERP_BACKUP_EXPECTED_RESTORE_TARGET_CLUSTER_MARKER_ID = "dashboard-isolated-target-cluster";
    extras.ERP_BACKUP_POLICY_ID = "daily-rpo-v1";
    extras.ERP_BACKUP_RPO_HOURS = "24";
    extras.ERP_BACKUP_EXPECTED_OFFHOST_LOCATION_ID = "dashboard-offhost";
    extras.ERP_BACKUP_EXPECTED_OFFHOST_RECEIVER_IDENTITY_SHA256 = "d".repeat(64);
    extras.ERP_BACKUP_EXPECTED_RESTORE_LOCATION_ID = "dashboard-restore-location";
    extras.ERP_BACKUP_EXPECTED_RESTORE_TARGET_ID = "dashboard-restore-target";
    extras.ERP_BACKUP_EVIDENCE_TRUST_MODE = "TRUSTED_ROOT_EXECUTOR";
    extras.ERP_RUNTIME_BUILD_VERSION = "0.1.0-alpha.46";
    extras.ERP_RUNTIME_GIT_COMMIT = "b".repeat(40);
  }
  return { database, template, owner: "postgres", variables, extras, sourceUrl: false, databaseComment: entry.path === "tests/selfhost-dashboard-postgres.test.mjs" ? "chenyida-erp-deployment/v2:TEST:dashboard-test" : null };
}

function childEnvironment(configuration) {
  const targetUrl = `postgresql://postgres@127.0.0.1:5432/${configuration.database}`;
  const environment = {
    PATH: "/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin",
    HOME: "/tmp",
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    TMPDIR: "/tmp",
    CI: "1",
    NODE_ENV: "test",
    NODE_OPTIONS: "--max-old-space-size=384",
    ERP_ENV: "test",
    ERP_DEPLOYMENT_CLASS: "test",
    DATABASE_POOL_MAX: "30",
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
    PGUSER: "postgres",
    ...configuration.extras,
  };
  for (const name of configuration.variables) environment[name] = name === "DATABASE_URL" && configuration.sourceUrl ? SOURCE_DATABASE_URL : targetUrl;
  if (!configuration.sourceUrl) environment.DATABASE_URL = targetUrl;
  return environment;
}

async function createDatabase(admin, database, template, owner = "postgres") {
  quoteIdentifier(database);
  quoteIdentifier(template);
  quoteIdentifier(owner);
  const present = await admin.query("select count(*)::int count from pg_database where datname=$1", [database]);
  if (present.rows[0].count !== 0) reject("POSTGRES_REGRESSION_DATABASE_ALREADY_EXISTS");
  await admin.query(`create database ${quoteIdentifier(database)} owner ${quoteIdentifier(owner)} template ${quoteIdentifier(template)}`);
}

async function dropDatabase(admin, database) {
  if (!DATABASE_NAME.test(database)) reject("POSTGRES_REGRESSION_DATABASE_NAME_INVALID");
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [database]);
  await admin.query(`drop database if exists ${quoteIdentifier(database)}`);
}

async function buildTemplate({ Pool, admin, name, migrations, owner = "postgres" }) {
  await createDatabase(admin, name, "template0", owner);
  const databaseUrl = `postgresql://${owner}:x@127.0.0.1:5432/${name}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "release-postgres-regression-template" });
  try {
    await pool.query("create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
    for (const migration of migrations) {
      const source = await readFile(path.join(CANDIDATE_ROOT, "drizzle-postgres", migration.filename), "utf8");
      if (sha256(source) !== migration.sha256) reject("POSTGRES_REGRESSION_MIGRATION_SHA256_MISMATCH");
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(source);
        await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [migration.filename, migration.sha256]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    const applied = await pool.query("select version,checksum from schema_migrations order by version");
    if (applied.rowCount !== migrations.length || applied.rows.some((row, index) => row.version !== migrations[index].filename || row.checksum !== migrations[index].sha256)) reject("POSTGRES_REGRESSION_TEMPLATE_MIGRATIONS_INVALID");
  } finally {
    await pool.end();
  }
  await admin.query(`alter database ${quoteIdentifier(name)} with allow_connections false`);
}

async function main() {
  if (process.argv.length !== 2 || process.cwd() !== CANDIDATE_ROOT) reject("POSTGRES_REGRESSION_INVOCATION_INVALID");
  const require = createRequire(path.join(CANDIDATE_ROOT, "package.json"));
  const { Pool } = require("pg");
  const inventory = await loadOfficialReleaseTestInventory({ root: CANDIDATE_ROOT, supervisorRoot: SUPERVISOR_ROOT });
  const selected = inventory.tests.filter((entry) => entry.applicability === "REQUIRED" && entry.harness === "POSTGRES_REGRESSION");
  if (selected.length !== EXPECTED_POSTGRES_TESTS) reject("POSTGRES_REGRESSION_TEST_SET_INVALID");
  const migrations = await buildMigrationAllowlist(path.join(CANDIDATE_ROOT, "drizzle-postgres"));
  if (migrations.length !== 45 || migrations.at(-1)?.filename !== "0045_runtime_worker_readiness.sql") reject("POSTGRES_REGRESSION_MIGRATION_SET_INVALID");
  const admin = new Pool({ connectionString: ADMIN_DATABASE_URL, max: 1, application_name: "release-postgres-regression-admin" });
  const created = [];
  let testCount = 0;
  try {
    await admin.query("create role chenyida_erp login nosuperuser nocreatedb nocreaterole noinherit");
    for (const head of [17, 36, 44]) {
      const name = TEMPLATE_NAMES[head];
      await buildTemplate({ Pool, admin, name, migrations: migrations.slice(0, head), owner: head === 36 ? "chenyida_erp" : "postgres" });
      created.push(name);
    }
    for (const entry of selected) {
      const source = await readFile(path.join(CANDIDATE_ROOT, entry.path), "utf8");
      if (sha256(source) !== entry.sha256) reject("POSTGRES_REGRESSION_TEST_SHA256_MISMATCH");
      const configuration = databaseConfiguration(entry, source);
      await createDatabase(admin, configuration.database, configuration.template, configuration.owner);
      if (configuration.databaseComment) await admin.query(`comment on database ${quoteIdentifier(configuration.database)} is 'chenyida-erp-deployment/v2:TEST:dashboard-test'`);
      created.push(configuration.database);
      let result;
      try {
        result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", entry.path], {
          cwd: CANDIDATE_ROOT,
          encoding: "utf8",
          env: childEnvironment(configuration),
          maxBuffer: 64 * 1024 * 1024,
          timeout: 30 * 60 * 1000,
        });
      } finally {
        await dropDatabase(admin, configuration.database);
        created.splice(created.lastIndexOf(configuration.database), 1);
      }
      if (result.error || result.signal || result.status !== 0) {
        process.stderr.write(boundedOutput(result.stdout));
        process.stderr.write(boundedOutput(result.stderr));
        reject(result.error?.code === "ETIMEDOUT" ? "POSTGRES_REGRESSION_TEST_TIMEOUT" : "POSTGRES_REGRESSION_TEST_FAILED");
      }
      const summary = parseTapSummary(result.stdout);
      if (summary.tests < 1 || summary.pass !== summary.tests || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0) reject("POSTGRES_REGRESSION_TEST_RESULT_INVALID");
      testCount += summary.tests;
      process.stdout.write(`POSTGRES TEST PASS ${entry.path} tests=${summary.tests} sha256=${entry.sha256}\n`);
    }
    await verifyReleaseTestInventory({ root: CANDIDATE_ROOT, inventory });
    const pathSetSha256 = sha256(selected.map((entry) => `${entry.path}\n`).join(""));
    process.stdout.write(`POSTGRES INVENTORY RUN PASS files=${selected.length} tests=${testCount} path_set_sha256=${pathSetSha256}\n`);
  } finally {
    for (const database of created.reverse()) await dropDatabase(admin, database).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.code || "POSTGRES_REGRESSION_FAILED"}\n`);
  process.exitCode = 1;
});
