import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./release-identity-contract.mjs";
import { validateOfficialTestRuntimePolicy } from "./release-manifest-contract.mjs";

export const RELEASE_TEST_INVENTORY_CONTRACT = "chenyida-erp-release-test-inventory/v1";
export const RELEASE_TEST_INVENTORY_REPOSITORY_PATH = "chenyida_erp_site/release/release-test-inventory-v1.json";
export const RELEASE_TEST_INVENTORY_TOTAL = 248;
export const RELEASE_TEST_INVENTORY_REQUIRED = 224;
export const RELEASE_TEST_INVENTORY_NOT_APPLICABLE = 24;
export const RELEASE_TEST_MAX_BYTES = 1024 * 1024;
export const RELEASE_TYPESCRIPT_CONFIGS = Object.freeze([
  "tsconfig.ai-governance-evaluation.json",
  "tsconfig.ai-governance-suggestion-layer.json",
  "tsconfig.ai-governance-suggestion.json",
  "tsconfig.json",
  "tsconfig.material-standardization.json",
  "tsconfig.phase4-task01.json",
  "tsconfig.phase4-task02.json",
  "tsconfig.phase4-task03.json",
  "tsconfig.phase4-task04.json",
  "tsconfig.phase4-task05.json",
  "tsconfig.phase4-task06.json",
  "tsconfig.phase4-task07.json",
  "tsconfig.phase4-task08.json",
  "tsconfig.phase4-task09.json",
  "tsconfig.phase4-task10.json",
  "tsconfig.phase5-task01.json",
  "tsconfig.phase5-task02.json",
  "tsconfig.phase5-task03.json",
  "tsconfig.phase5-task04.json",
  "tsconfig.phase5-task05.json",
  "tsconfig.phase5-task06.json",
  "tsconfig.phase5-task07.json",
  "tsconfig.phase5-task08.json",
  "tsconfig.phase5-task09.json",
  "tsconfig.phase5-task10.json",
  "tsconfig.phase6-task01.json",
  "tsconfig.release-gate.json",
  "tsconfig.task03.json",
  "tsconfig.task04.json",
  "tsconfig.task05.json",
  "tsconfig.task06.json",
  "tsconfig.task07.json",
  "tsconfig.task08.json",
  "tsconfig.task09.json",
  "tsconfig.task10.json",
  "tsconfig.task43.json",
  "tsconfig.task44.json",
  "tsconfig.task45.json",
]);

const SHA256 = /^[0-9a-f]{64}$/;
const TEST_PATH = /^tests\/[A-Za-z0-9][A-Za-z0-9._-]*\.test\.mjs$/;
const OFFICIAL_CATEGORY_COUNTS = Object.freeze({
  BROWSER: 6,
  HISTORICAL_D1_SITES: 22,
  POSTGRES: 84,
  POSTGRES_ALIAS: 2,
  PURE_NODE: 121,
  RELEASE_CONTRACT: 6,
  SPECIAL_HARNESS: 7,
});
const CATEGORY_POLICY = Object.freeze({
  BROWSER: { applicability: "REQUIRED", harness: "BROWSER_E2E", reason: null },
  HISTORICAL_D1_SITES: { applicability: "NOT_APPLICABLE", harness: "LEGACY_EVIDENCE", reason: "HISTORICAL_D1_SITES_NOT_SELFHOST_AUTHORITY" },
  POSTGRES: { applicability: "REQUIRED", harness: "POSTGRES_REGRESSION", reason: null },
  POSTGRES_ALIAS: { applicability: "NOT_APPLICABLE", harness: "POSTGRES_ALIAS", reason: "ALIAS_ONLY_CANONICAL_SUITE_REQUIRED" },
  PURE_NODE: { applicability: "REQUIRED", harness: "NODE_SOURCE", reason: null },
  RELEASE_CONTRACT: { applicability: "REQUIRED", harness: "NODE_RELEASE_CONTRACT", reason: null },
  SPECIAL_HARNESS: { applicability: "REQUIRED", harness: "SPECIAL_POSIX", reason: null },
});
const RELEASE_CONTRACT_TESTS = new Set([
  "tests/selfhost-file-storage.test.mjs",
  "tests/selfhost-release-gate-contract.test.mjs",
  "tests/selfhost-release-identity-contract.test.mjs",
  "tests/selfhost-release-image-evidence-producer.test.mjs",
  "tests/selfhost-release-manifest-contract.test.mjs",
  "tests/selfhost-release-migration-allowlist.test.mjs",
]);
const HISTORICAL_D1_SITES_TESTS = new Set([
  "tests/d1-migration-statements.test.mjs",
  "tests/environment-guard.test.mjs",
  "tests/material-category-seed.test.mjs",
  "tests/material-draft-lifecycle-migration.test.mjs",
  "tests/material-draft-review-api-migration.test.mjs",
  "tests/material-draft-review-api.test.mjs",
  "tests/material-import-adaptive-migration.test.mjs",
  "tests/material-import-adaptive-runtime.test.mjs",
  "tests/material-import-batch-api.test.mjs",
  "tests/material-import-batch-migration.test.mjs",
  "tests/material-import-draft-generation.test.mjs",
  "tests/material-import-mapping-target-catalog.test.mjs",
  "tests/material-import-normalization-migration.test.mjs",
  "tests/material-import-normalization.test.mjs",
  "tests/material-import-parser-compatibility.test.mjs",
  "tests/material-import-parser-integration.test.mjs",
  "tests/material-import-parser-migration.test.mjs",
  "tests/material-library-migration.test.mjs",
  "tests/material-master-migration.test.mjs",
  "tests/material-master-service.test.mjs",
  "tests/material-validation-metadata.test.mjs",
  "tests/rendered-html.test.mjs",
]);
const POSTGRES_ALIASES = new Map([
  ["tests/selfhost-production-quality-release-postgres.test.mjs", "tests/selfhost-quality-postgres.test.mjs"],
  ["tests/selfhost-sales-delivery-receivable-postgres.test.mjs", "tests/selfhost-sales-postgres.test.mjs"],
]);
const SPECIAL_HARNESS_TESTS = new Set([
  "tests/selfhost-backup-recovery-v2.test.mjs",
  "tests/selfhost-offhost-transfer-v1.test.mjs",
  "tests/selfhost-offline-identity-recovery-unit.test.mjs",
  "tests/selfhost-postgresql-cluster-recovery-v1.test.mjs",
  "tests/selfhost-postgresql-cluster-transfer-v1.test.mjs",
  "tests/selfhost-readonly-inventory.test.mjs",
  "tests/selfhost-targeted-offline-identity-recovery-unit.test.mjs",
]);

export class ReleaseTestInventoryError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseTestInventoryError";
    this.code = code;
  }
}

function reject(code) {
  throw new ReleaseTestInventoryError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactRecord(value, expected, code) {
  exactKeys(value, Object.keys(expected), code);
  for (const [key, item] of Object.entries(expected)) if (value[key] !== item) reject(code);
}

export function classifyReleaseTestSource(testPath, source) {
  if (!TEST_PATH.test(testPath) || typeof source !== "string") reject("RELEASE_TEST_CLASSIFICATION_INPUT_INVALID");
  if (RELEASE_CONTRACT_TESTS.has(testPath)) return { category: "RELEASE_CONTRACT", canonical_path: null };
  if (HISTORICAL_D1_SITES_TESTS.has(testPath)) return { category: "HISTORICAL_D1_SITES", canonical_path: null };
  if (testPath.endsWith("-browser.test.mjs")) return { category: "BROWSER", canonical_path: null };
  if (POSTGRES_ALIASES.has(testPath)) return { category: "POSTGRES_ALIAS", canonical_path: POSTGRES_ALIASES.get(testPath) };
  if (SPECIAL_HARNESS_TESTS.has(testPath)) return { category: "SPECIAL_HARNESS", canonical_path: null };
  if (/\bnew\s+Pool\s*\(/.test(source)) return { category: "POSTGRES", canonical_path: null };
  return { category: "PURE_NODE", canonical_path: null };
}

function validateAliasWrapper(source, canonicalPath) {
  const executable = source.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("//"));
  const relative = `./${path.posix.basename(canonicalPath)}`;
  if (executable.length !== 1 || executable[0] !== `import "${relative}";`) reject("RELEASE_TEST_ALIAS_WRAPPER_INVALID");
}

export function validateReleaseTestInventoryDocument(value) {
  exactKeys(value, ["schema_version", "contract", "root", "test_pattern", "max_test_bytes", "total_tests", "required_tests", "not_applicable_tests", "category_counts", "tests"], "RELEASE_TEST_INVENTORY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_TEST_INVENTORY_CONTRACT || value.root !== "chenyida_erp_site" || value.test_pattern !== "tests/*.test.mjs" || value.max_test_bytes !== RELEASE_TEST_MAX_BYTES) reject("RELEASE_TEST_INVENTORY_IDENTITY_INVALID");
  if (value.total_tests !== RELEASE_TEST_INVENTORY_TOTAL || value.required_tests !== RELEASE_TEST_INVENTORY_REQUIRED || value.not_applicable_tests !== RELEASE_TEST_INVENTORY_NOT_APPLICABLE || value.required_tests + value.not_applicable_tests !== value.total_tests) reject("RELEASE_TEST_INVENTORY_TOTALS_INVALID");
  exactRecord(value.category_counts, OFFICIAL_CATEGORY_COUNTS, "RELEASE_TEST_INVENTORY_CATEGORY_COUNTS_INVALID");
  if (!Array.isArray(value.tests) || value.tests.length !== value.total_tests) reject("RELEASE_TEST_INVENTORY_TESTS_INVALID");
  const seen = new Set();
  const categoryCounts = Object.fromEntries(Object.keys(OFFICIAL_CATEGORY_COUNTS).map((category) => [category, 0]));
  let required = 0;
  let notApplicable = 0;
  let previous = "";
  for (const entry of value.tests) {
    exactKeys(entry, ["path", "sha256", "category", "applicability", "harness", "reason", "canonical_path"], "RELEASE_TEST_ENTRY_FIELDS_INVALID");
    if (typeof entry.path !== "string" || !TEST_PATH.test(entry.path) || entry.path <= previous || seen.has(entry.path)) reject("RELEASE_TEST_ENTRY_PATH_INVALID");
    previous = entry.path;
    seen.add(entry.path);
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) reject("RELEASE_TEST_ENTRY_SHA256_INVALID");
    if (!Object.hasOwn(CATEGORY_POLICY, entry.category)) reject("RELEASE_TEST_ENTRY_CATEGORY_INVALID");
    const policy = CATEGORY_POLICY[entry.category];
    if (entry.applicability !== policy.applicability || entry.harness !== policy.harness || entry.reason !== policy.reason) reject("RELEASE_TEST_ENTRY_POLICY_INVALID");
    if (entry.category === "POSTGRES_ALIAS") {
      if (entry.canonical_path !== POSTGRES_ALIASES.get(entry.path)) reject("RELEASE_TEST_ENTRY_ALIAS_INVALID");
    } else if (entry.canonical_path !== null) reject("RELEASE_TEST_ENTRY_CANONICAL_PATH_INVALID");
    categoryCounts[entry.category] += 1;
    if (entry.applicability === "REQUIRED") required += 1;
    else notApplicable += 1;
  }
  if (required !== value.required_tests || notApplicable !== value.not_applicable_tests) reject("RELEASE_TEST_INVENTORY_APPLICABILITY_COUNTS_INVALID");
  exactRecord(categoryCounts, OFFICIAL_CATEGORY_COUNTS, "RELEASE_TEST_INVENTORY_CATEGORY_COUNTS_INVALID");
  return value;
}

async function readBoundedRegularFile(file, maxBytes = RELEASE_TEST_MAX_BYTES) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > maxBytes || (before.mode & 0o022) !== 0) reject("RELEASE_TEST_FILE_METADATA_INVALID");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) reject("RELEASE_TEST_FILE_CHANGED");
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) reject("RELEASE_TEST_FILE_CHANGED");
    return raw;
  } finally {
    await handle.close();
  }
}

export async function verifyTrustedPostgresRuntimeCatalog({ root, policy }) {
  const catalogRaw = await readBoundedRegularFile(path.join(path.resolve(root), policy.postgres_runtime_catalog.path), 512 * 1024);
  if (sha256(catalogRaw) !== policy.postgres_runtime_catalog.file_sha256) reject("RELEASE_POSTGRES_RUNTIME_CATALOG_SHA256_MISMATCH");
  const catalog = parseStrictJson(catalogRaw.toString("utf8"), 512 * 1024);
  if (catalog?.artifact_sha256 !== policy.postgres_runtime_catalog.artifact_sha256
    || catalog?.engine_binding?.image_reference !== policy.postgres_runtime_catalog.image_reference) reject("RELEASE_POSTGRES_RUNTIME_CATALOG_IDENTITY_MISMATCH");
  return catalog;
}

async function actualTopLevelTests(root) {
  const testsRoot = path.join(root, "tests");
  const resolvedTests = await realpath(testsRoot);
  if (resolvedTests !== testsRoot) reject("RELEASE_TEST_DIRECTORY_INVALID");
  const entries = await readdir(testsRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.name.endsWith(".test.mjs")).map((entry) => `tests/${entry.name}`).sort();
}

async function verifyEntry(root, entry) {
  const file = path.join(root, entry.path);
  const raw = await readBoundedRegularFile(file);
  if (sha256(raw) !== entry.sha256) reject("RELEASE_TEST_FILE_SHA256_MISMATCH");
  const source = raw.toString("utf8");
  const classified = classifyReleaseTestSource(entry.path, source);
  if (entry.category !== classified.category || entry.canonical_path !== classified.canonical_path) reject("RELEASE_TEST_CLASSIFICATION_MISMATCH");
  if (entry.category === "POSTGRES_ALIAS") validateAliasWrapper(source, entry.canonical_path);
  return raw;
}

export async function verifyReleaseTestInventory({ root, inventory }) {
  const candidateRoot = path.resolve(root);
  if (await realpath(candidateRoot) !== candidateRoot) reject("RELEASE_TEST_ROOT_INVALID");
  validateReleaseTestInventoryDocument(inventory);
  const actual = await actualTopLevelTests(candidateRoot);
  const expected = inventory.tests.map((entry) => entry.path);
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) reject("RELEASE_TEST_SET_MISMATCH");
  for (const entry of inventory.tests) await verifyEntry(candidateRoot, entry);
  return inventory;
}

export async function loadOfficialReleaseTestInventory({ root = process.cwd(), supervisorRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url))) } = {}) {
  const resolvedSupervisorRoot = path.resolve(supervisorRoot);
  const policyRaw = await readFile(path.join(resolvedSupervisorRoot, "release", "test-runtime-policy-v1.json"), "utf8");
  const policy = validateOfficialTestRuntimePolicy(parseStrictJson(policyRaw), policyRaw);
  await verifyTrustedPostgresRuntimeCatalog({ root, policy });
  const inventoryRaw = await readFile(path.join(resolvedSupervisorRoot, "release", "release-test-inventory-v1.json"), "utf8");
  if (sha256(inventoryRaw) !== policy.test_inventory.sha256) reject("RELEASE_TEST_INVENTORY_SHA256_MISMATCH");
  const inventory = validateReleaseTestInventoryDocument(parseStrictJson(inventoryRaw, 4 * 1024 * 1024));
  if (policy.test_inventory.path !== RELEASE_TEST_INVENTORY_REPOSITORY_PATH || policy.test_inventory.total_tests !== inventory.total_tests || policy.test_inventory.required_tests !== inventory.required_tests || policy.test_inventory.not_applicable_tests !== inventory.not_applicable_tests) reject("RELEASE_TEST_INVENTORY_POLICY_MISMATCH");
  exactRecord(policy.test_inventory.category_counts, inventory.category_counts, "RELEASE_TEST_INVENTORY_POLICY_MISMATCH");
  return verifyReleaseTestInventory({ root, inventory });
}

export async function verifyReleaseTypeScriptConfigSet({ root = process.cwd() } = {}) {
  const candidateRoot = path.resolve(root);
  if (await realpath(candidateRoot) !== candidateRoot) reject("RELEASE_TYPESCRIPT_ROOT_INVALID");
  const entries = await readdir(candidateRoot, { withFileTypes: true });
  const matching = entries.filter((entry) => entry.name.startsWith("tsconfig") && entry.name.endsWith(".json"));
  if (matching.some((entry) => !entry.isFile())) reject("RELEASE_TYPESCRIPT_CONFIG_METADATA_INVALID");
  const actual = matching.map((entry) => entry.name).sort();
  if (actual.length !== RELEASE_TYPESCRIPT_CONFIGS.length || actual.some((item, index) => item !== RELEASE_TYPESCRIPT_CONFIGS[index])) {
    reject("RELEASE_TYPESCRIPT_CONFIG_SET_MISMATCH");
  }
  const configs = [];
  for (const config of actual) {
    const raw = await readBoundedRegularFile(path.join(candidateRoot, config));
    configs.push({ path: config, sha256: sha256(raw) });
  }
  return configs;
}

export async function runReleaseTypecheck({ root = process.cwd() } = {}) {
  const candidateRoot = path.resolve(root);
  const before = await verifyReleaseTypeScriptConfigSet({ root: candidateRoot });
  const compiler = path.join(candidateRoot, "node_modules", ".bin", "tsc");
  for (let index = 0; index < before.length; index += 1) {
    const config = before[index];
    process.stdout.write(`TYPECHECK START ${index + 1}/${before.length} ${config.path}\n`);
    const result = spawnSync(compiler, ["-p", config.path, "--pretty", "false", "--incremental", "false"], {
      cwd: candidateRoot,
      env: process.env,
      stdio: "inherit",
      timeout: 15 * 60 * 1000,
    });
    if (result.error || result.signal || result.status !== 0) reject(result.error?.code === "ETIMEDOUT" ? "RELEASE_TYPESCRIPT_CONFIG_TIMEOUT" : "RELEASE_TYPESCRIPT_CONFIG_FAILED");
    const after = await readBoundedRegularFile(path.join(candidateRoot, config.path));
    if (sha256(after) !== config.sha256) reject("RELEASE_TYPESCRIPT_CONFIG_CHANGED");
    process.stdout.write(`TYPECHECK PASS ${index + 1}/${before.length} ${config.path} sha256=${config.sha256}\n`);
  }
  const after = await verifyReleaseTypeScriptConfigSet({ root: candidateRoot });
  if (after.some((config, index) => config.sha256 !== before[index].sha256)) reject("RELEASE_TYPESCRIPT_CONFIG_CHANGED");
  process.stdout.write(`TYPECHECK SET PASS configs=${before.length}\n`);
  return { configs: before.length };
}

function parseTapSummary(stdout) {
  const values = new Map();
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)) {
    if (values.has(match[1])) reject("RELEASE_TEST_TAP_SUMMARY_AMBIGUOUS");
    values.set(match[1], Number(match[2]));
  }
  if (["tests", "pass", "fail", "cancelled", "skipped", "todo"].some((key) => !values.has(key))) reject("RELEASE_TEST_TAP_SUMMARY_MISSING");
  return Object.fromEntries(values);
}

function boundedFailureOutput(value) {
  const text = typeof value === "string" ? value : "";
  return text.length <= 16_384 ? text : text.slice(-16_384);
}

export async function runReleaseTestHarness({ root = process.cwd(), supervisorRoot, harness }) {
  if (!["NODE_SOURCE", "NODE_RELEASE_CONTRACT", "SPECIAL_POSIX"].includes(harness)) reject("RELEASE_TEST_HARNESS_UNSUPPORTED");
  const inventory = await loadOfficialReleaseTestInventory({ root, supervisorRoot });
  const selected = inventory.tests.filter((entry) => entry.applicability === "REQUIRED" && entry.harness === harness);
  if (selected.length < 1) reject("RELEASE_TEST_HARNESS_EMPTY");
  let testCount = 0;
  for (const entry of selected) {
    await verifyEntry(path.resolve(root), entry);
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", entry.path], {
      cwd: path.resolve(root),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    if (result.error || result.signal || result.status !== 0) {
      process.stderr.write(boundedFailureOutput(result.stdout));
      process.stderr.write(boundedFailureOutput(result.stderr));
      reject(result.error?.code === "ETIMEDOUT" ? "RELEASE_TEST_FILE_TIMEOUT" : "RELEASE_TEST_FILE_FAILED");
    }
    const summary = parseTapSummary(result.stdout);
    if (summary.tests < 1 || summary.pass !== summary.tests || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0) reject("RELEASE_TEST_FILE_RESULT_INVALID");
    await verifyEntry(path.resolve(root), entry);
    testCount += summary.tests;
    process.stdout.write(`TEST PASS ${entry.path} tests=${summary.tests} sha256=${entry.sha256}\n`);
  }
  await verifyReleaseTestInventory({ root, inventory });
  const pathSetSha256 = sha256(selected.map((entry) => `${entry.path}\n`).join(""));
  process.stdout.write(`INVENTORY RUN PASS harness=${harness} files=${selected.length} tests=${testCount} path_set_sha256=${pathSetSha256}\n`);
  return { harness, files: selected.length, tests: testCount, path_set_sha256: pathSetSha256 };
}

async function main(args) {
  const command = args[0];
  if (command === "verify" && args.length === 1) {
    const inventory = await loadOfficialReleaseTestInventory();
    process.stdout.write(`INVENTORY VERIFY PASS total=${inventory.total_tests} required=${inventory.required_tests} not_applicable=${inventory.not_applicable_tests}\n`);
    return;
  }
  if (command === "run" && args.length === 2) {
    await runReleaseTestHarness({ harness: args[1] });
    return;
  }
  if (command === "typecheck" && args.length === 1) {
    await runReleaseTypecheck();
    return;
  }
  process.stderr.write("usage: release-test-inventory.mjs verify|typecheck|run NODE_SOURCE|run NODE_RELEASE_CONTRACT|run SPECIAL_POSIX\n");
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "RELEASE_TEST_INVENTORY_FAILED"}\n`);
    process.exitCode = 1;
  });
}
