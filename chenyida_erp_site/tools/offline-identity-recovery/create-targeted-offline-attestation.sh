#!/bin/sh
set -eu
umask 077
ulimit -c 0

fail() {
  printf '%s\n' "STAGE TARGETED_OFFLINE FAIL $1" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || fail TARGETED_ROOT_REQUIRED
[ "$#" -eq 1 ] || fail TARGETED_ARGUMENT_INVALID
run_id=$1
printf '%s\n' "$run_id" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' \
  || fail TARGETED_RUN_ID_INVALID

expected_web_image=sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8
expected_worker_image=sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa
web_state=$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-web-1 2>/dev/null) \
  || fail TARGETED_WEB_CONTAINER_UNKNOWN
worker_state=$(docker inspect --format '{{.State.Status}}' chenyida-erp-parallel-worker-1 2>/dev/null) \
  || fail TARGETED_WORKER_CONTAINER_UNKNOWN
[ "$web_state" = exited ] || fail TARGETED_WRITERS_STILL_ACTIVE
[ "$worker_state" = exited ] || fail TARGETED_WRITERS_STILL_ACTIVE

web_id=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-web-1 2>/dev/null) || fail TARGETED_WEB_CONTAINER_UNKNOWN
worker_id=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-worker-1 2>/dev/null) || fail TARGETED_WORKER_CONTAINER_UNKNOWN
web_image=$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null) || fail TARGETED_WEB_CONTAINER_UNKNOWN
worker_image=$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null) || fail TARGETED_WORKER_CONTAINER_UNKNOWN
web_project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' chenyida-erp-parallel-web-1 2>/dev/null) || fail TARGETED_WEB_CONTAINER_UNKNOWN
worker_project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' chenyida-erp-parallel-worker-1 2>/dev/null) || fail TARGETED_WORKER_CONTAINER_UNKNOWN
web_service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' chenyida-erp-parallel-web-1 2>/dev/null) || fail TARGETED_WEB_CONTAINER_UNKNOWN
worker_service=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' chenyida-erp-parallel-worker-1 2>/dev/null) || fail TARGETED_WORKER_CONTAINER_UNKNOWN
[ "$web_image" = "$expected_web_image" ] || fail TARGETED_WEB_IMAGE_MISMATCH
[ "$worker_image" = "$expected_worker_image" ] || fail TARGETED_WORKER_IMAGE_MISMATCH
[ "$web_project" = chenyida-erp-parallel ] || fail TARGETED_CONTAINER_SCOPE_MISMATCH
[ "$worker_project" = chenyida-erp-parallel ] || fail TARGETED_CONTAINER_SCOPE_MISMATCH
[ "$web_service" = web ] || fail TARGETED_CONTAINER_SCOPE_MISMATCH
[ "$worker_service" = worker ] || fail TARGETED_CONTAINER_SCOPE_MISMATCH

attestation_dir=/run/chenyida-erp
attestation_path="$attestation_dir/targeted-offline-identity-recovery-$run_id.json"
install -d -o root -g root -m 0700 "$attestation_dir"
[ ! -e "$attestation_path" ] || fail TARGETED_OFFLINE_ATTESTATION_EXISTS
temporary_path=$(mktemp "$attestation_dir/.targeted-offline-attestation.XXXXXX")
installed=0
cleanup() {
  rm -f -- "$temporary_path"
  if [ "$installed" -eq 1 ]; then
    rm -f -- "$attestation_path"
    sync -f "$attestation_dir" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

printf '{"format_version":"chenyida-erp-targeted-offline-attestation-v1","recovery_run_id":"%s","issued_at_epoch":%s,"web_name":"chenyida-erp-parallel-web-1","web_state":"%s","web_container_id":"%s","web_image_id":"%s","web_project":"%s","web_service":"%s","worker_name":"chenyida-erp-parallel-worker-1","worker_state":"%s","worker_container_id":"%s","worker_image_id":"%s","worker_project":"%s","worker_service":"%s"}\n' \
  "$run_id" "$(date +%s)" "$web_state" "$web_id" "$web_image" "$web_project" "$web_service" \
  "$worker_state" "$worker_id" "$worker_image" "$worker_project" "$worker_service" > "$temporary_path"
chown root:root "$temporary_path"
chmod 0600 "$temporary_path"
sync -f "$temporary_path"
mv -T "$temporary_path" "$attestation_path"
installed=1
sync -f "$attestation_path"
sync -f "$attestation_dir"
installed=0
trap - EXIT HUP INT TERM
printf '%s\n' 'STAGE TARGETED_OFFLINE PASS'
