export const GOVERNANCE_CATEGORIES = [
  "RES",
  "CAP",
  "IND",
  "DIODE",
  "TRANS",
  "IC",
  "OSC",
  "CON",
  "MECH",
  "OTHER",
] as const;

export type GovernanceCategory = typeof GOVERNANCE_CATEGORIES[number];
export type GovernanceReadiness = "READY" | "REVIEW_REQUIRED" | "UNSUPPORTED";

export type GovernanceSourceInput = Readonly<{
  sourceKey: string;
  model?: string | null;
  manufacturerPartNumber?: string | null;
  supplierPartNumber?: string | null;
  originalPartNumber?: string | null;
  materialName?: string | null;
  specification?: string | null;
  description?: string | null;
  categoryHint?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  supplier?: string | null;
  quantity?: string | null;
  unit?: string | null;
  sourceBom?: string | null;
  upstreamIssues?: readonly GovernanceIssue[];
}>;

export type GovernanceComponent = Readonly<{
  code: string;
  role: "IDENTITY" | "PERFORMANCE" | "DESCRIPTIVE";
  normalizedValue: string;
  displayValue: string;
  canonicalUnit: string | null;
  evidence: readonly string[];
}>;

export type GovernanceIssue = Readonly<{
  level: "ERROR" | "WARNING";
  code: string;
  field: string;
  message: string;
  evidence: readonly string[];
}>;

export type GovernedSource = Readonly<{
  source: GovernanceSourceInput;
  category: GovernanceCategory;
  readiness: GovernanceReadiness;
  canonicalKey: string | null;
  canonicalSpecification: string | null;
  standardName: string;
  identityDigest: string | null;
  compatibilityDigest: string | null;
  components: readonly GovernanceComponent[];
  issues: readonly GovernanceIssue[];
  ruleVersion: string;
}>;

export type GovernanceGroup = Readonly<{
  groupKey: string;
  category: GovernanceCategory;
  readiness: GovernanceReadiness;
  canonicalKey: string | null;
  canonicalSpecification: string | null;
  standardName: string;
  identityDigest: string | null;
  compatibilityDigest: string | null;
  components: readonly GovernanceComponent[];
  sources: readonly GovernedSource[];
  mergeEvidence: readonly string[];
  supplierCandidates: readonly Readonly<{
    sourceKey: string;
    supplier: string | null;
    manufacturer: string | null;
    brand: string | null;
    originalPartNumber: string | null;
    manufacturerPartNumber: string | null;
    supplierPartNumber: string | null;
    priority: number;
    candidateKind: "PRIMARY_SOURCE" | "ALTERNATIVE_SOURCE";
  }>[];
}>;

export type GovernanceAlternativeSuggestion = Readonly<{
  mainGroupKey: string;
  alternativeGroupKey: string;
  category: GovernanceCategory;
  compatibilityDigest: string;
  evidence: readonly string[];
}>;

export type GovernanceBatchResult = Readonly<{
  ruleVersion: string;
  groups: readonly GovernanceGroup[];
  exceptions: readonly GovernedSource[];
  alternativeSuggestions: readonly GovernanceAlternativeSuggestion[];
}>;
