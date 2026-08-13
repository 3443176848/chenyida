import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  ClusterRecoveryError,
  canonicalClusterJson,
  normalizeClusterCatalog,
  validateClusterCatalog,
  validateClusterRecoveryPolicy,
} from "./postgresql-cluster-recovery-contract.mjs";

export const CLUSTER_CATALOG_REPORT_CONTRACT = "chenyida-erp-postgresql-cluster-catalog-report/v1";
export const CLUSTER_CATALOG_SQL_FILENAME = "postgresql-cluster-catalog.sql";

const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;
const RECORD_TYPES = new Set([
  "DATABASE", "ROLE", "MEMBERSHIP", "SETTING", "OBJECT", "DEFAULT_PRIVILEGE",
  "TABLESPACE", "EXTENSION", "PUBLICATION", "PARAMETER_PRIVILEGE", "UNSUPPORTED",
]);
const ARRAY_RECORDS = Object.freeze({
  ROLE: "roles",
  MEMBERSHIP: "memberships",
  SETTING: "settings",
  OBJECT: "objects",
  DEFAULT_PRIVILEGE: "default_privileges",
  TABLESPACE: "tablespaces",
  EXTENSION: "extensions",
  PUBLICATION: "publications",
  PARAMETER_PRIVILEGE: "parameter_privileges",
});

function reject(code) {
  throw new ClusterRecoveryError(code);
}

function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

async function readStableFile(file, maxBytes, code) {
  const resolved = path.resolve(file);
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > maxBytes || (before.mode & 0o022) !== 0) reject(code);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pointed = await lstat(resolved).catch(() => reject("CLUSTER_CATALOG_FILE_CHANGED"));
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "uid", "gid", "mode", "nlink"]) {
      if (before[key] !== after[key] || after[key] !== pointed[key]) reject("CLUSTER_CATALOG_FILE_CHANGED");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseRecordLine(line, lineNumber) {
  const separator = line.indexOf("\t");
  if (separator <= 0 || line.indexOf("\t", separator + 1) !== -1) reject("CLUSTER_CATALOG_REPORT_LINE_INVALID");
  const type = line.slice(0, separator);
  if (!RECORD_TYPES.has(type)) reject("CLUSTER_CATALOG_REPORT_TYPE_INVALID");
  let payload;
  try {
    payload = parseStrictJson(line.slice(separator + 1));
  } catch (error) {
    if (error?.code === "JSON_DUPLICATE_KEY") reject("CLUSTER_CATALOG_REPORT_DUPLICATE_KEY");
    reject("CLUSTER_CATALOG_REPORT_JSON_INVALID");
  }
  object(payload, "CLUSTER_CATALOG_REPORT_PAYLOAD_INVALID");
  return { type, payload, lineNumber };
}

export function parseClusterCatalogReport(source, policyInput) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source, "utf8") > MAX_REPORT_BYTES
    || source.includes("\u0000") || !source.endsWith("\n") || source.includes("\r")) reject("CLUSTER_CATALOG_REPORT_INVALID");
  const lines = source.slice(0, -1).split("\n");
  if (lines.length < 2 || lines.some((line) => line.length === 0)) reject("CLUSTER_CATALOG_REPORT_INVALID");
  const catalog = {
    database: null,
    roles: [],
    memberships: [],
    settings: [],
    objects: [],
    default_privileges: [],
    tablespaces: [],
    extensions: [],
    publications: [],
    parameter_privileges: [],
    unsupported: null,
  };
  let lastPhase = -1;
  const phase = Object.freeze({
    DATABASE: 0, ROLE: 1, MEMBERSHIP: 2, SETTING: 3, OBJECT: 4, DEFAULT_PRIVILEGE: 5,
    TABLESPACE: 6, EXTENSION: 7, PUBLICATION: 8, PARAMETER_PRIVILEGE: 9, UNSUPPORTED: 10,
  });
  for (const [index, line] of lines.entries()) {
    const parsed = parseRecordLine(line, index + 1);
    if (phase[parsed.type] < lastPhase) reject("CLUSTER_CATALOG_REPORT_ORDER_INVALID");
    lastPhase = phase[parsed.type];
    if (parsed.type === "DATABASE") {
      if (catalog.database !== null) reject("CLUSTER_CATALOG_REPORT_DATABASE_DUPLICATE");
      catalog.database = parsed.payload;
    } else if (parsed.type === "UNSUPPORTED") {
      if (catalog.unsupported !== null) reject("CLUSTER_CATALOG_REPORT_UNSUPPORTED_DUPLICATE");
      catalog.unsupported = parsed.payload;
    } else {
      catalog[ARRAY_RECORDS[parsed.type]].push(parsed.payload);
    }
  }
  if (catalog.database === null || catalog.unsupported === null) reject("CLUSTER_CATALOG_REPORT_REQUIRED_RECORD_MISSING");
  const normalized = normalizeClusterCatalog(catalog);
  return validateClusterCatalog(normalized, policy);
}

export async function readClusterCatalogReport({ reportFile, policy }) {
  const source = await readStableFile(reportFile, MAX_REPORT_BYTES, "CLUSTER_CATALOG_REPORT_FILE_UNSAFE");
  return parseClusterCatalogReport(source.toString("utf8"), policy);
}

async function readPolicy(file) {
  const source = await readStableFile(file, MAX_POLICY_BYTES, "CLUSTER_POLICY_FILE_UNSAFE");
  let value;
  try { value = parseStrictJson(source.toString("utf8")); } catch { reject("CLUSTER_POLICY_FILE_INVALID"); }
  return validateClusterRecoveryPolicy(value);
}

async function writeExclusiveCanonical(file, value) {
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  const parentMetadata = await lstat(parent).catch(() => reject("CLUSTER_CATALOG_OUTPUT_ROOT_UNSAFE"));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || parentMetadata.uid !== process.getuid?.() || (parentMetadata.mode & 0o022) !== 0) reject("CLUSTER_CATALOG_OUTPUT_ROOT_UNSAFE");
  const handle = await open(resolved, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600).catch(() => reject("CLUSTER_CATALOG_OUTPUT_CONFLICT"));
  try {
    await handle.writeFile(canonicalClusterJson(value), "utf8");
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parentHandle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parentHandle.sync(); } finally { await parentHandle.close(); }
  return resolved;
}

function parseOptions(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index], value = argumentsList[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--") || options[key] !== undefined) reject("CLUSTER_CATALOG_CLI_ARGUMENT_INVALID");
    options[key] = value;
  }
  return options;
}

async function cli() {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (command !== "validate-report") reject("CLUSTER_CATALOG_CLI_COMMAND_INVALID");
  const options = parseOptions(argumentsList);
  if (Object.keys(options).sort().join("|") !== ["--output", "--policy", "--report"].sort().join("|")) reject("CLUSTER_CATALOG_CLI_ARGUMENT_INVALID");
  const policy = await readPolicy(options["--policy"]);
  const catalog = await readClusterCatalogReport({ reportFile: options["--report"], policy });
  await writeExclusiveCanonical(options["--output"], catalog);
  process.stdout.write("CLUSTER_CATALOG_VALIDATED\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    const code = error instanceof ClusterRecoveryError ? error.code : "CLUSTER_CATALOG_INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
