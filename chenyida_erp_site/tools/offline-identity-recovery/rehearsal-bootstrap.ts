Error.stackTraceLimit = 0;

export {};

function fail(): never {
  process.stderr.write("STAGE PRECHECK FAIL RECOVERY_REHEARSAL_BOOTSTRAP_REJECTED\n");
  process.exit(2);
}

try {
  const args = process.argv.slice(2);
  const databaseIndexes = args.reduce<number[]>((values, value, index) => {
    if (value === "--expected-database-name") values.push(index);
    return values;
  }, []);
  const environmentIndexes = args.reduce<number[]>((values, value, index) => {
    if (value === "--environment") values.push(index);
    return values;
  }, []);
  if (databaseIndexes.length !== 1 || environmentIndexes.length !== 1
    || args[environmentIndexes[0] + 1] !== "parallel-uat-rehearsal"
    || process.env.ERP_ENV !== "test"
    || process.env.ERP_DEPLOYMENT_CLASS !== "test") fail();
  const database = args[databaseIndexes[0] + 1] || "";
  if (!/^cyd_oir_(?:test|restore)_[0-9a-f]{12}$/.test(database)) fail();
  const url = new URL(process.env.DATABASE_URL || "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "postgres"
    || !["", "5432"].includes(url.port)
    || decodeURIComponent(url.username) !== "chenyida_erp"
    || decodeURIComponent(url.pathname.slice(1)) !== "chenyida_erp"
    || !url.password || url.search || url.hash) fail();
  url.pathname = `/${database}`;
  process.env.DATABASE_URL = url.toString();
  await import("./cli.ts");
} catch {
  fail();
}
