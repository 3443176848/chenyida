export const MATERIAL_CATEGORY_SEED_VERSION = "material-category-v1";

export type CategorySeed = Readonly<{ code: string; name: string; parentCode: string | null; level: number; sortOrder: number }>;
export type AttributeSeed = Readonly<{ code: string; name: string; type: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "ENUM"; unit?: string; scale?: number; values?: readonly string[] }>;
export type BindingSeed = Readonly<{ categoryCode: string; attributeCodes: readonly string[]; requiredCodes: readonly string[] }>;

const category = (code: string, name: string, parentCode: string | null, level: number, sortOrder: number): CategorySeed => ({ code, name, parentCode, level, sortOrder });

export const MATERIAL_CATEGORIES: readonly CategorySeed[] = [
  category("PCB_FPC", "PCB/FPC材料", null, 1, 10),
  category("PCB_SUBSTRATE", "基材", "PCB_FPC", 2, 10), category("PCB_COPPER_FOIL", "铜箔", "PCB_FPC", 2, 20),
  category("PCB_PP", "PP", "PCB_FPC", 2, 30), category("PCB_COVERLAY", "Coverlay", "PCB_FPC", 2, 40),
  category("PCB_STIFFENER", "补强", "PCB_FPC", 2, 50), category("PCB_ADHESIVE", "胶类", "PCB_FPC", 2, 60),
  category("SUB_FR4", "FR4", "PCB_SUBSTRATE", 3, 10), category("SUB_PI", "PI", "PCB_SUBSTRATE", 3, 20), category("SUB_CCL", "CCL", "PCB_SUBSTRATE", 3, 30),
  category("FR4_STANDARD", "普通FR4", "SUB_FR4", 4, 10), category("FR4_HIGH_TG", "高TG FR4", "SUB_FR4", 4, 20), category("FR4_HALOGEN_FREE", "无卤FR4", "SUB_FR4", 4, 30),
  category("PI_FILM", "PI薄膜", "SUB_PI", 4, 10), category("PI_CCL", "覆铜PI", "SUB_PI", 4, 20),
  category("CCL_SINGLE", "单面覆铜板", "SUB_CCL", 4, 10), category("CCL_DOUBLE", "双面覆铜板", "SUB_CCL", 4, 20),
  category("FOIL_ED", "电解铜箔", "PCB_COPPER_FOIL", 3, 10), category("FOIL_RA", "压延铜箔", "PCB_COPPER_FOIL", 3, 20),
  category("FOIL_ED_STD", "标准电解铜箔", "FOIL_ED", 4, 10), category("FOIL_RA_STD", "标准压延铜箔", "FOIL_RA", 4, 10),
  category("PP_FR4", "FR4半固化片", "PCB_PP", 3, 10), category("PP_FR4_STD", "标准FR4 PP", "PP_FR4", 4, 10),
  category("COVERLAY_PI", "PI Coverlay", "PCB_COVERLAY", 3, 10), category("COVERLAY_PI_STD", "标准PI Coverlay", "COVERLAY_PI", 4, 10),
  category("STIFFENER_PI", "PI补强", "PCB_STIFFENER", 3, 10), category("STIFFENER_STEEL", "钢片补强", "PCB_STIFFENER", 3, 20), category("STIFFENER_FR4", "FR4补强", "PCB_STIFFENER", 3, 30),
  category("STIFFENER_PI_STD", "标准PI补强", "STIFFENER_PI", 4, 10), category("STIFFENER_STEEL_STD", "标准钢片补强", "STIFFENER_STEEL", 4, 10), category("STIFFENER_FR4_STD", "标准FR4补强", "STIFFENER_FR4", 4, 10),
  category("ADHESIVE_FILM", "胶膜", "PCB_ADHESIVE", 3, 10), category("ADHESIVE_LIQUID", "液态胶", "PCB_ADHESIVE", 3, 20), category("ADHESIVE_FILM_STD", "标准胶膜", "ADHESIVE_FILM", 4, 10), category("ADHESIVE_LIQUID_STD", "标准液态胶", "ADHESIVE_LIQUID", 4, 10),

  category("ELECTRONIC", "电子元件", null, 1, 20),
  category("EL_PASSIVE", "被动元件", "ELECTRONIC", 2, 10), category("EL_SEMICONDUCTOR", "半导体", "ELECTRONIC", 2, 20), category("EL_CONNECTOR", "连接器", "ELECTRONIC", 2, 30),
  category("PASS_RESISTOR", "电阻", "EL_PASSIVE", 3, 10), category("PASS_CAPACITOR", "电容", "EL_PASSIVE", 3, 20), category("PASS_INDUCTOR", "电感", "EL_PASSIVE", 3, 30),
  category("RES_CHIP", "贴片电阻", "PASS_RESISTOR", 4, 10), category("CAP_CHIP", "贴片电容", "PASS_CAPACITOR", 4, 10), category("IND_CHIP", "贴片电感", "PASS_INDUCTOR", 4, 10),
  category("SEMI_IC", "IC", "EL_SEMICONDUCTOR", 3, 10), category("SEMI_DIODE", "二极管", "EL_SEMICONDUCTOR", 3, 20), category("SEMI_MOS", "MOS", "EL_SEMICONDUCTOR", 3, 30),
  category("IC_BGA", "BGA", "SEMI_IC", 4, 10), category("IC_QFN", "QFN", "SEMI_IC", 4, 20), category("DIODE_SMD", "贴片二极管", "SEMI_DIODE", 4, 10), category("MOS_SMD", "贴片MOS", "SEMI_MOS", 4, 10),
  category("CONN_BOARD", "板端连接器", "EL_CONNECTOR", 3, 10), category("CONN_FPC", "FPC连接器", "EL_CONNECTOR", 3, 20), category("CONN_BOARD_STD", "标准板端连接器", "CONN_BOARD", 4, 10), category("CONN_FPC_STD", "标准FPC连接器", "CONN_FPC", 4, 10),

  category("SMT_AUX", "SMT辅料", null, 1, 30),
  category("SMT_SOLDER_PASTE", "锡膏", "SMT_AUX", 2, 10), category("SMT_RED_GLUE", "红胶", "SMT_AUX", 2, 20), category("SMT_FLUX", "助焊剂", "SMT_AUX", 2, 30), category("SMT_STENCIL", "钢网", "SMT_AUX", 2, 40), category("SMT_CLEANER", "清洗剂", "SMT_AUX", 2, 50),
  category("PASTE_LEAD_FREE", "无铅锡膏", "SMT_SOLDER_PASTE", 3, 10), category("RED_GLUE_SMD", "贴片红胶", "SMT_RED_GLUE", 3, 10), category("FLUX_LIQUID", "液态助焊剂", "SMT_FLUX", 3, 10), category("STENCIL_LASER", "激光钢网", "SMT_STENCIL", 3, 10), category("SMT_CLEANER_LIQUID", "液态清洗剂", "SMT_CLEANER", 3, 10),
  category("PASTE_LEAD_FREE_STD", "标准无铅锡膏", "PASTE_LEAD_FREE", 4, 10), category("RED_GLUE_SMD_STD", "标准贴片红胶", "RED_GLUE_SMD", 4, 10), category("FLUX_LIQUID_STD", "标准液态助焊剂", "FLUX_LIQUID", 4, 10), category("STENCIL_LASER_STD", "标准激光钢网", "STENCIL_LASER", 4, 10), category("SMT_CLEANER_STD", "标准SMT清洗剂", "SMT_CLEANER_LIQUID", 4, 10),

  category("PROD_CONSUMABLE", "生产耗材", null, 1, 40),
  ...[["DRILL","钻针"],["ROUTER","铣刀"],["TAPE","胶带"],["PROTECT_FILM","保护膜"],["PACKAGING","包装材料"]].flatMap(([code, name], index) => [category(`PC_${code}`, name, "PROD_CONSUMABLE", 2, (index + 1) * 10), category(`PC_${code}_GENERAL`, `通用${name}`, `PC_${code}`, 3, 10), category(`PC_${code}_STD`, `标准${name}`, `PC_${code}_GENERAL`, 4, 10)]),

  category("CHEMICAL", "化学材料", null, 1, 50),
  ...[["INK","油墨"],["POTION","药水"],["GLUE","胶水"],["CLEANER","清洗剂"]].flatMap(([code, name], index) => [category(`CH_${code}`, name, "CHEMICAL", 2, (index + 1) * 10), category(`CH_${code}_GENERAL`, `通用${name}`, `CH_${code}`, 3, 10), category(`CH_${code}_STD`, `标准${name}`, `CH_${code}_GENERAL`, 4, 10)]),
];

export const MATERIAL_ATTRIBUTES: readonly AttributeSeed[] = [
  { code: "BRAND", name: "品牌", type: "TEXT" }, { code: "MODEL", name: "型号", type: "TEXT" },
  { code: "THICKNESS", name: "厚度", type: "DECIMAL", unit: "mm", scale: 3 }, { code: "COPPER_THICKNESS", name: "铜厚", type: "DECIMAL", unit: "um", scale: 1 },
  { code: "TG", name: "TG", type: "DECIMAL", unit: "°C", scale: 1 }, { code: "PI_THICKNESS", name: "PI厚度", type: "DECIMAL", unit: "um", scale: 1 },
  { code: "ADHESIVE_THICKNESS", name: "胶厚", type: "DECIMAL", unit: "um", scale: 1 }, { code: "COLOR", name: "颜色", type: "ENUM", values: ["NATURAL","BLACK","WHITE","GREEN","YELLOW","OTHER"] },
  { code: "WIDTH", name: "宽度", type: "DECIMAL", unit: "mm", scale: 2 }, { code: "LENGTH", name: "长度", type: "DECIMAL", unit: "mm", scale: 2 },
  { code: "RESISTANCE", name: "阻值", type: "DECIMAL", unit: "ohm", scale: 3 }, { code: "TOLERANCE", name: "精度", type: "DECIMAL", unit: "%", scale: 3 },
  { code: "POWER", name: "功率", type: "DECIMAL", unit: "W", scale: 3 }, { code: "PACKAGE", name: "封装", type: "TEXT" },
  { code: "CAPACITANCE", name: "容值", type: "DECIMAL", unit: "F", scale: 9 }, { code: "INDUCTANCE", name: "感值", type: "DECIMAL", unit: "H", scale: 9 },
  { code: "RATED_VOLTAGE", name: "额定电压", type: "DECIMAL", unit: "V", scale: 3 }, { code: "MPN", name: "制造商料号", type: "TEXT" },
  { code: "PIN_COUNT", name: "引脚数", type: "INTEGER" }, { code: "PITCH", name: "间距", type: "DECIMAL", unit: "mm", scale: 3 },
  { code: "ALLOY", name: "合金", type: "ENUM", values: ["SAC305","SAC0307","SN63PB37","OTHER"] }, { code: "POWDER_GRADE", name: "粉号", type: "ENUM", values: ["T3","T4","T5","T6","OTHER"] },
  { code: "WEIGHT", name: "重量", type: "DECIMAL", unit: "kg", scale: 3 }, { code: "VISCOSITY", name: "粘度", type: "DECIMAL", unit: "Pa.s", scale: 2 },
  { code: "SOLID_CONTENT", name: "固含量", type: "DECIMAL", unit: "%", scale: 2 }, { code: "MESH", name: "网目", type: "INTEGER" },
  { code: "DIAMETER", name: "直径", type: "DECIMAL", unit: "mm", scale: 3 }, { code: "MATERIAL", name: "材质", type: "TEXT" },
  { code: "ADHESIVE_TYPE", name: "胶系", type: "ENUM", values: ["ACRYLIC","SILICONE","EPOXY","OTHER"] }, { code: "SHELF_LIFE_DAYS", name: "保质期", type: "INTEGER", unit: "day" },
  { code: "CONCENTRATION", name: "浓度", type: "DECIMAL", unit: "%", scale: 2 }, { code: "PH", name: "pH值", type: "DECIMAL", scale: 2 },
  { code: "FLAMMABILITY", name: "阻燃等级", type: "TEXT" }, { code: "HALOGEN_FREE", name: "无卤", type: "BOOLEAN" },
];

const templates: Record<string, readonly string[]> = {
  board: ["BRAND","MODEL","THICKNESS","COPPER_THICKNESS","TG","FLAMMABILITY","HALOGEN_FREE"], film: ["BRAND","MODEL","THICKNESS","WIDTH","LENGTH"],
  coverlay: ["BRAND","MODEL","PI_THICKNESS","ADHESIVE_THICKNESS","COLOR"], resistor: ["RESISTANCE","TOLERANCE","POWER","PACKAGE","BRAND","MPN"],
  capacitor: ["CAPACITANCE","TOLERANCE","RATED_VOLTAGE","PACKAGE","BRAND","MPN"], inductor: ["INDUCTANCE","TOLERANCE","POWER","PACKAGE","BRAND","MPN"],
  semiconductor: ["BRAND","MPN","PACKAGE","PIN_COUNT","RATED_VOLTAGE"], connector: ["BRAND","MPN","PIN_COUNT","PITCH","PACKAGE"],
  paste: ["BRAND","ALLOY","POWDER_GRADE","WEIGHT","SHELF_LIFE_DAYS"], chemical: ["BRAND","MODEL","WEIGHT","CONCENTRATION","PH","SHELF_LIFE_DAYS"],
  consumable: ["BRAND","MODEL","MATERIAL","DIAMETER","THICKNESS","WIDTH","LENGTH"], adhesive: ["BRAND","MODEL","ADHESIVE_TYPE","VISCOSITY","WEIGHT","SHELF_LIFE_DAYS"],
};

const leafTemplate: Record<string, keyof typeof templates> = {};
for (const code of ["FR4_STANDARD","FR4_HIGH_TG","FR4_HALOGEN_FREE","CCL_SINGLE","CCL_DOUBLE","PP_FR4_STD"]) leafTemplate[code] = "board";
for (const code of ["PI_FILM","PI_CCL","FOIL_ED_STD","FOIL_RA_STD","STIFFENER_PI_STD","STIFFENER_STEEL_STD","STIFFENER_FR4_STD","ADHESIVE_FILM_STD","PC_PROTECT_FILM_STD"]) leafTemplate[code] = "film";
leafTemplate.COVERLAY_PI_STD = "coverlay"; leafTemplate.RES_CHIP = "resistor"; leafTemplate.CAP_CHIP = "capacitor"; leafTemplate.IND_CHIP = "inductor";
for (const code of ["IC_BGA","IC_QFN","DIODE_SMD","MOS_SMD"]) leafTemplate[code] = "semiconductor";
for (const code of ["CONN_BOARD_STD","CONN_FPC_STD"]) leafTemplate[code] = "connector";
leafTemplate.PASTE_LEAD_FREE_STD = "paste";
for (const code of ["RED_GLUE_SMD_STD","ADHESIVE_LIQUID_STD"]) leafTemplate[code] = "adhesive";
for (const code of ["FLUX_LIQUID_STD","SMT_CLEANER_STD","CH_INK_STD","CH_POTION_STD","CH_GLUE_STD","CH_CLEANER_STD"]) leafTemplate[code] = "chemical";
for (const code of ["STENCIL_LASER_STD","PC_DRILL_STD","PC_ROUTER_STD","PC_TAPE_STD","PC_PACKAGING_STD"]) leafTemplate[code] = "consumable";

export const MATERIAL_CATEGORY_BINDINGS: readonly BindingSeed[] = MATERIAL_CATEGORIES.filter((item) => item.level === 4).map((item) => {
  const template = leafTemplate[item.code];
  if (!template) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] missing template for ${item.code}`);
  const attributeCodes = [...templates[template]];
  return { categoryCode: item.code, attributeCodes, requiredCodes: attributeCodes };
});

export const MATERIAL_CATEGORY_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export function validateMaterialCategorySeed(): void {
  const duplicate = (codes: readonly string[], kind: string) => { const seen = new Set<string>(); for (const code of codes) { if (!code || !MATERIAL_CATEGORY_CODE_PATTERN.test(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] invalid ${kind} code: ${code || "<empty>"}`); if (seen.has(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] duplicate ${kind} code: ${code}`); seen.add(code); } };
  duplicate(MATERIAL_CATEGORIES.map((item) => item.code), "category"); duplicate(MATERIAL_ATTRIBUTES.map((item) => item.code), "attribute"); duplicate(MATERIAL_CATEGORY_BINDINGS.map((item) => item.categoryCode), "binding");
  const categories = new Map(MATERIAL_CATEGORIES.map((item) => [item.code, item])); const attributes = new Set(MATERIAL_ATTRIBUTES.map((item) => item.code));
  for (const item of MATERIAL_CATEGORIES) { if (item.level < 1 || item.level > 4) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] invalid level: ${item.code}`); if (item.level === 1 ? item.parentCode !== null : !item.parentCode) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] invalid parent: ${item.code}`); if (item.parentCode && categories.get(item.parentCode)?.level !== item.level - 1) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] non-contiguous parent: ${item.code}`); }
  const leafCodes = new Set(MATERIAL_CATEGORIES.filter((item) => item.level === 4).map((item) => item.code));
  for (const binding of MATERIAL_CATEGORY_BINDINGS) { if (!leafCodes.has(binding.categoryCode)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] binding is not a level-4 leaf: ${binding.categoryCode}`); duplicate(binding.attributeCodes, `binding attribute for ${binding.categoryCode}`); for (const code of binding.attributeCodes) if (!attributes.has(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] unknown attribute ${code} for ${binding.categoryCode}`); for (const code of binding.requiredCodes) if (!binding.attributeCodes.includes(code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] required attribute is not bound: ${binding.categoryCode}/${code}`); }
  for (const code of leafCodes) if (!MATERIAL_CATEGORY_BINDINGS.some((item) => item.categoryCode === code)) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] leaf has no template: ${code}`);
}
