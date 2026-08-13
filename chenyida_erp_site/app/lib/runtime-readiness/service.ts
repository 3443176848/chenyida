import type { RuntimeConfig } from "../infrastructure/config.ts";
import { runtimeConfig } from "../infrastructure/config.ts";
import { RuntimeReadinessError, resolveRuntimeIdentity } from "./identity.ts";
import {
  loadRuntimeMigrationManifest,
  verifyDatabaseMigrationManifest,
  type RuntimeMigrationManifest,
  type RuntimeQuery,
} from "./migration.ts";
import { probeStorageRoot } from "./storage.ts";
import {
  PostgresWorkerRuntimeLeaseReader,
  workerRuntimeIdentity,
  type FreshWorkerLease,
  type LeaseDatabase,
  type WorkerRuntimeIdentity,
} from "./worker-lease-reader.ts";

export type RuntimeReadinessResult = Readonly<{
  deploymentClass: RuntimeConfig["deploymentClass"];
  deploymentId: string;
  version: string;
  revision: string;
  migrationHead: string;
  migrationManifestSha256: string;
  databaseTime: Date;
  leaseExpiresAt: Date;
  components: Readonly<{
    postgresql: "READY";
    migration: "READY";
    worker: "READY";
    uploads: "READY";
    attachments: "READY";
    runtime: "READY";
  }>;
}>;

type StorageProbe = (root: string) => Promise<void>;

function sameWorkerIdentity(lease: FreshWorkerLease, identity: WorkerRuntimeIdentity): boolean {
  return lease.deploymentClass === identity.deploymentClass
    && lease.deploymentId === identity.deploymentId
    && lease.applicationVersion === identity.applicationVersion
    && lease.gitCommit === identity.gitCommit
    && lease.migrationHead === identity.migrationHead
    && lease.migrationManifestSha256 === identity.migrationManifestSha256;
}

export class RuntimeReadinessService {
  private readonly database: RuntimeQuery & LeaseDatabase;
  private readonly identity: WorkerRuntimeIdentity;
  private readonly migrations: RuntimeMigrationManifest;
  private readonly uploadRoot: string;
  private readonly attachmentRoot: string;
  private readonly lease: PostgresWorkerRuntimeLeaseReader;
  private readonly storageProbe: StorageProbe;
  private readonly nowMilliseconds: () => number;
  private readonly successTtlMs: number;
  private readonly failureTtlMs: number;
  private inFlight: Promise<RuntimeReadinessResult> | undefined;
  private cached: Readonly<{
    expiresAt: number;
    result?: RuntimeReadinessResult;
    error?: RuntimeReadinessError;
  }> | undefined;

  constructor(input: Readonly<{
    database: RuntimeQuery & LeaseDatabase;
    identity: WorkerRuntimeIdentity;
    migrations: RuntimeMigrationManifest;
    uploadRoot: string;
    attachmentRoot: string;
    storageProbe?: StorageProbe;
    nowMilliseconds?: () => number;
    successTtlMs?: number;
    failureTtlMs?: number;
  }>) {
    this.database = input.database;
    this.identity = input.identity;
    this.migrations = input.migrations;
    this.uploadRoot = input.uploadRoot;
    this.attachmentRoot = input.attachmentRoot;
    this.lease = new PostgresWorkerRuntimeLeaseReader(input.database);
    this.storageProbe = input.storageProbe || ((root) => probeStorageRoot({ root }));
    this.nowMilliseconds = input.nowMilliseconds || Date.now;
    this.successTtlMs = Math.min(2_000, Math.max(0, input.successTtlMs ?? 2_000));
    this.failureTtlMs = Math.min(500, Math.max(0, input.failureTtlMs ?? 250));
  }

  private async checkUncached(): Promise<RuntimeReadinessResult> {
    await verifyDatabaseMigrationManifest(this.database, this.migrations);
    const worker = await this.lease.readFresh();
    if (!sameWorkerIdentity(worker, this.identity)) throw new RuntimeReadinessError("RUNTIME_WORKER_UNAVAILABLE");
    try { await this.storageProbe(this.uploadRoot); }
    catch { throw new RuntimeReadinessError("RUNTIME_UPLOADS_UNAVAILABLE"); }
    try { await this.storageProbe(this.attachmentRoot); }
    catch { throw new RuntimeReadinessError("RUNTIME_ATTACHMENTS_UNAVAILABLE"); }
    return Object.freeze({
      deploymentClass: this.identity.deploymentClass,
      deploymentId: this.identity.deploymentId,
      version: this.identity.applicationVersion,
      revision: this.identity.gitCommit.slice(0, 12),
      migrationHead: this.migrations.head,
      migrationManifestSha256: this.migrations.allowlistSha256,
      databaseTime: worker.databaseNow,
      leaseExpiresAt: worker.leaseExpiresAt,
      components: Object.freeze({
        postgresql: "READY",
        migration: "READY",
        worker: "READY",
        uploads: "READY",
        attachments: "READY",
        runtime: "READY",
      }),
    });
  }

  async check(): Promise<RuntimeReadinessResult> {
    const now = this.nowMilliseconds();
    if (this.cached && now < this.cached.expiresAt) {
      if (this.cached.error) throw this.cached.error;
      return this.cached.result!;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.checkUncached()
      .then((result) => {
        const leaseRemainingMs = result.leaseExpiresAt.getTime() - result.databaseTime.getTime();
        const ttl = Math.max(0, Math.min(this.successTtlMs, leaseRemainingMs - 250));
        this.cached = { expiresAt: this.nowMilliseconds() + ttl, result };
        return result;
      })
      .catch((error: unknown) => {
        const safe = error instanceof RuntimeReadinessError
          ? error
          : new RuntimeReadinessError("RUNTIME_READINESS_FAILED");
        this.cached = { expiresAt: this.nowMilliseconds() + this.failureTtlMs, error: safe };
        throw safe;
      })
      .finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
}

let defaultReadinessService: Promise<RuntimeReadinessService> | undefined;

export function getDefaultRuntimeReadinessService(
  database: RuntimeQuery & LeaseDatabase,
): Promise<RuntimeReadinessService> {
  defaultReadinessService ??= (async () => {
    const config = runtimeConfig();
    const identity = resolveRuntimeIdentity({ config });
    const migrations = await loadRuntimeMigrationManifest();
    return new RuntimeReadinessService({
      database,
      identity: workerRuntimeIdentity(identity, migrations),
      migrations,
      uploadRoot: config.uploadRoot,
      attachmentRoot: config.attachmentRoot,
    });
  })();
  return defaultReadinessService;
}
