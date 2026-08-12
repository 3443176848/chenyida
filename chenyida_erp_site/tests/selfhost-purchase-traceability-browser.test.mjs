import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { MaterialRequirementRepository } from "../app/lib/material-requirement-selfhost/repository.ts";
import { MaterialRequirementService } from "../app/lib/material-requirement-selfhost/service.ts";

const REQUIRED_DATABASE = "erp_fix18_material_requirement_test";
const REQUIRED_ORIGIN = "http://127.0.0.1:43138";
const databaseUrl = process.env.DATABASE_URL || "";
const confirmation = process.env.ERP_PURCHASE_SUPPLY_BROWSER_CONFIRM || "";
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const databaseName = (value) => { try { return decodeURIComponent(new URL(value).pathname.replace(/^\//, "")); } catch { return ""; } };
if (databaseName(databaseUrl) !== REQUIRED_DATABASE) throw new Error(`DATABASE_URL must target isolated ${REQUIRED_DATABASE}`);
if (confirmation !== "ISOLATED_FIX18_SYNTHETIC_ONLY") throw new Error("ERP_PURCHASE_SUPPLY_BROWSER_CONFIRM=ISOLATED_FIX18_SYNTHETIC_ONLY is required");

const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "purchase-history-browser-fix18" });
let server;
const serverEntry = process.env.ERP_BROWSER_SERVER_ENTRY || "/app/dist/standalone/server.js";

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try { const loaded = await import(specifier); const chromium = loaded.chromium || loaded.default?.chromium; if (chromium) return chromium; } catch { /* use the next isolated module */ }
  }
  throw new Error("Playwright is required in the isolated browser-test runner");
}

async function clearSyntheticData() {
  const tables = await pool.query("select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','app_meta') order by tablename");
  const quoted = tables.rows.map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`);
  if (quoted.length) await pool.query(`truncate table ${quoted.join(",")} restart identity cascade`);
}

const actor = (role, username) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });
const meta = (identity, action) => ({ actor: identity, requestId: randomUUID(), operationId: randomUUID(), keyDigest: sha256(randomUUID()), requestDigest: sha256(randomUUID()), method: "POST", route: `/isolated/fix18/${action}`, action });

async function seedFixture() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const credentials = { username: `fix17_purchase_${suffix}`, password: `Isolated!Purchase9-${randomUUID()}` };
  const planningUsername = `fix17_planning_${suffix}`, engineeringUsername = `fix17_engineering_${suffix}`, salesUsername = `fix17_sales_${suffix}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true)");
    await client.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
      ($1,'隔离采购','purchase',$2,true,false,1),($3,'隔离计划','planning',$4,true,false,1),
      ($5,'隔离工程','engineering',$6,true,false,1),($7,'隔离销售','sales',$8,true,false,1)`, [credentials.username, await hashPassword(credentials.password), planningUsername, await hashPassword(`Isolated!Planning9-${randomUUID()}`), engineeringUsername, await hashPassword(`Isolated!Engineering9-${randomUUID()}`), salesUsername, await hashPassword(`Isolated!Sales9-${randomUUID()}`)]);
    const unit = (await client.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id")).rows[0];
    const category = (await client.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('FIX17-PART','采购追溯零件',1,'ACTIVE',$1,$1,$2) returning id", [engineeringUsername, randomUUID()])).rows[0];
    const materialIds = [];
    for (let index = 1; index <= 4; index += 1) {
      const material = await client.query("insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values($1,$2,$3,'PCS',$4,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',$5,$5,$5,$6) returning id", [`MAT-FIX17-${String(index).padStart(3, "0")}`, `采购追溯零件 ${index}`, category.id, unit.id, engineeringUsername, randomUUID()]);
      materialIds.push(Number(material.rows[0].id));
    }
    const customer = (await client.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-FIX17','采购追溯客户','采购追溯客户','ACTIVE',$1,$1,$2) returning id", [salesUsername, randomUUID()])).rows[0];
    const product = (await client.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values('PRD-FIX17','采购追溯产品',$1,'ACTIVE',$2,$2,$3) returning id", [customer.id, engineeringUsername, randomUUID()])).rows[0];
    const productVersion = (await client.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,engineering_owner,released_by,released_at,created_by,updated_by,request_id) values($1,1,'A0','RELEASED','ASSEMBLY','ACTIVE',$2,$2,now(),$2,$2,$3) returning id", [product.id, engineeringUsername, randomUUID()])).rows[0];
    const bomHeader = (await client.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values('BOM-FIX17',$1,'ACTIVE',$2,$2,$3) returning id", [product.id, engineeringUsername, randomUUID()])).rows[0];
    const bomVersion = (await client.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,created_by,updated_by,request_id) values($1,$2,1,'V1','DRAFT',$3,$3,$4) returning id", [bomHeader.id, productVersion.id, engineeringUsername, randomUUID()])).rows[0];
    const bomLineIds = [];
    for (let index = 0; index < materialIds.length; index += 1) {
      const line = await client.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,created_by,updated_by,request_id) values($1,$2,$3,1,$4,0,$5,$5,$6) returning id", [bomVersion.id, index + 1, materialIds[index], unit.id, engineeringUsername, randomUUID()]); bomLineIds.push(Number(line.rows[0].id));
    }
    await client.query("update bom_versions set status='RELEASED',released_by=$2,released_at=now() where id=$1", [bomVersion.id, engineeringUsername]);
    const project = (await client.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values('PRJ-99000015',$1,'采购追溯浏览器项目','隔离采购接收验证',$2,$3,'ACCEPTED','2026-10-30',1,4,$4,$2) returning id", [customer.id, salesUsername, engineeringUsername, randomUUID()])).rows[0];
    const requirement = (await client.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'10 PCS 采购追溯需求',10,'PCS',$2,$3) returning id", [project.id, sha256(`requirement-${suffix}`), salesUsername])).rows[0];
    const item = (await client.query("insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending) values($1,1,'采购追溯产品',10,$2,false) returning id", [requirement.id, unit.id])).rows[0];
    await client.query("insert into project_requirement_resolutions(project_id,requirement_version_id,requirement_item_id,product_id,product_version_id,bom_header_id,bom_version_id,resolved_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)", [project.id, requirement.id, item.id, product.id, productVersion.id, bomHeader.id, bomVersion.id, engineeringUsername, randomUUID()]);
    const unitResolution = (await client.query("insert into project_requirement_unit_resolution_versions(project_id,requirement_version_id,requirement_item_id,resolution_version_no,unit_id,source_type,resolved_by,request_id,content_digest) values($1,$2,$3,1,$4,'REQUIREMENT_DECLARED',$5,$6,$7) returning id", [project.id, requirement.id, item.id, unit.id, salesUsername, randomUUID(), sha256(`unit-${suffix}`)])).rows[0];
    await client.query("insert into project_requirement_unit_resolution_heads(requirement_item_id,project_id,requirement_version_id,current_resolution_id,version) values($1,$2,$3,$4,1)", [item.id, project.id, requirement.id, unitResolution.id]);
    const packageDigest = sha256(`package-${suffix}`);
    const packageRow = (await client.query("insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,version,request_id) values($1,1,$2,'DRAFT','2026-10-30',$3,$4,1,$5) returning id", [project.id, requirement.id, packageDigest, engineeringUsername, randomUUID()])).rows[0];
    await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values($1,$2,'CREATED',$3,$4)", [packageRow.id, project.id, engineeringUsername, randomUUID()]);
    const packageItem = (await client.query("insert into project_planning_package_items(package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,unit_resolution_id,line_no,source_digest) values($1,$2,$3,$4,10,$5,$6,1,$7) returning id", [packageRow.id, item.id, productVersion.id, bomVersion.id, unit.id, unitResolution.id, sha256(`item-${suffix}`)])).rows[0];
    for (let index = 0; index < materialIds.length; index += 1) {
      const snapshot = { internal_material_code: `MAT-FIX17-${String(index + 1).padStart(3, "0")}`, standard_name: `采购追溯零件 ${index + 1}`, category_code: "FIX17-PART", base_uom: "PCS" };
      await client.query("insert into project_planning_package_bom_lines(package_item_id,source_bom_line_id,material_id,unit_id,quantity_per,loss_rate,calculated_gross_quantity,specification_snapshot,material_digest,line_no) values($1,$2,$3,$4,1,0,10,$5,$6,$7)", [packageItem.id, bomLineIds[index], materialIds[index], unit.id, snapshot, sha256(JSON.stringify(snapshot)), index + 1]);
    }
    await client.query("update project_planning_packages set status='SUBMITTED',submitted_by=$2,submitted_at=now(),version=2,request_id=$3,updated_at=now() where id=$1", [packageRow.id, engineeringUsername, randomUUID()]);
    await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values($1,$2,'SUBMITTED',$3,$4)", [packageRow.id, project.id, engineeringUsername, randomUUID()]);
    await client.query("update project_planning_packages set status='ACCEPTED',accepted_by=$2,accepted_at=now(),version=3,request_id=$3,updated_at=now() where id=$1", [packageRow.id, planningUsername, randomUUID()]);
    const packageAcceptRequestId = randomUUID();
    await client.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values($1,$2,'ACCEPTED',$3,$4)", [packageRow.id, project.id, planningUsername, packageAcceptRequestId]);
    await client.query("commit");
    const service = new MaterialRequirementService(new MaterialRequirementRepository(pool)); const planningActor = actor("planning", planningUsername);
    const generateMeta = meta(planningActor, "BROWSER_PLAN_GENERATE"), submitMeta = meta(planningActor, "BROWSER_PLAN_SUBMIT");
    const generated = await service.generate(Number(packageRow.id), generateMeta, { required_date: "2026-10-30" });
    const submitted = await service.submit(Number(generated.body.plan_id), submitMeta, { expected_version: 1 });
    return { credentials, planningUsername, packageId: Number(packageRow.id), packageDigest, packageAcceptRequestId, planGenerateRequestId: generateMeta.requestId, prqSubmitRequestId: submitMeta.requestId, planId: Number(generated.body.plan_id), requestId: Number(submitted.body.purchase_request.id), requestCode: String(submitted.body.purchase_request.request_code), projectCode: "PRJ-99000015", materialIds };
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode !== null) throw new Error("isolated standalone server exited before health check");
    try { const response = await fetch(`${REQUIRED_ORIGIN}/api/live`); if (response.ok) return; } catch { /* continue bounded liveness polling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("isolated standalone server did not become healthy");
}

async function startServer() {
  server = spawn(process.execPath, [serverEntry], { cwd: new URL(".", `file://${serverEntry}`).pathname, env: { ...process.env, HOSTNAME: "0.0.0.0", PORT: "43138", ERP_ENV: "test", ERP_DEPLOYMENT_CLASS: "test", ERP_PUBLIC_ORIGIN: REQUIRED_ORIGIN, ERP_UPLOAD_ROOT: "/tmp/fix18-uploads", ERP_ATTACHMENT_ROOT: "/tmp/fix18-attachments", ERP_BACKUP_STATUS_FILE: "/tmp/fix18-backup-status.json" }, stdio: "ignore" });
  await waitForServer();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function login(page, credentials) {
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credentials.username); await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  const response = page.waitForResponse((item) => item.url() === `${REQUIRED_ORIGIN}/api/login` && item.request().method() === "POST"); await page.getByRole("button", { name: "登录工作台", exact: true }).click(); assert.equal((await response).status(), 200); await page.getByRole("heading", { name: "角色工作台", exact: true }).waitFor();
}

async function noOverflow(page, stage) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(width.document <= width.viewport + 1, `${stage}: document overflow`); assert.ok(width.body <= width.viewport + 1, `${stage}: body overflow`);
}

async function state(requestId) {
  const request = (await pool.query("select r.status,r.version,r.accepted_by,p.status plan_status from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id where r.id=$1", [requestId])).rows[0];
  const acceptedEvents = Number((await pool.query("select count(*) count from planning_material_requirement_events where purchase_request_id=$1 and event_type='PURCHASE_ACCEPTED'", [requestId])).rows[0].count);
  const returnedEvents = Number((await pool.query("select count(*) count from planning_material_requirement_events where purchase_request_id=$1 and event_type='PURCHASE_RETURNED'", [requestId])).rows[0].count);
  const decision = (await pool.query("select actor,request_id,to_char(created_at at time zone 'Asia/Shanghai','YYYY/MM/DD HH24:MI:SS') occurred_at_shanghai from planning_material_requirement_events where purchase_request_id=$1 and event_type in ('PURCHASE_ACCEPTED','PURCHASE_RETURNED') order by id", [requestId])).rows[0] || null;
  const downstream = (await pool.query(`select (select count(*)::int from procurement_rfqs) rfqs,(select count(*)::int from procurement_supplier_quotes) quotes,(select count(*)::int from procurement_sourcing_awards) awards,(select count(*)::int from purchase_orders) purchase_orders,(select count(*)::int from purchase_delivery_plans) delivery_plans,(select count(*)::int from purchase_receipts) receipts,(select count(*)::int from inventory_ledger_entries) ledger,(select count(*)::int from finance_documents) finance_documents,(select count(*)::int from production_work_orders) work_orders,(select count(*)::int from inventory_stock_balances) inventory_balances,(select count(*)::int from planning_material_allocations) allocations`)).rows[0];
  return { request: { status: request.status, plan_status: request.plan_status, version: Number(request.version), accepted_by: request.accepted_by }, acceptedEvents, returnedEvents, decision, downstream };
}

test.before(async () => {
  assert.deepEqual((await pool.query("select current_database() name,(select count(*)::int from schema_migrations) migration_count")).rows[0], { name: REQUIRED_DATABASE, migration_count: 37 });
  await clearSyntheticData();
  await startServer();
});

test("isolated Chromium cancels without writes, accepts once and reopens the processed credential", { timeout: 240_000 }, async () => {
  const fixture = await seedFixture(); const initial = await state(fixture.requestId); assert.deepEqual(initial, { request: { status: "SUBMITTED", plan_status: "SUBMITTED", version: 1, accepted_by: null }, acceptedEvents: 0, returnedEvents: 0, decision: null, downstream: { rfqs: 0, quotes: 0, awards: 0, purchase_orders: 0, delivery_plans: 0, receipts: 0, ledger: 0, finance_documents: 0, work_orders: 0, inventory_balances: 0, allocations: 0 } });
  const chromium = await loadChromium(); let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] }); const businessPosts = [], detailGets = [], detailStatuses = []; let delayNextDetail = false, corruptNextDetail = false;
    await context.route("**/*", async (route) => { const request = route.request(), url = new URL(request.url()), method = request.method().toUpperCase(); if (url.origin === REQUIRED_ORIGIN && method === "POST" && !["/api/login", "/api/logout"].includes(url.pathname)) businessPosts.push(url.pathname); if (url.origin === REQUIRED_ORIGIN && method === "GET" && url.pathname === `/api/purchase-requests/${fixture.requestId}`) { detailGets.push(url.pathname); if (delayNextDetail) { delayNextDetail=false; await new Promise((resolve)=>setTimeout(resolve,150)); } const upstream=await route.fetch();detailStatuses.push(upstream.status());if(corruptNextDetail){corruptNextDetail=false;const payload=await upstream.json();delete payload.data.lines[0].current_supply.unallocated_inbound_available_qty;await route.fulfill({response:upstream,json:payload});return;}await route.fulfill({response:upstream});return;} if (url.origin === REQUIRED_ORIGIN) await route.continue(); else await route.abort("blockedbyclient"); });
    const page = await context.newPage(); await login(page, fixture.credentials); await page.goto(`${REQUIRED_ORIGIN}/planning/purchase-requests`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "采购申请接收工作台", exact: true }).waitFor(); await page.locator("button.planning-row", { hasText: fixture.requestCode }).click();
    await page.getByRole("heading", { name: new RegExp(fixture.requestCode) }).waitFor(); await page.getByText(`ID ${fixture.packageId}/v1`, { exact: true }).first().waitFor(); await page.getByText("Product A0", { exact: true }).waitFor(); await page.getByText(/BOM V1/).waitFor(); await page.getByText("Unit Resolution v1 · PCS", { exact: true }).waitFor();
    await page.getByText("该版本未采集计划说明", { exact: true }).waitFor(); await page.getByText("该版本未采集采购交接说明", { exact: true }).waitFor(); await page.getByText("净采购 = max(毛需求 - 快照库存分配 - 快照在途分配, 0)", { exact: true }).waitFor();
    for (const heading of ["1. 提交时快照","2. 当前供应状态","3. 差异提示"]) await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.locator(".purchase-snapshot-card").count(),4);assert.equal(await page.locator(".purchase-current-card").count(),4);assert.equal(await page.locator(".purchase-difference-card").count(),4);for (const materialId of fixture.materialIds) await page.getByText(`Material ID ${materialId}`, { exact: true }).first().waitFor();assert.equal(await page.locator(".purchase-snapshot-card").getByText("10 PCS", { exact: true }).count(),12);
    for(const card of await page.locator(".purchase-current-card").all()){const text=await card.innerText();for(const expected of ["当前在手总量","当前正式预留","品质冻结","当前库存可用","有效计划库存分配","当前未分配库存可用","当前有效在途总量","有效计划在途分配","当前未分配在途可用","模型未单独记录"])assert.match(text,new RegExp(expected));const quantities=card.locator(".planning-quantity");assert.equal(await quantities.count(),9);for(const quantity of await quantities.all()){assert.equal((await quantity.textContent()).replace(/\s+/g," ").trim(),"0 PCS");const geometry=await quantity.evaluate((element)=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return{display:style.display,whiteSpace:style.whiteSpace,width:rect.width,height:rect.height}});assert.equal(geometry.display,"inline-flex");assert.equal(geometry.whiteSpace,"nowrap");assert.ok(geometry.width>20);assert.ok(geometry.height<40)}}
    const detailCounts=await page.locator(".purchase-decision-counts").innerText();assert.match(detailCounts,/接收事件数量\s*0/);assert.match(detailCounts,/退回事件数量\s*0/);await noOverflow(page,"purchase detail desktop");
    const acceptPath = `/api/purchase-requests/${fixture.requestId}/accept`;
    async function openAcceptanceDialog(){
      const getBefore=detailGets.length;delayNextDetail=true;await page.getByRole("button",{name:"接收采购申请",exact:true}).click();const loading=page.getByRole("dialog",{name:`接收前复核 ${fixture.requestCode}`,exact:true});await loading.waitFor();await loading.getByRole("heading",{name:"正在重新读取当前供应",exact:true}).waitFor();assert.equal(await loading.getByRole("button",{name:"等待完整数据",exact:true}).isDisabled(),true);assert.equal(await loading.getByRole("button",{name:"取消",exact:true}).evaluate((button)=>button===document.activeElement),true);
      const dialog=page.getByRole("dialog",{name:`确认接收 ${fixture.requestCode}`,exact:true});try{await dialog.waitFor({timeout:10_000})}catch{const alerts=await page.locator('[role="alert"]').allInnerTexts();throw new Error(`acceptance dialog missing; detail statuses=${detailStatuses.join(",")}; alerts=${alerts.join(" | ")}`)}assert.equal(detailGets.length,getBefore+1);await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==="取消");
      for(const heading of ["PRQ 与项目","Package 接收完整凭证","计划生成完整凭证","PRQ 提交完整凭证","接收前显式决策计数","四项固定数量与九项当前供应（4 个 Material）","供应公式与边界","接收后果","下一阶段"])await dialog.getByRole("heading",{name:heading,exact:true}).waitFor();
      for(const value of [fixture.packageDigest,fixture.packageAcceptRequestId,fixture.planGenerateRequestId,fixture.prqSubmitRequestId])await dialog.getByText(value,{exact:true}).waitFor();
      const counts=await dialog.locator(".purchase-decision-counts").innerText();assert.match(counts,/接收前接收事件\s*0/);assert.match(counts,/接收前退回事件\s*0/);await dialog.getByText("已重新读取当前供应",{exact:true}).waitFor();assert.equal(await dialog.getByRole("button",{name:"确认接收",exact:true}).isEnabled(),true);
      const cards=dialog.locator(".purchase-accept-material-card");assert.equal(await cards.count(),4);for(const card of await cards.all()){const text=await card.innerText();for(const label of ["毛需求","快照库存可用","快照库存分配","快照在途可用","快照在途分配","净采购","PRQ 申请量","当前在手总量","当前正式预留量","当前品质冻结量","当前库存可用量","当前计划库存分配量","当前未分配库存可用量","当前有效在途总量","当前计划在途分配量","当前未分配在途可用量"])assert.match(text,new RegExp(label));const current=card.locator('[data-current-supply-nine="complete"] .planning-quantity');assert.equal(await current.count(),9);for(const quantity of await current.all())assert.equal((await quantity.textContent()).replace(/\s+/g," ").trim(),"0 PCS");}
      for(const consequence of ["不修改交接包、计划、PRQ 明细、库存、正式预留或计划分配。","不自动创建 RFQ、报价、定标、PO、交付计划、收货单、库存流水、AP 或工单。","采购寻源、询价和报价比较由后续独立受控操作完成；本次接收不会开始上述流程。"])await dialog.getByText(consequence,{exact:true}).waitFor();return dialog;
    }
    corruptNextDetail=true;delayNextDetail=true;await page.getByRole("button",{name:"接收采购申请",exact:true}).click();const incompleteLoading=page.getByRole("dialog",{name:`接收前复核 ${fixture.requestCode}`,exact:true});await incompleteLoading.waitFor();await incompleteLoading.waitFor({state:"detached"});await page.getByText("采购接收确认所需的完整追溯、决策计数或九项当前供应未全部取得，已禁止继续接收。",{exact:true}).waitFor();assert.equal(await page.getByRole("dialog",{name:`确认接收 ${fixture.requestCode}`,exact:true}).count(),0);assert.equal(businessPosts.filter((path)=>path===acceptPath).length,0);assert.deepEqual(await state(fixture.requestId),initial);
    const firstQueryTime=(await page.locator(".purchase-query-time").innerText()).replace(/^查询时间：/,"");await page.waitForTimeout(1100);const desktopDialog=await openAcceptanceDialog();const refreshedQueryTime=await desktopDialog.locator("dt",{hasText:"当前供应查询时间"}).locator("..").locator("dd").innerText();assert.notEqual(refreshedQueryTime,firstQueryTime);await noOverflow(page,"accept desktop");const desktopBefore=businessPosts.filter((path)=>path===acceptPath).length;await desktopDialog.getByRole("button",{name:"取消",exact:true}).click();await desktopDialog.waitFor({state:"detached"});assert.equal(businessPosts.filter((path)=>path===acceptPath).length,desktopBefore);assert.deepEqual(await state(fixture.requestId),initial);
    await page.setViewportSize({width:390,height:844});await noOverflow(page,"purchase detail 390px");
    for (const cancellation of ["cancel", "close", "escape"]) {
      const dialog=await openAcceptanceDialog();await noOverflow(page,`accept ${cancellation} 390px`);const before=businessPosts.filter((path)=>path===acceptPath).length;
      if(cancellation==="cancel")await dialog.getByRole("button",{name:"取消",exact:true}).click();else if(cancellation==="close")await dialog.getByRole("button",{name:"关闭确认窗口",exact:true}).click();else await page.keyboard.press("Escape");
      await dialog.waitFor({state:"detached"});assert.equal(businessPosts.filter((path)=>path===acceptPath).length,before);assert.deepEqual(await state(fixture.requestId),initial);
    }
    await page.getByLabel("退回原因（必填）", { exact: true }).fill("隔离浏览器验证退回取消不写入"); await page.getByRole("button", { name: "退回计划部", exact: true }).click(); const returnDialog = page.getByRole("dialog", { name: "确认退回计划部门修订", exact: true }); await returnDialog.waitFor(); await returnDialog.getByText("不修改原需求计划及提交时分配快照。", { exact: true }).waitFor(); const returnPath = `/api/purchase-requests/${fixture.requestId}/return`, returnBefore = businessPosts.filter((path) => path === returnPath).length; await returnDialog.getByRole("button", { name: "取消", exact: true }).click(); await returnDialog.waitFor({ state: "detached" }); assert.equal(businessPosts.filter((path) => path === returnPath).length, returnBefore); assert.deepEqual(await state(fixture.requestId), initial);
    const confirm=await openAcceptanceDialog();const postBefore = businessPosts.filter((path) => path === acceptPath).length; const responsePromise = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}${acceptPath}` && response.request().method() === "POST" && response.status() === 200); await confirm.getByRole("button", { name: "确认接收", exact: true }).evaluate((button) => { button.click(); button.click(); }); const response = await responsePromise, payload = await response.json();
    await page.getByRole("heading", { name: "操作完成凭证", exact: true }).waitFor(); assert.equal(businessPosts.filter((path) => path === acceptPath).length, postBefore + 1); const accepted = await state(fixture.requestId); assert.deepEqual(accepted.downstream, initial.downstream); assert.equal(accepted.request.status, "ACCEPTED"); assert.equal(accepted.request.plan_status, "ACCEPTED"); assert.equal(accepted.request.version, 2); assert.equal(accepted.request.accepted_by, fixture.credentials.username); assert.equal(accepted.acceptedEvents, 1);assert.equal(accepted.returnedEvents,0);assert.deepEqual([accepted.decision.actor,accepted.decision.request_id],[fixture.credentials.username,payload.request_id]);
    async function assertDecisionCredential(stage,{copy=false}={}){const evidence=page.locator('[data-purchase-decision-evidence="complete"]');await evidence.getByRole("heading",{name:"采购决策凭证",exact:true}).waitFor();const text=await evidence.innerText();for(const expected of [`Purchase Request ID\n${fixture.requestId}`,`PRQ\n${fixture.requestCode}`,"决策\n采购接收","业务事件类型\n采购接收",`操作者\n${fixture.credentials.username}`,`${accepted.decision.occurred_at_shanghai} Asia/Shanghai`,"结果\n成功","接收事件数量\n1","退回事件数量\n0"])assert.ok(text.includes(expected),`${stage}: missing ${expected}`);await evidence.getByText(payload.request_id,{exact:true}).waitFor();if(copy){const row=evidence.locator(".planning-copy-row",{hasText:"请求号"});await row.getByRole("button",{name:"复制",exact:true}).click();await row.getByRole("button",{name:"已复制",exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),payload.request_id)}await noOverflow(page,stage)}
    async function assertProcessedHistory(stage){await page.getByText("该 PRQ 已处理；关系化快照保持只读。",{exact:true}).waitFor();for(const heading of ["Package 与接收谱系","Material Requirement Plan 谱系","PRQ 提交凭证","采购决策凭证"])await page.getByRole("heading",{name:heading,exact:true}).waitFor();for(const value of [fixture.packageAcceptRequestId,fixture.planGenerateRequestId,fixture.prqSubmitRequestId])await page.getByText(value,{exact:true}).waitFor();const planFact=await page.locator("dt",{hasText:"采购交接状态"}).locator("..").innerText();assert.match(planFact,/已接收/);const prqFact=await page.locator("dt",{hasText:"PRQ 状态"}).locator("..").innerText();assert.match(prqFact,/采购已接收/);await page.getByText(/Plan v1 计算快照、行项目、分配及来源摘要仍不可变/).waitFor();assert.equal(await page.locator(".purchase-snapshot-card").count(),4);assert.equal(await page.locator(".purchase-current-card").count(),4);assert.equal(await page.getByRole("button",{name:"接收采购申请",exact:true}).count(),0);assert.equal(await page.getByRole("button",{name:"退回计划部",exact:true}).count(),0);assert.equal(await page.locator(".planning-decision-actions, textarea").count(),0);await assertDecisionCredential(stage)}
    async function openProcessedHistory(){await page.getByRole("heading",{name:"采购申请接收工作台",exact:true}).waitFor();await page.getByRole("tab",{name:/已处理/}).click();await page.locator("button.planning-row",{hasText:fixture.requestCode}).click();await page.getByRole("heading",{name:new RegExp(fixture.requestCode)}).waitFor()}
    await assertDecisionCredential("immediate SUCCESS receipt 390px",{copy:true});await page.getByRole("button", { name: "从已处理记录查看凭证", exact: true }).click();await assertProcessedHistory("processed credential 390px");
    await page.reload({waitUntil:"domcontentloaded"});await openProcessedHistory();await assertProcessedHistory("processed credential after refresh 390px");
    await stopServer();await startServer();await page.reload({waitUntil:"domcontentloaded"});await openProcessedHistory();await assertProcessedHistory("processed credential after Web restart 390px");
    async function logoutAndProveProtectedContentGone(){await page.goto(`${REQUIRED_ORIGIN}/`,{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"安全退出",exact:true}).click();await page.getByRole("heading",{name:"欢迎使用晨亿达 ERP",exact:true}).waitFor();assert.equal(Number((await pool.query("select count(*) count from app_sessions where username=$1 and revoked_at is null",[fixture.credentials.username])).rows[0].count),0);const protectedContentGone=()=>page.waitForFunction((requestCode)=>!document.body.innerText.includes(requestCode)&&(document.body.innerText.includes("欢迎使用晨亿达 ERP")||document.body.innerText.includes("请先登录")),fixture.requestCode);await page.goBack({waitUntil:"domcontentloaded"});await protectedContentGone();await page.goForward({waitUntil:"domcontentloaded"});await protectedContentGone();await page.reload({waitUntil:"domcontentloaded"});await protectedContentGone();assert.equal(await page.getByText(fixture.requestCode,{exact:true}).count(),0)}
    await logoutAndProveProtectedContentGone();await login(page,fixture.credentials);await page.setViewportSize({width:1440,height:900});await page.goto(`${REQUIRED_ORIGIN}/planning/purchase-requests`,{waitUntil:"domcontentloaded"});await openProcessedHistory();await assertProcessedHistory("processed credential after re-login desktop");await page.setViewportSize({width:390,height:844});await noOverflow(page,"processed credential re-login 390px");await logoutAndProveProtectedContentGone();assert.equal(businessPosts.filter((path)=>path===acceptPath).length,postBefore+1);await context.close();
  } finally { await browser?.close().catch(() => undefined); }
});

test.after(async () => { await stopServer(); await clearSyntheticData(); await pool.end(); });
