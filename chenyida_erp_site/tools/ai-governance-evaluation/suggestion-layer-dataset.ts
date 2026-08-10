import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256Hex, sortedUnique } from "./canonical.ts";
import {
  APPROVED_DATASET_ROOT,
  assertControlledPath,
  datasetStatistics,
  parseDatasetManifest,
  parseEvaluationSample,
  scanProhibitedData,
} from "./schema.ts";
import { CAPABILITIES } from "./types.ts";
import type {
  DatasetManifest,
  EvaluationSample,
  EvaluationSplit,
  ManifestSplit,
} from "./types.ts";

export const SUGGESTION_LAYER_DATASET_NAME = "material-v1";
export const FROZEN_DATASET_ID = "synthetic-material-governance-v1";
export const FROZEN_DATASET_VERSION = "1.0.0";
export const FROZEN_DATASET_DIGEST = "4bde669dd59a3cbb239fcd4f9b62f7e8eccfd2b6921d45cb0545503ba4a34adb";
export const FROZEN_MANIFEST_FILE_SHA256 = "f40f28c06e6e52af7ea6449d49abc17d44f938d13089b06f6f50c82bf93983e3";
export const FROZEN_CALIBRATION_FILE_SHA256 = "d251271991566a877ee721392e39c9e0c8be1afcede47fa868aeb0376133ed95";
export const FROZEN_HOLDOUT_FILE_SHA256 = "73e3d84337609d87e0b554fefb531c25c1f39a5ad74998500b7ee21bf633bde3";

export type SuggestionDatasetSelection = "calibration" | "all";

export type LoadedSuggestionLayerDataset = Readonly<{
  directory: string;
  manifest: DatasetManifest;
  manifest_file_sha256: string;
  selection: SuggestionDatasetSelection;
  opened_files: readonly Readonly<{ file: string; sha256: string; sample_count?: number }>[];
  samples: Readonly<Partial<Record<EvaluationSplit, readonly EvaluationSample[]>>>;
  prohibited_data_hits: readonly string[];
}>;

function fail(code: string): never {
  throw new Error(code);
}

async function readRegularFile(root: string, file: string, maxBytes: number): Promise<Buffer> {
  await assertControlledPath(root, file, true);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) fail("SUGGESTION_DATASET_FILE_INVALID");
  return readFile(file);
}

function parseJsonDocument(content: Buffer): unknown {
  try {
    return JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    fail("SUGGESTION_DATASET_MANIFEST_JSON_INVALID");
  }
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    fail("SUGGESTION_DATASET_JSONL_INVALID");
  }
}

async function loadSelectedSplit(
  directory: string,
  split: EvaluationSplit,
  manifest: ManifestSplit,
): Promise<readonly EvaluationSample[]> {
  const file = path.join(directory, manifest.file);
  const content = await readRegularFile(directory, file, 16 * 1024 * 1024);
  if (sha256Hex(content) !== manifest.sha256) fail("SUGGESTION_DATASET_SPLIT_DIGEST_MISMATCH");
  const raw = content.toString("utf8");
  if (!raw.endsWith("\n") || raw.includes("\r") || raw.split("\n").slice(0, -1).some((line) => line.length === 0)) {
    fail("SUGGESTION_DATASET_JSONL_FORMAT_INVALID");
  }
  const samples = raw.split("\n").slice(0, -1).map((line) => parseEvaluationSample(parseJsonLine(line)));
  if (samples.some((sample) => sample.split !== split)) fail("SUGGESTION_DATASET_SPLIT_LABEL_MISMATCH");
  const ids = samples.map((sample) => sample.sample_id);
  if (canonicalJson(ids) !== canonicalJson(sortedUnique(ids))) fail("SUGGESTION_DATASET_SAMPLE_ORDER_OR_DUPLICATE");
  if (samples.length !== manifest.sample_count) fail("SUGGESTION_DATASET_SAMPLE_COUNT_MISMATCH");
  if (canonicalJson(datasetStatistics(samples)) !== canonicalJson(manifest.statistics)) {
    fail("SUGGESTION_DATASET_STATISTICS_MISMATCH");
  }
  if (samples.length < 32) fail("SUGGESTION_DATASET_SPLIT_TOO_SMALL");
  for (const capability of CAPABILITIES) {
    if (samples.filter((sample) => sample.capability === capability).length < 8) {
      fail("SUGGESTION_DATASET_CAPABILITY_STRATUM_TOO_SMALL");
    }
  }
  return Object.freeze(samples);
}

export async function loadSuggestionLayerDatasetDirectory(
  directory: string,
  approvedRoot: string,
  selection: SuggestionDatasetSelection,
): Promise<LoadedSuggestionLayerDataset> {
  if (selection !== "calibration" && selection !== "all") fail("SUGGESTION_DATASET_SELECTION_INVALID");
  const resolvedRoot = path.resolve(approvedRoot);
  const resolvedDirectory = path.resolve(directory);
  await assertControlledPath(resolvedRoot, resolvedDirectory, true);
  const directoryStat = await lstat(resolvedDirectory);
  if (!directoryStat.isDirectory()) fail("SUGGESTION_DATASET_DIRECTORY_INVALID");

  const manifestPath = path.join(resolvedDirectory, "manifest.json");
  const manifestContent = await readRegularFile(resolvedDirectory, manifestPath, 1024 * 1024);
  const manifestFileSha256 = sha256Hex(manifestContent);
  const manifest = parseDatasetManifest(parseJsonDocument(manifestContent));
  const calibration = await loadSelectedSplit(resolvedDirectory, "calibration", manifest.splits.calibration);
  const samples: Partial<Record<EvaluationSplit, readonly EvaluationSample[]>> = { calibration };
  const openedFiles: Array<Readonly<{ file: string; sha256: string; sample_count?: number }>> = [
    Object.freeze({ file: "manifest.json", sha256: manifestFileSha256 }),
    Object.freeze({
      file: manifest.splits.calibration.file,
      sha256: manifest.splits.calibration.sha256,
      sample_count: calibration.length,
    }),
  ];

  if (selection === "all") {
    const holdout = await loadSelectedSplit(resolvedDirectory, "holdout", manifest.splits.holdout);
    const ids = [...calibration, ...holdout].map((sample) => sample.sample_id);
    if (new Set(ids).size !== ids.length) fail("SUGGESTION_DATASET_CROSS_SPLIT_ID_DUPLICATE");
    samples.holdout = holdout;
    openedFiles.push(Object.freeze({
      file: manifest.splits.holdout.file,
      sha256: manifest.splits.holdout.sha256,
      sample_count: holdout.length,
    }));
  }

  const selectedSamples = selection === "all"
    ? [...calibration, ...(samples.holdout ?? [])]
    : calibration;
  const prohibitedDataHits = sortedUnique(selectedSamples.flatMap((sample) =>
    scanProhibitedData(sample).map((code) => `${sample.sample_id}:${code}`)));

  return Object.freeze({
    directory: resolvedDirectory,
    manifest,
    manifest_file_sha256: manifestFileSha256,
    selection,
    opened_files: Object.freeze(openedFiles),
    samples: Object.freeze(samples),
    prohibited_data_hits: prohibitedDataHits,
  });
}

function assertFrozenIdentity(dataset: LoadedSuggestionLayerDataset): void {
  if (dataset.manifest_file_sha256 !== FROZEN_MANIFEST_FILE_SHA256) fail("SUGGESTION_DATASET_MANIFEST_FILE_IDENTITY_MISMATCH");
  if (dataset.manifest.dataset_id !== FROZEN_DATASET_ID || dataset.manifest.version !== FROZEN_DATASET_VERSION) {
    fail("SUGGESTION_DATASET_IDENTITY_MISMATCH");
  }
  if (dataset.manifest.dataset_digest !== FROZEN_DATASET_DIGEST) fail("SUGGESTION_DATASET_DIGEST_MISMATCH");
  if (dataset.manifest.splits.calibration.sha256 !== FROZEN_CALIBRATION_FILE_SHA256) {
    fail("SUGGESTION_DATASET_CALIBRATION_IDENTITY_MISMATCH");
  }
  if (dataset.manifest.splits.holdout.sha256 !== FROZEN_HOLDOUT_FILE_SHA256) {
    fail("SUGGESTION_DATASET_HOLDOUT_IDENTITY_MISMATCH");
  }
}

export async function loadApprovedSuggestionLayerDataset(
  datasetName: string,
  selection: SuggestionDatasetSelection,
): Promise<LoadedSuggestionLayerDataset> {
  if (datasetName !== SUGGESTION_LAYER_DATASET_NAME) fail("SUGGESTION_DATASET_NAME_NOT_APPROVED");
  const dataset = await loadSuggestionLayerDatasetDirectory(
    path.join(APPROVED_DATASET_ROOT, datasetName),
    APPROVED_DATASET_ROOT,
    selection,
  );
  assertFrozenIdentity(dataset);
  return dataset;
}
