import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import { exportMaterialApiAudit, handleMaterialMasterApi, MATERIAL_ROLE_PERMISSIONS } from "../app/lib/material-api/index.ts";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-14T08:00:00.000Z");
let databaseSequence = 0;

async function applyMigration(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  await DB.batch(sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean).map((part) => DB.prepare(part)));
}

async function seed(DB) {
  const timestamp = fixedNow.toISOString();
  await DB.batch([
    ...[
      ["admin1", "admin"], ["admin2", "admin"], ["manager1", "manager"],
      ["manager2", "manager"], ["purchase1", "purchase"], ["warehouse1", "warehouse"],
    ].map(([username, role]) => DB.prepare(`
      INSERT INTO app_users(username, display_name, role, password_hash, is_active, must_change_password, version, created_at, updated_at)
      VALUES (?, ?, ?, 'test-only', 1, 0, 1, ?, ?)
    `).bind(username, username, role, timestamp, timestamp)),
    DB.prepare(`
      INSERT INTO material_categories(id, category_code, category_name_cn, category_level, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9001, 'FR4_API', 'FR4 API测试', 4, 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_attribute_definitions(id, attribute_code, attribute_name_cn, data_type, decimal_scale, canonical_unit, allowed_values_json, normalization_rule, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9101, 'THICKNESS', '厚度', 'DECIMAL', 3, 'mm', '[]', 'DECIMAL_SCALE', 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_attribute_definitions(id, attribute_code, attribute_name_cn, data_type, decimal_scale, canonical_unit, allowed_values_json, normalization_rule, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9102, 'COLOR', '颜色', 'TEXT', 0, '', '[]', 'TRIM_UPPER', 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_category_attributes(id, category_id, attribute_definition_id, is_required, is_unique_key_component, is_searchable, sort_order, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9201, 9001, 9101, 1, 1, 1, 10, 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_category_attributes(id, category_id, attribute_definition_id, is_required, is_unique_key_component, is_searchable, sort_order, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9202, 9001, 9102, 0, 0, 1, 20, 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_code_rules(id, rule_code, rule_name, category_id, prefix, major_segment, minor_segment, separator, sequence_width, next_sequence, status, effective_from, version, approved_by, approved_at, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9301, 'FR4-API-CODE', 'FR4 API编码', 9001, 'CYD', 'PCB', 'FR4', '-', 6, 1, 'ACTIVE', '2026-01-01', 1, 'manager1', ?, 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp, timestamp),
  ]);
}

async function fixture(rateLimits) {
  databaseSequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `material-api-test-${databaseSequence}` },
  });
  const { DB } = await mf.getBindings();
  await applyMigration(DB, "0000_far_nightmare.sql");
  await applyMigration(DB, "0001_material_master_v2.sql");
  await applyMigration(DB, "0002_material_draft_review_api.sql");
  await applyMigration(DB, "0003_material_draft_lifecycle.sql");
  await seed(DB);
  const users = new Map([
    ["admin1", { username: "admin1", role: "admin", must_change_password: false }],
    ["admin2", { username: "admin2", role: "admin", must_change_password: false }],
    ["manager1", { username: "manager1", role: "manager", must_change_password: false }],
    ["manager2", { username: "manager2", role: "manager", must_change_password: false }],
    ["purchase1", { username: "purchase1", role: "purchase", must_change_password: false }],
    ["warehouse1", { username: "warehouse1", role: "warehouse", must_change_password: false }],
  ]);
  const permissions = {
    admin: new Set(["*"]),
    manager: new Set(["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject"]),
    purchase: new Set(["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit"]),
    warehouse: new Set(["material.read"]),
  };
  return {
    DB,
    mf,
    dependencies: {
      database: DB,
      currentUser: async (request) => users.get(request.headers.get("X-Test-User")) ?? null,
      userCan: (user, permission) => permissions[user.role]?.has("*") || permissions[user.role]?.has(permission) || false,
      clock: () => new Date(fixedNow),
      ...(rateLimits ? { rateLimits } : {}),
    },
  };
}

const csrf = "csrf-test-token";

test("Material role permissions match the approved matrix", () => {
  for (const role of ["admin", "manager"]) {
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.draft.edit_any"));
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.review.queue"));
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.review.approve"));
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.review.reject"));
  }
  for (const role of ["purchase", "engineering"]) {
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.draft.create"));
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.draft.edit_own"));
    assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.draft.submit"));
    assert.ok(!MATERIAL_ROLE_PERMISSIONS[role].includes("material.review.approve"));
  }
  for (const role of ["production", "warehouse", "quality", "sales", "finance", "operations"]) {
    assert.deepEqual(MATERIAL_ROLE_PERMISSIONS[role], ["material.read"]);
  }
});

function draftBody(overrides = {}) {
  const { basic_fields: basicOverrides = {}, ...otherOverrides } = overrides;
  return {
    basic_fields: {
      standard_name: "普通 FR4 覆铜板",
      unit: "PCS",
      source_type: "MANUAL",
      source_ref: "",
      brand: "KINGBOARD",
      manufacturer: "KINGBOARD",
      manufacturer_part_number: "KB-6160",
      procurement_type: "PURCHASE",
      inventory_type: "STOCKED",
      lot_control_required: true,
      shelf_life_days: 365,
      inspection_type: "NORMAL",
      environmental_requirement: "ROHS",
      ...basicOverrides,
    },
    category_id: 9001,
    attributes: { THICKNESS: { value: 1.6, unit: "mm", source: "MANUAL", confidence: 1 } },
    ...otherOverrides,
  };
}

function editBody(expectedVersion, overrides = {}) {
  const created = draftBody(overrides);
  const basicFields = { ...created.basic_fields };
  delete basicFields.source_type;
  delete basicFields.source_ref;
  return {
    expected_version: expectedVersion,
    basic_fields: basicFields,
    category_id: created.category_id,
    attributes: created.attributes,
  };
}

async function api(context, path, { method = "GET", user, body, key = crypto.randomUUID(), includeCsrf = true } = {}) {
  const headers = new Headers();
  if (user) headers.set("X-Test-User", user);
  if (method === "POST" || method === "PATCH") {
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", key);
    headers.set("Origin", "http://local.test");
    if (includeCsrf) {
      headers.set("X-CSRF-Token", csrf);
      headers.set("Cookie", `CYD_ERP_CSRF=${csrf}`);
    }
  }
  const response = await handleMaterialMasterApi(new Request(`http://local.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), context.dependencies);
  return { response, payload: await response.json() };
}

test("Material Draft/Review API enforces auth, permission, CSRF, idempotency and source boundary", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    assert.equal((await api(context, "/api/material-master/drafts")).response.status, 401);
    assert.equal((await api(context, "/api/material-master/drafts", { method: "POST", user: "warehouse1", body: draftBody(), key: "warehouse-denied-01" })).response.status, 403);
    const csrfFailure = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key: "csrf-missing-0001", includeCsrf: false });
    assert.equal(csrfFailure.payload.error.code, "CSRF_INVALID");

    const key = "create-fr4-00000001";
    const created = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.material_status, "DRAFT");
    assert.equal(created.payload.data.internal_material_code, null);
    const replay = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key });
    assert.equal(replay.response.status, 201);
    assert.equal(replay.response.headers.get("idempotency-replayed"), "true");
    assert.equal(replay.payload.operation_id, created.payload.operation_id);
    assert.notEqual(replay.payload.request_id, created.payload.request_id);
    const conflict = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody({ basic_fields: { standard_name: "不同物料" } }), key });
    assert.equal(conflict.payload.error.code, "IDEMPOTENCY_CONFLICT");

    const source = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody({ basic_fields: { source_type: "AI" } }), key: "source-rejected-001" });
    assert.equal(source.response.status, 400);
    assert.equal(source.payload.error.code, "SOURCE_TYPE_NOT_ALLOWED");
    const invalid = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody({ attributes: {} }), key: "invalid-attribute-01" });
    assert.equal(invalid.response.status, 422);
    assert.equal(invalid.payload.error.code, "MATERIAL_VALIDATION_FAILED");
    assert.ok(invalid.payload.error.details.some((issue) => issue.code === "MATERIAL_ATTRIBUTE_REQUIRED"));
    const forged = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: { ...draftBody(), created_by: "admin1" }, key: "forged-actor-0001" });
    assert.equal(forged.payload.error.code, "REQUEST_VALIDATION_FAILED");

    const count = await context.DB.prepare("SELECT COUNT(*) AS total FROM material_master").first();
    assert.equal(count.total, 1);
  } finally {
    await context.mf.dispose();
  }
});

test("Material review forbids self-review and preserves optimistic locking and unique codes", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const selfDraft = await api(context, "/api/material-master/drafts", { method: "POST", user: "admin1", body: draftBody(), key: "admin-self-draft-01" });
    await api(context, `/api/material-master/drafts/${selfDraft.payload.data.material_id}/submit`, { method: "POST", user: "admin1", body: { expected_version: 1 }, key: "admin-self-submit-1" });
    const selfReview = await api(context, `/api/material-master/drafts/${selfDraft.payload.data.material_id}/approve`, { method: "POST", user: "admin1", body: { expected_version: 2 }, key: "admin-self-review-1" });
    assert.equal(selfReview.response.status, 403);
    assert.equal(selfReview.payload.error.code, "SELF_REVIEW_FORBIDDEN");

    const draft = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key: "review-draft-00001" });
    const id = draft.payload.data.material_id;
    const submitted = await api(context, `/api/material-master/drafts/${id}/submit`, { method: "POST", user: "purchase1", body: { expected_version: 1, submit_comment: "提交" }, key: "review-submit-0001" });
    assert.equal(submitted.payload.data.material_status, "PENDING_REVIEW");
    const [left, right] = await Promise.all([
      api(context, `/api/material-master/drafts/${id}/approve`, { method: "POST", user: "manager1", body: { expected_version: 2, review_comment: "通过" }, key: "approve-left-0001" }),
      api(context, `/api/material-master/drafts/${id}/approve`, { method: "POST", user: "admin2", body: { expected_version: 2, review_comment: "通过" }, key: "approve-right-001" }),
    ]);
    const statuses = [left.response.status, right.response.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
    const success = left.response.status === 200 ? left : right;
    const failed = left.response.status === 409 ? left : right;
    assert.match(success.payload.data.internal_material_code, /^CYD-PCB-FR4-\d{6}$/);
    assert.ok(["VERSION_CONFLICT", "MATERIAL_NOT_REVIEWABLE"].includes(failed.payload.error.code));
    const codes = await context.DB.prepare("SELECT internal_material_code FROM material_master WHERE id = ?").bind(id).all();
    assert.equal(codes.results.length, 1);
    assert.equal(codes.results[0].internal_material_code, success.payload.data.internal_material_code);

    const rejectedDraft = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key: "reject-draft-00001" });
    const rejectId = rejectedDraft.payload.data.material_id;
    await api(context, `/api/material-master/drafts/${rejectId}/submit`, { method: "POST", user: "purchase1", body: { expected_version: 1 }, key: "reject-submit-0001" });
    const missingReason = await api(context, `/api/material-master/drafts/${rejectId}/reject`, { method: "POST", user: "manager1", body: { expected_version: 2 }, key: "reject-no-reason-01" });
    assert.equal(missingReason.response.status, 400);
    assert.equal(missingReason.payload.error.code, "REVIEW_REASON_REQUIRED");
    const rejected = await api(context, `/api/material-master/drafts/${rejectId}/reject`, { method: "POST", user: "manager1", body: { expected_version: 2, reason: "缺少证明" }, key: "reject-valid-00001" });
    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.payload.data.material_status, "DRAFT");
    assert.equal(rejected.payload.data.version, 3);
    const stale = await api(context, `/api/material-master/drafts/${rejectId}/reject`, { method: "POST", user: "manager1", body: { expected_version: 1, reason: "再次驳回" }, key: "reject-stale-00001" });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.error.code, "VERSION_CONFLICT");
  } finally {
    await context.mf.dispose();
  }
});

test("Material draft lifecycle supports full replacement, queue, separation and resubmission", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const created = await api(context, "/api/material-master/drafts", {
      method: "POST", user: "purchase1",
      body: draftBody({ attributes: {
        THICKNESS: { value: 1.6, unit: "mm", source: "MANUAL" },
        COLOR: { value: "GREEN", source: "MANUAL" },
      } }),
      key: "lifecycle-create-001",
    });
    const id = created.payload.data.material_id;
    const directReview = await api(context, `/api/material-master/drafts/${id}/approve`, {
      method: "POST", user: "admin2", body: { expected_version: 1 }, key: "direct-draft-review-1",
    });
    assert.equal(directReview.payload.error.code, "MATERIAL_NOT_REVIEWABLE");
    const editKey = "lifecycle-edit-0001";
    const edited = await api(context, `/api/material-master/drafts/${id}`, {
      method: "PATCH", user: "manager1",
      body: editBody(1, { basic_fields: { standard_name: "普通 FR4 覆铜板 V2" } }), key: editKey,
    });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.payload.data.version, 2);
    assert.equal(edited.payload.data.last_modified_by, "manager1");
    assert.equal(edited.payload.data.validation_summary.valid, true);
    const editReplay = await api(context, `/api/material-master/drafts/${id}`, {
      method: "PATCH", user: "manager1",
      body: editBody(1, { basic_fields: { standard_name: "普通 FR4 覆铜板 V2" } }), key: editKey,
    });
    assert.equal(editReplay.response.headers.get("idempotency-replayed"), "true");
    const unchanged = await api(context, `/api/material-master/drafts/${id}`, {
      method: "PATCH", user: "manager1",
      body: editBody(2, { basic_fields: { standard_name: "普通 FR4 覆铜板 V2" } }), key: "lifecycle-unchanged-1",
    });
    assert.equal(unchanged.payload.error.code, "DRAFT_NOT_CHANGED");
    const attributes = await context.DB.prepare(`
      SELECT d.attribute_code FROM material_attribute_values v
      INNER JOIN material_attribute_definitions d ON d.id = v.attribute_definition_id
      WHERE v.material_id = ? ORDER BY d.attribute_code
    `).bind(id).all();
    assert.deepEqual(attributes.results, [{ attribute_code: "THICKNESS" }]);

    const submitted = await api(context, `/api/material-master/drafts/${id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 2, submit_comment: "  已补充资料  " }, key: "lifecycle-submit-01",
    });
    assert.equal(submitted.payload.data.material_status, "PENDING_REVIEW");
    assert.equal(submitted.payload.data.version, 3);
    assert.equal(submitted.payload.data.submitted_by, "purchase1");
    assert.equal(submitted.payload.data.submitted_at, fixedNow.toISOString());
    const hiddenQueue = await api(context, "/api/material-master/review-queue", { user: "purchase1" });
    assert.equal(hiddenQueue.response.status, 403);
    const queue = await api(context, "/api/material-master/review-queue?page=1&page_size=20&sort=submitted_at_desc", { user: "manager2" });
    assert.equal(queue.response.status, 200);
    assert.equal(queue.payload.data[0].material_id, id);
    assert.equal(queue.payload.data[0].validation_summary.basis, "CURRENT_METADATA");
    assert.ok(queue.payload.data[0].validation_summary.top_issues.length <= 5);
    const lastEditorReview = await api(context, `/api/material-master/drafts/${id}/approve`, {
      method: "POST", user: "manager1", body: { expected_version: 3 }, key: "last-editor-review-1",
    });
    assert.equal(lastEditorReview.payload.error.code, "LAST_EDITOR_REVIEW_FORBIDDEN");
    const rejected = await api(context, `/api/material-master/drafts/${id}/reject`, {
      method: "POST", user: "admin2", body: { expected_version: 3, reason: "需要调整名称" }, key: "lifecycle-reject-01",
    });
    assert.equal(rejected.payload.data.material_status, "DRAFT");
    assert.equal(rejected.payload.data.version, 4);
    const reedited = await api(context, `/api/material-master/drafts/${id}`, {
      method: "PATCH", user: "purchase1",
      body: editBody(4, { basic_fields: { standard_name: "普通 FR4 覆铜板 V3" } }), key: "lifecycle-reedit-01",
    });
    assert.equal(reedited.payload.data.version, 5);
    const resubmitted = await api(context, `/api/material-master/drafts/${id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 5, submit_comment: "重新提交" }, key: "lifecycle-resubmit-1",
    });
    assert.equal(resubmitted.payload.data.version, 6);
    const submitHistory = await context.DB.prepare("SELECT change_reason FROM material_versions WHERE material_id = ? AND event_type = 'SUBMIT' ORDER BY version_no").bind(id).all();
    assert.deepEqual(submitHistory.results, [{ change_reason: "已补充资料" }, { change_reason: "重新提交" }]);
    const formerEditorApproval = await api(context, `/api/material-master/drafts/${id}/approve`, {
      method: "POST", user: "manager1", body: { expected_version: 6, review_comment: "后续版本通过" }, key: "former-editor-approve",
    });
    assert.equal(formerEditorApproval.response.status, 200);

    const direct = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key: "submitter-only-create" });
    const directId = direct.payload.data.material_id;
    await api(context, `/api/material-master/drafts/${directId}/submit`, { method: "POST", user: "manager2", body: { expected_version: 1 }, key: "submitter-only-submit" });
    const submitterApproval = await api(context, `/api/material-master/drafts/${directId}/approve`, { method: "POST", user: "manager2", body: { expected_version: 2 }, key: "submitter-only-approve" });
    assert.equal(submitterApproval.response.status, 200);

    const concurrent = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key: "concurrent-edit-create" });
    const concurrentId = concurrent.payload.data.material_id;
    const editOutcomes = await Promise.all([
      api(context, `/api/material-master/drafts/${concurrentId}`, { method: "PATCH", user: "manager1", body: editBody(1, { basic_fields: { standard_name: "并发编辑 A" } }), key: "concurrent-edit-a" }),
      api(context, `/api/material-master/drafts/${concurrentId}`, { method: "PATCH", user: "manager2", body: editBody(1, { basic_fields: { standard_name: "并发编辑 B" } }), key: "concurrent-edit-b" }),
    ]);
    assert.deepEqual(editOutcomes.map((result) => result.response.status).sort((a, b) => a - b), [200, 409]);
    const submitOutcomes = await Promise.all([
      api(context, `/api/material-master/drafts/${concurrentId}/submit`, { method: "POST", user: "purchase1", body: { expected_version: 2 }, key: "concurrent-submit-a" }),
      api(context, `/api/material-master/drafts/${concurrentId}/submit`, { method: "POST", user: "manager2", body: { expected_version: 2 }, key: "concurrent-submit-b" }),
    ]);
    assert.deepEqual(submitOutcomes.map((result) => result.response.status).sort((a, b) => a - b), [200, 409]);
    const concurrentHistory = await context.DB.prepare("SELECT event_type,COUNT(*) AS total FROM material_versions WHERE material_id=? AND event_type IN ('UPDATE','SUBMIT') GROUP BY event_type ORDER BY event_type").bind(concurrentId).all();
    assert.deepEqual(concurrentHistory.results, [{ event_type: "SUBMIT", total: 1 }, { event_type: "UPDATE", total: 1 }]);
  } finally {
    await context.mf.dispose();
  }
});

test("Material queries are bounded and audit output is sanitized", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const created = await api(context, "/api/material-master/drafts", { method: "POST", user: "purchase1", body: draftBody(), key: "query-draft-000001" });
    const list = await api(context, "/api/material-master/drafts?page=1&page_size=20", { user: "warehouse1" });
    assert.equal(list.response.status, 200);
    assert.equal(list.payload.pagination.page_size, 20);
    const unbounded = await api(context, "/api/material-master/drafts?page_size=101", { user: "warehouse1" });
    assert.equal(unbounded.payload.error.code, "REQUEST_VALIDATION_FAILED");
    const detail = await api(context, `/api/material-master/drafts/${created.payload.data.material_id}`, { user: "warehouse1" });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.data.validation.basis, "CURRENT_METADATA");
    assert.equal("reviewGuard" in detail.payload.data.material, false);
    const audit = await context.DB.prepare("SELECT detail, idempotency_key_digest, retention_until FROM audit_log WHERE route_code <> ''").all();
    assert.ok(audit.results.length >= 3);
    for (const row of audit.results) {
      const text = JSON.stringify(row);
      assert.doesNotMatch(text, /csrf-test-token|query-draft-000001|CYD_ERP_CSRF/);
      assert.ok(row.retention_until > Math.floor(fixedNow.getTime() / 1000));
      assert.ok(row.idempotency_key_digest === "" || /^[a-f0-9]{64}$/.test(row.idempotency_key_digest));
    }
    const managerExport = await exportMaterialApiAudit(context.DB, { role: "manager", pageSize: 100 });
    assert.ok(managerExport.items.length >= 3);
    await assert.rejects(
      exportMaterialApiAudit(context.DB, { role: "warehouse", pageSize: 100 }),
      (error) => error?.code === "FORBIDDEN",
    );
  } finally {
    await context.mf.dispose();
  }
});

test("Material write rate limits are test-configurable and bounded", { timeout: 120_000 }, async () => {
  const context = await fixture({ attemptsPerMinute: 5, newKeysPerMinute: 1 });
  try {
    await context.DB.prepare(`
      INSERT INTO material_api_idempotency(
        username, method, route_scope, key_digest, request_digest, operation_id,
        state, lease_token_digest, lease_expires_at, created_at, updated_at
      ) VALUES ('manager1', 'POST', '/api/material-master/drafts', ?, ?, ?, 'PENDING', ?, 1, ?, ?)
    `).bind(
      "a".repeat(64),
      "b".repeat(64),
      "00000000-0000-4000-8000-000000000099",
      "c".repeat(64),
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:00:00.000Z",
    ).run();
    const first = await api(context, "/api/material-master/drafts/999999/reject", { method: "POST", user: "manager2", body: { expected_version: 1, reason: "测试" }, key: "rate-new-key-0001" });
    assert.equal(first.response.status, 404);
    const abandoned = await context.DB.prepare("SELECT state, status_code FROM material_api_idempotency WHERE operation_id = '00000000-0000-4000-8000-000000000099'").first();
    assert.deepEqual(abandoned, { state: "COMPLETED", status_code: 500 });
    const second = await api(context, "/api/material-master/drafts/999998/reject", { method: "POST", user: "manager2", body: { expected_version: 1, reason: "测试" }, key: "rate-new-key-0002" });
    assert.equal(second.response.status, 429);
    assert.equal(second.payload.error.code, "RATE_LIMITED");
    assert.ok(Number(second.response.headers.get("retry-after")) > 0);
    const bucket = await context.DB.prepare("SELECT attempt_count, new_key_count, rejected_count FROM material_api_rate_limit_buckets WHERE username = 'manager2'").first();
    assert.equal(bucket.new_key_count, 1);
    assert.equal(bucket.rejected_count, 1);
  } finally {
    await context.mf.dispose();
  }
});
