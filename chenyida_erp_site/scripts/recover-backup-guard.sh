#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --credential-root DIR --db-service-file FILE --db-service NAME --backup-root DIR --deployment-class TEST|UAT|PRODUCTION --deployment-id ID --expected-database NAME --expected-database-system-identifier ID --expected-database-oid OID --expected-database-marker ID --confirm RECOVER_EXACT_STALE_BACKUP_GUARD" >&2
  exit 2
}

CREDENTIAL_ROOT=""; SERVICE_FILE=""; DB_SERVICE=""; BACKUP_ROOT=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""
EXPECTED_DATABASE=""; EXPECTED_SYSTEM_ID=""; EXPECTED_DATABASE_OID=""; EXPECTED_DATABASE_MARKER=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --credential-root) CREDENTIAL_ROOT=${2:-}; shift 2 ;;
    --db-service-file) SERVICE_FILE=${2:-}; shift 2 ;;
    --db-service) DB_SERVICE=${2:-}; shift 2 ;;
    --backup-root) BACKUP_ROOT=${2:-}; shift 2 ;;
    --deployment-class) DEPLOYMENT_CLASS=${2:-}; shift 2 ;;
    --deployment-id) DEPLOYMENT_ID=${2:-}; shift 2 ;;
    --expected-database) EXPECTED_DATABASE=${2:-}; shift 2 ;;
    --expected-database-system-identifier) EXPECTED_SYSTEM_ID=${2:-}; shift 2 ;;
    --expected-database-oid) EXPECTED_DATABASE_OID=${2:-}; shift 2 ;;
    --expected-database-marker) EXPECTED_DATABASE_MARKER=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

for value in "$CREDENTIAL_ROOT" "$SERVICE_FILE" "$DB_SERVICE" "$BACKUP_ROOT" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$EXPECTED_DATABASE" "$EXPECTED_SYSTEM_ID" "$EXPECTED_DATABASE_OID" "$EXPECTED_DATABASE_MARKER" "$CONFIRM"; do [ -n "$value" ] || usage; done
case "$DEPLOYMENT_CLASS" in TEST|UAT|PRODUCTION) : ;; *) echo "invalid deployment class" >&2; exit 1 ;; esac
[ "$CONFIRM" = RECOVER_EXACT_STALE_BACKUP_GUARD ] || { echo "exact stale backup guard recovery confirmation is required" >&2; exit 1; }
for value in "$DB_SERVICE" "$DEPLOYMENT_ID" "$EXPECTED_DATABASE" "$EXPECTED_DATABASE_MARKER"; do case "$value" in *[!A-Za-z0-9_.-]*|'') echo "invalid bounded identifier" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "identifier is too long" >&2; exit 1; }; done
case "$EXPECTED_SYSTEM_ID:$EXPECTED_DATABASE_OID" in *[!0-9:]*|*::*|:*|*:) echo "expected database stable identity is invalid" >&2; exit 1 ;; esac
[ "$EXPECTED_DATABASE_MARKER" = "$DEPLOYMENT_CLASS.$DEPLOYMENT_ID" ] || { echo "expected database marker does not match the exact deployment" >&2; exit 1; }
[ "$DEPLOYMENT_CLASS" != PRODUCTION ] || [ "$(id -u)" = 0 ] || { echo "production guard recovery requires root" >&2; exit 1; }

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

BACKUP_ROOT=$(validate_root "$BACKUP_ROOT" .chenyida-erp-backup-root-v2 chenyida-erp-backup-root/v2)
CREDENTIAL_ROOT=$(validate_root "$CREDENTIAL_ROOT" .chenyida-erp-credential-root-v2 chenyida-erp-credential-root/v2)
overlap "$BACKUP_ROOT" "$CREDENTIAL_ROOT" && { echo "backup and credential roots overlap" >&2; exit 1; }

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
for lock_file in "$BACKUP_ROOT/.selfhost-ops-v2.lock" "$BACKUP_ROOT/.backup-v2.lock"; do [ ! -L "$lock_file" ] || { echo "backup operations lock path is unsafe" >&2; exit 1; }; done
exec 9>"$BACKUP_ROOT/.selfhost-ops-v2.lock"; flock -n 9 || { echo "global self-host database operations lock is busy for this backup root" >&2; exit 1; }
exec 5>"$BACKUP_ROOT/.backup-v2.lock"; flock -n 5 || { echo "another backup or guard recovery is active for this root" >&2; exit 1; }
for lock_file in "$BACKUP_ROOT/.selfhost-ops-v2.lock" "$BACKUP_ROOT/.backup-v2.lock"; do
  [ -f "$lock_file" ] && [ ! -L "$lock_file" ] && [ "$(stat -c %h "$lock_file")" = 1 ] && [ "$(stat -c %u "$lock_file")" = "$(id -u)" ] || { echo "backup operations lock identity is unsafe" >&2; exit 1; }
  chmod 0600 "$lock_file"
done
exec 8<"$SERVICE_FILE"; flock -s -n 8 || { echo "database credential file is being modified" >&2; exit 1; }
SERVICE_FILE_IDENTITY=$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$SERVICE_FILE")
SERVICE_FILE_SHA256=$(sha256sum "$SERVICE_FILE" | awk '{print $1}')
credential_unchanged() {
  [ "$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$SERVICE_FILE" 2>/dev/null)" = "$SERVICE_FILE_IDENTITY" ] && [ "$(sha256sum "$SERVICE_FILE" 2>/dev/null | awk '{print $1}')" = "$SERVICE_FILE_SHA256" ] || { echo "database credential file changed during guard recovery" >&2; return 1; }
}

INTENT_FILE="$BACKUP_ROOT/.backup-fence-v2.json"
[ -f "$INTENT_FILE" ] && [ ! -L "$INTENT_FILE" ] && [ "$(stat -c %h "$INTENT_FILE")" = 1 ] && [ "$(stat -c %u "$INTENT_FILE")" = "$(id -u)" ] && [ "$(stat -c %a "$INTENT_FILE")" = 400 ] || { echo "durable backup guard intent is missing or unsafe" >&2; exit 1; }
INTENT_BYTES=$(stat -c %s "$INTENT_FILE")
[ "$INTENT_BYTES" -ge 2 ] && [ "$INTENT_BYTES" -le 4096 ] || { echo "durable backup guard intent size is invalid" >&2; exit 1; }
INTENT_IDENTITY=$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a:%h' "$INTENT_FILE")
INTENT_SHA256=$(sha256sum "$INTENT_FILE" | awk '{print $1}')
intent_unchanged() {
  [ "$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a:%h' "$INTENT_FILE" 2>/dev/null)" = "$INTENT_IDENTITY" ] && [ "$(sha256sum "$INTENT_FILE" 2>/dev/null | awk '{print $1}')" = "$INTENT_SHA256" ] || { echo "durable backup guard intent changed during recovery" >&2; return 1; }
}

SAFE_PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
INTENT_VALUES=$(env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C NODE_OPTIONS=--max-old-space-size=64 INTENT_FILE="$INTENT_FILE" node <<'NODE'
const fs = require("fs");
const raw = fs.readFileSync(process.env.INTENT_FILE, "utf8");
const value = JSON.parse(raw);
const keys = ["schema_version", "contract", "state", "deployment_class", "deployment_id", "database_service", "database_name", "database_system_identifier", "database_oid", "database_marker", "database_comment", "original_connection_limit", "original_default_transaction_read_only", "backup_root_device", "backup_root_inode", "created_at"];
const fail = () => process.exit(1);
if (!value || Array.isArray(value) || typeof value !== "object" || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys) || raw !== `${JSON.stringify(value)}\n`) fail();
if (value.schema_version !== 2 || value.contract !== "chenyida-erp-backup-fence/v2" || value.state !== "ACTIVE" || value.original_default_transaction_read_only !== "off") fail();
const bounded = /^[A-Za-z0-9_.-]{1,120}$/;
for (const key of ["deployment_id", "database_service", "database_name", "database_marker"]) if (typeof value[key] !== "string" || !bounded.test(value[key])) fail();
if (!["TEST", "UAT", "PRODUCTION"].includes(value.deployment_class)) fail();
for (const key of ["database_system_identifier", "database_oid", "backup_root_device", "backup_root_inode"]) if (typeof value[key] !== "string" || !/^[0-9]+$/.test(value[key])) fail();
if (typeof value.database_comment !== "string" || value.database_comment !== `chenyida-erp-deployment/v2:${value.deployment_class}:${value.deployment_id}`) fail();
if (!Number.isInteger(value.original_connection_limit) || value.original_connection_limit < -1 || value.original_connection_limit > 2147483647) fail();
if (typeof value.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.created_at) || Number.isNaN(Date.parse(value.created_at))) fail();
process.stdout.write([value.deployment_class, value.deployment_id, value.database_service, value.database_name, value.database_system_identifier, value.database_oid, value.database_marker, value.database_comment, value.original_connection_limit, value.backup_root_device, value.backup_root_inode, value.created_at].join("|"));
NODE
) || { echo "durable backup guard intent contract is invalid" >&2; exit 1; }
old_ifs=$IFS; IFS='|'; set -- $INTENT_VALUES; IFS=$old_ifs
[ "$#" -eq 12 ] || { echo "durable backup guard intent fields are incomplete" >&2; exit 1; }
INTENT_CLASS=$1; INTENT_DEPLOYMENT_ID=$2; INTENT_DB_SERVICE=$3; INTENT_DATABASE=$4; INTENT_SYSTEM_ID=$5; INTENT_DATABASE_OID=$6
INTENT_DATABASE_MARKER=$7; INTENT_DATABASE_COMMENT=$8; ORIGINAL_CONNECTION_LIMIT=$9; INTENT_ROOT_DEVICE=${10}; INTENT_ROOT_INODE=${11}; INTENT_CREATED_AT=${12}
[ "$INTENT_CLASS" = "$DEPLOYMENT_CLASS" ] && [ "$INTENT_DEPLOYMENT_ID" = "$DEPLOYMENT_ID" ] && [ "$INTENT_DB_SERVICE" = "$DB_SERVICE" ] && [ "$INTENT_DATABASE" = "$EXPECTED_DATABASE" ] || { echo "guard intent deployment or database service does not match the exact request" >&2; exit 1; }
[ "$INTENT_SYSTEM_ID" = "$EXPECTED_SYSTEM_ID" ] && [ "$INTENT_DATABASE_OID" = "$EXPECTED_DATABASE_OID" ] && [ "$INTENT_DATABASE_MARKER" = "$EXPECTED_DATABASE_MARKER" ] || { echo "guard intent database stable identity does not match the exact request" >&2; exit 1; }
[ "$INTENT_DATABASE_COMMENT" = "chenyida-erp-deployment/v2:$DEPLOYMENT_CLASS:$DEPLOYMENT_ID" ] || { echo "guard intent database comment is invalid" >&2; exit 1; }
[ "$INTENT_ROOT_DEVICE" = "$(stat -c %d "$BACKUP_ROOT")" ] && [ "$INTENT_ROOT_INODE" = "$(stat -c %i "$BACKUP_ROOT")" ] || { echo "guard intent is bound to a different backup root" >&2; exit 1; }
intent_unchanged; credential_unchanged

db_env() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 "$@"; }
db_env_override() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 PGOPTIONS='-c default_transaction_read_only=off' "$@"; }
guard_state=$(db_env_override psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select rolsuper::text from pg_roles where rolname=current_user),(select count(*)::text from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),coalesce((select max(split_part(v,'=',2)) from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),'RESET'),d.datconnlimit::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()) from pg_control_system(),pg_database d where d.datname=current_database()")
old_ifs=$IFS; IFS='|'; set -- $guard_state; IFS=$old_ifs
[ "$#" -eq 9 ] && [ "$1" = "$EXPECTED_DATABASE" ] && [ "$2" = "$EXPECTED_SYSTEM_ID" ] && [ "$3" = "$EXPECTED_DATABASE_OID" ] && [ "$4" = "$INTENT_DATABASE_COMMENT" ] && { [ "$5" = true ] || [ "$5" = t ]; } && [ "$9" = 0 ] || { echo "live cluster, database identity, recovery role, or connection boundary is invalid" >&2; exit 1; }
case "$6:$7" in 0:RESET|1:on) : ;; *) echo "live database read-only state is outside the exact guard transition" >&2; exit 1 ;; esac
[ "$8" = 0 ] || [ "$8" = "$ORIGINAL_CONNECTION_LIMIT" ] || { echo "live database connection limit is outside the exact guard transition" >&2; exit 1; }
credential_unchanged; intent_unchanged

db_env_override psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 --set=database_name="$EXPECTED_DATABASE" --set=original_connection_limit="$ORIGINAL_CONNECTION_LIMIT" <<'SQL' >/dev/null
SELECT format('ALTER DATABASE %I RESET default_transaction_read_only', :'database_name') \gexec
SELECT format('ALTER DATABASE %I CONNECTION LIMIT %s', :'database_name', :'original_connection_limit') \gexec
SQL

released_state=$(db_env psql --no-psqlrc --quiet --dbname="service=$DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select count(*)::text from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),d.datconnlimit::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()),current_setting('default_transaction_read_only') from pg_control_system(),pg_database d where d.datname=current_database()")
[ "$released_state" = "$EXPECTED_DATABASE|$EXPECTED_SYSTEM_ID|$EXPECTED_DATABASE_OID|$INTENT_DATABASE_COMMENT|0|$ORIGINAL_CONNECTION_LIMIT|0|off" ] || { echo "database guard did not restore the exact original writable state" >&2; exit 1; }
credential_unchanged; intent_unchanged
rm -- "$INTENT_FILE"
sync -f "$BACKUP_ROOT"
[ ! -e "$INTENT_FILE" ] && [ ! -L "$INTENT_FILE" ] || { echo "durable backup guard intent removal did not persist" >&2; exit 1; }
echo "exact stale backup guard recovered: $DEPLOYMENT_CLASS/$DEPLOYMENT_ID $EXPECTED_DATABASE intent=$INTENT_CREATED_AT"
