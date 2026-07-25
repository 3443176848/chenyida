import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { assertMigrationEnvironment, assertSourcePath } from "./environment-guard.mjs";
import { sha256 } from "./digest.mjs";
import { fail } from "./errors.mjs";

export async function inspectD1ExportSource(path, environment = process.env) {
  assertMigrationEnvironment(environment);
  const safePath = assertSourcePath(path, "d1-export");
  const bytes = await readFile(safePath);
  const info = await stat(safePath);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("MIGRATION_SOURCE_INVALID", "D1 export JSON 无法解析"); }
  if (value.synthetic_marker !== "SYNTHETIC_MIGRATION_TEST_ONLY") fail("MIGRATION_SOURCE_NOT_SYNTHETIC", "D1 export 缺少合成标识");
  if (value.schema_version !== 1 || !Array.isArray(value.records)) fail("MIGRATION_SOURCE_INVALID", "D1 export schema 无效");
  return { kind: "D1_EXPORT", schemaFingerprint: sha256(value.schema), snapshotSha256: sha256(bytes), files: [{ name: basename(safePath), sha256: sha256(bytes), bytes: info.size }], records: value.records, fixtureKind: value.fixture_kind };
}
