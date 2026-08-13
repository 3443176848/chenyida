import type { PoolClient } from "pg";

import { normalizationFailure } from "./errors.ts";
import type { NormalizationRunRow } from "./repository.ts";
import type { NormalizationMappingContext, NormalizedRowBundle } from "./types.ts";

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) normalizationFailure("IMPORT_NORMALIZATION_DATA_INVALID", "规范化数据标识无效", 500);
  return parsed;
}

function jsonValue(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export async function replaceStagedNormalizationRow(
  client: PoolClient,
  run: NormalizationRunRow,
  mapping: NormalizationMappingContext,
  source: Readonly<{ id: number; rowNumber: number; rawRowHash: string }>,
  bundle: NormalizedRowBundle,
): Promise<void> {
  const existing = await client.query("select id from material_import_normalized_rows where normalization_run_id=$1 and source_row_id=$2", [numberValue(run.id), source.id]);
  if (existing.rows[0]) {
    const rowId = numberValue(existing.rows[0].id);
    await client.query("delete from material_import_normalization_lineage where normalized_row_id=$1", [rowId]);
    await client.query("delete from material_import_normalized_attribute_candidates where normalized_row_id=$1", [rowId]);
    await client.query("delete from material_import_normalized_field_candidates where normalized_row_id=$1", [rowId]);
    await client.query("delete from material_import_normalization_issues where normalized_row_id=$1", [rowId]);
    await client.query("delete from material_import_normalized_rows where id=$1", [rowId]);
  }
  const errorCount = bundle.issues.filter((issue) => issue.level === "ERROR").length;
  const warningCount = bundle.issues.length - errorCount;
  const inserted = await client.query(`
    insert into material_import_normalized_rows(
      batch_id,normalization_run_id,source_row_id,source_sheet_id,source_sheet_index,source_sheet_name,source_row_number,
      source_raw_row_hash,normalized_payload,normalized_payload_hash,mapped_values,row_status,review_status,
      core_candidate_count,attribute_candidate_count,issue_count,error_count,warning_count,result_summary
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'NEEDS_REVIEW',$13,$14,$15,$16,$17,$18)
    returning id
  `, [
    mapping.batchId,
    numberValue(run.id),
    source.id,
    mapping.sourceSheetId,
    mapping.sourceSheetIndex,
    mapping.sourceSheetName,
    source.rowNumber,
    source.rawRowHash,
    jsonValue(bundle.payload),
    bundle.payloadHash,
    jsonValue(bundle.mappedValues),
    bundle.rowStatus,
    bundle.fieldCandidates.length,
    bundle.attributeCandidates.length,
    bundle.issues.length,
    errorCount,
    warningCount,
    jsonValue({
      core_candidate_count: bundle.fieldCandidates.length,
      attribute_candidate_count: bundle.attributeCandidates.length,
      issue_count: bundle.issues.length,
    }),
  ]);
  const rowId = numberValue(inserted.rows[0].id);
  for (const candidate of bundle.fieldCandidates) {
    await client.query(`
      insert into material_import_normalized_field_candidates(
        normalization_run_id,normalized_row_id,target_namespace,target_field_code,raw_value,normalized_value,
        value_state,validation_status,transformation_rule_code,transformation_rule_version,display_order
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [numberValue(run.id), rowId, candidate.targetNamespace, candidate.targetCode, jsonValue(candidate.rawValue), jsonValue(candidate.normalizedValue), candidate.valueState, candidate.validationStatus, candidate.ruleCode, candidate.ruleVersion, candidate.displayOrder]);
  }
  for (const candidate of bundle.attributeCandidates) {
    await client.query(`
      insert into material_import_normalized_attribute_candidates(
        normalization_run_id,normalized_row_id,attribute_code,attribute_name_snapshot,data_type,raw_value,
        normalized_value,unit_code,validation_status,transformation_rule_code,transformation_rule_version,display_order
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [numberValue(run.id), rowId, candidate.attributeCode, candidate.attributeName, candidate.dataType, jsonValue(candidate.rawValue), jsonValue(candidate.normalizedValue), candidate.unitCode, candidate.validationStatus, candidate.ruleCode, candidate.ruleVersion, candidate.displayOrder]);
  }
  for (const item of bundle.lineage) {
    await client.query(`
      insert into material_import_normalization_lineage(
        normalization_run_id,normalized_row_id,target_namespace,target_field_code,target_attribute_code,
        source_sheet_id,source_sheet_name,source_row_number,source_column_index,source_column_name,source_field_key,
        raw_value_summary,normalized_value_summary,mapping_id,mapping_digest,transformation_rule_code,
        transformation_rule_version,transformation_steps,lineage_ordinal
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [numberValue(run.id), rowId, item.targetNamespace, item.targetCode, item.attributeCode, mapping.sourceSheetId, mapping.sourceSheetName, source.rowNumber, item.sourceColumnIndex, item.sourceColumnName, item.sourceFieldKey, jsonValue(item.rawValueSummary), jsonValue(item.normalizedValueSummary), mapping.mappingId, mapping.mappingDigest, item.ruleCode, item.ruleVersion, jsonValue(item.steps), item.ordinal]);
  }
  for (const issue of bundle.issues) {
    await client.query(`
      insert into material_import_normalization_issues(
        normalization_run_id,normalized_row_id,issue_level,issue_code,issue_key,target_code,attribute_code,
        source_sheet_index,source_row_number,source_column_index,safe_message,safe_details,source_value_summary,rule_code
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [numberValue(run.id), rowId, issue.level, issue.code, issue.issueKey, issue.targetCode, issue.attributeCode, mapping.sourceSheetIndex, source.rowNumber, issue.sourceColumnIndex, issue.message, jsonValue(issue.safeDetails), jsonValue(issue.sourceValueSummary), issue.ruleCode]);
  }
}
