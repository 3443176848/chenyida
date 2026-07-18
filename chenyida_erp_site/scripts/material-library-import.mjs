import { inspectMaterialFile } from "./material-file-inspector.mjs";

const COMMANDS = new Set(["inspect", "dry-run", "commit", "report"]);

function usage(message, exitCode = 2) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write("用法:\n");
  process.stderr.write("  npm run material-library:import -- inspect --file <本地.xlsx|.xls|.csv>\n");
  process.stderr.write("  npm run material-library:import -- <inspect|dry-run|commit|report> --api-base http://127.0.0.1:3000 --batch-id <id> [--accept-warnings]\n");
  process.exitCode = exitCode;
}

function argumentsFrom(argv) {
  const command = argv[0];
  if (!COMMANDS.has(command)) return null;
  const options = { command, acceptWarnings: false };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--accept-warnings") {
      options.acceptWarnings = true;
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= argv.length) return null;
    options[token.slice(2)] = argv[++index];
  }
  return options;
}

function localApiBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("--api-base 必须是有效 URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("--api-base 只允许 HTTP(S)");
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("该命令只允许回环地址，拒绝远程或生产 URL");
  }
  return url.origin;
}

function positiveInteger(value, field) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) throw new Error(`${field} 必须是正整数`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${field} 超出允许范围`);
  return number;
}

function headers(write = false, key = "") {
  const cookie = process.env.ERP_MATERIAL_IMPORT_COOKIE ?? "";
  if (!cookie) throw new Error("缺少 ERP_MATERIAL_IMPORT_COOKIE");
  const output = { Accept: "application/json", Cookie: cookie };
  if (write) {
    const csrf = process.env.ERP_MATERIAL_IMPORT_CSRF ?? "";
    if (!csrf) throw new Error("写操作缺少 ERP_MATERIAL_IMPORT_CSRF");
    output["Content-Type"] = "application/json";
    output["X-CSRF-Token"] = csrf;
    output["Idempotency-Key"] = key;
    output.Origin = process.env.ERP_MATERIAL_IMPORT_ORIGIN ?? "";
    if (!output.Origin) throw new Error("写操作缺少 ERP_MATERIAL_IMPORT_ORIGIN");
  }
  return output;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error;
    throw new Error(`${error?.code ?? `HTTP_${response.status}`}: ${error?.message ?? "请求失败"}`);
  }
  return payload;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function pagedRead(base, batchId, mode, cursorName) {
  let cursor = 0;
  const summary = mode === "dry-run"
    ? {
        total_rows: 0,
        success_rows: 0,
        error_rows: 0,
        warning_rows: 0,
        duplicate_rows: 0,
        needs_review_rows: 0,
        category: { exact: 0, matched: 0, needs_review: 0 },
        unit: { exact: 0, matched: 0, needs_review: 0, conflicts: 0, unmatched: 0 },
        brand: { exact: 0, matched: 0, needs_review: 0, conflicts: 0, new_candidates: 0, not_provided: 0 },
        duplicates: { exact: 0, high_confidence: 0, possible: 0 },
      }
    : { draft_count: 0, duplicate_rows: 0 };
  do {
    const url = new URL(`${base}/api/material-master/import-batches/${batchId}/draft-generation`);
    url.searchParams.set("mode", mode);
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set(cursorName, String(cursor));
    const payload = await request(url, { headers: headers() });
    for (const item of payload.items ?? []) {
      if (mode === "dry-run") {
        summary.total_rows += 1;
        if (item.ready) summary.success_rows += 1;
        else summary.needs_review_rows += 1;
        if ((item.issues ?? []).length) summary.error_rows += 1;
        if (item.source_row_status === "WARNING") summary.warning_rows += 1;
        if ((item.duplicate_candidates ?? []).length) summary.duplicate_rows += 1;
        const categoryStatus = String(item.category?.status ?? "").toLowerCase();
        if (categoryStatus in summary.category) summary.category[categoryStatus] += 1;
        const unitStatus = String(item.base_unit?.status ?? "").toLowerCase();
        if (unitStatus in summary.unit) summary.unit[unitStatus] += 1;
        if (item.base_unit?.reason === "CONFLICT") summary.unit.conflicts += 1;
        if (item.base_unit?.reason === "UNMATCHED") summary.unit.unmatched += 1;
        const brandStatus = String(item.brand?.status ?? "").toLowerCase();
        if (brandStatus in summary.brand) summary.brand[brandStatus] += 1;
        if (item.brand?.reason === "CONFLICT") summary.brand.conflicts += 1;
        if (item.brand?.reason === "UNMATCHED") summary.brand.new_candidates += 1;
        for (const duplicate of item.duplicate_candidates ?? []) {
          if (duplicate.matchLevel === "EXACT") summary.duplicates.exact += 1;
          else if (duplicate.matchLevel === "HIGH_CONFIDENCE") summary.duplicates.high_confidence += 1;
          else if (duplicate.matchLevel === "POSSIBLE") summary.duplicates.possible += 1;
        }
      } else {
        summary.draft_count += 1;
        if (Number(item.duplicate_candidate_count ?? 0) > 0) summary.duplicate_rows += 1;
      }
    }
    cursor = Number(payload[mode === "dry-run" ? "next_after_row_id" : "next_after_link_id"] ?? 0);
  } while (cursor);
  print({ batch_id: batchId, mode: mode === "dry-run" ? "DRY_RUN_SUMMARY" : "DRAFT_REPORT_SUMMARY", summary });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return usage("", 0);
  const options = argumentsFrom(argv);
  if (!options) return usage("参数无效");
  if (options.command === "inspect" && options.file) {
    if (options["api-base"] || options["batch-id"]) throw new Error("--file 不能与 --api-base/--batch-id 混用");
    print(await inspectMaterialFile(options.file));
    return;
  }
  const base = localApiBase(options["api-base"]);
  const batchId = positiveInteger(options["batch-id"], "--batch-id");
  if (options.command === "inspect") {
    print(await request(`${base}/api/material-master/import-batches/${batchId}/draft-generation?mode=inspect`, { headers: headers() }));
    return;
  }
  if (options.command === "dry-run") {
    await pagedRead(base, batchId, "dry-run", "after_row_id");
    return;
  }
  if (options.command === "report") {
    await pagedRead(base, batchId, "report", "after_link_id");
    return;
  }
  if (!["test", "local", "development"].includes(process.env.ERP_ENV ?? "")) {
    throw new Error("commit 只允许 ERP_ENV=test/local/development");
  }
  const inspected = await request(`${base}/api/material-master/import-batches/${batchId}/draft-generation?mode=inspect`, { headers: headers() });
  if (!inspected.approval) {
    await request(`${base}/api/material-master/import-batches/${batchId}/normalization/approve`, {
      method: "POST",
      headers: headers(true, `material-library-approve-${batchId}-${inspected.normalization_run_id}`),
      body: JSON.stringify({
        expected_version: inspected.current_version,
        result_digest: inspected.result_digest,
        accept_warnings: options.acceptWarnings,
      }),
    });
  }
  let cursor = 0;
  do {
    const payload = await request(`${base}/api/material-master/import-batches/${batchId}/drafts`, {
      method: "POST",
      headers: headers(true, `material-library-drafts-${batchId}-${inspected.normalization_run_id}-${cursor}`),
      body: JSON.stringify({ expected_version: inspected.current_version, after_row_id: cursor, limit: 50 }),
    });
    print(payload);
    cursor = Number(payload.next_after_row_id ?? 0);
  } while (cursor);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "命令失败"}\n`);
  process.exitCode = 1;
});
