#!/bin/sh
set -eu
umask 077
ulimit -c 0

fail() {
  printf '%s\n' "STAGE TARGETED_FORMAL_RUNNER FAIL $1" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || fail TARGETED_ROOT_REQUIRED
case "$#:${3-}" in
  2:) mode=recovery ;;
  3:--promote-retained-targeted-candidate-only) mode=promote ;;
  4:--revoke-targeted-verification-sessions) mode=cleanup; verification_attempt=$4 ;;
  *) fail TARGETED_ARGUMENT_INVALID ;;
esac
run_id=$1
expected_version=$2
printf '%s\n' "$run_id" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' \
  || fail TARGETED_RUN_ID_INVALID
printf '%s\n' "$expected_version" | grep -Eq '^[1-9][0-9]*$' || fail TARGETED_VERSION_INVALID
if [ "$mode" = cleanup ]; then
  case "$verification_attempt" in 1|2) ;; *) fail TARGETED_VERIFICATION_ATTEMPT_INVALID ;; esac
fi

tool_root=/opt/erp/chenyida_erp_site/tools/offline-identity-recovery
identity_root=/opt/erp/chenyida_erp_site/app/lib/identity-selfhost
attestation="/run/chenyida-erp/targeted-offline-identity-recovery-$run_id.json"
lock_file=/run/chenyida-erp/offline-identity-recovery.lock
expected_web_image=sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8
expected_worker_image=sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa
confirmation="RECOVER EXACTLY uat_20260729_operations AS operations ACTIVE true AT VERSION $expected_version WITH RUN $run_id"
install -d -o root -g root -m 0700 /run/chenyida-erp
exec 9>"$lock_file"
flock -n 9 || fail TARGETED_CONCURRENT_OPERATION
attestation_created=0

cleanup() {
  if [ "$attestation_created" -eq 1 ]; then rm -f -- "$attestation"; fi
}
trap cleanup EXIT HUP INT TERM

web_id_before=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-web-1 2>/dev/null) \
  || fail TARGETED_WEB_CONTAINER_UNKNOWN
worker_id_before=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-worker-1 2>/dev/null) \
  || fail TARGETED_WORKER_CONTAINER_UNKNOWN
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-web-1 2>/dev/null)" = exited ] \
  || fail TARGETED_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = exited ] \
  || fail TARGETED_WRITERS_STILL_ACTIVE
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null)" = "$expected_web_image" ] \
  || fail TARGETED_WEB_IMAGE_MISMATCH
[ "$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" = "$expected_worker_image" ] \
  || fail TARGETED_WORKER_IMAGE_MISMATCH

"$tool_root/create-targeted-offline-attestation.sh" "$run_id"
attestation_created=1
short_id=$(printf '%s' "$run_id" | tr -d '-' | cut -c1-12)

assert_offline_scope() {
  [ "$(docker inspect --format '{{.Id}}:{{.State.Status}}:{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null)" \
    = "$web_id_before:exited:$expected_web_image" ] || fail TARGETED_WEB_STATE_CHANGED
  [ "$(docker inspect --format '{{.Id}}:{{.State.Status}}:{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" \
    = "$worker_id_before:exited:$expected_worker_image" ] || fail TARGETED_WORKER_STATE_CHANGED
}

run_identity() {
  status=0
  if docker run --rm -i \
    --pull never \
    --name "chenyida-erp-targeted-$mode-$short_id" \
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
    -e ERP_PROCESS_NAME=chenyida-erp-targeted-offline-recovery \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m \
    --mount "type=bind,src=$tool_root,dst=/app/tools/offline-identity-recovery,readonly" \
    --mount "type=bind,src=$identity_root,dst=/app/app/lib/identity-selfhost,readonly" \
    --mount type=bind,src=/etc/chenyida-erp,dst=/etc/chenyida-erp \
    --mount type=bind,src=/run/chenyida-erp,dst=/run/chenyida-erp,readonly \
    --entrypoint /app/tools/offline-identity-recovery/identity-recovery \
    "$expected_worker_image" \
    "$@"; then
    status=0
  else
    status=$?
  fi
  assert_offline_scope
  return "$status"
}

if [ "$mode" = promote ]; then
  if run_identity \
    --environment parallel-uat \
    --expected-migration 0038 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --target-username uat_20260729_operations \
    --expected-role operations \
    --expected-active true \
    --expected-user-version "$expected_version" \
    --targeted-confirmation-phrase "$confirmation" \
    --promote-retained-targeted-candidate-only </dev/null; then
    status=0
  else
    status=$?
  fi
elif [ "$mode" = cleanup ]; then
  if run_identity \
    --environment parallel-uat \
    --expected-migration 0038 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --target-username uat_20260729_operations \
    --expected-role operations \
    --expected-active true \
    --expected-user-version "$expected_version" \
    --targeted-confirmation-phrase "$confirmation" \
    --verification-attempt "$verification_attempt" \
    --revoke-targeted-verification-sessions </dev/null; then
    status=0
  else
    status=$?
  fi
else
  generate_password() {
    while :; do
      random_part=$(openssl rand -hex 32) || fail TARGETED_RANDOM_GENERATION_FAILED
      case "$random_part" in
        *123456*) random_part=; continue ;;
      esac
      printf 'Z9!%sAa\n' "$random_part"
      random_part=
      return 0
    done
  }
  if generate_password | run_identity \
    --environment parallel-uat \
    --expected-migration 0038 \
    --expected-run-id "$run_id" \
    --offline-attestation "$attestation" \
    --target-username uat_20260729_operations \
    --expected-role operations \
    --expected-active true \
    --expected-user-version "$expected_version" \
    --targeted-confirmation-phrase "$confirmation" \
    --targeted-finalize-account \
    --targeted-password-stdin; then
    status=0
  else
    status=$?
  fi
fi

random_part=
assert_offline_scope
exit "$status"
