import { createHash } from "node:crypto";
import type { GovernanceCategory } from "./types.ts";

export const MATERIAL_GOVERNANCE_RULE_VERSION = "bom-material-governance-v1";

export const DECIMAL_TOKEN_PATTERN = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
export const PACKAGE_TOKEN_PATTERN = /(?:^|[^A-Z0-9])((?:01005|0201|0402|0603|0805|1206|1210|1808|2010|2512)|(?:SOT|SOD|SOP|SSOP|TSSOP|QFN|DFN|BGA|LGA|SC)[- ]?\d+(?:-\d+)?)(?=$|[^A-Z0-9])/i;

export type CategoryRule = Readonly<{
  category: GovernanceCategory;
  standardName: string;
  identityComponents: readonly string[];
  performanceComponents: readonly string[];
  compatibilityComponents: readonly string[];
  alternativeEligible: boolean;
  hintAliases: readonly string[];
  classificationPatterns: readonly RegExp[];
}>;

export const CATEGORY_RULES: Readonly<Record<GovernanceCategory, CategoryRule>> = Object.freeze({
  RES: Object.freeze({
    category: "RES", standardName: "电阻",
    identityComponents: Object.freeze(["PACKAGE", "RESISTANCE"]),
    performanceComponents: Object.freeze(["TOLERANCE", "POWER"]),
    compatibilityComponents: Object.freeze(["PACKAGE", "RESISTANCE", "TOLERANCE", "POWER"]),
    alternativeEligible: false,
    hintAliases: Object.freeze(["RES", "RESISTOR", "电阻", "贴片电阻"]),
    classificationPatterns: Object.freeze([/\bRES(?:ISTOR)?\b/i, /电阻/, /(?:\d+(?:\.\d+)?)\s*(?:Ω|OHM)\b/i, /\b(?:\d+[RKM]\d*|[RKM]\d+)\b/i]),
  }),
  CAP: Object.freeze({
    category: "CAP", standardName: "电容",
    identityComponents: Object.freeze(["PACKAGE", "CAPACITANCE", "VOLTAGE", "DIELECTRIC"]),
    performanceComponents: Object.freeze(["TOLERANCE"]),
    compatibilityComponents: Object.freeze(["PACKAGE", "CAPACITANCE", "VOLTAGE", "DIELECTRIC", "TOLERANCE"]),
    alternativeEligible: false,
    hintAliases: Object.freeze(["CAP", "CAPACITOR", "电容", "贴片电容"]),
    classificationPatterns: Object.freeze([/\bCAP(?:ACITOR)?\b/i, /电容/, /\d+(?:\.\d+)?\s*(?:PF|NF|UF|µF|μF|MF)\b/i]),
  }),
  IND: Object.freeze({
    category: "IND", standardName: "电感",
    identityComponents: Object.freeze(["PACKAGE", "INDUCTANCE", "RATED_CURRENT"]),
    performanceComponents: Object.freeze(["TOLERANCE"]),
    compatibilityComponents: Object.freeze(["PACKAGE", "INDUCTANCE", "RATED_CURRENT", "TOLERANCE"]),
    alternativeEligible: false,
    hintAliases: Object.freeze(["IND", "INDUCTOR", "电感", "贴片电感"]),
    classificationPatterns: Object.freeze([/\bIND(?:UCTOR)?\b/i, /电感/, /\d+(?:\.\d+)?\s*(?:NH|UH|µH|μH|MH)\b/i]),
  }),
  DIODE: Object.freeze({
    category: "DIODE", standardName: "二极管",
    identityComponents: Object.freeze(["MODEL", "PACKAGE"]), performanceComponents: Object.freeze([]),
    compatibilityComponents: Object.freeze([]), alternativeEligible: false,
    hintAliases: Object.freeze(["DIODE", "二极管", "整流管", "稳压管"]),
    classificationPatterns: Object.freeze([/\bDIODE\b/i, /二极管|整流管|稳压管/]),
  }),
  TRANS: Object.freeze({
    category: "TRANS", standardName: "三极管",
    identityComponents: Object.freeze(["MODEL", "PACKAGE"]), performanceComponents: Object.freeze([]),
    compatibilityComponents: Object.freeze([]), alternativeEligible: false,
    hintAliases: Object.freeze(["TRANS", "TRANSISTOR", "三极管", "晶体管", "MOS", "MOSFET"]),
    classificationPatterns: Object.freeze([/\b(?:TRANSISTOR|MOSFET|MOS)\b/i, /三极管|晶体管/]),
  }),
  IC: Object.freeze({
    category: "IC", standardName: "芯片",
    identityComponents: Object.freeze(["MODEL", "PACKAGE"]), performanceComponents: Object.freeze([]),
    compatibilityComponents: Object.freeze([]), alternativeEligible: false,
    hintAliases: Object.freeze(["IC", "CHIP", "芯片", "集成电路"]),
    classificationPatterns: Object.freeze([/\b(?:IC|CHIP)\b/i, /芯片|集成电路/, /\b(?:TPS|STM32|ATMEGA|SN74|LM\d|NE555|ESP32)[A-Z0-9-]*\b/i]),
  }),
  OSC: Object.freeze({
    category: "OSC", standardName: "晶振",
    identityComponents: Object.freeze(["MODEL", "PACKAGE", "FREQUENCY"]), performanceComponents: Object.freeze([]),
    compatibilityComponents: Object.freeze(["PACKAGE", "FREQUENCY"]), alternativeEligible: true,
    hintAliases: Object.freeze(["OSC", "OSCILLATOR", "CRYSTAL", "晶振", "振荡器"]),
    classificationPatterns: Object.freeze([/\b(?:OSCILLATOR|CRYSTAL)\b/i, /晶振|振荡器/, /\d+(?:\.\d+)?\s*(?:KHZ|MHZ|GHZ)\b/i]),
  }),
  CON: Object.freeze({
    category: "CON", standardName: "连接器",
    identityComponents: Object.freeze(["BRAND", "MODEL", "PIN_COUNT", "PITCH", "STRUCTURE"]), performanceComponents: Object.freeze([]),
    compatibilityComponents: Object.freeze(["PIN_COUNT", "PITCH", "STRUCTURE"]), alternativeEligible: true,
    hintAliases: Object.freeze(["CON", "CONNECTOR", "连接器", "接插件", "插座", "端子"]),
    classificationPatterns: Object.freeze([/\bCONNECTOR\b/i, /连接器|接插件|插座|端子/]),
  }),
  MECH: Object.freeze({
    category: "MECH", standardName: "结构件",
    identityComponents: Object.freeze([]), performanceComponents: Object.freeze([]), compatibilityComponents: Object.freeze([]), alternativeEligible: false,
    hintAliases: Object.freeze(["MECH", "MECHANICAL", "结构件", "五金", "外壳"]),
    classificationPatterns: Object.freeze([/\bMECHANICAL\b/i, /结构件|五金|外壳/]),
  }),
  OTHER: Object.freeze({
    category: "OTHER", standardName: "其他物料",
    identityComponents: Object.freeze([]), performanceComponents: Object.freeze([]), compatibilityComponents: Object.freeze([]), alternativeEligible: false,
    hintAliases: Object.freeze(["OTHER", "其他"]), classificationPatterns: Object.freeze([]),
  }),
});

export const PACKAGE_POWER_DEFAULTS_MICROWATT: Readonly<Record<string, string>> = Object.freeze({
  "0201": "50000",
});

export type CompatibilityReviewProfile = Readonly<{
  profileCode: string;
  category: GovernanceCategory;
  anchorComponents: readonly string[];
  blockingIssueCodes: readonly string[];
}>;

// Migration 0035 adds mandatory identity attributes to the v2 metadata, and
// historical formal rows can also contain conflicting structured/basic facts.
// Existing ACTIVE rows are immutable, so both cases must be surfaced for an
// explicit, separately controlled remediation instead of being treated as exact.
export const COMPATIBILITY_REVIEW_PROFILES: readonly CompatibilityReviewProfile[] = Object.freeze([
  Object.freeze({
    profileCode: "LEGACY_CAP_DIELECTRIC_MISSING_V1",
    category: "CAP",
    anchorComponents: Object.freeze(["PACKAGE", "CAPACITANCE", "VOLTAGE", "TOLERANCE"]),
    blockingIssueCodes: Object.freeze(["GOVERNANCE_DIELECTRIC_MISSING"]),
  }),
  Object.freeze({
    profileCode: "LEGACY_IND_RATED_CURRENT_MISSING_V1",
    category: "IND",
    anchorComponents: Object.freeze(["PACKAGE", "INDUCTANCE", "TOLERANCE"]),
    blockingIssueCodes: Object.freeze(["GOVERNANCE_RATED_CURRENT_MISSING"]),
  }),
  Object.freeze({
    profileCode: "LEGACY_CON_STRUCTURE_MISSING_V1",
    category: "CON",
    anchorComponents: Object.freeze(["BRAND", "MODEL", "PIN_COUNT", "PITCH"]),
    blockingIssueCodes: Object.freeze(["GOVERNANCE_STRUCTURE_MISSING"]),
  }),
  Object.freeze({
    profileCode: "FORMAL_CON_BRAND_CONFLICT_V1",
    category: "CON",
    anchorComponents: Object.freeze(["MODEL", "PIN_COUNT", "PITCH", "STRUCTURE"]),
    blockingIssueCodes: Object.freeze(["GOVERNANCE_FORMAL_BRAND_CONFLICT"]),
  }),
]);

export const RESISTOR_POWER_CODE_MICROWATT: Readonly<Record<string, string>> = Object.freeze({
  W: "50000",
  U: "62500",
  V: "100000",
  P: "125000",
});

export const TOLERANCE_CODE_PERCENT: Readonly<Record<string, string>> = Object.freeze({
  B: "0.1", C: "0.25", D: "0.5", F: "1", G: "2", J: "5", K: "10", M: "20",
});

export const TOLERANCE_PERCENT_VALUES = Object.freeze(["0.1", "0.25", "0.5", "1", "2", "5", "10", "20"] as const);
export const UNKNOWN_BRAND_TOKENS = Object.freeze(["UNKNOWN", "UNSPECIFIED", "N/A", "NA", "未知"] as const);

export type ResistorVendorDecoderProfile = Readonly<{
  profileCode: string;
  pattern: RegExp;
}>;

export const RESISTOR_VENDOR_DECODER_PROFILES: readonly ResistorVendorDecoderProfile[] = Object.freeze([
  Object.freeze({
    profileCode: "RES_WM_4DIGIT_TCE_V1",
    pattern: /^(01005|0201|0402|0603|0805|1206|1210|2010|2512)([WUVP])M([BCDFGJKM])(\d{4})TCE$/,
  }),
]);

export type ModelPackageDecoderProfile = Readonly<{
  profileCode: string;
  pattern: RegExp;
  packageCode: string;
}>;

export const MODEL_PACKAGE_DECODER_PROFILES: readonly ModelPackageDecoderProfile[] = Object.freeze([
  Object.freeze({ profileCode: "TI_TPS_DBV_SUFFIX_V1", pattern: /^TPS[A-Z0-9-]*DBV[RT]?$/i, packageCode: "SOT-23-5" }),
  Object.freeze({ profileCode: "TI_TPS_DCK_SUFFIX_V1", pattern: /^TPS[A-Z0-9-]*DCK[RT]?$/i, packageCode: "SC-70-5" }),
]);

export type OscillatorPackageProfile = Readonly<{
  packageCode: string;
  patterns: readonly RegExp[];
}>;

export const OSCILLATOR_PACKAGE_PROFILES: readonly OscillatorPackageProfile[] = Object.freeze([
  ...[
    ["SMD-2016", "2016", "2\\.0\\s*[X×*]\\s*1\\.6"],
    ["SMD-2520", "2520", "2\\.5\\s*[X×*]\\s*2\\.0"],
    ["SMD-3225", "3225", "3\\.2\\s*[X×*]\\s*2\\.5"],
    ["SMD-5032", "5032", "5\\.0\\s*[X×*]\\s*3\\.2"],
    ["SMD-7050", "7050", "7\\.0\\s*[X×*]\\s*5\\.0"],
  ].map(([packageCode, compact, dimension]) => Object.freeze({
    packageCode,
    patterns: Object.freeze([
      new RegExp(`(?:^|[^A-Z0-9])(?:SMD[- ]?)?${compact}(?=$|[^A-Z0-9])`, "i"),
      new RegExp(`(?:^|[^A-Z0-9])${dimension}\\s*MM(?=$|[^A-Z0-9])`, "i"),
    ]),
  })),
]);

export const DIELECTRIC_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  C0G: "C0G", NP0: "C0G", X5R: "X5R", X7R: "X7R", Y5V: "Y5V", Z5U: "Z5U",
});

export const CONNECTOR_STRUCTURE_RULES = Object.freeze([
  Object.freeze({ value: "STRAIGHT", pattern: /直插|直式|STRAIGHT/i }),
  Object.freeze({ value: "RIGHT_ANGLE", pattern: /弯针|卧式|RIGHT\s*ANGLE/i }),
  Object.freeze({ value: "VERTICAL", pattern: /立式|VERTICAL/i }),
  Object.freeze({ value: "BOARD_TO_BOARD", pattern: /板对板|BOARD\s*TO\s*BOARD/i }),
  Object.freeze({ value: "WIRE_TO_BOARD", pattern: /线对板|WIRE\s*TO\s*BOARD/i }),
]);

export const MASTER_CATEGORY_GOVERNANCE_MAP: Readonly<Record<string, GovernanceCategory>> = Object.freeze({
  RES_CHIP: "RES",
  CAP_CHIP: "CAP",
  IND_CHIP: "IND",
  DIODE_SMD: "DIODE",
  MOS_SMD: "TRANS",
  TRANS_SMD: "TRANS",
  IC_BGA: "IC",
  IC_QFN: "IC",
  IC_SOT: "IC",
  IC_SMD_OTHER: "IC",
  OSC_SMD: "OSC",
  CONN_BOARD_STD: "CON",
  CONN_FPC_STD: "CON",
});

export type ExactUnitRule = Readonly<{
  suffixes: readonly string[];
  factors: Readonly<Record<string, string>>;
  displayUnits: readonly Readonly<{ factor: string; suffix: string }>[];
  canonicalUnit: string;
}>;

function exactUnitRule(
  suffixes: readonly string[],
  factors: Readonly<Record<string, string>>,
  displayUnits: readonly Readonly<{ factor: string; suffix: string }>[],
  canonicalUnit: string,
): ExactUnitRule {
  return Object.freeze({
    suffixes: Object.freeze([...suffixes]),
    factors: Object.freeze({ ...factors }),
    displayUnits: Object.freeze(displayUnits.map((unit) => Object.freeze({ ...unit }))),
    canonicalUnit,
  });
}

export const EXACT_UNIT_RULES = Object.freeze({
  CAPACITANCE: exactUnitRule(
    ["AF", "FF", "PF", "NF", "UF", "MF", "F"],
    { AF: "1", FF: "1000", PF: "1000000", NF: "1000000000", UF: "1000000000000", MF: "1000000000000000", F: "1000000000000000000" },
    [{ factor: "1000000000000000000", suffix: "F" }, { factor: "1000000000000000", suffix: "MF" }, { factor: "1000000000000", suffix: "UF" }, { factor: "1000000000", suffix: "NF" }, { factor: "1000000", suffix: "PF" }],
    "aF",
  ),
  INDUCTANCE: exactUnitRule(
    ["PH", "NH", "UH", "MH", "H"],
    { PH: "1", NH: "1000", UH: "1000000", MH: "1000000000", H: "1000000000000" },
    [{ factor: "1000000000000", suffix: "H" }, { factor: "1000000000", suffix: "MH" }, { factor: "1000000", suffix: "UH" }, { factor: "1000", suffix: "NH" }, { factor: "1", suffix: "PH" }],
    "pH",
  ),
  VOLTAGE: exactUnitRule(
    ["UV", "MV", "V", "KV"],
    { UV: "1", MV: "1000", V: "1000000", KV: "1000000000" },
    [{ factor: "1000000000", suffix: "KV" }, { factor: "1000000", suffix: "V" }, { factor: "1000", suffix: "MV" }, { factor: "1", suffix: "UV" }],
    "uV",
  ),
  RATED_CURRENT: exactUnitRule(
    ["UA", "MA", "A"],
    { UA: "1", MA: "1000", A: "1000000" },
    [{ factor: "1000000", suffix: "A" }, { factor: "1000", suffix: "MA" }, { factor: "1", suffix: "UA" }],
    "uA",
  ),
  PITCH: exactUnitRule(
    ["NM", "UM", "MM"],
    { NM: "1", UM: "1000", MM: "1000000" },
    [{ factor: "1000000", suffix: "MM" }, { factor: "1000", suffix: "UM" }, { factor: "1", suffix: "NM" }],
    "nm",
  ),
  FREQUENCY: exactUnitRule(
    ["HZ", "KHZ", "MHZ", "GHZ"],
    { HZ: "1", KHZ: "1000", MHZ: "1000000", GHZ: "1000000000" },
    [{ factor: "1000000000", suffix: "GHZ" }, { factor: "1000000", suffix: "MHZ" }, { factor: "1000", suffix: "KHZ" }, { factor: "1", suffix: "HZ" }],
    "Hz",
  ),
});

export const POWER_FRACTION_DISPLAY: Readonly<Record<string, string>> = Object.freeze({
  "31250": "1-32W",
  "50000": "1-20W",
  "62500": "1-16W",
  "100000": "1-10W",
  "125000": "1-8W",
  "250000": "1-4W",
  "500000": "1-2W",
  "750000": "3-4W",
  "1000000": "1W",
});

export const MATERIAL_GOVERNANCE_LIMITS = Object.freeze({
  maxSourceRows: 5_000,
  maxActiveMaterialScanRows: 50_000,
  maxExactCandidatesPerGroup: 20,
  maxAlternativeCandidates: 10_000,
  maxIssuesPerSource: 32,
  maxSourceKeyLength: 200,
  maxSourceFieldLength: 2_000,
  maxNumericDigits: 30,
  maxDecimalPlaces: 18,
  chunkRows: 100,
  statementTimeoutMs: 60_000,
  lockTimeoutMs: 5_000,
});

export const MATERIAL_GOVERNANCE_CONFIG_SNAPSHOT = Object.freeze({
  schema_version: 1,
  rule_version: MATERIAL_GOVERNANCE_RULE_VERSION,
  decimal_token_pattern: DECIMAL_TOKEN_PATTERN,
  package_token_pattern: `${PACKAGE_TOKEN_PATTERN.source}/${PACKAGE_TOKEN_PATTERN.flags}`,
  categories: Object.freeze(Object.values(CATEGORY_RULES).map((rule) => Object.freeze({
    category: rule.category,
    identity_components: rule.identityComponents,
    performance_components: rule.performanceComponents,
    compatibility_components: rule.compatibilityComponents,
    alternative_eligible: rule.alternativeEligible,
    hint_aliases: rule.hintAliases,
    classification_patterns: Object.freeze(rule.classificationPatterns.map((pattern) => `${pattern.source}/${pattern.flags}`)),
  }))),
  package_power_defaults_microwatt: PACKAGE_POWER_DEFAULTS_MICROWATT,
  compatibility_review_profiles: COMPATIBILITY_REVIEW_PROFILES,
  resistor_power_code_microwatt: RESISTOR_POWER_CODE_MICROWATT,
  tolerance_code_percent: TOLERANCE_CODE_PERCENT,
  resistor_vendor_decoder_profiles: Object.freeze(RESISTOR_VENDOR_DECODER_PROFILES.map((value) => Object.freeze({ profile_code: value.profileCode, pattern: `${value.pattern.source}/${value.pattern.flags}` }))),
  model_package_decoder_profiles: Object.freeze(MODEL_PACKAGE_DECODER_PROFILES.map((value) => Object.freeze({ profile_code: value.profileCode, pattern: `${value.pattern.source}/${value.pattern.flags}`, package_code: value.packageCode }))),
  oscillator_package_profiles: Object.freeze(OSCILLATOR_PACKAGE_PROFILES.map((value) => Object.freeze({
    package_code: value.packageCode,
    patterns: Object.freeze(value.patterns.map((pattern) => `${pattern.source}/${pattern.flags}`)),
  }))),
  tolerance_percent_values: TOLERANCE_PERCENT_VALUES,
  unknown_brand_tokens: UNKNOWN_BRAND_TOKENS,
  dielectric_aliases: DIELECTRIC_ALIASES,
  connector_structure_rules: Object.freeze(CONNECTOR_STRUCTURE_RULES.map((value) => Object.freeze({ value: value.value, pattern: `${value.pattern.source}/${value.pattern.flags}` }))),
  master_category_governance_map: MASTER_CATEGORY_GOVERNANCE_MAP,
  exact_unit_rules: EXACT_UNIT_RULES,
  power_fraction_display: POWER_FRACTION_DISPLAY,
  exact_scales: Object.freeze({ resistance: "uohm", capacitance: "aF", inductance: "pH", voltage: "uV", current: "uA", pitch: "nm", power: "uW", frequency: "Hz" }),
  limits: MATERIAL_GOVERNANCE_LIMITS,
});

export const MATERIAL_GOVERNANCE_CONFIG_DIGEST = createHash("sha256")
  .update(JSON.stringify(MATERIAL_GOVERNANCE_CONFIG_SNAPSHOT))
  .digest("hex");
