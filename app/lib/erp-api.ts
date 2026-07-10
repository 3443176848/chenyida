import { env } from "cloudflare:workers";

type RuntimeEnv = {
  DB: D1Database;
  ERP_SETUP_TOKEN?: string;
};

type UserRow = {
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  must_change_password: number;
  version: number;
  last_login_at: string;
};

type RecordRow = {
  id: number;
  kind: string;
  code: string;
  data_json: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ErpRecord = Record<string, unknown> & {
  id: number;
  kind: string;
  code: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const runtime = env as unknown as RuntimeEnv;
const SESSION_COOKIE = "CYD_ERP_SESSION";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

const ROLE_LABELS: Record<string, string> = {
  admin: "系统管理员",
  manager: "经营负责人",
  purchase: "采购",
  engineering: "工程",
  production: "生产",
  warehouse: "仓库",
  quality: "品质",
  sales: "销售",
  finance: "财务",
  operations: "运营",
};

const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set(["*"]),
  manager: new Set(["read", "dashboard", "material", "engineering", "purchase", "production", "inventory", "sales", "quality", "finance"]),
  purchase: new Set(["read", "dashboard", "material", "purchase", "inventory"]),
  engineering: new Set(["read", "dashboard", "material", "engineering"]),
  production: new Set(["read", "dashboard", "production"]),
  warehouse: new Set(["read", "dashboard", "inventory"]),
  quality: new Set(["read", "dashboard", "quality"]),
  sales: new Set(["read", "dashboard", "sales"]),
  finance: new Set(["read", "dashboard", "finance"]),
  operations: new Set(["read", "dashboard"]),
};

const LIST_KINDS: Record<string, string> = {
  "/api/items": "items",
  "/api/mappings": "mappings",
  "/api/cleaning": "cleaning",
  "/api/products": "products",
  "/api/customers": "customers",
  "/api/suppliers": "suppliers",
  "/api/boms": "boms",
  "/api/bom-lines": "bom_lines",
  "/api/purchase-orders": "purchase_orders",
  "/api/purchase-order-lines": "purchase_order_lines",
  "/api/inventory-adjustments": "inventory_adjustments",
  "/api/work-orders": "work_orders",
  "/api/work-order-materials": "work_order_materials",
  "/api/production-reports": "production_reports",
  "/api/quotations": "quotations",
  "/api/sales-orders": "sales_orders",
  "/api/shipments": "shipments",
  "/api/quality-inspections": "quality_inspections",
  "/api/quality-defects": "quality_defects",
  "/api/financial-documents": "financial_documents",
  "/api/financial-payments": "financial_payments",
  "/api/backups": "backups",
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS app_users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS app_sessions_username_idx ON app_sessions(username)`,
  `CREATE TABLE IF NOT EXISTS erp_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, code)
  )`,
  `CREATE INDEX IF NOT EXISTS erp_records_kind_idx ON erp_records(kind)`,
  `CREATE TABLE IF NOT EXISTS inventory_balances (
    item_code TEXT PRIMARY KEY,
    on_hand_qty REAL NOT NULL DEFAULT 0 CHECK(on_hand_qty >= 0),
    reserved_qty REAL NOT NULL DEFAULT 0 CHECK(reserved_qty >= 0),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL,
    txn_type TEXT NOT NULL,
    qty REAL NOT NULL,
    ref_type TEXT NOT NULL DEFAULT '',
    ref_no TEXT NOT NULL DEFAULT '',
    before_qty REAL NOT NULL DEFAULT 0,
    after_qty REAL NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS inventory_transactions_item_idx ON inventory_transactions(item_code)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT 'success',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at)`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx ON idempotency_keys(expires_at)`,
];

let schemaReady: Promise<void> | null = null;

function database() {
  if (!runtime.DB) throw new Error("在线数据库尚未绑定");
  return runtime.DB;
}

async function ensureSchema() {
  schemaReady ??= database()
    .batch(SCHEMA_STATEMENTS.map((statement) => database().prepare(statement)))
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

function nowText() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function randomCode(prefix: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `${prefix}-${date}-${suffix}`;
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function errorResponse(message: string, status = 400, code = "BAD_REQUEST", requestId = "") {
  return jsonResponse({ error: message, code, request_id: requestId }, status);
}

function parseCookies(header: string | null) {
  const result: Record<string, string> = {};
  for (const chunk of (header ?? "").split(";")) {
    const separator = chunk.indexOf("=");
    if (separator < 0) continue;
    result[chunk.slice(0, separator).trim()] = chunk.slice(separator + 1).trim();
  }
  return result;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(
  password: string,
  salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
  iterations = 100000,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations },
    key,
    256,
  );
  return `pbkdf2_sha256$${iterations}$${salt}$${bytesToHex(new Uint8Array(bits))}`;
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts[0] !== "pbkdf2_sha256") return false;
  if (parts.length === 3) {
    const [, legacySalt] = parts;
    const legacyDigest = (await hashPassword(password, legacySalt, 180000)).split("$")[3];
    return constantTimeEqual(`pbkdf2_sha256$${legacySalt}$${legacyDigest}`, stored);
  }
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  if (!Number.isInteger(iterations) || iterations < 50000 || !salt) return false;
  return constantTimeEqual(await hashPassword(password, salt, iterations), stored);
}

function publicUser(row: UserRow) {
  const permissions = [...(ROLE_PERMISSIONS[row.role] ?? new Set<string>())].sort();
  return {
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    role_label: ROLE_LABELS[row.role] ?? row.role,
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
    version: row.version,
    last_login_at: row.last_login_at ?? "",
    permissions,
  };
}

async function currentUser(request: Request) {
  const token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await database()
    .prepare(
      `SELECT u.username, u.display_name, u.role, u.is_active, u.must_change_password,
              u.version, u.last_login_at
       FROM app_sessions s
       JOIN app_users u ON u.username = s.username
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    )
    .bind(tokenHash, now)
    .first<UserRow>();
  if (!row) return null;
  await database()
    .prepare("UPDATE app_sessions SET expires_at = ? WHERE token_hash = ?")
    .bind(now + SESSION_TTL_SECONDS, tokenHash)
    .run();
  return publicUser(row);
}

function permissionFor(method: string, path: string) {
  if (path.startsWith("/api/users") || path.startsWith("/api/backups")) return "system";
  if (path === "/api/management-dashboard") return "dashboard";
  if (path === "/api/me/password") return "read";
  if (method === "GET") return "read";
  if (["/api/import", "/api/cleaning/confirm", "/api/cleaning/create-item"].includes(path)) return "material";
  if (path === "/api/customers" || path === "/api/suppliers") return path.endsWith("customers") ? "sales" : "purchase";
  if (["/api/products", "/api/boms", "/api/bom-lines"].includes(path)) return "engineering";
  if (["/api/purchase-orders", "/api/purchase-orders/from-shortage", "/api/purchase-receive"].includes(path)) return "purchase";
  if (path === "/api/inventory-adjustments") return "inventory";
  if (path.startsWith("/api/work-orders")) return "production";
  if (["/api/quotations", "/api/quotations/to-sales-order", "/api/sales-orders", "/api/shipments/from-order"].includes(path)) return "sales";
  if (path === "/api/quality-inspections") return "quality";
  if (path.startsWith("/api/financial-")) return "finance";
  return "read";
}

function userCan(user: ReturnType<typeof publicUser>, permission: string) {
  const permissions = ROLE_PERMISSIONS[user.role] ?? new Set<string>();
  return permissions.has("*") || permissions.has(permission);
}

async function audit(username: string, action: string, detail: string, requestId: string, result = "success") {
  await database()
    .prepare("INSERT INTO audit_log (username, action, detail, request_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(username, action, detail, requestId, result, nowText())
    .run();
}

function flattenRecord(row: RecordRow): ErpRecord {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    ...data,
    id: row.id,
    kind: row.kind,
    code: row.code,
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listRecords(kind: string) {
  const result = await database()
    .prepare("SELECT * FROM erp_records WHERE kind = ? ORDER BY id DESC")
    .bind(kind)
    .all<RecordRow>();
  return result.results.map(flattenRecord);
}

async function recordById(kind: string, id: unknown) {
  const row = await database()
    .prepare("SELECT * FROM erp_records WHERE kind = ? AND id = ?")
    .bind(kind, numberValue(id))
    .first<RecordRow>();
  return row ? flattenRecord(row) : null;
}

async function recordByCode(kind: string, code: string) {
  const row = await database()
    .prepare("SELECT * FROM erp_records WHERE kind = ? AND code = ?")
    .bind(kind, code)
    .first<RecordRow>();
  return row ? flattenRecord(row) : null;
}

async function createRecord(kind: string, code: string, data: Record<string, unknown>, username: string) {
  const timestamp = nowText();
  const result = await database()
    .prepare(
      "INSERT INTO erp_records (kind, code, data_json, version, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    )
    .bind(kind, code, JSON.stringify(data), username, timestamp, timestamp)
    .run();
  return recordById(kind, result.meta.last_row_id);
}

async function updateRecord(record: ErpRecord, data: Record<string, unknown>, expectedVersion?: number) {
  const version = expectedVersion ?? record.version;
  const result = await database()
    .prepare(
      "UPDATE erp_records SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
    )
    .bind(JSON.stringify(data), nowText(), record.id, version)
    .run();
  if (!result.meta.changes) {
    throw new ApiFailure("记录已被其他用户修改，请刷新后重试", 409, "VERSION_CONFLICT");
  }
  return recordById(record.kind, record.id);
}

class ApiFailure extends Error {
  constructor(message: string, public status = 400, public code = "BAD_REQUEST") {
    super(message);
  }
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function usersCount() {
  const row = await database().prepare("SELECT COUNT(*) AS count FROM app_users").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function authenticatedSessionResponse(
  request: Request,
  row: UserRow,
  requestId: string,
  status: number,
  action: string,
  detail: string,
) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const timestamp = nowText();
  await database().batch([
    database().prepare("DELETE FROM app_sessions WHERE username = ? OR expires_at <= ?").bind(row.username, Math.floor(Date.now() / 1000)),
    database().prepare("INSERT INTO app_sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(tokenHash, row.username, expiresAt, timestamp),
    database().prepare("UPDATE app_users SET last_login_at = ?, updated_at = ? WHERE username = ?").bind(timestamp, timestamp, row.username),
    database().prepare("INSERT INTO audit_log (username, action, detail, request_id, result, created_at) VALUES (?, ?, ?, ?, 'success', ?)").bind(row.username, action, detail, requestId, timestamp),
  ]);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
  return jsonResponse(
    {
      ok: true,
      user: publicUser({ ...row, last_login_at: timestamp }),
      expires_at: expiresAt,
      setup_required: false,
    },
    status,
    { "Set-Cookie": cookie },
  );
}

async function handleSetup(request: Request, requestId: string) {
  if ((await usersCount()) > 0) return errorResponse("系统已经完成初始化", 409, "SETUP_COMPLETE", requestId);
  const body = await readJson(request);
  const suppliedToken = stringValue(body.setup_token);
  if (!runtime.ERP_SETUP_TOKEN || !constantTimeEqual(suppliedToken, runtime.ERP_SETUP_TOKEN)) {
    await audit("", "初始化失败", "初始化凭证不正确", requestId, "failed");
    return errorResponse("初始化凭证不正确", 403, "SETUP_TOKEN_INVALID", requestId);
  }
  const username = stringValue(body.username || "admin").toLowerCase();
  const displayName = stringValue(body.display_name || "系统管理员");
  const password = stringValue(body.password);
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new ApiFailure("管理员账号格式不正确");
  if (password.length < 12) throw new ApiFailure("管理员密码至少 12 位");
  const timestamp = nowText();
  await database()
    .prepare(
      `INSERT INTO app_users
       (username, display_name, role, password_hash, is_active, must_change_password, version, created_at, updated_at, last_login_at)
       VALUES (?, ?, 'admin', ?, 1, 0, 1, ?, ?, '')`,
    )
    .bind(username, displayName, await hashPassword(password), timestamp, timestamp)
    .run();
  await database()
    .prepare("INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('setup_completed', '1', ?)")
    .bind(timestamp)
    .run();
  return authenticatedSessionResponse(
    request,
    {
      username,
      display_name: displayName,
      role: "admin",
      is_active: 1,
      must_change_password: 0,
      version: 1,
      last_login_at: "",
    },
    requestId,
    201,
    "初始化系统",
    "创建首位管理员并登录",
  );
}

async function handleLogin(request: Request, requestId: string) {
  const body = await readJson(request);
  const username = stringValue(body.username).toLowerCase();
  const password = stringValue(body.password);
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const failed = await database()
    .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = '登录失败' AND detail = ? AND created_at >= ?")
    .bind(username, fifteenMinutesAgo)
    .first<{ count: number }>();
  if (Number(failed?.count ?? 0) >= 10) return errorResponse("登录尝试过多，请稍后再试", 429, "LOGIN_THROTTLED", requestId);
  const row = await database()
    .prepare("SELECT * FROM app_users WHERE username = ? AND is_active = 1")
    .bind(username)
    .first<UserRow & { password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await audit("", "登录失败", username, requestId, "failed");
    return errorResponse("账号或密码不正确", 401, "LOGIN_FAILED", requestId);
  }
  return authenticatedSessionResponse(request, row, requestId, 200, "用户登录", username);
}

async function handleLogout(request: Request) {
  const token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  if (token) await database().prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return jsonResponse({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` });
}

async function handleSession(request: Request) {
  const setupRequired = (await usersCount()) === 0;
  const user = setupRequired ? null : await currentUser(request);
  return jsonResponse({ authenticated: Boolean(user), user, setup_required: setupRequired });
}

async function inventoryRows() {
  const [items, balancesResult] = await Promise.all([
    listRecords("items"),
    database().prepare("SELECT * FROM inventory_balances ORDER BY item_code").all<Record<string, unknown>>(),
  ]);
  const balances = new Map<string, Record<string, unknown>>(balancesResult.results.map((row) => [String(row.item_code), row]));
  const itemMap = new Map<string, ErpRecord>(items.map((item) => [String(item.internal_item_code), item]));
  const codes = new Set([...balances.keys(), ...itemMap.keys()]);
  return [...codes].sort().map((code) => {
    const item: Record<string, unknown> = itemMap.get(code) ?? {};
    const balance: Record<string, unknown> = balances.get(code) ?? {};
    const onHand = numberValue(balance.on_hand_qty);
    const reserved = numberValue(balance.reserved_qty);
    return {
      internal_item_code: code,
      item_category: item.item_category ?? "",
      standard_name: item.standard_name ?? code,
      base_uom: item.base_uom ?? "PCS",
      on_hand_qty: onHand,
      reserved_qty: reserved,
      available_qty: onHand - reserved,
      updated_at: balance.updated_at ?? item.updated_at ?? "",
      version: balance.version ?? 1,
    };
  });
}

async function summaryData() {
  const result = await database()
    .prepare("SELECT kind, COUNT(*) AS count FROM erp_records GROUP BY kind")
    .all<{ kind: string; count: number }>();
  const counts = new Map(result.results.map((row) => [row.kind, Number(row.count)]));
  const cleaning = await listRecords("cleaning");
  const workOrders = await listRecords("work_orders");
  const quotations = await listRecords("quotations");
  const salesOrders = await listRecords("sales_orders");
  const inspections = await listRecords("quality_inspections");
  const documents = await listRecords("financial_documents");
  const total = (kind: string) => counts.get(kind) ?? 0;
  const balance = (type: string) => documents
    .filter((row) => row.doc_type === type)
    .reduce((sum, row) => sum + numberValue(row.total_amount) - numberValue(row.paid_amount), 0);
  return {
    total_items: total("items"),
    total_mappings: total("mappings"),
    total_customers: total("customers"),
    total_suppliers: total("suppliers"),
    total_products: total("products"),
    total_boms: total("boms"),
    total_pos: total("purchase_orders"),
    open_pos: (await listRecords("purchase_orders")).filter((row) => row.po_status !== "已完成").length,
    total_work_orders: workOrders.length,
    active_work_orders: workOrders.filter((row) => row.work_status !== "已完工").length,
    total_quotations: quotations.length,
    open_quotations: quotations.filter((row) => !["已转订单", "已关闭"].includes(String(row.quote_status))).length,
    total_sales_orders: salesOrders.length,
    open_sales_orders: salesOrders.filter((row) => row.sales_status !== "已出货").length,
    total_quality_inspections: inspections.length,
    open_quality_issues: inspections.filter((row) => numberValue(row.failed_qty) > 0 && row.inspection_status !== "合格放行").length,
    receivable_balance: Number(balance("应收").toFixed(2)),
    payable_balance: Number(balance("应付").toFixed(2)),
    pending: cleaning.filter((row) => row.process_status === "待处理").length,
    auto_count: cleaning.filter((row) => row.match_level === "自动匹配").length,
    suspect_count: cleaning.filter((row) => row.match_level === "疑似匹配").length,
    new_count: cleaning.filter((row) => row.match_level === "新物料").length,
  };
}

async function managementDashboard() {
  const summary = await summaryData();
  const activity = await database()
    .prepare("SELECT created_at, action, detail, username, result FROM audit_log ORDER BY id DESC LIMIT 20")
    .all<Record<string, unknown>>();
  const risks: Array<{ level: string; text: string }> = [];
  if (summary.open_pos > 0) risks.push({ level: "medium", text: `有 ${summary.open_pos} 张采购单尚未完成` });
  if (summary.active_work_orders > 0) risks.push({ level: "medium", text: `有 ${summary.active_work_orders} 张生产工单进行中` });
  if (summary.open_quality_issues > 0) risks.push({ level: "high", text: `有 ${summary.open_quality_issues} 项质量异常待处置` });
  if (!risks.length) risks.push({ level: "low", text: "当前没有需要立即处理的经营风险" });
  return {
    metrics: [
      { label: "物料主数据", value: summary.total_items, hint: "已建档" },
      { label: "未完成采购", value: summary.open_pos, hint: "待收货" },
      { label: "进行中工单", value: summary.active_work_orders, hint: "生产协同" },
      { label: "应收余额", value: summary.receivable_balance, hint: "元" },
      { label: "应付余额", value: summary.payable_balance, hint: "元" },
      { label: "质量异常", value: summary.open_quality_issues, hint: "待处置" },
    ],
    risks,
    recent_activity: activity.results,
  };
}

function filterRows(path: string, url: URL, rows: ErpRecord[]) {
  const filters: Record<string, string> = {
    "/api/bom-lines": "bom_id",
    "/api/purchase-order-lines": "po_id",
    "/api/work-order-materials": "work_order_id",
    "/api/production-reports": "work_order_id",
    "/api/shipments": "sales_order_id",
    "/api/quality-defects": "inspection_id",
    "/api/financial-payments": "doc_id",
  };
  const field = filters[path];
  if (field) {
    const expected = url.searchParams.get(field);
    if (expected) rows = rows.filter((row) => String(row[field]) === expected);
  }
  if (path === "/api/financial-documents") {
    const type = url.searchParams.get("doc_type");
    if (type) rows = rows.filter((row) => row.doc_type === type);
  }
  return rows;
}

async function bomReadiness(url: URL) {
  const bomId = url.searchParams.get("bom_id") ?? "";
  const orderQty = Math.max(0, numberValue(url.searchParams.get("order_qty"), 1));
  const [lines, inventory] = await Promise.all([listRecords("bom_lines"), inventoryRows()]);
  const balanceMap = new Map<string, Record<string, unknown>>(inventory.map((row) => [String(row.internal_item_code), row]));
  const rows = lines.filter((row) => String(row.bom_id) === bomId).map((line) => {
    const required = numberValue(line.qty_per) * orderQty * (1 + numberValue(line.loss_rate) / 100);
    const available = numberValue(balanceMap.get(String(line.internal_item_code))?.available_qty);
    return {
      ...line,
      required_qty: Number(required.toFixed(4)),
      available_qty: available,
      shortage_qty: Number(Math.max(0, required - available).toFixed(4)),
      ready: available >= required,
    };
  });
  return { rows, all_ready: rows.length > 0 && rows.every((row) => row.ready), order_qty: orderQty };
}

async function purchaseSuggestions(url: URL) {
  const readiness = await bomReadiness(url);
  const mappings = await listRecords("mappings");
  const suggestions = readiness.rows.filter((row) => row.shortage_qty > 0).map((row) => {
    const source = row as Record<string, unknown> & { shortage_qty: number };
    const itemCode = stringValue(source.internal_item_code);
    const mapping = mappings.find((entry) => entry.internal_item_code === itemCode);
    return {
      internal_item_code: itemCode,
      standard_name: source.standard_name ?? itemCode,
      shortage_qty: source.shortage_qty,
      suggested_qty: source.shortage_qty,
      supplier_name: mapping?.supplier_name ?? "待分配供应商",
      unit_price: numberValue(mapping?.last_price),
      uom: source.uom ?? "PCS",
    };
  });
  return { suggestions, all_ready: readiness.all_ready };
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows: Array<Record<string, unknown>>) {
  const fields = rows.length ? Object.keys(rows[0]).filter((field) => field !== "kind") : [];
  const lines = [fields.join(","), ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(","))];
  return `\uFEFF${lines.join("\r\n")}`;
}

async function handleGet(path: string, url: URL, user: ReturnType<typeof publicUser>) {
  if (path === "/api/summary") return jsonResponse(await summaryData());
  if (path === "/api/management-dashboard") return jsonResponse(await managementDashboard());
  if (path === "/api/inventory") return jsonResponse({ rows: await inventoryRows() });
  if (path === "/api/bom-readiness") return jsonResponse(await bomReadiness(url));
  if (path === "/api/purchase-suggestions") return jsonResponse(await purchaseSuggestions(url));
  if (path === "/api/finance-summary") {
    const summary = await summaryData();
    return jsonResponse({ receivable_balance: summary.receivable_balance, payable_balance: summary.payable_balance });
  }
  if (path === "/api/users") {
    if (!userCan(user, "system")) return errorResponse("当前账号没有用户管理权限", 403, "FORBIDDEN");
    const result = await database()
      .prepare("SELECT username, display_name, role, is_active, must_change_password, version, last_login_at FROM app_users ORDER BY username")
      .all<UserRow>();
    return jsonResponse({ rows: result.results.map(publicUser) });
  }
  if (path === "/api/sample-import") {
    const rows = [
      { import_batch_no: "", supplier_name: "示例供应商", raw_item_name: "贴片电阻 10K 0603 1%", raw_item_code: "R-10K-0603", raw_spec: "10K 0603 1%", purchase_uom: "PCS" },
    ];
    return jsonResponse({ rows, csv: rowsToCsv(rows) });
  }
  if (path === "/api/export/items.csv" || path === "/api/export/cleaning.csv") {
    const rows = await listRecords(path.includes("items") ? "items" : "cleaning");
    return new Response(rowsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${path.includes("items") ? "items" : "cleaning"}.csv"`,
      },
    });
  }
  const kind = LIST_KINDS[path];
  if (kind) return jsonResponse({ rows: filterRows(path, url, await listRecords(kind)) });
  return errorResponse("接口不存在", 404, "NOT_FOUND");
}

// Write-side business operations are kept below so every mutation passes
// through the same authorization, audit, conflict, and idempotency boundary.

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  const headers = (rows.shift() ?? []).map((value) => value.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function createSimpleRecord(
  kind: string,
  codeField: string,
  prefix: string,
  body: Record<string, unknown>,
  username: string,
  required: string[] = [],
) {
  for (const field of required) if (!stringValue(body[field])) throw new ApiFailure(`${field} 不能为空`);
  const code = stringValue(body[codeField]) || randomCode(prefix);
  const data = { ...body, [codeField]: code };
  const row = await createRecord(kind, code, data, username);
  return row;
}

async function createUser(body: Record<string, unknown>, actor: string, requestId: string) {
  const username = stringValue(body.username).toLowerCase();
  const displayName = stringValue(body.display_name);
  const role = stringValue(body.role);
  const password = stringValue(body.password);
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new ApiFailure("账号需以字母开头，长度为 3 至 32 位");
  if (!displayName) throw new ApiFailure("姓名不能为空");
  if (!(role in ROLE_LABELS)) throw new ApiFailure("角色无效");
  if (password.length < 12) throw new ApiFailure("初始密码至少 12 位");
  const timestamp = nowText();
  await database()
    .prepare(
      `INSERT INTO app_users
       (username, display_name, role, password_hash, is_active, must_change_password, version, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?, '')`,
    )
    .bind(username, displayName, role, await hashPassword(password), timestamp, timestamp)
    .run();
  await audit(actor, "创建账号", `${username}/${role}`, requestId);
  return { username, display_name: displayName, role, role_label: ROLE_LABELS[role], is_active: true, must_change_password: true };
}

async function changePassword(request: Request, username: string, requestId: string) {
  const body = await readJson(request);
  const oldPassword = stringValue(body.old_password);
  const newPassword = stringValue(body.new_password);
  if (newPassword.length < 12) throw new ApiFailure("新密码至少 12 位");
  const row = await database().prepare("SELECT password_hash FROM app_users WHERE username = ? AND is_active = 1").bind(username).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(oldPassword, row.password_hash))) throw new ApiFailure("原密码不正确");
  await database().batch([
    database().prepare("UPDATE app_users SET password_hash = ?, must_change_password = 0, version = version + 1, updated_at = ? WHERE username = ?").bind(await hashPassword(newPassword), nowText(), username),
    database().prepare("DELETE FROM app_sessions WHERE username = ?").bind(username),
  ]);
  await audit(username, "修改密码", username, requestId);
  return { ok: true, relogin_required: true };
}

async function handlePost(
  request: Request,
  path: string,
  url: URL,
  user: ReturnType<typeof publicUser>,
  requestId: string,
) {
  const body = await readJson(request);
  if (path === "/api/me/password") return jsonResponse(await changePassword(new Request(request.url, { method: "POST", body: JSON.stringify(body) }), user.username, requestId));
  if (path === "/api/users/status") {
    const username = stringValue(body.username).toLowerCase();
    const active = Boolean(body.is_active);
    const version = numberValue(body.version);
    if (!username || !version) throw new ApiFailure("账号或版本信息不完整");
    if (username === user.username && !active) throw new ApiFailure("不能停用当前登录账号");
    const result = await database()
      .prepare("UPDATE app_users SET is_active = ?, version = version + 1, updated_at = ? WHERE username = ? AND version = ?")
      .bind(active ? 1 : 0, nowText(), username, version)
      .run();
    if (!result.meta.changes) throw new ApiFailure("账号已被其他管理员修改，请刷新后重试", 409, "VERSION_CONFLICT");
    if (!active) await database().prepare("DELETE FROM app_sessions WHERE username = ?").bind(username).run();
    await audit(user.username, active ? "启用账号" : "停用账号", username, requestId);
    return jsonResponse({ ok: true, username, is_active: active });
  }
  if (path === "/api/users/reset-password") {
    const username = stringValue(body.username).toLowerCase();
    const password = stringValue(body.password);
    if (!username || password.length < 12) throw new ApiFailure("账号不能为空，临时密码至少 12 位");
    const result = await database()
      .prepare("UPDATE app_users SET password_hash = ?, must_change_password = 1, version = version + 1, updated_at = ? WHERE username = ?")
      .bind(await hashPassword(password), nowText(), username)
      .run();
    if (!result.meta.changes) throw new ApiFailure("账号不存在", 404, "NOT_FOUND");
    await database().prepare("DELETE FROM app_sessions WHERE username = ?").bind(username).run();
    await audit(user.username, "重置密码", username, requestId);
    return jsonResponse({ ok: true, username, must_change_password: true });
  }
  if (path === "/api/users") return jsonResponse({ ok: true, user: await createUser(body, user.username, requestId) }, 201);
  if (path === "/api/import") {
    const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : parseCsv(stringValue(body.csvText));
    const batchNo = stringValue(body.batchNo) || randomCode("IMP");
    for (const raw of rows) {
      const rawName = stringValue(raw.raw_item_name);
      const text = `${rawName} ${stringValue(raw.raw_spec)}`.toUpperCase();
      const category = /UF|NF|PF/.test(text) ? "CAP" : /\d+(\.\d+)?[KRM]/.test(text) ? "RES" : text.includes("CONN") ? "CON" : "OTH";
      const packageMatch = text.match(/0201|0402|0603|0805|1206|SOD-?523|QFN|BGA/);
      const data = {
        ...raw,
        import_batch_no: stringValue(raw.import_batch_no) || batchNo,
        parsed_category: category,
        parsed_package: packageMatch?.[0]?.replace("SOD523", "SOD-523") ?? "",
        parsed_value: "",
        parsed_voltage: "",
        candidate_internal_code: "",
        candidate_standard_name: "",
        match_level: "新物料",
        confidence: 0,
        owner_role: "工程",
        process_status: "待处理",
      };
      await createRecord("cleaning", randomCode("CLEAN"), data, user.username);
    }
    await audit(user.username, "导入供应商物料", `${batchNo}/${rows.length}行`, requestId);
    return jsonResponse({ ok: true, count: rows.length, batch_no: batchNo });
  }
  if (path === "/api/cleaning/create-item") {
    const cleaning = await recordById("cleaning", body.id);
    if (!cleaning) throw new ApiFailure("清洗记录不存在", 404, "NOT_FOUND");
    const category = stringValue(body.item_category) || "OTH";
    const itemCode = randomCode(`MAT-${category}`);
    const item = await createRecord("items", itemCode, {
      internal_item_code: itemCode,
      item_category: category,
      standard_name: stringValue(body.standard_name) || stringValue(cleaning.raw_item_name),
      item_status: "启用",
      base_uom: cleaning.purchase_uom || "PCS",
      package: cleaning.parsed_package || "",
      value_spec: cleaning.parsed_value || "",
      voltage: cleaning.parsed_voltage || "",
      environmental_level: stringValue(body.environmental_level),
      default_inspection_rule: stringValue(body.default_inspection_rule),
      remark: "",
    }, user.username);
    await updateRecord(cleaning, { ...cleaning, candidate_internal_code: itemCode, candidate_standard_name: item?.standard_name, process_status: "已建档", match_level: "新物料" });
    await createRecord("mappings", randomCode("MAP"), {
      internal_item_code: itemCode,
      supplier_name: cleaning.supplier_name,
      supplier_item_name: cleaning.raw_item_name,
      supplier_item_code: cleaning.raw_item_code,
      purchase_uom: cleaning.purchase_uom || "PCS",
      match_status: "已确认",
      approved_by: user.display_name,
      approved_date: todayText(),
    }, user.username);
    await audit(user.username, "新物料建档", itemCode, requestId);
    return jsonResponse({ ok: true, internal_item_code: itemCode, item });
  }
  if (path === "/api/cleaning/confirm") {
    const cleaning = await recordById("cleaning", body.id);
    if (!cleaning) throw new ApiFailure("清洗记录不存在", 404, "NOT_FOUND");
    if (!stringValue(cleaning.candidate_internal_code)) throw new ApiFailure("没有候选内部物料，不能直接确认");
    await createRecord("mappings", randomCode("MAP"), {
      internal_item_code: cleaning.candidate_internal_code,
      supplier_name: cleaning.supplier_name,
      supplier_item_name: cleaning.raw_item_name,
      supplier_item_code: cleaning.raw_item_code,
      purchase_uom: cleaning.purchase_uom || "PCS",
      match_status: "已确认",
      approved_by: user.display_name,
      approved_date: todayText(),
    }, user.username);
    await updateRecord(cleaning, { ...cleaning, process_status: "已确认" });
    return jsonResponse({ ok: true });
  }
  if (path === "/api/products") {
    const row = await createSimpleRecord("products", "product_code", "PRD", body, user.username, ["product_code", "product_name"]);
    return jsonResponse({ ok: true, ...row }, 201);
  }
  if (path === "/api/customers") {
    const row = await createSimpleRecord("customers", "customer_code", "CUS", { customer_status: "启用", ...body }, user.username, ["customer_name"]);
    return jsonResponse({ ok: true, ...row }, 201);
  }
  if (path === "/api/suppliers") {
    const row = await createSimpleRecord("suppliers", "supplier_code", "SUP", { supplier_status: "启用", ...body }, user.username, ["supplier_name"]);
    return jsonResponse({ ok: true, ...row }, 201);
  }
  if (path === "/api/boms") {
    if (!stringValue(body.product_code)) throw new ApiFailure("请选择产品");
    const row = await createSimpleRecord("boms", "bom_code", "BOM", { bom_version: "A0", bom_status: "草稿", ...body }, user.username);
    return jsonResponse({ ok: true, bom_id: row?.id, bom_code: row?.bom_code }, 201);
  }
  if (path === "/api/bom-lines") {
    if (!numberValue(body.bom_id)) throw new ApiFailure("缺少 BOM ID");
    if (!stringValue(body.internal_item_code)) throw new ApiFailure("请选择内部物料");
    const item = await recordByCode("items", stringValue(body.internal_item_code));
    if (!item) throw new ApiFailure("内部物料不存在，请先建档");
    const row = await createRecord("bom_lines", randomCode("BL"), { uom: "PCS", loss_rate: 0, ...body }, user.username);
    return jsonResponse({ ok: true, row }, 201);
  }
  if (path === "/api/quotations") {
    const qty = numberValue(body.quote_qty);
    const price = numberValue(body.unit_price);
    if (!stringValue(body.customer_name) || !stringValue(body.product_code) || qty <= 0) throw new ApiFailure("客户、产品和报价数量不能为空");
    const row = await createSimpleRecord("quotations", "quote_code", "QT", {
      ...body,
      quote_qty: qty,
      unit_price: price,
      total_amount: Number((qty * price).toFixed(2)),
      quote_status: "草稿",
      sales_order_id: 0,
    }, user.username);
    await audit(user.username, "创建报价单", stringValue(row?.quote_code), requestId);
    return jsonResponse({ ok: true, quote_id: row?.id, quote_code: row?.quote_code }, 201);
  }
  if (path === "/api/sales-orders") {
    const qty = numberValue(body.order_qty);
    if (!stringValue(body.customer_name) || !stringValue(body.product_code) || qty <= 0) throw new ApiFailure("客户、产品和订单数量不能为空");
    const row = await createSimpleRecord("sales_orders", "sales_order_code", "SO", {
      ...body,
      order_qty: qty,
      shipped_qty: 0,
      sales_status: "待生产",
    }, user.username);
    return jsonResponse({ ok: true, sales_order_id: row?.id, sales_order_code: row?.sales_order_code }, 201);
  }
  if (path === "/api/quality-inspections") {
    const inspected = numberValue(body.inspected_qty);
    const passed = numberValue(body.passed_qty);
    const failed = Math.max(0, inspected - passed);
    if (inspected <= 0 || passed < 0 || passed > inspected) throw new ApiFailure("检验数量或合格数量不正确");
    if (failed > 0 && !stringValue(body.defect_type)) throw new ApiFailure("有不良数量时必须填写不良类型");
    const status = failed <= 0 ? "合格放行" : stringValue(body.disposition) || "待处置";
    const row = await createSimpleRecord("quality_inspections", "inspection_code", stringValue(body.inspection_type) || "QC", {
      ...body,
      inspected_qty: inspected,
      passed_qty: passed,
      failed_qty: failed,
      inspection_status: status,
      inspection_date: stringValue(body.inspection_date) || todayText(),
    }, user.username);
    if (failed > 0 && row) {
      await createRecord("quality_defects", randomCode("QD"), {
        inspection_id: row.id,
        defect_type: body.defect_type,
        severity: body.severity || "一般",
        defect_qty: numberValue(body.defect_qty, failed),
        corrective_action: body.disposition || "",
        remark: body.remark || "",
      }, user.username);
    }
    return jsonResponse({ ok: true, inspection_id: row?.id, inspection_code: row?.inspection_code, inspection_status: status }, 201);
  }
  return handleWorkflowPost(path, body, user, requestId, url);
}

async function handleWorkflowPost(
  path: string,
  body: Record<string, unknown>,
  user: ReturnType<typeof publicUser>,
  requestId: string,
  url: URL,
) {
  if (path === "/api/purchase-orders/from-shortage") {
    const bomId = numberValue(body.bom_id);
    const orderQty = numberValue(body.order_qty);
    if (!bomId || orderQty <= 0) throw new ApiFailure("BOM 和订单数量不能为空");
    const suggestionUrl = new URL(url);
    suggestionUrl.searchParams.set("bom_id", String(bomId));
    suggestionUrl.searchParams.set("order_qty", String(orderQty));
    const { suggestions } = await purchaseSuggestions(suggestionUrl);
    if (!suggestions.length) return jsonResponse({ ok: true, created: [] });
    const groups = new Map<string, typeof suggestions>();
    for (const suggestion of suggestions) {
      const supplier = String(suggestion.supplier_name);
      groups.set(supplier, [...(groups.get(supplier) ?? []), suggestion]);
    }
    const created: Array<Record<string, unknown>> = [];
    for (const [supplier, lines] of groups) {
      const poCode = randomCode("PO");
      const po = await createRecord("purchase_orders", poCode, {
        po_code: poCode,
        supplier_name: supplier,
        po_status: "待收货",
        source_type: "BOM缺料",
        source_ref: String(bomId),
        expected_date: "",
        created_by: user.display_name,
      }, user.username);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        await createRecord("purchase_order_lines", randomCode("POL"), {
          po_id: po?.id,
          line_no: (index + 1) * 10,
          internal_item_code: line.internal_item_code,
          order_qty: line.suggested_qty,
          uom: line.uom,
          unit_price: line.unit_price,
          received_qty: 0,
          line_status: "待收货",
        }, user.username);
      }
      created.push({ po_id: po?.id, po_code: poCode, supplier_name: supplier });
    }
    await audit(user.username, "生成缺料采购单", `${created.length}张`, requestId);
    return jsonResponse({ ok: true, created }, 201);
  }
  if (path === "/api/purchase-orders") {
    if (!stringValue(body.supplier_name)) throw new ApiFailure("供应商不能为空");
    const po = await createSimpleRecord("purchase_orders", "po_code", "PO", { po_status: "待收货", ...body }, user.username);
    const lines = Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      await createRecord("purchase_order_lines", randomCode("POL"), {
        po_id: po?.id,
        line_no: line.line_no || (index + 1) * 10,
        internal_item_code: line.internal_item_code,
        order_qty: numberValue(line.order_qty),
        uom: line.uom || "PCS",
        unit_price: numberValue(line.unit_price),
        received_qty: numberValue(line.received_qty),
        line_status: line.line_status || "待收货",
        remark: line.remark || "",
      }, user.username);
    }
    return jsonResponse({ ok: true, po_id: po?.id, po_code: po?.po_code }, 201);
  }
  if (path === "/api/purchase-receive") {
    const line = await recordById("purchase_order_lines", body.line_id);
    const receiveQty = numberValue(body.receive_qty);
    if (!line) throw new ApiFailure("采购明细不存在", 404, "NOT_FOUND");
    if (receiveQty <= 0) throw new ApiFailure("收货数量必须大于 0");
    const ordered = numberValue(line.order_qty);
    const received = numberValue(line.received_qty);
    if (received + receiveQty > ordered) throw new ApiFailure("收货数量不能超过未收数量");
    const itemCode = stringValue(line.internal_item_code);
    const balance = await database().prepare("SELECT on_hand_qty FROM inventory_balances WHERE item_code = ?").bind(itemCode).first<{ on_hand_qty: number }>();
    const before = numberValue(balance?.on_hand_qty);
    const after = before + receiveQty;
    const newReceived = received + receiveQty;
    const lineData = { ...line, received_qty: newReceived, line_status: newReceived >= ordered ? "已收货" : "部分收货" };
    await database().batch([
      database().prepare("UPDATE erp_records SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify(lineData), nowText(), line.id, line.version),
      database().prepare("INSERT INTO inventory_balances (item_code, on_hand_qty, reserved_qty, version, updated_at) VALUES (?, ?, 0, 1, ?) ON CONFLICT(item_code) DO UPDATE SET on_hand_qty = excluded.on_hand_qty, version = inventory_balances.version + 1, updated_at = excluded.updated_at").bind(itemCode, after, nowText()),
      database().prepare("INSERT INTO inventory_transactions (item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, created_by, created_at) VALUES (?, '采购入库', ?, '采购明细', ?, ?, ?, ?, ?)").bind(itemCode, receiveQty, String(line.id), before, after, user.username, nowText()),
    ]);
    const allLines = (await listRecords("purchase_order_lines")).filter((row) => String(row.po_id) === String(line.po_id));
    const completed = allLines.every((row) => row.id === line.id ? newReceived >= numberValue(row.order_qty) : numberValue(row.received_qty) >= numberValue(row.order_qty));
    const po = await recordById("purchase_orders", line.po_id);
    if (po) await updateRecord(po, { ...po, po_status: completed ? "已完成" : "部分收货" });
    await audit(user.username, "采购入库", `${itemCode}/${receiveQty}`, requestId);
    return jsonResponse({ ok: true, before_qty: before, after_qty: after, received_qty: newReceived, line_status: lineData.line_status });
  }
  if (path === "/api/inventory-adjustments") {
    const itemCode = stringValue(body.internal_item_code);
    const counted = numberValue(body.counted_qty);
    if (!itemCode) throw new ApiFailure("请选择物料");
    if (counted < 0) throw new ApiFailure("盘点数量不能小于 0");
    const balance = await database().prepare("SELECT on_hand_qty FROM inventory_balances WHERE item_code = ?").bind(itemCode).first<{ on_hand_qty: number }>();
    const before = numberValue(balance?.on_hand_qty);
    const delta = counted - before;
    const adjustmentCode = randomCode("IA");
    await database().batch([
      database().prepare("INSERT INTO inventory_balances (item_code, on_hand_qty, reserved_qty, version, updated_at) VALUES (?, ?, 0, 1, ?) ON CONFLICT(item_code) DO UPDATE SET on_hand_qty = excluded.on_hand_qty, version = inventory_balances.version + 1, updated_at = excluded.updated_at").bind(itemCode, counted, nowText()),
      database().prepare("INSERT INTO inventory_transactions (item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, created_by, created_at) VALUES (?, '盘点调整', ?, '盘点单', ?, ?, ?, ?, ?)").bind(itemCode, delta, adjustmentCode, before, counted, user.username, nowText()),
      database().prepare("INSERT INTO erp_records (kind, code, data_json, version, created_by, created_at, updated_at) VALUES ('inventory_adjustments', ?, ?, 1, ?, ?, ?)").bind(adjustmentCode, JSON.stringify({ adjustment_code: adjustmentCode, internal_item_code: itemCode, counted_qty: counted, before_qty: before, delta_qty: delta, after_qty: counted, reason: body.reason || "", adjusted_by: body.adjusted_by || user.display_name, adjusted_at: nowText() }), user.username, nowText(), nowText()),
    ]);
    return jsonResponse({ ok: true, adjustment_code: adjustmentCode, before_qty: before, delta_qty: delta, after_qty: counted }, 201);
  }
  if (path === "/api/work-orders/from-bom") {
    const bom = await recordById("boms", body.bom_id);
    const orderQty = numberValue(body.order_qty);
    if (!bom || orderQty <= 0) throw new ApiFailure("BOM 不存在或订单数量不正确");
    const workCode = randomCode("WO");
    const work = await createRecord("work_orders", workCode, {
      work_order_code: workCode,
      bom_id: bom.id,
      product_code: bom.product_code,
      order_qty: orderQty,
      completed_qty: 0,
      work_status: "待领料",
      planned_start: body.planned_start || "",
      planned_finish: body.planned_finish || "",
      owner: body.owner || user.display_name,
      remark: body.remark || "",
    }, user.username);
    const lines = (await listRecords("bom_lines")).filter((row) => String(row.bom_id) === String(bom.id));
    for (const line of lines) {
      const required = numberValue(line.qty_per) * orderQty * (1 + numberValue(line.loss_rate) / 100);
      await createRecord("work_order_materials", randomCode("WOM"), {
        work_order_id: work?.id,
        line_no: line.line_no,
        internal_item_code: line.internal_item_code,
        required_qty: Number(required.toFixed(4)),
        issued_qty: 0,
        uom: line.uom || "PCS",
        process_stage: line.process_stage || "",
        remark: line.remark || "",
      }, user.username);
    }
    return jsonResponse({ ok: true, work_order_id: work?.id, work_order_code: workCode }, 201);
  }
  if (path === "/api/work-orders/issue-materials") {
    const work = await recordById("work_orders", body.work_order_id);
    if (!work) throw new ApiFailure("生产工单不存在", 404, "NOT_FOUND");
    const materials = (await listRecords("work_order_materials")).filter((row) => String(row.work_order_id) === String(work.id));
    if (!materials.length) throw new ApiFailure("生产工单没有物料明细");
    const inventory = new Map((await inventoryRows()).map((row) => [row.internal_item_code, row]));
    for (const material of materials) {
      const remaining = numberValue(material.required_qty) - numberValue(material.issued_qty);
      if (numberValue(inventory.get(String(material.internal_item_code))?.available_qty) < remaining) {
        throw new ApiFailure(`物料 ${material.internal_item_code} 库存不足`);
      }
    }
    const statements: D1PreparedStatement[] = [];
    const issued: Array<Record<string, unknown>> = [];
    for (const material of materials) {
      const itemCode = stringValue(material.internal_item_code);
      const qty = numberValue(material.required_qty) - numberValue(material.issued_qty);
      if (qty <= 0) continue;
      const before = numberValue(inventory.get(itemCode)?.on_hand_qty);
      const after = before - qty;
      const data = { ...material, issued_qty: numberValue(material.required_qty) };
      statements.push(
        database().prepare("UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, version = version + 1, updated_at = ? WHERE item_code = ? AND on_hand_qty - reserved_qty >= ?").bind(qty, nowText(), itemCode, qty),
        database().prepare("UPDATE erp_records SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify(data), nowText(), material.id, material.version),
        database().prepare("INSERT INTO inventory_transactions (item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, created_by, created_at) VALUES (?, '生产领料', ?, '生产工单', ?, ?, ?, ?, ?)").bind(itemCode, -qty, work.work_order_code, before, after, user.username, nowText()),
      );
      issued.push({ internal_item_code: itemCode, qty });
    }
    statements.push(database().prepare("UPDATE erp_records SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify({ ...work, work_status: "生产中" }), nowText(), work.id, work.version));
    await database().batch(statements);
    return jsonResponse({ ok: true, issued });
  }
  if (path === "/api/work-orders/complete") {
    const work = await recordById("work_orders", body.work_order_id);
    const goodQty = numberValue(body.good_qty);
    const scrapQty = numberValue(body.scrap_qty);
    if (!work || goodQty <= 0) throw new ApiFailure("生产工单不存在或良品数量不正确");
    const finishedItemCode = `FG-${work.product_code}`;
    const balance = await database().prepare("SELECT on_hand_qty FROM inventory_balances WHERE item_code = ?").bind(finishedItemCode).first<{ on_hand_qty: number }>();
    const before = numberValue(balance?.on_hand_qty);
    const after = before + goodQty;
    const reportCode = randomCode("PR");
    const itemExists = await recordByCode("items", finishedItemCode);
    if (!itemExists) await createRecord("items", finishedItemCode, { internal_item_code: finishedItemCode, item_category: "FG", standard_name: `${work.product_code} 成品`, item_status: "启用", base_uom: "PCS" }, user.username);
    const statements = [
      database().prepare("INSERT INTO inventory_balances (item_code, on_hand_qty, reserved_qty, version, updated_at) VALUES (?, ?, 0, 1, ?) ON CONFLICT(item_code) DO UPDATE SET on_hand_qty = excluded.on_hand_qty, version = inventory_balances.version + 1, updated_at = excluded.updated_at").bind(finishedItemCode, after, nowText()),
      database().prepare("INSERT INTO inventory_transactions (item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, created_by, created_at) VALUES (?, '完工入库', ?, '生产工单', ?, ?, ?, ?, ?)").bind(finishedItemCode, goodQty, work.work_order_code, before, after, user.username, nowText()),
      database().prepare("INSERT INTO erp_records (kind, code, data_json, version, created_by, created_at, updated_at) VALUES ('production_reports', ?, ?, 1, ?, ?, ?)").bind(reportCode, JSON.stringify({ work_order_id: work.id, report_date: todayText(), process_stage: body.process_stage || "完工入库", good_qty: goodQty, scrap_qty: scrapQty, operator: body.operator || user.display_name, remark: body.remark || "" }), user.username, nowText(), nowText()),
      database().prepare("UPDATE erp_records SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify({ ...work, completed_qty: numberValue(work.completed_qty) + goodQty, work_status: "已完工" }), nowText(), work.id, work.version),
    ];
    await database().batch(statements);
    return jsonResponse({ ok: true, finished_item_code: finishedItemCode, before_qty: before, after_qty: after, report_code: reportCode });
  }
  if (path === "/api/quotations/to-sales-order") {
    const quote = await recordById("quotations", body.quote_id);
    if (!quote) throw new ApiFailure("报价单不存在", 404, "NOT_FOUND");
    if (quote.quote_status === "已转订单") throw new ApiFailure("报价单已经转为销售订单", 409, "ALREADY_CONVERTED");
    const salesCode = randomCode("SO");
    const sales = await createRecord("sales_orders", salesCode, {
      sales_order_code: salesCode,
      customer_name: quote.customer_name,
      product_code: quote.product_code,
      order_qty: quote.quote_qty,
      shipped_qty: 0,
      sales_status: "待生产",
      due_date: body.due_date || "",
      owner: body.owner || quote.owner || user.display_name,
      source_quote_id: quote.id,
      remark: quote.remark || "",
    }, user.username);
    await updateRecord(quote, { ...quote, quote_status: "已转订单", sales_order_id: sales?.id });
    return jsonResponse({ ok: true, sales_order_id: sales?.id, sales_order_code: salesCode });
  }
  if (path === "/api/shipments/from-order") {
    const sales = await recordById("sales_orders", body.sales_order_id);
    const shipQty = numberValue(body.ship_qty);
    if (!sales || shipQty <= 0) throw new ApiFailure("销售订单不存在或出货数量不正确");
    const remaining = numberValue(sales.order_qty) - numberValue(sales.shipped_qty);
    if (shipQty > remaining) throw new ApiFailure("出货数量不能超过订单未出数量");
    const itemCode = `FG-${sales.product_code}`;
    const balance = await database().prepare("SELECT on_hand_qty FROM inventory_balances WHERE item_code = ?").bind(itemCode).first<{ on_hand_qty: number }>();
    const before = numberValue(balance?.on_hand_qty);
    if (before < shipQty) throw new ApiFailure("成品库存不足");
    const after = before - shipQty;
    const shippedQty = numberValue(sales.shipped_qty) + shipQty;
    const status = shippedQty >= numberValue(sales.order_qty) ? "已出货" : "部分出货";
    const shipmentCode = randomCode("SHP");
    await database().batch([
      database().prepare("UPDATE inventory_balances SET on_hand_qty = on_hand_qty - ?, version = version + 1, updated_at = ? WHERE item_code = ? AND on_hand_qty >= ?").bind(shipQty, nowText(), itemCode, shipQty),
      database().prepare("INSERT INTO inventory_transactions (item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, created_by, created_at) VALUES (?, '销售出库', ?, '销售订单', ?, ?, ?, ?, ?)").bind(itemCode, -shipQty, sales.sales_order_code, before, after, user.username, nowText()),
      database().prepare("INSERT INTO erp_records (kind, code, data_json, version, created_by, created_at, updated_at) VALUES ('shipments', ?, ?, 1, ?, ?, ?)").bind(shipmentCode, JSON.stringify({ shipment_code: shipmentCode, sales_order_id: sales.id, product_code: sales.product_code, finished_item_code: itemCode, ship_qty: shipQty, ship_date: stringValue(body.ship_date) || todayText(), receiver: body.receiver || "", remark: body.remark || "" }), user.username, nowText(), nowText()),
      database().prepare("UPDATE erp_records SET data_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify({ ...sales, shipped_qty: shippedQty, sales_status: status }), nowText(), sales.id, sales.version),
    ]);
    return jsonResponse({ ok: true, shipment_code: shipmentCode, sales_status: status, before_qty: before, after_qty: after });
  }
  if (path === "/api/financial-documents/from-sales-order" || path === "/api/financial-documents/from-purchase-order") {
    const receivable = path.includes("sales-order");
    const sourceKind = receivable ? "sales_orders" : "purchase_orders";
    const sourceId = receivable ? body.sales_order_id : body.po_id;
    const source = await recordById(sourceKind, sourceId);
    const totalAmount = numberValue(body.total_amount);
    if (!source || totalAmount <= 0) throw new ApiFailure("来源单据不存在或金额不正确");
    const existing = (await listRecords("financial_documents")).find((row) => row.source_type === sourceKind && String(row.source_id) === String(source.id) && row.doc_type === (receivable ? "应收" : "应付"));
    if (existing) throw new ApiFailure("该来源单据已经生成财务单据", 409, "DUPLICATE_DOCUMENT");
    const docCode = randomCode(receivable ? "AR" : "AP");
    const row = await createRecord("financial_documents", docCode, {
      doc_code: docCode,
      doc_type: receivable ? "应收" : "应付",
      counterparty: receivable ? source.customer_name : source.supplier_name,
      source_type: sourceKind,
      source_id: source.id,
      source_code: receivable ? source.sales_order_code : source.po_code,
      total_amount: totalAmount,
      paid_amount: 0,
      doc_status: "未结清",
      due_date: body.due_date || "",
      created_by: body.created_by || user.display_name,
      remark: body.remark || "",
    }, user.username);
    return jsonResponse({ ok: true, doc_id: row?.id, doc_code: docCode }, 201);
  }
  if (path === "/api/financial-payments") {
    const document = await recordById("financial_documents", body.doc_id);
    const amount = numberValue(body.amount);
    if (!document || amount <= 0) throw new ApiFailure("财务单据不存在或金额不正确");
    const balance = numberValue(document.total_amount) - numberValue(document.paid_amount);
    if (amount > balance) throw new ApiFailure("本次金额不能超过未结金额");
    const paid = numberValue(document.paid_amount) + amount;
    const status = paid >= numberValue(document.total_amount) ? "已结清" : "部分结清";
    const paymentCode = randomCode(document.doc_type === "应收" ? "RCV" : "PAY");
    await createRecord("financial_payments", paymentCode, {
      payment_code: paymentCode,
      payment_type: body.payment_type || (document.doc_type === "应收" ? "收款" : "付款"),
      doc_id: document.id,
      amount,
      payment_date: body.payment_date || todayText(),
      account_name: body.account_name || "",
      handled_by: body.handled_by || user.display_name,
      remark: body.remark || "",
    }, user.username);
    await updateRecord(document, { ...document, paid_amount: paid, doc_status: status });
    return jsonResponse({ ok: true, payment_code: paymentCode, doc_status: status, paid_amount: paid });
  }
  if (path === "/api/backups/create") {
    const records = await database().prepare("SELECT * FROM erp_records WHERE kind != 'backups' ORDER BY id").all<RecordRow>();
    const balances = await database().prepare("SELECT * FROM inventory_balances ORDER BY item_code").all<Record<string, unknown>>();
    const backupName = `erp-backup-${new Date().toISOString().replaceAll(":", "-")}.json`;
    const snapshot = JSON.stringify({ records: records.results, balances: balances.results, created_at: nowText() });
    const row = await createRecord("backups", backupName, { name: backupName, size: new TextEncoder().encode(snapshot).byteLength, snapshot }, user.username);
    return jsonResponse({ ok: true, backup: row, rows: await listRecords("backups") }, 201);
  }
  if (path === "/api/backups/restore") {
    const backup = await recordByCode("backups", stringValue(body.name));
    if (!backup) throw new ApiFailure("备份不存在", 404, "NOT_FOUND");
    const snapshot = JSON.parse(stringValue(backup.snapshot)) as { records: RecordRow[]; balances: Array<Record<string, unknown>> };
    if (snapshot.records.length + snapshot.balances.length > 80) throw new ApiFailure("此备份较大，请通过受控数据迁移流程恢复");
    const statements: D1PreparedStatement[] = [
      database().prepare("DELETE FROM erp_records WHERE kind != 'backups'"),
      database().prepare("DELETE FROM inventory_balances"),
    ];
    for (const record of snapshot.records) statements.push(database().prepare("INSERT INTO erp_records (kind, code, data_json, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(record.kind, record.code, record.data_json, record.version, record.created_by, record.created_at, record.updated_at));
    for (const balance of snapshot.balances) statements.push(database().prepare("INSERT INTO inventory_balances (item_code, on_hand_qty, reserved_qty, version, updated_at) VALUES (?, ?, ?, ?, ?)").bind(balance.item_code, balance.on_hand_qty, balance.reserved_qty, balance.version, balance.updated_at));
    await database().batch(statements);
    await audit(user.username, "恢复备份", stringValue(body.name), requestId);
    return jsonResponse({ ok: true, backup: { name: body.name } });
  }
  return errorResponse("接口不存在", 404, "NOT_FOUND", requestId);
}

async function replayIdempotent(request: Request, username: string, path: string) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || request.method !== "POST") return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await database()
    .prepare("SELECT status_code, response_json FROM idempotency_keys WHERE key = ? AND username = ? AND method = ? AND path = ? AND expires_at > ?")
    .bind(key, username, request.method, path, now)
    .first<{ status_code: number; response_json: string }>();
  return row ? jsonResponse(JSON.parse(row.response_json), row.status_code, { "Idempotency-Replayed": "true" }) : null;
}

async function rememberIdempotent(request: Request, username: string, path: string, response: Response) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || request.method !== "POST" || response.status >= 500 || !response.headers.get("Content-Type")?.includes("application/json")) return;
  const payload = await response.clone().json();
  await database()
    .prepare("INSERT OR REPLACE INTO idempotency_keys (key, username, method, path, status_code, response_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(key, username, request.method, path, response.status, JSON.stringify(payload), Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS, nowText())
    .run();
}

export async function handleErpApi(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const requestId = request.headers.get("X-Request-Id") || crypto.randomUUID();
  try {
    await ensureSchema();
    if (path === "/api/health") return jsonResponse({ ok: true, time: nowText() });
    if (path === "/api/session") return handleSession(request);
    if (path === "/api/setup" && request.method === "POST") return handleSetup(request, requestId);
    if (path === "/api/login" && request.method === "POST") return handleLogin(request, requestId);
    if (path === "/api/logout" && request.method === "POST") return handleLogout(request);

    const user = await currentUser(request);
    if (!user) return errorResponse("请先登录", 401, "UNAUTHENTICATED", requestId);
    const permission = permissionFor(request.method, path);
    if (!userCan(user, permission)) return errorResponse("当前账号没有此操作权限", 403, "FORBIDDEN", requestId);

    const replay = await replayIdempotent(request, user.username, path);
    if (replay) return replay;

    const response = request.method === "GET"
      ? await handleGet(path, url, user)
      : request.method === "POST"
        ? await handlePost(request, path, url, user, requestId)
        : errorResponse("请求方法不支持", 405, "METHOD_NOT_ALLOWED", requestId);
    await rememberIdempotent(request, user.username, path, response);
    return response;
  } catch (error) {
    if (error instanceof ApiFailure) return errorResponse(error.message, error.status, error.code, requestId);
    const message = error instanceof Error ? error.message : "未知错误";
    const duplicate = /UNIQUE constraint failed/i.test(message);
    try {
      await audit("", "接口异常", `${path}: ${message.slice(0, 500)}`, requestId, "failed");
    } catch {
      // Preserve the original failure when audit storage is also unavailable.
    }
    return errorResponse(duplicate ? "记录已经存在，请勿重复提交" : "系统处理失败，请联系管理员", duplicate ? 409 : 500, duplicate ? "DUPLICATE" : "INTERNAL_ERROR", requestId);
  }
}
