#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --restore-root DIR --receipt-root DIR --receipt-reader-gid GID --backup-id ID --restore-run-id ID --confirm PUBLISH_PREPARED_RESTORE_RECEIPT" >&2
  exit 2
}

RESTORE_ROOT=""; RECEIPT_ROOT=""; RECEIPT_READER_GID=""; BACKUP_ID=""; RESTORE_RUN_ID=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --restore-root) RESTORE_ROOT=${2:-}; shift 2 ;;
    --receipt-root) RECEIPT_ROOT=${2:-}; shift 2 ;;
    --receipt-reader-gid) RECEIPT_READER_GID=${2:-}; shift 2 ;;
    --backup-id) BACKUP_ID=${2:-}; shift 2 ;;
    --restore-run-id) RESTORE_RUN_ID=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

for value in "$RESTORE_ROOT" "$RECEIPT_ROOT" "$RECEIPT_READER_GID" "$BACKUP_ID" "$RESTORE_RUN_ID" "$CONFIRM"; do [ -n "$value" ] || usage; done
[ "$CONFIRM" = PUBLISH_PREPARED_RESTORE_RECEIPT ] || { echo "prepared receipt publication confirmation is invalid" >&2; exit 1; }
case "$RECEIPT_READER_GID" in *[!0-9]*|'') echo "receipt reader GID is invalid" >&2; exit 1 ;; esac
for value in "$BACKUP_ID" "$RESTORE_RUN_ID"; do case "$value" in *[!A-Za-z0-9_.-]*|'') echo "invalid bounded identifier" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "identifier is too long" >&2; exit 1; }; done

validate_root() {
  candidate=$1; marker_name=$2; marker_value=$3; expected_mode=$4
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || { echo "dedicated root is missing or unsafe" >&2; exit 1; }
  candidate=$(readlink -f "$candidate")
  [ "$(stat -c %u "$candidate")" = "$(id -u)" ] && [ "$(stat -c %a "$candidate")" = "$expected_mode" ] || { echo "dedicated root owner or mode is invalid" >&2; exit 1; }
  marker="$candidate/$marker_name"
  [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(stat -c %h "$marker")" = 1 ] && [ "$(stat -c %u "$marker")" = "$(id -u)" ] || { echo "dedicated root marker is unsafe" >&2; exit 1; }
  case "$(stat -c %a "$marker")" in 400|600) : ;; *) echo "dedicated root marker mode is unsafe" >&2; exit 1 ;; esac
  [ "$(cat "$marker")" = "$marker_value" ] || { echo "dedicated root marker is invalid" >&2; exit 1; }
  printf '%s\n' "$candidate"
}

RESTORE_ROOT=$(validate_root "$RESTORE_ROOT" .chenyida-erp-restore-root-v2 chenyida-erp-restore-root/v2 700)
RECEIPT_ROOT=$(validate_root "$RECEIPT_ROOT" .chenyida-erp-receipt-root-v2 chenyida-erp-receipt-root/v2 2750)
[ "$RESTORE_ROOT" != "$RECEIPT_ROOT" ] || { echo "restore and receipt roots must be distinct" >&2; exit 1; }
[ "$(stat -c %g "$RECEIPT_ROOT")" = "$RECEIPT_READER_GID" ] || { echo "receipt root reader GID mismatch" >&2; exit 1; }

PREPARED_RECEIPT="$RESTORE_ROOT/.prepared-$BACKUP_ID-$RESTORE_RUN_ID.json"
[ -f "$PREPARED_RECEIPT" ] && [ ! -L "$PREPARED_RECEIPT" ] && [ "$(stat -c %h "$PREPARED_RECEIPT")" = 1 ] \
  && [ "$(stat -c %u "$PREPARED_RECEIPT")" = "$(id -u)" ] && [ "$(stat -c %a "$PREPARED_RECEIPT")" = 400 ] \
  || { echo "prepared restore receipt is missing or unsafe" >&2; exit 1; }

umask 077
for lock_file in "$RESTORE_ROOT/.restore-v2.lock" "$RECEIPT_ROOT/.receipt-v2.lock"; do [ ! -L "$lock_file" ] || { echo "receipt publication lock path is unsafe" >&2; exit 1; }; done
exec 9>"$RESTORE_ROOT/.restore-v2.lock"; flock -n 9 || { echo "restore root is busy" >&2; exit 1; }
exec 6>"$RECEIPT_ROOT/.receipt-v2.lock"; flock -n 6 || { echo "verification receipt root is busy" >&2; exit 1; }
for lock_file in "$RESTORE_ROOT/.restore-v2.lock" "$RECEIPT_ROOT/.receipt-v2.lock"; do
  [ -f "$lock_file" ] && [ ! -L "$lock_file" ] && [ "$(stat -c %h "$lock_file")" = 1 ] && [ "$(stat -c %u "$lock_file")" = "$(id -u)" ] || { echo "receipt publication lock identity is unsafe" >&2; exit 1; }
  chmod 0600 "$lock_file"
done

CONTRACT="$(dirname "$0")/backup-recovery-contract.mjs"
NODE_OPTIONS=--max-old-space-size=384 node "$CONTRACT" publish-prepared-restore --prepared-receipt "$PREPARED_RECEIPT" --receipt-root "$RECEIPT_ROOT" >/dev/null

IMMUTABLE_RECEIPT="$RECEIPT_ROOT/$BACKUP_ID.$RESTORE_RUN_ID.restore.json"
for receipt in "$IMMUTABLE_RECEIPT" "$RECEIPT_ROOT/restore.json" "$RECEIPT_ROOT/latest.json"; do
  [ -f "$receipt" ] && [ ! -L "$receipt" ] && [ "$(stat -c %a "$receipt")" = 640 ] && [ "$(stat -c %g "$receipt")" = "$RECEIPT_READER_GID" ] || { echo "restore receipt reader mode or group is invalid" >&2; exit 1; }
done
echo "prepared restore receipt published without re-running restore: $BACKUP_ID/$RESTORE_RUN_ID"
