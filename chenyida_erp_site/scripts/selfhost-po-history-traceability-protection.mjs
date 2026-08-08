import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementFulfillmentApi } from "../app/lib/procurement-fulfillment-selfhost/handler.ts";

const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_HOST = "postgres";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRMATION = "MAIN_UAT_PO1_HISTORY_READ_ONLY";
const databaseUrl = process.env.ERP_PO_HISTORY_DATABASE_URL || "";
const parsed = databaseUrl ? new URL(databaseUrl) : null;

if (process.env.ERP_PO_HISTORY_PROTECTION_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_PO_HISTORY_PROTECTION_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)
  || parsed.hostname !== REQUIRED_HOST || Number(parsed.port || "5432") !== 5432
  || decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== REQUIRED_DATABASE) {
  throw new Error(`PO history protection must target ${REQUIRED_HOST}/${REQUIRED_DATABASE}`);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "po-history-protection-readonly" });
const expectedMaterials = [
  ["1", "1", "2", "1", "1", "533", "CYD-RB_PCB-000016", "1", "224d1965-44ef-4c3e-901e-1926b6b07ff8"],
  ["2", "2", "4", "2", "2", "534", "CYD-RB_SENSOR-000003", "2", "43ca04d8-9933-4dac-ba21-b7fb85741830"],
  ["3", "3", "6", "3", "3", "535", "CYD-RB_CONN-000075", "3", "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e"],
  ["4", "4", "8", "4", "4", "536", "CYD-RB_METAL-000015", "4", "9659ad2d-406a-4c4c-b575-51329badc63f"],
];
const expectedZero = {
  receipt: 0, warehouse_receipt: 0, inventory_ledger: 0, lot: 0, iqc: 0,
  ap: 0, payment: 0, work_order: 0, production_report: 0, production_completion: 0,
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

async function protectedDatabaseState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const connection = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) head_version,
      (select count(*)::int from app_sessions where username=$1 and revoked_at is null and expires_at>now()) active_purchase_sessions`, [REQUIRED_USERNAME])).rows[0];
    const po = (await client.query(`select po.id::text purchase_order_id,po.po_code,po.version::int,po.status,
      po.supplier_id::text supplier_id,supplier.supplier_code,supplier.supplier_name,po.currency_code,
      po.remark,po.created_by,to_char(po.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at_shanghai,
      po.request_id::text request_id,source.source_operation_id::text conversion_operation_id
      from purchase_orders po join suppliers supplier on supplier.id=po.supplier_id
      join purchase_order_source_links source on source.purchase_order_id=po.id where po.id=1`)).rows[0];
    const lines = (await client.query(`select po_line.id::text po_line_id,link.award_line_id::text award_line_id,
      candidate.id::text candidate_id,quote_line.id::text quote_line_id,binding.id::text binding_id,
      po_line.material_id::text material_id,material.internal_material_code material_code,
      binding.supplier_mapping_version_id::text mapping_fact_id,binding.mapping_uid::text mapping_uuid,
      binding.mapping_version_no::int mapping_version,binding.mapping_row_version::int mapping_row_cas,
      po_line.order_qty::text quantity,po_line.received_qty::text received_quantity,
      po_line.unit_price::text unit_price,(po_line.order_qty*po_line.unit_price)::numeric(30,6)::text line_amount,
      award_line.promised_delivery_date::text planned_delivery_date
      from purchase_order_lines po_line
      join procurement_award_po_line_links link on link.purchase_order_line_id=po_line.id
      join procurement_sourcing_award_lines award_line on award_line.id=link.award_line_id
      join procurement_quote_comparison_lines candidate on candidate.comparison_id=award_line.comparison_id
        and candidate.quote_line_id=award_line.selected_quote_line_id and candidate.supplier_id=award_line.supplier_id
      join procurement_supplier_quote_lines quote_line on quote_line.id=award_line.selected_quote_line_id
      join procurement_sourcing_awards award on award.id=award_line.award_id
      join procurement_rfq_supplier_line_mapping_bindings binding on binding.rfq_id=award.rfq_id
        and binding.rfq_line_id=award_line.rfq_line_id and binding.supplier_id=award_line.supplier_id
      join material_master material on material.id=po_line.material_id
      where po_line.purchase_order_id=1 order by po_line.id`)).rows;
    const plans = (await client.query(`select plan.id::text plan_id,plan.purchase_order_line_id::text po_line_id,
      link.award_line_id::text award_line_id,plan.material_id::text material_id,plan.planned_quantity::text quantity,
      plan.received_quantity::text received_quantity,plan.promised_delivery_date::text planned_delivery_date,
      plan.status,plan.version::int,plan.created_by actor,
      to_char(plan.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai,
      plan.request_id::text request_id,event.id::text event_id,queue.id::text queue_id,queue.version::int queue_version,
      queue.closed_at is null queue_open
      from purchase_delivery_plans plan
      join procurement_award_po_line_links link on link.purchase_order_line_id=plan.purchase_order_line_id
      join purchase_delivery_plan_events event on event.delivery_plan_id=plan.id and event.event_type='CREATED'
      join warehouse_receiving_queue_entries queue on queue.delivery_plan_id=plan.id
      where plan.purchase_order_id=1 order by plan.id`)).rows;
    const counts = (await client.query(`select
      (select count(*)::int from purchase_orders) purchase_orders,
      (select count(*)::int from purchase_order_lines where purchase_order_id=1) purchase_order_lines,
      (select count(*)::int from purchase_delivery_plans where purchase_order_id=1) delivery_plans,
      (select count(*)::int from warehouse_receiving_queue_entries queue join purchase_delivery_plans plan on plan.id=queue.delivery_plan_id where plan.purchase_order_id=1) queues,
      (select count(*)::int from purchase_receipts where purchase_order_id=1) receipts,
      (select count(*)::int from purchase_receipt_lines line join purchase_receipts receipt on receipt.id=line.purchase_receipt_id where receipt.purchase_order_id=1) warehouse_receipts,
      (select count(*)::int from inventory_ledger_entries ledger join purchase_receipt_lines line on line.inventory_ledger_entry_id=ledger.id join purchase_receipts receipt on receipt.id=line.purchase_receipt_id where receipt.purchase_order_id=1) ledger,
      (select count(*)::int from quality_inspections inspection join purchase_receipt_lines line on line.id=inspection.purchase_receipt_line_id join purchase_receipts receipt on receipt.id=line.purchase_receipt_id where receipt.purchase_order_id=1 and inspection.inspection_type='IQC') iqc,
      (select count(*)::int from finance_documents document join purchase_financial_source_entries source on source.id=document.purchase_source_entry_id join purchase_receipts receipt on receipt.id=source.purchase_receipt_id where receipt.purchase_order_id=1 and document.doc_type='AP') ap,
      (select count(*)::int from production_work_orders) work_orders`)).rows[0];
    await client.query("commit");
    return { connection, po, lines, plans, counts };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function historyFor(username) {
  const actor = {
    username, display_name: username, role: "purchase", is_active: true,
    must_change_password: false, version: 1, last_login_at: null,
    permissions: permissionsForRole("purchase"),
  };
  const requestId = randomUUID();
  const response = await handleProcurementFulfillmentApi(
    new Request("http://readonly.local/api/procurement/purchase-orders/1/history"),
    { pool, actor, requestId, requireCsrf: () => { throw new Error("read-only route requested CSRF"); } },
  );
  assert.ok(response);
  return { response, payload: await response.json() };
}

function assertHistory(history) {
  assert.equal(history.contract_version, "PO_HISTORY_TRACEABILITY_V1");
  assert.equal(history.read_only, true);
  assert.equal(history.governance_boundary.authorization_verified, false);
  assert.deepEqual(history.purchase_order, {
    ...history.purchase_order,
    purchase_order_id: "1", po_code: "PO-00000001", version: 1, status: "OPEN", status_label: "处理中",
    supplier_id: "1", supplier_code: "SUP-000001", supplier_name: "UAT快速交付供应商A-042576",
    currency_code: "CNY", tax_included: false, tax_label: "未税", freight_included: false,
    freight_label: "不含运费", payment_terms: "纯虚拟UAT付款条件，仅用于表单验收。",
    ordered_quantity: "40.000000", received_quantity: "0.000000", unit_code: "PCS",
    total_amount: "480.000000", remark: "纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。",
    created_by: REQUIRED_USERNAME, created_at_shanghai: "2026-08-08 14:11:45.086372",
    request_id: "773c23b6-0923-4ab5-a451-bb80aa4bdf9d",
    conversion_operation_id: "ac0638af-3263-4c3d-93c0-7327033ce71c",
    conversion_action: "SOURCING_AWARD_CONVERTED", po_convertible_now: false,
  });
  assert.deepEqual({
    project: history.lineage.project.id, mrp: history.lineage.material_requirement_plan.id,
    prq: history.lineage.purchase_request.id, rfq: history.lineage.rfq.id,
    rfq_version: history.lineage.rfq.version, comparison: history.lineage.comparison.version,
    quote: history.lineage.quote.id, quote_version: history.lineage.quote.version,
    award: history.lineage.award.id, award_version: history.lineage.award.version,
    po: history.lineage.purchase_order.id, po_version: history.lineage.purchase_order.version,
  }, { project: "1", mrp: "1", prq: "1", rfq: "1", rfq_version: 7, comparison: 1, quote: "1", quote_version: 1, award: "1", award_version: 1, po: "1", po_version: 1 });
  assert.deepEqual(history.digests, {
    comparison_output_digest: "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec",
    persisted_award_digest: "7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55",
    derived_award_decision_digest: "7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a",
    derived_award_decision_rule: "AWARD_DECISION_V1",
  });
  assert.deepEqual(history.supplier_summaries.map((supplier) => [supplier.label, supplier.supplier_id, supplier.line_count, supplier.total_amount]), [
    ["Supplier A", "1", 4, "480.000000"], ["Supplier B", "2", 0, "0.000000"],
  ]);
  assert.deepEqual(history.lines.map((line) => [line.purchase_order_line_id, line.award_line_id, line.candidate_id,
    line.quote_line_id, line.binding_id, line.material_id, line.material_code, line.mapping_fact_id, line.mapping_uuid]), expectedMaterials);
  assert.ok(history.lines.every((line) => line.supplier_label === "Supplier A" && line.quantity === "10.000000"
    && line.received_quantity === "0.000000" && line.unit_code === "PCS" && line.unit_price === "12.000000"
    && line.line_amount === "120.000000" && line.currency_code === "CNY" && line.planned_delivery_date === "2026-10-20"
    && line.mapping_version === 1 && line.mapping_row_cas === 3));
  assert.equal(history.line_summary.duplicate_material, false);
  assert.equal(history.delivery_model.has_independent_delivery_plan_line, false);
  assert.deepEqual(history.delivery_plans.map((plan) => [plan.delivery_plan_id, plan.purchase_order_line_id,
    plan.award_line_id, plan.plan_event_id, plan.queue_id]), [1, 2, 3, 4].map((id) => [String(id), String(id), String(id), String(id), String(id)]));
  assert.ok(history.delivery_plans.every((plan) => plan.status === "PENDING" && plan.version === 1
    && plan.quantity === "10.000000" && plan.received_quantity === "0.000000" && plan.unit_code === "PCS"
    && plan.planned_delivery_date === "2026-10-20" && plan.actor === REQUIRED_USERNAME
    && plan.occurred_at_shanghai === "2026-08-08 14:11:45.086372"
    && plan.request_id === "773c23b6-0923-4ab5-a451-bb80aa4bdf9d"
    && plan.plan_event_type === "CREATED" && plan.queue_status === "OPEN_PENDING" && plan.queue_version === 1));
  assert.deepEqual(history.credentials.purchase_order_event, {
    event_id: "1", event_type: "CREATED", from_status: null, to_status: "OPEN",
    actor: REQUIRED_USERNAME, occurred_at_shanghai: "2026-08-08 14:11:45.086372",
    request_id: "773c23b6-0923-4ab5-a451-bb80aa4bdf9d", result: "SUCCESS",
    result_source: "EXACT_SUCCESS_AUDIT_IN_SAME_TRANSACTION",
  });
  assert.deepEqual(history.credentials.audit, {
    audit_id: "1491", action: "SOURCING_AWARD_CONVERTED", result: "SUCCESS", actor: REQUIRED_USERNAME,
    occurred_at_shanghai: "2026-08-08 14:11:45.086372", request_id: "773c23b6-0923-4ab5-a451-bb80aa4bdf9d",
    operation_id: "ac0638af-3263-4c3d-93c0-7327033ce71c",
  });
  assert.equal(history.credentials.idempotency.http_status, 201);
  assert.equal(history.credentials.idempotency.key_digest, "214d55782672b8e03da9ed80a983ea31572b9ae367b89e2d4a8f2df385b3df2d");
  assert.equal(history.credentials.idempotency.request_digest, "7afef61364304b15c4cb313d708aa2dd0cbef3bc47f44bb65ef028ef8e6c527a");
  assert.deepEqual({
    available: history.credentials.historical_failed_attempt.available,
    relation: history.credentials.historical_failed_attempt.relation,
    request_id: history.credentials.historical_failed_attempt.request_id,
    result: history.credentials.historical_failed_attempt.result,
    http_status: history.credentials.historical_failed_attempt.http_status,
    business_record_count: history.credentials.historical_failed_attempt.business_record_count,
  }, { available: true, relation: "UNBOUND_PRIOR_ATTEMPT", request_id: "f30a7801-1cd0-4849-95a8-9c61d5c52e67", result: "FAILED", http_status: 422, business_record_count: 0 });
  for (const [key, value] of Object.entries(expectedZero)) assert.equal(history.downstream[key], value, key);
  assert.equal(history.downstream.all_zero, true);
}

try {
  const before = await protectedDatabaseState();
  assert.deepEqual(before.connection, {
    database_name: REQUIRED_DATABASE, transaction_read_only: "on", migration_count: 39,
    head_version: "0039_rfq_traceability.sql", active_purchase_sessions: 0,
  });
  assert.deepEqual(before.po, {
    purchase_order_id: "1", po_code: "PO-00000001", version: 1, status: "OPEN", supplier_id: "1",
    supplier_code: "SUP-000001", supplier_name: "UAT快速交付供应商A-042576", currency_code: "CNY",
    remark: "纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。", created_by: REQUIRED_USERNAME,
    created_at_shanghai: "2026-08-08 14:11:45.086372", request_id: "773c23b6-0923-4ab5-a451-bb80aa4bdf9d",
    conversion_operation_id: "ac0638af-3263-4c3d-93c0-7327033ce71c",
  });
  assert.equal(before.lines.length, 4);assert.equal(before.plans.length, 4);
  assert.deepEqual(before.counts, { purchase_orders: 1, purchase_order_lines: 4, delivery_plans: 4, queues: 4, receipts: 0, warehouse_receipts: 0, ledger: 0, iqc: 0, ap: 0, work_orders: 0 });
  const first = await historyFor(REQUIRED_USERNAME);
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));assertHistory(first.payload.data);
  const reopened = await historyFor(REQUIRED_USERNAME);
  assert.equal(reopened.response.status, 200);assertHistory(reopened.payload.data);
  const denied = await historyFor("uat_po_cross_scope_probe");
  assert.equal(denied.response.status, 403);assert.equal(denied.payload.code, "PERMISSION_DENIED");
  assert.doesNotMatch(JSON.stringify(denied.payload), /SUP-000001|214d5578|7afef613|773c23b6/);
  assert.ok(!permissionsForRole("purchase").includes("system.audit.read"));
  const after = await protectedDatabaseState();
  assert.deepEqual(after, before);
  const stateFingerprint = fingerprint(before);
  const historyFingerprint = fingerprint({ ...first.payload.data, observed_at: undefined });
  console.info(JSON.stringify({ ok: true, state_fingerprint: stateFingerprint, history_fingerprint: historyFingerprint,
    po_id: 1, po_code: "PO-00000001", po_status: "OPEN", amount: "480.00 CNY", lines: 4, plans: 4,
    queues: 4, downstream_zero: true, refresh_reopen: true, cross_domain_403: true,
    purchase_system_audit_read: false, business_post: 0, unchanged: true }));
} finally { await pool.end(); }
