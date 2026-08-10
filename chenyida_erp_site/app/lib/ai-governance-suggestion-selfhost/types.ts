import type { PoolClient, QueryResultRow } from "pg";
import type { MaterialActor } from "../material-selfhost/types.ts";

export const AI_GOVERNANCE_CAPABILITIES = [
  "CLASSIFICATION",
  "ATTRIBUTE_EXTRACTION",
  "MATERIAL_MATCH",
  "SUPPLIER_MAPPING",
] as const;

export type AiGovernanceCapability = typeof AI_GOVERNANCE_CAPABILITIES[number];
export type AiSuggestionDisposition = "SUGGEST" | "ABSTAIN";
export type AiSuggestionActor = MaterialActor;

export type AiSuggestionMutationContext = Readonly<{
  actor: AiSuggestionActor;
  requestId: string;
  idempotencyKey: string;
  requestDigest: string;
  routeScope: string;
}>;

export type AiSuggestionEvidenceKind =
  | "GOVERNANCE_ROW"
  | "GOVERNANCE_SPEC"
  | "DETERMINISTIC_MATERIAL_CANDIDATE"
  | "DETERMINISTIC_ALTERNATIVE_CANDIDATE"
  | "NORMALIZATION_LINEAGE"
  | "MATERIAL_VERSION"
  | "SUPPLIER_VERSION"
  | "SUPPLIER_MAPPING_VERSION"
  | "RULE_TRACE";

export type AiSuggestionEvidenceCandidate = Readonly<{
  evidenceKind: AiSuggestionEvidenceKind;
  safeFieldPath: string;
  sourceDigest: string;
  locatorDigest: string;
  evidenceDigest: string;
  governanceRowId?: number;
  governanceSpecId?: number;
  governanceMaterialCandidateId?: number;
  governanceAlternativeCandidateId?: number;
  normalizationLineageId?: number;
  materialId?: number;
  supplierId?: number;
  supplierMappingVersionId?: number;
  observedVersionNo?: number;
  ruleTraceCode?: string;
  ruleTraceVersion?: string;
}>;

export type AiSuggestionItemCandidate = Readonly<{
  itemKind: AiGovernanceCapability;
  candidateRank: number;
  itemDigest: string;
  categoryId?: number;
  categoryVersionSnapshot?: number;
  categoryStatusSnapshot?: "ACTIVE";
  categoryDigest?: string;
  attributeDefinitionId?: number;
  attributeDefinitionVersionSnapshot?: number;
  attributeStatusSnapshot?: "ACTIVE";
  attributeValueType?: "TEXT" | "ENUM" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE";
  valueText?: string;
  valueInteger?: number;
  valueDecimal?: string;
  valueBoolean?: boolean;
  valueDate?: string;
  valueUnitCode?: string;
  attributeValueDigest?: string;
  materialId?: number;
  materialVersionSnapshot?: number;
  materialStatusSnapshot?: "ACTIVE";
  materialDigest?: string;
  supplierId?: number;
  supplierVersionSnapshot?: number;
  supplierStatusSnapshot?: "ACTIVE";
  supplierDigest?: string;
  supplierPartKeyDigest?: string;
  purchaseUnitId?: number;
  conversionNumerator?: string;
  conversionDenominator?: string;
  evidence: readonly AiSuggestionEvidenceCandidate[];
}>;

export type AiSuggestionCandidate = Readonly<{
  disposition: AiSuggestionDisposition;
  abstainReasonCode: string | null;
  items: readonly AiSuggestionItemCandidate[];
  payloadDigest: string;
}>;

export type AiSuggestionSourceSnapshot = Readonly<{
  batch: QueryResultRow;
  governanceRun: QueryResultRow;
  group: QueryResultRow;
  rows: readonly QueryResultRow[];
  specs: readonly QueryResultRow[];
  normalizationLineage: readonly QueryResultRow[];
  materialCandidates: readonly QueryResultRow[];
  categories: readonly QueryResultRow[];
  attributeDefinitions: readonly QueryResultRow[];
  suppliers: readonly QueryResultRow[];
  supplierMappings: readonly QueryResultRow[];
  serverNow: Date;
}>;

export type AiSuggestionDigests = Readonly<{
  groupInputDigest: string;
  inputDigest: string;
  contractDigest: string;
  runDigest: string;
}>;

export type AiSuggestionCreateResult = Readonly<{
  data: Record<string, unknown>;
  operationId: string;
  replayed: boolean;
  replaySource: "NONE" | "IDEMPOTENCY_KEY" | "RUN_DIGEST";
  statusCode: number;
}>;

export type AiSuggestionRepositoryPort = Readonly<{
  create(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    capability: AiGovernanceCapability,
    expectedGroupVersion: number,
    context: AiSuggestionMutationContext,
  ): Promise<AiSuggestionCreateResult>;
  list(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    actor: AiSuggestionActor,
    afterUid: string | null,
    limit: number,
  ): Promise<Readonly<{ items: readonly Record<string, unknown>[]; nextAfterUid: string | null }>>;
  one(
    batchId: number,
    governanceRunId: number,
    governanceGroupId: number,
    suggestionUid: string,
    actor: AiSuggestionActor,
  ): Promise<Record<string, unknown>>;
}>;

export type AiSuggestionQueryable = Pick<PoolClient, "query">;
