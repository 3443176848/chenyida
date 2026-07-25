import { sha256 } from "../digest.mjs";
import { recordCheckpoint } from "./provenance.mjs";
import { inTransaction } from "./transaction.mjs";
import {
  classifyArchiveOnly, initializeIdentity, materializeAuditEvidence, materializeBoms,
  materializeFiles, materializeMappings, materializeMaterials, materializeParties,
  materializeProducts, materializeReferences,
} from "./domain-materializers.mjs";

async function completeStage(context, checkpointStore, stage, value) {
  const stableValue = Array.isArray(value) ? value.map((item) => item && typeof item === "object" ? {
    target_table: item.target_table,
    actual_target_id: item.actual_target_id,
    target_digest: item.target_digest,
  } : item) : value;
  const resultDigest = sha256(stableValue);
  await inTransaction(context.pool, (client) => recordCheckpoint(client, context, stage, resultDigest));
  await checkpointStore.complete(stage, { result_digest: resultDigest, count: Array.isArray(value) ? value.length : Number(value || 0) });
}

export async function dispatchSnapshot(context, materializationPlan, checkpointStore) {
  const rows = materializationPlan.snapshot;
  const identity = await initializeIdentity(context, rows.filter((row) => row.kind === "identity")); await completeStage(context, checkpointStore, "identity", identity);
  const references = await materializeReferences(context, rows.filter((row) => row.kind === "unit" || row.kind === "category")); await completeStage(context, checkpointStore, "references", references);
  const materials = await materializeMaterials(context, rows.filter((row) => row.kind === "material")); await completeStage(context, checkpointStore, "material", materials);
  const parties = await materializeParties(context, rows.filter((row) => row.kind === "customer" || row.kind === "supplier")); await completeStage(context, checkpointStore, "master_data", parties);
  const products = await materializeProducts(context, rows.filter((row) => row.kind === "product"), rows.filter((row) => row.kind === "product_version")); await completeStage(context, checkpointStore, "product", products);
  const mappings = await materializeMappings(context, rows.filter((row) => row.kind === "supplier_mapping"));
  const boms = await materializeBoms(context, rows.filter((row) => row.kind === "bom"), rows.filter((row) => row.kind === "bom_line"));
  await completeStage(context, checkpointStore, "bom_mapping", [...mappings, ...boms]);
  return { identity, references, materials, parties, products, mappings, boms };
}

export async function dispatchDeferredSnapshot(context, materializationPlan, checkpointStore) {
  const rows = materializationPlan.snapshot;
  const files = await materializeFiles(context, rows.filter((row) => row.kind === "file")); await completeStage(context, checkpointStore, "files", files);
  const audit = await materializeAuditEvidence(context, rows.filter((row) => row.kind === "audit")); await completeStage(context, checkpointStore, "audit", audit);
  const archived = await classifyArchiveOnly(context, materializationPlan.archive_only); await completeStage(context, checkpointStore, "archive_only", archived);
  return { files, audit, archived };
}

export async function completeExternalStage(context, checkpointStore, stage, value) {
  return completeStage(context, checkpointStore, stage, value);
}
