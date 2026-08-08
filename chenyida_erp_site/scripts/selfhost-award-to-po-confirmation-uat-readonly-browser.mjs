import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_DATABASE_HOST = "postgres";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRMATION = "MAIN_UAT_AWARD1_MAPPING_QUALIFICATION_CANCEL_ONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const WORKSPACE_PATH = "/procurement/fulfillment";
const SESSION_PATH = "/api/session";
const PENDING_AWARDS_PATH = "/api/procurement/fulfillment/pending-awards?page_size=100";
const ORDERS_PATH = "/api/procurement/fulfillment/orders?page_size=100";
const PREVIEW_PATH = "/api/procurement/awards/1/purchase-order-conversion-preview";
const COMPARISON_DIGEST = "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec";
const PERSISTED_AWARD_DIGEST = "7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55";
const DECISION_DIGEST = "7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a";
const AWARD_REQUEST_ID = "4634fff1-988d-465b-92c6-34ffe214ddda";
const FAILED_CONVERSION_REQUEST_ID = "f30a7801-1cd0-4849-95a8-9c61d5c52e67";
const AWARD_TIME_SHANGHAI = "2026-08-07 20:02:24.641511";
const PAYMENT_TERMS = "纯虚拟UAT付款条件，仅用于表单验收。";
const UAT_REMARK = "纯虚拟UAT采购订单，仅用于黑盒验收，不对应真实采购。";
const EXPECTED_QUOTES = [
  { quote_id: "1", quote_version_no: 1, supplier_id: "1", supplier_code: "SUP-000001", supplier_name: "UAT快速交付供应商A-042576", reference: "UAT-Q-A-042576" },
  { quote_id: "2", quote_version_no: 1, supplier_id: "2", supplier_code: "SUP-000002", supplier_name: "UAT低价延期供应商B-042576", reference: "UAT-Q-B-042576" },
];
const EXPECTED_LINES = [
  { award_line_id: "1", rfq_line_id: "1", comparison_line_id: "1", candidate_id: "2", quote_line_id: "1", rfq_binding_id: "1", material_id: "533", material_code: "CYD-RB_PCB-000016", material_name: "UAT-BB-MAT-PCBA-042576 · UAT控制板组件", mapping_uuid: "224d1965-44ef-4c3e-901e-1926b6b07ff8", mapping_fact_id: "1", supplier_part_number: "UAT-A-PCBA-042576" },
  { award_line_id: "2", rfq_line_id: "2", comparison_line_id: "2", candidate_id: "4", quote_line_id: "2", rfq_binding_id: "2", material_id: "534", material_code: "CYD-RB_SENSOR-000003", material_name: "UAT-BB-MAT-SENSOR-042576 · UAT温湿度传感器", mapping_uuid: "43ca04d8-9933-4dac-ba21-b7fb85741830", mapping_fact_id: "2", supplier_part_number: "UAT-A-SENSOR-042576" },
  { award_line_id: "3", rfq_line_id: "3", comparison_line_id: "3", candidate_id: "6", quote_line_id: "3", rfq_binding_id: "3", material_id: "535", material_code: "CYD-RB_CONN-000075", material_name: "UAT-BB-MAT-HARNESS-042576 · UAT 12V测试线束", mapping_uuid: "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e", mapping_fact_id: "3", supplier_part_number: "UAT-A-HARNESS-042576" },
  { award_line_id: "4", rfq_line_id: "4", comparison_line_id: "4", candidate_id: "8", quote_line_id: "4", rfq_binding_id: "4", material_id: "536", material_code: "CYD-RB_METAL-000015", material_name: "UAT-BB-MAT-CASE-042576 · UAT测试外壳", mapping_uuid: "9659ad2d-406a-4c4c-b575-51329badc63f", mapping_fact_id: "4", supplier_part_number: "UAT-A-CASE-042576" },
];

if (process.env.ERP_AWARD_PO_CONFIRMATION_UAT_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_AWARD_PO_CONFIRMATION_UAT_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_AWARD_PO_CONFIRMATION_DATABASE_URL || "";
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
if (!parsedDatabaseUrl || !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)
  || parsedDatabaseUrl.hostname !== REQUIRED_DATABASE_HOST || Number(parsedDatabaseUrl.port || "5432") !== 5432
  || process.env.ERP_AWARD_PO_CONFIRMATION_DATABASE_NAME !== REQUIRED_DATABASE
  || decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")) !== REQUIRED_DATABASE) {
  throw new Error(`Award to PO UAT database guards must target the exact ${REQUIRED_DATABASE} database`);
}

async function purchaseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1 || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical Purchase UAT credential metadata is invalid");
  }
  const document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  const matches = Array.isArray(document?.accounts)
    ? document.accounts.filter((account) => account?.username === REQUIRED_USERNAME && account?.role === "purchase")
    : [];
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
    || matches[0].must_change_password !== false) {
    throw new Error("the exact active canonical Purchase UAT credential is required");
  }
  return { username: REQUIRED_USERNAME, password: matches[0].password };
}

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      if (loaded.chromium || loaded.default?.chromium) return loaded.chromium || loaded.default.chromium;
    } catch { /* continue through the controlled module candidates */ }
  }
  throw new Error("Playwright is required in the Award to PO Mapping validation readonly UAT runner");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: "award-to-po-mapping-validation-uat-readonly",
});

async function readProtectedState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const schema = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) head_version,
      (select count(*)::int from app_sessions where username=$1 and revoked_at is null and expires_at>now()) active_purchase_sessions`, [REQUIRED_USERNAME])).rows[0];
    const rfq = (await client.query(`select id::text id,rfq_code,round_no::int,status,version::int
      from procurement_rfqs where id=1`)).rows[0];
    const quotes = (await client.query(`select quote.id::text quote_id,quote.quote_version_no::int,
      quote.supplier_id::text supplier_id,supplier.supplier_code,supplier.supplier_name,
      quote.supplier_quote_reference reference,quote.status,quote.currency_code,quote.payment_terms,
      quote.tax_included,quote.freight_included
      from procurement_supplier_quotes quote join suppliers supplier on supplier.id=quote.supplier_id
      where quote.rfq_id=1 order by quote.id`)).rows;
    const award = (await client.query(`select award.id::text award_id,award.rfq_id::text rfq_id,
      award.status,award.version::int,award.award_digest,award.selected_by,
      to_char(award.selected_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') selected_at_shanghai,
      award.request_id::text request_id
      from procurement_sourcing_awards award where award.id=1 and award.rfq_id=1`)).rows[0];
    const awardLines = (await client.query(`select line.id::text award_line_id,
      line.rfq_line_id::text rfq_line_id,line.comparison_id::text comparison_line_id,
      candidate.id::text candidate_id,line.selected_quote_line_id::text quote_line_id,
      quote.id::text quote_id,quote.quote_version_no::int quote_version_no,
      line.supplier_id::text supplier_id,supplier.supplier_code,
      rfq_line.material_id::text material_id,material.internal_material_code,material.standard_name,
      unit.code unit_code,line.selected_quantity::text selected_quantity,
      line.selected_unit_price::text selected_unit_price,
      (line.selected_quantity*line.selected_unit_price)::numeric(30,6)::text line_amount,
      quote.currency_code,line.promised_delivery_date::text promised_delivery_date
      from procurement_sourcing_award_lines line
      join procurement_sourcing_awards award on award.id=line.award_id and award.id=1 and award.rfq_id=1
      join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id and rfq_line.rfq_id=award.rfq_id
      join material_master material on material.id=rfq_line.material_id
      join units unit on unit.id=rfq_line.unit_id
      join procurement_quote_comparison_lines candidate on candidate.comparison_id=line.comparison_id
        and candidate.quote_line_id=line.selected_quote_line_id and candidate.supplier_id=line.supplier_id
      join procurement_supplier_quote_lines quote_line on quote_line.id=line.selected_quote_line_id
      join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
      join suppliers supplier on supplier.id=line.supplier_id
      order by line.id`)).rows;
    const mappingQualificationFacts = (await client.query(`select
      line.id::text award_line_id,candidate.id::text candidate_id,
      line.selected_quote_line_id::text quote_line_id,binding.id::text rfq_binding_id,
      binding.supplier_id::text supplier_id,supplier.supplier_code,supplier.status supplier_status,
      binding.material_id::text material_id,material.internal_material_code,material.material_status,
      binding.mapping_uid::text mapping_uuid,binding.supplier_mapping_version_id::text mapping_fact_id,
      binding.mapping_version_no::int mapping_version_no,binding.mapping_row_version::int mapping_row_cas,
      binding.mapping_content_digest binding_content_digest,binding.binding_status,
      binding.supplier_part_number binding_supplier_part_number,
      binding.purchase_unit_id::text binding_purchase_unit_id,
      binding.conversion_numerator::text binding_conversion_numerator,
      binding.conversion_denominator::text binding_conversion_denominator,
      to_char(binding.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') binding_valid_from,
      case when binding.valid_to is null then null else to_char(binding.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end binding_valid_to,
      mapping.id::text current_mapping_fact_id,mapping.supplier_id::text current_mapping_supplier_id,
      mapping.material_id::text current_mapping_material_id,mapping.mapping_uid::text current_mapping_uuid,
      mapping.mapping_version_no::int current_mapping_version_no,mapping.version::int current_mapping_row_cas,
      mapping.content_digest,mapping.status mapping_status,mapping.supplier_item_code supplier_part_number,
      mapping.purchase_unit_id::text purchase_unit_id,supplier_unit.code supplier_unit_code,
      supplier_unit.enabled supplier_unit_enabled,internal_unit.id::text internal_unit_id,internal_unit.code internal_unit_code,
      internal_unit.enabled internal_unit_enabled,mapping.conversion_numerator::text conversion_numerator,
      mapping.conversion_denominator::text conversion_denominator,
      to_char(mapping.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
      case when mapping.valid_to is null then null else to_char(mapping.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to,
      supplier_material_conflict.conflict_count supplier_material_conflict_count,
      supplier_part_conflict.conflict_count supplier_part_number_conflict_count
      from procurement_sourcing_award_lines line
      join procurement_sourcing_awards award on award.id=line.award_id and award.id=1 and award.rfq_id=1
      join procurement_quote_comparison_lines candidate on candidate.comparison_id=line.comparison_id
        and candidate.quote_line_id=line.selected_quote_line_id and candidate.supplier_id=line.supplier_id
      join procurement_rfq_supplier_line_mapping_bindings binding on binding.rfq_id=award.rfq_id
        and binding.rfq_line_id=line.rfq_line_id and binding.supplier_id=line.supplier_id
      join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
      join suppliers supplier on supplier.id=binding.supplier_id
      join material_master material on material.id=binding.material_id
      join units supplier_unit on supplier_unit.id=mapping.purchase_unit_id
      join units internal_unit on ((material.base_unit_id is not null and internal_unit.id=material.base_unit_id)
        or (material.base_unit_id is null and nullif(btrim(material.base_uom),'') is not null
          and upper(internal_unit.code)=upper(btrim(material.base_uom))))
      left join lateral (select count(*)::int conflict_count from supplier_mappings conflict
        where conflict.id<>mapping.id and conflict.supplier_id=mapping.supplier_id
          and conflict.material_id=mapping.material_id and conflict.status='ACTIVE'
          and conflict.valid_from<=transaction_timestamp()
          and (conflict.valid_to is null or conflict.valid_to>transaction_timestamp())) supplier_material_conflict on true
      left join lateral (select count(*)::int conflict_count from supplier_mappings conflict
        where conflict.id<>mapping.id and conflict.supplier_id=mapping.supplier_id
          and conflict.supplier_item_code_normalized=mapping.supplier_item_code_normalized
          and conflict.status='ACTIVE' and conflict.valid_from<=transaction_timestamp()
          and (conflict.valid_to is null or conflict.valid_to>transaction_timestamp())) supplier_part_conflict on true
      order by line.id`)).rows;
    const awardEvents = (await client.query(`select event.id::text event_id,event.award_id::text award_id,
      event.event_type,event.actor,event.request_id::text request_id,event.result,
      to_char(event.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai
      from procurement_sourcing_events event
      where event.rfq_id=1 and event.award_id=1 and event.event_type='AWARDED'
      order by event.id`)).rows;
    const failedConversionRequests = (await client.query(`select request_id::text,username,action,result,error_code,
      detail='{}'::jsonb detail_empty from audit_log where request_id=$1::uuid order by id`,
    [FAILED_CONVERSION_REQUEST_ID])).rows;
    const counts = (await client.query(`select
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1) quotes,
      (select count(distinct comparison_version_no)::int from procurement_quote_comparisons where rfq_id=1) comparison_versions,
      (select count(*)::int from procurement_quote_comparisons where rfq_id=1 and comparison_version_no=1) comparison_lines,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines line
        join procurement_sourcing_awards award on award.id=line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from procurement_sourcing_events
        where rfq_id=1 and award_id=1 and event_type='AWARDED') award_events,
      (select count(*)::int from procurement_award_po_line_links) award_po_links,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select count(*)::int from purchase_order_lines) purchase_order_lines,
      (select count(*)::int from purchase_order_source_links) purchase_order_source_links,
      (select count(*)::int from purchase_delivery_plans) delivery_plans,
      (select count(*)::int from purchase_delivery_plan_events) delivery_plan_events,
      (select count(*)::int from warehouse_receiving_queue_entries) receiving_queue_entries,
      (select count(*)::int from purchase_receipts) receipts,
      (select count(*)::int from purchase_receipt_lines) receipt_lines,
      (select count(*)::int from purchase_receipt_delivery_allocations) receipt_allocations,
      (select count(*)::int from inventory_ledger_entries) inventory_ledger_entries,
      (select count(*)::int from quality_inspections where inspection_type='IQC') iqc_inspections,
      (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
      (select count(*)::int from finance_settlements) payments,
      (select count(*)::int from production_work_orders) work_orders,
      (select count(*)::int from audit_log where action='SOURCING_AWARD_CONVERTED' and result='success') successful_award_conversions`)).rows[0];
    await client.query("commit");
    return {
      schema,
      rfq,
      quotes,
      award,
      award_lines: awardLines,
      mapping_qualification_facts: mappingQualificationFacts,
      award_events: awardEvents,
      failed_conversion_requests: failedConversionRequests,
      counts,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertProtectedState(state, stage, expectedSessions = 0) {
  assert.deepEqual(state.schema, {
    database_name: REQUIRED_DATABASE,
    transaction_read_only: "on",
    migration_count: 39,
    head_version: "0039_rfq_traceability.sql",
    active_purchase_sessions: expectedSessions,
  }, `${stage} schema/session`);
  assert.deepEqual(state.rfq, {
    id: "1", rfq_code: "RFQ-00000001", round_no: 1, status: "CLOSED", version: 7,
  }, `${stage} RFQ`);
  assert.deepEqual(state.counts, {
    quotes: 2,
    comparison_versions: 1,
    comparison_lines: 4,
    awards: 1,
    award_lines: 4,
    award_events: 1,
    award_po_links: 0,
    purchase_orders: 0,
    purchase_order_lines: 0,
    purchase_order_source_links: 0,
    delivery_plans: 0,
    delivery_plan_events: 0,
    receiving_queue_entries: 0,
    receipts: 0,
    receipt_lines: 0,
    receipt_allocations: 0,
    inventory_ledger_entries: 0,
    iqc_inspections: 0,
    ap_documents: 0,
    payments: 0,
    work_orders: 0,
    successful_award_conversions: 0,
  }, `${stage} protected counts`);
  assert.deepEqual(state.quotes.map((quote) => ({
    quote_id: quote.quote_id,
    quote_version_no: quote.quote_version_no,
    supplier_id: quote.supplier_id,
    supplier_code: quote.supplier_code,
    supplier_name: quote.supplier_name,
    reference: quote.reference,
  })), EXPECTED_QUOTES, `${stage} fixed Quotes`);
  assert.ok(state.quotes.every((quote) => quote.status === "SUBMITTED" && quote.currency_code === "CNY"), `${stage} immutable Quote state`);
  const selectedQuote = state.quotes.find((quote) => quote.quote_id === "1");
  assert.deepEqual({
    payment_terms: selectedQuote?.payment_terms,
    tax_included: selectedQuote?.tax_included,
    freight_included: selectedQuote?.freight_included,
  }, { payment_terms: PAYMENT_TERMS, tax_included: false, freight_included: false }, `${stage} selected Quote commercial terms`);
  assert.deepEqual(state.award, {
    award_id: "1", rfq_id: "1", status: "AWARDED", version: 1,
    award_digest: PERSISTED_AWARD_DIGEST, selected_by: REQUIRED_USERNAME,
    selected_at_shanghai: AWARD_TIME_SHANGHAI, request_id: AWARD_REQUEST_ID,
  }, `${stage} Award aggregate`);
  assert.deepEqual(state.award_lines.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: line.quote_id,
    quote_version_no: line.quote_version_no,
    supplier_id: line.supplier_id,
    supplier_code: line.supplier_code,
    material_id: line.material_id,
    material_code: line.internal_material_code,
    material_name: line.standard_name,
  })), EXPECTED_LINES.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: "1",
    quote_version_no: 1,
    supplier_id: "1",
    supplier_code: "SUP-000001",
    material_id: line.material_id,
    material_code: line.material_code,
    material_name: line.material_name,
  })), `${stage} Award Lines`);
  assert.ok(state.award_lines.every((line) => line.unit_code === "PCS"
    && line.selected_quantity === "10.000000"
    && line.selected_unit_price === "12.000000"
    && line.line_amount === "120.000000"
    && line.currency_code === "CNY"
    && line.promised_delivery_date === "2026-10-20"), `${stage} immutable Award Line commercial facts`);
  assert.deepEqual(state.mapping_qualification_facts.map((fact) => ({
    award_line_id: fact.award_line_id,
    candidate_id: fact.candidate_id,
    quote_line_id: fact.quote_line_id,
    rfq_binding_id: fact.rfq_binding_id,
    supplier_id: fact.supplier_id,
    supplier_code: fact.supplier_code,
    material_id: fact.material_id,
    material_code: fact.internal_material_code,
    mapping_uuid: fact.mapping_uuid,
    mapping_fact_id: fact.mapping_fact_id,
    mapping_version_no: fact.mapping_version_no,
    mapping_row_cas: fact.mapping_row_cas,
    supplier_part_number: fact.supplier_part_number,
  })), EXPECTED_LINES.map((line) => ({
    award_line_id: line.award_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    rfq_binding_id: line.rfq_binding_id,
    supplier_id: "1",
    supplier_code: "SUP-000001",
    material_id: line.material_id,
    material_code: line.material_code,
    mapping_uuid: line.mapping_uuid,
    mapping_fact_id: line.mapping_fact_id,
    mapping_version_no: 1,
    mapping_row_cas: 3,
    supplier_part_number: line.supplier_part_number,
  })), `${stage} fixed Award Candidate to RFQ Binding to Mapping lineage`);
  assert.ok(state.mapping_qualification_facts.every((fact) => fact.binding_status === "ACTIVE"
    && fact.mapping_status === "ACTIVE" && fact.supplier_status === "ACTIVE"
    && fact.material_status === "ACTIVE" && fact.supplier_unit_code === "PCS"
    && fact.internal_unit_code === "PCS" && fact.supplier_unit_enabled === true
    && fact.internal_unit_enabled === true && fact.conversion_numerator === "1"
    && fact.conversion_denominator === "1" && fact.valid_from === "2026-08-05"
    && fact.valid_to === null && fact.supplier_material_conflict_count === 0
    && fact.supplier_part_number_conflict_count === 0
    && /^[0-9a-f]{64}$/.test(fact.content_digest)
    && fact.mapping_fact_id === fact.current_mapping_fact_id
    && fact.supplier_id === fact.current_mapping_supplier_id
    && fact.material_id === fact.current_mapping_material_id
    && fact.mapping_uuid === fact.current_mapping_uuid
    && fact.mapping_version_no === fact.current_mapping_version_no
    && fact.mapping_row_cas === fact.current_mapping_row_cas
    && fact.content_digest === fact.binding_content_digest
    && fact.supplier_part_number === fact.binding_supplier_part_number
    && fact.purchase_unit_id === fact.binding_purchase_unit_id
    && fact.conversion_numerator === fact.binding_conversion_numerator
    && fact.conversion_denominator === fact.binding_conversion_denominator
    && fact.valid_from === fact.binding_valid_from
    && fact.valid_to === fact.binding_valid_to), `${stage} exact active 1:1 Mapping and Binding snapshot facts`);
  assert.deepEqual(state.failed_conversion_requests, [{
    request_id: FAILED_CONVERSION_REQUEST_ID,
    username: REQUIRED_USERNAME,
    action: "SOURCING_AWARD_CONVERTED",
    result: "failed",
    error_code: "AWARD_SUPPLIER_MAPPING_NOT_UNIQUE",
    detail_empty: true,
  }], `${stage} preserved one-time failed conversion evidence`);
  assert.deepEqual(state.award_events, [{
    event_id: "9", award_id: "1", event_type: "AWARDED", actor: REQUIRED_USERNAME,
    request_id: AWARD_REQUEST_ID, result: "SUCCESS", occurred_at_shanghai: AWARD_TIME_SHANGHAI,
  }], `${stage} exact Award Event`);
}

function assertPreview(preview, protectedState) {
  assert.equal(preview.contract_version, "AWARD_PO_CONFIRMATION_V2");
  assert.deepEqual(preview.award, {
    award_id: "1",
    version: 1,
    status: "AWARDED",
    display_identity: "定标 #1",
    has_business_number: false,
    business_number_note: "未设置独立Award业务编号。",
  });
  assert.deepEqual(preview.rfq, {
    rfq_id: "1", rfq_code: "RFQ-00000001", round_no: 1, status: "CLOSED", version: 7,
  });
  assert.deepEqual(preview.comparison, {
    version: 1, status: "CURRENT", output_digest: COMPARISON_DIGEST, awardable_now: false,
  });
  assert.equal(preview.po_convertible_now, true);
  const qualification = preview.mapping_qualification;
  assert.ok(qualification && typeof qualification === "object", "Mapping qualification credential is required");
  assert.equal(qualification.contract_version, "AWARD_PO_MAPPING_QUALIFICATION_V1");
  assert.match(qualification.observed_at, /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  assert.equal(qualification.data_timezone, "Asia/Shanghai");
  assert.match(qualification.qualification_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual({
    all_qualified: qualification.all_qualified,
    qualified_line_count: qualification.qualified_line_count,
    line_count: qualification.line_count,
  }, { all_qualified: true, qualified_line_count: 4, line_count: 4 });
  const protectedByAwardLine = new Map(protectedState.mapping_qualification_facts
    .map((fact) => [fact.award_line_id, fact]));
  assert.deepEqual(qualification.lines.map((line) => ({
    award_line_id: line.award_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    rfq_binding_id: line.rfq_binding_id,
    supplier_id: line.supplier_id,
    material_id: line.material_id,
    mapping_uuid: line.mapping_uuid,
    mapping_fact_id: line.mapping_fact_id,
    mapping_version_no: line.mapping_version_no,
    mapping_row_cas: line.mapping_row_cas,
  })), EXPECTED_LINES.map((line) => ({
    award_line_id: line.award_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    rfq_binding_id: line.rfq_binding_id,
    supplier_id: "1",
    material_id: line.material_id,
    mapping_uuid: line.mapping_uuid,
    mapping_fact_id: line.mapping_fact_id,
    mapping_version_no: 1,
    mapping_row_cas: 3,
  })));
  assert.ok(qualification.lines.every((line) => {
    const protectedFact = protectedByAwardLine.get(line.award_line_id);
    return protectedFact && line.binding_status === "ACTIVE" && line.mapping_status === "ACTIVE"
      && line.supplier_status === "ACTIVE" && line.material_status === "ACTIVE"
      && line.supplier_code === "SUP-000001"
      && line.supplier_part_number === protectedFact.supplier_part_number
      && String(line.supplier_unit_id) === protectedFact.purchase_unit_id
      && String(line.internal_unit_id) === protectedFact.internal_unit_id
      && line.supplier_unit_code === "PCS" && line.internal_unit_code === "PCS"
      && String(line.conversion_numerator) === "1" && String(line.conversion_denominator) === "1"
      && line.valid_from === "2026-08-05" && line.valid_to === null
      && line.content_digest === protectedFact.content_digest
      && line.supplier_material_conflict_count === 0
      && line.supplier_part_number_conflict_count === 0
      && line.qualified === true && line.error_code === null
      && line.reason === "Supplier Mapping资格通过";
  }), "all four Mapping qualification lines must match the protected Binding facts");
  assert.deepEqual(preview.current_counts, {
    purchase_orders: 0, purchase_order_lines: 0, delivery_plans: 0,
  });
  assert.deepEqual(preview.fixed_quotes.map((quote) => ({
    quote_id: quote.quote_id,
    quote_version_no: quote.quote_version_no,
    supplier_id: quote.supplier_id,
    supplier_code: quote.supplier_code,
    supplier_name: quote.supplier_name,
    reference: quote.supplier_quote_reference,
  })), EXPECTED_QUOTES);
  assert.deepEqual(preview.selected_quotes.map((quote) => ({
    quote_id: quote.quote_id,
    quote_version_no: quote.quote_version_no,
    supplier_id: quote.supplier_id,
    supplier_code: quote.supplier_code,
    currency_code: quote.currency_code,
    payment_terms: quote.payment_terms,
    tax_included: quote.tax_included,
    freight_included: quote.freight_included,
  })), [{
    quote_id: "1", quote_version_no: 1, supplier_id: "1", supplier_code: "SUP-000001",
    currency_code: "CNY", payment_terms: PAYMENT_TERMS, tax_included: false, freight_included: false,
  }]);
  assert.deepEqual(preview.suppliers, [{
    supplier_id: "1", supplier_code: "SUP-000001", supplier_name: EXPECTED_QUOTES[0].supplier_name,
  }]);
  assert.deepEqual(preview.award_event, {
    event_id: "9", event_type: "AWARDED", actor: REQUIRED_USERNAME,
    occurred_at_shanghai: AWARD_TIME_SHANGHAI, request_id: AWARD_REQUEST_ID, result: "SUCCESS",
  });
  assert.deepEqual(preview.digests, {
    persisted_award_digest: PERSISTED_AWARD_DIGEST,
    decision_digest: DECISION_DIGEST,
    decision_digest_source: "DETERMINISTIC_RECALCULATION",
    decision_digest_rule: "AWARD_DECISION_V1",
  });
  assert.deepEqual(preview.lines.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    candidate_id: line.comparison_candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: line.quote_id,
    quote_version_no: line.quote_version_no,
    supplier_id: line.supplier_id,
    material_id: line.material_id,
    material_code: line.internal_material_code,
    material_name: line.standard_name,
    quantity: line.selected_quantity,
    unit_code: line.unit_code,
    unit_price: line.selected_unit_price,
    amount: line.line_amount,
    currency_code: line.currency_code,
    promised_delivery_date: line.promised_delivery_date,
  })), EXPECTED_LINES.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: "1",
    quote_version_no: 1,
    supplier_id: "1",
    material_id: line.material_id,
    material_code: line.material_code,
    material_name: line.material_name,
    quantity: "10.000000",
    unit_code: "PCS",
    unit_price: "12.000000",
    amount: "120.000000",
    currency_code: "CNY",
    promised_delivery_date: "2026-10-20",
  })));
  assert.deepEqual(preview.planned_result, {
    conversion_operation_count: 1,
    purchase_order_aggregate_count: 1,
    purchase_order_line_count: 4,
    delivery_plan_aggregate_count: 4,
    delivery_plan_line_count: 0,
    receiving_queue_entry_count: 4,
    delivery_plan_event_count: 4,
    totals_by_currency: [{ currency_code: "CNY", total_amount: "480.000000" }],
    planned_delivery_dates: ["2026-10-20"],
  });
  assert.deepEqual(preview.model_capabilities, {
    external_reference: false,
    external_reference_note: "当前PO模型未采集外部参考",
    remark: true,
    remark_max_length: 2000,
    delivery_plan_semantics: "每个Delivery Plan记录是直接唯一绑定一条PO Line的独立计划聚合；模型没有单独的Delivery Plan Line实体。",
  });
  assert.deepEqual(preview.protected_boundaries, {
    upstream_unchanged: ["Award", "RFQ", "Quote", "Comparison"],
    not_created: ["Receipt", "Warehouse Receipt", "Inventory Ledger", "IQC", "AP", "Payment", "Work Order", "其他生产记录", "其他财务记录"],
    next_stage: "供应商到货、仓库收货和IQC必须由后续独立任务完成。",
  });
  assert.deepEqual(preview.confirmation, {
    expected_award_version: 1,
    expected_rfq_id: 1,
    expected_rfq_version: 7,
    expected_comparison_version: 1,
    expected_comparison_output_digest: COMPARISON_DIGEST,
    expected_award_digest: PERSISTED_AWARD_DIGEST,
    expected_decision_digest: DECISION_DIGEST,
    expected_mapping_qualification_digest: qualification.qualification_digest,
    expected_po_count: 0,
    expected_delivery_plan_count: 0,
    expected_award_line_ids: ["1", "2", "3", "4"],
  });
}

function includesAll(text, values, stage) {
  for (const value of values) assert.ok(text.includes(String(value)), `${stage} missing ${value}`);
}

async function noPageOverflow(page, stage) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1, `${stage}: document overflow ${JSON.stringify(widths)}`);
  assert.ok(widths.body <= widths.viewport + 1, `${stage}: body overflow ${JSON.stringify(widths)}`);
}

async function assertDialog(page, preview, mode) {
  const dialog = page.getByRole("dialog", { name: "定标转采购订单最终确认" });
  await dialog.waitFor();
  const text = await dialog.innerText();
  includesAll(text, [
    "Award", "#1 / v1 / AWARDED",
    "RFQ", "ID 1 / RFQ-00000001 / Round 1 / CLOSED / v7",
    "Comparison", "Version 1 / CURRENT / awardable_now=false",
    "po_convertible_now=true / 当前PO 0 / 当前计划 0",
    "Quote 1/v1", "Quote 2/v1", "SUP-000001", EXPECTED_QUOTES[0].supplier_name,
    "SUP-000002", EXPECTED_QUOTES[1].supplier_name, "UAT-Q-A-042576", "UAT-Q-B-042576",
    "获奖来源", PAYMENT_TERMS, "未税", "不含运费",
    "ID 9 / AWARDED", REQUIRED_USERNAME, AWARD_TIME_SHANGHAI, AWARD_REQUEST_ID, "SUCCESS",
    PERSISTED_AWARD_DIGEST, DECISION_DIGEST, "AWARD_DECISION_V1", COMPARISON_DIGEST,
    "Supplier Mapping资格凭证", "AWARD_PO_MAPPING_QUALIFICATION_V1",
    preview.mapping_qualification.observed_at, "Asia/Shanghai",
    "qualified=true / 合格", "4/4 行合格", preview.mapping_qualification.qualification_digest,
    ...EXPECTED_LINES.flatMap((line) => [
      `${line.material_id} / ${line.material_code}`,
      "10 PCS", "12.00 CNY", "120.00 CNY", "2026-10-20",
    ]),
    "转换操作 1", "PO聚合 1", "PO Line 4", "Delivery Plan计划记录／聚合 4",
    "独立Delivery Plan Line 0", "待入库队列 4", "Supplier：1 / SUP-000001",
    "总额：480.00 CNY", "当前PO模型未采集外部参考", "PO备注（可选，最多2000字）",
    "Award、RFQ、Quote、Comparison不会被修改。", "Receipt", "Warehouse Receipt",
    "Inventory Ledger", "IQC", "AP", "Payment", "Work Order", "其他生产记录", "其他财务记录",
    preview.protected_boundaries.next_stage,
  ], `${mode} Award to PO confirmation`);
  assert.equal(await dialog.getByRole("button", { name: "最终确认生成PO及到货计划", exact: true }).isEnabled(), true);
  assert.equal(await dialog.locator('input[name*="reference"], input[placeholder*="外部参考"]').count(), 0);
  const desktopLineScope = ".award-po-lines-desktop:not(.award-po-qualification-desktop)";
  const mobileLineScope = ".award-po-lines-mobile:not(.award-po-qualification-mobile)";
  assert.equal(await dialog.locator(desktopLineScope).isVisible(), mode === "desktop");
  assert.equal(await dialog.locator(mobileLineScope).isVisible(), mode === "mobile");
  const visibleScope = mode === "desktop" ? desktopLineScope : mobileLineScope;
  const visibleLines = dialog.locator(`${visibleScope} ${mode === "desktop" ? "tbody tr" : "article"}`);
  assert.equal(await visibleLines.count(), 4);
  for (const [index, expected] of EXPECTED_LINES.entries()) {
    const lineText = await visibleLines.nth(index).innerText();
    includesAll(lineText, [
      expected.award_line_id,
      `${expected.material_id} / ${expected.material_code}`,
      "10 PCS",
      "12.00 CNY",
      "120.00 CNY",
      "2026-10-20",
    ], `${mode} Award Line ${expected.award_line_id}`);
  }
  const desktopQualificationScope = ".award-po-qualification-desktop";
  const mobileQualificationScope = ".award-po-qualification-mobile";
  assert.equal(await dialog.locator(desktopQualificationScope).isVisible(), mode === "desktop");
  assert.equal(await dialog.locator(mobileQualificationScope).isVisible(), mode === "mobile");
  const qualificationScope = mode === "desktop" ? desktopQualificationScope : mobileQualificationScope;
  const qualificationLines = dialog.locator(`${qualificationScope} ${mode === "desktop" ? "tbody tr" : "article"}`);
  assert.equal(await qualificationLines.count(), 4);
  const qualificationByAwardLine = new Map(preview.mapping_qualification.lines
    .map((line) => [line.award_line_id, line]));
  for (const [index, expected] of EXPECTED_LINES.entries()) {
    const qualification = qualificationByAwardLine.get(expected.award_line_id);
    assert.ok(qualification, `${mode} missing Mapping qualification for Award Line ${expected.award_line_id}`);
    const credential = qualificationLines.nth(index);
    assert.equal(await credential.getAttribute("data-award-line-id"), expected.award_line_id);
    assert.equal(await credential.getAttribute("data-qualified"), "true");
    const credentialText = await credential.innerText();
    includesAll(credentialText, [
      `Award Line ${expected.award_line_id}`,
      `Candidate ${expected.candidate_id}`,
      `Quote Line ${expected.quote_line_id}`,
      `RFQ Binding ${expected.rfq_binding_id}`,
      "Supplier 1 / SUP-000001",
      mode === "desktop" ? "Supplier状态：ACTIVE" : "Supplier 1 / SUP-000001 / ACTIVE",
      `Material ${expected.material_id}`,
      mode === "desktop" ? "Material状态：ACTIVE" : `Material ${expected.material_id} / ACTIVE`,
      expected.mapping_uuid,
      `Fact ${expected.mapping_fact_id} / v1 / Row CAS 3`,
      "Binding状态：ACTIVE",
      "Mapping状态：ACTIVE",
      expected.supplier_part_number,
      "Supplier Unit",
      "/ PCS",
      "Internal Unit",
      mode === "desktop" ? "1:1" : "换算：1:1",
      "2026-08-05",
      "Supplier/Material",
      "Supplier Part",
      qualification.content_digest,
      "qualified=true / 合格",
      "错误代码：—",
      "原因：Supplier Mapping资格通过",
    ], `${mode} Mapping qualification Award Line ${expected.award_line_id}`);
    assert.match(credentialText, /Supplier\/Material[： ]0/);
    assert.match(credentialText, /Supplier Part[： ]0/);
  }
  await noPageOverflow(page, `${mode} Award to PO confirmation`);
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= -1 && box.width <= (mode === "desktop" ? 1440 : 390) + 1, `${mode} dialog must remain within viewport`);
  return dialog;
}

let browser;
let context;
let previewGets = 0;
const businessWrites = [];
const directBusinessWrites = [];
const forbiddenGets = [];
const browserErrors = [];

async function directPost(path, options) {
  if (!["/api/login", "/api/logout"].includes(path)) {
    directBusinessWrites.push(`POST ${path}`);
    throw new Error(`blocked direct business POST ${path}`);
  }
  return context.request.post(`${REQUIRED_ORIGIN}${path}`, options);
}

async function logoutIfNeeded() {
  if (!context) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}${SESSION_PATH}`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      await directPost("/api/logout", {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
      });
    }
  }
}

try {
  const before = await readProtectedState();
  assertProtectedState(before, "before UAT");
  const credential = await purchaseCredential();
  const chromium = await loadChromium();
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const allowedApiGets = new Set([SESSION_PATH, PENDING_AWARDS_PATH, ORDERS_PATH, PREVIEW_PATH]);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const path = `${url.pathname}${url.search}`;
    if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && url.pathname.startsWith("/api/") && !allowedApiGets.has(path)) {
      forbiddenGets.push(path);
      return route.abort("blockedbyclient");
    }
    if (method === "GET" && path === PREVIEW_PATH) previewGets += 1;
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) return route.continue();
    businessWrites.push(`${method} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console:${message.text()}`); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === REQUIRED_ORIGIN && response.status() >= 400) browserErrors.push(`http:${response.status()}:${url.pathname}`);
  });

  const login = await directPost("/api/login", { headers: { Origin: REQUIRED_ORIGIN }, data: credential });
  assert.equal(login.status(), 200);
  const loginPayload = await login.json();
  assert.deepEqual([
    loginPayload.user?.username,
    loginPayload.user?.role,
    loginPayload.user?.is_active,
    loginPayload.user?.must_change_password,
  ], [REQUIRED_USERNAME, "purchase", true, false]);
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}${SESSION_PATH}`)).json();
  assert.ok(session.authenticated && session.csrf_token
    && session.user.username === REQUIRED_USERNAME && session.user.role === "purchase");

  await page.goto(`${REQUIRED_ORIGIN}${WORKSPACE_PATH}`, { waitUntil: "domcontentloaded" });
  const entry = page.getByRole("button", { name: "显式生成采购订单", exact: true });
  await entry.waitFor();
  assert.deepEqual(businessWrites, []);
  const previewResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === REQUIRED_ORIGIN && `${url.pathname}${url.search}` === PREVIEW_PATH;
  });
  await entry.click();
  const previewResponse = await previewResponsePromise;
  assert.equal(previewResponse.status(), 200);
  const preview = (await previewResponse.json()).data;
  assertPreview(preview, before);
  assert.equal(previewGets, 1, "opening the confirmation must make exactly one authoritative preview GET");
  assert.deepEqual(businessWrites, [], "opening the confirmation must make zero business writes");
  let dialog = await assertDialog(page, preview, "desktop");
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
  assert.equal(await cancel.evaluate((element) => element === document.activeElement), true, "cancel must receive default focus");

  await page.setViewportSize({ width: 390, height: 844 });
  dialog = await assertDialog(page, preview, "mobile");
  const remark = dialog.getByLabel(/PO备注/);
  await remark.fill(UAT_REMARK);
  assert.equal(await remark.inputValue(), UAT_REMARK);
  assert.deepEqual(businessWrites, [], "editing a local remark must make zero business writes");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(previewGets, 1);
  assert.deepEqual(businessWrites, [], "cancel must make zero business writes");
  assert.deepEqual(directBusinessWrites, []);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "显式生成采购订单", exact: true }).waitFor();
  const awardPanel = page.locator(".sourcing-panel").filter({ has: page.getByRole("heading", { name: "待显式转PO的定标", exact: true }) });
  const orderPanel = page.locator(".sourcing-panel").filter({ has: page.getByRole("heading", { name: "采购订单与到货计划", exact: true }) });
  assert.equal(await awardPanel.locator(".sourcing-card").count(), 1);
  assert.equal(await orderPanel.locator(".sourcing-card").count(), 0);
  includesAll(await page.locator(".sourcing-metrics").innerText(), ["待转PO定标", "1", "采购订单", "0", "待建计划采购订单"], "refreshed fulfillment metrics");
  assert.equal(previewGets, 1, "refresh after cancel must not reopen the conversion preview");
  assert.deepEqual(businessWrites, []);

  const during = await readProtectedState();
  assertProtectedState(during, "during UAT", 1);
  const logout = await directPost("/api/logout", {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  assert.equal(logout.status(), 200);
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}${SESSION_PATH}`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("请先登录。", { exact: true }).waitFor();
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of [
    "RFQ-00000001", PERSISTED_AWARD_DIGEST, DECISION_DIGEST, AWARD_REQUEST_ID,
    FAILED_CONVERSION_REQUEST_ID, PAYMENT_TERMS, UAT_REMARK, preview.mapping_qualification.qualification_digest,
    ...EXPECTED_LINES.map((line) => line.mapping_uuid),
    ...preview.mapping_qualification.lines.map((line) => line.content_digest),
  ]) assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "Award to PO Mapping qualification cancel-only UAT must preserve the exact protected state");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  console.info(`AWARD_TO_PO_MAPPING_VALIDATION_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 rfq_version=7 comparison_version=1 award=1 award_version=1 award_line=4 candidate=4 binding=4 mapping=4 qualified=4 failed_request_preserved=1 successful_conversion=0 po_before=0 po_after=0 po_line_before=0 po_line_after=0 delivery_plan_before=0 delivery_plan_after=0 queue_before=0 queue_after=0 preview_get=1 business_post=0 desktop=1 mobile=1 cancelled=1 session=0`);
} finally {
  try {
    await logoutIfNeeded();
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      const finalState = await readProtectedState();
      assert.equal(finalState.schema.active_purchase_sessions, 0, "cleanup must leave zero active Purchase sessions");
    } finally {
      await pool.end();
    }
  }
}
