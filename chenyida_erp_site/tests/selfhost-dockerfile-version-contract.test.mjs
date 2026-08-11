import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const compose = await readFile(new URL("../compose.yml", import.meta.url), "utf8");
const sourcePackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const runtimePackagePath = join(tmpdir(), "chenyida-runtime-package.json");

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
  const webStage = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS web"), dockerfile.indexOf("FROM node:22-bookworm-slim AS worker"));
  const standaloneCopy = webStage.indexOf("COPY --from=builder --chown=node:node /app/dist/standalone ./");
  const metadataCopy = webStage.indexOf("COPY --from=dependencies --chown=node:node /tmp/chenyida-runtime-package.json ./package.json");

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
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS worker[\s\S]*COPY --from=dependencies \/tmp\/chenyida-runtime-package\.json \/tmp\/chenyida-runtime-package\.json/);
  assert.match(dockerfile, /keys=\["name","version","private","type"\]/);
  assert.match(compose, /ERP_RELEASE_EXPECTED_VERSION: \$\{ERP_RELEASE_EXPECTED_VERSION:-\}/);
  assert.match(compose, /ERP_RELEASE_IDENTITY_MAX_AGE_SECONDS: \$\{ERP_RELEASE_IDENTITY_MAX_AGE_SECONDS:-\}/);
  assert.match(compose, /\$\{ERP_RELEASE_IDENTITY_HOST_ROOT:-\/var\/lib\/chenyida-erp\/release-identity\}:\/run\/chenyida-erp-release:ro/);
  assert.doesNotMatch(compose, /ERP_BACKUP_EXPECTED_(?:WEB|WORKER)_IMAGE_DIGEST/);
});

test("base images, Web runtime, Worker stage, and migration behavior remain unchanged", () => {
  assert.deepEqual(
    [...dockerfile.matchAll(/^FROM (.+)$/gm)].map((match) => match[1]),
    [
      "node:22-bookworm-slim AS dependencies",
      "dependencies AS builder",
      "node:22-bookworm-slim AS web",
      "node:22-bookworm-slim AS worker",
    ],
  );

  const webStage = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS web"), dockerfile.indexOf("FROM node:22-bookworm-slim AS worker"));
  assert.match(webStage, /^USER node$/m);
  assert.match(webStage, /^EXPOSE 3000$/m);
  assert.match(webStage, /^CMD \["node", "server\.js"\]$/m);

  const workerStage = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS worker"));
  assert.equal(workerStage, `FROM node:22-bookworm-slim AS worker
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
LABEL org.opencontainers.image.version=$ERP_BUILD_VERSION org.opencontainers.image.revision=$ERP_BUILD_REVISION
ENV NODE_ENV=production ERP_RUNTIME_BUILD_VERSION=$ERP_BUILD_VERSION ERP_RUNTIME_GIT_COMMIT=$ERP_BUILD_REVISION
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=dependencies /tmp/chenyida-runtime-package.json /tmp/chenyida-runtime-package.json
RUN node --input-type=module -e 'import { readFileSync, unlinkSync } from "node:fs"; const source=JSON.parse(readFileSync("package.json","utf8")); const validated=JSON.parse(readFileSync("/tmp/chenyida-runtime-package.json","utf8")); const keys=["name","version","private","type"]; if(Object.keys(validated).length!==keys.length||keys.some((key)=>source[key]!==validated[key])) throw new Error("source package metadata was not validated by the shared release stage"); unlinkSync("/tmp/chenyida-runtime-package.json");'
RUN NODE_OPTIONS=--max-old-space-size=1024 npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node app ./app
COPY --chown=node:node db ./db
COPY --chown=node:node drizzle-postgres ./drizzle-postgres
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node seeds ./seeds
COPY --chown=node:node tests ./tests
COPY --chown=node:node worker ./worker
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R node:node /data/chenyida-erp
USER node
CMD ["node", "--experimental-strip-types", "worker/selfhost.ts"]
`);
  assert.doesNotMatch(dockerfile, /db:migrate|migrate-postgres|drizzle-kit/);
});
