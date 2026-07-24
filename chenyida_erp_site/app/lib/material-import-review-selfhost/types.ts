import type { MaterialActor } from "../material-selfhost/types.ts";

export const REVIEW_SESSION_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "READY_TO_FINALIZE",
  "FINALIZING",
  "FINALIZED",
  "FINALIZE_FAILED",
  "CANCELLED",
] as const;

export const REVIEW_DISPOSITIONS = [
  "PENDING",
  "KEEP",
  "EXCLUDE",
  "BIND_EXISTING",
  "CREATE_DRAFT",
] as const;

export type ReviewSessionStatus = typeof REVIEW_SESSION_STATUSES[number];
export type ReviewDisposition = typeof REVIEW_DISPOSITIONS[number];
export type ReviewActor = MaterialActor;
export type OverrideSemantics = "SET" | "CLEAR" | "REVERT";
export type ReviewIssueResolution =
  | "UNRESOLVED"
  | "RESOLVED_BY_OVERRIDE"
  | "WARNING_ACKNOWLEDGED"
  | "EXCLUDED"
  | "BLOCKING";

export type ReviewMutationContext = Readonly<{
  actor: ReviewActor;
  requestId: string;
  idempotencyKey: string;
  requestDigest: string;
  routeScope: string;
}>;

export type ReviewSessionRow = Record<string, unknown> & Readonly<{
  id: string | number;
  batch_id: string | number;
  normalization_run_id: string | number;
  review_version: number;
  status: ReviewSessionStatus;
  expected_version: number;
}>;

export type ReviewRow = Record<string, unknown> & Readonly<{
  id: string | number;
  review_session_id: string | number;
  normalized_row_id: string | number;
  disposition: ReviewDisposition;
  expected_version: number;
}>;

export type ReviewFieldDefinition = Readonly<{
  code: string;
  dataType: "TEXT" | "INTEGER" | "BOOLEAN" | "ENUM";
  required: boolean;
  maximumLength?: number;
  enumValues?: readonly string[];
}>;

export type ReviewAttributeDefinition = Readonly<{
  code: string;
  name: string;
  dataType: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "ENUM";
  required: boolean;
  enabled: boolean;
  maximumLength?: number;
  enumValues?: readonly string[];
  categoryIds: readonly number[];
  unitCode?: string | null;
}>;

export type EffectiveReviewValues = Readonly<{
  fields: Readonly<Record<string, unknown>>;
  attributes: Readonly<Record<string, Readonly<{ value: unknown; unit: string | null }>>>;
}>;
