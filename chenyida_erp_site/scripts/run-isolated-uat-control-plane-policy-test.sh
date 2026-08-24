#!/bin/sh
set -eu
set -f
LC_ALL=C
PATH=/usr/bin:/bin
export LC_ALL PATH

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SITE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
POLICY=$SITE_ROOT/operations/isolated-uat-control-plane-policy-v1.json
VALIDATOR=$SITE_ROOT/scripts/isolated-uat-control-plane-policy.py
TEST=$SITE_ROOT/tests/test_isolated_uat_control_plane_policy.py

[ -x /usr/bin/python3 ] || { echo "python3 is unavailable" >&2; exit 1; }
[ -f "$POLICY" ] && [ -f "$VALIDATOR" ] && [ -f "$TEST" ] || {
  echo "isolated UAT control-plane sources are incomplete" >&2
  exit 1
}

/usr/bin/python3 -B "$VALIDATOR" verify-policy --policy "$POLICY"
/usr/bin/python3 -B "$TEST"

echo "ISOLATED_UAT_CONTROL_PLANE_TEST_PASS"
