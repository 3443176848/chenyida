#!/bin/sh
set -eu

usage() { echo "usage: $0 --database-url URL --uploads DIR --attachments DIR --migrations DIR --output DIR --app-version VERSION --git-commit SHA --confirm-services-stopped YES --confirm NON_PRODUCTION_BACKUP" >&2; exit 2; }
DATABASE_URL_VALUE=""; UPLOADS=""; ATTACHMENTS=""; MIGRATIONS=""; OUTPUT=""; APP_VERSION=""; GIT_COMMIT=""; STOPPED=""; CONFIRM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database-url) DATABASE_URL_VALUE=${2:-}; shift 2;; --uploads) UPLOADS=${2:-}; shift 2;; --attachments) ATTACHMENTS=${2:-}; shift 2;;
    --migrations) MIGRATIONS=${2:-}; shift 2;; --output) OUTPUT=${2:-}; shift 2;; --app-version) APP_VERSION=${2:-}; shift 2;; --git-commit) GIT_COMMIT=${2:-}; shift 2;;
    --confirm-services-stopped) STOPPED=${2:-}; shift 2;; --confirm) CONFIRM=${2:-}; shift 2;; *) usage;;
  esac
done
[ "$STOPPED" = "YES" ] && [ "$CONFIRM" = "NON_PRODUCTION_BACKUP" ] || usage
[ -n "$DATABASE_URL_VALUE" ] && [ -d "$UPLOADS" ] && [ -d "$ATTACHMENTS" ] && [ -d "$MIGRATIONS" ] && [ -n "$OUTPUT" ] || usage
case "${ERP_ENV:-development}:$DATABASE_URL_VALUE" in production:*|*:postgres*://*prod*|*:postgresql*://*prod*) echo "production environment/database is forbidden" >&2; exit 1;; esac
case "$APP_VERSION" in 0.1.0-alpha.[0-9]|0.1.0-alpha.[0-9][0-9]) :;; *) echo "invalid application version" >&2; exit 1;; esac
case "$GIT_COMMIT" in *[!0-9a-f]*|'') echo "invalid git commit" >&2; exit 1;; esac
[ "${#GIT_COMMIT}" -eq 40 ] || { echo "invalid git commit" >&2; exit 1; }
[ ! -L "$UPLOADS" ] && [ ! -L "$ATTACHMENTS" ] || { echo "upload and attachment roots must not be symlinks" >&2; exit 1; }

UPLOADS=$(readlink -f "$UPLOADS"); ATTACHMENTS=$(readlink -f "$ATTACHMENTS"); MIGRATIONS=$(readlink -f "$MIGRATIONS")
[ -z "$(find "$UPLOADS" "$ATTACHMENTS" -type l -print -quit)" ] || { echo "upload and attachment sources must not contain symlinks" >&2; exit 1; }
OUTPUT_PARENT=$(dirname "$OUTPUT"); mkdir -p "$OUTPUT_PARENT"; OUTPUT_PARENT=$(readlink -f "$OUTPUT_PARENT"); OUTPUT="$OUTPUT_PARENT/$(basename "$OUTPUT")"
REPO_ROOT=$(readlink -f "$(dirname "$0")/.."); USER_HOME=$(readlink -f "${HOME:?HOME is required}")
for target in "$OUTPUT" "$OUTPUT_PARENT"; do case "$target" in /|"$USER_HOME"|"$REPO_ROOT"|"$UPLOADS"|"$ATTACHMENTS"|"$MIGRATIONS") echo "unsafe backup target: $target" >&2; exit 1;; esac; done
case "$OUTPUT/" in "$UPLOADS"/*|"$ATTACHMENTS"/*|"$MIGRATIONS"/*|"$REPO_ROOT"/*) echo "backup target must not be inside source or repository" >&2; exit 1;; esac
[ ! -e "$OUTPUT" ] || { echo "output already exists: $OUTPUT" >&2; exit 1; }

umask 077
WORK=$(mktemp -d "$OUTPUT_PARENT/.erp-backup.XXXXXX")
cleanup() { if [ -n "${WORK:-}" ] && [ -d "$WORK" ]; then rm -rf -- "$WORK"; fi; :; }
trap cleanup EXIT HUP INT TERM

pg_dump --dbname="$DATABASE_URL_VALUE" --format=custom --no-owner --no-acl --file="$WORK/postgresql.dump"
tar -C "$UPLOADS" -czf "$WORK/uploads.tar.gz" .
tar -C "$ATTACHMENTS" -czf "$WORK/attachments.tar.gz" .
for artifact in postgresql.dump uploads.tar.gz attachments.tar.gz; do [ -s "$WORK/$artifact" ] || { echo "zero-byte backup component: $artifact" >&2; exit 1; }; done

MIGRATION_LIST="$WORK/migrations.txt"; : > "$MIGRATION_LIST"
for migration in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do [ -f "$migration" ] || { echo "migration files missing" >&2; exit 1; }; printf '%s  %s\n' "$(sha256sum "$migration" | awk '{print $1}')" "$(basename "$migration")" >> "$MIGRATION_LIST"; done
MIGRATION_HEAD=$(tail -n 1 "$MIGRATION_LIST" | awk '{print $2}'); [ -n "$MIGRATION_HEAD" ] || { echo "migration head missing" >&2; exit 1; }
DB_ID=$(psql "$DATABASE_URL_VALUE" -v ON_ERROR_STOP=1 -Atc "select current_database()" | tr -cd 'A-Za-z0-9_.-'); [ -n "$DB_ID" ] || DB_ID="unknown"
DB_MIGRATIONS="$WORK/database-migrations.txt"; psql "$DATABASE_URL_VALUE" -v ON_ERROR_STOP=1 -Atc "select checksum||'  '||version from schema_migrations order by version" > "$DB_MIGRATIONS"
cmp -s "$MIGRATION_LIST" "$DB_MIGRATIONS" || { echo "database migration list does not match source migration files" >&2; exit 1; }

UPLOAD_COUNT=$(find "$UPLOADS" -type f -print | wc -l | tr -d ' '); ATTACHMENT_COUNT=$(find "$ATTACHMENTS" -type f -print | wc -l | tr -d ' ')
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ); BACKUP_ID="backup-$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%.12s' "$GIT_COMMIT")"
PG_SHA=$(sha256sum "$WORK/postgresql.dump"|awk '{print $1}'); UP_SHA=$(sha256sum "$WORK/uploads.tar.gz"|awk '{print $1}'); AT_SHA=$(sha256sum "$WORK/attachments.tar.gz"|awk '{print $1}')
PG_BYTES=$(wc -c < "$WORK/postgresql.dump"|tr -d ' '); UP_BYTES=$(wc -c < "$WORK/uploads.tar.gz"|tr -d ' '); AT_BYTES=$(wc -c < "$WORK/attachments.tar.gz"|tr -d ' ')
PG_TOOL=$(pg_dump --version | sed 's/"//g'); TAR_TOOL=$(tar --version | head -n1 | sed 's/"//g')
{
  printf '{\n  "schema_version": 1,\n  "status": "COMPLETE",\n  "backup_id": "%s",\n  "created_at": "%s",\n' "$BACKUP_ID" "$CREATED_AT"
  printf '  "application_version": "%s",\n  "git_commit": "%s",\n  "database_id": "%s",\n  "migration_head": "%s",\n' "$APP_VERSION" "$GIT_COMMIT" "$DB_ID" "$MIGRATION_HEAD"
  printf '  "consistency": "WEB_AND_WORKER_STOPPED",\n  "tools": {"pg_dump":"%s","tar":"%s"},\n' "$PG_TOOL" "$TAR_TOOL"
  printf '  "artifacts": {\n    "postgresql_dump": {"file":"postgresql.dump","sha256":"%s","bytes":%s},\n' "$PG_SHA" "$PG_BYTES"
  printf '    "uploads": {"file":"uploads.tar.gz","sha256":"%s","bytes":%s,"entries":%s},\n' "$UP_SHA" "$UP_BYTES" "$UPLOAD_COUNT"
  printf '    "attachments": {"file":"attachments.tar.gz","sha256":"%s","bytes":%s,"entries":%s}\n  },\n' "$AT_SHA" "$AT_BYTES" "$ATTACHMENT_COUNT"
  printf '  "migration_manifest": "migrations.txt"\n}\n'
} > "$WORK/manifest.json"
[ -s "$WORK/manifest.json" ] || exit 1
rm -f "$DB_MIGRATIONS"
mv "$WORK" "$OUTPUT"; WORK=""
echo "backup created (not yet restore-verified): $OUTPUT"
