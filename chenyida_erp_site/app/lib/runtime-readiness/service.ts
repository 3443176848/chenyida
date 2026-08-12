import type { RuntimeConfig } from "../infrastructure/config.ts";
import { runtimeConfig } from "../infrastructure/config.ts";
import { RuntimeReadinessError, resolveRuntimeIdentity, runtimeReadinessErrorCode } from "./identity.ts";
import {
  loadRuntimeMigrationManifest,
  verifyDatabaseMigrationManifest,
  type RuntimeMigrationManifest,
  type RuntimeQuery,
} from "./migration.ts";
import { probeStorageRoot } from "./storage.ts";
import {
  PostgresWorkerRuntimeLease,
  workerRuntimeIdentity,
  type FreshWorkerLease,
  type LeaseDatabase,
  type WorkerLeaseState,
  type WorkerRuntimeIdentity,
} from "./worker-lease.ts";

export type RuntimeReadinessResult = Readonly<{
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
  private readonly lease: PostgresWorkerRuntimeLease;
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
    leaseSeconds: number;
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
    this.lease = new PostgresWorkerRuntimeLease(input.database, input.leaseSeconds);
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
      leaseSeconds: config.workerLeaseSeconds,
    });
  })();
  return defaultReadinessService;
}

type LeaseSupervisorOperation = () => Promise<void>;

export class WorkerRuntimeLeaseSupervisor {
  private readonly repository: PostgresWorkerRuntimeLease;
  private readonly database: RuntimeQuery;
  private readonly identity: WorkerRuntimeIdentity;
  private readonly migrations: RuntimeMigrationManifest;
  private readonly roots: readonly string[];
  private readonly intervalMs: number;
  private readonly storageProbe: StorageProbe;
  private readonly onLost: (code: string) => void;
  private state: WorkerLeaseState;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private stopping = false;
  private lost = false;

  constructor(input: Readonly<{
    repository: PostgresWorkerRuntimeLease;
    database: RuntimeQuery;
    identity: WorkerRuntimeIdentity;
    migrations: RuntimeMigrationManifest;
    state: WorkerLeaseState;
    uploadRoot: string;
    attachmentRoot: string;
    intervalMs: number;
    storageProbe?: StorageProbe;
    onLost: (code: string) => void;
  }>) {
    if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1_000 || input.intervalMs > 20_000) {
      throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
    }
    this.repository = input.repository;
    this.database = input.database;
    this.identity = input.identity;
    this.migrations = input.migrations;
    this.state = input.state;
    this.roots = Object.freeze([input.uploadRoot, input.attachmentRoot]);
    this.intervalMs = input.intervalMs;
    this.storageProbe = input.storageProbe || ((root) => probeStorageRoot({ root }));
    this.onLost = input.onLost;
  }

  private markLost(error: unknown): void {
    if (this.lost) return;
    this.lost = true;
    this.onLost(runtimeReadinessErrorCode(error));
  }

  private enqueue(operation: LeaseSupervisorOperation): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.stopping || this.lost) throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
      try {
        await operation();
      } catch (error) {
        this.markLost(error);
        throw error;
      }
    });
    return this.chain;
  }

  private schedule(): void {
    if (this.stopping || this.lost) return;
    this.timer = setTimeout(() => {
      void this.heartbeat().catch(() => undefined).finally(() => this.schedule());
    }, this.intervalMs);
    this.timer.unref?.();
  }

  start(): void {
    this.schedule();
  }

  heartbeat(): Promise<void> {
    return this.enqueue(async () => {
      await verifyDatabaseMigrationManifest(this.database, this.migrations);
      for (const root of this.roots) await this.storageProbe(root);
      this.state = await this.repository.renew(this.state, this.identity);
    });
  }

  assertCurrent(): Promise<void> {
    return this.enqueue(async () => {
      await this.repository.assertExactInstance(this.state.instanceId, this.identity);
    });
  }

  async stop(): Promise<WorkerLeaseState> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.chain.catch(() => undefined);
    return this.state;
  }

  isLost(): boolean {
    return this.lost;
  }
}

export async function prepareWorkerRuntime(input: Readonly<{
  database: RuntimeQuery & LeaseDatabase;
  config: Pick<RuntimeConfig, "environment" | "deploymentClass" | "uploadRoot" | "attachmentRoot" | "workerLeaseSeconds">;
  instanceId: string;
  storageProbe?: StorageProbe;
}>): Promise<Readonly<{
  migrations: RuntimeMigrationManifest;
  identity: WorkerRuntimeIdentity;
  repository: PostgresWorkerRuntimeLease;
  state: WorkerLeaseState;
}>> {
  const identity = resolveRuntimeIdentity({ config: input.config });
  const migrations = await loadRuntimeMigrationManifest();
  await verifyDatabaseMigrationManifest(input.database, migrations);
  const storageProbe = input.storageProbe || ((root: string) => probeStorageRoot({ root }));
  await storageProbe(input.config.uploadRoot);
  await storageProbe(input.config.attachmentRoot);
  const runtimeIdentity = workerRuntimeIdentity(identity, migrations);
  const repository = new PostgresWorkerRuntimeLease(input.database, input.config.workerLeaseSeconds);
  const state = await repository.acquire(input.instanceId, runtimeIdentity);
  return Object.freeze({ migrations, identity: runtimeIdentity, repository, state });
}
