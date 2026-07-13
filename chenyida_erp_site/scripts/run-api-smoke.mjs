import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { assertSafeTestTarget, redactSensitiveText } from "./environment.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const vinextCli = join(siteRoot, "node_modules", "vinext", "dist", "cli.js");
const smokeScript = join(siteRoot, "tests", "erp-api-smoke.mjs");
const wranglerCli = join(siteRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function randomId() {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function allocatePort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return port;
}

function collectOutput(child, chunks) {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      chunks.push(String(chunk));
      if (chunks.join("").length > 1_000_000) chunks.splice(0, chunks.length - 20);
    });
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveWait) => setTimeout(resolveWait, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForSite(url, child) {
  let lastError = "site did not respond";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`local test site exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/session`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`local test site was not ready: ${lastError}`);
}

function failureDiagnostic(error, serverOutput, source) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const safeServerLines = redactSensitiveText(serverOutput.join(""), source)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter((line) => line)
    .slice(-120)
    .join("\n");
  return `${redactSensitiveText(message, source)}\n\nLocal runtime diagnostics (request and response bodies omitted):\n${safeServerLines}\n`;
}

async function main() {
  const requestedEnvironment = String(process.env.ERP_ENV || "test").toLowerCase();
  if (requestedEnvironment !== "test") {
    throw new Error(`Refusing API smoke test because ERP_ENV is ${requestedEnvironment}; use ERP_ENV=test`);
  }

  const runId = randomId();
  const tempRoot = await mkdtemp(join(tmpdir(), "chenyida-erp-test-"));
  const d1Path = join(tempRoot, "d1");
  const port = await allocatePort();
  const siteUrl = `http://localhost:${port}`;
  const testPassword = `Test-${runId}-Pass!`;
  const setupToken = `setup-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const env = {
    ...process.env,
    ERP_ENV: "test",
    ERP_DATABASE: "ephemeral-miniflare-d1",
    ERP_API_URL: `${siteUrl}/api`,
    ERP_SITE_URL: siteUrl,
    ERP_TEST_URL: siteUrl,
    ERP_LOG_LEVEL: "info",
    ERP_DEBUG: "false",
    ERP_D1_PERSIST_PATH: d1Path,
    ERP_VITE_ENV_DIR: tempRoot,
    ERP_SETUP_TOKEN: setupToken,
    ERP_TEST_SETUP_TOKEN: setupToken,
    ERP_TEST_USERNAME: "admin",
    ERP_TEST_PASSWORD: testPassword,
    WRANGLER_LOG_PATH: join(tempRoot, "logs", "wrangler.log"),
    MINIFLARE_REGISTRY_PATH: join(tempRoot, "registry"),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  };
  assertSafeTestTarget(env);

  let server;
  const serverOutput = [];
  try {
    await mkdir(join(tempRoot, "logs"), { recursive: true });
    const d1Config = join(tempRoot, "wrangler.jsonc");
    await writeFile(d1Config, JSON.stringify({
      name: "chenyida-erp-api-smoke",
      compatibility_date: "2026-07-14",
      d1_databases: [{
        binding: "DB",
        database_name: "site-creator-d1",
        database_id: "00000000-0000-4000-8000-000000000000",
        migrations_dir: join(siteRoot, "drizzle"),
      }],
    }), "utf8");
    const migrate = spawnSync(process.execPath, [
      wranglerCli, "d1", "migrations", "apply", "DB", "--config", d1Config,
      "--local", "--persist-to", d1Path,
    ], { cwd: siteRoot, env, windowsHide: true, encoding: "utf8" });
    if (migrate.status !== 0) throw new Error(`isolated D1 migration failed with code ${migrate.status}`);
    const seedSql = `
      INSERT INTO material_categories(id,category_code,category_name_cn,category_level,status,created_by,updated_by,request_id)
      VALUES(9901,'FR4_SMOKE','FR4烟测',4,'ACTIVE','test','test','smoke-seed');
      INSERT INTO material_attribute_definitions(id,attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values_json,normalization_rule,status,created_by,updated_by,request_id)
      VALUES(9911,'THICKNESS','厚度','DECIMAL',3,'mm','[]','DECIMAL_SCALE','ACTIVE','test','test','smoke-seed');
      INSERT INTO material_category_attributes(id,category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,updated_by,request_id)
      VALUES(9921,9901,9911,1,1,1,10,'ACTIVE','test','test','smoke-seed');
      INSERT INTO material_code_rules(id,rule_code,rule_name,category_id,prefix,major_segment,minor_segment,separator,sequence_width,next_sequence,status,effective_from,version,approved_by,approved_at,created_by,updated_by,request_id)
      VALUES(9931,'FR4-SMOKE-CODE','FR4烟测编码',9901,'CYD','PCB','FR4','-',6,1,'ACTIVE','2026-01-01',1,'test',CURRENT_TIMESTAMP,'test','test','smoke-seed');
    `;
    const seed = spawnSync(process.execPath, [
      wranglerCli, "d1", "execute", "DB", "--config", d1Config, "--local",
      "--persist-to", d1Path, "--command", seedSql,
    ], { cwd: siteRoot, env, windowsHide: true, encoding: "utf8" });
    if (seed.status !== 0) throw new Error(`isolated D1 metadata seed failed with code ${seed.status}`);
    server = spawn(process.execPath, [vinextCli, "dev", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: siteRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    collectOutput(server, serverOutput);
    await waitForSite(siteUrl, server);

    const smoke = spawn(process.execPath, [smokeScript], {
      cwd: siteRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const smokeOutput = [];
    collectOutput(smoke, smokeOutput);
    const [exitCode] = await once(smoke, "exit");
    if (exitCode !== 0) {
      throw new Error(`API smoke assertions failed with exit code ${exitCode}; response bodies were not retained`);
    }
    process.stdout.write(smokeOutput.join(""));
  } catch (error) {
    const logDir = join(siteRoot, "work", "test-logs");
    await mkdir(logDir, { recursive: true });
    const logPath = join(logDir, `erp-api-smoke-${runId}.log`);
    await writeFile(logPath, failureDiagnostic(error, serverOutput, env), "utf8");
    throw new Error(`${error instanceof Error ? error.message : error}. Sanitized diagnostics: ${logPath}`);
  } finally {
    await stopChild(server);
    if (!basename(tempRoot).startsWith("chenyida-erp-test-")) {
      throw new Error("Refusing to clean an unmarked test directory");
    }
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
