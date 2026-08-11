import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_IDENTITY_CONTRACT = "chenyida-erp-runtime-release-identity/v1";
export const RELEASE_IDENTITY_FILE = "release-identity.json";
export const RELEASE_IDENTITY_ROOT_MARKER = ".chenyida-erp-release-identity-root-v1";
export const RELEASE_IDENTITY_ROOT_MARKER_VALUE = "chenyida-erp-release-identity-root/v1\n";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
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

export function parseStrictJson(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > MAX_IDENTITY_BYTES) reject("JSON_SIZE_INVALID");
  return new StrictJsonParser(source).parse();
}

export function validateReleaseIdentity(value) {
  exactKeys(value, [
    "schema_version", "contract", "deployment_class", "deployment_id", "application_version", "git_commit",
    "web_container_id", "web_image_digest", "worker_container_id", "worker_image_digest", "generated_at",
  ], "RELEASE_IDENTITY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_IDENTITY_CONTRACT) reject("RELEASE_IDENTITY_VERSION_INVALID");
  if (!DEPLOYMENT_CLASSES.has(value.deployment_class)) reject("RELEASE_DEPLOYMENT_CLASS_INVALID");
  if (typeof value.deployment_id !== "string" || !IDENTIFIER.test(value.deployment_id)) reject("RELEASE_DEPLOYMENT_ID_INVALID");
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

export async function publishReleaseIdentity({ root, readerGid: requestedGid, identity }) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("RELEASE_PUBLISH_ROOT_REQUIRED");
  const gid = readerGid(requestedGid);
  const safeRoot = await trustedRoot(root, gid);
  const validated = validateReleaseIdentity(identity);
  const target = path.join(safeRoot, RELEASE_IDENTITY_FILE);
  let existing = null;
  try {
    existing = await readTrustedReleaseIdentity({ root: safeRoot, readerGid: gid });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing && Date.parse(validated.generated_at) <= Date.parse(existing.generated_at)) reject("RELEASE_GENERATION_NOT_MONOTONIC");
  const temporary = path.join(safeRoot, `.${RELEASE_IDENTITY_FILE}.${process.pid}.${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(validated)}\n`;
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.chown(0, gid);
    await handle.chmod(FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(safeRoot);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return readTrustedReleaseIdentity({ root: safeRoot, readerGid: gid });
}

function cliOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(result, key)) reject("RELEASE_CLI_ARGUMENT_INVALID");
    result[key] = value;
  }
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "publish") reject("RELEASE_CLI_COMMAND_INVALID");
  const options = cliOptions(args);
  const expected = [
    "--root", "--reader-gid", "--deployment-class", "--deployment-id", "--application-version", "--git-commit",
    "--web-container-id", "--web-image-digest", "--worker-container-id", "--worker-image-digest", "--confirm",
  ];
  exactKeys(options, expected, "RELEASE_CLI_ARGUMENT_INVALID");
  if (options["--confirm"] !== "PUBLISH_RUNTIME_RELEASE_IDENTITY") reject("RELEASE_CLI_CONFIRMATION_INVALID");
  const identity = validateReleaseIdentity({
    schema_version: 1,
    contract: RELEASE_IDENTITY_CONTRACT,
    deployment_class: options["--deployment-class"],
    deployment_id: options["--deployment-id"],
    application_version: options["--application-version"],
    git_commit: options["--git-commit"],
    web_container_id: options["--web-container-id"],
    web_image_digest: options["--web-image-digest"],
    worker_container_id: options["--worker-container-id"],
    worker_image_digest: options["--worker-image-digest"],
    generated_at: new Date().toISOString(),
  });
  await publishReleaseIdentity({ root: options["--root"], readerGid: options["--reader-gid"], identity });
  process.stdout.write("runtime release identity published\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof ReleaseIdentityError ? error.code : "RELEASE_IDENTITY_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
