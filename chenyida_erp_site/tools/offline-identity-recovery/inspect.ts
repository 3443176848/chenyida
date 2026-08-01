import { Pool } from "pg";
import {
  activeTargetSessionCount,
  assertInspectionDatabaseState,
  businessFingerprint,
  protectedDataFingerprint,
  RECOVERY_ACCOUNTS,
  RecoveryError,
} from "./core.ts";

type Mode = "fingerprint" | "protected-fingerprint" | "active-sessions" | "identity-summary";

function fail(code: string): never {
  throw new RecoveryError(code, "INSPECT");
}

function parse(argv: string[]): { mode: Mode; database: string } {
  let mode: Mode | "" = "";
  let database = "";
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--business-fingerprint") mode = mode ? fail("RECOVERY_ARGUMENT_INVALID") : "fingerprint";
    else if (flag === "--protected-data-fingerprint") mode = mode ? fail("RECOVERY_ARGUMENT_INVALID") : "protected-fingerprint";
    else if (flag === "--active-target-sessions") mode = mode ? fail("RECOVERY_ARGUMENT_INVALID") : "active-sessions";
    else if (flag === "--identity-summary") mode = mode ? fail("RECOVERY_ARGUMENT_INVALID") : "identity-summary";
    else if (flag === "--expected-database-name") {
      database = argv[index + 1] || "";
      index += 1;
    } else fail("RECOVERY_ARGUMENT_INVALID");
  }
  if (!mode || !database) fail("RECOVERY_ARGUMENT_INVALID");
  return { mode, database };
}

async function main(): Promise<number> {
  process.umask(0o077);
  Error.stackTraceLimit = 0;
  let pool: Pool | null = null;
  try {
    if ((process.geteuid?.() ?? -1) !== 0) fail("RECOVERY_ROOT_REQUIRED");
    if (process.env.ERP_DEPLOYMENT_CLASS === "production") fail("RECOVERY_PRODUCTION_FORBIDDEN");
    const args = parse(process.argv.slice(2));
    if (args.database !== "chenyida_erp" && !/^cyd_oir_(?:test|restore)_[0-9a-f]{12}$/.test(args.database)) {
      fail("RECOVERY_DATABASE_IDENTITY_REJECTED");
    }
    let rawUrl = process.env.DATABASE_URL || "";
    let url: URL;
    try { url = new URL(rawUrl); } catch { fail("RECOVERY_DATABASE_URL_REJECTED"); }
    if (args.database !== "chenyida_erp") {
      if (process.env.RECOVERY_REWRITE_DATABASE_PATH !== "1"
        || process.env.ERP_DEPLOYMENT_CLASS !== "test"
        || decodeURIComponent(url.pathname.slice(1)) !== "chenyida_erp") {
        fail("RECOVERY_DATABASE_URL_REJECTED");
      }
      url.pathname = `/${args.database}`;
      rawUrl = url.toString();
    } else if (process.env.RECOVERY_REWRITE_DATABASE_PATH === "1") {
      fail("RECOVERY_DATABASE_URL_REJECTED");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol)
      || url.hostname !== "postgres"
      || !["", "5432"].includes(url.port)
      || decodeURIComponent(url.username) !== "chenyida_erp"
      || decodeURIComponent(url.pathname.slice(1)) !== args.database
      || !url.password
      || url.search
      || url.hash) fail("RECOVERY_DATABASE_URL_REJECTED");
    pool = new Pool({ connectionString: rawUrl, max: 1, application_name: "chenyida-erp-offline-inspector" });
    pool.on("error", fatal);
    await assertInspectionDatabaseState(pool, args.database);
    if (args.mode === "fingerprint" || args.mode === "protected-fingerprint") {
      const value = args.mode === "fingerprint" ? await businessFingerprint(pool) : await protectedDataFingerprint(pool);
      const label = args.mode === "fingerprint" ? "BUSINESS_FINGERPRINT" : "PROTECTED_FINGERPRINT";
      process.stdout.write(`${label} PASS ${value.fingerprint} TABLES ${value.tableCount} SEQUENCES ${value.sequenceCount}\n`);
    } else if (args.mode === "active-sessions") {
      const count = await activeTargetSessionCount(pool);
      process.stdout.write(`COUNT ACTIVE_TARGET_SESSIONS ${count}\n`);
    } else {
      const client = await pool.connect();
      try {
        await client.query("begin isolation level repeatable read read only");
        const totals = await client.query<{ user_count: number; session_count: number; active_target_sessions: number }>(`
          select
            (select count(*)::int from app_users) user_count,
            (select count(*)::int from app_sessions) session_count,
            (select count(*)::int from app_sessions
              where username=any($1::text[]) and revoked_at is null and expires_at>now()) active_target_sessions
        `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
        const users = await client.query<{ username: string; role: string; is_active: boolean }>(`
          select username,role,is_active from app_users where username=any($1::text[])
        `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
        const expected = new Map(RECOVERY_ACCOUNTS.map((account) => [account.username, account.role]));
        const matching = users.rows.filter((row) => expected.get(row.username) === row.role && row.is_active === true).length;
        await client.query("commit");
        process.stdout.write("MIGRATIONS PASS 36 HEAD 0036\n");
        process.stdout.write(`COUNT USERS ${Number(totals.rows[0]?.user_count || 0)}\n`);
        process.stdout.write(`COUNT SESSIONS ${Number(totals.rows[0]?.session_count || 0)}\n`);
        process.stdout.write(`COUNT TARGET_ACCOUNTS ${users.rowCount || 0}\n`);
        process.stdout.write(`COUNT TARGET_ROLE_ACTIVE_MATCH ${matching}\n`);
        process.stdout.write(`COUNT ACTIVE_TARGET_SESSIONS ${Number(totals.rows[0]?.active_target_sessions || 0)}\n`);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return 0;
  } catch (error) {
    const known = error instanceof RecoveryError ? error : new RecoveryError("RECOVERY_INSPECT_FAILED", "INSPECT");
    process.stderr.write(`STAGE ${known.phase} FAIL ${known.code}\n`);
    return 2;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

function fatal(): never {
  process.stderr.write("STAGE INSPECT FAIL RECOVERY_UNHANDLED_ERROR\n");
  process.exit(2);
}

process.once("uncaughtException", fatal);
process.once("unhandledRejection", fatal);
process.exitCode = await main();
