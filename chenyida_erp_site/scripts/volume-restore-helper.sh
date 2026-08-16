#!/bin/sh
set -eu
set -f
(set -o pipefail) 2>/dev/null || exit 1
set -o pipefail
umask 077
LC_ALL=C
LANG=C
TZ=UTC
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/nonexistent
export LC_ALL LANG TZ PATH HOME

fail() {
  printf '%s\n' "${1:-VOLUME_HELPER_INTERNAL_ERROR}" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail VOLUME_HELPER_ROOT_REQUIRED
[ -d /target ] && [ ! -L /target ] || fail VOLUME_HELPER_TARGET_INVALID
awk '$5 == "/target" { found += 1 } END { exit found == 1 ? 0 : 1 }' /proc/self/mountinfo \
  || fail VOLUME_HELPER_TARGET_MOUNT_INVALID

operation=${1:-}
[ "$#" -ge 1 ] || fail VOLUME_HELPER_OPCODE_INVALID
shift

regular_tree() {
  unexpected=$(find /target -xdev ! -type d ! -type f -print -quit)
  [ -z "$unexpected" ] || fail VOLUME_HELPER_TREE_TYPE_INVALID
}

tree_limits() {
  files=$(find /target -xdev -type f -printf . | wc -c | tr -d ' ')
  bytes=$(find /target -xdev -type f -printf '%s\n' | awk '{ total += $1 } END { printf "%.0f", total + 0 }')
  case "$files:$bytes" in *[!0-9:]*) fail VOLUME_HELPER_TREE_LIMIT_INVALID ;; esac
  [ "$files" -le 250000 ] && [ "$bytes" -le 53687091200 ] \
    || fail VOLUME_HELPER_TREE_LIMIT_INVALID
}

reconcile_application_tree() {
  [ "$#" -eq 0 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
  regular_tree
  tree_limits
  # The helper intentionally has no DAC override while reconciling.  Keep
  # every parent traversable by uid 0 until all descendants have been fixed,
  # then transfer directories leaf-first so changing /target is the last
  # metadata mutation.
  find /target -xdev -type d -exec chmod 0750 -- {} +
  find /target -xdev -type f -exec chmod 0640 -- {} +
  find /target -xdev -type f -exec chown -h 65532:65532 -- {} +
  find /target -xdev -depth -type d -exec chown -h 65532:65532 -- {} +
  sync
}

valid_reader_gid() {
  [ "$#" -eq 1 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
  case "$1" in ''|*[!0-9]*) fail VOLUME_HELPER_ARGUMENT_INVALID ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 2147483647 ] \
    || fail VOLUME_HELPER_ARGUMENT_INVALID
}

validate_application_metadata() {
  find /target -xdev -type d -print0 | while IFS= read -r -d '' target; do
    [ "$(stat -c '%u:%g:%a' -- "$target")" = "65532:65532:750" ] \
      || fail VOLUME_HELPER_METADATA_POLICY_INVALID
  done
  find /target -xdev -type f -print0 | while IFS= read -r -d '' target; do
    [ "$(stat -c '%u:%g:%a:%h' -- "$target")" = "65532:65532:640:1" ] \
      || fail VOLUME_HELPER_METADATA_POLICY_INVALID
  done
}

validate_backup_status_metadata() {
  [ "$#" -eq 1 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
  reader_gid=$1
  marker=/target/.chenyida-erp-receipt-root-v2
  [ -f "$marker" ] && [ ! -L "$marker" ] \
    && [ "$(stat -c '%u:%g:%a:%h' -- "$marker")" = "0:$reader_gid:400:1" ] \
    && [ "$(cat -- "$marker")" = chenyida-erp-receipt-root/v2 ] \
    || fail VOLUME_HELPER_METADATA_POLICY_INVALID
  find /target -xdev -type d -print0 | while IFS= read -r -d '' target; do
    [ "$(stat -c '%u:%g:%a' -- "$target")" = "0:$reader_gid:2750" ] \
      || fail VOLUME_HELPER_METADATA_POLICY_INVALID
  done
  find /target -xdev -type f ! -path "$marker" -print0 \
    | while IFS= read -r -d '' target; do
      [ "$(stat -c '%u:%g:%a:%h' -- "$target")" = "0:$reader_gid:640:1" ] \
        || fail VOLUME_HELPER_METADATA_POLICY_INVALID
    done
}

probe_tree() {
  [ "$#" -ge 1 ] && [ "$#" -le 2 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
  domain=$1
  shift
  case "$domain" in
    uploads|attachments)
      [ "$#" -eq 0 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
      ;;
    backup_status)
      [ "$#" -eq 1 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
      valid_reader_gid "$1"
      ;;
    *) fail VOLUME_HELPER_ARGUMENT_INVALID ;;
  esac
  regular_tree
  tree_limits
  case "$domain" in
    uploads|attachments) validate_application_metadata ;;
    backup_status) validate_backup_status_metadata "$1" ;;
  esac
  file_tree_sha256=$(
    {
      printf '['
      first=YES
      find /target -xdev -type f -printf '%P\0' | sort -z | while IFS= read -r -d '' relative; do
        [ -n "$relative" ] || fail VOLUME_HELPER_PATH_INVALID
        path_hex=$(printf '%s' "$relative" | od -An -v -tx1 | tr -d ' \n')
        size=$(stat -c %s -- "/target/$relative")
        content_sha256=$(sha256sum -- "/target/$relative" | awk '{print $1}')
        [ "$first" = YES ] || printf ','
        first=NO
        printf '{"path_hex":"%s","bytes":%s,"sha256":"%s"}' \
          "$path_hex" "$size" "$content_sha256"
      done
      printf ']'
    } | sha256sum | awk '{print $1}'
  )
  metadata_state_sha256=$(
    {
      printf '['
      first=YES
      find /target -xdev -printf '%P\0' | sort -z | while IFS= read -r -d '' relative; do
        [ -n "$relative" ] || relative=.
        target=/target
        [ "$relative" = . ] || target="/target/$relative"
        path_hex=$(printf '%s' "$relative" | od -An -v -tx1 | tr -d ' \n')
        if [ -d "$target" ]; then kind=DIRECTORY; size=0; else kind=FILE; size=$(stat -c %s -- "$target"); fi
        uid=$(stat -c %u -- "$target")
        gid=$(stat -c %g -- "$target")
        mode=$(stat -c %a -- "$target")
        [ "$first" = YES ] || printf ','
        first=NO
        printf '{"path_hex":"%s","type":"%s","uid":%s,"gid":%s,"mode":"%04d","bytes":%s}' \
          "$path_hex" "$kind" "$uid" "$gid" "$mode" "$size"
      done
      printf ']'
    } | sha256sum | awk '{print $1}'
  )
  printf 'metadata_policy_status=VALID\nentries=%s\nuncompressed_bytes=%s\nfile_tree_sha256=%s\nmetadata_state_sha256=%s\n' \
    "$files" "$bytes" "$file_tree_sha256" "$metadata_state_sha256"
}

case "$operation" in
  capacity)
    [ "$#" -eq 0 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
    exec df --block-size=1 --output=source,avail,itotal,iavail /target
    ;;
  restore)
    [ "$#" -eq 0 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
    [ -z "$(find /target -xdev -mindepth 1 -print -quit)" ] \
      || fail VOLUME_HELPER_TARGET_NOT_EMPTY
    exec tar --extract --gzip --restrict --no-same-owner --no-same-permissions \
      --delay-directory-restore --file=- --directory=/target
    ;;
  reconcile-uploads|reconcile-attachments)
    reconcile_application_tree "$@"
    ;;
  reconcile-backup-status)
    [ "$#" -eq 1 ] || fail VOLUME_HELPER_ARGUMENT_INVALID
    reader_gid=$1
    valid_reader_gid "$reader_gid"
    regular_tree
    tree_limits
    marker=/target/.chenyida-erp-receipt-root-v2
    [ -f "$marker" ] && [ ! -L "$marker" ] && [ "$(stat -c %h -- "$marker")" = 1 ] \
      && [ "$(cat -- "$marker")" = chenyida-erp-receipt-root/v2 ] \
      || fail VOLUME_HELPER_BACKUP_STATUS_MARKER_INVALID
    find /target -xdev -type d -exec chown -h "0:$reader_gid" -- {} +
    find /target -xdev -type d -exec chmod 2750 -- {} +
    find /target -xdev -type f ! -path "$marker" -exec chown -h "0:$reader_gid" -- {} +
    find /target -xdev -type f ! -path "$marker" -exec chmod 0640 -- {} +
    chown -h "0:$reader_gid" -- "$marker"
    chmod 0400 -- "$marker"
    sync -f /target
    ;;
  probe)
    probe_tree "$@"
    ;;
  *) fail VOLUME_HELPER_OPCODE_INVALID ;;
esac
