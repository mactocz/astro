import { employeeDayKey } from "@/lib/services/assignment";
import { holidaysInWeek } from "@/lib/services/calendar";
import { compareText } from "@/lib/services/schedule";
import { MINUTES_PER_DAY, shiftDurationMinutes } from "@/lib/services/shift";
import type { AssignmentInput, Fte } from "@/types";

// The calculations on minutes shared by the live rules (S-05) and the hours against the norm (S-06): the interval a shift
// takes on the timeline of a schedule, the hours a person works and the weekly norm. All in whole minutes, so that nothing
// depends on a time zone.

// A full-time week without a holiday is 40 h, and each holiday on a day other than Sunday takes 8 h off (art. 130).
const FULL_WEEK_MINUTES = 2400;
const HOLIDAY_MINUTES = 480;

/** What the work-time rules need to know of a shift: when it starts and ends (minutes after midnight, as in `ShiftInput`). */
export interface ShiftTimes {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
}

/**
 * The norm of one week. `baseMinutes` is the full-time norm after the holidays; the norm of a person is that times the FTE.
 * The FTE stays a fraction, because the norm of 3/7 of a week is not a whole number of minutes: compare with
 * `exceedsNorm` and round only to show it (`normMinutes`).
 */
export interface WeeklyNorm {
  baseMinutes: number;
  fte: Fte;
  /** The holidays on a day other than Sunday in the seven days, as `YYYY-MM-DD`; each one took 8 h off `baseMinutes`. */
  holidays: string[];
}

/**
 * The span a shift takes when it starts on day `dayOffset` of a schedule, in minutes from midnight of day 0. A night shift
 * belongs to the day it starts, so its end may lie past the last day (`end` above 7 × 1440).
 */
export function shiftInterval(
  shift: Pick<ShiftTimes, "startMinute" | "endMinute">,
  dayOffset: number,
): { start: number; end: number } {
  const start = dayOffset * MINUTES_PER_DAY + shift.startMinute;
  return { start, end: start + shiftDurationMinutes(shift) };
}

/**
 * For each employee with at least one assignment, the sum of the full durations of the shifts they are assigned to: a
 * night shift that starts on the last day counts in full. An assignment to a shift that is not in `shifts` is left out
 * (it has no hours), and the same assignment twice counts once. The keys are in sorted order, so the same data in any
 * order gives the same object.
 */
export function workedMinutesByEmployee(
  assignments: readonly AssignmentInput[],
  shifts: readonly ShiftTimes[],
): Record<string, number> {
  const durations = new Map(shifts.map((shift): [string, number] => [shift.id, shiftDurationMinutes(shift)]));
  const counted = new Set<string>();
  const totals = new Map<string, number>();
  for (const { shiftId, dayOffset, employeeId } of assignments) {
    const duration = durations.get(shiftId);
    const key = `${employeeDayKey(employeeId, dayOffset)}/${shiftId}`;
    if (duration === undefined || counted.has(key)) {
      continue;
    }
    counted.add(key);
    totals.set(employeeId, (totals.get(employeeId) ?? 0) + duration);
  }
  return Object.fromEntries([...totals].sort(([a], [b]) => compareText(a, b)));
}

/**
 * The norm of the week of seven days that starts on `startDate`, for an employee with `fte`: 40 h times the FTE, less 8 h
 * times the FTE for each holiday on a day other than Sunday. Throws a RangeError for a `startDate` that `parseIsoDate`
 * rejects, and for an `fte` that is not a fraction of whole numbers with 1 <= numerator <= denominator.
 */
export function weeklyNorm(startDate: string, fte: Fte): WeeklyNorm {
  const holidays = holidaysInWeek(startDate);
  const { numerator, denominator } = fte;
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 1 || numerator > denominator) {
    throw new RangeError(`Not a valid FTE: ${JSON.stringify(fte)}`);
  }
  return {
    baseMinutes: FULL_WEEK_MINUTES - HOLIDAY_MINUTES * holidays.length,
    fte: { numerator, denominator },
    holidays,
  };
}

/** The norm in minutes rounded to the whole minute, to show it ("17 h 9 min" for 3/7 of a week). Not to compare with. */
export function normMinutes(norm: WeeklyNorm): number {
  return Math.round((norm.baseMinutes * norm.fte.numerator) / norm.fte.denominator);
}

/**
 * True when `workedMinutes` is above the norm, which is not rounded: with 3/7 of a week the norm is 1028.57 minutes, so
 * 1029 exceeds it (`worked × denominator > base × numerator`, in whole numbers). Equal to the norm does not exceed it.
 */
export function exceedsNorm(workedMinutes: number, norm: WeeklyNorm): boolean {
  return workedMinutes * norm.fte.denominator > norm.baseMinutes * norm.fte.numerator;
}
