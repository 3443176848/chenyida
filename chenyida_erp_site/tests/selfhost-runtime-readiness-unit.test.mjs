import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRuntimeIdentity, RuntimeReadinessError } from "../app/lib/runtime-readiness/identity.ts";
import {
  assertDatabaseMigrationRows,
  loadRuntimeMigrationManifest,
  migrationAllowlistSha256,
  verifyDatabaseMigrationManifest,
} from "../app/lib/runtime-readiness/migration.ts";
import { RuntimeReadinessService, WorkerRuntimeLeaseSupervisor } from "../app/lib/runtime-readiness/service.ts";
import { probeStorageRoot } from "../app/lib/runtime-readiness/storage.ts";
import {
  readWorkerInstanceFile,
  removeWorkerInstanceFile,
  writeWorkerInstanceFile,
} from "../app/lib/runtime-readiness/worker-lease.ts";
import { buildMigrationAllowlist, migrationAllowlistDigest } from "../scripts/release-manifest-contract.mjs";

const applicationVersion = "0.1.0-alpha.46";
const gitCommit = "a".repeat(40);
const requestIdentity = Object.freeze({
  deploymentClass: "test",
  deploymentId: "runtime-unit",
  applicationVersion,
  gitCommit,
  migrationHead: "0001_runtime.sql",
  migrationManifestSha256: "b".repeat(64),
});

test("runtime identity requires package, baked, expected and deployment facts to agree", () => {
  const config = { environment: "production", deploymentClass: "uat" };
  const environment = {
    ERP_RUNTIME_BUILD_VERSION: applicationVersion,
    ERP_RELEASE_EXPECTED_VERSION: applicationVersion,
    ERP_RUNTIME_GIT_COMMIT: gitCommit,
    ERP_RELEASE_EXPECTED_GIT_COMMIT: gitCommit,
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID: "erp-uat",
  };
  assert.deepEqual(resolveRuntimeIdentity({ config, environment, applicationVersion: () => applicationVersion }), {
    deploymentClass: "uat", deploymentId: "erp-uat", applicationVersion, gitCommit,
  });
  for (const key of Object.keys(environment)) {
    const drifted = { ...environment, [key]: key.includes("VERSION") ? "0.1.0-alpha.999" : "invalid value" };
    assert.throws(
      () => resolveRuntimeIdentity({ config, environment: drifted, applicationVersion: () => applicationVersion }),
      (error) => error.code === "RUNTIME_IDENTITY_INVALID",
      key,
    );
  }
  assert.deepEqual(resolveRuntimeIdentity({
    config: { environment: "test", deploymentClass: "test" },
    environment: {},
    applicationVersion: () => applicationVersion,
  }), {
    deploymentClass: "test", deploymentId: "test-local", applicationVersion, gitCommit: "0".repeat(40),
  });
});

test("runtime Migration digest stays byte-for-byte compatible with the release allowlist", async () => {
  const directory = path.resolve(new URL("../drizzle-postgres/", import.meta.url).pathname);
  const runtime = await loadRuntimeMigrationManifest({ directory, requireImmutable: false });
  const release = await buildMigrationAllowlist(directory);
  assert.deepEqual(runtime.entries, release);
  assert.equal(runtime.allowlistSha256, migrationAllowlistDigest(release));
  assert.equal(runtime.allowlistSha256, migrationAllowlistSha256(runtime.entries));
  assert.equal(runtime.head, "0045_runtime_worker_readiness.sql");
});

test("database Migration rows must exactly match count, order, filename and checksum", () => {
  const entries = [
    { ordinal: 1, filename: "0001_runtime.sql", sha256: "1".repeat(64) },
    { ordinal: 2, filename: "0002_runtime.sql", sha256: "2".repeat(64) },
  ];
  const manifest = { entries, head: entries.at(-1).filename, allowlistSha256: migrationAllowlistSha256(entries) };
  const exact = entries.map((entry) => ({ version: entry.filename, checksum: entry.sha256 }));
  assert.doesNotThrow(() => assertDatabaseMigrationRows(exact, manifest));
  for (const rows of [
    exact.slice(0, 1),
    [...exact, exact[1]],
    [exact[1], exact[0]],
    [{ ...exact[0], checksum: "0".repeat(64) }, exact[1]],
    [{ ...exact[0], version: "0001_other.sql" }, exact[1]],
    [{ ...exact[0], extra: true }, exact[1]],
  ]) assert.throws(() => assertDatabaseMigrationRows(rows, manifest), (error) => error.code === "RUNTIME_MIGRATION_MISMATCH");
});

test("database reachability and Migration ledger failures remain distinguishable", async () => {
  const entries = [{ ordinal: 1, filename: "0001_runtime.sql", sha256: "1".repeat(64) }];
  const manifest = { entries, head: entries[0].filename, allowlistSha256: migrationAllowlistSha256(entries) };
  await assert.rejects(verifyDatabaseMigrationManifest({
    async query() { throw new Error("connection details must stay private"); },
  }, manifest), (error) => error.code === "RUNTIME_DATABASE_UNAVAILABLE" && !/connection details/i.test(error.message));
  await assert.rejects(verifyDatabaseMigrationManifest({
    async query(sql) {
      if (sql.includes("select 1 as runtime_ready")) return { rows: [{ runtime_ready: 1 }] };
      throw new Error("schema_migrations is unavailable");
    },
  }, manifest), (error) => error.code === "RUNTIME_MIGRATION_MISMATCH" && !/schema_migrations/i.test(error.message));
});

test("storage probe fsyncs and cleans only its private path while preserving business files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-t45-storage-"));
  try {
    await writeFile(path.join(root, "business-sentinel"), "do-not-touch\n", { mode: 0o600 });
    await probeStorageRoot({ root, randomUuid: () => "123e4567-e89b-42d3-a456-426614174000" });
    assert.deepEqual(await readdir(root), ["business-sentinel"]);
    assert.equal(await readFile(path.join(root, "business-sentinel"), "utf8"), "do-not-touch\n");

    await assert.rejects(probeStorageRoot({
      root,
      randomUuid: () => "123e4567-e89b-42d3-a456-426614174001",
      testHook: (phase) => { if (phase === "before-file-fsync") throw new Error("secret fsync detail"); },
    }), (error) => error.code === "RUNTIME_STORAGE_UNAVAILABLE" && !/secret|cyd-t45/i.test(error.message));
    assert.deepEqual(await readdir(root), ["business-sentinel"]);

    await assert.rejects(probeStorageRoot({
      root,
      randomUuid: () => "123e4567-e89b-42d3-a456-426614174002",
      testHook: async (phase, directory) => {
        if (phase === "before-cleanup") await writeFile(path.join(directory, "unexpected"), "x");
      },
    }), (error) => error.code === "RUNTIME_STORAGE_UNAVAILABLE");
    assert.equal(await readFile(path.join(root, "business-sentinel"), "utf8"), "do-not-touch\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storage probe rejects non-directories, symlink roots and replacement attacks without following them", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-t45-storage-boundary-"));
  try {
    const real = path.join(parent, "real");
    const link = path.join(parent, "link");
    const file = path.join(parent, "file");
    await mkdir(real);
    await writeFile(file, "x");
    await symlink(real, link);
    for (const root of [file, link]) {
      await assert.rejects(probeStorageRoot({ root }), (error) => error.code === "RUNTIME_STORAGE_UNAVAILABLE");
    }

    const outside = path.join(parent, "outside");
    const quarantine = path.join(parent, "quarantine");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "outside\n");
    await assert.rejects(probeStorageRoot({
      root: real,
      randomUuid: () => "123e4567-e89b-42d3-a456-426614174003",
      testHook: async (phase, directory) => {
        if (phase !== "directory-created") return;
        await rename(directory, quarantine);
        await symlink(outside, directory);
      },
    }), (error) => error.code === "RUNTIME_STORAGE_UNAVAILABLE");
    assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "outside\n");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Worker instance file is atomic, mode 0600 and invalidates the previous process UUID", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-t45-instance-"));
  const file = path.join(root, "chenyida-erp-worker-instance-id");
  const first = randomUUID();
  const second = randomUUID();
  try {
    await writeWorkerInstanceFile(first, file);
    assert.equal(await readWorkerInstanceFile(file), first);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await writeWorkerInstanceFile(second, file);
    assert.equal(await readWorkerInstanceFile(file), second);
    assert.notEqual(second, first);
    await removeWorkerInstanceFile(second, file);
    await assert.rejects(readWorkerInstanceFile(file), (error) => error.code === "RUNTIME_INSTANCE_FILE_INVALID");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function readinessDatabase(entries, leaseFactory) {
  return {
    async query(sql) {
      if (sql.includes("select 1 as runtime_ready")) return { rows: [{ runtime_ready: 1 }] };
      if (sql.includes("schema_migrations")) return { rows: entries.map((entry) => ({ version: entry.filename, checksum: entry.sha256 })) };
      if (sql.includes("left join only public.worker_runtime_leases")) return { rows: [leaseFactory()] };
      throw new Error("unexpected query");
    },
  };
}

test("concurrent anonymous readiness shares one double-volume probe and cache never outlives Worker lease", async () => {
  const entries = [{ ordinal: 1, filename: "0001_runtime.sql", sha256: "1".repeat(64) }];
  const migrations = { entries, head: entries[0].filename, allowlistSha256: migrationAllowlistSha256(entries) };
  const identity = { ...requestIdentity, migrationHead: migrations.head, migrationManifestSha256: migrations.allowlistSha256 };
  let monotonic = 1_000;
  let probes = 0;
  let databaseChecks = 0;
  const database = readinessDatabase(entries, () => {
    databaseChecks += 1;
    return {
      database_now: new Date("2026-08-12T12:00:00.000Z"), instance_id: "123e4567-e89b-42d3-a456-426614174000",
      generation: "1", version: 1, status: "RUNNING", deployment_class: identity.deploymentClass,
      deployment_id: identity.deploymentId, application_version: identity.applicationVersion, git_commit: identity.gitCommit,
      migration_head: identity.migrationHead, migration_manifest_sha256: identity.migrationManifestSha256,
      heartbeat_at: new Date("2026-08-12T11:59:59.000Z"), lease_expires_at: new Date("2026-08-12T12:00:01.000Z"),
    };
  });
  const service = new RuntimeReadinessService({
    database, identity, migrations, uploadRoot: "/uploads", attachmentRoot: "/attachments", leaseSeconds: 60,
    nowMilliseconds: () => monotonic,
    storageProbe: async () => { probes += 1; await new Promise((resolve) => setTimeout(resolve, 5)); },
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => service.check()));
  assert.ok(results.every((result) => result.version === applicationVersion));
  assert.equal(probes, 2);
  assert.equal(databaseChecks, 1);
  monotonic += 700;
  await service.check();
  assert.equal(probes, 2, "cache should remain valid before its lease-bounded deadline");
  monotonic += 100;
  await service.check();
  assert.equal(probes, 4, "cache must expire before the one-second database lease");
  assert.equal(databaseChecks, 2);
});

test("Worker runtime heartbeat is serialized and lease loss is terminal", async () => {
  let active = 0;
  let maximumActive = 0;
  let renewals = 0;
  let lost = 0;
  const state = { instanceId: "123e4567-e89b-42d3-a456-426614174000", generation: "1", version: 1, leaseExpiresAt: new Date(Date.now() + 60_000) };
  const repository = {
    async renew(current) {
      renewals += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (renewals === 2) throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
      return { ...current, version: current.version + 1 };
    },
    async assertExactInstance() { return {}; },
  };
  const database = { async query(sql) {
    if (sql.includes("select 1 as runtime_ready")) return { rows: [{ runtime_ready: 1 }] };
    return { rows: [{ version: "0001_runtime.sql", checksum: "1".repeat(64) }] };
  } };
  const migrations = { entries: [{ ordinal: 1, filename: "0001_runtime.sql", sha256: "1".repeat(64) }], head: "0001_runtime.sql", allowlistSha256: "b".repeat(64) };
  const supervisor = new WorkerRuntimeLeaseSupervisor({
    repository, database, identity: requestIdentity, migrations, state,
    uploadRoot: "/uploads", attachmentRoot: "/attachments", intervalMs: 1_000,
    storageProbe: async () => undefined,
    onLost: () => { lost += 1; },
  });
  await Promise.all([supervisor.heartbeat(), supervisor.heartbeat().catch(() => undefined)]);
  assert.equal(maximumActive, 1);
  assert.equal(renewals, 2);
  assert.equal(lost, 1);
  assert.equal(supervisor.isLost(), true);
  await assert.rejects(supervisor.assertCurrent());
  await supervisor.stop();
});
