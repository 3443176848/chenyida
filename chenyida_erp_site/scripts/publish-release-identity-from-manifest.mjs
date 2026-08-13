import path from "node:path";
import { fileURLToPath } from "node:url";

import { ReleaseManifestError } from "./release-manifest-contract.mjs";

const DISABLED_CODE = "RUNTIME_IDENTITY_POSTDEPLOY_RECEIPT_REQUIRED";

function rejectLegacyPublisher() {
  throw new ReleaseManifestError(DISABLED_CODE);
}

// Retain these exports only so stale callers fail with a stable migration error.
// Runtime identity v3 is exclusively derived from an independently verified
// POST_DEPLOY_CURRENT_RUNTIME_STRICT receipt.
export async function buildReleaseIdentityFromManifest() {
  rejectLegacyPublisher();
}

export async function prepareReleaseIdentityFromManifest() {
  rejectLegacyPublisher();
}

export async function publishReleaseIdentityFromManifest() {
  rejectLegacyPublisher();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stderr.write(`${DISABLED_CODE}\n`);
  process.exitCode = 1;
}
