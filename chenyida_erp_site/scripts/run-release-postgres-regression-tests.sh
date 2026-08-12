#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/nonexistent
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_NO_REPLACE_OBJECTS=1
export LC_ALL PATH HOME GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_NO_REPLACE_OBJECTS

container_main() {
  [ "${ERP_RELEASE_POSTGRES_CONTAINER_MODE:-}" = YES ] || exit 2
  PATH=/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH
  TASK_ROOT=$(mktemp -d /tmp/cyd-release-postgres-regression.XXXXXX)
  chown postgres:postgres "$TASK_ROOT"
  chmod 0700 "$TASK_ROOT"
  PGDATA="$TASK_ROOT/pgdata"; PGLOG="$PGDATA/postgres.log"; RUNNING=0
  container_cleanup() {
    status=0
    if [ "$RUNNING" = 1 ] && [ -s "$PGDATA/postmaster.pid" ]; then gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || status=1; fi
    case "$TASK_ROOT" in /tmp/cyd-release-postgres-regression.*) rm -rf -- "$TASK_ROOT" || status=1 ;; *) echo "refusing unsafe PostgreSQL regression cleanup" >&2; status=1 ;; esac
    [ "$status" = 0 ] || exit 1
  }
  container_signal() { signal_status=$1; trap - EXIT HUP INT TERM; container_cleanup; exit "$signal_status"; }
  trap container_cleanup EXIT
  trap 'container_signal 129' HUP
  trap 'container_signal 130' INT
  trap 'container_signal 143' TERM
  install -d -m 0700 -o postgres -g postgres "$PGDATA"
  gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust --locale=C --encoding=UTF8 >/dev/null
  if ! gosu postgres pg_ctl -D "$PGDATA" -l "$PGLOG" -o "-h 127.0.0.1 -p 5432 -c unix_socket_directories='$TASK_ROOT' -c max_connections=64 -c shared_buffers=64MB -c work_mem=2MB -c maintenance_work_mem=32MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off" -w start >/dev/null; then
    [ ! -f "$PGLOG" ] || tail -n 80 "$PGLOG" >&2
    exit 1
  fi
  RUNNING=1
  cd /workspace
  node --experimental-strip-types /supervisor/scripts/release-postgres-regression-runner.mjs
}

if [ "${ERP_RELEASE_POSTGRES_CONTAINER_MODE:-}" = YES ]; then
  container_main
  exit 0
fi

SUPERVISOR_SITE_ROOT=$(readlink -f "$(dirname "$0")/..")
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(readlink -f "$SUPERVISOR_SITE_ROOT/..")}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
NODE_MODULES="$REPOSITORY_ROOT/chenyida_erp_site/node_modules"
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
POSTGRES_IMAGE='postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394'
TEMP_ROOT=$(mktemp -d /tmp/cyd-release-postgres-regression-runtime.XXXXXX)
RUN_ID=${ERP_RELEASE_GATE_RUN_ID:-standalone-${TEMP_ROOT##*.}}
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "release PostgreSQL regression run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "release PostgreSQL regression run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "release PostgreSQL regression run ID is invalid" >&2; exit 1; }
TASK_LABEL="chenyida.erp.release-postgres-regression=$RUN_ID"
NODE_CONTAINER="cyd-release-postgres-node-$RUN_ID"
POSTGRES_CONTAINER="cyd-release-postgres-$RUN_ID"
NODE_ID=""; POSTGRES_ID=""

remove_task_container() {
  container_id=$1; container_name=$2
  if [ -z "$container_id" ]; then container_id=$(/usr/bin/docker inspect --format '{{.Id}}' "$container_name" 2>/dev/null || true); fi
  [ -n "$container_id" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-postgres-regression"}}|{{.Name}}' "$container_id" 2>/dev/null || true)" = "$RUN_ID|/$container_name" ] || { echo "refusing to remove a container not created by this test" >&2; return 1; }
  /usr/bin/docker rm -f "$container_id" >/dev/null
}

cleanup() {
  status=0
  remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || status=1
  remove_task_container "$NODE_ID" "$NODE_CONTAINER" >/dev/null 2>&1 || status=1
  case "$TEMP_ROOT" in /tmp/cyd-release-postgres-regression-runtime.*) rm -rf -- "$TEMP_ROOT" || status=1 ;; *) echo "refusing unsafe runtime cleanup" >&2; status=1 ;; esac
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

[ "$(id -u)" = 0 ] || { echo "release PostgreSQL regression requires root" >&2; exit 1; }
[ -d "$NODE_MODULES" ] && [ ! -L "$NODE_MODULES" ] || { echo "approved Node dependencies are unavailable" >&2; exit 1; }
GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] && [ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "release PostgreSQL regression snapshot identity mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files block release PostgreSQL regression" >&2; exit 1; }
mkdir -m 0755 "$TEMP_ROOT/source"
git_candidate archive --format=tar "$GIT_COMMIT" chenyida_erp_site | /usr/bin/tar -xf - -C "$TEMP_ROOT/source"
SITE_ROOT="$TEMP_ROOT/source/chenyida_erp_site"
[ -f "$SITE_ROOT/release/release-test-inventory-v1.json" ] && [ -f "$SITE_ROOT/tests/selfhost-postgres.test.mjs" ] || { echo "release PostgreSQL regression snapshot is incomplete" >&2; exit 1; }
mkdir -m 0555 "$SITE_ROOT/node_modules"

/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned Node bootstrap image is unavailable; pulling is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 || { echo "pinned PostgreSQL image is unavailable; pulling is forbidden" >&2; exit 1; }
NODE_ID=$(/usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$NODE_CONTAINER" --network none --read-only --cap-drop ALL --security-opt no-new-privileges "$NODE_IMAGE" true)
/usr/bin/docker cp "$NODE_ID:/usr/local/bin/node" "$TEMP_ROOT/node"
remove_task_container "$NODE_ID" "$NODE_CONTAINER"; NODE_ID=""
chmod 0755 "$TEMP_ROOT/node"

POSTGRES_ID=$(/usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$POSTGRES_CONTAINER" \
  --network none --add-host postgres:127.0.0.1 --read-only --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges \
  --memory 1024m --memory-swap 1280m --cpus 1 --pids-limit 256 \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=1536m --tmpfs /run/chenyida-erp:rw,exec,nosuid,nodev,size=128m,mode=0700 \
  -e ERP_RELEASE_POSTGRES_CONTAINER_MODE=YES -e NODE_OPTIONS=--max-old-space-size=384 \
  -v "$SITE_ROOT:/workspace:ro" -v "$NODE_MODULES:/workspace/node_modules:ro" -v "$SUPERVISOR_SITE_ROOT:/supervisor:ro" -v "$TEMP_ROOT/node:/usr/local/bin/node:ro" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" /supervisor/scripts/run-release-postgres-regression-tests.sh)
if ! /usr/bin/docker start --attach "$POSTGRES_ID"; then
  exit_code=$(/usr/bin/docker inspect --format '{{.State.ExitCode}}' "$POSTGRES_ID" 2>/dev/null || printf unknown)
  state_error=$(/usr/bin/docker inspect --format '{{.State.Error}}' "$POSTGRES_ID" 2>/dev/null || printf unknown)
  /usr/bin/docker logs "$POSTGRES_ID" 2>/dev/null || true
  echo "release PostgreSQL regression container failed: exit=$exit_code state=$state_error" >&2
  exit 1
fi
remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER"; POSTGRES_ID=""
