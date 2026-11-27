import type { PostgrestError } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for the canonical 8-4-4-4-12 hexadecimal form of a UUID, in either letter case. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Refuses an answer that is shorter than the exact number of rows the database counted for the same request, because the
 * server cut it off (its `max_rows`, which the hosted project sets on its own) and whoever judges the rows would judge an
 * incomplete set. `exactCount` is the `count` of a request made with `{ count: "exact" }`; it is `null` when the database
 * gave none, and then nothing shows the answer to be complete, so that is refused too. A count below the number of rows is
 * not a cut-off answer (rows came in between the two readings), so it is let through. Throws an `Error` that names `scope`
 * (what was read) and `action`.
 */
export function assertExactCount(scope: string, rowCount: number, exactCount: number | null, action: string): void {
  if (exactCount === null) {
    throw new Error(
      `Reading ${scope} failed (${action}): the database gave no exact count to check the answer against.`,
    );
  }
  if (rowCount < exactCount) {
    throw new Error(`Reading ${scope} failed (${action}): the answer has ${rowCount} of ${exactCount} rows.`);
  }
}

/** Logs a failed database call as `<scope> <action> failed: <code> <message>`, never the input that caused it. */
export function logDatabaseError(scope: string, action: string, error: PostgrestError): void {
  // Code and message only: the details of a PostgREST error can quote the rejected values, which are personal data.
  // eslint-disable-next-line no-console -- the only trace of a database failure, visible in `wrangler tail`
  console.error(`${scope} ${action} failed: ${error.code} ${error.message}`);
}
