import type { PostgrestError } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for the canonical 8-4-4-4-12 hexadecimal form of a UUID, in either letter case. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Logs a failed database call as `<scope> <action> failed: <code> <message>`, never the input that caused it. */
export function logDatabaseError(scope: string, action: string, error: PostgrestError): void {
  // Code and message only: the details of a PostgREST error can quote the rejected values, which are personal data.
  // eslint-disable-next-line no-console -- the only trace of a database failure, visible in `wrangler tail`
  console.error(`${scope} ${action} failed: ${error.code} ${error.message}`);
}
