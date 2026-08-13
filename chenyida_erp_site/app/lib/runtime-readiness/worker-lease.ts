import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import { RuntimeReadinessError } from "./identity.ts";
import {
  PostgresWorkerRuntimeLeaseReader,
  WORKER_SERVICE_SLOT,
  type LeaseDatabase,
  type WorkerLeaseState,
  type WorkerRuntimeIdentity,
} from "./worker-lease-reader.ts";

export { WORKER_SERVICE_SLOT, workerRuntimeIdentity } from "./worker-lease-reader.ts";
export type {
  FreshWorkerLease,
  LeaseDatabase,
  WorkerLeaseState,
  WorkerRuntimeIdentity,
} from "./worker-lease-reader.ts";

export const DEFAULT_WORKER_INSTANCE_FILE = "/tmp/chenyida-erp-worker-instance-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
type FileIdentity = Readonly<{ dev: number | bigint; ino: number | bigint }>;

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

function identityValues(identity: WorkerRuntimeIdentity): unknown[] {
  return [
    identity.deploymentClass,
    identity.deploymentId,
    identity.applicationVersion,
    identity.gitCommit,
    identity.migrationHead,
    identity.migrationManifestSha256,
  ];
}

export class PostgresWorkerRuntimeLease extends PostgresWorkerRuntimeLeaseReader {
  private readonly leaseSeconds: number;

  constructor(database: LeaseDatabase, leaseSeconds: number) {
    super(database);
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
      throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
    }
    this.leaseSeconds = leaseSeconds;
  }

  async acquire(instanceId: string, identity: WorkerRuntimeIdentity): Promise<WorkerLeaseState> {
    if (!UUID.test(instanceId)) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    try {
      const result = await this.database.query(`
        with db_clock as (select clock_timestamp() as at)
        insert into public.worker_runtime_leases(
          service_slot,instance_id,generation,status,deployment_class,deployment_id,
          application_version,git_commit,migration_head,migration_manifest_sha256,
          started_at,heartbeat_at,lease_expires_at,stopped_at,version
        )
        select $1,$2,1,'RUNNING',$3,$4,$5,$6,$7,$8,at,at,at+make_interval(secs=>$9::int),null,1
        from db_clock
        on conflict(service_slot) do update set
          instance_id=excluded.instance_id,
          generation=public.worker_runtime_leases.generation+1,
          status='RUNNING',
          deployment_class=excluded.deployment_class,
          deployment_id=excluded.deployment_id,
          application_version=excluded.application_version,
          git_commit=excluded.git_commit,
          migration_head=excluded.migration_head,
          migration_manifest_sha256=excluded.migration_manifest_sha256,
          started_at=excluded.started_at,
          heartbeat_at=excluded.heartbeat_at,
          lease_expires_at=excluded.lease_expires_at,
          stopped_at=null,
          version=public.worker_runtime_leases.version+1
        where public.worker_runtime_leases.status='STOPPED'
           or public.worker_runtime_leases.lease_expires_at<=excluded.started_at
        returning generation::text,version,lease_expires_at
      `, [WORKER_SERVICE_SLOT, instanceId, ...identityValues(identity), this.leaseSeconds]);
      const row = (result.rows || [])[0] as Record<string, unknown> | undefined;
      if (!row) throw new RuntimeReadinessError("RUNTIME_LEASE_ACTIVE");
      return leaseState(row, instanceId);
    } catch (error) {
      if (error instanceof RuntimeReadinessError) throw error;
      throw new RuntimeReadinessError("RUNTIME_DATABASE_UNAVAILABLE");
    }
  }

  async renew(state: WorkerLeaseState, identity: WorkerRuntimeIdentity): Promise<WorkerLeaseState> {
    try {
      const result = await this.database.query(`
        with db_clock as (select clock_timestamp() as at)
        update only public.worker_runtime_leases as lease set
          heartbeat_at=db_clock.at,
          lease_expires_at=db_clock.at+make_interval(secs=>$11::int),
          version=lease.version+1
        from db_clock
        where lease.service_slot=$1 and lease.instance_id=$2 and lease.generation=$3::bigint
          and lease.version=$4 and lease.status='RUNNING' and lease.lease_expires_at>db_clock.at
          and lease.deployment_class=$5 and lease.deployment_id=$6 and lease.application_version=$7
          and lease.git_commit=$8 and lease.migration_head=$9 and lease.migration_manifest_sha256=$10
        returning lease.generation::text,lease.version,lease.lease_expires_at
      `, [
        WORKER_SERVICE_SLOT, state.instanceId, state.generation, state.version,
        ...identityValues(identity), this.leaseSeconds,
      ]);
      const row = (result.rows || [])[0] as Record<string, unknown> | undefined;
      if (!row) throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
      return leaseState(row, state.instanceId);
    } catch (error) {
      if (error instanceof RuntimeReadinessError) throw error;
      throw new RuntimeReadinessError("RUNTIME_DATABASE_UNAVAILABLE");
    }
  }

  async stop(state: WorkerLeaseState): Promise<void> {
    try {
      const result = await this.database.query(`
        with db_clock as (select clock_timestamp() as at),
        stopped as (
          update only public.worker_runtime_leases as lease set
            status='STOPPED',heartbeat_at=db_clock.at,lease_expires_at=db_clock.at,
            stopped_at=db_clock.at,version=lease.version+1
          from db_clock
          where lease.service_slot=$1 and lease.instance_id=$2 and lease.generation=$3::bigint
            and lease.version=$4 and lease.status='RUNNING'
          returning 1 as ok
        )
        select ok from stopped
        union all
        select 1 from only public.worker_runtime_leases
        where service_slot=$1 and instance_id=$2 and generation=$3::bigint and status='STOPPED'
        limit 1
      `, [WORKER_SERVICE_SLOT, state.instanceId, state.generation, state.version]);
      if (!(result.rows || [])[0]) throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
    } catch (error) {
      if (error instanceof RuntimeReadinessError) throw error;
      throw new RuntimeReadinessError("RUNTIME_DATABASE_UNAVAILABLE");
    }
  }

}

function safeInstanceFile(file: string): string {
  const resolved = path.resolve(file);
  if (resolved === path.parse(resolved).root || path.basename(resolved) !== "chenyida-erp-worker-instance-id") {
    throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  }
  return resolved;
}

async function trustedInstanceDirectory(file: string): Promise<Readonly<{ handle: FileHandle; identity: FileIdentity }>> {
  const directory = path.dirname(file);
  try {
    if (await realpath(directory) !== directory) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    const pathStat = await lstat(directory);
    if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!sameFile(stat, pathStat)) {
      await handle.close();
      throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    }
    return { handle, identity: { dev: stat.dev, ino: stat.ino } };
  } catch (error) {
    if (error instanceof RuntimeReadinessError) throw error;
    throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  }
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function writeWorkerInstanceFile(
  instanceId: string,
  file: string = process.env.ERP_WORKER_INSTANCE_FILE || DEFAULT_WORKER_INSTANCE_FILE,
): Promise<void> {
  if (!UUID.test(instanceId)) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  const target = safeInstanceFile(file);
  const directory = await trustedInstanceDirectory(target);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    try {
      await readWorkerInstanceFile(target);
      await unlink(target);
      await directory.handle.sync();
    } catch (error) {
      if (!(error instanceof RuntimeReadinessError)) throw error;
      const present = await lstat(target).then(() => true, (candidate) => {
        if (candidate && typeof candidate === "object" && "code" in candidate && candidate.code === "ENOENT") return false;
        throw candidate;
      });
      if (present) throw error;
    }
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const raw = Buffer.from(`${instanceId}\n`, "utf8");
    const result = await handle.write(raw, 0, raw.byteLength, 0);
    if (result.bytesWritten !== raw.byteLength) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    await handle.sync();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== raw.byteLength || (stat.mode & 0o777) !== 0o600) {
      throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    }
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await directory.handle.sync();
    if (await readWorkerInstanceFile(target) !== instanceId) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  } catch (error) {
    if (error instanceof RuntimeReadinessError) throw error;
    throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    await directory.handle.close().catch(() => undefined);
  }
}

export async function readWorkerInstanceFile(
  file: string = process.env.ERP_WORKER_INSTANCE_FILE || DEFAULT_WORKER_INSTANCE_FILE,
): Promise<string> {
  const target = safeInstanceFile(file);
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(target);
    const uid = process.getuid?.();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== 37
      || (before.mode & 0o777) !== 0o600 || !Number.isSafeInteger(uid) || before.uid !== uid) {
      throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    }
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!sameFile(opened, before)) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    const raw = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat();
    const afterPath = await lstat(target);
    if (!sameFile(after, opened) || !sameFile(afterPath, opened) || raw.length !== 37 || raw.at(-1) !== "\n") {
      throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    }
    const instanceId = raw.slice(0, -1);
    if (!UUID.test(instanceId)) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
    return instanceId;
  } catch (error) {
    if (error instanceof RuntimeReadinessError) throw error;
    throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function removeWorkerInstanceFile(
  instanceId: string,
  file: string = process.env.ERP_WORKER_INSTANCE_FILE || DEFAULT_WORKER_INSTANCE_FILE,
): Promise<void> {
  const target = safeInstanceFile(file);
  if (await readWorkerInstanceFile(target) !== instanceId) throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  const directory = await trustedInstanceDirectory(target);
  try {
    await unlink(target);
    await directory.handle.sync();
  } catch {
    throw new RuntimeReadinessError("RUNTIME_INSTANCE_FILE_INVALID");
  } finally {
    await directory.handle.close().catch(() => undefined);
  }
}
