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

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "release Compose sandbox requires root" >&2; exit 1; }
[ -x /usr/bin/bwrap ] || { echo "bubblewrap is unavailable" >&2; exit 1; }
DOCKER_COMPOSE_VERSION=$(/usr/bin/docker compose version --short)
DOCKER_ENGINE_VERSION=$(/usr/bin/docker version --format '{{.Server.Version}}')
[ -n "$DOCKER_COMPOSE_VERSION" ] && [ -n "$DOCKER_ENGINE_VERSION" ] || { echo "container runtime version discovery failed" >&2; exit 1; }

GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] && [ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "release Compose snapshot identity mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-release-compose.XXXXXX)
cleanup() {
  case "$TEMP_ROOT" in /tmp/chenyida-erp-release-compose.*) rm -rf -- "$TEMP_ROOT" ;; *) return 1 ;; esac
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
mkdir -m 0755 "$TEMP_ROOT/source"
git_candidate archive --format=tar "$GIT_COMMIT" chenyida_erp_site | /usr/bin/tar -xf - -C "$TEMP_ROOT/source"
[ -f "$TEMP_ROOT/source/chenyida_erp_site/compose.yml" ] && [ -f "$TEMP_ROOT/source/chenyida_erp_site/compose.release.yml" ] || { echo "release Compose snapshot is incomplete" >&2; exit 1; }

/usr/bin/bwrap \
  --die-with-parent --new-session --unshare-all --cap-drop ALL --clearenv --uid 65534 --gid 65534 \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home/release \
  --ro-bind "$TEMP_ROOT/source/chenyida_erp_site" /workspace --ro-bind "$SUPERVISOR_SITE_ROOT" /supervisor --chdir /workspace \
  --setenv PATH /usr/bin:/bin --setenv HOME /home/release --setenv LC_ALL C --setenv LANG C --setenv TZ UTC \
  --setenv COMPOSE_PARALLEL_LIMIT 1 --setenv COMPOSE_DISABLE_ENV_FILE 1 \
  --setenv ERP_ENV production --setenv ERP_DEPLOYMENT_CLASS uat \
  --setenv ERP_RELEASE_EXPECTED_DEPLOYMENT_ID chenyida-erp \
  --setenv ERP_RELEASE_IDENTITY_READER_GID 1000 \
  --setenv ERP_BUILD_VERSION "${ERP_BUILD_VERSION:?ERP_BUILD_VERSION is required}" \
  --setenv ERP_BUILD_REVISION "${ERP_BUILD_REVISION:?ERP_BUILD_REVISION is required}" \
  --setenv ERP_WEB_IMAGE "${ERP_WEB_IMAGE:?ERP_WEB_IMAGE is required}" \
  --setenv ERP_WORKER_IMAGE "${ERP_WORKER_IMAGE:?ERP_WORKER_IMAGE is required}" \
  --setenv ERP_WEB_IMAGE_CONFIG_DIGEST "${ERP_WEB_IMAGE_CONFIG_DIGEST:?ERP_WEB_IMAGE_CONFIG_DIGEST is required}" \
  --setenv ERP_WORKER_IMAGE_CONFIG_DIGEST "${ERP_WORKER_IMAGE_CONFIG_DIGEST:?ERP_WORKER_IMAGE_CONFIG_DIGEST is required}" \
  --setenv ERP_CONTAINER_RUNTIME_COMPOSE_VERSION "$DOCKER_COMPOSE_VERSION" \
  --setenv ERP_CONTAINER_RUNTIME_ENGINE_VERSION "$DOCKER_ENGINE_VERSION" \
  -- /bin/sh -c '
    set -eu
    set -f
    for deployment_class in uat production; do
      ERP_DEPLOYMENT_CLASS=$deployment_class /usr/bin/docker compose --env-file /dev/null --profile "*" -f compose.yml -f compose.release.yml config --format json |
        /usr/bin/python3.11 -B /supervisor/scripts/container-runtime-policy.py validate \
          --policy /supervisor/operations/container-runtime-policy-v1.json \
          --project-root /workspace \
          --compose-version "$ERP_CONTAINER_RUNTIME_COMPOSE_VERSION" \
          --engine-version "$ERP_CONTAINER_RUNTIME_ENGINE_VERSION" \
          --web-image "$ERP_WEB_IMAGE" \
          --worker-image "$ERP_WORKER_IMAGE" \
          --web-config-digest "$ERP_WEB_IMAGE_CONFIG_DIGEST" \
          --worker-config-digest "$ERP_WORKER_IMAGE_CONFIG_DIGEST" \
          --reader-gid "$ERP_RELEASE_IDENTITY_READER_GID"
    done
  '
