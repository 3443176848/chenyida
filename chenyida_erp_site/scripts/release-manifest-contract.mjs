import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { link, lstat, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./release-identity-contract.mjs";
import {
  PRE_DEPLOY_RUNTIME_GUARD_MODE,
  officialReleaseLifecycle,
  validateIsolatedCandidateRuntimeGuard,
  validatePreDeployRuntimeGuard,
  validatePreDeployRuntimeSnapshot,
  validatePreDeployRuntimeSnapshotShape,
  validateReleaseLifecycle,
  validateRuntimeGuardBinding,
} from "./release-lifecycle-contract.mjs";
import {
  RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT,
  RELEASE_DOCKERFILE_FRONTEND_REFERENCE,
  RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT,
  RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE,
  RELEASE_NODE_BASE_IMAGE_REFERENCE,
  RELEASE_RUNTIME_APK_REPOSITORY,
  RELEASE_RUNTIME_BASE_IMAGE_REFERENCE,
  RELEASE_RUNTIME_NODE_PACKAGE,
  RELEASE_RUNTIME_NODE_VERSION,
  RELEASE_TRIVY_IMAGE_REFERENCE,
  RELEASE_TRIVY_VERSION,
  validateDockerImageInspect,
  validateCandidateBuildProvenance,
  validateImageScanProvenance,
  validateTrivyCycloneDxDocument,
  validateTrivyDatabaseMetadata,
  validateTrivyNativeVulnerabilityReport,
  validateTrivyVersionReport,
} from "./release-image-evidence-contract.mjs";

export { RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT, RELEASE_DOCKERFILE_FRONTEND_REFERENCE, RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT, RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE, RELEASE_NODE_BASE_IMAGE_REFERENCE, RELEASE_RUNTIME_APK_REPOSITORY, RELEASE_RUNTIME_BASE_IMAGE_REFERENCE, RELEASE_RUNTIME_NODE_PACKAGE, RELEASE_RUNTIME_NODE_VERSION, RELEASE_TRIVY_IMAGE_REFERENCE, RELEASE_TRIVY_VERSION, validateCandidateBuildProvenance, validateImageScanProvenance, validateTrivyCycloneDxDocument, validateTrivyNativeVulnerabilityReport };

export const RELEASE_MANIFEST_CONTRACT = "chenyida-erp-release-manifest/v2";
export const RELEASE_GATE_PLAN_CONTRACT = "chenyida-erp-release-gate-plan/v2";
export const RELEASE_GATE_REPORT_CONTRACT = "chenyida-erp-release-gate-report/v2";
export const RELEASE_GATE_ATTEMPT_CONTRACT = "chenyida-erp-release-gate-attempt/v2";
export const RELEASE_SBOM_EVIDENCE_CONTRACT = "chenyida-erp-release-sbom-evidence/v1";
export const RELEASE_SECURITY_EVIDENCE_CONTRACT = "chenyida-erp-release-security-evidence/v1";
export const RELEASE_SECURITY_SCAN_REPORT_CONTRACT = "chenyida-erp-vulnerability-scan-report/v1";
export const RELEASE_ARTIFACT_ROOT_MARKER = ".chenyida-erp-release-artifact-root-v1";
export const RELEASE_ARTIFACT_ROOT_MARKER_VALUE = "chenyida-erp-release-artifact-root/v1\n";
export const RELEASE_GATE_PLAN_ID = "selfhost-release-gate-v2";
export const RELEASE_GATE_PLAN_REPOSITORY_PATH = "chenyida_erp_site/release/release-gate-plan-v2.json";
export const RELEASE_VULNERABILITY_POLICY_ID = "chenyida-erp-zero-known-vulnerabilities-v1";
export const RELEASE_VULNERABILITY_POLICY_SHA256 = "042cd1bb1185923a8f186319d90194911beba78f761938f42937c5fd0e463ab9";
export const RELEASE_TEST_RUNTIME_POLICY_CONTRACT = "chenyida-erp-release-test-runtime-policy/v1";
export const RELEASE_TEST_RUNTIME_POLICY_SHA256 = "d84b084a872f599703a0b33f9fb2589ed79d42775d1ef623248057d9ddb99d05";
export const RELEASE_TEST_INVENTORY_SHA256 = "13d1ae18259940c9bdc8e917427bba6e984f975dcba75ca09a3cb970c500da9c";
export const RELEASE_GATE_REQUIRED_STEP_IDS = [
  "release-contracts",
  "supervisor-python-contracts",
  "credential-scan",
  "build-and-node-source-tests",
  "postgres-regression-tests",
  "browser-end-to-end-tests",
  "special-posix-tests",
  "all-typescript-configs",
  "eslint",
  "release-migration-postgres",
  "backup-recovery-postgres",
  "python-self-test",
  "python-smoke",
  "python-go-live-no-backup",
  "compose-config",
  "container-runtime-policy",
  "git-diff-check",
  "image-sbom-evidence",
  "vulnerability-assessment-evidence",
];
const OFFICIAL_RELEASE_GATE_EXECUTORS = ["NODE_CANDIDATE_TEST", "PYTHON_CANDIDATE_TEST", "NODE_CANDIDATE_TEST", "NODE_CANDIDATE_TEST", "POSTGRES_CANDIDATE_TEST", "NODE_CANDIDATE_TEST", "NODE_CANDIDATE_TEST", "NODE_CANDIDATE_TEST", "NODE_CANDIDATE_TEST", "MIGRATION_POSTGRES_TEST", "BACKUP_RECOVERY_POSTGRES_TEST", "PYTHON_CANDIDATE_TEST", "PYTHON_CANDIDATE_TEST", "PYTHON_CANDIDATE_TEST", "COMPOSE_CONFIG_TEST", "CONTAINER_RUNTIME_TEST", "SOURCE_CHECK", "EVIDENCE_CHECK", "EVIDENCE_CHECK"];
const OFFICIAL_RELEASE_GATE_ACTIONS = ["CONTRACTS", "SUPERVISOR_CONTRACTS", "CREDENTIALS", "NODE_SOURCE", "POSTGRES_REGRESSION", "BROWSER_E2E", "SPECIAL_POSIX", "TYPECHECK", "LINT", "RELEASE_MIGRATION", "BACKUP_RECOVERY", "SELF_TEST", "SMOKE", "GO_LIVE", "VALIDATE", "RUNTIME_POLICY", "DIFF_CHECK", "IMAGE_SBOM", "VULNERABILITY_ASSESSMENT"];
const OFFICIAL_RELEASE_GATE_TIMEOUTS = [600, 600, 600, 14400, 14400, 14400, 7200, 7200, 3600, 7200, 7200, 600, 900, 900, 300, 600, 300, 60, 60];
const OFFICIAL_RELEASE_GATE_RESOURCE_CLASSES = ["LIGHT", "LIGHT", "LIGHT", "HEAVY", "HEAVY", "HEAVY", "HEAVY", "HEAVY", "HEAVY", "HEAVY", "HEAVY", "LIGHT", "LIGHT", "LIGHT", "LIGHT", "HEAVY", "LIGHT", "LIGHT", "LIGHT"];
const OFFICIAL_RELEASE_GATE_OUTPUT_PATTERNS = [["# skipped [1-9]"], [], [], ["# skipped [1-9]", "# todo [1-9]"], ["# skipped [1-9]", "# todo [1-9]"], ["# skipped [1-9]", "# todo [1-9]"], ["# skipped [1-9]", "# todo [1-9]"], [], ["[1-9][0-9]* error"], [], [], [], [], [], [], [], [], [], [], []];

const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,240}$/;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_MIGRATION_BYTES = 32 * 1024 * 1024;
const MAX_SBOM_BYTES = 32 * 1024 * 1024;
export const RELEASE_MAX_GATE_REPORT_AGE_MS = 60 * 60 * 1000;
export const RELEASE_MAX_SBOM_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RELEASE_MAX_SECURITY_EVIDENCE_AGE_MS = 72 * 60 * 60 * 1000;
export const RELEASE_MAX_SECURITY_DATABASE_AGE_MS = 72 * 60 * 60 * 1000;
export const RELEASE_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ARTIFACT_ROOT_MODE = 0o750;
const ARTIFACT_FILE_MODE = 0o440;

export class ReleaseManifestError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseManifestError";
    this.code = code;
  }
}

function reject(code) {
  throw new ReleaseManifestError(code);
}

function record(value, code = "OBJECT_REQUIRED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code = "FIELDS_INVALID") {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function string(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function iso(value, code) {
  string(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function nullableIso(value, code) {
  if (value === null) return value;
  return iso(value, code);
}

function nullableString(value, code) {
  if (value !== null && (typeof value !== "string" || value.length < 1 || value.length > 500)) reject(code);
  return value;
}

function safePath(value, code) {
  return string(value, SAFE_PATH, code);
}

function artifactFilename(value, code) {
  safePath(value, code);
  if (path.basename(value) !== value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/.test(value)) reject(code);
  return value;
}

function preparedArtifactFilename(value, code) {
  if (typeof value !== "string" || path.basename(value) !== value || !/^\.[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.prepared\.json$/.test(value)) reject(code);
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

export function migrationAllowlistDigest(entries) {
  return sha256(canonicalJson(entries));
}

export function validateMigrationAllowlist(entries, expectedDigest = null) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 9999) reject("MIGRATION_ALLOWLIST_INVALID");
  let previous = "";
  entries.forEach((entry, index) => {
    exactKeys(entry, ["ordinal", "filename", "sha256"], "MIGRATION_ENTRY_FIELDS_INVALID");
    integer(entry.ordinal, 1, 9999, "MIGRATION_ORDINAL_INVALID");
    if (entry.ordinal !== index + 1) reject("MIGRATION_ORDINAL_SEQUENCE_INVALID");
    const match = string(entry.filename, MIGRATION_FILE, "MIGRATION_FILENAME_INVALID").match(MIGRATION_FILE);
    if (Number(match[1]) !== entry.ordinal) reject("MIGRATION_FILENAME_SEQUENCE_INVALID");
    if (entry.filename <= previous) reject("MIGRATION_ORDER_INVALID");
    previous = entry.filename;
    string(entry.sha256, SHA256, "MIGRATION_SHA256_INVALID");
  });
  const digest = migrationAllowlistDigest(entries);
  if (expectedDigest !== null && digest !== expectedDigest) reject("MIGRATION_ALLOWLIST_DIGEST_MISMATCH");
  return entries;
}

export async function buildMigrationAllowlist(directory) {
  const absolute = path.resolve(directory);
  const resolved = await realpath(absolute);
  if (resolved !== absolute) reject("MIGRATION_DIRECTORY_INVALID");
  const directoryStat = await lstat(absolute);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) reject("MIGRATION_DIRECTORY_INVALID");
  const names = (await readdir(absolute)).filter((name) => name.endsWith(".sql")).sort();
  const entries = [];
  for (let index = 0; index < names.length; index += 1) {
    const filename = names[index];
    if (!MIGRATION_FILE.test(filename)) reject("MIGRATION_FILENAME_INVALID");
    const file = path.join(absolute, filename);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > MAX_MIGRATION_BYTES) reject("MIGRATION_FILE_INVALID");
    entries.push({ ordinal: index + 1, filename, sha256: sha256(await readFile(file)) });
  }
  return validateMigrationAllowlist(entries);
}

export function validateReleaseGatePlan(value) {
  exactKeys(value, ["schema_version", "contract", "plan_id", "plan_version", "working_directory", "runtime_guard", "candidate_runtime_guard", "resource_policy", "steps"], "GATE_PLAN_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RELEASE_GATE_PLAN_CONTRACT) reject("GATE_PLAN_VERSION_INVALID");
  string(value.plan_id, IDENTIFIER, "GATE_PLAN_ID_INVALID");
  integer(value.plan_version, 1, 999, "GATE_PLAN_REVISION_INVALID");
  safePath(value.working_directory, "GATE_PLAN_WORKDIR_INVALID");
  try { validatePreDeployRuntimeGuard(value.runtime_guard); } catch (error) { reject(error?.code || "RUNTIME_GUARD_INVALID"); }
  try { validateIsolatedCandidateRuntimeGuard(value.candidate_runtime_guard); } catch (error) { reject(error?.code || "CANDIDATE_RUNTIME_GUARD_INVALID"); }
  exactKeys(value.resource_policy, ["compose_parallel_limit", "node_max_old_space_size_mib", "min_available_memory_mib", "max_swap_used_percent", "max_swap_growth_mib_60s", "min_root_free_gib", "max_load_1m", "max_temporary_containers"], "GATE_RESOURCE_POLICY_FIELDS_INVALID");
  if (value.resource_policy.compose_parallel_limit !== 1 || value.resource_policy.max_temporary_containers !== 1) reject("GATE_SERIAL_POLICY_INVALID");
  integer(value.resource_policy.node_max_old_space_size_mib, 128, 1024, "GATE_NODE_HEAP_INVALID");
  integer(value.resource_policy.min_available_memory_mib, 768, 65_536, "GATE_MEMORY_THRESHOLD_INVALID");
  integer(value.resource_policy.max_swap_used_percent, 1, 80, "GATE_SWAP_THRESHOLD_INVALID");
  integer(value.resource_policy.max_swap_growth_mib_60s, 1, 256, "GATE_SWAP_GROWTH_THRESHOLD_INVALID");
  integer(value.resource_policy.min_root_free_gib, 10, 1024, "GATE_DISK_THRESHOLD_INVALID");
  if (typeof value.resource_policy.max_load_1m !== "number" || value.resource_policy.max_load_1m <= 0 || value.resource_policy.max_load_1m > 4) reject("GATE_LOAD_THRESHOLD_INVALID");
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 100) reject("GATE_STEPS_INVALID");
  const ids = new Set();
  value.steps.forEach((step, index) => {
    exactKeys(step, ["ordinal", "id", "kind", "resource_class", "applicability", "reason", "timeout_seconds", "executor_id", "action", "forbid_output_patterns"], "GATE_STEP_FIELDS_INVALID");
    if (step.ordinal !== index + 1) reject("GATE_STEP_ORDER_INVALID");
    string(step.id, IDENTIFIER, "GATE_STEP_ID_INVALID");
    if (ids.has(step.id)) reject("GATE_STEP_ID_DUPLICATE");
    ids.add(step.id);
    if (!["COMMAND", "EVIDENCE"].includes(step.kind)) reject("GATE_STEP_KIND_INVALID");
    if (!["LIGHT", "HEAVY"].includes(step.resource_class)) reject("GATE_STEP_RESOURCE_CLASS_INVALID");
    if (!["REQUIRED", "NOT_APPLICABLE"].includes(step.applicability)) reject("GATE_STEP_APPLICABILITY_INVALID");
    integer(step.timeout_seconds, 1, 14_400, "GATE_STEP_TIMEOUT_INVALID");
    string(step.executor_id, /^[A-Z][A-Z0-9_]{2,79}$/, "GATE_STEP_EXECUTOR_INVALID");
    string(step.action, /^[A-Z][A-Z0-9_]{2,79}$/, "GATE_STEP_ACTION_INVALID");
    if (!Array.isArray(step.forbid_output_patterns) || step.forbid_output_patterns.length > 20 || step.forbid_output_patterns.some((item) => typeof item !== "string" || item.length < 1 || item.length > 200)) reject("GATE_STEP_OUTPUT_POLICY_INVALID");
    for (const source of step.forbid_output_patterns) { try { new RegExp(source, "m"); } catch { reject("GATE_STEP_OUTPUT_PATTERN_INVALID"); } }
    if (step.applicability === "NOT_APPLICABLE") {
      nullableString(step.reason, "GATE_STEP_REASON_INVALID");
      if (step.reason === null) reject("GATE_STEP_NOT_APPLICABLE_INVALID");
    } else {
      if (step.reason !== null) reject("GATE_STEP_REASON_INVALID");
    }
  });
  return value;
}

export function validateOfficialReleaseGatePlan(value) {
  validateReleaseGatePlan(value);
  if (value.plan_id !== RELEASE_GATE_PLAN_ID || value.plan_version !== 2 || value.working_directory !== "chenyida_erp_site") reject("GATE_OFFICIAL_PLAN_IDENTITY_INVALID");
  try { validatePreDeployRuntimeGuard(value.runtime_guard); } catch (error) { reject(error?.code || "RUNTIME_GUARD_INVALID"); }
  try { validateIsolatedCandidateRuntimeGuard(value.candidate_runtime_guard); } catch (error) { reject(error?.code || "CANDIDATE_RUNTIME_GUARD_INVALID"); }
  const expectedPolicy = { compose_parallel_limit: 1, node_max_old_space_size_mib: 768, min_available_memory_mib: 768, max_swap_used_percent: 80, max_swap_growth_mib_60s: 256, min_root_free_gib: 10, max_load_1m: 4, max_temporary_containers: 1 };
  if (canonicalJson(value.resource_policy) !== canonicalJson(expectedPolicy)) reject("GATE_OFFICIAL_PLAN_RESOURCE_POLICY_INVALID");
  if (value.steps.length !== RELEASE_GATE_REQUIRED_STEP_IDS.length || value.steps.some((step, index) => {
    const expectedKind = index >= RELEASE_GATE_REQUIRED_STEP_IDS.length - 2 ? "EVIDENCE" : "COMMAND";
    return step.id !== RELEASE_GATE_REQUIRED_STEP_IDS[index]
      || step.applicability !== "REQUIRED"
      || step.reason !== null
      || step.kind !== expectedKind
      || step.executor_id !== OFFICIAL_RELEASE_GATE_EXECUTORS[index]
      || step.action !== OFFICIAL_RELEASE_GATE_ACTIONS[index]
      || step.resource_class !== OFFICIAL_RELEASE_GATE_RESOURCE_CLASSES[index]
      || step.timeout_seconds !== OFFICIAL_RELEASE_GATE_TIMEOUTS[index]
      || canonicalJson(step.forbid_output_patterns) !== canonicalJson(OFFICIAL_RELEASE_GATE_OUTPUT_PATTERNS[index]);
  })) reject("GATE_OFFICIAL_PLAN_STEPS_INVALID");
  return value;
}

/** @param {unknown} value @param {string | null} [raw] */
export function validateOfficialVulnerabilityPolicy(value, raw = null) {
  exactKeys(value, ["schema_version", "policy_id", "scanner", "scanner_version", "scanner_image_reference", "required_targets", "maximum_database_age_hours", "maximum_evidence_age_hours", "fail_on"], "VULNERABILITY_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.policy_id !== RELEASE_VULNERABILITY_POLICY_ID || value.scanner !== "trivy" || value.scanner_version !== RELEASE_TRIVY_VERSION || value.scanner_image_reference !== RELEASE_TRIVY_IMAGE_REFERENCE || canonicalJson(value.required_targets) !== canonicalJson(["web", "worker"]) || value.maximum_database_age_hours !== 72 || value.maximum_evidence_age_hours !== 72 || canonicalJson(value.fail_on) !== canonicalJson(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"])) reject("VULNERABILITY_POLICY_INVALID");
  if (raw !== null && sha256(raw) !== RELEASE_VULNERABILITY_POLICY_SHA256) reject("VULNERABILITY_POLICY_SHA256_MISMATCH");
  return value;
}

/** @param {unknown} value @param {string | null} [raw] */
export function validateOfficialTestRuntimePolicy(value, raw = null) {
  exactKeys(value, ["schema_version", "contract", "platform", "node_image", "postgres_image", "posix_image", "browser_image", "browser_runtime", "node_dependencies", "python_runtime", "test_inventory"], "TEST_RUNTIME_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_TEST_RUNTIME_POLICY_CONTRACT || value.platform !== "linux/amd64") reject("TEST_RUNTIME_POLICY_IDENTITY_INVALID");
  exactKeys(value.node_image, ["reference", "repo_digest", "config_digest"], "TEST_RUNTIME_NODE_IMAGE_FIELDS_INVALID");
  exactKeys(value.postgres_image, ["reference", "repo_digest", "config_digest"], "TEST_RUNTIME_POSTGRES_IMAGE_FIELDS_INVALID");
  exactKeys(value.posix_image, ["reference", "repo_digest", "config_digest"], "TEST_RUNTIME_POSIX_IMAGE_FIELDS_INVALID");
  exactKeys(value.browser_image, ["reference", "repo_digest", "config_digest"], "TEST_RUNTIME_BROWSER_IMAGE_FIELDS_INVALID");
  if (value.node_image.reference !== "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3" || value.node_image.repo_digest !== "sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3" || value.node_image.config_digest !== "sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3") reject("TEST_RUNTIME_NODE_IMAGE_INVALID");
  if (value.postgres_image.reference !== "postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394" || value.postgres_image.repo_digest !== "sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394" || value.postgres_image.config_digest !== "sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394") reject("TEST_RUNTIME_POSTGRES_IMAGE_INVALID");
  if (value.posix_image.reference !== "node@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37" || value.posix_image.repo_digest !== "sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37" || value.posix_image.config_digest !== "sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37") reject("TEST_RUNTIME_POSIX_IMAGE_INVALID");
  if (value.browser_image.reference !== "mcr.microsoft.com/playwright@sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961" || value.browser_image.repo_digest !== "sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961" || value.browser_image.config_digest !== "sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961") reject("TEST_RUNTIME_BROWSER_IMAGE_INVALID");
  for (const image of [value.node_image, value.postgres_image, value.posix_image, value.browser_image]) {
    string(image.repo_digest, DIGEST, "TEST_RUNTIME_REPO_DIGEST_INVALID");
    string(image.config_digest, DIGEST, "TEST_RUNTIME_CONFIG_DIGEST_INVALID");
    if (!image.reference.endsWith(`@${image.repo_digest}`)) reject("TEST_RUNTIME_REPO_REFERENCE_MISMATCH");
  }
  exactKeys(value.browser_runtime, ["package_name", "package_version", "browser_name", "browser_revision", "browser_version", "executable_path", "executable_sha256"], "TEST_RUNTIME_BROWSER_FIELDS_INVALID");
  if (value.browser_runtime.package_name !== "playwright-core" || value.browser_runtime.package_version !== "1.51.1" || value.browser_runtime.browser_name !== "chromium" || value.browser_runtime.browser_revision !== "1161" || value.browser_runtime.browser_version !== "134.0.6998.35" || value.browser_runtime.executable_path !== "/ms-playwright/chromium-1161/chrome-linux/chrome" || value.browser_runtime.executable_sha256 !== "efb2bece6f2f5bc00dc270162d2241c86d509ca4f4297b1eb0f5cd8894d050be") reject("TEST_RUNTIME_BROWSER_INVALID");
  exactKeys(value.node_dependencies, ["path", "tree_sha256", "package_lock_sha256"], "TEST_RUNTIME_NODE_FIELDS_INVALID");
  if (value.node_dependencies.path !== "chenyida_erp_site/node_modules" || value.node_dependencies.tree_sha256 !== "3d727122206562df4ebfe24139bfd7b2ae16a299ef2e62b6d55b19e61c2db819" || value.node_dependencies.package_lock_sha256 !== "3c0522f9ea75cc6c0bfa4c3c92e232f47ce326e73054e070a03bea8320a91815") reject("TEST_RUNTIME_NODE_INVALID");
  exactKeys(value.python_runtime, ["venv_path", "venv_tree_sha256", "interpreter_path", "interpreter_sha256", "requirements_sha256", "requirements_dev_sha256"], "TEST_RUNTIME_PYTHON_FIELDS_INVALID");
  if (value.python_runtime.venv_path !== ".venv" || value.python_runtime.venv_tree_sha256 !== "c67b68ec9436f4a13f41df0eff9b552ca3f1d8b9e759113ebd23eefbe9419041" || value.python_runtime.interpreter_path !== "/usr/bin/python3.11" || value.python_runtime.interpreter_sha256 !== "c3d7aaf77a0fe9486380e2b551b9aa7c37f76f46ebe627d4dcad0c38e6485d98" || value.python_runtime.requirements_sha256 !== "702687ef5d857d239673a911520c2cbe805fd2578b7708b16a547234a8274d5d" || value.python_runtime.requirements_dev_sha256 !== "2fa82fddabeb9ed6fb4390790479a81d9affeb5533a79e658cec4c44e5d1270b") reject("TEST_RUNTIME_PYTHON_INVALID");
  exactKeys(value.test_inventory, ["path", "sha256", "total_tests", "required_tests", "not_applicable_tests", "category_counts"], "TEST_RUNTIME_INVENTORY_FIELDS_INVALID");
  exactKeys(value.test_inventory.category_counts, ["BROWSER", "HISTORICAL_D1_SITES", "POSTGRES", "POSTGRES_ALIAS", "PURE_NODE", "RELEASE_CONTRACT", "SPECIAL_HARNESS"], "TEST_RUNTIME_INVENTORY_CATEGORY_FIELDS_INVALID");
  if (value.test_inventory.path !== "chenyida_erp_site/release/release-test-inventory-v1.json" || value.test_inventory.sha256 !== RELEASE_TEST_INVENTORY_SHA256 || value.test_inventory.total_tests !== 236 || value.test_inventory.required_tests !== 212 || value.test_inventory.not_applicable_tests !== 24 || canonicalJson(value.test_inventory.category_counts) !== canonicalJson({ BROWSER: 6, HISTORICAL_D1_SITES: 22, POSTGRES: 83, POSTGRES_ALIAS: 2, PURE_NODE: 113, RELEASE_CONTRACT: 6, SPECIAL_HARNESS: 4 })) reject("TEST_RUNTIME_INVENTORY_INVALID");
  if (raw !== null && sha256(raw) !== RELEASE_TEST_RUNTIME_POLICY_SHA256) reject("TEST_RUNTIME_POLICY_SHA256_MISMATCH");
  return value;
}

export function validateCandidate(value, codePrefix = "CANDIDATE") {
  exactKeys(value, ["git_commit", "git_tree", "package_version", "web_image_digest", "worker_image_digest", "migration_allowlist_sha256"], `${codePrefix}_FIELDS_INVALID`);
  string(value.git_commit, COMMIT, `${codePrefix}_GIT_COMMIT_INVALID`);
  string(value.git_tree, COMMIT, `${codePrefix}_GIT_TREE_INVALID`);
  string(value.package_version, VERSION, `${codePrefix}_VERSION_INVALID`);
  string(value.web_image_digest, DIGEST, `${codePrefix}_WEB_IMAGE_INVALID`);
  string(value.worker_image_digest, DIGEST, `${codePrefix}_WORKER_IMAGE_INVALID`);
  if (value.web_image_digest === value.worker_image_digest) reject(`${codePrefix}_IMAGE_COLLISION`);
  string(value.migration_allowlist_sha256, SHA256, `${codePrefix}_MIGRATION_DIGEST_INVALID`);
  return value;
}

function validateControl(value, fields, code) {
  exactKeys(value, fields, `${code}_FIELDS_INVALID`);
  for (const field of fields) string(value[field], SHA256, `${code}_DIGEST_INVALID`);
  return value;
}

function validateManifestControl(value, requireImageAuthorization = false) {
  exactKeys(value, ["supervisor_bundle_sha256", "image_evidence_authorization_sha256", "release_gate_authorization_sha256", "manifest_authorization_sha256"], "RELEASE_CONTROL_FIELDS_INVALID");
  for (const field of ["supervisor_bundle_sha256", "release_gate_authorization_sha256", "manifest_authorization_sha256"]) string(value[field], SHA256, "RELEASE_CONTROL_DIGEST_INVALID");
  if (value.image_evidence_authorization_sha256 !== null) string(value.image_evidence_authorization_sha256, SHA256, "RELEASE_CONTROL_DIGEST_INVALID");
  if (requireImageAuthorization && value.image_evidence_authorization_sha256 === null) reject("RELEASE_CONTROL_IMAGE_AUTHORIZATION_REQUIRED");
  return value;
}

export function validateSbomEvidence(value) {
  exactKeys(value, ["schema_version", "contract", "generated_at", "scope", "candidate", "format", "documents", "provenance_file", "provenance_sha256", "result"], "SBOM_EVIDENCE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_SBOM_EVIDENCE_CONTRACT) reject("SBOM_EVIDENCE_VERSION_INVALID");
  iso(value.generated_at, "SBOM_EVIDENCE_TIME_INVALID");
  if (!["SOURCE_LOCKFILE", "WEB_AND_WORKER_IMAGES"].includes(value.scope)) reject("SBOM_EVIDENCE_SCOPE_INVALID");
  validateCandidate(value.candidate, "SBOM_CANDIDATE");
  if (!Array.isArray(value.documents)) reject("SBOM_DOCUMENTS_INVALID");
  const expectedServices = value.scope === "WEB_AND_WORKER_IMAGES" ? ["web", "worker"] : ["source"];
  if (value.documents.length !== expectedServices.length) reject("SBOM_DOCUMENTS_INVALID");
  value.documents.forEach((document, index) => {
    exactKeys(document, ["service", "file", "sha256"], "SBOM_DOCUMENT_FIELDS_INVALID");
    if (document.service !== expectedServices[index]) reject("SBOM_DOCUMENT_SERVICE_INVALID");
    artifactFilename(document.file, "SBOM_DOCUMENT_PATH_INVALID");
    string(document.sha256, SHA256, "SBOM_DOCUMENT_SHA256_INVALID");
  });
  if (new Set(value.documents.map((document) => document.file)).size !== value.documents.length) reject("SBOM_DOCUMENTS_INVALID");
  if (value.scope === "WEB_AND_WORKER_IMAGES") {
    if (value.format !== "TRIVY_CYCLONEDX_1_6_JSON_SET") reject("SBOM_EVIDENCE_FORMAT_INVALID");
    artifactFilename(value.provenance_file, "SBOM_PROVENANCE_PATH_INVALID");
    string(value.provenance_sha256, SHA256, "SBOM_PROVENANCE_SHA256_INVALID");
  } else if (value.format !== "CYCLONEDX_1_6_JSON" || value.provenance_file !== null || value.provenance_sha256 !== null) reject("SBOM_EVIDENCE_FORMAT_INVALID");
  if (value.result !== "VERIFIED") reject("SBOM_EVIDENCE_RESULT_INVALID");
  return value;
}

export function validateSecurityEvidence(value) {
  exactKeys(value, ["schema_version", "contract", "generated_at", "candidate", "sbom_evidence_sha256", "provenance_file", "provenance_sha256", "scanner", "scanner_version", "scanner_image_reference", "scanner_binary_sha256", "policy_id", "policy_sha256", "raw_report_file", "raw_report_sha256", "vulnerability_database_updated_at", "counts", "result", "reason"], "SECURITY_EVIDENCE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_SECURITY_EVIDENCE_CONTRACT) reject("SECURITY_EVIDENCE_VERSION_INVALID");
  iso(value.generated_at, "SECURITY_EVIDENCE_TIME_INVALID");
  validateCandidate(value.candidate, "SECURITY_CANDIDATE");
  string(value.sbom_evidence_sha256, SHA256, "SECURITY_SBOM_DIGEST_INVALID");
  string(value.scanner, IDENTIFIER, "SECURITY_SCANNER_INVALID");
  nullableIso(value.vulnerability_database_updated_at, "SECURITY_DATABASE_TIME_INVALID");
  exactKeys(value.counts, ["critical", "high", "medium", "low", "unknown"], "SECURITY_COUNTS_FIELDS_INVALID");
  for (const key of Object.keys(value.counts)) {
    const count = value.counts[key];
    if (count !== null) integer(count, 0, 1_000_000, "SECURITY_COUNT_INVALID");
  }
  if (!["PASS", "NOT_EVALUATED"].includes(value.result)) reject("SECURITY_RESULT_INVALID");
  nullableString(value.reason, "SECURITY_REASON_INVALID");
  if (value.result === "PASS") {
    string(value.scanner_version, IDENTIFIER, "SECURITY_SCANNER_VERSION_INVALID");
    string(value.scanner_binary_sha256, SHA256, "SECURITY_SCANNER_BINARY_INVALID");
    string(value.policy_id, IDENTIFIER, "SECURITY_POLICY_ID_INVALID");
    string(value.policy_sha256, SHA256, "SECURITY_POLICY_SHA256_INVALID");
    artifactFilename(value.provenance_file, "SECURITY_PROVENANCE_PATH_INVALID");
    string(value.provenance_sha256, SHA256, "SECURITY_PROVENANCE_SHA256_INVALID");
    artifactFilename(value.raw_report_file, "SECURITY_RAW_REPORT_PATH_INVALID");
    string(value.raw_report_sha256, SHA256, "SECURITY_RAW_REPORT_SHA256_INVALID");
    if (path.basename(value.raw_report_file) !== value.raw_report_file || value.scanner !== "trivy" || value.scanner_version !== RELEASE_TRIVY_VERSION || value.scanner_image_reference !== RELEASE_TRIVY_IMAGE_REFERENCE || value.policy_id !== RELEASE_VULNERABILITY_POLICY_ID || value.policy_sha256 !== RELEASE_VULNERABILITY_POLICY_SHA256 || value.vulnerability_database_updated_at === null || value.reason !== null || Object.values(value.counts).some((count) => count !== 0)) reject("SECURITY_PASS_EVIDENCE_INVALID");
  } else if (value.provenance_file !== null || value.provenance_sha256 !== null || value.scanner !== "NONE" || value.scanner_version !== null || value.scanner_image_reference !== null || value.scanner_binary_sha256 !== null || value.policy_id !== null || value.policy_sha256 !== null || value.raw_report_file !== null || value.raw_report_sha256 !== null || value.vulnerability_database_updated_at !== null || value.reason === null || Object.values(value.counts).some((count) => count !== null)) {
    reject("SECURITY_NOT_EVALUATED_EVIDENCE_INVALID");
  }
  return value;
}

function exactProperties(value, expected, code) {
  if (!Array.isArray(value) || value.length !== Object.keys(expected).length) reject(code);
  const actual = new Map();
  for (const item of value) {
    exactKeys(item, ["name", "value"], code);
    if (typeof item.name !== "string" || typeof item.value !== "string" || actual.has(item.name)) reject(code);
    actual.set(item.name, item.value);
  }
  if (Object.entries(expected).some(([name, expectedValue]) => actual.get(name) !== expectedValue)) reject(code);
}

export function validateImageSbomDocument(value, sbom) {
  exactKeys(value, ["bomFormat", "specVersion", "serialNumber", "version", "metadata", "components"], "SBOM_DOCUMENT_FIELDS_INVALID");
  if (value.bomFormat !== "CycloneDX" || value.specVersion !== "1.6" || typeof value.serialNumber !== "string" || !/^urn:uuid:[0-9a-f-]{36}$/i.test(value.serialNumber) || value.version !== 1) reject("SBOM_DOCUMENT_IDENTITY_INVALID");
  exactKeys(value.metadata, ["timestamp", "component", "properties"], "SBOM_METADATA_FIELDS_INVALID");
  if (value.metadata.timestamp !== sbom.generated_at) reject("SBOM_METADATA_TIME_MISMATCH");
  exactKeys(value.metadata.component, ["type", "name", "version"], "SBOM_METADATA_COMPONENT_INVALID");
  if (value.metadata.component.type !== "application" || value.metadata.component.name !== "chenyida-erp-selfhosted" || value.metadata.component.version !== sbom.candidate.package_version) reject("SBOM_METADATA_COMPONENT_INVALID");
  exactProperties(value.metadata.properties, {
    "chenyida:evidence-scope": "WEB_AND_WORKER_IMAGES",
    "chenyida:git-commit": sbom.candidate.git_commit,
    "chenyida:git-tree": sbom.candidate.git_tree,
  }, "SBOM_METADATA_PROPERTIES_INVALID");
  if (!Array.isArray(value.components) || value.components.length < 4 || value.components.length > 100_000) reject("SBOM_IMAGE_COMPONENTS_INVALID");
  const expected = new Map([["web", sbom.candidate.web_image_digest], ["worker", sbom.candidate.worker_image_digest]]);
  const seen = new Set(); const packageCounts = new Map([["web", 0], ["worker", 0]]);
  for (const component of value.components) {
    if (component?.type === "container") {
      exactKeys(component, ["type", "bom-ref", "name", "version", "hashes", "properties"], "SBOM_IMAGE_COMPONENT_FIELDS_INVALID");
      if (!expected.has(component.name) || seen.has(component["bom-ref"]) || component.version !== sbom.candidate.package_version || component["bom-ref"] !== `urn:chenyida-erp:image:${component.name}:${expected.get(component.name)}`) reject("SBOM_IMAGE_COMPONENT_INVALID");
      if (!Array.isArray(component.hashes) || component.hashes.length !== 1) reject("SBOM_IMAGE_HASH_INVALID");
      exactKeys(component.hashes[0], ["alg", "content"], "SBOM_IMAGE_HASH_INVALID");
      if (component.hashes[0].alg !== "SHA-256" || component.hashes[0].content !== expected.get(component.name).slice("sha256:".length)) reject("SBOM_IMAGE_HASH_INVALID");
      exactProperties(component.properties, { "chenyida:service": component.name, "chenyida:image-digest": expected.get(component.name) }, "SBOM_IMAGE_PROPERTIES_INVALID");
    } else {
      exactKeys(component, ["type", "bom-ref", "name", "version", "purl", "hashes", "properties"], "SBOM_PACKAGE_COMPONENT_FIELDS_INVALID");
      if (!["application", "file", "framework", "library"].includes(component.type) || typeof component["bom-ref"] !== "string" || component["bom-ref"].length < 1 || component["bom-ref"].length > 500 || typeof component.name !== "string" || component.name.length < 1 || component.name.length > 300 || typeof component.version !== "string" || component.version.length < 1 || component.version.length > 200 || typeof component.purl !== "string" || !component.purl.startsWith("pkg:")) reject("SBOM_PACKAGE_COMPONENT_INVALID");
      if (!Array.isArray(component.hashes) || component.hashes.length < 1 || component.hashes.length > 8 || component.hashes.some((hash) => { try { exactKeys(hash, ["alg", "content"], "SBOM_PACKAGE_HASH_INVALID"); } catch { return true; } return typeof hash.alg !== "string" || !["SHA-256", "SHA-512"].includes(hash.alg) || typeof hash.content !== "string" || !/^[0-9a-f]{64,128}$/.test(hash.content); })) reject("SBOM_PACKAGE_HASH_INVALID");
      if (!Array.isArray(component.properties) || component.properties.length !== 2) reject("SBOM_PACKAGE_PROPERTIES_INVALID");
      const properties = Object.fromEntries(component.properties.map((entry) => [entry?.name, entry?.value]));
      const service = properties["chenyida:service"];
      if (!expected.has(service)) reject("SBOM_PACKAGE_PROPERTIES_INVALID");
      exactProperties(component.properties, { "chenyida:service": service, "chenyida:image-digest": expected.get(service) }, "SBOM_PACKAGE_PROPERTIES_INVALID");
      packageCounts.set(service, packageCounts.get(service) + 1);
    }
    if (seen.has(component["bom-ref"])) reject("SBOM_COMPONENT_DUPLICATE");
    seen.add(component["bom-ref"]);
  }
  if (![...expected].every(([service, digest]) => seen.has(`urn:chenyida-erp:image:${service}:${digest}`) && packageCounts.get(service) > 0)) reject("SBOM_IMAGE_COMPONENTS_INCOMPLETE");
  return value;
}

export function validateSourceLockfileSbomDocument(value, sbom) {
  exactKeys(value, ["bomFormat", "specVersion", "serialNumber", "version", "metadata", "components"], "SBOM_DOCUMENT_FIELDS_INVALID");
  if (value.bomFormat !== "CycloneDX" || value.specVersion !== "1.6" || typeof value.serialNumber !== "string" || !/^urn:uuid:[0-9a-f-]{36}$/i.test(value.serialNumber) || value.version !== 1) reject("SBOM_DOCUMENT_IDENTITY_INVALID");
  exactKeys(value.metadata, ["timestamp", "component", "properties"], "SBOM_METADATA_FIELDS_INVALID");
  if (value.metadata.timestamp !== sbom.generated_at) reject("SBOM_METADATA_TIME_MISMATCH");
  exactKeys(value.metadata.component, ["type", "name", "version"], "SBOM_METADATA_COMPONENT_INVALID");
  if (value.metadata.component.type !== "application" || value.metadata.component.name !== "chenyida-erp-selfhosted" || value.metadata.component.version !== sbom.candidate.package_version) reject("SBOM_METADATA_COMPONENT_INVALID");
  exactProperties(value.metadata.properties, {
    "chenyida:evidence-scope": "SOURCE_LOCKFILE_NOT_IMAGE_CONTENT",
    "chenyida:git-commit": sbom.candidate.git_commit,
    "chenyida:git-tree": sbom.candidate.git_tree,
  }, "SBOM_METADATA_PROPERTIES_INVALID");
  if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > 100_000) reject("SBOM_SOURCE_COMPONENTS_INVALID");
  const seen = new Set();
  for (const component of value.components) {
    exactKeys(component, ["type", "name", "version", "properties"], "SBOM_SOURCE_COMPONENT_FIELDS_INVALID");
    if (component.type !== "library" || typeof component.name !== "string" || component.name.length < 1 || component.name.length > 300 || typeof component.version !== "string" || component.version.length < 1 || component.version.length > 200) reject("SBOM_SOURCE_COMPONENT_INVALID");
    exactProperties(component.properties, { "chenyida:lockfile-path": `node_modules/${component.name}` }, "SBOM_SOURCE_COMPONENT_PROPERTIES_INVALID");
    const identity = `${component.name}\0${component.version}`;
    if (seen.has(identity)) reject("SBOM_SOURCE_COMPONENT_DUPLICATE");
    seen.add(identity);
  }
  return value;
}

export function validateSecurityScanReport(value, security) {
  exactKeys(value, ["schema_version", "contract", "generated_at", "candidate", "scanner", "policy", "vulnerability_database_updated_at", "targets", "counts", "result"], "SECURITY_REPORT_FIELDS_INVALID");
  iso(value.generated_at, "SECURITY_REPORT_TIME_INVALID");
  iso(value.vulnerability_database_updated_at, "SECURITY_REPORT_DATABASE_TIME_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_SECURITY_SCAN_REPORT_CONTRACT || value.generated_at !== security.generated_at || value.vulnerability_database_updated_at !== security.vulnerability_database_updated_at || value.result !== security.result || value.result !== "PASS") reject("SECURITY_REPORT_IDENTITY_INVALID");
  if (canonicalJson(value.candidate) !== canonicalJson(security.candidate)) reject("SECURITY_REPORT_CANDIDATE_MISMATCH");
  exactKeys(value.scanner, ["name", "version", "image_reference", "binary_sha256"], "SECURITY_REPORT_SCANNER_INVALID");
  if (value.scanner.name !== security.scanner || value.scanner.version !== security.scanner_version || value.scanner.image_reference !== security.scanner_image_reference || value.scanner.binary_sha256 !== security.scanner_binary_sha256) reject("SECURITY_REPORT_SCANNER_MISMATCH");
  exactKeys(value.policy, ["id", "sha256"], "SECURITY_REPORT_POLICY_INVALID");
  if (value.policy.id !== security.policy_id || value.policy.sha256 !== security.policy_sha256) reject("SECURITY_REPORT_POLICY_MISMATCH");
  exactKeys(value.counts, ["critical", "high", "medium", "low", "unknown"], "SECURITY_REPORT_COUNTS_INVALID");
  if (canonicalJson(value.counts) !== canonicalJson(security.counts) || Object.values(value.counts).some((count) => count !== 0)) reject("SECURITY_REPORT_COUNTS_INVALID");
  if (!Array.isArray(value.targets) || value.targets.length !== 2) reject("SECURITY_REPORT_TARGETS_INVALID");
  const expected = new Map([["web", security.candidate.web_image_digest], ["worker", security.candidate.worker_image_digest]]);
  const seen = new Set();
  for (const target of value.targets) {
    exactKeys(target, ["service", "image_digest", "counts", "result"], "SECURITY_REPORT_TARGET_FIELDS_INVALID");
    exactKeys(target.counts, ["critical", "high", "medium", "low", "unknown"], "SECURITY_REPORT_TARGET_COUNTS_INVALID");
    if (!expected.has(target.service) || seen.has(target.service) || target.image_digest !== expected.get(target.service) || target.result !== "PASS" || Object.values(target.counts).some((count) => count !== 0)) reject("SECURITY_REPORT_TARGET_INVALID");
    seen.add(target.service);
  }
  return value;
}

function validateResourceSnapshot(value, prefix) {
  exactKeys(value, ["available_memory_mib", "swap_used_mib", "swap_used_percent", "root_free_gib", "load_1m", "temporary_containers"], `${prefix}_FIELDS_INVALID`);
  for (const key of ["available_memory_mib", "swap_used_mib", "swap_used_percent", "root_free_gib", "load_1m"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0) reject(`${prefix}_VALUE_INVALID`);
  }
  integer(value.temporary_containers, 0, 10000, `${prefix}_CONTAINER_COUNT_INVALID`);
  return value;
}

export function validateReleaseGateReport(value) {
  exactKeys(value, ["schema_version", "contract", "plan_id", "plan_sha256", "run_id", "generated_at", "completed_at", "runtime_guard", "control", "candidate", "steps", "evidence", "resources", "result"], "GATE_REPORT_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RELEASE_GATE_REPORT_CONTRACT) reject("GATE_REPORT_VERSION_INVALID");
  string(value.plan_id, IDENTIFIER, "GATE_REPORT_PLAN_ID_INVALID");
  string(value.plan_sha256, SHA256, "GATE_REPORT_PLAN_SHA256_INVALID");
  string(value.run_id, IDENTIFIER, "GATE_REPORT_RUN_ID_INVALID");
  iso(value.generated_at, "GATE_REPORT_STARTED_AT_INVALID");
  iso(value.completed_at, "GATE_REPORT_COMPLETED_AT_INVALID");
  if (Date.parse(value.completed_at) < Date.parse(value.generated_at)) reject("GATE_REPORT_TIME_ORDER_INVALID");
  try { validatePreDeployRuntimeGuard(value.runtime_guard); } catch (error) { reject(error?.code || "GATE_REPORT_RUNTIME_GUARD_INVALID"); }
  validateControl(value.control, ["supervisor_bundle_sha256", "authorization_sha256"], "GATE_REPORT_CONTROL");
  validateCandidate(value.candidate, "GATE_REPORT_CANDIDATE");
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 100) reject("GATE_REPORT_STEPS_INVALID");
  const ids = new Set();
  value.steps.forEach((step, index) => {
    exactKeys(step, ["ordinal", "id", "result", "started_at", "finished_at", "duration_ms", "exit_code", "stdout_sha256", "stderr_sha256", "reason"], "GATE_REPORT_STEP_FIELDS_INVALID");
    if (step.ordinal !== index + 1) reject("GATE_REPORT_STEP_ORDER_INVALID");
    string(step.id, IDENTIFIER, "GATE_REPORT_STEP_ID_INVALID");
    if (ids.has(step.id)) reject("GATE_REPORT_STEP_ID_DUPLICATE");
    ids.add(step.id);
    if (!["PASS", "FAIL", "NOT_APPLICABLE", "BLOCKED"].includes(step.result)) reject("GATE_REPORT_STEP_RESULT_INVALID");
    nullableIso(step.started_at, "GATE_REPORT_STEP_TIME_INVALID");
    nullableIso(step.finished_at, "GATE_REPORT_STEP_TIME_INVALID");
    integer(step.duration_ms, 0, 86_400_000, "GATE_REPORT_STEP_DURATION_INVALID");
    if (step.exit_code !== null) integer(step.exit_code, 0, 255, "GATE_REPORT_STEP_EXIT_INVALID");
    string(step.stdout_sha256, SHA256, "GATE_REPORT_STDOUT_DIGEST_INVALID");
    string(step.stderr_sha256, SHA256, "GATE_REPORT_STDERR_DIGEST_INVALID");
    nullableString(step.reason, "GATE_REPORT_STEP_REASON_INVALID");
    if (step.result === "PASS" && (step.exit_code !== 0 || step.started_at === null || step.finished_at === null || step.reason !== null)) reject("GATE_REPORT_STEP_PASS_INVALID");
    if (step.result === "NOT_APPLICABLE" && (step.exit_code !== null || step.started_at !== null || step.finished_at !== null || step.reason === null)) reject("GATE_REPORT_STEP_NA_INVALID");
  });
  exactKeys(value.evidence, ["sbom_file", "sbom_sha256", "sbom_scope", "security_file", "security_sha256", "security_result"], "GATE_REPORT_EVIDENCE_FIELDS_INVALID");
  artifactFilename(value.evidence.sbom_file, "GATE_REPORT_SBOM_PATH_INVALID");
  string(value.evidence.sbom_sha256, SHA256, "GATE_REPORT_SBOM_SHA256_INVALID");
  if (!["SOURCE_LOCKFILE", "WEB_AND_WORKER_IMAGES"].includes(value.evidence.sbom_scope)) reject("GATE_REPORT_SBOM_SCOPE_INVALID");
  artifactFilename(value.evidence.security_file, "GATE_REPORT_SECURITY_PATH_INVALID");
  string(value.evidence.security_sha256, SHA256, "GATE_REPORT_SECURITY_SHA256_INVALID");
  if (!["PASS", "NOT_EVALUATED"].includes(value.evidence.security_result)) reject("GATE_REPORT_SECURITY_RESULT_INVALID");
  exactKeys(value.resources, ["initial", "final", "test_runtime", "baseline_runtime_services", "final_runtime_services", "baseline_container_count", "preexisting_temporary_container_ids", "minimum_available_memory_mib", "maximum_swap_used_percent", "maximum_swap_growth_mib_60s", "minimum_root_free_gib", "maximum_load_1m", "maximum_temporary_containers", "residual_container_ids", "baseline_runtime_failure", "runtime_transition_failure", "final_runtime_failure", "final_resource_failure"], "GATE_REPORT_RESOURCES_FIELDS_INVALID");
  validateResourceSnapshot(value.resources.initial, "GATE_REPORT_INITIAL_RESOURCE");
  validateResourceSnapshot(value.resources.final, "GATE_REPORT_FINAL_RESOURCE");
  exactKeys(value.resources.test_runtime, ["policy_sha256", "node_image_digest", "postgres_image_digest", "posix_image_digest", "browser_image_digest", "browser_executable_sha256", "node_modules_tree_sha256", "python_venv_tree_sha256"], "GATE_REPORT_TEST_RUNTIME_FIELDS_INVALID");
  for (const key of Object.keys(value.resources.test_runtime)) string(value.resources.test_runtime[key], key.endsWith("_digest") ? DIGEST : SHA256, "GATE_REPORT_TEST_RUNTIME_VALUE_INVALID");
  if (value.resources.test_runtime.policy_sha256 !== RELEASE_TEST_RUNTIME_POLICY_SHA256) reject("GATE_REPORT_TEST_RUNTIME_POLICY_INVALID");
  try {
    validatePreDeployRuntimeSnapshotShape(value.resources.baseline_runtime_services, "GATE_REPORT_BASELINE_RUNTIME");
    validatePreDeployRuntimeSnapshotShape(value.resources.final_runtime_services, "GATE_REPORT_FINAL_RUNTIME");
  } catch (error) { reject(error?.code || "GATE_REPORT_RUNTIME_INVALID"); }
  let baselineRuntimePassed = true; let finalRuntimePassed = true;
  try { validatePreDeployRuntimeSnapshot(value.resources.baseline_runtime_services, value.runtime_guard, "GATE_REPORT_BASELINE_RUNTIME"); } catch { baselineRuntimePassed = false; }
  try { validatePreDeployRuntimeSnapshot(value.resources.final_runtime_services, value.runtime_guard, "GATE_REPORT_FINAL_RUNTIME"); } catch { finalRuntimePassed = false; }
  integer(value.resources.baseline_container_count, 0, 10000, "GATE_REPORT_RESOURCE_VALUE_INVALID");
  if (value.resources.baseline_container_count < value.resources.baseline_runtime_services.length) reject("GATE_REPORT_BASELINE_CONTAINER_COUNT_INVALID");
  for (const key of ["minimum_available_memory_mib", "maximum_swap_used_percent", "maximum_swap_growth_mib_60s", "minimum_root_free_gib", "maximum_load_1m"]) {
    if (typeof value.resources[key] !== "number" || !Number.isFinite(value.resources[key]) || value.resources[key] < 0) reject("GATE_REPORT_RESOURCE_VALUE_INVALID");
  }
  integer(value.resources.maximum_temporary_containers, 0, 10000, "GATE_REPORT_RESOURCE_VALUE_INVALID");
  for (const key of ["preexisting_temporary_container_ids", "residual_container_ids"]) {
    if (!Array.isArray(value.resources[key]) || value.resources[key].some((item) => typeof item !== "string" || !/^[0-9a-f]{12,64}$/.test(item))) reject("GATE_REPORT_RESIDUAL_CONTAINERS_INVALID");
  }
  for (const key of ["baseline_runtime_failure", "runtime_transition_failure", "final_runtime_failure"]) nullableString(value.resources[key], "GATE_REPORT_RUNTIME_FAILURE_INVALID");
  nullableString(value.resources.final_resource_failure, "GATE_REPORT_RESOURCE_FAILURE_INVALID");
  if (!["PASS", "FAIL", "BLOCKED"].includes(value.result)) reject("GATE_REPORT_RESULT_INVALID");
  const allPassed = value.steps.every((step) => ["PASS", "NOT_APPLICABLE"].includes(step.result));
  const evidencePassed = value.evidence.sbom_scope === "WEB_AND_WORKER_IMAGES" && value.evidence.security_result === "PASS";
  const systemPassed = baselineRuntimePassed && finalRuntimePassed && canonicalJson(value.resources.baseline_runtime_services) === canonicalJson(value.resources.final_runtime_services) && value.resources.preexisting_temporary_container_ids.length === 0 && value.resources.residual_container_ids.length === 0 && value.resources.baseline_runtime_failure === null && value.resources.runtime_transition_failure === null && value.resources.final_runtime_failure === null && value.resources.final_resource_failure === null;
  if ((value.result === "PASS") !== (allPassed && evidencePassed && systemPassed)) reject("GATE_REPORT_RESULT_INCONSISTENT");
  if (value.result === "FAIL" && !value.steps.some((step) => step.result === "FAIL") && [value.resources.baseline_runtime_failure, value.resources.runtime_transition_failure, value.resources.final_runtime_failure, value.resources.final_resource_failure].every((failure) => failure === null)) reject("GATE_REPORT_FAILURE_REASON_MISSING");
  return value;
}

export function validateReleaseGateAttempt(value) {
  exactKeys(value, ["schema_version", "contract", "run_id", "generated_at", "completed_at", "runtime_guard", "control", "candidate", "result", "failure_code"], "GATE_ATTEMPT_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RELEASE_GATE_ATTEMPT_CONTRACT || value.result !== "FAIL") reject("GATE_ATTEMPT_IDENTITY_INVALID");
  string(value.run_id, IDENTIFIER, "GATE_ATTEMPT_RUN_ID_INVALID");
  iso(value.generated_at, "GATE_ATTEMPT_TIME_INVALID"); iso(value.completed_at, "GATE_ATTEMPT_TIME_INVALID");
  if (Date.parse(value.completed_at) < Date.parse(value.generated_at)) reject("GATE_ATTEMPT_TIME_ORDER_INVALID");
  try { validateRuntimeGuardBinding(value.runtime_guard, PRE_DEPLOY_RUNTIME_GUARD_MODE, "GATE_ATTEMPT_RUNTIME_GUARD_INVALID"); } catch (error) { reject(error?.code || "GATE_ATTEMPT_RUNTIME_GUARD_INVALID"); }
  validateControl(value.control, ["supervisor_bundle_sha256", "authorization_sha256"], "GATE_ATTEMPT_CONTROL");
  validateCandidate(value.candidate, "GATE_ATTEMPT_CANDIDATE");
  string(value.failure_code, /^[A-Z][A-Z0-9_]{2,119}$/, "GATE_ATTEMPT_FAILURE_CODE_INVALID");
  return value;
}

function validateImage(value, service) {
  exactKeys(value, ["service", "image_reference", "image_digest", "oci_version", "oci_revision", "baked_version", "baked_revision"], "RELEASE_IMAGE_FIELDS_INVALID");
  if (value.service !== service) reject("RELEASE_IMAGE_SERVICE_INVALID");
  if (typeof value.image_reference !== "string" || value.image_reference.length > 255 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/.test(value.image_reference)) reject("RELEASE_IMAGE_REFERENCE_INVALID");
  string(value.image_digest, DIGEST, "RELEASE_IMAGE_DIGEST_INVALID");
  string(value.oci_version, VERSION, "RELEASE_IMAGE_OCI_VERSION_INVALID");
  string(value.oci_revision, COMMIT, "RELEASE_IMAGE_OCI_REVISION_INVALID");
  string(value.baked_version, VERSION, "RELEASE_IMAGE_BAKED_VERSION_INVALID");
  string(value.baked_revision, COMMIT, "RELEASE_IMAGE_BAKED_REVISION_INVALID");
  return value;
}

export function validateReleaseManifest(value, { now = new Date(), requireEligible = false } = {}) {
  exactKeys(value, ["schema_version", "contract", "release_id", "generated_at", "expires_at", "promotion_status", "lifecycle", "control", "source", "images", "migrations", "gate", "evidence", "allowed_deployment_classes"], "RELEASE_MANIFEST_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RELEASE_MANIFEST_CONTRACT) reject("RELEASE_MANIFEST_VERSION_INVALID");
  string(value.release_id, IDENTIFIER, "RELEASE_ID_INVALID");
  iso(value.generated_at, "RELEASE_GENERATED_AT_INVALID");
  iso(value.expires_at, "RELEASE_EXPIRES_AT_INVALID");
  const lifetime = Date.parse(value.expires_at) - Date.parse(value.generated_at);
  if (lifetime <= 0 || lifetime > 7 * 24 * 60 * 60 * 1000) reject("RELEASE_LIFETIME_INVALID");
  if (!["ELIGIBLE", "BLOCKED"].includes(value.promotion_status)) reject("RELEASE_PROMOTION_STATUS_INVALID");
  try { validateReleaseLifecycle(value.lifecycle); } catch (error) { reject(error?.code || "RELEASE_LIFECYCLE_INVALID"); }
  validateManifestControl(value.control, value.promotion_status === "ELIGIBLE");
  exactKeys(value.source, ["git_commit", "git_tree", "worktree_clean", "package_path", "package_version", "package_sha256", "dockerfile_path", "dockerfile_sha256", "compose_path", "compose_sha256", "release_compose_path", "release_compose_sha256"], "RELEASE_SOURCE_FIELDS_INVALID");
  string(value.source.git_commit, COMMIT, "RELEASE_SOURCE_COMMIT_INVALID");
  string(value.source.git_tree, COMMIT, "RELEASE_SOURCE_TREE_INVALID");
  if (value.source.worktree_clean !== true) reject("RELEASE_SOURCE_NOT_CLEAN");
  safePath(value.source.package_path, "RELEASE_PACKAGE_PATH_INVALID");
  string(value.source.package_version, VERSION, "RELEASE_PACKAGE_VERSION_INVALID");
  string(value.source.package_sha256, SHA256, "RELEASE_PACKAGE_SHA256_INVALID");
  safePath(value.source.dockerfile_path, "RELEASE_DOCKERFILE_PATH_INVALID");
  string(value.source.dockerfile_sha256, SHA256, "RELEASE_DOCKERFILE_SHA256_INVALID");
  safePath(value.source.compose_path, "RELEASE_COMPOSE_PATH_INVALID");
  string(value.source.compose_sha256, SHA256, "RELEASE_COMPOSE_SHA256_INVALID");
  if (value.source.release_compose_path !== "chenyida_erp_site/compose.release.yml") reject("RELEASE_COMPOSE_PATH_INVALID");
  string(value.source.release_compose_sha256, SHA256, "RELEASE_COMPOSE_SHA256_INVALID");
  exactKeys(value.images, ["web", "worker"], "RELEASE_IMAGES_FIELDS_INVALID");
  validateImage(value.images.web, "web");
  validateImage(value.images.worker, "worker");
  if (value.images.web.image_digest === value.images.worker.image_digest) reject("RELEASE_IMAGE_COLLISION");
  for (const image of [value.images.web, value.images.worker]) {
    if (image.oci_version !== value.source.package_version || image.baked_version !== value.source.package_version || image.oci_revision !== value.source.git_commit || image.baked_revision !== value.source.git_commit) reject("RELEASE_IMAGE_SOURCE_MISMATCH");
  }
  exactKeys(value.migrations, ["directory", "head", "allowlist_sha256", "entries"], "RELEASE_MIGRATIONS_FIELDS_INVALID");
  safePath(value.migrations.directory, "RELEASE_MIGRATION_DIRECTORY_INVALID");
  validateMigrationAllowlist(value.migrations.entries, value.migrations.allowlist_sha256);
  if (value.migrations.head !== value.migrations.entries.at(-1).filename) reject("RELEASE_MIGRATION_HEAD_INVALID");
  exactKeys(value.gate, ["plan_id", "plan_file", "plan_sha256", "report_file", "report_sha256", "runtime_guard_mode", "result"], "RELEASE_GATE_FIELDS_INVALID");
  string(value.gate.plan_id, IDENTIFIER, "RELEASE_GATE_PLAN_ID_INVALID");
  if (value.gate.plan_id !== RELEASE_GATE_PLAN_ID) reject("RELEASE_GATE_PLAN_ID_INVALID");
  artifactFilename(value.gate.plan_file, "RELEASE_GATE_PLAN_PATH_INVALID");
  string(value.gate.plan_sha256, SHA256, "RELEASE_GATE_PLAN_SHA256_INVALID");
  artifactFilename(value.gate.report_file, "RELEASE_GATE_REPORT_PATH_INVALID");
  string(value.gate.report_sha256, SHA256, "RELEASE_GATE_REPORT_SHA256_INVALID");
  if (value.gate.runtime_guard_mode !== PRE_DEPLOY_RUNTIME_GUARD_MODE || value.gate.runtime_guard_mode !== value.lifecycle.pre_deploy_gate.mode) reject("RELEASE_GATE_RUNTIME_GUARD_INVALID");
  if (!["PASS", "FAIL", "BLOCKED"].includes(value.gate.result)) reject("RELEASE_GATE_RESULT_INVALID");
  exactKeys(value.evidence, ["sbom_file", "sbom_sha256", "sbom_scope", "security_file", "security_sha256", "security_result"], "RELEASE_EVIDENCE_FIELDS_INVALID");
  artifactFilename(value.evidence.sbom_file, "RELEASE_SBOM_PATH_INVALID");
  string(value.evidence.sbom_sha256, SHA256, "RELEASE_SBOM_SHA256_INVALID");
  if (!["SOURCE_LOCKFILE", "WEB_AND_WORKER_IMAGES"].includes(value.evidence.sbom_scope)) reject("RELEASE_SBOM_SCOPE_INVALID");
  artifactFilename(value.evidence.security_file, "RELEASE_SECURITY_PATH_INVALID");
  string(value.evidence.security_sha256, SHA256, "RELEASE_SECURITY_SHA256_INVALID");
  if (!["PASS", "NOT_EVALUATED"].includes(value.evidence.security_result)) reject("RELEASE_SECURITY_RESULT_INVALID");
  if (!Array.isArray(value.allowed_deployment_classes) || value.allowed_deployment_classes.length !== 1 || !["UAT", "PRODUCTION"].includes(value.allowed_deployment_classes[0])) reject("RELEASE_DEPLOYMENT_CLASSES_INVALID");
  const eligible = value.gate.result === "PASS" && value.evidence.sbom_scope === "WEB_AND_WORKER_IMAGES" && value.evidence.security_result === "PASS";
  if ((value.promotion_status === "ELIGIBLE") !== eligible) reject("RELEASE_PROMOTION_STATUS_INCONSISTENT");
  if (requireEligible && value.promotion_status !== "ELIGIBLE") reject("RELEASE_NOT_ELIGIBLE");
  if (requireEligible && now.getTime() + 5 * 60 * 1000 < Date.parse(value.generated_at)) reject("RELEASE_MANIFEST_NOT_YET_VALID");
  if (requireEligible && now.getTime() >= Date.parse(value.expires_at)) reject("RELEASE_MANIFEST_EXPIRED");
  return value;
}

export function validateAppliedMigrationRows(rows, entries, expectedCurrentHead) {
  validateMigrationAllowlist(entries);
  if (!Array.isArray(rows)) reject("APPLIED_MIGRATIONS_INVALID");
  const normalized = rows.map((row) => {
    exactKeys(row, ["version", "checksum"], "APPLIED_MIGRATION_FIELDS_INVALID");
    string(row.version, MIGRATION_FILE, "APPLIED_MIGRATION_VERSION_INVALID");
    string(row.checksum, SHA256, "APPLIED_MIGRATION_CHECKSUM_INVALID");
    return row;
  });
  if (normalized.length > entries.length) reject("APPLIED_MIGRATION_BEYOND_RELEASE_HEAD");
  normalized.forEach((row, index) => {
    if (row.version !== entries[index].filename) reject("APPLIED_MIGRATION_NOT_ALLOWLIST_PREFIX");
    if (row.checksum !== entries[index].sha256) reject("APPLIED_MIGRATION_CHECKSUM_MISMATCH");
  });
  const actualHead = normalized.length === 0 ? "EMPTY" : normalized.at(-1).version;
  if (expectedCurrentHead !== actualHead) reject("MIGRATION_CURRENT_HEAD_MISMATCH");
  return actualHead;
}

export async function verifyMigrationFilesAgainstManifest(manifest, directory) {
  const entries = await buildMigrationAllowlist(directory);
  if (entries.length !== manifest.migrations.entries.length || entries.some((entry, index) => entry.filename !== manifest.migrations.entries[index].filename || entry.sha256 !== manifest.migrations.entries[index].sha256)) reject("MIGRATION_FILES_NOT_RELEASE_ALLOWLIST");
  if (migrationAllowlistDigest(entries) !== manifest.migrations.allowlist_sha256) reject("MIGRATION_FILES_DIGEST_MISMATCH");
  return entries;
}

export async function readStableFile(file, { minimumBytes = 1, maximumBytes = MAX_JSON_BYTES, code = "RELEASE_FILE_INVALID" } = {}) {
  const absolute = path.resolve(file);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    reject(code);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < minimumBytes || stat.size > maximumBytes) reject(code);
    const raw = await handle.readFile();
    const afterHandle = await handle.stat(); const afterPath = await lstat(absolute).catch(() => null);
    if (!afterPath || afterHandle.dev !== stat.dev || afterHandle.ino !== stat.ino || afterHandle.size !== stat.size || afterHandle.mtimeMs !== stat.mtimeMs || afterHandle.ctimeMs !== stat.ctimeMs || afterPath.dev !== stat.dev || afterPath.ino !== stat.ino || afterPath.nlink !== 1) reject(code);
    return { raw, stat };
  } finally {
    await handle.close();
  }
}

export async function readStrictJsonFile(file) {
  const { raw, stat } = await readStableFile(file, { minimumBytes: 2, maximumBytes: MAX_JSON_BYTES, code: "RELEASE_JSON_FILE_INVALID" });
  return { raw: raw.toString("utf8"), stat };
}

export const RELEASE_MAX_SBOM_BYTES = MAX_SBOM_BYTES;

export async function loadReleaseManifest({ file, expectedSha256, now = new Date(), requireEligible = false, trusted = false }) {
  string(expectedSha256, SHA256, "RELEASE_EXPECTED_SHA256_INVALID");
  const absolute = path.resolve(file);
  let root = null;
  if (trusted) {
    root = await trustedArtifactRoot(path.dirname(absolute));
    if (path.join(root, "release-manifest.json") !== absolute) reject("RELEASE_TRUSTED_MANIFEST_PATH_INVALID");
  }
  const { raw, stat } = await readStrictJsonFile(absolute);
  if (trusted && (stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o7777) !== ARTIFACT_FILE_MODE)) reject("RELEASE_TRUSTED_MANIFEST_FILE_INVALID");
  if (sha256(raw) !== expectedSha256) reject("RELEASE_MANIFEST_SHA256_MISMATCH");
  const manifest = validateReleaseManifest(parseStrictJson(raw), { now, requireEligible });
  if (trusted) await verifyTrustedReleaseBundle({ root, manifest, now });
  return manifest;
}

export async function trustedArtifactRoot(root) {
  if (typeof root !== "string" || root !== path.resolve(root) || root === "/") reject("RELEASE_ARTIFACT_ROOT_PATH_INVALID");
  if (await realpath(root) !== root) reject("RELEASE_ARTIFACT_ROOT_PATH_INVALID");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== 0 || rootStat.gid !== 0 || (rootStat.mode & 0o7777) !== ARTIFACT_ROOT_MODE) reject("RELEASE_ARTIFACT_ROOT_TRUST_INVALID");
  const marker = path.join(root, RELEASE_ARTIFACT_ROOT_MARKER);
  const { raw, stat: markerStat } = await readStableFile(marker, { minimumBytes: RELEASE_ARTIFACT_ROOT_MARKER_VALUE.length, maximumBytes: RELEASE_ARTIFACT_ROOT_MARKER_VALUE.length, code: "RELEASE_ARTIFACT_ROOT_MARKER_INVALID" });
  if (markerStat.uid !== 0 || markerStat.gid !== 0 || markerStat.nlink !== 1 || (markerStat.mode & 0o7777) !== ARTIFACT_FILE_MODE || raw.toString("utf8") !== RELEASE_ARTIFACT_ROOT_MARKER_VALUE) reject("RELEASE_ARTIFACT_ROOT_MARKER_INVALID");
  return root;
}

export async function readTrustedArtifactFile(root, filename, { minimumBytes = 1, maximumBytes = MAX_JSON_BYTES, code = "RELEASE_TRUSTED_ARTIFACT_INVALID" } = {}) {
  const safeRoot = await trustedArtifactRoot(path.resolve(root));
  artifactFilename(filename, code);
  const { raw, stat } = await readStableFile(path.join(safeRoot, filename), { minimumBytes, maximumBytes, code });
  if (stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o7777) !== ARTIFACT_FILE_MODE) reject(code);
  return { raw, stat, file: path.join(safeRoot, filename) };
}

async function readTrustedJsonArtifact(root, filename, expectedSha256, validator, code) {
  const { raw } = await readTrustedArtifactFile(root, filename, { minimumBytes: 2, maximumBytes: MAX_JSON_BYTES, code });
  if (expectedSha256 !== null && sha256(raw) !== expectedSha256) reject(`${code}_SHA256_MISMATCH`);
  const text = raw.toString("utf8");
  return { raw: text, value: validator(parseStrictJson(text)) };
}

async function readImageEvidenceJson(root, descriptor, validator, code) {
  const { raw } = await readTrustedArtifactFile(root, descriptor.file, { minimumBytes: 2, maximumBytes: MAX_SBOM_BYTES, code });
  if (sha256(raw) !== descriptor.sha256) reject(`${code}_SHA256_MISMATCH`);
  const value = parseStrictJson(raw.toString("utf8"), MAX_SBOM_BYTES);
  return { raw, value: validator(value) };
}

export async function verifyTrustedImageEvidence({ root, sbom, security, imageReferences = null, expectedProducer = null }) {
  validateSbomEvidence(sbom);
  validateSecurityEvidence(security);
  if (sbom.scope !== "WEB_AND_WORKER_IMAGES" || security.result !== "PASS") reject("IMAGE_EVIDENCE_NOT_PROMOTABLE");
  if (sbom.provenance_file !== security.provenance_file || sbom.provenance_sha256 !== security.provenance_sha256) reject("IMAGE_EVIDENCE_PROVENANCE_MISMATCH");
  const provenanceLoaded = await readTrustedJsonArtifact(root, sbom.provenance_file, sbom.provenance_sha256, validateImageScanProvenance, "IMAGE_EVIDENCE_PROVENANCE_INVALID");
  const provenance = provenanceLoaded.value;
  if (!candidateMatches(provenance.candidate, sbom.candidate) || !candidateMatches(provenance.candidate, security.candidate) || provenance.generated_at !== sbom.generated_at || provenance.generated_at !== security.generated_at) reject("IMAGE_EVIDENCE_PROVENANCE_CANDIDATE_MISMATCH");
  if (provenance.scanner.version !== security.scanner_version || provenance.scanner.image_reference !== security.scanner_image_reference || provenance.scanner.binary_sha256 !== security.scanner_binary_sha256 || provenance.database.updated_at !== security.vulnerability_database_updated_at) reject("IMAGE_EVIDENCE_PROVENANCE_SECURITY_MISMATCH");
  if (expectedProducer?.supervisorBundleSha256 && provenance.producer.supervisor_bundle_sha256 !== expectedProducer.supervisorBundleSha256) reject("IMAGE_EVIDENCE_PRODUCER_MISMATCH");
  if (expectedProducer?.authorizationSha256 && provenance.producer.authorization_sha256 !== expectedProducer.authorizationSha256) reject("IMAGE_EVIDENCE_PRODUCER_MISMATCH");

  const companionNames = [sbom.provenance_file];
  const buildProvenance = await readImageEvidenceJson(root, provenance.build_provenance, (value) => validateCandidateBuildProvenance(value, { runId: provenance.run_id, candidate: provenance.candidate, imageReferences }), "IMAGE_EVIDENCE_BUILD_PROVENANCE_INVALID");
  const buildTargets = new Map(buildProvenance.value.targets.map((target) => [target.service, target]));
  companionNames.push(provenance.build_provenance.file);
  const scannerInspect = await readImageEvidenceJson(root, provenance.scanner.inspect, (value) => validateDockerImageInspect(value, { imageDigest: provenance.scanner.local_identity_digest, imageReference: provenance.scanner.image_reference }), "IMAGE_EVIDENCE_SCANNER_INSPECT_INVALID");
  const scannerVersion = await readImageEvidenceJson(root, provenance.scanner.version_report, (value) => validateTrivyVersionReport(value), "IMAGE_EVIDENCE_SCANNER_VERSION_INVALID");
  const databaseMetadata = await readImageEvidenceJson(root, provenance.database.metadata, (value) => validateTrivyDatabaseMetadata(value, { schemaVersion: provenance.database.schema_version, updatedAt: provenance.database.updated_at, downloadedAt: provenance.database.downloaded_at, nextUpdate: provenance.database.next_update }), "IMAGE_EVIDENCE_DATABASE_METADATA_INVALID");
  void scannerInspect; void scannerVersion; void databaseMetadata;
  companionNames.push(provenance.scanner.inspect.file, provenance.scanner.version_report.file, provenance.database.metadata.file);

  const sbomByService = new Map(sbom.documents.map((document) => [document.service, document]));
  const targetCounts = new Map();
  const total = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const target of provenance.targets) {
    if (imageReferences && target.image_reference !== imageReferences[target.service]) reject("IMAGE_EVIDENCE_TARGET_REFERENCE_MISMATCH");
    const buildTarget = buildTargets.get(target.service);
    if (!buildTarget || buildTarget.image_reference !== target.image_reference || buildTarget.registry_manifest_digest !== target.registry_manifest_digest || buildTarget.image_config_digest !== target.image_config_digest) reject("IMAGE_EVIDENCE_BUILD_TARGET_MISMATCH");
    const expectedDocument = sbomByService.get(target.service);
    if (!expectedDocument || expectedDocument.file !== target.native_cyclonedx.file || expectedDocument.sha256 !== target.native_cyclonedx.sha256) reject("IMAGE_EVIDENCE_SBOM_TARGET_MISMATCH");
    await readImageEvidenceJson(root, target.inspect, (value) => validateDockerImageInspect(value, { imageDigest: target.registry_manifest_digest, imageReference: target.image_reference }), "IMAGE_EVIDENCE_TARGET_INSPECT_INVALID");
    const vulnerability = await readImageEvidenceJson(root, target.native_vulnerability, (value) => value, "IMAGE_EVIDENCE_NATIVE_VULNERABILITY_INVALID");
    const counts = validateTrivyNativeVulnerabilityReport(vulnerability.value, { imageConfigDigest: target.image_config_digest, imageReference: target.image_reference });
    await readImageEvidenceJson(root, target.native_cyclonedx, (value) => validateTrivyCycloneDxDocument(value, { imageConfigDigest: target.image_config_digest, imageReference: target.image_reference }), "IMAGE_EVIDENCE_NATIVE_CYCLONEDX_INVALID");
    targetCounts.set(target.service, counts);
    for (const key of Object.keys(total)) total[key] += counts[key];
    companionNames.push(target.inspect.file, target.native_vulnerability.file, target.native_cyclonedx.file);
  }
  if (canonicalJson(total) !== canonicalJson(security.counts)) reject("IMAGE_EVIDENCE_NATIVE_COUNTS_MISMATCH");
  if (new Set(companionNames).size !== companionNames.length) reject("IMAGE_EVIDENCE_ARTIFACT_NAME_COLLISION");
  return { provenance, targetCounts, total, companionNames };
}

export async function verifyTrustedReleaseBundle({ root, manifest, now = new Date() }) {
  validateReleaseManifest(manifest, { now, requireEligible: false });
  const names = [manifest.gate.plan_file, manifest.gate.report_file, manifest.evidence.sbom_file, manifest.evidence.security_file];
  if (new Set(names).size !== names.length || names.includes("release-manifest.json")) reject("RELEASE_BUNDLE_ARTIFACT_NAME_COLLISION");
  const planLoaded = await readTrustedJsonArtifact(root, manifest.gate.plan_file, manifest.gate.plan_sha256, validateOfficialReleaseGatePlan, "RELEASE_BUNDLE_PLAN_INVALID");
  const reportLoaded = await readTrustedJsonArtifact(root, manifest.gate.report_file, manifest.gate.report_sha256, validateReleaseGateReport, "RELEASE_BUNDLE_REPORT_INVALID");
  const sbomLoaded = await readTrustedJsonArtifact(root, manifest.evidence.sbom_file, manifest.evidence.sbom_sha256, validateSbomEvidence, "RELEASE_BUNDLE_SBOM_INVALID");
  const securityLoaded = await readTrustedJsonArtifact(root, manifest.evidence.security_file, manifest.evidence.security_sha256, validateSecurityEvidence, "RELEASE_BUNDLE_SECURITY_INVALID");
  const companionNames = [...names];
  let nativeImageEvidence = null;
  if (sbomLoaded.value.scope === "WEB_AND_WORKER_IMAGES") {
    nativeImageEvidence = await verifyTrustedImageEvidence({ root, sbom: sbomLoaded.value, security: securityLoaded.value, imageReferences: { web: manifest.images.web.image_reference, worker: manifest.images.worker.image_reference }, expectedProducer: { supervisorBundleSha256: manifest.control.supervisor_bundle_sha256, authorizationSha256: manifest.control.image_evidence_authorization_sha256 } });
    companionNames.push(...nativeImageEvidence.companionNames);
  } else {
    const descriptor = sbomLoaded.value.documents[0];
    companionNames.push(descriptor.file);
    const { raw: documentRaw } = await readTrustedArtifactFile(root, descriptor.file, { minimumBytes: 2, maximumBytes: MAX_SBOM_BYTES, code: "RELEASE_BUNDLE_SBOM_DOCUMENT_INVALID" });
    if (sha256(documentRaw) !== descriptor.sha256) reject("RELEASE_BUNDLE_SBOM_DOCUMENT_SHA256_MISMATCH");
    validateSourceLockfileSbomDocument(parseStrictJson(documentRaw.toString("utf8"), MAX_SBOM_BYTES), sbomLoaded.value);
  }
  if (securityLoaded.value.result === "PASS") {
    companionNames.push(securityLoaded.value.raw_report_file);
    const { raw: securityReportRaw } = await readTrustedArtifactFile(root, securityLoaded.value.raw_report_file, { minimumBytes: 2, maximumBytes: MAX_SBOM_BYTES, code: "RELEASE_BUNDLE_SECURITY_REPORT_INVALID" });
    if (sha256(securityReportRaw) !== securityLoaded.value.raw_report_sha256) reject("RELEASE_BUNDLE_SECURITY_REPORT_SHA256_MISMATCH");
    const normalizedReport = validateSecurityScanReport(parseStrictJson(securityReportRaw.toString("utf8"), MAX_SBOM_BYTES), securityLoaded.value);
    if (!nativeImageEvidence || normalizedReport.targets.some((target) => canonicalJson(target.counts) !== canonicalJson(nativeImageEvidence.targetCounts.get(target.service)))) reject("RELEASE_BUNDLE_SECURITY_NATIVE_COUNTS_MISMATCH");
  }
  if (new Set(companionNames).size !== companionNames.length || companionNames.includes("release-manifest.json")) reject("RELEASE_BUNDLE_ARTIFACT_NAME_COLLISION");
  const rebuilt = assembleReleaseManifest({
    releaseId: manifest.release_id, generatedAt: manifest.generated_at, expiresAt: manifest.expires_at, deploymentClass: manifest.allowed_deployment_classes[0],
    source: manifest.source, images: manifest.images, migrations: manifest.migrations.entries,
    planFile: manifest.gate.plan_file, planRaw: planLoaded.raw, plan: planLoaded.value,
    reportFile: manifest.gate.report_file, reportRaw: reportLoaded.raw, report: reportLoaded.value,
    sbomFile: manifest.evidence.sbom_file, sbomRaw: sbomLoaded.raw, sbom: sbomLoaded.value,
    securityFile: manifest.evidence.security_file, securityRaw: securityLoaded.raw, security: securityLoaded.value,
    control: manifest.control,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(manifest)) reject("RELEASE_BUNDLE_MANIFEST_REASSEMBLY_MISMATCH");
  return { manifest, plan: planLoaded.value, report: reportLoaded.value, sbom: sbomLoaded.value, security: securityLoaded.value };
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function optionalLstat(filename) {
  try { return await lstat(filename); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sameInode(left, right) {
  return left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;
}

function publicationTemporaryPrefix(filename) {
  return `${filename.startsWith(".") ? "" : "."}${filename}.`;
}

async function recoverRandomLinkedPublication({ root, filename, target }) {
  const targetStat = await optionalLstat(target);
  if (targetStat === null || targetStat.nlink === 1) return false;
  if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.uid !== 0 || targetStat.gid !== 0 || targetStat.nlink !== 2 || (targetStat.mode & 0o7777) !== ARTIFACT_FILE_MODE) reject("RELEASE_ARTIFACT_PUBLICATION_RECOVERY_INVALID");
  const prefix = publicationTemporaryPrefix(filename);
  const suffix = ".publish.tmp";
  const matches = [];
  for (const name of await readdir(root)) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const candidate = path.join(root, name);
    const candidateStat = await optionalLstat(candidate);
    if (sameInode(candidateStat, targetStat)) matches.push(candidate);
  }
  if (matches.length !== 1) reject("RELEASE_ARTIFACT_PUBLICATION_RECOVERY_INVALID");
  await syncDirectory(root);
  await unlink(matches[0]);
  await syncDirectory(root);
  return true;
}

async function recoverLinkedPublication({ source, target, root }) {
  const [sourceStat, targetStat] = await Promise.all([optionalLstat(source), optionalLstat(target)]);
  if (!sameInode(sourceStat, targetStat)) return false;
  await syncDirectory(root);
  try { await unlink(source); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  await syncDirectory(root);
  return true;
}

async function linkNoReplace({ source, target, root, existsCode }) {
  try { await link(source, target); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (await recoverLinkedPublication({ source, target, root })) return;
    reject(existsCode);
  }
  await syncDirectory(root);
  try { await unlink(source); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  await syncDirectory(root);
}

async function assertPublishedArtifact(pathname, code) {
  const published = await lstat(pathname);
  if (!published.isFile() || published.isSymbolicLink() || published.uid !== 0 || published.gid !== 0 || published.nlink !== 1 || (published.mode & 0o7777) !== ARTIFACT_FILE_MODE) reject(code);
}

export async function writeImmutableJsonArtifact({ root, filename, value }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_ARTIFACT_ROOT_REQUIRED");
  const safeRoot = await trustedArtifactRoot(root);
  if (typeof filename !== "string" || path.basename(filename) !== filename || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/.test(filename)) reject("RELEASE_ARTIFACT_FILENAME_INVALID");
  const target = path.join(safeRoot, filename);
  const temporary = path.join(safeRoot, `${publicationTemporaryPrefix(filename)}${process.pid}.${randomUUID()}.publish.tmp`);
  let handle;
  let ownsTemporary = false;
  try {
    if (await optionalLstat(target)) {
      await recoverRandomLinkedPublication({ root: safeRoot, filename, target });
      reject("EEXIST");
    }
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
    ownsTemporary = true;
    await handle.writeFile(canonicalJson(value), "utf8");
    await handle.chown(0, 0);
    await handle.chmod(ARTIFACT_FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await linkNoReplace({ source: temporary, target, root: safeRoot, existsCode: "EEXIST" });
    await assertPublishedArtifact(target, "RELEASE_ARTIFACT_PUBLICATION_INVALID");
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (ownsTemporary) await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return target;
}

export async function readPreparedJsonArtifact({ root, filename, expectedSha256, validator, code = "RELEASE_PREPARED_ARTIFACT_INVALID" }) {
  const safeRoot = await trustedArtifactRoot(root);
  preparedArtifactFilename(filename, code);
  string(expectedSha256, SHA256, `${code}_SHA256_INVALID`);
  const { raw, stat } = await readStableFile(path.join(safeRoot, filename), { minimumBytes: 2, maximumBytes: MAX_JSON_BYTES, code });
  if (stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o7777) !== ARTIFACT_FILE_MODE) reject(code);
  if (sha256(raw) !== expectedSha256) reject(`${code}_SHA256_MISMATCH`);
  const value = validator(parseStrictJson(raw.toString("utf8")));
  return { safeRoot, value };
}

export async function writePreparedJsonArtifact({ root, filename, value }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_ARTIFACT_ROOT_REQUIRED");
  const safeRoot = await trustedArtifactRoot(root);
  preparedArtifactFilename(filename, "RELEASE_PREPARED_ARTIFACT_FILENAME_INVALID");
  const target = path.join(safeRoot, filename);
  const temporary = path.join(safeRoot, `${publicationTemporaryPrefix(filename)}${process.pid}.${randomUUID()}.publish.tmp`);
  let handle;
  let ownsTemporary = false;
  try {
    if (await optionalLstat(target)) {
      await recoverRandomLinkedPublication({ root: safeRoot, filename, target });
      reject("RELEASE_PREPARED_ARTIFACT_EXISTS");
    }
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
    ownsTemporary = true;
    await handle.writeFile(canonicalJson(value), "utf8");
    await handle.chown(0, 0);
    await handle.chmod(ARTIFACT_FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await linkNoReplace({ source: temporary, target, root: safeRoot, existsCode: "RELEASE_PREPARED_ARTIFACT_EXISTS" });
    await assertPublishedArtifact(target, "RELEASE_PREPARED_ARTIFACT_PUBLICATION_INVALID");
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (ownsTemporary) await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return target;
}

export async function publishPreparedJsonArtifact({ root, preparedFilename, expectedSha256, filename, validator }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_ARTIFACT_ROOT_REQUIRED");
  if (typeof validator !== "function") reject("RELEASE_PREPARED_ARTIFACT_VALIDATOR_INVALID");
  const safeRoot = await trustedArtifactRoot(root);
  preparedArtifactFilename(preparedFilename, "RELEASE_PREPARED_ARTIFACT_FILENAME_INVALID");
  string(expectedSha256, SHA256, "RELEASE_PREPARED_ARTIFACT_INVALID_SHA256_INVALID");
  artifactFilename(filename, "RELEASE_ARTIFACT_FILENAME_INVALID");
  const prepared = path.join(safeRoot, preparedFilename);
  const target = path.join(safeRoot, filename);
  const recovered = await recoverLinkedPublication({ source: prepared, target, root: safeRoot });
  const targetStat = await optionalLstat(target);
  if (targetStat !== null) {
    if (!recovered) reject("RELEASE_ARTIFACT_ALREADY_EXISTS");
    const { raw, stat } = await readStableFile(target, { minimumBytes: 2, maximumBytes: MAX_JSON_BYTES, code: "RELEASE_PREPARED_ARTIFACT_INVALID" });
    if (stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o7777) !== ARTIFACT_FILE_MODE) reject("RELEASE_PREPARED_ARTIFACT_INVALID");
    if (sha256(raw) !== expectedSha256) reject("RELEASE_PREPARED_ARTIFACT_INVALID_SHA256_MISMATCH");
    return { file: target, value: validator(parseStrictJson(raw.toString("utf8"))) };
  }
  const { value } = await readPreparedJsonArtifact({ root: safeRoot, filename: preparedFilename, expectedSha256, validator });
  await linkNoReplace({ source: prepared, target, root: safeRoot, existsCode: "RELEASE_ARTIFACT_ALREADY_EXISTS" });
  await assertPublishedArtifact(target, "RELEASE_ARTIFACT_PUBLICATION_INVALID");
  return { file: target, value };
}

export async function discardPreparedJsonArtifact({ root, preparedFilename, expectedSha256, validator }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_ARTIFACT_ROOT_REQUIRED");
  if (typeof validator !== "function") reject("RELEASE_PREPARED_ARTIFACT_VALIDATOR_INVALID");
  const { safeRoot } = await readPreparedJsonArtifact({ root, filename: preparedFilename, expectedSha256, validator });
  await unlink(path.join(safeRoot, preparedFilename));
  await syncDirectory(safeRoot);
}

export async function readRecoverableJsonPublication({ root, preparedFilename, filename, validator, code = "RELEASE_JSON_PUBLICATION_INVALID" }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_ARTIFACT_ROOT_REQUIRED");
  if (typeof validator !== "function") reject(`${code}_VALIDATOR_INVALID`);
  const safeRoot = await trustedArtifactRoot(root);
  preparedArtifactFilename(preparedFilename, `${code}_PREPARED_FILENAME_INVALID`);
  artifactFilename(filename, `${code}_FILENAME_INVALID`);
  const prepared = path.join(safeRoot, preparedFilename);
  const published = path.join(safeRoot, filename);

  // A crash may leave either the random publish temporary linked to its target,
  // or the prepared and published names linked to the same inode. Reconcile only
  // those exact root-owned link shapes; two different payloads always fail closed.
  await recoverLinkedPublication({ source: prepared, target: published, root: safeRoot });
  await recoverRandomLinkedPublication({ root: safeRoot, filename: preparedFilename, target: prepared });
  await recoverRandomLinkedPublication({ root: safeRoot, filename, target: published });
  const [preparedStat, publishedStat] = await Promise.all([optionalLstat(prepared), optionalLstat(published)]);
  if (preparedStat !== null && publishedStat !== null) reject(`${code}_COLLISION`);
  if (preparedStat === null && publishedStat === null) return null;
  const state = publishedStat === null ? "PREPARED" : "PUBLISHED";
  const target = state === "PUBLISHED" ? published : prepared;
  const { raw, stat } = await readStableFile(target, { minimumBytes: 2, maximumBytes: MAX_JSON_BYTES, code });
  if (stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o7777) !== ARTIFACT_FILE_MODE) reject(code);
  return { safeRoot, state, sha256: sha256(raw), value: validator(parseStrictJson(raw.toString("utf8"))) };
}

function candidateMatches(left, right) {
  return ["git_commit", "git_tree", "package_version", "web_image_digest", "worker_image_digest", "migration_allowlist_sha256"].every((key) => left[key] === right[key]);
}

function assertReleaseEvidenceFreshness({ generatedAt, expiresAt, report, sbom, security }) {
  const generated = Date.parse(generatedAt); const expires = Date.parse(expiresAt);
  const reportCompleted = Date.parse(report.completed_at); const sbomGenerated = Date.parse(sbom.generated_at); const securityGenerated = Date.parse(security.generated_at);
  for (const value of [generated, expires, reportCompleted, sbomGenerated, securityGenerated]) if (!Number.isFinite(value)) reject("RELEASE_EVIDENCE_TIME_INVALID");
  if (reportCompleted > generated + RELEASE_MAX_CLOCK_SKEW_MS || generated - reportCompleted > RELEASE_MAX_GATE_REPORT_AGE_MS) reject("RELEASE_GATE_REPORT_STALE");
  if (sbomGenerated > generated + RELEASE_MAX_CLOCK_SKEW_MS || generated - sbomGenerated > RELEASE_MAX_SBOM_EVIDENCE_AGE_MS) reject("RELEASE_SBOM_EVIDENCE_STALE");
  if (securityGenerated > generated + RELEASE_MAX_CLOCK_SKEW_MS || generated - securityGenerated > RELEASE_MAX_SECURITY_EVIDENCE_AGE_MS) reject("RELEASE_SECURITY_EVIDENCE_STALE");
  const limits = [generated + 7 * 24 * 60 * 60 * 1000, reportCompleted + RELEASE_MAX_GATE_REPORT_AGE_MS, sbomGenerated + RELEASE_MAX_SBOM_EVIDENCE_AGE_MS, securityGenerated + RELEASE_MAX_SECURITY_EVIDENCE_AGE_MS];
  if (security.result === "PASS") {
    const databaseUpdated = Date.parse(security.vulnerability_database_updated_at);
    if (!Number.isFinite(databaseUpdated) || databaseUpdated > generated + RELEASE_MAX_CLOCK_SKEW_MS || generated - databaseUpdated > RELEASE_MAX_SECURITY_DATABASE_AGE_MS) reject("RELEASE_VULNERABILITY_DATABASE_STALE");
    limits.push(databaseUpdated + RELEASE_MAX_SECURITY_DATABASE_AGE_MS);
  }
  if (expires > Math.min(...limits)) reject("RELEASE_EXPIRY_EXCEEDS_EVIDENCE");
}

export function assembleReleaseManifest({ releaseId, generatedAt, expiresAt, deploymentClass, source, images, migrations, planFile, planRaw, plan, reportFile, reportRaw, report, sbomFile, sbomRaw, sbom, securityFile, securityRaw, security, control }) {
  validateOfficialReleaseGatePlan(plan);
  validateReleaseGateReport(report);
  validateSbomEvidence(sbom);
  validateSecurityEvidence(security);
  validateManifestControl(control, sbom.scope === "WEB_AND_WORKER_IMAGES" && security.result === "PASS" && report.result === "PASS");
  if (canonicalJson(report.runtime_guard) !== canonicalJson(plan.runtime_guard)) reject("RELEASE_GATE_RUNTIME_GUARD_MISMATCH");
  const candidate = {
    git_commit: source.git_commit,
    git_tree: source.git_tree,
    package_version: source.package_version,
    web_image_digest: images.web.image_digest,
    worker_image_digest: images.worker.image_digest,
    migration_allowlist_sha256: migrationAllowlistDigest(migrations),
  };
  validateCandidate(candidate);
  if (report.plan_id !== plan.plan_id || report.plan_sha256 !== sha256(planRaw) || report.steps.length !== plan.steps.length || report.steps.some((step, index) => step.id !== plan.steps[index].id || step.ordinal !== plan.steps[index].ordinal)) reject("RELEASE_GATE_PLAN_REPORT_MISMATCH");
  if (report.control.supervisor_bundle_sha256 !== control.supervisor_bundle_sha256 || report.control.authorization_sha256 !== control.release_gate_authorization_sha256) reject("RELEASE_CONTROL_GATE_MISMATCH");
  for (let index = 0; index < plan.steps.length; index += 1) {
    const planned = plan.steps[index]; const actual = report.steps[index];
    if (planned.applicability === "REQUIRED" && actual.result === "NOT_APPLICABLE") reject("RELEASE_GATE_REQUIRED_STEP_SKIPPED");
    if (planned.applicability === "NOT_APPLICABLE" && (actual.result !== "NOT_APPLICABLE" || actual.reason !== planned.reason)) reject("RELEASE_GATE_APPLICABILITY_MISMATCH");
  }
  if (report.result === "PASS") {
    const policy = plan.resource_policy; const resources = report.resources;
    if (resources.minimum_available_memory_mib < policy.min_available_memory_mib || resources.maximum_swap_used_percent > policy.max_swap_used_percent || resources.maximum_swap_growth_mib_60s > policy.max_swap_growth_mib_60s || resources.minimum_root_free_gib < policy.min_root_free_gib || resources.maximum_load_1m > policy.max_load_1m || resources.maximum_temporary_containers > policy.max_temporary_containers || resources.residual_container_ids.length !== 0) reject("RELEASE_GATE_RESOURCE_POLICY_BREACH");
  }
  if (!candidateMatches(report.candidate, candidate) || !candidateMatches(sbom.candidate, candidate) || !candidateMatches(security.candidate, candidate)) reject("RELEASE_EVIDENCE_CANDIDATE_MISMATCH");
  if (security.sbom_evidence_sha256 !== sha256(sbomRaw)) reject("RELEASE_SECURITY_SBOM_MISMATCH");
  if (report.evidence.sbom_sha256 !== sha256(sbomRaw) || report.evidence.sbom_scope !== sbom.scope || report.evidence.security_sha256 !== sha256(securityRaw) || report.evidence.security_result !== security.result) reject("RELEASE_GATE_EVIDENCE_MISMATCH");
  assertReleaseEvidenceFreshness({ generatedAt, expiresAt, report, sbom, security });
  const promotionStatus = report.result === "PASS" && sbom.scope === "WEB_AND_WORKER_IMAGES" && security.result === "PASS" ? "ELIGIBLE" : "BLOCKED";
  return validateReleaseManifest({
    schema_version: 2,
    contract: RELEASE_MANIFEST_CONTRACT,
    release_id: releaseId,
    generated_at: generatedAt,
    expires_at: expiresAt,
    promotion_status: promotionStatus,
    lifecycle: officialReleaseLifecycle(),
    control,
    source,
    images,
    migrations: { directory: "chenyida_erp_site/drizzle-postgres", head: migrations.at(-1).filename, allowlist_sha256: migrationAllowlistDigest(migrations), entries: migrations },
    gate: { plan_id: plan.plan_id, plan_file: planFile, plan_sha256: sha256(planRaw), report_file: reportFile, report_sha256: sha256(reportRaw), runtime_guard_mode: report.runtime_guard.mode, result: report.result },
    evidence: { sbom_file: sbomFile, sbom_sha256: sha256(sbomRaw), sbom_scope: sbom.scope, security_file: securityFile, security_sha256: sha256(securityRaw), security_result: security.result },
    allowed_deployment_classes: [deploymentClass],
  });
}

function cliOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(result, key)) reject("RELEASE_CLI_ARGUMENT_INVALID");
    result[key] = value;
  }
  return result;
}

function gitOutput(repositoryRoot, args, { encoding = null, code = "RELEASE_GIT_READ_FAILED" } = {}) {
  const result = spawnSync("/usr/bin/git", ["-c", `safe.directory=${repositoryRoot}`, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", repositoryRoot, ...args], { encoding, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0) reject(code);
  return result.stdout;
}

function gitBlob(repositoryRoot, commit, repositoryPath) {
  safePath(repositoryPath, "RELEASE_GIT_PATH_INVALID");
  return gitOutput(repositoryRoot, ["show", `${commit}:${repositoryPath}`], { code: "RELEASE_GIT_BLOB_READ_FAILED" });
}

function buildGitMigrationAllowlist(repositoryRoot, commit) {
  const directory = "chenyida_erp_site/drizzle-postgres";
  const listed = gitOutput(repositoryRoot, ["ls-tree", "-r", "--name-only", commit, "--", directory], { encoding: "utf8", code: "RELEASE_GIT_MIGRATION_LIST_FAILED" });
  const names = listed.trim().split("\n").filter((name) => name.endsWith(".sql")).map((name) => path.basename(name)).sort();
  const entries = names.map((filename, index) => {
    const repositoryPath = `${directory}/${filename}`;
    const raw = gitBlob(repositoryRoot, commit, repositoryPath);
    if (raw.length < 1 || raw.length > MAX_MIGRATION_BYTES) reject("MIGRATION_FILE_INVALID");
    return { ordinal: index + 1, filename, sha256: sha256(raw) };
  });
  return validateMigrationAllowlist(entries);
}

async function assembleCli(options) {
  const expected = ["--artifact-root", "--output", "--release-id", "--generated-at", "--expires-at", "--deployment-class", "--repository-root", "--git-commit", "--git-tree", "--web-image-reference", "--web-image-digest", "--web-oci-version", "--web-oci-revision", "--web-baked-version", "--web-baked-revision", "--worker-image-reference", "--worker-image-digest", "--worker-oci-version", "--worker-oci-revision", "--worker-baked-version", "--worker-baked-revision", "--gate-plan", "--gate-report", "--sbom-evidence", "--security-evidence", "--confirm"];
  exactKeys(options, expected, "RELEASE_CLI_ARGUMENT_INVALID");
  if (options["--confirm"] !== "CREATE_IMMUTABLE_RELEASE_MANIFEST") reject("RELEASE_CLI_CONFIRMATION_INVALID");
  const repositoryRoot = path.resolve(options["--repository-root"]);
  if (await realpath(repositoryRoot) !== repositoryRoot) reject("RELEASE_REPOSITORY_ROOT_INVALID");
  const gitCommit = string(options["--git-commit"], COMMIT, "RELEASE_SOURCE_COMMIT_INVALID");
  const gitTree = string(options["--git-tree"], COMMIT, "RELEASE_SOURCE_TREE_INVALID");
  if (gitOutput(repositoryRoot, ["rev-parse", "--verify", `${gitCommit}^{commit}`], { encoding: "utf8" }).trim() !== gitCommit) reject("RELEASE_SOURCE_COMMIT_MISMATCH");
  if (gitOutput(repositoryRoot, ["rev-parse", "--verify", `${gitCommit}^{tree}`], { encoding: "utf8" }).trim() !== gitTree) reject("RELEASE_SOURCE_TREE_MISMATCH");
  const packageRaw = gitBlob(repositoryRoot, gitCommit, "chenyida_erp_site/package.json");
  const dockerfileRaw = gitBlob(repositoryRoot, gitCommit, "chenyida_erp_site/Dockerfile");
  const composeRaw = gitBlob(repositoryRoot, gitCommit, "chenyida_erp_site/compose.yml");
  const releaseComposeRaw = gitBlob(repositoryRoot, gitCommit, "chenyida_erp_site/compose.release.yml");
  const packageValue = JSON.parse(packageRaw.toString("utf8"));
  const source = {
    git_commit: gitCommit, git_tree: gitTree, worktree_clean: true,
    package_path: "chenyida_erp_site/package.json", package_version: packageValue.version, package_sha256: sha256(packageRaw),
    dockerfile_path: "chenyida_erp_site/Dockerfile", dockerfile_sha256: sha256(dockerfileRaw),
    compose_path: "chenyida_erp_site/compose.yml", compose_sha256: sha256(composeRaw),
    release_compose_path: "chenyida_erp_site/compose.release.yml", release_compose_sha256: sha256(releaseComposeRaw),
  };
  const image = (service) => ({
    service,
    image_reference: options[`--${service}-image-reference`], image_digest: options[`--${service}-image-digest`],
    oci_version: options[`--${service}-oci-version`], oci_revision: options[`--${service}-oci-revision`],
    baked_version: options[`--${service}-baked-version`], baked_revision: options[`--${service}-baked-revision`],
  });
  const images = { web: image("web"), worker: image("worker") };
  const migrations = buildGitMigrationAllowlist(repositoryRoot, gitCommit);
  const artifactRoot = await trustedArtifactRoot(path.resolve(options["--artifact-root"]));
  const evidenceName = (option, code) => {
    const absolute = path.resolve(options[option]);
    if (path.dirname(absolute) !== artifactRoot) reject(code);
    return artifactFilename(path.basename(absolute), code);
  };
  const planName = evidenceName("--gate-plan", "RELEASE_PLAN_OUTSIDE_ARTIFACT_ROOT");
  const reportName = evidenceName("--gate-report", "RELEASE_REPORT_OUTSIDE_ARTIFACT_ROOT");
  const sbomName = evidenceName("--sbom-evidence", "RELEASE_SBOM_OUTSIDE_ARTIFACT_ROOT");
  const securityName = evidenceName("--security-evidence", "RELEASE_SECURITY_OUTSIDE_ARTIFACT_ROOT");
  const planEvidence = await readTrustedJsonArtifact(artifactRoot, planName, null, validateOfficialReleaseGatePlan, "RELEASE_PLAN_ARTIFACT_INVALID");
  const committedPlan = validateOfficialReleaseGatePlan(parseStrictJson(gitBlob(repositoryRoot, gitCommit, RELEASE_GATE_PLAN_REPOSITORY_PATH).toString("utf8")));
  if (canonicalJson(committedPlan) !== canonicalJson(planEvidence.value)) reject("RELEASE_PLAN_NOT_COMMITTED_CANDIDATE");
  const policyRaw = gitBlob(repositoryRoot, gitCommit, "chenyida_erp_site/release/vulnerability-policy-v1.json").toString("utf8");
  validateOfficialVulnerabilityPolicy(parseStrictJson(policyRaw), policyRaw);
  const testRuntimePolicyRaw = gitBlob(repositoryRoot, gitCommit, "chenyida_erp_site/release/test-runtime-policy-v1.json").toString("utf8");
  validateOfficialTestRuntimePolicy(parseStrictJson(testRuntimePolicyRaw), testRuntimePolicyRaw);
  const reportEvidence = await readTrustedJsonArtifact(artifactRoot, reportName, null, validateReleaseGateReport, "RELEASE_REPORT_ARTIFACT_INVALID");
  const sbomEvidence = await readTrustedJsonArtifact(artifactRoot, sbomName, null, validateSbomEvidence, "RELEASE_SBOM_ARTIFACT_INVALID");
  const securityEvidence = await readTrustedJsonArtifact(artifactRoot, securityName, null, validateSecurityEvidence, "RELEASE_SECURITY_ARTIFACT_INVALID");
  const supervisorBundleSha256 = string(process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256, SHA256, "RELEASE_SUPERVISOR_BUNDLE_INVALID");
  const manifestAuthorizationSha256 = string(process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256, SHA256, "RELEASE_MANIFEST_AUTHORIZATION_INVALID");
  let imageEvidenceAuthorizationSha256 = null;
  if (sbomEvidence.value.scope === "WEB_AND_WORKER_IMAGES") {
    const nativeImageEvidence = await verifyTrustedImageEvidence({ root: artifactRoot, sbom: sbomEvidence.value, security: securityEvidence.value, imageReferences: { web: images.web.image_reference, worker: images.worker.image_reference } });
    if (nativeImageEvidence.provenance.producer.supervisor_bundle_sha256 !== supervisorBundleSha256) reject("RELEASE_CONTROL_SUPERVISOR_MISMATCH");
    imageEvidenceAuthorizationSha256 = nativeImageEvidence.provenance.producer.authorization_sha256;
  }
  if (reportEvidence.value.control.supervisor_bundle_sha256 !== supervisorBundleSha256) reject("RELEASE_CONTROL_SUPERVISOR_MISMATCH");
  const control = { supervisor_bundle_sha256: supervisorBundleSha256, image_evidence_authorization_sha256: imageEvidenceAuthorizationSha256, release_gate_authorization_sha256: reportEvidence.value.control.authorization_sha256, manifest_authorization_sha256: manifestAuthorizationSha256 };
  const manifest = assembleReleaseManifest({
    releaseId: options["--release-id"], generatedAt: options["--generated-at"], expiresAt: options["--expires-at"], deploymentClass: options["--deployment-class"], source, images, migrations,
    planFile: planName, planRaw: planEvidence.raw, plan: planEvidence.value,
    reportFile: reportName, reportRaw: reportEvidence.raw, report: reportEvidence.value,
    sbomFile: sbomName, sbomRaw: sbomEvidence.raw, sbom: sbomEvidence.value,
    securityFile: securityName, securityRaw: securityEvidence.raw, security: securityEvidence.value,
    control,
  });
  const output = options["--output"];
  const preparedName = `.release-manifest.${manifestAuthorizationSha256}.prepared.json`;
  if (path.dirname(path.resolve(output)) !== artifactRoot || path.basename(output) !== preparedName) reject("RELEASE_OUTPUT_OUTSIDE_ARTIFACT_ROOT");
  await verifyTrustedReleaseBundle({ root: artifactRoot, manifest, now: new Date(options["--generated-at"]) });
  await writePreparedJsonArtifact({ root: artifactRoot, filename: preparedName, value: manifest });
  process.stdout.write(`${JSON.stringify({ result: manifest.promotion_status, prepared_file: preparedName, manifest_sha256: sha256(canonicalJson(manifest)), migration_head: manifest.migrations.head })}\n`);
}

function requireManifestPublicationControl(options, confirmation) {
  exactKeys(options, ["--artifact-root", "--prepared", "--expected-sha256", "--confirm"], "RELEASE_CLI_ARGUMENT_INVALID");
  if (options["--confirm"] !== confirmation) reject("RELEASE_CLI_CONFIRMATION_INVALID");
  if (process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES") reject("RELEASE_GLOBAL_LOCK_NOT_HELD");
  if (process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES") reject("RELEASE_SUPERVISOR_REQUIRED");
  const supervisorBundleSha256 = string(process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256, SHA256, "RELEASE_SUPERVISOR_BUNDLE_INVALID");
  const authorizationSha256 = string(process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256, SHA256, "RELEASE_MANIFEST_AUTHORIZATION_INVALID");
  const artifactRoot = path.resolve(options["--artifact-root"]);
  const prepared = path.resolve(options["--prepared"]);
  const preparedName = `.release-manifest.${authorizationSha256}.prepared.json`;
  if (path.dirname(prepared) !== artifactRoot || path.basename(prepared) !== preparedName) reject("RELEASE_PREPARED_MANIFEST_PATH_INVALID");
  return { supervisorBundleSha256, authorizationSha256, artifactRoot, preparedName, expectedSha256: string(options["--expected-sha256"], SHA256, "RELEASE_PREPARED_MANIFEST_SHA256_INVALID") };
}

async function publishManifestCli(options) {
  const control = requireManifestPublicationControl(options, "PUBLISH_RELEASE_MANIFEST_AFTER_RECHECK");
  const loaded = await readPreparedJsonArtifact({ root: control.artifactRoot, filename: control.preparedName, expectedSha256: control.expectedSha256, validator: validateReleaseManifest, code: "RELEASE_PREPARED_MANIFEST_INVALID" });
  if (loaded.value.control.manifest_authorization_sha256 !== control.authorizationSha256 || loaded.value.control.supervisor_bundle_sha256 !== control.supervisorBundleSha256) reject("RELEASE_MANIFEST_AUTHORIZATION_MISMATCH");
  await verifyTrustedReleaseBundle({ root: control.artifactRoot, manifest: loaded.value, now: new Date() });
  await publishPreparedJsonArtifact({ root: control.artifactRoot, preparedFilename: control.preparedName, expectedSha256: control.expectedSha256, filename: "release-manifest.json", validator: validateReleaseManifest });
  process.stdout.write(`${JSON.stringify({ result: loaded.value.promotion_status, manifest_file: "release-manifest.json", manifest_sha256: control.expectedSha256, migration_head: loaded.value.migrations.head })}\n`);
}

async function discardManifestCli(options) {
  const control = requireManifestPublicationControl(options, "DISCARD_UNPUBLISHED_RELEASE_MANIFEST");
  const loaded = await readPreparedJsonArtifact({ root: control.artifactRoot, filename: control.preparedName, expectedSha256: control.expectedSha256, validator: validateReleaseManifest, code: "RELEASE_PREPARED_MANIFEST_INVALID" });
  if (loaded.value.control.manifest_authorization_sha256 !== control.authorizationSha256 || loaded.value.control.supervisor_bundle_sha256 !== control.supervisorBundleSha256) reject("RELEASE_MANIFEST_AUTHORIZATION_MISMATCH");
  await discardPreparedJsonArtifact({ root: control.artifactRoot, preparedFilename: control.preparedName, expectedSha256: control.expectedSha256, validator: validateReleaseManifest });
  process.stdout.write(`${JSON.stringify({ result: "DISCARDED", prepared_file: control.preparedName, manifest_sha256: control.expectedSha256 })}\n`);
}

async function verifyCli(options) {
  exactKeys(options, ["--manifest", "--expected-sha256", "--migrations", "--require-eligible"], "RELEASE_CLI_ARGUMENT_INVALID");
  const requireEligible = options["--require-eligible"] === "YES" ? true : options["--require-eligible"] === "NO" ? false : reject("RELEASE_CLI_ARGUMENT_INVALID");
  const manifest = await loadReleaseManifest({ file: options["--manifest"], expectedSha256: options["--expected-sha256"], requireEligible, trusted: requireEligible });
  await verifyMigrationFilesAgainstManifest(manifest, options["--migrations"]);
  process.stdout.write(`${JSON.stringify({ result: "VERIFIED", release_id: manifest.release_id, promotion_status: manifest.promotion_status, migration_head: manifest.migrations.head })}\n`);
}

async function offlineEvidenceCli(options) {
  exactKeys(options, ["--artifact-root", "--repository-root", "--release-id", "--git-commit", "--git-tree", "--package-version", "--web-image-digest", "--worker-image-digest", "--migration-allowlist-sha256", "--confirm"], "RELEASE_CLI_ARGUMENT_INVALID");
  if (options["--confirm"] !== "CREATE_BLOCKING_OFFLINE_EVIDENCE") reject("RELEASE_CLI_CONFIRMATION_INVALID");
  const candidate = validateCandidate({
    git_commit: options["--git-commit"], git_tree: options["--git-tree"], package_version: options["--package-version"],
    web_image_digest: options["--web-image-digest"], worker_image_digest: options["--worker-image-digest"], migration_allowlist_sha256: options["--migration-allowlist-sha256"],
  });
  const repositoryRoot = path.resolve(options["--repository-root"]);
  if (await realpath(repositoryRoot) !== repositoryRoot) reject("RELEASE_REPOSITORY_ROOT_INVALID");
  if (gitOutput(repositoryRoot, ["rev-parse", "--verify", `${candidate.git_commit}^{tree}`], { encoding: "utf8" }).trim() !== candidate.git_tree) reject("OFFLINE_SBOM_SOURCE_INVALID");
  const packageValue = JSON.parse(gitBlob(repositoryRoot, candidate.git_commit, "chenyida_erp_site/package.json").toString("utf8"));
  const lockValue = JSON.parse(gitBlob(repositoryRoot, candidate.git_commit, "chenyida_erp_site/package-lock.json").toString("utf8"));
  if (packageValue.version !== candidate.package_version || lockValue.name !== packageValue.name || lockValue.version !== packageValue.version || !lockValue.packages || typeof lockValue.packages !== "object" || Array.isArray(lockValue.packages)) reject("OFFLINE_SBOM_SOURCE_INVALID");
  const generatedAt = new Date().toISOString();
  const components = Object.entries(lockValue.packages).filter(([packagePath, metadata]) => packagePath.startsWith("node_modules/") && metadata && typeof metadata === "object" && typeof metadata.version === "string").map(([packagePath, metadata]) => ({
    type: "library", name: packagePath.slice("node_modules/".length), version: metadata.version,
    properties: [{ name: "chenyida:lockfile-path", value: packagePath }],
  })).sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const releaseId = string(options["--release-id"], IDENTIFIER, "RELEASE_ID_INVALID");
  const documentFile = `${releaseId}.source-lockfile.cdx.json`;
  const sbomFile = `${releaseId}.sbom-evidence.json`;
  const securityFile = `${releaseId}.security-evidence.json`;
  const document = {
    bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
    metadata: { timestamp: generatedAt, component: { type: "application", name: packageValue.name, version: packageValue.version }, properties: [{ name: "chenyida:evidence-scope", value: "SOURCE_LOCKFILE_NOT_IMAGE_CONTENT" }, { name: "chenyida:git-commit", value: candidate.git_commit }, { name: "chenyida:git-tree", value: candidate.git_tree }] },
    components,
  };
  const sbomPreview = { schema_version: 1, contract: RELEASE_SBOM_EVIDENCE_CONTRACT, generated_at: generatedAt, scope: "SOURCE_LOCKFILE", candidate, format: "CYCLONEDX_1_6_JSON", documents: [{ service: "source", file: documentFile, sha256: sha256(canonicalJson(document)) }], provenance_file: null, provenance_sha256: null, result: "VERIFIED" };
  validateSourceLockfileSbomDocument(document, sbomPreview);
  await writeImmutableJsonArtifact({ root: options["--artifact-root"], filename: documentFile, value: document });
  const sbom = validateSbomEvidence(sbomPreview);
  await writeImmutableJsonArtifact({ root: options["--artifact-root"], filename: sbomFile, value: sbom });
  const sbomRaw = canonicalJson(sbom);
  const security = validateSecurityEvidence({ schema_version: 1, contract: RELEASE_SECURITY_EVIDENCE_CONTRACT, generated_at: generatedAt, candidate, sbom_evidence_sha256: sha256(sbomRaw), provenance_file: null, provenance_sha256: null, scanner: "NONE", scanner_version: null, scanner_image_reference: null, scanner_binary_sha256: null, policy_id: null, policy_sha256: null, raw_report_file: null, raw_report_sha256: null, vulnerability_database_updated_at: null, counts: { critical: null, high: null, medium: null, low: null, unknown: null }, result: "NOT_EVALUATED", reason: "OFFLINE_LOCKFILE_INVENTORY_IS_NOT_A_LIVE_VULNERABILITY_ASSESSMENT" });
  await writeImmutableJsonArtifact({ root: options["--artifact-root"], filename: securityFile, value: security });
  process.stdout.write(`${JSON.stringify({ result: "BLOCKING_EVIDENCE_CREATED", sbom_file: sbomFile, sbom_sha256: sha256(sbomRaw), security_file: securityFile, security_sha256: sha256(canonicalJson(security)) })}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (command === "assemble") return assembleCli(options);
  if (command === "publish-manifest") return publishManifestCli(options);
  if (command === "discard-manifest") return discardManifestCli(options);
  if (command === "verify") return verifyCli(options);
  if (command === "offline-evidence") return offlineEvidenceCli(options);
  reject("RELEASE_CLI_COMMAND_INVALID");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof ReleaseManifestError ? error.code : "RELEASE_MANIFEST_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
