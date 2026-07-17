import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, NORMALIZATION_ISSUE_LABELS, boundedValue, issueLabel,
  normalizationIssuesEndpoint, normalizedRowsEndpoint, parseNormalizationQuery, rowProgress,
  safeIssueDetails, shortDigest, strictPositiveInteger, validRunCounts, validateComposite,
  validateIssuesResponse, validateRowDetail, validateRowsResponse,
} from "../app/materials/_lib/material-import-normalization.ts";
import { pollingDelay, retryAfterMilliseconds } from "../app/materials/_lib/material-import.ts";

const component = await readFile(new URL("../app/materials/_components/material-import-normalization-review.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../app/materials/_components/material-import-workspace.tsx", import.meta.url), "utf8");
const primitives = await readFile(new URL("../app/materials/_components/material-import-primitives.tsx", import.meta.url), "utf8");
const polling = await readFile(new URL("../app/materials/_lib/material-import-polling.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/materials/materials.css", import.meta.url), "utf8");
const protocol = await readFile(new URL("../app/materials/_lib/material-import-normalization.ts", import.meta.url), "utf8");
const all = [component, workspace, primitives, polling, styles, protocol].join("\n");

const batch = (status = "NORMALIZED", patch = {}) => ({ id: 7, batch_no: "IMP-7", source_kind: "CSV", status, retry_of_batch_id: null, created_by: "owner", current_version: 9, file_count: 1, total_rows: 2, accepted_rows: 2, rejected_rows: 0, failure_stage: null, failure_code: null, failure_message: null, created_at: "2026-07-17T00:00:00Z", updated_at: "2026-07-17T00:00:00Z", ...patch });
const run = (patch = {}) => ({ id: 11, parse_run_id: 3, mapping_id: 4, mapping_version: 2, mapping_digest: "a".repeat(64), processor_version: "old", payload_schema_version: 1, metadata_digest: "b".repeat(64), run_status: "SUCCEEDED", current_stage: "COMPLETE", total_rows: 2, processed_rows: 2, valid_rows: 1, warning_rows: 1, error_rows: 0, issue_count: 1, warning_count: 1, error_count: 0, result_digest: "c".repeat(64), created_at: "2026-07-17T00:00:00Z", updated_at: "2026-07-17T00:00:00Z", ...patch });
const query = (search = "", status = "NORMALIZED", current = run()) => parseNormalizationQuery(search, batch(status), current);
const row = { id: 5, source_sheet_index: 0, source_row_number: 12, source_raw_row_hash: "d".repeat(64), normalized_payload_hash: "e".repeat(64), row_status: "WARNING", error_count: 0, warning_count: 1, created_at: "2026-07-17T00:00:00Z" };
const detail = { batch_id: 7, normalization_run_id: 11, row, request_id: "r", normalized_payload: { schema_version: 1, lineage: { batch_id: 7, parse_run_id: 3, normalization_run_id: 11, mapping_id: 4, mapping_version: 2, mapping_digest: "a".repeat(64), metadata_digest: "b".repeat(64), processor_version: "old", sheet_index: 0, row_number: 12, source_row_number: 12, raw_row_hash: "d".repeat(64) }, basic: {}, attributes: {}, category_hint: null, supplier_reference: {}, deferred_validation: [], row_status: "WARNING", issue_summary: { issue_count: 1, error_count: 0, warning_count: 1 } } };
const tests = [];
const add = (id, name, fn) => tests.push([id, name, fn]);

add("NUI-RS-001", "未启动默认 normalize", () => assert.equal(query("", "MAPPING_CONFIRMED", null).view, "normalize"));
add("NUI-RS-002", "已发布默认 normalized", () => assert.equal(query().view, "normalized"));
add("NUI-RS-003", "无 Current 修正结果 view", () => assert.equal(query("view=normalized", "NORMALIZING", null).view, "normalize"));
add("NUI-RS-004", "重跑保留旧结果入口", () => assert.match(component, /current \? <><button[^]*结果行/));
add("NUI-RS-005", "无 Current 移除 row", () => assert.equal(query("view=normalized&row=9", "MAPPING_CONFIRMED", null).row, null));
add("NUI-RS-006", "normalize 视图移除 row", () => assert.equal(query("view=normalize&row=9").row, null));
add("NUI-RS-007", "未知 view 走 allowlist", () => assert.equal(query("view=drop").view, "normalized"));
add("NUI-RS-008", "七步 Stepper 映射确认后第六当前", () => assert.match(primitives, /MAPPING_CONFIRMED[^]*return 5/));
add("NUI-RS-009", "Stepper 有失败文字语义", () => assert.match(primitives, /terminalFailure[^]*failed/));
add("NUI-RS-010", "重跑失败保留结果横幅", () => assert.match(component, /最近一次重新运行未成功[^]*当前仍展示上一次已发布结果/));
add("NUI-RS-011", "1366 七步可读布局", () => assert.match(styles, /grid-template-columns:\s*repeat\(7/));
add("NUI-RS-012", "700 Drawer 全宽", () => assert.match(styles, /@media \(max-width: 760px\)[^]*\.min-drawer \{ width: 100vw/));

add("NUI-ID-001", "启动前复合读取 B M S", () => assert.match(component, /Promise\.all\(\[compositeRead\(\), api<MappingResponse>/));
add("NUI-ID-002", "Mapping 状态必须 CONFIRMED", () => assert.match(component, /mapping\.mapping\.mapping_status !== "CONFIRMED"/));
add("NUI-ID-003", "首次 Body 仅 Version 与 Processor", () => assert.match(component, /expected_version: batch\.current_version, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION/));
add("NUI-ID-004", "Processor 使用共享常量", () => assert.equal(MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, "material-import-normalizer-v1"));
add("NUI-ID-005", "业务重试入口独立", () => assert.match(component, /canRetry[^]*重试规范化/));
add("NUI-ID-006", "Unknown 重放冻结 Body", () => assert.match(component, /existing\?\.frozen_body[^]*body: next\.frozen_body/));
add("NUI-ID-007", "Unknown 锁全部冲突写", () => assert.match(component, /const unknown = Boolean\(unknownOperation\)[^]*!unknown/));
add("NUI-ID-008", "明确响应不由前端改写 Unknown", () => assert.match(component, /normalized\.resultUnknown \? "RESULT_UNKNOWN" : "FAILED"/));
add("NUI-ID-009", "Unknown 复用现有离开保护", () => assert.match(workspace, /useMaterialImportUnsavedGuard\(dirty \|\| resultUnknown/));
add("NUI-ID-010", "不使用持久存储恢复 Key", () => assert.doesNotMatch(all, /localStorage|sessionStorage|indexedDB/i));
add("NUI-ID-011", "同版本只显示说明", () => assert.match(component, /当前结果已使用本版本处理/));
add("NUI-ID-012", "重跑理由 Trim 及 500", () => assert.match(component, /rerunReason\.trim\(\)[^]*reason\.length <= 500/));

add("NUI-PC-001", "轮询前十秒 2 秒", () => assert.equal(pollingDelay(0), 2000));
add("NUI-PC-002", "轮询十至六十秒 5 秒", () => assert.equal(pollingDelay(10000), 5000));
add("NUI-PC-003", "轮询六十秒后 10 秒", () => assert.equal(pollingDelay(60000), 10000));
add("NUI-PC-004", "网络退避 5 10 30 30", () => assert.deepEqual([1,2,3,4].map((n) => pollingDelay(0, n)), [5000,10000,30000,30000]));
add("NUI-PC-005", "Retry-After 秒与日期", () => { assert.equal(retryAfterMilliseconds("37"), 37000); assert.equal(retryAfterMilliseconds(new Date(2000).toUTCString(), 1000), 1000); });
add("NUI-PC-006", "隐藏暂停可见刷新", () => { assert.match(polling, /visibilityState === "hidden"/); assert.match(polling, /visibilityState === "visible"[^]*this\.refresh/); });
add("NUI-PC-007", "Batch Summary 同轮 Promise", () => assert.match(component, /const \[detailResponse, summaryResponse\] = await Promise\.all/));
add("NUI-PC-008", "Generation 防旧响应", () => assert.match(polling, /sequence !== this\.#sequence/));
add("NUI-PC-009", "合法进度 Floor", () => assert.equal(rowProgress(run({ run_status: "RUNNING", current_stage: "NORMALIZE_ROWS", processed_rows: 1 })).percent, 50));
add("NUI-PC-010", "Verify 百分百不称任务完成", () => assert.equal(rowProgress(run({ run_status: "RUNNING", current_stage: "VERIFY_RESULT" })).label, "行处理已完成，正在核对"));
add("NUI-PC-011", "非法计数隐藏进度", () => assert.equal(rowProgress(run({ run_status: "RUNNING", processed_rows: 3 })), null));
add("NUI-PC-012", "终态停止继续轮询", () => assert.match(component, /continuePolling: activeNormalizationRun/));
add("NUI-PC-013", "取消 Body 只有 Version Reason", () => assert.match(component, /expected_version: batch\.current_version, reason_code: "USER_CANCELLED"/));
add("NUI-PC-014", "取消竞争文案保留旧结果", () => assert.match(component, /重跑取消胜出时保留上一次已发布结果/));

add("NUI-SM-001", "Current Latest 同 ID 不双渲染", () => assert.equal((component.match(/<SummaryPanel/g) || []).length, 1));
add("NUI-SM-002", "Latest Failed 不覆盖 Current", () => assert.match(component, /latest\.id !== current\.id[^]*SummaryPanel/));
add("NUI-SM-003", "汇总合法计数", () => assert.equal(validRunCounts(run()), true));
add("NUI-SM-004", "汇总不等拒绝", () => assert.equal(validRunCounts(run({ valid_rows: 2 })), false));
add("NUI-SM-005", "Normalized 无 Current 矛盾", () => assert.equal(validateComposite(batch(), { batch_id: 7, batch_status: "NORMALIZED", current_version: 9, current_run: null, latest_attempt: run(), request_id: "r" }, 7), false));
add("NUI-SM-006", "Error 行不称任务失败", () => assert.match(component, /规范化已完成，其中 \$\{run\.error_rows\} 行需要处理/));
add("NUI-SM-007", "可选 Run 字段条件渲染", () => assert.match(component, /run\.result_digest \?[^]*Number\.isSafeInteger\(run\.normalized_json_bytes\)/));
add("NUI-SM-008", "Digest 8 8 缩略", () => assert.equal(shortDigest("a".repeat(64)), `${"a".repeat(8)}…${"a".repeat(8)}`));

add("NUI-RW-001", "Rows 初始只发 limit 50", () => assert.match(normalizedRowsEndpoint(7, query()), /limit=50$/));
add("NUI-RW-002", "Rows Error 映射真实参数", () => assert.match(normalizedRowsEndpoint(7, query("row_status=ERROR")), /row_status=ERROR/));
add("NUI-RW-003", "Rows limit allowlist", () => { assert.equal(query("row_limit=100").row_limit, 100); assert.equal(query("row_limit=999").row_limit, 50); });
add("NUI-RW-004", "Rows Cursor 原样编码", () => assert.match(normalizedRowsEndpoint(7, query("row_cursor=a%2Bb%2F%3D")), /cursor=a%2Bb%2F%3D/));
add("NUI-RW-005", "上一页仅 history back", () => assert.match(component, /rowPrevious[^]*window\.history\.back\(\)/));
add("NUI-RW-006", "直接 Cursor 不伪上一页", () => assert.match(component, /rowPrevious, setRowPrevious\] = useState\(false\)/));
add("NUI-RW-007", "Rows Batch 归属异常", () => assert.equal(validateRowsResponse({ batch_id: 8, normalization_run_id: 11, items: [], next_cursor: null, request_id: "r" }, 7, 11), false));
add("NUI-RW-008", "Rows Run 归属异常", () => assert.equal(validateRowsResponse({ batch_id: 7, normalization_run_id: 12, items: [], next_cursor: null, request_id: "r" }, 7, 11), false));
add("NUI-RW-009", "Row Key 使用公开 ID", () => assert.match(component, /rows\?\.items\.map\(\(row\) => <tr key=\{row\.id\}/));
add("NUI-RW-010", "列表无 Detail N1", () => assert.equal((component.match(/normalized-rows\/\$\{detailRowId\}/g) || []).length, 1));
add("NUI-RW-011", "Current Run 变化清缓存", () => assert.match(component, /previousRun !== null && previousRun !== nextRun[^]*setRows\(null\)/));
add("NUI-RW-012", "筛选空不称通过", () => assert.match(component, /当前筛选条件下没有结果；这不表示全部校验通过/));

add("NUI-DR-001", "Drawer 使用独立 Marker", () => assert.match(component, /NORMALIZATION_ROW_DRAWER_MARKER/));
add("NUI-DR-002", "Detail 等待 Composite 后 Row", () => assert.match(component, /detailRowId = query\?\.row && runId/));
add("NUI-DR-003", "Row 严格正整数", () => assert.deepEqual([strictPositiveInteger("1e3"), strictPositiveInteger(" 1"), strictPositiveInteger("-1"), strictPositiveInteger("9007199254740992")], [null,null,null,null]));
add("NUI-DR-004", "Detail Lineage 归属矛盾拒绝", () => assert.equal(validateRowDetail({ ...detail, normalized_payload: { ...detail.normalized_payload, lineage: { ...detail.normalized_payload.lineage, sheet_index: 1 } } }, 7, 11, 5), false));
add("NUI-DR-005", "有界值区分 Null 空串 False 0 容器", () => assert.deepEqual([null,"",false,0,[],{}].map((v) => boundedValue(v).type), ["null","string","boolean","number","array","object"]));
add("NUI-DR-006", "Column 0 显式显示", () => assert.match(component, /source\.column_index === null \? "无" : source\.column_index/));
add("NUI-DR-007", "大值触发有界展示", () => assert.equal(boundedValue("x".repeat(600)).truncated, true));
add("NUI-DR-008", "200 属性按 Code 稳定排序", () => assert.match(component, /attributes\)\.sort\(\(\[a\], \[b\]\) => a\.localeCompare\(b, "en"\)\)/));
add("NUI-DR-009", "分类供应商延后语义", () => assert.match(component, /分类提示（非正式分类）[^]*供应商引用候选[^]*延后校验/));
add("NUI-DR-010", "Drawer Abort 焦点三级恢复", () => assert.match(component, /controller\.abort\(\)[^]*focusReturn\.current[^]*mainTitle\.current/));

add("NUI-IS-001", "Issues 初始只发 limit 50", () => assert.match(normalizationIssuesEndpoint(7, query("view=issues")), /limit=50$/));
add("NUI-IS-002", "Issues 五类筛选映射", () => { const url = normalizationIssuesEndpoint(7, query("view=issues&issue_level=ERROR&issue_code=NORMALIZATION_TYPE_MISMATCH&issue_target=basic.X&issue_row=12")); assert.match(url, /issue_level=ERROR.*issue_code=NORMALIZATION_TYPE_MISMATCH.*target_code=basic.X.*source_row_number=12/); });
add("NUI-IS-003", "虚构筛选不进入 API", () => assert.doesNotMatch(normalizationIssuesEndpoint(7, query("view=issues&row_status=ERROR&sheet=1&page=2")), /row_status|sheet|page/));
add("NUI-IS-004", "Issue Row 严格整数", () => assert.equal(query("view=issues&issue_row=1e3").issue_row, null));
add("NUI-IS-005", "Issue 独立 Marker", () => assert.match(component, /NORMALIZATION_ISSUE_PAGE_MARKER/));
add("NUI-IS-006", "直接 Issue Cursor 无伪上一页", () => assert.match(component, /useState\(false\).*issuePrevious/));
add("NUI-IS-007", "Issue 归属不匹配拒绝", () => assert.equal(validateIssuesResponse({ batch_id: 7, normalization_run_id: 12, items: [], next_cursor: null, request_id: "r" }, 7, 11), false));
add("NUI-IS-008", "Column 0 不按 Falsy 隐藏", () => assert.match(component, /issue\.source_column_index \?\? "—"/));
add("NUI-IS-009", "18 Code 与未知 Code", () => { assert.equal(Object.keys(NORMALIZATION_ISSUE_LABELS).length, 18); assert.equal(issueLabel("UNKNOWN"), "规范化问题"); });
add("NUI-IS-010", "Safe Details 五键 Allowlist", () => assert.deepEqual(safeIssueDetails({ expected_type: "string", allowed_values: ["A"], decimal_scale: 2, max_length: 5, max_bytes: 9, secret: "x" }).map(([key]) => key), ["expected_type","allowed_values","decimal_scale","max_length","max_bytes"]));
add("NUI-IS-011", "Issue 打开同一 Drawer", () => assert.match(component, /openRow\(issue\.normalized_row_id, event\.currentTarget, issue\)/));
add("NUI-IS-012", "局部门禁不伪造全部 Issues", () => { assert.match(component, /V1 不显示“该行全部 Issues”/); assert.doesNotMatch(component, /normalized_row_id=.*normalization-issues/); });

add("NUI-SA-001", "无 Read 不渲染受保护工作区", () => assert.match(workspace, /if \(!canRead\) return <MaterialImportErrorState/));
add("NUI-SA-002", "Read Any 不授写权限", () => assert.match(workspace, /canRead = permissions\.includes\("material\.import\.read"\) \|\| permissions\.includes\("material\.import\.read_any"\)[^]*canMap = permissions\.includes/));
add("NUI-SA-003", "Normalize 不推导 Cancel", () => assert.match(component, /canNormalize = permissions\.includes[^]*canCancel = permissions\.includes/));
add("NUI-SA-004", "401 清理并登录", () => assert.match(component, /next\.status === 401[^]*clearProtected\(\); redirectToExistingLogin/));
add("NUI-SA-005", "403 清 Current 列表 Drawer", () => assert.match(component, /\[403, 404\]\.includes\(next\.status\)\) clearProtected/));
add("NUI-SA-006", "404 统一隐藏文案", () => assert.match(component, /该规范化行不存在或当前不可访问/));
add("NUI-SA-007", "无 HTML Markdown 自动链接", () => { assert.doesNotMatch(component, /dangerouslySetInnerHTML|marked\(|href=\{issue\.safe_message/); });
add("NUI-SA-008", "长内容 Focus Trap Escape", () => assert.match(component, /event\.key === "Escape"[^]*event\.key !== "Tab"/));
add("NUI-SA-009", "History 不保存正文", () => assert.match(component, /\{ marker, batchId, runId \}/));
add("NUI-SA-010", "不日志记录敏感正文", () => assert.doesNotMatch(all, /console\.(log|error|warn)/));
add("NUI-SA-011", "状态文字不只颜色", () => assert.match(component, />\{row\.row_status\}<\/span>/));
add("NUI-SA-012", "Live Region 只播阶段终态", () => assert.match(component, /aria-live="polite"[^]*latest\.run_status/));
add("NUI-SA-013", "Rows Issues Caption Headers Label", () => { assert.equal((component.match(/<caption>/g) || []).length, 2); assert.match(component, /<th scope="col">/); assert.match(component, /<label>/); });
add("NUI-SA-014", "Issue 字段使用安全 ID", () => assert.match(component, /cryptoSafeId\(candidate\.target_code\)/));
add("NUI-SA-015", "焦点回按钮列表标题", () => assert.match(component, /focusReturn\.current[^]*#min-issues[^]*mainTitle\.current/));
add("NUI-SA-016", "无 Hover 拖拽整行点击依赖", () => { assert.doesNotMatch(component, /draggable|onDrag|<tr[^>]*onClick/); });

add("NUI-PF-001", "Rows 仅当前 50 100 页", () => assert.match(protocol, /row_limit: 50 \| 100/));
add("NUI-PF-002", "Issues 仅当前 50 100 页", () => assert.match(protocol, /issue_limit: 50 \| 100/));
add("NUI-PF-003", "200 属性不请求 Catalog", () => assert.doesNotMatch(component, /mapping-targets[^]*attributes/));
add("NUI-PF-004", "最大 Row Payload 有界关闭释放", () => assert.match(component, /boundedValue\(candidate\.candidate\)[^]*setDetail\(null\)/));
add("NUI-PF-005", "Safe Details 有界无隐藏全文", () => assert.match(component, /safeIssueDetails\(issue\.safe_details\)/));
add("NUI-PF-006", "快速筛选请求可 Abort", () => assert.match(component, /const controller = new AbortController\(\)[^]*signal: controller\.signal/));
add("NUI-PF-007", "Run 变化清 URL 与缓存", () => assert.match(component, /parsed\.row_cursor = ""; parsed\.issue_cursor = ""; parsed\.row = null/));
add("NUI-PF-008", "无 Data Grid 大状态库", () => { assert.doesNotMatch(all, /ag-grid|tanstack\/table|redux|zustand/); assert.match(styles, /1366|repeat\(7/); });

for (const [id, name, fn] of tests) test(`${id} ${name}`, fn);

test("Normalization UI matrix is exactly 104 unique planned IDs", () => {
  const ids = tests.map(([id]) => id);
  assert.equal(ids.length, 104);
  assert.equal(new Set(ids).size, 104);
  assert.equal(ids[0], "NUI-RS-001"); assert.equal(ids.at(-1), "NUI-PF-008");
});
