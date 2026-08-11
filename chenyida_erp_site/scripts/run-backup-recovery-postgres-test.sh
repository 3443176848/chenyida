#!/bin/sh
set -eu

SITE_ROOT=$(readlink -f "$(dirname "$0")/..")
NODE_IMAGE=${ERP_BACKUP_TEST_NODE_IMAGE:-node:22-bookworm-slim}
POSTGRES_IMAGE=${ERP_BACKUP_TEST_POSTGRES_IMAGE:-postgres:17-bookworm}
TEMP_ROOT=$(mktemp -d /tmp/cyd-backup-v2-runtime.XXXXXX)
RUN_ID=${TEMP_ROOT##*.}
TASK_LABEL="chenyida.erp.backup-recovery-test=$RUN_ID"
NODE_CONTAINER="cyd-backup-v2-node-$RUN_ID"
POSTGRES_CONTAINER="cyd-backup-v2-postgres-$RUN_ID"
NODE_ID=""
POSTGRES_ID=""

remove_task_container() {
  container_id=$1
  [ -n "$container_id" ] || return 0
  [ "$(docker inspect --format '{{index .Config.Labels "chenyida.erp.backup-recovery-test"}}' "$container_id" 2>/dev/null || true)" = "$RUN_ID" ] || { echo "refusing to remove a container not created by this test" >&2; return 1; }
  docker rm -f "$container_id" >/dev/null
}

cleanup() {
  remove_task_container "$POSTGRES_ID" >/dev/null 2>&1 || true
  remove_task_container "$NODE_ID" >/dev/null 2>&1 || true
  case "$TEMP_ROOT" in /tmp/cyd-backup-v2-runtime.*) rm -rf -- "$TEMP_ROOT" ;; *) echo "refusing unsafe runtime cleanup" >&2; exit 1 ;; esac
}
trap cleanup EXIT HUP INT TERM

docker image inspect "$NODE_IMAGE" >/dev/null
docker image inspect "$POSTGRES_IMAGE" >/dev/null
NODE_ID=$(docker create --label "$TASK_LABEL" --name "$NODE_CONTAINER" "$NODE_IMAGE" true)
docker cp "$NODE_ID:/usr/local/bin/node" "$TEMP_ROOT/node"
remove_task_container "$NODE_ID"; NODE_ID=""
chmod 0755 "$TEMP_ROOT/node"

POSTGRES_ID=$(docker create --label "$TASK_LABEL" --name "$POSTGRES_CONTAINER" \
  --network none --read-only --memory 768m --cpus 1.0 --pids-limit 256 \
  --tmpfs /tmp:rw,exec,nosuid,size=1280m \
  -e NODE_OPTIONS=--max-old-space-size=384 \
  -v "$SITE_ROOT:/workspace:ro" -v "$TEMP_ROOT/node:/usr/local/bin/node:ro" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" /workspace/tests/selfhost-backup-recovery-postgres.sh)
docker start --attach "$POSTGRES_ID"
remove_task_container "$POSTGRES_ID"; POSTGRES_ID=""
