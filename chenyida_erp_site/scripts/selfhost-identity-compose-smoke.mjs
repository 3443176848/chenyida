import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_IDENTITY_SMOKE_PHASE || "initial";
const setupToken = process.env.ERP_SETUP_TOKEN || "";
const adminUsername = process.env.ERP_ADMIN_USERNAME || "";
const adminPassword = process.env.ERP_ADMIN_PASSWORD || "";
const purchaseUsername = process.env.ERP_IDENTITY_PURCHASE_USERNAME || "";
const temporaryPassword = process.env.ERP_IDENTITY_TEMPORARY_PASSWORD || "";
const changedPassword = process.env.ERP_IDENTITY_CHANGED_PASSWORD || "";
const resetPassword = process.env.ERP_IDENTITY_RESET_PASSWORD || "";

if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) {
  throw new Error("identity compose smoke requires an isolated test database");
}
if (!setupToken || ![adminUsername, adminPassword, purchaseUsername, temporaryPassword, changedPassword, resetPassword].every(Boolean)) {
  throw new Error("identity compose smoke credentials are required via environment variables");
}

function client() {
  const cookies = new Map();
  let csrf = "";
  async function request(path, init = {}, expectedStatus) {
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const content = pair.slice(separator + 1);
      if (/Max-Age=0/i.test(value)) cookies.delete(name); else cookies.set(name, content);
    }
    const payload = await response.json();
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    }
    return { response, payload };
  }
  return {
    request,
    login: async (username, password) => {
      const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }, 200);
      csrf = result.payload.csrf_token;
      return result;
    },
    get: (path, expectedStatus) => request(path, {}, expectedStatus),
    write: (path, body, expectedStatus = 200, key = randomUUID()) => request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key },
      body: JSON.stringify(body),
    }, expectedStatus),
  };
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "identity-compose-smoke" });
try {
  if (phase === "initial") {
    const setup = client();
    await setup.request("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_token: setupToken, username: adminUsername, display_name: "身份烟测管理员", password: adminPassword }),
    }, 201);

    const admin = client();
    await admin.login(adminUsername, adminPassword);
    const created = await admin.write("/api/users", {
      username: purchaseUsername, display_name: "身份烟测采购员", role: "purchase", temporary_password: temporaryPassword,
    }, 201, "identity-compose-create-purchase");
    if (created.payload.user.version !== 1 || !created.payload.user.must_change_password) throw new Error("created purchase identity contract mismatch");

    const purchase = client();
    await purchase.login(purchaseUsername, temporaryPassword);
    const blocked = await purchase.get("/api/material-master/materials?page=1&page_size=20", 403);
    if (blocked.payload.code !== "PASSWORD_CHANGE_REQUIRED") throw new Error("must-change gate did not block Material API");
    await purchase.write("/api/me/password", {
      old_password: temporaryPassword, new_password: changedPassword, expected_version: 1,
    }, 200, "identity-compose-change-password");
    await purchase.get("/api/material-master/materials?page=1&page_size=20", 200);

    await admin.write("/api/users/status", { username: purchaseUsername, is_active: false, expected_version: 2 }, 200, "identity-compose-disable-purchase");
    const revoked = await purchase.get("/api/material-master/materials?page=1&page_size=20", 401);
    if (revoked.payload.code !== "SESSION_REVOKED") throw new Error("deactivation did not revoke the old session");
    await admin.write("/api/users/status", { username: purchaseUsername, is_active: true, expected_version: 3 }, 200, "identity-compose-enable-purchase");
    const beforeReset = client();
    await beforeReset.login(purchaseUsername, changedPassword);
    await admin.write("/api/users/reset-password", {
      username: purchaseUsername, temporary_password: resetPassword, expected_version: 4,
    }, 200, "identity-compose-reset-purchase");
    const resetRevoked = await beforeReset.get("/api/material-master/materials?page=1&page_size=20", 401);
    if (resetRevoked.payload.code !== "SESSION_REVOKED") throw new Error("password reset did not revoke the old session");
    const resetLogin = client();
    const resetSession = await resetLogin.login(purchaseUsername, resetPassword);
    if (!resetSession.payload.user.must_change_password || resetSession.payload.user.version !== 5) throw new Error("reset temporary-password state mismatch");
    const audit = await admin.get(`/api/system/audit-logs?target_username=${purchaseUsername}&page=1&page_size=100`, 200);
    if (audit.payload.pagination.total < 6) throw new Error("identity audit lifecycle is incomplete");

    const persisted = await pool.query(`
      select u.version,u.is_active,u.must_change_password,
        count(s.*) filter(where s.revoked_at is not null)::int revoked_sessions,
        count(a.*)::int audit_rows
      from app_users u
      left join app_sessions s on s.username=u.username
      left join audit_log a on a.target_username=u.username and a.route_code='IDENTITY'
      where u.username=$1 group by u.username
    `, [purchaseUsername]);
    if (!persisted.rows[0] || persisted.rows[0].version !== 5 || !persisted.rows[0].must_change_password || persisted.rows[0].revoked_sessions < 2) {
      throw new Error(`identity persisted state mismatch: ${JSON.stringify(persisted.rows[0])}`);
    }
    console.info(JSON.stringify({ ok: true, phase, username: purchaseUsername, version: 5, audit_rows: audit.payload.pagination.total }));
  } else if (phase === "restart") {
    const admin = client();
    await admin.login(adminUsername, adminPassword);
    const users = await admin.get("/api/users", 200);
    const purchase = users.payload.data.find((item) => item.username === purchaseUsername);
    if (!purchase || purchase.version !== 5 || !purchase.is_active || !purchase.must_change_password) throw new Error("identity state was not preserved after restart");
    const audit = await admin.get(`/api/system/audit-logs?target_username=${purchaseUsername}&page=1&page_size=100`, 200);
    if (audit.payload.pagination.total < 6) throw new Error("identity audit was not preserved after restart");
    const passwordDigest = createHash("sha256").update(resetPassword).digest("hex");
    const databaseState = await pool.query(`
      select
        (select count(*)::int from app_sessions where username=$1 and revoked_at is not null) revoked_sessions,
        (select count(*)::int from audit_log where target_username=$1 and route_code='IDENTITY') audit_rows,
        (select count(*)::int from app_users where username=$1 and version=5 and must_change_password=true) users
    `, [purchaseUsername]);
    if (databaseState.rows[0].revoked_sessions < 2 || databaseState.rows[0].audit_rows < 6 || databaseState.rows[0].users !== 1) throw new Error("database identity state was not durable");
    if (JSON.stringify({ users, audit, databaseState }).includes(passwordDigest)) throw new Error("password material leaked into persisted DTOs");
    console.info(JSON.stringify({ ok: true, phase, username: purchaseUsername, version: purchase.version, audit_rows: audit.payload.pagination.total }));
  } else {
    throw new Error(`unsupported ERP_IDENTITY_SMOKE_PHASE: ${phase}`);
  }
} finally {
  await pool.end();
}
