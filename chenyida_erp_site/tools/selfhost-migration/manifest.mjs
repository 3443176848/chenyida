import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { sha256 } from "./digest.mjs";
import { fail } from "./errors.mjs";
import { registryDigest, MAPPING_REGISTRY } from "./mapping-registry.mjs";

export const MANIFEST_SCHEMA_VERSION = 1;
export const TOOL_VERSION = "0.1.0-alpha.17";
export const EXPECTED_MIGRATION_SHA256 = Object.freeze({
  "0001_selfhost_baseline.sql": "c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702",
  "0002_material_master_workflow.sql": "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80",
  "0003_material_import_mapping.sql": "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf",
  "0004_material_import_normalization.sql": "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39",
  "0005_material_import_review.sql": "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc",
  "0006_identity_security.sql": "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079",
  "0007_master_data_bom.sql": "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6",
  "0008_inventory_ledger.sql": "49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b",
  "0009_procurement.sql": "351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7",
  "0010_production.sql": "d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35",
  "0011_sales.sql": "6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b",
  "0012_quality.sql": "64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf",
  "0013_finance.sql": "8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1",
  "0014_migration_openings.sql": "61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b",
  "0015_market_project_handoff.sql": "419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f",
  "0016_project_planning_handoff.sql": "26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076",
  "0017_planning_material_requirements.sql": "33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28",
});

export async function migrationChecksums(directory) {
  const availableFiles = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const files = Object.keys(EXPECTED_MIGRATION_SHA256);
  const available = new Set(availableFiles);
  const unexpectedBaselineFile = availableFiles.some((name) => Number.parseInt(name.slice(0, 4), 10) <= 17 && !files.includes(name));
  if (files.some((name) => !available.has(name)) || unexpectedBaselineFile) {
    fail("MIGRATION_TARGET_BASELINE_INVALID", "目标 migration 必须严格为 0001—0017");
  }
  const migrations = await Promise.all(files.map(async (name) => ({ name, sha256: sha256(await readFile(resolve(directory, name))) })));
  if (migrations.some(({ name, sha256: digest }) => EXPECTED_MIGRATION_SHA256[name] !== digest)) {
    fail("MIGRATION_TARGET_BASELINE_INVALID", "目标 migration checksum 与 0001—0017 固定基线不一致");
  }
  return migrations;
}

export function validateManifest(manifest) {
  const required = ["schema_version", "migration_run_id", "source_kind", "source_schema_fingerprint", "source_snapshot_sha256", "source_files", "target_application_version", "target_git_commit", "target_migrations", "mapping_registry_version", "normalization_version", "created_at", "tool_version", "execution_mode", "checkpoint_digest", "counts_summary", "issue_summary", "reconciliation_summary"];
  for (const key of required) if (manifest[key] === undefined) fail("MIGRATION_MANIFEST_INVALID", `manifest 缺少 ${key}`);
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) fail("MIGRATION_MANIFEST_INVALID", "manifest schema version 不受支持");
  if (!new Set(["DRY_RUN", "SYNTHETIC_COMMIT"]).has(manifest.execution_mode)) fail("MIGRATION_MANIFEST_INVALID", "execution mode 无效");
  const serialized = JSON.stringify(manifest);
  if (/(?:postgres(?:ql)?:\/\/|password|session|token|authorization|cookie)/i.test(serialized)) fail("MIGRATION_MANIFEST_SENSITIVE", "manifest 含敏感字段");
  if (manifest.source_files.some((file) => file.name.includes("/") || file.name.includes("\\"))) fail("MIGRATION_MANIFEST_PATH_INVALID", "manifest 只允许安全文件名");
  return manifest;
}

export async function createManifest({ runId, source, targetGitCommit, targetMigrations, executionMode, checkpointDigest = "", counts = {}, issues = {}, reconciliation = {} }) {
  return validateManifest({
    schema_version: MANIFEST_SCHEMA_VERSION,
    migration_run_id: runId,
    source_kind: source.kind,
    source_schema_fingerprint: source.schemaFingerprint,
    source_snapshot_sha256: source.snapshotSha256,
    source_files: source.files.map((file) => ({ name: basename(file.name), sha256: file.sha256, bytes: file.bytes })),
    target_application_version: TOOL_VERSION,
    target_git_commit: targetGitCommit,
    target_migrations: targetMigrations,
    mapping_registry_version: MAPPING_REGISTRY.version,
    mapping_registry_digest: registryDigest(),
    normalization_version: MAPPING_REGISTRY.normalization_version,
    created_at: new Date().toISOString(),
    tool_version: TOOL_VERSION,
    execution_mode: executionMode,
    checkpoint_digest: checkpointDigest,
    counts_summary: counts,
    issue_summary: issues,
    reconciliation_summary: reconciliation,
  });
}
