import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const ORIGIN = "https://43.135.148.43.nip.io:18888";
const DATABASE = "chenyida_erp";
const DATABASE_HOST = "postgres";
const USERNAME = "uat_20260729_purchase";
const CONFIRMATION = "MAIN_UAT_PO1_HISTORY_PURCHASE_READ_ONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const DETAIL_PATH = "/procurement/fulfillment/purchase-orders/1";
const API_PATH = "/api/procurement/purchase-orders/1/history";
const SUCCESS_REQUEST_ID = "773c23b6-0923-4ab5-a451-bb80aa4bdf9d";
const FAILED_REQUEST_ID = "f30a7801-1cd0-4849-95a8-9c61d5c52e67";
const CONVERSION_OPERATION = "ac0638af-3263-4c3d-93c0-7327033ce71c";
const OUTPUT_DIGEST = "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec";
const AWARD_DIGEST = "7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55";
const DECISION_DIGEST = "7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a";
const IDEMPOTENCY_DIGEST = "214d55782672b8e03da9ed80a983ea31572b9ae367b89e2d4a8f2df385b3df2d";
const REQUEST_DIGEST = "7afef61364304b15c4cb313d708aa2dd0cbef3bc47f44bb65ef028ef8e6c527a";
const MAPPINGS = [
  "224d1965-44ef-4c3e-901e-1926b6b07ff8",
  "43ca04d8-9933-4dac-ba21-b7fb85741830",
  "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e",
  "9659ad2d-406a-4c4c-b575-51329badc63f",
];
const MATERIALS = [
  ["533", "CYD-RB_PCB-000016", "2"],
  ["534", "CYD-RB_SENSOR-000003", "4"],
  ["535", "CYD-RB_CONN-000075", "6"],
  ["536", "CYD-RB_METAL-000015", "8"],
];

if (process.env.ERP_PO_HISTORY_UAT_CONFIRM !== CONFIRMATION) {
  throw new Error(`ERP_PO_HISTORY_UAT_CONFIRM=${CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_PO_HISTORY_DATABASE_URL || "";
const parsed = databaseUrl ? new URL(databaseUrl) : null;
if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)
  || parsed.hostname !== DATABASE_HOST || Number(parsed.port || "5432") !== 5432
  || decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== DATABASE) {
  throw new Error(`PO history UAT must target ${DATABASE_HOST}/${DATABASE}`);
}

async function purchaseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > 65536) throw new Error("canonical Purchase UAT credential metadata is invalid");
  const document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  const matches = Array.isArray(document?.accounts)
    ? document.accounts.filter((account) => account?.username === USERNAME && account?.role === "purchase") : [];
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
    || matches[0].must_change_password !== false) throw new Error("exact active canonical Purchase UAT credential is required");
  return { username: USERNAME, password: matches[0].password };
}

async function chromiumProvider() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      if (loaded.chromium || loaded.default?.chromium) return loaded.chromium || loaded.default.chromium;
    } catch { /* continue through controlled module candidates */ }
  }
  throw new Error("Playwright is required for PO history readonly UAT");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "po-history-uat-readonly" });

async function databaseState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const connection = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) head_version,
      (select count(*)::int from app_sessions where username=$1 and revoked_at is null and expires_at>now()) active_sessions`, [USERNAME])).rows[0];
    const po = (await client.query(`select po.id::text id,po.po_code,po.version::int,po.status,
      po.supplier_id::text supplier_id,po.currency_code,po.remark,po.created_by,
      to_char(po.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at_shanghai,
      po.request_id::text request_id,source.source_operation_id::text operation_id
      from purchase_orders po join purchase_order_source_links source on source.purchase_order_id=po.id where po.id=1`)).rows[0];
    const lines = (await client.query(`select line.id::text line_id,link.award_line_id::text award_line_id,
      line.material_id::text material_id,line.order_qty::text quantity,line.received_qty::text received,
      line.unit_price::text unit_price,binding.id::text binding_id,binding.supplier_mapping_version_id::text mapping_fact_id,
      binding.mapping_uid::text mapping_uuid
      from purchase_order_lines line join procurement_award_po_line_links link on link.purchase_order_line_id=line.id
      join procurement_sourcing_award_lines award_line on award_line.id=link.award_line_id
      join procurement_sourcing_awards award on award.id=award_line.award_id
      join procurement_rfq_supplier_line_mapping_bindings binding on binding.rfq_id=award.rfq_id
        and binding.rfq_line_id=award_line.rfq_line_id and binding.supplier_id=award_line.supplier_id
      where line.purchase_order_id=1 order by line.id`)).rows;
    const plans = (await client.query(`select plan.id::text plan_id,plan.purchase_order_line_id::text line_id,
      plan.material_id::text material_id,plan.planned_quantity::text quantity,plan.received_quantity::text received,
      plan.promised_delivery_date::text delivery_date,plan.status,plan.version::int,event.id::text event_id,
      queue.id::text queue_id,queue.version::int queue_version,queue.closed_at
      from purchase_delivery_plans plan join purchase_delivery_plan_events event on event.delivery_plan_id=plan.id and event.event_type='CREATED'
      join warehouse_receiving_queue_entries queue on queue.delivery_plan_id=plan.id
      where plan.purchase_order_id=1 order by plan.id`)).rows;
    const credentials = (await client.query(`select
      (select id::text from purchase_order_status_events where purchase_order_id=1 and event_type='CREATED') po_event_id,
      (select id::text from audit_log where route_code='PROCUREMENT' and action='SOURCING_AWARD_CONVERTED' and result='success' and detail->>'object_id'='1') audit_id,
      (select status_code::int from idempotency_keys where key_digest=$1) http_status,
      (select request_digest from idempotency_keys where key_digest=$1) request_digest,
      (select count(*)::int from audit_log where route_code='PROCUREMENT' and action='SOURCING_AWARD_CONVERTED' and result='failed' and request_id=$2) failed_audit_count`, [IDEMPOTENCY_DIGEST, FAILED_REQUEST_ID])).rows[0];
    const counts = (await client.query(`select
      (select count(*)::int from purchase_orders) po,(select count(*)::int from purchase_order_lines where purchase_order_id=1) lines,
      (select count(*)::int from purchase_delivery_plans where purchase_order_id=1) plans,
      (select count(*)::int from warehouse_receiving_queue_entries queue join purchase_delivery_plans plan on plan.id=queue.delivery_plan_id where plan.purchase_order_id=1) queues,
      (select count(*)::int from purchase_receipts where purchase_order_id=1) receipts,
      (select count(*)::int from inventory_ledger_entries ledger join purchase_receipt_lines line on line.inventory_ledger_entry_id=ledger.id join purchase_receipts receipt on receipt.id=line.purchase_receipt_id where receipt.purchase_order_id=1) ledger,
      (select count(*)::int from quality_inspections inspection join purchase_receipt_lines line on line.id=inspection.purchase_receipt_line_id join purchase_receipts receipt on receipt.id=line.purchase_receipt_id where receipt.purchase_order_id=1 and inspection.inspection_type='IQC') iqc,
      (select count(*)::int from finance_documents document join purchase_financial_source_entries source on source.id=document.purchase_source_entry_id join purchase_receipts receipt on receipt.id=source.purchase_receipt_id where receipt.purchase_order_id=1 and document.doc_type='AP') ap,
      (select count(*)::int from finance_settlements settlement join finance_documents document on document.id=settlement.document_id join purchase_financial_source_entries source on source.id=document.purchase_source_entry_id join purchase_receipts receipt on receipt.id=source.purchase_receipt_id where receipt.purchase_order_id=1) payment,
      (select count(*)::int from production_work_orders) work_orders`)).rows[0];
    await client.query("commit");
    const business = { po, lines, plans, credentials, counts };
    return { connection, business, fingerprint: digest(business) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);throw error;
  } finally { client.release(); }
}

function assertDatabaseState(state, sessions) {
  assert.deepEqual(state.connection, { database_name: DATABASE, transaction_read_only: "on", migration_count: 39,
    head_version: "0039_rfq_traceability.sql", active_sessions: sessions });
  assert.deepEqual(state.business.po, { id: "1", po_code: "PO-00000001", version: 1, status: "OPEN", supplier_id: "1",
    currency_code: "CNY", remark: "纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。", created_by: USERNAME,
    created_at_shanghai: "2026-08-08 14:11:45.086372", request_id: SUCCESS_REQUEST_ID, operation_id: CONVERSION_OPERATION });
  assert.equal(state.business.lines.length, 4);assert.equal(state.business.plans.length, 4);
  assert.deepEqual(state.business.credentials, { po_event_id: "1", audit_id: "1491", http_status: 201,
    request_digest: REQUEST_DIGEST, failed_audit_count: 1 });
  assert.deepEqual(state.business.counts, { po: 1, lines: 4, plans: 4, queues: 4, receipts: 0, ledger: 0, iqc: 0, ap: 0, payment: 0, work_orders: 0 });
}

function assertHistory(history) {
  assert.equal(history.contract_version, "PO_HISTORY_TRACEABILITY_V1");assert.equal(history.read_only, true);
  assert.deepEqual({ id: history.purchase_order.purchase_order_id, code: history.purchase_order.po_code,
    version: history.purchase_order.version, status: history.purchase_order.status, supplier: history.purchase_order.supplier_id,
    amount: history.purchase_order.total_amount, quantity: history.purchase_order.ordered_quantity,
    received: history.purchase_order.received_quantity, remark: history.purchase_order.remark,
    actor: history.purchase_order.created_by, time: history.purchase_order.created_at_shanghai,
    request: history.purchase_order.request_id, operation: history.purchase_order.conversion_operation_id,
    action: history.purchase_order.conversion_action, convertible: history.purchase_order.po_convertible_now }, {
    id: "1", code: "PO-00000001", version: 1, status: "OPEN", supplier: "1", amount: "480.000000",
    quantity: "40.000000", received: "0.000000", remark: "纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。",
    actor: USERNAME, time: "2026-08-08 14:11:45.086372", request: SUCCESS_REQUEST_ID,
    operation: CONVERSION_OPERATION, action: "SOURCING_AWARD_CONVERTED", convertible: false,
  });
  assert.deepEqual([history.lineage.project.id,history.lineage.material_requirement_plan.id,
    history.lineage.purchase_request.id,history.lineage.rfq.id,history.lineage.rfq.version,
    history.lineage.comparison.version,history.lineage.quote.id,history.lineage.quote.version,
    history.lineage.award.id,history.lineage.award.version,history.lineage.purchase_order.id], ["1","1","1","1",7,1,"1",1,"1",1,"1"]);
  assert.deepEqual([history.digests.comparison_output_digest,history.digests.persisted_award_digest,
    history.digests.derived_award_decision_digest],[OUTPUT_DIGEST,AWARD_DIGEST,DECISION_DIGEST]);
  assert.deepEqual(history.supplier_summaries.map((supplier) => [supplier.label,supplier.line_count,supplier.total_amount]),
    [["Supplier A",4,"480.000000"],["Supplier B",0,"0.000000"]]);
  assert.deepEqual(history.lines.map((line) => [line.purchase_order_line_id,line.award_line_id,line.candidate_id,
    line.quote_line_id,line.binding_id,line.material_id,line.material_code,line.mapping_fact_id,line.mapping_uuid,
    line.mapping_version,line.mapping_row_cas,line.quantity,line.received_quantity,line.unit_price,line.line_amount,line.planned_delivery_date]),
  MATERIALS.map(([materialId,materialCode,candidate],index) => [String(index+1),String(index+1),candidate,String(index+1),String(index+1),materialId,materialCode,String(index+1),MAPPINGS[index],1,3,"10.000000","0.000000","12.000000","120.000000","2026-10-20"]));
  assert.equal(history.line_summary.duplicate_material,false);assert.equal(history.delivery_model.has_independent_delivery_plan_line,false);
  assert.deepEqual(history.delivery_plans.map((plan) => [plan.delivery_plan_id,plan.purchase_order_line_id,plan.award_line_id,
    plan.plan_event_id,plan.queue_id,plan.status,plan.version,plan.queue_status,plan.queue_version]),
  [1,2,3,4].map((id) => [String(id),String(id),String(id),String(id),String(id),"PENDING",1,"OPEN_PENDING",1]));
  assert.deepEqual({ event: history.credentials.purchase_order_event.event_id, eventType: history.credentials.purchase_order_event.event_type,
    eventResult: history.credentials.purchase_order_event.result, audit: history.credentials.audit.audit_id,
    auditAction: history.credentials.audit.action, auditResult: history.credentials.audit.result,
    http: history.credentials.idempotency.http_status, key: history.credentials.idempotency.key_digest,
    requestDigest: history.credentials.idempotency.request_digest, failed: history.credentials.historical_failed_attempt.request_id,
    failedResult: history.credentials.historical_failed_attempt.result, failedHttp: history.credentials.historical_failed_attempt.http_status,
    failedRecords: history.credentials.historical_failed_attempt.business_record_count }, {
    event:"1",eventType:"CREATED",eventResult:"SUCCESS",audit:"1491",auditAction:"SOURCING_AWARD_CONVERTED",
    auditResult:"SUCCESS",http:201,key:IDEMPOTENCY_DIGEST,requestDigest:REQUEST_DIGEST,failed:FAILED_REQUEST_ID,
    failedResult:"FAILED",failedHttp:422,failedRecords:0,
  });
  for (const key of ["receipt","warehouse_receipt","inventory_ledger","lot","iqc","ap","payment","work_order","production_report","production_completion"]) assert.equal(history.downstream[key],0,key);
  assert.equal(history.downstream.all_zero,true);assert.equal(history.governance_boundary.authorization_verified,false);
  const forbidden = new Set(["request","response","request_body","cookie","session","headers"]);
  const visit = (value) => { if (!value || typeof value !== "object") return;for (const [key,item] of Object.entries(value)) { assert.equal(forbidden.has(key.toLowerCase()),false,`forbidden DTO key ${key}`);visit(item); } };
  visit(history.credentials);
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1, `${stage} document overflow ${JSON.stringify(widths)}`);
  assert.ok(widths.body <= widths.viewport + 1, `${stage} body overflow ${JSON.stringify(widths)}`);
}

let browser;
let context;
let authenticated = false;
const businessWrites = [];
const directBusinessWrites = [];
const forbiddenGets = [];
const browserErrors = [];
const historyGets = [];

async function directPost(path, options) {
  if (!["/api/login", "/api/logout"].includes(path)) { directBusinessWrites.push(`POST ${path}`);throw new Error(`blocked direct business POST ${path}`); }
  return context.request.post(`${ORIGIN}${path}`, options);
}

async function cleanupSession() {
  if (!authenticated || !context) return;
  const response = await context.request.get(`${ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) await directPost("/api/logout", { headers: { Origin: ORIGIN, "X-CSRF-Token": session.csrf_token } });
  }
  authenticated = false;
}

try {
  const before = await databaseState();assertDatabaseState(before,0);
  const credential = await purchaseCredential();
  const chromium = await chromiumProvider();
  browser = await chromium.launch({ headless:true,args:["--disable-dev-shm-usage","--no-sandbox"] });
  context = await browser.newContext({ viewport:{width:1440,height:900},serviceWorkers:"block" });
  await context.route("**/*",async(route)=>{
    const request=route.request(),url=new URL(request.url()),method=request.method().toUpperCase();
    if(url.origin!==ORIGIN)return route.abort("blockedbyclient");
    if(method==="GET"&&url.pathname.startsWith("/api/")&&!['/api/session',API_PATH].includes(url.pathname)){forbiddenGets.push(`${url.pathname}${url.search}`);return route.abort("blockedbyclient");}
    if(method==="GET"&&url.pathname===API_PATH)historyGets.push(url.pathname);
    if(["GET","HEAD","OPTIONS"].includes(method))return route.continue();
    if(method==="POST"&&["/api/login","/api/logout"].includes(url.pathname))return route.continue();
    businessWrites.push(`${method} ${url.pathname}`);return route.abort("blockedbyclient");
  });
  const page=await context.newPage();
  page.on("pageerror",error=>browserErrors.push(`pageerror:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")browserErrors.push(`console:${message.text()}`);});
  page.on("response",response=>{const url=new URL(response.url());if(url.origin===ORIGIN&&response.status()>=400)browserErrors.push(`http:${response.status()}:${url.pathname}`);});

  const login=await directPost("/api/login",{headers:{Origin:ORIGIN},data:credential});assert.equal(login.status(),200);authenticated=true;
  const session=await(await context.request.get(`${ORIGIN}/api/session`)).json();
  assert.ok(session.authenticated&&session.csrf_token&&session.user.username===USERNAME&&session.user.role==="purchase");
  assert.equal(session.user.permissions.includes("system.audit.read"),false);
  const apiResponse=await context.request.get(`${ORIGIN}${API_PATH}`);assert.equal(apiResponse.status(),200);
  const history=(await apiResponse.json()).data;assertHistory(history);

  await page.goto(`${ORIGIN}${DETAIL_PATH}`,{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"PO-00000001",exact:true}).waitFor();
  let text=await page.locator("body").innerText();
  for(const required of ["只读历史视图","PO聚合摘要","OPEN / 处理中","40 PCS","已收 0 PCS","480.00 CNY",
    "纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。",USERNAME,"2026-08-08 14:11:45.086372",SUCCESS_REQUEST_ID,
    CONVERSION_OPERATION,"SOURCING_AWARD_CONVERTED","po_convertible_now=false","完整上游谱系","Supplier A","Supplier B",
    "PO行 4 · 480.00 CNY","PO行 0 · 0.00 CNY",OUTPUT_DIGEST,AWARD_DIGEST,DECISION_DIGEST,"无重复Material",
    "Delivery Plan与queue","模型没有独立Delivery Plan Line","queue是待处理队列，不代表已收货或已入库","下游零写入状态","全部为0",
    "PO OPEN不等于已到货。","Delivery Plan PENDING不等于已收货。","queue OPEN_PENDING是待处理队列，不等于库存增加。","本页面不自动执行任何下游动作。"])assert.ok(text.includes(required),`desktop missing ${required}`);
  for(const mapping of MAPPINGS)assert.ok(text.includes(mapping));
  assert.equal(await page.locator('[data-testid^="po-line-row-"]').count(),4);assert.equal(await page.locator('[data-testid^="delivery-plan-row-"]').count(),4);
  assert.equal(await page.locator('[data-testid^="po-line-row-"]').first().isVisible(),true);assert.equal(await page.locator('[data-testid^="po-line-card-"]').first().isVisible(),false);
  assert.equal(await page.locator("form,input,select,textarea").count(),0);
  for(const name of ["到货","收货","IQC","入库","生成AP","编辑PO","取消PO","关闭PO"])assert.equal(await page.getByRole("button",{name,exact:true}).count(),0);
  assert.equal(text.includes("D-105"),false);for(const forbidden of ["已获事前授权","合规转换","补办授权","授权已验证"])assert.equal(text.includes(forbidden),false);
  await noOverflow(page,"desktop");

  for(const summary of ["PO Event · ID 1 · SUCCESS","Audit · ID 1491 · SUCCESS","Idempotency · HTTP 201","历史失败请求 · FAILED / HTTP 422"])await page.getByText(summary,{exact:true}).click();
  text=await page.locator("body").innerText();
  for(const required of ["CREATED · null → OPEN","SOURCING_AWARD_CONVERTED",IDEMPOTENCY_DIGEST,REQUEST_DIGEST,FAILED_REQUEST_ID,"业务记录 0","UNBOUND_PRIOR_ATTEMPT"])assert.ok(text.includes(required),`credential missing ${required}`);
  const refreshResponse=page.waitForResponse(response=>new URL(response.url()).pathname===API_PATH&&response.request().method()==="GET");
  await page.getByRole("button",{name:"刷新只读快照",exact:true}).click();assert.equal((await refreshResponse).status(),200);
  assert.deepEqual(businessWrites,[]);assert.deepEqual(directBusinessWrites,[]);

  await page.reload({waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"PO-00000001",exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('[data-testid^="po-line-row-"]').first().isVisible(),false);assert.equal(await page.locator('[data-testid^="po-line-card-"]').count(),4);
  assert.equal(await page.locator('[data-testid^="po-line-card-"]').first().isVisible(),true);assert.equal(await page.locator('[data-testid^="delivery-plan-card-"]').count(),4);
  assert.equal(await page.locator('[data-testid^="delivery-plan-card-"]').first().isVisible(),true);await noOverflow(page,"390x844");
  await page.goto(`${ORIGIN}${DETAIL_PATH}?history_reopen=1`,{waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"PO-00000001",exact:true}).waitFor();await noOverflow(page,"mobile reopen");
  await page.setViewportSize({width:1440,height:900});await noOverflow(page,"desktop reopen");
  assert.ok(historyGets.length>=4);assert.deepEqual(businessWrites,[]);assert.deepEqual(directBusinessWrites,[]);

  const during=await databaseState();assertDatabaseState(during,1);assert.equal(during.fingerprint,before.fingerprint);
  const logout=await directPost("/api/logout",{headers:{Origin:ORIGIN,"X-CSRF-Token":session.csrf_token}});assert.equal(logout.status(),200);authenticated=false;
  assert.equal((await(await context.request.get(`${ORIGIN}/api/session`)).json()).authenticated,false);
  await page.reload({waitUntil:"domcontentloaded"});await page.getByText("请先登录。",{exact:true}).waitFor();
  const anonymous=await page.locator("body").innerText();for(const protectedValue of ["PO-00000001",SUCCESS_REQUEST_ID,OUTPUT_DIGEST,AWARD_DIGEST,DECISION_DIGEST])assert.equal(anonymous.includes(protectedValue),false);
  const after=await databaseState();assertDatabaseState(after,0);assert.equal(after.fingerprint,before.fingerprint);assert.deepEqual(after.business,before.business);
  assert.deepEqual(businessWrites,[]);assert.deepEqual(directBusinessWrites,[]);assert.deepEqual(forbiddenGets,[]);assert.deepEqual(browserErrors,[]);
  console.info(`PO_HISTORY_TRACEABILITY_UAT_READONLY_OK database=${DATABASE} actor=${USERNAME} po=1 code=PO-00000001 status=OPEN amount=480.00_CNY line=4 plan=4 queue=4 event=1 audit=1491 idempotency=201 failed_request=1 downstream=0 business_post=0 before_fingerprint=${before.fingerprint} after_fingerprint=${after.fingerprint} desktop=1 mobile=1 refresh=1 reopen=1 session=0`);
}finally{
  try{await cleanupSession();}finally{await context?.close().catch(()=>undefined);await browser?.close().catch(()=>undefined);try{const finalState=await databaseState();assert.equal(finalState.connection.active_sessions,0); }finally{await pool.end();}}
}
