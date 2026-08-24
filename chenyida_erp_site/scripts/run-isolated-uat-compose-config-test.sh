#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/bin:/bin
export LC_ALL PATH

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PROJECT=chenyida-erp-uat-contract-test
SECRET_ROOT=/etc/chenyida-erp-uat-contract-test/runtime-secrets
CANDIDATE_ROOT=/var/lib/chenyida-erp-uat-contract-test/release-candidate
IDENTITY_ROOT=/var/lib/chenyida-erp-uat-contract-test/release-identity
WEB_PORT=33001
CADDY_HTTP_PORT=33080
CADDY_HTTPS_PORT=33443
VALIDATOR=$SITE_ROOT/scripts/isolated-uat-compose-policy.py

[ -x /usr/bin/docker ] || { echo "docker CLI is unavailable" >&2; exit 1; }
[ -x /usr/bin/python3 ] || { echo "python3 is unavailable" >&2; exit 1; }
[ -f "$SITE_ROOT/compose.yml" ] && [ -f "$SITE_ROOT/compose.release.yml" ] && [ -f "$SITE_ROOT/compose.uat-isolated.yml" ] || {
  echo "isolated UAT Compose sources are incomplete" >&2
  exit 1
}

TEMP_ROOT=$(mktemp -d /tmp/chenyida-erp-uat-compose-test.XXXXXX)
cleanup() {
  case "$TEMP_ROOT" in /tmp/chenyida-erp-uat-compose-test.*) rm -rf -- "$TEMP_ROOT" ;; *) return 1 ;; esac
}
trap cleanup EXIT HUP INT TERM

render() {
  render_project=$1
  render_secret_root=$2
  render_web_port=$3
  render_public_origin=$4
  env -i \
    PATH=/usr/bin:/bin HOME=/nonexistent LC_ALL=C \
    COMPOSE_PARALLEL_LIMIT=1 COMPOSE_DISABLE_ENV_FILE=1 \
    ERP_UAT_COMPOSE_PROJECT="$render_project" \
    ERP_UAT_RUNTIME_SECRET_ROOT="$render_secret_root" \
    ERP_UAT_RELEASE_CANDIDATE_ROOT="$CANDIDATE_ROOT" \
    ERP_UAT_RELEASE_IDENTITY_ROOT="$IDENTITY_ROOT" \
    ERP_UAT_HTTP_PORT="$render_web_port" \
    ERP_UAT_CADDY_HTTP_PORT="$CADDY_HTTP_PORT" \
    ERP_UAT_CADDY_HTTPS_PORT="$CADDY_HTTPS_PORT" \
    ERP_DEPLOYMENT_CLASS=uat \
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID="$render_project" \
    ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true \
    ERP_DOMAIN=localhost \
    ERP_PUBLIC_ORIGIN="$render_public_origin" \
    ERP_RELEASE_IDENTITY_READER_GID=1000 \
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

render_without_isolation_overlay() {
  env -i \
    PATH=/usr/bin:/bin HOME=/nonexistent LC_ALL=C \
    COMPOSE_PARALLEL_LIMIT=1 COMPOSE_DISABLE_ENV_FILE=1 \
    ERP_DEPLOYMENT_CLASS=uat \
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID="$PROJECT" \
    ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true \
    ERP_DOMAIN=localhost \
    ERP_PUBLIC_ORIGIN="https://localhost:$CADDY_HTTPS_PORT" \
    ERP_HTTP_PORT="$WEB_PORT" \
    ERP_RELEASE_IDENTITY_READER_GID=1000 \
    ERP_BUILD_VERSION=0.1.0-alpha.47 \
    ERP_BUILD_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ERP_WEB_IMAGE=example.invalid/chenyida-erp-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ERP_WORKER_IMAGE=example.invalid/chenyida-erp-worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    ERP_WEB_IMAGE_CONFIG_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
    ERP_WORKER_IMAGE_CONFIG_DIGEST=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
    /usr/bin/docker compose --env-file /dev/null --project-name "$PROJECT" --profile '*' \
      -f "$SITE_ROOT/compose.yml" \
      -f "$SITE_ROOT/compose.release.yml" \
      config --format json
}

validate_file() {
  config_file=$1
  expected_project=$2
  expected_secret_root=$3
  expected_web_port=$4
  /usr/bin/python3 -B "$VALIDATOR" \
    --project "$expected_project" \
    --project-root "$SITE_ROOT" \
    --runtime-secret-root "$expected_secret_root" \
    --release-candidate-root "$CANDIDATE_ROOT" \
    --release-identity-root "$IDENTITY_ROOT" \
    --web-port "$expected_web_port" \
    --caddy-http-port "$CADDY_HTTP_PORT" \
    --caddy-https-port "$CADDY_HTTPS_PORT" < "$config_file"
}

VALID_PUBLIC_ORIGIN=https://localhost:$CADDY_HTTPS_PORT
render "$PROJECT" "$SECRET_ROOT" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" > "$TEMP_ROOT/valid.json"
validate_file "$TEMP_ROOT/valid.json" "$PROJECT" "$SECRET_ROOT" "$WEB_PORT"

# Every negative case must fail closed before runtime resources can be created.
if render "$PROJECT" "" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" > /dev/null 2>&1; then
  echo "missing isolated secret root was accepted" >&2
  exit 1
fi

render "$PROJECT" /etc/chenyida-erp/runtime-secrets "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" > "$TEMP_ROOT/production-root.json"
if validate_file "$TEMP_ROOT/production-root.json" "$PROJECT" /etc/chenyida-erp/runtime-secrets "$WEB_PORT" > /dev/null 2>&1; then
  echo "production secret root was accepted" >&2
  exit 1
fi

render chenyida-erp "$SECRET_ROOT" "$WEB_PORT" "$VALID_PUBLIC_ORIGIN" > "$TEMP_ROOT/production-project.json"
if validate_file "$TEMP_ROOT/production-project.json" chenyida-erp "$SECRET_ROOT" "$WEB_PORT" > /dev/null 2>&1; then
  echo "production Compose project was accepted" >&2
  exit 1
fi

render "$PROJECT" "$SECRET_ROOT" 3000 "$VALID_PUBLIC_ORIGIN" > "$TEMP_ROOT/production-port.json"
if validate_file "$TEMP_ROOT/production-port.json" "$PROJECT" "$SECRET_ROOT" 3000 > /dev/null 2>&1; then
  echo "production loopback port was accepted" >&2
  exit 1
fi

render "$PROJECT" "$SECRET_ROOT" "$WEB_PORT" "http://127.0.0.1:$WEB_PORT" > "$TEMP_ROOT/http-origin.json"
if validate_file "$TEMP_ROOT/http-origin.json" "$PROJECT" "$SECRET_ROOT" "$WEB_PORT" > /dev/null 2>&1; then
  echo "production-mode HTTP public origin was accepted" >&2
  exit 1
fi

render_without_isolation_overlay > "$TEMP_ROOT/missing-overlay.json"
if validate_file "$TEMP_ROOT/missing-overlay.json" "$PROJECT" "$SECRET_ROOT" "$WEB_PORT" > /dev/null 2>&1; then
  echo "Compose without the isolated UAT overlay was accepted" >&2
  exit 1
fi

echo "ISOLATED_UAT_COMPOSE_CONFIG_TEST_PASS"
