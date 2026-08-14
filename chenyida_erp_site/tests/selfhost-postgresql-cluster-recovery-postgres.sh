#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

SITE_ROOT=/workspace
cd "$SITE_ROOT"
TASK_ROOT=$(mktemp -d /tmp/cyd-cluster-recovery-postgres.XXXXXX)
chmod 0711 "$TASK_ROOT"
SOURCE_PGDATA="$TASK_ROOT/source-pgdata"
SOURCE_SOCKET="$TASK_ROOT/source-socket"
SOURCE_LOG="$SOURCE_PGDATA/postgres.log"
SOURCE_TABLESPACE_ROOT="$TASK_ROOT/source-tablespaces"
SOURCE_TABLESPACE="$SOURCE_TABLESPACE_ROOT/erp_ts"
TARGET_PGDATA="$TASK_ROOT/target-pgdata"
TARGET_SOCKET="$TASK_ROOT/target-socket"
TARGET_LOG="$TARGET_PGDATA/postgres.log"
TARGET_TABLESPACE_ROOT="$TASK_ROOT/target-tablespaces"
TARGET_TABLESPACE="$TARGET_TABLESPACE_ROOT/erp_ts"
SOURCE_RUNNING=0
TARGET_RUNNING=0

stop_cluster() {
  data=$1
  [ -s "$data/postmaster.pid" ] || return 0
  gosu postgres pg_ctl -D "$data" -m fast -w stop >/dev/null 2>&1
}

cleanup() {
  cleanup_status=0
  [ "$TARGET_RUNNING" = 0 ] || stop_cluster "$TARGET_PGDATA" || cleanup_status=1
  [ "$SOURCE_RUNNING" = 0 ] || stop_cluster "$SOURCE_PGDATA" || cleanup_status=1
  case "$TASK_ROOT" in
    /tmp/cyd-cluster-recovery-postgres.*) rm -rf -- "$TASK_ROOT" || cleanup_status=1 ;;
    *) echo "refusing unsafe cluster recovery test cleanup" >&2; cleanup_status=1 ;;
  esac
  [ "$cleanup_status" = 0 ] || exit 1
}

on_signal() {
  signal_status=$1
  trap - EXIT HUP INT TERM
  cleanup
  exit "$signal_status"
}

trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

initialize_cluster() {
  data=$1
  socket=$2
  install -d -m 0700 -o postgres -g postgres "$data" "$socket"
  gosu postgres initdb -D "$data" --auth-local=trust --auth-host=scram-sha-256 --locale=C --encoding=UTF8 >/dev/null
  {
    printf 'local all postgres trust\n'
    printf 'local all all scram-sha-256\n'
    printf 'host all all 127.0.0.1/32 reject\n'
    printf 'host all all ::1/128 reject\n'
  } > "$data/pg_hba.conf"
  chown postgres:postgres "$data/pg_hba.conf"
  chmod 0600 "$data/pg_hba.conf"
}

start_cluster() {
  data=$1
  socket=$2
  log=$3
  gosu postgres pg_ctl -D "$data" -l "$log" -o "-k $socket -c listen_addresses='' -c max_connections=20 -c shared_buffers=64MB -c work_mem=4MB -c maintenance_work_mem=32MB -c password_encryption=scram-sha-256 -c wal_level=logical -c max_wal_senders=2" -w start >/dev/null
}

capture_catalog() {
  socket=$1
  output=$2
  PGHOST="$socket" PGUSER=postgres PGDATABASE=chenyida_erp psql -X -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 \
    -v expected_database=chenyida_erp -v migration_owner=chenyida_erp_owner -v runtime_login=chenyida_erp_runtime -v privilege_group=chenyida_erp_rw \
    -o "$output" -f "$SITE_ROOT/scripts/postgresql-cluster-catalog.sql"
  chmod 0600 "$output"
}

initialize_cluster "$SOURCE_PGDATA" "$SOURCE_SOCKET"
install -d -m 0700 -o postgres -g postgres "$SOURCE_TABLESPACE_ROOT" "$SOURCE_TABLESPACE"
start_cluster "$SOURCE_PGDATA" "$SOURCE_SOCKET" "$SOURCE_LOG"
SOURCE_RUNNING=1
export PGHOST="$SOURCE_SOCKET" PGUSER=postgres PGDATABASE=postgres

psql -X -v ON_ERROR_STOP=1 -v source_tablespace="$SOURCE_TABLESPACE" <<'SQL' >/dev/null
CREATE ROLE chenyida_erp_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 2 PASSWORD NULL;
CREATE ROLE chenyida_erp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 32 PASSWORD NULL;
CREATE ROLE chenyida_erp_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT -1 PASSWORD NULL;
GRANT chenyida_erp_rw TO chenyida_erp_runtime WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
CREATE TABLESPACE erp_ts OWNER chenyida_erp_owner LOCATION :'source_tablespace';
CREATE DATABASE chenyida_erp OWNER chenyida_erp_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' TABLESPACE pg_default CONNECTION LIMIT 64;
REVOKE ALL ON DATABASE chenyida_erp FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE chenyida_erp TO chenyida_erp_rw;
SQL

PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
SET ROLE chenyida_erp_owner;
CREATE EXTENSION pgcrypto;
CREATE EXTENSION btree_gist;
CREATE SCHEMA app AUTHORIZATION chenyida_erp_owner;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO chenyida_erp_rw;
CREATE TYPE app.material_state AS ENUM ('ACTIVE', 'INACTIVE');
REVOKE ALL ON TYPE app.material_state FROM PUBLIC;
GRANT USAGE ON TYPE app.material_state TO chenyida_erp_rw;
CREATE TABLE app.materials (
  id bigint GENERATED ALWAYS AS IDENTITY,
  internal_code text NOT NULL,
  state app.material_state NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (id) USING INDEX TABLESPACE erp_ts,
  UNIQUE (internal_code)
) TABLESPACE erp_ts;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.materials TO chenyida_erp_rw;
GRANT SELECT (internal_code) ON TABLE app.materials TO chenyida_erp_rw;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE app.materials_id_seq TO chenyida_erp_rw;
INSERT INTO app.materials(internal_code) VALUES ('MAT-SYNTHETIC-001');
CREATE VIEW app.active_materials AS SELECT id, internal_code FROM app.materials WHERE state = 'ACTIVE';
REVOKE ALL ON TABLE app.active_materials FROM PUBLIC;
GRANT SELECT ON TABLE app.active_materials TO chenyida_erp_rw;
CREATE MATERIALIZED VIEW app.material_counts AS SELECT state, count(*) AS count FROM app.materials GROUP BY state;
REVOKE ALL ON TABLE app.material_counts FROM PUBLIC;
GRANT SELECT ON TABLE app.material_counts TO chenyida_erp_rw;
CREATE TABLE app.material_events(id bigint NOT NULL, happened_at timestamptz NOT NULL) PARTITION BY RANGE (happened_at);
CREATE TABLE app.material_events_2026 PARTITION OF app.material_events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') TABLESPACE erp_ts;
CREATE INDEX material_events_id_idx ON ONLY app.material_events(id);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.material_events, app.material_events_2026 TO chenyida_erp_rw;
CREATE FUNCTION app.find_material(input_code text) RETURNS bigint LANGUAGE sql STABLE AS 'SELECT id FROM app.materials WHERE internal_code = input_code';
REVOKE ALL ON FUNCTION app.find_material(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_material(text) TO chenyida_erp_rw;
CREATE PUBLICATION erp_publication FOR TABLE app.materials;
SELECT lo_from_bytea(0, decode('73796e7468657469632d636c75737465722d6c617267652d6f626a656374', 'hex')) AS synthetic_loid \gset
GRANT SELECT, UPDATE ON LARGE OBJECT :synthetic_loid TO chenyida_erp_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE chenyida_erp_owner IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chenyida_erp_rw;
CREATE TABLE app.default_privilege_probe(id bigint PRIMARY KEY, payload text NOT NULL);
INSERT INTO app.default_privilege_probe VALUES (1, 'default-privilege-proof');
RESET ROLE;
SQL

SOURCE_SYSTEM_ID=$(PGDATABASE=chenyida_erp psql -X -Atc 'select system_identifier from pg_control_system()')
SOURCE_DATABASE_OID=$(PGDATABASE=chenyida_erp psql -X -Atc 'select oid from pg_database where datname=current_database()')
SOURCE_PROFILE=$(PGDATABASE=chenyida_erp psql -X -At -F '|' -c "select ((current_setting('server_version_num')::integer/10000)::text),pg_encoding_to_char(d.encoding),case d.datlocprovider when 'c' then 'libc' when 'i' then 'icu' when 'b' then 'builtin' else 'unknown' end,d.datcollate,d.datctype,coalesce(d.datcollversion,'NONE') from pg_database d where d.datname=current_database()")
old_ifs=$IFS
IFS='|'
set -- $SOURCE_PROFILE
IFS=$old_ifs
[ "$#" -eq 6 ] || { echo "source cluster profile is incomplete" >&2; exit 1; }
SOURCE_MAJOR=$1
SOURCE_ENCODING=$2
SOURCE_LOCALE_PROVIDER=$3
SOURCE_COLLATE=$4
SOURCE_CTYPE=$5
SOURCE_COLLATION_VERSION=$6
[ "$SOURCE_MAJOR" = 17 ] && [ "$SOURCE_LOCALE_PROVIDER" = libc ] || { echo "source cluster profile is unsupported" >&2; exit 1; }

SOURCE_BEFORE="$TASK_ROOT/source-before.tsv"
SOURCE_AFTER="$TASK_ROOT/source-after.tsv"
capture_catalog "$SOURCE_SOCKET" "$SOURCE_BEFORE"
PGDATABASE=chenyida_erp pg_dump --format=custom --no-owner --no-acl --file="$TASK_ROOT/postgresql.dump"
chmod 0600 "$TASK_ROOT/postgresql.dump"
capture_catalog "$SOURCE_SOCKET" "$SOURCE_AFTER"

install -d -m 0700 -o postgres -g postgres "$TARGET_TABLESPACE_ROOT" "$TARGET_TABLESPACE"
POLICY_FILE="$SITE_ROOT/operations/postgresql-cluster-recovery-policy-v1.json"
TASK_ROOT="$TASK_ROOT" SOURCE_BEFORE="$SOURCE_BEFORE" SOURCE_AFTER="$SOURCE_AFTER" POLICY_FILE="$POLICY_FILE" \
SOURCE_SYSTEM_ID="$SOURCE_SYSTEM_ID" SOURCE_DATABASE_OID="$SOURCE_DATABASE_OID" SOURCE_MAJOR="$SOURCE_MAJOR" SOURCE_ENCODING="$SOURCE_ENCODING" \
SOURCE_LOCALE_PROVIDER="$SOURCE_LOCALE_PROVIDER" SOURCE_COLLATE="$SOURCE_COLLATE" SOURCE_CTYPE="$SOURCE_CTYPE" SOURCE_COLLATION_VERSION="$SOURCE_COLLATION_VERSION" \
TARGET_TABLESPACE_ROOT="$TARGET_TABLESPACE_ROOT" TARGET_TABLESPACE="$TARGET_TABLESPACE" TARGET_PGDATA="$TARGET_PGDATA" SOURCE_PGDATA="$SOURCE_PGDATA" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import {
  canonicalClusterJson,
  clusterSha256,
  createClusterSnapshot,
  validateTablespaceMap,
} from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
import { parseClusterCatalogReport } from "/workspace/scripts/postgresql-cluster-catalog-contract.mjs";
import { createClusterRestorePlan } from "/workspace/scripts/postgresql-cluster-restore-contract.mjs";

const env = process.env;
const policy = JSON.parse(readFileSync(env.POLICY_FILE, "utf8"));
const before = parseClusterCatalogReport(readFileSync(env.SOURCE_BEFORE, "utf8"), policy);
const after = parseClusterCatalogReport(readFileSync(env.SOURCE_AFTER, "utf8"), policy);
const profile = {
  server_major: env.SOURCE_MAJOR,
  encoding: env.SOURCE_ENCODING,
  locale_provider: env.SOURCE_LOCALE_PROVIDER,
  collate: env.SOURCE_COLLATE,
  ctype: env.SOURCE_CTYPE,
  collation_version: env.SOURCE_COLLATION_VERSION === "NONE" ? null : env.SOURCE_COLLATION_VERSION,
};
const binding = {
  backup_id: "backup-cluster-synthetic-1",
  manifest_sha256: "1".repeat(64),
  local_receipt_sha256: "2".repeat(64),
  recovery_point_at: "2026-08-13T08:00:00.000Z",
  source: { system_identifier: env.SOURCE_SYSTEM_ID, database_oid: env.SOURCE_DATABASE_OID, database_marker: "synthetic-cluster-source", postgresql_major: env.SOURCE_MAJOR },
  application: { git_commit: "a".repeat(40), version: "0.1.0-alpha.46", migration_head: "0045_selfhost_release_gate.sql", migration_manifest_sha256: "3".repeat(64) },
};
const snapshot = createClusterSnapshot({ snapshotId: "cluster-snapshot-synthetic-1", capturedAt: "2026-08-13T08:01:00.000Z", binding, policy, beforeCatalog: before, afterCatalog: after });
const namespace = clusterSha256("single-container-dual-cluster-namespace");
const tablespaceMap = {
  schema_version: 2,
  contract: "chenyida-erp-postgresql-tablespace-map/v2",
  map_id: "cluster-map-synthetic-1",
  snapshot_sha256: snapshot.snapshot_sha256,
  evidence_scope: "SYNTHETIC_TEST_ONLY",
  approved_host_root: env.TARGET_TABLESPACE_ROOT,
  approved_server_root: env.TARGET_TABLESPACE_ROOT,
  namespace_identity_sha256: namespace,
  namespace_metadata: { uid: 999, gid: 999, mode: "0700" },
  path_metadata: { uid: 999, gid: 999, mode: "0700" },
  entries: [{ name: "erp_ts", host_path: env.TARGET_TABLESPACE, server_path: env.TARGET_TABLESPACE }],
};
const missingMap = structuredClone(tablespaceMap);
missingMap.entries = [];
let missingRejected = false;
try { createClusterRestorePlan({ snapshot, policy, tablespaceMap: missingMap, databaseProfile: profile }); } catch (error) { missingRejected = error?.code === "TABLESPACE_MAP_NAME_SET_MISMATCH"; }
if (!missingRejected) throw new Error("missing tablespace map was not rejected");
const validation = await validateTablespaceMap({
  map: tablespaceMap,
  snapshot,
  policy,
  expectedUid: 999,
  expectedGid: 999,
  prohibitedRoots: [env.TARGET_PGDATA, env.SOURCE_PGDATA, "/workspace"],
  expectedNamespaceIdentitySha256: namespace,
  evidenceScope: "SYNTHETIC_TEST_ONLY",
});
const plan = createClusterRestorePlan({ snapshot, policy, tablespaceMap, databaseProfile: profile });
const write = (name, value) => writeFileSync(`${env.TASK_ROOT}/${name}`, typeof value === "string" ? value : canonicalClusterJson(value), { flag: "wx", mode: 0o600 });
write("snapshot.json", snapshot);
write("tablespace-map.json", tablespaceMap);
write("tablespace-preflight.json", validation);
write("database-profile.json", profile);
write("plan.json", plan);
write("role-skeleton.sql", plan.role_skeleton.sql);
write("tablespace.sql", plan.tablespaces[0].sql);
write("database.sql", plan.database.sql);
write("security.sql", plan.security.sql);
write("activation.sql", plan.activation.sql);
write("quarantine.sql", plan.quarantine.sql);
NODE

stop_cluster "$SOURCE_PGDATA"
SOURCE_RUNNING=0
unset PGHOST PGDATABASE
initialize_cluster "$TARGET_PGDATA" "$TARGET_SOCKET"
start_cluster "$TARGET_PGDATA" "$TARGET_SOCKET" "$TARGET_LOG"
TARGET_RUNNING=1
export PGHOST="$TARGET_SOCKET" PGUSER=postgres PGDATABASE=postgres
TARGET_SYSTEM_ID=$(psql -X -Atc 'select system_identifier from pg_control_system()')
[ "$TARGET_SYSTEM_ID" != "$SOURCE_SYSTEM_ID" ] || { echo "source and target PostgreSQL system identifiers are not distinct" >&2; exit 1; }

psql -X -v ON_ERROR_STOP=1 -c 'CREATE ROLE chenyida_erp_owner NOLOGIN' >/dev/null
if psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/role-skeleton.sql" >"$TASK_ROOT/role-collision.log" 2>&1; then
  echo "role collision unexpectedly allowed a partial skeleton" >&2
  exit 1
fi
[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime','chenyida_erp_rw')")" = 1 ]
psql -X -v ON_ERROR_STOP=1 -c 'DROP ROLE chenyida_erp_owner' >/dev/null

STATE_ROOT="$TASK_ROOT/recovery-state"
mkdir -m 0700 "$STATE_ROOT"
printf 'chenyida-erp-postgresql-recovery-state-root/v1\n' > "$STATE_ROOT/.chenyida-erp-postgresql-recovery-state-root-v1"
chmod 0400 "$STATE_ROOT/.chenyida-erp-postgresql-recovery-state-root-v1"
PSQL_EXECUTOR=/usr/lib/postgresql/17/bin/psql
[ -x "$PSQL_EXECUTOR" ] && [ ! -L "$PSQL_EXECUTOR" ] || { echo "trusted psql executable is unavailable" >&2; exit 1; }

initialize_recovery_state() {
  recovery_run_id=$1
  recovery_created_at=$2
  TASK_ROOT="$TASK_ROOT" STATE_ROOT="$STATE_ROOT" RUN_ID="$recovery_run_id" CREATED_AT="$recovery_created_at" TARGET_SYSTEM_ID="$TARGET_SYSTEM_ID" \
  node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import {
  clusterSha256,
  createInitialRecoveryState,
  createRecoveryIntent,
  writeRecoveryIntent,
  writeRecoveryState,
} from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
import { expectedRecoveryIntentBindings } from "/workspace/scripts/postgresql-cluster-recovery-executor.mjs";
const env = process.env;
const read = (name) => JSON.parse(readFileSync(`${env.TASK_ROOT}/${name}`, "utf8"));
const snapshot = read("snapshot.json"), plan = read("plan.json"), tablespaceMap = read("tablespace-map.json"), databaseProfile = read("database-profile.json");
const policy = JSON.parse(readFileSync("/workspace/operations/postgresql-cluster-recovery-policy-v1.json", "utf8"));
const bindings = expectedRecoveryIntentBindings({ plan, snapshot, policy, tablespaceMap, databaseProfile });
const intent = createRecoveryIntent({
  restore_run_id: env.RUN_ID,
  backup_id: bindings.backup_id,
  created_at: env.CREATED_AT,
  evidence_scope: bindings.evidence_scope,
  policy_sha256: bindings.policy_sha256,
  snapshot_sha256: bindings.snapshot_sha256,
  data_transfer_acceptance_sha256: "4".repeat(64),
  cluster_transfer_acceptance_sha256: "5".repeat(64),
  joint_transfer_sha256: "6".repeat(64),
  target_system_identifier_sha256: clusterSha256(env.TARGET_SYSTEM_ID),
  target_empty_state_sha256: clusterSha256(`synthetic-empty-target:${env.RUN_ID}`),
  credential_generation_id: `generation-${env.RUN_ID}`,
  credential_role_set_sha256: bindings.credential_role_set_sha256,
  tablespace_map_sha256: bindings.tablespace_map_sha256,
  custom_tablespace_identity_sha256: [...bindings.custom_tablespace_identity_sha256],
});
await writeRecoveryIntent({ stateRoot: env.STATE_ROOT, intent });
await writeRecoveryState({ stateRoot: env.STATE_ROOT, intent, state: createInitialRecoveryState(intent, env.CREATED_AT) });
NODE
}

record_role_skeleton_state() {
  recovery_run_id=$1
  TASK_ROOT="$TASK_ROOT" STATE_ROOT="$STATE_ROOT" RUN_ID="$recovery_run_id" \
  node --input-type=module <<'NODE'
import {
  readRecoveryExecution,
  transitionRecoveryState,
  writeRecoveryState,
} from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
const env = process.env, execution = await readRecoveryExecution({ stateRoot: env.STATE_ROOT, restoreRunId: env.RUN_ID });
const state = transitionRecoveryState(execution.current, execution.intent, {
  phase: "ROLE_SKELETON_APPLIED",
  recordedAt: new Date(Date.parse(execution.current.recorded_at) + 1000).toISOString(),
});
await writeRecoveryState({ stateRoot: env.STATE_ROOT, intent: execution.intent, state });
NODE
}

run_recovery_cli() {
  recovery_command=$1
  recovery_run_id=$2
  recovery_confirmation=$3
  node "$SITE_ROOT/scripts/postgresql-cluster-recovery-executor.mjs" "$recovery_command" \
    --state-root "$STATE_ROOT" \
    --restore-run-id "$recovery_run_id" \
    --plan "$TASK_ROOT/plan.json" \
    --snapshot "$TASK_ROOT/snapshot.json" \
    --policy "$POLICY_FILE" \
    --tablespace-map "$TASK_ROOT/tablespace-map.json" \
    --tablespace-preflight "$TASK_ROOT/tablespace-preflight.json" \
    --database-profile "$TASK_ROOT/database-profile.json" \
    --psql "$PSQL_EXECUTOR" \
    --pg-host "$TARGET_SOCKET" \
    --pg-port 5432 \
    --pg-user postgres \
    --confirm "$recovery_confirmation" >/dev/null
}

COMPENSATION_RUN=cluster-compensation-synthetic-1
initialize_recovery_state "$COMPENSATION_RUN" 2026-08-13T08:02:00.000Z
psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/role-skeleton.sql" >/dev/null
[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime','chenyida_erp_rw') and not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls")" = 3 ]
record_role_skeleton_state "$COMPENSATION_RUN"

TASK_ROOT="$TASK_ROOT" STATE_ROOT="$STATE_ROOT" RUN_ID="$COMPENSATION_RUN" TARGET_SOCKET="$TARGET_SOCKET" PSQL_EXECUTOR="$PSQL_EXECUTOR" \
node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { readRecoveryExecution } from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
import {
  PsqlClusterRecoveryAdapter,
  RECOVERY_EXECUTOR_CONFIRMATION,
  executeNextNontransactionalRecoveryStep,
} from "/workspace/scripts/postgresql-cluster-recovery-executor.mjs";
const env = process.env, read = (name) => JSON.parse(readFileSync(`${env.TASK_ROOT}/${name}`, "utf8"));
const execution = await readRecoveryExecution({ stateRoot: env.STATE_ROOT, restoreRunId: env.RUN_ID });
const input = {
  stateRoot: env.STATE_ROOT,
  intent: execution.intent,
  plan: read("plan.json"),
  snapshot: read("snapshot.json"),
  policy: JSON.parse(readFileSync("/workspace/operations/postgresql-cluster-recovery-policy-v1.json", "utf8")),
  tablespaceMap: read("tablespace-map.json"),
  tablespacePreflight: read("tablespace-preflight.json"),
  databaseProfile: read("database-profile.json"),
  adapter: new PsqlClusterRecoveryAdapter({ psqlPath: env.PSQL_EXECUTOR, connectionEnvironment: { PGHOST: env.TARGET_SOCKET, PGPORT: "5432", PGUSER: "postgres" } }),
  confirmation: RECOVERY_EXECUTOR_CONFIRMATION,
  faultInjector(stage) { if (stage === "AFTER_INITIAL_COMMAND") throw new Error("EXPECTED_TABLESPACE_RESPONSE_LOSS"); },
};
let observed = false;
try { await executeNextNontransactionalRecoveryStep(input); } catch (error) {
  observed = error?.message === "EXPECTED_TABLESPACE_RESPONSE_LOSS";
  if (!observed) throw new Error(`tablespace executor failed before injection: ${error?.code ?? "UNKNOWN"}`);
}
if (!observed) throw new Error("tablespace response-loss crash was not observed");
NODE

run_recovery_cli next "$COMPENSATION_RUN" EXECUTE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1
[ "$(psql -X -Atc "select pg_tablespace_location(oid) from pg_tablespace where spcname='erp_ts'")" = "$TARGET_TABLESPACE" ]

TASK_ROOT="$TASK_ROOT" STATE_ROOT="$STATE_ROOT" RUN_ID="$COMPENSATION_RUN" TARGET_SOCKET="$TARGET_SOCKET" PSQL_EXECUTOR="$PSQL_EXECUTOR" \
node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { readRecoveryExecution } from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
import {
  PsqlClusterRecoveryAdapter,
  RECOVERY_EXECUTOR_CONFIRMATION,
  executeNextNontransactionalRecoveryStep,
} from "/workspace/scripts/postgresql-cluster-recovery-executor.mjs";
const env = process.env, read = (name) => JSON.parse(readFileSync(`${env.TASK_ROOT}/${name}`, "utf8"));
const execution = await readRecoveryExecution({ stateRoot: env.STATE_ROOT, restoreRunId: env.RUN_ID });
const input = {
  stateRoot: env.STATE_ROOT,
  intent: execution.intent,
  plan: read("plan.json"),
  snapshot: read("snapshot.json"),
  policy: JSON.parse(readFileSync("/workspace/operations/postgresql-cluster-recovery-policy-v1.json", "utf8")),
  tablespaceMap: read("tablespace-map.json"),
  tablespacePreflight: read("tablespace-preflight.json"),
  databaseProfile: read("database-profile.json"),
  adapter: new PsqlClusterRecoveryAdapter({ psqlPath: env.PSQL_EXECUTOR, connectionEnvironment: { PGHOST: env.TARGET_SOCKET, PGPORT: "5432", PGUSER: "postgres" } }),
  confirmation: RECOVERY_EXECUTOR_CONFIRMATION,
  faultInjector(stage) { if (stage === "AFTER_DISPATCH_DURABLE") throw new Error("EXPECTED_DATABASE_PRE_DISPATCH_CRASH"); },
};
let observed = false;
try { await executeNextNontransactionalRecoveryStep(input); } catch (error) {
  observed = error?.message === "EXPECTED_DATABASE_PRE_DISPATCH_CRASH";
  if (!observed) throw new Error(`database executor failed before injection: ${error?.code ?? "UNKNOWN"}`);
}
if (!observed) throw new Error("database pre-dispatch crash was not observed");
NODE

run_recovery_cli next "$COMPENSATION_RUN" EXECUTE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1
[ "$(psql -X -Atc "select datconnlimit from pg_database where datname='chenyida_erp'")" = 0 ]

PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/quarantine.sql" >/dev/null
STATE_ROOT="$STATE_ROOT" RUN_ID="$COMPENSATION_RUN" node --input-type=module <<'NODE'
import { readRecoveryExecution, transitionRecoveryState, writeRecoveryState } from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
const env = process.env, execution = await readRecoveryExecution({ stateRoot: env.STATE_ROOT, restoreRunId: env.RUN_ID });
const state = transitionRecoveryState(execution.current, execution.intent, {
  phase: "QUARANTINED",
  operation: execution.current.operation,
  recordedAt: execution.current.recorded_at,
});
await writeRecoveryState({ stateRoot: env.STATE_ROOT, intent: execution.intent, state });
NODE
run_recovery_cli compensate "$COMPENSATION_RUN" COMPENSATE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1
[ "$(psql -X -Atc "select count(*) from pg_database where datname='chenyida_erp'")" = 0 ]
[ "$(psql -X -Atc "select count(*) from pg_tablespace where spcname='erp_ts'")" = 0 ]
[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime','chenyida_erp_rw')")" = 0 ]
[ -z "$(ls -A "$TARGET_TABLESPACE")" ]

RECOVERY_RUN=cluster-restore-synthetic-1
initialize_recovery_state "$RECOVERY_RUN" 2026-08-13T08:10:00.000Z
psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/role-skeleton.sql" >/dev/null
record_role_skeleton_state "$RECOVERY_RUN"
run_recovery_cli next "$RECOVERY_RUN" EXECUTE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1
run_recovery_cli next "$RECOVERY_RUN" EXECUTE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_V1
[ "$(psql -X -Atc "select pg_tablespace_location(oid) from pg_tablespace where spcname='erp_ts'")" = "$TARGET_TABLESPACE" ]
[ "$(psql -X -Atc "select datconnlimit from pg_database where datname='chenyida_erp'")" = 0 ]

pg_restore --dbname=chenyida_erp --role=chenyida_erp_owner --no-owner --no-acl --exit-on-error --single-transaction "$TASK_ROOT/postgresql.dump"
PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/security.sql" >/dev/null
[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime') and rolcanlogin")" = 0 ]
[ "$(psql -X -Atc "select datconnlimit from pg_database where datname='chenyida_erp'")" = 0 ]

CREDENTIAL_ROOT="$TASK_ROOT/credentials"
mkdir -m 0700 "$CREDENTIAL_ROOT"
printf 'chenyida-erp-postgresql-credential-root/v1\n' > "$CREDENTIAL_ROOT/.chenyida-erp-postgresql-credential-root-v1"
chmod 0400 "$CREDENTIAL_ROOT/.chenyida-erp-postgresql-credential-root-v1"
CREDENTIAL_FILE="$CREDENTIAL_ROOT/binding.json"
CREDENTIAL_FILE="$CREDENTIAL_FILE" node --input-type=module <<'NODE'
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { canonicalClusterJson } from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
const value = {
  schema_version: 1,
  contract: "chenyida-erp-postgresql-credential-binding/v1",
  credential_generation_id: "cluster-synthetic-generation-1",
  roles: [
    { role: "chenyida_erp_owner", password: randomBytes(32).toString("base64url") },
    { role: "chenyida_erp_runtime", password: randomBytes(32).toString("base64url") },
  ],
};
writeFileSync(process.env.CREDENTIAL_FILE, canonicalClusterJson(value), { flag: "wx", mode: 0o400 });
NODE
chmod 0400 "$CREDENTIAL_FILE"

CREDENTIAL_ROOT="$CREDENTIAL_ROOT" CREDENTIAL_FILE="$CREDENTIAL_FILE" POLICY_FILE="$POLICY_FILE" TARGET_SOCKET="$TARGET_SOCKET" TASK_ROOT="$TASK_ROOT" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import {
  canonicalClusterJson,
  createCredentialBindingReceipt,
  readCredentialBindingFile,
} from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
import { bindClusterCredentialsWithPsql } from "/workspace/scripts/postgresql-cluster-restore-contract.mjs";
const env = process.env;
const policy = JSON.parse(readFileSync(env.POLICY_FILE, "utf8"));
const binding = await readCredentialBindingFile({ credentialRoot: env.CREDENTIAL_ROOT, credentialFile: env.CREDENTIAL_FILE, policy, evidenceScope: "SYNTHETIC_TEST_ONLY" });
const applied = await bindClusterCredentialsWithPsql({
  binding,
  policy,
  psqlPath: "/usr/bin/psql",
  connectionEnvironment: { PGHOST: env.TARGET_SOCKET, PGUSER: "postgres", PGDATABASE: "postgres" },
});
if (applied.roleCount !== 2) throw new Error("credential role count mismatch");
const receipt = createCredentialBindingReceipt({ binding, backupId: "backup-cluster-synthetic-1", restoreRunId: "cluster-restore-synthetic-1", boundAt: "2026-08-13T08:03:00.000Z" });
writeFileSync(`${env.TASK_ROOT}/credential-receipt.json`, canonicalClusterJson(receipt), { flag: "wx", mode: 0o600 });
NODE

[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime') and rolcanlogin")" = 0 ]
PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/activation.sql" >/dev/null
[ "$(psql -X -Atc "select datconnlimit from pg_database where datname='chenyida_erp'")" = 64 ]

CREDENTIAL_ROOT="$CREDENTIAL_ROOT" CREDENTIAL_FILE="$CREDENTIAL_FILE" POLICY_FILE="$POLICY_FILE" TARGET_SOCKET="$TARGET_SOCKET" \
node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import pg from "pg";
import { credentialPassword, readCredentialBindingFile } from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
const { Client } = pg;
const env = process.env;
const policy = JSON.parse(readFileSync(env.POLICY_FILE, "utf8"));
const binding = await readCredentialBindingFile({ credentialRoot: env.CREDENTIAL_ROOT, credentialFile: env.CREDENTIAL_FILE, policy, evidenceScope: "SYNTHETIC_TEST_ONLY" });
const connect = async (role, password = credentialPassword(binding, role)) => {
  const client = new Client({ host: env.TARGET_SOCKET, database: "chenyida_erp", user: role, password, ssl: false });
  await client.connect();
  return client;
};
const runtime = await connect("chenyida_erp_runtime");
try {
  const selected = await runtime.query("select internal_code from app.materials where id=1");
  if (selected.rows[0]?.internal_code !== "MAT-SYNTHETIC-001") throw new Error("runtime select failed");
  const routine = await runtime.query("select app.find_material($1) as id", ["MAT-SYNTHETIC-001"]);
  if (routine.rows[0]?.id !== "1") throw new Error("runtime routine failed");
  await runtime.query("begin");
  await runtime.query("insert into app.materials(internal_code) values($1)", ["MAT-SYNTHETIC-RUNTIME"]);
  await runtime.query("update app.materials set state='INACTIVE' where internal_code=$1", ["MAT-SYNTHETIC-RUNTIME"]);
  await runtime.query("delete from app.materials where internal_code=$1", ["MAT-SYNTHETIC-RUNTIME"]);
  await runtime.query("rollback");
  let ddlDenied = false;
  try { await runtime.query("create table app.runtime_forbidden(id integer)"); } catch { ddlDenied = true; }
  if (!ddlDenied) throw new Error("runtime DDL was not denied");
  let setOwnerDenied = false;
  try { await runtime.query("set role chenyida_erp_owner"); } catch { setOwnerDenied = true; }
  if (!setOwnerDenied) throw new Error("runtime SET ROLE owner was not denied");
} finally {
  await runtime.end();
}
const owner = await connect("chenyida_erp_owner");
try {
  await owner.query("create table app.owner_probe(id integer)");
  await owner.query("drop table app.owner_probe");
} finally {
  await owner.end();
}
let wrongPasswordDenied = false;
try {
  const wrong = await connect("chenyida_erp_runtime", "definitely-wrong-synthetic-password");
  await wrong.end();
} catch { wrongPasswordDenied = true; }
if (!wrongPasswordDenied) throw new Error("wrong runtime password was not denied");
NODE

psql -X -v ON_ERROR_STOP=1 -c 'CREATE ROLE unauthorized_probe LOGIN PASSWORD NULL' >/dev/null
[ "$(psql -X -Atc "select has_database_privilege('unauthorized_probe','chenyida_erp','CONNECT')")" = f ]
if PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 -c 'SET ROLE unauthorized_probe; SELECT count(*) FROM app.materials' >"$TASK_ROOT/unauthorized.log" 2>&1; then
  echo "unauthorized role unexpectedly read application data" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -c 'DROP ROLE unauthorized_probe' >/dev/null

TARGET_REPORT="$TASK_ROOT/target.tsv"
capture_catalog "$TARGET_SOCKET" "$TARGET_REPORT"
TABLESPACE_CHILD=$(find "$TARGET_TABLESPACE" -mindepth 1 -maxdepth 1 -printf '%f\n')
[ "$TABLESPACE_CHILD" = PG_17_202406281 ] || { echo "target tablespace version directory is invalid" >&2; exit 1; }
[ "$(stat -c '%F|%u|%g|%a' "$TARGET_TABLESPACE/$TABLESPACE_CHILD")" = 'directory|999|999|700' ] || { echo "target tablespace version directory identity is invalid" >&2; exit 1; }
TASK_ROOT="$TASK_ROOT" TARGET_REPORT="$TARGET_REPORT" POLICY_FILE="$POLICY_FILE" TARGET_TABLESPACE="$TARGET_TABLESPACE" TARGET_SYSTEM_ID="$TARGET_SYSTEM_ID" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import {
  canonicalClusterJson,
  clusterSha256,
  createClusterSecurityReceipt,
  createTablespaceReceipt,
  validateClusterSecurityReceipt,
  validateCredentialBindingReceipt,
  validateTablespaceReceipt,
  verifyTablespaceMapAfterCreate,
} from "/workspace/scripts/postgresql-cluster-recovery-contract.mjs";
import { parseClusterCatalogReport } from "/workspace/scripts/postgresql-cluster-catalog-contract.mjs";
const env = process.env;
const policy = JSON.parse(readFileSync(env.POLICY_FILE, "utf8"));
const snapshot = JSON.parse(readFileSync(`${env.TASK_ROOT}/snapshot.json`, "utf8"));
const map = JSON.parse(readFileSync(`${env.TASK_ROOT}/tablespace-map.json`, "utf8"));
const tablespacePreflight = JSON.parse(readFileSync(`${env.TASK_ROOT}/tablespace-preflight.json`, "utf8"));
const credentialReceipt = JSON.parse(readFileSync(`${env.TASK_ROOT}/credential-receipt.json`, "utf8"));
validateCredentialBindingReceipt(credentialReceipt);
const target = parseClusterCatalogReport(readFileSync(env.TARGET_REPORT, "utf8"), policy);
if (target.tablespaces.length !== 1 || target.tablespaces[0].source_location_sha256 !== clusterSha256(env.TARGET_TABLESPACE)
  || map.entries[0].server_path !== env.TARGET_TABLESPACE) throw new Error("target tablespace mapping was not proven");
const tablespaceValidation = await verifyTablespaceMapAfterCreate({
  map,
  snapshot,
  policy,
  preflightValidation: tablespacePreflight,
  targetCatalog: target,
  expectedUid: 999,
  expectedGid: 999,
  prohibitedRoots: [`${env.TASK_ROOT}/target-pgdata`, `${env.TASK_ROOT}/source-pgdata`, "/workspace"],
  expectedNamespaceIdentitySha256: map.namespace_identity_sha256,
  evidenceScope: "SYNTHETIC_TEST_ONLY",
});
const tablespaceReceipt = createTablespaceReceipt({ validation: tablespaceValidation, backupId: snapshot.binding.backup_id, restoreRunId: "cluster-restore-synthetic-1", verifiedAt: "2026-08-13T08:04:00.000Z" });
validateTablespaceReceipt(tablespaceReceipt);
const receipt = createClusterSecurityReceipt({
  snapshot,
  targetCatalog: target,
  policy,
  tablespaceMap: map,
  tablespaceReceipt,
  credentialReceipt,
  restoreRunId: "cluster-restore-synthetic-1",
  verifiedAt: "2026-08-13T08:04:00.000Z",
  evidenceScope: "SYNTHETIC_TEST_ONLY",
  targetSystemIdentifierSha256: clusterSha256(env.TARGET_SYSTEM_ID),
});
validateClusterSecurityReceipt(receipt, policy);
const publicEvidence = canonicalClusterJson({ receipt, tablespaceReceipt, credentialReceipt });
if (publicEvidence.includes(env.TARGET_TABLESPACE) || publicEvidence.includes("chenyida_erp_runtime")) throw new Error("public evidence exposed private cluster details");
writeFileSync(`${env.TASK_ROOT}/cluster-security-receipt.json`, canonicalClusterJson(receipt), { flag: "wx", mode: 0o600 });
writeFileSync(`${env.TASK_ROOT}/tablespace-receipt.json`, canonicalClusterJson(tablespaceReceipt), { flag: "wx", mode: 0o600 });
NODE

PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/quarantine.sql" >/dev/null
[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime') and rolcanlogin")" = 0 ]
[ "$(psql -X -Atc "select datconnlimit from pg_database where datname='chenyida_erp'")" = 0 ]
PGDATABASE=chenyida_erp psql -X -v ON_ERROR_STOP=1 -f "$TASK_ROOT/activation.sql" >/dev/null
[ "$(psql -X -Atc "select count(*) from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_runtime') and rolcanlogin")" = 2 ]
[ "$(psql -X -Atc "select datconnlimit from pg_database where datname='chenyida_erp'")" = 64 ]

stop_cluster "$TARGET_PGDATA"
TARGET_RUNNING=0
printf 'single-container dual-cluster PostgreSQL security recovery passed\n'
