export class StrictMonitoringJsonError extends Error {
  constructor(code) {
    super(code);
    this.name = "StrictMonitoringJsonError";
    this.code = code;
  }
}

function reject(code) {
  throw new StrictMonitoringJsonError(code);
}

class StrictJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    this.space();
    const value = this.value();
    this.space();
    if (this.index !== this.source.length) reject("JSON_TRAILING_CONTENT");
    return value;
  }

  space() {
    while (this.index < this.source.length && /[\u0009\u000a\u000d\u0020]/.test(this.source[this.index])) this.index += 1;
  }

  value() {
    this.space();
    const character = this.source[this.index];
    if (character === "{") return this.object();
    if (character === "[") return this.array();
    if (character === '"') return this.string();
    if (character === "t" && this.source.slice(this.index, this.index + 4) === "true") { this.index += 4; return true; }
    if (character === "f" && this.source.slice(this.index, this.index + 5) === "false") { this.index += 5; return false; }
    if (character === "n" && this.source.slice(this.index, this.index + 4) === "null") { this.index += 4; return null; }
    return this.number();
  }

  string() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        let value;
        try { value = JSON.parse(this.source.slice(start, this.index)); } catch { reject("JSON_STRING_INVALID"); }
        if (typeof value !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) reject("JSON_STRING_INVALID");
        return value;
      }
      if (code < 0x20) reject("JSON_STRING_INVALID");
      if (code === 0x5c) {
        this.index += 1;
        const escaped = this.source[this.index];
        if (!'"\\/bfnrtu'.includes(escaped || "")) reject("JSON_ESCAPE_INVALID");
        if (escaped === "u") {
          const digits = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) reject("JSON_ESCAPE_INVALID");
          this.index += 4;
        }
      }
      this.index += 1;
    }
    reject("JSON_STRING_INCOMPLETE");
  }

  number() {
    const remaining = this.source.slice(this.index);
    const match = remaining.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) reject("JSON_VALUE_INVALID");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || Object.is(value, -0)) reject("JSON_NUMBER_INVALID");
    return value;
  }

  object() {
    const result = {};
    const keys = new Set();
    this.index += 1;
    this.space();
    if (this.source[this.index] === "}") { this.index += 1; return result; }
    while (this.index < this.source.length) {
      this.space();
      if (this.source[this.index] !== '"') reject("JSON_KEY_INVALID");
      const key = this.string();
      if (keys.has(key)) reject("JSON_DUPLICATE_KEY");
      keys.add(key);
      this.space();
      if (this.source[this.index] !== ":") reject("JSON_COLON_REQUIRED");
      this.index += 1;
      result[key] = this.value();
      this.space();
      if (this.source[this.index] === "}") { this.index += 1; return result; }
      if (this.source[this.index] !== ",") reject("JSON_SEPARATOR_REQUIRED");
      this.index += 1;
    }
    reject("JSON_OBJECT_INCOMPLETE");
  }

  array() {
    const result = [];
    this.index += 1;
    this.space();
    if (this.source[this.index] === "]") { this.index += 1; return result; }
    while (this.index < this.source.length) {
      result.push(this.value());
      this.space();
      if (this.source[this.index] === "]") { this.index += 1; return result; }
      if (this.source[this.index] !== ",") reject("JSON_SEPARATOR_REQUIRED");
      this.index += 1;
    }
    reject("JSON_ARRAY_INCOMPLETE");
  }
}

export function parseStrictMonitoringJson(source, maximumBytes = 1024 * 1024) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2 || maximumBytes > 64 * 1024 * 1024) reject("JSON_SIZE_INVALID");
  if (typeof source !== "string" || Buffer.byteLength(source) > maximumBytes) reject("JSON_SIZE_INVALID");
  return new StrictJsonParser(source).parse();
}
