import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_IDENTITY_CONTRACT = "chenyida-erp-runtime-release-identity/v2";
export const RELEASE_IDENTITY_FILE = "release-identity.json";
export const RELEASE_IDENTITY_ROOT_MARKER = ".chenyida-erp-release-identity-root-v1";
export const RELEASE_IDENTITY_ROOT_MARKER_VALUE = "chenyida-erp-release-identity-root/v1\n";
export const RELEASE_IDENTITY_PUBLISH_LOCK = ".release-identity-transaction-v1";
export const RELEASE_IDENTITY_TRANSACTION_CONTRACT = "chenyida-erp-runtime-release-identity-transaction/v1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEPLOYMENT_CLASSES = new Set(["TEST", "UAT", "PRODUCTION"]);
const ROOT_MODE = 0o750;
const FILE_MODE = 0o440;
const MAX_IDENTITY_BYTES = 64 * 1024;

export class ReleaseIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseIdentityError";
    this.code = code;
  }
}

function reject(code) {
  throw new ReleaseIdentityError(code);
}

function record(value, code = "OBJECT_REQUIRED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code = "FIELDS_INVALID") {
  const actual = Object.keys(record(value, code)).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) reject(code);
}

class StrictJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    const result = this.value();
    this.space();
    if (this.index !== this.source.length) reject("JSON_TRAILING_CONTENT");
    return result;
  }

  space() {
    while (/\s/.test(this.source[this.index] || "")) this.index += 1;
  }

  value() {
    this.space();
    const token = this.source[this.index];
    if (token === "{") return this.object();
    if (token === "[") return this.array();
    if (token === '"') return this.string();
    for (const [word, value] of [["true", true], ["false", false], ["null", null]]) {
      if (this.source.slice(this.index, this.index + word.length) === word) {
        this.index += word.length;
        return value;
      }
    }
    const match = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) reject("JSON_VALUE_INVALID");
    this.index += match[0].length;
    const result = Number(match[0]);
    if (!Number.isFinite(result)) reject("JSON_NUMBER_INVALID");
    return result;
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
      escaped = !escaped && current === "\\";
      this.index += 1;
    }
    reject("JSON_STRING_INVALID");
  }

  object() {
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
      if (this.source[this.index] !== '"') reject("JSON_KEY_INVALID");
      const key = this.string();
      if (keys.has(key)) reject("JSON_DUPLICATE_KEY");
      keys.add(key);
      this.space();
      if (this.source[this.index] !== ":") reject("JSON_COLON_REQUIRED");
      this.index += 1;
      result[key] = this.value();
      this.space();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") reject("JSON_SEPARATOR_REQUIRED");
      this.index += 1;
    }
    reject("JSON_OBJECT_INCOMPLETE");
  }

  array() {
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
      if (this.source[this.index] !== ",") reject("JSON_SEPARATOR_REQUIRED");
      this.index += 1;
    }
    reject("JSON_ARRAY_INCOMPLETE");
  }
}

export function parseStrictJson(source, maximumBytes = MAX_IDENTITY_BYTES) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2 || maximumBytes > 64 * 1024 * 1024) reject("JSON_SIZE_INVALID");
  if (typeof source !== "string" || Buffer.byteLength(source) > maximumBytes) reject("JSON_SIZE_INVALID");
  return new StrictJsonParser(source).parse();
}

export function validateReleaseIdentity(value) {
  exactKeys(value, [
    "schema_version", "contract", "deployment_class", "deployment_id", "release_id", "release_manifest_sha256", "supervisor_bundle_sha256", "authorization_sha256", "application_version", "git_commit",
    "web_container_id", "web_image_digest", "worker_container_id", "worker_image_digest", "generated_at",
  ], "RELEASE_IDENTITY_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RELEASE_IDENTITY_CONTRACT) reject("RELEASE_IDENTITY_VERSION_INVALID");
  if (!DEPLOYMENT_CLASSES.has(value.deployment_class)) reject("RELEASE_DEPLOYMENT_CLASS_INVALID");
  if (typeof value.deployment_id !== "string" || !IDENTIFIER.test(value.deployment_id)) reject("RELEASE_DEPLOYMENT_ID_INVALID");
  if (typeof value.release_id !== "string" || !IDENTIFIER.test(value.release_id)) reject("RELEASE_ID_INVALID");
  for (const field of ["release_manifest_sha256", "supervisor_bundle_sha256", "authorization_sha256"]) if (typeof value[field] !== "string" || !SHA256.test(value[field])) reject("RELEASE_CONTROL_DIGEST_INVALID");
  if (typeof value.application_version !== "string" || !VERSION.test(value.application_version)) reject("RELEASE_VERSION_INVALID");
  if (typeof value.git_commit !== "string" || !COMMIT.test(value.git_commit)) reject("RELEASE_GIT_COMMIT_INVALID");
  if (typeof value.web_container_id !== "string" || !CONTAINER_ID.test(value.web_container_id)) reject("RELEASE_WEB_CONTAINER_INVALID");
  if (typeof value.worker_container_id !== "string" || !CONTAINER_ID.test(value.worker_container_id) || value.worker_container_id === value.web_container_id) reject("RELEASE_WORKER_CONTAINER_INVALID");
  if (typeof value.web_image_digest !== "string" || !IMAGE_DIGEST.test(value.web_image_digest)) reject("RELEASE_WEB_IMAGE_INVALID");
  if (typeof value.worker_image_digest !== "string" || !IMAGE_DIGEST.test(value.worker_image_digest)) reject("RELEASE_WORKER_IMAGE_INVALID");
  if (typeof value.generated_at !== "string" || !ISO_UTC.test(value.generated_at) || Number.isNaN(Date.parse(value.generated_at))) reject("RELEASE_GENERATED_AT_INVALID");
  return value;
}

function readerGid(value) {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 2_147_483_647) reject("RELEASE_READER_GID_INVALID");
  return result;
}

function exactMode(stat, mode) {
  return (stat.mode & 0o7777) === mode;
}

async function trustedFileText(file, gid, mode, maxBytes) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0 || before.gid !== gid || !exactMode(before, mode) || before.size < 2 || before.size > maxBytes) reject("RELEASE_TRUSTED_FILE_INVALID");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) reject("RELEASE_TRUSTED_FILE_REPLACED");
    const text = await handle.readFile("utf8");
    const afterHandle = await handle.stat();
    const afterPath = await lstat(file);
    if (afterHandle.dev !== opened.dev || afterHandle.ino !== opened.ino || afterHandle.size !== opened.size || afterHandle.mtimeMs !== opened.mtimeMs || afterHandle.ctimeMs !== opened.ctimeMs
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino || afterPath.uid !== 0 || afterPath.gid !== gid || afterPath.nlink !== 1 || !exactMode(afterPath, mode)) reject("RELEASE_TRUSTED_FILE_REPLACED");
    return text;
  } finally {
    await handle.close();
  }
}

async function trustedRoot(root, gid) {
  if (typeof root !== "string" || root !== path.resolve(root) || root === "/") reject("RELEASE_ROOT_PATH_INVALID");
  if (await realpath(root) !== root) reject("RELEASE_ROOT_PATH_INVALID");
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== gid || !exactMode(stat, ROOT_MODE)) reject("RELEASE_ROOT_TRUST_INVALID");
  const marker = path.join(root, RELEASE_IDENTITY_ROOT_MARKER);
  const markerValue = await trustedFileText(marker, gid, FILE_MODE, 256);
  if (markerValue !== RELEASE_IDENTITY_ROOT_MARKER_VALUE) reject("RELEASE_ROOT_MARKER_INVALID");
  return root;
}

export async function readTrustedReleaseIdentity({ root, readerGid: requestedGid }) {
  const gid = readerGid(requestedGid);
  const safeRoot = await trustedRoot(root, gid);
  const source = await trustedFileText(path.join(safeRoot, RELEASE_IDENTITY_FILE), gid, FILE_MODE, MAX_IDENTITY_BYTES);
  return validateReleaseIdentity(parseStrictJson(source));
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalIdentity(identity) {
  return `${JSON.stringify(identity)}\n`;
}

function sameReleaseEvidence(left, right) {
  return [
    "schema_version", "contract", "deployment_class", "deployment_id", "release_id", "release_manifest_sha256", "supervisor_bundle_sha256", "authorization_sha256", "application_version", "git_commit",
    "web_container_id", "web_image_digest", "worker_container_id", "worker_image_digest",
  ].every((key) => left[key] === right[key]);
}

const TRANSACTION_FILE = "transaction.json";
const CANDIDATE_FILE = "candidate.json";

async function currentIdentity(root, gid) {
  try {
    const text = await trustedFileText(path.join(root, RELEASE_IDENTITY_FILE), gid, FILE_MODE, MAX_IDENTITY_BYTES);
    const identity = validateReleaseIdentity(parseStrictJson(text));
    if (text !== canonicalIdentity(identity)) reject("RELEASE_IDENTITY_NOT_CANONICAL");
    return { identity, sha256: digest(text) };
  } catch (error) {
    if (error?.code === "ENOENT") return { identity: null, sha256: null };
    throw error;
  }
}

async function writeTransactionFile(directory, filename, payload, gid = 0, mode = 0o400) {
  const temporary = path.join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  const target = path.join(directory, filename);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(payload);
    await handle.chown(0, gid);
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function transactionDirectory(root) {
  const directory = path.join(root, RELEASE_IDENTITY_PUBLISH_LOCK);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || !exactMode(stat, 0o700)) reject("RELEASE_TRANSACTION_ROOT_INVALID");
  return directory;
}

async function removeTransaction(root) {
  const directory = await transactionDirectory(root);
  const names = await readdir(directory);
  for (const name of names) {
    if (![TRANSACTION_FILE, CANDIDATE_FILE].includes(name) && !/^\.(?:transaction|candidate)\.json\.[A-Za-z0-9.-]+\.tmp$/.test(name)) reject("RELEASE_TRANSACTION_CONTENT_INVALID");
    const file = path.join(directory, name); const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o0022) !== 0) reject("RELEASE_TRANSACTION_CONTENT_INVALID");
  }
  if (names.includes(TRANSACTION_FILE)) {
    await unlink(path.join(directory, TRANSACTION_FILE));
    await syncDirectory(directory);
  }
  for (const name of names) if (name !== TRANSACTION_FILE) await unlink(path.join(directory, name));
  await rmdir(directory);
  await syncDirectory(root);
}

async function loadTransaction(root, gid) {
  const directory = await transactionDirectory(root);
  const names = (await readdir(directory)).sort();
  if (!names.includes(TRANSACTION_FILE)) {
    await removeTransaction(root);
    return null;
  }
  if (names.length !== 2 || names[0] !== CANDIDATE_FILE || names[1] !== TRANSACTION_FILE) reject("RELEASE_TRANSACTION_CONTENT_INVALID");
  const metadataText = await trustedFileText(path.join(directory, TRANSACTION_FILE), 0, 0o400, 4096);
  const metadata = parseStrictJson(metadataText, 4096);
  exactKeys(metadata, ["schema_version", "contract", "transaction_id", "authorization_sha256", "reader_gid", "candidate_sha256", "previous_sha256", "prepared_at"], "RELEASE_TRANSACTION_FIELDS_INVALID");
  if (metadata.schema_version !== 1 || metadata.contract !== RELEASE_IDENTITY_TRANSACTION_CONTRACT || typeof metadata.transaction_id !== "string" || !IDENTIFIER.test(metadata.transaction_id)
    || typeof metadata.authorization_sha256 !== "string" || !SHA256.test(metadata.authorization_sha256) || metadata.reader_gid !== gid || typeof metadata.candidate_sha256 !== "string" || !SHA256.test(metadata.candidate_sha256)
    || (metadata.previous_sha256 !== null && (typeof metadata.previous_sha256 !== "string" || !SHA256.test(metadata.previous_sha256))) || typeof metadata.prepared_at !== "string" || !ISO_UTC.test(metadata.prepared_at) || Number.isNaN(Date.parse(metadata.prepared_at))) reject("RELEASE_TRANSACTION_INVALID");
  if (metadataText !== `${JSON.stringify(metadata)}\n`) reject("RELEASE_TRANSACTION_NOT_CANONICAL");
  const candidateText = await trustedFileText(path.join(directory, CANDIDATE_FILE), gid, FILE_MODE, MAX_IDENTITY_BYTES);
  const identity = validateReleaseIdentity(parseStrictJson(candidateText));
  if (candidateText !== canonicalIdentity(identity) || digest(candidateText) !== metadata.candidate_sha256 || identity.authorization_sha256 !== metadata.authorization_sha256) reject("RELEASE_TRANSACTION_CANDIDATE_INVALID");
  return { directory, metadata, identity };
}

async function reconcileStaleTransaction(root, gid) {
  try {
    await transactionDirectory(root);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const transaction = await loadTransaction(root, gid);
  if (transaction === null) return null;
  const current = await currentIdentity(root, gid);
  if (current.sha256 !== transaction.metadata.previous_sha256 && current.sha256 !== transaction.metadata.candidate_sha256) reject("RELEASE_TRANSACTION_FINAL_DIVERGED");
  const committed = current.sha256 === transaction.metadata.candidate_sha256;
  await removeTransaction(root);
  return committed ? transaction.identity : null;
}

export async function prepareReleaseIdentity({ root, readerGid: requestedGid, identity, transactionId, authorizationSha256 }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_PUBLISH_ROOT_REQUIRED");
  const gid = readerGid(requestedGid); const safeRoot = await trustedRoot(root, gid);
  if (typeof transactionId !== "string" || !IDENTIFIER.test(transactionId) || typeof authorizationSha256 !== "string" || !SHA256.test(authorizationSha256)) reject("RELEASE_TRANSACTION_CONTROL_INVALID");
  const recovered = await reconcileStaleTransaction(safeRoot, gid);
  const validated = validateReleaseIdentity(identity);
  if (validated.authorization_sha256 !== authorizationSha256) reject("RELEASE_TRANSACTION_CONTROL_INVALID");
  const existing = await currentIdentity(safeRoot, gid);
  if (existing.identity && sameReleaseEvidence(existing.identity, validated)) return { transaction_id: null, candidate_sha256: existing.sha256, already_published: true, identity: existing.identity, recovered };
  if (existing.identity && Date.parse(validated.generated_at) <= Date.parse(existing.identity.generated_at)) reject("RELEASE_GENERATION_NOT_MONOTONIC");
  const directory = path.join(safeRoot, RELEASE_IDENTITY_PUBLISH_LOCK);
  await mkdir(directory, { mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (directoryStat.uid !== 0 || directoryStat.gid !== 0 || !exactMode(directoryStat, 0o700)) reject("RELEASE_TRANSACTION_ROOT_INVALID");
  const candidate = canonicalIdentity(validated); const candidateSha256 = digest(candidate);
  const metadata = { schema_version: 1, contract: RELEASE_IDENTITY_TRANSACTION_CONTRACT, transaction_id: transactionId, authorization_sha256: authorizationSha256, reader_gid: gid, candidate_sha256: candidateSha256, previous_sha256: existing.sha256, prepared_at: new Date().toISOString() };
  try {
    await writeTransactionFile(directory, CANDIDATE_FILE, candidate, gid, FILE_MODE);
    await writeTransactionFile(directory, TRANSACTION_FILE, `${JSON.stringify(metadata)}\n`, 0, 0o400);
    await syncDirectory(safeRoot);
  } catch (error) {
    await removeTransaction(safeRoot).catch(() => undefined);
    throw error;
  }
  return { transaction_id: transactionId, candidate_sha256: candidateSha256, already_published: false, identity: validated, recovered };
}

function assertTransactionControl(transaction, transactionId, authorizationSha256) {
  if (!transaction || transaction.metadata.transaction_id !== transactionId || transaction.metadata.authorization_sha256 !== authorizationSha256) reject("RELEASE_TRANSACTION_CONTROL_MISMATCH");
}

export async function commitPreparedReleaseIdentity({ root, readerGid: requestedGid, transactionId, authorizationSha256 }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_PUBLISH_ROOT_REQUIRED");
  const gid = readerGid(requestedGid); const safeRoot = await trustedRoot(root, gid); const transaction = await loadTransaction(safeRoot, gid);
  assertTransactionControl(transaction, transactionId, authorizationSha256);
  const current = await currentIdentity(safeRoot, gid);
  if (current.sha256 === transaction.metadata.candidate_sha256) { await removeTransaction(safeRoot); return transaction.identity; }
  if (current.sha256 !== transaction.metadata.previous_sha256) reject("RELEASE_TRANSACTION_FINAL_DIVERGED");
  await writeTransactionFile(safeRoot, RELEASE_IDENTITY_FILE, canonicalIdentity(transaction.identity), gid, FILE_MODE);
  const published = await currentIdentity(safeRoot, gid);
  if (published.sha256 !== transaction.metadata.candidate_sha256) reject("RELEASE_TRANSACTION_COMMIT_FAILED");
  await removeTransaction(safeRoot);
  return published.identity;
}

export async function abortPreparedReleaseIdentity({ root, readerGid: requestedGid, transactionId, authorizationSha256 }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_PUBLISH_ROOT_REQUIRED");
  const gid = readerGid(requestedGid); const safeRoot = await trustedRoot(root, gid); const transaction = await loadTransaction(safeRoot, gid);
  assertTransactionControl(transaction, transactionId, authorizationSha256);
  const current = await currentIdentity(safeRoot, gid);
  if (current.sha256 === transaction.metadata.candidate_sha256) reject("RELEASE_TRANSACTION_ALREADY_COMMITTED");
  if (current.sha256 !== transaction.metadata.previous_sha256) reject("RELEASE_TRANSACTION_FINAL_DIVERGED");
  await removeTransaction(safeRoot);
}

export async function publishReleaseIdentity({ root, readerGid: requestedGid, identity }) {
  const prepared = await prepareReleaseIdentity({ root, readerGid: requestedGid, identity, transactionId: identity.authorization_sha256, authorizationSha256: identity.authorization_sha256 });
  if (prepared.already_published) return prepared.identity;
  return commitPreparedReleaseIdentity({ root, readerGid: requestedGid, transactionId: prepared.transaction_id, authorizationSha256: identity.authorization_sha256 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stderr.write("RELEASE_IDENTITY_DIRECT_CLI_DISABLED\n");
  process.exitCode = 1;
}
