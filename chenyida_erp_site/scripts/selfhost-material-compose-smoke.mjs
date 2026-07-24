import { pbkdf2 as pbkdf2Callback, randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

const pbkdf2 = promisify(pbkdf2Callback);
const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const environment = process.env.ERP_ENV;
const creatorUsername = process.env.ERP_ADMIN_USERNAME || "";
const creatorPassword = process.env.ERP_ADMIN_PASSWORD || "";
const reviewerUsername = process.env.ERP_SMOKE_REVIEWER_USERNAME || "";
const reviewerPassword = process.env.ERP_SMOKE_REVIEWER_PASSWORD || "";
const readerUsername = process.env.ERP_SMOKE_READER_USERNAME || "";
const readerPassword = process.env.ERP_SMOKE_READER_PASSWORD || "";
if (environment !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("material compose smoke requires an isolated test database");
if (![creatorUsername, creatorPassword, reviewerUsername, reviewerPassword, readerUsername, readerPassword].every(Boolean)) throw new Error("material compose smoke credentials are required via environment variables");

async function passwordHash(password) {
  if (password.length < 12) throw new Error("smoke passwords must be at least 12 characters");
  const salt = randomBytes(16).toString("hex"); const iterations = 310_000;
  const value = await pbkdf2(password, salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt}$${value.toString("hex")}`;
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "material-compose-smoke-seed" });
try {
  for (const [username, password, role, displayName] of [
    [reviewerUsername, reviewerPassword, "manager", "隔离测试审核员"],
    [readerUsername, readerPassword, "warehouse", "隔离测试只读用户"],
  ]) {
    await pool.query(`
      insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
      values($1,$2,$3,$4,true,false,1)
      on conflict(username) do update set display_name=excluded.display_name,role=excluded.role,password_hash=excluded.password_hash,
        is_active=true,must_change_password=false,version=app_users.version+1,updated_at=now()
    `, [username, displayName, role, await passwordHash(password)]);
  }
} finally { await pool.end(); }

function sessionClient() {
  let cookie = ""; let csrf = "";
  const request = async (path, init = {}, expectedStatus) => {
    const headers = new Headers(init.headers); if (cookie) headers.set("Cookie", cookie);
    const result = await fetch(`${base}${path}`, { ...init, headers });
    const setCookies = typeof result.headers.getSetCookie === "function" ? result.headers.getSetCookie() : [];
    if (setCookies.length) cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
    const payload = await result.json();
    if (expectedStatus !== undefined ? result.status !== expectedStatus : !result.ok) throw new Error(`${path}: ${result.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    return { result, payload };
  };
  return {
    login: async (username, password) => { const value = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); csrf = value.payload.csrf_token; return value.payload; },
    get: (path, expectedStatus) => request(path, {}, expectedStatus),
    write: (path, method, body, key = randomUUID(), expectedStatus) => request(path, { method, headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) }, expectedStatus),
  };
}

function valueFor(definition) {
  if (definition.data_type === "TEXT") return "COMPOSE-SMOKE";
  if (definition.data_type === "INTEGER") return 1;
  if (definition.data_type === "DECIMAL") return 1;
  if (definition.data_type === "BOOLEAN") return false;
  if (definition.data_type === "ENUM") return definition.enum_options?.[0]?.code;
  throw new Error(`unsupported smoke attribute type: ${definition.data_type}`);
}

function draftPayload(schema, name, includeSource) {
  return {
    category_id: schema.category_id,
    basic_fields: {
      standard_name: name, unit: "PCS", brand: "SMOKE", manufacturer: "SMOKE", manufacturer_part_number: "SMOKE-001",
      procurement_type: "PURCHASE", inventory_type: "STOCKED", lot_control_required: false, shelf_life_days: null,
      inspection_type: "NORMAL", environmental_requirement: "ROHS", ...(includeSource ? { source_type: "MANUAL" } : {}),
    },
    attributes: Object.fromEntries(schema.attributes.filter((item) => item.required).map((item) => [item.attribute_code, {
      value: valueFor(item), ...(item.input_contract.unit_mode === "REQUIRED" ? { unit: item.standard_unit } : {}), source: "MANUAL", confidence: 1,
    }])),
  };
}

const creator = sessionClient(); const reviewer = sessionClient(); const reader = sessionClient();
await creator.login(creatorUsername, creatorPassword); await reviewer.login(reviewerUsername, reviewerPassword); await reader.login(readerUsername, readerPassword);
const categories = (await creator.get("/api/material-master/categories?view=flat")).payload.data;
const leaf = categories.find((item) => item.is_leaf); if (!leaf) throw new Error("no active leaf category");
const schema = (await creator.get(`/api/material-master/categories/${leaf.category_id}/schema`)).payload.data;
const marker = `Compose Material Workflow ${randomUUID().slice(0, 8)}`;
const created = await creator.write("/api/material-master/drafts", "POST", draftPayload(schema, marker, true));
const materialId = created.payload.data.material_id;
const edited = await creator.write(`/api/material-master/drafts/${materialId}`, "PATCH", { ...draftPayload(schema, `${marker} 已编辑`, false), expected_version: 1 });
await creator.write(`/api/material-master/drafts/${materialId}/submit`, "POST", { expected_version: edited.payload.data.version, submit_comment: "Compose 双用户审批烟测" });
await creator.write(`/api/material-master/drafts/${materialId}/approve`, "POST", { expected_version: 3 }, randomUUID(), 403);
await reader.write(`/api/material-master/drafts/${materialId}/approve`, "POST", { expected_version: 3 }, randomUUID(), 403);
const approved = await reviewer.write(`/api/material-master/drafts/${materialId}/approve`, "POST", { expected_version: 3, review_comment: "Compose 审核通过" });
const formalCode = approved.payload.data.internal_material_code;
if (!/^CYD-[A-Z][A-Z0-9_]{1,63}-\d{6}$/.test(formalCode)) throw new Error("formal material code mismatch");
const active = (await reader.get(`/api/material-master/materials/${materialId}`)).payload.data;
if (active.material.material_status !== "ACTIVE" || active.material.material_code !== formalCode) throw new Error("ACTIVE material detail mismatch");
const versions = (await reader.get(`/api/material-master/materials/${materialId}/versions?page=1&page_size=20`)).payload;
const changes = (await reader.get(`/api/material-master/materials/${materialId}/change-logs?page=1&page_size=20`)).payload;
const audits = (await reviewer.get(`/api/material-master/materials/${materialId}/audit-logs?page=1&page_size=20`)).payload;
if (versions.pagination.total !== 4 || changes.pagination.total < 7 || audits.pagination.total < 4) throw new Error("material histories are incomplete");
console.info(JSON.stringify({ ok: true, material_id: materialId, formal_code: formalCode, marker, versions: versions.pagination.total, changes: changes.pagination.total, audits: audits.pagination.total }));
