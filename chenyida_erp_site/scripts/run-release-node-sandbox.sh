#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/nonexistent
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_NO_REPLACE_OBJECTS=1
export PATH HOME GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_NO_REPLACE_OBJECTS

usage() {
  echo "usage: $0 contracts|credentials|node-source|browser-e2e|special-posix|typecheck|lint" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
ACTION=$1
case "$ACTION" in contracts|credentials|node-source|browser-e2e|special-posix|typecheck|lint) : ;; *) usage ;; esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
[ -z "${ERP_RELEASE_GATE_RUN_ID:-}" ] || [ -n "${ERP_RELEASE_TEST_RUNTIME_ROOT:-}" ] || { echo "release test runtime root is required" >&2; exit 1; }
AUTHORIZED_TEST_RUNTIME_ROOT=${ERP_RELEASE_TEST_RUNTIME_ROOT:-$REPOSITORY_ROOT}
TEST_RUNTIME_ROOT=$(readlink -f "$AUTHORIZED_TEST_RUNTIME_ROOT") || { echo "release test runtime root is invalid" >&2; exit 1; }
[ "$TEST_RUNTIME_ROOT" = "$AUTHORIZED_TEST_RUNTIME_ROOT" ] || { echo "release test runtime root is not canonical" >&2; exit 1; }
if [ "$ACTION" = browser-e2e ]; then
  exec "$SCRIPT_DIR/run-release-browser-tests.sh"
fi
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
SITE_ROOT="$REPOSITORY_ROOT/chenyida_erp_site"
NODE_MODULES="$TEST_RUNTIME_ROOT/chenyida_erp_site/node_modules"
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
POSIX_IMAGE='node@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37'
TEMP_ROOT=""; CONTAINER_ID=""; CONTAINER_NAME=""; RUN_ID=${ERP_RELEASE_GATE_RUN_ID:-}

remove_container() {
  if [ -z "$CONTAINER_ID" ]; then CONTAINER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$CONTAINER_NAME" 2>/dev/null || true); fi
  [ -n "$CONTAINER_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-node-test"}}|{{.Name}}' "$CONTAINER_ID" 2>/dev/null || true)" = "$RUN_ID|/$CONTAINER_NAME" ] || { echo "refusing to remove a container not created by this sandbox" >&2; return 1; }
  /usr/bin/docker rm -f "$CONTAINER_ID" >/dev/null
  CONTAINER_ID=""
}

cleanup() {
  status=0
  remove_container >/dev/null 2>&1 || status=1
  if [ -n "$TEMP_ROOT" ]; then
    case "$TEMP_ROOT" in /tmp/chenyida-erp-release-node.*) rm -rf -- "$TEMP_ROOT" || status=1 ;; *) echo "refusing unsafe Node sandbox cleanup" >&2; status=1 ;; esac
  fi
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-release-node.XXXXXX)
[ -n "$RUN_ID" ] || RUN_ID="standalone-${TEMP_ROOT##*.}"
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "release sandbox run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "release sandbox run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "release sandbox run ID is invalid" >&2; exit 1; }
CONTAINER_NAME="cyd-release-node-test-$RUN_ID"

[ "$(id -u)" = 0 ] || { echo "release Node sandbox requires root" >&2; exit 1; }
[ -d "$NODE_MODULES" ] && [ ! -L "$NODE_MODULES" ] || { echo "candidate dependencies are unavailable" >&2; exit 1; }
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned Node sandbox image is unavailable; pulling is forbidden" >&2; exit 1; }
GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] || { echo "release sandbox commit mismatch" >&2; exit 1; }
[ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "release sandbox tree mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files block release sandbox" >&2; exit 1; }

SNAPSHOT="$TEMP_ROOT/source"
mkdir -m 0755 "$SNAPSHOT"
git_candidate archive --format=tar "$GIT_COMMIT" | /usr/bin/tar -xf - -C "$SNAPSHOT"
[ -d "$SNAPSHOT/chenyida_erp_site" ] || { echo "candidate snapshot is incomplete" >&2; exit 1; }
git_candidate ls-tree -r --name-only -z "$GIT_COMMIT" > "$SNAPSHOT/.release-tracked-files.nul"
chmod 0444 "$SNAPSHOT/.release-tracked-files.nul"
chown -R 0:0 "$SNAPSHOT"

run_node_container() {
  container_user=$1; container_workdir=$2; shift 2
  entrypoint=$1; shift
  CONTAINER_ID=$(/usr/bin/docker create \
    --pull=never \
    --name "$CONTAINER_NAME" \
    --label "chenyida.erp.release-node-test=$RUN_ID" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --user "$container_user" --memory 1024m --memory-swap 1280m --cpus 1 --pids-limit 256 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m \
    --tmpfs /test-tmp:rw,exec,nosuid,nodev,size=256m \
    --tmpfs /workspace/chenyida_erp_site/node_modules/.vite-temp:rw,exec,nosuid,nodev,size=32m \
    -e PATH=/usr/local/bin:/usr/bin:/bin -e HOME=/tmp -e LC_ALL=C -e LANG=C -e TZ=UTC \
    -e TMPDIR=/tmp \
    -e CI=1 -e NODE_ENV=test -e ERP_ENV=test -e ERP_DEPLOYMENT_CLASS=test -e NODE_OPTIONS=--max-old-space-size=768 \
    -e ERP_CREDENTIAL_SCAN_SCOPE=COMMITTED_TREE -e ERP_CREDENTIAL_SCAN_ROOT=/workspace -e ERP_CREDENTIAL_SCAN_FILE_LIST=/workspace/.release-tracked-files.nul \
    -v "$SNAPSHOT:/workspace:rw" -v "$SUPERVISOR_SITE_ROOT:/supervisor:ro" \
    -v "$NODE_MODULES:/workspace/chenyida_erp_site/node_modules:ro" \
    -w "$container_workdir" --entrypoint "$entrypoint" "$NODE_IMAGE" "$@")
  /usr/bin/docker start --attach "$CONTAINER_ID"
  remove_container
}

run_special_posix_container() {
  /usr/bin/docker image inspect "$POSIX_IMAGE" >/dev/null 2>&1 || { echo "pinned POSIX sandbox image is unavailable; pulling is forbidden" >&2; exit 1; }
  GIT_METADATA="$SNAPSHOT/.git"
  mkdir -m 0555 "$SNAPSHOT/chenyida_erp_site/node_modules"
  mkdir -m 0555 "$GIT_METADATA" "$GIT_METADATA/objects" "$GIT_METADATA/refs"
  printf '%s\n' "$GIT_COMMIT" > "$GIT_METADATA/HEAD"
  printf '%s\n' '[core]' 'repositoryformatversion = 0' 'bare = false' > "$GIT_METADATA/config"
  chmod 0444 "$GIT_METADATA/HEAD" "$GIT_METADATA/config"
  CONTAINER_ID=$(/usr/bin/docker create \
    --pull=never \
    --name "$CONTAINER_NAME" \
    --label "chenyida.erp.release-node-test=$RUN_ID" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --user 0:0 --memory 1024m --memory-swap 1280m --cpus 1 --pids-limit 256 \
    --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m \
    --tmpfs /run/chenyida-erp:rw,exec,nosuid,nodev,size=128m,mode=0700 \
    -e PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin -e HOME=/tmp -e LC_ALL=C -e LANG=C -e TZ=UTC \
    -e TMPDIR=/tmp -e CI=1 -e NODE_ENV=test -e ERP_ENV=test -e ERP_DEPLOYMENT_CLASS=test -e NODE_OPTIONS=--max-old-space-size=768 \
    -v "$SNAPSHOT:/opt/erp:ro" \
    -v "$SNAPSHOT/chenyida_erp_site:/app:ro" -v "$SNAPSHOT/chenyida_erp_site:/workspace:ro" \
    -v "$NODE_MODULES:/opt/erp/chenyida_erp_site/node_modules:ro" -v "$NODE_MODULES:/app/node_modules:ro" -v "$NODE_MODULES:/workspace/node_modules:ro" \
    -v "$SUPERVISOR_SITE_ROOT:/supervisor:ro" \
    -w /opt/erp/chenyida_erp_site --entrypoint node "$POSIX_IMAGE" \
    /supervisor/scripts/release-test-inventory.mjs run SPECIAL_POSIX)
  /usr/bin/docker start --attach "$CONTAINER_ID"
  remove_container
}

CONTAINER_USER=0:0
CONTAINER_WORKDIR=/workspace/chenyida_erp_site
case "$ACTION" in
  contracts)
    run_node_container 0:0 /workspace/chenyida_erp_site node /supervisor/scripts/release-test-inventory.mjs run NODE_RELEASE_CONTRACT
    CONTAINER_USER=0:0
    CONTAINER_WORKDIR=/supervisor
    set -- node --experimental-strip-types --test --test-concurrency=1 tests/selfhost-release-identity-contract.test.mjs tests/selfhost-release-image-evidence-producer.test.mjs tests/selfhost-release-manifest-contract.test.mjs tests/selfhost-release-gate-contract.test.mjs tests/selfhost-release-migration-allowlist.test.mjs
    ;;
  credentials)
    CONTAINER_WORKDIR=/workspace
    set -- node /supervisor/scripts/check-credentials.mjs
    ;;
  node-source)
    set -- /bin/sh -c 'set -eu; ./node_modules/.bin/vinext build; node scripts/ensure-vinext-client-assets.mjs; node /supervisor/scripts/release-test-inventory.mjs run NODE_SOURCE' release-node-source
    ;;
  special-posix)
    run_special_posix_container
    exit 0
    ;;
  typecheck)
    set -- node /supervisor/scripts/release-test-inventory.mjs typecheck
    ;;
  lint)
    set -- ./node_modules/.bin/eslint .
    ;;
esac
ENTRYPOINT=$1
shift
run_node_container "$CONTAINER_USER" "$CONTAINER_WORKDIR" "$ENTRYPOINT" "$@"
