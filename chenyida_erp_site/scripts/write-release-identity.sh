#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

usage() {
  echo "usage: $0 --release-manifest FILE --release-manifest-sha256 SHA256 --identity-root DIR --reader-gid GID --deployment-class UAT|PRODUCTION --deployment-id ID --web-container NAME --worker-container NAME --confirm PUBLISH_EXACT_RELEASE_MANIFEST_IDENTITY" >&2
  exit 2
}

RELEASE_MANIFEST=""; RELEASE_MANIFEST_SHA256=""; IDENTITY_ROOT=""; READER_GID=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""
WEB_CONTAINER=""; WORKER_CONTAINER=""; CONFIRM=""
PUBLISHER_ID=""; PUBLISHER_NAME=""; PUBLISHER_LABEL=""

remove_publisher() {
  if [ -z "$PUBLISHER_ID" ] && [ -n "$PUBLISHER_NAME" ]; then PUBLISHER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$PUBLISHER_NAME" 2>/dev/null || true); fi
  [ -n "$PUBLISHER_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-identity-publisher"}}|{{.Name}}' "$PUBLISHER_ID" 2>/dev/null || true)" = "$PUBLISHER_LABEL|/$PUBLISHER_NAME" ] || { echo "refusing to remove an unowned identity publisher container" >&2; return 1; }
  /usr/bin/docker rm -f "$PUBLISHER_ID" >/dev/null
  PUBLISHER_ID=""
}

cleanup() {
  remove_publisher >/dev/null 2>&1 || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
while [ "$#" -gt 0 ]; do
  case "$1" in
    --identity-root) IDENTITY_ROOT=${2:-}; shift 2 ;;
    --release-manifest) RELEASE_MANIFEST=${2:-}; shift 2 ;;
    --release-manifest-sha256) RELEASE_MANIFEST_SHA256=${2:-}; shift 2 ;;
    --reader-gid) READER_GID=${2:-}; shift 2 ;;
    --deployment-class) DEPLOYMENT_CLASS=${2:-}; shift 2 ;;
    --deployment-id) DEPLOYMENT_ID=${2:-}; shift 2 ;;
    --web-container) WEB_CONTAINER=${2:-}; shift 2 ;;
    --worker-container) WORKER_CONTAINER=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

for value in "$RELEASE_MANIFEST" "$RELEASE_MANIFEST_SHA256" "$IDENTITY_ROOT" "$READER_GID" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$WEB_CONTAINER" "$WORKER_CONTAINER" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$(id -u)" = 0 ] || { echo "runtime release identity publication requires root" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "runtime release identity must be launched by the installed supervisor" >&2; exit 1; }
[ "$CONFIRM" = PUBLISH_EXACT_RELEASE_MANIFEST_IDENTITY ] || { echo "runtime release identity confirmation is invalid" >&2; exit 1; }
case "$RELEASE_MANIFEST" in /*) : ;; *) echo "release manifest path must be absolute" >&2; exit 1 ;; esac
case "$RELEASE_MANIFEST_SHA256" in *[!0-9a-f]*|'') echo "release manifest digest is invalid" >&2; exit 1 ;; esac
[ "${#RELEASE_MANIFEST_SHA256}" -eq 64 ] || { echo "release manifest digest is invalid" >&2; exit 1; }
case "$IDENTITY_ROOT" in /*) : ;; *) echo "identity root must be absolute" >&2; exit 1 ;; esac
[ -d "$IDENTITY_ROOT" ] && [ ! -L "$IDENTITY_ROOT" ] || { echo "identity root must already be a real directory" >&2; exit 1; }
case "$READER_GID" in *[!0-9]*|'') echo "reader gid is invalid" >&2; exit 1 ;; esac
DEPLOYMENT_CLASS=$(printf '%s' "$DEPLOYMENT_CLASS" | tr '[:lower:]' '[:upper:]')
case "$DEPLOYMENT_CLASS" in UAT|PRODUCTION) : ;; *) echo "deployment class is invalid" >&2; exit 1 ;; esac
for value in "$DEPLOYMENT_ID" "$WEB_CONTAINER" "$WORKER_CONTAINER"; do case "$value" in ''|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) echo "deployment or container identifier is invalid" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "deployment or container identifier is too long" >&2; exit 1; }; done
[ "$WEB_CONTAINER" != "$WORKER_CONTAINER" ] || { echo "Web and Worker containers must be distinct" >&2; exit 1; }

environment_value() {
  key=$1; source=$2
  printf '%s\n' "$source" | awk -F= -v expected="$key" '$1==expected { sub(/^[^=]*=/, ""); print }'
}

inspect_runtime_container() {
  name=$1; expected_service=$2
  snapshot=$(/usr/bin/docker inspect --format '{{.Id}}|{{.State.Running}}|{{.State.Restarting}}|{{.State.Paused}}|{{.State.Dead}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Image}}|{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$name" 2>/dev/null) || { echo "runtime container inspection failed" >&2; exit 1; }
  old_ifs=$IFS; IFS='|'; set -- $snapshot; IFS=$old_ifs
  expected_health=none; [ "$expected_service" = web ] && expected_health=healthy
  [ "$#" -eq 14 ] && [ "$2" = true ] && [ "$3" = false ] && [ "$4" = false ] && [ "$5" = false ] && [ "$6" = false ] && [ "$7" = 0 ] && [ "$8" = "$expected_health" ] \
    && [ "${11}" = "$DEPLOYMENT_ID" ] && [ "${12}" = "$expected_service" ] \
    || { echo "runtime container state, Compose identity, or OCI release labels are invalid" >&2; exit 1; }
  container_id=$1; image_digest=$9; image_reference=${10}
  case "$container_id" in *[!0-9a-f]*|'') echo "runtime container ID is invalid" >&2; exit 1 ;; esac
  [ "${#container_id}" -eq 64 ] || { echo "runtime container ID is invalid" >&2; exit 1; }
  case "$image_digest" in sha256:*) image_hex=${image_digest#sha256:} ;; *) echo "runtime image digest is invalid" >&2; exit 1 ;; esac
  case "$image_hex" in *[!0-9a-f]*|'') echo "runtime image digest is invalid" >&2; exit 1 ;; esac
  [ "${#image_hex}" -eq 64 ] || { echo "runtime image digest is invalid" >&2; exit 1; }
  case "$image_reference" in *@sha256:*) reference_hex=${image_reference##*@sha256:} ;; *) echo "runtime image reference is not digest pinned" >&2; exit 1 ;; esac
  case "$reference_hex" in *[!0-9a-f]*|'') echo "runtime image reference is invalid" >&2; exit 1 ;; esac
  [ "${#reference_hex}" -eq 64 ] || { echo "runtime image reference is invalid" >&2; exit 1; }
  [ "$(/usr/bin/docker image inspect --format '{{.Id}}|{{.Os}}/{{.Architecture}}' -- "$image_reference" 2>/dev/null)" = "$image_digest|linux/amd64" ] || { echo "runtime image config digest or platform mismatch" >&2; exit 1; }
  /usr/bin/docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' -- "$image_reference" 2>/dev/null | grep -Fqx -- "$image_reference" || { echo "runtime image repository digest is missing" >&2; exit 1; }

  container_environment=$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" 2>/dev/null) || { echo "runtime container environment inspection failed" >&2; exit 1; }
  actual_class=$(environment_value ERP_DEPLOYMENT_CLASS "$container_environment")
  actual_version=$(environment_value ERP_RUNTIME_BUILD_VERSION "$container_environment")
  actual_git=$(environment_value ERP_RUNTIME_GIT_COMMIT "$container_environment")
  for actual in "$actual_class" "$actual_version" "$actual_git"; do [ "$(printf '%s\n' "$actual" | awk 'NF{count+=1} END{print count+0}')" -eq 1 ] || { echo "runtime container release environment is missing or duplicated" >&2; exit 1; }; done
  actual_class=$(printf '%s' "$actual_class" | tr '[:lower:]' '[:upper:]')
  [ "$actual_class" = "$DEPLOYMENT_CLASS" ] || { echo "runtime container deployment class mismatch" >&2; exit 1; }

  inventory=$(/usr/bin/docker ps -a --no-trunc --filter "label=com.docker.compose.project=$DEPLOYMENT_ID" --filter "label=com.docker.compose.service=$expected_service" --format '{{.ID}}') || { echo "runtime Compose inventory cannot be verified" >&2; exit 1; }
  [ "$inventory" = "$container_id" ] || { echo "runtime Compose inventory is not exactly the inspected container" >&2; exit 1; }
  printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "$container_id" "$image_digest" "$image_reference" "${13}" "${14}" "$actual_version" "$actual_git" "$actual_class"
}

LOCK_FILE=/var/lock/chenyida-erp-release-gate-v1.lock
if [ ! -e "$LOCK_FILE" ]; then (umask 077; set -C; : > "$LOCK_FILE"); fi
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] && [ "$(stat -c '%u:%g:%a:%h' "$LOCK_FILE")" = "0:0:600:1" ] || { echo "release operation lock is untrusted" >&2; exit 1; }
exec 9<>"$LOCK_FILE"
flock -n 9 || { echo "another release or deployment operation is active" >&2; exit 1; }

WEB_RUNTIME=$(inspect_runtime_container "$WEB_CONTAINER" web)
WORKER_RUNTIME=$(inspect_runtime_container "$WORKER_CONTAINER" worker)
old_ifs=$IFS; IFS='|'; set -- $WEB_RUNTIME; IFS=$old_ifs; [ "$#" -eq 8 ] || { echo "Web runtime evidence is incomplete" >&2; exit 1; }
WEB_CONTAINER_ID=$1; WEB_IMAGE_DIGEST=$2; WEB_IMAGE_REFERENCE=$3; WEB_OCI_VERSION=$4; WEB_OCI_REVISION=$5; WEB_BAKED_VERSION=$6; WEB_BAKED_REVISION=$7; WEB_CLASS=$8
old_ifs=$IFS; IFS='|'; set -- $WORKER_RUNTIME; IFS=$old_ifs; [ "$#" -eq 8 ] || { echo "Worker runtime evidence is incomplete" >&2; exit 1; }
WORKER_CONTAINER_ID=$1; WORKER_IMAGE_DIGEST=$2; WORKER_IMAGE_REFERENCE=$3; WORKER_OCI_VERSION=$4; WORKER_OCI_REVISION=$5; WORKER_BAKED_VERSION=$6; WORKER_BAKED_REVISION=$7; WORKER_CLASS=$8
[ "$WEB_CONTAINER_ID" != "$WORKER_CONTAINER_ID" ] || { echo "Web and Worker container identities collide" >&2; exit 1; }

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor site root mismatch" >&2; exit 1; }
BUNDLE_ROOT=$(CDPATH= cd -- "$SUPERVISOR_SITE_ROOT/.." && pwd -P)
SUPERVISOR_BUNDLE_SHA256=${ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256:-}
AUTHORIZATION_SHA256=${ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256:-}
for digest in "$SUPERVISOR_BUNDLE_SHA256" "$AUTHORIZATION_SHA256"; do case "$digest" in *[!0-9a-f]*|'') echo "release supervisor digest is invalid" >&2; exit 1 ;; esac; [ "${#digest}" -eq 64 ] || { echo "release supervisor digest is invalid" >&2; exit 1; }; done
PUBLISHER_NAME="cyd-release-identity-$DEPLOYMENT_ID-$$"
PUBLISHER_LABEL=$AUTHORIZATION_SHA256
[ "$(basename "$BUNDLE_ROOT")" = "$SUPERVISOR_BUNDLE_SHA256" ] || { echo "release supervisor bundle path is invalid" >&2; exit 1; }
case "$BUNDLE_ROOT" in /usr/local/libexec/chenyida-erp-release-supervisor/bundles/*) : ;; *) echo "release supervisor is not installed in the trusted root" >&2; exit 1 ;; esac
ARTIFACT_ROOT=$(CDPATH= cd -- "$(dirname -- "$RELEASE_MANIFEST")" && pwd -P)
[ "$RELEASE_MANIFEST" = "$ARTIFACT_ROOT/release-manifest.json" ] || { echo "release manifest must be the canonical artifact-root file" >&2; exit 1; }
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned identity publisher image is unavailable; pulling is forbidden" >&2; exit 1; }
run_publisher() {
  PUBLISHER_ID=$(/usr/bin/docker create --pull=never --name "$PUBLISHER_NAME" --label "chenyida.erp.release-identity-publisher=$PUBLISHER_LABEL" \
    --network none --read-only --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges --user 0:0 \
    --memory 256m --memory-swap 320m --cpus 0.5 --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
    -e PATH=/usr/local/bin:/usr/bin:/bin -e HOME=/tmp -e LC_ALL=C -e LANG=C -e TZ=UTC -e ERP_RELEASE_GATE_LOCK_HELD=YES \
    --mount "type=bind,src=$SCRIPT_DIR,dst=/release-scripts,readonly" \
    --mount "type=bind,src=$ARTIFACT_ROOT,dst=/release-artifacts,readonly" \
    --mount "type=bind,src=$IDENTITY_ROOT,dst=/release-identity" \
    "$NODE_IMAGE" node /release-scripts/publish-release-identity-from-manifest.mjs "$@")
  /usr/bin/docker start --attach "$PUBLISHER_ID"
  remove_publisher
}

PREPARE_OUTPUT=$(run_publisher prepare \
  --manifest /release-artifacts/release-manifest.json --manifest-sha256 "$RELEASE_MANIFEST_SHA256" --identity-root /release-identity --reader-gid "$READER_GID" --deployment-class "$DEPLOYMENT_CLASS" --deployment-id "$DEPLOYMENT_ID" \
  --supervisor-bundle-sha256 "$SUPERVISOR_BUNDLE_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" --transaction-id "$AUTHORIZATION_SHA256" \
  --web-container-id "$WEB_CONTAINER_ID" --web-image-reference "$WEB_IMAGE_REFERENCE" --web-image-digest "$WEB_IMAGE_DIGEST" --web-oci-version "$WEB_OCI_VERSION" --web-oci-revision "$WEB_OCI_REVISION" --web-baked-version "$WEB_BAKED_VERSION" --web-baked-revision "$WEB_BAKED_REVISION" --web-deployment-class "$WEB_CLASS" \
  --worker-container-id "$WORKER_CONTAINER_ID" --worker-image-reference "$WORKER_IMAGE_REFERENCE" --worker-image-digest "$WORKER_IMAGE_DIGEST" --worker-oci-version "$WORKER_OCI_VERSION" --worker-oci-revision "$WORKER_OCI_REVISION" --worker-baked-version "$WORKER_BAKED_VERSION" --worker-baked-revision "$WORKER_BAKED_REVISION" --worker-deployment-class "$WORKER_CLASS" \
  --confirm PREPARE_EXACT_RELEASE_MANIFEST_IDENTITY)
case "$PREPARE_OUTPUT" in
  *'"result":"ALREADY_PUBLISHED"'*)
    [ "$(inspect_runtime_container "$WEB_CONTAINER" web)" = "$WEB_RUNTIME" ] && [ "$(inspect_runtime_container "$WORKER_CONTAINER" worker)" = "$WORKER_RUNTIME" ] || { echo "runtime containers changed while confirming existing release identity" >&2; exit 1; }
    echo "runtime release identity already published for $DEPLOYMENT_CLASS/$DEPLOYMENT_ID"
    exit 0
    ;;
  *'"result":"PREPARED"'*) : ;;
  *) echo "runtime release identity prepare response is invalid" >&2; exit 1 ;;
esac
if [ "$(inspect_runtime_container "$WEB_CONTAINER" web)" != "$WEB_RUNTIME" ] || [ "$(inspect_runtime_container "$WORKER_CONTAINER" worker)" != "$WORKER_RUNTIME" ]; then
  if ! run_publisher abort --identity-root /release-identity --reader-gid "$READER_GID" --transaction-id "$AUTHORIZATION_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" --confirm ABORT_EXACT_PREPARED_RELEASE_IDENTITY >/dev/null; then
    echo "runtime release identity abort failed after container drift" >&2
    exit 1
  fi
  echo "runtime containers changed before release identity commit" >&2
  exit 1
fi
run_publisher commit --identity-root /release-identity --reader-gid "$READER_GID" --transaction-id "$AUTHORIZATION_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" --confirm COMMIT_EXACT_PREPARED_RELEASE_IDENTITY >/dev/null
echo "runtime release identity published for $DEPLOYMENT_CLASS/$DEPLOYMENT_ID"
