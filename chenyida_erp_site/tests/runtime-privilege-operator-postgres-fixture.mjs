import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseStrictJson } from "../scripts/backup-recovery-contract.mjs";
import {
  buildRuntimePrivilegeOperatorTransactionInput,
  disposeRuntimePrivilegeOperatorCredentials,
  loadRuntimePrivilegeOperatorSources,
  readRuntimePrivilegeOperatorCredentials,
} from "../scripts/postgresql-runtime-privilege-operator.mjs";
import {
  createControlledRuntimePrivilegeBootstrapPlan,
  createRuntimePrivilegeReconciliationPlan,
} from "../scripts/postgresql-runtime-privilege-reconciler.mjs";


const ROLES = Object.freeze([
  "chenyida_erp_admin",
  "chenyida_erp_backup",
  "chenyida_erp_owner",
  "chenyida_erp_web",
  "chenyida_erp_worker",
]);
const ROOT_PATTERN = /^\/tmp\/cyd-runtime-privilege-catalog-postgres\.[A-Za-z0-9]+$/;
const MARKER = ".chenyida-erp-credential-root-v2";
const MARKER_VALUE = "chenyida-erp-credential-root/v2\n";

function reject() {
  throw new Error("RUNTIME_PRIVILEGE_OPERATOR_POSTGRES_FIXTURE_INVALID");
}

function inside(root, candidate) {
  const resolved = path.resolve(candidate);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) reject();
  return resolved;
}

async function main(argumentsList) {
  if (process.env.NODE_ENV !== "test" || process.env.ERP_RUNTIME_PRIVILEGE_CATALOG_POSTGRES_CONTAINER_MODE !== "YES"
    || argumentsList.length !== 4 || !["create-transaction", "create-reconcile-transaction"].includes(argumentsList[0])) reject();
  const reconcile = argumentsList[0] === "create-reconcile-transaction";
  const generation = reconcile ? "isolated-pg17-reconcile-credential-generation" : "isolated-pg17-bootstrap-credential-generation";
  const taskRoot = await realpath(path.dirname(argumentsList[1])).catch(reject);
  if (!ROOT_PATTERN.test(taskRoot)) reject();
  const baselineFile = inside(taskRoot, argumentsList[1]);
  const credentialRoot = inside(taskRoot, argumentsList[2]);
  const transactionFile = inside(taskRoot, argumentsList[3]);
  const baseline = parseStrictJson(await readFile(baselineFile, "utf8"), 32 * 1024 * 1024);
  const runtimeSecretRoot = path.join(credentialRoot, "runtime-secrets");
  const backupCredentialRoot = path.join(credentialRoot, "backup-credentials");
  await mkdir(credentialRoot, { mode: 0o700 });
  await mkdir(runtimeSecretRoot, { mode: 0o700 });
  await mkdir(backupCredentialRoot, { mode: 0o700 });
  await writeFile(path.join(backupCredentialRoot, MARKER), MARKER_VALUE, { mode: 0o400, flag: "wx" });
  const values = [];
  const secretNames = Object.freeze({
    chenyida_erp_admin: "admin-database-password",
    chenyida_erp_owner: "migration-database-password",
    chenyida_erp_web: "web-database-password",
    chenyida_erp_worker: "worker-database-password",
  });
  const parts = [];
  let servicePrefix;
  let serviceSource;
  try {
    for (const role of [...ROLES, "admin_application", "postgres_bootstrap"]) {
      let value;
      do { value = randomBytes(32).toString("base64url"); }
      while (new Set(value).size < 16 || values.includes(value));
      values.push(value);
      parts.push(Buffer.from(value, "ascii"));
    }
    try {
      for (const [role, name] of Object.entries(secretNames)) {
        const file = path.join(runtimeSecretRoot, name);
        await writeFile(file, Buffer.concat([parts[ROLES.indexOf(role)], Buffer.from("\n")]), { mode: 0o400, flag: "wx" });
        await chmod(file, 0o400);
      }
      for (const [name, index] of [["admin-password", 5], ["postgres-bootstrap-password", 6]]) {
        const file = path.join(runtimeSecretRoot, name);
        await writeFile(file, Buffer.concat([parts[index], Buffer.from("\n")]), { mode: 0o400, flag: "wx" });
        await chmod(file, 0o400);
      }
      const backupService = "backup_capture";
      const backupServiceFile = path.join(backupCredentialRoot, "pg_capture_service.conf");
      servicePrefix = Buffer.from(`[${backupService}]\nhost=127.0.0.1\nport=5432\ndbname=chenyida_erp\nuser=chenyida_erp_backup\npassword=`, "ascii");
      serviceSource = Buffer.concat([servicePrefix, parts[1], Buffer.from("\n")]);
      await writeFile(backupServiceFile, serviceSource, { mode: 0o400, flag: "wx" });
      await chmod(backupServiceFile, 0o400);
      const loaded = await loadRuntimePrivilegeOperatorSources();
      const sources = { policy: loaded.runtimePolicy, access: loaded.access, catalog: loaded.catalog };
      const plan = reconcile
        ? createRuntimePrivilegeReconciliationPlan(baseline, sources)
        : createControlledRuntimePrivilegeBootstrapPlan(baseline, sources);
      if (reconcile && (!plan.no_op || plan.statements.length !== 0)) reject();
      let binding;
      let transaction;
      try {
        binding = await readRuntimePrivilegeOperatorCredentials({
          runtimeSecretRoot,
          backupCredentialRoot,
          backupCaptureServiceFile: backupServiceFile,
          backupCaptureService: backupService,
          expectedDatabase: "chenyida_erp",
          credentialGenerationId: generation,
          evidenceScope: "SYNTHETIC_TEST_ONLY",
        });
        transaction = buildRuntimePrivilegeOperatorTransactionInput(plan, binding, { baseline, sources, operation: reconcile ? "RECONCILE" : "BOOTSTRAP" });
        await writeFile(transactionFile, transaction, { mode: 0o600, flag: "wx" });
        await chmod(transactionFile, 0o600);
      } finally {
        transaction?.fill(0);
        if (binding) disposeRuntimePrivilegeOperatorCredentials(binding);
      }
    } finally {
      serviceSource?.fill(0);
      servicePrefix?.fill(0);
    }
  } finally {
    for (const part of parts) part.fill(0);
    values.fill("");
  }
  process.stdout.write("RUNTIME_PRIVILEGE_OPERATOR_POSTGRES_FIXTURE_READY\n");
}

main(process.argv.slice(2)).catch(() => {
  process.stderr.write("RUNTIME_PRIVILEGE_OPERATOR_POSTGRES_FIXTURE_INVALID\n");
  process.exitCode = 1;
});
