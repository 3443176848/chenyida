import path from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_IDENTITY_CONTRACT, abortPreparedReleaseIdentity, commitPreparedReleaseIdentity, prepareReleaseIdentity, validateReleaseIdentity } from "./release-identity-contract.mjs";
import { ReleaseManifestError, loadReleaseManifest } from "./release-manifest-contract.mjs";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function reject(code) {
  throw new ReleaseManifestError(code);
}

function cliOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(result, key)) reject("RUNTIME_IDENTITY_CLI_ARGUMENT_INVALID");
    result[key] = value;
  }
  return result;
}

export async function buildReleaseIdentityFromManifest({ manifestFile, manifestSha256, deploymentClass, deploymentId, supervisorBundleSha256, authorizationSha256, web, worker, now = new Date() }) {
  if (!IDENTIFIER.test(deploymentId || "") || !["UAT", "PRODUCTION"].includes(deploymentClass)) reject("RUNTIME_IDENTITY_DEPLOYMENT_INVALID");
  if (!SHA256.test(supervisorBundleSha256 || "") || !SHA256.test(authorizationSha256 || "")) reject("RUNTIME_IDENTITY_CONTROL_INVALID");
  for (const runtime of [web, worker]) {
    if (!runtime || !CONTAINER_ID.test(runtime.containerId || "") || !IMAGE_DIGEST.test(runtime.imageDigest || "") || !IMAGE_REFERENCE.test(runtime.imageReference || "")) reject("RUNTIME_IDENTITY_CONTAINER_INVALID");
  }
  if (web.containerId === worker.containerId || web.imageDigest === worker.imageDigest) reject("RUNTIME_IDENTITY_COLLISION");
  const manifest = await loadReleaseManifest({ file: manifestFile, expectedSha256: manifestSha256, now, requireEligible: true, trusted: true });
  if (manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== deploymentClass) reject("RUNTIME_IDENTITY_DEPLOYMENT_CLASS_MISMATCH");
  if (manifest.control.supervisor_bundle_sha256 !== supervisorBundleSha256) reject("RUNTIME_IDENTITY_SUPERVISOR_MISMATCH");
  const expected = { version: manifest.source.package_version, revision: manifest.source.git_commit };
  for (const [service, runtime] of [["web", web], ["worker", worker]]) {
    const image = manifest.images[service];
    if (runtime.imageDigest !== image.image_digest || runtime.imageReference !== image.image_reference || runtime.ociVersion !== expected.version || runtime.ociRevision !== expected.revision || runtime.bakedVersion !== expected.version || runtime.bakedRevision !== expected.revision || runtime.deploymentClass !== deploymentClass) reject("RUNTIME_IDENTITY_MANIFEST_MISMATCH");
  }
  return validateReleaseIdentity({
    schema_version: 2, contract: RELEASE_IDENTITY_CONTRACT, deployment_class: deploymentClass, deployment_id: deploymentId,
    release_id: manifest.release_id, release_manifest_sha256: manifestSha256, supervisor_bundle_sha256: supervisorBundleSha256, authorization_sha256: authorizationSha256,
    application_version: expected.version, git_commit: expected.revision,
    web_container_id: web.containerId, web_image_digest: web.imageDigest,
    worker_container_id: worker.containerId, worker_image_digest: worker.imageDigest,
    generated_at: now.toISOString(),
  });
}

export async function prepareReleaseIdentityFromManifest(options) {
  const identity = await buildReleaseIdentityFromManifest(options);
  return prepareReleaseIdentity({ root: options.identityRoot, readerGid: options.readerGid, identity, transactionId: options.transactionId, authorizationSha256: options.authorizationSha256 });
}

export async function publishReleaseIdentityFromManifest(options) {
  const prepared = await prepareReleaseIdentityFromManifest({ ...options, transactionId: options.transactionId || options.authorizationSha256 });
  if (prepared.already_published) return prepared.identity;
  return commitPreparedReleaseIdentity({ root: options.identityRoot, readerGid: options.readerGid, transactionId: prepared.transaction_id, authorizationSha256: options.authorizationSha256 });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES") reject("RUNTIME_IDENTITY_GLOBAL_LOCK_REQUIRED");
  if (command === "commit" || command === "abort") {
    const expected = ["--identity-root", "--reader-gid", "--transaction-id", "--authorization-sha256", "--confirm"];
    const confirmation = command === "commit" ? "COMMIT_EXACT_PREPARED_RELEASE_IDENTITY" : "ABORT_EXACT_PREPARED_RELEASE_IDENTITY";
    if (Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key)) || options["--confirm"] !== confirmation) reject("RUNTIME_IDENTITY_CLI_ARGUMENT_INVALID");
    const action = command === "commit" ? commitPreparedReleaseIdentity : abortPreparedReleaseIdentity;
    const result = await action({ root: options["--identity-root"], readerGid: options["--reader-gid"], transactionId: options["--transaction-id"], authorizationSha256: options["--authorization-sha256"] });
    process.stdout.write(`${JSON.stringify({ result: command === "commit" ? "COMMITTED" : "ABORTED", identity: result || null })}\n`);
    return;
  }
  if (command !== "prepare") reject("RUNTIME_IDENTITY_CLI_COMMAND_INVALID");
  const expected = ["--manifest", "--manifest-sha256", "--identity-root", "--reader-gid", "--deployment-class", "--deployment-id", "--supervisor-bundle-sha256", "--authorization-sha256", "--transaction-id", "--web-container-id", "--web-image-reference", "--web-image-digest", "--web-oci-version", "--web-oci-revision", "--web-baked-version", "--web-baked-revision", "--web-deployment-class", "--worker-container-id", "--worker-image-reference", "--worker-image-digest", "--worker-oci-version", "--worker-oci-revision", "--worker-baked-version", "--worker-baked-revision", "--worker-deployment-class", "--confirm"];
  if (Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key)) || options["--confirm"] !== "PREPARE_EXACT_RELEASE_MANIFEST_IDENTITY") reject("RUNTIME_IDENTITY_CLI_ARGUMENT_INVALID");
  const runtime = (service) => ({ containerId: options[`--${service}-container-id`], imageReference: options[`--${service}-image-reference`], imageDigest: options[`--${service}-image-digest`], ociVersion: options[`--${service}-oci-version`], ociRevision: options[`--${service}-oci-revision`], bakedVersion: options[`--${service}-baked-version`], bakedRevision: options[`--${service}-baked-revision`], deploymentClass: options[`--${service}-deployment-class`] });
  const prepared = await prepareReleaseIdentityFromManifest({ manifestFile: options["--manifest"], manifestSha256: options["--manifest-sha256"], identityRoot: options["--identity-root"], readerGid: options["--reader-gid"], deploymentClass: options["--deployment-class"], deploymentId: options["--deployment-id"], supervisorBundleSha256: options["--supervisor-bundle-sha256"], authorizationSha256: options["--authorization-sha256"], transactionId: options["--transaction-id"], web: runtime("web"), worker: runtime("worker") });
  process.stdout.write(`${JSON.stringify({ result: prepared.already_published ? "ALREADY_PUBLISHED" : "PREPARED", transaction_id: prepared.transaction_id, candidate_sha256: prepared.candidate_sha256 })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof ReleaseManifestError || typeof error?.code === "string" ? error.code : "RUNTIME_IDENTITY_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
