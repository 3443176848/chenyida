#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL PATH

usage() {
  echo "usage: $0 --release-manifest FILE --release-manifest-sha256 SHA256 --postdeploy-root DIR --identity-root DIR --reader-gid GID --run-id ID --runtime-guard-contract chenyida-erp-release-runtime-guard/v1 --runtime-guard-mode POST_DEPLOY_CURRENT_RUNTIME_STRICT --runtime-policy-sha256 SHA256 --runtime-configuration-sha256 SHA256 --deployment-class UAT|PRODUCTION --deployment-id ID --compose-project ID --compose-project-root DIR --caddy-container NAME --postgres-container NAME --web-container NAME --worker-container NAME --confirm VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY" >&2
  exit 2
}

RELEASE_MANIFEST=""; RELEASE_MANIFEST_SHA256=""; POSTDEPLOY_ROOT=""; IDENTITY_ROOT=""; READER_GID=""; RUN_ID=""
RUNTIME_GUARD_CONTRACT=""; RUNTIME_GUARD_MODE=""; RUNTIME_POLICY_SHA256=""; RUNTIME_CONFIGURATION_SHA256=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""; COMPOSE_PROJECT=""; COMPOSE_PROJECT_ROOT=""
CADDY_CONTAINER=""; POSTGRES_CONTAINER=""; WEB_CONTAINER=""; WORKER_CONTAINER=""; CONFIRM=""
NODE_RUNTIME_ROOT=""; NODE_BOOTSTRAP_ID=""; NODE_BOOTSTRAP_NAME=""; NODE_RUNTIME=""; RECEIPT_SHA256=""; PREPARED=NO

remove_node_bootstrap() {
  if [ -z "$NODE_BOOTSTRAP_ID" ] && [ -n "$NODE_BOOTSTRAP_NAME" ]; then NODE_BOOTSTRAP_ID=$(/usr/bin/docker inspect --format '{{.Id}}' "$NODE_BOOTSTRAP_NAME" 2>/dev/null || true); fi
  [ -n "$NODE_BOOTSTRAP_ID" ] || return 0
  [ "$(/usr/bin/docker inspect --format '{{index .Config.Labels "chenyida.erp.postdeploy-verifier"}}|{{index .Config.Labels "chenyida.erp.release-authorization"}}|{{.Name}}' "$NODE_BOOTSTRAP_ID" 2>/dev/null || true)" = "$RUN_ID|$AUTHORIZATION_SHA256|/$NODE_BOOTSTRAP_NAME" ] || { echo "refusing to remove an unowned postdeploy bootstrap container" >&2; return 1; }
  /usr/bin/docker rm -f "$NODE_BOOTSTRAP_ID" >/dev/null
  NODE_BOOTSTRAP_ID=""
}

abort_prepared() {
  [ "$PREPARED" = YES ] && [ -n "$NODE_RUNTIME" ] && [ -n "$RECEIPT_SHA256" ] || return 0
  env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" \
    "$NODE_RUNTIME" "$SCRIPT_DIR/postdeploy-release-verifier.mjs" abort --postdeploy-root "$POSTDEPLOY_ROOT" --identity-root "$IDENTITY_ROOT" --reader-gid "$READER_GID" --run-id "$RUN_ID" --receipt-sha256 "$RECEIPT_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" --compose-project-root "$COMPOSE_PROJECT_ROOT" --runtime-policy "$RUNTIME_POLICY" --confirm ABORT_EXACT_POSTDEPLOY_VERIFICATION >/dev/null
  PREPARED=NO
}

cleanup() {
  status=0
  abort_prepared >/dev/null 2>&1 || status=1
  remove_node_bootstrap >/dev/null 2>&1 || status=1
  if [ -n "$NODE_RUNTIME_ROOT" ]; then case "$NODE_RUNTIME_ROOT" in /tmp/chenyida-erp-postdeploy-node.*) rm -rf -- "$NODE_RUNTIME_ROOT" || status=1 ;; *) status=1 ;; esac; fi
  [ "$status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-manifest) RELEASE_MANIFEST=${2:-}; shift 2 ;;
    --release-manifest-sha256) RELEASE_MANIFEST_SHA256=${2:-}; shift 2 ;;
    --postdeploy-root) POSTDEPLOY_ROOT=${2:-}; shift 2 ;;
    --identity-root) IDENTITY_ROOT=${2:-}; shift 2 ;;
    --reader-gid) READER_GID=${2:-}; shift 2 ;;
    --run-id) RUN_ID=${2:-}; shift 2 ;;
    --runtime-guard-contract) RUNTIME_GUARD_CONTRACT=${2:-}; shift 2 ;;
    --runtime-guard-mode) RUNTIME_GUARD_MODE=${2:-}; shift 2 ;;
    --runtime-policy-sha256) RUNTIME_POLICY_SHA256=${2:-}; shift 2 ;;
    --runtime-configuration-sha256) RUNTIME_CONFIGURATION_SHA256=${2:-}; shift 2 ;;
    --deployment-class) DEPLOYMENT_CLASS=${2:-}; shift 2 ;;
    --deployment-id) DEPLOYMENT_ID=${2:-}; shift 2 ;;
    --compose-project) COMPOSE_PROJECT=${2:-}; shift 2 ;;
    --compose-project-root) COMPOSE_PROJECT_ROOT=${2:-}; shift 2 ;;
    --caddy-container) CADDY_CONTAINER=${2:-}; shift 2 ;;
    --postgres-container) POSTGRES_CONTAINER=${2:-}; shift 2 ;;
    --web-container) WEB_CONTAINER=${2:-}; shift 2 ;;
    --worker-container) WORKER_CONTAINER=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
for value in "$RELEASE_MANIFEST" "$RELEASE_MANIFEST_SHA256" "$POSTDEPLOY_ROOT" "$IDENTITY_ROOT" "$READER_GID" "$RUN_ID" "$RUNTIME_GUARD_CONTRACT" "$RUNTIME_GUARD_MODE" "$RUNTIME_POLICY_SHA256" "$RUNTIME_CONFIGURATION_SHA256" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$COMPOSE_PROJECT" "$COMPOSE_PROJECT_ROOT" "$CADDY_CONTAINER" "$POSTGRES_CONTAINER" "$WEB_CONTAINER" "$WORKER_CONTAINER" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$(id -u)" = 0 ] || { echo "postdeploy verification requires root" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "postdeploy verification must be launched by the installed supervisor" >&2; exit 1; }
[ "$CONFIRM" = VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY ] || { echo "postdeploy confirmation is invalid" >&2; exit 1; }
[ "$RUNTIME_GUARD_CONTRACT" = chenyida-erp-release-runtime-guard/v1 ] && [ "$RUNTIME_GUARD_MODE" = POST_DEPLOY_CURRENT_RUNTIME_STRICT ] || { echo "postdeploy runtime guard is invalid" >&2; exit 1; }
[ "$RUNTIME_POLICY_SHA256" = e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00 ] || { echo "postdeploy runtime policy authorization is invalid" >&2; exit 1; }
case "$RUNTIME_CONFIGURATION_SHA256" in *[!0-9a-f]*|'') echo "runtime configuration digest is invalid" >&2; exit 1 ;; esac
[ "${#RUNTIME_CONFIGURATION_SHA256}" -eq 64 ] || { echo "runtime configuration digest is invalid" >&2; exit 1; }
case "$DEPLOYMENT_CLASS" in UAT|PRODUCTION) : ;; *) echo "deployment class is invalid" >&2; exit 1 ;; esac
[ "$DEPLOYMENT_ID" = "$COMPOSE_PROJECT" ] || { echo "deployment and Compose identities must match" >&2; exit 1; }
[ "$COMPOSE_PROJECT" = chenyida-erp ] || { echo "Compose project identity is invalid" >&2; exit 1; }
for value in "$RUN_ID" "$DEPLOYMENT_ID" "$COMPOSE_PROJECT" "$CADDY_CONTAINER" "$POSTGRES_CONTAINER" "$WEB_CONTAINER" "$WORKER_CONTAINER"; do case "$value" in ''|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) echo "postdeploy identifier is invalid" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "postdeploy identifier is too long" >&2; exit 1; }; done
[ "${#RUN_ID}" -le 101 ] || { echo "postdeploy run ID is too long" >&2; exit 1; }
[ "$(printf '%s\n' "$CADDY_CONTAINER" "$POSTGRES_CONTAINER" "$WEB_CONTAINER" "$WORKER_CONTAINER" | sort -u | wc -l)" -eq 4 ] || { echo "postdeploy containers must be distinct" >&2; exit 1; }
case "$RELEASE_MANIFEST" in /*) : ;; *) echo "release manifest path must be absolute" >&2; exit 1 ;; esac
case "$RELEASE_MANIFEST_SHA256" in *[!0-9a-f]*|'') echo "release manifest digest is invalid" >&2; exit 1 ;; esac
[ "${#RELEASE_MANIFEST_SHA256}" -eq 64 ] || { echo "release manifest digest is invalid" >&2; exit 1; }
for root in "$POSTDEPLOY_ROOT" "$IDENTITY_ROOT"; do case "$root" in /*) : ;; *) echo "postdeploy roots must be absolute" >&2; exit 1 ;; esac; [ "$root" != / ] || { echo "postdeploy root is invalid" >&2; exit 1; }; done
[ "$POSTDEPLOY_ROOT" != "$IDENTITY_ROOT" ] || { echo "postdeploy and identity roots must be distinct" >&2; exit 1; }
[ "$POSTDEPLOY_ROOT" = "/var/lib/chenyida-erp/postdeploy/$RUN_ID" ] && [ "$IDENTITY_ROOT" = /var/lib/chenyida-erp/release-identity ] || { echo "postdeploy path authorization is invalid" >&2; exit 1; }
case "$COMPOSE_PROJECT_ROOT" in /*) : ;; *) echo "Compose project root must be absolute" >&2; exit 1 ;; esac
[ "$COMPOSE_PROJECT_ROOT" != / ] && [ -d "$COMPOSE_PROJECT_ROOT" ] && [ ! -L "$COMPOSE_PROJECT_ROOT" ] && [ "$(readlink -f "$COMPOSE_PROJECT_ROOT")" = "$COMPOSE_PROJECT_ROOT" ] || { echo "Compose project root is invalid" >&2; exit 1; }
case "$RELEASE_MANIFEST" in /var/lib/chenyida-erp/release-artifacts/*/*) : ;; *) echo "release manifest root is invalid" >&2; exit 1 ;; esac
[ "$(dirname -- "$(dirname -- "$RELEASE_MANIFEST")")" = /var/lib/chenyida-erp/release-artifacts ] || { echo "release manifest root is invalid" >&2; exit 1; }
case "$READER_GID" in *[!0-9]*|'') echo "reader gid is invalid" >&2; exit 1 ;; esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
[ "${ERP_RELEASE_SUPERVISOR_SITE_ROOT:-}" = "$SUPERVISOR_SITE_ROOT" ] || { echo "release supervisor site root mismatch" >&2; exit 1; }
BUNDLE_ROOT=$(CDPATH= cd -- "$SUPERVISOR_SITE_ROOT/.." && pwd -P)
SUPERVISOR_BUNDLE_SHA256=${ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256:-}; AUTHORIZATION_SHA256=${ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256:-}
for digest in "$SUPERVISOR_BUNDLE_SHA256" "$AUTHORIZATION_SHA256"; do case "$digest" in *[!0-9a-f]*|'') echo "release supervisor digest is invalid" >&2; exit 1 ;; esac; [ "${#digest}" -eq 64 ] || { echo "release supervisor digest is invalid" >&2; exit 1; }; done
[ "$(basename "$BUNDLE_ROOT")" = "$SUPERVISOR_BUNDLE_SHA256" ] || { echo "release supervisor bundle path is invalid" >&2; exit 1; }
case "$BUNDLE_ROOT" in /usr/local/libexec/chenyida-erp-release-supervisor/bundles/*) : ;; *) echo "release supervisor is not installed in the trusted root" >&2; exit 1 ;; esac
RUNTIME_POLICY="$SUPERVISOR_SITE_ROOT/operations/container-runtime-policy-v1.json"
[ "$(sha256sum -- "$RUNTIME_POLICY" | cut -d ' ' -f 1)" = "$RUNTIME_POLICY_SHA256" ] || { echo "runtime policy digest is invalid" >&2; exit 1; }
RUNTIME_SECRET_POLICY="$SUPERVISOR_SITE_ROOT/operations/runtime-secret-file-policy-v1.json"
RUNTIME_SECRET_VALIDATOR="$SUPERVISOR_SITE_ROOT/scripts/runtime-secret-file-policy.py"
verify_runtime_secret_boundary() {
  result=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC HOME=/nonexistent PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 /usr/bin/python3 "$RUNTIME_SECRET_VALIDATOR" validate --policy "$RUNTIME_SECRET_POLICY" 2>/dev/null) || return 1
  [ "$result" = "RUNTIME_SECRET_FILES_VERIFIED entries=6 policy_sha256=8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5" ]
}
[ -f "$RELEASE_MANIFEST" ] && [ ! -L "$RELEASE_MANIFEST" ] || { echo "release manifest is invalid" >&2; exit 1; }
[ -d "$IDENTITY_ROOT" ] && [ ! -L "$IDENTITY_ROOT" ] && [ "$(readlink -f "$IDENTITY_ROOT")" = "$IDENTITY_ROOT" ] || { echo "identity root is invalid" >&2; exit 1; }
if [ ! -e "$POSTDEPLOY_ROOT" ]; then install -d -m 0750 -o root -g root "$POSTDEPLOY_ROOT"; fi
[ -d "$POSTDEPLOY_ROOT" ] && [ ! -L "$POSTDEPLOY_ROOT" ] && [ "$(readlink -f "$POSTDEPLOY_ROOT")" = "$POSTDEPLOY_ROOT" ] && [ "$(stat -c '%u:%g:%a' "$POSTDEPLOY_ROOT")" = "0:0:750" ] || { echo "postdeploy artifact root is invalid" >&2; exit 1; }
MARKER="$POSTDEPLOY_ROOT/.chenyida-erp-release-artifact-root-v1"
if [ ! -e "$MARKER" ]; then (umask 337; set -C; printf '%s\n' chenyida-erp-release-artifact-root/v1 > "$MARKER"); chown root:root "$MARKER"; chmod 0440 "$MARKER"; sync -f "$POSTDEPLOY_ROOT"; fi
[ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$MARKER")" = "0:0:440:1" ] && [ "$(cat "$MARKER")" = chenyida-erp-release-artifact-root/v1 ] || { echo "postdeploy artifact marker is invalid" >&2; exit 1; }
LOCK_FILE=/run/lock/chenyida-erp-release-gate-v1.lock
if [ ! -e "$LOCK_FILE" ]; then (umask 077; set -C; : > "$LOCK_FILE") || { echo "release lock creation failed" >&2; exit 1; }; fi
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] && [ "$(stat -c '%u:%g:%a:%h' "$LOCK_FILE")" = "0:0:600:1" ] || { echo "release lock is untrusted" >&2; exit 1; }
exec 9<>"$LOCK_FILE"
flock -n 9 || { echo "another release or deployment operation is active" >&2; exit 1; }
ERP_RELEASE_GATE_LOCK_HELD=YES; export ERP_RELEASE_GATE_LOCK_HELD

NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || { echo "pinned postdeploy tooling image is unavailable; pulling is forbidden" >&2; exit 1; }
NODE_BOOTSTRAP_NAME="cyd-postdeploy-node-$AUTHORIZATION_SHA256"
NODE_RUNTIME_ROOT=$(mktemp -d /tmp/chenyida-erp-postdeploy-node.XXXXXX)
NODE_BOOTSTRAP_ID=$(/usr/bin/docker create --pull=never --name "$NODE_BOOTSTRAP_NAME" --label "chenyida.erp.postdeploy-verifier=$RUN_ID" --label "chenyida.erp.release-authorization=$AUTHORIZATION_SHA256" --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 64m --memory-swap 64m --cpus 0.25 --pids-limit 16 "$NODE_IMAGE" true)
/usr/bin/docker cp "$NODE_BOOTSTRAP_ID:/usr/local/bin/node" "$NODE_RUNTIME_ROOT/node"
remove_node_bootstrap
chmod 0755 "$NODE_RUNTIME_ROOT/node"; NODE_RUNTIME="$NODE_RUNTIME_ROOT/node"

verify_runtime_secret_boundary || { echo "runtime secret boundary is invalid" >&2; exit 1; }
PREPARE_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" \
  "$NODE_RUNTIME" "$SCRIPT_DIR/postdeploy-release-verifier.mjs" prepare --manifest "$RELEASE_MANIFEST" --manifest-sha256 "$RELEASE_MANIFEST_SHA256" --postdeploy-root "$POSTDEPLOY_ROOT" --identity-root "$IDENTITY_ROOT" --reader-gid "$READER_GID" --run-id "$RUN_ID" --runtime-guard-contract "$RUNTIME_GUARD_CONTRACT" --runtime-guard-mode "$RUNTIME_GUARD_MODE" --runtime-configuration-sha256 "$RUNTIME_CONFIGURATION_SHA256" --deployment-class "$DEPLOYMENT_CLASS" --deployment-id "$DEPLOYMENT_ID" --compose-project "$COMPOSE_PROJECT" --compose-project-root "$COMPOSE_PROJECT_ROOT" --caddy-container "$CADDY_CONTAINER" --postgres-container "$POSTGRES_CONTAINER" --web-container "$WEB_CONTAINER" --worker-container "$WORKER_CONTAINER" --runtime-policy "$RUNTIME_POLICY" --confirm PREPARE_EXACT_POSTDEPLOY_VERIFICATION)
PREPARE_STATE=$(printf '%s' "$PREPARE_OUTPUT" | "$NODE_RUNTIME" -e 'const chunks=[];process.stdin.on("data",c=>chunks.push(c)).on("end",()=>{const v=JSON.parse(Buffer.concat(chunks));if(!["PREPARED","ALREADY_PUBLISHED"].includes(v.result)||!/^[0-9a-f]{64}$/.test(v.receipt_sha256))process.exit(1);process.stdout.write(`${v.result}|${v.receipt_sha256}`)})') || { echo "postdeploy prepare response is invalid" >&2; exit 1; }
old_ifs=$IFS; IFS='|'; set -- $PREPARE_STATE; IFS=$old_ifs
[ "$#" -eq 2 ] || { echo "postdeploy prepare response is invalid" >&2; exit 1; }
PREPARE_RESULT=$1; RECEIPT_SHA256=$2
if [ "$PREPARE_RESULT" = ALREADY_PUBLISHED ]; then printf '%s\n' "$PREPARE_OUTPUT"; exit 0; fi
[ "$PREPARE_RESULT" = PREPARED ] || { echo "postdeploy prepare response is invalid" >&2; exit 1; }
PREPARED=YES
verify_runtime_secret_boundary || { echo "runtime secret boundary changed before identity commit" >&2; exit 1; }
COMMIT_OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" \
  "$NODE_RUNTIME" "$SCRIPT_DIR/postdeploy-release-verifier.mjs" commit --postdeploy-root "$POSTDEPLOY_ROOT" --identity-root "$IDENTITY_ROOT" --reader-gid "$READER_GID" --run-id "$RUN_ID" --receipt-sha256 "$RECEIPT_SHA256" --authorization-sha256 "$AUTHORIZATION_SHA256" --compose-project-root "$COMPOSE_PROJECT_ROOT" --runtime-policy "$RUNTIME_POLICY" --runtime-configuration-sha256 "$RUNTIME_CONFIGURATION_SHA256" --confirm COMMIT_EXACT_POSTDEPLOY_VERIFICATION)
PREPARED=NO
printf '%s\n' "$COMMIT_OUTPUT"
