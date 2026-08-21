import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  UAT_PROMOTION_AUDIT_ARTIFACT_PATH,
  UAT_PROMOTION_AUDIT_MARKDOWN_PATH,
  assertUatPromotionMayStart,
  buildUatPromotionRollbackAudit,
  canonicalJson,
  loadUatPromotionRollbackAuditInputs,
  sha256,
} from "../scripts/uat-promotion-rollback-audit.mjs";
import {
  TASK70_DYNAMIC_POLICY_PATH,
  canonicalTask70DynamicJson,
  loadTask70DynamicRepositoryGitProjection,
  task70DynamicSha256,
} from "../scripts/uat-promotion-dynamic-evidence.mjs";

function inputs() {
  const value = loadUatPromotionRollbackAuditInputs();
  return {
    ...value,
    policy: structuredClone(value.policy),
    inventory: structuredClone(value.inventory),
    sourceBodies: new Map(value.sourceBodies),
    rawDigests: { ...value.rawDigests },
    dynamicEvidence: value.dynamicEvidence === null
      ? null : structuredClone(value.dynamicEvidence),
    dynamicEvidenceRepositoryGit: value.dynamicEvidenceRepositoryGit === null
      ? null : structuredClone(value.dynamicEvidenceRepositoryGit),
    dynamicEvidenceLoadError: value.dynamicEvidenceLoadError,
  };
}

const dynamicDigest = (value) => task70DynamicSha256(canonicalTask70DynamicJson(value));
const pythonDigest = (value) => task70DynamicSha256(`${canonicalTask70DynamicJson(value)}\n`);
const gitBlobSha1 = (value) => {
  const raw = Buffer.from(value, "utf8");
  return createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
};
const dynamicSelf = (body, field) => ({ ...body, [field]: dynamicDigest(body) });
const pythonSelf = (body, field) => ({ ...body, [field]: pythonDigest(body) });
const emptySha = sha256("");
const fixtureImageDigest =
  "sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394";

function fixtureBaseSpec(runtime) {
  const profileBody = {
    encoding: "UTF8", locale_provider: "libc", collate: "C", ctype: "C",
    collation_version: null, default_tablespace: "pg_default",
  };
  const hash = (label) => sha256(`dynamic-fixture:${label}`);
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-base-spec/v1",
    environment: "UAT",
    deployment_id: "chenyida-erp",
    promotion_id: "promotion-handler-matrix-001",
    promotion_generation: 1,
    rollback_operation_id: "rollback-runner-deadbeef",
    runtime_plan_sha256: hash("runtime-plan"),
    source_set_sha256: hash("source-set"),
    package_sha256: hash("package"),
    postgres: {
      container_id: runtime.container_inspect.container_id,
      image_reference: runtime.postgres_image_reference,
      image_digest: runtime.postgres_image_before.id,
      control_os_user: "999:999", control_database_role: "postgres",
      management_database: "postgres", system_identifier: "1234567890123456789",
      server_version_num: "170010", server_major: "17", listen_addresses: "*",
    },
    databases: {
      active_name: "chenyida_erp", candidate_oid: "17000",
      candidate_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
      staging_name: "chenyida_erp_rb_deadbeefdeadbeef",
      staging_marker:
        "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING",
      quarantine_name: "chenyida_erp_candidate_deadbeefdeadbeef",
      quarantine_marker:
        "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:CANDIDATE_QUARANTINE",
    },
    snapshot: {
      dump_sha256: hash("dump"), dump_bytes: 4096, database_bytes: 16777216,
      snapshot_manifest_sha256: hash("manifest"),
      source_reconciliation_sha256: hash("reconciliation"),
      target_database_report_sha256: hash("report"),
      migration_head: "0046_runtime_lock_privilege_boundary.sql",
      migration_manifest_sha256: hash("migrations"),
    },
    profile: pythonSelf(profileBody, "profile_sha256"),
    security: Object.fromEntries([
      "access_file_sha256", "access_sha256", "catalog_file_sha256", "catalog_sha256",
      "catalog_artifact_sha256", "policy_file_sha256", "policy_sha256",
      "operator_file_sha256", "operator_policy_sha256", "runtime_privilege_policy_sha256",
      "roles_projection_sha256", "memberships_projection_sha256",
      "ownership_projection_sha256", "acl_projection_sha256",
      "default_acl_projection_sha256", "unsupported_projection_sha256",
    ].map((field) => [field, hash(field)]).concat([
      ["database_owner", "cyd_migration_owner"], ["schema_name", "public"],
      ["schema_owner", "cyd_migration_owner"],
    ])),
    authority: {
      authority_id: "authority-deadbeef", authority_sha256: hash("authority"),
      approved_at: "2026-08-16T01:00:00.000Z",
      expires_at: "2026-08-16T03:00:00.000Z", one_time: true,
      mutation_scope_sha256: hash("scope"),
    },
    runtime_limits: {
      preflight_seconds: 120, recheck_seconds: 120, prepare_seconds: 120,
      execute_seconds: 1800, probe_seconds: 300, contain_seconds: 300,
      sql_max_bytes: 1048576, output_max_bytes: 4194304,
    },
  };
  return pythonSelf(body, "base_spec_sha256");
}

function renderFixtureProductionSql(base, bindings) {
  const q = (value) => `"${value}"`;
  const l = (value) => `'${value}'`;
  const names = base.databases;
  return `BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${l(`chenyida-erp-uat-rollback:${base.runtime_plan_sha256}`)},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> ${l(base.postgres.system_identifier)}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${l(names.active_name)} AND d.oid::text=${l(names.candidate_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${l(names.candidate_marker)}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${l(names.staging_name)} AND d.oid::text=${l(bindings.staging_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${l(names.staging_marker)}
         AND d.datallowconn=true AND d.datconnlimit=0
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=${l(names.quarantine_name)})
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                WHERE datname IN (${l(names.active_name)},${l(names.staging_name)},${l(names.quarantine_name)}))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts
                WHERE database IN (${l(names.active_name)},${l(names.staging_name)},${l(names.quarantine_name)}))
  THEN RAISE EXCEPTION 'rollback switch precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE ${q(names.staging_name)} ALLOW_CONNECTIONS false;
ALTER DATABASE ${q(names.active_name)} RENAME TO ${q(names.quarantine_name)};
ALTER DATABASE ${q(names.staging_name)} RENAME TO ${q(names.active_name)};
COMMENT ON DATABASE ${q(names.quarantine_name)} IS ${l(names.quarantine_marker)};
COMMENT ON DATABASE ${q(names.active_name)} IS ${l(names.candidate_marker)};
COMMIT;
`;
}

function renderFixtureObservationSql(base) {
  const l = (value) => `'${value}'`;
  const names = base.databases;
  return `SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'server_version_num',current_setting('server_version_num'),
  'databases',COALESCE((
    SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
      'name',d.datname,'oid',d.oid::text,
      'marker',pg_catalog.shobj_description(d.oid,'pg_database'),
      'allow_connections',d.datallowconn,'connection_limit',d.datconnlimit,
      'default_transaction_read_only',EXISTS(
        SELECT 1 FROM pg_catalog.pg_db_role_setting s
        WHERE s.setdatabase=d.oid AND s.setrole=0
          AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
      'sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity a WHERE a.datid=d.oid),
      'prepared_xacts',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts x WHERE x.database=d.datname)
    ) ORDER BY d.datname)
    FROM pg_catalog.pg_database d
    WHERE d.datname IN (${l(names.active_name)},${l(names.staging_name)},${l(names.quarantine_name)})
  ),'[]'::json)
)::text;
`;
}

function renderFixtureSetupSql() {
  const q = (value) => `"${value}"`;
  const l = (value) => `'${value}'`;
  const active = "chenyida_erp";
  const staging = "chenyida_erp_rb_deadbeefdeadbeef";
  const candidateMarker = "chenyida-erp-deployment/v2:UAT:chenyida-erp";
  const stagingMarker =
    "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING";
  return [
    "COMMENT ON DATABASE postgres IS 'chenyida-erp-task70-isolated-test/v1';",
    `CREATE DATABASE ${q(active)} WITH OWNER postgres TEMPLATE template0 `
      + "ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' "
      + "TABLESPACE pg_default CONNECTION LIMIT 0;",
    `ALTER DATABASE ${q(active)} SET default_transaction_read_only TO on;`,
    `ALTER DATABASE ${q(active)} ALLOW_CONNECTIONS false;`,
    `ALTER DATABASE ${q(active)} CONNECTION LIMIT 0;`,
    `COMMENT ON DATABASE ${q(active)} IS ${l(candidateMarker)};`,
    `CREATE DATABASE ${q(staging)} WITH OWNER postgres TEMPLATE template0 `
      + "ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' "
      + "TABLESPACE pg_default CONNECTION LIMIT 0;",
    `ALTER DATABASE ${q(staging)} SET default_transaction_read_only TO on;`,
    `ALTER DATABASE ${q(staging)} ALLOW_CONNECTIONS true;`,
    `ALTER DATABASE ${q(staging)} CONNECTION LIMIT 0;`,
    `COMMENT ON DATABASE ${q(staging)} IS ${l(stagingMarker)};`,
  ].join("\n") + "\n";
}

function renderFixtureResetSql(base, restoredOid) {
  const q = (value) => `"${value}"`;
  const l = (value) => `'${value}'`;
  const names = base.databases;
  return `BEGIN;
DO $cyd$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${l(names.active_name)} AND d.oid::text=${l(restoredOid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${l(names.candidate_marker)}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${l(names.quarantine_name)} AND d.oid::text=${l(names.candidate_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${l(names.quarantine_marker)}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=${l(names.staging_name)})
  THEN RAISE EXCEPTION 'task70 fixture reset precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE ${q(names.active_name)} RENAME TO ${q(names.staging_name)};
ALTER DATABASE ${q(names.quarantine_name)} RENAME TO ${q(names.active_name)};
ALTER DATABASE ${q(names.staging_name)} ALLOW_CONNECTIONS true;
COMMENT ON DATABASE ${q(names.active_name)} IS ${l(names.candidate_marker)};
COMMENT ON DATABASE ${q(names.staging_name)} IS ${l(names.staging_marker)};
COMMIT;
`;
}

function fixtureOpcode(base, opcode, bindings, sql) {
  const phase = opcode === "PG_RB_ATOMIC_SWITCH_V1" ? "switch" : "observe";
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-opcode-spec/v1",
    opcode, base_spec_sha256: base.base_spec_sha256, database: "postgres", phase,
    timeout_seconds: 300, effectful: opcode === "PG_RB_ATOMIC_SWITCH_V1", bindings,
    sql_sha256: sha256(sql),
    argv_template_sha256: pythonDigest([
      "DOCKER_EXEC_POSTGRES_PSQL_V1", base.postgres.container_id, "postgres", phase,
    ]),
  };
  return pythonSelf(body, "opcode_spec_sha256");
}

function fixtureObservation(base, rows, observedAt) {
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-state-observation/v1",
    runtime_plan_sha256: base.runtime_plan_sha256,
    base_spec_sha256: base.base_spec_sha256,
    system_identifier: base.postgres.system_identifier,
    server_version_num: "170010",
    databases: [...rows].sort((left, right) => left.name < right.name ? -1 : 1),
    observed_at: observedAt,
  };
  return pythonSelf(body, "observation_sha256");
}

function fixtureClassification(base, restoredOid, observation, layout, topology) {
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-layout-classification/v1",
    runtime_plan_sha256: base.runtime_plan_sha256,
    base_spec_sha256: base.base_spec_sha256,
    observation_sha256: observation.observation_sha256,
    restored_oid: restoredOid, layout,
    safe_to_recover_switch_receipt: layout === "NEW_SEALED",
    safe_to_recover_unseal_receipt: false,
  };
  return {
    layout, topology,
    state_projection_sha256: dynamicDigest({
      system_identifier: observation.system_identifier,
      server_version_num: observation.server_version_num,
      databases: observation.databases,
    }),
    classification_sha256: pythonDigest(body),
  };
}

function fixtureCommand(overrides) {
  const { stdout_text: stdoutText = "", stderr_text: stderrText = "", ...fields } = overrides;
  const stdout = Buffer.from(stdoutText, "utf8");
  const stderr = Buffer.from(stderrText, "utf8");
  return dynamicSelf({
    command_class: "PRODUCTION", opcode: "PG_RB_ATOMIC_SWITCH_V1",
    stdin_sha256: overrides.stdin_sha256, exit_code: 0,
    stdout_sha256: sha256(stdout), stderr_sha256: sha256(stderr),
    stdout_base64: stdout.toString("base64"), stderr_base64: stderr.toString("base64"),
    failure_code: null,
    response_delivered: true, caller_boundary: "CALLER_RECEIVED_PROCESS_RESULT",
    ...fields,
  }, "command_receipt_sha256");
}

function fixtureReceipt(phase, sqlSha = sha256(`fixture:${phase}:sql`)) {
  return dynamicSelf({
    phase, sql_sha256: sqlSha, exit_code: 0,
    stdout_sha256: emptySha, stderr_sha256: emptySha,
  }, "fixture_receipt_sha256");
}

function fixtureObjectSnapshot() {
  const volumes = [
    "chenyida-erp-parallel_erp_attachments",
    "chenyida-erp-parallel_erp_backup_status",
    "chenyida-erp-parallel_erp_postgres",
    "chenyida-erp-parallel_erp_uploads",
  ].map((name) => ({
    name, driver: "local", scope: "local", created_at: "2026-08-01T00:00:00Z",
    label_set_sha256: dynamicDigest({}),
  }));
  const body = {
    containers: ["1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64)],
    images: [{
      id: fixtureImageDigest, repo_tag_set_sha256: dynamicDigest(["fixture-tag"]),
      repo_digest_set_sha256: dynamicDigest(["fixture-digest"]),
    }],
    volumes,
    networks: [{
      id: "6".repeat(64), name_sha256: sha256("fixture-network"),
      driver: "bridge", scope: "local", label_set_sha256: dynamicDigest({}),
    }],
    protected_volumes: structuredClone(volumes),
    services: ["caddy", "postgres", "web", "worker"].map((service, index) => ({
      service, container_id: String(index + 1).repeat(64),
      image_reference_sha256: sha256(`image-ref:${service}`),
      image_id: `sha256:${String(index + 1).repeat(64)}`,
      restart_count: 0, oom_killed: false, running: true,
      health: ["postgres", "web"].includes(service) ? "HEALTHY" : "NONE",
      mount_set_sha256: dynamicDigest([]), network_set_sha256: dynamicDigest([]),
      port_set_sha256: dynamicDigest([]),
    })),
  };
  return dynamicSelf(body, "fingerprint_sha256");
}

function fixtureCreateArguments(policy, runId, name) {
  const limits = policy.case_catalog[0].container_limits;
  const output = [
    "create", "--pull=never", "--platform", "linux/amd64", "--name", name,
    "--label", `chenyida.erp.task70-run-id=${runId}`,
    "--label", "chenyida.erp.execution-scope=isolated-synthetic-test",
    "--user", "999:999", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--restart", "no", "--log-driver", "none",
    "--memory", "805306368", "--memory-swap", "805306368", "--cpus", "1",
    "--pids-limit", "192", "--shm-size", "67108864", "--stop-timeout", "5",
  ];
  Object.keys(limits.tmpfs).sort().forEach((target) => output.push(
    "--tmpfs", `${target}:${limits.tmpfs[target].options},size=${limits.tmpfs[target].size_bytes}`,
  ));
  output.push(
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env", "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C",
    "--env", "PGDATA=/var/lib/postgresql/data/pgdata",
    policy.case_catalog[0].postgres_image_reference,
    "postgres", "-c", "listen_addresses=*", "-c",
    "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
    "-c", "shared_buffers=64MB", "-c", "log_statement=none",
  );
  return output;
}

function fixtureRuntime(policy, runId) {
  const name = `cyd-dv70-pg-switch-${runId}`;
  const labels = {
    "chenyida.erp.execution-scope": "isolated-synthetic-test",
    "chenyida.erp.task70-run-id": runId,
  };
  const image = {
    id: fixtureImageDigest, descriptor_digest: fixtureImageDigest,
    repo_digest_suffixes: [fixtureImageDigest], architecture: "amd64", os: "linux",
    size_bytes: 156120037,
  };
  const container = {
    container_id: "a".repeat(64), name,
    created_at: "2026-08-21T11:00:59.000000000Z", labels,
    image_id: fixtureImageDigest,
    image_reference: policy.case_catalog[0].postgres_image_reference,
    user: "999:999", network_mode: "none", rootfs_read_only: true,
    cap_drop: ["ALL"], cap_add: [], security_opt: ["no-new-privileges"],
    restart_policy: "no", privileged: false, memory_bytes: 805306368,
    memory_swap_bytes: 805306368, nano_cpus: 1000000000, pids: 192,
    shared_memory_bytes: 67108864, stop_timeout_seconds: 5, log_driver: "none",
    devices: [], binds: [], mounts: [], published_ports: {}, publish_all_ports: false,
    tmpfs: structuredClone(policy.case_catalog[0].container_limits.tmpfs),
    synthetic_trust_auth: true, initdb_args: "--encoding=UTF8 --locale=C",
    pgdata: "/var/lib/postgresql/data/pgdata",
    command: [
      "postgres", "-c", "listen_addresses=*", "-c",
      "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
      "-c", "shared_buffers=64MB", "-c", "log_statement=none",
    ],
  };
  const createArguments = fixtureCreateArguments(policy, runId, name);
  return {
    platform: "linux/amd64",
    postgres_image_reference: policy.case_catalog[0].postgres_image_reference,
    postgres_image_before: image, postgres_image_after: structuredClone(image),
    docker_binary_sha256: sha256("fixture-docker-binary"),
    container_limits: structuredClone(policy.case_catalog[0].container_limits),
    docker_create_arguments: createArguments,
    docker_create_arguments_sha256: dynamicDigest(createArguments),
    container_inspect: container,
    build_performed: false, pull_performed: false, mounted_volume_names: [],
  };
}

function fixtureResourceGate(objectSnapshot, policy) {
  const serviceStates = objectSnapshot.services.map((entry) => ({
    service: entry.service, container_id: entry.container_id, restart_count: 0,
    oom_killed: false, running: true, health: entry.health,
  }));
  const start = Date.parse("2026-08-21T11:00:00.000Z");
  const samples = Array.from({ length: 37 }, (_, index) => ({
    captured_at: new Date(start + index * 5000).toISOString(),
    elapsed_milliseconds: index * 5000,
    available_memory_bytes: 2147483648,
    swap_used_bytes: 33554432,
    swap_total_bytes: 1073741824,
    root_available_bytes: 12884901888,
    load1: 0.5,
    oom_kill_count: 0,
    services: structuredClone(serviceStates),
  }));
  const body = {
    boot_id_sha256: sha256("fixture-boot-id"),
    sample_interval_seconds: 5,
    sample_count: samples.length,
    sample_window_seconds: 180,
    preflight_sample_window_seconds: 60,
    samples,
    minimum_available_memory_bytes: 2147483648,
    maximum_swap_percent_observed: 3.125,
    maximum_rolling_swap_growth_bytes: 0,
    minimum_root_available_bytes: 12884901888,
    maximum_load1_observed: 0.5,
    oom_kill_delta: 0,
    service_restart_delta: 0,
    declared_maximum_disk_delta_bytes: policy.case_catalog[0].maximum_disk_delta_bytes,
    observed_peak_disk_delta_bytes: 0,
    result: "PASS",
  };
  return dynamicSelf(body, "resource_evidence_sha256");
}

function fixtureAssertions(scenarios, context) {
  const [success, repeat, drift, fault, response] = scenarios;
  const hashes = scenarios.map((entry) => entry.scenario_sha256);
  const make = (id, evidence) => ({
    id, result: "PASS", evidence, evidence_sha256: dynamicDigest(evidence),
  });
  return [
    make("PRODUCTION_SQL_SHA_BOUND", {
      scenario_refs: [success, repeat, drift, response].map((entry) => entry.scenario_sha256),
      production_sql_sha256: context.productionSpec.sql_sha256,
      opcode_spec_sha256: context.productionSpec.opcode_spec_sha256,
      production_dispatch_count: 4,
    }),
    make("EXACT_SWITCH_NEW_SEALED", {
      scenario_refs: [success.scenario_sha256], before_layout: "OLD",
      after_layout: "NEW_SEALED", mutation_ack_sha256: success.mutation_ack.ack_sha256,
    }),
    make("DATABASE_OIDS_PRESERVED", {
      scenario_refs: [success.scenario_sha256], candidate_oid: "17000", restored_oid: "17001",
      candidate_before_name: "chenyida_erp",
      candidate_after_name: "chenyida_erp_candidate_deadbeefdeadbeef",
      restored_before_name: "chenyida_erp_rb_deadbeefdeadbeef",
      restored_after_name: "chenyida_erp",
    }),
    make("REPEAT_EXECUTION_FAILS_CLOSED", {
      scenario_refs: [repeat.scenario_sha256],
      failure_code: "ROLLBACK_SWITCH_PRECONDITION_MISMATCH",
      state_unchanged: true, after_layout: "NEW_SEALED",
    }),
    make("PRECONDITION_DRIFT_REJECTED", {
      scenario_refs: [drift.scenario_sha256],
      drift_marker: "chenyida-erp-task70-isolated-test/v1:EXPECTED_PRECONDITION_DRIFT",
      failure_code: "ROLLBACK_SWITCH_PRECONDITION_MISMATCH",
      drifted_state_unchanged: true, restored_layout: "OLD",
    }),
    make("FIRST_RENAME_FAULT_ROLLS_BACK", {
      scenario_refs: [fault.scenario_sha256], fault_derivation: fault.fault_derivation,
      barrier_observed: true, witness_topology: "OLD_TOPOLOGY", after_layout: "OLD",
      state_rolled_back: true,
    }),
    make("CALLER_RESULT_DISCARD_PROBED_READ_ONLY", {
      scenario_refs: [response.scenario_sha256], simulation_class: response.simulation_class,
      caller_result_discarded: true, mutation_ack_parsed: false,
      production_command_receipt_count: 1, read_only_observation_count: 1,
      after_layout: "NEW_SEALED",
    }),
    make("NO_PERSISTENT_MIXED_LAYOUT", {
      scenario_refs: hashes,
      stable_topologies: [
        "OLD_TOPOLOGY", "NEW_TOPOLOGY", "NEW_TOPOLOGY", "OLD_TOPOLOGY",
        "OLD_TOPOLOGY", "NEW_TOPOLOGY",
      ],
      mixed_stable_layout_count: 0,
    }),
    make("EXISTING_RUNTIME_AND_PROTECTED_VOLUMES_UNCHANGED", {
      scenario_refs: hashes,
      before_fingerprint_sha256: context.object.fingerprint_sha256,
      after_fingerprint_sha256: context.object.fingerprint_sha256,
      cleanup_receipt_sha256: context.cleanup.cleanup_receipt_sha256,
      remaining_task_container_count: 0, remaining_task_network_count: 0,
      remaining_task_volume_count: 0,
    }),
  ];
}

function dynamicArtifact(fixture) {
  const policy = JSON.parse(fixture.sourceBodies.get(TASK70_DYNAMIC_POLICY_PATH));
  const testCase = policy.case_catalog[0];
  const runId = "dv70-A1b2C3d4";
  const runtime = fixtureRuntime(policy, runId);
  const base = fixtureBaseSpec(runtime);
  const restoredOid = "17001";
  const names = base.databases;
  const row = (name, oid, marker, allow, limit, readonly) => ({
    name, oid, marker, allow_connections: allow, connection_limit: limit,
    default_transaction_read_only: readonly, sessions: 0, prepared_xacts: 0,
  });
  const oldRows = () => [
    row(names.active_name, names.candidate_oid, names.candidate_marker, false, 0, true),
    row(names.staging_name, restoredOid, names.staging_marker, true, 0, true),
  ];
  const newRows = () => [
    row(names.active_name, restoredOid, names.candidate_marker, false, 0, true),
    row(names.quarantine_name, names.candidate_oid, names.quarantine_marker, false, 0, true),
  ];
  const driftRows = () => [
    row(names.active_name, names.candidate_oid,
      "chenyida-erp-task70-isolated-test/v1:EXPECTED_PRECONDITION_DRIFT", false, 0, true),
    row(names.staging_name, restoredOid, names.staging_marker, true, 0, true),
  ];
  let observationOrdinal = 0;
  const observation = (rows) => fixtureObservation(
    base, rows, new Date(Date.parse("2026-08-21T11:01:00.000Z")
      + observationOrdinal++ * 1000).toISOString(),
  );
  const pair = (rows, layout, topology) => {
    const observed = observation(rows);
    return [observed, fixtureClassification(base, restoredOid, observed, layout, topology)];
  };
  const successBefore = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const productionBindings = {
    privilege_receipt_sha256: pythonDigest({
      task_id: "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
      case_id: "DV70-PG-SWITCH-01",
      scope: "SYNTHETIC_PRIVILEGE_RECEIPT_PLACEHOLDER",
    }),
    staging_oid: restoredOid,
    before_observation_sha256: successBefore[0].observation_sha256,
    expected_switched_identity_sha256: pythonDigest({
      active_name: names.active_name, active_oid: restoredOid,
      quarantine_name: names.quarantine_name, quarantine_oid: names.candidate_oid,
      state: "NEW_SEALED",
    }),
  };
  const productionSql = renderFixtureProductionSql(base, productionBindings);
  const productionSpec = fixtureOpcode(
    base, "PG_RB_ATOMIC_SWITCH_V1", productionBindings, productionSql,
  );
  const observationBindingSha256 = pythonDigest({
    task_id: "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
    case_id: "DV70-PG-SWITCH-01",
    base_spec_sha256: base.base_spec_sha256,
    restored_oid: restoredOid,
  });
  const observationBindings = {
    journal_state_sha256: pythonDigest({
      base_spec_sha256: base.base_spec_sha256,
      purpose: "task70-dynamic-case", binding_sha256: observationBindingSha256,
    }),
    observation_scope_sha256: pythonDigest({
      system_identifier: base.postgres.system_identifier,
      databases: [names.active_name, names.staging_name, names.quarantine_name].sort(),
    }),
  };
  const observationSql = renderFixtureObservationSql(base);
  const observationSpec = fixtureOpcode(
    base, "PG_RB_OBSERVE_STATE_V1", observationBindings, observationSql,
  );
  const successAfter = pair(newRows(), "NEW_SEALED", "NEW_TOPOLOGY");
  const successCommand = fixtureCommand({ stdin_sha256: productionSpec.sql_sha256 });
  const ack = pythonSelf({
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-mutation-ack/v1",
    opcode: "PG_RB_ATOMIC_SWITCH_V1", stdout_bytes: 0, stdout_sha256: emptySha,
  }, "ack_sha256");
  const scenarios = [];
  scenarios.push(dynamicSelf({
    scenario_id: "EXACT_SUCCESS", before: successBefore[0],
    before_classification: successBefore[1], command: successCommand, mutation_ack: ack,
    after: successAfter[0], after_classification: successAfter[1],
  }, "scenario_sha256"));
  const repeatBefore = pair(newRows(), "NEW_SEALED", "NEW_TOPOLOGY");
  const repeatAfter = pair(newRows(), "NEW_SEALED", "NEW_TOPOLOGY");
  const failureCommand = () => fixtureCommand({
    stdin_sha256: productionSpec.sql_sha256, exit_code: 3,
    stdout_text: "\n",
    stderr_text: "ERROR:  rollback switch precondition mismatch\n",
    failure_code: "ROLLBACK_SWITCH_PRECONDITION_MISMATCH",
  });
  scenarios.push(dynamicSelf({
    scenario_id: "REPEAT_FAIL_CLOSED", before: repeatBefore[0],
    before_classification: repeatBefore[1], command: failureCommand(),
    after: repeatAfter[0], after_classification: repeatAfter[1],
  }, "scenario_sha256"));
  const driftBefore = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const driftedBefore = pair(driftRows(), "INVALID", "OLD_TOPOLOGY");
  const driftedAfter = pair(driftRows(), "INVALID", "OLD_TOPOLOGY");
  const driftRestored = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const driftMarker = "chenyida-erp-task70-isolated-test/v1:EXPECTED_PRECONDITION_DRIFT";
  scenarios.push(dynamicSelf({
    scenario_id: "PRECONDITION_DRIFT_REJECTED", before: driftBefore[0],
    before_classification: driftBefore[1], drift_marker: driftMarker,
    drift_apply: fixtureReceipt("fixture_drift_apply",
      sha256(`COMMENT ON DATABASE "chenyida_erp" IS '${driftMarker}';\n`)),
    drifted_before: driftedBefore[0], drifted_before_classification: driftedBefore[1],
    command: failureCommand(), drifted_after: driftedAfter[0],
    drifted_after_classification: driftedAfter[1],
    drift_restore: fixtureReceipt("fixture_drift_restore",
      sha256(`COMMENT ON DATABASE "chenyida_erp" IS '${names.candidate_marker}';\n`)),
    restored: driftRestored[0], restored_classification: driftRestored[1],
  }, "scenario_sha256"));
  const faultBefore = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const faultWitness = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const faultAfter = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const firstRename = `ALTER DATABASE "${names.active_name}" RENAME TO "${names.quarantine_name}";\n`;
  const boundary = Buffer.byteLength(productionSql.slice(0,
    productionSql.indexOf(firstRename) + firstRename.length));
  const faultSql = Buffer.concat([
    Buffer.from(productionSql).subarray(0, boundary),
    Buffer.from("SELECT 'DV70_FIRST_RENAME_REACHED'::text;\n"),
  ]);
  scenarios.push(dynamicSelf({
    scenario_id: "FIRST_RENAME_FAULT_ROLLBACK", before: faultBefore[0],
    before_classification: faultBefore[1], production_sql_sha256: productionSpec.sql_sha256,
    fault_sql_sha256: sha256(faultSql), fault_boundary_offset_bytes: boundary,
    fault_derivation: testCase.fault_derivation, barrier: "DV70_FIRST_RENAME_REACHED",
    barrier_observed: true,
    command: fixtureCommand({
      command_class: "DERIVED_FAULT_STREAM",
      opcode: "DERIVED_FIRST_RENAME_BARRIER_EOF_V1", stdin_sha256: sha256(faultSql),
      stdout_text: "DV70_FIRST_RENAME_REACHED\n",
      caller_boundary: "EOF_AFTER_FIRST_RENAME_BARRIER",
    }),
    witness: faultWitness[0], witness_classification: faultWitness[1],
    after: faultAfter[0], after_classification: faultAfter[1],
  }, "scenario_sha256"));
  const responseBefore = pair(oldRows(), "OLD", "OLD_TOPOLOGY");
  const responseAfter = pair(newRows(), "NEW_SEALED", "NEW_TOPOLOGY");
  scenarios.push(dynamicSelf({
    scenario_id:
      "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION_READ_ONLY_OBSERVATION",
    simulation_class: "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION",
    before: responseBefore[0], before_classification: responseBefore[1],
    command: fixtureCommand({
      stdin_sha256: productionSpec.sql_sha256, response_delivered: false,
      caller_boundary: "AFTER_PSQL_COMPLETION_BEFORE_ACK_PARSE_RESULT_DISCARDED",
    }),
    caller_result_discarded: true, mutation_ack_parsed: false,
    after: responseAfter[0],
    after_classification: responseAfter[1],
  }, "scenario_sha256"));

  const object = fixtureObjectSnapshot();
  const cleanupBody = {
    task_label: `chenyida.erp.task70-run-id=${runId}`,
    isolation_label: "chenyida.erp.execution-scope=isolated-synthetic-test",
    created_containers: [{
      id: runtime.container_inspect.container_id, name: runtime.container_inspect.name,
      labels: runtime.container_inspect.labels, created_at: runtime.container_inspect.created_at,
    }],
    created_networks: [], created_volumes: [],
    temp_roots: ["/tmp/cyd-dv70-pg-switch.A1b2C3d4"],
    removed_container_ids: [runtime.container_inspect.container_id],
    remaining_containers: [], remaining_networks: [], remaining_volumes: [],
    remaining_temp_roots: [], process_group_remaining: 0, result: "ZERO_TASK_RESIDUE",
  };
  const cleanup = dynamicSelf(cleanupBody, "cleanup_receipt_sha256");
  const guardBody = {
    system_identifier: base.postgres.system_identifier, server_version_num: "170010",
    listen_addresses: "*", management_database: "postgres",
    management_comment: "chenyida-erp-task70-isolated-test/v1", guard_matches: true,
  };
  const fixtureBody = {
    fixture_source_path: "chenyida_erp_site/tests/test_uat_promotion_rollback_fixed_executor.py",
    base_spec: base, restored_oid: restoredOid,
    management_identity: {
      system_identifier: base.postgres.system_identifier, server_version_num: "170010",
      listen_addresses: "*", encoding: "UTF8", collate: "C", ctype: "C",
      locale_provider: "libc", collation_version: null,
      active_oid: "17000", staging_oid: "17001",
    },
    setup_receipt: fixtureReceipt("fixture_setup", sha256(renderFixtureSetupSql())),
    reset_receipts: [fixtureReceipt(
      "fixture_reset", sha256(renderFixtureResetSql(base, restoredOid)),
    )],
    guard_receipts: Array.from({ length: 7 }, () =>
      dynamicSelf(guardBody, "guard_receipt_sha256")),
  };
  const context = { productionSpec, object, cleanup };
  const caseBody = {
    case_id: testCase.case_id, evidence_class: testCase.evidence_class,
    stage_id: testCase.stage_id, stage_coverage: testCase.stage_coverage, result: "PASS",
    fixture: fixtureBody,
    opcodes: {
      production: { spec: productionSpec,
        sql_utf8_base64: Buffer.from(productionSql).toString("base64") },
      observation: { spec: observationSpec,
        sql_utf8_base64: Buffer.from(observationSql).toString("base64") },
    },
    scenarios,
    assertions: fixtureAssertions(scenarios, context),
  };
  const body = {
    schema_version: 2, contract: policy.artifact_contract, task_id: policy.task_id,
    run_id: runId, evidence_scope: policy.evidence_scope,
    deployment_class: policy.deployment_class, audit_clearance: policy.audit_clearance,
    started_at: "2026-08-21T11:00:00.000Z",
    completed_at: "2026-08-21T11:03:01.000Z",
    source: {
      git_commit: "1".repeat(40), git_tree: "2".repeat(40),
      application_version: "0.1.0-alpha.47",
      migration_head: "0046_runtime_lock_privilege_boundary.sql",
    },
    source_bindings: policy.source_paths.map((repositoryPath) => ({
      path: repositoryPath,
      sha256: task70DynamicSha256(fixture.sourceBodies.get(repositoryPath)),
      git_blob: gitBlobSha1(fixture.sourceBodies.get(repositoryPath)),
    })),
    target_guard: structuredClone(policy.required_target_guard),
    runtime,
    resource_gate: fixtureResourceGate(object, policy),
    object_protection: { before: object, after: structuredClone(object), result: "UNCHANGED" },
    cases: [dynamicSelf(caseBody, "case_evidence_sha256")],
    coverage: {
      stages: policy.required_stage_order.map((id) => ({
        id, status: id === testCase.stage_id ? "PARTIAL" : "MISSING",
      })),
      checks: policy.required_check_order.map((id) => ({ id, status: "MISSING" })),
      status: "PARTIAL",
    },
    cleanup,
    non_claims: [...policy.required_non_claims],
    result: "PASS_PARTIAL",
  };
  const artifact = dynamicSelf(body, "artifact_sha256");
  fixture.dynamicEvidenceRepositoryGit = {
    commit: artifact.source.git_commit,
    tree: artifact.source.git_tree,
    head_commit: artifact.source.git_commit,
    commit_is_ancestor_of_head: true,
    source_blobs: artifact.source_bindings.map((entry) => ({
      path: entry.path, git_blob: entry.git_blob,
    })),
  };
  return artifact;
}

function redigestArtifact(artifact) {
  const body = { ...artifact };
  delete body.artifact_sha256;
  return { ...body, artifact_sha256: dynamicDigest(body) };
}

function redigestDynamicField(value, field, digest = dynamicDigest) {
  value[field] = digest(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  ));
}

function redigestScenarioArtifact(artifact, scenarioIndex) {
  redigestDynamicField(artifact.cases[0].scenarios[scenarioIndex], "scenario_sha256");
  redigestDynamicField(artifact.cases[0], "case_evidence_sha256");
  return redigestArtifact(artifact);
}

test("current repository audit is valid but UAT promotion remains blocked", () => {
  const result = buildUatPromotionRollbackAudit(inputs());
  assert.deepEqual(result.errors, []);
  assert.equal(result.artifact.audit_validation.result, "PASS");
  assert.equal(result.artifact.execution_readiness.status, "BLOCKED");
  assert.equal(result.artifact.execution_readiness.may_start, false);
  assert.equal(result.artifact.execution_readiness.blocking_checkpoint_count, 0);
  assert.equal(result.artifact.execution_readiness.blocking_condition_count, 4);
  assert.equal(result.artifact.execution_readiness.p0_blocker_count, 3);
  assert.equal(result.artifact.execution_readiness.p1_blocker_count, 1);
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "MIGRATION_COMMIT_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "COMPOSE_DEPLOYMENT_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "POST_DEPLOY_RUNTIME_CONFIGURATION").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "POST_DEPLOY_IDENTITY").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "CROSS_ROLE_UAT_EXECUTION").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "PROMOTION_FINAL_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "ROLLBACK_TO_UAT_EXECUTOR").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT").status, "SUPPORTED");
  assert.deepEqual(result.artifact.execution_blockers.map((entry) => entry.id), [
    "ISOLATED_ROLLBACK_DYNAMIC_VALIDATION_NOT_VERIFIED",
    "ROLLBACK_RUNTIME_HOST_NOT_ACTIVATED",
    "ACTUAL_UAT_ROLLBACK_REHEARSAL_NOT_EXECUTED",
    "HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED",
  ]);
});

test("dynamic Git loader resolves real commits, ancestry, blobs and ignores replace refs", async () => {
  const fixture = inputs();
  const policy = JSON.parse(fixture.sourceBodies.get(TASK70_DYNAMIC_POLICY_PATH));
  const repositoryRoot = await mkdtemp(join(tmpdir(), "cyd-task70-git-loader."));
  const gitEnvironment = {
    PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Task70 Test", GIT_AUTHOR_EMAIL: "task70@example.invalid",
    GIT_COMMITTER_NAME: "Task70 Test", GIT_COMMITTER_EMAIL: "task70@example.invalid",
  };
  const git = (argv, input = undefined) => {
    const result = spawnSync("/usr/bin/git", argv, {
      cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1024 * 1024,
      shell: false, env: gitEnvironment, input,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git(["init", "--quiet"]);
    for (const repositoryPath of policy.source_paths) {
      const absolute = join(repositoryRoot, repositoryPath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, fixture.sourceBodies.get(repositoryPath), "utf8");
    }
    git(["add", "--all"]);
    git(["commit", "--quiet", "-m", "source commit"]);
    const commit = git(["rev-parse", "HEAD^{commit}"]);
    const tree = git(["rev-parse", `${commit}^{tree}`]);
    const artifact = dynamicArtifact(fixture);
    artifact.source.git_commit = commit;
    artifact.source.git_tree = tree;
    fixture.dynamicEvidence = redigestArtifact(artifact);

    await writeFile(join(repositoryRoot, "descendant.txt"), "descendant\n", "utf8");
    git(["add", "descendant.txt"]);
    git(["commit", "--quiet", "-m", "descendant"]);
    const descendant = git(["rev-parse", "HEAD^{commit}"]);
    const projection = loadTask70DynamicRepositoryGitProjection(
      fixture.dynamicEvidence, policy, repositoryRoot,
    );
    assert.equal(projection.commit, commit);
    assert.equal(projection.tree, tree);
    assert.equal(projection.head_commit, descendant);
    assert.deepEqual(
      projection.source_blobs,
      artifact.source_bindings.map((entry) => ({
        path: entry.path, git_blob: entry.git_blob,
      })),
    );

    await writeFile(join(repositoryRoot, "replacement.txt"), "replacement\n", "utf8");
    git(["add", "replacement.txt"]);
    const replacementTree = git(["write-tree"]);
    const replacementCommit = git(["commit-tree", replacementTree], "replacement\n");
    git(["replace", commit, replacementCommit]);
    assert.equal(git(["rev-parse", `${commit}^{tree}`]), replacementTree);
    assert.equal(
      loadTask70DynamicRepositoryGitProjection(
        fixture.dynamicEvidence, policy, repositoryRoot,
      ).tree,
      tree,
    );
    git(["replace", "--delete", commit]);

    const missingArtifact = structuredClone(fixture.dynamicEvidence);
    missingArtifact.source.git_commit = "f".repeat(40);
    assert.throws(
      () => loadTask70DynamicRepositoryGitProjection(
        missingArtifact, policy, repositoryRoot,
      ),
      (error) => error.code === "TASK70_DYNAMIC_GIT_COMMIT_NOT_FOUND",
    );

    const unrelated = git(["commit-tree", tree], "unrelated\n");
    git(["update-ref", "refs/heads/unrelated", unrelated]);
    git(["symbolic-ref", "HEAD", "refs/heads/unrelated"]);
    assert.throws(
      () => loadTask70DynamicRepositoryGitProjection(
        fixture.dynamicEvidence, policy, repositoryRoot,
      ),
      (error) => error.code === "TASK70_DYNAMIC_GIT_COMMIT_NOT_ANCESTOR",
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("audit observes the complete repository control plane and recoverable fail-closed runtime boundary", () => {
  const fixture = inputs();
  const { artifact, errors } = buildUatPromotionRollbackAudit(fixture);
  assert.deepEqual(errors, []);
  assert.equal(artifact.observations.supervisor_operation_count, 36);
  assert.equal(artifact.observations.required_promotion_operation_count, 16);
  assert.deepEqual(artifact.observations.implemented_required_promotion_operations, ["BEGIN_UAT_PROMOTION", "CAPTURE_UAT_PROMOTION_SNAPSHOT", "QUIESCE_UAT_WRITERS", "AUTHORIZE_UAT_PROMOTION_MIGRATION", "RUN_UAT_PROMOTION_MIGRATION", "DEPLOY_UAT_RELEASE", "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION", "VERIFY_UAT_POSTDEPLOY_IDENTITY", "VERIFY_UAT_CROSS_ROLE_EXECUTION", "FINALIZE_UAT_PROMOTION", "ROLLBACK_UAT_RELEASE", "VERIFY_AND_FINALIZE_UAT_ROLLBACK", "RECOVER_UAT_PROMOTION", "ACTIVATE_UAT_ROLLBACK_RUNTIME_V2", "ROLLBACK_UAT_ROLLBACK_RUNTIME_V2", "RECOVER_UAT_ROLLBACK_RUNTIME_V2_ACTIVATION"]);
  assert.deepEqual(artifact.observations.missing_required_promotion_operations, []);
  assert.equal(artifact.observations.restore_target_policy, "TEST_ONLY");
  assert.equal(artifact.observations.migration_authorization, "SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED");
  assert.equal(artifact.observations.compose_release_image_binding, "SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT");
  assert.equal(artifact.observations.postdeploy_transaction_binding, "SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.cross_role_uat_transaction_binding, "SUPERVISOR_CHECKPOINT_12_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.finalization_transaction_binding, "SUPERVISOR_CHECKPOINT_13_AGGREGATED_AND_RECOVERABLE");
  assert.equal(artifact.observations.rollback_transaction_binding, "SUPERVISOR_CHECKPOINT_14_15_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.rollback_runtime_adapter, "BUNDLED_FIXED_EXECUTOR_AND_RECOVERABLE_ACTIVATION_PROTOCOL_HANDLERS_IMPLEMENTED_DORMANT_CATALOG_BLOCKED_HOST_NOT_ACTIVATED");
  assert.equal(artifact.observations.repository_handler_capability,
    "HANDLERS_IMPLEMENTED_DORMANT");
  assert.equal(artifact.observations.isolated_dynamic_validation,
    fixture.dynamicEvidence === null
      ? "NOT_EXECUTED_NO_VERIFIED_RECEIPT" : "VERIFIED_PARTIAL_ONLY");
  assert.equal(artifact.observations.host_runtime_activation,
    "NOT_ACTIVATED_NO_TRUSTED_HOST_RECEIPT");
  assert.equal(artifact.observations.actual_uat_rollback_rehearsal,
    "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT");
  assert.equal(artifact.observations.rollback_rehearsal_evidence, "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT");
  assert.equal(artifact.observations.cross_role_uat_readiness, "BLOCKED");
});

test("valid partial-only dynamic evidence cannot clear host or actual UAT blockers", () => {
  const fixture = inputs();
  fixture.dynamicEvidence = dynamicArtifact(fixture);
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.deepEqual(result.errors, []);
  assert.equal(result.artifact.observations.isolated_dynamic_validation,
    "VERIFIED_PARTIAL_ONLY");
  assert.deepEqual(result.artifact.observations.isolated_dynamic_verified_case_ids,
    ["DV70-PG-SWITCH-01"]);
  assert.equal(result.artifact.observations.dynamic_evidence_may_clear_blocker, false);
  assert.equal(result.artifact.observations.dynamic_evidence_may_claim_host_activation, false);
  assert.equal(result.artifact.observations.dynamic_evidence_may_claim_actual_uat, false);
  assert.deepEqual(result.artifact.execution_blockers.map((entry) => entry.id), [
    "ISOLATED_ROLLBACK_DYNAMIC_VALIDATION_NOT_VERIFIED",
    "ROLLBACK_RUNTIME_HOST_NOT_ACTIVATED",
    "ACTUAL_UAT_ROLLBACK_REHEARSAL_NOT_EXECUTED",
    "HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED",
  ]);
  assert.equal(result.artifact.execution_readiness.status, "BLOCKED");
  assert.throws(() => assertUatPromotionMayStart(result.artifact),
    (error) => error.code === "UAT_PROMOTION_EXECUTOR_NOT_READY");
});

test("dynamic evidence tampering fails closed", () => {
  const cleanupFixture = inputs();
  const cleanupArtifact = dynamicArtifact(cleanupFixture);
  cleanupArtifact.cleanup.remaining_containers = [sha256("residue")];
  cleanupArtifact.cleanup.cleanup_receipt_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(cleanupArtifact.cleanup)
      .filter(([key]) => key !== "cleanup_receipt_sha256")),
  );
  cleanupFixture.dynamicEvidence = redigestArtifact(cleanupArtifact);
  const cleanupResult = buildUatPromotionRollbackAudit(cleanupFixture);
  assert.ok(cleanupResult.errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_CLEANUP_FAILED",
  ));
  assert.equal(cleanupResult.artifact.observations.isolated_dynamic_validation,
    "INVALID_FAIL_CLOSED");
  assert.equal(cleanupResult.artifact.execution_readiness.may_start, false);

  const scopeFixture = inputs();
  const scopeArtifact = dynamicArtifact(scopeFixture);
  scopeArtifact.evidence_scope = "UAT";
  scopeFixture.dynamicEvidence = redigestArtifact(scopeArtifact);
  assert.ok(buildUatPromotionRollbackAudit(scopeFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_ARTIFACT_IDENTITY_INVALID",
  ));

  const numericFixture = inputs();
  const numericArtifact = dynamicArtifact(numericFixture);
  numericArtifact.resource_gate.maximum_swap_percent_observed = "4";
  numericArtifact.resource_gate.resource_evidence_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(numericArtifact.resource_gate)
      .filter(([key]) => key !== "resource_evidence_sha256")),
  );
  numericFixture.dynamicEvidence = redigestArtifact(numericArtifact);
  assert.ok(buildUatPromotionRollbackAudit(numericFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_RESOURCE_GATE_INVALID",
  ));

  const snapshotFixture = inputs();
  const snapshotArtifact = dynamicArtifact(snapshotFixture);
  snapshotArtifact.resource_gate.samples.at(-1).oom_kill_count = 1;
  snapshotArtifact.resource_gate.oom_kill_delta = 1;
  snapshotArtifact.resource_gate.resource_evidence_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(snapshotArtifact.resource_gate)
      .filter(([key]) => key !== "resource_evidence_sha256")),
  );
  snapshotFixture.dynamicEvidence = redigestArtifact(snapshotArtifact);
  assert.ok(buildUatPromotionRollbackAudit(snapshotFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_RESOURCE_GATE_FAILED",
  ));

  const caseDigestFixture = inputs();
  const caseDigestArtifact = dynamicArtifact(caseDigestFixture);
  caseDigestArtifact.cases[0].assertions[0].evidence.production_dispatch_count = 99;
  caseDigestArtifact.cases[0].assertions[0].evidence_sha256 = dynamicDigest(
    caseDigestArtifact.cases[0].assertions[0].evidence,
  );
  caseDigestArtifact.cases[0].case_evidence_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(caseDigestArtifact.cases[0])
      .filter(([key]) => key !== "case_evidence_sha256")),
  );
  caseDigestFixture.dynamicEvidence = redigestArtifact(caseDigestArtifact);
  assert.ok(buildUatPromotionRollbackAudit(caseDigestFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_ASSERTION_SEMANTICS_INVALID",
  ));

  const observationFixture = inputs();
  const observationArtifact = dynamicArtifact(observationFixture);
  const success = observationArtifact.cases[0].scenarios[0];
  success.after.databases[0].oid = "17002";
  success.after.observation_sha256 = pythonDigest(
    Object.fromEntries(Object.entries(success.after)
      .filter(([key]) => key !== "observation_sha256")),
  );
  success.scenario_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(success).filter(([key]) => key !== "scenario_sha256")),
  );
  observationArtifact.cases[0].case_evidence_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(observationArtifact.cases[0])
      .filter(([key]) => key !== "case_evidence_sha256")),
  );
  observationFixture.dynamicEvidence = redigestArtifact(observationArtifact);
  assert.ok(buildUatPromotionRollbackAudit(observationFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_SUCCESS_AFTER_INVALID",
  ));

  const replayFixture = inputs();
  const replayArtifact = dynamicArtifact(replayFixture);
  const discardedResult = replayArtifact.cases[0].scenarios[4];
  discardedResult.mutation_ack_parsed = true;
  discardedResult.scenario_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(discardedResult)
      .filter(([key]) => key !== "scenario_sha256")),
  );
  replayArtifact.cases[0].case_evidence_sha256 = dynamicDigest(
    Object.fromEntries(Object.entries(replayArtifact.cases[0])
      .filter(([key]) => key !== "case_evidence_sha256")),
  );
  replayFixture.dynamicEvidence = redigestArtifact(replayArtifact);
  assert.ok(buildUatPromotionRollbackAudit(replayFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_CALLER_RESULT_DISCARD_INVALID",
  ));

  const runtimeFixture = inputs();
  const runtimeArtifact = dynamicArtifact(runtimeFixture);
  runtimeArtifact.runtime.container_inspect.network_mode = "bridge";
  runtimeFixture.dynamicEvidence = redigestArtifact(runtimeArtifact);
  assert.ok(buildUatPromotionRollbackAudit(runtimeFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_CONTAINER_PROJECTION_INVALID",
  ));
});

test("dynamic command output, production bindings and Git blobs are independently recomputed", () => {
  const commandFailure = (scenarioIndex, stream, text, expectedCode) => {
    const fixture = inputs();
    const artifact = dynamicArtifact(fixture);
    const command = artifact.cases[0].scenarios[scenarioIndex].command;
    const raw = Buffer.from(text, "utf8");
    command[`${stream}_base64`] = raw.toString("base64");
    command[`${stream}_sha256`] = sha256(raw);
    redigestDynamicField(command, "command_receipt_sha256");
    fixture.dynamicEvidence = redigestScenarioArtifact(artifact, scenarioIndex);
    assert.ok(buildUatPromotionRollbackAudit(fixture).errors.includes(
      `AUDIT_DYNAMIC_EVIDENCE_INVALID:${expectedCode}`,
    ));
  };
  commandFailure(1, "stderr", "", "TASK70_DYNAMIC_PRECONDITION_COMMAND_OUTPUT_INVALID");
  commandFailure(1, "stdout", "", "TASK70_DYNAMIC_PRECONDITION_COMMAND_OUTPUT_INVALID");
  commandFailure(1, "stdout", "\n\n", "TASK70_DYNAMIC_PRECONDITION_COMMAND_OUTPUT_INVALID");
  commandFailure(
    2, "stderr", "ERROR:  unrelated synthetic failure\n",
    "TASK70_DYNAMIC_PRECONDITION_COMMAND_OUTPUT_INVALID",
  );
  commandFailure(
    3, "stdout", "UNRELATED_BARRIER\n", "TASK70_DYNAMIC_FAULT_OUTPUT_INVALID",
  );
  commandFailure(
    3, "stdout", "DV70_FIRST_RENAME_REACHED\nDV70_FIRST_RENAME_REACHED\n",
    "TASK70_DYNAMIC_FAULT_OUTPUT_INVALID",
  );
  commandFailure(
    0, "stdout", "illegal-ack\n", "TASK70_DYNAMIC_MUTATION_COMMAND_OUTPUT_INVALID",
  );

  const bindingFailure = (kind, field, value) => {
    const fixture = inputs();
    const artifact = dynamicArtifact(fixture);
    const spec = artifact.cases[0].opcodes[kind].spec;
    spec.bindings[field] = value;
    redigestDynamicField(spec, "opcode_spec_sha256", pythonDigest);
    redigestDynamicField(artifact.cases[0], "case_evidence_sha256");
    fixture.dynamicEvidence = redigestArtifact(artifact);
    assert.ok(buildUatPromotionRollbackAudit(fixture).errors.includes(
      "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID",
    ));
  };
  bindingFailure("production", "staging_oid", "17002");
  bindingFailure("production", "expected_switched_identity_sha256", sha256("tampered"));
  bindingFailure("observation", "journal_state_sha256", sha256("tampered-journal"));
  bindingFailure("observation", "observation_scope_sha256", sha256("tampered-scope"));

  const gitFixture = inputs();
  const gitArtifact = dynamicArtifact(gitFixture);
  gitArtifact.source_bindings[0].git_blob = "1".repeat(40);
  gitFixture.dynamicEvidence = redigestArtifact(gitArtifact);
  assert.ok(buildUatPromotionRollbackAudit(gitFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_SOURCE_BINDING_MISMATCH",
  ));

  for (const field of ["git_commit", "git_tree"]) {
    const identityFixture = inputs();
    const identityArtifact = dynamicArtifact(identityFixture);
    identityArtifact.source[field] = field === "git_commit" ? "3".repeat(40) : "4".repeat(40);
    identityFixture.dynamicEvidence = redigestArtifact(identityArtifact);
    assert.ok(buildUatPromotionRollbackAudit(identityFixture).errors.includes(
      "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_GIT_PROJECTION_MISMATCH",
    ));
  }

  const setupFixture = inputs();
  const setupArtifact = dynamicArtifact(setupFixture);
  setupArtifact.cases[0].fixture.setup_receipt.sql_sha256 = sha256("tampered-setup");
  redigestDynamicField(
    setupArtifact.cases[0].fixture.setup_receipt, "fixture_receipt_sha256",
  );
  redigestDynamicField(setupArtifact.cases[0], "case_evidence_sha256");
  setupFixture.dynamicEvidence = redigestArtifact(setupArtifact);
  assert.ok(buildUatPromotionRollbackAudit(setupFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_FIXTURE_RECEIPT_INVALID",
  ));
});

test("dynamic policy weakening fails closed", () => {
  const fixture = inputs();
  const policyPath = TASK70_DYNAMIC_POLICY_PATH;
  const policy = JSON.parse(fixture.sourceBodies.get(policyPath));
  policy.case_catalog[0].container_limits.tmpfs["/var/lib/postgresql/data"].options =
    "rw,uid=999,gid=999,mode=0700";
  fixture.sourceBodies.set(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_POLICY_CONTAINER_LIMITS_INVALID",
  ));
  assert.equal(result.artifact.execution_readiness.may_start, false);

  const assertionFixture = inputs();
  const assertionPolicy = JSON.parse(assertionFixture.sourceBodies.get(policyPath));
  assertionPolicy.case_catalog[0].required_assertions[0] = "IRRELEVANT_ASSERTION";
  assertionFixture.sourceBodies.set(policyPath, `${JSON.stringify(assertionPolicy, null, 2)}\n`);
  assert.ok(buildUatPromotionRollbackAudit(assertionFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_POLICY_ASSERTIONS_INVALID",
  ));

  const sourceFixture = inputs();
  const sourcePolicy = JSON.parse(sourceFixture.sourceBodies.get(policyPath));
  sourcePolicy.source_paths[6] = "chenyida_erp_site/scripts/backup-selfhost.sh";
  sourceFixture.sourceBodies.set(policyPath, `${JSON.stringify(sourcePolicy, null, 2)}\n`);
  assert.ok(buildUatPromotionRollbackAudit(sourceFixture).errors.includes(
    "AUDIT_DYNAMIC_EVIDENCE_INVALID:TASK70_DYNAMIC_POLICY_SOURCE_PATHS_INVALID",
  ));
});

test("promotion start assertion fails closed while any checkpoint is incomplete", () => {
  const { artifact } = buildUatPromotionRollbackAudit(inputs());
  assert.throws(() => assertUatPromotionMayStart(artifact), (error) => error.code === "UAT_PROMOTION_EXECUTOR_NOT_READY");
  assert.throws(() => assertUatPromotionMayStart({ ...artifact, audit_validation: { result: "FAIL", errors: ["fixture"] } }), /UAT_PROMOTION_AUDIT_INVALID/);
});

test("policy cannot relabel a supported capability as missing", () => {
  const fixture = inputs();
  fixture.policy.capabilities.find((entry) => entry.id === "COMPOSE_DEPLOYMENT_RECEIPT").status = "MISSING";
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.includes("AUDIT_CAPABILITY_STATUS_DRIFT:COMPOSE_DEPLOYMENT_RECEIPT"));
});

test("fixed executor fake-root fixture must remain required in the release inventory", () => {
  const fixture = inputs();
  const entry = fixture.inventory.tests.find((item) =>
    item.path === "tests/selfhost-uat-promotion-rollback-fixed-executor.test.mjs");
  assert.ok(entry);
  entry.sha256 = "0".repeat(64);
  assert.ok(buildUatPromotionRollbackAudit(fixture).errors.includes(
    "AUDIT_FIXED_EXECUTOR_RELEASE_TEST_INVALID",
  ));
});

test("source marker drift and cross-role readiness promotion are rejected", () => {
  const markerFixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  markerFixture.sourceBodies.set(launcherPath, markerFixture.sourceBodies.get(launcherPath).replaceAll("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", "REMOVED_POSTDEPLOY_IDENTITY"));
  assert.ok(buildUatPromotionRollbackAudit(markerFixture).errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));

  const uatFixture = inputs();
  const uatPath = "chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json";
  const uat = JSON.parse(uatFixture.sourceBodies.get(uatPath));
  uat.readiness.status = "READY";
  uatFixture.sourceBodies.set(uatPath, `${JSON.stringify(uat, null, 2)}\n`);
  const errors = buildUatPromotionRollbackAudit(uatFixture).errors;
  assert.ok(errors.includes("AUDIT_CROSS_ROLE_UAT_BOUNDARY_DRIFT"));
});

test("postdeploy transaction evidence cannot regress to standalone probes", () => {
  const fixture = inputs();
  const journalPath = "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs";
  fixture.sourceBodies.set(journalPath, fixture.sourceBodies.get(journalPath).replaceAll("UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONTRACT", "REMOVED_POSTDEPLOY_CONTAINMENT"));
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(result.errors.includes("AUDIT_POSTDEPLOY_TRANSACTION_BINDING_DRIFT"));

  const bindingFixture = inputs();
  bindingFixture.sourceBodies.set(
    journalPath,
    bindingFixture.sourceBodies.get(journalPath).replaceAll(
      "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONTRACT", "REMOVED_POSTDEPLOY_CONTROL_BINDING",
    ),
  );
  const bindingResult = buildUatPromotionRollbackAudit(bindingFixture);
  assert.ok(bindingResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(bindingResult.errors.includes("AUDIT_POSTDEPLOY_TRANSACTION_BINDING_DRIFT"));
});

test("cross-role checkpoint 12 cannot regress to a standalone human template", () => {
  const fixture = inputs();
  const resultContractPath = "chenyida_erp_site/scripts/uat-promotion-cross-role-evidence-contract.mjs";
  fixture.sourceBodies.set(
    resultContractPath,
    fixture.sourceBodies.get(resultContractPath).replaceAll(
      "human_execution_authorization_sha256", "REMOVED_HUMAN_EXECUTION_AUTHORIZATION",
    ),
  );
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(result.errors.includes("AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT"));

  const interlockFixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  interlockFixture.sourceBodies.set(
    launcherPath,
    interlockFixture.sourceBodies.get(launcherPath).replaceAll(
      "SUPERVISOR_UAT_PROMOTION_CROSS_ROLE_RECOVERY_REQUIRED", "REMOVED_CROSS_ROLE_INTERLOCK",
    ),
  );
  const interlockResult = buildUatPromotionRollbackAudit(interlockFixture);
  assert.ok(interlockResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(interlockResult.errors.includes("AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT"));

  const durableFixture = inputs();
  const journalPath = "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs";
  durableFixture.sourceBodies.set(
    journalPath,
    durableFixture.sourceBodies.get(journalPath).replaceAll(
      "loadDurableCrossRoleResult", "REMOVED_DURABLE_CROSS_ROLE_RESULT",
    ),
  );
  const durableResult = buildUatPromotionRollbackAudit(durableFixture);
  assert.ok(durableResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(durableResult.errors.includes("AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT"));
});

test("final receipt cannot regress without both journal and bundle-switch recovery interlocks", () => {
  const journalFixture = inputs();
  const journalPath = "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs";
  journalFixture.sourceBodies.set(
    journalPath,
    journalFixture.sourceBodies.get(journalPath).replaceAll(
      "finalizationCheckpointAggregate", "REMOVED_FINALIZATION_AGGREGATE",
    ),
  );
  assert.ok(buildUatPromotionRollbackAudit(journalFixture).errors.includes(
    "AUDIT_FINALIZATION_TRANSACTION_BINDING_DRIFT",
  ));

  const installerFixture = inputs();
  const installerPath = "chenyida_erp_site/scripts/install-release-supervisor.py";
  installerFixture.sourceBodies.set(
    installerPath,
    installerFixture.sourceBodies.get(installerPath).replaceAll(
      "SUPERVISOR_INSTALL_UAT_PROMOTION_FINALIZATION_RECOVERY_REQUIRED",
      "REMOVED_FINALIZATION_INSTALL_INTERLOCK",
    ),
  );
  const result = buildUatPromotionRollbackAudit(installerFixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(result.errors.includes("AUDIT_FINALIZATION_TRANSACTION_BINDING_DRIFT"));
});

test("rollback checkpoints cannot regress to unbound stages or lose bundle-switch interlocks", () => {
  const controlFixture = inputs();
  const controlPath = "chenyida_erp_site/scripts/uat-promotion-rollback-control.mjs";
  controlFixture.sourceBodies.set(
    controlPath,
    controlFixture.sourceBodies.get(controlPath).replaceAll(
      "runUatPromotionRollbackControl", "REMOVED_ROLLBACK_CONTROL",
    ),
  );
  const controlResult = buildUatPromotionRollbackAudit(controlFixture);
  assert.ok(controlResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(controlResult.errors.includes("AUDIT_ROLLBACK_TRANSACTION_BINDING_DRIFT"));

  const installerFixture = inputs();
  const installerPath = "chenyida_erp_site/scripts/install-release-supervisor.py";
  installerFixture.sourceBodies.set(
    installerPath,
    installerFixture.sourceBodies.get(installerPath).replaceAll(
      "SUPERVISOR_INSTALL_UAT_PROMOTION_ROLLBACK_POSTVERIFY_REQUIRED",
      "REMOVED_ROLLBACK_INSTALL_INTERLOCK",
    ),
  );
  const installerResult = buildUatPromotionRollbackAudit(installerFixture);
  assert.ok(installerResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(installerResult.errors.includes("AUDIT_ROLLBACK_TRANSACTION_BINDING_DRIFT"));
});

test("fixed executor, v2 activation, Supervisor v7 and install interlock are all audited", () => {
  const cases = [
    [
      "chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py",
      "ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE",
      "REMOVED_FIXED_EXECUTOR_CAPABILITY_GATE",
    ],
    [
      "chenyida_erp_site/scripts/uat-promotion-rollback-runtime-activation-publisher.mjs",
      "UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN",
      "REMOVED_ACTIVATION_PARTIAL_INTERLOCK",
    ],
    [
      "chenyida_erp_site/scripts/release-supervisor-launcher.py",
      "chenyida-erp-release-supervisor-authorization/v7",
      "REMOVED_SUPERVISOR_V7_AUTHORIZATION",
    ],
    [
      "chenyida_erp_site/scripts/install-release-supervisor.py",
      "assert_no_uat_rollback_runtime_activation_interlock",
      "REMOVED_INSTALL_ACTIVATION_INTERLOCK",
    ],
  ];
  for (const [repositoryPath, marker, replacement] of cases) {
    const fixture = inputs();
    fixture.sourceBodies.set(
      repositoryPath,
      fixture.sourceBodies.get(repositoryPath).replaceAll(marker, replacement),
    );
    const result = buildUatPromotionRollbackAudit(fixture);
    assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
    assert.ok(result.errors.includes("AUDIT_ROLLBACK_RUNTIME_BOUNDARY_DRIFT"));
  }
});

test("a declared promotion operation cannot disappear from the audited implementation", () => {
  const fixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  fixture.sourceBodies.set(launcherPath, fixture.sourceBodies.get(launcherPath).replace(
    '    "QUIESCE_UAT_WRITERS": "QUIESCE_WRITERS",\n',
    "",
  ));
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_IMPLEMENTED_OPERATION_DRIFT:")
    && entry.includes("ROLLBACK_UAT_RELEASE") && entry.includes("VERIFY_AND_FINALIZE_UAT_ROLLBACK")));
});

test("artifact is deterministic and self-digested", () => {
  const first = buildUatPromotionRollbackAudit(inputs());
  const second = buildUatPromotionRollbackAudit(inputs());
  assert.equal(canonicalJson(first.artifact), canonicalJson(second.artifact));
  const { artifact_sha256: actual, ...body } = first.artifact;
  assert.equal(actual, sha256(canonicalJson(body)));
  assert.equal(first.manifest.sha256, sha256(canonicalJson(first.manifest.files)));
});

test("committed audit artifact and Markdown are exact generator outputs", async () => {
  const result = buildUatPromotionRollbackAudit(inputs());
  const artifactRaw = await readFile(new URL(`../../${UAT_PROMOTION_AUDIT_ARTIFACT_PATH}`, import.meta.url), "utf8");
  const markdownRaw = await readFile(new URL(`../../${UAT_PROMOTION_AUDIT_MARKDOWN_PATH}`, import.meta.url), "utf8");
  assert.equal(artifactRaw, `${JSON.stringify(JSON.parse(artifactRaw), null, 2)}\n`);
  assert.equal(canonicalJson(JSON.parse(artifactRaw)), canonicalJson(result.artifact));
  assert.equal(markdownRaw, result.markdown);
});
