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

SUPERVISOR_SITE_ROOT=$(readlink -f "$(dirname "$0")/..")
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-$SUPERVISOR_SITE_ROOT}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor root mismatch" >&2; exit 1; }
REPOSITORY_ROOT=${ERP_RELEASE_REPOSITORY_ROOT:-$(readlink -f "$SUPERVISOR_SITE_ROOT/..")}
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
NODE_MODULES="$REPOSITORY_ROOT/chenyida_erp_site/node_modules"
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
POSTGRES_IMAGE='postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394'
TEMP_ROOT=$(mktemp -d /tmp/cyd-backup-v2-runtime.XXXXXX)
RUN_ID=${TEMP_ROOT##*.}
TASK_LABEL="chenyida.erp.backup-recovery-test=$RUN_ID"
NODE_CONTAINER="cyd-backup-v2-node-$RUN_ID"
POSTGRES_CONTAINER="cyd-backup-v2-postgres-$RUN_ID"
NODE_ID=""
POSTGRES_ID=""

remove_task_container() {
  container_id=$1; container_name=$2
  if [ -z "$container_id" ]; then container_id=$(/usr/bin/docker inspect --format '{{.Id}}' "$container_name" 2>/dev/null || true); fi
  [ -n "$container_id" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.backup-recovery-test"}}|{{.Name}}' "$container_id" 2>/dev/null || true)" = "$RUN_ID|/$container_name" ] || { echo "refusing to remove a container not created by this test" >&2; return 1; }
  /usr/bin/docker rm -f "$container_id" >/dev/null
}

cleanup() {
  status=0
  remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || status=1
  remove_task_container "$NODE_ID" "$NODE_CONTAINER" >/dev/null 2>&1 || status=1
  case "$TEMP_ROOT" in /tmp/cyd-backup-v2-runtime.*) rm -rf -- "$TEMP_ROOT" || status=1 ;; *) echo "refusing unsafe runtime cleanup" >&2; status=1 ;; esac
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

[ -d "$NODE_MODULES" ] && [ ! -L "$NODE_MODULES" ] || { echo "approved Node dependencies are unavailable" >&2; exit 1; }
GIT_COMMIT=$(git_candidate rev-parse --verify HEAD^{commit})
GIT_TREE=$(git_candidate rev-parse --verify HEAD^{tree})
[ "${ERP_RELEASE_GATE_GIT_COMMIT:-$GIT_COMMIT}" = "$GIT_COMMIT" ] && [ "${ERP_RELEASE_GATE_GIT_TREE:-$GIT_TREE}" = "$GIT_TREE" ] || { echo "backup recovery snapshot identity mismatch" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files block backup recovery test" >&2; exit 1; }
mkdir -m 0755 "$TEMP_ROOT/source"
git_candidate archive --format=tar "$GIT_COMMIT" chenyida_erp_site | /usr/bin/tar -xf - -C "$TEMP_ROOT/source"
SITE_ROOT="$TEMP_ROOT/source/chenyida_erp_site"
[ -f "$SITE_ROOT/tests/selfhost-backup-recovery-postgres.sh" ] || { echo "backup recovery snapshot is incomplete" >&2; exit 1; }
[ -f "$SITE_ROOT/tests/selfhost-postgresql-cluster-recovery-postgres.sh" ] || { echo "PostgreSQL cluster recovery snapshot is incomplete" >&2; exit 1; }
mkdir -m 0555 "$SITE_ROOT/node_modules"

/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null
/usr/bin/docker image inspect "$POSTGRES_IMAGE" >/dev/null
NODE_ID=$(/usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$NODE_CONTAINER" --network none --read-only --cap-drop ALL --security-opt no-new-privileges "$NODE_IMAGE" true)
/usr/bin/docker cp "$NODE_ID:/usr/local/bin/node" "$TEMP_ROOT/node"
remove_task_container "$NODE_ID" "$NODE_CONTAINER"; NODE_ID=""
chmod 0755 "$TEMP_ROOT/node"

POSTGRES_ID=$(/usr/bin/docker create --pull=never --label "$TASK_LABEL" --name "$POSTGRES_CONTAINER" \
  --network none --read-only --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges --memory 768m --memory-swap 1g --cpus 1.0 --pids-limit 256 \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=1280m \
  -e NODE_OPTIONS=--max-old-space-size=384 \
  -v "$SITE_ROOT:/workspace:ro" -v "$NODE_MODULES:/workspace/node_modules:ro" -v "$TEMP_ROOT/node:/usr/local/bin/node:ro" \
  --entrypoint /bin/sh "$POSTGRES_IMAGE" -c 'set -eu; /workspace/tests/selfhost-backup-recovery-postgres.sh; /workspace/tests/selfhost-postgresql-cluster-recovery-postgres.sh')
/usr/bin/docker start --attach "$POSTGRES_ID"
remove_task_container "$POSTGRES_ID" "$POSTGRES_CONTAINER"; POSTGRES_ID=""
