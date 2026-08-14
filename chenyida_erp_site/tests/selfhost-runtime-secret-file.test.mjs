import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { browserSetupAllowed, runtimeConfig } from "../app/lib/infrastructure/config.ts";
import {
  assertControlledSecretsAbsent,
  assertControlledRuntimeServiceKind,
  readSecureSingleValueFile,
  RuntimeSecretError,
  runtimeServiceKind,
  validateControlledRuntimeSecretValue,
} from "../app/lib/infrastructure/runtime-secret.ts";

const roots = [];
test.after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function fixture(value = "synthetic-runtime-secret-value-0001\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-runtime-secret-test-"));
  roots.push(root);
  const file = path.join(root, "secret");
  await writeFile(file, value, { encoding: "utf8", mode: 0o600 });
  await chmod(file, 0o440);
  return { root, file };
}

function policy(input) {
  return {
    path: input.file,
    expectedParent: input.root,
    trustedAncestor: os.tmpdir(),
    expectedParentUid: process.getuid(),
    expectedParentGid: process.getgid(),
    expectedParentMode: 0o700,
    expectedUid: process.getuid(),
    expectedGid: process.getgid(),
    expectedMode: 0o440,
    minimumBytes: 24,
    maximumBytes: 256,
  };
}

function secretError(code) {
  return (error) => error instanceof RuntimeSecretError && error.code === code && error.message === code;
}

test("secure secret reader accepts one stable root-owned-style single value", async () => {
  const input = await fixture();
  assert.equal(readSecureSingleValueFile(policy(input)), "synthetic-runtime-secret-value-0001");
});

test("secure secret reader rejects symlinks, hardlinks, directories and weak modes without leaking paths", async () => {
  const symlinkInput = await fixture();
  const symlinkPath = path.join(symlinkInput.root, "alias");
  await symlink(symlinkInput.file, symlinkPath);
  assert.throws(() => readSecureSingleValueFile({ ...policy(symlinkInput), path: symlinkPath }), (error) => {
    assert.ok(secretError("RUNTIME_SECRET_FILE_METADATA_INVALID")(error));
    assert.equal(error.message.includes(symlinkPath), false);
    return true;
  });

  const hardlinkInput = await fixture();
  await link(hardlinkInput.file, path.join(hardlinkInput.root, "second-link"));
  assert.throws(() => readSecureSingleValueFile(policy(hardlinkInput)), secretError("RUNTIME_SECRET_FILE_METADATA_INVALID"));

  const directoryInput = await fixture();
  const directory = path.join(directoryInput.root, "directory");
  await mkdir(directory, { mode: 0o440 });
  assert.throws(() => readSecureSingleValueFile({ ...policy(directoryInput), path: directory }), secretError("RUNTIME_SECRET_FILE_METADATA_INVALID"));

  const modeInput = await fixture();
  await chmod(modeInput.file, 0o640);
  assert.throws(() => readSecureSingleValueFile(policy(modeInput)), secretError("RUNTIME_SECRET_FILE_METADATA_INVALID"));
});

test("secure secret reader anchors every parent component and rejects writable or symlinked secret directories", async () => {
  const writableInput = await fixture();
  await chmod(writableInput.root, 0o770);
  assert.throws(() => readSecureSingleValueFile(policy(writableInput)), secretError("RUNTIME_SECRET_DIRECTORY_INVALID"));

  const outer = await mkdtemp(path.join(os.tmpdir(), "cyd-runtime-secret-parent-test-"));
  roots.push(outer);
  const realParent = path.join(outer, "real");
  const aliasParent = path.join(outer, "alias");
  await mkdir(realParent, { mode: 0o700 });
  const secret = path.join(realParent, "secret");
  await writeFile(secret, "synthetic-runtime-secret-value-0001\n", { encoding: "utf8", mode: 0o440 });
  await symlink(realParent, aliasParent);
  assert.throws(() => readSecureSingleValueFile({
    ...policy({ root: aliasParent, file: path.join(aliasParent, "secret") }),
  }), (error) => {
    assert.ok(secretError("RUNTIME_SECRET_DIRECTORY_INVALID")(error));
    assert.equal(error.message.includes(aliasParent), false);
    return true;
  });
});

test("secure secret reader rejects malformed content", async () => {
  for (const value of [
    "short\n",
    "synthetic-runtime-secret-value-0001\nsecond-line\n",
    " synthetic-runtime-secret-value-0001\n",
    "synthetic-runtime-secret-value-0001 \n",
    "synthetic-runtime-secret\u0000-value-0001\n",
  ]) {
    const input = await fixture(value);
    assert.throws(() => readSecureSingleValueFile(policy(input)), secretError("RUNTIME_SECRET_CONTENT_INVALID"));
  }
});

test("controlled runtime values require canonical 32-byte base64url with nontrivial diversity", () => {
  const valid=Buffer.from(Array.from({length:32},(_,index)=>index)).toString("base64url");
  assert.equal(valid.length,43);
  assert.equal(validateControlledRuntimeSecretValue(valid),valid);
  for(const value of ["a".repeat(43),`${valid.slice(0,-1)}B`,`${valid.slice(0,-1)}+`,valid.slice(0,-1)]) {
    assert.throws(()=>validateControlledRuntimeSecretValue(value),secretError("RUNTIME_SECRET_CONTENT_INVALID"));
  }
});

test("controlled deployments reject secret environment keys even when empty", () => {
  for (const name of ["DATABASE_URL", "ERP_MIGRATION_DATABASE_URL", "POSTGRES_PASSWORD", "ERP_ADMIN_PASSWORD", "ERP_SETUP_TOKEN"]) {
    assert.throws(
      () => assertControlledSecretsAbsent("production", { [name]: "" }),
      secretError("CONTROLLED_SECRET_ENVIRONMENT_FORBIDDEN"),
    );
  }
  assert.doesNotThrow(() => assertControlledSecretsAbsent("test", { DATABASE_URL: "synthetic" }));
});

test("controlled service kind is explicit and browser setup is disabled", () => {
  assert.equal(runtimeServiceKind("production", "web"), "WEB");
  assert.throws(() => runtimeServiceKind("uat", ""), secretError("CONTROLLED_SERVICE_KIND_INVALID"));
  assert.doesNotThrow(() => assertControlledRuntimeServiceKind("production", "WORKER", "worker"));
  assert.throws(
    () => assertControlledRuntimeServiceKind("production", "WORKER", "web"),
    secretError("CONTROLLED_SERVICE_KIND_MISMATCH"),
  );
  assert.equal(browserSetupAllowed({ deploymentClass: "production" }), false);
  assert.equal(browserSetupAllowed({ deploymentClass: "uat" }), false);
  assert.equal(browserSetupAllowed({ deploymentClass: "test" }), true);
});

test("runtime config rejects controlled environment secrets before consumers can use them", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      ERP_ENV: "production",
      ERP_DEPLOYMENT_CLASS: "production",
      ERP_PUBLIC_ORIGIN: "https://erp.example.invalid",
      DATABASE_URL: "postgresql://forbidden.invalid/secret",
    });
    assert.throws(() => runtimeConfig(), secretError("CONTROLLED_SECRET_ENVIRONMENT_FORBIDDEN"));
  } finally {
    process.env = saved;
  }
});

test("runtime config rejects environment and deployment-class downgrade combinations", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      ERP_ENV: "production",
      ERP_DEPLOYMENT_CLASS: "development",
      ERP_PUBLIC_ORIGIN: "https://erp.example.invalid",
    });
    delete process.env.DATABASE_URL;
    delete process.env.ERP_MIGRATION_DATABASE_URL;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.ERP_ADMIN_PASSWORD;
    delete process.env.ERP_SETUP_TOKEN;
    assert.throws(() => runtimeConfig(), secretError("CONTROLLED_DEPLOYMENT_CLASS_REQUIRED"));
    process.env.ERP_ENV = "test";
    process.env.ERP_DEPLOYMENT_CLASS = "uat";
    assert.throws(() => runtimeConfig(), secretError("CONTROLLED_ENVIRONMENT_REQUIRED"));
  } finally {
    process.env = saved;
  }
});
