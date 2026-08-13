import type { RuntimeConfig } from "../infrastructure/config.ts";
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
  type LeaseDatabase,
  type WorkerLeaseState,
  type WorkerRuntimeIdentity,
} from "./worker-lease.ts";

type StorageProbe = (root: string) => Promise<void>;
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
