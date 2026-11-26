import { employeeDayKey } from "@/lib/services/assignment";
import type { Violation } from "@/types";

// What the assignment view says about the violations of the live check (S-05): the counts in words, and which violation sits
// in which cell and row of the people's table. Pure functions, so that the Polish plural forms and the grouping are tested
// like the rules themselves, and the view only lays the result out.

/** How many violations are critical and how many are warnings. The same shape as `summarizeViolations` returns. */
export interface ViolationCounts {
  critical: number;
  warning: number;
}

/** What stands in the counter of the list when there is nothing to report. */
export const NO_VIOLATIONS_TEXT = "Brak wskazań";

/**
 * The Polish form of a noun after a whole number from 0 up: `one` for 1, `few` for 2 to 4 (and 22 to 24, 32 to 34, and so
 * on, but not 12 to 14) and `many` for everything else, 0 included.
 */
export function pluralPl(count: number, one: string, few: string, many: string): string {
  if (count === 1) {
    return one;
  }
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14) ? few : many;
}

/**
 * The counts as words, the parts that are not zero joined with a comma: "1 krytyczne", "2 krytyczne, 1 ostrzeżenie",
 * "5 krytycznych, 12 ostrzeżeń". An empty text when both are zero.
 */
export function formatViolationCounts({ critical, warning }: ViolationCounts): string {
  const parts: string[] = [];
  if (critical > 0) {
    parts.push(`${critical} ${pluralPl(critical, "krytyczne", "krytyczne", "krytycznych")}`);
  }
  if (warning > 0) {
    parts.push(`${warning} ${pluralPl(warning, "ostrzeżenie", "ostrzeżenia", "ostrzeżeń")}`);
  }
  return parts.join(", ");
}

/** The counter above the list of violations: "Wskazania: 1 krytyczne, 2 ostrzeżenia", or "Brak wskazań" for none. */
export function formatViolationCounter(counts: ViolationCounts): string {
  const text = formatViolationCounts(counts);
  return text === "" ? NO_VIOLATIONS_TEXT : `Wskazania: ${text}`;
}

/**
 * What a cell of the people's table says under its buttons, the weight first: "Krytyczne: 2", "Ostrzeżenie: 1" or
 * "Krytyczne: 2, Ostrzeżenie: 1". An empty text when both are zero.
 */
export function formatCellMarker({ critical, warning }: ViolationCounts): string {
  const parts: string[] = [];
  if (critical > 0) {
    parts.push(`Krytyczne: ${critical}`);
  }
  if (warning > 0) {
    parts.push(`Ostrzeżenie: ${warning}`);
  }
  return parts.join(", ");
}

function groupBy(violations: readonly Violation[], keysOf: (violation: Violation) => Iterable<string>) {
  const groups = new Map<string, Violation[]>();
  for (const violation of violations) {
    for (const key of keysOf(violation)) {
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [violation]);
      } else {
        group.push(violation);
      }
    }
  }
  return Object.fromEntries(groups);
}

/**
 * For each cell of the people's table (`employeeDayKey`), the violations anchored to an assignment of that person on that
 * day, each listed once in a cell even when several of its anchors sit there, in the order of `violations`. A violation of
 * a whole week of one person (no anchors) and a shortage of staff (an anchor that is a staffing cell, with no person) have
 * no entry: they belong to no cell.
 */
export function groupViolationsByEmployeeDay(violations: readonly Violation[]): Partial<Record<string, Violation[]>> {
  return groupBy(violations, ({ anchors }) => {
    const keys = new Set<string>();
    for (const { employeeId, dayOffset } of anchors) {
      if (employeeId !== null) {
        keys.add(employeeDayKey(employeeId, dayOffset));
      }
    }
    return keys;
  });
}

/**
 * For each person (by id), every violation about them, cells and whole week alike, in the order of `violations`; the person's
 * total in the table. A shortage of staff is about no person and has no entry.
 */
export function groupViolationsByEmployee(violations: readonly Violation[]): Partial<Record<string, Violation[]>> {
  return groupBy(violations, ({ employeeId }) => (employeeId === null ? [] : [employeeId]));
}
