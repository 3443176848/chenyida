import { sha256 } from "./digest.mjs";
import { CheckpointStore } from "./checkpoint.mjs";
import { DOMAIN_ORDER } from "./mapping-registry.mjs";
import { aggregateSource, reconcile } from "./reconciliation.mjs";
import { fail } from "./errors.mjs";

export function executionInputDigest({ source, mappingDigest, targetMigrations, plan }) {
  return sha256({ source: source.snapshotSha256, schema: source.schemaFingerprint, mappingDigest, targetMigrations, plan: plan.digest });
}

export async function executeDryRun({ workspace, inputDigest, plan }) {
  const checkpoints = new CheckpointStore(workspace, inputDigest);
  let checkpoint = await checkpoints.append("Inspect", "INSPECTED", { source_records: plan.rows.length });
  checkpoint = await checkpoints.append("Extract", "INSPECTED", { extracted: plan.rows.length });
  checkpoint = await checkpoints.append("Normalize", "INSPECTED", { normalized: plan.rows.length });
  checkpoint = await checkpoints.append("Validate", plan.runnable ? "PLANNED" : "BLOCKED", { issues: plan.issues.length });
  checkpoint = await checkpoints.append("Plan", plan.runnable ? "PLANNED" : "BLOCKED", { plan_digest: plan.digest });
  if (!plan.runnable) return { state: "BLOCKED", checkpoint };
  checkpoint = await checkpoints.append("Dry-run", "DRY_RUN_PASSED", { planned: plan.rows.length });
  return { state: "DRY_RUN_PASSED", checkpoint };
}

export async function executeSyntheticCommit({ workspace, inputDigest, runId, source, plan, target, manifest, interruptAfterDomain = "" }) {
  const dry = await executeDryRun({ workspace, inputDigest, plan });
  if (dry.state !== "DRY_RUN_PASSED") return dry;
  const checkpoints = new CheckpointStore(workspace, inputDigest);
  await target.initialize(runId, inputDigest, manifest);
  let checkpoint = await checkpoints.append("Commit:start", "COMMITTING", {});
  for (const domain of DOMAIN_ORDER) {
    const rows = plan.rows.filter((row) => row.domain === domain && row.status === "PLANNED");
    if (!rows.length) continue;
    const loaded = await checkpoints.load();
    if (!loaded.checkpoints.some((entry) => entry.stage === `Commit:${domain}`)) {
      await target.commitDomain(runId, source.kind, rows);
      checkpoint = await checkpoints.append(`Commit:${domain}`, "COMMITTING", { migrated: rows.length });
      if (interruptAfterDomain === domain) fail("MIGRATION_TEST_INTERRUPT", "合成中断注入");
    }
  }
  await target.setState(runId, "COMMITTED");
  checkpoint = await checkpoints.append("Commit", "COMMITTED", { migrated: plan.rows.length });
  const targetAggregate = await target.aggregate(runId);
  const reconciliation = reconcile(aggregateSource(source.records), targetAggregate, plan.issues.length);
  if (reconciliation.grade === "FAILED") { await target.setState(runId, "FAILED"); fail("MIGRATION_RECONCILIATION_FAILED", "合成迁移核对失败"); }
  await target.setState(runId, "RECONCILED");
  checkpoint = await checkpoints.append("Reconcile", "RECONCILED", { grade: reconciliation.grade });
  checkpoint = await checkpoints.append("Finalize", "RECONCILED", { report_ready: true });
  return { state: "RECONCILED", checkpoint, reconciliation };
}
