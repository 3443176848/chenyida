import { readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { basename } from "node:path";
import { assertMigrationEnvironment, assertSourcePath } from "./environment-guard.mjs";
import { sha256 } from "./digest.mjs";
import { fail } from "./errors.mjs";

export async function inspectSqliteSource(path, environment = process.env) {
  assertMigrationEnvironment(environment);
  const safePath = assertSourcePath(path, "sqlite");
  const bytes = await readFile(safePath);
  const info = await stat(safePath);
  const db = new DatabaseSync(safePath, { readOnly: true });
  try {
    const metadata = db.prepare("select schema_version, fixture_kind, synthetic_marker from migration_metadata limit 1").get();
    if (!metadata || metadata.synthetic_marker !== "SYNTHETIC_MIGRATION_TEST_ONLY") fail("MIGRATION_SOURCE_NOT_SYNTHETIC", "SQLite 源缺少合成标识");
    const schema = db.prepare("select sql from sqlite_master where type in ('table','index') and name not like 'sqlite_%' order by name").all();
    const rows = db.prepare("select domain, kind, stable_key, payload_json, relations_json from migration_records order by sequence_no, stable_key").all().map((row) => ({
      domain: row.domain, kind: row.kind, stable_key: row.stable_key,
      data: JSON.parse(row.payload_json), relations: JSON.parse(row.relations_json),
    }));
    return { kind: "SQLITE", schemaFingerprint: sha256(schema), snapshotSha256: sha256(bytes), files: [{ name: basename(safePath), sha256: sha256(bytes), bytes: info.size }], records: rows, fixtureKind: metadata.fixture_kind };
  } finally { db.close(); }
}
