#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --credential-root DIR --db-service-file FILE --db-service NAME --deployment-class TEST|UAT|PRODUCTION --deployment-id ID --expected-database NAME --uploads DIR --attachments DIR --backup-status DIR --migrations DIR --backup-root DIR --receipt-root DIR --receipt-reader-gid GID --web-container NAME --worker-container NAME --location-id ID --policy-id ID --rpo-hours 1..168 [--machine-identity-file FILE (NODE_ENV=test only)] --confirm TOKEN" >&2
  exit 2
}

CREDENTIAL_ROOT=""; SERVICE_FILE=""; DB_SERVICE=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""; EXPECTED_DATABASE=""
UPLOADS=""; ATTACHMENTS=""; BACKUP_STATUS=""; MIGRATIONS=""; BACKUP_ROOT=""; RECEIPT_ROOT=""; RECEIPT_READER_GID=""
WEB_CONTAINER=""; WORKER_CONTAINER=""; LOCATION_ID=""; POLICY_ID=""; RPO_HOURS=""; MACHINE_IDENTITY_FILE=""; CONFIRM=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --credential-root) CREDENTIAL_ROOT=${2:-}; shift 2 ;;
    --db-service-file) SERVICE_FILE=${2:-}; shift 2 ;;
    --db-service) DB_SERVICE=${2:-}; shift 2 ;;
    --deployment-class) DEPLOYMENT_CLASS=${2:-}; shift 2 ;;
    --deployment-id) DEPLOYMENT_ID=${2:-}; shift 2 ;;
    --expected-database) EXPECTED_DATABASE=${2:-}; shift 2 ;;
    --uploads) UPLOADS=${2:-}; shift 2 ;;
    --attachments) ATTACHMENTS=${2:-}; shift 2 ;;
    --backup-status) BACKUP_STATUS=${2:-}; shift 2 ;;
    --migrations) MIGRATIONS=${2:-}; shift 2 ;;
    --backup-root) BACKUP_ROOT=${2:-}; shift 2 ;;
    --receipt-root) RECEIPT_ROOT=${2:-}; shift 2 ;;
    --receipt-reader-gid) RECEIPT_READER_GID=${2:-}; shift 2 ;;
    --web-container) WEB_CONTAINER=${2:-}; shift 2 ;;
    --worker-container) WORKER_CONTAINER=${2:-}; shift 2 ;;
    --location-id) LOCATION_ID=${2:-}; shift 2 ;;
    --policy-id) POLICY_ID=${2:-}; shift 2 ;;
    --rpo-hours) RPO_HOURS=${2:-}; shift 2 ;;
    --machine-identity-file) MACHINE_IDENTITY_FILE=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

for value in "$CREDENTIAL_ROOT" "$SERVICE_FILE" "$DB_SERVICE" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$EXPECTED_DATABASE" "$UPLOADS" "$ATTACHMENTS" "$BACKUP_STATUS" "$MIGRATIONS" "$BACKUP_ROOT" "$RECEIPT_ROOT" "$RECEIPT_READER_GID" "$WEB_CONTAINER" "$WORKER_CONTAINER" "$LOCATION_ID" "$POLICY_ID" "$RPO_HOURS" "$CONFIRM"; do [ -n "$value" ] || usage; done
case "$DEPLOYMENT_CLASS:$CONFIRM" in TEST:TEST_BACKUP_V2|UAT:UAT_BACKUP_V2_AUTHORIZED|PRODUCTION:PRODUCTION_BACKUP_V2_AUTHORIZED) : ;; *) echo "deployment class and confirmation do not match" >&2; exit 1 ;; esac
case "$RPO_HOURS:$RECEIPT_READER_GID" in *[!0-9:]*|:*|*:) echo "RPO and receipt reader GID must be decimal integers" >&2; exit 1 ;; esac
[ "$RPO_HOURS" -ge 1 ] && [ "$RPO_HOURS" -le 168 ] || { echo "RPO must be between 1 and 168 hours" >&2; exit 1; }
for value in "$DB_SERVICE" "$DEPLOYMENT_ID" "$EXPECTED_DATABASE" "$WEB_CONTAINER" "$WORKER_CONTAINER" "$LOCATION_ID" "$POLICY_ID"; do case "$value" in *[!A-Za-z0-9_.-]*|'') echo "invalid bounded identifier" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "identifier is too long" >&2; exit 1; }; done
[ "$DEPLOYMENT_CLASS" != "PRODUCTION" ] || [ "$(id -u)" = 0 ] || { echo "production backup requires root" >&2; exit 1; }
if [ -n "$MACHINE_IDENTITY_FILE" ] && [ "${NODE_ENV:-}" != test ]; then echo "machine identity override is restricted to NODE_ENV=test" >&2; exit 1; fi
TEST_HOLD_SECONDS=${SELFHOST_BACKUP_TEST_HOLD_AFTER_GUARD:-}
if [ -n "$TEST_HOLD_SECONDS" ]; then
  [ "$DEPLOYMENT_CLASS" = TEST ] && [ "${NODE_ENV:-}" = test ] || { echo "backup guard hold is restricted to TEST deployments with NODE_ENV=test" >&2; exit 1; }
  case "$TEST_HOLD_SECONDS" in *[!0-9]*|'') echo "backup guard hold must be decimal seconds" >&2; exit 1 ;; esac
  [ "$TEST_HOLD_SECONDS" -ge 1 ] && [ "$TEST_HOLD_SECONDS" -le 300 ] || { echo "backup guard hold must be between 1 and 300 seconds" >&2; exit 1; }
fi

inside() { [ "$1" = "$2" ] || case "$1/" in "$2"/*) return 0 ;; *) return 1 ;; esac; }
overlap() { inside "$1" "$2" || inside "$2" "$1"; }

validate_root() {
  candidate=$1; marker_name=$2; marker_value=$3
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || { echo "dedicated root is missing or unsafe" >&2; exit 1; }
  candidate=$(readlink -f "$candidate")
  [ "$(stat -c %u "$candidate")" = "$(id -u)" ] || { echo "dedicated root owner mismatch" >&2; exit 1; }
  case "$(stat -c %a "$candidate")" in 700|750|2750) : ;; *) echo "dedicated root mode must be 0700, 0750, or 2750" >&2; exit 1 ;; esac
  marker="$candidate/$marker_name"
  [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(stat -c %h "$marker")" = 1 ] && [ "$(stat -c %u "$marker")" = "$(id -u)" ] || { echo "dedicated root marker is unsafe" >&2; exit 1; }
  case "$(stat -c %a "$marker")" in 400|600) : ;; *) echo "dedicated root marker mode must be 0400 or 0600" >&2; exit 1 ;; esac
  [ "$(cat "$marker")" = "$marker_value" ] || { echo "dedicated root marker is invalid" >&2; exit 1; }
  printf '%s\n' "$candidate"
}

BACKUP_ROOT=$(validate_root "$BACKUP_ROOT" .chenyida-erp-backup-root-v2 chenyida-erp-backup-root/v2)
RECEIPT_ROOT=$(validate_root "$RECEIPT_ROOT" .chenyida-erp-receipt-root-v2 chenyida-erp-receipt-root/v2)
CREDENTIAL_ROOT=$(validate_root "$CREDENTIAL_ROOT" .chenyida-erp-credential-root-v2 chenyida-erp-credential-root/v2)
[ "$(stat -c %g "$RECEIPT_ROOT")" = "$RECEIPT_READER_GID" ] || { echo "receipt root reader GID mismatch" >&2; exit 1; }
[ "$(stat -c %a "$RECEIPT_ROOT")" = 2750 ] || { echo "receipt root must be setgid 2750 for the Web reader group" >&2; exit 1; }

[ -f "$SERVICE_FILE" ] && [ ! -L "$SERVICE_FILE" ] || { echo "database service file is missing or unsafe" >&2; exit 1; }
SERVICE_FILE=$(readlink -f "$SERVICE_FILE")
inside "$SERVICE_FILE" "$CREDENTIAL_ROOT" && [ "$SERVICE_FILE" != "$CREDENTIAL_ROOT/.chenyida-erp-credential-root-v2" ] || { echo "database service file must be inside the credential root" >&2; exit 1; }
[ "$(stat -c %h "$SERVICE_FILE")" = 1 ] && [ "$(stat -c %u "$SERVICE_FILE")" = "$(id -u)" ] || { echo "database service file identity is unsafe" >&2; exit 1; }
case "$(stat -c %a "$SERVICE_FILE")" in 400|600) : ;; *) echo "database service file mode must be 0400 or 0600" >&2; exit 1 ;; esac
cursor=$(dirname "$SERVICE_FILE")
while :; do [ "$(stat -c %u "$cursor")" = "$(id -u)" ] && [ $((0$(stat -c %a "$cursor") & 0022)) -eq 0 ] || { echo "credential ancestor is unsafe" >&2; exit 1; }; [ "$cursor" = "$CREDENTIAL_ROOT" ] && break; parent=$(dirname "$cursor"); [ "$parent" != "$cursor" ] && inside "$parent" "$CREDENTIAL_ROOT" || { echo "credential path escapes its root" >&2; exit 1; }; cursor=$parent; done
if grep -Eiq '^[[:space:]]*(passfile|sslkey)[[:space:]]*=' "$SERVICE_FILE"; then echo "external libpq secret references are not accepted" >&2; exit 1; fi

for source in "$UPLOADS" "$ATTACHMENTS" "$BACKUP_STATUS" "$MIGRATIONS"; do [ -d "$source" ] && [ ! -L "$source" ] || { echo "backup source is missing or unsafe" >&2; exit 1; }; done
UPLOADS=$(readlink -f "$UPLOADS"); ATTACHMENTS=$(readlink -f "$ATTACHMENTS"); BACKUP_STATUS=$(readlink -f "$BACKUP_STATUS"); MIGRATIONS=$(readlink -f "$MIGRATIONS")
for source in "$UPLOADS" "$ATTACHMENTS" "$BACKUP_STATUS"; do [ -z "$(find "$source" \! -type d \! -type f -print -quit)" ] || { echo "backup file sources may contain only directories and regular files" >&2; exit 1; }; done
REPO_ROOT=$(readlink -f "$(dirname "$0")/..")
CONTRACT="$REPO_ROOT/scripts/backup-recovery-contract.mjs"
[ -f "$CONTRACT" ] && [ ! -L "$CONTRACT" ] || { echo "backup recovery contract helper is missing or unsafe" >&2; exit 1; }
contract() { NODE_OPTIONS=--max-old-space-size=384 node "$CONTRACT" "$@"; }
for source in "$UPLOADS" "$ATTACHMENTS" "$BACKUP_STATUS"; do overlap "$source" "$REPO_ROOT" && { echo "runtime data source overlaps the repository" >&2; exit 1; }; done
overlap "$UPLOADS" "$ATTACHMENTS" && { echo "backup sources overlap" >&2; exit 1; }
overlap "$UPLOADS" "$BACKUP_STATUS" && { echo "backup sources overlap" >&2; exit 1; }
overlap "$ATTACHMENTS" "$BACKUP_STATUS" && { echo "backup sources overlap" >&2; exit 1; }
for protected in "$REPO_ROOT" "$UPLOADS" "$ATTACHMENTS" "$BACKUP_STATUS" "$MIGRATIONS" "$CREDENTIAL_ROOT"; do overlap "$BACKUP_ROOT" "$protected" && { echo "backup root overlaps a protected source" >&2; exit 1; }; done
for protected in "$REPO_ROOT" "$UPLOADS" "$ATTACHMENTS" "$MIGRATIONS" "$CREDENTIAL_ROOT"; do overlap "$RECEIPT_ROOT" "$protected" && { echo "receipt root overlaps a protected source" >&2; exit 1; }; done
[ "$RECEIPT_ROOT" = "$BACKUP_STATUS" ] || ! overlap "$RECEIPT_ROOT" "$BACKUP_STATUS" || { echo "receipt root may only equal, not contain, backup-status" >&2; exit 1; }
[ "$RECEIPT_ROOT" = "$BACKUP_STATUS" ] || { echo "backup-status must be the exact shared receipt root" >&2; exit 1; }
overlap "$RECEIPT_ROOT" "$BACKUP_ROOT" && { echo "receipt root must be outside backup root" >&2; exit 1; }
if [ -n "$MACHINE_IDENTITY_FILE" ]; then
  [ -f "$MACHINE_IDENTITY_FILE" ] && [ ! -L "$MACHINE_IDENTITY_FILE" ] || { echo "test machine identity file is missing or unsafe" >&2; exit 1; }
  MACHINE_IDENTITY_FILE=$(readlink -f "$MACHINE_IDENTITY_FILE")
  [ "$(stat -c %h "$MACHINE_IDENTITY_FILE")" = 1 ] && [ "$(stat -c %u "$MACHINE_IDENTITY_FILE")" = "$(id -u)" ] || { echo "test machine identity file identity is unsafe" >&2; exit 1; }
  case "$(stat -c %a "$MACHINE_IDENTITY_FILE")" in 400|600) : ;; *) echo "test machine identity file mode is unsafe" >&2; exit 1 ;; esac
  MACHINE_IDENTITY_BYTES=$(stat -c %s "$MACHINE_IDENTITY_FILE")
  [ "$MACHINE_IDENTITY_BYTES" -ge 2 ] && [ "$MACHINE_IDENTITY_BYTES" -le 256 ] || { echo "test machine identity file size is invalid" >&2; exit 1; }
fi

umask 077
RELEASE_GATE_LOCK_HELPER=$(dirname "$0")/release-gate-lock.sh
[ -f "$RELEASE_GATE_LOCK_HELPER" ] && [ ! -L "$RELEASE_GATE_LOCK_HELPER" ] && [ "$(stat -c %h "$RELEASE_GATE_LOCK_HELPER")" = 1 ] && [ "$(stat -c %u "$RELEASE_GATE_LOCK_HELPER")" = "$(id -u)" ] && [ $((0$(stat -c %a "$RELEASE_GATE_LOCK_HELPER") & 0022)) -eq 0 ] || { echo "release gate lock helper is unsafe" >&2; exit 1; }
# shellcheck source=release-gate-lock.sh
. "$RELEASE_GATE_LOCK_HELPER"
acquire_chenyida_release_gate_lock
for lock_file in "$BACKUP_ROOT/.selfhost-ops-v2.lock" "$BACKUP_ROOT/.backup-v2.lock"; do [ ! -L "$lock_file" ] || { echo "backup operations lock path is unsafe" >&2; exit 1; }; done
exec 9>"$BACKUP_ROOT/.selfhost-ops-v2.lock"; flock -n 9 || { echo "global self-host database operations lock is busy for this backup root" >&2; exit 1; }
exec 5>"$BACKUP_ROOT/.backup-v2.lock"; flock -n 5 || { echo "another backup is active for this root" >&2; exit 1; }
for lock_file in "$BACKUP_ROOT/.selfhost-ops-v2.lock" "$BACKUP_ROOT/.backup-v2.lock"; do
  [ -f "$lock_file" ] && [ ! -L "$lock_file" ] && [ "$(stat -c %h "$lock_file")" = 1 ] && [ "$(stat -c %u "$lock_file")" = "$(id -u)" ] || { echo "backup operations lock identity is unsafe" >&2; exit 1; }
  chmod 0600 "$lock_file"
done
exec 6>"$RECEIPT_ROOT/.receipt-v2.lock"; flock -n 6 || { echo "verification receipt root is busy" >&2; exit 1; }
exec 8<"$SERVICE_FILE"; flock -s -n 8 || { echo "database credential file is being modified" >&2; exit 1; }
SERVICE_FILE_IDENTITY=$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$SERVICE_FILE")
SERVICE_FILE_SHA256=$(sha256sum "$SERVICE_FILE" | awk '{print $1}')
credential_unchanged() {
  [ "$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$SERVICE_FILE" 2>/dev/null)" = "$SERVICE_FILE_IDENTITY" ] && [ "$(sha256sum "$SERVICE_FILE" 2>/dev/null | awk '{print $1}')" = "$SERVICE_FILE_SHA256" ] || { echo "database credential file changed during backup" >&2; return 1; }
}
SAFE_PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
db_env() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 "$@"; }
db_env_override() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 PGOPTIONS='-c default_transaction_read_only=off' "$@"; }

host_resource_gate() {
  mem_available_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  swap_total_kib=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
  swap_free_kib=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
  load_one=$(awk '{print $1}' /proc/loadavg)
  root_available_kib=$(df -Pk / | awk 'NR==2 {print $4}')
  case "$mem_available_kib:$swap_total_kib:$swap_free_kib:$root_available_kib" in *[!0-9:]*|*::*|:*|*:) echo "host resource preflight is unavailable" >&2; exit 1 ;; esac
  [ "$mem_available_kib" -ge 786432 ] || { echo "available memory is below the 768 MiB backup floor" >&2; exit 1; }
  [ "$swap_free_kib" -le "$swap_total_kib" ] || { echo "swap resource preflight is inconsistent" >&2; exit 1; }
  if [ "$swap_total_kib" -gt 0 ]; then [ $(((swap_total_kib - swap_free_kib) * 100)) -le $((swap_total_kib * 80)) ] || { echo "swap use exceeds the 80 percent backup ceiling" >&2; exit 1; }; fi
  awk -v load_value="$load_one" 'BEGIN { exit !(load_value ~ /^[0-9]+([.][0-9]+)?$/ && load_value <= 4) }' || { echo "one-minute load exceeds the backup ceiling" >&2; exit 1; }
  [ "$root_available_kib" -ge 10485760 ] || { echo "root filesystem free space is below 10 GiB" >&2; exit 1; }
  printf 'backup resource gate passed: MemAvailable=%sKiB SwapUsed=%sKiB Load1=%s RootFree=%sKiB\n' "$mem_available_kib" "$((swap_total_kib - swap_free_kib))" "$load_one" "$root_available_kib" >&2
}
source_file_bytes() {
  find "$1" -type f -printf '%s\n' | awk '{ total += $1 } END { printf "%.0f\n", total + 0 }'
}
host_resource_gate
UPLOAD_BYTES=$(source_file_bytes "$UPLOADS")
ATTACHMENT_BYTES=$(source_file_bytes "$ATTACHMENTS")
BACKUP_STATUS_BYTES=$(source_file_bytes "$BACKUP_STATUS")
case "$UPLOAD_BYTES:$ATTACHMENT_BYTES:$BACKUP_STATUS_BYTES" in *[!0-9:]*|*::*|:*|*:) echo "source file capacity inventory is invalid" >&2; exit 1 ;; esac
SOURCE_FILE_BYTES=$((UPLOAD_BYTES + ATTACHMENT_BYTES + BACKUP_STATUS_BYTES))

writer_inventory() {
  service=$1; expected_id=$2
  ids=$(docker ps -a --no-trunc --filter "label=com.docker.compose.project=$DEPLOYMENT_ID" --filter "label=com.docker.compose.service=$service" --format '{{.ID}}') || { echo "writer inventory cannot be verified" >&2; exit 1; }
  [ "$ids" = "$expected_id" ] || { echo "writer inventory is not exactly the declared stopped container" >&2; exit 1; }
}
writer_snapshot() {
  name=$1; expected_service=$2
  snapshot=$(docker inspect --format '{{.Id}}|{{.State.Running}}|{{.State.Restarting}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.State.FinishedAt}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}' "$name" 2>/dev/null) || { echo "writer state cannot be verified" >&2; exit 1; }
  old_ifs=$IFS; IFS='|'; set -- $snapshot; IFS=$old_ifs
  [ "$#" -eq 11 ] && [ "$2" = false ] && [ "$3" = false ] && [ "$8" = "$DEPLOYMENT_ID" ] && [ "$9" = "$expected_service" ] || { echo "writer identity or stopped state is invalid" >&2; exit 1; }
  case "$1" in *[!0-9a-f]*|'') echo "writer container ID is invalid" >&2; exit 1 ;; esac; [ "${#1}" -eq 64 ] || { echo "writer container ID is invalid" >&2; exit 1; }
  class=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" | sed -n 's/^ERP_DEPLOYMENT_CLASS=//p')
  [ "$(printf '%s' "$class" | tr '[:lower:]' '[:upper:]')" = "$DEPLOYMENT_CLASS" ] || { echo "writer deployment class mismatch" >&2; exit 1; }
  writer_inventory "$expected_service" "$1"
  printf '%s|%s\n' "$snapshot" "$class"
}
running_application_writers_absent() {
  running=$(docker ps --no-trunc --filter "label=com.docker.compose.project=$DEPLOYMENT_ID" --format '{{.ID}}|{{.Label "com.docker.compose.service"}}') || { echo "running Compose inventory cannot be verified" >&2; exit 1; }
  [ -z "$running" ] && return 0
  printf '%s\n' "$running" | while IFS='|' read -r running_id running_service; do
    [ -n "$running_id" ] && case "$running_service" in postgres|caddy) : ;; *) exit 1 ;; esac
  done || { echo "a running Compose container has an unapproved or missing service identity" >&2; exit 1; }
}

WEB_BEFORE=$(writer_snapshot "$WEB_CONTAINER" web); WORKER_BEFORE=$(writer_snapshot "$WORKER_CONTAINER" worker); running_application_writers_absent
WEB_ID=$(printf '%s' "$WEB_BEFORE" | awk -F'|' '{print $1}'); WORKER_ID=$(printf '%s' "$WORKER_BEFORE" | awk -F'|' '{print $1}')
IMAGE_DIGEST=$(printf '%s' "$WEB_BEFORE" | awk -F'|' '{print $7}'); APP_VERSION=$(printf '%s' "$WEB_BEFORE" | awk -F'|' '{print $10}'); GIT_COMMIT=$(printf '%s' "$WEB_BEFORE" | awk -F'|' '{print $11}')
WORKER_IMAGE_DIGEST=$(printf '%s' "$WORKER_BEFORE" | awk -F'|' '{print $7}'); WORKER_APP_VERSION=$(printf '%s' "$WORKER_BEFORE" | awk -F'|' '{print $10}'); WORKER_GIT_COMMIT=$(printf '%s' "$WORKER_BEFORE" | awk -F'|' '{print $11}')
case "$IMAGE_DIGEST" in sha256:[0-9a-f][0-9a-f]*) : ;; *) echo "web image digest is invalid" >&2; exit 1 ;; esac; [ "${#IMAGE_DIGEST}" -eq 71 ] || { echo "web image digest is invalid" >&2; exit 1; }
case "$APP_VERSION" in 0.1.0-alpha.[0-9]|0.1.0-alpha.[0-9][0-9]|0.1.0-alpha.[0-9][0-9][0-9]) : ;; *) echo "web application version is invalid" >&2; exit 1 ;; esac
case "$GIT_COMMIT" in *[!0-9a-f]*|'') echo "web source revision is invalid" >&2; exit 1 ;; esac; [ "${#GIT_COMMIT}" -eq 40 ] || { echo "web source revision is invalid" >&2; exit 1; }
case "$WORKER_IMAGE_DIGEST" in sha256:[0-9a-f][0-9a-f]*) : ;; *) echo "worker image digest is invalid" >&2; exit 1 ;; esac; [ "${#WORKER_IMAGE_DIGEST}" -eq 71 ] || { echo "worker image digest is invalid" >&2; exit 1; }
[ "$WORKER_APP_VERSION" = "$APP_VERSION" ] && [ "$WORKER_GIT_COMMIT" = "$GIT_COMMIT" ] || { echo "Web and Worker release version/revision do not match" >&2; exit 1; }

DB_MARKER_ID="$DEPLOYMENT_CLASS.$DEPLOYMENT_ID"
credential_unchanged
DB_PROBE=$(db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,(select oid::text from pg_database where datname=current_database()),coalesce(shobj_description((select oid from pg_database where datname=current_database()),'pg_database'),''),(select rolsuper::text from pg_roles where rolname=current_user),current_setting('default_transaction_read_only'),(select count(*)::text from pg_db_role_setting s join pg_database d on d.oid=s.setdatabase where d.datname=current_database() and s.setrole=0 and exists(select 1 from unnest(s.setconfig) v where v like 'default_transaction_read_only=%')),(select count(*)::text from pg_db_role_setting s where (s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database())) and exists(select 1 from unnest(s.setconfig) v where v='default_transaction_read_only=off')),((current_setting('server_version_num')::integer/10000)::text),(select pg_encoding_to_char(encoding) from pg_database where datname=current_database()),(select datcollate from pg_database where datname=current_database()),(select datctype from pg_database where datname=current_database()),(select case datlocprovider when 'c' then 'libc' when 'i' then 'icu' when 'b' then 'builtin' else 'unknown' end from pg_database where datname=current_database()),(select coalesce(datcollversion,'NONE') from pg_database where datname=current_database()),(select datconnlimit::text from pg_database where datname=current_database()),pg_database_size(current_database())::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()) from pg_control_system()")
old_ifs=$IFS; IFS='|'; set -- $DB_PROBE; IFS=$old_ifs
[ "$#" -eq 17 ] && [ "$1" = "$EXPECTED_DATABASE" ] && [ "$4" = "chenyida-erp-deployment/v2:$DEPLOYMENT_CLASS:$DEPLOYMENT_ID" ] && { [ "$5" = true ] || [ "$5" = t ]; } && [ "$6" = off ] && [ "$7" = 0 ] && [ "$8" = 0 ] && [ "${17}" = 0 ] || { echo "database stable identity, deployment marker, backup role, or initial writer boundary is invalid" >&2; exit 1; }
DATABASE_SYSTEM_IDENTIFIER=$2; DATABASE_OID=$3
DATABASE_SERVER_MAJOR=$9; DATABASE_ENCODING=${10}; DATABASE_COLLATE=${11}; DATABASE_CTYPE=${12}; DATABASE_LOCALE_PROVIDER=${13}; DATABASE_COLLATION_VERSION=${14}
ORIGINAL_CONNECTION_LIMIT=${15}; DATABASE_BYTES=${16}
for value in "$DATABASE_SYSTEM_IDENTIFIER" "$DATABASE_OID" "$DATABASE_SERVER_MAJOR" "$DATABASE_BYTES"; do case "$value" in *[!0-9]*|'') echo "database stable identity or size is invalid" >&2; exit 1 ;; esac; done
[ "$DATABASE_BYTES" -ge 1 ] || { echo "database size must be positive" >&2; exit 1; }
case "$ORIGINAL_CONNECTION_LIMIT" in -1) : ;; ''|*[!0-9]*) echo "database connection limit is invalid" >&2; exit 1 ;; *) : ;; esac
for value in "$DATABASE_ENCODING" "$DATABASE_COLLATE" "$DATABASE_CTYPE" "$DATABASE_LOCALE_PROVIDER" "$DATABASE_COLLATION_VERSION"; do case "$value" in *[!A-Za-z0-9_.-]*|'') echo "database locale profile is unsupported" >&2; exit 1 ;; esac; done
[ "$DATABASE_LOCALE_PROVIDER" = libc ] || { echo "backup recovery v2 currently supports only an explicitly bound libc database locale" >&2; exit 1; }

BACKUP_AVAILABLE_KIB=$(df -Pk "$BACKUP_ROOT" | awk 'END {print $4}')
case "$BACKUP_AVAILABLE_KIB" in ''|*[!0-9]*) echo "backup root capacity is unavailable" >&2; exit 1 ;; esac
BACKUP_AVAILABLE_BYTES=$((BACKUP_AVAILABLE_KIB * 1024))
CAPACITY_HEADROOM_BYTES=1073741824
ROOT_RESERVE_BYTES=10737418240
REQUIRED_BACKUP_BYTES=$((SOURCE_FILE_BYTES + DATABASE_BYTES + CAPACITY_HEADROOM_BYTES))
if [ "$(stat -c %d "$BACKUP_ROOT")" = "$(stat -c %d /)" ]; then REQUIRED_BACKUP_BYTES=$((REQUIRED_BACKUP_BYTES + ROOT_RESERVE_BYTES)); fi
[ "$BACKUP_AVAILABLE_BYTES" -ge "$REQUIRED_BACKUP_BYTES" ] || { echo "backup root capacity is below source bytes plus database bytes and safety reserves" >&2; exit 1; }
printf 'backup capacity gate passed: SourceFiles=%sB Database=%sB BackupFree=%sB Required=%sB\n' "$SOURCE_FILE_BYTES" "$DATABASE_BYTES" "$BACKUP_AVAILABLE_BYTES" "$REQUIRED_BACKUP_BYTES" >&2

DATABASE_COMMENT="chenyida-erp-deployment/v2:$DEPLOYMENT_CLASS:$DEPLOYMENT_ID"
INTENT_FILE="$BACKUP_ROOT/.backup-fence-v2.json"
[ ! -e "$INTENT_FILE" ] && [ ! -L "$INTENT_FILE" ] || { echo "a durable backup guard intent already exists; run exact stale-guard recovery first" >&2; exit 1; }
FENCE_ACTIVE=0; INTENT_TEMP=""; INTENT_IDENTITY=""; INTENT_SHA256=""; WORK=""
intent_unchanged() {
  [ -n "$INTENT_IDENTITY" ] && [ "$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a:%h' "$INTENT_FILE" 2>/dev/null)" = "$INTENT_IDENTITY" ] && [ "$(sha256sum "$INTENT_FILE" 2>/dev/null | awk '{print $1}')" = "$INTENT_SHA256" ] || { echo "durable backup guard intent changed unexpectedly" >&2; return 1; }
}
database_guard_state() {
  db_env_override psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select count(*)::text from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),coalesce((select max(split_part(v,'=',2)) from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),'RESET'),d.datconnlimit::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()) from pg_control_system(),pg_database d where d.datname=current_database()"
}
database_guard_transition_probe() {
  probe=$(database_guard_state) || return 1
  old_ifs=$IFS; IFS='|'; set -- $probe; IFS=$old_ifs
  [ "$#" -eq 8 ] && [ "$1" = "$EXPECTED_DATABASE" ] && [ "$2" = "$DATABASE_SYSTEM_IDENTIFIER" ] && [ "$3" = "$DATABASE_OID" ] && [ "$4" = "$DATABASE_COMMENT" ] && [ "$8" = 0 ] || { echo "database identity or guard connection boundary changed" >&2; return 1; }
  case "$5:$6" in 0:RESET|1:on) : ;; *) echo "database read-only guard is outside the recoverable transition" >&2; return 1 ;; esac
  [ "$7" = 0 ] || [ "$7" = "$ORIGINAL_CONNECTION_LIMIT" ] || { echo "database connection limit is outside the recoverable transition" >&2; return 1; }
}
database_guard_probe() {
  probe=$(database_guard_state) || return 1
  [ "$probe" = "$EXPECTED_DATABASE|$DATABASE_SYSTEM_IDENTIFIER|$DATABASE_OID|$DATABASE_COMMENT|1|on|0|0" ] || { echo "database read-only, connection-limit, or quiesced guard is not active" >&2; return 1; }
}
database_released_probe() {
  probe=$(db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select count(*)::text from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),d.datconnlimit::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()),current_setting('default_transaction_read_only') from pg_control_system(),pg_database d where d.datname=current_database()") || return 1
  [ "$probe" = "$EXPECTED_DATABASE|$DATABASE_SYSTEM_IDENTIFIER|$DATABASE_OID|$DATABASE_COMMENT|0|$ORIGINAL_CONNECTION_LIMIT|0|off" ] || { echo "database guard did not restore the exact original writable state" >&2; return 1; }
}
remove_guard_intent() {
  intent_unchanged || return 1
  rm -- "$INTENT_FILE" || return 1
  sync -f "$BACKUP_ROOT" || return 1
  [ ! -e "$INTENT_FILE" ] && [ ! -L "$INTENT_FILE" ] || return 1
}
release_fence() {
  [ "$FENCE_ACTIVE" = 1 ] || return 0
  credential_unchanged && intent_unchanged && database_guard_transition_probe || return 1
  db_env_override psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 --set=database_name="$EXPECTED_DATABASE" --set=original_connection_limit="$ORIGINAL_CONNECTION_LIMIT" <<'SQL' >/dev/null || return 1
SELECT format('ALTER DATABASE %I RESET default_transaction_read_only', :'database_name') \gexec
SELECT format('ALTER DATABASE %I CONNECTION LIMIT %s', :'database_name', :'original_connection_limit') \gexec
SQL
  database_released_probe && credential_unchanged && intent_unchanged && remove_guard_intent || return 1
  FENCE_ACTIVE=0
}
cleanup() {
  result=$?; trap - EXIT
  cleanup_failed=0
  release_fence || cleanup_failed=1
  if [ -n "$INTENT_TEMP" ] && [ -e "$INTENT_TEMP" ]; then case "$INTENT_TEMP" in "$BACKUP_ROOT"/.backup-fence-v2.json.tmp.*) [ ! -L "$INTENT_TEMP" ] && rm -f -- "$INTENT_TEMP" || cleanup_failed=1 ;; *) cleanup_failed=1 ;; esac; fi
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then inside "$WORK" "$BACKUP_ROOT" && [ "$WORK" != "$BACKUP_ROOT" ] && rm -rf -- "$WORK" || cleanup_failed=1; fi
  [ "$cleanup_failed" = 0 ] || { echo "backup cleanup failed; the durable database guard requires exact recovery inspection" >&2; exit 1; }
  exit "$result"
}
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

write_guard_intent() {
  created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  root_device=$(stat -c %d "$BACKUP_ROOT"); root_inode=$(stat -c %i "$BACKUP_ROOT")
  INTENT_TEMP=$(mktemp "$BACKUP_ROOT/.backup-fence-v2.json.tmp.XXXXXX")
  printf '{"schema_version":2,"contract":"chenyida-erp-backup-fence/v2","state":"ACTIVE","deployment_class":"%s","deployment_id":"%s","database_service":"%s","database_name":"%s","database_system_identifier":"%s","database_oid":"%s","database_marker":"%s","database_comment":"%s","original_connection_limit":%s,"original_default_transaction_read_only":"off","backup_root_device":"%s","backup_root_inode":"%s","created_at":"%s"}\n' \
    "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$DB_SERVICE" "$EXPECTED_DATABASE" "$DATABASE_SYSTEM_IDENTIFIER" "$DATABASE_OID" "$DB_MARKER_ID" "$DATABASE_COMMENT" "$ORIGINAL_CONNECTION_LIMIT" "$root_device" "$root_inode" "$created_at" > "$INTENT_TEMP"
  chmod 0400 "$INTENT_TEMP"
  contract durably-sync-file --file "$INTENT_TEMP" >/dev/null
  mv -T -n -- "$INTENT_TEMP" "$INTENT_FILE"
  [ ! -e "$INTENT_TEMP" ] && [ -f "$INTENT_FILE" ] && [ ! -L "$INTENT_FILE" ] || { echo "durable backup guard intent lost the no-clobber race" >&2; return 1; }
  INTENT_TEMP=""
  [ "$(stat -c %h "$INTENT_FILE")" = 1 ] && [ "$(stat -c %u "$INTENT_FILE")" = "$(id -u)" ] && [ "$(stat -c %a "$INTENT_FILE")" = 400 ] || { echo "durable backup guard intent metadata is unsafe" >&2; return 1; }
  INTENT_IDENTITY=$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a:%h' "$INTENT_FILE")
  INTENT_SHA256=$(sha256sum "$INTENT_FILE" | awk '{print $1}')
  FENCE_ACTIVE=1
  contract durably-sync-file --file "$INTENT_FILE" >/dev/null
  intent_unchanged
}

credential_unchanged
write_guard_intent
db_env_override psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 --set=database_name="$EXPECTED_DATABASE" <<'SQL' >/dev/null
SELECT format('ALTER DATABASE %I CONNECTION LIMIT 0', :'database_name') \gexec
SELECT format('ALTER DATABASE %I SET default_transaction_read_only TO on', :'database_name') \gexec
SQL
db_env_override psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()" >/dev/null
database_guard_probe; credential_unchanged; intent_unchanged; running_application_writers_absent
if [ -n "$TEST_HOLD_SECONDS" ]; then sleep "$TEST_HOLD_SECONDS"; database_guard_probe; credential_unchanged; intent_unchanged; fi
CONSISTENCY_BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BACKUP_ID="backup-$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%.12s' "$GIT_COMMIT")"; OUTPUT="$BACKUP_ROOT/$BACKUP_ID"; [ ! -e "$OUTPUT" ] || { echo "backup output already exists" >&2; exit 1; }
WORK=$(mktemp -d "$BACKUP_ROOT/.erp-backup-v2.XXXXXX")
RECONCILIATION_SQL="$(dirname "$0")/backup-reconciliation.sql"

db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -f "$RECONCILIATION_SQL" > "$WORK/database-reconciliation-before.txt"
contract create-reconciliation --backup "$WORK" --database-report "$WORK/database-reconciliation-before.txt" --uploads "$UPLOADS" --attachments "$ATTACHMENTS" --backup-status "$BACKUP_STATUS" >/dev/null
db_env pg_dump --dbname="service=$DB_SERVICE" --format=custom --no-owner --no-acl --file="$WORK/postgresql.dump"
tar -C "$UPLOADS" -czf "$WORK/uploads.tar.gz" .; tar -C "$ATTACHMENTS" -czf "$WORK/attachments.tar.gz" .; tar -C "$BACKUP_STATUS" -czf "$WORK/backup-status.tar.gz" .
for artifact in postgresql.dump uploads.tar.gz attachments.tar.gz backup-status.tar.gz; do [ -s "$WORK/$artifact" ] || { echo "zero-byte backup component" >&2; exit 1; }; done

: > "$WORK/migrations.txt"
set +f
for migration in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do [ -f "$migration" ] && [ ! -L "$migration" ] || { echo "migration files missing or unsafe" >&2; exit 1; }; printf '%s  %s\n' "$(sha256sum "$migration" | awk '{print $1}')" "$(basename "$migration")" >> "$WORK/migrations.txt"; done
set -f
MIGRATION_HEAD=$(tail -n 1 "$WORK/migrations.txt" | awk '{print $2}'); [ -n "$MIGRATION_HEAD" ] || { echo "migration head missing" >&2; exit 1; }
db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -Atc "select checksum||'  '||version from schema_migrations order by version" > "$WORK/database-migrations.txt"
cmp -s "$WORK/migrations.txt" "$WORK/database-migrations.txt" || { echo "database migration list does not match source" >&2; exit 1; }; rm -f "$WORK/database-migrations.txt"
db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -f "$RECONCILIATION_SQL" > "$WORK/database-reconciliation-after.txt"
contract verify-source-reconciliation --backup "$WORK" --database-report "$WORK/database-reconciliation-after.txt" --uploads "$UPLOADS" --attachments "$ATTACHMENTS" --backup-status "$BACKUP_STATUS" >/dev/null
rm -f "$WORK/database-reconciliation-before.txt" "$WORK/database-reconciliation-after.txt"

UPLOAD_COUNT=$(find "$UPLOADS" -type f -printf . | wc -c | tr -d ' '); ATTACHMENT_COUNT=$(find "$ATTACHMENTS" -type f -printf . | wc -c | tr -d ' '); BACKUP_STATUS_COUNT=$(find "$BACKUP_STATUS" -type f -printf . | wc -c | tr -d ' ')
database_guard_probe; running_application_writers_absent
WEB_AFTER=$(writer_snapshot "$WEB_CONTAINER" web); WORKER_AFTER=$(writer_snapshot "$WORKER_CONTAINER" worker)
[ "$WEB_AFTER" = "$WEB_BEFORE" ] && [ "$WORKER_AFTER" = "$WORKER_BEFORE" ] || { echo "writer identity changed during capture" >&2; exit 1; }
CONSISTENCY_AFTER=$(date -u +%Y-%m-%dT%H:%M:%SZ); CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
contract create-manifest --backup "$WORK" --migrations "$MIGRATIONS" --backup-id "$BACKUP_ID" --created-at "$CREATED_AT" \
  --deployment-class "$DEPLOYMENT_CLASS" --deployment-id "$DEPLOYMENT_ID" --database-name "$EXPECTED_DATABASE" --database-system-identifier "$DATABASE_SYSTEM_IDENTIFIER" --database-oid "$DATABASE_OID" --database-marker "$DB_MARKER_ID" --database-bytes "$DATABASE_BYTES" \
  --database-server-major "$DATABASE_SERVER_MAJOR" --database-encoding "$DATABASE_ENCODING" --database-collate "$DATABASE_COLLATE" --database-ctype "$DATABASE_CTYPE" --database-locale-provider "$DATABASE_LOCALE_PROVIDER" --database-collation-version "$DATABASE_COLLATION_VERSION" \
  --app-version "$APP_VERSION" --git-commit "$GIT_COMMIT" --web-image-digest "$IMAGE_DIGEST" --worker-image-digest "$WORKER_IMAGE_DIGEST" --policy-id "$POLICY_ID" --rpo-hours "$RPO_HOURS" \
  --web-container "$WEB_CONTAINER" --web-container-id "$WEB_ID" --worker-container "$WORKER_CONTAINER" --worker-container-id "$WORKER_ID" \
  --recovery-point-at "$CONSISTENCY_BEFORE" --consistency-verified-after "$CONSISTENCY_AFTER" --uploads-entries "$UPLOAD_COUNT" --attachments-entries "$ATTACHMENT_COUNT" --backup-status-entries "$BACKUP_STATUS_COUNT" >/dev/null
credential_unchanged
contract durably-sync-tree --root "$WORK" >/dev/null
mv -T -n -- "$WORK" "$OUTPUT"
[ ! -e "$WORK" ] && [ -d "$OUTPUT" ] && [ ! -L "$OUTPUT" ] || { echo "backup promotion lost the no-clobber race" >&2; exit 1; }
WORK=""
contract durably-sync-tree --root "$OUTPUT" >/dev/null
release_fence
set -- verify-local --backup "$OUTPUT" --migrations "$MIGRATIONS" --source-root "$BACKUP_ROOT" --location-id "$LOCATION_ID" --receipt-root "$RECEIPT_ROOT"
[ -z "$MACHINE_IDENTITY_FILE" ] || set -- "$@" --machine-identity-file "$MACHINE_IDENTITY_FILE"
set -- "$@" --expected-deployment-class "$DEPLOYMENT_CLASS" --expected-deployment-id "$DEPLOYMENT_ID" --expected-database-name "$EXPECTED_DATABASE" --expected-database-system-identifier "$DATABASE_SYSTEM_IDENTIFIER" --expected-database-oid "$DATABASE_OID" --expected-database-marker "$DB_MARKER_ID" --expected-database-bytes "$DATABASE_BYTES" \
  --expected-database-server-major "$DATABASE_SERVER_MAJOR" --expected-database-encoding "$DATABASE_ENCODING" --expected-database-collate "$DATABASE_COLLATE" --expected-database-ctype "$DATABASE_CTYPE" --expected-database-locale-provider "$DATABASE_LOCALE_PROVIDER" --expected-database-collation-version "$DATABASE_COLLATION_VERSION" \
  --expected-app-version "$APP_VERSION" --expected-git-commit "$GIT_COMMIT" --expected-web-image-digest "$IMAGE_DIGEST" --expected-worker-image-digest "$WORKER_IMAGE_DIGEST" --expected-migration-head "$MIGRATION_HEAD" --expected-policy-id "$POLICY_ID" --expected-rpo-hours "$RPO_HOURS"
contract "$@" >/dev/null
[ -f "$RECEIPT_ROOT/$BACKUP_ID.local.json" ] && [ -f "$RECEIPT_ROOT/local.json" ] && [ -f "$RECEIPT_ROOT/latest.json" ] || { echo "local verification receipt publication failed" >&2; exit 1; }
for receipt in "$RECEIPT_ROOT/$BACKUP_ID.local.json" "$RECEIPT_ROOT/local.json" "$RECEIPT_ROOT/latest.json"; do [ "$(stat -c %a "$receipt")" = 640 ] && [ "$(stat -c %g "$receipt")" = "$RECEIPT_READER_GID" ] || { echo "verification receipt reader mode or group is invalid" >&2; exit 1; }; done
echo "backup v2 created and locally verified: $BACKUP_ID"
