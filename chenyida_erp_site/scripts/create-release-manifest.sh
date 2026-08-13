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

usage() {
  echo "usage: $0 --repository-root DIR --git-commit COMMIT --git-tree TREE --artifact-root DIR --release-id ID --deployment-class UAT|PRODUCTION --runtime-guard-contract chenyida-erp-release-runtime-guard/v1 --runtime-guard-mode PRE_DEPLOY_EXISTING_RUNTIME_STABILITY --gate-plan-sha256 SHA256 --web-image REF --worker-image REF --gate-plan FILE --gate-report FILE --sbom-evidence FILE --security-evidence FILE --expires-at UTC --confirm CREATE_IMMUTABLE_RELEASE_MANIFEST" >&2
  exit 2
}

REPOSITORY_ROOT=""; GIT_COMMIT=""; GIT_TREE=""; ARTIFACT_ROOT=""; RELEASE_ID=""; DEPLOYMENT_CLASS=""; RUNTIME_GUARD_CONTRACT=""; RUNTIME_GUARD_MODE=""; GATE_PLAN_SHA256=""; WEB_IMAGE=""; WORKER_IMAGE=""; GATE_PLAN=""; GATE_REPORT=""; SBOM_EVIDENCE=""; SECURITY_EVIDENCE=""; EXPIRES_AT=""; CONFIRM=""
NODE_RUNTIME_ROOT=""; NODE_BOOTSTRAP_ID=""; NODE_BOOTSTRAP_NAME=""; NODE_RUNTIME=""
PREPARED_MANIFEST=""; PREPARED_MANIFEST_SHA256=""

remove_node_bootstrap() {
  if [ -z "$NODE_BOOTSTRAP_ID" ] && [ -n "$NODE_BOOTSTRAP_NAME" ]; then NODE_BOOTSTRAP_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$NODE_BOOTSTRAP_NAME" 2>/dev/null || true); fi
  [ -n "$NODE_BOOTSTRAP_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-manifest-node-bootstrap"}}|{{index .Config.Labels "chenyida.erp.release-authorization"}}|{{.Name}}' "$NODE_BOOTSTRAP_ID" 2>/dev/null || true)" = "$RELEASE_ID|$AUTHORIZATION_SHA256|/$NODE_BOOTSTRAP_NAME" ] || { echo "refusing to remove an unowned Node bootstrap container" >&2; return 1; }
  /usr/bin/docker rm -f "$NODE_BOOTSTRAP_ID" >/dev/null
  NODE_BOOTSTRAP_ID=""
}

discard_prepared_manifest() {
  [ -n "$PREPARED_MANIFEST" ] || return 0
  if [ ! -e "$PREPARED_MANIFEST" ]; then PREPARED_MANIFEST=""; PREPARED_MANIFEST_SHA256=""; return 0; fi
  [ -n "$NODE_RUNTIME" ] && [ -n "$PREPARED_MANIFEST_SHA256" ] || return 1
  env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" "$NODE_RUNTIME" "$SCRIPT_DIR/release-manifest-contract.mjs" discard-manifest \
    --artifact-root "$ARTIFACT_ROOT" --prepared "$PREPARED_MANIFEST" --expected-sha256 "$PREPARED_MANIFEST_SHA256" --confirm DISCARD_UNPUBLISHED_RELEASE_MANIFEST >/dev/null
  PREPARED_MANIFEST=""; PREPARED_MANIFEST_SHA256=""
}

cleanup() {
  status=0
  discard_prepared_manifest >/dev/null 2>&1 || status=1
  remove_node_bootstrap >/dev/null 2>&1 || status=1
  if [ -n "$NODE_RUNTIME_ROOT" ]; then case "$NODE_RUNTIME_ROOT" in /tmp/chenyida-erp-release-manifest-node.*) rm -rf -- "$NODE_RUNTIME_ROOT" || status=1 ;; *) status=1 ;; esac; fi
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
    --release-id) RELEASE_ID=${2:-}; shift 2 ;;
    --deployment-class) DEPLOYMENT_CLASS=${2:-}; shift 2 ;;
    --runtime-guard-contract) RUNTIME_GUARD_CONTRACT=${2:-}; shift 2 ;;
    --runtime-guard-mode) RUNTIME_GUARD_MODE=${2:-}; shift 2 ;;
    --gate-plan-sha256) GATE_PLAN_SHA256=${2:-}; shift 2 ;;
    --web-image) WEB_IMAGE=${2:-}; shift 2 ;;
    --worker-image) WORKER_IMAGE=${2:-}; shift 2 ;;
    --gate-plan) GATE_PLAN=${2:-}; shift 2 ;;
    --gate-report) GATE_REPORT=${2:-}; shift 2 ;;
    --sbom-evidence) SBOM_EVIDENCE=${2:-}; shift 2 ;;
    --security-evidence) SECURITY_EVIDENCE=${2:-}; shift 2 ;;
    --expires-at) EXPIRES_AT=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
for value in "$REPOSITORY_ROOT" "$GIT_COMMIT" "$GIT_TREE" "$ARTIFACT_ROOT" "$RELEASE_ID" "$DEPLOYMENT_CLASS" "$RUNTIME_GUARD_CONTRACT" "$RUNTIME_GUARD_MODE" "$GATE_PLAN_SHA256" "$WEB_IMAGE" "$WORKER_IMAGE" "$GATE_PLAN" "$GATE_REPORT" "$SBOM_EVIDENCE" "$SECURITY_EVIDENCE" "$EXPIRES_AT" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$(id -u)" = 0 ] || { echo "release manifest creation requires root" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "release manifest creation must be launched by the installed supervisor" >&2; exit 1; }
[ "$CONFIRM" = CREATE_IMMUTABLE_RELEASE_MANIFEST ] || { echo "release manifest confirmation is invalid" >&2; exit 1; }
[ "$RUNTIME_GUARD_CONTRACT" = chenyida-erp-release-runtime-guard/v1 ] && [ "$RUNTIME_GUARD_MODE" = PRE_DEPLOY_EXISTING_RUNTIME_STABILITY ] || { echo "release manifest runtime guard is invalid" >&2; exit 1; }
case "$GATE_PLAN_SHA256" in *[!0-9a-f]*|'') echo "release gate plan digest is invalid" >&2; exit 1 ;; esac
[ "${#GATE_PLAN_SHA256}" -eq 64 ] || { echo "release gate plan digest is invalid" >&2; exit 1; }
case "$DEPLOYMENT_CLASS" in UAT|PRODUCTION) : ;; *) echo "deployment class is invalid" >&2; exit 1 ;; esac
case "$RELEASE_ID" in [A-Za-z0-9]*) : ;; *) echo "release ID is invalid" >&2; exit 1 ;; esac
case "$RELEASE_ID" in *[!A-Za-z0-9._-]*) echo "release ID is invalid" >&2; exit 1 ;; esac
[ "${#RELEASE_ID}" -le 120 ] || { echo "release ID is invalid" >&2; exit 1; }
for image in "$WEB_IMAGE" "$WORKER_IMAGE"; do
  case "$image" in [A-Za-z0-9]*) : ;; *) echo "release image reference is invalid" >&2; exit 1 ;; esac
  case "$image" in *[!A-Za-z0-9._/@:-]*) echo "release image reference is invalid" >&2; exit 1 ;; esac
  case "$image" in *@sha256:*) image_hex=${image##*@sha256:} ;; *) echo "release image must use a registry digest reference" >&2; exit 1 ;; esac
  case "$image_hex" in *[!0-9a-f]*|'') echo "release registry digest is invalid" >&2; exit 1 ;; esac
  [ "${#image_hex}" -eq 64 ] || { echo "release registry digest is invalid" >&2; exit 1; }
done
case "$ARTIFACT_ROOT" in /*) : ;; *) echo "artifact root must be absolute" >&2; exit 1 ;; esac
for file in "$GATE_PLAN" "$GATE_REPORT" "$SBOM_EVIDENCE" "$SECURITY_EVIDENCE"; do case "$file" in /*) : ;; *) echo "release evidence paths must be absolute" >&2; exit 1 ;; esac; done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor site root mismatch" >&2; exit 1; }
BUNDLE_ROOT=$(CDPATH= cd -- "$SUPERVISOR_SITE_ROOT/.." && pwd -P)
SUPERVISOR_BUNDLE_SHA256=${ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256:-}
AUTHORIZATION_SHA256=${ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256:-}
for digest in "$SUPERVISOR_BUNDLE_SHA256" "$AUTHORIZATION_SHA256"; do case "$digest" in *[!0-9a-f]*|'') echo "release supervisor digest is invalid" >&2; exit 1 ;; esac; [ "${#digest}" -eq 64 ] || { echo "release supervisor digest is invalid" >&2; exit 1; }; done
[ "$(basename "$BUNDLE_ROOT")" = "$SUPERVISOR_BUNDLE_SHA256" ] || { echo "release supervisor bundle path is invalid" >&2; exit 1; }
case "$BUNDLE_ROOT" in /usr/local/libexec/chenyida-erp-release-supervisor/bundles/*) : ;; *) echo "release supervisor is not installed in the trusted root" >&2; exit 1 ;; esac
REPOSITORY_ROOT=$(readlink -f "$REPOSITORY_ROOT")
[ "$(/usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" rev-parse --show-toplevel)" = "$REPOSITORY_ROOT" ] || { echo "release repository root is ambiguous" >&2; exit 1; }
case "$GIT_COMMIT$GIT_TREE" in *[!0-9a-f]*|'') echo "authorized Git identity is invalid" >&2; exit 1 ;; esac
[ "${#GIT_COMMIT}" -eq 40 ] && [ "${#GIT_TREE}" -eq 40 ] || { echo "release Git identity is invalid" >&2; exit 1; }
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source does not match the authorized Git identity" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv -- || { echo "tracked worktree changes block release manifest creation" >&2; exit 1; }
git_candidate diff --cached --quiet --no-ext-diff --no-textconv -- || { echo "staged changes block release manifest creation" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked build-context files block release manifest creation" >&2; exit 1; }
case "$ARTIFACT_ROOT/" in "$REPOSITORY_ROOT/"*) echo "release artifacts must be outside the repository" >&2; exit 1 ;; esac

if [ ! -e "$ARTIFACT_ROOT" ]; then install -d -m 0750 -o root -g root "$ARTIFACT_ROOT"; fi
[ -d "$ARTIFACT_ROOT" ] && [ ! -L "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$ARTIFACT_ROOT")" = "$ARTIFACT_ROOT" ] || { echo "artifact root is invalid" >&2; exit 1; }
[ "$(stat -c '%u:%g:%a' "$ARTIFACT_ROOT")" = "0:0:750" ] || { echo "artifact root ownership or mode is invalid" >&2; exit 1; }
MARKER="$ARTIFACT_ROOT/.chenyida-erp-release-artifact-root-v1"
if [ ! -e "$MARKER" ]; then
  (umask 337; set -C; printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$MARKER")
  chown root:root "$MARKER"; chmod 0440 "$MARKER"; sync -f "$ARTIFACT_ROOT"
fi
[ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$MARKER")" = "0:0:440:1" ] && [ "$(cat "$MARKER")" = chenyida-erp-release-artifact-root/v1 ] || { echo "artifact root marker is invalid" >&2; exit 1; }
for file in "$GATE_PLAN" "$GATE_REPORT" "$SBOM_EVIDENCE" "$SECURITY_EVIDENCE"; do
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(readlink -f "$(dirname -- "$file")")" = "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$file")" = "$file" ] && [ "$(stat -c '%u:%g:%a:%h' "$file")" = "0:0:440:1" ] || { echo "release evidence file is outside the trusted root or has unsafe metadata" >&2; exit 1; }
done
[ "$(sha256sum -- "$GATE_PLAN" | cut -d ' ' -f 1)" = "$GATE_PLAN_SHA256" ] || { echo "gate plan does not match the authorization" >&2; exit 1; }
[ ! -e "$ARTIFACT_ROOT/release-manifest.json" ] || { echo "release manifest already exists" >&2; exit 1; }
PREPARED_MANIFEST="$ARTIFACT_ROOT/.release-manifest.$AUTHORIZATION_SHA256.prepared.json"
[ ! -e "$PREPARED_MANIFEST" ] || { echo "prepared release manifest already exists" >&2; PREPARED_MANIFEST=""; exit 1; }

LOCK_FILE=/var/lock/chenyida-erp-release-gate-v1.lock
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] && [ "$(stat -c '%u:%g:%a:%h' "$LOCK_FILE")" = "0:0:600:1" ] || { echo "release gate lock is untrusted" >&2; exit 1; }
exec 9<>"$LOCK_FILE"
flock -n 9 || { echo "another release operation is active" >&2; exit 1; }
ERP_RELEASE_GATE_LOCK_HELD=YES; export ERP_RELEASE_GATE_LOCK_HELD
NODE_BOOTSTRAP_NAME="cyd-release-manifest-node-$AUTHORIZATION_SHA256"

NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned release tooling image is unavailable; pulling is forbidden" >&2; exit 1; }
NODE_RUNTIME_ROOT=$(mktemp -d /tmp/chenyida-erp-release-manifest-node.XXXXXX)
NODE_BOOTSTRAP_ID=$(/usr/bin/docker create --pull=never --name "$NODE_BOOTSTRAP_NAME" --label "chenyida.erp.release-manifest-node-bootstrap=$RELEASE_ID" --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" --network none "$NODE_IMAGE" true)
/usr/bin/docker cp "$NODE_BOOTSTRAP_ID:/usr/local/bin/node" "$NODE_RUNTIME_ROOT/node"
remove_node_bootstrap
chmod 0755 "$NODE_RUNTIME_ROOT/node"
NODE_RUNTIME="$NODE_RUNTIME_ROOT/node"

inspect_image() {
  image=$1; prefix=$2
  IMAGE_REFERENCE="$image" /usr/bin/docker image inspect -- "$image" 2>/dev/null | IMAGE_REFERENCE="$image" "$NODE_RUNTIME" --input-type=module -e 'const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const rows=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!Array.isArray(rows)||rows.length!==1)process.exit(1);const row=rows[0],labels=row?.Config?.Labels||{},env=new Map();for(const item of row?.Config?.Env||[]){const at=item.indexOf("=");if(at<1||env.has(item.slice(0,at)))process.exit(1);env.set(item.slice(0,at),item.slice(at+1));}const values=[row.Id,labels["org.opencontainers.image.version"],labels["org.opencontainers.image.revision"],env.get("ERP_RUNTIME_BUILD_VERSION"),env.get("ERP_RUNTIME_GIT_COMMIT")];if(!/^sha256:[0-9a-f]{64}$/.test(values[0]||"")||values.slice(1).some((value)=>typeof value!=="string"||value.includes("|"))||!Array.isArray(row.RepoDigests)||!row.RepoDigests.includes(process.env.IMAGE_REFERENCE))process.exit(1);process.stdout.write(values.join("|"));' || { echo "$prefix atomic image inspection failed" >&2; exit 1; }
}

WEB=$(inspect_image "$WEB_IMAGE" web)
WORKER=$(inspect_image "$WORKER_IMAGE" worker)
old_ifs=$IFS; IFS='|'; set -- $WEB; IFS=$old_ifs; [ "$#" -eq 5 ] || { echo "web image evidence is incomplete" >&2; exit 1; }
WEB_DIGEST=$1; WEB_OCI_VERSION=$2; WEB_OCI_REVISION=$3; WEB_BAKED_VERSION=$4; WEB_BAKED_REVISION=$5
old_ifs=$IFS; IFS='|'; set -- $WORKER; IFS=$old_ifs; [ "$#" -eq 5 ] || { echo "worker image evidence is incomplete" >&2; exit 1; }
WORKER_DIGEST=$1; WORKER_OCI_VERSION=$2; WORKER_OCI_REVISION=$3; WORKER_BAKED_VERSION=$4; WORKER_BAKED_REVISION=$5
[ "$WEB_DIGEST" != "$WORKER_DIGEST" ] || { echo "Web and Worker images must be distinct" >&2; exit 1; }
[ "$(inspect_image "$WEB_IMAGE" web)" = "$WEB" ] && [ "$(inspect_image "$WORKER_IMAGE" worker)" = "$WORKER" ] || { echo "image identity changed during inspection" >&2; exit 1; }

GENERATED_AT=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
ASSEMBLE_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" "$NODE_RUNTIME" "$SCRIPT_DIR/release-manifest-contract.mjs" assemble \
  --artifact-root "$ARTIFACT_ROOT" --output "$PREPARED_MANIFEST" --release-id "$RELEASE_ID" --generated-at "$GENERATED_AT" --expires-at "$EXPIRES_AT" \
  --deployment-class "$DEPLOYMENT_CLASS" --repository-root "$REPOSITORY_ROOT" --git-commit "$GIT_COMMIT" --git-tree "$GIT_TREE" \
  --web-image-reference "$WEB_IMAGE" --web-image-digest "$WEB_DIGEST" --web-oci-version "$WEB_OCI_VERSION" --web-oci-revision "$WEB_OCI_REVISION" --web-baked-version "$WEB_BAKED_VERSION" --web-baked-revision "$WEB_BAKED_REVISION" \
  --worker-image-reference "$WORKER_IMAGE" --worker-image-digest "$WORKER_DIGEST" --worker-oci-version "$WORKER_OCI_VERSION" --worker-oci-revision "$WORKER_OCI_REVISION" --worker-baked-version "$WORKER_BAKED_VERSION" --worker-baked-revision "$WORKER_BAKED_REVISION" \
  --gate-plan "$GATE_PLAN" --gate-report "$GATE_REPORT" --sbom-evidence "$SBOM_EVIDENCE" --security-evidence "$SECURITY_EVIDENCE" --confirm CREATE_IMMUTABLE_RELEASE_MANIFEST)
[ -n "$ASSEMBLE_OUTPUT" ] || { echo "release manifest assembler returned no receipt" >&2; exit 1; }
[ -f "$PREPARED_MANIFEST" ] && [ ! -L "$PREPARED_MANIFEST" ] && [ "$(readlink -f "$(dirname -- "$PREPARED_MANIFEST")")" = "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$PREPARED_MANIFEST")" = "$PREPARED_MANIFEST" ] && [ "$(stat -c '%u:%g:%a:%h' "$PREPARED_MANIFEST")" = "0:0:440:1" ] || { echo "prepared release manifest is untrusted" >&2; exit 1; }
PREPARED_MANIFEST_SHA256=$(sha256sum -- "$PREPARED_MANIFEST" | cut -d ' ' -f 1)

[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source identity changed during manifest creation" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv -- && git_candidate diff --cached --quiet --no-ext-diff --no-textconv -- || { echo "release source changed during manifest creation" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked build-context files appeared during manifest creation" >&2; exit 1; }
[ "$(inspect_image "$WEB_IMAGE" web)" = "$WEB" ] && [ "$(inspect_image "$WORKER_IMAGE" worker)" = "$WORKER" ] || { echo "candidate image changed during manifest creation" >&2; exit 1; }
PUBLISH_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" "$NODE_RUNTIME" "$SCRIPT_DIR/release-manifest-contract.mjs" publish-manifest \
  --artifact-root "$ARTIFACT_ROOT" --prepared "$PREPARED_MANIFEST" --expected-sha256 "$PREPARED_MANIFEST_SHA256" --confirm PUBLISH_RELEASE_MANIFEST_AFTER_RECHECK)
PREPARED_MANIFEST=""; PREPARED_MANIFEST_SHA256=""
printf '%s\n' "$PUBLISH_OUTPUT"
