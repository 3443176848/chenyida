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
[ -z "${ERP_RELEASE_GATE_RUN_ID:-}" ] || [ -n "${ERP_RELEASE_TEST_RUNTIME_ROOT:-}" ] || { echo "release test runtime root is required" >&2; exit 1; }
AUTHORIZED_TEST_RUNTIME_ROOT=${ERP_RELEASE_TEST_RUNTIME_ROOT:-$REPOSITORY_ROOT}
TEST_RUNTIME_ROOT=$(readlink -f "$AUTHORIZED_TEST_RUNTIME_ROOT") || { echo "release test runtime root is invalid" >&2; exit 1; }
[ "$TEST_RUNTIME_ROOT" = "$AUTHORIZED_TEST_RUNTIME_ROOT" ] || { echo "release test runtime root is not canonical" >&2; exit 1; }
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
TEMP_ROOT=""

cleanup() {
  [ -n "$TEMP_ROOT" ] || return 0
  case "$TEMP_ROOT" in
    /tmp/chenyida-erp-release-python.*) rm -rf -- "$TEMP_ROOT" ;;
    *) echo "refusing unsafe Python baseline cleanup" >&2; return 1 ;;
  esac
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

[ "$(id -u)" = 0 ] || { echo "release Python sandbox requires root" >&2; exit 1; }
[ -x /usr/bin/bwrap ] || { echo "bubblewrap is unavailable" >&2; exit 1; }
[ -x "$TEST_RUNTIME_ROOT/.venv/bin/python" ] || { echo "project Python runtime is unavailable" >&2; exit 1; }
[ "$#" -eq 1 ] || { echo "usage: $0 supervisor-contracts|self-test|smoke|go-live" >&2; exit 2; }

GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] || { echo "release Python sandbox commit mismatch" >&2; exit 1; }
[ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "release Python sandbox tree mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-release-python.XXXXXX)
mkdir -m 0755 "$TEMP_ROOT/source"
git_candidate archive --format=tar "$GIT_COMMIT" | /usr/bin/tar -xf - -C "$TEMP_ROOT/source"
[ -f "$TEMP_ROOT/source/chenyida_erp_app/server.py" ] || { echo "Python candidate snapshot is incomplete" >&2; exit 1; }

WORKING_DIRECTORY=/workspace/chenyida_erp_app
case "$1" in
  supervisor-contracts)
    WORKING_DIRECTORY=/supervisor
    set -- /usr/bin/python3.11 -B -m unittest discover -s tests -p 'test_release_supervisor_*.py'
    ;;
  self-test)
    set -- /opt/venv/bin/python server.py --self-test
    ;;
  smoke)
    set -- /opt/venv/bin/python smoke_test.py
    ;;
  go-live)
    set -- /opt/venv/bin/python go_live_check.py --no-backup
    ;;
  *)
    echo "usage: $0 supervisor-contracts|self-test|smoke|go-live" >&2
    exit 2
    ;;
esac

/usr/bin/bwrap \
  --die-with-parent --new-session --unshare-all --cap-drop ALL --clearenv \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --tmpfs /state \
  --bind "$TEMP_ROOT/source" /workspace --ro-bind "$SUPERVISOR_SITE_ROOT" /supervisor --ro-bind "$TEST_RUNTIME_ROOT/.venv" /opt/venv \
  --dir /home/release --chdir "$WORKING_DIRECTORY" \
  --setenv PATH /opt/venv/bin:/usr/bin:/bin --setenv HOME /home/release \
  --setenv LC_ALL C --setenv LANG C --setenv TZ UTC --setenv ERP_ENV test \
  --setenv CYD_ERP_DATA_DIR /state --setenv CYD_ERP_DB /state/release-baseline.sqlite3 \
  -- "$@"
