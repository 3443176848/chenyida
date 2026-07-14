export type MaterialVisibilityScope = Readonly<{
  username: string;
  canEditAny: boolean;
  canReviewQueue: boolean;
}>;

export type SqlPredicate = Readonly<{ sql: string; values: readonly unknown[] }>;

/**
 * Builds the single row-visibility predicate used by list, detail and history
 * queries. Client filters are always appended to this predicate and can never
 * replace it.
 */
export function materialVisibilityPredicate(
  scope: MaterialVisibilityScope,
  alias = "m",
): SqlPredicate {
  const statuses = `${alias}.material_status`;
  const creator = `${alias}.created_by`;
  const branches = [`${statuses} IN ('ACTIVE', 'FROZEN', 'INACTIVE')`];
  const values: unknown[] = [];

  if (scope.canEditAny) {
    branches.push(`${statuses} IN ('DRAFT', 'PENDING_REVIEW', 'PENDING_APPROVAL')`);
  } else {
    branches.push(`(${statuses} = 'DRAFT' AND ${creator} = ?)`);
    values.push(scope.username);
    if (scope.canReviewQueue) {
      branches.push(`${statuses} IN ('PENDING_REVIEW', 'PENDING_APPROVAL')`);
    } else {
      branches.push(`(${statuses} IN ('PENDING_REVIEW', 'PENDING_APPROVAL') AND ${creator} = ?)`);
      values.push(scope.username);
    }
  }
  return { sql: `(${branches.join(" OR ")})`, values };
}

export function draftVisibilityPredicate(
  scope: MaterialVisibilityScope,
  alias = "m",
): SqlPredicate {
  const visibility = materialVisibilityPredicate(scope, alias);
  return {
    sql: `(${alias}.material_status IN ('DRAFT', 'PENDING_REVIEW', 'PENDING_APPROVAL') AND ${visibility.sql})`,
    values: visibility.values,
  };
}
