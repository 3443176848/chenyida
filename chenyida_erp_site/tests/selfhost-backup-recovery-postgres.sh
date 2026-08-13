#!/bin/sh
set -eu
set -f
LC_ALL=C
export LC_ALL

SITE_ROOT=/workspace
cd "$SITE_ROOT"
TASK_ROOT=$(mktemp -d /tmp/cyd-backup-v2-postgres.XXXXXX)
chmod 0711 "$TASK_ROOT"
NODE_ENV=test
ERP_RELEASE_GATE_LOCK_FILE="$TASK_ROOT/release-gate.lock"
export NODE_ENV ERP_RELEASE_GATE_LOCK_FILE
SOURCE_PGDATA="$TASK_ROOT/source-pgdata"; SOURCE_SOCKET="$TASK_ROOT/source-socket"; SOURCE_LOG="$SOURCE_PGDATA/postgres.log"
TARGET_PGDATA="$TASK_ROOT/target-pgdata"; TARGET_SOCKET="$TASK_ROOT/target-socket"; TARGET_LOG="$TARGET_PGDATA/postgres.log"
SOURCE_RUNNING=0; TARGET_RUNNING=0; GUARD_PID=""

stop_cluster() {
  data=$1
  [ -s "$data/postmaster.pid" ] || return 0
  gosu postgres pg_ctl -D "$data" -m fast -w stop >/dev/null 2>&1
}
cleanup() {
  cleanup_status=0
  if [ -n "$GUARD_PID" ]; then kill -9 "$GUARD_PID" >/dev/null 2>&1 || true; wait "$GUARD_PID" >/dev/null 2>&1 || true; fi
  [ "$TARGET_RUNNING" = 0 ] || stop_cluster "$TARGET_PGDATA" || cleanup_status=1
  [ "$SOURCE_RUNNING" = 0 ] || stop_cluster "$SOURCE_PGDATA" || cleanup_status=1
  case "$TASK_ROOT" in /tmp/cyd-backup-v2-postgres.*) rm -rf -- "$TASK_ROOT" || cleanup_status=1 ;; *) echo "refusing unsafe PostgreSQL cleanup" >&2; cleanup_status=1 ;; esac
  [ "$cleanup_status" = 0 ] || exit 1
}
on_signal() { signal_status=$1; trap - EXIT HUP INT TERM; cleanup; exit "$signal_status"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

initialize_cluster() {
  data=$1; socket=$2
  install -d -m 0700 -o postgres -g postgres "$data" "$socket"
  gosu postgres initdb -D "$data" --auth-local=trust --auth-host=scram-sha-256 --locale=C --encoding=UTF8 >/dev/null
}
start_cluster() {
  data=$1; socket=$2; log=$3
  gosu postgres pg_ctl -D "$data" -l "$log" -o "-k $socket -c listen_addresses='' -c max_connections=20 -c shared_buffers=64MB -c work_mem=4MB -c maintenance_work_mem=32MB" -w start >/dev/null
}
marker_root() {
  root=$1; marker=$2; value=$3; mode=${4:-700}
  mkdir -m "$mode" "$root"; chmod "$mode" "$root"
  printf '%s\n' "$value" > "$root/$marker"; chmod 0400 "$root/$marker"
}
receipt_result() {
  node -e 'const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.result)' "$1"
}

initialize_cluster "$SOURCE_PGDATA" "$SOURCE_SOCKET"
start_cluster "$SOURCE_PGDATA" "$SOURCE_SOCKET" "$SOURCE_LOG"
SOURCE_RUNNING=1
export PGHOST="$SOURCE_SOCKET" PGUSER=postgres

psql -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role chenyida_erp_owner login noinherit connection limit 1;
create role chenyida_erp_web_priv nologin;
create role chenyida_erp_worker_priv nologin;
create role chenyida_erp_admin_priv nologin;
create role chenyida_erp_backup_priv nologin;
create role chenyida_erp_web login inherit connection limit 12;
create role chenyida_erp_worker login inherit connection limit 6;
create role chenyida_erp_admin login inherit connection limit 1;
create role chenyida_erp_backup login inherit connection limit 2;
grant chenyida_erp_web_priv to chenyida_erp_web with inherit true, set false;
grant chenyida_erp_worker_priv to chenyida_erp_worker with inherit true, set false;
grant chenyida_erp_admin_priv to chenyida_erp_admin with inherit true, set false;
grant chenyida_erp_backup_priv to chenyida_erp_backup with inherit true, set false;
SQL
createdb -O chenyida_erp_owner source_test
psql -d postgres -v ON_ERROR_STOP=1 -c "comment on database source_test is 'chenyida-erp-deployment/v2:TEST:erp-test-source'" >/dev/null
createdb -O chenyida_erp_owner guard_test
psql -d postgres -v ON_ERROR_STOP=1 -c "comment on database guard_test is 'chenyida-erp-deployment/v2:TEST:guard-source'" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
revoke connect,temporary on database source_test from public;
revoke connect,temporary on database guard_test from public;
grant connect on database source_test to chenyida_erp_owner,chenyida_erp_web_priv,chenyida_erp_worker_priv,chenyida_erp_admin_priv,chenyida_erp_backup_priv;
grant connect on database guard_test to chenyida_erp_owner,chenyida_erp_web_priv,chenyida_erp_worker_priv,chenyida_erp_admin_priv,chenyida_erp_backup_priv;
SQL
for database in source_test guard_test; do
  psql -U chenyida_erp_owner -d "$database" -v ON_ERROR_STOP=1 -c "revoke create,usage on schema public from public; grant usage on schema public to chenyida_erp_backup_priv" >/dev/null
done
GUARD_DATABASE_OID=$(psql -d postgres -Atc "select oid from pg_database where datname='guard_test'")
MIGRATIONS="$TASK_ROOT/migrations"; mkdir -m 0700 "$MIGRATIONS"; printf 'select 1;\n' > "$MIGRATIONS/0001_test.sql"; MIGRATION_SHA=$(sha256sum "$MIGRATIONS/0001_test.sql" | awk '{print $1}')
psql -U chenyida_erp_owner -d source_test -v ON_ERROR_STOP=1 <<SQL >/dev/null
create extension pgcrypto;
create extension btree_gist;
create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now());
insert into schema_migrations(version,checksum) values('0001_test.sql','$MIGRATION_SHA');
create table restored_probe(id integer primary key,payload text not null);
insert into restored_probe values(1,'synthetic-restore-proof');
create table canonical_session_probe(id integer primary key,happened_at timestamptz not null,duration interval not null);
insert into canonical_session_probe values(1,'2026-08-12 16:34:56.123456+08','3 days 04:05:06.789');
create schema private_domain;
create table private_domain.private_probe(id integer primary key,payload text not null);
insert into private_domain.private_probe values(1,'non-public-schema-proof');
create table extension_probe(id integer primary key,active_range int4range not null);
alter table extension_probe add constraint extension_probe_no_overlap exclude using gist(active_range with &&);
insert into extension_probe values(1,'[1,10)');
create sequence restored_sequence;
select setval('restored_sequence',42,true);
create table restore_fault_probe(id integer primary key check(current_setting('erp.restore_fault',true) is distinct from 'on'));
insert into restore_fault_probe values(1);
create publication restore_publication for table restored_probe;
grant usage on schema private_domain to chenyida_erp_backup_priv;
grant select on all tables in schema public,private_domain to chenyida_erp_backup_priv;
grant select on all sequences in schema public,private_domain to chenyida_erp_backup_priv;
SQL
psql -U postgres -d source_test -v ON_ERROR_STOP=1 -c "revoke execute on function digest(bytea,text) from public; grant execute on function digest(bytea,text) to chenyida_erp_backup_priv" >/dev/null

SOURCE_SYSTEM_ID=$(psql -d source_test -Atc 'select system_identifier from pg_control_system()')
SOURCE_DATABASE_OID=$(psql -d source_test -Atc "select oid from pg_database where datname=current_database()")
SOURCE_PROFILE=$(psql -d source_test -At -F '|' -c "select ((current_setting('server_version_num')::integer/10000)::text),pg_encoding_to_char(d.encoding),d.datcollate,d.datctype,case d.datlocprovider when 'c' then 'libc' when 'i' then 'icu' when 'b' then 'builtin' else 'unknown' end,coalesce(d.datcollversion,'NONE') from pg_database d where d.datname=current_database()")
old_ifs=$IFS; IFS='|'; set -- $SOURCE_PROFILE; IFS=$old_ifs
[ "$#" -eq 6 ] || { echo "source database profile is incomplete" >&2; exit 1; }
SOURCE_SERVER_MAJOR=$1; SOURCE_ENCODING=$2; SOURCE_COLLATE=$3; SOURCE_CTYPE=$4; SOURCE_LOCALE_PROVIDER=$5; SOURCE_COLLATION_VERSION=$6
[ "$SOURCE_LOCALE_PROVIDER" = libc ] || { echo "isolated fixture must use libc locale" >&2; exit 1; }

UPLOADS="$TASK_ROOT/uploads"; ATTACHMENTS="$TASK_ROOT/attachments"
mkdir -m 0700 "$UPLOADS" "$ATTACHMENTS"
printf 'synthetic upload\n' > "$UPLOADS/upload.txt"; : > "$UPLOADS/zero-byte.txt"; printf 'synthetic attachment\n' > "$ATTACHMENTS/attachment.txt"
BACKUP_ROOT="$TASK_ROOT/backup-root"; RECEIPT_ROOT="$TASK_ROOT/receipt-root"; OFFHOST_ROOT="$TASK_ROOT/offhost-root"; RESTORE_ROOT="$TASK_ROOT/restore-root"; CREDENTIAL_ROOT="$TASK_ROOT/credentials"; RECEIPT_GID=$(id -g)
OUTBOX_ROOT="$TASK_ROOT/transfer-outbox"; RECEIVER_ROOT="$TASK_ROOT/transfer-receiver"; SOURCE_KEY_ROOT="$TASK_ROOT/source-keys"; RECEIVER_KEY_ROOT="$TASK_ROOT/receiver-keys"; OPERATIONS_POLICY="$TASK_ROOT/offhost-policy.json"
marker_root "$BACKUP_ROOT" .chenyida-erp-backup-root-v2 chenyida-erp-backup-root/v2
marker_root "$RECEIPT_ROOT" .chenyida-erp-receipt-root-v2 chenyida-erp-receipt-root/v2 2750
chgrp "$RECEIPT_GID" "$RECEIPT_ROOT"
marker_root "$OFFHOST_ROOT" .chenyida-erp-offhost-root-v2 chenyida-erp-offhost-root/v2
marker_root "$RESTORE_ROOT" .chenyida-erp-restore-root-v2 chenyida-erp-restore-root/v2
marker_root "$CREDENTIAL_ROOT" .chenyida-erp-credential-root-v2 chenyida-erp-credential-root/v2
marker_root "$OUTBOX_ROOT" .chenyida-erp-transfer-outbox-v1 chenyida-erp-transfer-outbox/v1
marker_root "$RECEIVER_ROOT" .chenyida-erp-transfer-receiver-v1 chenyida-erp-transfer-receiver/v1
marker_root "$SOURCE_KEY_ROOT" .chenyida-erp-offhost-key-root-v1 chenyida-erp-offhost-key-root/v1
marker_root "$RECEIVER_KEY_ROOT" .chenyida-erp-offhost-key-root-v1 chenyida-erp-offhost-key-root/v1
CONTROL_SERVICE_FILE="$CREDENTIAL_ROOT/pg_control_service.conf"
CAPTURE_SERVICE_FILE="$CREDENTIAL_ROOT/pg_capture_service.conf"
printf '[backup_control]\nhost=%s\ndbname=source_test\nuser=postgres\n[guard_control]\nhost=%s\ndbname=guard_test\nuser=postgres\n[restore_admin]\nhost=%s\ndbname=postgres\nuser=postgres\n' "$SOURCE_SOCKET" "$SOURCE_SOCKET" "$TARGET_SOCKET" > "$CONTROL_SERVICE_FILE"
printf '[backup_capture]\nhost=%s\ndbname=source_test\nuser=chenyida_erp_backup\n[guard_capture]\nhost=%s\ndbname=guard_test\nuser=chenyida_erp_backup\n' "$SOURCE_SOCKET" "$SOURCE_SOCKET" > "$CAPTURE_SERVICE_FILE"
chmod 0600 "$CONTROL_SERVICE_FILE" "$CAPTURE_SERVICE_FILE"
SOURCE_MACHINE_ID="$TASK_ROOT/source-machine-id"; RECEIVER_MACHINE_ID="$TASK_ROOT/receiver-machine-id"
printf '11111111111111111111111111111111\n' > "$SOURCE_MACHINE_ID"
printf '22222222222222222222222222222222\n' > "$RECEIVER_MACHINE_ID"
chmod 0400 "$SOURCE_MACHINE_ID" "$RECEIVER_MACHINE_ID"

SOURCE_KEY_ROOT="$SOURCE_KEY_ROOT" RECEIVER_KEY_ROOT="$RECEIVER_KEY_ROOT" OPERATIONS_POLICY="$OPERATIONS_POLICY" node <<'NODE'
const { createHash, generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const source = generateKeyPairSync("ed25519");
const encryption = generateKeyPairSync("x25519");
const receipt = generateKeyPairSync("ed25519");
const privatePem = (key) => key.export({ format: "pem", type: "pkcs8" });
const publicPem = (key) => key.export({ format: "pem", type: "spki" });
const fingerprint = (key) => createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
const writeKey = (root, name, value) => writeFileSync(join(root, name), value, { flag: "wx", mode: 0o400 });
writeKey(process.env.SOURCE_KEY_ROOT, "source-signing-private.pem", privatePem(source.privateKey));
writeKey(process.env.SOURCE_KEY_ROOT, "receiver-encryption-public.pem", publicPem(encryption.publicKey));
writeKey(process.env.SOURCE_KEY_ROOT, "receiver-receipt-public.pem", publicPem(receipt.publicKey));
writeKey(process.env.RECEIVER_KEY_ROOT, "receiver-encryption-private.pem", privatePem(encryption.privateKey));
writeKey(process.env.RECEIVER_KEY_ROOT, "trusted-source-signing-public.pem", publicPem(source.publicKey));
writeKey(process.env.RECEIVER_KEY_ROOT, "receiver-receipt-private.pem", privatePem(receipt.privateKey));
writeKey(process.env.RECEIVER_KEY_ROOT, "receiver-receipt-public.pem", publicPem(receipt.publicKey));
const key = (value) => ({ fingerprint: value, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: "2027-01-01T00:00:00.000Z" });
const policy = {
  schema_version: 1,
  contract: "chenyida-erp-backup-operations-policy/v1",
  policy_id: "synthetic-offhost-daily-v1",
  scope: "SYNTHETIC_TEST_ONLY",
  source_location_id: "source-host",
  receiver_location_id: "offhost-a",
  inner_policy_id: "daily-rpo-v1",
  schedule_anchor_at: "2026-01-01T00:00:00.000Z",
  cadence_minutes: 1440,
  rpo_minutes: 1440,
  grace_minutes: 60,
  max_run_minutes: 180,
  max_clock_skew_seconds: 60,
  retention_days: 30,
  min_verified_generations: 2,
  min_restore_verified_generations: 1,
  key_allowlist: {
    source_signing: [key(fingerprint(source.publicKey))],
    receiver_encryption: [key(fingerprint(encryption.publicKey))],
    receiver_receipt: [key(fingerprint(receipt.publicKey))],
  },
};
writeFileSync(process.env.OPERATIONS_POLICY, `${JSON.stringify(policy)}\n`, { flag: "wx", mode: 0o400 });
NODE
SOURCE_SIGNING_PRIVATE_KEY="$SOURCE_KEY_ROOT/source-signing-private.pem"
SOURCE_RECEIVER_ENCRYPTION_PUBLIC_KEY="$SOURCE_KEY_ROOT/receiver-encryption-public.pem"
SOURCE_RECEIVER_RECEIPT_PUBLIC_KEY="$SOURCE_KEY_ROOT/receiver-receipt-public.pem"
RECEIVER_ENCRYPTION_PRIVATE_KEY="$RECEIVER_KEY_ROOT/receiver-encryption-private.pem"
TRUSTED_SOURCE_SIGNING_PUBLIC_KEY="$RECEIVER_KEY_ROOT/trusted-source-signing-public.pem"
RECEIVER_RECEIPT_PRIVATE_KEY="$RECEIVER_KEY_ROOT/receiver-receipt-private.pem"
RECEIVER_RECEIPT_PUBLIC_KEY="$RECEIVER_KEY_ROOT/receiver-receipt-public.pem"

FAKE_BIN="$TASK_ROOT/fake-bin"; mkdir -m 0700 "$FAKE_BIN"
cat > "$FAKE_BIN/docker" <<'SH'
#!/bin/sh
last=""; for last do :; done
web_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
worker_id=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
web_image=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
worker_image=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
revision=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
writer_class=${FAKE_WRITER_CLASS:-test}
writer_project=${FAKE_WRITER_DEPLOYMENT_ID:-erp-test-source}
case "${1:-}" in
  ps) case "$*" in *com.docker.compose.service=web*) printf '%s\n' "$web_id" ;; *com.docker.compose.service=worker*) printf '%s\n' "$worker_id" ;; *) exit 0 ;; esac ;;
  inspect) case "$*" in *'range .Config.Env'*) printf 'ERP_DEPLOYMENT_CLASS=%s\n' "$writer_class" ;; *) if [ "$last" = web-test ]; then printf '%s\n' "$web_id|false|false|0|2026-08-12T00:00:00Z|2026-08-12T00:01:00Z|$web_image|$writer_project|web|0.1.0-alpha.47|$revision"; else printf '%s\n' "$worker_id|false|false|0|2026-08-12T00:00:00Z|2026-08-12T00:01:00Z|$worker_image|$writer_project|worker|0.1.0-alpha.47|$revision"; fi ;; esac ;;
  *) exit 1 ;;
esac
SH
chmod 0700 "$FAKE_BIN/docker"
PATH="$FAKE_BIN:$PATH"; export PATH

# A SIGKILL after the durable database fence must be recoverable through an
# exact-identity protocol before another backup is allowed to start.
NODE_ENV=test FAKE_WRITER_CLASS=test FAKE_WRITER_DEPLOYMENT_ID=guard-source SELFHOST_BACKUP_TEST_HOLD_AFTER_GUARD=3 "$SITE_ROOT/scripts/backup-selfhost.sh" --credential-root "$CREDENTIAL_ROOT" --control-db-service-file "$CONTROL_SERVICE_FILE" --control-db-service guard_control --capture-db-service-file "$CAPTURE_SERVICE_FILE" --capture-db-service guard_capture --deployment-class TEST --deployment-id guard-source --expected-database guard_test \
  --uploads "$UPLOADS" --attachments "$ATTACHMENTS" --backup-status "$RECEIPT_ROOT" --migrations "$MIGRATIONS" --backup-root "$BACKUP_ROOT" --receipt-root "$RECEIPT_ROOT" --receipt-reader-gid "$RECEIPT_GID" --web-container web-test --worker-container worker-test \
  --location-id source-host --policy-id daily-rpo-v1 --rpo-hours 24 --machine-identity-file "$SOURCE_MACHINE_ID" --confirm TEST_BACKUP_V2 >"$TASK_ROOT/guard-kill.log" 2>&1 &
GUARD_PID=$!
attempt=0
while :; do
  guard_read_only=$(psql -d postgres -Atc "select count(*) from pg_db_role_setting s cross join lateral unnest(s.setconfig) as cfg(setting) where s.setdatabase=(select oid from pg_database where datname='guard_test') and s.setrole=0 and setting='default_transaction_read_only=on'" 2>/dev/null || true)
  guard_connect_count=$(psql -d postgres -Atc "select count(*) from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,'guard_test','CONNECT')" 2>/dev/null || true)
  [ -f "$BACKUP_ROOT/.backup-fence-v2.json" ] && [ "$guard_read_only" = 1 ] && [ "$guard_connect_count" = 0 ] && break
  if ! kill -0 "$GUARD_PID" 2>/dev/null; then
    if wait "$GUARD_PID"; then guard_status=0; else guard_status=$?; fi
    GUARD_PID=""
    echo "backup guard process exited before durable publication (status=$guard_status)" >&2
    exit 1
  fi
  attempt=$((attempt + 1)); [ "$attempt" -le 300 ] || { echo "backup guard intent was not published" >&2; exit 1; }
  sleep 0.1
done
[ "$(psql -d postgres -Atc "select count(*) from pg_db_role_setting s cross join lateral unnest(s.setconfig) as cfg(setting) where s.setdatabase=(select oid from pg_database where datname='guard_test') and s.setrole=0 and setting='default_transaction_read_only=on'")" = 1 ]
[ "$(psql -d postgres -Atc "select datconnlimit from pg_database where datname='guard_test'")" = -1 ]
[ "$(psql -U chenyida_erp_backup -d guard_test -Atc 'select 1')" = 1 ]
if psql -U chenyida_erp_owner -d guard_test -Atc 'select 1' >/dev/null 2>&1; then echo "fenced migration owner unexpectedly connected" >&2; exit 1; fi
kill -9 "$GUARD_PID"; wait "$GUARD_PID" 2>/dev/null || true; GUARD_PID=""
attempt=0
while ! flock -n "$BACKUP_ROOT/.backup-v2.lock" -c true; do
  attempt=$((attempt + 1)); [ "$attempt" -le 50 ] || { echo "backup lock remained held after guard crash" >&2; exit 1; }
  sleep 0.1
done
recover_guard() {
  "$SITE_ROOT/scripts/recover-backup-guard.sh" --credential-root "$CREDENTIAL_ROOT" --control-db-service-file "$CONTROL_SERVICE_FILE" --control-db-service guard_control --backup-root "$BACKUP_ROOT" --deployment-class TEST --deployment-id guard-source --expected-database guard_test --expected-database-system-identifier "$SOURCE_SYSTEM_ID" --expected-database-oid "$GUARD_DATABASE_OID" --expected-database-marker TEST.guard-source --confirm RECOVER_EXACT_STALE_BACKUP_GUARD
}
psql -d postgres -v ON_ERROR_STOP=1 -c "create role backup_guard_unexpected nologin; grant connect on database guard_test to backup_guard_unexpected" >/dev/null
if recover_guard >"$TASK_ROOT/guard-acl-drift.log" 2>&1; then echo "guard recovery accepted an unexpected CONNECT grantee" >&2; exit 1; fi
[ -f "$BACKUP_ROOT/.backup-fence-v2.json" ]
[ "$(psql -d postgres -Atc "select count(*) from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,'guard_test','CONNECT')")" = 0 ]
psql -d postgres -v ON_ERROR_STOP=1 -c "revoke connect on database guard_test from backup_guard_unexpected; drop role backup_guard_unexpected" >/dev/null
recover_guard >/dev/null
[ "$(psql -d guard_test -Atc 'show default_transaction_read_only')" = off ]
[ "$(psql -d postgres -Atc "select datconnlimit from pg_database where datname='guard_test'")" = -1 ]
[ "$(psql -d postgres -Atc "select count(*) from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,'guard_test','CONNECT')")" = 4 ]
[ ! -e "$BACKUP_ROOT/.backup-fence-v2.json" ]

if psql -U chenyida_erp_backup -d source_test -v ON_ERROR_STOP=1 -c 'select count(*) from pg_largeobject' >/dev/null 2>&1; then echo "backup capture unexpectedly read large-object pages" >&2; exit 1; fi
if psql -U chenyida_erp_backup -d source_test -v ON_ERROR_STOP=1 -c 'update restored_probe set payload=payload' >/dev/null 2>&1; then echo "backup capture unexpectedly changed an application row" >&2; exit 1; fi
if psql -U chenyida_erp_backup -d source_test -v ON_ERROR_STOP=1 -c 'create temporary table capture_temp_forbidden(id integer)' >/dev/null 2>&1; then echo "backup capture unexpectedly created a temporary table" >&2; exit 1; fi

UNEXPECTED_LARGE_OBJECT=$(psql -U chenyida_erp_owner -d source_test -Atc 'select lo_from_bytea(0,int4send(1))')
if NODE_ENV=test "$SITE_ROOT/scripts/backup-selfhost.sh" --credential-root "$CREDENTIAL_ROOT" --control-db-service-file "$CONTROL_SERVICE_FILE" --control-db-service backup_control --capture-db-service-file "$CAPTURE_SERVICE_FILE" --capture-db-service backup_capture --deployment-class TEST --deployment-id erp-test-source --expected-database source_test \
  --uploads "$UPLOADS" --attachments "$ATTACHMENTS" --backup-status "$RECEIPT_ROOT" --migrations "$MIGRATIONS" --backup-root "$BACKUP_ROOT" --receipt-root "$RECEIPT_ROOT" --receipt-reader-gid "$RECEIPT_GID" --web-container web-test --worker-container worker-test \
  --location-id source-host --policy-id daily-rpo-v1 --rpo-hours 24 --machine-identity-file "$SOURCE_MACHINE_ID" --confirm TEST_BACKUP_V2 >"$TASK_ROOT/large-object-rejection.log" 2>&1; then echo "unexpected large object backup was not rejected" >&2; exit 1; fi
grep -q 'unexpected large objects block the zero-large-object backup contract' "$TASK_ROOT/large-object-rejection.log"
[ ! -e "$BACKUP_ROOT/.backup-fence-v2.json" ]
[ -z "$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' -print -quit)" ]
[ "$(psql -d source_test -Atc 'show default_transaction_read_only')" = off ]
[ "$(psql -d postgres -Atc "select count(*) from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,'source_test','CONNECT')")" = 4 ]
[ "$(psql -U chenyida_erp_owner -d source_test -Atc "select lo_unlink($UNEXPECTED_LARGE_OBJECT)")" = 1 ]

NODE_ENV=test "$SITE_ROOT/scripts/backup-selfhost.sh" --credential-root "$CREDENTIAL_ROOT" --control-db-service-file "$CONTROL_SERVICE_FILE" --control-db-service backup_control --capture-db-service-file "$CAPTURE_SERVICE_FILE" --capture-db-service backup_capture --deployment-class TEST --deployment-id erp-test-source --expected-database source_test \
  --uploads "$UPLOADS" --attachments "$ATTACHMENTS" --backup-status "$RECEIPT_ROOT" --migrations "$MIGRATIONS" --backup-root "$BACKUP_ROOT" --receipt-root "$RECEIPT_ROOT" --receipt-reader-gid "$RECEIPT_GID" --web-container web-test --worker-container worker-test \
  --location-id source-host --policy-id daily-rpo-v1 --rpo-hours 24 --machine-identity-file "$SOURCE_MACHINE_ID" --confirm TEST_BACKUP_V2 >/dev/null
[ "$(psql -d source_test -Atc 'show default_transaction_read_only')" = off ]
[ "$(psql -d source_test -Atc "select count(*) from pg_db_role_setting s join pg_database d on d.oid=s.setdatabase where d.datname=current_database() and exists(select 1 from unnest(s.setconfig) v where v like 'default_transaction_read_only=%')")" = 0 ]
[ "$(psql -d postgres -Atc "select datconnlimit from pg_database where datname='source_test'")" = -1 ]
[ "$(psql -d postgres -Atc "select count(*) from pg_roles r where r.rolname in ('chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker','chenyida_erp_admin') and has_database_privilege(r.oid,'source_test','CONNECT')")" = 4 ]
[ ! -e "$BACKUP_ROOT/.backup-fence-v2.json" ]
BACKUP_ID=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' -printf '%f\n')
[ -n "$BACKUP_ID" ] && [ "$(printf '%s\n' "$BACKUP_ID" | wc -l)" = 1 ]
node -e 'const fs=require("fs"),m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.consistency.method!=="QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION"||m.consistency.dump_scope!=="COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL"||!Number.isSafeInteger(m.deployment.database_bytes)||m.deployment.database_bytes<1||m.deployment.database_system_identifier!==process.argv[2]||m.deployment.database_locale_provider!=="libc"||m.application.web_image_digest===m.application.worker_image_digest||m.reconciliation.contract!=="chenyida-erp-backup-reconciliation/v1")process.exit(1)' "$BACKUP_ROOT/$BACKUP_ID/manifest.json" "$SOURCE_SYSTEM_ID"
SOURCE_DATABASE_BYTES=$(node -e 'const fs=require("fs"),m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(m.deployment.database_bytes))' "$BACKUP_ROOT/$BACKUP_ID/manifest.json")

TRANSFER_ID=transfer-postgres-1
SEALED_AT=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
node "$SITE_ROOT/scripts/offhost-transfer-contract.mjs" seal \
  --backup "$BACKUP_ROOT/$BACKUP_ID" --local-receipt "$RECEIPT_ROOT/$BACKUP_ID.local.json" --outbox-root "$OUTBOX_ROOT" --source-key-root "$SOURCE_KEY_ROOT" \
  --source-signing-private-key "$SOURCE_SIGNING_PRIVATE_KEY" --receiver-encryption-public-key "$SOURCE_RECEIVER_ENCRYPTION_PUBLIC_KEY" --receiver-receipt-public-key "$SOURCE_RECEIVER_RECEIPT_PUBLIC_KEY" \
  --receiver-location-id offhost-a --created-at "$SEALED_AT" --transfer-id "$TRANSFER_ID" --policy "$OPERATIONS_POLICY" >/dev/null
node "$SITE_ROOT/scripts/offhost-transfer-contract.mjs" receive \
  --incoming-package "$OUTBOX_ROOT/$TRANSFER_ID" --receiver-root "$RECEIVER_ROOT" --receiver-key-root "$RECEIVER_KEY_ROOT" --receiver-encryption-private-key "$RECEIVER_ENCRYPTION_PRIVATE_KEY" \
  --trusted-source-signing-public-key "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY" --receiver-receipt-private-key "$RECEIVER_RECEIPT_PRIVATE_KEY" --migrations "$MIGRATIONS" \
  --receiver-location-id offhost-a --retention-policy-id synthetic-retention-v1 --machine-identity-file "$RECEIVER_MACHINE_ID" --policy "$OPERATIONS_POLICY" >/dev/null
ACCEPTED_AT=$(node -e 'const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.received_at)' "$RECEIVER_ROOT/$TRANSFER_ID/receiver-receipt.json")
node "$SITE_ROOT/scripts/offhost-transfer-contract.mjs" accept-receipt \
  --source-package "$OUTBOX_ROOT/$TRANSFER_ID" --receiver-receipt "$RECEIVER_ROOT/$TRANSFER_ID/receiver-receipt.json" --source-key-root "$SOURCE_KEY_ROOT" \
  --source-signing-private-key "$SOURCE_SIGNING_PRIVATE_KEY" --receiver-receipt-public-key "$SOURCE_RECEIVER_RECEIPT_PUBLIC_KEY" --accepted-at "$ACCEPTED_AT" --policy "$OPERATIONS_POLICY" >/dev/null
SOURCE_ACCEPTANCE="$OUTBOX_ROOT/$TRANSFER_ID.accepted.json"
OFFHOST_RECEIVER_HASH=$(node -e 'const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.evidence.receiver_identity_sha256)' "$RECEIVER_ROOT/$TRANSFER_ID/offhost-receipt.json")

stop_cluster "$SOURCE_PGDATA"; SOURCE_RUNNING=0
unset PGHOST
initialize_cluster "$TARGET_PGDATA" "$TARGET_SOCKET"
start_cluster "$TARGET_PGDATA" "$TARGET_SOCKET" "$TARGET_LOG"
TARGET_RUNNING=1
export PGHOST="$TARGET_SOCKET"
TARGET_SYSTEM_ID=$(psql -d postgres -Atc 'select system_identifier from pg_control_system()')
[ "$TARGET_SYSTEM_ID" != "$SOURCE_SYSTEM_ID" ] || { echo "source and target PostgreSQL clusters are not distinct" >&2; exit 1; }
psql -d postgres -v ON_ERROR_STOP=1 -c "comment on database postgres is 'chenyida-erp-restore-cluster/v2:TEST:isolated-test:target-cluster'" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "alter role postgres set timezone='Asia/Shanghai'; alter role postgres set intervalstyle='postgres';" >/dev/null

restore_once() {
  target_database=$1; run_id=$2
  "$SITE_ROOT/scripts/restore-selfhost.sh" --credential-root "$CREDENTIAL_ROOT" --db-service-file "$CONTROL_SERVICE_FILE" --db-admin-service restore_admin --source-deployment-class TEST --source-deployment-id erp-test-source --source-database-name source_test \
    --source-database-system-identifier "$SOURCE_SYSTEM_ID" --source-database-oid "$SOURCE_DATABASE_OID" --source-database-marker TEST.erp-test-source --source-database-bytes "$SOURCE_DATABASE_BYTES" --source-database-server-major "$SOURCE_SERVER_MAJOR" --source-database-encoding "$SOURCE_ENCODING" --source-database-collate "$SOURCE_COLLATE" --source-database-ctype "$SOURCE_CTYPE" --source-database-locale-provider "$SOURCE_LOCALE_PROVIDER" --source-database-collation-version "$SOURCE_COLLATION_VERSION" \
    --offhost-root "$OFFHOST_ROOT" --receiver-package "$RECEIVER_ROOT/$TRANSFER_ID" --source-acceptance "$SOURCE_ACCEPTANCE" --receiver-key-root "$RECEIVER_KEY_ROOT" --receiver-encryption-private-key "$RECEIVER_ENCRYPTION_PRIVATE_KEY" --trusted-source-signing-public-key "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY" --receiver-receipt-public-key "$RECEIVER_RECEIPT_PUBLIC_KEY" --operations-policy "$OPERATIONS_POLICY" --transfer-id "$TRANSFER_ID" \
    --backup-id "$BACKUP_ID" --migrations "$MIGRATIONS" --receipt-root "$RECEIPT_ROOT" --restore-root "$RESTORE_ROOT" --target-database-capacity-path "$TARGET_PGDATA" --receipt-reader-gid "$RECEIPT_GID" \
    --target-deployment-class TEST --target-deployment-id isolated-test --target-admin-database postgres --target-database-name "$target_database" --target-marker-id target-marker --target-cluster-marker-id target-cluster --expected-target-system-identifier "$TARGET_SYSTEM_ID" --restore-run-id "$run_id" --location-id restore-host \
    --expected-app-version 0.1.0-alpha.47 --expected-git-commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --expected-web-image-digest sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc --expected-worker-image-digest sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
    --expected-migration-head 0001_test.sql --expected-policy-id daily-rpo-v1 --expected-rpo-hours 24 --confirm RESTORE_SIGNED_ENCRYPTED_OFFHOST_TO_MARKED_DISPOSABLE_TEST_TARGET
}
assert_transient_materialization_removed() {
  [ ! -e "$OFFHOST_ROOT/$BACKUP_ID" ] && [ ! -e "$OFFHOST_ROOT/$BACKUP_ID.$TRANSFER_ID.materialization.json" ] || { echo "transient plaintext materialization was not removed" >&2; exit 1; }
}

MARKER_GAP_DATABASE=cyd_marker_gap_restore_test
if ERP_RESTORE_TEST_FAIL_AT=AFTER_DATABASE_CREATE restore_once "$MARKER_GAP_DATABASE" marker-gap >"$TASK_ROOT/marker-gap.log" 2>&1; then echo "marker-gap failure injection unexpectedly succeeded" >&2; exit 1; fi
[ ! -e "$RESTORE_ROOT/marker-gap_restore_test" ]
[ "$(receipt_result "$RECEIPT_ROOT/latest.json")" = LOCAL_VERIFIED ]
[ ! -e "$OFFHOST_ROOT/$BACKUP_ID" ]
[ "$(psql -d postgres -Atc "select count(*) from pg_database where datname='$MARKER_GAP_DATABASE'")" = 0 ]

AMBIGUOUS_CREATE_DATABASE=cyd_create_response_restore_test
if ERP_RESTORE_TEST_FAIL_AT=DURING_DATABASE_CREATE_RESPONSE restore_once "$AMBIGUOUS_CREATE_DATABASE" create-response >"$TASK_ROOT/create-response.log" 2>&1; then echo "ambiguous create response failure injection unexpectedly succeeded" >&2; exit 1; fi
[ ! -e "$RESTORE_ROOT/create-response_restore_test" ]
[ "$(receipt_result "$RECEIPT_ROOT/latest.json")" = LOCAL_VERIFIED ]
assert_transient_materialization_removed
[ "$(psql -d postgres -Atc "select count(*) from pg_database where datname='$AMBIGUOUS_CREATE_DATABASE'")" = 0 ]

for failure in DURING_DATABASE AFTER_DATABASE AFTER_FILE_PROMOTION FINAL_VERIFICATION; do
  run_id=$(printf '%s' "$failure" | tr '[:upper:]' '[:lower:]'); target_database="cyd_${run_id}_restore_test"; log="$TASK_ROOT/$run_id.log"
  if ERP_RESTORE_TEST_FAIL_AT="$failure" restore_once "$target_database" "$run_id" >"$log" 2>&1; then echo "failure injection unexpectedly succeeded: $failure" >&2; exit 1; fi
  [ "$(psql -d postgres -Atc "select count(*) from pg_database where datname='$target_database'")" = 0 ] || { echo "database was not deleted after $failure" >&2; exit 1; }
  [ ! -e "$RESTORE_ROOT/${run_id}_restore_test" ] || { echo "file target was not deleted after $failure" >&2; exit 1; }
  [ "$(receipt_result "$RECEIPT_ROOT/latest.json")" = LOCAL_VERIFIED ]
  assert_transient_materialization_removed
done
grep -Eq 'pg_restore: error|restore_fault_probe|check constraint' "$TASK_ROOT/during_database.log"

AMBIGUOUS_DATABASE=cyd_receipt_publication_restore_test
if ERP_RESTORE_TEST_FAIL_AT=RECEIPT_PUBLICATION restore_once "$AMBIGUOUS_DATABASE" receipt-publication >"$TASK_ROOT/receipt-publication.log" 2>&1; then echo "receipt publication failure injection unexpectedly succeeded" >&2; exit 1; fi
[ "$(psql -d postgres -Atc "select count(*) from pg_database where datname='$AMBIGUOUS_DATABASE'")" = 1 ]
[ -d "$RESTORE_ROOT/receipt-publication_restore_test" ]
[ -f "$RESTORE_ROOT/.prepared-$BACKUP_ID-receipt-publication.json" ]
[ ! -e "$RECEIPT_ROOT/$BACKUP_ID.receipt-publication.restore.json" ]
[ "$(receipt_result "$RECEIPT_ROOT/latest.json")" = LOCAL_VERIFIED ]
assert_transient_materialization_removed
"$SITE_ROOT/scripts/publish-restore-receipt-selfhost.sh" --restore-root "$RESTORE_ROOT" --receipt-root "$RECEIPT_ROOT" --receipt-reader-gid "$RECEIPT_GID" --backup-id "$BACKUP_ID" --restore-run-id receipt-publication --confirm PUBLISH_PREPARED_RESTORE_RECEIPT >/dev/null
[ -f "$RECEIPT_ROOT/$BACKUP_ID.receipt-publication.restore.json" ]
[ "$(receipt_result "$RECEIPT_ROOT/latest.json")" = RESTORE_VERIFIED ]
dropdb "$AMBIGUOUS_DATABASE"
rm -rf -- "$RESTORE_ROOT/receipt-publication_restore_test"

SUCCESS_DATABASE=cyd_success_restore_test
restore_once "$SUCCESS_DATABASE" success >/dev/null
[ "$(psql -d "$SUCCESS_DATABASE" -Atc 'select payload from restored_probe where id=1')" = synthetic-restore-proof ]
[ "$(psql -d "$SUCCESS_DATABASE" -Atc 'select payload from private_domain.private_probe where id=1')" = non-public-schema-proof ]
[ "$(psql -d "$SUCCESS_DATABASE" -Atc "select count(*) from pg_extension where extname in ('pgcrypto','btree_gist')")" = 2 ]
[ "$(psql -d "$SUCCESS_DATABASE" -Atc "select count(*) from pg_publication where pubname='restore_publication'")" = 1 ]
[ "$(psql -d "$SUCCESS_DATABASE" -Atc 'select count(*) from pg_largeobject_metadata')" = 0 ]
[ "$(psql -d "$SUCCESS_DATABASE" -Atc 'select last_value from restored_sequence')" = 42 ]
[ "$(psql -d "$SUCCESS_DATABASE" -Atc "select to_char(happened_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'|'||extract(epoch from duration)::text from canonical_session_probe where id=1")" = "2026-08-12 08:34:56.123456|273906.789000" ]
if psql -d "$SUCCESS_DATABASE" -v ON_ERROR_STOP=1 -c "insert into extension_probe values(2,'[2,3)')" >/dev/null 2>&1; then echo "GiST exclusion constraint was not restored" >&2; exit 1; fi
cmp "$UPLOADS/upload.txt" "$RESTORE_ROOT/success_restore_test/uploads/upload.txt"
cmp "$ATTACHMENTS/attachment.txt" "$RESTORE_ROOT/success_restore_test/attachments/attachment.txt"
[ -f "$RESTORE_ROOT/success_restore_test/uploads/zero-byte.txt" ]
[ "$(stat -c %a "$RESTORE_ROOT/success_restore_test/backup_status")" = 2750 ]
[ "$(stat -c %g "$RESTORE_ROOT/success_restore_test/backup_status")" = "$RECEIPT_GID" ]
[ "$(stat -c %a "$RESTORE_ROOT/success_restore_test/backup_status/.chenyida-erp-receipt-root-v2")" = 400 ]
node -e 'const fs=require("fs"),r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(r.result!=="RESTORE_VERIFIED"||r.deployment.class!=="TEST"||r.evidence.target.deployment_class!=="TEST"||r.evidence.target.database_system_identifier!==process.argv[2]||r.evidence.target.cluster_marker_id!=="target-cluster"||r.evidence.reconciliation.result!=="MATCHED"||r.evidence.offhost_receiver_identity_sha256!==process.argv[3])process.exit(1)' "$RECEIPT_ROOT/latest.json" "$TARGET_SYSTEM_ID" "$OFFHOST_RECEIVER_HASH"
assert_transient_materialization_removed
[ -f "$RECEIPT_ROOT/$BACKUP_ID.success.restore.json" ]
[ -f "$RECEIPT_ROOT/restore.json" ]
if restore_once "$SUCCESS_DATABASE" success >/dev/null 2>&1; then echo "restore replay unexpectedly succeeded" >&2; exit 1; fi
[ "$(psql -d "$SUCCESS_DATABASE" -Atc 'select count(*) from restored_probe')" = 1 ]
PREPARED_SUCCESS="$RESTORE_ROOT/.prepared-$BACKUP_ID-success.json"
[ -f "$PREPARED_SUCCESS" ] && [ ! -L "$PREPARED_SUCCESS" ] && [ "$(stat -c %a "$PREPARED_SUCCESS")" = 400 ]
# The immutable published restore receipt now owns the final evidence. Remove
# only this task-created private prepared copy so the active drift checker can
# prove both its rejection and corrected re-preparation paths.
rm -- "$PREPARED_SUCCESS"; sync -f "$RESTORE_ROOT"

node "$SITE_ROOT/scripts/offhost-transfer-contract.mjs" materialize-for-restore \
  --receiver-package "$RECEIVER_ROOT/$TRANSFER_ID" --acceptance "$SOURCE_ACCEPTANCE" --receiver-key-root "$RECEIVER_KEY_ROOT" --receiver-encryption-private-key "$RECEIVER_ENCRYPTION_PRIVATE_KEY" \
  --trusted-source-signing-public-key "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY" --receiver-receipt-public-key "$RECEIVER_RECEIPT_PUBLIC_KEY" --destination-root "$OFFHOST_ROOT" \
  --transfer-id "$TRANSFER_ID" --backup-id "$BACKUP_ID" --policy "$OPERATIONS_POLICY" >/dev/null

prepare_success() {
  NODE_OPTIONS=--max-old-space-size=384 node "$SITE_ROOT/scripts/backup-recovery-contract.mjs" prepare-restore --backup "$OFFHOST_ROOT/$BACKUP_ID" --migrations "$MIGRATIONS" --offhost-receipt "$RECEIVER_ROOT/$TRANSFER_ID/offhost-receipt.json" --prepared-receipt "$RESTORE_ROOT/.prepared-$BACKUP_ID-success.json" --location-id restore-host --restore-run-id success --target-deployment-id isolated-test --target-admin-database postgres --target-database-name "$SUCCESS_DATABASE" --target-marker-id target-marker --target-cluster-marker-id target-cluster --expected-target-system-identifier "$TARGET_SYSTEM_ID" --file-root "$RESTORE_ROOT/success_restore_test" --credential-root "$CREDENTIAL_ROOT" --db-service-file "$CONTROL_SERVICE_FILE" --db-service restore_admin \
    --expected-deployment-class TEST --expected-deployment-id erp-test-source --expected-database-name source_test --expected-database-system-identifier "$SOURCE_SYSTEM_ID" --expected-database-oid "$SOURCE_DATABASE_OID" --expected-database-marker TEST.erp-test-source --expected-database-bytes "$SOURCE_DATABASE_BYTES" --expected-database-server-major "$SOURCE_SERVER_MAJOR" --expected-database-encoding "$SOURCE_ENCODING" --expected-database-collate "$SOURCE_COLLATE" --expected-database-ctype "$SOURCE_CTYPE" --expected-database-locale-provider "$SOURCE_LOCALE_PROVIDER" --expected-database-collation-version "$SOURCE_COLLATION_VERSION" \
    --expected-app-version 0.1.0-alpha.47 --expected-git-commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --expected-web-image-digest sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc --expected-worker-image-digest sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --expected-migration-head 0001_test.sql --expected-policy-id daily-rpo-v1 --expected-rpo-hours 24
}
psql -d "$SUCCESS_DATABASE" -v ON_ERROR_STOP=1 -c "update restored_probe set payload='synthetic-restore-proog' where id=1" >/dev/null
if prepare_success >"$TASK_ROOT/content-drift.log" 2>&1; then echo "same-count content drift was not detected" >&2; exit 1; fi
grep -q RESTORE_DATABASE_RECONCILIATION_MISMATCH "$TASK_ROOT/content-drift.log"
psql -d "$SUCCESS_DATABASE" -v ON_ERROR_STOP=1 -c "update restored_probe set payload='synthetic-restore-proof' where id=1" >/dev/null
prepare_success >/dev/null
node "$SITE_ROOT/scripts/offhost-transfer-contract.mjs" cleanup-materialized-for-restore \
  --receiver-package "$RECEIVER_ROOT/$TRANSFER_ID" --acceptance "$SOURCE_ACCEPTANCE" --receiver-key-root "$RECEIVER_KEY_ROOT" --receiver-encryption-private-key "$RECEIVER_ENCRYPTION_PRIVATE_KEY" \
  --trusted-source-signing-public-key "$TRUSTED_SOURCE_SIGNING_PUBLIC_KEY" --receiver-receipt-public-key "$RECEIVER_RECEIPT_PUBLIC_KEY" --destination-root "$OFFHOST_ROOT" \
  --transfer-id "$TRANSFER_ID" --backup-id "$BACKUP_ID" --policy "$OPERATIONS_POLICY" --confirm REMOVE_EXACT_VERIFIED_MATERIALIZATION >/dev/null
assert_transient_materialization_removed

dropdb "$SUCCESS_DATABASE"
rm -rf -- "$RESTORE_ROOT/success_restore_test"

DASHBOARD_DATABASE=cyd_backup_dashboard_test_release_test
DASHBOARD_RUN_ID=backup-dashboard-${TASK_ROOT##*.}
createdb "$DASHBOARD_DATABASE"
psql -d postgres -v ON_ERROR_STOP=1 -c "comment on database $DASHBOARD_DATABASE is 'chenyida-erp-isolated-migration-test/v1:$DASHBOARD_RUN_ID'" >/dev/null
DASHBOARD_DATABASE_OID=$(psql -d "$DASHBOARD_DATABASE" -Atc "select oid from pg_database where datname=current_database()")
DATABASE_URL="postgresql://postgres@/$DASHBOARD_DATABASE?host=$TARGET_SOCKET" ERP_ENV=test ERP_DEPLOYMENT_CLASS=test ERP_SETUP_TOKEN=fixture-only-setup-token-123456 ERP_ALLOW_ISOLATED_MIGRATION=YES ERP_RELEASE_TEST_MODE=YES ERP_MIGRATION_TEST_HARNESS=BACKUP_RECOVERY ERP_MIGRATION_CONFIRM=MIGRATE_EXACT_ISOLATED_TEST_DATABASE ERP_MIGRATION_TEST_RUN_ID="$DASHBOARD_RUN_ID" ERP_MIGRATION_EXPECTED_DATABASE="$DASHBOARD_DATABASE" ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER="$TARGET_SYSTEM_ID" ERP_MIGRATION_EXPECTED_DATABASE_OID="$DASHBOARD_DATABASE_OID" ERP_MIGRATION_EXPECTED_DATABASE_MARKER="chenyida-erp-isolated-migration-test/v1:$DASHBOARD_RUN_ID" NODE_OPTIONS=--max-old-space-size=384 node --experimental-strip-types "$SITE_ROOT/scripts/migrate-postgres.ts" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "comment on database $DASHBOARD_DATABASE is 'chenyida-erp-deployment/v2:TEST:dashboard-test'" >/dev/null
TEST_DASHBOARD_DATABASE_URL="postgresql://postgres@/$DASHBOARD_DATABASE?host=$TARGET_SOCKET" ERP_ENV=test ERP_DEPLOYMENT_CLASS=test ERP_RELEASE_EXPECTED_DEPLOYMENT_ID=dashboard-test ERP_RELEASE_EXPECTED_VERSION=0.1.0-alpha.47 ERP_RELEASE_EXPECTED_GIT_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ERP_RELEASE_EXPECTED_MANIFEST_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee ERP_RELEASE_IDENTITY_MAX_AGE_SECONDS=3600 \
  ERP_RUNTIME_BUILD_VERSION=0.1.0-alpha.47 ERP_RUNTIME_GIT_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  ERP_BACKUP_POLICY_ID=daily-rpo-v1 ERP_BACKUP_RPO_HOURS=24 ERP_BACKUP_OPERATIONS_POLICY_ID=offhost-test-v1 ERP_BACKUP_OPERATIONS_POLICY_SHA256=7777777777777777777777777777777777777777777777777777777777777777 ERP_BACKUP_OPERATIONS_POLICY_SCOPE=TEST ERP_BACKUP_EXPECTED_OFFHOST_LOCATION_ID=dashboard-offhost ERP_BACKUP_EXPECTED_OFFHOST_RECEIVER_IDENTITY_SHA256=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  ERP_BACKUP_EXPECTED_RESTORE_LOCATION_ID=dashboard-restore-location ERP_BACKUP_EXPECTED_RESTORE_TARGET_ID=dashboard-restore-target ERP_BACKUP_EXPECTED_RESTORE_TARGET_SYSTEM_IDENTIFIER="$SOURCE_SYSTEM_ID" ERP_BACKUP_EXPECTED_RESTORE_TARGET_CLUSTER_MARKER_ID=dashboard-cluster \
  ERP_BACKUP_EVIDENCE_TRUST_MODE=TRUSTED_ROOT_EXECUTOR NODE_OPTIONS=--max-old-space-size=384 node --experimental-strip-types --test --test-concurrency=1 "$SITE_ROOT/tests/selfhost-dashboard-postgres.test.mjs"
dropdb "$DASHBOARD_DATABASE"
printf 'distinct-cluster PostgreSQL backup/restore integration passed\n'
