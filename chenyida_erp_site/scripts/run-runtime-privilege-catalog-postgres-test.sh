#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_NO_REPLACE_OBJECTS=1
COMPOSE_PARALLEL_LIMIT=1
umask 022
export LC_ALL PATH GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_NO_REPLACE_OBJECTS COMPOSE_PARALLEL_LIMIT

[ "$(id -u)" = 0 ] || { echo "runtime privilege catalog PostgreSQL test requires root" >&2; exit 1; }
unset DOCKER_CONFIG DOCKER_API_VERSION DOCKER_CERT_PATH DOCKER_CONTEXT DOCKER_TLS_VERIFY
DOCKER_HOST=unix:///var/run/docker.sock
export DOCKER_HOST

MODE=${1:-test}
[ "$#" -le 1 ] && { [ "$MODE" = test ] || [ "$MODE" = generate ] || [ "$MODE" = refresh ]; } || {
  echo "usage: run-runtime-privilege-catalog-postgres-test.sh [test|generate|refresh]" >&2
  exit 2
}

SITE_ROOT=$(readlink -f "$(dirname "$0")/..")
REPOSITORY_ROOT=$(readlink -f "$SITE_ROOT/..")
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
POSTGRES_IMAGE='postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394'
TASK_ROOT=""
RUN_ID=""
TASK_LABEL="chenyida.erp.runtime-privilege-catalog-test=$RUN_ID"
NODE_CONTAINER="cyd-runtime-privilege-catalog-node-$RUN_ID"
POSTGRES_CONTAINER="cyd-runtime-privilege-catalog-postgres-$RUN_ID"
NODE_ID=""
POSTGRES_ID=""
EXPORT_ROOT=""
REPOSITORY_TEMP=""
OOM_KILL_BEFORE=""
SWAP_USED_KIB_BEFORE=""
RUNTIME_STATE_BEFORE=""
MONITOR_PID=""
MONITOR_STOP=""
MONITOR_FAILURE=""

resource_snapshot() {
  available=$(awk '$1=="MemAvailable:"{print $2}' /proc/meminfo)
  swap_total=$(awk '$1=="SwapTotal:"{print $2}' /proc/meminfo)
  swap_free=$(awk '$1=="SwapFree:"{print $2}' /proc/meminfo)
  root_free=$(df -Pk / | awk 'NR==2{print $4}')
  load_one=$(awk '{print $1}' /proc/loadavg)
  oom_kill=$(awk '$1=="oom_kill"{print $2}' /proc/vmstat)
  case "$available:$swap_total:$swap_free:$root_free:$oom_kill" in *[!0-9:]*|*::*|:*) echo "RUNTIME_PRIVILEGE_CATALOG_RESOURCE_READ_FAILED" >&2; return 1 ;; esac
  [ "$available" -ge 786432 ] && [ "$root_free" -ge 10485760 ] || { echo "RUNTIME_PRIVILEGE_CATALOG_RESOURCE_THRESHOLD_BREACH" >&2; return 1; }
  if [ "$swap_total" -gt 0 ] && [ $(((swap_total-swap_free)*100)) -gt $((swap_total*80)) ]; then echo "RUNTIME_PRIVILEGE_CATALOG_RESOURCE_THRESHOLD_BREACH" >&2; return 1; fi
  awk -v observed="$load_one" 'BEGIN{exit !(observed<=4)}' || { echo "RUNTIME_PRIVILEGE_CATALOG_RESOURCE_THRESHOLD_BREACH" >&2; return 1; }
  printf '%s|%s\n' "$oom_kill" "$((swap_total-swap_free))"
}

runtime_state() {
  for service in caddy postgres web worker; do
    name="chenyida-erp-parallel-$service-1"
    if /usr/bin/timeout --signal=TERM --kill-after=5s 15s /usr/bin/docker inspect "$name" >/dev/null 2>&1; then
      /usr/bin/timeout --signal=TERM --kill-after=5s 15s /usr/bin/docker inspect --format '{{.Name}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name"
    fi
  done | LC_ALL=C sort
}

validate_runtime_state() {
  state=$1
  [ "$(printf '%s\n' "$state" | awk 'NF{count++} END{print count+0}')" = 4 ] || return 1
  printf '%s\n' "$state" | awk -F '|' '
    NF!=5 || $3!="false" || $4!="running" || ($5!="healthy" && $5!="none") { exit 1 }
  '
}

resource_monitor() {
  baseline_swap=$1
  while [ ! -e "$MONITOR_STOP" ]; do
    snapshot=$(resource_snapshot) || { : > "$MONITOR_FAILURE"; return 1; }
    [ "${snapshot%%|*}" = "$OOM_KILL_BEFORE" ] || { : > "$MONITOR_FAILURE"; return 1; }
    observed_swap=${snapshot##*|}
    [ "$observed_swap" -le $((baseline_swap+262144)) ] || { : > "$MONITOR_FAILURE"; return 1; }
    current_state=$(runtime_state) || { : > "$MONITOR_FAILURE"; return 1; }
    [ -n "$current_state" ] && [ "$current_state" = "$RUNTIME_STATE_BEFORE" ] || { : > "$MONITOR_FAILURE"; return 1; }
    sleep 5
  done
}

remove_task_container() {
  container_id=$1
  container_name=$2
  [ -n "$RUN_ID" ] && [ -n "$container_name" ] || return 0
  if [ -z "$container_id" ]; then container_id=$(/usr/bin/timeout --signal=TERM --kill-after=5s 15s /usr/bin/docker inspect --format '{{.Id}}' "$container_name" 2>/dev/null || true); fi
  [ -n "$container_id" ] || return 0
  [ "$(/usr/bin/timeout --signal=TERM --kill-after=5s 15s /usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.runtime-privilege-catalog-test"}}|{{.Name}}' "$container_id" 2>/dev/null || true)" = "$RUN_ID|/$container_name" ] || {
    echo "refusing to remove a container not created by this test" >&2
    return 1
  }
  /usr/bin/timeout --signal=TERM --kill-after=10s 30s /usr/bin/docker rm -f "$container_id" >/dev/null
}

cleanup() {
  status=0
  if [ -n "$MONITOR_PID" ]; then : > "$MONITOR_STOP" 2>/dev/null || true; wait "$MONITOR_PID" 2>/dev/null || status=1; MONITOR_PID=""; fi
  remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || status=1
  remove_task_container "$NODE_ID" "$NODE_CONTAINER" >/dev/null 2>&1 || status=1
  if [ -n "$REPOSITORY_TEMP" ]; then
    case "$REPOSITORY_TEMP" in "$SITE_ROOT"/operations/.postgresql-runtime-privilege-compiled-catalog-v1.json.*) rm -f -- "$REPOSITORY_TEMP" || status=1 ;; *) status=1 ;; esac
  fi
  case "${TASK_ROOT:-}" in
    /tmp/cyd-runtime-privilege-catalog-runtime.*) rm -rf -- "$TASK_ROOT" || status=1 ;;
    "") : ;;
    *) status=1 ;;
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

LOCK_HELPER="$SITE_ROOT/scripts/release-gate-lock.sh"
[ -f "$LOCK_HELPER" ] && [ ! -L "$LOCK_HELPER" ] || { echo "RUNTIME_PRIVILEGE_CATALOG_HEAVY_TASK_LOCK_UNSAFE" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$LOCK_HELPER"
acquire_chenyida_release_gate_lock || { echo "RUNTIME_PRIVILEGE_CATALOG_HEAVY_TASK_LOCK_BUSY" >&2; exit 1; }

RESOURCE_BEFORE=$(resource_snapshot)
OOM_KILL_BEFORE=${RESOURCE_BEFORE%%|*}
SWAP_USED_KIB_BEFORE=${RESOURCE_BEFORE##*|}
RUNTIME_STATE_BEFORE=$(runtime_state)
validate_runtime_state "$RUNTIME_STATE_BEFORE" || { echo "RUNTIME_PRIVILEGE_CATALOG_RUNTIME_STATE_UNAVAILABLE" >&2; exit 1; }

TASK_ROOT=$(mktemp -d /tmp/cyd-runtime-privilege-catalog-runtime.XXXXXX)
[ "$(stat -c '%U:%G:%a:%h' "$TASK_ROOT")" = root:root:700:2 ] || { echo "RUNTIME_PRIVILEGE_CATALOG_TEMP_ROOT_UNSAFE" >&2; exit 1; }
RUN_ID=${TASK_ROOT##*.}
TASK_LABEL="chenyida.erp.runtime-privilege-catalog-test=$RUN_ID"
NODE_CONTAINER="cyd-runtime-privilege-catalog-node-$RUN_ID"
POSTGRES_CONTAINER="cyd-runtime-privilege-catalog-postgres-$RUN_ID"
EXPORT_ROOT="$TASK_ROOT/export"
mkdir -m 0700 "$EXPORT_ROOT"
MONITOR_STOP="$TASK_ROOT/monitor.stop"
MONITOR_FAILURE="$TASK_ROOT/monitor.failed"
resource_monitor "$SWAP_USED_KIB_BEFORE" &
MONITOR_PID=$!

[ "$(git -C "$REPOSITORY_ROOT" rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "repository root is invalid" >&2; exit 1; }
/usr/bin/timeout --signal=TERM --kill-after=5s 30s /usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned Node image is unavailable; pulling is forbidden" >&2; exit 1; }
/usr/bin/timeout --signal=TERM --kill-after=5s 30s /usr/bin/docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 || { echo "pinned PostgreSQL image is unavailable; pulling is forbidden" >&2; exit 1; }

NODE_ID=$(/usr/bin/timeout --signal=TERM --kill-after=5s 30s /usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$NODE_CONTAINER" --network none --read-only --cap-drop ALL --security-opt no-new-privileges "$NODE_IMAGE" true)
/usr/bin/timeout --signal=TERM --kill-after=5s 30s /usr/bin/docker cp "$NODE_ID:/usr/local/bin/node" "$TASK_ROOT/node"
remove_task_container "$NODE_ID" "$NODE_CONTAINER"
NODE_ID=""
chmod 0755 "$TASK_ROOT/node"
[ "$(stat -c '%U:%G:%a:%h' "$TASK_ROOT/node")" = root:root:755:1 ] || { echo "RUNTIME_PRIVILEGE_CATALOG_NODE_INVALID" >&2; exit 1; }

POSTGRES_ID=$(/usr/bin/timeout --signal=TERM --kill-after=5s 30s /usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$POSTGRES_CONTAINER" \
  --network none --read-only --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges \
  --memory 768m --memory-swap 768m --cpus 1 --pids-limit 192 --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m \
  -e ERP_RUNTIME_PRIVILEGE_CATALOG_POSTGRES_CONTAINER_MODE=YES -e NODE_OPTIONS=--max-old-space-size=384 \
  -e ERP_RUNTIME_PRIVILEGE_CATALOG_REPOSITORY_MODE="$MODE" \
  -v "$SITE_ROOT:/workspace:ro" -v "$TASK_ROOT/node:/usr/local/bin/node:ro" -v "$EXPORT_ROOT:/export:rw" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" /workspace/tests/selfhost-postgresql-runtime-privilege-catalog-postgres.sh)
CONTAINER_OUTPUT="$TASK_ROOT/container-output"
set +e
/usr/bin/timeout --signal=TERM --kill-after=30s 30m /usr/bin/docker start --attach "$POSTGRES_ID" >"$CONTAINER_OUTPUT" 2>&1
command_status=$?
set -e
if [ "$command_status" -ne 0 ]; then
  exit_code=$(/usr/bin/timeout --signal=TERM --kill-after=5s 15s /usr/bin/docker inspect --format '{{.State.ExitCode}}' "$POSTGRES_ID" 2>/dev/null || printf unknown)
  oom_killed=$(/usr/bin/timeout --signal=TERM --kill-after=5s 15s /usr/bin/docker inspect --format '{{.State.OOMKilled}}' "$POSTGRES_ID" 2>/dev/null || printf unknown)
  if [ "$oom_killed" = true ]; then echo "RUNTIME_PRIVILEGE_CATALOG_CONTAINER_OOM" >&2
  elif [ "$command_status" = 124 ] || [ "$command_status" = 137 ]; then echo "RUNTIME_PRIVILEGE_CATALOG_CONTAINER_TIMEOUT" >&2
  else
    case "$exit_code" in *[!0-9]*|'') exit_code=unknown ;; esac
    diagnostic=$(sed -n '/^RUNTIME_PRIVILEGE_[A-Z0-9_]*$/p' "$CONTAINER_OUTPUT" | tail -n 1)
    [ -z "$diagnostic" ] || echo "$diagnostic" >&2
    sql_diagnostic=$(sed -n '/^psql:[A-Za-z0-9_\/:. -]*$/p' "$CONTAINER_OUTPUT" | tail -n 1)
    [ -z "$sql_diagnostic" ] || echo "$sql_diagnostic" >&2
    stage=$(sed -n 's/^RUNTIME_PRIVILEGE_CATALOG_STAGE_FAILED stage=\([A-Z_]*\)$/\1/p' "$CONTAINER_OUTPUT" | tail -n 1)
    case "$stage" in "") echo "RUNTIME_PRIVILEGE_CATALOG_CONTAINER_FAILED exit=$exit_code" >&2 ;; *) echo "RUNTIME_PRIVILEGE_CATALOG_CONTAINER_FAILED exit=$exit_code stage=$stage" >&2 ;; esac
  fi
  exit 1
fi
[ "$(cat "$CONTAINER_OUTPUT")" = "runtime privilege PG17 compiled catalog integration passed" ] || { echo "RUNTIME_PRIVILEGE_CATALOG_OUTPUT_INVALID" >&2; exit 1; }
remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER"
POSTGRES_ID=""
: > "$MONITOR_STOP"
wait "$MONITOR_PID" || { echo "RUNTIME_PRIVILEGE_CATALOG_RUNTIME_MONITOR_FAILED" >&2; exit 1; }
MONITOR_PID=""
[ ! -e "$MONITOR_FAILURE" ] || { echo "RUNTIME_PRIVILEGE_CATALOG_RUNTIME_MONITOR_FAILED" >&2; exit 1; }

RESOURCE_AFTER=$(resource_snapshot)
[ "${RESOURCE_AFTER%%|*}" = "$OOM_KILL_BEFORE" ] || { echo "RUNTIME_PRIVILEGE_CATALOG_OOM_DRIFT" >&2; exit 1; }
SWAP_USED_KIB_AFTER=${RESOURCE_AFTER##*|}
[ "$SWAP_USED_KIB_AFTER" -le $((SWAP_USED_KIB_BEFORE+262144)) ] || { echo "RUNTIME_PRIVILEGE_CATALOG_SWAP_GROWTH_BREACH" >&2; exit 1; }
[ "$(runtime_state)" = "$RUNTIME_STATE_BEFORE" ] || { echo "RUNTIME_PRIVILEGE_CATALOG_RUNTIME_DRIFT" >&2; exit 1; }

EXPORTED="$EXPORT_ROOT/postgresql-runtime-privilege-compiled-catalog-v1.json"
[ -f "$EXPORTED" ] && [ ! -L "$EXPORTED" ] && [ "$(stat -c %a "$EXPORTED")" = 600 ] || { echo "runtime privilege compiled catalog export is invalid" >&2; exit 1; }
TARGET="$SITE_ROOT/operations/postgresql-runtime-privilege-compiled-catalog-v1.json"
if [ "$MODE" = test ]; then
  [ -f "$TARGET" ] && [ ! -L "$TARGET" ] && [ "$(stat -c '%h:%a' "$TARGET")" = 1:644 ] || { echo "RUNTIME_PRIVILEGE_COMPILED_CATALOG_TARGET_INVALID" >&2; exit 1; }
  cmp -s "$EXPORTED" "$TARGET" || { echo "RUNTIME_PRIVILEGE_COMPILED_CATALOG_STALE" >&2; exit 1; }
fi
if [ "$MODE" = generate ] || [ "$MODE" = refresh ]; then
  if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    [ -f "$TARGET" ] && [ ! -L "$TARGET" ] && [ "$(stat -c '%h:%a' "$TARGET")" = 1:644 ] || { echo "runtime privilege compiled catalog target is unsafe" >&2; exit 1; }
    if ! cmp -s "$EXPORTED" "$TARGET"; then
      [ "$MODE" = refresh ] || { echo "runtime privilege compiled catalog target conflicts" >&2; exit 1; }
      "$TASK_ROOT/node" "$SITE_ROOT/scripts/postgresql-runtime-privilege-catalog.mjs" verify-identity --catalog "$TARGET" >/dev/null || { echo "runtime privilege compiled catalog target identity is invalid" >&2; exit 1; }
      REPOSITORY_TEMP=$(mktemp "$SITE_ROOT/operations/.postgresql-runtime-privilege-compiled-catalog-v1.json.XXXXXX")
      install -m 0644 "$EXPORTED" "$REPOSITORY_TEMP"
      sync -f "$REPOSITORY_TEMP"
      mv -f -- "$REPOSITORY_TEMP" "$TARGET"
      sync -f "$SITE_ROOT/operations"
      REPOSITORY_TEMP=""
    fi
  else
    REPOSITORY_TEMP=$(mktemp "$SITE_ROOT/operations/.postgresql-runtime-privilege-compiled-catalog-v1.json.XXXXXX")
    install -m 0644 "$EXPORTED" "$REPOSITORY_TEMP"
    sync -f "$REPOSITORY_TEMP"
    ln "$REPOSITORY_TEMP" "$TARGET"
    sync -f "$SITE_ROOT/operations"
    rm -f -- "$REPOSITORY_TEMP"
    sync -f "$SITE_ROOT/operations"
    REPOSITORY_TEMP=""
  fi
  [ -f "$TARGET" ] && [ ! -L "$TARGET" ] && [ "$(stat -c '%h:%a' "$TARGET")" = 1:644 ] && cmp -s "$EXPORTED" "$TARGET" \
    || { echo "RUNTIME_PRIVILEGE_COMPILED_CATALOG_PUBLICATION_INVALID" >&2; exit 1; }
fi

trap - EXIT HUP INT TERM
cleanup
if [ "$MODE" = generate ] || [ "$MODE" = refresh ]; then printf 'runtime privilege compiled catalog repository artifact generated\n'; fi
