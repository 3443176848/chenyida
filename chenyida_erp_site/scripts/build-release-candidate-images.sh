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

NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
RUNTIME_BASE_IMAGE='cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed'
REGISTRY_IMAGE='registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373'
DOCKERFILE_FRONTEND='docker.io/docker/dockerfile:1.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720'

usage() {
  echo "usage: $0 --repository-root DIR --git-commit COMMIT --git-tree TREE --artifact-root DIR --run-id ID --confirm BUILD_EXACT_LOCAL_RELEASE_CANDIDATE" >&2
  exit 2
}

REPOSITORY_ROOT=""; GIT_COMMIT=""; GIT_TREE=""; ARTIFACT_ROOT=""; RUN_ID=""; CONFIRM=""
TEMP_ROOT=""; CONTAINER_ID=""; CONTAINER_NAME=""; SUCCESS=NO
LOCAL_WEB_TAG=""; LOCAL_WORKER_TAG=""; REGISTRY_WEB_TAG=""; REGISTRY_WORKER_TAG=""; WEB_IMAGE_REF=""; WORKER_IMAGE_REF=""
OWN_LOCAL_WEB=NO; OWN_LOCAL_WORKER=NO; OWN_REGISTRY_WEB=NO; OWN_REGISTRY_WORKER=NO; OWN_WEB_DIGEST=NO; OWN_WORKER_DIGEST=NO

remove_container() {
  if [ -z "$CONTAINER_ID" ] && [ -n "$CONTAINER_NAME" ]; then CONTAINER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$CONTAINER_NAME" 2>/dev/null || true); fi
  [ -n "$CONTAINER_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-candidate-build"}}|{{.Name}}' "$CONTAINER_ID" 2>/dev/null || true)" = "$RUN_ID|/$CONTAINER_NAME" ] || { echo "refusing to remove a container not owned by this candidate build" >&2; return 1; }
  /usr/bin/docker rm -f "$CONTAINER_ID" >/dev/null
  CONTAINER_ID=""
}

remove_failed_image_references() {
  [ "$SUCCESS" = NO ] || return 0
  status=0
  if [ "$OWN_WEB_DIGEST" = YES ]; then /usr/bin/docker image rm -- "$WEB_IMAGE_REF" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_WORKER_DIGEST" = YES ]; then /usr/bin/docker image rm -- "$WORKER_IMAGE_REF" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_REGISTRY_WEB" = YES ]; then /usr/bin/docker image rm -- "$REGISTRY_WEB_TAG" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_REGISTRY_WORKER" = YES ]; then /usr/bin/docker image rm -- "$REGISTRY_WORKER_TAG" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_LOCAL_WEB" = YES ]; then /usr/bin/docker image rm -- "$LOCAL_WEB_TAG" >/dev/null 2>&1 || status=1; fi
  if [ "$OWN_LOCAL_WORKER" = YES ]; then /usr/bin/docker image rm -- "$LOCAL_WORKER_TAG" >/dev/null 2>&1 || status=1; fi
  return "$status"
}

cleanup() {
  status=0
  remove_container >/dev/null 2>&1 || status=1
  remove_failed_image_references || status=1
  if [ -n "$TEMP_ROOT" ]; then
    case "$TEMP_ROOT" in /tmp/chenyida-erp-release-candidate-build.*) rm -rf -- "$TEMP_ROOT" || status=1 ;; *) status=1 ;; esac
  fi
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository-root) REPOSITORY_ROOT=${2:-}; shift 2 ;;
    --git-commit) GIT_COMMIT=${2:-}; shift 2 ;;
    --git-tree) GIT_TREE=${2:-}; shift 2 ;;
    --artifact-root) ARTIFACT_ROOT=${2:-}; shift 2 ;;
    --run-id) RUN_ID=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
for value in "$REPOSITORY_ROOT" "$GIT_COMMIT" "$GIT_TREE" "$ARTIFACT_ROOT" "$RUN_ID" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$(id -u)" = 0 ] || { echo "candidate build requires root" >&2; exit 1; }
[ "$CONFIRM" = BUILD_EXACT_LOCAL_RELEASE_CANDIDATE ] || { echo "candidate build confirmation is invalid" >&2; exit 1; }
case "$GIT_COMMIT$GIT_TREE" in *[!0-9a-f]*|'') echo "candidate Git identity is invalid" >&2; exit 1 ;; esac
[ "${#GIT_COMMIT}" -eq 40 ] && [ "${#GIT_TREE}" -eq 40 ] || { echo "candidate Git identity is invalid" >&2; exit 1; }
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "candidate run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "candidate run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "candidate run ID is invalid" >&2; exit 1; }

REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
ARTIFACT_PARENT=$(readlink -f "$(dirname -- "$ARTIFACT_ROOT")")
ARTIFACT_ROOT="$ARTIFACT_PARENT/$(basename -- "$ARTIFACT_ROOT")"
[ "$(/usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "candidate repository root is invalid" >&2; exit 1; }
case "$ARTIFACT_ROOT" in /*) : ;; *) echo "candidate artifact root must be absolute" >&2; exit 1 ;; esac
case "$ARTIFACT_ROOT/" in "$REPOSITORY_ROOT/"*) echo "candidate artifacts must be outside the repository" >&2; exit 1 ;; esac
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "candidate source does not match the exact Git identity" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked build-context files block candidate build" >&2; exit 1; }

if [ ! -e "$ARTIFACT_ROOT" ]; then install -d -m 0750 -o root -g root "$ARTIFACT_ROOT"; fi
[ -d "$ARTIFACT_ROOT" ] && [ ! -L "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$ARTIFACT_ROOT")" = "$ARTIFACT_ROOT" ] && [ "$(stat -c '%u:%g:%a' "$ARTIFACT_ROOT")" = "0:0:750" ] || { echo "candidate artifact root is invalid" >&2; exit 1; }
MARKER="$ARTIFACT_ROOT/.chenyida-erp-release-artifact-root-v1"
if [ ! -e "$MARKER" ]; then
  (umask 337; set -C; printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$MARKER")
  chown root:root "$MARKER"; chmod 0440 "$MARKER"; sync -f "$ARTIFACT_ROOT"
fi
[ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$MARKER")" = "0:0:440:1" ] && [ "$(cat "$MARKER")" = chenyida-erp-release-artifact-root/v1 ] || { echo "candidate artifact root marker is invalid" >&2; exit 1; }
[ ! -e "$ARTIFACT_ROOT/$RUN_ID.build-provenance.json" ] || { echo "candidate build provenance already exists" >&2; exit 1; }

/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned Node base image is unavailable; pulling during build is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$RUNTIME_BASE_IMAGE" >/dev/null 2>&1 || { echo "pinned runtime base image is unavailable; pulling during build is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$REGISTRY_IMAGE" >/dev/null 2>&1 || { echo "pinned loopback registry image is unavailable; pulling during build is forbidden" >&2; exit 1; }
LOCAL_WEB_TAG="cyd-release-candidate-web:$GIT_COMMIT"
LOCAL_WORKER_TAG="cyd-release-candidate-worker:$GIT_COMMIT"
for image in "$LOCAL_WEB_TAG" "$LOCAL_WORKER_TAG"; do ! /usr/bin/docker image inspect "$image" >/dev/null 2>&1 || { echo "candidate local image tag already exists" >&2; exit 1; }; done

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-release-candidate-build.XXXXXX)
SNAPSHOT="$TEMP_ROOT/snapshot"; INPUT_ROOT="$TEMP_ROOT/inputs"; REGISTRY_DATA="$TEMP_ROOT/registry-data"; SOURCE_ARCHIVE="$TEMP_ROOT/source.tar"
mkdir -m 0700 "$SNAPSHOT" "$INPUT_ROOT" "$REGISTRY_DATA"
git_candidate archive --format=tar "$GIT_COMMIT" chenyida_erp_site > "$SOURCE_ARCHIVE"
ARCHIVE_SHA256=$(sha256sum "$SOURCE_ARCHIVE" | cut -d ' ' -f 1)
ARCHIVE_BYTES=$(stat -c '%s' "$SOURCE_ARCHIVE")
/usr/bin/tar -xf "$SOURCE_ARCHIVE" -C "$SNAPSHOT"
SITE_ROOT="$SNAPSHOT/chenyida_erp_site"
[ -f "$SITE_ROOT/Dockerfile" ] && [ -f "$SITE_ROOT/package.json" ] && [ -f "$SITE_ROOT/package-lock.json" ] || { echo "candidate Git archive is incomplete" >&2; exit 1; }
[ "$(sed -n '1p' "$SITE_ROOT/Dockerfile")" = "# syntax=$DOCKERFILE_FRONTEND" ] || { echo "candidate Dockerfile frontend is not digest-pinned" >&2; exit 1; }
PACKAGE_VERSION=$(/usr/bin/python3 -c 'import json,re,sys; value=json.load(open(sys.argv[1],encoding="utf-8")); version=value.get("version"); assert isinstance(version,str) and re.fullmatch(r"0\.1\.0-alpha\.\d+",version); print(version,end="")' "$SITE_ROOT/package.json")
MIGRATION_ALLOWLIST_SHA256=$(/usr/bin/python3 -c 'import hashlib,json,pathlib,re,sys; root=pathlib.Path(sys.argv[1]); names=sorted(p.name for p in root.glob("*.sql")); entries=[]
for index,name in enumerate(names,1):
 m=re.fullmatch(r"(\d{4})_[A-Za-z0-9_]+\.sql",name); assert m and int(m.group(1))==index
 entries.append({"ordinal":index,"filename":name,"sha256":hashlib.sha256((root/name).read_bytes()).hexdigest()})
assert entries
print(hashlib.sha256((json.dumps(entries,separators=(",",":"))+"\n").encode()).hexdigest(),end="")' "$SITE_ROOT/drizzle-postgres")

DOCKER_SERVER_VERSION=$(/usr/bin/docker version --format '{{.Server.Version}}')
BUILDX_VERSION=$(/usr/bin/docker buildx version | /usr/bin/awk 'NR==1 {print $2}')
BUILDER_INSPECT=$(/usr/bin/docker buildx inspect default --bootstrap=false)
BUILDER_DRIVER=$(printf '%s\n' "$BUILDER_INSPECT" | /usr/bin/awk '/^Driver:/ {print $2; exit}')
BUILDKIT_VERSION=$(printf '%s\n' "$BUILDER_INSPECT" | /usr/bin/awk '/^BuildKit version:/ {print $3; exit}')
[ "$BUILDER_DRIVER" = docker ] || { echo "candidate builder driver is invalid" >&2; exit 1; }
case "$BUILDKIT_VERSION" in v[0-9]*.[0-9]*.[0-9]*) : ;; *) echo "candidate BuildKit version is invalid" >&2; exit 1 ;; esac
for target in web worker; do
  if [ "$target" = web ]; then local_tag=$LOCAL_WEB_TAG; else local_tag=$LOCAL_WORKER_TAG; fi
  COMPOSE_PARALLEL_LIMIT=1 NODE_OPTIONS=--max-old-space-size=1024 /usr/bin/docker buildx build --builder default --load --pull=false --provenance=false --platform linux/amd64 --network default --target "$target" \
    --build-arg "ERP_BUILD_VERSION=$PACKAGE_VERSION" --build-arg "ERP_BUILD_REVISION=$GIT_COMMIT" --tag "$local_tag" "$SITE_ROOT"
  if [ "$target" = web ]; then OWN_LOCAL_WEB=YES; else OWN_LOCAL_WORKER=YES; fi
done

CONTAINER_NAME="cyd-release-candidate-registry-$RUN_ID"
! /usr/bin/docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 || { echo "candidate registry container name already exists" >&2; exit 1; }
CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" --label "chenyida.erp.release-candidate-build=$RUN_ID" --publish 127.0.0.1::5000 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --memory-swap 160m --cpus 0.5 --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m -v "$REGISTRY_DATA:/var/lib/registry:rw" "$REGISTRY_IMAGE")
/usr/bin/docker start "$CONTAINER_ID" >/dev/null
REGISTRY_PORT=$(/usr/bin/docker inspect --format '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostPort}}' "$CONTAINER_ID")
case "$REGISTRY_PORT" in ''|*[!0-9]*) echo "candidate registry loopback port is invalid" >&2; exit 1 ;; esac
[ "$REGISTRY_PORT" -ge 1 ] && [ "$REGISTRY_PORT" -le 65535 ] || { echo "candidate registry loopback port is invalid" >&2; exit 1; }
[ "$(/usr/bin/docker inspect --format '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostIp}}' "$CONTAINER_ID")" = 127.0.0.1 ] || { echo "candidate registry is not loopback-only" >&2; exit 1; }
[ "$(/usr/bin/docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/registry"}}{{.Type}}|{{.Source}}{{end}}{{end}}' "$CONTAINER_ID")" = "bind|$REGISTRY_DATA" ] || { echo "candidate registry storage mount is invalid" >&2; exit 1; }
ready=NO
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if /usr/bin/curl --fail --silent --show-error --max-time 1 "http://127.0.0.1:$REGISTRY_PORT/v2/" >/dev/null 2>&1; then ready=YES; break; fi
  sleep 0.25
done
[ "$ready" = YES ] || { echo "candidate registry did not become ready" >&2; exit 1; }

REGISTRY_WEB_TAG="127.0.0.1:$REGISTRY_PORT/chenyida-erp/web:$GIT_COMMIT"
REGISTRY_WORKER_TAG="127.0.0.1:$REGISTRY_PORT/chenyida-erp/worker:$GIT_COMMIT"
/usr/bin/docker tag "$LOCAL_WEB_TAG" "$REGISTRY_WEB_TAG"; OWN_REGISTRY_WEB=YES
/usr/bin/docker push "$REGISTRY_WEB_TAG"
/usr/bin/docker tag "$LOCAL_WORKER_TAG" "$REGISTRY_WORKER_TAG"; OWN_REGISTRY_WORKER=YES
/usr/bin/docker push "$REGISTRY_WORKER_TAG"
repo_digest() {
  /usr/bin/docker image inspect --format '{{json .RepoDigests}}' "$1" | /usr/bin/python3 -c 'import json,sys; prefix=sys.argv[1]+"@sha256:"; values=[value for value in json.load(sys.stdin) if value.startswith(prefix)]; assert len(values)==1; print(values[0],end="")' "$2"
}
WEB_IMAGE_REF=$(repo_digest "$REGISTRY_WEB_TAG" "127.0.0.1:$REGISTRY_PORT/chenyida-erp/web")
WORKER_IMAGE_REF=$(repo_digest "$REGISTRY_WORKER_TAG" "127.0.0.1:$REGISTRY_PORT/chenyida-erp/worker")
OWN_WEB_DIGEST=YES; OWN_WORKER_DIGEST=YES
[ "$WEB_IMAGE_REF" != "$WORKER_IMAGE_REF" ] || { echo "candidate image references collided" >&2; exit 1; }
/usr/bin/docker pull "$WEB_IMAGE_REF" >/dev/null
/usr/bin/docker pull "$WORKER_IMAGE_REF" >/dev/null

/usr/bin/docker image inspect "$NODE_IMAGE" > "$INPUT_ROOT/build-base.inspect.json"
/usr/bin/docker image inspect "$RUNTIME_BASE_IMAGE" > "$INPUT_ROOT/runtime-base.inspect.json"
/usr/bin/docker image inspect "$REGISTRY_IMAGE" > "$INPUT_ROOT/registry.inspect.json"
/usr/bin/docker image inspect "$WEB_IMAGE_REF" > "$INPUT_ROOT/web.inspect.json"
/usr/bin/docker image inspect "$WORKER_IMAGE_REF" > "$INPUT_ROOT/worker.inspect.json"
chmod 0400 "$INPUT_ROOT/build-base.inspect.json" "$INPUT_ROOT/runtime-base.inspect.json" "$INPUT_ROOT/registry.inspect.json" "$INPUT_ROOT/web.inspect.json" "$INPUT_ROOT/worker.inspect.json"
remove_container
[ -d "$REGISTRY_DATA" ] && [ ! -L "$REGISTRY_DATA" ] && [ "$(readlink -f "$REGISTRY_DATA")" = "$TEMP_ROOT/registry-data" ] || { echo "candidate registry storage path is invalid" >&2; exit 1; }
rm -rf -- "$REGISTRY_DATA"
[ ! -e "$REGISTRY_DATA" ] || { echo "candidate registry storage was not removed" >&2; exit 1; }
[ "$(/usr/bin/docker image inspect --format '{{.Id}}' "$WEB_IMAGE_REF")" = "$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_WEB_TAG")" ] || { echo "Web digest pull changed the candidate image" >&2; exit 1; }
[ "$(/usr/bin/docker image inspect --format '{{.Id}}' "$WORKER_IMAGE_REF")" = "$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_WORKER_TAG")" ] || { echo "Worker digest pull changed the candidate image" >&2; exit 1; }

CONTAINER_NAME="cyd-release-candidate-provenance-$RUN_ID"
CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" --label "chenyida.erp.release-candidate-build=$RUN_ID" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 0:0 --memory 256m --memory-swap 320m --cpus 1 --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
  -v "$SITE_ROOT:/workspace:ro" -v "$INPUT_ROOT:/input:ro" -v "$ARTIFACT_ROOT:/artifact:rw" --entrypoint /usr/local/bin/node "$NODE_IMAGE" \
  /workspace/scripts/release-candidate-build-producer.mjs create --site-root /workspace --artifact-root /artifact --run-id "$RUN_ID" --git-commit "$GIT_COMMIT" --git-tree "$GIT_TREE" \
  --archive-sha256 "$ARCHIVE_SHA256" --archive-bytes "$ARCHIVE_BYTES" --migration-allowlist-sha256 "$MIGRATION_ALLOWLIST_SHA256" \
  --build-base-inspect /input/build-base.inspect.json --runtime-base-inspect /input/runtime-base.inspect.json --registry-inspect /input/registry.inspect.json --web-inspect /input/web.inspect.json --worker-inspect /input/worker.inspect.json \
  --web-image-reference "$WEB_IMAGE_REF" --worker-image-reference "$WORKER_IMAGE_REF" --docker-server-version "$DOCKER_SERVER_VERSION" --buildx-version "$BUILDX_VERSION" --builder-driver "$BUILDER_DRIVER" --buildkit-version "$BUILDKIT_VERSION" --confirm CREATE_LOCAL_CANDIDATE_BUILD_PROVENANCE)
set +e
PRODUCER_OUTPUT=$(/usr/bin/docker start --attach "$CONTAINER_ID")
PRODUCER_STATUS=$?
set -e
remove_container
[ "$PRODUCER_STATUS" -eq 0 ] && [ -n "$PRODUCER_OUTPUT" ] || { echo "candidate build provenance creation failed" >&2; exit 1; }
[ -f "$ARTIFACT_ROOT/$RUN_ID.build-provenance.json" ] && [ ! -L "$ARTIFACT_ROOT/$RUN_ID.build-provenance.json" ] && [ "$(stat -c '%u:%g:%a:%h' "$ARTIFACT_ROOT/$RUN_ID.build-provenance.json")" = "0:0:440:1" ] || { echo "candidate build provenance artifact is invalid" >&2; exit 1; }

git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "candidate source identity changed during build" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked build-context files appeared during build" >&2; exit 1; }
/usr/bin/docker image inspect "$WEB_IMAGE_REF" >/dev/null 2>&1 && /usr/bin/docker image inspect "$WORKER_IMAGE_REF" >/dev/null 2>&1 || { echo "candidate digest references are no longer available locally" >&2; exit 1; }
SUCCESS=YES
printf '%s\n' "$PRODUCER_OUTPUT"
