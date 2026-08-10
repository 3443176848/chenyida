import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error("CANONICAL_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("CANONICAL_VALUE_INVALID");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en")).map((key) => {
    if (record[key] === undefined) throw new Error("CANONICAL_UNDEFINED_INVALID");
    return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
  }).join(",")}}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function canonicalPrettyJson(value: unknown): string {
  return `${JSON.stringify(canonicalClone(value), null, 2)}\n`;
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right, "en")));
}
