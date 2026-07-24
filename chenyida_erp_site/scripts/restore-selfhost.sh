#!/bin/sh
set -eu

usage() { echo "usage: $0 --database-url URL --backup DIR --uploads DIR --attachments DIR --confirm RESTORE_TO_EMPTY_TARGET" >&2; exit 2; }
DATABASE_URL_VALUE=""; BACKUP=""; UPLOADS=""; ATTACHMENTS=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database-url) DATABASE_URL_VALUE=${2:-}; shift 2 ;;
    --backup) BACKUP=${2:-}; shift 2 ;;
    --uploads) UPLOADS=${2:-}; shift 2 ;;
    --attachments) ATTACHMENTS=${2:-}; shift 2 ;;
    --confirm) CONFIRM=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ "$CONFIRM" = "RESTORE_TO_EMPTY_TARGET" ] || usage
[ -n "$DATABASE_URL_VALUE" ] && [ -d "$BACKUP" ] && [ -n "$UPLOADS" ] && [ -n "$ATTACHMENTS" ] || usage
(cd "$BACKUP" && sha256sum -c SHA256SUMS)
TABLE_COUNT=$(psql "$DATABASE_URL_VALUE" -Atc "select count(*) from pg_tables where schemaname='public' and tablename not in ('schema_migrations')")
[ "$TABLE_COUNT" = "0" ] || { echo "target database is not empty; restore refuses to overwrite it" >&2; exit 1; }
[ ! -e "$UPLOADS" ] || [ -z "$(find "$UPLOADS" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo "uploads target is not empty" >&2; exit 1; }
[ ! -e "$ATTACHMENTS" ] || [ -z "$(find "$ATTACHMENTS" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo "attachments target is not empty" >&2; exit 1; }
mkdir -p "$UPLOADS" "$ATTACHMENTS"
pg_restore --dbname="$DATABASE_URL_VALUE" --no-owner --no-acl --exit-on-error "$BACKUP/postgresql.dump"
tar -C "$UPLOADS" -xzf "$BACKUP/uploads.tar.gz"
tar -C "$ATTACHMENTS" -xzf "$BACKUP/attachments.tar.gz"
echo "restore completed; run migration status and /api/health before opening traffic"
