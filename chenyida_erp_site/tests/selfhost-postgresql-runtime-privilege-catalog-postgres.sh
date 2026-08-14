#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL PATH

[ "${ERP_RUNTIME_PRIVILEGE_CATALOG_POSTGRES_CONTAINER_MODE:-}" = YES ] || exit 2
SITE_ROOT=/workspace
EXPORT_ROOT=${ERP_RUNTIME_PRIVILEGE_CATALOG_EXPORT_ROOT:-/export}
TASK_ROOT=""
PGDATA=""
PGSOCKET=""
PGLOG=""
DATABASE=runtime_privilege_catalog_test
OWNER=chenyida_erp_owner
RUNNING=0
STAGE=INITIALIZE

run_postgres() {
  if [ "$(id -u)" = 0 ]; then gosu postgres "$@"
  else "$@"
  fi
}

cleanup() {
  status=0
  if [ "$RUNNING" = 1 ] && [ -s "$PGDATA/postmaster.pid" ]; then
    run_postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || status=1
  fi
  case "${TASK_ROOT:-}" in
    /tmp/cyd-runtime-privilege-catalog-postgres.*) rm -rf -- "$TASK_ROOT" || status=1 ;;
    "") : ;;
    *) status=1 ;;
  esac
  [ "$status" = 0 ] || exit 1
}

finalize() {
  exit_status=$?
  trap - EXIT HUP INT TERM
  if [ "$exit_status" -ne 0 ]; then echo "RUNTIME_PRIVILEGE_CATALOG_STAGE_FAILED stage=$STAGE" >&2; fi
  cleanup
  exit "$exit_status"
}

on_signal() {
  signal_status=$1
  trap - EXIT HUP INT TERM
  cleanup
  exit "$signal_status"
}

trap finalize EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

TASK_ROOT=$(mktemp -d /tmp/cyd-runtime-privilege-catalog-postgres.XXXXXX)
if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$TASK_ROOT"
else [ "$(id -u):$(id -g)" = 999:999 ] || exit 1
fi
chmod 0700 "$TASK_ROOT"
PGDATA="$TASK_ROOT/pgdata"
PGSOCKET="$TASK_ROOT/socket"
if [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = system-adapter ]; then PGSOCKET=/var/run/postgresql; fi
PGLOG="$PGDATA/postgres.log"
PG_OPTIONS_COMMON="-k $PGSOCKET -c max_connections=16 -c max_locks_per_transaction=1024 -c shared_buffers=48MB -c work_mem=2MB -c maintenance_work_mem=24MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c lock_timeout=5s -c statement_timeout=120s -c idle_in_transaction_session_timeout=120s"

if [ "$(id -u)" = 0 ]; then install -d -m 0700 -o postgres -g postgres "$PGDATA" "$PGSOCKET"
else install -d -m 0700 "$PGDATA" "$PGSOCKET"
fi
STAGE=INITDB
run_postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust --locale=C --encoding=UTF8 >/dev/null 2>&1
STAGE=CLUSTER_START
if ! run_postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTIONS_COMMON -c listen_addresses=''" -w start >/dev/null; then exit 1; fi
RUNNING=1
export PGHOST="$PGSOCKET" PGUSER=postgres

STAGE=DATABASE_CREATE
psql -X -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
CREATE ROLE $OWNER LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 1;
CREATE DATABASE $DATABASE OWNER $OWNER TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C';
SQL

SYSTEM_IDENTIFIER=$(psql -X -d postgres -Atc "select system_identifier from pg_control_system()")
MARKER_NONCE=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
MARKER="chenyida-erp-runtime-privilege-catalog/synthetic/$SYSTEM_IDENTIFIER/$MARKER_NONCE"
STAGE=DATABASE_MARKER
psql -X -d postgres -v ON_ERROR_STOP=1 -v database_name="$DATABASE" -v marker="$MARKER" <<'SQL' >/dev/null
COMMENT ON DATABASE :"database_name" IS :'marker';
SQL

export PGDATABASE="$DATABASE"
STAGE=SCHEMA_SETUP
psql -X -v ON_ERROR_STOP=1 <<SQL >/dev/null
ALTER SCHEMA public OWNER TO pg_database_owner;
CREATE EXTENSION btree_gist WITH SCHEMA public;
CREATE EXTENSION pgcrypto WITH SCHEMA public;
SQL
PGUSER=$OWNER psql -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
SELECT current_user=session_user AND current_user='chenyida_erp_owner' AS migration_identity_valid
\gset
\if :migration_identity_valid
\else
  \quit 3
\endif
CREATE TABLE public.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
SQL

find "$SITE_ROOT/drizzle-postgres" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -print | LC_ALL=C sort > "$TASK_ROOT/migrations.list"
STAGE=MIGRATIONS
[ "$(wc -l < "$TASK_ROOT/migrations.list" | tr -d ' ')" = 46 ]
while IFS= read -r migration; do
  name=${migration##*/}
  checksum=$(sha256sum "$migration" | awk '{print $1}')
  PGUSER=$OWNER psql -X -v ON_ERROR_STOP=1 -v migration_name="$name" -v migration_checksum="$checksum" <<SQL >/dev/null
BEGIN;
SET LOCAL client_min_messages=warning;
SELECT current_user=session_user AND current_user='chenyida_erp_owner' AS migration_identity_valid
\gset
\if :migration_identity_valid
\else
  \quit 3
\endif
\i $migration
INSERT INTO public.schema_migrations(version,checksum) VALUES (:'migration_name',:'migration_checksum');
COMMIT;
SQL
done < "$TASK_ROOT/migrations.list"

REPORT_ONE="$TASK_ROOT/catalog-one.tsv"
REPORT_TWO="$TASK_ROOT/catalog-two.tsv"
capture() {
  output=$1
  controlled=${2:-NO}
  if [ "$controlled" = YES ]; then
    psql -X -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 \
      -v expected_database="$DATABASE" -v migration_owner="$OWNER" -v expected_marker="$MARKER" -v expected_system_identifier="$SYSTEM_IDENTIFIER" \
      -v controlled_runtime_mode=1 -o "$output" -f "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.sql"
  else
    psql -X -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 \
      -v expected_database="$DATABASE" -v migration_owner="$OWNER" -v expected_marker="$MARKER" -v expected_system_identifier="$SYSTEM_IDENTIFIER" \
      -o "$output" -f "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.sql"
  fi
  chmod 0600 "$output"
}

STAGE=BASELINE_CAPTURE_ONE
capture "$REPORT_ONE"
STAGE=BASELINE_CAPTURE_TWO
capture "$REPORT_TWO"
STAGE=BASELINE_REPORT_COMPARE
cmp -s "$REPORT_ONE" "$REPORT_TWO"

CATALOG_ONE="$TASK_ROOT/catalog-one.json"
CATALOG_TWO="$TASK_ROOT/catalog-two.json"
STAGE=BASELINE_COMPILE_ONE
if ! node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" compile \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --expected-database "$DATABASE" --output "$CATALOG_ONE" --report "$REPORT_ONE" >/dev/null; then
  if [ ! -f "$REPORT_ONE" ] || [ -L "$REPORT_ONE" ]; then echo RUNTIME_PRIVILEGE_CATALOG_REPORT_METADATA_TYPE_INVALID >&2
  elif [ "$(stat -c %h "$REPORT_ONE")" != 1 ]; then echo RUNTIME_PRIVILEGE_CATALOG_REPORT_METADATA_LINK_INVALID >&2
  elif [ "$(stat -c %s "$REPORT_ONE")" -lt 1 ]; then echo RUNTIME_PRIVILEGE_CATALOG_REPORT_METADATA_SIZE_EMPTY >&2
  elif [ "$(stat -c %s "$REPORT_ONE")" -gt 67108864 ]; then echo RUNTIME_PRIVILEGE_CATALOG_REPORT_METADATA_SIZE_TOO_LARGE >&2
  elif [ $((0$(stat -c %a "$REPORT_ONE") & 022)) -ne 0 ]; then echo RUNTIME_PRIVILEGE_CATALOG_REPORT_METADATA_MODE_INVALID >&2
  else echo RUNTIME_PRIVILEGE_CATALOG_REPORT_METADATA_STATIC_VALID >&2
  fi
  exit 1
fi
STAGE=BASELINE_COMPILE_TWO
node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" compile \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --expected-database "$DATABASE" --output "$CATALOG_TWO" --report "$REPORT_TWO" >/dev/null
STAGE=BASELINE_CATALOG_COMPARE
cmp -s "$CATALOG_ONE" "$CATALOG_TWO"
STAGE=BASELINE_CATALOG_VERIFY
node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" verify \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --catalog "$CATALOG_ONE" --expected-database "$DATABASE" --report "$REPORT_ONE" >/dev/null
if [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = test ]; then
  STAGE=BASELINE_REPOSITORY_VERIFY
  node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" verify \
    --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
    --catalog "$SITE_ROOT/operations/postgresql-runtime-privilege-compiled-catalog-v1.json" --expected-database "$DATABASE" --report "$REPORT_ONE" >/dev/null
fi
install -m 0600 "$CATALOG_ONE" "$EXPORT_ROOT/postgresql-runtime-privilege-compiled-catalog-v1.json"

TABLE_COUNT=$(psql -X -Atc "select count(*) from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public' and relation.relkind='r'")
SEQUENCE_COUNT=$(psql -X -Atc "select count(*) from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public' and relation.relkind='S'")
INDEX_COUNT=$(psql -X -Atc "select count(*) from pg_index index_record join pg_class relation on relation.oid=index_record.indrelid join pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public'")
[ "$TABLE_COUNT" = 234 ] || { echo "runtime privilege table count mismatch: $TABLE_COUNT" >&2; exit 1; }
[ "$SEQUENCE_COUNT" = 211 ] || { echo "runtime privilege sequence count mismatch: $SEQUENCE_COUNT" >&2; exit 1; }
[ "$INDEX_COUNT" = 957 ] || { echo "runtime privilege index count mismatch: $INDEX_COUNT" >&2; exit 1; }

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; CREATE TABLE public.cyd_runtime_privilege_rogue(id integer PRIMARY KEY)" >/dev/null
STAGE=ROGUE_TABLE
ROGUE_REPORT="$TASK_ROOT/catalog-rogue.tsv"
capture "$ROGUE_REPORT"
if node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" compile \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --expected-database "$DATABASE" --output "$TASK_ROOT/catalog-rogue.json" --report "$ROGUE_REPORT" >"$TASK_ROOT/rogue.log" 2>&1; then
  echo "rogue table unexpectedly compiled" >&2
  exit 1
fi
if ! grep -q '^RUNTIME_PRIVILEGE_CATALOG_TABLE_SET_MISMATCH$' "$TASK_ROOT/rogue.log"; then
  echo "rogue table rejection code mismatch" >&2
  sed -n '1,10p' "$TASK_ROOT/rogue.log" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -c 'DROP TABLE public.cyd_runtime_privilege_rogue' >/dev/null

expect_compile_rejection() {
  label=$1
  expected_code=$2
  report="$TASK_ROOT/catalog-$label.tsv"
  log="$TASK_ROOT/catalog-$label.log"
  capture "$report"
  if node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" compile \
    --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
    --expected-database "$DATABASE" --output "$TASK_ROOT/catalog-$label.json" --report "$report" >"$log" 2>&1; then
    exit 1
  fi
  grep -q "^$expected_code$" "$log" || exit 1
}

STAGE=USER_RULE_CREATE
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; CREATE RULE cyd_runtime_privilege_rule AS ON UPDATE TO public.app_meta DO ALSO NOTHING" >/dev/null
STAGE=USER_RULE_REJECT
expect_compile_rejection rule RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT
STAGE=USER_RULE_CLEANUP
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; DROP RULE cyd_runtime_privilege_rule ON public.app_meta" >/dev/null

STAGE=OBJECT_DRIFT
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; CREATE SEQUENCE public.cyd_runtime_privilege_rogue_sequence" >/dev/null
expect_compile_rejection sequence RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_SET_MISMATCH
psql -X -v ON_ERROR_STOP=1 -c 'DROP SEQUENCE public.cyd_runtime_privilege_rogue_sequence' >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; CREATE FUNCTION public.cyd_runtime_privilege_rogue_routine() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'" >/dev/null
expect_compile_rejection routine RUNTIME_PRIVILEGE_CATALOG_ROUTINE_SET_MISMATCH
psql -X -v ON_ERROR_STOP=1 -c 'DROP FUNCTION public.cyd_runtime_privilege_rogue_routine()' >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; CREATE TYPE public.cyd_runtime_privilege_rogue_type AS ENUM ('x')" >/dev/null
expect_compile_rejection type RUNTIME_PRIVILEGE_CATALOG_TYPE_SET_MISMATCH
psql -X -v ON_ERROR_STOP=1 -c 'DROP TYPE public.cyd_runtime_privilege_rogue_type' >/dev/null

psql -X -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.app_meta OWNER TO postgres' >/dev/null
expect_compile_rejection owner RUNTIME_PRIVILEGE_CATALOG_TABLE_STRUCTURE_INVALID
psql -X -v ON_ERROR_STOP=1 -c "ALTER TABLE public.app_meta OWNER TO $OWNER" >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER TABLE public.app_meta SET (autovacuum_enabled=false)" >/dev/null
STAGE=RELOPTIONS
expect_compile_rejection reloptions RUNTIME_PRIVILEGE_CATALOG_TABLE_STRUCTURE_INVALID
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER TABLE public.app_meta RESET (autovacuum_enabled)" >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER TABLE public.app_meta SET (toast.autovacuum_enabled=false)" >/dev/null
STAGE=TOAST_RELOPTIONS
expect_compile_rejection toast_reloptions RUNTIME_PRIVILEGE_CATALOG_TABLE_STRUCTURE_INVALID
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER TABLE public.app_meta RESET (toast.autovacuum_enabled)" >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER FUNCTION public.cyd_ai_governance_suggestion_assert_complete(bigint) SET search_path='public'" >/dev/null
STAGE=ROUTINE_CONFIGURATION
expect_compile_rejection routine_configuration RUNTIME_PRIVILEGE_CATALOG_ROUTINE_CONFIGURATION_UNSUPPORTED
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER FUNCTION public.cyd_ai_governance_suggestion_assert_complete(bigint) RESET search_path" >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "CREATE FUNCTION public.cyd_runtime_privilege_extension_member() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'" >/dev/null
psql -X -v ON_ERROR_STOP=1 -c 'ALTER EXTENSION pgcrypto ADD FUNCTION public.cyd_runtime_privilege_extension_member()' >/dev/null
STAGE=EXTENSION
expect_compile_rejection extension RUNTIME_PRIVILEGE_CATALOG_EXTENSION_STRUCTURE_INVALID
psql -X -v ON_ERROR_STOP=1 -c 'ALTER EXTENSION pgcrypto DROP FUNCTION public.cyd_runtime_privilege_extension_member(); DROP FUNCTION public.cyd_runtime_privilege_extension_member()' >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; CREATE TABLE public.cyd_runtime_privilege_extension_table(id integer PRIMARY KEY)" >/dev/null
psql -X -v ON_ERROR_STOP=1 -c 'ALTER EXTENSION pgcrypto ADD TABLE public.cyd_runtime_privilege_extension_table' >/dev/null
STAGE=EXTENSION_MEMBER_CLASS
expect_compile_rejection extension_member_class RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT
psql -X -v ON_ERROR_STOP=1 -c 'ALTER EXTENSION pgcrypto DROP TABLE public.cyd_runtime_privilege_extension_table; DROP TABLE public.cyd_runtime_privilege_extension_table' >/dev/null

EXTENSION_OPERATOR=$(psql -X -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT operator.oid::regoperator::text
FROM pg_operator operator
JOIN pg_depend dependency ON dependency.classid='pg_operator'::regclass AND dependency.objid=operator.oid
  AND dependency.refclassid='pg_extension'::regclass AND dependency.deptype='e'
JOIN pg_extension extension ON extension.oid=dependency.refobjid AND extension.extname='btree_gist'
WHERE operator.oprowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
ORDER BY operator.oprnamespace,operator.oprname,operator.oprleft,operator.oprright
LIMIT 1;
SQL
)
[ -n "$EXTENSION_OPERATOR" ] || exit 1
psql -X -v ON_ERROR_STOP=1 -c "ALTER OPERATOR $EXTENSION_OPERATOR OWNER TO $OWNER" >/dev/null
STAGE=EXTENSION_SEMANTIC_DRIFT
expect_compile_rejection extension_semantic RUNTIME_PRIVILEGE_CATALOG_EXTENSION_STRUCTURE_INVALID
psql -X -v ON_ERROR_STOP=1 -c "ALTER OPERATOR $EXTENSION_OPERATOR OWNER TO postgres" >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SELECT lo_create(987654)" >/dev/null
STAGE=UNSUPPORTED
expect_compile_rejection large_object RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT
psql -X -v ON_ERROR_STOP=1 -c 'SELECT lo_unlink(987654)' >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "GRANT SELECT (key) ON public.app_meta TO PUBLIC" >/dev/null
expect_compile_rejection column_acl RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT
psql -X -v ON_ERROR_STOP=1 -c 'REVOKE SELECT (key) ON public.app_meta FROM PUBLIC' >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC" >/dev/null
expect_compile_rejection default_acl RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM PUBLIC" >/dev/null

psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; ALTER TABLE public.app_meta ENABLE ROW LEVEL SECURITY; CREATE POLICY cyd_runtime_privilege_policy ON public.app_meta USING (true)" >/dev/null
expect_compile_rejection policy RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT
psql -X -v ON_ERROR_STOP=1 -c "SET ROLE $OWNER; DROP POLICY cyd_runtime_privilege_policy ON public.app_meta; ALTER TABLE public.app_meta DISABLE ROW LEVEL SECURITY" >/dev/null

STAGE=FINAL_VERIFY
capture "$TASK_ROOT/catalog-final.tsv"
node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" verify \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --catalog "$CATALOG_ONE" --expected-database "$DATABASE" --report "$TASK_ROOT/catalog-final.tsv" >/dev/null

if [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = test ] \
  || [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = system-adapter ]; then
STAGE=RUNTIME_PRIVILEGE_DATABASE_RENAME
PGDATABASE=postgres psql -X -v ON_ERROR_STOP=1 -v old_database="$DATABASE" -v new_database=chenyida_erp <<'SQL' >/dev/null
SELECT format('ALTER DATABASE %I RENAME TO %I', :'old_database', :'new_database')
\gexec
SQL
DATABASE=chenyida_erp
export PGDATABASE="$DATABASE"
if [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = system-adapter ]; then
  DEPLOYMENT_ID=${ERP_RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_DEPLOYMENT_ID:-}
  case "$DEPLOYMENT_ID" in ""|*[!A-Za-z0-9._-]*) exit 1 ;; esac
  [ "${#DEPLOYMENT_ID}" -le 120 ] || exit 1
  MARKER="chenyida-erp-deployment/v2:TEST:$DEPLOYMENT_ID"
fi
STAGE=RUNTIME_PRIVILEGE_DATABASE_MARKER
psql -X -v ON_ERROR_STOP=1 -v database_name="$DATABASE" -v marker="$MARKER" <<'SQL' >/dev/null
COMMENT ON DATABASE :"database_name" IS :'marker';
SQL

STAGE=RUNTIME_PRIVILEGE_STRUCTURE_PREFLIGHT
PRIVILEGE_STRUCTURE_BEFORE="$TASK_ROOT/runtime-privilege-structure-before.tsv"
capture "$PRIVILEGE_STRUCTURE_BEFORE"
NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" verify-isolated-structure-baseline "$PRIVILEGE_STRUCTURE_BEFORE" >/dev/null

capture_state() {
  output=$1
  error_log=$2
  controlled=${3:-NO}
  status=0
  if [ "$controlled" = YES ]; then
    psql -X -A -t -v ON_ERROR_STOP=1 \
      -v expected_database="$DATABASE" -v migration_owner="$OWNER" -v expected_marker="$MARKER" -v expected_system_identifier="$SYSTEM_IDENTIFIER" \
      -v controlled_runtime_mode=1 -f "$SITE_ROOT/scripts/postgresql-runtime-privilege-state.sql" >"$output" 2>"$error_log" || status=$?
  else
    psql -X -A -t -v ON_ERROR_STOP=1 \
      -v expected_database="$DATABASE" -v migration_owner="$OWNER" -v expected_marker="$MARKER" -v expected_system_identifier="$SYSTEM_IDENTIFIER" \
      -f "$SITE_ROOT/scripts/postgresql-runtime-privilege-state.sql" >"$output" 2>"$error_log" || status=$?
  fi
  if [ "${status:-0}" -ne 0 ]; then
    chmod 0600 "$output" "$error_log"
    return 1
  fi
  chmod 0600 "$output"
  chmod 0600 "$error_log"
}

STAGE=RUNTIME_PRIVILEGE_BASELINE_CAPTURE
PRIVILEGE_BASELINE="$TASK_ROOT/runtime-privilege-baseline.json"
PRIVILEGE_BASELINE_ERROR="$TASK_ROOT/runtime-privilege-baseline.error"
capture_state "$PRIVILEGE_BASELINE" "$PRIVILEGE_BASELINE_ERROR" || {
  sed -n '1p' "$PRIVILEGE_BASELINE_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
  exit 1
}

if [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = system-adapter ]; then
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_AUTH_POLICY
  sed -i -E 's/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1\/32[[:space:]]+)[^[:space:]]+$/\1scram-sha-256/' "$PGDATA/pg_hba.conf"
  grep -Eq '^host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1\/32[[:space:]]+scram-sha-256$' "$PGDATA/pg_hba.conf" || exit 1
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_AUTH_RESTART
  run_postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTIONS_COMMON -c listen_addresses='*'" -w restart >/dev/null
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_LOG_AUDIT
  psql -X -d postgres -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET log_statement='all'" >/dev/null
  psql -X -d postgres -v ON_ERROR_STOP=1 -c 'SELECT pg_reload_conf()' >/dev/null
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_LOG_RESET
  : >"$PGLOG"
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_DATABASE_OID
  DATABASE_OID=$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d postgres -c "SELECT oid::text FROM pg_database WHERE datname='chenyida_erp'")
  case "$DATABASE_OID" in ""|*[!0-9]*) exit 1 ;; esac
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_CONTEXT_PUBLISH
  SYSTEM_CONTEXT_TEMP="$EXPORT_ROOT/.system-adapter-context.pending"
  {
    printf 'SYSTEM_IDENTIFIER=%s\n' "$SYSTEM_IDENTIFIER"
    printf 'DATABASE_OID=%s\n' "$DATABASE_OID"
    printf 'DATABASE_MARKER=%s\n' "$MARKER"
    printf 'PGLOG=%s\n' "$PGLOG"
  } >"$SYSTEM_CONTEXT_TEMP"
  chmod 0600 "$SYSTEM_CONTEXT_TEMP"
  mv "$SYSTEM_CONTEXT_TEMP" "$EXPORT_ROOT/system-adapter-context"
  : >"$EXPORT_ROOT/system-adapter-ready"
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_WAIT
  WAIT_COUNT=0
  while [ ! -e "$EXPORT_ROOT/system-adapter-done" ]; do
    [ ! -e "$EXPORT_ROOT/system-adapter-abort" ] || exit 1
    WAIT_COUNT=$((WAIT_COUNT+1))
    [ "$WAIT_COUNT" -le 1800 ] || exit 1
    sleep 1
  done
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_FINAL_STATE
  SYSTEM_FINAL="$TASK_ROOT/runtime-privilege-system-adapter-final.json"
  capture_state "$SYSTEM_FINAL" "$TASK_ROOT/runtime-privilege-system-adapter-final.error" YES
  NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
    node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" verify-isolated-state "$SYSTEM_FINAL" >/dev/null
  NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
    node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" assert-isolated-noop "$SYSTEM_FINAL" >/dev/null
  STAGE=RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_FINAL_STRUCTURE
  SYSTEM_STRUCTURE="$TASK_ROOT/runtime-privilege-system-adapter-final.tsv"
  capture "$SYSTEM_STRUCTURE" YES
  NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
    node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" verify-isolated-structure "$SYSTEM_STRUCTURE" >/dev/null
  STAGE=COMPLETE
  printf 'runtime privilege PG17 compiled catalog integration passed\n'
  exit 0
fi

STAGE=RUNTIME_PRIVILEGE_PLAN
PRIVILEGE_PLAN="$TASK_ROOT/runtime-privilege-bootstrap.sql"
PRIVILEGE_PLAN_ERROR="$TASK_ROOT/runtime-privilege-plan.error"
PRIVILEGE_CREDENTIAL_ROOT="$TASK_ROOT/runtime-privilege-credentials"
if ! NODE_ENV=test ERP_RUNTIME_PRIVILEGE_CATALOG_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/tests/runtime-privilege-operator-postgres-fixture.mjs" create-transaction \
    "$PRIVILEGE_BASELINE" "$PRIVILEGE_CREDENTIAL_ROOT" "$PRIVILEGE_PLAN" >/dev/null 2>"$PRIVILEGE_PLAN_ERROR"; then
  sed -n '1p' "$PRIVILEGE_PLAN_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
  exit 1
fi
chmod 0600 "$PRIVILEGE_PLAN"
chmod 0600 "$PRIVILEGE_PLAN_ERROR"

enable_transaction_log_audit() {
  psql -X -d postgres -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET log_statement='all'" >/dev/null
  psql -X -d postgres -v ON_ERROR_STOP=1 -c 'SELECT pg_reload_conf()' >/dev/null
  : >"$PGLOG"
  psql -X -d postgres -v ON_ERROR_STOP=1 -c 'SELECT 424242' >/dev/null
  grep -Fq 'statement: SELECT 424242' "$PGLOG"
}

disable_transaction_log_audit() {
  psql -X -d postgres -v ON_ERROR_STOP=1 -c 'ALTER SYSTEM RESET log_statement' >/dev/null
  psql -X -d postgres -v ON_ERROR_STOP=1 -c 'SELECT pg_reload_conf()' >/dev/null
}

assert_transaction_log_secret_free() {
  credential_root=$1
  if grep -Fq 'SCRAM-SHA-256$' "$PGLOG"; then return 1; fi
  patterns=$TASK_ROOT/runtime-privilege-log-patterns
  {
    sed -n '1p' "$credential_root/runtime-secrets/admin-database-password"
    sed -n '1p' "$credential_root/runtime-secrets/admin-password"
    sed -n '1p' "$credential_root/runtime-secrets/migration-database-password"
    sed -n '1p' "$credential_root/runtime-secrets/postgres-bootstrap-password"
    sed -n '1p' "$credential_root/runtime-secrets/web-database-password"
    sed -n '1p' "$credential_root/runtime-secrets/worker-database-password"
    sed -n 's/^password=//p' "$credential_root/backup-credentials/pg_capture_service.conf"
  } >"$patterns"
  chmod 0600 "$patterns"
  [ "$(wc -l <"$patterns" | tr -d ' ')" = 7 ] || return 1
  if grep -Fq -f "$patterns" "$PGLOG"; then return 1; fi
  rm -f -- "$patterns"
}

STAGE=RUNTIME_PRIVILEGE_RECONCILE
PRIVILEGE_RECONCILE_ERROR="$TASK_ROOT/runtime-privilege-reconcile.error"
enable_transaction_log_audit
if ! psql -X -v ON_ERROR_STOP=1 < "$PRIVILEGE_PLAN" >/dev/null 2>"$PRIVILEGE_RECONCILE_ERROR"; then
  chmod 0600 "$PRIVILEGE_RECONCILE_ERROR"
  sed -n '1p' "$PRIVILEGE_RECONCILE_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
  exit 1
fi
chmod 0600 "$PRIVILEGE_RECONCILE_ERROR"
assert_transaction_log_secret_free "$PRIVILEGE_CREDENTIAL_ROOT"
disable_transaction_log_audit
rm -f -- "$PRIVILEGE_PLAN"

STAGE=RUNTIME_PRIVILEGE_PASSWORD_AUTH_ENABLE
sed -i -E 's/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1\/32[[:space:]]+)[^[:space:]]+$/\1scram-sha-256/' "$PGDATA/pg_hba.conf"
grep -Eq '^host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1\/32[[:space:]]+scram-sha-256$' "$PGDATA/pg_hba.conf" || exit 1
run_postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTIONS_COMMON -c listen_addresses='127.0.0.1'" -w restart >/dev/null

credential_value() {
  role=$1
  credential_root=${2:-$PRIVILEGE_CREDENTIAL_ROOT}
  case "$role" in
    chenyida_erp_admin) file=$credential_root/runtime-secrets/admin-database-password ;;
    chenyida_erp_backup) file=$credential_root/backup-credentials/pg_capture_service.conf ;;
    chenyida_erp_owner) file=$credential_root/runtime-secrets/migration-database-password ;;
    chenyida_erp_web) file=$credential_root/runtime-secrets/web-database-password ;;
    chenyida_erp_worker) file=$credential_root/runtime-secrets/worker-database-password ;;
    *) return 1 ;;
  esac
  if [ "$role" = chenyida_erp_backup ]; then value=$(sed -n 's/^password=//p' "$file")
  else value=$(sed -n '1p' "$file")
  fi
  [ "${#value}" = 43 ] || return 1
  printf '%s' "$value"
}

password_probe() {
  role=$1
  password=$2
  expected=$3
  if [ "$expected" = reject ]; then
    if printf '%s\n' "$password" | PGCONNECT_TIMEOUT=5 psql -X -q -A -t --password -h 127.0.0.1 -p 5432 -U "$role" -d "$DATABASE" -c 'SELECT true' >/dev/null 2>&1; then
      unset password
      return 1
    fi
  else
    observed=$(printf '%s\n' "$password" | PGCONNECT_TIMEOUT=5 psql -X -q -A -t --password -h 127.0.0.1 -p 5432 -U "$role" -d "$DATABASE" \
      -c "SELECT (session_user=current_user)::text||'|'||(current_database()='$DATABASE')::text||'|'||(SELECT (rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)::text FROM pg_catalog.pg_roles WHERE rolname=current_user)" 2>/dev/null)
    [ "$observed" = 'true|true|true' ] || { unset password; return 1; }
  fi
  unset password
}

STAGE=RUNTIME_PRIVILEGE_PASSWORD_PROBES
HASH_STATE=$(psql -X -q -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FILTER (WHERE rolpassword LIKE 'SCRAM-SHA-256$%')::text||':'||current_setting('password_encryption') FROM pg_catalog.pg_authid WHERE rolcanlogin AND rolname IN ('chenyida_erp_admin','chenyida_erp_backup','chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker')")
[ "$HASH_STATE" = '5:scram-sha-256' ] || exit 1
for role in chenyida_erp_admin chenyida_erp_backup chenyida_erp_owner chenyida_erp_web chenyida_erp_worker; do
  password_probe "$role" AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA reject
  correct_password=$(credential_value "$role")
  password_probe "$role" "$correct_password" accept
  unset correct_password
done

STAGE=RUNTIME_PRIVILEGE_PASSWORD_ROLLBACK
ROLLBACK_PASSWORD=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
[ "${#ROLLBACK_PASSWORD}" = 43 ] || exit 1
if {
  printf '%s\n' '\set ON_ERROR_STOP on' 'BEGIN;' "SET LOCAL password_encryption='scram-sha-256';" '\password "chenyida_erp_owner"'
  printf '%s\n%s\n' "$ROLLBACK_PASSWORD" "$ROLLBACK_PASSWORD"
  printf '%s\n' 'SELECT 1/0;' 'COMMIT;'
} | psql -X -q >/dev/null 2>&1; then exit 1; fi
correct_password=$(credential_value chenyida_erp_owner)
password_probe chenyida_erp_owner "$correct_password" accept
password_probe chenyida_erp_owner "$ROLLBACK_PASSWORD" reject
unset correct_password ROLLBACK_PASSWORD

STAGE=RUNTIME_PRIVILEGE_PASSWORD_AUTH_DISABLE
run_postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTIONS_COMMON -c listen_addresses=''" -w restart >/dev/null

STAGE=RUNTIME_PRIVILEGE_POST_CAPTURE
PRIVILEGE_FINAL="$TASK_ROOT/runtime-privilege-final.json"
PRIVILEGE_FINAL_ERROR="$TASK_ROOT/runtime-privilege-final.error"
capture_state "$PRIVILEGE_FINAL" "$PRIVILEGE_FINAL_ERROR" || {
  sed -n '1p' "$PRIVILEGE_FINAL_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
  exit 1
}
NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" verify-isolated-state "$PRIVILEGE_FINAL" >/dev/null
NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" assert-isolated-noop "$PRIVILEGE_FINAL" >/dev/null

STAGE=RUNTIME_PRIVILEGE_PASSWORD_ONLY_RECONCILE_DRIFT
OLD_WEB_PASSWORD=$(credential_value chenyida_erp_web)
DRIFT_PASSWORD=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
[ "${#DRIFT_PASSWORD}" = 43 ] || exit 1
if ! {
  printf '%s\n' '\password "chenyida_erp_web"'
  printf '%s\n%s\n' "$DRIFT_PASSWORD" "$DRIFT_PASSWORD"
} | psql -X -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then exit 1; fi
unset DRIFT_PASSWORD

STAGE=RUNTIME_PRIVILEGE_PASSWORD_ONLY_RECONCILE_PLAN
PASSWORD_RECONCILE_PLAN="$TASK_ROOT/runtime-privilege-password-reconcile.sql"
PASSWORD_RECONCILE_ERROR="$TASK_ROOT/runtime-privilege-password-reconcile.error"
PASSWORD_RECONCILE_CREDENTIAL_ROOT="$TASK_ROOT/runtime-privilege-reconcile-credentials"
if ! NODE_ENV=test ERP_RUNTIME_PRIVILEGE_CATALOG_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/tests/runtime-privilege-operator-postgres-fixture.mjs" create-reconcile-transaction \
    "$PRIVILEGE_FINAL" "$PASSWORD_RECONCILE_CREDENTIAL_ROOT" "$PASSWORD_RECONCILE_PLAN" >/dev/null 2>"$PASSWORD_RECONCILE_ERROR"; then
  sed -n '1p' "$PASSWORD_RECONCILE_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
  exit 1
fi
chmod 0600 "$PASSWORD_RECONCILE_PLAN" "$PASSWORD_RECONCILE_ERROR"
STAGE=RUNTIME_PRIVILEGE_PASSWORD_ONLY_RECONCILE
enable_transaction_log_audit
if ! psql -X -v ON_ERROR_STOP=1 < "$PASSWORD_RECONCILE_PLAN" >/dev/null 2>"$PASSWORD_RECONCILE_ERROR"; then
  sed -n '1p' "$PASSWORD_RECONCILE_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
  exit 1
fi
assert_transaction_log_secret_free "$PASSWORD_RECONCILE_CREDENTIAL_ROOT"
disable_transaction_log_audit
rm -f -- "$PASSWORD_RECONCILE_PLAN"
PRIVILEGE_CREDENTIAL_ROOT="$PASSWORD_RECONCILE_CREDENTIAL_ROOT"

STAGE=RUNTIME_PRIVILEGE_PASSWORD_ONLY_RECONCILE_AUTH_ENABLE
run_postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTIONS_COMMON -c listen_addresses='127.0.0.1'" -w restart >/dev/null
password_probe chenyida_erp_web "$OLD_WEB_PASSWORD" reject
for role in chenyida_erp_admin chenyida_erp_backup chenyida_erp_owner chenyida_erp_web chenyida_erp_worker; do
  password_probe "$role" AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA reject
  correct_password=$(credential_value "$role")
  password_probe "$role" "$correct_password" accept
  unset correct_password
done
unset OLD_WEB_PASSWORD
STAGE=RUNTIME_PRIVILEGE_PASSWORD_ONLY_RECONCILE_AUTH_DISABLE
run_postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTIONS_COMMON -c listen_addresses=''" -w restart >/dev/null

STAGE=RUNTIME_PRIVILEGE_PASSWORD_ONLY_RECONCILE_STATE
PRIVILEGE_PASSWORD_RECONCILED="$TASK_ROOT/runtime-privilege-password-reconciled.json"
PRIVILEGE_PASSWORD_RECONCILED_ERROR="$TASK_ROOT/runtime-privilege-password-reconciled.error"
capture_state "$PRIVILEGE_PASSWORD_RECONCILED" "$PRIVILEGE_PASSWORD_RECONCILED_ERROR"
cmp -s "$PRIVILEGE_FINAL" "$PRIVILEGE_PASSWORD_RECONCILED"
NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" assert-isolated-noop "$PRIVILEGE_PASSWORD_RECONCILED" >/dev/null

expect_role_success() {
  role=$1
  sql=$2
  PGUSER="$role" psql -X -q -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1
}

expect_role_failure() {
  role=$1
  sql=$2
  if PGUSER="$role" psql -X -q -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then return 1; fi
}

STAGE=RUNTIME_PRIVILEGE_FIVE_IDENTITY_PROBES
for role in chenyida_erp_owner chenyida_erp_web chenyida_erp_worker chenyida_erp_admin chenyida_erp_backup; do
  case "$role" in
    chenyida_erp_owner) STAGE=RUNTIME_PRIVILEGE_IDENTITY_OWNER ;;
    chenyida_erp_web) STAGE=RUNTIME_PRIVILEGE_IDENTITY_WEB ;;
    chenyida_erp_worker) STAGE=RUNTIME_PRIVILEGE_IDENTITY_WORKER ;;
    chenyida_erp_admin) STAGE=RUNTIME_PRIVILEGE_IDENTITY_ADMIN ;;
    chenyida_erp_backup) STAGE=RUNTIME_PRIVILEGE_IDENTITY_BACKUP ;;
  esac
  IDENTITY_ERROR="$TASK_ROOT/runtime-privilege-identity-$role.error"
  if ! observed=$(PGUSER="$role" psql -X -q -A -t -v ON_ERROR_STOP=1 -c 'select current_user||chr(58)||session_user' 2>"$IDENTITY_ERROR"); then
    chmod 0600 "$IDENTITY_ERROR"
    sed -n '1p' "$IDENTITY_ERROR" | sed 's/[^A-Za-z0-9_:. -]/_/g' >&2
    exit 1
  fi
  chmod 0600 "$IDENTITY_ERROR"
  [ "$observed" = "$role:$role" ] || exit 1
done

STAGE=RUNTIME_PRIVILEGE_OWNER_PROBES
expect_role_success chenyida_erp_owner 'BEGIN; CREATE TABLE public.cyd_runtime_privilege_owner_canary(id integer); ROLLBACK;'
expect_role_failure chenyida_erp_owner 'CREATE ROLE cyd_runtime_privilege_owner_forbidden'
STAGE=RUNTIME_PRIVILEGE_WEB_PROBES
expect_role_success chenyida_erp_web 'SELECT 1 FROM public.audit_log LIMIT 0'
expect_role_success chenyida_erp_web "SELECT public.digest(convert_to('x','UTF8'),'sha256') IS NOT NULL"
expect_role_failure chenyida_erp_web 'SELECT 1 FROM public.app_meta LIMIT 0'
expect_role_failure chenyida_erp_web 'CREATE TABLE public.cyd_runtime_privilege_web_forbidden(id integer)'
STAGE=RUNTIME_PRIVILEGE_WORKER_PROBES
expect_role_success chenyida_erp_worker 'SELECT 1 FROM public.background_jobs LIMIT 0'
expect_role_failure chenyida_erp_worker 'SELECT 1 FROM public.app_meta LIMIT 0'
expect_role_failure chenyida_erp_worker "SELECT public.digest(convert_to('x','UTF8'),'sha256')"
expect_role_failure chenyida_erp_worker 'CREATE TABLE public.cyd_runtime_privilege_worker_forbidden(id integer)'
STAGE=RUNTIME_PRIVILEGE_ADMIN_PROBES
expect_role_success chenyida_erp_admin 'SELECT 1 FROM public.app_meta LIMIT 0'
expect_role_failure chenyida_erp_admin 'SELECT 1 FROM public.background_jobs LIMIT 0'
expect_role_failure chenyida_erp_admin "SELECT public.digest(convert_to('x','UTF8'),'sha256')"
expect_role_failure chenyida_erp_admin 'CREATE TABLE public.cyd_runtime_privilege_admin_forbidden(id integer)'
STAGE=RUNTIME_PRIVILEGE_BACKUP_PROBES
expect_role_success chenyida_erp_backup 'SELECT 1 FROM public.app_meta LIMIT 0'
expect_role_success chenyida_erp_backup "SELECT public.digest(convert_to('x','UTF8'),'sha256') IS NOT NULL"
expect_role_failure chenyida_erp_backup 'DELETE FROM public.app_meta WHERE false'
expect_role_failure chenyida_erp_backup 'CREATE TABLE public.cyd_runtime_privilege_backup_forbidden(id integer)'

STAGE=RUNTIME_PRIVILEGE_NEGATIVE_SURFACE_PROBES
NEGATIVE_SURFACE=$(psql -X -q -A -t -v ON_ERROR_STOP=1 <<'SQL'
WITH service_roles AS (
  SELECT oid FROM pg_roles WHERE rolname IN ('chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup')
)
SELECT concat_ws(':',
  (SELECT count(*) FROM service_roles role CROSS JOIN pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind='r'
      AND (has_table_privilege(role.oid,relation.oid,'TRUNCATE') OR has_table_privilege(role.oid,relation.oid,'REFERENCES')
        OR has_table_privilege(role.oid,relation.oid,'TRIGGER') OR has_table_privilege(role.oid,relation.oid,'MAINTAIN'))),
  (SELECT count(*) FROM service_roles role CROSS JOIN pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind='S' AND has_sequence_privilege(role.oid,relation.oid,'UPDATE')),
  (SELECT count(*) FROM service_roles role CROSS JOIN pg_attribute attribute
    WHERE attribute.attnum>0 AND NOT attribute.attisdropped AND has_column_privilege(role.oid,attribute.attrelid,attribute.attnum,'REFERENCES')),
  (SELECT count(*) FROM service_roles role CROSS JOIN pg_type type JOIN pg_namespace namespace ON namespace.oid=type.typnamespace
    LEFT JOIN pg_class relation ON relation.oid=type.typrelid
    WHERE namespace.nspname='public'
      AND ((type.typtype='b' AND type.typelem=0) OR type.typtype IN ('d','e','r','m') OR (type.typtype='c' AND type.typrelid<>0 AND relation.relkind='c'))
      AND has_type_privilege(role.oid,type.oid,'USAGE')),
  (SELECT count(*) FROM service_roles role CROSS JOIN pg_tablespace tablespace WHERE has_tablespace_privilege(role.oid,tablespace.oid,'CREATE')),
  (SELECT count(*) FROM service_roles role CROSS JOIN pg_database database
    WHERE database.datname=current_database() AND has_database_privilege(role.oid,database.oid,'TEMPORARY')),
  (SELECT count(*) FROM service_roles role WHERE has_schema_privilege(role.oid,'public','CREATE')),
  (SELECT count(*) FROM service_roles role
    WHERE has_parameter_privilege(role.oid,'session_replication_role','SET') OR has_parameter_privilege(role.oid,'session_replication_role','ALTER SYSTEM'))
);
SQL
)
[ "$NEGATIVE_SURFACE" = '0:0:0:0:0:0:0:0' ] || exit 1

STAGE=RUNTIME_PRIVILEGE_BACKUP_IDENTITY_DUMP
BACKUP_CANARY="$TASK_ROOT/runtime-privilege-backup-canary.dump"
PGUSER=chenyida_erp_backup pg_dump -Fc -f "$BACKUP_CANARY" "$DATABASE"
[ -s "$BACKUP_CANARY" ] || exit 1
chmod 0600 "$BACKUP_CANARY"

STAGE=RUNTIME_PRIVILEGE_STRUCTURE
PRIVILEGE_STRUCTURE="$TASK_ROOT/runtime-privilege-structure.tsv"
capture "$PRIVILEGE_STRUCTURE"
NODE_ENV=test ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE=YES \
  node "$SITE_ROOT/scripts/postgresql-runtime-privilege-reconciler.mjs" verify-isolated-structure "$PRIVILEGE_STRUCTURE" >/dev/null
fi

STAGE=COMPLETE
printf 'runtime privilege PG17 compiled catalog integration passed\n'
