export const D1_MIGRATION_STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const NORMAL = 0;
const LINE_COMMENT = 1;
const BLOCK_COMMENT = 2;
const SINGLE_QUOTED = 3;
const DOUBLE_QUOTED = 4;

function hasExecutableSql(fragment) {
  let state = NORMAL;
  let hasExecutableContent = false;

  for (let index = 0; index < fragment.length; index += 1) {
    const current = fragment[index];
    const next = fragment[index + 1];

    if (state === LINE_COMMENT) {
      if (current === "\n" || current === "\r") state = NORMAL;
      continue;
    }

    if (state === BLOCK_COMMENT) {
      if (current === "*" && next === "/") {
        state = NORMAL;
        index += 1;
      }
      continue;
    }

    if (state === SINGLE_QUOTED) {
      if (current === "'" && next === "'") index += 1;
      else if (current === "'") state = NORMAL;
      continue;
    }

    if (state === DOUBLE_QUOTED) {
      if (current === '"' && next === '"') index += 1;
      else if (current === '"') state = NORMAL;
      continue;
    }

    if (/\s/u.test(current)) continue;
    if (current === "-" && next === "-") {
      state = LINE_COMMENT;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      state = BLOCK_COMMENT;
      index += 1;
      continue;
    }

    hasExecutableContent = true;
    if (current === "'") state = SINGLE_QUOTED;
    else if (current === '"') state = DOUBLE_QUOTED;
  }

  // SQLite does not support nested block comments, so this helper does not
  // attempt to interpret them. Unterminated strings or block comments are
  // retained fail-closed and left for D1 to reject with its normal SQL error.
  if (state === SINGLE_QUOTED || state === DOUBLE_QUOTED || state === BLOCK_COMMENT) return true;
  return hasExecutableContent;
}

export function filterExecutableD1MigrationStatements(fragments) {
  if (!Array.isArray(fragments)) throw new TypeError("SQL fragments must be an array");
  return fragments.filter((fragment) => {
    if (typeof fragment !== "string") throw new TypeError("Each SQL fragment must be a string");
    return hasExecutableSql(fragment);
  });
}

export function splitD1MigrationStatements(sql) {
  if (typeof sql !== "string") throw new TypeError("Migration SQL must be a string");
  return filterExecutableD1MigrationStatements(sql.split(D1_MIGRATION_STATEMENT_BREAKPOINT));
}
