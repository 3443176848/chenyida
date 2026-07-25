import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildOpeningCommands, assertOpeningCommandBindings } from "../tools/selfhost-migration/opening-commands.mjs";
import { validateFinanceOpening, validateInventoryOpening, MIGRATION_OPENING_CAPABILITIES } from "../tools/selfhost-migration/opening-rules.mjs";
import { fixtureRecords } from "../tools/selfhost-migration/synthetic-fixtures.mjs";
import { validateAndPlan } from "../tools/selfhost-migration/validator.mjs";
import { registryDigest } from "../tools/selfhost-migration/mapping-registry.mjs";
import { sha256 } from "../tools/selfhost-migration/digest.mjs";

const source = { kind: "SYNTHETIC_D1_EXPORT", snapshotSha256: "a".repeat(64), records: fixtureRecords("valid") };
const plan = validateAndPlan(source, registryDigest());
const migrations = [{ name: "0014_migration_openings.sql", sha256: "b".repeat(64) }];
const manifest = { migration_run_id: "11111111-1111-4111-8111-111111111111", source_snapshot_sha256: source.snapshotSha256 };

test("OPENING_PLAN becomes typed inventory and finance commands bound to every digest", () => {
  const bundle = buildOpeningCommands({ source, plan, manifest, targetMigrations: migrations });
  assert.equal(bundle.commands.filter((row) => row.command_type === "POST_INVENTORY_OPENING").length, 2);
  assert.deepEqual(bundle.commands.filter((row) => row.command_type === "POST_FINANCE_OPENING").map((row) => row.direction).sort(), ["AP", "AR"]);
  const command = bundle.commands[0];
  assertOpeningCommandBindings(command, { manifest_sha256: sha256(manifest), mapping_digest: plan.mapping_digest, target_digest: bundle.target_digest });
  assert.throws(() => assertOpeningCommandBindings(command, { mapping_digest: "c".repeat(64) }), { code: "MIGRATION_OPENING_COMMAND_STALE" });
  assert.match(command.source_record_digest, /^[0-9a-f]{64}$/); assert.match(command.source_stable_reference_digest, /^[0-9a-f]{64}$/);
});

test("inventory and finance opening rules reject precision, negatives, frozen excess, currency, and counterparty ambiguity", () => {
  const inventory = buildOpeningCommands({ source, plan, manifest, targetMigrations: migrations }).commands.find((row) => row.command_type === "POST_INVENTORY_OPENING");
  assert.equal(validateInventoryOpening(inventory), inventory);
  assert.throws(() => validateInventoryOpening({ ...inventory, on_hand_quantity: "-1" }), { code: "MIGRATION_OPENING_AMOUNT_INVALID" });
  assert.throws(() => validateInventoryOpening({ ...inventory, on_hand_quantity: "1.0000001" }), { code: "MIGRATION_OPENING_PRECISION_EXCEEDED" });
  assert.throws(() => validateInventoryOpening({ ...inventory, on_hand_quantity: "1", frozen_quantity: "2" }), { code: "MIGRATION_OPENING_FROZEN_EXCEEDS_ON_HAND" });
  const finance = buildOpeningCommands({ source, plan, manifest, targetMigrations: migrations }).commands.find((row) => row.direction === "AR");
  assert.equal(validateFinanceOpening(finance), finance);
  assert.throws(() => validateFinanceOpening({ ...finance, currency_code: "USD" }), { code: "MIGRATION_OPENING_CURRENCY_INVALID" });
  assert.throws(() => validateFinanceOpening({ ...finance, supplier_key: "SYN-SUP-001" }), { code: "MIGRATION_OPENING_COUNTERPARTY_INVALID" });
  assert.throws(() => validateFinanceOpening({ ...finance, opening_outstanding_amount: "0" }), { code: "MIGRATION_OPENING_AMOUNT_INVALID" });
});

test("migration capabilities stay internal and no HTTP handler exposes an opening write route", async () => {
  assert.deepEqual(MIGRATION_OPENING_CAPABILITIES, ["migration.opening.plan", "migration.opening.post", "migration.opening.reverse", "migration.opening.read"]);
  const inventoryHandler = await readFile(new URL("../app/lib/inventory-selfhost/handler.ts", import.meta.url), "utf8");
  const financeHandler = await readFile(new URL("../app/lib/finance-selfhost/handler.ts", import.meta.url), "utf8");
  assert.equal(/migration[_/-]opening/i.test(inventoryHandler), false);
  assert.equal(/migration[_/-]opening/i.test(financeHandler), false);
});
