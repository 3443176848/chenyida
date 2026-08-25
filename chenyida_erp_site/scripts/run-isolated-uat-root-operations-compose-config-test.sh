#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/bin:/bin
export LC_ALL PATH

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PROJECT=chenyida-erp-uat-operations-test
SECRET_ROOT=/etc/chenyida-erp-uat-operations-test/runtime-secrets
CANDIDATE_ROOT=/var/lib/chenyida-erp-uat-operations-test/release-candidate
IDENTITY_ROOT=/var/lib/chenyida-erp-uat-operations-test/release-identity
GRANT_ROOT=/var/lib/chenyida-erp-uat-operations-test/migration-grant
WEB_PORT=33001
CADDY_HTTP_PORT=33080
CADDY_HTTPS_PORT=33443
MANIFEST_SHA=1111111111111111111111111111111111111111111111111111111111111111
GRANT_SHA=3333333333333333333333333333333333333333333333333333333333333333
AUTHORIZATION_SHA=4444444444444444444444444444444444444444444444444444444444444444
OPERATIONS_PACKAGE_SHA=5555555555555555555555555555555555555555555555555555555555555555
SYSTEM_IDENTIFIER=1234567890123456789
DATABASE_OID=16384
VALIDATOR=$SITE_ROOT/scripts/isolated-uat-root-operations-compose-policy.py

[ -x /usr/bin/docker ] || { echo "docker CLI is unavailable" >&2; exit 1; }
[ -x /usr/bin/python3 ] || { echo "python3 is unavailable" >&2; exit 1; }
for compose_source in compose.yml compose.release.yml compose.uat-isolated.yml compose.uat-operations.yml; do
  [ -f "$SITE_ROOT/$compose_source" ] || { echo "isolated UAT operations Compose sources are incomplete" >&2; exit 1; }
done

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-uat-operations-compose-test.XXXXXX)
cleanup() {
  case "$TEMP_ROOT" in /tmp/chenyida-erp-uat-operations-compose-test.*) rm -rf -- "$TEMP_ROOT" ;; *) return 1 ;; esac
}
trap cleanup EXIT HUP INT TERM

render() {
  render_project=$1
  render_secret_root=$2
  render_grant_root=$3
  render_web_port=$4
  render_public_origin=$5
  render_mode=$6
  render_manifest_sha=$MANIFEST_SHA
  render_operations_package_sha=$OPERATIONS_PACKAGE_SHA
  case "$render_mode" in
    valid) ;;
    missing-manifest) render_manifest_sha= ;;
    missing-package) render_operations_package_sha= ;;
    *) echo "unknown render mode" >&2; return 2 ;;
  esac
  env -i \
    PATH=/usr/bin:/bin LC_ALL=C \
    COMPOSE_PARALLEL_LIMIT=1 COMPOSE_DISABLE_ENV_FILE=1 \
    ERP_UAT_COMPOSE_PROJECT="$render_project" \
    ERP_UAT_RUNTIME_SECRET_ROOT="$render_secret_root" \
    ERP_UAT_RELEASE_CANDIDATE_ROOT="$CANDIDATE_ROOT" \
    ERP_UAT_RELEASE_IDENTITY_ROOT="$IDENTITY_ROOT" \
    ERP_UAT_MIGRATION_GRANT_ROOT="$render_grant_root" \
    ERP_UAT_HTTP_PORT="$render_web_port" \
    ERP_UAT_CADDY_HTTP_PORT="$CADDY_HTTP_PORT" \
    ERP_UAT_CADDY_HTTPS_PORT="$CADDY_HTTPS_PORT" \
    ERP_DEPLOYMENT_CLASS=uat \
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID="$render_project" \
    ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true \
    ERP_DOMAIN=localhost \
    ERP_PUBLIC_ORIGIN="$render_public_origin" \
    ERP_RELEASE_IDENTITY_READER_GID=1000 \
    ERP_RELEASE_EXPECTED_VERSION=0.1.0-alpha.47 \
    ERP_RELEASE_EXPECTED_GIT_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ERP_RELEASE_MANIFEST_SHA256="$render_manifest_sha" \
    ERP_RELEASE_EXPECTED_MANIFEST_SHA256="$render_manifest_sha" \
    ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER="$SYSTEM_IDENTIFIER" \
    ERP_MIGRATION_EXPECTED_DATABASE_OID="$DATABASE_OID" \
    ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256="$GRANT_SHA" \
    ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256="$AUTHORIZATION_SHA" \
    ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256="$render_operations_package_sha" \
    ERP_BUILD_VERSION=0.1.0-alpha.47 \
    ERP_BUILD_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ERP_WEB_IMAGE=example.invalid/chenyida-erp-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ERP_WORKER_IMAGE=example.invalid/chenyida-erp-worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    ERP_WEB_IMAGE_CONFIG_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
    ERP_WORKER_IMAGE_CONFIG_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
    /usr/bin/docker compose --env-file /dev/null --profile '*' \
      -f "$SITE_ROOT/compose.yml" \
      -f "$SITE_ROOT/compose.release.yml" \
      -f "$SITE_ROOT/compose.uat-isolated.yml" \
      -f "$SITE_ROOT/compose.uat-operations.yml" \
      config --format json
}

render_without_operations_overlay() {
  env -i \
    PATH=/usr/bin:/bin LC_ALL=C \
    COMPOSE_PARALLEL_LIMIT=1 COMPOSE_DISABLE_ENV_FILE=1 \
    ERP_UAT_COMPOSE_PROJECT="$PROJECT" \
    ERP_UAT_RUNTIME_SECRET_ROOT="$SECRET_ROOT" \
    ERP_UAT_RELEASE_CANDIDATE_ROOT="$CANDIDATE_ROOT" \
    ERP_UAT_RELEASE_IDENTITY_ROOT="$IDENTITY_ROOT" \
    ERP_UAT_HTTP_PORT="$WEB_PORT" \
    ERP_UAT_CADDY_HTTP_PORT="$CADDY_HTTP_PORT" \
    ERP_UAT_CADDY_HTTPS_PORT="$CADDY_HTTPS_PORT" \
    ERP_DEPLOYMENT_CLASS=uat \
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID="$PROJECT" \
    ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true \
    ERP_DOMAIN=localhost \
    ERP_PUBLIC_ORIGIN="https://localhost:$CADDY_HTTPS_PORT" \
    ERP_RELEASE_IDENTITY_READER_GID=1000 \
    ERP_RELEASE_EXPECTED_VERSION=0.1.0-alpha.47 \
    ERP_RELEASE_EXPECTED_GIT_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ERP_BUILD_VERSION=0.1.0-alpha.47 \
    ERP_BUILD_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ERP_WEB_IMAGE=example.invalid/chenyida-erp-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ERP_WORKER_IMAGE=example.invalid/chenyida-erp-worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    ERP_WEB_IMAGE_CONFIG_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
    ERP_WORKER_IMAGE_CONFIG_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
    /usr/bin/docker compose --env-file /dev/null --profile '*' \
      -f "$SITE_ROOT/compose.yml" \
      -f "$SITE_ROOT/compose.release.yml" \
      -f "$SITE_ROOT/compose.uat-isolated.yml" \
      config --format json
}

validate_file() {
  config_file=$1
  expected_grant_root=$2
  /usr/bin/python3 -B "$VALIDATOR" \
    --project "$PROJECT" \
    --project-root "$SITE_ROOT" \
    --runtime-secret-root "$SECRET_ROOT" \
    --release-candidate-root "$CANDIDATE_ROOT" \
    --release-identity-root "$IDENTITY_ROOT" \
    --migration-grant-root "$expected_grant_root" \
    --web-port "$WEB_PORT" \
    --caddy-http-port "$CADDY_HTTP_PORT" \
    --caddy-https-port "$CADDY_HTTPS_PORT" \
    --release-manifest-sha256 "$MANIFEST_SHA" \
    --migration-grant-sha256 "$GRANT_SHA" \
    --execution-authorization-sha256 "$AUTHORIZATION_SHA" \
    --root-operations-package-sha256 "$OPERATIONS_PACKAGE_SHA" \
    --database-system-identifier "$SYSTEM_IDENTIFIER" \
    --database-oid "$DATABASE_OID" < "$config_file"
}

mutate_json() {
  source_file=$1
  mutation=$2
  /usr/bin/python3 -B - "$source_file" "$mutation" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    value = json.load(handle)
mutation = sys.argv[2]
if mutation == "missing-grant-mount":
    value["services"]["migrate"]["volumes"] = [
        mount for mount in value["services"]["migrate"]["volumes"]
        if mount.get("target") != "/run/chenyida-erp-promotion/migration-execution-grant.json"
    ]
elif mutation == "writable-grant-mount":
    for mount in value["services"]["migrate"]["volumes"]:
        if mount.get("target") == "/run/chenyida-erp-promotion/migration-execution-grant.json":
            mount["read_only"] = False
elif mutation == "migration-state":
    value["services"]["migrate"]["environment"]["ERP_MIGRATION_DATABASE_STATE"] = "RELEASED"
elif mutation == "missing-migration-environment":
    del value["services"]["migrate"]["environment"]["ERP_MIGRATION_DATABASE_STATE"]
elif mutation == "migration-profile":
    value["services"]["migrate"]["profiles"] = ["tools"]
elif mutation == "missing-migration-profile":
    del value["services"]["migrate"]["profiles"]
elif mutation == "web-dependency":
    value["services"]["web"]["depends_on"] = {
        "migrate": {"condition": "service_completed_successfully", "required": True}
    }
elif mutation == "missing-web-dependency":
    del value["services"]["web"]["depends_on"]
elif mutation == "protected-volume":
    protected = "chenyida-erp-parallel_erp_postgres"
    value["volumes"][protected] = {"name": protected}
else:
    raise SystemExit("unknown mutation")
json.dump(value, sys.stdout, separators=(",", ":"), sort_keys=True)
PY
}

expect_policy_failure() {
  candidate_file=$1
  description=$2
  if validate_file "$candidate_file" "$GRANT_ROOT" > /dev/null 2>&1; then
    echo "$description was accepted" >&2
    exit 1
  fi
}

VALID_PUBLIC_ORIGIN=https://localhost:$CADDY_HTTPS_PORT
render "$PROJECT" "$SECRET_ROOT" "$GRANT_ROOT" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" valid > "$TEMP_ROOT/valid.json"
validate_file "$TEMP_ROOT/valid.json" "$GRANT_ROOT"

# Required root and dynamic execution inputs fail during Compose interpolation.
if render "$PROJECT" "$SECRET_ROOT" "" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" valid > /dev/null 2>&1; then
  echo "missing migration grant root was accepted" >&2
  exit 1
fi
if render "$PROJECT" "$SECRET_ROOT" "$GRANT_ROOT" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" missing-manifest > /dev/null 2>&1; then
  echo "missing release manifest SHA was accepted" >&2
  exit 1
fi
if render "$PROJECT" "$SECRET_ROOT" "$GRANT_ROOT" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" missing-package > /dev/null 2>&1; then
  echo "missing root operations package SHA was accepted" >&2
  exit 1
fi

# The fourth layer is mandatory and its grant root remains isolated.
render_without_operations_overlay > "$TEMP_ROOT/missing-overlay.json"
expect_policy_failure "$TEMP_ROOT/missing-overlay.json" "Compose without the root-operations overlay"
render "$PROJECT" "$SECRET_ROOT" "$CANDIDATE_ROOT" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" valid > "$TEMP_ROOT/overlapping-root.json"
if validate_file "$TEMP_ROOT/overlapping-root.json" "$CANDIDATE_ROOT" > /dev/null 2>&1; then
  echo "overlapping migration grant root was accepted" >&2
  exit 1
fi

for mutation in \
  missing-grant-mount \
  writable-grant-mount \
  migration-state \
  missing-migration-environment \
  migration-profile \
  missing-migration-profile \
  web-dependency \
  missing-web-dependency \
  protected-volume
do
  mutate_json "$TEMP_ROOT/valid.json" "$mutation" > "$TEMP_ROOT/$mutation.json"
  expect_policy_failure "$TEMP_ROOT/$mutation.json" "$mutation mutation"
done

echo "ISOLATED_UAT_ROOT_OPERATIONS_COMPOSE_CONFIG_TEST_PASS"
