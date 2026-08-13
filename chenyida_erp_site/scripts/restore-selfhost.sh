#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --credential-root DIR --db-service-file FILE --db-admin-service NAME --source-deployment-class TEST|UAT|PRODUCTION --source-deployment-id ID --source-database-name NAME --source-database-system-identifier ID --source-database-oid OID --source-database-marker ID --source-database-bytes BYTES --source-database-server-major N --source-database-encoding ID --source-database-collate ID --source-database-ctype ID --source-database-locale-provider libc --source-database-collation-version ID --offhost-root TRANSIENT_DIR --receiver-package DIR --source-acceptance FILE --receiver-key-root DIR --receiver-encryption-private-key FILE --trusted-source-signing-public-key FILE --receiver-receipt-public-key FILE --operations-policy FILE --transfer-id ID --backup-id ID --migrations DIR --receipt-root DIR --restore-root DIR --target-database-capacity-path DIR --receipt-reader-gid GID --target-deployment-class TEST --target-deployment-id ID --target-admin-database NAME --target-database-name NAME_restore_test --target-marker-id ID --target-cluster-marker-id ID --expected-target-system-identifier ID --restore-run-id ID --location-id ID --expected-app-version VERSION --expected-git-commit SHA --expected-web-image-digest sha256:SHA --expected-worker-image-digest sha256:SHA --expected-migration-head FILE --expected-policy-id ID --expected-rpo-hours 1..168 --confirm RESTORE_SIGNED_ENCRYPTED_OFFHOST_TO_MARKED_DISPOSABLE_TEST_TARGET" >&2
  exit 2
}

CREDENTIAL_ROOT=""; SERVICE_FILE=""; DB_SERVICE=""
SOURCE_CLASS=""; SOURCE_ID=""; SOURCE_DATABASE=""; SOURCE_SYSTEM_ID=""; SOURCE_DATABASE_OID=""; SOURCE_DATABASE_MARKER=""; SOURCE_DATABASE_BYTES=""
SOURCE_DATABASE_SERVER_MAJOR=""; SOURCE_DATABASE_ENCODING=""; SOURCE_DATABASE_COLLATE=""; SOURCE_DATABASE_CTYPE=""; SOURCE_DATABASE_LOCALE_PROVIDER=""; SOURCE_DATABASE_COLLATION_VERSION=""
OFFHOST_ROOT=""; RECEIVER_PACKAGE=""; SOURCE_ACCEPTANCE=""; RECEIVER_KEY_ROOT=""; RECEIVER_ENCRYPTION_PRIVATE_KEY=""; TRUSTED_SOURCE_SIGNING_PUBLIC_KEY=""; RECEIVER_RECEIPT_PUBLIC_KEY=""; OPERATIONS_POLICY=""; TRANSFER_ID=""; BACKUP_ID=""; MIGRATIONS=""; RECEIPT_ROOT=""; RESTORE_ROOT=""; TARGET_DATABASE_CAPACITY_PATH=""; RECEIPT_READER_GID=""
TARGET_CLASS=""; TARGET_ID=""; TARGET_ADMIN_DATABASE=""; TARGET_DATABASE=""; TARGET_MARKER_ID=""; TARGET_CLUSTER_MARKER_ID=""; EXPECTED_TARGET_SYSTEM_ID=""
RESTORE_RUN_ID=""; LOCATION_ID=""; EXPECTED_VERSION=""; EXPECTED_GIT=""; EXPECTED_WEB_IMAGE=""; EXPECTED_WORKER_IMAGE=""; EXPECTED_MIGRATION=""; EXPECTED_POLICY=""; EXPECTED_RPO=""; CONFIRM=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --credential-root) CREDENTIAL_ROOT=${2:-}; shift 2 ;; --db-service-file) SERVICE_FILE=${2:-}; shift 2 ;; --db-admin-service) DB_SERVICE=${2:-}; shift 2 ;;
    --source-deployment-class) SOURCE_CLASS=${2:-}; shift 2 ;; --source-deployment-id) SOURCE_ID=${2:-}; shift 2 ;; --source-database-name) SOURCE_DATABASE=${2:-}; shift 2 ;;
    --source-database-system-identifier) SOURCE_SYSTEM_ID=${2:-}; shift 2 ;; --source-database-oid) SOURCE_DATABASE_OID=${2:-}; shift 2 ;; --source-database-marker) SOURCE_DATABASE_MARKER=${2:-}; shift 2 ;; --source-database-bytes) SOURCE_DATABASE_BYTES=${2:-}; shift 2 ;;
    --source-database-server-major) SOURCE_DATABASE_SERVER_MAJOR=${2:-}; shift 2 ;; --source-database-encoding) SOURCE_DATABASE_ENCODING=${2:-}; shift 2 ;;
    --source-database-collate) SOURCE_DATABASE_COLLATE=${2:-}; shift 2 ;; --source-database-ctype) SOURCE_DATABASE_CTYPE=${2:-}; shift 2 ;;
    --source-database-locale-provider) SOURCE_DATABASE_LOCALE_PROVIDER=${2:-}; shift 2 ;; --source-database-collation-version) SOURCE_DATABASE_COLLATION_VERSION=${2:-}; shift 2 ;;
    --offhost-root) OFFHOST_ROOT=${2:-}; shift 2 ;; --receiver-package) RECEIVER_PACKAGE=${2:-}; shift 2 ;; --source-acceptance) SOURCE_ACCEPTANCE=${2:-}; shift 2 ;; --receiver-key-root) RECEIVER_KEY_ROOT=${2:-}; shift 2 ;; --receiver-encryption-private-key) RECEIVER_ENCRYPTION_PRIVATE_KEY=${2:-}; shift 2 ;; --trusted-source-signing-public-key) TRUSTED_SOURCE_SIGNING_PUBLIC_KEY=${2:-}; shift 2 ;; --receiver-receipt-public-key) RECEIVER_RECEIPT_PUBLIC_KEY=${2:-}; shift 2 ;; --operations-policy) OPERATIONS_POLICY=${2:-}; shift 2 ;; --transfer-id) TRANSFER_ID=${2:-}; shift 2 ;; --backup-id) BACKUP_ID=${2:-}; shift 2 ;; --migrations) MIGRATIONS=${2:-}; shift 2 ;; --receipt-root) RECEIPT_ROOT=${2:-}; shift 2 ;; --restore-root) RESTORE_ROOT=${2:-}; shift 2 ;; --target-database-capacity-path) TARGET_DATABASE_CAPACITY_PATH=${2:-}; shift 2 ;; --receipt-reader-gid) RECEIPT_READER_GID=${2:-}; shift 2 ;;
    --target-deployment-class) TARGET_CLASS=${2:-}; shift 2 ;; --target-deployment-id) TARGET_ID=${2:-}; shift 2 ;; --target-admin-database) TARGET_ADMIN_DATABASE=${2:-}; shift 2 ;;
    --target-database-name) TARGET_DATABASE=${2:-}; shift 2 ;; --target-marker-id) TARGET_MARKER_ID=${2:-}; shift 2 ;; --target-cluster-marker-id) TARGET_CLUSTER_MARKER_ID=${2:-}; shift 2 ;; --expected-target-system-identifier) EXPECTED_TARGET_SYSTEM_ID=${2:-}; shift 2 ;;
    --restore-run-id) RESTORE_RUN_ID=${2:-}; shift 2 ;; --location-id) LOCATION_ID=${2:-}; shift 2 ;;
    --expected-app-version) EXPECTED_VERSION=${2:-}; shift 2 ;; --expected-git-commit) EXPECTED_GIT=${2:-}; shift 2 ;; --expected-web-image-digest) EXPECTED_WEB_IMAGE=${2:-}; shift 2 ;; --expected-worker-image-digest) EXPECTED_WORKER_IMAGE=${2:-}; shift 2 ;; --expected-migration-head) EXPECTED_MIGRATION=${2:-}; shift 2 ;; --expected-policy-id) EXPECTED_POLICY=${2:-}; shift 2 ;; --expected-rpo-hours) EXPECTED_RPO=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;; *) usage ;;
  esac
done

for value in "$CREDENTIAL_ROOT" "$SERVICE_FILE" "$DB_SERVICE" "$SOURCE_CLASS" "$SOURCE_ID" "$SOURCE_DATABASE" "$SOURCE_SYSTEM_ID" "$SOURCE_DATABASE_OID" "$SOURCE_DATABASE_MARKER" "$SOURCE_DATABASE_BYTES" "$SOURCE_DATABASE_SERVER_MAJOR" "$SOURCE_DATABASE_ENCODING" "$SOURCE_DATABASE_COLLATE" "$SOURCE_DATABASE_CTYPE" "$SOURCE_DATABASE_LOCALE_PROVIDER" "$SOURCE_DATABASE_COLLATION_VERSION" "$OFFHOST_ROOT" "$RECEIVER_PACKAGE" "$SOURCE_ACCEPTANCE" "$RECEIVER_KEY_ROOT" "$RECEIVER_ENCRYPTION_PRIVATE_KEY" "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY" "$RECEIVER_RECEIPT_PUBLIC_KEY" "$OPERATIONS_POLICY" "$TRANSFER_ID" "$BACKUP_ID" "$MIGRATIONS" "$RECEIPT_ROOT" "$RESTORE_ROOT" "$TARGET_DATABASE_CAPACITY_PATH" "$RECEIPT_READER_GID" "$TARGET_CLASS" "$TARGET_ID" "$TARGET_ADMIN_DATABASE" "$TARGET_DATABASE" "$TARGET_MARKER_ID" "$TARGET_CLUSTER_MARKER_ID" "$EXPECTED_TARGET_SYSTEM_ID" "$RESTORE_RUN_ID" "$LOCATION_ID" "$EXPECTED_VERSION" "$EXPECTED_GIT" "$EXPECTED_WEB_IMAGE" "$EXPECTED_WORKER_IMAGE" "$EXPECTED_MIGRATION" "$EXPECTED_POLICY" "$EXPECTED_RPO" "$CONFIRM"; do [ -n "$value" ] || usage; done
case "$SOURCE_CLASS" in TEST|UAT|PRODUCTION) : ;; *) echo "invalid source deployment class" >&2; exit 1 ;; esac
[ "$TARGET_CLASS" = TEST ] && [ "$CONFIRM" = RESTORE_SIGNED_ENCRYPTED_OFFHOST_TO_MARKED_DISPOSABLE_TEST_TARGET ] || { echo "restore is restricted to signed encrypted offhost evidence and marked disposable TEST targets" >&2; exit 1; }
case "$TARGET_DATABASE" in *_restore_test) : ;; *) echo "target database name must end with _restore_test" >&2; exit 1 ;; esac
[ "$TARGET_ADMIN_DATABASE" != "$TARGET_DATABASE" ] || { echo "target admin database must be distinct from the restore database" >&2; exit 1; }
[ "$SOURCE_DATABASE_LOCALE_PROVIDER" = libc ] || { echo "backup recovery v2 currently supports only an explicitly bound libc database locale" >&2; exit 1; }
case "$EXPECTED_RPO:$SOURCE_SYSTEM_ID:$SOURCE_DATABASE_OID:$SOURCE_DATABASE_BYTES:$SOURCE_DATABASE_SERVER_MAJOR:$EXPECTED_TARGET_SYSTEM_ID:$RECEIPT_READER_GID" in *[!0-9:]*|*::*|:*|*:) echo "numeric expectation is invalid" >&2; exit 1 ;; esac
[ "$SOURCE_DATABASE_BYTES" -ge 1 ] || { echo "source database bytes must be positive" >&2; exit 1; }
[ "$SOURCE_SYSTEM_ID" != "$EXPECTED_TARGET_SYSTEM_ID" ] || { echo "restore target PostgreSQL cluster must be distinct from the source cluster" >&2; exit 1; }
[ "$EXPECTED_RPO" -ge 1 ] && [ "$EXPECTED_RPO" -le 168 ] || { echo "RPO must be between 1 and 168 hours" >&2; exit 1; }
for value in "$DB_SERVICE" "$SOURCE_ID" "$SOURCE_DATABASE" "$SOURCE_DATABASE_MARKER" "$SOURCE_DATABASE_ENCODING" "$SOURCE_DATABASE_COLLATE" "$SOURCE_DATABASE_CTYPE" "$SOURCE_DATABASE_LOCALE_PROVIDER" "$SOURCE_DATABASE_COLLATION_VERSION" "$TRANSFER_ID" "$BACKUP_ID" "$TARGET_ID" "$TARGET_ADMIN_DATABASE" "$TARGET_DATABASE" "$TARGET_MARKER_ID" "$TARGET_CLUSTER_MARKER_ID" "$RESTORE_RUN_ID" "$LOCATION_ID" "$EXPECTED_MIGRATION" "$EXPECTED_POLICY"; do
  case "$value" in *[!A-Za-z0-9_.-]*|'') echo "invalid bounded identifier" >&2; exit 1 ;; esac
  [ "${#value}" -le 120 ] || { echo "identifier is too long" >&2; exit 1; }
done
case "$EXPECTED_VERSION" in 0.1.0-alpha.[0-9]|0.1.0-alpha.[0-9][0-9]|0.1.0-alpha.[0-9][0-9][0-9]) : ;; *) echo "expected application version is invalid" >&2; exit 1 ;; esac
case "$EXPECTED_GIT" in *[!0-9a-f]*|'') echo "expected Git revision is invalid" >&2; exit 1 ;; esac
[ "${#EXPECTED_GIT}" -eq 40 ] || { echo "expected Git revision is invalid" >&2; exit 1; }
for digest in "$EXPECTED_WEB_IMAGE" "$EXPECTED_WORKER_IMAGE"; do case "$digest" in sha256:[0-9a-f][0-9a-f]*) : ;; *) echo "expected image digest is invalid" >&2; exit 1 ;; esac; [ "${#digest}" -eq 71 ] || { echo "expected image digest is invalid" >&2; exit 1; }; done

inside() { [ "$1" = "$2" ] || case "$1/" in "$2"/*) return 0 ;; *) return 1 ;; esac; }
overlap() { inside "$1" "$2" || inside "$2" "$1"; }
validate_root() {
  candidate=$1; marker_name=$2; marker_value=$3
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || { echo "dedicated root is missing or unsafe" >&2; exit 1; }
  candidate=$(readlink -f "$candidate")
  [ "$(stat -c %u "$candidate")" = "$(id -u)" ] || { echo "dedicated root owner mismatch" >&2; exit 1; }
  case "$(stat -c %a "$candidate")" in 700|750|2750) : ;; *) echo "dedicated root mode is unsafe" >&2; exit 1 ;; esac
  marker="$candidate/$marker_name"
  [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(stat -c %h "$marker")" = 1 ] && [ "$(stat -c %u "$marker")" = "$(id -u)" ] || { echo "dedicated root marker is unsafe" >&2; exit 1; }
  case "$(stat -c %a "$marker")" in 400|600) : ;; *) echo "dedicated root marker mode is unsafe" >&2; exit 1 ;; esac
  [ "$(cat "$marker")" = "$marker_value" ] || { echo "dedicated root marker is invalid" >&2; exit 1; }
  printf '%s\n' "$candidate"
}

OFFHOST_ROOT=$(validate_root "$OFFHOST_ROOT" .chenyida-erp-offhost-root-v2 chenyida-erp-offhost-root/v2)
RECEIPT_ROOT=$(validate_root "$RECEIPT_ROOT" .chenyida-erp-receipt-root-v2 chenyida-erp-receipt-root/v2)
RESTORE_ROOT=$(validate_root "$RESTORE_ROOT" .chenyida-erp-restore-root-v2 chenyida-erp-restore-root/v2)
CREDENTIAL_ROOT=$(validate_root "$CREDENTIAL_ROOT" .chenyida-erp-credential-root-v2 chenyida-erp-credential-root/v2)
[ -d "$RECEIVER_PACKAGE" ] && [ ! -L "$RECEIVER_PACKAGE" ] && [ "$(stat -c %u "$RECEIVER_PACKAGE")" = "$(id -u)" ] && [ $((0$(stat -c %a "$RECEIVER_PACKAGE") & 0022)) -eq 0 ] || { echo "receiver package directory is unsafe" >&2; exit 1; }
RECEIVER_PACKAGE=$(readlink -f "$RECEIVER_PACKAGE")
[ -d "$RECEIVER_KEY_ROOT" ] && [ ! -L "$RECEIVER_KEY_ROOT" ] && [ "$(stat -c %u "$RECEIVER_KEY_ROOT")" = "$(id -u)" ] && [ $((0$(stat -c %a "$RECEIVER_KEY_ROOT") & 0022)) -eq 0 ] || { echo "receiver key root is unsafe" >&2; exit 1; }
RECEIVER_KEY_ROOT=$(readlink -f "$RECEIVER_KEY_ROOT")
validate_evidence_file() {
  evidence_file=$1
  [ -f "$evidence_file" ] && [ ! -L "$evidence_file" ] && [ "$(stat -c %h "$evidence_file")" = 1 ] && [ "$(stat -c %u "$evidence_file")" = "$(id -u)" ] && [ $((0$(stat -c %a "$evidence_file") & 0022)) -eq 0 ] || { echo "offhost evidence or key file is unsafe" >&2; exit 1; }
  readlink -f "$evidence_file"
}
SOURCE_ACCEPTANCE=$(validate_evidence_file "$SOURCE_ACCEPTANCE")
RECEIVER_ENCRYPTION_PRIVATE_KEY=$(validate_evidence_file "$RECEIVER_ENCRYPTION_PRIVATE_KEY")
TRUSTED_SOURCE_SIGNING_PUBLIC_KEY=$(validate_evidence_file "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY")
RECEIVER_RECEIPT_PUBLIC_KEY=$(validate_evidence_file "$RECEIVER_RECEIPT_PUBLIC_KEY")
OPERATIONS_POLICY=$(validate_evidence_file "$OPERATIONS_POLICY")
[ -d "$TARGET_DATABASE_CAPACITY_PATH" ] && [ ! -L "$TARGET_DATABASE_CAPACITY_PATH" ] || { echo "target database capacity path is missing or unsafe" >&2; exit 1; }
TARGET_DATABASE_CAPACITY_PATH=$(readlink -f "$TARGET_DATABASE_CAPACITY_PATH")
[ "$(stat -c %a "$RECEIPT_ROOT")" = 2750 ] && [ "$(stat -c %g "$RECEIPT_ROOT")" = "$RECEIPT_READER_GID" ] || { echo "receipt root reader mode or group is invalid" >&2; exit 1; }
[ -d "$MIGRATIONS" ] && [ ! -L "$MIGRATIONS" ] || { echo "migrations directory is unsafe" >&2; exit 1; }
MIGRATIONS=$(readlink -f "$MIGRATIONS")
REPO_ROOT=$(readlink -f "$(dirname "$0")/..")
for pair in "$OFFHOST_ROOT|$RECEIPT_ROOT" "$OFFHOST_ROOT|$RESTORE_ROOT" "$OFFHOST_ROOT|$CREDENTIAL_ROOT" "$OFFHOST_ROOT|$RECEIVER_PACKAGE" "$OFFHOST_ROOT|$RECEIVER_KEY_ROOT" "$RECEIPT_ROOT|$RESTORE_ROOT" "$RECEIPT_ROOT|$CREDENTIAL_ROOT" "$RECEIPT_ROOT|$RECEIVER_PACKAGE" "$RECEIPT_ROOT|$RECEIVER_KEY_ROOT" "$RESTORE_ROOT|$CREDENTIAL_ROOT" "$RESTORE_ROOT|$RECEIVER_PACKAGE" "$RESTORE_ROOT|$RECEIVER_KEY_ROOT" "$RECEIVER_PACKAGE|$RECEIVER_KEY_ROOT" "$OFFHOST_ROOT|$MIGRATIONS" "$RECEIPT_ROOT|$MIGRATIONS" "$RESTORE_ROOT|$MIGRATIONS" "$OFFHOST_ROOT|$REPO_ROOT" "$RECEIPT_ROOT|$REPO_ROOT" "$RESTORE_ROOT|$REPO_ROOT" "$CREDENTIAL_ROOT|$REPO_ROOT" "$RECEIVER_PACKAGE|$REPO_ROOT" "$RECEIVER_KEY_ROOT|$REPO_ROOT"; do
  left=${pair%%|*}; right=${pair#*|}; overlap "$left" "$right" && { echo "restore roots overlap protected paths" >&2; exit 1; }
done

[ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ] || { echo "database service file is missing or unsafe" >&2; exit 1; }
SERVICE_FILE=$(readlink -f "$SERVICE_FILE")
inside "$SERVICE_FILE" "$CREDENTIAL_ROOT" && [ "$SERVICE_FILE" != "$CREDENTIAL_ROOT/.chenyida-erp-credential-root-v2" ] || { echo "database service file must be inside the credential root" >&2; exit 1; }
[ "$(stat -c %h "$SERVICE_FILE")" = 1 ] && [ "$(stat -c %u "$SERVICE_FILE")" = "$(id -u)" ] || { echo "database service file identity is unsafe" >&2; exit 1; }
case "$(stat -c %a "$SERVICE_FILE")" in 400|600) : ;; *) echo "database service file mode is unsafe" >&2; exit 1 ;; esac
cursor=$(dirname "$SERVICE_FILE")
while :; do
  [ "$(stat -c %u "$cursor")" = "$(id -u)" ] && [ $((0$(stat -c %a "$cursor") & 0022)) -eq 0 ] || { echo "credential ancestor is unsafe" >&2; exit 1; }
  [ "$cursor" = "$CREDENTIAL_ROOT" ] && break
  parent=$(dirname "$cursor"); [ "$parent" != "$cursor" ] && inside "$parent" "$CREDENTIAL_ROOT" || { echo "credential path escapes its root" >&2; exit 1; }; cursor=$parent
done
if grep -Eiq '^[[:space:]]*(passfile|sslkey)[[:space:]]*=' "$SERVICE_FILE"; then echo "external libpq secret references are not accepted" >&2; exit 1; fi

umask 077
RELEASE_GATE_LOCK_HELPER=$(dirname "$0")/release-gate-lock.sh
[ -f "$RELEASE_GATE_LOCK_HELPER" ] && [ ! -L "$RELEASE_GATE_LOCK_HELPER" ] && [ "$(stat -c %h "$RELEASE_GATE_LOCK_HELPER")" = 1 ] && [ "$(stat -c %u "$RELEASE_GATE_LOCK_HELPER")" = "$(id -u)" ] && [ $((0$(stat -c %a "$RELEASE_GATE_LOCK_HELPER") & 0022)) -eq 0 ] || { echo "release gate lock helper is unsafe" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$RELEASE_GATE_LOCK_HELPER"
acquire_chenyida_release_gate_lock
exec 9>"$RESTORE_ROOT/.restore-v2.lock"; flock -n 9 || { echo "another restore is active for this root" >&2; exit 1; }
exec 7>"$OFFHOST_ROOT/.offhost-v2.lock"; flock -n 7 || { echo "transient offhost materialization root is busy" >&2; exit 1; }
exec 6>"$RECEIPT_ROOT/.receipt-v2.lock"; flock -n 6 || { echo "verification receipt root is busy" >&2; exit 1; }
exec 8<"$SERVICE_FILE"; flock -s -n 8 || { echo "database credential file is being modified" >&2; exit 1; }
SERVICE_FILE_IDENTITY=$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$SERVICE_FILE")
SERVICE_FILE_SHA256=$(sha256sum "$SERVICE_FILE" | awk '{print $1}')
credential_unchanged() {
  [ "$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$SERVICE_FILE" 2>/dev/null)" = "$SERVICE_FILE_IDENTITY" ] && [ "$(sha256sum "$SERVICE_FILE" 2>/dev/null | awk '{print $1}')" = "$SERVICE_FILE_SHA256" ] || { echo "database credential file changed during restore" >&2; return 1; }
}

BACKUP="$OFFHOST_ROOT/$BACKUP_ID"
MATERIALIZATION_RECEIPT="$OFFHOST_ROOT/$BACKUP_ID.$TRANSFER_ID.materialization.json"
OFFHOST_RECEIPT="$RECEIVER_PACKAGE/offhost-receipt.json"
OFFHOST_CONTRACT="$(dirname "$0")/offhost-transfer-contract.mjs"
offhost_contract() { NODE_OPTIONS=--max-old-space-size=384 node "$OFFHOST_CONTRACT" "$@"; }
offhost_materialization_args() {
  materialization_command=$1
  shift
  offhost_contract "$materialization_command" \
    --receiver-package "$RECEIVER_PACKAGE" \
    --acceptance "$SOURCE_ACCEPTANCE" \
    --receiver-key-root "$RECEIVER_KEY_ROOT" \
    --receiver-encryption-private-key "$RECEIVER_ENCRYPTION_PRIVATE_KEY" \
    --trusted-source-signing-public-key "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY" \
    --receiver-receipt-public-key "$RECEIVER_RECEIPT_PUBLIC_KEY" \
    --destination-root "$OFFHOST_ROOT" \
    --transfer-id "$TRANSFER_ID" \
    --backup-id "$BACKUP_ID" \
    --policy "$OPERATIONS_POLICY" "$@"
}
MATERIALIZATION_REQUESTED=1
cleanup_materialization() {
  [ "$MATERIALIZATION_REQUESTED" = 1 ] || return 0
  if [ ! -e "$BACKUP" ] && [ ! -e "$MATERIALIZATION_RECEIPT" ]; then MATERIALIZATION_REQUESTED=0; return 0; fi
  offhost_materialization_args cleanup-materialized-for-restore --confirm REMOVE_EXACT_VERIFIED_MATERIALIZATION >/dev/null || return 1
  [ ! -e "$BACKUP" ] && [ ! -e "$MATERIALIZATION_RECEIPT" ] || return 1
  MATERIALIZATION_REQUESTED=0
}
early_cleanup() {
  result=$?; trap - EXIT
  cleanup_materialization || { echo "transient offhost materialization cleanup failed; exact paths are quarantined" >&2; exit 1; }
  exit "$result"
}
trap early_cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
offhost_materialization_args materialize-for-restore >/dev/null
offhost_materialization_args verify-materialized-for-restore >/dev/null
[ -d "$BACKUP" ] && [ ! -L "$BACKUP" ] && [ -f "$OFFHOST_RECEIPT" ] && [ ! -L "$OFFHOST_RECEIPT" ] || { echo "verified transient offhost materialization is incomplete" >&2; exit 1; }
FILE_ROOT_NAME="${RESTORE_RUN_ID}_restore_test"; FILE_ROOT="$RESTORE_ROOT/$FILE_ROOT_NAME"
[ ! -e "$FILE_ROOT" ] || { echo "restore file target already exists" >&2; exit 1; }
CONTRACT="$(dirname "$0")/backup-recovery-contract.mjs"
contract() { NODE_OPTIONS=--max-old-space-size=384 node "$CONTRACT" "$@"; }
MEM_AVAILABLE_KIB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
SWAP_TOTAL_KIB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
SWAP_FREE_KIB=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
LOAD_ONE=$(awk '{print $1}' /proc/loadavg)
case "$MEM_AVAILABLE_KIB:$SWAP_TOTAL_KIB:$SWAP_FREE_KIB" in *[!0-9:]*|*::*|:*|*:) echo "host memory preflight is unavailable" >&2; exit 1 ;; esac
[ "$MEM_AVAILABLE_KIB" -ge 786432 ] || { echo "available memory is below the 768 MiB restore floor" >&2; exit 1; }
if [ "$SWAP_TOTAL_KIB" -gt 0 ]; then [ $(((SWAP_TOTAL_KIB - SWAP_FREE_KIB) * 100 / SWAP_TOTAL_KIB)) -le 80 ] || { echo "swap use exceeds the 80 percent restore ceiling" >&2; exit 1; }; fi
awk -v load_value="$LOAD_ONE" 'BEGIN { exit !(load_value ~ /^[0-9]+([.][0-9]+)?$/ && load_value <= 4) }' || { echo "one-minute load exceeds the restore ceiling" >&2; exit 1; }
ROOT_AVAILABLE_KIB=$(df -Pk / | awk 'NR==2 {print $4}')
[ "$ROOT_AVAILABLE_KIB" -ge 10485760 ] || { echo "root filesystem free space is below 10 GiB" >&2; exit 1; }
verification_args="--expected-deployment-class $SOURCE_CLASS --expected-deployment-id $SOURCE_ID --expected-database-name $SOURCE_DATABASE --expected-database-system-identifier $SOURCE_SYSTEM_ID --expected-database-oid $SOURCE_DATABASE_OID --expected-database-marker $SOURCE_DATABASE_MARKER --expected-database-bytes $SOURCE_DATABASE_BYTES --expected-database-server-major $SOURCE_DATABASE_SERVER_MAJOR --expected-database-encoding $SOURCE_DATABASE_ENCODING --expected-database-collate $SOURCE_DATABASE_COLLATE --expected-database-ctype $SOURCE_DATABASE_CTYPE --expected-database-locale-provider $SOURCE_DATABASE_LOCALE_PROVIDER --expected-database-collation-version $SOURCE_DATABASE_COLLATION_VERSION --expected-app-version $EXPECTED_VERSION --expected-git-commit $EXPECTED_GIT --expected-web-image-digest $EXPECTED_WEB_IMAGE --expected-worker-image-digest $EXPECTED_WORKER_IMAGE --expected-migration-head $EXPECTED_MIGRATION --expected-policy-id $EXPECTED_POLICY --expected-rpo-hours $EXPECTED_RPO"
restore_target_args="--location-id $LOCATION_ID --restore-run-id $RESTORE_RUN_ID --target-deployment-id $TARGET_ID --target-admin-database $TARGET_ADMIN_DATABASE --target-database-name $TARGET_DATABASE --target-marker-id $TARGET_MARKER_ID --target-cluster-marker-id $TARGET_CLUSTER_MARKER_ID --expected-target-system-identifier $EXPECTED_TARGET_SYSTEM_ID --file-root $FILE_ROOT --credential-root $CREDENTIAL_ROOT --db-service-file $SERVICE_FILE --db-service $DB_SERVICE"
# Values in the two argument bundles are strictly bounded above; pathname arguments remain separately quoted.
# shellcheck disable=SC2086
contract verify-offhost-chain --backup "$BACKUP" --migrations "$MIGRATIONS" --offhost-receipt "$OFFHOST_RECEIPT" $verification_args >/dev/null

case "${ERP_RESTORE_TEST_FAIL_AT:-}" in ''|DURING_DATABASE_CREATE_RESPONSE|DURING_DATABASE|AFTER_DATABASE_CREATE|AFTER_DATABASE|AFTER_FILE_PROMOTION|FINAL_VERIFICATION|RECEIPT_PUBLICATION) : ;; *) echo "unknown restore test failure point" >&2; exit 1 ;; esac

SOURCE_STAGE=""; STAGE=""; PINNED_BACKUP=""; PINNED_OFFHOST_RECEIPT=""; PREPARED_RECEIPT=""; DATABASE_CREATED_BY_RUN=0; CREATED_DATABASE_OID=""; TARGET_MARKED=0; FILE_PROMOTED=0; PRESERVE_TARGET=0; SUCCESS=0
TARGET_COMMENT="chenyida-erp-restore-target/v2:$TARGET_ID:$TARGET_MARKER_ID:$RESTORE_RUN_ID"
TARGET_CLUSTER_COMMENT="chenyida-erp-restore-cluster/v2:TEST:$TARGET_ID:$TARGET_CLUSTER_MARKER_ID"
SAFE_PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
db_env() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 "$@"; }
admin_psql() { db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE dbname=$TARGET_ADMIN_DATABASE" -v ON_ERROR_STOP=1 "$@"; }
target_psql() { db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE dbname=$TARGET_DATABASE" -v ON_ERROR_STOP=1 "$@"; }

reconcile_create_result() {
  create_state=$(admin_psql -At -F '|' --set=target_database="$TARGET_DATABASE" <<'SQL'
SELECT d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),d.datconnlimit::text,
       (pg_get_userbyid(d.datdba)=current_user)::text,
       (SELECT count(*)::text FROM pg_stat_activity WHERE datname=:'target_database')
FROM pg_database d WHERE d.datname=:'target_database';
SQL
  ) || return 1
  if [ -z "$create_state" ]; then return 0; fi
  old_ifs=$IFS; IFS='|'; set -- $create_state; IFS=$old_ifs
  [ "$#" -eq 5 ] && case "$1" in ''|*[!0-9]*) false ;; *) true ;; esac \
    && [ -z "$2" ] && [ "$3" = 0 ] && { [ "$4" = true ] || [ "$4" = t ]; } && [ "$5" = 0 ] \
    || { echo "ambiguous database creation result is not the exact empty task target; it is quarantined and was not deleted" >&2; return 1; }
  CREATED_DATABASE_OID=$1
  DATABASE_CREATED_BY_RUN=1
}

safe_remove_stage() {
  candidate=$1; prefix=$2
  [ -z "$candidate" ] && return 0
  case "$candidate" in "$RESTORE_ROOT"/"$prefix"*) : ;; *) return 1 ;; esac
  [ ! -L "$candidate" ] || return 1
  [ ! -e "$candidate" ] && return 0
  [ -d "$candidate" ] || return 1
  chmod -R u+rwX -- "$candidate" 2>/dev/null || return 1
  rm -rf -- "$candidate"
}
target_marker_matches() {
  marker="$FILE_ROOT/.chenyida-erp-restored-target-v2"
  [ -d "$FILE_ROOT" ] && [ ! -L "$FILE_ROOT" ] && [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(cat "$marker")" = "chenyida-erp-restored-target/v2:$TARGET_ID:$TARGET_MARKER_ID:$RESTORE_RUN_ID" ]
}
drop_target() {
  state=$(admin_psql -At -F '|' --set=target_database="$TARGET_DATABASE" <<'SQL'
SELECT count(*)::text,coalesce(max(oid)::text,''),coalesce(max(shobj_description(oid,'pg_database')),''),
       (SELECT count(*)::text FROM pg_stat_activity WHERE datname=:'target_database')
FROM pg_database WHERE datname=:'target_database';
SQL
  ) || return 1
  [ "$state" = "0|||0" ] && return 0
  case "$state" in
    "1|$CREATED_DATABASE_OID|$TARGET_COMMENT|0") : ;;
    "1|$CREATED_DATABASE_OID||0") [ "$DATABASE_CREATED_BY_RUN" = 1 ] || return 1 ;;
    *) echo "restore database identity is not the exact task-created target; it is quarantined and was not deleted" >&2; return 1 ;;
  esac
  admin_psql --set=target_database="$TARGET_DATABASE" <<'SQL' >/dev/null
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=:'target_database';
SELECT format('DROP DATABASE %I', :'target_database') \gexec
SQL
  remaining=$(admin_psql -At --set=target_database="$TARGET_DATABASE" <<'SQL'
SELECT count(*)::text FROM pg_database WHERE datname=:'target_database';
SQL
  ) || return 1
  [ "$remaining" = 0 ]
}
cleanup() {
  result=$?; trap - EXIT; cleanup_failed=0
  safe_remove_stage "${STAGE:-}" .erp-restore-files-v2. || cleanup_failed=1
  if [ "$SUCCESS" != 1 ] && [ "$PRESERVE_TARGET" != 1 ]; then
    if [ "$FILE_PROMOTED" = 1 ] && [ -e "$FILE_ROOT" ]; then target_marker_matches && safe_remove_stage "$FILE_ROOT" "${RESTORE_RUN_ID}_restore_test" || cleanup_failed=1; fi
    [ "$DATABASE_CREATED_BY_RUN" = 0 ] || drop_target || cleanup_failed=1
  fi
  safe_remove_stage "${SOURCE_STAGE:-}" .erp-restore-source-v2. || cleanup_failed=1
  cleanup_materialization || cleanup_failed=1
  if [ "$SUCCESS" = 1 ]; then
    [ "$cleanup_failed" = 0 ] || { echo "restore source staging cleanup failed" >&2; exit 1; }
    exit 0
  fi
  if [ "$PRESERVE_TARGET" = 1 ]; then echo "verified TEST restore target and prepared receipt preserved after ambiguous receipt publication" >&2; fi
  [ "$cleanup_failed" = 0 ] || { echo "restore cleanup could not prove the exact task target; manual quarantine inspection is required" >&2; exit 1; }
  exit "$result"
}
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

SOURCE_BYTES=0
for file in manifest.json migrations.txt reconciliation.json postgresql.dump uploads.tar.gz attachments.tar.gz backup-status.tar.gz; do
  [ -f "$BACKUP/$file" ] && [ ! -L "$BACKUP/$file" ] || { echo "offhost backup file set is incomplete" >&2; exit 1; }
  SOURCE_BYTES=$((SOURCE_BYTES + $(stat -c %s "$BACKUP/$file")))
done
EXPANDED_BYTES=0
for archive in uploads.tar.gz attachments.tar.gz backup-status.tar.gz; do
  archive_bytes=$(tar --list --verbose --gzip --file "$BACKUP/$archive" --quoting-style=escape | awk 'BEGIN { total=0 } /^-/ { total += $3 } END { printf "%.0f", total }')
  case "$archive_bytes" in *[!0-9]*|'') echo "archive capacity estimate failed" >&2; exit 1 ;; esac
  EXPANDED_BYTES=$((EXPANDED_BYTES + archive_bytes))
done
AVAILABLE_BYTES=$(( $(df -Pk "$RESTORE_ROOT" | awk 'NR==2 {print $4}') * 1024 ))
DATABASE_BYTES=$(contract read-database-bytes --backup "$BACKUP")
case "$DATABASE_BYTES" in *[!0-9]*|'') echo "backup database capacity evidence is invalid" >&2; exit 1 ;; esac
[ "$DATABASE_BYTES" = "$SOURCE_DATABASE_BYTES" ] || { echo "backup database capacity evidence does not match the approved source expectation" >&2; exit 1; }
TARGET_DATABASE_AVAILABLE_BYTES=$(( $(df -Pk "$TARGET_DATABASE_CAPACITY_PATH" | awk 'NR==2 {print $4}') * 1024 ))
RESTORE_STAGING_BYTES=$((SOURCE_BYTES * 2 + EXPANDED_BYTES))
TARGET_DATABASE_EXPANSION_BYTES=$((DATABASE_BYTES * 2))
CAPACITY_RESERVE_BYTES=1073741824
if [ "$(stat -c %d "$RESTORE_ROOT")" = "$(stat -c %d "$TARGET_DATABASE_CAPACITY_PATH")" ]; then
  REQUIRED_BYTES=$((RESTORE_STAGING_BYTES + TARGET_DATABASE_EXPANSION_BYTES + CAPACITY_RESERVE_BYTES))
  [ "$AVAILABLE_BYTES" -ge "$REQUIRED_BYTES" ] || { echo "shared restore/PostgreSQL filesystem capacity is below the combined staging requirement" >&2; exit 1; }
else
  [ "$AVAILABLE_BYTES" -ge $((RESTORE_STAGING_BYTES + CAPACITY_RESERVE_BYTES)) ] || { echo "restore root capacity is below the bounded staging requirement" >&2; exit 1; }
  [ "$TARGET_DATABASE_AVAILABLE_BYTES" -ge $((TARGET_DATABASE_EXPANSION_BYTES + CAPACITY_RESERVE_BYTES)) ] || { echo "target PostgreSQL capacity is below the restore expansion requirement" >&2; exit 1; }
fi

SOURCE_STAGE=$(mktemp -d "$RESTORE_ROOT/.erp-restore-source-v2.XXXXXX")
PINNED_BACKUP="$SOURCE_STAGE/backup"; mkdir -m 700 "$PINNED_BACKUP"
for file in manifest.json migrations.txt reconciliation.json postgresql.dump uploads.tar.gz attachments.tar.gz backup-status.tar.gz; do cp --no-dereference --reflink=never -- "$BACKUP/$file" "$PINNED_BACKUP/$file"; chmod 0400 "$PINNED_BACKUP/$file"; done
PINNED_OFFHOST_RECEIPT="$SOURCE_STAGE/offhost.json"; cp --no-dereference --reflink=never -- "$OFFHOST_RECEIPT" "$PINNED_OFFHOST_RECEIPT"; chmod 0400 "$PINNED_OFFHOST_RECEIPT"
contract durably-sync-tree --root "$SOURCE_STAGE" >/dev/null
chmod 0500 "$PINNED_BACKUP" "$SOURCE_STAGE"
# The restore consumes only this private, durable, independently verified byte copy.
# shellcheck disable=SC2086
contract verify-offhost-chain --backup "$PINNED_BACKUP" --migrations "$MIGRATIONS" --offhost-receipt "$PINNED_OFFHOST_RECEIPT" $verification_args >/dev/null

credential_unchanged
ADMIN_PROBE=$(admin_psql -At -F '|' --set=target_database="$TARGET_DATABASE" <<'SQL'
SELECT current_database(),system_identifier::text,
       coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'),''),
       (SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user),
       (SELECT count(*)::text FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()),
       ((current_setting('server_version_num')::integer/10000)::text),
       (SELECT count(*)::text FROM pg_database WHERE datname=:'target_database')
FROM pg_control_system();
SQL
)
old_ifs=$IFS; IFS='|'; set -- $ADMIN_PROBE; IFS=$old_ifs
[ "$#" -eq 7 ] && [ "$1" = "$TARGET_ADMIN_DATABASE" ] && [ "$2" = "$EXPECTED_TARGET_SYSTEM_ID" ] && [ "$3" = "$TARGET_CLUSTER_COMMENT" ] && { [ "$4" = true ] || [ "$4" = t ]; } && [ "$5" = 0 ] && [ "$6" = "$SOURCE_DATABASE_SERVER_MAJOR" ] && [ "$7" = 0 ] || { echo "restore cluster identity, marker, exclusivity, server major, or fresh target precondition is invalid" >&2; exit 1; }

if ! admin_psql --set=target_database="$TARGET_DATABASE" --set=encoding="$SOURCE_DATABASE_ENCODING" --set=collate="$SOURCE_DATABASE_COLLATE" --set=ctype="$SOURCE_DATABASE_CTYPE" --set=provider="$SOURCE_DATABASE_LOCALE_PROVIDER" <<'SQL' >/dev/null
SELECT format('CREATE DATABASE %I WITH TEMPLATE template0 ENCODING %L LC_COLLATE %L LC_CTYPE %L LOCALE_PROVIDER %s CONNECTION LIMIT 0', :'target_database', :'encoding', :'collate', :'ctype', :'provider') \gexec
SQL
then
  reconcile_create_result || true
  echo "restore database creation failed or returned an ambiguous result" >&2
  exit 1
fi
reconcile_create_result || exit 1
[ "$DATABASE_CREATED_BY_RUN" = 1 ] || { echo "restore database creation returned no exact task target" >&2; exit 1; }
[ "${ERP_RESTORE_TEST_FAIL_AT:-}" != DURING_DATABASE_CREATE_RESPONSE ] || { echo "injected ambiguous database creation response" >&2; exit 1; }
[ "${ERP_RESTORE_TEST_FAIL_AT:-}" != AFTER_DATABASE_CREATE ] || { echo "injected restore failure after database creation" >&2; exit 1; }
admin_psql --set=target_database="$TARGET_DATABASE" --set=target_comment="$TARGET_COMMENT" <<'SQL' >/dev/null
SELECT format('COMMENT ON DATABASE %I IS %L', :'target_database', :'target_comment') \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'target_database') \gexec
SQL
TARGET_MARKED=1
TARGET_PROBE=$(target_psql -At -F '|' -c "select system_identifier::text,coalesce(shobj_description((select oid from pg_database where datname=current_database()),'pg_database'),''),(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()),((current_setting('server_version_num')::integer/10000)::text),(select pg_encoding_to_char(encoding) from pg_database where datname=current_database()),(select datcollate from pg_database where datname=current_database()),(select datctype from pg_database where datname=current_database()),(select case datlocprovider when 'c' then 'libc' when 'i' then 'icu' when 'b' then 'builtin' else 'unknown' end from pg_database where datname=current_database()),(select coalesce(datcollversion,'NONE') from pg_database where datname=current_database()) from pg_control_system()")
[ "$TARGET_PROBE" = "$EXPECTED_TARGET_SYSTEM_ID|$TARGET_COMMENT|0|$SOURCE_DATABASE_SERVER_MAJOR|$SOURCE_DATABASE_ENCODING|$SOURCE_DATABASE_COLLATE|$SOURCE_DATABASE_CTYPE|$SOURCE_DATABASE_LOCALE_PROVIDER|$SOURCE_DATABASE_COLLATION_VERSION" ] || { echo "created restore database identity or locale profile mismatch" >&2; exit 1; }

STAGE=$(mktemp -d "$RESTORE_ROOT/.erp-restore-files-v2.XXXXXX")
mkdir -m 700 "$STAGE/uploads" "$STAGE/attachments" "$STAGE/backup_status"
tar --extract --gzip --file "$PINNED_BACKUP/uploads.tar.gz" --directory "$STAGE/uploads" --no-same-owner --no-same-permissions --delay-directory-restore
tar --extract --gzip --file "$PINNED_BACKUP/attachments.tar.gz" --directory "$STAGE/attachments" --no-same-owner --no-same-permissions --delay-directory-restore
tar --extract --gzip --file "$PINNED_BACKUP/backup-status.tar.gz" --directory "$STAGE/backup_status" --no-same-owner --no-same-permissions --delay-directory-restore
find "$STAGE/uploads" "$STAGE/attachments" -type d -exec chmod 0700 {} +
find "$STAGE/uploads" "$STAGE/attachments" -type f -exec chmod 0600 {} +
STATUS_MARKER="$STAGE/backup_status/.chenyida-erp-receipt-root-v2"
[ -f "$STATUS_MARKER" ] && [ ! -L "$STATUS_MARKER" ] && [ "$(cat "$STATUS_MARKER")" = chenyida-erp-receipt-root/v2 ] || { echo "restored backup-status is not a reusable receipt root" >&2; exit 1; }
chgrp -R "$RECEIPT_READER_GID" "$STAGE/backup_status"
find "$STAGE/backup_status" -type d -exec chmod 2750 {} +
find "$STAGE/backup_status" -type f -exec chmod 0640 {} +
chmod 0400 "$STATUS_MARKER"
printf 'chenyida-erp-restored-target/v2:%s:%s:%s\n' "$TARGET_ID" "$TARGET_MARKER_ID" "$RESTORE_RUN_ID" > "$STAGE/.chenyida-erp-restored-target-v2"
chmod 0400 "$STAGE/.chenyida-erp-restored-target-v2"
contract verify-restored-files --backup "$PINNED_BACKUP" --file-root "$STAGE" --target-deployment-id "$TARGET_ID" --target-marker-id "$TARGET_MARKER_ID" --restore-run-id "$RESTORE_RUN_ID" >/dev/null

if [ "${ERP_RESTORE_TEST_FAIL_AT:-}" = DURING_DATABASE ]; then
  env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 PGOPTIONS='-c erp.restore_fault=on' pg_restore --dbname="service=$DB_SERVICE dbname=$TARGET_DATABASE" --no-owner --no-acl --exit-on-error --single-transaction "$PINNED_BACKUP/postgresql.dump"
else
  db_env pg_restore --dbname="service=$DB_SERVICE dbname=$TARGET_DATABASE" --no-owner --no-acl --exit-on-error --single-transaction "$PINNED_BACKUP/postgresql.dump"
fi
[ "${ERP_RESTORE_TEST_FAIL_AT:-}" != AFTER_DATABASE ] || { echo "injected restore failure after database" >&2; exit 1; }
DB_MIGRATIONS=$(target_psql -Atc "select checksum||'  '||version from schema_migrations order by version")
EXPECTED_MIGRATIONS=$(cat "$PINNED_BACKUP/migrations.txt")
[ "$DB_MIGRATIONS" = "$EXPECTED_MIGRATIONS" ] || { echo "restored migration verification failed" >&2; exit 1; }

contract durably-sync-tree --root "$STAGE" >/dev/null
mv -T -n -- "$STAGE" "$FILE_ROOT"
[ ! -e "$STAGE" ] && [ -d "$FILE_ROOT" ] && [ ! -L "$FILE_ROOT" ] || { echo "restore file target promotion lost the no-clobber race" >&2; exit 1; }
STAGE=""; FILE_PROMOTED=1
contract durably-sync-tree --root "$FILE_ROOT" >/dev/null
[ "${ERP_RESTORE_TEST_FAIL_AT:-}" != AFTER_FILE_PROMOTION ] || { echo "injected restore failure after file promotion" >&2; exit 1; }
contract verify-restored-files --backup "$PINNED_BACKUP" --file-root "$FILE_ROOT" --target-deployment-id "$TARGET_ID" --target-marker-id "$TARGET_MARKER_ID" --restore-run-id "$RESTORE_RUN_ID" >/dev/null
[ "${ERP_RESTORE_TEST_FAIL_AT:-}" != FINAL_VERIFICATION ] || { echo "injected final verification failure" >&2; exit 1; }

credential_unchanged
PREPARED_RECEIPT="$RESTORE_ROOT/.prepared-$BACKUP_ID-$RESTORE_RUN_ID.json"
# Active target inspection and durable private receipt creation both succeed
# before the preservation boundary.
# shellcheck disable=SC2086
contract prepare-restore --backup "$PINNED_BACKUP" --migrations "$MIGRATIONS" --offhost-receipt "$PINNED_OFFHOST_RECEIPT" --prepared-receipt "$PREPARED_RECEIPT" $restore_target_args $verification_args >/dev/null
[ -f "$PREPARED_RECEIPT" ] && [ ! -L "$PREPARED_RECEIPT" ] && [ "$(stat -c %a "$PREPARED_RECEIPT")" = 400 ] || { echo "prepared restore receipt publication failed" >&2; exit 1; }
PRESERVE_TARGET=1
[ "${ERP_RESTORE_TEST_FAIL_AT:-}" != RECEIPT_PUBLICATION ] || { echo "injected ambiguous restore receipt publication failure" >&2; exit 1; }
# Publication consumes only the already durable prepared receipt; it cannot
# re-open the active database or mutable restored file tree.
contract publish-prepared-restore --prepared-receipt "$PREPARED_RECEIPT" --receipt-root "$RECEIPT_ROOT" >/dev/null
SUCCESS=1
echo "restore v2 completed to task-created isolated TEST target: $TARGET_DATABASE"
