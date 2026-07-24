import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { MaterialWorkflowError } from "../app/lib/material-selfhost/errors.ts";
import { handleSelfhostMaterialApi } from "../app/lib/material-selfhost/handler.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("isolated TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 16, application_name: "material-workflow-integration-test" });

const actors = {
  creator1: { username: "creator1", must_change_password: false, permissions: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit"] },
  creator2: { username: "creator2", must_change_password: false, permissions: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit"] },
  manager1: { username: "manager1", must_change_password: false, permissions: ["material.read", "material.draft.create", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read"] },
  manager2: { username: "manager2", must_change_password: false, permissions: ["material.read", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read"] },
  reader: { username: "reader1", must_change_password: false, permissions: ["material.read"] },
};

const categoryId = 9004;

async function seed() {
  await pool.query("truncate audit_log,material_api_idempotency,material_change_logs,material_versions,material_attribute_values,material_code_sequences,material_master,material_category_attributes,material_attribute_definitions,material_categories,app_sessions,app_users restart identity cascade");
  for (const [username, role] of [["creator1", "purchase"], ["creator2", "engineering"], ["manager1", "manager"], ["manager2", "manager"], ["reader1", "warehouse"]]) {
    await pool.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$1,$2,'test-only',true,false,1)", [username, role]);
  }
  const requestId = randomUUID();
  await pool.query(`
    insert into material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id)
    values
      (9001,'ELECTRONIC_TEST','电子元件',null,1,'ACTIVE',1,'seed','seed',$1),
      (9002,'PASSIVE_TEST','被动元件',9001,2,'ACTIVE',1,'seed','seed',$1),
      (9003,'RESISTOR_TEST','电阻',9002,3,'ACTIVE',1,'seed','seed',$1),
      (9004,'RES_CHIP','贴片电阻',9003,4,'ACTIVE',1,'seed','seed',$1)
  `, [requestId]);
  await pool.query(`
    insert into material_attribute_definitions(id,attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,normalization_rule,status,created_by,updated_by,request_id)
    values(9010,'RESISTANCE','阻值','DECIMAL',3,'ohm','[]'::jsonb,'DECIMAL_SCALE','ACTIVE','seed','seed',$1)
  `, [requestId]);
  await pool.query(`
    insert into material_category_attributes(id,category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,updated_by,request_id)
    values(9020,9004,9010,true,true,true,10,'ACTIVE','seed','seed',$1)
  `, [requestId]);
}

function draft(name = "10 欧姆贴片电阻", resistance = 10) {
  return {
    category_id: categoryId,
    basic_fields: {
      standard_name: name, unit: "PCS", brand: "", manufacturer: "", manufacturer_part_number: "",
      procurement_type: "PURCHASE", inventory_type: "STOCKED", lot_control_required: false, shelf_life_days: null,
      inspection_type: "NORMAL", environmental_requirement: "ROHS", source_type: "MANUAL",
    },
    attributes: { RESISTANCE: { value: resistance, unit: "ohm", source: "MANUAL", confidence: 1 } },
  };
}

async function api(actor, path, { method = "GET", body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers();
  if (method !== "GET") { headers.set("Content-Type", "application/json"); headers.set("Idempotency-Key", key); }
  const result = await handleSelfhostMaterialApi(new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), {
    pool, actor, requestId: randomUUID(), requireCsrf: () => { if (!csrf) throw new MaterialWorkflowError("CSRF_INVALID", "CSRF Token 无效", 403); },
  });
  assert.ok(result, `route not handled: ${path}`);
  const payload = await result.json();
  return { response: result, payload };
}

test.beforeEach(seed);
test.after(async () => pool.end());

test("migration exposes workflow tables and constraints", async () => {
  const versions = await pool.query("select version from schema_migrations order by version");
  assert.deepEqual(versions.rows.map((row) => row.version), [
    "0001_selfhost_baseline.sql",
    "0002_material_master_workflow.sql",
    "0003_material_import_mapping.sql",
    "0004_material_import_normalization.sql",
    "0005_material_import_review.sql",
  ]);
  await assert.rejects(pool.query("insert into material_code_sequences(category_id,category_code,next_value) values(9004,'bad',1)"), /material_code_sequences_category_code_ck/);
});

test("draft create, edit, submit, separation, approve and histories are atomic", async () => {
  const created = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft(), key: "create-material-0001" });
  assert.equal(created.response.status, 201); const id = created.payload.data.material_id;
  const replay = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft(), key: "create-material-0001" });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true"); assert.equal(replay.payload.data.material_id, id);
  const conflict = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft("不同名称"), key: "create-material-0001" });
  assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const editedBody = { ...draft("12.5 欧姆贴片电阻", 12.5), expected_version: 1 };
  const edited = await api(actors.creator1, `/api/material-master/drafts/${id}`, { method: "PATCH", body: editedBody, key: "edit-material-0001" });
  assert.equal(edited.payload.data.version, 2);
  const stale = await api(actors.creator1, `/api/material-master/drafts/${id}`, { method: "PATCH", body: editedBody, key: "edit-material-stale" });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.code, "VERSION_CONFLICT");
  const submitted = await api(actors.creator1, `/api/material-master/drafts/${id}/submit`, { method: "POST", body: { expected_version: 2, submit_comment: "提交审核" }, key: "submit-material-0001" });
  assert.equal(submitted.payload.data.material_status, "PENDING_REVIEW");
  const selfReview = await api({ ...actors.creator1, permissions: [...actors.creator1.permissions, "material.review.approve"] }, `/api/material-master/drafts/${id}/approve`, { method: "POST", body: { expected_version: 3 }, key: "self-review-0001" });
  assert.equal(selfReview.response.status, 403); assert.equal(selfReview.payload.code, "SELF_REVIEW_FORBIDDEN");
  const denied = await api(actors.reader, `/api/material-master/drafts/${id}/approve`, { method: "POST", body: { expected_version: 3 }, key: "reader-review-0001" });
  assert.equal(denied.response.status, 403);
  const approved = await api(actors.manager1, `/api/material-master/drafts/${id}/approve`, { method: "POST", body: { expected_version: 3, review_comment: "校验通过" }, key: "approve-material-0001" });
  assert.equal(approved.response.status, 200); assert.equal(approved.payload.data.material_status, "ACTIVE"); assert.equal(approved.payload.data.internal_material_code, "CYD-RES_CHIP-000001");

  const detail = await api(actors.reader, `/api/material-master/materials/${id}`);
  assert.equal(detail.payload.data.material.material_code, "CYD-RES_CHIP-000001"); assert.equal(detail.payload.data.attributes[0].value, 12.5);
  assert.equal(detail.payload.data.history_summary.versions.total, 4);
  for (const kind of ["versions", "change-logs"]) {
    const history = await api(actors.reader, `/api/material-master/materials/${id}/${kind}?page=1&page_size=20`);
    assert.ok(history.payload.data.length >= 4);
  }
  const audit = await api(actors.manager1, `/api/material-master/materials/${id}/audit-logs?page=1&page_size=20`);
  assert.equal(audit.payload.data.filter((item) => item.result === "success").length, 4);
  const auditDenied = await api(actors.reader, `/api/material-master/materials/${id}/audit-logs?page=1&page_size=20`);
  assert.equal(auditDenied.response.status, 403);
});

test("reject requires a reason, returns to DRAFT and preserves immutable rejection history", async () => {
  const created = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft(), key: "reject-create-0001" }); const id = created.payload.data.material_id;
  await api(actors.creator1, `/api/material-master/drafts/${id}/submit`, { method: "POST", body: { expected_version: 1 }, key: "reject-submit-0001" });
  const missing = await api(actors.manager1, `/api/material-master/drafts/${id}/reject`, { method: "POST", body: { expected_version: 2 }, key: "reject-missing-0001" });
  assert.equal(missing.response.status, 400); assert.equal(missing.payload.code, "REVIEW_REASON_REQUIRED");
  const rejected = await api(actors.manager1, `/api/material-master/drafts/${id}/reject`, { method: "POST", body: { expected_version: 2, reason: "阻值证明不足" }, key: "reject-valid-0001" });
  assert.equal(rejected.payload.data.material_status, "DRAFT");
  const detail = await api(actors.creator1, `/api/material-master/drafts/${id}`);
  assert.equal(detail.payload.data.last_rejection.reason, "阻值证明不足"); assert.equal(detail.payload.data.last_rejection.version, 3);
});

test("last editor cannot review and another reviewer can", async () => {
  const created = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft(), key: "editor-create-0001" }); const id = created.payload.data.material_id;
  await api(actors.manager1, `/api/material-master/drafts/${id}`, { method: "PATCH", body: { ...draft("经理修订物料", 11), expected_version: 1 }, key: "editor-edit-0001" });
  await api(actors.manager1, `/api/material-master/drafts/${id}/submit`, { method: "POST", body: { expected_version: 2 }, key: "editor-submit-0001" });
  const blocked = await api(actors.manager1, `/api/material-master/drafts/${id}/approve`, { method: "POST", body: { expected_version: 3 }, key: "editor-approve-0001" });
  assert.equal(blocked.payload.code, "LAST_EDITOR_REVIEW_FORBIDDEN");
  const approved = await api(actors.manager2, `/api/material-master/drafts/${id}/approve`, { method: "POST", body: { expected_version: 3 }, key: "other-approve-0001" });
  assert.equal(approved.payload.data.material_status, "ACTIVE");
});

test("concurrent approvals across pool connections allocate unique category codes", async () => {
  const first = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft("并发物料 A", 20), key: "concurrent-create-a" });
  const second = await api(actors.creator2, "/api/material-master/drafts", { method: "POST", body: draft("并发物料 B", 30), key: "concurrent-create-b" });
  await api(actors.creator1, `/api/material-master/drafts/${first.payload.data.material_id}/submit`, { method: "POST", body: { expected_version: 1 }, key: "concurrent-submit-a" });
  await api(actors.creator2, `/api/material-master/drafts/${second.payload.data.material_id}/submit`, { method: "POST", body: { expected_version: 1 }, key: "concurrent-submit-b" });
  const [left, right] = await Promise.all([
    api(actors.manager1, `/api/material-master/drafts/${first.payload.data.material_id}/approve`, { method: "POST", body: { expected_version: 2 }, key: "concurrent-approve-a" }),
    api(actors.manager2, `/api/material-master/drafts/${second.payload.data.material_id}/approve`, { method: "POST", body: { expected_version: 2 }, key: "concurrent-approve-b" }),
  ]);
  assert.equal(left.response.status, 200); assert.equal(right.response.status, 200);
  assert.deepEqual(new Set([left.payload.data.internal_material_code, right.payload.data.internal_material_code]).size, 2);
  const sequence = await pool.query("select next_value from material_code_sequences where category_id=$1", [categoryId]); assert.equal(sequence.rows[0].next_value, 3);
});

test("database failure rolls back draft, attributes, version, audit and idempotency together", async () => {
  await pool.query(`create or replace function fail_material_version_for_test() returns trigger language plpgsql as $$ begin raise exception 'test version failure'; end $$`);
  await pool.query(`create trigger fail_material_version_for_test before insert on material_versions for each row execute function fail_material_version_for_test()`);
  const failed = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft(), key: "rollback-create-0001" });
  assert.equal(failed.response.status, 500);
  await pool.query("drop trigger fail_material_version_for_test on material_versions"); await pool.query("drop function fail_material_version_for_test()");
  for (const table of ["material_master", "material_attribute_values", "material_versions", "material_change_logs", "material_api_idempotency"]) {
    const count = await pool.query(`select count(*)::int count from ${table}`); assert.equal(count.rows[0].count, 0, table);
  }
});

test("CSRF and idempotency headers are enforced before writes", async () => {
  const csrf = await api(actors.creator1, "/api/material-master/drafts", { method: "POST", body: draft(), key: "csrf-create-0001", csrf: false });
  assert.equal(csrf.response.status, 403); assert.equal(csrf.payload.code, "CSRF_INVALID");
  const response = await handleSelfhostMaterialApi(new Request("http://local.test/api/material-master/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft()) }), { pool, actor: actors.creator1, requestId: randomUUID(), requireCsrf: () => undefined });
  assert.equal(response.status, 400); assert.equal((await response.json()).code, "IDEMPOTENCY_KEY_REQUIRED");
});
