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
const FIX29_MATERIAL_DEFINITIONS = [
  { id: 533, code: "CYD-RB_PCB-000016", name: "FIX-29 隔离 PCB 物料" },
  { id: 534, code: "CYD-RB_SENSOR-000003", name: "FIX-29 隔离 Sensor 物料" },
  { id: 535, code: "CYD-RB_CONN-000075", name: "FIX-29 隔离 Connector 物料" },
  { id: 536, code: "CYD-RB_METAL-000015", name: "FIX-29 隔离 Metal 物料" },
];
const FIX29_AWARD_REASON = "交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。";
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "rfq-traceability-fix22-browser" });
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const mappingContentDigest = (supplierCode, materialId, mappingUid) => sha256(JSON.stringify([
  "FIX22_BROWSER_MAPPING_V1",
  supplierCode,
  materialId,
  mappingUid,
]));
const expectedRuntimeMigrationChecksum = createHash("sha256")
  .update(await readFile(new URL("../drizzle-postgres/0046_runtime_lock_privilege_boundary.sql", import.meta.url)))
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

async function seedFixture({ targetDate = "2099-10-30", materialDefinitions } = {}) {
  const definitions = materialDefinitions || MATERIAL_IDS.map((id) => ({
    id,
    code: `CYD-FIX22-${String(id).padStart(6, "0")}`,
    name: `FIX-22 物料 ${id}`,
  }));
  assert.deepEqual(definitions.map(({ id }) => id), MATERIAL_IDS, "fixture Material IDs must remain fixed");
  const materialDefinition = new Map(definitions.map((row) => [row.id, row]));
  const credentials = { username: "fix22_purchase", password: `Isolated!Fix22-${randomUUID()}` };
  const planningCredentials = { username: "planning01", password: `Isolated!Fix26-Planning-${randomUUID()}` };
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
        ('planning01','计划','planning',$3,true,false,1),
        ('engineering01','工程','engineering','x',true,false,1)`,
      [credentials.username, await hashPassword(credentials.password), await hashPassword(planningCredentials.password)],
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
      const definition = materialDefinition.get(materialId);
      assert.ok(definition);
      await client.query(
        `insert into material_master(
          id,internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,
          procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,
          last_modified_by,created_by,updated_by,request_id
        ) values($1,$2,$3,$4,'PCS',$5,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',
          'admin01','admin01','admin01',$6)`,
        [materialId, definition.code, definition.name, category.id, unit.id, randomUUID()],
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
        'engineering01','ACCEPTED',$2,1,4,$3,'admin01') returning id`,
      [customer.id, targetDate, randomUUID()],
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
      ) values($1,1,$2,'ACCEPTED',$3,$4,'engineering01','engineering01',now(),
        'planning01',now(),3,$5) returning id`,
      [project.id, requirement.id, targetDate, sha256("fix22-browser-package"), randomUUID()],
    )).rows[0];
    const plan = (await client.query(
      `insert into planning_material_requirement_plans(
        project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,
        source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id
      ) values($1,$2,1,$3,'SUBMITTED',3,$4,$5,'planning01','planning01',now(),1,$6) returning id`,
      [project.id, packageRow.id, targetDate, sha256("fix22-browser-package"), sha256("fix22-browser-calculation"), randomUUID()],
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
          { internal_material_code: materialDefinition.get(materialId).code, standard_name: materialDefinition.get(materialId).name },
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
              content_digest,submitted_by,submitted_at,submitted_request_id,reviewed_by,reviewed_at,
              reviewed_request_id,review_outcome,created_by,updated_by,request_id
            ) values($1,$2,$3,$4,$5,'PCS',$6,1,1,'ACTIVE',now()-interval '1 day',$7,$8,
              $9,now(),$10,$9,now(),$11,'APPROVED',$9,$9,$12)`,
            [
              materialId,
              supplier.id,
              supplierName,
              supplierCode,
              `${supplierCode}-${materialId}`,
              unit.id,
              MAPPING_UIDS[supplierIndex][materialIndex],
              mappingContentDigest(supplierCode, materialId, MAPPING_UIDS[supplierIndex][materialIndex]),
              credentials.username,
              randomUUID(),
              randomUUID(),
              randomUUID(),
            ],
          );
        }
      }
    });
    await client.query("commit");
    assert.equal(Number(purchaseRequest.id), 1);
    assert.deepEqual(supplierRows.map(({ supplier }) => Number(supplier.id)), [1, 2]);
    return { credentials, planningCredentials };
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
      const response = await fetch(`${REQUIRED_ORIGIN}/api/live`);
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

async function createFix29CurrentComparison(context, csrfToken) {
  const mutationHeaders = (key = randomUUID()) => ({
    Origin: REQUIRED_ORIGIN,
    "X-CSRF-Token": csrfToken,
    "Idempotency-Key": key,
  });
  const create = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs`, {
    headers: mutationHeaders(),
    data: { purchase_request_id: 1, supplier_ids: [1, 2], response_deadline: "2026-08-31", expected_version: 1 },
  });
  assert.equal(create.status(), 201, await create.text());
  const issue = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
    headers: mutationHeaders(),
    data: { expected_version: 1 },
  });
  assert.equal(issue.status(), 200, await issue.text());
  const rfqLines = (await pool.query(
    "select id::text,material_id::int from procurement_rfq_lines where rfq_id=1 order by line_no",
  )).rows;
  assert.deepEqual(rfqLines.map(({ id, material_id }) => [id, material_id]), [["1", 533], ["2", 534], ["3", 535], ["4", 536]]);
  const quoteBody = ({ supplierId, expectedVersion, reference, price, promisedDate }) => ({
    expected_version: expectedVersion,
    supplier_id: supplierId,
    supplier_quote_reference: reference,
    valid_until: "2026-09-30",
    tax_included: false,
    freight_included: false,
    payment_terms: "纯虚拟UAT付款条件，仅用于表单验收。",
    lines: rfqLines.map(({ id }) => ({
      rfq_line_id: id,
      quoted_quantity: "10.000000",
      minimum_order_quantity: "10.000000",
      unit_price: price,
      lead_time_days: 75,
      promised_delivery_date: promisedDate,
    })),
  });
  const quoteA = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
    headers: mutationHeaders(),
    data: quoteBody({ supplierId: 1, expectedVersion: 2, reference: "UAT-Q-A-042576", price: "12.000000", promisedDate: "2026-10-20" }),
  });
  assert.equal(quoteA.status(), 201, await quoteA.text());
  const quoteB = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
    headers: mutationHeaders(),
    data: quoteBody({ supplierId: 2, expectedVersion: 3, reference: "UAT-Q-B-042576", price: "10.000000", promisedDate: "2026-11-05" }),
  });
  assert.equal(quoteB.status(), 201, await quoteB.text());
  const comparison = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/comparisons`, {
    headers: mutationHeaders(),
    data: { expected_version: 4 },
  });
  const comparisonText = await comparison.text();
  assert.equal(comparison.status(), 201, comparisonText);
  const comparisonPayload = JSON.parse(comparisonText);
  assert.equal(comparisonPayload.comparison_version_no, 1);
  const detailResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1`);
  assert.equal(detailResponse.status(), 200);
  const detail = (await detailResponse.json()).data;
  assert.deepEqual({ status: detail.header.status, version: Number(detail.header.version) }, { status: "ISSUED", version: 5 });
  const current = detail.comparison_read_model.current_version;
  assert.ok(current);
  assert.deepEqual({ version: current.comparison_version_no, status: current.status, awardable: current.awardable_now, drift: current.input_drift }, {
    version: 1, status: "CURRENT", awardable: true, drift: false,
  });
  assert.equal(current.output_summary.digest, "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec");
  const candidates = (await pool.query(`select candidate.id::text candidate_id,
      candidate.comparison_id::text comparison_line_id,comparison.rfq_line_id::text rfq_line_id,
      candidate.supplier_id::text supplier_id,quote_line.quote_id::text quote_id,quote.quote_version_no::int quote_version_no
    from procurement_quote_comparison_lines candidate
    join procurement_quote_comparisons comparison on comparison.id=candidate.comparison_id
    join procurement_supplier_quote_lines quote_line on quote_line.id=candidate.quote_line_id
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
    where comparison.rfq_id=1 and comparison.comparison_version_no=1 order by candidate.id`)).rows;
  assert.deepEqual(candidates, [
    { candidate_id: "1", comparison_line_id: "1", rfq_line_id: "1", supplier_id: "2", quote_id: "2", quote_version_no: 1 },
    { candidate_id: "2", comparison_line_id: "1", rfq_line_id: "1", supplier_id: "1", quote_id: "1", quote_version_no: 1 },
    { candidate_id: "3", comparison_line_id: "2", rfq_line_id: "2", supplier_id: "2", quote_id: "2", quote_version_no: 1 },
    { candidate_id: "4", comparison_line_id: "2", rfq_line_id: "2", supplier_id: "1", quote_id: "1", quote_version_no: 1 },
    { candidate_id: "5", comparison_line_id: "3", rfq_line_id: "3", supplier_id: "2", quote_id: "2", quote_version_no: 1 },
    { candidate_id: "6", comparison_line_id: "3", rfq_line_id: "3", supplier_id: "1", quote_id: "1", quote_version_no: 1 },
    { candidate_id: "7", comparison_line_id: "4", rfq_line_id: "4", supplier_id: "2", quote_id: "2", quote_version_no: 1 },
    { candidate_id: "8", comparison_line_id: "4", rfq_line_id: "4", supplier_id: "1", quote_id: "1", quote_version_no: 1 },
  ]);
  return { detail, current, candidates };
}

async function createFix32Award(context, csrfToken, detail) {
  const version = detail.comparison_read_model.current_version;
  assert.ok(version && version.status === "CURRENT" && version.awardable_now === true);
  const body = {
    expected_version: Number(detail.header.version),
    expected_rfq_code: detail.header.rfq_code,
    expected_round_no: Number(detail.header.round_no),
    expected_comparison_version: Number(version.comparison_version_no),
    expected_comparison_output_digest: version.output_summary.digest,
    reason_code: "DELIVERY_PRIORITY",
    reason: FIX29_AWARD_REASON,
    lines: detail.lines.map((line) => {
      const material = version.material_summaries.find((row) => String(row.rfq_line_id) === String(line.id));
      const candidate = material?.offers.find((row) => Number(row.supplier_id) === 1);
      const identity = version.comparison_rows.find((row) => String(row.comparison_line_id) === String(material?.comparison_line_id));
      assert.ok(material && candidate && identity, `missing Award authority for RFQ Line ${line.id}`);
      return {
        rfq_line_id: String(line.id),
        comparison_line_id: String(material.comparison_line_id),
        comparison_basis_digest: identity.basis_digest,
        selected_candidate_id: String(candidate.comparison_candidate_id),
        expected_quote_id: String(candidate.quote_id),
        expected_quote_version_no: Number(candidate.quote_version_no),
        selection_reason: candidate.price_rank === 1 ? "" : "非最低价但满足交期",
        late_delivery_reason_code: candidate.delivery_status === "LATE" ? "LATE_DELIVERY_ACCEPTED" : "",
        late_delivery_reason: candidate.delivery_status === "LATE" ? "隔离测试接受延期交付" : "",
        excess_quantity_reason: "",
      };
    }),
  };
  const response = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/award`, {
    headers: {
      Origin: REQUIRED_ORIGIN,
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": `fix32-award-${randomUUID()}`,
    },
    data: body,
  });
  const payload = await response.json();
  assert.equal(response.status(), 201, JSON.stringify(payload));
  assert.deepEqual({
    award_id: payload.award_id,
    status: payload.status,
    comparison_version_no: payload.comparison_version_no,
    award_line_count: payload.award_line_count,
    purchase_order_created: payload.purchase_order_created,
  }, {
    award_id: 1,
    status: "AWARDED",
    comparison_version_no: 1,
    award_line_count: 4,
    purchase_order_created: false,
  });
  const awardedResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1`);
  assert.equal(awardedResponse.status(), 200);
  const awarded = (await awardedResponse.json()).data;
  assert.ok(awarded.award_history);
  assert.equal(awarded.award_history.projections.po_convertible_now, true);
  assert.equal(awarded.award_history.projections.po_count, 0);
  return awarded;
}

async function fix32UpstreamState() {
  return (await pool.query(`select
    (select status from procurement_rfqs where id=1) rfq_status,
    (select version::int from procurement_rfqs where id=1) rfq_version,
    (select count(*)::int from procurement_supplier_quotes where rfq_id=1) quote_count,
    (select jsonb_agg(to_jsonb(quote_row) order by quote_row.id) from procurement_supplier_quotes quote_row where quote_row.rfq_id=1) quote_facts,
    (select jsonb_agg(to_jsonb(quote_line) order by quote_line.id) from procurement_supplier_quote_lines quote_line
      join procurement_supplier_quotes quote_row on quote_row.id=quote_line.quote_id where quote_row.rfq_id=1) quote_line_facts,
    (select count(*)::int from procurement_quote_comparisons where rfq_id=1) comparison_line_count,
    (select count(distinct comparison_version_no)::int from procurement_quote_comparisons where rfq_id=1) comparison_version_count,
    (select array_agg(basis_digest order by id) from procurement_quote_comparisons where rfq_id=1) comparison_basis_digests,
    (select jsonb_agg(to_jsonb(comparison_row) order by comparison_row.id) from procurement_quote_comparisons comparison_row where comparison_row.rfq_id=1) comparison_facts,
    (select jsonb_agg(to_jsonb(candidate) order by candidate.id) from procurement_quote_comparison_lines candidate
      join procurement_quote_comparisons comparison_row on comparison_row.id=candidate.comparison_id where comparison_row.rfq_id=1) comparison_candidate_facts,
    (select jsonb_agg(to_jsonb(binding) order by binding.id) from procurement_rfq_supplier_line_mapping_bindings binding where binding.rfq_id=1) binding_facts,
    (select status from procurement_sourcing_awards where id=1) award_status,
    (select version::int from procurement_sourcing_awards where id=1) award_version,
    (select award_digest from procurement_sourcing_awards where id=1) award_digest,
    (select count(*)::int from procurement_sourcing_award_lines where award_id=1) award_line_count,
    (select jsonb_agg(to_jsonb(award_line) order by award_line.id) from procurement_sourcing_award_lines award_line where award_line.award_id=1) award_line_facts`)).rows[0];
}

async function fix32ConversionState() {
  return (await pool.query(`select
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from purchase_order_lines) purchase_order_lines,
    (select count(*)::int from purchase_order_status_events where event_type='CREATED') purchase_order_events,
    (select count(*)::int from procurement_award_po_line_links where award_id=1) award_links,
    (select count(*)::int from purchase_delivery_plans) delivery_plans,
    (select count(*)::int from warehouse_receiving_queue_entries) receiving_queue_entries,
    (select count(*)::int from purchase_delivery_plan_events where event_type='CREATED') delivery_plan_events,
    (select count(*)::int from purchase_receipts) receipts,
    (select count(*)::int from inventory_ledger_entries) ledger_entries,
    (select count(*)::int from quality_inspections) quality_inspections,
    (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
    (select count(*)::int from finance_settlements where settlement_type in ('PAYMENT','PAYMENT_REVERSAL')) payments,
    (select count(*)::int from production_work_orders) work_orders,
    (select count(*)::int from audit_log where action='SOURCING_AWARD_CONVERTED' and result='success') conversion_audits`)).rows[0];
}

async function visibleBindingIds(scope) {
  return scope.locator(".rfq-mapping-card").evaluateAll((cards) => cards.map((card) => {
    const fact = [...card.querySelectorAll("dl > div")]
      .find((row) => row.querySelector("dt")?.textContent?.trim() === "Binding ID");
    return fact?.querySelector("dd")?.textContent?.trim() || "";
  }));
}

async function visibleBindingAssociations(scope) {
  return scope.locator(".rfq-mapping-card").evaluateAll((cards) => cards.map((card) => {
    const facts = Object.fromEntries([...card.querySelectorAll("dl > div")].map((row) => [
      row.querySelector("dt")?.textContent?.trim() || "",
      row.querySelector("dd")?.textContent?.trim() || "",
    ]));
    const statuses = Object.fromEntries([...card.querySelectorAll("[data-rfq-status]")].map((row) => [
      row.getAttribute("data-rfq-status") || "",
      row.querySelector("b")?.textContent?.trim() || "",
    ]));
    return {
      binding_id: facts["Binding ID"],
      supplier_id: facts["Supplier ID"],
      rfq_line_id: facts["RFQ Line ID"],
      material_id: facts["Material ID"],
      mapping_id: facts["Mapping ID"],
      binding_status: statuses.binding,
      mapping_status: statuses.mapping,
      invitation_status: statuses.invitation,
      status_drift: facts["状态漂移（Binding ↔ Mapping）"],
      version_drift: facts["版本漂移（固定 ↔ 当前）"],
    };
  }));
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
    `select binding.id::text binding_id,binding.rfq_id::int,binding.rfq_supplier_id::int,
      binding.rfq_line_id::int,binding.supplier_id::int,binding.material_id::int,
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

async function previewWriteState(rfqId) {
  return (await pool.query(`select
    (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1) bindings,
    (select count(*)::int from procurement_sourcing_events where rfq_id=$1) events,
    (select count(*)::int from audit_log) audits,
    (select count(*)::int from idempotency_keys) idempotency,
    (select status from procurement_rfqs where id=$1) rfq_status,
    (select version::int from procurement_rfqs where id=$1) rfq_version,
    (select count(*)::int from procurement_supplier_quotes where rfq_id=$1) quotes,
    (select count(*)::int from procurement_sourcing_awards where rfq_id=$1) awards,
    (select count(distinct link.purchase_order_id)::int from procurement_award_po_line_links link
      join procurement_sourcing_awards award on award.id=link.award_id where award.rfq_id=$1) purchase_orders`, [rfqId])).rows[0];
}

async function convertToLegacyDraft(rfqId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await withSupplierMappingFixtureTriggersDisabled(client, async () => {
      await client.query("delete from procurement_rfq_supplier_line_mapping_bindings where rfq_id=$1", [rfqId]);
      await client.query("delete from procurement_sourcing_events where rfq_id=$1 and event_type='RFQ_CREATED'", [rfqId]);
      await client.query("update procurement_rfqs set traceability_version=1 where id=$1", [rfqId]);
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
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
      migration_count: 46,
      head: "0046_runtime_lock_privilege_boundary.sql",
      checksum: expectedRuntimeMigrationChecksum,
    },
  );
  await clearSyntheticData();
  await startServer();
});

test("isolated Chromium enforces the RFQ issuance confirmation contract and issues exactly once", { timeout: 300_000 }, async () => {
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
    assert.ok(draft.bindings.every((row) => /^[1-9]\d*$/.test(row.binding_id)));
    assert.equal(new Set(draft.bindings.map((row) => row.binding_id)).size, 8);
    const draftBindingIds = draft.bindings.map((row) => row.binding_id);
    const draftBindingIdsByIdentity = [...draftBindingIds].sort((left, right) => Number(left) - Number(right));
    const draftAssociationsByIdentity = [...draft.bindings]
      .sort((left, right) => Number(left.binding_id) - Number(right.binding_id))
      .map((row) => ({
        binding_id: row.binding_id,
        supplier_id: String(row.supplier_id),
        rfq_line_id: String(row.rfq_line_id),
        material_id: String(row.material_id),
        mapping_id: row.mapping_id,
        binding_status: "已生效",
        mapping_status: "已生效",
        invitation_status: "待报价",
        status_drift: "否",
        version_drift: "否",
      }));
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

    const securityBaseline = await sourcingState();
    const securityContext = await browser.newContext({ serviceWorkers: "block" });
    try {
      const purchaseLogin = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/login`, {
        headers: { Origin: REQUIRED_ORIGIN },
        data: fixture.credentials,
      });
      assert.equal(purchaseLogin.status(), 200);
      const purchaseSession = await (await securityContext.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
      assert.ok(purchaseSession.authenticated && purchaseSession.csrf_token);
      const missingCsrf = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
        headers: { Origin: REQUIRED_ORIGIN, "Idempotency-Key": "fix26-browser-missing-csrf" },
        data: { expected_version: 1 },
      });
      assert.equal(missingCsrf.status(), 403);
      assert.equal((await missingCsrf.json()).code, "CSRF_INVALID");
      const wrongOrigin = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
        headers: { Origin: "https://evil.example", "X-CSRF-Token": purchaseSession.csrf_token, "Idempotency-Key": "fix26-browser-wrong-origin" },
        data: { expected_version: 1 },
      });
      assert.equal(wrongOrigin.status(), 403);
      assert.equal((await wrongOrigin.json()).code, "CSRF_INVALID");
      const staleCas = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": purchaseSession.csrf_token, "Idempotency-Key": "fix26-browser-stale-cas" },
        data: { expected_version: 2 },
      });
      assert.equal(staleCas.status(), 409);
      assert.equal((await staleCas.json()).code, "VERSION_CONFLICT");
      const purchaseLogout = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": purchaseSession.csrf_token },
      });
      assert.equal(purchaseLogout.status(), 200);

      const planningLogin = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/login`, {
        headers: { Origin: REQUIRED_ORIGIN },
        data: fixture.planningCredentials,
      });
      assert.equal(planningLogin.status(), 200);
      const planningSession = await (await securityContext.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
      const forbiddenIssue = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": planningSession.csrf_token, "Idempotency-Key": "fix26-browser-forbidden-role" },
        data: { expected_version: 1 },
      });
      assert.equal(forbiddenIssue.status(), 403);
      assert.equal((await forbiddenIssue.json()).code, "PERMISSION_DENIED");
      const planningLogout = await securityContext.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": planningSession.csrf_token },
      });
      assert.equal(planningLogout.status(), 200);
    } finally {
      await securityContext.close();
    }
    assert.deepEqual(await sourcingState(), securityBaseline, "Origin, CSRF, and permission failures must preserve the RFQ business state");

    const bodyText = await page.locator("body").innerText();
    for (const required of [
      "ID 1 · RFQ-00000001",
      "Round 1 / v1",
      "RFQ 仍为草稿、待发出",
      "ID 1 · PRQ-00000001",
      "RFQ_CREATED 业务事件",
      "独立 RFQ_CREATED 业务事件",
      "RFQ_CREATED",
      "成功",
      fixture.credentials.username,
      draft.events[0].request_id,
      draft.events[0].occurred_at_shanghai,
      "Asia/Shanghai",
      "创建时已固定 Mapping",
      "Supplier Unit",
      "Internal Unit",
      "换算",
      "1:1",
      "Binding状态",
      "Mapping状态",
      "邀请状态",
      "Binding固定来源",
      "状态漂移（Binding ↔ Mapping）",
      "版本漂移（固定 ↔ 当前）",
      "Binding ID",
      "RFQ Line ID",
      "Material ID",
    ]) assert.ok(bodyText.includes(required), `draft evidence missing: ${required}`);
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(bodyText.includes(mappingId), `draft Mapping missing: ${mappingId}`);
    for (const binding of draft.bindings) assert.ok(bodyText.includes(binding.supplier_part_number), `draft supplier part missing: ${binding.supplier_part_number}`);
    assert.equal(await page.locator(".rfq-mapping-trace .rfq-mapping-group").count(), 2);
    assert.equal(await page.locator(".rfq-mapping-trace .rfq-mapping-card").count(), 8);
    assert.deepEqual(await visibleBindingIds(page.locator(".rfq-mapping-trace")), draftBindingIdsByIdentity);
    assert.deepEqual(await visibleBindingAssociations(page.locator(".rfq-mapping-trace")), draftAssociationsByIdentity);
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
      "ID 1 · RFQ-00000001", "Round 1 / v1", "草稿 / 待发出",
      "ID 1 · PRQ-00000001", "PRJ-00000001", "2099-08-31", "CNY",
      "RFQ_CREATED 业务事件", "独立 RFQ_CREATED 业务事件", "RFQ_CREATED", "成功", fixture.credentials.username,
      draft.events[0].request_id, draft.events[0].occurred_at_shanghai,
      "10.000000 PCS", "ID 1 · SUP-000001", "ID 2 · SUP-000002",
      "权威逐行关联（按 Binding ID 升序） · 8 条", "v1 / Row v1", "已绑定 Mapping 版本当前值", "最新 Mapping 版本",
      "Mapping 固定凭证", "固定 Binding 数量", "Binding 稳定 ID（按 ID 升序）",
      "身份关联口径", "不按任何摘要输入序列位置配对",
      "状态漂移（Binding ↔ Mapping）", "版本漂移（固定 ↔ 当前）", "发出前服务端重新校验 PRQ、Supplier、Mapping、截止日期、CAS 与当前草稿状态",
      "发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结", "只有发出成功后才允许录入 Supplier 报价",
      "本次发出不会自动创建或修改以下下游记录", "Quote（供应商报价）", "Award（定标）", "PO（采购订单）",
      "Delivery Plan（交付计划）", "Receipt／收货", "Inventory Ledger／库存流水", "AP／采购应付",
      "Work Order／生产工单", "其他生产记录", "财务记录",
    ]) {
      assert.ok(dialogText.includes(required), `issue dialog missing: ${required}`);
    }
    for (const materialId of MATERIAL_IDS) assert.ok(dialogText.includes(`Material ${materialId}`), `issue dialog Material missing: ${materialId}`);
    for (const binding of draft.bindings) assert.ok(dialogText.includes(binding.supplier_part_number), `issue dialog supplier part missing: ${binding.supplier_part_number}`);
    for (const bindingId of draftBindingIds) assert.ok(dialogText.includes(bindingId), `issue dialog Binding ID missing: ${bindingId}`);
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(dialogText.includes(mappingId));
    assert.deepEqual(await visibleBindingIds(dialog), draftBindingIdsByIdentity);
    assert.deepEqual(await visibleBindingAssociations(dialog), draftAssociationsByIdentity);
    assert.ok(dialogText.includes(draftBindingIdsByIdentity.join(" · ")), "receipt Binding IDs must use stable ID order");
    assert.equal(await dialog.getByRole("button", { name: "确认发出", exact: true }).isEnabled(), true);
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
    await dialog.getByRole("button", { name: "确认发出", exact: true }).click();
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
    const disabledImmediately = await dialog.getByRole("button", { name: "确认发出", exact: true }).evaluate((button) => {
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
    assert.deepEqual(issued.bindings.map((row) => row.binding_id), draftBindingIds);
    assert.equal(issued.events.length, 2);
    assert.deepEqual(
      { event_type: issued.events[1].event_type, actor: issued.events[1].actor, result: issued.events[1].result, old_version: issued.events[1].old_version, new_version: issued.events[1].new_version, from_status: issued.events[1].from_status, to_status: issued.events[1].to_status, credential_version: issued.events[1].credential_version },
      { event_type: "RFQ_ISSUED", actor: fixture.credentials.username, result: "SUCCESS", old_version: 1, new_version: 2, from_status: "DRAFT", to_status: "ISSUED", credential_version: 2 },
    );
    assert.match(issued.events[1].request_id, /^[0-9a-f-]{36}$/);
    assert.match(issued.events[1].idempotency_key_digest, /^[0-9a-f]{64}$/);
    assert.match(issued.events[1].scope_digest, /^[0-9a-f]{64}$/);
    assert.equal(issued.events[1].scope_digest, draft.events[0].scope_digest, "issuance must preserve the canonical frozen-scope digest");
    assert.deepEqual(issued.downstream, draft.downstream);

    const issuedText = await page.locator("body").innerText();
    for (const required of ["已发出", "RFQ 发出成功凭证", "业务事件", "询价已发出", "成功",
      fixture.credentials.username, issued.events[1].occurred_at_shanghai, "Asia/Shanghai", issued.events[1].request_id,
      "v1 → v2", "2 Suppliers · 8 Mappings", issued.events[1].scope_digest,
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
    assert.deepEqual(await visibleBindingIds(page.locator(".rfq-mapping-trace")), draftBindingIdsByIdentity);
    assert.deepEqual(await sourcingState(), issued);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "issued detail after web restart 390x844");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "安全退出", exact: true }).click();
    await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
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
    console.info("RFQ_ISSUANCE_CONFIRMATION_FIX26_BROWSER_ISSUE_OK rfq=1 create_event=1 bindings=8 issue_event=1 issue_post=1 quote=0 award=0 po=0 restart=1 desktop=1 mobile=1 session=0");
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

test("isolated Chromium keeps a fixed legacy RFQ draft after all issuance confirmation exits", { timeout: 300_000 }, async () => {
  await clearSyntheticData();
  const fixture = await seedFixture();
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const authPosts = [];
    const businessWrites = [];
    const previewGets = [];
    let releaseFirstPreview;
    let holdFirstPreview = true;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method().toUpperCase();
      if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
      if (method === "GET" && url.pathname === "/api/procurement/rfqs/1/mapping-bindings/preview") {
        previewGets.push(url.pathname);
        if (holdFirstPreview) await new Promise((resolve) => { releaseFirstPreview = resolve; });
      }
      if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) authPosts.push(url.pathname);
      else if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        businessWrites.push({ method, path: url.pathname, body: request.postDataJSON() });
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
    const createResponse = page.waitForResponse(
      (response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs`
        && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "建立询价草稿", exact: true }).click();
    assert.equal((await createResponse).status(), 201);
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();

    const newRfqText = await page.locator("body").innerText();
    for (const required of [
      "RFQ_CREATED 业务事件",
      "独立 RFQ_CREATED 业务事件",
      "RFQ 业务事件（与审计分列）",
      "RFQ_CREATED",
      "成功",
    ]) assert.ok(newRfqText.includes(required), `new RFQ Event wording missing: ${required}`);

    await convertToLegacyDraft(1);
    const audit = (await pool.query(`select username,request_id::text,result,old_version::int,new_version::int,
      operation_id::text,to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai
      from audit_log where route_code='PROCUREMENT_SOURCING' and action='RFQ_CREATED' and detail->>'object_id'='1'`)).rows[0];
    assert.ok(audit);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ 创建成功审计", exact: true }).waitFor();
    const legacyText = await page.locator("body").innerText();
    for (const required of [
      "RFQ 创建成功审计",
      "精确匹配的成功审计",
      "这是与本 RFQ 精确匹配的成功审计，不是独立 RFQ_CREATED 业务事件。",
      "独立 RFQ_CREATED 事件\n否",
      fixture.credentials.username,
      audit.request_id,
      audit.occurred_at_shanghai,
      "成功",
      "不存在 → v1",
      "尚无独立 RFQ 业务事件；创建成功审计在上方独立显示。",
    ]) assert.ok(legacyText.includes(required), `legacy Audit wording missing: ${required}`);
    assert.equal(audit.result, "success");
    assert.equal(audit.old_version, null);
    assert.equal(audit.new_version, 1);
    assert.deepEqual(await previewWriteState(1), {
      bindings: 0,
      events: 0,
      audits: 2,
      idempotency: 1,
      rfq_status: "DRAFT",
      rfq_version: 1,
      quotes: 0,
      awards: 0,
      purchase_orders: 0,
    });

    const openPreview = page.getByRole("button", { name: "确认并固定当前 Mapping", exact: true });
    const zeroWriteBaseline = await previewWriteState(1);
    const businessWritesAfterCreate = businessWrites.length;
    await openPreview.click();
    let dialog = page.getByRole("dialog", { name: "确认并固定当前 Mapping", exact: true });
    await dialog.waitFor();
    await dialog.getByText("正在重新查询当前权威资格与冲突证据…", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "正在查询…", exact: true }).isDisabled(), true);
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
    holdFirstPreview = false;
    releaseFirstPreview();
    await dialog.getByRole("heading", { name: "当前资格检查：全部通过", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "确认并固定当前 Mapping", exact: true }).isEnabled(), true);
    const previewText = await dialog.innerText();
    for (const required of [
      "服务端观测时间：",
      "数据时区：Asia/Shanghai",
      "ID 1 · RFQ-00000001",
      "Round 1 / 当前 v1 / 页面 expected_version v1",
      "草稿 / 待发出",
      "ID 1 · PRQ-00000001",
      "权威 RFQ Line · 4 条",
      "Supplier 资格覆盖 · 2 家",
      "Supplier 1：4/4",
      "Supplier 2：4/4",
      "缺失组合：0",
      "Supplier/Material 冲突：0",
      "供应商料号冲突：0",
      "候选 Mapping：8",
      "预期 Binding：8",
      "当前 Binding：0",
      "Binding 0 → 预期 8",
      "Supplier × RFQ Line Mapping · 8 条",
      "PCS → PCS · 1:1",
      "相同 Supplier/Material 当前已生效数量\n1",
      "Supplier 内相同 supplier_part_number 当前已生效数量\n1",
      "Supplier/Material 冲突\n否",
      "供应商料号冲突\n否",
      "当前资格\n通过",
      "确认后将生成8条关系化、不可变的Supplier×RFQ Line Mapping Binding。",
      "每条Binding固定引用本次确认的Mapping ID和Version。后续Supplier Mapping状态、版本或内容发生变化时，不会自动替换或改写本RFQ已固定的Binding。",
      "固定字段映射不等于发出询价单",
      "询价单继续保持草稿 / 待发出",
      "本操作不创建 Quote、Award、PO、库存或财务记录。",
      "正式发出仍需后续独立确认",
      "当前预览不是提交锁",
    ]) assert.ok(previewText.includes(required), `Mapping preview evidence missing: ${required}`);
    assert.equal(await dialog.locator(".rfq-mapping-card").count(), 8);
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(previewText.includes(mappingId), `preview Mapping missing: ${mappingId}`);
    for (const materialId of MATERIAL_IDS) assert.ok(previewText.includes(`Material ID ${materialId}`), `preview Material missing: ${materialId}`);
    await noOverflow(page, "Mapping preview desktop");
    await noDialogOverflow(dialog, "Mapping preview desktop");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessWrites.length, businessWritesAfterCreate, "cancel must add zero business writes");
    assert.deepEqual(await previewWriteState(1), zeroWriteBaseline);

    await openPreview.click();
    dialog = page.getByRole("dialog", { name: "确认并固定当前 Mapping", exact: true });
    await dialog.getByRole("heading", { name: "当前资格检查：全部通过", exact: true }).waitFor();
    const previewGetsBeforeClose = previewGets.length;
    await dialog.getByRole("button", { name: "关闭确认窗口", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(previewGets.length, previewGetsBeforeClose, "close must add zero requests");
    assert.equal(businessWrites.length, businessWritesAfterCreate, "close must add zero business writes");
    assert.deepEqual(await previewWriteState(1), zeroWriteBaseline);

    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "legacy detail 390x844");
    await openPreview.click();
    dialog = page.getByRole("dialog", { name: "确认并固定当前 Mapping", exact: true });
    await dialog.getByRole("heading", { name: "当前资格检查：全部通过", exact: true }).waitFor();
    await noOverflow(page, "Mapping preview page 390x844");
    await noDialogOverflow(dialog, "Mapping preview 390x844");
    const previewGetsBeforeEscape = previewGets.length;
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(previewGets.length, previewGetsBeforeEscape, "Escape must add zero requests");
    assert.equal(businessWrites.length, businessWritesAfterCreate, "Escape must add zero business writes");
    assert.deepEqual(await previewWriteState(1), zeroWriteBaseline);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openPreview.click();
    dialog = page.getByRole("dialog", { name: "确认并固定当前 Mapping", exact: true });
    await dialog.getByRole("heading", { name: "当前资格检查：全部通过", exact: true }).waitFor();
    const bindingResponse = page.waitForResponse(
      (response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs/1/mapping-bindings`
        && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "确认并固定当前 Mapping", exact: true }).click();
    assert.equal((await bindingResponse).status(), 200);
    await dialog.waitFor({ state: "detached" });
    await page.getByText("当前 Mapping 已由采购显式确认并固定；RFQ 仍为草稿、待发出", { exact: true }).waitFor();
    await page.getByText("Round 1 / v2", { exact: true }).waitFor();
    const fixed = await sourcingState();
    assert.equal(fixed.header.length, 1);
    assert.deepEqual(
      { status: fixed.header[0].status, version: fixed.header[0].version, traceability_version: fixed.header[0].traceability_version },
      { status: "DRAFT", version: 2, traceability_version: 1 },
    );
    assert.equal(fixed.bindings.length, 8);
    assert.ok(fixed.bindings.every((row) => /^[1-9]\d*$/.test(row.binding_id)));
    assert.equal(new Set(fixed.bindings.map((row) => row.binding_id)).size, 8);
    const fixedBindingIds = fixed.bindings.map((row) => row.binding_id);
    const fixedBindingIdsByIdentity = [...fixedBindingIds].sort((left, right) => Number(left) - Number(right));
    const fixedAssociationsByIdentity = [...fixed.bindings]
      .sort((left, right) => Number(left.binding_id) - Number(right.binding_id))
      .map((row) => ({
        binding_id: row.binding_id,
        supplier_id: String(row.supplier_id),
        rfq_line_id: String(row.rfq_line_id),
        material_id: String(row.material_id),
        mapping_id: row.mapping_id,
        binding_status: "已生效",
        mapping_status: "已生效",
        invitation_status: "待报价",
        status_drift: "否",
        version_drift: "否",
      }));
    assert.deepEqual(fixed.bindings.map((row) => row.mapping_id), MAPPING_UIDS.flat());
    assert.ok(fixed.bindings.every((row) => row.binding_source === "LEGACY_DRAFT_CONFIRMATION" && row.binding_status === "ACTIVE"));
    assert.equal(fixed.events.length, 1);
    assert.deepEqual(
      { event_type: fixed.events[0].event_type, actor: fixed.events[0].actor, result: fixed.events[0].result, old_version: fixed.events[0].old_version, new_version: fixed.events[0].new_version, from_status: fixed.events[0].from_status, to_status: fixed.events[0].to_status },
      { event_type: "RFQ_MAPPING_CONFIRMED", actor: fixture.credentials.username, result: "SUCCESS", old_version: 1, new_version: 2, from_status: "DRAFT", to_status: "DRAFT" },
    );
    assert.deepEqual(fixed.downstream, {
      quotes: 0,
      awards: 0,
      purchase_orders: 0,
      delivery_plans: 0,
      receipts: 0,
      ledger_entries: 0,
      ap_documents: 0,
      work_orders: 0,
    });
    assert.deepEqual(businessWrites.map(({ path }) => path), [
      "/api/procurement/rfqs",
      "/api/procurement/rfqs/1/mapping-bindings",
    ]);
    assert.equal(businessWrites.some(({ path }) => path.endsWith("/issue")), false);
    const fixedText = await page.locator("body").innerText();
    assert.ok(fixedText.includes("RFQ 创建成功审计"));
    assert.ok(fixedText.includes("不是独立 RFQ_CREATED 业务事件"));
    assert.ok(fixedText.includes("询价映射已确认"));
    assert.ok(fixedText.includes("RFQ 仍为草稿、待发出"));
    for (const required of [
      "Mapping 固定凭证",
      "询价映射已确认",
      "成功",
      fixture.credentials.username,
      fixed.events[0].occurred_at_shanghai,
      fixed.events[0].request_id,
      "v1 → v2",
      "固定 Binding 数量",
      "Binding 稳定 ID（按 ID 升序）",
      "身份关联口径",
      "不按任何摘要输入序列位置配对",
      fixed.events[0].scope_digest,
      "不可变快照说明",
      "Binding ID",
      "RFQ ID",
      "RFQ Line ID",
      "Supplier ID",
      "Material ID",
      "Mapping ID",
      "Mapping Version",
      "supplier_part_number",
      "Supplier Unit",
      "Internal Unit",
      "换算",
      "有效期",
      "Binding状态",
      "Mapping状态",
      "邀请状态",
      "状态漂移（Binding ↔ Mapping）",
      "版本漂移（固定 ↔ 当前）",
    ]) assert.ok(fixedText.includes(required), `fixed Binding evidence missing: ${required}`);
    for (const bindingId of fixedBindingIds) assert.ok(fixedText.includes(bindingId), `fixed Binding ID missing: ${bindingId}`);
    assert.equal(await page.locator(".rfq-mapping-trace .rfq-mapping-card").count(), 8);
    assert.deepEqual(await visibleBindingIds(page.locator(".rfq-mapping-trace")), fixedBindingIdsByIdentity);
    assert.deepEqual(await visibleBindingAssociations(page.locator(".rfq-mapping-trace")), fixedAssociationsByIdentity);
    const fixedReceipt = page.locator("details.rfq-receipt").filter({ hasText: "Mapping 固定凭证" }).first();
    assert.equal(await fixedReceipt.getAttribute("open"), "");
    await fixedReceipt.locator("summary").click();
    assert.equal(await fixedReceipt.getAttribute("open"), null);
    await fixedReceipt.locator("summary").click();
    assert.equal(await fixedReceipt.getAttribute("open"), "");
    await noOverflow(page, "fixed legacy detail desktop");

    const fixedWriteBaseline = await previewWriteState(1);
    const businessWritesAfterFixed = businessWrites.length;
    const issueButton = page.getByRole("button", { name: "发出询价并冻结范围", exact: true });
    await issueButton.click();
    dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "确认发出", exact: true }).isEnabled(), true);
    const issueText = await dialog.innerText();
    for (const required of [
      "ID 1 · RFQ-00000001",
      "Round 1 / v2",
      "RFQ 创建成功审计",
      "Mapping 固定凭证",
      "询价映射已确认",
      fixture.credentials.username,
      fixed.events[0].occurred_at_shanghai,
      fixed.events[0].request_id,
      "成功",
      "v1 → v2",
      fixed.events[0].scope_digest,
      "固定范围 · 4 条 Material",
      "受邀 Supplier · 2 家",
      "2099-08-31",
      "CNY",
      "状态漂移（Binding ↔ Mapping）",
      "版本漂移（固定 ↔ 当前）",
      "发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结",
      "只有发出成功后才允许录入 Supplier 报价",
      "本次发出不会自动创建或修改以下下游记录",
      "Quote（供应商报价）",
      "Award（定标）",
      "PO（采购订单）",
      "Delivery Plan（交付计划）",
      "Receipt／收货",
      "Inventory Ledger／库存流水",
      "AP／采购应付",
      "Work Order／生产工单",
      "其他生产记录",
      "财务记录",
    ]) assert.ok(issueText.includes(required), `fixed issue confirmation missing: ${required}`);
    for (const bindingId of fixedBindingIds) assert.ok(issueText.includes(bindingId), `fixed issue Binding ID missing: ${bindingId}`);
    for (const mappingId of MAPPING_UIDS.flat()) assert.ok(issueText.includes(mappingId), `fixed issue Mapping missing: ${mappingId}`);
    assert.deepEqual(await visibleBindingIds(dialog), fixedBindingIdsByIdentity);
    assert.deepEqual(await visibleBindingAssociations(dialog), fixedAssociationsByIdentity);
    assert.ok(issueText.includes(fixedBindingIdsByIdentity.join(" · ")), "fixed receipt Binding IDs must use stable ID order");
    await noDialogOverflow(dialog, "fixed issue dialog desktop");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessWrites.length, businessWritesAfterFixed, "fixed issue cancel must add zero business writes");
    assert.deepEqual(await previewWriteState(1), fixedWriteBaseline);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    assert.deepEqual(await visibleBindingIds(page.locator(".rfq-mapping-trace")), fixedBindingIdsByIdentity);
    await stopServer();
    await startServer();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    assert.deepEqual(await visibleBindingIds(page.locator(".rfq-mapping-trace")), fixedBindingIdsByIdentity);
    assert.deepEqual(await previewWriteState(1), fixedWriteBaseline);

    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "fixed legacy detail 390x844");
    await page.getByRole("button", { name: "发出询价并冻结范围", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
    await dialog.waitFor();
    assert.deepEqual(await visibleBindingIds(dialog), fixedBindingIdsByIdentity);
    await noOverflow(page, "fixed issue dialog page 390x844");
    await noDialogOverflow(dialog, "fixed issue dialog 390x844");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessWrites.length, businessWritesAfterFixed, "fixed mobile issue cancel must add zero business writes");
    assert.deepEqual(await previewWriteState(1), fixedWriteBaseline);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "安全退出", exact: true }).click();
    await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
    await assertNoProtectedRfq(page, "FIX-23 logout");
    assert.deepEqual(authPosts, ["/api/login", "/api/logout"]);
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    await context.close();
    console.info(`RFQ_ISSUANCE_CONFIRMATION_FIX26_BROWSER_DRAFT_OK rfq=1 audit=1 preview_gets=4 zero_write_exits=5 bindings=8 binding_ids=${fixedBindingIdsByIdentity.join(",")} receipt=1 issue_cancel=2 restart=1 status=DRAFT issued=0 quote=0 award=0 po=0 desktop=1 mobile=1 session=0`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

test("isolated Chromium traces the first Quote response while the second Supplier remains independently quoteable", { timeout: 300_000 }, async () => {
  await clearSyntheticData();
  const fixture = await seedFixture();
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await login(page, fixture.credentials);
    const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
    assert.ok(session.authenticated && session.csrf_token);
    const mutationHeaders = (key = randomUUID(), origin = REQUIRED_ORIGIN, csrf = session.csrf_token) => ({
      Origin: origin,
      "X-CSRF-Token": csrf,
      "Idempotency-Key": key,
    });
    const create = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs`, {
      headers: mutationHeaders(),
      data: { purchase_request_id: 1, supplier_ids: [1, 2], response_deadline: "2099-08-31", expected_version: 1 },
    });
    assert.equal(create.status(), 201, await create.text());
    const issued = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
      headers: mutationHeaders(),
      data: { expected_version: 1 },
    });
    assert.equal(issued.status(), 200, await issued.text());
    const fixed = await sourcingState();
    assert.equal(fixed.header[0].version, 2);
    assert.equal(fixed.header[0].status, "ISSUED");
    assert.equal(fixed.bindings.length, 8);
    const fixedBindings = structuredClone(fixed.bindings);
    const fixedDigest = fixed.events.find((event) => event.event_type === "RFQ_ISSUED")?.scope_digest;
    assert.ok(fixedDigest);

    const rfqLines = (await pool.query("select id::int from procurement_rfq_lines where rfq_id=1 order by line_no")).rows;
    const quoteBody = (supplierId, expectedVersion, reference) => ({
      expected_version: expectedVersion,
      supplier_id: supplierId,
      supplier_quote_reference: reference,
      valid_until: "2099-09-30",
      tax_included: false,
      freight_included: false,
      payment_terms: "隔离浏览器测试付款条件",
      lines: rfqLines.map(({ id }) => ({
        rfq_line_id: id,
        quoted_quantity: "10.000000",
        minimum_order_quantity: "10.000000",
        unit_price: "12.000000",
        lead_time_days: 75,
        promised_delivery_date: "2099-10-20",
      })),
    });
    const beforeSecurity = await sourcingState();
    const missingCsrf = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: { Origin: REQUIRED_ORIGIN, "Idempotency-Key": randomUUID() },
      data: quoteBody(1, 2, "ISO-Q-A-MISSING-CSRF"),
    });
    assert.equal(missingCsrf.status(), 403);
    const wrongOrigin = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: mutationHeaders(randomUUID(), "http://untrusted.invalid"),
      data: quoteBody(1, 2, "ISO-Q-A-WRONG-ORIGIN"),
    });
    assert.equal(wrongOrigin.status(), 403);
    const planningContext = await browser.newContext({ serviceWorkers: "block" });
    try {
      const planningLogin = await planningContext.request.post(`${REQUIRED_ORIGIN}/api/login`, {
        headers: { Origin: REQUIRED_ORIGIN },
        data: fixture.planningCredentials,
      });
      assert.equal(planningLogin.status(), 200);
      const planningSession = await (await planningContext.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
      const forbidden = await planningContext.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": planningSession.csrf_token, "Idempotency-Key": randomUUID() },
        data: quoteBody(1, 2, "ISO-Q-A-FORBIDDEN"),
      });
      assert.equal(forbidden.status(), 403);
    } finally {
      await planningContext.close();
    }
    assert.deepEqual(await sourcingState(), beforeSecurity);

    const quoteAResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: mutationHeaders(),
      data: quoteBody(1, 2, "ISO-Q-A"),
    });
    const quoteAText = await quoteAResponse.text();
    assert.equal(quoteAResponse.status(), 201, quoteAText);
    const quoteA = JSON.parse(quoteAText);
    assert.deepEqual({ quote_id: quoteA.quote_id, quote_version_no: quoteA.quote_version_no, status: quoteA.status, rfq_version: quoteA.rfq_version }, { quote_id: 1, quote_version_no: 1, status: "SUBMITTED", rfq_version: 3 });
    const staleB = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: mutationHeaders(),
      data: quoteBody(2, 2, "ISO-Q-B-STALE"),
    });
    assert.equal(staleB.status(), 409);
    assert.equal((await staleB.json()).code, "VERSION_CONFLICT");

    const afterA = await sourcingState();
    assert.equal(afterA.header[0].version, 3);
    assert.equal(afterA.header[0].status, "ISSUED");
    assert.deepEqual(afterA.bindings, fixedBindings);
    assert.equal(afterA.events.filter((event) => event.event_type === "QUOTE_SUBMITTED").length, 1);
    assert.equal(afterA.events.find((event) => event.event_type === "RFQ_ISSUED")?.scope_digest, fixedDigest);
    assert.deepEqual((await pool.query("select supplier_id::int,status from procurement_rfq_suppliers where rfq_id=1 order by supplier_id")).rows, [
      { supplier_id: 1, status: "RESPONDED" },
      { supplier_id: 2, status: "INVITED" },
    ]);

    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing/1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Quote追溯 · 数据库ID 1", exact: true }).waitFor();
    const pageText = await page.locator("body").innerText();
    for (const required of [
      "Round 1 / v3", "已报价", "待报价", "Quote入口：可报价",
      "稳定Quote数据库ID", "未设置独立Quote业务编号", "ID 1 / SUP-000001", "ID 1 / Round 1",
      "当前 v1", "已提交", "ISO-Q-A", "2099-09-30", "10 PCS × 12.00 CNY",
      "120.00 CNY", "480.00 CNY", "2099-10-20", "2099-10-30", "准时",
      "准时，提前10天", fixture.credentials.username, "Asia/Shanghai", quoteA.request_id, "成功",
      "只产生报价提交事件", "没有独立创建事件", "事件未记录版本转换",
      "RFQ Version是询价聚合CAS", "Supplier报价响应会正常推进CAS", fixedDigest,
    ]) assert.ok(pageText.includes(required), `Quote traceability missing: ${required}`);
    assert.equal(pageText.includes("vnull"), false);
    assert.equal(pageText.includes("当前阻断项"), false);
    assert.equal(await page.locator(".rfq-mapping-card.drift").count(), 0);
    assert.equal(await page.locator('.sourcing-quote select[name="supplier_id"] option[value="1"]').count(), 0);
    assert.equal(await page.locator('.sourcing-quote select[name="supplier_id"] option[value="2"]').count(), 1);
    await noOverflow(page, "Quote traceability desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "Quote traceability 390x844");

    const quoteBResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: mutationHeaders(),
      data: quoteBody(2, 3, "ISO-Q-B"),
    });
    assert.equal(quoteBResponse.status(), 201, await quoteBResponse.text());
    const finalState = await sourcingState();
    assert.equal(finalState.header[0].version, 4);
    assert.deepEqual(finalState.bindings, fixedBindings);
    assert.equal(finalState.downstream.quotes, 2);
    assert.equal(finalState.downstream.awards, 0);
    assert.equal(finalState.downstream.purchase_orders, 0);
    assert.deepEqual((await pool.query("select supplier_id::int,status from procurement_rfq_suppliers where rfq_id=1 order by supplier_id")).rows, [
      { supplier_id: 1, status: "RESPONDED" },
      { supplier_id: 2, status: "RESPONDED" },
    ]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "安全退出", exact: true }).click();
    await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    await context.close();
    console.info("RFQ_QUOTE_SEMANTICS_FIX27_BROWSER_OK rfq=1 quote_a=1 quote_b=1 aggregate_cas=4 bindings=8 drift=0 total_a=480.00 delivery_delta=10 desktop=1 mobile=1 award=0 po=0 session=0");
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

test("isolated Chromium renders the Comparison aggregate read model on desktop and 390x844 without creating Award or PO", { timeout: 300_000 }, async () => {
  await clearSyntheticData();
  const fixture = await seedFixture({ targetDate: "2026-10-30" });
  const chromium = await loadChromium();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await login(page, fixture.credentials);
    const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
    assert.ok(session.authenticated && session.csrf_token);
    const mutationHeaders = (key = randomUUID()) => ({
      Origin: REQUIRED_ORIGIN,
      "X-CSRF-Token": session.csrf_token,
      "Idempotency-Key": key,
    });
    const create = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs`, {
      headers: mutationHeaders(),
      data: { purchase_request_id: 1, supplier_ids: [1, 2], response_deadline: "2026-08-31", expected_version: 1 },
    });
    assert.equal(create.status(), 201, await create.text());
    const issue = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/issue`, {
      headers: mutationHeaders(),
      data: { expected_version: 1 },
    });
    assert.equal(issue.status(), 200, await issue.text());
    const rfqLines = (await pool.query(
      "select id::int,material_id::int from procurement_rfq_lines where rfq_id=1 order by line_no",
    )).rows;
    assert.deepEqual(rfqLines.map(({ material_id }) => material_id), MATERIAL_IDS);
    const quoteBody = ({ supplierId, expectedVersion, reference, price, promisedDate }) => ({
      expected_version: expectedVersion,
      supplier_id: supplierId,
      supplier_quote_reference: reference,
      valid_until: "2026-09-30",
      tax_included: false,
      freight_included: false,
      payment_terms: "月结 30 天",
      lines: rfqLines.map(({ id }) => ({
        rfq_line_id: id,
        quoted_quantity: "10.000000",
        minimum_order_quantity: "10.000000",
        unit_price: price,
        lead_time_days: 75,
        promised_delivery_date: promisedDate,
      })),
    });
    const quoteAResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: mutationHeaders(),
      data: quoteBody({
        supplierId: 1,
        expectedVersion: 2,
        reference: "UAT-Q-A-042576",
        price: "12.000000",
        promisedDate: "2026-10-20",
      }),
    });
    assert.equal(quoteAResponse.status(), 201, await quoteAResponse.text());
    const quoteBResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/quotes`, {
      headers: mutationHeaders(),
      data: quoteBody({
        supplierId: 2,
        expectedVersion: 3,
        reference: "UAT-Q-B-042576",
        price: "10.000000",
        promisedDate: "2026-11-05",
      }),
    });
    assert.equal(quoteBResponse.status(), 201, await quoteBResponse.text());
    const comparisonResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1/comparisons`, {
      headers: mutationHeaders(),
      data: { expected_version: 4 },
    });
    const comparisonText = await comparisonResponse.text();
    assert.equal(comparisonResponse.status(), 201, comparisonText);
    const comparison = JSON.parse(comparisonText);
    assert.equal(comparison.comparison_version_no, 1);

    const databaseBaseline = (await pool.query(`select
      (select count(*)::int from procurement_quote_comparisons where rfq_id=1) comparison_lines,
      (select count(*)::int from procurement_quote_comparison_lines line
        join procurement_quote_comparisons comparison on comparison.id=line.comparison_id
        where comparison.rfq_id=1) comparison_candidates,
      (select count(*)::int from procurement_sourcing_events
        where rfq_id=1 and event_type='COMPARISON_GENERATED') comparison_events,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select version::int from procurement_rfqs where id=1) rfq_version`)).rows[0];
    assert.deepEqual(databaseBaseline, {
      comparison_lines: 4,
      comparison_candidates: 8,
      comparison_events: 4,
      awards: 0,
      purchase_orders: 0,
      rfq_version: 5,
    });

    const aggregateResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1`);
    assert.equal(aggregateResponse.status(), 200);
    const aggregate = (await aggregateResponse.json()).data.comparison_read_model;
    assert.equal(aggregate.has_independent_header_id, false);
    assert.equal(aggregate.comparison_header_id, null);
    assert.equal(aggregate.current_version.comparison_version_no, 1);
    assert.equal(aggregate.current_version.status, "CURRENT");
    assert.equal(aggregate.current_version.persisted_status, false);
    assert.equal(aggregate.current_version.quote_inputs_current, true);
    assert.equal(aggregate.current_version.input_drift, false);
    assert.equal(aggregate.current_version.comparison_rows.length, 4);
    assert.equal(aggregate.current_version.fixed_quote_inputs.length, 8);
    assert.equal(aggregate.current_version.output_summary.canonical_rows.length, 8);
    assert.match(aggregate.current_version.output_summary.digest, /^[0-9a-f]{64}$/);
    assert.equal(aggregate.current_version.operation_receipts.length, 1);
    assert.equal(aggregate.current_version.operation_receipts[0].event_count, 4);
    assert.deepEqual(
      aggregate.current_version.supplier_summaries.map((row) => ({
        supplier_id: row.supplier_id,
        quote: `${row.quote_id}/v${row.quote_version_no}`,
        reference: row.supplier_quote_reference,
        total: row.total_amount,
        promised: row.latest_promised_delivery_date,
        delivery_status: row.delivery_status,
        delivery_days: row.delivery_delta_days,
      })),
      [
        { supplier_id: "1", quote: "1/v1", reference: "UAT-Q-A-042576", total: "480.000000", promised: "2026-10-20", delivery_status: "ON_TIME", delivery_days: 10 },
        { supplier_id: "2", quote: "2/v1", reference: "UAT-Q-B-042576", total: "400.000000", promised: "2026-11-05", delivery_status: "LATE", delivery_days: 6 },
      ],
    );
    assert.deepEqual(aggregate.current_version.aggregate_differences, {
      higher_supplier_id: "1",
      lower_supplier_id: "2",
      amount_difference: "80.000000",
      percentage_basis_supplier_id: "2",
      percentage_difference: "20.000000",
      earlier_supplier_id: "1",
      later_supplier_id: "2",
      delivery_day_difference: 16,
      lowest_price_supplier_id: "2",
      on_time_supplier_ids: ["1"],
      late_risk_supplier_ids: ["2"],
    });
    assert.equal(aggregate.generation.enabled, false);
    assert.equal(aggregate.generation.label, "当前Quote输入已生成最新比价");

    const businessRequests = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method().toUpperCase())
        && !['/api/logout'].includes(url.pathname)) {
        businessRequests.push({ method: request.method(), path: url.pathname });
      }
      return route.continue();
    });
    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing/1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    await page.getByRole("heading", { name: "服务端横向比价", exact: true }).waitFor();
    await page.locator(".comparison-trace > summary").click();
    const desktopText = await page.locator(".comparison-aggregate").innerText();
    for (const required of [
      "ID 1 / RFQ-00000001", "Round 1", "Comparison Version", "v1",
      "CURRENT / 当前比价版本", "状态为服务端读模型投影，不是独立数据库状态列。",
      "未设置独立Comparison Header ID；版本身份由RFQ、Round、Comparison Version及basis_digest共同确定。",
      "Quote ID 1 / v1", "Quote ID 2 / v1", "UAT-Q-A-042576", "UAT-Q-B-042576",
      "480.00 CNY", "400.00 CNY", "高 80.00 CNY", "高 20%", "早 16 天",
      "2026-10-20", "2026-11-05", "ON_TIME", "LATE", "提前10天", "延期6天",
      "未税 / 不含运费", "月结 30 天", "比价不等于定标；不自动产生Award。",
    ]) assert.ok(desktopText.includes(required), `Comparison aggregate missing: ${required}`);
    for (const row of aggregate.current_version.comparison_rows) {
      assert.match(row.basis_digest, /^[0-9a-f]{64}$/);
      assert.ok(desktopText.includes(row.basis_digest), `full basis_digest missing for Comparison Line ${row.comparison_line_id}`);
    }
    assert.ok(desktopText.includes(aggregate.current_version.output_summary.digest), "deterministic output digest missing");
    assert.equal(await page.locator(".comparison-supplier-card").count(), 2);
    assert.equal(await page.locator(".comparison-desktop tbody tr").count(), 4);
    assert.equal(await page.locator(".comparison-material-card").count(), 4);
    assert.equal(await page.locator(".comparison-operation").count(), 1);
    assert.match(await page.locator(".comparison-operation").innerText(), /Event数量\s*4条Line级Event/);
    assert.equal(await page.locator(".comparison-operation li").count(), 4);
    assert.equal(await page.getByRole("button", { name: "当前Quote输入已生成最新比价", exact: true }).isDisabled(), true);
    await page.getByRole("heading", { name: "人工定标", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).isVisible(), true);
    assert.equal(await page.locator(".comparison-desktop").isVisible(), true);
    assert.equal(await page.locator(".comparison-material-cards").isVisible(), false);
    await noOverflow(page, "Comparison aggregate desktop");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "服务端横向比价", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "当前Quote输入已生成最新比价", exact: true }).isDisabled(), true);
    assert.deepEqual(businessRequests, []);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator(".comparison-desktop").isVisible(), false);
    assert.equal(await page.locator(".comparison-material-cards").isVisible(), true);
    assert.equal(await page.locator(".comparison-material-card").count(), 4);
    assert.equal(await page.locator(".comparison-supplier-card").count(), 2);
    assert.equal(await page.getByRole("button", { name: "当前Quote输入已生成最新比价", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).isVisible(), true);
    await noOverflow(page, "Comparison aggregate 390x844");
    assert.deepEqual(businessRequests, []);

    assert.deepEqual((await pool.query(`select
      (select count(*)::int from procurement_quote_comparisons where rfq_id=1) comparison_lines,
      (select count(*)::int from procurement_quote_comparison_lines line
        join procurement_quote_comparisons comparison on comparison.id=line.comparison_id
        where comparison.rfq_id=1) comparison_candidates,
      (select count(*)::int from procurement_sourcing_events
        where rfq_id=1 and event_type='COMPARISON_GENERATED') comparison_events,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select version::int from procurement_rfqs where id=1) rfq_version`)).rows[0], databaseBaseline);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "安全退出", exact: true }).click();
    await page.getByRole("heading", { name: "欢迎使用晨亿达 ERP", exact: true }).waitFor();
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    await context.close();
    console.info("RFQ_COMPARISON_AGGREGATE_BROWSER_OK rfq=1 comparison_version=1 comparison_lines=4 candidates=8 events=4 desktop=1 mobile=1 business_post=0 award=0 po=0 session=0");
  } finally {
    await browser?.close().catch(() => undefined);
  }
});

test("isolated Chromium enforces the FIX-31 Award confirmation and immutable history contract", { timeout: 300_000 }, async () => {
  await clearSyntheticData();
  const fixture = await seedFixture({ targetDate: "2026-10-30", materialDefinitions: FIX29_MATERIAL_DEFINITIONS });
  const isolatedAwardReason = `${FIX29_AWARD_REASON}\n${"长理由布局验收：保持完整换行、自动折行且不截断。".repeat(24)}`;
  assert.ok(isolatedAwardReason.length <= 1000);
  const chromium = await loadChromium();
  let browser;
  let context;
  let csrfToken = "";
  let authenticated = false;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await login(page, fixture.credentials);
    const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
    assert.ok(session.authenticated && session.csrf_token);
    csrfToken = session.csrf_token;
    authenticated = true;
    const { current } = await createFix29CurrentComparison(context, csrfToken);

    const beforeAward = (await pool.query(`select
      (select status from procurement_rfqs where id=1) rfq_status,
      (select version::int from procurement_rfqs where id=1) rfq_version,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines award_line
        join procurement_sourcing_awards award on award.id=award_line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
    assert.deepEqual(beforeAward, { rfq_status: "ISSUED", rfq_version: 5, awards: 0, award_lines: 0, purchase_orders: 0 });

    const businessRequests = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
      const method = request.method().toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && url.pathname !== "/api/logout") {
        let body = null;
        try { body = request.postDataJSON(); } catch { body = request.postData(); }
        businessRequests.push({ method, path: url.pathname, body });
      }
      return route.continue();
    });

    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing/1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
    await page.getByRole("heading", { name: "人工定标", exact: true }).waitFor();
    const form = page.locator("form.award-selection-form");
    await form.waitFor();
    assert.equal(await form.locator("fieldset.award-candidate-fieldset").count(), 4);
    assert.equal(await form.locator("select.award-candidate-select").count(), 4);
    const expectedCandidatePairs = [["1", "2"], ["3", "4"], ["5", "6"], ["7", "8"]];
    for (const [index, [supplierB, supplierA]] of expectedCandidatePairs.entries()) {
      const lineId = String(index + 1);
      const select = form.locator(`select.award-candidate-select[name="candidate_${lineId}"]`);
      assert.equal(await select.getAttribute("data-candidate-count"), "2");
      assert.equal(await select.inputValue(), "", `Line ${lineId} must initially select 请选择`);
      const options = await select.locator("option").evaluateAll((items) => items.map((option) => ({ value: option.value, label: option.textContent?.trim() || "" })));
      assert.deepEqual(options.map(({ value }) => value), ["", supplierB, supplierA]);
      for (const required of ["SUP-000002", "FIX-22 低价供应商 B", `Candidate ID ${supplierB}`, "Quote ID 2/v1", "单价 10.00 CNY", "行金额 100.00 CNY", "承诺日期 2026-11-05", "LATE / 延期6天", "价格排名1"]) {
        assert.ok(options[1].label.includes(required), `Line ${lineId} Supplier B option missing ${required}`);
      }
      for (const required of ["SUP-000001", "FIX-22 快速交付供应商 A", `Candidate ID ${supplierA}`, "Quote ID 1/v1", "单价 12.00 CNY", "行金额 120.00 CNY", "承诺日期 2026-10-20", "ON_TIME / 提前10天", "价格排名2"]) {
        assert.ok(options[2].label.includes(required), `Line ${lineId} Supplier A option missing ${required}`);
      }
      await select.selectOption(supplierB);
      assert.equal(await select.inputValue(), supplierB, `Line ${lineId} Supplier B must be selectable`);
    }
    assert.deepEqual(businessRequests, [], "local Supplier B selections must send zero business requests");
    for (const [index, [, supplierA]] of expectedCandidatePairs.entries()) {
      const select = form.locator(`select.award-candidate-select[name="candidate_${index + 1}"]`);
      await select.selectOption(supplierA);
      assert.equal(await select.inputValue(), supplierA, `Line ${index + 1} Supplier A must be selectable`);
    }
    await form.locator('select[name="reason_code"]').selectOption("DELIVERY_PRIORITY");
    await form.locator('textarea[name="reason"]').fill(isolatedAwardReason);

    await form.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).click();
    let dialog = page.locator(".rfq-dialog.award-confirm-dialog[role=dialog]");
    await dialog.getByRole("heading", { name: "正式定标确认", exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
    assert.deepEqual(await dialog.locator("article[data-selected-candidate-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-selected-candidate-id"))), ["2", "4", "6", "8"]);
    assert.deepEqual(await dialog.locator(".award-confirm-quotes article").evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-supplier-id"), row.getAttribute("data-quote-id")])), [["1", "1"], ["2", "2"]]);
    const desktopText = await dialog.innerText();
    for (const required of [
      "ID 1 / RFQ-00000001", "Round 1 / v5", "v1 / CURRENT", "awardable_now", "true",
      "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec", current.request_id,
      ...current.comparison_rows.map((row) => row.basis_digest),
      ...FIX29_MATERIAL_DEFINITIONS.flatMap(({ id, code }) => [String(id), code]),
      "Supplier A", "Supplier ID 1 / SUP-000001", "Quote ID 1/v1", "UAT-Q-A-042576", "480.00 CNY", "2026-10-20", "ON_TIME / 提前10天",
      "Supplier B", "Supplier ID 2 / SUP-000002", "Quote ID 2/v1", "UAT-Q-B-042576", "400.00 CNY", "2026-11-05", "LATE / 延期6天",
      "本次确认只创建一次不可变Award操作，并在该操作下创建恰好四条Award Line。", "Award操作", "Award Line", "四条均为Supplier A", "不拆分数量",
      "Comparison Line 1", "Comparison Line 2", "Comparison Line 3", "Comparison Line 4",
      "Candidate ID 2", "Candidate ID 4", "Candidate ID 6", "Candidate ID 8", "Quote ID 1 / v1",
      "12.00 CNY", "120.00 CNY", "2026-10-20", "ON_TIME / 提前10天", "价格排名 2 / 非最低价",
      "SUP-000001 · FIX-22 快速交付供应商 A", "SUP-000002 · FIX-22 低价供应商 B",
      "480.00 CNY", "400.00 CNY", "80.00 CNY / 20%", "LATE / 延期6天",
      "SUP-000001 比 SUP-000002 早 16 天。",
      "DELIVERY_PRIORITY / 交期优先", isolatedAwardReason,
      "不修改RFQ已冻结范围", "不修改Quote ID 1/v1", "不修改Quote ID 2/v1", "不修改Comparison Version 1",
      "不修改Comparison Line或Candidate", "不修改Binding或Mapping",
      "PO", "Delivery Plan", "Receipt／收货", "Inventory Ledger／库存流水", "AP／采购应付", "Work Order／生产工单", "其他生产记录", "其他财务记录",
      "下一业务阶段：通过独立的‘定标转PO与到货计划’任务，将已生效Award转换为采购订单及到货计划。本次定标不会自动执行该阶段。",
      "具体处理人：未指定", "处理时限：未配置",
    ]) assert.ok(desktopText.includes(required), `desktop Award confirmation missing ${required}`);
    assert.equal(await dialog.getByRole("button", { name: "最终确认并创建 Award", exact: true }).isVisible(), true);
    await noOverflow(page, "FIX-29 Award confirmation desktop");
    await noDialogOverflow(dialog, "FIX-29 Award confirmation desktop");
    assert.deepEqual(businessRequests, [], "opening confirmation must send zero business requests");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(businessRequests, [], "cancelling confirmation must send zero business requests");
    assert.deepEqual((await pool.query(`select
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines award_line join procurement_sourcing_awards award on award.id=award_line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0], { awards: 0, award_lines: 0, purchase_orders: 0 });

    await form.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).click();
    dialog = page.locator(".rfq-dialog.award-confirm-dialog[role=dialog]");
    await dialog.getByRole("heading", { name: "正式定标确认", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "关闭定标确认窗口", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(businessRequests, [], "closing confirmation must send zero business requests");

    await form.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).click();
    dialog = page.locator(".rfq-dialog.award-confirm-dialog[role=dialog]");
    await dialog.getByRole("heading", { name: "正式定标确认", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(businessRequests, [], "Escape from confirmation must send zero business requests");
    await form.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).click();
    dialog = page.locator(".rfq-dialog.award-confirm-dialog[role=dialog]");
    await dialog.getByRole("heading", { name: "正式定标确认", exact: true }).waitFor();
    await page.locator(".rfq-dialog-backdrop").dispatchEvent("mousedown");
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(businessRequests, [], "backdrop exit from confirmation must send zero business requests");

    await page.setViewportSize({ width: 390, height: 844 });
    await form.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).click();
    dialog = page.locator(".rfq-dialog.award-confirm-dialog[role=dialog]");
    await dialog.getByRole("heading", { name: "正式定标确认", exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
    const mobileText = await dialog.innerText();
    for (const required of ["RFQ-00000001", "v1 / CURRENT", "Quote ID 1/v1", "Quote ID 2/v1", "Candidate ID 2", "Candidate ID 8",
      "SUP-000001 · FIX-22 快速交付供应商 A", "SUP-000002 · FIX-22 低价供应商 B",
      "480.00 CNY", "400.00 CNY", "80.00 CNY / 20%", "SUP-000001 比 SUP-000002 早 16 天。",
      "本次确认只创建一次不可变Award操作，并在该操作下创建恰好四条Award Line。", "Inventory Ledger／库存流水", "Work Order／生产工单",
      "下一业务阶段：通过独立的‘定标转PO与到货计划’任务", "DELIVERY_PRIORITY / 交期优先", isolatedAwardReason]) {
      assert.ok(mobileText.includes(required), `mobile Award confirmation missing ${required}`);
    }
    await noOverflow(page, "FIX-29 Award confirmation 390x844");
    await noDialogOverflow(dialog, "FIX-29 Award confirmation 390x844");
    assert.deepEqual(businessRequests, [], "mobile confirmation must remain zero-write before final confirmation");

    const awardResponsePromise = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs/1/award`
      && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "最终确认并创建 Award", exact: true }).evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("Award confirmation control is not a button");
      button.click();
      button.click();
    });
    const awardResponse = await awardResponsePromise;
    const awardPayload = await awardResponse.json();
    assert.equal(awardResponse.status(), 201, JSON.stringify(awardPayload));
    assert.deepEqual({
      award_id: awardPayload.award_id,
      rfq_id: awardPayload.rfq_id,
      status: awardPayload.status,
      reason_code: awardPayload.reason_code,
      comparison_version_no: awardPayload.comparison_version_no,
      award_line_count: awardPayload.award_line_count,
      rfq_version: awardPayload.rfq_version,
      purchase_order_created: awardPayload.purchase_order_created,
    }, {
      award_id: 1,
      rfq_id: 1,
      status: "AWARDED",
      reason_code: "DELIVERY_PRIORITY",
      comparison_version_no: 1,
      award_line_count: 4,
      rfq_version: 6,
      purchase_order_created: false,
    });
    await dialog.waitFor({ state: "detached" });
    await page.getByText("人工定标已形成一个不可变 Sourcing Award；没有产生采购订单或其他下游记录", { exact: true }).waitFor();
    assert.equal(businessRequests.length, 1, "final confirmation must send exactly one business request");
    assert.equal(businessRequests[0].method, "POST");
    assert.equal(businessRequests[0].path, "/api/procurement/rfqs/1/award");
    assert.deepEqual({
      expected_version: businessRequests[0].body.expected_version,
      expected_rfq_code: businessRequests[0].body.expected_rfq_code,
      expected_round_no: businessRequests[0].body.expected_round_no,
      expected_comparison_version: businessRequests[0].body.expected_comparison_version,
      expected_comparison_output_digest: businessRequests[0].body.expected_comparison_output_digest,
      reason_code: businessRequests[0].body.reason_code,
      reason: businessRequests[0].body.reason,
      selected_candidates: businessRequests[0].body.lines.map((line) => line.selected_candidate_id),
      rfq_line_ids: businessRequests[0].body.lines.map((line) => line.rfq_line_id),
      comparison_line_ids: businessRequests[0].body.lines.map((line) => line.comparison_line_id),
      quote_ids: businessRequests[0].body.lines.map((line) => line.expected_quote_id),
      quote_versions: businessRequests[0].body.lines.map((line) => line.expected_quote_version_no),
    }, {
      expected_version: 5,
      expected_rfq_code: "RFQ-00000001",
      expected_round_no: 1,
      expected_comparison_version: 1,
      expected_comparison_output_digest: "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec",
      reason_code: "DELIVERY_PRIORITY",
      reason: isolatedAwardReason,
      selected_candidates: ["2", "4", "6", "8"],
      rfq_line_ids: ["1", "2", "3", "4"],
      comparison_line_ids: ["1", "2", "3", "4"],
      quote_ids: ["1", "1", "1", "1"],
      quote_versions: [1, 1, 1, 1],
    });
    assert.ok(businessRequests[0].body.lines.every((line) => typeof line.selected_candidate_id === "string"
      && typeof line.rfq_line_id === "string" && typeof line.comparison_line_id === "string"
      && typeof line.expected_quote_id === "string" && /^[0-9a-f]{64}$/.test(line.comparison_basis_digest)));

    const awardState = (await pool.query(`select
      (select status from procurement_rfqs where id=1) rfq_status,
      (select version::int from procurement_rfqs where id=1) rfq_version,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines award_line join procurement_sourcing_awards award on award.id=award_line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='AWARDED') award_events,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select count(*)::int from purchase_delivery_plans) delivery_plans,
      (select count(*)::int from purchase_receipts) receipts`)).rows[0];
    assert.deepEqual(awardState, {
      rfq_status: "CLOSED", rfq_version: 6, awards: 1, award_lines: 4, award_events: 1,
      purchase_orders: 0, delivery_plans: 0, receipts: 0,
    });
    const awardLines = (await pool.query(`select award_line.rfq_line_id::text rfq_line_id,
        award_line.comparison_id::text comparison_line_id,candidate.id::text candidate_id,
        quote.id::text quote_id,quote.quote_version_no::int quote_version_no,
        award_line.supplier_id::text supplier_id,award_line.selected_quantity::text selected_quantity,
        award_line.selected_unit_price::text selected_unit_price,award.reason_code,award.reason
      from procurement_sourcing_award_lines award_line
      join procurement_sourcing_awards award on award.id=award_line.award_id
      join procurement_quote_comparison_lines candidate on candidate.comparison_id=award_line.comparison_id
        and candidate.quote_line_id=award_line.selected_quote_line_id
      join procurement_supplier_quote_lines quote_line on quote_line.id=award_line.selected_quote_line_id
      join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
      where award.rfq_id=1 order by award_line.rfq_line_id`)).rows;
    assert.deepEqual(awardLines.map((line) => ({
      rfq_line_id: line.rfq_line_id,
      comparison_line_id: line.comparison_line_id,
      candidate_id: line.candidate_id,
      quote_id: line.quote_id,
      quote_version_no: line.quote_version_no,
      supplier_id: line.supplier_id,
      selected_quantity: line.selected_quantity,
      selected_unit_price: line.selected_unit_price,
      reason_code: line.reason_code,
      reason: line.reason,
    })), ["1", "2", "3", "4"].map((lineId, index) => ({
      rfq_line_id: lineId,
      comparison_line_id: lineId,
      candidate_id: String((index + 1) * 2),
      quote_id: "1",
      quote_version_no: 1,
      supplier_id: "1",
      selected_quantity: "10.000000",
      selected_unit_price: "12.000000",
      reason_code: "DELIVERY_PRIORITY",
      reason: isolatedAwardReason,
    })));

    const historyResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/procurement/rfqs/1`);
    assert.equal(historyResponse.status(), 200);
    const awardedDetail = (await historyResponse.json()).data;
    const history = awardedDetail.award_history;
    assert.ok(history, "Award history server read model must exist after Award");
    assert.deepEqual({
      award_id: history.identity.award_id,
      display_identity: history.identity.display_identity,
      business_number: history.identity.business_number,
      has_business_number: history.identity.has_business_number,
      version: history.identity.version,
      has_version: history.identity.has_version,
      status: history.identity.status,
      rfq_id: history.identity.rfq_id,
      rfq_code: history.identity.rfq_code,
      round_no: history.identity.round_no,
      submitted_cas: history.identity.rfq_submitted_cas,
      current_cas: history.identity.rfq_current_cas,
      comparison_version: history.identity.comparison_version_no,
      comparison_status: history.identity.comparison_status,
      comparison_output_digest: history.identity.comparison_output_digest,
    }, {
      award_id: "1", display_identity: "定标 #1", business_number: null, has_business_number: false,
      version: 1, has_version: true, status: "AWARDED", rfq_id: "1", rfq_code: "RFQ-00000001",
      round_no: 1, submitted_cas: 5, current_cas: 6, comparison_version: 1,
      comparison_status: "CURRENT",
      comparison_output_digest: "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec",
    });
    assert.deepEqual(history.fixed_quotes.map((quote) => `${quote.quote_id}/v${quote.quote_version_no}`), ["1/v1", "2/v1"]);
    assert.deepEqual(history.lines.map((line) => ({
      award_line_id: line.award_line_id,
      comparison_line_id: line.comparison_line_id,
      candidate_id: line.comparison_candidate_id,
      quote_line_id: line.quote_line_id,
      quote: `${line.quote_id}/v${line.quote_version_no}`,
      supplier_id: line.supplier_id,
      material_id: line.material_id,
      quantity: line.selected_quantity,
      unit_price: line.selected_unit_price,
      amount: line.line_amount,
    })), ["1", "2", "3", "4"].map((lineId, index) => ({
      award_line_id: lineId,
      comparison_line_id: lineId,
      candidate_id: String((index + 1) * 2),
      quote_line_id: lineId,
      quote: "1/v1",
      supplier_id: "1",
      material_id: String(533 + index),
      quantity: "10.000000",
      unit_price: "12.000000",
      amount: "120.000000",
    })));
    assert.deepEqual(history.summary.supplier_summaries.map((supplier) => ({
      supplier_id: supplier.supplier_id,
      lines: supplier.award_line_count,
      total: supplier.total_amount,
    })), [{ supplier_id: "1", lines: 4, total: "480.000000" }, { supplier_id: "2", lines: 0, total: "0.000000" }]);
    assert.equal(history.summary.split_award_lines, false);
    assert.equal(history.summary.duplicate_material, false);
    assert.match(history.persisted_award_digest.value, /^[0-9a-f]{64}$/);
    assert.match(history.decision_digest.value, /^[0-9a-f]{64}$/);
    assert.notEqual(history.decision_digest.value, history.persisted_award_digest.value);
    assert.equal(history.decision_digest.persisted, false);
    assert.equal(history.decision_digest.canonical_rule, "AWARD_DECISION_V1");
    assert.deepEqual({
      event_count: history.operation_receipt.event_count,
      operation_count: history.operation_receipt.user_operation_count,
      award_line_count: history.operation_receipt.award_line_count,
      event_type: history.operation_receipt.event_type,
      result: history.operation_receipt.result,
      event_transition: history.operation_receipt.version_transition_recorded,
      event_old: history.operation_receipt.event_old_version,
      event_new: history.operation_receipt.event_new_version,
      cas_authority: history.operation_receipt.cas_evidence.authority,
      cas_old: history.operation_receipt.cas_evidence.old_version,
      cas_audit_new: history.operation_receipt.cas_evidence.audit_new_version,
      cas_new: history.operation_receipt.cas_evidence.new_version,
    }, {
      event_count: 1, operation_count: 1, award_line_count: 4, event_type: "AWARDED", result: "SUCCESS",
      event_transition: false, event_old: null, event_new: null,
      cas_authority: "EXACT_SUCCESS_AUDIT", cas_old: 5, cas_audit_new: 6, cas_new: 6,
    });
    assert.deepEqual({
      comparison_status: history.projections.comparison_status,
      awardable_now: history.projections.awardable_now,
      po_convertible_now: history.projections.po_convertible_now,
      po_count: history.projections.po_count,
    }, { comparison_status: "CURRENT", awardable_now: false, po_convertible_now: true, po_count: 0 });
    assert.equal(awardedDetail.comparison_read_model.current_version.awardable_now, false);

    await page.getByRole("heading", { name: "定标 #1", exact: true }).waitFor();
    assert.equal(await page.locator("form.award-selection-form").count(), 0, "Award form must disappear after Award");
    assert.equal(await page.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).count(), 0);
    assert.equal(await page.locator(".award-confirm-dialog").count(), 0);
    assert.equal(await page.getByRole("button", { name: /撤销|转PO|采购订单/ }).count(), 0);
    const historyText = await page.locator(".award-history").innerText();
    for (const required of [
      "Award稳定数据库ID", "未设置独立Award业务编号。", "Award有独立Version字段", "AWARDED",
      "RFQ-00000001", "Round 1", "v5", "v6", "v1", "CURRENT",
      "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec",
      "Quote ID 1 / v1", "Quote ID 2 / v1", "Supplier A", "Supplier B",
      "Award Line ID 1", "Award Line ID 2", "Award Line ID 3", "Award Line ID 4",
      "Candidate ID 2", "Candidate ID 4", "Candidate ID 6", "Candidate ID 8",
      "Quote Line ID 1", "Quote Line ID 2", "Quote Line ID 3", "Quote Line ID 4",
      "Material ID 533", "Material ID 534", "Material ID 535", "Material ID 536",
      "480.00 CNY", "0.00 CNY", "Award Line 0", "无拆单", "无重复Material",
      "DELIVERY_PRIORITY", isolatedAwardReason, "AWARD_DECISION_V1",
      "确定性决策摘要，由不可变Award事实重算；不是伪造的历史持久化字段。",
      "Event数量", "用户操作次数", "AWARDED", "SUCCESS", "历史Award Event未记录版本转换。",
      "Audit独立记录同一次请求的RFQ CAS；它不是Award Event字段。",
      "awardable_now", "false", "Comparison仍是当前版本，但RFQ已完成定标，不可再次创建Award。",
      "po_convertible_now", "true", "本页只显示资格，不提供链接、按钮或业务POST。",
    ]) assert.ok(historyText.includes(required), `Award history missing: ${required}`);
    assert.equal(historyText.includes("vnull"), false);
    assert.equal((await page.locator("body").innerText()).includes("允许进入定标"), false);
    assert.equal(await page.locator(".award-history-desktop").isVisible(), false);
    assert.equal(await page.locator(".award-history-mobile").isVisible(), true);
    assert.equal(await page.locator(".award-history-mobile [data-award-line-id]").count(), 4);
    assert.deepEqual(await page.locator(".award-history-mobile [data-award-line-id]").evaluateAll(
      (rows) => rows.map((row) => row.getAttribute("data-award-line-id")),
    ), ["1", "2", "3", "4"]);
    await noOverflow(page, "FIX-31 Award history 390x844");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "定标 #1", exact: true }).waitFor();
    assert.equal(await page.locator("form.award-selection-form").count(), 0);
    assert.ok((await page.locator(".award-history").innerText()).includes(history.decision_digest.value));
    assert.deepEqual(await page.locator(".award-history-mobile [data-award-line-id]").evaluateAll(
      (rows) => rows.map((row) => row.getAttribute("data-award-line-id")),
    ), ["1", "2", "3", "4"]);
    assert.equal((await page.locator("body").innerText()).includes("允许进入定标"), false);
    assert.equal(businessRequests.length, 1, "refreshing immutable history must not send another business request");
    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing`, { waitUntil: "domcontentloaded" });
    await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing/1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "定标 #1", exact: true }).waitFor();
    assert.ok((await page.locator(".award-history").innerText()).includes(history.decision_digest.value));
    assert.deepEqual(await page.locator(".award-history-mobile [data-award-line-id]").evaluateAll(
      (rows) => rows.map((row) => row.getAttribute("data-award-line-id")),
    ), ["1", "2", "3", "4"]);
    assert.equal((await page.locator("body").innerText()).includes("允许进入定标"), false);
    assert.equal(businessRequests.length, 1, "reopening immutable history must remain read-only");

    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await page.locator(".award-history-desktop").isVisible(), true);
    assert.equal(await page.locator(".award-history-mobile").isVisible(), false);
    assert.equal(await page.locator(".award-history-desktop tbody tr").count(), 4);
    assert.deepEqual(await page.locator(".award-history-desktop tbody tr[data-award-line-id]").evaluateAll(
      (rows) => rows.map((row) => row.getAttribute("data-award-line-id")),
    ), ["1", "2", "3", "4"]);
    assert.ok((await page.locator(".award-history").innerText()).includes(history.decision_digest.value));
    assert.equal((await page.locator("body").innerText()).includes("允许进入定标"), false);
    await noOverflow(page, "FIX-31 Award history desktop");
    assert.equal(businessRequests.length, 1, "Award history must add zero business POST requests");
    assert.deepEqual(businessRequests.map(({ method, path }) => ({ method, path })), [
      { method: "POST", path: "/api/procurement/rfqs/1/award" },
    ]);
    assert.equal(businessRequests.filter(({ path }) => /purchase-orders|delivery-plans|convert/i.test(path)).length, 0);
    assert.deepEqual((await pool.query(`select
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines line
        join procurement_sourcing_awards award on award.id=line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='AWARDED') award_events,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0], {
      awards: 1, award_lines: 4, award_events: 1, purchase_orders: 0,
    });

    const logout = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
      headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": csrfToken },
    });
    assert.equal(logout.status(), 200);
    authenticated = false;
    assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    await context.close();
    context = undefined;
    console.info("RFQ_AWARD_HISTORY_FIX31_BROWSER_OK rfq=1 comparison_version=1 candidates=8 selected=2,4,6,8 pre_award_post=0 award_post=1 history_post=0 award=1 award_line=4 po=0 desktop=1 mobile=1 refresh=1 reopen=1 session=0");
  } finally {
    if (authenticated && context && csrfToken) {
      await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": csrfToken },
      }).catch(() => undefined);
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
});

test("isolated Chromium enforces the FIX-32 Award to PO two-stage confirmation contract", { timeout: 300_000 }, async () => {
  await clearSyntheticData();
  const fixture = await seedFixture({ targetDate: "2026-10-30", materialDefinitions: FIX29_MATERIAL_DEFINITIONS });
  const chromium = await loadChromium();
  let browser;
  let context;
  let csrfToken = "";
  let authenticated = false;
  let releaseDelayedPreview = () => {};
  let releaseFailedConversionPost = () => {};
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    await login(page, fixture.credentials);
    const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
    assert.ok(session.authenticated && session.csrf_token);
    csrfToken = session.csrf_token;
    authenticated = true;
    const { detail } = await createFix29CurrentComparison(context, csrfToken);
    const awarded = await createFix32Award(context, csrfToken, detail);
    const history = awarded.award_history;
    const upstreamBefore = await fix32UpstreamState();
    const zeroConversionState = {
      purchase_orders: 0,
      purchase_order_lines: 0,
      purchase_order_events: 0,
      award_links: 0,
      delivery_plans: 0,
      receiving_queue_entries: 0,
      delivery_plan_events: 0,
      receipts: 0,
      ledger_entries: 0,
      quality_inspections: 0,
      ap_documents: 0,
      payments: 0,
      work_orders: 0,
      conversion_audits: 0,
    };
    assert.deepEqual(await fix32ConversionState(), zeroConversionState);

    const businessPosts = [];
    const previewGets = [];
    const historyGets = [];
    const conversionPreviews = [];
    let latestConversionPreview;
    const expectedQualificationLineage = MATERIAL_IDS.map((materialId, index) => ({
      award_line_id: String(index + 1),
      candidate_id: String((index + 1) * 2),
      quote_line_id: String(index + 1),
      rfq_binding_id: String(index + 1),
      supplier_id: "1",
      material_id: String(materialId),
      mapping_uuid: MAPPING_UIDS[0][index],
      mapping_fact_id: String(index + 1),
      mapping_version_no: 1,
      mapping_row_cas: 1,
    }));
    const assertQualificationPreview = (preview) => {
      assert.equal(preview.contract_version, "AWARD_PO_CONFIRMATION_V2");
      assert.equal(preview.po_convertible_now, true);
      const qualification = preview.mapping_qualification;
      assert.ok(qualification);
      assert.equal(qualification.contract_version, "AWARD_PO_MAPPING_QUALIFICATION_V1");
      assert.match(qualification.observed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      assert.equal(qualification.data_timezone, "Asia/Shanghai");
      assert.match(qualification.qualification_digest, /^[0-9a-f]{64}$/);
      assert.equal(qualification.all_qualified, true);
      assert.equal(qualification.qualified_line_count, 4);
      assert.equal(qualification.line_count, 4);
      assert.equal(qualification.lines.length, 4);
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
      })), expectedQualificationLineage);
      for (const [index, line] of qualification.lines.entries()) {
        const materialId = MATERIAL_IDS[index];
        assert.equal(line.supplier_code, "SUP-000001");
        assert.equal(line.binding_status, "ACTIVE");
        assert.equal(line.mapping_status, "ACTIVE");
        assert.equal(line.supplier_status, "ACTIVE");
        assert.equal(line.material_status, "ACTIVE");
        assert.equal(line.supplier_part_number, `SUP-000001-${materialId}`);
        assert.equal(line.supplier_unit_id, "1");
        assert.equal(line.supplier_unit_code, "PCS");
        assert.equal(line.internal_unit_id, "1");
        assert.equal(line.internal_unit_code, "PCS");
        assert.equal(line.conversion_numerator, "1");
        assert.equal(line.conversion_denominator, "1");
        assert.match(line.valid_from, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(line.valid_to, null);
        assert.equal(line.content_digest, mappingContentDigest("SUP-000001", materialId, MAPPING_UIDS[0][index]));
        assert.equal(line.supplier_material_conflict_count, 0);
        assert.equal(line.supplier_part_number_conflict_count, 0);
        assert.equal(line.qualified, true);
        assert.equal(line.error_code, null);
        assert.equal(line.reason, "Supplier Mapping资格通过");
      }
      assert.equal(preview.confirmation.expected_decision_digest, preview.digests.decision_digest);
      assert.equal(preview.confirmation.expected_mapping_qualification_digest, qualification.qualification_digest);
      return qualification;
    };
    const assertQualificationCredential = async (dialog, mode) => {
      const qualification = latestConversionPreview.mapping_qualification;
      const desktop = dialog.locator(".award-po-qualification-desktop");
      const mobile = dialog.locator(".award-po-qualification-mobile");
      assert.equal(await desktop.isVisible(), mode === "desktop");
      assert.equal(await mobile.isVisible(), mode === "mobile");
      const credentialText = await dialog.innerText();
      for (const required of [
        "Supplier Mapping资格凭证", "AWARD_PO_MAPPING_QUALIFICATION_V1", qualification.observed_at,
        "Asia/Shanghai", "qualified=true / 合格", "4/4 行合格", qualification.qualification_digest,
      ]) assert.ok(credentialText.includes(required), `${mode} Mapping credential missing ${required}`);
      const items = mode === "desktop" ? desktop.locator("tbody tr") : mobile.locator("article");
      assert.equal(await items.count(), 4);
      for (const [index, line] of qualification.lines.entries()) {
        const item = items.nth(index);
        assert.equal(await item.getAttribute("data-award-line-id"), line.award_line_id);
        assert.equal(await item.getAttribute("data-qualified"), "true");
        const itemText = await item.innerText();
        const common = [
          "qualified=true / 合格", `Award Line ${line.award_line_id}`, `Candidate ${line.candidate_id}`,
          `Quote Line ${line.quote_line_id}`, `RFQ Binding ${line.rfq_binding_id}`, line.mapping_uuid,
          `Fact ${line.mapping_fact_id} / v${line.mapping_version_no} / Row CAS ${line.mapping_row_cas}`,
          "Binding状态：ACTIVE", "Mapping状态：ACTIVE", line.supplier_part_number,
          `Supplier Unit ${line.supplier_unit_id} / PCS`, `Internal Unit ${line.internal_unit_id} / PCS`,
          line.valid_from, line.content_digest, "错误代码：—", "原因：Supplier Mapping资格通过",
        ];
        const responsive = mode === "desktop" ? [
          "Supplier 1 / SUP-000001", "Supplier状态：ACTIVE", `Material ${line.material_id}`,
          "Material状态：ACTIVE", "1:1", "至 —", "Supplier/Material：0", "Supplier Part：0",
        ] : [
          "Supplier 1 / SUP-000001 / ACTIVE", `Material ${line.material_id} / ACTIVE`,
          "换算：1:1", `有效期：${line.valid_from} 至 —`, "冲突：Supplier/Material 0 / Supplier Part 0",
        ];
        for (const required of [...common, ...responsive]) {
          assert.ok(itemText.includes(required), `${mode} Mapping credential line ${line.award_line_id} missing ${required}`);
        }
      }
    };
    let delayNextPreview = true;
    let failNextConversionPost = true;
    let markDelayedPreviewObserved = () => {};
    let markFailedConversionPostObserved = () => {};
    const delayedPreviewObserved = new Promise((resolve) => { markDelayedPreviewObserved = resolve; });
    const delayedPreviewGate = new Promise((resolve) => { releaseDelayedPreview = resolve; });
    const failedConversionPostObserved = new Promise((resolve) => { markFailedConversionPostObserved = resolve; });
    const failedConversionPostGate = new Promise((resolve) => { releaseFailedConversionPost = resolve; });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
      const method = request.method().toUpperCase();
      if (method === "GET" && url.pathname === "/api/procurement/awards/1/purchase-order-conversion-preview") {
        previewGets.push({ method, path: url.pathname });
        if (delayNextPreview) {
          delayNextPreview = false;
          markDelayedPreviewObserved();
          await delayedPreviewGate;
        }
      }
      if (method === "GET" && url.pathname === "/api/procurement/purchase-orders/1/history") {
        historyGets.push({ method, path: url.pathname });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && url.pathname !== "/api/logout") {
        let body = null;
        try { body = request.postDataJSON(); } catch { body = request.postData(); }
        businessPosts.push({ method, path: url.pathname, body });
        if (method === "POST" && url.pathname === "/api/procurement/awards/1/purchase-orders" && failNextConversionPost) {
          failNextConversionPost = false;
          markFailedConversionPostObserved();
          await failedConversionPostGate;
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: {
              code: "FIX32_SYNTHETIC_CONVERSION_FAILURE",
              message: "模拟最终转换失败",
              request_id: "f32f32f3-2f32-4f32-8f32-f32f32f32f32",
            } }),
          });
        }
      }
      return route.continue();
    });

    await page.goto(`${REQUIRED_ORIGIN}/procurement/fulfillment`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "定标转单、到货计划与来料谱系", exact: true }).waitFor();
    await page.getByText("RFQ-00000001 · 定标 #1", { exact: true }).waitFor();
    const entry = page.getByRole("button", { name: "显式生成采购订单", exact: true });
    await entry.waitFor();

    const delayedPreviewResponsePromise = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/awards/1/purchase-order-conversion-preview`
      && response.request().method() === "GET");
    await entry.click();
    await delayedPreviewObserved;
    const loadingDialog = page.locator(".rfq-dialog.award-po-dialog[role=dialog]");
    await loadingDialog.getByRole("heading", { name: "正在重新读取转换权威数据", exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
    await loadingDialog.getByRole("button", { name: "取消", exact: true }).click();
    await loadingDialog.waitFor({ state: "detached" });
    assert.equal(businessPosts.length, 0, "cancelling a delayed preview must send no business POST");
    releaseDelayedPreview();
    const delayedPreviewResponse = await delayedPreviewResponsePromise;
    const delayedPreviewPayload = await delayedPreviewResponse.json();
    assert.equal(delayedPreviewResponse.status(), 200, JSON.stringify(delayedPreviewPayload));
    latestConversionPreview = delayedPreviewPayload.data;
    assertQualificationPreview(latestConversionPreview);
    conversionPreviews.push(latestConversionPreview);
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".rfq-dialog.award-po-dialog[role=dialog]").count(), 0, "a late preview response must not resurrect the cancelled dialog");
    assert.equal(previewGets.length, 1);
    assert.equal(await entry.isEnabled(), true);

    const openDialog = async (expectedPreviewGetCount, expectedBusinessPostCount = 0) => {
      const previewResponse = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/awards/1/purchase-order-conversion-preview`
        && response.request().method() === "GET");
      await entry.click();
      const response = await previewResponse;
      const payload = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(payload));
      latestConversionPreview = payload.data;
      assertQualificationPreview(latestConversionPreview);
      conversionPreviews.push(latestConversionPreview);
      const dialog = page.locator(".rfq-dialog.award-po-dialog[role=dialog]");
      await dialog.getByRole("heading", { name: "定标转采购订单最终确认", exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
      assert.equal(previewGets.length, expectedPreviewGetCount);
      assert.equal(businessPosts.length, expectedBusinessPostCount, "opening confirmation must not add a business POST");
      return dialog;
    };

    let dialog = await openDialog(2);
    assert.equal(await dialog.locator(".award-po-lines-desktop:not(.award-po-qualification-desktop) tbody tr").count(), 4);
    assert.equal(await dialog.locator(".award-po-lines-desktop:not(.award-po-qualification-desktop)").isVisible(), true);
    assert.equal(await dialog.locator(".award-po-lines-mobile:not(.award-po-qualification-mobile)").isVisible(), false);
    await assertQualificationCredential(dialog, "desktop");
    const desktopText = await dialog.innerText();
    for (const required of [
      "#1 / v1 / AWARDED", "ID 1 / RFQ-00000001 / Round 1 / CLOSED", "Version 1 / CURRENT / awardable_now=false",
      "po_convertible_now=true / 当前PO 0 / 当前计划 0", "Quote 1/v1", "Quote 2/v1", "Supplier 1 / SUP-000001",
      "付款条件：纯虚拟UAT付款条件，仅用于表单验收。", "未税 / 不含运费",
      `ID ${history.operation_receipt.event_id} / AWARDED`, "SUCCESS", history.operation_receipt.actor,
      history.operation_receipt.occurred_at_shanghai, history.operation_receipt.request_id,
      history.persisted_award_digest.value, history.decision_digest.value, history.identity.comparison_output_digest,
      "Award Line", "533 / CYD-RB_PCB-000016", "534 / CYD-RB_SENSOR-000003", "535 / CYD-RB_CONN-000075", "536 / CYD-RB_METAL-000015",
      "10 PCS", "12.00 CNY", "120.00 CNY", "2026-10-20",
      "转换操作 1", "PO聚合 1", "PO Line 4", "Delivery Plan计划记录／聚合 4", "独立Delivery Plan Line 0", "待入库队列 4",
      "Supplier：1 / SUP-000001", "总额：480.00 CNY", "当前PO模型未采集外部参考", "PO备注（可选，最多2000字）",
      "Award、RFQ、Quote、Comparison不会被修改。", "Receipt", "Warehouse Receipt", "Inventory Ledger", "IQC", "AP", "Payment", "Work Order",
      "供应商到货、仓库收货和IQC必须由后续独立任务完成。", "最终确认生成PO及到货计划", "取消",
    ]) assert.ok(desktopText.includes(required), `FIX-32 desktop confirmation missing ${required}`);
    assert.equal(await dialog.locator("textarea").count(), 1, "normal PO remark must be the only editable field");
    assert.equal(await dialog.locator("input,select").count(), 0, "confirmation must not request warehouse, tax, address, contact or external reference input");
    await noOverflow(page, "FIX-32 confirmation desktop");
    await noDialogOverflow(dialog, "FIX-32 confirmation desktop");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessPosts.length, 0, "cancel must send no business POST");

    dialog = await openDialog(3);
    await dialog.getByRole("button", { name: "关闭确认窗口", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessPosts.length, 0, "close must send no business POST");

    dialog = await openDialog(4);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessPosts.length, 0, "Escape must send no business POST");

    dialog = await openDialog(5);
    await page.locator(".rfq-dialog-backdrop").click({ position: { x: 4, y: 4 } });
    await dialog.waitFor({ state: "detached" });
    assert.equal(businessPosts.length, 0, "backdrop close must send no business POST");
    assert.deepEqual(await fix32ConversionState(), zeroConversionState);

    await page.setViewportSize({ width: 390, height: 844 });
    dialog = await openDialog(6);
    assert.equal(await dialog.locator(".award-po-lines-desktop:not(.award-po-qualification-desktop)").isVisible(), false);
    assert.equal(await dialog.locator(".award-po-lines-mobile:not(.award-po-qualification-mobile)").isVisible(), true);
    assert.equal(await dialog.locator(".award-po-lines-mobile:not(.award-po-qualification-mobile) article").count(), 4);
    await assertQualificationCredential(dialog, "mobile");
    await noOverflow(page, "FIX-32 confirmation 390x844");
    await noDialogOverflow(dialog, "FIX-32 confirmation 390x844");
    const remark = "纯虚拟UAT采购订单，仅用于黑盒验收，不对应真实采购。";
    await dialog.getByLabel("PO备注（可选，最多2000字）", { exact: true }).fill(remark);
    assert.equal(businessPosts.length, 0, "editing local remark must send no business POST");
    const failedExpectedMappingQualificationDigest = latestConversionPreview.mapping_qualification.qualification_digest;

    const failedConversionResponsePromise = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/awards/1/purchase-orders`
      && response.request().method() === "POST");
    const finalButton = dialog.locator(".rfq-dialog-actions button").last();
    assert.equal(await finalButton.innerText(), "最终确认生成PO及到货计划");
    const disabledImmediately = await finalButton.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("FIX-32 final confirmation control is not a button");
      button.click();
      return button.disabled;
    });
    assert.equal(disabledImmediately, true, "the final button must be disabled synchronously when clicked");
    await failedConversionPostObserved;
    assert.equal(businessPosts.length, 1, "a delayed failed conversion must have exactly one in-flight POST");
    assert.equal(await finalButton.isDisabled(), true, "the final button must stay disabled while the POST is pending");
    releaseFailedConversionPost();
    const failedConversionResponse = await failedConversionResponsePromise;
    assert.equal(failedConversionResponse.status(), 409, await failedConversionResponse.text());
    const failureAlert = dialog.getByRole("alert");
    await failureAlert.waitFor();
    const failureText = await failureAlert.innerText();
    assert.ok(failureText.includes("模拟最终转换失败（请求 f32f32f3-2f32-4f32-8f32-f32f32f32f32）"));
    assert.ok(failureText.includes("系统不会自动重试；请关闭窗口后重新读取权威数据，再决定是否重新确认。"));
    assert.equal(await finalButton.innerText(), "本次确认已锁定");
    assert.equal(await finalButton.isDisabled(), true, "the failed final action must remain locked");
    await page.waitForTimeout(500);
    assert.equal(businessPosts.length, 1, "a failed final action must not retry automatically");
    assert.equal(await finalButton.isDisabled(), true, "the final button must remain disabled after the no-retry observation window");
    assert.deepEqual(await fix32ConversionState(), zeroConversionState, "the synthetic failed POST must create no records");
    await dialog.getByRole("button", { name: "关闭确认窗口", exact: true }).click();
    await dialog.waitFor({ state: "detached" });

    dialog = await openDialog(7, 1);
    assert.equal(await dialog.locator(".award-po-lines-mobile:not(.award-po-qualification-mobile)").isVisible(), true);
    await dialog.getByLabel("PO备注（可选，最多2000字）", { exact: true }).fill(remark);
    const successfulExpectedMappingQualificationDigest = latestConversionPreview.mapping_qualification.qualification_digest;
    const conversionResponsePromise = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/awards/1/purchase-orders`
      && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "最终确认生成PO及到货计划", exact: true }).evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("FIX-32 final confirmation control is not a button");
      button.click();
      button.click();
    });
    const conversionResponse = await conversionResponsePromise;
    const conversionPayload = await conversionResponse.json();
    assert.equal(conversionResponse.status(), 201, JSON.stringify(conversionPayload));
    assert.deepEqual(conversionPayload.data.summary, {
      conversion_operation_count: 1,
      purchase_order_aggregate_count: 1,
      purchase_order_line_count: 4,
      delivery_plan_aggregate_count: 4,
      delivery_plan_line_count: 0,
      receiving_queue_entry_count: 4,
    });
    await dialog.waitFor({ state: "detached" });
    await page.getByText("采购订单、PO Line与逐行到货计划已在同一事务生成；未自动创建收货、库存、IQC、应付或生产记录", { exact: true }).waitFor();
    assert.equal(businessPosts.length, 2, "the failed attempt and successful double click must send exactly two business POSTs total");
    assert.equal(conversionPreviews.length, 7);
    assert.equal(new Set(conversionPreviews.map((preview) => preview.mapping_qualification.qualification_digest)).size, 1,
      "unchanged fixed Mapping facts must produce one stable qualification digest across all previews");
    const submittedQualificationDigests = [failedExpectedMappingQualificationDigest, successfulExpectedMappingQualificationDigest];
    for (const [requestIndex, conversionRequest] of businessPosts.entries()) {
      assert.equal(conversionRequest.method, "POST");
      assert.equal(conversionRequest.path, "/api/procurement/awards/1/purchase-orders");
      assert.equal(conversionRequest.body.remark, remark);
      assert.deepEqual(conversionRequest.body.expected_award_line_ids, ["1", "2", "3", "4"]);
      assert.equal(conversionRequest.body.expected_decision_digest, history.decision_digest.value);
      assert.equal(conversionRequest.body.expected_mapping_qualification_digest, submittedQualificationDigests[requestIndex]);
      for (const forbidden of ["supplier_id", "currency_code", "unit_price", "price", "material_id", "quantity", "warehouse_id", "tax_rate", "external_reference"]) {
        assert.equal(Object.hasOwn(conversionRequest.body, forbidden), false, `browser request ${requestIndex + 1} must not submit ${forbidden}`);
      }
    }

    assert.deepEqual(await fix32UpstreamState(), upstreamBefore, "Award and all sourcing authority must remain unchanged");
    assert.deepEqual(await fix32ConversionState(), {
      purchase_orders: 1,
      purchase_order_lines: 4,
      purchase_order_events: 1,
      award_links: 4,
      delivery_plans: 4,
      receiving_queue_entries: 4,
      delivery_plan_events: 4,
      receipts: 0,
      ledger_entries: 0,
      quality_inspections: 0,
      ap_documents: 0,
      payments: 0,
      work_orders: 0,
      conversion_audits: 1,
    });
    assert.deepEqual((await pool.query(`select
      link.award_line_id::text award_line_id,rfq_line.material_id::int award_material_id,
      po_line.material_id::int po_material_id,po_line.line_no::int po_line_no,
      po_line.order_qty::text order_qty,po_line.unit_price::text unit_price,
      plan.purchase_order_line_id=po_line.id plan_bound_to_line,plan.planned_quantity::text planned_quantity,
      plan.promised_delivery_date::text promised_delivery_date
      from procurement_award_po_line_links link
      join procurement_sourcing_award_lines award_line on award_line.id=link.award_line_id
      join procurement_rfq_lines rfq_line on rfq_line.id=award_line.rfq_line_id
      join purchase_order_lines po_line on po_line.id=link.purchase_order_line_id
      join purchase_delivery_plans plan on plan.purchase_order_line_id=po_line.id
      where link.award_id=1 order by link.award_line_id`)).rows, [1, 2, 3, 4].map((awardLineId, index) => ({
      award_line_id: String(awardLineId),
      award_material_id: 533 + index,
      po_material_id: 533 + index,
      po_line_no: awardLineId,
      order_qty: "10.000000",
      unit_price: "12.000000",
      plan_bound_to_line: true,
      planned_quantity: "10.000000",
      promised_delivery_date: "2026-10-20",
    })));
    assert.deepEqual((await pool.query(`select po.supplier_id::int supplier_id,po.currency_code,po.remark,
      sum(line.order_qty*line.unit_price)::numeric(30,2)::text total_amount
      from purchase_orders po join purchase_order_lines line on line.purchase_order_id=po.id
      group by po.id,po.supplier_id,po.currency_code,po.remark`)).rows, [{
      supplier_id: 1,
      currency_code: "CNY",
      remark: remark.normalize("NFKC").trim(),
      total_amount: "480.00",
    }]);

    const convertedAwardCard = page.getByText("RFQ-00000001 · 定标 #1", { exact: true });
    await convertedAwardCard.waitFor({ state: "detached" });
    assert.equal(await convertedAwardCard.count(), 0, "converted Award must leave the pending list");
    assert.equal(await page.locator(".sourcing-panel").filter({ hasText: "采购订单与到货计划" }).locator("article.sourcing-card").count(), 1);
    assert.equal(previewGets.length, 7);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("link", { name: "查看只读历史详情", exact: true }).click();
    await page.getByRole("heading", { name: "PO-00000001", exact: true }).waitFor();
    const historyApi = await context.request.get(`${REQUIRED_ORIGIN}/api/procurement/purchase-orders/1/history`);
    assert.equal(historyApi.status(), 200);
    const historyPayload = await historyApi.json();
    assert.equal(historyPayload.data.contract_version, "PO_HISTORY_TRACEABILITY_V1");
    assert.equal(historyPayload.data.read_only, true);
    assert.equal(historyPayload.data.purchase_order.purchase_order_id, "1");
    assert.equal(historyPayload.data.purchase_order.po_convertible_now, false);
    assert.equal(historyPayload.data.lines.length, 4);
    assert.equal(historyPayload.data.delivery_plans.length, 4);
    assert.equal(historyPayload.data.downstream.all_zero, true);
    assert.equal(historyPayload.data.governance_boundary.authorization_verified, false);
    assert.equal(Object.hasOwn(historyPayload.data.credentials.idempotency, "request"), false);
    assert.equal(Object.hasOwn(historyPayload.data.credentials.idempotency, "response"), false);
    assert.equal(historyPayload.data.credentials.historical_failed_attempt.available, false);
    assert.deepEqual(historyPayload.data.lines.map((line) => [
      line.purchase_order_line_id, line.award_line_id, line.candidate_id, line.quote_line_id,
      line.binding_id, line.material_id, line.mapping_fact_id, line.mapping_uuid,
    ]), [1, 2, 3, 4].map((lineId, index) => [
      String(lineId), String(lineId), String(lineId * 2), String(lineId), String(lineId),
      String(533 + index), String(lineId), MAPPING_UIDS[0][index],
    ]));
    assert.ok(historyPayload.data.delivery_plans.every((plan, index) => plan.delivery_plan_id === String(index + 1)
      && plan.plan_event_id === String(index + 1) && plan.queue_id === String(index + 1)
      && plan.status === "PENDING" && plan.queue_status === "OPEN_PENDING"));

    const historyText = await page.locator("body").innerText();
    for (const required of [
      "只读历史视图", "PO聚合摘要", "OPEN / 处理中", "Supplier A", "Supplier B",
      "PO行 4 · 480.00 CNY", "PO行 0 · 0.00 CNY", "完整上游谱系", "Project", "MRP", "PRQ",
      "RFQ", "Comparison", "Quote", "Award", "PO", "PO Line稳定谱系", "无重复Material",
      "Delivery Plan与queue", "模型没有独立Delivery Plan Line", "queue是待处理队列，不代表已收货或已入库",
      "Event、Audit与幂等凭证", "历史失败请求 · 无可安全归属项", "下游零写入状态", "全部为0",
      "Receipt", "Warehouse Receipt", "Inventory Ledger", "Lot", "IQC", "AP", "Payment", "Work Order",
      "PO OPEN不等于已到货。", "Delivery Plan PENDING不等于已收货。",
      "queue OPEN_PENDING是待处理队列，不等于库存增加。", "本页面不自动执行任何下游动作。",
    ]) assert.ok(historyText.includes(required), `PO history desktop missing ${required}`);
    for (const mappingUid of MAPPING_UIDS[0]) assert.ok(historyText.includes(mappingUid));
    assert.equal(await page.locator('[data-testid^="po-line-row-"]').count(), 4);
    assert.equal(await page.locator('[data-testid^="delivery-plan-row-"]').count(), 4);
    assert.equal(await page.locator('[data-testid^="po-line-row-"]').first().isVisible(), true);
    assert.equal(await page.locator('[data-testid^="po-line-card-"]').first().isVisible(), false);
    assert.equal(await page.locator("form,input,select,textarea").count(), 0);
    for (const forbidden of ["到货", "收货", "IQC", "入库", "生成AP", "编辑", "取消PO", "关闭PO"]) {
      assert.equal(await page.getByRole("button", { name: forbidden, exact: true }).count(), 0, `forbidden history control ${forbidden}`);
    }
    await noOverflow(page, "PO history desktop");
    const postsBeforeHistoryRefresh = businessPosts.length;
    const stableLines = JSON.stringify(historyPayload.data.lines);
    await page.getByRole("button", { name: "刷新只读快照", exact: true }).click();
    await page.getByRole("button", { name: "刷新只读快照", exact: true }).waitFor();
    assert.ok(historyGets.length >= 2, "initial history load and refresh must use GET");
    assert.equal(businessPosts.length, postsBeforeHistoryRefresh);
    const refreshedHistory = await (await context.request.get(`${REQUIRED_ORIGIN}/api/procurement/purchase-orders/1/history`)).json();
    assert.equal(JSON.stringify(refreshedHistory.data.lines), stableLines);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "PO-00000001", exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid^="po-line-row-"]').count(), 4);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('[data-testid^="po-line-row-"]').first().isVisible(), false);
    assert.equal(await page.locator('[data-testid^="po-line-card-"]').count(), 4);
    assert.equal(await page.locator('[data-testid^="po-line-card-"]').first().isVisible(), true);
    assert.equal(await page.locator('[data-testid^="delivery-plan-card-"]').count(), 4);
    assert.equal(await page.locator('[data-testid^="delivery-plan-card-"]').first().isVisible(), true);
    await noOverflow(page, "PO history 390x844");
    await page.getByText(/Idempotency · HTTP 201/).click();
    assert.ok((await page.locator("body").innerText()).includes(historyPayload.data.credentials.idempotency.request_digest));

    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "定标转单、到货计划与来料谱系", exact: true }).waitFor();
    await page.goForward({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "PO-00000001", exact: true }).waitFor();
    await stopServer();
    await startServer();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "PO-00000001", exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid^="po-line-card-"]').count(), 4);
    assert.equal(businessPosts.length, postsBeforeHistoryRefresh);
    assert.deepEqual(await fix32ConversionState(), {
      purchase_orders: 1, purchase_order_lines: 4, purchase_order_events: 1, award_links: 4,
      delivery_plans: 4, receiving_queue_entries: 4, delivery_plan_events: 4, receipts: 0,
      ledger_entries: 0, quality_inspections: 0, ap_documents: 0, payments: 0, work_orders: 0,
      conversion_audits: 1,
    });

    const logout = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
      headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": csrfToken },
    });
    assert.equal(logout.status(), 200);
    authenticated = false;
    assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
    assert.equal(Number((await pool.query(
      "select count(*) count from app_sessions where username=$1 and revoked_at is null and expires_at>now()",
      [fixture.credentials.username],
    )).rows[0].count), 0);
    await context.close();
    context = undefined;
    console.info("AWARD_PO_CONFIRMATION_FIX32_BROWSER_OK preview_get=7 mapping_qualified=4 mapping_digest_stable=1 delayed_preview_cancel_post=0 late_preview_resurrection=0 cancel_close_esc_backdrop_post=0 failed_final_post=1 failed_retry=0 successful_final_post=1 po=1 po_line=4 plan=4 queue=4 downstream=0 po_history=1 history_get_only=1 history_refresh=1 history_reopen=1 history_restart=1 desktop=1 mobile=1 session=0");
  } finally {
    releaseDelayedPreview();
    releaseFailedConversionPost();
    if (authenticated && context && csrfToken) {
      await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": csrfToken },
      }).catch(() => undefined);
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
});

test.after(async () => {
  await stopServer();
  await clearSyntheticData();
  await pool.end();
});
