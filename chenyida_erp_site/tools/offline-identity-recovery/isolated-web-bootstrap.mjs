Error.stackTraceLimit = 0;

function fail() {
  process.stderr.write("STAGE ISOLATED_WEB FAIL RECOVERY_REHEARSAL_WEB_BOOTSTRAP_REJECTED\n");
  process.exit(2);
}

try {
  const database = process.env.RECOVERY_EXPECTED_DATABASE || "";
  if (!/^cyd_oir_test_[0-9a-f]{12}$/.test(database)
    || process.env.ERP_ENV !== "test"
    || process.env.ERP_DEPLOYMENT_CLASS !== "test"
    || process.env.ERP_PUBLIC_ORIGIN !== "http://127.0.0.1:3000") fail();
  const url = new URL(process.env.DATABASE_URL || "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "postgres"
    || !["", "5432"].includes(url.port)
    || decodeURIComponent(url.username) !== "chenyida_erp"
    || decodeURIComponent(url.pathname.slice(1)) !== "chenyida_erp"
    || !url.password || url.search || url.hash) fail();
  url.pathname = `/${database}`;
  process.env.DATABASE_URL = url.toString();
  process.chdir("/webapp");
  await import("/webapp/server.js");
} catch {
  fail();
}
