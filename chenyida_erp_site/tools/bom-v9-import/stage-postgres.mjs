#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(process.env.ERP_NODE_PACKAGE_JSON || "/app/package.json");
const pg = require("pg");
const { Pool } = pg;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function stableUuid(namespace, value) {
  const hex = sha256(`${namespace}\0${value}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const entries = process.argv.slice(2).reduce((result, value, index, values) => {
  if (value.startsWith("--")) result[value.slice(2)] = values[index + 1];
  return result;
}, {});
if (entries.confirm !== "BOM_V9_STAGING_AUTHORIZED") {
  fail("BOM_V9_CONFIRMATION_REQUIRED", "缺少 staging 确认口令");
}
if (!entries.payload) fail("BOM_V9_PAYLOAD_REQUIRED", "缺少 staging payload");
if (!process.env.DATABASE_URL) fail("DATABASE_URL_REQUIRED", "缺少 DATABASE_URL");
if (String(process.env.ERP_ENV || "").toLowerCase() !== "test") {
  fail("BOM_V9_ENV_FORBIDDEN", "staging 只允许 ERP_ENV=test");
}

const parsedUrl = new URL(process.env.DATABASE_URL);
const databaseName = parsedUrl.pathname.slice(1);
if (!/^chenyida_erp_bom_v9_stage_\d{8}$/.test(databaseName)) {
  fail("BOM_V9_TARGET_FORBIDDEN", "目标必须是受控 BOM V9 staging 数据库");
}

const payload = JSON.parse(await readFile(entries.payload, "utf8"));
if (payload.marker !== "BOM_V9_EXPLICIT_STAGING_V1" || payload.schema_version !== 1) {
  fail("BOM_V9_PAYLOAD_INVALID", "payload marker/schema 无效");
}
const suppliedDigest = payload.payload_digest;
const unsigned = { ...payload };
delete unsigned.payload_digest;
if (sha256(unsigned) !== suppliedDigest) {
  fail("BOM_V9_PAYLOAD_DIGEST_MISMATCH", "payload digest 不匹配");
}
if (!/^[0-9a-f]{64}$/.test(payload.manifest?.source_file?.sha256 || "")) {
  fail("BOM_V9_MANIFEST_INVALID", "来源 manifest 无效");
}
if (payload.rows.length !== Number(payload.summary.source_rows)) {
  fail("BOM_V9_ROW_COUNT_INVALID", "payload 行数与摘要不一致");
}
if (payload.rows.some((row) => !["ELIGIBLE", "NEEDS_REVIEW"].includes(row.classification))) {
  fail("BOM_V9_CLASSIFICATION_INVALID", "存在非法分类");
}
if (payload.rows.some((row) => row.classification === "ELIGIBLE" && !row.unit_code)) {
  fail("BOM_V9_UNIT_GATE_BYPASSED", "ELIGIBLE 行缺少显式单位");
}

const runId = stableUuid(
  "cyd-bom-v9-stage",
  `${payload.manifest.source_file.sha256}:${payload.rule_version}`,
);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  application_name: "chenyida_bom_v9_stage",
});

try {
  const client = await pool.connect();
  let insertedRows = 0;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["chenyida-bom-v9-stage"]);
    const migration = (await client.query(`select count(*)::int count,
      max(version) filter(where version=(select max(version) from schema_migrations)) head
      from schema_migrations`)).rows[0];
    if (Number(migration.count) !== 34 || migration.head !== "0034_supplier_receipt_lot_iqc.sql") {
      fail("BOM_V9_MIGRATION_BASELINE_INVALID", "staging 必须严格位于 0034");
    }

    await client.query("create schema if not exists migration_tool");
    await client.query(`create table if not exists migration_tool.bom_v9_stage_runs(
      stage_run_id uuid primary key,
      source_sha256 text not null,
      manifest_sha256 text not null,
      rule_version text not null,
      payload_digest text not null,
      status text not null check(status in ('STAGED','FAILED')),
      summary jsonb not null,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      unique(source_sha256,rule_version)
    )`);
    await client.query(`create table if not exists migration_tool.bom_v9_stage_rows(
      stage_run_id uuid not null references migration_tool.bom_v9_stage_runs(stage_run_id),
      source_ref text not null,
      source_row integer not null check(source_row>1),
      row_digest text not null check(length(row_digest)=64),
      erp_material_code text not null,
      classification text not null check(classification in ('ELIGIBLE','NEEDS_REVIEW')),
      reason_codes jsonb not null,
      unit_code text not null,
      usage_count text not null,
      row_snapshot jsonb not null,
      created_at timestamptz not null default now(),
      primary key(stage_run_id,source_ref),
      unique(stage_run_id,source_row)
    )`);

    const priorRun = await client.query(
      "select payload_digest from migration_tool.bom_v9_stage_runs where stage_run_id=$1 for update",
      [runId],
    );
    if (priorRun.rows[0] && priorRun.rows[0].payload_digest !== suppliedDigest) {
      fail("BOM_V9_REPLAY_INPUT_CHANGED", "同一来源的 staging payload 已变化");
    }
    await client.query(`insert into migration_tool.bom_v9_stage_runs
      (stage_run_id,source_sha256,manifest_sha256,rule_version,payload_digest,status,summary,completed_at)
      values($1,$2,$3,$4,$5,'STAGED',$6::jsonb,now())
      on conflict(stage_run_id) do update set status='STAGED',completed_at=coalesce(migration_tool.bom_v9_stage_runs.completed_at,now())`, [
      runId,
      payload.manifest.source_file.sha256,
      payload.manifest.manifest_sha256,
      payload.rule_version,
      suppliedDigest,
      JSON.stringify(payload.summary),
    ]);

    for (const row of payload.rows) {
      const prior = await client.query(
        "select row_digest from migration_tool.bom_v9_stage_rows where stage_run_id=$1 and source_ref=$2",
        [runId, row.source_ref],
      );
      if (prior.rows[0] && prior.rows[0].row_digest !== row.row_digest) {
        fail("BOM_V9_REPLAY_ROW_CHANGED", "同一来源行内容已变化");
      }
      if (!prior.rows[0]) {
        const inserted = await client.query(`insert into migration_tool.bom_v9_stage_rows
          (stage_run_id,source_ref,source_row,row_digest,erp_material_code,classification,reason_codes,unit_code,usage_count,row_snapshot)
          values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb)
          on conflict do nothing returning source_ref`, [
          runId,
          row.source_ref,
          Number(row.source_row),
          row.row_digest,
          row.erp_material_code,
          row.classification,
          JSON.stringify(row.reason_codes),
          row.unit_code,
          row.usage_count,
          JSON.stringify(row.row_snapshot),
        ]);
        insertedRows += inserted.rowCount;
      }
    }

    const reconciled = (await client.query(`select
      count(*)::int source_rows,
      count(*) filter(where classification='ELIGIBLE')::int eligible,
      count(*) filter(where classification='NEEDS_REVIEW')::int needs_review,
      count(*) filter(where unit_code='')::int missing_unit,
      count(distinct erp_material_code)::int unique_codes,
      count(distinct source_ref)::int unique_source_refs,
      count(distinct row_digest)::int unique_row_digests
      from migration_tool.bom_v9_stage_rows where stage_run_id=$1`, [runId])).rows[0];
    if (Number(reconciled.source_rows) !== Number(payload.summary.source_rows)) {
      fail("BOM_V9_STAGING_RECONCILIATION_FAILED", "staging 行数不一致");
    }
    if (Number(reconciled.eligible) !== Number(payload.summary.classification_counts.ELIGIBLE || 0)
      || Number(reconciled.needs_review) !== Number(payload.summary.classification_counts.NEEDS_REVIEW || 0)) {
      fail("BOM_V9_STAGING_CLASSIFICATION_MISMATCH", "staging 分类计数不一致");
    }
    await client.query("commit");
    process.stdout.write(`${canonicalJson({
      ok: true,
      database: databaseName,
      run_id: runId,
      replayed: insertedRows === 0,
      inserted_rows: insertedRows,
      reconciliation: reconciled,
    })}\n`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  process.stderr.write(`${canonicalJson({
    ok: false,
    code: error.code || "BOM_V9_STAGING_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
