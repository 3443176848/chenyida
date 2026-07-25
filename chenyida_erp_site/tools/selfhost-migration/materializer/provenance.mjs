export async function recordArchiveOnly(client, context, item) {
  await client.query(`insert into migration_tool.source_classifications(migration_run_id,source_ref,classification) values($1,$2,'ARCHIVE_ONLY') on conflict(migration_run_id,source_ref) do update set classification='ARCHIVE_ONLY'`, [context.runId, item.source_ref]);
}

export async function recordCheckpoint(client, context, stage, resultDigest) {
  const existing = await client.query("select input_digest,result_digest from migration_tool.materialization_checkpoints where migration_run_id=$1 and stage=$2", [context.runId, stage]);
  if (existing.rows[0] && (existing.rows[0].input_digest !== context.inputDigest || existing.rows[0].result_digest !== resultDigest)) {
    const error = new Error("checkpoint digest changed"); error.code = "MATERIALIZATION_CHECKPOINT_STALE"; throw error;
  }
  await client.query("insert into migration_tool.materialization_checkpoints(migration_run_id,stage,input_digest,result_digest) values($1,$2,$3,$4) on conflict do nothing", [context.runId, stage, context.inputDigest, resultDigest]);
}
