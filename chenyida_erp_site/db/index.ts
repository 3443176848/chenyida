import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
import * as schema from "./schema.ts";
import {
  assertDatabaseRuntimeIdentity,
  databasePoolConfiguration,
  DatabaseRuntimeError,
  type DatabaseRuntimePolicy,
} from "./runtime-connection.ts";

let sharedPool: Pool | undefined;

type PoolErrorSource = {
  on(event: "error", listener: (error: unknown) => void): unknown;
};

function safeDatabaseErrorCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  return /^[0-9A-Z_]{1,32}$/.test(candidate) ? candidate : "DATABASE_CONNECTION_ERROR";
}

export function attachPostgresPoolErrorHandler(
  pool: PoolErrorSource,
  logger: (line: string) => void = (line) => console.error(line),
): void {
  pool.on("error", (error) => {
    logger(JSON.stringify({ level: "error", event: "postgres_idle_client_error", code: safeDatabaseErrorCode(error) }));
  });
}

type VerifiedPoolConfig = PoolConfig & {
  verify?: (client: PoolClient, callback: (error?: Error) => void) => void;
};

export function createRuntimeVerifier(policy: DatabaseRuntimePolicy): NonNullable<VerifiedPoolConfig["verify"]> {
  const verified = new WeakSet<PoolClient>();
  return (client, callback) => {
    if (verified.has(client)) {
      callback();
      return;
    }
    assertDatabaseRuntimeIdentity(client, policy)
      .then(() => {
        verified.add(client);
        callback();
      })
      .catch(() => callback(new DatabaseRuntimeError("DATABASE_RUNTIME_IDENTITY_INVALID")));
  };
}

function connectionConfig(): VerifiedPoolConfig {
  const resolved = databasePoolConfiguration(runtimeConfig());
  return resolved.policy
    ? { ...resolved.pool, verify: createRuntimeVerifier(resolved.policy) }
    : { ...resolved.pool };
}

export function getPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool(connectionConfig());
    attachPostgresPoolErrorHandler(sharedPool);
  }
  return sharedPool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  if (pool) await pool.end();
}
