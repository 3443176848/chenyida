import { RuntimeReadinessError, type RuntimeIdentity } from "./identity.ts";
import type { RuntimeMigrationManifest } from "./migration.ts";

export const WORKER_SERVICE_SLOT = "background-jobs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

export type WorkerRuntimeIdentity = RuntimeIdentity & Readonly<{
  migrationHead: string;
  migrationManifestSha256: string;
}>;

export type WorkerLeaseState = Readonly<{
  instanceId: string;
  generation: string;
  version: number;
  leaseExpiresAt: Date;
}>;

export type FreshWorkerLease = WorkerLeaseState & WorkerRuntimeIdentity & Readonly<{
  databaseNow: Date;
  heartbeatAt: Date;
}>;

export type LeaseDatabase = Readonly<{
  query(sql: string, values?: unknown[]): Promise<{ rows?: unknown[]; rowCount?: number | null }>;
}>;

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) throw new RuntimeReadinessError("RUNTIME_WORKER_UNAVAILABLE");
  return parsed;
}

function leaseState(row: Record<string, unknown>, instanceId: string): WorkerLeaseState {
  const generation = String(row.generation || "");
  const version = Number(row.version);
  if (!UUID.test(instanceId) || !POSITIVE_INTEGER.test(generation) || !Number.isSafeInteger(version) || version < 1) {
    throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
  }
  return Object.freeze({ instanceId, generation, version, leaseExpiresAt: date(row.lease_expires_at) });
}

export function workerRuntimeIdentity(identity: RuntimeIdentity, migrations: RuntimeMigrationManifest): WorkerRuntimeIdentity {
  return Object.freeze({
    ...identity,
    migrationHead: migrations.head,
    migrationManifestSha256: migrations.allowlistSha256,
  });
}

export class PostgresWorkerRuntimeLeaseReader {
  protected readonly database: LeaseDatabase;

  constructor(database: LeaseDatabase) {
    this.database = database;
  }

  async readFresh(): Promise<FreshWorkerLease> {
    try {
      const result = await this.database.query(`
        select clock_timestamp() as database_now,
               lease.instance_id,lease.generation::text,lease.version,lease.status,
               lease.deployment_class,lease.deployment_id,lease.application_version,lease.git_commit,
               lease.migration_head,lease.migration_manifest_sha256,
               lease.heartbeat_at,lease.lease_expires_at
        from (select 1) as singleton
        left join only public.worker_runtime_leases as lease on lease.service_slot=$1
      `, [WORKER_SERVICE_SLOT]);
      const row = (result.rows || [])[0] as Record<string, unknown> | undefined;
      if (!row || row.status !== "RUNNING") throw new RuntimeReadinessError("RUNTIME_WORKER_UNAVAILABLE");
      const databaseNow = date(row.database_now);
      const heartbeatAt = date(row.heartbeat_at);
      const state = leaseState(row, String(row.instance_id || ""));
      if (heartbeatAt.getTime() > databaseNow.getTime()
        || state.leaseExpiresAt.getTime() <= databaseNow.getTime()) {
        throw new RuntimeReadinessError("RUNTIME_WORKER_UNAVAILABLE");
      }
      return Object.freeze({
        ...state,
        databaseNow,
        heartbeatAt,
        deploymentClass: String(row.deployment_class || "") as RuntimeIdentity["deploymentClass"],
        deploymentId: String(row.deployment_id || ""),
        applicationVersion: String(row.application_version || ""),
        gitCommit: String(row.git_commit || ""),
        migrationHead: String(row.migration_head || ""),
        migrationManifestSha256: String(row.migration_manifest_sha256 || ""),
      });
    } catch (error) {
      if (error instanceof RuntimeReadinessError) throw error;
      throw new RuntimeReadinessError("RUNTIME_DATABASE_UNAVAILABLE");
    }
  }

  async assertExactInstance(instanceId: string, identity: WorkerRuntimeIdentity): Promise<FreshWorkerLease> {
    const lease = await this.readFresh();
    if (lease.instanceId !== instanceId
      || lease.deploymentClass !== identity.deploymentClass
      || lease.deploymentId !== identity.deploymentId
      || lease.applicationVersion !== identity.applicationVersion
      || lease.gitCommit !== identity.gitCommit
      || lease.migrationHead !== identity.migrationHead
      || lease.migrationManifestSha256 !== identity.migrationManifestSha256) {
      throw new RuntimeReadinessError("RUNTIME_WORKER_UNAVAILABLE");
    }
    return lease;
  }
}
