import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canCreateDraft, canEditDraft, canSubmitDraft, createWriteOperation, draftFromDetail,
  isDraftDirty, retryAfterSeconds, sameWriteRequest, serializeDraft, stableStringify,
  strictDecimal, strictInteger, unknownAttributeCodes, warningConfirmationFingerprint,
} from "../app/materials/_lib/material-draft.ts";
import { api, ErpApiError } from "../public/erp/api-client.js";

const files = await Promise.all([
  "../app/materials/_components/material-draft-page.tsx", "../app/materials/_components/material-shell.tsx",
  "../public/erp/api-client.js", "../app/materials/materials.css", "../app/materials/new/page.tsx",
  "../app/materials/[materialId]/edit/page.tsx", "../app/materials/_components/material-list-page.tsx",
  "../app/materials/_components/material-detail-workspace.tsx",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
const [pageSource, shellSource, clientSource, styles, createRoute, editRoute, listSource, detailSource] = files;

const schema = {
  category_id: 9, category_name: "普通 FR4", category_path: "PCB / FR4", schema_version: "sha256:test",
  attributes: [
    { attribute_code: "TEXT_A", name: "文本", data_type: "TEXT", required: true, standard_unit: "", compatible_units: [], enum_options: [], display_order: 1, enabled: true, input_contract: { decimal_scale: null, unit_mode: "FORBIDDEN" } },
    { attribute_code: "INT_A", name: "整数", data_type: "INTEGER", required: true, standard_unit: "pcs", compatible_units: ["pcs"], enum_options: [], display_order: 2, enabled: true, input_contract: { decimal_scale: null, unit_mode: "REQUIRED" } },
    { attribute_code: "DEC_A", name: "小数", data_type: "DECIMAL", required: true, standard_unit: "mm", compatible_units: ["mm", "um"], enum_options: [], display_order: 3, enabled: true, input_contract: { decimal_scale: 3, unit_mode: "REQUIRED" } },
    { attribute_code: "BOOL_A", name: "布尔", data_type: "BOOLEAN", required: true, standard_unit: "", compatible_units: [], enum_options: [], display_order: 4, enabled: true, input_contract: { decimal_scale: null, unit_mode: "FORBIDDEN" } },
    { attribute_code: "ENUM_A", name: "枚举", data_type: "ENUM", required: true, standard_unit: "", compatible_units: [], enum_options: [{ code: "A", label: "选项 A" }], display_order: 5, enabled: true, input_contract: { decimal_scale: null, unit_mode: "FORBIDDEN" } },
  ],
};

function validForm() {
  return {
    basic_fields: {
      standard_name: "普通 FR4", unit: "PCS", brand: "", manufacturer: "", manufacturer_part_number: "",
      procurement_type: "PURCHASE", inventory_type: "STOCKED", lot_control_required: false,
      shelf_life_days: "0", inspection_type: "NORMAL", environmental_requirement: "ROHS",
    },
    category_id: 9,
    attributes: {
      TEXT_A: { value: "x", unit: "" }, INT_A: { value: "0", unit: "pcs" }, DEC_A: { value: "1.250", unit: "mm" },
      BOOL_A: { value: false, unit: "" }, ENUM_A: { value: "A", unit: "" },
    },
  };
}

test("01 创建权限只读取 material.draft.create", () => {
  assert.equal(canCreateDraft(["material.draft.create"]), true);
  assert.equal(canCreateDraft(["admin"]), false);
});

test("02 edit-own 使用当前 username 与 created_by 比较", () => {
  assert.equal(canEditDraft(["material.draft.edit_own"], "buyer1", "buyer1"), true);
  assert.equal(canEditDraft(["material.draft.edit_own"], "buyer1", "buyer2"), false);
});

test("03 edit-any 可编辑任意创建人的 DRAFT", () => assert.equal(canEditDraft(["material.draft.edit_any"], "manager", "buyer"), true));
test("04 提交同时需要 submit 与编辑能力", () => {
  assert.equal(canSubmitDraft(["material.draft.submit", "material.draft.edit_own"], "buyer", "buyer"), true);
  assert.equal(canSubmitDraft(["material.draft.submit"], "buyer", "buyer"), false);
});

test("05 dirty 比较忽略对象 key 顺序", () => {
  const left = validForm(); const right = validForm();
  right.attributes = Object.fromEntries(Object.entries(right.attributes).reverse());
  assert.equal(isDraftDirty(left, right), false);
});

test("06 dirty 保留 0 与 false 的语义", () => {
  const right = validForm(); right.attributes.BOOL_A.value = true;
  assert.equal(isDraftDirty(validForm(), right), true);
  right.attributes.BOOL_A.value = false; right.attributes.INT_A.value = "1";
  assert.equal(isDraftDirty(validForm(), right), true);
});

test("07 INTEGER 必须完整匹配且使用安全整数", () => {
  assert.equal(strictInteger("12"), 12); assert.equal(strictInteger("12x"), null);
  assert.equal(strictInteger("1.2"), null); assert.equal(strictInteger("9007199254740992"), null);
});

test("08 INTEGER 空字符串不会转为 0", () => assert.equal(strictInteger(""), null));
test("09 DECIMAL 完整匹配且不接受 NaN Infinity", () => {
  assert.equal(strictDecimal("1.25", 3), 1.25); assert.equal(strictDecimal("1.2x", 3), null);
  assert.equal(strictDecimal("NaN", 3), null); assert.equal(strictDecimal("Infinity", 3), null);
});
test("10 DECIMAL 超过 decimal_scale 时拒绝且不舍入", () => assert.equal(strictDecimal("1.2345", 3), null));

test("11 五种动态属性正确序列化", () => {
  const result = serializeDraft(validForm(), schema);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(Object.keys(result.attributes), ["TEXT_A", "INT_A", "DEC_A", "BOOL_A", "ENUM_A"]);
});

test("12 完整 attributes 保留数值 0", () => assert.equal(serializeDraft(validForm(), schema).attributes.INT_A.value, 0));
test("13 完整 attributes 保留布尔 false", () => assert.equal(serializeDraft(validForm(), schema).attributes.BOOL_A.value, false));
test("14 无单位属性不发送 unit", () => assert.equal("unit" in serializeDraft(validForm(), schema).attributes.TEXT_A, false));
test("15 compatible_units 以外的单位被本地阻止", () => {
  const form = validForm(); form.attributes.DEC_A.unit = "cm";
  assert.ok(serializeDraft(form, schema).issues.some((issue) => issue.code === "LOCAL_UNIT_REQUIRED"));
});
test("16 ENUM 提交稳定 code 而非 label", () => assert.equal(serializeDraft(validForm(), schema).attributes.ENUM_A.value, "A"));
test("17 BOOLEAN 未选择不自动变为 false", () => {
  const form = validForm(); form.attributes.BOOL_A.value = null;
  assert.ok(serializeDraft(form, schema).issues.some((issue) => issue.attribute_code === "BOOL_A"));
});
test("18 可选空属性从最终集合省略", () => {
  const optional = { ...schema, attributes: [{ ...schema.attributes[0], required: false }] };
  const form = validForm(); form.attributes.TEXT_A.value = "";
  assert.equal("TEXT_A" in serializeDraft(form, optional).attributes, false);
});

test("19 详情展示数组显式转换为 code 索引表单", () => {
  const draft = draftFromDetail({ material: { ...validForm().basic_fields, category_id: 9 }, attributes: [{ attribute_code: "BOOL_A", value: false, unit: "" }] });
  assert.equal(draft.attributes.BOOL_A.value, false); assert.equal(draft.category_id, 9);
});

test("20 未知旧属性默认可识别并阻止静默删除", () => {
  const form = validForm(); form.attributes.LEGACY_X = { value: "legacy", unit: "" };
  assert.deepEqual(unknownAttributeCodes(form, schema), ["LEGACY_X"]);
  const disabledSchema = { ...schema, attributes: schema.attributes.map((item) => item.attribute_code === "TEXT_A" ? { ...item, enabled: false } : item) };
  assert.deepEqual(unknownAttributeCodes(form, disabledSchema), ["LEGACY_X", "TEXT_A"]);
  assert.equal("TEXT_A" in serializeDraft(form, disabledSchema).attributes, false);
});

test("21 幂等操作保存不可变载荷副本", () => {
  const payload = { expected_version: 1, basic_fields: { standard_name: "A" } };
  const op = createWriteOperation({ key: "12345678", method: "PATCH", endpoint: "/drafts/1", payload, type: "SAVE" });
  payload.basic_fields.standard_name = "B";
  assert.equal(op.payload.basic_fields.standard_name, "A");
  assert.throws(() => { op.payload.basic_fields.standard_name = "C"; }, TypeError);
});

test("22 同一 Key 只能用于完全相同 method endpoint payload", () => {
  const op = createWriteOperation({ key: "12345678", method: "PATCH", endpoint: "/drafts/1", payload: { a: 1 }, type: "SAVE" });
  assert.equal(sameWriteRequest(op, "PATCH", "/drafts/1", { a: 1 }), true);
  assert.equal(sameWriteRequest(op, "PATCH", "/drafts/1", { a: 2 }), false);
});

test("23 WARNING 确认指纹绑定版本 Schema 与 Validation", () => {
  const issue = [{ source: "SERVER", code: "WARN", severity: "WARNING", field: "brand", message: "warn" }];
  assert.notEqual(warningConfirmationFingerprint(1, 2, "s1", issue), warningConfirmationFingerprint(1, 3, "s1", issue));
});

test("24 Retry-After 秒数被安全解析", () => assert.equal(retryAfterSeconds("37"), 37));
test("25 Retry-After HTTP 日期不会产生负数", () => assert.ok(retryAfterSeconds(new Date(Date.now() + 1500).toUTCString()) >= 0));
test("26 stableStringify 规范化嵌套 key 顺序", () => assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 })));

test("27 受保护 Material 写请求缺少上下文时 fail-closed", async () => {
  await assert.rejects(api("/api/material-master/drafts", { method: "POST", body: "{}" }), (error) => error instanceof ErpApiError && error.code === "PROTECTED_WRITE_CONTEXT_REQUIRED");
});

test("28 显式 Key 和 CSRF 被写入 Header 且不生成第二个 Key", async () => {
  const originalFetch = globalThis.fetch; let captured;
  globalThis.fetch = async (_path, options) => { captured = options; return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try { await api("/api/material-master/drafts", { method: "POST", body: "{}", protectedWrite: { idempotencyKey: "fixed-key-123", csrfToken: "csrf-token" } }); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(captured.headers["Idempotency-Key"], "fixed-key-123"); assert.equal(captured.headers["X-CSRF-Token"], "csrf-token");
});

test("29 共享 Client 覆盖 POST 创建 PATCH 保存 POST submit", () => {
  assert.match(clientSource, /\["POST", "PATCH"\]\.includes\(method\)/);
  assert.match(pageSource, /mode === "create" \? "POST" : "PATCH"/); assert.match(pageSource, /\/submit/);
});
test("30 Session Context 暴露 permissions 和 csrf_token 且不建立第二套认证", () => {
  assert.match(shellSource, /permissions\?: string\[\]/); assert.match(shellSource, /csrf_token\?: string/); assert.doesNotMatch(pageSource, /login-card|password.*input/i);
});
test("31 初始无权限时不加载分类或草稿正文", () => assert.match(pageSource, /if \(!initialAllowed\) return/));
test("32 页面未硬编码 admin manager purchase engineering", () => assert.doesNotMatch(pageSource, /["'](?:admin|manager|purchase|engineering)["']/));
test("33 新建与编辑两条真实 Vinext 路由存在", () => { assert.match(createRoute, /mode="create"/); assert.match(editRoute, /mode="edit"/); });
test("34 创建成功读取 material_id 并跳转编辑路由", () => assert.match(pageSource, /response\.data\.material_id[^]*\/edit\?return_to=/));
test("35 创建 POST 固定 MANUAL 且省略 source_ref", () => {
  assert.match(pageSource, /source_type: "MANUAL"/); assert.doesNotMatch(pageSource, /source_ref:/);
});
test("36 PATCH 发送 expected_version 与完整聚合", () => {
  assert.match(pageSource, /expected_version: expectedVersion[^]*basic_fields: basicFields[^]*attributes: serialized\.attributes/);
});
test("37 写成功后重新 GET 统一详情", () => assert.match(pageSource, /syncAfterSave[^]*readLatestDetail/));
test("38 SAVED_UNSYNCED 明确禁止继续写并提供重新加载", () => {
  assert.match(pageSource, /SAVED_UNSYNCED/); assert.match(pageSource, /草稿已保存，但无法同步最新详情/); assert.match(pageSource, /重新加载最新详情/);
});
test("39 RESULT_UNKNOWN 只提供原请求安全重试", () => {
  assert.match(pageSource, /RESULT_UNKNOWN/); assert.match(pageSource, /使用原请求安全重试/); assert.match(pageSource, /operationRef\.current/);
  assert.match(pageSource, /\["PENDING", "RESULT_UNKNOWN"\][^]*operationRef\.current\?\.state/);
  assert.match(pageSource, /writeFlowBusyRef\.current/);
  assert.match(pageSource, /submitBusyRef\.current/);
});
test("40 保存并提交严格包含 PATCH GET ERROR WARNING submit", () => {
  assert.match(pageSource, /saveDraft\(true\)/); assert.match(pageSource, /prepareSubmit/); assert.match(pageSource, /issues\.some[^]*ERROR/); assert.match(pageSource, /pendingSubmitDetail/); assert.match(pageSource, /submitNow/);
});
test("41 未修改草稿直接 GET 后准备提交", () => {
  assert.match(pageSource, /if \(dirty\)[^]*readLatestDetail\(\)[^]*prepareSubmit/);
  assert.match(pageSource, /disabled=\{!canSave \|\| !dirty\}[^]*保存草稿/);
});
test("42 submit 成功进入只读详情", () => assert.match(pageSource, /op\.type === "SUBMIT"[^]*\/materials\/\$\{materialId\}\?return_to=/));
test("43 版本冲突保留本地输入并加载服务器只读对照", () => {
  assert.match(pageSource, /VERSION_CONFLICT[^]*readLatestDetail[^]*setConflictDetail/); assert.match(pageSource, /本地标准名称/); assert.match(pageSource, /服务器标准名称/);
});
test("44 放弃本地修改需要二次确认", () => assert.match(pageSource, /title: "放弃本地修改？"[^]*danger: true/));
test("45 Schema 失败时没有 seed 或旧 Schema 兜底", () => {
  assert.match(pageSource, /setSchema\(null\)[^]*保存和提交已停止/); assert.doesNotMatch(pageSource, /seed|fallbackSchema|legacySchema/i);
});
test("46 分类切换已有输入时先显示确认对话框", () => assert.match(pageSource, /hasInput[^]*title: "更换分类？"/));
test("47 未知旧属性显示 code 原值单位并确认删除", () => {
  assert.match(pageSource, /当前 Schema 无法映射的现有属性/); assert.match(pageSource, /attribute_code/); assert.match(pageSource, /确认删除所列属性/);
});
test("48 last_rejection 只读显示原因审核人时间版本", () => {
  for (const text of ["最近一次驳回", "驳回版本", "审核人", "时间", "该历史只读"]) assert.match(pageSource, new RegExp(text));
});
test("49 Validation 区分本地检查与服务端校验并支持定位焦点", () => {
  assert.match(pageSource, /本地检查/); assert.match(pageSource, /服务端校验/); assert.match(pageSource, /scrollIntoView/); assert.match(pageSource, /target\?\.focus/);
});
test("50 dirty 和 RESULT_UNKNOWN 时注册 beforeunload", () => assert.match(pageSource, /!dirty && operation\?\.state !== "RESULT_UNKNOWN"[^]*beforeunload/));
test("51 页面不把草稿 Key Token 写入持久存储或 URL", () => assert.doesNotMatch(pageSource, /localStorage|sessionStorage|indexedDB|serviceWorker/i));
test("52 对话框具备初始焦点 Tab 循环 Escape 和焦点恢复基础", () => {
  assert.match(pageSource, /cancelRef\.current\?\.focus/); assert.match(pageSource, /event\.key !== "Tab"/); assert.match(pageSource, /event\.key === "Escape"/); assert.match(pageSource, /trigger\?\.focus/);
});
test("53 1366 布局保留 minmax 主体 200px 辅助栏 三到二到一列和 sticky 操作栏", () => {
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) 200px/); assert.match(styles, /repeat\(3, minmax\(0, 1fr\)\)/); assert.match(styles, /repeat\(2, minmax\(0, 1fr\)\)/); assert.match(styles, /\.mm-draft-actions[^]*position:\s*sticky/);
});
test("54 列表和详情入口由 permissions 驱动且不出现审核队列批准驳回导入 AI", () => {
  assert.match(listSource, /canCreateDraft/); assert.match(detailSource, /canEditDraft/);
  assert.doesNotMatch(`${pageSource}\n${listSource}\n${detailSource}`, />\s*(?:审核队列|批准|驳回|导入|AI)\s*</);
});
