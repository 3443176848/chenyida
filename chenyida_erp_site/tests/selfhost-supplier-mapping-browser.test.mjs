import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const REQUIRED_DATABASE = "supplier_mapping_test_fix21_20260805";
const REQUIRED_ORIGIN = "http://127.0.0.1:43141";
const databaseUrl = process.env.DATABASE_URL || "";
const confirmation = process.env.ERP_SUPPLIER_MAPPING_FIX21_BROWSER_CONFIRM || "";
const databaseName = (value) => {
  try { return decodeURIComponent(new URL(value).pathname.replace(/^\//, "")); } catch { return ""; }
};
if (databaseName(databaseUrl) !== REQUIRED_DATABASE) throw new Error(`DATABASE_URL must target isolated ${REQUIRED_DATABASE}`);
if (confirmation !== "ISOLATED_FIX21_SYNTHETIC_ONLY") {
  throw new Error("ERP_SUPPLIER_MAPPING_FIX21_BROWSER_CONFIRM=ISOLATED_FIX21_SYNTHETIC_ONLY is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "supplier-mapping-fix21-browser" });
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
  throw new Error("Playwright is required in the isolated FIX-21 browser runner");
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
    purchase: { username: "fix20_purchase", password: `Isolated!Purchase-${randomUUID()}` },
    operations: { username: "fix20_operations", password: `Isolated!Operations-${randomUUID()}` },
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true)",
    );
    await client.query(
      `insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
        ($1,'FIX-20 隔离采购','purchase',$2,true,false,1),
        ($3,'FIX-20 隔离运营','operations',$4,true,false,1),
        ('admin01','管理员','admin','x',true,false,1),
        ('planning01','计划','planning','x',true,false,1),
        ('engineering01','工程','engineering','x',true,false,1)`,
      [
        credentials.purchase.username,
        await hashPassword(credentials.purchase.password),
        credentials.operations.username,
        await hashPassword(credentials.operations.password),
      ],
    );
    const unit = (await client.query(
      "insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id",
    )).rows[0];
    const category = (await client.query(
      `insert into material_categories(
        category_code,category_name_cn,category_level,status,created_by,updated_by,request_id
      ) values('FIX20-COMP','FIX-20 隔离物料',1,'ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    )).rows[0];
    const materials = [];
    for (const materialId of [533, 534, 535, 536]) {
      const code = `CYD-FIX20-${String(materialId).padStart(6, "0")}`;
      await client.query(
        `insert into material_master(
          id,internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,
          procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,
          last_modified_by,created_by,updated_by,request_id
        ) values($1,$2,$3,$4,'PCS',$5,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',
          'admin01','admin01','admin01',$6)`,
        [materialId, code, `FIX-20 物料 ${materialId}`, category.id, unit.id, randomUUID()],
      );
      materials.push({ id: materialId, code });
    }
    await client.query("select setval(pg_get_serial_sequence('material_master','id'),536,true)");
    const customer = (await client.query(
      `insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id)
       values('CUS-FIX20','FIX-20 隔离客户','FIX-20 隔离客户','ACTIVE','admin01','admin01',$1) returning id`,
      [randomUUID()],
    )).rows[0];
    const project = (await client.query(
      `insert into business_projects(
        project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,
        target_delivery_date,current_requirement_version_no,version,request_id,created_by
      ) values('PRJ-00000001',$1,'FIX-20 隔离 Mapping 项目','受控 Mapping 浏览器验收','admin01',
        'engineering01','ACCEPTED','2026-10-30',1,4,$2,'admin01') returning id`,
      [customer.id, randomUUID()],
    )).rows[0];
    const requirement = (await client.query(
      `insert into project_requirement_versions(
        project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by
      ) values($1,1,'FIX-20 四条物料合计 40 PCS',40,'PCS',$2,'admin01') returning id`,
      [project.id, sha256("fix20-browser-requirement")],
    )).rows[0];
    const packageRow = (await client.query(
      `insert into project_planning_packages(
        project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,
        prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id
      ) values($1,1,$2,'ACCEPTED','2026-10-30',$3,'engineering01','engineering01',now(),
        'planning01',now(),3,$4) returning id`,
      [project.id, requirement.id, sha256("fix20-browser-package"), randomUUID()],
    )).rows[0];
    const plan = (await client.query(
      `insert into planning_material_requirement_plans(
        project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
        source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
      ) values($1,$2,1,'2026-10-30','SUBMITTED',3,$3,$4,'planning01','planning01',now(),1,$5) returning id`,
      [project.id, packageRow.id, sha256("fix20-browser-package"), sha256("fix20-browser-calculation"), randomUUID()],
    )).rows[0];
    const planLineIds = [];
    for (const [index, material] of materials.entries()) {
      const line = (await client.query(
        `insert into planning_material_requirement_lines(
          plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,
          stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest
        ) values($1,$2,$3,$4,$5,$6,10,0,0,0,0,10,$7) returning id`,
        [
          plan.id,
          index + 1,
          material.id,
          unit.id,
          { internal_material_code: material.code, standard_name: `FIX-20 物料 ${material.id}` },
          sha256(`fix20-browser-material-${material.id}`),
          sha256(`fix20-browser-source-${material.id}`),
        ],
      )).rows[0];
      planLineIds.push(Number(line.id));
    }
    const purchaseRequest = (await client.query(
      `insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,version,request_id)
       values('PRQ-00000001',$1,'SUBMITTED','planning01',now(),1,$2) returning id`,
      [plan.id, randomUUID()],
    )).rows[0];
    for (const [index, material] of materials.entries()) {
      await client.query(
        `insert into planning_purchase_request_lines(
          purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity
        ) values($1,$2,$3,$4,$5,10)`,
        [purchaseRequest.id, planLineIds[index], index + 1, material.id, unit.id],
      );
    }
    await client.query(
      "update planning_material_requirement_plans set status='ACCEPTED',accepted_by=$2,accepted_at=now(),version=2,updated_at=now() where id=$1",
      [plan.id, credentials.purchase.username],
    );
    await client.query(
      "update planning_purchase_requests set status='ACCEPTED',accepted_by=$2,accepted_at=now(),updated_at=now() where id=$1",
      [purchaseRequest.id, credentials.purchase.username],
    );
    await client.query(
      `insert into planning_material_requirement_events(
        plan_id,purchase_request_id,event_type,from_status,to_status,actor,request_id
      ) values($1,$2,'PURCHASE_ACCEPTED','SUBMITTED','ACCEPTED',$3,$4)`,
      [plan.id, purchaseRequest.id, credentials.purchase.username, randomUUID()],
    );
    const suppliers = [];
    for (const [code, name] of [["SUP-000001", "FIX-20 供应商 A"], ["SUP-000002", "FIX-20 供应商 B"]]) {
      const row = (await client.query(
        `insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id)
         values($1,$2,$2,'ACTIVE',$3,$3,$4) returning id`,
        [code, name, credentials.purchase.username, randomUUID()],
      )).rows[0];
      suppliers.push({ id: Number(row.id), code, name });
    }
    await client.query("commit");
    assert.equal(Number(purchaseRequest.id), 1);
    return { credentials, unitId: Number(unit.id), materials, suppliers };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode !== null) throw new Error("isolated FIX-21 standalone server exited before health check");
    try { if ((await fetch(`${REQUIRED_ORIGIN}/api/live`)).ok) return; } catch { /* bounded liveness polling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated FIX-21 standalone server did not become healthy");
}

async function startServer() {
  server = spawn(process.execPath, [serverEntry], {
    cwd: new URL(".", `file://${serverEntry}`).pathname,
    env: {
      ...process.env,
      HOSTNAME: "0.0.0.0",
      PORT: "43141",
      NODE_OPTIONS: "--max-old-space-size=384",
      ERP_ENV: "test",
      ERP_DEPLOYMENT_CLASS: "test",
      ERP_PUBLIC_ORIGIN: REQUIRED_ORIGIN,
      ERP_UAT_ALLOW_LOOPBACK_ORIGIN: "false",
      ERP_SETUP_TOKEN: `isolated-fix21-${randomUUID()}`,
      ERP_UPLOAD_ROOT: "/tmp/fix21-uploads",
      ERP_ATTACHMENT_ROOT: "/tmp/fix21-attachments",
      ERP_BACKUP_STATUS_FILE: "/tmp/fix21-backup-status.json",
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
  const response = page.waitForResponse((item) => item.url() === `${REQUIRED_ORIGIN}/api/login` && item.request().method() === "POST");
  const summaryResponse = page.waitForResponse((item) => item.url() === `${REQUIRED_ORIGIN}/api/summary` && item.request().method() === "GET");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  assert.equal((await response).status(), 200);
  const summary = await summaryResponse;
  assert.equal(summary.status(), 200, `dashboard summary failed after login: ${await summary.text()}`);
  await page.getByRole("heading", { name: "角色工作台", exact: true }).waitFor();
}

async function logoutNative(page) {
  const response = page.waitForResponse((item) => item.url() === `${REQUIRED_ORIGIN}/api/logout` && item.request().method() === "POST");
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
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

async function governanceState() {
  const mappings = (await pool.query(
    `select status,count(*)::int count,min(created_by) created_by,min(reviewed_by) reviewed_by
     from supplier_mappings group by status order by status`,
  )).rows;
  const events = (await pool.query(
    "select event_type,count(*)::int count from supplier_mapping_events group by event_type order by event_type",
  )).rows;
  const sourcing = (await pool.query(`select
    (select count(*)::int from procurement_rfqs) rfqs,
    (select count(*)::int from procurement_rfq_lines) rfq_lines,
    (select count(*)::int from procurement_rfq_suppliers) rfq_suppliers,
    (select count(*)::int from procurement_supplier_quotes) quotes,
    (select count(*)::int from procurement_sourcing_awards) awards,
    (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
  return { mappings, events, sourcing };
}

test.before(async () => {
  assert.deepEqual(
    (await pool.query(
      "select current_database() name,(select count(*)::int from schema_migrations) migration_count,max(version) over() head,exists(select 1 from information_schema.columns where table_schema='public' and table_name='schema_migrations' and column_name='applied_at') ledger_applied_at from schema_migrations order by version desc limit 1",
    )).rows[0],
    { name: REQUIRED_DATABASE, migration_count: 46, head: "0046_runtime_lock_privilege_boundary.sql", ledger_applied_at: true },
  );
  await clearSyntheticData();
  await startServer();
});

test("isolated Chromium confirms one approval, preserves seven pending mappings and reopens its durable receipt", { timeout: 300_000 }, async () => {
  const fixture = await seedFixture();
  assert.deepEqual(await governanceState(), {
    mappings: [], events: [],
    sourcing: { rfqs: 0, rfq_lines: 0, rfq_suppliers: 0, quotes: 0, awards: 0, purchase_orders: 0 },
  });
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const authPosts = [];
    const businessMutations = [];
    const consoleErrors = [];
    const failedResponses = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method().toUpperCase();
      if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
      if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204, body: "" });
      if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) authPosts.push(url.pathname);
      else if (!["GET", "HEAD", "OPTIONS"].includes(method)) businessMutations.push({ method, path: url.pathname });
      return route.continue();
    });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
        type: response.request().resourceType(),
      });
    });

    await login(page, fixture.credentials.purchase);
    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商询价与定标", exact: true }).waitFor();
    for (const material of fixture.materials) await page.getByText(material.code, { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("article.rfq-supplier").length === 2);
    for (const supplier of fixture.suppliers) {
      const card = page.locator("article.rfq-supplier", { hasText: supplier.code });
      assert.match(await card.innerText(), /覆盖 0\/4 · 不可选/);
      assert.equal(await card.locator('input[name="supplier_ids"]').isDisabled(), true);
      for (const material of fixture.materials) assert.match(await card.innerText(), new RegExp(`Material ${material.id} / ${material.code}`));
    }
    assert.equal(await page.getByRole("button", { name: "建立询价草稿", exact: true }).isDisabled(), true);

    await page.goto(`${REQUIRED_ORIGIN}/procurement/supplier-mappings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商物料映射", exact: true }).waitFor();
    const createForm = page.locator("form.sm-create");
    await createForm.locator('select[name="supplier_id"] option').nth(1).waitFor({ state: "attached" });
    const mappingIds = [];
    for (const supplier of fixture.suppliers) {
      for (const material of fixture.materials) {
        const partNumber = `FIX21-S${supplier.id}-M${material.id}`;
        await createForm.locator('select[name="supplier_id"]').selectOption(String(supplier.id));
        await createForm.locator('select[name="material_id"]').selectOption(String(material.id));
        await createForm.locator('input[name="supplier_item_code"]').fill(partNumber);
        await createForm.locator('input[name="supplier_item_name"]').fill(`${supplier.code} ${material.code}`);
        await createForm.locator('select[name="purchase_unit_id"]').selectOption(String(fixture.unitId));
        await createForm.locator('input[name="conversion_numerator"]').fill("1");
        await createForm.locator('input[name="conversion_denominator"]').fill("1");
        await createForm.locator('input[name="valid_from"]').fill("2026-01-01");
        await createForm.locator('input[name="valid_to"]').fill("");
        const createdResponse = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/supplier-mappings` && response.request().method() === "POST");
        await createForm.getByRole("button", { name: "保存草稿", exact: true }).click();
        const created = await createdResponse;
        assert.equal(created.status(), 201);
        const createdPayload = await created.json();
        mappingIds.push(createdPayload.mapping_id);
        const card = page.locator("article.sm-card", { hasText: partNumber });
        await card.waitFor();
        assert.match(await card.innerText(), /草稿/);
        const submittedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/supplier-mappings/${createdPayload.mapping_id}/submit`) && response.request().method() === "POST");
        await card.getByRole("button", { name: "提交审核", exact: true }).click();
        assert.equal((await submittedResponse).status(), 200);
        await card.getByText("待审核", { exact: true }).waitFor();
      }
    }
    assert.equal(new Set(mappingIds).size, 8);
    assert.equal(await page.locator("article.sm-card").count(), 8);
    await noOverflow(page, "purchase mapping desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "purchase mapping 390x844");
    await logoutNative(page);

    await login(page, fixture.credentials.operations);
    await page.goto(`${REQUIRED_ORIGIN}/operations/supplier-mappings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商映射运营审核", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 8);
    assert.equal(await page.locator("article.sm-card details.sm-edit").count(), 0);
    assert.equal(await page.locator('article.sm-card input[name="supplier_id"]').count(), 0);
    assert.equal(await page.getByRole("button", { name: "批准并生效", exact: true }).count(), 8);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "operations review 390x844");
    await page.setViewportSize({ width: 1440, height: 900 });
    const approvedMappingId = mappingIds[0];
    const approvedPartNumber = `FIX21-S${fixture.suppliers[0].id}-M${fixture.materials[0].id}`;
    const approve = page.locator("article.sm-card", { hasText: approvedPartNumber }).getByRole("button", { name: "批准并生效", exact: true });
    const approvedEvents = async () => Number((await pool.query("select count(*) count from supplier_mapping_events where event_type='APPROVED'")).rows[0].count);

    await approve.click();
    let dialog = page.getByRole("dialog", { name: "确认批准并生效" });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), new RegExp(approvedMappingId));
    for (const fact of ["待审核", "Supplier", "Material", "已生效", "创建成功事实", "提交成功事实", "相同 Supplier / Material 已生效映射", "Supplier 内料号冲突", "RFQ 0 / Quote 0 / Award 0 / PO 0"]) {
      assert.match(await dialog.innerText(), new RegExp(fact));
    }
    assert.equal(await approvedEvents(), 0);
    assert.equal(businessMutations.filter(({ path }) => path.endsWith("/approve")).length, 0);
    await dialog.getByRole("button", { name: "关闭审核窗口", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await approvedEvents(), 0);

    await approve.click();
    dialog = page.getByRole("dialog", { name: "确认批准并生效" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await approvedEvents(), 0);

    await approve.click();
    dialog = page.getByRole("dialog", { name: "确认批准并生效" });
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await approvedEvents(), 0);

    await approve.click();
    dialog = page.getByRole("dialog", { name: "确认批准并生效" });
    const comment = dialog.getByLabel("审核意见（独立字段，必填）", { exact: true });
    await comment.waitFor();
    const confirm = dialog.getByRole("button", { name: "确认批准并生效", exact: true });
    assert.equal(await confirm.isDisabled(), true);
    const approvalComment = "UAT审核通过：供应商、正式物料、PCS单位及1:1换算核对一致。";
    await comment.fill(approvalComment);
    assert.equal(await confirm.isEnabled(), true);
    const approvedResponse = page.waitForResponse((response) => response.url().endsWith("/approve") && response.request().method() === "POST");
    await confirm.dblclick();
    assert.equal((await approvedResponse).status(), 200);
    const receipt = page.getByRole("dialog", { name: "批准成功凭证" });
    await receipt.waitFor();
    for (const fact of [approvedMappingId, "批准", "成功", approvalComment, "批准前 Version / CAS", "批准后 Version / CAS", "已生效"]) {
      assert.match(await receipt.innerText(), new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.equal(await approvedEvents(), 1);
    assert.equal(businessMutations.filter(({ path }) => path.endsWith("/approve")).length, 1);
    await receipt.getByRole("button", { name: "关闭凭证", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 7);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商映射运营审核", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 7);
    const filterForm = page.locator("form.sm-filter");
    await filterForm.locator('select[name="status"]').selectOption("ACTIVE");
    await filterForm.locator('input[name="mapping_id"]').fill(approvedMappingId);
    await filterForm.locator('input[name="supplier_part_number"]').fill("M533");
    await filterForm.getByRole("button", { name: "筛选", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 1);
    await page.getByRole("button", { name: "查看批准凭证", exact: true }).click();
    const persistedReceipt = page.getByRole("dialog", { name: "批准成功凭证" });
    await persistedReceipt.waitFor();
    assert.match(await persistedReceipt.innerText(), new RegExp(approvalComment));
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "persisted approval receipt 390x844");
    await persistedReceipt.getByRole("button", { name: "关闭凭证", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });

    await logoutNative(page);
    await login(page, fixture.credentials.operations);
    await page.goto(`${REQUIRED_ORIGIN}/operations/supplier-mappings`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 7);
    const reloginFilter = page.locator("form.sm-filter");
    await reloginFilter.locator('select[name="status"]').selectOption("ACTIVE");
    await reloginFilter.locator('input[name="mapping_id"]').fill(approvedMappingId);
    await reloginFilter.getByRole("button", { name: "筛选", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 1);
    await page.getByRole("button", { name: "查看批准凭证", exact: true }).click();
    const reloginReceipt = page.getByRole("dialog", { name: "批准成功凭证" });
    await reloginReceipt.waitFor();
    assert.match(await reloginReceipt.innerText(), new RegExp(approvalComment));
    await reloginReceipt.getByRole("button", { name: "关闭凭证", exact: true }).click();

    await stopServer();
    await startServer();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商映射运营审核", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 7);
    const restartFilter = page.locator("form.sm-filter");
    await restartFilter.locator('select[name="status"]').selectOption("ACTIVE");
    await restartFilter.locator('input[name="mapping_id"]').fill(approvedMappingId);
    await restartFilter.getByRole("button", { name: "筛选", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 1);
    await page.getByRole("button", { name: "查看批准凭证", exact: true }).click();
    const restartReceipt = page.getByRole("dialog", { name: "批准成功凭证" });
    await restartReceipt.waitFor();
    assert.match(await restartReceipt.innerText(), new RegExp(approvalComment));
    await restartReceipt.getByRole("button", { name: "关闭凭证", exact: true }).click();

    await restartFilter.locator('input[name="mapping_id"]').fill("");
    await restartFilter.locator('input[name="supplier_part_number"]').fill("");
    await restartFilter.locator('select[name="status"]').selectOption("PENDING_REVIEW");
    await restartFilter.getByRole("button", { name: "筛选", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 7);

    assert.deepEqual(await governanceState(), {
      mappings: [
        { status: "ACTIVE", count: 1, created_by: fixture.credentials.purchase.username, reviewed_by: fixture.credentials.operations.username },
        { status: "PENDING_REVIEW", count: 7, created_by: fixture.credentials.purchase.username, reviewed_by: null },
      ],
      events: [
        { event_type: "APPROVED", count: 1 },
        { event_type: "CREATED", count: 8 },
        { event_type: "SUBMITTED", count: 8 },
      ],
      sourcing: { rfqs: 0, rfq_lines: 0, rfq_suppliers: 0, quotes: 0, awards: 0, purchase_orders: 0 },
    });
    assert.deepEqual((await pool.query("select reason,result from supplier_mapping_events where event_type='APPROVED'")).rows, [{ reason: approvalComment, result: "SUCCESS" }]);
    assert.equal(businessMutations.filter(({ path }) => path === "/api/supplier-mappings").length, 8);
    assert.equal(businessMutations.filter(({ path }) => path.endsWith("/submit")).length, 8);
    assert.equal(businessMutations.filter(({ path }) => path.endsWith("/approve")).length, 1);
    assert.equal(businessMutations.filter(({ path }) => path === "/api/procurement/rfqs").length, 0);
    assert.equal(businessMutations.length, 17);
    await logoutNative(page);
    assert.deepEqual(authPosts, ["/api/login", "/api/logout", "/api/login", "/api/logout", "/api/login", "/api/logout"]);
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=any($1::text[]) and revoked_at is null and expires_at>now()",
      [[fixture.credentials.purchase.username, fixture.credentials.operations.username]],
    )).rows[0].count), 0);
    assert.deepEqual(failedResponses, []);
    assert.deepEqual(consoleErrors, []);
    await context.close();
    console.info("SUPPLIER_MAPPING_FIX21_BROWSER_OK mappings=8 active=1 pending=7 approve_events=1 rfq=0 quote=0 award=0 po=0 sessions=0 desktop=1 mobile=1");
  } finally { await browser?.close().catch(() => undefined); }
});

test.after(async () => {
  await stopServer();
  await clearSyntheticData();
  await pool.end();
});
