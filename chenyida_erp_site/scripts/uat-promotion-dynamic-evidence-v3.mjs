#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync,
} from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync, inflateRawSync } from "node:zlib";


const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(SCRIPT_ROOT, "..");
const REPOSITORY_ROOT = resolve(SITE_ROOT, "..");
const POLICY_PATH = resolve(
  SITE_ROOT, "operations/uat-promotion-dynamic-validation-policy-v3.json",
);
const ARTIFACT_PATH = resolve(
  SITE_ROOT, "operations/uat-promotion-dynamic-evidence-v3.json",
);
const EXPECTED_POLICY_SHA256 = "90188fadc024e62912c5c6cfc85e97f254757ee274aba1e8bb55bd2c6e951d12";
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const LABEL = /^[A-Z][A-Z0-9_]{1,79}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DOCKER_ISO_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const RUN_ID = /^dv70-[A-Za-z0-9_]{8}$/;
const OID = /^[1-9][0-9]{3,9}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const ZERO_SHA256 = "0".repeat(64);
const HANDLER_EVENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-handler-state-event/v1";
const SIDE_EFFECT_INTENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-side-effect-intent/v1";
const SIDE_EFFECT_RECEIPT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-side-effect-receipt/v2";
const SIDE_EFFECT_RECOVERY_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-side-effect-recovery-attempt/v1";
const FIXED_EXECUTION_RECEIPT_CONTRACT =
  "chenyida-erp-task70-v3-fixed-executor-psql-execution-receipt/v1";
const FIXED_EXECUTION_ENVIRONMENT = Object.freeze({
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent",
});
const HANDLER_EVENT_FIELDS = Object.freeze([
  "schema_version", "contract", "operation", "operation_id", "execution_mode",
  "label", "sequence", "event", "action", "idempotency_key", "request_sha256",
  "runtime_plan_sha256", "execution_package_sha256", "source_set_sha256",
  "transaction_intent_sha256", "context_sha256", "record_intent_sha256",
  "previous_result_sha256", "activation_receipt_sha256", "side_effect_name",
  "side_effect_identity_sha256", "payload", "payload_sha256",
  "previous_event_sha256", "recorded_at", "event_sha256",
]);
const SERVICES = Object.freeze(["caddy", "postgres", "web", "worker"]);
const PROTECTED_VOLUMES = Object.freeze([
  "chenyida-erp-parallel_erp_attachments",
  "chenyida-erp-parallel_erp_backup_status",
  "chenyida-erp-parallel_erp_postgres",
  "chenyida-erp-parallel_erp_uploads",
]);
const HISTORICAL_V2 = Object.freeze({
  policy: "fe9932e26535fbd9b25c41259143c73b82c20ad5157b3a65d47e86b1200cc6b8",
  artifact: "8e7b9c6576fe369f9264445947ece3cc94ac79832871311fa2e59296c3260f91",
  producer: "a62db066f68536068f413fc7ad929334620c885dfbd2d9ac9cc6c8228a3d22c3",
  verifier: "888e8da9c401eedfc46d18982fa065aa0c394dd617798377d4a91854421c6308",
  audit_test: "43de9dc9813fe4295b8f58169530e24585cf025cd6457e47a30706ec6f045b01",
});


export class DynamicEvidenceV3Error extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}


function reject(code) {
  throw new DynamicEvidenceV3Error(code);
}


function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]),
    );
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    reject("TASK70_V3_EVIDENCE_JSON_INVALID");
  }
  return value;
}


export function canonical(value) {
  return `${JSON.stringify(sortedValue(value))}\n`;
}


export function digestValue(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}


function digestCompactValue(value) {
  return createHash("sha256").update(
    JSON.stringify(sortedValue(value)), "utf8",
  ).digest("hex");
}


function same(left, right) {
  return canonical(left) === canonical(right);
}


function nonzeroSha(value, code) {
  if (!SHA256.test(value || "") || value === "0".repeat(64)) reject(code);
  return value;
}


function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) reject(code);
  return value;
}


function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) reject(code);
  return value;
}


function strictIso(value, code) {
  if (!ISO_UTC.test(value || "") || !Number.isFinite(Date.parse(value))) reject(code);
  return value;
}


function dockerIsoMilliseconds(value, code) {
  const parsed = Date.parse(value);
  if (!DOCKER_ISO_UTC.test(value || "") || !Number.isFinite(parsed)) reject(code);
  return parsed;
}


function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}


function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    reject(code);
  }
  return value;
}


function normalizeSql(raw, roots) {
  const code = "TASK70_V3_SQL_EVIDENCE_INVALID";
  let sql;
  try {
    sql = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    reject(code);
  }
  if (!sql.endsWith("\n") || sql.includes("\0") || sql.includes("{{DV70:")) reject(code);
  const labels = new Map();
  const collect = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => collect(child, `${path}[${index}]`));
    } else if (value && typeof value === "object") {
      Object.keys(value).sort().forEach((key) => collect(value[key], `${path}.${key}`));
    } else if (typeof value === "string" && SHA256.test(value)) {
      if (!labels.has(value)) labels.set(value, new Set());
      labels.get(value).add(path);
    }
  };
  collect(roots, "roots");
  const replacements = new Map();
  for (const [value, paths] of labels) {
    const label = value === ZERO_SHA256 ? "ZERO_SHA256"
      : value === EMPTY_SHA256 ? "EMPTY_SHA256" : [...paths].sort().join("|");
    replacements.set(value, `{{DV70:${label}}}`);
  }
  const special = new Map([
    [roots.base.postgres.system_identifier, "SYSTEM_IDENTIFIER"],
    [roots.base.databases.candidate_oid, "CANDIDATE_OID"],
    [roots.fixture.restored_oid, "RESTORED_OID"],
  ]);
  for (const [value, label] of special) {
    if (typeof value !== "string" || value.length === 0) reject(code);
    replacements.set(value, `{{DV70:${label}}}`);
  }
  for (const value of [...replacements.keys()].sort(
    (left, right) => right.length - left.length || compareUtf8(left, right),
  )) {
    sql = sql.split(value).join(replacements.get(value));
  }
  if (/[0-9a-f]{64}/.test(sql) || [...special.keys()].some((value) => sql.includes(value))) {
    reject(code);
  }
  return Buffer.from(sql, "utf8");
}


export function verifyCompressedSqlEvidence(value, roots, expectedNormalized, maximumBytes) {
  const code = "TASK70_V3_SQL_EVIDENCE_INVALID";
  exactKeys(value, [
    "encoding", "uncompressed_bytes", "uncompressed_sha256", "normalized_sha256",
    "gzip_bytes", "gzip_sha256", "gzip_base64", "sql_evidence_sha256",
  ], code);
  verifyDigestedObject(value, "sql_evidence_sha256", code);
  if (value.encoding !== "GZIP_BASE64_MTIME_ZERO"
      || !Number.isSafeInteger(value.gzip_bytes) || value.gzip_bytes < 1
      || value.gzip_bytes > maximumBytes
      || !Number.isSafeInteger(value.uncompressed_bytes) || value.uncompressed_bytes < 1
      || value.uncompressed_bytes > maximumBytes
      || typeof value.gzip_base64 !== "string" || value.gzip_base64.length < 4
      || value.gzip_base64.length > Math.ceil(maximumBytes / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.gzip_base64,
      )) reject(code);
  const compressed = Buffer.from(value.gzip_base64, "base64");
  if (compressed.toString("base64") !== value.gzip_base64
      || compressed.length !== value.gzip_bytes
      || digestBytes(compressed) !== value.gzip_sha256
      || compressed.length < 18
      || !compressed.subarray(0, 10).equals(Buffer.from([
        0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x03,
      ]))) reject(code);
  let raw;
  try {
    raw = gunzipSync(compressed, { maxOutputLength: maximumBytes });
    const singleMember = inflateRawSync(compressed.subarray(10, -8), {
      info: true, maxOutputLength: maximumBytes,
    });
    if (singleMember.engine.bytesWritten !== compressed.length - 18
        || !singleMember.buffer.equals(raw)) reject(code);
  } catch {
    reject(code);
  }
  const normalized = normalizeSql(raw, roots);
  if (raw.length !== value.uncompressed_bytes
      || digestBytes(raw) !== value.uncompressed_sha256
      || digestBytes(normalized) !== value.normalized_sha256
      || value.normalized_sha256 !== expectedNormalized) reject(code);
  return raw;
}


function regularFile(path, maximumBytes, code) {
  let metadata;
  let raw;
  try {
    metadata = lstatSync(path);
    raw = readFileSync(path);
  } catch {
    reject(code);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || raw.length < 2 || raw.length > maximumBytes || raw.includes(0)) {
    reject(code);
  }
  return raw;
}


export function readTrustedArtifactFile(
  path, maximumBytes, code = "TASK70_V3_ARTIFACT_INVALID",
) {
  let before;
  let opened;
  let after;
  let named;
  let raw;
  let descriptor;
  const valid = (metadata) => metadata?.isFile() && !metadata.isSymbolicLink()
    && metadata.uid === 0n && metadata.gid === 0n && metadata.nlink === 1n
    && (metadata.mode & 0o7777n) === 0o400n
    && metadata.size >= 2n && metadata.size <= BigInt(maximumBytes);
  const unchanged = (left, right) => [
    "dev", "ino", "size", "uid", "gid", "nlink", "mode", "mtimeNs", "ctimeNs",
  ].every((field) => left[field] === right[field]);
  try {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2) reject(code);
    before = lstatSync(path, { bigint: true });
    if (!valid(before)) reject(code);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    opened = fstatSync(descriptor, { bigint: true });
    if (!valid(opened) || !unchanged(before, opened)) reject(code);
    raw = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < raw.length) {
      const count = readSync(descriptor, raw, offset, raw.length - offset, null);
      if (!Number.isSafeInteger(count) || count < 1) reject(code);
      offset += count;
    }
    after = fstatSync(descriptor, { bigint: true });
    named = lstatSync(path, { bigint: true });
    if (!valid(after) || !valid(named) || !unchanged(opened, after)
        || !unchanged(opened, named)) reject(code);
  } catch {
    reject(code);
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { reject(code); }
    }
  }
  if (!raw || raw.length < 2 || raw.length > maximumBytes || raw.includes(0)) reject(code);
  return raw;
}


export function parseStrictJson(raw, code = "TASK70_V3_EVIDENCE_JSON_INVALID") {
  if (!Buffer.isBuffer(raw)) reject(code);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    reject(code);
  }
  let offset = 0;
  const whitespace = () => {
    while (offset < text.length && /[\x20\x09\x0a\x0d]/.test(text[offset])) offset += 1;
  };
  const string = () => {
    if (text[offset] !== '"') reject(code);
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        try {
          return JSON.parse(text.slice(start, offset));
        } catch {
          reject(code);
        }
      }
      if (character.charCodeAt(0) < 0x20) reject(code);
      if (character === "\\") {
        offset += 1;
        if (offset >= text.length || !/["\\/bfnrtu]/.test(text[offset])) reject(code);
        if (text[offset] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) reject(code);
          offset += 5;
        } else offset += 1;
      } else offset += 1;
    }
    reject(code);
  };
  const value = () => {
    whitespace();
    if (text[offset] === "{") {
      offset += 1;
      whitespace();
      const result = {};
      const keys = new Set();
      if (text[offset] === "}") {
        offset += 1;
        return result;
      }
      while (offset < text.length) {
        const key = string();
        if (keys.has(key)) reject(code);
        keys.add(key);
        whitespace();
        if (text[offset] !== ":") reject(code);
        offset += 1;
        result[key] = value();
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return result;
        }
        if (text[offset] !== ",") reject(code);
        offset += 1;
        whitespace();
      }
      reject(code);
    }
    if (text[offset] === "[") {
      offset += 1;
      whitespace();
      const result = [];
      if (text[offset] === "]") {
        offset += 1;
        return result;
      }
      while (offset < text.length) {
        result.push(value());
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return result;
        }
        if (text[offset] !== ",") reject(code);
        offset += 1;
      }
      reject(code);
    }
    if (text[offset] === '"') return string();
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return parsed;
      }
    }
    const matched = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(offset));
    if (!matched || matched[0] === "-0") reject(code);
    offset += matched[0].length;
    const parsed = Number(matched[0]);
    if (!Number.isSafeInteger(parsed)) reject(code);
    return parsed;
  };
  const result = value();
  whitespace();
  if (offset !== text.length) reject(code);
  return result;
}


function jsonFile(path, maximumBytes, code) {
  const raw = regularFile(path, maximumBytes, code);
  return { raw, value: parseStrictJson(raw, code) };
}


function git(argv, code) {
  const result = spawnSync("/usr/bin/git", argv, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0",
    },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.signal !== null || result.stderr !== "") reject(code);
  return result.stdout.trim();
}


function gitBytes(argv, maximumBytes, code) {
  const result = spawnSync("/usr/bin/git", argv, {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    env: {
      PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0",
    },
    timeout: 30_000,
    maxBuffer: maximumBytes,
  });
  if (result.status !== 0 || result.signal !== null || result.stderr.length !== 0
      || result.stdout.length > maximumBytes) reject(code);
  return result.stdout;
}


function safeRepositoryPath(repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length < 1
      || repositoryPath.length > 256 || repositoryPath.startsWith("/")
      || repositoryPath.includes("\0")) {
    reject("TASK70_V3_SOURCE_BINDING_INVALID");
  }
  const path = resolve(REPOSITORY_ROOT, repositoryPath);
  const child = relative(REPOSITORY_ROOT, path);
  if (!child || child === ".." || child.startsWith(`..${sep}`)) {
    reject("TASK70_V3_SOURCE_BINDING_INVALID");
  }
  return path;
}


export function validatePolicy(policy) {
  exactKeys(policy, [
    "schema_version", "contract", "authority", "task_id", "execution_class",
    "evidence_scope", "deployment_class", "audit_clearance", "artifact_path",
    "artifact_contract", "artifact_max_bytes", "historical_v2_policy_path",
    "historical_v2_artifact_path", "historical_v2_status",
    "handler_implementation_status", "production_opcode", "migration_fixture",
    "sql_evidence",
    "required_stage_order", "required_check_order", "source_paths", "case_catalog",
    "required_non_claims", "required_target_guard", "resource_policy", "cleanup_policy",
  ], "TASK70_V3_POLICY_INVALID");
  if (digestValue(policy) !== EXPECTED_POLICY_SHA256
      || policy.schema_version !== 3
      || policy.contract !== "chenyida-erp-uat-promotion-dynamic-validation-policy/v3"
      || policy.task_id !== "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70"
      || policy.audit_clearance !== "PARTIAL_ONLY"
      || policy.production_opcode !== "PG_RB_GUARDED_SWITCH_V3"
      || policy.historical_v2_status !== "FROZEN_UNCHANGED"
      || policy.artifact_path !== "chenyida_erp_site/operations/uat-promotion-dynamic-evidence-v3.json"
      || !Number.isSafeInteger(policy.artifact_max_bytes)
      || policy.artifact_max_bytes !== 1_048_576
      || !Array.isArray(policy.source_paths)
      || policy.source_paths.length !== new Set(policy.source_paths).size
      || JSON.stringify(policy.source_paths) !== JSON.stringify([...policy.source_paths].sort())
      || !Array.isArray(policy.case_catalog) || policy.case_catalog.length !== 1) {
    reject("TASK70_V3_POLICY_INVALID");
  }
  const selectedCase = policy.case_catalog[0];
  exactKeys(policy.sql_evidence, [
    "compression", "maximum_uncompressed_bytes",
    "reconciliation_normalized_sha256", "production_normalized_sha256",
  ], "TASK70_V3_POLICY_INVALID");
  if (policy.sql_evidence.compression !== "GZIP_BASE64_MTIME_ZERO"
      || policy.sql_evidence.maximum_uncompressed_bytes !== 1_048_576) {
    reject("TASK70_V3_POLICY_INVALID");
  }
  exactKeys(policy.resource_policy, [
    "minimum_available_memory_bytes", "minimum_start_available_memory_bytes",
    "maximum_swap_percent", "maximum_swap_growth_bytes",
    "minimum_root_available_bytes", "maximum_load1", "sample_interval_seconds",
    "maximum_sample_gap_seconds", "minimum_preflight_sample_window_seconds",
    "minimum_swap_sample_window_seconds", "minimum_total_sample_window_seconds",
    "minimum_load_breach_window_seconds", "maximum_wall_clock_drift_milliseconds",
    "require_wall_clock_elapsed_binding",
    "require_preflight_before_container_creation", "require_zero_oom_kill_delta",
    "require_zero_service_restart_delta",
  ], "TASK70_V3_POLICY_INVALID");
  if (policy.resource_policy.maximum_wall_clock_drift_milliseconds !== 1500
      || policy.resource_policy.require_wall_clock_elapsed_binding !== true
      || policy.resource_policy.require_preflight_before_container_creation !== true) {
    reject("TASK70_V3_POLICY_INVALID");
  }
  nonzeroSha(policy.sql_evidence.reconciliation_normalized_sha256,
    "TASK70_V3_POLICY_INVALID");
  nonzeroSha(policy.sql_evidence.production_normalized_sha256,
    "TASK70_V3_POLICY_INVALID");
  exactKeys(policy.cleanup_policy, [
    "task_label", "isolation_label", "temp_root_parent", "temp_root_prefix",
    "require_zero_remaining_containers", "require_zero_remaining_networks",
    "require_zero_remaining_volumes", "require_zero_remaining_temp_roots",
    "require_preexisting_container_set_unchanged",
    "require_preexisting_image_set_unchanged", "require_preexisting_volume_set_unchanged",
    "require_preexisting_network_set_unchanged", "require_protected_volume_set_unchanged",
    "require_service_runtime_set_unchanged", "protected_volume_names",
    "protected_service_names",
  ], "TASK70_V3_POLICY_INVALID");
  if (selectedCase.case_id !== "DV70-PG-GUARDED-SWITCH-02"
      || selectedCase.production_opcode !== "PG_RB_GUARDED_SWITCH_V3"
      || selectedCase.stage_coverage !== "PARTIAL"
      || selectedCase.required_scenarios.length !== 10
      || selectedCase.required_assertions.length !== 15
      || policy.migration_fixture.expected_count !== 46
      || policy.migration_fixture.expected_head !== "0046_runtime_lock_privilege_boundary.sql"
      || policy.required_non_claims.length !== 17
      || !policy.required_non_claims.includes(
        "DOES_NOT_PROVE_CONCURRENT_NONCOOPERATING_ROOT_OR_POSTGRESQL_SUPERUSER_EXCLUSION",
      )
      || !policy.required_non_claims.includes(
        "DOES_NOT_PROVE_REAL_DATA_VOLUME_FINISHES_WITHIN_240_SECOND_CONTENT_TIMEOUT",
      )
      || !policy.required_non_claims.includes(
        "DOES_NOT_PROVE_REAL_PREFIX_SIDE_EFFECT_EXECUTION_OR_RECEIPTS",
      )
      || !policy.required_non_claims.includes(
        "DOES_NOT_PROVE_PROCESS_TERMINATION_OR_FRESH_PROCESS_RESTART_RECOVERY",
      )
      || !policy.required_non_claims.includes(
        "DOES_NOT_PROVE_TRANSPORT_LEVEL_POSTGRESQL_COMMIT_RESPONSE_LOSS",
      ) || policy.cleanup_policy.task_label !== "chenyida.erp.task70-v3-run-id"
      || policy.cleanup_policy.isolation_label
        !== "chenyida.erp.execution-scope=isolated-synthetic-v3-test"
      || policy.cleanup_policy.temp_root_parent !== "/tmp"
      || policy.cleanup_policy.temp_root_prefix !== "cyd-dv70-pg-switch."
      || !same(policy.cleanup_policy.protected_volume_names, PROTECTED_VOLUMES)
      || !same(policy.cleanup_policy.protected_service_names, SERVICES)
      || Object.entries(policy.cleanup_policy).some(([key, child]) =>
        key.startsWith("require_") && child !== true)) {
    reject("TASK70_V3_POLICY_INVALID");
  }
  return policy;
}


function verifySourceBindings(artifact, policy) {
  if (!artifact.source || !GIT_SHA1.test(artifact.source.git_commit || "")
      || !GIT_SHA1.test(artifact.source.git_tree || "")
      || !VERSION.test(artifact.source.application_version || "")
      || artifact.source.migration_head !== policy.migration_fixture.expected_head
      || !Array.isArray(artifact.source_bindings)
      || artifact.source_bindings.length !== policy.source_paths.length) {
    reject("TASK70_V3_SOURCE_BINDING_INVALID");
  }
  const bodies = new Map();
  const byPath = new Map();
  for (const binding of artifact.source_bindings) {
    exactKeys(binding, ["path", "sha256", "git_blob"], "TASK70_V3_SOURCE_BINDING_INVALID");
    if (byPath.has(binding.path) || !SHA256.test(binding.sha256 || "")
        || !GIT_SHA1.test(binding.git_blob || "")) {
      reject("TASK70_V3_SOURCE_BINDING_INVALID");
    }
    byPath.set(binding.path, binding);
  }
  if (JSON.stringify([...byPath.keys()]) !== JSON.stringify(policy.source_paths)) {
    reject("TASK70_V3_SOURCE_BINDING_INVALID");
  }
  const tree = git(["rev-parse", `${artifact.source.git_commit}^{tree}`],
    "TASK70_V3_SOURCE_GIT_INVALID");
  if (tree !== artifact.source.git_tree) reject("TASK70_V3_SOURCE_GIT_INVALID");
  for (const repositoryPath of policy.source_paths) {
    const binding = byPath.get(repositoryPath);
    const path = safeRepositoryPath(repositoryPath);
    const raw = regularFile(path, 32 * 1024 * 1024, "TASK70_V3_SOURCE_BINDING_INVALID");
    bodies.set(repositoryPath, raw);
    const blob = git(["rev-parse", `${artifact.source.git_commit}:${repositoryPath}`],
      "TASK70_V3_SOURCE_GIT_INVALID");
    const blobRaw = gitBytes(
      ["cat-file", "blob", binding.git_blob], 32 * 1024 * 1024,
      "TASK70_V3_SOURCE_GIT_INVALID",
    );
    if (digestBytes(raw) !== binding.sha256 || blob !== binding.git_blob
        || digestBytes(blobRaw) !== binding.sha256) {
      reject("TASK70_V3_SOURCE_BINDING_INVALID");
    }
  }
  let packageVersion;
  try {
    packageVersion = JSON.parse(
      bodies.get("chenyida_erp_site/package.json").toString("utf8"),
    ).version;
  } catch {
    reject("TASK70_V3_SOURCE_APPLICATION_VERSION_INVALID");
  }
  if (artifact.source.application_version !== packageVersion) {
    reject("TASK70_V3_SOURCE_APPLICATION_VERSION_INVALID");
  }
  return bodies;
}


function verifyDigestedObject(value, digestField, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !SHA256.test(value[digestField] || "")) reject(code);
  const body = { ...value };
  delete body[digestField];
  if (digestValue(body) !== value[digestField]) reject(code);
}


export function expectedPsqlArguments(spec, code = "TASK70_V3_SQL_RECEIPT_INVALID") {
  const variables = spec?.variables;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)
      || !CONTAINER_ID.test(spec.containerId || "")
      || !/^[a-z0-9_]{1,48}$/.test(spec.phase || "")
      || !/^[a-z_][a-z0-9_]{0,62}$/.test(spec.database || "")
      || !/^[a-z_][a-z0-9_]{0,62}$/.test(spec.username || "")
      || typeof spec.writeOverride !== "boolean"
      || !variables || typeof variables !== "object" || Array.isArray(variables)
      || Object.keys(variables).length > 8
      || Object.entries(variables).some(([key, value]) => (
        !/^[a-z_][a-z0-9_]{0,62}$/.test(key)
        || typeof value !== "string" || value.length < 1 || value.length > 512
        || /[^\x20-\x7e]/.test(value)
      )) || !["terse", "verbose"].includes(spec.verbosity)) reject(code);
  const result = [
    "exec", "--interactive", "--user", "999:999", "--env",
    `PGAPPNAME=cyd_dv70_v3_${spec.phase}`,
  ];
  if (spec.writeOverride) {
    result.push("--env", "PGOPTIONS=-c default_transaction_read_only=off");
  }
  result.push(
    "--", spec.containerId, "psql", "--no-psqlrc", "--quiet", "--no-align",
    "--tuples-only", "--field-separator=\t", "--host=/var/run/postgresql",
    "--port=5432", `--username=${spec.username}`, "--no-password",
    `--dbname=${spec.database}`,
  );
  for (const key of Object.keys(variables).sort()) {
    result.push(`--set=${key}=${variables[key]}`);
  }
  result.push("--set=ON_ERROR_STOP=on", `--set=VERBOSITY=${spec.verbosity}`);
  return result;
}


export function validatePsqlCommandReceipt(
  receipt, spec, code = "TASK70_V3_SQL_RECEIPT_INVALID",
) {
  exactKeys(receipt, [
    "phase", "sql_sha256", "execution", "exit_code", "stdout_sha256",
    "stderr_sha256", "receipt_sha256",
  ], code);
  exactKeys(receipt.execution, [
    "container_id", "database", "username", "write_override", "variables",
    "verbosity", "timeout_seconds", "maximum_output_bytes", "argv_sha256",
    "stdin_sha256", "execution_sha256",
  ], code);
  verifyDigestedObject(receipt.execution, "execution_sha256", code);
  verifyDigestedObject(receipt, "receipt_sha256", code);
  const expectedVariables = Object.fromEntries(
    Object.keys(spec.variables).sort().map((key) => [key, spec.variables[key]]),
  );
  const expectedArguments = expectedPsqlArguments(spec, code);
  const expectedSqlSha256 = spec.sql === undefined ? receipt.sql_sha256
    : digestBytes(spec.sql);
  if (!SHA256.test(receipt.sql_sha256 || "") || receipt.sql_sha256 === ZERO_SHA256
      || receipt.phase !== spec.phase
      || receipt.sql_sha256 !== expectedSqlSha256
      || receipt.execution.container_id !== spec.containerId
      || receipt.execution.database !== spec.database
      || receipt.execution.username !== spec.username
      || receipt.execution.write_override !== spec.writeOverride
      || !same(receipt.execution.variables, expectedVariables)
      || receipt.execution.verbosity !== spec.verbosity
      || receipt.execution.timeout_seconds !== spec.timeoutSeconds
      || receipt.execution.maximum_output_bytes !== spec.maximumOutputBytes
      || receipt.execution.argv_sha256 !== digestValue(expectedArguments)
      || receipt.execution.stdin_sha256 !== receipt.sql_sha256
      || receipt.exit_code !== spec.exitCode
      || receipt.stdout_sha256 !== digestBytes(spec.stdout)
      || receipt.stderr_sha256 !== digestBytes(spec.stderr)) reject(code);
  positiveInteger(receipt.execution.timeout_seconds, code);
  positiveInteger(receipt.execution.maximum_output_bytes, code);
  return receipt;
}


function canonicalBase64(value, maximumBytes, code) {
  if (typeof value !== "string" || value.length > Math.ceil(maximumBytes / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    reject(code);
  }
  const raw = Buffer.from(value, "base64");
  if (raw.length > maximumBytes || raw.toString("base64") !== value) reject(code);
  return raw;
}


function fixedExecutorPsqlArguments(base, opcode, code) {
  if (!base || !opcode || !["reconcile", "guardedswitch"].includes(opcode.phase)
      || opcode.database !== base.databases.staging_name) reject(code);
  const token = base.databases.staging_name.split("_").at(-1);
  if (!/^[a-z0-9]{1,32}$/.test(token || "")) reject(code);
  const variables = opcode.phase === "guardedswitch" ? {
    capture_security_state: "1",
    sealed_staging_mode: "1",
    expected_database: base.databases.staging_name,
    expected_marker: base.databases.staging_marker,
    expected_system_identifier: base.postgres.system_identifier,
    migration_owner: base.security.database_owner,
  } : {};
  const result = [
    "exec", "--interactive", "--user", "999:999", "--env",
    `PGAPPNAME=cyd_rb_${token}_${opcode.phase}`,
    "--env", "PGOPTIONS=-c default_transaction_read_only=off",
    "--", base.postgres.container_id,
    "psql", "--no-psqlrc", "--quiet", "--no-align", "--tuples-only",
    "--field-separator=\t", "--host=/var/run/postgresql", "--port=5432",
    "--username=postgres", "--no-password", `--dbname=${opcode.database}`,
  ];
  for (const key of Object.keys(variables).sort()) {
    result.push(`--set=${key}=${variables[key]}`);
  }
  result.push("--set=ON_ERROR_STOP=on", "--set=VERBOSITY=terse");
  return result;
}


export function validateFixedExecutionReceipt(
  receipt, { base, opcode, sql, sequence },
  code = "TASK70_V3_FIXED_EXECUTION_RECEIPT_INVALID",
) {
  exactKeys(receipt, [
    "schema_version", "contract", "sequence", "phase", "arguments",
    "arguments_sha256", "environment", "environment_sha256", "stdin_present",
    "stdin_bytes", "stdin_sha256", "timeout_milliseconds", "maximum_output_bytes",
    "side_effects_started", "return_code", "stdout_base64", "stdout_bytes",
    "stdout_sha256", "stderr_base64", "stderr_bytes", "stderr_sha256",
    "daemon_state", "execution_receipt_sha256",
  ], code);
  verifyDigestedObject(receipt, "execution_receipt_sha256", code);
  const expectedArguments = fixedExecutorPsqlArguments(base, opcode, code);
  const stdout = canonicalBase64(receipt.stdout_base64, 64 * 1024, code);
  const stderr = canonicalBase64(receipt.stderr_base64, 64 * 1024, code);
  if (!Buffer.isBuffer(sql) || sql.length < 1 || sql.at(-1) !== 10
      || receipt.schema_version !== 1
      || receipt.contract !== FIXED_EXECUTION_RECEIPT_CONTRACT
      || receipt.sequence !== sequence || receipt.phase !== opcode.phase
      || !same(receipt.arguments, expectedArguments)
      || receipt.arguments_sha256 !== digestValue(expectedArguments)
      || !same(receipt.environment, FIXED_EXECUTION_ENVIRONMENT)
      || receipt.environment_sha256 !== digestValue(FIXED_EXECUTION_ENVIRONMENT)
      || receipt.stdin_present !== true || receipt.stdin_bytes !== sql.length
      || receipt.stdin_sha256 !== digestBytes(sql)
      || receipt.stdin_sha256 !== opcode.sql_sha256
      || receipt.timeout_milliseconds !== 300_000
      || receipt.maximum_output_bytes !== 4 * 1024 * 1024
      || receipt.side_effects_started !== true
      || !Number.isSafeInteger(receipt.return_code)
      || receipt.return_code < 0 || receipt.return_code > 255
      || receipt.stdout_bytes !== stdout.length
      || receipt.stdout_sha256 !== digestBytes(stdout)
      || receipt.stderr_bytes !== stderr.length
      || receipt.stderr_sha256 !== digestBytes(stderr)
      || receipt.daemon_state !== "COMPLETED_NO_UNTRACKED_PROCESS") reject(code);
  return { receipt, stdout, stderr };
}


function validateGuardedFailureExecution(
  receipt, spec, reason, code = "TASK70_V3_GUARDED_FAILURE_EXECUTION_INVALID",
) {
  const { stdout, stderr } = validateFixedExecutionReceipt(receipt, spec, code);
  if (reason === "TARGET_DATABASE_MISSING") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(stderr);
    const expected = "psql: error: connection to server on socket "
      + '"/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  database '
      + `"${spec.base.databases.staging_name}" does not exist\n`;
    if (receipt.return_code !== 2 || stdout.length !== 0 || stderr.length > 4096
        || text !== expected) reject(code);
    return receipt;
  }
  if (reason === "CONTENT_GUARD_RELATION_MISMATCH") {
    if (receipt.return_code !== 3 || stderr.length > 4096
        || !stdout.every((value) => [9, 10, 32].includes(value))
        || !stderr.equals(Buffer.from(
          "ERROR:  guarded switch relation content mismatch\n", "ascii",
        ))) reject(code);
    return receipt;
  }
  if (reason === "RUNTIME_PRIVILEGE_MISMATCH") {
    if (receipt.return_code !== 3 || stderr.length !== 0 || stdout.length > 4096
        || stdout.includes(0) || stdout.includes(13)) reject(code);
    const text = new TextDecoder("ascii", { fatal: true }).decode(stdout);
    const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (!text.endsWith("\n")
        || !text.split("").every((value) => /[ \t\na-z]/.test(value))
        || !same(lines, ["guarded switch runtime privilege mismatch"])) reject(code);
    return receipt;
  }
  reject(code);
}


function quoteIdentifier(value, code) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value || "")) reject(code);
  return `"${value}"`;
}


function quoteLiteral(value, code) {
  if (typeof value !== "string" || value.length < 1
      || Buffer.byteLength(value, "utf8") > 1024 || /[\0\r\n]/.test(value)) reject(code);
  return `'${value.replaceAll("'", "''")}'`;
}


export function setupClusterSql(policy, privilegePolicy, code = "TASK70_V3_SQL_RECEIPT_INVALID") {
  if (!same(privilegePolicy.tablespaces, {
    built_in: ["pg_default", "pg_global"], custom: [],
    owner: "PLATFORM_OWNER", privileges: [],
  })) reject(code);
  const roleLines = privilegePolicy.roles.map((role) => {
    const attributes = [
      role.intended_login ? "LOGIN" : "NOLOGIN",
      role.inherit ? "INHERIT" : "NOINHERIT",
      role.superuser ? "SUPERUSER" : "NOSUPERUSER",
      role.create_role ? "CREATEROLE" : "NOCREATEROLE",
      role.create_database ? "CREATEDB" : "NOCREATEDB",
      role.replication ? "REPLICATION" : "NOREPLICATION",
      role.bypass_rls ? "BYPASSRLS" : "NOBYPASSRLS",
      `CONNECTION LIMIT ${role.connection_limit}`,
    ];
    if (role.valid_until !== null) {
      attributes.push(`VALID UNTIL ${quoteLiteral(role.valid_until, code)}`);
    }
    return `CREATE ROLE ${quoteIdentifier(role.name, code)} ${attributes.join(" ")};`;
  });
  const membershipLines = privilegePolicy.memberships.map((membership) => (
    `GRANT ${quoteIdentifier(membership.role, code)} `
    + `TO ${quoteIdentifier(membership.member, code)} `
    + "WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;"
  ));
  const marker = policy.required_target_guard.management_database_comment;
  const candidateMarker = policy.required_target_guard.executor_fixture_candidate_marker;
  const stagingMarker =
    "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING";
  const active = quoteIdentifier("chenyida_erp", code);
  const staging = quoteIdentifier("chenyida_erp_rb_deadbeefdeadbeef", code);
  return Buffer.from(
    `${[...roleLines, ...membershipLines].join("\n")}\n`
    + "GRANT ALL PRIVILEGES ON TABLESPACE pg_default TO CURRENT_USER;\n"
    + "GRANT ALL PRIVILEGES ON TABLESPACE pg_global TO CURRENT_USER;\n"
    + `COMMENT ON DATABASE postgres IS ${quoteLiteral(marker, code)};\n`
    + `CREATE DATABASE ${active} WITH OWNER chenyida_erp_owner\n`
    + "  TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C'\n"
    + "  LC_CTYPE 'C' TABLESPACE pg_default CONNECTION LIMIT 0;\n"
    + `ALTER DATABASE ${active} SET default_transaction_read_only TO on;\n`
    + `ALTER DATABASE ${active} ALLOW_CONNECTIONS false;\n`
    + `COMMENT ON DATABASE ${active} IS ${quoteLiteral(candidateMarker, code)};\n`
    + `CREATE DATABASE ${staging} WITH OWNER chenyida_erp_owner\n`
    + "  TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C'\n"
    + "  LC_CTYPE 'C' TABLESPACE pg_default CONNECTION LIMIT 64;\n"
    + `COMMENT ON DATABASE ${staging} IS ${quoteLiteral(stagingMarker, code)};\n`,
    "utf8",
  );
}


export function resetLayoutSql(base, restoredOid, code = "TASK70_V3_SQL_RECEIPT_INVALID") {
  const names = base.databases;
  const active = quoteIdentifier(names.active_name, code);
  const staging = quoteIdentifier(names.staging_name, code);
  const quarantine = quoteIdentifier(names.quarantine_name, code);
  return Buffer.from(
    "BEGIN;\nDO $cyd$\nBEGIN\n"
    + "  IF NOT EXISTS (\n"
    + "       SELECT 1 FROM pg_catalog.pg_database d\n"
    + `       WHERE d.datname=${quoteLiteral(names.active_name, code)} `
    + `AND d.oid::text=${quoteLiteral(restoredOid, code)}\n`
    + `         AND pg_catalog.shobj_description(d.oid,'pg_database')=`
    + `${quoteLiteral(names.candidate_marker, code)}\n`
    + "         AND d.datallowconn=false AND d.datconnlimit=0)\n"
    + "     OR NOT EXISTS (\n"
    + "       SELECT 1 FROM pg_catalog.pg_database d\n"
    + `       WHERE d.datname=${quoteLiteral(names.quarantine_name, code)} `
    + `AND d.oid::text=${quoteLiteral(names.candidate_oid, code)}\n`
    + `         AND pg_catalog.shobj_description(d.oid,'pg_database')=`
    + `${quoteLiteral(names.quarantine_marker, code)}\n`
    + "         AND d.datallowconn=false AND d.datconnlimit=0)\n"
    + `     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=`
    + `${quoteLiteral(names.staging_name, code)})\n`
    + "  THEN RAISE EXCEPTION 'task70 fixture reset precondition mismatch'; END IF;\n"
    + "END\n$cyd$;\n"
    + `ALTER DATABASE ${active} RENAME TO ${staging};\n`
    + `ALTER DATABASE ${quarantine} RENAME TO ${active};\n`
    + `ALTER DATABASE ${staging} ALLOW_CONNECTIONS true;\n`
    + `COMMENT ON DATABASE ${active} IS ${quoteLiteral(names.candidate_marker, code)};\n`
    + `COMMENT ON DATABASE ${staging} IS ${quoteLiteral(names.staging_marker, code)};\n`
    + "COMMIT;\n",
    "utf8",
  );
}


function expectedCreateArguments(policy, runId, name) {
  const limits = policy.case_catalog[0].container_limits;
  const result = [
    "create", "--pull=never", "--platform", "linux/amd64", "--name", name,
    "--label", `${policy.cleanup_policy.task_label}=${runId}`,
    "--label", policy.cleanup_policy.isolation_label,
    "--user", limits.user, "--network", limits.network_mode,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--restart", "no", "--log-driver", "none",
    "--memory", String(limits.memory_bytes),
    "--memory-swap", String(limits.memory_swap_bytes),
    "--cpus", String(limits.cpus), "--pids-limit", String(limits.pids),
    "--shm-size", String(limits.shared_memory_bytes),
    "--stop-timeout", String(limits.stop_timeout_seconds),
  ];
  for (const target of Object.keys(limits.tmpfs).sort()) {
    const spec = limits.tmpfs[target];
    result.push("--tmpfs", `${target}:${spec.options},size=${spec.size_bytes}`);
  }
  result.push(
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env", "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C",
    "--env", "PGDATA=/var/lib/postgresql/data/pgdata",
    policy.case_catalog[0].postgres_image_reference,
    "postgres", "-c", "listen_addresses=*", "-c",
    "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
    "-c", "shared_buffers=64MB", "-c", "log_statement=none",
  );
  return result;
}


function verifyImage(value, reference) {
  exactKeys(value, [
    "id", "descriptor_digest", "repo_digest_suffixes", "architecture", "os", "size_bytes",
  ], "TASK70_V3_RUNTIME_IMAGE_INVALID");
  const expectedDigest = reference.split("@")[1];
  if (!DIGEST.test(value.id || "") || value.descriptor_digest !== expectedDigest
      || !Array.isArray(value.repo_digest_suffixes)
      || !same(value.repo_digest_suffixes, [...new Set(value.repo_digest_suffixes)].sort())
      || !value.repo_digest_suffixes.includes(expectedDigest)
      || value.repo_digest_suffixes.some((item) => !DIGEST.test(item || ""))
      || value.architecture !== "amd64" || value.os !== "linux") {
    reject("TASK70_V3_RUNTIME_IMAGE_INVALID");
  }
  positiveInteger(value.size_bytes, "TASK70_V3_RUNTIME_IMAGE_INVALID");
  return value;
}


function verifyContainer(value, policy, runId, image) {
  exactKeys(value, [
    "container_id", "name", "created_at", "labels", "image_id", "image_reference",
    "user", "network_mode", "rootfs_read_only", "cap_drop", "cap_add", "security_opt",
    "restart_policy", "privileged", "memory_bytes", "memory_swap_bytes", "nano_cpus",
    "pids", "shared_memory_bytes", "stop_timeout_seconds", "log_driver", "devices",
    "binds", "mounts", "published_ports", "publish_all_ports", "tmpfs",
    "synthetic_trust_auth", "initdb_args", "pgdata", "command",
  ], "TASK70_V3_RUNTIME_CONTAINER_INVALID");
  const selectedCase = policy.case_catalog[0];
  const limits = selectedCase.container_limits;
  const isolation = policy.cleanup_policy.isolation_label.split("=");
  dockerIsoMilliseconds(value.created_at, "TASK70_V3_RUNTIME_CONTAINER_INVALID");
  const labels = {
    [policy.cleanup_policy.task_label]: runId,
    [isolation[0]]: isolation.slice(1).join("="),
  };
  if (!CONTAINER_ID.test(value.container_id || "")
      || value.name !== `cyd-dv70-pg-v3-${runId}`
      || !same(value.labels, labels) || value.image_id !== image.id
      || value.image_reference !== selectedCase.postgres_image_reference
      || value.user !== limits.user || value.network_mode !== limits.network_mode
      || value.rootfs_read_only !== true || !same(value.cap_drop, ["ALL"])
      || !same(value.cap_add, []) || !same(value.security_opt, ["no-new-privileges"])
      || value.restart_policy !== "no" || value.privileged !== false
      || value.memory_bytes !== limits.memory_bytes
      || value.memory_swap_bytes !== limits.memory_swap_bytes
      || value.nano_cpus !== 1_000_000_000 || value.pids !== limits.pids
      || value.shared_memory_bytes !== limits.shared_memory_bytes
      || value.stop_timeout_seconds !== limits.stop_timeout_seconds
      || value.log_driver !== "none" || !same(value.devices, []) || !same(value.binds, [])
      || !same(value.mounts, []) || !same(value.published_ports, {})
      || value.publish_all_ports !== false || !same(value.tmpfs, limits.tmpfs)
      || value.synthetic_trust_auth !== true
      || value.initdb_args !== "--encoding=UTF8 --locale=C"
      || value.pgdata !== "/var/lib/postgresql/data/pgdata"
      || !same(value.command, [
        "postgres", "-c", "listen_addresses=*", "-c",
        "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
        "-c", "shared_buffers=64MB", "-c", "log_statement=none",
      ])) reject("TASK70_V3_RUNTIME_CONTAINER_INVALID");
  return value;
}


function verifyRuntime(value, policy, runId) {
  exactKeys(value, [
    "platform", "postgres_image_reference", "postgres_image_before",
    "postgres_image_after", "docker_binary_sha256", "container_limits",
    "docker_create_arguments", "docker_create_arguments_sha256", "container_inspect",
    "build_performed", "pull_performed", "mounted_volume_names",
  ], "TASK70_V3_RUNTIME_INVALID");
  const reference = policy.case_catalog[0].postgres_image_reference;
  const before = verifyImage(value.postgres_image_before, reference);
  const after = verifyImage(value.postgres_image_after, reference);
  const container = verifyContainer(value.container_inspect, policy, runId, before);
  const expectedArguments = expectedCreateArguments(policy, runId, container.name);
  if (value.platform !== "linux/amd64" || value.postgres_image_reference !== reference
      || !same(before, after) || !same(value.container_limits,
        policy.case_catalog[0].container_limits)
      || !same(value.docker_create_arguments, expectedArguments)
      || value.docker_create_arguments_sha256 !== digestValue(expectedArguments)
      || !SHA256.test(value.docker_binary_sha256 || "")
      || value.docker_binary_sha256 === "0".repeat(64)
      || value.build_performed !== false || value.pull_performed !== false
      || !same(value.mounted_volume_names, [])) reject("TASK70_V3_RUNTIME_INVALID");
  return value;
}


function verifyResourceService(value, expected, baseline) {
  exactKeys(value, [
    "service", "container_id", "restart_count", "oom_killed", "running", "health",
  ], "TASK70_V3_RESOURCE_SERVICE_INVALID");
  if (value.service !== expected || !CONTAINER_ID.test(value.container_id || "")
      || value.restart_count !== 0 || value.oom_killed !== false
      || value.running !== true || !["HEALTHY", "NONE"].includes(value.health)
      || baseline && !same(value, baseline)) reject("TASK70_V3_RESOURCE_SERVICE_INVALID");
}


export function verifyResourceGate(value, policy, timing) {
  const code = "TASK70_V3_RESOURCE_GATE_INVALID";
  exactKeys(value, [
    "boot_id_sha256", "sample_interval_seconds", "sample_count", "sample_window_seconds",
    "preflight_sample_window_seconds", "samples", "minimum_available_memory_bytes",
    "maximum_swap_basis_points_observed", "maximum_rolling_swap_growth_bytes",
    "minimum_root_available_bytes", "maximum_load1_milli_observed", "oom_kill_delta",
    "service_restart_delta", "declared_maximum_disk_delta_bytes",
    "observed_peak_disk_delta_bytes", "result", "resource_evidence_sha256",
  ], code);
  verifyDigestedObject(value, "resource_evidence_sha256", code);
  nonzeroSha(value.boot_id_sha256, code);
  const resource = policy.resource_policy;
  const selectedCase = policy.case_catalog[0];
  exactKeys(timing, ["started_at", "completed_at", "container_created_at"], code);
  const startedAt = Date.parse(strictIso(timing.started_at, code));
  const completedAt = Date.parse(strictIso(timing.completed_at, code));
  const containerCreatedAt = dockerIsoMilliseconds(timing.container_created_at, code);
  const wallClockTolerance = resource.maximum_wall_clock_drift_milliseconds;
  positiveInteger(wallClockTolerance, code);
  if (resource.require_wall_clock_elapsed_binding !== true
      || resource.require_preflight_before_container_creation !== true
      || completedAt < startedAt || containerCreatedAt < startedAt) reject(code);
  if (value.sample_interval_seconds !== resource.sample_interval_seconds
      || !Array.isArray(value.samples) || value.samples.length < 2
      || value.sample_count !== value.samples.length) reject(code);
  let baselineServices;
  let previousElapsed;
  let previousCaptured;
  let previousOom;
  for (const [index, sample] of value.samples.entries()) {
    exactKeys(sample, [
      "captured_at", "elapsed_milliseconds", "available_memory_bytes", "swap_used_bytes",
      "swap_total_bytes", "root_available_bytes", "load1_milli", "oom_kill_count",
      "services",
    ], code);
    strictIso(sample.captured_at, code);
    nonNegativeInteger(sample.elapsed_milliseconds, code);
    positiveInteger(sample.available_memory_bytes, code);
    nonNegativeInteger(sample.swap_used_bytes, code);
    positiveInteger(sample.swap_total_bytes, code);
    positiveInteger(sample.root_available_bytes, code);
    nonNegativeInteger(sample.load1_milli, code);
    nonNegativeInteger(sample.oom_kill_count, code);
    if (sample.swap_used_bytes > sample.swap_total_bytes
        || sample.available_memory_bytes < resource.minimum_available_memory_bytes
        || sample.swap_used_bytes * 100 > sample.swap_total_bytes * resource.maximum_swap_percent
        || sample.root_available_bytes < resource.minimum_root_available_bytes
        || sample.load1_milli > resource.maximum_load1 * 1000
        || !Array.isArray(sample.services) || sample.services.length !== SERVICES.length) reject(code);
    sample.services.forEach((service, serviceIndex) =>
      verifyResourceService(service, SERVICES[serviceIndex], baselineServices?.[serviceIndex]));
    baselineServices ||= sample.services;
    if (index === 0) {
      if (sample.available_memory_bytes < resource.minimum_start_available_memory_bytes
          || sample.root_available_bytes < resource.minimum_root_available_bytes
            + selectedCase.maximum_disk_delta_bytes) reject(code);
    } else {
      const elapsedDelta = sample.elapsed_milliseconds - previousElapsed;
      const capturedDelta = Date.parse(sample.captured_at) - previousCaptured;
      if (elapsedDelta <= 0
          || elapsedDelta > resource.maximum_sample_gap_seconds * 1000
          || capturedDelta <= 0
          || capturedDelta > resource.maximum_sample_gap_seconds * 1000
            + wallClockTolerance
          || Math.abs(capturedDelta - elapsedDelta) > wallClockTolerance
          || sample.oom_kill_count < previousOom) reject(code);
    }
    previousElapsed = sample.elapsed_milliseconds;
    previousCaptured = Date.parse(sample.captured_at);
    previousOom = sample.oom_kill_count;
  }
  const first = value.samples[0];
  const firstCapturedAt = Date.parse(first.captured_at);
  const lastCapturedAt = Date.parse(value.samples.at(-1).captured_at);
  const elapsedWindowMilliseconds =
    value.samples.at(-1).elapsed_milliseconds - first.elapsed_milliseconds;
  const wallWindowMilliseconds = lastCapturedAt - firstCapturedAt;
  const window = Math.floor(
    elapsedWindowMilliseconds / 1000,
  );
  const preflightSamples = value.samples.filter(
    (sample) => Date.parse(sample.captured_at) <= containerCreatedAt,
  );
  if (preflightSamples.length < 2) reject(code);
  const preflightLast = preflightSamples.at(-1);
  const preflightElapsedMilliseconds =
    preflightLast.elapsed_milliseconds - first.elapsed_milliseconds;
  const preflightWallMilliseconds = Date.parse(preflightLast.captured_at) - firstCapturedAt;
  const minimumPreflightMilliseconds =
    resource.minimum_preflight_sample_window_seconds * 1000;
  const minimumTotalMilliseconds = resource.minimum_total_sample_window_seconds * 1000;
  const minimumMemory = Math.min(...value.samples.map((item) => item.available_memory_bytes));
  const minimumRoot = Math.min(...value.samples.map((item) => item.root_available_bytes));
  const maximumLoad = Math.max(...value.samples.map((item) => item.load1_milli));
  const maximumSwapBasisPoints = Math.max(...value.samples.map((item) =>
    Math.floor((item.swap_used_bytes * 10_000 + item.swap_total_bytes - 1)
      / item.swap_total_bytes)));
  const maximumOom = Math.max(...value.samples.map((item) => item.oom_kill_count));
  const restartSums = value.samples.map((sample) =>
    sample.services.reduce((total, item) => total + item.restart_count, 0));
  let maximumSwapGrowth = 0;
  const minimumWindow = resource.minimum_swap_sample_window_seconds * 1000;
  const maximumGap = resource.maximum_sample_gap_seconds * 1000;
  value.samples.forEach((current, index) => {
    const eligible = value.samples.slice(0, index).filter((previous) => {
      const elapsed = current.elapsed_milliseconds - previous.elapsed_milliseconds;
      return elapsed >= minimumWindow && elapsed <= minimumWindow + maximumGap;
    });
    if (eligible.length) maximumSwapGrowth = Math.max(maximumSwapGrowth,
      Math.max(0, current.swap_used_bytes - eligible.at(-1).swap_used_bytes));
  });
  const diskDelta = Math.max(0, first.root_available_bytes - minimumRoot);
  if (value.sample_window_seconds !== window
      || window < resource.minimum_total_sample_window_seconds
      || value.preflight_sample_window_seconds !== resource.minimum_preflight_sample_window_seconds
      || value.preflight_sample_window_seconds > window
      || firstCapturedAt < startedAt || lastCapturedAt > completedAt
      || containerCreatedAt < firstCapturedAt || containerCreatedAt > lastCapturedAt
      || preflightElapsedMilliseconds < minimumPreflightMilliseconds
      || preflightWallMilliseconds
        < minimumPreflightMilliseconds - wallClockTolerance
      || containerCreatedAt - firstCapturedAt
        < minimumPreflightMilliseconds - wallClockTolerance
      || wallWindowMilliseconds < minimumTotalMilliseconds - wallClockTolerance
      || completedAt - startedAt < minimumTotalMilliseconds - wallClockTolerance
      || Math.abs(wallWindowMilliseconds - elapsedWindowMilliseconds)
        > wallClockTolerance
      || value.minimum_available_memory_bytes !== minimumMemory
      || value.maximum_swap_basis_points_observed !== maximumSwapBasisPoints
      || value.maximum_rolling_swap_growth_bytes !== maximumSwapGrowth
      || value.minimum_root_available_bytes !== minimumRoot
      || value.maximum_load1_milli_observed !== maximumLoad
      || value.oom_kill_delta !== maximumOom - first.oom_kill_count
      || value.service_restart_delta !== Math.max(...restartSums) - restartSums[0]
      || value.declared_maximum_disk_delta_bytes !== selectedCase.maximum_disk_delta_bytes
      || value.observed_peak_disk_delta_bytes !== diskDelta
      || maximumSwapGrowth > resource.maximum_swap_growth_bytes
      || diskDelta > selectedCase.maximum_disk_delta_bytes
      || value.oom_kill_delta !== 0 || value.service_restart_delta !== 0
      || resource.require_zero_oom_kill_delta !== true
      || resource.require_zero_service_restart_delta !== true
      || value.result !== "PASS") reject(code);
  return value;
}


function verifyObjectService(value, expected) {
  exactKeys(value, [
    "service", "container_id", "image_reference_sha256", "image_id", "restart_count",
    "oom_killed", "running", "health", "mount_set_sha256", "network_set_sha256",
    "port_set_sha256",
  ], "TASK70_V3_OBJECT_SERVICE_INVALID");
  if (value.service !== expected || !CONTAINER_ID.test(value.container_id || "")
      || !DIGEST.test(value.image_id || "") || value.restart_count !== 0
      || value.oom_killed !== false || value.running !== true
      || !["HEALTHY", "NONE"].includes(value.health)) reject("TASK70_V3_OBJECT_SERVICE_INVALID");
  for (const field of ["image_reference_sha256", "mount_set_sha256",
    "network_set_sha256", "port_set_sha256"]) nonzeroSha(value[field],
    "TASK70_V3_OBJECT_SERVICE_INVALID");
}


function verifyObjectSnapshot(value, policy) {
  const code = "TASK70_V3_OBJECT_SNAPSHOT_INVALID";
  exactKeys(value, [
    "containers", "images", "volumes", "networks", "protected_volumes", "services",
    "fingerprint_sha256",
  ], code);
  verifyDigestedObject(value, "fingerprint_sha256", code);
  if (!Array.isArray(value.containers)
      || !same(value.containers, [...new Set(value.containers)].sort())
      || value.containers.some((item) => !CONTAINER_ID.test(item || ""))) reject(code);
  let previous = "";
  if (!Array.isArray(value.images)) reject(code);
  for (const item of value.images) {
    exactKeys(item, ["id", "repo_tag_set_sha256", "repo_digest_set_sha256"], code);
    if (!DIGEST.test(item.id || "") || item.id <= previous) reject(code);
    previous = item.id;
    nonzeroSha(item.repo_tag_set_sha256, code);
    nonzeroSha(item.repo_digest_set_sha256, code);
  }
  previous = "";
  if (!Array.isArray(value.volumes)) reject(code);
  for (const item of value.volumes) {
    exactKeys(item, ["name", "driver", "scope", "created_at", "label_set_sha256"], code);
    if (typeof item.name !== "string" || !item.name || item.name <= previous
        || typeof item.driver !== "string" || !item.driver
        || typeof item.scope !== "string" || !item.scope
        || typeof item.created_at !== "string" || !item.created_at) reject(code);
    previous = item.name;
    nonzeroSha(item.label_set_sha256, code);
  }
  previous = "";
  if (!Array.isArray(value.networks)) reject(code);
  for (const item of value.networks) {
    exactKeys(item, ["id", "name_sha256", "driver", "scope", "label_set_sha256"], code);
    if (!CONTAINER_ID.test(item.id || "") || item.id <= previous
        || typeof item.driver !== "string" || !item.driver
        || typeof item.scope !== "string" || !item.scope) reject(code);
    previous = item.id;
    nonzeroSha(item.name_sha256, code);
    nonzeroSha(item.label_set_sha256, code);
  }
  if (!same(policy.cleanup_policy.protected_volume_names, PROTECTED_VOLUMES)
      || !Array.isArray(value.protected_volumes)
      || !same(value.protected_volumes.map((item) => item.name), PROTECTED_VOLUMES)) reject(code);
  for (const item of value.protected_volumes) {
    if (!same(item, value.volumes.find((candidate) => candidate.name === item.name))) reject(code);
  }
  if (!Array.isArray(value.services) || value.services.length !== SERVICES.length) reject(code);
  value.services.forEach((item, index) => verifyObjectService(item, SERVICES[index]));
  return value;
}


function verifyCleanup(value, { policy, runId, runtime, before, after }) {
  const code = "TASK70_V3_CLEANUP_INVALID";
  exactKeys(value, [
    "task_label", "isolation_label", "discovery_scope", "preexisting_residue",
    "created_containers", "created_networks", "created_volumes", "temp_roots",
    "removed_container_ids", "remaining_containers",
    "remaining_networks", "remaining_volumes", "remaining_temp_roots",
    "process_group_remaining", "result", "cleanup_receipt_sha256",
  ], code);
  verifyDigestedObject(value, "cleanup_receipt_sha256", code);
  const container = runtime.container_inspect;
  exactKeys(value.discovery_scope, [
    "task_label_key", "temp_root_parent", "temp_root_prefix",
  ], code);
  exactKeys(value.preexisting_residue, [
    "containers", "networks", "volumes", "temp_roots",
  ], code);
  if (value.task_label !== `${policy.cleanup_policy.task_label}=${runId}`
      || value.isolation_label !== policy.cleanup_policy.isolation_label
      || !same(value.discovery_scope, {
        task_label_key: policy.cleanup_policy.task_label,
        temp_root_parent: policy.cleanup_policy.temp_root_parent,
        temp_root_prefix: policy.cleanup_policy.temp_root_prefix,
      }) || !same(value.preexisting_residue, {
        containers: [], networks: [], volumes: [], temp_roots: [],
      })
      || !Array.isArray(value.created_containers) || value.created_containers.length !== 1
      || !same(value.created_networks, []) || !same(value.created_volumes, [])
      || !same(value.removed_container_ids, [container.container_id])
      || !same(value.remaining_containers, []) || !same(value.remaining_networks, [])
      || !same(value.remaining_volumes, []) || !same(value.remaining_temp_roots, [])
      || value.process_group_remaining !== 0 || value.result !== "ZERO_TASK_RESIDUE"
      || !same(before, after) || !Array.isArray(value.temp_roots)
      || value.temp_roots.length !== 1
      || value.temp_roots[0] !== `/tmp/cyd-dv70-pg-switch.${runId.slice(5)}`) reject(code);
  const created = value.created_containers[0];
  exactKeys(created, ["id", "name", "labels", "created_at"], code);
  if (created.id !== container.container_id || created.name !== container.name
      || !same(created.labels, container.labels) || created.created_at !== container.created_at) {
    reject(code);
  }
  return value;
}


function verifyHistoricalV2(value) {
  const code = "TASK70_V3_HISTORICAL_V2_INVALID";
  exactKeys(value, ["before", "after", "result"], code);
  for (const projection of [value.before, value.after]) {
    exactKeys(projection, [
      "policy", "artifact", "producer", "verifier", "audit_test",
    ], code);
    if (!same(projection, HISTORICAL_V2)) reject(code);
  }
  const actual = {
    policy: digestBytes(regularFile(resolve(SITE_ROOT,
      "operations/uat-promotion-dynamic-validation-policy-v2.json"), 1024 * 1024, code)),
    artifact: digestBytes(regularFile(resolve(SITE_ROOT,
      "operations/uat-promotion-dynamic-evidence-v2.json"), 1024 * 1024, code)),
    producer: digestBytes(regularFile(resolve(SITE_ROOT,
      "scripts/uat-promotion-dynamic-pg-switch.py"), 32 * 1024 * 1024, code)),
    verifier: digestBytes(regularFile(resolve(SITE_ROOT,
      "scripts/uat-promotion-dynamic-evidence.mjs"), 32 * 1024 * 1024, code)),
    audit_test: digestBytes(regularFile(resolve(SITE_ROOT,
      "tests/selfhost-uat-promotion-rollback-audit.test.mjs"),
    32 * 1024 * 1024, code)),
  };
  if (!same(actual, HISTORICAL_V2) || value.result !== "FROZEN_UNCHANGED") reject(code);
}


function verifyCoverage(value, policy) {
  const code = "TASK70_V3_COVERAGE_INVALID";
  exactKeys(value, ["stages", "checks", "status"], code);
  const expectedStages = policy.required_stage_order.map((id) => ({
    id, status: id === "POSTGRESQL_RESTORE" ? "PARTIAL" : "MISSING",
  }));
  const expectedChecks = policy.required_check_order.map((id) => ({
    id, status: ["POSTGRESQL_CONTENT", "MIGRATION_HEAD"].includes(id)
      ? "PARTIAL" : "MISSING",
  }));
  if (!same(value, { stages: expectedStages, checks: expectedChecks, status: "PARTIAL" })) {
    reject(code);
  }
}


function verifyMutationAck(value, opcode, execution) {
  const code = "TASK70_V3_MUTATION_ACK_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "opcode", "stdout_bytes", "stdout_sha256", "ack_sha256",
  ], code);
  verifyDigestedObject(value, "ack_sha256", code);
  if (value.schema_version !== 1
      || value.contract !== "chenyida-erp-uat-rollback-postgresql-mutation-ack/v1"
      || value.opcode !== opcode || !Number.isSafeInteger(value.stdout_bytes)
      || value.stdout_bytes < 1 || value.stdout_bytes > 64 * 1024
      || !SHA256.test(value.stdout_sha256 || "")
      || !execution || execution.receipt.return_code !== 0
      || execution.stderr.length !== 0
      || value.stdout_bytes !== execution.stdout.length
      || value.stdout_sha256 !== digestBytes(execution.stdout)
      || !execution.stdout.every((byte) => [9, 10, 13, 32, 116].includes(byte))) reject(code);
  const lines = execution.stdout.toString("ascii").split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean);
  if (opcode === "PG_RB_GUARDED_SWITCH_V3" && !same(lines, ["t"])) reject(code);
  return value;
}


function verifyCommand(
  value, opcode, ack, execution, executionCount, responseDelivered,
) {
  const code = "TASK70_V3_COMMAND_INVALID";
  exactKeys(value, [
    "opcode", "opcode_spec_sha256", "sql_sha256", "runner_argv_template_sha256",
    "execution_count", "response_delivered", "mutation_ack_sha256", "stdout_bytes",
    "stdout_sha256", "execution_receipt_sha256", "failure_code",
    "command_projection_sha256",
  ], code);
  verifyDigestedObject(value, "command_projection_sha256", code);
  if (value.opcode !== opcode.opcode
      || value.opcode_spec_sha256 !== opcode.opcode_spec_sha256
      || value.sql_sha256 !== opcode.sql_sha256
      || value.runner_argv_template_sha256 !== opcode.argv_template_sha256
      || value.execution_count !== executionCount
      || value.response_delivered !== responseDelivered || value.failure_code !== null
      || value.mutation_ack_sha256 !== ack.ack_sha256
      || value.stdout_bytes !== ack.stdout_bytes
      || value.stdout_sha256 !== ack.stdout_sha256
      || value.execution_receipt_sha256
        !== execution.receipt.execution_receipt_sha256) reject(code);
}


function verifyJournal(value, expectedRecovery, expectedReceipt, {
  base, production, stagingProof,
}) {
  const code = "TASK70_V3_JOURNAL_INVALID";
  exactKeys(value, [
    "operation_id", "label", "runtime_plan_sha256", "event_count", "events",
    "recovery_attempt_count", "switch_receipt_count", "ordered_receipt_sha256",
    "side_effect_closure_sha256", "journal_projection_sha256",
  ], code);
  verifyDigestedObject(value, "journal_projection_sha256", code);
  const expected = [
    ["SIDE_EFFECT_STARTED", "STAGING_DATABASE_CREATE"],
    ["SIDE_EFFECT_RECORDED", "STAGING_DATABASE_CREATE"],
    ["READ_ONLY_PROOF_RECORDED", "POSTGRES_RESTORE_PRECONDITION"],
    ["SIDE_EFFECT_STARTED", "LOGICAL_DUMP_RESTORE"],
    ["SIDE_EFFECT_RECORDED", "LOGICAL_DUMP_RESTORE"],
    ["SIDE_EFFECT_STARTED", "PRIVILEGE_RECONCILE"],
    ["SIDE_EFFECT_RECORDED", "PRIVILEGE_RECONCILE"],
    ["READ_ONLY_PROOF_RECORDED", "POSTGRES_PRE_SWITCH_PROOF"],
    ["SIDE_EFFECT_STARTED", "DATABASE_SWITCH"],
    ["SIDE_EFFECT_RECOVERY_STARTED", "DATABASE_SWITCH"],
    ...(expectedReceipt ? [["SIDE_EFFECT_RECORDED", "DATABASE_SWITCH"]] : []),
  ];
  if (value.operation_id !== base.rollback_operation_id
      || value.label !== "POSTGRESQL_RESTORE"
      || value.runtime_plan_sha256 !== base.runtime_plan_sha256
      || !Array.isArray(value.events) || value.event_count !== value.events.length
      || value.events.length !== expected.length
      || !Array.isArray(value.ordered_receipt_sha256)) reject(code);

  const expectedTarget = {
    staging_oid: stagingProof.staging_database_oid,
    candidate_oid: base.databases.candidate_oid,
    staging_content_proof_sha256: stagingProof.proof_sha256,
    guarded_opcode_spec_sha256: production.opcode_spec_sha256,
    guarded_sql_sha256: production.sql_sha256,
    guarded_state_sha256: production.bindings.guarded_state_sha256,
    expected_switched_identity_sha256:
      production.bindings.expected_switched_identity_sha256,
  };
  const expectedArgv = {
    opcode: production.opcode,
    opcode_spec_sha256: production.opcode_spec_sha256,
    sql_sha256: production.sql_sha256,
    runner_argv_template_sha256: production.argv_template_sha256,
  };
  let previousEvent = ZERO_SHA256;
  let previousRecordedAt = null;
  const receipts = [];
  const intentByName = new Map();
  const receiptByName = new Map();
  let restorePrecondition = null;
  let journalStagingProof = null;
  let recoveryAttempt = null;

  value.events.forEach((item, index) => {
    exactKeys(item, HANDLER_EVENT_FIELDS, code);
    const recoveryPhase = index >= 9;
    const expectedAction = recoveryPhase ? "PROBE" : "EXECUTE";
    const expectedMode = recoveryPhase ? "RECOVERY" : "ORIGINAL";
    if (item.sequence !== index + 1
        || !same([item.event, item.side_effect_name], expected[index])
        || item.schema_version !== 1 || item.contract !== HANDLER_EVENT_CONTRACT
        || item.operation !== "ROLLBACK_EXECUTION"
        || item.operation_id !== base.rollback_operation_id
        || !IDENTIFIER.test(item.operation_id || "")
        || item.execution_mode !== expectedMode || item.action !== expectedAction
        || item.label !== "POSTGRESQL_RESTORE" || !LABEL.test(item.label || "")
        || item.previous_event_sha256 !== previousEvent
        || item.runtime_plan_sha256 !== base.runtime_plan_sha256
        || item.execution_package_sha256 !== base.package_sha256
        || item.source_set_sha256 !== base.source_set_sha256
        || item.transaction_intent_sha256 !== digestValue({
          operation_id: item.operation_id, kind: "transaction",
        }) || item.context_sha256 !== digestValue({
          operation_id: item.operation_id, kind: "context",
        }) || item.record_intent_sha256 !== digestValue({
          operation_id: item.operation_id, kind: "record",
        }) || item.previous_result_sha256 !== ZERO_SHA256
        || item.activation_receipt_sha256 !== digestValue({
          operation_id: item.operation_id, kind: "activation",
        }) || item.request_sha256 !== digestValue({
          operation_id: item.operation_id, action: expectedAction,
        }) || item.idempotency_key !== digestValue({
          contract: "chenyida-erp-uat-promotion-rollback-idempotency-key/v2",
          operation_id: item.operation_id, execution_mode: expectedMode,
          action: expectedAction, label: item.label,
          record_intent_sha256: item.record_intent_sha256,
          runtime_plan_sha256: item.runtime_plan_sha256,
          previous_result_sha256: item.previous_result_sha256,
        }) || !item.payload || typeof item.payload !== "object"
        || Array.isArray(item.payload) || item.payload_sha256 !== digestValue(item.payload)
        || item.event_sha256 !== digestValue(Object.fromEntries(
          Object.entries(item).filter(([key]) => key !== "event_sha256"),
        ))) reject(code);
    strictIso(item.recorded_at, code);
    if (previousRecordedAt !== null && item.recorded_at < previousRecordedAt) reject(code);
    for (const field of [
      "idempotency_key", "request_sha256", "runtime_plan_sha256",
      "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
      "context_sha256", "record_intent_sha256", "activation_receipt_sha256",
      "payload_sha256", "previous_event_sha256", "event_sha256",
    ]) {
      if (!SHA256.test(item[field] || "")) reject(code);
    }
    nonzeroSha(item.side_effect_identity_sha256, code);

    const payload = item.payload;
    let identityField;
    if (item.event === "SIDE_EFFECT_STARTED") identityField = "intent_sha256";
    else if (item.event === "SIDE_EFFECT_RECORDED") identityField = "receipt_sha256";
    else if (item.event === "SIDE_EFFECT_RECOVERY_STARTED") {
      identityField = "recovery_attempt_sha256";
    } else if (item.side_effect_name === "POSTGRES_RESTORE_PRECONDITION") {
      identityField = "restore_precondition_sha256";
    } else identityField = "proof_sha256";
    verifyDigestedObject(payload, identityField, code);
    const expectedEventIdentity = ["SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED"]
      .includes(item.event) ? digestValue(payload) : payload[identityField];
    if (expectedEventIdentity !== item.side_effect_identity_sha256) reject(code);

    if (item.event === "SIDE_EFFECT_STARTED") {
      exactKeys(payload, [
        "schema_version", "contract", "operation_id", "label", "side_effect_name",
        "runtime_plan_sha256", "source_set_sha256", "target_identity_sha256",
        "argv_template_sha256", "started_at", "intent_sha256",
      ], code);
      if (payload.schema_version !== 1 || payload.contract !== SIDE_EFFECT_INTENT_CONTRACT
          || payload.operation_id !== item.operation_id || payload.label !== item.label
          || payload.side_effect_name !== item.side_effect_name
          || payload.runtime_plan_sha256 !== base.runtime_plan_sha256
          || payload.source_set_sha256 !== base.source_set_sha256) reject(code);
      nonzeroSha(payload.target_identity_sha256, code);
      nonzeroSha(payload.argv_template_sha256, code);
      strictIso(payload.started_at, code);
      intentByName.set(item.side_effect_name, payload);
    } else if (item.event === "SIDE_EFFECT_RECORDED") {
      exactKeys(payload, [
        "schema_version", "contract", "status", "operation_id", "label",
        "side_effect_name", "intent_sha256", "before_identity_sha256",
        "after_identity_sha256", "argv_template_sha256", "recovery_observation_sha256",
        "daemon_state", "completed_at", "receipt_sha256",
      ], code);
      const intent = intentByName.get(item.side_effect_name);
      if (!intent || payload.schema_version !== 2
          || payload.contract !== SIDE_EFFECT_RECEIPT_CONTRACT
          || payload.operation_id !== item.operation_id || payload.label !== item.label
          || payload.side_effect_name !== item.side_effect_name
          || payload.intent_sha256 !== intent.intent_sha256
          || payload.argv_template_sha256 !== intent.argv_template_sha256
          || payload.daemon_state !== "COMPLETED_NO_UNTRACKED_PROCESS"
          || payload.completed_at < intent.started_at) reject(code);
      strictIso(payload.completed_at, code);
      nonzeroSha(payload.after_identity_sha256, code);
      if (!SHA256.test(payload.before_identity_sha256 || "")
          || !SHA256.test(payload.recovery_observation_sha256 || "")) reject(code);
      if (item.side_effect_name === "DATABASE_SWITCH") {
        if (payload.status !== "RECOVERED_COMMITTED"
            || payload.recovery_observation_sha256 === ZERO_SHA256) reject(code);
      } else if (payload.status !== "COMMITTED"
          || payload.recovery_observation_sha256 !== ZERO_SHA256) reject(code);
      receipts.push(payload.receipt_sha256);
      receiptByName.set(item.side_effect_name, payload);
    } else if (item.event === "SIDE_EFFECT_RECOVERY_STARTED") {
      exactKeys(payload, [
        "schema_version", "contract", "recovery_kind", "attempt", "operation_id",
        "label", "side_effect_name", "intent_sha256", "target_identity_sha256",
        "argv_template_sha256", "opcode", "opcode_spec_sha256", "sql_sha256",
        "runner_argv_template_sha256", "guarded_state_sha256",
        "opcode_before_observation_sha256", "staging_content_proof_sha256",
        "staging_oid", "candidate_oid", "expected_switched_identity_sha256",
        "recovery_observation_sha256", "recovery_attempt_sha256",
      ], code);
      const intent = intentByName.get("DATABASE_SWITCH");
      if (!intent || payload.schema_version !== 1
          || payload.contract !== SIDE_EFFECT_RECOVERY_CONTRACT
          || payload.recovery_kind !== "EXACT_OLD_GUARDED_DATABASE_SWITCH_REPLAY"
          || payload.attempt !== 1 || payload.operation_id !== item.operation_id
          || payload.label !== item.label || payload.side_effect_name !== "DATABASE_SWITCH"
          || payload.intent_sha256 !== intent.intent_sha256
          || payload.target_identity_sha256 !== intent.target_identity_sha256
          || payload.argv_template_sha256 !== intent.argv_template_sha256
          || payload.opcode !== production.opcode
          || payload.opcode_spec_sha256 !== production.opcode_spec_sha256
          || payload.sql_sha256 !== production.sql_sha256
          || payload.runner_argv_template_sha256 !== production.argv_template_sha256
          || payload.guarded_state_sha256 !== production.bindings.guarded_state_sha256
          || payload.opcode_before_observation_sha256
            !== production.bindings.before_observation_sha256
          || payload.staging_content_proof_sha256 !== stagingProof.proof_sha256
          || payload.staging_oid !== stagingProof.staging_database_oid
          || payload.candidate_oid !== base.databases.candidate_oid
          || payload.expected_switched_identity_sha256
            !== production.bindings.expected_switched_identity_sha256) reject(code);
      nonzeroSha(payload.recovery_observation_sha256, code);
      recoveryAttempt = payload;
    } else if (item.side_effect_name === "POSTGRES_RESTORE_PRECONDITION") {
      restorePrecondition = payload;
    } else {
      journalStagingProof = payload;
    }
    previousEvent = item.event_sha256;
    previousRecordedAt = item.recorded_at;
  });

  const recoveryCount = value.events.filter(
    (item) => item.event === "SIDE_EFFECT_RECOVERY_STARTED"
      && item.side_effect_name === "DATABASE_SWITCH").length;
  const switchReceipt = receiptByName.get("DATABASE_SWITCH") ?? null;
  const switchIntent = intentByName.get("DATABASE_SWITCH") ?? null;
  const createReceipt = receiptByName.get("STAGING_DATABASE_CREATE");
  const restoreReceipt = receiptByName.get("LOGICAL_DUMP_RESTORE");
  const reconcileReceipt = receiptByName.get("PRIVILEGE_RECONCILE");
  if (!switchIntent || !createReceipt || !restoreReceipt || !reconcileReceipt
      || !restorePrecondition || !journalStagingProof
      || restoreReceipt.before_identity_sha256 !== createReceipt.receipt_sha256
      || reconcileReceipt.before_identity_sha256 !== restoreReceipt.receipt_sha256
      || restorePrecondition.binding_sha256 !== createReceipt.receipt_sha256
      || journalStagingProof.binding_sha256 !== reconcileReceipt.receipt_sha256
      || !same(journalStagingProof, stagingProof)
      || switchIntent.target_identity_sha256 !== digestValue(expectedTarget)
      || switchIntent.argv_template_sha256 !== digestValue(expectedArgv)
      || Boolean(recoveryAttempt) !== Boolean(expectedRecovery)
      || (switchReceipt && (
        switchReceipt.before_identity_sha256 !== stagingProof.proof_sha256
        || switchReceipt.after_identity_sha256
          !== production.bindings.expected_switched_identity_sha256
        || switchReceipt.recovery_observation_sha256
          !== recoveryAttempt?.recovery_observation_sha256
      ))) reject(code);
  const closure = expectedReceipt ? digestValue({
    operation_id: value.operation_id, label: value.label,
    runtime_plan_sha256: value.runtime_plan_sha256,
    ordered_receipt_sha256: receipts,
  }) : null;
  if (value.recovery_attempt_count !== recoveryCount || recoveryCount !== expectedRecovery
      || value.switch_receipt_count !== Number(Boolean(switchReceipt))
      || Number(Boolean(switchReceipt)) !== expectedReceipt
      || !same(value.ordered_receipt_sha256, receipts)
      || value.side_effect_closure_sha256 !== closure) reject(code);
  return {
    projection: value, operationId: value.operation_id, switchIntent,
    recoveryAttempt, switchReceipt, createReceipt, restoreReceipt, reconcileReceipt,
    switchReceiptSha256: switchReceipt?.receipt_sha256 ?? null,
    restorePrecondition, closureSha256: closure,
  };
}


function verifyStagingProof(value, selectedCase) {
  const code = "TASK70_V3_STAGING_PROOF_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "binding_sha256", "base_spec_sha256",
    "runtime_plan_sha256", "source_reconciliation_sha256",
    "source_database_report_sha256", "live_database_report_sha256", "migration_head",
    "migration_ledger_file_sha256", "migration_allowlist_sha256", "migration_ledger_sha256",
    "live_security_state_sha256", "staging_allowed_session_role_set_sha256",
    "staging_session_client_policy_sha256", "staging_session_observation_sha256",
    "staging_writer_session_count", "staging_database_identity_sha256",
    "staging_database_name", "staging_database_oid", "staging_database_marker",
    "system_identifier", "staging_allow_connections", "staging_connection_limit",
    "staging_default_transaction_read_only", "staging_prepared_xacts",
    "candidate_database_name", "candidate_database_oid", "candidate_database_marker",
    "candidate_database_allow_connections", "candidate_database_connection_limit",
    "candidate_database_sessions", "candidate_database_prepared_xacts",
    "before_observation_sha256", "after_observation_sha256", "proof_sha256",
  ], code);
  verifyDigestedObject(value, "proof_sha256", code);
  const base = selectedCase.fixture.base_spec;
  const expectedSessionObservation = digestValue({
    database: base.databases.staging_name, allowed_clients: {}, sessions: [], total: 0,
  });
  if (value.schema_version !== 1
      || value.contract !== "chenyida-erp-uat-rollback-postgresql-staging-content-proof/v1"
      || value.base_spec_sha256 !== base.base_spec_sha256
      || value.runtime_plan_sha256 !== base.runtime_plan_sha256
      || value.source_reconciliation_sha256 !== base.snapshot.source_reconciliation_sha256
      || value.migration_head !== selectedCase.fixture.migration.head
      || value.migration_ledger_file_sha256 !== selectedCase.fixture.migration.ledger_file_sha256
      || value.migration_allowlist_sha256 !== selectedCase.fixture.migration.allowlist_sha256
      || value.migration_ledger_sha256 !== selectedCase.fixture.migration.ledger_sha256
      || value.source_database_report_sha256 !== selectedCase.fixture.content_report.sha256
      || value.live_database_report_sha256 !== selectedCase.fixture.content_report.sha256
      || value.live_security_state_sha256 !== selectedCase.fixture.security_state_sha256
      || value.staging_allowed_session_role_set_sha256 !== digestValue([])
      || value.staging_session_client_policy_sha256 !== digestValue({})
      || value.staging_session_observation_sha256 !== expectedSessionObservation
      || value.staging_database_oid !== selectedCase.fixture.restored_oid
      || value.candidate_database_oid !== base.databases.candidate_oid
      || value.staging_database_name !== base.databases.staging_name
      || value.staging_database_marker !== base.databases.staging_marker
      || value.system_identifier !== base.postgres.system_identifier
      || value.staging_database_identity_sha256 !== digestValue({
        name: value.staging_database_name, system_identifier: value.system_identifier,
        oid: value.staging_database_oid, marker: value.staging_database_marker,
      }) || value.candidate_database_name !== base.databases.active_name
      || value.candidate_database_marker !== base.databases.candidate_marker
      || value.staging_writer_session_count !== 0 || value.staging_allow_connections !== true
      || value.staging_connection_limit !== 0
      || value.staging_default_transaction_read_only !== true
      || value.staging_prepared_xacts !== 0
      || value.candidate_database_allow_connections !== false
      || value.candidate_database_connection_limit !== 0
      || value.candidate_database_sessions !== 0
      || value.candidate_database_prepared_xacts !== 0
      || value.before_observation_sha256 === value.after_observation_sha256
      || value.staging_database_oid === value.candidate_database_oid) reject(code);
  for (const field of [
    "binding_sha256", "base_spec_sha256", "runtime_plan_sha256",
    "source_reconciliation_sha256", "source_database_report_sha256",
    "live_database_report_sha256", "migration_ledger_file_sha256",
    "migration_allowlist_sha256", "migration_ledger_sha256", "live_security_state_sha256",
    "staging_allowed_session_role_set_sha256", "staging_session_client_policy_sha256",
    "staging_session_observation_sha256", "staging_database_identity_sha256",
    "before_observation_sha256", "after_observation_sha256", "proof_sha256",
  ]) nonzeroSha(value[field], code);
  return value;
}


function verifyTerminalEvidence(value, selectedCase, production, journal) {
  const code = "TASK70_V3_TERMINAL_EVIDENCE_INVALID";
  const required = [
    "strategy", "source_artifact_sha256", "source_artifact_bytes",
    "source_reconciliation_sha256", "target_content_sha256", "snapshot_database_oid",
    "restored_database_oid", "restored_database_name", "system_identifier", "migration_head",
    "restored_database_marker", "staging_database_name",
    "candidate_database_quarantine_name", "candidate_database_quarantine_oid",
    "runtime_plan_sha256", "manifest_sha256", "migration_ledger_file_sha256",
    "migration_manifest_sha256", "writer_containment_stage_result_sha256",
    "postgres_container_id", "postgres_image_config_digest", "database_profile_sha256",
    "postgres_base_spec_sha256", "staging_create_receipt_sha256", "restore_receipt_sha256",
    "privilege_reconcile_receipt_sha256", "restore_precondition_opcode_spec_sha256",
    "restore_precondition_sha256", "dump_inventory_sha256", "empty_projection_sha256",
    "restore_precondition", "pre_switch_content_proof_sha256", "pre_switch_content_proof",
    "runtime_privilege_access_sha256", "runtime_privilege_catalog_sha256",
    "runtime_privilege_catalog_artifact_sha256", "runtime_privilege_policy_sha256",
    "runtime_privilege_operator_policy_sha256", "uat_reconciliation_authority_sha256",
    "uat_reconciliation_activation_sha256", "sealed_security_projection_sha256",
    "staging_database_marker", "candidate_database_quarantine_marker",
    "guarded_switch_opcode_spec_sha256", "guarded_switch_sql_sha256",
    "guarded_switch_runner_argv_template_sha256", "guarded_switch_state_sha256",
    "guarded_switch_expected_identity_sha256", "switch_receipt_sha256",
    "switch_effect_identity_sha256", "switch_receipt",
    "restored_database_allow_connections_at_commit",
    "restored_database_connection_limit_at_commit", "restored_database_sessions_at_commit",
    "restored_database_prepared_xacts_at_commit",
    "candidate_database_quarantine_allow_connections_at_commit",
    "candidate_database_quarantine_connection_limit_at_commit",
    "candidate_database_quarantine_sessions_at_commit",
    "candidate_database_quarantine_prepared_xacts_at_commit",
  ];
  exactKeys(value, required, code);
  const receipt = value.switch_receipt;
  exactKeys(receipt, [
    "schema_version", "contract", "status", "operation_id", "label", "side_effect_name",
    "intent_sha256", "before_identity_sha256", "after_identity_sha256",
    "argv_template_sha256", "recovery_observation_sha256", "daemon_state",
    "completed_at", "receipt_sha256",
  ], code);
  verifyDigestedObject(receipt, "receipt_sha256", code);
  strictIso(receipt.completed_at, code);
  const base = selectedCase.fixture.base_spec;
  const intent = journal.switchIntent;
  const recovery = journal.recoveryAttempt;
  const restoreProof = value.restore_precondition;
  exactKeys(restoreProof, [
    "schema_version", "contract", "base_spec_sha256", "opcode_spec_sha256",
    "binding_sha256", "create_receipt_sha256", "dump_inventory_sha256",
    "system_identifier", "server_version_num", "database", "database_identity_sha256",
    "profile", "profile_sha256", "empty_projection", "empty_projection_sha256",
    "raw_observation_sha256", "restore_precondition_sha256",
  ], code);
  verifyDigestedObject(restoreProof, "restore_precondition_sha256", code);
  exactKeys(restoreProof.database, [
    "name", "oid", "marker", "owner", "allow_connections", "connection_limit",
    "default_transaction_read_only", "sessions", "prepared_xacts",
  ], code);
  exactKeys(restoreProof.profile, [
    "encoding", "locale_provider", "collate", "ctype", "collation_version",
    "default_tablespace",
  ], code);
  const emptyProjection = {
    user_schema_count: 0, relation_count: 0, sequence_count: 0, routine_count: 0,
    standalone_type_count: 0, unexpected_extension_count: 0, large_object_count: 0,
    schema_migrations_present: false,
  };
  const expectedDumpInventory = digestValue({
    case_id: "DV70-PG-GUARDED-SWITCH-02",
    fixture_class: "SYNTHETIC_POSTGRES_DUMP_INVENTORY",
    dump_sha256: base.snapshot.dump_sha256, dump_bytes: base.snapshot.dump_bytes,
  });
  if (!intent || !recovery || !journal.switchReceipt
      || !same(receipt, journal.switchReceipt)
      || receipt.schema_version !== 2 || receipt.contract !== SIDE_EFFECT_RECEIPT_CONTRACT
      || receipt.operation_id !== base.rollback_operation_id
      || receipt.intent_sha256 !== intent.intent_sha256
      || receipt.argv_template_sha256 !== intent.argv_template_sha256
      || receipt.completed_at < intent.started_at
      || receipt.recovery_observation_sha256 !== recovery.recovery_observation_sha256
      || receipt.after_identity_sha256
        !== production.bindings.expected_switched_identity_sha256
      || restoreProof.schema_version !== 1
      || restoreProof.contract
        !== "chenyida-erp-uat-rollback-postgresql-restore-precondition/v1"
      || restoreProof.base_spec_sha256 !== base.base_spec_sha256
      || restoreProof.binding_sha256 !== journal.createReceipt.receipt_sha256
      || restoreProof.create_receipt_sha256 !== journal.createReceipt.receipt_sha256
      || restoreProof.dump_inventory_sha256 !== expectedDumpInventory
      || restoreProof.system_identifier !== base.postgres.system_identifier
      || restoreProof.server_version_num !== base.postgres.server_version_num
      || !same(restoreProof.database, {
        name: base.databases.staging_name, oid: selectedCase.fixture.restored_oid,
        marker: base.databases.staging_marker, owner: base.postgres.control_database_role,
        allow_connections: true, connection_limit: 0,
        default_transaction_read_only: true, sessions: 0, prepared_xacts: 0,
      }) || !same(restoreProof.profile, Object.fromEntries(
        Object.entries(base.profile).filter(([key]) => key !== "profile_sha256"),
      )) || restoreProof.database_identity_sha256 !== digestValue({
        system_identifier: restoreProof.system_identifier, ...restoreProof.database,
      }) || restoreProof.profile_sha256 !== digestValue(restoreProof.profile)
      || !same(restoreProof.empty_projection, emptyProjection)
      || restoreProof.empty_projection_sha256 !== digestValue(emptyProjection)) reject(code);
  nonzeroSha(restoreProof.opcode_spec_sha256, code);
  nonzeroSha(restoreProof.raw_observation_sha256, code);
  if (value.strategy
        !== "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED"
      || value.target_content_sha256 !== selectedCase.fixture.content_report.sha256
      || value.source_artifact_sha256 !== base.snapshot.dump_sha256
      || value.source_artifact_bytes !== base.snapshot.dump_bytes
      || value.source_reconciliation_sha256 !== base.snapshot.source_reconciliation_sha256
      || value.snapshot_database_oid !== base.databases.candidate_oid
      || value.restored_database_oid !== selectedCase.fixture.restored_oid
      || value.restored_database_marker !== base.databases.candidate_marker
      || value.migration_head !== selectedCase.fixture.migration.head
      || value.migration_ledger_file_sha256 !== selectedCase.fixture.migration.ledger_file_sha256
      || value.migration_manifest_sha256 !== selectedCase.fixture.migration.allowlist_sha256
      || value.postgres_container_id !== selectedCase.fixture.base_spec.postgres.container_id
      || value.postgres_image_config_digest
        !== selectedCase.fixture.base_spec.postgres.image_digest
      || value.postgres_base_spec_sha256 !== selectedCase.fixture.base_spec.base_spec_sha256
      || value.manifest_sha256 !== base.snapshot.snapshot_manifest_sha256
      || value.writer_containment_stage_result_sha256 !== digestValue({
        case_id: "DV70-PG-GUARDED-SWITCH-02", stage: "WRITER_CONTAINMENT",
      }) || value.database_profile_sha256 !== base.profile.profile_sha256
      || value.runtime_plan_sha256 !== base.runtime_plan_sha256
      || value.system_identifier !== base.postgres.system_identifier
      || value.restored_database_name !== base.databases.active_name
      || value.staging_database_name !== base.databases.staging_name
      || value.candidate_database_quarantine_name !== base.databases.quarantine_name
      || value.candidate_database_quarantine_oid !== base.databases.candidate_oid
      || value.candidate_database_quarantine_marker !== base.databases.quarantine_marker
      || value.staging_database_marker !== base.databases.staging_marker
      || value.staging_create_receipt_sha256 !== journal.createReceipt.receipt_sha256
      || value.restore_receipt_sha256 !== journal.restoreReceipt.receipt_sha256
      || value.privilege_reconcile_receipt_sha256
        !== journal.reconcileReceipt.receipt_sha256
      || value.restore_precondition_opcode_spec_sha256 !== restoreProof.opcode_spec_sha256
      || value.restore_precondition_sha256 !== restoreProof.restore_precondition_sha256
      || value.dump_inventory_sha256 !== restoreProof.dump_inventory_sha256
      || value.empty_projection_sha256 !== restoreProof.empty_projection_sha256
      || !same(value.restore_precondition, journal.restorePrecondition)
      || value.pre_switch_content_proof_sha256 !== selectedCase.fixture.staging_proof.proof_sha256
      || !same(value.pre_switch_content_proof, selectedCase.fixture.staging_proof)
      || value.guarded_switch_opcode_spec_sha256 !== production.opcode_spec_sha256
      || value.guarded_switch_sql_sha256 !== production.sql_sha256
      || value.guarded_switch_runner_argv_template_sha256 !== production.argv_template_sha256
      || value.guarded_switch_state_sha256 !== production.bindings.guarded_state_sha256
      || value.guarded_switch_expected_identity_sha256
        !== production.bindings.expected_switched_identity_sha256
      || value.runtime_privilege_access_sha256 !== base.security.access_sha256
      || value.runtime_privilege_catalog_sha256 !== base.security.catalog_sha256
      || value.runtime_privilege_catalog_artifact_sha256
        !== base.security.catalog_artifact_sha256
      || value.runtime_privilege_policy_sha256 !== base.security.policy_sha256
      || value.runtime_privilege_operator_policy_sha256
        !== base.security.operator_policy_sha256
      || value.uat_reconciliation_authority_sha256 !== base.authority.authority_sha256
      || value.uat_reconciliation_activation_sha256
        !== selectedCase.fixture.authority_activation_sha256
      || value.sealed_security_projection_sha256 !== digestValue(base.security)
      || value.switch_receipt_sha256 !== receipt.receipt_sha256
      || value.switch_effect_identity_sha256 !== receipt.after_identity_sha256
      || receipt.status !== "RECOVERED_COMMITTED" || receipt.label !== "POSTGRESQL_RESTORE"
      || receipt.side_effect_name !== "DATABASE_SWITCH"
      || receipt.before_identity_sha256 !== selectedCase.fixture.staging_proof.proof_sha256
      || receipt.recovery_observation_sha256 === ZERO_SHA256
      || receipt.daemon_state !== "COMPLETED_NO_UNTRACKED_PROCESS"
      || value.restored_database_allow_connections_at_commit !== false
      || value.restored_database_connection_limit_at_commit !== 0
      || value.restored_database_sessions_at_commit !== 0
      || value.restored_database_prepared_xacts_at_commit !== 0
      || value.candidate_database_quarantine_allow_connections_at_commit !== false
      || value.candidate_database_quarantine_connection_limit_at_commit !== 0
      || value.candidate_database_quarantine_sessions_at_commit !== 0
      || value.candidate_database_quarantine_prepared_xacts_at_commit !== 0) reject(code);
  for (const field of required.filter((item) => item.endsWith("_sha256"))) {
    nonzeroSha(value[field], code);
  }
  positiveInteger(value.source_artifact_bytes, code);
  return value;
}


function migrationProjection(sourceBodies, policy) {
  const records = policy.source_paths.filter((path) =>
    /^chenyida_erp_site\/drizzle-postgres\/\d{4}_[a-z0-9_]+\.sql$/.test(path)).map(
    (path) => ({
      path, version: path.split("/").at(-1),
      checksum: digestBytes(sourceBodies.get(path)), raw: sourceBodies.get(path),
    }),
  );
  const ledger = Buffer.from(records.map((item) => `${item.checksum}  ${item.version}\n`).join(""));
  const allowlist = records.map((item, index) => ({
    ordinal: index + 1, filename: item.version, sha256: item.checksum,
  }));
  return {
    count: records.length, head: records.at(-1).version,
    ledger_file_sha256: digestBytes(ledger),
    allowlist_sha256: digestBytes(Buffer.from(`${JSON.stringify(allowlist)}\n`)),
    ledger_sha256: digestValue(records.map(({ version, checksum }) => ({ version, checksum }))),
    records,
  };
}


const RUNTIME_PRIVILEGE_ACL_PRIVILEGES = Object.freeze({
  DATABASE: Object.freeze(["CONNECT", "CREATE", "TEMPORARY"]),
  SCHEMA: Object.freeze(["CREATE", "USAGE"]),
  TABLE: Object.freeze([
    "DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER",
    "TRUNCATE", "UPDATE",
  ]),
  SEQUENCE: Object.freeze(["SELECT", "UPDATE", "USAGE"]),
  ROUTINE: Object.freeze(["EXECUTE"]),
  TYPE: Object.freeze(["USAGE"]),
  TABLESPACE: Object.freeze(["CREATE"]),
  LARGE_OBJECT: Object.freeze(["SELECT", "UPDATE"]),
});


function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}


function deriveExpectedRuntimePrivilegeState({ access, catalogDocument, policy }, base, oid) {
  const code = "TASK70_V3_CASE_INVALID";
  const catalog = catalogDocument.catalog;
  const targetName = base.databases.staging_name;
  const ownerKey = (kind, identity) => `${kind}\u0000${identity}`;
  const owners = new Map();
  const addOwner = (kind, identity, owner) => {
    const key = ownerKey(kind, identity);
    if (owners.has(key)) reject(code);
    owners.set(key, owner);
  };
  addOwner("DATABASE", targetName, policy.database.owner);
  addOwner("SCHEMA", policy.schema.name, policy.schema.owner);
  for (const [kind, field] of [
    ["TABLE", "tables"], ["SEQUENCE", "sequences"],
    ["ROUTINE", "routines"], ["TYPE", "standalone_types"],
  ]) {
    for (const item of catalog[field]) {
      const identity = ["TABLE", "SEQUENCE"].includes(kind)
        ? `public.${item.name}` : item.identity;
      const owner = item.owner === "MIGRATION_OWNER"
        ? policy.identities.migration_owner : item.owner;
      addOwner(kind, identity, owner);
    }
  }
  for (const tablespace of policy.tablespaces.built_in) {
    addOwner("TABLESPACE", tablespace, "PLATFORM_OWNER");
  }

  const acl = [];
  const addAcl = (kind, identity, owner, grantee, privilegeType) => {
    acl.push({
      kind, identity, owner, grantor: owner, grantee,
      privilege_type: privilegeType, is_grantable: false,
    });
  };
  const catalogByKind = {
    TABLE: new Map(catalog.tables.map((item) => [item.name, item])),
    SEQUENCE: new Map(catalog.sequences.map((item) => [item.name, item])),
    ROUTINE: new Map(catalog.routines.map((item) => [item.identity, item])),
  };
  for (const service of ["ADMIN", "BACKUP", "WEB", "WORKER"]) {
    const binding = policy.service_bindings[service];
    if (binding.access_service !== service || binding.direct_login_acl !== false) reject(code);
    addAcl("DATABASE", targetName, policy.database.owner,
      binding.privilege_group, "CONNECT");
    addAcl("SCHEMA", policy.schema.name, policy.schema.owner,
      binding.privilege_group, "USAGE");
    const serviceAccess = access.services[service];
    for (const [privilege, names] of Object.entries(serviceAccess.table_privileges)) {
      for (const name of names) {
        if (!catalogByKind.TABLE.has(name)) reject(code);
        const identity = `public.${name}`;
        addAcl("TABLE", identity, owners.get(ownerKey("TABLE", identity)),
          binding.privilege_group, privilege);
      }
    }
    for (const [privilege, names] of Object.entries(serviceAccess.sequence_privileges)) {
      for (const name of names) {
        if (!catalogByKind.SEQUENCE.has(name)) reject(code);
        const identity = `public.${name}`;
        addAcl("SEQUENCE", identity, owners.get(ownerKey("SEQUENCE", identity)),
          binding.privilege_group, privilege);
      }
    }
    const routineExecute = serviceAccess.routine_execute;
    for (const identity of [
      ...routineExecute.APPLICATION, ...routineExecute.EXTENSION,
    ]) {
      if (!catalogByKind.ROUTINE.has(identity)) reject(code);
      addAcl("ROUTINE", identity, owners.get(ownerKey("ROUTINE", identity)),
        binding.privilege_group, "EXECUTE");
    }
  }
  const aclFields = ["kind", "identity", "grantee", "privilege_type", "grantor"];
  acl.sort((left, right) => {
    for (const field of aclFields) {
      const compared = compareUtf8(left[field], right[field]);
      if (compared !== 0) return compared;
    }
    return 0;
  });
  const aclKeys = acl.map((item) => aclFields.map((field) => item[field]).join("\u0000"));
  if (new Set(aclKeys).size !== aclKeys.length) reject(code);
  const counts = Object.fromEntries(Object.keys(RUNTIME_PRIVILEGE_ACL_PRIVILEGES).map(
    (kind) => [kind.toLowerCase(), acl.filter((item) => item.kind === kind).length],
  ));
  counts.total = acl.length;
  const coverage = Object.fromEntries(["TABLE", "SEQUENCE", "ROUTINE"].map(
    (kind) => [kind.toLowerCase(), new Set(
      acl.filter((item) => item.kind === kind).map((item) => item.identity),
    ).size],
  ));
  if (!same(counts, policy.acl_summary.tuple_counts)
      || !same(coverage, policy.acl_summary.object_coverage)) reject(code);

  const grantees = new Map();
  for (const item of acl) {
    const key = ownerKey(item.kind, item.identity);
    if (!grantees.has(key)) grantees.set(key, new Set());
    grantees.get(key).add(item.grantee);
  }
  const storage = [...owners.entries()].map(([key, owner]) => {
    const [kind, identity] = key.split("\u0000");
    return {
      kind, identity, owner, acl_state: "EXPLICIT",
      acl_item_count: 1 + (grantees.get(key)?.size ?? 0),
      owner_privileges: RUNTIME_PRIVILEGE_ACL_PRIVILEGES[kind].map(
        (privilegeType) => ({ privilege_type: privilegeType, is_grantable: false }),
      ),
    };
  }).sort((left, right) => compareUtf8(left.kind, right.kind)
    || compareUtf8(left.identity, right.identity));
  const defaultScopes = policy.default_privileges
    .filter((item) => ["ROUTINE", "TYPE"].includes(item.object_kind))
    .map((item) => ({
      owner: item.owner, schema: item.schema === null ? "ALL" : item.schema,
      object_kind: item.object_kind,
    })).sort((left, right) => compareUtf8(left.owner, right.owner)
      || compareUtf8(left.schema, right.schema)
      || compareUtf8(left.object_kind, right.object_kind));
  const roles = policy.roles.map((role) => ({
    name: role.name, superuser: role.superuser, inherit: role.inherit,
    create_role: role.create_role, create_database: role.create_database,
    can_login: role.intended_login, replication: role.replication,
    connection_limit: role.connection_limit, valid_until: role.valid_until,
    bypass_rls: role.bypass_rls,
  })).sort((left, right) => compareUtf8(left.name, right.name));
  return {
    schema_version: 2,
    contract: "chenyida-erp-postgresql-runtime-privilege-state/v2",
    target: {
      database_oid: oid,
      system_identifier_sha256: digestBytes(Buffer.from(
        base.postgres.system_identifier, "utf8",
      )),
      marker_sha256: digestBytes(Buffer.from(base.databases.staging_marker, "utf8")),
    },
    engine: {
      server_version_num: base.postgres.server_version_num,
      encoding: base.profile.encoding, locale_provider: base.profile.locale_provider,
      collate: base.profile.collate, ctype: base.profile.ctype,
      collation_version: base.profile.collation_version,
    },
    database: {
      name: targetName, owner: policy.database.owner,
      allow_connect: policy.database.allow_connect, connection_limit: 0,
      default_tablespace: policy.database.default_tablespace,
    },
    schema: { name: policy.schema.name, owner: policy.schema.owner },
    roles,
    memberships: policy.memberships.map((item) => ({ ...item })),
    role_settings: [{
      role_scope: "ALL", database_scope: targetName,
      settings: ["default_transaction_read_only=on"],
    }],
    object_acl: acl,
    object_acl_storage: storage,
    column_acl: [],
    column_acl_object_count: 0,
    default_privilege_scopes: defaultScopes,
    default_privileges: [],
    default_privilege_row_count: 2,
    parameter_acl: [],
    parameter_acl_row_count: 0,
    custom_tablespaces: [],
    custom_tablespace_count: 0,
    large_object_count: 0,
  };
}


function verifyLayoutEvidence(observation, classification, {
  base, restoredOid, expectedRows, expectedLayout, expectedStateSha256,
}) {
  const code = "TASK70_V3_SCENARIO_INVALID";
  exactKeys(observation, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "system_identifier", "server_version_num", "databases", "observed_at",
    "observation_sha256",
  ], code);
  verifyDigestedObject(observation, "observation_sha256", code);
  strictIso(observation.observed_at, code);
  if (!Array.isArray(observation.databases)
      || observation.databases.length !== Object.keys(expectedRows).length) reject(code);
  for (const row of observation.databases) exactKeys(row, [
    "name", "oid", "marker", "allow_connections", "connection_limit",
    "default_transaction_read_only", "sessions", "prepared_xacts",
  ], code);
  const byName = Object.fromEntries(observation.databases.map((row) => [row.name, row]));
  exactKeys(classification, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "observation_sha256", "restored_oid", "layout", "state_projection_sha256",
    "safe_to_recover_switch_receipt", "safe_to_recover_unseal_receipt",
    "classification_sha256",
  ], code);
  verifyDigestedObject(classification, "classification_sha256", code);
  const stableState = digestValue({
    base_spec_sha256: base.base_spec_sha256,
    runtime_plan_sha256: base.runtime_plan_sha256,
    system_identifier: base.postgres.system_identifier,
    restored_oid: restoredOid,
    databases: observation.databases.map((row) => ({
      name: row.name, oid: row.oid, marker: row.marker,
      allow_connections: row.allow_connections, connection_limit: row.connection_limit,
      default_transaction_read_only: row.default_transaction_read_only,
      prepared_xacts: row.prepared_xacts,
    })).sort((left, right) => compareUtf8(left.name, right.name)),
  });
  if (observation.schema_version !== 1
      || observation.contract
        !== "chenyida-erp-uat-rollback-postgresql-state-observation/v1"
      || observation.runtime_plan_sha256 !== base.runtime_plan_sha256
      || observation.base_spec_sha256 !== base.base_spec_sha256
      || observation.system_identifier !== base.postgres.system_identifier
      || observation.server_version_num !== base.postgres.server_version_num
      || !same(byName, expectedRows)
      || classification.schema_version !== 1
      || classification.contract
        !== "chenyida-erp-uat-rollback-postgresql-layout-classification/v1"
      || classification.runtime_plan_sha256 !== base.runtime_plan_sha256
      || classification.base_spec_sha256 !== base.base_spec_sha256
      || classification.observation_sha256 !== observation.observation_sha256
      || classification.restored_oid !== restoredOid
      || classification.layout !== expectedLayout
      || classification.state_projection_sha256 !== stableState
      || classification.state_projection_sha256 !== expectedStateSha256
      || classification.safe_to_recover_switch_receipt !== (expectedLayout === "NEW_SEALED")
      || classification.safe_to_recover_unseal_receipt !== (expectedLayout === "NEW_RELEASED")) {
    reject(code);
  }
  return { observation, classification };
}


function verifyCase(selectedCase, policy, { runtime, before, after, cleanup, sourceBodies }) {
  const code = "TASK70_V3_CASE_INVALID";
  exactKeys(selectedCase, [
    "case_id", "evidence_class", "stage_id", "stage_coverage", "result", "fixture",
    "opcodes", "journal_evidence", "scenarios", "assertions", "case_evidence_sha256",
  ], code);
  verifyDigestedObject(selectedCase, "case_evidence_sha256", code);
  const policyCase = policy.case_catalog[0];
  if (selectedCase.case_id !== policyCase.case_id
      || selectedCase.evidence_class !== policyCase.evidence_class
      || selectedCase.stage_id !== policyCase.stage_id
      || selectedCase.stage_coverage !== "PARTIAL" || selectedCase.result !== "PASS") reject(code);
  const fixture = selectedCase.fixture;
  exactKeys(fixture, [
    "fixture_class", "base_spec", "restored_oid", "management_identity", "setup_receipt",
    "target_guards", "migration", "content_report", "authority_activation_sha256",
    "content_report_raw_base64", "security_state", "security_state_sha256",
    "staging_proof", "reset_receipts",
  ], code);
  if (fixture.fixture_class !== "FULL_46_REPOSITORY_MIGRATIONS_EMPTY_SYNTHETIC_DATA"
      || !OID.test(fixture.restored_oid || "")) {
    reject(code);
  }
  nonzeroSha(fixture.authority_activation_sha256, code);
  nonzeroSha(fixture.security_state_sha256, code);
  const base = fixture.base_spec;
  exactKeys(base, [
    "schema_version", "contract", "environment", "deployment_id", "promotion_id",
    "promotion_generation", "rollback_operation_id", "runtime_plan_sha256",
    "source_set_sha256", "package_sha256", "postgres", "databases", "snapshot", "profile",
    "security", "authority", "runtime_limits", "base_spec_sha256",
  ], code);
  verifyDigestedObject(base, "base_spec_sha256", code);
  if (base.schema_version !== 1
      || base.contract !== "chenyida-erp-uat-rollback-postgresql-base-spec/v2"
      || base.environment !== "UAT" || base.deployment_id !== "chenyida-erp"
      || base.postgres.container_id !== runtime.container_inspect.container_id
      || base.postgres.image_reference !== runtime.postgres_image_reference
      || base.postgres.image_digest !== runtime.postgres_image_before.id
      || base.databases.candidate_oid === fixture.restored_oid) reject(code);
  exactKeys(base.postgres, [
    "container_id", "image_reference", "image_digest", "control_os_user",
    "control_database_role", "management_database", "system_identifier",
    "server_version_num", "server_major", "listen_addresses",
  ], code);
  exactKeys(base.databases, [
    "active_name", "candidate_oid", "candidate_marker", "staging_name",
    "staging_marker", "quarantine_name", "quarantine_marker",
  ], code);
  exactKeys(base.snapshot, [
    "dump_sha256", "dump_bytes", "database_bytes", "snapshot_manifest_sha256",
    "source_reconciliation_sha256", "target_database_report_sha256",
    "migration_head", "migration_ledger_file_sha256", "migration_allowlist_sha256",
  ], code);
  exactKeys(base.profile, [
    "encoding", "locale_provider", "collate", "ctype", "collation_version",
    "default_tablespace", "profile_sha256",
  ], code);
  exactKeys(base.authority, [
    "authority_id", "authority_sha256", "approved_at", "expires_at", "one_time",
    "mutation_scope_sha256",
  ], code);
  exactKeys(base.runtime_limits, [
    "preflight_seconds", "recheck_seconds", "prepare_seconds", "execute_seconds",
    "probe_seconds", "contain_seconds", "sql_max_bytes", "output_max_bytes",
  ], code);
  const expectedRuntimeLimits = {
    preflight_seconds: 120, recheck_seconds: 120, prepare_seconds: 120,
    execute_seconds: 1800, probe_seconds: 300, contain_seconds: 300,
    sql_max_bytes: 1024 * 1024, output_max_bytes: 4 * 1024 * 1024,
  };
  const expectedAuthorityScope = {
    active_database: "chenyida_erp",
    staging_database: "chenyida_erp_rb_deadbeefdeadbeef",
    candidate_quarantine_database: "chenyida_erp_candidate_deadbeefdeadbeef",
    database_local_only: true, allow_staging_database_create: true,
    allow_staging_logical_restore: true, allow_staging_privilege_reconcile: true,
    allow_atomic_database_switch: true, allow_active_database_unseal: true,
    allow_role_create: false, allow_role_alter: false,
    allow_membership_change: false, allow_password_change: false,
    allow_tablespace_acl_change: false,
  };
  if (!same(base.runtime_limits, expectedRuntimeLimits)
      || base.rollback_operation_id !== "rollback-runner-deadbeef"
      || base.databases.active_name !== "chenyida_erp"
      || base.databases.staging_name !== "chenyida_erp_rb_deadbeefdeadbeef"
      || base.databases.quarantine_name !== "chenyida_erp_candidate_deadbeefdeadbeef"
      || base.databases.candidate_marker
        !== policy.required_target_guard.executor_fixture_candidate_marker
      || base.databases.staging_marker
        !== "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING"
      || base.databases.quarantine_marker
        !== "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:CANDIDATE_QUARANTINE"
      || new Set([
        base.databases.active_name, base.databases.staging_name,
        base.databases.quarantine_name,
      ]).size !== 3
      || base.authority.authority_id !== "authority-deadbeef"
      || base.authority.approved_at !== "2026-08-16T01:00:00.000Z"
      || base.authority.expires_at !== "2026-08-16T03:00:00.000Z"
      || base.authority.one_time !== true
      || base.authority.mutation_scope_sha256 !== digestValue(expectedAuthorityScope)) reject(code);
  nonzeroSha(base.authority.authority_sha256, code);
  const securityKeys = [
    "access_file_sha256", "access_sha256", "catalog_file_sha256", "catalog_sha256",
    "catalog_artifact_sha256", "policy_file_sha256", "policy_sha256",
    "operator_file_sha256", "operator_policy_sha256", "runtime_privilege_policy_sha256",
    "database_owner", "schema_name", "schema_owner", "roles_projection_sha256",
    "memberships_projection_sha256", "ownership_projection_sha256",
    "acl_projection_sha256", "default_acl_projection_sha256",
    "unsupported_projection_sha256",
  ];
  exactKeys(base.security, securityKeys, code);
  for (const field of securityKeys.filter((field) => field.endsWith("_sha256"))) {
    nonzeroSha(base.security[field], code);
  }
  const sourceDocument = (path) => {
    const raw = sourceBodies.get(path);
    if (!Buffer.isBuffer(raw)) reject(code);
    return { raw, value: parseStrictJson(raw, code) };
  };
  const access = sourceDocument(
    "chenyida_erp_site/operations/postgresql-runtime-privilege-access-v2.json",
  );
  const catalog = sourceDocument(
    "chenyida_erp_site/operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
  );
  const privilegePolicy = sourceDocument(
    "chenyida_erp_site/operations/postgresql-runtime-privilege-policy-v2.json",
  );
  const operatorPolicy = sourceDocument(
    "chenyida_erp_site/operations/postgresql-runtime-privilege-operator-policy-v1.json",
  );
  const withoutField = (value, field) => Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
  const expectedProfile = {
    encoding: catalog.value.engine_binding.encoding,
    locale_provider: catalog.value.engine_binding.locale_provider,
    collate: catalog.value.engine_binding.collate,
    ctype: catalog.value.engine_binding.ctype,
    collation_version: catalog.value.engine_binding.collation_version,
    default_tablespace: privilegePolicy.value.database.default_tablespace,
  };
  const expectedOwnershipProjection = Object.fromEntries([
    "schema", "schema_owner", "tables", "sequences", "routines", "standalone_types",
  ].map((field) => [field, catalog.value.catalog[field]]));
  const expectedAclProjection = {
    access_catalog: access.value.catalog,
    services: access.value.services,
    service_bindings: privilegePolicy.value.service_bindings,
    acl_summary: privilegePolicy.value.acl_summary,
  };
  const expectedUnsupportedProjection = {
    catalog: catalog.value.catalog.unsupported,
    constraints: privilegePolicy.value.object_constraints,
    tablespaces: privilegePolicy.value.tablespaces,
  };
  if (base.security.access_file_sha256 !== digestBytes(access.raw)
      || base.security.catalog_file_sha256 !== digestBytes(catalog.raw)
      || base.security.policy_file_sha256 !== digestBytes(privilegePolicy.raw)
      || base.security.operator_file_sha256 !== digestBytes(operatorPolicy.raw)
      || base.security.access_sha256 !== access.value.access_sha256
      || access.value.access_sha256
        !== digestCompactValue(withoutField(access.value, "access_sha256"))
      || base.security.catalog_sha256 !== catalog.value.catalog_sha256
      || catalog.value.catalog_sha256 !== digestValue(catalog.value.catalog)
      || base.security.catalog_artifact_sha256 !== catalog.value.artifact_sha256
      || catalog.value.artifact_sha256
        !== digestValue(withoutField(catalog.value, "artifact_sha256"))
      || base.security.policy_sha256 !== privilegePolicy.value.policy_sha256
      || privilegePolicy.value.policy_sha256
        !== digestValue(withoutField(privilegePolicy.value, "policy_sha256"))
      || base.security.operator_policy_sha256 !== operatorPolicy.value.policy_sha256
      || operatorPolicy.value.policy_sha256
        !== digestValue(withoutField(operatorPolicy.value, "policy_sha256"))
      || base.security.runtime_privilege_policy_sha256
        !== operatorPolicy.value.runtime_privilege_policy_sha256
      || operatorPolicy.value.runtime_privilege_policy_sha256
        !== privilegePolicy.value.policy_sha256
      || base.security.database_owner !== privilegePolicy.value.database.owner
      || base.security.schema_name !== privilegePolicy.value.schema.name
      || base.security.schema_owner !== privilegePolicy.value.schema.owner
      || base.security.roles_projection_sha256
        !== digestValue(privilegePolicy.value.roles)
      || base.security.memberships_projection_sha256
        !== digestValue(privilegePolicy.value.memberships)
      || base.security.ownership_projection_sha256
        !== digestValue(expectedOwnershipProjection)
      || base.security.acl_projection_sha256 !== digestValue(expectedAclProjection)
      || base.security.default_acl_projection_sha256
        !== digestValue(privilegePolicy.value.default_privileges)
      || base.security.unsupported_projection_sha256
        !== digestValue(expectedUnsupportedProjection)
      || !same(withoutField(base.profile, "profile_sha256"), expectedProfile)
      || base.profile.profile_sha256 !== digestValue(expectedProfile)
      || base.postgres.control_os_user !== "999:999"
      || base.postgres.control_database_role !== "postgres"
      || base.postgres.management_database !== "postgres"
      || base.postgres.server_major !== "17"
      || base.postgres.server_version_num
        !== catalog.value.engine_binding.server_version_num
      || base.postgres.listen_addresses !== "*") reject(code);

  const securityState = fixture.security_state;
  exactKeys(securityState, [
    "schema_version", "contract", "target", "engine", "database", "schema", "roles",
    "memberships", "role_settings", "object_acl", "object_acl_storage", "column_acl",
    "column_acl_object_count", "default_privilege_scopes", "default_privileges",
    "default_privilege_row_count", "parameter_acl", "parameter_acl_row_count",
    "custom_tablespaces", "custom_tablespace_count", "large_object_count",
  ], code);
  const expectedSecurityState = deriveExpectedRuntimePrivilegeState({
    access: access.value, catalogDocument: catalog.value,
    policy: privilegePolicy.value,
  }, base, fixture.restored_oid);
  if (securityState.schema_version !== 2
      || securityState.contract !== "chenyida-erp-postgresql-runtime-privilege-state/v2"
      || digestValue(securityState) !== fixture.security_state_sha256
      || !same(securityState, expectedSecurityState)
      || securityState.roles.length !== 9 || securityState.memberships.length !== 4
      || new Set(securityState.roles.map((item) => item.name)).size !== 9) reject(code);
  exactKeys(fixture.management_identity, [
    "system_identifier", "server_version_num", "listen_addresses", "encoding", "collate",
    "ctype", "locale_provider", "collation_version", "active_oid", "staging_oid",
  ], code);
  if (fixture.management_identity.active_oid !== base.databases.candidate_oid
      || fixture.management_identity.staging_oid !== fixture.restored_oid
      || fixture.management_identity.system_identifier !== base.postgres.system_identifier
      || fixture.management_identity.server_version_num !== base.postgres.server_version_num
      || fixture.management_identity.listen_addresses !== base.postgres.listen_addresses
      || fixture.management_identity.encoding !== base.profile.encoding
      || fixture.management_identity.locale_provider !== base.profile.locale_provider
      || fixture.management_identity.collate !== base.profile.collate
      || fixture.management_identity.ctype !== base.profile.ctype
      || fixture.management_identity.collation_version
        !== base.profile.collation_version) reject(code);
  if (!Array.isArray(fixture.reset_receipts) || fixture.reset_receipts.length !== 2
      || !Array.isArray(fixture.target_guards) || fixture.target_guards.length !== 2) reject(code);
  const psqlSpec = (phase, overrides = {}) => ({
    phase, containerId: base.postgres.container_id, database: "postgres",
    username: "postgres", writeOverride: false, variables: {}, verbosity: "terse",
    timeoutSeconds: 300, maximumOutputBytes: 32 * 1024 * 1024,
    exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), ...overrides,
  });
  validatePsqlCommandReceipt(fixture.setup_receipt, psqlSpec("cluster_setup", {
    sql: setupClusterSql(policy, privilegePolicy.value, code),
  }), code);
  const resetSql = resetLayoutSql(base, fixture.restored_oid, code);
  for (const [index, phase] of [
    "reset_after_success", "reset_after_recovery",
  ].entries()) {
    validatePsqlCommandReceipt(
      fixture.reset_receipts[index], psqlSpec(phase, { sql: resetSql }), code,
    );
  }
  for (const guard of fixture.target_guards) {
    exactKeys(guard, [
      "system_identifier", "server_version_num", "listen_addresses", "management_database",
      "management_comment", "guard_matches", "guard_receipt_sha256",
    ], code);
    verifyDigestedObject(guard, "guard_receipt_sha256", code);
    if (guard.system_identifier !== base.postgres.system_identifier
        || guard.server_version_num !== "170010" || guard.listen_addresses !== "*"
        || guard.management_database !== policy.required_target_guard.management_database
        || guard.management_comment
          !== policy.required_target_guard.management_database_comment
        || guard.guard_matches !== true) reject(code);
  }
  exactKeys(fixture.migration, [
    "count", "head", "ledger_file_sha256", "allowlist_sha256", "ledger_sha256",
    "ordered_apply_receipts", "apply_receipt_set_sha256",
  ], code);
  const expectedMigration = migrationProjection(sourceBodies, policy);
  if (fixture.migration.count !== expectedMigration.count
      || fixture.migration.head !== expectedMigration.head
      || fixture.migration.ledger_file_sha256 !== expectedMigration.ledger_file_sha256
      || fixture.migration.allowlist_sha256 !== expectedMigration.allowlist_sha256
      || fixture.migration.ledger_sha256 !== expectedMigration.ledger_sha256
      || fixture.migration.apply_receipt_set_sha256
        !== digestValue(fixture.migration.ordered_apply_receipts)
      || base.snapshot.migration_head !== fixture.migration.head
      || base.snapshot.migration_ledger_file_sha256 !== fixture.migration.ledger_file_sha256
      || base.snapshot.migration_allowlist_sha256 !== fixture.migration.allowlist_sha256) reject(code);
  if (!Array.isArray(fixture.migration.ordered_apply_receipts)
      || fixture.migration.ordered_apply_receipts.length !== expectedMigration.records.length + 2) {
    reject(code);
  }
  const verifySqlReceipt = (receipt, phase, sql, overrides = {}) => (
    validatePsqlCommandReceipt(receipt, psqlSpec(phase, { sql, ...overrides }), code)
  );
  for (const [index, record] of expectedMigration.records.entries()) {
    const item = fixture.migration.ordered_apply_receipts[index];
    exactKeys(item, ["kind", "version", "checksum", "execution_receipt"], code);
    if (item.kind !== "MIGRATION" || item.version !== record.version
        || item.checksum !== record.checksum) reject(code);
    const source = Buffer.from(record.raw.toString("utf8").replaceAll(
      "--> statement-breakpoint", "",
    ), "utf8");
    verifySqlReceipt(
      item.execution_receipt, `migration_${String(index + 1).padStart(4, "0")}`,
      Buffer.concat([
        Buffer.from("BEGIN;\nSET LOCAL client_min_messages=warning;\n", "utf8"),
        source, Buffer.from("\nCOMMIT;\n", "utf8"),
      ]), {
        database: base.databases.staging_name,
        username: policy.migration_fixture.apply_owner,
        writeOverride: true,
      },
    );
  }
  const ledgerItem = fixture.migration.ordered_apply_receipts.at(-2);
  exactKeys(ledgerItem, ["kind", "execution_receipt"], code);
  if (ledgerItem.kind !== "LEDGER") reject(code);
  const ledgerValues = expectedMigration.records.map(
    (record) => `('${record.version}','${record.checksum}')`,
  ).join(",\n");
  verifySqlReceipt(ledgerItem.execution_receipt, "migration_ledger", Buffer.from(
    `BEGIN;\nCREATE TABLE public.schema_migrations (\n`
      + `  version text PRIMARY KEY,\n`
      + `  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$')\n);\n`
      + `ALTER TABLE public.schema_migrations OWNER TO chenyida_erp_owner;\n`
      + `INSERT INTO public.schema_migrations(version,checksum) VALUES\n`
      + `${ledgerValues};\nCOMMIT;\n`, "utf8",
  ), {
    database: base.databases.staging_name,
    username: policy.migration_fixture.apply_owner,
    writeOverride: true,
  });
  const sealItem = fixture.migration.ordered_apply_receipts.at(-1);
  exactKeys(sealItem, ["kind", "execution_receipt"], code);
  if (sealItem.kind !== "SEAL") reject(code);
  verifySqlReceipt(sealItem.execution_receipt, "seal_staging", Buffer.from(
    `ALTER DATABASE "${base.databases.staging_name}" CONNECTION LIMIT 0;\n`
      + `ALTER DATABASE "${base.databases.staging_name}" SET `
      + `default_transaction_read_only TO on;\n`, "utf8",
  ));
  exactKeys(fixture.content_report, ["bytes", "sha256", "rows", "report_set_sha256"], code);
  positiveInteger(fixture.content_report.bytes, code);
  positiveInteger(fixture.content_report.rows, code);
  nonzeroSha(fixture.content_report.sha256, code);
  nonzeroSha(fixture.content_report.report_set_sha256, code);
  if (base.snapshot.target_database_report_sha256 !== fixture.content_report.sha256) reject(code);
  if (typeof fixture.content_report_raw_base64 !== "string"
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        fixture.content_report_raw_base64,
      )) reject(code);
  const contentReportRaw = Buffer.from(fixture.content_report_raw_base64, "base64");
  if (contentReportRaw.toString("base64") !== fixture.content_report_raw_base64
      || contentReportRaw.length !== fixture.content_report.bytes
      || contentReportRaw.length < 2 || contentReportRaw.length > 32 * 1024 * 1024
      || contentReportRaw.at(-1) !== 0x0a || contentReportRaw.includes(0x00)
      || contentReportRaw.includes(0x0d)
      || digestBytes(contentReportRaw) !== fixture.content_report.sha256) reject(code);
  let contentReportText;
  try {
    contentReportText = new TextDecoder("utf-8", { fatal: true }).decode(
      contentReportRaw.subarray(0, -1),
    );
  } catch {
    reject(code);
  }
  const contentReportRows = contentReportText.split("\n").map((line) => line.split("\t"));
  const reportIdentities = new Set();
  let largeObjectRows = 0;
  for (const fields of contentReportRows) {
    const [kind] = fields;
    const hexIdentifier = /^(?:[0-9a-f]{2}){1,4096}$/;
    let valid = false;
    if (kind === "RELATION" && fields.length === 4) {
      valid = hexIdentifier.test(fields[1]) && /^[0-9]+$/.test(fields[2])
        && SHA256.test(fields[3]);
    } else if (kind === "SEQUENCE" && fields.length === 4) {
      valid = hexIdentifier.test(fields[1]) && /^-?[0-9]+$/.test(fields[2])
        && ["true", "false", "t", "f"].includes(fields[3]);
    } else if (kind === "EXTENSION" && fields.length === 4) {
      valid = fields.slice(1).every((field) => hexIdentifier.test(field));
    } else if (kind === "LARGE_OBJECTS" && fields.length === 4) {
      largeObjectRows += 1;
      valid = /^[0-9]+$/.test(fields[1]) && /^[0-9]+$/.test(fields[2])
        && SHA256.test(fields[3]) && largeObjectRows === 1;
    }
    const identity = `${kind}:${fields[1]}`;
    if (!valid || reportIdentities.has(identity)) reject(code);
    reportIdentities.add(identity);
  }
  if (largeObjectRows !== 1 || contentReportRows.length !== fixture.content_report.rows
      || digestValue([...reportIdentities].sort())
        !== fixture.content_report.report_set_sha256) reject(code);
  verifyStagingProof(fixture.staging_proof, selectedCase);

  exactKeys(selectedCase.opcodes, [
    "reconciliation", "production", "reconciliation_sql_evidence",
    "production_sql_evidence", "production_sql_bytes", "production_sql_embedded",
  ], code);
  const commonOpcodeKeys = [
    "schema_version", "contract", "opcode", "base_spec_sha256", "database", "phase",
    "timeout_seconds", "effectful", "bindings", "sql_sha256", "argv_template_sha256",
    "opcode_spec_sha256",
  ];
  const reconciliationEvidence = selectedCase.opcodes.reconciliation;
  exactKeys(reconciliationEvidence, [
    "opcode", "ack", "observation", "classification", "restored_oid",
    "execution_receipt",
  ], code);
  const reconciliation = reconciliationEvidence.opcode;
  const production = selectedCase.opcodes.production;
  const sqlNormalizationRoots = {
    base,
    fixture: {
      restored_oid: fixture.restored_oid, security_state: fixture.security_state,
      content_report_rows: contentReportRows,
    },
    opcodes: { reconciliation, production },
    source_documents: {
      access: access.value, catalog: catalog.value, operator: operatorPolicy.value,
      policy: privilegePolicy.value,
    },
    migration_records: expectedMigration.records.map(
      ({ version, checksum }) => ({ version, checksum }),
    ),
  };
  const reconciliationSql = verifyCompressedSqlEvidence(
    selectedCase.opcodes.reconciliation_sql_evidence, sqlNormalizationRoots,
    policy.sql_evidence.reconciliation_normalized_sha256,
    policy.sql_evidence.maximum_uncompressed_bytes,
  );
  const productionSql = verifyCompressedSqlEvidence(
    selectedCase.opcodes.production_sql_evidence, sqlNormalizationRoots,
    policy.sql_evidence.production_normalized_sha256,
    policy.sql_evidence.maximum_uncompressed_bytes,
  );
  exactKeys(reconciliation, commonOpcodeKeys, code);
  exactKeys(production, commonOpcodeKeys, code);
  verifyDigestedObject(reconciliation, "opcode_spec_sha256", code);
  verifyDigestedObject(production, "opcode_spec_sha256", code);
  exactKeys(reconciliation.bindings, [
    "restore_receipt_sha256", "staging_oid", "baseline_security_sha256",
    "authority_activation_sha256", "desired_sealed_security_sha256",
  ], code);
  const reconciliationExecution = validateFixedExecutionReceipt(
    reconciliationEvidence.execution_receipt,
    { base, opcode: reconciliation, sql: reconciliationSql, sequence: 1 }, code,
  );
  const reconciliationAck = verifyMutationAck(
    reconciliationEvidence.ack, "PG_RB_RECONCILE_PRIVILEGES_V1",
    reconciliationExecution,
  );
  const reconciliationObservation = reconciliationEvidence.observation;
  exactKeys(reconciliationObservation, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "system_identifier", "server_version_num", "databases", "observed_at",
    "observation_sha256",
  ], code);
  verifyDigestedObject(reconciliationObservation, "observation_sha256", code);
  strictIso(reconciliationObservation.observed_at, code);
  if (!Array.isArray(reconciliationObservation.databases)
      || reconciliationObservation.databases.length !== 2) reject(code);
  for (const row of reconciliationObservation.databases) exactKeys(row, [
    "name", "oid", "marker", "allow_connections", "connection_limit",
    "default_transaction_read_only", "sessions", "prepared_xacts",
  ], code);
  const reconciliationByName = Object.fromEntries(
    reconciliationObservation.databases.map((row) => [row.name, row]),
  );
  const expectedReconciliationRows = {
    [base.databases.active_name]: {
      name: base.databases.active_name, oid: base.databases.candidate_oid,
      marker: base.databases.candidate_marker, allow_connections: false,
      connection_limit: 0, default_transaction_read_only: true,
      sessions: 0, prepared_xacts: 0,
    },
    [base.databases.staging_name]: {
      name: base.databases.staging_name, oid: fixture.restored_oid,
      marker: base.databases.staging_marker, allow_connections: true,
      connection_limit: 0, default_transaction_read_only: true,
      sessions: 0, prepared_xacts: 0,
    },
  };
  const reconciliationClassification = reconciliationEvidence.classification;
  exactKeys(reconciliationClassification, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "observation_sha256", "restored_oid", "layout", "state_projection_sha256",
    "safe_to_recover_switch_receipt", "safe_to_recover_unseal_receipt",
    "classification_sha256",
  ], code);
  verifyDigestedObject(reconciliationClassification, "classification_sha256", code);
  const stableLayoutStateSha256 = (rows) => digestValue({
    base_spec_sha256: base.base_spec_sha256,
    runtime_plan_sha256: base.runtime_plan_sha256,
    system_identifier: base.postgres.system_identifier,
    restored_oid: fixture.restored_oid,
    databases: rows.map((row) => ({
      name: row.name, oid: row.oid, marker: row.marker,
      allow_connections: row.allow_connections, connection_limit: row.connection_limit,
      default_transaction_read_only: row.default_transaction_read_only,
      prepared_xacts: row.prepared_xacts,
    })).sort((left, right) => compareUtf8(left.name, right.name)),
  });
  const expectedReconciliationState = stableLayoutStateSha256(
    Object.values(expectedReconciliationRows),
  );
  const expectedNewState = stableLayoutStateSha256([{
    name: base.databases.active_name, oid: fixture.restored_oid,
    marker: base.databases.candidate_marker, allow_connections: false,
    connection_limit: 0, default_transaction_read_only: true,
    prepared_xacts: 0,
  }, {
    name: base.databases.quarantine_name, oid: base.databases.candidate_oid,
    marker: base.databases.quarantine_marker, allow_connections: false,
    connection_limit: 0, default_transaction_read_only: true,
    prepared_xacts: 0,
  }]);
  exactKeys(production.bindings, [
    "privilege_receipt_sha256", "staging_oid", "before_observation_sha256",
    "staging_content_proof_sha256", "expected_switched_identity_sha256",
    "source_reconciliation_sha256", "expected_content_report_sha256",
    "migration_ledger_file_sha256", "migration_allowlist_sha256",
    "expected_security_state_sha256", "guarded_state_sha256",
  ], code);
  const guardedSource = {
    source_reconciliation_sha256: base.snapshot.source_reconciliation_sha256,
    expected_content_report_sha256: fixture.content_report.sha256,
    migration_ledger_file_sha256: fixture.migration.ledger_file_sha256,
    migration_allowlist_sha256: fixture.migration.allowlist_sha256,
    expected_security_state_sha256: fixture.security_state_sha256,
  };
  const expectedIdentity = digestValue({
    active_name: base.databases.active_name, active_oid: fixture.restored_oid,
    quarantine_name: base.databases.quarantine_name,
    quarantine_oid: base.databases.candidate_oid, state: "NEW_SEALED",
  });
  if (reconciliationEvidence.restored_oid !== fixture.restored_oid
      || reconciliation.schema_version !== 1
      || reconciliation.contract
        !== "chenyida-erp-uat-rollback-postgresql-reconcile-opcode-spec/v2"
      || reconciliation.opcode !== "PG_RB_RECONCILE_PRIVILEGES_V1"
      || reconciliation.base_spec_sha256 !== base.base_spec_sha256
      || reconciliation.database !== base.databases.staging_name
      || reconciliation.phase !== "reconcile" || reconciliation.timeout_seconds !== 300
      || reconciliation.effectful !== true
      || reconciliation.bindings.staging_oid !== fixture.restored_oid
      || reconciliation.bindings.baseline_security_sha256 !== digestValue({
        security: base.security, phase: "BEFORE_RECONCILIATION",
      }) || reconciliation.bindings.authority_activation_sha256
        !== fixture.authority_activation_sha256
      || reconciliation.bindings.desired_sealed_security_sha256 !== digestValue(base.security)
      || reconciliation.argv_template_sha256 !== digestValue([
        "DOCKER_EXEC_POSTGRES_PSQL_V1", base.postgres.container_id,
        base.databases.staging_name, "reconcile", "SESSION_READ_WRITE_OVERRIDE_FIXED",
      ]) || !SHA256.test(reconciliation.sql_sha256 || "")
      || reconciliationAck.opcode !== reconciliation.opcode
      || reconciliationObservation.runtime_plan_sha256 !== base.runtime_plan_sha256
      || reconciliationObservation.base_spec_sha256 !== base.base_spec_sha256
      || reconciliationObservation.system_identifier !== base.postgres.system_identifier
      || reconciliationObservation.server_version_num !== base.postgres.server_version_num
      || !same(reconciliationByName, expectedReconciliationRows)
      || reconciliationClassification.schema_version !== 1
      || reconciliationClassification.contract
        !== "chenyida-erp-uat-rollback-postgresql-layout-classification/v1"
      || reconciliationClassification.runtime_plan_sha256 !== base.runtime_plan_sha256
      || reconciliationClassification.base_spec_sha256 !== base.base_spec_sha256
      || reconciliationClassification.observation_sha256
        !== reconciliationObservation.observation_sha256
      || reconciliationClassification.restored_oid !== fixture.restored_oid
      || reconciliationClassification.layout !== "OLD"
      || reconciliationClassification.state_projection_sha256 !== expectedReconciliationState
      || reconciliationClassification.safe_to_recover_switch_receipt !== false
      || reconciliationClassification.safe_to_recover_unseal_receipt !== false
      || production.schema_version !== 1
      || production.contract
        !== "chenyida-erp-uat-rollback-postgresql-guarded-switch-opcode-spec/v2"
      || production.opcode !== "PG_RB_GUARDED_SWITCH_V3"
      || production.base_spec_sha256 !== base.base_spec_sha256
      || production.database !== base.databases.staging_name
      || production.phase !== "guardedswitch" || production.timeout_seconds !== 300
      || production.effectful !== true || production.bindings.staging_oid !== fixture.restored_oid
      || production.bindings.before_observation_sha256
        !== fixture.staging_proof.after_observation_sha256
      || production.bindings.staging_content_proof_sha256 !== fixture.staging_proof.proof_sha256
      || production.bindings.privilege_receipt_sha256 !== fixture.staging_proof.binding_sha256
      || production.bindings.expected_switched_identity_sha256 !== expectedIdentity
      || Object.entries(guardedSource).some(([key, child]) => production.bindings[key] !== child)
      || production.bindings.guarded_state_sha256 !== digestValue({
        ...guardedSource, staging_content_proof_sha256: fixture.staging_proof.proof_sha256,
        staging_oid: fixture.restored_oid,
      }) || !SHA256.test(production.sql_sha256 || "")
      || reconciliation.sql_sha256 !== digestBytes(reconciliationSql)
      || production.sql_sha256 !== digestBytes(productionSql)
      || !SHA256.test(production.argv_template_sha256 || "")
      || selectedCase.opcodes.production_sql_embedded !== true
      || !Number.isSafeInteger(selectedCase.opcodes.production_sql_bytes)
      || selectedCase.opcodes.production_sql_bytes !== productionSql.length
      || selectedCase.opcodes.production_sql_bytes > base.runtime_limits.sql_max_bytes) reject(code);
  const firstRename = Buffer.from(
    `ALTER DATABASE "${base.databases.active_name}" RENAME TO `
      + `"${base.databases.quarantine_name}";\n`, "utf8",
  );
  const secondRename = Buffer.from(
    `ALTER DATABASE "${base.databases.staging_name}" RENAME TO `
      + `"${base.databases.active_name}";\n`, "utf8",
  );
  const firstRenameOffset = productionSql.indexOf(firstRename);
  const secondRenameOffset = productionSql.indexOf(secondRename);
  const connectOffset = productionSql.indexOf(Buffer.from("\\connect postgres\n", "utf8"));
  if (firstRenameOffset < 1 || secondRenameOffset <= firstRenameOffset
      || connectOffset < 1 || connectOffset >= firstRenameOffset
      || productionSql.indexOf(firstRename, firstRenameOffset + 1) !== -1
      || productionSql.indexOf(secondRename, secondRenameOffset + 1) !== -1
      || reconciliationSql.includes(Buffer.from(" RENAME TO ", "utf8"))) reject(code);
  const faultBoundary = firstRenameOffset + firstRename.length;
  const expectedFaultSql = Buffer.concat([
    productionSql.subarray(0, faultBoundary),
    Buffer.from("SELECT 'DV70_V3_FIRST_RENAME_REACHED'::text;\n", "utf8"),
  ]);

  exactKeys(selectedCase.journal_evidence, [
    "recovery", "recovery_attempt_unknown", "commit_response_loss",
  ], code);
  const journalBindings = { base, production, stagingProof: fixture.staging_proof };
  const recoveryJournal = verifyJournal(
    selectedCase.journal_evidence.recovery, 1, 1, journalBindings,
  );
  const unknownJournal = verifyJournal(
    selectedCase.journal_evidence.recovery_attempt_unknown, 1, 0, journalBindings,
  );
  const commitJournal = verifyJournal(
    selectedCase.journal_evidence.commit_response_loss, 1, 1, journalBindings,
  );
  const journalSet = [recoveryJournal, unknownJournal, commitJournal];
  const expectedReconcileAfter = digestValue({
    opcode_spec_sha256: reconciliation.opcode_spec_sha256,
    ack_sha256: reconciliationAck.ack_sha256,
    observation_sha256: reconciliationObservation.observation_sha256,
  });
  if (journalSet.some((journal) =>
    reconciliation.bindings.restore_receipt_sha256
      !== journal.restoreReceipt.receipt_sha256
    || journal.reconcileReceipt.after_identity_sha256 !== expectedReconcileAfter
    || journal.reconcileReceipt.receipt_sha256 !== fixture.staging_proof.binding_sha256
    || !same(journal.restoreReceipt, recoveryJournal.restoreReceipt)
    || !same(journal.reconcileReceipt, recoveryJournal.reconcileReceipt))) reject(code);

  const scenarios = selectedCase.scenarios;
  if (!Array.isArray(scenarios)
      || !same(scenarios.map((item) => item.scenario_id), policyCase.required_scenarios)) {
    reject("TASK70_V3_SCENARIO_INVALID");
  }
  for (const item of scenarios) verifyDigestedObject(
    item, "scenario_sha256", "TASK70_V3_SCENARIO_INVALID",
  );
  const by = Object.fromEntries(scenarios.map((item) => [item.scenario_id, item]));
  exactKeys(by.EXACT_V3_SUCCESS, [
    "scenario_id", "before_layout", "after_layout", "before_state_sha256",
    "after_state_sha256", "command", "execution_receipt", "mutation_ack",
    "mutation_ack_sha256",
    "scenario_sha256",
  ], code);
  const successExecution = validateFixedExecutionReceipt(
    by.EXACT_V3_SUCCESS.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 2 }, code,
  );
  const successAck = verifyMutationAck(
    by.EXACT_V3_SUCCESS.mutation_ack, production.opcode, successExecution,
  );
  verifyCommand(
    by.EXACT_V3_SUCCESS.command, production, successAck, successExecution, 1, true,
  );
  const oldStateSha256 = nonzeroSha(by.EXACT_V3_SUCCESS.before_state_sha256, code);
  const newStateSha256 = nonzeroSha(by.EXACT_V3_SUCCESS.after_state_sha256, code);
  if (by.EXACT_V3_SUCCESS.before_layout !== "OLD"
      || by.EXACT_V3_SUCCESS.after_layout !== "NEW_SEALED"
      || oldStateSha256 !== expectedReconciliationState
      || newStateSha256 !== expectedNewState
      || oldStateSha256 === newStateSha256
      || by.EXACT_V3_SUCCESS.mutation_ack_sha256 !== successAck.ack_sha256) reject(code);
  exactKeys(by.REPEAT_FAIL_CLOSED, [
    "scenario_id", "before_layout", "after_layout", "failure_code", "state_unchanged",
    "failure_reason", "execution_receipt", "before_state_sha256",
    "after_state_sha256", "scenario_sha256",
  ], code);
  validateGuardedFailureExecution(
    by.REPEAT_FAIL_CLOSED.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 3 },
    "TARGET_DATABASE_MISSING", code,
  );
  if (by.REPEAT_FAIL_CLOSED.before_layout !== "NEW_SEALED"
      || by.REPEAT_FAIL_CLOSED.after_layout !== "NEW_SEALED"
      || by.REPEAT_FAIL_CLOSED.failure_code !== "SIDE_EFFECT_OUTCOME_UNKNOWN"
      || by.REPEAT_FAIL_CLOSED.failure_reason !== "TARGET_DATABASE_MISSING"
      || by.REPEAT_FAIL_CLOSED.state_unchanged !== true
      || by.REPEAT_FAIL_CLOSED.before_state_sha256 !== newStateSha256
      || by.REPEAT_FAIL_CLOSED.before_state_sha256 !== by.REPEAT_FAIL_CLOSED.after_state_sha256) {
    reject(code);
  }
  exactKeys(by.CONTENT_DRIFT_REJECTED, [
    "scenario_id", "failure_code", "failure_reason", "execution_receipt",
    "after_layout", "drift_apply_receipt", "drift_restore_receipt",
    "restored_report_sha256", "after_state_sha256", "scenario_sha256",
  ], code);
  exactKeys(by.MIGRATION_LEDGER_DRIFT_REJECTED, [
    "scenario_id", "failure_code", "failure_reason", "execution_receipt",
    "after_layout", "drift_apply_receipt", "drift_restore_receipt",
    "ledger_file_sha256", "after_state_sha256", "scenario_sha256",
  ], code);
  exactKeys(by.SECURITY_DRIFT_REJECTED, [
    "scenario_id", "failure_code", "failure_reason", "execution_receipt",
    "after_layout", "drift_apply_receipt", "security_restore",
    "security_restore_sql_evidence",
    "restored_security_state_sha256", "after_state_sha256", "scenario_sha256",
  ], code);
  for (const id of [
    "CONTENT_DRIFT_REJECTED", "MIGRATION_LEDGER_DRIFT_REJECTED",
    "SECURITY_DRIFT_REJECTED",
  ]) {
    if (by[id].scenario_id !== id
        || by[id].failure_code !== "SIDE_EFFECT_OUTCOME_UNKNOWN"
        || by[id].after_layout !== "OLD" || by[id].after_state_sha256 !== oldStateSha256) {
      reject(code);
    }
  }
  validateGuardedFailureExecution(
    by.CONTENT_DRIFT_REJECTED.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 4 },
    "CONTENT_GUARD_RELATION_MISMATCH", code,
  );
  validateGuardedFailureExecution(
    by.MIGRATION_LEDGER_DRIFT_REJECTED.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 5 },
    "CONTENT_GUARD_RELATION_MISMATCH", code,
  );
  validateGuardedFailureExecution(
    by.SECURITY_DRIFT_REJECTED.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 6 },
    "RUNTIME_PRIVILEGE_MISMATCH", code,
  );
  if (by.CONTENT_DRIFT_REJECTED.failure_reason
        !== "CONTENT_GUARD_RELATION_MISMATCH"
      || by.MIGRATION_LEDGER_DRIFT_REJECTED.failure_reason
        !== "CONTENT_GUARD_RELATION_MISMATCH"
      || by.SECURITY_DRIFT_REJECTED.failure_reason
        !== "RUNTIME_PRIVILEGE_MISMATCH") reject(code);
  verifySqlReceipt(
    by.CONTENT_DRIFT_REJECTED.drift_apply_receipt, "content_drift_apply",
    Buffer.from(
      "INSERT INTO public.app_meta(key,value) "
        + "VALUES ('dv70_v3_content_drift','synthetic-only');\n", "utf8",
    ), { database: base.databases.staging_name, writeOverride: true },
  );
  verifySqlReceipt(
    by.CONTENT_DRIFT_REJECTED.drift_restore_receipt, "content_drift_restore",
    Buffer.from("DELETE FROM public.app_meta WHERE key='dv70_v3_content_drift';\n", "utf8"),
    { database: base.databases.staging_name, writeOverride: true },
  );
  const originalChecksum = expectedMigration.records[0].checksum;
  const driftChecksum = originalChecksum !== ZERO_SHA256 ? ZERO_SHA256 : "1".repeat(64);
  const firstVersion = expectedMigration.records[0].version;
  verifySqlReceipt(
    by.MIGRATION_LEDGER_DRIFT_REJECTED.drift_apply_receipt, "migration_drift_apply",
    Buffer.from(
      `UPDATE public.schema_migrations SET checksum='${driftChecksum}' `
        + `WHERE version='${firstVersion}';\n`, "utf8",
    ), { database: base.databases.staging_name, writeOverride: true },
  );
  verifySqlReceipt(
    by.MIGRATION_LEDGER_DRIFT_REJECTED.drift_restore_receipt, "migration_drift_restore",
    Buffer.from(
      `UPDATE public.schema_migrations SET checksum='${originalChecksum}' `
        + `WHERE version='${firstVersion}';\n`, "utf8",
    ), { database: base.databases.staging_name, writeOverride: true },
  );
  const securityApplyReceipt = verifySqlReceipt(
    by.SECURITY_DRIFT_REJECTED.drift_apply_receipt, "security_drift_apply",
    Buffer.from("REVOKE SELECT ON public.app_users FROM chenyida_erp_web_priv;\n", "utf8"),
    { database: base.databases.staging_name, writeOverride: true },
  );
  const securityRestore = by.SECURITY_DRIFT_REJECTED.security_restore;
  exactKeys(securityRestore, [
    "opcode", "ack", "observation", "classification", "restored_oid",
    "execution_receipt",
  ], code);
  const securityRestoreOpcode = securityRestore.opcode;
  exactKeys(securityRestoreOpcode, commonOpcodeKeys, code);
  verifyDigestedObject(securityRestoreOpcode, "opcode_spec_sha256", code);
  exactKeys(securityRestoreOpcode.bindings, [
    "restore_receipt_sha256", "staging_oid", "baseline_security_sha256",
    "authority_activation_sha256", "desired_sealed_security_sha256",
  ], code);
  const expectedSecurityRestoreBindings = {
    restore_receipt_sha256: digestValue({
      case_id: policyCase.case_id, phase: "SECURITY_DRIFT_RESTORE",
      apply_receipt_sha256: securityApplyReceipt.receipt_sha256,
    }),
    staging_oid: fixture.restored_oid,
    baseline_security_sha256: digestValue({
      security: base.security, phase: "BEFORE_RECONCILIATION",
    }),
    authority_activation_sha256: fixture.authority_activation_sha256,
    desired_sealed_security_sha256: digestValue(base.security),
  };
  const securityRestoreRoots = {
    ...sqlNormalizationRoots,
    opcodes: { reconciliation: securityRestoreOpcode, production },
  };
  const securityRestoreSql = verifyCompressedSqlEvidence(
    by.SECURITY_DRIFT_REJECTED.security_restore_sql_evidence,
    securityRestoreRoots, policy.sql_evidence.reconciliation_normalized_sha256,
    policy.sql_evidence.maximum_uncompressed_bytes,
  );
  const securityRestoreExecution = validateFixedExecutionReceipt(
    securityRestore.execution_receipt,
    { base, opcode: securityRestoreOpcode, sql: securityRestoreSql, sequence: 7 }, code,
  );
  const securityRestoreAck = verifyMutationAck(
    securityRestore.ack, "PG_RB_RECONCILE_PRIVILEGES_V1",
    securityRestoreExecution,
  );
  const securityRestoreObservation = securityRestore.observation;
  exactKeys(securityRestoreObservation, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "system_identifier", "server_version_num", "databases", "observed_at",
    "observation_sha256",
  ], code);
  verifyDigestedObject(securityRestoreObservation, "observation_sha256", code);
  strictIso(securityRestoreObservation.observed_at, code);
  if (!Array.isArray(securityRestoreObservation.databases)
      || securityRestoreObservation.databases.length !== 2) reject(code);
  for (const row of securityRestoreObservation.databases) exactKeys(row, [
    "name", "oid", "marker", "allow_connections", "connection_limit",
    "default_transaction_read_only", "sessions", "prepared_xacts",
  ], code);
  const securityRestoreByName = Object.fromEntries(
    securityRestoreObservation.databases.map((row) => [row.name, row]),
  );
  const securityRestoreClassification = securityRestore.classification;
  exactKeys(securityRestoreClassification, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "observation_sha256", "restored_oid", "layout", "state_projection_sha256",
    "safe_to_recover_switch_receipt", "safe_to_recover_unseal_receipt",
    "classification_sha256",
  ], code);
  verifyDigestedObject(
    securityRestoreClassification, "classification_sha256", code,
  );
  if (securityRestore.restored_oid !== fixture.restored_oid
      || securityRestoreOpcode.schema_version !== 1
      || securityRestoreOpcode.contract
        !== "chenyida-erp-uat-rollback-postgresql-reconcile-opcode-spec/v2"
      || securityRestoreOpcode.opcode !== "PG_RB_RECONCILE_PRIVILEGES_V1"
      || securityRestoreOpcode.base_spec_sha256 !== base.base_spec_sha256
      || securityRestoreOpcode.database !== base.databases.staging_name
      || securityRestoreOpcode.phase !== "reconcile"
      || securityRestoreOpcode.timeout_seconds !== 300
      || securityRestoreOpcode.effectful !== true
      || !same(securityRestoreOpcode.bindings, expectedSecurityRestoreBindings)
      || securityRestoreOpcode.sql_sha256 !== digestBytes(securityRestoreSql)
      || securityRestoreOpcode.argv_template_sha256 !== digestValue([
        "DOCKER_EXEC_POSTGRES_PSQL_V1", base.postgres.container_id,
        base.databases.staging_name, "reconcile", "SESSION_READ_WRITE_OVERRIDE_FIXED",
      ])
      || securityRestoreAck.opcode !== securityRestoreOpcode.opcode
      || securityRestoreObservation.runtime_plan_sha256 !== base.runtime_plan_sha256
      || securityRestoreObservation.base_spec_sha256 !== base.base_spec_sha256
      || securityRestoreObservation.system_identifier !== base.postgres.system_identifier
      || securityRestoreObservation.server_version_num !== base.postgres.server_version_num
      || !same(securityRestoreByName, expectedReconciliationRows)
      || securityRestoreClassification.schema_version !== 1
      || securityRestoreClassification.contract
        !== "chenyida-erp-uat-rollback-postgresql-layout-classification/v1"
      || securityRestoreClassification.runtime_plan_sha256 !== base.runtime_plan_sha256
      || securityRestoreClassification.base_spec_sha256 !== base.base_spec_sha256
      || securityRestoreClassification.observation_sha256
        !== securityRestoreObservation.observation_sha256
      || securityRestoreClassification.restored_oid !== fixture.restored_oid
      || securityRestoreClassification.layout !== "OLD"
      || securityRestoreClassification.state_projection_sha256 !== expectedReconciliationState
      || securityRestoreClassification.safe_to_recover_switch_receipt !== false
      || securityRestoreClassification.safe_to_recover_unseal_receipt !== false) reject(code);
  if (by.CONTENT_DRIFT_REJECTED.restored_report_sha256 !== fixture.content_report.sha256
      || by.MIGRATION_LEDGER_DRIFT_REJECTED.ledger_file_sha256
        !== fixture.migration.ledger_file_sha256
      || by.SECURITY_DRIFT_REJECTED.restored_security_state_sha256
        !== fixture.security_state_sha256) reject(code);
  exactKeys(by.ORDINARY_ROLE_CONNECTION_REJECTED, [
    "scenario_id", "role", "database_connection_limit", "role_state_sha256",
    "before_observation_sha256", "after_observation_sha256", "before_state_sha256",
    "error_code", "sqlstate", "exit_code", "argv_sha256", "stdin_sha256",
    "stdout_sha256", "stderr_sha256", "stderr_base64", "after_layout",
    "after_state_sha256",
    "scenario_sha256",
  ], code);
  const ordinaryRoleState = expectedSecurityState.roles.find(
    (item) => item.name === "chenyida_erp_web",
  );
  const expectedOrdinaryRoleArgv = [
    "exec", "--interactive", "--user", "999:999", "--env",
    "PGAPPNAME=cyd_dv70_v3_ordinary_role_probe", "--",
    base.postgres.container_id, "psql", "--no-psqlrc", "--quiet", "--no-align",
    "--tuples-only", "--field-separator=\t", "--host=/var/run/postgresql",
    "--port=5432", "--username=chenyida_erp_web", "--no-password",
    `--dbname=${base.databases.staging_name}`, "--set=ON_ERROR_STOP=on",
    "--set=VERBOSITY=verbose",
  ];
  if (typeof by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_base64 !== "string"
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_base64.length < 4
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_base64.length > 5464
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_base64,
      )) reject(code);
  const ordinaryRoleStderr = Buffer.from(
    by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_base64, "base64",
  );
  if (ordinaryRoleStderr.toString("base64")
        !== by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_base64
      || ordinaryRoleStderr.length < 1 || ordinaryRoleStderr.length > 4096
      || ordinaryRoleStderr.includes(0x00)) reject(code);
  let ordinaryRoleStderrText;
  try {
    ordinaryRoleStderrText = new TextDecoder("utf-8", { fatal: true }).decode(
      ordinaryRoleStderr,
    );
  } catch {
    reject(code);
  }
  const ordinaryRoleFatalLines = ordinaryRoleStderrText.split("\n").filter(
    (line) => line.includes("FATAL:"),
  );
  const expectedOrdinaryRoleFatal = `FATAL:  53300: too many connections for database "${
    base.databases.staging_name
  }"`;
  const forbiddenOrdinaryRoleErrors = [
    "permission denied", "role does not exist", "authentication failed",
    "no such container", "cannot connect to the docker daemon",
  ];
  if (by.ORDINARY_ROLE_CONNECTION_REJECTED.role !== "chenyida_erp_web"
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.database_connection_limit !== 0
      || !ordinaryRoleState || ordinaryRoleState.can_login !== true
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.role_state_sha256
        !== digestValue(ordinaryRoleState)
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.before_state_sha256 !== oldStateSha256
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.error_code
        !== "POSTGRESQL_DATABASE_CONNECTION_LIMIT_EXHAUSTED"
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.sqlstate !== "53300"
      || !Number.isSafeInteger(by.ORDINARY_ROLE_CONNECTION_REJECTED.exit_code)
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.exit_code !== 2
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.argv_sha256
        !== digestValue(expectedOrdinaryRoleArgv)
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.stdin_sha256
        !== digestBytes(Buffer.from("SELECT true;\n", "utf8"))
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.stdout_sha256 !== EMPTY_SHA256
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_sha256
        !== digestBytes(ordinaryRoleStderr)
      || !ordinaryRoleStderrText.endsWith("\n")
      || ordinaryRoleFatalLines.length !== 1
      || !ordinaryRoleFatalLines[0].startsWith(
        "psql: error: connection to server on socket ",
      ) || !ordinaryRoleFatalLines[0].includes(expectedOrdinaryRoleFatal)
      || forbiddenOrdinaryRoleErrors.some(
        (token) => ordinaryRoleStderrText.toLowerCase().includes(token),
      )
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.after_layout !== "OLD"
      || by.ORDINARY_ROLE_CONNECTION_REJECTED.after_state_sha256 !== oldStateSha256) reject(code);
  nonzeroSha(by.ORDINARY_ROLE_CONNECTION_REJECTED.before_observation_sha256, code);
  nonzeroSha(by.ORDINARY_ROLE_CONNECTION_REJECTED.after_observation_sha256, code);
  nonzeroSha(by.ORDINARY_ROLE_CONNECTION_REJECTED.stderr_sha256, code);
  exactKeys(by.FIRST_RENAME_FAULT_ROLLBACK, [
    "scenario_id", "production_sql_sha256", "fault_sql_sha256",
    "fault_boundary_offset_bytes", "fault_sql_evidence", "fault_command_receipt",
    "fault_command_receipt_sha256", "before_layout", "after_layout",
    "before_state_sha256", "after_state_sha256", "scenario_sha256",
  ], code);
  const faultSql = verifyCompressedSqlEvidence(
    by.FIRST_RENAME_FAULT_ROLLBACK.fault_sql_evidence, sqlNormalizationRoots,
    digestBytes(normalizeSql(expectedFaultSql, sqlNormalizationRoots)),
    policy.sql_evidence.maximum_uncompressed_bytes,
  );
  exactKeys(by.FIRST_RENAME_FAULT_ROLLBACK.fault_command_receipt, [
    "opcode", "execution_receipt", "barrier", "command_receipt_sha256",
  ], code);
  verifyDigestedObject(
    by.FIRST_RENAME_FAULT_ROLLBACK.fault_command_receipt,
    "command_receipt_sha256", code,
  );
  const faultReceipt = by.FIRST_RENAME_FAULT_ROLLBACK.fault_command_receipt;
  const faultExecutionReceipt = validatePsqlCommandReceipt(
    faultReceipt.execution_receipt,
    psqlSpec("guarded_fault", {
      sql: expectedFaultSql,
      database: base.databases.staging_name,
      writeOverride: true,
      variables: {
        capture_security_state: "1",
        sealed_staging_mode: "1",
        expected_database: base.databases.staging_name,
        expected_marker: base.databases.staging_marker,
        expected_system_identifier: base.postgres.system_identifier,
        migration_owner: base.security.database_owner,
      },
      stdout: Buffer.from("DV70_V3_FIRST_RENAME_REACHED\n", "utf8"),
    }), code,
  );
  if (by.FIRST_RENAME_FAULT_ROLLBACK.production_sql_sha256 !== production.sql_sha256
      || !SHA256.test(by.FIRST_RENAME_FAULT_ROLLBACK.fault_sql_sha256 || "")
      || !Number.isSafeInteger(by.FIRST_RENAME_FAULT_ROLLBACK.fault_boundary_offset_bytes)
      || by.FIRST_RENAME_FAULT_ROLLBACK.fault_boundary_offset_bytes !== faultBoundary
      || !faultSql.equals(expectedFaultSql)
      || by.FIRST_RENAME_FAULT_ROLLBACK.fault_sql_sha256 !== digestBytes(faultSql)
      || by.FIRST_RENAME_FAULT_ROLLBACK.before_layout !== "OLD"
      || by.FIRST_RENAME_FAULT_ROLLBACK.after_layout !== "OLD"
      || faultReceipt.opcode !== "DERIVED_V3_FIRST_RENAME_BARRIER_EOF_V1"
      || faultExecutionReceipt.sql_sha256
        !== by.FIRST_RENAME_FAULT_ROLLBACK.fault_sql_sha256
      || faultReceipt.barrier !== "DV70_V3_FIRST_RENAME_REACHED"
      || faultReceipt.command_receipt_sha256
        !== by.FIRST_RENAME_FAULT_ROLLBACK.fault_command_receipt_sha256
      || by.FIRST_RENAME_FAULT_ROLLBACK.before_state_sha256 !== oldStateSha256
      || by.FIRST_RENAME_FAULT_ROLLBACK.before_state_sha256
        !== by.FIRST_RENAME_FAULT_ROLLBACK.after_state_sha256) reject(code);
  nonzeroSha(by.FIRST_RENAME_FAULT_ROLLBACK.fault_sql_sha256, code);
  nonzeroSha(by.FIRST_RENAME_FAULT_ROLLBACK.fault_command_receipt_sha256, code);
  exactKeys(by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY, [
    "scenario_id", "old_observation_sha256", "recovery_observation",
    "recovery_classification", "old_state_sha256", "after_state_sha256",
    "recovery_reservation_recorded", "recovery_process_model",
    "production_recovery_execution_count", "restart_probe_invocation_count",
    "restart_physical_switch_execution_count",
    "response_delivered", "command", "after_layout", "execution_receipt",
    "mutation_ack", "terminal_evidence",
    "terminal_evidence_sha256", "side_effect_closure_sha256",
    "journal_projection_sha256", "scenario_sha256",
  ], code);
  const recoveryExecution = validateFixedExecutionReceipt(
    by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 8 }, code,
  );
  const recoveryAck = verifyMutationAck(
    by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.mutation_ack, production.opcode,
    recoveryExecution,
  );
  verifyCommand(by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.command,
    production, recoveryAck, recoveryExecution, 1, true);
  const recoveryTerminal = verifyTerminalEvidence(
    by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.terminal_evidence, selectedCase, production,
    recoveryJournal,
  );
  verifyLayoutEvidence(
    by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.recovery_observation,
    by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.recovery_classification,
    {
      base, restoredOid: fixture.restored_oid,
      expectedRows: expectedReconciliationRows, expectedLayout: "OLD",
      expectedStateSha256: oldStateSha256,
    },
  );
  if (by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.recovery_reservation_recorded !== true
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.recovery_process_model
        !== "SAME_PROCESS_RUNTIME_RECONSTRUCTION"
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.production_recovery_execution_count !== 1
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.restart_probe_invocation_count !== 1
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY
        .restart_physical_switch_execution_count !== 0
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.response_delivered !== true
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.after_layout !== "NEW_SEALED"
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.old_state_sha256 !== oldStateSha256
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.after_state_sha256 !== newStateSha256
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.old_observation_sha256
        !== recoveryJournal.recoveryAttempt.recovery_observation_sha256
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.old_observation_sha256
        !== by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.recovery_observation.observation_sha256
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.terminal_evidence_sha256
        !== digestValue(recoveryTerminal)
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.side_effect_closure_sha256 === ZERO_SHA256
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.journal_projection_sha256
        !== recoveryJournal.projection.journal_projection_sha256
      || by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.side_effect_closure_sha256
        !== recoveryJournal.closureSha256
      || recoveryTerminal.switch_receipt_sha256 !== recoveryJournal.switchReceiptSha256) reject(code);
  exactKeys(by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY, [
    "scenario_id", "old_observation_sha256", "recovery_observation",
    "recovery_classification", "reservation_crash_point", "crash_model",
    "second_reservation_granted", "second_probe_failure_code",
    "second_probe_invocation_count", "second_probe_physical_switch_execution_count",
    "total_production_recovery_execution_count", "recovery_attempt_count",
    "switch_receipt_count", "after_layout", "after_state_sha256",
    "journal_projection_sha256", "scenario_sha256",
  ], code);
  verifyLayoutEvidence(
    by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.recovery_observation,
    by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.recovery_classification,
    {
      base, restoredOid: fixture.restored_oid,
      expectedRows: expectedReconciliationRows, expectedLayout: "OLD",
      expectedStateSha256: oldStateSha256,
    },
  );
  if (by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.reservation_crash_point
        !== "AFTER_SIDE_EFFECT_RECOVERY_STARTED_DATABASE_SWITCH"
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.crash_model
        !== "IN_PROCESS_EXCEPTION_AFTER_DURABLE_RESERVATION"
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.second_reservation_granted !== false
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.second_probe_failure_code
        !== "SIDE_EFFECT_OUTCOME_UNKNOWN"
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.second_probe_invocation_count !== 1
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY
        .second_probe_physical_switch_execution_count !== 0
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY
        .total_production_recovery_execution_count !== 0
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.recovery_attempt_count !== 1
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.switch_receipt_count !== 0
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.after_layout !== "OLD"
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.after_state_sha256 !== oldStateSha256
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.old_observation_sha256
        !== unknownJournal.recoveryAttempt.recovery_observation_sha256
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.old_observation_sha256
        !== by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY
          .recovery_observation.observation_sha256
      || by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.journal_projection_sha256
        !== unknownJournal.projection.journal_projection_sha256
      || unknownJournal.closureSha256 !== null
      || unknownJournal.switchReceiptSha256 !== null) reject(code);
  exactKeys(by.COMMIT_RESPONSE_LOSS_NO_REPLAY, [
    "scenario_id", "before_layout", "after_layout", "old_observation_sha256",
    "recovery_observation", "recovery_classification",
    "production_execution_count",
    "response_delivered", "recovery_attempt_count", "response_loss_model",
    "response_loss_failure_code",
    "restart_probe_invocation_count", "restart_physical_switch_execution_count",
    "production_recovery_execution_count", "command",
    "switch_receipt_sha256", "mutation_ack", "execution_receipt", "terminal_evidence",
    "terminal_evidence_sha256", "side_effect_closure_sha256",
    "journal_projection_sha256", "before_state_sha256", "after_state_sha256",
    "scenario_sha256",
  ], code);
  const commitExecution = validateFixedExecutionReceipt(
    by.COMMIT_RESPONSE_LOSS_NO_REPLAY.execution_receipt,
    { base, opcode: production, sql: productionSql, sequence: 9 }, code,
  );
  const commitAck = verifyMutationAck(by.COMMIT_RESPONSE_LOSS_NO_REPLAY.mutation_ack,
    production.opcode, commitExecution);
  verifyCommand(by.COMMIT_RESPONSE_LOSS_NO_REPLAY.command,
    production, commitAck, commitExecution, 1, false);
  const commitTerminal = verifyTerminalEvidence(
    by.COMMIT_RESPONSE_LOSS_NO_REPLAY.terminal_evidence, selectedCase, production,
    commitJournal,
  );
  verifyLayoutEvidence(
    by.COMMIT_RESPONSE_LOSS_NO_REPLAY.recovery_observation,
    by.COMMIT_RESPONSE_LOSS_NO_REPLAY.recovery_classification,
    {
      base, restoredOid: fixture.restored_oid,
      expectedRows: expectedReconciliationRows, expectedLayout: "OLD",
      expectedStateSha256: oldStateSha256,
    },
  );
  if (by.COMMIT_RESPONSE_LOSS_NO_REPLAY.before_layout !== "OLD"
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.after_layout !== "NEW_SEALED"
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.before_state_sha256 !== oldStateSha256
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.after_state_sha256 !== newStateSha256
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.old_observation_sha256
        !== commitJournal.recoveryAttempt.recovery_observation_sha256
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.old_observation_sha256
        !== by.COMMIT_RESPONSE_LOSS_NO_REPLAY.recovery_observation.observation_sha256
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.production_execution_count !== 1
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.response_delivered !== false
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.recovery_attempt_count !== 1
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.response_loss_model
        !== "CALLER_DISCARDS_COMPLETED_DELEGATE_RESULT_IN_SAME_PROCESS"
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.response_loss_failure_code
        !== "SIDE_EFFECT_OUTCOME_UNKNOWN"
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.restart_probe_invocation_count !== 1
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.restart_physical_switch_execution_count !== 0
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.production_recovery_execution_count !== 1
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.switch_receipt_sha256
        !== commitTerminal.switch_receipt_sha256
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.terminal_evidence_sha256
        !== digestValue(commitTerminal)
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.journal_projection_sha256
        !== commitJournal.projection.journal_projection_sha256
      || by.COMMIT_RESPONSE_LOSS_NO_REPLAY.side_effect_closure_sha256
        !== commitJournal.closureSha256
      || commitTerminal.switch_receipt_sha256 !== commitJournal.switchReceiptSha256) reject(code);

  const expectedAssertions = [
    {
      migration_count: fixture.migration.count, migration_head: fixture.migration.head,
      ledger_file_sha256: fixture.migration.ledger_file_sha256,
      allowlist_sha256: fixture.migration.allowlist_sha256,
      ledger_sha256: fixture.migration.ledger_sha256,
      apply_receipt_set_sha256: fixture.migration.apply_receipt_set_sha256,
    },
    { managed_role_count: fixture.security_state.roles.length,
      managed_membership_count: fixture.security_state.memberships.length,
      live_security_state_sha256: fixture.security_state_sha256 },
    fixture.content_report,
    {
      opcode: production.opcode, opcode_spec_sha256: production.opcode_spec_sha256,
      sql_sha256: production.sql_sha256,
      sql_bytes: selectedCase.opcodes.production_sql_bytes,
      source_reconciliation_sha256: production.bindings.source_reconciliation_sha256,
    },
    { scenario_sha256: by.EXACT_V3_SUCCESS.scenario_sha256,
      before_layout: "OLD", after_layout: "NEW_SEALED" },
    { candidate_oid: base.databases.candidate_oid, restored_oid: fixture.restored_oid,
      success_after_state_sha256: by.EXACT_V3_SUCCESS.after_state_sha256 },
    { scenario_sha256: by.REPEAT_FAIL_CLOSED.scenario_sha256,
      failure_code: by.REPEAT_FAIL_CLOSED.failure_code, state_unchanged: true },
    { scenario_sha256: [by.CONTENT_DRIFT_REJECTED.scenario_sha256,
      by.MIGRATION_LEDGER_DRIFT_REJECTED.scenario_sha256,
      by.SECURITY_DRIFT_REJECTED.scenario_sha256], all_old_layout: true },
    { scenario_sha256: by.ORDINARY_ROLE_CONNECTION_REJECTED.scenario_sha256,
      role: "chenyida_erp_web", connection_limit: 0 },
    { scenario_sha256: by.FIRST_RENAME_FAULT_ROLLBACK.scenario_sha256,
      barrier: "DV70_V3_FIRST_RENAME_REACHED", after_layout: "OLD" },
    { scenario_sha256: by.PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY.scenario_sha256,
      recovery_attempt_count: 1, production_recovery_execution_count: 1,
      restart_probe_invocation_count: 1, restart_physical_switch_execution_count: 0 },
    { scenario_sha256: by.RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY.scenario_sha256,
      second_reservation_granted: false, total_production_recovery_execution_count: 0,
      second_probe_invocation_count: 1,
      second_probe_physical_switch_execution_count: 0 },
    { scenario_sha256: by.COMMIT_RESPONSE_LOSS_NO_REPLAY.scenario_sha256,
      recovery_attempt_count: 1, production_execution_count: 1,
      restart_probe_invocation_count: 1, restart_physical_switch_execution_count: 0 },
    { scenario_sha256: scenarios.map((item) => item.scenario_sha256), mixed_layout_count: 0 },
    { before_fingerprint_sha256: before.fingerprint_sha256,
      after_fingerprint_sha256: after.fingerprint_sha256,
      cleanup_receipt_sha256: cleanup.cleanup_receipt_sha256 },
  ];
  if (!Array.isArray(selectedCase.assertions)
      || !same(selectedCase.assertions.map((item) => item.id), policyCase.required_assertions)
      || selectedCase.assertions.length !== expectedAssertions.length) reject(code);
  selectedCase.assertions.forEach((item, index) => {
    exactKeys(item, ["id", "result", "evidence", "evidence_sha256"], code);
    if (item.result !== "PASS" || !same(item.evidence, expectedAssertions[index])
        || item.evidence_sha256 !== digestValue(item.evidence)) reject(code);
  });
  return selectedCase;
}


export function validateArtifact(artifact, policy, rawBytes = null) {
  policy = validatePolicy(policy);
  const code = "TASK70_V3_ARTIFACT_INVALID";
  exactKeys(artifact, [
    "schema_version", "contract", "task_id", "run_id", "case_id",
    "evidence_scope", "deployment_class", "audit_clearance", "started_at",
    "completed_at", "source", "source_bindings", "policy_sha256", "target_guard",
    "historical_v2", "runtime", "resource_gate", "object_protection", "cases",
    "coverage", "cleanup", "non_claims", "result", "artifact_sha256",
  ], code);
  verifyDigestedObject(artifact, "artifact_sha256", code);
  const expectedRaw = Buffer.from(
    `${JSON.stringify(sortedValue(artifact), null, 2)}\n`, "utf8",
  );
  if ((rawBytes !== null && (!Buffer.isBuffer(rawBytes)
        || rawBytes.length > policy.artifact_max_bytes || !rawBytes.equals(expectedRaw)))
      || artifact.schema_version !== 3
      || artifact.contract !== policy.artifact_contract
      || artifact.task_id !== policy.task_id
      || !RUN_ID.test(artifact.run_id || "")
      || artifact.case_id !== policy.case_catalog[0].case_id
      || artifact.evidence_scope !== policy.evidence_scope
      || artifact.deployment_class !== policy.deployment_class
      || artifact.policy_sha256 !== EXPECTED_POLICY_SHA256
      || artifact.audit_clearance !== policy.audit_clearance
      || artifact.result !== "PASS_PARTIAL"
      || !Array.isArray(artifact.cases) || artifact.cases.length !== 1
      || !same(artifact.non_claims, policy.required_non_claims)
      || !same(artifact.target_guard, policy.required_target_guard)) reject(code);
  strictIso(artifact.started_at, code);
  strictIso(artifact.completed_at, code);
  if (Date.parse(artifact.completed_at) < Date.parse(artifact.started_at)) reject(code);
  exactKeys(artifact.source, [
    "git_commit", "git_tree", "application_version", "migration_head",
  ], code);
  const sourceBodies = verifySourceBindings(artifact, policy);
  verifyHistoricalV2(artifact.historical_v2);
  const runtime = verifyRuntime(artifact.runtime, policy, artifact.run_id);
  verifyResourceGate(artifact.resource_gate, policy, {
    started_at: artifact.started_at,
    completed_at: artifact.completed_at,
    container_created_at: runtime.container_inspect.created_at,
  });
  exactKeys(artifact.object_protection, ["before", "after", "result"], code);
  const before = verifyObjectSnapshot(artifact.object_protection.before, policy);
  const after = verifyObjectSnapshot(artifact.object_protection.after, policy);
  if (artifact.object_protection.result !== "UNCHANGED" || !same(before, after)) reject(code);
  const cleanup = verifyCleanup(artifact.cleanup, {
    policy, runId: artifact.run_id, runtime, before, after,
  });
  verifyCase(artifact.cases[0], policy, {
    runtime, before, after, cleanup, sourceBodies,
  });
  verifyCoverage(artifact.coverage, policy);
  return artifact;
}


export function loadAndValidatePolicy() {
  return validatePolicy(jsonFile(POLICY_PATH, 1024 * 1024, "TASK70_V3_POLICY_INVALID").value);
}


export function loadAndValidateArtifact(policy = loadAndValidatePolicy()) {
  const raw = readTrustedArtifactFile(
    ARTIFACT_PATH, policy.artifact_max_bytes, "TASK70_V3_ARTIFACT_INVALID",
  );
  const value = parseStrictJson(raw, "TASK70_V3_ARTIFACT_INVALID");
  return validateArtifact(value, policy, raw);
}


function main(argv) {
  if (argv.length !== 1 || !["--verify-policy", "--verify-artifact"].includes(argv[0])) {
    process.stderr.write(
      "usage: uat-promotion-dynamic-evidence-v3.mjs "
      + "--verify-policy|--verify-artifact\n",
    );
    return 2;
  }
  try {
    const policy = loadAndValidatePolicy();
    if (argv[0] === "--verify-policy") {
      process.stdout.write(JSON.stringify({
        result: "PASS", policy_sha256: EXPECTED_POLICY_SHA256,
      }) + "\n");
      return 0;
    }
    const artifact = loadAndValidateArtifact(policy);
    process.stdout.write(JSON.stringify({
      result: "PASS_PARTIAL", artifact_sha256: artifact.artifact_sha256,
      case_id: artifact.case_id,
    }) + "\n");
    return 0;
  } catch (error) {
    const code = error instanceof DynamicEvidenceV3Error
      ? error.code : "TASK70_V3_EVIDENCE_UNEXPECTED";
    process.stderr.write(`${code}\n`);
    return 1;
  }
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
