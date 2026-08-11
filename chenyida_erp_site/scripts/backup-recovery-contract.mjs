import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { link, lstat, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_CONTRACT = "chenyida-erp-backup/v2";
const RECEIPT_CONTRACT = "chenyida-erp-backup-verification/v2";
const RECONCILIATION_CONTRACT = "chenyida-erp-backup-reconciliation/v1";
const ARTIFACT_FILES = Object.freeze({
  postgresql_dump: "postgresql.dump",
  uploads: "uploads.tar.gz",
  attachments: "attachments.tar.gz",
  backup_status: "backup-status.tar.gz",
});
const ARCHIVE_KEYS = new Set(["uploads", "attachments", "backup_status"]);
const ARTIFACT_LEVELS = new Set(["LOCAL_VERIFIED", "OFFHOST_VERIFIED"]);
const DEPLOYMENT_CLASSES = new Set(["TEST", "UAT", "PRODUCTION"]);
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const RUNNER_MIGRATION = /^\d+.*\.sql$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RECEIPT_ROOT_MARKER = ".chenyida-erp-receipt-root-v2";
const RECEIPT_ROOT_MARKER_VALUE = "chenyida-erp-receipt-root/v2\n";
const MAX_RPO_HOURS = 168;
const MAX_ARCHIVE_ENTRIES = 1_000_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 50 * 1024 * 1024 * 1024;
const MAX_RECONCILIATION_FILES = 250_000;
const MAX_DATABASE_RECONCILIATION_BYTES = 64 * 1024 * 1024;
const CREDENTIAL_ROOT_MARKER = ".chenyida-erp-credential-root-v2";
const CREDENTIAL_ROOT_MARKER_VALUE = "chenyida-erp-credential-root/v2\n";
const RESTORE_TARGET_MARKER = ".chenyida-erp-restored-target-v2";
const MACHINE_ID = /^[0-9a-f]{32}$/;
const RECEIPT_ORDER = Object.freeze({ LOCAL_VERIFIED: 1, OFFHOST_VERIFIED: 2, RESTORE_VERIFIED: 3 });

export class BackupContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "BackupContractError";
    this.code = code;
  }
}

function reject(code) {
  throw new BackupContractError(code);
}

function object(value, code = "OBJECT_REQUIRED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, keys, code = "UNKNOWN_OR_MISSING_FIELD") {
  const actual = Object.keys(object(value, code)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject(code);
}

function boundedString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) reject(code);
  return value;
}

function positiveDecimal(value, code) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) reject(code);
  return positiveInteger(Number(value), code);
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) reject(code);
  return value;
}

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

class StrictJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    const value = this.value();
    this.space();
    if (this.index !== this.source.length) reject("JSON_TRAILING_CONTENT");
    return value;
  }

  space() {
    while (/\s/.test(this.source[this.index] || "")) this.index += 1;
  }

  value() {
    this.space();
    const token = this.source[this.index];
    if (token === "{") return this.record();
    if (token === "[") return this.list();
    if (token === '"') return this.string();
    if (token === "t" && this.source.slice(this.index, this.index + 4) === "true") return this.literal(4, true);
    if (token === "f" && this.source.slice(this.index, this.index + 5) === "false") return this.literal(5, false);
    if (token === "n" && this.source.slice(this.index, this.index + 4) === "null") return this.literal(4, null);
    return this.number();
  }

  literal(length, value) {
    this.index += length;
    return value;
  }

  string() {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const current = this.source[this.index];
      if (!escaped && current === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.source.slice(start, this.index));
        } catch {
          reject("JSON_STRING_INVALID");
        }
      }
      if (!escaped && current.charCodeAt(0) < 0x20) reject("JSON_STRING_INVALID");
      if (!escaped && current === "\\") escaped = true;
      else escaped = false;
      this.index += 1;
    }
    reject("JSON_STRING_UNTERMINATED");
  }

  number() {
    const match = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) reject("JSON_VALUE_INVALID");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) reject("JSON_NUMBER_INVALID");
    return value;
  }

  record() {
    const result = {};
    const keys = new Set();
    this.index += 1;
    this.space();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      this.space();
      if (this.source[this.index] !== '"') reject("JSON_OBJECT_KEY_INVALID");
      const key = this.string();
      if (keys.has(key)) reject("JSON_DUPLICATE_KEY");
      keys.add(key);
      this.space();
      if (this.source[this.index] !== ":") reject("JSON_OBJECT_COLON_MISSING");
      this.index += 1;
      result[key] = this.value();
      this.space();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") reject("JSON_OBJECT_SEPARATOR_INVALID");
      this.index += 1;
    }
    reject("JSON_OBJECT_UNTERMINATED");
  }

  list() {
    const result = [];
    this.index += 1;
    this.space();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.value());
      this.space();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") reject("JSON_ARRAY_SEPARATOR_INVALID");
      this.index += 1;
    }
    reject("JSON_ARRAY_UNTERMINATED");
  }
}

export function parseStrictJson(source) {
  if (typeof source !== "string" || source.length === 0) reject("JSON_EMPTY");
  return new StrictJsonParser(source).parse();
}

async function regularFile(file, maxBytes = Number.MAX_SAFE_INTEGER, allowEmpty = false) {
  const metadata = await lstat(file).catch(() => reject("FILE_MISSING"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (!allowEmpty && metadata.size <= 0) || metadata.size > maxBytes || (metadata.mode & 0o7022) !== 0) reject("FILE_UNSAFE");
  return metadata;
}

async function directory(directoryPath) {
  const metadata = await lstat(directoryPath).catch(() => reject("DIRECTORY_MISSING"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) reject("DIRECTORY_UNSAFE");
  return metadata;
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || (before.mode & 0o7022) !== 0) reject("FILE_UNSAFE");
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) reject("FILE_CHANGED_DURING_READ");
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function safeText(file, maxBytes, allowEmpty = false) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("FILE_MISSING"));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (!allowEmpty && before.size <= 0) || before.size > maxBytes || (before.mode & 0o7022) !== 0) reject("FILE_UNSAFE");
    const value = await handle.readFile("utf8");
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) reject("FILE_CHANGED_DURING_READ");
    return value;
  } finally {
    await handle.close();
  }
}

async function syncDirectory(parent) {
  const handle = await open(parent, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncRegularFile(file) {
  await regularFile(file, Number.MAX_SAFE_INTEGER, true);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableSyncFile(file) {
  await syncRegularFile(file);
  await syncDirectory(path.dirname(path.resolve(file)));
}

async function durableSyncTree(root) {
  const resolved = path.resolve(root);
  await directory(resolved);
  const stack = [[resolved, false]];
  while (stack.length > 0) {
    const [current, visited] = stack.pop();
    if (visited) { await syncDirectory(current); continue; }
    const metadata = await directory(current);
    if ((metadata.mode & 0o5022) !== 0) reject("DIRECTORY_MODE_UNSAFE");
    stack.push([current, true]);
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push([child, false]);
      else if (entry.isFile() && !entry.isSymbolicLink()) await syncRegularFile(child);
      else reject("FILE_TREE_TYPE_INVALID");
    }
  }
  await syncDirectory(path.dirname(resolved));
  return true;
}

async function atomicJson(file, value, mode, replace = false) {
  const parent = path.dirname(path.resolve(file));
  await directory(parent);
  const metadata = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject("OUTPUT_UNSAFE"));
  if (metadata && (!replace || !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0)) reject("OUTPUT_UNSAFE");
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    await syncDirectory(parent);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function durableNoClobberJson(file, value, mode, conflictCode) {
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  const parentMetadata = await directory(parent);
  if (parentMetadata.uid !== process.getuid?.() || (parentMetadata.mode & 0o022) !== 0) reject("OUTPUT_ROOT_UNSAFE");
  const source = `${JSON.stringify(value)}\n`;
  const temporary = path.join(parent, `.${path.basename(resolved)}.${process.pid}.${Date.now()}.tmp`);
  let linked = false;
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
    try {
      await handle.writeFile(source, "utf8");
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, resolved);
      linked = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
  if (linked) {
    await syncDirectory(parent);
    return resolved;
  }
  const metadata = await regularFile(resolved, 128 * 1024);
  if (metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== mode || await safeText(resolved, 128 * 1024) !== source) reject(conflictCode);
  await durableSyncFile(resolved);
  return resolved;
}

async function receiptRoot(root) {
  const resolved = path.resolve(root);
  const metadata = await directory(resolved);
  if (metadata.uid !== process.getuid?.() || (metadata.mode & 0o022) !== 0) reject("RECEIPT_ROOT_UNSAFE");
  const marker = path.join(resolved, RECEIPT_ROOT_MARKER);
  const markerMetadata = await regularFile(marker, 128);
  if (markerMetadata.uid !== metadata.uid || ![0o400, 0o600].includes(markerMetadata.mode & 0o777)) reject("RECEIPT_ROOT_MARKER_UNSAFE");
  if (await safeText(marker, 128) !== RECEIPT_ROOT_MARKER_VALUE) reject("RECEIPT_ROOT_MARKER_INVALID");
  return resolved;
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function receiptHistoryName(receipt) {
  if (receipt.result === "LOCAL_VERIFIED") return `${receipt.backup_id}.local.json`;
  if (receipt.result === "OFFHOST_VERIFIED") return `${receipt.backup_id}.offhost.json`;
  if (receipt.result === "RESTORE_VERIFIED") return `${receipt.backup_id}.${receipt.evidence.restore_run_id}.restore.json`;
  reject("VERIFICATION_LEVEL_INVALID");
}

function compareReceiptOrder(left, right) {
  const leftValues = [
    Date.parse(left.consistency.recovery_point_at),
    Date.parse(left.created_at),
    RECEIPT_ORDER[left.result],
    Date.parse(left.verified_at),
  ];
  const rightValues = [
    Date.parse(right.consistency.recovery_point_at),
    Date.parse(right.created_at),
    RECEIPT_ORDER[right.result],
    Date.parse(right.verified_at),
  ];
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) return leftValues[index] < rightValues[index] ? -1 : 1;
  }
  return 0;
}

async function publishedReceiptState(file, candidate) {
  const metadata = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject("RECEIPT_ALIAS_UNSAFE"));
  if (!metadata) return { write: true };
  await regularFile(file, 128 * 1024);
  if (metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o640) reject("RECEIPT_ALIAS_UNSAFE");
  const existing = validateReceipt(parseStrictJson(await safeText(file, 128 * 1024)));
  if (JSON.stringify(existing) === JSON.stringify(candidate)) return { write: false };
  const order = compareReceiptOrder(candidate, existing);
  if (order < 0) reject("RECEIPT_ALIAS_REGRESSION");
  if (order === 0) reject("RECEIPT_ALIAS_CONFLICT");
  return { write: true };
}

async function publishReceipt(root, level, receipt, forbiddenRoots) {
  const resolved = await receiptRoot(root);
  if (forbiddenRoots.some((item) => isInside(resolved, item) || isInside(item, resolved))) reject("RECEIPT_ROOT_OVERLAP");
  const names = { LOCAL_VERIFIED: "local.json", OFFHOST_VERIFIED: "offhost.json", RESTORE_VERIFIED: "restore.json" };
  const name = names[level];
  if (!name) reject("VERIFICATION_LEVEL_INVALID");
  validateReceipt(receipt);
  const historyFile = path.join(resolved, receiptHistoryName(receipt));
  let publishedReceipt = receipt;
  try {
    await durableNoClobberJson(historyFile, receipt, 0o640, "RECEIPT_HISTORY_CONFLICT");
  } catch (error) {
    if (!(error instanceof BackupContractError) || error.code !== "RECEIPT_HISTORY_CONFLICT" || !ARTIFACT_LEVELS.has(receipt.result)) throw error;
    const existing = validateReceipt(parseStrictJson(await safeText(historyFile, 128 * 1024)));
    const candidateProjection = { ...receipt, verified_at: existing.verified_at };
    if (JSON.stringify(candidateProjection) !== JSON.stringify(existing)) throw error;
    publishedReceipt = existing;
  }
  const aliasFile = path.join(resolved, name);
  const latestFile = path.join(resolved, "latest.json");
  const aliasState = await publishedReceiptState(aliasFile, publishedReceipt);
  const latestState = await publishedReceiptState(latestFile, publishedReceipt);
  if (aliasState.write) await atomicJson(aliasFile, publishedReceipt, 0o640, true);
  if (latestState.write) await atomicJson(latestFile, publishedReceipt, 0o640, true);
  return publishedReceipt;
}

async function credentialFile(file, root) {
  const resolvedRoot = path.resolve(root);
  const rootMetadata = await directory(resolvedRoot);
  if (rootMetadata.uid !== process.getuid?.() || (rootMetadata.mode & 0o022) !== 0) reject("CREDENTIAL_ROOT_UNSAFE");
  const marker = path.join(resolvedRoot, CREDENTIAL_ROOT_MARKER);
  const markerMetadata = await regularFile(marker, 128);
  if (markerMetadata.uid !== rootMetadata.uid || ![0o400, 0o600].includes(markerMetadata.mode & 0o777)
    || await safeText(marker, 128) !== CREDENTIAL_ROOT_MARKER_VALUE) reject("CREDENTIAL_ROOT_MARKER_INVALID");
  const resolvedFile = path.resolve(file);
  if (!isInside(resolvedFile, resolvedRoot) || resolvedFile === marker) reject("CREDENTIAL_FILE_OUTSIDE_ROOT");
  let current = path.dirname(resolvedFile);
  while (true) {
    const metadata = await directory(current);
    if (metadata.uid !== rootMetadata.uid || (metadata.mode & 0o022) !== 0) reject("CREDENTIAL_ANCESTOR_UNSAFE");
    if (current === resolvedRoot) break;
    const parent = path.dirname(current);
    if (parent === current || !isInside(parent, resolvedRoot)) reject("CREDENTIAL_ANCESTOR_UNSAFE");
    current = parent;
  }
  const metadata = await regularFile(resolvedFile, 1024 * 1024);
  if (metadata.uid !== rootMetadata.uid || ![0o400, 0o600].includes(metadata.mode & 0o777)) reject("CREDENTIAL_FILE_UNSAFE");
  return resolvedFile;
}

async function machineIdentity(overrideFile) {
  if (overrideFile !== undefined && process.env.NODE_ENV !== "test") reject("MACHINE_IDENTITY_OVERRIDE_FORBIDDEN");
  const file = path.resolve(overrideFile === undefined ? "/etc/machine-id" : overrideFile);
  const metadata = await regularFile(file, 1024);
  if (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) reject("MACHINE_IDENTITY_FILE_UNSAFE");
  if (overrideFile !== undefined && ![0o400, 0o600].includes(metadata.mode & 0o777)) reject("MACHINE_IDENTITY_FILE_UNSAFE");
  const value = (await safeText(file, 1024)).trim().toLowerCase();
  if (!MACHINE_ID.test(value)) reject("MACHINE_IDENTITY_INVALID");
  return createHash("sha256").update(`${value}\n`).digest("hex");
}

async function fixedRootIdentity(root, machineIdentitySha, code) {
  if (typeof root !== "string" || root.length === 0) reject(code);
  const resolved = path.resolve(root);
  const metadata = await directory(resolved);
  if (metadata.uid !== process.getuid?.() || (metadata.mode & 0o022) !== 0) reject(code);
  const device = String(metadata.dev);
  const inode = String(metadata.ino);
  if (!/^\d{1,30}$/.test(device) || !/^\d{1,30}$/.test(inode)) reject(code);
  return {
    root: resolved,
    device,
    inode,
    identitySha256: createHash("sha256").update(`${machineIdentitySha}\n${device}\n${inode}\n`).digest("hex"),
  };
}

function validateDatabaseReport(source) {
  if (typeof source !== "string" || !source.endsWith("\n") || Buffer.byteLength(source) > MAX_DATABASE_RECONCILIATION_BYTES) reject("DATABASE_RECONCILIATION_INVALID");
  const lines = source.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.length > 1_000_000) reject("DATABASE_RECONCILIATION_INVALID");
  const seen = new Set();
  let largeObjects = 0;
  for (const line of lines) {
    const fields = line.split("\t");
    const kind = fields[0];
    if (kind === "RELATION" && fields.length === 4) {
      if (!/^(?:[0-9a-f]{2}){1,4096}$/.test(fields[1]) || !/^\d+$/.test(fields[2]) || !SHA256.test(fields[3])) reject("DATABASE_RECONCILIATION_INVALID");
    } else if (kind === "SEQUENCE" && fields.length === 4) {
      if (!/^(?:[0-9a-f]{2}){1,4096}$/.test(fields[1]) || !/^-?\d+$/.test(fields[2]) || !/^(?:true|false|t|f)$/.test(fields[3])) reject("DATABASE_RECONCILIATION_INVALID");
    } else if (kind === "EXTENSION" && fields.length === 4) {
      if (fields.slice(1).some((field) => !/^(?:[0-9a-f]{2}){1,4096}$/.test(field))) reject("DATABASE_RECONCILIATION_INVALID");
    } else if (kind === "LARGE_OBJECTS" && fields.length === 4) {
      if (!/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[2]) || !SHA256.test(fields[3]) || ++largeObjects !== 1) reject("DATABASE_RECONCILIATION_INVALID");
    } else reject("DATABASE_RECONCILIATION_INVALID");
    const identity = `${kind}:${fields[1]}`;
    if (seen.has(identity)) reject("DATABASE_RECONCILIATION_DUPLICATE");
    seen.add(identity);
  }
  if (largeObjects !== 1) reject("DATABASE_RECONCILIATION_INVALID");
  return source;
}

async function hashRegularFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("FILE_MISSING"));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 0 || (before.mode & 0o7022) !== 0) reject("FILE_UNSAFE");
    const hash = createHash("sha256");
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) reject("FILE_CHANGED_DURING_READ");
    return { bytes: before.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function fileTree(root) {
  const resolved = path.resolve(root);
  await directory(resolved);
  const items = [];
  const queue = [[resolved, ""]];
  while (queue.length > 0) {
    const [current, relative] = queue.pop();
    const metadata = await directory(current);
    // setgid is required on the receipt root so root-written 0640 receipts keep
    // the Web reader group; setuid, sticky, and group/world write stay forbidden.
    if ((metadata.mode & 0o5022) !== 0) reject("DIRECTORY_MODE_UNSAFE");
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (/[\u0000\r\n\uFFFD]/.test(entry.name)) reject("FILE_NAME_UNSAFE");
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) reject("FILE_TREE_LINK_FORBIDDEN");
      if (entry.isDirectory()) queue.push([target, childRelative]);
      else if (entry.isFile()) {
        if (items.length >= MAX_RECONCILIATION_FILES) reject("FILE_TREE_TOO_LARGE");
        const hashed = await hashRegularFile(target);
        items.push({ path_hex: Buffer.from(childRelative, "utf8").toString("hex"), bytes: hashed.bytes, sha256: hashed.sha256 });
      } else reject("FILE_TREE_TYPE_INVALID");
    }
  }
  items.sort((left, right) => left.path_hex < right.path_hex ? -1 : left.path_hex > right.path_hex ? 1 : 0);
  return { entries: items.length, tree_sha256: createHash("sha256").update(JSON.stringify(items)).digest("hex"), items };
}

export function validateReconciliation(value) {
  exactKeys(value, ["schema_version", "contract", "database", "files"]);
  if (value.schema_version !== 1 || value.contract !== RECONCILIATION_CONTRACT) reject("RECONCILIATION_VERSION_INVALID");
  exactKeys(value.database, ["format", "report_sha256", "report"]);
  if (value.database.format !== "PSQL_UNALIGNED_CANONICAL_V1") reject("DATABASE_RECONCILIATION_INVALID");
  const report = validateDatabaseReport(value.database.report);
  expectEqual(createHash("sha256").update(report).digest("hex"), value.database.report_sha256, "DATABASE_RECONCILIATION_SHA_MISMATCH");
  exactKeys(value.files, ["uploads", "attachments", "backup_status"]);
  for (const key of ["uploads", "attachments", "backup_status"]) {
    const tree = value.files[key];
    exactKeys(tree, ["entries", "tree_sha256", "items"]);
    nonNegativeInteger(tree.entries, "FILE_TREE_INVALID");
    boundedString(tree.tree_sha256, SHA256, "FILE_TREE_INVALID");
    if (!Array.isArray(tree.items) || tree.items.length !== tree.entries || tree.items.length > MAX_RECONCILIATION_FILES) reject("FILE_TREE_INVALID");
    let previous = "";
    for (const item of tree.items) {
      exactKeys(item, ["path_hex", "bytes", "sha256"]);
      if (typeof item.path_hex !== "string" || !/^(?:[0-9a-f]{2}){1,4096}$/.test(item.path_hex) || item.path_hex <= previous) reject("FILE_TREE_INVALID");
      previous = item.path_hex;
      nonNegativeInteger(item.bytes, "FILE_TREE_INVALID");
      boundedString(item.sha256, SHA256, "FILE_TREE_INVALID");
    }
    expectEqual(createHash("sha256").update(JSON.stringify(tree.items)).digest("hex"), tree.tree_sha256, "FILE_TREE_SHA_MISMATCH");
  }
  return value;
}

export async function createReconciliation(options) {
  const backupDirectory = path.resolve(options.backupDirectory);
  await directory(backupDirectory);
  const report = validateDatabaseReport(await safeText(options.databaseReportFile, MAX_DATABASE_RECONCILIATION_BYTES));
  const value = validateReconciliation({
    schema_version: 1,
    contract: RECONCILIATION_CONTRACT,
    database: { format: "PSQL_UNALIGNED_CANONICAL_V1", report_sha256: createHash("sha256").update(report).digest("hex"), report },
    files: {
      uploads: await fileTree(options.uploadsDirectory),
      attachments: await fileTree(options.attachmentsDirectory),
      backup_status: await fileTree(options.backupStatusDirectory),
    },
  });
  await atomicJson(path.join(backupDirectory, "reconciliation.json"), value, 0o600, false);
  return value;
}

async function readReconciliation(backupDirectory) {
  const source = await safeText(path.join(backupDirectory, "reconciliation.json"), 256 * 1024 * 1024);
  return validateReconciliation(parseStrictJson(source));
}

export async function verifySourceReconciliation(options) {
  const expected = await readReconciliation(path.resolve(options.backupDirectory));
  const report = validateDatabaseReport(await safeText(options.databaseReportFile, MAX_DATABASE_RECONCILIATION_BYTES));
  const actual = validateReconciliation({
    schema_version: 1,
    contract: RECONCILIATION_CONTRACT,
    database: { format: "PSQL_UNALIGNED_CANONICAL_V1", report_sha256: createHash("sha256").update(report).digest("hex"), report },
    files: {
      uploads: await fileTree(options.uploadsDirectory),
      attachments: await fileTree(options.attachmentsDirectory),
      backup_status: await fileTree(options.backupStatusDirectory),
    },
  });
  expectEqual(JSON.stringify(actual), JSON.stringify(expected), "SOURCE_CHANGED_DURING_CAPTURE");
  return true;
}

export async function migrationManifest(migrationsDirectory) {
  await directory(migrationsDirectory);
  const directoryEntries = await readdir(migrationsDirectory, { withFileTypes: true });
  const runnerEntries = directoryEntries.filter((entry) => RUNNER_MIGRATION.test(entry.name));
  if (runnerEntries.some((entry) => !MIGRATION.test(entry.name))) reject("MIGRATION_FILENAME_UNSUPPORTED");
  const entries = runnerEntries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (entries.length === 0) reject("MIGRATIONS_MISSING");
  for (let index = 0; index < entries.length; index += 1) {
    if (Number(entries[index].name.slice(0, 4)) !== index + 1) reject("MIGRATION_SEQUENCE_INVALID");
  }
  const lines = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink?.()) reject("MIGRATION_UNSAFE");
    const file = path.join(migrationsDirectory, entry.name);
    await regularFile(file, 16 * 1024 * 1024);
    lines.push(`${await sha256File(file)}  ${entry.name}`);
  }
  return { text: `${lines.join("\n")}\n`, head: entries.at(-1).name };
}

function artifact(value, key) {
  const expected = ARCHIVE_KEYS.has(key) ? ["file", "sha256", "bytes", "entries"] : ["file", "sha256", "bytes"];
  exactKeys(value, expected, "ARTIFACT_FIELDS_INVALID");
  if (value.file !== ARTIFACT_FILES[key]) reject("ARTIFACT_FILE_INVALID");
  boundedString(value.sha256, SHA256, "ARTIFACT_SHA_INVALID");
  positiveInteger(value.bytes, "ARTIFACT_BYTES_INVALID");
  if (ARCHIVE_KEYS.has(key)) nonNegativeInteger(value.entries, "ARTIFACT_ENTRIES_INVALID");
  return value;
}

export function validateManifest(value) {
  exactKeys(value, ["schema_version", "contract", "status", "backup_id", "created_at", "deployment", "application", "migration", "policy", "consistency", "reconciliation", "artifacts"]);
  if (value.schema_version !== 2 || value.contract !== MANIFEST_CONTRACT || value.status !== "COMPLETE") reject("MANIFEST_VERSION_INVALID");
  boundedString(value.backup_id, IDENTIFIER, "BACKUP_ID_INVALID");
  iso(value.created_at, "CREATED_AT_INVALID");
  exactKeys(value.deployment, ["class", "id", "database", "database_system_identifier", "database_oid", "database_marker", "database_bytes", "database_server_major", "database_encoding", "database_collate", "database_ctype", "database_locale_provider", "database_collation_version"]);
  if (!DEPLOYMENT_CLASSES.has(value.deployment.class)) reject("DEPLOYMENT_CLASS_INVALID");
  boundedString(value.deployment.id, IDENTIFIER, "DEPLOYMENT_ID_INVALID");
  boundedString(value.deployment.database, IDENTIFIER, "DATABASE_ID_INVALID");
  boundedString(value.deployment.database_system_identifier, /^\d{10,30}$/, "DATABASE_SYSTEM_IDENTIFIER_INVALID");
  boundedString(value.deployment.database_oid, /^\d{1,20}$/, "DATABASE_OID_INVALID");
  boundedString(value.deployment.database_marker, IDENTIFIER, "DATABASE_MARKER_INVALID");
  positiveInteger(value.deployment.database_bytes, "DATABASE_BYTES_INVALID");
  boundedString(value.deployment.database_server_major, /^\d{1,3}$/, "DATABASE_PROFILE_INVALID");
  for (const key of ["database_encoding", "database_collate", "database_ctype", "database_locale_provider", "database_collation_version"]) boundedString(value.deployment[key], IDENTIFIER, "DATABASE_PROFILE_INVALID");
  if (value.deployment.database_locale_provider !== "libc") reject("DATABASE_PROFILE_UNSUPPORTED");
  exactKeys(value.application, ["version", "git_commit", "web_image_digest", "worker_image_digest"]);
  boundedString(value.application.version, VERSION, "APPLICATION_VERSION_INVALID");
  boundedString(value.application.git_commit, GIT_SHA, "GIT_COMMIT_INVALID");
  boundedString(value.application.web_image_digest, IMAGE_DIGEST, "WEB_IMAGE_DIGEST_INVALID");
  boundedString(value.application.worker_image_digest, IMAGE_DIGEST, "WORKER_IMAGE_DIGEST_INVALID");
  exactKeys(value.migration, ["head", "manifest_file", "manifest_sha256"]);
  boundedString(value.migration.head, MIGRATION, "MIGRATION_HEAD_INVALID");
  if (value.migration.manifest_file !== "migrations.txt") reject("MIGRATION_MANIFEST_FILE_INVALID");
  boundedString(value.migration.manifest_sha256, SHA256, "MIGRATION_MANIFEST_SHA_INVALID");
  exactKeys(value.policy, ["id", "rpo_hours"]);
  boundedString(value.policy.id, IDENTIFIER, "POLICY_ID_INVALID");
  positiveInteger(value.policy.rpo_hours, "RPO_HOURS_INVALID");
  if (value.policy.rpo_hours > MAX_RPO_HOURS) reject("RPO_HOURS_INVALID");
  exactKeys(value.consistency, ["method", "database_snapshot", "database_guard", "writer_boundary", "content_reconciliation", "dump_scope", "web_container", "web_container_id", "worker_container", "worker_container_id", "recovery_point_at", "verified_after"]);
  if (value.consistency.method !== "QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION") reject("CONSISTENCY_METHOD_INVALID");
  if (value.consistency.database_snapshot !== "PG_DUMP_CONSISTENT_SNAPSHOT") reject("DATABASE_SNAPSHOT_INVALID");
  if (value.consistency.database_guard !== "DEFAULT_TRANSACTION_READ_ONLY_DEFENSE_IN_DEPTH") reject("DATABASE_GUARD_INVALID");
  if (value.consistency.writer_boundary !== "EXACT_COMPOSE_WEB_WORKER_STOPPED") reject("WRITER_BOUNDARY_INVALID");
  if (value.consistency.content_reconciliation !== "BEFORE_AFTER_FULL_RELATION_CONTENT_DIGESTS") reject("CONTENT_RECONCILIATION_INVALID");
  if (value.consistency.dump_scope !== "COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL") reject("DUMP_SCOPE_INVALID");
  boundedString(value.consistency.web_container, IDENTIFIER, "WEB_CONTAINER_INVALID");
  boundedString(value.consistency.web_container_id, SHA256, "WEB_CONTAINER_ID_INVALID");
  boundedString(value.consistency.worker_container, IDENTIFIER, "WORKER_CONTAINER_INVALID");
  boundedString(value.consistency.worker_container_id, SHA256, "WORKER_CONTAINER_ID_INVALID");
  iso(value.consistency.recovery_point_at, "CONSISTENCY_TIME_INVALID");
  iso(value.consistency.verified_after, "CONSISTENCY_TIME_INVALID");
  const createdAt = Date.parse(value.created_at);
  if (Date.parse(value.consistency.recovery_point_at) > Date.parse(value.consistency.verified_after)
    || Date.parse(value.consistency.verified_after) > createdAt) reject("CONSISTENCY_TIME_INVALID");
  exactKeys(value.reconciliation, ["contract", "file", "sha256"]);
  if (value.reconciliation.contract !== RECONCILIATION_CONTRACT || value.reconciliation.file !== "reconciliation.json") reject("RECONCILIATION_REFERENCE_INVALID");
  boundedString(value.reconciliation.sha256, SHA256, "RECONCILIATION_REFERENCE_INVALID");
  exactKeys(value.artifacts, Object.keys(ARTIFACT_FILES));
  for (const key of Object.keys(ARTIFACT_FILES)) artifact(value.artifacts[key], key);
  return value;
}

function command(binary, args, code) {
  const result = spawnSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.error) reject(code);
  return result.stdout;
}

function archivePaths(output) {
  const paths = output.split("\n").filter(Boolean);
  if (paths.length === 0) reject("ARCHIVE_EMPTY");
  if (paths.length > MAX_ARCHIVE_ENTRIES + 1) reject("ARCHIVE_TOO_MANY_ENTRIES");
  const seen = new Set();
  for (const name of paths) {
    const components = name.replace(/\/$/, "").split("/");
    if (name.length > 4096 || name.includes("\\") || name.includes("\0") || name.startsWith("/") || components.length > 64
      || components.some((part, index) => part === ".." || part === "" || (part === "." && index !== 0))) reject("ARCHIVE_PATH_UNSAFE");
    const normalized = path.posix.normalize(name).replace(/^\.\//, "").replace(/\/$/, "") || ".";
    if (seen.has(normalized)) reject("ARCHIVE_DUPLICATE_PATH");
    seen.add(normalized);
  }
  return paths;
}

async function verifyArchive(file, expectedSha) {
  expectEqual(await sha256File(file), expectedSha, "ARCHIVE_CHANGED_DURING_INSPECTION");
  const paths = archivePaths(command("tar", ["--list", "--gzip", "--file", file, "--quoting-style=escape"], "ARCHIVE_LIST_FAILED"));
  const verbose = command("tar", ["--list", "--verbose", "--gzip", "--file", file, "--quoting-style=escape"], "ARCHIVE_LIST_FAILED");
  const lines = verbose.split("\n").filter(Boolean);
  if (lines.length !== paths.length) reject("ARCHIVE_LIST_MISMATCH");
  let files = 0;
  let expandedBytes = 0;
  for (const line of lines) {
    const kind = line[0];
    if (kind !== "-" && kind !== "d") reject(kind === "l" || kind === "h" ? "ARCHIVE_LINK_FORBIDDEN" : "ARCHIVE_SPECIAL_FILE_FORBIDDEN");
    const mode = line.slice(0, 10);
    if (/[sStT]/.test(mode)) {
      const otherSpecialBits = `${mode.slice(0, 6)}${mode.slice(7)}`;
      if (kind !== "d" || mode[6] !== "s" || /[sStT]/.test(otherSpecialBits)) reject("ARCHIVE_DANGEROUS_MODE");
    }
    if (kind === "-") {
      const fields = line.trim().split(/\s+/);
      const bytes = Number(fields[2]);
      if (!Number.isSafeInteger(bytes) || bytes < 0) reject("ARCHIVE_SIZE_INVALID");
      expandedBytes += bytes;
      if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) reject("ARCHIVE_EXPANDED_SIZE_EXCEEDED");
      files += 1;
    }
  }
  expectEqual(await sha256File(file), expectedSha, "ARCHIVE_CHANGED_DURING_INSPECTION");
  return files;
}

function expectEqual(actual, expected, code) {
  if (actual !== expected) reject(code);
}

function receiptFrom(manifest, manifestSha, level, locationId, verifiedAt, evidence) {
  if (![...ARTIFACT_LEVELS, "RESTORE_VERIFIED"].includes(level)) reject("VERIFICATION_LEVEL_INVALID");
  boundedString(locationId, IDENTIFIER, "LOCATION_ID_INVALID");
  const expiresAt = new Date(Date.parse(manifest.consistency.recovery_point_at) + manifest.policy.rpo_hours * 60 * 60 * 1000).toISOString();
  return validateReceipt({
    schema_version: 2,
    contract: RECEIPT_CONTRACT,
    result: level,
    backup_id: manifest.backup_id,
    created_at: manifest.created_at,
    verified_at: verifiedAt,
    expires_at: expiresAt,
    location_id: locationId,
    deployment: manifest.deployment,
    application: manifest.application,
    migration: manifest.migration,
    policy: manifest.policy,
    consistency: manifest.consistency,
    reconciliation: manifest.reconciliation,
    manifest_sha256: manifestSha,
    artifacts: manifest.artifacts,
    evidence,
  });
}

export function validateReceipt(value) {
  exactKeys(value, ["schema_version", "contract", "result", "backup_id", "created_at", "verified_at", "expires_at", "location_id", "deployment", "application", "migration", "policy", "consistency", "reconciliation", "manifest_sha256", "artifacts", "evidence"]);
  if (value.schema_version !== 2 || value.contract !== RECEIPT_CONTRACT || ![...ARTIFACT_LEVELS, "RESTORE_VERIFIED"].includes(value.result)) reject("RECEIPT_VERSION_INVALID");
  boundedString(value.backup_id, IDENTIFIER, "BACKUP_ID_INVALID");
  iso(value.created_at, "CREATED_AT_INVALID");
  iso(value.verified_at, "VERIFIED_AT_INVALID");
  iso(value.expires_at, "EXPIRES_AT_INVALID");
  boundedString(value.location_id, IDENTIFIER, "LOCATION_ID_INVALID");
  boundedString(value.manifest_sha256, SHA256, "MANIFEST_SHA_INVALID");
  const manifestProjection = validateManifest({
    schema_version: 2,
    contract: MANIFEST_CONTRACT,
    status: "COMPLETE",
    backup_id: value.backup_id,
    created_at: value.created_at,
    deployment: value.deployment,
    application: value.application,
    migration: value.migration,
    policy: value.policy,
    consistency: value.consistency,
    reconciliation: value.reconciliation,
    artifacts: value.artifacts,
  });
  const created = Date.parse(value.created_at);
  const verified = Date.parse(value.verified_at);
  const expires = Date.parse(value.expires_at);
  const recoveryPoint = Date.parse(manifestProjection.consistency.recovery_point_at);
  if (verified < created || verified > expires || expires !== recoveryPoint + manifestProjection.policy.rpo_hours * 60 * 60 * 1000) reject("RECEIPT_TIME_INVALID");
  const evidence = object(value.evidence, "EVIDENCE_INVALID");
  if (value.result === "LOCAL_VERIFIED") {
    exactKeys(evidence, ["kind", "source_machine_identity_sha256", "source_root_device", "source_root_inode", "source_root_identity_sha256", "attestation"]);
    if (evidence.kind !== "LOCAL_CAPTURE_VERIFICATION") reject("EVIDENCE_INVALID");
    for (const key of ["source_machine_identity_sha256", "source_root_identity_sha256"]) boundedString(evidence[key], SHA256, "SOURCE_IDENTITY_INVALID");
    for (const key of ["source_root_device", "source_root_inode"]) boundedString(evidence[key], /^\d{1,30}$/, "SOURCE_IDENTITY_INVALID");
    expectEqual(createHash("sha256").update(`${evidence.source_machine_identity_sha256}\n${evidence.source_root_device}\n${evidence.source_root_inode}\n`).digest("hex"), evidence.source_root_identity_sha256, "SOURCE_IDENTITY_INVALID");
    if (evidence.attestation !== "TRUSTED_EXECUTION_UID_AND_FIXED_SOURCE_MACHINE_ROOT") reject("LOCAL_ATTESTATION_INVALID");
  } else if (value.result === "OFFHOST_VERIFIED") {
    exactKeys(evidence, ["kind", "transfer_id", "source_location_id", "source_machine_identity_sha256", "local_receipt_sha256", "receiver_machine_identity_sha256", "receiver_root_device", "receiver_root_inode", "receiver_identity_sha256", "attestation"]);
    if (evidence.kind !== "OFFHOST_RECEIVER_VERIFICATION") reject("EVIDENCE_INVALID");
    boundedString(evidence.transfer_id, IDENTIFIER, "TRANSFER_ID_INVALID");
    boundedString(evidence.source_location_id, IDENTIFIER, "SOURCE_LOCATION_ID_INVALID");
    boundedString(evidence.local_receipt_sha256, SHA256, "LOCAL_RECEIPT_SHA_INVALID");
    for (const key of ["source_machine_identity_sha256", "receiver_machine_identity_sha256", "receiver_identity_sha256"]) boundedString(evidence[key], SHA256, "RECEIVER_IDENTITY_INVALID");
    for (const key of ["receiver_root_device", "receiver_root_inode"]) boundedString(evidence[key], /^\d{1,30}$/, "RECEIVER_IDENTITY_INVALID");
    expectEqual(createHash("sha256").update(`${evidence.receiver_machine_identity_sha256}\n${evidence.receiver_root_device}\n${evidence.receiver_root_inode}\n`).digest("hex"), evidence.receiver_identity_sha256, "RECEIVER_IDENTITY_INVALID");
    if (evidence.receiver_machine_identity_sha256 === evidence.source_machine_identity_sha256) reject("OFFHOST_MACHINE_NOT_DISTINCT");
    if (evidence.attestation !== "TRUSTED_EXECUTION_UID_AND_DISTINCT_MACHINE_FIXED_RECEIVER_ROOT") reject("OFFHOST_ATTESTATION_INVALID");
    if (evidence.source_location_id === value.location_id) reject("OFFHOST_LOCATION_NOT_DISTINCT");
  } else {
    exactKeys(evidence, ["kind", "source_location_id", "offhost_location_id", "offhost_receiver_identity_sha256", "offhost_receipt_sha256", "restore_run_id", "restored_at", "target", "reconciliation", "reconciliation_sha256", "attestation"]);
    if (evidence.kind !== "ISOLATED_RESTORE_VERIFICATION") reject("EVIDENCE_INVALID");
    boundedString(evidence.offhost_location_id, IDENTIFIER, "OFFHOST_LOCATION_INVALID");
    boundedString(evidence.offhost_receiver_identity_sha256, SHA256, "RECEIVER_IDENTITY_INVALID");
    boundedString(evidence.offhost_receipt_sha256, SHA256, "OFFHOST_RECEIPT_SHA_INVALID");
    boundedString(evidence.restore_run_id, IDENTIFIER, "RESTORE_RUN_ID_INVALID");
    iso(evidence.restored_at, "RESTORED_AT_INVALID");
    boundedString(evidence.reconciliation_sha256, SHA256, "RECONCILIATION_SHA_INVALID");
    boundedString(evidence.source_location_id, IDENTIFIER, "SOURCE_LOCATION_ID_INVALID");
    if (evidence.attestation !== "TRUSTED_EXECUTION_UID_AND_DISTINCT_CLUSTER_ACTIVE_INSPECTION") reject("RESTORE_ATTESTATION_INVALID");
    exactKeys(evidence.reconciliation, ["contract", "source_sha256", "target_database_report_sha256", "target_file_trees_sha256", "result"]);
    if (evidence.reconciliation.contract !== "chenyida-erp-restore-reconciliation/v1" || evidence.reconciliation.result !== "MATCHED") reject("RESTORE_RECONCILIATION_INVALID");
    for (const key of ["source_sha256", "target_database_report_sha256", "target_file_trees_sha256"]) boundedString(evidence.reconciliation[key], SHA256, "RESTORE_RECONCILIATION_INVALID");
    expectEqual(evidence.reconciliation.source_sha256, value.reconciliation.sha256, "RESTORE_SOURCE_RECONCILIATION_MISMATCH");
    exactKeys(evidence.target, ["deployment_class", "deployment_id", "database_name", "database_system_identifier", "database_oid", "marker_id", "cluster_marker_id", "database_server_major", "database_encoding", "database_collate", "database_ctype", "database_locale_provider", "database_collation_version", "file_root_name"]);
    if (evidence.target.deployment_class !== "TEST") reject("RESTORE_TARGET_CLASS_INVALID");
    for (const key of ["deployment_id", "database_name", "database_system_identifier", "database_oid", "marker_id", "cluster_marker_id", "database_server_major", "database_encoding", "database_collate", "database_ctype", "database_locale_provider", "database_collation_version", "file_root_name"]) boundedString(evidence.target[key], IDENTIFIER, "RESTORE_TARGET_INVALID");
    if (!evidence.target.database_name.endsWith("_restore_test") || !evidence.target.file_root_name.endsWith("_restore_test")) reject("RESTORE_TARGET_INVALID");
    if (evidence.target.database_system_identifier === value.deployment.database_system_identifier) reject("RESTORE_TARGET_CLUSTER_NOT_DISTINCT");
    for (const [targetKey, sourceKey] of [["database_server_major", "database_server_major"], ["database_encoding", "database_encoding"], ["database_collate", "database_collate"], ["database_ctype", "database_ctype"], ["database_locale_provider", "database_locale_provider"], ["database_collation_version", "database_collation_version"]]) expectEqual(evidence.target[targetKey], value.deployment[sourceKey], "RESTORE_TARGET_DATABASE_PROFILE_MISMATCH");
    if (evidence.restored_at !== value.verified_at) reject("RESTORED_AT_INVALID");
    if (new Set([evidence.source_location_id, evidence.offhost_location_id, value.location_id]).size !== 3) reject("RESTORE_LOCATION_NOT_DISTINCT");
    expectEqual(createHash("sha256").update(JSON.stringify(evidence.reconciliation)).digest("hex"), evidence.reconciliation_sha256, "RESTORE_RECONCILIATION_SHA_MISMATCH");
  }
  return value;
}

export async function createManifest(options) {
  const backupDirectory = path.resolve(options.backupDirectory);
  await directory(backupDirectory);
  const expectedMigration = await migrationManifest(options.migrationsDirectory);
  const storedMigrationFile = path.join(backupDirectory, "migrations.txt");
  await regularFile(storedMigrationFile, 4 * 1024 * 1024);
  const storedMigration = await safeText(storedMigrationFile, 4 * 1024 * 1024);
  expectEqual(storedMigration, expectedMigration.text, "MIGRATION_MANIFEST_MISMATCH");
  const reconciliationFile = path.join(backupDirectory, "reconciliation.json");
  await regularFile(reconciliationFile, 256 * 1024 * 1024);
  validateReconciliation(parseStrictJson(await safeText(reconciliationFile, 256 * 1024 * 1024)));
  const artifacts = {};
  for (const key of Object.keys(ARTIFACT_FILES)) {
    const file = path.join(backupDirectory, ARTIFACT_FILES[key]);
    const metadata = await regularFile(file);
    artifacts[key] = { file: ARTIFACT_FILES[key], sha256: await sha256File(file), bytes: metadata.size };
    if (ARCHIVE_KEYS.has(key)) artifacts[key].entries = nonNegativeInteger(options.entries[key], "ARTIFACT_ENTRIES_INVALID");
  }
  const manifest = validateManifest({
    schema_version: 2,
    contract: MANIFEST_CONTRACT,
    status: "COMPLETE",
    backup_id: options.backupId,
    created_at: options.createdAt,
    deployment: {
      class: options.deploymentClass,
      id: options.deploymentId,
      database: options.databaseName,
      database_system_identifier: options.databaseSystemIdentifier,
      database_oid: options.databaseOid,
      database_marker: options.databaseMarker,
      database_bytes: options.databaseBytes,
      database_server_major: options.databaseServerMajor,
      database_encoding: options.databaseEncoding,
      database_collate: options.databaseCollate,
      database_ctype: options.databaseCtype,
      database_locale_provider: options.databaseLocaleProvider,
      database_collation_version: options.databaseCollationVersion,
    },
    application: { version: options.applicationVersion, git_commit: options.gitCommit, web_image_digest: options.webImageDigest, worker_image_digest: options.workerImageDigest },
    migration: {
      head: expectedMigration.head,
      manifest_file: "migrations.txt",
      manifest_sha256: createHash("sha256").update(storedMigration).digest("hex"),
    },
    policy: { id: options.policyId, rpo_hours: options.rpoHours },
    consistency: {
      method: "QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION",
      database_snapshot: "PG_DUMP_CONSISTENT_SNAPSHOT",
      database_guard: "DEFAULT_TRANSACTION_READ_ONLY_DEFENSE_IN_DEPTH",
      writer_boundary: "EXACT_COMPOSE_WEB_WORKER_STOPPED",
      content_reconciliation: "BEFORE_AFTER_FULL_RELATION_CONTENT_DIGESTS",
      dump_scope: "COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL",
      web_container: options.webContainer,
      web_container_id: options.webContainerId,
      worker_container: options.workerContainer,
      worker_container_id: options.workerContainerId,
      recovery_point_at: options.recoveryPointAt,
      verified_after: options.consistencyVerifiedAfter,
    },
    reconciliation: {
      contract: RECONCILIATION_CONTRACT,
      file: "reconciliation.json",
      sha256: await sha256File(reconciliationFile),
    },
    artifacts,
  });
  await atomicJson(path.join(backupDirectory, "manifest.json"), manifest, 0o600, false);
  return manifest;
}

async function inspectBackup(options) {
  const backupDirectory = path.resolve(options.backupDirectory);
  await directory(backupDirectory);
  const expectedFiles = new Set(["manifest.json", "migrations.txt", "reconciliation.json", ...Object.values(ARTIFACT_FILES)]);
  const actual = await readdir(backupDirectory, { withFileTypes: true });
  if (actual.length !== expectedFiles.size || actual.some((entry) => !entry.isFile() || !expectedFiles.has(entry.name))) reject("BACKUP_FILE_SET_INVALID");
  const manifestFile = path.join(backupDirectory, "manifest.json");
  await regularFile(manifestFile, 128 * 1024);
  const manifestSource = await safeText(manifestFile, 128 * 1024);
  const manifest = validateManifest(parseStrictJson(manifestSource));
  expectEqual(manifest.deployment.class, options.expectedDeploymentClass, "EXPECTED_DEPLOYMENT_CLASS_MISMATCH");
  expectEqual(manifest.deployment.id, options.expectedDeploymentId, "EXPECTED_DEPLOYMENT_ID_MISMATCH");
  expectEqual(manifest.deployment.database, options.expectedDatabaseName, "EXPECTED_DATABASE_MISMATCH");
  expectEqual(manifest.deployment.database_system_identifier, options.expectedDatabaseSystemIdentifier, "EXPECTED_DATABASE_SYSTEM_IDENTIFIER_MISMATCH");
  expectEqual(manifest.deployment.database_oid, options.expectedDatabaseOid, "EXPECTED_DATABASE_OID_MISMATCH");
  expectEqual(manifest.deployment.database_marker, options.expectedDatabaseMarker, "EXPECTED_DATABASE_MARKER_MISMATCH");
  expectEqual(manifest.deployment.database_bytes, positiveInteger(options.expectedDatabaseBytes, "EXPECTED_DATABASE_BYTES_INVALID"), "EXPECTED_DATABASE_BYTES_MISMATCH");
  expectEqual(manifest.deployment.database_server_major, options.expectedDatabaseServerMajor, "EXPECTED_DATABASE_SERVER_MAJOR_MISMATCH");
  expectEqual(manifest.deployment.database_encoding, options.expectedDatabaseEncoding, "EXPECTED_DATABASE_ENCODING_MISMATCH");
  expectEqual(manifest.deployment.database_collate, options.expectedDatabaseCollate, "EXPECTED_DATABASE_COLLATE_MISMATCH");
  expectEqual(manifest.deployment.database_ctype, options.expectedDatabaseCtype, "EXPECTED_DATABASE_CTYPE_MISMATCH");
  expectEqual(manifest.deployment.database_locale_provider, options.expectedDatabaseLocaleProvider, "EXPECTED_DATABASE_LOCALE_PROVIDER_MISMATCH");
  expectEqual(manifest.deployment.database_collation_version, options.expectedDatabaseCollationVersion, "EXPECTED_DATABASE_COLLATION_VERSION_MISMATCH");
  expectEqual(manifest.application.version, options.expectedApplicationVersion, "EXPECTED_APPLICATION_VERSION_MISMATCH");
  expectEqual(manifest.application.git_commit, options.expectedGitCommit, "EXPECTED_GIT_COMMIT_MISMATCH");
  expectEqual(manifest.application.web_image_digest, options.expectedWebImageDigest, "EXPECTED_WEB_IMAGE_DIGEST_MISMATCH");
  expectEqual(manifest.application.worker_image_digest, options.expectedWorkerImageDigest, "EXPECTED_WORKER_IMAGE_DIGEST_MISMATCH");
  expectEqual(manifest.migration.head, options.expectedMigrationHead, "EXPECTED_MIGRATION_HEAD_MISMATCH");
  expectEqual(manifest.policy.id, options.expectedPolicyId, "EXPECTED_POLICY_ID_MISMATCH");
  expectEqual(manifest.policy.rpo_hours, options.expectedRpoHours, "EXPECTED_RPO_MISMATCH");
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const created = Date.parse(manifest.created_at);
  const recoveryPoint = Date.parse(manifest.consistency.recovery_point_at);
  if (created > now.getTime() + 5 * 60 * 1000) reject("BACKUP_FROM_FUTURE");
  if (now.getTime() - recoveryPoint > manifest.policy.rpo_hours * 60 * 60 * 1000) reject("BACKUP_STALE");
  const expectedMigration = await migrationManifest(options.migrationsDirectory);
  expectEqual(manifest.migration.head, expectedMigration.head, "MIGRATION_HEAD_MISMATCH");
  const storedMigrationFile = path.join(backupDirectory, "migrations.txt");
  await regularFile(storedMigrationFile, 4 * 1024 * 1024);
  const storedMigration = await safeText(storedMigrationFile, 4 * 1024 * 1024);
  expectEqual(storedMigration, expectedMigration.text, "MIGRATION_MANIFEST_MISMATCH");
  expectEqual(createHash("sha256").update(storedMigration).digest("hex"), manifest.migration.manifest_sha256, "MIGRATION_MANIFEST_SHA_MISMATCH");
  const reconciliationFile = path.join(backupDirectory, "reconciliation.json");
  const reconciliation = await readReconciliation(backupDirectory);
  expectEqual(await sha256File(reconciliationFile), manifest.reconciliation.sha256, "RECONCILIATION_SHA_MISMATCH");
  for (const key of Object.keys(ARTIFACT_FILES)) {
    const file = path.join(backupDirectory, ARTIFACT_FILES[key]);
    const metadata = await regularFile(file);
    expectEqual(metadata.size, manifest.artifacts[key].bytes, "ARTIFACT_SIZE_MISMATCH");
    expectEqual(await sha256File(file), manifest.artifacts[key].sha256, "ARTIFACT_SHA_MISMATCH");
    if (ARCHIVE_KEYS.has(key)) expectEqual(await verifyArchive(file, manifest.artifacts[key].sha256), manifest.artifacts[key].entries, "ARTIFACT_ENTRIES_MISMATCH");
  }
  command("pg_restore", ["--list", path.join(backupDirectory, ARTIFACT_FILES.postgresql_dump)], "POSTGRES_DUMP_INVALID");
  return { backupDirectory, manifest, reconciliation, manifestFile, manifestSha: await sha256File(manifestFile), now };
}

export async function readDatabaseBytes(backupDirectory) {
  const resolved = path.resolve(backupDirectory);
  await directory(resolved);
  const manifestFile = path.join(resolved, "manifest.json");
  await regularFile(manifestFile, 128 * 1024);
  const manifest = validateManifest(parseStrictJson(await safeText(manifestFile, 128 * 1024)));
  return manifest.deployment.database_bytes;
}

function receiptMatchesManifest(receipt, manifest, manifestSha) {
  expectEqual(receipt.backup_id, manifest.backup_id, "RECEIPT_BACKUP_ID_MISMATCH");
  expectEqual(receipt.manifest_sha256, manifestSha, "RECEIPT_MANIFEST_SHA_MISMATCH");
  for (const key of ["deployment", "application", "migration", "policy", "consistency", "reconciliation", "artifacts"]) {
    expectEqual(JSON.stringify(receipt[key]), JSON.stringify(manifest[key]), "RECEIPT_MANIFEST_PROJECTION_MISMATCH");
  }
}

async function readReceipt(file, expectedResult) {
  await regularFile(file, 128 * 1024);
  const receipt = validateReceipt(parseStrictJson(await safeText(file, 128 * 1024)));
  expectEqual(receipt.result, expectedResult, "RECEIPT_LEVEL_MISMATCH");
  return receipt;
}

export async function verifyLocalBackup(options) {
  const inspected = await inspectBackup(options);
  const sourceMachineIdentity = await machineIdentity(options.machineIdentityFile);
  const sourceRoot = await fixedRootIdentity(options.sourceRoot, sourceMachineIdentity, "SOURCE_ROOT_INVALID");
  if (!isInside(inspected.backupDirectory, sourceRoot.root) || inspected.backupDirectory === sourceRoot.root) reject("SOURCE_ROOT_INVALID");
  const receipt = receiptFrom(inspected.manifest, inspected.manifestSha, "LOCAL_VERIFIED", options.locationId, inspected.now.toISOString(), {
    kind: "LOCAL_CAPTURE_VERIFICATION",
    source_machine_identity_sha256: sourceMachineIdentity,
    source_root_device: sourceRoot.device,
    source_root_inode: sourceRoot.inode,
    source_root_identity_sha256: sourceRoot.identitySha256,
    attestation: "TRUSTED_EXECUTION_UID_AND_FIXED_SOURCE_MACHINE_ROOT",
  });
  return options.receiptRoot
    ? publishReceipt(options.receiptRoot, receipt.result, receipt, [sourceRoot.root, options.migrationsDirectory])
    : receipt;
}

export async function verifyOffhostBackup(options) {
  const inspected = await inspectBackup(options);
  const localReceiptFile = path.resolve(options.localReceiptFile);
  const localReceipt = await readReceipt(localReceiptFile, "LOCAL_VERIFIED");
  receiptMatchesManifest(localReceipt, inspected.manifest, inspected.manifestSha);
  const receiverRoot = path.resolve(options.receiverRoot);
  const receiverMachineIdentity = await machineIdentity(options.machineIdentityFile);
  if (receiverMachineIdentity === localReceipt.evidence.source_machine_identity_sha256) reject("OFFHOST_MACHINE_NOT_DISTINCT");
  const receiverIdentity = await fixedRootIdentity(receiverRoot, receiverMachineIdentity, "OFFHOST_ROOT_INVALID");
  if (!isInside(inspected.backupDirectory, receiverRoot) || inspected.backupDirectory === receiverRoot) reject("OFFHOST_ROOT_INVALID");
  const receipt = receiptFrom(inspected.manifest, inspected.manifestSha, "OFFHOST_VERIFIED", options.locationId, inspected.now.toISOString(), {
    kind: "OFFHOST_RECEIVER_VERIFICATION",
    transfer_id: boundedString(options.transferId, IDENTIFIER, "TRANSFER_ID_INVALID"),
    source_location_id: localReceipt.location_id,
    source_machine_identity_sha256: localReceipt.evidence.source_machine_identity_sha256,
    local_receipt_sha256: await sha256File(localReceiptFile),
    receiver_machine_identity_sha256: receiverMachineIdentity,
    receiver_root_device: receiverIdentity.device,
    receiver_root_inode: receiverIdentity.inode,
    receiver_identity_sha256: receiverIdentity.identitySha256,
    attestation: "TRUSTED_EXECUTION_UID_AND_DISTINCT_MACHINE_FIXED_RECEIVER_ROOT",
  });
  return options.receiptRoot
    ? publishReceipt(options.receiptRoot, receipt.result, receipt, [receiverRoot, options.migrationsDirectory])
    : receipt;
}

export async function verifyOffhostChain(options) {
  const inspected = await inspectBackup(options);
  const offhostReceiptFile = path.resolve(options.offhostReceiptFile);
  const receipt = await readReceipt(offhostReceiptFile, "OFFHOST_VERIFIED");
  receiptMatchesManifest(receipt, inspected.manifest, inspected.manifestSha);
  return { ...inspected, offhostReceipt: receipt, offhostReceiptSha: await sha256File(offhostReceiptFile) };
}

function commandWithEnvironment(binary, args, environment, code) {
  const result = spawnSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024, env: environment });
  if (result.status !== 0 || result.error) reject(code);
  return result.stdout;
}

function databaseEnvironment(serviceFile) {
  return {
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C", LC_ALL: "C", PGSERVICEFILE: serviceFile, PGPASSFILE: "/dev/null",
    PGSSLKEY: "/dev/null", PGSSLCERT: "/dev/null", PGCONNECT_TIMEOUT: "15",
  };
}

function targetConnection(service, database) {
  boundedString(service, IDENTIFIER, "DATABASE_SERVICE_INVALID");
  boundedString(database, IDENTIFIER, "RESTORE_TARGET_INVALID");
  return `service=${service} dbname=${database}`;
}

async function buildRestoreReceipt(options) {
  const inspected = await verifyOffhostChain(options);
  const serviceFile = await credentialFile(options.serviceFile, options.credentialRoot);
  const targetDatabase = boundedString(options.targetDatabaseName, IDENTIFIER, "RESTORE_TARGET_INVALID");
  const targetDeploymentId = boundedString(options.targetDeploymentId, IDENTIFIER, "RESTORE_TARGET_INVALID");
  const targetMarkerId = boundedString(options.targetMarkerId, IDENTIFIER, "RESTORE_TARGET_INVALID");
  const targetAdminDatabase = boundedString(options.targetAdminDatabase, IDENTIFIER, "RESTORE_TARGET_INVALID");
  const targetClusterMarkerId = boundedString(options.targetClusterMarkerId, IDENTIFIER, "RESTORE_TARGET_INVALID");
  const expectedTargetSystemIdentifier = boundedString(options.expectedTargetSystemIdentifier, /^\d{10,30}$/, "RESTORE_TARGET_IDENTITY_MISMATCH");
  const restoreRunId = boundedString(options.restoreRunId, IDENTIFIER, "RESTORE_RUN_ID_INVALID");
  if (!targetDatabase.endsWith("_restore_test") || targetAdminDatabase === targetDatabase || expectedTargetSystemIdentifier === inspected.manifest.deployment.database_system_identifier) reject("RESTORE_TARGET_INVALID");
  const environment = databaseEnvironment(serviceFile);
  const adminConnection = targetConnection(options.databaseService, targetAdminDatabase);
  const adminIdentity = commandWithEnvironment("psql", ["--no-psqlrc", "--quiet", "--dbname", adminConnection, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c",
    "select current_database(),system_identifier::text,coalesce(shobj_description((select oid from pg_database where datname=current_database()),'pg_database'),''),(select rolsuper::text from pg_roles where rolname=current_user),(select count(*)::text from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()) from pg_control_system()"], environment, "RESTORE_CLUSTER_INSPECTION_FAILED").trim().split("\t");
  if (adminIdentity.length !== 5 || adminIdentity[0] !== targetAdminDatabase || adminIdentity[1] !== expectedTargetSystemIdentifier || adminIdentity[2] !== `chenyida-erp-restore-cluster/v2:TEST:${targetDeploymentId}:${targetClusterMarkerId}` || !["true", "t"].includes(adminIdentity[3]) || adminIdentity[4] !== "0") reject("RESTORE_CLUSTER_IDENTITY_MISMATCH");
  const connection = targetConnection(options.databaseService, targetDatabase);
  const identity = commandWithEnvironment("psql", ["--no-psqlrc", "--quiet", "--dbname", connection, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c",
    "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()),((current_setting('server_version_num')::integer/10000)::text),pg_encoding_to_char(d.encoding),d.datcollate,d.datctype,case d.datlocprovider when 'c' then 'libc' when 'i' then 'icu' when 'b' then 'builtin' else 'unknown' end,coalesce(d.datcollversion,'NONE') from pg_control_system() cross join pg_database d where d.datname=current_database()"], environment, "RESTORE_TARGET_INSPECTION_FAILED").trim().split("\t");
  if (identity.length !== 11 || identity[0] !== targetDatabase || identity[1] !== expectedTargetSystemIdentifier || identity[3] !== `chenyida-erp-restore-target/v2:${targetDeploymentId}:${targetMarkerId}:${restoreRunId}` || identity[4] !== "0") reject("RESTORE_TARGET_IDENTITY_MISMATCH");
  for (const value of [identity[1], identity[2]]) boundedString(value, /^\d{1,30}$/, "RESTORE_TARGET_IDENTITY_MISMATCH");
  const expectedProfile = [inspected.manifest.deployment.database_server_major, inspected.manifest.deployment.database_encoding, inspected.manifest.deployment.database_collate, inspected.manifest.deployment.database_ctype, inspected.manifest.deployment.database_locale_provider, inspected.manifest.deployment.database_collation_version];
  expectEqual(JSON.stringify(identity.slice(5)), JSON.stringify(expectedProfile), "RESTORE_TARGET_DATABASE_PROFILE_MISMATCH");
  const reconciliationSql = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-reconciliation.sql");
  await regularFile(reconciliationSql, 1024 * 1024);
  const databaseReport = validateDatabaseReport(commandWithEnvironment("psql", ["--no-psqlrc", "--quiet", "--dbname", connection, "-v", "ON_ERROR_STOP=1", "-f", reconciliationSql], environment, "RESTORE_DATABASE_RECONCILIATION_FAILED"));
  expectEqual(databaseReport, inspected.reconciliation.database.report, "RESTORE_DATABASE_RECONCILIATION_MISMATCH");
  const fileRoot = path.resolve(options.fileRoot);
  const fileRootName = path.basename(fileRoot);
  if (!fileRootName.endsWith("_restore_test")) reject("RESTORE_TARGET_INVALID");
  await verifyRestoredFiles({ backupDirectory: inspected.backupDirectory, fileRoot, targetDeploymentId, targetMarkerId, restoreRunId });
  const restoredFiles = {
    uploads: await fileTree(path.join(fileRoot, "uploads")),
    attachments: await fileTree(path.join(fileRoot, "attachments")),
    backup_status: await fileTree(path.join(fileRoot, "backup_status")),
  };
  expectEqual(JSON.stringify(restoredFiles), JSON.stringify(inspected.reconciliation.files), "RESTORE_FILE_RECONCILIATION_MISMATCH");
  const reconciliation = {
    contract: "chenyida-erp-restore-reconciliation/v1",
    source_sha256: inspected.manifest.reconciliation.sha256,
    target_database_report_sha256: createHash("sha256").update(databaseReport).digest("hex"),
    target_file_trees_sha256: createHash("sha256").update(JSON.stringify(restoredFiles)).digest("hex"),
    result: "MATCHED",
  };
  const verifiedAt = inspected.now.toISOString();
  const receipt = receiptFrom(inspected.manifest, inspected.manifestSha, "RESTORE_VERIFIED", options.locationId, verifiedAt, {
    kind: "ISOLATED_RESTORE_VERIFICATION",
    source_location_id: inspected.offhostReceipt.evidence.source_location_id,
    offhost_location_id: inspected.offhostReceipt.location_id,
    offhost_receiver_identity_sha256: inspected.offhostReceipt.evidence.receiver_identity_sha256,
    offhost_receipt_sha256: inspected.offhostReceiptSha,
    restore_run_id: restoreRunId,
    restored_at: verifiedAt,
    target: {
      deployment_class: "TEST",
      deployment_id: targetDeploymentId,
      database_name: targetDatabase,
      database_system_identifier: identity[1],
      database_oid: identity[2],
      marker_id: targetMarkerId,
      cluster_marker_id: targetClusterMarkerId,
      database_server_major: identity[5],
      database_encoding: identity[6],
      database_collate: identity[7],
      database_ctype: identity[8],
      database_locale_provider: identity[9],
      database_collation_version: identity[10],
      file_root_name: fileRootName,
    },
    reconciliation,
    reconciliation_sha256: createHash("sha256").update(JSON.stringify(reconciliation)).digest("hex"),
    attestation: "TRUSTED_EXECUTION_UID_AND_DISTINCT_CLUSTER_ACTIVE_INSPECTION",
  });
  return { receipt, inspected, fileRoot };
}

export async function prepareRestoreReceipt(options) {
  const { receipt, fileRoot } = await buildRestoreReceipt(options);
  const preparedReceiptFile = path.resolve(options.preparedReceiptFile);
  const restoreRoot = path.dirname(fileRoot);
  const restoreRootMetadata = await directory(restoreRoot);
  if (restoreRootMetadata.uid !== process.getuid?.() || (restoreRootMetadata.mode & 0o022) !== 0
    || path.dirname(preparedReceiptFile) !== restoreRoot
    || path.basename(preparedReceiptFile) !== `.prepared-${receipt.backup_id}-${receipt.evidence.restore_run_id}.json`) reject("PREPARED_RECEIPT_PATH_INVALID");
  await durableNoClobberJson(preparedReceiptFile, receipt, 0o400, "PREPARED_RECEIPT_CONFLICT");
  return receipt;
}

async function readPreparedRestoreReceipt(file) {
  const preparedReceiptFile = path.resolve(file);
  const parent = path.dirname(preparedReceiptFile);
  const parentMetadata = await directory(parent);
  const metadata = await regularFile(preparedReceiptFile, 128 * 1024);
  if (parentMetadata.uid !== process.getuid?.() || (parentMetadata.mode & 0o022) !== 0
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o400) reject("PREPARED_RECEIPT_UNSAFE");
  const receipt = validateReceipt(parseStrictJson(await safeText(preparedReceiptFile, 128 * 1024)));
  if (receipt.result !== "RESTORE_VERIFIED"
    || path.basename(preparedReceiptFile) !== `.prepared-${receipt.backup_id}-${receipt.evidence.restore_run_id}.json`) reject("PREPARED_RECEIPT_INVALID");
  return { preparedReceiptFile, parent, receipt };
}

export async function publishPreparedRestoreReceipt(options) {
  const { parent, receipt } = await readPreparedRestoreReceipt(options.preparedReceiptFile);
  return publishReceipt(options.receiptRoot, receipt.result, receipt, [parent]);
}

export async function verifyRestoredFiles(options) {
  const backupDirectory = path.resolve(options.backupDirectory);
  const fileRoot = path.resolve(options.fileRoot);
  await directory(backupDirectory);
  await directory(fileRoot);
  const markerValue = `chenyida-erp-restored-target/v2:${boundedString(options.targetDeploymentId, IDENTIFIER, "RESTORE_TARGET_INVALID")}:${boundedString(options.targetMarkerId, IDENTIFIER, "RESTORE_TARGET_INVALID")}:${boundedString(options.restoreRunId, IDENTIFIER, "RESTORE_RUN_ID_INVALID")}\n`;
  const markerFile = path.join(fileRoot, RESTORE_TARGET_MARKER);
  const markerMetadata = await regularFile(markerFile, 512);
  if (markerMetadata.uid !== process.getuid?.() || ![0o400, 0o600].includes(markerMetadata.mode & 0o777) || await safeText(markerFile, 512) !== markerValue) reject("RESTORED_TARGET_MARKER_INVALID");
  const rootEntries = await readdir(fileRoot, { withFileTypes: true });
  const expected = new Set(["uploads", "attachments", "backup_status", RESTORE_TARGET_MARKER]);
  if (rootEntries.length !== expected.size || rootEntries.some((entry) => !expected.has(entry.name) || (entry.name === RESTORE_TARGET_MARKER ? !entry.isFile() || entry.isSymbolicLink() : !entry.isDirectory() || entry.isSymbolicLink()))) reject("RESTORED_ROOT_INVALID");
  const reconciliation = await readReconciliation(backupDirectory);
  for (const [directoryName, artifactKey] of [["uploads", "uploads"], ["attachments", "attachments"], ["backup_status", "backup_status"]]) {
    const tree = await fileTree(path.join(fileRoot, directoryName));
    expectEqual(JSON.stringify(tree), JSON.stringify(reconciliation.files[artifactKey]), "RESTORED_FILE_RECONCILIATION_MISMATCH");
  }
  return true;
}

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || index + 1 >= argv.length || result[key.slice(2)] !== undefined) reject("ARGUMENT_INVALID");
    result[key.slice(2)] = argv[index + 1];
  }
  return result;
}

function only(actual, expected, optional = []) {
  const keys = Object.keys(actual).sort();
  const required = new Set(expected);
  const allowed = new Set([...expected, ...optional]);
  if (keys.some((key) => !allowed.has(key)) || [...required].some((key) => actual[key] === undefined)) reject("ARGUMENT_SET_INVALID");
}

const VERIFICATION_ARGUMENTS = ["backup", "migrations", "expected-deployment-class", "expected-deployment-id", "expected-database-name", "expected-database-system-identifier", "expected-database-oid", "expected-database-marker", "expected-database-bytes", "expected-database-server-major", "expected-database-encoding", "expected-database-collate", "expected-database-ctype", "expected-database-locale-provider", "expected-database-collation-version", "expected-app-version", "expected-git-commit", "expected-web-image-digest", "expected-worker-image-digest", "expected-migration-head", "expected-policy-id", "expected-rpo-hours"];
const RESTORE_TARGET_ARGUMENTS = [
  "offhost-receipt", "location-id", "restore-run-id", "target-deployment-id", "target-database-name",
  "target-marker-id", "target-admin-database", "target-cluster-marker-id",
  "expected-target-system-identifier", "file-root", "credential-root", "db-service-file", "db-service",
];

function verificationOptions(input) {
  return {
    backupDirectory: input.backup,
    migrationsDirectory: input.migrations,
    expectedDeploymentClass: input["expected-deployment-class"],
    expectedDeploymentId: input["expected-deployment-id"],
    expectedDatabaseName: input["expected-database-name"],
    expectedDatabaseSystemIdentifier: input["expected-database-system-identifier"],
    expectedDatabaseOid: input["expected-database-oid"],
    expectedDatabaseMarker: input["expected-database-marker"],
    expectedDatabaseBytes: positiveDecimal(input["expected-database-bytes"], "EXPECTED_DATABASE_BYTES_INVALID"),
    expectedDatabaseServerMajor: input["expected-database-server-major"],
    expectedDatabaseEncoding: input["expected-database-encoding"],
    expectedDatabaseCollate: input["expected-database-collate"],
    expectedDatabaseCtype: input["expected-database-ctype"],
    expectedDatabaseLocaleProvider: input["expected-database-locale-provider"],
    expectedDatabaseCollationVersion: input["expected-database-collation-version"],
    expectedApplicationVersion: input["expected-app-version"],
    expectedGitCommit: input["expected-git-commit"],
    expectedWebImageDigest: input["expected-web-image-digest"],
    expectedWorkerImageDigest: input["expected-worker-image-digest"],
    expectedMigrationHead: input["expected-migration-head"],
    expectedPolicyId: input["expected-policy-id"],
    expectedRpoHours: Number(input["expected-rpo-hours"]),
  };
}

function restoreOptions(input) {
  return {
    ...verificationOptions(input),
    offhostReceiptFile: input["offhost-receipt"],
    locationId: input["location-id"],
    restoreRunId: input["restore-run-id"],
    targetDeploymentId: input["target-deployment-id"],
    targetDatabaseName: input["target-database-name"],
    targetMarkerId: input["target-marker-id"],
    targetAdminDatabase: input["target-admin-database"],
    targetClusterMarkerId: input["target-cluster-marker-id"],
    expectedTargetSystemIdentifier: input["expected-target-system-identifier"],
    fileRoot: input["file-root"],
    credentialRoot: input["credential-root"],
    serviceFile: input["db-service-file"],
    databaseService: input["db-service"],
    preparedReceiptFile: input["prepared-receipt"],
  };
}

async function main(argv) {
  const [commandName, ...rest] = argv;
  const input = args(rest);
  if (commandName === "create-reconciliation") {
    only(input, ["backup", "database-report", "uploads", "attachments", "backup-status"]);
    await createReconciliation({ backupDirectory: input.backup, databaseReportFile: input["database-report"], uploadsDirectory: input.uploads, attachmentsDirectory: input.attachments, backupStatusDirectory: input["backup-status"] });
    process.stdout.write("source reconciliation created\n");
    return;
  }
  if (commandName === "verify-source-reconciliation") {
    only(input, ["backup", "database-report", "uploads", "attachments", "backup-status"]);
    await verifySourceReconciliation({ backupDirectory: input.backup, databaseReportFile: input["database-report"], uploadsDirectory: input.uploads, attachmentsDirectory: input.attachments, backupStatusDirectory: input["backup-status"] });
    process.stdout.write("source reconciliation matched\n");
    return;
  }
  if (commandName === "create-manifest") {
    only(input, ["backup", "migrations", "backup-id", "created-at", "deployment-class", "deployment-id", "database-name", "database-system-identifier", "database-oid", "database-marker", "database-bytes", "database-server-major", "database-encoding", "database-collate", "database-ctype", "database-locale-provider", "database-collation-version", "app-version", "git-commit", "web-image-digest", "worker-image-digest", "policy-id", "rpo-hours", "web-container", "web-container-id", "worker-container", "worker-container-id", "recovery-point-at", "consistency-verified-after", "uploads-entries", "attachments-entries", "backup-status-entries"]);
    const manifest = await createManifest({
      backupDirectory: input.backup,
      migrationsDirectory: input.migrations,
      backupId: input["backup-id"],
      createdAt: input["created-at"],
      deploymentClass: input["deployment-class"],
      deploymentId: input["deployment-id"],
      databaseName: input["database-name"],
      databaseSystemIdentifier: input["database-system-identifier"],
      databaseOid: input["database-oid"],
      databaseMarker: input["database-marker"],
      databaseBytes: positiveDecimal(input["database-bytes"], "DATABASE_BYTES_INVALID"),
      databaseServerMajor: input["database-server-major"],
      databaseEncoding: input["database-encoding"],
      databaseCollate: input["database-collate"],
      databaseCtype: input["database-ctype"],
      databaseLocaleProvider: input["database-locale-provider"],
      databaseCollationVersion: input["database-collation-version"],
      applicationVersion: input["app-version"],
      gitCommit: input["git-commit"],
      webImageDigest: input["web-image-digest"],
      workerImageDigest: input["worker-image-digest"],
      policyId: input["policy-id"],
      rpoHours: Number(input["rpo-hours"]),
      webContainer: input["web-container"],
      webContainerId: input["web-container-id"],
      workerContainer: input["worker-container"],
      workerContainerId: input["worker-container-id"],
      recoveryPointAt: input["recovery-point-at"],
      consistencyVerifiedAfter: input["consistency-verified-after"],
      entries: {
        uploads: Number(input["uploads-entries"]),
        attachments: Number(input["attachments-entries"]),
        backup_status: Number(input["backup-status-entries"]),
      },
    });
    process.stdout.write(`${manifest.backup_id}\n`);
    return;
  }
  if (commandName === "verify-local") {
    only(input, [...VERIFICATION_ARGUMENTS, "location-id", "receipt-root", "source-root"], ["machine-identity-file"]);
    const receipt = await verifyLocalBackup({ ...verificationOptions(input), locationId: input["location-id"], receiptRoot: input["receipt-root"], sourceRoot: input["source-root"], machineIdentityFile: input["machine-identity-file"] });
    process.stdout.write(`${receipt.backup_id} ${receipt.result}\n`);
    return;
  }
  if (commandName === "verify-offhost") {
    only(input, [...VERIFICATION_ARGUMENTS, "location-id", "receipt-root", "local-receipt", "transfer-id", "receiver-root"], ["machine-identity-file"]);
    const receipt = await verifyOffhostBackup({ ...verificationOptions(input), locationId: input["location-id"], receiptRoot: input["receipt-root"], localReceiptFile: input["local-receipt"], transferId: input["transfer-id"], receiverRoot: input["receiver-root"], machineIdentityFile: input["machine-identity-file"] });
    process.stdout.write(`${receipt.backup_id} ${receipt.result}\n`);
    return;
  }
  if (commandName === "verify-offhost-chain") {
    only(input, [...VERIFICATION_ARGUMENTS, "offhost-receipt"]);
    const result = await verifyOffhostChain({ ...verificationOptions(input), offhostReceiptFile: input["offhost-receipt"] });
    process.stdout.write(`${result.manifest.backup_id} OFFHOST_CHAIN_VERIFIED\n`);
    return;
  }
  if (commandName === "verify-restored-files") {
    only(input, ["backup", "file-root", "target-deployment-id", "target-marker-id", "restore-run-id"]);
    await verifyRestoredFiles({
      backupDirectory: input.backup,
      fileRoot: input["file-root"],
      targetDeploymentId: input["target-deployment-id"],
      targetMarkerId: input["target-marker-id"],
      restoreRunId: input["restore-run-id"],
    });
    process.stdout.write("restored file verification passed\n");
    return;
  }
  if (commandName === "durably-sync-tree") {
    only(input, ["root"]);
    await durableSyncTree(input.root);
    process.stdout.write("tree durably synchronized\n");
    return;
  }
  if (commandName === "durably-sync-file") {
    only(input, ["file"]);
    await durableSyncFile(input.file);
    process.stdout.write("file durably synchronized\n");
    return;
  }
  if (commandName === "read-database-bytes") {
    only(input, ["backup"]);
    process.stdout.write(`${await readDatabaseBytes(input.backup)}\n`);
    return;
  }
  if (commandName === "prepare-restore") {
    only(input, [...VERIFICATION_ARGUMENTS, ...RESTORE_TARGET_ARGUMENTS, "prepared-receipt"]);
    const receipt = await prepareRestoreReceipt(restoreOptions(input));
    process.stdout.write(`${receipt.backup_id} RESTORE_PREPARED\n`);
    return;
  }
  if (commandName === "publish-prepared-restore") {
    only(input, ["prepared-receipt", "receipt-root"]);
    const receipt = await publishPreparedRestoreReceipt({ preparedReceiptFile: input["prepared-receipt"], receiptRoot: input["receipt-root"] });
    process.stdout.write(`${receipt.backup_id} ${receipt.result}\n`);
    return;
  }
  reject("COMMAND_INVALID");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof BackupContractError ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`backup recovery contract rejected: ${code}\n`);
    process.exitCode = 1;
  });
}
