import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { IdentityError } from "./errors.ts";

const pbkdf2 = promisify(pbkdf2Callback);
export const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_BYTES = 32;
const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,31}$/;
const DUMMY_HASH = `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${"0".repeat(32)}$${"0".repeat(64)}`;
const WEAK_FRAGMENTS = ["password", "qwerty", "letmein", "welcome", "changeme", "admin123", "123456"];

export function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function validateUsername(value: unknown): string {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    throw new IdentityError("USERNAME_INVALID", "用户名格式不正确");
  }
  return username;
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function validateDisplayName(value: unknown): string {
  const displayName = String(value ?? "").trim();
  if (displayName.length < 1 || displayName.length > 128 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new IdentityError("DISPLAY_NAME_INVALID", "显示名称不能为空且最多 128 个字符");
  }
  return displayName;
}

export function validatePassword(passwordValue: unknown, username: string): string {
  const password = String(passwordValue ?? "");
  if (password.length < 12 || password.length > 128) {
    throw new IdentityError("PASSWORD_WEAK", "密码长度必须为 12—128 位");
  }
  const categories = [/[A-Z]/.test(password), /[a-z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  if (categories < 3) {
    throw new IdentityError("PASSWORD_WEAK", "密码必须包含大写字母、小写字母、数字和特殊字符中的至少三类");
  }
  const lowered = password.toLowerCase();
  if (username && lowered.includes(username.toLowerCase())) {
    throw new IdentityError("PASSWORD_CONTAINS_USERNAME", "密码不得包含完整用户名");
  }
  if (WEAK_FRAGMENTS.some((fragment) => lowered.includes(fragment)) || /^(.)\1{11,}$/.test(password)) {
    throw new IdentityError("PASSWORD_WEAK", "密码属于已知默认密码或常见弱密码");
  }
  return password;
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  const size = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length;
}

export function assertPasswordChanged(oldPassword: string, newPassword: string): void {
  if (constantTimeTextEqual(oldPassword, newPassword)) {
    throw new IdentityError("PASSWORD_UNCHANGED", "新密码不能与旧密码相同");
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const value = await pbkdf2(password, salt, PASSWORD_ITERATIONS, PASSWORD_BYTES, "sha256");
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${value.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash?: string | null): Promise<boolean> {
  const stored = storedHash || DUMMY_HASH;
  const [kind, iterationsText, salt, expectedHex, extra] = stored.split("$");
  const iterations = Number(iterationsText);
  const valid = kind === "pbkdf2_sha256"
    && extra === undefined
    && /^[0-9a-f]{32}$/i.test(salt || "")
    && /^[0-9a-f]{64}$/i.test(expectedHex || "")
    && Number.isSafeInteger(iterations)
    && iterations >= PASSWORD_ITERATIONS;
  const effectiveSalt = valid ? salt : "0".repeat(32);
  const effectiveIterations = valid ? iterations : PASSWORD_ITERATIONS;
  const expected = Buffer.from(valid ? expectedHex : "0".repeat(64), "hex");
  const actual = await pbkdf2(password, effectiveSalt, effectiveIterations, PASSWORD_BYTES, "sha256");
  return valid && actual.length === expected.length && timingSafeEqual(actual, expected);
}
