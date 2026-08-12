#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

SITE_ROOT=/workspace
TASK_ROOT=$(mktemp -d /tmp/cyd-release-migration-postgres.XXXXXX)
chmod 0755 "$TASK_ROOT"
PGDATA="$TASK_ROOT/pgdata"; PGSOCKET="$TASK_ROOT/socket"; PGLOG="$PGDATA/postgres.log"; RUNNING=0; LOCK_HOLDER_PID=""

cleanup() {
  status=0
  if [ -n "$LOCK_HOLDER_PID" ]; then kill "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true; wait "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true; fi
  if [ "$RUNNING" = 1 ] && [ -s "$PGDATA/postmaster.pid" ]; then gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || status=1; fi
  case "$TASK_ROOT" in /tmp/cyd-release-migration-postgres.*) rm -rf -- "$TASK_ROOT" || status=1 ;; *) echo "refusing unsafe release migration cleanup" >&2; status=1 ;; esac
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

install -d -m 0700 -o postgres -g postgres "$PGDATA" "$PGSOCKET"
gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=scram-sha-256 --locale=C --encoding=UTF8 >/dev/null
gosu postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "-k $PGSOCKET -c listen_addresses='' -c max_connections=20 -c shared_buffers=64MB -c work_mem=4MB -c maintenance_work_mem=32MB" -w start >/dev/null
RUNNING=1
export PGHOST="$PGSOCKET" PGUSER=postgres
SYSTEM_IDENTIFIER=$(psql -d postgres -Atc 'select system_identifier from pg_control_system()')
psql -d postgres -v ON_ERROR_STOP=1 -c "create role cyd_release_migrator login" >/dev/null
ROLE_PROFILE=$(psql -d postgres -At -F '|' -c "select rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,pg_has_role('cyd_release_migrator','pg_monitor','MEMBER'),rolcanlogin from pg_roles where rolname='cyd_release_migrator'")
[ "$ROLE_PROFILE" = 'f|f|f|f|f|f|t' ] || { echo "release migrator privilege fixture is invalid" >&2; exit 1; }

create_target() {
  database=$1; deployment=$2
  createdb -O cyd_release_migrator "$database"
  psql -d postgres -v ON_ERROR_STOP=1 -c "comment on database $database is 'chenyida-erp-deployment/v2:UAT:$deployment'" >/dev/null
}

generate_manifest() {
  migrations=$1; artifact_root=$2; release_id=$3
  mkdir -m 0750 "$artifact_root"; chmod 0750 "$artifact_root"
  printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$artifact_root/.chenyida-erp-release-artifact-root-v1"
  chmod 0440 "$artifact_root/.chenyida-erp-release-artifact-root-v1"
  MIGRATION_FIXTURE_DIR="$migrations" RELEASE_FIXTURE_ROOT="$artifact_root" RELEASE_FIXTURE_ID="$release_id" NODE_OPTIONS=--max-old-space-size=384 node --input-type=module <<'NODE'
import { buildMigrationAllowlist } from "/workspace/scripts/release-manifest-contract.mjs";
import { buildEligibleReleaseFixture } from "/workspace/tests/release-gate-fixture.mjs";
const entries=await buildMigrationAllowlist(process.env.MIGRATION_FIXTURE_DIR);
const now=new Date();
await buildEligibleReleaseFixture({entries,root:process.env.RELEASE_FIXTURE_ROOT,releaseId:process.env.RELEASE_FIXTURE_ID,generatedAt:now.toISOString(),expiresAt:new Date(now.getTime()+59*60*1000).toISOString()});
NODE
}

run_controlled() {
  database=$1; deployment=$2; artifact_root=$3; expected_current=$4; expected_target=$5; workdir=$6; image_override=${7:-}
  oid=$(psql -d "$database" -Atc "select oid from pg_database where datname=current_database()")
  manifest="$artifact_root/release-manifest.json"; manifest_sha=$(sha256sum "$manifest" | awk '{print $1}')
  worker_identity=$(MANIFEST_FILE="$manifest" node --input-type=module -e 'import{readFileSync}from"node:fs";const value=JSON.parse(readFileSync(process.env.MANIFEST_FILE,"utf8")),image=value?.images?.worker;if(!/^sha256:[0-9a-f]{64}$/.test(image?.image_digest||"")||!/^.+@sha256:[0-9a-f]{64}$/.test(image?.image_reference||""))process.exit(1);process.stdout.write(`${image.image_reference}|${image.image_digest}`)')
  old_ifs=$IFS; IFS='|'; set -- $worker_identity; IFS=$old_ifs; [ "$#" -eq 2 ] || { echo "worker manifest identity is incomplete" >&2; exit 1; }
  worker_reference=$1; worker_digest=$2
  runtime_image_digest=${image_override:-$worker_digest}
  (cd "$workdir" && \
    DATABASE_URL="postgresql://${MIGRATION_DB_USER:-cyd_release_migrator}@/$database?host=$PGSOCKET" DATABASE_POOL_MAX=2 ERP_ENV=production ERP_DEPLOYMENT_CLASS=uat ERP_SETUP_TOKEN=synthetic-release-migration-token ERP_ALLOW_PRODUCTION_MIGRATION=YES \
    ERP_MIGRATION_CONFIRM=MIGRATE_EXACT_RELEASE_MANIFEST ERP_RELEASE_MANIFEST_FILE="$manifest" ERP_RELEASE_MANIFEST_SHA256="$manifest_sha" \
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID="$deployment" ERP_MIGRATION_EXPECTED_DATABASE="$database" ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER="$SYSTEM_IDENTIFIER" ERP_MIGRATION_EXPECTED_DATABASE_OID="$oid" ERP_MIGRATION_EXPECTED_DATABASE_MARKER="chenyida-erp-deployment/v2:UAT:$deployment" ERP_MIGRATION_EXPECTED_ROLE=cyd_release_migrator \
    ERP_MIGRATION_EXPECTED_CURRENT_HEAD="$expected_current" ERP_MIGRATION_EXPECTED_TARGET_HEAD="$expected_target" ERP_RELEASE_EXPECTED_VERSION=0.1.0-alpha.46 ERP_RUNTIME_BUILD_VERSION=0.1.0-alpha.46 ERP_RELEASE_EXPECTED_GIT_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ERP_RUNTIME_GIT_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ERP_RUNTIME_IMAGE_REFERENCE="$worker_reference" ERP_RUNTIME_IMAGE_CONFIG_DIGEST="$runtime_image_digest" \
    NODE_OPTIONS=--max-old-space-size=384 node --experimental-strip-types "$SITE_ROOT/scripts/migrate-postgres.ts")
}

# Empty controlled target applies exactly the approved allowlist.
EMPTY_DB=cyd_empty_release_test; EMPTY_DEPLOYMENT=empty-release-test
create_target "$EMPTY_DB" "$EMPTY_DEPLOYMENT"
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "create schema spoof; create table spoof.schema_migrations(version text primary key, checksum text not null); insert into spoof.schema_migrations values('9999_spoof.sql',repeat('f',64)); alter database $EMPTY_DB set search_path=spoof,public" >/dev/null
EMPTY_ARTIFACTS="$TASK_ROOT/empty-artifacts"; generate_manifest "$SITE_ROOT/drizzle-postgres" "$EMPTY_ARTIFACTS" synthetic-empty-release
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" > "$TASK_ROOT/image-mismatch.log" 2>&1; then echo "wrong runtime image digest unexpectedly reached migration" >&2; exit 1; fi
grep -q '^MIGRATION_RELEASE_IMAGE_MISMATCH$' "$TASK_ROOT/image-mismatch.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
if MIGRATION_DB_USER=postgres run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/superuser.log" 2>&1; then echo "superuser migration connection unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_ROLE_IDENTITY_INVALID$' "$TASK_ROOT/superuser.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d postgres -v ON_ERROR_STOP=1 -c "create role cyd_release_extra_privilege; grant cyd_release_extra_privilege to cyd_release_migrator" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/membership.log" 2>&1; then echo "migration role with inherited membership unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_ROLE_IDENTITY_INVALID$' "$TASK_ROOT/membership.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d postgres -v ON_ERROR_STOP=1 -c "revoke cyd_release_extra_privilege from cyd_release_migrator; drop role cyd_release_extra_privilege" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "create role cyd_release_role_member; grant cyd_release_migrator to cyd_release_role_member" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/reverse-membership.log" 2>&1; then echo "migration role granted to another role unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_ROLE_IDENTITY_INVALID$' "$TASK_ROOT/reverse-membership.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d postgres -v ON_ERROR_STOP=1 -c "revoke cyd_release_migrator from cyd_release_role_member; drop role cyd_release_role_member" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "alter role cyd_release_migrator set statement_timeout='5s'" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/role-setting.log" 2>&1; then echo "migration role with persistent GUC unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_ROLE_IDENTITY_INVALID$' "$TASK_ROOT/role-setting.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d postgres -v ON_ERROR_STOP=1 -c "alter role cyd_release_migrator reset all" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "create role cyd_release_schema_writer" >/dev/null
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "grant create on schema public to cyd_release_schema_writer" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/schema-create-acl.log" 2>&1; then echo "public schema CREATE granted to an external role unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_PUBLIC_SCHEMA_PRIVILEGE_INVALID$' "$TASK_ROOT/schema-create-acl.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "revoke create on schema public from cyd_release_schema_writer" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "drop role cyd_release_schema_writer" >/dev/null
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "alter schema public owner to cyd_release_migrator" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/schema-owner.log" 2>&1; then echo "public schema with a concrete role owner unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_PUBLIC_SCHEMA_PRIVILEGE_INVALID$' "$TASK_ROOT/schema-owner.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "alter schema public owner to pg_database_owner" >/dev/null
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "create table public.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/precreated-history.log" 2>&1; then echo "pre-created empty migration history unexpectedly passed EMPTY authorization" >&2; exit 1; fi
grep -q '^MIGRATION_EMPTY_TARGET_HISTORY_PRESENT$' "$TASK_ROOT/precreated-history.log"
[ "$(psql -d "$EMPTY_DB" -Atc 'select count(*) from public.schema_migrations')" = 0 ]
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "drop table public.schema_migrations" >/dev/null
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "create table public.untracked_release_probe(id integer primary key)" >/dev/null
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/untracked-empty.log" 2>&1; then echo "non-empty target without migration history unexpectedly migrated" >&2; exit 1; fi
grep -q '^MIGRATION_EMPTY_TARGET_HAS_UNTRACKED_OBJECTS$' "$TASK_ROOT/untracked-empty.log"
[ "$(psql -d "$EMPTY_DB" -Atc "select count(*) from public.untracked_release_probe")" = 0 ]
[ "$(psql -d "$EMPTY_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "drop table public.untracked_release_probe" >/dev/null
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c 'create collation public.untracked_release_collation from "C"' >/dev/null
if run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/untracked-collation.log" 2>&1; then echo "untracked public collation unexpectedly migrated" >&2; exit 1; fi
grep -q '^MIGRATION_EMPTY_TARGET_HAS_UNTRACKED_OBJECTS$' "$TASK_ROOT/untracked-collation.log"
psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "drop collation public.untracked_release_collation" >/dev/null
MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/empty.log"
[ "$(psql -d "$EMPTY_DB" -Atc 'select count(*) from public.schema_migrations')" = 45 ]
[ "$(psql -d "$EMPTY_DB" -Atc 'select version from public.schema_migrations order by version desc limit 1')" = 0045_runtime_worker_readiness.sql ]
[ "$(psql -d "$EMPTY_DB" -Atc 'select count(*) from spoof.schema_migrations')" = 1 ]

# History must be permanent, side-effect-free, owned by the exact migrator, and unshared.
FIRST_MIGRATION_SHA=$(sha256sum "$SITE_ROOT/drizzle-postgres/0001_selfhost_baseline.sql" | awk '{print $1}')
UNLOGGED_DB=cyd_unlogged_history_release_test; UNLOGGED_DEPLOYMENT=unlogged-history-release-test
create_target "$UNLOGGED_DB" "$UNLOGGED_DEPLOYMENT"
psql -d "$UNLOGGED_DB" -v ON_ERROR_STOP=1 -c "set role cyd_release_migrator; create unlogged table public.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now()); insert into public.schema_migrations(version,checksum) values('0001_selfhost_baseline.sql','$FIRST_MIGRATION_SHA'); reset role" >/dev/null
if run_controlled "$UNLOGGED_DB" "$UNLOGGED_DEPLOYMENT" "$EMPTY_ARTIFACTS" 0001_selfhost_baseline.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/unlogged-history.log" 2>&1; then echo "unlogged migration history unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_HISTORY_STRUCTURE_INVALID$' "$TASK_ROOT/unlogged-history.log"
DEFAULT_DB=cyd_default_history_release_test; DEFAULT_DEPLOYMENT=default-history-release-test
create_target "$DEFAULT_DB" "$DEFAULT_DEPLOYMENT"
psql -d "$DEFAULT_DB" -v ON_ERROR_STOP=1 -c "set role cyd_release_migrator; create table public.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default clock_timestamp()); insert into public.schema_migrations(version,checksum) values('0001_selfhost_baseline.sql','$FIRST_MIGRATION_SHA'); reset role" >/dev/null
if run_controlled "$DEFAULT_DB" "$DEFAULT_DEPLOYMENT" "$EMPTY_ARTIFACTS" 0001_selfhost_baseline.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/default-history.log" 2>&1; then echo "side-effect-capable migration history default unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_HISTORY_STRUCTURE_INVALID$' "$TASK_ROOT/default-history.log"
ACL_DB=cyd_acl_history_release_test; ACL_DEPLOYMENT=acl-history-release-test
create_target "$ACL_DB" "$ACL_DEPLOYMENT"
psql -d "$ACL_DB" -v ON_ERROR_STOP=1 -c "set role cyd_release_migrator; create table public.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now()); insert into public.schema_migrations(version,checksum) values('0001_selfhost_baseline.sql','$FIRST_MIGRATION_SHA'); grant select on public.schema_migrations to public; reset role" >/dev/null
if run_controlled "$ACL_DB" "$ACL_DEPLOYMENT" "$EMPTY_ARTIFACTS" 0001_selfhost_baseline.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/acl-history.log" 2>&1; then echo "shared migration history unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_HISTORY_STRUCTURE_INVALID$' "$TASK_ROOT/acl-history.log"

# A first migration failure rolls back the newly created history table and can
# be retried from EMPTY with a separately approved corrected release.
FIRST_FAIL_DB=cyd_first_fail_release_test; FIRST_FAIL_DEPLOYMENT=first-fail-release-test
create_target "$FIRST_FAIL_DB" "$FIRST_FAIL_DEPLOYMENT"
FIRST_FAIL="$TASK_ROOT/first-fail"; mkdir -p "$FIRST_FAIL/drizzle-postgres"
printf 'create table first_failure_probe(id integer);\nselect 1/0;\n' > "$FIRST_FAIL/drizzle-postgres/0001_failure_probe.sql"
FIRST_FAIL_ARTIFACTS="$TASK_ROOT/first-fail-artifacts"; generate_manifest "$FIRST_FAIL/drizzle-postgres" "$FIRST_FAIL_ARTIFACTS" synthetic-first-failure
if run_controlled "$FIRST_FAIL_DB" "$FIRST_FAIL_DEPLOYMENT" "$FIRST_FAIL_ARTIFACTS" EMPTY 0001_failure_probe.sql "$FIRST_FAIL" > "$TASK_ROOT/first-fail.log" 2>&1; then echo "first failing migration unexpectedly succeeded" >&2; exit 1; fi
grep -q '^MIGRATION_DATABASE_22012$' "$TASK_ROOT/first-fail.log"
[ "$(psql -d "$FIRST_FAIL_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]
[ "$(psql -d "$FIRST_FAIL_DB" -Atc "select pg_catalog.to_regclass('public.first_failure_probe') is null")" = t ]
FIRST_FIXED="$TASK_ROOT/first-fixed"; mkdir -p "$FIRST_FIXED/drizzle-postgres"
printf 'create table first_failure_probe(id integer primary key);\n' > "$FIRST_FIXED/drizzle-postgres/0001_failure_probe.sql"
FIRST_FIXED_ARTIFACTS="$TASK_ROOT/first-fixed-artifacts"; generate_manifest "$FIRST_FIXED/drizzle-postgres" "$FIRST_FIXED_ARTIFACTS" synthetic-first-fixed
run_controlled "$FIRST_FAIL_DB" "$FIRST_FAIL_DEPLOYMENT" "$FIRST_FIXED_ARTIFACTS" EMPTY 0001_failure_probe.sql "$FIRST_FIXED" > "$TASK_ROOT/first-fixed.log"
[ "$(psql -d "$FIRST_FAIL_DB" -Atc "select count(*) from public.schema_migrations where version='0001_failure_probe.sql'")" = 1 ]
[ "$(psql -d "$FIRST_FAIL_DB" -Atc "select pg_catalog.to_regclass('public.first_failure_probe') is not null")" = t ]

# A competing session lock is rejected immediately instead of waiting or running SQL.
PGAPPNAME=cyd_legacy_migration_lock_holder psql -d "$EMPTY_DB" -v ON_ERROR_STOP=1 -c "select pg_advisory_lock(hashtext('chenyida_erp_schema_migration')); select pg_sleep(30)" > "$TASK_ROOT/lock-holder.log" 2>&1 &
LOCK_HOLDER_PID=$!
attempt=0
while [ "$attempt" -lt 50 ]; do
  [ "$(psql -d "$EMPTY_DB" -Atc "select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory' and l.granted and a.application_name='cyd_legacy_migration_lock_holder'")" = 1 ] && break
  attempt=$((attempt+1)); sleep 0.1
done
[ "$attempt" -lt 50 ] || { echo "advisory lock fixture did not become ready" >&2; exit 1; }
if MIGRATION_DB_USER=cyd_release_migrator run_controlled "$EMPTY_DB" "$EMPTY_DEPLOYMENT" "$EMPTY_ARTIFACTS" 0045_runtime_worker_readiness.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/lock-rejected.log" 2>&1; then echo "concurrent migration unexpectedly succeeded" >&2; exit 1; fi
grep -q '^MIGRATION_ADVISORY_LOCK_UNAVAILABLE$' "$TASK_ROOT/lock-rejected.log"
kill "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
wait "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
LOCK_HOLDER_PID=""

# Existing data upgrades from the declared 0044 prefix, retains data, and is idempotent at 0045.
UPGRADE_DB=cyd_upgrade_release_test; UPGRADE_DEPLOYMENT=upgrade-release-test
create_target "$UPGRADE_DB" "$UPGRADE_DEPLOYMENT"
PREVIOUS="$TASK_ROOT/previous"; mkdir "$PREVIOUS"; cp -a "$SITE_ROOT/drizzle-postgres" "$PREVIOUS/drizzle-postgres"; rm "$PREVIOUS/drizzle-postgres/0045_runtime_worker_readiness.sql"
PREVIOUS_ARTIFACTS="$TASK_ROOT/previous-artifacts"; generate_manifest "$PREVIOUS/drizzle-postgres" "$PREVIOUS_ARTIFACTS" synthetic-previous-release

# A child table cannot inject inherited rows into the authoritative migration
# history or make an unapplied release appear current.
INHERITED_DB=cyd_inherited_history_release_test; INHERITED_DEPLOYMENT=inherited-history-release-test
create_target "$INHERITED_DB" "$INHERITED_DEPLOYMENT"
run_controlled "$INHERITED_DB" "$INHERITED_DEPLOYMENT" "$PREVIOUS_ARTIFACTS" EMPTY 0044_identity_session_absolute_lifetime.sql "$PREVIOUS" > "$TASK_ROOT/inherited-base.log"
MIGRATION_0045_SHA=$(sha256sum "$SITE_ROOT/drizzle-postgres/0045_runtime_worker_readiness.sql" | awk '{print $1}')
psql -d "$INHERITED_DB" -v ON_ERROR_STOP=1 -c "create schema injected_history; create table injected_history.child() inherits (public.schema_migrations); insert into injected_history.child(version,checksum) values('0045_runtime_worker_readiness.sql','$MIGRATION_0045_SHA')" >/dev/null
if run_controlled "$INHERITED_DB" "$INHERITED_DEPLOYMENT" "$EMPTY_ARTIFACTS" 0044_identity_session_absolute_lifetime.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/inherited-history.log" 2>&1; then echo "inherited migration history unexpectedly passed" >&2; exit 1; fi
grep -q '^MIGRATION_HISTORY_STRUCTURE_INVALID$' "$TASK_ROOT/inherited-history.log"
[ "$(psql -d "$INHERITED_DB" -Atc 'select count(*) from only public.schema_migrations')" = 44 ]
[ "$(psql -d "$INHERITED_DB" -Atc "select pg_catalog.to_regclass('public.worker_runtime_leases') is null")" = t ]

# pg_catalog remains ahead of public in name resolution even if an attacker
# creates a same-name function before the next migration.
SHADOW_NOW_DB=cyd_shadow_now_release_test; SHADOW_NOW_DEPLOYMENT=shadow-now-release-test
create_target "$SHADOW_NOW_DB" "$SHADOW_NOW_DEPLOYMENT"
run_controlled "$SHADOW_NOW_DB" "$SHADOW_NOW_DEPLOYMENT" "$PREVIOUS_ARTIFACTS" EMPTY 0044_identity_session_absolute_lifetime.sql "$PREVIOUS" > "$TASK_ROOT/shadow-now-base.log"
psql -d "$SHADOW_NOW_DB" -v ON_ERROR_STOP=1 -c "create function public.now() returns timestamptz language sql immutable as 'select timestamptz ''2000-01-01 00:00:00+00'''" >/dev/null
SHADOW_NOW="$TASK_ROOT/shadow-now"; cp -a "$PREVIOUS" "$SHADOW_NOW"
printf 'create table public.release_shadow_now_probe(at timestamptz not null default now());\ninsert into public.release_shadow_now_probe default values;\n' > "$SHADOW_NOW/drizzle-postgres/0045_shadow_now_probe.sql"
SHADOW_NOW_ARTIFACTS="$TASK_ROOT/shadow-now-artifacts"; generate_manifest "$SHADOW_NOW/drizzle-postgres" "$SHADOW_NOW_ARTIFACTS" synthetic-shadow-now-release
run_controlled "$SHADOW_NOW_DB" "$SHADOW_NOW_DEPLOYMENT" "$SHADOW_NOW_ARTIFACTS" 0044_identity_session_absolute_lifetime.sql 0045_shadow_now_probe.sql "$SHADOW_NOW" > "$TASK_ROOT/shadow-now-upgrade.log"
[ "$(psql -d "$SHADOW_NOW_DB" -Atc "select at>pg_catalog.now()-interval '5 minutes' and extract(year from at)>2025 from public.release_shadow_now_probe")" = t ]

run_controlled "$UPGRADE_DB" "$UPGRADE_DEPLOYMENT" "$PREVIOUS_ARTIFACTS" EMPTY 0044_identity_session_absolute_lifetime.sql "$PREVIOUS" > "$TASK_ROOT/previous.log"
psql -d "$UPGRADE_DB" -v ON_ERROR_STOP=1 -c "create table release_upgrade_sentinel(id integer primary key, payload text not null); insert into release_upgrade_sentinel values(1,'retained');" >/dev/null
UPGRADE_ARTIFACTS="$TASK_ROOT/upgrade-artifacts"; generate_manifest "$SITE_ROOT/drizzle-postgres" "$UPGRADE_ARTIFACTS" synthetic-upgrade-release
run_controlled "$UPGRADE_DB" "$UPGRADE_DEPLOYMENT" "$UPGRADE_ARTIFACTS" 0044_identity_session_absolute_lifetime.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/upgrade.log"
[ "$(psql -d "$UPGRADE_DB" -Atc 'select payload from release_upgrade_sentinel where id=1')" = retained ]
run_controlled "$UPGRADE_DB" "$UPGRADE_DEPLOYMENT" "$UPGRADE_ARTIFACTS" 0045_runtime_worker_readiness.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/repeat.log"
[ ! -s "$TASK_ROOT/repeat.log" ]

# A database checksum conflict fails in read-only preflight and applies no new migration.
psql -d "$UPGRADE_DB" -v ON_ERROR_STOP=1 -c "update public.schema_migrations set checksum=repeat('e',64) where version='0040_warehouse_receipt_readiness.sql'" >/dev/null
if run_controlled "$UPGRADE_DB" "$UPGRADE_DEPLOYMENT" "$UPGRADE_ARTIFACTS" 0045_runtime_worker_readiness.sql 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/checksum.log" 2>&1; then echo "checksum conflict unexpectedly succeeded" >&2; exit 1; fi
grep -q '^APPLIED_MIGRATION_CHECKSUM_MISMATCH$' "$TASK_ROOT/checksum.log"
[ "$(psql -d "$UPGRADE_DB" -Atc 'select count(*) from public.schema_migrations')" = 45 ]

# A local migration not present in the release allowlist is rejected before schema_migrations is created.
DISALLOWED_DB=cyd_disallowed_release_test; DISALLOWED_DEPLOYMENT=disallowed-release-test
create_target "$DISALLOWED_DB" "$DISALLOWED_DEPLOYMENT"
DISALLOWED="$TASK_ROOT/disallowed"; mkdir "$DISALLOWED"; cp -a "$SITE_ROOT/drizzle-postgres" "$DISALLOWED/drizzle-postgres"; printf 'select 1;\n' > "$DISALLOWED/drizzle-postgres/0046_disallowed.sql"
if run_controlled "$DISALLOWED_DB" "$DISALLOWED_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$DISALLOWED" > "$TASK_ROOT/disallowed.log" 2>&1; then echo "disallowed migration unexpectedly succeeded" >&2; exit 1; fi
grep -Eq '^(MIGRATION_FILES_NOT_RELEASE_ALLOWLIST|MIGRATION_DIRECTORY_NOT_EXACT_RELEASE_ALLOWLIST)$' "$TASK_ROOT/disallowed.log"
[ "$(psql -d "$DISALLOWED_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]

# An allowlisted failing migration rolls back its own DDL and history row.
ROLLBACK_DB=cyd_rollback_release_test; ROLLBACK_DEPLOYMENT=rollback-release-test
create_target "$ROLLBACK_DB" "$ROLLBACK_DEPLOYMENT"
run_controlled "$ROLLBACK_DB" "$ROLLBACK_DEPLOYMENT" "$EMPTY_ARTIFACTS" EMPTY 0045_runtime_worker_readiness.sql "$SITE_ROOT" > "$TASK_ROOT/rollback-base.log"
ROLLBACK="$TASK_ROOT/rollback"; mkdir "$ROLLBACK"; cp -a "$SITE_ROOT/drizzle-postgres" "$ROLLBACK/drizzle-postgres"
printf 'create table release_failure_probe(id integer);\nselect 1/0;\n' > "$ROLLBACK/drizzle-postgres/0046_failure_probe.sql"
ROLLBACK_ARTIFACTS="$TASK_ROOT/rollback-artifacts"; generate_manifest "$ROLLBACK/drizzle-postgres" "$ROLLBACK_ARTIFACTS" synthetic-rollback-release
if run_controlled "$ROLLBACK_DB" "$ROLLBACK_DEPLOYMENT" "$ROLLBACK_ARTIFACTS" 0045_runtime_worker_readiness.sql 0046_failure_probe.sql "$ROLLBACK" > "$TASK_ROOT/rollback.log" 2>&1; then echo "failing migration unexpectedly succeeded" >&2; exit 1; fi
grep -q '^MIGRATION_DATABASE_22012$' "$TASK_ROOT/rollback.log"
[ "$(psql -d "$ROLLBACK_DB" -Atc "select to_regclass('public.release_failure_probe') is null")" = t ]
[ "$(psql -d "$ROLLBACK_DB" -Atc "select count(*) from public.schema_migrations where version='0046_failure_probe.sql'")" = 0 ]

# The isolated-test path cannot be used against a database carrying a UAT marker.
BYPASS_DB=cyd_bypass_release_test; BYPASS_DEPLOYMENT=bypass-release-test
create_target "$BYPASS_DB" "$BYPASS_DEPLOYMENT"
BYPASS_OID=$(psql -d "$BYPASS_DB" -Atc "select oid from pg_database where datname=current_database()")
if (cd "$SITE_ROOT" && DATABASE_URL="postgresql://postgres@/$BYPASS_DB?host=$PGSOCKET" DATABASE_POOL_MAX=2 ERP_ENV=test ERP_DEPLOYMENT_CLASS=test ERP_SETUP_TOKEN=synthetic ERP_ALLOW_ISOLATED_MIGRATION=YES ERP_RELEASE_TEST_MODE=YES ERP_MIGRATION_TEST_HARNESS=RELEASE_MIGRATION ERP_MIGRATION_CONFIRM=MIGRATE_EXACT_ISOLATED_TEST_DATABASE ERP_MIGRATION_TEST_RUN_ID=bypass-release-test ERP_MIGRATION_EXPECTED_DATABASE="$BYPASS_DB" ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER="$SYSTEM_IDENTIFIER" ERP_MIGRATION_EXPECTED_DATABASE_OID="$BYPASS_OID" ERP_MIGRATION_EXPECTED_DATABASE_MARKER=chenyida-erp-isolated-migration-test/v1:bypass-release-test NODE_OPTIONS=--max-old-space-size=384 node --experimental-strip-types "$SITE_ROOT/scripts/migrate-postgres.ts") > "$TASK_ROOT/bypass.log" 2>&1; then echo "isolated authorization unexpectedly accepted a UAT database" >&2; exit 1; fi
grep -q '^MIGRATION_ISOLATED_TARGET_IDENTITY_MISMATCH$' "$TASK_ROOT/bypass.log"
[ "$(psql -d "$BYPASS_DB" -Atc "select pg_catalog.to_regclass('public.schema_migrations') is null")" = t ]

printf 'release migration allowlist PostgreSQL integration passed\n'
