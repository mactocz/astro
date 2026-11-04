import type { Shift, ShiftFieldErrors, ShiftInput } from "@/types";

export const SHIFT_NAME_MAX_LENGTH = 50;
export const MINUTES_PER_DAY = 1440;

// One message per field, shown next to the form field and returned by the API. Equal times are reported on `endTime`.
const FIELD_ERRORS = {
  name: `Podaj nazwę zmiany (1–${SHIFT_NAME_MAX_LENGTH} znaków, bez znaków sterujących).`,
  startTime: "Podaj godzinę rozpoczęcia w formacie GG:MM (00:00–23:59).",
  endTime: "Podaj godzinę zakończenia w formacie GG:MM (00:00–23:59).",
  endTimeSameAsStart: "Godzina zakończenia musi być inna niż godzina rozpoczęcia.",
} as const;

const CONTROL_CHARS = /\p{Cc}/u;
// No glyph of their own: format characters (zero-width space, joiners, direction marks) and the blank fillers that look
// like letters. A name made only of them and spaces would show up as an empty row. A joiner inside a visible name (an
// emoji sequence, say) stays allowed.
const INVISIBLE_CHARS = /[\p{Cf}ᅟᅠ⠀ㅤﾠ]/gu;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for exactly `GG:MM` (two digits each, 00:00 to 23:59, no spaces), otherwise undefined. */
export function parseTime(text: string): number | undefined {
  const match = TIME_PATTERN.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** `GG:MM` with leading zeros for minutes after midnight, e.g. 365 becomes "06:05". */
export function formatTime(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Minutes from the start to the end, going through midnight when the end is earlier. Equal times give 0. */
export function shiftDurationMinutes(shift: { startMinute: number; endMinute: number }): number {
  return (shift.endMinute - shift.startMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** True when the shift ends on the next day, i.e. the end is earlier than the start. */
export function endsNextDay(shift: { startMinute: number; endMinute: number }): boolean {
  return shift.endMinute < shift.startMinute;
}

/** "8 h", "7 h 30 min" or "45 min": hours and minutes, leaving out a part that is zero ("0 min" for none). */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} h`);
  }
  if (rest > 0) {
    parts.push(`${rest} min`);
  }
  return parts.length > 0 ? parts.join(" ") : "0 min";
}

/** The start and end joined with an en dash (U+2013), e.g. "22:00–06:00". */
export function formatShiftTimes(shift: { startMinute: number; endMinute: number }): string {
  return `${formatTime(shift.startMinute)}–${formatTime(shift.endMinute)}`;
}

/**
 * The collapsed name, or undefined when it is empty, too long, holds a control character (tab and newline too) or a
 * lone surrogate, or has nothing visible in it.
 */
function parseName(value: unknown): string | undefined {
  // Checked on the raw string: trimming first would let a trailing newline or tab slip through. A lone surrogate is not
  // text (JSON can carry one) and the database would refuse it.
  if (typeof value !== "string" || !value.isWellFormed() || CONTROL_CHARS.test(value)) {
    return undefined;
  }
  const name = value.trim().replace(/\s+/gu, " ");
  const length = Array.from(name).length;
  if (length < 1 || length > SHIFT_NAME_MAX_LENGTH) {
    return undefined;
  }
  return name.replace(INVISIBLE_CHARS, "").trim() === "" ? undefined : name;
}

/** The minutes after midnight for a `GG:MM` string (see `parseTime`), or undefined for anything else. */
function parseTimeField(value: unknown): number | undefined {
  return typeof value === "string" ? parseTime(value) : undefined;
}

/**
 * Validates and normalises a raw shift with the keys `name`, `startTime` and `endTime` (`GG:MM` strings). Anything
 * that is not an object counts as empty fields. Every invalid field is reported at once. An end earlier than the start
 * is valid (the shift ends on the next day); an end equal to the start is rejected on `endTime`.
 */
export function validateShiftInput(
  raw: unknown,
): { ok: true; value: ShiftInput } | { ok: false; errors: ShiftFieldErrors } {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const name = parseName(input.name);
  const startMinute = parseTimeField(input.startTime);
  const endMinute = parseTimeField(input.endTime);

  if (name === undefined || startMinute === undefined || endMinute === undefined || startMinute === endMinute) {
    const errors: ShiftFieldErrors = {};
    if (name === undefined) {
      errors.name = FIELD_ERRORS.name;
    }
    if (startMinute === undefined) {
      errors.startTime = FIELD_ERRORS.startTime;
    }
    // Equal times are only compared when both are well formed: a malformed time gets its format message instead.
    if (endMinute === undefined) {
      errors.endTime = FIELD_ERRORS.endTime;
    } else if (startMinute === endMinute) {
      errors.endTime = FIELD_ERRORS.endTimeSameAsStart;
    }
    return { ok: false, errors };
  }
  return { ok: true, value: { name, startMinute, endMinute } };
}

const collator = new Intl.Collator("pl");

// Plain code-unit order rather than the collator: an id is not text for people, and this never depends on locale data.
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A new list ordered by start time, name (Polish collation), end time, then `createdAt` (as a point in time, not as
 * text), then `id`. The result does not depend on the order of `shifts`, which is left unchanged.
 */
export function sortShifts(shifts: readonly Shift[]): Shift[] {
  return [...shifts].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      collator.compare(a.name, b.name) ||
      a.endMinute - b.endMinute ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      compareIds(a.id, b.id),
  );
}
