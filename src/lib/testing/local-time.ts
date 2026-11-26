// Test-only helper for the rule that dates are read in UTC. Not imported from application code.
//
// What the spy cannot see: it only counts calls of the local-time getters and setters listed below. A date built from
// local components (`new Date(y, m, d)`) or from a string without an offset (`new Date("2026-11-10T00:00:00")`,
// `Date.parse` of one) calls none of them, and the test runtime runs in UTC, so such code would pass every test and go
// wrong only in another time zone; the deprecated `getYear` and `setYear` are not watched either. The ESLint rule
// `no-restricted-syntax` for `src/lib/services/` (`eslint.config.js`) covers those constructions, not a date-time
// string that only reaches `new Date` through a variable.
import { vi } from "vitest";

// The methods of `Date` that read or write the local time zone. The workerd test runtime runs in UTC, so a rule that used
// one of them would still pass every test; calling any of them is what a test has to catch.
const LOCAL_DATE_METHODS = [
  "getDate",
  "getDay",
  "getFullYear",
  "getHours",
  "getMilliseconds",
  "getMinutes",
  "getMonth",
  "getSeconds",
  "getTimezoneOffset",
  "setDate",
  "setFullYear",
  "setHours",
  "setMilliseconds",
  "setMinutes",
  "setMonth",
  "setSeconds",
  "toDateString",
  "toLocaleDateString",
  "toLocaleString",
  "toLocaleTimeString",
  "toString",
  "toTimeString",
] as const satisfies readonly (keyof Date)[];

interface Spy {
  method: string;
  spy: { mock: { calls: readonly unknown[] }; mockRestore: () => void };
}

/** Runs `run` with every local-time method of `Date` watched and gives the names of the ones it called, in list order. */
export function localDateMethodsCalledBy(run: () => void): string[] {
  const spies: Spy[] = LOCAL_DATE_METHODS.map((method) => ({ method, spy: vi.spyOn(Date.prototype, method) }));
  try {
    run();
    return spies.filter(({ spy }) => spy.mock.calls.length > 0).map(({ method }) => method);
  } finally {
    for (const { spy } of spies) {
      spy.mockRestore();
    }
  }
}
