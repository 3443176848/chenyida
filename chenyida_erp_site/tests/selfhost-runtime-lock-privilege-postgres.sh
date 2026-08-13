#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL PATH

[ "${ERP_RUNTIME_LOCK_PRIVILEGE_POSTGRES_CONTAINER_MODE:-}" = YES ] || exit 2
TASK_ROOT=$(mktemp -d /tmp/cyd-runtime-lock-privilege-postgres.XXXXXX)
chown postgres:postgres "$TASK_ROOT"
chmod 0700 "$TASK_ROOT"
PGDATA="$TASK_ROOT/pgdata"
PGLOG="$PGDATA/postgres.log"
RUNNING=0

cleanup() {
  status=0
  if [ "$RUNNING" = 1 ] && [ -s "$PGDATA/postmaster.pid" ]; then
    gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || status=1
  fi
  case "$TASK_ROOT" in
    /tmp/cyd-runtime-lock-privilege-postgres.*) rm -rf -- "$TASK_ROOT" || status=1 ;;
    *) echo "refusing unsafe runtime lock privilege PostgreSQL cleanup" >&2; status=1 ;;
  esac
  [ "$status" = 0 ] || exit 1
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

install -d -m 0700 -o postgres -g postgres "$PGDATA"
gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust --locale=C --encoding=UTF8 >/dev/null
if ! gosu postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "-h 127.0.0.1 -p 5432 -c unix_socket_directories='$TASK_ROOT' -c max_connections=24 -c max_locks_per_transaction=1024 -c shared_buffers=48MB -c work_mem=2MB -c maintenance_work_mem=24MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off" -w start >/dev/null; then
  [ ! -f "$PGLOG" ] || tail -n 80 "$PGLOG" >&2
  exit 1
fi
RUNNING=1
gosu postgres createdb -h 127.0.0.1 -p 5432 runtime_lock_privilege_test
cd /workspace
TEST_RUNTIME_LOCK_PRIVILEGE_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/runtime_lock_privilege_test \
  NODE_OPTIONS=--max-old-space-size=384 \
  node --experimental-strip-types --test --test-concurrency=1 tests/selfhost-runtime-lock-privilege-postgres.test.mjs
