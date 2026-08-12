import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const compose = await readFile(new URL("../compose.yml", import.meta.url), "utf8");
const sourcePackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const runtimePackagePath = "/tmp/chenyida-runtime-package.json";
const nodeBase = "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
const runtimeBase = "cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed";
const runtimeNodePackage = "nodejs-22-minimal=22.23.2-r1";
const dockerfileFrontend = "docker.io/docker/dockerfile:1.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720";

function generatorScript() {
  const match = dockerfile.match(/^RUN node --input-type=module -e '([^']+)'$/m);
  assert.ok(match, "Dockerfile must contain one inline runtime-package generator");
  return match[1];
}

async function runGenerator(packageMetadata) {
  const directory = await mkdtemp(join(tmpdir(), "cyd-fix38-docker-contract-"));
  try {
    await rm(runtimePackagePath, { force: true });
    await writeFile(join(directory, "package.json"), JSON.stringify(packageMetadata));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", generatorScript()], {
      cwd: directory,
      encoding: "utf8",
    });
    const output = result.status === 0 ? JSON.parse(await readFile(runtimePackagePath, "utf8")) : null;
    return { result, output };
  } finally {
    await unlink(runtimePackagePath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rm(directory, { recursive: true, force: true });
  }
}

function releaseValidatorScripts() {
  const matches = [...dockerfile.matchAll(/^RUN node --input-type=module -e '([^']*invalid immutable release metadata[^']*)' "\$ERP_BUILD_VERSION" "\$ERP_BUILD_REVISION"$/gm)];
  assert.equal(matches.length, 1, "the shared dependencies stage must validate immutable release metadata exactly once");
  return matches.map((match) => match[1]);
}

function runReleaseValidator(script, version, revision) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script, version, revision], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

test("Dockerfile mechanically emits only validated runtime package fields from source package.json", async () => {
  const { result, output } = await runGenerator(sourcePackage);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(output), ["name", "version", "private", "type"]);
  assert.deepEqual(output, {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: sourcePackage.private,
    type: sourcePackage.type,
  });
  assert.equal(output.scripts, undefined);
  assert.equal(output.dependencies, undefined);
  assert.equal(output.devDependencies, undefined);
});

test("shared Dockerfile generator fails for invalid source metadata even when an ARG could repeat that version", async () => {
  for (const version of [undefined, "", "unknown", "latest", "development", "01.0.0", 42]) {
    const candidate = { ...sourcePackage, version };
    const { result, output } = await runGenerator(candidate);
    assert.notEqual(result.status, 0);
    assert.equal(output, null);
  }
});

test("final Web stage installs generated metadata without version substitutions or hardcoding", () => {
  const webStage = dockerfile.slice(dockerfile.indexOf(`FROM ${runtimeBase} AS web`), dockerfile.indexOf(`FROM ${runtimeBase} AS worker`));
  const standaloneCopy = webStage.indexOf("COPY --from=builder --chown=65532:65532 /app/dist/standalone ./");
  const metadataCopy = webStage.indexOf("COPY --from=dependencies --chown=65532:65532 /tmp/chenyida-runtime-package.json ./package.json");

  assert.ok(standaloneCopy >= 0);
  assert.ok(metadataCopy > standaloneCopy);
  assert.match(dockerfile, /readFileSync\("package\.json", "utf8"\)/);
  assert.match(dockerfile, /versionPattern\.test\(source\.version\)/);
  assert.doesNotMatch(dockerfile, /0\.1\.0-alpha\.42/);
  assert.doesNotMatch(dockerfile, /APP_VERSION|npm_package_version/);
  assert.doesNotMatch(webStage, /^COPY package\.json/m);
});

test("build args fail closed and become OCI plus baked runtime identity in both final images", () => {
  const revision = "b".repeat(40);
  for (const script of releaseValidatorScripts()) {
    assert.equal(runReleaseValidator(script, sourcePackage.version, revision).status, 0);
    for (const [version, commit] of [["", revision], ["0.1.0-alpha.999", revision], [sourcePackage.version, ""], [sourcePackage.version, "g".repeat(40)], [sourcePackage.version, "b".repeat(39)]]) {
      assert.notEqual(runReleaseValidator(script, version, commit).status, 0);
    }
  }
  assert.equal((dockerfile.match(/^ARG ERP_BUILD_VERSION$/gm) || []).length, 3);
  assert.equal((dockerfile.match(/^ARG ERP_BUILD_REVISION$/gm) || []).length, 3);
  assert.equal((dockerfile.match(/^LABEL org\.opencontainers\.image\.version=\$ERP_BUILD_VERSION org\.opencontainers\.image\.revision=\$ERP_BUILD_REVISION$/gm) || []).length, 2);
  assert.equal((dockerfile.match(/ERP_RUNTIME_BUILD_VERSION=\$ERP_BUILD_VERSION ERP_RUNTIME_GIT_COMMIT=\$ERP_BUILD_REVISION/g) || []).length, 2);
  assert.match(compose, /x-release-build-args: &release-build-args/);
  assert.equal((compose.match(/build: \{ context: \., target: (?:web|worker), args: \*release-build-args \}/g) || []).length, 4);
  assert.match(dockerfile, /FROM dependencies AS builder/);
  assert.match(dockerfile, /FROM dependencies AS worker-dependencies[\s\S]*npm prune --omit=dev --ignore-scripts --no-audit --no-fund/);
  assert.match(dockerfile, new RegExp(`FROM ${runtimeBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} AS worker[\\s\\S]*COPY --from=worker-dependencies --chown=65532:65532 \\/app\\/node_modules \\.\\/node_modules`));
  assert.equal((dockerfile.match(/COPY --from=dependencies --chown=65532:65532 \/tmp\/chenyida-runtime-package\.json \.\/package\.json/g) || []).length, 2);
  assert.match(compose, /ERP_RELEASE_EXPECTED_VERSION: \$\{ERP_RELEASE_EXPECTED_VERSION:-\}/);
  assert.match(compose, /ERP_RELEASE_IDENTITY_MAX_AGE_SECONDS: \$\{ERP_RELEASE_IDENTITY_MAX_AGE_SECONDS:-\}/);
  assert.match(compose, /\$\{ERP_RELEASE_IDENTITY_HOST_ROOT:-\/var\/lib\/chenyida-erp\/release-identity\}:\/run\/chenyida-erp-release:ro/);
  assert.doesNotMatch(compose, /ERP_BACKUP_EXPECTED_(?:WEB|WORKER)_IMAGE_DIGEST/);
});

test("pinned build and runtime bases keep migrations root-owned and final processes non-root", () => {
  assert.deepEqual(
    [...dockerfile.matchAll(/^FROM (.+)$/gm)].map((match) => match[1]),
    [
      `${nodeBase} AS dependencies`,
      "dependencies AS builder",
      "dependencies AS worker-dependencies",
      `${runtimeBase} AS web`,
      `${runtimeBase} AS worker`,
    ],
  );

  const webStage = dockerfile.slice(dockerfile.indexOf(`FROM ${runtimeBase} AS web`), dockerfile.indexOf(`FROM ${runtimeBase} AS worker`));
  assert.match(webStage, /^USER 65532:65532$/m);
  assert.match(webStage, /^EXPOSE 3000$/m);
  assert.match(webStage, /^CMD \["node", "server\.js"\]$/m);
  assert.match(webStage, /COPY --from=builder --chown=root:root \/app\/drizzle-postgres \.\/drizzle-postgres/);
  assert.match(webStage, /find \.\/drizzle-postgres -type d -exec chmod 0555/);
  assert.match(webStage, /find \.\/drizzle-postgres -type f -exec chmod 0444/);

  const workerStage = dockerfile.slice(dockerfile.indexOf(`FROM ${runtimeBase} AS worker`));
  assert.match(workerStage, /^RUN apk add --no-cache --repository=https:\/\/apk\.cgr\.dev\/chainguard nodejs-22-minimal=22\.23\.2-r1/m);
  assert.match(workerStage, /^COPY --from=worker-dependencies --chown=65532:65532 \/app\/node_modules \.\/node_modules$/m);
  assert.match(workerStage, /^COPY --from=dependencies --chown=65532:65532 \/tmp\/chenyida-runtime-package\.json \.\/package\.json$/m);
  assert.match(workerStage, /^USER 65532:65532$/m);
  assert.match(workerStage, /^CMD \["node", "--experimental-strip-types", "worker\/selfhost\.ts"\]$/m);
  assert.doesNotMatch(workerStage, /^COPY package(?:-lock)?\.json/m);
  assert.doesNotMatch(workerStage, /\bnpm\b/);
  assert.match(workerStage, /COPY --chown=root:root drizzle-postgres \.\/drizzle-postgres/);
  assert.match(workerStage, /find \.\/drizzle-postgres -type d -exec chmod 0555/);
  assert.match(workerStage, /find \.\/drizzle-postgres -type f -exec chmod 0444/);
  assert.doesNotMatch(dockerfile, /db:migrate|migrate-postgres|drizzle-kit/);
});

test("candidate build pins its frontend and base while isolating the application build", () => {
  assert.equal(dockerfile.split("\n", 1)[0], `# syntax=${dockerfileFrontend}`);
  assert.equal((dockerfile.match(new RegExp(`^FROM ${nodeBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} AS `, "gm")) || []).length, 1);
  assert.equal((dockerfile.match(new RegExp(`^FROM ${runtimeBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} AS `, "gm")) || []).length, 2);
  assert.equal((dockerfile.match(/npm ci .*--no-audit --no-fund/g) || []).length, 1);
  assert.match(dockerfile, /^RUN --network=none NODE_OPTIONS=--max-old-space-size=1024 npm run build$/m);
  assert.match(dockerfile, /^RUN --network=none NODE_OPTIONS=--max-old-space-size=1024 npm prune --omit=dev --ignore-scripts --no-audit --no-fund$/m);
  assert.equal((dockerfile.match(new RegExp(`apk add --no-cache --repository=https:\\/\\/apk\\.cgr\\.dev\\/chainguard ${runtimeNodePackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length, 2);
  assert.equal((dockerfile.match(/\[ "\$\(node --version\)" = "v22\.23\.2" \]/g) || []).length, 2);
  assert.doesNotMatch(dockerfile, /FROM node:22-bookworm-slim(?:\s|$)/);
});

test("Compose uses readiness for Web and the exact process lease check for Worker", () => {
  const web = compose.slice(compose.indexOf("  web:"), compose.indexOf("  worker:"));
  const worker = compose.slice(compose.indexOf("  worker:"), compose.indexOf("  admin:"));
  assert.match(web, /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health'\)/);
  assert.match(worker, /ERP_WORKER_INSTANCE_FILE: \/tmp\/chenyida-erp-worker-instance-id/);
  assert.match(worker, /test: \["CMD", "node", "--experimental-strip-types", "scripts\/worker-readiness-check\.ts"\]/);
  assert.match(worker, /interval: 10s[\s\S]*timeout: 5s[\s\S]*retries: 6/);
});
