import {
  COMPATIBILITY_REVIEW_PROFILES,
  MATERIAL_GOVERNANCE_RULE_VERSION,
} from "./config.ts";
import type { CompatibilityReviewProfile } from "./config.ts";
import type { GovernanceComponent, GovernanceGroup, GovernedSource } from "./types.ts";

export type CompatibilityTarget = Readonly<{
  category: GovernanceGroup["category"];
  components: readonly GovernanceComponent[];
}>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function componentIdentity(component: GovernanceComponent): string {
  return `${component.normalizedValue}\u0000${component.canonicalUnit ?? ""}`;
}

export function compatibilityAnchorKey(target: CompatibilityTarget, profile: CompatibilityReviewProfile): string | null {
  if (profile.category !== target.category) return null;
  const components = new Map(target.components.map((component) => [component.code, component]));
  const anchors = profile.anchorComponents.map((code) => components.get(code));
  if (anchors.some((component) => !component)) return null;
  return canonicalJson({
    profile: profile.profileCode,
    category: target.category,
    anchors: profile.anchorComponents.map((code, index) => ({ code, value: componentIdentity(anchors[index]!) })),
  });
}

export function compatibilityProfileFor(material: GovernedSource): CompatibilityReviewProfile | null {
  const actualErrors = material.issues
    .filter((issue) => issue.level === "ERROR")
    .map((issue) => issue.code)
    .sort();
  return COMPATIBILITY_REVIEW_PROFILES.find((profile) => {
    if (profile.category !== material.category) return false;
    const expected = [...profile.blockingIssueCodes].sort();
    return actualErrors.length === expected.length && actualErrors.every((code, index) => code === expected[index]);
  }) ?? null;
}

export function compatibilityReviewEvidence(
  material: GovernedSource,
  target: CompatibilityTarget,
): readonly string[] | null {
  const profile = compatibilityProfileFor(material);
  if (!profile || material.category !== target.category || material.readiness !== "REVIEW_REQUIRED") return null;
  if (compatibilityAnchorKey(material, profile) !== compatibilityAnchorKey(target, profile)) return null;
  const materialComponents = new Map(material.components.map((component) => [component.code, component]));
  const targetComponents = new Map(target.components.map((component) => [component.code, component]));
  for (const code of profile.anchorComponents) {
    const left = materialComponents.get(code);
    const right = targetComponents.get(code);
    if (!left || !right || componentIdentity(left) !== componentIdentity(right)) return null;
  }
  return Object.freeze([
    "CATEGORY_EQUAL",
    "ACTIVE_MATERIAL_IDENTITY_REVIEW_REQUIRED",
    "PARTIAL_SPECIFICATIONS_EQUAL",
    `COMPATIBILITY_PROFILE_${profile.profileCode}`,
    ...profile.anchorComponents.map((code) => `${code}_EQUAL`),
    ...[...profile.blockingIssueCodes].sort(),
    `RULE_VERSION_${MATERIAL_GOVERNANCE_RULE_VERSION}`,
  ]);
}
