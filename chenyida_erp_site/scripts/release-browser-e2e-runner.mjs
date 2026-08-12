import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { buildMigrationAllowlist } from "./release-manifest-contract.mjs";
import { loadOfficialReleaseTestInventory, verifyReleaseTestInventory } from "./release-test-inventory.mjs";

const CANDIDATE_ROOT = "/workspace";
const SUPERVISOR_ROOT = "/supervisor";
const ADMIN_DATABASE_URL = "postgresql://postgres@127.0.0.1:5432/postgres";
const SERVER_ENTRY = "/workspace/dist/standalone/server.js";
const EXPECTED_BROWSER_FILES = 6;
const EXPECTED_BROWSER_TESTS = 11;
const EXPECTED_MIGRATION_HEAD = "0045_runtime_worker_readiness.sql";
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const CONFIGURATIONS = Object.freeze([
  {
    path: "tests/selfhost-planning-revision-response-browser.test.mjs",
    database: "cyd_planning_revision_browser_test_0037",
    head: 37,
    migration: "0037_project_planning_revision_response_lineage.sql",
    port: 43137,
    confirmation: ["ERP_PLANNING_REVISION_BROWSER_CONFIRM", "ISOLATED_0037_SYNTHETIC_ONLY"],
    externalServer: true,
  },
  {
    path: "tests/selfhost-purchase-traceability-browser.test.mjs",
    database: "erp_fix18_material_requirement_test",
    head: 37,
    migration: "0037_project_planning_revision_response_lineage.sql",
    port: 43138,
    confirmation: ["ERP_PURCHASE_SUPPLY_BROWSER_CONFIRM", "ISOLATED_FIX18_SYNTHETIC_ONLY"],
    externalServer: false,
  },
  {
    path: "tests/selfhost-requirement-unit-resolution-browser.test.mjs",
    database: "cyd_unit_resolution_browser_test_0036",
    head: 36,
    migration: "0036_project_requirement_unit_resolution.sql",
    port: 43136,
    confirmation: ["ERP_REQUIREMENT_UNIT_BROWSER_CONFIRM", "ISOLATED_0036_SYNTHETIC_ONLY"],
    environment: ["ERP_PLANNING_TRACEABILITY_BROWSER_MODE", "TRACEABILITY_RETURN_ONLY"],
    externalServer: true,
  },
  {
    path: "tests/selfhost-rfq-binding-fix19-browser.test.mjs",
    database: "procurement_sourcing_test_fix19_20260804",
    head: 37,
    migration: "0037_project_planning_revision_response_lineage.sql",
    port: 43139,
    confirmation: ["ERP_RFQ_BINDING_FIX19_BROWSER_CONFIRM", "ISOLATED_FIX19_SYNTHETIC_ONLY"],
    externalServer: false,
  },
  {
    path: "tests/selfhost-rfq-traceability-fix22-browser.test.mjs",
    database: "procurement_sourcing_test_fix22_browser_20260805",
    head: 39,
    migration: "0039_rfq_traceability.sql",
    port: 43142,
    confirmation: ["ERP_RFQ_TRACEABILITY_FIX22_BROWSER_CONFIRM", "ISOLATED_FIX22_SYNTHETIC_ONLY"],
    externalServer: false,
  },
  {
    path: "tests/selfhost-supplier-mapping-browser.test.mjs",
    database: "supplier_mapping_test_fix21_20260805",
    head: 38,
    migration: "0038_supplier_mapping_governance.sql",
    port: 43141,
    confirmation: ["ERP_SUPPLIER_MAPPING_FIX21_BROWSER_CONFIRM", "ISOLATED_FIX21_SYNTHETIC_ONLY"],
    externalServer: false,
  },
]);

class BrowserE2eError extends Error {
  constructor(code) {
    super(code);
    this.name = "BrowserE2eError";
    this.code = code;
  }
}

function reject(code) {
  throw new BrowserE2eError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value) {
  if (!DATABASE_NAME.test(value)) reject("BROWSER_E2E_DATABASE_NAME_INVALID");
  return `"${value}"`;
}

function boundedAppend(current, chunk, maximum = 65_536) {
  const combined = current + String(chunk);
  return combined.length <= maximum ? combined : combined.slice(-maximum);
}

function parseTapSummary(stdout) {
  const values = new Map();
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)) {
    if (values.has(match[1])) reject("BROWSER_E2E_TAP_SUMMARY_AMBIGUOUS");
    values.set(match[1], Number(match[2]));
  }
  if (["tests", "pass", "fail", "cancelled", "skipped", "todo"].some((key) => !values.has(key))) reject("BROWSER_E2E_TAP_SUMMARY_MISSING");
  return Object.fromEntries(values);
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function terminateGroup(pid) {
  if (!pid || !groupExists(pid)) return;
  signalGroup(pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && groupExists(pid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (groupExists(pid)) signalGroup(pid, "SIGKILL");
  for (let attempt = 0; attempt < 20 && groupExists(pid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (groupExists(pid)) reject("BROWSER_E2E_PROCESS_GROUP_LEAK");
}

function runDetached(command, args, { cwd, environment, timeoutMs }) {
  return new Promise((resolve, rejectPromise) => {
    const child = spawn(command, args, { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let closed = false;
    child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.once("error", rejectPromise);
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup(child.pid, "SIGTERM");
      setTimeout(() => signalGroup(child.pid, "SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.once("close", (status, signal) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      resolve({ child, status, signal, stdout, stderr, timedOut });
    });
  });
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function requirePortAvailable(port, code) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await portAvailable(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  reject(code);
}

async function createDatabase(admin, database, template) {
  quoteIdentifier(database);
  quoteIdentifier(template);
  const present = await admin.query("select count(*)::int count from pg_database where datname=$1", [database]);
  if (present.rows[0].count !== 0) reject("BROWSER_E2E_DATABASE_ALREADY_EXISTS");
  await admin.query(`create database ${quoteIdentifier(database)} owner postgres template ${quoteIdentifier(template)}`);
}

async function dropDatabase(admin, database) {
  if (!DATABASE_NAME.test(database)) reject("BROWSER_E2E_DATABASE_NAME_INVALID");
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [database]);
  await admin.query(`drop database if exists ${quoteIdentifier(database)}`);
}

async function verifyAppliedMigrations(pool, migrations, code) {
  const applied = await pool.query("select version,checksum from schema_migrations order by version");
  if (
    applied.rowCount !== migrations.length
    || applied.rows.some((row, index) => row.version !== migrations[index].filename || row.checksum !== migrations[index].sha256)
  ) reject(code);
}

async function applyMigrations(pool, migrations) {
  for (const migration of migrations) {
    const source = await readFile(path.join(CANDIDATE_ROOT, "drizzle-postgres", migration.filename), "utf8");
    if (sha256(source) !== migration.sha256) reject("BROWSER_E2E_MIGRATION_SHA256_MISMATCH");
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
}

async function buildTemplate({ Pool, admin, name, migrations }) {
  await createDatabase(admin, name, "template0");
  const pool = new Pool({ connectionString: `postgresql://postgres@127.0.0.1:5432/${name}`, max: 1, application_name: "release-browser-template" });
  let failure = null;
  try {
    await pool.query("create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
    await applyMigrations(pool, migrations);
    await verifyAppliedMigrations(pool, migrations, "BROWSER_E2E_TEMPLATE_MIGRATIONS_INVALID");
  } catch (error) {
    failure = error;
  } finally {
    await pool.end();
  }
  if (failure) {
    await dropDatabase(admin, name).catch(() => undefined);
    throw failure;
  }
  try {
    await admin.query(`alter database ${quoteIdentifier(name)} with allow_connections false`);
  } catch (error) {
    await dropDatabase(admin, name).catch(() => undefined);
    throw error;
  }
}

async function upgradeDatabaseToCandidate({ Pool, database, migrations, sourceHead }) {
  const pool = new Pool({ connectionString: `postgresql://postgres@127.0.0.1:5432/${database}`, max: 1, application_name: "release-browser-upgrade" });
  try {
    await verifyAppliedMigrations(pool, migrations.slice(0, sourceHead), "BROWSER_E2E_UPGRADE_SOURCE_MIGRATIONS_INVALID");
    await applyMigrations(pool, migrations.slice(sourceHead));
    await verifyAppliedMigrations(pool, migrations, "BROWSER_E2E_UPGRADE_TARGET_MIGRATIONS_INVALID");
  } finally {
    await pool.end();
  }
}

function testEnvironment(configuration) {
  const origin = `http://127.0.0.1:${configuration.port}`;
  const environment = {
    PATH: "/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin",
    HOME: "/tmp/browser-home",
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    TMPDIR: "/test-tmp",
    CI: "1",
    NODE_ENV: "test",
    NODE_OPTIONS: "--max-old-space-size=512",
    ERP_ENV: "test",
    ERP_DEPLOYMENT_CLASS: "test",
    ERP_PUBLIC_ORIGIN: origin,
    ERP_UAT_ALLOW_LOOPBACK_ORIGIN: "false",
    ERP_SETUP_TOKEN: `isolated-release-browser-${configuration.port}-synthetic-only`,
    ERP_UPLOAD_ROOT: `/test-tmp/browser-${configuration.port}-uploads`,
    ERP_ATTACHMENT_ROOT: `/test-tmp/browser-${configuration.port}-attachments`,
    ERP_BACKUP_STATUS_FILE: `/test-tmp/browser-${configuration.port}-backup-status.json`,
    ERP_RUNTIME_BUILD_VERSION: process.env.ERP_RELEASE_BROWSER_PACKAGE_VERSION,
    ERP_RUNTIME_GIT_COMMIT: process.env.ERP_RELEASE_BROWSER_GIT_COMMIT,
    ERP_BROWSER_SERVER_ENTRY: SERVER_ENTRY,
    ERP_BROWSER_BASE_URL: `${origin}/`,
    PLAYWRIGHT_MODULE_PATH: "playwright-core",
    PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    DATABASE_URL: `postgresql://postgres@127.0.0.1:5432/${configuration.database}`,
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
    PGUSER: "postgres",
    [configuration.confirmation[0]]: configuration.confirmation[1],
  };
  if (configuration.environment) environment[configuration.environment[0]] = configuration.environment[1];
  if (Object.values(environment).some((value) => typeof value !== "string" || value.length === 0)) reject("BROWSER_E2E_ENVIRONMENT_INVALID");
  return environment;
}

async function startExternalServer(environment, port) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: path.dirname(SERVER_ENTRY),
    env: { ...environment, HOSTNAME: "0.0.0.0", PORT: String(port), NODE_OPTIONS: "--max-old-space-size=384" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let spawnError = null;
  child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk); });
  child.once("error", (error) => { spawnError = error; });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (spawnError || child.exitCode !== null) {
      process.stderr.write(stdout);
      process.stderr.write(stderr);
      reject("BROWSER_E2E_SERVER_EXITED");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/live`);
      if (response.ok) return child;
    } catch { /* bounded liveness polling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await terminateGroup(child.pid);
  process.stderr.write(stdout);
  process.stderr.write(stderr);
  reject("BROWSER_E2E_SERVER_NOT_READY");
}

async function main() {
  if (process.argv.length !== 2 || process.cwd() !== CANDIDATE_ROOT || process.getuid?.() !== 1000) reject("BROWSER_E2E_INVOCATION_INVALID");
  if (process.version !== "v22.14.0") reject("BROWSER_E2E_NODE_VERSION_INVALID");
  const require = createRequire(path.join(CANDIDATE_ROOT, "package.json"));
  const playwrightPackage = require("playwright-core/package.json");
  if (playwrightPackage.name !== "playwright-core" || playwrightPackage.version !== "1.51.1") reject("BROWSER_E2E_PLAYWRIGHT_VERSION_INVALID");
  const { Pool } = require("pg");
  const inventory = await loadOfficialReleaseTestInventory({ root: CANDIDATE_ROOT, supervisorRoot: SUPERVISOR_ROOT });
  const selected = inventory.tests.filter((entry) => entry.applicability === "REQUIRED" && entry.harness === "BROWSER_E2E");
  if (selected.length !== EXPECTED_BROWSER_FILES || selected.some((entry, index) => entry.path !== CONFIGURATIONS[index]?.path || entry.category !== "BROWSER")) reject("BROWSER_E2E_TEST_SET_INVALID");
  const migrations = await buildMigrationAllowlist(path.join(CANDIDATE_ROOT, "drizzle-postgres"));
  if (migrations.length !== 45 || migrations.at(-1)?.filename !== EXPECTED_MIGRATION_HEAD) reject("BROWSER_E2E_MIGRATION_SET_INVALID");
  for (const configuration of CONFIGURATIONS) {
    if (migrations[configuration.head - 1]?.filename !== configuration.migration) reject("BROWSER_E2E_MIGRATION_HEAD_INVALID");
  }

  const admin = new Pool({ connectionString: ADMIN_DATABASE_URL, max: 1, application_name: "release-browser-admin" });
  const created = [];
  let testCount = 0;
  try {
    for (const head of [36, 37, 38, 39]) {
      const name = `cyd_release_browser_template_${head}`;
      await buildTemplate({ Pool, admin, name, migrations: migrations.slice(0, head) });
      created.push(name);
    }
    for (let index = 0; index < CONFIGURATIONS.length; index += 1) {
      const configuration = CONFIGURATIONS[index];
      const entry = selected[index];
      const source = await readFile(path.join(CANDIDATE_ROOT, entry.path), "utf8");
      if (sha256(source) !== entry.sha256) reject("BROWSER_E2E_TEST_SHA256_MISMATCH");
      await requirePortAvailable(configuration.port, "BROWSER_E2E_PORT_PREEXISTING");
      await createDatabase(admin, configuration.database, `cyd_release_browser_template_${configuration.head}`);
      created.push(configuration.database);
      await upgradeDatabaseToCandidate({ Pool, database: configuration.database, migrations, sourceHead: configuration.head });
      const environment = testEnvironment(configuration);
      let externalServer = null;
      let result;
      try {
        if (configuration.externalServer) externalServer = await startExternalServer(environment, configuration.port);
        result = await runDetached(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", entry.path], {
          cwd: CANDIDATE_ROOT,
          environment,
          timeoutMs: 45 * 60 * 1000,
        });
        await terminateGroup(result.child.pid);
      } finally {
        if (externalServer) await terminateGroup(externalServer.pid);
        await requirePortAvailable(configuration.port, "BROWSER_E2E_PORT_LEAK");
        await dropDatabase(admin, configuration.database);
        created.splice(created.lastIndexOf(configuration.database), 1);
      }
      if (result.timedOut || result.signal || result.status !== 0) {
        process.stderr.write(result.stdout);
        process.stderr.write(result.stderr);
        reject(result.timedOut ? "BROWSER_E2E_TEST_TIMEOUT" : "BROWSER_E2E_TEST_FAILED");
      }
      const summary = parseTapSummary(result.stdout);
      if (summary.tests < 1 || summary.pass !== summary.tests || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0) reject("BROWSER_E2E_TEST_RESULT_INVALID");
      testCount += summary.tests;
      process.stdout.write(`BROWSER TEST PASS ${entry.path} tests=${summary.tests} sha256=${entry.sha256} template_head=${configuration.migration} runtime_head=${EXPECTED_MIGRATION_HEAD}\n`);
    }
    if (testCount !== EXPECTED_BROWSER_TESTS) reject("BROWSER_E2E_TEST_COUNT_INVALID");
    await verifyReleaseTestInventory({ root: CANDIDATE_ROOT, inventory });
    const pathSetSha256 = sha256(selected.map((entry) => `${entry.path}\n`).join(""));
    process.stdout.write(`BROWSER INVENTORY RUN PASS files=${selected.length} tests=${testCount} path_set_sha256=${pathSetSha256}\n`);
  } finally {
    for (const database of created.reverse()) await dropDatabase(admin, database).catch(() => undefined);
    await admin.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.code || "BROWSER_E2E_FAILED"}\n`);
  process.exitCode = 1;
});
