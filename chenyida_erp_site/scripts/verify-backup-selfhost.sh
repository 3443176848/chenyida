#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --offhost-root DIR --backup-id ID --migrations DIR --receipt-root DIR --receipt-reader-gid GID --location-id ID --transfer-id ID [--machine-identity-file FILE (TEST only)] --expected-deployment-class TEST|UAT|PRODUCTION --expected-deployment-id ID --expected-database-name NAME --expected-database-system-identifier ID --expected-database-oid OID --expected-database-marker ID --expected-database-bytes BYTES --expected-database-server-major N --expected-database-encoding ID --expected-database-collate ID --expected-database-ctype ID --expected-database-locale-provider libc --expected-database-collation-version ID --expected-app-version VERSION --expected-git-commit SHA --expected-web-image-digest sha256:SHA --expected-worker-image-digest sha256:SHA --expected-migration-head FILE --expected-policy-id ID --expected-rpo-hours 1..168 --confirm OFFHOST_COPY_RECEIVED_AND_IMMUTABLE" >&2
  exit 2
}

OFFHOST_ROOT=""; BACKUP_ID=""; MIGRATIONS=""; RECEIPT_ROOT=""; RECEIPT_READER_GID=""; LOCATION_ID=""; TRANSFER_ID=""; MACHINE_IDENTITY_FILE=""
EXPECTED_CLASS=""; EXPECTED_ID=""; EXPECTED_DATABASE=""; EXPECTED_SYSTEM_ID=""; EXPECTED_DATABASE_OID=""; EXPECTED_DATABASE_MARKER=""; EXPECTED_DATABASE_BYTES=""
EXPECTED_DATABASE_SERVER_MAJOR=""; EXPECTED_DATABASE_ENCODING=""; EXPECTED_DATABASE_COLLATE=""; EXPECTED_DATABASE_CTYPE=""; EXPECTED_DATABASE_LOCALE_PROVIDER=""; EXPECTED_DATABASE_COLLATION_VERSION=""
EXPECTED_VERSION=""; EXPECTED_GIT=""; EXPECTED_WEB_IMAGE=""; EXPECTED_WORKER_IMAGE=""; EXPECTED_MIGRATION=""; EXPECTED_POLICY=""; EXPECTED_RPO=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --offhost-root) OFFHOST_ROOT=${2:-}; shift 2 ;; --backup-id) BACKUP_ID=${2:-}; shift 2 ;; --migrations) MIGRATIONS=${2:-}; shift 2 ;; --receipt-root) RECEIPT_ROOT=${2:-}; shift 2 ;; --receipt-reader-gid) RECEIPT_READER_GID=${2:-}; shift 2 ;;
    --location-id) LOCATION_ID=${2:-}; shift 2 ;; --transfer-id) TRANSFER_ID=${2:-}; shift 2 ;; --machine-identity-file) MACHINE_IDENTITY_FILE=${2:-}; shift 2 ;; --expected-deployment-class) EXPECTED_CLASS=${2:-}; shift 2 ;;
    --expected-deployment-id) EXPECTED_ID=${2:-}; shift 2 ;; --expected-database-name) EXPECTED_DATABASE=${2:-}; shift 2 ;; --expected-database-system-identifier) EXPECTED_SYSTEM_ID=${2:-}; shift 2 ;;
    --expected-database-oid) EXPECTED_DATABASE_OID=${2:-}; shift 2 ;; --expected-database-marker) EXPECTED_DATABASE_MARKER=${2:-}; shift 2 ;; --expected-database-bytes) EXPECTED_DATABASE_BYTES=${2:-}; shift 2 ;;
    --expected-database-server-major) EXPECTED_DATABASE_SERVER_MAJOR=${2:-}; shift 2 ;; --expected-database-encoding) EXPECTED_DATABASE_ENCODING=${2:-}; shift 2 ;; --expected-database-collate) EXPECTED_DATABASE_COLLATE=${2:-}; shift 2 ;; --expected-database-ctype) EXPECTED_DATABASE_CTYPE=${2:-}; shift 2 ;; --expected-database-locale-provider) EXPECTED_DATABASE_LOCALE_PROVIDER=${2:-}; shift 2 ;; --expected-database-collation-version) EXPECTED_DATABASE_COLLATION_VERSION=${2:-}; shift 2 ;; --expected-app-version) EXPECTED_VERSION=${2:-}; shift 2 ;;
    --expected-git-commit) EXPECTED_GIT=${2:-}; shift 2 ;; --expected-web-image-digest) EXPECTED_WEB_IMAGE=${2:-}; shift 2 ;; --expected-worker-image-digest) EXPECTED_WORKER_IMAGE=${2:-}; shift 2 ;; --expected-migration-head) EXPECTED_MIGRATION=${2:-}; shift 2 ;;
    --expected-policy-id) EXPECTED_POLICY=${2:-}; shift 2 ;; --expected-rpo-hours) EXPECTED_RPO=${2:-}; shift 2 ;; --confirm) CONFIRM=${2:-}; shift 2 ;; *) usage ;;
  esac
done
for value in "$OFFHOST_ROOT" "$BACKUP_ID" "$MIGRATIONS" "$RECEIPT_ROOT" "$RECEIPT_READER_GID" "$LOCATION_ID" "$TRANSFER_ID" "$EXPECTED_CLASS" "$EXPECTED_ID" "$EXPECTED_DATABASE" "$EXPECTED_SYSTEM_ID" "$EXPECTED_DATABASE_OID" "$EXPECTED_DATABASE_MARKER" "$EXPECTED_DATABASE_BYTES" "$EXPECTED_DATABASE_SERVER_MAJOR" "$EXPECTED_DATABASE_ENCODING" "$EXPECTED_DATABASE_COLLATE" "$EXPECTED_DATABASE_CTYPE" "$EXPECTED_DATABASE_LOCALE_PROVIDER" "$EXPECTED_DATABASE_COLLATION_VERSION" "$EXPECTED_VERSION" "$EXPECTED_GIT" "$EXPECTED_WEB_IMAGE" "$EXPECTED_WORKER_IMAGE" "$EXPECTED_MIGRATION" "$EXPECTED_POLICY" "$EXPECTED_RPO" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$CONFIRM" = OFFHOST_COPY_RECEIVED_AND_IMMUTABLE ] || { echo "offhost receiver confirmation is required" >&2; exit 1; }
case "$EXPECTED_CLASS" in TEST|UAT|PRODUCTION) : ;; *) echo "invalid deployment class" >&2; exit 1 ;; esac
case "$EXPECTED_RPO:$EXPECTED_SYSTEM_ID:$EXPECTED_DATABASE_OID:$EXPECTED_DATABASE_BYTES:$EXPECTED_DATABASE_SERVER_MAJOR:$RECEIPT_READER_GID" in *[!0-9:]*|*::*|:*|*:) echo "numeric expectation is invalid" >&2; exit 1 ;; esac
[ "$EXPECTED_DATABASE_BYTES" -ge 1 ] || { echo "expected database bytes must be positive" >&2; exit 1; }
[ "$EXPECTED_RPO" -ge 1 ] && [ "$EXPECTED_RPO" -le 168 ] || { echo "RPO must be between 1 and 168 hours" >&2; exit 1; }
[ "$EXPECTED_DATABASE_LOCALE_PROVIDER" = libc ] || { echo "backup recovery v2 currently supports only an explicitly bound libc database locale" >&2; exit 1; }
for value in "$BACKUP_ID" "$LOCATION_ID" "$TRANSFER_ID" "$EXPECTED_ID" "$EXPECTED_DATABASE" "$EXPECTED_DATABASE_MARKER" "$EXPECTED_DATABASE_ENCODING" "$EXPECTED_DATABASE_COLLATE" "$EXPECTED_DATABASE_CTYPE" "$EXPECTED_DATABASE_LOCALE_PROVIDER" "$EXPECTED_DATABASE_COLLATION_VERSION" "$EXPECTED_POLICY"; do case "$value" in *[!A-Za-z0-9_.-]*|'') echo "invalid bounded identifier" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "identifier is too long" >&2; exit 1; }; done

validate_root() { candidate=$1; marker_name=$2; marker_value=$3; [ -d "$candidate" ] && [ ! -L "$candidate" ] || { echo "dedicated root is missing or unsafe" >&2; exit 1; }; candidate=$(readlink -f "$candidate"); [ "$(stat -c %u "$candidate")" = "$(id -u)" ] || { echo "dedicated root owner mismatch" >&2; exit 1; }; case "$(stat -c %a "$candidate")" in 700|750|2750) : ;; *) echo "dedicated root mode is unsafe" >&2; exit 1 ;; esac; marker="$candidate/$marker_name"; [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(stat -c %h "$marker")" = 1 ] && [ "$(stat -c %u "$marker")" = "$(id -u)" ] || { echo "dedicated root marker is unsafe" >&2; exit 1; }; case "$(stat -c %a "$marker")" in 400|600) : ;; *) echo "dedicated root marker mode is unsafe" >&2; exit 1 ;; esac; [ "$(cat "$marker")" = "$marker_value" ] || { echo "dedicated root marker is invalid" >&2; exit 1; }; printf '%s\n' "$candidate"; }
inside() { [ "$1" = "$2" ] || case "$1/" in "$2"/*) return 0 ;; *) return 1 ;; esac; }
overlap() { inside "$1" "$2" || inside "$2" "$1"; }
OFFHOST_ROOT=$(validate_root "$OFFHOST_ROOT" .chenyida-erp-offhost-root-v2 chenyida-erp-offhost-root/v2)
RECEIPT_ROOT=$(validate_root "$RECEIPT_ROOT" .chenyida-erp-receipt-root-v2 chenyida-erp-receipt-root/v2)
[ "$(stat -c %a "$RECEIPT_ROOT")" = 2750 ] && [ "$(stat -c %g "$RECEIPT_ROOT")" = "$RECEIPT_READER_GID" ] || { echo "receipt root reader mode or group is invalid" >&2; exit 1; }
[ -d "$MIGRATIONS" ] && [ ! -L "$MIGRATIONS" ] || { echo "migrations directory is unsafe" >&2; exit 1; }; MIGRATIONS=$(readlink -f "$MIGRATIONS")
REPO_ROOT=$(readlink -f "$(dirname "$0")/..")
for pair in "$OFFHOST_ROOT|$RECEIPT_ROOT" "$OFFHOST_ROOT|$MIGRATIONS" "$RECEIPT_ROOT|$MIGRATIONS" "$OFFHOST_ROOT|$REPO_ROOT" "$RECEIPT_ROOT|$REPO_ROOT"; do left=${pair%%|*}; right=${pair#*|}; overlap "$left" "$right" && { echo "offhost verification roots overlap protected paths" >&2; exit 1; }; done
BACKUP="$OFFHOST_ROOT/$BACKUP_ID"; LOCAL_RECEIPT="$OFFHOST_ROOT/$BACKUP_ID.local.json"
[ -d "$BACKUP" ] && [ ! -L "$BACKUP" ] && [ -f "$LOCAL_RECEIPT" ] && [ ! -L "$LOCAL_RECEIPT" ] || { echo "offhost transfer is incomplete" >&2; exit 1; }

umask 077
RELEASE_GATE_LOCK_HELPER=$(dirname "$0")/release-gate-lock.sh
[ -f "$RELEASE_GATE_LOCK_HELPER" ] && [ ! -L "$RELEASE_GATE_LOCK_HELPER" ] && [ "$(stat -c %h "$RELEASE_GATE_LOCK_HELPER")" = 1 ] && [ "$(stat -c %u "$RELEASE_GATE_LOCK_HELPER")" = "$(id -u)" ] && [ $((0$(stat -c %a "$RELEASE_GATE_LOCK_HELPER") & 0022)) -eq 0 ] || { echo "release gate lock helper is unsafe" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$RELEASE_GATE_LOCK_HELPER"
acquire_chenyida_release_gate_lock
exec 9>"$OFFHOST_ROOT/.offhost-v2.lock"; flock -n 9 || { echo "offhost backup root is busy" >&2; exit 1; }
exec 6>"$RECEIPT_ROOT/.receipt-v2.lock"; flock -n 6 || { echo "verification receipt root is busy" >&2; exit 1; }
CONTRACT="$(dirname "$0")/backup-recovery-contract.mjs"
contract() { NODE_OPTIONS=--max-old-space-size=384 node "$CONTRACT" "$@"; }
MEM_AVAILABLE_KIB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
SWAP_TOTAL_KIB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
SWAP_FREE_KIB=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
LOAD_ONE=$(awk '{print $1}' /proc/loadavg)
case "$MEM_AVAILABLE_KIB:$SWAP_TOTAL_KIB:$SWAP_FREE_KIB" in *[!0-9:]*|*::*|:*|*:) echo "host memory preflight is unavailable" >&2; exit 1 ;; esac
[ "$MEM_AVAILABLE_KIB" -ge 786432 ] || { echo "available memory is below the 768 MiB verification floor" >&2; exit 1; }
if [ "$SWAP_TOTAL_KIB" -gt 0 ]; then [ $(((SWAP_TOTAL_KIB - SWAP_FREE_KIB) * 100 / SWAP_TOTAL_KIB)) -le 80 ] || { echo "swap use exceeds the 80 percent verification ceiling" >&2; exit 1; }; fi
awk -v load_value="$LOAD_ONE" 'BEGIN { exit !(load_value ~ /^[0-9]+([.][0-9]+)?$/ && load_value <= 4) }' || { echo "one-minute load exceeds the verification ceiling" >&2; exit 1; }
[ "$(df -Pk / | awk 'NR==2 {print $4}')" -ge 10485760 ] || { echo "root filesystem free space is below 10 GiB" >&2; exit 1; }
if [ -n "$MACHINE_IDENTITY_FILE" ] && [ "${NODE_ENV:-}" != test ]; then echo "machine identity override is restricted to NODE_ENV=test" >&2; exit 1; fi
contract durably-sync-tree --root "$BACKUP" >/dev/null
contract durably-sync-file --file "$LOCAL_RECEIPT" >/dev/null

set -- verify-offhost --backup "$BACKUP" --migrations "$MIGRATIONS" --receiver-root "$OFFHOST_ROOT" --local-receipt "$LOCAL_RECEIPT" --location-id "$LOCATION_ID" --transfer-id "$TRANSFER_ID" --receipt-root "$RECEIPT_ROOT"
[ -z "$MACHINE_IDENTITY_FILE" ] || set -- "$@" --machine-identity-file "$MACHINE_IDENTITY_FILE"
set -- "$@" --expected-deployment-class "$EXPECTED_CLASS" --expected-deployment-id "$EXPECTED_ID" --expected-database-name "$EXPECTED_DATABASE" --expected-database-system-identifier "$EXPECTED_SYSTEM_ID" --expected-database-oid "$EXPECTED_DATABASE_OID" --expected-database-marker "$EXPECTED_DATABASE_MARKER" --expected-database-bytes "$EXPECTED_DATABASE_BYTES" \
  --expected-database-server-major "$EXPECTED_DATABASE_SERVER_MAJOR" --expected-database-encoding "$EXPECTED_DATABASE_ENCODING" --expected-database-collate "$EXPECTED_DATABASE_COLLATE" --expected-database-ctype "$EXPECTED_DATABASE_CTYPE" --expected-database-locale-provider "$EXPECTED_DATABASE_LOCALE_PROVIDER" --expected-database-collation-version "$EXPECTED_DATABASE_COLLATION_VERSION" \
  --expected-app-version "$EXPECTED_VERSION" --expected-git-commit "$EXPECTED_GIT" --expected-web-image-digest "$EXPECTED_WEB_IMAGE" --expected-worker-image-digest "$EXPECTED_WORKER_IMAGE" --expected-migration-head "$EXPECTED_MIGRATION" --expected-policy-id "$EXPECTED_POLICY" --expected-rpo-hours "$EXPECTED_RPO"
contract "$@" >/dev/null
[ -f "$RECEIPT_ROOT/$BACKUP_ID.offhost.json" ] && [ -f "$RECEIPT_ROOT/offhost.json" ] && [ -f "$RECEIPT_ROOT/latest.json" ] || { echo "offhost verification receipt publication failed" >&2; exit 1; }
for receipt in "$RECEIPT_ROOT/$BACKUP_ID.offhost.json" "$RECEIPT_ROOT/offhost.json" "$RECEIPT_ROOT/latest.json"; do [ "$(stat -c %a "$receipt")" = 640 ] && [ "$(stat -c %g "$receipt")" = "$RECEIPT_READER_GID" ] || { echo "verification receipt reader mode or group is invalid" >&2; exit 1; }; done
echo "offhost backup v2 verified at receiver: $BACKUP_ID"
