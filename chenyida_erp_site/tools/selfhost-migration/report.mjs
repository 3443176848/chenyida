import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./digest.mjs";

export function buildSafeReport({ runId, state, manifest, plan, checkpoint, reconciliation }) {
  const resultCounts = plan.rows.reduce((result, row) => ({ ...result, [row.status.toLowerCase()]: (result[row.status.toLowerCase()] || 0) + 1 }), {});
  return {
    schema_version: 1, migration_run_id: runId, state,
    result_grade: reconciliation?.grade || (plan.runnable ? "PASS" : "BLOCKED"),
    source_kind: manifest.source_kind, source_snapshot_sha256: manifest.source_snapshot_sha256,
    target_application_version: manifest.target_application_version, target_git_commit: manifest.target_git_commit,
    target_migration_count: manifest.target_migrations.length, mapping_registry_version: manifest.mapping_registry_version,
    tool_version: manifest.tool_version, migration_digest: plan.digest, checkpoint: checkpoint?.digest || "",
    counts: { source_records: plan.rows.length, ...resultCounts }, issue_summary: manifest.issue_summary,
    reconciliation: reconciliation || {}, report_digest: sha256({ runId, state, plan: plan.digest, checkpoint: checkpoint?.digest || "", reconciliation: reconciliation || {} }),
  };
}

export async function writeSafeJson(workspace, name, value) {
  const path = resolve(workspace, name); const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return path;
}
