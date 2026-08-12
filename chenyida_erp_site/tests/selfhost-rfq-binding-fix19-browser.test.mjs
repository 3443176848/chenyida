import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";
import { withSupplierMappingFixtureTriggersDisabled } from "./helpers/supplier-mapping-fixture.mjs";

const REQUIRED_DATABASE = "procurement_sourcing_test_fix19_20260804";
const REQUIRED_ORIGIN = "http://127.0.0.1:43139";
const databaseUrl = process.env.DATABASE_URL || "";
const confirmation = process.env.ERP_RFQ_BINDING_FIX19_BROWSER_CONFIRM || "";
const databaseName = (value) => {
  try { return decodeURIComponent(new URL(value).pathname.replace(/^\//, "")); } catch { return ""; }
};
if (databaseName(databaseUrl) !== REQUIRED_DATABASE) throw new Error(`DATABASE_URL must target isolated ${REQUIRED_DATABASE}`);
if (confirmation !== "ISOLATED_FIX19_SYNTHETIC_ONLY") {
  throw new Error("ERP_RFQ_BINDING_FIX19_BROWSER_CONFIRM=ISOLATED_FIX19_SYNTHETIC_ONLY is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "rfq-binding-fix19-browser" });
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const serverEntry = process.env.ERP_BROWSER_SERVER_ENTRY || "/standalone/server.js";
let server;

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the isolated FIX-19 browser runner");
}

async function clearSyntheticData() {
  const tables = await pool.query(
    "select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','app_meta') order by tablename",
  );
  const quoted = tables.rows.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`);
  if (quoted.length) await pool.query(`truncate table ${quoted.join(",")} restart identity cascade`);
}

async function seedFixture() {
  const credentials = {
    username: "fix19_purchase",
    password: `Isolated!Fix19-${randomUUID()}`,
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true)",
    );
    await client.query(
      `insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
        ($1,'FIX-19 隔离采购','purchase',$2,true,false,1),
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
      ) values('FIX19-COMP','FIX-19 隔离物料',1,'ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    )).rows[0];
    const materialIds = [533, 534, 535, 536];
    for (const materialId of materialIds) {
      await client.query(
        `insert into material_master(
          id,internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,
          procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,
          last_modified_by,created_by,updated_by,request_id
        ) values($1,$2,$3,$4,'PCS',$5,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',
          'admin01','admin01','admin01',$6)`,
        [materialId, `CYD-FIX19-${String(materialId).padStart(6, "0")}`, `FIX-19 物料 ${materialId}`, category.id, unit.id, randomUUID()],
      );
    }
    await client.query("select setval(pg_get_serial_sequence('material_master','id'),536,true)");
    const customer = (await client.query(
      `insert into customers(
        customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id
      ) values('CUS-FIX19','FIX-19 隔离客户','FIX-19 隔离客户','ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    )).rows[0];
    const project = (await client.query(
      `insert into business_projects(
        project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,
        target_delivery_date,current_requirement_version_no,version,request_id,created_by
      ) values('PRJ-00000001',$1,'FIX-19 隔离 RFQ 项目','稳定 ID 浏览器验收','admin01',
        'engineering01','ACCEPTED','2026-10-30',1,4,$2,'admin01') returning id`,
      [customer.id, randomUUID()],
    )).rows[0];
    const requirement = (await client.query(
      `insert into project_requirement_versions(
        project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by
      ) values($1,1,'FIX-19 四条物料合计 40 PCS',40,'PCS',$2,'admin01') returning id`,
      [project.id, sha256("fix19-browser-requirement")],
    )).rows[0];
    const packageRow = (await client.query(
      `insert into project_planning_packages(
        project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,
        prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id
      ) values($1,1,$2,'ACCEPTED','2026-10-30',$3,'engineering01','engineering01',now(),
        'planning01',now(),3,$4) returning id`,
      [project.id, requirement.id, sha256("fix19-browser-package"), randomUUID()],
    )).rows[0];
    const plan = (await client.query(
      `insert into planning_material_requirement_plans(
        project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
        source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
      ) values($1,$2,1,'2026-10-30','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
      [project.id, packageRow.id, sha256("fix19-browser-package"), sha256("fix19-browser-calculation"), randomUUID()],
    )).rows[0];
    const planLineIds = [];
    for (const [index, materialId] of materialIds.entries()) {
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
          { internal_material_code: `CYD-FIX19-${String(materialId).padStart(6, "0")}`, standard_name: `FIX-19 物料 ${materialId}` },
          sha256(`fix19-browser-material-${materialId}`),
          sha256(`fix19-browser-source-${materialId}`),
        ],
      )).rows[0];
      planLineIds.push(Number(line.id));
    }
    const purchaseRequest = (await client.query(
      `insert into planning_purchase_requests(
        request_code,plan_id,status,submitted_by,submitted_at,version,request_id
      ) values('PRQ-00000001',$1,'SUBMITTED','planning01',now(),1,$2) returning id`,
      [plan.id, randomUUID()],
    )).rows[0];
    for (const [index, materialId] of materialIds.entries()) {
      await client.query(
        `insert into planning_purchase_request_lines(
          purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
        ) values($1,$2,$3,$4,$5,10)`,
        [purchaseRequest.id, planLineIds[index], index + 1, materialId, unit.id],
      );
    }
    await client.query(
      `update planning_material_requirement_plans set
        status='ACCEPTED',accepted_by=$2,accepted_at=now(),version=2,updated_at=now()
      where id=$1`,
      [plan.id, credentials.username],
    );
    await client.query(
      `update planning_purchase_requests set
        status='ACCEPTED',accepted_by=$2,accepted_at=now(),updated_at=now()
      where id=$1`,
      [purchaseRequest.id, credentials.username],
    );
    await client.query(
      `insert into planning_material_requirement_events(
        plan_id,purchase_request_id,event_type,from_status,to_status,actor,request_id
      ) values($1,$2,'PURCHASE_ACCEPTED','SUBMITTED','ACCEPTED',$3,$4)`,
      [plan.id, purchaseRequest.id, credentials.username, randomUUID()],
    );

    const supplierDefinitions = [
      ["SUP-000001", "FIX-19 快速交付供应商 A"],
      ["SUP-000002", "FIX-19 低价供应商 B"],
    ];
    const supplierRows = [];
    for (const [supplierCode, supplierName] of supplierDefinitions) {
      const supplier = (await client.query(
        `insert into suppliers(
          supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id
        ) values($1,$2,$2,'ACTIVE',$3,$3,$4) returning id`,
        [supplierCode, supplierName, credentials.username, randomUUID()],
      )).rows[0];
      supplierRows.push({ supplier, supplierCode, supplierName });
    }
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      for (const { supplier, supplierCode, supplierName } of supplierRows) {
        for (const materialId of materialIds) {
          await client.query(
            `insert into supplier_mappings(
              material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,
              purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,
              created_by,updated_by,request_id
            ) values($1,$2,$3,$4,$5,'PCS',$6,1,1,'ACTIVE',now()-interval '1 day',$7,$7,$8)`,
            [
              materialId,
              supplier.id,
              supplierName,
              supplierCode,
              `${supplierCode}-${materialId}`,
              unit.id,
              credentials.username,
              randomUUID(),
            ],
          );
        }
      }
    });
    await client.query("commit");
    assert.equal(Number(purchaseRequest.id), 1);
    return { credentials, materialIds };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode !== null) throw new Error("isolated FIX-19 standalone server exited before health check");
    try {
      const response = await fetch(`${REQUIRED_ORIGIN}/api/live`);
      if (response.ok) return;
    } catch { /* bounded readiness polling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated FIX-19 standalone server did not become healthy");
}

async function startServer() {
  server = spawn(process.execPath, [serverEntry], {
    cwd: new URL(".", `file://${serverEntry}`).pathname,
    env: {
      ...process.env,
      HOSTNAME: "0.0.0.0",
      PORT: "43139",
      NODE_OPTIONS: "--max-old-space-size=384",
      ERP_ENV: "test",
      ERP_DEPLOYMENT_CLASS: "test",
      ERP_PUBLIC_ORIGIN: REQUIRED_ORIGIN,
      ERP_UAT_ALLOW_LOOPBACK_ORIGIN: "false",
      ERP_SETUP_TOKEN: `isolated-fix19-${randomUUID()}`,
      ERP_UPLOAD_ROOT: "/tmp/fix19-uploads",
      ERP_ATTACHMENT_ROOT: "/tmp/fix19-attachments",
      ERP_BACKUP_STATUS_FILE: "/tmp/fix19-backup-status.json",
    },
    stdio: "ignore",
  });
  await waitForServer();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function login(page, credentials) {
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  const response = page.waitForResponse(
    (item) => item.url() === `${REQUIRED_ORIGIN}/api/login` && item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.getByRole("heading", { name: "角色工作台", exact: true }).waitFor();
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

async function sourcingState() {
  const header = (await pool.query(
    "select id::int,purchase_request_id::int,status,response_deadline::text from procurement_rfqs order by id",
  )).rows;
  const lines = (await pool.query(
    `select rfq_id::int,line_no::int,purchase_request_line_id::int,material_id::int,
      requested_quantity::numeric(24,6)::text,required_date::text
    from procurement_rfq_lines order by rfq_id,line_no`,
  )).rows;
  const suppliers = (await pool.query(
    "select rfq_id::int,supplier_id::int from procurement_rfq_suppliers order by rfq_id,supplier_id",
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
  return { header, lines, suppliers, downstream };
}

test.before(async () => {
  assert.deepEqual(
    (await pool.query(
      "select current_database() name,(select count(*)::int from schema_migrations) migration_count,max(version) over() head from schema_migrations order by version desc limit 1",
    )).rows[0],
    {
      name: REQUIRED_DATABASE,
      migration_count: 45,
      head: "0045_runtime_worker_readiness.sql",
    },
  );
  await clearSyntheticData();
  await startServer();
});

test("isolated Chromium creates one stable-ID RFQ draft and no downstream records", { timeout: 240_000 }, async () => {
  const fixture = await seedFixture();
  assert.deepEqual(await sourcingState(), {
    header: [],
    lines: [],
    suppliers: [],
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
      if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) {
        authPosts.push(url.pathname);
      } else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        businessPosts.push({ method, path: url.pathname, body: request.postDataJSON() });
      }
      return route.continue();
    });

    const page = await context.newPage();
    await login(page, fixture.credentials);
    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商询价与定标", exact: true }).waitFor();
    const requestCard = page.locator("article.sourcing-card", { hasText: "PRQ-00000001 · PRJ-00000001" });
    await requestCard.waitFor();
    assert.equal(await requestCard.count(), 1);
    assert.match(await requestCard.innerText(), /4 行 · 40\.000000/);

    const requestSelect = page.locator('select[name="purchase_request_id"]');
    assert.equal(await requestSelect.count(), 1);
    const requestOptions = await requestSelect.locator("option").evaluateAll((options) => options.map((option) => ({
      value: option.value,
      text: option.textContent?.trim(),
    })));
    assert.deepEqual(requestOptions, [
      { value: "", text: "请选择" },
      { value: "1", text: "PRQ-00000001 · PRJ-00000001" },
    ]);
    const supplierA = page.getByLabel("SUP-000001 · FIX-19 快速交付供应商 A", { exact: true });
    const supplierB = page.getByLabel("SUP-000002 · FIX-19 低价供应商 B", { exact: true });
    await supplierA.waitFor();
    await supplierB.waitFor();
    assert.equal(await supplierA.count(), 1);
    assert.equal(await supplierB.count(), 1);
    assert.equal(await supplierA.getAttribute("value"), "1");
    assert.equal(await supplierB.getAttribute("value"), "2");

    await requestSelect.selectOption("1");
    await supplierB.check();
    await supplierA.check();
    await page.getByLabel("报价截止日", { exact: true }).fill("2026-10-15");
    const form = page.locator("form.sourcing-form", { has: page.getByRole("button", { name: "建立询价草稿", exact: true }) });
    assert.equal(await form.evaluate((element) => element.checkValidity()), true);
    assert.equal(await page.getByRole("button", { name: "建立询价草稿", exact: true }).isEnabled(), true);
    assert.equal(await requestSelect.inputValue(), "1");
    assert.equal(await supplierA.isChecked(), true);
    assert.equal(await supplierB.isChecked(), true);
    await noOverflow(page, "RFQ form desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await requestSelect.inputValue(), "1");
    assert.equal(await supplierA.isChecked(), true);
    assert.equal(await supplierB.isChecked(), true);
    await noOverflow(page, "RFQ form 390x844");
    await page.setViewportSize({ width: 1440, height: 900 });

    const createResponse = page.waitForResponse(
      (response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs`
        && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "建立询价草稿", exact: true }).click();
    const response = await createResponse;
    assert.equal(response.status(), 201);
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    assert.deepEqual(businessPosts, [{
      method: "POST",
      path: "/api/procurement/rfqs",
      body: {
        purchase_request_id: 1,
        supplier_ids: [1, 2],
        response_deadline: "2026-10-15",
        expected_version: 1,
      },
    }]);
    assert.equal(typeof businessPosts[0].body.purchase_request_id, "number");
    assert.ok(businessPosts[0].body.supplier_ids.every((id) => typeof id === "number"));

    const state = await sourcingState();
    assert.deepEqual(state.header, [{ id: 1, purchase_request_id: 1, status: "DRAFT", response_deadline: "2026-10-15" }]);
    assert.deepEqual(state.lines.map((line) => line.material_id), fixture.materialIds);
    assert.deepEqual(state.lines.map((line) => line.requested_quantity), Array(4).fill("10.000000"));
    assert.deepEqual(state.lines.map((line) => line.required_date), Array(4).fill("2026-10-30"));
    assert.equal(new Set(state.lines.map((line) => line.purchase_request_line_id)).size, 4);
    assert.deepEqual(state.suppliers, [{ rfq_id: 1, supplier_id: 1 }, { rfq_id: 1, supplier_id: 2 }]);
    assert.deepEqual(state.downstream, {
      quotes: 0,
      awards: 0,
      purchase_orders: 0,
      delivery_plans: 0,
      receipts: 0,
      ledger_entries: 0,
      ap_documents: 0,
      work_orders: 0,
    });

    const sourcePanel = page.locator("section.sourcing-panel", { has: page.getByRole("heading", { name: "采购申请来源", exact: true }) });
    assert.equal(await sourcePanel.locator("tbody tr").count(), 4);
    for (const materialId of fixture.materialIds) await sourcePanel.getByText(`CYD-FIX19-${String(materialId).padStart(6, "0")}`, { exact: true }).waitFor();
    const suppliersPanel = page.locator("section.sourcing-panel", { has: page.getByRole("heading", { name: "候选供应商与报价版本", exact: true }) });
    assert.equal(await suppliersPanel.locator(".sourcing-cards .sourcing-card").count(), 2);
    await noOverflow(page, "RFQ detail desktop");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    assert.equal(await sourcePanel.locator("tbody tr").count(), 4);
    assert.equal(await suppliersPanel.locator(".sourcing-cards .sourcing-card").count(), 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "RFQ detail after refresh 390x844");

    await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "安全退出", exact: true }).click();
    await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
    assert.deepEqual(authPosts, ["/api/login", "/api/logout"]);
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    assert.deepEqual(await sourcingState(), state);
    await context.close();
    console.info("RFQ_BINDING_FIX19_BROWSER_OK rfq=1 lines=4 suppliers=2 quote=0 award=0 business_post=1 session_revoked=1 desktop=1 mobile=1 refresh=1");
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

test.after(async () => {
  await stopServer();
  await clearSyntheticData();
  await pool.end();
});
