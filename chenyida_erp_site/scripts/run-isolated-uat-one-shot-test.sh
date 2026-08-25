#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/bin:/bin
export LC_ALL PATH

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
POLICY_RUNNER=$SITE_ROOT/scripts/run-isolated-uat-control-plane-policy-test.sh
ENTRYPOINT=$SITE_ROOT/scripts/isolated-uat-one-shot.py
TEST=$SITE_ROOT/tests/test_isolated_uat_one_shot.py
RUNTIME_CONTRACT_TEST=$SITE_ROOT/tests/test_isolated_uat_runtime_contracts.py
RUNTIME_RECEIPT_TEST=$SITE_ROOT/tests/test_isolated_uat_runtime_receipts.py
EXTERNAL_ANCHOR_TEST=$SITE_ROOT/tests/test_isolated_uat_external_anchor_contracts.py
OWNER_COMPLETION_TEST=$SITE_ROOT/tests/test_isolated_uat_owner_completion_contracts.py
HOST_SNI_TEST=$SITE_ROOT/tests/test_isolated_uat_caddy_host_sni_contracts.py
ACTION_SOURCE_CLOSURE_TEST=$SITE_ROOT/tests/test_isolated_uat_action_source_closure_contracts.py
PRE_IMPORT_BOOTSTRAP_TEST=$SITE_ROOT/tests/test_isolated_uat_pre_import_bootstrap.py
PRE_IMPORT_HOST_PIN_TEST=$SITE_ROOT/tests/test_isolated_uat_pre_import_host_pin.py

[ -x /usr/bin/python3 ] || { echo "python3 is unavailable" >&2; exit 1; }
[ -x "$POLICY_RUNNER" ] && [ -f "$ENTRYPOINT" ] && [ -f "$TEST" ] \
  && [ -f "$RUNTIME_CONTRACT_TEST" ] && [ -f "$RUNTIME_RECEIPT_TEST" ] \
  && [ -f "$EXTERNAL_ANCHOR_TEST" ] && [ -f "$OWNER_COMPLETION_TEST" ] \
  && [ -f "$HOST_SNI_TEST" ] && [ -f "$ACTION_SOURCE_CLOSURE_TEST" ] \
  && [ -f "$PRE_IMPORT_BOOTSTRAP_TEST" ] \
  && [ -f "$PRE_IMPORT_HOST_PIN_TEST" ] || {
  echo "isolated UAT one-shot sources are incomplete" >&2
  exit 1
}

"$POLICY_RUNNER"
/usr/bin/python3 -B "$TEST"
/usr/bin/python3 -B "$RUNTIME_CONTRACT_TEST"
/usr/bin/python3 -B "$RUNTIME_RECEIPT_TEST"
/usr/bin/python3 -B "$EXTERNAL_ANCHOR_TEST"
/usr/bin/python3 -B "$OWNER_COMPLETION_TEST"
/usr/bin/python3 -B "$HOST_SNI_TEST"
/usr/bin/python3 -B "$ACTION_SOURCE_CLOSURE_TEST"
/usr/bin/python3 -B "$PRE_IMPORT_BOOTSTRAP_TEST"
/usr/bin/python3 -B "$PRE_IMPORT_HOST_PIN_TEST"

echo "ISOLATED_UAT_ONE_SHOT_TEST_PASS"
