#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --identity-root DIR --reader-gid GID --deployment-class TEST|UAT|PRODUCTION --deployment-id ID --application-version VERSION --git-commit SHA --web-container NAME --worker-container NAME --confirm PUBLISH_RUNTIME_RELEASE_IDENTITY" >&2
  exit 2
}

IDENTITY_ROOT=""; READER_GID=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""; APPLICATION_VERSION=""; GIT_COMMIT=""
WEB_CONTAINER=""; WORKER_CONTAINER=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --identity-root) IDENTITY_ROOT=${2:-}; shift 2 ;;
    --reader-gid) READER_GID=${2:-}; shift 2 ;;
    --deployment-class) DEPLOYMENT_CLASS=${2:-}; shift 2 ;;
    --deployment-id) DEPLOYMENT_ID=${2:-}; shift 2 ;;
    --application-version) APPLICATION_VERSION=${2:-}; shift 2 ;;
    --git-commit) GIT_COMMIT=${2:-}; shift 2 ;;
    --web-container) WEB_CONTAINER=${2:-}; shift 2 ;;
    --worker-container) WORKER_CONTAINER=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

for value in "$IDENTITY_ROOT" "$READER_GID" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$APPLICATION_VERSION" "$GIT_COMMIT" "$WEB_CONTAINER" "$WORKER_CONTAINER" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$(id -u)" = 0 ] || { echo "runtime release identity publication requires root" >&2; exit 1; }
[ "$CONFIRM" = PUBLISH_RUNTIME_RELEASE_IDENTITY ] || { echo "runtime release identity confirmation is invalid" >&2; exit 1; }
case "$IDENTITY_ROOT" in /*) : ;; *) echo "identity root must be absolute" >&2; exit 1 ;; esac
case "$READER_GID" in *[!0-9]*|'') echo "reader gid is invalid" >&2; exit 1 ;; esac
DEPLOYMENT_CLASS=$(printf '%s' "$DEPLOYMENT_CLASS" | tr '[:lower:]' '[:upper:]')
case "$DEPLOYMENT_CLASS" in TEST|UAT|PRODUCTION) : ;; *) echo "deployment class is invalid" >&2; exit 1 ;; esac
for value in "$DEPLOYMENT_ID" "$WEB_CONTAINER" "$WORKER_CONTAINER"; do case "$value" in ''|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) echo "deployment or container identifier is invalid" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "deployment or container identifier is too long" >&2; exit 1; }; done
[ "$WEB_CONTAINER" != "$WORKER_CONTAINER" ] || { echo "Web and Worker containers must be distinct" >&2; exit 1; }
case "$APPLICATION_VERSION" in 0.1.0-alpha.*) version_number=${APPLICATION_VERSION#0.1.0-alpha.} ;; *) echo "application version is invalid" >&2; exit 1 ;; esac
case "$version_number" in ''|*[!0-9]*) echo "application version is invalid" >&2; exit 1 ;; esac
case "$GIT_COMMIT" in *[!0-9a-f]*|'') echo "Git revision is invalid" >&2; exit 1 ;; esac
[ "${#GIT_COMMIT}" -eq 40 ] || { echo "Git revision is invalid" >&2; exit 1; }

environment_value() {
  key=$1; source=$2
  printf '%s\n' "$source" | awk -F= -v expected="$key" '$1==expected { sub(/^[^=]*=/, ""); print }'
}

inspect_runtime_container() {
  name=$1; expected_service=$2
  snapshot=$(docker inspect --format '{{.Id}}|{{.State.Running}}|{{.State.Restarting}}|{{.State.Paused}}|{{.State.Dead}}|{{.State.OOMKilled}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$name" 2>/dev/null) || { echo "runtime container inspection failed" >&2; exit 1; }
  old_ifs=$IFS; IFS='|'; set -- $snapshot; IFS=$old_ifs
  [ "$#" -eq 11 ] && [ "$2" = true ] && [ "$3" = false ] && [ "$4" = false ] && [ "$5" = false ] && [ "$6" = false ] \
    && [ "$8" = "$DEPLOYMENT_ID" ] && [ "$9" = "$expected_service" ] && [ "${10}" = "$APPLICATION_VERSION" ] && [ "${11}" = "$GIT_COMMIT" ] \
    || { echo "runtime container state, Compose identity, or OCI release labels are invalid" >&2; exit 1; }
  container_id=$1; image_digest=$7
  case "$container_id" in *[!0-9a-f]*|'') echo "runtime container ID is invalid" >&2; exit 1 ;; esac
  [ "${#container_id}" -eq 64 ] || { echo "runtime container ID is invalid" >&2; exit 1; }
  case "$image_digest" in sha256:*) image_hex=${image_digest#sha256:} ;; *) echo "runtime image digest is invalid" >&2; exit 1 ;; esac
  case "$image_hex" in *[!0-9a-f]*|'') echo "runtime image digest is invalid" >&2; exit 1 ;; esac
  [ "${#image_hex}" -eq 64 ] || { echo "runtime image digest is invalid" >&2; exit 1; }

  container_environment=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" 2>/dev/null) || { echo "runtime container environment inspection failed" >&2; exit 1; }
  actual_class=$(environment_value ERP_DEPLOYMENT_CLASS "$container_environment")
  actual_version=$(environment_value ERP_RUNTIME_BUILD_VERSION "$container_environment")
  actual_git=$(environment_value ERP_RUNTIME_GIT_COMMIT "$container_environment")
  for actual in "$actual_class" "$actual_version" "$actual_git"; do [ "$(printf '%s\n' "$actual" | awk 'NF{count+=1} END{print count+0}')" -eq 1 ] || { echo "runtime container release environment is missing or duplicated" >&2; exit 1; }; done
  [ "$(printf '%s' "$actual_class" | tr '[:lower:]' '[:upper:]')" = "$DEPLOYMENT_CLASS" ] && [ "$actual_version" = "$APPLICATION_VERSION" ] && [ "$actual_git" = "$GIT_COMMIT" ] || { echo "runtime container release environment mismatch" >&2; exit 1; }

  inventory=$(docker ps -a --no-trunc --filter "label=com.docker.compose.project=$DEPLOYMENT_ID" --filter "label=com.docker.compose.service=$expected_service" --format '{{.ID}}') || { echo "runtime Compose inventory cannot be verified" >&2; exit 1; }
  [ "$inventory" = "$container_id" ] || { echo "runtime Compose inventory is not exactly the inspected container" >&2; exit 1; }
  printf '%s|%s\n' "$container_id" "$image_digest"
}

WEB_RUNTIME=$(inspect_runtime_container "$WEB_CONTAINER" web)
WORKER_RUNTIME=$(inspect_runtime_container "$WORKER_CONTAINER" worker)
WEB_CONTAINER_ID=${WEB_RUNTIME%%|*}; WEB_IMAGE_DIGEST=${WEB_RUNTIME#*|}
WORKER_CONTAINER_ID=${WORKER_RUNTIME%%|*}; WORKER_IMAGE_DIGEST=${WORKER_RUNTIME#*|}
[ "$WEB_CONTAINER_ID" != "$WORKER_CONTAINER_ID" ] || { echo "Web and Worker container identities collide" >&2; exit 1; }

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
node "$SCRIPT_DIR/release-identity-contract.mjs" publish \
  --root "$IDENTITY_ROOT" --reader-gid "$READER_GID" --deployment-class "$DEPLOYMENT_CLASS" --deployment-id "$DEPLOYMENT_ID" \
  --application-version "$APPLICATION_VERSION" --git-commit "$GIT_COMMIT" \
  --web-container-id "$WEB_CONTAINER_ID" --web-image-digest "$WEB_IMAGE_DIGEST" \
  --worker-container-id "$WORKER_CONTAINER_ID" --worker-image-digest "$WORKER_IMAGE_DIGEST" \
  --confirm PUBLISH_RUNTIME_RELEASE_IDENTITY >/dev/null
echo "runtime release identity published for $DEPLOYMENT_CLASS/$DEPLOYMENT_ID"
