import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import pg from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { FinanceRepository } from "../app/lib/finance-selfhost/repository.ts";
import { FinanceService } from "../app/lib/finance-selfhost/service.ts";
import { sha256, stableUuid } from "../tools/selfhost-migration/digest.mjs";
import { executeSyntheticCommit, executionInputDigest } from "../tools/selfhost-migration/executor.mjs";
import { writeSyntheticSqlite } from "../tools/selfhost-migration/synthetic-fixtures.mjs";
import { createManifest, migrationChecksums } from "../tools/selfhost-migration/manifest.mjs";
import { registryDigest } from "../tools/selfhost-migration/mapping-registry.mjs";
import { MigrationOpeningService } from "../tools/selfhost-migration/migration-opening-service.mjs";
import { PostgresTargetAdapter } from "../tools/selfhost-migration/target-postgres.mjs";
import { inspectSqliteSource } from "../tools/selfhost-migration/source-sqlite.mjs";
import { validateAndPlan } from "../tools/selfhost-migration/validator.mjs";

const { Pool } = pg;
const databaseUrl = process.env.TEST_MIGRATION_OPENINGS_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 12, application_name: "migration-openings-test" }) : null;
const siteRoot = resolve(import.meta.dirname, "..");
const temporaryRoots = new Set();
const actor = (role, username) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });
const meta = (role, username, action, route) => { const requestId = randomUUID(); const operationId = randomUUID(); return { actor: actor(role, username), requestId, operationId, keyDigest: sha256(`${action}:${operationId}`), requestDigest: sha256({ action, operationId }), method: "POST", route, action }; };

async function reset() {
  await pool.query("drop schema if exists migration_tool cascade");
  const tables = await pool.query("select string_agg(format('%I',tablename),',') names from pg_tables where schemaname='public' and tablename<>'schema_migrations'");
  if (tables.rows[0].names) await pool.query(`truncate ${tables.rows[0].names} restart identity cascade`);
}

async function materialize() {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), "chenyida_opening_source_migration_test_")); const workspace = await mkdtemp(resolve(tmpdir(), "chenyida_opening_work_migration_test_")); temporaryRoots.add(sourceRoot); temporaryRoots.add(workspace);
  const source = await inspectSqliteSource(await writeSyntheticSqlite(sourceRoot, "valid"), { ERP_ENV: "test" }); const targetMigrations = await migrationChecksums(resolve(siteRoot, "drizzle-postgres")); const plan = validateAndPlan(source, registryDigest());
  const inputDigest = executionInputDigest({ source, mappingDigest: registryDigest(), targetMigrations, plan }); const runId = randomUUID(); const manifest = await createManifest({ runId, source, targetGitCommit: "d".repeat(40), targetMigrations, executionMode: "SYNTHETIC_COMMIT" });
  const target = new PostgresTargetAdapter(databaseUrl, { ERP_ENV: "test" }); await target.inspect(targetMigrations); const result = await executeSyntheticCommit({ workspace, inputDigest, runId, source, plan, target, manifest }); await target.close();
  return { result, source, plan, manifest, targetMigrations };
}

async function installCurrentFinanceLockAdapterOnFrozenBaseline() {
  // The migration tool intentionally targets the immutable 0001-0017 baseline,
  // while the current FinanceService delegates this lock to the 0046 boundary.
  // Keep this compatibility object test-only; 0046 itself is exercised against
  // the current migration head by the runtime privilege and finance suites.
  await pool.query(`
    create or replace function public.cyd_web_lock_finance_settlement_reversal(target_settlement_id bigint,target_document_id bigint)
    returns table(id bigint,original_settlement_id bigint,settlement_type text,amount numeric(24,6),account_name text)
    language sql
    security definer
    set search_path to 'pg_catalog','public','pg_temp'
    as $function$
      select settlement.id,settlement.original_settlement_id,settlement.settlement_type,settlement.amount,settlement.account_name
      from public.finance_settlements as settlement
      where settlement.id=target_settlement_id and settlement.document_id=target_document_id
      for update of settlement
    $function$
  `);
  await pool.query("revoke all on function public.cyd_web_lock_finance_settlement_reversal(bigint,bigint) from public");
}

async function reconcileHistoricalInventory() {
  return pool.query(`select b.id balance_id,b.material_id,b.on_hand_qty::text,b.frozen_qty::text,
    coalesce(sum(l.on_hand_delta),0)::text ledger_on_hand_qty,coalesce(sum(l.frozen_delta),0)::text ledger_frozen_qty,
    (b.on_hand_qty=coalesce(sum(l.on_hand_delta),0) and b.frozen_qty=coalesce(sum(l.frozen_delta),0)) consistent
    from inventory_stock_balances b left join inventory_ledger_entries l on l.balance_id=b.id
    group by b.id order by b.id`);
}

async function postHistoricalInventoryIssue(source, quantity) {
  const issueMeta = meta("warehouse", "warehouse01", "INVENTORY_ADJUSTMENT_POSTED", "/api/inventory-adjustments");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.inventory_service_write','allowed',true)");
    const balance = await client.query("select * from inventory_stock_balances where material_id=$1 and location_code='MAIN' and lot_code='' for update", [source.material_id]);
    assert.equal(balance.rowCount, 1);
    assert.equal(Number(balance.rows[0].version), Number(source.version));
    const adjustment = await client.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values($1,'ISSUE',$2,$3,$4,$5) returning id", [`IA-HISTORICAL-${issueMeta.operationId.slice(0, 8).toUpperCase()}`, "Synthetic downstream consumption", issueMeta.operationId, issueMeta.actor.username, issueMeta.requestId]);
    const ledgerOperationId = randomUUID();
    const ledger = await client.query(`insert into inventory_ledger_entries(operation_id,adjustment_id,line_no,balance_id,material_id,unit_id,entry_type,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after,source_type,source_id,created_by,request_id)
      values($1,$2,1,$3,$4,$5,'ISSUE',-$6::numeric,0,$7,$7::numeric-$6::numeric,$8,$8,$9,$9+1,'INVENTORY_ADJUSTMENT',$2,$10,$11) returning id`, [ledgerOperationId, adjustment.rows[0].id, balance.rows[0].id, source.material_id, source.unit_id, quantity, balance.rows[0].on_hand_qty, balance.rows[0].frozen_qty, balance.rows[0].version, issueMeta.actor.username, issueMeta.requestId]);
    const updated = await client.query("update inventory_stock_balances set on_hand_qty=on_hand_qty-$2::numeric,version=version+1,last_ledger_entry_id=$3,updated_at=now() where id=$1 and version=$4 returning id", [balance.rows[0].id, quantity, ledger.rows[0].id, balance.rows[0].version]);
    assert.equal(updated.rowCount, 1);
    await client.query(`insert into inventory_adjustment_lines(adjustment_id,line_no,balance_id,ledger_entry_id,material_id,unit_id,requested_qty,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after)
      values($1,1,$2,$3,$4,$5,$6,-$6::numeric,0,$7,$7::numeric-$6::numeric,$8,$8,$9,$9+1)`, [adjustment.rows[0].id, balance.rows[0].id, ledger.rows[0].id, source.material_id, source.unit_id, quantity, balance.rows[0].on_hand_qty, balance.rows[0].frozen_qty, balance.rows[0].version]);
    await client.query("insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,retention_until) values($1,$2,$3,$4,'success','INVENTORY',$5,$6,now()+interval '1095 days')", [issueMeta.actor.username, issueMeta.action, { adjustment_id: Number(adjustment.rows[0].id), material_ids: [Number(source.material_id)] }, issueMeta.requestId, issueMeta.operationId, issueMeta.keyDigest]);
    await client.query("insert into idempotency_keys(key_digest,username,method,path,request_digest,status_code,response,expires_at) values($1,$2,$3,$4,$5,201,$6,now()+interval '24 hours')", [issueMeta.keyDigest, issueMeta.actor.username, issueMeta.method, issueMeta.route, issueMeta.requestDigest, { ok: true, adjustment_id: Number(adjustment.rows[0].id), request_id: issueMeta.requestId }]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

test.afterEach(async () => { await Promise.all([...temporaryRoots].map((path) => rm(path, { recursive: true, force: true }))); temporaryRoots.clear(); });
test.after(async () => pool?.end());

test("formal inventory and finance openings reconcile, settle, reverse, and fail closed", { skip: !databaseUrl }, async () => {
  await reset(); const fixture = await materialize(); assert.equal(fixture.result.state, "RECONCILED");
  const counts = await pool.query("select (select count(*)::int from migration_opening_sources) sources,(select count(*)::int from inventory_migration_openings) inventory,(select count(*)::int from finance_opening_sources) finance,(select count(*)::int from audit_log where route_code='MIGRATION_OPENING') audits");
  assert.deepEqual(counts.rows[0], { sources: 4, inventory: 2, finance: 2, audits: 4 });
  const reconciled = await reconcileHistoricalInventory(); assert.ok(reconciled.rows.every((row) => row.consistent));
  const balances = await pool.query(`select
    coalesce(sum(total_amount-settled_amount) filter(where doc_type in ('AR','OPENING_AR') and status<>'REVERSED'),0)::numeric(24,6)::text ar_balance,
    coalesce(sum(total_amount-settled_amount) filter(where doc_type in ('AP','OPENING_AP') and status<>'REVERSED'),0)::numeric(24,6)::text ap_balance
    from finance_documents`);
  assert.deepEqual(balances.rows[0], { ar_balance: "6.500000", ap_balance: "7.250000" });
  await assert.rejects(pool.query("insert into migration_opening_sources(id,migration_run_id,manifest_sha256,source_system,source_entity_kind,source_stable_reference_digest,source_record_digest,mapping_digest,target_digest,opening_type,cutoff_at,created_by,request_id,operation_id) values($1,$2,$3,'X','X',$3,$3,$3,$3,'AR',now(),'migration_opening_actor',$4,$5)", [randomUUID(), randomUUID(), "a".repeat(64), randomUUID(), randomUUID()]), /MigrationOpeningService/);
  await assert.rejects(pool.query("update finance_opening_sources set status='POSTED'"), /MigrationOpeningService|immutable/);

  await installCurrentFinanceLockAdapterOnFrozenBaseline();
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('finance01','Synthetic finance','finance','test-only'),('warehouse01','Synthetic warehouse','warehouse','test-only')");
  const finance = new FinanceService(new FinanceRepository(pool)); const ar = (await pool.query("select * from finance_documents where doc_type='OPENING_AR'")).rows[0];
  const ap = (await pool.query("select * from finance_documents where doc_type='OPENING_AP'")).rows[0]; const openingService = new MigrationOpeningService(pool, { environment: { ERP_ENV: "test" } });
  const concurrent = await Promise.allSettled([
    finance.settle(meta("finance", "finance01", "FINANCE_SETTLEMENT_CREATED", "/api/finance-settlements"), { document_id: Number(ap.id), expected_version: Number(ap.version), amount: "1.000000", accounting_date: "2026-01-02", account_name: "Synthetic account" }),
    openingService.reverseFinance({ finance_document_id: Number(ap.id), reason: "Concurrent synthetic correction", operation_id: randomUUID(), request_id: randomUUID(), created_by: "migration_opening_actor" }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const paid = await finance.settle(meta("finance", "finance01", "FINANCE_SETTLEMENT_CREATED", "/api/finance-settlements"), { document_id: Number(ar.id), expected_version: Number(ar.version), amount: "1.500000", accounting_date: "2026-01-02", account_name: "Synthetic account" });
  const financeReverse = { finance_document_id: Number(ar.id), reason: "Synthetic correction", operation_id: randomUUID(), request_id: randomUUID(), created_by: "migration_opening_actor" };
  await assert.rejects(openingService.reverseFinance(financeReverse), { code: "MIGRATION_OPENING_SETTLEMENTS_ACTIVE" });
  await finance.reverseSettlement(Number(paid.body.settlement_id), meta("finance", "finance01", "FINANCE_SETTLEMENT_REVERSED", `/api/finance-settlements/${paid.body.settlement_id}/reversal`), { expected_version: Number(paid.body.document_version), accounting_date: "2026-01-03", reason: "Synthetic correction" });
  const reversedFinance = await openingService.reverseFinance(financeReverse); assert.equal(reversedFinance.replayed, false);
  assert.equal((await pool.query("select status from finance_documents where id=$1", [ar.id])).rows[0].status, "REVERSED");

  const legal = (await pool.query("select o.id,l.material_id,l.unit_id,b.version from inventory_migration_openings o join inventory_migration_opening_lines l on l.inventory_opening_id=o.id join inventory_stock_balances b on b.material_id=l.material_id where l.frozen_quantity=0")).rows[0];
  const reversedInventory = await openingService.reverseInventory({ inventory_opening_id: Number(legal.id), reason: "Synthetic correction", operation_id: randomUUID(), request_id: randomUUID(), created_by: "migration_opening_actor" }); assert.equal(reversedInventory.replayed, false);
  assert.equal((await pool.query("select on_hand_qty from inventory_stock_balances where material_id=$1", [legal.material_id])).rows[0].on_hand_qty, "0.000000");

  const consumed = (await pool.query("select o.id,l.material_id,l.unit_id,b.version from inventory_migration_openings o join inventory_migration_opening_lines l on l.inventory_opening_id=o.id join inventory_stock_balances b on b.material_id=l.material_id where l.frozen_quantity>0")).rows[0];
  await postHistoricalInventoryIssue(consumed, "95.000000");
  await assert.rejects(openingService.reverseInventory({ inventory_opening_id: Number(consumed.id), reason: "Unsafe correction", operation_id: randomUUID(), request_id: randomUUID(), created_by: "migration_opening_actor" }), { code: "MIGRATION_OPENING_REVERSAL_UNSAFE" });
  assert.ok((await reconcileHistoricalInventory()).rows.every((row) => row.consistent));
});

test("concurrent post is idempotent while stale commands and injected failures fail closed", { skip: !databaseUrl }, async () => {
  await reset(); const fixture = await materialize();
  const source = await pool.query("select * from migration_opening_sources where opening_type='AR'"); const commands = (await import("../tools/selfhost-migration/opening-commands.mjs")).buildOpeningCommands({ source: fixture.source, plan: fixture.plan, manifest: fixture.manifest, targetMigrations: fixture.targetMigrations }).commands; const command = commands.find((row) => row.direction === "AR");
  const openingService = new MigrationOpeningService(pool, { environment: { ERP_ENV: "test" } });
  await assert.rejects(openingService.postFinance({ ...command, mapping_digest: "e".repeat(64) }), { code: "MIGRATION_OPENING_COMMAND_STALE" });
  await assert.rejects(openingService.postFinance({ ...command, source_record_digest: "f".repeat(64) }), { code: "MIGRATION_OPENING_COMMAND_STALE" });

  const inventoryCommand = commands.find((row) => row.command_type === "POST_INVENTORY_OPENING" && Number(row.frozen_quantity) === 0); const originalInventory = await pool.query("select o.id from inventory_migration_openings o join inventory_migration_opening_lines l on l.inventory_opening_id=o.id where l.frozen_quantity=0");
  await openingService.reverseInventory({ inventory_opening_id: Number(originalInventory.rows[0].id), reason: "Prepare synthetic concurrent replay", operation_id: randomUUID(), request_id: randomUUID(), created_by: "migration_opening_actor" });
  const concurrentInventory = { ...inventoryCommand, migration_opening_source_id: stableUuid("concurrent", "source"), source_stable_reference_digest: sha256("concurrent-source"), source_record_digest: sha256("concurrent-record"), operation_id: randomUUID(), request_id: randomUUID(), source_ref: "inventory_balance:concurrent" };
  await pool.query("insert into migration_tool.synthetic_records(target_id,source_system,source_kind,source_stable_key_digest,target_table,source_digest,target_digest,domain,payload,created_run_id) values($1,$2,$3,$4,'inventory_migration_openings',$5,$6,'inventory','{}',$7)", [stableUuid("concurrent", "staging"), concurrentInventory.source_system, concurrentInventory.source_entity_kind, concurrentInventory.source_stable_reference_digest, concurrentInventory.source_record_digest, sha256("concurrent-target"), concurrentInventory.migration_run_id]);
  const concurrentPosts = await Promise.all([openingService.postInventory(concurrentInventory), openingService.postInventory(concurrentInventory)]);
  assert.deepEqual(concurrentPosts.map((result) => result.replayed).sort(), [false, true]);

  const failed = { ...command, migration_opening_source_id: stableUuid("failure", "source"), source_stable_reference_digest: sha256("failure-source"), source_record_digest: sha256("failure-record"), business_reference_digest: sha256("failure-business"), operation_id: randomUUID(), request_id: randomUUID(), source_ref: "finance_opening:failure" };
  await pool.query("insert into migration_tool.synthetic_records(target_id,source_system,source_kind,source_stable_key_digest,target_table,source_digest,target_digest,domain,payload,created_run_id) values($1,$2,$3,$4,'finance_opening_sources',$5,$6,'finance','{}',$7)", [stableUuid("failure", "staging"), failed.source_system, failed.source_entity_kind, failed.source_stable_reference_digest, failed.source_record_digest, sha256("failure-target"), failed.migration_run_id]);
  const service = new MigrationOpeningService(pool, { environment: { ERP_ENV: "test" }, fault: (checkpoint) => { if (checkpoint === "after_finance_opening_document") throw new Error("synthetic injected failure"); } });
  await assert.rejects(service.postFinance(failed), /synthetic injected failure/);
  assert.equal(Number((await pool.query("select count(*) count from migration_opening_sources where id=$1", [failed.migration_opening_source_id])).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from finance_documents where operation_id=$1", [failed.operation_id])).rows[0].count), 0);
  assert.equal(source.rowCount, 1);
});
