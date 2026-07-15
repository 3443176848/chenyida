import { parse } from "csv-parse/browser/esm";

import {
  columnReference,
  MATERIAL_IMPORT_PARSER_LIMITS,
  MaterialImportParserError,
  normalizeRawRow,
  type MaterialImportParsedRow,
  type MaterialImportParserWarning,
  type MaterialImportRawCell,
} from "./parser-model.ts";

export type MaterialImportCsvResult = Readonly<{
  encoding: "utf-8" | "gb18030";
  delimiter: "," | "\t" | ";";
  rowCount: number;
  sourceColumnMax: number;
  normalizedJsonBytes: number;
  decodedTextBytes: number;
  nonEmptyCells: number;
  warnings: readonly MaterialImportParserWarning[];
}>;

function delimiterScore(sample: string, delimiter: string): number {
  let quoted = false;
  let columns = 1;
  const widths: number[] = [];
  for (let index = 0; index < sample.length && widths.length < 20; index += 1) {
    const character = sample[index];
    if (character === '"') {
      if (quoted && sample[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) columns += 1;
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && sample[index + 1] === "\n") index += 1;
      if (columns > 1) widths.push(columns);
      columns = 1;
    }
  }
  if (quoted || widths.length === 0) return -1;
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  const consistency = Math.max(...counts.values());
  return consistency * 100 + Math.max(...widths);
}

export function detectCsvDelimiter(sample: string): "," | "\t" | ";" {
  const candidates = [",", "\t", ";"] as const;
  const scored = candidates.map((delimiter) => ({ delimiter, score: delimiterScore(sample, delimiter) })).sort((a, b) => b.score - a.score);
  if (scored[0].score < 0 || scored[0].score === scored[1].score) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_CSV", "无法可靠识别 CSV 分隔符");
  return scored[0].delimiter;
}

function decodeSample(bytes: Uint8Array): Readonly<{ encoding: "utf-8" | "gb18030"; sample: string }> {
  const bomOffset = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return { encoding: "utf-8", sample: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(bomOffset)) };
  } catch {
    try {
      return { encoding: "gb18030", sample: new TextDecoder("gb18030", { fatal: true }).decode(bytes) };
    } catch {
      throw new MaterialImportParserError("IMPORT_PARSE_UNSUPPORTED_ENCODING", "CSV 文本编码无效，仅支持 UTF-8 或 GB18030");
    }
  }
}

export async function parseMaterialImportCsv(
  stream: ReadableStream<Uint8Array>,
  onRow: (row: MaterialImportParsedRow) => Promise<void>,
  options: Readonly<{ signal?: AbortSignal; onProgress?: (rows: number) => Promise<void> }> = {},
): Promise<MaterialImportCsvResult> {
  const [sampleStream, parseStream] = stream.tee();
  const sampleReader = sampleStream.getReader();
  const sampleChunks: Uint8Array[] = [];
  let sampleBytes = 0;
  try {
    while (sampleBytes < 64 * 1024) {
      const { value, done } = await sampleReader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const selected = value.subarray(0, Math.min(value.byteLength, 64 * 1024 - sampleBytes));
      sampleChunks.push(selected.slice());
      sampleBytes += selected.byteLength;
    }
  } finally {
    await sampleReader.cancel().catch(() => undefined);
    sampleReader.releaseLock();
  }
  const sample = new Uint8Array(sampleBytes);
  let offset = 0;
  for (const chunk of sampleChunks) { sample.set(chunk, offset); offset += chunk.byteLength; }
  const decoded = decodeSample(sample);
  const delimiter = detectCsvDelimiter(decoded.sample);
  const decoder = new TextDecoder(decoded.encoding, { fatal: true, ignoreBOM: false });
  const parser = parse({ delimiter, bom: true, relax_column_count: true, skip_empty_lines: false, record_delimiter: ["\r\n", "\n", "\r"] });
  const warnings: MaterialImportParserWarning[] = [];
  let rowCount = 0;
  let expectedColumns: number | null = null;
  let sourceColumnMax = 0;
  let normalizedJsonBytes = 0;
  let decodedTextBytes = 0;
  let nonEmptyCells = 0;
  const records: string[][] = [];
  let parserEnded = false;
  let parserFailure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => { const pending = wake; wake = null; pending?.(); };
  parser.on("readable", () => {
    let record: string[] | null;
    while ((record = parser.read() as string[] | null) !== null) records.push(record);
    notify();
  });
  parser.on("end", () => { parserEnded = true; notify(); });
  parser.on("error", (error: Error) => { parserFailure = error; parserEnded = true; notify(); });

  const pump = (async () => {
    const reader = parseStream.getReader();
    try {
      while (true) {
        if (options.signal?.aborted) throw new MaterialImportParserError("IMPORT_PARSE_CANCELLED", "解析任务已取消");
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        decodedTextBytes += value.byteLength;
        if (decodedTextBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalDecodedTextBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "解码文本超过限制");
        parser.write(decoder.decode(value, { stream: true }));
      }
      parser.end(decoder.decode());
    } catch (error) {
      parserFailure = error instanceof Error ? error : new Error("CSV_PARSE_FAILED");
      parserEnded = true;
      notify();
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  })();

  try {
    while (!parserEnded || records.length) {
      if (!records.length) {
        await new Promise<void>((resolve) => { wake = resolve; });
        if (parserFailure) throw parserFailure;
        continue;
      }
      const record = records.shift()!;
      rowCount += 1;
      if (rowCount > MATERIAL_IMPORT_PARSER_LIMITS.maxRows) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "CSV 行数超过限制");
      const values = [...record];
      sourceColumnMax = Math.max(sourceColumnMax, values.length);
      if (values.length > MATERIAL_IMPORT_PARSER_LIMITS.maxColumns) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "CSV 列数超过限制");
      if (expectedColumns === null && values.some((value) => value.length > 0)) expectedColumns = values.length;
      else if (expectedColumns !== null && values.length !== expectedColumns && warnings.length < MATERIAL_IMPORT_PARSER_LIMITS.maxWarningDetails) {
        warnings.push({ code: "CSV_IRREGULAR_COLUMN_COUNT", message: "该行列数与前导数据不一致", sheetIndex: 0, rowNumber: rowCount });
      }
      const cells: MaterialImportRawCell[] = values.map((value, column) => {
        if (value.length > MATERIAL_IMPORT_PARSER_LIMITS.maxCellCharacters) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "CSV 单元格文本超过限制");
        if (value.length === 0) return { column_index: column, column_ref: columnReference(column), type: "EMPTY", source_type: "TEXT", raw_value: "", display: "", format_code: null };
        nonEmptyCells += 1;
        return { column_index: column, column_ref: columnReference(column), type: "TEXT", source_type: "TEXT", raw_value: value, display: value, format_code: null, formula_injection_risk: /^[=+\-@]/.test(value) };
      });
      if (nonEmptyCells > MATERIAL_IMPORT_PARSER_LIMITS.maxNonEmptyCells) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "非空单元格总数超过限制");
      const normalized = await normalizeRawRow(values.length, cells);
      normalizedJsonBytes += new TextEncoder().encode(normalized.json).byteLength;
      if (normalizedJsonBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalNormalizedJsonBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "规范化数据总量超过限制");
      await onRow({ sheetIndex: 0, sheetName: "__CSV__", rowNumber: rowCount, raw: normalized.raw, rawJson: normalized.json, rawRowHash: normalized.hash });
      if (rowCount % MATERIAL_IMPORT_PARSER_LIMITS.progressRows === 0) await options.onProgress?.(rowCount);
    }
    if (parserFailure) throw parserFailure;
    await pump;
  } catch (error) {
    await parseStream.cancel(error).catch(() => undefined);
    await pump.catch(() => undefined);
    if (error instanceof MaterialImportParserError) throw error;
    throw new MaterialImportParserError("IMPORT_PARSE_INVALID_CSV", "CSV 文件结构无效");
  }
  return { encoding: decoded.encoding, delimiter, rowCount, sourceColumnMax, normalizedJsonBytes, decodedTextBytes, nonEmptyCells, warnings };
}
