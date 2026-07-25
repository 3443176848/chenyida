import pg from "pg";
import { parseSafePostgresUrl } from "./environment-guard.mjs";
import { fail } from "./errors.mjs";
import { sha256, stableUuid } from "./digest.mjs";
import { buildOpeningCommands } from "./opening-commands.mjs";
import { MigrationOpeningService } from "./migration-opening-service.mjs";
import { finalizePublicSnapshot, materializePublicSnapshot, recordOpeningTargets } from "./materializer/index.mjs";

const { Pool } = pg;

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) fail("MIGRATION_TARGET_SCHEMA_INVALID", "目标 schema 标识无效");
  return `"${value}"`;
}

export class PostgresTargetAdapter {
  constructor(databaseUrl, environment = process.env) {
    if (String(environment.ERP_ENV || "").toLowerCase() !== "test") fail("MIGRATION_ENVIRONMENT_FORBIDDEN", "迁移目标只允许 ERP_ENV=test");
    this.parsed = parseSafePostgresUrl(databaseUrl);
    this.databaseUrl = databaseUrl;
    this.pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "chenyida_synthetic_migration" });
  }

  async materializeSnapshot(options) {
    return materializePublicSnapshot({ pool: this.pool, databaseUrl: this.databaseUrl, ...options });
  }

  async inspect(expectedMigrations, { requireEmpty = true, resumeRunId = "", resumeInputDigest = "" } = {}) {
    const client = await this.pool.connect();
    try {
      const migrations = await client.query("select version, checksum from schema_migrations order by version");
      if (migrations.rows.length !== expectedMigrations.length || migrations.rows.some((row, index) => row.version !== expectedMigrations[index].name || row.checksum !== expectedMigrations[index].sha256)) {
        fail("MIGRATION_TARGET_BASELINE_INVALID", "目标数据库 migration 与 0001—0017 不一致");
      }
      const tables = await client.query("select tablename from pg_tables where schemaname='public' and tablename<>'schema_migrations' order by tablename");
      let existingRunManifest = null;
      const migrationToolExists = (await client.query("select to_regnamespace('migration_tool') is not null present")).rows[0].present;
      if (resumeRunId && migrationToolExists) {
        const runs = await client.query("select run_id,input_digest,manifest from migration_tool.runs order by created_at");
        const match = runs.rows.find((row) => row.run_id === resumeRunId && row.input_digest === resumeInputDigest);
        if (runs.rowCount === 1 && match) existingRunManifest = match.manifest;
      }
      if (requireEmpty && !existingRunManifest) for (const { tablename } of tables.rows) {
        const present = await client.query(`select 1 from public.${quoteIdentifier(tablename)} limit 1`);
        if (present.rowCount) fail("MIGRATION_TARGET_NOT_EMPTY", "目标 PostgreSQL 含业务数据，拒绝写入");
      }
      const foreignKeys = await client.query("select count(*)::int as count from pg_constraint where contype='f' and connamespace='public'::regnamespace");
      return { databaseName: this.parsed.databaseName, migrations: migrations.rows, publicTableCount: tables.rowCount, businessForeignKeyCount: foreignKeys.rows[0].count, existingRunManifest };
    } finally { client.release(); }
  }

  async initialize(runId, inputDigest, manifest) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("create schema if not exists migration_tool");
      await client.query(`create table if not exists migration_tool.runs (run_id uuid primary key, input_digest text not null, source_snapshot_sha256 text not null, state text not null, manifest jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
      await client.query(`create table if not exists migration_tool.synthetic_records (target_id uuid primary key, source_system text not null, source_kind text not null, source_stable_key_digest text not null, target_table text not null, source_digest text not null, target_digest text not null, domain text not null, payload jsonb not null, created_run_id uuid not null references migration_tool.runs(run_id), unique(source_system,source_kind,source_stable_key_digest))`);
      await client.query(`create table if not exists migration_tool.synthetic_relations (record_id uuid not null references migration_tool.synthetic_records(target_id), relation_kind text not null, related_record_id uuid not null references migration_tool.synthetic_records(target_id), primary key(record_id,relation_kind,related_record_id))`);
      await client.query(`create table if not exists migration_tool.id_map (source_system text not null, source_kind text not null, source_stable_key_digest text not null, target_table text not null, target_id uuid not null references migration_tool.synthetic_records(target_id), mapping_status text not null, source_digest text not null, target_digest text not null, migration_run_id uuid not null references migration_tool.runs(run_id), primary key(source_system,source_kind,source_stable_key_digest))`);
      await client.query(`create table if not exists migration_tool.row_results (migration_run_id uuid not null references migration_tool.runs(run_id), source_ref text not null, domain text not null, status text not null, safe_code text not null default '', target_id uuid, primary key(migration_run_id,source_ref))`);
      const existing = await client.query("select input_digest from migration_tool.runs where run_id=$1", [runId]);
      if (existing.rows[0] && existing.rows[0].input_digest !== inputDigest) fail("MIGRATION_RUN_CONFLICT", "run ID 对应输入摘要冲突");
      await client.query("insert into migration_tool.runs(run_id,input_digest,source_snapshot_sha256,state,manifest) values($1,$2,$3,'COMMITTING',$4::jsonb) on conflict(run_id) do update set state='COMMITTING',updated_at=now()", [runId, inputDigest, manifest.source_snapshot_sha256, JSON.stringify(manifest)]);
      await client.query("commit");
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async commitDomain(runId, sourceSystem, rows) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const row of rows) {
        const stableKeyDigest = sha256(row.stable_key);
        const targetDigest = sha256({ target_table: row.target_table, payload: row.data });
        const existing = await client.query("select target_id,source_digest from migration_tool.synthetic_records where source_system=$1 and source_kind=$2 and source_stable_key_digest=$3 for update", [sourceSystem, row.kind, stableKeyDigest]);
        if (existing.rows[0] && existing.rows[0].source_digest !== row.source_digest) fail("MIGRATION_SOURCE_CHANGED", "相同 stable key 的 source digest 已变化");
        await client.query(`insert into migration_tool.synthetic_records(target_id,source_system,source_kind,source_stable_key_digest,target_table,source_digest,target_digest,domain,payload,created_run_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) on conflict(target_id) do nothing`, [row.target_id, sourceSystem, row.kind, stableKeyDigest, row.target_table, row.source_digest, targetDigest, row.domain, JSON.stringify(row.data), runId]);
        await client.query(`insert into migration_tool.id_map(source_system,source_kind,source_stable_key_digest,target_table,target_id,mapping_status,source_digest,target_digest,migration_run_id) values($1,$2,$3,$4,$5,'MAPPED',$6,$7,$8) on conflict(source_system,source_kind,source_stable_key_digest) do nothing`, [sourceSystem, row.kind, stableKeyDigest, row.target_table, row.target_id, row.source_digest, targetDigest, runId]);
        await client.query(`insert into migration_tool.row_results(migration_run_id,source_ref,domain,status,target_id) values($1,$2,$3,'MIGRATED',$4) on conflict do nothing`, [runId, row.source_ref, row.domain, row.target_id]);
      }
      for (const row of rows) for (const relation of row.relations) {
        const related = await client.query("select target_id from migration_tool.synthetic_records where source_system=$1 and source_kind=$2 and source_stable_key_digest=$3", [sourceSystem, relation.kind, sha256(relation.key)]);
        if (!related.rows[0]) fail("MIGRATION_ORPHAN_BLOCKED", "目标关系缺失，事务已阻断");
        await client.query("insert into migration_tool.synthetic_relations(record_id,relation_kind,related_record_id) values($1,$2,$3) on conflict do nothing", [row.target_id, relation.name || relation.kind, related.rows[0].target_id]);
      }
      await client.query("commit");
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async materializeOpenings({ source, plan, manifest, targetMigrations }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password) values('migration_opening_actor','Synthetic migration opening actor','operations','disabled-test-only',false,true) on conflict(username) do nothing`);
      const categoryRow = plan.rows.find((row) => row.kind === "category");
      if (categoryRow) await client.query(`insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values($1,'Synthetic migration category',4,'ACTIVE','migration_opening_actor','migration_opening_actor',$2) on conflict(category_code) do nothing`, [categoryRow.stable_key, stableUuid("migration-opening-bootstrap", `category:${categoryRow.stable_key}`)]);
      for (const row of plan.rows.filter((item) => item.kind === "unit")) await client.query("insert into units(code,name,symbol,unit_type,enabled) values($1,$1,$1,'COUNT',true) on conflict(code) do nothing", [row.stable_key]);
      for (const row of plan.rows.filter((item) => item.kind === "customer")) await client.query(`insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values($1,$2,$1,'ACTIVE','migration_opening_actor','migration_opening_actor',$3) on conflict(customer_code) do nothing`, [row.stable_key, row.data.name, stableUuid("migration-opening-bootstrap", `customer:${row.stable_key}`)]);
      for (const row of plan.rows.filter((item) => item.kind === "supplier")) await client.query(`insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values($1,$2,$1,'ACTIVE','migration_opening_actor','migration_opening_actor',$3) on conflict(supplier_code) do nothing`, [row.stable_key, row.data.name, stableUuid("migration-opening-bootstrap", `supplier:${row.stable_key}`)]);
      for (const row of plan.rows.filter((item) => item.kind === "material")) {
        const unitKey = row.relations.find((item) => item.kind === "unit")?.key; const categoryKey = row.relations.find((item) => item.kind === "category")?.key;
        await client.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id)
          select $1,$2,c.id,u.code,u.id,'ACTIVE','PURCHASE','STOCKED','IQC','ROHS','MIGRATION','migration_opening_actor','migration_opening_actor','migration_opening_actor',$5 from material_categories c join units u on u.code=$3 where c.category_code=$4 on conflict do nothing`, [row.stable_key, row.data.name, unitKey, categoryKey, stableUuid("migration-opening-bootstrap", `material:${row.stable_key}`)]);
      }
      await client.query("commit");
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
    const bundle = buildOpeningCommands({ source, plan, manifest, targetMigrations });
    const service = new MigrationOpeningService(this.pool, { environment: { ERP_ENV: "test" } });
    const results = [];
    for (const command of bundle.commands) results.push(command.command_type === "POST_INVENTORY_OPENING" ? await service.postInventory(command) : await service.postFinance(command));
    return { bundle, results };
  }

  async recordOpeningTargets(snapshot, plan, openingResult) { return recordOpeningTargets(snapshot, plan, openingResult.bundle, openingResult.results); }

  async finalizeSnapshot(snapshot) { return finalizePublicSnapshot(snapshot); }

  async setState(runId, state) { await this.pool.query("update migration_tool.runs set state=$2,updated_at=now() where run_id=$1", [runId, state]); }

  async aggregate(runId) {
    const counts = await this.pool.query("select domain,count(*)::int as count from migration_tool.row_results where migration_run_id=$1 and status='MIGRATED' group by domain order by domain", [runId]);
    const totals = await this.pool.query(`select coalesce(sum(case when source_kind='inventory_balance' then (payload->>'on_hand_qty')::numeric else 0 end),0)::text inventory_qty, coalesce(sum(case when source_kind='finance_document' then (payload->>'amount')::numeric else 0 end),0)::text finance_amount, count(*)::int record_count from migration_tool.synthetic_records`);
    const map = await this.pool.query("select count(*)::int as count from migration_tool.id_map");
    const orphan = await this.pool.query("select count(*)::int as count from migration_tool.synthetic_relations r left join migration_tool.synthetic_records p on p.target_id=r.record_id left join migration_tool.synthetic_records q on q.target_id=r.related_record_id where p.target_id is null or q.target_id is null");
    return { domain_counts: Object.fromEntries(counts.rows.map((row) => [row.domain, row.count])), ...totals.rows[0], id_map_count: map.rows[0].count, orphan_count: orphan.rows[0].count };
  }

  async close() { await this.pool.end(); }
}
