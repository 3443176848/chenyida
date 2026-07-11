import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const profileUrl = new URL("../../config/environments.json", import.meta.url);
const profiles = JSON.parse(readFileSync(profileUrl, "utf8"));
const environmentNames = new Set(["development", "test", "production"]);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export function getEnvironmentProfiles() {
  return structuredClone(profiles);
}

export function resolveEnvironment(source = process.env) {
  const name = String(source.ERP_ENV || "development").trim().toLowerCase();
  if (!environmentNames.has(name)) {
    throw new Error(`ERP_ENV must be development, test, or production; received ${name || "<empty>"}`);
  }
  const profile = profiles[name];
  return {
    name,
    database: source.ERP_DATABASE || profile.database,
    apiUrl: source.ERP_API_URL || profile.apiUrl,
    siteUrl: source.ERP_SITE_URL || profile.siteUrl,
    logLevel: source.ERP_LOG_LEVEL || profile.logLevel,
    debug: source.ERP_DEBUG === undefined ? profile.debug : source.ERP_DEBUG === "true",
  };
}

function isPathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function assertSafeTestTarget(source = process.env) {
  const environment = resolveEnvironment(source);
  if (environment.name !== "test") {
    throw new Error(`Refusing test operation because ERP_ENV is ${environment.name}; ERP_ENV=test is required`);
  }

  const rawUrl = source.ERP_TEST_URL || environment.siteUrl;
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Refusing test operation because ERP_TEST_URL is not a valid URL");
  }
  if (target.protocol !== "http:" || !loopbackHosts.has(target.hostname)) {
    throw new Error("Refusing test operation: the current baseline only permits an HTTP loopback test URL");
  }

  const persistencePath = source.ERP_D1_PERSIST_PATH;
  if (!persistencePath || !isAbsolute(persistencePath) || !isPathInside(tmpdir(), persistencePath)) {
    throw new Error("Refusing test operation: ERP_D1_PERSIST_PATH must be an absolute path inside the operating-system temporary directory");
  }
  const tempRelativePath = relative(resolve(tmpdir()), resolve(persistencePath));
  const testRootName = tempRelativePath.split(sep)[0];
  if (!testRootName.startsWith("chenyida-erp-test-")) {
    throw new Error("Refusing test operation: the temporary D1 path is missing the chenyida-erp-test marker");
  }

  return { environment, target, persistencePath: resolve(persistencePath) };
}

export function redactSensitiveText(value, source = process.env) {
  let output = String(value || "");
  const sensitiveNames = [
    "ERP_SETUP_TOKEN",
    "ERP_TEST_SETUP_TOKEN",
    "ERP_TEST_PASSWORD",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
  ];
  for (const name of sensitiveNames) {
    const secret = source[name];
    if (secret) output = output.replaceAll(secret, `[redacted:${name}]`);
  }
  return output
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]")
    .replace(/(cookie\s*[:=]\s*)([^\r\n]+)/gi, "$1[redacted]")
    .replace(/((?:password|token|secret)\s*["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi, "$1[redacted]");
}
