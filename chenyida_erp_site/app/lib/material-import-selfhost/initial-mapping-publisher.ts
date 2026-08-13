import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import {
  analyzeAdaptiveImportStructure,
  MATERIAL_IMPORT_ADAPTIVE_ALGORITHM_VERSION,
  MATERIAL_IMPORT_HEADER_SCAN_ROWS,
  type AdaptiveImportSheet,
} from "../material-import/adaptive-import.ts";
import type { MaterialImportRawRow } from "../material-import/parser-model.ts";
import { mappingFailure } from "./errors.ts";
import {
  columnReference,
  mappingContentDigest,
  normalizeSourceHeader,
  sourceStructureDigest,
} from "./rules.ts";
import { PostgresMappingCatalog } from "./catalog.ts";
import {
  adaptiveSuggestedItems,
  insertItems,
  sourceColumnCount,
  sourceFieldsFromRaw,
} from "./service.ts";
import type { MappingItemInput, SourceField } from "./types.ts";

type BatchRow = Record<string, unknown>;
type InitialMappingSheet = Readonly<{
  sheetIndex: number;
  sheetName: string;
  rowCount: number;
  sourceColumnMax: number;
  mergedRanges: readonly string[];
}>;

export async function publishInitialMapping(
  client: PoolClient,
  input: Readonly<{
    batchId: number;
    parseRunId: number;
    requestId: string;
    actor: string;
    rows: readonly Readonly<{ sheetIndex: number; sheetName: string; rowNumber: number; raw: unknown }>[];
    sheets?: readonly InitialMappingSheet[];
  }>,
): Promise<Readonly<{ mappingId: number; sourceStructureDigest: string }>> {
  const batchResult = await client.query("select * from material_import_batches where id=$1 for update", [input.batchId]);
  const batch = batchResult.rows[0] as BatchRow | undefined;
  if (!batch) mappingFailure("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  const catalog = await new PostgresMappingCatalog(client).snapshot();
  const sourceSheets: readonly InitialMappingSheet[] = input.sheets?.length
    ? input.sheets
    : [...new Set(input.rows.map((row) => row.sheetIndex))].sort((a, b) => a - b).map((sheetIndex) => {
      const rows = input.rows.filter((row) => row.sheetIndex === sheetIndex);
      return Object.freeze({
        sheetIndex,
        sheetName: rows[0]?.sheetName ?? `Sheet${sheetIndex + 1}`,
        rowCount: rows.length,
        sourceColumnMax: Math.max(0, ...rows.map((row) => sourceColumnCount(row.raw))),
        mergedRanges: Object.freeze([]),
      });
    });
  const sheets: AdaptiveImportSheet[] = sourceSheets.map((sheet) => {
    const rows = input.rows.filter((row) => row.sheetIndex === sheet.sheetIndex);
    const analysisRows = rows.filter((row) => row.rowNumber <= MATERIAL_IMPORT_HEADER_SCAN_ROWS);
    return Object.freeze({
      sheetIndex: sheet.sheetIndex,
      sheetName: sheet.sheetName,
      rowCount: sheet.rowCount,
      sourceColumnMax: sheet.sourceColumnMax,
      mergedRanges: Object.freeze([...sheet.mergedRanges]),
      rows: Object.freeze(analysisRows.map((row) => Object.freeze({ rowNumber: row.rowNumber, raw: row.raw as MaterialImportRawRow }))),
    });
  });
  const structure = analyzeAdaptiveImportStructure(sheets);
  const selectedSheetIndex = structure.selectedSheetIndex ?? structure.sheets[0]?.sheetIndex ?? sheets[0]?.sheetIndex ?? 0;
  const selectedRows = input.rows.filter((row) => row.sheetIndex === selectedSheetIndex);
  const selectedSheet = sheets.find((sheet) => sheet.sheetIndex === selectedSheetIndex);
  const sheetName = selectedRows[0]?.sheetName ?? selectedSheet?.sheetName ?? "__CSV__";
  const columnCount = selectedSheet?.sourceColumnMax ?? Math.max(0, ...selectedRows.map((row) => sourceColumnCount(row.raw)));
  const selectedAnalysis = structure.sheets.find((sheet) => sheet.sheetIndex === selectedSheetIndex);
  const selectedHeader = selectedAnalysis?.selectedHeader ?? null;
  const fields: readonly SourceField[] = selectedHeader
    ? Object.freeze(selectedHeader.columns.map((column) => Object.freeze({
      column_index: column.columnIndex,
      column_ref: columnReference(column.columnIndex),
      source_header: column.headerPath,
      normalized_header: normalizeSourceHeader(column.headerPath, column.columnIndex),
    })))
    : sourceFieldsFromRaw(null, columnCount);
  const headerMode = selectedHeader ? "SINGLE_ROW" as const : "NO_HEADER" as const;
  const headerRowNumber = selectedHeader?.headerEndRow ?? null;
  const structureDigest = sourceStructureDigest({
    sourceKind: String(batch.source_kind),
    sheetName,
    sheetIndex: selectedSheetIndex,
    headerMode,
    headerRowNumber,
    fields,
  });
  const items = selectedHeader ? adaptiveSuggestedItems(selectedHeader, catalog.targets) : Object.freeze([] as MappingItemInput[]);
  const mappingDigest = mappingContentDigest({
    selectedSheetIndex,
    headerMode,
    headerRowNumber,
    sourceStructureDigest: structureDigest,
    metadataDigest: catalog.metadataDigest,
    items,
  });
  const previous = await client.query("select max(mapping_version)::int version from material_import_mappings where batch_id=$1", [input.batchId]);
  const created = await client.query(`
    insert into material_import_mappings (
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
      header_mode,header_row_number,header_start_row_number,header_end_row_number,data_start_row_number,
      structure_confidence,structure_status,adaptive_algorithm_version,
      source_structure_digest,source_fields,metadata_digest,target_catalog_version,
      mapping_digest,status,created_by,updated_by,request_id
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'material-import-mapping-metadata-v1',$19,'DRAFT',$20,$20,$21)
    returning id
  `, [
    randomUUID(), input.batchId, input.parseRunId, Number(previous.rows[0]?.version || 0) + 1,
    String(batch.source_kind), selectedSheetIndex, sheetName, headerMode,
    headerRowNumber, selectedHeader?.headerStartRow ?? headerRowNumber, selectedHeader?.headerEndRow ?? headerRowNumber,
    selectedHeader?.dataStartRow ?? null, selectedHeader ? structure.confidence : null,
    selectedHeader ? structure.status : null, selectedHeader ? MATERIAL_IMPORT_ADAPTIVE_ALGORITHM_VERSION : null,
    structureDigest, JSON.stringify(fields), catalog.metadataDigest, mappingDigest, input.actor, input.requestId,
  ]);
  const mappingId = Number(created.rows[0].id);
  await insertItems(client, mappingId, items);
  for (const analysis of structure.sheets) {
    const seenRows = new Set<number>();
    for (const [index, candidate] of analysis.headerCandidates.entries()) {
      if (seenRows.has(candidate.headerStartRow)) continue;
      seenRows.add(candidate.headerStartRow);
      await client.query(`
        insert into material_import_header_suggestions(
          parse_run_id,sheet_index,row_number,rank,score,reason_codes,algorithm_version,metadata_digest
        ) values($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict(parse_run_id,sheet_index,row_number,algorithm_version) do nothing
      `, [input.parseRunId, analysis.sheetIndex, candidate.headerStartRow, index + 1, candidate.score, JSON.stringify(candidate.reasonCodes), MATERIAL_IMPORT_ADAPTIVE_ALGORITHM_VERSION, catalog.metadataDigest]);
      if (seenRows.size >= 5) break;
    }
  }
  return { mappingId, sourceStructureDigest: structureDigest };
}
