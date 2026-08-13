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

cleanup() {
  status=0
  if [ "$RUNNING" = 1 ] && [ -s "$PGDATA/postmaster.pid" ]; then
    gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || status=1
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
chown postgres:postgres "$TASK_ROOT"
chmod 0700 "$TASK_ROOT"
PGDATA="$TASK_ROOT/pgdata"
PGSOCKET="$TASK_ROOT/socket"
PGLOG="$PGDATA/postgres.log"

install -d -m 0700 -o postgres -g postgres "$PGDATA" "$PGSOCKET"
STAGE=INITDB
gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust --locale=C --encoding=UTF8 >/dev/null 2>&1
STAGE=CLUSTER_START
if ! gosu postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "-k $PGSOCKET -c listen_addresses='' -c max_connections=16 -c max_locks_per_transaction=1024 -c shared_buffers=48MB -c work_mem=2MB -c maintenance_work_mem=24MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c lock_timeout=5s -c statement_timeout=120s -c idle_in_transaction_session_timeout=120s" -w start >/dev/null; then exit 1; fi
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
  psql -X -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 \
    -v expected_database="$DATABASE" -v migration_owner="$OWNER" -v expected_marker="$MARKER" -v expected_system_identifier="$SYSTEM_IDENTIFIER" \
    -o "$output" -f "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.sql"
  chmod 0600 "$output"
}

STAGE=BASELINE
capture "$REPORT_ONE"
capture "$REPORT_TWO"
cmp -s "$REPORT_ONE" "$REPORT_TWO"

CATALOG_ONE="$TASK_ROOT/catalog-one.json"
CATALOG_TWO="$TASK_ROOT/catalog-two.json"
node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" compile \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --expected-database "$DATABASE" --output "$CATALOG_ONE" --report "$REPORT_ONE" >/dev/null
node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" compile \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --expected-database "$DATABASE" --output "$CATALOG_TWO" --report "$REPORT_TWO" >/dev/null
cmp -s "$CATALOG_ONE" "$CATALOG_TWO"
node "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" verify \
  --access "$SITE_ROOT/operations/postgresql-runtime-privilege-access-v2.json" \
  --catalog "$CATALOG_ONE" --expected-database "$DATABASE" --report "$REPORT_ONE" >/dev/null
if [ "${ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE:-test}" = test ]; then
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

STAGE=COMPLETE
printf 'runtime privilege PG17 compiled catalog integration passed\n'
