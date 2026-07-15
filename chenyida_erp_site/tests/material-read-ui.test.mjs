import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_LIST_QUERY, attributeDisplay, boundedPreview, compactTrackingId, flattenCategories,
  materialApiQuery, parseHistoryQuery, parseListQuery, presentMaterialError, serializeListQuery,
  sourceLabel, statusLabel,
} from "../app/materials/_lib/material-ui.ts";
import { safeMaterialReturnTo } from "../public/erp/api-client.js";

const root = new URL("../", import.meta.url);
const [listSource, detailSource, detailSectionsSource, shellSource, sharedClient, listRoute, detailRoute, versionsRoute, logsRoute, styles] = await Promise.all([
  readFile(new URL("../app/materials/_components/material-list-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/_components/material-detail-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/_components/material-detail-sections.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/_components/material-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/[materialId]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/[materialId]/versions/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/[materialId]/change-logs/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/materials/materials.css", import.meta.url), "utf8"),
]);
const detailUiSource = `${detailSource}\n${detailSectionsSource}`;

test("01 未登录访问回到现有登录流程并携带当前 Material URL", () => {
  assert.match(shellSource, /\/\?return_to=/);
  assert.match(shellSource, /!result\.authenticated/);
  assert.doesNotMatch(shellSource, /password.*input|login-card/i);
});

test("02 列表默认加载显式分页和排序", () => {
  assert.deepEqual(parseListQuery(""), DEFAULT_LIST_QUERY);
  assert.equal(materialApiQuery(DEFAULT_LIST_QUERY), "/api/material-master/materials?page=1&page_size=20&sort=updated_at_desc");
});

test("03 默认分页参数为 page=1 page_size=20", () => {
  const query = parseListQuery("?page=0&page_size=999");
  assert.equal(query.page, 1); assert.equal(query.page_size, 20);
});

test("04 URL 筛选、分页和排序可完整恢复", () => {
  const raw = "page=3&page_size=50&keyword=FR4&material_status=ACTIVE&category_id=9&source_type=MANUAL&created_by=buyer01&created_from=2026-07-01&created_to=2026-07-14&updated_from=2026-07-02&updated_to=2026-07-13&sort=material_code_asc";
  assert.equal(serializeListQuery(parseListQuery(raw)), raw);
});

test("05 浏览器前进后退监听 popstate 并重新读取 URL", () => {
  assert.match(listSource, /addEventListener\("popstate", applyLocation\)/);
  assert.match(detailSource, /addEventListener\("popstate", readLocation\)/);
});

test("06 keyword 使用 300ms debounce 且 replaceState", () => {
  assert.match(listSource, /setTimeout\([^]*300\)/);
  assert.match(listSource, /keyword: draft\.keyword[^]*"replace"/);
});

test("07 状态筛选只接受 API allowlist", () => {
  assert.equal(parseListQuery("material_status=ACTIVE").material_status, "ACTIVE");
  assert.equal(parseListQuery("material_status=OBSOLETE").material_status, "");
});

test("08 分类树明确叶子 category_id 与非叶子 category_path", () => {
  const flattened = flattenCategories([{ category_id: 1, code: "PCB", name: "PCB", level: 1, full_path: "PCB", is_leaf: false, children: [{ category_id: 2, code: "FR4", name: "FR4", level: 2, full_path: "PCB / FR4", is_leaf: true, children: [] }] }]);
  assert.deepEqual(flattened.map((item) => [item.category_id, item.code_path, item.is_leaf]), [[1, "PCB", false], [2, "PCB/FR4", true]]);
  assert.match(listSource, /node\.is_leaf \? `id:/); assert.match(listSource, /`path:/);
});

test("09 来源筛选与未知来源显示安全", () => {
  assert.equal(sourceLabel("LEGACY_D1"), "旧版在线系统");
  assert.equal(sourceLabel("FUTURE"), "未知来源");
});

test("10 排序仅使用固定 allowlist", () => {
  assert.equal(parseListQuery("sort=standard_name_desc").sort, "standard_name_desc");
  assert.equal(parseListQuery("sort=DROP_TABLE").sort, "updated_at_desc");
});

test("11 page_size 只允许 20 50 100", () => {
  assert.equal(parseListQuery("page_size=20").page_size, 20);
  assert.equal(parseListQuery("page_size=50").page_size, 50);
  assert.equal(parseListQuery("page_size=100").page_size, 100);
  assert.equal(parseListQuery("page_size=101").page_size, 20);
});

test("12 空数据库显示空状态且创建入口由会话权限控制", () => {
  assert.match(listSource, /尚无可查看的物料/);
  assert.match(listSource, /canCreateDraft\(session\.user\?\.permissions/);
});

test("13 筛选无结果提供清除筛选", () => {
  assert.match(listSource, /没有符合当前筛选条件的物料/);
  assert.match(listSource, />清除筛选</);
});

test("14 400 显示查询参数错误并允许恢复默认", () => {
  assert.deepEqual(presentMaterialError({ status: 400 }), { title: "查询参数错误", message: "查询条件有误，请检查后重试", requestId: "", canReset: true });
});

test("15 401 由共享 Client 与现有登录跳转处理", () => {
  assert.match(sharedClient, /status === 401/);
  assert.match(listSource, /reason\.status === 401[^]*redirectToExistingLogin/);
});

test("16 403 不推测角色并显示固定权限文案", () => {
  assert.equal(presentMaterialError({ status: 403 }).message, "没有权限访问此功能");
});

test("17 隐藏详情 404 使用不可区分文案", () => {
  assert.equal(presentMaterialError({ status: 404, code: "MATERIAL_NOT_FOUND" }).message, "物料不存在或无权查看");
});

test("18 500 显示通用错误和服务端 request_id", () => {
  const result = presentMaterialError({ status: 500, requestId: "req-123" });
  assert.equal(result.message, "系统暂时无法加载数据，请稍后重试"); assert.equal(result.requestId, "req-123");
});

test("19 详情包含基本信息和职责字段", () => {
  for (const label of ["基本信息", "职责信息", "正式物料编码", "标准名称", "创建人", "最后修改人", "批准人"]) assert.match(detailUiSource, new RegExp(label));
});

test("20 TEXT 属性按纯文本显示", () => {
  assert.equal(attributeDisplay({ data_type: "TEXT", value: "FR4 <b>" }), "FR4 <b>");
});

test("21 INTEGER 属性保留 0", () => {
  assert.equal(attributeDisplay({ data_type: "INTEGER", value: 0 }), "0");
});

test("22 DECIMAL 属性不擅自舍入", () => {
  assert.equal(attributeDisplay({ data_type: "DECIMAL", value: 1.23456 }), "1.23456");
});

test("23 BOOLEAN 属性使用是和否", () => {
  assert.equal(attributeDisplay({ data_type: "BOOLEAN", value: true }), "是");
  assert.equal(attributeDisplay({ data_type: "BOOLEAN", value: false }), "否");
});

test("24 ENUM 优先 label 并保留 code", () => {
  assert.equal(attributeDisplay({ data_type: "ENUM", value: { label: "阻燃 V0", code: "V0" } }), "阻燃 V0（V0）");
});

test("25 属性单位紧邻数值", () => {
  assert.equal(attributeDisplay({ data_type: "DECIMAL", value: 1.6, unit: "mm" }), "1.6 mm");
});

test("26 Validation 同时用文字展示 ERROR 和 WARNING", () => {
  assert.match(detailUiSource, /错误 ERROR/); assert.match(detailUiSource, /警告 WARNING/);
  assert.doesNotMatch(detailUiSource, /validateForReview|重新计算/);
});

test("27 版本历史分页默认 20 且最大界面选项 50", () => {
  assert.deepEqual(parseHistoryQuery(""), { page: 1, page_size: 20 });
  assert.deepEqual(parseHistoryQuery("page=2&page_size=50"), { page: 2, page_size: 50 });
});

test("28 变更日志分页、独立路由和有界展开", () => {
  assert.match(logsRoute, /view="change-logs"/); assert.match(detailSource, /page_size=\$\{historyQuery\.page_size\}/);
  assert.ok(boundedPreview("x".repeat(5000)).length < 4200);
});

test("29 安全 return_to 接受本站内部 materials 路径", () => {
  assert.equal(safeMaterialReturnTo("/materials?page=3&page_size=50"), "/materials?page=3&page_size=50");
  assert.equal(safeMaterialReturnTo("/materials/456/versions?page=2"), "/materials/456/versions?page=2");
});

test("30 恶意 return_to 全部被拒绝", () => {
  for (const value of ["https://evil.example/materials", "//evil.example/x", "javascript:alert(1)", "/materials\\evil", "/materialsevil"]) assert.equal(safeMaterialReturnTo(value), "/materials");
});

test("31 INACTIVE 独立显示停用而不映射其他状态", () => {
  assert.equal(statusLabel("INACTIVE"), "停用"); assert.notEqual(statusLabel("INACTIVE"), statusLabel("OBSOLETE")); assert.notEqual(statusLabel("INACTIVE"), statusLabel("REPLACED"));
});

test("32 未知状态安全显示且不崩溃", () => {
  assert.equal(statusLabel("FUTURE_STATE"), "未知状态");
});

test("33 Material 只读工作区不渲染批准驳回导入或 AI 操作", () => {
  const ui = `${listSource}\n${detailSource}\n${shellSource}`;
  assert.doesNotMatch(ui, />\s*(?:批准|驳回|Excel导入|CSV导入|AI功能)\s*</);
  assert.doesNotMatch(ui, /createDraft|approveDraft|rejectDraft|runImport/);
  assert.match(ui, /canCreateDraft|canEditDraft/);
});

test("34 所有列表与历史请求显式携带有界分页", () => {
  assert.match(materialApiQuery(DEFAULT_LIST_QUERY), /page=1&page_size=20/);
  assert.match(detailSource, /\?page=\$\{historyQuery\.page\}&page_size=\$\{historyQuery\.page_size\}/);
  assert.doesNotMatch(`${listSource}\n${detailSource}`, /page_size=(?:999|1000|all)/i);
});

test("35 列表不在客户端执行行级权限过滤并使用服务端 total", () => {
  assert.doesNotMatch(listSource, /result\??\.data\.filter|user\.role.*filter/);
  assert.match(listSource, /value=\{result\.pagination\}/);
});

test("36 四个页面路由、固定列、横向滚动和单一共享 Client 均存在", () => {
  assert.match(listRoute, /MaterialListPage/); assert.match(detailRoute, /view="detail"/); assert.match(versionsRoute, /view="versions"/); assert.match(logsRoute, /view="change-logs"/);
  assert.match(styles, /overflow:\s*auto/); assert.match(styles, /\.mm-sticky-code/); assert.match(styles, /\.mm-sticky-name/);
  assert.equal((listSource.match(/public\/erp\/api-client\.js/g) || []).length, 1);
  assert.equal((detailSource.match(/public\/erp\/api-client\.js/g) || []).length, 1);
  assert.ok(root);
});

test("追踪编号默认仅展示末八位", () => {
  assert.equal(compactTrackingId("12345678-aaaa-bbbb-cccc-1234567890ab"), "…567890ab");
});
