export const MAX_EXACT_DECIMAL_SCALE = 18;
export const MAX_EXACT_DECIMAL_DIGITS = 30;

function expandScientific(value: string): string | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  const digits = `${match[2]}${match[3] ?? ""}`;
  const point = match[2].length + exponent;
  const unsigned = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${match[1]}${unsigned}`;
}

function safeNumberText(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  const text = String(value);
  if (!Number.isInteger(value)) {
    const coefficient = text.split(/[eE]/)[0].replace(/^[+-]/, "");
    const significantDigits = coefficient.replace(".", "").replace(/^0+/, "").length;
    if (significantDigits > 15) return null;
  }
  return expandScientific(text);
}

export function normalizeExactDecimal(value: unknown, scale: number): string | null {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_EXACT_DECIMAL_SCALE) return null;
  let text: string | null;
  if (typeof value === "string") {
    if (value !== value.trim() || /[eE]/.test(value)) return null;
    text = value;
  } else if (typeof value === "number") {
    text = safeNumberText(value);
  } else {
    return null;
  }
  if (text === null || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [wholeRaw, fraction = ""] = unsigned.startsWith(".") ? ["0", unsigned.slice(1)] : unsigned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  if (fraction.length > scale || whole.length + fraction.length > MAX_EXACT_DECIMAL_DIGITS) return null;
  const zero = /^0+$/.test(whole) && (!fraction || /^0+$/.test(fraction));
  const sign = negative && !zero ? "-" : "";
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction.padEnd(scale, "0")}`;
}
