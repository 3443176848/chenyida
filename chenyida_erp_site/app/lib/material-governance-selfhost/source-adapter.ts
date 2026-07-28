import type { QueryResultRow } from "pg";
import { MASTER_CATEGORY_GOVERNANCE_MAP } from "./config.ts";
import type { GovernanceCategory, GovernanceIssue, GovernanceSourceInput } from "./types.ts";
import type { ValidatedDraft } from "../material-selfhost/types.ts";

export function plainDecimal(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return text;
  const digits = `${match[2]}${match[3] ?? ""}`;
  const point = match[2].length + exponent;
  const unsigned = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${match[1]}${unsigned}`;
}

function governanceCategory(categoryCode: unknown): GovernanceCategory | null {
  const code = String(categoryCode ?? "").trim().toUpperCase();
  return MASTER_CATEGORY_GOVERNANCE_MAP[code] ?? null;
}

function categoryPackageCompatible(categoryCode: unknown, packageCode: string): boolean {
  const category = String(categoryCode ?? "").trim().toUpperCase();
  const packageValue = packageCode.trim().toUpperCase();
  if (!packageValue) return true;
  if (category === "IC_BGA") return packageValue.startsWith("BGA");
  if (category === "IC_QFN") return packageValue.startsWith("QFN");
  if (category === "IC_SOT") return /^(?:SOT|SC)/.test(packageValue);
  if (category === "IC_SMD_OTHER") return /^(?:SOP|SSOP|TSSOP|DFN|LGA)/.test(packageValue);
  return true;
}

function normalizedIdentityText(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase().replaceAll("μ", "U").replaceAll("µ", "U");
}

function sourceFromFields(input: Readonly<{
  sourceKey: string;
  categoryCode: unknown;
  brand: unknown;
  manufacturer: unknown;
  manufacturerPartNumber: unknown;
  attributes: readonly Readonly<{ code: unknown; value: unknown; unit: unknown }>[];
  draftLike: boolean;
}>): GovernanceSourceInput | null {
  const category = governanceCategory(input.categoryCode);
  if (!category) return null;
  const byCode = new Map(input.attributes.map((attribute) => [String(attribute.code ?? "").toUpperCase(), attribute]));
  const attribute = (code: string): string => String(byCode.get(code)?.value ?? "").trim();
  const withUnit = (code: string, fallback: string): string => {
    const item = byCode.get(code);
    if (!item || item.value == null || String(item.value).trim() === "") return "";
    return `${plainDecimal(item.value)}${String(item.unit ?? fallback).trim()}`;
  };
  const tolerance = attribute("TOLERANCE").replace(/%$/, "");
  // New and edited drafts must obey the current category/package contract.
  // Historical formal rows predate that contract, so keep their explicit
  // model/package visible to the global identity scan instead of failing open.
  if (input.draftLike && !categoryPackageCompatible(input.categoryCode, attribute("PACKAGE"))) return null;
  const basicBrand = String(input.brand ?? "").trim();
  const structuredBrand = attribute("BRAND");
  const formalIssues: GovernanceIssue[] = [];
  if (category === "CON" && basicBrand && structuredBrand && normalizedIdentityText(basicBrand) !== normalizedIdentityText(structuredBrand)) {
    formalIssues.push({
      level: "ERROR",
      code: "GOVERNANCE_FORMAL_BRAND_CONFLICT",
      field: "brand",
      message: "正式主数据的基础品牌与结构化 BRAND 不一致",
      evidence: ["BASIC_AND_ATTRIBUTE_VALUES_DIFFER"],
    });
  }
  const tokens = [
    attribute("PACKAGE"),
    withUnit("RESISTANCE", "ohm"),
    withUnit("CAPACITANCE", "F"),
    withUnit("RATED_VOLTAGE", "V") || withUnit("VOLTAGE", "V"),
    attribute("DIELECTRIC"),
    withUnit("INDUCTANCE", "H"),
    withUnit("RATED_CURRENT", "A"),
    withUnit("POWER", "W"),
    tolerance ? `${tolerance}%` : "",
    attribute("PIN_COUNT") ? `${attribute("PIN_COUNT")}PIN` : "",
    withUnit("PITCH", "mm"),
    attribute("STRUCTURE"),
    withUnit("FREQUENCY", "Hz"),
  ].filter(Boolean);
  const basicMpn = String(input.manufacturerPartNumber ?? "").trim();
  const model = attribute("MODEL") || attribute("MPN") || basicMpn;
  return {
    sourceKey: input.sourceKey,
    originalPartNumber: (input.draftLike ? basicMpn || model : model) || null,
    manufacturerPartNumber: (input.draftLike ? basicMpn || model : basicMpn) || null,
    supplierPartNumber: null,
    model: model || null,
    specification: tokens.join(" ") || null,
    categoryHint: category,
    brand: basicBrand || structuredBrand || null,
    manufacturer: String(input.manufacturer ?? "").trim() || null,
    upstreamIssues: formalIssues,
  };
}

export function materialSource(row: QueryResultRow): GovernanceSourceInput | null {
  const attributes = Array.isArray(row.attributes) ? row.attributes as Record<string, unknown>[] : [];
  return sourceFromFields({
    sourceKey: `MATERIAL-${Number(row.id)}`,
    categoryCode: row.category_code,
    brand: row.brand,
    manufacturer: row.manufacturer,
    manufacturerPartNumber: row.manufacturer_part_number,
    attributes: attributes.map((attribute) => ({ code: attribute.code, value: attribute.value, unit: attribute.unit })),
    draftLike: false,
  });
}

export function draftSource(draft: Record<string, unknown>, categoryCode: string): GovernanceSourceInput | null {
  const basic = draft.basic_fields && typeof draft.basic_fields === "object" && !Array.isArray(draft.basic_fields)
    ? draft.basic_fields as Record<string, unknown>
    : {};
  const attributes = draft.attributes && typeof draft.attributes === "object" && !Array.isArray(draft.attributes)
    ? draft.attributes as Record<string, unknown>
    : {};
  return sourceFromFields({
    sourceKey: "DRAFT-IDENTITY-CHECK",
    categoryCode,
    brand: basic.brand,
    manufacturer: basic.manufacturer,
    manufacturerPartNumber: basic.manufacturer_part_number,
    attributes: Object.entries(attributes).map(([code, raw]) => {
      const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      return { code, value: entry.value, unit: entry.unit };
    }),
    draftLike: true,
  });
}

export function validatedDraftSource(draft: ValidatedDraft, materialId: number): GovernanceSourceInput | null {
  return sourceFromFields({
    sourceKey: `MATERIAL-${materialId}`,
    categoryCode: draft.categoryCode,
    brand: draft.basic.brand,
    manufacturer: draft.basic.manufacturer,
    manufacturerPartNumber: draft.basic.manufacturer_part_number,
    attributes: draft.attributes.map((attribute) => ({
      code: attribute.attributeCode,
      value: attribute.normalizedValue,
      unit: attribute.unitCode,
    })),
    draftLike: true,
  });
}
