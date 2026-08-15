import { spawnSync } from "node:child_process";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalClusterJson,
  clusterSha256,
} from "./postgresql-cluster-recovery-contract.mjs";
import {
  loadReleaseManifest,
} from "./release-manifest-contract.mjs";
import {
  inspectPostDeployReadiness,
  inspectPostDeployRuntime,
  loadPostDeployRuntimePolicy,
  verifyAuthorizedComposeProjectRoot,
} from "./postdeploy-release-verifier.mjs";
import {
  assertUatPromotionActiveFenceTransferMatchesResult,
  assertUatPromotionComposeDeploymentResultMatchesIntent,
  createUatPromotionActiveFenceTransfer,
  createUatPromotionComposeDeploymentResult,
  createUatPromotionDatabaseHandoff,
  validateUatPromotionActiveFenceTransfer,
  validateUatPromotionComposeDeploymentResult,
  validateUatPromotionDatabaseHandoff,
} from "./uat-promotion-compose-deployment-contract.mjs";
import {
  UAT_PROMOTION_STATE_ROOT,
  validateUatPromotionComposeDeploymentIntent,
  validateUatPromotionContext,
} from "./uat-promotion-transaction-journal.mjs";
import { parseStrictJson } from "./release-identity-contract.mjs";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const RUNTIME_POLICY_FILE = path.join(SITE_ROOT, "operations/container-runtime-policy-v1.json");
const SHA256 = /^[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const MAX_BYTES = 4 * 1024 * 1024;
const SAFE_ENVIRONMENT = Object.freeze({
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent",
});
const SERVICES = Object.freeze(["caddy", "postgres", "web", "worker"]);
const INSPECT_FORMAT = '[{{json .Id}},{{json .Name}},{{json .Image}},{{json .Config.Image}},{{json (index .Config.Labels "com.docker.compose.project")}},{{json (index .Config.Labels "com.docker.compose.service")}},{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},{{json (index .Config.Labels "com.docker.compose.config-hash")}},{{json (index .Config.Labels "chenyida.erp.uat-deployment-operation")}},{{json (index .Config.Labels "chenyida.erp.uat-deployment-authorization")}},{{json .RestartCount}},{{json .State.OOMKilled}},{{json .State.Running}},{{json .State.Restarting}},{{json .State.Paused}},{{json .State.Dead}},{{json .State.Status}},{{json .State.ExitCode}},{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}}]';
const RESTORE_RUNTIME_SQL = String.raw`\set ON_ERROR_STOP on
begin;
select pg_catalog.pg_advisory_xact_lock(709401, 9);
create temporary table pg_temp.chenyida_erp_deployment_expected (
  database_oid text not null, system_identifier text not null, marker text not null
) on commit drop;
insert into pg_temp.chenyida_erp_deployment_expected values (
  :'expected_database_oid', :'expected_system_identifier', :'expected_marker'
);
do $handoff$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.oid::text is distinct from (select database_oid from pg_temp.chenyida_erp_deployment_expected)
     or (select system_identifier::text from pg_catalog.pg_control_system())
       is distinct from (select system_identifier from pg_temp.chenyida_erp_deployment_expected)
     or pg_catalog.shobj_description(target.oid,'pg_database')
       is distinct from (select marker from pg_temp.chenyida_erp_deployment_expected)
     or target.datallowconn is not false or target.datconnlimit<>0
     or not exists (select 1 from pg_catalog.pg_db_role_setting s cross join lateral unnest(s.setconfig) c
                    where s.setdatabase=target.oid and s.setrole=0 and c='default_transaction_read_only=on')
     or exists (select 1 from pg_catalog.pg_prepared_xacts where database='chenyida_erp')
     or exists (select 1 from pg_catalog.pg_stat_activity where datid=target.oid)
  then raise exception 'deployment fence handoff precondition failed'; end if;
end $handoff$;
alter database chenyida_erp allow_connections true;
alter database chenyida_erp connection limit 64;
alter database chenyida_erp reset default_transaction_read_only;
revoke connect,temporary on database chenyida_erp from public;
revoke connect,temporary,create on database chenyida_erp from
  chenyida_erp_admin,chenyida_erp_backup,chenyida_erp_web,chenyida_erp_worker,
  chenyida_erp_admin_priv,chenyida_erp_backup_priv,chenyida_erp_web_priv,chenyida_erp_worker_priv;
grant connect on database chenyida_erp to
  chenyida_erp_admin_priv,chenyida_erp_backup_priv,chenyida_erp_web_priv,chenyida_erp_worker_priv;
commit;
with target as (select * from pg_catalog.pg_database where datname='chenyida_erp'), expected_roles as (
  select unnest(array['chenyida_erp_admin','chenyida_erp_backup','chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker']::text[]) rolname
)
select pg_catalog.json_build_object(
  'database_name',t.datname::text,
  'database_system_identifier',(select system_identifier::text from pg_catalog.pg_control_system()),
  'database_oid',t.oid::text,
  'database_marker',pg_catalog.shobj_description(t.oid,'pg_database'),
  'database_allow_connections',t.datallowconn,
  'database_connection_limit',t.datconnlimit::integer,
  'default_transaction_read_only',case when exists(
    select 1 from pg_catalog.pg_db_role_setting s cross join lateral unnest(s.setconfig) c
    where s.setdatabase=t.oid and s.setrole=0 and c like 'default_transaction_read_only=%'
  ) then 'PRESENT' else 'RESET' end,
  'connect_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname)
    from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname
    where r.rolcanlogin and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')),array[]::text[]),
  'unknown_connect_login_count',(select count(*)::integer from pg_catalog.pg_roles r where r.rolcanlogin
    and not r.rolsuper and not exists(select 1 from expected_roles e where e.rolname=r.rolname)
    and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')),
  'prepared_transaction_count',(select count(*)::integer from pg_catalog.pg_prepared_xacts x where x.database=t.datname)
) from target t;
`;
const EMERGENCY_SEAL_SQL = String.raw`\set ON_ERROR_STOP on
select pg_catalog.pg_advisory_lock(709401, 9);
alter database chenyida_erp allow_connections false;
select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname='chenyida_erp' and pid<>pg_catalog.pg_backend_pid();
alter database chenyida_erp connection limit 0;
alter database chenyida_erp set default_transaction_read_only=on;
revoke connect on database chenyida_erp from public,
  chenyida_erp_admin,chenyida_erp_backup,chenyida_erp_web,chenyida_erp_worker,
  chenyida_erp_admin_priv,chenyida_erp_backup_priv,chenyida_erp_web_priv,chenyida_erp_worker_priv;
select pg_catalog.pg_advisory_unlock(709401, 9);
`;

export class UatPromotionComposeDeploymentControlError extends Error {
  constructor(code) { super(code); this.name = "UatPromotionComposeDeploymentControlError"; this.code = code; }
}

function reject(code) { throw new UatPromotionComposeDeploymentControlError(code); }
function physicalPath(logical, filesystemRoot) {
  return filesystemRoot === "/" ? logical : path.join(filesystemRoot, logical.slice(1));
}
function nowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) reject("COMPOSE_DEPLOYMENT_CONTROL_TIME_INVALID");
  return date.toISOString();
}
function operationArtifactMatches(name, operationId) {
  const matched = /^(.+)\.([0-9a-f]{64})\.json$/u.exec(name);
  return matched !== null && matched[1] === operationId;
}
function command(argumentsList, { input = undefined, timeout = 45_000, environment = {} } = {}) {
  const result = spawnSync("/usr/bin/docker", argumentsList, {
    input, encoding: null, timeout, maxBuffer: MAX_BYTES,
    env: { ...SAFE_ENVIRONMENT, ...environment }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.signal || !Buffer.isBuffer(result.stdout)) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_DOCKER_FAILED");
  }
  return result.stdout;
}
function parseLineJson(raw, expected, code) {
  const lines = raw.toString("utf8").trim().split("\n").filter(Boolean);
  if (lines.length !== expected) reject(code);
  return lines.map((line) => {
    try { return parseStrictJson(line, MAX_BYTES); } catch { reject(code); }
  });
}
function stableServiceIdentity(service) {
  return {
    service: service.service, container_id: service.container_id, container_name: service.container_name,
    image_id: service.image_id, image_reference: service.image_reference,
    compose_config_sha256: service.compose_config_sha256,
  };
}
function normalizeInspect(fields, expectedService) {
  if (!Array.isArray(fields) || fields.length !== 19) reject("COMPOSE_DEPLOYMENT_CONTROL_RUNTIME_INVALID");
  const [containerId, rawName, imageId, imageReference, project, service, projectRoot, configSha256,
    deploymentOperation, deploymentAuthorization, restartCount, oomKilled, running, restarting, paused,
    dead, status, exitCode, healthValue] = fields;
  const containerName = typeof rawName === "string" && rawName.startsWith("/") ? rawName.slice(1) : rawName;
  if (!CONTAINER_ID.test(containerId || "") || service !== expectedService
    || !SHA256.test(configSha256 || "") || !Number.isSafeInteger(restartCount)) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_RUNTIME_INVALID");
  }
  return Object.freeze({
    service, container_id: containerId, container_name: containerName, image_id: imageId,
    image_reference: imageReference, compose_project: project, compose_project_root: projectRoot,
    compose_config_sha256: configSha256, deployment_operation: deploymentOperation,
    deployment_authorization: deploymentAuthorization, restart_count: restartCount,
    oom_killed: oomKilled, running, restarting, paused, dead, status, exit_code: exitCode,
    health: healthValue === null ? "none" : healthValue,
  });
}
function inspectServices(selectors) {
  const rows = parseLineJson(
    command(["inspect", "--format", INSPECT_FORMAT, "--", ...SERVICES.map((service) => selectors[service])]),
    SERVICES.length, "COMPOSE_DEPLOYMENT_CONTROL_RUNTIME_INVALID",
  );
  return Object.freeze(Object.fromEntries(rows.map((row, index) => {
    const service = SERVICES[index]; return [service, normalizeInspect(row, service)];
  })));
}
function assertBeforeRuntime(services, parameters) {
  const expected = {
    caddy: [parameters.caddy_container_id, parameters.caddy_container, parameters.caddy_image_digest],
    postgres: [parameters.postgres_container_id, parameters.postgres_container, parameters.postgres_image_digest],
    web: [parameters.old_web_container_id, parameters.web_container, parameters.old_web_image_digest],
    worker: [parameters.old_worker_container_id, parameters.worker_container, parameters.old_worker_image_digest],
  };
  for (const service of SERVICES) {
    const value = services[service]; const [id, name, image] = expected[service];
    if (value.container_id !== id || value.container_name !== name || value.image_id !== image
      || value.compose_project !== parameters.compose_project
      || value.compose_project_root !== parameters.compose_project_root
      || value.oom_killed !== false || value.restart_count !== 0 || value.restarting !== false
      || value.paused !== false || value.dead !== false) reject("COMPOSE_DEPLOYMENT_CONTROL_BEFORE_RUNTIME_INVALID");
  }
  if (services.caddy.running !== true || services.caddy.health !== "none"
    || services.postgres.running !== true || services.postgres.health !== "healthy"
    || services.web.running !== false || services.web.status !== "exited" || services.web.exit_code !== 0
    || services.worker.running !== false || services.worker.status !== "exited" || services.worker.exit_code !== 0) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_BEFORE_RUNTIME_INVALID");
  }
}
function psql(parameters, sql) {
  return command([
    "exec", "--interactive", "--user", "postgres", "--", parameters.postgres_container_id,
    "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--username", "postgres", "--dbname", "postgres",
    "--quiet", "--tuples-only", "--no-align", "--set", `expected_database_oid=${parameters.database_oid}`,
    "--set", `expected_system_identifier=${parameters.database_system_identifier}`,
    "--set", `expected_marker=${parameters.database_marker}`, "--file", "-",
  ], { input: Buffer.from(sql), timeout: 60_000 });
}

function composeCommand(parameters, subcommand, environment = {}) {
  return command([
    "compose", "--project-name", parameters.compose_project,
    "--project-directory", parameters.compose_project_root,
    "--env-file", parameters.deployment_environment,
    "--file", parameters.compose_file_source.path,
    "--file", parameters.compose_release_file_source.path,
    ...subcommand,
  ], { timeout: 120_000, environment });
}

async function waitForHealthy(selectors, maximumAttempts = 60) {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const services = inspectServices(selectors);
    if (services.web.running === true && services.web.health === "healthy"
      && services.worker.running === true && services.worker.health === "healthy") return services;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  reject("COMPOSE_DEPLOYMENT_CONTROL_HEALTH_TIMEOUT");
}

async function protectedInventory(parameters, policy) {
  const networkNames = [parameters.backend_network, parameters.edge_network];
  const networkRows = parseLineJson(
    command(["network", "inspect", "--format", '[{{json .Id}},{{json .Name}},{{json .Driver}},{{json .Scope}}]', "--", ...networkNames]),
    2, "COMPOSE_DEPLOYMENT_CONTROL_PROTECTED_RUNTIME_INVALID",
  );
  const volumeNames = policy.volume_names.map((name) => `${parameters.compose_project}_${name}`);
  const volumeRows = parseLineJson(
    command(["volume", "inspect", "--format", '[{{json .Name}},{{json .Driver}},{{json .Scope}},{{json .CreatedAt}}]', "--", ...volumeNames]),
    volumeNames.length, "COMPOSE_DEPLOYMENT_CONTROL_PROTECTED_RUNTIME_INVALID",
  );
  return Object.freeze({ networks: networkRows, volumes: volumeRows });
}

export async function createProductionComposeDeploymentAdapter(context, intent) {
  const parameters = intent.parameters;
  let policy; let manifest;
  const strictResources = async () => {
    if (policy && manifest) return;
    policy = await loadPostDeployRuntimePolicy(RUNTIME_POLICY_FILE);
    verifyAuthorizedComposeProjectRoot({
      composeProjectRoot: parameters.compose_project_root, caddyfileSha256: policy.caddyfile_sha256,
    });
    manifest = await loadReleaseManifest({
      file: parameters.release_manifest, expectedSha256: parameters.release_manifest_sha256,
      now: new Date(parameters.deployment_created_at), requireEligible: true, trusted: true,
    });
  };
  let beforeServices; let beforeProtected;
  const selectorsBefore = {
    caddy: parameters.caddy_container_id, postgres: parameters.postgres_container_id,
    web: parameters.old_web_container_id, worker: parameters.old_worker_container_id,
  };
  return Object.freeze({
    async captureBefore() {
      await strictResources();
      beforeServices = inspectServices(selectorsBefore);
      assertBeforeRuntime(beforeServices, parameters);
      beforeProtected = await protectedInventory(parameters, policy);
      return Object.freeze({
        old_runtime_sha256: clusterSha256(SERVICES.map((service) => beforeServices[service])),
        protected_resources_before_sha256: clusterSha256({
          caddy: stableServiceIdentity(beforeServices.caddy),
          postgres: stableServiceIdentity(beforeServices.postgres), ...beforeProtected,
        }),
      });
    },
    async handoffDatabase() {
      const raw = psql(parameters, RESTORE_RUNTIME_SQL).toString("utf8").trim();
      let probe;
      try { probe = parseStrictJson(raw, 64 * 1024); } catch { reject("COMPOSE_DEPLOYMENT_CONTROL_DATABASE_HANDOFF_INVALID"); }
      const expectedRoles = [
        "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web",
        "chenyida_erp_worker",
      ];
      if (probe.database_name !== parameters.database_name
        || probe.database_system_identifier !== parameters.database_system_identifier
        || probe.database_oid !== parameters.database_oid || probe.database_marker !== parameters.database_marker
        || probe.database_allow_connections !== true || probe.database_connection_limit !== 64
        || probe.default_transaction_read_only !== "RESET"
        || canonicalClusterJson(probe.connect_roles) !== canonicalClusterJson(expectedRoles)
        || probe.unknown_connect_login_count !== 0 || probe.prepared_transaction_count !== 0) {
        reject("COMPOSE_DEPLOYMENT_CONTROL_DATABASE_HANDOFF_INVALID");
      }
      return createUatPromotionDatabaseHandoff({
        promotion_id: parameters.promotion_id, deployment_operation_id: context.operation_id,
        database_name: parameters.database_name,
        database_system_identifier: parameters.database_system_identifier, database_oid: parameters.database_oid,
        database_marker: parameters.database_marker, active_fence_sha256: parameters.active_migration_fence_sha256,
        released_baseline_sha256: intent.released_baseline_sha256,
        sealed_probe_sha256: intent.sealed_database_fence_sha256,
        runtime_probe_sha256: clusterSha256(probe), database_allow_connections: probe.database_allow_connections,
        database_connection_limit: probe.database_connection_limit,
        default_transaction_read_only: probe.default_transaction_read_only, connect_roles: probe.connect_roles,
        unknown_connect_login_count: probe.unknown_connect_login_count,
        prepared_transaction_count: probe.prepared_transaction_count, handed_off_at: new Date().toISOString(),
      });
    },
    async createRuntime() {
      await strictResources();
      const environment = {
        ERP_UAT_DEPLOYMENT_OPERATION_ID: context.operation_id,
        ERP_UAT_DEPLOYMENT_AUTHORIZATION_SHA256: context.execution_authorization_sha256,
      };
      composeCommand(parameters, [
        "create", "--no-build", "--pull", "never", "--force-recreate", "--no-deps", "web", "worker",
      ], environment);
      const webId = composeCommand(parameters, ["ps", "--all", "--quiet", "web"], environment).toString("ascii").trim();
      const workerId = composeCommand(parameters, ["ps", "--all", "--quiet", "worker"], environment).toString("ascii").trim();
      if (!CONTAINER_ID.test(webId) || !CONTAINER_ID.test(workerId) || webId === workerId
        || webId === parameters.old_web_container_id || workerId === parameters.old_worker_container_id) {
        reject("COMPOSE_DEPLOYMENT_CONTROL_CREATED_RUNTIME_INVALID");
      }
      const selectors = { caddy: parameters.caddy_container_id, postgres: parameters.postgres_container_id, web: webId, worker: workerId };
      const created = inspectServices(selectors);
      if (created.web.deployment_operation !== context.operation_id
        || created.worker.deployment_operation !== context.operation_id
        || created.web.deployment_authorization !== context.execution_authorization_sha256
        || created.worker.deployment_authorization !== context.execution_authorization_sha256
        || created.web.image_reference !== parameters.web_image
        || created.worker.image_reference !== parameters.worker_image
        || created.web.running !== false || created.worker.running !== false) {
        reject("COMPOSE_DEPLOYMENT_CONTROL_CREATED_RUNTIME_INVALID");
      }
      command(["start", "--", webId, workerId], { timeout: 60_000 });
      return Object.freeze({
        selectors, created_runtime_sha256: clusterSha256({ web: created.web, worker: created.worker }),
      });
    },
    async verifyRuntime(created) {
      await strictResources();
      await waitForHealthy(created.selectors);
      const expectedReferences = {
        caddy: policy.references.caddy, postgres: policy.references.postgres,
        web: parameters.web_image, worker: parameters.worker_image,
      };
      const runtime = inspectPostDeployRuntime({
        composeProject: parameters.compose_project, composeProjectRoot: parameters.compose_project_root,
        composeVersion: policy.compose_version, selectors: created.selectors, expectedReferences,
        expectedMounts: policy.mounts, expectedTmpfs: policy.tmpfs, expectedRuntime: policy.runtime,
        expectedVolumeNames: policy.volume_names, appEnvironmentKeys: policy.app_environment_keys,
        expectedVersion: manifest.source.package_version, expectedRevision: manifest.source.git_commit,
        expectedManifestSha256: parameters.release_manifest_sha256,
        expectedSupervisorBundleSha256: context.supervisor_bundle_sha256,
        expectedDeploymentClass: parameters.deployment_class, expectedDeploymentId: parameters.deployment_id,
        readerGid: parameters.reader_gid,
      });
      const readiness = inspectPostDeployReadiness(created.selectors.web);
      if (readiness.deployment_class !== parameters.deployment_class
        || readiness.deployment_id !== parameters.deployment_id
        || readiness.version !== manifest.source.package_version || readiness.revision !== manifest.source.git_commit
        || readiness.migration_head !== manifest.migrations.head
        || readiness.migration_manifest_sha256 !== manifest.migrations.allowlist_sha256) {
        reject("COMPOSE_DEPLOYMENT_CONTROL_READINESS_INVALID");
      }
      const afterServices = inspectServices(created.selectors);
      const afterProtected = await protectedInventory(parameters, policy);
      const protectedAfterSha256 = clusterSha256({
        caddy: stableServiceIdentity(afterServices.caddy),
        postgres: stableServiceIdentity(afterServices.postgres), ...afterProtected,
      });
      const serviceRecords = ["web", "worker"].map((service) => {
        const value = afterServices[service];
        return {
          service, container_id: value.container_id, container_name: value.container_name,
          image_id: value.image_id, image_reference: value.image_reference,
          compose_config_sha256: value.compose_config_sha256, running: value.running,
          health: value.health, restart_count: value.restart_count, oom_killed: value.oom_killed,
        };
      });
      const unchangedRecords = ["caddy", "postgres"].map((service) => {
        const before = beforeServices[service]; const after = afterServices[service];
        return {
          service, container_id: after.container_id, container_name: after.container_name,
          image_id: after.image_id, image_reference: after.image_reference,
          compose_config_sha256: after.compose_config_sha256,
          pre_identity_sha256: clusterSha256(stableServiceIdentity(before)),
          post_identity_sha256: clusterSha256(stableServiceIdentity(after)),
          restart_count: after.restart_count, oom_killed: after.oom_killed,
          running: after.running, health: after.health,
        };
      });
      return Object.freeze({
        services: serviceRecords, unchanged_services: unchangedRecords,
        created_runtime_sha256: created.created_runtime_sha256,
        committed_runtime_sha256: clusterSha256(runtime.services),
        protected_resources_after_sha256: protectedAfterSha256,
        runtime_configuration_sha256: runtime.runtime_configuration_sha256,
        readiness_sha256: clusterSha256(readiness), completed_at: new Date().toISOString(),
      });
    },
    async emergencyContainment() {
      let databaseSealed = false; let stopped = [];
      try { psql(parameters, EMERGENCY_SEAL_SQL); databaseSealed = true; }
      catch { databaseSealed = false; }
      const raw = command([
        "ps", "--all", "--quiet", "--no-trunc",
        "--filter", `label=com.docker.compose.project=${parameters.compose_project}`,
        "--filter", `label=chenyida.erp.uat-deployment-operation=${context.operation_id}`,
        "--filter", `label=chenyida.erp.uat-deployment-authorization=${context.original_authorization_sha256}`,
      ]).toString("ascii").trim();
      const ids = raw === "" ? [] : raw.split("\n");
      if (ids.some((id) => !CONTAINER_ID.test(id)) || ids.length > 2) reject("COMPOSE_DEPLOYMENT_CONTROL_CONTAINMENT_FAILED");
      if (ids.length > 0) {
        command(["stop", "--time", "20", "--", ...ids], { timeout: 60_000 }); stopped = ids;
      }
      if (!databaseSealed) reject("COMPOSE_DEPLOYMENT_CONTROL_CONTAINMENT_FAILED");
      return Object.freeze({ database_sealed: true, stopped_container_ids: stopped.sort() });
    },
  });
}

async function trustedIntent(context, expectedIntentSha256, filesystemRoot) {
  const file = physicalPath(
    `${UAT_PROMOTION_STATE_ROOT}/intents/${context.operation_id}.${expectedIntentSha256}.json`,
    filesystemRoot,
  );
  const before = await lstat(file, { bigint: true }).catch(() => reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_INVALID"));
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n
    || before.nlink !== 1n || (before.mode & 0o7777n) !== 0o400n || before.size < 2n
    || before.size > BigInt(MAX_BYTES)) reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_INVALID");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_INVALID"));
  try {
    const opened = await handle.stat({ bigint: true }); const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_CHANGED");
    }
    let value;
    try { value = validateUatPromotionComposeDeploymentIntent(parseStrictJson(raw.toString("utf8"), MAX_BYTES)); }
    catch { reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_INVALID"); }
    if (raw.toString("utf8") !== canonicalClusterJson(value)
      || value.deployment_operation_id !== context.operation_id
      || value.compose_deployment_intent_sha256 !== expectedIntentSha256
      || value.execution_authorization_sha256 !== context.original_authorization_sha256) {
      reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_BINDING_INVALID");
    }
    return value;
  } finally { await handle.close(); }
}

async function ensureExecutionRoot(context, intent, filesystemRoot, recovery) {
  const parent = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/executions`, filesystemRoot);
  const parentMetadata = await lstat(parent, { bigint: true }).catch(() => reject("COMPOSE_DEPLOYMENT_CONTROL_STATE_INVALID"));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || parentMetadata.uid !== 0n
    || parentMetadata.gid !== 0n || (parentMetadata.mode & 0o7777n) !== 0o700n) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_STATE_INVALID");
  }
  const root = path.join(parent, `${context.operation_id}.${intent.compose_deployment_intent_sha256}`);
  try {
    await mkdir(root, { mode: 0o700 }); await chown(root, 0, 0); await chmod(root, 0o700);
  } catch (error) {
    if (error?.code !== "EEXIST" || !recovery) reject("COMPOSE_DEPLOYMENT_CONTROL_EXECUTION_ALREADY_EXISTS");
  }
  const metadata = await lstat(root, { bigint: true }).catch(() => reject("COMPOSE_DEPLOYMENT_CONTROL_STATE_INVALID"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== 0n
    || (metadata.mode & 0o7777n) !== 0o700n) reject("COMPOSE_DEPLOYMENT_CONTROL_STATE_INVALID");
  return root;
}

async function immutableJson(file, value, validator = (item) => item) {
  const raw = Buffer.from(canonicalClusterJson(value));
  let handle;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(raw); await handle.chown(0, 0); await handle.chmod(0o400); await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") reject("COMPOSE_DEPLOYMENT_CONTROL_ARTIFACT_INVALID");
  } finally { await handle?.close().catch(() => undefined); }
  const stored = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("COMPOSE_DEPLOYMENT_CONTROL_ARTIFACT_INVALID"));
  try {
    const metadata = await stored.stat({ bigint: true }); const existing = await stored.readFile();
    if (metadata.uid !== 0n || metadata.gid !== 0n || metadata.nlink !== 1n
      || (metadata.mode & 0o7777n) !== 0o400n || !existing.equals(raw)) reject("COMPOSE_DEPLOYMENT_CONTROL_ARTIFACT_INVALID");
    try { validator(parseStrictJson(existing.toString("utf8"), MAX_BYTES)); }
    catch { reject("COMPOSE_DEPLOYMENT_CONTROL_ARTIFACT_INVALID"); }
  } finally { await stored.close(); }
}

async function existingCompletion(context, intent, filesystemRoot) {
  const resultRoot = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/results`, filesystemRoot);
  const transferRoot = physicalPath(`${UAT_PROMOTION_STATE_ROOT}/fence-transfers`, filesystemRoot);
  const resultNames = (await readdir(resultRoot)).filter((name) => operationArtifactMatches(name, context.operation_id));
  const transferNames = (await readdir(transferRoot)).filter((name) => operationArtifactMatches(name, context.operation_id));
  if (resultNames.length === 0 && transferNames.length === 0) return null;
  if (resultNames.length !== 1 || transferNames.length !== 1) return Object.freeze({ partial: true });
  const load = async (file, validator) => {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("COMPOSE_DEPLOYMENT_CONTROL_COMPLETION_INVALID"));
    try {
      const metadata = await handle.stat({ bigint: true }); const raw = await handle.readFile();
      if (metadata.uid !== 0n || metadata.gid !== 0n || metadata.nlink !== 1n || (metadata.mode & 0o7777n) !== 0o400n) reject("COMPOSE_DEPLOYMENT_CONTROL_COMPLETION_INVALID");
      return validator(parseStrictJson(raw.toString("utf8"), MAX_BYTES));
    } finally { await handle.close(); }
  };
  const result = await load(path.join(resultRoot, resultNames[0]), validateUatPromotionComposeDeploymentResult);
  const transfer = await load(path.join(transferRoot, transferNames[0]), validateUatPromotionActiveFenceTransfer);
  assertUatPromotionComposeDeploymentResultMatchesIntent(result, intent);
  assertUatPromotionActiveFenceTransferMatchesResult(transfer, result, intent);
  if (result.deployment_operation_id !== context.operation_id || result.result_sha256 !== transfer.deployment_result_sha256
    || transfer.deployment_operation_id !== context.operation_id
    || result.execution_authorization_sha256 !== intent.execution_authorization_sha256
    || !resultNames[0].endsWith(`.${result.result_sha256}.json`)
    || !transferNames[0].endsWith(`.${transfer.transfer_sha256}.json`)) return Object.freeze({ partial: true });
  return Object.freeze({ partial: false, result, transfer });
}

export async function runUatPromotionComposeDeploymentControl(contextInput, phase, options = {}) {
  const context = validateUatPromotionContext(contextInput);
  if (context.operation !== "COMPOSE_DEPLOYMENT" || !new Set(["execute", "recover"]).has(phase)
    || phase === "execute" && context.execution_mode !== "ORIGINAL"
    || phase === "recover" && context.execution_mode !== "RECOVERY") {
    reject("COMPOSE_DEPLOYMENT_CONTROL_CONTEXT_INVALID");
  }
  const filesystemRoot = path.resolve(options.filesystemRoot || "/");
  if (filesystemRoot !== "/" && options.allowTestRoot !== true) reject("COMPOSE_DEPLOYMENT_CONTROL_TEST_ROOT_NOT_EXPLICIT");
  const expectedIntentSha256 = options.expectedIntentSha256 ?? context.expected_intent_sha256;
  if (typeof expectedIntentSha256 !== "string" || !SHA256.test(expectedIntentSha256)) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_BINDING_INVALID");
  }
  if (context.execution_mode === "RECOVERY" && context.expected_intent_sha256 !== expectedIntentSha256) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_BINDING_INVALID");
  }
  const intent = options.intent ?? await trustedIntent(context, expectedIntentSha256, filesystemRoot);
  if (options.intent && (options.allowTestRoot !== true || filesystemRoot === "/")) reject("COMPOSE_DEPLOYMENT_CONTROL_TEST_INJECTION_NOT_EXPLICIT");
  validateUatPromotionComposeDeploymentIntent(intent);
  if (intent.deployment_operation_id !== context.operation_id
    || intent.compose_deployment_intent_sha256 !== expectedIntentSha256
    || intent.execution_authorization_sha256 !== context.original_authorization_sha256) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_INTENT_BINDING_INVALID");
  }
  const root = await ensureExecutionRoot(context, intent, filesystemRoot, phase === "recover");
  let completion;
  try { completion = await existingCompletion(context, intent, filesystemRoot); }
  catch (cause) {
    if (phase !== "recover") throw cause;
    completion = Object.freeze({ partial: true });
  }
  const adapter = options.adapter ?? await createProductionComposeDeploymentAdapter(context, intent);
  if (options.adapter && (options.allowTestRoot !== true || filesystemRoot === "/")) reject("COMPOSE_DEPLOYMENT_CONTROL_TEST_INJECTION_NOT_EXPLICIT");
  if (phase === "recover") {
    if (completion && !completion.partial) return Object.freeze({
      result: "COMPOSE_DEPLOYMENT_ALREADY_COMPLETED", promotion_id: intent.promotion_id,
      deployment_result_sha256: completion.result.result_sha256,
      fence_transfer_sha256: completion.transfer.transfer_sha256,
    });
    const containment = await adapter.emergencyContainment();
    const body = {
      schema_version: 1, contract: "chenyida-erp-uat-promotion-compose-deployment-containment/v1",
      status: "CONTAINED_FOR_JOURNAL_QUARANTINE", promotion_id: intent.promotion_id,
      deployment_operation_id: intent.deployment_operation_id,
      recovery_authorization_sha256: context.execution_authorization_sha256,
      database_sealed: containment.database_sealed,
      stopped_container_ids: containment.stopped_container_ids,
      contained_at: nowIso(options.now),
    };
    const record = Object.freeze({ ...body, containment_sha256: clusterSha256(body) });
    await immutableJson(path.join(root, `containment.${context.execution_authorization_sha256}.json`), record);
    return Object.freeze({ result: record.status, promotion_id: intent.promotion_id, containment_sha256: record.containment_sha256 });
  }
  if (completion !== null) reject("COMPOSE_DEPLOYMENT_CONTROL_OPERATION_ALREADY_HAS_RESULT");
  const startedAt = nowIso(options.now);
  try {
    const before = await adapter.captureBefore();
    await immutableJson(path.join(root, "before-runtime.json"), before);
    const handoff = await adapter.handoffDatabase();
    await immutableJson(path.join(root, "database-handoff.json"), handoff, validateUatPromotionDatabaseHandoff);
    const created = await adapter.createRuntime();
    await immutableJson(path.join(root, "created-runtime.json"), created);
    const committed = await adapter.verifyRuntime(created);
    await immutableJson(path.join(root, "committed-runtime.json"), committed);
    if (committed.created_runtime_sha256 !== created.created_runtime_sha256
      || committed.protected_resources_after_sha256 !== before.protected_resources_before_sha256) {
      reject("COMPOSE_DEPLOYMENT_CONTROL_PROTECTED_RUNTIME_CHANGED");
    }
    const result = createUatPromotionComposeDeploymentResult({
      promotion_id: intent.promotion_id, deployment_operation_id: intent.deployment_operation_id,
      execution_authorization_sha256: intent.execution_authorization_sha256,
      supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
      release_manifest_sha256: intent.parameters.release_manifest_sha256,
      migration_operation_id: intent.migration_operation_id,
      migration_execution_authorization_sha256: intent.migration_execution_authorization_sha256,
      migration_grant_sha256: intent.migration_grant_sha256,
      migration_result_sha256: intent.migration_result_sha256,
      active_fence_sha256: intent.active_migration_fence_sha256,
      migration_fence_binding_sha256: intent.migration_fence_binding_sha256,
      migration_result_binding_sha256: intent.migration_result_binding_sha256,
      deployment_plan_sha256: intent.deployment_plan_sha256,
      compose_project: intent.parameters.compose_project,
      compose_project_root: intent.parameters.compose_project_root,
      old_runtime_sha256: before.old_runtime_sha256,
      created_runtime_sha256: committed.created_runtime_sha256,
      committed_runtime_sha256: committed.committed_runtime_sha256,
      protected_resources_before_sha256: before.protected_resources_before_sha256,
      protected_resources_after_sha256: committed.protected_resources_after_sha256,
      runtime_configuration_sha256: committed.runtime_configuration_sha256,
      readiness_sha256: committed.readiness_sha256, database_handoff: handoff,
      services: committed.services, unchanged_services: committed.unchanged_services,
      started_at: startedAt, completed_at: committed.completed_at,
    });
    const resultFile = physicalPath(
      `${UAT_PROMOTION_STATE_ROOT}/results/${context.operation_id}.${result.result_sha256}.json`, filesystemRoot,
    );
    await immutableJson(resultFile, result, validateUatPromotionComposeDeploymentResult);
    const transfer = createUatPromotionActiveFenceTransfer({
      promotion_id: intent.promotion_id, migration_operation_id: intent.migration_operation_id,
      deployment_operation_id: intent.deployment_operation_id,
      migration_execution_authorization_sha256: intent.migration_execution_authorization_sha256,
      deployment_authorization_sha256: intent.execution_authorization_sha256,
      active_fence_sha256: intent.active_migration_fence_sha256,
      migration_result_sha256: intent.migration_result_sha256,
      deployment_result_sha256: result.result_sha256,
      database_handoff_sha256: handoff.handoff_sha256,
      runtime_configuration_sha256: result.runtime_configuration_sha256,
      transferred_at: nowIso(options.now),
    });
    const transferFile = physicalPath(
      `${UAT_PROMOTION_STATE_ROOT}/fence-transfers/${context.operation_id}.${transfer.transfer_sha256}.json`,
      filesystemRoot,
    );
    await immutableJson(transferFile, transfer, validateUatPromotionActiveFenceTransfer);
    return Object.freeze({
      result: "COMPOSE_DEPLOYMENT_RESULT_PERSISTED", promotion_id: intent.promotion_id,
      deployment_result_sha256: result.result_sha256, fence_transfer_sha256: transfer.transfer_sha256,
    });
  } catch (cause) {
    let containment;
    try { containment = await adapter.emergencyContainment(); }
    catch { reject("COMPOSE_DEPLOYMENT_CONTROL_CONTAINMENT_FAILED"); }
    const body = {
      schema_version: 1, contract: "chenyida-erp-uat-promotion-compose-deployment-failure/v1",
      status: "FAILED_AND_CONTAINED", promotion_id: intent.promotion_id,
      deployment_operation_id: intent.deployment_operation_id,
      failure_code: cause?.code || "COMPOSE_DEPLOYMENT_CONTROL_FAILED",
      database_sealed: containment.database_sealed,
      stopped_container_ids: containment.stopped_container_ids,
      contained_at: nowIso(options.now),
    };
    const record = Object.freeze({ ...body, failure_sha256: clusterSha256(body) });
    await immutableJson(path.join(root, "failure-containment.json"), record);
    reject(record.failure_code);
  }
}

function assertSupervisorControl(context, phase) {
  const expectedConsumed = phase === "execute" || phase === "recover" ? "YES" : "NO";
  if (process.getuid?.() !== 0 || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES"
    || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED !== expectedConsumed
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED
      !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT
    || path.basename(path.dirname(SITE_ROOT)) !== context.supervisor_bundle_sha256) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_SUPERVISOR_INVALID");
  }
  const descriptorText = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/u.test(descriptorText || "")) reject("COMPOSE_DEPLOYMENT_CONTROL_LOCK_INVALID");
  const descriptor = Number(descriptorText);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(GLOBAL_RELEASE_LOCK, { bigint: true });
    const locks = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:"));
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || named.uid !== 0n || named.gid !== 0n
      || named.nlink !== 1n || (named.mode & 0o7777n) !== 0o600n || opened.dev !== named.dev
      || opened.ino !== named.ino || locks.length !== 1) reject("COMPOSE_DEPLOYMENT_CONTROL_LOCK_INVALID");
  } catch { reject("COMPOSE_DEPLOYMENT_CONTROL_LOCK_INVALID"); }
}

async function readContext() {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 512 * 1024) reject("COMPOSE_DEPLOYMENT_CONTROL_CONTEXT_INVALID");
    chunks.push(chunk);
  }
  try { return parseStrictJson(Buffer.concat(chunks).toString("utf8"), 512 * 1024); }
  catch { reject("COMPOSE_DEPLOYMENT_CONTROL_CONTEXT_INVALID"); }
}

async function main(args) {
  if (args.length !== 2 || !new Set(["execute", "recover"]).has(args[0]) || !SHA256.test(args[1])) {
    reject("COMPOSE_DEPLOYMENT_CONTROL_USAGE_INVALID");
  }
  const context = validateUatPromotionContext(await readContext());
  assertSupervisorControl(context, args[0]);
  process.stdout.write(canonicalClusterJson(await runUatPromotionComposeDeploymentControl(
    context, args[0], { expectedIntentSha256: args[1] },
  )));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "COMPOSE_DEPLOYMENT_CONTROL_FAILED"}\n`); process.exitCode = 1;
  });
}
