#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

usage() {
  echo "usage: $0 --credential-root DIR --control-db-service-file FILE --control-db-service NAME --backup-root DIR --deployment-class TEST|UAT|PRODUCTION --deployment-id ID --expected-database NAME --expected-database-system-identifier ID --expected-database-oid OID --expected-database-marker ID --confirm RECOVER_EXACT_STALE_BACKUP_GUARD" >&2
  exit 2
}

CREDENTIAL_ROOT=""; CONTROL_SERVICE_FILE=""; CONTROL_DB_SERVICE=""; BACKUP_ROOT=""; DEPLOYMENT_CLASS=""; DEPLOYMENT_ID=""
EXPECTED_DATABASE=""; EXPECTED_SYSTEM_ID=""; EXPECTED_DATABASE_OID=""; EXPECTED_DATABASE_MARKER=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --credential-root) CREDENTIAL_ROOT=${2:-}; shift 2 ;;
    --control-db-service-file) CONTROL_SERVICE_FILE=${2:-}; shift 2 ;;
    --control-db-service) CONTROL_DB_SERVICE=${2:-}; shift 2 ;;
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

for value in "$CREDENTIAL_ROOT" "$CONTROL_SERVICE_FILE" "$CONTROL_DB_SERVICE" "$BACKUP_ROOT" "$DEPLOYMENT_CLASS" "$DEPLOYMENT_ID" "$EXPECTED_DATABASE" "$EXPECTED_SYSTEM_ID" "$EXPECTED_DATABASE_OID" "$EXPECTED_DATABASE_MARKER" "$CONFIRM"; do [ -n "$value" ] || usage; done
case "$DEPLOYMENT_CLASS" in TEST|UAT|PRODUCTION) : ;; *) echo "invalid deployment class" >&2; exit 1 ;; esac
[ "$CONFIRM" = RECOVER_EXACT_STALE_BACKUP_GUARD ] || { echo "exact stale backup guard recovery confirmation is required" >&2; exit 1; }
for value in "$CONTROL_DB_SERVICE" "$DEPLOYMENT_ID" "$EXPECTED_DATABASE" "$EXPECTED_DATABASE_MARKER"; do case "$value" in *[!A-Za-z0-9_.-]*|'') echo "invalid bounded identifier" >&2; exit 1 ;; esac; [ "${#value}" -le 120 ] || { echo "identifier is too long" >&2; exit 1; }; done
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

[ -f "$CONTROL_SERVICE_FILE" ] && [ ! -L "$CONTROL_SERVICE_FILE" ] || { echo "database control service file is missing or unsafe" >&2; exit 1; }
CONTROL_SERVICE_FILE=$(readlink -f "$CONTROL_SERVICE_FILE")
inside "$CONTROL_SERVICE_FILE" "$CREDENTIAL_ROOT" && [ "$CONTROL_SERVICE_FILE" != "$CREDENTIAL_ROOT/.chenyida-erp-credential-root-v2" ] || { echo "database control service file must be inside the credential root" >&2; exit 1; }
[ "$(stat -c %h "$CONTROL_SERVICE_FILE")" = 1 ] && [ "$(stat -c %u "$CONTROL_SERVICE_FILE")" = "$(id -u)" ] || { echo "database control service file identity is unsafe" >&2; exit 1; }
case "$(stat -c %a "$CONTROL_SERVICE_FILE")" in 400|600) : ;; *) echo "database control service file mode is unsafe" >&2; exit 1 ;; esac
cursor=$(dirname "$CONTROL_SERVICE_FILE")
while :; do
  [ "$(stat -c %u "$cursor")" = "$(id -u)" ] && [ $((0$(stat -c %a "$cursor") & 0022)) -eq 0 ] || { echo "credential ancestor is unsafe" >&2; exit 1; }
  [ "$cursor" = "$CREDENTIAL_ROOT" ] && break
  parent=$(dirname "$cursor"); [ "$parent" != "$cursor" ] && inside "$parent" "$CREDENTIAL_ROOT" || { echo "credential path escapes its root" >&2; exit 1; }; cursor=$parent
done
if grep -Eiq '^[[:space:]]*(passfile|sslkey)[[:space:]]*=' "$CONTROL_SERVICE_FILE"; then echo "external libpq secret references are not accepted" >&2; exit 1; fi

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
exec 8<"$CONTROL_SERVICE_FILE"; flock -s -n 8 || { echo "database control credential file is being modified" >&2; exit 1; }
SERVICE_FILE_IDENTITY=$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$CONTROL_SERVICE_FILE")
SERVICE_FILE_SHA256=$(sha256sum "$CONTROL_SERVICE_FILE" | awk '{print $1}')
credential_unchanged() {
  [ "$(stat -Lc '%d:%i:%s:%Y:%u:%g:%a' "$CONTROL_SERVICE_FILE" 2>/dev/null)" = "$SERVICE_FILE_IDENTITY" ] && [ "$(sha256sum "$CONTROL_SERVICE_FILE" 2>/dev/null | awk '{print $1}')" = "$SERVICE_FILE_SHA256" ] || { echo "database control credential file changed during guard recovery" >&2; return 1; }
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
const keys = ["schema_version", "contract", "state", "deployment_class", "deployment_id", "control_database_service", "capture_database_service", "capture_database_role", "connect_fence_contract", "database_name", "database_system_identifier", "database_oid", "database_marker", "database_comment", "original_connection_limit", "original_default_transaction_read_only", "backup_root_device", "backup_root_inode", "created_at"];
const fail = () => process.exit(1);
if (!value || Array.isArray(value) || typeof value !== "object" || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys) || raw !== `${JSON.stringify(value)}\n`) fail();
if (value.schema_version !== 3 || value.contract !== "chenyida-erp-backup-fence/v3" || value.state !== "ACTIVE" || value.original_default_transaction_read_only !== "off") fail();
if (value.capture_database_role !== "chenyida_erp_backup" || value.connect_fence_contract !== "chenyida-erp-backup-connect-fence/v1") fail();
const bounded = /^[A-Za-z0-9_.-]{1,120}$/;
for (const key of ["deployment_id", "control_database_service", "capture_database_service", "database_name", "database_marker"]) if (typeof value[key] !== "string" || !bounded.test(value[key])) fail();
if (value.control_database_service === value.capture_database_service) fail();
if (!["TEST", "UAT", "PRODUCTION"].includes(value.deployment_class)) fail();
for (const key of ["database_system_identifier", "database_oid", "backup_root_device", "backup_root_inode"]) if (typeof value[key] !== "string" || !/^[0-9]+$/.test(value[key])) fail();
if (typeof value.database_comment !== "string" || value.database_comment !== `chenyida-erp-deployment/v2:${value.deployment_class}:${value.deployment_id}`) fail();
if (!Number.isInteger(value.original_connection_limit) || value.original_connection_limit < -1 || value.original_connection_limit > 2147483647) fail();
if (typeof value.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.created_at) || Number.isNaN(Date.parse(value.created_at))) fail();
process.stdout.write([value.deployment_class, value.deployment_id, value.control_database_service, value.capture_database_service, value.database_name, value.database_system_identifier, value.database_oid, value.database_marker, value.database_comment, value.original_connection_limit, value.backup_root_device, value.backup_root_inode, value.created_at].join("|"));
NODE
) || { echo "durable backup guard intent contract is invalid" >&2; exit 1; }
old_ifs=$IFS; IFS='|'; set -- $INTENT_VALUES; IFS=$old_ifs
[ "$#" -eq 13 ] || { echo "durable backup guard intent fields are incomplete" >&2; exit 1; }
INTENT_CLASS=$1; INTENT_DEPLOYMENT_ID=$2; INTENT_CONTROL_DB_SERVICE=$3; INTENT_CAPTURE_DB_SERVICE=$4; INTENT_DATABASE=$5; INTENT_SYSTEM_ID=$6; INTENT_DATABASE_OID=$7
INTENT_DATABASE_MARKER=$8; INTENT_DATABASE_COMMENT=$9; ORIGINAL_CONNECTION_LIMIT=${10}; INTENT_ROOT_DEVICE=${11}; INTENT_ROOT_INODE=${12}; INTENT_CREATED_AT=${13}
[ "$INTENT_CLASS" = "$DEPLOYMENT_CLASS" ] && [ "$INTENT_DEPLOYMENT_ID" = "$DEPLOYMENT_ID" ] && [ "$INTENT_CONTROL_DB_SERVICE" = "$CONTROL_DB_SERVICE" ] && [ "$INTENT_DATABASE" = "$EXPECTED_DATABASE" ] || { echo "guard intent deployment or database control service does not match the exact request" >&2; exit 1; }
[ -n "$INTENT_CAPTURE_DB_SERVICE" ] || { echo "guard intent capture service is invalid" >&2; exit 1; }
[ "$INTENT_SYSTEM_ID" = "$EXPECTED_SYSTEM_ID" ] && [ "$INTENT_DATABASE_OID" = "$EXPECTED_DATABASE_OID" ] && [ "$INTENT_DATABASE_MARKER" = "$EXPECTED_DATABASE_MARKER" ] || { echo "guard intent database stable identity does not match the exact request" >&2; exit 1; }
[ "$INTENT_DATABASE_COMMENT" = "chenyida-erp-deployment/v2:$DEPLOYMENT_CLASS:$DEPLOYMENT_ID" ] || { echo "guard intent database comment is invalid" >&2; exit 1; }
[ "$INTENT_ROOT_DEVICE" = "$(stat -c %d "$BACKUP_ROOT")" ] && [ "$INTENT_ROOT_INODE" = "$(stat -c %i "$BACKUP_ROOT")" ] || { echo "guard intent is bound to a different backup root" >&2; exit 1; }
intent_unchanged; credential_unchanged

db_env() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$CONTROL_SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 "$@"; }
db_env_override() { env -i PATH="$SAFE_PATH" LANG=C LC_ALL=C PGSERVICEFILE="$CONTROL_SERVICE_FILE" PGPASSFILE=/dev/null PGSSLKEY=/dev/null PGSSLCERT=/dev/null PGCONNECT_TIMEOUT=15 PGOPTIONS='-c default_transaction_read_only=off' "$@"; }
CONNECT_STATE_RELEASED='9:5:0:0:4:1:0:0'
CONNECT_STATE_FENCED='9:1:0:0:0:1:0:0'
guard_state=$(db_env_override psql --no-psqlrc --quiet --dbname="service=$CONTROL_DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select rolsuper::text from pg_roles where rolname=current_user),(select count(*)::text from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),coalesce((select max(split_part(v,'=',2)) from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),'RESET'),d.datconnlimit::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and usename not in (current_user,'chenyida_erp_backup')),(select count(*)::text from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,d.oid,'CONNECT')),(with target as (select oid,datacl,datdba from pg_database where datname=current_database()),expected_roles as (select oid,rolname from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup','chenyida_erp_web_priv','chenyida_erp_worker_priv','chenyida_erp_admin_priv','chenyida_erp_backup_priv')),expanded as (select a.grantee,a.privilege_type from target t cross join lateral aclexplode(coalesce(t.datacl,acldefault('d',t.datdba))) a) select concat_ws(':',(select count(*) from expected_roles),(select count(*) from expected_roles r,target t where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup') and has_database_privilege(r.oid,t.oid,'CONNECT')),(select count(*) from expanded where grantee=0 and privilege_type='CONNECT'),(select count(*) from expanded where grantee=0 and privilege_type='TEMPORARY'),(select count(distinct r.rolname) from expanded e join expected_roles r on r.oid=e.grantee where e.privilege_type='CONNECT' and r.rolname in ('chenyida_erp_owner','chenyida_erp_web_priv','chenyida_erp_worker_priv','chenyida_erp_admin_priv')),(select count(*) from expanded e join expected_roles r on r.oid=e.grantee where e.privilege_type='CONNECT' and r.rolname='chenyida_erp_backup_priv'),(select count(*) from expanded e where e.privilege_type='CONNECT' and e.grantee<>0 and not exists(select 1 from expected_roles r where r.oid=e.grantee and r.rolname in ('chenyida_erp_owner','chenyida_erp_web_priv','chenyida_erp_worker_priv','chenyida_erp_admin_priv','chenyida_erp_backup_priv'))),(select count(*) from pg_roles r,target t where r.rolcanlogin and r.rolname<>current_user and r.rolname not in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup') and has_database_privilege(r.oid,t.oid,'CONNECT')))) from pg_control_system(),pg_database d where d.datname=current_database()")
old_ifs=$IFS; IFS='|'; set -- $guard_state; IFS=$old_ifs
[ "$#" -eq 11 ] && [ "$1" = "$EXPECTED_DATABASE" ] && [ "$2" = "$EXPECTED_SYSTEM_ID" ] && [ "$3" = "$EXPECTED_DATABASE_OID" ] && [ "$4" = "$INTENT_DATABASE_COMMENT" ] && { [ "$5" = true ] || [ "$5" = t ]; } && [ "$8" = "$ORIGINAL_CONNECTION_LIMIT" ] || { echo "live cluster, database identity, recovery role, or connection boundary is invalid" >&2; exit 1; }
case "$6:$7:${10}:${11}" in "0:RESET:4:$CONNECT_STATE_RELEASED"|"1:on:0:$CONNECT_STATE_FENCED") : ;; *) echo "live database read-only or CONNECT state is outside the exact guard transition" >&2; exit 1 ;; esac
credential_unchanged; intent_unchanged

db_env_override psql --no-psqlrc --quiet --dbname="service=$CONTROL_DB_SERVICE" -v ON_ERROR_STOP=1 --set=database_name="$EXPECTED_DATABASE" <<'SQL' >/dev/null
BEGIN;
SELECT format('ALTER DATABASE %I RESET default_transaction_read_only', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO chenyida_erp_owner, chenyida_erp_web_priv, chenyida_erp_worker_priv, chenyida_erp_admin_priv', :'database_name') \gexec
COMMIT;
SQL

released_state=$(db_env psql --no-psqlrc --quiet --dbname="service=$CONTROL_DB_SERVICE" -v ON_ERROR_STOP=1 -At -F '|' -c "select current_database(),system_identifier::text,d.oid::text,coalesce(shobj_description(d.oid,'pg_database'),''),(select count(*)::text from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where s.setdatabase=d.oid and s.setrole=0 and v like 'default_transaction_read_only=%'),d.datconnlimit::text,(select count(*)::text from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and usename not in (current_user,'chenyida_erp_backup')),current_setting('default_transaction_read_only'),(select count(*)::text from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,d.oid,'CONNECT')),(with target as (select oid,datacl,datdba from pg_database where datname=current_database()),expected_roles as (select oid,rolname from pg_roles where rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup','chenyida_erp_web_priv','chenyida_erp_worker_priv','chenyida_erp_admin_priv','chenyida_erp_backup_priv')),expanded as (select a.grantee,a.privilege_type from target t cross join lateral aclexplode(coalesce(t.datacl,acldefault('d',t.datdba))) a) select concat_ws(':',(select count(*) from expected_roles),(select count(*) from expected_roles r,target t where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup') and has_database_privilege(r.oid,t.oid,'CONNECT')),(select count(*) from expanded where grantee=0 and privilege_type='CONNECT'),(select count(*) from expanded where grantee=0 and privilege_type='TEMPORARY'),(select count(distinct r.rolname) from expanded e join expected_roles r on r.oid=e.grantee where e.privilege_type='CONNECT' and r.rolname in ('chenyida_erp_owner','chenyida_erp_web_priv','chenyida_erp_worker_priv','chenyida_erp_admin_priv')),(select count(*) from expanded e join expected_roles r on r.oid=e.grantee where e.privilege_type='CONNECT' and r.rolname='chenyida_erp_backup_priv'),(select count(*) from expanded e where e.privilege_type='CONNECT' and e.grantee<>0 and not exists(select 1 from expected_roles r where r.oid=e.grantee and r.rolname in ('chenyida_erp_owner','chenyida_erp_web_priv','chenyida_erp_worker_priv','chenyida_erp_admin_priv','chenyida_erp_backup_priv'))),(select count(*) from pg_roles r,target t where r.rolcanlogin and r.rolname<>current_user and r.rolname not in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin','chenyida_erp_backup') and has_database_privilege(r.oid,t.oid,'CONNECT')))) from pg_control_system(),pg_database d where d.datname=current_database()")
[ "$released_state" = "$EXPECTED_DATABASE|$EXPECTED_SYSTEM_ID|$EXPECTED_DATABASE_OID|$INTENT_DATABASE_COMMENT|0|$ORIGINAL_CONNECTION_LIMIT|0|off|4|$CONNECT_STATE_RELEASED" ] || { echo "database guard did not restore the exact original writable and CONNECT state" >&2; exit 1; }
credential_unchanged; intent_unchanged
rm -- "$INTENT_FILE"
sync -f "$BACKUP_ROOT"
[ ! -e "$INTENT_FILE" ] && [ ! -L "$INTENT_FILE" ] || { echo "durable backup guard intent removal did not persist" >&2; exit 1; }
echo "exact stale backup guard recovered: $DEPLOYMENT_CLASS/$DEPLOYMENT_ID $EXPECTED_DATABASE intent=$INTENT_CREATED_AT"
