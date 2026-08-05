import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";
import { withSupplierMappingFixtureTriggersDisabled } from "./helpers/supplier-mapping-fixture.mjs";

const REQUIRED_DATABASE = "procurement_sourcing_test_fix22_browser_20260805";
const REQUIRED_ORIGIN = "http://127.0.0.1:43142";
const REQUIRED_CONFIRMATION = "ISOLATED_FIX22_SYNTHETIC_ONLY";
const databaseUrl = process.env.DATABASE_URL || "";
const databaseName = (value) => {
  try { return decodeURIComponent(new URL(value).pathname.replace(/^\//, "")); } catch { return ""; }
};

if (databaseName(databaseUrl) !== REQUIRED_DATABASE) {
  throw new Error(`DATABASE_URL must target isolated ${REQUIRED_DATABASE}`);
}
if (process.env.ERP_RFQ_TRACEABILITY_FIX22_BROWSER_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_TRACEABILITY_FIX22_BROWSER_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}

const MAPPING_UIDS = [
  [
    "224d1965-44ef-4c3e-901e-1926b6b07ff8",
    "43ca04d8-9933-4dac-ba21-b7fb85741830",
    "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e",
    "9659ad2d-406a-4c4c-b575-51329badc63f",
  ],
  [
    "45a3daf1-4e97-4a01-a94d-1f3089d3961b",
    "5bd2ced5-6696-4e69-a833-e886cf5e273f",
    "3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6",
    "5432e7fc-463a-4cea-99fe-f3db8cf0af83",
  ],
];
const MATERIAL_IDS = [533, 534, 535, 536];
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "rfq-traceability-fix22-browser" });
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const expectedMigration0039Checksum = createHash("sha256")
  .update(await readFile(new URL("../drizzle-postgres/0039_rfq_traceability.sql", import.meta.url)))
  .digest("hex");
const serverEntry = process.env.ERP_BROWSER_SERVER_ENTRY || "/standalone/server.js";
let server;

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* continue through the controlled module candidates */ }
  }
  throw new Error("Playwright is required in the isolated FIX-22 browser runner");
}

async function clearSyntheticData() {
  const tables = await pool.query(
    "select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','app_meta') order by tablename",
  );
  const quoted = tables.rows.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`);
  if (quoted.length) await pool.query(`truncate table ${quoted.join(",")} restart identity cascade`);
}

async function seedFixture() {
  const credentials = { username: "fix22_purchase", password: `Isolated!Fix22-${randomUUID()}` };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true)",
    );
    await client.query(
      `insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
        ($1,'FIX-22 隔离采购','purchase',$2,true,false,1),
        ('admin01','管理员','admin','x',true,false,1),
        ('planning01','计划','planning','x',true,false,1),
        ('engineering01','工程','engineering','x',true,false,1)`,
      [credentials.username, await hashPassword(credentials.password)],
    );
    const unit = (await client.query(
      "insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id",
    )).rows[0];
    const category = (await client.query(
      `insert into material_categories(
        category_code,category_name_cn,category_level,status,created_by,updated_by,request_id
      ) values('FIX22-COMP','FIX-22 隔离物料',1,'ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    )).rows[0];
    for (const materialId of MATERIAL_IDS) {
      await client.query(
        `insert into material_master(
          id,internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,
          procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,
          last_modified_by,created_by,updated_by,request_id
        ) values($1,$2,$3,$4,'PCS',$5,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',
          'admin01','admin01','admin01',$6)`,
        [materialId, `CYD-FIX22-${String(materialId).padStart(6, "0")}`, `FIX-22 物料 ${materialId}`, category.id, unit.id, randomUUID()],
      );
    }
    await client.query("select setval(pg_get_serial_sequence('material_master','id'),536,true)");
    const customer = (await client.query(
      `insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id)
       values('CUS-FIX22','FIX-22 隔离客户','FIX-22 隔离客户','ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    )).rows[0];
    const project = (await client.query(
      `insert into business_projects(
        project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,
        target_delivery_date,current_requirement_version_no,version,request_id,created_by
      ) values('PRJ-00000001',$1,'FIX-22 隔离 RFQ 项目','追溯与发出安全浏览器验收','admin01',
        'engineering01','ACCEPTED','2099-10-30',1,4,$2,'admin01') returning id`,
      [customer.id, randomUUID()],
    )).rows[0];
    const requirement = (await client.query(
      `insert into project_requirement_versions(
        project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by
      ) values($1,1,'FIX-22 四条物料合计 40 PCS',40,'PCS',$2,'admin01') returning id`,
      [project.id, sha256("fix22-browser-requirement")],
    )).rows[0];
    const packageRow = (await client.query(
      `insert into project_planning_packages(
        project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,
        prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id
      ) values($1,1,$2,'ACCEPTED','2099-10-30',$3,'engineering01','engineering01',now(),
        'planning01',now(),3,$4) returning id`,
      [project.id, requirement.id, sha256("fix22-browser-package"), randomUUID()],
    )).rows[0];
    const plan = (await client.query(
      `insert into planning_material_requirement_plans(
        project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
        source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
      ) values($1,$2,1,'2099-10-30','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
      [project.id, packageRow.id, sha256("fix22-browser-package"), sha256("fix22-browser-calculation"), randomUUID()],
    )).rows[0];
    const planLineIds = [];
    for (const [index, materialId] of MATERIAL_IDS.entries()) {
      const line = (await client.query(
        `insert into planning_material_requirement_lines(
          plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,
          stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
        ) values($1,$2,$3,$4,$5,$6,10,0,0,0,0,10,$7) returning id`,
        [
          plan.id,
          index + 1,
          materialId,
          unit.id,
          { internal_material_code: `CYD-FIX22-${String(materialId).padStart(6, "0")}`, standard_name: `FIX-22 物料 ${materialId}` },
          sha256(`fix22-browser-material-${materialId}`),
          sha256(`fix22-browser-source-${materialId}`),
        ],
      )).rows[0];
      planLineIds.push(Number(line.id));
    }
    const purchaseRequest = (await client.query(
      `insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,version,request_id)
       values('PRQ-00000001',$1,'SUBMITTED','planning01',now(),1,$2) returning id`,
      [plan.id, randomUUID()],
    )).rows[0];
    for (const [index, materialId] of MATERIAL_IDS.entries()) {
      await client.query(
        `insert into planning_purchase_request_lines(
          purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
        ) values($1,$2,$3,$4,$5,10)`,
        [purchaseRequest.id, planLineIds[index], index + 1, materialId, unit.id],
      );
    }
    await client.query(
      "update planning_material_requirement_plans set status='ACCEPTED',accepted_by=$2,accepted_at=now(),version=2,updated_at=now() where id=$1",
      [plan.id, credentials.username],
    );
    await client.query(
      "update planning_purchase_requests set status='ACCEPTED',accepted_by=$2,accepted_at=now(),updated_at=now() where id=$1",
      [purchaseRequest.id, credentials.username],
    );
    await client.query(
      `insert into planning_material_requirement_events(
        plan_id,purchase_request_id,event_type,from_status,to_status,actor,request_id
      ) values($1,$2,'PURCHASE_ACCEPTED','SUBMITTED','ACCEPTED',$3,$4)`,
      [plan.id, purchaseRequest.id, credentials.username, randomUUID()],
    );

    const supplierDefinitions = [
      ["SUP-000001", "FIX-22 快速交付供应商 A"],
      ["SUP-000002", "FIX-22 低价供应商 B"],
    ];
    const supplierRows = [];
    for (const [supplierCode, supplierName] of supplierDefinitions) {
      const supplier = (await client.query(
        `insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id)
         values($1,$2,$2,'ACTIVE',$3,$3,$4) returning id`,
        [supplierCode, supplierName, credentials.username, randomUUID()],
      )).rows[0];
      supplierRows.push({ supplier, supplierCode, supplierName });
    }
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      for (const [supplierIndex, { supplier, supplierCode, supplierName }] of supplierRows.entries()) {
        for (const [materialIndex, materialId] of MATERIAL_IDS.entries()) {
          await client.query(
            `insert into supplier_mappings(
              material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,
              purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,mapping_uid,
              created_by,updated_by,request_id
            ) values($1,$2,$3,$4,$5,'PCS',$6,1,1,'ACTIVE',now()-interval '1 day',$7,$8,$8,$9)`,
            [
              materialId,
              supplier.id,
              supplierName,
              supplierCode,
              `${supplierCode}-${materialId}`,
              unit.id,
              MAPPING_UIDS[supplierIndex][materialIndex],
              credentials.username,
              randomUUID(),
            ],
          );
        }
      }
    });
    await client.query("commit");
    assert.equal(Number(purchaseRequest.id), 1);
    assert.deepEqual(supplierRows.map(({ supplier }) => Number(supplier.id)), [1, 2]);
    return { credentials };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode !== null) throw new Error("isolated FIX-22 standalone server exited before health check");
    try {
      const response = await fetch(`${REQUIRED_ORIGIN}/api/health`);
      if (response.ok) return;
    } catch { /* bounded readiness polling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated FIX-22 standalone server did not become healthy");
}

async function startServer() {
  server = spawn(process.execPath, [serverEntry], {
    cwd: new URL(".", `file://${serverEntry}`).pathname,
    env: {
      ...process.env,
      HOSTNAME: "0.0.0.0",
      PORT: "43142",
      NODE_OPTIONS: "--max-old-space-size=384",
      ERP_ENV: "test",
      ERP_DEPLOYMENT_CLASS: "test",
      ERP_PUBLIC_ORIGIN: REQUIRED_ORIGIN,
      ERP_UAT_ALLOW_LOOPBACK_ORIGIN: "false",
      ERP_SETUP_TOKEN: `isolated-fix22-${randomUUID()}`,
      ERP_UPLOAD_ROOT: "/tmp/fix22-uploads",
      ERP_ATTACHMENT_ROOT: "/tmp/fix22-attachments",
      ERP_BACKUP_STATUS_FILE: "/tmp/fix22-backup-status.json",
    },
    stdio: "ignore",
  });
  await waitForServer();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const waitForExit = (timeoutMs) => new Promise((resolve, reject) => {
    if (server.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("isolated FIX-22 standalone server did not stop")), timeoutMs);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  server.kill("SIGTERM");
  try {
    await waitForExit(5_000);
  } catch {
    server.kill("SIGKILL");
    await waitForExit(5_000);
  }
  server = undefined;
}

async function login(page, credentials) {
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  const response = page.waitForResponse(
    (item) => item.url() === `${REQUIRED_ORIGIN}/api/login` && item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.getByRole("heading", { name: "经营工作台", exact: true }).waitFor();
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1, `${stage}: document overflow`);
  assert.ok(widths.body <= widths.viewport + 1, `${stage}: body overflow`);
}

async function noDialogOverflow(dialog, stage) {
  const widths = await dialog.evaluate((element) => {
    const body = element.querySelector(".rfq-dialog-body");
    return {
      dialogClient: element.clientWidth,
      dialogScroll: element.scrollWidth,
      bodyClient: body?.clientWidth || 0,
      bodyScroll: body?.scrollWidth || 0,
    };
  });
  assert.ok(widths.dialogScroll <= widths.dialogClient + 1, `${stage}: dialog overflow`);
  assert.ok(widths.bodyScroll <= widths.bodyClient + 1, `${stage}: dialog body overflow`);
}

async function sourcingState() {
  const header = (await pool.query(
    `select id::int,rfq_code,purchase_request_id::int,round_no::int,status,response_deadline::text,
      currency_code,traceability_version::int,version::int from procurement_rfqs order by id`,
  )).rows;
  const lines = (await pool.query(
    `select rfq_id::int,line_no::int,purchase_request_line_id::int,material_id::int,
      requested_quantity::numeric(24,6)::text,required_date::text
    from procurement_rfq_lines order by rfq_id,line_no`,
  )).rows;
  const suppliers = (await pool.query(
    "select rfq_id::int,supplier_id::int from procurement_rfq_suppliers order by rfq_id,supplier_id",
  )).rows;
  const bindings = (await pool.query(
    `select binding.rfq_id::int,binding.supplier_id::int,binding.material_id::int,
      binding.supplier_mapping_version_id::int,binding.mapping_uid::text mapping_id,
      binding.mapping_version_no::int mapping_version,binding.mapping_row_version::int,
      binding.supplier_part_number,binding.binding_source,binding.binding_status,
      binding.conversion_numerator::text,binding.conversion_denominator::text,
      purchase_unit.code purchase_unit_code,base_unit.code base_unit_code,
      binding.valid_from is not null valid_from_present,binding.valid_to,mapping.status current_status
    from procurement_rfq_supplier_line_mapping_bindings binding
    join units purchase_unit on purchase_unit.id=binding.purchase_unit_id
    join material_master material on material.id=binding.material_id
    left join units base_unit on base_unit.id=material.base_unit_id
    join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
    order by binding.supplier_id,binding.material_id`,
  )).rows;
  const events = (await pool.query(
    `select event_type,actor,result,old_version::int,new_version::int,from_status,to_status,
      request_id::text,idempotency_key_digest,scope_digest,credential_version::int,
      to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai
    from procurement_sourcing_events order by id`,
  )).rows;
  const downstream = (await pool.query(`select
    (select count(*)::int from procurement_supplier_quotes) quotes,
    (select count(*)::int from procurement_sourcing_awards) awards,
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from purchase_delivery_plans) delivery_plans,
    (select count(*)::int from purchase_receipts) receipts,
    (select count(*)::int from inventory_ledger_entries) ledger_entries,
    (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
    (select count(*)::int from production_work_orders) work_orders`)).rows[0];
  return { header, lines, suppliers, bindings, events, downstream };
}

async function setSyntheticMappingRowVersion(mappingVersionId, version) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, () => client.query(
      "update supplier_mappings set version=$2 where id=$1",
      [mappingVersionId, version],
    ));
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function assertNoProtectedRfq(page, stage) {
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState !== "checking");
  const text = await page.locator("body").innerText();
  for (const protectedValue of ["RFQ-00000001", "FIX-22 隔离 RFQ 项目", ...MAPPING_UIDS.flat()]) {
    assert.equal(text.includes(protectedValue), false, `${stage}: protected RFQ content remained visible`);
  }
  assert.equal(await page.locator(".rfq-dialog").count(), 0, `${stage}: protected dialog remained visible`);
}

test.before(async () => {
  assert.deepEqual(
    (await pool.query(
      "select current_database() name,(select count(*)::int from schema_migrations) migration_count,version head,checksum from schema_migrations order by version desc limit 1",
    )).rows[0],
    {
      name: REQUIRED_DATABASE,
      migration_count: 39,
      head: "0039_rfq_traceability.sql",
      checksum: expectedMigration0039Checksum,
    },
  );
  await clearSyntheticData();
  await startServer();
});

test("isolated Chromium preserves RFQ evidence and requires a safe issue confirmation", { timeout: 300_000 }, async () => {
  const fixture = await seedFixture();
  assert.deepEqual(await sourcingState(), {
    header: [],
    lines: [],
    suppliers: [],
    bindings: [],
    events: [],
    downstream: {
      quotes: 0,
      awards: 0,
      purchase_orders: 0,
      delivery_plans: 0,
      receipts: 0,
      ledger_entries: 0,
      ap_documents: 0,
      work_orders: 0,
    },
  });
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const authPosts = [];
    const businessPosts = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method().toUpperCase();
      if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
      if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) authPosts.push(url.pathname);
      else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        businessPosts.push({ method, path: url.pathname, body: request.postDataJSON() });
      }
      return route.continue();
    });

    const page = await context.newPage();
    await login(page, fixture.credentials);
    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商询价与定标", exact: true }).waitFor();
    await page.locator('select[name="purchase_request_id"]').selectOption("1");
    await page.locator('input[name="supplier_ids"][value="1"]').check();
    await page.locator('input[name="supplier_ids"][value="2"]').check();
    await page.getByLabel("报价截止日", { exact: true }).fill("2099-08-31");
    await noOverflow(page, "draft create desktop");

    const createResponse = page.waitForResponse(
      (response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs`
        && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "建立询价草稿", exact: true }).click();
    assert.equal((await createResponse).status(), 201);
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    assert.deepEqual(businessPosts, [{
      method: "POST",
      path: "/api/procurement/rfqs",
      body: {
        purchase_request_id: 1,
        supplier_ids: [1, 2],
        response_deadline: "2099-08-31",
        expected_version: 1,
      },
    }]);

    const draft = await sourcingState();
    assert.deepEqual(draft.header, [{
      id: 1,
      rfq_code: "RFQ-00000001",
      purchase_request_id: 1,
      round_no: 1,
      status: "DRAFT",
      response_deadline: "2099-08-31",
      currency_code: "CNY",
      traceability_version: 2,
      version: 1,
    }]);
    assert.deepEqual(draft.lines.map((line) => line.material_id), MATERIAL_IDS);
    assert.deepEqual(draft.lines.map((line) => line.requested_quantity), Array(4).fill("10.000000"));
    assert.equal(new Set(draft.lines.map((line) => line.purchase_request_line_id)).size, 4);
    assert.deepEqual(draft.suppliers, [{ rfq_id: 1, supplier_id: 1 }, { rfq_id: 1, supplier_id: 2 }]);
    assert.equal(draft.bindings.length, 8);
    assert.deepEqual(draft.bindings.map((row) => row.mapping_id), MAPPING_UIDS.flat());
    assert.ok(draft.bindings.every((row) => row.mapping_version === 1 && row.mapping_row_version === 1));
    assert.ok(draft.bindings.every((row) => row.supplier_part_number === `${row.supplier_id === 1 ? "SUP-000001" : "SUP-000002"}-${row.material_id}`
      && row.binding_source === "RFQ_CREATE" && row.binding_status === "ACTIVE" && row.current_status === "ACTIVE"
      && row.purchase_unit_code === "PCS" && row.base_unit_code === "PCS"
      && row.conversion_numerator === "1" && row.conversion_denominator === "1"
      && row.valid_from_present === true && row.valid_to === null));
    assert.equal(draft.events.length, 1);
    assert.deepEqual(
      { event_type: draft.events[0].event_type, actor: draft.events[0].actor, result: draft.events[0].result, old_version: draft.events[0].old_version, new_version: draft.events[0].new_version, from_status: draft.events[0].from_status, to_status: draft.events[0].to_status, credential_version: draft.events[0].credential_version },
      { event_type: "RFQ_CREATED", actor: fixture.credentials.username, result: "SUCCESS", old_version: null, new_version: 1, from_status: null, to_status: "DRAFT", credential_version: 2 },
    );
    assert.match(draft.events[0].request_id, /^[0-9a-f-]{36}$/);
    assert.match(draft.events[0].idempotency_key_digest, /^[0-9a-f]{64}$/);
    assert.match(draft.events[0].scope_digest, /^[0-9a-f]{64}$/);
    assert.match(draft.events[0].occurred_at_shanghai, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/);
    assert.deepEqual(draft.downstream, {
      quotes: 0,
      awards: 0,
      purchase_orders: 0,
      delivery_plans: 0,
      receipts: 0,
      ledger_entries: 0,
      ap_documents: 0,
      work_orders: 0,
    });

    const bodyText = await page.locator("body").innerText();
    for (const required of [
      "ID 1 · RFQ-00000001",
      "Round 1 / v1",
      "DRAFT / 草稿 / 待发出",
      "ID 1 · PRQ-00000001",
      "IMMUTABLE_EVENT",
      "RFQ_CREATED",
      "SUCCESS",
      fixture.credentials.username,
      draft.events[0].request_id,
      draft.events[0].occurred_at_shanghai,
      "Asia/Shanghai",
      "创建时已固定 Mapping",
      "PCS → PCS · 1:1",
      "ACTIVE · RFQ_CREATE",
    ]) assert.ok(bodyText.includes(required), `draft evidence missing: ${required}`);
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(bodyText.includes(mappingId), `draft Mapping missing: ${mappingId}`);
    for (const binding of draft.bindings) assert.ok(bodyText.includes(binding.supplier_part_number), `draft supplier part missing: ${binding.supplier_part_number}`);
    assert.equal(await page.locator(".rfq-mapping-trace .rfq-mapping-group").count(), 2);
    assert.equal(await page.locator(".rfq-mapping-trace .rfq-mapping-card").count(), 8);
    assert.equal(await page.getByText("报价入口未启用", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "代录供应商报价", exact: true }).count(), 0);
    await noOverflow(page, "draft detail desktop");

    const issueButton = page.getByRole("button", { name: "发出询价并冻结范围", exact: true });
    await issueButton.click();
    let dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "取消");
    assert.equal(await dialog.locator(".rfq-confirm-lines article").count(), 4);
    assert.equal(await dialog.locator(".rfq-confirm-suppliers span").count(), 2);
    assert.equal(await dialog.locator(".rfq-mapping-card").count(), 8);
    const dialogText = await dialog.innerText();
    for (const required of [
      "ID 1 · RFQ-00000001", "Round 1 / v1", "DRAFT / 草稿 / 待发出",
      "ID 1 · PRQ-00000001", "PRJ-00000001", "2099-08-31", "CNY",
      "IMMUTABLE_EVENT", "RFQ_CREATED", "SUCCESS", fixture.credentials.username,
      draft.events[0].request_id, draft.events[0].occurred_at_shanghai,
      "10.000000 PCS", "ID 1 · SUP-000001", "ID 2 · SUP-000002",
      "已固定 Mapping · 8 条", "v1 / Row v1", "已绑定版本当前状态", "最新 Mapping 版本",
      "当前状态漂移", "当前版本漂移", "发出前服务端重新校验 PRQ、Supplier、Mapping、截止日期、CAS 与当前 DRAFT 状态",
      "发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结", "只有发出成功后才允许录入 Supplier 报价",
      "不自动创建 Quote、Award、PO、库存或财务记录",
    ]) {
      assert.ok(dialogText.includes(required), `issue dialog missing: ${required}`);
    }
    for (const materialId of MATERIAL_IDS) assert.ok(dialogText.includes(`Material ${materialId}`), `issue dialog Material missing: ${materialId}`);
    for (const binding of draft.bindings) assert.ok(dialogText.includes(binding.supplier_part_number), `issue dialog supplier part missing: ${binding.supplier_part_number}`);
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(dialogText.includes(mappingId));
    await noDialogOverflow(dialog, "issue dialog desktop");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(businessPosts.length, 1, "cancel must send zero business requests");

    await issueButton.click();
    dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "关闭确认窗口", exact: true }).click();
    assert.equal(businessPosts.length, 1, "close must send zero business requests");

    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "draft detail 390x844");
    await issueButton.click();
    dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    await noOverflow(page, "issue dialog page 390x844");
    await noDialogOverflow(dialog, "issue dialog 390x844");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessPosts.length, 1, "Escape must send zero business requests");

    const driftBinding = draft.bindings[0];
    await setSyntheticMappingRowVersion(driftBinding.supplier_mapping_version_id, driftBinding.mapping_row_version + 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await issueButton.click();
    dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    const driftResponse = page.waitForResponse(
      (response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`
        && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "发出询价并冻结范围", exact: true }).click();
    assert.equal((await driftResponse).status(), 409);
    await dialog.waitFor({ state: "detached" });
    const driftText = await page.locator("body").innerText();
    assert.ok(driftText.includes(`Supplier ${driftBinding.supplier_id} / Material ${driftBinding.material_id}`));
    assert.ok(driftText.includes("Mapping ID/Version/CAS 已漂移"));
    assert.deepEqual((await sourcingState()).header, draft.header);
    assert.deepEqual((await sourcingState()).events, draft.events);
    assert.deepEqual((await sourcingState()).downstream, draft.downstream);
    await setSyntheticMappingRowVersion(driftBinding.supplier_mapping_version_id, driftBinding.mapping_row_version);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();

    await issueButton.click();
    dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    const issueResponse = page.waitForResponse(
      (response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`
        && response.request().method() === "POST",
    );
    const issuePostsBeforeDoubleClick = businessPosts.filter(({ path }) => path === "/api/procurement/rfqs/1/issue").length;
    const disabledImmediately = await dialog.getByRole("button", { name: "发出询价并冻结范围", exact: true }).evaluate((button) => {
      button.click();
      const disabled = button.disabled;
      button.click();
      return disabled;
    });
    assert.equal(disabledImmediately, true, "confirm button must disable synchronously on first click");
    assert.equal((await issueResponse).status(), 200);
    await page.getByRole("heading", { name: "RFQ 发出成功凭证", exact: true }).waitFor();
    assert.equal(businessPosts.filter(({ path }) => path === "/api/procurement/rfqs/1/issue").length, issuePostsBeforeDoubleClick + 1, "double click must produce one issue POST");

    const issued = await sourcingState();
    assert.deepEqual(issued.header, [{
      id: 1,
      rfq_code: "RFQ-00000001",
      purchase_request_id: 1,
      round_no: 1,
      status: "ISSUED",
      response_deadline: "2099-08-31",
      currency_code: "CNY",
      traceability_version: 2,
      version: 2,
    }]);
    assert.deepEqual(issued.lines, draft.lines);
    assert.deepEqual(issued.suppliers, draft.suppliers);
    assert.deepEqual(issued.bindings, draft.bindings);
    assert.equal(issued.events.length, 2);
    assert.deepEqual(
      { event_type: issued.events[1].event_type, actor: issued.events[1].actor, result: issued.events[1].result, old_version: issued.events[1].old_version, new_version: issued.events[1].new_version, from_status: issued.events[1].from_status, to_status: issued.events[1].to_status, credential_version: issued.events[1].credential_version },
      { event_type: "RFQ_ISSUED", actor: fixture.credentials.username, result: "SUCCESS", old_version: 1, new_version: 2, from_status: "DRAFT", to_status: "ISSUED", credential_version: 2 },
    );
    assert.match(issued.events[1].request_id, /^[0-9a-f-]{36}$/);
    assert.match(issued.events[1].idempotency_key_digest, /^[0-9a-f]{64}$/);
    assert.match(issued.events[1].scope_digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(issued.downstream, draft.downstream);

    const issuedText = await page.locator("body").innerText();
    for (const required of ["ISSUED / 已发出", "RFQ 发出成功凭证", "Event", "ISSUED", "SUCCESS",
      fixture.credentials.username, issued.events[1].occurred_at_shanghai, "Asia/Shanghai", issued.events[1].request_id,
      "v1 → v2", "ISSUED / 已发出", "2 Suppliers · 8 Mappings", issued.events[1].scope_digest,
      "Quote 入口：已启用", "Quote：0", "Award：0", "PO：0"]) {
      assert.ok(issuedText.includes(required), `issuance evidence missing: ${required}`);
    }
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(issuedText.includes(mappingId), `issuance Mapping missing: ${mappingId}`);
    for (const binding of issued.bindings) assert.ok(issuedText.includes(binding.supplier_part_number), `issuance supplier part missing: ${binding.supplier_part_number}`);
    await page.getByRole("heading", { name: "代录供应商报价", exact: true }).waitFor();
    await noOverflow(page, "issued detail desktop");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ 发出成功凭证", exact: true }).waitFor();
    assert.ok((await page.locator("body").innerText()).includes(issued.events[1].request_id));
    assert.equal(await page.getByRole("heading", { name: "代录供应商报价", exact: true }).count(), 1);
    assert.deepEqual(await sourcingState(), issued);

    await stopServer();
    await startServer();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ 发出成功凭证", exact: true }).waitFor();
    const restartedText = await page.locator("body").innerText();
    assert.ok(restartedText.includes(issued.events[1].scope_digest));
    assert.ok(restartedText.includes(draft.events[0].request_id));
    assert.ok(restartedText.includes(draft.events[0].occurred_at_shanghai));
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(restartedText.includes(mappingId), `restarted Mapping missing: ${mappingId}`);
    assert.equal(await page.locator(".rfq-mapping-trace .rfq-mapping-card").count(), 8);
    assert.deepEqual(await sourcingState(), issued);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "issued detail after web restart 390x844");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
    await assertNoProtectedRfq(page, "logout");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await assertNoProtectedRfq(page, "history back");
    await page.goForward({ waitUntil: "domcontentloaded" });
    await assertNoProtectedRfq(page, "history forward");
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertNoProtectedRfq(page, "reload after logout");
    assert.deepEqual(authPosts, ["/api/login", "/api/logout"]);
    assert.deepEqual(businessPosts.map(({ path }) => path), ["/api/procurement/rfqs", "/api/procurement/rfqs/1/issue", "/api/procurement/rfqs/1/issue"]);
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    assert.deepEqual(await sourcingState(), issued);
    await context.close();
    console.info("RFQ_TRACEABILITY_FIX22_BROWSER_OK rfq=1 create_event=1 bindings=8 issue_event=1 issue_post=1 quote=0 award=0 po=0 restart=1 desktop=1 mobile=1 session=0");
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

test.after(async () => {
  await stopServer();
  await clearSyntheticData();
  await pool.end();
});
