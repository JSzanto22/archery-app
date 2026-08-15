/**
 * Postgres error classification.
 *
 * Every create in this API takes a client-supplied uuid, so re-sending one — a
 * retry after a timeout, or a caller doing it deliberately — hits a primary key
 * and raised a 500. That is an internal error for something the caller caused
 * and can trigger at will, which makes the service's error rate meaningless
 * and buries real faults.
 *
 * Codes are from the Postgres error table, class 23 (integrity violation).
 */

/**
 * The SQLSTATE, wherever it ended up.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` and keeps the original
 * on `cause`, so reading `error.code` off the top level finds nothing and every
 * integrity violation reads as an unclassified 500. The chain is walked with a
 * depth limit because a cause cycle would otherwise hang the handler.
 */
function errorCode(error: unknown): string | null {
  let current = error;

  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== 'object' || current === null) return null;

    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/** 23505: a row with this key already exists. */
export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === '23505';
}

/** 23503: the row points at something that is not there. */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === '23503';
}
