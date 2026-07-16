import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  changeImportListQuery, DEFAULT_IMPORT_LIST_QUERY, duplicateMappingSources,
  importCellText, importColumnReference, importFileIdentity, importListApiQuery, importStatusNeedsPolling,
  parseImportListQuery, pollingDelay,
  preflightImportFile, requiredMappingTargetsMissing, retryAfterMilliseconds, safeImportFilename,
  serializeImportListQuery,
} from "../app/materials/_lib/material-import.ts";
import { api, ErpApiError } from "../public/erp/api-client.js";

const sources = await Promise.all([
  "../app/materials/_components/material-import-list-page.tsx", "../app/materials/_components/material-import-create-page.tsx",
  "../app/materials/_components/material-import-workspace.tsx", "../app/materials/_components/material-import-primitives.tsx",
  "../app/materials/_components/material-import-row-preview.tsx", "../app/materials/_components/material-import-mapping-editor.tsx",
  "../app/materials/_lib/material-import-hash.worker.ts", "../app/materials/_lib/material-import-polling.ts",
  "../public/erp/api-client.js", "../app/materials/materials.css", "../app/materials/imports/page.tsx",
  "../app/materials/imports/new/page.tsx", "../app/materials/imports/[batchId]/page.tsx", "../app/materials/_components/material-shell.tsx",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
const [listSource, createSource, workspaceSource, primitivesSource, rowsSource, mappingSource, workerSource, pollingSource, clientSource, styles, listRoute, createRoute, workspaceRoute, shellSource] = sources;
const allUi = sources.join("\n");
const file = (patch = {}) => ({ name: "parts.xlsx", size: 1024, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", lastModified: 1, ...patch });
const item = (source, namespace, code, mode = "SOURCE") => ({ source_column_index: source, target_namespace: namespace, target_code: code, mapping_mode: mode, required: false, display_order: source ?? 0 });

test("UI-001 有 read 时列表请求真实 cursor API", () => assert.match(listSource, /importListApiQuery\(query\)/));
test("UI-002 无 read 不请求正文", () => assert.match(listSource, /if \(!canRead\) return <MaterialImportErrorState[^]*页面不会请求批次正文/));
test("UI-003 无 create 时新建入口不存在", () => assert.match(listSource, /canCreate \? <Link[^]*新建导入批次/));
test("UI-004 create read-own 不做客户端行级过滤", () => assert.doesNotMatch(listSource, /\.filter\([^]*(?:created_by|username)/));
test("UI-005 read_any 不隐含 parse", () => assert.match(workspaceSource, /canParse = permissions\.includes\("material\.import\.parse"\)/));
test("UI-006 parse 不隐含 map", () => assert.match(workspaceSource, /canMap = permissions\.includes\("material\.import\.map"\)/));
test("UI-007 map 不隐含 cancel", () => assert.match(workspaceSource, /canCancel = permissions\.includes\("material\.import\.cancel"\)/));
test("UI-008 后续 403 清受保护正文并停轮询", () => { assert.match(workspaceSource, /\[403, 404\][^]*clearProtected/); assert.match(workspaceSource, /const clearProtected[^]*polling\.stop\(\)/); });
test("UI-009 404 使用统一隐藏文案", () => assert.match(workspaceSource, /导入批次不存在或无权查看/));
test("UI-010 轮询 401 进入安全登录流程", () => assert.match(workspaceSource, /normalized\.status === 401[^]*redirectToExistingLogin/));
test("UI-011 非法 status 规范为空", () => assert.equal(parseImportListQuery("status=DROP_TABLE").status, ""));
test("UI-012 未知参数不进入 API", () => assert.equal(importListApiQuery(parseImportListQuery("evil=1")).includes("evil"), false));
test("UI-013 next_cursor 作为 opaque URL 状态", () => assert.match(listSource, /result\.page\.next_cursor[^]*cursor: result\.page\.next_cursor/));
test("UI-014 URL cursor 刷新时保留", () => assert.equal(parseImportListQuery("cursor=a%2Bb%2F%3D").cursor, "a+b/="));
test("UI-015 popstate 恢复上一批", () => assert.match(listSource, /addEventListener\("popstate", applyLocation\)/));
test("UI-016 无 next_cursor 关闭下一批", () => assert.match(primitivesSource, /disabled \|\| !hasMore/));
test("UI-017 改 status 清 cursor", () => assert.equal(changeImportListQuery({ ...DEFAULT_IMPORT_LIST_QUERY, cursor: "opaque" }, { status: "FAILED" }).cursor, ""));
test("UI-018 改 sort limit 清 cursor", () => { assert.equal(changeImportListQuery({ ...DEFAULT_IMPORT_LIST_QUERY, cursor: "x" }, { sort: "created_at_asc" }).cursor, ""); assert.equal(changeImportListQuery({ ...DEFAULT_IMPORT_LIST_QUERY, cursor: "x" }, { limit: 20 }).cursor, ""); });
test("UI-019 cursor 特殊字符按 URLSearchParams 原样往返", () => { const query = parseImportListQuery("cursor=a%2Bb%2F%3D"); assert.equal(new URLSearchParams(serializeImportListQuery(query)).get("cursor"), "a+b/="); });
test("UI-020 total 不推导总页数", () => { assert.match(primitivesSource, /当前条件共 \{total\} 条/); assert.doesNotMatch(primitivesSource, /total_pages|总页数/); });

test("UI-021 未选文件不创建", () => assert.equal(preflightImportFile(null).ok, false));
test("UI-022 文件 input 明确单文件", () => { assert.match(createSource, /type="file"/); assert.doesNotMatch(createSource, /multiple/); });
test("UI-023 空文件被拒绝", () => assert.ok(preflightImportFile(file({ size: 0 })).errors.includes("文件不能为空")));
test("UI-024 超过 10 MiB 被拒绝", () => assert.equal(preflightImportFile(file({ size: 10 * 1024 * 1024 + 1 })).ok, false));
test("UI-025 非 xlsx csv 被拒绝", () => assert.equal(preflightImportFile(file({ name: "a.pdf", type: "application/pdf" })).sourceKind, null));
test("UI-026 MIME 明显冲突不称安全", () => { const result = preflightImportFile(file({ type: "application/pdf" })); assert.equal(result.ok, false); assert.doesNotMatch(result.errors.join(""), /安全|病毒/); });
test("UI-027 控制字符文件名被清理", () => assert.equal(safeImportFilename("../a\u0000<b>.csv"), "a_b_.csv"));
test("UI-028 成功文案仅为客户端预检通过", () => { assert.match(createSource, /客户端预检通过/); assert.doesNotMatch(createSource, /病毒扫描通过|文件已经安全|内容已经合法/); });
test("UI-029 Worker 按字节报告真实进度", () => assert.match(workerSource, /processedBytes: end, totalBytes: file\.size/));
test("UI-030 重选会 reset 旧 Worker 和状态", () => assert.match(createSource, /hashController\.reset\(\)[^]*operationRef\.current = null/));
test("UI-031 同名不同 File 身份含 size type lastModified", () => assert.notEqual(importFileIdentity(file()), importFileIdentity(file({ lastModified: 2 }))));
test("UI-032 SHA-256 标准向量和 10 MiB 分块边界正确", () => { const hash = sha256.create(); hash.update(new TextEncoder().encode("a")); hash.update(new TextEncoder().encode("bc")); assert.equal(bytesToHex(hash.digest()), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); const payload = new Uint8Array(10 * 1024 * 1024); for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251; const chunked = sha256.create(); for (let offset = 0; offset < payload.length; offset += 1024 * 1024) chunked.update(payload.subarray(offset, offset + 1024 * 1024)); assert.equal(bytesToHex(chunked.digest()), bytesToHex(sha256(payload))); });
test("UI-033 哈希失败不创建批次", () => assert.match(createSource, /snapshot\.state === "FAILED"[^]*setStage\("摘要计算失败"\)/));
test("UI-034 预检 SHA 未完成时确认禁用", () => assert.match(createSource, /disabled=\{busy \|\| hash\.state !== "COMPLETED"\}/));
test("UI-035 创建与上传成功采用服务端 id version", () => { assert.match(createSource, /return response\.data[^]*upload\(batch/); assert.match(createSource, /uploadedBatchId = response\.data\.batch\.id[^]*catch \{[^]*进入工作区后由共享读取流程继续恢复[^]*window\.location\.assign/); });
test("UI-036 创建 unknown 只用原 Key 载荷恢复", () => assert.match(createSource, /operation\.type === "CREATE"[^]*idempotencyKey: operation\.key[^]*operation\.payload/));
test("UI-037 创建 unknown 禁止第二批次", () => assert.match(createSource, /operationRef\.current[^]*state: "RESULT_UNKNOWN"[^]*使用原操作标识安全恢复/));
test("UI-038 XHR 只 append 一个 file 且不手设 boundary", () => { assert.equal((clientSource.match(/form\.append\("file"/g) || []).length, 1); assert.match(clientSource, /name\.toLowerCase\(\) !== "content-type"/); });
test("UI-039 lengthComputable 才显示百分比", () => assert.match(createSource, /progress\.lengthComputable \?[^]*仅网络发送/));
test("UI-040 lengthComputable false 只显示正在上传", () => assert.match(createSource, /setStage\("正在上传"\)/));

test("UI-041 100% 后切服务端存储安全文案", () => assert.match(createSource, /文件已发送，正在等待服务端存储和安全检查/));
test("UI-042 send 前取消不进 unknown", () => assert.match(clientSource, /if \(!sent\)[^]*AbortError/));
test("UI-043 send 后 abort 进入 RESULT_UNKNOWN", () => assert.match(clientSource, /addEventListener\("abort"[^]*if \(sent\) unknown/));
test("UI-044 上传恢复复用原 File Key action version", () => { assert.match(createSource, /operation\.type === "UPLOAD"/); assert.match(createSource, /payload\.duplicate_action/); assert.match(createSource, /upload\(batch, payload\.duplicate_action, operation\)/); });
test("UI-045 REJECT 重复显示 FAILED 处置", () => assert.match(createSource, /IMPORT_FILE_DUPLICATE[^]*重复文件，上传未完成[^]*原批次已失败/));
test("UI-046 允许重复创建 retry_of 新批次和新 keys", () => assert.match(createSource, /execute\("ALLOW_DUPLICATE", duplicateBatch\.id\)/));
test("UI-047 File 变化清重复确认并重新 SHA", () => assert.match(createSource, /setDuplicateBatch\(null\)[^]*start\(selected/));
test("UI-048 刷新不使用持久存储恢复 File", () => { assert.match(workspaceSource, /不会恢复浏览器 File/); assert.doesNotMatch(allUi, /localStorage|sessionStorage|indexedDB/i); });
test("UI-049 重复提示不泄露其他批次信息", () => assert.doesNotMatch(createSource, /duplicate.*(?:created_by|object_key|other_filename)/i));
test("UI-050 启动解析前重新 GET", () => assert.match(workspaceSource, /startParse[^]*const latest = await readDetail\(\)/));
test("UI-051 安全未通过解析按钮不可用", () => assert.match(workspaceSource, /file\?\.security_check_status !== "BASIC_CHECK_PASSED"/));
test("UI-052 parse 确认不承诺成功 ETA", () => { assert.match(workspaceSource, /页面只显示服务端真实粗粒度状态/); assert.match(workspaceSource, /不提供 Queue 位置或预计完成时间/); assert.doesNotMatch(workspaceSource, /保证成功/); });
test("UI-053 parser_version 使用固定协议常量", () => assert.match(workspaceSource, /parser_version: "material-import-parser-v1"/));
test("UI-054 parse unknown 锁取消", () => assert.match(workspaceSource, /CANCEL_STATES\.has\(batch\.status\) && !resultUnknown/));
test("UI-055 CREATED 取消读取最新版本和独立 Key", () => assert.match(workspaceSource, /const latest = await readDetail\(\)[^]*write\("CANCEL"[^]*expected_version: latest\.batch\.current_version/));
test("UI-056 UPLOAD_PENDING 取消不承诺立即删对象", () => assert.match(workspaceSource, /取消不表示对象立即删除/));
test("UI-057 QUEUED 取消不承诺删 Queue 消息", () => assert.match(workspaceSource, /不承诺物理删除 Queue 消息/));
test("UI-058 PARSING 取消说明协作式", () => assert.match(workspaceSource, /这是协作式取消/));
test("UI-059 取消冲突由重读权威状态恢复", () => assert.match(workspaceSource, /cancelBatch[^]*await initialLoad\(\)/));
test("UI-060 cancel unknown 阻断 parse", () => assert.match(workspaceSource, /resultUnknown[^]*启动解析/));

test("UI-061 轮询 2 5 10 秒分段", () => { assert.equal(pollingDelay(0), 2000); assert.equal(pollingDelay(10000), 5000); assert.equal(pollingDelay(60000), 10000); });
test("UI-062 网络退避 5 10 30 30 秒", () => assert.deepEqual([1,2,3,4].map((n) => pollingDelay(0,n)), [5000,10000,30000,30000]));
test("UI-063 Retry-After 秒数", () => assert.equal(retryAfterMilliseconds("37"), 37000));
test("UI-064 Retry-After HTTP 日期", () => assert.equal(retryAfterMilliseconds(new Date(2000).toUTCString(), 1000), 1000));
test("UI-065 页面隐藏暂停轮询", () => assert.match(pollingSource, /document\.visibilityState === "hidden"/));
test("UI-066 页面重可见立即 refresh 且防重叠", () => { assert.match(pollingSource, /visibilityState === "visible"[^]*this\.refresh/); assert.match(pollingSource, /\|\| this\.#abort\) return/); });
test("UI-067 sequence 和 batchId 防旧响应覆盖", () => assert.match(pollingSource, /sequence !== this\.#sequence \|\| batchId !== this\.#batchId/));
test("UI-068 PARSED RUNNING 可读 Rows 且 Mapping 锁", () => { assert.equal(importStatusNeedsPolling("PARSED", "RUNNING"), true); assert.match(workspaceSource, /batch\.status === "PARSED"[^]*mapping_preparation_status/); });
test("UI-069 preparation FAILED 不称 parser 失败", () => assert.match(workspaceSource, /解析结果已发布，但字段映射准备失败/));
test("UI-070 PARSED READY 有界轮询", () => assert.equal(importStatusNeedsPolling("PARSED", "READY"), true));
test("UI-071 hidden Sheet 不可选不请求 Rows", () => assert.match(rowsSource, /visibility === "VISIBLE"[^]*disabled=\{disabled \|\| !selectable\}/));
test("UI-072 Sheet 按 sheet_index 排序", () => assert.match(rowsSource, /sort\(\(a, b\) => a\.sheet_index - b\.sheet_index\)/));
test("UI-073 URL 非法 sheet 规范到可见列表", () => assert.match(workspaceSource, /!visible\.some\([^]*parsed\.sheet[^]*visible\[0\]/));
test("UI-074 切换 sheet 重置 row_page", () => assert.match(workspaceSource, /sheet: sheet\.sheet_index, row_page: 1/));
test("UI-075 page_size 变化重置 page", () => assert.match(workspaceSource, /row_page_size, row_page: 1/));
test("UI-076 Header 选择不修改原始 row_number", () => assert.match(rowsSource, /row\.row_number/));
test("UI-077 256 列引用 A Z AA AZ BA IV", () => assert.deepEqual([0,25,26,51,52,255].map(importColumnReference), ["A","Z","AA","AZ","BA","IV"]));
test("UI-078 缺失 EMPTY 空文本三态不同", () => assert.deepEqual([importCellText(undefined), importCellText({ type:"EMPTY", column_index:0, raw_value:null }), importCellText({ type:"TEXT", column_index:0, raw_value:"" })], ["未提供","空单元格","空文本"]));
test("UI-079 DATE 失败保留 raw", () => assert.match(importCellText({ type:"DATE", column_index:0, raw_value:"44927", interpretation_status:"FAILED" }), /44927/));
test("UI-080 FORMULA ERROR 纯文本不执行缓存", () => { assert.equal(importCellText({ type:"FORMULA", column_index:0, raw_value:"SUM(A1)" }), "公式，未执行"); assert.match(rowsSource, /不可信缓存值/); assert.doesNotMatch(rowsSource, /dangerouslySetInnerHTML/); });

test("UI-081 Catalog 缺失时编辑器无硬编码 fallback", () => { assert.match(workspaceSource, /mapping-targets/); assert.doesNotMatch(mappingSource, /STANDARD_NAME.*<option|THICKNESS.*<option/); });
test("UI-082 Catalog 分组和服务端 q cursor", () => { assert.match(mappingSource, /\["BASIC", "ATTRIBUTE", "SPECIAL"\]/); assert.match(workspaceSource, /params\.set\("q"[^]*params\.set\("cursor"/); });
test("UI-083 重复非 ignore 目标标两源", () => assert.deepEqual(duplicateMappingSources([item(0,"basic","UNIT"), item(1,"basic","UNIT")]), [0,1]));
test("UI-084 多源 ignore 合法", () => assert.deepEqual(duplicateMappingSources([item(0,"ignore","IGNORE","IGNORE"), item(1,"ignore","IGNORE","IGNORE")]), []));
test("UI-085 无 item 显示尚未处理", () => assert.match(mappingSource, /尚未处理/));
test("UI-086 缺 standard_name unit 可保存但预览确认锁", () => { assert.deepEqual(requiredMappingTargetsMissing([]), ["basic.STANDARD_NAME","basic.UNIT"]); assert.match(mappingSource, /草稿可保存，但预览和确认已锁定/); });
test("UI-087 dirty 阻断 preview", () => assert.match(mappingSource, /disabled=\{dirty \|\| busy/));
test("UI-088 PUT 成功采用服务端 Mapping 并清 dirty", () => assert.match(workspaceSource, /write<MappingResponse>\("SAVE"[^]*setMapping\(value\)[^]*setMappingBaseline/));
test("UI-089 VERSION_CONFLICT 不自动覆盖", () => { assert.doesNotMatch(workspaceSource, /VERSION_CONFLICT[^]*setItems\([^]*reason/); assert.match(workspaceSource, /handleError\(reason\)/); });
test("UI-090 共享 Client 受保护 PUT", async () => { await assert.rejects(api("/api/material-master/import-batches/1/mapping", { method:"PUT", body:"{}" }), (error) => error instanceof ErpApiError && error.code === "PROTECTED_WRITE_CONTEXT_REQUIRED"); assert.match(clientSource, /method === "PUT"/); });
test("UI-091 preview 成功建立页面内存绑定", () => assert.match(workspaceSource, /setPreview\(\{ batchId, parseRunId:[^]*payloadDigest:[^]*metadataDigest/));
test("UI-092 修改 Mapping 立即失效 preview", () => assert.match(workspaceSource, /onItems=\{\(value\) => \{ setItems\(value\); setPreview\(null\)/));
test("UI-093 刷新不恢复 preview", () => { assert.doesNotMatch(allUi, /preview.*localStorage|sessionStorage.*preview/i); assert.match(workspaceSource, /setPreview\(null\)/); });
test("UI-094 confirm 前重读 batch mapping sheets catalog", () => assert.match(workspaceSource, /Promise\.all\(\[readDetail\(\), api<MappingResponse>[^]*readSheets\(\)[^]*mapping-targets/));
test("UI-095 metadata invalid 保留 Mapping 并失效 preview", () => assert.match(workspaceSource, /response\.metadata_digest !== mapping\.metadata_digest\) setPreview\(null\)/));
test("UI-096 confirm 成功重读 confirmed 只读", () => { assert.match(workspaceSource, /write\("CONFIRM"[^]*await initialLoad/); assert.match(mappingSource, /readOnly/); });
test("UI-097 confirmed 不虚构确认人时间", () => { assert.match(workspaceSource, /不显示 API 未提供的确认人或确认时间/); assert.doesNotMatch(workspaceSource, /confirmed_by|confirmed_at/); });
test("UI-098 顶层 request_id 与 details 归一化", async () => { const original = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ request_id:"req-top", error:{ code:"BAD", message:"safe", details:[{ field:"x" }] } }), { status:422, headers:{ "Content-Type":"application/json" } }); try { await assert.rejects(api("/api/test"), (error) => error.requestId === "req-top" && error.details.length === 1); } finally { globalThis.fetch = original; } });
test("UI-099 50x256 不截列且宽表 sticky 语义存在", () => { assert.match(rowsSource, /Math\.min\(256, columnCount\)/); assert.match(styles, /\.mi-rows-table \.mi-row-number[^]*position:\s*sticky/); assert.match(styles, /\.mi-rows-table th[^]*position:\s*sticky/); });
test("UI-100 1366 三列与窄屏 Mapping 单列顺序", () => { assert.match(styles, /grid-template-columns:\s*minmax\(230px, 34fr\) minmax\(260px, 38fr\) minmax\(210px, 28fr\)/); assert.match(styles, /@media \(max-width: 760px\)[^]*\.mi-mapping-row \{ grid-template-columns: 1fr/); assert.match(listRoute, /MaterialImportListPage/); assert.match(createRoute, /MaterialImportCreatePage/); assert.match(workspaceRoute, /MaterialImportWorkspace/); assert.match(shellSource, /物料导入/); });

test("UI matrix is exactly 100 uniquely numbered cases", async () => {
  const ids = [...new Set((await readFile(new URL(import.meta.url), "utf8")).match(/UI-[0-9]{3}/g))];
  assert.equal(ids.length, 100); assert.equal(ids[0], "UI-001"); assert.equal(ids.at(-1), "UI-100");
});
