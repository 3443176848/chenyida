import { sha256 } from "../digest.mjs";
import { fail } from "./errors.mjs";
import { ARCHIVE_ONLY_KINDS, SNAPSHOT_KINDS } from "./types.mjs";

export function buildMaterializationPlan(plan, manifest) {
  if (!plan?.runnable || !Array.isArray(plan.rows)) fail("MATERIALIZATION_PLAN_BLOCKED", "只有已通过验证的 plan 可以物化");
  if (!manifest?.migration_run_id || manifest.source_snapshot_sha256 !== plan.source_snapshot_sha256) fail("MATERIALIZATION_MANIFEST_STALE", "manifest 与 plan 不一致");
  const snapshot = [];
  const archiveOnly = [];
  for (const row of plan.rows) {
    if (row.status !== "PLANNED") fail("MATERIALIZATION_PLAN_BLOCKED", "plan 含未解决记录");
    if (ARCHIVE_ONLY_KINDS.has(row.kind)) archiveOnly.push({ source_ref: row.source_ref, kind: row.kind, classification: "ARCHIVE_ONLY" });
    else if (SNAPSHOT_KINDS.has(row.kind)) snapshot.push(row);
    else fail("MATERIALIZATION_KIND_UNCLASSIFIED", "来源记录无法安全分类");
  }
  const digest = sha256({ manifest: manifest.migration_run_id, manifest_sha256: sha256(manifest), plan: plan.digest, snapshot: snapshot.map((row) => row.source_digest), archiveOnly });
  return Object.freeze({ schema_version: 1, mode: "CUTOVER_SNAPSHOT", snapshot, archive_only: archiveOnly, plan_digest: plan.digest, manifest_sha256: sha256(manifest), digest });
}
