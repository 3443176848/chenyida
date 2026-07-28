import {
  MATERIAL_ATTRIBUTES as MATERIAL_ATTRIBUTES_V1,
  MATERIAL_CATEGORIES as MATERIAL_CATEGORIES_V1,
  MATERIAL_CATEGORY_BINDINGS as MATERIAL_CATEGORY_BINDINGS_V1,
  MATERIAL_CATEGORY_CODE_PATTERN as MATERIAL_CATEGORY_CODE_PATTERN_V1,
} from "./material-category-v1.ts";
import type { AttributeSeed, BindingSeed, CategorySeed } from "./material-category-v1.ts";

export type { AttributeSeed, BindingSeed, CategorySeed } from "./material-category-v1.ts";

export const MATERIAL_CATEGORY_SEED_VERSION = "material-category-v2";
export const MATERIAL_CATEGORY_CODE_PATTERN = MATERIAL_CATEGORY_CODE_PATTERN_V1;

const category = (
  code: string,
  name: string,
  parentCode: string | null,
  level: number,
  sortOrder: number,
): CategorySeed => ({ code, name, parentCode, level, sortOrder });

export const MATERIAL_CATEGORIES: readonly CategorySeed[] = [
  ...MATERIAL_CATEGORIES_V1,
  category("IC_SOT", "SOT/SC 封装 IC", "SEMI_IC", 4, 30),
  category("IC_SMD_OTHER", "其他贴片封装 IC", "SEMI_IC", 4, 90),
  category("SEMI_TRANS", "三极管/晶体管", "EL_SEMICONDUCTOR", 3, 40),
  category("TRANS_SMD", "贴片三极管/晶体管", "SEMI_TRANS", 4, 10),
  category("PASS_OSCILLATOR", "晶振/振荡器", "EL_PASSIVE", 3, 40),
  category("OSC_SMD", "贴片晶振", "PASS_OSCILLATOR", 4, 10),
];

export const MATERIAL_ATTRIBUTES: readonly AttributeSeed[] = [
  ...MATERIAL_ATTRIBUTES_V1.map((item): AttributeSeed => {
    if (item.code === "RESISTANCE" || item.code === "POWER") return { ...item, scale: 6 };
    if (item.code === "CAPACITANCE") return { ...item, scale: 18 };
    if (item.code === "INDUCTANCE") return { ...item, scale: 12 };
    if (item.code === "RATED_VOLTAGE" || item.code === "PITCH") return { ...item, scale: 6 };
    return item;
  }),
  { code: "DIELECTRIC", name: "介质", type: "TEXT" },
  { code: "RATED_CURRENT", name: "额定电流", type: "DECIMAL", unit: "A", scale: 6 },
  { code: "STRUCTURE", name: "结构", type: "TEXT" },
  { code: "FREQUENCY", name: "频率", type: "DECIMAL", unit: "Hz", scale: 0 },
];

const binding = (
  categoryCode: string,
  attributeCodes: readonly string[],
  requiredCodes: readonly string[],
): BindingSeed => ({ categoryCode, attributeCodes, requiredCodes });

const bindingOverrides: Readonly<Record<string, BindingSeed>> = Object.freeze({
  RES_CHIP: binding(
    "RES_CHIP",
    ["RESISTANCE", "TOLERANCE", "POWER", "PACKAGE", "BRAND", "MPN"],
    ["PACKAGE", "RESISTANCE", "TOLERANCE", "POWER"],
  ),
  CAP_CHIP: binding(
    "CAP_CHIP",
    ["CAPACITANCE", "TOLERANCE", "RATED_VOLTAGE", "DIELECTRIC", "PACKAGE", "BRAND", "MPN"],
    ["PACKAGE", "CAPACITANCE", "RATED_VOLTAGE", "DIELECTRIC", "TOLERANCE"],
  ),
  IND_CHIP: binding(
    "IND_CHIP",
    ["INDUCTANCE", "TOLERANCE", "RATED_CURRENT", "POWER", "PACKAGE", "BRAND", "MPN"],
    ["PACKAGE", "INDUCTANCE", "RATED_CURRENT", "TOLERANCE"],
  ),
  CONN_BOARD_STD: binding(
    "CONN_BOARD_STD",
    ["BRAND", "MPN", "PIN_COUNT", "PITCH", "STRUCTURE", "PACKAGE"],
    ["BRAND", "MPN", "PIN_COUNT", "PITCH", "STRUCTURE"],
  ),
  CONN_FPC_STD: binding(
    "CONN_FPC_STD",
    ["BRAND", "MPN", "PIN_COUNT", "PITCH", "STRUCTURE", "PACKAGE"],
    ["BRAND", "MPN", "PIN_COUNT", "PITCH", "STRUCTURE"],
  ),
  IC_BGA: binding(
    "IC_BGA",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
  IC_QFN: binding(
    "IC_QFN",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
  DIODE_SMD: binding(
    "DIODE_SMD",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
  MOS_SMD: binding(
    "MOS_SMD",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
});

export const MATERIAL_CATEGORY_BINDINGS: readonly BindingSeed[] = [
  ...MATERIAL_CATEGORY_BINDINGS_V1.map((item) => bindingOverrides[item.categoryCode] ?? binding(
    item.categoryCode,
    [...item.attributeCodes],
    [...item.requiredCodes],
  )),
  binding(
    "IC_SOT",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
  binding(
    "IC_SMD_OTHER",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
  binding(
    "TRANS_SMD",
    ["BRAND", "MPN", "PACKAGE", "PIN_COUNT", "RATED_VOLTAGE"],
    ["MPN", "PACKAGE"],
  ),
  binding(
    "OSC_SMD",
    ["BRAND", "MPN", "PACKAGE", "FREQUENCY"],
    ["MPN", "PACKAGE", "FREQUENCY"],
  ),
];

export function validateMaterialCategorySeed(): void {
  const duplicate = (codes: readonly string[], kind: string): void => {
    const seen = new Set<string>();
    for (const code of codes) {
      if (!code || !MATERIAL_CATEGORY_CODE_PATTERN.test(code)) {
        throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] invalid ${kind} code: ${code || "<empty>"}`);
      }
      if (seen.has(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] duplicate ${kind} code: ${code}`);
      seen.add(code);
    }
  };

  duplicate(MATERIAL_CATEGORIES.map((item) => item.code), "category");
  duplicate(MATERIAL_ATTRIBUTES.map((item) => item.code), "attribute");
  duplicate(MATERIAL_CATEGORY_BINDINGS.map((item) => item.categoryCode), "binding");

  const categories = new Map(MATERIAL_CATEGORIES.map((item) => [item.code, item]));
  const attributes = new Set(MATERIAL_ATTRIBUTES.map((item) => item.code));
  const declaredCategories = new Set<string>();
  for (const item of MATERIAL_CATEGORIES) {
    if (item.level < 1 || item.level > 4) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] invalid level: ${item.code}`);
    if (item.level === 1 ? item.parentCode !== null : !item.parentCode) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] invalid parent: ${item.code}`);
    if (item.parentCode && categories.get(item.parentCode)?.level !== item.level - 1) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] non-contiguous parent: ${item.code}`);
    if (item.parentCode && !declaredCategories.has(item.parentCode)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] parent must precede child: ${item.code}`);
    declaredCategories.add(item.code);
  }

  const leafCodes = new Set(MATERIAL_CATEGORIES.filter((item) => item.level === 4).map((item) => item.code));
  for (const item of MATERIAL_CATEGORY_BINDINGS) {
    if (!leafCodes.has(item.categoryCode)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] binding is not a level-4 leaf: ${item.categoryCode}`);
    duplicate(item.attributeCodes, `binding attribute for ${item.categoryCode}`);
    for (const code of item.attributeCodes) {
      if (!attributes.has(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] unknown attribute ${code} for ${item.categoryCode}`);
    }
    for (const code of item.requiredCodes) {
      if (!item.attributeCodes.includes(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] required attribute is not bound: ${item.categoryCode}/${code}`);
    }
  }
  for (const code of leafCodes) {
    if (!MATERIAL_CATEGORY_BINDINGS.some((item) => item.categoryCode === code)) {
      throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] leaf has no binding: ${code}`);
    }
  }
}
