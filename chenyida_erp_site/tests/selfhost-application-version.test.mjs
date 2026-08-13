import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ApplicationVersionMetadataError,
  createApplicationVersionReader,
  readApplicationVersion,
} from "../app/lib/application-version.ts";

const projectPackagePath = fileURLToPath(new URL("../package.json", import.meta.url));

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "cyd-fix38-version-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the current project package exposes the alpha.47 source version", () => {
  assert.equal(readApplicationVersion(projectPackagePath), "0.1.0-alpha.47");
});

test("runtime version is cached after validation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const packagePath = join(directory, "package.json");
    await writeFile(packagePath, JSON.stringify({ version: "0.1.0-alpha.42" }));
    const readVersion = createApplicationVersionReader(packagePath);

    assert.equal(readVersion(), "0.1.0-alpha.42");
    await writeFile(packagePath, JSON.stringify({ version: "0.1.0-alpha.43" }));
    assert.equal(readVersion(), "0.1.0-alpha.42");
  });
});

test("missing runtime package metadata fails closed without exposing its path", () => {
  const packagePath = join(tmpdir(), "cyd-fix38-missing", "package.json");
  assert.throws(
    () => readApplicationVersion(packagePath),
    (error) => error instanceof ApplicationVersionMetadataError
      && error.code === "APPLICATION_VERSION_METADATA_INVALID"
      && !error.message.includes(packagePath),
  );
});

test("invalid JSON, missing versions, fallback labels, and invalid project versions are rejected", async () => {
  await withTemporaryDirectory(async (directory) => {
    const packagePath = join(directory, "package.json");
    const invalidMetadata = [
      "{",
      JSON.stringify({}),
      JSON.stringify({ version: "" }),
      JSON.stringify({ version: 42 }),
      JSON.stringify({ version: "unknown" }),
      JSON.stringify({ version: "latest" }),
      JSON.stringify({ version: "development" }),
      JSON.stringify({ version: "01.0.0" }),
      JSON.stringify({ version: "0.1" }),
    ];

    for (const contents of invalidMetadata) {
      await writeFile(packagePath, contents);
      assert.throws(() => readApplicationVersion(packagePath), ApplicationVersionMetadataError);
    }
  });
});
