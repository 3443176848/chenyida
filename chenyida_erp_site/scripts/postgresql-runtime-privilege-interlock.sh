# Source-only helper. Call this after acquiring the global release gate lock.
assert_no_chenyida_postgresql_runtime_privilege_interlock() {
  cyd_operator_root=/var/lib/chenyida-erp/postgresql-runtime-privilege-operator
  cyd_operator_synthetic=NO
  if [ -n "${ERP_RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT:-}" ]; then
    [ "${NODE_ENV:-}" = test ] || { echo "PostgreSQL runtime privilege state root override is restricted to tests" >&2; return 1; }
    case "$ERP_RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT" in
      /tmp/*/postgresql-runtime-privilege-operator) cyd_operator_root=$ERP_RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT; cyd_operator_synthetic=YES ;;
      *) echo "test PostgreSQL runtime privilege state root is invalid" >&2; return 1 ;;
    esac
  fi

  if [ ! -e "$cyd_operator_root" ]; then
    [ ! -L "$cyd_operator_root" ] || { echo "PostgreSQL runtime privilege state root is unsafe" >&2; return 1; }
    return 0
  fi
  [ -d "$cyd_operator_root" ] && [ ! -L "$cyd_operator_root" ] \
    && [ "$(readlink -f -- "$cyd_operator_root")" = "$cyd_operator_root" ] \
    && [ "$(stat -c '%u:%g:%a' -- "$cyd_operator_root")" = "$(id -u):$(id -u):700" ] \
    || { echo "PostgreSQL runtime privilege state root is unsafe" >&2; return 1; }

  if [ "$cyd_operator_synthetic" = NO ]; then
    cyd_operator_cursor=$cyd_operator_root
    while :; do
      [ -d "$cyd_operator_cursor" ] && [ ! -L "$cyd_operator_cursor" ] \
        && [ "$(stat -c '%u:%g' -- "$cyd_operator_cursor")" = 0:0 ] \
        && [ $((0$(stat -c %a -- "$cyd_operator_cursor") & 0022)) -eq 0 ] \
        || { echo "PostgreSQL runtime privilege state root ancestor is unsafe" >&2; return 1; }
      [ "$cyd_operator_cursor" = / ] && break
      cyd_operator_cursor=$(dirname -- "$cyd_operator_cursor")
    done
  fi

  cyd_operator_marker=$cyd_operator_root/.chenyida-erp-postgresql-runtime-privilege-operator-v1
  [ -f "$cyd_operator_marker" ] && [ ! -L "$cyd_operator_marker" ] \
    && [ "$(stat -c '%u:%g:%a:%h:%s' -- "$cyd_operator_marker")" = "$(id -u):$(id -u):400:1:54" ] \
    && [ "$(cat -- "$cyd_operator_marker")" = chenyida-erp-postgresql-runtime-privilege-operator/v1 ] \
    || { echo "PostgreSQL runtime privilege state root marker is invalid" >&2; return 1; }

  for cyd_operator_directory in active completed preparing quarantine receipts; do
    cyd_operator_path=$cyd_operator_root/$cyd_operator_directory
    [ -d "$cyd_operator_path" ] && [ ! -L "$cyd_operator_path" ] \
      && [ "$(stat -c '%u:%g:%a' -- "$cyd_operator_path")" = "$(id -u):$(id -u):700" ] \
      || { echo "PostgreSQL runtime privilege journal directory is unsafe" >&2; return 1; }
  done
  cyd_operator_entry_count=0
  for cyd_operator_entry in "$cyd_operator_root"/* "$cyd_operator_root"/.[!.]* "$cyd_operator_root"/..?*; do
    [ -e "$cyd_operator_entry" ] || [ -L "$cyd_operator_entry" ] || continue
    case "$cyd_operator_entry" in
      "$cyd_operator_marker"|\
      "$cyd_operator_root/active"|\
      "$cyd_operator_root/completed"|\
      "$cyd_operator_root/preparing"|\
      "$cyd_operator_root/quarantine"|\
      "$cyd_operator_root/receipts")
        cyd_operator_entry_count=$((cyd_operator_entry_count + 1))
        ;;
      *)
        echo "PostgreSQL runtime privilege state root contains an unexpected entry" >&2
        return 1
        ;;
    esac
  done
  [ "$cyd_operator_entry_count" -eq 6 ] \
    || { echo "PostgreSQL runtime privilege state root contains an unexpected entry" >&2; return 1; }

  for cyd_operator_directory in active preparing quarantine; do
    [ -z "$(find "$cyd_operator_root/$cyd_operator_directory" -mindepth 1 -maxdepth 1 -print -quit)" ] \
      || { echo "a PostgreSQL runtime privilege operation requires controlled recovery" >&2; return 1; }
  done
}
