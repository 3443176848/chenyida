export const MATERIAL_UNIT_POLICY_VERSION = "material-unit-policy-v1";

const UNIT_FAMILIES: readonly (readonly string[])[] = [["mm", "um"]];

export function compatibleMaterialUnits(canonicalUnit: string): readonly string[] {
  if (!canonicalUnit) return [];
  return UNIT_FAMILIES.find((units) => units.includes(canonicalUnit)) ?? [canonicalUnit];
}
