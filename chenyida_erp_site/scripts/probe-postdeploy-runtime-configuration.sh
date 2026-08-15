#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL PATH

usage() {
  echo "usage: $0 --release-manifest FILE --release-manifest-sha256 SHA256 --probe-root DIR --probe-id ID --reader-gid GID --runtime-guard-contract chenyida-erp-release-runtime-guard/v1 --runtime-guard-mode POST_DEPLOY_CURRENT_RUNTIME_STRICT --runtime-policy-sha256 SHA256 --deployment-class UAT|PRODUCTION --deployment-id chenyida-erp --compose-project chenyida-erp --compose-project-root DIR --caddy-container NAME --postgres-container NAME --web-container NAME --worker-container NAME --confirm PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION" >&2
  exit 2
}

RELEASE_MANIFEST=""; RELEASE_MANIFEST_SHA256=""; PROBE_ROOT=""; PROBE_ID=""; READER_GID=""
RUNTIME_GUARD_CONTRACT=""; RUNTIME_GUARD_MODE=""; RUNTIME_POLICY_SHA256=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""; COMPOSE_PROJECT=""; COMPOSE_PROJECT_ROOT=""
CADDY_CONTAINER=""; POSTGRES_CONTAINER=""; WEB_CONTAINER=""; WORKER_CONTAINER=""; CONFIRM=""
NODE_RUNTIME=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-manifest) RELEASE_MANIFEST=${2:-}; shift 2 ;;
    --release-manifest-sha256) RELEASE_MANIFEST_SHA256=${2:-}; shift 2 ;;
    --probe-root) PROBE_ROOT=${2:-}; shift 2 ;;
    --probe-id) PROBE_ID=${2:-}; shift 2 ;;
    --reader-gid) READER_GID=${2:-}; shift 2 ;;
    --runtime-guard-contract) RUNTIME_GUARD_CONTRACT=${2:-}; shift 2 ;;
    --runtime-guard-mode) RUNTIME_GUARD_MODE=${2:-}; shift 2 ;;
    --runtime-policy-sha256) RUNTIME_POLICY_SHA256=${2:-}; shift 2 ;;
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
for value in "$RELEASE_MANIFEST" "$RELEASE_MANIFEST_SHA256" "$PROBE_ROOT" "$PROBE_ID" "$READER_GID" "$RUNTIME_GUARD_CONTRACT" "$RUNTIME_GUARD_MODE" "$RUNTIME_POLICY_SHA256" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$COMPOSE_PROJECT" "$COMPOSE_PROJECT_ROOT" "$CADDY_CONTAINER" "$POSTGRES_CONTAINER" "$WEB_CONTAINER" "$WORKER_CONTAINER" "$CONFIRM"; do [ -n "$value" ] || usage; done

[ "$(id -u)" = 0 ] || { echo "runtime configuration probe requires root" >&2; exit 1; }
[ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] || { echo "runtime configuration probe must be launched by the installed supervisor" >&2; exit 1; }
[ "$CONFIRM" = PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION ] || { echo "runtime configuration probe confirmation is invalid" >&2; exit 1; }
[ "$RUNTIME_GUARD_CONTRACT" = chenyida-erp-release-runtime-guard/v1 ] && [ "$RUNTIME_GUARD_MODE" = POST_DEPLOY_CURRENT_RUNTIME_STRICT ] || { echo "runtime configuration probe guard is invalid" >&2; exit 1; }
[ "$RUNTIME_POLICY_SHA256" = e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00 ] || { echo "runtime policy authorization is invalid" >&2; exit 1; }
[ "$PROBE_ROOT" = /var/lib/chenyida-erp/runtime-probes ] || { echo "runtime probe root is invalid" >&2; exit 1; }
case "$DEPLOYMENT_CLASS" in UAT|PRODUCTION) : ;; *) echo "deployment class is invalid" >&2; exit 1 ;; esac
[ "$DEPLOYMENT_ID" = chenyida-erp ] && [ "$COMPOSE_PROJECT" = chenyida-erp ] || { echo "runtime deployment identity is invalid" >&2; exit 1; }
for value in "$PROBE_ID" "$DEPLOYMENT_ID" "$COMPOSE_PROJECT" "$CADDY_CONTAINER" "$POSTGRES_CONTAINER" "$WEB_CONTAINER" "$WORKER_CONTAINER"; do case "$value" in ''|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) echo "runtime probe identifier is invalid" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "runtime probe identifier is too long" >&2; exit 1; }; done
[ "${#PROBE_ID}" -le 101 ] || { echo "runtime probe ID is too long" >&2; exit 1; }
[ "$(printf '%s\n' "$CADDY_CONTAINER" "$POSTGRES_CONTAINER" "$WEB_CONTAINER" "$WORKER_CONTAINER" | sort -u | wc -l)" -eq 4 ] || { echo "runtime probe containers must be distinct" >&2; exit 1; }
case "$READER_GID" in *[!0-9]*|'') echo "runtime probe reader GID is invalid" >&2; exit 1 ;; esac
for digest in "$RELEASE_MANIFEST_SHA256" "$RUNTIME_POLICY_SHA256"; do case "$digest" in *[!0-9a-f]*|'') echo "runtime probe digest is invalid" >&2; exit 1 ;; esac; [ "${#digest}" -eq 64 ] || { echo "runtime probe digest is invalid" >&2; exit 1; }; done
case "$RELEASE_MANIFEST" in /var/lib/chenyida-erp/release-artifacts/*/*) : ;; *) echo "release manifest root is invalid" >&2; exit 1 ;; esac
[ "$(dirname -- "$(dirname -- "$RELEASE_MANIFEST")")" = /var/lib/chenyida-erp/release-artifacts ] || { echo "release manifest root is invalid" >&2; exit 1; }
[ -f "$RELEASE_MANIFEST" ] && [ ! -L "$RELEASE_MANIFEST" ] || { echo "release manifest is invalid" >&2; exit 1; }
case "$COMPOSE_PROJECT_ROOT" in /*) : ;; *) echo "Compose project root must be absolute" >&2; exit 1 ;; esac
[ "$COMPOSE_PROJECT_ROOT" != / ] && [ -d "$COMPOSE_PROJECT_ROOT" ] && [ ! -L "$COMPOSE_PROJECT_ROOT" ] && [ "$(readlink -f "$COMPOSE_PROJECT_ROOT")" = "$COMPOSE_PROJECT_ROOT" ] || { echo "Compose project root is invalid" >&2; exit 1; }
[ -d "$PROBE_ROOT" ] && [ ! -L "$PROBE_ROOT" ] && [ "$(stat -c '%u:%g:%a' "$PROBE_ROOT")" = 0:0:700 ] || { echo "runtime probe root metadata is invalid" >&2; exit 1; }
PROBE_MARKER="$PROBE_ROOT/.chenyida-erp-runtime-probe-root-v1"
[ -f "$PROBE_MARKER" ] && [ ! -L "$PROBE_MARKER" ] && [ "$(stat -c '%u:%g:%a:%h' "$PROBE_MARKER")" = 0:0:400:1 ] && [ "$(cat "$PROBE_MARKER")" = chenyida-erp-runtime-probe-root/v1 ] || { echo "runtime probe root marker is invalid" >&2; exit 1; }

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

LOCK_HELPER="$SCRIPT_DIR/release-gate-lock.sh"
[ -f "$LOCK_HELPER" ] && [ ! -L "$LOCK_HELPER" ] && [ "$(stat -c %h "$LOCK_HELPER")" = 1 ] && [ "$(stat -c %u "$LOCK_HELPER")" = "$(id -u)" ] && [ $((0$(stat -c %a "$LOCK_HELPER") & 0022)) -eq 0 ] || { echo "release gate lock helper is unsafe" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$LOCK_HELPER"
acquire_chenyida_release_gate_lock
ERP_RELEASE_GATE_LOCK_HELD=YES; export ERP_RELEASE_GATE_LOCK_HELD
verify_runtime_secret_boundary || { echo "runtime secret boundary is invalid" >&2; exit 1; }

NODE_RUNTIME=${ERP_RELEASE_SUPERVISOR_NODE_RUNTIME:-}
NODE_RUNTIME_ROOT=$(dirname -- "$NODE_RUNTIME")
[ "$(dirname -- "$NODE_RUNTIME_ROOT")" = /tmp ] || { echo "supervisor Node runtime root is invalid" >&2; exit 1; }
case "$(basename -- "$NODE_RUNTIME_ROOT")" in chenyida-erp-runtime-privilege-node.*) : ;; *) echo "supervisor Node runtime root is invalid" >&2; exit 1 ;; esac
[ -d "$NODE_RUNTIME_ROOT" ] && [ ! -L "$NODE_RUNTIME_ROOT" ] && [ "$(readlink -f "$NODE_RUNTIME_ROOT")" = "$NODE_RUNTIME_ROOT" ] && [ "$(stat -c '%u:%g:%a' "$NODE_RUNTIME_ROOT")" = 0:0:700 ] || { echo "supervisor Node runtime root is invalid" >&2; exit 1; }
[ "$NODE_RUNTIME" = "$NODE_RUNTIME_ROOT/node" ] && [ -f "$NODE_RUNTIME" ] && [ ! -L "$NODE_RUNTIME" ] && [ "$(readlink -f "$NODE_RUNTIME")" = "$NODE_RUNTIME" ] && [ "$(stat -c '%u:%g:%a:%h' "$NODE_RUNTIME")" = 0:0:555:1 ] || { echo "supervisor Node runtime is invalid" >&2; exit 1; }

OUTPUT=$(env -i PATH="$PATH" LC_ALL=C LANG=C TZ=UTC ERP_RELEASE_GATE_LOCK_HELD=YES ERP_RELEASE_SUPERVISOR_LAUNCHED=YES ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256="$SUPERVISOR_BUNDLE_SHA256" ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA256" \
  "$NODE_RUNTIME" "$SCRIPT_DIR/postdeploy-runtime-configuration-probe.mjs" probe --release-manifest "$RELEASE_MANIFEST" --release-manifest-sha256 "$RELEASE_MANIFEST_SHA256" --probe-root "$PROBE_ROOT" --probe-id "$PROBE_ID" --reader-gid "$READER_GID" --runtime-guard-contract "$RUNTIME_GUARD_CONTRACT" --runtime-guard-mode "$RUNTIME_GUARD_MODE" --deployment-class "$DEPLOYMENT_CLASS" --deployment-id "$DEPLOYMENT_ID" --compose-project "$COMPOSE_PROJECT" --compose-project-root "$COMPOSE_PROJECT_ROOT" --caddy-container "$CADDY_CONTAINER" --postgres-container "$POSTGRES_CONTAINER" --web-container "$WEB_CONTAINER" --worker-container "$WORKER_CONTAINER" --runtime-policy "$RUNTIME_POLICY" --confirm PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION)
verify_runtime_secret_boundary || { echo "runtime secret boundary changed during the probe" >&2; exit 1; }
printf '%s' "$OUTPUT"
