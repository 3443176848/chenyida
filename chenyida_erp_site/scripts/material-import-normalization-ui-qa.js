// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const output = "output/playwright";
  let runId = 11;
  const requests = [];
  const consoleProblems = [];
  const pathOf = (value) => `/${String(value).split("://").at(-1).split("/").slice(1).join("/").split("?")[0]}`;
  const candidate = (target_code, value, column = 0) => ({ target_code, candidate: value, status: "VALID", source: { kind: "SOURCE_COLUMN", column_index: column, cell_type: "TEXT", value_state: "PRESENT", blank_kind: null, raw_value: value } });
  const rowItems = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, source_sheet_index: index % 2, source_row_number: index + 2, source_raw_row_hash: String(index + 1).padStart(64, "a"), normalized_payload_hash: String(index + 1).padStart(64, "b"), row_status: index % 10 === 0 ? "ERROR" : index % 3 === 0 ? "WARNING" : "VALID", error_count: index % 10 === 0 ? 1 : 0, warning_count: index % 3 === 0 ? 1 : 0, created_at: "2026-07-17T00:00:00Z" }));
  const issueItems = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, normalized_row_id: index % 50 + 1, issue_level: index % 2 ? "WARNING" : "ERROR", issue_code: index % 2 ? "NORMALIZATION_BRAND_UNKNOWN" : "NORMALIZATION_TYPE_MISMATCH", target_code: index % 2 ? "basic.BRAND" : "basic.STANDARD_NAME", source_sheet_index: index % 2, source_row_number: index % 50 + 2, source_column_index: index % 4 === 0 ? 0 : index % 8, safe_message: `第 ${index + 1} 条安全问题说明 ${"内容".repeat(80)}`, safe_details: { expected_type: "string", allowed_values: ["A", "B"], decimal_scale: 2, max_length: 160, max_bytes: 512, ignored_secret: "hidden" }, created_at: "2026-07-17T00:00:00Z" }));
  const attributes = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`ATTRIBUTE_${String(index + 1).padStart(3, "0")}`, candidate(`attribute.ATTRIBUTE_${String(index + 1).padStart(3, "0")}`, index === 0 ? { nested: [{ value: "x".repeat(1200) }] } : { value: index, unit: "PCS" }, index % 32)]));
  const batch = () => ({ id: 7, batch_no: "IMP-QA-0007", source_kind: "CSV", status: "NORMALIZED", retry_of_batch_id: null, created_by: "qa", current_version: 9, file_count: 1, total_rows: 50, accepted_rows: 50, rejected_rows: 0, failure_stage: null, failure_code: null, failure_message: null, created_at: "2026-07-17T00:00:00Z", updated_at: "2026-07-17T00:00:00Z" });
  const run = () => ({ id: runId, parse_run_id: 3, mapping_id: 4, mapping_version: 2, mapping_digest: "a".repeat(64), processor_version: "material-import-normalizer-v1", payload_schema_version: 1, metadata_digest: "b".repeat(64), run_status: "SUCCEEDED", current_stage: "COMPLETE", total_rows: 50, processed_rows: 50, valid_rows: 30, warning_rows: 15, error_rows: 5, normalized_json_bytes: 262144, issue_count: 100, warning_count: 60, error_count: 40, result_digest: "c".repeat(64), started_at: "2026-07-17T00:00:00Z", completed_at: "2026-07-17T00:01:00Z", created_at: "2026-07-17T00:00:00Z", updated_at: "2026-07-17T00:01:00Z" });
  const payload = (row) => ({ schema_version: 1, lineage: { batch_id: 7, parse_run_id: 3, normalization_run_id: runId, mapping_id: 4, mapping_version: 2, mapping_digest: "a".repeat(64), metadata_digest: "b".repeat(64), processor_version: "material-import-normalizer-v1", sheet_index: row.source_sheet_index, row_number: row.source_row_number, source_row_number: row.source_row_number, raw_row_hash: row.source_raw_row_hash }, basic: { STANDARD_NAME: candidate("basic.STANDARD_NAME", "高密度测试物料", 0), UNIT: candidate("basic.UNIT", "PCS", 1) }, attributes, category_hint: null, supplier_reference: { SUPPLIER_PART_NO: candidate("supplier_reference.SUPPLIER_PART_NO", false, 2) }, deferred_validation: ["CATEGORY_ASSIGNMENT_REQUIRED", "MATERIAL_VALIDATION_NOT_RUN"], row_status: row.row_status, issue_summary: { issue_count: row.error_count + row.warning_count, error_count: row.error_count, warning_count: row.warning_count } });

  page.on("request", (request) => { if (request.url().includes("/api/")) requests.push(request.url()); });
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) consoleProblems.push(`${message.type()}: ${message.text()}`); });
  await page.route("**/api/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, user: { username: "qa", display_name: "QA", permissions: ["material.import.read", "material.import.normalize", "material.import.cancel"] }, csrf_token: "qa" }) }));
  await page.route("**/api/material-master/import-batches/7**", (route) => {
    const path = pathOf(route.request().url());
    let body;
    if (path.endsWith("/normalization")) body = { batch_id: 7, batch_status: "NORMALIZED", current_version: 9, current_run: run(), latest_attempt: run(), request_id: "req-summary" };
    else if (/\/normalized-rows\/[1-9][0-9]*$/.test(path)) { const selected = rowItems.find((item) => item.id === Number(path.split("/").at(-1))) || rowItems[0]; body = { batch_id: 7, normalization_run_id: runId, row: selected, normalized_payload: payload(selected), request_id: "req-detail" }; }
    else if (path.endsWith("/normalized-rows")) body = { batch_id: 7, normalization_run_id: runId, items: rowItems, next_cursor: "opaque-row-next", request_id: "req-rows" };
    else if (path.endsWith("/normalization-issues")) body = { batch_id: 7, normalization_run_id: runId, items: issueItems, next_cursor: "opaque-issue-next", request_id: "req-issues" };
    else if (path === "/api/material-master/import-batches/7") body = { request_id: "req-batch", data: { batch: batch(), file: null } };
    else body = { error: { code: "IMPORT_BATCH_NOT_FOUND", message: "mock route not configured", request_id: "req-mock", details: [] } };
    route.fulfill({ status: body.error ? 404 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  const started = Date.now();
  await page.goto("http://localhost:4173/materials/imports/7?view=normalized&row_limit=50", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /规范化已完成/ }).waitFor();
  const rowsReadyMs = Date.now() - started;
  const rowCount = await page.locator("#min-rows tbody tr").count();
  if (rowCount !== 50) throw new Error(`expected 50 rows, received ${rowCount}`);
  const detailBefore = requests.filter((url) => /normalized-rows\/[1-9][0-9]*$/.test(pathOf(url))).length;
  if (detailBefore !== 0) throw new Error(`row detail N+1 detected before drawer: ${detailBefore}`);
  await page.screenshot({ path: `${output}/normalization-results-1366.png`, fullPage: true });

  const drawerStarted = Date.now();
  await page.getByRole("button", { name: "查看详情" }).first().click();
  await page.getByRole("dialog").waitFor();
  const drawerReadyMs = Date.now() - drawerStarted;
  const attributeCount = await page.locator(".min-drawer .min-candidate").count();
  if (attributeCount < 200) throw new Error(`expected 200 attributes, received ${attributeCount}`);
  const focusedInDrawer = await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
  if (!focusedInDrawer) throw new Error("drawer initial focus missing");
  await page.screenshot({ path: `${output}/normalization-row-drawer-1366.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Issues" }).click();
  await page.locator("#min-issues tbody tr").first().waitFor();
  const issueCount = await page.locator("#min-issues tbody tr").count();
  if (issueCount !== 100) throw new Error(`expected 100 issues, received ${issueCount}`);
  const issueDetailBefore = requests.filter((url) => /normalized-rows\/[1-9][0-9]*$/.test(pathOf(url))).length;
  if (issueDetailBefore !== 1) throw new Error(`issue detail N+1 detected: ${issueDetailBefore}`);
  await page.screenshot({ path: `${output}/normalization-issues-1366.png`, fullPage: true });
  await page.getByRole("button", { name: "查看行" }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.setViewportSize({ width: 700, height: 768 });
  const drawerWidth = await page.locator(".min-drawer").evaluate((element) => Math.round(element.getBoundingClientRect().width));
  if (drawerWidth !== 700) throw new Error(`700px drawer should be full width, received ${drawerWidth}`);
  await page.screenshot({ path: `${output}/normalization-row-drawer-700.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "结果行" }).click();
  await page.locator("#min-rows tbody tr").first().waitFor();
  await page.getByRole("button", { name: "查看详情" }).first().click();
  await page.getByRole("dialog").waitFor();
  runId = 12;
  await page.getByRole("button", { name: "关闭行详情" }).click();
  await page.getByRole("button", { name: "手动刷新" }).last().click();
  await page.waitForFunction(() => !location.search.includes("row=") && !location.search.includes("row_cursor=") && !location.search.includes("issue_cursor="));

  const apiRequests = requests.filter((url) => url.includes("/api/"));
  const detailRequests = apiRequests.filter((url) => /normalized-rows\/[1-9][0-9]*$/.test(pathOf(url))).length;
  const semantics = await page.evaluate(() => ({ captions: document.querySelectorAll("table caption").length, columnHeaders: document.querySelectorAll("th[scope=col]").length, liveRegions: document.querySelectorAll("[aria-live=polite]").length, storedKeys: Object.keys(localStorage).length + Object.keys(sessionStorage).length, historyPayloadKeys: Object.keys(history.state || {}).filter((key) => !["marker", "batchId", "runId"].includes(key)) }));
  if (semantics.storedKeys !== 0 || semantics.historyPayloadKeys.length) throw new Error("sensitive state persisted in browser storage/history");
  if (consoleProblems.length) throw new Error(`console problems: ${consoleProblems.join(" | ")}`);
  return { rowsReadyMs, drawerReadyMs, rowCount, issueCount, attributeCount, drawerWidth, apiRequestCount: apiRequests.length, detailRequests, semantics, consoleProblems };
}
