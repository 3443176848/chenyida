#!/bin/sh
set -eu

usage() { echo "usage: $0 --database-url URL --uploads DIR --attachments DIR --output DIR" >&2; exit 2; }
DATABASE_URL_VALUE=""; UPLOADS=""; ATTACHMENTS=""; OUTPUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --database-url) DATABASE_URL_VALUE=${2:-}; shift 2 ;;
    --uploads) UPLOADS=${2:-}; shift 2 ;;
    --attachments) ATTACHMENTS=${2:-}; shift 2 ;;
    --output) OUTPUT=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$DATABASE_URL_VALUE" ] && [ -n "$UPLOADS" ] && [ -n "$ATTACHMENTS" ] && [ -n "$OUTPUT" ] || usage
[ ! -e "$OUTPUT" ] || { echo "output already exists: $OUTPUT" >&2; exit 1; }
umask 077
mkdir -p "$OUTPUT"
pg_dump --dbname="$DATABASE_URL_VALUE" --format=custom --no-owner --no-acl --file="$OUTPUT/postgresql.dump"
tar -C "$UPLOADS" -czf "$OUTPUT/uploads.tar.gz" .
tar -C "$ATTACHMENTS" -czf "$OUTPUT/attachments.tar.gz" .
sha256sum "$OUTPUT/postgresql.dump" "$OUTPUT/uploads.tar.gz" "$OUTPUT/attachments.tar.gz" > "$OUTPUT/SHA256SUMS"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUTPUT/created-at.txt"
echo "backup created at $OUTPUT"
