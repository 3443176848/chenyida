import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_REVIEW_QUERY, parseReviewQueueQuery, reviewCapabilities,
  reviewComment, reviewQueueApiQuery, reviewReason, reviewResponsibility,
  reviewValidationFingerprint, safeReviewReturnTo, serializeReviewQueueQuery,
} from "../app/materials/_lib/material-review.ts";
import { createWriteOperation, sameWriteRequest } from "../app/materials/_lib/material-draft.ts";
import { api, ErpApiError } from "../public/erp/api-client.js";

const files = await Promise.all([
  "../app/materials/_components/material-review-queue-page.tsx",
  "../app/materials/_components/material-review-workspace.tsx",
  "../app/materials/_components/material-detail-sections.tsx",
  "../app/materials/_components/material-detail-workspace.tsx",
  "../app/materials/_components/material-shell.tsx",
  "../app/materials/materials.css",
  "../app/materials/review/page.tsx",
  "../app/materials/[materialId]/review/page.tsx",
  "../public/erp/api-client.js",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
const [queueSource, workspaceSource, sectionsSource, detailSource, shellSource, styles, queueRoute, workspaceRoute, clientSource] = files;

const validation = (warning = "") => ({
  basis: "CURRENT_METADATA", valid: true, errors: [], warnings: warning ? [{ code: "WARN", severity: "WARNING", field: "attributes.BRAND", attribute_code: "BRAND", message: warning, metadata: { b: 2, a: 1 } }] : [],
});

test("01 未登录审核路由复用现有登录回跳", () => {
  assert.match(shellSource, /api<MaterialSession>\("\/api\/session"\)/);
  assert.match(shellSource, /redirectToExistingLogin/);
  assert.doesNotMatch(`${queueSource}\n${workspaceSource}`, /password.*input|login-card/i);
});

test("02 无 review.queue 权限时不加载队列正文", () => {
  assert.equal(reviewCapabilities(["material.review.approve"]).queue, false);
  assert.match(queueSource, /if \(!capabilities\.queue\) return <MaterialErrorState/);
});

test("03 队列默认显式有界分页和排序", () => {
  assert.deepEqual(parseReviewQueueQuery(""), DEFAULT_REVIEW_QUERY);
  assert.equal(reviewQueueApiQuery(DEFAULT_REVIEW_QUERY), "/api/material-master/review-queue?page=1&page_size=20&sort=submitted_at_desc");
});

test("04 URL 筛选在刷新和 popstate 后完整恢复", () => {
  const raw = "page=3&page_size=50&keyword=FR4&category_id=9&source_type=MANUAL&creator=buyer01&submitted_from=2026-07-01&submitted_to=2026-07-15&sort=standard_name_desc";
  assert.equal(serializeReviewQueueQuery(parseReviewQueueQuery(raw)), raw);
  assert.match(queueSource, /addEventListener\("popstate", applyLocation\)/);
});

test("05 队列排序只允许服务端四个值", () => {
  assert.equal(parseReviewQueueQuery("sort=submitted_at_asc").sort, "submitted_at_asc");
  assert.equal(parseReviewQueueQuery("sort=DROP_TABLE").sort, "submitted_at_desc");
});

test("06 分类筛选只发送 category_id 且仅展示叶子", () => {
  assert.equal(parseReviewQueueQuery("category_id=42").category_id, "42");
  assert.match(queueSource, /filter\(\(node\) => node\.is_leaf\)/);
  assert.equal(
    reviewQueueApiQuery({ ...DEFAULT_REVIEW_QUERY, category_id: "42" }).includes("category_path"),
    false,
  );
});

test("07 来源筛选使用现有 allowlist", () => {
  assert.equal(parseReviewQueueQuery("source_type=MANUAL").source_type, "MANUAL");
  assert.equal(parseReviewQueueQuery("source_type=AI").source_type, "");
});

test("08 创建人和提交日期存在且不伪造 submitted_by 筛选", () => {
  assert.match(queueSource, /<label>创建人/); assert.match(queueSource, /<label>提交日期/);
  assert.doesNotMatch(queueSource, /<label>提交人/);
  assert.match(queueSource, /不提供提交人筛选/);
});

test("09 无待审核物料使用独立空状态", () => assert.match(queueSource, /当前没有待审核物料/));
test("10 筛选无结果提供清除全部筛选", () => assert.match(queueSource, /没有符合当前筛选条件的待审核物料[^]*清除全部筛选/));

test("11 队列展示 CURRENT_METADATA 和最多五条问题", () => {
  assert.match(queueSource, /CURRENT_METADATA/); assert.match(queueSource, /top_issues \|\| \[\]\)\.slice\(0, 5\)/);
  assert.match(queueSource, /错误 ERROR/); assert.match(queueSource, /警告 WARNING/);
});

test("12 队列以受限安全 return_to 进入工作台", () => {
  const safe = safeReviewReturnTo("/materials/review?page=3&page_size=50&keyword=FR4");
  assert.equal(safe, "/materials/review?page=3&page_size=50&keyword=FR4");
  assert.match(queueSource, /\/review\?return_to=/);
});

test("13 工作台读取最新统一详情而非队列摘要", () => {
  assert.match(workspaceSource, /\/api\/material-master\/materials\/\$\{materialId\}/);
  assert.doesNotMatch(workspaceSource, /validation_summary/);
});

test("14 ERROR 禁止批准但不自动驳回", () => {
  assert.match(workspaceSource, /const approveAllowed = [^;]*!hasErrors/);
  assert.match(workspaceSource, /不能批准，需要驳回修改/);
  assert.match(workspaceSource, /onClick=\{\(\) => \{ setRejectError\(""\); setRejectOpen\(true\); \}\}/);
});

test("15 WARNING 在最终确认中要求明确勾选", () => {
  assert.match(workspaceSource, /warningConfirmed/);
  assert.match(workspaceSource, /我已核对当前版本和当前 Validation/);
});

test("16 WARNING 确认指纹绑定物料版本和完整规范化 Validation", () => {
  const first = reviewValidationFingerprint(1, 2, validation("A"));
  assert.notEqual(first, reviewValidationFingerprint(1, 3, validation("A")));
  assert.notEqual(first, reviewValidationFingerprint(1, 2, validation("B")));
  assert.notEqual(first, reviewValidationFingerprint(2, 2, validation("A")));
  assert.match(workspaceSource, /approveConfirmationRef/);
  assert.match(workspaceSource, /confirmation\.loadSequence !== loadSequenceRef\.current/);
  assert.match(workspaceSource, /confirmation\.fingerprint !== currentFingerprint/);
});

test("17 批准成功使用正式编码并返回原队列", () => {
  assert.match(workspaceSource, /internal_material_code/); assert.match(workspaceSource, /审核通过，正式物料编码/);
  assert.match(workspaceSource, /materialReviewResult/);
});

test("18 审核意见可选、纯文本且上限 1000", () => {
  assert.deepEqual(reviewComment("  通过  "), { value: "通过", error: "" });
  assert.ok(reviewComment("x".repeat(1001)).error); assert.match(workspaceSource, /maxLength=\{1000\}/);
});

test("19 驳回原因必填、去空白和字符计数", () => {
  assert.ok(reviewReason("   ").error); assert.deepEqual(reviewReason("  缺少证明  "), { value: "缺少证明", error: "" });
  assert.match(workspaceSource, /review-reason-count/); assert.match(workspaceSource, /review-reason-error/);
});

test("20 驳回成功确认 DRAFT 且不生成编码", () => {
  assert.match(workspaceSource, /latest\.material\.material_status !== "DRAFT"/);
  assert.doesNotMatch(workspaceSource, /REJECT[^]*internal_material_code\s*:/);
});

test("21 驳回成功重新读取并验证 last_rejection", () => {
  assert.match(workspaceSource, /!latest\.last_rejection/); assert.match(sectionsSource, /最近一次驳回/);
});

test("22 创建人禁审且显示具体职责文案", () => {
  assert.deepEqual(reviewResponsibility("buyer", "buyer", "editor"), { created: true, lastEditor: false });
  assert.match(workspaceSource, /创建人不能审核自己创建的物料/); assert.match(workspaceSource, /SELF_REVIEW_FORBIDDEN/);
});

test("23 最后修改人禁审且显示具体职责文案", () => {
  assert.deepEqual(reviewResponsibility("editor", "buyer", "editor"), { created: false, lastEditor: true });
  assert.match(workspaceSource, /当前版本最后修改人不能审核该版本/); assert.match(workspaceSource, /LAST_EDITOR_REVIEW_FORBIDDEN/);
});

test("24 submitted_by 本身不构成禁审", () => {
  assert.deepEqual(reviewResponsibility("submitter", "buyer", "editor"), { created: false, lastEditor: false });
  assert.match(workspaceSource, /submitted_by 本身不单独禁止审核/);
});

test("25 approve 权限独立控制", () => assert.deepEqual(reviewCapabilities(["material.review.approve"]), { queue: false, approve: true, reject: false }));
test("26 reject 权限独立控制", () => assert.deepEqual(reviewCapabilities(["material.review.reject"]), { queue: false, approve: false, reject: true }));
test("27 只有 approve 权限时只渲染批准分支", () => assert.match(workspaceSource, /capabilities\.approve \?[^]*审核通过/));
test("28 只有 reject 或两者都无时均有明确分支", () => {
  assert.match(workspaceSource, /capabilities\.reject \?[^]*驳回修改/); assert.match(workspaceSource, /当前账号没有批准或驳回权限/);
});

test("29 VERSION_CONFLICT 保留意见并刷新最新详情", () => {
  assert.match(workspaceSource, /VERSION_CONFLICT[^]*refreshAfterConflict/); assert.match(workspaceSource, /已输入意见保留在页面内存/);
});

test("30 状态变化关闭动作且不披露其他审核人", () => {
  assert.match(workspaceSource, /当前物料已不再处于待审核状态/); assert.match(workspaceSource, /不会披露其他审核人的敏感操作细节/);
});

test("31 批准和驳回发送前均重新 GET 最新详情", () => {
  assert.match(workspaceSource, /prepareLatest\("APPROVE"\)/); assert.match(workspaceSource, /prepareLatest\("REJECT"\)/);
  assert.match(workspaceSource, /const latest = await readLatest\(\)/);
});

test("32 相同 Key、endpoint 和载荷可安全幂等重放", () => {
  const op = createWriteOperation({ key: "fixed-key", method: "POST", endpoint: "/approve", payload: { expected_version: 2 }, type: "APPROVE" });
  assert.equal(sameWriteRequest(op, "POST", "/approve", { expected_version: 2 }), true);
});

test("33 响应丢失后只复用原 Key 和不可变载荷", () => {
  assert.match(workspaceSource, /operation\.payload as Record<string, unknown>, operation/);
  assert.match(workspaceSource, /idempotencyKey: pending\.key/);
});

test("34 RESULT_UNKNOWN 禁止相反或第二个操作", () => {
  assert.match(workspaceSource, /resultUnknown/); assert.match(workspaceSource, /if \(inflightRef\.current\) return inflightRef\.current/);
  assert.match(workspaceSource, /不能执行相反操作/);
});

test("35 IDEMPOTENCY_CONFLICT 不自动换 Key", () => {
  assert.match(workspaceSource, /IDEMPOTENCY_CONFLICT/); assert.match(workspaceSource, /没有自动更换 Key/);
});

test("36 422 清除旧确认并重新加载 Validation", () => {
  assert.match(workspaceSource, /reason\.status === 422[^]*refreshAfterConflict/); assert.match(workspaceSource, /旧确认已失效/);
});

test("37 写期间 401 保留意见且不自动重放", () => assert.match(workspaceSource, /登录状态已失效；当前意见仍在本页内存[^]*不会自动重放/));
test("38 普通 403 关闭正文并使用通用错误", () => assert.match(workspaceSource, /reason\.status === 403[^]*setDetail\(null\)/));
test("39 404 统一由共享 MaterialErrorState 映射", () => assert.match(workspaceSource, /reason\.status === 404[^]*setDetail\(null\)/));
test("40 429 展示 Retry-After 且只主动重试", () => assert.match(workspaceSource, /reason\.status === 429[^]*retryAfterSeconds[^]*主动重试/));
test("41 500 显示安全文案与 request_id", () => {
  assert.match(workspaceSource, /系统暂时无法处理当前审核请求/); assert.match(workspaceSource, /请求编号/);
});

test("42 未发送批准意见或驳回原因触发离开保护", () => {
  assert.match(workspaceSource, /reviewComment\.length > 0 \|\| rejectReason\.length > 0/); assert.match(workspaceSource, /beforeunload/);
});

test("43 审核 return_to 拒绝外部、协议相对、反斜杠和其他 Material 路由", () => {
  const fallback = "/materials/review?page=1&page_size=20&sort=submitted_at_desc";
  for (const value of ["https://evil.example/materials/review", "//evil.example/x", "/materials\\review", "/materials/1/review", "/materials"]) assert.equal(safeReviewReturnTo(value), fallback);
});

test("44 浏览器前进后退和最后有效页回退使用服务端分页", () => {
  assert.match(queueSource, /popstate/); assert.match(queueSource, /current\.page > response\.pagination\.total_pages[^]*navigate/);
  assert.match(queueSource, /value=\{result\.pagination\}/);
});

test("45 对话框具备初始焦点、焦点循环、Escape 和焦点恢复", () => {
  assert.match(workspaceSource, /cancelRef\.current\?\.focus/); assert.match(workspaceSource, /event\.key === "Escape"/);
  assert.match(workspaceSource, /event\.key !== "Tab"/); assert.match(workspaceSource, /trigger\?\.focus/);
});

test("46 1366 布局使用约 300px sticky 审核栏且窄宽降级", () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 310px\)/);
  assert.match(styles, /\.mm-review-aside\s*\{[^}]*position:\s*sticky/); assert.match(styles, /@media \(max-width: 1100px\)[^]*\.mm-review-layout \{ grid-template-columns: 1fr/);
});

test("47 工作台复用只读单元且不出现物料编辑保存控件", () => {
  for (const component of ["MaterialBasicCard", "MaterialResponsibilitiesCard", "MaterialAttributesCard", "MaterialValidationPanel"]) assert.match(workspaceSource, new RegExp(component));
  assert.doesNotMatch(workspaceSource, /保存草稿|审核并编辑|MaterialDraftForm/);
  assert.match(detailSource, /MaterialDetailSections/);
});

test("48 不出现批量审核、多级审核、认领或转交功能", () => assert.doesNotMatch(`${queueSource}\n${workspaceSource}`, /批量审核|多级审核|审核认领|审核转交|强制审核/));

test("49 前端不按角色名过滤、不复制 Validation 规则或行级过滤", () => {
  assert.doesNotMatch(`${queueSource}\n${workspaceSource}`, /["'](?:admin|manager|purchase|engineering)["']/);
  assert.doesNotMatch(`${queueSource}\n${workspaceSource}`, /validateForReview|result\??\.data\.filter/);
});

test("50 受保护写请求缺少 Key 或 CSRF 时 fail-closed", async () => {
  await assert.rejects(api("/api/material-master/drafts/1/approve", { method: "POST", body: "{}" }), (error) => error instanceof ErpApiError && error.code === "PROTECTED_WRITE_CONTEXT_REQUIRED");
  assert.match(clientSource, /PROTECTED_WRITE_CONTEXT_REQUIRED/);
});

test("51 两条路由、共享 Client、页面内存与既有回归边界完整", () => {
  assert.match(queueRoute, /MaterialReviewQueuePage/); assert.match(workspaceRoute, /MaterialReviewWorkspace/);
  assert.equal((queueSource.match(/public\/erp\/api-client\.js/g) || []).length, 1);
  assert.equal((workspaceSource.match(/public\/erp\/api-client\.js/g) || []).length, 1);
  assert.doesNotMatch(`${queueSource}\n${workspaceSource}`, /localStorage|sessionStorage|indexedDB|serviceWorker/i);
});
