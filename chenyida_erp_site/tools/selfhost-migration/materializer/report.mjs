export function buildMaterializationReport({ plan, dispatch, reconciliation }) {
  return {
    schema_version: 1,
    result: reconciliation.grade,
    mode: plan.mode,
    snapshot_records: plan.snapshot.length,
    archive_only_records: plan.archive_only.length,
    public_actual_targets: reconciliation.actual_target_count,
    files: dispatch.files.length,
    erp_records_delta: reconciliation.erp_records_delta,
    provenance_orphans: reconciliation.provenance_orphans,
  };
}
