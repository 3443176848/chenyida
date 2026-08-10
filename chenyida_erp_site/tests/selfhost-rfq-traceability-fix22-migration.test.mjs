import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_RFQ_TRACEABILITY_MIGRATION_DATABASE_URL || "";
const REQUIRED_DATABASE = "rfq_traceability_migration_test_fix22_20260805";
const REQUIRED_CONFIRMATION = "ISOLATED_FIX22_SYNTHETIC_ONLY";
let databaseName = "";
try {
  databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  databaseName = "";
}
if (databaseName !== REQUIRED_DATABASE) {
  throw new Error(`TEST_RFQ_TRACEABILITY_MIGRATION_DATABASE_URL must target the exact isolated ${REQUIRED_DATABASE} database`);
}
if (process.env.ERP_RFQ_TRACEABILITY_FIX22_MIGRATION_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_TRACEABILITY_FIX22_MIGRATION_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  application_name: "rfq-traceability-fix22-migration-test",
});
const directory = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 39).sort();
const sources = new Map(await Promise.all(names.map(async (name) => [
  name,
  await readFile(new URL(name, directory), "utf8"),
])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
const migrationName = "0039_rfq_traceability.sql";
const migration = sources.get(migrationName) || "";
const schemaSource = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const snapshot0038 = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0038_snapshot.json", import.meta.url), "utf8"));
const snapshot0039 = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0039_snapshot.json", import.meta.url), "utf8"));
const journal = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json", import.meta.url), "utf8"));

async function reset() {
  const current = (await pool.query("select current_database() name")).rows[0]?.name;
  assert.equal(current, databaseName);
  await pool.query(`drop schema public cascade;
    create schema public;
    create table schema_migrations(
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
}

async function migrate(list) {
  for (const name of list) {
    const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (existing.rows[0]) {
      assert.equal(existing.rows[0].checksum, checksum(name));
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sources.get(name));
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function migrationLedger() {
  return (await pool.query(`select version,checksum,
    to_char(applied_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') applied_at
    from schema_migrations order by version`)).rows;
}

async function seedLegacyDraftAt0038() {
  const client = await pool.connect();
  const rfqRequestId = randomUUID();
  try {
    await client.query("begin");
    await client.query(`select
      set_config('cyd.project_service_write','allowed',true),
      set_config('cyd.planning_service_write','allowed',true),
      set_config('cyd.material_requirement_service_write','allowed',true),
      set_config('cyd.procurement_sourcing_service_write','allowed',true)`);
    await client.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
      ('admin01','迁移管理员','admin','test-only',true,false,1),
      ('engineering01','迁移工程','engineering','test-only',true,false,1),
      ('planning01','迁移计划','planning','test-only',true,false,1),
      ('purchase01','迁移采购','purchase','test-only',true,false,1)`);

    const unit = (await client.query(
      "insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id",
    )).rows[0];
    const category = (await client.query(`insert into material_categories(
        category_code,category_name_cn,category_level,status,created_by,updated_by,request_id
      ) values('M39-COMP','0039 迁移物料',1,'ACTIVE','admin01','admin01',$1) returning id`,
    [randomUUID()])).rows[0];
    const material = (await client.query(`insert into material_master(
        internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,
        procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,
        last_modified_by,created_by,updated_by,request_id
      ) values('CYD-M39-000001','0039 迁移连接器',$1,'PCS',$2,'ACTIVE','PURCHASED','STOCKED',
        'IQC','RoHS','MANUAL','admin01','admin01','admin01',$3) returning id`,
    [category.id, unit.id, randomUUID()])).rows[0];
    const customer = (await client.query(`insert into customers(
        customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id
      ) values('CUS-M39','0039 迁移客户','0039 迁移客户','ACTIVE','admin01','admin01',$1) returning id`,
    [randomUUID()])).rows[0];
    const project = (await client.query(`insert into business_projects(
        project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,
        target_delivery_date,current_requirement_version_no,version,request_id,created_by
      ) values('PRJ-00000001',$1,'0039 迁移项目','验证历史 RFQ 草稿不被伪造回填','admin01',
        'engineering01','ACCEPTED','2026-12-31',1,4,$2,'admin01') returning id`,
    [customer.id, randomUUID()])).rows[0];
    const requirement = (await client.query(`insert into project_requirement_versions(
        project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by
      ) values($1,1,'0039 迁移测试需求',10,'PCS',$2,'admin01') returning id`,
    [project.id, digest("fix22-migration-requirement")])).rows[0];
    const packageRow = (await client.query(`insert into project_planning_packages(
        project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,
        prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id
      ) values($1,1,$2,'ACCEPTED','2026-12-31',$3,'engineering01','engineering01',now(),
        'planning01',now(),3,$4) returning id`,
    [project.id, requirement.id, digest("fix22-migration-package"), randomUUID()])).rows[0];
    const plan = (await client.query(`insert into planning_material_requirement_plans(
        project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
        source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
      ) values($1,$2,1,'2026-12-31','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
    [project.id, packageRow.id, digest("fix22-migration-package"), digest("fix22-migration-calculation"), randomUUID()])).rows[0];
    const planLine = (await client.query(`insert into planning_material_requirement_lines(
        plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,
        stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
      ) values($1,1,$2,$3,$4,$5,10,0,0,0,0,10,$6) returning id`, [
      plan.id,
      material.id,
      unit.id,
      { internal_material_code: "CYD-M39-000001", standard_name: "0039 迁移连接器" },
      digest("fix22-migration-material"),
      digest("fix22-migration-source"),
    ])).rows[0];
    const purchaseRequest = (await client.query(`insert into planning_purchase_requests(
        request_code,plan_id,status,submitted_by,submitted_at,version,request_id
      ) values('PRQ-00000001',$1,'SUBMITTED','planning01',now(),1,$2) returning id`,
    [plan.id, randomUUID()])).rows[0];
    const purchaseRequestLine = (await client.query(`insert into planning_purchase_request_lines(
        purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
      ) values($1,$2,1,$3,$4,10) returning id`,
    [purchaseRequest.id, planLine.id, material.id, unit.id])).rows[0];
    await client.query(`update planning_material_requirement_plans set
      status='ACCEPTED',accepted_by='purchase01',accepted_at=now(),version=version+1,updated_at=now()
      where id=$1`, [plan.id]);
    await client.query(`update planning_purchase_requests set
      status='ACCEPTED',accepted_by='purchase01',accepted_at=now(),updated_at=now() where id=$1`,
    [purchaseRequest.id]);
    await client.query(`insert into planning_material_requirement_events(
        plan_id,purchase_request_id,event_type,from_status,to_status,actor,request_id
      ) values($1,$2,'PURCHASE_ACCEPTED','SUBMITTED','ACCEPTED','purchase01',$3)`,
    [plan.id, purchaseRequest.id, randomUUID()]);
    const supplier = (await client.query(`insert into suppliers(
        supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id
      ) values('SUP-M39','0039 迁移供应商','0039 迁移供应商','ACTIVE','purchase01','purchase01',$1) returning id`,
    [randomUUID()])).rows[0];
    await client.query("set local session_replication_role=replica");
    await client.query(`insert into supplier_mappings(
      material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,
      conversion_numerator,conversion_denominator,status,valid_from,mapping_uid,created_by,updated_by,request_id
    ) values($1,$2,'0039 迁移供应商','SUP-M39','M39-PART-001','PCS',$3,1,1,'ACTIVE',
      now()-interval '1 day','00000000-0039-4000-8000-000000000001','purchase01','purchase01',$4)`,
    [material.id, supplier.id, unit.id, randomUUID()]);
    await client.query("set local session_replication_role=origin");

    const sourceDigest = digest("fix22-legacy-rfq-source");
    const rfq = (await client.query(`insert into procurement_rfqs(
        rfq_code,purchase_request_id,round_no,status,response_deadline,currency_code,
        source_purchase_request_version,source_digest,version,request_id,created_by
      ) values('RFQ-00000001',$1,1,'DRAFT','2026-12-15','CNY',1,$2,1,$3,'purchase01') returning id`,
    [purchaseRequest.id, sourceDigest, rfqRequestId])).rows[0];
    const rfqLine = (await client.query(`insert into procurement_rfq_lines(
        rfq_id,purchase_request_line_id,material_id,unit_id,requested_quantity,required_date,line_no,source_digest
      ) values($1,$2,$3,$4,10,'2026-12-31',1,$5) returning id`,
    [rfq.id, purchaseRequestLine.id, material.id, unit.id, sourceDigest])).rows[0];
    const rfqSupplier = (await client.query(`insert into procurement_rfq_suppliers(
        rfq_id,supplier_id,status,invited_by,supplier_mapping_digest
      ) values($1,$2,'INVITED','purchase01',$3) returning id`,
    [rfq.id, supplier.id, digest("fix22-legacy-mapping-digest")])).rows[0];
    await client.query(`insert into audit_log(
        username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,
        old_version,new_version,retention_until
      ) values('purchase01','RFQ_CREATED',jsonb_build_object('object_id',$1::bigint),$2,
        'success','PROCUREMENT_SOURCING',$3,$4,null,1,now()+interval '1095 days')`,
    [rfq.id, rfqRequestId, randomUUID(), digest("fix22-legacy-idempotency-key")]);
    await client.query("commit");
    return {
      rfqId: Number(rfq.id),
      rfqLineId: Number(rfqLine.id),
      rfqSupplierId: Number(rfqSupplier.id),
      supplierId: Number(supplier.id),
      materialId: Number(material.id),
      rfqRequestId,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function legacyDraftState(rfqId) {
  return (await pool.query(`select rfq.id::int,rfq.rfq_code,rfq.purchase_request_id::int,
      rfq.round_no::int,rfq.status,rfq.response_deadline::text,rfq.currency_code,
      rfq.source_purchase_request_version::int,rfq.source_digest,rfq.version::int,
      rfq.request_id::text,rfq.created_by,rfq.issued_by,rfq.issued_at,rfq.closed_at,
      (select count(*)::int from procurement_rfq_lines where rfq_id=rfq.id) line_count,
      (select count(*)::int from procurement_rfq_suppliers where rfq_id=rfq.id) supplier_count,
      (select count(*)::int from audit_log where request_id=rfq.request_id and action='RFQ_CREATED'
        and result='success' and detail->>'object_id'=rfq.id::text) creation_audit_count,
      (select count(*)::int from procurement_sourcing_events where rfq_id=rfq.id) event_count
    from procurement_rfqs rfq where rfq.id=$1`, [rfqId])).rows[0];
}

async function issueLegacyRfqAt0038(refs) {
  const client = await pool.connect();
  const eventRequestId = randomUUID();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    const issued = (await client.query(`update procurement_rfqs set
        status='ISSUED',issued_by='purchase01',issued_at=transaction_timestamp(),
        version=version+1,updated_at=transaction_timestamp()
      where id=$1 and status='DRAFT' and version=1 returning issued_at`, [refs.rfqId])).rows[0];
    assert.ok(issued?.issued_at);
    const event = (await client.query(`insert into procurement_sourcing_events(
        rfq_id,event_type,actor,request_id,created_at
      ) values($1,'RFQ_ISSUED','purchase01',$2,$3) returning id`, [
      refs.rfqId,
      eventRequestId,
      issued.issued_at,
    ])).rows[0];
    await client.query("commit");
    return { eventId: Number(event.id), eventRequestId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test.after(async () => pool.end());

test("empty database upgrades from 0001 to 0039 with the relationship and credential guards", { concurrency: false }, async () => {
  assert.equal(names.length, 39);
  assert.equal(names.at(-1), migrationName);
  assert.equal(checksum("0038_supplier_mapping_governance.sql"), "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941");
  assert.match(migration, /CREATE TABLE "procurement_rfq_supplier_line_mapping_bindings"/);
  assert.match(migration, /RFQ_CREATED/);
  assert.match(migration, /RFQ_MAPPING_CONFIRMED/);
  assert.match(migration, /RFQ Mapping bindings are immutable/);
  assert.match(migration, /new RFQ must be a generation-2 DRAFT created in the current service transaction/);
  assert.match(migration, /RFQ lifecycle credential requires one exact success Audit and Idempotency result/);
  assert.match(migration, /RFQ projection can advance CAS only once per transaction/);
  assert.doesNotMatch(migration, /insert\s+into\s+"?procurement_rfq_supplier_line_mapping_bindings"?/i);
  assert.doesNotMatch(migration, /insert\s+into\s+"?procurement_sourcing_events"?/i);

  await reset();
  await migrate(names);
  const schema = (await pool.query(`select
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) head,
      to_regclass('public.procurement_rfq_supplier_line_mapping_bindings') binding_table,
      to_regprocedure('cyd_procurement_rfq_mapping_binding_guard()') binding_guard,
      to_regprocedure('cyd_procurement_sourcing_event_credential_guard()') event_guard,
      to_regprocedure('cyd_procurement_rfq_traceability_commit_guard()') commit_guard,
      (select column_default from information_schema.columns where table_schema='public'
        and table_name='procurement_rfqs' and column_name='traceability_version') traceability_default,
      (select count(*)::int from information_schema.columns where table_schema='public'
        and table_name='procurement_sourcing_events' and column_name=any(array[
          'credential_version','result','idempotency_key_digest','old_version','new_version','from_status','to_status','scope_digest'
        ])) event_credential_column_count,
      (select count(*)::int from pg_indexes where schemaname='public' and indexname=any(array[
        'procurement_sourcing_events_rfq_created_uq','procurement_sourcing_events_rfq_mapping_confirmed_uq',
        'procurement_sourcing_events_rfq_issued_uq','procurement_rfq_mapping_bindings_supplier_line_uq',
        'procurement_rfq_mapping_bindings_rfq_supplier_line_uq'
      ])) critical_index_count,
      (select count(*)::int from pg_trigger where not tgisinternal and tgname=any(array[
        'procurement_rfqs_traceability_commit_guard','procurement_rfq_mapping_bindings_commit_guard',
        'procurement_sourcing_events_traceability_commit_guard','procurement_rfq_lines_traceability_insert_guard',
        'procurement_rfq_suppliers_traceability_insert_guard'
      ])) traceability_trigger_count`)).rows[0];
  assert.deepEqual(schema, {
    migration_count: 39,
    head: migrationName,
    binding_table: "procurement_rfq_supplier_line_mapping_bindings",
    binding_guard: "cyd_procurement_rfq_mapping_binding_guard()",
    event_guard: "cyd_procurement_sourcing_event_credential_guard()",
    commit_guard: "cyd_procurement_rfq_traceability_commit_guard()",
    traceability_default: "2",
    event_credential_column_count: 8,
    critical_index_count: 5,
    traceability_trigger_count: 5,
  });
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from procurement_sourcing_events")).rows[0].count), 0);
});

test("a repeated 0039 runner is a checksum-verified no-op", { concurrency: false }, async () => {
  await reset();
  await migrate(names);
  const before = await migrationLedger();
  const beforeSchema = (await pool.query(`select
      (select count(*)::int from pg_tables where schemaname='public') table_count,
      (select count(*)::int from information_schema.columns where table_schema='public'
        and table_name='procurement_sourcing_events') event_column_count,
      (select count(*)::int from pg_indexes where schemaname='public') index_count`)).rows[0];
  await migrate(names);
  assert.deepEqual(await migrationLedger(), before);
  assert.deepEqual((await pool.query(`select
      (select count(*)::int from pg_tables where schemaname='public') table_count,
      (select count(*)::int from information_schema.columns where table_schema='public'
        and table_name='procurement_sourcing_events') event_column_count,
      (select count(*)::int from pg_indexes where schemaname='public') index_count`)).rows[0], beforeSchema);
});

test("0038 to 0039 preserves an existing DRAFT and invents neither Mapping bindings nor RFQ_CREATED", { concurrency: false }, async () => {
  await reset();
  await migrate(names.slice(0, 38));
  assert.equal((await pool.query("select version from schema_migrations order by version desc limit 1")).rows[0].version,
    "0038_supplier_mapping_governance.sql");
  const refs = await seedLegacyDraftAt0038();
  const before = await legacyDraftState(refs.rfqId);
  assert.deepEqual({
    status: before.status,
    version: before.version,
    line_count: before.line_count,
    supplier_count: before.supplier_count,
    creation_audit_count: before.creation_audit_count,
    event_count: before.event_count,
  }, {
    status: "DRAFT",
    version: 1,
    line_count: 1,
    supplier_count: 1,
    creation_audit_count: 1,
    event_count: 0,
  });

  await migrate([migrationName]);
  assert.deepEqual(await legacyDraftState(refs.rfqId), before);
  assert.equal((await pool.query("select traceability_version from procurement_rfqs where id=$1", [refs.rfqId])).rows[0].traceability_version, 1);
  assert.equal(Number((await pool.query(
    "select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1",
    [refs.rfqId],
  )).rows[0].count), 0);
  assert.equal(Number((await pool.query(
    "select count(*) count from supplier_mappings where supplier_id=$1 and material_id=$2 and status='ACTIVE'",
    [refs.supplierId, refs.materialId],
  )).rows[0].count), 1);
  assert.equal(Number((await pool.query(
    "select count(*) count from procurement_sourcing_events where rfq_id=$1 and event_type in ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED')",
    [refs.rfqId],
  )).rows[0].count), 0);
  assert.deepEqual((await pool.query(`select status,version,issued_by,issued_at from procurement_rfqs where id=$1`,
    [refs.rfqId])).rows[0], { status: "DRAFT", version: 1, issued_by: null, issued_at: null });

  const insertBinding = (boundAtExpression, requestIdExpression) => `insert into procurement_rfq_supplier_line_mapping_bindings(
      rfq_id,rfq_supplier_id,rfq_line_id,supplier_id,material_id,supplier_mapping_version_id,
      mapping_uid,mapping_version_no,mapping_row_version,mapping_content_digest,supplier_part_number,
      purchase_unit_id,conversion_numerator,conversion_denominator,valid_from,valid_to,
      binding_source,binding_status,bound_by,bound_at,request_id
    ) select rfq.id,scope.id,line.id,scope.supplier_id,line.material_id,mapping.id,
      mapping.mapping_uid,mapping.mapping_version_no,mapping.version,mapping.content_digest,
      mapping.supplier_item_code,mapping.purchase_unit_id,mapping.conversion_numerator,
      mapping.conversion_denominator,mapping.valid_from,mapping.valid_to,$2,'ACTIVE','purchase01',
      ${boundAtExpression},${requestIdExpression}
    from procurement_rfqs rfq
    join procurement_rfq_suppliers scope on scope.rfq_id=rfq.id
    join procurement_rfq_lines line on line.rfq_id=rfq.id
    join supplier_mappings mapping on mapping.supplier_id=scope.supplier_id
      and mapping.material_id=line.material_id and mapping.purchase_unit_id=line.unit_id
    where rfq.id=$1`;
  let fraudClient = await pool.connect();
  try {
    await fraudClient.query("begin");
    await fraudClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await assert.rejects(fraudClient.query(insertBinding("rfq.created_at", "rfq.request_id"), [
      refs.rfqId, "RFQ_CREATE",
    ]), /RFQ create Mapping binding provenance mismatch/i);
    await fraudClient.query("rollback");
  } finally {
    await fraudClient.query("rollback").catch(() => undefined);
    fraudClient.release();
  }

  fraudClient = await pool.connect();
  try {
    await fraudClient.query("begin");
    await fraudClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    await fraudClient.query(insertBinding("now()", "$3"), [refs.rfqId, "LEGACY_DRAFT_CONFIRMATION", randomUUID()]);
    await assert.rejects(fraudClient.query("commit"), /RFQ_MAPPING_CONFIRMED credential/i);
    await fraudClient.query("rollback").catch(() => undefined);
  } finally {
    await fraudClient.query("rollback").catch(() => undefined);
    fraudClient.release();
  }
  assert.equal(Number((await pool.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [refs.rfqId])).rows[0].count), 0);
});

test("0039 preserves an unbound historical ISSUED RFQ and permits later sourcing lifecycle work", { concurrency: false }, async () => {
  await reset();
  await migrate(names.slice(0, 38));
  const refs = await seedLegacyDraftAt0038();
  const issuedRef = await issueLegacyRfqAt0038(refs);
  await migrate([migrationName]);

  assert.deepEqual((await pool.query(`select status,version,traceability_version,issued_by,
      issued_at is not null issued,closed_at from procurement_rfqs where id=$1`, [refs.rfqId])).rows[0], {
    status: "ISSUED",
    version: 2,
    traceability_version: 1,
    issued_by: "purchase01",
    issued: true,
    closed_at: null,
  });
  assert.deepEqual((await pool.query(`select id::int,event_type,credential_version,result,
      idempotency_key_digest,old_version,new_version,from_status,to_status,scope_digest
    from procurement_sourcing_events where id=$1`, [issuedRef.eventId])).rows[0], {
    id: issuedRef.eventId,
    event_type: "RFQ_ISSUED",
    credential_version: 1,
    result: "SUCCESS",
    idempotency_key_digest: null,
    old_version: null,
    new_version: null,
    from_status: null,
    to_status: null,
    scope_digest: null,
  });

  const downstreamClient = await pool.connect();
  try {
    await downstreamClient.query("begin");
    await downstreamClient.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)");
    for (const eventType of ["QUOTE_SUBMITTED", "COMPARISON_GENERATED", "AWARDED"]) {
      await downstreamClient.query(`insert into procurement_sourcing_events(
          rfq_id,event_type,actor,request_id
        ) values($1,$2,'purchase01',$3)`, [refs.rfqId, eventType, randomUUID()]);
    }
    await downstreamClient.query(`update procurement_rfqs set
        status='CLOSED',closed_at=transaction_timestamp(),version=version+1,
        updated_at=transaction_timestamp()
      where id=$1 and status='ISSUED' and version=2`, [refs.rfqId]);
    await downstreamClient.query("commit");
  } finally {
    await downstreamClient.query("rollback").catch(() => undefined);
    downstreamClient.release();
  }

  assert.deepEqual((await pool.query(
    "select status,version,closed_at is not null closed from procurement_rfqs where id=$1",
    [refs.rfqId],
  )).rows[0], { status: "CLOSED", version: 3, closed: true });
  assert.equal(Number((await pool.query(
    "select count(*) count from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1",
    [refs.rfqId],
  )).rows[0].count), 0);
  assert.deepEqual((await pool.query(`select event_type,credential_version,count(*)::int count
      from procurement_sourcing_events where rfq_id=$1
      group by event_type,credential_version order by event_type`, [refs.rfqId])).rows, [
    { event_type: "AWARDED", credential_version: 1, count: 1 },
    { event_type: "COMPARISON_GENERATED", credential_version: 1, count: 1 },
    { event_type: "QUOTE_SUBMITTED", credential_version: 1, count: 1 },
    { event_type: "RFQ_ISSUED", credential_version: 1, count: 1 },
  ]);
  assert.equal(Number((await pool.query(`select count(*) count from procurement_sourcing_events
    where rfq_id=$1 and event_type in ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED')`, [refs.rfqId])).rows[0].count), 0);
});

test("0039 DDL collision rolls back every event expansion and keeps the legacy draft", { concurrency: false }, async () => {
  await reset();
  await migrate(names.slice(0, 38));
  const refs = await seedLegacyDraftAt0038();
  const before = await legacyDraftState(refs.rfqId);
  await pool.query("create table procurement_rfq_supplier_line_mapping_bindings(dummy integer)");

  await assert.rejects(migrate([migrationName]), /procurement_rfq_supplier_line_mapping_bindings.*already exists/i);
  assert.equal(Number((await pool.query(
    "select count(*) count from schema_migrations where version=$1",
    [migrationName],
  )).rows[0].count), 0);
  assert.equal(Number((await pool.query(`select count(*) count from information_schema.columns
    where table_schema='public' and table_name='procurement_sourcing_events'
      and column_name in ('credential_version','result','idempotency_key_digest','old_version','new_version','from_status','to_status','scope_digest')`)).rows[0].count), 0);
  assert.equal((await pool.query("select to_regprocedure('cyd_procurement_rfq_mapping_binding_guard()') value")).rows[0].value, null);
  assert.equal((await pool.query("select to_regprocedure('cyd_procurement_sourcing_event_credential_guard()') value")).rows[0].value, null);
  assert.deepEqual((await pool.query(`select column_name,data_type from information_schema.columns
    where table_schema='public' and table_name='procurement_rfq_supplier_line_mapping_bindings'
    order by ordinal_position`)).rows, [{ column_name: "dummy", data_type: "integer" }]);
  assert.doesNotMatch((await pool.query(`select pg_get_constraintdef(oid) definition from pg_constraint
    where conrelid='procurement_sourcing_events'::regclass and conname='procurement_sourcing_events_type_ck'`)).rows[0].definition,
  /RFQ_CREATED|RFQ_MAPPING_CONFIRMED/);
  assert.deepEqual(await legacyDraftState(refs.rfqId), before);
});

test("schema, snapshot, and migration journal describe the same 0039 traceability model", { concurrency: false }, () => {
  assert.equal(snapshot0039.prevId, snapshot0038.id);
  const entry = journal.entries.find((candidate) => candidate.idx === 39);
  assert.equal(entry?.idx, 39);
  assert.equal(entry?.tag, "0039_rfq_traceability");
  const rfq = snapshot0039.tables["public.procurement_rfqs"];
  const event = snapshot0039.tables["public.procurement_sourcing_events"];
  const binding = snapshot0039.tables["public.procurement_rfq_supplier_line_mapping_bindings"];
  assert.deepEqual(rfq.columns.traceability_version, {
    name: "traceability_version", type: "integer", primaryKey: false, notNull: true, default: 2,
  });
  for (const name of ["procurement_rfqs_traceability_version_ck", "procurement_rfqs_issue_ck", "procurement_rfqs_close_ck"]) {
    assert.ok(rfq.checkConstraints[name], name);
  }
  for (const name of ["credential_version", "result", "idempotency_key_digest", "old_version", "new_version", "from_status", "to_status", "scope_digest"]) {
    assert.ok(event.columns[name], name);
  }
  assert.equal(binding.columns.mapping_content_digest.notNull, false);
  for (const name of ["proc_rfq_map_binding_rfq_fk", "proc_rfq_map_binding_mapping_version_fk", "proc_rfq_map_binding_mapping_identity_fk"]) {
    assert.ok(binding.foreignKeys[name], name);
  }
  for (const name of ["procurement_rfq_mapping_bindings_supplier_line_uq", "procurement_rfq_mapping_bindings_rfq_supplier_line_uq"]) {
    assert.ok(binding.indexes[name]?.isUnique, name);
  }
  for (const token of ["traceabilityVersion: integer(\"traceability_version\").notNull().default(2)", "procurement_rfqs_issue_ck", "procurement_rfqs_close_ck", "procurementRfqSupplierLineMappingBindings", "mappingContentDigest: text(\"mapping_content_digest\")"]) {
    assert.match(schemaSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const token of ["DEFERRABLE INITIALLY DEFERRED", "cyd_procurement_rfq_traceability_commit_guard", "transaction_timestamp()", "Asia/Shanghai"]) {
    assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
