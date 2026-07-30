import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { MaterialWorkflowError } from "../app/lib/material-selfhost/errors.ts";
import { handleSelfhostMaterialApi } from "../app/lib/material-selfhost/handler.ts";

const databaseUrl = process.env.TEST_OPERATIONS_MATERIAL_REVIEW_DATABASE_URL;
if (!databaseUrl || !/ops_review_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_OPERATIONS_MATERIAL_REVIEW_DATABASE_URL containing ops_review_test is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "operations-material-review-test" });
const actors = {
  operations1: { username: "operations1", must_change_password: false, permissions: permissionsForRole("operations") },
  operations2: { username: "operations2", must_change_password: false, permissions: permissionsForRole("operations") },
  engineering: { username: "engineering1", must_change_password: false, permissions: permissionsForRole("engineering") },
  unrelated: { username: "warehouse1", must_change_password: false, permissions: permissionsForRole("warehouse") },
};
const categoryId = 9904;

async function resetDatabase() {
  await pool.query(`
    truncate
      audit_log,material_api_idempotency,material_change_logs,material_versions,material_attribute_values,
      material_code_sequences,material_master,material_category_attributes,material_attribute_definitions,
      material_categories,app_sessions,app_users
    restart identity cascade
  `);
  for (const [username, role] of [
    ["operations1", "operations"], ["operations2", "operations"],
    ["engineering1", "engineering"], ["warehouse1", "warehouse"],
  ]) {
    await pool.query(
      "insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$1,$2,'test-only',true,false,1)",
      [username, role],
    );
  }
  const requestId = randomUUID();
  await pool.query(`
    insert into material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id)
    values
      (9901,'OPS_ROOT','测试根',null,1,'ACTIVE',1,'seed','seed',$1),
      (9902,'OPS_L2','测试二级',9901,2,'ACTIVE',1,'seed','seed',$1),
      (9903,'OPS_L3','测试三级',9902,3,'ACTIVE',1,'seed','seed',$1),
      (9904,'OPS_REVIEW','审核测试物料',9903,4,'ACTIVE',1,'seed','seed',$1)
  `, [requestId]);
  await pool.query(`
    insert into material_attribute_definitions(
      id,attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,created_by,updated_by,request_id
    ) values
      (9910,'OPS_VALUE','测试值','DECIMAL',3,'ohm','[]'::jsonb,'DECIMAL_SCALE','ACTIVE','seed','seed',$1),
      (9911,'OPS_PACKAGE','测试封装','TEXT',0,'','[]'::jsonb,'TRIM_UPPER','ACTIVE','seed','seed',$1)
  `, [requestId]);
  await pool.query(`
    insert into material_category_attributes(
      id,category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,
      status,created_by,updated_by,request_id
    ) values
      (9920,9904,9910,true,true,true,10,'ACTIVE','seed','seed',$1),
      (9921,9904,9911,true,true,true,20,'ACTIVE','seed','seed',$1)
  `, [requestId]);
}

function draft(name, value) {
  return {
    category_id: categoryId,
    basic_fields: {
      standard_name: name,
      unit: "PCS",
      brand: "",
      manufacturer: "",
      manufacturer_part_number: "",
      procurement_type: "PURCHASE",
      inventory_type: "STOCKED",
      lot_control_required: false,
      shelf_life_days: null,
      inspection_type: "NORMAL",
      environmental_requirement: "ROHS",
      source_type: "MANUAL",
    },
    attributes: {
      OPS_VALUE: { value, unit: "ohm", source: "MANUAL", confidence: 1 },
      OPS_PACKAGE: { value: "TEST", unit: "", source: "MANUAL", confidence: 1 },
    },
  };
}

async function api(actor, path, { method = "GET", body, key = randomUUID(), csrf = true, requestId = randomUUID() } = {}) {
  const headers = new Headers();
  if (method !== "GET") {
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", key);
  }
  const response = await handleSelfhostMaterialApi(
    new Request(`http://ops-review.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {
      pool,
      actor,
      requestId,
      requireCsrf: () => {
        if (!csrf) throw new MaterialWorkflowError("CSRF_INVALID", "CSRF Token 无效", 403);
      },
    },
  );
  assert.ok(response, `route not handled: ${path}`);
  return { response, payload: await response.json(), requestId };
}

async function createPending(name, value = 10) {
  const created = await api(actors.engineering, "/api/material-master/drafts", {
    method: "POST",
    body: draft(name, value),
    key: `create-${randomUUID()}`,
  });
  assert.equal(created.response.status, 201);
  const materialId = Number(created.payload.data.material_id);
  const submitted = await api(actors.engineering, `/api/material-master/drafts/${materialId}/submit`, {
    method: "POST",
    body: { expected_version: 1, submit_comment: "operations 审核隔离测试" },
    key: `submit-${randomUUID()}`,
  });
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.payload.data.material_status, "PENDING_REVIEW");
  return materialId;
}

test.beforeEach(resetDatabase);
test.after(async () => pool.end());

test("operations sees cross-creator PENDING_REVIEW queue/detail but cannot edit material body", async () => {
  const materialId = await createPending("OPS-QUEUE-CROSS-CREATOR", 11);
  const queue = await api(actors.operations1, "/api/material-master/review-queue?page=1&page_size=20&keyword=OPS-QUEUE-CROSS-CREATOR&sort=submitted_at_desc");
  assert.equal(queue.response.status, 200);
  assert.equal(queue.payload.pagination.total, 1);
  assert.equal(queue.payload.data.length, 1);
  assert.equal(queue.payload.data[0].material_id, materialId);
  assert.equal(queue.payload.data[0].current_version, 2);

  const detail = await api(actors.operations1, `/api/material-master/materials/${materialId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.data.material.material_id, materialId);
  assert.equal(detail.payload.data.material.material_status, "PENDING_REVIEW");
  assert.equal(detail.payload.data.material.current_version, 2);
  assert.equal(detail.payload.data.material.material_code, null);

  const edit = await api(actors.operations1, `/api/material-master/drafts/${materialId}`, {
    method: "PATCH",
    body: { ...draft("OPS-ILLEGAL-EDIT", 12), expected_version: 2 },
    key: "operations-edit-forbidden",
  });
  assert.equal(edit.response.status, 403);
  assert.equal(edit.payload.code, "FORBIDDEN");
  assert.match(edit.payload.message, /权限/);
  assert.equal(edit.payload.request_id, edit.requestId);
  assert.equal(edit.response.headers.get("X-Request-ID"), edit.requestId);

  const engineeringDetail = await api(actors.engineering, `/api/material-master/materials/${materialId}`);
  assert.equal(engineeringDetail.response.status, 200);
  const engineeringReview = await api(actors.engineering, `/api/material-master/drafts/${materialId}/approve`, {
    method: "POST", body: { expected_version: 2 }, key: "engineering-self-review-forbidden",
  });
  assert.equal(engineeringReview.response.status, 403);
  assert.equal(engineeringReview.payload.code, "FORBIDDEN");
  assert.match(engineeringReview.payload.message, /权限/);

  for (const result of [
    await api(actors.unrelated, "/api/material-master/review-queue?page=1&page_size=20&sort=submitted_at_desc"),
    await api(actors.unrelated, `/api/material-master/drafts/${materialId}/reject`, {
      method: "POST", body: { expected_version: 2, reason: "无关角色不得审核" }, key: "unrelated-reject-forbidden",
    }),
  ]) {
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "FORBIDDEN");
    assert.match(result.payload.message, /权限/);
    assert.equal(result.payload.request_id, result.requestId);
  }
});

test("operations approval keeps stable code, idempotency, CAS, single-winner concurrency and complete audit", async () => {
  const materialId = await createPending("OPS-APPROVE-IDEMPOTENT", 21);
  const approveRequestId = randomUUID();
  const approveBody = { expected_version: 2, review_comment: "合成记录审核通过" };
  const approved = await api(actors.operations1, `/api/material-master/drafts/${materialId}/approve`, {
    method: "POST", body: approveBody, key: "ops-approve-stable-key", requestId: approveRequestId,
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.data.material_status, "ACTIVE");
  assert.equal(approved.payload.data.version, 3);
  assert.equal(approved.payload.data.internal_material_code, "CYD-OPS_REVIEW-000001");

  const replay = await api(actors.operations1, `/api/material-master/drafts/${materialId}/approve`, {
    method: "POST", body: approveBody, key: "ops-approve-stable-key",
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(replay.payload.data.internal_material_code, "CYD-OPS_REVIEW-000001");

  const payloadConflict = await api(actors.operations1, `/api/material-master/drafts/${materialId}/approve`, {
    method: "POST",
    body: { ...approveBody, review_comment: "同键异正文" },
    key: "ops-approve-stable-key",
  });
  assert.equal(payloadConflict.response.status, 409);
  assert.equal(payloadConflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const audit = await pool.query(`
    select username,action,result,route_code,material_id,request_id::text,created_at
    from audit_log where action='MATERIAL_DRAFT_APPROVED' and material_id=$1
  `, [materialId]);
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].username, "operations1");
  assert.equal(audit.rows[0].result, "success");
  assert.equal(audit.rows[0].route_code, "MATERIAL_DRAFT_APPROVE");
  assert.equal(Number(audit.rows[0].material_id), materialId);
  assert.equal(audit.rows[0].request_id, approveRequestId);
  assert.ok(Number.isFinite(new Date(audit.rows[0].created_at).getTime()));

  const staleId = await createPending("OPS-STALE-CAS", 22);
  const stale = await api(actors.operations1, `/api/material-master/drafts/${staleId}/approve`, {
    method: "POST", body: { expected_version: 1 }, key: "ops-stale-cas",
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, "VERSION_CONFLICT");
  const staleState = await pool.query("select material_status,version,internal_material_code from material_master where id=$1", [staleId]);
  assert.deepEqual(staleState.rows[0], { material_status: "PENDING_REVIEW", version: 2, internal_material_code: null });

  const concurrentId = await createPending("OPS-CONCURRENT-SINGLE-WINNER", 23);
  const concurrent = await Promise.all([
    api(actors.operations1, `/api/material-master/drafts/${concurrentId}/approve`, {
      method: "POST", body: { expected_version: 2 }, key: "ops-concurrent-left",
    }),
    api(actors.operations2, `/api/material-master/drafts/${concurrentId}/approve`, {
      method: "POST", body: { expected_version: 2 }, key: "ops-concurrent-right",
    }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.response.status).sort(), [200, 409]);
  assert.equal(concurrent.filter((result) => result.response.status === 200).length, 1);
  const concurrentState = await pool.query("select material_status,version,internal_material_code from material_master where id=$1", [concurrentId]);
  assert.equal(concurrentState.rows[0].material_status, "ACTIVE");
  assert.equal(concurrentState.rows[0].version, 3);
  assert.match(concurrentState.rows[0].internal_material_code, /^CYD-OPS_REVIEW-[0-9]{6}$/);
  const concurrentAudits = await pool.query("select count(*)::int count from audit_log where action='MATERIAL_DRAFT_APPROVED' and material_id=$1", [concurrentId]);
  assert.equal(concurrentAudits.rows[0].count, 1);
});

test("operations rejection requires a reason and returns the synthetic record to DRAFT", async () => {
  const materialId = await createPending("OPS-REJECT-REASON", 31);
  const missing = await api(actors.operations1, `/api/material-master/drafts/${materialId}/reject`, {
    method: "POST", body: { expected_version: 2 }, key: "ops-reject-missing-reason",
  });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.payload.code, "REVIEW_REASON_REQUIRED");

  const rejected = await api(actors.operations1, `/api/material-master/drafts/${materialId}/reject`, {
    method: "POST", body: { expected_version: 2, reason: "合成记录需补充证明" }, key: "ops-reject-valid",
  });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.payload.data.material_status, "DRAFT");
  assert.equal(rejected.payload.data.version, 3);
  const detail = await api(actors.engineering, `/api/material-master/drafts/${materialId}`);
  assert.equal(detail.payload.data.last_rejection.reason, "合成记录需补充证明");
});

test("review failure injection leaves no partial approval while recording a safe failed audit", async () => {
  const materialId = await createPending("OPS-APPROVE-ROLLBACK", 41);
  const requestId = randomUUID();
  await pool.query(`
    create or replace function fail_ops_review_version_for_test() returns trigger language plpgsql as $$
    begin
      if new.event_type='APPROVE' then raise exception 'synthetic review version failure'; end if;
      return new;
    end $$
  `);
  await pool.query(`
    create trigger fail_ops_review_version_for_test before insert on material_versions
    for each row execute function fail_ops_review_version_for_test()
  `);
  try {
    const failed = await api(actors.operations1, `/api/material-master/drafts/${materialId}/approve`, {
      method: "POST", body: { expected_version: 2 }, key: "ops-approve-rollback", requestId,
    });
    assert.equal(failed.response.status, 500);
    assert.equal(failed.payload.code, "INTERNAL_ERROR");
  } finally {
    await pool.query("drop trigger if exists fail_ops_review_version_for_test on material_versions");
    await pool.query("drop function if exists fail_ops_review_version_for_test()");
  }

  const state = await pool.query("select material_status,version,internal_material_code,coalesce(approved_by,'') approved_by,approved_at from material_master where id=$1", [materialId]);
  assert.deepEqual(state.rows[0], {
    material_status: "PENDING_REVIEW", version: 2, internal_material_code: null, approved_by: "", approved_at: null,
  });
  const facts = await pool.query(`
    select
      (select count(*)::int from material_versions where material_id=$1 and event_type='APPROVE') versions,
      (select count(*)::int from material_change_logs where material_id=$1 and change_type='APPROVE') changes,
      (select count(*)::int from audit_log where material_id=$1 and action='MATERIAL_DRAFT_APPROVED') success_audits,
      (select count(*)::int from material_api_idempotency where material_id=$1 and route_scope='MATERIAL_DRAFT_APPROVE') idempotency,
      (select count(*)::int from material_code_sequences where category_id=$2) sequences
  `, [materialId, categoryId]);
  assert.deepEqual(facts.rows[0], { versions: 0, changes: 0, success_audits: 0, idempotency: 0, sequences: 0 });
  const failureAudit = await pool.query(`
    select username,result,route_code,material_id,request_id::text,error_code,created_at
    from audit_log where action='MATERIAL_REQUEST_FAILED' and request_id=$1
  `, [requestId]);
  assert.equal(failureAudit.rowCount, 1);
  assert.equal(failureAudit.rows[0].username, "operations1");
  assert.equal(failureAudit.rows[0].result, "failed");
  assert.equal(failureAudit.rows[0].route_code, "MATERIAL_DRAFT_APPROVE");
  assert.equal(Number(failureAudit.rows[0].material_id), materialId);
  assert.equal(failureAudit.rows[0].error_code, "INTERNAL_ERROR");
  assert.ok(Number.isFinite(new Date(failureAudit.rows[0].created_at).getTime()));
});
