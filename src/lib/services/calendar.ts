import { PERIOD_DAYS, SCHEDULE_MAX_DATE, SCHEDULE_MIN_DATE, compareText, parseIsoDate } from "@/lib/services/schedule";

// The days off from work (ustawa o dniach wolnych od pracy, art. 1) and the day of the week, for the work-time norm. Every
// function reads dates in UTC (`Date.UTC`, `getUTC*`) or counts whole days, so that no time zone or daylight saving
// change can shift a date. The dates are the ones of the schedules: 2020-01-01 to 2099-12-31.

const DAY_MS = 86_400_000;
const FIRST_YEAR = Number(SCHEDULE_MIN_DATE.slice(0, 4));
const LAST_YEAR = Number(SCHEDULE_MAX_DATE.slice(0, 4));
// 24 December is a day off from this year on.
const CHRISTMAS_EVE_FROM_YEAR = 2025;

// The days after Easter Sunday: Easter Monday, Zielone Świątki (Pentecost Sunday) and Boże Ciało (Corpus Christi).
const EASTER_MONDAY = 1;
const PENTECOST = 49;
const CORPUS_CHRISTI = 60;

// The holidays on a fixed date as [month, day]. The date of Christmas Eve depends on the year, so it is added apart.
const FIXED_HOLIDAYS = [
  [1, 1],
  [1, 6],
  [5, 1],
  [5, 3],
  [8, 15],
  [11, 1],
  [11, 11],
  [12, 25],
  [12, 26],
] as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");

function requireDate(isoDate: string) {
  const parts = parseIsoDate(isoDate);
  if (parts === undefined) {
    throw new RangeError(`Not a valid schedule date: ${JSON.stringify(isoDate)}`);
  }
  return parts;
}

function requireYear(year: number): void {
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) {
    throw new RangeError(`The year must be a whole number from ${FIRST_YEAR} to ${LAST_YEAR}, got ${year}`);
  }
}

// The calendar date of a point in time as YYYY-MM-DD, read in UTC.
function isoOf(time: number): string {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// The anonymous Gregorian algorithm (Meeus, Jones and Butcher), in whole numbers. No limit on the year.
function easterOf(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const sum = h + l - 7 * m + 114;
  return { month: Math.floor(sum / 31), day: (sum % 31) + 1 };
}

// The holidays of a year, sorted, with no limit on the year: a week that starts at the end of 2099 reaches into 2100.
function holidaysOf(year: number): string[] {
  const easter = easterOf(year);
  // Date.UTC carries a day past the end of the month over to the next one, so a plain sum on the day is enough.
  const afterEaster = (days: number): string => isoOf(Date.UTC(year, easter.month - 1, easter.day + days));
  const holidays = [
    ...FIXED_HOLIDAYS.map(([month, day]) => `${year}-${pad2(month)}-${pad2(day)}`),
    afterEaster(0),
    afterEaster(EASTER_MONDAY),
    afterEaster(PENTECOST),
    afterEaster(CORPUS_CHRISTI),
  ];
  if (year >= CHRISTMAS_EVE_FROM_YEAR) {
    holidays.push(`${year}-12-24`);
  }
  return holidays.sort(compareText);
}

/**
 * The day of the week of `isoDate` (`YYYY-MM-DD`): 0 for Sunday to 6 for Saturday. Throws a RangeError for a date that
 * `parseIsoDate` rejects.
 */
export function weekdayOf(isoDate: string): number {
  const { year, month, day } = requireDate(isoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** True when `isoDate` is a Sunday. Throws a RangeError for a date that `parseIsoDate` rejects. */
export function isSunday(isoDate: string): boolean {
  return weekdayOf(isoDate) === 0;
}

/** Easter Sunday of `year` (2020 to 2099) as a month (1 to 12) and a day. Throws a RangeError for another year. */
export function easterSunday(year: number): { month: number; day: number } {
  requireYear(year);
  return easterOf(year);
}

/**
 * The days off from work of `year` (2020 to 2099) as `YYYY-MM-DD`, sorted: 1 and 6 January, Easter Sunday and Monday,
 * 1 and 3 May, Zielone Świątki (Easter plus 49 days), Boże Ciało (Easter plus 60 days), 15 August, 1 and 11 November,
 * 24 December (from 2025 only), 25 and 26 December. Sundays are not listed unless a holiday falls on one. Throws a
 * RangeError for another year.
 */
export function polishHolidays(year: number): string[] {
  requireYear(year);
  return holidaysOf(year);
}

/** True when `isoDate` is one of `polishHolidays`, a Sunday holiday included. Throws a RangeError for an invalid date. */
export function isHoliday(isoDate: string): boolean {
  const { year } = requireDate(isoDate);
  return holidaysOf(year).includes(isoDate);
}

/**
 * The holidays in the seven days from `startDate` (the date included) on a day other than Sunday, sorted: the only
 * ones that lower the work-time norm (art. 130 § 2). A week from 2099-12-31 reaches into 2100 and counts its holidays
 * too. Throws a RangeError for a `startDate` that `parseIsoDate` rejects.
 */
export function holidaysInWeek(startDate: string): string[] {
  const { year, month, day } = requireDate(startDate);
  const start = Date.UTC(year, month - 1, day);
  // Seven days reach into the next year at most.
  const holidays = new Set([...holidaysOf(year), ...holidaysOf(year + 1)]);
  return Array.from({ length: PERIOD_DAYS }, (_unused, offset) => start + offset * DAY_MS)
    .filter((time) => new Date(time).getUTCDay() !== 0)
    .map(isoOf)
    .filter((date) => holidays.has(date));
}
