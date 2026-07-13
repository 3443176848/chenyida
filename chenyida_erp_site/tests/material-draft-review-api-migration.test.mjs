import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const wrangler = join(siteRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function runWrangler(context, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [wrangler, ...args, "--config", context.config, "--local", "--persist-to", context.persistTo], {
    cwd: siteRoot,
    encoding: "utf8",
    env: { ...process.env, ERP_ENV: "test" },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (expectedStatus === "nonzero") assert.notEqual(result.status, 0, output);
  else assert.equal(result.status, expectedStatus, output);
  return output;
}

function parseJsonOutput(output) {
  const start = output.indexOf("[");
  assert.notEqual(start, -1, output);
  return JSON.parse(output.slice(start));
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chenyida-material-api-migration-test-"));
  const migrations = join(root, "migrations");
  const persistTo = join(root, "d1");
  await mkdir(migrations);
  await cp(join(siteRoot, "drizzle", "0000_far_nightmare.sql"), join(migrations, "0000_far_nightmare.sql"));
  await cp(join(siteRoot, "drizzle", "0001_material_master_v2.sql"), join(migrations, "0001_material_master_v2.sql"));
  const config = join(root, "wrangler.jsonc");
  await writeFile(config, JSON.stringify({
    name: "material-api-migration-test",
    compatibility_date: "2026-07-14",
    d1_databases: [{ binding: "DB", database_name: "material-api-migration-test", database_id: "local-test-only", migrations_dir: migrations }],
  }), "utf8");
  return { root, migrations, persistTo, config };
}

async function query(context, sql, expectedStatus = 0) {
  const output = runWrangler(context, ["d1", "execute", "DB", "--command", sql, "--json"], expectedStatus);
  return expectedStatus === 0 ? parseJsonOutput(output)[0].results : output;
}

test("Material API 0002 upgrades existing data, enforces constraints, rolls back empty state and re-applies", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    runWrangler(context, ["d1", "migrations", "apply", "DB"]);
    await query(context, `INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('manager1','经理','manager','test',1,0,1)`);
    await query(context, `INSERT INTO audit_log(username,action,detail,request_id,result) VALUES('manager1','旧审计','legacy','legacy-request','success')`);

    await cp(join(siteRoot, "drizzle", "0002_material_draft_review_api.sql"), join(context.migrations, "0002_material_draft_review_api.sql"));
    runWrangler(context, ["d1", "migrations", "apply", "DB"]);
    assert.match(runWrangler(context, ["d1", "migrations", "apply", "DB"]), /No migrations to apply/i);

    const tables = (await query(context, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((row) => row.name);
    assert.ok(tables.includes("material_api_idempotency"));
    assert.ok(tables.includes("material_api_rate_limit_buckets"));
    const auditColumns = await query(context, "PRAGMA table_info(audit_log)");
    for (const name of ["route_code", "material_id", "operation_id", "idempotency_key_digest", "old_version", "new_version", "error_code", "retention_until"]) {
      assert.ok(auditColumns.some((column) => column.name === name), `missing audit column ${name}`);
    }
    const legacy = await query(context, "SELECT route_code, operation_id, retention_until FROM audit_log WHERE request_id='legacy-request'");
    assert.deepEqual(legacy[0], { route_code: "", operation_id: "", retention_until: 0 });

    const invalidDigest = await query(context, `INSERT INTO material_api_idempotency(username,method,route_scope,key_digest,request_digest,operation_id,state,lease_token_digest,lease_expires_at,created_at,updated_at) VALUES('manager1','POST','/api/material-master/drafts','bad','bad','00000000-0000-4000-8000-000000000000','PENDING','bad',1,'2026-07-14T00:00:00Z','2026-07-14T00:00:00Z')`, "nonzero");
    assert.match(invalidDigest, /material_api_idempotency_digest_ck/);
    const invalidRate = await query(context, `INSERT INTO material_api_rate_limit_buckets(username,bucket_start,attempt_count,new_key_count,rejected_count,created_at,updated_at) VALUES('manager1',1,61,0,0,'2026-07-14T00:00:00Z','2026-07-14T00:00:00Z')`, "nonzero");
    assert.match(invalidRate, /material_api_rate_limit_counts_ck/);

    await query(context, "DELETE FROM audit_log WHERE route_code <> '' OR operation_id <> ''");
    const down = join(context.root, "0002.down.sql");
    await writeFile(down, await readFile(join(siteRoot, "drizzle", "rollback", "0002_material_draft_review_api.down.sql"), "utf8"), "utf8");
    runWrangler(context, ["d1", "execute", "DB", "--file", down]);
    const afterDown = (await query(context, "SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    assert.ok(!afterDown.includes("material_api_idempotency"));
    assert.ok(!afterDown.includes("material_api_rate_limit_buckets"));
    assert.ok((await query(context, "PRAGMA table_info(audit_log)")).every((column) => !["route_code", "operation_id"].includes(column.name)));
    assert.equal((await query(context, "SELECT detail FROM audit_log WHERE request_id='legacy-request'"))[0].detail, "legacy");

    await query(context, "DELETE FROM d1_migrations WHERE name='0002_material_draft_review_api.sql'");
    runWrangler(context, ["d1", "migrations", "apply", "DB"]);
    const afterReapply = (await query(context, "SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    assert.ok(afterReapply.includes("material_api_idempotency"));
  } finally {
    assert.match(context.root, /chenyida-material-api-migration-test-/);
    await rm(context.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  }
});
