#!/bin/sh
set -eu
set -f
umask 077
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/nonexistent
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null
GIT_NO_REPLACE_OBJECTS=1
export LC_ALL PATH HOME GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL GIT_NO_REPLACE_OBJECTS

TRIVY_IMAGE='ghcr.io/aquasecurity/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c'
NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'

usage() {
  echo "usage: $0 --repository-root DIR --git-commit COMMIT --git-tree TREE --candidate-snapshot-receipt FILE --candidate-snapshot-receipt-sha256 SHA256 --test-runtime-root DIR --artifact-root DIR --run-id ID --web-image REF --worker-image REF --trivy-db-directory DIR --confirm CREATE_TRIVY_IMAGE_EVIDENCE" >&2
  exit 2
}

REPOSITORY_ROOT=""; GIT_COMMIT=""; GIT_TREE=""; CANDIDATE_SNAPSHOT_RECEIPT=""; CANDIDATE_SNAPSHOT_RECEIPT_SHA256=""; TEST_RUNTIME_ROOT=""; ARTIFACT_ROOT=""; RUN_ID=""; WEB_IMAGE=""; WORKER_IMAGE=""; TRIVY_DB_DIRECTORY=""; CONFIRM=""
TEMP_ROOT=""; CONTAINER_ID=""; CONTAINER_NAME=""; NODE_RUNTIME=""

remove_container() {
  if [ -z "$CONTAINER_ID" ] && [ -n "$CONTAINER_NAME" ]; then CONTAINER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$CONTAINER_NAME" 2>/dev/null || true); fi
  [ -n "$CONTAINER_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-image-evidence"}}|{{index .Config.Labels "chenyida.erp.release-authorization"}}|{{.Name}}' "$CONTAINER_ID" 2>/dev/null || true)" = "$RUN_ID|$AUTHORIZATION_SHA256|/$CONTAINER_NAME" ] || { echo "refusing to remove a container not owned by this evidence authorization" >&2; return 1; }
  /usr/bin/docker rm -f "$CONTAINER_ID" >/dev/null
  CONTAINER_ID=""
}

cleanup() {
  status=0
  remove_container >/dev/null 2>&1 || status=1
  if [ -n "$TEMP_ROOT" ]; then
    case "$TEMP_ROOT" in /tmp/chenyida-erp-release-image-evidence.*) rm -rf -- "$TEMP_ROOT" || status=1 ;; *) status=1 ;; esac
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
    --candidate-snapshot-receipt) CANDIDATE_SNAPSHOT_RECEIPT=${2:-}; shift 2 ;;
    --candidate-snapshot-receipt-sha256) CANDIDATE_SNAPSHOT_RECEIPT_SHA256=${2:-}; shift 2 ;;
    --test-runtime-root) TEST_RUNTIME_ROOT=${2:-}; shift 2 ;;
    --artifact-root) ARTIFACT_ROOT=${2:-}; shift 2 ;;
    --run-id) RUN_ID=${2:-}; shift 2 ;;
    --web-image) WEB_IMAGE=${2:-}; shift 2 ;;
    --worker-image) WORKER_IMAGE=${2:-}; shift 2 ;;
    --trivy-db-directory) TRIVY_DB_DIRECTORY=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
for value in "$REPOSITORY_ROOT" "$GIT_COMMIT" "$GIT_TREE" "$CANDIDATE_SNAPSHOT_RECEIPT" "$CANDIDATE_SNAPSHOT_RECEIPT_SHA256" "$TEST_RUNTIME_ROOT" "$ARTIFACT_ROOT" "$RUN_ID" "$WEB_IMAGE" "$WORKER_IMAGE" "$TRIVY_DB_DIRECTORY" "$CONFIRM"; do [ -n "$value" ] || usage; done

[ "$(id -u)" = 0 ] || { echo "release image evidence creation requires root" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "release image evidence must be launched by the installed supervisor" >&2; exit 1; }
[ "$CONFIRM" = CREATE_TRIVY_IMAGE_EVIDENCE ] || { echo "release image evidence confirmation is invalid" >&2; exit 1; }
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "release image evidence run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "release image evidence run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "release image evidence run ID is invalid" >&2; exit 1; }
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
[ "$(basename "$BUNDLE_ROOT")" = "$SUPERVISOR_BUNDLE_SHA256" ] || { echo "release supervisor bundle path is invalid" >&2; exit 1; }
case "$BUNDLE_ROOT" in /usr/local/libexec/chenyida-erp-release-supervisor/bundles/*) : ;; *) echo "release supervisor is not installed in the trusted root" >&2; exit 1 ;; esac

verify_candidate_snapshot() {
  output=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC HOME=/nonexistent PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
    ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_GATE_LOCK_FD="${ERP_RELEASE_GATE_LOCK_FD:-}" \
    /usr/bin/python3 "$SCRIPT_DIR/release-candidate-snapshot.py" verify \
    --receipt "$CANDIDATE_SNAPSHOT_RECEIPT" --receipt-sha256 "$CANDIDATE_SNAPSHOT_RECEIPT_SHA256" \
    --repository-root "$REPOSITORY_ROOT" --git-commit "$GIT_COMMIT" --git-tree "$GIT_TREE" \
    --test-runtime-root "$TEST_RUNTIME_ROOT" --bundle-root "$BUNDLE_ROOT" --confirm VERIFY_EXACT_RELEASE_CANDIDATE_SNAPSHOT) || return 1
  case "$output" in *"\"receipt_sha256\":\"$CANDIDATE_SNAPSHOT_RECEIPT_SHA256\""*"\"result\":\"VERIFIED\""*"\"snapshot_id\":\""*) return 0 ;; *) return 1 ;; esac
}

REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
ARTIFACT_PARENT=$(readlink -f "$(dirname -- "$ARTIFACT_ROOT")")
ARTIFACT_ROOT="$ARTIFACT_PARENT/$(basename -- "$ARTIFACT_ROOT")"
TRIVY_DB_DIRECTORY=$(readlink -f "$TRIVY_DB_DIRECTORY")
[ "$(/usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is invalid" >&2; exit 1; }
case "$ARTIFACT_ROOT" in /*) : ;; *) echo "artifact root must be absolute" >&2; exit 1 ;; esac
[ -d "$TRIVY_DB_DIRECTORY" ] && [ ! -L "$TRIVY_DB_DIRECTORY" ] || { echo "trusted Trivy database directory is invalid" >&2; exit 1; }
case "$ARTIFACT_ROOT/" in "$REPOSITORY_ROOT/"*) echo "release artifacts must be outside the repository" >&2; exit 1 ;; esac
case "$TRIVY_DB_DIRECTORY/" in "$REPOSITORY_ROOT/"*) echo "trusted Trivy database must be outside the repository" >&2; exit 1 ;; esac

for image in "$WEB_IMAGE" "$WORKER_IMAGE"; do
  case "$image" in [A-Za-z0-9]*) : ;; *) echo "release image reference is invalid" >&2; exit 1 ;; esac
  case "$image" in *[!A-Za-z0-9._/@:-]*) echo "release image reference is invalid" >&2; exit 1 ;; esac
  case "$image" in *@sha256:*) image_hex=${image##*@sha256:} ;; *) echo "release image must use a registry digest reference" >&2; exit 1 ;; esac
  case "$image_hex" in *[!0-9a-f]*|'') echo "release registry digest is invalid" >&2; exit 1 ;; esac
  [ "${#image_hex}" -eq 64 ] || { echo "release registry digest is invalid" >&2; exit 1; }
done
[ "$WEB_IMAGE" != "$WORKER_IMAGE" ] || { echo "Web and Worker image references must be distinct" >&2; exit 1; }

case "$GIT_COMMIT$GIT_TREE" in *[!0-9a-f]*|'') echo "authorized Git identity is invalid" >&2; exit 1 ;; esac
[ "${#GIT_COMMIT}" -eq 40 ] && [ "${#GIT_TREE}" -eq 40 ] || { echo "authorized Git identity is invalid" >&2; exit 1; }
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source does not match the authorized Git identity" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files block image evidence creation" >&2; exit 1; }
verify_candidate_snapshot || { echo "release candidate snapshot verification failed" >&2; exit 1; }

if [ ! -e "$ARTIFACT_ROOT" ]; then install -d -m 0750 -o root -g root "$ARTIFACT_ROOT"; fi
[ -d "$ARTIFACT_ROOT" ] && [ ! -L "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$ARTIFACT_ROOT")" = "$ARTIFACT_ROOT" ] && [ "$(stat -c '%u:%g:%a' "$ARTIFACT_ROOT")" = "0:0:750" ] || { echo "artifact root is invalid" >&2; exit 1; }
MARKER="$ARTIFACT_ROOT/.chenyida-erp-release-artifact-root-v1"
if [ ! -e "$MARKER" ]; then
  (umask 337; set -C; printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$MARKER")
  chown root:root "$MARKER"; chmod 0440 "$MARKER"; sync -f "$ARTIFACT_ROOT"
fi
[ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$MARKER")" = "0:0:440:1" ] && [ "$(cat "$MARKER")" = chenyida-erp-release-artifact-root/v1 ] || { echo "artifact root marker is invalid" >&2; exit 1; }
for suffix in trivy.inspect trivy.version trivy-db.metadata web.inspect web.trivy web.cdx worker.inspect worker.trivy worker.cdx image-scan-provenance sbom-evidence security-report security-evidence; do
  [ ! -e "$ARTIFACT_ROOT/$RUN_ID.$suffix.json" ] || { echo "release image evidence artifact already exists" >&2; exit 1; }
done
BUILD_PROVENANCE="$ARTIFACT_ROOT/$RUN_ID.build-provenance.json"
[ -f "$BUILD_PROVENANCE" ] && [ ! -L "$BUILD_PROVENANCE" ] && [ "$(readlink -f "$(dirname -- "$BUILD_PROVENANCE")")" = "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$BUILD_PROVENANCE")" = "$BUILD_PROVENANCE" ] && [ "$(stat -c '%u:%g:%a:%h' "$BUILD_PROVENANCE")" = "0:0:440:1" ] || { echo "candidate build provenance is missing or untrusted" >&2; exit 1; }

LOCK_HELPER="$SCRIPT_DIR/release-gate-lock.sh"
[ -f "$LOCK_HELPER" ] && [ ! -L "$LOCK_HELPER" ] || { echo "release operation lock helper is untrusted" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$LOCK_HELPER"
acquire_chenyida_release_gate_lock || exit 1
CONTAINER_NAME="cyd-release-image-evidence-$AUTHORIZATION_SHA256"

/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned Node tooling image is unavailable; pulling is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$TRIVY_IMAGE" >/dev/null 2>&1 || { echo "pinned Trivy image is unavailable; pulling is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$WEB_IMAGE" >/dev/null 2>&1 || { echo "Web image is unavailable locally; pulling is forbidden" >&2; exit 1; }
/usr/bin/docker image inspect "$WORKER_IMAGE" >/dev/null 2>&1 || { echo "Worker image is unavailable locally; pulling is forbidden" >&2; exit 1; }

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-release-image-evidence.XXXXXX)
INPUT_ROOT="$TEMP_ROOT/inputs"; OUTPUT_ROOT="$TEMP_ROOT/outputs"
mkdir -m 0700 "$INPUT_ROOT" "$OUTPUT_ROOT"

CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" --label "chenyida.erp.release-image-evidence=$RUN_ID" --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" --network none --entrypoint /bin/true "$NODE_IMAGE")
/usr/bin/docker cp "$CONTAINER_ID:/usr/local/bin/node" "$TEMP_ROOT/node"
remove_container
chmod 0755 "$TEMP_ROOT/node"
NODE_RUNTIME="$TEMP_ROOT/node"

sanitize_inspect() {
  image=$1; output=$2
  IMAGE_REFERENCE="$image" /usr/bin/docker image inspect -- "$image" | IMAGE_REFERENCE="$image" "$NODE_RUNTIME" --input-type=module -e 'const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const rows=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!Array.isArray(rows)||rows.length!==1)process.exit(1);const row=rows[0],manifest=process.env.IMAGE_REFERENCE.slice(process.env.IMAGE_REFERENCE.lastIndexOf("@")+1);if(!/^sha256:[0-9a-f]{64}$/.test(manifest)||row.Id!==manifest||row?.Descriptor?.digest!==manifest||row.Os!=="linux"||row.Architecture!=="amd64"||!Array.isArray(row.RepoDigests)||!row.RepoDigests.includes(process.env.IMAGE_REFERENCE))process.exit(1);process.stdout.write(JSON.stringify([{Id:row.Id,Os:row.Os,Architecture:row.Architecture,RepoDigests:[process.env.IMAGE_REFERENCE]}])+"\n");' > "$output"
  chmod 0440 "$output"
}

sanitize_inspect "$TRIVY_IMAGE" "$INPUT_ROOT/trivy.inspect.json"
sanitize_inspect "$WEB_IMAGE" "$INPUT_ROOT/web.inspect.json"
sanitize_inspect "$WORKER_IMAGE" "$INPUT_ROOT/worker.inspect.json"
SCANNER_IMAGE_DIGEST=$(IMAGE_FILE="$INPUT_ROOT/trivy.inspect.json" "$NODE_RUNTIME" --input-type=module -e 'import{readFileSync}from"node:fs";process.stdout.write(JSON.parse(readFileSync(process.env.IMAGE_FILE,"utf8"))[0].Id)')
WEB_IMAGE_DIGEST=$(IMAGE_FILE="$INPUT_ROOT/web.inspect.json" "$NODE_RUNTIME" --input-type=module -e 'import{readFileSync}from"node:fs";process.stdout.write(JSON.parse(readFileSync(process.env.IMAGE_FILE,"utf8"))[0].Id)')
WORKER_IMAGE_DIGEST=$(IMAGE_FILE="$INPUT_ROOT/worker.inspect.json" "$NODE_RUNTIME" --input-type=module -e 'import{readFileSync}from"node:fs";process.stdout.write(JSON.parse(readFileSync(process.env.IMAGE_FILE,"utf8"))[0].Id)')
[ "$WEB_IMAGE_DIGEST" != "$WORKER_IMAGE_DIGEST" ] || { echo "Web and Worker image manifests must be distinct" >&2; exit 1; }

CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" --label "chenyida.erp.release-image-evidence=$RUN_ID" --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" --network none --entrypoint /bin/true "$TRIVY_IMAGE")
/usr/bin/docker cp "$CONTAINER_ID:/usr/local/bin/trivy" "$TEMP_ROOT/trivy"
remove_container
SCANNER_BINARY_SHA256=$(sha256sum "$TEMP_ROOT/trivy" | cut -d ' ' -f 1)

CONTAINER_ID=$(/usr/bin/docker create --pull=never --name "$CONTAINER_NAME" --label "chenyida.erp.release-image-evidence=$RUN_ID" --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 0:0 --memory 256m --memory-swap 320m --cpus 1 --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m --tmpfs /root:rw,nosuid,nodev,noexec,size=16m --entrypoint /usr/local/bin/trivy "$TRIVY_IMAGE" version --format json)
set +e
/usr/bin/docker start --attach "$CONTAINER_ID" > "$INPUT_ROOT/trivy.version.json"
SCAN_STATUS=$?
set -e
remove_container
[ "$SCAN_STATUS" -eq 0 ] && [ -s "$INPUT_ROOT/trivy.version.json" ] || { echo "pinned Trivy version capture failed" >&2; exit 1; }
chmod 0440 "$INPUT_ROOT/trivy.version.json"

DATABASE_TREE_SHA256=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC "$NODE_RUNTIME" "$SCRIPT_DIR/release-image-evidence-producer.mjs" hash-database-tree --root "$TRIVY_DB_DIRECTORY")
install -m 0440 -o root -g root "$TRIVY_DB_DIRECTORY/metadata.json" "$INPUT_ROOT/trivy-db.metadata.json"

PACKAGE_VERSION=$(PACKAGE_FILE="$REPOSITORY_ROOT/chenyida_erp_site/package.json" "$NODE_RUNTIME" --input-type=module -e 'import{readFileSync}from"node:fs";const value=JSON.parse(readFileSync(process.env.PACKAGE_FILE,"utf8"));if(typeof value.version!=="string")process.exit(1);process.stdout.write(value.version)')
MIGRATION_ALLOWLIST_SHA256=$(CDPATH= cd -- "$SUPERVISOR_SITE_ROOT" && env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC "$NODE_RUNTIME" --input-type=module -e 'import{buildMigrationAllowlist,migrationAllowlistDigest}from"./scripts/release-manifest-contract.mjs";process.stdout.write(migrationAllowlistDigest(await buildMigrationAllowlist(process.argv[1])))' "$REPOSITORY_ROOT/chenyida_erp_site/drizzle-postgres")
build_target_config_digest() {
  SERVICE="$1" BUILD_PROVENANCE="$BUILD_PROVENANCE" "$NODE_RUNTIME" --input-type=module -e 'import{readFileSync}from"node:fs";const value=JSON.parse(readFileSync(process.env.BUILD_PROVENANCE,"utf8")),targets=value?.targets?.filter((target)=>target?.service===process.env.SERVICE);if(!targets||targets.length!==1||!/^sha256:[0-9a-f]{64}$/.test(targets[0].image_config_digest||""))process.exit(1);process.stdout.write(targets[0].image_config_digest)'
}
WEB_CONFIG_DIGEST=$(build_target_config_digest web)
WORKER_CONFIG_DIGEST=$(build_target_config_digest worker)
[ "$WEB_CONFIG_DIGEST" != "$WORKER_CONFIG_DIGEST" ] || { echo "Web and Worker image configurations must be distinct" >&2; exit 1; }

archive_config_identity() {
  /usr/bin/tar -xOf "$1" manifest.json | "$NODE_RUNTIME" --input-type=module -e 'const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const rows=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!Array.isArray(rows)||rows.length!==1||typeof rows[0].Config!=="string")process.exit(1);const file=rows[0].Config,match=/^([0-9a-f]{64})\.json$/.exec(file)||/^blobs\/sha256\/([0-9a-f]{64})$/.exec(file);if(!match)process.exit(1);process.stdout.write(`${file}|sha256:${match[1]}`)'
}

run_trivy_scan() {
  archive=$1; output_name=$2; format=$3; exit_code=$4
  CONTAINER_ID=$(/usr/bin/docker create \
    --pull=never \
    --name "$CONTAINER_NAME" \
    --label "chenyida.erp.release-image-evidence=$RUN_ID" \
    --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 0:0 \
    --memory 768m --memory-swap 896m --cpus 1 --pids-limit 256 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m --tmpfs /root:rw,nosuid,nodev,noexec,size=32m --tmpfs /trivy-cache:rw,nosuid,nodev,noexec,size=256m \
    -v "$TRIVY_DB_DIRECTORY:/trivy-cache/db:ro" -v "$archive:/input/image.tar:ro" -v "$OUTPUT_ROOT:/output:rw" \
    --entrypoint /usr/local/bin/trivy "$TRIVY_IMAGE" image --input /input/image.tar --cache-dir /trivy-cache \
    --scanners vuln --pkg-types os,library --list-all-pkgs --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
    --exit-code "$exit_code" --format "$format" --output "/output/$output_name" \
    --skip-db-update --skip-java-db-update --skip-check-update --skip-vex-repo-update --skip-version-check \
    --offline-scan --disable-telemetry --no-progress --config /dev/null --ignorefile /dev/null)
  set +e
  /usr/bin/docker start --attach "$CONTAINER_ID"
  SCAN_STATUS=$?
  set -e
  remove_container
  [ "$SCAN_STATUS" -eq 0 ] && [ -s "$OUTPUT_ROOT/$output_name" ] || { echo "Trivy $format scan failed closed" >&2; exit 1; }
  chmod 0440 "$OUTPUT_ROOT/$output_name"
}

for service in web worker; do
  if [ "$service" = web ]; then image=$WEB_IMAGE; expected_config=$WEB_CONFIG_DIGEST; else image=$WORKER_IMAGE; expected_config=$WORKER_CONFIG_DIGEST; fi
  archive="$INPUT_ROOT/$service.tar"
  /usr/bin/docker image save --output "$archive" "$image"
  chmod 0400 "$archive"
  archive_sha256=$(sha256sum "$archive" | cut -d ' ' -f 1)
  archive_bytes=$(stat -c '%s' "$archive")
  archive_config_identity=$(archive_config_identity "$archive")
  archive_config_path=${archive_config_identity%%|*}
  archive_config=${archive_config_identity#*|}
  [ "sha256:$(/usr/bin/tar -xOf "$archive" "$archive_config_path" | sha256sum | cut -d ' ' -f 1)" = "$archive_config" ] || { echo "$service archive configuration blob digest mismatch" >&2; exit 1; }
  [ "$archive_config" = "$expected_config" ] || { echo "$service archive configuration does not match the inspected image" >&2; exit 1; }
  run_trivy_scan "$archive" "$service.trivy.json" json 1
  run_trivy_scan "$archive" "$service.cdx.json" cyclonedx 0
  if [ "$service" = web ]; then
    web_archive_sha256=$archive_sha256; web_archive_bytes=$archive_bytes; web_archive_config=$archive_config
  else
    worker_archive_sha256=$archive_sha256; worker_archive_bytes=$archive_bytes; worker_archive_config=$archive_config
  fi
  rm -f -- "$archive"
done

[ "$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC "$NODE_RUNTIME" "$SCRIPT_DIR/release-image-evidence-producer.mjs" hash-database-tree --root "$TRIVY_DB_DIRECTORY")" = "$DATABASE_TREE_SHA256" ] || { echo "Trivy database changed during the scan" >&2; exit 1; }
sanitize_inspect "$TRIVY_IMAGE" "$INPUT_ROOT/trivy.inspect.final.json"
sanitize_inspect "$WEB_IMAGE" "$INPUT_ROOT/web.inspect.final.json"
sanitize_inspect "$WORKER_IMAGE" "$INPUT_ROOT/worker.inspect.final.json"
for service in trivy web worker; do cmp -s "$INPUT_ROOT/$service.inspect.json" "$INPUT_ROOT/$service.inspect.final.json" || { echo "$service image identity changed during the scan" >&2; exit 1; }; done
git_candidate diff --quiet --no-ext-diff --no-textconv --
git_candidate diff --cached --quiet --no-ext-diff --no-textconv --
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source identity changed during the scan" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked candidate files appeared during the scan" >&2; exit 1; }
verify_candidate_snapshot || { echo "release candidate snapshot changed during the scan" >&2; exit 1; }

env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC "$NODE_RUNTIME" "$SCRIPT_DIR/release-image-evidence-producer.mjs" create \
  --artifact-root "$ARTIFACT_ROOT" --run-id "$RUN_ID" --git-commit "$GIT_COMMIT" --git-tree "$GIT_TREE" --package-version "$PACKAGE_VERSION" --migration-allowlist-sha256 "$MIGRATION_ALLOWLIST_SHA256" \
  --web-image-reference "$WEB_IMAGE" --web-image-digest "$WEB_IMAGE_DIGEST" --worker-image-reference "$WORKER_IMAGE" --worker-image-digest "$WORKER_IMAGE_DIGEST" \
  --build-provenance "$BUILD_PROVENANCE" \
  --supervisor-bundle-sha256 "$SUPERVISOR_BUNDLE_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" \
  --scanner-image-digest "$SCANNER_IMAGE_DIGEST" --scanner-binary-sha256 "$SCANNER_BINARY_SHA256" --scanner-inspect "$INPUT_ROOT/trivy.inspect.json" --scanner-version "$INPUT_ROOT/trivy.version.json" \
  --database-metadata "$INPUT_ROOT/trivy-db.metadata.json" --database-payload-tree-sha256 "$DATABASE_TREE_SHA256" \
  --web-inspect "$INPUT_ROOT/web.inspect.json" --web-archive-sha256 "$web_archive_sha256" --web-archive-bytes "$web_archive_bytes" --web-archive-config-digest "$web_archive_config" --web-vulnerability "$OUTPUT_ROOT/web.trivy.json" --web-cyclonedx "$OUTPUT_ROOT/web.cdx.json" \
  --worker-inspect "$INPUT_ROOT/worker.inspect.json" --worker-archive-sha256 "$worker_archive_sha256" --worker-archive-bytes "$worker_archive_bytes" --worker-archive-config-digest "$worker_archive_config" --worker-vulnerability "$OUTPUT_ROOT/worker.trivy.json" --worker-cyclonedx "$OUTPUT_ROOT/worker.cdx.json" \
  --confirm CREATE_TRIVY_IMAGE_EVIDENCE
