import { isUuid } from "@/lib/postgrest";
import { weekdayOf } from "@/lib/services/calendar";
import { SCHEDULE_MAX_DATE, SCHEDULE_MIN_DATE, compareText, dayColumns, parseIsoDate } from "@/lib/services/schedule";
import { MINUTES_PER_DAY } from "@/lib/services/shift";
import type { Absence, AbsenceFieldErrors, AbsenceInput, AbsenceType } from "@/types";

// The absences of employees (S-07): the entry rules shared by the form and the API route, and the date helpers the live rules
// and the weekly norm build on. Whole days only, no hours and no free text (an L4 is health data). Every date is read in UTC
// or counted in whole days (`parseIsoDate`, `Date.UTC`), so that no time zone or daylight saving change can shift a day. The
// bounds are those of the schedules (2020-01-01 to 2099-12-31): an absence outside them would make the date helpers throw
// and switch the live check off for every schedule, so the database repeats them.

const DAY_MS = 86_400_000;
// The date range as a text for people, the same in every message that mentions it.
const DATE_RANGE = `od ${SCHEDULE_MIN_DATE} do ${SCHEDULE_MAX_DATE}`;
const EN_DASH = String.fromCharCode(0x2013);

// One message per field, shown next to the form field and returned by the API. A start or an end that is not a date in
// range gets the format message, and an end before the start (both being dates) is reported on `endDate`.
const FIELD_ERRORS = {
  employeeId: "Wybierz pracownika.",
  type: "Wybierz rodzaj nieobecności: urlop, zwolnienie lekarskie (L4) albo inną nieobecność.",
  startDate: `Podaj poprawną datę początku nieobecności (RRRR-MM-DD, ${DATE_RANGE}).`,
  endDate: `Podaj poprawną datę końca nieobecności (RRRR-MM-DD, ${DATE_RANGE}).`,
  endDateBeforeStart: "Data końca nie może być wcześniejsza niż data początku.",
} as const;

const TYPE_LABELS: Record<AbsenceType, string> = {
  vacation: "Urlop",
  sick_leave: "Zwolnienie lekarskie (L4)",
  other: "Inna nieobecność",
};

/** The types in the order a form lists them, each with its Polish label. */
export const ABSENCE_TYPES: readonly { value: AbsenceType; label: string }[] = [
  { value: "vacation", label: TYPE_LABELS.vacation },
  { value: "sick_leave", label: TYPE_LABELS.sick_leave },
  { value: "other", label: TYPE_LABELS.other },
];

/** The Polish label of a type: "Urlop", "Zwolnienie lekarskie (L4)" or "Inna nieobecność". */
export function absenceTypeLabel(type: AbsenceType): string {
  return TYPE_LABELS[type];
}

function parseEmployeeId(value: unknown): string | undefined {
  // UUIDs compare case-insensitively in the database, so the id is kept in lower case here.
  return typeof value === "string" && isUuid(value) ? value.toLowerCase() : undefined;
}

function parseType(value: unknown): AbsenceType | undefined {
  return ABSENCE_TYPES.find((entry) => entry.value === value)?.value;
}

/** The string itself when it is a real `RRRR-MM-DD` date from 2020-01-01 to 2099-12-31 (already in canonical form). */
function parseDate(value: unknown): string | undefined {
  return typeof value === "string" &&
    parseIsoDate(value) !== undefined &&
    compareText(value, SCHEDULE_MIN_DATE) >= 0 &&
    compareText(value, SCHEDULE_MAX_DATE) <= 0
    ? value
    : undefined;
}

/**
 * Validates and normalises a raw absence with the keys `employeeId` (a UUID), `type` (`vacation`, `sick_leave` or
 * `other`), `startDate` and `endDate` (`RRRR-MM-DD`, 2020-01-01 to 2099-12-31, the end not before the start, both days
 * included). Anything that is not an object counts as empty fields. Every invalid field is reported at once, each with
 * one message; an end before the start is only compared when both dates are well formed. Other keys, such as a `status`
 * or an `id`, are left out of the value instead of being passed through, and the input is not changed.
 */
export function validateAbsenceInput(
  raw: unknown,
): { ok: true; value: AbsenceInput } | { ok: false; errors: AbsenceFieldErrors } {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const employeeId = parseEmployeeId(input.employeeId);
  const type = parseType(input.type);
  const startDate = parseDate(input.startDate);
  const endDate = parseDate(input.endDate);
  const endsBeforeStart = startDate !== undefined && endDate !== undefined && compareText(endDate, startDate) < 0;

  if (
    employeeId === undefined ||
    type === undefined ||
    startDate === undefined ||
    endDate === undefined ||
    endsBeforeStart
  ) {
    const errors: AbsenceFieldErrors = {};
    if (employeeId === undefined) {
      errors.employeeId = FIELD_ERRORS.employeeId;
    }
    if (type === undefined) {
      errors.type = FIELD_ERRORS.type;
    }
    if (startDate === undefined) {
      errors.startDate = FIELD_ERRORS.startDate;
    }
    if (endDate === undefined) {
      errors.endDate = FIELD_ERRORS.endDate;
    } else if (endsBeforeStart) {
      errors.endDate = FIELD_ERRORS.endDateBeforeStart;
    }
    return { ok: false, errors };
  }
  return { ok: true, value: { employeeId, type, startDate, endDate } };
}

function requireDate(isoDate: string) {
  const parts = parseIsoDate(isoDate);
  if (parts === undefined) {
    throw new RangeError(`Not a valid schedule date: ${JSON.stringify(isoDate)}`);
  }
  return parts;
}

function utcTime(isoDate: string): number {
  const { year, month, day } = requireDate(isoDate);
  return Date.UTC(year, month - 1, day);
}

/**
 * The whole days from `startDate` to `isoDate`: 0 for the same day, 1 for the next, negative for a day before. Counted in
 * UTC calendar days, so a daylight saving change never moves the result. Throws a RangeError for a date that
 * `parseIsoDate` rejects (that is, outside 2020 to 2099 too).
 */
export function dayOffsetOf(startDate: string, isoDate: string): number {
  return (utcTime(isoDate) - utcTime(startDate)) / DAY_MS;
}

/**
 * The span of an absence on the timeline of a schedule that starts on `startDate`: minutes from midnight of day 0, from
 * the start of the first day to the end of the last one (both days included), so the end is exclusive. It may begin
 * before 0 or end past the 7 days of the schedule. Throws a RangeError for a date that `parseIsoDate` rejects.
 */
export function absenceInterval(
  startDate: string,
  absence: Pick<AbsenceInput, "startDate" | "endDate">,
): { start: number; end: number } {
  return {
    start: dayOffsetOf(startDate, absence.startDate) * MINUTES_PER_DAY,
    end: (dayOffsetOf(startDate, absence.endDate) + 1) * MINUTES_PER_DAY,
  };
}

/**
 * True when two half-open intervals `[start, end)` share a moment: `a.start < b.end && b.start < a.end`, so an interval
 * that ends exactly where the other starts does not overlap it. Both are expected to be non-empty, as the span of a shift
 * and of an absence always is.
 */
export function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The days of an absence for people: "02.11" and "06.11.2026" joined with an en dash (U+2013), the year once at the end
 * ("02.11–06.11.2026"), "02.11.2026" for a single day, and the year on both ends when the absence crosses New Year
 * ("29.12.2026–04.01.2027"). Throws a RangeError for a date that `parseIsoDate` rejects.
 */
export function formatAbsenceRange(absence: Pick<AbsenceInput, "startDate" | "endDate">): string {
  const start = requireDate(absence.startDate);
  const end = requireDate(absence.endDate);
  const dayAndMonth = ({ day, month }: { day: number; month: number }) =>
    `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`;
  const withYear = (parts: { year: number; month: number; day: number }) =>
    `${dayAndMonth(parts)}.${String(parts.year).padStart(4, "0")}`;
  if (absence.startDate === absence.endDate) {
    return withYear(start);
  }
  return start.year === end.year
    ? `${dayAndMonth(start)}${EN_DASH}${withYear(end)}`
    : `${withYear(start)}${EN_DASH}${withYear(end)}`;
}

/**
 * The days of the week of seven days that starts on `startDate` that an approved absence takes off the weekly norm
 * (decision D7), as `YYYY-MM-DD`, sorted, each one once however many absences cover it: a day from Monday to Friday that is
 * not in `holidays` (the holidays of the week, `holidaysInWeek`, which already lowered the norm) and lies within an
 * absence with the status `approved`. A requested or a rejected absence takes nothing off, and neither does a Saturday or
 * a Sunday. The dates of the absences are taken as canonical `YYYY-MM-DD` (the validator and the database see to that).
 * Throws a RangeError for a `startDate` that `parseIsoDate` rejects.
 */
export function excusedWeekdays(
  startDate: string,
  absences: readonly Pick<Absence, "startDate" | "endDate" | "status">[],
  holidays: readonly string[],
): string[] {
  const days = dayColumns(startDate);
  const approved = absences.filter((absence) => absence.status === "approved");
  const holidayDates = new Set(holidays);
  const firstWeekday = weekdayOf(startDate);
  return days
    .filter(({ offset, date }) => {
      // 0 is Sunday and 6 Saturday, so Monday to Friday are 1 to 5.
      const weekday = (firstWeekday + offset) % 7;
      return (
        weekday >= 1 &&
        weekday <= 5 &&
        !holidayDates.has(date) &&
        approved.some((absence) => compareText(absence.startDate, date) <= 0 && compareText(date, absence.endDate) <= 0)
      );
    })
    .map(({ date }) => date);
}

/**
 * A new list with the latest start first, then `id` in code-unit order (an id is not text for people). The result does not
 * depend on the order of `absences`, which is left unchanged. Works on any item with these keys, so on a full absence as
 * well as on a list row.
 */
export function sortAbsences<T extends { id: string; startDate: string }>(absences: readonly T[]): T[] {
  return [...absences].sort((a, b) => compareText(b.startDate, a.startDate) || compareText(a.id, b.id));
}
