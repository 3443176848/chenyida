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

[ -x /usr/bin/python3 ] || { echo "python3 is unavailable" >&2; exit 1; }
[ -x "$POLICY_RUNNER" ] && [ -f "$ENTRYPOINT" ] && [ -f "$TEST" ] \
  && [ -f "$RUNTIME_CONTRACT_TEST" ] || {
  echo "isolated UAT one-shot sources are incomplete" >&2
  exit 1
}

"$POLICY_RUNNER"
/usr/bin/python3 -B "$TEST"
/usr/bin/python3 -B "$RUNTIME_CONTRACT_TEST"

echo "ISOLATED_UAT_ONE_SHOT_TEST_PASS"
