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
  echo "usage: $0 --repository-root DIR --git-commit COMMIT --git-tree TREE --artifact-root DIR --run-id ID --runtime-guard-contract chenyida-erp-release-runtime-guard/v1 --runtime-guard-mode PRE_DEPLOY_EXISTING_RUNTIME_STABILITY --gate-plan-sha256 SHA256 --web-image REF --worker-image REF --sbom-evidence FILE --security-evidence FILE --confirm RUN_EXACT_RELEASE_GATE" >&2
  exit 2
}

REPOSITORY_ROOT=""; GIT_COMMIT=""; GIT_TREE=""; ARTIFACT_ROOT=""; RUN_ID=""; RUNTIME_GUARD_CONTRACT=""; RUNTIME_GUARD_MODE=""; GATE_PLAN_SHA256=""; WEB_IMAGE=""; WORKER_IMAGE=""; SBOM_EVIDENCE=""; SECURITY_EVIDENCE=""; CONFIRM=""
NODE_RUNTIME_ROOT=""; NODE_BOOTSTRAP_ID=""; NODE_BOOTSTRAP_NAME=""; NODE_RUNTIME=""
PREPARED_PLAN=""; PREPARED_REPORT=""; GATE_STAGE_CREATION_STARTED=NO

remove_node_bootstrap() {
  if [ -z "$NODE_BOOTSTRAP_ID" ] && [ -n "$NODE_BOOTSTRAP_NAME" ]; then NODE_BOOTSTRAP_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$NODE_BOOTSTRAP_NAME" 2>/dev/null || true); fi
  [ -n "$NODE_BOOTSTRAP_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.release-node-bootstrap"}}|{{index .Config.Labels "chenyida.erp.release-authorization"}}|{{.Name}}' "$NODE_BOOTSTRAP_ID" 2>/dev/null || true)" = "$RUN_ID|$AUTHORIZATION_SHA256|/$NODE_BOOTSTRAP_NAME" ] || { echo "refusing to remove an unowned Node bootstrap container" >&2; return 1; }
  /usr/bin/docker rm -f "$NODE_BOOTSTRAP_ID" >/dev/null
  NODE_BOOTSTRAP_ID=""
}

discard_gate_stages() {
  [ "$GATE_STAGE_CREATION_STARTED" = YES ] || return 0
  status=0
  for file in "$PREPARED_PLAN" "$PREPARED_REPORT"; do
    [ -n "$file" ] || { status=1; continue; }
    if [ -e "$file" ] || [ -L "$file" ]; then
      [ -f "$file" ] && [ ! -L "$file" ] && [ "$(readlink -f "$(dirname -- "$file")")" = "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$file")" = "$file" ] && [ "$(stat -c '%u:%g:%a:%h' "$file")" = "0:0:440:1" ] || { status=1; continue; }
      rm -- "$file" || status=1
    fi
  done
  sync -f "$ARTIFACT_ROOT" || status=1
  GATE_STAGE_CREATION_STARTED=NO
  [ "$status" = 0 ]
}

cleanup() {
  status=0
  discard_gate_stages >/dev/null 2>&1 || status=1
  remove_node_bootstrap >/dev/null 2>&1 || status=1
  if [ -n "$NODE_RUNTIME_ROOT" ]; then case "$NODE_RUNTIME_ROOT" in /tmp/chenyida-erp-release-gate-node.*) rm -rf -- "$NODE_RUNTIME_ROOT" || status=1 ;; *) status=1 ;; esac; fi
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
    --runtime-guard-contract) RUNTIME_GUARD_CONTRACT=${2:-}; shift 2 ;;
    --runtime-guard-mode) RUNTIME_GUARD_MODE=${2:-}; shift 2 ;;
    --gate-plan-sha256) GATE_PLAN_SHA256=${2:-}; shift 2 ;;
    --web-image) WEB_IMAGE=${2:-}; shift 2 ;;
    --worker-image) WORKER_IMAGE=${2:-}; shift 2 ;;
    --sbom-evidence) SBOM_EVIDENCE=${2:-}; shift 2 ;;
    --security-evidence) SECURITY_EVIDENCE=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
for value in "$REPOSITORY_ROOT" "$GIT_COMMIT" "$GIT_TREE" "$ARTIFACT_ROOT" "$RUN_ID" "$RUNTIME_GUARD_CONTRACT" "$RUNTIME_GUARD_MODE" "$GATE_PLAN_SHA256" "$WEB_IMAGE" "$WORKER_IMAGE" "$SBOM_EVIDENCE" "$SECURITY_EVIDENCE" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$(id -u)" = 0 ] || { echo "release gate requires root" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "release gate must be launched by the installed supervisor" >&2; exit 1; }
[ "$CONFIRM" = RUN_EXACT_RELEASE_GATE ] || { echo "release gate confirmation is invalid" >&2; exit 1; }
[ "$RUNTIME_GUARD_CONTRACT" = chenyida-erp-release-runtime-guard/v1 ] && [ "$RUNTIME_GUARD_MODE" = PRE_DEPLOY_EXISTING_RUNTIME_STABILITY ] || { echo "release gate runtime guard is invalid" >&2; exit 1; }
case "$GATE_PLAN_SHA256" in *[!0-9a-f]*|'') echo "release gate plan digest is invalid" >&2; exit 1 ;; esac
[ "${#GATE_PLAN_SHA256}" -eq 64 ] || { echo "release gate plan digest is invalid" >&2; exit 1; }
case "$RUN_ID" in [A-Za-z0-9]*) : ;; *) echo "release gate run ID is invalid" >&2; exit 1 ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) echo "release gate run ID is invalid" >&2; exit 1 ;; esac
[ "${#RUN_ID}" -le 80 ] || { echo "release gate run ID is invalid" >&2; exit 1; }
for image in "$WEB_IMAGE" "$WORKER_IMAGE"; do
  case "$image" in [A-Za-z0-9]*) : ;; *) echo "release image reference is invalid" >&2; exit 1 ;; esac
  case "$image" in *[!A-Za-z0-9._/@:-]*) echo "release image reference is invalid" >&2; exit 1 ;; esac
  case "$image" in *@sha256:*) image_hex=${image##*@sha256:} ;; *) echo "release image must use a registry digest reference" >&2; exit 1 ;; esac
  case "$image_hex" in *[!0-9a-f]*|'') echo "release registry digest is invalid" >&2; exit 1 ;; esac
  [ "${#image_hex}" -eq 64 ] || { echo "release registry digest is invalid" >&2; exit 1; }
done
case "$ARTIFACT_ROOT" in /*) : ;; *) echo "artifact root must be absolute" >&2; exit 1 ;; esac
for file in "$SBOM_EVIDENCE" "$SECURITY_EVIDENCE"; do case "$file" in /*) : ;; *) echo "release evidence paths must be absolute" >&2; exit 1 ;; esac; done

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
PLAN="$SCRIPT_DIR/../release/release-gate-plan-v2.json"
[ -f "$PLAN" ] && [ ! -L "$PLAN" ] || { echo "release gate plan is missing or untrusted" >&2; exit 1; }
[ "$(sha256sum -- "$PLAN" | cut -d ' ' -f 1)" = "$GATE_PLAN_SHA256" ] || { echo "release gate plan does not match the authorization" >&2; exit 1; }
case "$GIT_COMMIT$GIT_TREE" in *[!0-9a-f]*|'') echo "authorized Git identity is invalid" >&2; exit 1 ;; esac
[ "${#GIT_COMMIT}" -eq 40 ] && [ "${#GIT_TREE}" -eq 40 ] || { echo "authorized Git identity is invalid" >&2; exit 1; }
git_candidate() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.useReplaceRefs=false -c tar.umask=0022 -c "safe.directory=$REPOSITORY_ROOT" -C "$REPOSITORY_ROOT" "$@"; }
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source does not match the authorized Git identity" >&2; exit 1; }
git_candidate diff --quiet --no-ext-diff --no-textconv -- || { echo "tracked worktree changes block release gate" >&2; exit 1; }
git_candidate diff --cached --quiet --no-ext-diff --no-textconv -- || { echo "staged changes block release gate" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked build-context files block release gate" >&2; exit 1; }
case "$ARTIFACT_ROOT/" in "$REPOSITORY_ROOT/"*) echo "release artifacts must be outside the repository" >&2; exit 1 ;; esac

if [ ! -e "$ARTIFACT_ROOT" ]; then install -d -m 0750 -o root -g root "$ARTIFACT_ROOT"; fi
[ -d "$ARTIFACT_ROOT" ] && [ ! -L "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$ARTIFACT_ROOT")" = "$ARTIFACT_ROOT" ] && [ "$(stat -c '%u:%g:%a' "$ARTIFACT_ROOT")" = "0:0:750" ] || { echo "artifact root is invalid" >&2; exit 1; }
MARKER="$ARTIFACT_ROOT/.chenyida-erp-release-artifact-root-v1"
if [ ! -e "$MARKER" ]; then
  (umask 337; set -C; printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$MARKER")
  chown root:root "$MARKER"; chmod 0440 "$MARKER"; sync -f "$ARTIFACT_ROOT"
fi
[ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$MARKER")" = "0:0:440:1" ] && [ "$(cat "$MARKER")" = chenyida-erp-release-artifact-root/v1 ] || { echo "artifact root marker is invalid" >&2; exit 1; }
for file in "$SBOM_EVIDENCE" "$SECURITY_EVIDENCE"; do
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(readlink -f "$(dirname -- "$file")")" = "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$file")" = "$file" ] && [ "$(stat -c '%u:%g:%a:%h' "$file")" = "0:0:440:1" ] || { echo "release evidence file is outside the trusted root or has unsafe metadata" >&2; exit 1; }
done
[ ! -e "$ARTIFACT_ROOT/$RUN_ID.release-gate-report.json" ] || { echo "release gate report already exists" >&2; exit 1; }
[ ! -e "$ARTIFACT_ROOT/$RUN_ID.release-gate-plan.json" ] || { echo "release gate plan artifact already exists" >&2; exit 1; }
[ ! -e "$ARTIFACT_ROOT/$RUN_ID.release-gate-attempt.json" ] || { echo "release gate attempt receipt already exists" >&2; exit 1; }
PREPARED_PLAN="$ARTIFACT_ROOT/.$RUN_ID.release-gate-plan.prepared.json"
PREPARED_REPORT="$ARTIFACT_ROOT/.$RUN_ID.release-gate-report.prepared.json"
[ ! -e "$PREPARED_PLAN" ] && [ ! -L "$PREPARED_PLAN" ] || { echo "prepared release gate plan already exists" >&2; PREPARED_PLAN=""; PREPARED_REPORT=""; exit 1; }
[ ! -e "$PREPARED_REPORT" ] && [ ! -L "$PREPARED_REPORT" ] || { echo "prepared release gate report already exists" >&2; PREPARED_PLAN=""; PREPARED_REPORT=""; exit 1; }

LOCK_FILE=/var/lock/chenyida-erp-release-gate-v1.lock
if [ ! -e "$LOCK_FILE" ]; then
  (umask 077; set -C; : > "$LOCK_FILE") || { echo "release gate lock creation failed" >&2; exit 1; }
fi
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] && [ "$(stat -c '%u:%g:%a:%h' "$LOCK_FILE")" = "0:0:600:1" ] || { echo "release gate lock is untrusted" >&2; exit 1; }
exec 9<>"$LOCK_FILE"
flock -n 9 || { echo "another release gate is active" >&2; exit 1; }
[ "$(stat -c '%u:%g:%a:%h' "$LOCK_FILE")" = "0:0:600:1" ] || { echo "release gate lock ownership or mode is invalid" >&2; exit 1; }
ERP_RELEASE_GATE_LOCK_HELD=YES; export ERP_RELEASE_GATE_LOCK_HELD
NODE_BOOTSTRAP_NAME="cyd-release-gate-node-$AUTHORIZATION_SHA256"

NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned release tooling image is unavailable; pulling is forbidden" >&2; exit 1; }
NODE_RUNTIME_ROOT=$(mktemp -d /tmp/chenyida-erp-release-gate-node.XXXXXX)
NODE_BOOTSTRAP_ID=$(/usr/bin/docker create --pull=never --name "$NODE_BOOTSTRAP_NAME" --label "chenyida.erp.release-node-bootstrap=$RUN_ID" --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" --network none "$NODE_IMAGE" true)
/usr/bin/docker cp "$NODE_BOOTSTRAP_ID:/usr/local/bin/node" "$NODE_RUNTIME_ROOT/node"
remove_node_bootstrap
chmod 0755 "$NODE_RUNTIME_ROOT/node"
NODE_RUNTIME="$NODE_RUNTIME_ROOT/node"

verify_image() {
  image=$1; expected_version=$2; expected_revision=$3
  IMAGE_REFERENCE="$image" EXPECTED_VERSION="$expected_version" EXPECTED_REVISION="$expected_revision" /usr/bin/docker image inspect -- "$image" 2>/dev/null | IMAGE_REFERENCE="$image" EXPECTED_VERSION="$expected_version" EXPECTED_REVISION="$expected_revision" "$NODE_RUNTIME" --input-type=module -e 'const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const rows=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!Array.isArray(rows)||rows.length!==1)process.exit(1);const row=rows[0],labels=row?.Config?.Labels||{},env=new Map();for(const item of row?.Config?.Env||[]){const at=item.indexOf("=");if(at<1||env.has(item.slice(0,at)))process.exit(1);env.set(item.slice(0,at),item.slice(at+1));}if(!/^sha256:[0-9a-f]{64}$/.test(row.Id||"")||!Array.isArray(row.RepoDigests)||!row.RepoDigests.includes(process.env.IMAGE_REFERENCE)||labels["org.opencontainers.image.version"]!==process.env.EXPECTED_VERSION||labels["org.opencontainers.image.revision"]!==process.env.EXPECTED_REVISION||env.get("ERP_RUNTIME_BUILD_VERSION")!==process.env.EXPECTED_VERSION||env.get("ERP_RUNTIME_GIT_COMMIT")!==process.env.EXPECTED_REVISION)process.exit(1);process.stdout.write(row.Id);'
}

PACKAGE_VERSION=$("$NODE_RUNTIME" --input-type=module -e 'import {readFileSync} from "node:fs";const value=JSON.parse(readFileSync(process.argv[1],"utf8"));if(typeof value.version!=="string")process.exit(1);process.stdout.write(value.version)' "$REPOSITORY_ROOT/chenyida_erp_site/package.json")
WEB_DIGEST=$(verify_image "$WEB_IMAGE" "$PACKAGE_VERSION" "$GIT_COMMIT") || { echo "Web image does not match the committed source" >&2; exit 1; }
WORKER_DIGEST=$(verify_image "$WORKER_IMAGE" "$PACKAGE_VERSION" "$GIT_COMMIT") || { echo "Worker image does not match the committed source" >&2; exit 1; }
[ "$WEB_DIGEST" != "$WORKER_DIGEST" ] || { echo "Web and Worker images must be distinct" >&2; exit 1; }
MIGRATION_ALLOWLIST_SHA256=$(CDPATH= cd -- "$SUPERVISOR_SITE_ROOT" && env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC "$NODE_RUNTIME" --input-type=module -e 'import {buildMigrationAllowlist,migrationAllowlistDigest} from "./scripts/release-manifest-contract.mjs";process.stdout.write(migrationAllowlistDigest(await buildMigrationAllowlist(process.argv[1])))' "$REPOSITORY_ROOT/chenyida_erp_site/drizzle-postgres")

GATE_STAGE_CREATION_STARTED=YES
set +e
RUNNER_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_SITE_ROOT="$SUPERVISOR_SITE_ROOT" ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" "$NODE_RUNTIME" "$SCRIPT_DIR/release-gate-runner.mjs" run --plan "$PLAN" --repository-root "$REPOSITORY_ROOT" --artifact-root "$ARTIFACT_ROOT" --run-id "$RUN_ID" --runtime-guard-mode "$RUNTIME_GUARD_MODE" \
  --git-commit "$GIT_COMMIT" --git-tree "$GIT_TREE" --package-version "$PACKAGE_VERSION" --web-image-digest "$WEB_DIGEST" --worker-image-digest "$WORKER_DIGEST" --migration-allowlist-sha256 "$MIGRATION_ALLOWLIST_SHA256" \
  --web-image-reference "$WEB_IMAGE" --worker-image-reference "$WORKER_IMAGE" \
  --sbom-evidence "$SBOM_EVIDENCE" --security-evidence "$SECURITY_EVIDENCE" --confirm RUN_EXACT_RELEASE_GATE)
STATUS=$?
set -e

if [ -e "$PREPARED_PLAN" ] || [ -e "$PREPARED_REPORT" ]; then
  [ -n "$RUNNER_OUTPUT" ] || { echo "release gate runner staged artifacts without a receipt" >&2; exit 1; }
  for file in "$PREPARED_PLAN" "$PREPARED_REPORT"; do
    [ -f "$file" ] && [ ! -L "$file" ] && [ "$(readlink -f "$(dirname -- "$file")")" = "$ARTIFACT_ROOT" ] && [ "$(readlink -f "$file")" = "$file" ] && [ "$(stat -c '%u:%g:%a:%h' "$file")" = "0:0:440:1" ] || { echo "prepared release gate artifact is incomplete or untrusted" >&2; exit 1; }
  done
  PLAN_SHA256=$(sha256sum -- "$PREPARED_PLAN" | cut -d ' ' -f 1)
  REPORT_SHA256=$(sha256sum -- "$PREPARED_REPORT" | cut -d ' ' -f 1)
else
  GATE_STAGE_CREATION_STARTED=NO
  [ -z "$RUNNER_OUTPUT" ] || { echo "release gate runner returned a receipt without staged artifacts" >&2; exit 1; }
fi

git_candidate diff --quiet --no-ext-diff --no-textconv -- && git_candidate diff --cached --quiet --no-ext-diff --no-textconv -- || { echo "release gate changed tracked source" >&2; exit 1; }
[ "$(git_candidate rev-parse --verify HEAD^{commit})" = "$GIT_COMMIT" ] && [ "$(git_candidate rev-parse --verify HEAD^{tree})" = "$GIT_TREE" ] || { echo "release source identity changed during gate" >&2; exit 1; }
[ -z "$(git_candidate ls-files --others --exclude-standard -- chenyida_erp_site)" ] || { echo "untracked build-context files appeared during release gate" >&2; exit 1; }
[ "$(verify_image "$WEB_IMAGE" "$PACKAGE_VERSION" "$GIT_COMMIT")" = "$WEB_DIGEST" ] && [ "$(verify_image "$WORKER_IMAGE" "$PACKAGE_VERSION" "$GIT_COMMIT")" = "$WORKER_DIGEST" ] || { echo "candidate image changed during release gate" >&2; exit 1; }

if [ "$GATE_STAGE_CREATION_STARTED" = YES ]; then
  set +e
  PUBLISH_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" "$NODE_RUNTIME" "$SCRIPT_DIR/release-gate-runner.mjs" commit \
    --artifact-root "$ARTIFACT_ROOT" --run-id "$RUN_ID" --plan-sha256 "$PLAN_SHA256" --report-sha256 "$REPORT_SHA256" --runner-exit-code "$STATUS" --confirm PUBLISH_RELEASE_GATE_AFTER_RECHECK)
  PUBLISH_STATUS=$?
  set -e
  [ "$PUBLISH_STATUS" = "$STATUS" ] || { echo "release gate publication status does not match the staged report" >&2; exit 1; }
  [ -f "$ARTIFACT_ROOT/$RUN_ID.release-gate-plan.json" ] && [ -f "$ARTIFACT_ROOT/$RUN_ID.release-gate-report.json" ] && [ ! -e "$PREPARED_PLAN" ] && [ ! -e "$PREPARED_REPORT" ] || { echo "release gate publication is incomplete" >&2; exit 1; }
  GATE_STAGE_CREATION_STARTED=NO
  printf '%s\n' "$PUBLISH_OUTPUT"
fi
exit "$STATUS"
