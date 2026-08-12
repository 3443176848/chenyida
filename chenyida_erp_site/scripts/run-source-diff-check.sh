#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL PATH

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")

run_git() {
  /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LC_ALL=C LANG=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 \
    /usr/bin/git -c "safe.directory=$REPOSITORY_ROOT" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.useReplaceRefs=false -c tar.umask=0022 -c pager.branch=false -c pager.diff=false -C "$REPOSITORY_ROOT" "$@"
}

[ "$(run_git rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
GIT_COMMIT=$(run_git rev-parse --verify HEAD^{commit})
GIT_TREE=$(run_git rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] && [ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "release source identity mismatch" >&2; exit 1; }

run_git diff --quiet --no-ext-diff --no-textconv --
run_git diff --cached --quiet --no-ext-diff --no-textconv --
run_git diff --check --no-ext-diff --no-textconv --
[ -z "$(run_git ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files block release" >&2; exit 1; }
[ "$(run_git rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(run_git rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source changed during diff check" >&2; exit 1; }
