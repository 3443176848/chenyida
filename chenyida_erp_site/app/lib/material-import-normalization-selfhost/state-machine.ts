import { normalizationFailure } from "./errors.ts";
import type { NormalizationRunStatus } from "./types.ts";

const TRANSITIONS: Readonly<Record<NormalizationRunStatus, readonly NormalizationRunStatus[]>> = Object.freeze({
  QUEUED: Object.freeze<NormalizationRunStatus[]>(["RUNNING", "CANCELLED", "FAILED"]),
  RUNNING: Object.freeze<NormalizationRunStatus[]>(["PUBLISHING", "CANCEL_REQUESTED", "FAILED"]),
  PUBLISHING: Object.freeze<NormalizationRunStatus[]>(["SUCCEEDED", "CANCEL_REQUESTED", "FAILED"]),
  SUCCEEDED: Object.freeze<NormalizationRunStatus[]>(["SUPERSEDED"]),
  SUPERSEDED: Object.freeze<NormalizationRunStatus[]>([]),
  FAILED: Object.freeze<NormalizationRunStatus[]>(["QUEUED"]),
  CANCEL_REQUESTED: Object.freeze<NormalizationRunStatus[]>(["CANCELLED", "FAILED"]),
  CANCELLED: Object.freeze<NormalizationRunStatus[]>([]),
});

export function assertNormalizationTransition(from: NormalizationRunStatus, to: NormalizationRunStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    normalizationFailure("IMPORT_NORMALIZATION_STATUS_CONFLICT", `不能从 ${from} 转换为 ${to}`, 409);
  }
}

export function isPublishedStatus(status: string): boolean {
  return status === "SUCCEEDED" || status === "SUPERSEDED";
}
