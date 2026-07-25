#!/bin/sh
set -eu
usage() { echo "usage: $0 --database-url URL --backup DIR --migrations DIR --uploads DIR --attachments DIR --confirm RESTORE_TO_NEW_EMPTY_NON_PRODUCTION_TARGET" >&2; exit 2; }
DATABASE_URL_VALUE=""; BACKUP=""; MIGRATIONS=""; UPLOADS=""; ATTACHMENTS=""; CONFIRM=""
while [ "$#" -gt 0 ]; do case "$1" in --database-url) DATABASE_URL_VALUE=${2:-};shift 2;; --backup) BACKUP=${2:-};shift 2;; --migrations) MIGRATIONS=${2:-};shift 2;; --uploads) UPLOADS=${2:-};shift 2;; --attachments) ATTACHMENTS=${2:-};shift 2;; --confirm) CONFIRM=${2:-};shift 2;; *) usage;; esac; done
[ "$CONFIRM" = "RESTORE_TO_NEW_EMPTY_NON_PRODUCTION_TARGET" ] || usage
[ -n "$DATABASE_URL_VALUE" ] && [ -d "$BACKUP" ] && [ -d "$MIGRATIONS" ] && [ -n "$UPLOADS" ] && [ -n "$ATTACHMENTS" ] || usage
case "${ERP_ENV:-development}:$DATABASE_URL_VALUE" in production:*|*:postgres*://*prod*|*:postgresql*://*prod*) echo "production environment/database is forbidden" >&2; exit 1;; esac
"$(dirname "$0")/verify-backup-selfhost.sh" --backup "$BACKUP" --migrations "$MIGRATIONS"
TABLE_COUNT=$(psql "$DATABASE_URL_VALUE" -v ON_ERROR_STOP=1 -Atc "select count(*) from pg_tables where schemaname='public'")
[ "$TABLE_COUNT" = "0" ] || { echo "target database is not empty; restore refuses to overwrite it" >&2; exit 1; }
for target in "$UPLOADS" "$ATTACHMENTS"; do [ ! -L "$target" ] || { echo "file target must not be a symbolic link: $target" >&2; exit 1; }; [ ! -e "$target" ] || { [ -d "$target" ] && [ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]; } || { echo "file target is not empty: $target" >&2; exit 1; }; done
umask 077; UP_PARENT=$(dirname "$UPLOADS"); AT_PARENT=$(dirname "$ATTACHMENTS"); mkdir -p "$UP_PARENT" "$AT_PARENT"
UP_STAGE=$(mktemp -d "$UP_PARENT/.erp-uploads-restore.XXXXXX"); AT_STAGE=$(mktemp -d "$AT_PARENT/.erp-attachments-restore.XXXXXX")
cleanup() { if [ -n "${UP_STAGE:-}" ] && [ -d "$UP_STAGE" ]; then rm -rf -- "$UP_STAGE"; fi; if [ -n "${AT_STAGE:-}" ] && [ -d "$AT_STAGE" ]; then rm -rf -- "$AT_STAGE"; fi; :; }
trap cleanup EXIT HUP INT TERM
tar -C "$UP_STAGE" -xzf "$BACKUP/uploads.tar.gz"; tar -C "$AT_STAGE" -xzf "$BACKUP/attachments.tar.gz"
pg_restore --dbname="$DATABASE_URL_VALUE" --no-owner --no-acl --exit-on-error --single-transaction "$BACKUP/postgresql.dump"
[ ! -e "$UPLOADS" ] || rmdir "$UPLOADS"; [ ! -e "$ATTACHMENTS" ] || rmdir "$ATTACHMENTS"; mv "$UP_STAGE" "$UPLOADS"; UP_STAGE=""; mv "$AT_STAGE" "$ATTACHMENTS"; AT_STAGE=""
DB_MIGRATIONS=$(mktemp); trap 'rm -f "$DB_MIGRATIONS"' EXIT HUP INT TERM; psql "$DATABASE_URL_VALUE" -v ON_ERROR_STOP=1 -Atc "select checksum||'  '||version from schema_migrations order by version" > "$DB_MIGRATIONS"; cmp -s "$DB_MIGRATIONS" "$BACKUP/migrations.txt" || { echo "restored migration verification failed" >&2; exit 1; }
echo "restore completed to new empty non-production target; validate domain counts and health before opening traffic"
