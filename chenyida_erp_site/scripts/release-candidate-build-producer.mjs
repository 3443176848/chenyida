import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./release-identity-contract.mjs";
import {
  RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT,
  RELEASE_DOCKERFILE_FRONTEND_REFERENCE,
  RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE,
  RELEASE_NODE_BASE_IMAGE_REFERENCE,
  validateCandidateBuildProvenance,
} from "./release-image-evidence-contract.mjs";
import {
  buildMigrationAllowlist,
  canonicalJson,
  migrationAllowlistDigest,
  sha256,
  writeImmutableJsonArtifact,
} from "./release-manifest-contract.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const MAX_INSPECT_BYTES = 16 * 1024 * 1024;

class CandidateBuildError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) {
  throw new CandidateBuildError(code);
}

function cliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(options, key)) reject("CANDIDATE_BUILD_CLI_ARGUMENT_INVALID");
    options[key] = value;
  }
  return options;
}

function exactOptions(options, expected) {
  const actual = Object.keys(options).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject("CANDIDATE_BUILD_CLI_ARGUMENT_INVALID");
}

function required(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function positiveInteger(value, code) {
  if (!/^[1-9][0-9]*$/.test(value || "")) reject(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) reject(code);
  return parsed;
}

async function trustedJson(file, code) {
  if (typeof file !== "string" || file !== path.resolve(file) || file === "/") reject(code);
  const resolved = await realpath(file).catch(() => null);
  const stat = await lstat(file).catch(() => null);
  if (resolved !== file || !stat?.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o022) !== 0 || stat.size < 2 || stat.size > MAX_INSPECT_BYTES) reject(code);
  return parseStrictJson(await readFile(file, "utf8"), MAX_INSPECT_BYTES);
}

function imageInspect(value, reference, code) {
  if (!Array.isArray(value) || value.length !== 1) reject(code);
  const row = value[0];
  const manifestDigest = reference.slice(reference.lastIndexOf("@") + 1);
  if (!row || typeof row !== "object" || Array.isArray(row) || !/^sha256:[0-9a-f]{64}$/.test(manifestDigest) || row.Id !== manifestDigest || row.Descriptor?.digest !== manifestDigest || row.Os !== "linux" || row.Architecture !== "amd64" || !Array.isArray(row.RepoDigests) || !row.RepoDigests.includes(reference)) reject(code);
  return row;
}

function imageConfigDigest(row, code) {
  const digest = row.Descriptor?.annotations?.["config.digest"];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest || "")) reject(code);
  return digest;
}

function targetIdentity(row, service, reference, version, commit) {
  const labels = row.Config?.Labels;
  const environment = new Map();
  if (!labels || typeof labels !== "object" || Array.isArray(labels) || !Array.isArray(row.Config?.Env)) reject("CANDIDATE_BUILD_TARGET_INSPECT_INVALID");
  for (const item of row.Config.Env) {
    if (typeof item !== "string") reject("CANDIDATE_BUILD_TARGET_INSPECT_INVALID");
    const separator = item.indexOf("=");
    if (separator < 1 || environment.has(item.slice(0, separator))) reject("CANDIDATE_BUILD_TARGET_INSPECT_INVALID");
    environment.set(item.slice(0, separator), item.slice(separator + 1));
  }
  const command = service === "web" ? ["node", "server.js"] : ["node", "--experimental-strip-types", "worker/selfhost.ts"];
  if (labels["org.opencontainers.image.version"] !== version || labels["org.opencontainers.image.revision"] !== commit || environment.get("ERP_RUNTIME_BUILD_VERSION") !== version || environment.get("ERP_RUNTIME_GIT_COMMIT") !== commit || row.Config.User !== "node" || canonicalJson(row.Config.Cmd) !== canonicalJson(command)) reject("CANDIDATE_BUILD_TARGET_IDENTITY_INVALID");
  return {
    service,
    docker_target: service,
    image_reference: reference,
    registry_manifest_digest: reference.slice(reference.lastIndexOf("@") + 1),
    image_config_digest: imageConfigDigest(row, "CANDIDATE_BUILD_TARGET_CONFIG_INVALID"),
    oci_version: version,
    oci_revision: commit,
    baked_version: version,
    baked_revision: commit,
    user: row.Config.User,
    cmd: row.Config.Cmd,
  };
}

async function stableSha256(file, code) {
  const stat = await lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024 * 1024) reject(code);
  return sha256(await readFile(file));
}

async function create(options) {
  const siteRoot = path.resolve(options["--site-root"]);
  if (siteRoot === "/" || await realpath(siteRoot).catch(() => null) !== siteRoot) reject("CANDIDATE_BUILD_SITE_ROOT_INVALID");
  if (fileURLToPath(import.meta.url) !== path.join(siteRoot, "scripts", "release-candidate-build-producer.mjs")) reject("CANDIDATE_BUILD_PRODUCER_PATH_INVALID");
  const commit = required(options["--git-commit"], COMMIT, "CANDIDATE_BUILD_GIT_INVALID");
  const tree = required(options["--git-tree"], COMMIT, "CANDIDATE_BUILD_GIT_INVALID");
  const runId = required(options["--run-id"], IDENTIFIER, "CANDIDATE_BUILD_RUN_ID_INVALID");
  const archiveSha256 = required(options["--archive-sha256"], SHA256, "CANDIDATE_BUILD_ARCHIVE_INVALID");
  const archiveBytes = positiveInteger(options["--archive-bytes"], "CANDIDATE_BUILD_ARCHIVE_INVALID");
  const packageValue = parseStrictJson(await readFile(path.join(siteRoot, "package.json"), "utf8"));
  const packageVersion = required(packageValue?.version, VERSION, "CANDIDATE_BUILD_PACKAGE_INVALID");
  const dockerfile = await readFile(path.join(siteRoot, "Dockerfile"), "utf8");
  if (dockerfile.split("\n", 1)[0] !== `# syntax=${RELEASE_DOCKERFILE_FRONTEND_REFERENCE}`) reject("CANDIDATE_BUILD_FRONTEND_INVALID");
  const migrations = await buildMigrationAllowlist(path.join(siteRoot, "drizzle-postgres"));
  const migrationDigest = migrationAllowlistDigest(migrations);
  if (migrationDigest !== required(options["--migration-allowlist-sha256"], SHA256, "CANDIDATE_BUILD_MIGRATION_INVALID")) reject("CANDIDATE_BUILD_MIGRATION_INVALID");

  const base = imageInspect(await trustedJson(options["--base-inspect"], "CANDIDATE_BUILD_BASE_INSPECT_INVALID"), RELEASE_NODE_BASE_IMAGE_REFERENCE, "CANDIDATE_BUILD_BASE_INSPECT_INVALID");
  const registry = imageInspect(await trustedJson(options["--registry-inspect"], "CANDIDATE_BUILD_REGISTRY_INSPECT_INVALID"), RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE, "CANDIDATE_BUILD_REGISTRY_INSPECT_INVALID");
  const webReference = options["--web-image-reference"];
  const workerReference = options["--worker-image-reference"];
  const web = imageInspect(await trustedJson(options["--web-inspect"], "CANDIDATE_BUILD_WEB_INSPECT_INVALID"), webReference, "CANDIDATE_BUILD_WEB_INSPECT_INVALID");
  const worker = imageInspect(await trustedJson(options["--worker-inspect"], "CANDIDATE_BUILD_WORKER_INSPECT_INVALID"), workerReference, "CANDIDATE_BUILD_WORKER_INSPECT_INVALID");
  const webManifestDigest = webReference.slice(webReference.lastIndexOf("@") + 1);
  const workerManifestDigest = workerReference.slice(workerReference.lastIndexOf("@") + 1);
  if (webManifestDigest === workerManifestDigest) reject("CANDIDATE_BUILD_TARGET_COLLISION");
  const candidate = { git_commit: commit, git_tree: tree, package_version: packageVersion, web_image_digest: webManifestDigest, worker_image_digest: workerManifestDigest, migration_allowlist_sha256: migrationDigest };
  const value = validateCandidateBuildProvenance({
    schema_version: 2,
    contract: RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT,
    generated_at: new Date().toISOString(),
    run_id: runId,
    scope: "LOCAL_ISOLATED_CANDIDATE",
    candidate,
    source: {
      archive_sha256: archiveSha256,
      archive_bytes: archiveBytes,
      dockerfile_sha256: sha256(dockerfile),
      dockerignore_sha256: await stableSha256(path.join(siteRoot, ".dockerignore"), "CANDIDATE_BUILD_SOURCE_INVALID"),
      package_lock_sha256: await stableSha256(path.join(siteRoot, "package-lock.json"), "CANDIDATE_BUILD_SOURCE_INVALID"),
      orchestrator_sha256: await stableSha256(path.join(siteRoot, "scripts/build-release-candidate-images.sh"), "CANDIDATE_BUILD_SOURCE_INVALID"),
      producer_sha256: await stableSha256(fileURLToPath(import.meta.url), "CANDIDATE_BUILD_SOURCE_INVALID"),
    },
    builder: {
      docker_server_version: options["--docker-server-version"],
      buildx_version: options["--buildx-version"],
      builder_name: "default",
      builder_driver: options["--builder-driver"],
      buildkit_version: options["--buildkit-version"],
      platform: "linux/amd64",
      context: "GIT_ARCHIVE",
      base_pull_policy: "LOCAL_REQUIRED_PULL_FALSE",
      dependency_network: "PUBLIC_NPM_LOCKFILE_INTEGRITY",
      application_build_network: "NONE",
      frontend_reference: RELEASE_DOCKERFILE_FRONTEND_REFERENCE,
      frontend_manifest_digest: RELEASE_DOCKERFILE_FRONTEND_REFERENCE.slice(RELEASE_DOCKERFILE_FRONTEND_REFERENCE.indexOf("@") + 1),
      base_image_reference: RELEASE_NODE_BASE_IMAGE_REFERENCE,
      base_registry_manifest_digest: RELEASE_NODE_BASE_IMAGE_REFERENCE.slice(RELEASE_NODE_BASE_IMAGE_REFERENCE.indexOf("@") + 1),
      base_local_identity_digest: base.Id,
      registry_image_reference: RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE,
      registry_manifest_digest: RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.slice(RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.indexOf("@") + 1),
      registry_local_identity_digest: registry.Id,
      registry_state: "EPHEMERAL_LOOPBACK_REMOVED",
    },
    targets: [targetIdentity(web, "web", webReference, packageVersion, commit), targetIdentity(worker, "worker", workerReference, packageVersion, commit)],
    limitations: ["NO_EXTERNAL_REGISTRY_ANCHOR", "NO_REPRODUCIBLE_BUILD_ATTESTATION", "LOCAL_ENGINE_ONLY", "PUBLIC_NPM_FETCH_WITH_LOCKFILE_INTEGRITY"],
    result: "LOCAL_LOOPBACK_DIGEST_VERIFIED",
  });
  const filename = `${runId}.build-provenance.json`;
  await writeImmutableJsonArtifact({ root: options["--artifact-root"], filename, value });
  process.stdout.write(`${JSON.stringify({ result: value.result, file: filename, sha256: sha256(canonicalJson(value)), web_image_reference: webReference, worker_image_reference: workerReference })}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (command !== "create") reject("CANDIDATE_BUILD_CLI_COMMAND_INVALID");
  exactOptions(options, ["--site-root", "--artifact-root", "--run-id", "--git-commit", "--git-tree", "--archive-sha256", "--archive-bytes", "--migration-allowlist-sha256", "--base-inspect", "--registry-inspect", "--web-inspect", "--worker-inspect", "--web-image-reference", "--worker-image-reference", "--docker-server-version", "--buildx-version", "--builder-driver", "--buildkit-version", "--confirm"]);
  if (options["--confirm"] !== "CREATE_LOCAL_CANDIDATE_BUILD_PROVENANCE") reject("CANDIDATE_BUILD_CLI_CONFIRMATION_INVALID");
  await create(options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof CandidateBuildError ? error.code : error?.code || "CANDIDATE_BUILD_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
