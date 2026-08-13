#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/nonexistent
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_NO_REPLACE_OBJECTS=1
COMPOSE_PARALLEL_LIMIT=1
export LC_ALL PATH HOME GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_NO_REPLACE_OBJECTS COMPOSE_PARALLEL_LIMIT

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
PROJECT_ROOT="$REPOSITORY_ROOT/chenyida_erp_site"
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }

[ "$(id -u)" = 0 ] || { echo "container runtime policy test requires root" >&2; exit 1; }
[ -S /var/run/docker.sock ] || { echo "Docker socket is unavailable" >&2; exit 1; }
[ -x /usr/bin/python3.11 ] || { echo "Python 3.11 runtime is unavailable" >&2; exit 1; }
[ -f "$SUPERVISOR_SITE_ROOT/operations/container-runtime-policy-v1.json" ] || { echo "container runtime policy is unavailable" >&2; exit 1; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] && [ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "container runtime policy snapshot identity mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --

exec /usr/bin/python3.11 -B "$SCRIPT_DIR/container-runtime-policy-test.py" \
  --policy "$SUPERVISOR_SITE_ROOT/operations/container-runtime-policy-v1.json" \
  --project-root "$PROJECT_ROOT" \
  --web-image "${ERP_WEB_IMAGE:?ERP_WEB_IMAGE is required}" \
  --worker-image "${ERP_WORKER_IMAGE:?ERP_WORKER_IMAGE is required}" \
  --web-config-digest "${ERP_WEB_IMAGE_CONFIG_DIGEST:?ERP_WEB_IMAGE_CONFIG_DIGEST is required}" \
  --worker-config-digest "${ERP_WORKER_IMAGE_CONFIG_DIGEST:?ERP_WORKER_IMAGE_CONFIG_DIGEST is required}" \
  --reader-gid "${ERP_RELEASE_IDENTITY_READER_GID:?ERP_RELEASE_IDENTITY_READER_GID is required}"
