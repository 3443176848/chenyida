import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_FINANCE_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/finance_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_FINANCE_UPGRADE_DATABASE_URL containing finance_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "finance-migration-upgrade-test" });
const names = ["0001_selfhost_baseline.sql", "0002_material_master_workflow.sql", "0003_material_import_mapping.sql", "0004_material_import_normalization.sql", "0005_material_import_review.sql", "0006_identity_security.sql", "0007_master_data_bom.sql", "0008_inventory_ledger.sql", "0009_procurement.sql", "0010_production.sql", "0011_sales.sql", "0012_quality.sql", "0013_finance.sql"];
const expectedOld = [
  "c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702",
  "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80",
  "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf",
  "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39",
  "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc",
  "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079",
  "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6",
  "49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b",
  "351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7",
  "d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35",
  "6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b",
  "64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf",
];
const sources = new Map();
for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("empty database upgrades and repeats through immutable 0013", async () => {
  assert.deepEqual(names.slice(0, 12).map(checksum), expectedOld);
  await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('finance_documents') documents,to_regclass('finance_settlements') settlements,to_regclass('finance_document_events') events");
  assert.deepEqual(tables.rows[0], { documents: "finance_documents", settlements: "finance_settlements", events: "finance_document_events" });
  const triggers = await pool.query("select tgname from pg_trigger where not tgisinternal and tgname=any($1)", [["finance_documents_guard", "finance_settlements_immutable", "finance_settlements_consistency", "finance_document_events_immutable", "sales_finance_posting_guard", "purchase_finance_posting_guard"]]);
  assert.equal(triggers.rowCount, 6);
});

test("0012 data survives without inferred finance backfill", async () => {
  await reset(); await migrate(names.slice(0, 12));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('legacy_finance','旧财务','finance','test-only')");
  await pool.query("insert into erp_records(kind,code,data,created_by) values('financial_document','LEGACY-FIN',$1,'legacy_finance')", [{ source_type: "销售订单", source_id: 99, total_amount: 10 }]);
  await migrate(names.slice(12));
  assert.equal(Number((await pool.query("select count(*) count from erp_records where kind='financial_document'")).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*) count from finance_documents")).rows[0].count), 0);
});

test("0013 DDL failure rolls back and direct fact writes fail closed", async () => {
  await reset(); await migrate(names.slice(0, 12));
  await pool.query("create table finance_documents(id bigint primary key)");
  await assert.rejects(migrate(names.slice(12)), /finance_documents.*already exists/i);
  assert.equal((await pool.query("select to_regclass('finance_settlements') value")).rows[0].value, null);
  await pool.query("drop table finance_documents"); await migrate(names.slice(12));
  await assert.rejects(pool.query("insert into finance_document_events(document_id,event_type,to_status,created_by,request_id) values(1,'CREATED','OPEN','nobody',$1)", [randomUUID()]), /finance facts require FinanceService/i);
});
