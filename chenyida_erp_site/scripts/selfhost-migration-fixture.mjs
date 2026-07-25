#!/usr/bin/env node
import { resolve } from "node:path";
import { assertMigrationEnvironment, assertWorkspace } from "../tools/selfhost-migration/environment-guard.mjs";
import { writeSyntheticD1Export, writeSyntheticSqlite } from "../tools/selfhost-migration/synthetic-fixtures.mjs";
import { safeError } from "../tools/selfhost-migration/errors.mjs";

async function main() {
  assertMigrationEnvironment(process.env);
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => index % 2 ? pairs : [...pairs, [item.replace(/^--/, ""), all[index + 1]]], []));
  const directory = assertWorkspace(resolve(args.output), { requireEmpty: true });
  const kind = args.kind || "valid";
  if (!new Set(["valid", "reviewable", "blocked", "resume", "repeat"]).has(kind)) throw new Error("invalid fixture kind");
  if (args.format === "sqlite") await writeSyntheticSqlite(directory, kind);
  else if (args.format === "d1-export") await writeSyntheticD1Export(directory, kind);
  else throw new Error("format must be sqlite or d1-export");
  console.log(JSON.stringify({ fixture_kind: kind, format: args.format, status: "CREATED_IN_MIGRATION_TEST_TEMP" }));
}

main().catch((error) => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
