import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  exportMaterialApiAudit,
  handleMaterialMasterApi,
  MATERIAL_ROLE_PERMISSIONS,
  projectCategoryAttributeSchema,
} from "../app/lib/material-api/index.ts";

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
      ["manager2", "manager"], ["purchase1", "purchase"], ["purchase2", "purchase"],
      ["warehouse1", "warehouse"], ["reviewer1", "reviewer"],
    ].map(([username, role]) => DB.prepare(`
      INSERT INTO app_users(username, display_name, role, password_hash, is_active, must_change_password, version, created_at, updated_at)
      VALUES (?, ?, ?, 'test-only', 1, 0, 1, ?, ?)
    `).bind(username, username, role, timestamp, timestamp)),
    ...[
      [9000, "ROOT_API", "物料", null, 1],
      [9002, "GROUP_API", "板材", 9000, 2],
      [9003, "FAMILY_API", "FR4", 9002, 3],
      [9001, "FR4_API", "FR4 API测试", 9003, 4],
    ].map(([id, code, name, parentId, level], index) => DB.prepare(`
      INSERT INTO material_categories(id, category_code, category_name_cn, parent_id, category_level, status, sort_order, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 'test', ?, 'test', ?, 'seed')
    `).bind(id, code, name, parentId, level, index + 1, timestamp, timestamp)),
    DB.prepare(`
      INSERT INTO material_attribute_definitions(id, attribute_code, attribute_name_cn, data_type, decimal_scale, canonical_unit, allowed_values_json, normalization_rule, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9101, 'THICKNESS', '厚度', 'DECIMAL', 3, 'mm', '[]', 'DECIMAL_SCALE', 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_attribute_definitions(id, attribute_code, attribute_name_cn, data_type, decimal_scale, canonical_unit, allowed_values_json, normalization_rule, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9102, 'COLOR', '颜色', 'TEXT', 0, '', '[]', 'TRIM_UPPER', 'ACTIVE', 'test', ?, 'test', ?, 'seed')
    `).bind(timestamp, timestamp),
    DB.prepare(`
      INSERT INTO material_attribute_definitions(id, attribute_code, attribute_name_cn, data_type, decimal_scale, canonical_unit, allowed_values_json, normalization_rule, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9103, 'SURFACE', '表面处理', 'ENUM', 0, '', '["HASL","ENIG"]', 'ENUM_CODE', 'ACTIVE', 'test', ?, 'test', ?, 'seed')
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
      INSERT INTO material_category_attributes(id, category_id, attribute_definition_id, is_required, is_unique_key_component, is_searchable, sort_order, status, created_by, created_at, updated_by, updated_at, request_id)
      VALUES (9203, 9001, 9103, 0, 0, 1, 30, 'ACTIVE', 'test', ?, 'test', ?, 'seed')
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
    ["purchase2", { username: "purchase2", role: "purchase", must_change_password: false }],
    ["warehouse1", { username: "warehouse1", role: "warehouse", must_change_password: false }],
    ["reviewer1", { username: "reviewer1", role: "reviewer", must_change_password: false }],
  ]);
  const permissions = {
    admin: new Set(["*"]),
    manager: new Set(["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject"]),
    purchase: new Set(["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit"]),
    warehouse: new Set(["material.read"]),
    reviewer: new Set(["material.read", "material.review.queue"]),
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

async function api(context, path, { method = "GET", user, body, key = crypto.randomUUID(), includeCsrf = true, requestHeaders = {} } = {}) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(requestHeaders)) headers.set(name, value);
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
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
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
    const hidden = await api(context, `/api/material-master/drafts/${created.payload.data.material_id}`, { user: "warehouse1" });
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.payload.error.code, "MATERIAL_NOT_FOUND");
    const detail = await api(context, `/api/material-master/drafts/${created.payload.data.material_id}`, { user: "purchase1" });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.data.validation.basis, "CURRENT_METADATA");
    assert.equal(detail.payload.data.last_rejection, null);
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

test("Material reference APIs return complete metadata, stable fallbacks and content ETags", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const tree = await api(context, "/api/material-master/categories?view=tree", { user: "warehouse1" });
    assert.equal(tree.response.status, 200);
    assert.equal(tree.response.headers.get("cache-control"), "private, max-age=300, must-revalidate");
    assert.match(tree.response.headers.get("etag"), /^"sha256-[A-Za-z0-9_-]{43}"$/);
    assert.equal(tree.payload.data[0].children[0].children[0].children[0].category_id, 9001);
    const firstEtag = tree.response.headers.get("etag");
    const notModified = await api(context, "/api/material-master/categories?view=tree", {
      user: "warehouse1", requestHeaders: { "If-None-Match": firstEtag },
    });
    assert.equal(notModified.response.status, 304);
    assert.equal(notModified.payload, null);
    assert.equal(notModified.response.headers.get("etag"), firstEtag);
    assert.ok(notModified.response.headers.get("x-request-id"));
    const unauthenticated304 = await api(context, "/api/material-master/categories?view=tree", {
      requestHeaders: { "If-None-Match": firstEtag },
    });
    assert.equal(unauthenticated304.response.status, 401);

    const flat = await api(context, "/api/material-master/categories?view=flat", { user: "warehouse1" });
    assert.deepEqual(flat.payload.data.map((node) => node.category_id), [9000, 9002, 9003, 9001]);
    assert.ok(flat.payload.data.every((node) => node.children.length === 0));

    const schema = await api(context, "/api/material-master/categories/9001/schema", { user: "warehouse1" });
    assert.equal(schema.response.status, 200);
    assert.match(schema.payload.data.schema_version, /^sha256:[a-f0-9]{64}$/);
    const thickness = schema.payload.data.attributes.find((attribute) => attribute.attribute_code === "THICKNESS");
    const surface = schema.payload.data.attributes.find((attribute) => attribute.attribute_code === "SURFACE");
    assert.equal(thickness.description, "");
    assert.deepEqual(thickness.compatible_units, ["mm", "um"]);
    assert.deepEqual(surface.enum_options, [{ code: "HASL", label: "HASL" }, { code: "ENIG", label: "ENIG" }]);
    const schema304 = await api(context, "/api/material-master/categories/9001/schema", {
      user: "warehouse1", requestHeaders: { "If-None-Match": schema.response.headers.get("etag") },
    });
    assert.equal(schema304.response.status, 304);
    const missingSchema = await api(context, "/api/material-master/categories/999999/schema", { user: "warehouse1" });
    assert.equal(missingSchema.response.status, 404);
    assert.equal(missingSchema.payload.error.code, "CATEGORY_NOT_FOUND");
    const nonLeafSchema = await api(context, "/api/material-master/categories/9000/schema", { user: "warehouse1" });
    assert.equal(nonLeafSchema.response.status, 409);
    assert.equal(nonLeafSchema.payload.error.code, "CATEGORY_NOT_LEAF");

    await context.DB.prepare("UPDATE material_categories SET category_name_cn = 'FR4 API已更新', updated_at = ? WHERE id = 9001")
      .bind("2026-07-14T09:00:00.000Z").run();
    const changed = await api(context, "/api/material-master/categories?view=tree", {
      user: "warehouse1", requestHeaders: { "If-None-Match": firstEtag },
    });
    assert.equal(changed.response.status, 200);
    assert.notEqual(changed.response.headers.get("etag"), firstEtag);

    const fallbackProjection = projectCategoryAttributeSchema({
      attributeCode: "FINISH", name: "表面", dataType: "ENUM", required: false,
      canonicalUnit: "", decimalScale: 0, allowedValuesJson: '["A"]', displayOrder: 1,
    });
    const realMetadataProjection = projectCategoryAttributeSchema({
      attributeCode: "FINISH", name: "表面", description: "真实描述", dataType: "ENUM", required: false,
      canonicalUnit: "", decimalScale: 0, allowedValuesJson: '["A"]', enumLabels: { A: "显示名" }, displayOrder: 1,
    });
    assert.deepEqual(Object.keys(realMetadataProjection), Object.keys(fallbackProjection));
    assert.equal(fallbackProjection.description, "");
    assert.deepEqual(fallbackProjection.enum_options, [{ code: "A", label: "A" }]);
    assert.equal(realMetadataProjection.description, "真实描述");
    assert.deepEqual(realMetadataProjection.enum_options, [{ code: "A", label: "显示名" }]);

    const source = await readFile(join(siteRoot, "app", "lib", "material-api", "reference-query-service.ts"), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*seed|material-categories-v1|material-category-seed/i);

    await context.DB.prepare("UPDATE material_attribute_definitions SET data_type = 'DATE' WHERE id = 9102").run();
    const invalidSchema = await api(context, "/api/material-master/categories/9001/schema", { user: "warehouse1" });
    assert.equal(invalidSchema.response.status, 500);
    assert.equal(invalidSchema.payload.error.code, "CATEGORY_SCHEMA_INVALID");
  } finally {
    await context.mf.dispose();
  }
});

test("Unified material queries enforce row visibility before filters, totals and details", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const create = async (user, suffix) => api(context, "/api/material-master/drafts", {
      method: "POST", user, body: draftBody({ basic_fields: { standard_name: `物料 ${suffix}` } }), key: `visibility-create-${suffix}`,
    });
    const ownDraft = await create("purchase1", "p1-draft");
    const otherDraft = await create("purchase2", "p2-draft");
    const ownPending = await create("purchase1", "p1-pending");
    await api(context, `/api/material-master/drafts/${ownPending.payload.data.material_id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 1 }, key: "visibility-submit-p1",
    });
    const otherPending = await create("purchase2", "p2-pending");
    await api(context, `/api/material-master/drafts/${otherPending.payload.data.material_id}/submit`, {
      method: "POST", user: "purchase2", body: { expected_version: 1 }, key: "visibility-submit-p2",
    });
    const formal = await create("purchase1", "formal");
    await api(context, `/api/material-master/drafts/${formal.payload.data.material_id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 1 }, key: "visibility-submit-formal",
    });
    await api(context, `/api/material-master/drafts/${formal.payload.data.material_id}/approve`, {
      method: "POST", user: "manager1", body: { expected_version: 2, review_comment: "通过" }, key: "visibility-approve-formal",
    });

    const warehouse = await api(context, "/api/material-master/materials", { user: "warehouse1" });
    assert.equal(warehouse.response.status, 200);
    assert.equal(warehouse.payload.pagination.total, 1);
    assert.deepEqual(warehouse.payload.data.map((item) => item.material_status), ["ACTIVE"]);
    assert.equal(warehouse.response.headers.get("cache-control"), "private, no-store");
    assert.equal(warehouse.response.headers.get("pragma"), "no-cache");
    const bypass = await api(context, "/api/material-master/materials?material_status=DRAFT", { user: "warehouse1" });
    assert.equal(bypass.payload.pagination.total, 0);
    const hidden = await api(context, `/api/material-master/materials/${otherDraft.payload.data.material_id}`, { user: "warehouse1" });
    assert.equal(hidden.response.status, 404);
    assert.equal(hidden.payload.error.code, "MATERIAL_NOT_FOUND");

    const purchase = await api(context, "/api/material-master/materials?page_size=100", { user: "purchase1" });
    assert.equal(purchase.payload.pagination.total, 3);
    assert.deepEqual(new Set(purchase.payload.data.map((item) => item.material_id)), new Set([
      ownDraft.payload.data.material_id, ownPending.payload.data.material_id, formal.payload.data.material_id,
    ]));
    const manager = await api(context, "/api/material-master/materials?page_size=100", { user: "manager1" });
    assert.equal(manager.payload.pagination.total, 5);
    const reviewer = await api(context, "/api/material-master/materials?page_size=100", { user: "reviewer1" });
    assert.equal(reviewer.payload.pagination.total, 3);
    assert.ok(reviewer.payload.data.every((item) => item.material_status !== "DRAFT"));
    const reviewerDrafts = await api(context, "/api/material-master/drafts?material_status=DRAFT", { user: "reviewer1" });
    assert.equal(reviewerDrafts.payload.pagination.total, 0);
    const reviewerPending = await api(context, "/api/material-master/drafts?material_status=PENDING_REVIEW", { user: "reviewer1" });
    assert.equal(reviewerPending.payload.pagination.total, 2);
    const incompatibleStatus = await api(context, "/api/material-master/drafts?material_status=ACTIVE", { user: "manager1" });
    assert.equal(incompatibleStatus.response.status, 400);
    assert.equal(incompatibleStatus.payload.error.code, "REQUEST_VALIDATION_FAILED");
    const queueDenied = await api(context, "/api/material-master/review-queue", { user: "warehouse1" });
    assert.equal(queueDenied.response.status, 403);
  } finally {
    await context.mf.dispose();
  }
});

test("Material detail history is bounded and full histories use deterministic pagination", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const created = await api(context, "/api/material-master/drafts", {
      method: "POST", user: "purchase1", body: draftBody(), key: "history-create",
    });
    const id = created.payload.data.material_id;
    for (let version = 1; version <= 5; version += 1) {
      const edited = await api(context, `/api/material-master/drafts/${id}`, {
        method: "PATCH", user: "purchase1",
        body: editBody(version, { basic_fields: { standard_name: `历史物料 ${version}` } }),
        key: `history-edit-${version}`,
      });
      assert.equal(edited.response.status, 200);
    }
    await api(context, `/api/material-master/drafts/${id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 6 }, key: "history-submit",
    });
    const rejected = await api(context, `/api/material-master/drafts/${id}/reject`, {
      method: "POST", user: "manager1", body: { expected_version: 7, reason: "补充资料" }, key: "history-reject",
    });
    assert.equal(rejected.response.status, 200);

    const detail = await api(context, `/api/material-master/materials/${id}`, { user: "purchase1" });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.data.history_summary.versions.items.length, 5);
    assert.equal(detail.payload.data.history_summary.versions.total, 8);
    assert.equal(detail.payload.data.history_summary.versions.has_more, true);
    assert.ok(detail.payload.data.history_summary.versions.items.every((item) => !("snapshot" in item)));
    assert.ok(detail.payload.data.history_summary.change_logs.items.every((item) => !("old_value" in item) && !("new_value" in item)));

    const versions1 = await api(context, `/api/material-master/materials/${id}/versions?page=1&page_size=2`, { user: "purchase1" });
    const versions2 = await api(context, `/api/material-master/materials/${id}/versions?page=2&page_size=2`, { user: "purchase1" });
    assert.equal(versions1.payload.pagination.total, 8);
    assert.equal(versions1.payload.data.length, 2);
    assert.ok(versions1.payload.data.every((item) => typeof item.snapshot === "object" && !Array.isArray(item.snapshot)));
    assert.deepEqual(versions1.payload.data.map((item) => item.version), [8, 7]);
    assert.deepEqual(versions2.payload.data.map((item) => item.version), [6, 5]);
    const logs = await api(context, `/api/material-master/materials/${id}/change-logs?page=1&page_size=2`, { user: "purchase1" });
    assert.equal(logs.payload.data.length, 2);
    assert.ok("old_value" in logs.payload.data[0] && "new_value" in logs.payload.data[0]);
    const tooLarge = await api(context, `/api/material-master/materials/${id}/versions?page_size=51`, { user: "purchase1" });
    assert.equal(tooLarge.response.status, 400);
    const invisible = await api(context, `/api/material-master/materials/${id}/versions`, { user: "purchase2" });
    assert.equal(invisible.response.status, 404);
    assert.equal(invisible.payload.error.code, "MATERIAL_NOT_FOUND");
    await context.DB.prepare("UPDATE material_versions SET snapshot_json = '{broken' WHERE material_id = ? AND version_no = 8").bind(id).run();
    const corrupted = await api(context, `/api/material-master/materials/${id}/versions`, { user: "purchase1" });
    assert.equal(corrupted.response.status, 500);
    assert.equal(corrupted.payload.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(corrupted.payload), /broken|snapshot_json/);
  } finally {
    await context.mf.dispose();
  }
});

test("Material detail projects the latest complete rejection from immutable version history", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const created = await api(context, "/api/material-master/drafts", {
      method: "POST", user: "purchase1", body: draftBody(), key: "last-rejection-create",
    });
    const id = created.payload.data.material_id;
    const neverRejectedMaterial = await api(context, `/api/material-master/materials/${id}`, { user: "purchase1" });
    const neverRejectedDraft = await api(context, `/api/material-master/drafts/${id}`, { user: "purchase1" });
    assert.equal(neverRejectedMaterial.payload.data.last_rejection, null);
    assert.equal(neverRejectedDraft.payload.data.last_rejection, null);

    await api(context, `/api/material-master/drafts/${id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 1 }, key: "last-rejection-submit-1",
    });
    const firstReason = "<b>第一次驳回</b> & 原样保留";
    await api(context, `/api/material-master/drafts/${id}/reject`, {
      method: "POST", user: "manager1", body: { expected_version: 2, reason: firstReason }, key: "last-rejection-reject-1",
    });
    const firstMaterial = await api(context, `/api/material-master/materials/${id}`, { user: "purchase1" });
    const firstDraft = await api(context, `/api/material-master/drafts/${id}`, { user: "purchase1" });
    assert.deepEqual(firstMaterial.payload.data.last_rejection, {
      version: 3,
      reason: firstReason,
      reviewed_by: "manager1",
      reviewed_at: fixedNow.toISOString(),
    });
    assert.deepEqual(firstDraft.payload.data.last_rejection, firstMaterial.payload.data.last_rejection);

    for (const path of [
      `/api/material-master/materials/${id}`,
      `/api/material-master/drafts/${id}`,
    ]) {
      const hidden = await api(context, path, { user: "purchase2" });
      assert.equal(hidden.response.status, 404);
      assert.equal(hidden.payload.error.code, "MATERIAL_NOT_FOUND");
      assert.doesNotMatch(JSON.stringify(hidden.payload), /第一次驳回|manager1/);
    }

    await api(context, `/api/material-master/drafts/${id}`, {
      method: "PATCH", user: "purchase1",
      body: editBody(3, { basic_fields: { standard_name: "二次提交物料" } }), key: "last-rejection-edit-2",
    });
    await api(context, `/api/material-master/drafts/${id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: 4 }, key: "last-rejection-submit-2",
    });
    const latestReason = "第二次驳回：补充证明";
    await api(context, `/api/material-master/drafts/${id}/reject`, {
      method: "POST", user: "admin2", body: { expected_version: 5, reason: latestReason }, key: "last-rejection-reject-2",
    });
    const secondMaterial = await api(context, `/api/material-master/materials/${id}`, { user: "purchase1" });
    const secondDraft = await api(context, `/api/material-master/drafts/${id}`, { user: "purchase1" });
    assert.deepEqual(secondMaterial.payload.data.last_rejection, {
      version: 6,
      reason: latestReason,
      reviewed_by: "admin2",
      reviewed_at: fixedNow.toISOString(),
    });
    assert.deepEqual(secondDraft.payload.data.last_rejection, secondMaterial.payload.data.last_rejection);

    let version = 6;
    for (let index = 1; index <= 6; index += 1) {
      const edited = await api(context, `/api/material-master/drafts/${id}`, {
        method: "PATCH", user: "purchase1",
        body: editBody(version, { basic_fields: { standard_name: `驳回后编辑 ${index}` } }),
        key: `last-rejection-post-edit-${index}`,
      });
      assert.equal(edited.response.status, 200);
      version += 1;
    }
    await api(context, `/api/material-master/drafts/${id}/submit`, {
      method: "POST", user: "purchase1", body: { expected_version: version }, key: "last-rejection-final-submit",
    });
    version += 1;
    const approved = await api(context, `/api/material-master/drafts/${id}/approve`, {
      method: "POST", user: "manager1", body: { expected_version: version, review_comment: "通过" }, key: "last-rejection-final-approve",
    });
    assert.equal(approved.payload.data.material_status, "ACTIVE");

    const capturedSql = [];
    const capturingDatabase = {
      prepare(sql) { capturedSql.push(sql.replaceAll(/\s+/g, " ").trim()); return context.DB.prepare(sql); },
      batch(statements) { return context.DB.batch(statements); },
    };
    const capturedContext = { ...context, dependencies: { ...context.dependencies, database: capturingDatabase } };
    const activeDetail = await api(capturedContext, `/api/material-master/materials/${id}`, { user: "warehouse1" });
    assert.equal(activeDetail.response.status, 200);
    assert.deepEqual(activeDetail.payload.data.last_rejection, secondMaterial.payload.data.last_rejection);
    assert.equal(activeDetail.payload.data.history_summary.versions.items.length, 5);
    assert.ok(activeDetail.payload.data.history_summary.versions.items.every((item) => item.event_type !== "REJECT"));
    const projectionSql = capturedSql.find((sql) => sql.includes("event_type = 'REJECT'"));
    assert.ok(projectionSql);
    assert.match(projectionSql, /ORDER BY version_no DESC, reviewed_at DESC, id DESC LIMIT 1$/);
    const projectionPlan = await context.DB.prepare(`EXPLAIN QUERY PLAN
      SELECT version_no, change_reason, reviewed_by, reviewed_at
      FROM material_versions
      WHERE material_id = ? AND event_type = 'REJECT'
      ORDER BY version_no DESC, reviewed_at DESC, id DESC
      LIMIT 1
    `).bind(id).all();
    const projectionPlanDetails = projectionPlan.results.map((row) => String(row.detail)).join(" | ");
    assert.match(projectionPlanDetails, /SEARCH material_versions USING INDEX material_versions_material_version_uq \(material_id=\?\)/);
    assert.doesNotMatch(projectionPlanDetails, /SCAN material_versions/);

    const versions = await api(context, `/api/material-master/materials/${id}/versions?page=1&page_size=2`, { user: "warehouse1" });
    assert.equal(versions.payload.pagination.total, 14);
    assert.deepEqual(versions.payload.data.map((item) => item.version), [14, 13]);
    const incompatibleDraft = await api(context, `/api/material-master/drafts/${id}`, { user: "manager1" });
    assert.equal(incompatibleDraft.response.status, 404);
    assert.equal(incompatibleDraft.payload.error.code, "MATERIAL_NOT_FOUND");

    await context.DB.prepare("UPDATE material_versions SET reviewed_at = NULL WHERE material_id = ? AND event_type = 'REJECT' AND version_no = 6").bind(id).run();
    const corrupted = await api(context, `/api/material-master/materials/${id}`, { user: "warehouse1" });
    assert.equal(corrupted.response.status, 500);
    assert.equal(corrupted.payload.error.code, "INTERNAL_ERROR");
    assert.equal(typeof corrupted.payload.error.request_id, "string");
    assert.doesNotMatch(JSON.stringify(corrupted.payload), /第二次驳回|admin2|material_versions|reviewed_at/);
    const failureAudit = await context.DB.prepare(`
      SELECT error_code, request_id FROM audit_log
      WHERE request_id = ? ORDER BY id DESC LIMIT 1
    `).bind(corrupted.payload.error.request_id).first();
    assert.deepEqual(failureAudit, {
      error_code: "INTERNAL_ERROR",
      request_id: corrupted.payload.error.request_id,
    });
  } finally {
    await context.mf.dispose();
  }
});

test("Material list metadata loading has a bounded query count instead of N+1", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const timestamp = fixedNow.toISOString();
    const inserts = Array.from({ length: 50 }, (_, index) => context.DB.prepare(`
      INSERT INTO material_master(
        standard_name, category_id, base_uom, material_status, procurement_type, inventory_type,
        lot_control_required, inspection_type, environmental_requirement, source_type, source_ref,
        version, last_modified_by, created_by, created_at, updated_by, updated_at, request_id
      ) VALUES (?, 9001, 'PCS', 'DRAFT', 'PURCHASE', 'STOCKED', 0, 'NORMAL', 'ROHS',
                'MANUAL', ?, 1, 'manager1', 'manager1', ?, 'manager1', ?, ?)
    `).bind(`批量物料 ${index}`, `batch:${index}`, timestamp, timestamp, `batch-${index}`));
    await context.DB.batch(inserts);

    let prepares = 0;
    const countedDatabase = {
      prepare(sql) { prepares += 1; return context.DB.prepare(sql); },
      batch(statements) { return context.DB.batch(statements); },
    };
    const countedContext = { ...context, dependencies: { ...context.dependencies, database: countedDatabase } };
    const first = await api(countedContext, "/api/material-master/materials?page=1&page_size=1", { user: "manager1" });
    assert.equal(first.response.status, 200);
    const oneItemPrepareCount = prepares;
    prepares = 0;
    const fifty = await api(countedContext, "/api/material-master/materials?page=1&page_size=50", { user: "manager1" });
    assert.equal(fifty.response.status, 200);
    assert.equal(fifty.payload.data.length, 50);
    assert.equal(prepares, oneItemPrepareCount);
    assert.ok(prepares <= 5, `列表查询 prepare 次数应有界，实际 ${prepares}`);
  } finally {
    await context.mf.dispose();
  }
});
