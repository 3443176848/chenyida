import { sha256, stableUuid } from "../digest.mjs";
import { fail } from "./errors.mjs";
import { PUBLIC_TARGET_TABLES } from "./types.mjs";

export async function ensureMaterializationTables(client) {
  await client.query(`create table if not exists migration_tool.public_id_map (
    migration_run_id uuid not null references migration_tool.runs(run_id), manifest_sha256 text not null,
    source_system text not null, source_kind text not null, source_stable_reference_digest text not null,
    source_record_digest text not null, mapping_digest text not null, plan_digest text not null,
    target_table text not null, actual_target_id text not null, materialized_status text not null,
    request_id uuid not null, operation_id uuid not null, materialized_at timestamptz not null default now(),
    target_digest text not null,
    primary key(migration_run_id,source_system,source_kind,source_stable_reference_digest),
    unique(target_table,actual_target_id)
  )`);
  await client.query(`create table if not exists migration_tool.materialization_checkpoints (
    migration_run_id uuid not null references migration_tool.runs(run_id), stage text not null,
    input_digest text not null, result_digest text not null, completed_at timestamptz not null default now(),
    primary key(migration_run_id,stage)
  )`);
  await client.query(`create table if not exists migration_tool.synthetic_files (
    migration_run_id uuid not null references migration_tool.runs(run_id), source_stable_reference_digest text not null,
    relative_path text not null, sha256 text not null, size_bytes bigint not null, mime_type text not null,
    primary key(migration_run_id,source_stable_reference_digest), unique(relative_path)
  )`);
  await client.query(`create table if not exists migration_tool.source_classifications (
    migration_run_id uuid not null references migration_tool.runs(run_id), source_ref text not null,
    classification text not null, classified_at timestamptz not null default now(),
    primary key(migration_run_id,source_ref)
  )`);
}

export function targetDigest(value) { return sha256(value); }

export async function mappedTarget(client, context, row) {
  const found = await client.query(`select * from migration_tool.public_id_map where migration_run_id=$1 and source_system=$2 and source_kind=$3 and source_stable_reference_digest=$4`, [context.runId, context.sourceSystem, row.kind, sha256(row.stable_key)]);
  if (!found.rows[0]) return null;
  if (found.rows[0].manifest_sha256 !== context.manifestSha256 || found.rows[0].source_record_digest !== row.source_digest || found.rows[0].mapping_digest !== context.mappingDigest || found.rows[0].plan_digest !== context.planDigest) fail("MATERIALIZATION_SOURCE_CHANGED", "stable source 对应摘要已变化");
  return found.rows[0];
}

export async function recordTarget(client, context, row, targetTable, actualTargetId, digestValue) {
  if (!PUBLIC_TARGET_TABLES.has(targetTable)) fail("MATERIALIZATION_TARGET_TABLE_INVALID", "目标表不在允许列表");
  const requestId = stableUuid("cyd-materialization-request", `${context.runId}:${row.source_ref}`);
  const operationId = stableUuid("cyd-materialization-operation", `${context.runId}:${row.source_ref}`);
  const targetDigestValue = targetDigest(digestValue);
  await client.query(`insert into migration_tool.public_id_map(migration_run_id,manifest_sha256,source_system,source_kind,source_stable_reference_digest,source_record_digest,mapping_digest,plan_digest,target_table,actual_target_id,materialized_status,request_id,operation_id,target_digest)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MATERIALIZED',$11,$12,$13)`, [context.runId, context.manifestSha256, context.sourceSystem, row.kind, sha256(row.stable_key), row.source_digest, context.mappingDigest, context.planDigest, targetTable, String(actualTargetId), requestId, operationId, targetDigestValue]);
  await client.query(`insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,retention_until) values($1,'SYNTHETIC_SNAPSHOT_MATERIALIZED',$2,$3,'success','MIGRATION_MATERIALIZER',$4,now()+interval '2555 days')`, [context.actor, { source_ref: row.source_ref, target_table: targetTable, target_id: String(actualTargetId) }, requestId, operationId]);
  return { target_table: targetTable, actual_target_id: String(actualTargetId), target_digest: targetDigestValue, request_id: requestId, operation_id: operationId };
}

export async function requireMappedTarget(client, context, kind, stableKey) {
  const found = await client.query(`select target_table,actual_target_id,target_digest from migration_tool.public_id_map where migration_run_id=$1 and source_system=$2 and source_kind=$3 and source_stable_reference_digest=$4`, [context.runId, context.sourceSystem, kind, sha256(stableKey)]);
  if (!found.rows[0]) fail("MATERIALIZATION_UPSTREAM_BLOCKED", `缺少 ${kind} 的稳定 target ID`);
  return found.rows[0];
}
