import { sha256, stableUuid } from "./digest.mjs";
import { fail } from "./errors.mjs";

const relation = (row, kind) => row.relations.find((item) => item.kind === kind)?.key;

export function openingTargetDigest(targetMigrations) {
  return sha256(targetMigrations.map(({ name, sha256: digest }) => ({ name, sha256: digest })));
}

export function buildOpeningCommands({ source, plan, manifest, targetMigrations }) {
  const manifestDigest = sha256(manifest);
  const targetDigest = openingTargetDigest(targetMigrations);
  const common = (row, openingType) => ({
    schema_version: 1,
    command_type: openingType === "INVENTORY" ? "POST_INVENTORY_OPENING" : "POST_FINANCE_OPENING",
    migration_opening_source_id: stableUuid("chenyida-migration-opening-source", `${source.kind}\0${row.kind}\0${row.stable_key}`),
    migration_run_id: manifest.migration_run_id,
    manifest_sha256: manifestDigest,
    source_system: source.kind,
    source_entity_kind: row.kind,
    source_stable_reference_digest: sha256(row.stable_key),
    source_record_digest: row.source_digest,
    mapping_digest: plan.mapping_digest,
    target_digest: targetDigest,
    opening_type: openingType,
    cutoff_at: String(row.data.cutoff_at || "2026-01-01T00:00:00.000Z"),
    created_by: "migration_opening_actor",
    request_id: stableUuid("chenyida-migration-opening-request", `${row.target_id}\0request`),
    operation_id: stableUuid("chenyida-migration-opening-operation", `${row.target_id}\0post`),
    source_ref: row.source_ref,
  });
  const commands = [];
  for (const row of plan.rows.filter((item) => item.status === "PLANNED")) {
    if (row.kind === "inventory_balance" && Number(row.data.on_hand_qty) > 0) commands.push({
      ...common(row, "INVENTORY"), material_key: relation(row, "material"), unit_key: relation(row, "unit"), location_code: "MAIN", lot_code: "",
      on_hand_quantity: String(row.data.on_hand_qty), frozen_quantity: String(row.data.frozen_qty || "0"),
    });
    if (row.kind === "finance_opening" && Number(row.data.amount) > 0) {
      const direction = String(row.data.document_type || row.data.direction).toUpperCase();
      commands.push({
        ...common(row, direction), direction, customer_key: relation(row, "customer") || null, supplier_key: relation(row, "supplier") || null,
        currency_code: String(row.data.currency_code), opening_outstanding_amount: String(row.data.amount),
        accounting_date: String(row.data.accounting_date || "2026-01-01"), business_reference_digest: sha256(row.stable_key),
      });
    }
  }
  return { schema_version: 1, manifest_sha256: manifestDigest, mapping_digest: plan.mapping_digest, target_digest: targetDigest, commands, digest: sha256({ manifestDigest, mapping: plan.mapping_digest, targetDigest, commands }) };
}

export function assertOpeningCommandBindings(command, expected) {
  for (const [field, value] of Object.entries(expected)) if (command[field] !== value) fail("MIGRATION_OPENING_COMMAND_STALE", `期初 command 的 ${field} 摘要已失效`);
  return command;
}
