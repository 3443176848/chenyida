import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
import * as schema from "./schema.ts";
import {
  assertDatabaseRuntimeIdentity,
  databasePoolConfiguration,
  DatabaseRuntimeError,
  type DatabaseRuntimePolicy,
  type DatabaseRuntimeState,
} from "./runtime-connection.ts";

let sharedPool: Pool | undefined;

type PoolErrorSource = {
  on(event: "error", listener: (error: unknown) => void): unknown;
};

function safeDatabaseErrorCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  const known: Readonly<Record<string, string>> = Object.freeze({
    "08000": "DATABASE_CONNECTION_ERROR",
    "08001": "DATABASE_CONNECTION_ERROR",
    "08003": "DATABASE_CONNECTION_ERROR",
    "08004": "DATABASE_CONNECTION_REJECTED",
    "08006": "DATABASE_CONNECTION_ERROR",
    "08007": "DATABASE_CONNECTION_ERROR",
    "08P01": "DATABASE_PROTOCOL_ERROR",
    "53300": "DATABASE_CONNECTION_LIMIT_REACHED",
    "57P01": "DATABASE_SERVER_SHUTDOWN",
    "57P02": "DATABASE_SERVER_SHUTDOWN",
    "57P03": "DATABASE_SERVER_UNAVAILABLE",
    "57P04": "DATABASE_SERVER_UNAVAILABLE",
  });
  return known[candidate] || "DATABASE_CONNECTION_ERROR";
}

export function attachPostgresPoolErrorHandler(
  pool: PoolErrorSource,
  logger: (line: string) => void = (line) => console.error(line),
): void {
  pool.on("error", (error) => {
    logger(JSON.stringify({ level: "error", event: "postgres_idle_client_error", code: safeDatabaseErrorCode(error) }));
  });
}

type RuntimeVerifier = (client: PoolClient, callback: (error?: Error) => void) => void;
type PoolConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

export function createRuntimeVerifier(
  policy: DatabaseRuntimePolicy,
  databaseState: DatabaseRuntimeState = "RELEASED",
): RuntimeVerifier {
  return (client, callback) => {
    assertDatabaseRuntimeIdentity(client, policy, databaseState)
      .then(() => callback())
      .catch(() => callback(new DatabaseRuntimeError("DATABASE_RUNTIME_IDENTITY_INVALID")));
  };
}

export function installRuntimeCheckoutVerification(
  pool: Pool,
  policy: DatabaseRuntimePolicy,
  databaseState: DatabaseRuntimeState = "RELEASED",
): Pool {
  const acquire = pool.connect.bind(pool);
  const verify = createRuntimeVerifier(policy, databaseState);
  const guardedConnect = (callback?: PoolConnectCallback): Promise<PoolClient> | void => {
    if (callback) {
      acquire((error, client, done) => {
        if (error || !client) {
          callback(error, client, done);
          return;
        }
        verify(client, (verificationError) => {
          if (!verificationError) {
            callback(undefined, client, done);
            return;
          }
          done(verificationError);
          callback(verificationError, undefined, () => undefined);
        });
      });
      return;
    }
    return acquire().then((client) => new Promise<PoolClient>((resolve, reject) => {
      verify(client, (verificationError) => {
        if (!verificationError) {
          resolve(client);
          return;
        }
        client.release(verificationError);
        reject(verificationError);
      });
    }));
  };
  Object.defineProperty(pool, "connect", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: guardedConnect,
  });
  return pool;
}

function createPool(): Pool {
  const resolved = databasePoolConfiguration(runtimeConfig());
  const pool = new Pool({ ...resolved.pool } satisfies PoolConfig);
  if (!resolved.policy) return pool;
  const requestedState = process.env.ERP_MIGRATION_DATABASE_STATE;
  let databaseState: DatabaseRuntimeState = "RELEASED";
  if (requestedState !== undefined) {
    const digest = /^[0-9a-f]{64}$/;
    if (requestedState !== "MIGRATION_FENCED" || resolved.policy.service !== "MIGRATION"
      || !resolved.policy.marker.startsWith("chenyida-erp-deployment/v2:UAT:")
      || !digest.test(process.env.ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256 || "")
      || !digest.test(process.env.ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256 || "")) {
      throw new DatabaseRuntimeError("DATABASE_RUNTIME_STATE_INVALID");
    }
    databaseState = "MIGRATION_FENCED";
  }
  return installRuntimeCheckoutVerification(pool, resolved.policy, databaseState);
}

export function getPool(): Pool {
  if (!sharedPool) {
    sharedPool = createPool();
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
