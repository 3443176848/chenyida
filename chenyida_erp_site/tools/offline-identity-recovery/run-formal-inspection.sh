#!/bin/sh
set -eu
umask 077
ulimit -c 0

fail() {
  printf '%s\n' "STAGE INSPECT_RUNNER FAIL $1" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || fail RECOVERY_ROOT_REQUIRED
[ "$#" -eq 1 ] || fail RECOVERY_ARGUMENT_INVALID
case "$1" in
  --business-fingerprint|--protected-data-fingerprint|--active-target-sessions|--identity-summary) mode=$1 ;;
  *) fail RECOVERY_ARGUMENT_INVALID ;;
esac

expected_worker_image=sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa
tool_root=/opt/erp/chenyida_erp_site/tools/offline-identity-recovery
lock_file=/run/chenyida-erp/offline-identity-recovery.lock
install -d -o root -g root -m 0700 /run/chenyida-erp
exec 9>"$lock_file"
flock -n 9 || fail RECOVERY_CONCURRENT_OPERATION

[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$expected_worker_image" ] \
  || fail RECOVERY_WORKER_IMAGE_MISMATCH
[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = chenyida-erp-parallel ] \
  || fail RECOVERY_CONTAINER_SCOPE_MISMATCH
[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = worker ] \
  || fail RECOVERY_CONTAINER_SCOPE_MISMATCH

docker run --rm \
  --pull never \
  --name chenyida-erp-offline-inspection \
  --user 0:0 \
  --read-only \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  --cap-add DAC_READ_SEARCH \
  --ulimit core=0 \
  --cpus 0.50 \
  --memory 384m \
  --memory-swap 512m \
  --pids-limit 64 \
  --network chenyida-erp-parallel_default \
  --env-file /etc/chenyida-erp/parallel.env \
  -e ERP_PROCESS_NAME=chenyida-erp-offline-inspector \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --mount "type=bind,src=$tool_root,dst=/app/tools/offline-identity-recovery,readonly" \
  --entrypoint node \
  "$expected_worker_image" \
    --no-warnings \
    --experimental-strip-types \
    /app/tools/offline-identity-recovery/inspect.ts \
    "$mode" \
    --expected-database-name chenyida_erp
