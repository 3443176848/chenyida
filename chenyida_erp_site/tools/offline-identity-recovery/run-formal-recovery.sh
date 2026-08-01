#!/bin/sh
set -eu
umask 077
ulimit -c 0

fail() {
  printf '%s\n' "STAGE FORMAL_RUNNER FAIL $1" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || fail RECOVERY_ROOT_REQUIRED
case "$#:${2-}" in
  1:) mode=recovery ;;
  2:--finalize-after-browser-verification) mode=finalize ;;
  2:--promote-retained-stage-only) mode=promote ;;
  3:--revoke-target-sessions-after-browser-failure) mode=session-cleanup; cleanup_username=$3 ;;
  *) fail RECOVERY_ARGUMENT_INVALID ;;
esac
run_id=$1
printf '%s\n' "$run_id" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' \
  || fail RECOVERY_RUN_ID_INVALID
if [ "$mode" = session-cleanup ]; then
  case "$cleanup_username" in
    admin|uat_20260729_manager|uat_20260729_sales|uat_20260729_engineering|uat_20260729_planning|uat_20260729_purchase|uat_20260729_warehouse|uat_20260729_production|uat_20260729_quality|uat_20260729_finance|uat_20260729_operations) ;;
    *) fail RECOVERY_SESSION_CLEANUP_ACCOUNT_REQUIRED ;;
  esac
fi

tool_root=/opt/erp/chenyida_erp_site/tools/offline-identity-recovery
attestation="/run/chenyida-erp/offline-identity-recovery-$run_id.json"
lock_file=/run/chenyida-erp/offline-identity-recovery.lock
expected_web_image=sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25
expected_worker_image=sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa
install -d -o root -g root -m 0700 /run/chenyida-erp
exec 9>"$lock_file"
flock -n 9 || fail RECOVERY_CONCURRENT_OPERATION
attestation_created=0

cleanup() {
  if [ "$attestation_created" -eq 1 ]; then rm -f -- "$attestation"; fi
}
trap cleanup EXIT HUP INT TERM

web_id_before=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-web-1 2>/dev/null) \
  || fail RECOVERY_WEB_CONTAINER_UNKNOWN
worker_id_before=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-worker-1 2>/dev/null) \
  || fail RECOVERY_WORKER_CONTAINER_UNKNOWN
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-web-1 2>/dev/null)" = exited ] \
  || fail RECOVERY_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = exited ] \
  || fail RECOVERY_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null)" = "$expected_web_image" ] \
  || fail RECOVERY_WEB_IMAGE_MISMATCH
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$expected_worker_image" ] \
  || fail RECOVERY_WORKER_IMAGE_MISMATCH

"$tool_root/create-offline-attestation.sh" "$run_id"
attestation_created=1
[ "$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-web-1 2>/dev/null)" = "$web_id_before" ] \
  || fail RECOVERY_CONTAINER_CHANGED
[ "$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$worker_id_before" ] \
  || fail RECOVERY_CONTAINER_CHANGED
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-web-1 2>/dev/null)" = exited ] \
  || fail RECOVERY_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = exited ] \
  || fail RECOVERY_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null)" = "$expected_web_image" ] \
  || fail RECOVERY_WEB_IMAGE_MISMATCH
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$expected_worker_image" ] \
  || fail RECOVERY_WORKER_IMAGE_MISMATCH

short_id=$(printf '%s' "$run_id" | tr -d '-' | cut -c1-12)
run_identity() {
docker run --rm \
  --pull never \
  --name "chenyida-erp-offline-$mode-$short_id" \
  --user 0:0 \
  --read-only \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_READ_SEARCH \
  --ulimit core=0 \
  --cpus 0.50 \
  --memory 512m \
  --memory-swap 768m \
  --pids-limit 64 \
  --network chenyida-erp-parallel_default \
  --env-file /etc/chenyida-erp/parallel.env \
  -e ERP_PROCESS_NAME=chenyida-erp-offline-recovery \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
  --mount "type=bind,src=$tool_root,dst=/app/tools/offline-identity-recovery,readonly" \
  --mount type=bind,src=/etc/chenyida-erp,dst=/etc/chenyida-erp \
  --mount type=bind,src=/run/chenyida-erp,dst=/run/chenyida-erp,readonly \
  --entrypoint /app/tools/offline-identity-recovery/identity-recovery \
  "$expected_worker_image" \
  "$@" || return $?
[ "$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-web-1 2>/dev/null)" = "$web_id_before" ] \
  || fail RECOVERY_CONTAINER_CHANGED
[ "$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$worker_id_before" ] \
  || fail RECOVERY_CONTAINER_CHANGED
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-web-1 2>/dev/null)" = exited ] \
  || fail RECOVERY_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = exited ] \
  || fail RECOVERY_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null)" = "$expected_web_image" ] \
  || fail RECOVERY_WEB_IMAGE_MISMATCH
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$expected_worker_image" ] \
  || fail RECOVERY_WORKER_IMAGE_MISMATCH
}

if [ "$mode" = finalize ]; then
  run_identity \
    --environment parallel-uat \
    --expected-migration 0036 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --browser-verification-evidence "/run/chenyida-erp/identity-recovery-browser-$run_id.json" \
    --confirm-offline-recovery \
    --finalize-recovery-stage \
    --confirm-finalize-after-browser-verification
elif [ "$mode" = session-cleanup ]; then
  run_identity \
    --environment parallel-uat \
    --expected-migration 0036 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --confirm-offline-recovery \
    --revoke-target-sessions-after-browser-failure \
    --session-cleanup-username "$cleanup_username" \
    --confirm-browser-failure-session-cleanup
elif [ "$mode" = promote ]; then
  run_identity \
    --environment parallel-uat \
    --expected-migration 0036 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --confirm-offline-recovery \
    --promote-retained-stage-only
else
  run_identity \
    --environment parallel-uat \
    --expected-migration 0036 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --confirm-offline-recovery
fi
