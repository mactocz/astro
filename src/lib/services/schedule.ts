import { isUuid } from "@/lib/postgrest";
import type { ScheduleFieldErrors, ScheduleInput, StaffingCell } from "@/types";

export const SCHEDULE_LABEL_MAX_LENGTH = 60;
/** The most people one shift can need on one day. */
export const STAFFING_MAX = 99;
/** A schedule covers this many days from its start date. */
export const PERIOD_DAYS = 7;
/** The first and the last accepted start date; the database repeats the same bounds. */
export const SCHEDULE_MIN_DATE = "2020-01-01";
export const SCHEDULE_MAX_DATE = "2099-12-31";
/** A grid never has more cells than 50 shifts over 7 days. */
export const STAFFING_MAX_CELLS = 350;

const MIN_YEAR = 2020;
const MAX_YEAR = 2099;
const DAY_MS = 86_400_000;

// One message per field, shown next to the form field and returned by the API. The staffing and employee fields have
// one message per cause: the grid and the employee list are the only fields with more than one way to be wrong.
const FIELD_ERRORS = {
  startDate: "Podaj poprawną datę początkową.",
  label: `Etykieta może mieć najwyżej ${SCHEDULE_LABEL_MAX_LENGTH} znaków i nie może zawierać znaków sterujących.`,
  staffingEmpty: `Wpisz obsadę (od 1 do ${STAFFING_MAX} osób) na co najmniej jednej zmianie w co najmniej jednym dniu.`,
  staffingTooMany: `Za dużo wpisów obsady (najwyżej ${STAFFING_MAX_CELLS}).`,
  staffingCell: `Każdy wpis obsady musi wskazywać zmianę, dzień (0–${PERIOD_DAYS - 1}) i liczbę osób (1–${STAFFING_MAX}).`,
  staffingDuplicate: "Ta sama zmiana nie może mieć dwóch wpisów obsady na ten sam dzień.",
  employeesEmpty: "Wybierz co najmniej jednego pracownika.",
  employeesInvalid: "Lista pracowników zawiera niepoprawny identyfikator.",
} as const;

// Short Polish weekday names, indexed by `Date.getUTCDay()` (0 is Sunday).
const WEEKDAYS = ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL_CHARS = /\p{Cc}/u;
// No glyph of their own: format characters (zero-width space, joiners, direction marks) and the blank fillers that look
// like letters. A label made only of them and spaces would show up as an empty cell. A joiner inside a visible label
// (an emoji sequence, say) stays allowed.
// The fillers are written as escapes (Hangul choseong and jungseong filler, braille blank, Hangul filler, halfwidth Hangul
// filler) because they cannot be told apart in an editor.
const INVISIBLE_CHARS = /[\p{Cf}ᅟᅠ⠀ㅤﾠ]/gu;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

function utcTime({ year, month, day }: DateParts): number {
  return Date.UTC(year, month - 1, day);
}

// The calendar date of a point in time, read in UTC so that no time zone or daylight saving change can shift it.
function partsOf(time: number): DateParts {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("The date is out of range");
  }
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function formatIso({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/**
 * The parts of exactly `RRRR-MM-DD` (four, two and two ASCII digits, no spaces) that is a real calendar date with a year
 * from 2020 to 2099, otherwise undefined. February 30, month 13 and 2025-02-29 are rejected.
 */
export function parseIsoDate(text: string): DateParts | undefined {
  const match = ISO_DATE.exec(text);
  if (!match) {
    return undefined;
  }
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (parts.year < MIN_YEAR || parts.year > MAX_YEAR) {
    return undefined;
  }
  // Date.UTC rolls an impossible day over to the next month, so a real date comes back unchanged.
  const normalised = partsOf(utcTime(parts));
  return normalised.year === parts.year && normalised.month === parts.month && normalised.day === parts.day
    ? parts
    : undefined;
}

function requireDate(isoDate: string): DateParts {
  const parts = parseIsoDate(isoDate);
  if (parts === undefined) {
    throw new RangeError(`Not a valid schedule date: ${JSON.stringify(isoDate)}`);
  }
  return parts;
}

/**
 * The date `days` after `isoDate` (before it for a negative number) as `YYYY-MM-DD`. Counted in UTC calendar days, so a
 * daylight saving change never moves the result. Throws a RangeError for an `isoDate` that `parseIsoDate` rejects or a
 * `days` that is not a whole number; the result itself may lie outside 2020 to 2099 (2099-12-31 plus 6 is 2100-01-06).
 */
export function addDays(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be a whole number, got ${days}`);
  }
  return formatIso(partsOf(utcTime(requireDate(isoDate)) + days * DAY_MS));
}

/** The last day of the period that starts on `startDate`: six days later. */
export function periodEnd(startDate: string): string {
  return addDays(startDate, PERIOD_DAYS - 1);
}

export interface DayColumn {
  /** Days after the start date, 0 to 6. */
  offset: number;
  /** The calendar date as `YYYY-MM-DD`. */
  date: string;
  /** Short Polish weekday: "niedz.", "pon.", "wt.", "śr.", "czw.", "pt." or "sob.". */
  weekday: string;
  /** Weekday and day with month, e.g. "śr. 11.11". */
  label: string;
}

/** The seven days of the period, the first one being `startDate` itself (not a Monday). */
export function dayColumns(startDate: string): DayColumn[] {
  const start = utcTime(requireDate(startDate));
  return Array.from({ length: PERIOD_DAYS }, (_unused, offset) => {
    const time = start + offset * DAY_MS;
    const parts = partsOf(time);
    const weekday = WEEKDAYS[new Date(time).getUTCDay()];
    return { offset, date: formatIso(parts), weekday, label: `${weekday} ${pad2(parts.day)}.${pad2(parts.month)}` };
  });
}

/**
 * The period for people: "11.11–17.11.2026" (en dash, U+2013), with the year on both ends only when the week crosses
 * New Year ("29.12.2026–04.01.2027"). Throws a RangeError for a `startDate` that `parseIsoDate` rejects.
 */
export function formatPeriod(startDate: string): string {
  const start = requireDate(startDate);
  const end = partsOf(utcTime(start) + (PERIOD_DAYS - 1) * DAY_MS);
  const dayAndMonth = ({ day, month }: DateParts) => `${pad2(day)}.${pad2(month)}`;
  return start.year === end.year
    ? `${dayAndMonth(start)}–${dayAndMonth(end)}.${end.year}`
    : `${dayAndMonth(start)}.${start.year}–${dayAndMonth(end)}.${end.year}`;
}

/** The sum of the required counts over the whole grid. */
export function totalRequired(staffing: readonly Pick<StaffingCell, "requiredCount">[]): number {
  return staffing.reduce((sum, cell) => sum + cell.requiredCount, 0);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function failure(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function parseStartDate(value: unknown): Parsed<string> {
  // A date that parses is already in canonical form, so the string itself is the value.
  return typeof value === "string" && parseIsoDate(value) !== undefined
    ? { ok: true, value }
    : failure(FIELD_ERRORS.startDate);
}

/**
 * The collapsed label (null when absent or empty), or an error when it is not a string, is too long, holds a control
 * character (tab and newline too) or a lone surrogate, or has nothing visible in it.
 */
function parseLabel(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  // Checked on the raw string: trimming first would let a trailing newline or tab slip through. A lone surrogate is not
  // text (JSON can carry one) and the database would refuse it.
  if (typeof value !== "string" || !value.isWellFormed() || CONTROL_CHARS.test(value)) {
    return failure(FIELD_ERRORS.label);
  }
  const label = value.trim().replace(/\s+/gu, " ");
  if (label === "") {
    return { ok: true, value: null };
  }
  if (Array.from(label).length > SCHEDULE_LABEL_MAX_LENGTH) {
    return failure(FIELD_ERRORS.label);
  }
  return label.replace(INVISIBLE_CHARS, "").trim() === "" ? failure(FIELD_ERRORS.label) : { ok: true, value: label };
}

// Plain code-unit order rather than a collator: an id is not text for people, and this never depends on locale data.
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isWholeNumberBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseCell(entry: unknown): StaffingCell | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const { shiftId, dayOffset, requiredCount } = entry as Record<string, unknown>;
  if (
    typeof shiftId !== "string" ||
    !isUuid(shiftId) ||
    !isWholeNumberBetween(dayOffset, 0, PERIOD_DAYS - 1) ||
    !isWholeNumberBetween(requiredCount, 1, STAFFING_MAX)
  ) {
    return undefined;
  }
  // UUIDs compare case-insensitively in the database, so they are kept in lower case here; a JSON -0 becomes 0.
  return { shiftId: shiftId.toLowerCase(), dayOffset: dayOffset === 0 ? 0 : dayOffset, requiredCount };
}

function compareCells(a: StaffingCell, b: StaffingCell): number {
  return compareIds(a.shiftId, b.shiftId) || a.dayOffset - b.dayOffset;
}

/** The cells sorted by shift id, then day, or an error for an empty or oversized grid, a bad cell or a repeated cell. */
function parseStaffing(value: unknown): Parsed<StaffingCell[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return failure(FIELD_ERRORS.staffingEmpty);
  }
  if (value.length > STAFFING_MAX_CELLS) {
    return failure(FIELD_ERRORS.staffingTooMany);
  }
  const cells: StaffingCell[] = [];
  for (const entry of value as unknown[]) {
    const cell = parseCell(entry);
    if (cell === undefined) {
      return failure(FIELD_ERRORS.staffingCell);
    }
    cells.push(cell);
  }
  cells.sort(compareCells);
  const repeated = cells.some((cell, index) => index > 0 && compareCells(cells[index - 1], cell) === 0);
  return repeated ? failure(FIELD_ERRORS.staffingDuplicate) : { ok: true, value: cells };
}

/** The ids in lower case, sorted and without repeats (a repeat is dropped quietly), or an error for none or a bad id. */
function parseEmployeeIds(value: unknown): Parsed<string[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return failure(FIELD_ERRORS.employeesEmpty);
  }
  const ids = new Set<string>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== "string" || !isUuid(entry)) {
      return failure(FIELD_ERRORS.employeesInvalid);
    }
    ids.add(entry.toLowerCase());
  }
  return { ok: true, value: [...ids].sort(compareIds) };
}

/**
 * Validates and normalises a raw schedule with the keys `startDate` (`RRRR-MM-DD`), `label` (optional), `staffing`
 * (cells with `shiftId`, `dayOffset` 0 to 6 and `requiredCount` 1 to 99) and `employeeIds`. Anything that is not an
 * object counts as empty fields. Every invalid field is reported at once, each with one message. The value lists the
 * cells by shift id and day and the employees by id, so the same data in any order gives the same value.
 */
export function validateScheduleInput(
  raw: unknown,
): { ok: true; value: ScheduleInput } | { ok: false; errors: ScheduleFieldErrors } {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const startDate = parseStartDate(input.startDate);
  const label = parseLabel(input.label);
  const staffing = parseStaffing(input.staffing);
  const employeeIds = parseEmployeeIds(input.employeeIds);

  if (!startDate.ok || !label.ok || !staffing.ok || !employeeIds.ok) {
    const errors: ScheduleFieldErrors = {};
    if (!startDate.ok) {
      errors.startDate = startDate.error;
    }
    if (!label.ok) {
      errors.label = label.error;
    }
    if (!staffing.ok) {
      errors.staffing = staffing.error;
    }
    if (!employeeIds.ok) {
      errors.employeeIds = employeeIds.error;
    }
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      startDate: startDate.value,
      label: label.value,
      staffing: staffing.value,
      employeeIds: employeeIds.value,
    },
  };
}

/**
 * A new list with the latest period first, then the latest `createdAt` (as a point in time, not as text), then `id`.
 * The result does not depend on the order of `schedules`, which is left unchanged. Works on any item with these keys,
 * so on a full schedule as well as on a list row.
 */
export function sortSchedules<T extends { id: string; startDate: string; createdAt: string }>(
  schedules: readonly T[],
): T[] {
  return [...schedules].sort(
    (a, b) =>
      // A date as YYYY-MM-DD orders the same as text and as time.
      compareIds(b.startDate, a.startDate) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      compareIds(a.id, b.id),
  );
}
