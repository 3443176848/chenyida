import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_AI_GOVERNANCE_SUGGESTION_MIGRATION_DATABASE_URL ?? "";
let databaseName = "";
try {
  databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  databaseName = "";
}
if (!/ai_governance_suggestion_migration_test/i.test(databaseName) || /(?:uat|prod|production|chenyida_erp)$/i.test(databaseName)) {
  throw new Error("an isolated ai_governance_suggestion_migration_test database URL is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "ai-governance-suggestion-migration-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 41).sort();
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, directory), "utf8")])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
const sha = (value) => createHash("sha256").update(String(value)).digest("hex");

async function reset() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)");
}

async function migrate(selected) {
  for (const name of selected) {
    const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (existing.rows[0]) {
      assert.equal(existing.rows[0].checksum, checksum(name));
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sources.get(name));
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function seedSubject() {
  const actor = "ai_suggestion_tester";
  const digest = sha("migration-fixture");
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values($1,'AI 候选测试员','manager','test-only',true,false,1)
  `, [actor]);
  const category = await pool.query(`
    insert into material_categories(category_code,category_name_cn,category_level,status,version,created_by,updated_by,request_id)
    values('AI_TEST_CATEGORY','AI 测试品类',1,'ACTIVE',1,$1,$1,$2) returning id
  `, [actor, randomUUID()]);
  const unit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('AI_PCS','测试件','件','COUNT',true) returning id");
  const definition = await pool.query(`
    insert into material_attribute_definitions(attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,normalization_rule,status,version,approved_by,approved_at,created_by,updated_by,request_id)
    values('AI_TEST_TEXT','AI 测试文本','TEXT',0,'','[]'::jsonb,'STRICT','ACTIVE',1,$1,now(),$1,$1,$2) returning id
  `, [actor, randomUUID()]);
  const supplier = await pool.query(`
    insert into suppliers(supplier_code,supplier_name,normalized_name,status,version,created_by,updated_by,request_id)
    values('SUP-AI-TEST','AI 测试供应商','AI 测试供应商','ACTIVE',1,$1,$1,$2) returning id
  `, [actor, randomUUID()]);
  const material = await pool.query(`
    insert into material_master(internal_material_code,standard_name,category_id,base_uom,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,version,last_modified_by,approved_by,approved_at,created_by,updated_by,request_id)
    values('CYD-AI-TEST-0001','AI 测试物料',$1,'AI_PCS','ACTIVE','PURCHASE','STOCKED','NORMAL','ROHS','MANUAL',1,$2,$2,now(),$2,$2,$3) returning id
  `, [category.rows[0].id, actor, randomUUID()]);
  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows)
    values('IMP-AI-SUGGESTION-TEST','CSV','NORMALIZED',$1,1,1,0,0,0) returning id
  `, [actor]);
  const file = await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,$2,$3,'ai-test.csv','text/csv',$4,1) returning id
  `, [batch.rows[0].id, randomUUID(), `ai-test/${randomUUID()}.csv`, digest]);
  const parse = await pool.query(`
    insert into material_import_parse_runs(batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,parsed_sheet_count,mapping_preparation_status,source_structure_digest,started_at,completed_at)
    values($1,'ai-test-parser-v1','SUCCEEDED',1,$2,'COMPLETE',0,1,'READY',$2,now(),now()) returning id
  `, [batch.rows[0].id, digest]);
  const sheet = await pool.query(`
    insert into material_import_parse_sheets(parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings)
    values($1,0,'AI','VISIBLE','COMPLETED',0,0,'[]'::jsonb) returning id
  `, [parse.rows[0].id]);
  const mapping = await pool.query(`
    insert into material_import_mappings(mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,mapping_digest,mapping_snapshot,status,created_by,updated_by,confirmed_by,request_id,confirmed_at)
    values($1,$2,$3,1,'CSV',0,'AI','NO_HEADER',null,$4,'[]'::jsonb,$4,'ai-test-catalog-v1',$4,'{}'::jsonb,'CONFIRMED',$5,$5,$5,$6,now()) returning id
  `, [randomUUID(), batch.rows[0].id, parse.rows[0].id, digest, actor, randomUUID()]);
  const normalization = await pool.query(`
    insert into material_import_normalization_runs(batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,run_version,run_status,expected_version,current_stage,total_rows,processed_rows,valid_rows,warning_rows,error_rows,skipped_rows,issue_count,warning_count,error_count,normalized_json_bytes,result_digest,requested_by,started_at,completed_at,published_at)
    values($1,$2,$3,$4,$5,1,$6,$6,'ai-test-processor-v1','ai-test-normalizer-v1',$6,'{}'::jsonb,1,'SUCCEEDED',1,'COMPLETE',0,0,0,0,0,0,0,0,0,0,$6,$7,now(),now(),now()) returning id
  `, [batch.rows[0].id, parse.rows[0].id, mapping.rows[0].id, file.rows[0].id, sheet.rows[0].id, digest, actor]);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.material_governance_service_write','allowed',true)");
    const governanceRun = await client.query(`
      insert into material_governance_runs(batch_id,normalization_run_id,normalization_result_digest,rule_version,config_digest,rule_snapshot,result_digest,source_count,group_count,ready_group_count,exception_row_count,alternative_candidate_count,operation_id,requested_by,request_id)
      values($1,$2,$3,'bom-material-governance-v1',$3,'{}'::jsonb,$3,1,1,0,0,0,$4,$5,$6) returning id
    `, [batch.rows[0].id, normalization.rows[0].id, digest, randomUUID(), actor, randomUUID()]);
    const group = await client.query(`
      insert into material_governance_groups(governance_run_id,group_key,category,readiness,canonical_key,canonical_specification,standard_name,identity_digest,compatibility_digest,source_count,merge_evidence,decision_status,version,created_by,updated_by)
      values($1,$2,'OTHER','REVIEW_REQUIRED',null,null,'AI 测试治理组',null,null,1,'[]'::jsonb,'PENDING',1,$3,$3) returning id
    `, [governanceRun.rows[0].id, sha("group-one"), actor]);
    await client.query("commit");
    return {
      actor,
      batchId: Number(batch.rows[0].id),
      governanceRunId: Number(governanceRun.rows[0].id),
      groupId: Number(group.rows[0].id),
      categoryId: Number(category.rows[0].id),
      definitionId: Number(definition.rows[0].id),
      materialId: Number(material.rows[0].id),
      supplierId: Number(supplier.rows[0].id),
      unitId: Number(unit.rows[0].id),
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function itemColumns(kind, refs) {
  const common = { item_kind: kind, item_ordinal: 1, candidate_rank: 1, score: null };
  if (kind === "CLASSIFICATION") return { ...common, category_id: refs.categoryId, category_version_snapshot: 1, category_status_snapshot: "ACTIVE", category_digest: sha("category") };
  if (kind === "ATTRIBUTE_EXTRACTION") return { ...common, attribute_definition_id: refs.definitionId, attribute_definition_version_snapshot: 1, attribute_status_snapshot: "ACTIVE", attribute_value_type: "TEXT", value_text: "SAFE_VALUE", attribute_value_digest: sha("attribute-value") };
  if (kind === "MATERIAL_MATCH") return { ...common, material_id: refs.materialId, material_version_snapshot: 1, material_status_snapshot: "ACTIVE", material_digest: sha("material") };
  return { ...common, material_id: refs.materialId, material_version_snapshot: 1, material_status_snapshot: "ACTIVE", material_digest: sha("material"), supplier_id: refs.supplierId, supplier_version_snapshot: 1, supplier_status_snapshot: "ACTIVE", supplier_digest: sha("supplier"), supplier_part_key_digest: sha("SUPPLIER-PART"), purchase_unit_id: refs.unitId, conversion_numerator: "1", conversion_denominator: "1" };
}

async function createComplete(refs, capability, options = {}) {
  const client = await pool.connect();
  const suffix = `${capability}-${randomUUID()}`;
  const requestId = randomUUID();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.ai_governance_suggestion_service_write','allowed',true)");
    const createdAt = (await client.query("select clock_timestamp() created_at")).rows[0].created_at;
    const run = await client.query(`
      insert into ai_governance_suggestion_runs(run_uid,governance_run_id,governance_group_id,group_version,group_input_digest,capability,execution_mode,schema_version,schema_digest,evaluator_version,rule_version,config_version,config_digest,provider_id,model_id,model_version,prompt_version,prompt_digest,parameter_digest,confidence_semantics_version,input_version,input_digest,contract_digest,run_digest,result_digest,idempotency_key_digest,operation_id,request_id,requested_by,created_at,expires_at)
      values($1,$2,$3,1,$4,$5,'LOCAL_DETERMINISTIC','ai-governance-suggestion-schema-v1',$6,'ai-governance-evaluator-v1','bom-material-governance-v1','deterministic-ai-suggestion-v1',$7,'LOCAL_DETERMINISTIC','NONE','NONE','NONE',null,$8,null,'ai-governance-input-v1',$9,$10,$11,$12,$13,$14,$15,$16,$17::timestamptz,$17::timestamptz+interval '7 days') returning id
    `, [randomUUID(), refs.governanceRunId, refs.groupId, sha("group-input"), capability, sha("schema"), sha("config"), sha("parameters"), sha(`input-${suffix}`), sha("contract"), sha(`run-${suffix}`), sha(`result-${suffix}`), sha(`idem-${suffix}`), randomUUID(), requestId, refs.actor, createdAt]);
    const disposition = options.disposition ?? "SUGGEST";
    const suggestion = await client.query(`
      insert into ai_governance_suggestions(suggestion_uid,suggestion_run_id,governance_group_id,capability,suggestion_version_no,supersedes_suggestion_id,disposition,abstain_reason_code,overall_confidence,payload_digest,suggestion_digest,created_by,request_id,created_at)
      values($1,$2,$3,$4,1,null,$5,$6,null,$7,$8,$9,$10,$11) returning id
    `, [randomUUID(), run.rows[0].id, refs.groupId, capability, disposition, disposition === "ABSTAIN" ? "EVIDENCE_INSUFFICIENT" : null, sha(`payload-${suffix}`), sha(`suggestion-${suffix}`), refs.actor, requestId, createdAt]);
    let itemId = null;
    if (options.withItem !== false && (disposition === "SUGGEST" || options.forceItem)) {
      const item = { ...itemColumns(capability, refs), ...(options.itemOverride ?? {}) };
      const columns = Object.keys(item);
      const values = Object.values(item);
      const inserted = await client.query(`
        insert into ai_governance_suggestion_items(item_uid,suggestion_id,${columns.join(",")},item_digest,created_by,request_id,created_at)
        values($1,$2,${values.map((_, index) => `$${index + 3}`).join(",")},$${values.length + 3},$${values.length + 4},$${values.length + 5},$${values.length + 6}) returning id
      `, [randomUUID(), suggestion.rows[0].id, ...values, sha(`item-${suffix}`), refs.actor, requestId, createdAt]);
      itemId = Number(inserted.rows[0].id);
      if (options.withEvidence !== false) {
        if (options.governanceMaterialCandidateId) {
          await client.query(`
            insert into ai_governance_suggestion_evidence(evidence_uid,suggestion_item_id,evidence_ordinal,evidence_kind,governance_material_candidate_id,safe_field_path,source_digest,locator_digest,evidence_digest,created_by,request_id,created_at)
            values($1,$2,1,'DETERMINISTIC_MATERIAL_CANDIDATE',$3,'candidate.material',$4,$5,$6,$7,$8,$9)
          `, [randomUUID(), itemId, options.governanceMaterialCandidateId, sha("source"), sha("locator"), sha(`evidence-${suffix}`), refs.actor, requestId, createdAt]);
        } else {
          await client.query(`
            insert into ai_governance_suggestion_evidence(evidence_uid,suggestion_item_id,evidence_ordinal,evidence_kind,safe_field_path,source_digest,locator_digest,evidence_digest,rule_trace_code,rule_trace_version,created_by,request_id,created_at)
            values($1,$2,1,'RULE_TRACE',$3,$4,$5,$6,'LOCAL_DETERMINISTIC_RULE','bom-material-governance-v1',$7,$8,$9)
          `, [randomUUID(), itemId, `rule.${capability}`, sha("source"), sha("locator"), sha(`evidence-${suffix}`), refs.actor, requestId, createdAt]);
        }
      }
    }
    await client.query(`
      insert into ai_governance_suggestion_events(event_uid,suggestion_id,event_sequence,event_type,reason_code,superseding_suggestion_id,expected_suggestion_row_version,expected_previous_event_digest,event_digest,operation_id,request_id,actor,created_at)
      select $1,id,1,'CREATED','SUGGESTION_CREATED',null,1,null,$2,$3,request_id,created_by,$4
      from ai_governance_suggestions where id=$5
    `, [randomUUID(), sha(`event-${suffix}`), randomUUID(), createdAt, suggestion.rows[0].id]);
    await client.query("commit");
    return { runId: Number(run.rows[0].id), suggestionId: Number(suggestion.rows[0].id), itemId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rejectInvalidRun(refs, overrides, expected) {
  const client = await pool.connect();
  const createdAt = new Date();
  const expiresAt = overrides.expiresAt ?? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.ai_governance_suggestion_service_write','allowed',true)");
    await assert.rejects(client.query(`
      insert into ai_governance_suggestion_runs(run_uid,governance_run_id,governance_group_id,group_version,group_input_digest,capability,execution_mode,schema_version,schema_digest,evaluator_version,rule_version,config_version,config_digest,provider_id,model_id,model_version,prompt_version,prompt_digest,parameter_digest,confidence_semantics_version,input_version,input_digest,contract_digest,run_digest,result_digest,idempotency_key_digest,operation_id,request_id,requested_by,created_at,expires_at)
      values($1,$2,$3,$4,$5,'CLASSIFICATION','LOCAL_DETERMINISTIC','ai-governance-suggestion-schema-v1',$6,'ai-governance-evaluator-v1','bom-material-governance-v1','deterministic-ai-suggestion-v1',$6,'LOCAL_DETERMINISTIC','NONE','NONE','NONE',null,$6,null,'ai-governance-input-v1',$6,$6,$7,$6,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz)
    `, [randomUUID(), refs.governanceRunId, refs.groupId, overrides.groupVersion ?? 1, overrides.groupInputDigest ?? sha("invalid-run"), sha("contract-part"), sha(`invalid-run-${randomUUID()}`), sha("idem"), randomUUID(), randomUUID(), refs.actor, createdAt, expiresAt]), expected);
    await client.query("rollback");
  } finally {
    client.release();
  }
}

test.after(async () => pool.end());

test("empty database and repeated runner reach exactly migration 0041", async () => {
  assert.equal(names.length, 41);
  assert.equal(names.at(-1), "0041_ai_governance_suggestion_evidence.sql");
  await reset();
  await migrate(names);
  await migrate(names);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations")).rows[0].count, 41);
  assert.equal((await pool.query("select count(*)::integer count from information_schema.tables where table_schema='public' and table_name like 'ai_governance_%'")).rows[0].count, 5);
});

test("0040 data upgrades expand-only and 0041 failure rolls back", async () => {
  await reset();
  await migrate(names.slice(0, 40));
  await pool.query("insert into app_meta(key,value) values('ai-0041-legacy-sentinel','preserve')");
  const before = (await pool.query("select count(*)::integer count from app_meta")).rows[0].count;
  await migrate(names.slice(40));
  assert.equal((await pool.query("select count(*)::integer count from app_meta")).rows[0].count, before);
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_runs")).rows[0].count, 0);

  await reset();
  await migrate(names.slice(0, 40));
  await pool.query("create table ai_governance_suggestion_runs(dummy integer)");
  await assert.rejects(migrate(names.slice(40)), /ai_governance_suggestion_runs.*already exists/i);
  assert.equal((await pool.query("select to_regclass('public.ai_governance_suggestions') value")).rows[0].value, null);
  assert.equal((await pool.query("select to_regprocedure('cyd_ai_governance_suggestion_write_guard()') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version='0041_ai_governance_suggestion_evidence.sql'")).rows[0].count, 0);
});

test("database guard rejects non-service writes and all mutations", async () => {
  await reset();
  await migrate(names);
  const refs = await seedSubject();
  await assert.rejects(pool.query(`
    insert into ai_governance_suggestion_runs(run_uid,governance_run_id,governance_group_id,group_version,group_input_digest,capability,execution_mode,schema_version,schema_digest,evaluator_version,rule_version,config_version,config_digest,provider_id,model_id,model_version,prompt_version,parameter_digest,input_version,input_digest,contract_digest,run_digest,result_digest,idempotency_key_digest,operation_id,request_id,requested_by,expires_at)
    values($1,$2,$3,1,$4,'CLASSIFICATION','LOCAL_DETERMINISTIC','v1',$4,'ai-governance-evaluator-v1','bom-material-governance-v1','v1',$4,'LOCAL_DETERMINISTIC','NONE','NONE','NONE',$4,'v1',$4,$4,$5,$4,$4,$6,$7,$8,now()+interval '1 day')
  `, [randomUUID(), refs.governanceRunId, refs.groupId, sha("guard"), sha("guard-run"), randomUUID(), randomUUID(), refs.actor]), /writes require service transaction/i);
  const saved = await createComplete(refs, "CLASSIFICATION");
  for (const statement of [
    ["update ai_governance_suggestions set row_version=1 where id=$1", saved.suggestionId],
    ["delete from ai_governance_suggestion_events where suggestion_id=$1", saved.suggestionId],
  ]) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('cyd.ai_governance_suggestion_service_write','allowed',true)");
      await assert.rejects(client.query(statement[0], [statement[1]]), /immutable/i);
      await client.query("rollback");
    } finally {
      client.release();
    }
  }
});

test("all four typed item combinations commit with evidence", async () => {
  await reset();
  await migrate(names);
  const refs = await seedSubject();
  for (const capability of ["CLASSIFICATION", "ATTRIBUTE_EXTRACTION", "MATERIAL_MATCH", "SUPPLIER_MAPPING"]) {
    const saved = await createComplete(refs, capability);
    assert.ok(saved.itemId);
  }
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_runs")).rows[0].count, 4);
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_items")).rows[0].count, 4);
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_evidence")).rows[0].count, 4);
});

test("deferred constraints reject incomplete disposition and evidence combinations", async () => {
  await reset();
  await migrate(names);
  const refs = await seedSubject();
  await assert.rejects(createComplete(refs, "CLASSIFICATION", { withItem: false }), /item cardinality mismatch/i);
  await assert.rejects(createComplete(refs, "CLASSIFICATION", { withEvidence: false }), /requires evidence/i);
  await assert.rejects(createComplete(refs, "CLASSIFICATION", { disposition: "ABSTAIN", forceItem: true }), /item cardinality mismatch/i);
  const abstained = await createComplete(refs, "CLASSIFICATION", { disposition: "ABSTAIN", withItem: false });
  assert.ok(abstained.suggestionId);
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_items")).rows[0].count, 0);
});

test("digest, TTL, version, score and kind combinations fail closed", async () => {
  await reset();
  await migrate(names);
  const refs = await seedSubject();
  await rejectInvalidRun(refs, { groupInputDigest: "not-a-digest" }, /runs_digest_ck/i);
  await rejectInvalidRun(refs, { groupVersion: 2 }, /runs_version_ck/i);
  await rejectInvalidRun(refs, { expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000) }, /runs_ttl_ck/i);
  await assert.rejects(createComplete(refs, "CLASSIFICATION", { itemOverride: { score: "1.20000000" } }), /items_common_ck/i);
  await assert.rejects(createComplete(refs, "CLASSIFICATION", { itemOverride: { material_id: refs.materialId, material_version_snapshot: 1, material_status_snapshot: "ACTIVE", material_digest: sha("mixed-material") } }), /items_kind_ck/i);
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_runs")).rows[0].count, 0);
});

test("evidence from another governance group is rejected at commit", async () => {
  await reset();
  await migrate(names);
  const refs = await seedSubject();
  const client = await pool.connect();
  let candidateId;
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.material_governance_service_write','allowed',true)");
    const otherGroup = await client.query(`
      insert into material_governance_groups(governance_run_id,group_key,category,readiness,canonical_key,canonical_specification,standard_name,identity_digest,compatibility_digest,source_count,merge_evidence,decision_status,version,created_by,updated_by)
      values($1,$2,'OTHER','REVIEW_REQUIRED',null,null,'其他治理组',null,null,1,'[]'::jsonb,'PENDING',1,$3,$3) returning id
    `, [refs.governanceRunId, sha("other-group"), refs.actor]);
    const candidate = await client.query(`
      insert into material_governance_material_candidates(group_id,material_id,candidate_kind,candidate_rank,material_version_snapshot,material_status_snapshot,candidate_snapshot,evidence,candidate_digest)
      values($1,$2,'EXACT_IDENTITY',1,1,'ACTIVE','{}'::jsonb,'[]'::jsonb,$3) returning id
    `, [otherGroup.rows[0].id, refs.materialId, sha("other-candidate")]);
    candidateId = Number(candidate.rows[0].id);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await assert.rejects(createComplete(refs, "MATERIAL_MATCH", { governanceMaterialCandidateId: candidateId }), /crosses subject or input lineage/i);
  assert.equal((await pool.query("select count(*)::integer count from ai_governance_suggestion_runs")).rows[0].count, 0);
});
