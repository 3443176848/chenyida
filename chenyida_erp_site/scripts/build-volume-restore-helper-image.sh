#!/bin/sh
set -eu
set -f
umask 077
LC_ALL=C
LANG=C
TZ=UTC
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/nonexistent
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_NO_REPLACE_OBJECTS=1
export LC_ALL LANG TZ PATH HOME GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_NO_REPLACE_OBJECTS

BASE_IMAGE='cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed'
REGISTRY_IMAGE='registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373'
TRIVY_IMAGE='ghcr.io/aquasecurity/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c'
DOCKERFILE_FRONTEND='docker.io/docker/dockerfile:1.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720'
HELPER_CONTRACT_SHA256='143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d'
PROTECTED_COMPOSE_PROJECT='chenyida-erp'

usage() {
  echo "usage: $0 --repository-root DIR --git-commit COMMIT --git-tree TREE --manifest-commit COMMIT --manifest-tree TREE --artifact-root DIR --run-id ID --trivy-db-directory DIR --confirm BUILD_AND_SCAN_EXACT_VOLUME_RESTORE_HELPER" >&2
  exit 2
}

REPOSITORY_ROOT=""; GIT_COMMIT=""; GIT_TREE=""; MANIFEST_COMMIT=""; MANIFEST_TREE=""
ARTIFACT_ROOT=""; RUN_ID=""
TRIVY_DB_DIRECTORY=""; CONFIRM=""; TEMP_ROOT=""; CONTAINER_ID=""; CONTAINER_NAME=""
LOCAL_TAG=""; REGISTRY_TAG=""; IMAGE_REFERENCE=""; SUCCESS=NO
OWN_LOCAL=NO; OWN_REGISTRY_TAG=NO; OWN_DIGEST=NO
RESOURCE_GATE_STATE=""; PENDING_AFTER_PHASE=""

remove_container() {
  if [ -z "$CONTAINER_ID" ] && [ -n "$CONTAINER_NAME" ]; then
    CONTAINER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$CONTAINER_NAME" 2>/dev/null || true)
  fi
  [ -n "$CONTAINER_ID" ] || return 0
  observed=$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.volume-helper-evidence"}}|{{index .Config.Labels "chenyida.erp.release-authorization"}}|{{.Name}}' "$CONTAINER_ID" 2>/dev/null || true)
  [ "$observed" = "$RUN_ID|$AUTHORIZATION_SHA256|/$CONTAINER_NAME" ] || {
    echo "refusing to remove a container not owned by this helper evidence run" >&2
    return 1
  }
  /usr/bin/docker rm -f -- "$CONTAINER_ID" >/dev/null
  CONTAINER_ID=""
}

remove_failed_images() {
  [ "$SUCCESS" = NO ] || return 0
  status=0
  if [ "$OWN_DIGEST" = YES ]; then /usr/bin/docker image rm -- "$IMAGE_REFERENCE" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_REGISTRY_TAG" = YES ]; then /usr/bin/docker image rm -- "$REGISTRY_TAG" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_LOCAL" = YES ]; then /usr/bin/docker image rm -- "$LOCAL_TAG" >/dev/null 2>&1 || status=1; fi
  return "$status"
}

cleanup() {
  status=0
  remove_container >/dev/null 2>&1 || status=1
  remove_failed_images || status=1
  if [ -n "$TEMP_ROOT" ]; then
    case "$TEMP_ROOT" in
      /tmp/chenyida-erp-volume-helper-evidence.*) rm -rf -- "$TEMP_ROOT" || status=1 ;;
      *) status=1 ;;
    esac
  fi
  [ "$status" = 0 ] || exit 1
}
on_signal() {
  signal_status=$1
  trap - HUP INT TERM
  if [ -n "$PENDING_AFTER_PHASE" ]; then
    complete_pending_resource_gate || true
  fi
  trap - EXIT
  cleanup
  exit "$signal_status"
}
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-root) REPOSITORY_ROOT=${2:-}; shift 2 ;;
    --git-commit) GIT_COMMIT=${2:-}; shift 2 ;;
    --git-tree) GIT_TREE=${2:-}; shift 2 ;;
    --manifest-commit) MANIFEST_COMMIT=${2:-}; shift 2 ;;
    --manifest-tree) MANIFEST_TREE=${2:-}; shift 2 ;;
    --artifact-root) ARTIFACT_ROOT=${2:-}; shift 2 ;;
    --run-id) RUN_ID=${2:-}; shift 2 ;;
    --trivy-db-directory) TRIVY_DB_DIRECTORY=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
for value in "$REPOSITORY_ROOT" "$GIT_COMMIT" "$GIT_TREE" "$MANIFEST_COMMIT" "$MANIFEST_TREE" "$ARTIFACT_ROOT" "$RUN_ID" "$TRIVY_DB_DIRECTORY" "$CONFIRM"; do
  [ -n "$value" ] || usage
done
[ "$(id -u)" = 0 ] || { echo "volume helper image build requires root" >&2; exit 1; }
[ "$CONFIRM" = BUILD_AND_SCAN_EXACT_VOLUME_RESTORE_HELPER ] || { echo "volume helper image build confirmation is invalid" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "volume helper image build must be launched by the installed supervisor" >&2; exit 1; }
[ "${ERP_RELEASE_GATE_LOCK_HELD:-}" = YES ] || { echo "volume helper image build requires the inherited global release lock" >&2; exit 1; }
case "$GIT_COMMIT$GIT_TREE$MANIFEST_COMMIT$MANIFEST_TREE" in *[!0-9a-f]*|'') echo "volume helper Git identity is invalid" >&2; exit 1 ;; esac
[ "${#GIT_COMMIT}" -eq 40 ] && [ "${#GIT_TREE}" -eq 40 ] \
  && [ "${#MANIFEST_COMMIT}" -eq 40 ] && [ "${#MANIFEST_TREE}" -eq 40 ] \
  && [ "$(printf '%s\n' "$GIT_COMMIT" "$GIT_TREE" "$MANIFEST_COMMIT" "$MANIFEST_TREE" | sort -u | wc -l)" = 4 ] \
  || { echo "volume helper Git identity is invalid" >&2; exit 1; }
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "volume helper run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "volume helper run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "volume helper run ID is invalid" >&2; exit 1; }

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor site root mismatch" >&2; exit 1; }
BUNDLE_ROOT=$(CDPATH= cd -- "$SUPERVISOR_SITE_ROOT/.." && pwd -P)
SUPERVISOR_BUNDLE_SHA256=${ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256:-}
AUTHORIZATION_SHA256=${ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256:-}
for digest in "$SUPERVISOR_BUNDLE_SHA256" "$AUTHORIZATION_SHA256"; do
  case "$digest" in *[!0-9a-f]*|'') echo "release supervisor digest is invalid" >&2; exit 1 ;; esac
  [ "${#digest}" -eq 64 ] || { echo "release supervisor digest is invalid" >&2; exit 1; }
done
[ "$(basename -- "$BUNDLE_ROOT")" = "$SUPERVISOR_BUNDLE_SHA256" ] || { echo "release supervisor bundle path is invalid" >&2; exit 1; }
case "$BUNDLE_ROOT" in /usr/local/libexec/chenyida-erp-release-supervisor/bundles/*) : ;; *) echo "release supervisor is not installed in the trusted root" >&2; exit 1 ;; esac

REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
ARTIFACT_PARENT=$(readlink -f "$(dirname -- "$ARTIFACT_ROOT")")
ARTIFACT_ROOT="$ARTIFACT_PARENT/$(basename -- "$ARTIFACT_ROOT")"
TRIVY_DB_DIRECTORY=$(readlink -f "$TRIVY_DB_DIRECTORY")
[ "$ARTIFACT_ROOT" = "/var/lib/chenyida-erp/release-artifacts/$RUN_ID" ] \
  || { echo "volume helper artifact root does not match the authorized run" >&2; exit 1; }
git_candidate() {
  /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false \
    -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"
}
[ "$(git_candidate rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "volume helper repository root is invalid" >&2; exit 1; }
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$MANIFEST_COMMIT" ] \
  && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$MANIFEST_TREE" ] \
  && [ "$(git_candidate rev-parse --verify "$GIT_COMMIT^{tree}")" = "$GIT_TREE" ] \
  && [ "$(git_candidate rev-list --parents -n 1 "$MANIFEST_COMMIT")" = "$MANIFEST_COMMIT $GIT_COMMIT" ] \
  || { echo "volume helper source/manifest chain does not match the exact Git identity" >&2; exit 1; }
MANIFEST_CHANGE=$(git_candidate diff --name-status --no-renames "$GIT_COMMIT" "$MANIFEST_COMMIT" --)
case "$MANIFEST_CHANGE" in
  'A	chenyida_erp_site/release/release-supervisor-bundle-v1.json'|'M	chenyida_erp_site/release/release-supervisor-bundle-v1.json') : ;;
  *) echo "volume helper source/manifest chain contains non-manifest changes" >&2; exit 1 ;;
esac
if ! MANIFEST_BUNDLE_SHA256=$(/usr/bin/python3 - "$REPOSITORY_ROOT" "$MANIFEST_COMMIT" <<'PY'
import hashlib
import os
import subprocess
import sys

repository, commit = sys.argv[1:]
environment = {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C",
    "LANG": "C",
    "TZ": "UTC",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
}
result = subprocess.run([
    "/usr/bin/git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
    "-c", "core.useReplaceRefs=false", "-c", f"safe.directory={repository}",
    "-C", repository, "show",
    f"{commit}:chenyida_erp_site/release/release-supervisor-bundle-v1.json",
], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
   stderr=subprocess.DEVNULL, check=False)
if result.returncode != 0 or not 2 <= len(result.stdout) <= 32 * 1024 * 1024:
    raise SystemExit(1)
sys.stdout.write(hashlib.sha256(result.stdout).hexdigest())
PY
); then
  echo "installed supervisor bundle manifest cannot be read" >&2
  exit 1
fi
[ "$MANIFEST_BUNDLE_SHA256" = "$SUPERVISOR_BUNDLE_SHA256" ] \
  || { echo "installed supervisor bundle does not match the manifest commit" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked helper build-context files block the build" >&2; exit 1; }
case "$ARTIFACT_ROOT" in /*) : ;; *) echo "helper artifact root must be absolute" >&2; exit 1 ;; esac
case "$ARTIFACT_ROOT/" in "$REPOSITORY_ROOT/"*) echo "helper artifacts must be outside the repository" >&2; exit 1 ;; esac
case "$TRIVY_DB_DIRECTORY/" in "$REPOSITORY_ROOT/"*) echo "Trivy database must be outside the repository" >&2; exit 1 ;; esac
[ -d "$TRIVY_DB_DIRECTORY" ] && [ ! -L "$TRIVY_DB_DIRECTORY" ] && [ -f "$TRIVY_DB_DIRECTORY/metadata.json" ] && [ ! -L "$TRIVY_DB_DIRECTORY/metadata.json" ] || { echo "trusted Trivy database directory is invalid" >&2; exit 1; }

LOCK_HELPER="$SCRIPT_DIR/release-gate-lock.sh"
[ -f "$LOCK_HELPER" ] && [ ! -L "$LOCK_HELPER" ] || { echo "release operation lock helper is untrusted" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$LOCK_HELPER"
acquire_chenyida_release_gate_lock || exit 1

safety_command() {
  command=$1; shift
  /usr/bin/env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC HOME=/nonexistent \
    PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
    ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_GATE_LOCK_HELD=YES \
    ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" \
    ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" \
    /usr/bin/python3 -B "$SCRIPT_DIR/volume-helper-image-evidence.py" "$command" "$@" \
    --supervisor-bundle-sha256 "$SUPERVISOR_BUNDLE_SHA256" \
    --authorization-sha256 "$AUTHORIZATION_SHA256"
}
host_resource_gate() {
  phase=$1
  result=$(safety_command resource-gate --repository-root "$REPOSITORY_ROOT" \
    --phase "$phase" --compose-project "$PROTECTED_COMPOSE_PROJECT" \
    --state-file "$RESOURCE_GATE_STATE" \
    --confirm CHECK_VOLUME_HELPER_HOST_RESOURCE_STOP_LINES) \
    || { echo "volume helper host resource gate failed: $phase" >&2; return 1; }
  case "$result" in *'"phase":"'"$phase"'"'*'"result":"PASS"'*) : ;; \
    *) echo "volume helper host resource gate returned invalid evidence: $phase" >&2; return 1 ;; esac
  printf 'volume helper host resource gate: %s\n' "$result" >&2
}
complete_pending_resource_gate() {
  [ -n "$PENDING_AFTER_PHASE" ] || return 0
  pending_phase=$PENDING_AFTER_PHASE
  if host_resource_gate "$pending_phase"; then
    PENDING_AFTER_PHASE=""
    return 0
  fi
  return 1
}
trusted_database_tree() {
  safety_command trusted-tree --root "$TRIVY_DB_DIRECTORY" \
    --confirm HASH_TRUSTED_TRIVY_DATABASE_TREE
}

for image in "$BASE_IMAGE" "$REGISTRY_IMAGE" "$TRIVY_IMAGE" "$DOCKERFILE_FRONTEND"; do
  /usr/bin/docker image inspect "$image" >/dev/null 2>&1 || { echo "a pinned helper build image is unavailable locally; pulling is forbidden" >&2; exit 1; }
done
LOCAL_TAG="cyd-volume-restore-helper:$GIT_COMMIT-$RUN_ID"
! /usr/bin/docker image inspect "$LOCAL_TAG" >/dev/null 2>&1 || { echo "volume helper local image tag already exists" >&2; exit 1; }

if [ ! -e "$ARTIFACT_ROOT" ]; then install -d -m 0750 -o root -g root "$ARTIFACT_ROOT"; fi
[ -d "$ARTIFACT_ROOT" ] && [ ! -L "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$ARTIFACT_ROOT")" = "$ARTIFACT_ROOT" ] \
  && [ "$(stat -c '%u:%g:%a' "$ARTIFACT_ROOT")" = '0:0:750' ] || { echo "volume helper artifact root is invalid" >&2; exit 1; }
MARKER="$ARTIFACT_ROOT/.chenyida-erp-release-artifact-root-v1"
if [ ! -e "$MARKER" ]; then
  (umask 337; set -C; printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$MARKER")
  chown root:root "$MARKER"; chmod 0440 "$MARKER"; sync -f "$ARTIFACT_ROOT"
fi
[ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$MARKER")" = '0:0:440:1' ] \
  && [ "$(cat "$MARKER")" = chenyida-erp-release-artifact-root/v1 ] || { echo "volume helper artifact marker is invalid" >&2; exit 1; }
for suffix in inspect trivy.inspect trivy.version trivy-db.metadata trivy cdx build-provenance sbom-evidence security-evidence; do
  [ ! -e "$ARTIFACT_ROOT/$RUN_ID.volume-helper.$suffix.json" ] || { echo "volume helper evidence run already exists" >&2; exit 1; }
done

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-volume-helper-evidence.XXXXXX)
RESOURCE_GATE_STATE="$TEMP_ROOT/resource-gate-state.json"
SNAPSHOT="$TEMP_ROOT/snapshot"; INPUT_ROOT="$TEMP_ROOT/inputs"; OUTPUT_ROOT="$TEMP_ROOT/outputs"
REGISTRY_DATA="$TEMP_ROOT/registry-data"; SOURCE_ARCHIVE="$TEMP_ROOT/source.tar"
mkdir -m 0700 "$SNAPSHOT" "$INPUT_ROOT" "$OUTPUT_ROOT" "$REGISTRY_DATA"
git_candidate archive --format=tar "$GIT_COMMIT" chenyida_erp_site > "$SOURCE_ARCHIVE"
SOURCE_ARCHIVE_SHA256=$(sha256sum "$SOURCE_ARCHIVE" | cut -d ' ' -f 1)
SOURCE_ARCHIVE_BYTES=$(stat -c %s "$SOURCE_ARCHIVE")
/usr/bin/tar -xf "$SOURCE_ARCHIVE" -C "$SNAPSHOT"
SITE_ROOT="$SNAPSHOT/chenyida_erp_site"
for file in Dockerfile .dockerignore package.json scripts/volume-restore-helper.sh scripts/build-volume-restore-helper-image.sh scripts/volume-helper-image-evidence.py operations/volume-restore-helper-contract-v1.json operations/volume-helper-vulnerability-policy-v1.json; do
  [ -f "$SITE_ROOT/$file" ] && [ ! -L "$SITE_ROOT/$file" ] || { echo "volume helper source archive is incomplete" >&2; exit 1; }
done
[ "$(sha256sum "$SCRIPT_DIR/build-volume-restore-helper-image.sh" | cut -d ' ' -f 1)" = "$(sha256sum "$SITE_ROOT/scripts/build-volume-restore-helper-image.sh" | cut -d ' ' -f 1)" ] \
  && [ "$(sha256sum "$SCRIPT_DIR/volume-helper-image-evidence.py" | cut -d ' ' -f 1)" = "$(sha256sum "$SITE_ROOT/scripts/volume-helper-image-evidence.py" | cut -d ' ' -f 1)" ] \
  && [ "$(sha256sum "$SUPERVISOR_SITE_ROOT/operations/volume-restore-helper-contract-v1.json" | cut -d ' ' -f 1)" = "$(sha256sum "$SITE_ROOT/operations/volume-restore-helper-contract-v1.json" | cut -d ' ' -f 1)" ] \
  && [ "$(sha256sum "$SUPERVISOR_SITE_ROOT/operations/volume-helper-vulnerability-policy-v1.json" | cut -d ' ' -f 1)" = "$(sha256sum "$SITE_ROOT/operations/volume-helper-vulnerability-policy-v1.json" | cut -d ' ' -f 1)" ] \
  || { echo "installed supervisor helper evidence sources do not match the source commit" >&2; exit 1; }
[ "$(sed -n '1p' "$SITE_ROOT/Dockerfile")" = "# syntax=$DOCKERFILE_FRONTEND" ] || { echo "volume helper Dockerfile frontend is not digest pinned" >&2; exit 1; }
PACKAGE_VERSION=$(/usr/bin/python3 -c 'import json,re,sys;v=json.load(open(sys.argv[1],encoding="utf-8")).get("version");assert isinstance(v,str) and re.fullmatch(r"0\.1\.0-alpha\.\d+",v);print(v,end="")' "$SITE_ROOT/package.json")
DOCKERFILE_SHA256=$(sha256sum "$SITE_ROOT/Dockerfile" | cut -d ' ' -f 1)
DOCKERIGNORE_SHA256=$(sha256sum "$SITE_ROOT/.dockerignore" | cut -d ' ' -f 1)
HELPER_SCRIPT_SHA256=$(sha256sum "$SITE_ROOT/scripts/volume-restore-helper.sh" | cut -d ' ' -f 1)
ORCHESTRATOR_SHA256=$(sha256sum "$SITE_ROOT/scripts/build-volume-restore-helper-image.sh" | cut -d ' ' -f 1)

DOCKER_SERVER_VERSION=$(/usr/bin/docker version --format '{{.Server.Version}}')
BUILDX_VERSION=$(/usr/bin/docker buildx version | /usr/bin/awk 'NR==1 {print $2}')
BUILDER_INSPECT=$(/usr/bin/docker buildx inspect default --bootstrap=false)
BUILDER_DRIVER=$(printf '%s\n' "$BUILDER_INSPECT" | /usr/bin/awk '/^Driver:/ {print $2; exit}')
BUILDKIT_VERSION=$(printf '%s\n' "$BUILDER_INSPECT" | /usr/bin/awk '/^BuildKit version:/ {print $3; exit}')
[ "$BUILDER_DRIVER" = docker ] || { echo "volume helper builder driver is invalid" >&2; exit 1; }
case "$BUILDKIT_VERSION" in v[0-9]*.[0-9]*.[0-9]*) : ;; *) echo "volume helper BuildKit version is invalid" >&2; exit 1 ;; esac
BASE_IMAGE_CONFIG_DIGEST=$(/usr/bin/docker image inspect --format '{{.Id}}' "$BASE_IMAGE")
REGISTRY_IMAGE_CONFIG_DIGEST=$(/usr/bin/docker image inspect --format '{{.Id}}' "$REGISTRY_IMAGE")
case "$BASE_IMAGE_CONFIG_DIGEST$REGISTRY_IMAGE_CONFIG_DIGEST" in *[!0-9a-f:]*|*sha256:sha256:*) echo "volume helper base image configuration is invalid" >&2; exit 1 ;; esac

host_resource_gate BUILD_BEFORE || exit 1
PENDING_AFTER_PHASE=BUILD_AFTER
set +e
COMPOSE_PARALLEL_LIMIT=1 NODE_OPTIONS=--max-old-space-size=1024 /usr/bin/docker buildx build \
  --builder default --load --pull=false --provenance=false --platform linux/amd64 \
  --network default --target volume-restore-helper \
  --build-arg "ERP_BUILD_VERSION=$PACKAGE_VERSION" \
  --build-arg "ERP_BUILD_REVISION=$GIT_COMMIT" \
  --build-arg "ERP_BUILD_TREE=$GIT_TREE" \
  --build-arg "ERP_VOLUME_HELPER_CONTRACT_SHA256=$HELPER_CONTRACT_SHA256" \
  --tag "$LOCAL_TAG" "$SITE_ROOT"
build_status=$?
set -e
after_status=0
complete_pending_resource_gate || after_status=$?
[ "$build_status" -eq 0 ] || { echo "volume helper image build failed closed" >&2; exit 1; }
[ "$after_status" -eq 0 ] || exit 1
OWN_LOCAL=YES

CONTAINER_NAME="cyd-volume-helper-registry-$RUN_ID"
! /usr/bin/docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 || { echo "volume helper registry container name already exists" >&2; exit 1; }
CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" \
  --label "chenyida.erp.volume-helper-evidence=$RUN_ID" \
  --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" \
  --publish 127.0.0.1::5000 --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --memory-swap 160m --cpus 0.5 --pids-limit 64 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m -v "$REGISTRY_DATA:/var/lib/registry:rw" "$REGISTRY_IMAGE")
/usr/bin/docker start "$CONTAINER_ID" >/dev/null
REGISTRY_PORT=$(/usr/bin/docker inspect --format '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostPort}}' "$CONTAINER_ID")
case "$REGISTRY_PORT" in ''|*[!0-9]*) echo "volume helper registry port is invalid" >&2; exit 1 ;; esac
[ "$REGISTRY_PORT" -le 65535 ] && [ "$REGISTRY_PORT" -ge 1 ] || { echo "volume helper registry port is invalid" >&2; exit 1; }
[ "$(/usr/bin/docker inspect --format '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostIp}}' "$CONTAINER_ID")" = 127.0.0.1 ] || { echo "volume helper registry is not loopback only" >&2; exit 1; }
ready=NO
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if /usr/bin/curl --fail --silent --show-error --max-time 1 "http://127.0.0.1:$REGISTRY_PORT/v2/" >/dev/null 2>&1; then ready=YES; break; fi
  sleep 0.25
done
[ "$ready" = YES ] || { echo "volume helper registry did not become ready" >&2; exit 1; }
REGISTRY_TAG="127.0.0.1:$REGISTRY_PORT/chenyida-erp/volume-restore-helper:$GIT_COMMIT-$RUN_ID"
/usr/bin/docker tag "$LOCAL_TAG" "$REGISTRY_TAG"; OWN_REGISTRY_TAG=YES
/usr/bin/docker push "$REGISTRY_TAG"
IMAGE_REFERENCE=$(/usr/bin/docker image inspect --format '{{json .RepoDigests}}' "$REGISTRY_TAG" | /usr/bin/python3 -c 'import json,sys;p=sys.argv[1]+"@sha256:";v=[x for x in json.load(sys.stdin) if x.startswith(p)];assert len(v)==1;print(v[0],end="")' "127.0.0.1:$REGISTRY_PORT/chenyida-erp/volume-restore-helper")
OWN_DIGEST=YES
/usr/bin/docker pull "$IMAGE_REFERENCE" >/dev/null
IMAGE_CONFIG_DIGEST=$(/usr/bin/docker image inspect --format '{{.Id}}' "$IMAGE_REFERENCE")
[ "$IMAGE_CONFIG_DIGEST" = "$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_TAG")" ] || { echo "volume helper registry round trip changed the image" >&2; exit 1; }
remove_container
[ -d "$REGISTRY_DATA" ] && [ ! -L "$REGISTRY_DATA" ] && [ "$(readlink -f "$REGISTRY_DATA")" = "$TEMP_ROOT/registry-data" ] || { echo "volume helper registry storage path is invalid" >&2; exit 1; }
rm -rf -- "$REGISTRY_DATA"

sanitize_helper_inspect() {
  IMAGE_REFERENCE_VALUE="$IMAGE_REFERENCE" IMAGE_CONFIG_VALUE="$IMAGE_CONFIG_DIGEST" \
    /usr/bin/docker image inspect -- "$IMAGE_REFERENCE" | /usr/bin/python3 -c '
import json,os,re,sys
rows=json.load(sys.stdin); assert isinstance(rows,list) and len(rows)==1
r=rows[0]; ref=os.environ["IMAGE_REFERENCE_VALUE"]; config=os.environ["IMAGE_CONFIG_VALUE"]; manifest=ref.rsplit("@",1)[1]
assert r.get("Id")==config and r.get("Os")=="linux" and r.get("Architecture")=="amd64"
assert ref in r.get("RepoDigests",[])
labels=r.get("Config",{}).get("Labels") or {}; keys=["org.opencontainers.image.version","org.opencontainers.image.revision","io.chenyida.erp.git-tree","io.chenyida.erp.image-role","io.chenyida.erp.volume-helper.protocol","io.chenyida.erp.volume-helper.toolchain-contract-sha256"]
out={"image_reference":ref,"registry_manifest_digest":manifest,"image_config_digest":config,"os":"linux","architecture":"amd64","repo_digests":[ref],"labels":{k:labels.get(k) for k in keys},"user":r.get("Config",{}).get("User"),"entrypoint":r.get("Config",{}).get("Entrypoint"),"cmd":r.get("Config",{}).get("Cmd"),"working_directory":r.get("Config",{}).get("WorkingDir"),"rootfs_layers":r.get("RootFS",{}).get("Layers")}
assert all(isinstance(x,str) and re.fullmatch(r"sha256:[0-9a-f]{64}",x) for x in out["rootfs_layers"])
sys.stdout.write(json.dumps(out,sort_keys=True,separators=(",",":"))+"\n")' > "$1"
  chmod 0400 "$1"
}
sanitize_scanner_inspect() {
  SCANNER_REFERENCE="$TRIVY_IMAGE" /usr/bin/docker image inspect -- "$TRIVY_IMAGE" | /usr/bin/python3 -c '
import json,os,sys
rows=json.load(sys.stdin); assert isinstance(rows,list) and len(rows)==1
r=rows[0]; ref=os.environ["SCANNER_REFERENCE"]; assert ref in r.get("RepoDigests",[]) and r.get("Os")=="linux" and r.get("Architecture")=="amd64"
out={"image_reference":ref,"registry_manifest_digest":ref.rsplit("@",1)[1],"image_config_digest":r.get("Id"),"os":"linux","architecture":"amd64","repo_digests":[ref]}
sys.stdout.write(json.dumps(out,sort_keys=True,separators=(",",":"))+"\n")' > "$1"
  chmod 0400 "$1"
}
sanitize_helper_inspect "$INPUT_ROOT/helper.inspect.json"
sanitize_scanner_inspect "$INPUT_ROOT/trivy.inspect.json"
SCANNER_IMAGE_CONFIG_DIGEST=$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["image_config_digest"],end="")' "$INPUT_ROOT/trivy.inspect.json")

IMAGE_ARCHIVE="$INPUT_ROOT/helper.tar"
/usr/bin/docker image save --output "$IMAGE_ARCHIVE" "$IMAGE_REFERENCE"
chmod 0400 "$IMAGE_ARCHIVE"
IMAGE_ARCHIVE_SHA256=$(sha256sum "$IMAGE_ARCHIVE" | cut -d ' ' -f 1)
IMAGE_ARCHIVE_BYTES=$(stat -c %s "$IMAGE_ARCHIVE")
ARCHIVE_CONFIG_PATH=$(/usr/bin/tar -xOf "$IMAGE_ARCHIVE" manifest.json | /usr/bin/python3 -c 'import json,re,sys;v=json.load(sys.stdin);assert isinstance(v,list) and len(v)==1 and isinstance(v[0].get("Config"),str);p=v[0]["Config"];m=re.fullmatch(r"(?:blobs/sha256/)?([0-9a-f]{64})(?:\.json)?",p);assert m;print(p,end="")')
ARCHIVE_CONFIG_HEX=$(printf '%s' "$ARCHIVE_CONFIG_PATH" | sed -E 's#^blobs/sha256/##;s#\.json$##')
[ "sha256:$ARCHIVE_CONFIG_HEX" = "$IMAGE_CONFIG_DIGEST" ] || { echo "volume helper archive configuration identity is invalid" >&2; exit 1; }
[ "sha256:$(/usr/bin/tar -xOf "$IMAGE_ARCHIVE" "$ARCHIVE_CONFIG_PATH" | sha256sum | cut -d ' ' -f 1)" = "$IMAGE_CONFIG_DIGEST" ] || { echo "volume helper archive configuration blob digest mismatch" >&2; exit 1; }

CONTAINER_NAME="cyd-volume-helper-trivy-binary-$RUN_ID"
CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" \
  --label "chenyida.erp.volume-helper-evidence=$RUN_ID" \
  --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" \
  --network none --entrypoint /bin/true "$TRIVY_IMAGE")
/usr/bin/docker cp "$CONTAINER_ID:/usr/local/bin/trivy" "$TEMP_ROOT/trivy"
remove_container
SCANNER_BINARY_SHA256=$(sha256sum "$TEMP_ROOT/trivy" | cut -d ' ' -f 1)

CONTAINER_NAME="cyd-volume-helper-trivy-version-$RUN_ID"
CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" \
  --label "chenyida.erp.volume-helper-evidence=$RUN_ID" \
  --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 0:0 \
  --memory 256m --memory-swap 320m --cpus 1 --pids-limit 64 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m --tmpfs /root:rw,nosuid,nodev,noexec,size=16m \
  --entrypoint /usr/local/bin/trivy "$TRIVY_IMAGE" version --format json)
set +e
/usr/bin/docker start --attach "$CONTAINER_ID" > "$INPUT_ROOT/trivy.version.json"
TRIVY_STATUS=$?
set -e
remove_container
[ "$TRIVY_STATUS" -eq 0 ] && [ -s "$INPUT_ROOT/trivy.version.json" ] || { echo "volume helper Trivy version capture failed" >&2; exit 1; }
chmod 0400 "$INPUT_ROOT/trivy.version.json"
install -m 0400 -o root -g root "$TRIVY_DB_DIRECTORY/metadata.json" "$INPUT_ROOT/trivy-db.metadata.json"

DATABASE_TREE_IDENTITY=$(trusted_database_tree) \
  || { echo "trusted Trivy database tree validation failed" >&2; exit 1; }
DATABASE_TREE_SHA256=$(printf '%s' "$DATABASE_TREE_IDENTITY" | /usr/bin/python3 -c '
import json,re,sys
value=json.load(sys.stdin); digest=value.get("tree_sha256")
assert value.get("result") is None and isinstance(digest,str) and re.fullmatch(r"[0-9a-f]{64}",digest)
print(digest,end="")') \
  || { echo "trusted Trivy database tree identity is invalid" >&2; exit 1; }

run_scan() {
  output_name=$1; format=$2; exit_code=$3
  case "$format" in
    json) resource_phase=TRIVY_JSON ;;
    cyclonedx) resource_phase=TRIVY_CYCLONEDX ;;
    *) echo "volume helper Trivy format is invalid" >&2; exit 1 ;;
  esac
  host_resource_gate "${resource_phase}_BEFORE" || return 1
  PENDING_AFTER_PHASE="${resource_phase}_AFTER"
  CONTAINER_NAME="cyd-volume-helper-trivy-$format-$RUN_ID"
  set +e
  CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" \
    --label "chenyida.erp.volume-helper-evidence=$RUN_ID" \
    --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 0:0 \
    --memory 768m --memory-swap 896m --cpus 1 --pids-limit 256 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m --tmpfs /root:rw,nosuid,nodev,noexec,size=32m \
    --tmpfs /trivy-cache:rw,nosuid,nodev,noexec,size=256m \
    -v "$TRIVY_DB_DIRECTORY:/trivy-cache/db:ro" -v "$IMAGE_ARCHIVE:/input/image.tar:ro" \
    -v "$OUTPUT_ROOT:/output:rw" --entrypoint /usr/local/bin/trivy "$TRIVY_IMAGE" \
    image --input /input/image.tar --cache-dir /trivy-cache --scanners vuln --pkg-types os \
    --list-all-pkgs --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code "$exit_code" \
    --format "$format" --output "/output/$output_name" --skip-db-update --skip-java-db-update \
    --skip-check-update --skip-vex-repo-update --skip-version-check --offline-scan \
    --disable-telemetry --no-progress --config /dev/null --ignorefile /dev/null)
  scan_status=$?
  if [ "$scan_status" -eq 0 ]; then
    /usr/bin/docker start --attach "$CONTAINER_ID"
    scan_status=$?
  fi
  remove_status=0
  remove_container || remove_status=$?
  set -e
  after_status=0
  complete_pending_resource_gate || after_status=$?
  [ "$scan_status" -eq 0 ] && [ "$remove_status" -eq 0 ] \
    && [ -s "$OUTPUT_ROOT/$output_name" ] \
    || { echo "volume helper Trivy $format scan failed closed" >&2; return 1; }
  [ "$after_status" -eq 0 ] || return 1
  chmod 0400 "$OUTPUT_ROOT/$output_name"
}
run_scan helper.trivy.json json 1
run_scan helper.cdx.json cyclonedx 0

[ "$(trusted_database_tree)" = "$DATABASE_TREE_IDENTITY" ] || { echo "Trivy database changed during the helper scan" >&2; exit 1; }
sanitize_helper_inspect "$INPUT_ROOT/helper.inspect.final.json"
sanitize_scanner_inspect "$INPUT_ROOT/trivy.inspect.final.json"
cmp -s "$INPUT_ROOT/helper.inspect.json" "$INPUT_ROOT/helper.inspect.final.json" || { echo "volume helper image changed during the scan" >&2; exit 1; }
cmp -s "$INPUT_ROOT/trivy.inspect.json" "$INPUT_ROOT/trivy.inspect.final.json" || { echo "Trivy image changed during the scan" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$MANIFEST_COMMIT" ] \
  && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$MANIFEST_TREE" ] \
  && [ "$(git_candidate rev-parse --verify "$GIT_COMMIT^{tree}")" = "$GIT_TREE" ] \
  || { echo "volume helper source identity changed during the scan" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked helper source appeared during the scan" >&2; exit 1; }

GENERATED_AT=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
PRODUCER_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC HOME=/nonexistent PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_GATE_LOCK_HELD=YES \
  ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" \
  ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" \
  /usr/bin/python3 -B "$SCRIPT_DIR/volume-helper-image-evidence.py" create \
  --artifact-root "$ARTIFACT_ROOT" --run-id "$RUN_ID" --generated-at "$GENERATED_AT" \
  --git-commit "$GIT_COMMIT" --git-tree "$GIT_TREE" --application-version "$PACKAGE_VERSION" \
  --source-archive-sha256 "$SOURCE_ARCHIVE_SHA256" --source-archive-bytes "$SOURCE_ARCHIVE_BYTES" \
  --dockerfile-sha256 "$DOCKERFILE_SHA256" --dockerignore-sha256 "$DOCKERIGNORE_SHA256" \
  --helper-script-sha256 "$HELPER_SCRIPT_SHA256" \
  --helper-contract "$SUPERVISOR_SITE_ROOT/operations/volume-restore-helper-contract-v1.json" \
  --policy "$SUPERVISOR_SITE_ROOT/operations/volume-helper-vulnerability-policy-v1.json" \
  --orchestrator-sha256 "$ORCHESTRATOR_SHA256" \
  --supervisor-bundle-sha256 "$SUPERVISOR_BUNDLE_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" \
  --docker-server-version "$DOCKER_SERVER_VERSION" --buildx-version "$BUILDX_VERSION" --buildkit-version "$BUILDKIT_VERSION" \
  --base-image-config-digest "$BASE_IMAGE_CONFIG_DIGEST" --registry-image-config-digest "$REGISTRY_IMAGE_CONFIG_DIGEST" \
  --image-reference "$IMAGE_REFERENCE" --image-config-digest "$IMAGE_CONFIG_DIGEST" \
  --image-inspect "$INPUT_ROOT/helper.inspect.json" --archive-sha256 "$IMAGE_ARCHIVE_SHA256" \
  --archive-bytes "$IMAGE_ARCHIVE_BYTES" --archive-config-digest "$IMAGE_CONFIG_DIGEST" \
  --scanner-image-config-digest "$SCANNER_IMAGE_CONFIG_DIGEST" --scanner-binary-sha256 "$SCANNER_BINARY_SHA256" \
  --scanner-inspect "$INPUT_ROOT/trivy.inspect.json" --scanner-version "$INPUT_ROOT/trivy.version.json" \
  --database-metadata "$INPUT_ROOT/trivy-db.metadata.json" --database-payload-tree-sha256 "$DATABASE_TREE_SHA256" \
  --vulnerability "$OUTPUT_ROOT/helper.trivy.json" --cyclonedx "$OUTPUT_ROOT/helper.cdx.json" \
  --confirm CREATE_VOLUME_HELPER_IMAGE_EVIDENCE)
case "$PRODUCER_OUTPUT" in
  *'"result":"PASS"'*'"build_provenance_sha256":"'*'"sbom_evidence_sha256":"'*'"security_evidence_sha256":"'*) : ;;
  *) echo "volume helper evidence producer returned an invalid result" >&2; exit 1 ;;
esac
rm -f -- "$IMAGE_ARCHIVE"
SUCCESS=YES
printf '%s\n' "$PRODUCER_OUTPUT"
