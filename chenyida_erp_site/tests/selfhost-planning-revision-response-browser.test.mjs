import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const REQUIRED_DATABASE = "cyd_planning_revision_browser_test_0037";
const REQUIRED_BROWSER_ORIGIN = "http://127.0.0.1:43137";
const databaseUrl = process.env.DATABASE_URL || "";
const browserBaseUrl = process.env.ERP_BROWSER_BASE_URL || "";
const acceptanceConfirm = process.env.ERP_PLANNING_REVISION_BROWSER_CONFIRM || "";
const expectedResponse = "已按计划部退回要求补充：本批计划数量10 PCS，按BOM V1四项物料整批齐套。Product A0、BOM V1、Unit Resolution v1及四项物料数量保持不变。";

function databaseName(value) {
  try { return decodeURIComponent(new URL(value).pathname.replace(/^\//, "")); } catch { return ""; }
}
if (databaseName(databaseUrl) !== REQUIRED_DATABASE) throw new Error(`DATABASE_URL must target isolated ${REQUIRED_DATABASE}`);
if (acceptanceConfirm !== "ISOLATED_0037_SYNTHETIC_ONLY") throw new Error("ERP_PLANNING_REVISION_BROWSER_CONFIRM=ISOLATED_0037_SYNTHETIC_ONLY is required");
let browserOrigin;
try {
  const parsed = new URL(browserBaseUrl);
  if (parsed.origin !== REQUIRED_BROWSER_ORIGIN || parsed.href !== `${REQUIRED_BROWSER_ORIGIN}/`) throw new Error();
  browserOrigin = parsed.origin;
} catch { throw new Error(`ERP_BROWSER_BASE_URL must be exactly ${REQUIRED_BROWSER_ORIGIN}`); }

const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "planning-revision-browser-0037" });
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try { const loaded = await import(specifier); if (loaded.chromium) return loaded.chromium; } catch { /* try the next isolated runner module */ }
  }
  throw new Error("Playwright is required in the isolated browser-test runner");
}

async function assertIsolatedSchema() {
  assert.equal((await pool.query("select current_database() name")).rows[0].name, REQUIRED_DATABASE);
  assert.deepEqual((await pool.query("select count(*)::integer count,max(version) latest from schema_migrations")).rows[0], { count: 37, latest: "0037_project_planning_revision_response_lineage.sql" });
  assert.deepEqual((await pool.query("select to_regclass('project_planning_revision_response_versions') versions,to_regclass('project_planning_revision_response_heads') heads")).rows[0], { versions: "project_planning_revision_response_versions", heads: "project_planning_revision_response_heads" });
}

async function clearSyntheticData() {
  const tables = await pool.query("select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','app_meta') order by tablename");
  const quoted = tables.rows.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`);
  if (quoted.length) await pool.query(`truncate table ${quoted.join(",")} restart identity cascade`);
}

async function seedFixture() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const credentials = {
    engineering: { username: `revision_eng_${suffix}`, password: `Isolated!E9-${randomUUID()}` },
    planning: { username: `revision_plan_${suffix}`, password: `Isolated!P9-${randomUUID()}` },
  };
  const salesUsername = `revision_sales_${suffix}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true)");
    await client.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
      ($1,'隔离浏览器工程','engineering',$2,true,false,1),($3,'隔离浏览器计划','planning',$4,true,false,1),($5,'隔离浏览器销售','sales',$6,true,false,1)`, [credentials.engineering.username, await hashPassword(credentials.engineering.password), credentials.planning.username, await hashPassword(credentials.planning.password), salesUsername, await hashPassword(`Isolated!S9-${randomUUID()}`)]);
    const customer = (await client.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-REVISION-0037','0037 修订客户','0037 修订客户','ACTIVE',$1,$1,$2) returning id", [salesUsername, randomUUID()])).rows[0];
    const unit = (await client.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id")).rows[0];
    const category = (await client.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('REVISION-0037','0037 修订零件',1,'ACTIVE',$1,$1,$2) returning id", [credentials.engineering.username, randomUUID()])).rows[0];
    const materialIds = [];
    for (let index = 1; index <= 4; index += 1) {
      const material = await client.query("insert into material_master(internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,approved_by,approved_at,created_by,updated_by,request_id) values($1,$2,$3,'REVISION','REVISION',$4,'PCS',$5,'ACTIVE','PURCHASED','STOCK','IQC','RoHS','MANUAL',$6,$6,now(),$6,$6,$7) returning id", [`MAT-REVISION-0037-${index}`, `0037 修订零件 ${index}`, category.id, `REV-${index}`, unit.id, credentials.engineering.username, randomUUID()]);
      materialIds.push(Number(material.rows[0].id));
    }
    const product = (await client.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values('PROD-REVISION-0037','0037 修订产品',$1,'ACTIVE',$2,$2,$3) returning id", [customer.id, credentials.engineering.username, randomUUID()])).rows[0];
    const productVersion = (await client.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,engineering_owner,released_by,released_at,created_by,updated_by,request_id) values($1,1,'A0','RELEASED','ASSEMBLY','ACTIVE',$2,$2,now(),$2,$2,$3) returning id", [product.id, credentials.engineering.username, randomUUID()])).rows[0];
    const bomHeader = (await client.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values('BOM-REVISION-0037',$1,'ACTIVE',$2,$2,$3) returning id", [product.id, credentials.engineering.username, randomUUID()])).rows[0];
    const bomVersion = (await client.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,released_by,released_at,created_by,updated_by,request_id) values($1,$2,1,'V1','DRAFT','',null,$3,$3,$4) returning id", [bomHeader.id, productVersion.id, credentials.engineering.username, randomUUID()])).rows[0];
    for (let index = 0; index < materialIds.length; index += 1) await client.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,created_by,updated_by,request_id) values($1,$2,$3,1,$4,0,'ASSEMBLY',$5,$5,$6)", [bomVersion.id, (index + 1) * 10, materialIds[index], unit.id, credentials.engineering.username, randomUUID()]);
    await client.query("update bom_versions set status='RELEASED',released_by=$2,released_at=now() where id=$1", [bomVersion.id, credentials.engineering.username]);
    const project = (await client.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values('PRJ-99000037',$1,'0037 修订浏览器项目','隔离验证 Planning 修订回复谱系',$2,$3,'ACCEPTED','2026-12-31',1,4,$4,$2) returning id", [customer.id, salesUsername, credentials.engineering.username, randomUUID()])).rows[0];
    const requirement = (await client.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,technical_requirements,content_digest,created_by) values($1,1,'10 PCS 修订谱系需求',10,'PCS','固定 A0 / V1 / Unit Resolution v1',$2,$3) returning id", [project.id, sha256(`revision-requirement-${suffix}`), salesUsername])).rows[0];
    const item = (await client.query("insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending,specification_requirement) values($1,1,'0037 修订成品',10,null,true,'固定四项物料') returning id", [requirement.id])).rows[0];
    await client.query("insert into project_requirement_resolutions(project_id,requirement_version_id,requirement_item_id,product_id,product_version_id,bom_header_id,bom_version_id,resolved_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)", [project.id, requirement.id, item.id, product.id, productVersion.id, bomHeader.id, bomVersion.id, credentials.engineering.username, randomUUID()]);
    const resolution = (await client.query("insert into project_requirement_unit_resolution_versions(project_id,requirement_version_id,requirement_item_id,resolution_version_no,unit_id,source_type,resolved_by,request_id,content_digest) values($1,$2,$3,1,$4,'ENGINEERING_CONFIRMED',$5,$6,$7) returning id", [project.id, requirement.id, item.id, unit.id, credentials.engineering.username, randomUUID(), sha256(`unit-${suffix}`)])).rows[0];
    await client.query("insert into project_requirement_unit_resolution_heads(requirement_item_id,project_id,requirement_version_id,current_resolution_id,version) values($1,$2,$3,$4,1)", [item.id, project.id, requirement.id, resolution.id]);
    await client.query("commit");
    return { credentials, projectId: Number(project.id), projectCode: "PRJ-99000037", productVersionId: Number(productVersion.id), bomVersionId: Number(bomVersion.id), unitResolutionId: Number(resolution.id), materialIds };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function login(page, credentials) {
  await page.goto(`${browserOrigin}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  const response = page.waitForResponse((item) => item.url() === `${browserOrigin}/api/login` && item.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click(); assert.equal((await response).status(), 200);
  await page.getByRole("heading", { name: "经营工作台", exact: true }).waitFor();
}

async function logout(page) {
  await page.goto(`${browserOrigin}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
}

async function noOverflow(page, stage) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(width.document <= width.viewport + 1, `${stage}: document overflow`); assert.ok(width.body <= width.viewport + 1, `${stage}: body overflow`);
}

test("isolated Chromium completes v1 RETURN response fixed v2 lineage and Planning acceptance", { timeout: 240_000 }, async () => {
  await assertIsolatedSchema(); await clearSyntheticData(); const fixture = await seedFixture(); const chromium = await loadChromium(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ["--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const allowedPosts = [/^\/api\/login$/, /^\/api\/logout$/, /^\/api\/projects\/\d+\/planning-packages$/, /^\/api\/planning-packages\/\d+\/(?:submit|return|accept|revision-responses|successor)$/];
    await context.route("**/*", async (route) => {
      const request = route.request(); const url = new URL(request.url()); const method = request.method().toUpperCase();
      if (url.origin === browserOrigin && (["GET", "HEAD", "OPTIONS"].includes(method) || (method === "POST" && allowedPosts.some((pattern) => pattern.test(url.pathname))))) await route.continue(); else await route.abort("blockedbyclient");
    });
    const page = await context.newPage(); assert.deepEqual(page.viewportSize(), { width: 390, height: 844 });

    await login(page, fixture.credentials.engineering);
    await page.goto(`${browserOrigin}/engineering/projects/${fixture.projectId}/planning`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: `${fixture.projectCode} · 计划交接`, exact: true }).waitFor();
    await page.getByRole("button", { name: "生成交接包 v1", exact: true }).click(); await page.getByText("不可变交接包已生成", { exact: true }).waitFor();
    await page.locator("button.planning-row", { hasText: "交接包 v1" }).click();
    await page.getByRole("button", { name: "提交计划部", exact: true }).click(); await page.getByText("交接包已提交计划部", { exact: true }).waitFor();
    const source = await pool.query("select id,package_digest,version from project_planning_packages where project_id=$1 and package_version_no=1", [fixture.projectId]); const v1Id = Number(source.rows[0].id);

    await logout(page); await login(page, fixture.credentials.planning);
    await page.goto(`${browserOrigin}/planning/handoffs`, { waitUntil: "domcontentloaded" });
    await page.locator("button.planning-row", { hasText: `${fixture.projectCode} · Package ID ${v1Id}/v1` }).click();
    const returnReason = "隔离浏览器退回:请补充本批计划数量10 PCS,按BOM V1四项物料整批齐套。";
    await page.getByLabel("退回原因（必填）", { exact: true }).fill(returnReason);
    await page.getByRole("button", { name: "退回工程/项目部修订", exact: true }).click();
    await page.getByRole("dialog", { name: "确认退回工程/项目部修订", exact: true }).getByRole("button", { name: "确认退回", exact: true }).click();
    await page.getByText("已退回工程/项目部修订；旧包保持不可变", { exact: true }).waitFor();

    await logout(page); await login(page, fixture.credentials.engineering);
    await page.goto(`${browserOrigin}/engineering/projects/${fixture.projectId}/planning?package=${v1Id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v1`, exact: true }).waitFor();
    await page.getByText(returnReason, { exact: true }).first().waitFor();
    assert.equal(await page.locator("select").count(), 0, "reply-only mode must not expose Product/BOM or Unit selectors");
    const reply = page.getByLabel("回复正文（必填，10—2000 字符）", { exact: true }); const generateV2 = page.getByRole("button", { name: "生成 v2", exact: true });
    assert.equal(await generateV2.isDisabled(), true); await reply.fill(expectedResponse); await page.getByRole("button", { name: "保存回复草稿", exact: true }).click();
    await page.getByText("工程修订回复草稿已保存并形成新的不可变 Version", { exact: true }).waitFor(); await noOverflow(page, "saved response");
    const responseRow = await pool.query("select id,response_version_no,response_text,response_text_digest,request_id::text from project_planning_revision_response_versions where source_package_id=$1", [v1Id]);
    assert.equal(responseRow.rowCount, 1); assert.equal(responseRow.rows[0].response_text, expectedResponse); assert.equal(responseRow.rows[0].response_version_no, 1);

    await page.reload({ waitUntil: "domcontentloaded" }); await page.getByText(expectedResponse, { exact: true }).first().waitFor();
    const reloadedReply = page.locator(".planning-revision-editor textarea"); const reloadedGenerateV2 = page.getByRole("button", { name: "生成 v2", exact: true });
    assert.equal(await reloadedReply.count(), 1);
    assert.equal(await reloadedReply.inputValue(), expectedResponse); assert.equal(await reloadedGenerateV2.isDisabled(), false);
    await reloadedGenerateV2.click(); const successorDialog = page.getByRole("dialog", { name: "确认生成 v2", exact: true }); await successorDialog.waitFor();
    await successorDialog.getByText(expectedResponse, { exact: true }).waitFor(); await successorDialog.getByText(/Product A0 · BOM V1 · Unit Resolution v1/).waitFor(); await noOverflow(page, "successor confirmation");
    const successorResponsePromise = page.waitForResponse((response) => response.url() === `${browserOrigin}/api/planning-packages/${v1Id}/successor` && response.request().method() === "POST");
    await successorDialog.getByRole("button", { name: "确认生成 v2", exact: true }).click();
    const successorResponse = await successorResponsePromise; assert.equal(successorResponse.status(), 201);
    const v2 = await pool.query("select id,previous_package_id,responds_to_return_event_id,revision_response_version_id,package_digest from project_planning_packages where project_id=$1 and package_version_no=2", [fixture.projectId]); const v2Id = Number(v2.rows[0].id);
    await page.waitForURL((url) => url.searchParams.get("package") === String(v2Id));
    await page.getByRole("heading", { name: `${fixture.projectCode} · 交接包 v2`, exact: true }).waitFor();
    await page.getByRole("heading", { name: "v1 → Planning RETURN → Engineering Response → v2", exact: true }).waitFor();
    await page.getByRole("button", { name: "重新提交计划部", exact: true }).click(); await page.getByText("修订包已重新提交", { exact: true }).waitFor();
    await logout(page); await login(page, fixture.credentials.planning);
    await page.goto(`${browserOrigin}/planning/handoffs`, { waitUntil: "domcontentloaded" });
    await page.locator("button.planning-row", { hasText: `${fixture.projectCode} · Package ID ${v2Id}/v2` }).click();
    await page.getByRole("heading", { name: "v1 → Planning RETURN → Engineering Response → v2", exact: true }).waitFor(); await page.getByText(expectedResponse, { exact: true }).waitFor();
    await page.getByText("Product", { exact: true }).first().waitFor(); await page.getByText("A0", { exact: true }).waitFor(); await page.getByText("V1", { exact: true }).waitFor(); await page.getByText(/固定引用的 Unit Resolution v1/).waitFor();
    assert.equal(await page.locator(".planning-material-card").count(), 4); assert.equal(await page.locator(".planning-material-card").getByText("10 PCS", { exact: true }).count(), 4); await noOverflow(page, "planning v2 lineage");
    await page.getByRole("button", { name: "接收交接包", exact: true }).click(); await page.getByRole("dialog", { name: "确认接收交接包", exact: true }).getByRole("button", { name: "确认接收", exact: true }).click();
    await page.getByText("计划交接包已接收；未自动启动物料需求", { exact: true }).waitFor();

    const packages = await pool.query("select id,package_version_no,status,package_digest,previous_package_id,responds_to_return_event_id,revision_response_version_id from project_planning_packages where project_id=$1 order by package_version_no", [fixture.projectId]);
    assert.deepEqual(packages.rows.map((row) => [row.package_version_no, row.status]), [[1, "RETURNED"], [2, "ACCEPTED"]]); assert.notEqual(packages.rows[0].package_digest, packages.rows[1].package_digest);
    assert.equal(Number(packages.rows[1].previous_package_id), v1Id); assert.equal(Number(packages.rows[1].revision_response_version_id), Number(responseRow.rows[0].id));
    const snapshots = await pool.query(`select pp.package_version_no,pi.product_version_id,pi.bom_version_id,pi.unit_resolution_id,bl.material_id,bl.calculated_gross_quantity::text,u.code unit_code
      from project_planning_packages pp join project_planning_package_items pi on pi.package_id=pp.id join project_planning_package_bom_lines bl on bl.package_item_id=pi.id join units u on u.id=bl.unit_id where pp.project_id=$1 order by pp.package_version_no,bl.line_no`, [fixture.projectId]);
    assert.equal(snapshots.rowCount, 8); assert.ok(snapshots.rows.every((row) => Number(row.product_version_id) === fixture.productVersionId && Number(row.bom_version_id) === fixture.bomVersionId && Number(row.unit_resolution_id) === fixture.unitResolutionId && row.calculated_gross_quantity === "10.000000" && row.unit_code === "PCS"));
    assert.deepEqual(snapshots.rows.filter((row) => row.package_version_no === 2).map((row) => Number(row.material_id)), fixture.materialIds);
    const events = await pool.query("select event_type from project_planning_handoff_events where project_id=$1 order by id", [fixture.projectId]); assert.deepEqual(events.rows.map((row) => row.event_type), ["CREATED", "SUBMITTED", "RETURNED", "CREATED", "RESUBMITTED", "ACCEPTED"]);

    await logout(page); assert.equal((await (await context.request.get(`${browserOrigin}/api/session`)).json()).authenticated, false); await context.close();
  } finally { await browser?.close().catch(() => undefined); await clearSyntheticData(); }
});

test.after(async () => { await pool.end(); });
