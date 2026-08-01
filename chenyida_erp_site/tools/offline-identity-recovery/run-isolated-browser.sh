#!/bin/sh
set -eu
umask 077
ulimit -c 0

fail() {
  printf '%s\n' "STAGE ISOLATED_BROWSER FAIL $1" >&2
  exit 2
}

[ "$(id -u)" -eq 0 ] || fail RECOVERY_ROOT_REQUIRED
[ "$#" -eq 2 ] || fail RECOVERY_ARGUMENT_INVALID
run_id=$1
database=$2
printf '%s\n' "$run_id" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' \
  || fail RECOVERY_RUN_ID_INVALID
printf '%s\n' "$database" | grep -Eq '^cyd_oir_test_[0-9a-f]{12}$' \
  || fail RECOVERY_DATABASE_IDENTITY_REJECTED
[ "${ERP_ENV:-}" = test ] || fail RECOVERY_DEPLOYMENT_CLASS_INVALID
[ "${ERP_DEPLOYMENT_CLASS:-}" = test ] || fail RECOVERY_DEPLOYMENT_CLASS_INVALID
[ "${ERP_PUBLIC_ORIGIN:-}" = http://127.0.0.1:3000 ] || fail RECOVERY_ORIGIN_INVALID
[ "${PLAYWRIGHT_MODULE_PATH:-}" = file:///playwright/node_modules/playwright/index.mjs ] || fail BROWSER_MODULE_PATH_INVALID

export RECOVERY_EXPECTED_DATABASE=$database
web_pid=
web_log=$(mktemp /tmp/chenyida-erp-rehearsal-web.XXXXXX)
chmod 0600 "$web_log"
cleanup() {
  if [ -n "$web_pid" ]; then
    kill -TERM "$web_pid" 2>/dev/null || true
    stop_attempt=0
    while kill -0 "$web_pid" 2>/dev/null && [ "$stop_attempt" -lt 10 ]; do
      stop_attempt=$((stop_attempt+1))
      sleep 1
    done
    if kill -0 "$web_pid" 2>/dev/null; then kill -KILL "$web_pid" 2>/dev/null || true; fi
    wait "$web_pid" 2>/dev/null || true
  fi
  rm -f -- "$web_log"
}
trap cleanup EXIT HUP INT TERM

node /runner/isolated-web-bootstrap.mjs >"$web_log" 2>&1 &
web_pid=$!
ready=0
attempt=0
while [ "$attempt" -lt 60 ]; do
  if node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  kill -0 "$web_pid" 2>/dev/null || break
  attempt=$((attempt+1))
  sleep 1
done
[ "$ready" -eq 1 ] || fail RECOVERY_REHEARSAL_WEB_UNHEALTHY
printf '%s\n' "STAGE ISOLATED_WEB PASS"

node /runner/browser-verify.mjs \
  --environment parallel-uat-rehearsal \
  --expected-run-id "$run_id" \
  --evidence-path /evidence/.browser-verification.provisional.json
