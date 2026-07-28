import { createHash } from "node:crypto";
import {
  CATEGORY_RULES,
  CONNECTOR_STRUCTURE_RULES,
  DECIMAL_TOKEN_PATTERN,
  DIELECTRIC_ALIASES,
  EXACT_UNIT_RULES,
  MATERIAL_GOVERNANCE_LIMITS,
  MATERIAL_GOVERNANCE_RULE_VERSION,
  MODEL_PACKAGE_DECODER_PROFILES,
  OSCILLATOR_PACKAGE_PROFILES,
  PACKAGE_TOKEN_PATTERN,
  PACKAGE_POWER_DEFAULTS_MICROWATT,
  POWER_FRACTION_DISPLAY,
  RESISTOR_VENDOR_DECODER_PROFILES,
  RESISTOR_POWER_CODE_MICROWATT,
  TOLERANCE_CODE_PERCENT,
  TOLERANCE_PERCENT_VALUES,
  UNKNOWN_BRAND_TOKENS,
} from "./config.ts";
import type { ExactUnitRule } from "./config.ts";
import type {
  GovernanceAlternativeSuggestion,
  GovernanceBatchResult,
  GovernanceCategory,
  GovernanceComponent,
  GovernanceGroup,
  GovernanceIssue,
  GovernanceSourceInput,
  GovernedSource,
} from "./types.ts";

function clean(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function upper(value: string | null | undefined): string {
  return clean(value).toUpperCase().replaceAll("μ", "U").replaceAll("µ", "U");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function decimalToScaled(value: string, multiplier: bigint): bigint | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  if (whole.length + fraction.length > MATERIAL_GOVERNANCE_LIMITS.maxNumericDigits || fraction.length > MATERIAL_GOVERNANCE_LIMITS.maxDecimalPlaces) return null;
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  const scaled = numerator * multiplier;
  return scaled % denominator === 0n ? scaled / denominator : null;
}

function scaledDisplay(value: bigint, units: readonly Readonly<{ factor: bigint; suffix: string }>[]): string {
  const unit = units.find((candidate) => value >= candidate.factor) ?? units.at(-1)!;
  return decimalDisplay(value, unit.factor, unit.suffix);
}

function decimalDisplay(value: bigint, factor: bigint, suffix: string): string {
  const whole = value / factor;
  const remainder = value % factor;
  if (remainder === 0n) return `${whole}${suffix}`;
  const width = String(factor).length - 1;
  const fraction = String(remainder).padStart(width, "0").replace(/0+$/, "");
  return `${whole}.${fraction}${suffix}`;
}

function component(
  code: string,
  role: GovernanceComponent["role"],
  normalizedValue: string,
  displayValue: string,
  canonicalUnit: string | null,
  evidence: readonly string[],
): GovernanceComponent {
  return Object.freeze({ code, role, normalizedValue, displayValue, canonicalUnit, evidence: Object.freeze([...evidence]) });
}

function issue(code: string, field: string, message: string, evidence: readonly string[] = [], level: GovernanceIssue["level"] = "ERROR"): GovernanceIssue {
  return Object.freeze({ level, code, field, message, evidence: Object.freeze([...evidence]) });
}

type ParsedCandidate<T extends string | bigint> = Readonly<{
  value: T;
  display: string;
  evidence: readonly string[];
}>;

type ParsedField<T extends string | bigint> = Readonly<{
  selected: ParsedCandidate<T> | null;
  candidates: readonly ParsedCandidate<T>[];
  conflict: boolean;
  invalid: boolean;
}>;

function parsedField<T extends string | bigint>(
  candidates: readonly ParsedCandidate<T>[],
  invalid = false,
  fallback: ParsedCandidate<T> | null = null,
): ParsedField<T> {
  const distinct = new Map<string, ParsedCandidate<T>>();
  for (const candidate of candidates) {
    const key = String(candidate.value);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  return Object.freeze({
    selected: distinct.values().next().value ?? fallback,
    candidates: Object.freeze([...candidates]),
    conflict: distinct.size > 1,
    invalid,
  });
}

function parsedCandidate<T extends string | bigint>(value: T, display: string, evidence: readonly string[]): ParsedCandidate<T> {
  return Object.freeze({ value, display, evidence: Object.freeze([...evidence]) });
}

function canonicalDecimalToken(value: string): string {
  const [wholeRaw, fractionRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

const NEGATIVE_SIGN_PATTERN = "[-−﹣－]";

function hasNegativeQuantity(text: string, valuePattern: string, suffixPattern: string): boolean {
  return new RegExp(`(?:^|[^A-Z0-9+/])${NEGATIVE_SIGN_PATTERN}\\s*${valuePattern}\\s*(?:${suffixPattern})(?=$|[^A-Z0-9])`, "i").test(text);
}

function parsedFieldConflicts<T extends string | bigint>(field: ParsedField<T>, expectedValue?: string): boolean {
  if (field.conflict) return true;
  if (field.invalid) return true;
  return expectedValue !== undefined && field.candidates.some((candidate) => String(candidate.value) !== expectedValue);
}

function parsedConflictEvidence<T extends string | bigint>(label: string, field: ParsedField<T>, expectedValue?: string): readonly string[] {
  return Object.freeze([...new Set([
    `CONFLICTING_${label}_VALUES`,
    ...(field.invalid ? [`${label}_EXPLICIT_VALUE_INVALID`] : []),
    ...(expectedValue === undefined ? [] : [`${label}_REFERENCE_VALUE_COMPARISON`]),
    ...field.candidates.flatMap((candidate) => candidate.evidence),
  ])]);
}

function addParsedConflict<T extends string | bigint>(
  issues: GovernanceIssue[],
  field: ParsedField<T>,
  code: string,
  fieldName: string,
  message: string,
  evidenceLabel: string,
  expectedValue?: string,
): void {
  if (parsedFieldConflicts(field, expectedValue)) {
    issues.push(issue(code, fieldName, message, parsedConflictEvidence(evidenceLabel, field, expectedValue)));
  }
}

function sourceText(input: GovernanceSourceInput): string {
  return [input.model, input.manufacturerPartNumber, input.specification, input.description, input.materialName, input.categoryHint]
    .map(clean).filter(Boolean).join(" ");
}

function passiveSpecificationText(input: GovernanceSourceInput): string {
  return [input.specification, input.description, input.materialName, input.categoryHint]
    .map(clean).filter(Boolean).join(" ");
}

function modelSpecificationText(input: GovernanceSourceInput): string {
  return [input.specification, input.description, input.materialName, input.categoryHint]
    .map(clean).filter(Boolean).join(" ");
}

function aliasInHint(hint: string, alias: string): boolean {
  const normalizedAlias = upper(alias);
  if (/^[A-Z0-9]+$/.test(normalizedAlias)) {
    return new RegExp(`(?:^|[^A-Z0-9])${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Z0-9])`, "i").test(hint);
  }
  return hint.includes(normalizedAlias);
}

function hintedCategories(input: GovernanceSourceInput): readonly GovernanceCategory[] {
  const hint = upper(input.categoryHint);
  if (!hint) return Object.freeze([]);
  const found: GovernanceCategory[] = [];
  for (const rule of Object.values(CATEGORY_RULES)) {
    if (rule.hintAliases.some((alias) => aliasInHint(hint, alias))) found.push(rule.category);
  }
  return Object.freeze([...new Set(found)]);
}

function vendorResistor(input: GovernanceSourceInput): Readonly<{
  packageCode: string;
  resistanceMicroohm: bigint;
  tolerancePercent: string;
  powerMicrowatt: string;
  profileCode: string;
  evidence: readonly string[];
}> | null {
  const candidates = [
    { value: input.manufacturerPartNumber, provenance: "MANUFACTURER_PART_NUMBER" },
    { value: input.originalPartNumber, provenance: "ORIGINAL_PART_NUMBER" },
  ];
  for (const candidate of candidates) {
    const compact = upper(candidate.value).replace(/\s+/g, "");
    if (!compact) continue;
    for (const profile of RESISTOR_VENDOR_DECODER_PROFILES) {
      const match = profile.pattern.exec(compact);
      if (!match) continue;
      const power = RESISTOR_POWER_CODE_MICROWATT[match[2]];
      const tolerance = TOLERANCE_CODE_PERCENT[match[3]];
      if (!power || !tolerance) continue;
      const resistance = match[4] === "0000"
        ? 0n
        : BigInt(match[4].slice(0, 3)) * 10n ** BigInt(Number(match[4][3])) * 1_000_000n;
      return {
        packageCode: match[1],
        resistanceMicroohm: resistance,
        tolerancePercent: tolerance,
        powerMicrowatt: power,
        profileCode: profile.profileCode,
        evidence: Object.freeze([
          `VENDOR_DECODER_PROFILE_${profile.profileCode}`,
          `VENDOR_DECODER_SOURCE_${candidate.provenance}`,
          "RES_VENDOR_CODE_PACKAGE",
          "RES_VENDOR_CODE_VALUE",
          "RES_VENDOR_CODE_TOLERANCE",
          "RES_VENDOR_CODE_POWER",
        ]),
      };
    }
  }
  return null;
}

function classify(input: GovernanceSourceInput, text: string): Readonly<{ category: GovernanceCategory; evidence: readonly string[] }> {
  const hints = hintedCategories(input);
  if (hints.length === 1) return { category: hints[0], evidence: Object.freeze(["CATEGORY_HINT_ALIAS"]) };
  if (hints.length > 1) return { category: "OTHER", evidence: Object.freeze(["CATEGORY_HINT_AMBIGUOUS", ...hints.map((category) => `HINT_${category}`)]) };
  const vendor = vendorResistor(input);
  if (vendor) return { category: "RES", evidence: Object.freeze(["RES_VENDOR_CODE_PATTERN", `VENDOR_DECODER_PROFILE_${vendor.profileCode}`]) };
  const precedence: readonly GovernanceCategory[] = ["CAP", "IND", "RES", "CON", "OSC", "DIODE", "TRANS", "IC", "MECH"];
  const matched = precedence.filter((category) => CATEGORY_RULES[category].classificationPatterns.some((pattern) => pattern.test(text)));
  if (matched.length === 1) return { category: matched[0], evidence: Object.freeze([`CATEGORY_PATTERN_${matched[0]}`]) };
  if (matched.length > 1) return { category: "OTHER", evidence: Object.freeze(["CATEGORY_PATTERN_AMBIGUOUS", ...matched.map((category) => `PATTERN_${category}`)]) };
  return { category: "OTHER", evidence: Object.freeze(["CATEGORY_EVIDENCE_INSUFFICIENT"]) };
}

function canonicalPackageToken(value: string): string {
  const compact = value.toUpperCase().trim().replace(/\s+/g, "-");
  const prefixed = /^(SOT|SOD|SOP|SSOP|TSSOP|QFN|DFN|BGA|LGA|SC)-?(\d+)(?:-(\d+))?$/.exec(compact);
  return prefixed ? [prefixed[1], prefixed[2], prefixed[3]].filter(Boolean).join("-") : compact;
}

function parsePackage(text: string, model = "", category: GovernanceCategory | null = null): ParsedField<string> {
  const candidates: ParsedCandidate<string>[] = [];
  for (const match of ` ${text} `.matchAll(new RegExp(PACKAGE_TOKEN_PATTERN.source, "gi"))) {
    const value = canonicalPackageToken(match[1]);
    candidates.push(parsedCandidate(value, value, ["EXPLICIT_PACKAGE_TOKEN"]));
  }
  for (const decoder of MODEL_PACKAGE_DECODER_PROFILES) {
    if (decoder.pattern.test(model)) {
      candidates.push(parsedCandidate(decoder.packageCode, decoder.packageCode, ["MODEL_SUFFIX_PACKAGE_DECODER", `MODEL_PACKAGE_PROFILE_${decoder.profileCode}`]));
    }
  }
  if (category === "OSC") {
    for (const profile of OSCILLATOR_PACKAGE_PROFILES) {
      if (profile.patterns.some((pattern) => pattern.test(text))) {
        candidates.push(parsedCandidate(profile.packageCode, profile.packageCode, ["OSCILLATOR_PACKAGE_PROFILE"]));
      }
    }
  }
  return parsedField(candidates);
}

function parseResistance(text: string): ParsedField<bigint> {
  const candidates: ParsedCandidate<bigint>[] = [];
  let invalid = hasNegativeQuantity(
    text,
    DECIMAL_TOKEN_PATTERN,
    "mΩ|kΩ|KΩ|MΩ|Ω|mohm|kohm|KOHM|Mohm|MOHM|ohm|OHM|[RrKkM]",
  ) || new RegExp(`(?:^|[^A-Z0-9+/])${NEGATIVE_SIGN_PATTERN}\\s*\\d*[RrKkM]\\d+(?=$|[^A-Z0-9])`).test(text);
  const directPatterns = [
    new RegExp(`(?:^|[^A-Z0-9])(${DECIMAL_TOKEN_PATTERN})\\s*(mΩ|kΩ|KΩ|MΩ|Ω|mohm|kohm|KOHM|Mohm|MOHM|ohm|OHM)(?=$|[^A-Z0-9])`, "g"),
    new RegExp(`(?:^|[^A-Z0-9])(${DECIMAL_TOKEN_PATTERN})\\s*([RrKkM])(?=$|[^A-Z0-9])`, "g"),
  ];
  for (const pattern of directPatterns) {
    for (const match of text.matchAll(pattern)) {
      const unit = match[2];
      const normalized = unit.replace(/ohm/i, "Ω");
      const multiplier = normalized === "mΩ" ? 1000n
        : normalized === "MΩ" || unit === "M" ? 1_000_000_000_000n
          : /^(?:kΩ|KΩ|k|K)$/.test(normalized) ? 1_000_000_000n
            : 1_000_000n;
      const scaled = decimalToScaled(match[1], multiplier);
      if (scaled === null) invalid = true;
      else candidates.push(parsedCandidate(scaled, resistanceDisplay(scaled), ["EXPLICIT_RESISTANCE_TOKEN", "EXACT_MICROOHM_SCALING"]));
    }
  }
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])(\d*)([RrKkM])(\d+)(?=$|[^A-Z0-9])/g)) {
    const decimal = `${match[1] || "0"}.${match[3]}`;
    const multiplier = match[2] === "M" ? 1_000_000_000_000n : /[Kk]/.test(match[2]) ? 1_000_000_000n : 1_000_000n;
    const scaled = decimalToScaled(decimal, multiplier);
    if (scaled === null) invalid = true;
    else candidates.push(parsedCandidate(scaled, resistanceDisplay(scaled), ["EXPLICIT_RESISTANCE_TOKEN", "EXACT_MICROOHM_SCALING"]));
  }
  return parsedField(candidates, invalid);
}

function resistanceDisplay(value: bigint): string {
  if (value === 0n) return "0R";
  const units = [
    { factor: 1_000_000_000_000n, suffix: "M" },
    { factor: 1_000_000_000n, suffix: "K" },
    { factor: 1_000_000n, suffix: "R" },
    { factor: 1000n, suffix: "mR" },
    { factor: 1n, suffix: "uR" },
  ];
  const chosen = units.find((unit) => value >= unit.factor) ?? units.at(-1)!;
  return decimalDisplay(value, chosen.factor, chosen.suffix);
}

function parseConfiguredUnit(
  text: string,
  rule: ExactUnitRule,
  evidenceCode: string,
): ParsedField<bigint> {
  const unitText = text.replaceAll("μ", "u").replaceAll("µ", "u");
  const suffixes = [...rule.suffixes].sort((left, right) => right.length - left.length).join("|");
  const pattern = new RegExp(`(?:^|[^A-Z0-9])(${DECIMAL_TOKEN_PATTERN})\\s*(${suffixes})(?=$|[^A-Z0-9])`, "gi");
  const displayUnits = rule.displayUnits.map((unit) => ({ factor: BigInt(unit.factor), suffix: unit.suffix }));
  const candidates: ParsedCandidate<bigint>[] = [];
  let invalid = hasNegativeQuantity(unitText, DECIMAL_TOKEN_PATTERN, suffixes);
  for (const match of unitText.matchAll(pattern)) {
    const factorText = rule.factors[upper(match[2])];
    const factor = factorText === undefined ? undefined : BigInt(factorText);
    const scaled = factor === undefined ? null : decimalToScaled(match[1], factor);
    if (scaled === null || scaled <= 0n) invalid = true;
    else candidates.push(parsedCandidate(scaled, scaledDisplay(scaled, displayUnits), [evidenceCode, "EXACT_INTEGER_SCALING"]));
  }
  return parsedField(candidates, invalid);
}

function parseTolerance(text: string, category: GovernanceCategory): ParsedField<string> {
  const allowed = new Set<string>(TOLERANCE_PERCENT_VALUES);
  const candidates: ParsedCandidate<string>[] = [];
  let invalid = hasNegativeQuantity(text, DECIMAL_TOKEN_PATTERN, "%");
  const explicitPattern = new RegExp(`(?:^|[^0-9.])(?:±|\\+\\/-)?\\s*(${DECIMAL_TOKEN_PATTERN})\\s*%(?![0-9.])`, "gi");
  for (const match of text.matchAll(explicitPattern)) {
    const value = canonicalDecimalToken(match[1]);
    if (allowed.has(value)) candidates.push(parsedCandidate(value, value, ["EXPLICIT_TOLERANCE_PERCENT"]));
    else invalid = true;
  }
  if (category === "RES") {
    const toleranceCodePatterns = [
      /(?:^|[^A-Z0-9])([BCDFGJKM])\s*TOL(?:ERANCE)?(?=$|[^A-Z0-9])/gi,
      /(?:^|[^A-Z0-9])TOL(?:ERANCE)?\s*([BCDFGJKM])(?=$|[^A-Z0-9])/gi,
    ];
    for (const match of toleranceCodePatterns.flatMap((pattern) => [...text.matchAll(pattern)])) {
      const value = TOLERANCE_CODE_PERCENT[match[1].toUpperCase()];
      if (value) candidates.push(parsedCandidate(value, value, ["TOLERANCE_LETTER_CODE"]));
    }
  }
  return parsedField(candidates, invalid);
}

function parsePower(text: string, packageCode: string | null): ParsedField<string> {
  const candidates: ParsedCandidate<string>[] = [];
  let invalid = hasNegativeQuantity(text, `\\d+\\s*\\/\\s*\\d+`, "W")
    || hasNegativeQuantity(text, DECIMAL_TOKEN_PATTERN, "mW|W");
  const fractions = [...text.matchAll(/(?:^|[^0-9])(\d+)\s*\/\s*(\d+)\s*W\b/gi)];
  const fractionRanges = fractions.map((match) => {
    const start = match.index ?? -1;
    return [start, start + match[0].length] as const;
  });
  for (const fraction of fractions) {
    if (fraction[1].length + fraction[2].length > MATERIAL_GOVERNANCE_LIMITS.maxNumericDigits) {
      invalid = true;
      continue;
    }
    const numerator = BigInt(fraction[1]) * 1_000_000n;
    const denominator = BigInt(fraction[2]);
    if (numerator > 0n && denominator > 0n && numerator % denominator === 0n) {
      const value = String(numerator / denominator);
      candidates.push(parsedCandidate(value, POWER_FRACTION_DISPLAY[value] ?? `${fraction[1]}-${fraction[2]}W`, ["EXPLICIT_POWER_FRACTION"]));
    } else invalid = true;
  }
  const directPattern = new RegExp(`(?:^|[^A-Z0-9])(${DECIMAL_TOKEN_PATTERN})\\s*(mW|W)(?=$|[^A-Z0-9])`, "gi");
  for (const direct of text.matchAll(directPattern)) {
    const directIndex = direct.index ?? -1;
    if (fractionRanges.some(([start, end]) => directIndex >= start && directIndex < end)) continue;
    const scaled = decimalToScaled(direct[1], upper(direct[2]) === "MW" ? 1000n : 1_000_000n);
    if (scaled !== null && scaled > 0n) {
      const value = String(scaled);
      candidates.push(parsedCandidate(value, POWER_FRACTION_DISPLAY[value] ?? scaledDisplay(scaled, [{ factor: 1_000_000n, suffix: "W" }, { factor: 1000n, suffix: "mW" }, { factor: 1n, suffix: "uW" }]), ["EXPLICIT_POWER_TOKEN"]));
    } else invalid = true;
  }
  const fallback = packageCode ? PACKAGE_POWER_DEFAULTS_MICROWATT[packageCode] : undefined;
  const fallbackCandidate = fallback
    ? parsedCandidate(fallback, POWER_FRACTION_DISPLAY[fallback] ?? `${fallback}uW`, ["PACKAGE_POWER_DEFAULT", `PACKAGE_${packageCode}`])
    : null;
  return parsedField(candidates, invalid, fallbackCandidate);
}

function modelTokens(value: string | null | undefined): readonly string[] {
  return upper(value).split(/[\s,;，；]+/).filter((token) => /[A-Z]/.test(token) && /\d/.test(token));
}

function parseModel(input: GovernanceSourceInput): ParsedField<string> {
  const candidates = [
    ...modelTokens(input.model).map((value) => ({ value, evidence: "EXACT_MODEL_FIELD" })),
    ...modelTokens(input.manufacturerPartNumber).map((value) => ({ value, evidence: "EXACT_MANUFACTURER_PART_NUMBER" })),
  ].map((candidate) => parsedCandidate(candidate.value, candidate.value, [candidate.evidence]));
  return parsedField(candidates);
}

function parsePinCount(text: string): ParsedField<string> {
  const matches = [...text.matchAll(/(?:^|[^A-Z0-9])(\d{1,4})\s*(?:PIN|PINS|P|位|针)(?=$|[^A-Z0-9])/gi)];
  const candidates = matches
    .filter((match) => Number(match[1]) > 0)
    .map((match) => parsedCandidate(String(Number(match[1])), String(Number(match[1])), ["EXPLICIT_PIN_COUNT"]));
  const negative = hasNegativeQuantity(text, "\\d{1,4}", "PIN|PINS|P|位|针");
  return parsedField(candidates, negative || matches.some((match) => Number(match[1]) <= 0));
}

function parsePitch(text: string): ParsedField<bigint> {
  return parseConfiguredUnit(text, EXACT_UNIT_RULES.PITCH, "EXPLICIT_PITCH_TOKEN");
}

function parseStructure(text: string): ParsedField<string> {
  return parsedField(CONNECTOR_STRUCTURE_RULES
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => parsedCandidate(entry.value, entry.value, ["EXPLICIT_CONNECTOR_STRUCTURE"])));
}

function parseFrequency(text: string): ParsedField<bigint> {
  return parseConfiguredUnit(text, EXACT_UNIT_RULES.FREQUENCY, "EXPLICIT_FREQUENCY_TOKEN");
}

function parseDielectric(text: string): ParsedField<string> {
  const aliases = Object.keys(DIELECTRIC_ALIASES).sort((left, right) => right.length - left.length).join("|");
  const candidates = [...text.matchAll(new RegExp(`(?:^|[^A-Z0-9])(${aliases})(?=$|[^A-Z0-9])`, "gi"))]
    .map((match) => DIELECTRIC_ALIASES[match[1].toUpperCase()])
    .filter((value): value is string => Boolean(value))
    .map((value) => parsedCandidate(value, value, ["EXPLICIT_DIELECTRIC_TOKEN"]));
  return parsedField(candidates);
}

function parseBrand(input: GovernanceSourceInput): ParsedField<string> {
  const explicit = [
    { value: upper(input.brand), evidence: "EXPLICIT_BRAND" },
    { value: upper(input.manufacturer), evidence: "EXPLICIT_MANUFACTURER_AS_BRAND" },
  ].filter((candidate) => Boolean(candidate.value));
  const unknown = new Set<string>(UNKNOWN_BRAND_TOKENS);
  const candidates = explicit
    .filter((candidate) => !unknown.has(candidate.value))
    .map((candidate) => parsedCandidate(candidate.value, candidate.value, [candidate.evidence]));
  return parsedField(candidates, explicit.some((candidate) => unknown.has(candidate.value)));
}

function identityProjection(category: GovernanceCategory, components: readonly GovernanceComponent[], requested: readonly string[]): Record<string, unknown> | null {
  const byCode = new Map(components.map((item) => [item.code, item]));
  if (!requested.length || requested.some((code) => !byCode.has(code))) return null;
  return {
    rule_version: MATERIAL_GOVERNANCE_RULE_VERSION,
    category,
    components: requested.map((code) => {
      const item = byCode.get(code)!;
      return { code, value: item.normalizedValue, unit: item.canonicalUnit };
    }),
  };
}

function canonicalComponentDisplay(item: GovernanceComponent): string {
  const value = BigInt(/^\d+$/.test(item.normalizedValue) ? item.normalizedValue : "0");
  if (item.code === "RESISTANCE" && /^\d+$/.test(item.normalizedValue)) return resistanceDisplay(value);
  if (item.code === "POWER" && /^\d+$/.test(item.normalizedValue)) return POWER_FRACTION_DISPLAY[item.normalizedValue] ?? decimalDisplay(value, 1_000_000n, "W");
  const exactRule = (EXACT_UNIT_RULES as Readonly<Record<string, ExactUnitRule>>)[item.code];
  if (exactRule && /^\d+$/.test(item.normalizedValue)) {
    return scaledDisplay(value, exactRule.displayUnits.map((unit) => ({ factor: BigInt(unit.factor), suffix: unit.suffix })));
  }
  return item.normalizedValue;
}

function buildPassive(input: GovernanceSourceInput, category: "RES" | "CAP" | "IND", text: string): Readonly<{ components: GovernanceComponent[]; issues: GovernanceIssue[] }> {
  const components: GovernanceComponent[] = [];
  const issues: GovernanceIssue[] = [];
  const vendor = category === "RES" ? vendorResistor(input) : null;
  const explicitPackage = parsePackage(text);
  addParsedConflict(
    issues,
    explicitPackage,
    "GOVERNANCE_PACKAGE_CONFLICT",
    "package",
    "同一来源存在冲突的封装规格",
    "PACKAGE",
    vendor?.packageCode,
  );
  const packageValue = vendor
    ? parsedCandidate(vendor.packageCode, vendor.packageCode, vendor.evidence)
    : explicitPackage.selected;
  if (packageValue) components.push(component("PACKAGE", "IDENTITY", packageValue.value, packageValue.value, null, packageValue.evidence));
  else issues.push(issue("GOVERNANCE_PACKAGE_MISSING", "package", "缺少可确认的封装"));

  if (category === "RES") {
    const explicitResistance = parseResistance(text);
    const explicitTolerance = parseTolerance(text, category);
    const explicitPower = parsePower(text, explicitPackage.selected?.value ?? vendor?.packageCode ?? null);
    addParsedConflict(issues, explicitResistance, "GOVERNANCE_RESISTANCE_CONFLICT", "resistance", "同一来源存在冲突或无法一致归一的阻值", "RESISTANCE", vendor ? String(vendor.resistanceMicroohm) : undefined);
    addParsedConflict(issues, explicitTolerance, "GOVERNANCE_TOLERANCE_CONFLICT", "tolerance", "同一来源存在冲突或无法一致归一的精度", "TOLERANCE", vendor?.tolerancePercent);
    addParsedConflict(issues, explicitPower, "GOVERNANCE_POWER_CONFLICT", "power", "同一来源存在冲突或无法一致归一的功率", "POWER", vendor?.powerMicrowatt);
    const resistance = vendor
      ? parsedCandidate(vendor.resistanceMicroohm, resistanceDisplay(vendor.resistanceMicroohm), vendor.evidence)
      : explicitResistance.selected;
    if (resistance) components.push(component("RESISTANCE", "IDENTITY", String(resistance.value), resistance.display, "uohm", resistance.evidence));
    else issues.push(issue("GOVERNANCE_RESISTANCE_MISSING", "resistance", "缺少可确认的阻值"));
    const tolerance = vendor
      ? parsedCandidate(vendor.tolerancePercent, vendor.tolerancePercent, vendor.evidence)
      : explicitTolerance.selected;
    if (tolerance) components.push(component("TOLERANCE", "PERFORMANCE", tolerance.value, tolerance.display, "%", tolerance.evidence));
    else issues.push(issue("GOVERNANCE_TOLERANCE_MISSING", "tolerance", "缺少可确认的精度"));
    const power = vendor
      ? parsedCandidate(vendor.powerMicrowatt, POWER_FRACTION_DISPLAY[vendor.powerMicrowatt] ?? `${vendor.powerMicrowatt}uW`, vendor.evidence)
      : explicitPower.selected;
    if (power) components.push(component("POWER", "PERFORMANCE", power.value, power.display, "uW", power.evidence));
    else issues.push(issue("GOVERNANCE_POWER_MISSING", "power", "缺少可确认的功率"));
  }

  if (category === "CAP") {
    const capacitance = parseConfiguredUnit(text, EXACT_UNIT_RULES.CAPACITANCE, "EXPLICIT_CAPACITANCE_TOKEN");
    addParsedConflict(issues, capacitance, "GOVERNANCE_CAPACITANCE_CONFLICT", "capacitance", "同一来源存在冲突或无法一致归一的容量", "CAPACITANCE");
    if (capacitance.selected) components.push(component("CAPACITANCE", "IDENTITY", String(capacitance.selected.value), capacitance.selected.display, EXACT_UNIT_RULES.CAPACITANCE.canonicalUnit, capacitance.selected.evidence));
    else issues.push(issue("GOVERNANCE_CAPACITANCE_MISSING", "capacitance", "缺少可确认的容量"));
    const voltage = parseConfiguredUnit(text, EXACT_UNIT_RULES.VOLTAGE, "EXPLICIT_VOLTAGE_TOKEN");
    addParsedConflict(issues, voltage, "GOVERNANCE_VOLTAGE_CONFLICT", "voltage", "同一来源存在冲突或无法一致归一的额定电压", "VOLTAGE");
    if (voltage.selected) components.push(component("VOLTAGE", "IDENTITY", String(voltage.selected.value), voltage.selected.display, EXACT_UNIT_RULES.VOLTAGE.canonicalUnit, voltage.selected.evidence));
    else issues.push(issue("GOVERNANCE_VOLTAGE_MISSING", "voltage", "缺少可确认的额定电压"));
    const dielectric = parseDielectric(text);
    addParsedConflict(issues, dielectric, "GOVERNANCE_DIELECTRIC_CONFLICT", "dielectric", "同一来源存在冲突的介质/材质", "DIELECTRIC");
    if (dielectric.selected) components.push(component("DIELECTRIC", "IDENTITY", dielectric.selected.value, dielectric.selected.display, null, dielectric.selected.evidence));
    else issues.push(issue("GOVERNANCE_DIELECTRIC_MISSING", "dielectric", "缺少可确认的介质/材质"));
    const tolerance = parseTolerance(text, category);
    addParsedConflict(issues, tolerance, "GOVERNANCE_TOLERANCE_CONFLICT", "tolerance", "同一来源存在冲突或无法一致归一的精度", "TOLERANCE");
    if (tolerance.selected) components.push(component("TOLERANCE", "PERFORMANCE", tolerance.selected.value, tolerance.selected.display, "%", tolerance.selected.evidence));
    else issues.push(issue("GOVERNANCE_TOLERANCE_MISSING", "tolerance", "缺少可确认的精度"));
  }

  if (category === "IND") {
    const inductance = parseConfiguredUnit(text, EXACT_UNIT_RULES.INDUCTANCE, "EXPLICIT_INDUCTANCE_TOKEN");
    addParsedConflict(issues, inductance, "GOVERNANCE_INDUCTANCE_CONFLICT", "inductance", "同一来源存在冲突或无法一致归一的电感值", "INDUCTANCE");
    if (inductance.selected) components.push(component("INDUCTANCE", "IDENTITY", String(inductance.selected.value), inductance.selected.display, EXACT_UNIT_RULES.INDUCTANCE.canonicalUnit, inductance.selected.evidence));
    else issues.push(issue("GOVERNANCE_INDUCTANCE_MISSING", "inductance", "缺少可确认的电感值"));
    const current = parseConfiguredUnit(text, EXACT_UNIT_RULES.RATED_CURRENT, "EXPLICIT_CURRENT_TOKEN");
    addParsedConflict(issues, current, "GOVERNANCE_RATED_CURRENT_CONFLICT", "rated_current", "同一来源存在冲突或无法一致归一的额定电流", "RATED_CURRENT");
    if (current.selected) components.push(component("RATED_CURRENT", "IDENTITY", String(current.selected.value), current.selected.display, EXACT_UNIT_RULES.RATED_CURRENT.canonicalUnit, current.selected.evidence));
    else issues.push(issue("GOVERNANCE_RATED_CURRENT_MISSING", "rated_current", "缺少可确认的额定电流"));
    const tolerance = parseTolerance(text, category);
    addParsedConflict(issues, tolerance, "GOVERNANCE_TOLERANCE_CONFLICT", "tolerance", "同一来源存在冲突或无法一致归一的精度", "TOLERANCE");
    if (tolerance.selected) components.push(component("TOLERANCE", "PERFORMANCE", tolerance.selected.value, tolerance.selected.display, "%", tolerance.selected.evidence));
    else issues.push(issue("GOVERNANCE_TOLERANCE_MISSING", "tolerance", "缺少可确认的精度"));
  }
  return { components, issues };
}

function buildModelCategory(input: GovernanceSourceInput, category: Exclude<GovernanceCategory, "RES" | "CAP" | "IND" | "MECH" | "OTHER">, text: string): Readonly<{ components: GovernanceComponent[]; issues: GovernanceIssue[] }> {
  const components: GovernanceComponent[] = [];
  const issues: GovernanceIssue[] = [];
  const model = parseModel(input);
  if (model.selected) components.push(component("MODEL", "IDENTITY", model.selected.value, model.selected.display, null, model.selected.evidence));
  else issues.push(issue("GOVERNANCE_MODEL_MISSING", "model", "缺少可确认的完整型号"));
  addParsedConflict(issues, model, "GOVERNANCE_MODEL_CONFLICT", "model", "显式型号与制造商料号冲突", "MODEL");
  if (category !== "CON") {
    const packageValue = parsePackage(text, model.selected?.value ?? "", category);
    addParsedConflict(issues, packageValue, "GOVERNANCE_PACKAGE_CONFLICT", "package", "显式封装与型号解码封装冲突", "PACKAGE");
    if (category === "IC" && packageValue.selected && !/^(?:SOT|SC|SOP|SSOP|TSSOP|QFN|DFN|BGA|LGA)/.test(packageValue.selected.value)) {
      issues.push(issue("GOVERNANCE_IC_PACKAGE_UNSUPPORTED", "package", "IC 封装尚无可用的正式主数据分类", packageValue.selected.evidence));
    }
    if (packageValue.selected) components.push(component("PACKAGE", "IDENTITY", packageValue.selected.value, packageValue.selected.display, null, packageValue.selected.evidence));
    else issues.push(issue("GOVERNANCE_PACKAGE_MISSING", "package", "缺少可确认的封装"));
  }
  if (category === "CON") {
    const brand = parseBrand(input);
    addParsedConflict(issues, brand, "GOVERNANCE_BRAND_CONFLICT", "brand", "连接器品牌与制造商字段冲突", "BRAND");
    if (brand.selected) components.push(component("BRAND", "IDENTITY", brand.selected.value, brand.selected.display, null, brand.selected.evidence));
    else issues.push(issue("GOVERNANCE_BRAND_MISSING", "brand", "连接器缺少品牌"));
    const pins = parsePinCount(text);
    addParsedConflict(issues, pins, "GOVERNANCE_PIN_COUNT_CONFLICT", "pin_count", "同一来源存在冲突的 PIN 数", "PIN_COUNT");
    if (pins.selected) components.push(component("PIN_COUNT", "IDENTITY", pins.selected.value, pins.selected.display, "pin", pins.selected.evidence));
    else issues.push(issue("GOVERNANCE_PIN_COUNT_MISSING", "pin_count", "连接器缺少 PIN 数"));
    const pitch = parsePitch(text);
    addParsedConflict(issues, pitch, "GOVERNANCE_PITCH_CONFLICT", "pitch", "同一来源存在冲突或无法一致归一的间距", "PITCH");
    if (pitch.selected) components.push(component("PITCH", "IDENTITY", String(pitch.selected.value), pitch.selected.display, EXACT_UNIT_RULES.PITCH.canonicalUnit, pitch.selected.evidence));
    else issues.push(issue("GOVERNANCE_PITCH_MISSING", "pitch", "连接器缺少间距"));
    const structure = parseStructure(text);
    addParsedConflict(issues, structure, "GOVERNANCE_STRUCTURE_CONFLICT", "structure", "同一来源存在冲突的连接器结构", "STRUCTURE");
    if (structure.selected) components.push(component("STRUCTURE", "IDENTITY", structure.selected.value, structure.selected.display, null, structure.selected.evidence));
    else issues.push(issue("GOVERNANCE_STRUCTURE_MISSING", "structure", "连接器缺少结构"));
  }
  if (category === "OSC") {
    const frequency = parseFrequency(text);
    addParsedConflict(issues, frequency, "GOVERNANCE_FREQUENCY_CONFLICT", "frequency", "同一来源存在冲突或无法一致归一的晶振频率", "FREQUENCY");
    if (frequency.selected) components.push(component("FREQUENCY", "IDENTITY", String(frequency.selected.value), frequency.selected.display, EXACT_UNIT_RULES.FREQUENCY.canonicalUnit, frequency.selected.evidence));
    else issues.push(issue("GOVERNANCE_FREQUENCY_MISSING", "frequency", "晶振缺少频率"));
  }
  return { components, issues };
}

function validateSourceInput(input: GovernanceSourceInput): void {
  const sourceKey = clean(input.sourceKey);
  if (
    !sourceKey
    || sourceKey !== input.sourceKey
    || sourceKey.length > MATERIAL_GOVERNANCE_LIMITS.maxSourceKeyLength
    || /[\u0000-\u001f\u007f]/.test(sourceKey)
  ) throw new Error("GOVERNANCE_SOURCE_KEY_INVALID");
  for (const [field, value] of Object.entries(input)) {
    if (field === "sourceKey" || field === "upstreamIssues" || value === null || value === undefined) continue;
    if (typeof value !== "string" || value.length > MATERIAL_GOVERNANCE_LIMITS.maxSourceFieldLength || /[\u0000\u007f]/.test(value)) {
      throw new Error("GOVERNANCE_SOURCE_FIELD_INVALID");
    }
  }
  if (input.upstreamIssues == null) return;
  if (!Array.isArray(input.upstreamIssues)) throw new Error("GOVERNANCE_SOURCE_FIELD_INVALID");
  if (input.upstreamIssues.length === 0) return;
  if (input.upstreamIssues.length > MATERIAL_GOVERNANCE_LIMITS.maxIssuesPerSource) throw new Error("GOVERNANCE_SOURCE_ISSUE_LIMIT_EXCEEDED");
  for (const upstream of input.upstreamIssues) {
    if (
      !upstream
      || !["ERROR", "WARNING"].includes(upstream.level)
      || !/^[A-Z][A-Z0-9_]{2,99}$/.test(upstream.code)
      || !upstream.field
      || upstream.field.length > 160
      || !upstream.message
      || upstream.message.length > 500
      || /[\u0000\u007f]/.test(`${upstream.field}${upstream.message}`)
      || !Array.isArray(upstream.evidence)
      || upstream.evidence.length > MATERIAL_GOVERNANCE_LIMITS.maxIssuesPerSource
      || upstream.evidence.some((value: unknown) => typeof value !== "string" || value.length > 200 || /[\u0000\u007f]/.test(value))
    ) throw new Error("GOVERNANCE_SOURCE_FIELD_INVALID");
  }
}

export function governMaterialSource(input: GovernanceSourceInput): GovernedSource {
  validateSourceInput(input);
  const text = sourceText(input);
  const classification = classify(input, text);
  const rule = CATEGORY_RULES[classification.category];
  let components: GovernanceComponent[] = [];
  let issues: GovernanceIssue[] = [];
  if (["RES", "CAP", "IND"].includes(classification.category)) {
    ({ components, issues } = buildPassive(input, classification.category as "RES" | "CAP" | "IND", passiveSpecificationText(input)));
  } else if (["DIODE", "TRANS", "IC", "OSC", "CON"].includes(classification.category)) {
    ({ components, issues } = buildModelCategory(input, classification.category as "DIODE" | "TRANS" | "IC" | "OSC" | "CON", modelSpecificationText(input)));
  } else {
    issues = [issue(
      classification.category === "OTHER" ? "GOVERNANCE_CATEGORY_UNRESOLVED" : "GOVERNANCE_CATEGORY_RULE_UNSUPPORTED",
      "category",
      classification.category === "OTHER" ? "无法依据规格证据确定物料类别" : "该类别暂不允许自动生成规格身份",
      classification.evidence,
    )];
  }
  issues = [
    ...(input.upstreamIssues ?? []).map((entry) => issue(entry.code, entry.field, entry.message, entry.evidence, entry.level)),
    ...issues,
  ];
  if (issues.length > MATERIAL_GOVERNANCE_LIMITS.maxIssuesPerSource) throw new Error("GOVERNANCE_SOURCE_ISSUE_LIMIT_EXCEEDED");
  const identity = issues.some((entry) => entry.level === "ERROR") ? null : identityProjection(classification.category, components, [...rule.identityComponents, ...rule.performanceComponents]);
  const compatibility = identityProjection(classification.category, components, rule.compatibilityComponents);
  const readiness = classification.category === "MECH" || classification.category === "OTHER" ? "UNSUPPORTED" : identity ? "READY" : "REVIEW_REQUIRED";
  const canonicalKey = identity
    ? [classification.category, ...[...rule.identityComponents, ...rule.performanceComponents].map((code) => canonicalComponentDisplay(components.find((item) => item.code === code)!).replaceAll("/", "-").replaceAll("±", ""))].join("_").toUpperCase()
    : null;
  const canonicalSpecification = identity
    ? [...rule.identityComponents, ...rule.performanceComponents].map((code) => `${code}=${canonicalComponentDisplay(components.find((item) => item.code === code)!)}`).join("; ")
    : null;
  return Object.freeze({
    source: Object.freeze({ ...input }),
    category: classification.category,
    readiness,
    canonicalKey,
    canonicalSpecification,
    standardName: canonicalKey ? `${rule.standardName} ${canonicalKey.slice(classification.category.length + 1)}` : rule.standardName,
    identityDigest: identity ? sha256(identity) : null,
    compatibilityDigest: compatibility ? sha256(compatibility) : null,
    components: Object.freeze(components),
    issues: Object.freeze(issues),
    ruleVersion: MATERIAL_GOVERNANCE_RULE_VERSION,
  });
}

function supplierCandidates(sources: readonly GovernedSource[]): GovernanceGroup["supplierCandidates"] {
  const seen = new Set<string>();
  const raw: Array<Omit<GovernanceGroup["supplierCandidates"][number], "priority" | "candidateKind">> = [];
  for (const source of sources) {
    const supplier = clean(source.source.supplier) || null;
    const manufacturer = clean(source.source.manufacturer) || null;
    const brand = clean(source.source.brand) || null;
    const originalPartNumber = clean(source.source.originalPartNumber) || null;
    const manufacturerPartNumber = clean(source.source.manufacturerPartNumber) || null;
    const supplierPartNumber = clean(source.source.supplierPartNumber) || null;
    const key = canonicalJson({ supplier, manufacturer, brand, originalPartNumber, manufacturerPartNumber, supplierPartNumber });
    if (!supplier && !manufacturer && !brand && !originalPartNumber && !manufacturerPartNumber && !supplierPartNumber) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    raw.push(Object.freeze({
      sourceKey: source.source.sourceKey,
      supplier,
      manufacturer,
      brand,
      originalPartNumber,
      manufacturerPartNumber,
      supplierPartNumber,
    }));
  }
  raw.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right), "en"));
  return Object.freeze(raw.map((value, index) => Object.freeze({
    ...value,
    priority: index + 1,
    candidateKind: index ? "ALTERNATIVE_SOURCE" as const : "PRIMARY_SOURCE" as const,
  })));
}

export function governMaterialBatch(inputs: readonly GovernanceSourceInput[]): GovernanceBatchResult {
  if (inputs.length > MATERIAL_GOVERNANCE_LIMITS.maxSourceRows) throw new Error("GOVERNANCE_SOURCE_LIMIT_EXCEEDED");
  if (new Set(inputs.map((input) => input.sourceKey)).size !== inputs.length) throw new Error("GOVERNANCE_SOURCE_KEY_DUPLICATE");
  const governed = inputs.map(governMaterialSource);
  const grouped = new Map<string, GovernedSource[]>();
  for (const row of governed) {
    const groupKey = row.identityDigest ?? sha256({ unresolved_source: row.source.sourceKey, rule_version: row.ruleVersion });
    const list = grouped.get(groupKey) ?? [];
    list.push(row);
    grouped.set(groupKey, list);
  }
  const groups: GovernanceGroup[] = [...grouped.entries()].map(([groupKey, sources]) => {
    const first = sources[0];
    return Object.freeze({
      groupKey,
      category: first.category,
      readiness: first.readiness,
      canonicalKey: first.canonicalKey,
      canonicalSpecification: first.canonicalSpecification,
      standardName: first.standardName,
      identityDigest: first.identityDigest,
      compatibilityDigest: first.compatibilityDigest,
      components: first.components,
      sources: Object.freeze(sources),
      mergeEvidence: Object.freeze(sources.length > 1 && first.identityDigest ? [
        "CATEGORY_EQUAL",
        ...CATEGORY_RULES[first.category].identityComponents.map((code) => `${code}_EQUAL`),
        ...CATEGORY_RULES[first.category].performanceComponents.map((code) => `${code}_EQUAL`),
        `RULE_VERSION_${MATERIAL_GOVERNANCE_RULE_VERSION}`,
      ] : []),
      supplierCandidates: supplierCandidates(sources),
    });
  }).sort((left, right) => left.groupKey.localeCompare(right.groupKey, "en"));

  const alternatives: GovernanceAlternativeSuggestion[] = [];
  const alternativeBuckets = new Map<string, GovernanceGroup[]>();
  for (const group of groups) {
    if (group.readiness !== "READY" || !group.identityDigest || !group.compatibilityDigest || !CATEGORY_RULES[group.category].alternativeEligible) continue;
    const key = `${group.category}\u0000${group.compatibilityDigest}`;
    const bucket = alternativeBuckets.get(key) ?? [];
    bucket.push(group);
    alternativeBuckets.set(key, bucket);
  }
  for (const bucket of alternativeBuckets.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const first = bucket[left];
        const second = bucket[right];
        if (first.identityDigest === second.identityDigest) continue;
        if (alternatives.length >= MATERIAL_GOVERNANCE_LIMITS.maxAlternativeCandidates) throw new Error("GOVERNANCE_ALTERNATIVE_LIMIT_EXCEEDED");
        alternatives.push(Object.freeze({
          mainGroupKey: first.groupKey,
          alternativeGroupKey: second.groupKey,
          category: first.category,
          compatibilityDigest: first.compatibilityDigest!,
          evidence: Object.freeze(["CATEGORY_EQUAL", "COMPATIBILITY_COMPONENTS_EQUAL", "IDENTITY_COMPONENTS_DIFFER"]),
        }));
      }
    }
  }
  return Object.freeze({
    ruleVersion: MATERIAL_GOVERNANCE_RULE_VERSION,
    groups: Object.freeze(groups),
    exceptions: Object.freeze(governed.filter((row) => row.readiness !== "READY")),
    alternativeSuggestions: Object.freeze(alternatives),
  });
}
