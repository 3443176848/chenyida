import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.ERP_FIX20_DATABASE_URL || process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX20_DATABASE_URL or DATABASE_URL is required");
const databaseName = (process.env.ERP_FIX20_DATABASE_NAME || "").trim();
if (databaseName && !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
  throw new Error("ERP_FIX20_DATABASE_NAME must be a safe PostgreSQL database name");
}
const expectedHead = process.env.ERP_FIX20_EXPECTED_HEAD || "0038";
if (!["0037", "0038"].includes(expectedHead)) throw new Error("ERP_FIX20_EXPECTED_HEAD must be 0037 or 0038");
const connectionUrl = new URL(databaseUrl);
if (databaseName) connectionUrl.pathname = `/${databaseName}`;

const expectedMigration = expectedHead === "0037"
  ? {
      migration_count: 37,
      head_version: "0037_project_planning_revision_response_lineage.sql",
      head_checksum: "139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f",
      public_table_count: 223,
    }
  : {
      migration_count: 38,
      head_version: "0038_supplier_mapping_governance.sql",
      head_checksum: "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941",
      public_table_count: 225,
    };

const pool = new Pool({ connectionString: connectionUrl.toString(), max: 1, application_name: "supplier-mapping-fix20-protection" });
const client = await pool.connect();
try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");

  const migration = (await client.query(`select count(*)::int migration_count,max(version) head_version,
    (array_agg(checksum order by version desc))[1] head_checksum,
    (select count(*)::int from pg_tables where schemaname='public') public_table_count
    from schema_migrations`)).rows[0];
  assert.deepEqual(migration, expectedMigration);

  const purchaseRequest = (await client.query(`select id::int,request_code,status
    from planning_purchase_requests where id=1`)).rows[0];
  assert.deepEqual(purchaseRequest, { id: 1, request_code: "PRQ-00000001", status: "ACCEPTED" });
  const purchaseDecisions = (await client.query(`select
    count(*) filter(where event_type='PURCHASE_ACCEPTED')::int accepted,
    count(*) filter(where event_type='PURCHASE_RETURNED')::int returned
    from planning_material_requirement_events where purchase_request_id=1`)).rows[0];
  assert.deepEqual(purchaseDecisions, { accepted: 1, returned: 0 });

  const suppliers = (await client.query(`select id::int,supplier_code,status from suppliers where id in (1,2) order by id`)).rows;
  assert.deepEqual(suppliers, [
    { id: 1, supplier_code: "SUP-000001", status: "ACTIVE" },
    { id: 2, supplier_code: "SUP-000002", status: "ACTIVE" },
  ]);
  const materials = (await client.query(`select id::int,internal_material_code,material_status,base_uom,base_unit_id::int
    from material_master where id in (533,534,535,536) order by id`)).rows;
  assert.deepEqual(materials, [
    { id: 533, internal_material_code: "CYD-RB_PCB-000016", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
    { id: 534, internal_material_code: "CYD-RB_SENSOR-000003", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
    { id: 535, internal_material_code: "CYD-RB_CONN-000075", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
    { id: 536, internal_material_code: "CYD-RB_METAL-000015", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
  ]);
  const targetMappings = Number((await client.query(`select count(*) count from supplier_mappings
    where supplier_id in (1,2) and material_id in (533,534,535,536)`)).rows[0].count);
  assert.equal(targetMappings, 0);

  const failures = (await client.query(`select request_id::text,action,result,error_code,detail='{}'::jsonb detail_empty
    from audit_log where request_id in (
      'e2d8caab-a39d-4756-894b-329ae548e3f5'::uuid,
      '1f8c3cf4-22f9-4b39-a0ed-d25a742e3e28'::uuid
    ) order by request_id`)).rows;
  assert.deepEqual(failures, [
    { request_id: "1f8c3cf4-22f9-4b39-a0ed-d25a742e3e28", action: "RFQ_CREATED", result: "failed", error_code: "SUPPLIER_MAPPING_REQUIRED", detail_empty: true },
    { request_id: "e2d8caab-a39d-4756-894b-329ae548e3f5", action: "RFQ_CREATED", result: "failed", error_code: "REQUEST_VALIDATION_FAILED", detail_empty: true },
  ]);

  const downstream = (await client.query(`select
    (select count(*)::int from procurement_rfqs) rfq,
    (select count(*)::int from procurement_supplier_quotes) quote,
    (select count(*)::int from procurement_sourcing_awards) award,
    (select count(*)::int from purchase_orders) purchase_order,
    (select count(*)::int from purchase_delivery_plans) delivery_plan,
    (select count(*)::int from purchase_receipts) receipt,
    (select count(*)::int from inventory_ledger_entries) ledger,
    (select count(*)::int from finance_documents where doc_type='AP') ap,
    (select count(*)::int from production_work_orders) work_order`)).rows[0];
  assert.deepEqual(downstream, { rfq: 0, quote: 0, award: 0, purchase_order: 0, delivery_plan: 0, receipt: 0, ledger: 0, ap: 0, work_order: 0 });
  const identity = (await client.query(`select count(*)::int users,
    count(*) filter(where is_active)::int active_users,
    count(*) filter(where must_change_password)::int must_change_password,
    (select count(*)::int from app_sessions where revoked_at is null and expires_at>now()) active_sessions
    from app_users`)).rows[0];
  assert.deepEqual(identity, { users: 14, active_users: 12, must_change_password: 9, active_sessions: 0 });

  const protectedBusinessState = {
    purchase_request: purchaseRequest,
    purchase_decisions: purchaseDecisions,
    suppliers,
    materials,
    target_mapping_count: targetMappings,
    failures,
    downstream,
    identity,
  };
  const businessFingerprint = createHash("sha256").update(JSON.stringify(protectedBusinessState)).digest("hex");
  console.info(JSON.stringify({
    business_fingerprint: businessFingerprint,
    migration,
    target_mapping_count: targetMappings,
    downstream,
    active_sessions: identity.active_sessions,
  }));
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
