#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL PATH

SITE_ROOT=$(readlink -f "$(dirname "$0")/..")
REPOSITORY_ROOT=$(readlink -f "$SITE_ROOT/..")
NODE_MODULES="$SITE_ROOT/node_modules"
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
POSTGRES_IMAGE='postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394'
TASK_ROOT=$(mktemp -d /tmp/cyd-runtime-lock-privilege-runtime.XXXXXX)
RUN_ID=${TASK_ROOT##*.}
TASK_LABEL="chenyida.erp.runtime-lock-privilege-test=$RUN_ID"
NODE_CONTAINER="cyd-runtime-lock-privilege-node-$RUN_ID"
POSTGRES_CONTAINER="cyd-runtime-lock-privilege-postgres-$RUN_ID"
NODE_ID=""
POSTGRES_ID=""

remove_task_container() {
  container_id=$1
  container_name=$2
  if [ -z "$container_id" ]; then container_id=$(/usr/bin/docker inspect --format '{{.Id}}' "$container_name" 2>/dev/null || true); fi
  [ -n "$container_id" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.runtime-lock-privilege-test"}}|{{.Name}}' "$container_id" 2>/dev/null || true)" = "$RUN_ID|/$container_name" ] || {
    echo "refusing to remove a container not created by this test" >&2
    return 1
  }
  /usr/bin/docker rm -f "$container_id" >/dev/null
}

cleanup() {
  status=0
  remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || status=1
  remove_task_container "$NODE_ID" "$NODE_CONTAINER" >/dev/null 2>&1 || status=1
  case "$TASK_ROOT" in
    /tmp/cyd-runtime-lock-privilege-runtime.*) rm -rf -- "$TASK_ROOT" || status=1 ;;
    *) echo "refusing unsafe runtime lock privilege test cleanup" >&2; status=1 ;;
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

[ "$(id -u)" = 0 ] || { echo "runtime lock privilege PostgreSQL test requires root" >&2; exit 1; }
[ -d "$NODE_MODULES" ] && [ ! -L "$NODE_MODULES" ] || { echo "approved Node dependencies are unavailable" >&2; exit 1; }
[ "$(git -C "$REPOSITORY_ROOT" rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "repository root is invalid" >&2; exit 1; }
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned Node image is unavailable; pulling is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 || { echo "pinned PostgreSQL image is unavailable; pulling is forbidden" >&2; exit 1; }

NODE_ID=$(/usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$NODE_CONTAINER" --network none --read-only --cap-drop ALL --security-opt no-new-privileges "$NODE_IMAGE" true)
/usr/bin/docker cp "$NODE_ID:/usr/local/bin/node" "$TASK_ROOT/node"
remove_task_container "$NODE_ID" "$NODE_CONTAINER"
NODE_ID=""
chmod 0755 "$TASK_ROOT/node"

POSTGRES_ID=$(/usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$POSTGRES_CONTAINER" \
  --network none --read-only --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges \
  --memory 768m --memory-swap 1g --cpus 1 --pids-limit 192 \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=1024m \
  -e ERP_RUNTIME_LOCK_PRIVILEGE_POSTGRES_CONTAINER_MODE=YES -e NODE_OPTIONS=--max-old-space-size=384 \
  -v "$SITE_ROOT:/workspace:ro" -v "$NODE_MODULES:/workspace/node_modules:ro" -v "$TASK_ROOT/node:/usr/local/bin/node:ro" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" /workspace/tests/selfhost-runtime-lock-privilege-postgres.sh)
if ! /usr/bin/docker start --attach "$POSTGRES_ID"; then
  exit_code=$(/usr/bin/docker inspect --format '{{.State.ExitCode}}' "$POSTGRES_ID" 2>/dev/null || printf unknown)
  state_error=$(/usr/bin/docker inspect --format '{{.State.Error}}' "$POSTGRES_ID" 2>/dev/null || printf unknown)
  /usr/bin/docker logs "$POSTGRES_ID" 2>/dev/null || true
  echo "runtime lock privilege PostgreSQL test failed: exit=$exit_code state=$state_error" >&2
  exit 1
fi
remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER"
POSTGRES_ID=""
