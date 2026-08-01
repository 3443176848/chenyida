#!/bin/sh
set -eu
umask 077
ulimit -c 0

fail() {
  printf '%s\n' "STAGE FORMAL_BROWSER FAIL $1" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || fail RECOVERY_ROOT_REQUIRED
[ "$#" -eq 1 ] || fail RECOVERY_ARGUMENT_INVALID
run_id=$1
printf '%s\n' "$run_id" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' \
  || fail RECOVERY_RUN_ID_INVALID

tool_root=/opt/erp/chenyida_erp_site/tools/offline-identity-recovery
runtime_root=/run/chenyida-erp
module_root=$runtime_root/identity-recovery-playwright
provisional=$runtime_root/.identity-recovery-browser-$run_id.provisional.json
evidence=$runtime_root/identity-recovery-browser-$run_id.json
lock_file=$runtime_root/offline-identity-recovery.lock
short_id=$(printf '%s' "$run_id" | tr -d '-' | cut -c1-12)
network_name=chenyida-erp-identity-browser-$short_id
expected_web_image=sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25
expected_worker_image=sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa
expected_browser_image=sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd

install -d -o root -g root -m 0700 "$runtime_root"
exec 9>"$lock_file"
flock -n 9 || fail RECOVERY_CONCURRENT_OPERATION
[ ! -e "$provisional" ] || fail RECOVERY_BROWSER_EVIDENCE_EXISTS
[ ! -e "$evidence" ] || fail RECOVERY_BROWSER_EVIDENCE_EXISTS
[ -f "$module_root/node_modules/playwright/index.mjs" ] || fail RECOVERY_BROWSER_MODULE_MISSING
[ -f "$module_root/.tree-sha256" ] || fail RECOVERY_BROWSER_MODULE_MISSING
[ "$(stat -c '%u:%g:%a' "$module_root")" = 0:0:700 ] || fail RECOVERY_BROWSER_MODULE_METADATA_INVALID
[ "$(stat -c '%u:%g:%a:%h' "$module_root/.tree-sha256")" = 0:0:600:1 ] || fail RECOVERY_BROWSER_MODULE_METADATA_INVALID
grep -Eq '"version"[[:space:]]*:[[:space:]]*"1\.51\.1"' "$module_root/node_modules/playwright/package.json" \
  || fail RECOVERY_BROWSER_MODULE_VERSION_INVALID
module_digest=$(find "$module_root/node_modules" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
[ "$module_digest" = "$(tr -d '\n' <"$module_root/.tree-sha256")" ] || fail RECOVERY_BROWSER_MODULE_INTEGRITY_INVALID
[ "$(docker image inspect --format '{{.Id}}' "$expected_browser_image" 2>/dev/null)" = "$expected_browser_image" ] \
  || fail RECOVERY_BROWSER_IMAGE_MISMATCH
[ "$(stat -c '%u:%g:%a:%h' /etc/chenyida-erp/parallel-admin.txt)" = 0:0:600:1 ] \
  || fail RECOVERY_CANONICAL_METADATA_INVALID
[ "$(stat -c '%u:%g:%a:%h' /etc/chenyida-erp/uat-role-accounts.txt)" = 0:0:600:1 ] \
  || fail RECOVERY_CANONICAL_METADATA_INVALID

web_id=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-web-1 2>/dev/null) || fail RECOVERY_WEB_STATE_INVALID
worker_id=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-worker-1 2>/dev/null) || fail RECOVERY_WORKER_STATE_INVALID
postgres_id=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-postgres-1 2>/dev/null) || fail RECOVERY_POSTGRES_STATE_INVALID
caddy_id=$(docker inspect --format '{{.Id}}' chenyida-erp-parallel-caddy-1 2>/dev/null) || fail RECOVERY_CADDY_STATE_INVALID
postgres_image=$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-postgres-1 2>/dev/null) || fail RECOVERY_POSTGRES_STATE_INVALID
caddy_image=$(docker inspect --format '{{.Image}}' chenyida-erp-parallel-caddy-1 2>/dev/null) || fail RECOVERY_CADDY_STATE_INVALID

assert_services() {
  [ "$(docker inspect --format '{{.Id}}:{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}:{{.Image}}' chenyida-erp-parallel-web-1 2>/dev/null)" \
    = "$web_id:running:healthy:$expected_web_image" ] || fail RECOVERY_WEB_STATE_INVALID
  [ "$(docker inspect --format '{{.Id}}:{{.State.Status}}:{{.Image}}' chenyida-erp-parallel-worker-1 2>/dev/null)" \
    = "$worker_id:running:$expected_worker_image" ] || fail RECOVERY_WORKER_STATE_INVALID
  [ "$(docker inspect --format '{{.Id}}:{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}:{{.Image}}' chenyida-erp-parallel-postgres-1 2>/dev/null)" \
    = "$postgres_id:running:healthy:$postgres_image" ] || fail RECOVERY_POSTGRES_STATE_INVALID
  [ "$(docker inspect --format '{{.Id}}:{{.State.Status}}:{{.Image}}' chenyida-erp-parallel-caddy-1 2>/dev/null)" \
    = "$caddy_id:running:$caddy_image" ] || fail RECOVERY_CADDY_STATE_INVALID
}

network_created=0
caddy_connected=0
promotion_attempted=0
preserve_evidence=0
cleanup() {
  if [ "$caddy_connected" -eq 1 ]; then
    docker network disconnect "$network_name" chenyida-erp-parallel-caddy-1 >/dev/null 2>&1 || true
  fi
  if [ "$network_created" -eq 1 ]; then
    docker network rm "$network_name" >/dev/null 2>&1 || true
  fi
  if [ "$preserve_evidence" -eq 0 ]; then
    if [ -e "$provisional" ]; then unlink "$provisional"; fi
    if [ "$promotion_attempted" -eq 1 ] && [ -e "$evidence" ]; then unlink "$evidence"; fi
    sync -f "$runtime_root" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

assert_services
if docker network inspect "$network_name" >/dev/null 2>&1; then fail RECOVERY_BROWSER_NETWORK_EXISTS; fi
docker network create --driver bridge --internal --label chenyida.erp.scope=offline-identity-browser "$network_name" >/dev/null
network_created=1
docker network connect --alias 43.135.148.43.nip.io "$network_name" chenyida-erp-parallel-caddy-1
caddy_connected=1
assert_services

docker run --rm \
  --pull never \
  --name "chenyida-erp-browser-$short_id" \
  --user 0:0 \
  --read-only \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  --ulimit core=0 \
  --cpus 1.00 \
  --memory 768m \
  --memory-swap 1024m \
  --pids-limit 256 \
  --shm-size 256m \
  --network "$network_name" \
  -e ERP_DEPLOYMENT_CLASS=uat \
  -e PLAYWRIGHT_MODULE_PATH=file:///playwright/node_modules/playwright/index.mjs \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e RECOVERY_BROWSER_IMAGE_ID="$expected_browser_image" \
  -e RECOVERY_WEB_IMAGE_ID="$expected_web_image" \
  -e RECOVERY_PLAYWRIGHT_VERSION=1.51.1 \
  -e NODE_OPTIONS=--max-old-space-size=256 \
  -e DEBUG= -e PWDEBUG= -e NODE_DEBUG= -e DEBUG_COLORS= \
  -e HTTP_PROXY= -e HTTPS_PROXY= -e ALL_PROXY= -e NO_PROXY= \
  -e http_proxy= -e https_proxy= -e all_proxy= -e no_proxy= \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /root/.cache:rw,noexec,nosuid,nodev,size=16m \
  --mount "type=bind,src=$tool_root,dst=/runner,readonly" \
  --mount "type=bind,src=$module_root,dst=/playwright,readonly" \
  --mount type=bind,src=/etc/chenyida-erp/parallel-admin.txt,dst=/credentials/parallel-admin.txt,readonly \
  --mount type=bind,src=/etc/chenyida-erp/uat-role-accounts.txt,dst=/credentials/uat-role-accounts.txt,readonly \
  --mount "type=bind,src=$runtime_root,dst=/evidence" \
  --entrypoint node \
  "$expected_browser_image" \
  /runner/browser-verify.mjs \
  --environment parallel-uat \
  --expected-run-id "$run_id" \
  --evidence-path "/evidence/.identity-recovery-browser-$run_id.provisional.json"

assert_services
docker network disconnect "$network_name" chenyida-erp-parallel-caddy-1
caddy_connected=0
docker network rm "$network_name" >/dev/null
network_created=0
assert_services

promotion_attempted=1
docker run --rm \
  --pull never \
  --name "chenyida-erp-browser-evidence-$short_id" \
  --user 0:0 \
  --read-only \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_READ_SEARCH \
  --ulimit core=0 \
  --cpus 0.25 \
  --memory 192m \
  --memory-swap 256m \
  --pids-limit 32 \
  --network none \
  -e ERP_DEPLOYMENT_CLASS=uat \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=8m \
  --mount "type=bind,src=$tool_root,dst=/app/tools/offline-identity-recovery,readonly" \
  --mount "type=bind,src=$runtime_root,dst=/evidence" \
  --entrypoint node \
  "$expected_worker_image" \
  --no-warnings --experimental-strip-types \
  /app/tools/offline-identity-recovery/promote-browser-evidence.ts \
  --environment parallel-uat \
  --expected-run-id "$run_id" \
  --confirm-host-postcheck

[ ! -e "$provisional" ] || fail RECOVERY_BROWSER_EVIDENCE_INVALID
[ "$(stat -c '%u:%g:%a:%h' "$evidence" 2>/dev/null)" = 0:0:600:1 ] \
  || fail RECOVERY_BROWSER_EVIDENCE_INVALID
assert_services
preserve_evidence=1
trap - EXIT HUP INT TERM
printf '%s\n' 'STAGE FORMAL_BROWSER PASS'
