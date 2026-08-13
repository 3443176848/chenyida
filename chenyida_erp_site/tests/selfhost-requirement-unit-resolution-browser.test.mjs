import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const REQUIRED_DATABASE = "cyd_unit_resolution_browser_test_0036";
const REQUIRED_BROWSER_ORIGIN = "http://127.0.0.1:43136";
const databaseUrl = process.env.DATABASE_URL || "";
const acceptanceConfirm = process.env.ERP_REQUIREMENT_UNIT_BROWSER_CONFIRM || "";
const browserBaseUrl = process.env.ERP_BROWSER_BASE_URL || "";
const traceabilityReturnOnly = process.env.ERP_PLANNING_TRACEABILITY_BROWSER_MODE === "TRACEABILITY_RETURN_ONLY";

function parsedDatabaseName(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

if (parsedDatabaseName(databaseUrl) !== REQUIRED_DATABASE) {
  throw new Error(`DATABASE_URL must target the isolated ${REQUIRED_DATABASE} database`);
}
if (acceptanceConfirm !== "ISOLATED_0036_SYNTHETIC_ONLY") {
  throw new Error("ERP_REQUIREMENT_UNIT_BROWSER_CONFIRM=ISOLATED_0036_SYNTHETIC_ONLY is required");
}

let browserOrigin;
try {
  const parsed = new URL(browserBaseUrl);
  if (parsed.origin !== REQUIRED_BROWSER_ORIGIN || parsed.href !== `${REQUIRED_BROWSER_ORIGIN}/`) throw new Error();
  browserOrigin = parsed.origin;
} catch {
  throw new Error(`ERP_BROWSER_BASE_URL must be exactly ${REQUIRED_BROWSER_ORIGIN}`);
}

const pool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "requirement-unit-resolution-browser-0036" });
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const syntheticPassword = () => `Uat!9aA-${randomUUID()}`;

async function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean);
  for (const specifier of candidates) {
    try {
      const loaded = await import(specifier);
      if (loaded.chromium) return loaded.chromium;
    } catch {
      // The isolated runner may provide Playwright outside this repository.
    }
  }
  throw new Error("Playwright is required in the isolated browser-test runner");
}

async function assertIsolatedSchema() {
  const current = await pool.query("select current_database() database_name");
  assert.equal(current.rows[0].database_name, REQUIRED_DATABASE);
  const migrations = await pool.query("select count(*)::integer count,max(version) latest from schema_migrations");
  assert.deepEqual(migrations.rows[0], { count: 46, latest: "0046_runtime_lock_privilege_boundary.sql" });
  const relations = await pool.query("select to_regclass('public.project_requirement_unit_resolution_versions') versions,to_regclass('public.project_requirement_unit_resolution_heads') heads");
  assert.deepEqual(relations.rows[0], { versions: "project_requirement_unit_resolution_versions", heads: "project_requirement_unit_resolution_heads" });
}

async function clearSyntheticData() {
  const client = await pool.connect();
  try {
    const tables = await client.query("select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','app_meta') order by tablename");
    const quoted = tables.rows.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`);
    if (quoted.length) await client.query(`truncate table ${quoted.join(",")} restart identity cascade`);
  } finally {
    client.release();
  }
}

async function seedSyntheticFixture() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const credentials = {
    engineering: { username: `browser_eng_${suffix}`, password: syntheticPassword() },
    planning: { username: `browser_plan_${suffix}`, password: syntheticPassword() },
  };
  const salesUsername = `browser_sales_${suffix}`;
  const engineeringHash = await hashPassword(credentials.engineering.password);
  const planningHash = await hashPassword(credentials.planning.password);
  const salesHash = await hashPassword(syntheticPassword());
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true)");
    await client.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
      ($1,'浏览器工程','engineering',$2,true,false,1),
      ($3,'浏览器计划','planning',$4,true,false,1),
      ($5,'浏览器销售','sales',$6,true,false,1)`, [credentials.engineering.username, engineeringHash, credentials.planning.username, planningHash, salesUsername, salesHash]);

    const customer = (await client.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-BROWSER-0036','0036 浏览器客户','0036 浏览器客户','ACTIVE',$1,$1,$2) returning id", [salesUsername, randomUUID()])).rows[0];
    const pcs = (await client.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id")).rows[0];
    const set = (await client.query("insert into units(code,name,symbol,unit_type,enabled) values('SET','套','SET','COUNT',true) returning id")).rows[0];
    const disabled = (await client.query("insert into units(code,name,symbol,unit_type,enabled) values('OLD','停用单位','OLD','COUNT',false) returning id")).rows[0];
    const category = (await client.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('BROWSER-0036','0036 浏览器零件',1,'ACTIVE',$1,$1,$2) returning id", [credentials.engineering.username, randomUUID()])).rows[0];
    const materialIds = [];
    for (let index = 1; index <= 4; index += 1) {
      const material = await client.query("insert into material_master(internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,approved_by,approved_at,created_by,updated_by,request_id) values($1,$2,$3,'BROWSER','BROWSER',$4,'PCS',$5,'ACTIVE','PURCHASED','STOCK','IQC','RoHS','MANUAL',$6,$6,now(),$6,$6,$7) returning id", [`MAT-BROWSER-0036-${index}`, `0036 浏览器零件 ${index}`, category.id, `BROWSER-${index}`, pcs.id, credentials.engineering.username, randomUUID()]);
      materialIds.push(Number(material.rows[0].id));
    }

    const product = (await client.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values('PROD-BROWSER-0036','0036 浏览器产品',$1,'ACTIVE',$2,$2,$3) returning id", [customer.id, credentials.engineering.username, randomUUID()])).rows[0];
    const productVersion = (await client.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,engineering_owner,released_by,released_at,created_by,updated_by,request_id) values($1,1,'A0','RELEASED','ASSEMBLY','ACTIVE',$2,$2,now(),$2,$2,$3) returning id", [product.id, credentials.engineering.username, randomUUID()])).rows[0];
    const bomHeader = (await client.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values('BOM-BROWSER-0036',$1,'ACTIVE',$2,$2,$3) returning id", [product.id, credentials.engineering.username, randomUUID()])).rows[0];
    const bomVersion = (await client.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,created_by,updated_by,request_id) values($1,$2,1,'V1','DRAFT',$3,$3,$4) returning id", [bomHeader.id, productVersion.id, credentials.engineering.username, randomUUID()])).rows[0];
    for (let index = 0; index < materialIds.length; index += 1) {
      await client.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,created_by,updated_by,request_id) values($1,$2,$3,'1.000000',$4,'0.00000000','ASSEMBLY',$5,$5,$6)", [bomVersion.id, (index + 1) * 10, materialIds[index], pcs.id, credentials.engineering.username, randomUUID()]);
    }
    await client.query("update bom_versions set status='RELEASED',released_by=$2,released_at=now() where id=$1", [bomVersion.id, credentials.engineering.username]);

    const project = (await client.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values('PRJ-99000036',$1,'0036 浏览器项目','隔离验证版本化需求单位解析',$2,$3,'ACCEPTED','2026-12-31',1,4,$4,$2) returning id", [customer.id, salesUsername, credentials.engineering.username, randomUUID()])).rows[0];
    const requirementVersion = (await client.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,technical_requirements,content_digest,created_by) values($1,1,'10 个待工程确认单位的成品',10,'','不得从 BOM 推断需求单位',$2,$3) returning id", [project.id, sha256(`requirement-${suffix}`), salesUsername])).rows[0];
    const requirementItem = (await client.query("insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending,specification_requirement) values($1,1,'0036 浏览器成品',10,null,true,'按已发布 A0 / V1 生产') returning id", [requirementVersion.id])).rows[0];
    const productBomResolution = (await client.query("insert into project_requirement_resolutions(project_id,requirement_version_id,requirement_item_id,product_id,product_version_id,bom_header_id,bom_version_id,resolved_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id", [project.id, requirementVersion.id, requirementItem.id, product.id, productVersion.id, bomHeader.id, bomVersion.id, credentials.engineering.username, randomUUID()])).rows[0];

    const unresolved = await client.query("select (select count(*)::integer from project_requirement_unit_resolution_versions) versions,(select count(*)::integer from project_requirement_unit_resolution_heads) heads,(select count(*)::integer from project_planning_packages) packages");
    assert.deepEqual(unresolved.rows[0], { versions: 0, heads: 0, packages: 0 });
    await client.query("commit");
    return {
      credentials,
      projectCode: "PRJ-99000036",
      projectId: Number(project.id),
      projectVersion: 4,
      requirementVersionId: Number(requirementVersion.id),
      requirementItemId: Number(requirementItem.id),
      productId: Number(product.id),
      productVersionId: Number(productVersion.id),
      bomHeaderId: Number(bomHeader.id),
      bomVersionId: Number(bomVersion.id),
      productBomResolutionId: Number(productBomResolution.id),
      pcsUnitId: Number(pcs.id),
      setUnitId: Number(set.id),
      disabledUnitId: Number(disabled.id),
      materialIds,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function login(page, credentials) {
  await page.goto(`${browserOrigin}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  const responsePromise = page.waitForResponse((response) => response.url() === `${browserOrigin}/api/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, "synthetic browser user login must succeed");
  await page.getByRole("heading", { name: "角色工作台", exact: true }).waitFor();
}

async function logout(page) {
  await page.goto(`${browserOrigin}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "角色工作台", exact: true }).waitFor();
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
}

async function assertNoPageOverflow(page, stage) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(dimensions.documentWidth <= dimensions.viewport + 1, `${stage}: document must not overflow the 390px viewport`);
  assert.ok(dimensions.bodyWidth <= dimensions.viewport + 1, `${stage}: body must not overflow the 390px viewport`);
}

async function openEngineeringWorkspace(page, fixture) {
  await page.goto(`${browserOrigin}/engineering/projects/${fixture.projectId}/planning`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: `${fixture.projectCode} · 计划交接`, exact: true }).waitFor();
}

async function openPlanningWorkspace(page) {
  await page.goto(`${browserOrigin}/planning/handoffs`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "计划部门交接工作台", exact: true }).waitFor();
}

test("real browser completes versioned requirement Unit Resolution handoff after an isolated 0036-to-current upgrade", { timeout: 240_000 }, async () => {
  await assertIsolatedSchema();
  const chromium = await loadChromium();
  await clearSyntheticData();
  const fixture = await seedSyntheticFixture();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ["--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const allowedPostPaths = [
      /^\/api\/login$/,
      /^\/api\/logout$/,
      /^\/api\/projects\/\d+\/requirement-unit-resolutions$/,
      /^\/api\/projects\/\d+\/planning-packages$/,
      traceabilityReturnOnly ? /^\/api\/planning-packages\/\d+\/(?:submit|return)$/ : /^\/api\/planning-packages\/\d+\/(?:submit|return|accept)$/,
    ];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method().toUpperCase();
      if (url.origin !== browserOrigin) {
        await route.abort("blockedbyclient");
        return;
      }
      if (["GET", "HEAD", "OPTIONS"].includes(method)
        || (method === "POST" && allowedPostPaths.some((pattern) => pattern.test(url.pathname)))) {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    assert.deepEqual(page.viewportSize(), { width: 390, height: 844 });

    await login(page, fixture.credentials.engineering);
    await openEngineeringWorkspace(page, fixture);
    await assertNoPageOverflow(page, "initial engineering resolution");
    await page.getByText("工程单位确认只写入追加式解析版本，不会改写销售原始需求，也不会从 BOM 推断单位。", { exact: true }).waitFor();
    await page.getByText("单位：未完成", { exact: true }).waitFor();
    await page.getByText("Product / BOM：已完成", { exact: true }).waitFor();
    await page.getByText("尚无已持久化的 Unit Resolution", { exact: true }).waitFor();

    const unitSelector = page.getByLabel("需求 1 单位", { exact: true });
    assert.equal(await unitSelector.inputValue(), "", "PCS must not be preselected");
    assert.deepEqual(await unitSelector.locator("option").allTextContents(), ["请选择有效单位", "件 · PCS", "套 · SET"]);
    assert.ok(!(await unitSelector.locator("option").allTextContents()).some((label) => label.includes("停用单位")));
    assert.equal(await page.getByLabel("需求 1 Product BOM", { exact: true }).inputValue(), String(fixture.bomVersionId));
    const generateV1 = page.getByRole("button", { name: "生成交接包 v1", exact: true });
    assert.equal(await generateV1.isDisabled(), true);
    await unitSelector.selectOption(String(fixture.pcsUnitId));
    assert.equal(await unitSelector.inputValue(), String(fixture.pcsUnitId));
    assert.equal(await generateV1.isDisabled(), true, "an unsaved local Unit selection must not unlock package generation");
    await page.getByRole("button", { name: "保存单位确认", exact: true }).click();
    await page.getByText(/件 · PCS · Unit Resolution v1（Head v1） · 来源：工程确认/).waitFor();

    const authenticatedSession = await context.request.get(`${browserOrigin}/api/session`);
    assert.equal(authenticatedSession.status(), 200);
    const sessionBody = await authenticatedSession.json();
    assert.equal(sessionBody.authenticated, true);
    const wrongOrigin = await context.request.post(`${browserOrigin}/api/projects/${fixture.projectId}/requirement-unit-resolutions`, {
      headers: {
        Origin: "https://unknown-origin.invalid",
        "X-CSRF-Token": sessionBody.csrf_token,
        "Idempotency-Key": randomUUID(),
      },
      data: { requirement_item_id: fixture.requirementItemId, unit_id: fixture.setUnitId, expected_head_version: 1 },
    });
    assert.equal(wrongOrigin.status(), 403);
    assert.equal((await wrongOrigin.json()).code, "CSRF_INVALID");
    assert.equal(Number((await pool.query("select count(*) count from project_requirement_unit_resolution_versions where requirement_item_id=$1", [fixture.requirementItemId])).rows[0].count), 1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: `${fixture.projectCode} · 计划交接`, exact: true }).waitFor();
    await page.getByText(/件 · PCS · Unit Resolution v1（Head v1） · 来源：工程确认/).waitFor();
    assert.equal(await page.getByLabel("需求 1 单位", { exact: true }).inputValue(), String(fixture.pcsUnitId));
    assert.equal(await page.getByRole("button", { name: "生成交接包 v1", exact: true }).isDisabled(), false);
    await page.getByRole("button", { name: "生成交接包 v1", exact: true }).click();
    await page.getByText("不可变交接包已生成", { exact: true }).waitFor();
    const packageV1 = page.locator("button.planning-row").filter({ hasText: "交接包 v1" }).first();
    await packageV1.waitFor();
    await packageV1.click();
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v1`, exact: true }).waitFor();
    await page.getByRole("button", { name: "提交计划部", exact: true }).click();
    await page.getByText("交接包已提交计划部", { exact: true }).waitFor();

    await logout(page);
    await login(page, fixture.credentials.planning);
    await openPlanningWorkspace(page);
    const pendingV1 = page.locator("button.planning-row").filter({ hasText: fixture.projectCode }).filter({ hasText: /\/v1/ }).first();
    await pendingV1.waitFor();
    await pendingV1.click();
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v1`, exact: true }).waitFor();
    const trace = await pool.query(`select pp.id,pp.package_digest,a.request_id::text create_request,e.request_id::text submit_request
      from project_planning_packages pp
      join audit_log a on a.route_code='PLANNING_HANDOFF' and a.action='PLANNING_PACKAGE_PREPARED' and a.result='success' and a.detail @> jsonb_build_object('object_id',pp.id)
      join project_planning_handoff_events e on e.package_id=pp.id and e.event_type='SUBMITTED'
      where pp.project_id=$1 and pp.package_version_no=1`, [fixture.projectId]);
    assert.equal(trace.rowCount, 1);
    await page.getByText("Package 稳定 ID", { exact: true }).waitFor();
    await page.getByText(String(trace.rows[0].id), { exact: true }).first().waitFor();
    await page.locator("code.planning-trace-value", { hasText: trace.rows[0].package_digest }).waitFor();
    await page.locator("code.planning-trace-value", { hasText: trace.rows[0].create_request }).waitFor();
    await page.locator("code.planning-trace-value", { hasText: trace.rows[0].submit_request }).waitFor();
    assert.equal(await page.getByText("创建交接包", { exact: true }).count(), 1);
    assert.equal(await page.getByText("提交计划部", { exact: true }).count(), 1);
    assert.equal(await page.locator(".planning-event dd").filter({ hasText: /Asia\/Shanghai/ }).count(), 2);
    await page.getByText("计划部待接收队列", { exact: true }).waitFor();
    await page.getByText("未指定具体接收人", { exact: true }).waitFor();
    await page.getByText("未配置处理时限", { exact: true }).waitFor();
    await page.getByText("Product 稳定 ID", { exact: true }).waitFor();
    await page.getByText("BOM Version 稳定 ID", { exact: true }).waitFor();
    await page.getByText(/非生成时状态快照/).waitFor();
    await page.getByText("销售原始单位", { exact: true }).waitFor();
    await page.getByText("工程正式解析", { exact: true }).waitFor();
    await page.getByText("Unit Resolution ID", { exact: true }).waitFor();
    await page.getByText(/固定引用的 Unit Resolution v1/).waitFor();
    assert.equal(await page.locator(".planning-material-table").isVisible(), false);
    assert.equal(await page.locator(".planning-material-card").count(), 4);
    for (const materialId of fixture.materialIds) await page.locator(".planning-material-card").getByText(new RegExp(`Material ID ${materialId}$`)).waitFor();
    assert.equal(await page.locator(".planning-material-card").getByText("1 PCS", { exact: true }).count(), 4);
    assert.equal(await page.locator(".planning-material-card").getByText("10 PCS", { exact: true }).count(), 4);
    await page.getByText(/接收交接包：/).waitFor();
    await page.getByText(/退回工程\/项目部修订：/).waitFor();
    const returnReason = page.getByLabel("退回原因（必填）", { exact: true });
    const returnButton = page.getByRole("button", { name: "退回工程/项目部修订", exact: true });
    await returnReason.waitFor(); await returnButton.waitFor();
    await assertNoPageOverflow(page, "planning package v1 traceability detail");
    const materialWidths = await page.locator(".planning-material-cards").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(materialWidths.scroll <= materialWidths.client + 1, "mobile material cards must not require horizontal scrolling");
    for (const locator of [returnReason, returnButton, page.getByText("计划部待接收队列", { exact: true })]) {
      const box = await locator.boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= 391, "critical review controls must fit the 390px viewport");
    }
    const browserReturnInput = "浏览器验收：请将工程需求单位修订为套后重新提交";
    const browserReturnReason = browserReturnInput.normalize("NFKC");
    assert.notEqual(browserReturnInput, browserReturnReason); assert.equal(browserReturnInput.normalize("NFKC"), browserReturnReason);
    await returnReason.fill(browserReturnInput);
    await returnButton.click();
    const returnDialog = page.getByRole("dialog", { name: "确认退回工程/项目部修订", exact: true });
    await returnDialog.waitFor();
    await returnDialog.getByText(browserReturnInput, { exact: true }).waitFor();
    await assertNoPageOverflow(page, "planning return confirmation dialog");
    const stateBeforeConfirm = await pool.query(`select pp.status,
      (select count(*)::integer from project_planning_handoff_events where package_id=pp.id and event_type='RETURNED') return_count
      from project_planning_packages pp where pp.project_id=$1 and pp.package_version_no=1`, [fixture.projectId]);
    assert.deepEqual(stateBeforeConfirm.rows[0], { status: "SUBMITTED", return_count: 0 });
    await returnDialog.getByRole("button", { name: "确认退回", exact: true }).click();
    await page.getByText("已退回工程/项目部修订；旧包保持不可变", { exact: true }).waitFor();
    const returnReceipt = page.locator(".planning-receipt");
    await returnReceipt.getByRole("heading", { name: "操作完成凭证", exact: true }).waitFor();
    await returnReceipt.getByText("退回工程/项目部修订", { exact: true }).waitFor();
    await returnReceipt.getByText("成功", { exact: true }).waitFor();
    await returnReceipt.getByText(browserReturnReason, { exact: true }).waitFor();
    const returnDecision = await pool.query(`select pp.status,pp.returned_by,pp.returned_at,pp.return_reason,e.request_id::text,e.created_at
      from project_planning_packages pp join project_planning_handoff_events e on e.package_id=pp.id and e.event_type='RETURNED'
      where pp.project_id=$1 and pp.package_version_no=1`, [fixture.projectId]);
    assert.equal(returnDecision.rowCount, 1);
    assert.equal(returnDecision.rows[0].status, "RETURNED"); assert.equal(returnDecision.rows[0].returned_by, fixture.credentials.planning.username); assert.equal(returnDecision.rows[0].return_reason, browserReturnReason);
    await returnReceipt.getByText(fixture.credentials.planning.username, { exact: true }).waitFor();
    await returnReceipt.locator("code.planning-trace-value", { hasText: returnDecision.rows[0].request_id }).waitFor();
    assert.equal(await returnReceipt.getByText(/Asia\/Shanghai/).count(), 1);
    await assertNoPageOverflow(page, "planning return completion receipt");
    await returnReceipt.getByRole("button", { name: "查看已处理详情", exact: true }).click();
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v1`, exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: /已处理/ }).getAttribute("aria-selected"), "true");
    await page.locator(".planning-return p", { hasText: browserReturnReason }).waitFor();
    assert.deepEqual(await page.locator("code.planning-event-code").allTextContents(), ["CREATE", "SUBMIT", "RETURN"]);
    assert.equal(await page.locator(".planning-event dd").filter({ hasText: /Asia\/Shanghai/ }).count(), 3);
    const returnEvent = page.locator(".planning-event").last();
    await returnEvent.getByText(fixture.credentials.planning.username, { exact: true }).waitFor();
    await returnEvent.getByText("成功", { exact: true }).first().waitFor();
    await returnEvent.locator("code.planning-trace-value", { hasText: returnDecision.rows[0].request_id }).waitFor();
    const returnReasonParagraph = returnEvent.locator("p", { hasText: browserReturnReason });
    await returnReasonParagraph.waitFor(); assert.equal((await returnReasonParagraph.innerText()).trim(), `原因：${browserReturnReason}`);
    await page.getByText("工程/项目部修订队列", { exact: true }).waitFor();
    await page.getByText("未指定具体接收人", { exact: true }).waitFor();
    await page.getByText("未配置处理时限", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "接收交接包", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "退回工程/项目部修订", exact: true }).count(), 0);
    await assertNoPageOverflow(page, "processed returned package history detail");

    if (traceabilityReturnOnly) {
      const protectedState = await pool.query(`select pp.status,pp.package_version_no,
        (select count(*)::integer from project_planning_packages where project_id=$1) package_count,
        (select count(*)::integer from project_planning_packages where project_id=$1 and package_version_no=2) v2_count,
        (select count(*)::integer from project_planning_handoff_events where package_id=pp.id and event_type='RETURNED') return_count,
        (select count(*)::integer from project_planning_handoff_events where package_id=pp.id and event_type='ACCEPTED') accept_count
        from project_planning_packages pp where pp.project_id=$1 and pp.package_version_no=1`, [fixture.projectId]);
      assert.deepEqual(protectedState.rows[0], { status: "RETURNED", package_version_no: 1, package_count: 1, v2_count: 0, return_count: 1, accept_count: 0 });
      const source = await pool.query("select unit_id,unit_pending from project_requirement_items where id=$1", [fixture.requirementItemId]);
      assert.deepEqual(source.rows[0], { unit_id: null, unit_pending: true });
      await logout(page);
      const anonymousSession = await context.request.get(`${browserOrigin}/api/session`);
      assert.equal(anonymousSession.status(), 200); assert.equal((await anonymousSession.json()).authenticated, false);
      const protectedAfterLogout = await context.request.get(`${browserOrigin}/api/planning-handoffs?status=SUBMITTED&page_size=100`);
      assert.equal(protectedAfterLogout.status(), 401);
      const protectedHistoryAfterLogout = await context.request.get(`${browserOrigin}/api/planning-handoffs?status=PROCESSED&page_size=100`);
      assert.equal(protectedHistoryAfterLogout.status(), 401);
      await context.close();
      return;
    }

    await logout(page);
    await login(page, fixture.credentials.engineering);
    await openEngineeringWorkspace(page, fixture);
    const revisionSelector = page.getByLabel("需求 1 单位", { exact: true });
    assert.equal(await revisionSelector.inputValue(), String(fixture.pcsUnitId));
    await revisionSelector.selectOption(String(fixture.setUnitId));
    assert.equal(await page.getByRole("button", { name: "生成交接包 v2", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "保存单位确认", exact: true }).click();
    await page.getByText(/套 · SET · Unit Resolution v2（Head v2） · 来源：工程确认/).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/套 · SET · Unit Resolution v2（Head v2） · 来源：工程确认/).waitFor();
    assert.equal(await page.getByLabel("需求 1 单位", { exact: true }).inputValue(), String(fixture.setUnitId));
    const generateV2 = page.getByRole("button", { name: "生成交接包 v2", exact: true });
    assert.equal(await generateV2.isDisabled(), false);
    await generateV2.click();
    await page.getByText("不可变交接包已生成", { exact: true }).waitFor();
    const packageV2 = page.locator("button.planning-row").filter({ hasText: "交接包 v2" }).first();
    await packageV2.waitFor();
    await packageV2.click();
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v2`, exact: true }).waitFor();
    await page.getByRole("button", { name: "重新提交计划部", exact: true }).click();
    await page.getByText("修订包已重新提交", { exact: true }).waitFor();

    await logout(page);
    await login(page, fixture.credentials.planning);
    await openPlanningWorkspace(page);
    const pendingV2 = page.locator("button.planning-row").filter({ hasText: fixture.projectCode }).filter({ hasText: /\/v2/ }).first();
    await pendingV2.waitFor();
    await pendingV2.click();
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v2`, exact: true }).waitFor();
    await page.getByText("需求 10 SET", { exact: true }).waitFor();
    const bomRows = page.locator(".planning-lines tbody tr");
    assert.equal(await bomRows.count(), 4);
    for (let index = 0; index < 4; index += 1) {
      assert.equal((await bomRows.nth(index).locator("td").last().innerText()).trim(), "10 PCS");
    }
    await assertNoPageOverflow(page, "planning package v2 detail");
    await page.getByRole("button", { name: "接收交接包", exact: true }).click();
    const acceptDialog = page.getByRole("dialog", { name: "确认接收交接包", exact: true });
    await acceptDialog.waitFor();
    const acceptedBeforeConfirm = await pool.query("select status,(select count(*)::integer from project_planning_handoff_events where package_id=pp.id and event_type='ACCEPTED') accept_count from project_planning_packages pp where project_id=$1 and package_version_no=2", [fixture.projectId]);
    assert.deepEqual(acceptedBeforeConfirm.rows[0], { status: "SUBMITTED", accept_count: 0 });
    await acceptDialog.getByRole("button", { name: "确认接收", exact: true }).click();
    await page.getByText("计划交接包已接收；未自动启动物料需求", { exact: true }).waitFor();
    const acceptReceipt = page.locator(".planning-receipt");
    await acceptReceipt.getByRole("heading", { name: "操作完成凭证", exact: true }).waitFor();
    await acceptReceipt.getByText("接收交接包", { exact: true }).waitFor();
    await acceptReceipt.getByText("成功", { exact: true }).waitFor();
    await acceptReceipt.getByRole("button", { name: "查看已处理详情", exact: true }).click();
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v2`, exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: /已处理/ }).getAttribute("aria-selected"), "true");

    const source = await pool.query("select unit_id,unit_pending from project_requirement_items where id=$1", [fixture.requirementItemId]);
    assert.deepEqual(source.rows[0], { unit_id: null, unit_pending: true });
    const versions = await pool.query("select id,resolution_version_no,unit_id,source_type,supersedes_resolution_id from project_requirement_unit_resolution_versions where requirement_item_id=$1 order by resolution_version_no", [fixture.requirementItemId]);
    assert.equal(versions.rowCount, 2);
    assert.deepEqual(versions.rows.map((row) => [row.resolution_version_no, Number(row.unit_id), row.source_type]), [[1, fixture.pcsUnitId, "ENGINEERING_CONFIRMED"], [2, fixture.setUnitId, "ENGINEERING_CONFIRMED"]]);
    assert.equal(Number(versions.rows[1].supersedes_resolution_id), Number(versions.rows[0].id));
    const head = await pool.query("select current_resolution_id,version from project_requirement_unit_resolution_heads where requirement_item_id=$1", [fixture.requirementItemId]);
    assert.deepEqual({ currentResolutionId: Number(head.rows[0].current_resolution_id), version: head.rows[0].version }, { currentResolutionId: Number(versions.rows[1].id), version: 2 });
    const provenance = await pool.query(`select pp.package_version_no,pp.status,pi.unit_id,pi.unit_resolution_id,ur.resolution_version_no
      from project_planning_packages pp
      join project_planning_package_items pi on pi.package_id=pp.id
      join project_requirement_unit_resolution_versions ur on ur.id=pi.unit_resolution_id
      where pp.project_id=$1 order by pp.package_version_no`, [fixture.projectId]);
    assert.deepEqual(provenance.rows.map((row) => [row.package_version_no, row.status, Number(row.unit_id), Number(row.unit_resolution_id), row.resolution_version_no]), [
      [1, "RETURNED", fixture.pcsUnitId, Number(versions.rows[0].id), 1],
      [2, "ACCEPTED", fixture.setUnitId, Number(versions.rows[1].id), 2],
    ]);
    const gross = await pool.query(`select bl.calculated_gross_quantity::text,u.code unit_code
      from project_planning_packages pp
      join project_planning_package_items pi on pi.package_id=pp.id
      join project_planning_package_bom_lines bl on bl.package_item_id=pi.id
      join units u on u.id=bl.unit_id
      where pp.project_id=$1 and pp.package_version_no=2 order by bl.line_no`, [fixture.projectId]);
    assert.deepEqual(gross.rows, Array.from({ length: 4 }, () => ({ calculated_gross_quantity: "10.000000", unit_code: "PCS" })));
    const immutableSources = await pool.query(`select p.status product_status,pv.status product_version_status,bv.status bom_version_status,
      (select count(*)::integer from material_master where id=any($4::bigint[]) and material_status='ACTIVE' and base_uom='PCS') active_pcs_materials,
      (select count(*)::integer from bom_lines where bom_version_id=$3 and quantity_per=1 and unit_id=$5) bom_pcs_lines,
      (select count(*)::integer from project_requirement_resolutions where id=$6) product_bom_resolutions
      from products p join product_versions pv on pv.product_id=p.id join bom_versions bv on bv.product_version_id=pv.id
      where p.id=$1 and pv.id=$2 and bv.id=$3`, [fixture.productId, fixture.productVersionId, fixture.bomVersionId, fixture.materialIds, fixture.pcsUnitId, fixture.productBomResolutionId]);
    assert.deepEqual(immutableSources.rows[0], { product_status: "ACTIVE", product_version_status: "RELEASED", bom_version_status: "RELEASED", active_pcs_materials: 4, bom_pcs_lines: 4, product_bom_resolutions: 1 });
    const events = await pool.query("select event_type from project_planning_handoff_events where project_id=$1 order by id", [fixture.projectId]);
    assert.deepEqual(events.rows.map((row) => row.event_type), ["SUBMITTED", "RETURNED", "RESUBMITTED", "ACCEPTED"]);
    assert.equal(Number((await pool.query("select count(*) count from project_planning_packages where status='SUBMITTED'")).rows[0].count), 0);

    await logout(page);
    const anonymousSession = await context.request.get(`${browserOrigin}/api/session`);
    assert.equal(anonymousSession.status(), 200);
    assert.equal((await anonymousSession.json()).authenticated, false);
    const protectedAfterLogout = await context.request.get(`${browserOrigin}/api/planning-handoffs?status=SUBMITTED&page_size=100`);
    assert.equal(protectedAfterLogout.status(), 401);
    const protectedHistoryAfterLogout = await context.request.get(`${browserOrigin}/api/planning-handoffs?status=PROCESSED&page_size=100`);
    assert.equal(protectedHistoryAfterLogout.status(), 401);
    assert.equal(Number((await pool.query("select count(*) count from app_sessions where revoked_at is null and expires_at>now()")).rows[0].count), 0);

    await context.close();
  } finally {
    await browser?.close().catch(() => undefined);
    await clearSyntheticData();
  }
});

test.after(async () => {
  await pool.end();
});
