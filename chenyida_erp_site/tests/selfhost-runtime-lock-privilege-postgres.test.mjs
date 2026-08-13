import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_RUNTIME_LOCK_PRIVILEGE_DATABASE_URL;
if (!databaseUrl || !/runtime_lock_privilege_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_RUNTIME_LOCK_PRIVILEGE_DATABASE_URL containing runtime_lock_privilege_test is required");
}

const OWNER_ROLE = "cyd_task56_migration_owner";
const WEB_GROUP_ROLE = "cyd_task56_web_group";
const WEB_LOGIN_ROLE = "cyd_task56_web_login";
const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const adminPool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "runtime-lock-privilege-admin-test" });

const WEB_LOCK_ROUTINES = Object.freeze([
  ["cyd_web_lock_final_output_sources", "bigint[]"],
  ["cyd_web_lock_finance_ar_source", "bigint"],
  ["cyd_web_lock_finance_settlement_reversal", "bigint, bigint"],
  ["cyd_web_lock_ncr_source", "bigint"],
  ["cyd_web_lock_operation_upstream_sources", "bigint, bigint"],
  ["cyd_web_lock_production_completion", "bigint"],
  ["cyd_web_lock_production_completion_lines", "bigint"],
  ["cyd_web_lock_production_reports", "bigint[]"],
  ["cyd_web_lock_quality_completion_allocation_source", "bigint"],
  ["cyd_web_lock_quality_completion_capacity", "bigint"],
  ["cyd_web_lock_quality_fqc_source", "bigint"],
  ["cyd_web_lock_quality_legacy_report_source", "bigint"],
  ["cyd_web_lock_quality_operation_source", "bigint"],
  ["cyd_web_lock_report_operation_sources", "bigint"],
  ["cyd_web_lock_sales_fqc_reversal_sources", "bigint[]"],
  ["cyd_web_lock_sales_shipment_reversal", "bigint"],
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

const LOCK_TARGETS = Object.freeze([
  "finance_opening_sources",
  "finance_settlements",
  "inventory_ledger_entries",
  "production_bom_snapshots",
  "production_completion_batches",
  "production_completion_lines",
  "production_completions",
  "production_operation_run_reports",
  "production_reports",
  "production_scrap_dispositions",
  "production_work_order_routing_snapshot_operations",
  "production_work_order_routing_snapshots",
  "purchase_financial_source_entries",
  "purchase_receipt_delivery_allocations",
  "sales_delivery_execution_lines",
  "sales_financial_source_entries",
  "sales_shipment_line_fqc_allocations",
  "sales_shipment_lines",
  "sales_shipments",
]);

let ownerPool;
let webPool;

function roleDatabaseUrl(role) {
  const value = new URL(databaseUrl);
  value.username = role;
  value.password = "";
  return value.toString();
}

async function applyMigrationsAsOwner() {
  const client = await adminPool.connect();
  try {
    await client.query(`set role ${OWNER_ROLE}`);
    await client.query("create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
    for (const name of migrationNames) {
      const source = await readFile(new URL(name, migrationDirectory), "utf8");
      const checksum = sha256(source);
      await client.query("begin");
      try {
        await client.query(source);
        await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    await client.query("reset role");
  } finally {
    client.release();
  }
}

async function setupFixture() {
  const client = await adminPool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role=replica");
    await client.query(`
      insert into public.finance_settlements(
        id,settlement_code,document_id,settlement_type,amount,accounting_date,account_name,
        operation_id,created_by,request_id
      ) values(9100001,'TASK56-LOCK',9200001,'RECEIPT',1,'2026-08-13','TASK56', $1,'task56',$2)
    `, [randomUUID(), randomUUID()]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test.before(async () => {
  assert.equal(migrationNames.length, 46);
  assert.equal(migrationNames.at(-1), "0046_runtime_lock_privilege_boundary.sql");
  const rolePresence = await adminPool.query("select rolname from pg_roles where rolname=any($1::text[]) order by rolname", [[OWNER_ROLE, WEB_GROUP_ROLE, WEB_LOGIN_ROLE]]);
  assert.deepEqual(rolePresence.rows, []);
  await adminPool.query("drop schema public cascade; create schema public");
  await adminPool.query(`create role ${OWNER_ROLE} login nosuperuser nocreatedb nocreaterole noinherit`);
  await adminPool.query(`create role ${WEB_GROUP_ROLE} nologin nosuperuser nocreatedb nocreaterole noinherit`);
  await adminPool.query(`create role ${WEB_LOGIN_ROLE} login nosuperuser nocreatedb nocreaterole noinherit`);
  await adminPool.query(`grant ${WEB_GROUP_ROLE} to ${WEB_LOGIN_ROLE}`);
  await adminPool.query(`alter schema public owner to ${OWNER_ROLE}`);
  const databaseName = (await adminPool.query("select current_database() name")).rows[0].name;
  assert.match(databaseName, /^[a-z_][a-z0-9_]{0,62}$/);
  await adminPool.query(`grant create on database "${databaseName}" to ${OWNER_ROLE}`);
  await applyMigrationsAsOwner();

  const owner = await adminPool.connect();
  try {
    await owner.query(`set role ${OWNER_ROLE}`);
    await owner.query(`grant usage on schema public to ${WEB_GROUP_ROLE}`);
    for (const [name, args] of WEB_LOCK_ROUTINES) {
      await owner.query(`grant execute on function public.${name}(${args}) to ${WEB_GROUP_ROLE}`);
    }
    await owner.query(`grant insert on table public.finance_settlements to ${WEB_GROUP_ROLE}`);
    await owner.query("reset role");
  } finally {
    owner.release();
  }

  await setupFixture();
  ownerPool = new Pool({ connectionString: roleDatabaseUrl(OWNER_ROLE), max: 2, application_name: "runtime-lock-privilege-owner-test" });
  webPool = new Pool({ connectionString: roleDatabaseUrl(WEB_LOGIN_ROLE), max: 3, application_name: "runtime-lock-privilege-web-test" });
});

test.after(async () => {
  await webPool?.end();
  await ownerPool?.end();
  try {
    await adminPool.query(`reassign owned by ${OWNER_ROLE} to postgres`);
    await adminPool.query(`drop owned by ${WEB_LOGIN_ROLE}`);
    await adminPool.query(`drop owned by ${WEB_GROUP_ROLE}`);
    await adminPool.query(`drop owned by ${OWNER_ROLE}`);
    await adminPool.query(`drop role ${WEB_LOGIN_ROLE}`);
    await adminPool.query(`drop role ${WEB_GROUP_ROLE}`);
    await adminPool.query(`drop role ${OWNER_ROLE}`);
  } finally {
    await adminPool.end();
  }
});

test("0046 installs an exact owner-controlled routine catalog", async () => {
  const ledger = await adminPool.query("select version,checksum from schema_migrations order by version");
  assert.equal(ledger.rowCount, 46);
  assert.equal(ledger.rows.at(-1).version, "0046_runtime_lock_privilege_boundary.sql");
  assert.equal(ledger.rows.at(-1).checksum, "ad68aaa4f20d16324fcdc7b234928ac363ecb73313921970d3b4840f4db6d66b");

  const webNames = WEB_LOCK_ROUTINES.map(([name]) => name);
  const routines = await adminPool.query(`
    select routine.proname,pg_catalog.oidvectortypes(routine.proargtypes) arguments,
      routine.prosecdef,routine.proconfig,owner.rolname owner,
      pg_catalog.has_function_privilege($1,routine.oid,'EXECUTE') group_execute,
      exists(
        select 1 from pg_catalog.aclexplode(routine.proacl) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) public_execute
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace and namespace.nspname='public'
    join pg_catalog.pg_roles owner on owner.oid=routine.proowner
    where routine.proname=any($2::text[])
    order by routine.proname
  `, [WEB_GROUP_ROLE, webNames]);
  assert.equal(routines.rowCount, WEB_LOCK_ROUTINES.length);
  assert.deepEqual(routines.rows.map((row) => [row.proname, row.arguments]), WEB_LOCK_ROUTINES);
  for (const row of routines.rows) {
    assert.equal(row.prosecdef, true, row.proname);
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog, public, pg_temp"], row.proname);
    assert.equal(row.owner, OWNER_ROLE, row.proname);
    assert.equal(row.group_execute, true, row.proname);
    assert.equal(row.public_execute, false, row.proname);
  }

  const triggerRoutines = await adminPool.query(`
    select routine.proname,routine.prosecdef,routine.proconfig,owner.rolname owner,
      pg_catalog.has_function_privilege($1,routine.oid,'EXECUTE') group_execute,
      exists(
        select 1 from pg_catalog.aclexplode(routine.proacl) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) public_execute
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace and namespace.nspname='public'
    join pg_catalog.pg_roles owner on owner.oid=routine.proowner
    where routine.proname=any($2::text[]) and routine.prorettype='pg_catalog.trigger'::pg_catalog.regtype
    order by routine.proname
  `, [WEB_GROUP_ROLE, DEFINER_TRIGGER_ROUTINES]);
  assert.deepEqual(triggerRoutines.rows.map((row) => row.proname), DEFINER_TRIGGER_ROUTINES);
  for (const row of triggerRoutines.rows) {
    assert.equal(row.prosecdef, true, row.proname);
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog, public, pg_temp"], row.proname);
    assert.equal(row.owner, OWNER_ROLE, row.proname);
    assert.equal(row.group_execute, false, row.proname);
    assert.equal(row.public_execute, false, row.proname);
  }
});

test("Web keeps zero table and column UPDATE privilege on every lock target", async () => {
  const result = await adminPool.query(`
    select relation.relname,
      pg_catalog.has_table_privilege($1,relation.oid,'UPDATE') table_update,
      exists(
        select 1
        from pg_catalog.pg_attribute attribute
        where attribute.attrelid=relation.oid and attribute.attnum>0 and not attribute.attisdropped
          and pg_catalog.has_column_privilege($1,relation.oid,attribute.attnum,'UPDATE')
      ) column_update
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
    where relation.relname=any($2::text[])
    order by relation.relname
  `, [WEB_GROUP_ROLE, LOCK_TARGETS]);
  assert.deepEqual(result.rows.map((row) => row.relname), LOCK_TARGETS);
  assert.equal(result.rows.every((row) => !row.table_update && !row.column_update), true);

  const client = await webPool.connect();
  try {
    await assert.rejects(
      client.query("select * from public.cyd_web_lock_finance_settlement_reversal(9100001,9200001)"),
      (error) => error.code === "42501",
    );
    await client.query(`set role ${WEB_GROUP_ROLE}`);
    await assert.rejects(
      client.query("update public.finance_settlements set id=id where id=9100001"),
      (error) => error.code === "42501",
    );
  } finally {
    client.release();
  }
});

test("all sixteen routines reject out-of-contract identifiers before relation access", async () => {
  const statements = [
    "select * from public.cyd_web_lock_final_output_sources(array[-1]::bigint[])",
    "select * from public.cyd_web_lock_finance_ar_source(-1)",
    "select * from public.cyd_web_lock_finance_settlement_reversal(-1,-1)",
    "select * from public.cyd_web_lock_ncr_source(-1)",
    "select * from public.cyd_web_lock_operation_upstream_sources(-1,null::bigint)",
    "select * from public.cyd_web_lock_production_completion(-1)",
    "select * from public.cyd_web_lock_production_completion_lines(-1)",
    "select * from public.cyd_web_lock_production_reports(array[-1]::bigint[])",
    "select * from public.cyd_web_lock_quality_completion_allocation_source(-1)",
    "select * from public.cyd_web_lock_quality_completion_capacity(-1)",
    "select * from public.cyd_web_lock_quality_fqc_source(-1)",
    "select * from public.cyd_web_lock_quality_legacy_report_source(-1)",
    "select * from public.cyd_web_lock_quality_operation_source(-1)",
    "select public.cyd_web_lock_report_operation_sources(-1)",
    "select * from public.cyd_web_lock_sales_fqc_reversal_sources(array[-1]::bigint[])",
    "select * from public.cyd_web_lock_sales_shipment_reversal(-1)",
  ];
  const client = await webPool.connect();
  try {
    await client.query(`set role ${WEB_GROUP_ROLE}`);
    for (const statement of statements) {
      await assert.rejects(client.query(statement), (error) => error.code === "22023", statement);
    }
    await assert.rejects(
      client.query("select * from public.cyd_web_lock_production_reports(array[1,1]::bigint[])"),
      (error) => error.code === "22023",
    );
  } finally {
    client.release();
  }
});

test("a Web routine row lock survives function return until the outer transaction ends", async () => {
  const web = await webPool.connect();
  const owner = await ownerPool.connect();
  try {
    await web.query(`set role ${WEB_GROUP_ROLE}`);
    await web.query("begin");
    const locked = await web.query("select * from public.cyd_web_lock_finance_settlement_reversal(9100001,9200001)");
    assert.deepEqual(locked.rows, [{
      id: "9100001",
      original_settlement_id: null,
      settlement_type: "RECEIPT",
      amount: "1.000000",
      account_name: "TASK56",
    }]);

    await owner.query("begin");
    await owner.query("set local lock_timeout='200ms'");
    await assert.rejects(
      owner.query("select id from public.finance_settlements where id=9100001 for update"),
      (error) => error.code === "55P03",
    );
    await owner.query("rollback");
    await web.query("rollback");

    await owner.query("begin");
    const released = await owner.query("select id from public.finance_settlements where id=9100001 for update");
    assert.deepEqual(released.rows, [{ id: "9100001" }]);
    await owner.query("rollback");
  } finally {
    await web.query("rollback").catch(() => undefined);
    await owner.query("rollback").catch(() => undefined);
    web.release();
    owner.release();
  }
});

test("definer triggers execute without caller EXECUTE and still reject invalid business facts", async () => {
  const client = await webPool.connect();
  try {
    await client.query(`set role ${WEB_GROUP_ROLE}`);
    await client.query("begin");
    await client.query("set local cyd.finance_service_write='allowed'");
    await assert.rejects(client.query(`
      insert into public.finance_settlements(
        id,settlement_code,document_id,settlement_type,amount,accounting_date,account_name,
        operation_id,created_by,request_id
      ) values(9100002,'TASK56-TRIGGER',9200002,'RECEIPT',1,'2026-08-13','TASK56',$1,'task56',$2)
    `, [randomUUID(), randomUUID()]), (error) => error.code === "P0001" && /finance settlement type mismatch/.test(error.message));
    await client.query("rollback");
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
  assert.equal((await adminPool.query("select count(*)::int count from public.finance_settlements where id=9100002")).rows[0].count, 0);
});
