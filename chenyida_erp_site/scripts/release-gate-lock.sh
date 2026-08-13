# Source-only helper. The caller keeps descriptor 4 open for its full lifetime.
acquire_chenyida_release_gate_lock() {
  CYD_RELEASE_GATE_LOCK=/run/lock/chenyida-erp-release-gate-v1.lock
  if [ -n "${ERP_RELEASE_GATE_LOCK_FILE:-}" ]; then
    [ "${NODE_ENV:-}" = test ] || { echo "global release gate lock override is restricted to tests" >&2; return 1; }
    case "$ERP_RELEASE_GATE_LOCK_FILE" in /tmp/*/release-gate.lock) CYD_RELEASE_GATE_LOCK=$ERP_RELEASE_GATE_LOCK_FILE ;; *) echo "test global release gate lock path is invalid" >&2; return 1 ;; esac
  fi
  CYD_RELEASE_GATE_LOCK_DIR=$(dirname "$CYD_RELEASE_GATE_LOCK")
  [ -d "$CYD_RELEASE_GATE_LOCK_DIR" ] && [ ! -L "$CYD_RELEASE_GATE_LOCK_DIR" ] \
    && [ "$(stat -c %u "$CYD_RELEASE_GATE_LOCK_DIR")" = "$(id -u)" ] \
    && [ $((0$(stat -c %a "$CYD_RELEASE_GATE_LOCK_DIR") & 0022)) -eq 0 ] \
    || { echo "global release gate lock directory is unsafe" >&2; return 1; }
  if [ ! -e "$CYD_RELEASE_GATE_LOCK" ]; then (umask 077; set -C; : > "$CYD_RELEASE_GATE_LOCK") 2>/dev/null || true; fi
  [ -f "$CYD_RELEASE_GATE_LOCK" ] && [ ! -L "$CYD_RELEASE_GATE_LOCK" ] \
    && [ "$(stat -c %h "$CYD_RELEASE_GATE_LOCK")" = 1 ] \
    && [ "$(stat -c %u "$CYD_RELEASE_GATE_LOCK")" = "$(id -u)" ] \
    && [ "$(stat -c %a "$CYD_RELEASE_GATE_LOCK")" = 600 ] \
    || { echo "global release gate lock is unsafe" >&2; return 1; }
  exec 4<>"$CYD_RELEASE_GATE_LOCK"
  [ "$(stat -Lc %d:%i /proc/self/fd/4)" = "$(stat -Lc %d:%i "$CYD_RELEASE_GATE_LOCK")" ] \
    || { echo "global release gate lock identity changed" >&2; return 1; }
  flock -n 4 || { echo "another protected backup, recovery, or release operation is active" >&2; return 1; }
  [ "$(stat -Lc %d:%i /proc/self/fd/4)" = "$(stat -Lc %d:%i "$CYD_RELEASE_GATE_LOCK")" ] \
    || { echo "global release gate lock path changed after acquisition" >&2; return 1; }
}
