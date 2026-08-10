import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

import { AiGovernanceSuggestionError } from "../app/lib/ai-governance-suggestion-selfhost/errors.ts";
import { PostgresAiGovernanceSuggestionRepository } from "../app/lib/ai-governance-suggestion-selfhost/repository.ts";
import { AiGovernanceSuggestionService } from "../app/lib/ai-governance-suggestion-selfhost/service.ts";
import { canonicalDigest } from "../app/lib/ai-governance-suggestion-selfhost/canonical.ts";

const databaseUrl = process.env.TEST_AI_GOVERNANCE_SUGGESTION_DATABASE_URL ?? "";
let databaseName = "";
try {
  databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  databaseName = "";
}
if (!/ai_governance_suggestion_test/i.test(databaseName) || /(?:uat|prod|production|chenyida_erp)$/i.test(databaseName)) {
  throw new Error("an isolated ai_governance_suggestion_test database URL is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "ai-governance-suggestion-service-test" });
const service = new AiGovernanceSuggestionService(new PostgresAiGovernanceSuggestionRepository(pool));
const actor = {
  username: "ai_suggestion_service_tester",
  must_change_password: false,
  permissions: ["material.import.read_any", "material.import.governance.read", "material.import.governance.run"],
};
const sha = (value) => createHash("sha256").update(String(value)).digest("hex");

function body(capability = "CLASSIFICATION") {
  return { capability, expected_group_version: 1 };
}

function context(scope, key, requestBody = body(), requestId = randomUUID()) {
  return {
    actor,
    requestId,
    idempotencyKey: key,
    requestDigest: canonicalDigest(requestBody),
    routeScope: scope,
  };
}

async function migrateFresh() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)");
  const directory = new URL("../drizzle-postgres/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 41).sort();
  assert.equal(names.at(-1), "0041_ai_governance_suggestion_evidence.sql");
  for (const name of names) {
    const sql = await readFile(new URL(name, directory), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, sha(sql)]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

let categoryId;
let materialId;

async function seedMasterData() {
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values($1,'AI 候选服务测试员','manager','test-only',true,false,1)
  `, [actor.username]);
  const category = await pool.query(`
    insert into material_categories(
      category_code,category_name_cn,category_level,status,version,created_by,updated_by,request_id
    ) values('RES','AI 测试电阻',1,'ACTIVE',1,$1,$1,$2) returning id
  `, [actor.username, randomUUID()]);
  categoryId = Number(category.rows[0].id);
  const definition = await pool.query(`
    insert into material_attribute_definitions(
      attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,version,approved_by,approved_at,created_by,updated_by,request_id
    ) values('RESISTANCE','阻值','DECIMAL',0,'OHM','[]'::jsonb,'STRICT','ACTIVE',1,$1,now(),$1,$1,$2)
    returning id
  `, [actor.username, randomUUID()]);
  assert.ok(Number(definition.rows[0].id) > 0);
  const material = await pool.query(`
    insert into material_master(
      internal_material_code,standard_name,category_id,base_uom,material_status,procurement_type,
      inventory_type,inspection_type,environmental_requirement,source_type,version,last_modified_by,
      approved_by,approved_at,created_by,updated_by,request_id
    ) values('CYD-AI-SERVICE-0001','AI 测试电阻',$1,'PCS','ACTIVE','PURCHASE','STOCKED',
      'NORMAL','ROHS','MANUAL',1,$2,$2,now(),$2,$2,$3) returning id
  `, [categoryId, actor.username, randomUUID()]);
  materialId = Number(material.rows[0].id);
}

async function seedSubject(label) {
  const digest = sha(`subject-${label}`);
  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows)
    values($1,'CSV','NORMALIZED',$2,1,1,1,1,0) returning id
  `, [`IMP-AI-${label}-${randomUUID().slice(0, 8)}`, actor.username]);
  const batchId = Number(batch.rows[0].id);
  const file = await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,$2,$3,'synthetic.csv','text/csv',$4,1) returning id
  `, [batchId, randomUUID(), `ai-test/${randomUUID()}.csv`, digest]);
  const parse = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,
      parsed_sheet_count,mapping_preparation_status,source_structure_digest,started_at,completed_at
    ) values($1,'ai-test-parser-v1','SUCCEEDED',1,$2,'COMPLETE',1,1,'READY',$2,now(),now()) returning id
  `, [batchId, digest]);
  const sheet = await pool.query(`
    insert into material_import_parse_sheets(parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings)
    values($1,0,'AI','VISIBLE','COMPLETED',1,1,'[]'::jsonb) returning id
  `, [parse.rows[0].id]);
  const mapping = await pool.query(`
    insert into material_import_mappings(
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
      header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
      mapping_digest,mapping_snapshot,status,created_by,updated_by,confirmed_by,request_id,confirmed_at
    ) values($1,$2,$3,1,'CSV',0,'AI','NO_HEADER',null,$4,'[]'::jsonb,$4,'ai-test-catalog-v1',$4,
      '{}'::jsonb,'CONFIRMED',$5,$5,$5,$6,now()) returning id
  `, [randomUUID(), batchId, parse.rows[0].id, digest, actor.username, randomUUID()]);
  const normalization = await pool.query(`
    insert into material_import_normalization_runs(
      batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,
      source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,
      run_version,run_status,expected_version,current_stage,total_rows,processed_rows,valid_rows,warning_rows,
      error_rows,skipped_rows,issue_count,warning_count,error_count,normalized_json_bytes,result_digest,
      requested_by,started_at,completed_at,published_at
    ) values($1,$2,$3,$4,$5,1,$6,$6,'ai-test-processor-v1','ai-test-normalizer-v1',$6,'{}'::jsonb,
      1,'PUBLISHING',1,'PUBLISH_RESULT',1,1,1,0,0,0,0,0,0,1,null,$7,now(),null,null) returning id
  `, [batchId, parse.rows[0].id, mapping.rows[0].id, file.rows[0].id, sheet.rows[0].id, digest, actor.username]);
  const sourceRow = await pool.query(`
    insert into material_import_rows(batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
    values($1,$2,$3,0,'AI',1,'{}'::jsonb,$4) returning id
  `, [batchId, parse.rows[0].id, randomUUID(), digest]);
  const normalizedRow = await pool.query(`
    insert into material_import_normalized_rows(
      batch_id,normalization_run_id,source_row_id,source_sheet_id,source_sheet_index,source_sheet_name,
      source_row_number,source_raw_row_hash,normalized_payload,normalized_payload_hash,row_status,review_status,
      core_candidate_count,attribute_candidate_count,issue_count,error_count,warning_count,result_summary
    ) values($1,$2,$3,$4,0,'AI',1,$5,'{}'::jsonb,$5,'VALID','APPROVED',1,1,0,0,0,'{}'::jsonb) returning id
  `, [batchId, normalization.rows[0].id, sourceRow.rows[0].id, sheet.rows[0].id, digest]);
  await pool.query(`
    insert into material_import_normalization_lineage(
      normalization_run_id,normalized_row_id,target_namespace,target_field_code,target_attribute_code,
      source_sheet_id,source_sheet_name,source_row_number,source_column_index,source_column_name,
      source_field_key,mapping_id,mapping_digest,transformation_rule_code,
      transformation_rule_version,transformation_steps,lineage_ordinal
    ) values($1,$2,'attribute','RESISTANCE','RESISTANCE',$3,'AI',1,0,'synthetic','synthetic.resistance',
      $4,$5,'STRICT_DECIMAL','ai-test-normalizer-v1','[]'::jsonb,0)
  `, [normalization.rows[0].id, normalizedRow.rows[0].id, sheet.rows[0].id, mapping.rows[0].id, digest]);
  await pool.query(`
    update material_import_normalization_runs set
      run_status='SUCCEEDED',current_stage='COMPLETE',expected_version=expected_version+1,
      result_digest=$2,completed_at=now(),published_at=now(),updated_at=now()
    where id=$1 and run_status='PUBLISHING' and published_at is null
  `, [normalization.rows[0].id, digest]);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.material_governance_service_write','allowed',true)");
    const governanceRun = await client.query(`
      insert into material_governance_runs(
        batch_id,normalization_run_id,normalization_result_digest,rule_version,config_digest,rule_snapshot,
        result_digest,source_count,group_count,ready_group_count,exception_row_count,alternative_candidate_count,
        operation_id,requested_by,request_id
      ) values($1,$2,$3,'bom-material-governance-v1',$3,'{}'::jsonb,$3,1,1,1,0,0,$4,$5,$6) returning id
    `, [batchId, normalization.rows[0].id, digest, randomUUID(), actor.username, randomUUID()]);
    const groupKey = sha(`group-${label}-${randomUUID()}`);
    const group = await client.query(`
      insert into material_governance_groups(
        governance_run_id,group_key,category,readiness,canonical_key,canonical_specification,standard_name,
        identity_digest,compatibility_digest,source_count,merge_evidence,decision_status,version,created_by,updated_by
      ) values($1,$2,'RES','READY',$3,'RES:10000OHM','AI 测试治理组',$2,$4,1,'[]'::jsonb,'PENDING',1,$5,$5)
      returning id
    `, [governanceRun.rows[0].id, groupKey, `RES:${groupKey}`, sha(`compat-${label}`), actor.username]);
    const governanceGroupId = Number(group.rows[0].id);
    const governanceRow = await client.query(`
      insert into material_governance_rows(
        governance_run_id,group_id,normalized_row_id,source_row_id,source_key,original_part_number,
        manufacturer_part_number,supplier_part_number,source_model,original_material_name,original_specification,
        original_description,original_brand,original_manufacturer,original_supplier,source_quantity_raw,
        source_quantity,source_unit,source_bom,source_snapshot_digest,parse_evidence,issues,issue_count,error_count,warning_count
      ) values($1,$2,$3,$4,$5,'SYN-RES-10K',null,null,null,'AI 测试电阻','10K OHM',null,null,null,null,
        '1',1,'PCS',null,$6,'[]'::jsonb,'[]'::jsonb,0,0,0) returning id
    `, [governanceRun.rows[0].id, governanceGroupId, normalizedRow.rows[0].id, sourceRow.rows[0].id, `SYN-${label}`, digest]);
    await client.query(`
      insert into material_governance_specs(
        governance_row_id,component_code,component_role,normalized_value,display_value,canonical_unit,evidence
      ) values($1,'RESISTANCE','IDENTITY','10000','10K','OHM','[]'::jsonb)
    `, [governanceRow.rows[0].id]);
    await client.query(`
      insert into material_governance_material_candidates(
        group_id,material_id,candidate_kind,candidate_rank,material_version_snapshot,material_status_snapshot,
        candidate_snapshot,evidence,candidate_digest
      ) values($1,$2,'EXACT_IDENTITY',1,1,'ACTIVE',$3::jsonb,'[]'::jsonb,$4)
    `, [governanceGroupId, materialId, JSON.stringify({ material_id: materialId, internal_material_code: "CYD-AI-SERVICE-0001", material_status: "ACTIVE", version: 1 }), sha(`candidate-${label}`)]);
    await client.query("commit");
    return { batchId, governanceRunId: Number(governanceRun.rows[0].id), governanceGroupId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createSuggestion(subject, key, requestBody = body(), requestId = randomUUID()) {
  const scope = `AI_GOVERNANCE_SUGGESTIONS:${subject.batchId}:${subject.governanceRunId}:${subject.governanceGroupId}`;
  return service.create(subject.batchId, subject.governanceRunId, subject.governanceGroupId, context(scope, key, requestBody, requestId), requestBody);
}

async function counts(tables) {
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, Number((await pool.query(`select count(*) count from ${table}`)).rows[0].count)])));
}

const formalTables = [
  "material_master",
  "supplier_mappings",
  "material_governance_runs",
  "material_governance_groups",
  "material_governance_rows",
  "material_governance_specs",
  "material_governance_material_candidates",
  "material_governance_decisions",
  "material_governance_material_links",
  "material_governance_events",
];

test.before(async () => {
  await migrateFresh();
  await seedMasterData();
});

test.after(async () => pool.end());

test("atomic create writes one complete suggestion, audit, and persistent idempotency with zero formal writes", async () => {
  const subject = await seedSubject("atomic");
  const before = await counts(formalTables);
  const result = await createSuggestion(subject, "atomic-key-0001");
  assert.equal(result.statusCode, 201);
  assert.equal(result.replayed, false);
  assert.equal(result.data.disposition, "SUGGEST");
  assert.equal(result.data.items.length, 1);
  assert.ok(result.data.items[0].evidence.length >= 1);
  assert.equal(result.data.formal_action_performed, false);
  assert.deepEqual(await counts(formalTables), before);
  const persisted = await counts(["ai_governance_suggestion_runs", "ai_governance_suggestions", "ai_governance_suggestion_items", "ai_governance_suggestion_evidence", "ai_governance_suggestion_events"]);
  assert.deepEqual(persisted, {
    ai_governance_suggestion_runs: 1,
    ai_governance_suggestions: 1,
    ai_governance_suggestion_items: 1,
    ai_governance_suggestion_evidence: 2,
    ai_governance_suggestion_events: 1,
  });
  assert.equal(Number((await pool.query("select count(*) count from audit_log where route_code='AI_GOVERNANCE_SUGGESTION' and result='success'")).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*) count from material_api_idempotency where route_scope like 'AI_GOVERNANCE_SUGGESTIONS:%'")).rows[0].count), 1);
});

test("idempotency and run digest replay return the original complete result; key conflicts are stable", async () => {
  const subject = await seedSubject("replay");
  const first = await createSuggestion(subject, "replay-key-0001");
  const sameKey = await createSuggestion(subject, "replay-key-0001");
  const sameRun = await createSuggestion(subject, "replay-key-0002");
  assert.equal(sameKey.replaySource, "IDEMPOTENCY_KEY");
  assert.equal(sameRun.replaySource, "RUN_DIGEST");
  assert.deepEqual(sameKey.data, first.data);
  assert.deepEqual(sameRun.data, first.data);
  assert.equal(Number((await pool.query("select count(*) count from ai_governance_suggestion_runs where governance_group_id=$1", [subject.governanceGroupId])).rows[0].count), 1);
  const conflictingBody = { capability: "CLASSIFICATION", expected_group_version: 1 };
  const scope = `AI_GOVERNANCE_SUGGESTIONS:${subject.batchId}:${subject.governanceRunId}:${subject.governanceGroupId}`;
  await assert.rejects(
    service.create(subject.batchId, subject.governanceRunId, subject.governanceGroupId, { ...context(scope, "replay-key-0001", conflictingBody), requestDigest: sha("different-body") }, conflictingBody),
    (error) => error instanceof AiGovernanceSuggestionError && error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409,
  );
});

test("concurrent generation creates one run, then input change creates one contiguous superseding version", async () => {
  const subject = await seedSubject("concurrent");
  const [left, right] = await Promise.all([
    createSuggestion(subject, "concurrent-key-0001"),
    createSuggestion(subject, "concurrent-key-0002"),
  ]);
  assert.equal(new Set([left.data.run_uid, right.data.run_uid]).size, 1);
  assert.equal(Number((await pool.query("select count(*) count from ai_governance_suggestion_runs where governance_group_id=$1", [subject.governanceGroupId])).rows[0].count), 1);

  await pool.query("update material_categories set version=version+1,updated_at=now() where id=$1", [categoryId]);
  const [nextLeft, nextRight] = await Promise.all([
    createSuggestion(subject, "concurrent-key-0003"),
    createSuggestion(subject, "concurrent-key-0004"),
  ]);
  assert.equal(nextLeft.data.suggestion_version_no, 2);
  assert.equal(nextRight.data.suggestion_version_no, 2);
  assert.equal(new Set([nextLeft.data.suggestion_uid, nextRight.data.suggestion_uid]).size, 1);
  const versions = await pool.query(`
    select suggestion.id,suggestion.suggestion_version_no,suggestion.supersedes_suggestion_id,
           count(event.id) filter(where event.event_type='SUPERSEDED')::integer terminal_count,
           max(event.expected_previous_event_digest) filter(where event.event_type='SUPERSEDED') previous_digest,
           max(created.event_digest) created_digest
    from ai_governance_suggestions suggestion
    left join ai_governance_suggestion_events event on event.suggestion_id=suggestion.id
    left join ai_governance_suggestion_events created on created.suggestion_id=suggestion.id and created.event_type='CREATED'
    where suggestion.governance_group_id=$1 and suggestion.capability='CLASSIFICATION'
    group by suggestion.id order by suggestion.suggestion_version_no
  `, [subject.governanceGroupId]);
  assert.equal(versions.rows.length, 2);
  assert.equal(Number(versions.rows[1].supersedes_suggestion_id), Number(versions.rows[0].id));
  assert.equal(versions.rows[0].terminal_count, 1);
  assert.equal(versions.rows[0].previous_digest, versions.rows[0].created_digest);
  assert.equal(versions.rows[1].terminal_count, 0);
});

test("server-side expiry, group drift, and reference drift fail closed without GET writes", async () => {
  const expirySubject = await seedSubject("expiry");
  const expiryCreated = await createSuggestion(expirySubject, "expiry-key-0001");
  await pool.query("alter table ai_governance_suggestion_runs disable trigger ai_governance_suggestion_runs_guard");
  try {
    await pool.query("update ai_governance_suggestion_runs set expires_at=created_at+interval '1 microsecond' where run_uid=$1", [expiryCreated.data.run_uid]);
  } finally {
    await pool.query("alter table ai_governance_suggestion_runs enable always trigger ai_governance_suggestion_runs_guard");
  }
  const auditBefore = Number((await pool.query("select count(*) count from audit_log")).rows[0].count);
  await assert.rejects(
    service.one(expirySubject.batchId, expirySubject.governanceRunId, expirySubject.governanceGroupId, expiryCreated.data.suggestion_uid, actor),
    (error) => error instanceof AiGovernanceSuggestionError && error.code === "AI_SUGGESTION_EXPIRED",
  );
  assert.equal(Number((await pool.query("select count(*) count from audit_log")).rows[0].count), auditBefore);

  const groupSubject = await seedSubject("group-drift");
  const groupCreated = await createSuggestion(groupSubject, "group-key-0001");
  const groupClient = await pool.connect();
  try {
    await groupClient.query("begin");
    await groupClient.query("select set_config('cyd.material_governance_service_write','allowed',true)");
    await groupClient.query("update material_governance_groups set decision_status='EXCLUDED',version=2,updated_by=$1,updated_at=now() where id=$2", [actor.username, groupSubject.governanceGroupId]);
    await groupClient.query("commit");
  } catch (error) {
    await groupClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    groupClient.release();
  }
  await assert.rejects(
    service.one(groupSubject.batchId, groupSubject.governanceRunId, groupSubject.governanceGroupId, groupCreated.data.suggestion_uid, actor),
    (error) => error instanceof AiGovernanceSuggestionError && error.code === "AI_SUGGESTION_GROUP_DRIFT",
  );

  const referenceSubject = await seedSubject("reference-drift");
  const referenceCreated = await createSuggestion(referenceSubject, "reference-key-0001");
  await pool.query("update material_categories set status='INACTIVE',version=version+1,updated_at=now() where id=$1", [categoryId]);
  try {
    await assert.rejects(
      service.one(referenceSubject.batchId, referenceSubject.governanceRunId, referenceSubject.governanceGroupId, referenceCreated.data.suggestion_uid, actor),
      (error) => error instanceof AiGovernanceSuggestionError && ["AI_SUGGESTION_INPUT_DRIFT", "AI_SUGGESTION_RESULT_DRIFT"].includes(error.code),
    );
  } finally {
    await pool.query("update material_categories set status='ACTIVE',version=version+1,updated_at=now() where id=$1", [categoryId]);
  }
});

test("a failing transaction leaves no partial AI facts, success audit, idempotency, or formal writes", async () => {
  const subject = await seedSubject("rollback");
  const beforeAi = await counts(["ai_governance_suggestion_runs", "ai_governance_suggestions", "ai_governance_suggestion_items", "ai_governance_suggestion_evidence", "ai_governance_suggestion_events"]);
  const beforeFormal = await counts(formalTables);
  const beforeAudit = Number((await pool.query("select count(*) count from audit_log where route_code='AI_GOVERNANCE_SUGGESTION'")).rows[0].count);
  const beforeIdempotency = Number((await pool.query("select count(*) count from material_api_idempotency where route_scope like 'AI_GOVERNANCE_SUGGESTIONS:%'")).rows[0].count);
  await pool.query(`
    create function ai_suggestion_test_fail_audit() returns trigger language plpgsql as $$
    begin
      if NEW.route_code='AI_GOVERNANCE_SUGGESTION' then
        raise exception 'isolated AI suggestion audit failure';
      end if;
      return NEW;
    end $$;
    create trigger ai_suggestion_test_fail_audit before insert on audit_log
    for each row execute function ai_suggestion_test_fail_audit()
  `);
  try {
    await assert.rejects(createSuggestion(subject, "rollback-key-0001"), /isolated AI suggestion audit failure/);
  } finally {
    await pool.query("drop trigger ai_suggestion_test_fail_audit on audit_log; drop function ai_suggestion_test_fail_audit()");
  }
  assert.deepEqual(await counts(["ai_governance_suggestion_runs", "ai_governance_suggestions", "ai_governance_suggestion_items", "ai_governance_suggestion_evidence", "ai_governance_suggestion_events"]), beforeAi);
  assert.deepEqual(await counts(formalTables), beforeFormal);
  assert.equal(Number((await pool.query("select count(*) count from audit_log where route_code='AI_GOVERNANCE_SUGGESTION'")).rows[0].count), beforeAudit);
  assert.equal(Number((await pool.query("select count(*) count from material_api_idempotency where route_scope like 'AI_GOVERNANCE_SUGGESTIONS:%'")).rows[0].count), beforeIdempotency);
});
