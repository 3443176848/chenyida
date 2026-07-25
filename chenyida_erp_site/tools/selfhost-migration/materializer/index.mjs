import { sha256 } from "../digest.mjs";
import { resolve } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import { parseSafePostgresUrl } from "../environment-guard.mjs";
import { MATERIALIZATION_TARGET_MARKER } from "../environment-guard.mjs";
import { MaterializerCheckpointStore } from "./checkpoint.mjs";
import { dispatchSnapshot, dispatchDeferredSnapshot, completeExternalStage } from "./dispatcher.mjs";
import { buildMaterializationPlan } from "./plan.mjs";
import { buildMaterializationReport } from "./report.mjs";
import { reconcilePublicMaterialization } from "./reconciliation.mjs";
import { ensureMaterializationTables, mappedTarget, recordTarget } from "./target-id-map.mjs";
import { inTransaction } from "./transaction.mjs";
import { fail } from "./errors.mjs";

export async function materializePublicSnapshot({ pool, databaseUrl, source, plan, manifest, workspace, fileTarget, setupAdmin, fault }) {
  parseSafePostgresUrl(databaseUrl);
  if (!fileTarget) fail("MATERIALIZATION_FILE_TARGET_REQUIRED", "public snapshot 需要新空文件目标");
  const materializationPlan = buildMaterializationPlan(plan, manifest);
  const markerPath = resolve(fileTarget, MATERIALIZATION_TARGET_MARKER);
  const marker = { schema_version: 1, migration_run_id: manifest.migration_run_id, synthetic_marker: "SYNTHETIC_MIGRATION_TEST_ONLY" };
  try {
    const existing = JSON.parse(await readFile(markerPath, "utf8"));
    if (existing.migration_run_id !== marker.migration_run_id || existing.synthetic_marker !== marker.synthetic_marker) fail("MIGRATION_FILE_TARGET_RUN_CONFLICT", "目标文件目录属于其他 migration run");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const temporary = `${markerPath}.tmp`; await writeFile(temporary, `${JSON.stringify(marker)}\n`, { mode: 0o600 }); await rename(temporary, markerPath);
  }
  const context = {
    pool, runId: manifest.migration_run_id, sourceSystem: source.kind,
    manifestSha256: materializationPlan.manifest_sha256, mappingDigest: plan.mapping_digest,
    planDigest: plan.digest, inputDigest: materializationPlan.digest, actor: "migration_opening_actor",
    fileTarget, setupAdmin, fault,
    erpRecordsBaseline: Number((await pool.query("select count(*)::int count from erp_records")).rows[0].count),
  };
  await inTransaction(pool, async (client) => {
    await ensureMaterializationTables(client);
    const run = await client.query("select manifest from migration_tool.runs where run_id=$1 for update", [context.runId]);
    if (!run.rows[0] || sha256(run.rows[0].manifest) !== context.manifestSha256) fail("MATERIALIZATION_RUN_INVALID", "物化 run/manifest 不受控");
  });
  const checkpoints = new MaterializerCheckpointStore(resolve(workspace, "materializer"), context.inputDigest);
  const dispatch = await dispatchSnapshot(context, materializationPlan, checkpoints);
  return { context, materializationPlan, checkpoints, dispatch };
}

export async function recordOpeningTargets(snapshot, plan, bundle, results) {
  const { context, checkpoints } = snapshot;
  const mapped = [];
  for (let index = 0; index < bundle.commands.length; index += 1) {
    const command = bundle.commands[index]; const result = results[index];
    const row = plan.rows.find((item) => item.source_ref === command.source_ref);
    if (!row) fail("MATERIALIZATION_OPENING_SOURCE_MISSING", "Opening command 缺少 source row");
    mapped.push(await inTransaction(context.pool, async (client) => {
      const replay = await mappedTarget(client, context, row); if (replay) return replay;
      if (command.command_type === "POST_INVENTORY_OPENING") {
        const target = await client.query(`select o.id,o.inventory_adjustment_id,l.material_id,l.unit_id,l.on_hand_quantity,l.frozen_quantity from inventory_migration_openings o join inventory_migration_opening_lines l on l.inventory_opening_id=o.id where o.id=$1`, [result.inventory_opening_id]);
        if (!target.rows[0]) fail("MATERIALIZATION_TARGET_MISSING", "Inventory Opening target 不存在");
        return recordTarget(client, context, row, "inventory_migration_openings", result.inventory_opening_id, target.rows[0]);
      }
      const target = await client.query("select id,finance_document_id,direction,currency_code,opening_outstanding_amount from finance_opening_sources where id=$1", [result.finance_opening_source_id]);
      if (!target.rows[0]) fail("MATERIALIZATION_TARGET_MISSING", "Finance Opening target 不存在");
      return recordTarget(client, context, row, "finance_opening_sources", result.finance_opening_source_id, target.rows[0]);
    }));
  }
  const inventory = mapped.filter((_, index) => bundle.commands[index].command_type === "POST_INVENTORY_OPENING");
  const finance = mapped.filter((_, index) => bundle.commands[index].command_type === "POST_FINANCE_OPENING");
  await completeExternalStage(context, checkpoints, "inventory_opening", inventory);
  await completeExternalStage(context, checkpoints, "finance_opening", finance);
  return mapped;
}

export async function finalizePublicSnapshot(snapshot) {
  const deferred = await dispatchDeferredSnapshot(snapshot.context, snapshot.materializationPlan, snapshot.checkpoints);
  snapshot.dispatch = { ...snapshot.dispatch, ...deferred };
  const expected = snapshot.materializationPlan.snapshot.length;
  const reconciliation = await reconcilePublicMaterialization(snapshot.context.pool, snapshot.context, expected);
  await completeExternalStage(snapshot.context, snapshot.checkpoints, "reconciliation", reconciliation);
  const report = buildMaterializationReport({ plan: snapshot.materializationPlan, dispatch: snapshot.dispatch, reconciliation });
  await completeExternalStage(snapshot.context, snapshot.checkpoints, "finalization", report);
  return { reconciliation, report };
}
