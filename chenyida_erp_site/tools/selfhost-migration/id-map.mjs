import { sha256, stableUuid } from "./digest.mjs";
import { fail } from "./errors.mjs";

export class InMemoryIdMap {
  constructor(sourceSystem, runId) { this.sourceSystem = sourceSystem; this.runId = runId; this.entries = new Map(); }
  register({ sourceKind, sourceStableKey, targetTable, sourceDigest, targetDigest }) {
    const key = `${this.sourceSystem}\0${sourceKind}\0${sha256(sourceStableKey)}`;
    const existing = this.entries.get(key);
    if (existing && existing.source_digest !== sourceDigest) fail("MIGRATION_SOURCE_CHANGED", "stable key 对应 source digest 已变化");
    if (existing) return existing;
    const entry = { source_system: this.sourceSystem, source_kind: sourceKind, source_stable_key_digest: sha256(sourceStableKey), target_table: targetTable, target_id: stableUuid("chenyida-selfhost-migration", `${this.sourceSystem}\0${sourceKind}\0${sourceStableKey}`), mapping_status: "MAPPED", source_digest: sourceDigest, target_digest: targetDigest, migration_run_id: this.runId };
    this.entries.set(key, entry); return entry;
  }
}
