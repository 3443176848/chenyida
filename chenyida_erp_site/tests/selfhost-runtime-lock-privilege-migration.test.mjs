import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const metadataDirectory = new URL("../drizzle-postgres/meta/", import.meta.url);
const siteRoot = new URL("../", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const WEB_LOCK_ROUTINES = Object.freeze([
  "cyd_web_lock_final_output_sources(bigint[])",
  "cyd_web_lock_finance_ar_source(bigint)",
  "cyd_web_lock_finance_settlement_reversal(bigint, bigint)",
  "cyd_web_lock_ncr_source(bigint)",
  "cyd_web_lock_operation_upstream_sources(bigint, bigint)",
  "cyd_web_lock_production_completion(bigint)",
  "cyd_web_lock_production_completion_lines(bigint)",
  "cyd_web_lock_production_reports(bigint[])",
  "cyd_web_lock_quality_completion_allocation_source(bigint)",
  "cyd_web_lock_quality_completion_capacity(bigint)",
  "cyd_web_lock_quality_fqc_source(bigint)",
  "cyd_web_lock_quality_legacy_report_source(bigint)",
  "cyd_web_lock_quality_operation_source(bigint)",
  "cyd_web_lock_report_operation_sources(bigint)",
  "cyd_web_lock_sales_fqc_reversal_sources(bigint[])",
  "cyd_web_lock_sales_shipment_reversal(bigint)",
]);

const DEFINER_TRIGGER_ROUTINES = Object.freeze([
  "cyd_finance_document_guard",
  "cyd_finance_settlement_guard",
  "cyd_finance_source_reversal_guard",
  "cyd_finished_goods_allocation_guard",
  "cyd_inventory_lot_fact_guard",
  "cyd_nonconformance_allocation_guard",
  "cyd_nonconformance_header_guard",
  "cyd_production_batch_set_guard",
  "cyd_production_completion_batch_guard",
  "cyd_production_final_output_allocation_guard",
  "cyd_production_operation_allocation_guard",
  "cyd_production_operation_run_guard",
  "cyd_production_report_batch_guard",
  "cyd_quality_source_guard",
  "cyd_rework_request_guard",
  "cyd_sales_delivery_execution_guard",
  "cyd_sales_fqc_allocation_guard",
  "cyd_sales_fqc_lot_guard",
  "cyd_sales_shipment_line_lot_guard",
  "cyd_warehouse_receipt_evidence_guard",
]);

const APPLICATION_SOURCES = Object.freeze([
  "app/lib/finance-selfhost/service.ts",
  "app/lib/production-nonconformance-selfhost/service.ts",
  "app/lib/production-operation-selfhost/service.ts",
  "app/lib/production-selfhost/service.ts",
  "app/lib/quality-selfhost/service.ts",
  "app/lib/sales-selfhost/service.ts",
]);

async function migrationSetSha256(names) {
  let combined = "";
  for (const name of names) {
    const source = await readFile(new URL(name, migrationDirectory));
    combined += `${name}\0${sha256(source)}\n`;
  }
  return sha256(combined);
}

function normalizeArguments(raw) {
  if (!raw.trim()) return "";
  return raw.split(",").map((argument) => argument.trim().split(/\s+/).at(-1).toLowerCase()).join(", ");
}

test("0046 is the sole append-only runtime lock privilege migration", async () => {
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.equal(names.length, 46);
  assert.equal(names.at(-1), "0046_runtime_lock_privilege_boundary.sql");
  assert.equal(await migrationSetSha256(names.slice(0, 45)), "3f862c23fc8544f0647fdf03fa6fd25dc5c6d20031be10cd6f25d991f25de875");
  assert.equal(sha256(await readFile(new URL(names.at(-1), migrationDirectory))), "ad68aaa4f20d16324fcdc7b234928ac363ecb73313921970d3b4840f4db6d66b");
});

test("0046 snapshot and journal preserve the relational schema", async () => {
  const journal = JSON.parse(await readFile(new URL("_journal.json", metadataDirectory), "utf8"));
  assert.equal(journal.entries.length, 46);
  assert.deepEqual(journal.entries.at(-1), {
    idx: 46,
    version: "7",
    when: journal.entries.at(-1).when,
    tag: "0046_runtime_lock_privilege_boundary",
    breakpoints: true,
  });
  assert.ok(Number.isSafeInteger(journal.entries.at(-1).when));

  const previous = JSON.parse(await readFile(new URL("0045_snapshot.json", metadataDirectory), "utf8"));
  const current = JSON.parse(await readFile(new URL("0046_snapshot.json", metadataDirectory), "utf8"));
  assert.equal(current.prevId, previous.id);
  assert.notEqual(current.id, previous.id);
  const { id: previousId, prevId: previousParent, ...previousSchema } = previous;
  const { id: currentId, prevId: currentParent, ...currentSchema } = current;
  void previousId; void previousParent; void currentId; void currentParent;
  assert.deepEqual(currentSchema, previousSchema);
});

test("0046 exposes exactly sixteen narrow lock routines with no direct Web ACL", async () => {
  const source = await readFile(new URL("0046_runtime_lock_privilege_boundary.sql", migrationDirectory), "utf8");
  const created = [...source.matchAll(/CREATE FUNCTION "public"\."(cyd_web_lock_[a-z0-9_]+)"\(([^)]*)\)/g)]
    .map((match) => `${match[1]}(${normalizeArguments(match[2])})`)
    .sort();
  assert.deepEqual(created, WEB_LOCK_ROUTINES);
  const revoked = [...source.matchAll(/REVOKE ALL ON FUNCTION "public"\."(cyd_web_lock_[a-z0-9_]+)"\(([^)]*)\) FROM PUBLIC;/g)]
    .map((match) => `${match[1]}(${normalizeArguments(match[2])})`)
    .sort();
  assert.deepEqual(revoked, WEB_LOCK_ROUTINES);
  assert.equal((source.match(/\n\s*SECURITY DEFINER\n/g) || []).length, WEB_LOCK_ROUTINES.length);
  assert.equal((source.match(/\n\s*SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'\n/g) || []).length, WEB_LOCK_ROUTINES.length);
  assert.doesNotMatch(source, /\bGRANT\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(source, /\bCREATE\s+TRIGGER\b/i);
  assert.match(source, /cardinality\(target_report_ids\) NOT BETWEEN 1 AND 100/g);
  assert.match(source, /cardinality\(target_shipment_line_ids\) NOT BETWEEN 1 AND 100/);
});

test("0046 pins the exact twenty locking trigger functions to an owner-safe execution path", async () => {
  const source = await readFile(new URL("0046_runtime_lock_privilege_boundary.sql", migrationDirectory), "utf8");
  const altered = [...source.matchAll(/ALTER FUNCTION "public"\."([a-z0-9_]+)"\(\) SECURITY DEFINER;/g)].map((match) => match[1]).sort();
  assert.deepEqual(altered, DEFINER_TRIGGER_ROUTINES);
  for (const routine of DEFINER_TRIGGER_ROUTINES) {
    assert.match(source, new RegExp(`ALTER FUNCTION "public"\\."${routine}"\\(\\) SET "search_path" TO 'pg_catalog', 'public', 'pg_temp';`));
    assert.match(source, new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${routine}"\\(\\) FROM PUBLIC;`));
  }
});

test("all application row-lock calls cross the frozen routine boundary", async () => {
  const found = new Set();
  for (const relativePath of APPLICATION_SOURCES) {
    const source = await readFile(new URL(relativePath, siteRoot), "utf8");
    for (const match of source.matchAll(/public\.(cyd_web_lock_[a-z0-9_]+)\(/g)) found.add(match[1]);
  }
  assert.deepEqual([...found].sort(), WEB_LOCK_ROUTINES.map((routine) => routine.slice(0, routine.indexOf("("))).sort());

  const allSources = await Promise.all(APPLICATION_SOURCES.map((relativePath) => readFile(new URL(relativePath, siteRoot), "utf8")));
  const joined = allSources.join("\n");
  const retiredDirectLockFragments = [
    "from finance_settlements where id=$1 and document_id=$2 for update",
    "where qi.id=$1 for update of qi,rr,run,op,wo",
    "order by r.id for update of r,op",
    "where rr.id=any($1::bigint[]) order by rr.id for update of run,rr,op",
    "where r.id=$1 for update of r,rp",
    "from production_completion_lines where completion_id=$1 order by id for update",
    "where c.id=$1 for update of c,p",
    "where a.id=$1 and a.status='ACTIVE' for update of a,pcl,cp,sol,so",
    "from sales_shipment_line_fqc_allocations where shipment_line_id=any($1::bigint[]) and entry_type='SHIPMENT' order by id for update",
    "where sh.id=$1 for update of sh,so",
  ];
  for (const fragment of retiredDirectLockFragments) assert.ok(!joined.includes(fragment), fragment);
});
