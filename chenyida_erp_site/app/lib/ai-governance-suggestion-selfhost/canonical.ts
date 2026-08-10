import { createHash } from "node:crypto";

function normalizedString(value: string): string {
  return value.normalize("NFKC");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(normalizedString(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error("AI_CANONICAL_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("AI_CANONICAL_VALUE_INVALID");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en")).map((key) => {
    if (record[key] === undefined) throw new Error("AI_CANONICAL_UNDEFINED_INVALID");
    return `${JSON.stringify(normalizedString(key))}:${canonicalJson(record[key])}`;
  }).join(",")}}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function normalizeIdentity(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase().replaceAll("μ", "U").replaceAll("µ", "U");
}

export function stableSort<T>(values: readonly T[], projection: (value: T) => unknown): readonly T[] {
  return [...values].sort((left, right) => canonicalJson(projection(left)).localeCompare(canonicalJson(projection(right)), "en"));
}
