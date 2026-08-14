# Source-only helper. The caller keeps the acquired or Supervisor-inherited descriptor open for its full lifetime.
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
  if [ -n "${ERP_RELEASE_GATE_LOCK_FD:-}" ]; then
    [ "${ERP_RELEASE_SUPERVISOR_LAUNCHED:-}" = YES ] && [ "${ERP_RELEASE_GATE_LOCK_HELD:-}" = YES ] \
      || { echo "inherited global release gate lock is not Supervisor controlled" >&2; return 1; }
    case "$ERP_RELEASE_GATE_LOCK_FD" in [3-9]|[1-5][0-9]|6[0-3]) : ;; *) echo "inherited global release gate lock descriptor is invalid" >&2; return 1 ;; esac
    [ "$(stat -Lc %d:%i "/proc/self/fd/$ERP_RELEASE_GATE_LOCK_FD" 2>/dev/null || true)" = "$(stat -Lc %d:%i "$CYD_RELEASE_GATE_LOCK")" ] \
      || { echo "inherited global release gate lock identity is invalid" >&2; return 1; }
    if flock -n -E 75 "$CYD_RELEASE_GATE_LOCK" true; then
      echo "inherited global release gate lock is not held" >&2
      return 1
    else
      CYD_RELEASE_GATE_CONTENDER_STATUS=$?
      [ "$CYD_RELEASE_GATE_CONTENDER_STATUS" = 75 ] || { echo "inherited global release gate lock probe failed" >&2; return 1; }
    fi
  else
    exec 4<>"$CYD_RELEASE_GATE_LOCK"
    [ "$(stat -Lc %d:%i /proc/self/fd/4)" = "$(stat -Lc %d:%i "$CYD_RELEASE_GATE_LOCK")" ] \
      || { echo "global release gate lock identity changed" >&2; return 1; }
    flock -n 4 || { echo "another protected backup, recovery, or release operation is active" >&2; return 1; }
    [ "$(stat -Lc %d:%i /proc/self/fd/4)" = "$(stat -Lc %d:%i "$CYD_RELEASE_GATE_LOCK")" ] \
      || { echo "global release gate lock path changed after acquisition" >&2; return 1; }
  fi
  CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER=$(dirname "$0")/postgresql-runtime-privilege-interlock.sh
  [ -f "$CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER" ] && [ ! -L "$CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER" ] \
    && [ "$(stat -c %h "$CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER")" = 1 ] \
    && [ "$(stat -c %u "$CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER")" = "$(id -u)" ] \
    && [ $((0$(stat -c %a "$CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER") & 0022)) -eq 0 ] \
    || { echo "runtime privilege interlock helper is unsafe" >&2; return 1; }
  # shellcheck source=postgresql-runtime-privilege-interlock.sh
  . "$CYD_RUNTIME_PRIVILEGE_INTERLOCK_HELPER"
  assert_no_chenyida_postgresql_runtime_privilege_interlock
}
