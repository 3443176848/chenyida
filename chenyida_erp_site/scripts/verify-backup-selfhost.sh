#!/bin/sh
set -eu
usage() { echo "usage: $0 --backup DIR --migrations DIR [--status-output FILE]" >&2; exit 2; }
BACKUP=""; MIGRATIONS=""; STATUS_OUTPUT=""
while [ "$#" -gt 0 ]; do case "$1" in --backup) BACKUP=${2:-};shift 2;; --migrations) MIGRATIONS=${2:-};shift 2;; --status-output) STATUS_OUTPUT=${2:-};shift 2;; *) usage;; esac; done
[ -d "$BACKUP" ] && [ -d "$MIGRATIONS" ] || usage
BACKUP=$(readlink -f "$BACKUP"); MIGRATIONS=$(readlink -f "$MIGRATIONS"); MANIFEST="$BACKUP/manifest.json"
[ -s "$MANIFEST" ] && [ ! -L "$MANIFEST" ] && [ -s "$BACKUP/migrations.txt" ] && [ ! -L "$BACKUP/migrations.txt" ] || { echo "manifest or migration manifest missing or unsafe" >&2; exit 1; }
grep -q '"schema_version": 1' "$MANIFEST" || { echo "unknown manifest schema" >&2; exit 1; }
grep -q '"status": "COMPLETE"' "$MANIFEST" || { echo "backup is not complete" >&2; exit 1; }
value() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$MANIFEST" | head -n1; }
artifact() { sed -n "/\"$1\"/s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" "$MANIFEST" | head -n1; }
artifact_number() { sed -n "/\"$1\"/s/.*\"$2\":\([0-9][0-9]*\).*/\1/p" "$MANIFEST" | head -n1; }
for key in postgresql_dump uploads attachments; do file=$(artifact "$key" file); sha=$(artifact "$key" sha256); bytes=$(artifact_number "$key" bytes); [ -n "$file" ] && [ -n "$sha" ] && [ -n "$bytes" ] && [ "$bytes" -gt 0 ] || { echo "invalid artifact metadata: $key" >&2; exit 1; }; [ -f "$BACKUP/$file" ] && [ ! -L "$BACKUP/$file" ] && [ "$(wc -c < "$BACKUP/$file"|tr -d ' ')" = "$bytes" ] && [ "$(sha256sum "$BACKUP/$file"|awk '{print $1}')" = "$sha" ] || { echo "artifact checksum/size mismatch: $key" >&2; exit 1; }; done
[ "$(artifact postgresql_dump file)" = "postgresql.dump" ] && [ "$(artifact uploads file)" = "uploads.tar.gz" ] && [ "$(artifact attachments file)" = "attachments.tar.gz" ] || { echo "unexpected artifact filename" >&2; exit 1; }
pg_restore --list "$BACKUP/postgresql.dump" >/dev/null
for archive in uploads.tar.gz attachments.tar.gz; do
  tar -tzf "$BACKUP/$archive" | awk 'BEGIN{bad=0} /^\//{bad=1} /(^|\/)\.\.($|\/)/{bad=1} END{exit bad}' || { echo "unsafe archive path: $archive" >&2; exit 1; }
  tar -tvzf "$BACKUP/$archive" | awk 'substr($1,1,1)=="l" || substr($1,1,1)=="h" {bad=1} END{exit bad}' || { echo "archive links are forbidden: $archive" >&2; exit 1; }
done
EXPECTED=$(mktemp); trap 'rm -f "$EXPECTED"' EXIT HUP INT TERM; : > "$EXPECTED"
for migration in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do [ -f "$migration" ] || exit 1; printf '%s  %s\n' "$(sha256sum "$migration"|awk '{print $1}')" "$(basename "$migration")" >> "$EXPECTED"; done
cmp -s "$EXPECTED" "$BACKUP/migrations.txt" || { echo "migration compatibility mismatch" >&2; exit 1; }
[ "$(value migration_head)" = "$(tail -n1 "$EXPECTED"|awk '{print $2}')" ] || { echo "migration head mismatch" >&2; exit 1; }
if [ -n "$STATUS_OUTPUT" ]; then
  STATUS_PARENT=$(dirname "$STATUS_OUTPUT"); mkdir -p "$STATUS_PARENT"; STATUS_PARENT=$(readlink -f "$STATUS_PARENT"); STATUS_OUTPUT="$STATUS_PARENT/$(basename "$STATUS_OUTPUT")"; TMP=$(mktemp "$STATUS_PARENT/.backup-status.XXXXXX")
  verified=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  { printf '{"schema_version":1,"result":"VERIFIED","backup_id":"%s","created_at":"%s","verified_at":"%s","application_version":"%s","git_commit":"%s","migration_head":"%s","artifacts":{' "$(value backup_id)" "$(value created_at)" "$verified" "$(value application_version)" "$(value git_commit)" "$(value migration_head)"; printf '"postgresql_dump":{"file":"postgresql.dump","sha256":"%s","bytes":%s},' "$(artifact postgresql_dump sha256)" "$(artifact_number postgresql_dump bytes)"; printf '"uploads":{"file":"uploads.tar.gz","sha256":"%s","bytes":%s,"entries":%s},' "$(artifact uploads sha256)" "$(artifact_number uploads bytes)" "$(artifact_number uploads entries)"; printf '"attachments":{"file":"attachments.tar.gz","sha256":"%s","bytes":%s,"entries":%s}}}\n' "$(artifact attachments sha256)" "$(artifact_number attachments bytes)" "$(artifact_number attachments entries)"; } > "$TMP"
  # This contains only the bounded, browser-safe verification projection. The
  # web container runs as an unprivileged user and mounts the status volume RO.
  chmod 644 "$TMP"; mv "$TMP" "$STATUS_OUTPUT"
fi
echo "backup verification passed: $(value backup_id)"
