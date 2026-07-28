#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import pg from "pg";
import { canonicalJson, sha256, stableUuid } from "../selfhost-migration/digest.mjs";

const { Pool } = pg;
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => value.startsWith("--") ? [...all, [value.slice(2), values[index + 1]]] : all, []));
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
if (args.confirm !== "REAL_BOM_IMPORT_AUTHORIZED") fail("REAL_BOM_CONFIRMATION_REQUIRED", "需要显式 real BOM 导入确认口令");
if (!args.payload) fail("REAL_BOM_PAYLOAD_REQUIRED", "缺少 --payload");
if (!process.env.DATABASE_URL) fail("DATABASE_URL_REQUIRED", "缺少 DATABASE_URL");
const parsedUrl = new URL(process.env.DATABASE_URL);
const databaseName = parsedUrl.pathname.slice(1);
if (!/^(chenyida_erp|chenyida_erp_real_bom_stage_\d{8})$/.test(databaseName)) fail("REAL_BOM_TARGET_FORBIDDEN", "目标数据库名称不在受控白名单");
if (!new Set(["development", "test"]).has(String(process.env.ERP_ENV || "").toLowerCase())) fail("REAL_BOM_ENV_FORBIDDEN", "ERP_ENV 必须是 development 或 test");

const payload = JSON.parse(await readFile(args.payload, "utf8"));
if (payload.marker !== "REAL_BOM_OFFLINE_IMPORT_V2" || payload.schema_version !== 1) fail("REAL_BOM_PAYLOAD_INVALID", "payload marker/schema 无效");
const suppliedDigest = payload.payload_digest; const unsigned = { ...payload }; delete unsigned.payload_digest;
if (sha256(unsigned) !== suppliedDigest) fail("REAL_BOM_PAYLOAD_DIGEST_MISMATCH", "payload digest 不匹配");
if (!/^[0-9a-f]{64}$/.test(payload.manifest_sha256) || payload.source_files.length !== 8) fail("REAL_BOM_MANIFEST_INVALID", "来源 manifest 无效");
if (payload.source_classifications.some((row) => !new Set(["ELIGIBLE", "NEEDS_REVIEW", "ARCHIVE_ONLY", "BLOCKED"]).has(row.classification))) fail("REAL_BOM_CLASSIFICATION_INVALID", "分类值无效");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: "chenyida_real_bom_import" });
const runId = stableUuid("cyd-real-bom-run", `${payload.manifest_sha256}:${payload.rule_version}`);
const requestId = (scope) => stableUuid("cyd-real-bom-request", `${runId}:${scope}`);
const operationId = (scope) => stableUuid("cyd-real-bom-operation", `${runId}:${scope}`);
let actor = "";

async function tx(work) {
  const client = await pool.connect();
  try { await client.query("begin"); const result = await work(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function sourceLink(client, targetTable, targetId, row, classification = "ELIGIBLE") {
  await client.query(`insert into migration_tool.real_bom_source_links
    (migration_run_id,target_table,actual_target_id,source_ref,file_sha256,sheet_name,source_row,mapping_rule_version,mapping_method,source_record_digest,classification)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict(migration_run_id,target_table,actual_target_id,source_ref) do update set
      source_record_digest=excluded.source_record_digest,mapping_method=excluded.mapping_method,classification=excluded.classification`,
  [runId, targetTable, String(targetId), row.source_ref, row.file_sha256, row.sheet, Number(row.source_row), payload.rule_version, row.mapping_method || "STRICT_SOURCE", row.source_record_digest || sha256(row), classification]);
}

async function audit(client, scope, targetTable, targetId, sourceCount) {
  await client.query(`insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,retention_until)
    select $1,'REAL_BOM_HISTORY_MATERIALIZED',$2,$3,'success','REAL_BOM_MIGRATION',$4,now()+interval '2555 days'
    where not exists(select 1 from audit_log where operation_id=$4 and route_code='REAL_BOM_MIGRATION')`, [actor, { migration_run_id: runId, target_table: targetTable, target_id: String(targetId), source_count: sourceCount, rule_version: payload.rule_version }, requestId(scope), operationId(scope)]);
}

async function initialize() {
  return tx(async (client) => {
    const migrationCount = Number((await client.query("select count(*)::int count from schema_migrations")).rows[0].count);
    const latest = (await client.query("select version from schema_migrations order by version desc limit 1")).rows[0]?.version;
    if (migrationCount !== 34 || latest !== "0034_supplier_receipt_lot_iqc.sql") fail("REAL_BOM_MIGRATION_BASELINE_INVALID", "目标必须严格位于 0034");
    const admin = await client.query("select username from app_users where role='admin' and is_active=true order by username");
    if (admin.rowCount !== 1) fail("REAL_BOM_ADMIN_BASELINE_INVALID", "必须恰有一个启用管理员"); actor = admin.rows[0].username;
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["chenyida-real-bom-import"]);
    await client.query("create schema if not exists migration_tool");
    await client.query(`create table if not exists migration_tool.real_bom_import_runs(
      migration_run_id uuid primary key,manifest_sha256 text not null,rule_version text not null,payload_digest text not null,status text not null,
      actor text not null,summary jsonb not null,created_at timestamptz not null default now(),completed_at timestamptz,
      unique(manifest_sha256,rule_version),check(status in ('IMPORTING','COMPLETED','FAILED')))`);
    await client.query(`create table if not exists migration_tool.real_bom_source_classifications(
      migration_run_id uuid not null references migration_tool.real_bom_import_runs(migration_run_id),source_ref text not null,classification text not null,
      material_classification text not null,bom_classification text not null,reason_codes jsonb not null,
      primary key(migration_run_id,source_ref),check(classification in ('ELIGIBLE','NEEDS_REVIEW','ARCHIVE_ONLY','BLOCKED')))`);
    await client.query(`create table if not exists migration_tool.real_bom_source_links(
      migration_run_id uuid not null references migration_tool.real_bom_import_runs(migration_run_id),target_table text not null,actual_target_id text not null,
      source_ref text not null,file_sha256 text not null,sheet_name text not null,source_row integer not null,mapping_rule_version text not null,mapping_method text not null,
      source_record_digest text not null,classification text not null,created_at timestamptz not null default now(),
      primary key(migration_run_id,target_table,actual_target_id,source_ref))`);
    const prior = await client.query("select status,payload_digest from migration_tool.real_bom_import_runs where migration_run_id=$1 for update", [runId]);
    if (prior.rows[0] && prior.rows[0].payload_digest !== suppliedDigest) fail("REAL_BOM_REPLAY_INPUT_CHANGED", "同一导入批次 payload 已变化");
    await client.query(`insert into migration_tool.real_bom_import_runs(migration_run_id,manifest_sha256,rule_version,payload_digest,status,actor,summary)
      values($1,$2,$3,$4,'IMPORTING',$5,$6::jsonb) on conflict(migration_run_id) do update set status=case when migration_tool.real_bom_import_runs.status='COMPLETED' then 'COMPLETED' else 'IMPORTING' end`,
    [runId, payload.manifest_sha256, payload.rule_version, suppliedDigest, actor, JSON.stringify(payload.summary)]);
    for (const row of payload.source_classifications) await client.query(`insert into migration_tool.real_bom_source_classifications(migration_run_id,source_ref,classification,material_classification,bom_classification,reason_codes)
      values($1,$2,$3,$4,$5,$6::jsonb) on conflict(migration_run_id,source_ref) do update set classification=excluded.classification,material_classification=excluded.material_classification,bom_classification=excluded.bom_classification,reason_codes=excluded.reason_codes`, [runId, row.source_ref, row.classification, row.material_classification, row.bom_classification, JSON.stringify(row.reason_codes)]);
    return prior.rows[0]?.status === "COMPLETED";
  });
}

async function provisionMetadataAndMaterials() {
  return tx(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["chenyida-real-bom-materials"]);
    const metadata = [["RB_ROOT","历史工程物料",null,1],["RB_MASTER","历史主数据","RB_ROOT",2],["RB_CLASSIFIED","确定性分类","RB_MASTER",3]];
    const categoryNames = new Map(payload.materials.map((m) => [m.category_code, m.category_name]));
    for (const [code, name, parent, level] of [...metadata, ...[...categoryNames].sort().map(([code, name]) => [code, name, "RB_CLASSIFIED", 4])]) {
      await client.query(`insert into material_categories(category_code,category_name_cn,parent_id,category_level,status,description,created_by,updated_by,request_id)
        values($1,$2,(select id from material_categories where category_code=$3),$4,'ACTIVE','真实历史 BOM 确定性分类',$5,$5,$6)
        on conflict(category_code) do update set category_name_cn=excluded.category_name_cn,status='ACTIVE',updated_by=excluded.updated_by,updated_at=now()`, [code, name, parent, level, actor, requestId(`category:${code}`)]);
    }
    await client.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) on conflict(code) do update set enabled=true,updated_at=now()");
    const unitId = Number((await client.query("select id from units where code='PCS' and enabled=true")).rows[0].id);
    for (const material of payload.materials) {
      const categoryId = Number((await client.query("select id from material_categories where category_code=$1 and category_level=4 and status='ACTIVE'", [material.category_code])).rows[0]?.id || 0);
      if (!categoryId) fail("REAL_BOM_CATEGORY_INVALID", "分类叶子不可用");
      let found = await client.query("select * from material_master where internal_material_code=$1", [material.internal_code]);
      if (!found.rows[0]) found = await client.query(`insert into material_master
        (internal_material_code,standard_name,category_id,manufacturer,manufacturer_part_number,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,source_ref,version,last_modified_by,submitted_by,submitted_at,approved_by,approved_at,created_by,updated_by,request_id)
        values($1,$2,$3,$4,$5,'PCS',$6,'ACTIVE','NON_PURCHASABLE','NON_STOCKED','NONE','UNSPECIFIED','MIGRATION',$7,3,$8,$9,now(),$9,now(),$8,$9,$10) returning *`,
      [material.internal_code, material.standard_name, categoryId, material.manufacturer, material.manufacturer_part_number, unitId, material.source_rows[0].source_ref, "real-bom-classifier-v2", actor, requestId(material.stable_key)]);
      const row = found.rows[0];
      if (row.standard_name !== material.standard_name || Number(row.category_id) !== categoryId || Number(row.base_unit_id) !== unitId || row.material_status !== "ACTIVE") fail("REAL_BOM_MATERIAL_REPLAY_CONFLICT", "正式物料与重放 payload 不一致");
      const snapshot = { material_id: Number(row.id), internal_material_code: row.internal_material_code, standard_name: row.standard_name, category_id: categoryId, unit: "PCS", material_status: "ACTIVE", source_type: "MIGRATION", rule_version: payload.rule_version };
      await client.query(`insert into material_versions(material_id,version_no,event_type,change_reason,changed_fields,snapshot,changed_by,reviewed_by,reviewed_at,request_id)
        values($1,1,'MIGRATION_APPROVE','项目所有者授权历史数据确定性迁移',$2::jsonb,$3::jsonb,$4,$5,now(),$6) on conflict(material_id,version_no) do nothing`, [row.id, JSON.stringify(["CREATE","SUBMIT","APPROVE"]), JSON.stringify(snapshot), "real-bom-classifier-v2", actor, requestId(`${material.stable_key}:version`)]);
      for (const source of material.source_rows) {
        await client.query(`insert into legacy_material_mapping(material_id,source_type,source_table,source_key,source_code,source_name,source_snapshot_hash,mapping_method,status,mapped_by,approved_by,approved_at,request_id)
          values($1,'REAL_BOM','SPREADSHEET_ROW',$2,$3,$4,$5,$6,'ACTIVE',$7,$8,now(),$9)
          on conflict(source_type,source_table,source_key) do update set material_id=excluded.material_id,source_snapshot_hash=excluded.source_snapshot_hash,mapping_method=excluded.mapping_method,updated_at=now()`,
        [row.id, source.source_ref, material.internal_code, material.standard_name, source.source_record_digest, source.mapping_method, "real-bom-classifier-v2", actor, requestId(`legacy:${source.source_ref}`)]);
        await sourceLink(client, "material_master", row.id, source);
      }
      await audit(client, material.stable_key, "material_master", row.id, material.source_rows.length);
    }
    for (const [categoryCode, count] of Object.entries(Object.fromEntries(payload.materials.map((m) => [m.category_code, 0])))) {
      const max = payload.materials.filter((m) => m.category_code === categoryCode).length;
      await client.query(`insert into material_code_sequences(category_id,category_code,next_value)
        select id,$1,$2 from material_categories where category_code=$1 on conflict(category_id) do update set next_value=greatest(material_code_sequences.next_value,excluded.next_value),updated_at=now()`, [categoryCode, Math.max(Number(count), max) + 1]);
    }
  });
}

async function provisionProductsAndBoms() {
  const productByKey = new Map(payload.products.map((product) => [product.stable_key, product]));
  for (const bom of payload.boms) await tx(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`chenyida-real-bom-workbook:${bom.file_sha256}`]);
    const product = productByKey.get(bom.product_key); if (!product) fail("REAL_BOM_PRODUCT_MISSING", "BOM 产品映射缺失");
    let p = (await client.query("select * from products where product_code=$1", [product.product_code])).rows[0];
    if (!p) p = (await client.query(`insert into products(product_code,product_name,status,current_version_no,created_by,updated_by,request_id)
      values($1,$2,'ACTIVE',1,$3,$3,$4) returning *`, [product.product_code, product.product_name, actor, requestId(product.stable_key)])).rows[0];
    let pv = (await client.query("select * from product_versions where product_id=$1 and version_code=$2", [p.id, product.version_code])).rows[0];
    if (!pv) pv = (await client.query(`insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,smt_required,released_by,released_at,created_by,updated_by,request_id)
      values($1,1,$2,'RELEASED','ELECTRONIC_ASSEMBLY','MASS_PRODUCTION',true,$3,now(),$3,$3,$4) returning *`, [p.id, product.version_code, actor, requestId(`${product.stable_key}:version`)])).rows[0];
    await sourceLink(client, "products", p.id, { source_ref: product.source_ref, file_sha256: product.file_sha256, sheet: product.sheet, source_row: 1, source_record_digest: sha256(product), mapping_method: "FILE_SHEET_PRODUCT_BOUNDARY" });
    await sourceLink(client, "product_versions", pv.id, { source_ref: `${product.source_ref}-version`, file_sha256: product.file_sha256, sheet: product.sheet, source_row: 1, source_record_digest: sha256(product), mapping_method: "SOURCE_VERSION_DIGEST" });
    let header = (await client.query("select * from bom_headers where bom_code=$1", [bom.bom_code])).rows[0];
    if (!header) header = (await client.query(`insert into bom_headers(bom_code,product_id,status,current_version_no,created_by,updated_by,request_id)
      values($1,$2,'ACTIVE',1,$3,$3,$4) returning *`, [bom.bom_code, p.id, actor, requestId(bom.stable_key)])).rows[0];
    let version = (await client.query("select * from bom_versions where bom_header_id=$1 and version_code=$2", [header.id, bom.version_code])).rows[0];
    if (!version) version = (await client.query(`insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,remark,released_by,released_at,created_by,updated_by,request_id)
      values($1,$2,1,$3,$4,$5,$6,case when $4='RELEASED' then now() else null end,$6,$6,$7) returning *`, [header.id, pv.id, bom.version_code, bom.status, bom.status === "DRAFT" ? "历史来源仍有隔离行，禁止自动发布" : "", bom.status === "RELEASED" ? actor : "", requestId(`${bom.stable_key}:version`)])).rows[0];
    for (const line of bom.lines) {
      const material = payload.materials.find((m) => m.stable_key === line.material_key); if (!material) fail("REAL_BOM_LINE_MATERIAL_MISSING", "BOM 行物料缺失");
      const materialRow = (await client.query("select id from material_master where internal_material_code=$1 and material_status='ACTIVE'", [material.internal_code])).rows[0];
      const unit = (await client.query("select id from units where code='PCS' and enabled=true")).rows[0];
      let inserted = (await client.query("select * from bom_lines where bom_version_id=$1 and line_no=$2", [version.id, line.line_no])).rows[0];
      if (!inserted) inserted = (await client.query(`insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,remark,created_by,updated_by,request_id)
        values($1,$2,$3,$4,$5,0,'HISTORICAL_IMPORT','',$6,$6,$7) returning *`, [version.id, line.line_no, materialRow.id, line.quantity, unit.id, actor, requestId(`${bom.stable_key}:line:${line.line_no}`)])).rows[0];
      if (Number(inserted.material_id) !== Number(materialRow.id) || String(inserted.quantity_per) !== Number(line.quantity).toFixed(6)) fail("REAL_BOM_LINE_REPLAY_CONFLICT", "BOM 行重放不一致");
      for (const source of line.source_rows) await sourceLink(client, "bom_lines", inserted.id, source);
      await audit(client, `${bom.stable_key}:line:${line.line_no}`, "bom_lines", inserted.id, line.source_rows.length);
    }
    await sourceLink(client, "bom_headers", header.id, { source_ref: bom.source_ref, file_sha256: bom.file_sha256, sheet: bom.sheet, source_row: 1, source_record_digest: sha256(bom), mapping_method: "FILE_SHEET_BOM_BOUNDARY" }, bom.status === "RELEASED" ? "ELIGIBLE" : "NEEDS_REVIEW");
    await sourceLink(client, "bom_versions", version.id, { source_ref: `${bom.source_ref}-version`, file_sha256: bom.file_sha256, sheet: bom.sheet, source_row: 1, source_record_digest: sha256(bom), mapping_method: "SOURCE_VERSION_DIGEST" }, bom.status === "RELEASED" ? "ELIGIBLE" : "NEEDS_REVIEW");
    await audit(client, product.stable_key, "products", p.id, 1); await audit(client, `${product.stable_key}:version`, "product_versions", pv.id, 1);
    await audit(client, bom.stable_key, "bom_headers", header.id, 1); await audit(client, `${bom.stable_key}:version`, "bom_versions", version.id, 1);
  });
}

async function reconcile() {
  const result = await pool.query(`select
    (select count(*)::int from material_master where source_type='MIGRATION' and source_ref in (select source_ref from migration_tool.real_bom_source_links where migration_run_id=$1 and target_table='material_master')) materials,
    (select count(*)::int from products p where exists(select 1 from migration_tool.real_bom_source_links l where l.migration_run_id=$1 and l.target_table='products' and l.actual_target_id=p.id::text)) products,
    (select count(*)::int from bom_headers h where exists(select 1 from migration_tool.real_bom_source_links l where l.migration_run_id=$1 and l.target_table='bom_headers' and l.actual_target_id=h.id::text)) boms,
    (select count(*)::int from bom_versions v where exists(select 1 from migration_tool.real_bom_source_links l where l.migration_run_id=$1 and l.target_table='bom_versions' and l.actual_target_id=v.id::text)) bom_versions,
    (select count(*)::int from bom_lines l where exists(select 1 from migration_tool.real_bom_source_links x where x.migration_run_id=$1 and x.target_table='bom_lines' and x.actual_target_id=l.id::text)) bom_lines,
    (select count(*)::int from migration_tool.real_bom_source_links where migration_run_id=$1) source_links,
    (select count(*)::int from migration_tool.real_bom_source_classifications where migration_run_id=$1 and classification='NEEDS_REVIEW') needs_review,
    (select count(*)::int from bom_lines l left join bom_versions v on v.id=l.bom_version_id left join material_master m on m.id=l.material_id left join units u on u.id=l.unit_id where v.id is null or m.id is null or u.id is null) orphans,
    (select count(*)::int from (select internal_material_code from material_master where internal_material_code is not null group by internal_material_code having count(*)>1) q) duplicate_codes,
    (select count(*)::int from bom_lines where quantity_per<=0 or scale(quantity_per)>6) invalid_quantities`, [runId]);
  const row = result.rows[0];
  for (const key of ["materials","products","boms","bom_lines"]) if (Number(row[key]) !== Number(payload.summary[key])) fail("REAL_BOM_RECONCILIATION_COUNT_MISMATCH", `${key} 数量不一致`);
  if (Number(row.orphans) || Number(row.duplicate_codes) || Number(row.invalid_quantities)) fail("REAL_BOM_RECONCILIATION_INTEGRITY_FAILED", "引用、编码或数量核对失败");
  return row;
}

try {
  const replay = await initialize();
  if (!replay) { await provisionMetadataAndMaterials(); await provisionProductsAndBoms(); }
  const reconciliation = await reconcile();
  await pool.query("update migration_tool.real_bom_import_runs set status='COMPLETED',completed_at=coalesce(completed_at,now()) where migration_run_id=$1", [runId]);
  process.stdout.write(canonicalJson({ ok: true, replayed: replay, database: databaseName, run_id: runId, reconciliation }) + "\n");
} catch (error) {
  await pool.query("update migration_tool.real_bom_import_runs set status='FAILED' where migration_run_id=$1 and status<>'COMPLETED'", [runId]).catch(() => undefined);
  process.stderr.write(canonicalJson({ ok: false, code: error.code || "REAL_BOM_IMPORT_FAILED", message: error.message }) + "\n"); process.exitCode = 1;
} finally { await pool.end(); }
