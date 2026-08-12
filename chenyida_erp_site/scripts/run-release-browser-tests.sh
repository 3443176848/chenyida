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

NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
POSTGRES_IMAGE='postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394'
BROWSER_IMAGE='mcr.microsoft.com/playwright@sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961'
BROWSER_CONFIG_DIGEST='sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961'
BROWSER_EXECUTABLE='/ms-playwright/chromium-1161/chrome-linux/chrome'
BROWSER_EXECUTABLE_SHA256='efb2bece6f2f5bc00dc270162d2241c86d509ca4f4297b1eb0f5cd8894d050be'
BROWSER_VERSION='Chromium 134.0.6998.35'
PACKAGE_LOCK_SHA256='3c0522f9ea75cc6c0bfa4c3c92e232f47ce326e73054e070a03bea8320a91815'
NODE_MODULES_TREE_SHA256='3d727122206562df4ebfe24139bfd7b2ae16a299ef2e62b6d55b19e61c2db819'
TREE_DIGEST_COMMAND="{ /usr/bin/find -P . -xdev -printf '%y|%m|%P|%l\\n' | LC_ALL=C /usr/bin/sort; /usr/bin/find -P . -xdev -type f -print0 | LC_ALL=C /usr/bin/sort -z | /usr/bin/xargs -0 /usr/bin/sha256sum; } | /usr/bin/sha256sum"

container_main() {
  [ "$#" -eq 0 ] || { echo "release Browser container invocation is invalid" >&2; exit 1; }
  [ "$(node --version)" = v22.14.0 ] || { echo "release Browser Node version mismatch" >&2; exit 1; }
  [ -x "$BROWSER_EXECUTABLE" ] || { echo "pinned Chromium executable is unavailable" >&2; exit 1; }
  [ "$(sha256sum "$BROWSER_EXECUTABLE" | cut -d ' ' -f 1)" = "$BROWSER_EXECUTABLE_SHA256" ] || { echo "pinned Chromium executable digest mismatch" >&2; exit 1; }
  [ "$("$BROWSER_EXECUTABLE" --version)" = "$BROWSER_VERSION" ] || { echo "pinned Chromium version mismatch" >&2; exit 1; }
  [ "$(node -p "require('/workspace/node_modules/playwright-core/package.json').name + '@' + require('/workspace/node_modules/playwright-core/package.json').version")" = playwright-core@1.51.1 ] || { echo "pinned Playwright package mismatch" >&2; exit 1; }
  [ -f /workspace/dist/standalone/server.js ] || { echo "release Browser standalone build is unavailable" >&2; exit 1; }
  [ -d /postgres-rootfs ] && [ ! -L /postgres-rootfs ] || { echo "release Browser PostgreSQL root is invalid" >&2; exit 1; }

  PGDATA=/var/lib/postgresql/data
  PG_BIN=/usr/lib/postgresql/17/bin
  mkdir -p "/postgres-rootfs$PGDATA" /tmp/browser-home
  chown -R 999:999 "/postgres-rootfs$PGDATA"
  chown 1000:1000 /tmp/browser-home /test-tmp
  chmod 0700 "/postgres-rootfs$PGDATA" /tmp/browser-home
  chroot --userspec=999:999 /postgres-rootfs "$PG_BIN/initdb" -D "$PGDATA" --auth-local=trust --auth-host=trust --locale=C --encoding=UTF8 >/tmp/release-browser-initdb.log
  chroot --userspec=999:999 /postgres-rootfs "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/postgresql.log" -o "-h 127.0.0.1 -p 5432 -c shared_buffers=32MB -c max_connections=40 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c unix_socket_directories=/tmp" -w start
  pg_started=YES
  stop_postgres() {
    [ "${pg_started:-NO}" = YES ] || return 0
    chroot --userspec=999:999 /postgres-rootfs "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop
    pg_started=NO
  }
  container_signal() { signal_status=$1; trap - EXIT HUP INT TERM; stop_postgres; exit "$signal_status"; }
  trap stop_postgres EXIT
  trap 'container_signal 129' HUP
  trap 'container_signal 130' INT
  trap 'container_signal 143' TERM
  [ "$(chroot --userspec=999:999 /postgres-rootfs "$PG_BIN/psql" -h 127.0.0.1 -p 5432 -d postgres -Atc 'select current_database()')" = postgres ] || { echo "isolated PostgreSQL did not start" >&2; exit 1; }

  setpriv --reuid=1000 --regid=1000 --clear-groups env -i \
    PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin \
    HOME=/tmp/browser-home LC_ALL=C LANG=C TZ=UTC TMPDIR=/test-tmp CI=1 \
    NODE_ENV=test NODE_OPTIONS=--max-old-space-size=512 ERP_ENV=test ERP_DEPLOYMENT_CLASS=test \
    PLAYWRIGHT_MODULE_PATH=playwright-core PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$BROWSER_EXECUTABLE" \
    ERP_RELEASE_BROWSER_PACKAGE_VERSION="$ERP_RELEASE_BROWSER_PACKAGE_VERSION" \
    ERP_RELEASE_BROWSER_GIT_COMMIT="$ERP_RELEASE_BROWSER_GIT_COMMIT" \
    node --experimental-strip-types /supervisor/scripts/release-browser-e2e-runner.mjs
  stop_postgres
  trap - EXIT HUP INT TERM
}

if [ "${ERP_RELEASE_BROWSER_CONTAINER_MODE:-}" = YES ]; then
  container_main "$@"
  exit 0
fi

[ "$#" -eq 0 ] || { echo "usage: $0" >&2; exit 2; }
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
SITE_ROOT="$REPOSITORY_ROOT/chenyida_erp_site"
NODE_MODULES="$SITE_ROOT/node_modules"
TEMP_ROOT=""; CURRENT_CONTAINER_ID=""; CURRENT_CONTAINER_NAME=""; RUN_ID=${ERP_RELEASE_GATE_RUN_ID:-}

remove_task_container() {
  [ -n "$CURRENT_CONTAINER_NAME" ] || return 0
  if [ -z "$CURRENT_CONTAINER_ID" ]; then CURRENT_CONTAINER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$CURRENT_CONTAINER_NAME" 2>/dev/null || true); fi
  [ -n "$CURRENT_CONTAINER_ID" ] || { CURRENT_CONTAINER_NAME=""; return 0; }
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-browser-test"}}|{{.Name}}' "$CURRENT_CONTAINER_ID" 2>/dev/null || true)" = "$RUN_ID|/$CURRENT_CONTAINER_NAME" ] || { echo "refusing to remove a container not created by the Browser sandbox" >&2; return 1; }
  /usr/bin/docker rm -f "$CURRENT_CONTAINER_ID" >/dev/null
  CURRENT_CONTAINER_ID=""; CURRENT_CONTAINER_NAME=""
}

cleanup() {
  status=0
  remove_task_container >/dev/null 2>&1 || status=1
  if [ -n "$TEMP_ROOT" ]; then
    case "$TEMP_ROOT" in /tmp/chenyida-erp-release-browser.*) rm -rf -- "$TEMP_ROOT" || status=1 ;; *) echo "refusing unsafe Browser sandbox cleanup" >&2; status=1 ;; esac
  fi
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

[ "$(id -u)" = 0 ] || { echo "release Browser sandbox requires root" >&2; exit 1; }
[ -d "$NODE_MODULES" ] && [ ! -L "$NODE_MODULES" ] || { echo "candidate dependencies are unavailable" >&2; exit 1; }
[ "$(sha256sum "$SITE_ROOT/package-lock.json" | cut -d ' ' -f 1)" = "$PACKAGE_LOCK_SHA256" ] || { echo "release Browser lockfile mismatch" >&2; exit 1; }
[ "$(cd "$NODE_MODULES" && /bin/sh -c "$TREE_DIGEST_COMMAND" | cut -d ' ' -f 1)" = "$NODE_MODULES_TREE_SHA256" ] || { echo "release Browser dependency tree mismatch" >&2; exit 1; }
for image in "$NODE_IMAGE" "$POSTGRES_IMAGE" "$BROWSER_IMAGE"; do
  /usr/bin/docker image inspect "$image" >/dev/null 2>&1 || { echo "pinned release Browser image is unavailable; pulling is forbidden" >&2; exit 1; }
done
BROWSER_IMAGE_STATE=$(/usr/bin/docker image inspect --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{json .RepoDigests}}' "$BROWSER_IMAGE")
case "$BROWSER_IMAGE_STATE" in "$BROWSER_CONFIG_DIGEST|linux/amd64|"*"\"$BROWSER_IMAGE\""*) : ;; *) echo "pinned Browser image identity mismatch" >&2; exit 1 ;; esac

GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] || { echo "release Browser commit mismatch" >&2; exit 1; }
[ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "release Browser tree mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files block release Browser sandbox" >&2; exit 1; }

PACKAGE_VERSION=$(git_candidate show "$GIT_COMMIT:chenyida_erp_site/package.json" | sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)",[[:space:]]*$/\1/p')
[ -n "$PACKAGE_VERSION" ] || { echo "release Browser package version is invalid" >&2; exit 1; }
TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-release-browser.XXXXXX)
[ -n "$RUN_ID" ] || RUN_ID="standalone-${TEMP_ROOT##*.}"
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "release Browser run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "release Browser run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "release Browser run ID is invalid" >&2; exit 1; }

SNAPSHOT="$TEMP_ROOT/source"
PG_ROOTFS="$TEMP_ROOT/postgres-rootfs"
mkdir -m 0755 "$SNAPSHOT" "$PG_ROOTFS"
git_candidate archive --format=tar "$GIT_COMMIT" | /usr/bin/tar -xf - -C "$SNAPSHOT"
[ -d "$SNAPSHOT/chenyida_erp_site" ] || { echo "candidate Browser snapshot is incomplete" >&2; exit 1; }
mkdir -m 0555 "$SNAPSHOT/chenyida_erp_site/node_modules"
chmod -R a-w "$SNAPSHOT"
mkdir -m 0755 "$SNAPSHOT/chenyida_erp_site/.vinext" "$SNAPSHOT/chenyida_erp_site/dist"
chown -R 1000:1000 "$SNAPSHOT/chenyida_erp_site/.vinext" "$SNAPSHOT/chenyida_erp_site/dist"

CURRENT_CONTAINER_NAME="cyd-release-browser-build-$RUN_ID"
CURRENT_CONTAINER_ID=$(/usr/bin/docker create \
  --pull=never --name "$CURRENT_CONTAINER_NAME" --label "chenyida.erp.release-browser-test=$RUN_ID" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 1000:1000 --memory 1024m --memory-swap 1280m --cpus 1 --pids-limit 256 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m \
  --tmpfs /workspace/node_modules/.vite-temp:rw,exec,nosuid,nodev,size=32m \
  -e PATH=/usr/local/bin:/usr/bin:/bin -e HOME=/tmp -e LC_ALL=C -e LANG=C -e TZ=UTC -e TMPDIR=/tmp \
  -e NODE_ENV=production -e NODE_OPTIONS=--max-old-space-size=768 \
  -e ERP_RUNTIME_BUILD_VERSION="$PACKAGE_VERSION" -e ERP_RUNTIME_GIT_COMMIT="$GIT_COMMIT" \
  -v "$SNAPSHOT/chenyida_erp_site:/workspace:rw" -v "$NODE_MODULES:/workspace/node_modules:ro" \
  -w /workspace --entrypoint /bin/sh "$NODE_IMAGE" \
  -c 'set -eu; ./node_modules/.bin/vinext build; node scripts/ensure-vinext-client-assets.mjs')
/usr/bin/docker start --attach "$CURRENT_CONTAINER_ID"
remove_task_container
[ -f "$SNAPSHOT/chenyida_erp_site/dist/standalone/server.js" ] || { echo "release Browser standalone build failed" >&2; exit 1; }
chmod -R a-w "$SNAPSHOT/chenyida_erp_site/.vinext" "$SNAPSHOT/chenyida_erp_site/dist"

CURRENT_CONTAINER_NAME="cyd-release-browser-postgres-export-$RUN_ID"
CURRENT_CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CURRENT_CONTAINER_NAME" --label "chenyida.erp.release-browser-test=$RUN_ID" --network none --read-only "$POSTGRES_IMAGE" /bin/true)
/usr/bin/docker export --output "$TEMP_ROOT/postgres-rootfs.tar" "$CURRENT_CONTAINER_ID"
remove_task_container
/usr/bin/tar -xf "$TEMP_ROOT/postgres-rootfs.tar" -C "$PG_ROOTFS"
rm -f -- "$TEMP_ROOT/postgres-rootfs.tar"
chmod 0755 "$PG_ROOTFS"
mkdir -p "$PG_ROOTFS/dev" "$PG_ROOTFS/var/lib/postgresql/data"
/bin/cp -a -- /dev/null /dev/zero /dev/random /dev/urandom /dev/tty "$PG_ROOTFS/dev/"
chown -R 999:999 "$PG_ROOTFS/var/lib/postgresql/data"
chmod 0700 "$PG_ROOTFS/var/lib/postgresql/data"

CURRENT_CONTAINER_NAME="cyd-release-browser-e2e-$RUN_ID"
CURRENT_CONTAINER_ID=$(/usr/bin/docker create \
  --pull=never --name "$CURRENT_CONTAINER_NAME" --label "chenyida.erp.release-browser-test=$RUN_ID" \
  --network none --read-only --cap-drop ALL --cap-add SYS_CHROOT --cap-add SETUID --cap-add SETGID --security-opt no-new-privileges \
  --memory 1536m --memory-swap 1792m --cpus 1 --pids-limit 384 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=384m \
  --tmpfs /test-tmp:rw,exec,nosuid,nodev,size=512m \
  --tmpfs /dev/shm:rw,nosuid,nodev,noexec,size=512m \
  -e ERP_RELEASE_BROWSER_CONTAINER_MODE=YES \
  -e ERP_RELEASE_BROWSER_PACKAGE_VERSION="$PACKAGE_VERSION" \
  -e ERP_RELEASE_BROWSER_GIT_COMMIT="$GIT_COMMIT" \
  -v "$SNAPSHOT/chenyida_erp_site:/workspace:ro" \
  -v "$NODE_MODULES:/workspace/node_modules:ro" \
  -v "$PG_ROOTFS:/postgres-rootfs:rw" \
  -v "$SUPERVISOR_SITE_ROOT:/supervisor:ro" \
  -w /workspace --entrypoint /bin/sh "$BROWSER_IMAGE" \
  /supervisor/scripts/run-release-browser-tests.sh)
/usr/bin/docker start --attach "$CURRENT_CONTAINER_ID"
remove_task_container

git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "release Browser sandbox changed candidate files" >&2; exit 1; }
echo "RELEASE BROWSER HARNESS PASS files=6 tests=11 playwright=1.51.1 chromium=134.0.6998.35"
